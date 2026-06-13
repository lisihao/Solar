#!/usr/bin/env node
/**
 * Sync docs/architecture/ai-app/**.md into frontend/lib/generated/ai-app-docs/
 * before `next build`, so the production frontend image (which only copies
 * `frontend/` into its Docker build context) has the markdown bundled.
 *
 * Without this, /admin/ai-app/[category] would always show placeholder text
 * in production (docs/ lives at repo root, outside the Dockerfile context).
 *
 * Idempotent — safe to run multiple times. Skips silently if source missing
 * (e.g., docs were intentionally not shipped with this build).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_DOCS_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'docs',
  'architecture',
  'ai-app'
);
const BUNDLED_DIR = path.resolve(
  __dirname,
  '..',
  'lib',
  'generated',
  'ai-app-docs'
);

function rmrf(target) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function copyMdRecursive(srcDir, dstDir) {
  let count = 0;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dstPath, { recursive: true });
      count += copyMdRecursive(srcPath, dstPath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
      count += 1;
    }
  }
  return count;
}

function main() {
  if (!fs.existsSync(REPO_DOCS_DIR)) {
    // In production Docker build (context = frontend/), repo docs/ may
    // legitimately not exist. Don't fail — leave bundled dir as-is.
    console.log(
      `[sync-architecture-docs] source not found at ${REPO_DOCS_DIR} — skipping (this is expected in some build contexts)`
    );
    return;
  }
  rmrf(BUNDLED_DIR);
  fs.mkdirSync(BUNDLED_DIR, { recursive: true });
  const count = copyMdRecursive(REPO_DOCS_DIR, BUNDLED_DIR);
  console.log(
    `[sync-architecture-docs] copied ${count} markdown files → ${BUNDLED_DIR}`
  );
}

main();
