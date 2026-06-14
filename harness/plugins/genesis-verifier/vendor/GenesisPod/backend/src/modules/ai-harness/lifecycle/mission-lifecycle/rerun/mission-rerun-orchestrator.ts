/**
 * MissionRerunOrchestrator —— generic mission rerun（v5.1 §3.4 / §3.5 R1-D）
 *
 * 设计：
 *   - 全 mission rerun (rerunFull)：复用原 input + 可选 checkpoint clone +
 *     fire-and-forget runner.run
 *   - 单 todo rerun (rerunFromTodo)：创建新 mission focused 跑；业务拒绝条件
 *     由 policy.validateTodoRerun 实现（consumer 拒 leader-assess-abort
 *     / s11-persist / running 状态等）
 *
 * 不知 ai-app 命名：
 *   - consumer: emit "{app}.mission:manual-rerun-from-todo" 这类业务
 *     事件由 controller / business hook 在 runner.run 启动后或之前自行 emit；
 *     orchestrator 不持有 IMissionEventStore，避免 generic primitive 直接产生
 *     业务事件命名空间
 *
 * 错误约定：
 *   - SourceMissionNotFoundError → controller 转 Forbidden（避免 ownership 探测）
 *   - RerunNotAllowedError → controller 转 BadRequest
 *   - 其它 error 透传
 */
import { randomUUID } from "crypto";
import type { IMissionStore } from "../abstractions/mission-store.interface";
import {
  type IMissionCheckpointCloner,
  type IMissionOwnershipAssigner,
  type IMissionRerunLogger,
  type IMissionRerunPolicy,
  type IMissionRunner,
  type RerunFullArgs,
  type RerunResult,
  type RerunTodoArgs,
  RerunNotAllowedError,
  SourceMissionNotFoundError,
} from "./abstractions/mission-rerun.types";

export interface MissionRerunOrchestratorOptions {
  readonly checkpointCloner?: IMissionCheckpointCloner;
  readonly ownership?: IMissionOwnershipAssigner;
  /** 注入便于 spec 控制；默认 randomUUID */
  readonly idGenerator?: () => string;
  readonly logger?: IMissionRerunLogger;
}

export class MissionRerunOrchestrator<
  TInput,
  TBusiness = Record<string, unknown>,
  TBody = unknown,
> {
  constructor(
    private readonly store: IMissionStore<TBusiness>,
    private readonly runner: IMissionRunner<TInput>,
    private readonly policy: IMissionRerunPolicy<TInput, TBusiness, TBody>,
    private readonly opts: MissionRerunOrchestratorOptions = {},
  ) {}

  /**
   * 全 mission 重跑：创建新 missionId + 复用原 input + 可选 checkpoint clone。
   * runner.run 异步执行，返回值仅含新 missionId（业务 controller 自行拼接
   * streamNamespace 等返回）。
   */
  async rerunFull(args: RerunFullArgs): Promise<RerunResult> {
    const original = await this.loadAndAuthorize(
      args.sourceMissionId,
      args.userId,
    );
    this.assertNotRunning(original.status);
    this.policy.validateFullRerun?.(original);

    const input = this.policy.cloneInput(original, {});
    const newMissionId = this.newId();
    this.opts.ownership?.assign(newMissionId, args.userId);

    if (this.opts.checkpointCloner) {
      const cloned = await this.opts.checkpointCloner
        .clone(args.sourceMissionId, newMissionId)
        .catch(() => false);
      if (cloned) {
        this.opts.logger?.log(
          `[mission-rerun] ${newMissionId} cloned checkpoint from ${args.sourceMissionId}`,
        );
      }
    }

    this.dispatchRunner(newMissionId, input, args.userId, args.sourceMissionId);
    return { newMissionId, sourceMissionId: args.sourceMissionId };
  }

  /**
   * 单 todo 重跑：业务策略决定拒绝条件（默认仅拒绝 source running）；
   * 创建新 missionId + 复用原 input（policy 可注入 focused topic 等 overrides）。
   *
   * Note: orchestrator 不 emit 业务事件（如 "mission:manual-rerun-from-todo"）；
   * 业务 controller 在调本方法前后自行 emit 到自家 event bus。
   */
  async rerunFromTodo(args: RerunTodoArgs<TBody>): Promise<RerunResult> {
    const original = await this.loadAndAuthorize(
      args.sourceMissionId,
      args.userId,
    );
    this.assertNotRunning(original.status);
    this.policy.validateTodoRerun?.(original, args);

    const input = this.policy.cloneInput(original, {});
    const newMissionId = this.newId();
    this.opts.ownership?.assign(newMissionId, args.userId);

    this.dispatchRunner(
      newMissionId,
      input,
      args.userId,
      `${args.sourceMissionId}:todo:${args.todoId}`,
    );
    return { newMissionId, sourceMissionId: args.sourceMissionId };
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private async loadAndAuthorize(missionId: string, userId: string) {
    const original = await this.store.getById(missionId);
    if (!original) throw new SourceMissionNotFoundError(missionId);
    // userId 不匹配视为 not found（防 ownership 探测）；store record userId 可空（系统级 mission），此时跳过校验
    if (original.userId && original.userId !== userId) {
      throw new SourceMissionNotFoundError(missionId);
    }
    return original;
  }

  private assertNotRunning(status: string) {
    if (status === "running") {
      throw new RerunNotAllowedError(
        "source mission still running — cancel or wait for completion before re-running",
      );
    }
  }

  private newId(): string {
    return (this.opts.idGenerator ?? randomUUID)();
  }

  private dispatchRunner(
    missionId: string,
    input: TInput,
    userId: string,
    traceTag: string,
  ): void {
    void this.runner.run(missionId, input, userId).catch((err: unknown) => {
      this.opts.logger?.error(
        `[mission-rerun] mission ${missionId} (rerun of ${traceTag}) failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }
}
