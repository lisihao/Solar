/**
 * QualityGateService Unit Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { QualityGateService } from "../quality-gate.service";
import {
  IQualityChecker,
  QualityCheckResult,
  QualityCheckContext,
  QualityDimension,
  QualityGateConfig,
} from "../../abstractions/quality-gate.interface";

// ---------------------------------------------------------------------------
// 测试用检查器工厂
// ---------------------------------------------------------------------------

function makeChecker(
  dimension: QualityDimension,
  score: number,
  available = true,
  issues: QualityCheckResult["issues"] = [],
): IQualityChecker {
  return {
    dimension,
    name: `${dimension} checker`,
    description: `${dimension} description`,
    isAvailable: jest.fn().mockReturnValue(available),
    check: jest.fn().mockResolvedValue({
      dimension,
      score,
      passed: score >= 60,
      issues,
      suggestions: [],
      checkDuration: 10,
    } satisfies QualityCheckResult),
  };
}

function makeConfig(
  dimensions: QualityDimension[],
  overrides: Partial<QualityGateConfig> = {},
): QualityGateConfig {
  const thresholds: QualityGateConfig["thresholds"] = {};
  for (const d of dimensions) {
    thresholds[d] = 60;
  }
  return {
    dimensions,
    thresholds,
    strictMode: false,
    enableSuggestions: true,
    maxIssuesPerDimension: 20,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 测试主体
// ---------------------------------------------------------------------------

describe("QualityGateService", () => {
  let service: QualityGateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QualityGateService],
    }).compile();

    service = module.get<QualityGateService>(QualityGateService);

    // 静默 Logger
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // registerChecker / unregisterChecker
  // ---------------------------------------------------------------------------

  describe("registerChecker()", () => {
    it("成功注册检查器", () => {
      const checker = makeChecker("diversity", 80);
      service.registerChecker(checker);
      expect(service.hasChecker("diversity")).toBe(true);
    });

    it("相同 dimension 二次注册时覆盖原有检查器", () => {
      const checker1 = makeChecker("diversity", 70);
      const checker2 = makeChecker("diversity", 90);
      service.registerChecker(checker1);
      service.registerChecker(checker2);
      expect(service.getChecker("diversity")).toBe(checker2);
    });
  });

  describe("unregisterChecker()", () => {
    it("删除已注册检查器并返回 true", () => {
      service.registerChecker(makeChecker("coherence", 70));
      const result = service.unregisterChecker("coherence");
      expect(result).toBe(true);
      expect(service.hasChecker("coherence")).toBe(false);
    });

    it("未注册的 dimension 返回 false", () => {
      const result = service.unregisterChecker("coherence");
      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // hasChecker / getChecker
  // ---------------------------------------------------------------------------

  describe("hasChecker()", () => {
    it("已注册时返回 true", () => {
      service.registerChecker(makeChecker("factual", 80));
      expect(service.hasChecker("factual")).toBe(true);
    });

    it("未注册时返回 false", () => {
      expect(service.hasChecker("factual")).toBe(false);
    });
  });

  describe("getChecker()", () => {
    it("返回已注册的 checker", () => {
      const checker = makeChecker("consistency", 75);
      service.registerChecker(checker);
      expect(service.getChecker("consistency")).toBe(checker);
    });

    it("未注册时返回 undefined", () => {
      expect(service.getChecker("consistency")).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getAvailableCheckers
  // ---------------------------------------------------------------------------

  describe("getAvailableCheckers()", () => {
    it("返回 isAvailable=true 的检查器 dimension 列表", () => {
      service.registerChecker(makeChecker("diversity", 80, true));
      service.registerChecker(makeChecker("coherence", 70, false));
      service.registerChecker(makeChecker("factual", 90, true));
      const available = service.getAvailableCheckers();
      expect(available).toContain("diversity");
      expect(available).toContain("factual");
      expect(available).not.toContain("coherence");
    });

    it("无检查器时返回空数组", () => {
      expect(service.getAvailableCheckers()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getDefaultConfig
  // ---------------------------------------------------------------------------

  describe("getDefaultConfig()", () => {
    it("返回 QualityGateConfig 的结构", () => {
      const config = service.getDefaultConfig();
      expect(config).toMatchObject({
        dimensions: expect.any(Array),
        thresholds: expect.any(Object),
        strictMode: expect.any(Boolean),
      });
    });

    it("每次返回新对象（引用不同）", () => {
      const config1 = service.getDefaultConfig();
      const config2 = service.getDefaultConfig();
      expect(config1).not.toBe(config2);
    });
  });

  // ---------------------------------------------------------------------------
  // getCheckersInfo
  // ---------------------------------------------------------------------------

  describe("getCheckersInfo()", () => {
    it("返回已注册检查器的 info 列表", () => {
      service.registerChecker(makeChecker("diversity", 80, true));
      service.registerChecker(makeChecker("coherence", 70, false));
      const info = service.getCheckersInfo();
      expect(info).toHaveLength(2);
      const diversityInfo = info.find((i) => i.dimension === "diversity");
      expect(diversityInfo).toMatchObject({
        dimension: "diversity",
        name: "diversity checker",
        description: "diversity description",
        available: true,
      });
    });

    it("无检查器时返回空数组", () => {
      expect(service.getCheckersInfo()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // evaluate() — 正常情况
  // ---------------------------------------------------------------------------

  describe("evaluate()", () => {
    it("返回 QualityGateResult 的结构", async () => {
      service.registerChecker(makeChecker("diversity", 80));
      const config = makeConfig(["diversity"]);
      const result = await service.evaluate("内容", config);
      expect(result).toMatchObject({
        passed: expect.any(Boolean),
        overallScore: expect.any(Number),
        results: expect.any(Array),
        summary: {
          passedCount: expect.any(Number),
          failedCount: expect.any(Number),
          totalIssues: expect.any(Number),
          criticalIssues: expect.any(Number),
        },
        recommendation: expect.stringMatching(/^(approve|revise|reject)$/),
        evaluationDuration: expect.any(Number),
      });
    });

    it("所有检查器分数 >= 80 时 passed=true 且 recommendation=approve", async () => {
      service.registerChecker(makeChecker("diversity", 85));
      service.registerChecker(makeChecker("coherence", 90));
      const config = makeConfig(["diversity", "coherence"]);
      const result = await service.evaluate("内容", config);
      expect(result.passed).toBe(true);
      expect(result.recommendation).toBe("approve");
    });

    it("非严格模式下任一分数低于阈值时 passed=false", async () => {
      service.registerChecker(makeChecker("diversity", 90));
      service.registerChecker(makeChecker("coherence", 40)); // 低于阈值 60
      const config = makeConfig(["diversity", "coherence"], {
        strictMode: false,
      });
      const result = await service.evaluate("内容", config);
      expect(result.passed).toBe(false);
    });

    it("严格模式下所有分数均达阈值时 passed=true", async () => {
      service.registerChecker(makeChecker("diversity", 70));
      service.registerChecker(makeChecker("coherence", 75));
      const config = makeConfig(["diversity", "coherence"], {
        strictMode: true,
      });
      const result = await service.evaluate("内容", config);
      expect(result.passed).toBe(true);
    });

    it("严格模式下任一分数低于阈值时 passed=false", async () => {
      service.registerChecker(makeChecker("diversity", 90));
      service.registerChecker(makeChecker("coherence", 50)); // 低于阈值 60
      const config = makeConfig(["diversity", "coherence"], {
        strictMode: true,
      });
      const result = await service.evaluate("内容", config);
      expect(result.passed).toBe(false);
    });

    it("传入 context 不会崩溃", async () => {
      service.registerChecker(makeChecker("diversity", 80));
      const config = makeConfig(["diversity"]);
      const context: QualityCheckContext = {
        contentType: "article",
        language: "zh",
      };
      const result = await service.evaluate("内容", config, context);
      expect(result.passed).toBeDefined();
    });

    it("未注册的 dimension 被跳过（null）", async () => {
      // 不注册 coherence 检查器
      const config = makeConfig(["coherence"]);
      const result = await service.evaluate("内容", config);
      expect(result.results).toHaveLength(0);
      expect(result.overallScore).toBe(0);
    });

    it("isAvailable=false 的检查器被跳过", async () => {
      service.registerChecker(makeChecker("diversity", 80, false));
      const config = makeConfig(["diversity"]);
      const result = await service.evaluate("内容", config);
      expect(result.results).toHaveLength(0);
    });

    it("检查器抛出异常时 error 结果包含在 results 中", async () => {
      const failingChecker: IQualityChecker = {
        dimension: "diversity",
        name: "failing",
        isAvailable: () => true,
        check: jest.fn().mockRejectedValue(new Error("checker error")),
      };
      service.registerChecker(failingChecker);
      const config = makeConfig(["diversity"]);
      const result = await service.evaluate("内容", config);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].issues[0].code).toBe("CHECK_FAILED");
    });
  });

  // ---------------------------------------------------------------------------
  // evaluate() — maxIssuesPerDimension
  // ---------------------------------------------------------------------------

  describe("evaluate() — maxIssuesPerDimension", () => {
    it("issues 超过 maxIssuesPerDimension 时被截断", async () => {
      const manyIssues: QualityCheckResult["issues"] = Array.from(
        { length: 30 },
        (_, i) => ({
          severity: "info" as const,
          code: `ISSUE_${i}`,
          message: `issue ${i}`,
        }),
      );
      service.registerChecker(makeChecker("diversity", 80, true, manyIssues));
      const config = makeConfig(["diversity"], { maxIssuesPerDimension: 5 });
      const result = await service.evaluate("内容", config);
      expect(result.results[0].issues.length).toBeLessThanOrEqual(5);
    });

    it("未设置 maxIssuesPerDimension 时 issues 不截断", async () => {
      const manyIssues: QualityCheckResult["issues"] = Array.from(
        { length: 25 },
        (_, i) => ({
          severity: "info" as const,
          code: `ISSUE_${i}`,
          message: `issue ${i}`,
        }),
      );
      service.registerChecker(makeChecker("diversity", 80, true, manyIssues));
      const config = makeConfig(["diversity"]);
      delete config.maxIssuesPerDimension;
      const result = await service.evaluate("内容", config);
      expect(result.results[0].issues).toHaveLength(25);
    });
  });

  // ---------------------------------------------------------------------------
  // evaluate() — recommendation
  // ---------------------------------------------------------------------------

  describe("evaluate() — generateRecommendation", () => {
    it("passed 且 score >= 80 时为 approve", async () => {
      service.registerChecker(makeChecker("diversity", 85));
      const config = makeConfig(["diversity"]);
      const result = await service.evaluate("内容", config);
      expect(result.recommendation).toBe("approve");
    });

    it("有 error 级别 issue 时为 reject", async () => {
      const errorIssue: QualityCheckResult["issues"] = [
        { severity: "error", code: "FATAL", message: "fatal" },
      ];
      service.registerChecker(makeChecker("diversity", 50, true, errorIssue));
      const config = makeConfig(["diversity"]);
      const result = await service.evaluate("内容", config);
      expect(result.recommendation).toBe("reject");
    });

    it("score < 40 时为 reject", async () => {
      service.registerChecker(makeChecker("diversity", 35));
      const config = makeConfig(["diversity"], {
        thresholds: { diversity: 10 },
      });
      const result = await service.evaluate("内容", config);
      expect(result.recommendation).toBe("reject");
    });

    it("passed=false 且分数适中时为 revise", async () => {
      service.registerChecker(makeChecker("diversity", 55));
      service.registerChecker(makeChecker("coherence", 55));
      const config = makeConfig(["diversity", "coherence"]);
      const result = await service.evaluate("内容", config);
      // overallScore = 55, passed=false 所以为 revise
      expect(result.recommendation).toBe("revise");
    });
  });

  // ---------------------------------------------------------------------------
  // evaluate() — summary 汇总
  // ---------------------------------------------------------------------------

  describe("evaluate() — summary aggregation", () => {
    it("passedCount / failedCount 正确汇总", async () => {
      service.registerChecker(makeChecker("diversity", 80)); // pass
      service.registerChecker(makeChecker("coherence", 40)); // fail (< threshold 60)
      const config = makeConfig(["diversity", "coherence"]);
      const result = await service.evaluate("内容", config);
      expect(result.summary.passedCount).toBe(1);
      expect(result.summary.failedCount).toBe(1);
    });

    it("totalIssues 和 criticalIssues 正确汇总", async () => {
      const issues: QualityCheckResult["issues"] = [
        { severity: "error", code: "E1", message: "error 1" },
        { severity: "warning", code: "W1", message: "warning 1" },
        { severity: "info", code: "I1", message: "info 1" },
      ];
      service.registerChecker(makeChecker("diversity", 70, true, issues));
      const config = makeConfig(["diversity"]);
      const result = await service.evaluate("内容", config);
      expect(result.summary.totalIssues).toBe(3);
      expect(result.summary.criticalIssues).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // evaluate() — 超时
  // ---------------------------------------------------------------------------

  describe("evaluate() — timeout", () => {
    it("超过 globalTimeout 时返回降级结果（passed=false, overallScore=0）", async () => {
      const slowChecker: IQualityChecker = {
        dimension: "diversity",
        name: "slow",
        isAvailable: () => true,
        check: jest
          .fn()
          .mockImplementation(
            () => new Promise((resolve) => setTimeout(resolve, 5000)),
          ),
      };
      service.registerChecker(slowChecker);
      const config = makeConfig(["diversity"]);
      const result = await service.evaluate("内容", config, undefined, 50); // 50ms timeout
      expect(result.passed).toBe(false);
      expect(result.overallScore).toBe(0);
      expect(result.recommendation).toBe("revise");
    });
  });

  // ---------------------------------------------------------------------------
  // evaluate() — overallScore 计算
  // ---------------------------------------------------------------------------

  describe("evaluate() — overallScore", () => {
    it("结果为零时 overallScore=0", async () => {
      const config = makeConfig(["diversity"]); // 未注册检查器
      const result = await service.evaluate("内容", config);
      expect(result.overallScore).toBe(0);
    });

    it("多个检查器分数正确取平均", async () => {
      service.registerChecker(makeChecker("diversity", 80));
      service.registerChecker(makeChecker("coherence", 60));
      const config = makeConfig(["diversity", "coherence"]);
      const result = await service.evaluate("内容", config);
      expect(result.overallScore).toBe(70);
    });
  });
});
