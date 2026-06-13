/**
 * BusinessAgentTeam — Rerun Runtime Builder Framework（P5 Wave 1，2026-05-24）
 *
 * @migrated-from ai-app/playground/services/mission/rerun/rerun-runtime-builder.service.ts
 *
 * 抽出 cascade rerun session 装配骨架（stale-protect + abort registry + cleanup
 * idempotent guard）；business 实现 composer hooks 决定 session shape + composed ctx
 * shape + writeBack 字段映射。
 *
 * 机制（framework）：
 *   - protectStaleAbortController: register 前主动 abort + unregister 旧 controller（orphan-prevention）
 *   - cleanup idempotent guard（multi-call safe）
 *
 * 业务（hooks）：
 *   - buildSession: 业务实现完整 session（billing/pool/leader/abort）
 *   - composeMissionContext: hydrated + session → composed
 *   - writeBackToHydrated: composed 跑完后产物拷回 hydrated
 *
 * 注：framework 不直接 register abortController（business 在 buildSession 内部调），
 * 但提供 protectStaleAbortController 静态 helper 让 business 调用前先清旧的。
 */

import { Logger } from "@nestjs/common";
import {
  MissionAbortRegistry,
  MissionAbortReason,
} from "../../../lifecycle/mission-lifecycle/abort-registry";
import type {
  BusinessTeamRerunRuntimeSession,
  RerunRuntimeComposerHooks,
} from "./abstractions/rerun-runtime-builder.contract";

export abstract class BusinessTeamRerunRuntimeBuilderFramework<
  THydrated,
  TComposed,
  TSession extends BusinessTeamRerunRuntimeSession,
> {
  protected readonly log: Logger;

  constructor(
    protected readonly abortRegistry: MissionAbortRegistry,
    protected readonly hooks: RerunRuntimeComposerHooks<
      THydrated,
      TComposed,
      TSession
    >,
    namespace: string,
  ) {
    this.log = new Logger(`${namespace}-rerun-runtime`);
  }

  /**
   * Stale AbortController 防护 helper（business 在 buildSession 中调）。
   *
   * register 静默覆盖时旧 controller 引用会丢，让孤儿 runner 漂浮。先主动 abort
   * + unregister 让后续 register 重新分配 fresh controller。
   */
  protected protectStaleAbortController(missionId: string): void {
    const existing = this.abortRegistry.getSignal(missionId);
    if (existing && !existing.aborted) {
      this.log.warn(
        `[rerun-runtime ${missionId}] stale AbortController detected — aborting before register (orphan-prevention)`,
      );
      this.abortRegistry.abort(
        missionId,
        MissionAbortReason.rerun_replacing_stale,
      );
      this.abortRegistry.unregister(missionId);
    }
  }

  /**
   * Idempotent cleanup wrapper helper：业务 buildSession 内部用此构造 session.cleanup。
   *
   * Multi-call safe（第二次起 no-op）。caller（cascade dispatcher）在 finally
   * 中调以保证 abortRegistry 不泄露。
   */
  protected makeCleanup(missionId: string, after?: () => void): () => void {
    let cleaned = false;
    return (): void => {
      if (cleaned) return;
      cleaned = true;
      try {
        this.abortRegistry.unregister(missionId);
      } catch (err) {
        this.log.warn(
          `[rerun-runtime ${missionId}] abortRegistry.unregister failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      if (after) {
        try {
          after();
        } catch (err) {
          this.log.warn(
            `[rerun-runtime ${missionId}] cleanup after-hook failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    };
  }

  /** Business 起 session 入口（透传 hook） */
  startSession(ctx: THydrated, workspaceId?: string): TSession {
    return this.hooks.buildSession({ ctx, workspaceId });
  }

  /** Business compose（透传 hook） */
  composeMissionContext(ctx: THydrated, session: TSession): TComposed {
    return this.hooks.composeMissionContext(ctx, session);
  }

  /** Business writeBack（透传 hook） */
  writeBackToHydrated(composed: TComposed, hydrated: THydrated): THydrated {
    return this.hooks.writeBackToHydrated(composed, hydrated);
  }
}
