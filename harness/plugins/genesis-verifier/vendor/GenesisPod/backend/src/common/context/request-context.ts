import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";

/**
 * 一段细粒度时延分段。任何层（引擎/app/harness）都可往当前请求累加，在请求出口
 * 处统一读出 —— 把"明细时间"从散落的 logger.log 变成结构化、可被 API/可观测性
 * 消费的一等数据。
 */
export interface LatencySegment {
  /** 分段种类（model_resolve / balance_check / context_build / session_load /
   * llm_ttft / llm_gen / user_msg_persist 等，开放字符串） */
  kind: string;
  /** 可读名 */
  name?: string;
  /** 耗时（毫秒） */
  ms: number;
  /** 维度属性：如 { source: "cached|registered|synthesized", cold, model, provider } */
  meta?: Record<string, unknown>;
}

export interface RequestContextData {
  userId?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  startTime?: number;
  path?: string;
  method?: string;
  /** 请求级时延明细累加器（懒初始化，随 store 在请求结束时回收） */
  latencySegments?: LatencySegment[];
}

export class RequestContextStore {
  private storage = new AsyncLocalStorage<RequestContextData>();

  run<T>(data: RequestContextData, fn: () => T): T {
    return this.storage.run(data, fn);
  }

  get(): RequestContextData | undefined {
    return this.storage.getStore();
  }

  getUserId(): string | undefined {
    return this.storage.getStore()?.userId;
  }

  getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  getTraceId(): string | undefined {
    return this.storage.getStore()?.traceId;
  }

  /**
   * 往当前请求累加一段时延明细。无活跃请求上下文时静默 no-op（如后台任务）。
   * 任何层都可调用（model 解析、balance、context、ttft…），出口处统一读出。
   */
  pushLatencySegment(segment: LatencySegment): void {
    const ctx = this.storage.getStore();
    if (!ctx) return;
    (ctx.latencySegments ??= []).push(segment);
  }

  /** 读出当前请求累加的全部时延明细（按 push 顺序）。 */
  getLatencySegments(): LatencySegment[] {
    return this.storage.getStore()?.latencySegments ?? [];
  }

  /**
   * 生成新的请求 ID
   */
  static generateRequestId(): string {
    return randomUUID();
  }

  /**
   * 获取当前上下文的日志元数据
   */
  getLogContext(): Record<string, string | undefined> {
    const ctx = this.storage.getStore();
    if (!ctx) return {};

    return {
      requestId: ctx.requestId,
      traceId: ctx.traceId,
      userId: ctx.userId,
    };
  }
}

export const RequestContext = new RequestContextStore();
