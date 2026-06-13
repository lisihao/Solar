import { Test, TestingModule } from "@nestjs/testing";
import {
  OutputValidatorService,
  OutlineStructure,
  OutlineValidationConfig,
  ChapterValidationConfig,
} from "../output-validator.service";

describe("OutputValidatorService", () => {
  let service: OutputValidatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OutputValidatorService],
    }).compile();

    service = module.get<OutputValidatorService>(OutputValidatorService);
  });

  describe("validateJsonCompleteness", () => {
    it("should return invalid for empty string", () => {
      const result = service.validateJsonCompleteness("");
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe("json_empty");
      expect(result.issues[0].severity).toBe("ERROR");
    });

    it("should return invalid for whitespace-only string", () => {
      const result = service.validateJsonCompleteness("   ");
      expect(result.valid).toBe(false);
      expect(result.issues[0].type).toBe("json_empty");
    });

    it("should return valid for correct JSON object", () => {
      const result = service.validateJsonCompleteness('{"key": "value"}');
      expect(result.valid).toBe(true);
      expect(result.issues.filter((i) => i.severity === "ERROR")).toHaveLength(
        0,
      );
    });

    it("should return valid for correct JSON array", () => {
      const result = service.validateJsonCompleteness('[{"id": 1}, {"id": 2}]');
      expect(result.valid).toBe(true);
    });

    it("should detect mismatched curly braces", () => {
      const result = service.validateJsonCompleteness('{"key": "value"');
      expect(result.valid).toBe(false);
      const bracketIssue = result.issues.find(
        (i) => i.type === "bracket_mismatch",
      );
      expect(bracketIssue).toBeDefined();
    });

    it("should detect mismatched square brackets", () => {
      const result = service.validateJsonCompleteness("[1, 2, 3");
      expect(result.valid).toBe(false);
      const bracketIssue = result.issues.find(
        (i) => i.type === "bracket_mismatch",
      );
      expect(bracketIssue).toBeDefined();
    });

    it("should detect trailing comma as warning", () => {
      const result = service.validateJsonCompleteness('{"key": "value",}');
      const trailingCommaIssue = result.issues.find(
        (i) => i.type === "trailing_comma",
      );
      expect(trailingCommaIssue).toBeDefined();
      expect(trailingCommaIssue?.severity).toBe("WARNING");
    });

    it("should detect JSON parse errors", () => {
      const result = service.validateJsonCompleteness("{invalid json}");
      expect(result.valid).toBe(false);
      const parseError = result.issues.find(
        (i) => i.type === "json_parse_error",
      );
      expect(parseError).toBeDefined();
    });

    it("should include metadata with duration and timestamp", () => {
      const result = service.validateJsonCompleteness('{"key": "value"}');
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.duration).toBeGreaterThanOrEqual(0);
      expect(result.metadata?.timestamp).toBeInstanceOf(Date);
    });
  });

  describe("validateOutline", () => {
    const makeOutline = (chapterCount: number): OutlineStructure => ({
      chapters: Array.from({ length: chapterCount }, (_, i) => ({
        chapterNumber: i + 1,
        title: `第${i + 1}章：精彩的故事标题`,
        summary: "这是章节摘要，描述了章节的主要内容。",
        estimatedWordCount: 3000,
      })),
    });

    const defaultConfig: OutlineValidationConfig = {
      targetTotalWordCount: 100000,
      targetChapterWordCount: 3000,
    };

    it("should validate a correct outline successfully", () => {
      const outline = makeOutline(34);
      const result = service.validateOutline(outline, defaultConfig);
      expect(result.valid).toBe(true);
      expect(result.issues.filter((i) => i.severity === "ERROR")).toHaveLength(
        0,
      );
    });

    it("should report error for insufficient chapter count", () => {
      const outline = makeOutline(5);
      const result = service.validateOutline(outline, defaultConfig);
      expect(result.valid).toBe(false);
      const countIssue = result.issues.find(
        (i) => i.type === "insufficient_chapters",
      );
      expect(countIssue).toBeDefined();
      expect(countIssue?.severity).toBe("ERROR");
    });

    it("should report warning for title duplication (2 times)", () => {
      const outline: OutlineStructure = {
        chapters: [
          { chapterNumber: 1, title: "相同标题" },
          { chapterNumber: 2, title: "相同标题" },
          { chapterNumber: 3, title: "另一个标题" },
        ],
      };
      const config: OutlineValidationConfig = {
        targetTotalWordCount: 9000,
        targetChapterWordCount: 3000,
      };
      const result = service.validateOutline(outline, config);
      const dupIssue = result.issues.find((i) => i.type === "title_duplicate");
      expect(dupIssue).toBeDefined();
      expect(dupIssue?.severity).toBe("WARNING");
    });

    it("should report error for title duplication more than 2 times", () => {
      const outline: OutlineStructure = {
        chapters: [
          { chapterNumber: 1, title: "相同标题" },
          { chapterNumber: 2, title: "相同标题" },
          { chapterNumber: 3, title: "相同标题" },
        ],
      };
      const config: OutlineValidationConfig = {
        targetTotalWordCount: 9000,
        targetChapterWordCount: 3000,
      };
      const result = service.validateOutline(outline, config);
      const dupIssue = result.issues.find(
        (i) => i.type === "title_duplication",
      );
      expect(dupIssue).toBeDefined();
      expect(dupIssue?.severity).toBe("ERROR");
    });

    it("should report error for empty title", () => {
      const outline: OutlineStructure = {
        chapters: [{ chapterNumber: 1, title: "" }],
      };
      const config: OutlineValidationConfig = {
        targetTotalWordCount: 3000,
        targetChapterWordCount: 3000,
      };
      const result = service.validateOutline(outline, config);
      const emptyTitleIssue = result.issues.find(
        (i) => i.type === "empty_title",
      );
      expect(emptyTitleIssue).toBeDefined();
    });

    it("should report warning for short title", () => {
      const outline: OutlineStructure = {
        chapters: [{ chapterNumber: 1, title: "短" }],
      };
      const config: OutlineValidationConfig = {
        targetTotalWordCount: 3000,
        targetChapterWordCount: 3000,
      };
      const result = service.validateOutline(outline, config);
      const shortTitleIssue = result.issues.find(
        (i) => i.type === "title_too_short",
      );
      expect(shortTitleIssue).toBeDefined();
    });

    it("should report warning for generic title containing forbidden keyword", () => {
      const outline: OutlineStructure = {
        chapters: [{ chapterNumber: 1, title: "第一章章节内容" }],
      };
      const config: OutlineValidationConfig = {
        targetTotalWordCount: 3000,
        targetChapterWordCount: 3000,
      };
      const result = service.validateOutline(outline, config);
      const genericIssue = result.issues.find(
        (i) => i.type === "generic_title",
      );
      expect(genericIssue).toBeDefined();
    });

    it("should report warning for non-sequential chapter numbers", () => {
      const outline: OutlineStructure = {
        chapters: [
          { chapterNumber: 1, title: "第一章：开始" },
          { chapterNumber: 3, title: "第三章：结局" },
        ],
      };
      const config: OutlineValidationConfig = {
        targetTotalWordCount: 6000,
        targetChapterWordCount: 3000,
      };
      const result = service.validateOutline(outline, config);
      const numIssue = result.issues.find(
        (i) => i.type === "chapter_number_mismatch",
      );
      expect(numIssue).toBeDefined();
    });

    it("should run strict mode checks when enabled", () => {
      const outline: OutlineStructure = {
        chapters: [
          {
            chapterNumber: 1,
            title: "第一章：一个很好的故事",
            summary: "",
            estimatedWordCount: 10000,
          },
        ],
      };
      const config: OutlineValidationConfig = {
        targetTotalWordCount: 3000,
        targetChapterWordCount: 3000,
        strictMode: true,
      };
      const result = service.validateOutline(outline, config);
      const missingSummaryIssue = result.issues.find(
        (i) => i.type === "missing_summary",
      );
      expect(missingSummaryIssue).toBeDefined();
      const wordCountIssue = result.issues.find(
        (i) => i.type === "word_count_deviation",
      );
      expect(wordCountIssue).toBeDefined();
    });
  });

  describe("validateChapterContent", () => {
    const defaultConfig: ChapterValidationConfig = {
      targetWordCount: 3000,
    };

    it("should return invalid for empty content", () => {
      const result = service.validateChapterContent("", defaultConfig);
      expect(result.valid).toBe(false);
      expect(result.issues[0].type).toBe("empty_content");
    });

    it("should return invalid when word count is below minimum absolute threshold", () => {
      const shortContent = "这是很短的内容。\n\n还有一段。";
      const result = service.validateChapterContent(shortContent, {
        targetWordCount: 10000,
      });
      expect(result.valid).toBe(false);
      const wordCountIssue = result.issues.find(
        (i) => i.type === "insufficient_word_count",
      );
      expect(wordCountIssue).toBeDefined();
    });

    it("should return valid for content meeting word count requirement", () => {
      const longContent =
        "这是一段很长的内容，包含了足够多的中文字符。\n\n".repeat(100) +
        "最后一段内容结束。";
      const result = service.validateChapterContent(longContent, {
        targetWordCount: 500,
      });
      expect(result.valid).toBe(true);
    });

    it("should check format when checkFormat is true", () => {
      const contentWithMarkdown =
        "# 标题\n\n这是正文内容，足够长的文章，中文内容测试用文字占位，保证字数达标要求。".repeat(
          20,
        );
      const result = service.validateChapterContent(contentWithMarkdown, {
        targetWordCount: 100,
        checkFormat: true,
      });
      const markdownIssue = result.issues.find(
        (i) => i.type === "markdown_headers",
      );
      expect(markdownIssue).toBeDefined();
    });

    it("should check dialogue when checkDialogue is true", () => {
      const contentWithMixedQuotes =
        '"这是双引号"，「这是直角引号」'.repeat(10) +
        "正文内容正文内容正文内容正文内容正文内容正文内容".repeat(20);
      const result = service.validateChapterContent(contentWithMixedQuotes, {
        targetWordCount: 100,
        checkDialogue: true,
      });
      const mixedQuoteIssue = result.issues.find(
        (i) => i.type === "mixed_quote_styles",
      );
      expect(mixedQuoteIssue).toBeDefined();
    });

    it("should include metadata", () => {
      const content =
        "这是一段测试内容，用于验证元数据的正确性。内容足够长。".repeat(20);
      const result = service.validateChapterContent(content, defaultConfig);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.timestamp).toBeInstanceOf(Date);
    });
  });

  describe("validateMultipleChapters", () => {
    it("should validate multiple chapters and return array of results", async () => {
      const chapters = [
        { content: "内容一".repeat(200), targetWordCount: 300 },
        { content: "内容二".repeat(200), targetWordCount: 300 },
      ];
      const results = await service.validateMultipleChapters(chapters);
      expect(results).toHaveLength(2);
      expect(results[0].valid).toBe(true);
      expect(results[1].valid).toBe(true);
    });

    it("should return invalid result for chapters with insufficient content", async () => {
      const chapters = [{ content: "", targetWordCount: 3000 }];
      const results = await service.validateMultipleChapters(chapters);
      expect(results[0].valid).toBe(false);
    });
  });

  describe("generateValidationSummary", () => {
    it("should aggregate results correctly", () => {
      const results = [
        {
          valid: true,
          issues: [
            { severity: "WARNING" as const, type: "w1", message: "msg" },
          ],
        },
        {
          valid: false,
          issues: [
            { severity: "ERROR" as const, type: "e1", message: "msg" },
            { severity: "INFO" as const, type: "i1", message: "msg" },
          ],
        },
      ];
      const summary = service.generateValidationSummary(results);
      expect(summary.totalIssues).toBe(3);
      expect(summary.errorCount).toBe(1);
      expect(summary.warningCount).toBe(1);
      expect(summary.infoCount).toBe(1);
      expect(summary.validCount).toBe(1);
      expect(summary.issuesByType["w1"]).toBe(1);
      expect(summary.issuesByType["e1"]).toBe(1);
    });

    it("should handle empty results array", () => {
      const summary = service.generateValidationSummary([]);
      expect(summary.totalIssues).toBe(0);
      expect(summary.validCount).toBe(0);
    });
  });
});
