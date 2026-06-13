/**
 * Leader Model Service
 *
 * 为 AI Teams Leader 提供模型选择和容错能力
 *
 * ★ 重构后：作为 AI Engine ModelFallbackService 的薄包装器
 *   - 保持原有接口不变（LeaderModelResult, LeaderModelOptions）
 *   - 委托给 ModelFallbackService 执行，使用 preferReasoning=true
 */

import { Injectable, Logger } from "@nestjs/common";
import type {
  ModelFallbackOptions,
  AIModelConfig,
} from "@/modules/ai-harness/facade";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIError } from "@/modules/ai-harness/facade";

// ==================== 类型定义 (保持原有接口) ====================

/**
 * Leader 模型执行结果
 * @deprecated 推荐直接使用 ModelFallbackResult
 */
export interface LeaderModelResult<T> {
  success: boolean;
  data?: T;
  error?: AIError;
  modelUsed: string;
  fallbackUsed: boolean;
  attempts: number;
  attemptedModels: string[];
}

/**
 * Leader 模型执行选项
 * @deprecated 推荐直接使用 ModelFallbackOptions
 */
export interface LeaderModelOptions {
  /** 最大重试次数（同一模型） */
  maxRetries?: number;
  /** 最大模型切换次数 */
  maxModelSwitches?: number;
  /** 操作描述（用于日志） */
  operation?: string;
  /** 上下文信息 */
  context?: {
    missionId?: string;
    taskId?: string;
  };
}

// ==================== 服务实现 ====================

/**
 * Leader 模型服务
 *
 * 提供推理模型优先的容错执行能力
 * 内部委托给 AI Engine 的 ModelFallbackService
 */
@Injectable()
export class LeaderModelService {
  private readonly logger = new Logger(LeaderModelService.name);

  constructor(private readonly chatFacade: ChatFacade) {
    this.logger.log(
      "[LeaderModelService] Initialized (delegating to ModelFallbackService via ChatFacade)",
    );
  }

  /**
   * 获取推理模型降级链
   * 返回按优先级排序的可用推理模型列表
   */
  async getReasoningModelFallbackChain(
    excludeModels: string[] = [],
  ): Promise<AIModelConfig[]> {
    if (!this.chatFacade.modelFallback) {
      this.logger.warn(
        "[LeaderModelService] modelFallback not available, returning empty chain",
      );
      return [];
    }
    return this.chatFacade.modelFallback.getModelFallbackChain({
      preferReasoning: true,
      excludeModels,
    });
  }

  /**
   * 带重试和模型切换的 Leader AI 调用
   *
   * @param preferredModelId 首选模型 ID
   * @param executor 执行函数，接收模型配置，返回执行结果
   * @param options 执行选项
   */
  async executeWithFallback<T>(
    preferredModelId: string,
    executor: (modelConfig: AIModelConfig) => Promise<T>,
    options: LeaderModelOptions = {},
  ): Promise<LeaderModelResult<T>> {
    const { maxRetries, maxModelSwitches, operation, context } = options;

    // 转换为 ModelFallbackOptions
    const fallbackOptions: ModelFallbackOptions = {
      maxRetries,
      maxModelSwitches,
      operation: operation || "leader_call",
      preferReasoning: true, // Leader 始终优先使用推理模型
      context,
    };

    // 委托给 ModelFallbackService (通过 AIFacade)
    if (!this.chatFacade.modelFallback) {
      throw new Error("ModelFallbackService is not available via AIFacade");
    }
    const result = await this.chatFacade.modelFallback.executeWithFallback(
      preferredModelId,
      executor,
      fallbackOptions,
    );

    // 结果类型完全兼容，直接返回
    return result as LeaderModelResult<T>;
  }

  /**
   * 获取单个模型配置
   */
  async getModelConfig(modelId: string): Promise<AIModelConfig | null> {
    if (!this.chatFacade.modelFallback) {
      this.logger.warn(
        "[LeaderModelService] modelFallback not available, cannot get model config",
      );
      return null;
    }
    return this.chatFacade.modelFallback.getModelConfig(modelId);
  }

  /**
   * 检查模型是否为需要切换的错误类型
   */
  shouldSwitchModel(error: AIError): boolean {
    if (!this.chatFacade.modelFallback) {
      this.logger.warn(
        "[LeaderModelService] modelFallback not available, defaulting shouldSwitchModel to false",
      );
      return false;
    }
    return this.chatFacade.modelFallback.shouldSwitchModel(error);
  }
}
