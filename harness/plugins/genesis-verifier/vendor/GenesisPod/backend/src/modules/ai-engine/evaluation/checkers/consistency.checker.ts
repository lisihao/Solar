/**
 * Consistency Checker
 * 一致性检查器 - 检查内容一致性
 */

import { Injectable, Optional, Inject } from "@nestjs/common";
import {
  BaseQualityChecker,
  CheckerConfig,
} from "../abstractions/quality-checker.interface";
import {
  QualityDimension,
  QualityIssue,
  QualityCheckContext,
} from "../abstractions/quality-gate.interface";

export const CONSISTENCY_CHECKER_CONFIG = "CONSISTENCY_CHECKER_CONFIG";

/**
 * 一致性检查器
 */
@Injectable()
export class ConsistencyChecker extends BaseQualityChecker {
  readonly dimension: QualityDimension = "consistency";
  readonly name = "Consistency Checker";
  readonly description = "检查内容的风格和事实一致性";

  constructor(
    @Optional()
    @Inject(CONSISTENCY_CHECKER_CONFIG)
    config?: Partial<CheckerConfig>,
  ) {
    super(config);
  }

  /**
   * 执行一致性检查
   */
  async performCheck(
    content: string,
    context?: QualityCheckContext,
  ): Promise<{ score: number; issues: QualityIssue[] }> {
    const issues: QualityIssue[] = [];
    let score = 100;

    // 检查人称一致性
    const personIssues = this.checkPersonConsistency(content);
    if (personIssues.length > 0) {
      score -= personIssues.length * 5;
      issues.push(...personIssues);
    }

    // 检查时态一致性
    const tenseIssues = this.checkTenseConsistency(content);
    if (tenseIssues.length > 0) {
      score -= tenseIssues.length * 5;
      issues.push(...tenseIssues);
    }

    // 检查术语一致性
    const termIssues = this.checkTermConsistency(content);
    if (termIssues.length > 0) {
      score -= termIssues.length * 3;
      issues.push(...termIssues);
    }

    // 如果有上下文，检查与之前内容的一致性
    if (context?.previousContent) {
      const contextIssues = this.checkContextConsistency(
        content,
        context.previousContent,
      );
      if (contextIssues.length > 0) {
        score -= contextIssues.length * 5;
        issues.push(...contextIssues);
      }
    }

    // 检查数字格式一致性
    const numberIssues = this.checkNumberFormatConsistency(content);
    if (numberIssues.length > 0) {
      score -= numberIssues.length * 2;
      issues.push(...numberIssues);
    }

    return { score: Math.max(0, score), issues };
  }

  /**
   * 检查人称一致性
   */
  private checkPersonConsistency(content: string): QualityIssue[] {
    const issues: QualityIssue[] = [];

    // 检测使用的人称
    const firstPerson = (content.match(/我们|我|本文|本研究/g) || []).length;
    const thirdPerson = (content.match(/该|其|本|此/g) || []).length;

    // 如果同时使用第一人称和第三人称，可能存在不一致
    if (firstPerson > 3 && thirdPerson > 3) {
      const ratio =
        Math.min(firstPerson, thirdPerson) / Math.max(firstPerson, thirdPerson);
      if (ratio > 0.3) {
        issues.push({
          severity: "warning",
          code: "PERSON_INCONSISTENCY",
          message: "文章中混用了第一人称和第三人称",
          suggestion: "建议统一使用一种人称，保持叙述视角一致",
        });
      }
    }

    return issues;
  }

  /**
   * 检查时态一致性（主要针对中文的时间表述）
   */
  private checkTenseConsistency(content: string): QualityIssue[] {
    const issues: QualityIssue[] = [];

    // 检测过去时态标记
    const pastMarkers = (content.match(/了|过|曾经|已经|之前/g) || []).length;
    // 检测将来时态标记
    const futureMarkers = (content.match(/将|将要|即将|未来|以后/g) || [])
      .length;
    // 检测现在时态标记
    const presentMarkers = (content.match(/正在|目前|现在|当前/g) || []).length;

    // 简单检查：如果所有时态都大量出现，可能存在混乱
    const markers = [pastMarkers, futureMarkers, presentMarkers].filter(
      (m) => m > 5,
    );
    if (markers.length >= 2) {
      issues.push({
        severity: "info",
        code: "TENSE_VARIETY",
        message: "文章中使用了多种时态表述",
        suggestion: "请确保时态使用符合叙述逻辑",
      });
    }

    return issues;
  }

  /**
   * 检查术语一致性
   */
  private checkTermConsistency(content: string): QualityIssue[] {
    const issues: QualityIssue[] = [];

    // 常见的不一致术语对
    const termPairs = [
      ["人工智能", "AI"],
      ["机器学习", "ML"],
      ["用户", "使用者"],
      ["数据", "资料"],
      ["系统", "平台"],
    ];

    for (const [term1, term2] of termPairs) {
      const count1 = (content.match(new RegExp(term1, "g")) || []).length;
      const count2 = (content.match(new RegExp(term2, "g")) || []).length;

      if (count1 > 0 && count2 > 0) {
        issues.push({
          severity: "info",
          code: "TERM_INCONSISTENCY",
          message: `术语使用不一致：同时使用了"${term1}"(${count1}次)和"${term2}"(${count2}次)`,
          suggestion: `建议统一使用"${count1 > count2 ? term1 : term2}"`,
        });
      }
    }

    return issues;
  }

  /**
   * 检查与上下文的一致性
   */
  private checkContextConsistency(
    content: string,
    previousContent: string,
  ): QualityIssue[] {
    const issues: QualityIssue[] = [];

    // 提取之前内容中的关键实体
    const prevEntities = this.extractEntities(previousContent);
    const currEntities = this.extractEntities(content);

    // 检查实体名称是否一致
    for (const [entity, variations] of prevEntities) {
      if (currEntities.has(entity)) {
        const currVariations = currEntities.get(entity)!;
        const allVariations = new Set([...variations, ...currVariations]);

        if (allVariations.size > 1) {
          issues.push({
            severity: "warning",
            code: "ENTITY_NAME_INCONSISTENCY",
            message: `实体名称不一致：${Array.from(allVariations).join("/")}`,
            suggestion: "建议在全文中统一使用相同的名称",
          });
        }
      }
    }

    return issues;
  }

  /**
   * 检查数字格式一致性
   */
  private checkNumberFormatConsistency(content: string): QualityIssue[] {
    const issues: QualityIssue[] = [];

    // 检查是否混用阿拉伯数字和中文数字
    const arabicNumbers = (content.match(/\d+/g) || []).length;
    const chineseNumbers = (
      content.match(/[一二三四五六七八九十百千万亿]+/g) || []
    ).length;

    if (arabicNumbers > 5 && chineseNumbers > 5) {
      issues.push({
        severity: "info",
        code: "NUMBER_FORMAT_INCONSISTENCY",
        message: "数字格式不一致：混用了阿拉伯数字和中文数字",
        suggestion: "建议统一数字格式，通常技术文档使用阿拉伯数字",
      });
    }

    return issues;
  }

  /**
   * 提取实体（简化版）
   */
  private extractEntities(content: string): Map<string, Set<string>> {
    const entities = new Map<string, Set<string>>();

    // 简单的实体提取：查找引号中的内容作为可能的实体
    const quoted = content.match(/[""]([^""]+)[""]|「([^」]+)」/g) || [];

    for (const match of quoted) {
      const entity = match.replace(/["""「」]/g, "").toLowerCase();
      if (entity.length > 1 && entity.length < 20) {
        if (!entities.has(entity)) {
          entities.set(entity, new Set());
        }
        entities.get(entity)!.add(match);
      }
    }

    return entities;
  }
}
