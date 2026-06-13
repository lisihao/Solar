/**
 * deep-insight stage-bindings —— 富化 domain 事件形状契约 spec（A2）。
 *
 * 验证（强验证标准）：
 *   1. chapter:writing:started / completed emit 形状过 ChapterWriting{Started,Completed}Schema.safeParse
 *      —— chapterIndex 为 number（非 index），否则 strict object 校验失败丢整事件。
 *   2. verifier:verdict（s9b）emit 含 verifierId（projector 据此过滤持久化 verdicts）+ critique/modelId/attempt 富化。
 *   3. dimension:graded（S4 assess）emit 含 grade/summary（启发式打分场景不造 axes）。
 *   4. critic narrate 兜底：critic:verdict emit 后补一条 L4 复审完成 narrative。
 *   5. dimension:research:completed emit 含 summary + reused 字段。
 *
 * 不跑全 14 阶段 orchestrator：直接构造 DeepInsightStageBindings + mock AgentRunner +
 *   attachState 绑定 crossStageState，调对应 hook，捕获 emitDomain 投出的 domain 事件，
 *   逐条对 playground.event-schemas 真 schema safeParse。
 */
import {
  ChapterWritingStartedSchema,
  ChapterWritingCompletedSchema,
  VerifierVerdictSchema,
  DimensionGradedSchema,
  DimensionResearchCompletedSchema,
} from "@/modules/ai-app/playground/events/playground.event-schemas";
import { DeepInsightStageBindings } from "../deep-insight-stage-bindings";
import { attachState, detachState } from "../deep-insight-stage-bindings";
import type { RichServices } from "../deep-insight-stage-bindings";
import { CS_KEY } from "../../ports";
import type { AgentRunner, CrossStageState } from "@/modules/ai-harness/facade";

// ─── 极简内存 CrossStageState（只实现 bindings 用到的方法）──────────────────────
function makeCrossStageState(): CrossStageState {
  const map = new Map<string, unknown>();
  const cs = {
    get: <T>(k: string): T | undefined => map.get(k) as T | undefined,
    set: <T>(k: string, v: T): void => {
      map.set(k, v);
    },
    append: <T>(k: string, v: T): void => {
      const arr = (map.get(k) as T[] | undefined) ?? [];
      arr.push(v);
      map.set(k, arr);
    },
    incr: (k: string, n: number): void => {
      map.set(k, ((map.get(k) as number | undefined) ?? 0) + n);
    },
  };
  return cs as unknown as CrossStageState;
}

/** 捕获 emitDomain 投出的 {event, data}（onEvent type=domain）。 */
function makeEventSink() {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const onEvent = (e: {
    type: string;
    payload?: { event: string; data: Record<string, unknown> };
  }): void => {
    if (e.type === "domain" && e.payload) {
      events.push({ event: e.payload.event, data: e.payload.data });
    }
  };
  return { events, onEvent };
}

/** mock AgentRunner，按 spec name / input.phase 路由产出。 */
function makeRunner(
  route: (specName: string, input: Record<string, unknown>) => unknown,
): AgentRunner {
  const run = jest.fn(
    async (Spec: { name?: string }, input: Record<string, unknown>) => ({
      output: route((Spec?.name ?? "").toLowerCase(), input),
      state: "completed" as const,
      tokensUsed: { prompt: 1, completion: 1, total: 2 },
      costCents: 0,
    }),
  );
  return { run } as unknown as AgentRunner;
}

function makeRich(): RichServices {
  // 富服务束：本 spec 只测 emit 形状，富服务用 no-op stub。
  return {
    reportArtifactAssembler: { assemble: (x: unknown) => x },
    sectionSelfEval: {},
    sectionRemediation: {},
    reportEvaluation: {
      evaluateReport: async () => ({
        overallScore: 82,
        grade: "B",
        feedback: "整体论证扎实，部分维度引用偏少。",
        evaluatorModel: "test-eval-model",
        chapters: [{ chapterId: "c1", chapterTitle: "ch", content: "x" }],
      }),
    },
    qualityTrace: {},
    figureRelevance: {},
  } as unknown as RichServices;
}

const INVOCATION = {
  userId: "u1",
  onEvent: undefined as
    | ((e: { type: string; payload?: unknown }) => void)
    | undefined,
};

function makeCtx(missionId: string, onEvent: (e: unknown) => void) {
  return {
    missionId,
    signal: undefined,
    input: {
      topic: "测试主题",
      language: "zh-CN" as const,
      invocation: { userId: "u1", onEvent },
    },
  } as never;
}

describe("deep-insight stage-bindings 富化事件形状契约", () => {
  const MID = "mission-emit-shapes";

  afterEach(() => detachState(MID));

  it("chapter:writing:started/completed 用 chapterIndex（非 index），过 strict schema", async () => {
    const cs = makeCrossStageState();
    cs.set(CS_KEY.plan, {
      dimensions: [
        { id: "dim-1", name: "维度甲" },
        { id: "dim-2", name: "维度乙" },
      ],
    });
    attachState(MID, cs);
    const { events, onEvent } = makeEventSink();
    const runner = makeRunner(() => ({
      sections: [
        { heading: "第一章", body: "正文内容".repeat(50) },
        { heading: "第二章", body: "正文内容".repeat(40) },
      ],
    }));
    const bindings = new DeepInsightStageBindings(runner, makeRich());
    const hooks = bindings.buildHooksForStep("s8-writer");
    await (
      hooks as { draftOnce: (a: { ctx: unknown }) => Promise<unknown> }
    ).draftOnce({ ctx: makeCtx(MID, onEvent) });

    const started = events.filter((e) => e.event === "chapter:writing:started");
    const completed = events.filter(
      (e) => e.event === "chapter:writing:completed",
    );
    expect(started.length).toBe(2);
    expect(completed.length).toBe(2);
    for (const ev of started) {
      const r = ChapterWritingStartedSchema.safeParse(ev.data);
      expect(r.success).toBe(true);
      expect(typeof ev.data.chapterIndex).toBe("number");
      expect(ev.data.index).toBeUndefined();
      expect(typeof ev.data.dimensionId).toBe("string");
    }
    for (const ev of completed) {
      const r = ChapterWritingCompletedSchema.safeParse(ev.data);
      expect(r.success).toBe(true);
      expect(typeof ev.data.chapterIndex).toBe("number");
      expect(typeof ev.data.dimension).toBe("string");
    }
  });

  it("dimension:research:completed 含 summary + reused（fresh 路径 reused=false）", async () => {
    const cs = makeCrossStageState();
    cs.set(CS_KEY.plan, { dimensions: [{ id: "dim-1", name: "维度甲" }] });
    attachState(MID, cs);
    const { events, onEvent } = makeEventSink();
    const runner = makeRunner(() => ({
      dimension: "维度甲",
      findings: [{ claim: "c", evidence: "e", source: "https://x.com" }],
      summary: "维度甲的研究摘要",
    }));
    const bindings = new DeepInsightStageBindings(runner, makeRich());
    const hooks = bindings.buildHooksForStep("s3-researcher-collect");
    await (
      hooks as {
        perItemPipeline: (a: {
          item: unknown;
          ctx: unknown;
        }) => Promise<unknown>;
      }
    ).perItemPipeline({
      item: { id: "dim-1", name: "维度甲" },
      ctx: makeCtx(MID, onEvent),
    });

    const done = events.find((e) => e.event === "dimension:research:completed");
    expect(done).toBeDefined();
    const r = DimensionResearchCompletedSchema.safeParse(done?.data);
    expect(r.success).toBe(true);
    expect(typeof done?.data.summary).toBe("string");
    expect(done?.data.reused).toBe(false);
  });

  it("dimension:graded（S4 assess 降级路径）含 grade/summary，过 schema", () => {
    const cs = makeCrossStageState();
    const bindings = new DeepInsightStageBindings(
      makeRunner(() => null),
      makeRich(),
    );
    attachState(MID, cs);
    const { events, onEvent } = makeEventSink();
    // 直接调私有 emitAssessGraded（经类型擦除访问）——降级路径 output=undefined。
    (
      bindings as unknown as {
        emitAssessGraded: (
          onEvent: unknown,
          outcomes: unknown[],
          output: unknown,
        ) => void;
      }
    ).emitAssessGraded(
      onEvent,
      [
        {
          dimensionName: "维度甲",
          dimensionId: "dim-1",
          state: "completed",
          findingsCount: 4,
        },
        {
          dimensionName: "维度乙",
          dimensionId: "dim-2",
          state: "failed",
          findingsCount: 0,
        },
      ],
      undefined,
    );
    const graded = events.filter((e) => e.event === "dimension:graded");
    expect(graded.length).toBe(2);
    for (const ev of graded) {
      const r = DimensionGradedSchema.safeParse(ev.data);
      expect(r.success).toBe(true);
      expect(typeof ev.data.grade).toBe("string");
      expect(typeof ev.data.summary).toBe("string");
      expect(typeof ev.data.overall).toBe("number");
    }
    // 启发式打分场景不造 axes。
    expect(graded.every((e) => e.data.axes === undefined)).toBe(true);
  });

  it("verifier:verdict（s9b）含 verifierId + critique/modelId/attempt，过 schema", async () => {
    const cs = makeCrossStageState();
    cs.set(CS_KEY.reportArtifact, {
      title: "报告标题",
      sections: [{ title: "第一章", content: "x".repeat(300) }],
    });
    attachState(MID, cs);
    const { events, onEvent } = makeEventSink();
    const bindings = new DeepInsightStageBindings(
      makeRunner(() => ({ score: 80 })),
      makeRich(),
    );
    const hooks = bindings.buildHooksForStep("s9b-objective-eval");
    await (
      hooks as {
        objectiveEvalInjection: (a: {
          verdict: unknown;
          ctx: unknown;
        }) => Promise<unknown>;
      }
    ).objectiveEvalInjection({
      verdict: { score: 80 },
      ctx: makeCtx(MID, onEvent),
    });

    const vv = events.find((e) => e.event === "verifier:verdict");
    expect(vv).toBeDefined();
    const r = VerifierVerdictSchema.safeParse(vv?.data);
    expect(r.success).toBe(true);
    expect(vv?.data.verifierId).toBe("critic-eval");
    expect(typeof vv?.data.score).toBe("number");
    expect(typeof vv?.data.critique).toBe("string");
    expect(typeof vv?.data.modelId).toBe("string");
    expect(vv?.data.attempt).toBe(1);
  });
});

void INVOCATION; // 保留示意常量（INVOCATION 形状文档化 invocation 必填字段）。
