import { Injectable, Logger } from "@nestjs/common";
import {
  TaskProfile,
  CreativityLevel,
  OutputLengthLevel,
  ReasoningDepth,
  CREATIVITY_TO_TEMPERATURE,
  OUTPUT_LENGTH_TO_TOKENS,
  getReasoningMinTokens,
  JSON_OUTPUT_MAX_TEMPERATURE,
  getKnownModelLimit,
} from "../types";
import { AIModelConfig } from "./ai-chat.service";

/**
 * TaskProfile 参数映射结果
 */
export interface MappedParameters {
  temperature: number;
  maxTokens: number;
  /** Mapped reasoning depth for API callers (only set when model isReasoning AND profile has reasoningDepth) */
  reasoningDepth?: ReasoningDepth;
}

/**
 * TaskProfileMapperService - 将语义化任务配置映射为模型参数
 *
 * 职责：
 * - 将 TaskProfile 的语义化描述映射为具体的模型参数
 * - 根据模型特性（如推理模型）自动调整参数
 * - 处理输出格式对参数的影响
 *
 * 这是 AI Engine 中唯一了解模型参数细节的服务，
 * AI App 层不应直接操作 temperature/maxTokens
 */
@Injectable()
export class TaskProfileMapperService {
  private readonly logger = new Logger(TaskProfileMapperService.name);

  /** 已警告过的模型硬限制，避免日志洪水 */
  private readonly warnedHardCaps = new Set<string>();

  /**
   * 将 TaskProfile 映射为具体模型参数
   *
   * @param profile 任务配置
   * @param modelConfig 模型配置（用于获取 isReasoning、maxTokens 上限等）
   * @returns 映射后的参数
   */
  mapToParameters(
    profile: TaskProfile | undefined,
    modelConfig: AIModelConfig | null,
  ): MappedParameters {
    // 如果没有 profile，返回模型默认值或系统默认值
    if (!profile) {
      const defaultParams = {
        temperature: modelConfig?.temperature ?? 0.7,
        maxTokens: modelConfig?.maxTokens ?? 4096,
      };
      this.logger.debug(
        `[mapToParameters] No TaskProfile provided, using defaults: ` +
          `temp=${defaultParams.temperature}, maxTokens=${defaultParams.maxTokens}`,
      );
      return defaultParams;
    }

    // 1. 基础映射
    const baseTemperature = this.mapCreativityToTemperature(profile.creativity);
    const baseMaxTokens = this.mapOutputLengthToTokens(profile.outputLength);

    this.logger.debug(
      `[mapToParameters] Base mapping: ` +
        `creativity=${profile.creativity ?? "default"} → temp=${baseTemperature}, ` +
        `outputLength=${profile.outputLength ?? "default"} → tokens=${baseMaxTokens}`,
    );

    // 2. 推理模型调整
    // ★ 推理模型需要大量额外 tokens 用于内部 Chain of Thought
    // 实际输出可能只占 completion_tokens 的 10-20%
    const isReasoning = modelConfig?.isReasoning ?? false;
    const modelMaxTokens = modelConfig?.maxTokens;
    let effectiveMaxTokens = baseMaxTokens;

    if (isReasoning) {
      const originalTokens = effectiveMaxTokens;

      // ★ 根据 outputLength 分级计算推理模型 token 需求
      // 推理模型内部 CoT 消耗大量 tokens，但 minimal/short 场景不需要满额
      const reasoningMin = getReasoningMinTokens(modelMaxTokens);
      if (
        profile.outputLength === "minimal" ||
        profile.outputLength === "short"
      ) {
        // minimal/short 分档上限：统一 0.5 倍率 + 16000 上限会把分类/标签类任务
        // （minimal 500）也推到 12500，模型把预算全花在长推理上（2026-06-10 日志实测）。
        // minimal=分类/提取（CoT 2-3k + visible <1k 足够）；short=摘要（CoT 5-6k + visible 1.5k）。
        const boostCap = profile.outputLength === "minimal" ? 4000 : 8000;
        const scaledMin = Math.min(Math.ceil(reasoningMin * 0.5), boostCap);
        effectiveMaxTokens = Math.max(baseMaxTokens, scaledMin);
      } else {
        effectiveMaxTokens = Math.max(baseMaxTokens, reasoningMin);
      }

      // 对于 extended/long 输出，如果模型有足够空间才提升
      if (
        profile.outputLength === "extended" &&
        (!modelMaxTokens || modelMaxTokens >= 32000)
      ) {
        effectiveMaxTokens = Math.max(effectiveMaxTokens, 32000);
      } else if (
        profile.outputLength === "long" &&
        (!modelMaxTokens || modelMaxTokens >= 28000)
      ) {
        effectiveMaxTokens = Math.max(effectiveMaxTokens, 28000);
      }

      if (effectiveMaxTokens !== originalTokens) {
        this.logger.log(
          `[mapToParameters] ★ Reasoning model token boost: ` +
            `${originalTokens} → ${effectiveMaxTokens} tokens ` +
            `(outputLength=${profile.outputLength || "default"}, modelMax=${modelMaxTokens ?? "unknown"})`,
        );
      }
    }

    // 3. 处理模型配置的最大值（推理/非推理统一逻辑）
    if (modelMaxTokens && effectiveMaxTokens > modelMaxTokens) {
      this.logger.debug(
        `[mapToParameters] Capping tokens at model max: ` +
          `${effectiveMaxTokens} → ${modelMaxTokens} (${modelConfig?.modelId})`,
      );
      effectiveMaxTokens = modelMaxTokens;
    }

    // 4. 硬限制兜底：基于已知模型的实际 API 限制
    const knownLimit = getKnownModelLimit(modelConfig?.modelId ?? "");
    if (knownLimit && effectiveMaxTokens > knownLimit) {
      const warnKey = modelConfig?.modelId ?? "";
      if (!this.warnedHardCaps.has(warnKey)) {
        this.logger.warn(
          `[mapToParameters] Hard cap: ${effectiveMaxTokens} -> ${knownLimit} ` +
            `(${modelConfig?.modelId} known API limit). Update maxTokens in database.`,
        );
        this.warnedHardCaps.add(warnKey);
      }
      effectiveMaxTokens = knownLimit;
    }

    // 5. JSON 格式需要更低 temperature（Phase 2 完整实现）
    let effectiveTemperature = baseTemperature;
    if (profile.outputFormat === "json") {
      const originalTemp = effectiveTemperature;
      effectiveTemperature = Math.min(
        effectiveTemperature,
        JSON_OUTPUT_MAX_TEMPERATURE,
      );
      if (effectiveTemperature !== originalTemp) {
        this.logger.debug(
          `[mapToParameters] JSON output format adjustment: ` +
            `temp ${originalTemp} → ${effectiveTemperature}`,
        );
      }
    }

    // 6. 记录最终结果
    this.logger.debug(
      `[mapToParameters] Final parameters: ` +
        `temp=${effectiveTemperature}, maxTokens=${effectiveMaxTokens} ` +
        `(profile: ${JSON.stringify(profile)}, isReasoning=${isReasoning})`,
    );

    // 7. Pass through reasoning depth (only meaningful for reasoning models)
    const mappedReasoningDepth =
      isReasoning && profile.reasoningDepth
        ? profile.reasoningDepth
        : undefined;

    // If deep reasoning requested, ensure sufficient tokens
    if (mappedReasoningDepth === "deep" && effectiveMaxTokens < 32000) {
      const boosted = Math.min(32000, modelMaxTokens || 32000);
      if (boosted > effectiveMaxTokens) {
        this.logger.log(
          `[mapToParameters] Deep reasoning token boost: ${effectiveMaxTokens} -> ${boosted}`,
        );
        effectiveMaxTokens = boosted;
      }
    }

    return {
      temperature: effectiveTemperature,
      maxTokens: effectiveMaxTokens,
      reasoningDepth: mappedReasoningDepth,
    };
  }

  /**
   * 将创意度等级映射为 temperature
   */
  private mapCreativityToTemperature(
    level: CreativityLevel | undefined,
  ): number {
    if (!level) {
      return 0.7; // 默认中等创意度
    }
    return CREATIVITY_TO_TEMPERATURE[level];
  }

  /**
   * 将输出长度等级映射为 maxTokens
   */
  private mapOutputLengthToTokens(
    level: OutputLengthLevel | undefined,
  ): number {
    if (!level) {
      return 4096; // 默认中等长度
    }
    return OUTPUT_LENGTH_TO_TOKENS[level];
  }
}
