/**
 * CIRCUIT_OPEN / CIRCUIT_CLOSE hook payload
 *
 * Fire point：tool-circuit-breaker / embedding circuit / provider health gateway
 * Plugin 用例：
 *   - 监控 / 告警 plugin 收到熔断事件 push 到 Slack/PagerDuty
 *   - dynamic provider routing（熔断时自动切换备用 provider）
 */

export interface CircuitOpenPayload {
  /** 熔断 target id（toolId / providerSlug / hostname） */
  readonly target: string;
  /** 触发熔断的失败次数 */
  readonly failureCount: number;
  /** 计划冷却时长（ms） */
  readonly cooldownMs: number;
  /** 失败模式分类 */
  readonly category: "rate-limit" | "timeout" | "5xx" | "auth" | "unknown";
  /** 触发熔断的最后一次错误信息 */
  readonly lastError?: string;
}

export interface CircuitClosePayload {
  /** 熔断恢复的 target id */
  readonly target: string;
  /** 熔断持续时长（ms） */
  readonly durationMs: number;
  /** 是否手动关闭（admin 介入） */
  readonly manual?: boolean;
}
