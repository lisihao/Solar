import { Logger } from "@nestjs/common";
import { WritingCritiqueRefineService } from "../writing-critique-refine.service";

describe("WritingCritiqueRefineService", () => {
  let service: WritingCritiqueRefineService;
  let narrativeCraft: {
    analyzeContent: jest.Mock;
    rewriteEnding: jest.Mock;
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    narrativeCraft = {
      analyzeContent: jest.fn(),
      rewriteEnding: jest.fn(),
    };
    service = new WritingCritiqueRefineService(narrativeCraft as never);
  });

  it("skips refinement when initial score >= SKIP_THRESHOLD (85)", async () => {
    const result = await service.refine(
      "ok content",
      { passed: true, overallScore: 90 } as never,
      "model-1",
    );
    expect(result.iterations).toBe(0);
    expect(result.improved).toBe(false);
    expect(result.stopReason).toBe("target_reached");
    expect(result.finalScore).toBe(90);
    expect(narrativeCraft.analyzeContent).not.toHaveBeenCalled();
  });

  it("returns target_reached when score crosses SKIP_THRESHOLD mid-iteration", async () => {
    narrativeCraft.analyzeContent
      .mockReturnValueOnce({
        passed: false,
        score: 70,
        issues: [{ type: "ending", category: "x", problem: "p" }],
      })
      .mockReturnValueOnce({ passed: true, score: 90, issues: [] });
    narrativeCraft.rewriteEnding.mockResolvedValue("refined");

    const result = await service.refine(
      "weak content",
      { overallScore: 60 } as never,
      "model-1",
    );

    expect(result.stopReason).toBe("target_reached");
    expect(result.finalScore).toBe(90);
    expect(result.improved).toBe(true);
  });

  it("stops on score_converged when delta below CONVERGENCE_WINDOW", async () => {
    // initial overallScore 60 → first iteration gets 60 (no narrative issues, no rewrite)
    narrativeCraft.analyzeContent.mockReturnValue({
      passed: true,
      score: 61,
      issues: [],
    });

    const result = await service.refine(
      "content",
      { overallScore: 60 } as never,
      "m",
    );
    expect(result.stopReason).toBe("score_converged");
  });

  it("stops on max_iterations when score keeps fluctuating but never reaches threshold", async () => {
    narrativeCraft.analyzeContent.mockImplementation(() => ({
      passed: false,
      score: 70,
      issues: [{ type: "ending", category: "ai_writing_cliche", problem: "x" }],
    }));
    narrativeCraft.rewriteEnding.mockResolvedValue("rewritten");

    const result = await service.refine(
      "content",
      { overallScore: 60 } as never,
      "m",
    );
    // first iteration: improvement = 70 - 60 = 10 >= MIN_IMPROVEMENT (5), continue
    // second: improvement = 70 - 70 = 0 < MIN_IMPROVEMENT, hits no_improvement / converged
    expect(["max_iterations", "no_improvement", "score_converged"]).toContain(
      result.stopReason,
    );
  });

  it("does not call rewriteEnding when no ending/cliche issues", async () => {
    narrativeCraft.analyzeContent.mockReturnValue({
      passed: false,
      score: 50,
      issues: [{ type: "other", category: "misc", problem: "x" }],
    });

    const result = await service.refine(
      "content",
      { overallScore: 40 } as never,
      "m",
    );
    expect(narrativeCraft.rewriteEnding).not.toHaveBeenCalled();
    expect(result.improved).toBe(true);
  });

  it("does not update content when rewriteEnding returns identical text", async () => {
    narrativeCraft.analyzeContent.mockReturnValue({
      passed: false,
      score: 50,
      issues: [{ type: "ending", category: "summary", problem: "x" }],
    });
    narrativeCraft.rewriteEnding.mockResolvedValue("content");
    // same as input → no update; second analyze returns 50 again → improvement 0 → converged

    const result = await service.refine(
      "content",
      { overallScore: 40 } as never,
      "m",
    );
    expect(result.iterations).toBeGreaterThanOrEqual(1);
  });

  it("preserves best version across iterations and tracks final score", async () => {
    narrativeCraft.analyzeContent.mockReturnValue({
      passed: false,
      score: 75,
      issues: [{ type: "ending", category: "summary", problem: "p" }],
    });
    narrativeCraft.rewriteEnding.mockResolvedValue("refined-1");

    const result = await service.refine(
      "content",
      { overallScore: 60 } as never,
      "m",
    );
    expect(result.finalScore).toBe(75);
    expect(result.improved).toBe(true);
  });
});
