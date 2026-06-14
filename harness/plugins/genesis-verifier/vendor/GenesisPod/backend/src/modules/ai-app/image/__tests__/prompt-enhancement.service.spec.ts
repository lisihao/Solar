/**
 * PromptEnhancementService Unit Tests
 *
 * Tests AI-powered prompt enhancement and parsing logic
 */

import { Test, TestingModule } from "@nestjs/testing";
import { PromptEnhancementService } from "../generation/prompt-enhancement.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("PromptEnhancementService", () => {
  let service: PromptEnhancementService;

  const mockFacade = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptEnhancementService,
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<PromptEnhancementService>(PromptEnhancementService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============ enhancePromptWithLLM ============

  describe("enhancePromptWithLLM", () => {
    it("should call facade.chat and return the content", async () => {
      const expectedContent =
        '{"final_prompt":"enhanced photo","rendering_mode":"ai_image"}';
      mockFacade.chat.mockResolvedValue({
        content: expectedContent,
        tokensUsed: 80,
      });

      const result = await service.enhancePromptWithLLM(
        "a beautiful mountain",
        "some-model-id",
      );

      expect(result).toBe(expectedContent);
      expect(mockFacade.chat).toHaveBeenCalledTimes(1);
      const callArgs = mockFacade.chat.mock.calls[0][0];
      expect(callArgs.messages[0].role).toBe("user");
      expect(callArgs.messages[0].content).toBe("a beautiful mountain");
    });

    it("should throw when LLM returns empty content", async () => {
      mockFacade.chat.mockResolvedValue({ content: "", tokensUsed: 0 });

      await expect(service.enhancePromptWithLLM("test prompt")).rejects.toThrow(
        "No response from LLM",
      );
    });

    it("should throw when LLM returns null content", async () => {
      mockFacade.chat.mockResolvedValue({ content: null, tokensUsed: 0 });

      await expect(service.enhancePromptWithLLM("test prompt")).rejects.toThrow(
        "No response from LLM",
      );
    });

    it("should propagate errors from facade.chat", async () => {
      mockFacade.chat.mockRejectedValue(new Error("LLM API unavailable"));

      await expect(service.enhancePromptWithLLM("test prompt")).rejects.toThrow(
        "LLM API unavailable",
      );
    });
  });

  // ============ callGeminiTextAPI (deprecated) ============

  describe("callGeminiTextAPI (deprecated)", () => {
    it("should delegate to enhancePromptWithLLM", async () => {
      const expectedContent = "enhanced content";
      mockFacade.chat.mockResolvedValue({
        content: expectedContent,
        tokensUsed: 50,
      });

      const result = await service.callGeminiTextAPI(
        "fake-api-key",
        "gemini-pro",
        "content to enhance",
      );

      expect(result).toBe(expectedContent);
      expect(mockFacade.chat).toHaveBeenCalledTimes(1);
    });
  });

  // ============ callOpenAITextAPI (deprecated) ============

  describe("callOpenAITextAPI (deprecated)", () => {
    it("should delegate to enhancePromptWithLLM", async () => {
      const expectedContent = "openai enhanced content";
      mockFacade.chat.mockResolvedValue({
        content: expectedContent,
        tokensUsed: 60,
      });

      const result = await service.callOpenAITextAPI(
        "fake-api-key",
        null,
        "gpt-4o",
        "content to enhance",
      );

      expect(result).toBe(expectedContent);
      expect(mockFacade.chat).toHaveBeenCalledTimes(1);
    });
  });

  // ============ parsePromptEnhancementResponse ============

  describe("parsePromptEnhancementResponse", () => {
    it("should return default insights for empty input", () => {
      const result = service.parsePromptEnhancementResponse("", "fallback");

      expect(result).toBeDefined();
      expect(result.imagePrompt).toBe("fallback");
      expect(result.renderingMode).toBe("hybrid");
    });

    it("should return default insights for whitespace-only input", () => {
      const result = service.parsePromptEnhancementResponse("   ", "fallback");

      expect(result.imagePrompt).toBe("fallback");
    });

    it("should parse valid JSON response", () => {
      const jsonResponse = JSON.stringify({
        final_prompt: "A stunning mountain landscape at sunset",
        rendering_mode: "ai_image",
        template_layout: "cards",
        information_architecture: {
          title: "Mountain Landscape",
          sections: [],
        },
        visual_language: {
          primary_color: "#ff5733",
          accent_color: "#0891b2",
        },
      });

      const result = service.parsePromptEnhancementResponse(
        jsonResponse,
        "fallback",
      );

      expect(result.imagePrompt).toBe(
        "A stunning mountain landscape at sunset",
      );
      expect(result.renderingMode).toBe("ai_image");
    });

    it("should parse JSON wrapped in code fences", () => {
      const fencedJson = `\`\`\`json
{
  "final_prompt": "Fenced prompt test for structured content visualization",
  "rendering_mode": "html_render",
  "template_layout": "timeline"
}
\`\`\``;

      // Use a structured fallback prompt that is long enough to avoid short-prompt override
      // and contains structured content pattern keywords to prevent ai_image override
      const fallbackPrompt =
        "步骤 1: 分析数据 步骤 2: 生成报告 步骤 3: 可视化结果 分析流程图";

      const result = service.parsePromptEnhancementResponse(
        fencedJson,
        fallbackPrompt,
      );

      expect(result.imagePrompt).toBe(
        "Fenced prompt test for structured content visualization",
      );
      expect(result.renderingMode).toBe("html_render");
      expect(result.templateLayout).toBe("timeline");
    });

    it("should fall back to default insights on invalid JSON", () => {
      const result = service.parsePromptEnhancementResponse(
        "not valid json {{{",
        "fallback prompt",
      );

      expect(result.imagePrompt).toBe("fallback prompt");
      expect(result.renderingMode).toBe("hybrid");
    });

    it("should handle image_prompt field alias", () => {
      const json = JSON.stringify({
        image_prompt: "From image_prompt field",
        rendering_mode: "ai_image",
      });

      const result = service.parsePromptEnhancementResponse(json, "fallback");

      expect(result.imagePrompt).toBe("From image_prompt field");
    });

    it("should force ai_image mode for short prompts", () => {
      const json = JSON.stringify({
        final_prompt: "cat photo",
        rendering_mode: "hybrid",
      });

      // "cat" is short and has no structured content
      const result = service.parsePromptEnhancementResponse(json, "cat");

      expect(result.renderingMode).toBe("ai_image");
    });

    it("should force ai_image mode for comic/illustration content", () => {
      const json = JSON.stringify({
        final_prompt: "a manga panel",
        rendering_mode: "hybrid",
      });

      const result = service.parsePromptEnhancementResponse(
        json,
        "manga panel 1",
      );

      expect(result.renderingMode).toBe("ai_image");
    });

    it("should switch list content from ai_image to hybrid mode", () => {
      const json = JSON.stringify({
        final_prompt: "Top 10 tech companies ranking",
        rendering_mode: "ai_image",
      });

      const result = service.parsePromptEnhancementResponse(
        json,
        "Top 10 tech companies ranking infographic",
      );

      expect(result.renderingMode).toBe("hybrid");
    });

    it("should use default template layout for invalid layout values", () => {
      const json = JSON.stringify({
        final_prompt: "some prompt",
        template_layout: "invalid_layout_value",
      });

      const result = service.parsePromptEnhancementResponse(json, "fallback");

      expect(result.templateLayout).toBe("cards");
    });

    it("should parse valid template layouts", () => {
      const validLayouts = [
        "cards",
        "center_visual",
        "timeline",
        "comparison",
        "pyramid",
        "statistics",
        "checklist",
      ];

      for (const layout of validLayouts) {
        const json = JSON.stringify({
          final_prompt: "some prompt text",
          template_layout: layout,
          rendering_mode: "html_render",
        });

        const result = service.parsePromptEnhancementResponse(
          json,
          "some prompt text for testing purposes that is longer",
        );
        expect(result.templateLayout).toBe(layout);
      }
    });

    it("should parse design journal entries", () => {
      const json = JSON.stringify({
        final_prompt: "test prompt",
        rendering_mode: "html_render",
        design_journal: [
          { title: "Step 1", narrative: "Content analysis done" },
          { title: "Step 2", narrative: "Layout decided" },
        ],
      });

      const result = service.parsePromptEnhancementResponse(
        json,
        "fallback for long enough content",
      );

      expect(result.designJournal).toHaveLength(2);
      expect(result.designJournal[0].title).toBe("Step 1");
      expect(result.designJournal[0].narrative).toBe("Content analysis done");
    });

    it("should parse string entries in design journal", () => {
      const json = JSON.stringify({
        final_prompt: "test prompt content that is long",
        rendering_mode: "html_render",
        design_journal: ["First design decision", "Second design decision"],
      });

      const result = service.parsePromptEnhancementResponse(json, "fallback");

      expect(result.designJournal.length).toBeGreaterThan(0);
      expect(result.designJournal[0].narrative).toBe("First design decision");
    });

    it("should parse information architecture with sections", () => {
      const json = JSON.stringify({
        final_prompt: "test prompt",
        rendering_mode: "html_render",
        information_architecture: {
          title: "Main Title",
          subtitle: "Sub Title",
          heroStatement: "The hero text",
          sections: [
            {
              title: "Section 1",
              summary: "Summary text",
              bullets: ["bullet 1", "bullet 2"],
              metrics: [{ label: "Revenue", value: "$10M" }],
              sectionType: "main",
            },
          ],
          callToAction: "Learn more",
        },
      });

      const result = service.parsePromptEnhancementResponse(json, "fallback");

      expect(result.informationArchitecture.title).toBe("Main Title");
      expect(result.informationArchitecture.sections).toHaveLength(1);
      expect(result.informationArchitecture.sections[0].bullets).toEqual([
        "bullet 1",
        "bullet 2",
      ]);
    });

    it("should parse visual language colors", () => {
      const json = JSON.stringify({
        final_prompt: "test prompt",
        visual_language: {
          primary_color: "#ff0000",
          accent_color: "#00ff00",
          background_color: "#ffffff",
          text_color: "#000000",
          design_style: "tech",
        },
      });

      const result = service.parsePromptEnhancementResponse(json, "fallback");

      expect(result.visualLanguage.primaryColor).toBe("#ff0000");
      expect(result.visualLanguage.accentColor).toBe("#00ff00");
      expect(result.visualLanguage.designStyle).toBe("tech");
    });

    it("should parse negative keywords from various field names", () => {
      const json = JSON.stringify({
        final_prompt: "test prompt",
        negative_keywords: ["blurry", "low quality"],
      });

      const result = service.parsePromptEnhancementResponse(json, "fallback");

      expect(result.negativeKeywords).toContain("blurry");
      expect(result.negativeKeywords).toContain("low quality");
    });

    it("should use fallbackPrompt when imagePrompt is too short", () => {
      const json = JSON.stringify({
        final_prompt: "hi",
        rendering_mode: "ai_image",
      });

      const result = service.parsePromptEnhancementResponse(
        json,
        "This is the fallback prompt",
      );

      expect(result.imagePrompt).toBe("This is the fallback prompt");
    });
  });

  // ============ composeFinalImagePrompt ============

  describe("composeFinalImagePrompt", () => {
    it("should compose pure image prompt in ai_image mode", () => {
      const insights = {
        imagePrompt: "A beautiful sunset over the ocean",
        renderingMode: "ai_image" as const,
        templateLayout: "cards" as const,
        designJournal: [],
        informationArchitecture: {
          title: "",
          sections: [],
        },
        visualLanguage: { colorPalette: [] },
        layoutPlan: [],
        qualityChecks: [],
        negativeKeywords: [],
        styleShiftReasoning: [],
        inspiration: [],
      };

      const result = service.composeFinalImagePrompt(insights);

      expect(result.prompt).toContain("A beautiful sunset over the ocean");
      expect(result.negativeCandidates).toContain("text");
      expect(result.negativeCandidates).toContain("infographic");
    });

    it("should add style enhancement to ai_image prompt", () => {
      const insights = {
        imagePrompt: "A forest scene",
        renderingMode: "ai_image" as const,
        templateLayout: "cards" as const,
        designJournal: [],
        informationArchitecture: { title: "", sections: [] },
        visualLanguage: { colorPalette: [] },
        layoutPlan: [],
        qualityChecks: [],
        negativeKeywords: [],
        styleShiftReasoning: [],
        inspiration: [],
      };

      const result = service.composeFinalImagePrompt(insights, "watercolor");

      expect(result.prompt).toContain("A forest scene");
      expect(result.prompt).toContain("watercolor");
    });

    it("should use title as fallback when imagePrompt is too short in ai_image mode", () => {
      const insights = {
        imagePrompt: "  ",
        renderingMode: "ai_image" as const,
        templateLayout: "cards" as const,
        designJournal: [],
        informationArchitecture: {
          title: "Mountain Landscape",
          sections: [],
        },
        visualLanguage: { colorPalette: [] },
        layoutPlan: [],
        qualityChecks: [],
        negativeKeywords: [],
        styleShiftReasoning: [],
        inspiration: [],
      };

      const result = service.composeFinalImagePrompt(insights);

      expect(result.prompt).toContain("Mountain Landscape");
    });

    it("should compose infographic prompt in html_render mode", () => {
      const insights = {
        imagePrompt: "Data visualization background",
        renderingMode: "html_render" as const,
        templateLayout: "cards" as const,
        designJournal: [],
        informationArchitecture: { title: "", sections: [] },
        visualLanguage: { colorPalette: [] },
        layoutPlan: [],
        qualityChecks: [],
        negativeKeywords: ["3d render"],
        styleShiftReasoning: [],
        inspiration: [],
      };

      const result = service.composeFinalImagePrompt(insights);

      expect(result.prompt).toBeTruthy();
      expect(result.negativeCandidates).toContain("text");
    });

    it("should use backgroundPrompt in hybrid mode when available", () => {
      const insights = {
        imagePrompt: "Some image prompt",
        backgroundPrompt: "Abstract gradient background with geometric shapes",
        renderingMode: "hybrid" as const,
        templateLayout: "cards" as const,
        designJournal: [],
        informationArchitecture: { title: "", sections: [] },
        visualLanguage: { colorPalette: [] },
        layoutPlan: [],
        qualityChecks: [],
        negativeKeywords: [],
        styleShiftReasoning: [],
        inspiration: [],
      };

      const result = service.composeFinalImagePrompt(insights);

      expect(result.prompt).toContain(
        "Abstract gradient background with geometric shapes",
      );
    });

    it("should use default prefix in hybrid mode without backgroundPrompt", () => {
      const insights = {
        imagePrompt: "Some image prompt",
        renderingMode: "hybrid" as const,
        templateLayout: "cards" as const,
        designJournal: [],
        informationArchitecture: { title: "", sections: [] },
        visualLanguage: { colorPalette: [] },
        layoutPlan: [],
        qualityChecks: [],
        negativeKeywords: [],
        styleShiftReasoning: [],
        inspiration: [],
      };

      const result = service.composeFinalImagePrompt(insights);

      expect(result.prompt).toContain("Professional consulting-style");
    });

    it("should include style in html_render mode", () => {
      const insights = {
        imagePrompt: "test prompt",
        renderingMode: "html_render" as const,
        templateLayout: "cards" as const,
        designJournal: [],
        informationArchitecture: { title: "", sections: [] },
        visualLanguage: { colorPalette: [] },
        layoutPlan: [],
        qualityChecks: [],
        negativeKeywords: [],
        styleShiftReasoning: [],
        inspiration: [],
      };

      const result = service.composeFinalImagePrompt(insights, "minimal");

      expect(result.prompt).toContain("minimal");
    });
  });
});
