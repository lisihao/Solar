/**
 * AI Engine LLM Types
 *
 * 导出所有 LLM 相关的类型定义
 */

export type {
  // 核心类型
  TaskProfile,
  CreativityLevel,
  OutputLengthLevel,
  ReasoningDepth,
  TaskType,
  TaskKind,
  OutputFormat,
  ChatMessage,
  ContentPart,
  TextContentPart,
  ImageUrlContentPart,
} from "./task-profile.types";
export {
  // 映射常量
  CREATIVITY_TO_TEMPERATURE,
  OUTPUT_LENGTH_TO_TOKENS,
  REASONING_MODEL_MIN_TOKENS,
  REASONING_DEPTH_TO_EFFORT,
  reasoningDepthToEffort,
  safeReasoningEffort,
  isMinimalEffortSupported,
  getReasoningMinTokens,
  JSON_OUTPUT_MAX_TEMPERATURE,
  MODEL_KNOWN_LIMITS,
} from "./task-profile.types";

export { inferIsReasoning, getKnownModelLimit } from "./model.utils";

// 2026-05-10 §2/§4：单源 provider endpoint URL 归一化（chat + embedding + image）
export {
  ensureChatCompletionsPath,
  ensureMessagesPath,
  ensureCohereChatPath,
  ensureGeminiGenerateContentPath,
  ensureOpenAIEmbeddingsPath,
  ensureCohereEmbedPath,
  ensureGeminiBatchEmbedContentsPath,
  ensureGeminiEmbedContentPath,
  ensureOpenAIImagesGenerationsPath,
} from "./endpoint.utils";

// 2026-05-01 (PR-X-M2): AiCallerFn 通用 LLM 调用函数签名
export type { AiCallerFn } from "./ai-caller.types";
