/**
 * Writing Model Manager Service
 *
 * 负责 AI 模型配置、角色分配和模型管理。
 *
 * 核心职责：
 * 1. 获取和缓存可用的 AI 模型列表
 * 2. 为 Writing Agents 分配最优模型
 * 3. 模型多元化策略，减少盲区
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

/**
 * AI 模型配置信息
 */
export interface ModelConfig {
  modelId: string;
  displayName: string;
  provider: string;
  apiKey?: string;
  apiEndpoint?: string;
  isReasoning: boolean;
}

/**
 * 角色模型分配结果
 */
export interface RoleModelAssignment {
  roleId: string;
  modelId: string;
  isActive: boolean;
}

@Injectable()
export class WritingModelManager {
  private readonly logger = new Logger(WritingModelManager.name);

  // 模型配置缓存
  private cachedModels: ModelConfig[] | null = null;
  private modelCacheTime: number = 0;
  private readonly MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 分钟

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 获取可用的 AI 模型列表
   * 从数据库查询已启用的模型
   */
  async getAvailableModels(): Promise<ModelConfig[]> {
    const now = Date.now();

    // 检查缓存
    if (this.cachedModels && now - this.modelCacheTime < this.MODEL_CACHE_TTL) {
      return this.cachedModels;
    }

    try {
      // 使用 AIFacade 获取模型列表
      const models = await this.chatFacade.getAvailableModelsExtended(
        AIModelType.CHAT,
      );

      // 转换为 ModelConfig 并排除 xAI 模型
      this.cachedModels = models
        .filter((m) => m.provider !== "xAI") // 排除 xAI 模型（grok）
        .map((m) => ({
          modelId: m.id,
          displayName: m.name,
          provider: m.provider,
          isReasoning: m.isReasoning || false,
        }));

      this.modelCacheTime = now;

      this.logger.log(
        `Loaded ${this.cachedModels.length} AI models, ` +
          `${this.cachedModels.filter((m) => m.isReasoning).length} with reasoning capability`,
      );

      return this.cachedModels;
    } catch (error) {
      this.logger.error(
        `Failed to load AI models: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * 为各角色分配 AI 模型
   * 策略：模型多元化，减少盲区
   * - Leader (story-architect): 优先使用推理模型
   * - Keeper (bible-keeper): 使用擅长知识管理的模型
   * - Writer: 使用擅长创意的模型
   * - Checker: 使用擅长分析的模型
   * - Editor: 使用擅长润色的模型
   *
   * 当模型数量有限时，尽量轮换使用不同模型
   */
  async assignModelsToRoles(): Promise<RoleModelAssignment[]> {
    const models = await this.getAvailableModels();

    if (models.length === 0) {
      this.logger.warn("No AI models available, all roles will be inactive");
      return [
        { roleId: "story-architect", modelId: "", isActive: false },
        { roleId: "bible-keeper", modelId: "", isActive: false },
        { roleId: "writer", modelId: "", isActive: false },
        { roleId: "consistency-checker", modelId: "", isActive: false },
        { roleId: "editor", modelId: "", isActive: false },
      ];
    }

    // 分离推理模型和聊天模型
    const reasoningModels = models.filter((m) => m.isReasoning);
    const chatModelCount = models.filter((m) => !m.isReasoning).length;
    this.logger.debug(
      `Available models: ${reasoningModels.length} reasoning, ${chatModelCount} chat`,
    );

    // 模型多元化分配
    // 5 个角色，尽量使用不同的模型
    const roleModelMap: Record<string, ModelConfig> = {};

    // 1. Leader (story-architect): 必须用推理模型（如果有）
    roleModelMap["story-architect"] =
      reasoningModels.length > 0 ? reasoningModels[0] : models[0];

    // 2. 其他角色：从剩余模型中轮换选择，尽量多元化
    const memberRoles = [
      "bible-keeper",
      "writer",
      "consistency-checker",
      "editor",
    ];
    const availableForMembers = models.filter(
      (m) => m.modelId !== roleModelMap["story-architect"].modelId,
    );

    // 如果过滤后没有剩余模型，就用全部模型
    const poolForMembers =
      availableForMembers.length > 0 ? availableForMembers : models;

    // 按照提供商分组，优先跨提供商分配（更多元化）
    const byProvider = new Map<string, ModelConfig[]>();
    for (const m of poolForMembers) {
      if (!byProvider.has(m.provider)) {
        byProvider.set(m.provider, []);
      }
      byProvider.get(m.provider)!.push(m);
    }

    // 轮换分配模型给成员角色
    const providers = Array.from(byProvider.keys());
    let providerIndex = 0;
    let modelIndexInProvider = 0;

    for (const roleId of memberRoles) {
      if (providers.length === 0) {
        // 没有模型可用
        roleModelMap[roleId] = poolForMembers[0] || models[0];
      } else if (providers.length === 1) {
        // 只有一个提供商，轮换该提供商的模型
        const providerModels = byProvider.get(providers[0])!;
        roleModelMap[roleId] =
          providerModels[modelIndexInProvider % providerModels.length];
        modelIndexInProvider++;
      } else {
        // 多个提供商，跨提供商轮换
        const currentProvider = providers[providerIndex % providers.length];
        const providerModels = byProvider.get(currentProvider)!;
        roleModelMap[roleId] = providerModels[0]; // 每个提供商取第一个模型
        providerIndex++;
      }
    }

    // 记录分配结果
    this.logger.log("Model assignment (diversified):");
    for (const [roleId, model] of Object.entries(roleModelMap)) {
      this.logger.log(
        `  - ${roleId}: ${model.displayName} (${model.provider}, reasoning=${model.isReasoning})`,
      );
    }

    // 统计使用的不同模型数量
    const uniqueModels = new Set(
      Object.values(roleModelMap).map((m) => m.modelId),
    );
    this.logger.log(
      `Using ${uniqueModels.size} different models for ${Object.keys(roleModelMap).length} roles`,
    );

    return Object.entries(roleModelMap).map(([roleId, model]) => ({
      roleId,
      modelId: model.modelId,
      isActive: true,
    }));
  }

  /**
   * 获取活跃的角色列表
   * 只返回有可用模型的角色
   */
  async getActiveRoles(): Promise<string[]> {
    const assignments = await this.assignModelsToRoles();
    return assignments.filter((a) => a.isActive).map((a) => a.roleId);
  }

  /**
   * 获取角色对应的模型 ID
   */
  async getModelForRole(roleId: string): Promise<string | null> {
    const assignments = await this.assignModelsToRoles();
    const assignment = assignments.find((a) => a.roleId === roleId);
    return assignment?.isActive ? assignment.modelId : null;
  }

  /**
   * 清除模型缓存（用于配置更新后）
   */
  clearCache(): void {
    this.cachedModels = null;
    this.modelCacheTime = 0;
    this.logger.log("Model cache cleared");
  }
}
