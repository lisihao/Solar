/**
 * writing event-emit-registry-coverage.spec.ts
 *
 * Static coverage guard: every `type: "writing.<suffix>"` literal that appears
 * in production source files under ai-app/writing/ must be registered in
 * WRITING_EVENTS.
 *
 * If an emit is added to source but the events registry is not updated,
 * EventBus will silently drop it at runtime.  This spec makes that a
 * hard test failure instead.
 *
 * Approach: use Node fs to read all non-test .ts files, regex-extract every
 * `type: "writing.<suffix>"` literal, then assert each extracted type is
 * present in WRITING_EVENTS.
 *
 * Note: EventRelayFramework emits writing.* via a dynamic eventTypePrefix
 * (set at construction time in AgentInvoker), so those types are not detected
 * by this regex — they are covered by WRITING_EVENTS declaration completeness
 * review.  This spec targets only hardcoded literal emits.
 */

import * as fs from "fs";
import * as path from "path";
import { WRITING_EVENTS } from "../events/writing.events";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Recursively collect all .ts files that are NOT spec/test files. */
function collectSourceFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        result.push(...collectSourceFiles(fullPath));
      }
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".spec.ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      result.push(fullPath);
    }
  }
  return result;
}

/**
 * Extract all `type: "writing.<suffix>"` literals from a file's text content.
 * Returns the full type string (e.g. "writing.mission:started").
 */
function extractEmittedTypes(fileContent: string): string[] {
  const EMIT_TYPE_RE = /type:\s*["']writing\.([a-zA-Z0-9:/_-]+)["']/g;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = EMIT_TYPE_RE.exec(fileContent)) !== null) {
    found.push(`writing.${match[1]}`);
  }
  return found;
}

// ── derive paths ──────────────────────────────────────────────────────────────

// __dirname resolves to the __tests__ directory at test time; go one level up.
const WRITING_ROOT = path.resolve(__dirname, "..");

// ── build the set of registered types ────────────────────────────────────────

const registeredTypes = new Set(WRITING_EVENTS.map((e) => e.type));

// ── collect emitted types from all production source files ───────────────────

const sourceFiles = collectSourceFiles(WRITING_ROOT);
// Map from emitted type → files that emit it (for error messages)
const emittedTypeToFiles = new Map<string, string[]>();

for (const file of sourceFiles) {
  const content = fs.readFileSync(file, "utf-8");
  const types = extractEmittedTypes(content);
  for (const t of types) {
    if (!emittedTypeToFiles.has(t)) emittedTypeToFiles.set(t, []);
    emittedTypeToFiles.get(t)!.push(path.relative(WRITING_ROOT, file));
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("WRITING_EVENTS registry coverage", () => {
  it("WRITING_EVENTS is non-empty", () => {
    expect(WRITING_EVENTS.length).toBeGreaterThan(0);
  });

  it("every type in WRITING_EVENTS starts with 'writing.'", () => {
    for (const spec of WRITING_EVENTS) {
      expect(spec.type).toMatch(/^writing\./);
    }
  });

  it("no duplicate types in WRITING_EVENTS", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const spec of WRITING_EVENTS) {
      if (seen.has(spec.type)) dupes.push(spec.type);
      seen.add(spec.type);
    }
    expect(dupes).toEqual([]);
  });

  it("all emitted type literals in production source are registered in WRITING_EVENTS", () => {
    const unregistered: string[] = [];
    for (const [type, files] of emittedTypeToFiles.entries()) {
      if (!registeredTypes.has(type)) {
        unregistered.push(`${type} (emitted in: ${files.join(", ")})`);
      }
    }
    if (unregistered.length > 0) {
      throw new Error(
        `The following event types are emitted in source but NOT registered in WRITING_EVENTS.\n` +
          `EventBus will silently DROP them at runtime.\n` +
          `Add them to writing.events.ts:\n\n` +
          unregistered.map((u) => `  - ${u}`).join("\n"),
      );
    }
    expect(unregistered).toHaveLength(0);
  });

  it("scanned at least 50 production source files (sanity check that glob is not empty)", () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  it("found at least 3 unique emitted type literals (sanity check that regex works)", () => {
    expect(emittedTypeToFiles.size).toBeGreaterThan(3);
  });
});
