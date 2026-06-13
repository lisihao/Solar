/**
 * SOTA Runtime · AgentToolSchemaRegistry (function-calling native)
 *
 * 方案文档 §4.5 / §5。每 tool 声明 OpenAI function schema + cost_estimate + retry。
 * ReAct loop 的 Think 阶段把 registry 的所有允许 tool schema 传给 LLM，
 * LLM 通过 function_call 自主选择。
 */

import { Injectable, Logger } from "@nestjs/common";
import type { ToolResult } from "../env/types";

/** OpenAI-compatible function schema */
export interface ToolSchema {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: {
      readonly type: "object";
      readonly properties: Record<string, JsonSchemaProp>;
      readonly required?: readonly string[];
    };
  };
}

export interface JsonSchemaProp {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: readonly unknown[];
  items?: JsonSchemaProp;
  properties?: Record<string, JsonSchemaProp>;
}

export interface RateLimitPolicy {
  readonly maxCallsPerMinute: number;
  readonly maxCallsPerTask: number;
}

export interface RetryPolicy {
  readonly maxRetries: number;
  readonly backoffMs: number;
}

export interface ToolExecContext {
  readonly taskId: string;
  /**
   * scope — rate limit 隔离维度，由 app 层决定语义（missionId / sessionId / ...）。
   * harness 不假设 scope 含义。
   */
  readonly scope: string;
  readonly traceId?: string;
  readonly spanId?: string;
  /** 已调用此 tool 次数（用于 perTask rate limit） */
  readonly callCount: number;
}

/**
 * Tool 接口 — 每个具体 tool（web_search / academic / scraper / ...）实现
 */
export interface Tool<TArgs = Record<string, unknown>, TData = unknown> {
  readonly id: string;
  readonly description: string;
  readonly argsSchema: ToolSchema["function"]["parameters"];
  readonly rateLimit: RateLimitPolicy;
  readonly retry: RetryPolicy;

  /** 预估 token 消耗（用于 budget 前置检查） */
  estimateCost(args: TArgs): number;

  execute(args: TArgs, ctx: ToolExecContext): Promise<ToolResult<TData>>;
}

@Injectable()
/**
 * ★ 2026-05-05 [task #9] 名字冲突由审计 P2 标出（与 ai-engine ToolRegistry 同名）。
 * 已重命名 → AgentToolSchemaRegistry，消除与 ai-engine/tools 唯一 ToolRegistry 的同名。
 */
export class AgentToolSchemaRegistry {
  private readonly logger = new Logger(AgentToolSchemaRegistry.name);
  private readonly tools = new Map<string, Tool>();
  private readonly callCounts = new Map<string, number>(); // `${taskId}:${toolId}` → count

  register<A, D>(tool: Tool<A, D>): void {
    if (this.tools.has(tool.id)) {
      this.logger.warn(`tool '${tool.id}' already registered, overwriting`);
    }
    this.tools.set(tool.id, tool as Tool);
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  mustGet(id: string): Tool {
    const t = this.tools.get(id);
    if (!t)
      throw new Error(`[AgentToolSchemaRegistry] tool '${id}' not registered`);
    return t;
  }

  /** 给 LLM 的 tool schema 列表（function-calling） */
  getSchemas(allowedIds: readonly string[]): ToolSchema[] {
    return allowedIds
      .map((id) => this.tools.get(id))
      .filter((t): t is Tool => t !== undefined)
      .map((t) => ({
        type: "function" as const,
        function: {
          name: t.id,
          description: t.description,
          parameters: t.argsSchema,
        },
      }));
  }

  async execute<A extends Record<string, unknown>, D>(
    id: string,
    args: A,
    ctx: ToolExecContext,
  ): Promise<ToolResult<D>> {
    const tool = this.mustGet(id) as Tool<A, D>;

    // Rate limit (per-task)
    const callKey = `${ctx.taskId}:${id}`;
    const currentCalls = this.callCounts.get(callKey) ?? 0;
    if (currentCalls >= tool.rateLimit.maxCallsPerTask) {
      return {
        success: false,
        error: `tool '${id}' exceeded max calls per task (${tool.rateLimit.maxCallsPerTask})`,
        latencyMs: 0,
      };
    }
    this.callCounts.set(callKey, currentCalls + 1);

    // Execute with retry
    const started = Date.now();
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= tool.retry.maxRetries; attempt++) {
      try {
        const result = await tool.execute(args, {
          ...ctx,
          callCount: currentCalls + 1,
        });
        return result;
      } catch (err) {
        lastError = err;
        if (attempt < tool.retry.maxRetries) {
          await new Promise((r) =>
            setTimeout(r, tool.retry.backoffMs * Math.pow(2, attempt)),
          );
        }
      }
    }
    return {
      success: false,
      error: `tool '${id}' failed after ${tool.retry.maxRetries + 1} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      latencyMs: Date.now() - started,
    };
  }

  clearTaskCallCounts(taskId: string): void {
    for (const key of this.callCounts.keys()) {
      if (key.startsWith(`${taskId}:`)) this.callCounts.delete(key);
    }
  }

  /** 已注册的 tool id 列表（debug） */
  listIds(): string[] {
    return Array.from(this.tools.keys());
  }
}
