/**
 * Quality Gate Service
 * 质量门禁服务 - 执行多维度质量检查
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  IQualityGate,
  IQualityChecker,
  QualityDimension,
  QualityGateConfig,
  QualityGateResult,
  QualityCheckResult,
  QualityCheckContext,
} from "../abstractions/quality-gate.interface";

/**
 * 默认质量门禁配置
 */
const DEFAULT_CONFIG: QualityGateConfig = {
  dimensions: ["diversity", "consistency", "coherence"],
  thresholds: {
    diversity: 60,
    consistency: 70,
    factual: 80,
    coherence: 65,
    completeness: 60,
    relevance: 70,
    originality: 50,
  },
  strictMode: false,
  enableSuggestions: true,
  maxIssuesPerDimension: 20,
};

/**
 * 质量门禁服务
 */
@Injectable()
export class QualityGateService implements IQualityGate {
  private readonly logger = new Logger(QualityGateService.name);
  private readonly checkers = new Map<QualityDimension, IQualityChecker>();

  /**
   * 注册检查器
   */
  registerChecker(checker: IQualityChecker): void {
    if (this.checkers.has(checker.dimension)) {
      this.logger.warn(
        `Checker for ${checker.dimension} already registered, replacing...`,
      );
    }
    this.checkers.set(checker.dimension, checker);
    this.logger.log(
      `Registered quality checker: ${checker.dimension} (${checker.name})`,
    );
  }

  /**
   * 注销检查器
   */
  unregisterChecker(dimension: QualityDimension): boolean {
    const result = this.checkers.delete(dimension);
    if (result) {
      this.logger.log(`Unregistered quality checker: ${dimension}`);
    }
    return result;
  }

  /**
   * 执行质量门禁检查
   * @param globalTimeout 全局超时时间（毫秒），默认 60 秒
   */
  async evaluate(
    content: string,
    config: QualityGateConfig,
    context?: QualityCheckContext,
    globalTimeout = 60000,
  ): Promise<QualityGateResult> {
    const startTime = Date.now();

    // ★ 使用全局超时保护
    try {
      const evaluatePromise = this.doEvaluate(content, config, context);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Quality evaluation timeout")),
          globalTimeout,
        ),
      );

      return await Promise.race([evaluatePromise, timeoutPromise]);
    } catch (error) {
      const evaluationDuration = Date.now() - startTime;
      this.logger.error(`Quality evaluation failed: ${error}`);

      // 返回降级结果
      return {
        passed: false,
        overallScore: 0,
        results: [],
        summary: {
          passedCount: 0,
          failedCount: config.dimensions.length,
          totalIssues: 1,
          criticalIssues: 1,
        },
        recommendation: "revise",
        evaluationDuration,
      };
    }
  }

  /**
   * 执行实际的质量评估
   */
  private async doEvaluate(
    content: string,
    config: QualityGateConfig,
    context?: QualityCheckContext,
  ): Promise<QualityGateResult> {
    const startTime = Date.now();
    const results: QualityCheckResult[] = [];

    this.logger.debug(
      `Evaluating content quality with ${config.dimensions.length} dimensions`,
    );

    // 并行执行所有维度的检查
    const checkPromises = config.dimensions.map(async (dimension) => {
      const checker = this.checkers.get(dimension);
      if (!checker) {
        this.logger.warn(`No checker registered for dimension: ${dimension}`);
        return null;
      }

      if (!checker.isAvailable()) {
        this.logger.warn(`Checker for ${dimension} is not available`);
        return null;
      }

      try {
        const result = await checker.check(content, context);

        // 应用阈值判断
        const threshold = config.thresholds[dimension] ?? 60;
        result.passed = result.score >= threshold;

        // 限制问题数量
        if (
          config.maxIssuesPerDimension &&
          result.issues.length > config.maxIssuesPerDimension
        ) {
          result.issues = result.issues.slice(0, config.maxIssuesPerDimension);
        }

        return result;
      } catch (error) {
        this.logger.error(`Quality check failed for ${dimension}: ${error}`);
        return {
          dimension,
          score: 0,
          passed: false,
          issues: [
            {
              severity: "error" as const,
              code: "CHECK_FAILED",
              message: `检查失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          suggestions: [],
        } as QualityCheckResult;
      }
    });

    const checkResults = await Promise.all(checkPromises);

    // 过滤掉 null 结果
    for (const result of checkResults) {
      if (result) {
        results.push(result);
      }
    }

    // 计算统计
    let totalScore = 0;
    let passedCount = 0;
    let failedCount = 0;
    let totalIssues = 0;
    let criticalIssues = 0;

    for (const result of results) {
      totalScore += result.score;
      if (result.passed) {
        passedCount++;
      } else {
        failedCount++;
      }
      totalIssues += result.issues.length;
      criticalIssues += result.issues.filter(
        (i) => i.severity === "error",
      ).length;
    }

    // 计算综合评分
    const overallScore =
      results.length > 0 ? Math.round(totalScore / results.length) : 0;

    // ★ 修复评分逻辑：非严格模式下，任何维度低于其阈值也应视为失败
    const hasAnyDimensionBelowThreshold = results.some(
      (r) => r.score < (config.thresholds[r.dimension] ?? 60),
    );

    // 判断是否通过门禁
    const passed = config.strictMode
      ? failedCount === 0
      : overallScore >= 60 &&
        criticalIssues === 0 &&
        !hasAnyDimensionBelowThreshold;

    // 生成建议
    const recommendation = this.generateRecommendation(
      passed,
      overallScore,
      criticalIssues,
    );

    const evaluationDuration = Date.now() - startTime;
    this.logger.log(
      `Quality evaluation completed: score=${overallScore}, passed=${passed}, duration=${evaluationDuration}ms`,
    );

    return {
      passed,
      overallScore,
      results,
      summary: {
        passedCount,
        failedCount,
        totalIssues,
        criticalIssues,
      },
      recommendation,
      evaluationDuration,
    };
  }

  /**
   * 生成建议
   */
  private generateRecommendation(
    passed: boolean,
    score: number,
    criticalIssues: number,
  ): QualityGateResult["recommendation"] {
    if (passed && score >= 80) return "approve";
    if (criticalIssues > 0 || score < 40) return "reject";
    return "revise";
  }

  /**
   * 获取可用检查器
   */
  getAvailableCheckers(): QualityDimension[] {
    const available: QualityDimension[] = [];
    for (const [dimension, checker] of this.checkers) {
      if (checker.isAvailable()) {
        available.push(dimension);
      }
    }
    return available;
  }

  /**
   * 获取检查器
   */
  getChecker(dimension: QualityDimension): IQualityChecker | undefined {
    return this.checkers.get(dimension);
  }

  /**
   * 获取默认配置
   */
  getDefaultConfig(): QualityGateConfig {
    return { ...DEFAULT_CONFIG };
  }

  /**
   * 检查器是否已注册
   */
  hasChecker(dimension: QualityDimension): boolean {
    return this.checkers.has(dimension);
  }

  /**
   * 获取所有检查器的信息
   */
  getCheckersInfo(): Array<{
    dimension: QualityDimension;
    name: string;
    description?: string;
    available: boolean;
  }> {
    return Array.from(this.checkers.entries()).map(([dimension, checker]) => ({
      dimension,
      name: checker.name,
      description: checker.description,
      available: checker.isAvailable(),
    }));
  }
}
