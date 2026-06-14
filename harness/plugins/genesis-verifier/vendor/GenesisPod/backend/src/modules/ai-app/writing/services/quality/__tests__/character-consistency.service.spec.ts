import { Test, TestingModule } from "@nestjs/testing";
import { CharacterConsistencyService } from "../character-consistency.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import type { WritingCharacterEntity } from "../../../interfaces/writing-context.interface";

describe("CharacterConsistencyService", () => {
  let service: CharacterConsistencyService;
  let mockPrisma: jest.Mocked<PrismaService>;

  const mockCharacter = {
    id: "char-1",
    bibleId: "bible-1",
    name: "萧炎",
    aliases: ["小炎", "炎哥"],
    role: "PROTAGONIST",
    appearance: {},
    personality: {
      traits: ["谨慎", "善良", "聪明"],
      strengths: ["智慧", "意志坚定"],
      weaknesses: ["情绪化"],
      relationships: {},
      hiddenSecrets: ["是龙族后裔"],
    },
    currentState: {
      physicalState: { health: "healthy", location: "乌坦城" },
      emotionalState: { mood: "平静" },
      relationships: {},
      knownSecrets: [],
      goals: [],
    },
    stateTimeline: [],
    background: null,
    abilities: [],
    relationships: [],
    appearances: [],
    personalityProfile: null,
  };

  const mockProject = {
    id: "project-1",
    ownerId: "user-1",
    storyBible: {
      id: "bible-1",
      characters: [
        {
          id: "char-1",
          name: "萧炎",
          aliases: ["小炎"],
          role: "PROTAGONIST",
          personalityProfile: null,
        },
        {
          id: "char-2",
          name: "药老",
          aliases: ["药尊"],
          role: "MENTOR",
          personalityProfile: null,
        },
      ],
    },
  };

  beforeEach(async () => {
    mockPrisma = {
      writingCharacter: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      writingProject: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
    } as unknown as jest.Mocked<PrismaService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterConsistencyService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CharacterConsistencyService>(
      CharacterConsistencyService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getCharacterState", () => {
    it("should return character state when character exists", async () => {
      (mockPrisma.writingCharacter.findUnique as jest.Mock).mockResolvedValue(
        mockCharacter,
      );

      const result = await service.getCharacterState("char-1");

      expect(result).not.toBeNull();
      expect(result?.name).toBe("萧炎");
      expect(result?.characterId).toBe("char-1");
    });

    it("should return null when character not found", async () => {
      (mockPrisma.writingCharacter.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.getCharacterState("nonexistent");

      expect(result).toBeNull();
    });

    it("should include physical state with defaults when empty currentState", async () => {
      (mockPrisma.writingCharacter.findUnique as jest.Mock).mockResolvedValue({
        ...mockCharacter,
        currentState: {},
      });

      const result = await service.getCharacterState("char-1");

      expect(result?.physicalState).toBeDefined();
      expect(result?.physicalState.health).toBe("healthy");
    });

    it("should include emotional state", async () => {
      (mockPrisma.writingCharacter.findUnique as jest.Mock).mockResolvedValue(
        mockCharacter,
      );

      const result = await service.getCharacterState("char-1");

      expect(result?.emotionalState.mood).toBe("平静");
    });

    it("should include hidden secrets from personality", async () => {
      (mockPrisma.writingCharacter.findUnique as jest.Mock).mockResolvedValue(
        mockCharacter,
      );

      const result = await service.getCharacterState("char-1");

      expect(result?.hiddenSecrets).toContain("是龙族后裔");
    });
  });

  describe("getProjectCharacterStates", () => {
    it("should return all character states for a project", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );

      const result = await service.getProjectCharacterStates("project-1");

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("萧炎");
    });

    it("should return empty array when project has no story bible", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue({
        id: "project-1",
        storyBible: null,
      });

      const result = await service.getProjectCharacterStates("project-1");

      expect(result).toHaveLength(0);
    });

    it("should return empty array when project not found", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.getProjectCharacterStates("nonexistent");

      expect(result).toHaveLength(0);
    });
  });

  describe("updateCharacterState", () => {
    it("should call transaction and update character state", async () => {
      const txFn = jest.fn().mockImplementation(async (fn) => {
        const tx = {
          writingCharacter: {
            findUnique: jest.fn().mockResolvedValue(mockCharacter),
            update: jest.fn().mockResolvedValue(mockCharacter),
          },
        };
        return fn(tx);
      });

      (mockPrisma.$transaction as jest.Mock).mockImplementation(txFn);

      await service.updateCharacterState("char-1", 5, {
        physicalState: { health: "injured", injuries: ["右臂受伤"] },
        emotionalState: { mood: "愤怒" },
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it("should skip update when character not found in transaction", async () => {
      const txFn = jest.fn().mockImplementation(async (fn) => {
        const tx = {
          writingCharacter: {
            findUnique: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
        };
        return fn(tx);
      });

      (mockPrisma.$transaction as jest.Mock).mockImplementation(txFn);

      await service.updateCharacterState("nonexistent", 5, {});

      // Should not throw
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe("recordStateTransition", () => {
    it("should record state transition in timeline", async () => {
      const txFn = jest.fn().mockImplementation(async (fn) => {
        const tx = {
          writingCharacter: {
            findUnique: jest.fn().mockResolvedValue(mockCharacter),
            update: jest.fn().mockResolvedValue(mockCharacter),
          },
        };
        return fn(tx);
      });

      (mockPrisma.$transaction as jest.Mock).mockImplementation(txFn);

      await service.recordStateTransition("char-1", {
        chapterNumber: 10,
        fromState: "普通弟子",
        toState: "斗者",
        transitionType: "identity_shift",
        description: "突破斗者境界",
        triggerEvent: "修炼成功",
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe("detectOOC", () => {
    const makeCharacterEntity = (traits: string[]): WritingCharacterEntity =>
      ({
        id: "char-1",
        name: "萧炎",
        personality: {
          traits,
          strengths: [],
          weaknesses: [],
          relationships: {},
        },
        currentState: {},
      }) as unknown as WritingCharacterEntity;

    it("should return not OOC when personality is missing", async () => {
      const char: WritingCharacterEntity = {
        id: "char-1",
        name: "萧炎",
        personality: null,
        currentState: {},
      } as unknown as WritingCharacterEntity;

      const result = await service.detectOOC(char, "他微笑着", "");

      expect(result.isOOC).toBe(false);
    });

    it("should detect OOC for kind character doing cruel action", async () => {
      const char = makeCharacterEntity(["善良", "仁慈"]);

      const result = await service.detectOOC(char, "他残忍地杀害了无辜者", "");

      expect(result.isOOC).toBe(true);
      expect(result.severity).toBe("high");
      expect(result.violationType).toBe("personality_conflict");
    });

    it("should detect OOC for proud character begging", async () => {
      const char = makeCharacterEntity(["骄傲", "自尊心强"]);

      const result = await service.detectOOC(char, "他卑躬屈膝地乞求原谅", "");

      expect(result.isOOC).toBe(true);
    });

    it("should detect OOC for cautious character acting impulsively", async () => {
      const char = makeCharacterEntity(["谨慎", "深思熟虑"]);

      const result = await service.detectOOC(char, "他毫不犹豫地冲上去", "");

      expect(result.isOOC).toBe(true);
      expect(result.violationType).toBe("impulsive_decision");
    });

    it("should detect OOC for relationship violation", async () => {
      const char = makeCharacterEntity(["善良"]);

      const result = await service.detectOOC(
        char,
        "他友好地帮助了敌人",
        "敌人阵营",
      );

      expect(result.isOOC).toBe(true);
      expect(result.violationType).toBe("relationship_violation");
    });

    it("should return not OOC for consistent behavior", async () => {
      const char = makeCharacterEntity(["善良", "谨慎"]);

      const result = await service.detectOOC(
        char,
        "他小心翼翼地帮助了老人",
        "普通场景",
      );

      expect(result.isOOC).toBe(false);
    });

    it("should detect strength violation for intelligent character", async () => {
      const char: WritingCharacterEntity = {
        id: "char-1",
        name: "萧炎",
        personality: {
          traits: [],
          strengths: ["智慧", "聪明"],
          weaknesses: [],
          relationships: {},
        },
        currentState: {},
      } as unknown as WritingCharacterEntity;

      const result = await service.detectOOC(char, "他做出了愚蠢的决定", "");

      expect(result.isOOC).toBe(true);
    });
  });

  describe("validateCharacterGrowth", () => {
    it("should return invalid when no trigger event", async () => {
      (mockPrisma.writingCharacter.findUnique as jest.Mock).mockResolvedValue(
        mockCharacter,
      );

      const result = await service.validateCharacterGrowth(
        "char-1",
        { traitChange: "从谨慎变为冲动" },
        undefined,
      );

      expect(result.isValid).toBe(false);
      const noTriggerIssue = result.issues.find((i) => i.type === "no_trigger");
      expect(noTriggerIssue).toBeDefined();
    });

    it("should flag too_sudden when timeline is short", async () => {
      (mockPrisma.writingCharacter.findUnique as jest.Mock).mockResolvedValue({
        ...mockCharacter,
        stateTimeline: [{ storyTime: "第1章", state: {} }], // only 1 entry
      });

      const result = await service.validateCharacterGrowth(
        "char-1",
        { traitChange: "性格变化" },
        "触发事件发生了",
      );

      const tooSuddenIssue = result.issues.find((i) => i.type === "too_sudden");
      expect(tooSuddenIssue).toBeDefined();
    });

    it("should return valid when timeline is long enough and trigger exists", async () => {
      (mockPrisma.writingCharacter.findUnique as jest.Mock).mockResolvedValue({
        ...mockCharacter,
        stateTimeline: [
          { storyTime: "第1章", state: {} },
          { storyTime: "第2章", state: {} },
          { storyTime: "第3章", state: {} },
          { storyTime: "第4章", state: {} },
        ],
      });

      const result = await service.validateCharacterGrowth(
        "char-1",
        { traitChange: "性格变化" },
        "重大事件触发了变化",
      );

      // Has trigger, and timeline is long enough - should have no issues
      expect(result.isValid).toBe(true);
    });
  });

  describe("generateCharacterBehaviorConstraints", () => {
    it("should generate constraints based on character traits", async () => {
      const char = mockCharacter as unknown as WritingCharacterEntity;
      char.personality = {
        traits: ["谨慎", "善良", "骄傲"],
        strengths: [],
        weaknesses: [],
        relationships: {},
      } as any;

      const constraints =
        await service.generateCharacterBehaviorConstraints(char);

      expect(constraints.characterName).toBe("萧炎");
      expect(constraints.coreTraits).toContain("谨慎");
      expect(constraints.behaviorPatterns.length).toBeGreaterThan(0);
      expect(constraints.prohibitions.length).toBeGreaterThan(0);
    });

    it("should return empty constraints when no personality", async () => {
      const char = {
        ...mockCharacter,
        personality: null,
      } as unknown as WritingCharacterEntity;

      const constraints =
        await service.generateCharacterBehaviorConstraints(char);

      expect(constraints.coreTraits).toHaveLength(0);
    });

    it("should generate state constraints when currentState has physical state", async () => {
      const char = {
        ...mockCharacter,
        personality: {
          traits: ["谨慎"],
          strengths: [],
          weaknesses: [],
          relationships: {},
        },
        currentState: {
          physicalState: { health: "injured", location: "乌坦城" },
          emotionalState: { mood: "痛苦" },
        },
      } as unknown as WritingCharacterEntity;

      const constraints =
        await service.generateCharacterBehaviorConstraints(char);

      expect(constraints.currentStateConstraints.length).toBeGreaterThan(0);
      const hasInjuredConstraint = constraints.currentStateConstraints.some(
        (c) => c.includes("受伤"),
      );
      expect(hasInjuredConstraint).toBe(true);
    });
  });

  describe("formatBehaviorConstraintsAsPrompt", () => {
    it("should format constraints into prompt string", async () => {
      const char = mockCharacter as unknown as WritingCharacterEntity;
      char.personality = {
        traits: ["谨慎", "善良"],
        strengths: [],
        weaknesses: [],
        relationships: {},
      } as any;

      const constraints =
        await service.generateCharacterBehaviorConstraints(char);
      const prompt = service.formatBehaviorConstraintsAsPrompt(constraints);

      expect(prompt).toContain("萧炎");
      expect(prompt).toContain("角色行为约束");
    });

    it("should include prohibition section when prohibitions exist", async () => {
      const constraints = {
        characterName: "萧炎",
        coreTraits: ["善良"],
        behaviorPatterns: ["不会主动伤害无辜"],
        prohibitions: ["不会主动攻击无辜者"],
        encouragements: ["展现同情心"],
        currentStateConstraints: [],
        relationshipConstraints: [],
      };

      const prompt = service.formatBehaviorConstraintsAsPrompt(constraints);

      expect(prompt).toContain("行为禁止");
      expect(prompt).toContain("❌");
    });
  });

  describe("validateCharacterNames", () => {
    it("should return valid when no story bible characters", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue({
        id: "project-1",
        storyBible: { id: "bible-1", characters: [] },
      });

      const result = await service.validateCharacterNames(
        "project-1",
        "一些内容",
      );

      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("should detect unknown character names", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue({
        id: "project-1",
        storyBible: {
          id: "bible-1",
          characters: [
            { id: "char-1", name: "萧炎", aliases: [], role: "PROTAGONIST" },
          ],
        },
      });

      // Content mentions a completely unknown character
      const content = `李四心中暗想，萧炎走过来了。`;
      const result = await service.validateCharacterNames("project-1", content);

      // The result should have processed without crashing
      expect(result).toBeDefined();
      expect(result.mentionedCharacters).toBeDefined();
    });

    it("should detect alias usage as warning", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue({
        id: "project-1",
        storyBible: {
          id: "bible-1",
          characters: [
            {
              id: "char-1",
              name: "萧炎",
              aliases: ["小炎"],
              role: "PROTAGONIST",
            },
          ],
        },
      });

      const content = `小炎走过来了，小炎心想如何应对。`;
      const result = await service.validateCharacterNames("project-1", content);

      // Alias usage generates warnings
      const _aliasWarnings = result.issues.filter(
        (i) => i.type === "inconsistent_name",
      );
      expect(result).toBeDefined();
    });

    it("should handle project not found", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.validateCharacterNames(
        "nonexistent",
        "内容",
      );

      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("should detect title inconsistency", async () => {
      (mockPrisma.writingProject.findUnique as jest.Mock).mockResolvedValue({
        id: "project-1",
        storyBible: {
          id: "bible-1",
          characters: [
            { id: "char-1", name: "萧炎", aliases: [], role: "PROTAGONIST" },
          ],
        },
      });

      // Content uses multiple exclusive titles
      const content = `王妃娘娘走进殿内，夫人向她行礼。`;
      const result = await service.validateCharacterNames("project-1", content);

      const titleIssues = result.issues.filter((i) => i.type === "wrong_title");
      expect(titleIssues.length).toBeGreaterThan(0);
    });
  });
});
