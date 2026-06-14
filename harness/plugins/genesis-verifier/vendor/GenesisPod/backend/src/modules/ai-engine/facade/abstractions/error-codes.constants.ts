/**
 * AI Engine - Error Codes
 * 统一错误码定义
 */

/**
 * 错误码前缀
 */
export const ERROR_PREFIX = {
  ENGINE: "ENGINE",
  TOOL: "TOOL",
  SKILL: "SKILL",
  AGENT: "AGENT",
  ORCHESTRATION: "ORCH",
  COLLABORATION: "COLLAB",
  CONSTRAINT: "CONST",
  LLM: "LLM",
  MEMORY: "MEM",
} as const;

/**
 * 通用错误码
 */
export const CommonErrorCode = {
  // 系统错误 (1xxx)
  UNKNOWN: "ENGINE_1000",
  INTERNAL: "ENGINE_1001",
  NOT_IMPLEMENTED: "ENGINE_1002",
  DEPRECATED: "ENGINE_1003",

  // 验证错误 (2xxx)
  VALIDATION_FAILED: "ENGINE_2000",
  INVALID_INPUT: "ENGINE_2001",
  INVALID_OUTPUT: "ENGINE_2002",
  SCHEMA_MISMATCH: "ENGINE_2003",
  MISSING_REQUIRED: "ENGINE_2004",
  TYPE_ERROR: "ENGINE_2005",

  // 执行错误 (3xxx)
  EXECUTION_FAILED: "ENGINE_3000",
  TIMEOUT: "ENGINE_3001",
  CANCELLED: "ENGINE_3002",
  RETRY_EXHAUSTED: "ENGINE_3003",
  PRECONDITION_FAILED: "ENGINE_3004",

  // 资源错误 (4xxx)
  NOT_FOUND: "ENGINE_4000",
  ALREADY_EXISTS: "ENGINE_4001",
  RESOURCE_EXHAUSTED: "ENGINE_4002",
  RATE_LIMITED: "ENGINE_4003",
  QUOTA_EXCEEDED: "ENGINE_4004",

  // 权限错误 (5xxx)
  UNAUTHORIZED: "ENGINE_5000",
  FORBIDDEN: "ENGINE_5001",
  ACCESS_DENIED: "ENGINE_5002",

  // 依赖错误 (6xxx)
  DEPENDENCY_MISSING: "ENGINE_6000",
  DEPENDENCY_FAILED: "ENGINE_6001",
  CIRCULAR_DEPENDENCY: "ENGINE_6002",
} as const;

/**
 * 工具错误码
 */
export const ToolErrorCode = {
  // 通用工具错误 (1xxx)
  UNKNOWN: "TOOL_1000",
  NOT_FOUND: "TOOL_1001",
  NOT_REGISTERED: "TOOL_1002",
  DISABLED: "TOOL_1003",

  // 输入错误 (2xxx)
  INVALID_INPUT: "TOOL_2000",
  MISSING_PARAMETER: "TOOL_2001",
  PARAMETER_TYPE_ERROR: "TOOL_2002",
  INPUT_TOO_LARGE: "TOOL_2003",

  // 执行错误 (3xxx)
  EXECUTION_FAILED: "TOOL_3000",
  TIMEOUT: "TOOL_3001",
  CANCELLED: "TOOL_3002",
  RATE_LIMITED: "TOOL_3003",

  // 外部服务错误 (4xxx)
  EXTERNAL_SERVICE_ERROR: "TOOL_4000",
  NETWORK_ERROR: "TOOL_4001",
  API_ERROR: "TOOL_4002",
  AUTHENTICATION_ERROR: "TOOL_4003",

  // 资源错误 (5xxx)
  RESOURCE_NOT_FOUND: "TOOL_5000",
  RESOURCE_ACCESS_DENIED: "TOOL_5001",
  RESOURCE_EXHAUSTED: "TOOL_5002",
} as const;

/**
 * 技能错误码
 */
export const SkillErrorCode = {
  // 通用技能错误 (1xxx)
  UNKNOWN: "SKILL_1000",
  NOT_FOUND: "SKILL_1001",
  NOT_REGISTERED: "SKILL_1002",
  DISABLED: "SKILL_1003",

  // 前置条件错误 (2xxx)
  PRECONDITION_FAILED: "SKILL_2000",
  MISSING_TOOL: "SKILL_2001",
  MISSING_SKILL: "SKILL_2002",

  // 执行错误 (3xxx)
  EXECUTION_FAILED: "SKILL_3000",
  TIMEOUT: "SKILL_3001",
  CANCELLED: "SKILL_3002",
  FALLBACK_FAILED: "SKILL_3003",

  // 组合错误 (4xxx)
  COMPOSITION_FAILED: "SKILL_4000",
  TOOL_CALL_FAILED: "SKILL_4001",
  LLM_CALL_FAILED: "SKILL_4002",
} as const;

/**
 * Agent 错误码
 */
export const AgentErrorCode = {
  // 通用 Agent 错误 (1xxx)
  UNKNOWN: "AGENT_1000",
  NOT_FOUND: "AGENT_1001",
  NOT_REGISTERED: "AGENT_1002",
  NOT_READY: "AGENT_1003",
  INVALID_MODE: "AGENT_1004",
  MISSING_DEPENDENCY: "AGENT_1005",

  // 规划错误 (2xxx)
  PLANNING_FAILED: "AGENT_2000",
  INVALID_PLAN: "AGENT_2001",
  PLAN_TIMEOUT: "AGENT_2002",

  // 执行错误 (3xxx)
  EXECUTION_FAILED: "AGENT_3000",
  MAX_ITERATIONS_EXCEEDED: "AGENT_3001",
  MAX_TOOL_CALLS_EXCEEDED: "AGENT_3002",
  TIMEOUT: "AGENT_3003",
  CANCELLED: "AGENT_3004",

  // 路由错误 (4xxx)
  ROUTING_FAILED: "AGENT_4000",
  NO_MATCHING_AGENT: "AGENT_4001",
  AMBIGUOUS_ROUTING: "AGENT_4002",
} as const;

/**
 * 编排错误码
 */
export const OrchestrationErrorCode = {
  // 通用编排错误 (1xxx)
  UNKNOWN: "ORCH_1000",
  WORKFLOW_NOT_FOUND: "ORCH_1001",
  INVALID_WORKFLOW: "ORCH_1002",

  // 步骤错误 (2xxx)
  STEP_FAILED: "ORCH_2000",
  STEP_TIMEOUT: "ORCH_2001",
  STEP_SKIPPED: "ORCH_2002",
  STEP_DEPENDENCY_FAILED: "ORCH_2003",

  // 执行错误 (3xxx)
  EXECUTION_FAILED: "ORCH_3000",
  CHECKPOINT_FAILED: "ORCH_3001",
  ROLLBACK_FAILED: "ORCH_3002",

  // 状态错误 (4xxx)
  INVALID_STATE: "ORCH_4000",
  STATE_TRANSITION_ERROR: "ORCH_4001",
} as const;

/**
 * LLM 错误码
 */
export const LLMErrorCode = {
  // 通用 LLM 错误 (1xxx)
  UNKNOWN: "LLM_1000",
  PROVIDER_NOT_FOUND: "LLM_1001",
  MODEL_NOT_FOUND: "LLM_1002",

  // API 错误 (2xxx)
  API_ERROR: "LLM_2000",
  AUTHENTICATION_ERROR: "LLM_2001",
  RATE_LIMITED: "LLM_2002",
  QUOTA_EXCEEDED: "LLM_2003",

  // 请求错误 (3xxx)
  INVALID_REQUEST: "LLM_3000",
  CONTEXT_TOO_LONG: "LLM_3001",
  CONTENT_FILTERED: "LLM_3002",

  // 响应错误 (4xxx)
  INVALID_RESPONSE: "LLM_4000",
  PARSE_ERROR: "LLM_4001",
  EMPTY_RESPONSE: "LLM_4002",
} as const;

/**
 * 错误码元数据
 */
export interface ErrorCodeMeta {
  /**
   * HTTP 状态码
   */
  httpStatus: number;

  /**
   * 是否可重试
   */
  retryable: boolean;

  /**
   * 重试延迟（毫秒）
   */
  retryDelay?: number;

  /**
   * 最大重试次数
   */
  maxRetries?: number;

  /**
   * 用户友好消息
   */
  userMessage: string;
}

/**
 * 错误码元数据映射
 */
export const ERROR_CODE_META: Record<string, ErrorCodeMeta> = {
  // 通用错误
  [CommonErrorCode.UNKNOWN]: {
    httpStatus: 500,
    retryable: false,
    userMessage: "发生未知错误",
  },
  [CommonErrorCode.TIMEOUT]: {
    httpStatus: 408,
    retryable: true,
    retryDelay: 1000,
    maxRetries: 3,
    userMessage: "操作超时，请稍后重试",
  },
  [CommonErrorCode.RATE_LIMITED]: {
    httpStatus: 429,
    retryable: true,
    retryDelay: 5000,
    maxRetries: 3,
    userMessage: "请求过于频繁，请稍后重试",
  },
  [CommonErrorCode.VALIDATION_FAILED]: {
    httpStatus: 400,
    retryable: false,
    userMessage: "输入验证失败",
  },
  [CommonErrorCode.NOT_FOUND]: {
    httpStatus: 404,
    retryable: false,
    userMessage: "资源未找到",
  },
  [CommonErrorCode.UNAUTHORIZED]: {
    httpStatus: 401,
    retryable: false,
    userMessage: "未授权访问",
  },

  // 工具错误
  [ToolErrorCode.TIMEOUT]: {
    httpStatus: 408,
    retryable: true,
    retryDelay: 1000,
    maxRetries: 2,
    userMessage: "工具执行超时",
  },
  [ToolErrorCode.EXTERNAL_SERVICE_ERROR]: {
    httpStatus: 502,
    retryable: true,
    retryDelay: 2000,
    maxRetries: 2,
    userMessage: "外部服务暂时不可用",
  },

  // LLM 错误
  [LLMErrorCode.RATE_LIMITED]: {
    httpStatus: 429,
    retryable: true,
    retryDelay: 10000,
    maxRetries: 3,
    userMessage: "AI 服务繁忙，请稍后重试",
  },
  [LLMErrorCode.CONTEXT_TOO_LONG]: {
    httpStatus: 400,
    retryable: false,
    userMessage: "输入内容过长",
  },
};

/**
 * 获取错误码元数据
 */
export function getErrorCodeMeta(code: string): ErrorCodeMeta | undefined {
  return ERROR_CODE_META[code];
}

/**
 * 判断错误是否可重试
 */
export function isRetryableError(code: string): boolean {
  const meta = getErrorCodeMeta(code);
  return meta?.retryable ?? false;
}

/**
 * 获取错误的 HTTP 状态码
 */
export function getHttpStatus(code: string): number {
  const meta = getErrorCodeMeta(code);
  return meta?.httpStatus ?? 500;
}
