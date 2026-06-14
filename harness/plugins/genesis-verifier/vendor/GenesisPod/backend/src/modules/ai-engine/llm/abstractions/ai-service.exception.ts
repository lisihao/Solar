/**
 * AI 服务相关异常类
 */

/**
 * AI 服务不可用异常
 * 当 API 密钥未配置或 AI 服务无法访问时抛出
 */
export class AiServiceUnavailableError extends Error {
  constructor(
    message: string,
    public readonly provider?: string,
    public readonly code: string = "AI_SERVICE_UNAVAILABLE",
  ) {
    super(message);
    this.name = "AiServiceUnavailableError";
  }
}

/**
 * AI 响应无效异常
 * 当 AI 返回的响应无法解析或不符合预期格式时抛出
 */
export class AiResponseInvalidError extends Error {
  constructor(
    message: string,
    public readonly code: string = "AI_RESPONSE_INVALID",
  ) {
    super(message);
    this.name = "AiResponseInvalidError";
  }
}

/**
 * AI 输出验证失败异常
 * 当 AI 输出未通过业务验证时抛出
 */
export class AiOutputValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors?: string[],
    public readonly code: string = "AI_OUTPUT_VALIDATION_FAILED",
  ) {
    super(message);
    this.name = "AiOutputValidationError";
  }
}

/**
 * AI 任务执行失败异常
 * 当 AI 任务执行失败（重试后仍失败）时抛出
 */
export class AiTaskExecutionError extends Error {
  constructor(
    message: string,
    public readonly taskType?: string,
    public readonly attempts?: number,
    public readonly code: string = "AI_TASK_EXECUTION_FAILED",
  ) {
    super(message);
    this.name = "AiTaskExecutionError";
  }
}
