/**
 * PagePipelineSkill Supplemental Tests
 *
 * Targets uncovered paths (~41 lines):
 * - extractInputData: nested data.pages, direct outline field, context.outline
 * - generateDesignThinking: various templateType, isAiGenerated=false path
 * - detectLanguage: Chinese text (>10% ratio), empty string
 * - resolveThemeHint: known and unknown theme IDs
 * - generateWithAi: design token injection failure, smart content extraction failure,
 *   image fetcher failure, AI html returns no data (fallback), no keywords
 * - generateWithTemplate: ContentCompression failure (fallback to basic)
 * - self-healer: triggered when page fails, healer success, healer failure
 * - visual validator: validation fails + refiner runs + refiner improved
 * - emitPageGenerated: null eventEmitter guard
 * - previousPageSummary accumulation
 */

import { PagePipelineSkill } from "../page-pipeline.skill";

const buildSkillContext = (id = "test-supplemental-1") => ({
  executionId: id,
  skillId: "slides-page-pipeline",
  domain: "slides",
  sessionId: "session-supplemental",
  createdAt: new Date(),
  metadata: {},
});

const buildOutlinePlan = (pageCount = 1, templateType = "content") => ({
  title: "Supplemental Presentation",
  pages: Array.from({ length: pageCount }, (_, i) => ({
    pageNumber: i + 1,
    title: `Page ${i + 1}`,
    subtitle: `Sub ${i + 1}`,
    templateType: templateType as any,
    contentBrief: `Brief ${i + 1}`,
    keyElements: [`Key ${i + 1}`],
    layoutHints: [],
  })),
  globalStyles: {},
  contentFlow: {},
});

const buildPipelineInput = (
  outlinePlan: ReturnType<typeof buildOutlinePlan>,
  sourceText = "source",
) => ({
  previousOutputs: { "slides-outline-planning": outlinePlan },
  context: { input: { sourceText, themeId: "genspark-dark" } },
});

describe("PagePipelineSkill (supplemental)", () => {
  const mockTemplateRendering = { execute: jest.fn() };
  const mockContentCompression = { execute: jest.fn() };
  const mockEventEmitter = { emit: jest.fn() };
  const mockImageFetcher = {
    extractKeywords: jest.fn().mockReturnValue(["business"]),
    searchImages: jest.fn().mockResolvedValue([
      {
        id: "img1",
        url: "https://images.example.com/1.jpg",
        thumbnailUrl: "",
        width: 800,
        height: 600,
      },
    ]),
  };
  const mockSlideHtmlGeneration = { execute: jest.fn() };
  const mockDesignTokenInjector = { execute: jest.fn() };
  const mockSmartContentExtractor = { execute: jest.fn() };
  const mockVisualValidator = { execute: jest.fn() };
  const mockIterativeRefiner = { execute: jest.fn() };
  const mockSelfHealer = { execute: jest.fn() };

  function buildSkill(
    options: {
      withAi?: boolean;
      withDesignToken?: boolean;
      withSmartExtractor?: boolean;
      withValidator?: boolean;
      withRefiner?: boolean;
      withSelfHealer?: boolean;
    } = {},
  ) {
    return new PagePipelineSkill(
      mockTemplateRendering as any,
      mockContentCompression as any,
      mockEventEmitter as any,
      mockImageFetcher as any,
      options.withAi !== false ? (mockSlideHtmlGeneration as any) : undefined,
      options.withDesignToken ? (mockDesignTokenInjector as any) : undefined,
      options.withSmartExtractor
        ? (mockSmartContentExtractor as any)
        : undefined,
      options.withValidator ? (mockVisualValidator as any) : undefined,
      options.withRefiner ? (mockIterativeRefiner as any) : undefined,
      options.withSelfHealer ? (mockSelfHealer as any) : undefined,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();

    mockTemplateRendering.execute.mockResolvedValue({
      success: true,
      data: { html: "<html>Template</html>", templateId: "cover" },
    });
    mockContentCompression.execute.mockResolvedValue({
      success: true,
      data: { pageContent: { title: "Test", sections: [] } },
    });
    mockSlideHtmlGeneration.execute.mockResolvedValue({
      success: true,
      data: { html: "<html>AI</html>", designDecisions: "AI adaptive layout" },
    });
    mockDesignTokenInjector.execute.mockResolvedValue({
      success: true,
      data: { promptFragment: "Dark theme tokens" },
    });
    mockSmartContentExtractor.execute.mockResolvedValue({
      success: true,
      data: { promptFragment: "Extracted content" },
    });
    mockVisualValidator.execute.mockResolvedValue({
      success: true,
      data: { passed: true, score: 90 },
    });
    mockIterativeRefiner.execute.mockResolvedValue({
      success: true,
      data: { improved: false, html: "<html>Refined</html>", finalScore: 85 },
    });
    mockSelfHealer.execute.mockResolvedValue({
      success: true,
      data: { healed: false, html: "", strategy: "fallback", confidence: 0.5 },
    });
  });

  // =========================================================================
  // extractInputData — various outline sources
  // =========================================================================

  it("should extract outline from context.outlinePlan when previousOutputs is empty", async () => {
    const outlinePlan = buildOutlinePlan(1);
    const input = {
      previousOutputs: {},
      context: {
        input: { sourceText: "test" },
        outlinePlan, // context-level outlinePlan
      },
    };
    const skill = buildSkill({ withAi: false });
    const result = await skill.execute(input as any, buildSkillContext());
    expect(result.success).toBe(true);
    expect(result.data!.pages).toHaveLength(1);
  });

  it("should extract outline from direct input.outline field", async () => {
    const outlinePlan = buildOutlinePlan(1);
    const input = {
      outline: outlinePlan,
      previousOutputs: {},
      context: { input: { sourceText: "test" } },
    };
    const skill = buildSkill({ withAi: false });
    const result = await skill.execute(input as any, buildSkillContext());
    expect(result.success).toBe(true);
  });

  it("should use default themeId genspark-dark when none provided", async () => {
    const outlinePlan = buildOutlinePlan(1);
    const input = {
      previousOutputs: { "slides-outline-planning": outlinePlan },
      context: { input: { sourceText: "test" } }, // no themeId
    };
    const skill = buildSkill({ withAi: false });
    const result = await skill.execute(input, buildSkillContext());
    expect(result.success).toBe(true);
  });

  // =========================================================================
  // design token injection failure (graceful)
  // =========================================================================

  it("should proceed without theme tokens when design token injection fails", async () => {
    mockDesignTokenInjector.execute.mockRejectedValue(
      new Error("Token service down"),
    );

    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);
    const skill = buildSkill({ withDesignToken: true });

    const result = await skill.execute(input, buildSkillContext());
    expect(result.success).toBe(true);
    expect(mockSlideHtmlGeneration.execute).toHaveBeenCalled();
  });

  // =========================================================================
  // smart content extractor failure (graceful)
  // =========================================================================

  it("should proceed without extracted content when smart extractor fails", async () => {
    mockSmartContentExtractor.execute.mockRejectedValue(
      new Error("Extractor down"),
    );

    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);
    const skill = buildSkill({ withSmartExtractor: true });

    const result = await skill.execute(input, buildSkillContext());
    expect(result.success).toBe(true);
    expect(mockSlideHtmlGeneration.execute).toHaveBeenCalled();
  });

  // =========================================================================
  // image fetcher failure (graceful)
  // =========================================================================

  it("should proceed without images when image search fails", async () => {
    mockImageFetcher.searchImages.mockRejectedValue(
      new Error("Image search failed"),
    );

    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);
    const skill = buildSkill();

    const result = await skill.execute(input, buildSkillContext());
    expect(result.success).toBe(true);
    expect(mockSlideHtmlGeneration.execute).toHaveBeenCalled();
  });

  // =========================================================================
  // no keywords returned by imageFetcher
  // =========================================================================

  it("should skip image search when no keywords returned", async () => {
    mockImageFetcher.extractKeywords.mockReturnValue([]);

    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);
    const skill = buildSkill();

    const result = await skill.execute(input, buildSkillContext());
    expect(result.success).toBe(true);
    expect(mockImageFetcher.searchImages).not.toHaveBeenCalled();
  });

  // =========================================================================
  // visual validation fails + refiner improves HTML
  // =========================================================================

  it("should refine HTML when validation fails and refiner improves it", async () => {
    mockVisualValidator.execute.mockResolvedValue({
      success: true,
      data: { passed: false, score: 45 },
    });
    mockIterativeRefiner.execute.mockResolvedValue({
      success: true,
      data: {
        improved: true,
        html: "<html>Refined Better</html>",
        finalScore: 80,
      },
    });

    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);
    const skill = buildSkill({ withValidator: true, withRefiner: true });

    const result = await skill.execute(input, buildSkillContext());
    expect(result.success).toBe(true);
    expect(mockIterativeRefiner.execute).toHaveBeenCalled();
    // HTML should be the refined version
    expect(result.data!.pages[0].html).toBe("<html>Refined Better</html>");
  });

  // =========================================================================
  // visual validation fails but refiner does NOT improve
  // =========================================================================

  it("should keep original HTML when validator fails but refiner does not improve", async () => {
    mockVisualValidator.execute.mockResolvedValue({
      success: true,
      data: { passed: false, score: 45 },
    });
    mockIterativeRefiner.execute.mockResolvedValue({
      success: true,
      data: { improved: false, html: "", finalScore: 45 },
    });

    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);
    const skill = buildSkill({ withValidator: true, withRefiner: true });

    const result = await skill.execute(input, buildSkillContext());
    expect(result.success).toBe(true);
    expect(result.data!.pages[0].html).toBe("<html>AI</html>");
  });

  // =========================================================================
  // validation throws error (graceful)
  // =========================================================================

  it("should proceed when validation throws error", async () => {
    mockVisualValidator.execute.mockRejectedValue(
      new Error("Validator crashed"),
    );

    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);
    const skill = buildSkill({ withValidator: true });

    const result = await skill.execute(input, buildSkillContext());
    expect(result.success).toBe(true);
  });

  // =========================================================================
  // self-healer triggered on page failure, healed successfully
  // =========================================================================

  it("should use self-healer when page generation fails and healer succeeds", async () => {
    mockSlideHtmlGeneration.execute.mockRejectedValue(new Error("AI crashed"));
    mockTemplateRendering.execute.mockRejectedValue(
      new Error("Template also crashed"),
    );
    mockSelfHealer.execute.mockResolvedValue({
      success: true,
      data: {
        healed: true,
        html: "<html>Healed</html>",
        strategy: "minimal-template",
        confidence: 0.8,
      },
    });

    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);
    const skill = buildSkill({ withSelfHealer: true });

    const result = await skill.execute(input, buildSkillContext());
    expect(result.success).toBe(true);
    expect(result.data!.completedPages).toBe(1);
    expect(result.data!.pages[0].templateId).toContain("healed");
  });

  // =========================================================================
  // self-healer fails, page marked as failed
  // =========================================================================

  it("should mark page as failed when self-healer also fails", async () => {
    mockSlideHtmlGeneration.execute.mockRejectedValue(new Error("AI crashed"));
    mockTemplateRendering.execute.mockRejectedValue(
      new Error("Template also crashed"),
    );
    mockSelfHealer.execute.mockRejectedValue(new Error("Healer crashed too"));

    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);
    const skill = buildSkill({ withSelfHealer: true });

    const result = await skill.execute(input, buildSkillContext());
    expect(result.success).toBe(false);
    expect(result.data!.failedPages).toBe(1);
  });

  // =========================================================================
  // ContentCompression failure → fallback to basic page content
  // =========================================================================

  it("should use basic page content when ContentCompression fails", async () => {
    mockContentCompression.execute.mockRejectedValue(
      new Error("Compression failed"),
    );

    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);
    const skill = buildSkill({ withAi: false });

    const result = await skill.execute(input, buildSkillContext());
    // templateRendering should still be called with basic content
    expect(result.success).toBe(true);
    expect(mockTemplateRendering.execute).toHaveBeenCalled();
  });

  // =========================================================================
  // Template rendering returns failure result (not throwing)
  // =========================================================================

  it("should throw when template rendering returns failure result", async () => {
    mockSlideHtmlGeneration.execute.mockRejectedValue(new Error("AI failed"));
    mockTemplateRendering.execute.mockResolvedValue({
      success: false,
      error: { message: "Template not found" },
    });

    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);
    const skill = buildSkill();

    const result = await skill.execute(input, buildSkillContext());
    expect(result.data!.failedPages).toBe(1);
  });

  // =========================================================================
  // generateDesignThinking — various templateType paths (non-AI)
  // =========================================================================

  it("should generate design thinking for template-rendered page", async () => {
    const skill = buildSkill({ withAi: false });
    const outlinePlan = buildOutlinePlan(1, "cover");
    const input = buildPipelineInput(outlinePlan, "Chinese source 你好世界");

    const result = await skill.execute(input, buildSkillContext());
    expect(result.success).toBe(true);
  });

  it("should generate design thinking for timeline templateType", async () => {
    const skill = buildSkill();
    const outlinePlan = buildOutlinePlan(1, "timeline");
    const input = buildPipelineInput(outlinePlan);

    const result = await skill.execute(input, buildSkillContext());
    expect(result.success).toBe(true);
  });

  // =========================================================================
  // detectLanguage via Chinese source text
  // =========================================================================

  it("should detect Chinese language and pass it to AI generation", async () => {
    const skill = buildSkill();
    // >10% Chinese characters
    const chineseText =
      "这是一段中文内容，用于测试语言检测功能。This is a test.";
    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan, chineseText);

    await skill.execute(input, buildSkillContext());

    const callArgs = mockSlideHtmlGeneration.execute.mock.calls[0][0];
    expect(callArgs.language).toBe("Chinese (Simplified)");
  });

  it("should return undefined language for empty source text", async () => {
    const skill = buildSkill();
    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan, "");

    await skill.execute(input, buildSkillContext());

    const callArgs = mockSlideHtmlGeneration.execute.mock.calls[0][0];
    expect(callArgs.language).toBeUndefined();
  });

  // =========================================================================
  // resolveThemeHint — known and unknown themes
  // =========================================================================

  it("should pass theme description for known theme IDs", async () => {
    const skill = buildSkill();
    const outlinePlan = buildOutlinePlan(1);
    const input = {
      previousOutputs: { "slides-outline-planning": outlinePlan },
      context: { input: { sourceText: "test", themeId: "corporate-blue" } },
    };

    await skill.execute(input, buildSkillContext());

    const callArgs = mockSlideHtmlGeneration.execute.mock.calls[0][0];
    expect(callArgs.themeHint).toContain("blue");
  });

  it("should use themeId as-is for unknown theme IDs", async () => {
    const skill = buildSkill();
    const outlinePlan = buildOutlinePlan(1);
    const input = {
      previousOutputs: { "slides-outline-planning": outlinePlan },
      context: { input: { sourceText: "test", themeId: "my-custom-theme" } },
    };

    await skill.execute(input, buildSkillContext());

    const callArgs = mockSlideHtmlGeneration.execute.mock.calls[0][0];
    expect(callArgs.themeHint).toBe("my-custom-theme");
  });

  // =========================================================================
  // previousPageSummary accumulation across pages
  // =========================================================================

  it("should pass previousPageSummary to subsequent pages", async () => {
    const skill = buildSkill();
    const outlinePlan = buildOutlinePlan(2);
    const input = buildPipelineInput(outlinePlan);

    await skill.execute(input, buildSkillContext());

    // Second page call should have previousPageSummary defined
    expect(mockSlideHtmlGeneration.execute).toHaveBeenCalledTimes(2);
    const secondCallArgs = mockSlideHtmlGeneration.execute.mock.calls[1][0];
    expect(secondCallArgs.previousPageSummary).toBeDefined();
    expect(secondCallArgs.previousPageSummary).toContain("Page 1");
  });

  // =========================================================================
  // emit events for failed page
  // =========================================================================

  it("should emit slides.page.failed event when page generation fails", async () => {
    mockSlideHtmlGeneration.execute.mockRejectedValue(new Error("All failed"));
    mockTemplateRendering.execute.mockRejectedValue(
      new Error("Template failed"),
    );

    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);
    const skill = buildSkill();

    await skill.execute(input, buildSkillContext());

    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      "slides.page.failed",
      expect.objectContaining({ pageNumber: 1 }),
    );
  });
});
