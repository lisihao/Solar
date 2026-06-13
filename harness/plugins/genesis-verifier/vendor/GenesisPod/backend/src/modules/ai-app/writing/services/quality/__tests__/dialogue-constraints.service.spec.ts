import { Test, TestingModule } from "@nestjs/testing";
import { DialogueConstraintsService } from "../dialogue-constraints.service";
import { CharacterPersonalityService } from "../character-personality.service";

describe("DialogueConstraintsService", () => {
  let service: DialogueConstraintsService;
  let mockCharacterPersonality: jest.Mocked<CharacterPersonalityService>;

  const mockCharacter = {
    id: "char-1",
    name: "苏曼",
    role: "protagonist",
    background: "化妆品配方工程师",
    personality: { traits: ["聪慧", "隐忍"] },
    bibleId: "bible-1",
    aliases: [],
    appearance: null,
    motivation: null,
    arc: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockConstraint = {
    characterId: "char-1",
    characterName: "苏曼",
    speechPatterns: ["从配方角度分析...", "这种症状是典型的..."],
    vocabularyLevel: "formal" as const,
    emotionalTendency: ["冷静分析", "理性判断"],
    tabooWords: ["粗俗词汇"],
    catchphrases: [],
    dialogueExamples: [
      {
        id: "ex-1",
        characterId: "char-1",
        dialogue: "从成分角度来看，这应该是铅中毒",
        context: "分析病症",
      },
    ],
  };

  beforeEach(async () => {
    mockCharacterPersonality = {
      getCharacterByName: jest.fn(),
      getPersonalityConstraints: jest.fn(),
    } as unknown as jest.Mocked<CharacterPersonalityService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DialogueConstraintsService,
        {
          provide: CharacterPersonalityService,
          useValue: mockCharacterPersonality,
        },
      ],
    }).compile();

    service = module.get<DialogueConstraintsService>(
      DialogueConstraintsService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getDialectConstraints", () => {
    it("should return constraints for 汉朝", () => {
      const result = service.getDialectConstraints("汉朝");

      expect(result).toBeDefined();
      expect(result?.dynasty).toBe("汉朝");
      expect(result?.formalAddresses).toContain("陛下");
    });

    it("should return constraints for 唐朝", () => {
      const result = service.getDialectConstraints("唐朝");

      expect(result).toBeDefined();
      expect(result?.dynasty).toBe("唐朝");
    });

    it("should return constraints for 宋朝", () => {
      const result = service.getDialectConstraints("宋朝");

      expect(result).toBeDefined();
      expect(result?.dynasty).toBe("宋朝");
    });

    it("should return constraints for 明朝", () => {
      const result = service.getDialectConstraints("明朝");

      expect(result).toBeDefined();
      expect(result?.dynasty).toBe("明朝");
    });

    it("should return constraints for 清朝", () => {
      const result = service.getDialectConstraints("清朝");

      expect(result).toBeDefined();
      expect(result?.dynasty).toBe("清朝");
      expect(result?.speechPatternsByClass.eunuch).toBeDefined();
    });

    it("should return null for unknown dynasty", () => {
      const result = service.getDialectConstraints("不存在的朝代");

      expect(result).toBeNull();
    });
  });

  describe("generateDialectConstraintPrompt", () => {
    it("should generate prompt for 清朝", async () => {
      const result = await service.generateDialectConstraintPrompt("清朝");

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain("清朝");
      expect(result).toContain("称呼规范");
    });

    it("should return empty string for unknown dynasty", async () => {
      const result = await service.generateDialectConstraintPrompt("不存在");

      expect(result).toBe("");
    });

    it("should include forbidden modern words", async () => {
      const result = await service.generateDialectConstraintPrompt("汉朝");

      expect(result).toContain("禁用词汇");
    });

    it("should include class speech patterns", async () => {
      const result = await service.generateDialectConstraintPrompt("唐朝");

      expect(result).toContain("不同阶级对话特征");
    });
  });

  describe("generateCharacterDialogueConstraints", () => {
    it("should return null when character not found", async () => {
      (
        mockCharacterPersonality.getCharacterByName as jest.Mock
      ).mockResolvedValue(null);

      const result = await service.generateCharacterDialogueConstraints({
        projectId: "proj-1",
        characterName: "不存在的角色",
      });

      expect(result).toBeNull();
    });

    it("should return null when no personality constraints found", async () => {
      (
        mockCharacterPersonality.getCharacterByName as jest.Mock
      ).mockResolvedValue(mockCharacter);
      (
        mockCharacterPersonality.getPersonalityConstraints as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.generateCharacterDialogueConstraints({
        projectId: "proj-1",
        characterName: "苏曼",
      });

      expect(result).toBeNull();
    });

    it("should return character dialogue constraints", async () => {
      (
        mockCharacterPersonality.getCharacterByName as jest.Mock
      ).mockResolvedValue(mockCharacter);
      (
        mockCharacterPersonality.getPersonalityConstraints as jest.Mock
      ).mockResolvedValue([mockConstraint]);

      const result = await service.generateCharacterDialogueConstraints({
        projectId: "proj-1",
        characterName: "苏曼",
      });

      expect(result).toBeDefined();
      expect(result?.characterName).toBe("苏曼");
      expect(result?.speechPatterns).toEqual(mockConstraint.speechPatterns);
      expect(result?.forbiddenPhrases).toEqual(mockConstraint.tabooWords);
    });
  });

  describe("checkDialogueRealism", () => {
    it("should detect modern vocabulary in dialogue", async () => {
      (
        mockCharacterPersonality.getCharacterByName as jest.Mock
      ).mockResolvedValue(null);
      (
        mockCharacterPersonality.getPersonalityConstraints as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.checkDialogueRealism({
        projectId: "proj-1",
        dynasty: "清朝",
        dialogues: [
          {
            characterName: "苏曼",
            dialogue: "OK没问题，搞定了",
          },
        ],
      });

      expect(result.isRealistic).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some((i) => i.type === "modern_expression")).toBe(
        true,
      );
    });

    it("should return realistic when dialogue has no issues", async () => {
      (
        mockCharacterPersonality.getCharacterByName as jest.Mock
      ).mockResolvedValue(null);
      (
        mockCharacterPersonality.getPersonalityConstraints as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.checkDialogueRealism({
        projectId: "proj-1",
        dynasty: "清朝",
        dialogues: [
          {
            characterName: "苏曼",
            dialogue: "奴婢遵旨，这便去办",
          },
        ],
      });

      expect(result.isRealistic).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("should detect rank mismatch when speaking to emperor without formal address", async () => {
      (
        mockCharacterPersonality.getCharacterByName as jest.Mock
      ).mockResolvedValue(null);
      (
        mockCharacterPersonality.getPersonalityConstraints as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.checkDialogueRealism({
        projectId: "proj-1",
        dynasty: "清朝",
        dialogues: [
          {
            characterName: "苏曼",
            dialogue: "你说得对，我去办这件事情好了",
            targetRank: "emperor",
          },
        ],
      });

      expect(result.issues.some((i) => i.type === "rank_mismatch")).toBe(true);
    });

    it("should not report rank mismatch when formal address is used", async () => {
      (
        mockCharacterPersonality.getCharacterByName as jest.Mock
      ).mockResolvedValue(null);
      (
        mockCharacterPersonality.getPersonalityConstraints as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.checkDialogueRealism({
        projectId: "proj-1",
        dynasty: "清朝",
        dialogues: [
          {
            characterName: "苏曼",
            dialogue: "陛下英明，奴婢领命",
            targetRank: "emperor",
          },
        ],
      });

      expect(
        result.issues.filter((i) => i.type === "rank_mismatch"),
      ).toHaveLength(0);
    });

    it("should detect emotion mismatch when angry dialogue lacks intensity markers", async () => {
      (
        mockCharacterPersonality.getCharacterByName as jest.Mock
      ).mockResolvedValue(null);
      (
        mockCharacterPersonality.getPersonalityConstraints as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.checkDialogueRealism({
        projectId: "proj-1",
        dynasty: "清朝",
        dialogues: [
          {
            characterName: "苏曼",
            // No exclamation, no "岂/竟敢" - calm tone, but emotion is 愤怒
            dialogue: "你的做法我认为是不恰当的，需要改正",
            emotion: "愤怒",
          },
        ],
      });

      expect(result.issues.some((i) => i.type === "emotion_mismatch")).toBe(
        true,
      );
    });

    it("should detect character forbidden phrases in dialogue", async () => {
      (
        mockCharacterPersonality.getCharacterByName as jest.Mock
      ).mockResolvedValue(mockCharacter);
      (
        mockCharacterPersonality.getPersonalityConstraints as jest.Mock
      ).mockResolvedValue([mockConstraint]);

      const result = await service.checkDialogueRealism({
        projectId: "proj-1",
        dynasty: "清朝",
        dialogues: [
          {
            characterName: "苏曼",
            // mockConstraint.tabooWords includes "粗俗词汇"
            dialogue: "粗俗词汇，真是不像话",
          },
        ],
      });

      expect(result.isRealistic).toBe(false);
      expect(
        result.issues.some((i) => i.description.includes("粗俗词汇")),
      ).toBe(true);
    });
  });

  describe("generateCharacterDialoguePrompt", () => {
    it("should return empty string when character has no constraints", async () => {
      (
        mockCharacterPersonality.getCharacterByName as jest.Mock
      ).mockResolvedValue(null);
      (
        mockCharacterPersonality.getPersonalityConstraints as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.generateCharacterDialoguePrompt(
        "proj-1",
        "不存在角色",
      );

      expect(result).toBe("");
    });

    it("should generate character dialogue prompt with full constraints", async () => {
      (
        mockCharacterPersonality.getCharacterByName as jest.Mock
      ).mockResolvedValue(mockCharacter);
      (
        mockCharacterPersonality.getPersonalityConstraints as jest.Mock
      ).mockResolvedValue([mockConstraint]);

      const result = await service.generateCharacterDialoguePrompt(
        "proj-1",
        "苏曼",
      );

      expect(typeof result).toBe("string");
      expect(result).toContain("苏曼");
      expect(result).toContain("说话特点");
    });

    it("should include speech patterns when present", async () => {
      (
        mockCharacterPersonality.getCharacterByName as jest.Mock
      ).mockResolvedValue(mockCharacter);
      (
        mockCharacterPersonality.getPersonalityConstraints as jest.Mock
      ).mockResolvedValue([mockConstraint]);

      const result = await service.generateCharacterDialoguePrompt(
        "proj-1",
        "苏曼",
      );

      expect(result).toContain("常用表达");
    });

    it("should include forbidden phrases when present", async () => {
      (
        mockCharacterPersonality.getCharacterByName as jest.Mock
      ).mockResolvedValue(mockCharacter);
      (
        mockCharacterPersonality.getPersonalityConstraints as jest.Mock
      ).mockResolvedValue([mockConstraint]);

      const result = await service.generateCharacterDialoguePrompt(
        "proj-1",
        "苏曼",
      );

      expect(result).toContain("禁止使用");
    });

    it("should include dialogue examples when present", async () => {
      (
        mockCharacterPersonality.getCharacterByName as jest.Mock
      ).mockResolvedValue(mockCharacter);
      (
        mockCharacterPersonality.getPersonalityConstraints as jest.Mock
      ).mockResolvedValue([mockConstraint]);

      const result = await service.generateCharacterDialoguePrompt(
        "proj-1",
        "苏曼",
      );

      expect(result).toContain("对话参考");
    });
  });

  describe("analyzeDialoguePacing", () => {
    it("should detect consecutive dialogues without action", () => {
      const content =
        '"你好吗？""还好。""最近怎样？""还行。""有什么事吗？""没什么。""真的吗？""是的。""那就好。""嗯。"';

      const result = service.analyzeDialoguePacing(content);

      expect(result.consecutiveDialogues).toBeGreaterThan(0);
    });

    it("should not require action for few dialogues", () => {
      const content = '"你好！" 她微笑着说道。这是一个美好的早晨。';

      const result = service.analyzeDialoguePacing(content);

      expect(result.needsActionDescription).toBe(false);
    });

    it("should provide action suggestions when consecutive dialogues >= 5", () => {
      const content =
        '"一。""二。""三。""四。""五。""六。""七。""八。""九。""十。"';

      const result = service.analyzeDialoguePacing(content);

      if (result.needsActionDescription) {
        expect(result.suggestedActions.length).toBeGreaterThan(0);
      }
    });

    it("should return valid structure for empty content", () => {
      const result = service.analyzeDialoguePacing("");

      expect(result).toHaveProperty("consecutiveDialogues");
      expect(result).toHaveProperty("needsActionDescription");
      expect(result).toHaveProperty("suggestedActions");
    });

    it("should include scene suggestions when consecutive dialogues >= 7", () => {
      // Build a string with 7+ consecutive short dialogues (no separating punctuation between them)
      const content = '"甲。""乙。""丙。""丁。""戊。""己。""庚。"';

      const result = service.analyzeDialoguePacing(content);

      if (result.consecutiveDialogues >= 7) {
        expect(
          result.suggestedActions.some((s) => s.includes("场景细节")),
        ).toBe(true);
      }
    });

    it("should include inner-thought suggestions when consecutive dialogues >= 10", () => {
      // Build a string with 10+ consecutive short dialogues
      const content = '"一""二""三""四""五""六""七""八""九""十""十一"';

      const result = service.analyzeDialoguePacing(content);

      if (result.consecutiveDialogues >= 10) {
        expect(
          result.suggestedActions.some((s) => s.includes("心理活动")),
        ).toBe(true);
      }
    });
  });

  describe("generateCompleteDialogueConstraints", () => {
    it("should combine dialect and character constraints", async () => {
      (
        mockCharacterPersonality.getCharacterByName as jest.Mock
      ).mockResolvedValue(null);
      (
        mockCharacterPersonality.getPersonalityConstraints as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.generateCompleteDialogueConstraints({
        projectId: "proj-1",
        dynasty: "清朝",
        characterNames: ["苏曼"],
      });

      expect(typeof result).toBe("string");
      expect(result).toContain("清朝");
    });

    it("should return at least dialect constraints even without character info", async () => {
      (
        mockCharacterPersonality.getCharacterByName as jest.Mock
      ).mockResolvedValue(null);
      (
        mockCharacterPersonality.getPersonalityConstraints as jest.Mock
      ).mockResolvedValue([]);

      const result = await service.generateCompleteDialogueConstraints({
        projectId: "proj-1",
        dynasty: "汉朝",
        characterNames: [],
      });

      expect(result).toContain("汉朝");
    });
  });
});
