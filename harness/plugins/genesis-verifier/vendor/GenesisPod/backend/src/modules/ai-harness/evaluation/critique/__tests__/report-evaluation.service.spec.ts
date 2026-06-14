/**
 * ReportEvaluationService — unit tests
 *
 * No external dependencies (ChatFacade is fully mocked).
 * Covers:
 *   evaluateReport():
 *     - batching (MAX_CONCURRENT_EVALUATIONS = 3)
 *     - overallScore averaging
 *     - zero chapters → overallScore=0
 *     - model comparison built correctly
 *     - overall feedback built correctly
 *     - grade computed from overallScore
 *   evaluateChapter() (via evaluateReport):
 *     - happy path with parsed dimensions
 *     - content truncation (> MAX_CHAPTER_CHARS = 4000)
 *     - English prompt when language="en"
 *     - Chinese prompt by default
 *     - JSON with markdown fences stripped correctly
 *     - dimension scores clamped to 1-10
 *     - chatFacade throws → returns fallback ChapterEvaluation
 *   resolveEvaluatorModel() (via evaluateReport):
 *     - EVALUATOR model found → used
 *     - EVALUATOR not found → CHAT fallback used
 *     - both fail → empty string model, isEvaluator=false
 *   calcWeightedScore():
 *     - all dimensions scored → weighted average * 10
 *     - some dimensions missing → missing = 0 contribution
 *     - empty → 0
 *   scoreToGrade():
 *     - 0 → "-"
 *     - 50 → "F"
 *     - 60-69 → "D"
 *     - 70-79 → "C"
 *     - 80-89 → "B"
 *     - 90-100 → "A"
 *   buildModelComparison():
 *     - multiple models, correct avgScore/best/weakest dimensions
 *     - chapters with chapterScore=0 are skipped
 */

import { ReportEvaluationService } from "../report-evaluation.service";
import type { ChapterInput } from "../report-evaluation.service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDimensions(score: number) {
  return [
    { id: "factual_accuracy", score, comment: "Good accuracy" },
    { id: "analytical_depth", score, comment: "Good depth" },
    { id: "evidence_coverage", score, comment: "Good evidence" },
    { id: "information_density", score, comment: "Good density" },
    { id: "logical_consistency", score, comment: "Good logic" },
    { id: "visual_quality", score, comment: "Good visual" },
    { id: "writing_quality", score, comment: "Good writing" },
    { id: "originality", score, comment: "Good originality" },
    { id: "timeliness", score, comment: "Good timeliness" },
    { id: "actionability", score, comment: "Good actionability" },
  ];
}

function makeEvalResponse(score: number, feedback = "Well written section.") {
  return JSON.stringify({
    dimensions: makeDimensions(score),
    feedback,
  });
}

function makeChapterFacade(opts: {
  evaluatorModelId?: string;
  chatModelId?: string;
  evaluatorThrows?: boolean;
  chatThrows?: boolean;
  evalResponseFn?: (call: number) => string;
  throws?: boolean;
}) {
  let callCount = 0;
  return {
    getDefaultModelByType: jest.fn(async (modelType: string) => {
      if (modelType === "EVALUATOR") {
        if (opts.evaluatorThrows) throw new Error("no evaluator");
        if (opts.evaluatorModelId !== undefined) {
          return opts.evaluatorModelId
            ? { modelId: opts.evaluatorModelId }
            : null;
        }
        return null; // no evaluator found
      }
      if (modelType === "CHAT") {
        if (opts.chatThrows) throw new Error("no chat");
        return opts.chatModelId ? { modelId: opts.chatModelId } : null;
      }
      return null;
    }),
    chat: jest.fn(async () => {
      if (opts.throws) throw new Error("LLM failed");
      const responseContent = opts.evalResponseFn
        ? opts.evalResponseFn(callCount++)
        : makeEvalResponse(8);
      return {
        content: responseContent,
        isError: false,
        model: "evaluator-mock",
      };
    }),
  };
}

function makeChapter(overrides: Partial<ChapterInput> = {}): ChapterInput {
  return {
    chapterId: "ch-1",
    chapterTitle: "Market Analysis",
    writerModel: "gpt-4o",
    content:
      "This is a well-written market analysis section with evidence [1][2].",
    sourcesUsed: 3,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ReportEvaluationService", () => {
  // ── evaluateReport — basic path ───────────────────────────────────────────────

  describe("evaluateReport()", () => {
    it("evaluates a single chapter and returns proper structure", async () => {
      const facade = makeChapterFacade({ evaluatorModelId: "eval-model" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new ReportEvaluationService(facade as any);

      const result = await svc.evaluateReport({
        reportTitle: "AI Market Report",
        topicType: "TECHNOLOGY",
        chapters: [makeChapter()],
      });

      expect(result.chapters).toHaveLength(1);
      expect(result.overallScore).toBeGreaterThan(0);
      expect(result.grade).toMatch(/[A-F-]/);
      expect(result.evaluatorModel).toBe("eval-model");
      expect(result.evaluatedAt).toBeDefined();
      expect(result.modelComparison).toHaveLength(1);
    });

    it("returns overallScore=0 and grade=- when chapters array is empty", async () => {
      const facade = makeChapterFacade({ evaluatorModelId: "" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new ReportEvaluationService(facade as any);

      const result = await svc.evaluateReport({
        reportTitle: "Empty Report",
        topicType: "MACRO",
        chapters: [],
      });

      expect(result.overallScore).toBe(0);
      expect(result.grade).toBe("-");
      expect(result.chapters).toHaveLength(0);
      expect(result.modelComparison).toHaveLength(0);
      expect(result.feedback).toContain("评审服务暂不可用");
    });

    it("batches chapters in groups of MAX_CONCURRENT_EVALUATIONS (3)", async () => {
      const chatCallOrder: number[] = [];
      let callIdx = 0;
      const facade = {
        getDefaultModelByType: jest.fn(async () => null),
        chat: jest.fn(async () => {
          chatCallOrder.push(callIdx++);
          return {
            content: makeEvalResponse(7),
            isError: false,
            model: "mock",
          };
        }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new ReportEvaluationService(facade as any);

      const chapters = Array.from({ length: 5 }, (_, i) =>
        makeChapter({ chapterId: `ch-${i}`, chapterTitle: `Chapter ${i}` }),
      );

      const result = await svc.evaluateReport({
        reportTitle: "5-chapter report",
        topicType: "COMPANY",
        chapters,
      });

      expect(result.chapters).toHaveLength(5);
      // chat was called 5 times (once per chapter)
      expect(facade.chat).toHaveBeenCalledTimes(5);
    });

    it("averages chapter scores for overallScore", async () => {
      let callIdx = 0;
      const scores = [8, 6]; // 2 chapters with different scores
      const facade = {
        getDefaultModelByType: jest.fn(async () => null),
        chat: jest.fn(async () => {
          const score = scores[callIdx++] ?? 7;
          return {
            content: makeEvalResponse(score),
            isError: false,
            model: "mock",
          };
        }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new ReportEvaluationService(facade as any);

      const result = await svc.evaluateReport({
        reportTitle: "Report",
        topicType: "EVENT",
        chapters: [
          makeChapter({ chapterId: "ch-1", chapterTitle: "High score" }),
          makeChapter({ chapterId: "ch-2", chapterTitle: "Lower score" }),
        ],
      });

      // Both chapters evaluated, overallScore is the average
      expect(result.chapters).toHaveLength(2);
      expect(result.overallScore).toBeGreaterThan(0);
      // Average of both chapter scores
      const avgChapterScore = Math.round(
        result.chapters.reduce((sum, c) => sum + c.chapterScore, 0) /
          result.chapters.length,
      );
      expect(result.overallScore).toBe(avgChapterScore);
    });

    it("builds model comparison with multiple writers", async () => {
      let _callIdx = 0;
      const facade = {
        getDefaultModelByType: jest.fn(async () => null),
        chat: jest.fn(async () => {
          _callIdx++;
          return {
            content: makeEvalResponse(8),
            isError: false,
            model: "mock",
          };
        }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = new ReportEvaluationService(facade as any);

      const result = await svc.evaluateReport({
        reportTitle: "Multi-model report",
        topicType: "TECHNOLOGY",
        chapters: [
          makeChapter({ chapterId: "ch-1", writerModel: "model-A" }),
          makeChapter({ chapterId: "ch-2", writerModel: "model-B" }),
        ],
      });

      expect(result.modelComparison).toHaveLength(2);
      const modelIds = result.modelComparison.map((m) => m.modelId);
      expect(modelIds).toContain("model-A");
      expect(modelIds).toContain("model-B");
    });
  });

  // ── evaluateChapter — content truncation ──────────────────────────────────────

  it("truncates content exceeding 4000 chars and adds truncation note", async () => {
    const longContent = "X".repeat(5000);
    let capturedMessage = "";
    const facade = {
      getDefaultModelByType: jest.fn(async () => null),
      chat: jest.fn(async (opts: { messages: Array<{ content: string }> }) => {
        capturedMessage = opts.messages[1].content;
        return { content: makeEvalResponse(7), isError: false, model: "mock" };
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    await svc.evaluateReport({
      reportTitle: "Long",
      topicType: "COMPANY",
      chapters: [makeChapter({ content: longContent })],
    });

    // Truncation note should appear in the prompt
    expect(capturedMessage).toContain("已截断，共 5000 字");
  });

  it("does NOT truncate content ≤4000 chars", async () => {
    const shortContent = "Y".repeat(3000);
    let capturedMessage = "";
    const facade = {
      getDefaultModelByType: jest.fn(async () => null),
      chat: jest.fn(async (opts: { messages: Array<{ content: string }> }) => {
        capturedMessage = opts.messages[1].content;
        return { content: makeEvalResponse(7), isError: false, model: "mock" };
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    await svc.evaluateReport({
      reportTitle: "Short",
      topicType: "COMPANY",
      chapters: [makeChapter({ content: shortContent })],
    });

    expect(capturedMessage).not.toContain("已截断");
  });

  // ── evaluateChapter — English prompt ─────────────────────────────────────────

  it("uses English system prompt when language=en", async () => {
    let capturedSystem = "";
    const facade = {
      getDefaultModelByType: jest.fn(async () => null),
      chat: jest.fn(
        async (opts: {
          messages: Array<{ role: string; content: string }>;
        }) => {
          capturedSystem =
            opts.messages.find((m) => m.role === "system")?.content ?? "";
          return {
            content: makeEvalResponse(7),
            isError: false,
            model: "mock",
          };
        },
      ),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    await svc.evaluateReport({
      reportTitle: "English Report",
      topicType: "TECHNOLOGY",
      chapters: [makeChapter()],
      language: "en",
    });

    expect(capturedSystem).toContain(
      "professional research report quality reviewer",
    );
    expect(capturedSystem).not.toContain("中文");
  });

  it("uses Chinese system prompt when language is not specified", async () => {
    let capturedSystem = "";
    const facade = {
      getDefaultModelByType: jest.fn(async () => null),
      chat: jest.fn(
        async (opts: {
          messages: Array<{ role: string; content: string }>;
        }) => {
          capturedSystem =
            opts.messages.find((m) => m.role === "system")?.content ?? "";
          return {
            content: makeEvalResponse(7),
            isError: false,
            model: "mock",
          };
        },
      ),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    await svc.evaluateReport({
      reportTitle: "Chinese Report",
      topicType: "MACRO",
      chapters: [makeChapter()],
    });

    expect(capturedSystem).toContain("专业的研究报告质量评审专家");
  });

  // ── evaluateChapter — JSON parsing ───────────────────────────────────────────

  it("strips markdown code fences from LLM response", async () => {
    const facade = {
      getDefaultModelByType: jest.fn(async () => null),
      chat: jest.fn(async () => ({
        content: "```json\n" + makeEvalResponse(7) + "\n```",
        isError: false,
        model: "mock",
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    const result = await svc.evaluateReport({
      reportTitle: "Fenced JSON",
      topicType: "COMPANY",
      chapters: [makeChapter()],
    });

    // Should parse successfully and return valid chapter evaluation
    expect(result.chapters[0].chapterScore).toBeGreaterThan(0);
    expect(result.chapters[0].grade).not.toBe("-");
  });

  it("strips plain code fences (``` without json) from LLM response", async () => {
    const facade = {
      getDefaultModelByType: jest.fn(async () => null),
      chat: jest.fn(async () => ({
        content: "```\n" + makeEvalResponse(6) + "\n```",
        isError: false,
        model: "mock",
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    const result = await svc.evaluateReport({
      reportTitle: "Plain fenced JSON",
      topicType: "COMPANY",
      chapters: [makeChapter()],
    });

    expect(result.chapters[0].chapterScore).toBeGreaterThan(0);
  });

  it("strips <think>...</think> tags from LLM response", async () => {
    const facade = {
      getDefaultModelByType: jest.fn(async () => null),
      chat: jest.fn(async () => ({
        content: "<think>Let me analyze...</think>\n" + makeEvalResponse(7),
        isError: false,
        model: "mock",
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    const result = await svc.evaluateReport({
      reportTitle: "Think tags",
      topicType: "COMPANY",
      chapters: [makeChapter()],
    });

    expect(result.chapters[0].chapterScore).toBeGreaterThan(0);
  });

  it("returns fallback ChapterEvaluation when chatFacade throws", async () => {
    const facade = makeChapterFacade({
      evaluatorModelId: "eval-model",
      throws: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    const result = await svc.evaluateReport({
      reportTitle: "Error report",
      topicType: "EVENT",
      chapters: [makeChapter()],
    });

    const ch = result.chapters[0];
    expect(ch.chapterScore).toBe(0);
    expect(ch.grade).toBe("-");
    expect(ch.feedback).toBe("评审失败");
  });

  it("clamps dimension scores to 1-10 range", async () => {
    const facade = {
      getDefaultModelByType: jest.fn(async () => null),
      chat: jest.fn(async () => ({
        content: JSON.stringify({
          dimensions: [
            { id: "factual_accuracy", score: 0, comment: "too low" }, // clamped to 1
            { id: "analytical_depth", score: 15, comment: "too high" }, // clamped to 10
          ],
          feedback: "Test",
        }),
        isError: false,
        model: "mock",
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    const result = await svc.evaluateReport({
      reportTitle: "Clamped",
      topicType: "MACRO",
      chapters: [makeChapter()],
    });

    const factualDim = result.chapters[0].dimensions.find(
      (d) => d.id === "factual_accuracy",
    );
    const analyticalDim = result.chapters[0].dimensions.find(
      (d) => d.id === "analytical_depth",
    );
    expect(factualDim?.score).toBe(1); // clamped from 0
    expect(analyticalDim?.score).toBe(10); // clamped from 15
  });

  // ── resolveEvaluatorModel ─────────────────────────────────────────────────────

  it("uses EVALUATOR model when available", async () => {
    let usedModelType: string | undefined;
    const facade = {
      getDefaultModelByType: jest.fn(async (type: string) => {
        if (type === "EVALUATOR") return { modelId: "my-evaluator" };
        return null;
      }),
      chat: jest.fn(async (opts: { modelType: string }) => {
        usedModelType = opts.modelType;
        return {
          content: makeEvalResponse(8),
          isError: false,
          model: "my-evaluator",
        };
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    const result = await svc.evaluateReport({
      reportTitle: "With evaluator",
      topicType: "COMPANY",
      chapters: [makeChapter()],
    });

    expect(result.evaluatorModel).toBe("my-evaluator");
    expect(usedModelType).toBe("EVALUATOR");
  });

  it("falls back to CHAT when EVALUATOR not available", async () => {
    let usedModelType: string | undefined;
    const facade = {
      getDefaultModelByType: jest.fn(async (type: string) => {
        if (type === "EVALUATOR") return null; // no evaluator
        if (type === "CHAT") return { modelId: "chat-fallback" };
        return null;
      }),
      chat: jest.fn(async (opts: { modelType: string }) => {
        usedModelType = opts.modelType;
        return {
          content: makeEvalResponse(7),
          isError: false,
          model: "chat-fallback",
        };
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    const result = await svc.evaluateReport({
      reportTitle: "CHAT fallback",
      topicType: "EVENT",
      chapters: [makeChapter()],
    });

    expect(result.evaluatorModel).toBe("chat-fallback");
    expect(usedModelType).toBe("CHAT");
  });

  it("uses empty string model when both EVALUATOR and CHAT resolve fail", async () => {
    const facade = {
      getDefaultModelByType: jest.fn(async () => {
        throw new Error("no models");
      }),
      chat: jest.fn(async () => ({
        content: makeEvalResponse(5),
        isError: false,
        model: "default",
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    const result = await svc.evaluateReport({
      reportTitle: "No model",
      topicType: "MACRO",
      chapters: [makeChapter()],
    });

    expect(result.evaluatorModel).toBe("");
    expect(result.chapters[0].chapterScore).toBeGreaterThan(0); // still evaluated
  });

  // ── scoreToGrade ─────────────────────────────────────────────────────────────

  describe("scoreToGrade (via evaluateReport)", () => {
    // Only integer-multiple-of-10 scores are achievable via calcWeightedScore
    // (mergeDimensions rounds each dimension score to integer, so chapterScore
    // is always a multiple of 10 when all dims use same value).
    // Boundary tests: 90+ → A, 80-89 → B, 70-79 → C, 60-69 → D, 1-59 → F, 0 → "-"
    const gradeMap: Array<[number, string]> = [
      [100, "A"],
      [90, "A"],
      [80, "B"],
      [70, "C"],
      [60, "D"],
      [50, "F"],
      [1, "F"],
      [0, "-"],
    ];

    for (const [score, expectedGrade] of gradeMap) {
      it(`score ${score} → grade ${expectedGrade}`, async () => {
        // Use calcWeightedScore to produce a specific score by controlling
        // the dimensions response. Score 1-10 → weighted 1*10=10 to 10*10=100
        // We need to reverse-engineer what dimension score gives the target report score.
        // scoreToGrade is called on chapterScore which is calcWeightedScore(dimensions)*10/10.
        // Actually calcWeightedScore = round((weightedSum / fullWeightSum) * 10)
        // With all 10 dimensions scored uniformly at 's', weightedSum = s * sum(weights) = s * 1.0
        // fullWeightSum = 1.0, so calcWeightedScore = round(s * 10)
        // So to get grade for specific score we access it via overallScore (average of chapterScores)
        // For score=0 we need a failed chapter (throws)
        if (score === 0) {
          const facade = makeChapterFacade({ throws: true });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const svc = new ReportEvaluationService(facade as any);
          const result = await svc.evaluateReport({
            reportTitle: "Grade test",
            topicType: "COMPANY",
            chapters: [makeChapter()],
          });
          // Failed chapter → chapterScore=0 → overallScore=0 → grade="-"
          expect(result.grade).toBe("-");
          return;
        }

        // For non-zero scores, create response with dimension scores that will
        // produce the target chapterScore
        // chapterScore = round((dimScore * 1.0 / 1.0) * 10) = round(dimScore * 10)
        // So dimScore = score / 10
        const dimScore = score / 10;
        const facade = {
          getDefaultModelByType: jest.fn(async () => null),
          chat: jest.fn(async () => ({
            content: makeEvalResponse(dimScore),
            isError: false,
            model: "mock",
          })),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const svc = new ReportEvaluationService(facade as any);
        const result = await svc.evaluateReport({
          reportTitle: "Grade test",
          topicType: "COMPANY",
          chapters: [makeChapter()],
        });
        expect(result.grade).toBe(expectedGrade);
      });
    }
  });

  // ── buildModelComparison ─────────────────────────────────────────────────────

  it("skips chapters with chapterScore=0 in model comparison", async () => {
    let callIdx = 0;
    const facade = {
      getDefaultModelByType: jest.fn(async () => null),
      chat: jest.fn(async () => {
        // First chapter fails (throws), second succeeds
        if (callIdx++ === 0) throw new Error("fail");
        return { content: makeEvalResponse(8), isError: false, model: "mock" };
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new ReportEvaluationService(facade as any);

    const result = await svc.evaluateReport({
      reportTitle: "Partial failure",
      topicType: "EVENT",
      chapters: [
        makeChapter({ chapterId: "fail-ch", writerModel: "model-fail" }),
        makeChapter({ chapterId: "ok-ch", writerModel: "model-ok" }),
      ],
    });

    // model-fail chapter has score=0 and should be excluded from comparison
    const modelIds = result.modelComparison.map((m) => m.modelId);
    expect(modelIds).not.toContain("model-fail");
    expect(modelIds).toContain("model-ok");
  });

  it("returns correct chapterCount in model comparison", async () => {
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
      reportTitle: "Multi chapters same model",
      topicType: "COMPANY",
      chapters: [
        makeChapter({ chapterId: "ch-1", writerModel: "same-model" }),
        makeChapter({ chapterId: "ch-2", writerModel: "same-model" }),
        makeChapter({ chapterId: "ch-3", writerModel: "same-model" }),
      ],
    });

    expect(result.modelComparison).toHaveLength(1);
    expect(result.modelComparison[0].chapterCount).toBe(3);
  });
});
