import { WritingContentGateService } from "../writing-content-gate.service";

describe("WritingContentGateService", () => {
  let service: WritingContentGateService;
  let narrativeCraft: {
    analyzeContent: jest.Mock;
  };

  const buildContent = (paragraphs: number, paraLen: number) =>
    Array.from({ length: paragraphs }, () => "x".repeat(paraLen)).join("\n\n");

  beforeEach(() => {
    narrativeCraft = {
      analyzeContent: jest.fn().mockReturnValue({
        passed: true,
        score: 90,
        issues: [],
      }),
    };
    service = new WritingContentGateService(narrativeCraft as never);
  });

  it("passes when narrative craft passes and content is rich", () => {
    const content = buildContent(5, 200) + "「 你好 」";
    const verdict = service.evaluate(content, "p1");
    expect(verdict.passed).toBe(true);
    expect(verdict.scores.narrativeCraft).toBe(90);
    expect(verdict.scores.consistency).toBe(80);
    expect(verdict.issues).toHaveLength(0);
  });

  it("includes narrative issues in result with proper severity", () => {
    narrativeCraft.analyzeContent.mockReturnValue({
      passed: false,
      score: 40,
      issues: [
        { type: "ending", category: "summary", problem: "summary ending" },
        { type: "cliche", category: "ai_writing_cliche", problem: "trope" },
      ],
    });
    const content = buildContent(3, 100);
    const verdict = service.evaluate(content, "p1", { chapterNumber: 1 });
    expect(verdict.issues).toHaveLength(2);
    expect(verdict.issues[0].severity).toBe("error");
    expect(verdict.issues[1].severity).toBe("warning");
  });

  it("calculates lower coherence when paragraphs < 3", () => {
    narrativeCraft.analyzeContent.mockReturnValue({
      passed: true,
      score: 80,
      issues: [],
    });
    const verdict = service.evaluate("一段内容", "p1");
    expect(verdict.scores.coherence).toBeLessThanOrEqual(80);
  });

  it("rewards content with English-style quotation marks", () => {
    narrativeCraft.analyzeContent.mockReturnValue({
      passed: true,
      score: 80,
      issues: [],
    });
    const text = buildContent(5, 200) + "“ hello ”";
    const verdict = service.evaluate(text, "p1");
    expect(verdict.scores.coherence).toBeGreaterThanOrEqual(80);
  });

  it("calculates completeness with high word count and chapter heading", () => {
    narrativeCraft.analyzeContent.mockReturnValue({
      passed: true,
      score: 80,
      issues: [],
    });
    const heading = "第一章 起点";
    const body = "x".repeat(2600);
    const verdict = service.evaluate(`${heading}\n\n${body}`, "p1");
    expect(verdict.scores.completeness).toBeGreaterThanOrEqual(90);
  });

  it("partial completeness bonus when 1500 <= words < 2500", () => {
    narrativeCraft.analyzeContent.mockReturnValue({
      passed: true,
      score: 80,
      issues: [],
    });
    const verdict = service.evaluate("a".repeat(1800), "p1");
    expect(verdict.scores.completeness).toBeGreaterThanOrEqual(80);
  });

  it("low word count caps wordCount score", () => {
    narrativeCraft.analyzeContent.mockReturnValue({
      passed: true,
      score: 80,
      issues: [],
    });
    const verdict = service.evaluate("a".repeat(500), "p1");
    expect(verdict.scores.wordCount).toBeLessThan(50);
  });

  it("coherence score floors at 0 and ceils at 100", () => {
    narrativeCraft.analyzeContent.mockReturnValue({
      passed: true,
      score: 80,
      issues: [],
    });
    // very long single paragraph (paragraphs<3 → -20)
    const v = service.evaluate("a".repeat(50), "p1");
    expect(v.scores.coherence).toBeGreaterThanOrEqual(0);
    expect(v.scores.coherence).toBeLessThanOrEqual(100);
  });

  it("fails overall when score below MIN_OVERALL_SCORE (70)", () => {
    narrativeCraft.analyzeContent.mockReturnValue({
      passed: false,
      score: 10,
      issues: [{ type: "ending", category: "x", problem: "y" }],
    });
    const verdict = service.evaluate("短", "p1");
    expect(verdict.passed).toBe(false);
  });
});
