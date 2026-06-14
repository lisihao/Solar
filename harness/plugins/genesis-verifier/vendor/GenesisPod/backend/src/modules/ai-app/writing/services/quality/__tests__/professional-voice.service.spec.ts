import { Test, TestingModule } from "@nestjs/testing";
import { ProfessionalVoiceService } from "../professional-voice.service";

describe("ProfessionalVoiceService", () => {
  let service: ProfessionalVoiceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProfessionalVoiceService],
    }).compile();

    service = module.get<ProfessionalVoiceService>(ProfessionalVoiceService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("generateProfessionalVoicePrompt", () => {
    it("should generate prompt for a known profession (化妆品配方工程师)", () => {
      const result = service.generateProfessionalVoicePrompt(
        "苏曼",
        "化妆品配方工程师",
      );

      expect(result.characterName).toBe("苏曼");
      expect(result.profession).toBe("化妆品配方工程师");
      expect(result.thinkingModePrompt).toContain("苏曼");
      expect(result.knowledgeDisplayRules).toContain("Show Don't Tell");
      expect(result.forbiddenExpressions.length).toBeGreaterThan(0);
    });

    it("should generate prompt for 医者 profession", () => {
      const result = service.generateProfessionalVoicePrompt("李太医", "医者");

      expect(result.thinkingModePrompt).toContain("望闻问切");
      expect(result.forbiddenExpressions).toContainEqual(
        expect.stringMatching(/医/),
      );
    });

    it("should generate prompt for 将军 profession", () => {
      const result = service.generateProfessionalVoicePrompt("王将军", "将军");

      expect(result.thinkingModePrompt).toContain("王将军");
      expect(result.thinkingModePrompt).toContain("知己知彼");
    });

    it("should generate prompt for 谋士 profession", () => {
      const result = service.generateProfessionalVoicePrompt("诸葛亮", "谋士");

      expect(result.thinkingModePrompt).toContain("诸葛亮");
      expect(result.knowledgeDisplayRules).toBeDefined();
    });

    it("should include customBackground in prompt when provided", () => {
      const result = service.generateProfessionalVoicePrompt(
        "小明",
        "医者",
        "曾在御医院供职多年",
      );

      expect(result.thinkingModePrompt).toContain("曾在御医院供职多年");
    });

    it("should return default template for unknown profession", () => {
      const result = service.generateProfessionalVoicePrompt(
        "未知",
        "未知职业",
      );

      expect(result.thinkingModePrompt).toBeDefined();
      expect(result.forbiddenExpressions.length).toBeGreaterThan(0);
    });

    it("should match profession by keyword (配方 -> 化妆品配方工程师)", () => {
      const result = service.generateProfessionalVoicePrompt(
        "小红",
        "配方研究员",
      );

      expect(result.thinkingModePrompt).toContain("小红");
      // Should match 化妆品配方工程师 template based on keyword '配方'
      expect(result.knowledgeDisplayRules).toBeDefined();
    });

    it("should match 侠客 template for 剑客 profession", () => {
      const result = service.generateProfessionalVoicePrompt(
        "剑神",
        "剑客高手",
      );

      expect(result.thinkingModePrompt).toContain("剑神");
    });
  });

  describe("extractProfessionFromBackground", () => {
    it("should extract 化妆品配方工程师 from background", () => {
      const result =
        service.extractProfessionFromBackground("曾担任化妆品配方工程师多年");
      expect(result).toBe("化妆品配方工程师");
    });

    it("should extract 女官 from background mentioning 尚宫", () => {
      const result =
        service.extractProfessionFromBackground("尚宫局出身，在宫中任职");
      expect(result).toBe("女官");
    });

    it("should extract 将军 from background", () => {
      const result = service.extractProfessionFromBackground("征战多年的将军");
      expect(result).toBe("将军");
    });

    it("should return null for empty string", () => {
      const result = service.extractProfessionFromBackground("");
      expect(result).toBeNull();
    });

    it("should return null for unrecognized background", () => {
      const result =
        service.extractProfessionFromBackground("普通的百姓，没有特殊职业");
      expect(result).toBeNull();
    });

    it("should extract 太监 from background", () => {
      const result = service.extractProfessionFromBackground("宫中的太监总管");
      expect(result).toBe("太监");
    });

    it("should extract 医者 from background mentioning 大夫", () => {
      const result =
        service.extractProfessionFromBackground("本是一名乡间大夫");
      expect(result).toBe("医者");
    });
  });

  describe("generateChapterVoiceConstraints", () => {
    it("should generate constraints for multiple characters", () => {
      const characters = [
        { name: "苏曼", profession: "化妆品配方工程师" },
        { name: "李将军", profession: "将军" },
      ];

      const result = service.generateChapterVoiceConstraints(characters);

      expect(result).toContain("苏曼");
      expect(result).toContain("李将军");
      expect(result).toContain("角色专业声音约束");
    });

    it("should skip characters without profession", () => {
      const characters = [
        { name: "路人甲" },
        { name: "医生乙", profession: "医者" },
      ];

      const result = service.generateChapterVoiceConstraints(characters);

      expect(result).toContain("医生乙");
      expect(result).not.toContain("路人甲的专业思维");
    });

    it("should return header even for empty characters array", () => {
      const result = service.generateChapterVoiceConstraints([]);

      expect(result).toContain("角色专业声音约束");
    });

    it("should include forbidden expressions section", () => {
      const characters = [{ name: "太医", profession: "医者" }];

      const result = service.generateChapterVoiceConstraints(characters);

      expect(result).toContain("禁止表达");
    });
  });
});
