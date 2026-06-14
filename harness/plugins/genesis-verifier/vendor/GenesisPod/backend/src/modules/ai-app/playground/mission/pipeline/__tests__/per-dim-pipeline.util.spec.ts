/**
 * per-dim-pipeline.util.spec.ts
 *
 * Tests for runPerDimPipeline — the per-dimension chapter pipeline.
 *
 * Strategy: we mock the MissionDeps (invoker, writer, reviewer, emit, lifecycle)
 * and drive through the happy path and major failure modes.
 */

import { runPerDimPipeline } from "../helpers/per-dim-pipeline.util";
import type { PerDimPipelineArgs } from "../helpers/per-dim-pipeline.util";
import type { MissionDeps } from "../../context/mission-deps";

// ─── env isolation ────────────────────────────────────────────────────────────
//
// PR2 (2026-05-13) wires per-dim-pipeline tolerance through
// PlaygroundRuntimeConfig which reads `CHAPTER_TOLERANCE_RATIO` from env.
// Tests must run with the documented production default (0.3) regardless of
// the host's .env file (local-model adaptations set this to 0.4).
const PLAYGROUND_ENV_KEYS = [
  "PLAYGROUND_TUNING_PROFILE", // PR3: profile env shifts all baselines
  "MIN_FINDINGS_THRESHOLD",
  "CHAPTER_TOLERANCE_RATIO",
  "REACT_MAX_FINALIZE_REJECTS",
  "RESEARCHER_MAX_ITERATIONS",
  "RESEARCHER_MAX_ITERATIONS_HARD_CAP",
  "RESEARCHER_MAX_WALL_TIME_MS",
  "CHAPTER_WRITER_INTERNAL_MAX_ITERATIONS",
  "CHAPTER_MAX_REVISION_ATTEMPTS",
  "MISSION_WRITER_MAX_ATTEMPTS",
  "PLAYGROUND_STALE_THRESHOLD_MIN",
  "PLAYGROUND_SOFT_WARN_THRESHOLD_MIN",
  "PLAYGROUND_WALL_TIME_CAP_MS",
  "PLAYGROUND_DISABLE_BUDGET_ABORT",
] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of PLAYGROUND_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ─── external module mocks ────────────────────────────────────────────────────

// p-limit is an ESM-only module; ts-jest (isolatedModules) transpiles
// `import pLimit from "p-limit"` → `p_limit_1.default(...)`.
// We must return { __esModule: true, default: fn } so the default binding resolves.
jest.mock("p-limit", () => {
  const plimit = (_concurrency: number) => async (fn: () => Promise<unknown>) =>
    fn();
  return { __esModule: true, default: plimit };
});

// Mock agent classes that extend a base class (AgentSpec) — otherwise the
// module load fails with "Class extends value undefined" because the test
// environment can't satisfy the full DI graph.
jest.mock("../../agents/writer/chapter-writer.agent", () => ({
  ChapterWriterAgent: class ChapterWriterAgent {},
}));
jest.mock("../../agents/writer/chapter-reviewer.agent", () => ({
  ChapterReviewerAgent: class ChapterReviewerAgent {},
}));
jest.mock("../../agents/writer/dimension-integrator.agent", () => ({
  DimensionIntegratorAgent: class DimensionIntegratorAgent {},
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  restoreGlobalIndices: jest.fn((body: string) => body),
  sanitizeSectionOutput: jest.fn((body: string) => body),
  scanContentDefects: jest.fn(() => ({
    bareLatexCount: 0,
    brokenDollarNesting: 0,
    unwrappedEnvironments: 0,
    pseudoCodeLines: 0,
    leakedMetaNotes: 0,
    leakedFigureNotes: 0,
    longListItems: 0,
    trappedConclusions: 0,
  })),
  // 2026-05-01 (PR-X-N): per-dim-pipeline 走 facade 后需补这些 mock
  extractTokenSpend: jest.fn(() => ({ tokensUsed: 0, costUsd: 0 })),
  extractFailureMessage: jest.fn(() => undefined),
  extractAgentFailureDiagnostic: jest.fn(() => undefined),
  clampScore: jest.fn((n: number) =>
    Math.max(0, Math.min(100, Math.round(n || 0))),
  ),
  scaleScore: jest.fn((cur: number, factor: number) =>
    Math.max(0, Math.min(100, Math.round((cur || 0) * factor))),
  ),
  // ★ 集中阈值常量 — 与 quality-thresholds.constants.ts 同步
  REVIEW_PASS_THRESHOLD: 60,
  CHAPTER_MAX_REVISION_ATTEMPTS: 1,
  // ★ 2026-05-04 (PR-6 standardize playground): jaccardSimilarity 已下沉 engine/content，
  //   通过 harness facade 转发；spec 此处需补 mock 让 stuck-revision 检测路径可走通。
  jaccardSimilarity: jest.fn((a: string, b: string) => (a === b ? 1 : 0)),
  // R2-#50: narrate moved to harness facade
  narrate: jest.fn().mockResolvedValue(undefined),
  // P4 (2026-05-24): evidence-budget / batch-executor / grade-grounding shims
  // 实现抽到 __fixtures__/p4-facade-mocks.ts(god-class guard 减压)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...require("./__fixtures__/p4-facade-mocks").createP4FacadeMocks(),
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

const baseResearcherOut = {
  dimension: "Technology",
  findings: [
    { claim: "AI is growing", evidence: "paper", source: "arxiv.org" },
    { claim: "LLMs are powerful", evidence: "benchmark", source: "openai.com" },
  ],
  summary: "AI is transforming everything",
};

const baseArgs: PerDimPipelineArgs = {
  missionId: "m1",
  userId: "u1",
  dimensionIdx: 0,
  dimensionName: "Technology",
  topic: "AI Trends",
  language: "zh-CN",
  depth: "standard",
  pool: {
    recordSpend: jest.fn(),
    snapshot: jest.fn().mockReturnValue({}),
  } as never,
  researcherOut: baseResearcherOut,
  billing: {} as never,
  budgetMultiplier: 1.0,
};

function makeOutlineOutput(chapterCount = 2) {
  return {
    chapters: Array.from({ length: chapterCount }, (_, i) => ({
      index: i + 1,
      heading: `Chapter ${i + 1}`,
      thesis: `Thesis ${i + 1}`,
      keyPoints: [`Point ${i + 1}`],
      sourceIndices: [0],
    })),
  };
}

function makeWriterOutput(wordCount = 1000) {
  return {
    body: `This is a chapter body with ${wordCount} words`.repeat(10),
    wordCount,
    citationsUsed: ["[1]"],
  };
}

function makeReviewerOutput(decision: "pass" | "revise" = "pass", score = 85) {
  return {
    decision,
    score,
    summary: "Looks good",
    issues: [],
    critique: "Well done",
  };
}

function makeIntegratorOutput() {
  return {
    abstract: "This dimension explores AI trends",
    keyFindings: ["AI is transformative"],
    fullMarkdown: "# Technology\n\nContent here",
    totalWordCount: 2000,
  };
}

function makeGradeOutput() {
  return {
    overall: 82,
    grade: "A",
    axes: {
      accuracy: { score: 85, comment: "Accurate" },
      depth: { score: 80, comment: "Deep" },
      clarity: { score: 82, comment: "Clear" },
      relevance: { score: 83, comment: "Relevant" },
      sourcing: { score: 80, comment: "Well sourced" },
    },
    summary: "High quality analysis",
  };
}

function makeDeps(overrides: Partial<MissionDeps> = {}): MissionDeps {
  const emit = jest.fn().mockResolvedValue(undefined);
  const lifecycle = jest.fn().mockResolvedValue(undefined);
  // With parallel chapter execution (pLimit(2)), both chapter writers are invoked
  // before either reviewer runs (JS microtask interleaving). Use mockImplementation
  // to dispatch by AgentClass: ChapterWriterAgent → writer output,
  // ChapterReviewerAgent → reviewer output, DimensionIntegratorAgent → integrator output.
  // This is order-independent and works regardless of concurrency scheduling.
  const { ChapterWriterAgent } = jest.requireMock(
    "../../agents/writer/chapter-writer.agent",
  );
  const { ChapterReviewerAgent } = jest.requireMock(
    "../../agents/writer/chapter-reviewer.agent",
  );
  const { DimensionIntegratorAgent } = jest.requireMock(
    "../../agents/writer/dimension-integrator.agent",
  );

  const invoker = {
    invoke: jest.fn().mockImplementation((AgentClass: { new (): unknown }) => {
      if (AgentClass === ChapterWriterAgent) {
        return Promise.resolve({
          state: "completed",
          output: makeWriterOutput(),
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        });
      }
      if (AgentClass === ChapterReviewerAgent) {
        return Promise.resolve({
          state: "completed",
          output: makeReviewerOutput(),
          events: [],
          iterations: 1,
          wallTimeMs: 50,
        });
      }
      // DimensionIntegratorAgent
      if (AgentClass === DimensionIntegratorAgent) {
        return Promise.resolve({
          state: "completed",
          output: makeIntegratorOutput(),
          events: [],
          iterations: 1,
          wallTimeMs: 200,
        });
      }
      return Promise.resolve({
        state: "failed",
        output: undefined,
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      });
    }),
    tickCost: jest.fn().mockResolvedValue(undefined),
  };
  const writer = {
    planDimensionOutline: jest.fn().mockResolvedValue({
      state: "completed",
      output: makeOutlineOutput(2),
      events: [],
      iterations: 1,
      wallTimeMs: 100,
    }),
  };
  const reviewer = {
    judgeDimension: jest.fn().mockResolvedValue({
      state: "completed",
      output: makeGradeOutput(),
      events: [],
      iterations: 1,
      wallTimeMs: 100,
    }),
  };

  // ★ 2026-05-12: 补 log mock。call-site exception catch 会 deps.log.error 记录
  //   chapter pipeline 异常；老测试因 log 调用都在 .catch 里（emit 不失败时不触发）
  //   能侥幸通过，新代码在 catch 路径无条件调用，没有 log mock 会 ReferenceError。
  const log = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    fatal: jest.fn(),
    setContext: jest.fn(),
    setLogLevels: jest.fn(),
    localInstance: undefined,
  };

  return {
    emit,
    lifecycle,
    invoker,
    writer,
    reviewer,
    log,
    ...overrides,
  } as unknown as MissionDeps;
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("runPerDimPipeline", () => {
  it("returns researcherOut when findings is empty", async () => {
    const deps = makeDeps();
    const args = {
      ...baseArgs,
      researcherOut: { ...baseResearcherOut, findings: [] },
    };
    const result = await runPerDimPipeline(args, deps);
    expect(result).toEqual(args.researcherOut);
    expect(
      (deps.writer as { planDimensionOutline: jest.Mock }).planDimensionOutline,
    ).not.toHaveBeenCalled();
  });

  it("returns researcherOut when outline fails", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "failed",
        output: undefined,
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const deps = makeDeps({ writer: writer as never });
    const result = await runPerDimPipeline(baseArgs, deps);
    expect(result.dimension).toBe("Technology");
    expect(result.chapters).toBeUndefined();
  });

  it("runs full happy path and returns chapters + abstract + fullMarkdown + grade", async () => {
    const deps = makeDeps();
    const result = await runPerDimPipeline(baseArgs, deps);
    expect(result.chapters).toBeDefined();
    expect(result.chapters!.length).toBeGreaterThan(0);
    expect(result.abstract).toBe("This dimension explores AI trends");
    expect(result.fullMarkdown).toBeDefined();
    expect(result.grade).toBeDefined();
    expect(result.grade?.overall).toBe(82);
  });

  it("hard-fails when no chapters were written", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeOutlineOutput(1),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const invoker = {
      invoke: jest.fn().mockResolvedValueOnce({
        // chapter writer fails
        state: "failed",
        output: undefined,
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
      tickCost: jest.fn().mockResolvedValue(undefined),
    };
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
    });
    await expect(runPerDimPipeline(baseArgs, deps)).rejects.toThrow(
      /0\/1 chapters produced/,
    );
  });

  it("emits dimension:outline:planned event after successful outline", async () => {
    const deps = makeDeps();
    await runPerDimPipeline(baseArgs, deps);
    const emitCalls = (deps.emit as jest.Mock).mock.calls;
    const outlineEmit = emitCalls.find(
      (c) => c[0].type === "playground.dimension:outline:planned",
    );
    expect(outlineEmit).toBeDefined();
    expect(outlineEmit![0].payload.dimension).toBe("Technology");
  });

  it("emits chapter:writing:started and chapter:writing:completed events", async () => {
    const deps = makeDeps();
    await runPerDimPipeline(baseArgs, deps);
    const emitCalls = (deps.emit as jest.Mock).mock.calls.map((c) => c[0].type);
    expect(emitCalls).toContain("playground.chapter:writing:started");
    expect(emitCalls).toContain("playground.chapter:writing:completed");
  });

  it("emits dimension:integrating:started and completed events", async () => {
    const deps = makeDeps();
    await runPerDimPipeline(baseArgs, deps);
    const emitCalls = (deps.emit as jest.Mock).mock.calls.map((c) => c[0].type);
    expect(emitCalls).toContain(
      "playground.dimension:integrating:started",
    );
    expect(emitCalls).toContain(
      "playground.dimension:integrating:completed",
    );
  });

  it("emits dimension:graded event after grade", async () => {
    const deps = makeDeps();
    await runPerDimPipeline(baseArgs, deps);
    const emitCalls = (deps.emit as jest.Mock).mock.calls;
    const gradedEmit = emitCalls.find(
      (c) => c[0].type === "playground.dimension:graded",
    );
    expect(gradedEmit).toBeDefined();
    expect(gradedEmit![0].payload.overall).toBe(82);
  });

  it("calls lifecycle with started and completed for outline", async () => {
    const deps = makeDeps();
    await runPerDimPipeline(baseArgs, deps);
    const lifecycleCalls = (deps.lifecycle as jest.Mock).mock.calls;
    expect(lifecycleCalls.some((c) => c[4] === "started")).toBe(true);
    expect(lifecycleCalls.some((c) => c[4] === "completed")).toBe(true);
  });

  // ★ P0-R3-1 (round 3): reviewer 失败不再伪装 pass，而是按 revise 处理走 retry；
  // attempts 耗尽后仍产出 chapter（degraded path），最终 chapter 数应 > 0。
  // 2026-05-01：spec-level CHAPTER_MAX_REVISION_ATTEMPTS=1 让 reviewerExhausted
  // 仍能触发兜底落地（reviewerExhausted 优先于 attempts cap）。
  it("reviewer failure treated as revise — attempts exhausted then chapter still produced", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeOutlineOutput(1),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    // 多 attempt 模拟：writer 总是成功，reviewer 总是失败 → revise 重试到 attempt 耗尽后放行
    const invoker = {
      invoke: jest.fn().mockImplementation((spec: { id?: string }) => {
        const id = spec?.id ?? "";
        if (id.includes("integrator")) {
          return {
            state: "completed",
            output: makeIntegratorOutput(),
            events: [],
            iterations: 1,
            wallTimeMs: 200,
          };
        }
        if (id.includes("review")) {
          return {
            state: "failed",
            output: undefined,
            events: [],
            iterations: 1,
            wallTimeMs: 50,
          };
        }
        // writer / 其他
        return {
          state: "completed",
          output: makeWriterOutput(1200),
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        };
      }),
      tickCost: jest.fn().mockResolvedValue(undefined),
    };
    const reviewer = {
      judgeDimension: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeGradeOutput(),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
      reviewer: reviewer as never,
    });
    const result = await runPerDimPipeline(baseArgs, deps);
    // 即使 reviewer 一直失败，attempts 耗尽后 chapter 仍按最后一版 draft 落地
    expect(result.chapters?.length).toBeGreaterThan(0);
  });

  it("uses lengthProfile=brief to compute shorter targets", async () => {
    const deps = makeDeps();
    const args: PerDimPipelineArgs = {
      ...baseArgs,
      lengthProfile: "brief",
      dimensionCount: 3,
    };
    // brief → 3000 words / 3 dims = 1000 target/dim; should complete without error
    await expect(runPerDimPipeline(args, deps)).resolves.toBeDefined();
  });

  it("uses lengthProfile=mega for large targets (many chapters — invoker mocked indefinitely)", async () => {
    // mega with 1 dim → 200K words / 1 dim = 200K/dim, many chapters.
    // Use an invoker that always succeeds for chapter writer/reviewer, and integrator too.
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeOutlineOutput(3), // cap at 3 chapters for test speed
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const invoker = {
      invoke: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeWriterOutput(8000),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
      tickCost: jest.fn().mockResolvedValue(undefined),
    };
    // Last invocations (reviewer for each chapter, then integrator) all return valid output.
    // Since the invoker mock always returns writer output, the reviewer calls will also get
    // { body, wordCount, citationsUsed } which we need to handle.
    // Let's just set reviewer to the same completed pattern.
    // The per-dim pipeline alternates: writer, reviewer, writer, reviewer, ..., integrator.
    // We need chapter count * 2 + 1 calls for invoker (3 chapters × 2 + 1 integrator = 7).
    // Since mockResolvedValue is permanent (not Once), all calls return writer output
    // but the reviewer logic still gets a result with wordCount=8000 which is > target*70%.
    // The reviewer output shape check in per-dim-pipeline expects decision/score fields —
    // since output has neither, it falls back to "pass". So this works.
    const reviewer = {
      judgeDimension: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeGradeOutput(),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
      reviewer: reviewer as never,
    });
    const args: PerDimPipelineArgs = {
      ...baseArgs,
      lengthProfile: "mega",
      dimensionCount: 1,
    };
    await expect(runPerDimPipeline(args, deps)).resolves.toBeDefined();
  });

  // 2026-05-01：原 TODO（"isLengthFail 条件在常量=1 时永远 false"）已分析正确。
  // 改成验证 reviewer 主动 revise 触发 chapter:revision —— 这同样测了 revision
  // emit 链路，且不依赖 lengthFail 路径（lengthFail 路径需要常量 ≥2 才能跑通）。
  it("triggers revision when reviewer returns revise decision", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeOutlineOutput(1),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    // mockImplementation 按 spec.id 分派（与并发安全）：
    // - chapter-writer 总返回完整内容
    // - chapter-reviewer attempt 1 返回 revise（触发 chapter:revision emit），
    //   后续 attempt 全 pass（让 cap 后兜底落地）
    // - integrator 总成功
    let reviewerAttempt = 0;
    const invoker = {
      invoke: jest.fn().mockImplementation((spec: { id?: string }) => {
        const id = spec?.id ?? "";
        if (id.includes("integrator")) {
          return {
            state: "completed",
            output: makeIntegratorOutput(),
            events: [],
            iterations: 1,
            wallTimeMs: 200,
          };
        }
        if (id.includes("review")) {
          reviewerAttempt++;
          // 第 1 次 review → revise（score < threshold），后续 pass
          return {
            state: "completed",
            output:
              reviewerAttempt === 1
                ? makeReviewerOutput("revise", 50)
                : makeReviewerOutput("pass", 85),
            events: [],
            iterations: 1,
            wallTimeMs: 50,
          };
        }
        // writer
        return {
          state: "completed",
          output: makeWriterOutput(1500),
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        };
      }),
      tickCost: jest.fn().mockResolvedValue(undefined),
    };
    const reviewer = {
      judgeDimension: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeGradeOutput(),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
      reviewer: reviewer as never,
    });
    const result = await runPerDimPipeline(baseArgs, deps);
    // chapter:revision event should be emitted
    const emitCalls = (deps.emit as jest.Mock).mock.calls.map((c) => c[0].type);
    expect(emitCalls).toContain("playground.chapter:revision");
    expect(result.chapters?.length).toBeGreaterThan(0);
  });

  it("emits chapter:done for each written chapter (happy path)", async () => {
    const deps = makeDeps();
    await runPerDimPipeline(baseArgs, deps);
    const emitCalls = (deps.emit as jest.Mock).mock.calls;
    const doneCalls = emitCalls.filter(
      (c) => c[0].type === "playground.chapter:done",
    );
    // 2 chapters in makeDeps → 2 chapter:done events
    expect(doneCalls.length).toBe(2);
    // pass path → qualified = true, decision = "passed"
    expect(doneCalls[0][0].payload.qualified).toBe(true);
    expect(doneCalls[0][0].payload.decision).toBe("passed");
    expect(doneCalls[0][0].payload.finalized).toBe(true);
  });

  it("chapter:done payload includes finalScore, wordCount, chapterIndex", async () => {
    const deps = makeDeps();
    await runPerDimPipeline(baseArgs, deps);
    const emitCalls = (deps.emit as jest.Mock).mock.calls;
    const doneCalls = emitCalls.filter(
      (c) => c[0].type === "playground.chapter:done",
    );
    const payload = doneCalls[0][0].payload as {
      chapterIndex: number;
      finalScore: number;
      wordCount: number;
    };
    expect(typeof payload.chapterIndex).toBe("number");
    expect(typeof payload.finalScore).toBe("number");
    expect(typeof payload.wordCount).toBe("number");
  });

  it("writtenChapters entries include finalized/qualified/decision metadata", async () => {
    const deps = makeDeps();
    const result = await runPerDimPipeline(baseArgs, deps);
    expect(result.chapters).toBeDefined();
    for (const ch of result.chapters ?? []) {
      expect(ch.finalized).toBe(true);
      expect(ch.qualified).toBe(true);
      expect(ch.decision).toBe("passed");
      expect(typeof ch.finalScore).toBe("number");
    }
  });

  it("emits chapter:done with fallback-exhausted when reviewer repeatedly fails", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeOutlineOutput(1),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    // reviewer always fails → consecutiveReviewerFailures hits MAX_REVIEWER_FAILURES → fallback-exhausted
    const invoker = {
      invoke: jest
        .fn()
        .mockResolvedValueOnce({
          // writer attempt 1
          state: "completed",
          output: makeWriterOutput(1200),
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        })
        .mockResolvedValueOnce({
          // reviewer attempt 1: fails
          state: "failed",
          output: undefined,
          events: [],
          iterations: 1,
          wallTimeMs: 50,
        })
        .mockResolvedValueOnce({
          // writer attempt 2 (revise)
          state: "completed",
          output: makeWriterOutput(1200),
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        })
        .mockResolvedValueOnce({
          // reviewer attempt 2: fails again → exhausted
          state: "failed",
          output: undefined,
          events: [],
          iterations: 1,
          wallTimeMs: 50,
        })
        .mockResolvedValueOnce({
          // integrator
          state: "completed",
          output: makeIntegratorOutput(),
          events: [],
          iterations: 1,
          wallTimeMs: 200,
        }),
      tickCost: jest.fn().mockResolvedValue(undefined),
    };
    const reviewer = {
      judgeDimension: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeGradeOutput(),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
      reviewer: reviewer as never,
    });
    await runPerDimPipeline(baseArgs, deps);
    const emitCalls = (deps.emit as jest.Mock).mock.calls;
    const doneCalls = emitCalls.filter(
      (c) => c[0].type === "playground.chapter:done",
    );
    expect(doneCalls.length).toBeGreaterThan(0);
    const payload = doneCalls[0][0].payload as {
      qualified: boolean;
      decision: string;
    };
    expect(payload.qualified).toBe(false);
    expect(payload.decision).toBe("fallback-exhausted");
  });

  it("preserves findings and summary from researcherOut in result", async () => {
    const deps = makeDeps();
    const result = await runPerDimPipeline(baseArgs, deps);
    expect(result.findings).toBe(baseArgs.researcherOut.findings);
    expect(result.summary).toBe(baseArgs.researcherOut.summary);
  });

  it("integrator fails → code-stitched fullMarkdown + fallback abstract → grade still runs (用户红线: 绝对不允许空章节)", async () => {
    // ★ 2026-05-02: 之前 integrator 失败 → no fullMarkdown → 跳过 grade。
    //   用户实证空章节问题：integrator LLM 受 token 限制截断 → fullMarkdown 部分章节空。
    //   修法：fullMarkdown 由代码确定性拼接 chapter.body，LLM 失败时也不丢章节内容；
    //   abstract / keyFindings 用代码兜底，grade 继续跑。
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeOutlineOutput(1),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const invoker = {
      invoke: jest
        .fn()
        .mockResolvedValueOnce({
          state: "completed",
          output: makeWriterOutput(1200),
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        })
        .mockResolvedValueOnce({
          state: "completed",
          output: makeReviewerOutput("pass", 85),
          events: [],
          iterations: 1,
          wallTimeMs: 50,
        })
        .mockResolvedValueOnce({
          // integrator fails (no output)
          state: "failed",
          output: undefined,
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        }),
      tickCost: jest.fn().mockResolvedValue(undefined),
    };
    const reviewer = {
      judgeDimension: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeGradeOutput(),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
      reviewer: reviewer as never,
    });
    const result = await runPerDimPipeline(baseArgs, deps);
    // 代码兜底拼接 → fullMarkdown 非空且包含章节内容
    expect(result.fullMarkdown).toBeDefined();
    expect(result.fullMarkdown!.length).toBeGreaterThan(0);
    expect(result.fullMarkdown).toContain("Chapter 1"); // 章节标题在
    // abstract 是代码兜底（chapter[0] 前 200 字）
    expect(result.abstract).toBeDefined();
    // grade 仍然跑（用户红线："不允许空章节"，整合失败也要尝试评分）
    expect(reviewer.judgeDimension).toHaveBeenCalled();
    expect(result.grade).toBeDefined();
  });
});

// ─── 加速杠杆 2: 章节并发测试 ─────────────────────────────────────────────────
//
// 验证 4 个关键行为：
//   C1. 3 章并发时 invoke 调用次数 = 3×(writer+reviewer) + 1 integrator = 7
//   C2. 单章 writer 失败时其他章节仍正常 push 到 writtenChapters
//   C3. writtenChapters 按 index 排序而非完成顺序
//   C4. chapter:done 事件每章都有 emit，result.chapters 按 index 排序
//
// 注意：pLimit mock 在测试中是透传（直接执行 fn()），所以不测试"并发槽数"本身，
// 而是验证并发后的语义：调用次数、失败隔离、排序、事件。
// 所有 invoker mock 使用 AgentClass 分派（而非 mockResolvedValueOnce 顺序），
// 因为并发执行时 writer/reviewer 调用顺序不确定。

describe("runPerDimPipeline — parallel chapter execution (CHAPTER_CONCURRENCY=2)", () => {
  // 获取被 jest.mock 替换后的 mock class 引用，用于 mockImplementation 分派
  const getAgentClasses = () => ({
    ChapterWriterAgent: jest.requireMock(
      "../../agents/writer/chapter-writer.agent",
    ).ChapterWriterAgent,
    ChapterReviewerAgent: jest.requireMock(
      "../../agents/writer/chapter-reviewer.agent",
    ).ChapterReviewerAgent,
    DimensionIntegratorAgent: jest.requireMock(
      "../../agents/writer/dimension-integrator.agent",
    ).DimensionIntegratorAgent,
  });

  /** Build invoker that dispatches by AgentClass (order-independent for parallel tests) */
  function makeAgentDispatchInvoker(overrides?: {
    /** Override response for ChapterWriterAgent by chapter index (1-based) */
    writerOverrides?: Record<number, object>;
  }) {
    const {
      ChapterWriterAgent,
      ChapterReviewerAgent,
      DimensionIntegratorAgent,
    } = getAgentClasses();
    const writerCallCount: Record<number, number> = {};
    return {
      invoke: jest
        .fn()
        .mockImplementation(
          (
            AgentClass: { new (): unknown },
            input: { chapter?: { index?: number } },
          ) => {
            if (AgentClass === ChapterWriterAgent) {
              const idx = input?.chapter?.index ?? 0;
              writerCallCount[idx] = (writerCallCount[idx] ?? 0) + 1;
              const override = overrides?.writerOverrides?.[idx];
              if (override) return Promise.resolve(override);
              return Promise.resolve({
                state: "completed",
                output: makeWriterOutput(1200),
                events: [],
                iterations: 1,
                wallTimeMs: 100,
              });
            }
            if (AgentClass === ChapterReviewerAgent) {
              return Promise.resolve({
                state: "completed",
                output: makeReviewerOutput("pass", 85),
                events: [],
                iterations: 1,
                wallTimeMs: 50,
              });
            }
            if (AgentClass === DimensionIntegratorAgent) {
              return Promise.resolve({
                state: "completed",
                output: makeIntegratorOutput(),
                events: [],
                iterations: 1,
                wallTimeMs: 200,
              });
            }
            return Promise.resolve({
              state: "failed",
              output: undefined,
              events: [],
              iterations: 1,
              wallTimeMs: 100,
            });
          },
        ),
      tickCost: jest.fn().mockResolvedValue(undefined),
    };
  }

  // ── C1: 3 章时 invoke 调用次数对 ─────────────────────────────────────────
  it("C1: 3 chapters invoke exactly 3×writer + 3×reviewer + 1×integrator = 7 calls", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeOutlineOutput(3),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const invoker = makeAgentDispatchInvoker();
    const reviewer = {
      judgeDimension: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeGradeOutput(),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
      reviewer: reviewer as never,
    });
    const result = await runPerDimPipeline(baseArgs, deps);
    // 3 chapters × (1w + 1r) + 1 integrator = 7 invoke calls
    expect(invoker.invoke.mock.calls.length).toBe(7);
    expect(result.chapters?.length).toBe(3);
  });

  // ── C2: 单章 writer 失败时整条 dim 失败（不再接受部分章节成功） ──────────────
  it("C2: single chapter writer failure hard-fails the dimension pipeline", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeOutlineOutput(3),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    // Chapter index 2 writer fails; 1 and 3 succeed.
    const invoker = makeAgentDispatchInvoker({
      writerOverrides: {
        2: {
          state: "failed",
          output: undefined,
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        },
      },
    });
    const reviewer = {
      judgeDimension: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeGradeOutput(),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
      reviewer: reviewer as never,
    });
    await expect(runPerDimPipeline(baseArgs, deps)).rejects.toThrow(
      /expected 3 chapters, got 2/,
    );
  });

  it("C2b: outline-only chapter body hard-fails the dimension pipeline", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeOutlineOutput(1),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const {
      ChapterWriterAgent,
      ChapterReviewerAgent,
      DimensionIntegratorAgent,
    } = getAgentClasses();
    const invoker = {
      invoke: jest
        .fn()
        .mockImplementation((AgentClass: { new (): unknown }) => {
          if (AgentClass === ChapterWriterAgent) {
            return Promise.resolve({
              state: "completed",
              output: {
                body: "## 小标题\n\n- 要点一\n- 要点二\n- 要点三",
                wordCount: 600,
                citationsUsed: [],
              },
              events: [],
              iterations: 1,
              wallTimeMs: 100,
            });
          }
          if (AgentClass === ChapterReviewerAgent) {
            return Promise.resolve({
              state: "completed",
              output: makeReviewerOutput("pass", 85),
              events: [],
              iterations: 1,
              wallTimeMs: 50,
            });
          }
          if (AgentClass === DimensionIntegratorAgent) {
            return Promise.resolve({
              state: "completed",
              output: makeIntegratorOutput(),
              events: [],
              iterations: 1,
              wallTimeMs: 200,
            });
          }
          return Promise.resolve({
            state: "failed",
            output: undefined,
            events: [],
            iterations: 1,
            wallTimeMs: 100,
          });
        }),
      tickCost: jest.fn().mockResolvedValue(undefined),
    };
    const reviewer = {
      judgeDimension: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeGradeOutput(),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
      reviewer: reviewer as never,
    });

    await expect(runPerDimPipeline(baseArgs, deps)).rejects.toThrow(
      /(outline-only|body too short)/,
    );
  });

  // ── C3: writtenChapters 按 index 排序而非完成顺序 ─────────────────────────
  it("C3: writtenChapters are sorted by chapter.index regardless of completion order", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeOutlineOutput(3),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const invoker = makeAgentDispatchInvoker();
    const reviewer = {
      judgeDimension: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeGradeOutput(),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
      reviewer: reviewer as never,
    });
    const result = await runPerDimPipeline(baseArgs, deps);
    expect(result.chapters).toBeDefined();
    expect(result.chapters!.length).toBe(3);
    // Must be sorted ascending by index (1, 2, 3)
    const indices = result.chapters!.map((c) => c.index);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });

  // ── C4: chapter:done 每章都有，result.chapters 按 index 排序 ──────────────
  it("C4: chapter:done events exist for each produced chapter and result.chapters is index-sorted", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeOutlineOutput(3),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const invoker = makeAgentDispatchInvoker();
    const reviewer = {
      judgeDimension: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeGradeOutput(),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
      reviewer: reviewer as never,
    });
    const result = await runPerDimPipeline(baseArgs, deps);

    // chapter:done emitted once per produced chapter (3 total)
    const emitCalls = (deps.emit as jest.Mock).mock.calls;
    const doneCalls = emitCalls.filter(
      (c) => c[0].type === "playground.chapter:done",
    );
    expect(doneCalls.length).toBe(3);

    // result.chapters is sorted by index
    expect(result.chapters).toBeDefined();
    const indices = result.chapters!.map((c) => c.index);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }

    // All chapters passed (score=85 >= PASS_THRESHOLD=60)
    for (const ch of result.chapters!) {
      expect(ch.qualified).toBe(true);
      expect(ch.decision).toBe("passed");
    }
  });

  // ── C5: writer 失败必须 emit chapter:done(failed-finalized) 关闭前端状态机 ─────
  //   2026-05-12 真因：实证 mission 7 章其中 1 章 writer 失败 → return null 但没
  //   emit chapter:done → 前端 derive.ts 状态机停 'reviewing'，章节永远卡死；同时
  //   后端 writtenChapters 缺该项 → validateWrittenChapters 整盘 0/100。
  //   修法：return null 前必须 emit chapter:done(decision=fallback-exhausted,
  //   qualified=false, finalized=true) 让前端 status → 'failed-finalized'。
  it("C5: writer-failed path emits chapter:done(failed-finalized, qualified=false) to close frontend state machine", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeOutlineOutput(3),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const invoker = makeAgentDispatchInvoker({
      writerOverrides: {
        2: {
          state: "failed",
          output: undefined,
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        },
      },
    });
    const reviewer = {
      judgeDimension: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeGradeOutput(),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
      reviewer: reviewer as never,
    });
    // 3 章缺 1 = 33.3% > 30% 阈值 → 仍 throw（保留 hard-fail 语义）
    await expect(runPerDimPipeline(baseArgs, deps)).rejects.toThrow(
      /expected 3 chapters, got 2/,
    );
    // 关键断言：失败章 emit 了 chapter:done 终态事件
    const emitCalls = (deps.emit as jest.Mock).mock.calls;
    const doneCalls = emitCalls.filter(
      (c) => c[0].type === "playground.chapter:done",
    );
    // 2 成功 + 1 失败 = 3 终态事件（每章都必须有，前端状态机才能闭合）
    expect(doneCalls.length).toBe(3);
    const failedDone = doneCalls.find(
      (c) =>
        (c[0].payload as { chapterIndex: number }).chapterIndex === 2 &&
        (c[0].payload as { qualified: boolean }).qualified === false,
    );
    expect(failedDone).toBeDefined();
    expect((failedDone![0].payload as { decision: string }).decision).toBe(
      "fallback-exhausted",
    );
    expect((failedDone![0].payload as { finalized: boolean }).finalized).toBe(
      true,
    );
  });

  // ── C6: 30% 容错——7 章缺 1 (14.3%) 应继续整合 + 评分而非整盘 0 分 ─────────────
  //   2026-05-12 真因：实证 mission 7 章 6 通过 1 卡 reviewing → 旧 validate 严格
  //   chapters.length !== expected 直接抛 → 整 dim 0/100 异常终止。
  //   修法：tolerance.maxMissingRatio=0.3，14.3% ≤ 30% → 降级继续，warn narrative
  //   提示前端，让 integrator + grade 跑出反映真实质量的分数。
  it("C6: 7-chapter dim with 1 writer fail (14.3% missing) → tolerated, grade runs, no throw", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeOutlineOutput(7),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const invoker = makeAgentDispatchInvoker({
      writerOverrides: {
        5: {
          state: "failed",
          output: undefined,
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        },
      },
    });
    const reviewer = {
      judgeDimension: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeGradeOutput(),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
      reviewer: reviewer as never,
    });
    // 1/7 = 14.3% ≤ 30% → 不 throw，正常完成
    const result = await runPerDimPipeline(baseArgs, deps);
    // 6 章产出（缺 §5），按 index 排序
    expect(result.chapters?.length).toBe(6);
    expect(result.chapters?.map((c) => c.index)).toEqual([1, 2, 3, 4, 6, 7]);
    // grade 仍然产出（反映真实质量，不再 0/100）
    expect(result.grade).toBeDefined();
    expect(result.grade!.overall).toBeGreaterThan(0);
    // 前端能看到 7 个 chapter:done 终态事件（含 §5 的 fallback-exhausted）
    const emitCalls = (deps.emit as jest.Mock).mock.calls;
    const doneCalls = emitCalls.filter(
      (c) => c[0].type === "playground.chapter:done",
    );
    expect(doneCalls.length).toBe(7);
    const failedDone = doneCalls.find(
      (c) =>
        (c[0].payload as { chapterIndex: number }).chapterIndex === 5 &&
        (c[0].payload as { qualified: boolean }).qualified === false,
    );
    expect(failedDone).toBeDefined();
  });

  // ── C7: invoker throws (network/异常) 也必须 emit chapter:done 关闭状态机 ──────
  //   2026-05-12: allSettled 把 rejection 静默过滤 → 前端永远收不到终态事件。
  //   修法：call-site try-catch 包 runChapterPipeline，throw 时也 emit failed-finalized。
  it("C7: pipeline exception (invoker throws) emits chapter:done(failed-finalized) via call-site catch", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeOutlineOutput(4),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const {
      ChapterWriterAgent,
      ChapterReviewerAgent,
      DimensionIntegratorAgent,
    } = getAgentClasses();
    // 自己写完整 dispatch invoker，让 §3 的 writer 抛异常（真 throw，非 state=failed）
    const invoker = {
      invoke: jest
        .fn()
        .mockImplementation(
          (
            AgentClass: { new (): unknown },
            input: { chapter?: { index?: number } },
          ) => {
            if (AgentClass === ChapterWriterAgent) {
              const idx = input?.chapter?.index ?? 0;
              if (idx === 3) {
                throw new Error("NETWORK_TIMEOUT");
              }
              return Promise.resolve({
                state: "completed",
                output: makeWriterOutput(1200),
                events: [],
                iterations: 1,
                wallTimeMs: 100,
              });
            }
            if (AgentClass === ChapterReviewerAgent) {
              return Promise.resolve({
                state: "completed",
                output: makeReviewerOutput("pass", 85),
                events: [],
                iterations: 1,
                wallTimeMs: 50,
              });
            }
            if (AgentClass === DimensionIntegratorAgent) {
              return Promise.resolve({
                state: "completed",
                output: makeIntegratorOutput(),
                events: [],
                iterations: 1,
                wallTimeMs: 200,
              });
            }
            return Promise.resolve({
              state: "failed",
              output: undefined,
              events: [],
              iterations: 1,
              wallTimeMs: 100,
            });
          },
        ),
      tickCost: jest.fn().mockResolvedValue(undefined),
    };
    const reviewer = {
      judgeDimension: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeGradeOutput(),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
      reviewer: reviewer as never,
    });
    // 1/4 = 25% ≤ 30% → 容错继续
    const result = await runPerDimPipeline(baseArgs, deps);
    expect(result.chapters?.length).toBe(3);
    // §3 的 chapter:done 失败事件应被 call-site catch 兜底 emit
    const emitCalls = (deps.emit as jest.Mock).mock.calls;
    const doneCalls = emitCalls.filter(
      (c) => c[0].type === "playground.chapter:done",
    );
    expect(doneCalls.length).toBe(4); // 3 成功 + 1 兜底
    const exceptionDone = doneCalls.find(
      (c) => (c[0].payload as { chapterIndex: number }).chapterIndex === 3,
    );
    expect(exceptionDone).toBeDefined();
    expect(
      (exceptionDone![0].payload as { qualified: boolean }).qualified,
    ).toBe(false);
    expect(
      (exceptionDone![0].payload as { finalized: boolean }).finalized,
    ).toBe(true);
  });

  // ── C8: 严重缺章 >30% 仍 hard-fail（防止严重故障被静默放过） ────────────────────
  it("C8: missing chapters > 30% tolerance still hard-fails (preserves hard-fail safety net)", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeOutlineOutput(4),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    // 2/4 = 50% > 30% → 必须 throw
    const invoker = makeAgentDispatchInvoker({
      writerOverrides: {
        2: {
          state: "failed",
          output: undefined,
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        },
        3: {
          state: "failed",
          output: undefined,
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        },
      },
    });
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
    });
    await expect(runPerDimPipeline(baseArgs, deps)).rejects.toThrow(
      /expected 4 chapters, got 2.*ratio 50\.0%.*tolerance 30%/,
    );
  });

  // ── C9: outline-only / too-short chapter is FILTERED (not throws) when
  //   within tolerance, and the filtered set is the one that flows downstream
  //   into integrator / stitch / grade — reviewer-flagged plumbing fix
  //   (2026-05-13 v2 validateWrittenChapters: filter-and-forward).
  it("C9: outline-only chapter within tolerance is filtered, pipeline continues", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeOutlineOutput(5),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    // chapter 3 returns an outline-only body (bullets / sub-heading only).
    // 1/5 = 20% ≤ 30% tolerance, so the pipeline should KEEP going with 4
    // valid chapters and `result.chapters` should NOT include §3.
    const invoker = makeAgentDispatchInvoker({
      writerOverrides: {
        3: {
          state: "completed",
          output: {
            body: "## 小标题\n\n- 要点一\n- 要点二\n- 要点三",
            wordCount: 30,
            citationsUsed: [],
          },
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        },
      },
    });
    const reviewer = {
      judgeDimension: jest.fn().mockResolvedValue({
        state: "completed",
        output: makeGradeOutput(),
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
      reviewer: reviewer as never,
    });
    const result = await runPerDimPipeline(baseArgs, deps);
    expect(result.chapters?.length).toBe(4);
    expect(result.chapters?.map((c) => c.index)).toEqual([1, 2, 4, 5]);
    // grade still runs (filtered set fed in, not the polluted one)
    expect(result.grade).toBeDefined();
    expect(result.grade!.overall).toBeGreaterThan(0);
  });
});

// ─── L1-1 + L1-2 防"全部重写"循环测试 ──────────────────────────────────────────
//
// 注意: CHAPTER_MAX_REVISION_ATTEMPTS=1 (outer mock), 所以 while loop 最多跑 2 次
// (attempt < MAX+1 = 2)。L1-2 的 threshold decay 在 attempt=2 就能验证 (50→pass)。
// L1-1 的 stuckCount 需要 3 次 attempt，通过 similarity.util.spec.ts 在纯函数层验证，
// per-dim 层验证"identical body 在 attempt=2 后 stuckCount=1 但未触发兜底"，
// 以及"chapter 仍正常产出"（不循环崩溃）。

describe("runPerDimPipeline — L1 anti-loop guards (MAX_ATTEMPTS=1)", () => {
  const l1BaseResearcherOut = {
    dimension: "Technology",
    findings: [
      { claim: "AI is growing", evidence: "paper", source: "arxiv.org" },
      {
        claim: "LLMs are powerful",
        evidence: "benchmark",
        source: "openai.com",
      },
    ],
    summary: "AI is transforming everything",
  };

  const l1BaseArgs: PerDimPipelineArgs = {
    missionId: "m-l1",
    userId: "u-l1",
    dimensionIdx: 0,
    dimensionName: "Technology",
    topic: "AI Trends",
    language: "zh-CN",
    depth: "standard",
    pool: {
      recordSpend: jest.fn(),
      snapshot: jest.fn().mockReturnValue({}),
    } as never,
    researcherOut: l1BaseResearcherOut,
    billing: {} as never,
    budgetMultiplier: 1.0,
  };

  /** Build a single-chapter pipeline deps with a custom invoker sequence */
  function makeL1Deps(invokerCalls: object[]): MissionDeps {
    const invokerMock = {
      invoke: jest.fn(),
      tickCost: jest.fn().mockResolvedValue(undefined),
    };
    for (const call of invokerCalls) {
      invokerMock.invoke.mockResolvedValueOnce(call);
    }
    return {
      emit: jest.fn().mockResolvedValue(undefined),
      lifecycle: jest.fn().mockResolvedValue(undefined),
      invoker: invokerMock,
      writer: {
        planDimensionOutline: jest.fn().mockResolvedValue({
          state: "completed",
          output: {
            chapters: [
              {
                index: 1,
                heading: "Chapter 1",
                thesis: "Thesis 1",
                keyPoints: ["Point 1"],
                sourceIndices: [0],
              },
            ],
          },
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        }),
      },
      reviewer: {
        judgeDimension: jest.fn().mockResolvedValue({
          state: "completed",
          output: { overall: 75, grade: "B+", axes: {}, summary: "Good" },
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        }),
      },
    } as unknown as MissionDeps;
  }

  const integratorOutput = {
    abstract: "Abstract",
    keyFindings: ["Finding 1"],
    fullMarkdown: "# Content",
    totalWordCount: 1200,
  };

  // ── L1-2: threshold decays — score=50 fails at attempt=1 (threshold=60) ────────
  // but passes at attempt=2 (threshold=50). With MAX_ATTEMPTS=1, attempt=2 is the cap.
  // The dynamic threshold ensures score=50 is accepted at cap instead of being stuck.

  it("L1-2: score 50 fails threshold 60 at attempt 1, accepted at attempt 2 (decayed to 50)", async () => {
    // attempt=1: dynamicThreshold=max(40, 60-0*10)=60, score=50 < 60 → revise
    // attempt=2: dynamicThreshold=max(40, 60-1*10)=50, score=50 >= 50 → pass → finalize
    // Total invoker calls: 1w + 1r + 1w + 1r + 1integrator = 5
    const writerOutput = {
      body: "artificial intelligence technology research findings analysis development modern",
      wordCount: 1200,
      citationsUsed: ["[1]"],
    };
    const score50 = {
      decision: "revise" as const,
      score: 50,
      summary: "Acceptable",
      issues: [],
      critique: "Marginal quality",
    };

    const invokerCalls = [
      {
        state: "completed",
        output: writerOutput,
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      },
      {
        state: "completed",
        output: score50,
        events: [],
        iterations: 1,
        wallTimeMs: 50,
      },
      {
        state: "completed",
        output: writerOutput,
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      },
      {
        state: "completed",
        output: score50,
        events: [],
        iterations: 1,
        wallTimeMs: 50,
      },
      {
        state: "completed",
        output: integratorOutput,
        events: [],
        iterations: 1,
        wallTimeMs: 200,
      },
    ];

    const deps = makeL1Deps(invokerCalls);
    const result = await runPerDimPipeline(l1BaseArgs, deps);

    expect(result.chapters).toBeDefined();
    expect(result.chapters!.length).toBeGreaterThan(0);
    // 2 writer + 2 reviewer + 1 integrator = 5 invoke calls
    expect((deps.invoker.invoke as jest.Mock).mock.calls.length).toBe(5);
  });

  it("L1-2: score 44 fails at attempt 1 (threshold=60), finalized at attempt 2 (attempt cap=MAX+1)", async () => {
    // With MAX_ATTEMPTS=1: attempt cap fires at attempt >= 2 (= MAX_REVISION_ATTEMPTS+1).
    // score=44 < threshold(attempt=2)=50 but attempt >= cap → finalize anyway.
    const writerOutput = {
      body: "machine learning deep neural network training optimization dataset evaluation",
      wordCount: 1200,
      citationsUsed: ["[1]"],
    };
    const score44 = {
      decision: "revise" as const,
      score: 44,
      summary: "Below avg",
      issues: [],
      critique: "Needs improvement",
    };

    const invokerCalls = [
      {
        state: "completed",
        output: writerOutput,
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      },
      {
        state: "completed",
        output: score44,
        events: [],
        iterations: 1,
        wallTimeMs: 50,
      },
      {
        state: "completed",
        output: writerOutput,
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      },
      {
        state: "completed",
        output: score44,
        events: [],
        iterations: 1,
        wallTimeMs: 50,
      },
      {
        state: "completed",
        output: integratorOutput,
        events: [],
        iterations: 1,
        wallTimeMs: 200,
      },
    ];

    const deps = makeL1Deps(invokerCalls);
    const result = await runPerDimPipeline(l1BaseArgs, deps);

    // Chapter still produced — attempt cap finalizes regardless of score
    expect(result.chapters).toBeDefined();
    expect(result.chapters!.length).toBeGreaterThan(0);
  });

  it("L1-1: identical bodies on revision do not crash and chapter is still produced", async () => {
    // With MAX_ATTEMPTS=1, identical bodies on attempt=2 yield stuckCount=1 (< MAX_STUCK_COUNT=2).
    // No stuck guard fires, but the attempt cap (attempt >= 2) finalizes the chapter cleanly.
    // Verifies that the similarity check code path doesn't throw or break the pipeline.
    const sameBody =
      "the quick brown fox jumps over the lazy dog with speed and determination";
    const writerOutput = {
      body: sameBody,
      wordCount: 1200,
      citationsUsed: ["[1]"],
    };
    const reviewerReject = {
      decision: "revise" as const,
      score: 30,
      summary: "Needs full rewrite",
      issues: [],
      critique: "Completely redo",
    };

    const invokerCalls = [
      // attempt 1: identical body, reviewer rejects
      {
        state: "completed",
        output: writerOutput,
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      },
      {
        state: "completed",
        output: reviewerReject,
        events: [],
        iterations: 1,
        wallTimeMs: 50,
      },
      // attempt 2: same body again (stuckCount=1, but cap fires: attempt >= 2)
      {
        state: "completed",
        output: writerOutput,
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      },
      {
        state: "completed",
        output: reviewerReject,
        events: [],
        iterations: 1,
        wallTimeMs: 50,
      },
      // integrator
      {
        state: "completed",
        output: integratorOutput,
        events: [],
        iterations: 1,
        wallTimeMs: 200,
      },
    ];

    const deps = makeL1Deps(invokerCalls);
    const result = await runPerDimPipeline(l1BaseArgs, deps);

    // No crash — chapter produced
    expect(result.chapters).toBeDefined();
    expect(result.chapters!.length).toBeGreaterThan(0);
  });
});

// ─── RTK 风格优化：dim 层 finding 去重 ───────────────────────────────────────
//
// 验证 firstUseByChapter 预计算 + chapterSources 构造逻辑：
//   D1. 单 chapter 用 finding 0,1,2 → 全部首发，无 _deduplicated
//   D2. 2 chapter 共享 finding 1 → chapter 1 全文，chapter 2 brief(_deduplicated=true)
//   D3. 3 chapter 各自独立 sourceIndices → 全无 _deduplicated
//   D4. 并发场景（pLimit mock 透传）→ chapter 1 先发，chapter 2 brief，结果稳定（无 race）

describe("runPerDimPipeline — RTK finding deduplication", () => {
  // findings with distinct evidence text
  const dedupResearcherOut = {
    dimension: "Technology",
    findings: [
      {
        claim: "Claim 0",
        evidence: "Evidence text 0 (long)",
        source: "src0.com",
      },
      {
        claim: "Claim 1",
        evidence: "Evidence text 1 (long)",
        source: "src1.com",
      },
      {
        claim: "Claim 2",
        evidence: "Evidence text 2 (long)",
        source: "src2.com",
      },
    ],
    summary: "Summary",
  };

  const dedupBaseArgs: PerDimPipelineArgs = {
    ...baseArgs,
    researcherOut: dedupResearcherOut,
  };

  /**
   * Capture the `sources` argument passed to ChapterWriterAgent for each chapter.
   * Returns an array indexed by chapter invocation order (0 = first chapter writer call).
   */
  function captureWriterSources(invoker: { invoke: jest.Mock }) {
    const { ChapterWriterAgent } = jest.requireMock(
      "../../agents/writer/chapter-writer.agent",
    );
    const captured: Array<
      Array<{ claim: string; evidence?: string; _deduplicated?: boolean }>
    > = [];
    invoker.invoke.mockImplementation(
      (AgentClass: { new (): unknown }, input: { sources?: unknown[] }) => {
        if (AgentClass === ChapterWriterAgent) {
          captured.push((input?.sources ?? []) as (typeof captured)[0]);
          return Promise.resolve({
            state: "completed",
            output: makeWriterOutput(1000),
            events: [],
            iterations: 1,
            wallTimeMs: 100,
          });
        }
        // reviewer
        const { ChapterReviewerAgent } = jest.requireMock(
          "../../agents/writer/chapter-reviewer.agent",
        );
        if (AgentClass === ChapterReviewerAgent) {
          return Promise.resolve({
            state: "completed",
            output: makeReviewerOutput("pass", 85),
            events: [],
            iterations: 1,
            wallTimeMs: 50,
          });
        }
        // integrator
        return Promise.resolve({
          state: "completed",
          output: makeIntegratorOutput(),
          events: [],
          iterations: 1,
          wallTimeMs: 200,
        });
      },
    );
    return captured;
  }

  // ── D1: single chapter, all findings unique → no _deduplicated ────────────
  it("D1: single chapter uses all findings as first-use — no _deduplicated", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: {
          chapters: [
            {
              index: 1,
              heading: "Chapter 1",
              thesis: "Thesis",
              keyPoints: ["p1"],
              sourceIndices: [0, 1, 2], // all three findings
            },
          ],
        },
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const invoker = {
      invoke: jest.fn(),
      tickCost: jest.fn().mockResolvedValue(undefined),
    };
    const captured = captureWriterSources(invoker);
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
    });

    await runPerDimPipeline(dedupBaseArgs, deps);

    expect(captured.length).toBeGreaterThan(0);
    const ch1Sources = captured[0];
    expect(ch1Sources.length).toBe(3);
    // All first-use → no _deduplicated flag
    for (const src of ch1Sources) {
      expect(
        (src as { _deduplicated?: boolean })._deduplicated,
      ).toBeUndefined();
    }
    // evidence preserved on all
    for (const src of ch1Sources) {
      expect(src.evidence).toBeDefined();
    }
  });

  // ── D2: 2 chapters share finding 1 → chapter 2 gets brief ────────────────
  it("D2: shared finding 1 → chapter 1 full text, chapter 2 brief (_deduplicated=true)", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: {
          chapters: [
            {
              index: 1,
              heading: "Chapter 1",
              thesis: "Thesis 1",
              keyPoints: ["p1"],
              sourceIndices: [0, 1], // finding 0 + 1
            },
            {
              index: 2,
              heading: "Chapter 2",
              thesis: "Thesis 2",
              keyPoints: ["p2"],
              sourceIndices: [1, 2], // finding 1 shared! + 2
            },
          ],
        },
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const invoker = {
      invoke: jest.fn(),
      tickCost: jest.fn().mockResolvedValue(undefined),
    };
    const captured = captureWriterSources(invoker);
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
    });

    await runPerDimPipeline(dedupBaseArgs, deps);

    // 2 writer invocations (one per chapter)
    expect(captured.length).toBe(2);

    // chapter 1 sources: finding 0 and 1 — both first-use
    const ch1Sources = captured[0];
    expect(ch1Sources.length).toBe(2);
    const ch1Finding1 = ch1Sources.find((s) => s.claim === "Claim 1");
    expect(ch1Finding1).toBeDefined();
    expect(
      (ch1Finding1 as { _deduplicated?: boolean })._deduplicated,
    ).toBeUndefined();
    expect(ch1Finding1!.evidence).toBe("Evidence text 1 (long)");

    // chapter 2 sources: finding 1 is deduplicated, finding 2 is first-use
    const ch2Sources = captured[1];
    expect(ch2Sources.length).toBe(2);
    const ch2Finding1 = ch2Sources.find((s) => s.claim === "Claim 1");
    expect(ch2Finding1).toBeDefined();
    expect((ch2Finding1 as { _deduplicated?: boolean })._deduplicated).toBe(
      true,
    );
    // evidence stripped on deduplicated
    expect(ch2Finding1!.evidence).toBe("");
    // claim and source preserved for citation
    expect(ch2Finding1!.claim).toBe("Claim 1");
    expect(ch2Finding1!.source).toBe("src1.com");

    const ch2Finding2 = ch2Sources.find((s) => s.claim === "Claim 2");
    expect(ch2Finding2).toBeDefined();
    expect(
      (ch2Finding2 as { _deduplicated?: boolean })._deduplicated,
    ).toBeUndefined();
    expect(ch2Finding2!.evidence).toBe("Evidence text 2 (long)");
  });

  // ── D3: 3 chapters with distinct sourceIndices → all first-use ───────────
  it("D3: 3 chapters with non-overlapping sourceIndices — no _deduplicated anywhere", async () => {
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: {
          chapters: [
            {
              index: 1,
              heading: "Chapter 1",
              thesis: "T1",
              keyPoints: [],
              sourceIndices: [0],
            },
            {
              index: 2,
              heading: "Chapter 2",
              thesis: "T2",
              keyPoints: [],
              sourceIndices: [1],
            },
            {
              index: 3,
              heading: "Chapter 3",
              thesis: "T3",
              keyPoints: [],
              sourceIndices: [2],
            },
          ],
        },
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const invoker = {
      invoke: jest.fn(),
      tickCost: jest.fn().mockResolvedValue(undefined),
    };
    const captured = captureWriterSources(invoker);
    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
    });

    await runPerDimPipeline(dedupBaseArgs, deps);

    expect(captured.length).toBe(3);
    for (const chSources of captured) {
      for (const src of chSources) {
        expect(
          (src as { _deduplicated?: boolean })._deduplicated,
        ).toBeUndefined();
        expect(src.evidence).toBeDefined();
      }
    }
  });

  // ── D4: parallel (pLimit mock is pass-through) → chapter 1 first, stable ─
  it("D4: concurrent execution — firstUseByChapter pre-computed, chapter 1 always gets full text", async () => {
    // Both chapters reference finding 0 — chapter 1 (lower index) should always
    // get full text; chapter 2 should always get brief. Pre-computation guarantees
    // this regardless of pLimit scheduling order.
    const writer = {
      planDimensionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: {
          chapters: [
            {
              index: 1,
              heading: "Chapter 1",
              thesis: "T1",
              keyPoints: [],
              sourceIndices: [0],
            },
            {
              index: 2,
              heading: "Chapter 2",
              thesis: "T2",
              keyPoints: [],
              sourceIndices: [0], // same finding 0
            },
          ],
        },
        events: [],
        iterations: 1,
        wallTimeMs: 100,
      }),
    };
    const invoker = {
      invoke: jest.fn(),
      tickCost: jest.fn().mockResolvedValue(undefined),
    };

    // Capture per-chapter-index to avoid relying on invocation order
    const { ChapterWriterAgent } = jest.requireMock(
      "../../agents/writer/chapter-writer.agent",
    );
    const { ChapterReviewerAgent } = jest.requireMock(
      "../../agents/writer/chapter-reviewer.agent",
    );
    const sourcesPerChapterIndex = new Map<
      number,
      Array<{ claim: string; evidence?: string; _deduplicated?: boolean }>
    >();

    invoker.invoke.mockImplementation(
      (
        AgentClass: { new (): unknown },
        input: { chapter?: { index?: number }; sources?: unknown[] },
      ) => {
        if (AgentClass === ChapterWriterAgent) {
          const idx = input?.chapter?.index ?? 0;
          sourcesPerChapterIndex.set(
            idx,
            (input?.sources ?? []) as Array<{
              claim: string;
              evidence?: string;
              _deduplicated?: boolean;
            }>,
          );
          return Promise.resolve({
            state: "completed",
            output: makeWriterOutput(1000),
            events: [],
            iterations: 1,
            wallTimeMs: 100,
          });
        }
        if (AgentClass === ChapterReviewerAgent) {
          return Promise.resolve({
            state: "completed",
            output: makeReviewerOutput("pass", 85),
            events: [],
            iterations: 1,
            wallTimeMs: 50,
          });
        }
        // integrator
        return Promise.resolve({
          state: "completed",
          output: makeIntegratorOutput(),
          events: [],
          iterations: 1,
          wallTimeMs: 200,
        });
      },
    );

    const deps = makeDeps({
      writer: writer as never,
      invoker: invoker as never,
    });
    await runPerDimPipeline(dedupBaseArgs, deps);

    // chapter 1: finding 0 is first-use → full evidence
    const ch1Src = sourcesPerChapterIndex.get(1);
    expect(ch1Src).toBeDefined();
    expect(ch1Src!.length).toBe(1);
    expect(ch1Src![0]._deduplicated).toBeUndefined();
    expect(ch1Src![0].evidence).toBeDefined();

    // chapter 2: finding 0 is duplicate → brief only
    const ch2Src = sourcesPerChapterIndex.get(2);
    expect(ch2Src).toBeDefined();
    expect(ch2Src!.length).toBe(1);
    expect(ch2Src![0]._deduplicated).toBe(true);
    expect(ch2Src![0].evidence).toBe("");
    // claim and source still present for citation
    expect(ch2Src![0].claim).toBe("Claim 0");
    expect(ch2Src![0].source).toBe("src0.com");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INVARIANT 矩阵覆盖 — 100% 业务分支
  // ═══════════════════════════════════════════════════════════════════════════
  // 关键不变量：每个 dim 必发一次 dimension:graded 事件（无论何种路径），杜绝
  // 静默黑洞（mission da6e2af7 实证 5/8 dim 卡"等待评分"的真因）。
  describe("INVARIANT — every dim emits exactly one dimension:graded event", () => {
    function getGradedEmits(deps: MissionDeps) {
      return (deps.emit as jest.Mock).mock.calls
        .map((c) => c[0])
        .filter(
          (e: { type: string }) =>
            e.type === "playground.dimension:graded",
        );
    }

    it("[A1] findings empty → emits graded(failed,skipped,phase=no-findings)", async () => {
      const deps = makeDeps();
      await runPerDimPipeline(
        { ...baseArgs, researcherOut: { ...baseResearcherOut, findings: [] } },
        deps,
      );
      const graded = getGradedEmits(deps);
      expect(graded).toHaveLength(1);
      expect(graded[0].payload.failed).toBe(true);
      expect(graded[0].payload.skipped).toBe(true);
      expect(graded[0].payload.phase).toBe("no-findings");
      expect(graded[0].payload.overall).toBe(0);
      expect(graded[0].payload.summary).toMatch(/未采集到 finding/);
    });

    it("[A2] outline failed (no output) → emits graded(failed,skipped,phase=outline-failed)", async () => {
      const writer = {
        planDimensionOutline: jest.fn().mockResolvedValue({
          state: "failed",
          output: undefined,
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        }),
      };
      const deps = makeDeps({ writer: writer as never });
      await runPerDimPipeline(baseArgs, deps);
      const graded = getGradedEmits(deps);
      expect(graded).toHaveLength(1);
      expect(graded[0].payload.failed).toBe(true);
      expect(graded[0].payload.skipped).toBe(true);
      expect(graded[0].payload.phase).toBe("outline-failed");
      expect(graded[0].payload.summary).toMatch(/outline 未产出/);
    });

    it("[A3] outline degraded + output → continues to chapter pipeline (existing behavior preserved)", async () => {
      const writer = {
        planDimensionOutline: jest.fn().mockResolvedValue({
          state: "degraded",
          output: makeOutlineOutput(1),
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        }),
      };
      const deps = makeDeps({ writer: writer as never });
      const result = await runPerDimPipeline(baseArgs, deps);
      // outline degraded but pipeline continues → chapter exists
      expect(result.chapters).toBeDefined();
      expect(result.chapters!.length).toBeGreaterThan(0);
      const graded = getGradedEmits(deps);
      // Some terminal event fires (success or failed depending on integrator)
      expect(graded.length).toBeGreaterThanOrEqual(1);
    });

    it("[A4] 0 chapters written → emits graded(failed,skipped,phase=no-chapters)", async () => {
      const { ChapterWriterAgent } = jest.requireMock(
        "../../agents/writer/chapter-writer.agent",
      );
      const invoker = {
        invoke: jest
          .fn()
          .mockImplementation((AgentClass: { new (): unknown }) => {
            if (AgentClass === ChapterWriterAgent) {
              return Promise.resolve({
                state: "failed",
                output: undefined,
                events: [],
                iterations: 1,
                wallTimeMs: 100,
              });
            }
            return Promise.resolve({
              state: "failed",
              output: undefined,
              events: [],
              iterations: 1,
              wallTimeMs: 100,
            });
          }),
        tickCost: jest.fn().mockResolvedValue(undefined),
      };
      const deps = makeDeps({ invoker: invoker as never });
      await expect(runPerDimPipeline(baseArgs, deps)).rejects.toThrow(
        /0\/2 chapters produced/,
      );
      const graded = getGradedEmits(deps);
      expect(graded).toHaveLength(1);
      expect(graded[0].payload.failed).toBe(true);
      expect(graded[0].payload.skipped).toBe(true);
      expect(graded[0].payload.phase).toBe("no-chapters");
      expect(graded[0].payload.summary).toMatch(/0\/.*章节产出/);
    });

    it("[A5] integrator completed + grade success → emits graded(ok=true,overall>0)", async () => {
      const deps = makeDeps();
      const result = await runPerDimPipeline(baseArgs, deps);
      const graded = getGradedEmits(deps);
      expect(graded).toHaveLength(1);
      expect(graded[0].payload.failed).toBeUndefined();
      expect(graded[0].payload.overall).toBe(82);
      expect(result.grade?.overall).toBe(82);
    });

    it("[A6] integrator degraded + output → integrating:completed(degraded:true) + grade still runs", async () => {
      const {
        ChapterWriterAgent,
        ChapterReviewerAgent,
        DimensionIntegratorAgent,
      } = {
        ChapterWriterAgent: jest.requireMock(
          "../../agents/writer/chapter-writer.agent",
        ).ChapterWriterAgent,
        ChapterReviewerAgent: jest.requireMock(
          "../../agents/writer/chapter-reviewer.agent",
        ).ChapterReviewerAgent,
        DimensionIntegratorAgent: jest.requireMock(
          "../../agents/writer/dimension-integrator.agent",
        ).DimensionIntegratorAgent,
      };
      const invoker = {
        invoke: jest
          .fn()
          .mockImplementation((AgentClass: { new (): unknown }) => {
            if (AgentClass === ChapterWriterAgent) {
              return Promise.resolve({
                state: "completed",
                output: makeWriterOutput(),
                events: [],
                iterations: 1,
                wallTimeMs: 100,
              });
            }
            if (AgentClass === ChapterReviewerAgent) {
              return Promise.resolve({
                state: "completed",
                output: makeReviewerOutput(),
                events: [],
                iterations: 1,
                wallTimeMs: 50,
              });
            }
            if (AgentClass === DimensionIntegratorAgent) {
              // ★ 这是真因测试：integrator state=degraded 但 output 已"强制接受次优产物"
              return Promise.resolve({
                state: "degraded",
                output: makeIntegratorOutput(),
                events: [],
                iterations: 1,
                wallTimeMs: 200,
              });
            }
            return Promise.resolve({
              state: "failed",
              output: undefined,
              events: [],
              iterations: 1,
              wallTimeMs: 100,
            });
          }),
        tickCost: jest.fn().mockResolvedValue(undefined),
      };
      const deps = makeDeps({ invoker: invoker as never });
      const result = await runPerDimPipeline(baseArgs, deps);
      // integrating:completed 应当 emit 且带 degraded:true
      const integratingCompleted = (deps.emit as jest.Mock).mock.calls
        .map((c) => c[0])
        .find(
          (e: { type: string }) =>
            e.type === "playground.dimension:integrating:completed",
        );
      expect(integratingCompleted).toBeDefined();
      expect(integratingCompleted!.payload.degraded).toBe(true);
      // grade 应当跑（这正是真因修复 — 之前 degraded 不走 grade）
      const graded = getGradedEmits(deps);
      expect(graded).toHaveLength(1);
      expect(graded[0].payload.overall).toBe(82);
      expect(result.fullMarkdown).toBeDefined();
    });

    it("[A7] integrator LLM 失败 → code-stitched fullMarkdown 兜底 + grade 仍跑（用户红线：绝对不允许空章节）", async () => {
      // ★ 2026-05-02 行为变更：integrator LLM 失败时，代码确定性拼接 chapter.body
      //   产生 fullMarkdown，abstract / keyFindings 用代码兜底，grade 继续跑。
      //   integrating:completed 携 fallback:'code-stitched-abstract' 标记。
      const { DimensionIntegratorAgent } = jest.requireMock(
        "../../agents/writer/dimension-integrator.agent",
      );
      const { ChapterWriterAgent } = jest.requireMock(
        "../../agents/writer/chapter-writer.agent",
      );
      const { ChapterReviewerAgent } = jest.requireMock(
        "../../agents/writer/chapter-reviewer.agent",
      );
      const invoker = {
        invoke: jest
          .fn()
          .mockImplementation((AgentClass: { new (): unknown }) => {
            if (AgentClass === ChapterWriterAgent) {
              return Promise.resolve({
                state: "completed",
                output: makeWriterOutput(),
                events: [],
                iterations: 1,
                wallTimeMs: 100,
              });
            }
            if (AgentClass === ChapterReviewerAgent) {
              return Promise.resolve({
                state: "completed",
                output: makeReviewerOutput(),
                events: [],
                iterations: 1,
                wallTimeMs: 50,
              });
            }
            if (AgentClass === DimensionIntegratorAgent) {
              return Promise.resolve({
                state: "failed",
                output: undefined,
                events: [],
                iterations: 1,
                wallTimeMs: 200,
              });
            }
            return Promise.resolve({
              state: "failed",
              output: undefined,
              events: [],
              iterations: 1,
              wallTimeMs: 100,
            });
          }),
        tickCost: jest.fn().mockResolvedValue(undefined),
      };
      const deps = makeDeps({ invoker: invoker as never });
      const result = await runPerDimPipeline(baseArgs, deps);
      // integrator 失败但 emit integrating:completed (degraded:true, fallback)
      const integratingCompleted = (deps.emit as jest.Mock).mock.calls
        .map((c) => c[0])
        .find(
          (e: { type: string }) =>
            e.type === "playground.dimension:integrating:completed",
        );
      expect(integratingCompleted).toBeDefined();
      expect(integratingCompleted!.payload.degraded).toBe(true);
      expect(integratingCompleted!.payload.fallback).toBe(
        "code-stitched-abstract",
      );
      // fullMarkdown 由代码确定性拼接，永不空
      expect(result.fullMarkdown).toBeDefined();
      expect(result.fullMarkdown!.length).toBeGreaterThan(0);
      // grade 仍跑（不再 skipped）— happy path: judgeDimension default mock 返回 success
      const graded = getGradedEmits(deps);
      expect(graded).toHaveLength(1);
      expect(graded[0].payload.failed).toBeUndefined(); // grade 成功
      expect(graded[0].payload.overall).toBe(82);
    });

    it("[A8] grade !completed (judge state=failed) → emits graded(failed,phase=grade-failed)", async () => {
      const reviewer = {
        judgeDimension: jest.fn().mockResolvedValue({
          state: "failed",
          output: undefined,
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        }),
      };
      const deps = makeDeps({ reviewer: reviewer as never });
      await runPerDimPipeline(baseArgs, deps);
      const graded = getGradedEmits(deps);
      expect(graded).toHaveLength(1);
      expect(graded[0].payload.failed).toBe(true);
      expect(graded[0].payload.phase).toBe("grade-failed");
      expect(graded[0].payload.summary).toMatch(/grade 阶段失败/);
    });

    it("[A8b] grade failed 首次→重试成功 → 用重试分数，不走兜底", async () => {
      const reviewer = {
        judgeDimension: jest
          .fn()
          .mockResolvedValueOnce({
            state: "failed",
            output: undefined,
            events: [],
            iterations: 1,
            wallTimeMs: 100,
          })
          .mockResolvedValueOnce({
            state: "completed",
            output: makeGradeOutput(),
            events: [],
            iterations: 1,
            wallTimeMs: 100,
          }),
      };
      const deps = makeDeps({ reviewer: reviewer as never });
      await runPerDimPipeline(baseArgs, deps);
      // 首次 failed → 触发一次容错重试
      expect(reviewer.judgeDimension).toHaveBeenCalledTimes(2);
      const graded = getGradedEmits(deps);
      expect(graded).toHaveLength(1);
      expect(graded[0].payload.failed).toBeUndefined(); // 重试成功 → 非失败
      expect(graded[0].payload.overall).toBe(82);
    });

    it("[A9] integrator throws → catch emits graded(failed,phase=pipeline-exception) + rethrows", async () => {
      const { DimensionIntegratorAgent } = jest.requireMock(
        "../../agents/writer/dimension-integrator.agent",
      );
      const { ChapterWriterAgent } = jest.requireMock(
        "../../agents/writer/chapter-writer.agent",
      );
      const { ChapterReviewerAgent } = jest.requireMock(
        "../../agents/writer/chapter-reviewer.agent",
      );
      const invoker = {
        invoke: jest
          .fn()
          .mockImplementation((AgentClass: { new (): unknown }) => {
            if (AgentClass === ChapterWriterAgent) {
              return Promise.resolve({
                state: "completed",
                output: makeWriterOutput(),
                events: [],
                iterations: 1,
                wallTimeMs: 100,
              });
            }
            if (AgentClass === ChapterReviewerAgent) {
              return Promise.resolve({
                state: "completed",
                output: makeReviewerOutput(),
                events: [],
                iterations: 1,
                wallTimeMs: 50,
              });
            }
            if (AgentClass === DimensionIntegratorAgent) {
              throw new Error("INTEGRATOR_LLM_TIMEOUT");
            }
            return Promise.resolve({
              state: "failed",
              output: undefined,
              events: [],
              iterations: 1,
              wallTimeMs: 100,
            });
          }),
        tickCost: jest.fn().mockResolvedValue(undefined),
      };
      const deps = makeDeps({ invoker: invoker as never });
      await expect(runPerDimPipeline(baseArgs, deps)).rejects.toThrow(
        /INTEGRATOR_LLM_TIMEOUT/,
      );
      const graded = getGradedEmits(deps);
      expect(graded).toHaveLength(1);
      expect(graded[0].payload.failed).toBe(true);
      expect(graded[0].payload.phase).toBe("pipeline-exception");
      expect(graded[0].payload.summary).toMatch(/INTEGRATOR_LLM_TIMEOUT/);
    });

    it("[A10] grade throws → catch emits graded(failed,phase=pipeline-exception)", async () => {
      const reviewer = {
        judgeDimension: jest
          .fn()
          .mockRejectedValue(new Error("JUDGE_LLM_REFUSED")),
      };
      const deps = makeDeps({ reviewer: reviewer as never });
      await expect(runPerDimPipeline(baseArgs, deps)).rejects.toThrow(
        /JUDGE_LLM_REFUSED/,
      );
      const graded = getGradedEmits(deps);
      expect(graded).toHaveLength(1);
      expect(graded[0].payload.failed).toBe(true);
      expect(graded[0].payload.phase).toBe("pipeline-exception");
      expect(graded[0].payload.summary).toMatch(/JUDGE_LLM_REFUSED/);
    });

    it("[A11] retryLabel propagated to graded events (success path)", async () => {
      const deps = makeDeps();
      await runPerDimPipeline(
        { ...baseArgs, retryLabel: "leader-assess-retry" },
        deps,
      );
      const graded = getGradedEmits(deps);
      expect(graded).toHaveLength(1);
      expect(graded[0].payload.retryLabel).toBe("leader-assess-retry");
    });

    it("[A12] retryLabel propagated to graded events (failed path)", async () => {
      const writer = {
        planDimensionOutline: jest.fn().mockResolvedValue({
          state: "failed",
          output: undefined,
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        }),
      };
      const deps = makeDeps({ writer: writer as never });
      await runPerDimPipeline(
        { ...baseArgs, retryLabel: "leader-assess-replace" },
        deps,
      );
      const graded = getGradedEmits(deps);
      expect(graded).toHaveLength(1);
      expect(graded[0].payload.retryLabel).toBe("leader-assess-replace");
      expect(graded[0].payload.failed).toBe(true);
    });

    it("[A13] terminalEmitted guard — only ONE graded event per dim under any path", async () => {
      const deps = makeDeps();
      await runPerDimPipeline(baseArgs, deps);
      const graded = getGradedEmits(deps);
      expect(graded).toHaveLength(1); // happy path → exactly 1
    });

    it("[A14] partial chapter failure (1/2 writer fail) → still proceeds, eventually graded ok", async () => {
      const {
        ChapterWriterAgent,
        ChapterReviewerAgent,
        DimensionIntegratorAgent,
      } = {
        ChapterWriterAgent: jest.requireMock(
          "../../agents/writer/chapter-writer.agent",
        ).ChapterWriterAgent,
        ChapterReviewerAgent: jest.requireMock(
          "../../agents/writer/chapter-reviewer.agent",
        ).ChapterReviewerAgent,
        DimensionIntegratorAgent: jest.requireMock(
          "../../agents/writer/dimension-integrator.agent",
        ).DimensionIntegratorAgent,
      };
      let writerCallCount = 0;
      const invoker = {
        invoke: jest
          .fn()
          .mockImplementation((AgentClass: { new (): unknown }) => {
            if (AgentClass === ChapterWriterAgent) {
              writerCallCount++;
              // 第 1 次 writer fail，第 2 次 writer 成功
              if (writerCallCount === 1) {
                return Promise.resolve({
                  state: "failed",
                  output: undefined,
                  events: [],
                  iterations: 1,
                  wallTimeMs: 100,
                });
              }
              return Promise.resolve({
                state: "completed",
                output: makeWriterOutput(),
                events: [],
                iterations: 1,
                wallTimeMs: 100,
              });
            }
            if (AgentClass === ChapterReviewerAgent) {
              return Promise.resolve({
                state: "completed",
                output: makeReviewerOutput(),
                events: [],
                iterations: 1,
                wallTimeMs: 50,
              });
            }
            if (AgentClass === DimensionIntegratorAgent) {
              return Promise.resolve({
                state: "completed",
                output: makeIntegratorOutput(),
                events: [],
                iterations: 1,
                wallTimeMs: 200,
              });
            }
            return Promise.resolve({
              state: "failed",
              output: undefined,
              events: [],
              iterations: 1,
              wallTimeMs: 100,
            });
          }),
        tickCost: jest.fn().mockResolvedValue(undefined),
      };
      const deps = makeDeps({ invoker: invoker as never });
      await expect(runPerDimPipeline(baseArgs, deps)).rejects.toThrow(
        /expected 2 chapters, got 1/,
      );
      // 仍然有 graded 事件（failed 终态）
      const graded = getGradedEmits(deps);
      expect(graded).toHaveLength(1);
      expect(graded[0].payload.failed).toBe(true);
    });

    it("[A15] outline state=completed but output=undefined → graded(outline-failed)", async () => {
      const writer = {
        planDimensionOutline: jest.fn().mockResolvedValue({
          state: "completed",
          output: undefined, // schema 应该 reject 但 mock 模拟 LLM schema bug
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        }),
      };
      const deps = makeDeps({ writer: writer as never });
      await runPerDimPipeline(baseArgs, deps);
      const graded = getGradedEmits(deps);
      expect(graded).toHaveLength(1);
      expect(graded[0].payload.failed).toBe(true);
      expect(graded[0].payload.phase).toBe("outline-failed");
    });

    it("[A16] grade state=completed but output=undefined → graded(grade-failed)", async () => {
      const reviewer = {
        judgeDimension: jest.fn().mockResolvedValue({
          state: "completed",
          output: undefined, // judge LLM 返回但 schema 缺字段
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        }),
      };
      const deps = makeDeps({ reviewer: reviewer as never });
      await runPerDimPipeline(baseArgs, deps);
      const graded = getGradedEmits(deps);
      expect(graded).toHaveLength(1);
      expect(graded[0].payload.failed).toBe(true);
      expect(graded[0].payload.phase).toBe("grade-failed");
    });

    it("[A17] outline.chapters=[] (empty array but valid schema) → graded(no-chapters)", async () => {
      const writer = {
        planDimensionOutline: jest.fn().mockResolvedValue({
          state: "completed",
          output: { chapters: [] }, // 合法 schema 但 0 章
          events: [],
          iterations: 1,
          wallTimeMs: 100,
        }),
      };
      const deps = makeDeps({ writer: writer as never });
      await expect(runPerDimPipeline(baseArgs, deps)).rejects.toThrow(
        /0\/0 chapters produced/,
      );
      const graded = getGradedEmits(deps);
      expect(graded).toHaveLength(1);
      expect(graded[0].payload.failed).toBe(true);
      expect(graded[0].payload.phase).toBe("no-chapters");
    });

    it("[A18] verify graded event always carries dimension name + agentId", async () => {
      // 不论失败 / 成功 / 异常，graded 事件都必须有 dimension + quality-judge#X agentId
      // 让前端能精确路由到对应 dim pipeline
      const deps = makeDeps();
      await runPerDimPipeline(baseArgs, deps);
      const graded = getGradedEmits(deps);
      expect(graded[0].payload.dimension).toBe("Technology");
      expect(graded[0].agentId).toBe("quality-judge#0");
    });

    it("[A19] dimensionIdx propagated to gradeAgentId for parallel dims", async () => {
      const deps = makeDeps();
      await runPerDimPipeline(
        { ...baseArgs, dimensionIdx: 5, dimensionName: "Security" },
        deps,
      );
      const graded = getGradedEmits(deps);
      expect(graded[0].payload.dimension).toBe("Security");
      expect(graded[0].agentId).toBe("quality-judge#5");
    });

    it("[A20] emit failure inside emitGraded → swallowed (event lost but pipeline doesn't throw)", async () => {
      const deps = makeDeps();
      // 让 emit 在 graded 事件抛错（其他事件正常）
      const emitMock = deps.emit as jest.Mock;
      emitMock.mockImplementation((ev: { type: string }) => {
        if (ev.type === "playground.dimension:graded") {
          throw new Error("EVENT_BUS_DOWN");
        }
        return Promise.resolve(undefined);
      });
      // 不应该 throw
      const result = await runPerDimPipeline(baseArgs, deps);
      // pipeline 仍然返回结果（不阻断业务）
      expect(result.dimension).toBe("Technology");
    });
  });
});
