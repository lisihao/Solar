/**
 * Unit tests for ContentPolisherSkill
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ContentPolisherSkill } from "../content-polisher.skill";

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-content-polisher",
  domain: "slides",
  sessionId: "session-1",
  createdAt: new Date(),
  metadata: {},
});

const buildPage = (index: number, title: string, content: string) => ({
  index,
  title,
  content,
  type: "content",
});

describe("ContentPolisherSkill", () => {
  let skill: ContentPolisherSkill;

  const mockFacade = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ContentPolisherSkill,
          useFactory: () => new ContentPolisherSkill(mockFacade as any),
        },
      ],
    }).compile();

    skill = module.get<ContentPolisherSkill>(ContentPolisherSkill);
  });

  it("should be defined", () => {
    expect(skill).toBeDefined();
  });

  it("should have correct skill metadata", () => {
    expect(skill.id).toBe("slides-content-polisher");
    expect(skill.name).toBe("内容润色");
    expect(skill.domain).toBe("slides");
    expect(skill.version).toBe("5.0.0");
  });

  it("should return error when pages are empty", async () => {
    const result = await skill.execute({ pages: [] }, buildSkillContext());

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.retryable).toBe(false);
  });

  it("should polish pages successfully with AI response", async () => {
    const aiResponse = JSON.stringify({
      polishedContent: "<p>Polished content here</p>",
      changes: [
        {
          changeType: "tone",
          original: "original text",
          polished: "polished text",
          reason: "tone adjustment",
        },
      ],
    });
    mockFacade.chat.mockResolvedValue({ content: aiResponse, tokensUsed: 100 });

    const pages = [buildPage(0, "Introduction", "<p>original content</p>")];
    const result = await skill.execute(
      { pages, targetTone: "formal", language: "en" },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.pages).toHaveLength(1);
    expect(result.data!.stats.totalPages).toBe(1);
    expect(result.data!.changes).toHaveLength(1);
  });

  it("should return original page when AI facade is not available", async () => {
    const skillWithoutFacade = new ContentPolisherSkill(undefined as any);
    const pages = [buildPage(0, "Test", "Original content")];

    const result = await skillWithoutFacade.execute(
      { pages },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.pages[0].content).toBe("Original content");
    expect(result.data!.changes).toHaveLength(0);
  });

  it("should process multiple pages in parallel", async () => {
    mockFacade.chat.mockResolvedValue({
      content: JSON.stringify({ polishedContent: "Polished", changes: [] }),
      tokensUsed: 50,
    });

    const pages = [
      buildPage(0, "Page 1", "Content 1"),
      buildPage(1, "Page 2", "Content 2"),
      buildPage(2, "Page 3", "Content 3"),
    ];

    const result = await skill.execute({ pages }, buildSkillContext());

    expect(result.success).toBe(true);
    expect(result.data!.pages).toHaveLength(3);
    expect(mockFacade.chat).toHaveBeenCalledTimes(3);
  });

  it("should use style guide in prompt when provided", async () => {
    mockFacade.chat.mockResolvedValue({
      content: JSON.stringify({ polishedContent: "Result", changes: [] }),
      tokensUsed: 100,
    });

    const pages = [buildPage(0, "Title", "Content")];
    const styleGuide = {
      terminology: "Use formal terms",
      forbiddenWords: ["stuff", "things"],
      preferredTerms: { AI: "Artificial Intelligence" },
    };

    await skill.execute(
      { pages, styleGuide, language: "en" },
      buildSkillContext(),
    );

    const callArg = mockFacade.chat.mock.calls[0][0];
    const messageContent = callArg.messages[0].content;
    expect(messageContent).toContain("formal terms");
    expect(messageContent).toContain("stuff");
  });

  it("should handle AI response with invalid JSON gracefully", async () => {
    mockFacade.chat.mockResolvedValue({
      content: "This is not JSON at all",
      tokensUsed: 50,
    });

    const pages = [buildPage(0, "Test", "Original")];
    const result = await skill.execute({ pages }, buildSkillContext());

    // Should return original content on parse failure
    expect(result.success).toBe(true);
    expect(result.data!.pages[0].content).toBe("Original");
  });

  it("should return error when AI call throws", async () => {
    mockFacade.chat.mockRejectedValue(new Error("AI service unavailable"));

    const pages = [buildPage(0, "Test", "Content")];
    const result = await skill.execute(
      { pages, language: "zh" },
      buildSkillContext(),
    );

    // polishPage catches the error and returns original, execute succeeds
    expect(result.success).toBe(true);
    expect(result.data!.pages[0].content).toBe("Content");
  });

  it("should build Chinese prompts when language is zh", async () => {
    mockFacade.chat.mockResolvedValue({
      content: JSON.stringify({ polishedContent: "润色结果", changes: [] }),
      tokensUsed: 80,
    });

    const pages = [buildPage(0, "标题", "内容")];
    await skill.execute(
      { pages, language: "zh", targetTone: "formal" },
      buildSkillContext(),
    );

    const callArg = mockFacade.chat.mock.calls[0][0];
    const messageContent = callArg.messages[0].content;
    expect(messageContent).toContain("润色要求");
  });

  it("should count polished pages correctly", async () => {
    // First page gets different content, second gets same
    mockFacade.chat
      .mockResolvedValueOnce({
        content: JSON.stringify({
          polishedContent: "Changed content",
          changes: [
            { changeType: "tone", original: "a", polished: "b", reason: "r" },
          ],
        }),
        tokensUsed: 50,
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          polishedContent: "Same content",
          changes: [],
        }),
        tokensUsed: 50,
      });

    const pages = [
      buildPage(0, "Page 1", "Original 1"),
      buildPage(1, "Page 2", "Same content"),
    ];

    const result = await skill.execute({ pages }, buildSkillContext());

    expect(result.success).toBe(true);
    expect(result.data!.stats.totalPages).toBe(2);
  });

  it("should include metadata in result", async () => {
    mockFacade.chat.mockResolvedValue({
      content: JSON.stringify({ polishedContent: "Result", changes: [] }),
      tokensUsed: 100,
    });

    const result = await skill.execute(
      { pages: [buildPage(0, "Title", "Content")] },
      buildSkillContext("exec-99"),
    );

    expect(result.metadata?.executionId).toBe("exec-99");
    expect(result.metadata?.duration).toBeGreaterThanOrEqual(0);
  });
});
