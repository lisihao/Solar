/**
 * Model Tier Configuration
 *
 * 按模型 ID 正则分类为 3 个 tier，用于写前模型自适应。
 * 纯函数，无 DI 依赖。
 */

export enum ModelTier {
  STRONG = "STRONG",
  STANDARD = "STANDARD",
  BASIC = "BASIC",
}

/** STRONG tier: 高端模型，更高分析自由度 */
const STRONG_PATTERNS = [
  /claude-sonnet-4/i,
  /claude-opus/i,
  /gpt-4o(?!-mini)/i,
  /gpt-4\.1(?!-mini|-nano)/i,
  /o[134]-/i, // o1, o3, o4 reasoning models
  /gemini-2.*pro/i,
  /gemini-2\.5-flash/i,
  /gemini-3/i,
  /grok-(?:3|4(?:[-.]1)?)(?!-mini)/i,
  /deepseek-r1/i,
  /deepseek-v3/i,
  /deepseek-v4(?!-flash)/i,
];

/** STANDARD tier: 中端模型，基线行为 */
const STANDARD_PATTERNS = [
  /gpt-4o-mini/i,
  /gpt-4\.1-mini/i,
  /claude-haiku/i,
  /gemini-2.*flash(?!-thinking)/i,
  /grok-3-mini/i,
  /deepseek-v4-flash/i,
];

/**
 * 根据模型 ID 判断模型所属 tier
 *
 * 优先匹配 STRONG → STANDARD → 默认 BASIC
 */
export function classifyModelTier(modelId: string): ModelTier {
  if (!modelId) return ModelTier.BASIC;

  for (const pattern of STRONG_PATTERNS) {
    if (pattern.test(modelId)) return ModelTier.STRONG;
  }
  for (const pattern of STANDARD_PATTERNS) {
    if (pattern.test(modelId)) return ModelTier.STANDARD;
  }

  return ModelTier.BASIC;
}
