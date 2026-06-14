/**
 * Unit tests for VoiceNarrationSkill
 */

import { Test, TestingModule } from "@nestjs/testing";
import { VoiceNarrationSkill } from "../voice-narration.skill";

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "voice-narration",
  domain: "slides",
  sessionId: "session-1",
  createdAt: new Date(),
  metadata: {},
});

const buildPage = (
  index: number,
  title: string,
  content: string,
  keyPoints?: string[],
) => ({
  index,
  title,
  content,
  keyPoints,
});

describe("VoiceNarrationSkill", () => {
  let skill: VoiceNarrationSkill;

  const mockFacade = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: VoiceNarrationSkill,
          useFactory: () => new VoiceNarrationSkill(mockFacade as any),
        },
      ],
    }).compile();

    skill = module.get<VoiceNarrationSkill>(VoiceNarrationSkill);
  });

  it("should be defined", () => {
    expect(skill).toBeDefined();
  });

  it("should have correct skill metadata", () => {
    expect(skill.id).toBe("voice-narration");
    expect(skill.name).toBe("Voice Narration Skill");
    expect(skill.domain).toBe("slides");
  });

  it("should generate narration for a single page with AI", async () => {
    mockFacade.chat.mockResolvedValue({
      content: "欢迎来到本次演讲。今天我们将探讨市场趋势和增长机会。",
      tokensUsed: 60,
    });

    const pages = [buildPage(0, "市场概况", "<p>市场增长迅速</p>")];
    const result = await skill.execute(
      { pages, presentationTitle: "年度报告", language: "zh" },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.narrations).toHaveLength(1);
    expect(result.data!.narrations[0].script).toContain("欢迎");
    expect(result.data!.narrations[0].pageIndex).toBe(0);
  });

  it("should generate narration for multiple pages", async () => {
    mockFacade.chat.mockResolvedValue({
      content: "This is a narration for the slide.",
      tokensUsed: 40,
    });

    const pages = [
      buildPage(0, "Intro", "<p>Introduction</p>"),
      buildPage(1, "Body", "<p>Main content</p>"),
      buildPage(2, "Conclusion", "<p>Wrap up</p>"),
    ];

    const result = await skill.execute(
      { pages, presentationTitle: "Annual Report", language: "en" },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.narrations).toHaveLength(3);
    expect(result.data!.stats.totalPages).toBe(3);
    expect(mockFacade.chat).toHaveBeenCalledTimes(3);
  });

  it("should use template fallback when AI facade is not available", async () => {
    const skillWithoutFacade = new VoiceNarrationSkill(undefined as any);

    const pages = [buildPage(0, "Introduction", "<p>Intro content</p>")];
    const result = await skillWithoutFacade.execute(
      {
        pages,
        presentationTitle: "Test Deck",
        language: "en",
        style: "formal",
      },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.narrations[0].script).toContain("Introduction");
  });

  it("should use Chinese template fallback without AI", async () => {
    const skillWithoutFacade = new VoiceNarrationSkill(undefined as any);

    const pages = [
      buildPage(0, "市场分析", "内容", ["要点一", "要点二", "要点三"]),
    ];
    const result = await skillWithoutFacade.execute(
      { pages, presentationTitle: "报告", language: "zh" },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    const script = result.data!.narrations[0].script;
    expect(script).toContain("市场分析");
  });

  it("should estimate duration based on word count", async () => {
    const narrationText = "这是一个关于人工智能的演讲旁白文字内容测试段落。";
    mockFacade.chat.mockResolvedValue({
      content: narrationText,
      tokensUsed: 50,
    });

    const pages = [buildPage(0, "标题", "内容")];
    const result = await skill.execute(
      { pages, presentationTitle: "测试", language: "zh", wordsPerMinute: 200 },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.narrations[0].estimatedDuration).toBeGreaterThan(0);
    expect(result.data!.totalDuration).toBe(
      result.data!.narrations[0].estimatedDuration,
    );
  });

  it("should support different narration styles", async () => {
    mockFacade.chat.mockResolvedValue({
      content: "Storytelling style narration here.",
      tokensUsed: 50,
    });

    const pages = [buildPage(0, "Story", "<p>Once upon a time</p>")];
    await skill.execute(
      {
        pages,
        presentationTitle: "Story Time",
        style: "storytelling",
        language: "en",
      },
      buildSkillContext(),
    );

    const chatArg = mockFacade.chat.mock.calls[0][0];
    const prompt = chatArg.messages[0].content;
    // The style guide translates 'storytelling' to 'Narrative, engaging, story-driven'
    expect(prompt).toContain("story");
  });

  it("should calculate total words and average stats", async () => {
    mockFacade.chat
      .mockResolvedValueOnce({ content: "Short narration.", tokensUsed: 20 })
      .mockResolvedValueOnce({
        content: "Longer narration with more words here.",
        tokensUsed: 30,
      });

    const pages = [
      buildPage(0, "P1", "Content 1"),
      buildPage(1, "P2", "Content 2"),
    ];

    const result = await skill.execute(
      { pages, presentationTitle: "Deck", language: "en" },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.stats.totalWords).toBeGreaterThan(0);
    expect(result.data!.stats.averageWordsPerPage).toBeGreaterThan(0);
  });

  it("should include targetAudience in prompt when provided", async () => {
    mockFacade.chat.mockResolvedValue({ content: "Narration", tokensUsed: 40 });

    const pages = [buildPage(0, "Title", "Content")];
    await skill.execute(
      {
        pages,
        presentationTitle: "Deck",
        language: "en",
        targetAudience: "executives",
      },
      buildSkillContext(),
    );

    const chatArg = mockFacade.chat.mock.calls[0][0];
    const prompt = chatArg.messages[0].content;
    expect(prompt).toContain("executives");
  });

  it("should handle AI error gracefully", async () => {
    mockFacade.chat.mockRejectedValue(new Error("AI service error"));

    const pages = [buildPage(0, "Test", "Content")];
    const result = await skill.execute(
      { pages, presentationTitle: "Deck" },
      buildSkillContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("NARRATION_GENERATION_FAILED");
    expect(result.error?.retryable).toBe(true);
  });
});
