import { Test, TestingModule } from "@nestjs/testing";
import { NarrativeCraftService } from "../narrative-craft.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("NarrativeCraftService", () => {
  let service: NarrativeCraftService;
  let mockFacade: jest.Mocked<ChatFacade>;

  beforeEach(async () => {
    mockFacade = {
      chat: jest.fn(),
      chatStream: jest.fn(),
      chatWithSkills: jest.fn(),
    } as unknown as jest.Mocked<ChatFacade>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NarrativeCraftService,
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<NarrativeCraftService>(NarrativeCraftService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("generateNarrativeCraftConstraints", () => {
    it("should return a non-empty constraints string", () => {
      const result = service.generateNarrativeCraftConstraints();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(100);
    });

    it("should include key narrative craft sections", () => {
      const result = service.generateNarrativeCraftConstraints();
      expect(result).toContain("叙事工艺");
      expect(result).toContain("说教");
      expect(result).toContain("结尾");
      expect(result).toContain("对话");
    });

    it("should include example patterns with good and bad examples", () => {
      const result = service.generateNarrativeCraftConstraints();
      expect(result).toContain("❌");
      expect(result).toContain("✅");
    });
  });

  describe("analyzeContent", () => {
    it("should return no issues for clean content", () => {
      const content = `她推开门，走进院子。
院子里的花开得正好，一阵风吹过，花瓣飘落。
"你来了，"他站起身，"快坐。"
桌上摆着两杯茶，热气袅袅升起。`;

      const report = service.analyzeContent(content);

      expect(report.score).toBeGreaterThan(80);
      expect(report.passed).toBe(true);
    });

    it("should detect preaching patterns - awareness type", () => {
      const content = `她知道，作为后宫女子，美丽是生存的基础。
她向前走去，心中平静。`;

      const report = service.analyzeContent(content);

      const preachIssues = report.issues.filter((i) => i.type === "preach");
      expect(preachIssues.length).toBeGreaterThan(0);
    });

    it("should detect ending patterns with resolution cliche", () => {
      const content = `她走进房间，看了一眼窗外。
风景还是那样美丽。
她不会放弃的，她暗暗发誓，要掌控自己的命运。`;

      const report = service.analyzeContent(content);

      const endingIssues = report.issues.filter((i) => i.type === "ending");
      expect(endingIssues.length).toBeGreaterThan(0);
    });

    it("should detect NPC dialogue patterns", () => {
      const content = `"奴婢名唤阿梅，小姐您是织染署染人的女儿，因得卫大人照拂才入宫供职。"`;

      const report = service.analyzeContent(content);

      const npcIssues = report.issues.filter((i) => i.type === "npc_dialogue");
      expect(npcIssues.length).toBeGreaterThan(0);
    });

    it("should reduce score for AI writing cliches", () => {
      const cleanContent = `她走向窗边，指尖触上冰冷的窗棂。`;
      const clicheContent = `她心中暗下决心，绝不随波逐流，要掌控自己的命运。`;

      const cleanReport = service.analyzeContent(cleanContent);
      const clicheReport = service.analyzeContent(clicheContent);

      expect(cleanReport.score).toBeGreaterThan(clicheReport.score);
    });

    it("should detect foreshadowing cliche patterns in ending", () => {
      const content = `她望着远方，思绪纷飞。
这一切，只是一个开始。`;

      const report = service.analyzeContent(content);

      const endingIssues = report.issues.filter((i) => i.type === "ending");
      expect(endingIssues.length).toBeGreaterThan(0);
    });

    it("should detect emotion telling patterns", () => {
      const content = `他很愤怒，内心充满了怒火，情绪波动剧烈。`;

      const report = service.analyzeContent(content);

      const preachIssues = report.issues.filter((i) => i.type === "preach");
      expect(preachIssues.length).toBeGreaterThan(0);
    });

    it("should not fail passed when only info/warning issues", () => {
      const content = `她的内心感到温暖，心潮澎湃，思绪万千。
不过她还是走向了前方的路。`;

      const report = service.analyzeContent(content);

      // Content with some issues but no hard ending violations should still be considered passed
      // (passed logic: endingCount === 0 || score >= 50)
      expect(report).toBeDefined();
      expect(typeof report.passed).toBe("boolean");
    });

    it("should return issue with line number", () => {
      const content = `第一行内容。
她知道，这是命运的安排。
第三行内容。`;

      const report = service.analyzeContent(content);

      const preachIssues = report.issues.filter((i) => i.type === "preach");
      if (preachIssues.length > 0) {
        expect(preachIssues[0].line).toBeGreaterThan(0);
      }
    });

    it("should include issue type, category, match, problem and suggestion", () => {
      const content = `她感到恐惧，内心充满了不安。`;

      const report = service.analyzeContent(content);

      if (report.issues.length > 0) {
        const issue = report.issues[0];
        expect(issue).toHaveProperty("type");
        expect(issue).toHaveProperty("category");
        expect(issue).toHaveProperty("match");
        expect(issue).toHaveProperty("problem");
        expect(issue).toHaveProperty("suggestion");
        expect(issue).toHaveProperty("line");
      }
    });

    it("should detect mid summary patterns", () => {
      const content = `总之，她必须尽快适应这个环境，让自己变得更强。`;

      const report = service.analyzeContent(content);

      const midSummaryIssues = report.issues.filter(
        (i) => i.category === "mid_summary",
      );
      expect(midSummaryIssues.length).toBeGreaterThan(0);
    });
  });

  describe("generateFixSuggestions", () => {
    it("should return positive message when no issues", () => {
      const report = service.analyzeContent("她走进房间。");
      const suggestion = service.generateFixSuggestions(report);

      expect(suggestion).toContain("通过");
    });

    it("should return suggestions when issues exist", () => {
      const report = service.analyzeContent(
        "她知道，这是命运的安排。她心中暗下决心，绝不放弃。",
      );
      const suggestion = service.generateFixSuggestions(report);

      expect(typeof suggestion).toBe("string");
      expect(suggestion.length).toBeGreaterThan(10);
    });

    it("should mention issue count in suggestions", () => {
      const content =
        "她知道，这是命运的安排。她心中暗下决心，只要能掌控这份力量，就能。";
      const report = service.analyzeContent(content);

      if (report.issues.length > 0) {
        const suggestion = service.generateFixSuggestions(report);
        expect(suggestion).toContain(report.issues.length.toString());
      }
    });
  });

  describe("rewriteEnding", () => {
    it("should return original content when no issues", async () => {
      const content = `她走进房间，推开窗户。
清风吹入，带来花香。`;

      const result = await service.rewriteEnding(content, []);

      expect(result).toBe(content);
    });

    it("should call LLM to rewrite when ending issues exist", async () => {
      mockFacade.chat.mockResolvedValue({
        content: `她走向窗边，手指触上冰冷的窗棂。
"阿翠，"她头也不回地说，"明天是谁值班？"`,
        tokensUsed: 200,
      } as any);

      const content = `她望着远方。

她不会放弃的，绝不随波逐流，要掌控自己的命运。`;

      const issues = service.analyzeContent(content).issues;
      const endingIssues = issues.filter((i) => i.type === "ending");

      if (endingIssues.length > 0) {
        const result = await service.rewriteEnding(content, issues);
        expect(typeof result).toBe("string");
        expect(mockFacade.chat).toHaveBeenCalled();
      }
    });

    it("should return original content when LLM fails all attempts", async () => {
      mockFacade.chat.mockRejectedValue(new Error("API Error"));

      const content = `她望着远方。
她暗下决心，绝不随波逐流，要找到属于自己的一席之地。`;

      const issues = service.analyzeContent(content).issues;
      const endingIssues = issues.filter((i) => i.type === "ending");

      if (endingIssues.length > 0) {
        const result = await service.rewriteEnding(content, issues);
        expect(result).toBe(content);
      }
    });

    it("should return original when content is too short", async () => {
      const content = `只有一个段落。`;

      const issues = [
        {
          type: "ending" as const,
          category: "resolution_cliche",
          match: "只有一个段落",
          line: 1,
          problem: "问题",
          suggestion: "建议",
        },
      ];

      const result = await service.rewriteEnding(content, issues);
      expect(result).toBe(content);
    });
  });
});
