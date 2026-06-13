/**
 * BusinessTeamMissionDispatcherFramework spec —— 验证：
 *   - emitToBus 用注入的 type / namespace 调 eventBus.emit；emit 失败时 log warn 不抛
 *   - bridgeOrchestratorStageEvent 把 stage:started/completed/failed 翻成
 *     `stageLifecycleEvent` 携带 status + stepId + primitive + output；
 *   - stage:stalled → stageStalledEvent；stage:degraded → stageDegradedEvent
 *   - 缺 stepId → return false（业务方自己处理）
 *   - mapStepId 注入后 stage 字段用映射结果；缺省时 stage 字段 = stepId
 */

import {
  BusinessTeamMissionDispatcherFramework,
  type BridgeContext,
} from "../business-team-mission-dispatcher.framework";

type EmitArgs = {
  type: string;
  scope: { missionId: string; userId: string };
  payload: unknown;
  timestamp?: number;
};

class TestDispatcher extends BusinessTeamMissionDispatcherFramework {
  // expose protected methods for spec
  emit(args: Parameters<TestDispatcher["emitToBus"]>[0]) {
    return this.emitToBus(args);
  }
  bridge(
    event: Parameters<TestDispatcher["bridgeOrchestratorStageEvent"]>[0],
    ctx: BridgeContext,
  ) {
    return this.bridgeOrchestratorStageEvent(event, ctx);
  }
}

describe("BusinessTeamMissionDispatcherFramework", () => {
  let emitted: EmitArgs[] = [];
  const eventBus = {
    emit: jest.fn(async (e: EmitArgs) => {
      emitted.push(e);
    }),
  } as unknown as ConstructorParameters<typeof TestDispatcher>[0];

  beforeEach(() => {
    emitted = [];
    (eventBus.emit as jest.Mock).mockClear();
  });

  describe("emitToBus", () => {
    it("calls eventBus.emit with namespaced scope and payload", async () => {
      const d = new TestDispatcher(eventBus, {
        namespace: "myapp",
        stageLifecycleEvent: "myapp.stage:lifecycle",
        stageStalledEvent: "myapp.stage:stalled",
        stageDegradedEvent: "myapp.stage:degraded",
      });
      await d.emit({
        type: "myapp.mission:foo",
        missionId: "m1",
        userId: "u1",
        payload: { x: 1 },
      });
      expect(emitted).toHaveLength(1);
      expect(emitted[0].type).toBe("myapp.mission:foo");
      expect(emitted[0].scope).toEqual({ missionId: "m1", userId: "u1" });
      expect(emitted[0].payload).toEqual({ x: 1 });
    });

    it("does not throw when eventBus.emit rejects", async () => {
      const bus = {
        emit: jest.fn(async () => {
          throw new Error("bus down");
        }),
      } as unknown as ConstructorParameters<typeof TestDispatcher>[0];
      const d = new TestDispatcher(bus, {
        namespace: "myapp",
        stageLifecycleEvent: "x",
        stageStalledEvent: "y",
        stageDegradedEvent: "z",
      });
      await expect(
        d.emit({
          type: "myapp.mission:foo",
          missionId: "m1",
          userId: "u1",
          payload: {},
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("bridgeOrchestratorStageEvent", () => {
    const config = {
      namespace: "myapp",
      stageLifecycleEvent: "myapp.stage:lifecycle",
      stageStalledEvent: "myapp.stage:stalled",
      stageDegradedEvent: "myapp.stage:degraded",
    };

    it("returns false and emits nothing when stepId missing", async () => {
      const d = new TestDispatcher(eventBus, config);
      const handled = await d.bridge(
        { type: "stage:started", timestamp: 1 },
        { missionId: "m1", userId: "u1" },
      );
      expect(handled).toBe(false);
      expect(emitted).toHaveLength(0);
    });

    it("bridges stage:started/completed/failed to stageLifecycleEvent with status", async () => {
      const d = new TestDispatcher(eventBus, config);
      await d.bridge(
        {
          type: "stage:started",
          stepId: "s1",
          primitive: "leader-plan",
          timestamp: 100,
        },
        { missionId: "m1", userId: "u1" },
      );
      await d.bridge(
        {
          type: "stage:completed",
          stepId: "s1",
          primitive: "leader-plan",
          output: { dim: 3 },
          timestamp: 200,
        },
        { missionId: "m1", userId: "u1" },
      );
      await d.bridge(
        {
          type: "stage:failed",
          stepId: "s1",
          primitive: "leader-plan",
          error: new Error("boom"),
          timestamp: 300,
        },
        { missionId: "m1", userId: "u1" },
      );
      expect(emitted.map((e) => e.type)).toEqual([
        "myapp.stage:lifecycle",
        "myapp.stage:lifecycle",
        "myapp.stage:lifecycle",
      ]);
      const payloads = emitted.map((e) => e.payload as Record<string, unknown>);
      expect(payloads[0].status).toBe("started");
      expect(payloads[1].status).toBe("completed");
      expect((payloads[1].output as Record<string, unknown>).dim).toBe(3);
      expect(payloads[2].status).toBe("failed");
      expect(payloads[2].error).toBe("boom");
    });

    it("bridges stage:stalled to stageStalledEvent", async () => {
      const d = new TestDispatcher(eventBus, config);
      const handled = await d.bridge(
        {
          type: "stage:stalled",
          stepId: "s2",
          elapsedMs: 5000,
          reason: "no-heartbeat",
          timestamp: 1,
        },
        { missionId: "m1", userId: "u1" },
      );
      expect(handled).toBe(true);
      expect(emitted[0].type).toBe("myapp.stage:stalled");
      expect(emitted[0].payload).toMatchObject({
        stepId: "s2",
        elapsedMs: 5000,
        reason: "no-heartbeat",
      });
    });

    it("bridges stage:degraded to stageDegradedEvent", async () => {
      const d = new TestDispatcher(eventBus, config);
      const handled = await d.bridge(
        {
          type: "stage:degraded",
          stepId: "s3",
          reason: "partial-result",
          timestamp: 1,
        },
        { missionId: "m1", userId: "u1" },
      );
      expect(handled).toBe(true);
      expect(emitted[0].type).toBe("myapp.stage:degraded");
      expect((emitted[0].payload as { reason: string }).reason).toBe(
        "partial-result",
      );
    });

    it("applies mapStepId hook to stage field when configured", async () => {
      const d = new TestDispatcher(eventBus, {
        ...config,
        mapStepId: (s) => `FE_${s}`,
      });
      await d.bridge(
        {
          type: "stage:started",
          stepId: "s2-leader-plan",
          primitive: "leader-plan",
          timestamp: 1,
        },
        { missionId: "m1", userId: "u1" },
      );
      const payload = emitted[0].payload as Record<string, unknown>;
      expect(payload.stage).toBe("FE_s2-leader-plan");
      expect(payload.stepId).toBe("s2-leader-plan");
    });

    it("uses stepId as stage field when no mapStepId provided", async () => {
      const d = new TestDispatcher(eventBus, config);
      await d.bridge(
        { type: "stage:started", stepId: "s2", primitive: "x", timestamp: 1 },
        { missionId: "m1", userId: "u1" },
      );
      const payload = emitted[0].payload as Record<string, unknown>;
      expect(payload.stage).toBe("s2");
    });

    it("returns false for unrelated event types", async () => {
      const d = new TestDispatcher(eventBus, config);
      const handled = await d.bridge(
        {
          type: "mission:aborted",
          stepId: "s3",
          reason: "user_cancelled",
          timestamp: 1,
        },
        { missionId: "m1", userId: "u1" },
      );
      expect(handled).toBe(false);
      expect(emitted).toHaveLength(0);
    });
  });
});
