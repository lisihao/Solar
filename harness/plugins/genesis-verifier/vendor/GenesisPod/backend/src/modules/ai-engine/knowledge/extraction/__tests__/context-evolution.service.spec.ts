import { Test, TestingModule } from "@nestjs/testing";
import { ContextEvolutionService } from "../context-evolution.service";

describe("ContextEvolutionService", () => {
  let service: ContextEvolutionService;
  let mockAiCaller: jest.Mock;

  const mockFact1 = {
    id: "fact-1",
    statement: "林清瑶是一个不能说话的宫女",
    category: "character" as const,
    importance: "high" as const,
    sourceTaskId: "task-1",
    sourceTaskTitle: "第一章",
    establishedAt: "2025-01-01T00:00:00.000Z",
  };

  const mockFact2 = {
    id: "fact-2",
    statement: "萧景辰是太子，对林清瑶有好感",
    category: "relationship" as const,
    importance: "medium" as const,
    sourceTaskId: "task-1",
    sourceTaskTitle: "第一章",
    establishedAt: "2025-01-02T00:00:00.000Z",
  };

  const validFactsJsonResponse = JSON.stringify([
    {
      statement: "林清瑶是宫女",
      category: "character",
      importance: "high",
      relatedEntities: ["林清瑶"],
    },
    {
      statement: "东厂由魏忠贤领导",
      category: "world",
      importance: "medium",
      relatedEntities: ["东厂", "魏忠贤"],
    },
  ]);

  beforeEach(async () => {
    mockAiCaller = jest.fn().mockResolvedValue({
      content: "```json\n" + validFactsJsonResponse + "\n```",
      tokensUsed: 120,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [ContextEvolutionService],
    }).compile();

    service = module.get<ContextEvolutionService>(ContextEvolutionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== extractFacts ====================

  describe("extractFacts", () => {
    const request = {
      taskId: "task-1",
      taskTitle: "第一章：宫廷初遇",
      // Content longer than minOutputLength (200 chars) - use ASCII to be safe
      taskOutput:
        "A".repeat(250) +
        " Lin Qingyao is a mute palace maid who meets Prince Xiao Jingchen. They develop feelings for each other under the surveillance of the Eastern Factory.",
      existingFacts: [],
      existingEntities: [],
    };

    it("should extract facts using aiCaller", async () => {
      const result = await service.extractFacts(request, mockAiCaller);

      expect(mockAiCaller).toHaveBeenCalled();
      expect(result.facts.length).toBeGreaterThan(0);
      expect(result.tokensUsed).toBe(120);
    });

    it("should skip extraction for short output (less than minOutputLength=200)", async () => {
      const shortRequest = { ...request, taskOutput: "Short" };

      const result = await service.extractFacts(shortRequest, mockAiCaller);

      expect(mockAiCaller).not.toHaveBeenCalled();
      expect(result.facts).toEqual([]);
      expect(result.tokensUsed).toBe(0);
    });

    it("should include taskId in extracted facts", async () => {
      const result = await service.extractFacts(request, mockAiCaller);

      if (result.facts.length > 0) {
        expect(result.facts[0].sourceTaskId).toBe("task-1");
        expect(result.facts[0].sourceTaskTitle).toBe("第一章：宫廷初遇");
      }
    });

    it("should return empty facts when AI fails", async () => {
      mockAiCaller.mockRejectedValue(new Error("AI Error"));

      const result = await service.extractFacts(request, mockAiCaller);

      expect(result.facts).toEqual([]);
      expect(result.tokensUsed).toBe(0);
    });

    it("should handle non-JSON response gracefully", async () => {
      mockAiCaller.mockResolvedValue({
        content: "I cannot extract any facts from this content.",
        tokensUsed: 50,
      });

      const result = await service.extractFacts(request, mockAiCaller);
      expect(result.facts).toEqual([]);
    });

    it("should pass system and user messages to aiCaller", async () => {
      await service.extractFacts(request, mockAiCaller);

      const callArgs = mockAiCaller.mock.calls[0];
      const messages = callArgs[1];
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("system");
      expect(messages[1].role).toBe("user");
    });

    it("should include task title in extraction prompt", async () => {
      await service.extractFacts(request, mockAiCaller);

      const callArgs = mockAiCaller.mock.calls[0];
      const messages = callArgs[1];
      const userMsg = messages.find((m: any) => m.role === "user");
      expect(userMsg.content).toContain("第一章：宫廷初遇");
    });

    it("should include existing entities to avoid re-extraction", async () => {
      const requestWithEntities = {
        ...request,
        existingEntities: ["林清瑶", "萧景辰"],
      };

      await service.extractFacts(requestWithEntities, mockAiCaller);

      const callArgs = mockAiCaller.mock.calls[0];
      const messages = callArgs[1];
      const userMsg = messages.find((m: any) => m.role === "user");
      expect(userMsg.content).toContain("林清瑶");
    });

    it("should truncate very long output for extraction", async () => {
      const longOutput = "A".repeat(20000);
      const longRequest = { ...request, taskOutput: longOutput };

      await service.extractFacts(longRequest, mockAiCaller);

      const callArgs = mockAiCaller.mock.calls[0];
      const messages = callArgs[1];
      const userMsg = messages.find((m: any) => m.role === "user");
      expect(userMsg.content).toContain("内容已截断");
    });

    it("should use default minOutputLength of 200", async () => {
      // Content with 150 chars is less than default 200
      const shortOutput = "A".repeat(150);
      const shortRequest = { ...request, taskOutput: shortOutput };

      const result = await service.extractFacts(shortRequest, mockAiCaller);
      expect(result.facts).toEqual([]);
    });

    it("should respect custom minOutputLength config", async () => {
      const shortOutput = "A".repeat(30);
      const shortRequest = { ...request, taskOutput: shortOutput };

      // With custom config allowing shorter outputs
      await service.extractFacts(shortRequest, mockAiCaller, {
        minOutputLength: 10,
      });

      expect(mockAiCaller).toHaveBeenCalled();
    });

    it("should assign ids to extracted facts", async () => {
      const result = await service.extractFacts(request, mockAiCaller);

      for (const fact of result.facts) {
        expect(fact.id).toBeDefined();
        expect(typeof fact.id).toBe("string");
      }
    });

    it("should assign establishedAt timestamps (as string)", async () => {
      const result = await service.extractFacts(request, mockAiCaller);

      for (const fact of result.facts) {
        expect(fact.establishedAt).toBeDefined();
        expect(typeof fact.establishedAt).toBe("string");
      }
    });
  });

  // ==================== mergeFacts ====================

  describe("mergeFacts", () => {
    it("should merge new facts with existing facts", () => {
      const existing = [mockFact1];
      const newFacts = [mockFact2];

      const merged = service.mergeFacts(existing, newFacts);

      expect(merged).toHaveLength(2);
    });

    it("should deduplicate facts with same statement", () => {
      const existing = [mockFact1];
      const duplicateNewFacts = [{ ...mockFact1, id: "fact-dup" }];

      const merged = service.mergeFacts(existing, duplicateNewFacts);

      expect(merged).toHaveLength(1);
    });

    it("should be case-insensitive in deduplication", () => {
      const existing = [mockFact1];
      const duplicateWithDifferentCase = [
        {
          ...mockFact1,
          id: "fact-dup",
          statement: mockFact1.statement.toUpperCase(),
        },
      ];

      const merged = service.mergeFacts(existing, duplicateWithDifferentCase);

      expect(merged).toHaveLength(1);
    });

    it("should handle empty arrays", () => {
      expect(service.mergeFacts([], [])).toEqual([]);
      expect(service.mergeFacts([mockFact1], [])).toHaveLength(1);
      expect(service.mergeFacts([], [mockFact1])).toHaveLength(1);
    });

    it("should trim and deduplicate statements", () => {
      const existing = [{ ...mockFact1, statement: "  Some statement  " }];
      const newFact = [{ ...mockFact2, statement: "Some statement" }];

      const merged = service.mergeFacts(existing, newFact);

      expect(merged).toHaveLength(1);
    });

    it("should preserve all facts when under maxFactsCount", () => {
      const existing = [mockFact1];
      const newFacts = [mockFact2];

      const merged = service.mergeFacts(existing, newFacts, {
        maxFactsCount: 100,
      });

      expect(merged).toHaveLength(2);
    });

    it("should trim to maxFactsCount when exceeded", () => {
      const manyFacts = Array.from({ length: 5 }, (_, i) => ({
        ...mockFact1,
        id: `fact-${i}`,
        statement: `Fact statement ${i}`,
        importance: "low" as const,
      }));

      const merged = service.mergeFacts([], manyFacts, { maxFactsCount: 3 });

      expect(merged.length).toBeLessThanOrEqual(3);
    });

    it("should prioritize high importance facts over low", () => {
      const lowFacts = Array.from({ length: 5 }, (_, i) => ({
        ...mockFact1,
        id: `low-fact-${i}`,
        statement: `Low importance fact ${i}`,
        importance: "low" as const,
        establishedAt: "2025-01-01T00:00:00.000Z",
      }));

      const highFact = {
        ...mockFact1,
        id: "high-fact",
        statement: "High importance fact",
        importance: "high" as const,
        establishedAt: "2025-01-05T00:00:00.000Z",
      };

      const merged = service.mergeFacts(lowFacts, [highFact], {
        maxFactsCount: 4,
      });

      // High importance fact should be in result
      expect(merged.some((f) => f.importance === "high")).toBe(true);
    });
  });

  // ==================== buildFactsPromptSection ====================

  describe("buildFactsPromptSection", () => {
    it("should return empty string for empty facts array", () => {
      const section = service.buildFactsPromptSection([]);
      expect(section).toBe("");
    });

    it("should return empty string for null/undefined facts", () => {
      const section = service.buildFactsPromptSection(null as any);
      expect(section).toBe("");
    });

    it("should include fact statements in the section", () => {
      const facts = [mockFact1, mockFact2];
      const section = service.buildFactsPromptSection(facts);

      expect(section).toContain("林清瑶是一个不能说话的宫女");
      expect(section).toContain("萧景辰是太子");
    });

    it("should show high importance facts but not low importance facts", () => {
      const highFact = { ...mockFact1, importance: "high" as const };
      const lowFact = {
        ...mockFact2,
        importance: "low" as const,
        statement: "A low importance fact",
      };

      const section = service.buildFactsPromptSection([highFact, lowFact]);

      // High facts appear in prompt
      expect(section).toContain("林清瑶");
      // Low importance facts are NOT shown in the prompt section
      expect(section).not.toContain("A low importance fact");
    });

    it("should respect maxMediumFactsDisplay config", () => {
      const manyMediumFacts = Array.from({ length: 20 }, (_, i) => ({
        ...mockFact1,
        id: `fact-${i}`,
        statement: `Medium fact ${i}: some content`,
        importance: "medium" as const,
      }));

      const section = service.buildFactsPromptSection(manyMediumFacts, {
        maxMediumFactsDisplay: 3,
      });

      // Should show limited medium facts and mention others
      const factMatches = (section.match(/Medium fact \d+:/g) || []).length;
      expect(factMatches).toBeLessThanOrEqual(3);
    });
  });
});
