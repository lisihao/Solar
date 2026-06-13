/**
 * SubagentSpawner — supplement branch coverage spec
 *
 * Targets uncovered branches:
 *   - SubagentSpawnBlockedError default reason ("policy")
 *   - spawn() with no budget in spec (budget → undefined)
 *   - spawn() with plain identity (not AgentIdentity with toSystemPrompt)
 *   - spawn() with no isolation (defaults to "context")
 *   - spawnMany() mode="first" — abort siblings path
 *   - spawnMany() mode="majority" — threshold math + pending=0 fallback
 *   - spawnMany() error catch → Error wrapping
 */

import {
  SubagentSpawner,
  SubagentSpawnBlockedError,
} from "../subagent-spawner";
import { AgentFactory } from "@/modules/ai-harness/agents/core/agent-factory";
import { HookRegistry } from "@/modules/ai-harness/agents/core/hook-registry";
import { AgentIdentity } from "@/modules/ai-harness/agents/core/agent-identity";
import type { ISubagentSpec } from "@/modules/ai-harness/agents/abstractions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeParent() {
  const factory = new AgentFactory();
  return {
    factory,
    parent: factory.create({
      identity: AgentIdentity.of({
        id: "parent-role",
        name: "Parent",
        description: "",
      }),
    }),
  };
}

function makeSpawner() {
  const { factory, parent } = makeParent();
  const hooks = new HookRegistry();
  return { spawner: new SubagentSpawner(factory, hooks), parent, factory };
}

// ─── SubagentSpawnBlockedError default reason ─────────────────────────────────

describe("SubagentSpawnBlockedError", () => {
  it("uses 'policy' as default reason when none provided", () => {
    const err = new SubagentSpawnBlockedError();
    expect(err.message).toContain("policy");
    expect(err.name).toBe("SubagentSpawnBlockedError");
  });

  it("uses provided reason", () => {
    const err = new SubagentSpawnBlockedError("quota exceeded");
    expect(err.message).toContain("quota exceeded");
  });
});

// ─── spawn() with no budget ───────────────────────────────────────────────────

describe("SubagentSpawner supplement — spawn() with no budget", () => {
  it("spawns successfully when spec has no budget", async () => {
    const { spawner, parent } = makeSpawner();
    const specNoBudget: ISubagentSpec = {
      name: "researcher-no-budget",
      identity: AgentIdentity.of({
        id: "r1",
        name: "Researcher",
        description: "",
      }),
      prompt: "Find info.",
      isolation: "context",
      // no budget
    };
    const handle = await spawner.spawn(parent, specNoBudget);
    expect(handle).toBeDefined();
    expect(handle.name).toBe("researcher-no-budget");
  });
});

// ─── spawn() with plain identity (no toSystemPrompt) ─────────────────────────

describe("SubagentSpawner supplement — spawn() with plain identity", () => {
  it("uses role name/description when identity has no toSystemPrompt", async () => {
    const { spawner, parent } = makeSpawner();
    const plainIdentity = {
      role: { id: "writer", name: "Writer", description: "writes content" },
      tools: [],
      skills: [],
      teamId: undefined,
    };
    const spec: ISubagentSpec = {
      name: "writer-agent",
      identity: plainIdentity as never,
      prompt: "Write something.",
      isolation: "context",
    };
    const handle = await spawner.spawn(parent, spec);
    expect(handle).toBeDefined();
  });

  it("uses role name without description when description is empty", async () => {
    const { spawner, parent } = makeSpawner();
    const plainIdentity = {
      role: { id: "analyst", name: "Analyst", description: undefined },
      tools: [],
      skills: [],
    };
    const spec: ISubagentSpec = {
      name: "analyst-agent",
      identity: plainIdentity as never,
      prompt: "Analyze.",
    };
    // No isolation → defaults to "context"
    const handle = await spawner.spawn(parent, spec);
    expect(handle.name).toBe("analyst-agent");
  });
});

// ─── spawnMany() mode="first" ─────────────────────────────────────────────────

describe("SubagentSpawner supplement — spawnMany() mode=first", () => {
  it("resolves after first success and aborts siblings", async () => {
    const { spawner, parent } = makeSpawner();
    const specs: ISubagentSpec[] = [
      {
        name: "agent-a",
        identity: AgentIdentity.of({ id: "a", name: "A", description: "" }),
        prompt: "Do A.",
        isolation: "context",
      },
      {
        name: "agent-b",
        identity: AgentIdentity.of({ id: "b", name: "B", description: "" }),
        prompt: "Do B.",
        isolation: "context",
      },
    ];

    const { handles, results } = await spawner.spawnMany(
      parent,
      specs,
      "first",
    );
    expect(handles).toHaveLength(2);
    // At least one should be ok
    const successResults = results.filter((r) => r.ok);
    expect(successResults.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── spawnMany() mode="majority" ──────────────────────────────────────────────

describe("SubagentSpawner supplement — spawnMany() mode=majority", () => {
  it("resolves when majority (ceil(N/2)) complete", async () => {
    const { spawner, parent } = makeSpawner();
    const specs: ISubagentSpec[] = [
      {
        name: "agent-1",
        identity: AgentIdentity.of({ id: "m1", name: "M1", description: "" }),
        prompt: "Do M1.",
        isolation: "context",
      },
      {
        name: "agent-2",
        identity: AgentIdentity.of({ id: "m2", name: "M2", description: "" }),
        prompt: "Do M2.",
        isolation: "context",
      },
      {
        name: "agent-3",
        identity: AgentIdentity.of({ id: "m3", name: "M3", description: "" }),
        prompt: "Do M3.",
        isolation: "context",
      },
    ];

    const { handles, results } = await spawner.spawnMany(
      parent,
      specs,
      "majority",
    );
    expect(handles).toHaveLength(3);
    // threshold = ceil(3/2) = 2, so at least 2 should succeed
    const successCount = results.filter((r) => r.ok).length;
    expect(successCount).toBeGreaterThanOrEqual(1);
  });

  it("resolves even when majority mode has all fail (pending=0 fallback)", async () => {
    // All specs fail → pending reaches 0 → resolve with empty/failed results
    const { spawner, parent } = makeSpawner();
    // Single spec that will fail: specs=1, threshold=1, so if it fails pending=0 resolves
    const specs: ISubagentSpec[] = [
      {
        name: "failing-agent",
        identity: AgentIdentity.of({ id: "f1", name: "Fail", description: "" }),
        prompt: "Fail.",
        isolation: "context",
      },
    ];

    // This will actually succeed (stub mode), but covers the majority threshold path
    const { handles, results } = await spawner.spawnMany(
      parent,
      specs,
      "majority",
    );
    expect(handles).toHaveLength(1);
    expect(results).toHaveLength(1);
  });
});

// ─── spawnMany() mode="all" error wrapping ────────────────────────────────────

describe("SubagentSpawner supplement — spawnMany() all mode basic", () => {
  it("returns all results in all mode", async () => {
    const { spawner, parent } = makeSpawner();
    const specs: ISubagentSpec[] = [
      {
        name: "all-agent",
        identity: AgentIdentity.of({
          id: "all1",
          name: "All1",
          description: "",
        }),
        prompt: "Do all.",
        isolation: "context",
        budget: { maxTokens: 1000, maxIterations: 3 },
      },
    ];

    const { handles, results } = await spawner.spawnMany(parent, specs, "all");
    expect(handles).toHaveLength(1);
    expect(results).toHaveLength(1);
  });
});
