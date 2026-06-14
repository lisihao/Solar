/**
 * Evidence Weight Profiles Config
 *
 * 语义来源标签到 DataSourceType 的映射，以及
 * hintToWeightProfile() 将 Leader 语义偏好转换为数值权重配置。
 */

import type {
  EvidenceWeightHint,
  EvidenceWeightProfile,
} from "../types/evidence-weight-profile.types";

/**
 * 语义标签 → DataSourceType 字符串列表的映射
 * 与 DataSourceType enum 保持一致，用字符串避免循环依赖
 */
const SOURCE_LABEL_MAP: Record<string, string[]> = {
  academic: ["ACADEMIC", "SEMANTIC_SCHOLAR", "PUBMED", "OPENALEX"],
  government: ["FEDERAL_REGISTER", "CONGRESS", "WHITEHOUSE"],
  industry: ["INDUSTRY_REPORT"],
  technical: ["GITHUB", "HACKERNEWS"],
  financial: ["FINANCE_API"],
  news: ["RSS", "WEB"],
  social: ["SOCIAL_X"],
  web: ["WEB"],
};

/** 优先来源的乘数 */
const PREFERRED_MULTIPLIER = 1.8;
/** 降权来源的乘数 */
const DEPRIORITIZED_MULTIPLIER = 0.4;

/** freshnessSensitivity → freshnessBoostFactor 映射 */
const FRESHNESS_BOOST: Record<string, number> = {
  high: 1.5,
  medium: 1.0,
  low: 0.5,
};

/**
 * 将 Leader 的语义权重提示转换为可执行的数值权重配置
 *
 * @example
 * hintToWeightProfile({
 *   freshnessSensitivity: "low",
 *   preferredSources: ["academic"],
 *   deprioritizedSources: ["social"],
 *   reason: "技术原理类维度应优先学术论文"
 * })
 * // => { sourceTypeMultipliers: { ACADEMIC: 1.8, SEMANTIC_SCHOLAR: 1.8, ... SOCIAL_X: 0.4 }, freshnessBoostFactor: 0.5 }
 */
export function hintToWeightProfile(
  hint: EvidenceWeightHint,
): EvidenceWeightProfile {
  const multipliers: Record<string, number> = {};

  for (const label of hint.preferredSources) {
    const types = SOURCE_LABEL_MAP[label.toLowerCase()];
    if (types) {
      for (const t of types) {
        // 取最大值，避免多个标签重复设置时降低
        multipliers[t] = Math.max(multipliers[t] ?? 1.0, PREFERRED_MULTIPLIER);
      }
    }
  }

  for (const label of hint.deprioritizedSources ?? []) {
    const types = SOURCE_LABEL_MAP[label.toLowerCase()];
    if (types) {
      for (const t of types) {
        // 只有在未被 preferred 覆盖时才降权
        if (!(t in multipliers)) {
          multipliers[t] = DEPRIORITIZED_MULTIPLIER;
        }
      }
    }
  }

  return {
    sourceTypeMultipliers: multipliers,
    freshnessBoostFactor: FRESHNESS_BOOST[hint.freshnessSensitivity] ?? 1.0,
  };
}
