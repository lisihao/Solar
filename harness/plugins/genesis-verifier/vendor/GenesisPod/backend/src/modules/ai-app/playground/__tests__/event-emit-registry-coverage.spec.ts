/**
 * #48-registry — event-emit-registry-coverage.spec.ts
 *
 * Static coverage guard: every `type: "playground.<suffix>"` literal that
 * appears in production source files under playground/ must be registered
 * in AGENT_PLAYGROUND_EVENTS.
 *
 * If an emit is added to source but the events registry is not updated,
 * EventBus will silently drop it at runtime.  This spec makes that a
 * hard test failure instead.
 *
 * Approach: use Node fs to read all non-test .ts files, regex-extract every
 * `type: "playground.<suffix>"` literal, then assert each extracted type
 * is present in AGENT_PLAYGROUND_EVENTS.
 */

import * as fs from "fs";
import * as path from "path";
import { AGENT_PLAYGROUND_EVENTS } from "../events/playground.events";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Recursively collect all .ts files that are NOT spec/test files. */
function collectSourceFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // skip node_modules (should not be here, but be safe)
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
 * Extract all `type: "playground.<suffix>"` literals from a file's
 * text content.  Returns the full type string (e.g. "playground.mission:started").
 */
function extractEmittedTypes(fileContent: string): string[] {
  const EMIT_TYPE_RE = /type:\s*["']playground\.([a-zA-Z0-9:/_-]+)["']/g;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = EMIT_TYPE_RE.exec(fileContent)) !== null) {
    found.push(`playground.${match[1]}`);
  }
  return found;
}

// ── derive paths ──────────────────────────────────────────────────────────────

// __dirname resolves to the __tests__ directory at test time; go one level up.
const AGENT_PLAYGROUND_ROOT = path.resolve(__dirname, "..");

// ── build the set of registered types ────────────────────────────────────────

const registeredTypes = new Set(AGENT_PLAYGROUND_EVENTS.map((e) => e.type));

// ── collect emitted types from all production source files ───────────────────

const sourceFiles = collectSourceFiles(AGENT_PLAYGROUND_ROOT);
// Map from emitted type → files that emit it (for error messages)
const emittedTypeToFiles = new Map<string, string[]>();

for (const file of sourceFiles) {
  const content = fs.readFileSync(file, "utf-8");
  const types = extractEmittedTypes(content);
  for (const t of types) {
    if (!emittedTypeToFiles.has(t)) emittedTypeToFiles.set(t, []);
    emittedTypeToFiles.get(t)!.push(path.relative(AGENT_PLAYGROUND_ROOT, file));
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("#48-registry AGENT_PLAYGROUND_EVENTS coverage", () => {
  it("AGENT_PLAYGROUND_EVENTS is non-empty", () => {
    expect(AGENT_PLAYGROUND_EVENTS.length).toBeGreaterThan(0);
  });

  it("every type in AGENT_PLAYGROUND_EVENTS starts with 'playground.'", () => {
    for (const spec of AGENT_PLAYGROUND_EVENTS) {
      expect(spec.type).toMatch(/^playground\./);
    }
  });

  it("no duplicate types in AGENT_PLAYGROUND_EVENTS", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const spec of AGENT_PLAYGROUND_EVENTS) {
      if (seen.has(spec.type)) dupes.push(spec.type);
      seen.add(spec.type);
    }
    expect(dupes).toEqual([]);
  });

  it("all emitted type literals in production source are registered in AGENT_PLAYGROUND_EVENTS", () => {
    const unregistered: string[] = [];
    for (const [type, files] of emittedTypeToFiles.entries()) {
      if (!registeredTypes.has(type)) {
        unregistered.push(`${type} (emitted in: ${files.join(", ")})`);
      }
    }
    if (unregistered.length > 0) {
      // Provide a clear, actionable error message
      throw new Error(
        `The following event types are emitted in source but NOT registered in AGENT_PLAYGROUND_EVENTS.\n` +
          `EventBus will silently DROP them at runtime.\n` +
          `Add them to playground.events.ts:\n\n` +
          unregistered.map((u) => `  - ${u}`).join("\n"),
      );
    }
    // If we get here, all emitted types are registered
    expect(unregistered).toHaveLength(0);
  });

  it("scanned at least 30 production source files (sanity check that glob is not empty)", () => {
    expect(sourceFiles.length).toBeGreaterThan(30);
  });

  it("found at least 50 unique emitted type literals (sanity check that regex works)", () => {
    expect(emittedTypeToFiles.size).toBeGreaterThan(50);
  });
});
