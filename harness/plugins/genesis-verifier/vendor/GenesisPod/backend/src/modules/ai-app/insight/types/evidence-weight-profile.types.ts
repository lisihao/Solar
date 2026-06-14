/**
 * Evidence Weight Profile Types
 *
 * Leader 规划阶段输出的语义权重偏好，用于在 filterEvidenceForSection 阶段
 * 动态调整不同来源类型的证据在章节分配中的优先级。
 */

/**
 * Leader 规划的语义权重提示
 * 高层语义，LLM 可以直接输出，无需理解具体权重数值
 */
export interface EvidenceWeightHint {
  /** 时效性敏感度：high=最新数据优先，low=历史积累优先 */
  freshnessSensitivity: "high" | "medium" | "low";
  /** 优先来源类型（语义标签，如 "academic", "government", "industry", "technical", "financial", "news"） */
  preferredSources: string[];
  /** 降权来源类型（可选） */
  deprioritizedSources?: string[];
  /** 规划理由（用于日志记录和可解释性） */
  reason: string;
}

/**
 * 数值化的权重配置，由 hintToWeightProfile() 从 EvidenceWeightHint 转换而来
 * 用于在证据评分时对不同来源类型施加乘数
 */
export interface EvidenceWeightProfile {
  /**
   * 来源类型乘数（1.0 = 不变，>1 = 提升，<1 = 降权）
   * 仅包含需要调整的来源类型，未包含的类型乘数默认为 1.0
   */
  sourceTypeMultipliers: Record<string, number>;
  /**
   * 时效性权重系数（0.5 = 弱化时效，1.5 = 强调时效）
   * 乘以 filterEvidenceForSection 中的 recency 分数贡献
   */
  freshnessBoostFactor: number;
}
