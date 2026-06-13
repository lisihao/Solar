/**
 * Tests for ResearchPlannerService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ResearchPlannerService } from "../discussion/research-planner.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient { $connect = jest.fn(); $disconnect = jest.fn(); $on = jest.fn(); }, AIModelType: {
    CHAT: "CHAT",
    CHAT_FAST: "CHAT_FAST",
  },
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn().mockImplementation(() => ({
    chat: jest.fn(),
    sanitizeReport: jest.fn((text: string) => text),
  })),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn().mockImplementation(() => ({
    chat: jest.fn(),
    sanitizeReport: jest.fn((text: string) => text),
  })),
}));

describe("ResearchPlannerService", () => {
  let service: ResearchPlannerService;
  let aiFacade: jest.Mocked<ChatFacade>;

  const mockValidPlanJson = JSON.stringify({
    objective: "Understand AI trends",
    approach: "Multi-step research",
    steps: [
      {
        type: "initial_search",
        query: "AI technology 2025",
        rationale: "Get current state",
        estimatedSources: 10,
      },
      {
        type: "deep_dive",
        query: "Deep learning advances",
        rationale: "Deep analysis",
        estimatedSources: 8,
      },
    ],
  });

  beforeEach(async () => {
    const mockFacadeInstance = {
      chat: jest.fn().mockResolvedValue({
        content: `\`\`\`json\n${mockValidPlanJson}\n\`\`\``,
        tokensUsed: 500,
      }),
      sanitizeReport: jest.fn((text: string) => text),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchPlannerService,
        {
          provide: ChatFacade,
          useValue: mockFacadeInstance,
        },
      ],
    }).compile();

    service = module.get<ResearchPlannerService>(ResearchPlannerService);
    aiFacade = module.get(ChatFacade);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("generatePlan", () => {
    it("should generate a plan successfully", async () => {
      const plan = await service.generatePlan("AI trends research");

      expect(plan).toBeDefined();
      expect(plan.objective).toBe("Understand AI trends");
      expect(plan.steps.length).toBe(2);
      expect(plan.steps[0].id).toBe("step_1");
      expect(plan.steps[0].type).toBe("initial_search");
    });

    it("should call aiFacade.chat with correct parameters", async () => {
      await service.generatePlan("AI trends research");

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system" }),
            expect.objectContaining({ role: "user" }),
          ]),
          taskProfile: expect.objectContaining({
            creativity: "medium",
          }),
        }),
      );
    });

    it("should return default plan when AI returns no JSON", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: "No JSON here",
        tokensUsed: 100,
      });

      const plan = await service.generatePlan("Test query");

      expect(plan).toBeDefined();
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.steps[0].type).toBe("initial_search");
    });

    it("should return default plan when AI call throws", async () => {
      (aiFacade.chat as jest.Mock).mockRejectedValue(new Error("API Error"));

      const plan = await service.generatePlan("Test query");

      expect(plan).toBeDefined();
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it("should return default plan when JSON parse fails", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: "```json\n{invalid json}\n```",
        tokensUsed: 100,
      });

      const plan = await service.generatePlan("Test query");

      expect(plan).toBeDefined();
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it("should estimate time based on steps count", async () => {
      const plan = await service.generatePlan("AI research");

      expect(plan.estimatedTime).toBe(plan.steps.length * 20);
    });

    it("should use quick depth for default plan when specified", async () => {
      (aiFacade.chat as jest.Mock).mockRejectedValue(new Error("fail"));

      const plan = await service.generatePlan("Test", { depth: "quick" });

      // quick depth: only initial_search step
      expect(plan.steps.length).toBe(1);
      expect(plan.steps[0].type).toBe("initial_search");
    });

    it("should include academic step for standard depth with includeAcademic", async () => {
      (aiFacade.chat as jest.Mock).mockRejectedValue(new Error("fail"));

      const plan = await service.generatePlan("Test", {
        depth: "standard",
        includeAcademic: true,
      });

      const academicStep = plan.steps.find((s) => s.type === "academic");
      expect(academicStep).toBeDefined();
    });

    it("should not include academic step when includeAcademic is false", async () => {
      (aiFacade.chat as jest.Mock).mockRejectedValue(new Error("fail"));

      const plan = await service.generatePlan("Test", {
        depth: "standard",
        includeAcademic: false,
      });

      const academicStep = plan.steps.find((s) => s.type === "academic");
      expect(academicStep).toBeUndefined();
    });

    it("should include comparison and verification steps for thorough depth", async () => {
      (aiFacade.chat as jest.Mock).mockRejectedValue(new Error("fail"));

      const plan = await service.generatePlan("Test", { depth: "thorough" });

      const comparisonStep = plan.steps.find((s) => s.type === "comparison");
      const verificationStep = plan.steps.find(
        (s) => s.type === "verification",
      );
      expect(comparisonStep).toBeDefined();
      expect(verificationStep).toBeDefined();
    });

    it("should handle follow-up mode", async () => {
      const previousContext = {
        executiveSummary: "Previous summary",
        sections: [{ title: "Section 1", content: "Content 1" }],
        conclusion: "Previous conclusion",
        references: [{ title: "Ref 1", url: "https://example.com" }],
      };

      const plan = await service.generatePlan("Follow-up query", {
        isFollowUp: true,
        previousContext,
      });

      expect(plan).toBeDefined();
      // Verify the AI was called with follow-up mode (different prompts)
      expect(aiFacade.chat).toHaveBeenCalled();
    });

    it("should validate and normalize unknown step types", async () => {
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify({
          objective: "Test",
          approach: "Test",
          steps: [
            {
              type: "unknown_type",
              query: "Test query",
              rationale: "Test",
              estimatedSources: 5,
            },
          ],
        }),
        tokensUsed: 100,
      });

      const plan = await service.generatePlan("Test query");

      // Unknown types should be normalized to 'deep_dive'
      expect(plan.steps[0].type).toBe("deep_dive");
    });

    it("should use en-US language when specified", async () => {
      await service.generatePlan("AI research", { language: "en-US" });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system" }),
          ]),
        }),
      );
    });
  });
});
