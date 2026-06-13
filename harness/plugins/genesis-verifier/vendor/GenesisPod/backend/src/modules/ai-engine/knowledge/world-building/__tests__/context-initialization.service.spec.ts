import { Test, TestingModule } from "@nestjs/testing";
import { ContextInitializationService } from "../context-initialization.service";

describe("ContextInitializationService", () => {
  let service: ContextInitializationService;

  const mockAiCaller = jest.fn();

  const mockWorldSettingsJson = JSON.stringify({
    era: {
      period: "明朝天启年间",
      year: "天启六年",
      description: "明末政治动荡时期",
    },
    characters: [
      {
        name: "林清瑶",
        role: "女主",
        identity: "宫女",
        traits: ["聪慧", "隐忍"],
        constraints: ["不能说话"],
      },
      {
        name: "萧景辰",
        role: "男主",
        identity: "太子",
        traits: ["冷峻", "深情"],
        constraints: [],
      },
    ],
    factions: [
      {
        name: "东厂",
        description: "皇帝特务机构",
        keyMembers: ["魏忠贤"],
      },
    ],
    coreRules: ["所有内容符合明朝历史背景", "人物言行符合身份"],
    prohibitions: ["不能出现现代元素", "不能出现时代错误"],
  });

  beforeEach(async () => {
    mockAiCaller.mockReset();
    mockAiCaller.mockResolvedValue({
      content: "```json\n" + mockWorldSettingsJson + "\n```",
      tokensUsed: 200,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [ContextInitializationService],
    }).compile();

    service = module.get<ContextInitializationService>(
      ContextInitializationService,
    );
  });

  // ==================== detectContentType ====================

  describe("detectContentType", () => {
    it("should detect novel content with multiple keywords", () => {
      const result = service.detectContentType(
        "宫廷小说创作",
        "写一篇关于穿越小说的故事",
      );

      expect(result.needed).toBe(true);
      expect(result.contentType).toBe("novel");
    });

    it("should detect document content", () => {
      const result = service.detectContentType(
        "API文档规范",
        "编写接口设计手册",
      );

      expect(result.needed).toBe(true);
      expect(result.contentType).toBe("document");
    });

    it("should detect research content", () => {
      const result = service.detectContentType("市场调研报告", "行业分析研究");

      expect(result.needed).toBe(true);
      expect(result.contentType).toBe("research");
    });

    it("should return not needed for other content", () => {
      const result = service.detectContentType(
        "Email response",
        "Write a professional email",
      );

      expect(result.needed).toBe(false);
      expect(result.contentType).toBe("other");
    });

    it("should require at least 2 keyword matches for detection", () => {
      // Only 1 novel keyword
      const result = service.detectContentType("小说", "Write something");

      expect(result.needed).toBe(false);
    });

    it("should detect based on combined title and description", () => {
      const result = service.detectContentType("穿越", "创作一部古代言情故事");

      expect(result.needed).toBe(true);
      expect(result.contentType).toBe("novel");
    });

    it("should be case insensitive (lowercase check)", () => {
      const result = service.detectContentType(
        "api design",
        "write api 接口规范",
      );

      expect(result.needed).toBe(true);
      expect(result.contentType).toBe("document");
    });
  });

  // ==================== generateWorldSettings ====================

  describe("generateWorldSettings", () => {
    it("should generate world settings using aiCaller", async () => {
      const result = await service.generateWorldSettings(
        "宫廷小说",
        "写一部明朝宫廷小说",
        "novel",
        mockAiCaller,
        "gpt-4o",
      );

      expect(mockAiCaller).toHaveBeenCalledTimes(1);
      expect(result.settings).toBeDefined();
      expect(result.settings.era).toBeDefined();
      expect(result.settings.characters).toHaveLength(2);
      expect(result.settings.factions).toHaveLength(1);
      expect(result.tokensUsed).toBe(200);
    });

    it("should pass the correct model to aiCaller", async () => {
      await service.generateWorldSettings(
        "Test",
        "Description",
        "novel",
        mockAiCaller,
        "claude-3-5-sonnet-20241022",
      );

      expect(mockAiCaller).toHaveBeenCalledWith(
        "claude-3-5-sonnet-20241022",
        expect.any(Array),
        expect.any(Object),
      );
    });

    it("should pass system prompt in messages", async () => {
      await service.generateWorldSettings(
        "Novel",
        "Description",
        "novel",
        mockAiCaller,
        "gpt-4o",
      );

      const callArgs = mockAiCaller.mock.calls[0];
      const messages = callArgs[1];
      const systemMsg = messages.find((m: any) => m.role === "system");
      expect(systemMsg).toBeDefined();
      expect(systemMsg.content).toContain("世界观");
    });

    it("should include novel-specific instructions in prompt for novel type", async () => {
      await service.generateWorldSettings(
        "Novel",
        "Description",
        "novel",
        mockAiCaller,
        "gpt-4o",
      );

      const callArgs = mockAiCaller.mock.calls[0];
      const messages = callArgs[1];
      const userMsg = messages.find((m: any) => m.role === "user");
      expect(userMsg.content).toContain("小说类特别要求");
    });

    it("should include document-specific instructions for document type", async () => {
      await service.generateWorldSettings(
        "API Guide",
        "Technical documentation",
        "document",
        mockAiCaller,
        "gpt-4o",
      );

      const callArgs = mockAiCaller.mock.calls[0];
      const messages = callArgs[1];
      const userMsg = messages.find((m: any) => m.role === "user");
      expect(userMsg.content).toContain("技术文档特别要求");
    });

    it("should parse character names from JSON response", async () => {
      const result = await service.generateWorldSettings(
        "Novel",
        "Description",
        "novel",
        mockAiCaller,
        "gpt-4o",
      );

      const charNames = result.settings.characters.map((c) => c.name);
      expect(charNames).toContain("林清瑶");
      expect(charNames).toContain("萧景辰");
    });

    it("should fall back to defaults when JSON parse fails", async () => {
      mockAiCaller.mockResolvedValue({
        content: "Invalid JSON response without proper format",
        tokensUsed: 100,
      });

      const result = await service.generateWorldSettings(
        "Novel",
        "Description",
        "novel",
        mockAiCaller,
        "gpt-4o",
      );

      expect(result.settings).toBeDefined();
      expect(result.settings.era).toBeDefined();
    });
  });

  // ==================== settingsToConstraints ====================

  describe("settingsToConstraints", () => {
    const mockSettings = {
      era: {
        period: "明朝天启年间",
        year: "天启六年",
        description: "动荡时期",
      },
      characters: [
        {
          name: "林清瑶",
          role: "女主",
          identity: "宫女",
          traits: ["聪慧"],
          constraints: ["不能说话", "有胎记"],
        },
      ],
      factions: [
        {
          name: "东厂",
          description: "特务机构",
          keyMembers: ["魏忠贤"],
        },
      ],
      coreRules: ["符合历史背景"],
      prohibitions: ["不能出现现代元素"],
    };

    it("should convert era to constraint", () => {
      const constraints = service.settingsToConstraints(mockSettings);

      const eraConstraint = constraints.find((c) => c.id.includes("ERA"));
      expect(eraConstraint).toBeDefined();
      expect(eraConstraint!.rule).toContain("明朝天启年间");
      expect(eraConstraint!.severity).toBe("MUST");
    });

    it("should convert characters to constraints", () => {
      const constraints = service.settingsToConstraints(mockSettings);

      const charConstraints = constraints.filter((c) => c.id.includes("CHAR"));
      expect(charConstraints.length).toBeGreaterThan(0);
      expect(charConstraints.some((c) => c.rule.includes("林清瑶"))).toBe(true);
    });

    it("should include character special constraints", () => {
      const constraints = service.settingsToConstraints(mockSettings);

      const specialConstraints = constraints.filter((c) =>
        c.rule.includes("不能说话"),
      );
      expect(specialConstraints.length).toBeGreaterThan(0);
    });

    it("should convert factions to constraints", () => {
      const constraints = service.settingsToConstraints(mockSettings);

      const factionConstraints = constraints.filter((c) =>
        c.id.includes("FACTION"),
      );
      expect(factionConstraints.length).toBeGreaterThan(0);
      expect(factionConstraints[0].rule).toContain("东厂");
    });

    it("should include core rules as constraints", () => {
      const constraints = service.settingsToConstraints(mockSettings);

      const ruleConstraints = constraints.filter((c) => c.id.includes("RULE"));
      expect(ruleConstraints.some((c) => c.rule.includes("符合历史背景"))).toBe(
        true,
      );
    });

    it("should include prohibitions as constraints", () => {
      const constraints = service.settingsToConstraints(mockSettings);

      const prohibitConstraints = constraints.filter((c) =>
        c.id.includes("PROHIBIT"),
      );
      expect(
        prohibitConstraints.some((c) => c.rule.includes("不能出现现代元素")),
      ).toBe(true);
    });

    it("should assign unique IDs to all constraints", () => {
      const constraints = service.settingsToConstraints(mockSettings);
      const ids = constraints.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  // ==================== settingsToEntities ====================

  describe("settingsToEntities", () => {
    const mockSettings = {
      era: { period: "明朝", year: null, description: "" },
      characters: [
        {
          name: "林清瑶",
          role: "女主",
          identity: "宫女",
          traits: ["聪慧", "隐忍"],
          constraints: [],
        },
      ],
      factions: [
        {
          name: "东厂",
          description: "特务机构",
          keyMembers: ["魏忠贤", "许显纯"],
        },
      ],
      coreRules: [],
      prohibitions: [],
    };

    it("should convert characters to entities", () => {
      const entities = service.settingsToEntities(mockSettings);

      const charEntities = entities.filter((e) => e.type === "人物");
      expect(charEntities.some((e) => e.name === "林清瑶")).toBe(true);
    });

    it("should include character attributes", () => {
      const entities = service.settingsToEntities(mockSettings);

      const charEntity = entities.find((e) => e.name === "林清瑶");
      expect(charEntity?.attributes?.role).toBe("女主");
      expect(charEntity?.attributes?.identity).toBe("宫女");
    });

    it("should convert factions to entities", () => {
      const entities = service.settingsToEntities(mockSettings);

      const factionEntities = entities.filter((e) => e.type === "组织/阵营");
      expect(factionEntities.some((e) => e.name === "东厂")).toBe(true);
    });

    it("should include faction key members", () => {
      const entities = service.settingsToEntities(mockSettings);

      const factionEntity = entities.find((e) => e.name === "东厂");
      expect(factionEntity?.attributes?.keyMembers).toContain("魏忠贤");
    });
  });

  // ==================== buildWorldContext ====================

  describe("buildWorldContext", () => {
    it("should return needed=false for non-novel/doc/research content", async () => {
      const result = await service.buildWorldContext(
        "Email response",
        "Write a professional email",
        mockAiCaller,
        "gpt-4o",
      );

      expect(result.needed).toBe(false);
      expect(mockAiCaller).not.toHaveBeenCalled();
    });

    it("should generate world settings for novel content", async () => {
      const result = await service.buildWorldContext(
        "宫廷言情小说",
        "写一部穿越到明朝的女主故事",
        mockAiCaller,
        "gpt-4o",
      );

      expect(result.needed).toBe(true);
      expect(result.settings).toBeDefined();
      expect(result.hardConstraints).toBeDefined();
      expect(result.entities).toBeDefined();
      expect(result.tokensUsed).toBe(200);
    });

    it("should generate hardConstraints and entities", async () => {
      const result = await service.buildWorldContext(
        "宫廷小说创作",
        "写一部关于宫廷权谋的故事",
        mockAiCaller,
        "gpt-4o",
      );

      expect(result.hardConstraints!.length).toBeGreaterThan(0);
      expect(result.entities!.length).toBeGreaterThan(0);
    });

    it("should handle AI caller failure gracefully", async () => {
      mockAiCaller.mockRejectedValue(new Error("AI failed"));

      const result = await service.buildWorldContext(
        "宫廷小说创作",
        "写一部关于宫廷权谋的故事",
        mockAiCaller,
        "gpt-4o",
      );

      expect(result.needed).toBe(true);
      expect(result.settings).toBeUndefined();
      expect(result.tokensUsed).toBe(0);
    });
  });

  // ==================== formatWorldSettingsMessage ====================

  describe("formatWorldSettingsMessage", () => {
    const mockSettings = {
      era: {
        period: "明朝天启年间",
        year: "天启六年",
        description: "动荡时期",
      },
      characters: [
        {
          name: "林清瑶",
          role: "女主",
          identity: "宫女",
          traits: ["聪慧"],
          constraints: ["不能说话"],
        },
      ],
      factions: [
        {
          name: "东厂",
          description: "特务机构",
          keyMembers: ["魏忠贤"],
        },
      ],
      coreRules: ["符合历史背景"],
      prohibitions: ["不能出现现代元素"],
    };

    it("should format settings into readable message", () => {
      const message = service.formatWorldSettingsMessage(mockSettings);

      expect(message).toContain("世界观设定已确立");
      expect(message).toContain("明朝天启年间");
      expect(message).toContain("林清瑶");
      expect(message).toContain("东厂");
      expect(message).toContain("符合历史背景");
      expect(message).toContain("不能出现现代元素");
    });

    it("should include special character constraints", () => {
      const message = service.formatWorldSettingsMessage(mockSettings);

      expect(message).toContain("不能说话");
    });

    it("should handle settings with no factions", () => {
      const settingsNoFactions = { ...mockSettings, factions: [] };
      const message = service.formatWorldSettingsMessage(settingsNoFactions);

      expect(message).not.toContain("阵营势力");
      expect(message).toContain("世界观设定已确立");
    });

    it("should handle settings with no prohibitions", () => {
      const settingsNoProhibitions = { ...mockSettings, prohibitions: [] };
      const message = service.formatWorldSettingsMessage(
        settingsNoProhibitions,
      );

      expect(message).not.toContain("禁止事项");
    });

    it("should include year when provided", () => {
      const message = service.formatWorldSettingsMessage(mockSettings);

      expect(message).toContain("天启六年");
    });

    it("should include era description", () => {
      const message = service.formatWorldSettingsMessage(mockSettings);

      expect(message).toContain("动荡时期");
    });
  });
});
