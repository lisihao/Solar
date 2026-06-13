/**
 * MissionDagService spec —— 验证 graph 构建 + 状态推导 + 级联预览
 */

import { NotFoundException } from "@nestjs/common";
import { MissionDagService } from "../mission-dag.service";
import { MissionStore } from "../../lifecycle/mission-store.service";
import { MissionEventBuffer } from "../../lifecycle/mission-event-buffer.service";
import { PLAYGROUND_PIPELINE } from "../../../runtime/playground.config";

type MissionLike = Awaited<ReturnType<MissionStore["getById"]>>;

function makeMission(
  overrides: Partial<NonNullable<MissionLike>> = {},
): NonNullable<MissionLike> {
  return {
    id: "m-1",
    topic: "Test mission",
    depth: "standard",
    language: "zh-CN",
    status: "running",
    startedAt: new Date(),
    completedAt: null,
    elapsedWallTimeMs: null,
    finalScore: null,
    tokensUsed: null,
    costUsd: null,
    reportTitle: null,
    reportSummary: null,
    errorMessage: null,
    visibility: "PRIVATE" as never,
    terminalOutcome: null,
    failureCode: null,
    configSnapshot: null,
    maxCredits: 1000,
    themeSummary: null,
    dimensions: [],
    reportFull: null,
    verdicts: null,
    trajectoryStored: null,
    reportArtifactVersion: null,
    userProfile: null,
    reconciliationReport: null,
    leaderJournal: null,
    leaderOverallScore: null,
    leaderSigned: null,
    leaderVerdict: null,
    lastCompletedStage: 0,
    outlinePlan: null,
    analystOutput: null,
    heartbeatAt: null,
    ...overrides,
  } as NonNullable<MissionLike>;
}

function buildService(
  mission: NonNullable<MissionLike> | null,
  events: ReadonlyArray<{
    type: string;
    payload: unknown;
    agentId?: string;
    timestamp: number;
  }> = [],
) {
  const store = {
    getById: jest.fn().mockResolvedValue(mission),
  } as unknown as MissionStore;
  const buffer = {
    read: jest.fn().mockReturnValue(events),
  } as unknown as MissionEventBuffer;
  return {
    service: new MissionDagService(store, buffer),
    store,
    buffer,
  };
}

const ALL_STEP_IDS = PLAYGROUND_PIPELINE.steps.map((s) => s.id);

describe("MissionDagService", () => {
  describe("buildGraph", () => {
    it("returns 13 macro nodes (no dim children when dimensions empty)", async () => {
      const { service } = buildService(makeMission({ dimensions: [] }));
      const g = await service.buildGraph("m-1", "u-1");
      const macroIds = g.nodes
        .filter((n) => n.kind !== "research-dim")
        .map((n) => n.id);
      expect(macroIds).toEqual(expect.arrayContaining(ALL_STEP_IDS));
      expect(g.nodes.filter((n) => n.kind === "research-dim")).toHaveLength(0);
    });

    it("expands S3 into per-dimension nodes when dimensions are present", async () => {
      const dims = [
        { id: "d1", name: "投资趋势", rationale: "" },
        { id: "d2", name: "教育 AI", rationale: "" },
        { id: "d3", name: "数据链", rationale: "" },
      ];
      const { service } = buildService(makeMission({ dimensions: dims }));
      const g = await service.buildGraph("m-1", "u-1");
      const dimNodes = g.nodes.filter((n) => n.kind === "research-dim");
      expect(dimNodes).toHaveLength(3);
      expect(dimNodes.map((n) => n.dimensionRef)).toEqual([
        "投资趋势",
        "教育 AI",
        "数据链",
      ]);
      // dim 节点 id 用 stepId::id 格式
      expect(dimNodes[0].id).toBe("s3-researcher-collect::d1");
      // 应有 fan-out 边 s2 → 每个 dim
      const fanFromS2 = g.edges.filter(
        (e) => e.from === "s2-leader-plan" && e.kind === "fan",
      );
      expect(fanFromS2).toHaveLength(3);
      // 应有 fan-in 边 每个 dim → s4
      const fanToS4 = g.edges.filter(
        (e) => e.to === "s4-leader-assess" && e.kind === "fan",
      );
      expect(fanToS4).toHaveLength(3);
    });

    it("derives macro status from lastCompletedStage cursor (running mission)", async () => {
      // running, 已完成 0,1,2 → s1/s2/s3 done; s4 running; rest idle
      const { service } = buildService(
        makeMission({
          status: "running",
          lastCompletedStage: 3,
          dimensions: [],
        }),
      );
      const g = await service.buildGraph("m-1", "u-1");
      const byId = new Map(g.nodes.map((n) => [n.id, n]));
      expect(byId.get("s1-budget")?.status).toBe("done");
      expect(byId.get("s2-leader-plan")?.status).toBe("done");
      expect(byId.get("s3-researcher-collect")?.status).toBe("done");
      expect(byId.get("s4-leader-assess")?.status).toBe("running");
      expect(byId.get("s5-reconciler")?.status).toBe("idle");
      expect(byId.get("s11-persist")?.status).toBe("idle");
    });

    it("marks last touched step as failed when mission.status=failed", async () => {
      const { service } = buildService(
        makeMission({ status: "failed", lastCompletedStage: 2 }),
      );
      const g = await service.buildGraph("m-1", "u-1");
      const byId = new Map(g.nodes.map((n) => [n.id, n]));
      expect(byId.get("s2-leader-plan")?.status).toBe("done");
      expect(byId.get("s3-researcher-collect")?.status).toBe("failed");
      expect(byId.get("s4-leader-assess")?.status).toBe("idle");
    });

    it("marks all stages done when mission.status=completed", async () => {
      const { service } = buildService(
        makeMission({ status: "completed", lastCompletedStage: 12 }),
      );
      const g = await service.buildGraph("m-1", "u-1");
      expect(
        g.nodes
          .filter((n) => n.kind !== "research-dim")
          .every((n) => n.status === "done"),
      ).toBe(true);
    });

    it("includes rewrite-loop and self-loop edges", async () => {
      const { service } = buildService(makeMission());
      const g = await service.buildGraph("m-1", "u-1");
      expect(g.edges.some((e) => e.kind === "rewrite-loop")).toBe(true);
      expect(g.edges.some((e) => e.kind === "self-loop")).toBe(true);
    });

    // ─── Phase 3.1: per-dim 状态独立 ───
    it("derives per-dim status from agent:lifecycle events (running / done / failed)", async () => {
      const dims = [
        { id: "d1", name: "投资", rationale: "" },
        { id: "d2", name: "教育", rationale: "" },
        { id: "d3", name: "数据", rationale: "" },
        { id: "d4", name: "监管", rationale: "" },
      ];
      const events = [
        // d1: started 然后 completed → done
        {
          type: "playground.agent:lifecycle",
          payload: {
            role: "researcher",
            dimension: "投资",
            phase: "started",
          },
          timestamp: 1,
        },
        {
          type: "playground.agent:lifecycle",
          payload: {
            role: "researcher",
            dimension: "投资",
            phase: "completed",
          },
          timestamp: 2,
        },
        // d2: started 没 completed → running
        {
          type: "playground.agent:lifecycle",
          payload: {
            role: "researcher",
            dimension: "教育",
            phase: "started",
          },
          timestamp: 3,
        },
        // d3: failed
        {
          type: "playground.agent:lifecycle",
          payload: {
            role: "researcher",
            dimension: "数据",
            phase: "failed",
          },
          timestamp: 4,
        },
        // d4: 无事件 → 继承父 S3 状态
      ];
      const { service } = buildService(
        makeMission({
          dimensions: dims,
          status: "running",
          lastCompletedStage: 2, // S3 正在跑
        }),
        events,
      );
      const g = await service.buildGraph("m-1", "u-1");
      const byId = new Map(g.nodes.map((n) => [n.id, n]));
      expect(byId.get("s3-researcher-collect::d1")?.status).toBe("done");
      expect(byId.get("s3-researcher-collect::d2")?.status).toBe("running");
      expect(byId.get("s3-researcher-collect::d3")?.status).toBe("failed");
      // d4 无事件,继承父 S3 status = running
      expect(byId.get("s3-researcher-collect::d4")?.status).toBe("running");
    });

    // ─── Phase 3.2: reviewer / 签收节点 score ───
    it("fills reviewer / signoff nodes score from mission fields", async () => {
      const { service } = buildService(
        makeMission({
          status: "completed",
          lastCompletedStage: 12,
          finalScore: 78,
          leaderOverallScore: 82,
        }),
      );
      const g = await service.buildGraph("m-1", "u-1");
      const byId = new Map(g.nodes.map((n) => [n.id, n]));
      expect(byId.get("s9-critic")?.score).toBe(78);
      expect(byId.get("s9b-objective-eval")?.score).toBe(78);
      expect(byId.get("s8b-quality-enhancement")?.score).toBe(78);
      expect(byId.get("s10-leader-foreword-signoff")?.score).toBe(82);
      // 非 reviewer 节点不应有 score
      expect(byId.get("s2-leader-plan")?.score).toBeUndefined();
      expect(byId.get("s11-persist")?.score).toBeUndefined();
    });

    it("marks s1-budget as rerunable=false (预算闸不可重跑)", async () => {
      const { service } = buildService(makeMission());
      const g = await service.buildGraph("m-1", "u-1");
      const s1 = g.nodes.find((n) => n.id === "s1-budget");
      expect(s1?.rerunable).toBe(false);
      expect(s1?.rerunableReason).toMatch(/预算闸/);
    });

    it("throws NotFoundException when mission missing", async () => {
      const { service } = buildService(null);
      await expect(service.buildGraph("missing", "u-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("computeCascade", () => {
    it("returns rerunable=false with reason when origin is s1-budget", async () => {
      const { service } = buildService(makeMission());
      const preview = await service.computeCascade("m-1", "u-1", "s1-budget");
      expect(preview.rerunable).toBe(false);
      expect(preview.reason).toMatch(/预算闸/);
      expect(preview.willRerun).toEqual([]);
    });

    it("returns downstream successors for s2-leader-plan", async () => {
      const { service } = buildService(makeMission());
      const preview = await service.computeCascade(
        "m-1",
        "u-1",
        "s2-leader-plan",
      );
      expect(preview.rerunable).toBe(true);
      // s2 successors 包括 s3..s11
      expect(preview.willRerun).toEqual(
        expect.arrayContaining([
          "s3-researcher-collect",
          "s6-analyst",
          "s8-writer",
          "s11-persist",
        ]),
      );
    });

    it("research-dim rerun cascades to shared downstream only (sibling dims preserved)", async () => {
      // 单维度重跑 = local-rerun scope='dimension' —— 同维度兄弟保留(独立),
      // 共享下游 S4-S11 必须重跑(消费的是整个维度集合的输出)。
      const dims = [
        { id: "d1", name: "投资", rationale: "" },
        { id: "d2", name: "教育", rationale: "" },
      ];
      const { service } = buildService(
        makeMission({ dimensions: dims, lastCompletedStage: 4 }),
      );
      const preview = await service.computeCascade(
        "m-1",
        "u-1",
        "s3-researcher-collect::d1",
      );
      expect(preview.rerunable).toBe(true);
      expect(preview.willRerun).not.toContain("s3-researcher-collect::d1");
      // 兄弟维度不动
      expect(preview.willRerun).not.toContain("s3-researcher-collect::d2");
      // 共享下游全部重跑
      expect(preview.willRerun).toEqual(
        expect.arrayContaining([
          "s4-leader-assess",
          "s8-writer",
          "s11-persist",
        ]),
      );
    });

    it("S2 rerun cascades to ALL dimension research-dim children (S3 stage 重跑 = 所有维度)", async () => {
      // S2 cascade 包含 s3-researcher-collect macro → 应扩展成所有 research-dim 子节点
      const dims = [
        { id: "d1", name: "投资", rationale: "" },
        { id: "d2", name: "教育", rationale: "" },
      ];
      const { service } = buildService(
        makeMission({ dimensions: dims, lastCompletedStage: 1 }),
      );
      const preview = await service.computeCascade(
        "m-1",
        "u-1",
        "s2-leader-plan",
      );
      expect(preview.rerunable).toBe(true);
      expect(preview.willRerun).toEqual(
        expect.arrayContaining([
          "s3-researcher-collect::d1",
          "s3-researcher-collect::d2",
          "s3-researcher-collect",
          "s4-leader-assess",
          "s11-persist",
        ]),
      );
    });

    it("throws NotFoundException when node missing", async () => {
      const { service } = buildService(makeMission());
      await expect(
        service.computeCascade("m-1", "u-1", "ghost-node"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("buildReactSnapshot", () => {
    function evt(
      suffix: string,
      payload: Record<string, unknown>,
      agentId?: string,
    ) {
      return {
        type: `playground.${suffix}`,
        payload,
        agentId,
        timestamp: Date.now(),
      };
    }

    it("returns note for s1-budget (persist primitive, no ReAct)", async () => {
      const { service } = buildService(makeMission());
      const snap = await service.buildReactSnapshot("m-1", "u-1", "s1-budget");
      expect(snap.role).toBe("leader");
      expect(snap.note).toMatch(/预算闸/);
      expect(snap.currentStep).toBe("idle");
    });

    it("returns idle/pending when no agent events yet", async () => {
      const { service } = buildService(makeMission(), []);
      const snap = await service.buildReactSnapshot("m-1", "u-1", "s8-writer");
      expect(snap.role).toBe("writer");
      expect(snap.currentStep).toBe("idle");
      expect(snap.phase).toBe("pending");
      expect(snap.finalizeAttempts).toBe(0);
    });

    it("aggregates last think + action + observation + iter for writer", async () => {
      const events = [
        evt(
          "agent:lifecycle",
          { role: "writer", phase: "started" },
          "writer#1",
        ),
        evt(
          "agent:thought",
          { role: "writer", text: "我需要先列大纲再分章撰写", tokenCount: 12 },
          "writer#1",
        ),
        evt(
          "agent:action",
          { role: "writer", kind: "tool_call", toolName: "rag-search" },
          "writer#1",
        ),
        evt(
          "agent:observation",
          { role: "writer", kind: "result" },
          "writer#1",
        ),
        evt(
          "iteration:progress",
          { role: "writer", iteration: 2, maxIterations: 8 },
          "writer#1",
        ),
      ];
      const { service } = buildService(
        makeMission({ status: "running" }),
        events,
      );
      const snap = await service.buildReactSnapshot("m-1", "u-1", "s8-writer");
      expect(snap.role).toBe("writer");
      expect(snap.agentId).toBe("writer#1");
      expect(snap.iter).toBe(2);
      expect(snap.maxIter).toBe(8);
      expect(snap.lastThought).toMatch(/大纲/);
      expect(snap.lastAction).toEqual({
        kind: "tool_call",
        toolName: "rag-search",
      });
      expect(snap.lastObservation?.kind).toBe("result");
      expect(snap.phase).toBe("running");
      // 最后一条是 iteration:progress,fallback 到 thinking(running 状态)
      expect(snap.currentStep).toBe("thinking");
    });

    it("counts finalize reflection attempts", async () => {
      const events = [
        evt(
          "agent:lifecycle",
          { role: "writer", phase: "started" },
          "writer#1",
        ),
        evt(
          "agent:reflection",
          { role: "writer", score: 50, revision: 1 },
          "writer#1",
        ),
        evt(
          "agent:reflection",
          { role: "writer", score: 65, revision: 2 },
          "writer#1",
        ),
        evt("agent:action", { role: "writer", kind: "finalize" }, "writer#1"),
      ];
      const { service } = buildService(
        makeMission({ status: "running" }),
        events,
      );
      const snap = await service.buildReactSnapshot("m-1", "u-1", "s8-writer");
      expect(snap.finalizeAttempts).toBe(2);
      expect(snap.currentStep).toBe("finalizing");
    });

    it("filters by dimension for research-dim node", async () => {
      const dims = [
        { id: "d1", name: "投资", rationale: "" },
        { id: "d2", name: "教育", rationale: "" },
      ];
      const events = [
        evt(
          "agent:lifecycle",
          { role: "researcher", dimension: "投资", phase: "completed" },
          "r#1",
        ),
        evt(
          "agent:thought",
          { role: "researcher", dimension: "投资", text: "看投资数据" },
          "r#1",
        ),
        evt(
          "agent:thought",
          { role: "researcher", dimension: "教育", text: "看教育数据" },
          "r#2",
        ),
      ];
      const { service } = buildService(
        makeMission({ dimensions: dims }),
        events,
      );
      const snapD1 = await service.buildReactSnapshot(
        "m-1",
        "u-1",
        "s3-researcher-collect::d1",
      );
      expect(snapD1.dimension).toBe("投资");
      expect(snapD1.lastThought).toMatch(/投资/);
      expect(snapD1.phase).toBe("completed");
    });

    it("marks phase=failed when latest lifecycle is failed", async () => {
      const events = [
        evt("agent:lifecycle", { role: "researcher", phase: "started" }, "r#1"),
        evt(
          "agent:error",
          { role: "researcher", message: "tool timeout" },
          "r#1",
        ),
        evt("agent:lifecycle", { role: "researcher", phase: "failed" }, "r#1"),
      ];
      const { service } = buildService(makeMission(), events);
      const snap = await service.buildReactSnapshot(
        "m-1",
        "u-1",
        "s3-researcher-collect",
      );
      expect(snap.phase).toBe("failed");
      expect(snap.currentStep).toBe("failed");
      expect(snap.lastError).toMatch(/tool timeout/);
    });
  });
});
