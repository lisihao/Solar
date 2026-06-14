/**
 * SocialRuntimeShellService — social 业务 adapter + thin wrapper
 *
 * 复用 ai-harness MissionRuntimeShellFramework 完成 mission lifecycle 装配
 * （billing context / MissionBudgetPool / AbortController / heartbeat / wallTimer
 *  / model+credit 预检），通过 IMissionRuntimeAdapter 注入 social 业务专属语义：
 *
 *   - eventNamespace="social"        ：让 framework 发出 social.mission:* 事件
 *   - billingModuleType="ai-social"  ：BillingContext.run 正确分类
 *   - resolveWallTimeMs / resolveMaxCredits / resolveBudgetMultiplier
 *                                    ：social 业务档位映射
 *   - createMissionRow              ：调 SocialMissionStore.create
 *   - refreshHeartbeat              ：调 SocialMissionStore.refreshHeartbeat
 *   - emitMissionEvent              ：经 EventBus → 走 buffer + socket adapter
 *
 * Mirror of playground/services/mission/workflow/mission-runtime-shell.service.ts，
 * 但 social 版本 simpler：无 inheritFromMissionId / userProfile JSON 持久化 / leader
 * supervisor 注入。
 */

import { Injectable } from "@nestjs/common";
import {
  EventBus,
  MissionRuntimeShellFramework,
  type IMissionRuntimeAdapter,
  type MissionRuntimeSession,
} from "@/modules/ai-harness/facade";
import { SocialMissionStore } from "../lifecycle/social-mission-store.service";
import { buildSocialConfigSnapshot } from "../lifecycle/social-mission-config-snapshot";
import type { RunSocialMissionInput } from "../context/mission-context";

export type { MissionRuntimeSession };

const WALL_TIME_BY_DEPTH: Record<RunSocialMissionInput["depth"], number> = {
  quick: 15 * 60_000, //  15 min
  standard: 30 * 60_000, // 30 min
  deep: 60 * 60_000, // 60 min
};

/**
 * 2026-05-19 fix: 旧值（lean=8/standard=20/rich=50）按 framework 换算 1 credit=$0.002
 * 得到的预算上限分别是 $0.016 / $0.04 / $0.10。
 *
 * 但 s1-mission-budget-eval 闸的 estimatedCostUsd 起始就是
 *   baseUsdPerPlatform=0.05 × N 平台 × depthFactor × profileFactor × budgetMultiplier
 * 标准档单平台已经 = $0.05，**直接 > $0.04 上限 → 任何 standard 任务必然被拦下**。
 *
 * 此外发布阶段调多个 LLM stage（leader/transformer/composer/reviewer/verifier 等）
 * 实际成本可能 $0.10-$0.30。给 buffer 后取：
 *   lean:     50 credits = $0.10  （覆盖 1 平台 standard / quick depth）
 *   standard: 200 credits = $0.40 （覆盖 1-2 平台 standard depth + 重试空间）
 *   rich:     500 credits = $1.00 （deep depth 多平台）
 */
const MAX_CREDITS_BY_PROFILE: Record<
  RunSocialMissionInput["budgetProfile"],
  number
> = {
  lean: 50,
  standard: 200,
  rich: 500,
};

const BUDGET_MULTIPLIER_BY_PROFILE: Record<
  RunSocialMissionInput["budgetProfile"],
  number
> = {
  lean: 0.6,
  standard: 1.0,
  rich: 1.6,
};

@Injectable()
export class SocialRuntimeShellService {
  constructor(
    private readonly framework: MissionRuntimeShellFramework,
    private readonly store: SocialMissionStore,
    private readonly eventBus: EventBus,
  ) {}

  async openSession(args: {
    missionId: string;
    input: RunSocialMissionInput;
    userId: string;
    workspaceId?: string;
  }): Promise<MissionRuntimeSession> {
    return this.framework.openSession({
      missionId: args.missionId,
      input: args.input,
      userId: args.userId,
      workspaceId: args.workspaceId,
      adapter: this.buildAdapter(),
    });
  }

  async runWithinContext<T>(
    session: MissionRuntimeSession,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.framework.runWithinContext(session, "ai-social", "team", fn);
  }

  private buildAdapter(): IMissionRuntimeAdapter<RunSocialMissionInput> {
    const store = this.store;
    const eventBus = this.eventBus;
    return {
      eventNamespace: "social",
      billingModuleType: "ai-social",
      resolveWallTimeCapMs: (input) =>
        WALL_TIME_BY_DEPTH[input.depth] ?? 30 * 60_000,
      resolveMaxCredits: (input) =>
        MAX_CREDITS_BY_PROFILE[input.budgetProfile] ?? 20,
      resolveBudgetMultiplier: (input) =>
        BUDGET_MULTIPLIER_BY_PROFILE[input.budgetProfile] ?? 1.0,
      createMissionRow: async ({
        missionId,
        userId,
        workspaceId,
        input,
        effectiveMaxCredits,
      }) => {
        const businessInput = {
          contentId: input.contentId,
          platforms: input.platforms,
          connectionIds: input.connectionIds,
          depth: input.depth,
          budgetProfile: input.budgetProfile,
        };
        await store.create({
          id: missionId,
          userId,
          workspaceId,
          contentId: input.contentId,
          platforms: input.platforms,
          connectionIds: input.connectionIds,
          depth: input.depth,
          budgetProfile: input.budgetProfile,
          language: input.language,
          maxCredits: effectiveMaxCredits,
          // ★ C5/G7（三 app 统一）：冻结 canonical config snapshot。
          configSnapshot: buildSocialConfigSnapshot({
            businessInput,
            language: input.language,
            maxCredits: effectiveMaxCredits,
            budgetMultiplier:
              BUDGET_MULTIPLIER_BY_PROFILE[input.budgetProfile] ?? 1.0,
            wallTimeCapMs: WALL_TIME_BY_DEPTH[input.depth] ?? 30 * 60_000,
          }),
        });
      },
      refreshHeartbeat: async (missionId, podId) => {
        await store.refreshHeartbeat(missionId, podId);
      },
      emitMissionEvent: async ({ type, missionId, userId, payload }) => {
        await eventBus
          .emit({
            type,
            scope: { missionId, userId },
            payload,
            timestamp: Date.now(),
          })
          .catch(() => {
            // schema 校验失败由 EventBus 自己 log，这里不阻断
          });
      },
    };
  }
}
