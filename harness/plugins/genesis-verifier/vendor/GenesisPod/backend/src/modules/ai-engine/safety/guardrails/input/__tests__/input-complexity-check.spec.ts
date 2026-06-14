/**
 * Tests for InputComplexityCheck
 */

import { InputComplexityCheck } from "../input-complexity-check";

describe("InputComplexityCheck", () => {
  let checker: InputComplexityCheck;

  beforeEach(() => {
    checker = new InputComplexityCheck();
  });

  describe("identity properties", () => {
    it("has correct id", () => {
      expect(checker.id).toBe("input-complexity-check");
    });

    it("has correct name", () => {
      expect(checker.name).toBe("Input Complexity Check");
    });

    it("is enabled by default", () => {
      expect(checker.enabled).toBe(true);
    });
  });

  describe("short/normal input", () => {
    it("passes short input with severity: info", async () => {
      const result = await checker.check({
        content: "Hello, what is the weather?",
      });
      expect(result.passed).toBe(true);
      expect(result.severity).toBe("info");
      expect(result.guardrailId).toBe("input-complexity-check");
    });

    it("passes empty input", async () => {
      const result = await checker.check({ content: "" });
      expect(result.passed).toBe(true);
      expect(result.severity).toBe("info");
    });

    it("includes length and estimatedTokens in metadata for normal input", async () => {
      const result = await checker.check({ content: "Hello world" });
      expect(result.metadata?.length).toBeDefined();
      expect(result.metadata?.estimatedTokens).toBeDefined();
    });

    it("metadata length matches content.length", async () => {
      const content = "This is a test sentence.";
      const result = await checker.check({ content });
      expect(result.metadata?.length).toBe(content.length);
    });
  });

  describe("warning threshold (200k chars or 50k tokens)", () => {
    it("returns warning for content exceeding warnLength (200000 chars)", async () => {
      // Use a string that exceeds warnLength (200000) but stays under maxLength (400000)
      const content = "a".repeat(250000);
      const result = await checker.check({ content });
      expect(result.passed).toBe(true);
      expect(result.severity).toBe("warning");
    });

    it("warning result has passed: true", async () => {
      const content = "a".repeat(250000);
      const result = await checker.check({ content });
      expect(result.passed).toBe(true);
    });

    it("warning result includes length and estimatedTokens in metadata", async () => {
      const content = "a".repeat(250000);
      const result = await checker.check({ content });
      expect(result.metadata?.length).toBeDefined();
      expect(result.metadata?.estimatedTokens).toBeDefined();
    });
  });

  describe("oversized threshold (400k chars or 100k tokens)", () => {
    it("warns but passes content exceeding maxLength (400000 chars)", async () => {
      const content = "a".repeat(400001);
      const result = await checker.check({ content });
      expect(result.passed).toBe(true);
      expect(result.severity).toBe("warning");
      expect(result.metadata?.oversized).toBe(true);
    });

    it("oversized result includes length metadata", async () => {
      const content = "a".repeat(400001);
      const result = await checker.check({ content });
      expect(result.metadata?.length).toBe(content.length);
    });

    it("oversized result includes maxLength in metadata", async () => {
      const content = "a".repeat(400001);
      const result = await checker.check({ content });
      expect(result.metadata?.maxLength).toBe(400000);
    });
  });

  describe("token estimation with English", () => {
    it("estimates tokens as ceil(words * 1.3) for English text", async () => {
      // 10 English words: ceil(10 * 1.3) = ceil(13) = 13 tokens
      const content = "one two three four five six seven eight nine ten";
      const result = await checker.check({ content });
      expect(result.metadata?.estimatedTokens).toBe(13);
    });

    it("estimates tokens for a single word", async () => {
      // 1 word: ceil(1 * 1.3) = ceil(1.3) = 2 tokens
      const result = await checker.check({ content: "hello" });
      expect(result.metadata?.estimatedTokens).toBe(2);
    });

    it("estimates 0 tokens for empty string", async () => {
      const result = await checker.check({ content: "" });
      expect(result.metadata?.estimatedTokens).toBe(0);
    });
  });

  describe("token estimation with Chinese characters", () => {
    it("counts Chinese characters as 1 token each plus word tokens", async () => {
      // "你好世界" = 4 Chinese chars, no English words from split
      // words from split by whitespace = ["你好世界"] = 1 word
      // tokens = ceil(1 * 1.3 + 4) = ceil(1.3 + 4) = ceil(5.3) = 6
      const content = "你好世界";
      const result = await checker.check({ content });
      expect(result.metadata?.estimatedTokens).toBe(6);
    });

    it("combines English and Chinese token estimation", async () => {
      // "hello 你好" => words = ["hello", "你好"] = 2 words, chineseChars = 2
      // tokens = ceil(2 * 1.3 + 2) = ceil(2.6 + 2) = ceil(4.6) = 5
      const content = "hello 你好";
      const result = await checker.check({ content });
      expect(result.metadata?.estimatedTokens).toBe(5);
    });

    it("warns but passes when Chinese content exceeds 100000 token estimate", async () => {
      // Create content with enough Chinese chars to exceed maxTokenEstimate (100000)
      // Need chineseChars > 100000. Use 100001 Chinese chars.
      const content = "你".repeat(100001);
      const result = await checker.check({ content });
      expect(result.passed).toBe(true);
      expect(result.severity).toBe("warning");
      expect(result.metadata?.oversized).toBe(true);
    });
  });

  describe("updateThresholds", () => {
    it("updateThresholds changes maxLength behavior", async () => {
      checker.updateThresholds({ maxLength: 10 });
      const result = await checker.check({ content: "This is eleven chars." });
      expect(result.passed).toBe(true);
      expect(result.severity).toBe("warning");
      expect(result.metadata?.oversized).toBe(true);
    });

    it("updateThresholds changes warnLength behavior", async () => {
      checker.updateThresholds({ warnLength: 5, maxLength: 100 });
      const result = await checker.check({ content: "Hello World" }); // 11 chars > 5 warnLength
      expect(result.passed).toBe(true);
      expect(result.severity).toBe("warning");
    });

    it("updateThresholds changes maxTokenEstimate behavior", async () => {
      checker.updateThresholds({ maxTokenEstimate: 1, warnTokenEstimate: 0 });
      // "hello world" = 2 words = ceil(2 * 1.3) = 3 tokens > 1 maxTokenEstimate
      const result = await checker.check({ content: "hello world" });
      expect(result.passed).toBe(true);
      expect(result.severity).toBe("warning");
      expect(result.metadata?.oversized).toBe(true);
    });

    it("updateThresholds only updates specified fields", async () => {
      checker.updateThresholds({ maxLength: 200 });
      // warnLength should still be 50000, so 100-char input passes info
      const result = await checker.check({ content: "a".repeat(100) });
      expect(result.passed).toBe(true);
      expect(result.severity).toBe("info");
    });
  });

  describe("result structure", () => {
    it("always includes guardrailId in result", async () => {
      const result = await checker.check({ content: "test" });
      expect(result.guardrailId).toBe("input-complexity-check");
    });

    it("always includes message in result", async () => {
      const result = await checker.check({ content: "test" });
      expect(result.message).toBeDefined();
      expect(typeof result.message).toBe("string");
    });
  });
});
