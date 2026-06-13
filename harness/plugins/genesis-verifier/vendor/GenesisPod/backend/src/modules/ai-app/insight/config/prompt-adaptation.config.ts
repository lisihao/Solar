/**
 * Prompt Adaptation Configuration
 *
 * Per-tier 的 prompt modifier 和 taskProfile override，
 * 使不同能力层级的模型都能产出高质量内容。
 */

import type { TaskProfile } from "@/modules/ai-harness/facade";
import { ModelTier } from "./model-tier.config";

export interface TierAdaptation {
  /** 追加到 userPrompt 末尾的额外指令（空字符串=不修改） */
  promptSuffix: string;
  /** 最大证据条目数（0=不限） */
  maxEvidenceItems: number;
  /** 覆盖的 taskProfile */
  taskProfile: Pick<TaskProfile, "creativity" | "outputLength">;
}

export const TIER_ADAPTATIONS: Record<ModelTier, TierAdaptation> = {
  [ModelTier.STRONG]: {
    promptSuffix: [
      "",
      "【高级分析模式】",
      "- 鼓励跨来源综合推理，揭示不同数据源之间的关联和矛盾",
      "- 可以做出大胆但有证据支撑的预测和趋势判断",
      "- 注重洞察的原创性：避免仅重复来源观点，要提出独立分析",
      "- 对数据背后的因果关系进行深层解读",
    ].join("\n"),
    maxEvidenceItems: 0, // 不限
    taskProfile: {
      creativity: "medium",
      outputLength: "long",
    },
  },

  [ModelTier.STANDARD]: {
    promptSuffix: "", // 不修改，保持基线行为
    maxEvidenceItems: 0,
    taskProfile: {
      creativity: "medium",
      outputLength: "long",
    },
  },

  [ModelTier.BASIC]: {
    promptSuffix: [
      "",
      "【结构化写作模式】",
      "- 严格按要点顺序逐一展开，每段只阐述一个核心观点",
      "- 每段末尾用一句话小结该段要点",
      "- 优先引用直接相关的证据，避免过度推理",
      "- 使用清晰的过渡句连接段落",
      "- 确保每个论点都有明确的证据支撑",
    ].join("\n"),
    maxEvidenceItems: 8,
    taskProfile: {
      creativity: "low",
      outputLength: "long",
    },
  },
};


