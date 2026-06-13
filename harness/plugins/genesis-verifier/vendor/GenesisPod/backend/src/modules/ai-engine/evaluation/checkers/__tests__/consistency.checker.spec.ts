/**
 * ConsistencyChecker Unit Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  ConsistencyChecker,
  CONSISTENCY_CHECKER_CONFIG,
} from "../consistency.checker";
import { QualityCheckContext } from "../../abstractions/quality-gate.interface";

describe("ConsistencyChecker", () => {
  let checker: ConsistencyChecker;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConsistencyChecker],
    }).compile();

    checker = module.get<ConsistencyChecker>(ConsistencyChecker);
  });

  // ---------------------------------------------------------------------------
  // 基本属性
  // ---------------------------------------------------------------------------

  describe("properties", () => {
    it("dimension 为 consistency", () => {
      expect(checker.dimension).toBe("consistency");
    });

    it("name 已设置", () => {
      expect(checker.name).toBe("Consistency Checker");
    });

    it("description 已设置", () => {
      expect(checker.description).toBe("检查内容的风格和事实一致性");
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
          ConsistencyChecker,
          {
            provide: CONSISTENCY_CHECKER_CONFIG,
            useValue: { enabled: false },
          },
        ],
      }).compile();
      const disabled = mod.get<ConsistencyChecker>(ConsistencyChecker);
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
        dimension: "consistency",
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

    it("空字符串不会崩溃", async () => {
      const result = await checker.check("");
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 人称一致性检查
  // ---------------------------------------------------------------------------

  describe("performCheck() — checkPersonConsistency", () => {
    it("第一人称与第三人称混用时输出 PERSON_INCONSISTENCY", async () => {
      // firstPerson > 3 且 thirdPerson > 3，ratio > 0.3
      const content =
        "我们认为这很重要。我们做了测试。我们发现结果。我们继续分析。" +
        "该系统性能很好。其功能完善。本设计合理。此方案可行。该结果正确。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("PERSON_INCONSISTENCY");
    });

    it("仅使用第一人称时不输出 PERSON_INCONSISTENCY", async () => {
      const content =
        "我们认为这很重要。我们做了测试。我们发现结果。我们继续分析。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("PERSON_INCONSISTENCY");
    });

    it("第一人称和第三人称数量较少（各不超过3个）时不输出 PERSON_INCONSISTENCY", async () => {
      // firstPerson <= 3 或 thirdPerson <= 3
      const content = "我们认为。该系统。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("PERSON_INCONSISTENCY");
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 时态一致性检查
  // ---------------------------------------------------------------------------

  describe("performCheck() — checkTenseConsistency", () => {
    it("过去、将来、现在时态标记各超过5个时输出 TENSE_VARIETY", async () => {
      const content =
        // 过去 (了/過/曾经/已经/之前) 6个以上
        "完成了任务。做过测试。曾经失败。已经完成。之前分析。已完成测试。" +
        // 将来 (将/将要/即将/未来/以後) 6个以上
        "将进行测试。将要完成。即将发布。未来发展。以后改进。将继续执行。" +
        // 现在 (正在/目前/现在/当前) 6个以上
        "正在运行。目前状态。现在分析。当前进度。正在执行。目前完成了。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("TENSE_VARIETY");
    });

    it("时态标记较少时不输出 TENSE_VARIETY", async () => {
      const content = "这是一个简单的描述。内容完整。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("TENSE_VARIETY");
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 术语一致性检查
  // ---------------------------------------------------------------------------

  describe("performCheck() — checkTermConsistency", () => {
    it("「人工智能」与「AI」混用时输出 TERM_INCONSISTENCY", async () => {
      const content = "人工智能技术在发展。AI的应用越来越广。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("TERM_INCONSISTENCY");
    });

    it("「机器学习」与「ML」混用时输出 TERM_INCONSISTENCY", async () => {
      const content = "机器学习算法。ML模型训练。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("TERM_INCONSISTENCY");
    });

    it("「用户」与「使用者」混用时输出 TERM_INCONSISTENCY", async () => {
      const content = "用户界面设计。使用者体验优化。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("TERM_INCONSISTENCY");
    });

    it("「数据」与「资料」混用时输出 TERM_INCONSISTENCY", async () => {
      const content = "数据分析结果。资料整理完毕。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("TERM_INCONSISTENCY");
    });

    it("「系统」与「平台」混用时输出 TERM_INCONSISTENCY", async () => {
      const content = "系统性能优化。平台功能完善。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("TERM_INCONSISTENCY");
    });

    it("无术语混用时不输出 TERM_INCONSISTENCY", async () => {
      const content = "人工智能技术在快速发展，人工智能的应用越来越广。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("TERM_INCONSISTENCY");
    });

    it("建议消息中包含使用较多的术语", async () => {
      // 「人工智能」出现2次，「AI」出现1次
      const content = "人工智能技术。人工智能应用。AI模型。";
      const result = await checker.check(content);
      const issue = result.issues.find((i) => i.code === "TERM_INCONSISTENCY");
      expect(issue?.suggestion).toContain("人工智能");
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 上下文一致性检查（previousContent）
  // ---------------------------------------------------------------------------

  describe("performCheck() — checkContextConsistency", () => {
    it("无 previousContent 时不输出 ENTITY_NAME_INCONSISTENCY", async () => {
      const result = await checker.check("内容测试");
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("ENTITY_NAME_INCONSISTENCY");
    });

    it("有 previousContent 时传入 context 会执行一致性检查", async () => {
      const context: QualityCheckContext = {
        contentType: "article",
        previousContent: '这是之前提到的"某系统"的内容。',
      };
      const result = await checker.check('这里提到了"某平台"的功能。', context);
      // 不报错也属正常（仅代表无同名实体）
      expect(result.dimension).toBe("consistency");
    });

    it("相同实体名在双方内容中各出现一次（variations=1）时无问题", async () => {
      const context: QualityCheckContext = {
        contentType: "report",
        previousContent: '"deepdive" 系统概述。',
      };
      const result = await checker.check('"deepdive" 的详细说明。', context);
      const codes = result.issues.map((i) => i.code);
      // 相同名称 variations=1，无不一致
      expect(codes).not.toContain("ENTITY_NAME_INCONSISTENCY");
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 数字格式一致性检查
  // ---------------------------------------------------------------------------

  describe("performCheck() — checkNumberFormatConsistency", () => {
    it("阿拉伯数字与汉字数字大量混用时输出 NUMBER_FORMAT_INCONSISTENCY", async () => {
      // 阿拉伯数字 6个以上 (> 5)，汉字数字 6个以上 (> 5) 两个条件都满足
      // 汉字数字模式: [一二三四五六七八九十百千万亿]+ 一次匹配为1个，
      // 需要多个独立的汉字数字 token
      const content =
        "第1回、第2章、第3節、第4項、第5号、第6回。" + // 阿拉伯数字 6个
        "一。二。三。四。五。六。七。"; // 汉字数字 7个（各独立）
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("NUMBER_FORMAT_INCONSISTENCY");
    });

    it("仅使用阿拉伯数字时不输出 NUMBER_FORMAT_INCONSISTENCY", async () => {
      const content = "第1回、第2章、第3節、第4項、第5号、第6回。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("NUMBER_FORMAT_INCONSISTENCY");
    });

    it("汉字数字不超过5个时不输出 NUMBER_FORMAT_INCONSISTENCY", async () => {
      const content = "第1回、第2章、第3節、第4項、第5号。一二三。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("NUMBER_FORMAT_INCONSISTENCY");
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 分数计算
  // ---------------------------------------------------------------------------

  describe("performCheck() — score", () => {
    it("无问题时分数为 100", async () => {
      const result = await checker.performCheck("这是一段简单的内容。");
      expect(result.score).toBe(100);
    });

    it("分数不低于 0", async () => {
      // 强制触发多个问题
      const content =
        "我们认为。该系统。其功能。本方案。此设计。我们建议。" + // person
        "完成了。做过。曾经。已经。将进行。将要。即将。未来。以后。正在。目前。现在。当前。" + // tense
        "人工智能应用。AI模型。机器学习研究。ML算法。" + // term
        "第1章第2节第3条第4项第5号第6回一二三四五六七八九十百千。"; // number
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
    it("threshold=100 时 passed=false", async () => {
      const mod = await Test.createTestingModule({
        providers: [
          ConsistencyChecker,
          {
            provide: CONSISTENCY_CHECKER_CONFIG,
            useValue: { threshold: 100 },
          },
        ],
      }).compile();
      const c = mod.get<ConsistencyChecker>(ConsistencyChecker);
      const result = await c.check("人工智能应用。AI模型。");
      expect(result.passed).toBe(false);
    });
  });
});
