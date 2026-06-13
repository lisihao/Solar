/**
 * Utils Unit Tests
 *
 * 工具函数单元测试
 */

import {
  extractChapterKey,
  extractStructureHint,
  detectLargeContentTask,
  extractWordCount,
  findDuplicateChapters,
} from "../text-extraction.utils";
import {
  parsePriority,
  parseDependencies,
  extractMarkdownSection,
} from "../parsing.utils";
import {
  mapTaskType,
  truncateDescription,
  needsWebSearch,
  buildSearchQuery,
  truncateWithHeadTail,
} from "../misc.utils";
import {
  isRateLimitError,
  isPermanentError,
  isApiErrorContent,
  sleep,
} from "@/modules/ai-harness/facade";
import { TaskType } from "@prisma/client";

describe("Text Extraction Utils", () => {
  describe("extractChapterKey", () => {
    it("should extract chapter key from standard format", () => {
      expect(extractChapterKey("卷一·第1章 开端")).toBe("卷一第1章");
      expect(extractChapterKey("第一卷·第2章 冒险")).toBe("第一卷第2章");
      expect(extractChapterKey("第3章 启程")).toBe("第3章");
    });

    it("should extract chapter key with Chinese numbers", () => {
      expect(extractChapterKey("卷三第十二章 决战")).toBe("卷三第十二章");
      expect(extractChapterKey("第一章 序幕")).toBe("第一章");
    });

    it("should extract English chapter format", () => {
      // Note: implementation removes spaces when normalizing
      expect(extractChapterKey("Chapter 1: Introduction")).toBe("Chapter1");
      expect(extractChapterKey("Chapter 42")).toBe("Chapter42");
    });

    it("should return null for non-chapter titles", () => {
      expect(extractChapterKey("任务规划")).toBeNull();
      expect(extractChapterKey("设计文档")).toBeNull();
    });
  });

  describe("extractStructureHint", () => {
    it("should extract numeric volume hint", () => {
      const hint = extractStructureHint("请写一部8卷的小说");
      expect(hint).toContain("8 卷");
    });

    it("should extract Chinese number volume hint", () => {
      const hint = extractStructureHint("创作三卷武侠小说");
      expect(hint).toContain("三 卷");
    });

    it("should return empty string if no volume specified", () => {
      expect(extractStructureHint("写一篇文章")).toBe("");
    });
  });

  describe("detectLargeContentTask", () => {
    it("should detect novel writing task", () => {
      expect(detectLargeContentTask("创作一部8卷武侠小说")).toBe(true);
      expect(detectLargeContentTask("写一部玄幻连载故事")).toBe(true);
    });

    it("should detect task with quantity", () => {
      expect(detectLargeContentTask("12章的教程")).toBe(true);
      expect(detectLargeContentTask("5卷课程内容")).toBe(true);
    });

    it("should not detect simple tasks", () => {
      expect(detectLargeContentTask("写一封邮件")).toBe(false);
      expect(detectLargeContentTask("修复bug")).toBe(false);
    });
  });

  describe("extractWordCount", () => {
    it("should extract word count requirement", () => {
      expect(extractWordCount("每章3000字")).toBe("3000字");
      expect(extractWordCount("字数：5000")).toBe("字数：5000");
      // Note: first matching pattern wins, "字" pattern matches first
      expect(extractWordCount("不少于2000字")).toBe("2000字");
    });

    it("should return null if no word count", () => {
      expect(extractWordCount("随意发挥")).toBeNull();
    });
  });

  describe("findDuplicateChapters", () => {
    it("should find duplicate chapters", () => {
      const titles = ["卷一·第1章 开端", "卷一·第1章 重复", "卷一·第2章 发展"];
      const duplicates = findDuplicateChapters(titles);
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].key).toBe("卷一第1章");
      expect(duplicates[0].titles).toHaveLength(2);
    });

    it("should return empty array if no duplicates", () => {
      const titles = ["第1章 开端", "第2章 发展", "第3章 结局"];
      expect(findDuplicateChapters(titles)).toHaveLength(0);
    });
  });
});

describe("Parsing Utils", () => {
  describe("parsePriority", () => {
    it("should parse critical priority", () => {
      expect(parsePriority("关键")).toBe("CRITICAL");
      expect(parsePriority("Critical")).toBe("CRITICAL");
    });

    it("should parse high priority", () => {
      expect(parsePriority("高")).toBe("HIGH");
      expect(parsePriority("High")).toBe("HIGH");
    });

    it("should parse low priority", () => {
      expect(parsePriority("低")).toBe("LOW");
      expect(parsePriority("Low")).toBe("LOW");
    });

    it("should default to medium priority", () => {
      expect(parsePriority("中")).toBe("MEDIUM");
      expect(parsePriority("普通")).toBe("MEDIUM");
      expect(parsePriority("")).toBe("MEDIUM");
    });
  });

  describe("parseDependencies", () => {
    it("should parse dependency numbers", () => {
      expect(parseDependencies("1, 2")).toEqual([0, 1]);
      expect(parseDependencies("任务3, 任务4")).toEqual([2, 3]);
    });

    it("should return empty array for no dependencies", () => {
      expect(parseDependencies("无")).toEqual([]);
      expect(parseDependencies("-")).toEqual([]);
    });
  });

  describe("extractMarkdownSection", () => {
    it("should extract markdown section", () => {
      const content = `## 任务理解\n这是理解内容\n\n## 执行计划\n这是计划`;
      expect(extractMarkdownSection(content, "任务理解")).toBe("这是理解内容");
    });

    it("should return empty string if section not found", () => {
      const content = `## 其他内容\n一些文字`;
      expect(extractMarkdownSection(content, "任务理解")).toBe("");
    });
  });
});

describe("Misc Utils", () => {
  describe("mapTaskType", () => {
    it("should map task types correctly", () => {
      expect(mapTaskType("research")).toBe(TaskType.RESEARCH);
      expect(mapTaskType("design")).toBe(TaskType.DESIGN);
      expect(mapTaskType("implementation")).toBe(TaskType.IMPLEMENTATION);
      expect(mapTaskType("review")).toBe(TaskType.REVIEW);
    });

    it("should default to IMPLEMENTATION for unknown types", () => {
      expect(mapTaskType("unknown")).toBe(TaskType.IMPLEMENTATION);
      expect(mapTaskType("")).toBe(TaskType.IMPLEMENTATION);
    });

    it("should be case insensitive", () => {
      expect(mapTaskType("RESEARCH")).toBe(TaskType.RESEARCH);
      expect(mapTaskType("Design")).toBe(TaskType.DESIGN);
    });
  });

  describe("truncateDescription", () => {
    it("should not truncate short text", () => {
      const text = "Short text";
      expect(truncateDescription(text, 100)).toBe(text);
    });

    it("should truncate long text preserving head and tail", () => {
      const text = "A".repeat(200);
      const result = truncateDescription(text, 100, true);
      expect(result.length).toBeLessThan(200);
      expect(result).toContain("已省略");
    });

    it("should truncate without preserving tail when specified", () => {
      const text = "A".repeat(200);
      const result = truncateDescription(text, 100, false);
      expect(result).toContain("已截断");
    });
  });

  describe("needsWebSearch", () => {
    it("should detect realtime data needs", () => {
      expect(needsWebSearch("最新趋势分析", "", "", "")).toBe(true);
      expect(needsWebSearch("2025年市场报告", "", "", "")).toBe(true);
      expect(needsWebSearch("Latest news", "", "", "")).toBe(true);
    });

    it("should not require search for static content", () => {
      expect(needsWebSearch("写一篇小说", "", "", "")).toBe(false);
      expect(needsWebSearch("代码重构", "", "", "")).toBe(false);
    });
  });

  describe("buildSearchQuery", () => {
    it("should build search query from task info", () => {
      const query = buildSearchQuery(
        "AI市场分析",
        "调研OpenAI产品",
        "分析竞争格局",
      );
      expect(query).toContain("调研OpenAI产品");
    });

    it("should limit query length", () => {
      const longTitle = "A".repeat(150);
      const query = buildSearchQuery(longTitle, "", "");
      expect(query.length).toBeLessThanOrEqual(100);
    });
  });

  describe("truncateWithHeadTail", () => {
    it("should not truncate short text", () => {
      const text = "Short";
      expect(truncateWithHeadTail(text, 10, 10)).toBe(text);
    });

    it("should truncate preserving head and tail", () => {
      const text = "AAAAA" + "B".repeat(100) + "CCCCC";
      const result = truncateWithHeadTail(text, 5, 5);
      expect(result.startsWith("AAAAA")).toBe(true);
      expect(result.endsWith("CCCCC")).toBe(true);
      expect(result).toContain("已省略");
    });
  });
});

describe("Retry Utils", () => {
  describe("isRateLimitError", () => {
    it("should detect rate limit errors", () => {
      expect(isRateLimitError("Rate limit exceeded")).toBe(true);
      expect(isRateLimitError("Too many requests")).toBe(true);
      expect(isRateLimitError("Error 429")).toBe(true);
      expect(isRateLimitError("Quota exceeded")).toBe(true);
    });

    it("should not detect non-rate-limit errors", () => {
      expect(isRateLimitError("Connection timeout")).toBe(false);
      expect(isRateLimitError("Server error")).toBe(false);
    });
  });

  describe("isPermanentError", () => {
    it("should detect permanent errors", () => {
      expect(isPermanentError("Context too large")).toBe(true);
      expect(isPermanentError("Token limit exceeded")).toBe(true);
      expect(isPermanentError("Invalid API key")).toBe(true);
      expect(isPermanentError("Authentication failed")).toBe(true);
      expect(isPermanentError("403 Forbidden")).toBe(true);
    });

    it("should not detect temporary errors", () => {
      expect(isPermanentError("Connection timeout")).toBe(false);
      expect(isPermanentError("Service unavailable")).toBe(false);
    });
  });

  describe("isApiErrorContent", () => {
    it("should detect API error content", () => {
      expect(isApiErrorContent("API Error: Rate limit")).toBe(true);
      expect(isApiErrorContent("ECONNREFUSED")).toBe(true);
      expect(isApiErrorContent("500 Internal Server Error")).toBe(true);
    });

    it("should detect short error messages", () => {
      expect(isApiErrorContent("Error occurred")).toBe(true);
    });

    it("should not flag normal content", () => {
      expect(
        isApiErrorContent(
          "This is a normal response with sufficient length to be considered valid content.",
        ),
      ).toBe(false);
    });
  });

  describe("sleep", () => {
    it("should pause execution", async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });
  });
});
