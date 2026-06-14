/**
 * Framework spec：BusinessTeamRerunOrchestratorFramework
 *
 * 验证 framework 真可被复用：fake MarsTeam 子类提供 source resolver / cloneInput /
 * runMission / emit hooks，framework 应正确编排 guard → status whitelist → ownership →
 * checkpoint clone → emit → fire-and-forget。
 */

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  FakeMarsRerunOrchestrator,
  makeFakeOrchestratorHooks,
  type MarsSourceMission,
  type MarsTodoBody,
} from "./__fixtures__/p5-fake-team-mocks";

const baseSource: MarsSourceMission = {
  id: "src-1",
  status: "completed",
  topic: "mars topic",
  userId: "u1",
};

// helper to flush queued microtasks (fire-and-forget runMission)
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

describe("BusinessTeamRerunOrchestratorFramework (fake MarsTeam)", () => {
  it("ensureRerunable throws → propagated (in-flight rejection)", async () => {
    const hooks = makeFakeOrchestratorHooks({
      ensureRerunableThrow: new BadRequestException("in-flight"),
    });
    await expect(
      new FakeMarsRerunOrchestrator(hooks, "mars").run({
        sourceMissionId: "src-1",
        userId: "u1",
      }),
    ).rejects.toThrow(/in-flight/);
  });

  it("source not found → ForbiddenException", async () => {
    const hooks = makeFakeOrchestratorHooks({ source: null });
    await expect(
      new FakeMarsRerunOrchestrator(hooks, "mars").run({
        sourceMissionId: "src-1",
        userId: "u1",
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("source status not in whitelist → BadRequestException", async () => {
    const hooks = makeFakeOrchestratorHooks({
      source: { ...baseSource, status: "running" },
    });
    await expect(
      new FakeMarsRerunOrchestrator(hooks, "mars").run({
        sourceMissionId: "src-1",
        userId: "u1",
      }),
    ).rejects.toThrow(/cannot be rerun from status "running"/);
  });

  it("incremental mode: clone checkpoint + inheritFromMissionId set", async () => {
    const cloneCheckpoint = jest.fn().mockResolvedValue(true);
    const hooks = makeFakeOrchestratorHooks({
      source: baseSource,
      cloneCheckpoint,
    });
    const r = await new FakeMarsRerunOrchestrator(hooks, "mars").run({
      sourceMissionId: "src-1",
      userId: "u1",
      mode: "incremental",
    });
    expect(r.streamNamespace).toBe("mars");
    expect(r.missionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(cloneCheckpoint).toHaveBeenCalledWith("src-1", r.missionId);
    expect(hooks.cloneInput).toHaveBeenCalledWith(
      baseSource,
      expect.objectContaining({ inheritFromMissionId: "src-1" }),
    );
    await flush();
    expect(hooks.runMission).toHaveBeenCalled();
  });

  it("fresh mode: no checkpoint clone + no inheritFromMissionId", async () => {
    const cloneCheckpoint = jest.fn().mockResolvedValue(true);
    const hooks = makeFakeOrchestratorHooks({
      source: baseSource,
      cloneCheckpoint,
    });
    await new FakeMarsRerunOrchestrator(hooks, "mars").run({
      sourceMissionId: "src-1",
      userId: "u1",
      mode: "fresh",
    });
    expect(cloneCheckpoint).not.toHaveBeenCalled();
    expect(hooks.cloneInput).toHaveBeenCalledWith(
      baseSource,
      expect.objectContaining({ inheritFromMissionId: undefined }),
    );
  });

  it("ownership.assign called with newMissionId + userId", async () => {
    const hooks = makeFakeOrchestratorHooks({ source: baseSource });
    const r = await new FakeMarsRerunOrchestrator(hooks, "mars").run({
      sourceMissionId: "src-1",
      userId: "u1",
      mode: "fresh",
    });
    expect(hooks.assignOwnership).toHaveBeenCalledWith(r.missionId, "u1");
  });

  it("runMission throw → caught (fire-and-forget) — no rejection from rerunFullMission", async () => {
    const runMission = jest
      .fn()
      .mockRejectedValue(new Error("dispatcher boom"));
    const hooks = makeFakeOrchestratorHooks({ source: baseSource, runMission });
    await expect(
      new FakeMarsRerunOrchestrator(hooks, "mars").run({
        sourceMissionId: "src-1",
        userId: "u1",
        mode: "fresh",
      }),
    ).resolves.toBeDefined();
    await flush();
    expect(runMission).toHaveBeenCalled();
  });

  it("rerunFromTodo: emits manual-rerun-from-todo with business payload", async () => {
    const emit = jest.fn().mockResolvedValue(undefined);
    const hooks = makeFakeOrchestratorHooks({ source: baseSource, emit });
    const orchestrator = new FakeMarsRerunOrchestrator(hooks, "mars");
    const todoBody: MarsTodoBody = {
      origin: "user-clicked",
      reason: "wrong dimension",
    };
    const r = await orchestrator.runFromTodo(
      {
        sourceMissionId: "src-1",
        userId: "u1",
        todoId: "todo-99",
        todoBody,
      },
      (b) => ({ origin: b.origin, reason: b.reason }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "mars.mission:manual-rerun-from-todo",
        missionId: r.missionId,
        userId: "u1",
        payload: expect.objectContaining({
          sourceMissionId: "src-1",
          sourceTodoId: "todo-99",
          origin: "user-clicked",
          reason: "wrong dimension",
        }),
      }),
    );
  });

  it("rerunFromTodo: extractTopicOverride applied (business focused-topic logic)", async () => {
    const hooks = makeFakeOrchestratorHooks({ source: baseSource });
    await new FakeMarsRerunOrchestrator(hooks, "mars").runFromTodo(
      {
        sourceMissionId: "src-1",
        userId: "u1",
        todoId: "t1",
        todoBody: { origin: "x", reason: "y" },
      },
      () => ({}),
      (_b, src) => `${src}::focused`,
    );
    expect(hooks.cloneInput).toHaveBeenCalledWith(
      baseSource,
      expect.objectContaining({ topic: "mars topic::focused" }),
    );
  });

  it("rerunFromTodo: default topic clamps to topicLimit", async () => {
    const longTopic = "a".repeat(500);
    const hooks = makeFakeOrchestratorHooks({
      source: { ...baseSource, topic: longTopic },
    });
    await new FakeMarsRerunOrchestrator(hooks, "mars").runFromTodo(
      {
        sourceMissionId: "src-1",
        userId: "u1",
        todoId: "t1",
        todoBody: { origin: "x", reason: "y" },
      },
      () => ({}),
      undefined,
      100,
    );
    expect(hooks.cloneInput).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ topic: "a".repeat(100) }),
    );
  });
});
