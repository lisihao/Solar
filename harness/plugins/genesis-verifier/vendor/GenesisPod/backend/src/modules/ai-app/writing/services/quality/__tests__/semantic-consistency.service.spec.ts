import { Test, TestingModule } from "@nestjs/testing";
import {
  SemanticConsistencyService,
  SemanticFact,
} from "../semantic-consistency.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("SemanticConsistencyService", () => {
  let service: SemanticConsistencyService;
  let mockFacade: jest.Mocked<ChatFacade>;

  beforeEach(async () => {
    mockFacade = {
      chat: jest.fn(),
      chatStream: jest.fn(),
      chatWithSkills: jest.fn(),
    } as unknown as jest.Mocked<ChatFacade>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SemanticConsistencyService,
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<SemanticConsistencyService>(
      SemanticConsistencyService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const makeSemanticFact = (
    overrides: Partial<SemanticFact> = {},
  ): SemanticFact => ({
    statement: "萧炎的眼睛是黑色的",
    category: "character",
    relatedEntities: ["萧炎"],
    importance: "high",
    ...overrides,
  });

  describe("checkSemanticConsistency", () => {
    it("should return passed result with no conflicts when content is consistent", async () => {
      // LLM returns empty list - no conflicts
      mockFacade.chat.mockResolvedValue({
        content: "[]",
        tokensUsed: 100,
      } as any);

      const content =
        "萧炎走进大厅，他那双漆黑的眼睛扫过四周，心中涌起一丝警惕。";
      const facts: SemanticFact[] = [makeSemanticFact()];

      const result = await service.checkSemanticConsistency(content, facts);

      expect(result.passed).toBe(true);
      expect(result.conflicts).toHaveLength(0);
    });

    it("should detect critical conflicts and return failed result", async () => {
      // First call for extracting statements
      mockFacade.chat.mockResolvedValueOnce({
        content: "萧炎的眼睛是蓝色的",
        tokensUsed: 100,
      } as any);

      // Second call for conflict check
      mockFacade.chat.mockResolvedValueOnce({
        content: JSON.stringify([
          {
            hasConflict: true,
            conflictType: "contradiction",
            conflictingFactIndex: 0,
            description: "眼睛颜色矛盾：已记录为黑色，但内容中描述为蓝色",
            suggestion: "修改为黑色",
            severity: "critical",
          },
        ]),
        tokensUsed: 150,
      } as any);

      // Third call for extracting new facts
      mockFacade.chat.mockResolvedValueOnce({
        content: "[]",
        tokensUsed: 50,
      } as any);

      const content = "萧炎抬起头，那双蓝色的眼睛中带着疑惑。";
      const facts: SemanticFact[] = [makeSemanticFact()];

      const result = await service.checkSemanticConsistency(content, facts);

      expect(result.passed).toBe(false);
      expect(result.conflicts.length).toBeGreaterThan(0);
    });

    it("should pass result when only warning or info conflicts exist", async () => {
      // Extract statements
      mockFacade.chat.mockResolvedValueOnce({
        content: "萧炎走路速度较慢",
        tokensUsed: 100,
      } as any);

      // Check conflict - only warning
      mockFacade.chat.mockResolvedValueOnce({
        content: JSON.stringify([
          {
            hasConflict: true,
            conflictType: "inconsistency",
            conflictingFactIndex: 0,
            description: "轻微不一致",
            suggestion: "可以接受",
            severity: "warning",
          },
        ]),
        tokensUsed: 100,
      } as any);

      // Extract new facts
      mockFacade.chat.mockResolvedValueOnce({
        content: "[]",
        tokensUsed: 50,
      } as any);

      const content = "萧炎慢慢走过走廊。";
      const facts: SemanticFact[] = [
        makeSemanticFact({ statement: "萧炎走路速度很快" }),
      ];

      const result = await service.checkSemanticConsistency(content, facts);

      // Only critical conflicts cause failure
      expect(result.passed).toBe(true);
    });

    it("should extract new facts from content", async () => {
      // Extract statements - returns a statement about getting the skill
      mockFacade.chat.mockResolvedValueOnce({
        content: "萧炎获得了火焰之心功法",
        tokensUsed: 100,
      } as any);

      // No conflict check since allFacts is empty (no established or character facts)
      // So next call is directly extractNewFacts
      const newFact: SemanticFact = {
        statement: "萧炎获得了火焰之心功法",
        category: "ability",
        relatedEntities: ["萧炎", "火焰之心"],
        importance: "high",
      };
      mockFacade.chat.mockResolvedValueOnce({
        content: JSON.stringify([newFact]),
        tokensUsed: 100,
      } as any);

      const content = "萧炎习得了传说中的火焰之心功法，内力大涨。";
      // Pass empty facts so no conflict check LLM call is made
      const result = await service.checkSemanticConsistency(content, []);

      expect(result.extractedFacts.length).toBeGreaterThan(0);
      expect(result.extractedFacts[0].statement).toBe("萧炎获得了火焰之心功法");
    });

    it("should return safe default when LLM calls fail", async () => {
      // Use mockResolvedValueOnce with rejection to avoid retry delays
      // The extractStatements call fails - service catches and returns []
      // Then extractNewFacts also fails - service catches and returns []
      // Overall checkSemanticConsistency catches top-level error and returns safe default
      mockFacade.chat.mockRejectedValue(new Error("API Error"));

      const content = "萧炎走过花园。";
      const result = await service.checkSemanticConsistency(content, []);

      // On error, service does not block
      expect(result.passed).toBe(true);
      expect(result.conflicts).toHaveLength(0);
      expect(result.extractedFacts).toHaveLength(0);
    }, 30000);

    it("should include processingTimeMs in result", async () => {
      mockFacade.chat.mockResolvedValue({
        content: "[]",
        tokensUsed: 50,
      } as any);

      const result = await service.checkSemanticConsistency("短内容。", []);

      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should combine established facts and character facts", async () => {
      mockFacade.chat.mockResolvedValue({
        content: "[]",
        tokensUsed: 50,
      } as any);

      const establishedFacts: SemanticFact[] = [
        makeSemanticFact({ statement: "萧炎已经突破斗者" }),
      ];
      const characterFacts: SemanticFact[] = [
        makeSemanticFact({
          statement: "萧炎的性格是坚韧的",
          category: "character",
        }),
      ];

      await service.checkSemanticConsistency(
        "萧炎继续修炼。",
        establishedFacts,
        characterFacts,
      );

      // Should call LLM (extract statements, check conflicts, extract new facts)
      expect(mockFacade.chat).toHaveBeenCalled();
    });

    it("should handle long content by splitting into chunks", async () => {
      mockFacade.chat.mockResolvedValue({
        content: "[]",
        tokensUsed: 50,
      } as any);

      // Content longer than 4000 characters
      const longContent = "这是一段很长的内容，用于测试分块处理。".repeat(300);

      const result = await service.checkSemanticConsistency(longContent, []);

      // Should still return a result
      expect(result).toBeDefined();
      // Multiple chunks would cause multiple calls
      expect(mockFacade.chat).toHaveBeenCalled();
    });

    it("should handle JSON wrapped in markdown code block", async () => {
      mockFacade.chat.mockResolvedValueOnce({
        content: "相关陈述",
        tokensUsed: 50,
      } as any);

      mockFacade.chat.mockResolvedValueOnce({
        content: "```json\n[]\n```",
        tokensUsed: 50,
      } as any);

      mockFacade.chat.mockResolvedValueOnce({
        content: "[]",
        tokensUsed: 50,
      } as any);

      const result = await service.checkSemanticConsistency("测试内容。", [
        makeSemanticFact(),
      ]);

      expect(result).toBeDefined();
    });

    it("should return no conflicts when allFacts is empty", async () => {
      // With empty facts: extractStatements -> extractNewFacts (no conflict check)
      mockFacade.chat
        .mockResolvedValueOnce({
          content: "陈述1\n陈述2",
          tokensUsed: 50,
        } as any)
        .mockResolvedValueOnce({ content: "[]", tokensUsed: 50 } as any);

      const result = await service.checkSemanticConsistency("内容", []);

      expect(result.conflicts).toHaveLength(0);
      expect(result.passed).toBe(true);
    });
  });
});
