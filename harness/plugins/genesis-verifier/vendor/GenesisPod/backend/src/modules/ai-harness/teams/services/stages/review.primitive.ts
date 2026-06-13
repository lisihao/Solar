/**
 * review primitive（v5.1 §3.2 §5）
 *
 * 调 reviewer-style role 评分 + 可选 enhancement hook（s8b/s9/s9b）。
 * afterReview / scoreScaling / objectiveEvalInjection 通过 hooks 注入。
 */
import type { IStagePrimitive, StageRunArgs } from "./abstractions";

export interface ReviewStageOutput {
  readonly verdict: unknown;
  readonly score?: number;
  readonly passed?: boolean;
}

export interface ReviewStageHooks {
  /** 必需：评审主逻辑 */
  readonly review: (args: {
    role: StageRunArgs["role"];
    ctx: StageRunArgs["ctx"];
    previousOutputs: StageRunArgs["previousOutputs"];
    mode?: string;
  }) => Promise<{ verdict: unknown; score?: number; passed?: boolean }>;

  /** 可选：评审后 enhancement 调用（consumer s8b 用） */
  readonly afterReview?: (args: {
    verdict: unknown;
    ctx: StageRunArgs["ctx"];
    crossStageState: StageRunArgs["crossStageState"];
  }) => Promise<void>;

  /** 可选：score scaling（consumer s9 把 0-1 映射到 0-100）*/
  readonly scoreScaling?: (raw: number) => number;

  /** 可选：objectiveEvalInjection（consumer s9b 用） */
  readonly objectiveEvalInjection?: (args: {
    verdict: unknown;
    ctx: StageRunArgs["ctx"];
  }) => Promise<unknown>;
}

export const REVIEW_PRIMITIVE: IStagePrimitive<unknown, ReviewStageOutput> = {
  id: "review",
  async run(args) {
    const hooks = args.hooks as unknown as ReviewStageHooks;
    if (!hooks.review) {
      throw new Error(`review primitive requires hooks.review`);
    }

    const result = await hooks.review({
      role: args.role,
      ctx: args.ctx,
      previousOutputs: args.previousOutputs,
      mode: args.config.mode,
    });

    let { verdict, score } = result;
    const { passed } = result;

    if (typeof score === "number" && hooks.scoreScaling) {
      score = hooks.scoreScaling(score);
    }

    if (hooks.objectiveEvalInjection) {
      verdict = await hooks.objectiveEvalInjection({
        verdict,
        ctx: args.ctx,
      });
    }

    if (hooks.afterReview) {
      await hooks.afterReview({
        verdict,
        ctx: args.ctx,
        crossStageState: args.crossStageState,
      });
    }

    return { verdict, score, passed };
  },
};
