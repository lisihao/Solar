/**
 * LocalRerunService — 单 stage 局部重跑入口（B 路线主调）
 *
 * 上游：docs/architecture/ai-harness/runner/per-task-rerun-with-cascade.md v1.2 §3.4
 *
 * 与老版 rerunTodo（创建新 mission）的核心区别：
 *   ✓ 复用原 missionId（不创建新 mission）
 *   ✓ 从 DB hydrate 上游产物 → MissionContext（不重跑 S1-S2-S3）
 *   ✓ 跑指定的 stage（按 stepId 路由 + cascade 链）
 *   ✓ patch 回 DB（markRerunPatch / markIntermediateState 只 update 受影响字段）
 *   ✓ 失败时已成 patch 保留（best-effort partial）
 *   ✓ 并发锁防同 todo 重入
 *
 * v1.2 PR-R6 新增（白→黑名单 + reopen + 频次 + 实时 cost）：
 *   ✓ 黑名单只拦 s1-budget；其它一律按 dag.rerunable 判断
 *   ✓ stepId 直接路由（前端 todo 卡片可指定 stepId）走 dispatcher.runFromStageWithCascade
 *   ✓ cascade 链终点是 s11-persist 且 mission status=failed → 自动 markReopened
 *   ✓ rerun_attempts 频次：单 (mission, step) 24h 内最多 5 次；超出 throw 429
 *   ✓ 实时 cost 守门：DB mission.cost_usd > max_credits → throw（防累积超支）
 *
 * 不允许：
 *   - origin = leader-assess-abort（已放弃）
 *   - stepId = s1-budget（预算闸）
 *   - mission 当前 status === 'running' 且 heartbeat < 60s（防覆盖在跑产物）
 */

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { CtxHydratorService } from "./ctx-hydrator.service";
import { RerunGuardService } from "./rerun-guard.service";
import {
  MissionLifecycleManager,
  RerunLockRegistry,
  ResolvedBudgetCaps,
} from "@/modules/ai-harness/facade";
import type { PlaygroundTerminalExtra } from "../lifecycle/mission-store.service";
import { StageRerunDispatcher } from "./stage-rerun.dispatcher";
import type { EmitFn } from "../context/mission-deps";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { MissionStore } from "../lifecycle/mission-store.service";
import { PLAYGROUND_PIPELINE } from "../../runtime/playground.config";

/** v1.2 §3.4: 黑名单 — 只拦"语义上不应重跑"的 stage（其它按 dag.rerunable 判断）。 */
const STAGE_RERUN_BLACKLIST = new Set<string>([
  "s1-budget", // 预算闸：重跑等于改用户 input 配置（应新建 mission）
]);

/** v1.2 §4.2: 单 (mission, step) 在 24h 内最多 5 次重跑（防滥用）。 */
// ★ 2026-05-08 用户反馈"429 限制过严"：原 5 次/24h 误伤正常调试场景（用户对
//   同一 stage 反复测试 5 次后剩下 24h 全部 429，错误消息又显示"过于频繁"
//   误导用户以为等几秒可重试）。cost guard（local-rerun.service.ts:193）已独立
//   防"无限重跑烧钱"，此频次限制改为反恶意脚本保底（50 次/24h），normal
//   user 调试不会触达。
const RERUN_FREQUENCY_LIMIT_PER_24H = 50;
const RERUN_FREQUENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** v1.2 §3.4: cascade 链终点是 S11 → reopen 让 markCompleted 能改 status。 */
const TERMINAL_STEP_ID = "s11-persist";

export interface LocalRerunInput {
  missionId: string;
  userId: string;
  todoId: string;
  origin: string;
  scope: "dimension" | "chapter" | "review" | "system" | "mission";
  /** v1.2 PR-R6 新增：直接传 stepId 路由（优先级 > scope/todoId） */
  stepId?: string;
  dimensionRef?: string;
  chapterIndex?: number;
  todoTitle?: string;
  reasonText?: string;
}

export interface LocalRerunResult {
  ok: true;
  missionId: string;
  scope: string;
  durationMs: number;
  /** v1.2 PR-R6 新增：cascade 路径下报告完成情况 */
  cascade?: {
    completed: string[];
    abortedAt?: string;
    remaining?: string[];
  };
}

export interface RerunEligibility {
  rerunable: boolean;
  reason?: string;
  /** v1.2 PR-R6 新增：stepId 路径下 cascade 链 */
  cascadeChain?: string[];
}

@Injectable()
export class LocalRerunService {
  private readonly log = new Logger(LocalRerunService.name);

  constructor(
    private readonly hydrator: CtxHydratorService,
    private readonly lockRegistry: RerunLockRegistry,
    private readonly dispatcher: StageRerunDispatcher,
    // ★ 全覆盖审计修 (2026-05-06): TOCTOU fix — 改为 prisma $transaction 原子校验
    private readonly prisma: PrismaService,
    private readonly store: MissionStore,
    // ★ 2026-05-07 rerun-overhaul v1.1：唯一 in-flight 判定单元（替代 line 206 的旧检查）
    private readonly rerunGuard: RerunGuardService,
    // ★ C0/G1：cascade-aborted 终态写经 finalize 单入口仲裁。
    private readonly lifecycleManager: MissionLifecycleManager,
  ) {}

  /**
   * 判断 todo 是否能用 local-rerun（vs 老版 fresh rerun）
   *
   * v1.2 PR-R6 修订：
   *   - 优先看 stepId（todo 关联的 pipeline step）
   *   - stepId 在黑名单 / dag.rerunable=false → 拒绝
   *   - 否则给出 cascade 预览链
   *   - 老路径：scope=system + todoId 含 s9b-objective-evaluation 仍允许（兼容）
   */
  static isLocallyRerunable(args: {
    origin: string;
    scope: string;
    todoId: string;
    stepId?: string;
  }): RerunEligibility {
    if (args.origin === "leader-assess-abort") {
      return { rerunable: false, reason: "已放弃的维度无法重跑" };
    }

    // 优先 stepId 路由
    if (args.stepId) {
      if (STAGE_RERUN_BLACKLIST.has(args.stepId)) {
        return {
          rerunable: false,
          reason: `${args.stepId} 不可重跑（黑名单）`,
        };
      }
      const step = PLAYGROUND_PIPELINE.steps.find((s) => s.id === args.stepId);
      if (!step) {
        return { rerunable: false, reason: `未知 step: ${args.stepId}` };
      }
      if (!step.dag?.rerunable) {
        return {
          rerunable: false,
          reason:
            step.dag?.rerunableReason ??
            `${args.stepId} 不可重跑（dag.rerunable=false）`,
        };
      }
      return {
        rerunable: true,
        cascadeChain: [args.stepId, ...step.dag.successors],
      };
    }

    // 老路径：scope-based（保留 v1 路径）
    if (args.todoId.endsWith("s11-persist")) {
      return {
        rerunable: false,
        reason: "持久化阶段不能局部重跑（请用 stepId 路由）",
      };
    }
    if (
      args.scope === "system" &&
      args.todoId.endsWith("s9b-objective-evaluation")
    ) {
      return { rerunable: true };
    }
    return {
      rerunable: false,
      reason: `${args.scope} 类型暂未支持（请用 stepId 路由）`,
    };
  }

  /**
   * 入口：执行单 stage 局部重跑
   * 调用方应直接 fire-and-forget，外部用事件流跟踪进度。
   */
  async run(input: LocalRerunInput, emit: EmitFn): Promise<LocalRerunResult> {
    const { missionId, userId, todoId, origin, scope, stepId } = input;
    const t0 = Date.now();

    // ── 1. 资格闸 ──
    const eligibility = LocalRerunService.isLocallyRerunable({
      origin,
      scope,
      todoId,
      stepId,
    });
    if (!eligibility.rerunable) {
      throw new BadRequestException(eligibility.reason ?? "局部重跑不允许");
    }

    // ── 2. in-flight + zombie 判定（rerun-overhaul v1.1）──
    // 唯一 in-flight 判定单元：RerunGuardService 内部做 9-cell 矩阵 + zombie 主动 cleanup。
    // 删除原 line 202-214 单 heartbeat 判定（与 ctx-hydrator 阈值/文案不一致 + 不区分 lifecycle vs business 事件 → 因果倒置真因）。
    await this.rerunGuard.ensureRerunable(missionId, userId);

    // ── 3. 实时 cost guard（事务内原子）──
    await this.prisma.$transaction(async (tx) => {
      const exists = await tx.agentPlaygroundMission.findFirst({
        where: { id: missionId, userId },
        select: {
          id: true,
          costUsd: true,
          maxCredits: true,
        },
      });
      if (!exists) {
        throw new NotFoundException(
          `mission ${missionId} not found or not owned by ${userId}`,
        );
      }
      // 实时 cost guard：累积成本超额度代理上限 → 拒绝（防 rerun 无限烧钱）。
      // ★ C3a/G4 修正:原代码把 costUsd(USD)直接和 maxCredits(credits)比,单位错配。
      //   走 ResolvedBudgetCaps 把 credits 换成额度代理 USD(creditBudgetProxyUsd)再比同单位。
      if (
        typeof exists.maxCredits === "number" &&
        typeof exists.costUsd === "number" &&
        exists.maxCredits > 0
      ) {
        const budgetProxyUsd = ResolvedBudgetCaps.resolve({
          maxCredits: exists.maxCredits,
        }).creditBudgetProxyUsd;
        if (exists.costUsd >= budgetProxyUsd) {
          throw new BadRequestException(
            `mission 累积 cost ${exists.costUsd.toFixed(4)} USD 已达额度代理上限 ${budgetProxyUsd.toFixed(4)} USD（maxCredits=${exists.maxCredits}），拒绝重跑`,
          );
        }
      }
    });

    // ── 4. 频次闸（24h 内同 (mission, step) 最多 5 次）──
    if (stepId) {
      await this.enforceRerunFrequency(missionId, userId, stepId);
    }

    // ── 5. 并发锁 ──
    if (!(await this.lockRegistry.acquire(missionId, todoId))) {
      throw new BadRequestException(
        "该任务正在重跑，请等待当前一轮完成后再操作",
      );
    }

    // ── 5b. 频次表写一笔（成功失败都写）──
    // ★ 收尾评审 P0-S3 (2026-05-07): 原实现仅成功路径写 → 用户连续触发 LLM 失败可
    //   绕过 5/24h 配额。改为 lock acquired 后立刻写一笔，不论后续成功/失败都计入频次。
    if (stepId) {
      await this.recordRerunAttempt(missionId, userId, stepId).catch(
        (err: unknown) => {
          this.log.warn(
            `[local-rerun ${missionId}] recordRerunAttempt failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
          );
        },
      );
    }

    // ── 6. emit started ──
    await emit({
      type: "playground.mission:rerun-started",
      missionId,
      userId,
      payload: {
        todoId,
        origin,
        scope,
        stepId,
        cascadeChain: eligibility.cascadeChain,
        dimensionRef: input.dimensionRef,
        chapterIndex: input.chapterIndex,
        todoTitle: input.todoTitle,
        startedAtMs: t0,
      },
    }).catch((err: unknown) => {
      this.log.warn(
        `[local-rerun ${missionId}] emit rerun-started failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    try {
      // ── 7. 必要时 reopen（cascade 终点是 S11 + status=failed）──
      if (stepId) {
        await this.maybeReopen(missionId, userId, eligibility.cascadeChain);
      }

      // ── 8. hydrate ctx ──
      // ★ 2026-05-07 c195035f bug fix：hydrate 此处读到的字段是原 mission **旧值**
      //   （cascade dispatcher 已删 reset-before-rerun，主行字段不再被预清成 NULL）。
      //   旧值即"上次跑剩下的产物"，作为 best-effort partial 的基础 — stage 跑成功
      //   覆盖、跑失败保留。详见 stage-rerun.dispatcher.runFromStageWithCascade 注释。
      const ctx = await this.hydrator.hydrate(missionId, userId);

      // ★ 2026-05-29 单维度 scope 重跑：s3 重跑且带 dimensionRef → 只重跑该维度，
      //   其余维度复用 hydrate 出的已有产物（s3 handler 读 ctx.focusDimension 处理）。
      if (stepId === "s3-researcher-collect" && input.dimensionRef) {
        ctx.focusDimension = input.dimensionRef;
      }

      // ── 9. dispatch（stepId 路径走 cascade，老路径走 scope dispatch）──
      let cascade: LocalRerunResult["cascade"];
      if (stepId) {
        const result = await this.dispatcher.runFromStageWithCascade({
          ctx,
          fromStepId: stepId,
          emit,
        });
        cascade = {
          completed: result.completed,
          abortedAt: result.abortedAt,
          remaining: result.remaining,
        };
        // best-effort partial：如果 abortedAt 存在仍正常返回（不 throw），但 emit completed/aborted
        if (result.abortedAt) {
          this.log.warn(
            `[local-rerun ${missionId}] cascade aborted at ${result.abortedAt}: ${result.errorMessage}`,
          );
          // ★ 收尾评审 P0-T2 (2026-05-07): cascade aborted 时 mission status 必须回写 failed。
          //   原实现只 log.warn 后正常 return → mission 卡 running 直到 LivenessGuard
          //   超时清理（5-15min），用户体验极差。现在显式 writeFailed 让 status 同步。
          //   仅当 maybeReopen 真改过 status 时才回写（cascadeChain 含 s11 的路径）。
          const reachesTerminal =
            !!eligibility.cascadeChain &&
            eligibility.cascadeChain.includes(TERMINAL_STEP_ID);
          if (reachesTerminal) {
            // ★ C0/G1：终态写经 finalize 单入口仲裁（条件写 WHERE status='running' 首写赢）
            // ★ 收尾评审第三轮 P0-S (2026-05-07): 传 userId 走严格隔离路径
            await this.lifecycleManager
              .finalize<PlaygroundTerminalExtra>({
                missionId,
                intent: {
                  status: "failed",
                  extra: {
                    kind: "failed",
                    detail: {
                      // ★ 2026-05-30：用户面 errorMessage 去掉 cascade_aborted_at_ 技术前缀
                      //   （abortedAt 已在上方 log.warn 留痕）。stage 抛出的消息本身已按
                      //   mission 语言本地化（见 s4 abort 文案），直接透传。
                      errorMessage: (
                        result.errorMessage ??
                        `重跑在阶段 ${result.abortedAt} 中止`
                      ).slice(0, 500),
                    },
                    userId,
                  },
                },
                arbiter: this.store,
              })
              .catch((err: unknown) => {
                this.log.warn(
                  `[local-rerun ${missionId}] finalize after cascade abort failed: ${err instanceof Error ? err.message : String(err)}`,
                );
              });
          }
        }
      } else {
        // 老路径：scope dispatch
        await this.dispatcher.dispatch({ ctx, input, emit });
      }

      // ── 11. emit completed ──
      const durationMs = Date.now() - t0;
      await emit({
        type: "playground.mission:rerun-completed",
        missionId,
        userId,
        payload: {
          todoId,
          scope,
          stepId,
          cascade,
          durationMs,
        },
      }).catch((err: unknown) => {
        this.log.warn(
          `[local-rerun ${missionId}] emit rerun-completed failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

      this.log.log(
        `[local-rerun ${missionId}] todo=${todoId} scope=${scope} stepId=${stepId ?? "n/a"} done in ${durationMs}ms`,
      );
      return { ok: true, missionId, scope, durationMs, cascade };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(
        `[local-rerun ${missionId}] todo=${todoId} scope=${scope} failed: ${message}`,
      );
      await emit({
        type: "playground.mission:rerun-failed",
        missionId,
        userId,
        payload: {
          todoId,
          scope,
          stepId,
          errorMessage: message,
          durationMs: Date.now() - t0,
        },
      }).catch((emitErr: unknown) => {
        this.log.warn(
          `[local-rerun ${missionId}] emit rerun-failed failed: ${emitErr instanceof Error ? emitErr.message : String(emitErr)}`,
        );
      });
      throw err;
    } finally {
      await this.lockRegistry.release(missionId, todoId);
    }
  }

  // ──────────────────────────── helpers ────────────────────────────

  /**
   * v1.2 §4.2: 24h 内同 (mission, step) 最多 5 次重跑。
   * 超限 → throw 429。
   */
  private async enforceRerunFrequency(
    missionId: string,
    userId: string,
    stepId: string,
  ): Promise<void> {
    // ★ 收尾评审 P0-S1 (2026-05-07): userId 加入 where 隔离 —
    //   设计上频次检查应按用户隔离，原实现 _userId 被丢弃是缺陷。
    //   未来若有 admin / WebSocket / batch 等绕过 controller assertOwnership 的入口，
    //   userId 隔离仍是深度防御的最后一层。
    const since = new Date(Date.now() - RERUN_FREQUENCY_WINDOW_MS);
    const count = await this.prisma.agentPlaygroundRerunAttempt.count({
      where: {
        missionId,
        userId,
        stepId,
        triggeredAt: { gte: since },
      },
    });
    if (count >= RERUN_FREQUENCY_LIMIT_PER_24H) {
      // ★ 2026-05-08：错误消息明确说明是 "24h 长窗口" 限制，与控制器层 30/60s
      //   短窗口限流区分（避免用户混淆等几秒就能重试）。
      throw new HttpException(
        `该 stage (${stepId}) 在过去 24 小时已重跑 ${count} 次，达到 ${RERUN_FREQUENCY_LIMIT_PER_24H} 次保底上限（防恶意脚本）。请新建 mission 或等待 24 小时后再试。`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordRerunAttempt(
    missionId: string,
    userId: string,
    stepId: string,
  ): Promise<void> {
    await this.prisma.agentPlaygroundRerunAttempt.create({
      data: {
        missionId,
        userId,
        stepId,
        triggeredAt: new Date(),
      },
    });
  }

  /**
   * v1.2 §3.4: cascade 链终点是 S11 + mission 当前 failed/quality-failed/cancelled →
   * 调 markReopened 让 S11 之后的 markCompleted 能改 status。
   * ★ 2026-05-30：加入 cancelled —— 被取消的 mission 点重跑也应能复活，否则 cascade
   *   跑了却改不动终态，重跑的真实失败（额度耗尽等）写不回也显示不出来。
   */
  private async maybeReopen(
    missionId: string,
    userId: string,
    cascadeChain: string[] | undefined,
  ): Promise<void> {
    if (!cascadeChain || cascadeChain.length === 0) return;
    const reachesTerminal =
      cascadeChain[cascadeChain.length - 1] === TERMINAL_STEP_ID ||
      cascadeChain.includes(TERMINAL_STEP_ID);
    if (!reachesTerminal) return;

    const detail = await this.store.getById(missionId, userId);
    if (!detail) return;

    if (
      detail.status === "failed" ||
      detail.status === "quality-failed" ||
      detail.status === "cancelled"
    ) {
      try {
        await this.store.markReopened(missionId, userId);
        this.log.log(
          `[local-rerun ${missionId}] reopened from status=${detail.status} (cascade reaches terminal)`,
        );
      } catch (err) {
        // markReopened 内部已对 5×5 状态矩阵做校验；这里 catch 防御漏网
        this.log.warn(
          `[local-rerun ${missionId}] markReopened skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
