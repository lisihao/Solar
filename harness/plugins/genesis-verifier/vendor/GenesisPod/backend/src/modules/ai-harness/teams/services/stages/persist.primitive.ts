/**
 * persist primitive（v5.1 §3.2 内置无 LLM stage）
 *
 * 写 IMissionStore.markCompleted/markFailed；可在 pipeline 任意位置插入
 * （例：consumer s11-persist）。
 */
import type { IStagePrimitive, StageRunArgs } from "./abstractions";

export interface PersistStageOutput {
  readonly persisted: boolean;
}

export interface PersistStageHooks {
  /** 必需：persist 主逻辑（写 IMissionStore）*/
  readonly persist: (args: {
    ctx: StageRunArgs["ctx"];
    previousOutputs: StageRunArgs["previousOutputs"];
    crossStageState: StageRunArgs["crossStageState"];
  }) => Promise<void>;
}

export const PERSIST_PRIMITIVE: IStagePrimitive<unknown, PersistStageOutput> = {
  id: "persist",
  async run(args) {
    const hooks = args.hooks as unknown as PersistStageHooks;
    if (!hooks.persist) {
      throw new Error(`persist primitive requires hooks.persist`);
    }
    await hooks.persist({
      ctx: args.ctx,
      previousOutputs: args.previousOutputs,
      crossStageState: args.crossStageState,
    });
    return { persisted: true };
  },
};
