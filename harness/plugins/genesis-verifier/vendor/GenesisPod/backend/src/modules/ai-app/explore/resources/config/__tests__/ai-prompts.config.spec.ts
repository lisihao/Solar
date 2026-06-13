import {
  PaperSummaryPrompt,
  NewsSummaryPrompt,
  VideoSummaryPrompt,
  ProjectSummaryPrompt,
  getPromptTemplate,
  validateStructuredResponse,
  PromptBestPractices,
} from "../ai-prompts.config";

describe("ai-prompts.config", () => {
  describe("PaperSummaryPrompt", () => {
    it("user template includes title, abstract and content", () => {
      const out = PaperSummaryPrompt.user({
        title: "T",
        abstract: "A",
        content: "C",
      });
      expect(out).toContain("T");
      expect(out).toContain("A");
      expect(out).toContain("C");
    });
  });

  describe("NewsSummaryPrompt", () => {
    it("user template includes title and content", () => {
      const out = NewsSummaryPrompt.user({ title: "Breaking", content: "..." });
      expect(out).toContain("Breaking");
      expect(out).toContain("...");
    });
  });

  describe("VideoSummaryPrompt", () => {
    it("user template includes title and content", () => {
      const out = VideoSummaryPrompt.user({ title: "Tutorial", content: "TX" });
      expect(out).toContain("Tutorial");
      expect(out).toContain("TX");
    });
  });

  describe("ProjectSummaryPrompt", () => {
    it("user template includes project name and content", () => {
      const out = ProjectSummaryPrompt.user({ title: "MyProj", content: "RM" });
      expect(out).toContain("MyProj");
      expect(out).toContain("RM");
    });
  });

  describe("getPromptTemplate", () => {
    it.each([
      ["PAPER", PaperSummaryPrompt],
      ["NEWS", NewsSummaryPrompt],
      ["YOUTUBE_VIDEO", VideoSummaryPrompt],
      ["PROJECT", ProjectSummaryPrompt],
    ])("returns template for %s", (key, expected) => {
      expect(getPromptTemplate(key)).toBe(expected);
    });

    it("returns generic template for unknown type", () => {
      const tpl = getPromptTemplate("UNKNOWN");
      expect(tpl.name).toBe("generic_summary");
      const out = tpl.user({ title: "x", content: "y" });
      expect(out).toContain("x");
      expect(out).toContain("y");
    });
  });

  describe("validateStructuredResponse", () => {
    const validBase = {
      overview: "ok",
      category: "Academic",
      keyPoints: ["a", "b"],
      confidence: 0.9,
    };

    it("validates valid PAPER response", () => {
      const r = validateStructuredResponse(
        { ...validBase, contributions: ["c"] },
        "PAPER",
      );
      expect(r.valid).toBe(true);
      expect(r.errors).toHaveLength(0);
    });

    it("rejects PAPER missing contributions", () => {
      const r = validateStructuredResponse(validBase, "PAPER");
      expect(r.valid).toBe(false);
      expect(r.errors).toContain("PAPER: Missing or invalid contributions");
    });

    it("validates NEWS with headline", () => {
      const r = validateStructuredResponse(
        { ...validBase, headline: "h" },
        "NEWS",
      );
      expect(r.valid).toBe(true);
    });

    it("rejects NEWS missing headline", () => {
      const r = validateStructuredResponse(validBase, "NEWS");
      expect(r.errors).toContain("NEWS: Missing or invalid headline");
    });

    it("validates YOUTUBE_VIDEO with speakers", () => {
      const r = validateStructuredResponse(
        { ...validBase, speakers: [] },
        "YOUTUBE_VIDEO",
      );
      expect(r.valid).toBe(true);
    });

    it("rejects YOUTUBE_VIDEO missing speakers", () => {
      const r = validateStructuredResponse(validBase, "YOUTUBE_VIDEO");
      expect(r.errors).toContain("VIDEO: Missing or invalid speakers");
    });

    it("validates PROJECT with projectName", () => {
      const r = validateStructuredResponse(
        { ...validBase, projectName: "P" },
        "PROJECT",
      );
      expect(r.valid).toBe(true);
    });

    it("rejects PROJECT missing projectName", () => {
      const r = validateStructuredResponse(validBase, "PROJECT");
      expect(r.errors).toContain("PROJECT: Missing or invalid projectName");
    });

    it("rejects when overview missing", () => {
      const r = validateStructuredResponse(
        { category: "x", keyPoints: ["a"], confidence: 0.5 },
        "PAPER",
      );
      expect(r.errors).toContain("Missing or invalid overview");
    });

    it("rejects when category missing", () => {
      const r = validateStructuredResponse(
        { overview: "x", keyPoints: ["a"], confidence: 0.5 },
        "PAPER",
      );
      expect(r.errors).toContain("Missing or invalid category");
    });

    it("rejects when keyPoints not array or empty", () => {
      const r1 = validateStructuredResponse(
        { overview: "x", category: "c", keyPoints: [], confidence: 0.5 },
        "PAPER",
      );
      expect(r1.errors).toContain("Missing or invalid keyPoints");
      const r2 = validateStructuredResponse(
        {
          overview: "x",
          category: "c",
          keyPoints: "not-array",
          confidence: 0.5,
        },
        "PAPER",
      );
      expect(r2.errors).toContain("Missing or invalid keyPoints");
    });

    it("rejects invalid confidence (out of [0,1])", () => {
      const r1 = validateStructuredResponse(
        { ...validBase, confidence: -0.1 },
        "PAPER",
      );
      expect(r1.errors).toContain("Invalid confidence value");
      const r2 = validateStructuredResponse(
        { ...validBase, confidence: 1.5 },
        "PAPER",
      );
      expect(r2.errors).toContain("Invalid confidence value");
      const r3 = validateStructuredResponse(
        { ...validBase, confidence: "high" },
        "PAPER",
      );
      expect(r3.errors).toContain("Invalid confidence value");
    });

    it("defaults to PAPER validation when type omitted", () => {
      const r = validateStructuredResponse({
        ...validBase,
        contributions: ["c"],
      });
      expect(r.valid).toBe(true);
    });
  });

  describe("PromptBestPractices", () => {
    it("exposes default taskProfile", () => {
      expect(PromptBestPractices.requestDefaults.taskProfile.creativity).toBe(
        "medium",
      );
      expect(PromptBestPractices.requestDefaults.taskProfile.outputLength).toBe(
        "short",
      );
    });

    it("provides validation checklist and fallback strategies", () => {
      expect(PromptBestPractices.validationChecklist.length).toBeGreaterThan(0);
      expect(PromptBestPractices.fallbackStrategies.length).toBeGreaterThan(0);
      expect(
        PromptBestPractices.performanceOptimizations.length,
      ).toBeGreaterThan(0);
    });
  });
});
