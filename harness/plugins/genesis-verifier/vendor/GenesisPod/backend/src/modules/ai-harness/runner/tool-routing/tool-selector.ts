/**
 * IToolSelector — 按 context 动态选 tool
 *
 * Topic Insights 的 data-source-router 当前是手写：
 *   if (dimension.type === "academic") use [arxiv, semantic-scholar, pubmed]
 *   else if (topic.industry === "finance") use [bloomberg, sec, crunchbase]
 *
 * 本接口让选择策略声明式 + 可注入。Harness 在 PreToolUse 之前调用 selector，
 * 让 selector 决定"这次到底调哪几个 tool"。
 */

import type { IContextEnvelope } from "../../agents/abstractions";

export interface ToolSelectionContext {
  readonly envelope: IContextEnvelope;
  /** 业务自定义路由 hint（dimension type / topic industry / language ...） */
  readonly hints?: Record<string, unknown>;
  /** Agent 当前任务目标 */
  readonly goal?: string;
}

export interface ToolSelectionResult {
  /** 选中的 tool id 列表（按优先级排序） */
  readonly toolIds: readonly string[];
  /** 是否并行调用（vs 串行 fallback） */
  readonly parallel?: boolean;
  /** 单 tool 失败时是否走下一个备选 */
  readonly fallbackOnFailure?: boolean;
  /** 选择理由（observability 用） */
  readonly rationale?: string;
}

export interface IToolSelector {
  readonly id: string;
  select(
    ctx: ToolSelectionContext,
  ): Promise<ToolSelectionResult> | ToolSelectionResult;
}

/**
 * SimpleAllowlistSelector —— 无业务逻辑，按 envelope.tools 全选。
 * Harness 默认行为；业务方实现自己的 selector 后注册到 ToolSelectorRegistry。
 */
export class SimpleAllowlistSelector implements IToolSelector {
  readonly id = "allowlist";
  select(ctx: ToolSelectionContext): ToolSelectionResult {
    return {
      toolIds: [...ctx.envelope.tools],
      parallel: false,
      fallbackOnFailure: false,
      rationale: "all tools from envelope.tools",
    };
  }
}
