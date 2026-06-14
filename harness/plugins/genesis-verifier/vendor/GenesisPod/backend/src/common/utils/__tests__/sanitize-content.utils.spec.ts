/**
 * Sanitize Content Utility Unit Tests
 *
 * Tests for sanitizeMarkdownContent, stripLeadingHeading,
 * sanitizeObjectContent, and sanitizeAllStrings.
 */

import {
  sanitizeMarkdownContent,
  stripLeadingHeading,
  sanitizeObjectContent,
  sanitizeAllStrings,
} from "../sanitize-content.utils";

describe("Sanitize Content Utils", () => {
  // ========== sanitizeMarkdownContent ==========

  describe("sanitizeMarkdownContent", () => {
    // --- Falsy input ---

    it("should return empty string for empty input", () => {
      expect(sanitizeMarkdownContent("")).toBe("");
    });

    it("should return falsy value as-is for null-like input", () => {
      // The guard is `if (!content) return content`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(sanitizeMarkdownContent(null as any)).toBeNull();
    });

    // --- No underscore content (should be preserved) ---

    it("should leave clean content unchanged", () => {
      const content = "This is a clean paragraph without any underscores.";
      expect(sanitizeMarkdownContent(content)).toBe(content);
    });

    it("should preserve valid bold markdown (**bold**)", () => {
      const content = "This is **bold text** in a sentence.";
      expect(sanitizeMarkdownContent(content)).toBe(content);
    });

    it("should preserve snake_case identifiers", () => {
      // snake_case inside words is preserved because the rule only removes
      // underscores not followed by alphanumeric chars
      const content = "The variable_name is snake_case.";
      expect(sanitizeMarkdownContent(content)).toBe(content);
    });

    // --- Consecutive underscores (2+) are removed ---

    it("should remove 2+ consecutive underscores", () => {
      expect(sanitizeMarkdownContent("text__ more")).toBe("text more");
      expect(sanitizeMarkdownContent("text____ more")).toBe("text more");
    });

    it("should remove underscores after citation references", () => {
      // [1]__ → [1]
      expect(sanitizeMarkdownContent("See [1]__")).toBe("See [1]");
      // "See [1] __" — the space before __ is preserved as a trailing space (trimming is not applied)
      const result = sanitizeMarkdownContent("See [1] __");
      expect(result).not.toContain("__");
      expect(result).toContain("[1]");
    });

    it("should remove underscores before citation references", () => {
      // __[1] → [1]
      const result = sanitizeMarkdownContent("Word__[1]");
      expect(result).not.toContain("__");
      expect(result).toContain("[1]");
    });

    it("should remove underscores between citation references", () => {
      const result = sanitizeMarkdownContent("[1] _ [2]");
      expect(result).not.toContain("_");
      expect(result).toContain("[1]");
      expect(result).toContain("[2]");
    });

    // --- Standalone underscores ---

    it("should remove isolated underscore surrounded by spaces", () => {
      // " _ " → "  " → " " after cleanup
      const result = sanitizeMarkdownContent("word _ word");
      expect(result).not.toContain("_");
    });

    it("should remove trailing underscores at end of line", () => {
      const result = sanitizeMarkdownContent("Some text __");
      expect(result).not.toContain("_");
    });

    // --- Chinese characters ---

    it("should remove underscore after Chinese character", () => {
      const result = sanitizeMarkdownContent("中文_");
      expect(result).toBe("中文");
    });

    it("should remove underscore after sequence of Chinese characters", () => {
      const result = sanitizeMarkdownContent("这是一段文字__更多");
      expect(result).not.toContain("__");
    });

    // --- English/numbers ---

    it("should remove trailing underscore after English word (non-snake_case)", () => {
      // word_ where underscore is not followed by alphanumeric
      const result = sanitizeMarkdownContent("word_ ");
      expect(result).not.toContain("_");
    });

    // --- Punctuation ---

    it("should remove underscores before and after punctuation", () => {
      const result = sanitizeMarkdownContent("sentence__。");
      expect(result).not.toContain("_");
      expect(result).toContain("。");
    });

    // --- Multiple consecutive spaces ---

    it("should collapse multiple spaces into single space", () => {
      // After removing underscores, multiple spaces may form
      const result = sanitizeMarkdownContent("word  __  word");
      expect(result).not.toMatch(/  /);
    });

    // --- Bold/italic mixed markup ---

    it("should fix **text__ patterns to **text**", () => {
      const result = sanitizeMarkdownContent("**bold__");
      expect(result).not.toContain("__");
    });

    // --- Line-start underscores ---

    it("should remove leading underscores at start of line", () => {
      const result = sanitizeMarkdownContent("__leading text");
      expect(result).not.toContain("__");
    });
  });

  // ========== stripLeadingHeading ==========

  describe("stripLeadingHeading", () => {
    it("should return empty string for empty input", () => {
      expect(stripLeadingHeading("")).toBe("");
    });

    it("should return falsy value as-is", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(stripLeadingHeading(null as any)).toBeNull();
    });

    it("should strip an H1 heading from the start", () => {
      const content = "# Introduction\n\nThis is the body.";
      const result = stripLeadingHeading(content);
      expect(result).not.toContain("# Introduction");
      expect(result).toContain("This is the body.");
    });

    it("should strip an H2 heading from the start", () => {
      const content = "## Summary\n\nDetails here.";
      const result = stripLeadingHeading(content);
      expect(result).not.toContain("## Summary");
      expect(result).toContain("Details here.");
    });

    it("should strip an H3 heading from the start", () => {
      const content = "### Introduction\nBody content.";
      const result = stripLeadingHeading(content);
      expect(result).not.toContain("### Introduction");
      expect(result).toContain("Body content.");
    });

    it("should strip heading with leading whitespace/newlines", () => {
      const content = "\n\n## Section\nContent follows.";
      const result = stripLeadingHeading(content);
      expect(result).not.toContain("## Section");
      expect(result).toContain("Content follows.");
    });

    it("should not strip a heading that appears mid-content", () => {
      const content = "Intro paragraph.\n\n## Mid Heading\nMore content.";
      const result = stripLeadingHeading(content);
      // The heading is NOT at the start, so it should be preserved
      expect(result).toContain("## Mid Heading");
    });

    it("should return content unchanged if it has no leading heading", () => {
      const content = "Just a regular paragraph. No heading here.";
      const result = stripLeadingHeading(content);
      expect(result).toBe(content);
    });

    it("should trimStart result after stripping", () => {
      const content = "## Heading\n   Content with indent.";
      const result = stripLeadingHeading(content);
      expect(result).toBe("Content with indent.");
    });

    it("should strip H6 heading", () => {
      const content = "###### Deep Heading\nContent.";
      const result = stripLeadingHeading(content);
      expect(result).not.toContain("###### Deep Heading");
    });
  });

  // ========== sanitizeObjectContent ==========

  describe("sanitizeObjectContent", () => {
    it("should return non-object values as-is", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(sanitizeObjectContent(null as any)).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(sanitizeObjectContent(42 as any)).toBe(42);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(sanitizeObjectContent("string" as any)).toBe("string");
    });

    it("should sanitize string fields in aggressive mode (default)", () => {
      // Arrange - a field with underscore problem
      const obj = { title: "Something__wrong", id: "123" };

      // Act
      const result = sanitizeObjectContent(obj);

      // Assert: 'title' should be sanitized, 'id' should be skipped
      expect(result.title).not.toContain("__");
      expect(result.id).toBe("123"); // id is in SKIP_SANITIZE_FIELDS
    });

    it("should skip fields in SKIP_SANITIZE_FIELDS set", () => {
      const obj = {
        id: "skip-me",
        url: "https://example.com",
        domain: "example.com",
        userId: "user-123",
        title: "Sanitize__me",
      };

      const result = sanitizeObjectContent(obj);

      expect(result.id).toBe("skip-me");
      expect(result.url).toBe("https://example.com");
      expect(result.domain).toBe("example.com");
      expect(result.userId).toBe("user-123");
    });

    it("should not sanitize empty string fields", () => {
      const obj = { title: "" };
      const result = sanitizeObjectContent(obj);
      expect(result.title).toBe("");
    });

    it("should recursively sanitize nested objects", () => {
      const obj = {
        section: {
          title: "Nested__heading",
          description: "Clean text",
        },
      };

      const result = sanitizeObjectContent(obj);

      expect(result.section.title).not.toContain("__");
      expect(result.section.description).toBe("Clean text");
    });

    it("should recursively sanitize arrays of objects", () => {
      const obj = {
        items: [
          { title: "Item__one", id: "skip" },
          { title: "Item__two", id: "skip" },
        ],
      };

      const result = sanitizeObjectContent(obj);

      expect(result.items[0].title).not.toContain("__");
      expect(result.items[1].title).not.toContain("__");
      expect(result.items[0].id).toBe("skip");
    });

    it("should sanitize string items in arrays", () => {
      const obj = {
        tags: ["clean-tag", "problem__tag"],
      };

      const result = sanitizeObjectContent(obj);

      expect(result.tags[0]).toBe("clean-tag");
      expect(result.tags[1]).not.toContain("__");
    });

    it("should pass through non-string, non-object array items", () => {
      const obj = { numbers: [1, 2, 3] };
      const result = sanitizeObjectContent(obj);
      expect(result.numbers).toEqual([1, 2, 3]);
    });

    it("should use non-aggressive mode with fieldsToSanitize", () => {
      const obj = {
        title: "Title__with_issues",
        summary: "Summary__with_issues",
        description: "Description__with_issues",
      };

      // Only sanitize 'title' in non-aggressive mode
      const result = sanitizeObjectContent(obj, {
        aggressive: false,
        fieldsToSanitize: ["title"],
      });

      // Only title should be sanitized
      expect(result.title).not.toContain("__");
      // Others should be left alone in non-aggressive mode
      expect(result.summary).toBe("Summary__with_issues");
      expect(result.description).toBe("Description__with_issues");
    });

    it("should not mutate the original object", () => {
      const obj = { title: "Test__content" };
      const original = { ...obj };

      sanitizeObjectContent(obj);

      expect(obj).toEqual(original);
    });
  });

  // ========== sanitizeAllStrings ==========

  describe("sanitizeAllStrings", () => {
    it("should sanitize all string fields in aggressive mode", () => {
      const obj = {
        title: "Title__text",
        content: "Content__text",
        id: "123",
      };

      const result = sanitizeAllStrings(obj);

      expect(result.title).not.toContain("__");
      expect(result.content).not.toContain("__");
      expect(result.id).toBe("123"); // id is still in SKIP_SANITIZE_FIELDS
    });

    it("should handle null-like input gracefully", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(sanitizeAllStrings(null as any)).toBeNull();
    });

    it("should return primitives as-is", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(sanitizeAllStrings(42 as any)).toBe(42);
    });

    it("should recursively sanitize nested object", () => {
      const obj = {
        meta: {
          title: "Nested__Title",
          count: 5,
        },
      };

      const result = sanitizeAllStrings(obj);

      expect(result.meta.title).not.toContain("__");
      expect(result.meta.count).toBe(5);
    });
  });
});
