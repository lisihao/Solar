import type { ModelCapabilitiesOverrides } from "../models/capability/model-capability.types";

/**
 * AI Model Config —— v3.1 A0 阶段：AIModelConfig **单一源**。
 *
 * 合并自原双源：
 *   - 原 #1（旧/精简版，12 字段）：
 *     `modules/ai-engine/llm/services/ai-chat-model-config.service.ts:11-37`
 *   - 原 #2（canonical/超集版，19 字段，含 7 个 v3.x structured-output 扩展）：
 *     `modules/ai-engine/llm/models/config/ai-model-config.service.ts:55-92`
 *
 * 合并策略：保留 canonical 超集；旧文件改为 thin wrapper（委托给
 * `AiModelConfigService`），所有 import 点经 A0 期间收敛到本文件。
 *
 * 演进策略：
 *   - 阶段 A：可在此扩 capability 新字段（增量、向后兼容）
 *   - 阶段 D6：删除 5 个 `supports_json_*` bool 字段（structured-output 收口到
 *     `structuredOutputStrategy` + `fallbackStrategies` 两个字段后）
 *   - 阶段 G：评估是否把 `apiKey: string | null` 彻底下沉到 `ResolvedApiKey`
 *     resolver 流水（admin 兼容字段下线）
 *
 * **同时声明 BYOK ApiKey 解析相关类型**（与 `AIModelConfig` 紧密耦合，
 * 共同表达"模型 + 它的 key 来源"的领域语义）。
 */

/**
 * API Key 来源标识
 * personal: 用户自用 Key（不扣积分）
 * assigned: 管理员授权分配的 Key（来自 key_assignments，扣积分）
 *           ★ 2026-05-29 W4a：原误名 "donated"（实为 ASSIGNED 来源），归一为 "assigned"。
 * system:   系统管理员配置 Key（扣积分）
 */
export type ApiKeySource = "personal" | "assigned" | "system";

export interface ResolvedApiKey {
  apiKey: string;
  source: ApiKeySource;
  apiEndpoint?: string | null;
  /**
   * PR-4 (2026-05-05) BYOK failover：KeyHealth 命名空间下的统一标识。
   * 调用方应在 callFn 调用前后做 markFailure / markSuccess。
   * SYSTEM key 路径（无 userId）不返回此字段。
   */
  healthKeyId?: string;
}

/**
 * 数据库中的 AI 模型配置
 * ★ 所有模型行为完全由数据库配置驱动，消除硬编码
 */
export interface AIModelConfig {
  id: string;
  name: string;
  displayName: string;
  provider: string;
  modelId: string;
  apiEndpoint: string;
  apiKey: string | null;
  secretKey?: string | null; // 引用 Secret Manager 中的密钥名称
  /**
   * 2026-05-28 BYOK：用户为该模型显式指定的 UserApiKey.id。
   * runtime resolveApiKey 会用这把具体的 Key 解析；null = 按 provider 默认解析
   * （用户 personal key 中 label 字典序第一）。
   */
  apiKeyId?: string | null;
  maxTokens: number;
  temperature: number;
  isEnabled: boolean;
  isDefault: boolean;

  // ★ 模型能力配置 - 完全由数据库驱动
  isReasoning?: boolean; // 是否为推理模型
  apiFormat?: string; // API 格式: openai, anthropic, google, xai
  supportsTemperature?: boolean; // 是否支持 temperature 参数
  supportsStreaming?: boolean; // 是否支持流式输出
  supportsFunctionCalling?: boolean; // 是否支持函数调用
  supportsVision?: boolean; // 是否支持视觉输入
  tokenParamName?: string; // token 参数名: max_tokens 或 max_completion_tokens
  defaultTimeoutMs?: number; // 默认超时时间
  priceInputPerMillion?: number; // 输入价格
  priceOutputPerMillion?: number; // 输出价格
  priority?: number; // 模型优先级

  // ★ 2026-05-06 Structured Output capability matrix
  // 由 StructuredOutputRouter.resolveChain(model) 消费，未配置时按 provider slug
  // 自动推断默认链。详见 ai-engine/llm/output/structured/。
  structuredOutputStrategy?: string | null;
  fallbackStrategies?: string[];
  supportsJsonSchemaStrict?: boolean;
  supportsJsonSchema?: boolean;
  supportsToolUse?: boolean;
  supportsJsonMode?: boolean;
  supportsGbnfGrammar?: boolean;

  // ★ v3.1 §3.4 优先级 #2：admin 显式 override（B 阶段 admin UI 写入
  //   ai_models.capability_overrides JSONB 列）。
  //   B.2 起：由 buildModelConfig 经 ModelCapabilitiesOverridesSchema.safeParse
  //   严校后填入；null/无效 → undefined（ModelCapabilityService 走下一级回退）。
  //   类型用 ModelCapabilitiesOverrides（zod deep-partial），结构上是 ModelCapabilities
  //   的深部分子集，比 Partial<ModelCapabilities>（只浅层 optional）更准确表达覆盖语义。
  aiModelOverrides?: ModelCapabilitiesOverrides;

  // ★ v3.1 §3.4 优先级 #1：BYOK 用户 override（B 阶段 user UI 写入
  //   user_model_configs.capability_overrides JSONB 列）。
  //   B.2 起：由 toAIModelConfigFromUserConfig 经 ModelCapabilitiesOverridesSchema.safeParse
  //   严校后填入；null/无效 → undefined（走 admin → catalog 回退）。
  userOverrides?: ModelCapabilitiesOverrides;
}
