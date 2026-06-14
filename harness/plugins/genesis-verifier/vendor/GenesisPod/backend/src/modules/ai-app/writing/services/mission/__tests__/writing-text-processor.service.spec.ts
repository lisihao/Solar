import { WritingTextProcessorService } from "../writing-text-processor.service";

describe("WritingTextProcessorService", () => {
  let service: WritingTextProcessorService;

  beforeEach(() => {
    service = new WritingTextProcessorService();
  });

  describe("numberToChinese", () => {
    it("converts 0-10", () => {
      expect(service.numberToChinese(0)).toBe("零");
      expect(service.numberToChinese(5)).toBe("五");
      expect(service.numberToChinese(10)).toBe("十");
    });
    it("converts 11-19 with 十X", () => {
      expect(service.numberToChinese(11)).toBe("十一");
      expect(service.numberToChinese(19)).toBe("十九");
    });
    it("converts 20-99", () => {
      expect(service.numberToChinese(20)).toBe("二十");
      expect(service.numberToChinese(35)).toBe("三十五");
      expect(service.numberToChinese(99)).toBe("九十九");
    });
    it("falls back to digits for >=100", () => {
      expect(service.numberToChinese(100)).toBe("100");
      expect(service.numberToChinese(2024)).toBe("2024");
    });
  });

  describe("countWords", () => {
    it("counts only Chinese characters", () => {
      expect(service.countWords("你好世界")).toBe(4);
    });
    it("counts English words", () => {
      expect(service.countWords("hello world foo")).toBe(3);
    });
    it("counts mixed Chinese + English", () => {
      expect(service.countWords("你好 hello")).toBe(3);
    });
    it("returns 0 for empty string", () => {
      expect(service.countWords("")).toBe(0);
    });
  });

  describe("extractChapterTitle", () => {
    it("extracts title with colon format", () => {
      expect(service.extractChapterTitle("第一章：起点", 1)).toBe("起点");
      expect(service.extractChapterTitle("第二章: 旅程", 2)).toBe("旅程");
    });
    it("extracts title with hui (回) sub-format", () => {
      expect(service.extractChapterTitle("第一章 第一回 旅程开始", 1)).toBe(
        "旅程开始",
      );
    });
    it("extracts plain '第X章 标题' format", () => {
      expect(service.extractChapterTitle("第三章 终点", 3)).toBe("终点");
    });
    it("strips markdown heading marks", () => {
      expect(service.extractChapterTitle("# 第一章 起点", 1)).toBe("起点");
      expect(service.extractChapterTitle("### 第二章：旅程", 2)).toBe("旅程");
    });
    it("returns default when no pattern matches", () => {
      expect(service.extractChapterTitle("plain content", 7)).toBe("第7章");
    });
    it("falls back to subsequent lines for hui-only chapters", () => {
      const content = "第一章 第一回\n\n命运的开端\n继续";
      const t = service.extractChapterTitle(content, 1);
      expect(t.length).toBeGreaterThanOrEqual(4);
    });
    it("uses default when only chapter heading without title", () => {
      expect(service.extractChapterTitle("第一章", 1)).toBe("第1章");
    });
  });

  describe("extractFallbackContent", () => {
    it("returns string deliverable content if length > 100", () => {
      const result = {
        deliverables: [{ content: "x".repeat(150) }],
      };
      expect(service.extractFallbackContent(result as never, {} as never)).toBe(
        "x".repeat(150),
      );
    });

    it("ignores short string deliverable", () => {
      const result = { deliverables: [{ content: "short" }] };
      expect(
        service.extractFallbackContent(result as never, {} as never),
      ).toBeUndefined();
    });

    it("extracts from outputs array as object.output", () => {
      const longText = "y".repeat(200);
      const result = {
        deliverables: [{ content: { outputs: [{ output: longText }] } }],
      };
      expect(service.extractFallbackContent(result as never, {} as never)).toBe(
        longText,
      );
    });

    it("extracts from outputs array as plain string", () => {
      const longText = "z".repeat(200);
      const result = {
        deliverables: [{ content: { outputs: [longText] } }],
      };
      expect(service.extractFallbackContent(result as never, {} as never)).toBe(
        longText,
      );
    });

    it("filters out (simulated) outputs", () => {
      const result = {
        deliverables: [
          {
            content: {
              outputs: [{ output: "abc (simulated) def" + "x".repeat(120) }],
            },
          },
        ],
      };
      expect(
        service.extractFallbackContent(result as never, {} as never),
      ).toBeUndefined();
    });

    it("falls back to summary when deliverables empty", () => {
      const out = service.extractFallbackContent(
        { summary: "Summary text" } as never,
        { userPrompt: "Prompt" } as never,
      );
      expect(out).toContain("Prompt");
      expect(out).toContain("Summary text");
    });

    it("returns undefined when summary contains 失败", () => {
      const out = service.extractFallbackContent(
        { summary: "生成失败" } as never,
        { userPrompt: "x" } as never,
      );
      expect(out).toBeUndefined();
    });

    it("returns undefined when nothing extractable", () => {
      expect(
        service.extractFallbackContent(
          { deliverables: [] } as never,
          {} as never,
        ),
      ).toBeUndefined();
    });
  });

  describe("extractSummaryFromContent", () => {
    it("returns full content when shorter than maxLength", () => {
      expect(service.extractSummaryFromContent("hello")).toBe("hello");
    });

    it("collapses multiple newlines", () => {
      expect(service.extractSummaryFromContent("a\n\n\nb")).toBe("a\nb");
    });

    it("truncates at sentence boundary when long", () => {
      const text = "句子。".repeat(200); // very long, ends with 。 boundary
      const out = service.extractSummaryFromContent(text);
      expect(out.length).toBeLessThan(text.length);
      expect(out.endsWith("...")).toBe(true);
    });

    it("falls back to ellipsis when no sentence boundary nearby", () => {
      const text = "a".repeat(800); // no Chinese punctuation
      const out = service.extractSummaryFromContent(text);
      expect(out.endsWith("...")).toBe(true);
      expect(out.length).toBe(503); // 500 + "..."
    });
  });

  describe("generateChapterSummarySimple", () => {
    it("returns full content when short", () => {
      expect(service.generateChapterSummarySimple("short")).toBe("short");
    });

    it("returns start + ... + end when too long", () => {
      const text = "a".repeat(2000);
      const out = service.generateChapterSummarySimple(text);
      expect(out).toContain("...");
      expect(out.length).toBeLessThan(text.length);
    });
  });
});
