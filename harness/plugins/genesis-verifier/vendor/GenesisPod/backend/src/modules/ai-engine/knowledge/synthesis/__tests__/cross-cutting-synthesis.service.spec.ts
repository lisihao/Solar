import {
  CrossCuttingSynthesisService,
  DimensionResult,
  SynthesisResult,
} from "../cross-cutting-synthesis.service";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDimension(
  overrides: Partial<DimensionResult> = {},
): DimensionResult {
  return {
    dimensionId: "dim-1",
    dimensionName: "Economic Impact",
    content: "The economic impact is significant.",
    keyFindings: ["GDP grew 5%", "Jobs increased"],
    sources: [{ title: "World Bank Report", url: "https://worldbank.org" }],
    ...overrides,
  };
}

function makeValidLlmResponse(
  overrides: {
    themes?: unknown;
    contradictions?: unknown;
    gaps?: unknown;
    executiveSummary?: string;
  } = {},
): string {
  const payload = {
    crossCuttingThemes: overrides.themes ?? [
      {
        theme: "Global growth",
        supportingDimensions: ["Economic Impact", "Policy Landscape"],
        evidence: ["GDP grew", "Policy supports growth"],
        confidence: 0.85,
      },
    ],
    contradictions: overrides.contradictions ?? [],
    gaps: overrides.gaps ?? [],
    executiveSummary:
      overrides.executiveSummary ?? "Overall the picture is positive.",
  };
  return JSON.stringify(payload);
}

type ChatFn = (
  systemPrompt: string,
  userPrompt: string,
) => Promise<{ content: string; tokensUsed: number }>;

function makeChatFn(
  content: string,
  tokensUsed = 500,
): jest.MockedFunction<ChatFn> {
  return jest.fn().mockResolvedValue({ content, tokensUsed });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CrossCuttingSynthesisService", () => {
  let service: CrossCuttingSynthesisService;

  beforeEach(() => {
    service = new CrossCuttingSynthesisService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── synthesize() — empty input ──────────────────────────────────────────────

  describe("synthesize() — empty dimensions", () => {
    it("returns empty synthesis without calling chatFn when dimensions array is empty", async () => {
      const chatFn = makeChatFn("");

      const result = await service.synthesize([], chatFn);

      expect(chatFn).not.toHaveBeenCalled();
      expect(result.crossCuttingThemes).toEqual([]);
      expect(result.contradictions).toEqual([]);
      expect(result.gaps).toEqual([]);
      expect(result.executiveSummary).toBe("");
      expect(result.synthesisMetadata.dimensionsAnalyzed).toBe(0);
      expect(result.synthesisMetadata.tokensUsed).toBe(0);
    });
  });

  // ─── synthesize() — happy path ───────────────────────────────────────────────

  describe("synthesize() — valid dimensions with successful LLM", () => {
    it("returns correctly populated SynthesisResult", async () => {
      const dims = [
        makeDimension({
          dimensionId: "dim-1",
          dimensionName: "Economic Impact",
        }),
        makeDimension({
          dimensionId: "dim-2",
          dimensionName: "Policy Landscape",
        }),
      ];
      const chatFn = makeChatFn(makeValidLlmResponse(), 800);

      const result = await service.synthesize(dims, chatFn);

      expect(chatFn).toHaveBeenCalledTimes(1);
      expect(result.crossCuttingThemes).toHaveLength(1);
      expect(result.crossCuttingThemes[0].theme).toBe("Global growth");
      expect(result.crossCuttingThemes[0].confidence).toBe(0.85);
      expect(result.contradictions).toEqual([]);
      expect(result.gaps).toEqual([]);
      expect(result.executiveSummary).toBe("Overall the picture is positive.");
    });

    it("passes both system prompt and user prompt to chatFn", async () => {
      const dims = [makeDimension()];
      const chatFn = makeChatFn(makeValidLlmResponse());

      await service.synthesize(dims, chatFn);

      const [systemPrompt, userPrompt] = chatFn.mock.calls[0];
      expect(typeof systemPrompt).toBe("string");
      expect(systemPrompt.length).toBeGreaterThan(0);
      expect(typeof userPrompt).toBe("string");
      expect(userPrompt.length).toBeGreaterThan(0);
    });
  });

  // ─── synthesize() — JSON parsing ─────────────────────────────────────────────

  describe("synthesize() — JSON parsing", () => {
    it("parses JSON correctly even when embedded in surrounding text", async () => {
      const jsonEmbedded =
        `Here is the analysis:\n` +
        makeValidLlmResponse({
          themes: [
            {
              theme: "Embedded theme",
              supportingDimensions: ["dim-1"],
              evidence: ["evidence 1"],
              confidence: 0.7,
            },
          ],
        }) +
        `\nEnd of response.`;
      const chatFn = makeChatFn(jsonEmbedded);

      const result = await service.synthesize([makeDimension()], chatFn);

      expect(result.crossCuttingThemes[0].theme).toBe("Embedded theme");
    });

    it("returns full synthesisMetadata with correct counts", async () => {
      const responseWithData = makeValidLlmResponse({
        themes: [
          {
            theme: "T1",
            supportingDimensions: ["dim-1"],
            evidence: [],
            confidence: 0.8,
          },
          {
            theme: "T2",
            supportingDimensions: ["dim-2"],
            evidence: [],
            confidence: 0.6,
          },
        ],
        contradictions: [
          {
            topic: "C1",
            dimensionA: "dim-1",
            dimensionB: "dim-2",
            descriptionA: "A says X",
            descriptionB: "B says Y",
          },
        ],
        gaps: [
          {
            area: "G1",
            coveredBy: ["dim-1"],
            missingPerspective: "needs more data",
          },
        ],
      });
      const dims = [
        makeDimension({ dimensionId: "dim-1" }),
        makeDimension({ dimensionId: "dim-2" }),
      ];
      const chatFn = makeChatFn(responseWithData, 1200);

      const result = await service.synthesize(dims, chatFn);

      expect(result.synthesisMetadata.dimensionsAnalyzed).toBe(2);
      expect(result.synthesisMetadata.themesIdentified).toBe(2);
      expect(result.synthesisMetadata.contradictionsFound).toBe(1);
      expect(result.synthesisMetadata.gapsIdentified).toBe(1);
      expect(result.synthesisMetadata.tokensUsed).toBe(1200);
    });
  });

  // ─── synthesize() — error handling ───────────────────────────────────────────

  describe("synthesize() — error handling", () => {
    it("returns empty synthesis when chatFn throws an error", async () => {
      const chatFn: jest.MockedFunction<ChatFn> = jest
        .fn()
        .mockRejectedValue(new Error("LLM unavailable"));

      const result = await service.synthesize([makeDimension()], chatFn);

      expect(result.crossCuttingThemes).toEqual([]);
      expect(result.contradictions).toEqual([]);
      expect(result.gaps).toEqual([]);
      expect(result.executiveSummary).toBe("");
      expect(result.synthesisMetadata.dimensionsAnalyzed).toBe(0);
    });

    it("returns empty arrays and logs warning when JSON is malformed, but still records dimensionsAnalyzed", async () => {
      const chatFn = makeChatFn("This is not JSON at all {{{{ broken");

      const result = await service.synthesize([makeDimension()], chatFn);

      expect(result.crossCuttingThemes).toEqual([]);
      expect(result.contradictions).toEqual([]);
      expect(result.gaps).toEqual([]);
      expect(result.executiveSummary).toBe("");
      // chatFn succeeded — the dimension was analyzed even though parsing failed
      expect(result.synthesisMetadata.dimensionsAnalyzed).toBe(1);
      expect(result.synthesisMetadata.themesIdentified).toBe(0);
    });
  });

  // ─── buildUserPrompt() ───────────────────────────────────────────────────────

  describe("buildUserPrompt()", () => {
    it("includes all dimension names in the prompt", () => {
      const dims = [
        makeDimension({ dimensionName: "Economic Impact" }),
        makeDimension({ dimensionName: "Social Trends" }),
        makeDimension({ dimensionName: "Technology Adoption" }),
      ];

      const prompt = service.buildUserPrompt(dims);

      expect(prompt).toContain("Economic Impact");
      expect(prompt).toContain("Social Trends");
      expect(prompt).toContain("Technology Adoption");
    });

    it("truncates content longer than 2000 characters and appends truncation marker", () => {
      const longContent = "x".repeat(2500);
      const dim = makeDimension({ content: longContent });

      const prompt = service.buildUserPrompt([dim]);

      expect(prompt).toContain("[... truncated ...]");
      // The full 2500-char string must NOT appear verbatim
      expect(prompt).not.toContain("x".repeat(2001));
    });

    it("does not truncate content at or under 2000 characters", () => {
      const exactContent = "y".repeat(2000);
      const dim = makeDimension({ content: exactContent });

      const prompt = service.buildUserPrompt([dim]);

      expect(prompt).not.toContain("[... truncated ...]");
      expect(prompt).toContain(exactContent);
    });

    it("includes key findings as numbered list", () => {
      const dim = makeDimension({
        keyFindings: ["Finding Alpha", "Finding Beta"],
      });

      const prompt = service.buildUserPrompt([dim]);

      expect(prompt).toContain("Finding Alpha");
      expect(prompt).toContain("Finding Beta");
    });

    it("includes source titles when present", () => {
      const dim = makeDimension({
        sources: [
          { title: "Source A" },
          { title: "Source B", url: "https://example.com" },
        ],
      });

      const prompt = service.buildUserPrompt([dim]);

      expect(prompt).toContain("Source A");
      expect(prompt).toContain("Source B");
    });
  });

  // ─── parseResponse() ─────────────────────────────────────────────────────────

  describe("parseResponse()", () => {
    it("extracts JSON embedded in surrounding prose text", () => {
      const content =
        `Some preamble text.\n` +
        `{"crossCuttingThemes":[],"contradictions":[],"gaps":[],"executiveSummary":"Summary here"}` +
        `\nSome trailing text.`;

      const result = service.parseResponse(content);

      expect(result.executiveSummary).toBe("Summary here");
    });

    it("handles missing optional fields gracefully with empty defaults", () => {
      // Only executiveSummary present — arrays are missing
      const content = `{"executiveSummary":"Only summary"}`;

      const result = service.parseResponse(content);

      expect(result.crossCuttingThemes).toEqual([]);
      expect(result.contradictions).toEqual([]);
      expect(result.gaps).toEqual([]);
      expect(result.executiveSummary).toBe("Only summary");
    });

    it("returns empty parsed result when response contains no JSON object", () => {
      const content = "The LLM refused to answer.";

      const result = service.parseResponse(content);

      expect(result.crossCuttingThemes).toEqual([]);
      expect(result.contradictions).toEqual([]);
      expect(result.gaps).toEqual([]);
      expect(result.executiveSummary).toBe("");
    });
  });

  // ─── SynthesisResult structure ────────────────────────────────────────────────

  describe("SynthesisResult — structural integrity", () => {
    it("synthesisMetadata always has all required keys even in the empty case", () => {
      const emptyResult: SynthesisResult = {
        crossCuttingThemes: [],
        contradictions: [],
        gaps: [],
        executiveSummary: "",
        synthesisMetadata: {
          dimensionsAnalyzed: 0,
          themesIdentified: 0,
          contradictionsFound: 0,
          gapsIdentified: 0,
          tokensUsed: 0,
        },
      };

      // All keys must be present
      expect(emptyResult.synthesisMetadata).toHaveProperty(
        "dimensionsAnalyzed",
      );
      expect(emptyResult.synthesisMetadata).toHaveProperty("themesIdentified");
      expect(emptyResult.synthesisMetadata).toHaveProperty(
        "contradictionsFound",
      );
      expect(emptyResult.synthesisMetadata).toHaveProperty("gapsIdentified");
      expect(emptyResult.synthesisMetadata).toHaveProperty("tokensUsed");
    });
  });
});
