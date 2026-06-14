/**
 * Report Synthesis Prompt — renderSynthesisSystemPrompt Tests
 *
 * Verifies that the system prompt correctly injects all language-aware standards.
 */

import { renderSynthesisSystemPrompt } from "../report-synthesis.prompt";

describe("renderSynthesisSystemPrompt", () => {
  describe("Chinese (zh)", () => {
    const result = renderSynthesisSystemPrompt("zh");

    it("should not contain unresolved template placeholders", () => {
      expect(result).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
    });

    it("should contain heading hierarchy standards", () => {
      expect(result).toContain("标题层级规范");
    });

    it("should contain narrative structure standards", () => {
      expect(result).toContain("叙事结构规范");
      expect(result).toContain("McKinsey Pyramid Principle");
    });

    it("should contain professional tone standards", () => {
      expect(result).toContain("文风规范");
    });

    it("should contain table standards", () => {
      expect(result).toContain("表格规范");
    });

    it("should contain executive summary format", () => {
      expect(result).toContain("执行摘要");
      expect(result).toContain("McKinsey SCR");
    });

    it("should contain Chinese language instruction", () => {
      expect(result).toContain("中文");
    });
  });

  describe("English (en)", () => {
    const result = renderSynthesisSystemPrompt("en");

    it("should not contain unresolved template placeholders", () => {
      expect(result).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
    });

    it("should contain English heading hierarchy", () => {
      expect(result).toContain("Heading Hierarchy");
    });

    it("should contain English narrative structure", () => {
      expect(result).toContain("Narrative Structure Standards");
      expect(result).toContain("Conclusion First");
    });

    it("should contain English professional tone", () => {
      expect(result).toContain("Writing Style Standards");
    });

    it("should contain English table standards", () => {
      expect(result).toContain("Table Standards");
      expect(result).toContain("When to Use Tables");
    });

    it("should contain English executive summary format", () => {
      expect(result).toContain("Executive Summary");
    });

    it("should contain English language instruction", () => {
      expect(result).toContain("English");
    });
  });
});
