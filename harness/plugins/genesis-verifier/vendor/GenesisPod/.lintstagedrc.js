/**
 * lint-staged configuration (function form)
 *
 * Why function form instead of JSON glob → command array?
 * - JSON form causes lint-staged to chunk files by maxArgLength (4095 on Windows)
 * - Each chunk spawns a separate ESLint process → full TS program rebuild (~11s each)
 * - 68 files = 3 chunks × 11s startup = 33s wasted on redundant type-checking
 * - Function form receives ALL files at once → we control the chunking
 *
 * Why explicit CHUNK_SIZE chunking (2026-06-03)?
 * - A single eslint invocation with ALL paths overflows the Windows command-line
 *   length limit (~8191 chars) on large commits (e.g. a 130-file refactor →
 *   "The command line is too long", pre-commit rejected).
 * - We chunk at CHUNK_SIZE (50) files/call: commits ≤50 files = 1 chunk =
 *   identical to before; only larger commits split (still far fewer processes
 *   than JSON form's 4095-byte auto-chunking, and --cache amortizes rebuilds).
 *
 * Why --cache?
 * - ESLint with type-aware rules rebuilds the TS program every invocation (~11s)
 * - --cache skips files whose content + config haven't changed
 * - Second commit in a session: ~1s instead of ~11s for unchanged files
 *
 * Why npx -w <workspace>?
 * - ESLint needs tsconfig.json from the workspace root (backend/ or frontend/)
 * - `cd backend && ...` fails on Windows (lint-staged doesn't use a shell)
 * - `npx -w backend` uses npm workspaces to set correct cwd
 */
const path = require("path");
const fs = require("fs");

/**
 * Convert absolute file paths to paths relative to a subdirectory,
 * always using forward slashes (cross-platform).
 */
function toRelative(baseDir, files) {
  return files.map((f) => path.relative(baseDir, f).replace(/\\/g, "/"));
}

function toRepoRelative(files) {
  return files.map((f) => path.relative(process.cwd(), f).replace(/\\/g, "/"));
}

function quote(f) {
  return `"${f}"`;
}

/** Max files per shell command (keeps each invocation under the Windows ~8191-char cmd limit). */
const CHUNK_SIZE = 50;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Build chunked eslint --fix + prettier (+ optional matching jest) commands for
 * a workspace, so no single command line exceeds the Windows length limit.
 */
function lintCmds(workspace, files, { withTests = false } = {}) {
  const cmds = [];
  for (const group of chunk(files, CHUNK_SIZE)) {
    const rel = toRelative(workspace, group).map(quote).join(" ");
    const repoRel = toRepoRelative(group).map(quote).join(" ");
    cmds.push(`npx -w ${workspace} eslint --cache --fix ${rel}`);
    cmds.push(`prettier --write ${repoRel}`);
  }
  if (withTests) {
    const tests = findMatchingTests(files, workspace);
    for (const group of chunk(tests, CHUNK_SIZE)) {
      const testRel = toRelative(workspace, group).map(quote).join(" ");
      cmds.push(
        `npx -w ${workspace} jest --passWithNoTests --bail --runInBand ${testRel}`,
      );
    }
  }
  return cmds;
}

/**
 * Find existing spec files for changed source files.
 * Only returns tests that actually exist on disk.
 */
function findMatchingTests(files, workspace) {
  const testFiles = [];
  for (const f of files) {
    // Skip test files themselves, fixtures, mocks
    if (/\.(spec|test|e2e-spec)\.(ts|tsx)$/.test(f)) continue;
    if (f.includes("__tests__") || f.includes("__mocks__")) continue;
    if (f.includes("fixtures")) continue;

    // Try co-located .spec.ts
    const specPath = f.replace(/\.ts$/, ".spec.ts").replace(/\.tsx$/, ".spec.tsx");
    if (fs.existsSync(specPath)) {
      testFiles.push(specPath);
      continue;
    }

    // Try __tests__ directory sibling
    const dir = path.dirname(f);
    const base = path.basename(f, path.extname(f));
    const testDir = path.join(dir, "__tests__", `${base}.spec.ts`);
    if (fs.existsSync(testDir)) {
      testFiles.push(testDir);
    }
  }
  return testFiles;
}

module.exports = {
  "**/*.{json,md,yml,yaml}": ["prettier --write"],

  "backend/**/*.{ts,tsx}": (files) => lintCmds("backend", files, { withTests: true }),
  "backend/**/*.{js,jsx}": (files) => lintCmds("backend", files),
  "frontend/**/*.{ts,tsx}": (files) => lintCmds("frontend", files),
  "frontend/**/*.{js,jsx}": (files) => lintCmds("frontend", files),
};
