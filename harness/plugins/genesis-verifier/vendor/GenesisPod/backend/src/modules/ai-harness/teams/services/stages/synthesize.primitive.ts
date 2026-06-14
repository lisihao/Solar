/**
 * synthesize primitive（v5.1 §3.2 §5）
 *
 * 跨产出聚合；mode 参数（reconcile / analyze）由 ai-app 决定具体实现。
 * singleDimensionShortCircuit / compressIfNeeded 通过 hooks 注入。
 */
import {
  type IStagePrimitive,
  type StageRunArgs,
  StageAbortError,
} from "./abstractions";

export interface SynthesizeStageOutput {
  readonly result: unknown;
  readonly shortCircuited?: boolean;
}

export interface SynthesizeStageHooks {
  /** 可选：单维度场景短路（直接复用 input，不调 LLM）*/
  readonly singleDimensionShortCircuit?: (args: {
    ctx: StageRunArgs["ctx"];
    previousOutputs: StageRunArgs["previousOutputs"];
  }) => unknown | undefined;

  /** 必需：完整聚合逻辑 */
  readonly synthesize: (args: {
    role: StageRunArgs["role"];
    ctx: StageRunArgs["ctx"];
    previousOutputs: StageRunArgs["previousOutputs"];
    mode?: string;
  }) => Promise<unknown>;

  /** 可选：retry-on-null（consumer analyst 用） */
  readonly retryOnceOnNullOutput?: boolean;
}

export const SYNTHESIZE_PRIMITIVE: IStagePrimitive<
  unknown,
  SynthesizeStageOutput
> = {
  id: "synthesize",
  async run(args) {
    const hooks = args.hooks as unknown as SynthesizeStageHooks;
    if (!hooks.synthesize) {
      throw new Error(`synthesize primitive requires hooks.synthesize`);
    }

    // short-circuit
    if (hooks.singleDimensionShortCircuit) {
      const sc = hooks.singleDimensionShortCircuit({
        ctx: args.ctx,
        previousOutputs: args.previousOutputs,
      });
      if (sc !== undefined) {
        return { result: sc, shortCircuited: true };
      }
    }

    let result = await hooks.synthesize({
      role: args.role,
      ctx: args.ctx,
      previousOutputs: args.previousOutputs,
      mode: args.config.mode,
    });

    // retry-once 兜底
    if (
      hooks.retryOnceOnNullOutput &&
      (result === null || result === undefined)
    ) {
      result = await hooks.synthesize({
        role: args.role,
        ctx: args.ctx,
        previousOutputs: args.previousOutputs,
        mode: args.config.mode,
      });
      if (result === null || result === undefined) {
        throw new StageAbortError(
          "synthesize",
          "synthesize returned null after retry",
        );
      }
    }

    return { result };
  },
};
