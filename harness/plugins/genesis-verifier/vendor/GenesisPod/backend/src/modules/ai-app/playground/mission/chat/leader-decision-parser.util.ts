/**
 * leader-decision-parser —— LLM 决策 JSON 解析（playground 业务 DSL 包装）
 *
 * 拆自 leader-chat.service.ts（PR-10a 2026-05-04）。
 * generic JSON-fence 解析基元已下沉到 engine/content/json-fence-parser
 * （PR-10b 2026-05-04），本文件只保留 playground 专属 LeaderDecision DSL +
 * 字段白名单 + alias 兼容。
 *
 * 设计：
 *   • 纯函数：(raw: string) => { response, decision }
 *   • 输入：LLM 原始输出（含 ```json fence / 裸 JSON / 纯文本三种形态）
 *   • 输出：response 文本 + LeaderDecision 结构化决策
 *   • 容错：fence 解析失败 / JSON 不全 / 字段缺失 → 降级 DIRECT_ANSWER
 *   • alias：decisionType ↔ type / todo ↔ tasks（兼容 LLM 不严格按 schema）
 */

import { parseJsonFence } from "@/modules/ai-harness/facade";

export type LeaderDecisionType =
  | "DIRECT_ANSWER" // 直接回答（讨论 / 解释）
  | "CREATE_TODO" // 用户提了新任务 → 追加 dimension
  | "CLARIFY" // 信息不足 → 提供选项让用户选
  | "ACKNOWLEDGE"; // 致谢 / 闲聊

export interface LeaderDecision {
  type: LeaderDecisionType;
  /** 一句话理解："我理解你想要…" — chip 显示 */
  understanding?: string;
  /** CREATE_TODO 时真任务列表 */
  todo?: { name: string; rationale: string }[];
  /** CLARIFY 时按钮选项 */
  clarifyOptions?: string[];
}

const VALID_TYPES: LeaderDecisionType[] = [
  "DIRECT_ANSWER",
  "CREATE_TODO",
  "CLARIFY",
  "ACKNOWLEDGE",
];

/**
 * 解析 LLM 输出 —— 期望 JSON {response, decisionType, understanding, todo, clarifyOptions}
 * generic fence 解析委托 engine/content/json-fence-parser；本函数只做 LeaderDecision DSL 映射。
 */
export function parseLeaderDecisionResponse(raw: string): {
  response: string;
  decision: LeaderDecision | null;
} {
  const parsed = parseJsonFence<Record<string, unknown>>(raw);

  // 无 JSON / 解析失败 → 整段当 DIRECT_ANSWER
  if (!parsed.jsonObj) {
    return {
      response: parsed.response,
      decision: { type: "DIRECT_ANSWER" },
    };
  }

  const obj = parsed.jsonObj;
  const decisionType = (obj.decisionType ?? obj.type) as string | undefined;
  const safeType: LeaderDecisionType = VALID_TYPES.includes(
    decisionType as LeaderDecisionType,
  )
    ? (decisionType as LeaderDecisionType)
    : "DIRECT_ANSWER";

  const todoRaw = obj.todo ?? obj.tasks;
  const todo = Array.isArray(todoRaw)
    ? (todoRaw as { name?: unknown; rationale?: unknown }[])
        .filter(
          (t) =>
            t &&
            typeof t === "object" &&
            typeof (t as { name?: unknown }).name === "string",
        )
        .map((t) => ({
          name: (t as { name: string }).name,
          rationale:
            typeof (t as { rationale?: unknown }).rationale === "string"
              ? (t as { rationale: string }).rationale
              : "(no rationale)",
        }))
    : undefined;

  const clarifyOptions = Array.isArray(obj.clarifyOptions)
    ? (obj.clarifyOptions as unknown[]).filter(
        (s): s is string => typeof s === "string",
      )
    : undefined;

  return {
    response: parsed.response,
    decision: {
      type: safeType,
      understanding:
        typeof obj.understanding === "string" ? obj.understanding : undefined,
      todo,
      clarifyOptions,
    },
  };
}

/** 持久化的 decision JSON 字段 → 安全 LeaderDecision（旧消息 / 解析失败 → null） */
export function safeParseStoredDecision(raw: unknown): LeaderDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.type !== "string") return null;
  return {
    type: o.type as LeaderDecisionType,
    understanding:
      typeof o.understanding === "string" ? o.understanding : undefined,
    todo: Array.isArray(o.todo)
      ? (o.todo as { name?: unknown; rationale?: unknown }[])
          .filter(
            (t) =>
              t &&
              typeof t.name === "string" &&
              typeof t.rationale === "string",
          )
          .map((t) => ({
            name: t.name as string,
            rationale: t.rationale as string,
          }))
      : undefined,
    clarifyOptions: Array.isArray(o.clarifyOptions)
      ? (o.clarifyOptions as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : undefined,
  };
}
