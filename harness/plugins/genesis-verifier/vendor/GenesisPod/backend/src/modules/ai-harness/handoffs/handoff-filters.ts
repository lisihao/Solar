/**
 * Handoff envelope filters —— 可组合的 context 形塑工具（G6）。
 *
 * 对标 OpenAI Agents SDK 的 handoff input_filters（如 remove_all_tools）。在自定义
 * IHandoffPolicy.shapeEnvelope 里组合这些纯函数，即可在 A→B 转移时裁剪 / 脱敏 context，
 * 无需每个 caller 手写。所有函数返回**新** envelope（不可变），保留 id 与其它字段。
 */
import { ContextEnvelope } from "@/modules/ai-harness/agents/core/context-envelope";
import type {
  IContextEnvelope,
  IContextMessage,
} from "@/modules/ai-harness/agents/abstractions";

function rebuild(
  env: IContextEnvelope,
  messages: readonly IContextMessage[],
): IContextEnvelope {
  return new ContextEnvelope(
    {
      system: env.system,
      messages,
      reminders: env.reminders,
      tools: env.tools,
      memory: env.memory,
      budget: env.budget,
      runtimeEnv: env.runtimeEnv,
      metadata: env.metadata,
    },
    env.id,
  );
}

/** 移除所有 tool 观测消息（等价 OpenAI SDK remove_all_tools）。 */
export function removeToolMessages(env: IContextEnvelope): IContextEnvelope {
  return rebuild(
    env,
    env.messages.filter((m) => m.role !== "tool"),
  );
}

/** 只保留最近 n 条消息（上下文瘦身）。n<=0 返回空消息 envelope。 */
export function keepLastNMessages(
  env: IContextEnvelope,
  n: number,
): IContextEnvelope {
  if (n <= 0) return rebuild(env, []);
  if (n >= env.messages.length) return env;
  return rebuild(env, env.messages.slice(-n));
}

/** 对匹配的消息内容做脱敏替换（PII / secret）。 */
export function redactMessages(
  env: IContextEnvelope,
  match: (content: string) => boolean,
  replacement = "[redacted]",
): IContextEnvelope {
  return rebuild(
    env,
    env.messages.map((m) =>
      match(m.content) ? { ...m, content: replacement } : m,
    ),
  );
}

/** 从左到右组合多个过滤器为单个 shapeEnvelope 友好的函数。 */
export function composeFilters(
  ...filters: Array<(env: IContextEnvelope) => IContextEnvelope>
): (env: IContextEnvelope) => IContextEnvelope {
  return (env) => filters.reduce((acc, f) => f(acc), env);
}
