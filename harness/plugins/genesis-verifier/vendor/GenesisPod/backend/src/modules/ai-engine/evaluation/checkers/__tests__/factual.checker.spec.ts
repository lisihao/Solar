/**
 * FactualChecker Unit Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { FactualChecker, FACTUAL_CHECKER_CONFIG } from "../factual.checker";
import { QualityCheckContext } from "../../abstractions/quality-gate.interface";

describe("FactualChecker", () => {
  let checker: FactualChecker;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FactualChecker],
    }).compile();

    checker = module.get<FactualChecker>(FactualChecker);
  });

  // ---------------------------------------------------------------------------
  // 基本属性
  // ---------------------------------------------------------------------------

  describe("properties", () => {
    it("dimension 为 factual", () => {
      expect(checker.dimension).toBe("factual");
    });

    it("name 已设置", () => {
      expect(checker.name).toBe("Factual Checker");
    });

    it("description 已设置", () => {
      expect(checker.description).toBe("检查内容的事实准确性和逻辑合理性");
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
          FactualChecker,
          {
            provide: FACTUAL_CHECKER_CONFIG,
            useValue: { enabled: false },
          },
        ],
      }).compile();
      const disabled = mod.get<FactualChecker>(FactualChecker);
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
        dimension: "factual",
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
        contentType: "report",
      };
      const result = await checker.check("测试内容", context);
      expect(result.dimension).toBe("factual");
    });

    it("空字符串不会崩溃", async () => {
      const result = await checker.check("");
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 绝对性陈述检查
  // ---------------------------------------------------------------------------

  describe("performCheck() — checkAbsoluteStatements", () => {
    it("含「所有...都」时输出 ABSOLUTE_STATEMENT", async () => {
      const content = "所有人都应该这样做。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("ABSOLUTE_STATEMENT");
    });

    it("含「从来没有」时输出 ABSOLUTE_STATEMENT", async () => {
      const result = await checker.check("这个系统从来没有出现过故障。");
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("ABSOLUTE_STATEMENT");
    });

    it("含「绝对不会」时输出 ABSOLUTE_STATEMENT", async () => {
      const result = await checker.check("这绝对不会失败。");
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("ABSOLUTE_STATEMENT");
    });

    it("含「一定会」时输出 ABSOLUTE_STATEMENT", async () => {
      const result = await checker.check("这一定会成功。");
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("ABSOLUTE_STATEMENT");
    });

    it("含「永远不会」时输出 ABSOLUTE_STATEMENT", async () => {
      const result = await checker.check("这永远不会改变。");
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("ABSOLUTE_STATEMENT");
    });

    it("含「完全没有」时输出 ABSOLUTE_STATEMENT", async () => {
      const result = await checker.check("完全没有任何问题。");
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("ABSOLUTE_STATEMENT");
    });

    it("含「百分之百」时输出 ABSOLUTE_STATEMENT", async () => {
      const result = await checker.check("百分之百可靠。");
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("ABSOLUTE_STATEMENT");
    });

    it("无绝对性表达时不输出 ABSOLUTE_STATEMENT", async () => {
      const result = await checker.check("通常情况下，大多数系统运行正常。");
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("ABSOLUTE_STATEMENT");
    });

    it("ABSOLUTE_STATEMENT 最多限制为 5 条", async () => {
      // 包含全部 7 种表达
      const content =
        "所有人都。从来没有。绝对不会。一定会成功。永远不会改变。完全没有。百分之百。";
      const result = await checker.check(content);
      const absoluteIssues = result.issues.filter(
        (i) => i.code === "ABSOLUTE_STATEMENT",
      );
      expect(absoluteIssues.length).toBeLessThanOrEqual(5);
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 数字主张检查
  // ---------------------------------------------------------------------------

  describe("performCheck() — checkNumericClaims", () => {
    it("存在 6 位以上数字且无来源时输出 UNSOURCED_STATISTICS", async () => {
      const content = "市场规模达到1000000元。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("UNSOURCED_STATISTICS");
    });

    it("有来源表达时不输出 UNSOURCED_STATISTICS", async () => {
      const content = "据统计，市场规模达到1000000元。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("UNSOURCED_STATISTICS");
    });

    it("有依据表达「根据.*数据」时不输出 UNSOURCED_STATISTICS", async () => {
      const content = "根据最新数据，该数值为1234567。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("UNSOURCED_STATISTICS");
    });

    it("超过 100% 的百分比（非增长语境）时输出 INVALID_PERCENTAGE", async () => {
      const content = "该指标达到了150%的水平。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("INVALID_PERCENTAGE");
    });

    it("伴有「增长」的超 100% 百分比不会被标记", async () => {
      const content = "该指标增长了150%。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("INVALID_PERCENTAGE");
    });

    it("100% 以下的百分比不输出 INVALID_PERCENTAGE", async () => {
      const content = "满意度为85%。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("INVALID_PERCENTAGE");
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 来源主张检查
  // ---------------------------------------------------------------------------

  describe("performCheck() — checkSourceClaims", () => {
    it("含「有人说」时输出 VAGUE_SOURCE", async () => {
      const result = await checker.check("有人说这种方法更有效。");
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("VAGUE_SOURCE");
    });

    it("含「据说」时输出 VAGUE_SOURCE", async () => {
      const result = await checker.check("据说该技术已经成熟。");
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("VAGUE_SOURCE");
    });

    it("含「有研究表明」时输出 VAGUE_SOURCE", async () => {
      const result = await checker.check("有研究表明这种方式更安全。");
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("VAGUE_SOURCE");
    });

    it("含「专家认为」时输出 VAGUE_SOURCE", async () => {
      const result = await checker.check("专家认为未来发展前景广阔。");
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("VAGUE_SOURCE");
    });

    it("无模糊来源时不输出 VAGUE_SOURCE", async () => {
      const result = await checker.check("根据2024年张三等人的研究结果显示。");
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("VAGUE_SOURCE");
    });

    it("VAGUE_SOURCE 最多限制为 3 条", async () => {
      const content =
        "有人说这个。据说那个。有研究表明另一个。专家认为还有这个。";
      const result = await checker.check(content);
      const vagueIssues = result.issues.filter(
        (i) => i.code === "VAGUE_SOURCE",
      );
      expect(vagueIssues.length).toBeLessThanOrEqual(3);
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 矛盾检查
  // ---------------------------------------------------------------------------

  describe("performCheck() — checkContradictions", () => {
    it("「增长」与「下降」在同段落中无连接词共存时输出 POTENTIAL_CONTRADICTION", async () => {
      const content = "该指标出现增长，同时也出现了下降。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("POTENTIAL_CONTRADICTION");
    });

    it("「提高」与「降低」在同段落中无连接词共存时输出 POTENTIAL_CONTRADICTION", async () => {
      const content = "性能得到提高，成本也实现了降低。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("POTENTIAL_CONTRADICTION");
    });

    it("「上升」与「减少」在同段落中无连接词共存时输出 POTENTIAL_CONTRADICTION", async () => {
      const content = "数量上升，消耗减少。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("POTENTIAL_CONTRADICTION");
    });

    it("含「而」时不输出 POTENTIAL_CONTRADICTION", async () => {
      const content = "A增长而B下降，这是正常现象。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("POTENTIAL_CONTRADICTION");
    });

    it("含「但」时不输出 POTENTIAL_CONTRADICTION", async () => {
      const content = "增长趋势明显，但局部也有下降。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("POTENTIAL_CONTRADICTION");
    });

    it("含「相反」时不输出 POTENTIAL_CONTRADICTION", async () => {
      const content = "与此相反，增长和下降同时存在。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("POTENTIAL_CONTRADICTION");
    });

    it("对立词语分布在不同段落时不输出 POTENTIAL_CONTRADICTION", async () => {
      const content = "第一段：增长明显。\n\n第二段：相关指标出现下降。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("POTENTIAL_CONTRADICTION");
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 模糊表达检查
  // ---------------------------------------------------------------------------

  describe("performCheck() — checkVagueStatements", () => {
    it("模糊表达超过 10 个时输出 EXCESSIVE_VAGUE_TERMS", async () => {
      // 包含大量各类模糊表达
      const content =
        "很多人认为。大部分同意。一些人反对。某些情况下。经常出现。有时发生。" +
        "很多人支持。大部分接受。一些问题。某些方案。经常使用。有时需要。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain("EXCESSIVE_VAGUE_TERMS");
    });

    it("模糊表达不超过 10 个时不输出 EXCESSIVE_VAGUE_TERMS", async () => {
      const content = "一些人认为这是正确的。经常使用。大部分时间。";
      const result = await checker.check(content);
      const codes = result.issues.map((i) => i.code);
      expect(codes).not.toContain("EXCESSIVE_VAGUE_TERMS");
    });
  });

  // ---------------------------------------------------------------------------
  // performCheck() — 分数计算
  // ---------------------------------------------------------------------------

  describe("performCheck() — score", () => {
    it("无问题时分数为 100", async () => {
      const result = await checker.performCheck("这是一段准确的内容描述。");
      expect(result.score).toBe(100);
    });

    it("分数不低于 0", async () => {
      const content =
        "所有人都。从来没有。绝对不会。一定会。永远不会。完全没有。百分之百。" +
        "市场规模1000000元。指标达到150%。" +
        "有人说。据说。有研究表明。专家认为。" +
        "增长下降。" +
        "很多人认为。大部分同意。一些反对。某些情况。经常出现。有时发生。" +
        "很多支持。大部分接受。一些问题。某些方案。经常使用。有时需要。";
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
    it("threshold=0 时始终 passed=true", async () => {
      const mod = await Test.createTestingModule({
        providers: [
          FactualChecker,
          {
            provide: FACTUAL_CHECKER_CONFIG,
            useValue: { threshold: 0 },
          },
        ],
      }).compile();
      const c = mod.get<FactualChecker>(FactualChecker);
      const result = await c.check("所有人都绝对不会。从来没有。");
      expect(result.passed).toBe(true);
    });

    it("maxIssues=2 时 issues 限制为 2 条", async () => {
      const mod = await Test.createTestingModule({
        providers: [
          FactualChecker,
          {
            provide: FACTUAL_CHECKER_CONFIG,
            useValue: { maxIssues: 2 },
          },
        ],
      }).compile();
      const c = mod.get<FactualChecker>(FactualChecker);
      const content =
        "所有人都。从来没有。绝对不会。一定会。" +
        "市场规模1000000。有人说。据说。增长下降。" +
        "很多人大部分一些某些经常有时很多大部分一些某些经常有时。";
      const result = await c.check(content);
      expect(result.issues.length).toBeLessThanOrEqual(2);
    });
  });
});
