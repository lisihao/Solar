/**
 * capability-event-parity.spec.ts
 *
 * Regression guard: prevents silent loss of emit sources when the capability
 * core (deep-insight) is hard-switched.
 *
 * Root cause of the 2026-06 playground regression:
 *   After the capability-core hard-cut, 20+ baseline events lost their
 *   emitDomain call sites in the capability layer.  The existing
 *   event-emit-registry-coverage.spec.ts only scans the playground/ directory
 *   for `type: "playground.<suffix>"` literals — it cannot see capability-
 *   layer emitDomain calls which use domain event names (no "playground."
 *   prefix).  So removing any emitDomain call in deep-insight caused no spec
 *   to fail, and multiple frontend panels went permanently blank.
 *
 * This spec covers the exact gap:
 *   1. Statically scans marketplace/capabilities/deep-insight/ for every
 *      emitDomain(onEvent, "<name>", ...) call site and collects the name set.
 *   2. Maintains an explicit domain-name → playground-type mapping table
 *      derived from playground.pipeline.ts bridge logic (domain event path:
 *      playground.<domainEvent> via `type: \`playground.${domainEvent}\``).
 *   3. Asserts every domain event in the mapping table:
 *        (a) has at least one emitDomain call in the capability source, AND
 *        (b) its expected playground.* type is registered in
 *            AGENT_PLAYGROUND_EVENTS (EventBus drop guard).
 *   4. Maintains a BASELINE_CRITICAL list — events whose absence directly
 *      breaks frontend panels.  Asserts each has an emitDomain source.
 *   5. Sanity assertions prevent false-green from broken regex / empty scans.
 */

import * as fs from "fs";
import * as path from "path";
import { AGENT_PLAYGROUND_EVENTS } from "../../../modules/ai-app/playground/events/playground.events";

// ── path constants ────────────────────────────────────────────────────────────

const BACKEND_SRC = path.resolve(__dirname, "../../../");

/** All non-test .ts files under deep-insight capability (including postlude). */
const DEEP_INSIGHT_ROOT = path.resolve(
  BACKEND_SRC,
  "modules/ai-app/marketplace/capabilities/deep-insight",
);

// ── fs helpers ────────────────────────────────────────────────────────────────

function collectSourceFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "__tests__") {
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
 * Extract all emitDomain(onEvent, "<name>", ...) event name literals.
 * Also covers emitPostludeEvent(onEvent, "<name>", ...) in postlude.
 * Returns the name strings (without any prefix).
 */
function extractEmitDomainNames(fileContent: string): string[] {
  // Matches: emitDomain(anything, "name", or emitPostludeEvent(anything, "name",
  const RE =
    /emit(?:Domain|PostludeEvent)\s*\([^,]+,\s*["']([a-zA-Z0-9:/_-]+)["']\s*,/g;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = RE.exec(fileContent)) !== null) {
    found.push(match[1]);
  }
  return found;
}

// ── static scan ───────────────────────────────────────────────────────────────

const capabilitySourceFiles = collectSourceFiles(DEEP_INSIGHT_ROOT);

/** domain event name → set of relative file paths that emit it */
const domainNameToFiles = new Map<string, Set<string>>();

for (const file of capabilitySourceFiles) {
  const content = fs.readFileSync(file, "utf-8");
  const names = extractEmitDomainNames(content);
  for (const name of names) {
    if (!domainNameToFiles.has(name)) domainNameToFiles.set(name, new Set());
    domainNameToFiles.get(name)!.add(path.relative(DEEP_INSIGHT_ROOT, file));
  }
}

/** Full set of domain event names found in capability source. */
const foundDomainNames = new Set(domainNameToFiles.keys());

// ── registered playground types ──────────────────────────────────────────────

const registeredPlaygroundTypes = new Set(
  AGENT_PLAYGROUND_EVENTS.map((e) => e.type),
);

// ── bridge mapping table ──────────────────────────────────────────────────────
//
// Derived from playground.pipeline.ts bridgeCapabilityEventToPlayground():
//   - event.type === "domain"  → emitToBus({ type: `playground.${domainEvent}` })
// So every domain name maps to playground.<domainName> verbatim.
//
// This table is the explicit contract.  It covers domain events that:
//   (a) the capability core emits via emitDomain / emitPostludeEvent, AND
//   (b) the frontend consumes under the "playground.*" namespace.
//
// If a domain name is added here it must be emitted in capability source and
// registered in AGENT_PLAYGROUND_EVENTS.  If a domain name is removed from
// capability source, this table will trigger a failure on assertion (a).

interface BridgeEntry {
  /** Domain event name used in emitDomain(onEvent, name, ...) */
  readonly domainName: string;
  /** Expected playground.* type (= "playground." + domainName) */
  readonly playgroundType: string;
  /** Brief rationale for inclusion in the table. */
  readonly why: string;
}

function bridge(domainName: string, why: string): BridgeEntry {
  return { domainName, playgroundType: `playground.${domainName}`, why };
}

const BRIDGE_TABLE: readonly BridgeEntry[] = [
  // agent lifecycle — every invokeAgent call emits started + completed
  bridge(
    "agent:lifecycle",
    "invokeAgent start/complete; agent timeline + roster",
  ),
  // cost accounting — emitted after every invokeAgent call that uses tokens
  bridge("cost:tick", "dvProjectCost cost bar; mission cost tracking"),
  // narrative — s2-s10 human-readable progress commentary
  bridge("agent:narrative", "collaboration panel narrative feed"),
  // s2 leader plan events
  bridge("leader:goals-set", "leader goals panel; s2 done signal"),
  bridge("stage:metrics", "stage metrics panel; s2/s4 dimension counts"),
  bridge("leader:decision", "leader decision panel; s4 assess verdict"),
  // s3 researcher events
  bridge("dimension:research:started", "dimension todo started state"),
  bridge(
    "dimension:research:completed",
    "dimension todo completed; findings count",
  ),
  bridge("researcher:completed", "researcher panel; dimension summary"),
  // s4 grading
  bridge(
    "dimension:graded",
    "dimension todo grade artifact; 0/100 score on fail",
  ),
  // s5 reconciler
  bridge(
    "reconciliation:completed",
    "reconciler-gap todo; fact/conflict/gap counts",
  ),
  // s7 outline
  bridge("dimension:outline:planned", "chapter count display"),
  // s8 writing
  bridge("chapter:writing:started", "chapter todo started; writing timeline"),
  bridge("chapter:writing:completed", "chapter todo completed; wordCount"),
  // s8 heartbeat fallback (chapter-stream.helper)
  bridge("iteration:progress", "writing-period heartbeat; ReAct loop progress"),
  // s9 critic
  bridge("critic:verdict", "blindspot todos; CriticVerdict panel"),
  // s9b objective eval
  bridge("verifier:verdict", "VerifyConsensus panel; score artifact"),
  // s10 signoff
  bridge("leader:foreword", "leader foreword artifact; s10 todo in_progress"),
  bridge("leader:signed", "leader signed artifact; final quality gate"),
  // s12 postlude (self-evolution)
  bridge("mission:postlude:started", "todo-board postlude started"),
  bridge("mission:postlude:completed", "todo-board postlude completed"),
  bridge("mission:postlude:failed", "todo-board postlude failed"),
  bridge("memory:indexed", "MemoryIndexPanel; CapabilityMeters memory tab"),
  // stage:lifecycle emitted by postlude for s12 node (not in orchestrator steps)
  bridge(
    "stage:lifecycle",
    "stage chip s12 started/completed/failed via postlude self-bridge",
  ),
];

// ── baseline critical events ──────────────────────────────────────────────────
//
// Events confirmed broken during the 2026-06 capability-core hard-cut
// regression: frontend panels went permanently blank because these events
// lost their emitDomain source.  Asserting these individually makes the
// regression description precise and actionable.

const BASELINE_CRITICAL: ReadonlyArray<{
  readonly domainName: string;
  readonly panel: string;
}> = [
  {
    domainName: "chapter:writing:started",
    panel: "chapter todo started state",
  },
  {
    domainName: "chapter:writing:completed",
    panel: "chapter todo completed + wordCount",
  },
  {
    domainName: "dimension:graded",
    panel: "dimension quality artifact (0/100 on fail)",
  },
  {
    domainName: "dimension:research:completed",
    panel: "dimension research completed todo",
  },
  {
    domainName: "critic:verdict",
    panel: "blindspot todo + CriticVerdict panel",
  },
  { domainName: "verifier:verdict", panel: "VerifyConsensusPanel scores" },
  {
    domainName: "reconciliation:completed",
    panel: "reconciler-gap todo counts",
  },
  {
    domainName: "memory:indexed",
    panel: "MemoryIndexPanel / CapabilityMeters",
  },
  {
    domainName: "agent:lifecycle",
    panel: "agent timeline + roster running state",
  },
  { domainName: "cost:tick", panel: "dvProjectCost cost bar" },
];

// ── tests ─────────────────────────────────────────────────────────────────────

describe("capability-event-parity: deep-insight emitDomain → AGENT_PLAYGROUND_EVENTS", () => {
  // ── sanity guards (prevent false-green from broken scan) ──────────────────

  it("scanned at least 5 capability source files (sanity: scan not empty)", () => {
    expect(capabilitySourceFiles.length).toBeGreaterThan(5);
  });

  it("extracted at least 15 distinct domain event names (sanity: regex not broken)", () => {
    expect(foundDomainNames.size).toBeGreaterThan(15);
  });

  it("AGENT_PLAYGROUND_EVENTS contains at least 50 entries (sanity: registry loaded)", () => {
    expect(AGENT_PLAYGROUND_EVENTS.length).toBeGreaterThan(50);
  });

  // ── bridge table: dual assertions ─────────────────────────────────────────
  //
  // For every entry in BRIDGE_TABLE:
  //   (a) the domain event MUST have an emitDomain source in deep-insight
  //   (b) the playground type MUST be registered in AGENT_PLAYGROUND_EVENTS

  describe("BRIDGE_TABLE: every domain event has an emitDomain source in capability core", () => {
    for (const entry of BRIDGE_TABLE) {
      it(`emitDomain source exists for "${entry.domainName}" (${entry.why})`, () => {
        if (!foundDomainNames.has(entry.domainName)) {
          const knownNames = [...foundDomainNames].sort().join(", ");
          throw new Error(
            `Domain event "${entry.domainName}" has NO emitDomain call in ` +
              `deep-insight capability source.\n` +
              `Frontend panel affected: ${entry.why}\n` +
              `Fix: add emitDomain(onEvent, "${entry.domainName}", {...}) in the ` +
              `appropriate stage binding (deep-insight-stage-bindings.ts) or postlude.\n` +
              `Domain names currently found in capability source: ${knownNames}`,
          );
        }
        expect(foundDomainNames.has(entry.domainName)).toBe(true);
      });
    }
  });

  describe("BRIDGE_TABLE: every expected playground type is registered in AGENT_PLAYGROUND_EVENTS", () => {
    for (const entry of BRIDGE_TABLE) {
      it(`"${entry.playgroundType}" is registered (EventBus will not drop it)`, () => {
        if (!registeredPlaygroundTypes.has(entry.playgroundType)) {
          throw new Error(
            `playground type "${entry.playgroundType}" is NOT registered in AGENT_PLAYGROUND_EVENTS.\n` +
              `EventBus will silently DROP this event at runtime.\n` +
              `Fix: add S("${entry.domainName}", <YourSchema>) to playground.events.ts.\n` +
              `Domain source: emitDomain in deep-insight (${
                [...(domainNameToFiles.get(entry.domainName) ?? [])].join(
                  ", ",
                ) || "no source — bridge table may be ahead of implementation"
              })`,
          );
        }
        expect(registeredPlaygroundTypes.has(entry.playgroundType)).toBe(true);
      });
    }
  });

  // ── baseline critical events: must have emitDomain source ─────────────────
  //
  // These are the events confirmed missing after the 2026-06 hard-cut.
  // If any of these loses its emitDomain call, this block will fail
  // with a named panel reference so the reviewer knows exactly what breaks.

  describe("BASELINE_CRITICAL: frontend-panel-critical events must have emitDomain source", () => {
    for (const critical of BASELINE_CRITICAL) {
      it(`"${critical.domainName}" has emitDomain source — panel: ${critical.panel}`, () => {
        if (!foundDomainNames.has(critical.domainName)) {
          throw new Error(
            `CRITICAL REGRESSION: domain event "${critical.domainName}" has NO ` +
              `emitDomain call in deep-insight capability source.\n` +
              `Frontend panel that will break: ${critical.panel}\n` +
              `This is the same failure pattern as the 2026-06 playground hard-cut regression.\n` +
              `Fix: restore emitDomain(onEvent, "${critical.domainName}", {...}) in ` +
              `deep-insight-stage-bindings.ts or the relevant binding helper.`,
          );
        }
        expect(foundDomainNames.has(critical.domainName)).toBe(true);
      });
    }
  });

  // ── no unknown domain events leaking from capability source ───────────────
  //
  // Every domain event emitted in capability source should be in the bridge
  // table (i.e. it is a known, documented event).  This catches NEW emitDomain
  // calls added without updating the bridge table (forward coverage).
  //
  // Note: agent:narrative is emitted in many places and is in the table.
  // stage:lifecycle is emitted by postlude only (special case also in table).

  it("every domain event emitted in capability source is in BRIDGE_TABLE (forward coverage)", () => {
    const tableNames = new Set(BRIDGE_TABLE.map((e) => e.domainName));
    const untracked: string[] = [];
    for (const name of foundDomainNames) {
      if (!tableNames.has(name)) {
        const files = [...(domainNameToFiles.get(name) ?? [])].join(", ");
        untracked.push(`"${name}" (emitted in: ${files})`);
      }
    }
    if (untracked.length > 0) {
      throw new Error(
        `The following domain events are emitted in capability source but NOT in BRIDGE_TABLE.\n` +
          `Add them to BRIDGE_TABLE in capability-event-parity.spec.ts AND verify they are\n` +
          `registered in AGENT_PLAYGROUND_EVENTS:\n\n` +
          untracked.map((u) => `  - ${u}`).join("\n"),
      );
    }
    expect(untracked).toHaveLength(0);
  });
});
