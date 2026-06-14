import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { TriageAgentService } from "../triage-agent.service";
import { SimilarityMatcherService } from "../similarity-matcher.service";
import { ScreenshotAnalyzerService } from "../../analyzer/screenshot-analyzer.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { TriageInput, SimilarIssue } from "../triage-decision.types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockConfigService = {
  get: jest.fn(),
};

const mockSimilarityMatcher = {
  findSimilarIssues: jest.fn(),
};

const mockScreenshotAnalyzer = {
  analyzeScreenshots: jest.fn(),
};

const mockAiFacade = {
  getDefaultTextModel: jest.fn(),
  chat: jest.fn(),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTriageInput(overrides: Partial<TriageInput> = {}): TriageInput {
  return {
    feedbackId: "feedback-123",
    type: "BUG",
    title: "Button not working on dashboard",
    description:
      "When I click the submit button nothing happens. The page freezes.",
    attachments: [],
    metadata: {
      pageUrl: "https://app.example.com/dashboard",
      userAgent: "Mozilla/5.0 Chrome/120",
      timestamp: new Date("2024-01-15T10:00:00Z"),
      errorStack: undefined,
      consoleErrors: [],
    },
    ...overrides,
  };
}

function makeAiResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    validity: {
      isValid: true,
      confidence: 85,
      reason: "Valid bug report with clear description",
    },
    classification: {
      type: "bug",
      subType: "ui_bug",
      affectedModule: "ai-ask",
      keywords: ["button", "dashboard", "click"],
    },
    priority: {
      userImpact: 60,
      severity: 70,
      frequency: 50,
      businessImpact: 55,
      reasoning: "UI bug affecting user interactions",
    },
    routing: {
      action: "manual_fix",
      confidence: 80,
      reasoning: "Requires frontend investigation",
      manualAssignment: {
        suggestedTeam: "frontend",
        estimatedEffort: "2h",
      },
    },
    ...overrides,
  });
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("TriageAgentService", () => {
  let service: TriageAgentService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockConfigService.get.mockImplementation((key: string) => {
      if (key === "AUTO_FIX_ENABLED") return "true";
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TriageAgentService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SimilarityMatcherService, useValue: mockSimilarityMatcher },
        {
          provide: ScreenshotAnalyzerService,
          useValue: mockScreenshotAnalyzer,
        },
        { provide: ChatFacade, useValue: mockAiFacade },
      ],
    }).compile();

    service = module.get<TriageAgentService>(TriageAgentService);

    // Default behaviors
    mockSimilarityMatcher.findSimilarIssues.mockResolvedValue([]);
    mockScreenshotAnalyzer.analyzeScreenshots.mockResolvedValue({
      hasScreenshot: false,
    });
    mockAiFacade.getDefaultTextModel.mockResolvedValue({
      modelId: "gpt-4o",
    });
    mockAiFacade.chat.mockResolvedValue({
      content: makeAiResponse(),
      tokensUsed: 800,
    });
  });

  // ── triage ────────────────────────────────────────────────────────────────────

  describe("triage", () => {
    it("returns a complete TriageDecision with all required fields", async () => {
      const input = makeTriageInput();

      const decision = await service.triage(input);

      expect(decision).toMatchObject({
        feedbackId: "feedback-123",
        triagedAt: expect.any(Date),
        processingTimeMs: expect.any(Number),
        validity: expect.objectContaining({
          isValid: expect.any(Boolean),
          confidence: expect.any(Number),
          reason: expect.any(String),
        }),
        classification: expect.objectContaining({
          type: expect.any(String),
          subType: expect.any(String),
          affectedModule: expect.any(String),
          keywords: expect.any(Array),
        }),
        priority: expect.objectContaining({
          level: expect.any(String),
          score: expect.any(Number),
          factors: expect.any(Object),
          reasoning: expect.any(String),
        }),
        routing: expect.objectContaining({
          action: expect.any(String),
          confidence: expect.any(Number),
          reasoning: expect.any(String),
        }),
        similarIssues: expect.any(Array),
      });
    });

    it("calls all three analysis tasks in parallel", async () => {
      const input = makeTriageInput();

      await service.triage(input);

      expect(mockScreenshotAnalyzer.analyzeScreenshots).toHaveBeenCalledWith(
        input.attachments,
      );
      expect(mockSimilarityMatcher.findSimilarIssues).toHaveBeenCalledWith(
        input.title,
        input.description,
        expect.any(Object),
      );
      expect(mockAiFacade.getDefaultTextModel).toHaveBeenCalled();
      expect(mockAiFacade.chat).toHaveBeenCalled();
    });

    it("classifies as duplicate when similarity >= 90", async () => {
      const similarIssues: SimilarIssue[] = [
        {
          feedbackId: "original-feedback-456",
          title: "Button not working on dashboard",
          similarity: 95,
          status: "OPEN",
        },
      ];

      mockSimilarityMatcher.findSimilarIssues.mockResolvedValue(similarIssues);

      const input = makeTriageInput();
      const decision = await service.triage(input);

      expect(decision.routing.action).toBe("reject");
      expect(decision.validity.isValid).toBe(false);
      expect(decision.validity.invalidReason).toBe("duplicate");
      expect(decision.routing.rejectReason).toContain("original-feedback-456");
    });

    it("does not classify as duplicate when similarity < 90", async () => {
      const similarIssues: SimilarIssue[] = [
        {
          feedbackId: "feedback-789",
          title: "Similar button issue",
          similarity: 75,
          status: "OPEN",
        },
      ];

      mockSimilarityMatcher.findSimilarIssues.mockResolvedValue(similarIssues);

      const input = makeTriageInput();
      const decision = await service.triage(input);

      expect(decision.routing.action).not.toBe("reject");
      expect(decision.validity.invalidReason).not.toBe("duplicate");
    });

    it("degrades auto_fix to manual_fix when autoFix conditions not met", async () => {
      // AI suggests auto_fix but with very low confidence
      mockAiFacade.chat.mockResolvedValue({
        content: makeAiResponse({
          routing: {
            action: "auto_fix",
            confidence: 20, // too low for auto_fix threshold (85)
            reasoning: "Simple CSS fix",
            autoFixPlan: {
              approach: "Change button color",
              estimatedComplexity: "trivial",
              riskLevel: "low",
              requiresReview: false,
            },
          },
        }),
        tokensUsed: 600,
      });

      const input = makeTriageInput();
      const decision = await service.triage(input);

      // Should be degraded to manual_fix
      expect(decision.routing.action).toBe("manual_fix");
      expect(decision.routing.reasoning).toContain("自动修复");
    });

    it("returns fallback decision when triage process throws", async () => {
      mockAiFacade.getDefaultTextModel.mockRejectedValue(
        new Error("AI service down"),
      );
      mockSimilarityMatcher.findSimilarIssues.mockRejectedValue(
        new Error("DB error"),
      );

      const input = makeTriageInput();
      const decision = await service.triage(input);

      // Fallback decision should still be a valid structure
      expect(decision.feedbackId).toBe("feedback-123");
      expect(decision.routing.action).toBe("manual_fix");
      expect(decision.routing.confidence).toBeLessThan(50); // Low confidence fallback
      expect(decision.validity.isValid).toBe(true); // Default to valid
    });

    it("includes processing time in milliseconds", async () => {
      const input = makeTriageInput();
      const start = Date.now();

      const decision = await service.triage(input);

      expect(decision.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(decision.processingTimeMs).toBeLessThan(Date.now() - start + 100);
    });

    it("passes error stack to AI prompt when present", async () => {
      const input = makeTriageInput({
        metadata: {
          pageUrl: "https://app.example.com/dashboard",
          userAgent: "Mozilla/5.0",
          timestamp: new Date(),
          errorStack:
            "TypeError: Cannot read property 'click' of null\n  at dashboard.js:42",
        },
      });

      await service.triage(input);

      const aiCallArgs = mockAiFacade.chat.mock.calls[0][0];
      const userMessage = aiCallArgs.messages.find(
        (m: { role: string }) => m.role === "user",
      );
      expect(userMessage.content).toContain("TypeError");
      expect(userMessage.content).toContain("dashboard.js");
    });

    it("includes console errors in AI prompt when present", async () => {
      const input = makeTriageInput({
        metadata: {
          pageUrl: "https://app.example.com",
          userAgent: "Chrome",
          timestamp: new Date(),
          consoleErrors: [
            "Failed to load resource: 404",
            "Uncaught ReferenceError: xyz is not defined",
          ],
        },
      });

      await service.triage(input);

      const aiCallArgs = mockAiFacade.chat.mock.calls[0][0];
      const userMessage = aiCallArgs.messages.find(
        (m: { role: string }) => m.role === "user",
      );
      expect(userMessage.content).toContain("Failed to load resource");
      expect(userMessage.content).toContain("ReferenceError");
    });

    it("includes attachment information in AI prompt", async () => {
      const input = makeTriageInput({
        attachments: [
          {
            filename: "screenshot.png",
            url: "https://storage.example.com/screenshot.png",
            mimeType: "image/png",
            size: 150000,
          },
        ],
      });

      await service.triage(input);

      const aiCallArgs = mockAiFacade.chat.mock.calls[0][0];
      const userMessage = aiCallArgs.messages.find(
        (m: { role: string }) => m.role === "user",
      );
      expect(userMessage.content).toContain("screenshot.png");
      expect(userMessage.content).toContain("image/png");
    });
  });

  // ── AI response parsing ───────────────────────────────────────────────────────

  describe("AI response parsing", () => {
    it("correctly maps AI validity fields to decision", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: makeAiResponse({
          validity: {
            isValid: false,
            confidence: 90,
            reason: "Spam detected",
            invalidReason: "spam",
          },
        }),
        tokensUsed: 400,
      });

      const input = makeTriageInput();
      const decision = await service.triage(input);

      expect(decision.validity.isValid).toBe(false);
      expect(decision.validity.confidence).toBe(90);
      expect(decision.validity.invalidReason).toBe("spam");
    });

    it("correctly maps priority factors and calculates score", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: makeAiResponse({
          priority: {
            userImpact: 90,
            severity: 95,
            frequency: 80,
            businessImpact: 90,
            reasoning: "Critical issue affecting all users",
          },
        }),
        tokensUsed: 500,
      });

      const input = makeTriageInput();
      const decision = await service.triage(input);

      // High scores should result in critical priority
      expect(decision.priority.level).toBe("critical");
      expect(decision.priority.score).toBeGreaterThanOrEqual(85);
    });

    it("correctly maps low priority factors to low priority level", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: makeAiResponse({
          priority: {
            userImpact: 20,
            severity: 15,
            frequency: 10,
            businessImpact: 25,
            reasoning: "Minor cosmetic issue",
          },
        }),
        tokensUsed: 400,
      });

      const input = makeTriageInput();
      const decision = await service.triage(input);

      expect(decision.priority.level).toBe("low");
    });

    it("uses defaults when AI returns invalid JSON", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: "Sorry, I cannot analyze this right now.",
        tokensUsed: 100,
      });

      const input = makeTriageInput();
      const decision = await service.triage(input);

      // Should fall back to default analysis
      expect(decision).toBeDefined();
      expect(decision.routing.action).toBeDefined();
    });

    it("falls back to default analysis when AI call throws", async () => {
      mockAiFacade.getDefaultTextModel.mockResolvedValue({ modelId: "gpt-4o" });
      mockAiFacade.chat.mockRejectedValue(new Error("Token limit exceeded"));

      const input = makeTriageInput();
      const decision = await service.triage(input);

      // Should use default analysis (manual_fix, medium priority)
      expect(decision.routing.action).toBe("manual_fix");
      expect(decision.priority.level).toBe("medium");
    });
  });

  // ── module guessing ───────────────────────────────────────────────────────────

  describe("module guessing in default analysis", () => {
    it("guesses ppt module from ppt keyword in description", async () => {
      // Force AI to fail so default analysis is used
      mockAiFacade.chat.mockRejectedValue(new Error("AI unavailable"));
      mockAiFacade.getDefaultTextModel.mockRejectedValue(new Error("No model"));

      const input = makeTriageInput({
        title: "PPT generation fails",
        description: "The ppt幻灯片 export breaks",
      });

      const decision = await service.triage(input);

      expect(decision.classification.affectedModule).toContain("ppt");
    });

    it("guesses research module from research keyword", async () => {
      mockAiFacade.chat.mockRejectedValue(new Error("AI unavailable"));
      mockAiFacade.getDefaultTextModel.mockRejectedValue(new Error("No model"));

      const input = makeTriageInput({
        title: "Research report empty",
        description: "AI research studio not generating reports",
        metadata: {
          pageUrl: "https://app.example.com/ai-studio/research",
          userAgent: "Chrome",
          timestamp: new Date(),
        },
      });

      const decision = await service.triage(input);

      expect(decision.classification.affectedModule).toMatch(/studio|research/);
    });

    it("returns unknown module when no patterns match", async () => {
      mockAiFacade.chat.mockRejectedValue(new Error("AI unavailable"));
      mockAiFacade.getDefaultTextModel.mockRejectedValue(new Error("No model"));

      const input = makeTriageInput({
        title: "Something is broken",
        description: "Nothing works",
        metadata: {
          pageUrl: undefined,
          userAgent: undefined,
          timestamp: new Date(),
        },
      });

      const decision = await service.triage(input);

      expect(decision.classification.affectedModule).toBe("unknown");
    });
  });

  // ── configuration ─────────────────────────────────────────────────────────────

  describe("getConfig", () => {
    it("returns current triage configuration", () => {
      const config = service.getConfig();

      expect(config).toMatchObject({
        autoFixEnabled: expect.any(Boolean),
        autoFixThresholds: expect.any(Object),
        similarityThreshold: expect.any(Number),
        maxSimilarIssues: expect.any(Number),
      });
    });

    it("respects AUTO_FIX_ENABLED=false env variable", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "AUTO_FIX_ENABLED") return "false";
        return undefined;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TriageAgentService,
          { provide: ConfigService, useValue: mockConfigService },
          {
            provide: SimilarityMatcherService,
            useValue: mockSimilarityMatcher,
          },
          {
            provide: ScreenshotAnalyzerService,
            useValue: mockScreenshotAnalyzer,
          },
          { provide: ChatFacade, useValue: mockAiFacade },
        ],
      }).compile();

      const serviceWithAutoFixDisabled =
        module.get<TriageAgentService>(TriageAgentService);

      const config = serviceWithAutoFixDisabled.getConfig();

      expect(config.autoFixEnabled).toBe(false);
    });
  });

  // ── keyword extraction ────────────────────────────────────────────────────────

  describe("keyword extraction (via default analysis)", () => {
    it("extracts keywords from title and description when AI fails", async () => {
      mockAiFacade.chat.mockRejectedValue(new Error("AI unavailable"));
      mockAiFacade.getDefaultTextModel.mockRejectedValue(new Error("No model"));

      const input = makeTriageInput({
        title: "Login button broken",
        description: "Cannot click login authentication fails",
      });

      const decision = await service.triage(input);

      expect(decision.classification.keywords.length).toBeGreaterThan(0);
    });

    it("filters out common stop words from keywords", async () => {
      mockAiFacade.chat.mockRejectedValue(new Error("AI unavailable"));
      mockAiFacade.getDefaultTextModel.mockRejectedValue(new Error("No model"));

      const input = makeTriageInput({
        title: "The button is broken",
        description:
          "When I click the button it is not working the page is freezing",
      });

      const decision = await service.triage(input);

      // Stop words list includes: "the", "a", "an", "is", "are", "was", "were"
      const keywords = decision.classification.keywords;
      expect(keywords).not.toContain("the");
      expect(keywords).not.toContain("is");
    });

    it("limits extracted keywords to at most 10", async () => {
      mockAiFacade.chat.mockRejectedValue(new Error("AI unavailable"));
      mockAiFacade.getDefaultTextModel.mockRejectedValue(new Error("No model"));

      const input = makeTriageInput({
        title:
          "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda",
        description:
          "mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega",
      });

      const decision = await service.triage(input);

      expect(decision.classification.keywords.length).toBeLessThanOrEqual(10);
    });
  });

  // ── duplicate detection ───────────────────────────────────────────────────────

  describe("duplicate detection", () => {
    it("returns false isDuplicate when no similar issues exist", async () => {
      mockSimilarityMatcher.findSimilarIssues.mockResolvedValue([]);

      const input = makeTriageInput();
      const decision = await service.triage(input);

      expect(decision.routing.action).not.toBe("reject");
      expect(decision.validity.invalidReason).not.toBe("duplicate");
    });

    it("uses top similar issue for duplicate check (not second or third)", async () => {
      const similarIssues: SimilarIssue[] = [
        {
          feedbackId: "top-issue",
          title: "Same button issue",
          similarity: 95, // ≥ 90 → duplicate
          status: "OPEN",
        },
        {
          feedbackId: "second-issue",
          title: "Related button issue",
          similarity: 80,
          status: "CLOSED",
        },
      ];

      mockSimilarityMatcher.findSimilarIssues.mockResolvedValue(similarIssues);

      const input = makeTriageInput();
      const decision = await service.triage(input);

      expect(decision.routing.action).toBe("reject");
      expect(decision.routing.rejectReason).toContain("top-issue");
    });

    it("includes screenshot analysis in decision", async () => {
      mockScreenshotAnalyzer.analyzeScreenshots.mockResolvedValue({
        hasScreenshot: true,
        detectedErrors: ["TypeError: undefined is not a function"],
        uiElements: ["button", "form"],
      });

      const input = makeTriageInput({
        attachments: [
          {
            filename: "error.png",
            url: "https://storage.example.com/error.png",
            mimeType: "image/png",
            size: 100000,
          },
        ],
      });

      const decision = await service.triage(input);

      expect(decision.screenshotAnalysis).toBeDefined();
      expect(decision.screenshotAnalysis?.hasScreenshot).toBe(true);
    });
  });
});
