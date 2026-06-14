/**
 * Unit tests for SlideHtmlGenerationSkill
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  SlideHtmlGenerationSkill,
  SlideHtmlGenerationInput,
} from "../slide-html-generation.skill";

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-html-generation",
  domain: "slides",
  sessionId: "session-1",
  createdAt: new Date(),
  metadata: {},
});

const buildPageOutline = (overrides: Record<string, unknown> = {}) => ({
  pageNumber: 1,
  title: "Market Overview",
  subtitle: "Q4 2024",
  templateType: "dashboard" as const,
  contentBrief: "Show key market metrics",
  keyElements: ["Revenue growth: 25%", "Market cap: $10B", "Users: 1M+"],
  layoutHints: [],
  ...overrides,
});

const buildInput = (
  overrides: Partial<SlideHtmlGenerationInput> = {},
): SlideHtmlGenerationInput => ({
  pageOutline: buildPageOutline(),
  sourceText:
    "The market has seen strong growth in Q4 2024 with revenues increasing 25%.",
  imageUrls: [],
  slideIndex: 0,
  totalSlides: 5,
  ...overrides,
});

const VALID_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;">
  <div class="slide-container" style="width:1280px;height:720px;overflow:hidden;">
    <h1>Market Overview</h1>
  </div>
</body>
</html>`;

describe("SlideHtmlGenerationSkill", () => {
  let skill: SlideHtmlGenerationSkill;

  const mockFacade = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: SlideHtmlGenerationSkill,
          useFactory: () => new SlideHtmlGenerationSkill(mockFacade as any),
        },
      ],
    }).compile();

    skill = module.get<SlideHtmlGenerationSkill>(SlideHtmlGenerationSkill);
  });

  it("should be defined", () => {
    expect(skill).toBeDefined();
  });

  it("should have correct skill metadata", () => {
    expect(skill.id).toBe("slides-html-generation");
    expect(skill.name).toBe("AI HTML 幻灯片生成");
    expect(skill.domain).toBe("slides");
    expect(skill.version).toBe("6.0.0");
  });

  it("should return error when AI facade is not available", async () => {
    const skillWithoutFacade = new SlideHtmlGenerationSkill(undefined as any);

    const result = await skillWithoutFacade.execute(
      buildInput(),
      buildSkillContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("NO_AI_FACADE");
    expect(result.error?.retryable).toBe(false);
  });

  it("should generate HTML from AI response with code block", async () => {
    const aiContent =
      "```html\n" +
      VALID_HTML +
      "\n```\nDesign decisions: Used dashboard layout.";
    mockFacade.chat.mockResolvedValue({ content: aiContent, tokensUsed: 200 });

    const result = await skill.execute(buildInput(), buildSkillContext());

    expect(result.success).toBe(true);
    expect(result.data!.html).toContain("slide-container");
    expect(result.data!.designDecisions).toContain("Design decisions");
  });

  it("should parse HTML from DOCTYPE response without code block", async () => {
    mockFacade.chat.mockResolvedValue({ content: VALID_HTML, tokensUsed: 150 });

    const result = await skill.execute(buildInput(), buildSkillContext());

    expect(result.success).toBe(true);
    expect(result.data!.html).toContain("DOCTYPE");
    expect(result.data!.designDecisions).toBe(
      "AI-generated slide (no code block wrapper)",
    );
  });

  it("should wrap partial HTML when only slide-container div found", async () => {
    const partialHtml =
      '<div class="slide-container" style="width:1280px;height:720px;"><p>Content</p></div>';
    mockFacade.chat.mockResolvedValue({
      content: partialHtml,
      tokensUsed: 100,
    });

    const result = await skill.execute(buildInput(), buildSkillContext());

    expect(result.success).toBe(true);
    expect(result.data!.html).toContain("<!DOCTYPE html>");
    expect(result.data!.designDecisions).toContain("auto-wrapped");
  });

  it("should return error when AI response has no extractable HTML", async () => {
    mockFacade.chat.mockResolvedValue({
      content: "Sorry, I cannot generate HTML for this request.",
      tokensUsed: 30,
    });

    const result = await skill.execute(buildInput(), buildSkillContext());

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("HTML_GENERATION_FAILED");
    expect(result.error?.retryable).toBe(true);
  });

  it("should return error when AI response has error flag", async () => {
    mockFacade.chat.mockResolvedValue({
      content: "",
      isError: true,
      tokensUsed: 0,
    });

    const result = await skill.execute(buildInput(), buildSkillContext());

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("HTML_GENERATION_FAILED");
  });

  it("should handle AI throwing an error", async () => {
    mockFacade.chat.mockRejectedValue(new Error("AI timeout"));

    const result = await skill.execute(buildInput(), buildSkillContext());

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("AI timeout");
    expect(result.error?.retryable).toBe(true);
  });

  it("should post-process generated HTML with overflow protection", async () => {
    const rawHtml = `<!DOCTYPE html>
<html>
<head></head>
<body>
  <div class="slide-container" style="width:1280px;height:720px;overflow:hidden;">
    <h1>Title</h1>
  </div>
</body>
</html>`;
    mockFacade.chat.mockResolvedValue({
      content: "```html\n" + rawHtml + "\n```",
      tokensUsed: 100,
    });

    const result = await skill.execute(
      buildInput({ slideIndex: 1, totalSlides: 5 }),
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    // Post-processor injects overflow protection CSS
    expect(result.data!.html).toContain(
      ".slide-container { overflow: hidden !important; }",
    );
  });

  it("should pass imageUrls context to AI prompt", async () => {
    mockFacade.chat.mockResolvedValue({
      content: "```html\n" + VALID_HTML + "\n```",
      tokensUsed: 150,
    });

    const imageUrls = [
      "https://images.unsplash.com/photo-1.jpg",
      "https://images.unsplash.com/photo-2.jpg",
    ];
    await skill.execute(buildInput({ imageUrls }), buildSkillContext());

    const callArg = mockFacade.chat.mock.calls[0][0];
    const userMessage = callArg.messages[1].content;
    expect(userMessage).toContain("photo-1.jpg");
  });

  it("should include metadata in result", async () => {
    mockFacade.chat.mockResolvedValue({
      content: "```html\n" + VALID_HTML + "\n```",
      tokensUsed: 100,
    });

    const result = await skill.execute(
      buildInput(),
      buildSkillContext("html-exec-5"),
    );

    expect(result.metadata?.executionId).toBe("html-exec-5");
    expect(result.metadata?.duration).toBeGreaterThanOrEqual(0);
  });

  it("should use design system prompt as system message", async () => {
    mockFacade.chat.mockResolvedValue({
      content: "```html\n" + VALID_HTML + "\n```",
      tokensUsed: 100,
    });

    await skill.execute(buildInput(), buildSkillContext());

    const callArg = mockFacade.chat.mock.calls[0][0];
    expect(callArg.messages[0].role).toBe("system");
    expect(callArg.messages[1].role).toBe("user");
  });
});
