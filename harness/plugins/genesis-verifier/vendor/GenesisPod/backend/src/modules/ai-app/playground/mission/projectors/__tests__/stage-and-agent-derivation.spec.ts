/**
 * stage-and-agent-derivation.spec.ts
 *
 * 锁定两个核心 derivation：
 *
 * 1. stage-view.projector 识别 prod 的 `stage:lifecycle` 单事件（COLON, status in payload）
 *    —— 之前只识别 fixture 的 `stage.started` (DOT)，prod 跑出来 14 stage 永远 pending。
 *
 * 2. agent-view.projector 从 chapter / dim / leader 业务事件 derive agent 生命周期
 *    —— 之前等不到从未发过的 `agent.started/.completed/.failed/.retry`，导致 view.agents
 *    永远空 / 全 pending，Screenshot_5 实证。
 */

import { projectAgents } from "../agent-view.projector";
import { projectStages } from "../stage-view.projector";

describe("§ stage:lifecycle (prod COLON 单事件) projector 兼容", () => {
  it("payload.status='started' → stage running", () => {
    const stages = projectStages([
      {
        type: "playground.stage:lifecycle",
        payload: { stepId: "s1-budget", status: "started" },
        timestamp: 1700000000000,
      },
    ]);
    const s1 = stages.find((s) => s.id === "s1-budget");
    expect(s1?.status).toBe("running");
  });

  it("status=started → status=completed 转换正确", () => {
    const stages = projectStages([
      {
        type: "playground.stage:lifecycle",
        payload: { stepId: "s2-leader-plan", status: "started" },
        timestamp: 1700000000000,
      },
      {
        type: "playground.stage:lifecycle",
        payload: { stepId: "s2-leader-plan", status: "completed" },
        timestamp: 1700000001000,
      },
    ]);
    const s2 = stages.find((s) => s.id === "s2-leader-plan");
    expect(s2?.status).toBe("done");
  });

  it("status=failed → stage failed + detail", () => {
    const stages = projectStages([
      {
        type: "playground.stage:lifecycle",
        payload: { stepId: "s5-reconciler", status: "failed", error: "X" },
        timestamp: 1700000000000,
      },
    ]);
    const s5 = stages.find((s) => s.id === "s5-reconciler");
    expect(s5?.status).toBe("failed");
  });

  it("旧 DOT 形态（stage.started）继续工作 — fixture 兼容", () => {
    const stages = projectStages([
      {
        type: "stage.started",
        payload: { stepId: "s1-budget" },
        timestamp: 1700000000000,
      },
      {
        type: "stage.completed",
        payload: { stepId: "s1-budget" },
        timestamp: 1700000001000,
      },
    ]);
    expect(stages.find((s) => s.id === "s1-budget")?.status).toBe("done");
  });
});

describe("§ agent-view.projector — derive 生命周期 from 业务事件", () => {
  it("chapter:writing:started + chapter:done with agentId → completed", () => {
    const agents = projectAgents([
      {
        type: "playground.chapter:writing:started",
        agentId: "chapter-writer#0.1.1",
        payload: { dimension: "X", chapterIndex: 1 },
        timestamp: 1700000000000,
      },
      {
        type: "playground.chapter:done",
        agentId: "chapter-writer#0.1.1",
        payload: { dimension: "X", chapterIndex: 1, wordCount: 1200 },
        timestamp: 1700000001000,
      },
    ]);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("chapter-writer#0.1.1");
    expect(agents[0].phase).toBe("completed");
    expect(agents[0].role).toBe("writer"); // from agentId prefix
  });

  it("dim:research:started without explicit completion → still running", () => {
    const agents = projectAgents([
      {
        type: "playground.dimension:research:started",
        agentId: "researcher#0",
        payload: { dimension: "X" },
        timestamp: 1700000000000,
      },
    ]);
    expect(agents[0].phase).toBe("running");
    expect(agents[0].role).toBe("researcher");
  });

  it("chapter:writing:failed → failed", () => {
    const agents = projectAgents([
      {
        type: "playground.chapter:writing:started",
        agentId: "chapter-writer#0.2.1",
        payload: {},
        timestamp: 1700000000000,
      },
      {
        type: "playground.chapter:writing:failed",
        agentId: "chapter-writer#0.2.1",
        payload: { message: "rate-limited" },
        timestamp: 1700000001000,
      },
    ]);
    expect(agents[0].phase).toBe("failed");
    expect(agents[0].failureMessage).toBe("rate-limited");
  });

  it("dim:retrying → retryCount 增加，phase 不被回退到 pending", () => {
    const agents = projectAgents([
      {
        type: "playground.chapter:done",
        agentId: "researcher#0",
        payload: { dimension: "X" },
        timestamp: 1700000000000,
      },
      {
        type: "playground.dimension:retrying",
        agentId: "researcher#0",
        payload: { dimension: "X", reason: "leader-assess-retry" },
        timestamp: 1700000001000,
      },
    ]);
    expect(agents[0].retryCount).toBe(1);
    expect(agents[0].phase).toBe("completed"); // 上一次 completed 不会被 retry 清回 pending
  });

  it("role 从 agentId 前缀派生（payload.role 缺时）", () => {
    const samples: Array<[string, string]> = [
      ["leader", "leader"],
      ["steward", "leader"],
      ["researcher#3", "researcher"],
      ["chapter-writer#0.1.1", "writer"],
      ["chapter-reviewer#0.1.1", "reviewer"],
      ["quality-judge#2", "reviewer"],
      ["mission-critic#0", "reviewer"],
      ["reconciler", "analyst"],
      ["analyst", "analyst"],
    ];
    for (const [agentId, expectedRole] of samples) {
      const agents = projectAgents([
        {
          type: "playground.dimension:research:started",
          agentId,
          payload: {},
          timestamp: 1700000000000,
        },
      ]);
      expect(agents[0].role).toBe(expectedRole);
    }
  });

  it("旧显式 agent.started / agent.completed 形态继续工作 — fixture 兼容", () => {
    const agents = projectAgents([
      {
        type: "agent.started",
        agentId: "leader",
        payload: { role: "leader" },
        timestamp: 1700000000000,
      },
      {
        type: "agent.completed",
        agentId: "leader",
        payload: {},
        timestamp: 1700000001000,
      },
    ]);
    expect(agents[0].phase).toBe("completed");
  });
});
