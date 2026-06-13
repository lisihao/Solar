/**
 * 工具执行超时保护
 *
 * 统一的超时包装器，为所有 MCP Tool Handler 提供执行时间限制，
 * 防止长时间挂起的 AI 调用阻塞 HTTP 连接。
 */

/** 单次 AI 调用工具的默认超时 (60秒) */
export const TOOL_TIMEOUT_MS = 60_000;

/** 多步骤工具的默认超时 (180秒) */
export const MULTI_STEP_TIMEOUT_MS = 180_000;

/**
 * 带超时保护的 Promise 包装器
 *
 * 使用 Promise.race 实现，超时后清理 timer 防止内存泄漏。
 */
export function withToolTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(`${operationName} exceeded timeout of ${timeoutMs / 1000}s`),
      );
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}
