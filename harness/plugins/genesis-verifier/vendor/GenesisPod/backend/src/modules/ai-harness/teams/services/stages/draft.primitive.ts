/**
 * draft primitive（v5.1 §3.2 §5）
 *
 * 调 writer-style role 生成 artifact，含 reflexion + judge consensus retry。
 * judgeConsensusRetry / memoryIndexer / reportArtifactAssembler 通过 hooks 注入。
 */
import type { IStagePrimitive, StageRunArgs } from "./abstractions";

export interface DraftStageOutput {
  readonly artifact: unknown;
  readonly reviewVerdict?: unknown;
}

export interface DraftStageHooks {
  /** 必需：单次 draft 调用 */
  readonly draftOnce: (args: {
    role: StageRunArgs["role"];
    ctx: StageRunArgs["ctx"];
    previousOutputs: StageRunArgs["previousOutputs"];
    subStage?: string;
  }) => Promise<unknown>;

  /** 可选：multi-judge consensus retry（consumer writer 用） */
  readonly judgeConsensusRetry?: (args: {
    artifact: unknown;
    role: StageRunArgs["role"];
    ctx: StageRunArgs["ctx"];
  }) => Promise<{ artifact: unknown; verdict?: unknown }>;

  /** 可选：写入 memory 索引（consumer memoryIndexer 用） */
  readonly memoryIndexer?: (args: {
    artifact: unknown;
    ctx: StageRunArgs["ctx"];
  }) => Promise<void>;

  /** 可选：组装 report artifact（consumer reportArtifactAssembler 用） */
  readonly reportArtifactAssembler?: (args: {
    artifact: unknown;
    ctx: StageRunArgs["ctx"];
    crossStageState: StageRunArgs["crossStageState"];
  }) => Promise<unknown>;
}

export const DRAFT_PRIMITIVE: IStagePrimitive<unknown, DraftStageOutput> = {
  id: "draft",
  async run(args) {
    const hooks = args.hooks as unknown as DraftStageHooks;
    if (!hooks.draftOnce) {
      throw new Error(`draft primitive requires hooks.draftOnce`);
    }

    // initial draft
    let artifact = await hooks.draftOnce({
      role: args.role,
      ctx: args.ctx,
      previousOutputs: args.previousOutputs,
      subStage: args.config.mode,
    });
    let verdict: unknown;

    // judge consensus retry（业务专属）
    if (hooks.judgeConsensusRetry) {
      const retryResult = await hooks.judgeConsensusRetry({
        artifact,
        role: args.role,
        ctx: args.ctx,
      });
      artifact = retryResult.artifact;
      verdict = retryResult.verdict;
    }

    // assemble report artifact（业务专属）
    if (hooks.reportArtifactAssembler) {
      artifact = await hooks.reportArtifactAssembler({
        artifact,
        ctx: args.ctx,
        crossStageState: args.crossStageState,
      });
    }

    // memory indexing fire-and-forget
    if (hooks.memoryIndexer) {
      void hooks
        .memoryIndexer({ artifact, ctx: args.ctx })
        .catch(() => undefined);
    }

    return { artifact, reviewVerdict: verdict };
  },
};
