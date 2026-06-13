/**
 * Image Utility Functions Unit Tests
 *
 * Pure function tests - no mocking required
 */

import {
  normalizeString,
  toArray,
  addStyleToPrompt,
  getDimensions,
  mergeNegativePrompts,
  formatListForStep,
  formatInformationArchitectureStep,
  parseUrlInput,
  isYouTubeUrl,
  isBilibiliUrl,
  getUrlStepTitle,
  validateInsights,
  extractCleanContent,
} from "../core/image.utils";
import { createDefaultInsights } from "../core/image.types";

describe("Image Utility Functions", () => {
  // ============ normalizeString ============

  describe("normalizeString", () => {
    it("should return trimmed string for non-empty string input", () => {
      expect(normalizeString("  hello world  ")).toBe("hello world");
    });

    it("should return undefined for empty string", () => {
      expect(normalizeString("")).toBeUndefined();
    });

    it("should return undefined for whitespace-only string", () => {
      expect(normalizeString("   ")).toBeUndefined();
    });

    it("should convert numbers to string", () => {
      expect(normalizeString(42)).toBe("42");
    });

    it("should convert booleans to string", () => {
      expect(normalizeString(true)).toBe("true");
      expect(normalizeString(false)).toBe("false");
    });

    it("should return undefined for null", () => {
      expect(normalizeString(null)).toBeUndefined();
    });

    it("should return undefined for undefined", () => {
      expect(normalizeString(undefined)).toBeUndefined();
    });

    it("should return undefined for objects", () => {
      expect(normalizeString({ key: "value" })).toBeUndefined();
    });
  });

  // ============ toArray ============

  describe("toArray", () => {
    it("should return empty array for null", () => {
      expect(toArray(null)).toEqual([]);
    });

    it("should return empty array for undefined", () => {
      expect(toArray(undefined)).toEqual([]);
    });

    it("should filter and trim string arrays", () => {
      expect(toArray(["  hello  ", "world", "  "])).toEqual(["hello", "world"]);
    });

    it("should convert numbers in array to strings", () => {
      expect(toArray([1, 2, 3])).toEqual(["1", "2", "3"]);
    });

    it("should split comma-separated string", () => {
      expect(toArray("a, b, c")).toEqual(["a", "b", "c"]);
    });

    it("should split newline-separated string", () => {
      expect(toArray("a\nb\nc")).toEqual(["a", "b", "c"]);
    });

    it("should convert single number to array", () => {
      expect(toArray(42)).toEqual(["42"]);
    });

    it("should convert boolean to array", () => {
      expect(toArray(true)).toEqual(["true"]);
    });

    it("should filter empty items from array", () => {
      expect(toArray(["", "hello", "   ", "world"])).toEqual([
        "hello",
        "world",
      ]);
    });

    it("should return empty array for objects", () => {
      expect(toArray({ key: "value" })).toEqual([]);
    });
  });

  // ============ addStyleToPrompt ============

  describe("addStyleToPrompt", () => {
    it("should add style enhancement to prompt", () => {
      const result = addStyleToPrompt("a mountain scene", "watercolor");

      expect(result).toContain("a mountain scene");
      expect(result).toContain("watercolor");
    });

    it("should return unchanged prompt for unknown style", () => {
      const result = addStyleToPrompt("a mountain scene", "unknown-style-xyz");

      expect(result).toBe("a mountain scene");
    });

    it("should return unchanged prompt when style is undefined", () => {
      const result = addStyleToPrompt("a mountain scene");

      expect(result).toBe("a mountain scene");
    });

    it("should return unchanged prompt when style is empty string", () => {
      const result = addStyleToPrompt("a mountain scene", "");

      expect(result).toBe("a mountain scene");
    });

    it("should handle known styles", () => {
      const knownStyles = [
        "realistic",
        "cinematic",
        "anime",
        "watercolor",
        "sketch",
        "minimalist",
        "vintage",
        "fantasy",
        "sci-fi",
      ];

      for (const style of knownStyles) {
        const result = addStyleToPrompt("test prompt", style);
        expect(result.length).toBeGreaterThan("test prompt".length);
      }
    });
  });

  // ============ getDimensions ============

  describe("getDimensions", () => {
    it("should return 1024x1024 for 1:1 ratio", () => {
      expect(getDimensions("1:1")).toEqual({ width: 1024, height: 1024 });
    });

    it("should return 1344x768 for 16:9 ratio", () => {
      expect(getDimensions("16:9")).toEqual({ width: 1344, height: 768 });
    });

    it("should return 768x1344 for 9:16 ratio", () => {
      expect(getDimensions("9:16")).toEqual({ width: 768, height: 1344 });
    });

    it("should return 1152x896 for 4:3 ratio", () => {
      expect(getDimensions("4:3")).toEqual({ width: 1152, height: 896 });
    });

    it("should return 1:1 default for unknown ratio", () => {
      expect(getDimensions("unknown")).toEqual({ width: 1024, height: 1024 });
    });

    it("should return 1:1 default for empty string", () => {
      expect(getDimensions("")).toEqual({ width: 1024, height: 1024 });
    });
  });

  // ============ mergeNegativePrompts ============

  describe("mergeNegativePrompts", () => {
    it("should merge base and extra prompts without duplicates", () => {
      // Use a custom term that's not in ENFORCED_NEGATIVE_KEYWORDS
      const result = mergeNegativePrompts("custom-term-xyz, low quality", [
        "custom-term-xyz",
        "distorted",
      ]);

      expect(result).toContain("custom-term-xyz");
      expect(result).toContain("low quality");
      expect(result).toContain("distorted");

      // Should not have duplicate "custom-term-xyz"
      const customCount = (result || "").split("custom-term-xyz").length - 1;
      expect(customCount).toBe(1);
    });

    it("should include enforced negative keywords", () => {
      const result = mergeNegativePrompts(undefined, []);

      // Enforced negatives like "photorealistic", "3d render" should appear
      expect(result).toContain("photorealistic");
      expect(result).toContain("3d render");
    });

    it("should handle case-insensitive deduplication", () => {
      // Use a term not already in ENFORCED_NEGATIVE_KEYWORDS
      const result = mergeNegativePrompts("MY-UNIQUE-TERM", ["my-unique-term"]);

      const termCount =
        (result || "").toLowerCase().split("my-unique-term").length - 1;
      expect(termCount).toBe(1);
    });

    it("should handle undefined base", () => {
      const result = mergeNegativePrompts(undefined, ["distorted"]);

      expect(result).toContain("distorted");
    });

    it("should return defined result with enforced keywords even with empty inputs", () => {
      const result = mergeNegativePrompts(undefined, []);

      // Enforced negatives are always included
      expect(result).toBeDefined();
    });

    it("should handle semicolon and newline separated base", () => {
      const result = mergeNegativePrompts("blur; noise\nartifacts", []);

      expect(result).toContain("blur");
      expect(result).toContain("noise");
      expect(result).toContain("artifacts");
    });
  });

  // ============ formatListForStep ============

  describe("formatListForStep", () => {
    it("should format a list with bullet points", () => {
      const result = formatListForStep(["item 1", "item 2", "item 3"]);

      expect(result).toContain("- item 1");
      expect(result).toContain("- item 2");
      expect(result).toContain("- item 3");
    });

    it("should return undefined for empty array", () => {
      expect(formatListForStep([])).toBeUndefined();
    });

    it("should return undefined for null/undefined", () => {
      expect(formatListForStep(null as unknown as string[])).toBeUndefined();
    });
  });

  // ============ formatInformationArchitectureStep ============

  describe("formatInformationArchitectureStep", () => {
    it("should format basic info architecture", () => {
      const info = {
        title: "Main Title",
        subtitle: "Sub",
        heroStatement: "Hero text",
        sections: [],
        callToAction: "Act now",
      };

      const result = formatInformationArchitectureStep(info);

      expect(result).toContain("Title: Main Title");
      expect(result).toContain("Subtitle: Sub");
      expect(result).toContain("Hero statement: Hero text");
      expect(result).toContain("Call to action: Act now");
    });

    it("should format sections with bullets and metrics", () => {
      const info = {
        title: "Report",
        sections: [
          {
            title: "Section 1",
            summary: "Summary text",
            bullets: ["bullet a", "bullet b"],
            metrics: [{ label: "Revenue", value: "$10M", comparison: "+20%" }],
          },
        ],
      };

      const result = formatInformationArchitectureStep(
        info as Parameters<typeof formatInformationArchitectureStep>[0],
      );

      expect(result).toContain("Section 1");
      expect(result).toContain("Summary text");
      expect(result).toContain("bullet a");
      expect(result).toContain("Revenue");
      expect(result).toContain("$10M");
      expect(result).toContain("(+20%)");
    });

    it("should return undefined for empty info architecture", () => {
      const info = {
        title: "",
        sections: [],
      };

      const result = formatInformationArchitectureStep(
        info as Parameters<typeof formatInformationArchitectureStep>[0],
      );

      expect(result).toBeUndefined();
    });

    it("should use Section N fallback when section has no title", () => {
      const info = {
        sections: [
          {
            title: undefined,
            summary: "Summary",
            bullets: [],
            metrics: [],
          },
        ],
      };

      const result = formatInformationArchitectureStep(
        info as Parameters<typeof formatInformationArchitectureStep>[0],
      );

      expect(result).toContain("Section 1");
    });
  });

  // ============ parseUrlInput ============

  describe("parseUrlInput", () => {
    it("should parse URL without description", () => {
      const result = parseUrlInput("https://example.com/article");

      expect(result.url).toBe("https://example.com/article");
      expect(result.description).toBeNull();
    });

    it("should parse URL with description", () => {
      const result = parseUrlInput(
        "https://example.com/article focus on summary",
      );

      expect(result.url).toBe("https://example.com/article");
      expect(result.description).toBe("focus on summary");
    });

    it("should handle input with extra spaces", () => {
      const result = parseUrlInput(
        "  https://example.com   some description  ",
      );

      expect(result.url).toBe("https://example.com");
      expect(result.description).toBe("some description");
    });

    it("should return input as url when no valid URL detected", () => {
      const result = parseUrlInput("not a url at all");

      expect(result.url).toBe("not a url at all");
      expect(result.description).toBeNull();
    });
  });

  // ============ isYouTubeUrl ============

  describe("isYouTubeUrl", () => {
    it("should detect youtube.com URLs", () => {
      expect(isYouTubeUrl("https://www.youtube.com/watch?v=abc123")).toBe(true);
    });

    it("should detect youtu.be URLs", () => {
      expect(isYouTubeUrl("https://youtu.be/abc123")).toBe(true);
    });

    it("should return false for non-YouTube URLs", () => {
      expect(isYouTubeUrl("https://www.example.com")).toBe(false);
      expect(isYouTubeUrl("https://vimeo.com/123")).toBe(false);
    });
  });

  // ============ isBilibiliUrl ============

  describe("isBilibiliUrl", () => {
    it("should detect bilibili.com URLs", () => {
      expect(isBilibiliUrl("https://www.bilibili.com/video/BV1234")).toBe(true);
    });

    it("should return false for non-Bilibili URLs", () => {
      expect(isBilibiliUrl("https://www.youtube.com/watch?v=abc")).toBe(false);
    });
  });

  // ============ getUrlStepTitle ============

  describe("getUrlStepTitle", () => {
    it("should return YouTube extracting title", () => {
      const title = getUrlStepTitle(
        "https://youtube.com/watch?v=1",
        "extracting",
      );
      expect(title).toBe("Extracting YouTube Subtitles");
    });

    it("should return YouTube extracted title", () => {
      const title = getUrlStepTitle("https://youtu.be/1", "extracted");
      expect(title).toBe("YouTube Content Extracted");
    });

    it("should return Bilibili extracting title", () => {
      const title = getUrlStepTitle(
        "https://bilibili.com/video/BV1",
        "extracting",
      );
      expect(title).toBe("Extracting Bilibili Content");
    });

    it("should return Bilibili extracted title", () => {
      const title = getUrlStepTitle(
        "https://bilibili.com/video/BV1",
        "extracted",
      );
      expect(title).toBe("Bilibili Content Extracted");
    });

    it("should return generic extracting title for other URLs", () => {
      const title = getUrlStepTitle("https://example.com/page", "extracting");
      expect(title).toBe("Extracting Web Content");
    });

    it("should return generic extracted title for other URLs", () => {
      const title = getUrlStepTitle("https://example.com/page", "extracted");
      expect(title).toBe("Web Content Extracted");
    });
  });

  // ============ validateInsights ============

  describe("validateInsights", () => {
    it("should return true for insights with valid imagePrompt", () => {
      const insights = createDefaultInsights("A beautiful mountain landscape");
      expect(validateInsights(insights)).toBe(true);
    });

    it("should return false when imagePrompt is too short", () => {
      const insights = createDefaultInsights("hi");
      expect(validateInsights(insights)).toBe(false);
    });

    it("should return false for empty imagePrompt", () => {
      const insights = createDefaultInsights("");
      expect(validateInsights(insights)).toBe(false);
    });
  });

  // ============ extractCleanContent ============

  describe("extractCleanContent", () => {
    it("should remove markdown-style brackets", () => {
      const result = extractCleanContent("Some [important] content [here]");
      expect(result).toBe("Some  content");
    });

    it("should trim whitespace", () => {
      const result = extractCleanContent("  content  ");
      expect(result).toBe("content");
    });

    it("should return content unchanged if no brackets", () => {
      const result = extractCleanContent("plain content");
      expect(result).toBe("plain content");
    });
  });

  // ============ createDefaultInsights ============

  describe("createDefaultInsights", () => {
    it("should create insights with trimmed base prompt", () => {
      const insights = createDefaultInsights("  my prompt  ");
      expect(insights.imagePrompt).toBe("my prompt");
    });

    it("should create insights with hybrid rendering mode by default", () => {
      const insights = createDefaultInsights("test");
      expect(insights.renderingMode).toBe("hybrid");
    });

    it("should create insights with cards template layout by default", () => {
      const insights = createDefaultInsights("test");
      expect(insights.templateLayout).toBe("cards");
    });

    it("should create insights with empty design journal", () => {
      const insights = createDefaultInsights("test");
      expect(insights.designJournal).toEqual([]);
    });

    it("should create insights with default color palette", () => {
      const insights = createDefaultInsights("test");
      expect(insights.visualLanguage.colorPalette).toHaveLength(4);
    });

    it("should handle empty string input", () => {
      const insights = createDefaultInsights("");
      expect(insights.imagePrompt).toBe("");
    });
  });
});
