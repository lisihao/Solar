/**
 * Tests for ContentCheckerService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ContentCheckerService } from "../mission/services/content-checker.service";

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

  describe("check", () => {
    it("should pass content that meets all requirements", async () => {
      const content = "A".repeat(150); // 150 chars, within limits

      const result = await service.check(content);

      expect(result.passed).toBe(true);
      expect(result.score).toBe(100);
      expect(result.issues).toHaveLength(0);
    });

    it("should warn for content that is too short (< 100 chars)", async () => {
      const content = "A".repeat(50); // 50 chars, too short

      const result = await service.check(content);

      expect(result.passed).toBe(true); // warnings don't fail check
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe("length_issue");
      expect(result.issues[0].severity).toBe("warning");
      expect(result.issues[0].message).toContain("内容过短");
    });

    it("should fail for content exceeding 20000 chars", async () => {
      const content = "A".repeat(20001);

      const result = await service.check(content);

      expect(result.passed).toBe(false);
      expect(
        result.issues.some(
          (i) => i.type === "length_issue" && i.severity === "error",
        ),
      ).toBe(true);
    });

    it("should detect multiple consecutive newlines", async () => {
      const content = "A".repeat(150) + "\n\n\n\n" + "B".repeat(50);

      const result = await service.check(content);

      expect(result.issues.some((i) => i.type === "format_issue")).toBe(true);
      expect(result.issues[0].severity).toBe("info");
    });

    it("should not flag 3 consecutive newlines (only 4+)", async () => {
      const content = "A".repeat(150) + "\n\n\n" + "B".repeat(50);

      const result = await service.check(content);

      expect(
        result.issues.filter((i) => i.type === "format_issue"),
      ).toHaveLength(0);
    });

    it("should calculate score based on error and warning count", async () => {
      // Content with 2 warnings: short (< 100) and format issue
      const content = "A".repeat(50) + "\n\n\n\n";

      const result = await service.check(content);

      // 0 errors, 1 warning + 1 info
      const warningCount = result.issues.filter(
        (i) => i.severity === "warning",
      ).length;
      const errorCount = result.issues.filter(
        (i) => i.severity === "error",
      ).length;
      const expectedScore = Math.max(
        0,
        100 - errorCount * 20 - warningCount * 5,
      );
      expect(result.score).toBe(expectedScore);
    });

    it("should score 0 when multiple errors present", async () => {
      // Long content that fails + triggers 5 errors would score 0
      const contentWith5Errors = "A".repeat(20001); // 1 error (too long), 0 warnings

      const result = await service.check(contentWith5Errors);

      expect(result.score).toBe(80); // 100 - 1*20 = 80
      expect(result.passed).toBe(false);
    });

    it("should provide suggestion for errors", async () => {
      const content = "A".repeat(20001);

      const result = await service.check(content);

      expect(result.suggestions).toContain("请修正内容中的违规词汇后再发布");
    });

    it("should provide suggestion for warnings", async () => {
      const content = "A".repeat(50); // short content triggers warning

      const result = await service.check(content);

      expect(result.suggestions).toContain(
        "建议优化标记为警告的内容以提高发布成功率",
      );
    });

    it("should have no suggestions for perfect content", async () => {
      const content = "A".repeat(200);

      const result = await service.check(content);

      expect(result.suggestions).toHaveLength(0);
    });

    it("should handle empty string content", async () => {
      const result = await service.check("");

      expect(result.passed).toBe(true); // empty is short, triggers warning
      expect(result.issues.some((i) => i.type === "length_issue")).toBe(true);
    });

    it("should return ContentCheckResult structure", async () => {
      const result = await service.check("Normal content " + "a".repeat(200));

      expect(result).toHaveProperty("passed");
      expect(result).toHaveProperty("score");
      expect(result).toHaveProperty("issues");
      expect(result).toHaveProperty("suggestions");
      expect(Array.isArray(result.issues)).toBe(true);
      expect(Array.isArray(result.suggestions)).toBe(true);
    });
  });
});
