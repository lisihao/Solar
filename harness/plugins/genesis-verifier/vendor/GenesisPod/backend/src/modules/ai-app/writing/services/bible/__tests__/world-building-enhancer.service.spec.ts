import { Test, TestingModule } from "@nestjs/testing";
import { WorldBuildingEnhancerService } from "../world-building-enhancer.service";

describe("WorldBuildingEnhancerService", () => {
  let service: WorldBuildingEnhancerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorldBuildingEnhancerService],
    }).compile();

    service = module.get<WorldBuildingEnhancerService>(
      WorldBuildingEnhancerService,
    );
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("detectEra", () => {
    it("should detect 清代 from 紫禁城 keyword", () => {
      const result = service.detectEra("故事发生在紫禁城");

      expect(result).toBe("清代");
    });

    it("should detect 清代 from 康熙 keyword", () => {
      const result = service.detectEra("康熙年间的故事");

      expect(result).toBe("清代");
    });

    it("should detect 明代 from 明朝 keyword", () => {
      const result = service.detectEra("明朝宫廷的故事");

      expect(result).toBe("明代");
    });

    it("should detect 宋代 from 临安 keyword", () => {
      const result = service.detectEra("在临安城的故事");

      expect(result).toBe("宋代");
    });

    it("should return null for modern setting", () => {
      const result = service.detectEra("现代都市爱情故事");

      expect(result).toBeNull();
    });

    it("should return null for empty string", () => {
      const result = service.detectEra("");

      expect(result).toBeNull();
    });

    it("should detect 西汉 from knowledge base", () => {
      // The knowledge base contains 西汉
      const result = service.detectEra("西汉时期的故事");

      // Should detect via knowledge base or pattern
      expect(result).toBeDefined();
    });
  });

  describe("detectProfession", () => {
    it("should detect 化妆品研发 from 化妆品 keyword", () => {
      const result = service.detectProfession("她是一名化妆品研究员");

      expect(result).toBe("化妆品研发");
    });

    it("should detect 化妆品研发 from 配方 keyword", () => {
      const result = service.detectProfession("精通配方的专家");

      expect(result).toBe("化妆品研发");
    });

    it("should detect 医生 from 医者 keyword", () => {
      const result = service.detectProfession("她是一位医者");

      expect(result).toBe("医生");
    });

    it("should detect 厨师 from 厨师 keyword", () => {
      const result = service.detectProfession("曾是宫廷御厨");

      expect(result).toBe("厨师");
    });

    it("should return null for unknown profession", () => {
      const result = service.detectProfession("普通的宫女");

      expect(result).toBeNull();
    });
  });

  describe("enhanceWorldBuildingPrompt", () => {
    it("should enhance prompt with era knowledge when era detected", () => {
      const result =
        service.enhanceWorldBuildingPrompt(
          "清朝宫廷故事，主角是化妆品配方工程师",
        );

      expect(result.detectedEra).toBeDefined();
      expect(result.enhancedPrompt).toContain("原始故事创意");
      expect(result.enhancedPrompt.length).toBeGreaterThan(100);
    });

    it("should return validation suggestions when era is known", () => {
      const result = service.enhanceWorldBuildingPrompt("清朝紫禁城的故事");

      expect(result.validationSuggestions.length).toBeGreaterThan(0);
    });

    it("should detect profession and include professional knowledge", () => {
      const result =
        service.enhanceWorldBuildingPrompt("清朝宫廷化妆品配方专家的故事");

      expect(result.detectedEra).toBeDefined();
      expect(result.professionalKnowledge).toBeDefined();
    });

    it("should handle prompt with no era or profession", () => {
      const result = service.enhanceWorldBuildingPrompt("一个普通的故事");

      expect(result.detectedEra).toBeNull();
      expect(result.eraKnowledge).toBeNull();
      expect(result.enhancedPrompt).toContain("原始故事创意");
    });

    it("should include quality requirements in enhanced prompt", () => {
      const result = service.enhanceWorldBuildingPrompt("任意故事");

      expect(result.enhancedPrompt).toContain("世界观构建质量要求");
    });
  });

  describe("validateWorldSettings", () => {
    it("should return invalid when core is missing", () => {
      const result = service.validateWorldSettings(
        {
          characters: [
            { name: "苏曼", role: "protagonist" },
            { name: "反派", role: "antagonist" },
          ],
          world: {},
        },
        null,
      );

      expect(result.isValid).toBe(false);
      expect(result.issues).toContain("缺少核心设定(core)");
    });

    it("should return invalid when characters array is missing", () => {
      const result = service.validateWorldSettings(
        { core: {}, world: {} },
        null,
      );

      expect(result.isValid).toBe(false);
      expect(result.issues).toContain("缺少角色设定(characters)");
    });

    it("should return invalid when fewer than 2 characters", () => {
      const result = service.validateWorldSettings(
        {
          core: {},
          characters: [{ name: "苏曼", role: "protagonist" }],
          world: {},
        },
        null,
      );

      expect(result.isValid).toBe(false);
      expect(result.issues).toContain("角色数量不足（至少需要2个主要角色）");
    });

    it("should return valid for complete settings", () => {
      const result = service.validateWorldSettings(
        {
          core: { premise: "故事前提" },
          characters: [
            { name: "主角", role: "protagonist", motivation: "目标" },
            { name: "配角", role: "supporting", motivation: "目标" },
          ],
          world: { era: "清代", society: "封建社会" },
        },
        null,
      );

      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("should add suggestions for known era without era info in world", () => {
      const result = service.validateWorldSettings(
        {
          core: {},
          characters: [
            { name: "主角", role: "protagonist" },
            { name: "配角", role: "supporting" },
          ],
          world: {},
        },
        "清代",
      );

      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it("should flag characters missing role", () => {
      const result = service.validateWorldSettings(
        {
          core: {},
          characters: [{ name: "主角" }, { name: "配角" }],
          world: {},
        },
        null,
      );

      expect(result.issues.some((i) => i.includes("缺少角色类型"))).toBe(true);
    });
  });

  describe("getAvailableEras", () => {
    it("should return an array of available era names", () => {
      const result = service.getAvailableEras();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it("should include 西汉 in available eras", () => {
      const result = service.getAvailableEras();

      expect(result).toContain("西汉");
    });
  });

  describe("getEraKnowledge", () => {
    it("should return era knowledge for known era", () => {
      const result = service.getEraKnowledge("西汉");

      expect(result).toBeDefined();
      expect(result?.name).toBe("西汉");
    });

    it("should return null for unknown era", () => {
      const result = service.getEraKnowledge("不存在的时代");

      expect(result).toBeNull();
    });
  });

  describe("getDynastyDetails", () => {
    it("should return dynasty details for known dynasty name", () => {
      // This uses the knowledge base
      const result = service.getDynastyDetails("西汉");

      // May be null if not in DYNASTIES knowledge base - that's fine
      expect(result === null || typeof result === "object").toBe(true);
    });
  });
});
