/**
 * Unit tests for PagePipelineSkill
 */

import { Test, TestingModule } from "@nestjs/testing";
import { PagePipelineSkill } from "../page-pipeline.skill";

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-page-pipeline",
  domain: "slides",
  sessionId: "session-test",
  createdAt: new Date(),
  metadata: {},
});

const buildOutlinePlan = (pageCount = 2) => ({
  title: "Test Presentation",
  pages: Array.from({ length: pageCount }, (_, i) => ({
    pageNumber: i + 1,
    title: `Page ${i + 1} Title`,
    subtitle: `Subtitle ${i + 1}`,
    templateType: "content" as const,
    contentBrief: `Brief for page ${i + 1}`,
    keyElements: [`Element ${i + 1}`],
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

describe("PagePipelineSkill", () => {
  let skill: PagePipelineSkill;

  const mockTemplateRendering = {
    execute: jest.fn(),
  };

  const mockContentCompression = {
    execute: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockImageFetcher = {
    extractKeywords: jest.fn().mockReturnValue(["business"]),
    searchImages: jest.fn().mockResolvedValue([
      {
        id: "img1",
        url: "https://images.unsplash.com/photo-1.jpg",
        thumbnailUrl: "",
        width: 800,
        height: 600,
      },
    ]),
  };

  const mockSlideHtmlGeneration = {
    execute: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default template rendering response
    mockTemplateRendering.execute.mockResolvedValue({
      success: true,
      data: {
        html: "<html><body>Template HTML</body></html>",
        templateId: "pillars",
      },
    });

    // Default content compression response
    mockContentCompression.execute.mockResolvedValue({
      success: true,
      data: { pageContent: { title: "Test", sections: [] } },
    });

    // Default AI HTML generation response
    mockSlideHtmlGeneration.execute.mockResolvedValue({
      success: true,
      data: {
        html: "<html><body>AI HTML</body></html>",
        designDecisions: "AI adaptive",
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PagePipelineSkill,
          useFactory: () =>
            new PagePipelineSkill(
              mockTemplateRendering as any,
              mockContentCompression as any,
              mockEventEmitter as any,
              mockImageFetcher as any,
              mockSlideHtmlGeneration as any,
            ),
        },
      ],
    }).compile();

    skill = module.get<PagePipelineSkill>(PagePipelineSkill);
  });

  it("should be defined", () => {
    expect(skill).toBeDefined();
  });

  it("should have correct skill metadata", () => {
    expect(skill.id).toBe("slides-page-pipeline");
    expect(skill.name).toBe("页面生成流水线");
    expect(skill.domain).toBe("slides");
    expect(skill.version).toBe("6.0.0");
  });

  it("should return error when no outline plan is found", async () => {
    const result = await skill.execute(
      { previousOutputs: {}, context: { input: {} } },
      buildSkillContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("NO_OUTLINE_PLAN");
    expect(result.error?.retryable).toBe(false);
  });

  it("should generate pages using AI HTML generation when available", async () => {
    const outlinePlan = buildOutlinePlan(2);
    const input = buildPipelineInput(outlinePlan);

    const result = await skill.execute(input, buildSkillContext());

    expect(result.success).toBe(true);
    expect(result.data!.pages).toHaveLength(2);
    expect(result.data!.completedPages).toBe(2);
    expect(result.data!.failedPages).toBe(0);
    expect(mockSlideHtmlGeneration.execute).toHaveBeenCalled();
  });

  it("should use template fallback when AI HTML generation fails", async () => {
    mockSlideHtmlGeneration.execute.mockResolvedValue({
      success: false,
      error: { message: "AI failed" },
    });

    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);

    const result = await skill.execute(input, buildSkillContext());

    expect(result.success).toBe(true);
    expect(result.data!.pages).toHaveLength(1);
    expect(mockTemplateRendering.execute).toHaveBeenCalled();
  });

  it("should fall back to template when AI HTML generation throws", async () => {
    mockSlideHtmlGeneration.execute.mockRejectedValue(new Error("AI crashed"));

    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);

    const result = await skill.execute(input, buildSkillContext());

    expect(result.success).toBe(true);
    expect(mockTemplateRendering.execute).toHaveBeenCalled();
  });

  it("should emit page:generated events for each page", async () => {
    const outlinePlan = buildOutlinePlan(3);
    const input = buildPipelineInput(outlinePlan);

    await skill.execute(input, buildSkillContext());

    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      "slides.page.generated",
      expect.objectContaining({ type: "page:generated" }),
    );
    // 3 pages = 3 generating + 3 generated events
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(6);
  });

  it("should mark page as failed when template rendering throws", async () => {
    mockSlideHtmlGeneration.execute.mockRejectedValue(new Error("AI crashed"));
    mockTemplateRendering.execute.mockRejectedValue(
      new Error("Template failed"),
    );

    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);

    const result = await skill.execute(input, buildSkillContext());

    expect(result.data!.failedPages).toBe(1);
    expect(result.data!.pages[0].status).toBe("failed");
    expect(result.success).toBe(false);
  });

  it("should use template-only pipeline when slideHtmlGeneration is not available", async () => {
    const skillWithoutAi = new PagePipelineSkill(
      mockTemplateRendering as any,
      mockContentCompression as any,
      mockEventEmitter as any,
      undefined,
      undefined,
    );

    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);

    const result = await skillWithoutAi.execute(input, buildSkillContext());

    expect(result.success).toBe(true);
    expect(mockTemplateRendering.execute).toHaveBeenCalled();
    expect(mockSlideHtmlGeneration.execute).not.toHaveBeenCalled();
  });

  it("should calculate totalDuration in output", async () => {
    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);

    const result = await skill.execute(input, buildSkillContext());

    expect(result.data!.totalDuration).toBeGreaterThanOrEqual(0);
  });

  it("should accept outline from context.outlinePlan", async () => {
    const outlinePlan = buildOutlinePlan(1);
    const input = {
      previousOutputs: {},
      context: { outlinePlan, input: { sourceText: "test" } },
    };

    const result = await skill.execute(input, buildSkillContext());

    expect(result.success).toBe(true);
    expect(result.data!.pages).toHaveLength(1);
  });

  it("should include metadata in result", async () => {
    const outlinePlan = buildOutlinePlan(1);
    const input = buildPipelineInput(outlinePlan);

    const result = await skill.execute(
      input,
      buildSkillContext("pipeline-exec-99"),
    );

    expect(result.metadata?.executionId).toBe("pipeline-exec-99");
  });
});
