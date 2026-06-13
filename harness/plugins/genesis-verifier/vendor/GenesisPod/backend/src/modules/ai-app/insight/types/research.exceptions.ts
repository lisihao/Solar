/**
 * Topic Insights 研究流程自定义异常
 * 替代 Magic String 错误协议，提供类型安全的错误传播
 */

/**
 * 用户积分不足，无法继续研究
 * 传播路径: SectionWriter/LeaderPlanning → DimensionMission → MissionExecution
 * 处理策略: 立即标记 Mission FAILED，取消所有待处理任务
 */
export class InsufficientCreditsException extends Error {
  readonly code = "INSUFFICIENT_CREDITS" as const;

  constructor(detail?: string) {
    super(detail ? `Insufficient credits: ${detail}` : "Insufficient credits");
    this.name = "InsufficientCreditsException";
  }
}

/**
 * Prompt 超过所有可用模型的 token 上限
 * 传播路径: LeaderPlanning → 上层调用方
 * 处理策略: 不重试，直接失败
 */
export class ContextTooLongException extends Error {
  readonly code = "CONTEXT_TOO_LONG" as const;

  constructor(detail?: string) {
    super(
      detail
        ? `Context too long: ${detail}`
        : "Context too long for any available model",
    );
    this.name = "ContextTooLongException";
  }
}
