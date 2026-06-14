/**
 * AI Chat Model Config Service —— v3.1 A0 阶段 thin wrapper
 *
 * @deprecated v3.1 A0：本 service 已弃用。所有消费方应改用
 * {@link AiModelConfigService}（`./ai-model-config.service`），后者是 BYOK +
 * structured-output capability + ApiKey 解析的单一权威源（canonical）。
 *
 * 本类临时保留为薄包装：所有 public 方法委托给注入的 `AiModelConfigService`，
 * 自身不再维护独立的 `modelConfigCache` 与缓存刷新逻辑——**双缓存/双源行为
 * 已被消除**，只保留 API surface 兼容供历史 import 点继续编译通过。
 *
 * 计划：v3.1 F 阶段（消费方全部迁移完毕后）整文件删除，同步删除
 * `services/index.ts` 中的 `AiChatModelConfigService` re-export。
 *
 * 迁移指引：
 *   - 旧：`constructor(private readonly cfg: AiChatModelConfigService) {}`
 *   - 新：`constructor(private readonly cfg: AiModelConfigService) {}`
 *   方法名/签名保持一致，无需改调用处。
 *
 * ⚠️ A0 行为漂移声明（A0 review reviewer 发现，与 A0 前 self-managed 实现相比）：
 *   1. `refreshModelConfigCache()`：**delegate 现加载全部 modelType**
 *      （EMBEDDING/IMAGE/CHAT/…），而非旧 wrapper 的 `modelType:"CHAT"` 单类型。
 *      生产无 wrapper 消费方，影响仅限本 wrapper 测试 mock 矩阵。
 *   2. `getDefaultModelConfig()`：**始终走 DB findFirst，不读 cache**（原 wrapper
 *      先 scan cache 找 isDefault 再 fallback DB）。每次调用增加 1 次 DB 查询，
 *      但对调用方等价（都返回 default CHAT 模型）。
 *   3. `getDefaultModelByType()` / `getAllEnabledModelsByType()`：`RequestContext`
 *      含 userId 时**走严格 BYOK 路径**（2026-05-12 政策），无 UserModelConfig
 *      则返回 null/[]，不再回退 admin AIModel。原 wrapper 始终走 admin 兜底。
 *      **影响**：wrapper 现无生产消费方；若未来误用者依赖 admin 兜底，语义会变。
 *
 * 上述漂移符合 v3.1 D7 / 严格 BYOK 政策方向，不视为 A0 回归；F 阶段删 wrapper 时一并消失。
 */

import { Injectable } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import {
  AiModelConfigService,
  type AIModelConfig,
} from "../models/config/ai-model-config.service";

// v3.1 A0：interface 单一源已迁至 types/model-config.types.ts；本文件 re-export
// 保持下游 `import { AIModelConfig } from ".../ai-chat-model-config.service"`
// 仍可编译。新代码请直接从 `./ai-model-config.service` 或 `../types` 引用。
export type { AIModelConfig };

/**
 * @deprecated v3.1 A0：请用 {@link AiModelConfigService}。
 */
@Injectable()
export class AiChatModelConfigService {
  constructor(private readonly delegate: AiModelConfigService) {}

  /**
   * 获取模型的 API Key（系统 Secret 路径，无用户上下文）。
   */
  async getApiKeyForModel(model: AIModelConfig): Promise<string | null> {
    return this.delegate.getApiKeyForModel(model);
  }

  /**
   * 根据 provider 推断 API 格式。
   * 委托给 canonical service 的 public 同义方法 getApiFormatForProvider。
   */
  inferApiFormat(provider: string): string {
    return this.delegate.getApiFormatForProvider(provider);
  }

  /**
   * 刷新模型配置缓存（委托给 canonical service 的单缓存）。
   */
  async refreshModelConfigCache(): Promise<void> {
    return this.delegate.refreshModelConfigCache();
  }

  /**
   * 检查模型是否为推理模型。
   */
  isReasoningModel(modelId: string): boolean {
    return this.delegate.isReasoningModel(modelId);
  }

  /**
   * 获取模型配置（优先从数据库，缓存 5 分钟）。
   */
  async getModelConfig(modelId: string): Promise<AIModelConfig | null> {
    return this.delegate.getModelConfig(modelId);
  }

  /**
   * 获取默认模型配置。
   */
  async getDefaultModelConfig(): Promise<AIModelConfig | null> {
    return this.delegate.getDefaultModelConfig();
  }

  /**
   * 根据模型类型获取默认模型。
   */
  async getDefaultModelByType(
    modelType: AIModelType,
  ): Promise<AIModelConfig | null> {
    return this.delegate.getDefaultModelByType(modelType);
  }

  /**
   * 获取所有启用的模型（按类型）。
   */
  async getAllEnabledModelsByType(
    modelType: AIModelType,
    excludeModelIds: string[] = [],
  ): Promise<AIModelConfig[]> {
    return this.delegate.getAllEnabledModelsByType(modelType, excludeModelIds);
  }

  /**
   * 检查 Temperature 参数是否支持（同步）。
   * 委托给 canonical service 的同步 cache 读取实现。
   */
  isTemperatureSupported(model: string): boolean {
    return this.delegate.isTemperatureSupported(model);
  }
}
