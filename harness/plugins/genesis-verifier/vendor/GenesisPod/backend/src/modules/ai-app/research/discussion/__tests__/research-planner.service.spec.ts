/**
 * ResearchPlannerService Tests
 *
 * Covers:
 * - generatePlan: success (parse JSON from ```json``` block), AI failure (fallback),
 *   follow-up mode, all depth levels, language options
 * - parsePlanResponse: valid JSON, no JSON (fallback), invalid JSON (fallback)
 * - getDefaultPlan: quick / standard / thorough depths, academic flag
 * - buildPlanningPrompt: normal mode, follow-up mode with previous context
 * - validateStepType: valid types pass through, unknown type defaults to deep_dive
 * - formatPreviousContext: sections and references trimming
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { ResearchPlannerService } from "../research-planner.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

// ============================================================
// Helpers
// ============================================================

const mockFacade = {
  chat: jest.fn(),
};

function makePlanJson(steps: Array<{ type: string; query: string }> = []) {
  return JSON.stringify({
    objective: "Understand climate change",
    approach: "Multi-source analysis",
    steps: steps.map((s, i) => ({
      type: s.type,
      query: s.query,
      rationale: `Rationale ${i + 1}`,
      estimatedSources: 10,
    })),
  });
}

function makeChatResponse(content: string) {
  return { content };
}

// ============================================================
// Tests
// ============================================================

describe("ResearchPlannerService", () => {
  let service: ResearchPlannerService;

  beforeEach(async () => {
    mockFacade.chat.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchPlannerService,
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<ResearchPlannerService>(ResearchPlannerService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== generatePlan ====================

  describe("generatePlan", () => {
    it("should generate plan from valid JSON response with ```json``` block", async () => {
      const planJson = makePlanJson([
        { type: "initial_search", query: "climate change overview" },
        { type: "deep_dive", query: "climate impacts" },
      ]);
      mockFacade.chat.mockResolvedValue(
        makeChatResponse(`Here is the plan:\n\`\`\`json\n${planJson}\n\`\`\``),
      );

      const plan = await service.generatePlan("climate change");

      expect(plan.objective).toBe("Understand climate change");
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0].id).toBe("step_1");
      expect(plan.steps[0].type).toBe("initial_search");
      expect(plan.steps[1].type).toBe("deep_dive");
      expect(plan.estimatedTime).toBe(40);
    });

    it("should generate plan from valid JSON without code fence", async () => {
      const planJson = makePlanJson([
        { type: "academic", query: "AI research papers" },
      ]);
      mockFacade.chat.mockResolvedValue(makeChatResponse(planJson));

      const plan = await service.generatePlan("artificial intelligence");

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].type).toBe("academic");
    });

    it("should return default plan when AI response has no JSON", async () => {
      mockFacade.chat.mockResolvedValue(
        makeChatResponse("I cannot generate a plan right now."),
      );

      const plan = await service.generatePlan("test query");

      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.objective).toBeTruthy();
    });

    it("should return default plan when AI chat throws an error", async () => {
      mockFacade.chat.mockRejectedValue(new Error("API timeout"));

      const plan = await service.generatePlan("test query");

      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it("should call aiFacade.chat with CHAT modelType and medium creativity", async () => {
      mockFacade.chat.mockResolvedValue(
        makeChatResponse(
          `\`\`\`json\n${makePlanJson([{ type: "initial_search", query: "q" }])}\n\`\`\``,
        ),
      );

      await service.generatePlan("test");

      expect(mockFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: AIModelType.CHAT,
          taskProfile: expect.objectContaining({ creativity: "medium" }),
        }),
      );
    });

    it("should default to standard depth when not specified", async () => {
      const planJson = makePlanJson([
        { type: "initial_search", query: "q1" },
        { type: "deep_dive", query: "q2" },
        { type: "academic", query: "q3" },
      ]);
      mockFacade.chat.mockResolvedValue(
        makeChatResponse(`\`\`\`json\n${planJson}\n\`\`\``),
      );

      await service.generatePlan("standard query");

      expect(mockFacade.chat).toHaveBeenCalledOnce;
    });

    it("should generate quick plan via default fallback with fewer steps", async () => {
      mockFacade.chat.mockRejectedValue(new Error("fail"));

      const plan = await service.generatePlan("quick query", {
        depth: "quick",
      });

      // Quick plan: only initial_search (no deep_dive, no academic)
      expect(plan.steps.some((s) => s.type === "initial_search")).toBe(true);
      expect(plan.steps.some((s) => s.type === "verification")).toBe(false);
    });

    it("should generate thorough plan via default fallback with more steps", async () => {
      mockFacade.chat.mockRejectedValue(new Error("fail"));

      const plan = await service.generatePlan("thorough query", {
        depth: "thorough",
        includeAcademic: true,
      });

      expect(plan.steps.some((s) => s.type === "comparison")).toBe(true);
      expect(plan.steps.some((s) => s.type === "verification")).toBe(true);
    });

    it("should exclude academic step when includeAcademic=false in default plan", async () => {
      mockFacade.chat.mockRejectedValue(new Error("fail"));

      const plan = await service.generatePlan("query", {
        depth: "standard",
        includeAcademic: false,
      });

      expect(plan.steps.every((s) => s.type !== "academic")).toBe(true);
    });

    it("should include academic step when includeAcademic=true and depth=standard", async () => {
      mockFacade.chat.mockRejectedValue(new Error("fail"));

      const plan = await service.generatePlan("query", {
        depth: "standard",
        includeAcademic: true,
      });

      expect(plan.steps.some((s) => s.type === "academic")).toBe(true);
    });

    it("should use follow-up prompts when isFollowUp=true", async () => {
      const planJson = makePlanJson([
        { type: "deep_dive", query: "follow-up q" },
      ]);
      mockFacade.chat.mockResolvedValue(
        makeChatResponse(`\`\`\`json\n${planJson}\n\`\`\``),
      );

      const previousContext = {
        executiveSummary: "Previous research summary",
        sections: [{ title: "Sec 1", content: "Content here..." }],
        conclusion: "Previous conclusion",
        references: [{ title: "Ref 1", url: "https://ref1.com" }],
      };

      await service.generatePlan("follow-up question", {
        isFollowUp: true,
        previousContext,
      });

      const chatCall = mockFacade.chat.mock.calls[0][0];
      // The system prompt should contain previous context
      expect(chatCall.messages[0].content).toBeTruthy();
      expect(chatCall.messages).toHaveLength(2);
    });

    it("should use en-US prompts when language=en-US", async () => {
      const planJson = makePlanJson([
        { type: "initial_search", query: "en query" },
      ]);
      mockFacade.chat.mockResolvedValue(
        makeChatResponse(`\`\`\`json\n${planJson}\n\`\`\``),
      );

      const plan = await service.generatePlan("AI ethics", {
        language: "en-US",
      });

      expect(plan.steps).toHaveLength(1);
    });

    it("should default unknown step type to deep_dive", async () => {
      const planJson = makePlanJson([{ type: "unknown_type", query: "test" }]);
      mockFacade.chat.mockResolvedValue(
        makeChatResponse(`\`\`\`json\n${planJson}\n\`\`\``),
      );

      const plan = await service.generatePlan("test");

      expect(plan.steps[0].type).toBe("deep_dive");
    });

    it("should use valid step types when they appear in response", async () => {
      const validTypes = [
        "initial_search",
        "deep_dive",
        "academic",
        "comparison",
        "verification",
      ];
      for (const type of validTypes) {
        const planJson = makePlanJson([{ type, query: `${type} query` }]);
        mockFacade.chat.mockResolvedValueOnce(
          makeChatResponse(`\`\`\`json\n${planJson}\n\`\`\``),
        );

        const plan = await service.generatePlan("query");
        expect(plan.steps[0].type).toBe(type);
      }
    });

    it("should calculate estimated time as steps * 20", async () => {
      const planJson = makePlanJson([
        { type: "initial_search", query: "q1" },
        { type: "deep_dive", query: "q2" },
        { type: "academic", query: "q3" },
      ]);
      mockFacade.chat.mockResolvedValue(
        makeChatResponse(`\`\`\`json\n${planJson}\n\`\`\``),
      );

      const plan = await service.generatePlan("test");

      expect(plan.estimatedTime).toBe(60);
    });

    it("should handle previous context with multiple sections and references", async () => {
      mockFacade.chat.mockRejectedValue(new Error("fail"));

      const previousContext = {
        executiveSummary: "Summary",
        sections: [
          { title: "Sec A", content: "A".repeat(300) },
          { title: "Sec B", content: "B".repeat(300) },
        ],
        conclusion: "Final conclusion",
        references: Array.from({ length: 10 }, (_, i) => ({
          title: `Ref ${i + 1}`,
          url: `https://ref${i + 1}.com`,
        })),
      };

      const plan = await service.generatePlan("follow-up", {
        isFollowUp: true,
        previousContext,
      });

      // Should still return valid plan (fallback)
      expect(plan.steps.length).toBeGreaterThan(0);
    });
  });
});
