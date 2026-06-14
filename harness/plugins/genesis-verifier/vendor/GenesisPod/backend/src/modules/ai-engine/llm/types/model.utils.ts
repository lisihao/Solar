/**
 * Model Utility Functions
 *
 * 纯函数工具集，用于模型属性推断和已知限制查询
 * 共享于 AiModelConfigService 和 TaskProfileMapperService
 */

import { MODEL_KNOWN_LIMITS } from "./task-profile.types";

/**
 * 根据模型名称推断是否为推理模型（启发式 fallback；最后兜底）。
 *
 * **v3.1 §D.2 (2026-05-24) 显式 fallback 警告**：
 *   - 调用方若手里有 `AIModelConfig`（DB 来源），必须先读 `config.isReasoning`：
 *     `const isReasoning = config.isReasoning ?? inferIsReasoning(config.modelId);`
 *   - 不允许在 DB 字段已存在时直接走启发式（会让 admin 在 DB 设的真值被
 *     启发式 substring 名单覆盖，造成行为漂移）。
 *   - 仅以下两种合法用例可直接调启发式（无 DB 配置）：
 *     1. 用户 BYOK 即兴模型（personal API key 路径，无 DB row）
 *     2. observability / sanity check（只有 model 字符串，无 config 对象）
 *
 * 启发式覆盖 OpenAI o1/o3/o4/gpt-5、Gemini 2.0/2.5/3、DeepSeek r1/reasoner、
 * Anthropic claude-3.5-opus/4、以及 reasoning/thinking 通用关键词。
 * 名单漂移由 v3 capability catalog（model-capability-catalog.ts）权威化中，
 * 长期目标是删除本函数；过渡期保留作 fallback。
 */
export function inferIsReasoning(modelId: string): boolean {
  if (!modelId) return false;
  const modelLower = modelId.toLowerCase();
  return (
    // OpenAI reasoning models (o1/o3/o4 families + gpt-5)
    modelLower.includes("o1") ||
    modelLower.includes("o3") ||
    modelLower.includes("o4") ||
    modelLower.includes("gpt-5") ||
    modelLower.includes("gpt5") ||
    // Google/Gemini reasoning models
    modelLower.includes("gemini-2.0-flash-thinking") ||
    modelLower.includes("gemini-2.5") || // gemini-2.5-pro / gemini-2.5-flash (thinking)
    modelLower.includes("gemini-3") || // gemini-3-pro-preview, etc.
    modelLower.includes("gemini-exp") ||
    // DeepSeek reasoning models
    modelLower.includes("deepseek-r1") ||
    modelLower.includes("deepseek-reasoner") ||
    // Anthropic reasoning models
    modelLower.includes("claude-3.5-opus") ||
    modelLower.includes("claude-4") ||
    // Generic reasoning keyword (exclude "non-reasoning" variants)
    (modelLower.includes("reasoning") &&
      !modelLower.includes("non-reasoning")) ||
    modelLower.includes("thinking")
  );
}

/**
 * 查询已知模型的实际最大 output tokens 限制
 * 使用有序前缀匹配（如 gpt-4o-mini 在 gpt-4o 之前）
 *
 * @returns 已知限制值，或 null（未知模型）
 */
export function getKnownModelLimit(modelId: string): number | null {
  if (!modelId) return null;
  const lower = modelId.toLowerCase();
  for (const [prefix, limit] of MODEL_KNOWN_LIMITS) {
    if (lower.startsWith(prefix)) return limit;
  }
  return null;
}
