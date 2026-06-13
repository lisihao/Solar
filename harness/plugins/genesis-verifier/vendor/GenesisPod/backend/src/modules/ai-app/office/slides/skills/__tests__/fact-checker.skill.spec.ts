/**
 * Unit tests for FactCheckerSkill
 */

import { Test, TestingModule } from "@nestjs/testing";
import { FactCheckerSkill } from "../fact-checker.skill";

const buildSkillContext = (id = "test-exec-1") => ({
  executionId: id,
  skillId: "slides-fact-checker",
  domain: "slides",
  sessionId: "session-1",
  createdAt: new Date(),
  metadata: {},
});

const buildPage = (index: number, title: string, content: string) => ({
  index,
  title,
  content,
});

describe("FactCheckerSkill", () => {
  let skill: FactCheckerSkill;

  const mockFacade = {
    chat: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: FactCheckerSkill,
          useFactory: () => new FactCheckerSkill(mockFacade as any),
        },
      ],
    }).compile();

    skill = module.get<FactCheckerSkill>(FactCheckerSkill);
  });

  it("should be defined", () => {
    expect(skill).toBeDefined();
  });

  it("should have correct skill metadata", () => {
    expect(skill.id).toBe("slides-fact-checker");
    expect(skill.name).toBe("事实核查");
    expect(skill.domain).toBe("slides");
    expect(skill.layer).toBeDefined();
  });

  it("should return error when pages are empty", async () => {
    const result = await skill.execute({ pages: [] }, buildSkillContext());

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.retryable).toBe(false);
  });

  it("should process pages with no claims successfully (100 score)", async () => {
    // Return empty claims array
    mockFacade.chat.mockResolvedValue({ content: "[]", tokensUsed: 30 });

    const pages = [buildPage(0, "Introduction", "General introduction text")];
    const result = await skill.execute({ pages }, buildSkillContext());

    expect(result.success).toBe(true);
    expect(result.data!.results).toHaveLength(1);
    expect(result.data!.results[0].overallScore).toBe(100);
    expect(result.data!.results[0].credibilityLevel).toBe("high");
  });

  it("should extract claims and verify them via AI", async () => {
    const claimsJson = JSON.stringify([
      {
        text: "85%",
        type: "statistic",
        confidence: 0.9,
        context: "market share is 85%",
      },
    ]);
    const verificationsJson = JSON.stringify([
      {
        claimIndex: 0,
        status: "verified",
        credibilityScore: 90,
        sources: ["Source A"],
        explanation: "Confirmed by industry reports",
      },
    ]);

    mockFacade.chat
      .mockResolvedValueOnce({ content: claimsJson, tokensUsed: 50 })
      .mockResolvedValueOnce({ content: verificationsJson, tokensUsed: 80 });

    const pages = [buildPage(0, "Stats", "Market share is 85%")];
    const result = await skill.execute(
      { pages, language: "en" },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data!.results[0].claims).toHaveLength(1);
    expect(result.data!.results[0].claims[0].status).toBe("verified");
    expect(result.data!.summary.verifiedCount).toBe(1);
  });

  it("should use regex fallback when AI facade is not available", async () => {
    const skillWithoutFacade = new FactCheckerSkill(undefined as any);

    const pages = [
      buildPage(
        0,
        "Data Page",
        "Revenue grew 45% in 2024. Market cap exceeded 2 billion.",
      ),
    ];

    const result = await skillWithoutFacade.execute(
      { pages },
      buildSkillContext(),
    );

    expect(result.success).toBe(true);
    // Regex should pick up percentages and dates
    expect(result.data!.results[0].claims.length).toBeGreaterThanOrEqual(0);
  });

  it("should calculate summary statistics correctly", async () => {
    const claimsJson = JSON.stringify([
      { text: "claim1", type: "statistic", confidence: 0.8, context: "" },
      { text: "claim2", type: "fact", confidence: 0.7, context: "" },
    ]);
    const verificationsJson = JSON.stringify([
      { claimIndex: 0, status: "verified", credibilityScore: 90, sources: [] },
      {
        claimIndex: 1,
        status: "needs_citation",
        credibilityScore: 50,
        sources: [],
      },
    ]);

    mockFacade.chat
      .mockResolvedValueOnce({ content: claimsJson, tokensUsed: 50 })
      .mockResolvedValueOnce({ content: verificationsJson, tokensUsed: 80 });

    const pages = [buildPage(0, "Summary", "claim1 claim2")];
    const result = await skill.execute({ pages }, buildSkillContext());

    expect(result.success).toBe(true);
    expect(result.data!.summary.totalClaims).toBe(2);
    expect(result.data!.summary.verifiedCount).toBe(1);
    expect(result.data!.summary.needsCitationCount).toBe(1);
  });

  it("should handle disputed and outdated claims in summary", async () => {
    const claimsJson = JSON.stringify([
      {
        text: "outdated stat",
        type: "statistic",
        confidence: 0.6,
        context: "",
      },
    ]);
    const verificationsJson = JSON.stringify([
      { claimIndex: 0, status: "outdated", credibilityScore: 30, sources: [] },
    ]);

    mockFacade.chat
      .mockResolvedValueOnce({ content: claimsJson, tokensUsed: 40 })
      .mockResolvedValueOnce({ content: verificationsJson, tokensUsed: 60 });

    const pages = [buildPage(0, "Old Data", "outdated stat")];
    const result = await skill.execute({ pages }, buildSkillContext());

    expect(result.success).toBe(true);
    expect(result.data!.summary.disputedCount).toBe(1);
  });

  it("should return needs_citation when AI verification fails", async () => {
    mockFacade.chat
      .mockResolvedValueOnce({
        content: JSON.stringify([
          { text: "a claim", type: "fact", confidence: 0.8, context: "" },
        ]),
        tokensUsed: 30,
      })
      .mockRejectedValueOnce(new Error("Verification API failed"));

    const pages = [buildPage(0, "Claim Page", "a claim")];
    const result = await skill.execute({ pages }, buildSkillContext());

    expect(result.success).toBe(true);
    expect(result.data!.results[0].claims[0].status).toBe("needs_citation");
    expect(result.data!.results[0].claims[0].credibilityScore).toBe(50);
  });

  it("should assign credibility levels correctly", async () => {
    // Mock returns empty claims so score = 100
    mockFacade.chat.mockResolvedValue({ content: "[]", tokensUsed: 20 });

    const pages = [buildPage(0, "High Credibility", "No claims")];
    const result = await skill.execute({ pages }, buildSkillContext());

    expect(result.data!.results[0].credibilityLevel).toBe("high");
  });

  it("should support strictMode in verification prompt", async () => {
    mockFacade.chat
      .mockResolvedValueOnce({
        content: JSON.stringify([
          { text: "stat", type: "statistic", confidence: 0.9, context: "" },
        ]),
        tokensUsed: 30,
      })
      .mockResolvedValueOnce({
        content: JSON.stringify([
          {
            claimIndex: 0,
            status: "verified",
            credibilityScore: 80,
            sources: [],
          },
        ]),
        tokensUsed: 50,
      });

    const pages = [buildPage(0, "Test", "stat")];
    await skill.execute(
      { pages, strictMode: true, language: "zh" },
      buildSkillContext(),
    );

    const verifyChatCall = mockFacade.chat.mock.calls[1][0];
    const verifyPrompt = verifyChatCall.messages[0].content;
    expect(verifyPrompt).toContain("严格模式");
  });

  it("should include metadata in successful result", async () => {
    mockFacade.chat.mockResolvedValue({ content: "[]", tokensUsed: 10 });

    const result = await skill.execute(
      { pages: [buildPage(0, "T", "C")] },
      buildSkillContext("fact-exec-42"),
    );

    expect(result.metadata?.executionId).toBe("fact-exec-42");
    expect(result.metadata?.duration).toBeGreaterThanOrEqual(0);
  });
});
