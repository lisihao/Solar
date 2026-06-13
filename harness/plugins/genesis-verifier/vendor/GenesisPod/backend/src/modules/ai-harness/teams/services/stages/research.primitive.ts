/**
 * research primitive（v5.1 §3.2 §5）
 *
 * 按 fanOut 策略 fan-out × N 调 worker role；滑动窗并发，并发度解析：
 * 用户档位（ctx.input.invocation.concurrency）> config.params.concurrency
 * > min(items, 6)。
 * 业务 perItemPipeline / onPatchFailure 通过 hooks 注入（consumer 用 chapter
 * writer + reviewer + integrator + 5-axis grade）。
 */
import type { IStagePrimitive, StageRunArgs } from "./abstractions";

export interface ResearchStageOutput {
  readonly results: ReadonlyArray<unknown>;
  readonly failureCount: number;
}

export interface ResearchStageHooks {
  /** 必需：取 fanOut 子任务列表（如 plan.dimensions）*/
  readonly fanOut: (args: {
    ctx: StageRunArgs["ctx"];
    previousOutputs: StageRunArgs["previousOutputs"];
  }) => ReadonlyArray<unknown>;

  /** 必需：处理单个子任务（包含完整 worker 流程）*/
  readonly perItemPipeline: (args: {
    item: unknown;
    role: StageRunArgs["role"];
    ctx: StageRunArgs["ctx"];
  }) => Promise<unknown>;

  /** 可选：单 item 失败时累计到 crossStageState（consumer s4PatchFailures 用法）*/
  readonly onPatchFailure?: (args: {
    item: unknown;
    error: unknown;
    ctx: StageRunArgs["ctx"];
    crossStageState: StageRunArgs["crossStageState"];
  }) => void | Promise<void>;
}

/**
 * per-run 用户并发档位（软约定，duck-typed，不 import 任何 app 类型）：
 * 消费方把用户档位放在 ctx.input.invocation.concurrency（deep-insight 等
 * CapabilityRunInput → pipeline input 透传路径）。非法/缺省返回 undefined。
 */
function readUserConcurrency(input: unknown): number | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const invocation = (input as { invocation?: unknown }).invocation;
  if (typeof invocation !== "object" || invocation === null) return undefined;
  const raw = (invocation as { concurrency?: unknown }).concurrency;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

export const RESEARCH_PRIMITIVE: IStagePrimitive<unknown, ResearchStageOutput> =
  {
    id: "research",
    async run(args) {
      const hooks = args.hooks as unknown as ResearchStageHooks;
      if (!hooks.fanOut || !hooks.perItemPipeline) {
        throw new Error(
          `research primitive requires hooks.fanOut + hooks.perItemPipeline`,
        );
      }

      const items = hooks.fanOut({
        ctx: args.ctx,
        previousOutputs: args.previousOutputs,
      });
      // 并发解析优先级：用户档位（ctx.input.invocation.concurrency）
      //   > recipe params.concurrency > min(items, 6)（基线 fc22d9a Phase A 语义）。
      const paramRaw = Number(args.config.params?.concurrency);
      const paramConcurrency =
        Number.isFinite(paramRaw) && paramRaw >= 1
          ? Math.floor(paramRaw)
          : undefined;
      const concurrency = Math.max(
        1,
        readUserConcurrency(args.ctx.input) ??
          paramConcurrency ??
          Math.min(items.length, 6),
      );

      // 滑动窗 worker-pool（非分块 allSettled）：槽位空出立即补位，
      // 避免每批等最慢 item 的队头阻塞。settled 按 item 原序落位。
      const settled = new Array<PromiseSettledResult<unknown>>(items.length);
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(concurrency, items.length) },
        async () => {
          for (;;) {
            const idx = cursor;
            cursor += 1;
            if (idx >= items.length) return;
            try {
              const value = await hooks.perItemPipeline({
                item: items[idx],
                role: args.role,
                ctx: args.ctx,
              });
              settled[idx] = { status: "fulfilled", value };
            } catch (error) {
              settled[idx] = { status: "rejected", reason: error };
            }
          }
        },
      );
      await Promise.all(workers);

      const results: unknown[] = [];
      let failureCount = 0;
      for (let k = 0; k < settled.length; k++) {
        const s = settled[k];
        if (s.status === "fulfilled") {
          results.push(s.value);
        } else {
          failureCount++;
          if (hooks.onPatchFailure) {
            await hooks.onPatchFailure({
              item: items[k],
              error: s.reason,
              ctx: args.ctx,
              crossStageState: args.crossStageState,
            });
          }
        }
      }

      return { results, failureCount };
    },
  };
