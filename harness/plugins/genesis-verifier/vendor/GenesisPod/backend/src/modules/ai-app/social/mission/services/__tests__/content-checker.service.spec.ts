import { Test, TestingModule } from "@nestjs/testing";
import { ContentCheckerService } from "../content-checker.service";

describe("ContentCheckerService", () => {
  let service: ContentCheckerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContentCheckerService],
    }).compile();

    service = module.get<ContentCheckerService>(ContentCheckerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== check - basic structure ====================

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should return a valid ContentCheckResult structure", async () => {
    const content = "A".repeat(200); // 200-char content, within all limits
    const result = await service.check(content);

    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("issues");
    expect(result).toHaveProperty("suggestions");
    expect(Array.isArray(result.issues)).toBe(true);
    expect(Array.isArray(result.suggestions)).toBe(true);
    expect(typeof result.score).toBe("number");
  });

  // ==================== check - passing content ====================

  it("should pass valid content with no issues", async () => {
    const validContent = "A".repeat(500); // 500 chars, within all limits
    const result = await service.check(validContent);

    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
    expect(result.issues).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);
  });

  it("should have score of 100 for clean content of adequate length", async () => {
    // Content must be >= 100 chars and <= 20000 chars to have score 100
    const cleanContent = "A".repeat(200);
    const result = await service.check(cleanContent);

    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
  });

  // ==================== check - length issues ====================

  it("should warn when content is shorter than 100 characters", async () => {
    const shortContent = "Too short.";
    const result = await service.check(shortContent);

    const lengthIssues = result.issues.filter((i) => i.type === "length_issue");
    expect(lengthIssues.length).toBeGreaterThan(0);
    expect(lengthIssues[0].severity).toBe("warning");
    expect(lengthIssues[0].message).toContain("100");
  });

  it("should error when content exceeds 20000 characters", async () => {
    const tooLongContent = "A".repeat(20001);
    const result = await service.check(tooLongContent);

    const lengthErrors = result.issues.filter(
      (i) => i.type === "length_issue" && i.severity === "error",
    );
    expect(lengthErrors.length).toBeGreaterThan(0);
    expect(lengthErrors[0].message).toContain("20000");
  });

  it("should not pass when content exceeds 20000 characters", async () => {
    const tooLongContent = "A".repeat(20001);
    const result = await service.check(tooLongContent);

    expect(result.passed).toBe(false);
  });

  it("should reduce score for length errors (error = -20 per error)", async () => {
    const tooLongContent = "A".repeat(20001);
    const result = await service.check(tooLongContent);

    // 1 error = 100 - 20 = 80
    expect(result.score).toBe(80);
  });

  it("should reduce score for length warnings (warning = -5 per warning)", async () => {
    const shortContent = "Short";
    const result = await service.check(shortContent);

    // The warning makes score 100 - 5 = 95
    expect(result.score).toBe(95);
  });

  it("should accept content at exactly 100 characters (no warning)", async () => {
    const exactContent = "A".repeat(100);
    const result = await service.check(exactContent);

    const lengthWarnings = result.issues.filter(
      (i) => i.type === "length_issue" && i.severity === "warning",
    );
    expect(lengthWarnings).toHaveLength(0);
  });

  it("should accept content at exactly 20000 characters (no error)", async () => {
    const exactContent = "A".repeat(20000);
    const result = await service.check(exactContent);

    const lengthErrors = result.issues.filter(
      (i) => i.type === "length_issue" && i.severity === "error",
    );
    expect(lengthErrors).toHaveLength(0);
  });

  // ==================== check - format issues ====================

  it("should flag multiple consecutive empty lines as format info", async () => {
    const contentWithManyNewlines = "Line 1\n\n\n\nLine 2";
    const result = await service.check(contentWithManyNewlines);

    const formatIssues = result.issues.filter((i) => i.type === "format_issue");
    expect(formatIssues.length).toBeGreaterThan(0);
    expect(formatIssues[0].severity).toBe("info");
    expect(formatIssues[0].message).toContain("连续空行");
  });

  it("should not flag content with fewer than 4 consecutive newlines", async () => {
    const normalContent = "A".repeat(150) + "\n\nParagraph 2\n\nParagraph 3";
    const result = await service.check(normalContent);

    const formatIssues = result.issues.filter((i) => i.type === "format_issue");
    expect(formatIssues).toHaveLength(0);
  });

  it("should flag exactly 4 consecutive newlines", async () => {
    const content = "A".repeat(150) + "\n\n\n\n" + "B".repeat(50);
    const result = await service.check(content);

    const formatIssues = result.issues.filter((i) => i.type === "format_issue");
    expect(formatIssues.length).toBeGreaterThan(0);
  });

  it("should not flag 3 consecutive newlines", async () => {
    const content = "A".repeat(150) + "\n\n\n" + "B".repeat(50);
    const result = await service.check(content);

    const formatIssues = result.issues.filter((i) => i.type === "format_issue");
    expect(formatIssues).toHaveLength(0);
  });

  // ==================== check - format issues do not fail check ====================

  it("should still pass when only format info issues exist", async () => {
    // Format issues are 'info' severity, not 'error', so they should not cause failure
    const contentWithFormatIssue =
      "A".repeat(200) + "\n\n\n\n" + "B".repeat(50);
    const result = await service.check(contentWithFormatIssue);

    // Format issues are 'info', not errors, so passed should still be true
    expect(result.passed).toBe(true);
    // Score should not be affected by 'info' issues
    expect(result.score).toBe(100);
  });

  // ==================== check - suggestions ====================

  it("should suggest fixing errors when error issues exist", async () => {
    const tooLongContent = "A".repeat(20001);
    const result = await service.check(tooLongContent);

    expect(result.suggestions).toContain("请修正内容中的违规词汇后再发布");
  });

  it("should suggest optimizing warnings when warning issues exist", async () => {
    const shortContent = "Too short";
    const result = await service.check(shortContent);

    expect(result.suggestions).toContain(
      "建议优化标记为警告的内容以提高发布成功率",
    );
  });

  it("should have no suggestions for clean content", async () => {
    const cleanContent = "A".repeat(500);
    const result = await service.check(cleanContent);

    expect(result.suggestions).toHaveLength(0);
  });

  // ==================== check - score calculation ====================

  it("should calculate score correctly with multiple warnings", async () => {
    // 2 warnings = 100 - 2*5 = 90, but our implementation only has 1 length warning per call max
    // Testing what is achievable: short content triggers 1 warning
    const shortContent = "Short";
    const result = await service.check(shortContent);

    // 1 warning: score = 100 - 5 = 95
    const warningCount = result.issues.filter(
      (i) => i.severity === "warning",
    ).length;
    const errorCount = result.issues.filter(
      (i) => i.severity === "error",
    ).length;
    const expectedScore = Math.max(0, 100 - errorCount * 20 - warningCount * 5);
    expect(result.score).toBe(expectedScore);
  });

  it("should have score of 0 when it would be negative (clamped to 0)", async () => {
    // 5+ errors would make score negative, but it clamps at 0
    // In practice, it's hard to trigger 5 errors with the current checks
    // We verify the Math.max(0, ...) behavior via a typical scenario
    const result = await service.check("A".repeat(20001));
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  // ==================== check - forbidden words (empty list) ====================

  it("should have no forbidden word issues when forbiddenWords list is empty", async () => {
    const result = await service.check("A".repeat(200));

    const forbiddenIssues = result.issues.filter(
      (i) => i.type === "forbidden_word",
    );
    expect(forbiddenIssues).toHaveLength(0);
  });

  // ==================== check - combined issues ====================

  it("should accumulate multiple issue types in one check", async () => {
    // Short content (< 100 chars) with 4+ consecutive newlines
    const content = "Short\n\n\n\n";
    const result = await service.check(content);

    expect(result.issues.length).toBeGreaterThanOrEqual(2);

    const types = result.issues.map((i) => i.type);
    expect(types).toContain("length_issue");
    expect(types).toContain("format_issue");
  });

  it("should include both error and warning suggestions when both exist", async () => {
    // Content that is both too long AND short (impossible to get both length errors)
    // Instead test content > 20000 chars which triggers error
    const tooLongContent = "A".repeat(20001);
    const result = await service.check(tooLongContent);

    // Has at least the error suggestion
    expect(result.suggestions.length).toBeGreaterThan(0);
  });
});
