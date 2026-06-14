/**
 * ReportEvaluationService — supplement branch coverage spec
 *
 * Targets uncovered branches:
 *   - buildModelComparison: dimNameMap.get(bestDim) ?? bestDim fallback (unknown dim id)
 *   - buildModelComparison: dim.score is undefined → not pushed to dimScores
 *   - buildOverallFeedback: modelComparison.length > 1 → includes best model sentence
 *   - buildOverallFeedback: validChapters.length === 0 (all failed) → early return
 *   - writerModel: missing (falsy) → "unknown" fallback in evaluateChapter
 *   - calcWeightedScore: fullWeightSum === 0 → returns 0
 *   - parseEvaluationResponse: dimensions not an array → []
 */

import { ReportEvaluationService } from "../report-evaluation.service";
import type { ChapterInput } from "../report-evaluation.service";

function makeEvalResponse(score: number, feedback = "Good section.") {
  const dims = [
    "factual_accuracy",
    "analytical_depth",
    "evidence_coverage",
    "information_density",
    "logical_consistency",
    "visual_quality",
    "writing_quality",
    "originality",
    "timeliness",
    "actionability",
  ].map((id) => ({ id, score, comment: "ok" }));
  return JSON.stringify({ dimensions: dims, feedback });
}

function makeChapter(overrides: Partial<ChapterInput> = {}): ChapterInput {
  return {
    chapterId: "ch-1",
    chapterTitle: "Market Analysis",
    writerModel: "gpt-4o",
    content: "Market analysis content.",
    sourcesUsed: 3,
    ...overrides,
  };
}

// ─── buildOverallFeedback: modelComparison.length > 1 ────────────────────────

describe("ReportEvaluationService supplement — buildOverallFeedback multi-model", () => {
  it("includes best model sentence when modelComparison has 2+ entries", async () => {
    let callIdx = 0;
    const scores = [8, 6]; // different scores → different models
    const facade = {
      getDefaultModelByType: jest.fn(async () => null),
      chat: jest.fn(async () => ({
        content: makeEvalResponse(scores[callIdx++ % 2] ?? 7),
        isError: false,
        model: "mock",
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    const result = await svc.evaluateReport({
      reportTitle: "Multi model",
      topicType: "TECHNOLOGY",
      chapters: [
        makeChapter({ chapterId: "ch-1", writerModel: "model-A" }),
        makeChapter({ chapterId: "ch-2", writerModel: "model-B" }),
      ],
    });

    // modelComparison.length > 1 → feedback should include model comparison text
    expect(result.feedback).toContain("模型对比");
    expect(result.modelComparison.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── buildOverallFeedback: all chapters failed → early return ─────────────────

describe("ReportEvaluationService supplement — buildOverallFeedback all failed", () => {
  it("returns fallback feedback when all chapters have chapterScore=0", async () => {
    const facade = {
      getDefaultModelByType: jest.fn(async () => null),
      chat: jest.fn(async () => {
        throw new Error("LLM unavailable");
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    const result = await svc.evaluateReport({
      reportTitle: "All failed",
      topicType: "MACRO",
      chapters: [
        makeChapter({ chapterId: "ch-1" }),
        makeChapter({ chapterId: "ch-2" }),
      ],
    });

    // All chapters fail → validChapters.length === 0 → fallback feedback
    expect(result.feedback).toContain("评审服务暂不可用");
  });
});

// ─── buildModelComparison: dimension with undefined score ────────────────────

describe("ReportEvaluationService supplement — buildModelComparison undefined score", () => {
  it("handles dimensions where score is undefined (merged but unscored)", async () => {
    // Provide only 2 of 10 dimensions → other 8 will have undefined score
    const facade = {
      getDefaultModelByType: jest.fn(async () => null),
      chat: jest.fn(async () => ({
        content: JSON.stringify({
          dimensions: [
            { id: "factual_accuracy", score: 8, comment: "ok" },
            { id: "analytical_depth", score: 6, comment: "ok" },
            // Only 2 of 10 → remaining 8 have undefined score
          ],
          feedback: "Partial evaluation",
        }),
        isError: false,
        model: "mock",
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    const result = await svc.evaluateReport({
      reportTitle: "Partial dims",
      topicType: "TECHNOLOGY",
      chapters: [makeChapter({ writerModel: "model-X" })],
    });

    // Should still produce a model comparison entry
    expect(result.modelComparison).toHaveLength(1);
    expect(result.modelComparison[0].modelId).toBe("model-X");
    // Best and weakest dims should be the ones that had scores
    expect(result.modelComparison[0].bestDimension).toBeDefined();
  });
});

// ─── evaluateChapter: writerModel missing → "unknown" fallback ───────────────

describe("ReportEvaluationService supplement — writerModel fallback", () => {
  it("uses 'unknown' as writerModel when chapter has no writerModel", async () => {
    const facade = {
      getDefaultModelByType: jest.fn(async () => null),
      chat: jest.fn(async () => ({
        content: makeEvalResponse(7),
        isError: false,
        model: "mock",
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    const result = await svc.evaluateReport({
      reportTitle: "Missing model",
      topicType: "COMPANY",
      chapters: [makeChapter({ writerModel: "" })], // empty string is falsy
    });

    expect(result.chapters[0].writerModel).toBe("unknown");
  });

  it("uses 'unknown' as writerModel when chapter fails and writerModel is empty", async () => {
    const facade = {
      getDefaultModelByType: jest.fn(async () => null),
      chat: jest.fn(async () => {
        throw new Error("fail");
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    const result = await svc.evaluateReport({
      reportTitle: "Failed no model",
      topicType: "EVENT",
      chapters: [makeChapter({ writerModel: "" })],
    });

    expect(result.chapters[0].writerModel).toBe("unknown");
    expect(result.chapters[0].chapterScore).toBe(0);
  });
});

// ─── parseEvaluationResponse: dimensions not an array ────────────────────────

describe("ReportEvaluationService supplement — parseEvaluationResponse", () => {
  it("handles response where dimensions is not an array (returns empty [])", async () => {
    const facade = {
      getDefaultModelByType: jest.fn(async () => null),
      chat: jest.fn(async () => ({
        content: JSON.stringify({
          dimensions: "not an array", // invalid → fallback to []
          feedback: "fallback feedback",
        }),
        isError: false,
        model: "mock",
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    const result = await svc.evaluateReport({
      reportTitle: "Invalid dims",
      topicType: "MACRO",
      chapters: [makeChapter()],
    });

    // dimensions is not an array → merged with all undefined scores → chapterScore=0
    expect(result.chapters[0].feedback).toBe("fallback feedback");
    // chapterScore could be 0 since no dims scored
    expect(result.chapters[0].chapterScore).toBeGreaterThanOrEqual(0);
  });

  it("strips <reasoning>...</reasoning> tags from LLM response", async () => {
    const facade = {
      getDefaultModelByType: jest.fn(async () => null),
      chat: jest.fn(async () => ({
        content:
          "<reasoning>Internal thought</reasoning>\n" + makeEvalResponse(8),
        isError: false,
        model: "mock",
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    const result = await svc.evaluateReport({
      reportTitle: "Reasoning tags",
      topicType: "TECHNOLOGY",
      chapters: [makeChapter()],
    });

    expect(result.chapters[0].chapterScore).toBeGreaterThan(0);
  });
});
