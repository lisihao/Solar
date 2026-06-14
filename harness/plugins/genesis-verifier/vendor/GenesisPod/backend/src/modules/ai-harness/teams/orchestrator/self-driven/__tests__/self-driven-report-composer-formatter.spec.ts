/**
 * Unit tests for SelfDrivenReportComposer.formatStructuredOutput
 *
 * Tests cover: pure string pass-through, flat objects, nested objects,
 * arrays, priority key ordering, null/undefined safety, and primitive coercion.
 * No NestJS DI required — the class is instantiated directly.
 */

import { SelfDrivenReportComposer } from "../self-driven-report-composer";

// The engine sanitizeMarkdownBody is imported by the composer.
// We mock the entire facade module so the test stays unit-level.
jest.mock("@/modules/ai-engine/facade", () => ({
  sanitizeMarkdownBody: jest.fn((text: string) => ({ body: text })),
  buildCitationMetadata: jest.fn(),
  generateBibliography: jest.fn(),
}));

describe("SelfDrivenReportComposer.formatStructuredOutput", () => {
  let composer: SelfDrivenReportComposer;

  beforeEach(() => {
    composer = new SelfDrivenReportComposer();
  });

  // ── Null / undefined safety ──────────────────────────────────────────────

  it("returns empty string for null", () => {
    expect(composer.formatStructuredOutput(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(composer.formatStructuredOutput(undefined)).toBe("");
  });

  // ── String pass-through ──────────────────────────────────────────────────

  it("returns plain string as-is (trimmed)", () => {
    expect(composer.formatStructuredOutput("  hello world  ")).toBe(
      "hello world",
    );
  });

  it("passes string through cleanStepBody (sanitizer called)", async () => {
    const { sanitizeMarkdownBody } = await import("@/modules/ai-engine/facade");
    const mockSanitize = sanitizeMarkdownBody as jest.Mock;
    mockSanitize.mockReturnValueOnce({ body: "sanitized output" });

    const result = composer.formatStructuredOutput("raw markdown");
    expect(result).toBe("sanitized output");
    expect(mockSanitize).toHaveBeenCalledWith("raw markdown", {
      allowTopLevelHeadings: true,
    });
  });

  // ── Flat object → key-value sections ────────────────────────────────────

  it("formats a flat object with string values as ### sections", () => {
    const result = composer.formatStructuredOutput({
      title: "AI Overview",
      description: "A brief intro",
    });
    expect(result).toContain("### Title");
    expect(result).toContain("AI Overview");
    expect(result).toContain("### Description");
    expect(result).toContain("A brief intro");
  });

  it("skips keys with null, undefined, or empty-string values", () => {
    const result = composer.formatStructuredOutput({
      present: "value",
      missing: null,
      also_missing: undefined,
      empty: "",
    });
    expect(result).toContain("### Present");
    expect(result).not.toContain("### Missing");
    expect(result).not.toContain("### Also Missing");
    expect(result).not.toContain("### Empty");
  });

  // ── Priority key ordering ────────────────────────────────────────────────

  it("promotes summary, conclusion, result, answer to the top", () => {
    const result = composer.formatStructuredOutput({
      zebra: "last",
      answer: "promoted-answer",
      summary: "promoted-summary",
      alpha: "middle",
    });
    const summaryIdx = result.indexOf("### Summary");
    const answerIdx = result.indexOf("### Answer");
    const alphaIdx = result.indexOf("### Alpha");
    const zebraIdx = result.indexOf("### Zebra");

    // summary before answer (priority order: summary=0, answer=3)
    expect(summaryIdx).toBeLessThan(answerIdx);
    // priority keys before regular keys
    expect(answerIdx).toBeLessThan(alphaIdx);
    expect(alphaIdx).toBeLessThan(zebraIdx);
  });

  // ── Nested objects ───────────────────────────────────────────────────────

  it("formats nested object as indented sub-section", () => {
    const result = composer.formatStructuredOutput({
      meta: {
        author: "Alice",
        date: "2026-06-05",
      },
    });
    expect(result).toContain("### Meta");
    expect(result).toContain("### Author");
    expect(result).toContain("Alice");
    expect(result).toContain("### Date");
  });

  // ── Array as value ───────────────────────────────────────────────────────

  it("formats an array value as a bulleted list", () => {
    const result = composer.formatStructuredOutput({
      findings: ["Item A", "Item B", "Item C"],
    });
    expect(result).toContain("### Findings");
    expect(result).toContain("- Item A");
    expect(result).toContain("- Item B");
    expect(result).toContain("- Item C");
  });

  it("formats an array of objects using objectToSummary inline", () => {
    const result = composer.formatStructuredOutput({
      sources: [
        { title: "Paper 1", url: "https://example.com" },
        { title: "Paper 2", url: "https://example.org" },
      ],
    });
    expect(result).toContain("### Sources");
    expect(result).toContain("- title: Paper 1");
    expect(result).toContain("- title: Paper 2");
  });

  // ── Top-level array ──────────────────────────────────────────────────────

  it("formats a top-level string array as bulleted list", () => {
    const result = composer.formatStructuredOutput(["Alpha", "Beta", "Gamma"]);
    expect(result).toContain("- Alpha");
    expect(result).toContain("- Beta");
    expect(result).toContain("- Gamma");
  });

  it("returns empty string for an empty array", () => {
    expect(composer.formatStructuredOutput([])).toBe("");
  });

  it("filters out null/undefined items in arrays", () => {
    const result = composer.formatStructuredOutput([
      "keep",
      null,
      undefined,
      "also-keep",
    ]);
    expect(result).toContain("- keep");
    expect(result).toContain("- also-keep");
    // null/undefined filtered — no dangling "- null" or "- undefined"
    expect(result).not.toMatch(/- null/);
    expect(result).not.toMatch(/- undefined/);
  });

  // ── Primitive coercion ───────────────────────────────────────────────────

  it("coerces a number to string", () => {
    expect(composer.formatStructuredOutput(42)).toBe("42");
  });

  it("coerces a boolean to string", () => {
    expect(composer.formatStructuredOutput(true)).toBe("true");
  });

  // ── kebabToTitle helper (indirectly via object keys) ────────────────────

  it("converts kebab-case keys to Title Case headings", () => {
    const result = composer.formatStructuredOutput({
      "key-with-dashes": "value1",
    });
    expect(result).toContain("### Key With Dashes");
  });

  it("converts snake_case keys to Title Case headings", () => {
    const result = composer.formatStructuredOutput({
      key_with_underscores: "value2",
    });
    expect(result).toContain("### Key With Underscores");
  });

  // ── Edge: object with only empty/null fields ─────────────────────────────

  it("returns empty string when object has only null/empty values", () => {
    expect(
      composer.formatStructuredOutput({ a: null, b: undefined, c: "" }),
    ).toBe("");
  });
});
