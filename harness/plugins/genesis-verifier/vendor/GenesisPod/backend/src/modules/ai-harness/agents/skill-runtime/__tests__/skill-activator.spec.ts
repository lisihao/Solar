/**
 * SkillActivator 单元测试
 */

import { SkillActivator } from "../skill-activator";
import { BuiltinSkillCatalog } from "../skill-registry";
import { HookRegistry } from "../../core/hook-registry";
import { ContextEnvelope } from "../../core/context-envelope";
import { AgentIdentity } from "../../core/agent-identity";
import type { ISkill, IAgentIdentity } from "../../abstractions";

function makeEnv(): ContextEnvelope {
  return new ContextEnvelope({
    system: "sys",
    messages: [],
    reminders: [],
    tools: [],
    memory: { sessionId: "s1", userId: "u1" },
    budget: {
      tokensUsed: 0,
      tokensRemaining: 1000,
      iterationsUsed: 0,
      iterationsRemaining: 10,
      wallTimeStartMs: Date.now(),
    },
  });
}

function makeSkill(
  name: string,
  opts: {
    instructions?: string;
    activate?: ISkill["activate"];
  } = {},
): ISkill {
  return {
    frontmatter: { name, description: `desc ${name}` },
    instructions: opts.instructions ?? `body of ${name}`,
    activate: opts.activate,
  };
}

function makeIdentity(skills: string[]): IAgentIdentity {
  return AgentIdentity.of(
    { id: "r1", name: "Role", description: "d" },
    { skills },
  );
}

describe("SkillActivator", () => {
  it("returns envelope unchanged when identity has no skills", async () => {
    const registry = new BuiltinSkillCatalog();
    const activator = new SkillActivator(registry, new HookRegistry());
    const env = makeEnv();
    const result = await activator.activate(makeIdentity([]), env);
    expect(result.envelope).toBe(env);
    expect(result.activatedSkills).toEqual([]);
  });

  it("injects skill instructions as high-priority reminders", async () => {
    const registry = new BuiltinSkillCatalog();
    registry.register(makeSkill("s1", { instructions: "do s1" }));
    registry.register(makeSkill("s2", { instructions: "do s2" }));

    const activator = new SkillActivator(registry, new HookRegistry());
    const env = makeEnv();
    const result = await activator.activate(makeIdentity(["s1", "s2"]), env);

    expect(result.activatedSkills).toEqual(["s1", "s2"]);
    expect(result.envelope.reminders).toHaveLength(2);
    expect(result.envelope.reminders[0].priority).toBe("high");
    expect(result.envelope.reminders[0].content).toContain("do s1");
    expect(result.envelope.reminders[1].content).toContain("do s2");
  });

  it("skips missing skills with a warning", async () => {
    const registry = new BuiltinSkillCatalog();
    registry.register(makeSkill("exists"));
    const activator = new SkillActivator(registry, new HookRegistry());
    const env = makeEnv();
    const result = await activator.activate(
      makeIdentity(["exists", "missing"]),
      env,
    );
    expect(result.activatedSkills).toEqual(["exists"]);
  });

  it("calls skill.activate() and allows adding reminders", async () => {
    const registry = new BuiltinSkillCatalog();
    registry.register(
      makeSkill("s1", {
        activate: (ctx) => {
          ctx.addReminder("extra note", "low");
        },
      }),
    );
    const activator = new SkillActivator(registry, new HookRegistry());
    const env = makeEnv();
    const result = await activator.activate(makeIdentity(["s1"]), env);
    const contents = result.envelope.reminders.map((r) => r.content);
    expect(contents.some((c) => c.includes("body of s1"))).toBe(true);
    expect(contents.some((c) => c.includes("extra note"))).toBe(true);
  });

  it("skill.activate can register temporary hooks; cleanup removes them", async () => {
    const hooks = new HookRegistry();
    const registry = new BuiltinSkillCatalog();
    const handler = jest.fn();
    registry.register(
      makeSkill("s1", {
        activate: (ctx) => {
          ctx.registerHook({
            event: "Stop",
            scope: "skill",
            handler,
          });
        },
      }),
    );
    const activator = new SkillActivator(registry, hooks);
    const result = await activator.activate(makeIdentity(["s1"]), makeEnv());

    // Hook should fire before cleanup
    await hooks.dispatch(
      "Stop",
      { reason: "completed" },
      { agentId: "a1", envelope: makeEnv() },
    );
    expect(handler).toHaveBeenCalledTimes(1);

    // Cleanup then dispatch again
    result.cleanup();
    await hooks.dispatch(
      "Stop",
      { reason: "completed" },
      { agentId: "a1", envelope: makeEnv() },
    );
    expect(handler).toHaveBeenCalledTimes(1); // unchanged
  });

  it("activate() errors in one skill do not prevent subsequent skills", async () => {
    const registry = new BuiltinSkillCatalog();
    registry.register(
      makeSkill("bad", {
        activate: () => {
          throw new Error("boom");
        },
      }),
    );
    registry.register(makeSkill("good", { instructions: "good body" }));
    const activator = new SkillActivator(registry, new HookRegistry());
    const result = await activator.activate(
      makeIdentity(["bad", "good"]),
      makeEnv(),
    );
    expect(result.activatedSkills).toEqual(["bad", "good"]);
    expect(
      result.envelope.reminders.some((r) => r.content.includes("good body")),
    ).toBe(true);
  });

  // ─── ISkillProvider fallback (PR-X-K, 2026-05-01) ────────────────────────────
  describe("ISkillProvider fallback (用户自定义 skill)", () => {
    it("falls back to provider when not found in built-in registry", async () => {
      const registry = new BuiltinSkillCatalog();
      const provider = {
        id: "test-provider",
        resolveByName: jest.fn((name: string) =>
          name === "user-skill"
            ? makeSkill("user-skill", { instructions: "user body" })
            : null,
        ),
      };
      const activator = new SkillActivator(registry, new HookRegistry(), [
        provider,
      ]);
      const result = await activator.activate(
        makeIdentity(["user-skill"]),
        makeEnv(),
      );
      expect(provider.resolveByName).toHaveBeenCalledWith("user-skill");
      expect(result.activatedSkills).toEqual(["user-skill"]);
      expect(
        result.envelope.reminders.some((r) => r.content.includes("user body")),
      ).toBe(true);
    });

    it("built-in wins over provider for same name", async () => {
      const registry = new BuiltinSkillCatalog();
      registry.register(makeSkill("shared", { instructions: "built-in body" }));
      const provider = {
        id: "test-provider",
        resolveByName: jest.fn(() =>
          makeSkill("shared", { instructions: "user body" }),
        ),
      };
      const activator = new SkillActivator(registry, new HookRegistry(), [
        provider,
      ]);
      const result = await activator.activate(
        makeIdentity(["shared"]),
        makeEnv(),
      );
      expect(provider.resolveByName).not.toHaveBeenCalled();
      expect(
        result.envelope.reminders.some((r) =>
          r.content.includes("built-in body"),
        ),
      ).toBe(true);
    });

    it("multiple providers queried in order; first hit wins", async () => {
      const registry = new BuiltinSkillCatalog();
      const p1 = {
        id: "p1",
        resolveByName: jest.fn(() => null),
      };
      const p2 = {
        id: "p2",
        resolveByName: jest.fn(() =>
          makeSkill("k", { instructions: "from p2" }),
        ),
      };
      const p3 = {
        id: "p3",
        resolveByName: jest.fn(() =>
          makeSkill("k", { instructions: "from p3" }),
        ),
      };
      const activator = new SkillActivator(registry, new HookRegistry(), [
        p1,
        p2,
        p3,
      ]);
      const result = await activator.activate(makeIdentity(["k"]), makeEnv());
      expect(p1.resolveByName).toHaveBeenCalled();
      expect(p2.resolveByName).toHaveBeenCalled();
      expect(p3.resolveByName).not.toHaveBeenCalled();
      expect(
        result.envelope.reminders.some((r) => r.content.includes("from p2")),
      ).toBe(true);
    });

    it("provider thrown error skipped; remaining providers still queried", async () => {
      const registry = new BuiltinSkillCatalog();
      const p1 = {
        id: "p1",
        resolveByName: jest.fn(() => {
          throw new Error("boom");
        }),
      };
      const p2 = {
        id: "p2",
        resolveByName: jest.fn(() =>
          makeSkill("k", { instructions: "rescued" }),
        ),
      };
      const activator = new SkillActivator(registry, new HookRegistry(), [
        p1,
        p2,
      ]);
      const result = await activator.activate(makeIdentity(["k"]), makeEnv());
      expect(p1.resolveByName).toHaveBeenCalled();
      expect(p2.resolveByName).toHaveBeenCalled();
      expect(
        result.envelope.reminders.some((r) => r.content.includes("rescued")),
      ).toBe(true);
    });

    it("supports async provider (Promise<ISkill | null>)", async () => {
      const registry = new BuiltinSkillCatalog();
      const provider = {
        id: "async-provider",
        resolveByName: jest.fn(
          (name: string) =>
            new Promise<ISkill | null>((resolve) =>
              setTimeout(() => {
                resolve(
                  name === "k"
                    ? makeSkill("k", { instructions: "async body" })
                    : null,
                );
              }, 1),
            ),
        ),
      };
      const activator = new SkillActivator(registry, new HookRegistry(), [
        provider,
      ]);
      const result = await activator.activate(makeIdentity(["k"]), makeEnv());
      expect(
        result.envelope.reminders.some((r) => r.content.includes("async body")),
      ).toBe(true);
    });

    it("when no provider matches, skill is still skipped + warned", async () => {
      const registry = new BuiltinSkillCatalog();
      const provider = {
        id: "p",
        resolveByName: jest.fn(() => null),
      };
      const activator = new SkillActivator(registry, new HookRegistry(), [
        provider,
      ]);
      const result = await activator.activate(
        makeIdentity(["unknown"]),
        makeEnv(),
      );
      expect(provider.resolveByName).toHaveBeenCalledWith("unknown");
      expect(result.activatedSkills).toEqual([]);
    });
  });
});


