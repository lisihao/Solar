/**
 * BusinessAgentTeam — Mission Runtime Shell Framework
 *
 * 上提自 ai-app/playground/services/mission/workflow/mission-runtime-shell.service.ts @migrated-from
 * （2026-05-08 PR-E0）。通用 lifecycle (wallTimer / heartbeat / abort / cleanup) +
 * billing 装配 + validateModels / validateCredits 现作为框架骨架，业务方通过
 * IMissionRuntimeAdapter 注入业务专属决策。
 *
 * 4 层 timeout 守护语义保留（HTTP 120/300s + Liveness 5min + Wall 3-4h + Budget），
 * P0-1 audit (2026-05-06) 修法（try-finally 保证 abort 一定执行）保留。
 */

import { Injectable, Logger } from "@nestjs/common";
import { withUserContext } from "@/common/context";
import { MissionContext } from "@/common/context/mission-context";
import { BillingContext } from "@/modules/platform/credits/billing-context.store";
import { CreditsService } from "@/modules/platform/credits/credits.service";
// ★ 不走 @/modules/ai-harness/facade barrel：facade/index.ts 也 re-export 本 framework
//   (PR-E0)，构成 facade ⇄ framework 的模块循环加载，编译产物里
//   `__metadata("design:paramtypes", [..., facade_1.RuntimeEnvironmentService, ...])`
//   在 framework 加载时 facade 还没赋 RuntimeEnvironmentService → undefined →
//   NestJS DI 无法解析 ctor 参数 [1] → 启动崩溃。直接从 source 导入打破循环。
import { BillingRuntimeEnvAdapter } from "@/modules/ai-harness/guardrails/billing/billing-adapter";
import { MissionBudgetPool } from "@/modules/ai-harness/guardrails/budget/mission-budget-pool";
import { ResolvedBudgetCaps } from "@/modules/ai-harness/guardrails/budget/resolved-budget-caps";
import {
  MissionAbortRegistry,
  MissionAbortReason,
} from "../../../lifecycle/mission-lifecycle/abort-registry";
import { RuntimeEnvironmentService } from "../../../guardrails/runtime/runtime-environment.service";
import type {
  IMissionRuntimeAdapter,
  MissionRuntimeSession,
} from "../abstractions/mission-runtime-shell.interface";

@Injectable()
export class MissionRuntimeShellFramework {
  private readonly log = new Logger(MissionRuntimeShellFramework.name);

  constructor(
    private readonly credits: CreditsService,
    private readonly runtimeEnv: RuntimeEnvironmentService,
    private readonly abortRegistry: MissionAbortRegistry,
  ) {}

  async openSession<TInput>(args: {
    missionId: string;
    input: TInput;
    userId: string;
    workspaceId?: string;
    adapter: IMissionRuntimeAdapter<TInput>;
  }): Promise<MissionRuntimeSession> {
    const { missionId, input, userId, workspaceId, adapter } = args;
    const missionAbort = this.abortRegistry.register(missionId);
    const wallTimeCapMs = adapter.resolveWallTimeCapMs(input);
    this.log.log(
      `[${missionId}] mission wall-time = ${Math.round(wallTimeCapMs / 60000)}min ` +
        `(namespace=${adapter.eventNamespace})`,
    );

    const billing = new BillingRuntimeEnvAdapter(
      userId,
      workspaceId,
      this.credits,
      this.runtimeEnv,
    );
    const effectiveMaxCredits = adapter.resolveMaxCredits(input);
    const budgetMultiplier = adapter.resolveBudgetMultiplier(input);
    // ★ C3a/G4：换算收口到 ResolvedBudgetCaps.resolve()（唯一换算处），删散落 ×1000/×0.002。
    const pool = new MissionBudgetPool(
      ResolvedBudgetCaps.resolve({
        maxCredits: effectiveMaxCredits,
        budgetMultiplier,
      }).toTokenBudget(),
    );

    const wallTimer = setTimeout(() => {
      // ★ P0-1 (audit 2026-05-06): try-finally 保证 abortRegistry.abort 一定执行
      try {
        this.log.warn(
          `[${missionId}] mission wall-time exceeded (${wallTimeCapMs}ms) - auto abort`,
        );
        void adapter
          .emitMissionEvent({
            type: `${adapter.eventNamespace}.mission:budget-warning-hard`,
            missionId,
            userId,
            payload: {
              reason: "wall_time_exceeded",
              wallTimeCapMs,
            },
          })
          .catch((err) => {
            this.log.warn(
              `[${missionId}] wall-timer emit failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      } finally {
        try {
          missionAbort.abort(MissionAbortReason.mission_wall_time_exceeded);
        } catch (err) {
          this.log.error(
            `[${missionId}] wall-timer abort failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }, wallTimeCapMs);
    wallTimer.unref?.();

    let heartbeatTimer: NodeJS.Timeout | null = null;
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(wallTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      this.abortRegistry.unregister(missionId);
    };

    try {
      await this.validateModels({ missionId, userId, billing, adapter });
      await this.validateCredits({ missionId, userId, billing, adapter });

      await adapter.createMissionRow({
        missionId,
        userId,
        workspaceId,
        input,
        effectiveMaxCredits,
      });

      const podId =
        process.env.RAILWAY_REPLICA_ID ??
        process.env.HOSTNAME ??
        `local-${process.pid}`;
      void adapter.refreshHeartbeat(missionId, podId);
      heartbeatTimer = setInterval(() => {
        void adapter.refreshHeartbeat(missionId, podId);
      }, 30_000);
      heartbeatTimer.unref?.();

      return {
        missionId,
        userId,
        workspaceId,
        billing,
        pool,
        budgetMultiplier,
        missionAbort,
        wallTimeCapMs,
        cleanup,
      };
    } catch (err) {
      cleanup();
      throw err;
    }
  }

  async runWithinContext<T>(
    session: MissionRuntimeSession,
    billingModuleType: string,
    operationType: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return withUserContext(session.userId, () =>
      BillingContext.run(
        {
          userId: session.userId,
          moduleType: billingModuleType,
          operationType,
          referenceId: session.missionId,
        },
        // 2026-05-10 §3：把 missionId / userId 透到 MissionContext，让下游
        // SpecBasedAgent.electModelOrNull 能从 MissionElectionTracker 取到本
        // mission 已选过的 modelId，触发 diversity 评分（-10 × occurrences）。
        // 之前 business-team 整条链没 MissionContext.run，missionId 始终
        // undefined → tracker 取不到 previouslyElected → 模型坍缩。
        //
        // 2026-05-11 fix：不再把 missionId 灌进 agentProcessId 槽 —— 那个槽是
        // FK→agent_processes.id 的真 AgentProcess id，business-team 链路从未
        // 调 MissionExecutor.execute() 创建 AgentProcess 行，伪填会让 EventJournal
        // 每次 INSERT 都 FK 23503。tracker 读的是 missionId 槽，单一 missionId
        // 字段够了。
        () =>
          MissionContext.run(
            {
              missionId: session.missionId,
              userId: session.userId,
            },
            fn,
          ),
      ),
    );
  }

  private async validateModels<TInput>(args: {
    missionId: string;
    userId: string;
    billing: BillingRuntimeEnvAdapter;
    adapter: IMissionRuntimeAdapter<TInput>;
  }): Promise<void> {
    try {
      const allModels = await args.billing.listAvailableModels();
      const healthy = allModels.filter((m) => m.available);
      if (allModels.length > 0 && healthy.length === 0) {
        const ids = allModels.map((m) => m.modelId).join(", ");
        const msg =
          `用户 BYOK 配置的所有模型均不可用：${ids}。` +
          `请前往 设置 → 模型 检查 model id 是否真实存在 / API key 是否有效`;
        await args.adapter.emitMissionEvent({
          type: `${args.adapter.eventNamespace}.mission:rejected`,
          missionId: args.missionId,
          userId: args.userId,
          payload: {
            reason: "no_healthy_model",
            availableCount: 0,
            totalCount: allModels.length,
            userMessage: msg,
          },
        });
        throw new Error(msg);
      }
      if (healthy.length === 1) {
        await args.adapter
          .emitMissionEvent({
            type: `${args.adapter.eventNamespace}.mission:warning`,
            missionId: args.missionId,
            userId: args.userId,
            payload: {
              code: "SINGLE_MODEL_NO_FALLBACK",
              modelId: healthy[0].modelId,
              userMessage:
                `当前仅启用 1 个模型 (${healthy[0].modelId})，` +
                `若该模型 rate-limit 或临时故障，mission 将无 fallback。` +
                `建议在 设置 → 模型 启用 2+ 模型作为备份`,
            },
          })
          .catch(() => {});
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("BYOK 配置")) {
        throw err;
      }
      this.log.warn(
        `[${args.missionId}] validateModels non-fatal error (namespace=${args.adapter.eventNamespace}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async validateCredits<TInput>(args: {
    missionId: string;
    userId: string;
    billing: BillingRuntimeEnvAdapter;
    adapter: IMissionRuntimeAdapter<TInput>;
  }): Promise<void> {
    const credit = await args.billing.getCreditState();
    if (credit.balance <= (credit.hardLimit ?? 0)) {
      const hint = await args.billing.suggestFallback({ reason: "no_credit" });
      await args.adapter.emitMissionEvent({
        type: `${args.adapter.eventNamespace}.mission:rejected`,
        missionId: args.missionId,
        userId: args.userId,
        payload: {
          reason: "no_credit",
          balance: credit.balance,
          userMessage: hint.userMessage,
        },
      });
      throw new Error(hint.userMessage ?? "Credit balance too low");
    }
  }
}
