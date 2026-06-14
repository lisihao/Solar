/**
 * MissionRerunOrchestrator spec（v5.1 R1-D）
 */
import { InMemoryMissionStore } from "../../in-memory";
import {
  MissionRerunOrchestrator,
  type MissionRerunOrchestratorOptions,
} from "../mission-rerun-orchestrator";
import {
  type IMissionRerunPolicy,
  type IMissionRunner,
  RerunNotAllowedError,
  SourceMissionNotFoundError,
} from "../abstractions/mission-rerun.types";
import type { MissionRecord } from "../../abstractions/mission-store.interface";

interface TestInput {
  topic: string;
  depth: "quick" | "deep";
}

function makeRunner(): IMissionRunner<TestInput> & {
  calls: Array<{ missionId: string; input: TestInput; userId: string }>;
  fail?: boolean;
  delayMs?: number;
} {
  const calls: Array<{
    missionId: string;
    input: TestInput;
    userId: string;
  }> = [];
  const r = {
    calls,
    async run(missionId: string, input: TestInput, userId: string) {
      calls.push({ missionId, input, userId });
      if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
      if (r.fail) throw new Error("runner failed");
    },
  } as IMissionRunner<TestInput> & {
    calls: typeof calls;
    fail?: boolean;
    delayMs?: number;
  };
  return r;
}

function makePolicy(): IMissionRerunPolicy<
  TestInput,
  Record<string, unknown>,
  { reject?: string }
> {
  return {
    cloneInput: (record: MissionRecord) => {
      const orig = (record.input ?? {}) as Partial<TestInput>;
      return {
        topic: orig.topic ?? "fallback",
        depth: orig.depth ?? "quick",
      };
    },
    validateTodoRerun: (_record, args) => {
      if (args.body?.reject) {
        throw new RerunNotAllowedError(args.body.reject);
      }
    },
  };
}

async function seedMission(
  store: InMemoryMissionStore,
  opts: {
    missionId: string;
    userId?: string;
    status?: "running" | "completed" | "failed" | "cancelled";
  } = { missionId: "src-1", userId: "u1", status: "completed" },
) {
  await store.create({
    missionId: opts.missionId,
    userId: opts.userId,
    pipelineId: "test",
    input: { topic: "ai agents", depth: "deep" } as TestInput,
  });
  if (opts.status && opts.status !== "running") {
    await store.updateStatus(opts.missionId, { status: opts.status });
  }
}

function makeOrchestrator(
  store: InMemoryMissionStore,
  runner: IMissionRunner<TestInput>,
  policy: IMissionRerunPolicy<
    TestInput,
    Record<string, unknown>,
    { reject?: string }
  >,
  opts: MissionRerunOrchestratorOptions = {},
) {
  let counter = 0;
  return new MissionRerunOrchestrator<
    TestInput,
    Record<string, unknown>,
    { reject?: string }
  >(store, runner, policy, {
    idGenerator: () => `new-${++counter}`,
    ...opts,
  });
}

describe("MissionRerunOrchestrator (v5.1 R1-D)", () => {
  describe("rerunFull", () => {
    it("成功路径：复用原 input + 调 runner.run + 返回新 missionId", async () => {
      const store = new InMemoryMissionStore();
      await seedMission(store);
      const runner = makeRunner();
      const orch = makeOrchestrator(store, runner, makePolicy());

      const result = await orch.rerunFull({
        sourceMissionId: "src-1",
        userId: "u1",
      });
      expect(result.newMissionId).toBe("new-1");
      expect(result.sourceMissionId).toBe("src-1");

      // wait microtask flush（runner.run 被 fire-and-forget）
      await new Promise((r) => setTimeout(r, 0));
      expect(runner.calls).toHaveLength(1);
      expect(runner.calls[0].missionId).toBe("new-1");
      expect(runner.calls[0].input).toEqual({
        topic: "ai agents",
        depth: "deep",
      });
      expect(runner.calls[0].userId).toBe("u1");
    });

    it("source 不存在 → SourceMissionNotFoundError", async () => {
      const store = new InMemoryMissionStore();
      const orch = makeOrchestrator(store, makeRunner(), makePolicy());
      await expect(
        orch.rerunFull({ sourceMissionId: "missing", userId: "u1" }),
      ).rejects.toBeInstanceOf(SourceMissionNotFoundError);
    });

    it("user mismatch → SourceMissionNotFoundError（防 ownership 探测）", async () => {
      const store = new InMemoryMissionStore();
      await seedMission(store, {
        missionId: "src-1",
        userId: "u1",
        status: "completed",
      });
      const orch = makeOrchestrator(store, makeRunner(), makePolicy());
      await expect(
        orch.rerunFull({ sourceMissionId: "src-1", userId: "OTHER" }),
      ).rejects.toBeInstanceOf(SourceMissionNotFoundError);
    });

    it("source mission running → RerunNotAllowedError", async () => {
      const store = new InMemoryMissionStore();
      await seedMission(store, {
        missionId: "src-1",
        userId: "u1",
        status: "running",
      });
      const orch = makeOrchestrator(store, makeRunner(), makePolicy());
      await expect(
        orch.rerunFull({ sourceMissionId: "src-1", userId: "u1" }),
      ).rejects.toBeInstanceOf(RerunNotAllowedError);
    });

    it("policy.validateFullRerun 抛错 → 透传", async () => {
      const store = new InMemoryMissionStore();
      await seedMission(store);
      const policy = makePolicy();
      policy.validateFullRerun = () => {
        throw new RerunNotAllowedError("custom reject");
      };
      const orch = makeOrchestrator(store, makeRunner(), policy);
      await expect(
        orch.rerunFull({ sourceMissionId: "src-1", userId: "u1" }),
      ).rejects.toThrow(/custom reject/);
    });

    it("checkpointCloner 注入 → 调 clone 并 log（清成功）", async () => {
      const store = new InMemoryMissionStore();
      await seedMission(store);
      const cloneCalls: Array<[string, string]> = [];
      const logs: string[] = [];
      const orch = makeOrchestrator(store, makeRunner(), makePolicy(), {
        checkpointCloner: {
          clone: async (src, neu) => {
            cloneCalls.push([src, neu]);
            return true;
          },
        },
        logger: { log: (m) => logs.push(m), error: () => {} },
      });
      await orch.rerunFull({ sourceMissionId: "src-1", userId: "u1" });
      expect(cloneCalls).toEqual([["src-1", "new-1"]]);
      expect(logs.some((l) => l.includes("cloned checkpoint"))).toBe(true);
    });

    it("checkpointCloner.clone reject → silent fallback（不阻塞 rerun）", async () => {
      const store = new InMemoryMissionStore();
      await seedMission(store);
      const orch = makeOrchestrator(store, makeRunner(), makePolicy(), {
        checkpointCloner: {
          clone: async () => {
            throw new Error("redis down");
          },
        },
      });
      const r = await orch.rerunFull({
        sourceMissionId: "src-1",
        userId: "u1",
      });
      expect(r.newMissionId).toBe("new-1");
    });

    it("ownership.assign 注入 → 被调用", async () => {
      const store = new InMemoryMissionStore();
      await seedMission(store);
      const assigns: Array<[string, string]> = [];
      const orch = makeOrchestrator(store, makeRunner(), makePolicy(), {
        ownership: { assign: (m, u) => assigns.push([m, u]) },
      });
      await orch.rerunFull({ sourceMissionId: "src-1", userId: "u1" });
      expect(assigns).toEqual([["new-1", "u1"]]);
    });

    it("runner.run reject → 不透传到 caller（fire-and-forget），但 logger.error 被调", async () => {
      const store = new InMemoryMissionStore();
      await seedMission(store);
      const runner = makeRunner();
      runner.fail = true;
      const errors: string[] = [];
      const orch = makeOrchestrator(store, runner, makePolicy(), {
        logger: { log: () => {}, error: (m) => errors.push(m) },
      });
      const r = await orch.rerunFull({
        sourceMissionId: "src-1",
        userId: "u1",
      });
      expect(r.newMissionId).toBe("new-1");
      // 等 fire-and-forget runner reject 触发 catch
      await new Promise((res) => setTimeout(res, 5));
      expect(errors.some((e) => e.includes("rerun of src-1"))).toBe(true);
    });
  });

  describe("rerunFromTodo", () => {
    it("成功路径", async () => {
      const store = new InMemoryMissionStore();
      await seedMission(store);
      const runner = makeRunner();
      const orch = makeOrchestrator(store, runner, makePolicy());

      const r = await orch.rerunFromTodo({
        sourceMissionId: "src-1",
        userId: "u1",
        todoId: "t1",
        body: {},
      });
      expect(r.newMissionId).toBe("new-1");
      await new Promise((res) => setTimeout(res, 0));
      expect(runner.calls[0].missionId).toBe("new-1");
    });

    it("policy.validateTodoRerun 拒绝 → RerunNotAllowedError", async () => {
      const store = new InMemoryMissionStore();
      await seedMission(store);
      const orch = makeOrchestrator(store, makeRunner(), makePolicy());
      await expect(
        orch.rerunFromTodo({
          sourceMissionId: "src-1",
          userId: "u1",
          todoId: "t1",
          body: { reject: "leader-assess-abort cannot rerun" },
        }),
      ).rejects.toThrow(/leader-assess-abort/);
    });

    it("source running → RerunNotAllowedError", async () => {
      const store = new InMemoryMissionStore();
      await seedMission(store, {
        missionId: "src-1",
        userId: "u1",
        status: "running",
      });
      const orch = makeOrchestrator(store, makeRunner(), makePolicy());
      await expect(
        orch.rerunFromTodo({
          sourceMissionId: "src-1",
          userId: "u1",
          todoId: "t1",
          body: {},
        }),
      ).rejects.toBeInstanceOf(RerunNotAllowedError);
    });

    it("source 不存在 → SourceMissionNotFoundError", async () => {
      const store = new InMemoryMissionStore();
      const orch = makeOrchestrator(store, makeRunner(), makePolicy());
      await expect(
        orch.rerunFromTodo({
          sourceMissionId: "missing",
          userId: "u1",
          todoId: "t1",
          body: {},
        }),
      ).rejects.toBeInstanceOf(SourceMissionNotFoundError);
    });
  });

  describe("system-level mission（无 userId）", () => {
    it("跳过 user 校验，正常 rerun", async () => {
      const store = new InMemoryMissionStore();
      await store.create({
        missionId: "sys-1",
        pipelineId: "test",
        input: { topic: "system", depth: "quick" } as TestInput,
      });
      await store.updateStatus("sys-1", { status: "completed" });
      const runner = makeRunner();
      const orch = makeOrchestrator(store, runner, makePolicy());
      const r = await orch.rerunFull({
        sourceMissionId: "sys-1",
        userId: "anyone",
      });
      expect(r.newMissionId).toBe("new-1");
    });
  });
});
