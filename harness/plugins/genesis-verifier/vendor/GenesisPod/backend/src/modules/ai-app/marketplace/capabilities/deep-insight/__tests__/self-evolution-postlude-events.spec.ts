/**
 * self-evolution-postlude-events.spec — postlude 事件发射面（审计 #21 + 矩阵表 2 末行）
 *
 * 验证（直接驱动 fireSelfEvolutionPostlude，不跑完整 runner）：
 *   1. recordPostmortem 成功后发 memory:indexed（chunks/namespace/tags，
 *      与前端 dvDeriveMemoryFromEvents 读取面一致）。
 *   2. s12 不在 orchestrator steps → postlude 自桥 stage:lifecycle
 *      started/completed（失败路径 failed）。
 *   3. recordPostmortem 缺失或抛错时不发 memory:indexed（没索引就不谎报）。
 *
 * R1 隔离：零 ai-app/playground import（payload 形状契约在
 * playground/events/__tests__/event-schema-contract.spec.ts 锁）。
 */
import type { CapabilityRunEvent } from "../../../capability/capability-runner.port";
import {
  fireSelfEvolutionPostlude,
  type SelfEvolutionPostludeInput,
} from "../postlude/self-evolution.postlude";

interface DomainEventRecord {
  event: string;
  data: Record<string, unknown>;
}

function makeDeps() {
  return {
    postmortemClassifier: {
      classify: jest.fn(() => ({
        mode: "success" as const,
        signals: [],
        confidence: 1,
      })),
    } as never,
    log: {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as never,
  };
}

function collectDomainEvents(): {
  onEvent: (e: CapabilityRunEvent) => void;
  events: DomainEventRecord[];
} {
  const events: DomainEventRecord[] = [];
  const onEvent = (e: CapabilityRunEvent): void => {
    if (e.type !== "domain") return;
    const p = e.payload as
      | { event?: string; data?: Record<string, unknown> }
      | undefined;
    if (p?.event) events.push({ event: p.event, data: p.data ?? {} });
  };
  return { onEvent, events };
}

function makeInput(
  overrides: Partial<SelfEvolutionPostludeInput> = {},
): SelfEvolutionPostludeInput {
  return {
    missionId: "m-ev-1",
    userId: "u-ev-1",
    topic: "事件面测试",
    leaderSignOff: { signed: true },
    reportArtifact: { quality: { overall: 90 } },
    plan: { dimensions: [], goals: { qualityBar: { minCoverage: 80 } } },
    tokensUsed: 100,
    costCents: 10,
    startedAt: Date.now() - 1000,
    persistence: {
      markStageProgress: () => Promise.resolve(),
      saveCheckpoint: () => Promise.resolve(true),
      loadCheckpoint: () => Promise.resolve(null),
      clearCheckpoint: () => Promise.resolve(),
      applyTerminalIfRunning: () => Promise.resolve(true),
      recordPostmortem: jest.fn().mockResolvedValue(undefined),
    } as never,
    bufferedEvents: [],
    ...overrides,
  };
}

/** fire-and-forget Promise flush。 */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

describe("S12 postlude 事件发射面", () => {
  it("recordPostmortem 成功 → 发 memory:indexed { chunks: 1, namespace, tags }", async () => {
    const { onEvent, events } = collectDomainEvents();
    fireSelfEvolutionPostlude(makeInput({ onEvent }), makeDeps());
    await flushAsync();

    const indexed = events.filter((e) => e.event === "memory:indexed");
    expect(indexed).toHaveLength(1);
    // 字段名与前端 dvDeriveMemoryFromEvents 读取面一致（chunks 必须是 number）。
    expect(indexed[0].data).toEqual({
      chunks: 1,
      namespace: "harness_vector_memory",
      tags: ["deep-insight", "mission-postmortem", "signed"],
    });
  });

  it("自桥 s12 stage:lifecycle started → completed（拓扑节点不再恒 idle）", async () => {
    const { onEvent, events } = collectDomainEvents();
    fireSelfEvolutionPostlude(makeInput({ onEvent }), makeDeps());
    await flushAsync();

    const lifecycle = events.filter((e) => e.event === "stage:lifecycle");
    expect(lifecycle.map((e) => e.data.status)).toEqual([
      "started",
      "completed",
    ]);
    for (const e of lifecycle) {
      expect(e.data.stepId).toBe("s12-self-evolution");
      expect(e.data.stage).toBe("s12-self-evolution");
    }
  });

  it("recordPostmortem 抛错 → 不发 memory:indexed，postlude 仍 completed 收尾", async () => {
    const { onEvent, events } = collectDomainEvents();
    fireSelfEvolutionPostlude(
      makeInput({
        onEvent,
        persistence: {
          markStageProgress: () => Promise.resolve(),
          saveCheckpoint: () => Promise.resolve(true),
          loadCheckpoint: () => Promise.resolve(null),
          clearCheckpoint: () => Promise.resolve(),
          applyTerminalIfRunning: () => Promise.resolve(true),
          recordPostmortem: jest
            .fn()
            .mockRejectedValue(new Error("vector DB down")),
        } as never,
      }),
      makeDeps(),
    );
    await flushAsync();

    expect(events.some((e) => e.event === "memory:indexed")).toBe(false);
    // 写入失败是 non-fatal：postlude 本身照常 completed。
    expect(events.some((e) => e.event === "mission:postlude:completed")).toBe(
      true,
    );
    const lifecycle = events.filter((e) => e.event === "stage:lifecycle");
    expect(lifecycle.map((e) => e.data.status)).toEqual([
      "started",
      "completed",
    ]);
  });

  it("persistence 未实现 recordPostmortem → 不发 memory:indexed", async () => {
    const { onEvent, events } = collectDomainEvents();
    fireSelfEvolutionPostlude(
      makeInput({
        onEvent,
        persistence: {
          markStageProgress: () => Promise.resolve(),
          saveCheckpoint: () => Promise.resolve(true),
          loadCheckpoint: () => Promise.resolve(null),
          clearCheckpoint: () => Promise.resolve(),
          applyTerminalIfRunning: () => Promise.resolve(true),
        } as never,
      }),
      makeDeps(),
    );
    await flushAsync();

    expect(events.some((e) => e.event === "memory:indexed")).toBe(false);
    expect(events.some((e) => e.event === "mission:postlude:completed")).toBe(
      true,
    );
  });

  it("postlude 主体抛错 → stage:lifecycle failed（含 error）+ mission:postlude:failed", async () => {
    const { onEvent, events } = collectDomainEvents();
    const deps = makeDeps();
    (
      deps.postmortemClassifier as unknown as { classify: jest.Mock }
    ).classify.mockImplementation(() => {
      throw new Error("classifier 崩溃");
    });
    fireSelfEvolutionPostlude(makeInput({ onEvent }), deps);
    await flushAsync();

    expect(events.some((e) => e.event === "mission:postlude:failed")).toBe(
      true,
    );
    const lifecycle = events.filter((e) => e.event === "stage:lifecycle");
    expect(lifecycle.map((e) => e.data.status)).toEqual(["started", "failed"]);
    expect(lifecycle[1].data.error).toBe("classifier 崩溃");
  });
});
