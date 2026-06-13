/**
 * learn primitive（v5.1 §3.2 内置无 LLM stage）
 *
 * 异步 fire-and-forget：触发 FailureLearner + memory consolidation。
 * postmortemClassifier hook 由 caller 注入（business pattern 列表，
 * 见 R0-A4 PostmortemClassifierService config 注入设计）。
 */
import type { IStagePrimitive, StageRunArgs } from "./abstractions";

export interface LearnStageOutput {
  readonly enqueued: boolean;
}

export interface LearnStageHooks {
  /** 可选：分类器（业务 pattern 注入；R0-A4 PostmortemPatterns）*/
  readonly postmortemClassifier?: (args: {
    ctx: StageRunArgs["ctx"];
    previousOutputs: StageRunArgs["previousOutputs"];
  }) => Promise<unknown>;

  /** 可选：memory consolidation */
  readonly memoryConsolidation?: (args: {
    ctx: StageRunArgs["ctx"];
    previousOutputs: StageRunArgs["previousOutputs"];
  }) => Promise<void>;
}

export const LEARN_PRIMITIVE: IStagePrimitive<unknown, LearnStageOutput> = {
  id: "learn",
  async run(args) {
    const hooks = args.hooks as unknown as LearnStageHooks;
    // fire-and-forget：learn 不应阻塞 mission 完成
    if (hooks.postmortemClassifier) {
      void hooks
        .postmortemClassifier({
          ctx: args.ctx,
          previousOutputs: args.previousOutputs,
        })
        .catch(() => undefined);
    }
    if (hooks.memoryConsolidation) {
      void hooks
        .memoryConsolidation({
          ctx: args.ctx,
          previousOutputs: args.previousOutputs,
        })
        .catch(() => undefined);
    }
    return { enqueued: true };
  },
};
