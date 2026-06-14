/**
 * Default tier-suffix mapping.
 *
 * STRONG: trust the model, no extra suffix.
 * STANDARD: remind of structure and schema adherence.
 * BASIC: tight guardrails — schema-only output, no preamble.
 */

import { ModelTier } from "../types/model-tier.types";

import type { TierSuffix } from "./types";

export const TIER_SUFFIX_DEFAULTS: readonly TierSuffix[] = [
  { tier: ModelTier.STRONG, suffix: "" },
  {
    tier: ModelTier.STANDARD,
    suffix: [
      "",
      "",
      "## 输出约束（STANDARD tier）",
      "- 严格遵循 schema，不添加 schema 外字段。",
      "- 复杂任务请分步推理后再给出最终答案。",
    ].join("\n"),
  },
  {
    tier: ModelTier.BASIC,
    suffix: [
      "",
      "",
      "## 严格约束（BASIC tier）",
      "- 仅输出 schema 要求的 JSON，不写前言、解释或 markdown fence。",
      "- 保留英文字段名，值使用简单直接的语言。",
      "- 若任务复杂请先内部分解，但最终只输出结果。",
    ].join("\n"),
  },
];
