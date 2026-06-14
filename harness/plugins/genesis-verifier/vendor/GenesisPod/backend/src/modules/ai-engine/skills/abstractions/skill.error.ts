/**
 * AI Engine - Skill Error
 * 技能错误类
 */

import { JsonObject } from "@/modules/ai-engine/facade/abstractions/common.types";
import { EngineError } from "@/modules/ai-engine/facade/abstractions/engine.error";
import { SkillErrorCode } from "@/modules/ai-engine/facade/abstractions/error-codes.constants";

/**
 * 技能错误
 */
export class SkillError extends EngineError {
  /**
   * 技能 ID
   */
  readonly skillId?: string;

  /**
   * 技能名称
   */
  readonly skillName?: string;

  /**
   * 所属层次
   */
  readonly layer?: string;

  constructor(
    message: string,
    code: string = SkillErrorCode.UNKNOWN,
    options?: {
      skillId?: string;
      skillName?: string;
      layer?: string;
      details?: JsonObject;
      cause?: Error;
      retryable?: boolean;
    },
  ) {
    const details: JsonObject = { ...options?.details };
    if (options?.skillId) details.skillId = options.skillId;
    if (options?.skillName) details.skillName = options.skillName;
    if (options?.layer) details.layer = options.layer;

    super(message, code, {
      details: Object.keys(details).length > 0 ? details : undefined,
      cause: options?.cause,
      retryable: options?.retryable,
    });
    this.skillId = options?.skillId;
    this.skillName = options?.skillName;
    this.layer = options?.layer;
  }

  /**
   * 技能未找到
   */
  static notFound(skillId: string): SkillError {
    return new SkillError(
      `Skill '${skillId}' not found`,
      SkillErrorCode.NOT_FOUND,
      { skillId, retryable: false },
    );
  }

  /**
   * 技能未注册
   */
  static notRegistered(skillId: string): SkillError {
    return new SkillError(
      `Skill '${skillId}' is not registered`,
      SkillErrorCode.NOT_REGISTERED,
      { skillId, retryable: false },
    );
  }

  /**
   * 前置条件失败
   */
  static preconditionFailed(skillId: string, reason: string): SkillError {
    return new SkillError(
      `Precondition failed for skill '${skillId}': ${reason}`,
      SkillErrorCode.PRECONDITION_FAILED,
      { skillId, details: { reason }, retryable: false },
    );
  }

  /**
   * 缺少工具
   */
  static missingTool(skillId: string, toolId: string): SkillError {
    return new SkillError(
      `Skill '${skillId}' requires tool '${toolId}' which is not available`,
      SkillErrorCode.MISSING_TOOL,
      { skillId, details: { toolId }, retryable: false },
    );
  }

  /**
   * 缺少技能
   */
  static missingSkill(skillId: string, requiredSkillId: string): SkillError {
    return new SkillError(
      `Skill '${skillId}' requires skill '${requiredSkillId}' which is not available`,
      SkillErrorCode.MISSING_SKILL,
      { skillId, details: { requiredSkillId }, retryable: false },
    );
  }

  /**
   * 执行失败
   */
  static executionFailed(
    skillId: string,
    reason: string,
    cause?: Error,
  ): SkillError {
    return new SkillError(
      `Skill '${skillId}' execution failed: ${reason}`,
      SkillErrorCode.EXECUTION_FAILED,
      { skillId, cause, retryable: false },
    );
  }

  /**
   * 执行超时
   */
  static timeout(skillId: string, timeout: number): SkillError {
    return new SkillError(
      `Skill '${skillId}' timed out after ${timeout}ms`,
      SkillErrorCode.TIMEOUT,
      { skillId, details: { timeout }, retryable: true },
    );
  }

  /**
   * 执行取消
   */
  static cancelled(skillId: string): SkillError {
    return new SkillError(
      `Skill '${skillId}' execution was cancelled`,
      SkillErrorCode.CANCELLED,
      { skillId, retryable: false },
    );
  }

  /**
   * 降级失败
   */
  static fallbackFailed(
    skillId: string,
    fallbackId: string,
    cause?: Error,
  ): SkillError {
    return new SkillError(
      `Fallback skill '${fallbackId}' for '${skillId}' also failed`,
      SkillErrorCode.FALLBACK_FAILED,
      { skillId, details: { fallbackId }, cause, retryable: false },
    );
  }

  /**
   * 组合失败
   */
  static compositionFailed(skillId: string, reason: string): SkillError {
    return new SkillError(
      `Skill composition failed for '${skillId}': ${reason}`,
      SkillErrorCode.COMPOSITION_FAILED,
      { skillId, details: { reason }, retryable: false },
    );
  }

  /**
   * 工具调用失败
   */
  static toolCallFailed(
    skillId: string,
    toolId: string,
    cause?: Error,
  ): SkillError {
    return new SkillError(
      `Tool '${toolId}' call failed in skill '${skillId}'`,
      SkillErrorCode.TOOL_CALL_FAILED,
      { skillId, details: { toolId }, cause, retryable: false },
    );
  }

  /**
   * LLM 调用失败
   */
  static llmCallFailed(skillId: string, cause?: Error): SkillError {
    return new SkillError(
      `LLM call failed in skill '${skillId}'`,
      SkillErrorCode.LLM_CALL_FAILED,
      { skillId, cause, retryable: true },
    );
  }

  /**
   * 从普通错误创建
   */
  static override fromError(
    error: unknown,
    code: string = SkillErrorCode.UNKNOWN,
    details?: JsonObject,
  ): SkillError {
    if (error instanceof SkillError) {
      return error;
    }

    const skillId = details?.skillId as string | undefined;

    if (error instanceof Error) {
      return new SkillError(error.message, code, {
        skillId,
        cause: error,
        details,
      });
    }

    return new SkillError(
      typeof error === "string" ? error : "Unknown skill error",
      code,
      { skillId, details },
    );
  }

  /**
   * 从普通错误创建（带 skillId）
   */
  static fromSkillError(
    error: unknown,
    skillId?: string,
    code: string = SkillErrorCode.UNKNOWN,
  ): SkillError {
    return SkillError.fromError(error, code, skillId ? { skillId } : undefined);
  }
}

