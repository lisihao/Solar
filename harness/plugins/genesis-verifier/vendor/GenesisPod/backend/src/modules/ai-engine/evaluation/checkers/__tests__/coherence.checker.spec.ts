/**
 * CoherenceChecker Unit Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  CoherenceChecker,
  COHERENCE_CHECKER_CONFIG,
} from "../coherence.checker";
import { QualityCheckContext } from "../../abstractions/quality-gate.interface";

describe("CoherenceChecker", () => {
  let checker: CoherenceChecker;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CoherenceChecker],
    }).compile();

    checker = module.get<CoherenceChecker>(CoherenceChecker);
  });

  // ---------------------------------------------------------------------------
  // 基本属性
  // ---------------------------------------------------------------------------

  describe("properties", () => {
    it("dimension 为 coherence", () => {
      expect(checker.dimension).toBe("coherence");
    });

    it("name 已设置", () => {
      expect(checker.name).toBe("Coherence Checker");
    });

    it("description 已设置", () => {
      expect(checker.description).toBe("检查内容的逻辑连贯性和段落衔接");
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
          CoherenceChecker,
          {
            provide: COHERENCE_CHECKER_CONFIG,
            useValue: { enabled: false },
          },
        ],
      }).compile();
      const disabled = mod.get<CoherenceChecker>(CoherenceChecker);
      expect(disabled.isAvailable()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // check() — BaseQualityChecker 的包装器
  // ---------------------------------------------------------------------------

  describe("check()", () => {
    it("返回 QualityCheckResult 的结构", async () => {
      const result = await checker.check("简短内容");
      expect(result).toMatchObject({
        dimension: "coherence",
        score: expect.any(Number),
        passed: expect.any(Boolean),
        issues: expect.any(Array),
        suggestions: expect.any(Array),
        checkDuration: expect.any(Number),
      });
    });

    it("分数在 0–100 范围内", async () => {
      const result = await checker.check("简短内容");
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it("传入 context 也能正常运行", async () => {
      const context: QualityCheckContext = {
        contentType: "article",
        language: "zh",
      };
      const result = await checker.check("测试内容", context);
      expect(result.dimension).toBe("coherence");
    });

    it("空字符串不会崩溃", async () => {
      const result = await checker.check("");
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 段落结构检查
  // ---------------------------------------------------------------------------

  describe("performCheck() — checkParagraphStructure", () => {
    it("超过500字且无段落时输出 NO_PARAGRAPHS 警告", async () => {
      const longContent = "内".repeat(600); // 无段落分隔
      const result = await checker.check(longContent);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("NO_PARAGRAPHS");
    });

    it("500字以下的单段落不输出 NO_PARAGRAPHS", async () => {
      const shortContent = "内容。".repeat(10); // < 500字
      const result = await checker.check(shortContent);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("NO_PARAGRAPHS");
    });

    it("超过800字的段落输出 LONG_PARAGRAPH info", async () => {
      // 准备两个段落，第一个超过800字
      const longPara = "内".repeat(850);
      const content = `${longPara}\n\n短段落`;
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("LONG_PARAGRAPH");
    });

    it("4个以上不足30字的段落时输出 SHORT_PARAGRAPH info", async () => {
      // 5个段落，每段不足30字
      const paras = Array.from(
        { length: 5 },
        (_, i) => `短段落${i + 1}测试`,
      ).join("\n\n");
      const result = await checker.check(paras);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("SHORT_PARAGRAPH");
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 过渡词检查
  // ---------------------------------------------------------------------------

  describe("performCheck() — checkTransitions", () => {
    it("段落少于3个时不输出 FEW_TRANSITIONS", async () => {
      const content = "段落1\n\n段落2";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("FEW_TRANSITIONS");
    });

    it("5个以上段落且过渡词比例低时输出 FEW_TRANSITIONS", async () => {
      // 5段落·无过渡词
      const content = Array.from(
        { length: 5 },
        (_, i) => `这是第${i + 1}段的内容。内容继续延伸。以下是详细说明。`,
      ).join("\n\n");
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("FEW_TRANSITIONS");
    });

    it("过渡词充足时不输出 FEW_TRANSITIONS", async () => {
      // 5段落含过渡词
      const paras = [
        "首先说明第一部分内容。",
        "其次是第二段内容。此外还有更多。",
        "然后是第三段。因此我们可以看出。",
        "所以第四段也很重要。另外还有补充。",
        "最后是总结。综上所述内容完整。由此可见结论清晰。",
      ].join("\n\n");
      const result = await checker.check(paras);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("FEW_TRANSITIONS");
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 论证结构检查
  // ---------------------------------------------------------------------------

  describe("performCheck() — checkArgumentStructure", () => {
    it("有主张但无依据且超过500字时输出 CLAIM_WITHOUT_EVIDENCE", async () => {
      // 含「认为」等主张词，不含「因为/例如」等依据词，超过500字
      // "这很重要。" 是5字 × 100 = 500字，content.length > 500 不满足
      // 将主张词放在最前，通过重复使字数超过501字
      const claim =
        "我认为这是正确的。我们应该这样做。必须采取行动。建议立即执行。";
      const padding = "内容继续。".repeat(100); // 6字 × 100 = 600字
      const content = claim + padding;
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("CLAIM_WITHOUT_EVIDENCE");
    });

    it("有依据时不输出 CLAIM_WITHOUT_EVIDENCE", async () => {
      const claim =
        "我认为这是正确的。因为研究表明这样做效果更好。例如案例显示。";
      const padding = "内容继续。".repeat(100);
      const content = claim + padding;
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("CLAIM_WITHOUT_EVIDENCE");
    });

    it("超过1000字且无结论词时输出 NO_CONCLUSION", async () => {
      const content = "内容继续延伸。".repeat(200); // 超过1000字·无结论词
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("NO_CONCLUSION");
    });

    it("有结论词时不输出 NO_CONCLUSION", async () => {
      const content = "内容继续延伸。".repeat(200) + "总之，以上是结论。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("NO_CONCLUSION");
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 分数计算
  // ---------------------------------------------------------------------------

  describe("performCheck() — score calculation", () => {
    it("无问题时分数为 100", async () => {
      // 简短内容（不足500字·无需段落检查）
      const result = await checker.performCheck("简短内容，无任何问题。");
      expect(result.score).toBe(100);
      expect(result.issues).toHaveLength(0);
    });

    it("分数不低于 0", async () => {
      // 触发大量问题的内容
      const problemContent =
        "认为应该必须建议主张。".repeat(10) + // CLAIM_WITHOUT_EVIDENCE
        "内".repeat(1500); // NO_CONCLUSION + 长段落
      const result = await checker.performCheck(problemContent);
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
      expect(stats.passedChecks).toBe(0);
      expect(stats.failedChecks).toBe(0);
      expect(stats.avgScore).toBe(0);
      expect(stats.avgDuration).toBe(0);
    });

    it("执行 check() 后统计数据更新", async () => {
      await checker.check("测试内容");
      const stats = checker.getStats();
      expect(stats.totalChecks).toBe(1);
    });

    it("多次执行后 totalChecks 增加", async () => {
      await checker.check("内容1");
      await checker.check("内容2");
      await checker.check("内容3");
      const stats = checker.getStats();
      expect(stats.totalChecks).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // 自定义配置下的行为
  // ---------------------------------------------------------------------------

  describe("custom config", () => {
    it("threshold=0 时始终 passed=true", async () => {
      const mod = await Test.createTestingModule({
        providers: [
          CoherenceChecker,
          {
            provide: COHERENCE_CHECKER_CONFIG,
            useValue: { threshold: 0 },
          },
        ],
      }).compile();
      const checker0 = mod.get<CoherenceChecker>(CoherenceChecker);
      const result = await checker0.check("简短内容");
      expect(result.passed).toBe(true);
    });

    it("threshold=100 时非满分则 passed=false", async () => {
      const mod = await Test.createTestingModule({
        providers: [
          CoherenceChecker,
          {
            provide: COHERENCE_CHECKER_CONFIG,
            useValue: { threshold: 100 },
          },
        ],
      }).compile();
      const checker100 = mod.get<CoherenceChecker>(CoherenceChecker);
      const longNoConclusion = "内容继续延伸。".repeat(200);
      const result = await checker100.check(longNoConclusion);
      expect(result.passed).toBe(false);
    });

    it("maxIssues=1 时 issues 限制为 1 条", async () => {
      const mod = await Test.createTestingModule({
        providers: [
          CoherenceChecker,
          {
            provide: COHERENCE_CHECKER_CONFIG,
            useValue: { maxIssues: 1 },
          },
        ],
      }).compile();
      const checkerMax1 = mod.get<CoherenceChecker>(CoherenceChecker);
      // 触发多个问题的内容
      const content =
        "认为应该必须。".repeat(10) + "内".repeat(600) + "内".repeat(1500);
      const result = await checkerMax1.check(content);
      expect(result.issues.length).toBeLessThanOrEqual(1);
    });
  });
});
