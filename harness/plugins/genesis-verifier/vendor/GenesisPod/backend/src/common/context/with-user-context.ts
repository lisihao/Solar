import { RequestContext, RequestContextData } from "./request-context";

/**
 * 在指定 userId 下执行 fn，保证 RequestContext.getUserId() 在 fn 的整个
 * 异步链路内都是该值。
 *
 * 使用场景：
 * 1. BullMQ / 自定义队列 Worker 的入口（job.data.userId 必须先放入 payload）
 * 2. @Cron 定时任务里要为特定用户执行 LLM 调用的场景
 * 3. EventEmitter 监听器里需要恢复原请求上下文的场景
 *
 * 示例：
 * ```ts
 * @Process("research")
 * async handle(job: Job<{ userId: string; researchId: string }>) {
 *   return withUserContext(job.data.userId, async () => {
 *     // 此作用域内 AiChatService.chat 能自动拿到 userId 解析 Key
 *     await this.researchService.run(job.data.researchId);
 *   });
 * }
 * ```
 */
export function withUserContext<T>(
  userId: string,
  fn: () => T | Promise<T>,
  extra: Partial<RequestContextData> = {},
): Promise<T> | T {
  const existing = RequestContext.get() ?? {};
  return RequestContext.run(
    {
      ...existing,
      ...extra,
      userId,
    },
    fn,
  );
}
