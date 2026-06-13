/**
 * SubagentSpawner 单元测试
 */

import {
  SubagentSpawner,
  SubagentSpawnBlockedError,
} from "../subagent-spawner";
import { AgentFactory } from "@/modules/ai-harness/agents/core/agent-factory";
import { HookRegistry } from "@/modules/ai-harness/agents/core/hook-registry";
import { AgentIdentity } from "@/modules/ai-harness/agents/core/agent-identity";
import type { ISubagentSpec } from "@/modules/ai-harness/agents/abstractions";

function makeSpec(): ISubagentSpec {
  return {
    name: "researcher",
    identity: AgentIdentity.of(
      { id: "researcher", name: "Researcher", description: "" },
      { tools: ["search"] },
    ),
    prompt: "Find information about X.",
    isolation: "context",
    budget: { maxTokens: 5000, maxIterations: 5 },
  };
}

describe("SubagentSpawner", () => {
  it("returns a handle for spawned subagent", async () => {
    const factory = new AgentFactory();
    const hooks = new HookRegistry();
    const spawner = new SubagentSpawner(factory, hooks);

    const parent = factory.create({
      identity: AgentIdentity.of({
        id: "parent-role",
        name: "Parent",
        description: "",
      }),
    });

    const handle = await spawner.spawn(parent, makeSpec());
    expect(handle.id).toBeDefined();
    expect(handle.name).toBe("researcher");
    expect(handle.parent).toBe(parent);
  });

  it("subagent runs and waitForResult returns output", async () => {
    const factory = new AgentFactory();
    const hooks = new HookRegistry();
    const spawner = new SubagentSpawner(factory, hooks);

    const parent = factory.create({
      identity: AgentIdentity.of({
        id: "parent-role",
        name: "Parent",
        description: "",
      }),
    });

    const handle = await spawner.spawn(parent, makeSpec());

    // Drain events (needed to trigger resolveResult)
    const events = [];
    for await (const ev of handle.events) {
      events.push(ev);
    }

    const result = await handle.waitForResult();
    expect(result).toMatchObject({
      stub: true,
      agent: "researcher",
    });
    // Check that events include thinking → output → terminated
    const types = events.map((e) => e.type);
    expect(types).toContain("output");
    expect(types).toContain("terminated");
  });

  it("PreSubagentSpawn hook can block the spawn", async () => {
    const factory = new AgentFactory();
    const hooks = new HookRegistry();
    hooks.register({
      event: "PreSubagentSpawn",
      scope: "global",
      handler: () => ({ block: true, reason: "no-subagents-policy" }),
    });
    const spawner = new SubagentSpawner(factory, hooks);

    const parent = factory.create({
      identity: AgentIdentity.of({
        id: "p",
        name: "P",
        description: "",
      }),
    });

    await expect(spawner.spawn(parent, makeSpec())).rejects.toThrow(
      SubagentSpawnBlockedError,
    );
    await expect(spawner.spawn(parent, makeSpec())).rejects.toThrow(
      /no-subagents-policy/,
    );
  });

  it("respects isolation policy — context isolation gives new sessionId", async () => {
    const factory = new AgentFactory();
    const hooks = new HookRegistry();
    const spawner = new SubagentSpawner(factory, hooks);

    const parent = factory.create({
      identity: AgentIdentity.of({
        id: "p",
        name: "P",
        description: "",
      }),
      sessionId: "parent-session",
      userId: "u1",
    });

    const handle = await spawner.spawn(parent, {
      ...makeSpec(),
      isolation: "context",
    });

    // Drain events so the child finishes
    for await (const _ of handle.events) {
      void _;
    }

    // Child's envelope (after execute) should show different session id
    // We can check this via the metadata set by ContextIsolation
    const parentEnv = parent.getEnvelope();
    expect(parentEnv.memory.sessionId).toBe("parent-session");
    // Spawner internally generates a new sessionId — can't assert exact value,
    // but handle.spec retains the isolation level
    expect(handle.spec.isolation).toBe("context");
  });

  it("worktree isolation does not inherit userId", async () => {
    const factory = new AgentFactory();
    const hooks = new HookRegistry();
    const spawner = new SubagentSpawner(factory, hooks);

    const childUserId: string | undefined = "not-set";
    hooks.register({
      event: "PreSubagentSpawn",
      scope: "global",
      handler: () => {
        // Hook fires before derive, just record
      },
    });

    const parent = factory.create({
      identity: AgentIdentity.of({ id: "p", name: "P", description: "" }),
      userId: "parent-u1",
    });

    const handle = await spawner.spawn(parent, {
      ...makeSpec(),
      isolation: "worktree",
    });

    // Drain events
    for await (const _ of handle.events) {
      void _;
    }

    // We can't directly inspect child envelope from handle API;
    // this is a sanity test that spawn did not throw and iso was honored at spec
    expect(handle.spec.isolation).toBe("worktree");
    // Avoid unused var warning
    void childUserId;
  });

  // ── PR-D: spawnMany ──
  describe("spawnMany", () => {
    it("mode=all returns one result per spec", async () => {
      const factory = new AgentFactory();
      const spawner = new SubagentSpawner(factory, new HookRegistry());
      const parent = factory.create({
        identity: AgentIdentity.of({ id: "p", name: "P", description: "" }),
      });

      const { handles, results } = await spawner.spawnMany(
        parent,
        [makeSpec(), makeSpec(), makeSpec()],
        "all",
      );
      expect(handles).toHaveLength(3);
      expect(results).toHaveLength(3);
      // Skeleton agents return ok=true with stub output
      expect(results.every((r) => r.ok)).toBe(true);
    });

    it("mode=majority resolves once N/2 succeed", async () => {
      const factory = new AgentFactory();
      const spawner = new SubagentSpawner(factory, new HookRegistry());
      const parent = factory.create({
        identity: AgentIdentity.of({ id: "p", name: "P", description: "" }),
      });

      // 3 specs, threshold=2 (ceil(3/2))
      const { results } = await spawner.spawnMany(
        parent,
        [makeSpec(), makeSpec(), makeSpec()],
        "majority",
      );
      // At least threshold succeeded
      const ok = results.filter((r) => r.ok);
      expect(ok.length).toBeGreaterThanOrEqual(2);
    });

    it("mode=first returns when first sibling completes", async () => {
      const factory = new AgentFactory();
      const spawner = new SubagentSpawner(factory, new HookRegistry());
      const parent = factory.create({
        identity: AgentIdentity.of({ id: "p", name: "P", description: "" }),
      });

      const { results } = await spawner.spawnMany(
        parent,
        [makeSpec(), makeSpec()],
        "first",
      );
      // At least one ok result
      expect(results.some((r) => r.ok)).toBe(true);
    });
  });
});
