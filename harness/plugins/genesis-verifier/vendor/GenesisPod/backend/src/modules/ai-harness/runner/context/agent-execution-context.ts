/**
 * AgentExecutionContext — IAgentExecutionContext 默认实现
 *
 * 由 Loop（ReActLoop / LeaderWorkerLoop / ...）创建，传给业务 executor。
 *
 * Loop 在每轮 / 每 task 完成后调用：
 *   - getEnqueuedTasks() 拿到新任务追加到内部 queue
 *   - 检查 reportFailure 调用，决定是否触发 retry
 */

import type {
  FailureMode,
  IAgentExecutionContext,
  IContextEnvelope,
} from "../../agents/abstractions";

interface EnqueuedTask {
  type: string;
  input: unknown;
  dependsOn?: readonly string[];
  priority?: number;
  metadata?: Record<string, unknown>;
}

interface ReportedFailure {
  mode: FailureMode;
  detail?: string;
  at: number;
}

export class AgentExecutionContext implements IAgentExecutionContext {
  private readonly enqueued: EnqueuedTask[] = [];
  private readonly failures: ReportedFailure[] = [];

  constructor(public readonly envelope: IContextEnvelope) {}

  enqueueTask(task: EnqueuedTask): void {
    this.enqueued.push(task);
  }

  reportFailure(mode: FailureMode, detail?: string): void {
    this.failures.push({ mode, detail, at: Date.now() });
  }

  getEnqueuedTasks(): readonly EnqueuedTask[] {
    return [...this.enqueued];
  }

  /** Loop 内部：拿到失败列表决定 retry 策略 */
  getReportedFailures(): readonly ReportedFailure[] {
    return [...this.failures];
  }

  /** Loop 内部：清空 enqueued（已并入 queue 后） */
  drainEnqueued(): EnqueuedTask[] {
    return this.enqueued.splice(0);
  }
}

/**
 * 工具函数：把 Error 分类为 FailureMode（启发式）。
 * 业务 executor 抛 TaskExecutionError 时已带 mode；通用 Error 走本函数兜底。
 */
export function classifyError(err: Error): FailureMode {
  const msg = err.message.toLowerCase();
  if (/abort/.test(msg)) return "user_cancelled";
  if (/timeout/.test(msg)) return "timeout";
  if (/rate.?limit|429/.test(msg)) return "rate_limit";
  if (/context.?(too.?long|window|exceeded)/.test(msg))
    return "context_too_long";
  if (/credit|quota|payment/.test(msg)) return "no_credit";
  if (/outage|503|502|unavailable/.test(msg)) return "model_outage";
  if (/schema|zod|validation/.test(msg)) return "schema_violation";
  if (/tool|invocation/.test(msg)) return "tool_error";
  if (/invalid.?input|missing.?field/.test(msg)) return "invalid_input";
  return "unknown";
}

/**
 * 根据 RetryPolicy + FailureMode 计算"是否 retry / 等多久"
 */
export function shouldRetry(
  policy:
    | {
        maxRetries: number;
        retryableModes?: readonly FailureMode[];
        backoff?: "linear" | "exponential" | "constant";
        initialDelayMs?: number;
      }
    | undefined,
  mode: FailureMode,
  attempt: number,
): { retry: boolean; delayMs: number } {
  if (!policy) return { retry: false, delayMs: 0 };
  if (attempt >= policy.maxRetries) return { retry: false, delayMs: 0 };
  if (policy.retryableModes && !policy.retryableModes.includes(mode)) {
    return { retry: false, delayMs: 0 };
  }
  const base = policy.initialDelayMs ?? 500;
  const delay =
    policy.backoff === "exponential"
      ? base * 2 ** attempt
      : policy.backoff === "linear"
        ? base * (attempt + 1)
        : base;
  return { retry: true, delayMs: Math.min(delay, 30_000) };
}
