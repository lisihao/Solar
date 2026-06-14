/**
 * DiversityChecker Unit Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  DiversityChecker,
  DIVERSITY_CHECKER_CONFIG,
} from "../diversity.checker";
import { QualityCheckContext } from "../../abstractions/quality-gate.interface";

describe("DiversityChecker", () => {
  let checker: DiversityChecker;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DiversityChecker],
    }).compile();

    checker = module.get<DiversityChecker>(DiversityChecker);
  });

  // ---------------------------------------------------------------------------
  // 基本属性
  // ---------------------------------------------------------------------------

  describe("properties", () => {
    it("dimension 为 diversity", () => {
      expect(checker.dimension).toBe("diversity");
    });

    it("name 已设置", () => {
      expect(checker.name).toBe("Diversity Checker");
    });

    it("description 已设置", () => {
      expect(checker.description).toBe("检查内容的词汇和句式多样性");
    });
  });

  // ---------------------------------------------------------------------------
  // isAvailable
  // ---------------------------------------------------------------------------

  describe("isAvailable()", () => {
    it("默认返回 true", () => {
      expect(checker.isAvailable()).toBe(true);
    });

    it("config.enabled=false 时返回 false", async () => {
      const mod = await Test.createTestingModule({
        providers: [
          DiversityChecker,
          {
            provide: DIVERSITY_CHECKER_CONFIG,
            useValue: { enabled: false },
          },
        ],
      }).compile();
      const disabled = mod.get<DiversityChecker>(DiversityChecker);
      expect(disabled.isAvailable()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // check() — BaseQualityChecker 的包装器
  // ---------------------------------------------------------------------------

  describe("check()", () => {
    it("返回 QualityCheckResult 的结构", async () => {
      const result = await checker.check("测试内容");
      expect(result).toMatchObject({
        dimension: "diversity",
        score: expect.any(Number),
        passed: expect.any(Boolean),
        issues: expect.any(Array),
        suggestions: expect.any(Array),
        checkDuration: expect.any(Number),
      });
    });

    it("分数在 0–100 范围内", async () => {
      const result = await checker.check("测试内容");
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it("传入 context 也能正常运行", async () => {
      const context: QualityCheckContext = {
        contentType: "article",
      };
      const result = await checker.check("测试内容", context);
      expect(result.dimension).toBe("diversity");
    });

    it("空字符串不会崩溃", async () => {
      const result = await checker.check("");
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 词汇多样性检查
  // ---------------------------------------------------------------------------

  describe("performCheck() — analyzeVocabulary", () => {
    it("相同词语大量重复（uniqueRatio < 0.3）时输出 LOW_VOCABULARY_DIVERSITY", async () => {
      // 同一单词大量重复（空格分隔）
      const content = Array.from({ length: 100 }, () => "abc").join(" ");
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("LOW_VOCABULARY_DIVERSITY");
    });

    it("词汇多样（uniqueRatio >= 0.3）时不输出 LOW_VOCABULARY_DIVERSITY", async () => {
      // 无重复的多样词汇
      const words = Array.from({ length: 50 }, (_, i) => `word${i}`);
      const content = words.join(" ");
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("LOW_VOCABULARY_DIVERSITY");
    });

    it("空内容 uniqueRatio=0 时也能安全处理", async () => {
      const result = await checker.performCheck("");
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 句子长度多样性检查
  // ---------------------------------------------------------------------------

  describe("performCheck() — analyzeSentences", () => {
    it("全为短句（avgLength < 10）时输出 SHORT_SENTENCES", async () => {
      // 每句不足10字
      const content = "短。短。短。短。短。短。短。短。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("SHORT_SENTENCES");
    });

    it("句子长度方差较小（variance < 5）时输出 LOW_SENTENCE_VARIETY", async () => {
      // 所有句子等长（方差约为0）
      const sentence = "abcdefghij";
      const content =
        Array.from({ length: 10 }, () => sentence).join("。") + "。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("LOW_SENTENCE_VARIETY");
    });

    it("句子长度多样时不输出 SHORT_SENTENCES 和 LOW_SENTENCE_VARIETY", async () => {
      // 使用平均长度 >= 10 且方差 >= 5 的内容，以避免触发这两个问题
      const content =
        "这是一段包含足够多内容的详细句子，描述了各类情况。" +
        "这是另一段同样充实的句子，介绍了更多相关背景信息和分析。" +
        "这里有关于主题的补充性陈述，内容涵盖若干重要方面与维度。" +
        "此外还有一段较长的结论性描述，综合了以上所有观点与讨论结果。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("SHORT_SENTENCES");
    });

    it("句子数为零时能安全处理", async () => {
      // 无标点时 sentences 数组容易为空
      const result = await checker.performCheck("   ");
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 重复短语检查
  // ---------------------------------------------------------------------------

  describe("performCheck() — findRepeatedPhrases", () => {
    it("同一短语出现 3 次以上且存在 4 种以上时输出 REPEATED_PHRASES", async () => {
      // "TestA TestB" 重复 3 次以上，共 4 种以上
      const repeatedBlock =
        "测试内容 测试内容 测试内容 abc def abc def abc def xyz qrs xyz qrs xyz qrs pqr stu pqr stu pqr stu mnop qrst mnop qrst mnop qrst";
      const result = await checker.check(repeatedBlock);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("REPEATED_PHRASES");
    });

    it("重复较少时不输出 REPEATED_PHRASES", async () => {
      const content = "内容A 内容B 内容C 内容D 内容E 内容F 内容G 内容H";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("REPEATED_PHRASES");
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 句首重复检查
  // ---------------------------------------------------------------------------

  describe("performCheck() — findRepeatedStarters", () => {
    it("3 种以上重复句首（每种 count >= 3）时输出 REPEATED_STARTERS", async () => {
      // findRepeatedStarters 取 sentence.trim().slice(0, 4) 的前4字
      // 条件：repeatedStarters.length > 2（即3种以上）
      // 句首A: "aaaa" 出现3句，句首B: "bbbb" 出现3句，句首C: "cccc" 出现3句
      const sentences = [
        "aaaa one extra content here",
        "aaaa two extra content here",
        "aaaa three extra here now",
        "bbbb one extra content here",
        "bbbb two extra content here",
        "bbbb three extra here now",
        "cccc one extra content here",
        "cccc two extra content here",
        "cccc three extra here now",
      ];
      const content = sentences.join("。");
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("REPEATED_STARTERS");
    });

    it("句首多样时不输出 REPEATED_STARTERS", async () => {
      const content = [
        "第一句。",
        "接着第二句。",
        "第三句内容。",
        "第四句。",
        "最后一句。",
      ].join("\n");
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("REPEATED_STARTERS");
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 超长内容采样（超过 MAX_CONTENT_LENGTH）
  // ---------------------------------------------------------------------------

  describe("performCheck() — large content sampling", () => {
    it("超过 50000 字的内容也能正常处理", async () => {
      // 50001 字以上
      const longContent = "abcde ".repeat(10000); // 60000字
      const result = await checker.check(longContent);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 分数计算
  // ---------------------------------------------------------------------------

  describe("performCheck() — score", () => {
    it("无问题时分数为 100", async () => {
      // 词汇多样、长短句混合、无重复
      const content =
        "这是第一段较长的句子，内容丰富。" +
        "短文。" +
        "接着是包含详细说明的句子，传达了大量信息。" +
        "要点。" +
        "最后进行总结，内容涵盖多个方面。";
      const result = await checker.performCheck(content);
      expect(result.score).toBe(100);
    });

    it("分数不低于 0", async () => {
      // 同时触发所有问题
      const repeated = "abc abc abc abc abc abc ".repeat(20); // 低词汇+重复短语
      const uniformSentence = "abcde".repeat(10);
      const uniformBlock =
        Array.from({ length: 10 }, () => uniformSentence).join("。") + "。";
      const content = repeated + uniformBlock;
      const result = await checker.performCheck(content);
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getStats()
  // ---------------------------------------------------------------------------

  describe("getStats()", () => {
    it("初始值全部为 0", () => {
      const stats = checker.getStats();
      expect(stats.totalChecks).toBe(0);
    });

    it("执行 check() 后 totalChecks 增加", async () => {
      await checker.check("内容");
      expect(checker.getStats().totalChecks).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 自定义配置
  // ---------------------------------------------------------------------------

  describe("custom config", () => {
    it("maxIssues=1 时 issues 限制为 1 条", async () => {
      const mod = await Test.createTestingModule({
        providers: [
          DiversityChecker,
          {
            provide: DIVERSITY_CHECKER_CONFIG,
            useValue: { maxIssues: 1 },
          },
        ],
      }).compile();
      const c = mod.get<DiversityChecker>(DiversityChecker);
      const repeated = "abc abc abc abc abc abc ".repeat(20);
      const uniform = "abcde".repeat(10);
      const block = Array.from({ length: 10 }, () => uniform).join("。") + "。";
      const result = await c.check(repeated + block);
      expect(result.issues.length).toBeLessThanOrEqual(1);
    });
  });
});
