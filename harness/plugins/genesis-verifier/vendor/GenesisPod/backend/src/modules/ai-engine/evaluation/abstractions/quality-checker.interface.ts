/**
 * Quality Checker Interface
 * 质量检查器抽象接口
 *
 * 这是 IQualityChecker 的扩展定义，用于实现具体的检查器
 */

import {
  QualityDimension,
  QualityCheckResult,
  QualityCheckContext,
  QualityIssue,
} from "./quality-gate.interface";

/**
 * 检查器基础配置
 */
export interface CheckerConfig {
  enabled: boolean;
  threshold: number; // 通过阈值
  maxIssues?: number; // 最大问题数
  customRules?: CheckerRule[];
}

/**
 * 自定义规则
 */
export interface CheckerRule {
  id: string;
  name: string;
  pattern?: string | RegExp;
  check?: (content: string, context?: QualityCheckContext) => QualityIssue[];
  severity: "error" | "warning" | "info";
  message: string;
}

/**
 * 检查器统计
 */
export interface CheckerStats {
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  avgScore: number;
  avgDuration: number;
}

/**
 * 抽象质量检查器基类
 */
export abstract class BaseQualityChecker {
  abstract readonly dimension: QualityDimension;
  abstract readonly name: string;
  readonly description?: string;

  protected config: CheckerConfig;
  protected stats: CheckerStats;

  constructor(config?: Partial<CheckerConfig>) {
    this.config = {
      enabled: true,
      threshold: 60,
      maxIssues: 50,
      ...config,
    };
    this.stats = {
      totalChecks: 0,
      passedChecks: 0,
      failedChecks: 0,
      avgScore: 0,
      avgDuration: 0,
    };
  }

  /**
   * 执行检查的抽象方法
   */
  abstract performCheck(
    content: string,
    context?: QualityCheckContext,
  ): Promise<{ score: number; issues: QualityIssue[] }>;

  /**
   * 执行检查（包装方法）
   */
  async check(
    content: string,
    context?: QualityCheckContext,
  ): Promise<QualityCheckResult> {
    const startTime = Date.now();

    try {
      const { score, issues } = await this.performCheck(content, context);

      const limitedIssues = this.config.maxIssues
        ? issues.slice(0, this.config.maxIssues)
        : issues;

      const passed = score >= this.config.threshold;
      const suggestions = this.generateSuggestions(limitedIssues);

      // 更新统计
      this.updateStats(score, Date.now() - startTime, passed);

      return {
        dimension: this.dimension,
        score,
        passed,
        issues: limitedIssues,
        suggestions,
        checkDuration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        dimension: this.dimension,
        score: 0,
        passed: false,
        issues: [
          {
            severity: "error",
            code: "CHECK_FAILED",
            message: `检查失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        suggestions: [],
        checkDuration: Date.now() - startTime,
      };
    }
  }

  /**
   * 生成建议
   */
  protected generateSuggestions(issues: QualityIssue[]): string[] {
    const suggestions: string[] = [];
    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warningCount = issues.filter((i) => i.severity === "warning").length;

    if (errorCount > 0) {
      suggestions.push(`请修复 ${errorCount} 个严重问题`);
    }
    if (warningCount > 0) {
      suggestions.push(`建议关注 ${warningCount} 个警告`);
    }

    // 添加具体建议
    issues
      .filter((i) => i.suggestion)
      .slice(0, 5)
      .forEach((i) => {
        if (i.suggestion) suggestions.push(i.suggestion);
      });

    return suggestions;
  }

  /**
   * 更新统计
   */
  protected updateStats(
    score: number,
    duration: number,
    passed: boolean,
  ): void {
    this.stats.totalChecks++;
    if (passed) {
      this.stats.passedChecks++;
    } else {
      this.stats.failedChecks++;
    }
    // 计算移动平均
    this.stats.avgScore =
      (this.stats.avgScore * (this.stats.totalChecks - 1) + score) /
      this.stats.totalChecks;
    this.stats.avgDuration =
      (this.stats.avgDuration * (this.stats.totalChecks - 1) + duration) /
      this.stats.totalChecks;
  }

  /**
   * 检查器是否可用
   */
  isAvailable(): boolean {
    return this.config.enabled;
  }

  /**
   * 获取统计信息
   */
  getStats(): CheckerStats {
    return { ...this.stats };
  }
}
