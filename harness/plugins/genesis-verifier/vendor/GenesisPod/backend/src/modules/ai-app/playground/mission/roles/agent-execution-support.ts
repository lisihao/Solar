/**
 * AgentExecutionSupport — playground 业务专属 invoke wrapper
 *
 * 2026-05-24 P4 重构：runDagConcurrency（内存数组 DAG 并发调度）已上提到
 *   `ai-harness/teams/business-team/invocation/business-team-dag-concurrency`，
 *   本类仅保留 runner.run + abort signal + billingMeta 装配的 playground 业务
 *   专属 invoke wrapper（billing moduleType="playground"）。
 *
 * runDagConcurrency 作为 backwards-compat shim 仍可访问（@deprecated 提示），
 * 后续 PR 把 stage 文件 import 直接切到 harness facade 后此 shim 可删。
 */
import {
  AgentRunner,
  runDagConcurrency,
  type IAgentEvent,
} from "@/modules/ai-harness/facade";
import { MissionAbortRegistry } from "@/modules/ai-harness/facade";
import type { InvocationContext } from "./agent-invoker.service";

export class AgentExecutionSupport {
  constructor(
    private readonly runner: AgentRunner,
    private readonly abortRegistry: MissionAbortRegistry,
  ) {}

  async invoke<TSpec extends Parameters<AgentRunner["run"]>[0]>(
    Spec: TSpec,
    input: Parameters<AgentRunner["run"]>[1],
    ctx: InvocationContext,
    onEvent: (event: IAgentEvent) => Promise<void>,
  ): Promise<Awaited<ReturnType<AgentRunner["run"]>>> {
    const signal = this.abortRegistry.getSignal(ctx.missionId);
    return this.runner.run(Spec, input, {
      userId: ctx.userId,
      environment: ctx.envAdapter,
      budgetMultiplier: ctx.budgetMultiplier,
      toolRecallHint: ctx.toolRecallHint,
      loopOverride: ctx.loopOverride,
      signal,
      billingMeta: {
        moduleType: "playground",
        operationType: ctx.role,
        referenceId: ctx.missionId,
      },
      onEvent,
    });
  }

  /**
   * 内存数组 DAG 并发调度（backwards-compat shim）。
   *
   * @deprecated 已上提到 `@/modules/ai-harness/facade.runDagConcurrency`，后续直接调
   *   harness facade 即可，本方法仅作 backwards-compat 转发；shim 在所有 stage 文件
   *   切到 harness facade 后可删（与 runner-state.util.ts shim 同模式）。
   *
   * ★ 与 harness DAGExecutor 的边界（避免误判为"双源"）：
   *   - 本 helper：纯内存数组 + dependsOn 字段，编译期拓扑求解，returns TOut[]
   *   - harness DAGExecutor：DB-backed 任务池调度（fetchExecutable / countPending /
   *     isCancelled adapter），用于 TI/research 的持久化任务队列。
   *   两者抽象层次不同，不是双源；本 helper 服务于 S3 dim 内存并行场景。
   */
  async runDagConcurrency<
    TIn extends { id: string; dependsOn?: string[] },
    TOut,
  >(
    items: readonly TIn[],
    concurrency: number,
    fn: (item: TIn, idx: number) => Promise<TOut>,
  ): Promise<TOut[]> {
    return runDagConcurrency(items, concurrency, fn);
  }
}
