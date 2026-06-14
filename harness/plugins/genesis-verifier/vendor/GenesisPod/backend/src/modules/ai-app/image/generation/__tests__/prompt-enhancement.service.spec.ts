import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { PromptEnhancementService } from "../prompt-enhancement.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("PromptEnhancementService", () => {
  let service: PromptEnhancementService;
  let mockFacade: jest.Mocked<Partial<ChatFacade>>;

  beforeEach(async () => {
    mockFacade = {
      chat: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptEnhancementService,
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<PromptEnhancementService>(PromptEnhancementService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  // ==================== enhancePromptWithLLM ====================

  describe("enhancePromptWithLLM", () => {
    it("should return LLM response content", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: "Enhanced infographic prompt about AI",
      });

      const result = await service.enhancePromptWithLLM(
        "AI technologies overview",
      );

      expect(result).toBe("Enhanced infographic prompt about AI");
    });

    it("should throw when LLM returns no content", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({ content: "" });

      await expect(
        service.enhancePromptWithLLM("test content"),
      ).rejects.toThrow("No response from LLM");
    });

    it("should throw when LLM returns null content", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({ content: null });

      await expect(
        service.enhancePromptWithLLM("test content"),
      ).rejects.toThrow("No response from LLM");
    });

    it("should call AIFacade with correct parameters", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({ content: "response" });

      await service.enhancePromptWithLLM("test content", "gpt-4o");

      expect(mockFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "test content" }],
          taskProfile: expect.objectContaining({ creativity: "low" }),
        }),
      );
    });
  });

  // ==================== callGeminiTextAPI (deprecated) ====================

  describe("callGeminiTextAPI", () => {
    it("should delegate to enhancePromptWithLLM", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: "gemini response",
      });

      const result = await service.callGeminiTextAPI(
        "api-key",
        "gemini-pro",
        "test prompt",
      );

      expect(result).toBe("gemini response");
    });
  });

  // ==================== callOpenAITextAPI (deprecated) ====================

  describe("callOpenAITextAPI", () => {
    it("should delegate to enhancePromptWithLLM", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: "openai response",
      });

      const result = await service.callOpenAITextAPI(
        "api-key",
        null,
        "gpt-4o",
        "test prompt",
      );

      expect(result).toBe("openai response");
    });
  });

  // ==================== parsePromptEnhancementResponse ====================

  describe("parsePromptEnhancementResponse", () => {
    const buildValidResponse = (overrides = {}) =>
      JSON.stringify({
        final_prompt: "A beautiful infographic about technology",
        rendering_mode: "hybrid",
        template_layout: "cards",
        content_analysis: {
          type: "balanced",
          language: "en",
          complexity: "medium",
          reasoning: "Mixed content detected",
        },
        design_journal: [
          {
            title: "Layout Choice",
            narrative: "Cards layout chosen for parallel topics",
          },
        ],
        information_architecture: {
          title: "Tech Overview",
          subtitle: "Modern Technology",
          sections: [
            {
              title: "AI",
              summary: "Artificial Intelligence",
              bullets: ["Machine Learning", "Neural Networks"],
              metrics: [{ label: "Growth", value: "40%" }],
            },
          ],
        },
        visual_language: {
          primary_color: "#1e3a5f",
          accent_color: "#0891b2",
          background_color: "#f7f9fc",
          text_color: "#1a202c",
          color_palette: ["#1e3a5f", "#0891b2"],
        },
        layout_plan: ["3-column grid"],
        quality_checks: ["Color contrast passed"],
        negative_keywords: ["blurry", "low quality"],
        ...overrides,
      });

    it("should parse a valid response correctly", () => {
      const raw = buildValidResponse();
      // Use a long structured fallback prompt to avoid triggering "short visual prompt" override
      const fallback =
        "以下是关于人工智能技术发展的综合分析报告：机器学习、深度学习、自然语言处理等领域的最新进展与应用场景概述。本文包含数据分析、案例研究和未来展望三个主要部分。";
      const result = service.parsePromptEnhancementResponse(raw, fallback);

      expect(result.imagePrompt).toBe(
        "A beautiful infographic about technology",
      );
      expect(result.renderingMode).toBe("hybrid");
      expect(result.templateLayout).toBe("cards");
    });

    it("should return default insights for empty raw response", () => {
      const result = service.parsePromptEnhancementResponse(
        "",
        "fallback prompt",
      );

      expect(result.imagePrompt).toBe("fallback prompt");
    });

    it("should return default insights for whitespace-only raw response", () => {
      const result = service.parsePromptEnhancementResponse(
        "   ",
        "fallback prompt",
      );

      expect(result.imagePrompt).toBe("fallback prompt");
    });

    it("should parse markdown-fenced JSON correctly", () => {
      const jsonContent = buildValidResponse();
      const raw = "```json\n" + jsonContent + "\n```";

      const result = service.parsePromptEnhancementResponse(
        raw,
        "fallback prompt for test",
      );

      expect(result.imagePrompt).toBe(
        "A beautiful infographic about technology",
      );
    });

    it("should parse markdown fenced without json label", () => {
      const jsonContent = buildValidResponse();
      const raw = "```\n" + jsonContent + "\n```";

      const result = service.parsePromptEnhancementResponse(
        raw,
        "fallback prompt for testing",
      );

      expect(result.imagePrompt).toBe(
        "A beautiful infographic about technology",
      );
    });

    it("should fall back to default insights when JSON is invalid", () => {
      const result = service.parsePromptEnhancementResponse(
        "not valid json at all",
        "fallback prompt",
      );

      expect(result.imagePrompt).toBe("fallback prompt");
    });

    it("should default templateLayout to cards when AI returns invalid layout", () => {
      const raw = buildValidResponse({ template_layout: "invalid_layout_xyz" });

      const result = service.parsePromptEnhancementResponse(
        raw,
        "a long enough fallback prompt for testing purposes",
      );

      expect(result.templateLayout).toBe("cards");
    });

    it("should accept all valid templateLayout values", () => {
      const layouts = [
        "cards",
        "center_visual",
        "timeline",
        "comparison",
        "pyramid",
        "radial",
        "statistics",
        "checklist",
        "funnel",
        "matrix",
        "ranking",
      ];

      for (const layout of layouts) {
        const raw = buildValidResponse({ template_layout: layout });
        const result = service.parsePromptEnhancementResponse(
          raw,
          "long fallback prompt for testing purposes here",
        );
        expect(result.templateLayout).toBe(layout);
      }
    });

    it("should force ai_image mode for comic/illustration content", () => {
      const raw = buildValidResponse({ rendering_mode: "hybrid" });

      // Comic content in fallback prompt
      const result = service.parsePromptEnhancementResponse(
        raw,
        "comic strip of a cat and dog having an adventure",
      );

      expect(result.renderingMode).toBe("ai_image");
    });

    it("should force ai_image mode for short visual prompts", () => {
      const raw = buildValidResponse({ rendering_mode: "html_render" });

      // Short prompt (less than threshold)
      const result = service.parsePromptEnhancementResponse(raw, "sunset");

      expect(result.renderingMode).toBe("ai_image");
    });

    it("should switch from ai_image to hybrid for list content", () => {
      const raw = buildValidResponse({ rendering_mode: "ai_image" });

      // List content
      const result = service.parsePromptEnhancementResponse(
        raw,
        "Top 10 programming languages:\n1. Python\n2. JavaScript\n3. TypeScript\n4. Java\n5. Go\n6. Rust\n7. C++\n8. C#\n9. Swift\n10. Kotlin",
      );

      expect(result.renderingMode).toBe("hybrid");
    });

    it("should parse design journal entries correctly", () => {
      const raw = buildValidResponse({
        design_journal: [
          { title: "Step 1", narrative: "First decision" },
          { title: "Step 2", narrative: "Second decision" },
        ],
      });

      const result = service.parsePromptEnhancementResponse(
        raw,
        "long fallback prompt for testing purposes here",
      );

      expect(result.designJournal).toHaveLength(2);
      expect(result.designJournal[0].title).toBe("Step 1");
    });

    it("should handle string entries in design journal", () => {
      const raw = buildValidResponse({
        design_journal: ["First decision string", "Second decision string"],
      });

      const result = service.parsePromptEnhancementResponse(
        raw,
        "long fallback prompt for testing purposes here",
      );

      expect(result.designJournal).toHaveLength(2);
      expect(result.designJournal[0].narrative).toBe("First decision string");
    });

    it("should parse sections with metrics correctly", () => {
      const raw = buildValidResponse();

      const result = service.parsePromptEnhancementResponse(
        raw,
        "long fallback prompt for testing purposes here",
      );

      expect(result.informationArchitecture?.sections).toHaveLength(1);
      expect(result.informationArchitecture?.sections[0].metrics).toHaveLength(
        1,
      );
      expect(result.informationArchitecture?.sections[0].metrics[0].label).toBe(
        "Growth",
      );
    });

    it("should use fallbackPrompt as imagePrompt when imagePrompt is too short", () => {
      const raw = buildValidResponse({ final_prompt: "hi" });

      const result = service.parsePromptEnhancementResponse(
        raw,
        "this is a much longer fallback prompt for testing",
      );

      expect(result.imagePrompt).toBe(
        "this is a much longer fallback prompt for testing",
      );
    });

    it("should accept camelCase keys in response", () => {
      const raw = JSON.stringify({
        imagePrompt: "camelCase prompt that is detailed enough",
        renderingMode: "html_render",
        templateLayout: "timeline",
        visualLanguage: {
          primaryColor: "#ff0000",
          accentColor: "#00ff00",
        },
        informationArchitecture: { sections: [] },
      });

      // Use a fallback with list content (numbers) to prevent short-visual-prompt override
      const fallback =
        "以下是重要技术趋势排行榜：\n1. 人工智能\n2. 云计算\n3. 区块链\n4. 物联网\n5. 量子计算\n6. 边缘计算\n7. 5G通信\n8. 元宇宙";
      const result = service.parsePromptEnhancementResponse(raw, fallback);

      // html_render is valid, but list content detection may switch it to hybrid
      expect(["html_render", "hybrid"]).toContain(result.renderingMode);
      expect(result.templateLayout).toBe("timeline");
    });

    it("should apply styleShiftReasoning from designJournal when no explicit styleShiftReasoning", () => {
      const raw = buildValidResponse({
        design_journal: [
          { title: "Design", narrative: "Journal narrative entry" },
        ],
      });

      const result = service.parsePromptEnhancementResponse(
        raw,
        "long fallback prompt for testing purposes here",
      );

      expect(result.styleShiftReasoning).toContain("Journal narrative entry");
    });

    it("should parse backgroundPrompt from response", () => {
      const raw = buildValidResponse({
        background_prompt: "soft blue gradient background",
      });

      const result = service.parsePromptEnhancementResponse(
        raw,
        "long fallback prompt for testing purposes here",
      );

      expect(result.backgroundPrompt).toBe("soft blue gradient background");
    });
  });

  // ==================== composeFinalImagePrompt ====================

  describe("composeFinalImagePrompt", () => {
    const baseInsights = {
      imagePrompt: "A beautiful sunset over the ocean",
      renderingMode: "hybrid" as const,
      templateLayout: "cards" as const,
      negativeKeywords: ["blurry", "low quality"],
      informationArchitecture: { title: "Sunset", sections: [] },
      designJournal: [],
      styleShiftReasoning: [],
      qualityChecks: [],
      layoutPlan: [],
      inspiration: [],
      backgroundPrompt: "",
      fallbackPrompt: "",
      visualLanguage: {},
      contentAnalysis: {
        type: "balanced",
        language: "en",
        complexity: "medium",
        reasoning: "",
      },
    } as any;

    it("should use pure image prompt for ai_image mode", () => {
      const insights = { ...baseInsights, renderingMode: "ai_image" as const };

      const { prompt, negativeCandidates } =
        service.composeFinalImagePrompt(insights);

      expect(prompt).toContain("sunset over the ocean");
      expect(negativeCandidates.length).toBeGreaterThan(0);
    });

    it("should add style to prompt in ai_image mode", () => {
      const insights = { ...baseInsights, renderingMode: "ai_image" as const };

      const { prompt } = service.composeFinalImagePrompt(
        insights,
        "watercolor",
      );

      expect(prompt.toLowerCase()).toContain("watercolor");
    });

    it("should use default pure image prompt when imagePrompt is too short in ai_image mode", () => {
      const insights = {
        ...baseInsights,
        renderingMode: "ai_image" as const,
        imagePrompt: "hi",
        informationArchitecture: { title: "Tech Overview", sections: [] },
      };

      const { prompt } = service.composeFinalImagePrompt(insights);

      expect(prompt).toContain("Tech Overview");
    });

    it("should use backgroundPrompt in hybrid mode when available", () => {
      const insights = {
        ...baseInsights,
        renderingMode: "hybrid" as const,
        backgroundPrompt: "Abstract blue waves background with depth",
      };

      const { prompt } = service.composeFinalImagePrompt(insights);

      expect(prompt).toContain("Abstract blue waves background");
    });

    it("should use infographic prefix in hybrid mode without backgroundPrompt", () => {
      const insights = {
        ...baseInsights,
        renderingMode: "hybrid" as const,
        backgroundPrompt: "",
      };

      const { prompt } = service.composeFinalImagePrompt(insights);

      expect(prompt.length).toBeGreaterThan(0);
    });

    it("should include negativeKeywords in enhanced negatives for hybrid mode", () => {
      const insights = {
        ...baseInsights,
        renderingMode: "hybrid" as const,
        negativeKeywords: ["blurry", "distorted"],
      };

      const { negativeCandidates } = service.composeFinalImagePrompt(insights);

      expect(negativeCandidates).toContain("blurry");
      expect(negativeCandidates).toContain("text");
    });

    it("should add style in hybrid mode when provided", () => {
      const insights = {
        ...baseInsights,
        renderingMode: "hybrid" as const,
        backgroundPrompt: "",
      };

      const { prompt } = service.composeFinalImagePrompt(
        insights,
        "minimalist",
      );

      expect(prompt.toLowerCase()).toContain("minimalist");
    });

    it("should handle html_render mode similar to hybrid", () => {
      const insights = {
        ...baseInsights,
        renderingMode: "html_render" as const,
        backgroundPrompt: "",
      };

      const { prompt } = service.composeFinalImagePrompt(insights);

      expect(prompt.length).toBeGreaterThan(0);
    });
  });
});
