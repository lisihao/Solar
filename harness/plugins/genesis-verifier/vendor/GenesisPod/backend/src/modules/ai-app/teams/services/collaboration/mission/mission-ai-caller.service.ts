/**
 * Mission AI Caller Service
 *
 * 负责基础 AI 调用相关的逻辑，从 TeamMissionService 中提取
 * - callAIWithConfig: 使用数据库配置调用 AI
 * - trackMissionTokens: 追踪 Token 消耗
 * - getModelConfig: 获取模型配置
 * - Creativity/OutputLength 映射
 *
 * 注：复杂的重试逻辑（含心跳、Agent 切换等）保留在主服务中
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChatFacade, ChatMessage } from "@/modules/ai-harness/facade";
import type {
  CreativityLevel,
  OutputLengthLevel,
} from "@/modules/ai-harness/facade";

/**
 * TaskProfile 直接配置（推荐方式）
 */
export interface TaskProfileOptions {
  creativity: CreativityLevel;
  outputLength: OutputLengthLevel;
}

/**
 * AI 调用选项
 *
 * 推荐使用 taskProfile 直接配置，避免硬编码数字参数：
 * - taskProfile: { creativity: "medium", outputLength: "long" } ✅ 推荐
 * - maxTokens/temperature: 仍支持但会被自动映射 ⚠️ 兼容
 */
export interface AICallOptions {
  /** 推荐：直接使用语义化的 TaskProfile */
  taskProfile?: TaskProfileOptions;
  /** @deprecated 使用 taskProfile.outputLength 替代 */
  maxTokens?: number;
  /** @deprecated 使用 taskProfile.creativity 替代 */
  temperature?: number;
  missionId?: string;
  enableSearch?: boolean;
}

/**
 * AI 调用结果
 */
export interface AICallResult {
  content: string;
  tokensUsed?: number;
}

@Injectable()
export class MissionAICallerService {
  private readonly logger = new Logger(MissionAICallerService.name);

  constructor(
    private prisma: PrismaService,
    private chatFacade: ChatFacade,
  ) {}

  // ==================== 模型配置 ====================

  /**
   * 获取 AI 模型配置
   * ★ 使用 AIFacade 替代直接访问 prisma.aIModel
   */
  async getModelConfig(aiModel: string) {
    const modelConfig = await this.chatFacade.getModelById(aiModel);

    if (!modelConfig) {
      this.logger.warn(`Model config not found for: ${aiModel}`);
      return null;
    }

    return modelConfig;
  }

  // ==================== AI 调用 ====================

  /**
   * 使用数据库配置调用 AI
   * 可选追踪 Mission Token 消耗
   */
  async callAIWithConfig(
    aiModel: string,
    messages: { role: string; content: string }[],
    systemPrompt: string,
    options?: AICallOptions,
  ): Promise<AICallResult> {
    const modelConfig = await this.getModelConfig(aiModel);

    // ★ 内部调用默认关闭网页搜索，避免任务修订等场景误触发搜索
    // searchOptions 暂不支持，后续可扩展 Facade

    // 构建消息列表，包含系统提示
    const facadeMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...(messages as { role: "user" | "assistant"; content: string }[]).map(
        (m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }),
      ),
    ];

    // ★ 优先使用直接传入的 taskProfile，否则从 legacy 参数映射
    const taskProfile = options?.taskProfile ?? {
      creativity: this.mapTemperatureToCreativity(options?.temperature),
      outputLength: this.mapMaxTokensToOutputLength(options?.maxTokens),
    };

    const result = await this.chatFacade.chat({
      messages: facadeMessages,
      model: modelConfig?.modelId ?? aiModel,
      taskProfile,
    });

    // ★ Track token consumption for mission
    const tokensUsed = result.tokensUsed || 0;
    if (options?.missionId && tokensUsed > 0) {
      this.trackMissionTokens(options.missionId, tokensUsed).catch((err) => {
        this.logger.warn(
          `[callAIWithConfig] Failed to track tokens for mission ${options.missionId}: ${err}`,
        );
      });
    }

    return result;
  }

  // ==================== Token 追踪 ====================

  /**
   * 追踪 Mission 的 Token 消耗
   * 使用原始 SQL 更新以支持尚未 regenerate 的 Prisma client
   */
  async trackMissionTokens(
    missionId: string,
    tokensUsed: number,
  ): Promise<void> {
    try {
      // 使用原始 SQL 更新，避免 Prisma client 未 regenerate 的问题
      await this.prisma.$executeRaw`
        UPDATE team_missions
        SET total_tokens_used = COALESCE(total_tokens_used, 0) + ${tokensUsed}
        WHERE id = ${missionId}
      `;
      this.logger.debug(
        `[trackMissionTokens] Added ${tokensUsed} tokens to mission ${missionId}`,
      );
    } catch (error) {
      this.logger.warn(
        `[trackMissionTokens] Failed to update tokens for mission ${missionId}: ${error}`,
      );
    }
  }

  // ==================== 映射工具方法 ====================

  /**
   * 映射 temperature 到 creativity level
   */
  mapTemperatureToCreativity(
    temperature?: number,
  ): "deterministic" | "low" | "medium" | "high" {
    if (temperature === undefined) return "medium";
    if (temperature <= 0.2) return "deterministic";
    if (temperature <= 0.5) return "low";
    if (temperature <= 0.8) return "medium";
    return "high";
  }

  /**
   * 映射 maxTokens 到 outputLength level
   */
  mapMaxTokensToOutputLength(
    maxTokens?: number,
  ): "minimal" | "short" | "medium" | "long" | "standard" | "extended" {
    if (maxTokens === undefined) return "medium";
    if (maxTokens <= 1000) return "minimal";
    if (maxTokens <= 2000) return "short";
    if (maxTokens <= 4000) return "medium";
    if (maxTokens <= 8000) return "long";
    if (maxTokens <= 12000) return "standard";
    return "extended";
  }
}
