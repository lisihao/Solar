/**
 * per-dim-pipeline.sanitize.spec.ts
 *
 * #G regression — 三道清理管线
 * 拆出独立 spec 文件，避免主 per-dim-pipeline.util.spec.ts 触碰 god-class 阈值。
 *
 * G-1: chapter writer 输出后（runChapterPipeline line 1003）
 * G-2: stitchedFullMarkdown 拼接前（per-dim-pipeline.util.ts line 1238）
 * G-3: 报告最终拼接后（assembler 已有，不在此 spec 覆盖）
 */

import { runPerDimPipeline } from "../helpers/per-dim-pipeline.util";
import type { PerDimPipelineArgs } from "../helpers/per-dim-pipeline.util";
import type { MissionDeps } from "../../context/mission-deps";

// ─── external module mocks（与主 spec 一致）─────────────────────────────────

jest.mock("p-limit", () => {
  const plimit = (_concurrency: number) => async (fn: () => Promise<unknown>) =>
    fn();
  return { __esModule: true, default: plimit };
});

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
  extractTokenSpend: jest.fn(() => ({ tokensUsed: 0, costUsd: 0 })),
  extractFailureMessage: jest.fn(() => undefined),
  extractAgentFailureDiagnostic: jest.fn(() => undefined),
  clampScore: jest.fn((n: number) =>
    Math.max(0, Math.min(100, Math.round(n || 0))),
  ),
  scaleScore: jest.fn((cur: number, factor: number) =>
    Math.max(0, Math.min(100, Math.round((cur || 0) * factor))),
  ),
  REVIEW_PASS_THRESHOLD: 60,
  CHAPTER_MAX_REVISION_ATTEMPTS: 1,
  jaccardSimilarity: jest.fn((a: string, b: string) => (a === b ? 1 : 0)),
  // R2-#50: narrate moved to harness facade
  narrate: jest.fn().mockResolvedValue(undefined),
  // P4 (2026-05-24): evidence-budget / batch-executor / grade-grounding shims
  // now delegate to harness — spec must supply the underlying symbols.
  computeSupplyBudget: jest.fn(
    (
      items: ReadonlyArray<{ source: string }>,
      keyOf: (i: { source: string }) => string,
      groupOf: (i: { source: string }) => string,
    ) => {
      const keys = new Set<string>();
      const groups = new Set<string>();
      for (const it of items) {
        const k = (keyOf(it) ?? "").trim().toLowerCase();
        if (!k) continue;
        keys.add(k);
        const g = (groupOf(it) ?? "").trim();
        if (g) groups.add(g);
      }
      return {
        uniqueKeys: keys.size,
        uniqueGroups: groups.size,
        totalItems: items.length,
      };
    },
  ),
  extractGroupFromUrlOrText: jest.fn((s: string) => (s ?? "").toLowerCase()),
  deriveMaxDemandSlots: jest.fn(
    (budget: { uniqueKeys: number }, ideal: number, min = 1) => {
      const byKeys = Math.floor(budget.uniqueKeys / 2);
      const natural = Math.max(1, Math.min(ideal, byKeys));
      const floor = Math.min(
        Math.max(1, min),
        ideal,
        Math.max(1, budget.uniqueKeys),
      );
      return Math.max(natural, floor);
    },
  ),
  deriveMinPerSlot: jest.fn((n: number) =>
    Math.min(2, Math.max(0, Math.floor(n))),
  ),
  executeBusinessTeamBatch: jest.fn(
    async <T extends { index: number }, S, R>(
      items: T[],
      _concurrency: number,
      snapshot: S,
      runOne: (item: T, s: S) => Promise<R | null>,
      onItemThrow: (item: T, err: unknown) => Promise<void>,
    ) => {
      const results: PromiseSettledResult<R | null>[] = [];
      for (const it of items) {
        try {
          const v = await runOne(it, snapshot);
          results.push({ status: "fulfilled", value: v });
        } catch (err) {
          await onItemThrow(it, err);
          results.push({ status: "fulfilled", value: null });
        }
      }
      return results;
    },
  ),
  groundMultiAxisGrade: jest.fn(
    (
      grade: { overall: number; grade: string; axes: unknown },
      uniqueSources: number,
    ) => {
      const axes = grade.axes as Record<
        string,
        { score: number; comment: string }
      >;
      const ceil = Math.min(100, Math.max(0, uniqueSources) * 20);
      if (axes["sources_sufficiency"]) {
        axes["sources_sufficiency"].score = Math.min(
          axes["sources_sufficiency"].score,
          ceil,
        );
      }
      const vals = Object.values(axes).map((a) => a.score);
      if (vals.length > 0) {
        grade.overall = Math.round(
          vals.reduce((a, b) => a + b, 0) / vals.length,
        );
        grade.grade =
          grade.overall >= 80
            ? "excellent"
            : grade.overall >= 65
              ? "good"
              : grade.overall >= 50
                ? "fair"
                : "poor";
      }
    },
  ),
}));

// ★ 模拟 stripChartJsonFromContent 让 spec 可独立验证"被调用"而不依赖真实 strip 逻辑
//   2026-05-08 PR-A1: facade 路径已上提到 ai-engine
jest.mock("@/modules/ai-engine/facade", () => {
  const actual = jest.requireActual("@/modules/ai-engine/facade");
  return {
    ...actual,
    stripChartJsonFromContent: jest.fn((body: string) =>
      body.replace(/```chartjs[\s\S]*?```/gi, ""),
    ),
  };
});

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

function makeOutlineOutput(chapterCount = 1) {
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
  const writer = {
    planDimensionOutline: jest.fn().mockResolvedValue({
      state: "completed",
      output: makeOutlineOutput(1),
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
  return {
    emit: jest.fn().mockResolvedValue(undefined),
    lifecycle: jest.fn().mockResolvedValue(undefined),
    invoker: {
      invoke: jest.fn(),
      tickCost: jest.fn().mockResolvedValue(undefined),
    },
    writer,
    reviewer,
    ...overrides,
  } as unknown as MissionDeps;
}

describe("G 三道清理管线 — chapter body sanitize", () => {
  it("[G1] chapter.body does not contain chartjs fence after pipeline", async () => {
    const substantiveProse =
      "This section provides a detailed analysis of the current market landscape. " +
      "Research evidence demonstrates significant growth in adoption rates across enterprise segments. " +
      "Key drivers include cost efficiency and competitive pressures that compel organizations to modernize.";
    const chartBody = [
      substantiveProse,
      "```chartjs",
      '{"type":"bar","data":{"labels":["A","B"],"datasets":[{"data":[1,2]}]}}',
      "```",
      "Further analysis confirms these findings align with industry benchmarks.",
    ].join("\n");

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
      invoke: jest
        .fn()
        .mockImplementation((AgentClass: { new (): unknown }) => {
          if (AgentClass === ChapterWriterAgent) {
            return Promise.resolve({
              state: "completed",
              output: { body: chartBody, wordCount: 800, citationsUsed: [] },
              events: [],
              iterations: 1,
              wallTimeMs: 100,
            });
          }
          if (AgentClass === ChapterReviewerAgent) {
            return Promise.resolve({
              state: "completed",
              output: {
                decision: "pass",
                score: 85,
                summary: "OK",
                issues: [],
              },
              events: [],
              iterations: 1,
              wallTimeMs: 50,
            });
          }
          if (AgentClass === DimensionIntegratorAgent) {
            return Promise.resolve({
              state: "completed",
              output: {
                abstract: "Abstract",
                keyFindings: ["Finding"],
                fullMarkdown: "# Dim\n\nContent",
                totalWordCount: 800,
              },
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

    expect(result.chapters).toBeDefined();
    expect(result.chapters!.length).toBeGreaterThan(0);
    for (const ch of result.chapters!) {
      expect(ch.body).not.toContain("```chartjs");
    }
  });

  it("[G2] fullMarkdown does not contain chartjs fence after stitch sanitize", async () => {
    const substantiveProse =
      "Comprehensive evaluation of competitive dynamics reveals structural shifts in the industry. " +
      "Organizations that adapt early capture disproportionate value while laggards face margin compression. " +
      "These patterns are consistent with prior technology adoption cycles documented in academic literature.";
    const chartBody =
      substantiveProse +
      '\n```chartjs\n{"type":"line"}\n```\nConclusion follows from the evidence above.';

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
      invoke: jest
        .fn()
        .mockImplementation((AgentClass: { new (): unknown }) => {
          if (AgentClass === ChapterWriterAgent) {
            return Promise.resolve({
              state: "completed",
              output: { body: chartBody, wordCount: 600, citationsUsed: [] },
              events: [],
              iterations: 1,
              wallTimeMs: 100,
            });
          }
          if (AgentClass === ChapterReviewerAgent) {
            return Promise.resolve({
              state: "completed",
              output: {
                decision: "pass",
                score: 90,
                summary: "OK",
                issues: [],
              },
              events: [],
              iterations: 1,
              wallTimeMs: 50,
            });
          }
          if (AgentClass === DimensionIntegratorAgent) {
            return Promise.resolve({
              state: "completed",
              output: {
                abstract: "Abstract",
                keyFindings: [],
                fullMarkdown: "# Dim\n\nClean",
                totalWordCount: 600,
              },
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

    expect(result.fullMarkdown).toBeDefined();
    expect(result.fullMarkdown!).not.toContain("```chartjs");
  });
});
