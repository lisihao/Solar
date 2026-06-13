/**
 * SemanticToolSelector —— 按 goal 语义检索收窄工具集（RAG-MCP 范式）
 *
 * 解决"把所有工具描述塞进 context → choice paralysis + token 爆炸"。
 * 复用 engine 的 ScoredRouter core 做 `embed 描述 → top-k 语义检索 → 多信号重排`。
 *
 * **opt-in**：注册为命名 selector "semantic",不替换默认 allowlist。
 * spec 里声明 selectorId:"semantic" 才启用 → 零行为变更、零回归风险。
 *
 * 安全闸（绝不因路由丢掉 agent 需要的工具）：
 *   1. 工具数 ≤ 阈值（默认 8）或无 goal → 直接全选（小集合不值得 embed）
 *   2. embedding 不可用（降级）→ fail-open 全选
 *   3. 无法解析描述的工具 ID → 一律保留
 */

import { Injectable } from "@nestjs/common";
import { ScoredRouterService } from "@/modules/ai-engine/routing/scored-router.service";
import { defaultScorers } from "@/modules/ai-engine/routing/signal-scorers";
import type { RoutableCandidate } from "@/modules/ai-engine/routing/abstractions/routing.types";
import { ToolRegistry } from "@/modules/ai-engine/tools/registry/tool.registry";
import type {
  IToolSelector,
  ToolSelectionContext,
  ToolSelectionResult,
} from "./tool-selector";
import { ToolSelectorRegistry } from "./tool-selector-registry";

@Injectable()
export class SemanticToolSelector implements IToolSelector {
  readonly id = "semantic";

  /** 低于此数不走语义（小集合 embed 不划算，直接全选） */
  private static readonly MIN_TOOLS_FOR_SEMANTIC = 8;
  /** 默认保留的语义 top-k（可被 ctx.hints.topK 覆盖） */
  private static readonly DEFAULT_TOP_K = 8;

  constructor(
    registry: ToolSelectorRegistry,
    private readonly scoredRouter: ScoredRouterService,
    private readonly toolRegistry: ToolRegistry,
  ) {
    // 自注册为命名 selector，调用方按 selectorId 显式启用
    registry.register(this);
  }

  async select(ctx: ToolSelectionContext): Promise<ToolSelectionResult> {
    const toolIds = [...ctx.envelope.tools];
    const goal = ctx.goal?.trim() ?? "";

    // 闸 1：小集合 / 无 goal → 全选
    if (
      toolIds.length <= SemanticToolSelector.MIN_TOOLS_FOR_SEMANTIC ||
      goal === ""
    ) {
      return this.allowlist(
        toolIds,
        `below threshold (${toolIds.length}<=${SemanticToolSelector.MIN_TOOLS_FOR_SEMANTIC}) or empty goal`,
      );
    }

    // 解析每个 tool 的描述用于 embedding
    const candidates: RoutableCandidate[] = [];
    const unresolved: string[] = [];
    for (const id of toolIds) {
      const tool = this.toolRegistry.tryGet(id);
      if (tool) {
        candidates.push({
          id,
          description: `${tool.name}. ${tool.description}`,
        });
      } else {
        unresolved.push(id); // 无描述 → 保留，不参与语义排序
      }
    }
    if (candidates.length === 0) {
      return this.allowlist(toolIds, "no resolvable tool descriptions");
    }

    const topK = this.resolveTopK(ctx);
    const result = await this.scoredRouter.route(
      candidates,
      { goal, topK },
      defaultScorers(),
    );

    // 闸 2：embedding 不可用 → fail-open 全选（不靠纯信号丢工具）
    if (!result.semanticApplied) {
      return this.allowlist(toolIds, "embedding unavailable (degraded)");
    }

    // 闸 3：选中的语义 top-k + 一律保留的 unresolved
    const selected = result.ranked.map((r) => r.candidate.id);
    return {
      toolIds: [...selected, ...unresolved],
      parallel: false,
      fallbackOnFailure: false,
      rationale: `semantic top-${topK}/${toolIds.length}: ${result.reason}`,
    };
  }

  private allowlist(
    toolIds: readonly string[],
    why: string,
  ): ToolSelectionResult {
    return {
      toolIds: [...toolIds],
      parallel: false,
      fallbackOnFailure: false,
      rationale: `allowlist (${why})`,
    };
  }

  private resolveTopK(ctx: ToolSelectionContext): number {
    const hint = ctx.hints?.topK;
    return typeof hint === "number" && hint > 0
      ? hint
      : SemanticToolSelector.DEFAULT_TOP_K;
  }
}
