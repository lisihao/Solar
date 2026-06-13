/**
 * Parsing Utilities
 *
 * AI 输出内容解析相关的工具函数
 * 从 team-mission.service.ts 提取
 */

import { REVIEW_RESULT_PATTERNS } from "../prompt";

/**
 * 审核结果（增强版，带置信度）
 */
export interface ReviewResult {
  isApproved: boolean;
  confidence: number;
  reason: string;
  matchedPattern?: string;
}

/**
 * 解析审核结果（增强版，带置信度和原因）
 *
 * 策略优先级：
 * 1. 标准格式检测（最高优先级，权重 1.0）
 * 2. 明确通过标记（权重 0.85-1.0）
 * 3. 否定模式检测（权重 0.9-1.0）
 * 4. 需要修改模式检测（权重 0.8-1.0）
 * 5. 默认策略（基于内容分析）
 */
export function parseReviewResult(content: string): ReviewResult {
  // ★★★ 最高优先级：检查标准格式 "## 审核结果：通过/需要修改" ★★★
  const formatMatch = content.match(REVIEW_RESULT_PATTERNS.STANDARD_FORMAT);
  if (formatMatch) {
    const result = formatMatch[1];
    if (result === "通过") {
      return {
        isApproved: true,
        confidence: 1.0,
        reason: `标准格式匹配: "审核结果：通过"`,
        matchedPattern: "## 审核结果：通过",
      };
    } else {
      return {
        isApproved: false,
        confidence: 1.0,
        reason: `标准格式匹配: "审核结果：需要修改"`,
        matchedPattern: "## 审核结果：需要修改",
      };
    }
  }

  const lowerContent = content.toLowerCase();

  // ★ 明确通过标记检测
  for (const { pattern, weight } of REVIEW_RESULT_PATTERNS.APPROVE_PATTERNS) {
    if (lowerContent.includes(pattern)) {
      return {
        isApproved: true,
        confidence: weight,
        reason: `检测到通过标记: "${pattern}"`,
        matchedPattern: pattern,
      };
    }
  }

  // ★ 否定模式检测
  for (const { pattern, weight } of REVIEW_RESULT_PATTERNS.REJECT_PATTERNS) {
    if (lowerContent.includes(pattern)) {
      return {
        isApproved: false,
        confidence: weight,
        reason: `检测到否定词: "${pattern}"`,
        matchedPattern: pattern,
      };
    }
  }

  // ★ 需要修改模式检测
  for (const {
    pattern,
    weight,
  } of REVIEW_RESULT_PATTERNS.REVISION_NEEDED_PATTERNS) {
    if (lowerContent.includes(pattern)) {
      return {
        isApproved: false,
        confidence: weight,
        reason: `检测到修改建议: "${pattern}"`,
        matchedPattern: pattern,
      };
    }
  }

  // ★ 默认策略：检查内容长度和格式
  const contentLength = content.replace(/\s+/g, "").length;
  if (contentLength < 50) {
    return {
      isApproved: false,
      confidence: 0.5,
      reason: `审核响应过短(${contentLength}字符)，可能需要人工确认`,
      matchedPattern: "short_response",
    };
  }

  // ★ 检查是否包含实质性的修改建议
  const hasSubstantiveFeedback =
    REVIEW_RESULT_PATTERNS.SUBSTANTIVE_FEEDBACK_KEYWORDS.some((keyword) =>
      content.includes(keyword),
    );

  if (hasSubstantiveFeedback) {
    return {
      isApproved: false,
      confidence: 0.6,
      reason: "检测到实质性反馈但无明确结论，建议修改",
      matchedPattern: "substantive_feedback_no_conclusion",
    };
  }

  // 最终默认：通过（但低置信度）
  return {
    isApproved: true,
    confidence: 0.5,
    reason: "未检测到明确的审核结论，默认通过（低置信度）",
    matchedPattern: "default_approve_low_confidence",
  };
}

/**
 * 解析优先级字符串
 */
export function parsePriority(
  priorityStr: string,
): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  const lower = priorityStr.toLowerCase();
  if (lower.includes("关键") || lower.includes("critical")) {
    return "CRITICAL";
  } else if (lower.includes("高") || lower.includes("high")) {
    return "HIGH";
  } else if (lower.includes("低") || lower.includes("low")) {
    return "LOW";
  }
  return "MEDIUM";
}

/**
 * 解析依赖字符串
 * @param dependsStr 依赖字符串，如 "1, 2" 或 "无"
 * @returns 依赖的任务索引数组（0-based）
 */
export function parseDependencies(dependsStr: string): number[] {
  const dependsOn: number[] = [];
  const depMatches = dependsStr.match(/\d+/g);
  if (depMatches) {
    for (const dep of depMatches) {
      dependsOn.push(parseInt(dep, 10) - 1); // 转换为 0 索引
    }
  }
  return dependsOn;
}

/**
 * 从内容中提取 Markdown 区块
 */
export function extractMarkdownSection(
  content: string,
  sectionName: string,
): string {
  const regex = new RegExp(`## ${sectionName}\\n([^#]+)`, "i");
  return content.match(regex)?.[1]?.trim() || "";
}
