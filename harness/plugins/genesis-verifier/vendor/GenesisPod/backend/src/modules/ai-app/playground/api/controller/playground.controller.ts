/**
 * AgentPlaygroundController — 后端 mission lifecycle REST 入口
 *
 * 2026-05-15 PR-C god-class 拆分（原 856 行）：
 *   - mission-read.controller.ts   GET /missions /resumable /:id /export /report-versions /replay /leader-chat list /error-report
 *   - mission-rerun.controller.ts  POST /:id/rerun /todos/:todoId/rerun /todos/:todoId/local-rerun /leader-chat send
 *   - 本 controller (lifecycle)     POST /team/run /dev/trigger-mission /:id/cancel  DELETE /:id  PATCH /:id
 *
 * 三个 controller 共享 BaseMissionController 的 assertOwnership。
 *
 * TODO PR-C-后续：playground-pipeline-dispatcher.service.ts 仍 1073 行 god-class，
 *   待 W22 接到 mission-event-buffer 下沉 (PR-4) 时一起整改。
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { randomUUID, timingSafeEqual } from "crypto";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import {
  RateLimit,
  RateLimitGuard,
} from "../../../../../common/guards/rate-limit.guard";
import { DistributedRateLimitGuard } from "../../../../../common/guards/distributed-rate-limit.guard";
import { Public } from "../../../../../common/decorators/public.decorator";
import type { RequestWithUser } from "../../../../../common/types/express-request.types";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { AuditLogService } from "@/modules/platform/facade";
import {
  RunMissionInputSchema,
  type RunMissionInput,
  listBudgetTiers,
  BUDGET_FIELD_LIMITS,
  type BudgetTierView,
} from "../dto/run-mission.dto";
import {
  MissionElectionTracker,
  MissionOwnershipRegistry,
} from "@/modules/ai-harness/facade";
import { MissionEventBuffer } from "../../mission/lifecycle/mission-event-buffer.service";
import {
  MissionStore,
  MAX_CONCURRENT_RUNNING_MISSIONS,
} from "../../mission/lifecycle/mission-store.service";
import {
  MissionAbortRegistry,
  MissionAbortReason,
  MissionLifecycleManager,
  EventBus,
} from "@/modules/ai-harness/facade";
import type { PlaygroundTerminalExtra } from "../../mission/lifecycle/mission-store.service";
// ★ R2-C 单轨化（2026-05-04）：pipeline-v1 现在是唯一 mission 路径。
import { PlaygroundPipelineDispatcher } from "../../mission/pipeline/playground.pipeline";
import { BaseMissionController } from "./base-mission.controller";

@Controller("playground")
@UseGuards(JwtAuthGuard)
export class AgentPlaygroundController extends BaseMissionController {
  private readonly log = new Logger(AgentPlaygroundController.name);

  constructor(
    ownership: MissionOwnershipRegistry,
    store: MissionStore,
    private readonly buffer: MissionEventBuffer,
    private readonly abortRegistry: MissionAbortRegistry,
    private readonly prisma: PrismaService,
    private readonly electionTracker: MissionElectionTracker,
    private readonly pipelineDispatcher: PlaygroundPipelineDispatcher,
    // ★ C0/G1：取消终态写经 finalize 单入口仲裁，不再直写 store.markCancelled。
    private readonly lifecycleManager: MissionLifecycleManager,
    // ★ E32 (2026-05-25): runMission 建行前早爆时补发终态事件，防前端死轮询。
    private readonly eventBus: EventBus,
    // ★ WS-Audit (2026-05-30): mission 取消/删除高敏操作 append-only 审计留痕。
    private readonly auditLog: AuditLogService,
  ) {
    super(ownership, store);
  }

  /**
   * GET /api/v1/playground/budget-tiers
   *
   * ★ 2026-05-22 ③J/K 契约单一源：调研规模档位(label/成本/时长/维度提示/数值)+ 预算字段
   * 上下限的**唯一真源**是后端 DEPTH_BUDGET_TIERS / BUDGET_FIELD_LIMITS。前端不再手写
   * SCALE_TIERS 镜像,改 fetch 本端点渲染,杜绝"前后端各维护一份 → 漂移"。
   */
  @Get("budget-tiers")
  getBudgetTiers(): {
    tiers: BudgetTierView[];
    limits: typeof BUDGET_FIELD_LIMITS;
  } {
    return { tiers: listBudgetTiers(), limits: BUDGET_FIELD_LIMITS };
  }

  private isDevTriggerAuthorized(presentedToken?: string): boolean {
    const expectedToken = process.env.AGENT_PLAYGROUND_DEV_TRIGGER_TOKEN;
    if (!expectedToken || !presentedToken) return false;
    const expected = Buffer.from(expectedToken);
    const presented = Buffer.from(presentedToken);
    return (
      expected.length === presented.length &&
      timingSafeEqual(expected, presented)
    );
  }

  /**
   * POST /api/v1/playground/dev/trigger-mission
   *
   * 内部触发端点 —— 让外部脚本（npm scripts / sh / curl）能启动 mission，
   * 不依赖前端 / JWT。鉴权方式：必须传 userApiKeyId（user_api_keys 表主键 UUID），
   * 后端校验该 id 真实存在 → 反查 user_id → 启动 mission。
   *
   * 这等价于"持有 BYOK API 密钥记录的 ID"才能触发，相当于密钥所有人凭证。
   * 不公开访问（id 是 UUID v4，不可猜测，且需要数据库直接读取才能拿到）。
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ maxRequests: 3, windowSeconds: 60, keyType: "ip" })
  @Post("dev/trigger-mission")
  async devTriggerMission(
    @Body()
    body: { userApiKeyId: string; input: unknown; internalToken?: string },
    @Headers("x-playground-token") headerToken?: string,
  ): Promise<{ missionId: string }> {
    // ★ WS-DEV (2026-05-30): 生产环境彻底关闭该内部触发端点，避免弱鉴权敞口。
    //   抛 NotFoundException 使端点在生产环境表现为"不存在"，不暴露其存在性。
    if (process.env.NODE_ENV === "production") {
      throw new NotFoundException();
    }
    if (!this.isDevTriggerAuthorized(headerToken ?? body?.internalToken)) {
      throw new ForbiddenException("dev trigger disabled or unauthorized");
    }
    if (!body?.userApiKeyId) {
      throw new BadRequestException("userApiKeyId required");
    }
    // 反查 user_id —— prisma typed accessor 名为 userApiKey
    const apiKey = await this.prisma.userApiKey.findUnique({
      where: { id: body.userApiKeyId },
      select: { userId: true },
    });
    if (!apiKey) {
      throw new ForbiddenException(
        `userApiKeyId ${body.userApiKeyId} not found`,
      );
    }
    const userId = apiKey.userId;
    const parsed = RunMissionInputSchema.safeParse(body.input);
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid input: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}:${i.message}`)
          .join("; ")}`,
      );
    }
    const input: RunMissionInput = parsed.data;
    const missionId = randomUUID();
    this.ownership.assign(missionId, userId);
    void this.pipelineDispatcher
      .runMission(missionId, input, userId)
      .catch((err: unknown) => {
        this.log.error(
          `dev-trigger mission ${missionId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    return { missionId };
  }

  /**
   * POST /api/v1/playground/team/run
   *
   * fire-and-forget：立刻返回 missionId，mission 在后台跑，前端通过 socket join 监听事件。
   * 同时 /replay 端点提供 polling fallback。
   */
  @Post("team/run")
  // ★ E4 修 (2026-05-25): 用 Redis 分布式限流（多 pod 共享窗口），替代内存版
  //   RateLimitGuard（每 pod 独立 → N×30/min 可绕）。Redis 不可用时该 guard
  //   自动降级内存，行为不退化。decorator/metadata 与内存版完全一致。
  @UseGuards(DistributedRateLimitGuard)
  @RateLimit({
    maxRequests: 30,
    windowSeconds: 60,
    message: "启动 mission 过于频繁，请稍后再试",
  })
  async runTeam(
    @Body() body: unknown,
    @Request() req: RequestWithUser,
  ): Promise<{ missionId: string; streamNamespace: string }> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");

    // ★ P0 并发限制：每 user 最多 N 个并发 running mission，防止单用户打爆 pod。
    //   这里是「快速失败 UX 预检」；真正堵 TOCTOU race 的原子兜底在
    //   MissionStore.createMission（advisory-lock + count + insert 同事务）。
    // ★ auto-supersede（2026-06-07）：撞并发上限时不再直接 400 卡死用户，而是自动
    //   取消用户**自己最旧**的 running mission 腾位。bounded：只动该用户自己的 mission、
    //   只取消最旧、循环到低于上限或无可取消为止（supersedeGuard 防御异常死循环）。
    let running = await this.store.countRunningByUser(userId);
    let supersedeGuard = 0;
    while (
      running >= MAX_CONCURRENT_RUNNING_MISSIONS &&
      supersedeGuard <= MAX_CONCURRENT_RUNNING_MISSIONS
    ) {
      supersedeGuard += 1;
      const oldest = await this.store.findOldestRunningMissionId(userId);
      if (!oldest) break;
      await this.supersedeRunningMission(oldest, userId);
      running = await this.store.countRunningByUser(userId);
    }
    if (running >= MAX_CONCURRENT_RUNNING_MISSIONS) {
      throw new BadRequestException(
        `已有 ${running} 个 mission 正在运行，自动顶替最旧后仍超过上限 ${MAX_CONCURRENT_RUNNING_MISSIONS}，请稍后再试`,
      );
    }

    const parsed = RunMissionInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid input: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}:${i.message}`)
          .join("; ")}`,
      );
    }
    const input: RunMissionInput = parsed.data;
    const missionId = randomUUID();

    this.ownership.assign(missionId, userId);

    // ★ R2-C 单轨化：pipelineDispatcher 是唯一 mission 入口
    void this.pipelineDispatcher
      .runMission(missionId, input, userId)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`mission ${missionId} failed: ${msg}`);
        // ★ E32 (2026-05-25): runMission 在建行前/建行时抛（并发上限拒绝、
        //   openSession 早爆、createMission 失败）时 DB 可能无 row，前端会对
        //   missionId 永久轮询。补发 mission:failed 终态事件让前端解卡。dispatcher
        //   已自行处理的常见路径会重复一发，但终态事件幂等无害。
        void this.eventBus
          .emit({
            type: "playground.mission:failed",
            scope: { missionId, userId },
            payload: {
              message: msg,
              failureCode: "MISSION_START_FAILED",
              source: "controller",
            },
            timestamp: Date.now(),
          })
          .catch(() => {});
      });

    return { missionId, streamNamespace: "playground" };
  }

  /**
   * POST /api/v1/playground/missions/:id/cancel
   * 取消运行中的 mission：DB 状态置为 cancelled，前端停止 polling。
   */
  @Post("missions/:id/cancel")
  async cancelMission(
    @Param("id") missionId: string,
    @Request() req: RequestWithUser,
  ): Promise<{ ok: true; status: string; alreadyCancelled?: true }> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    await this.assertOwnership(missionId, userId);

    const persisted = await this.store.getById(missionId, userId);
    if (!persisted)
      throw new ForbiddenException(`mission ${missionId} not found`);
    // 已 cancelled 时幂等返回 200，不抛 400（双击取消场景）
    if (persisted.status === "cancelled") {
      return { ok: true, status: "cancelled", alreadyCancelled: true };
    }
    if (persisted.status !== "running") {
      throw new BadRequestException(
        `mission ${missionId} status is ${persisted.status}, not running`,
      );
    }
    // 真触发 abort signal，让正在跑的 LLM/tool call 立即中断
    this.abortRegistry.abort(missionId, MissionAbortReason.user_cancelled);
    // ★ C0/G1：终态写经 finalize 单入口仲裁（条件写 WHERE status='running' 首写赢）
    await this.lifecycleManager.finalize<PlaygroundTerminalExtra>({
      missionId,
      intent: {
        status: "cancelled",
        reason: MissionAbortReason.user_cancelled,
        extra: { kind: "cancelled" },
      },
      arbiter: this.store,
      onWon: async () => {
        this.electionTracker.clear(missionId);
        await this.buffer.broadcast({
          type: "playground.mission:cancelled",
          scope: { missionId, userId },
          payload: { reason: "user_cancelled", message: "用户取消" },
          timestamp: Date.now(),
        });
      },
    });
    // 高敏操作审计：mission 取消 append-only 留痕（写失败不阻断取消）
    await this.auditLog.record({
      actorUserId: userId,
      action: "mission.cancel",
      resourceType: "agent_playground_mission",
      resourceId: missionId,
      result: "success",
    });
    return { ok: true, status: "cancelled" };
  }

  /**
   * auto-supersede 用：取消该用户某个 running mission 腾出并发位（撞上限时）。
   * 复用 cancelMission 的终态仲裁链（abort → finalize 条件写 → broadcast），但用
   * 区别于手动取消的 message，且不做 ownership 断言（调用方已用 userId 查出本人 mission）。
   */
  private async supersedeRunningMission(
    missionId: string,
    userId: string,
  ): Promise<void> {
    this.abortRegistry.abort(missionId, MissionAbortReason.user_cancelled);
    await this.lifecycleManager.finalize<PlaygroundTerminalExtra>({
      missionId,
      intent: {
        status: "cancelled",
        reason: MissionAbortReason.user_cancelled,
        extra: { kind: "cancelled" },
      },
      arbiter: this.store,
      onWon: async () => {
        this.electionTracker.clear(missionId);
        await this.buffer.broadcast({
          type: "playground.mission:cancelled",
          scope: { missionId, userId },
          payload: {
            reason: "user_cancelled",
            message: "被新建 mission 自动顶替（已达并发上限）",
          },
          timestamp: Date.now(),
        });
      },
    });
    this.log.log(
      `[${missionId}] auto-superseded: user ${userId} started a new mission at concurrency cap`,
    );
  }

  /**
   * DELETE /api/v1/playground/missions/:id
   * 删除当前用户的某个 mission（仅删除 DB 记录，不影响已结束的 in-memory 状态）。
   *
   * 2026-05-12 FK 事故修复：running 状态 mission 直接删会让 background workers
   * （saveResearchResult / refreshHeartbeat）的 upsert/update 撞 FK 违约。
   * 要么先 cancel，要么进入终态后再 delete。
   */
  @Delete("missions/:id")
  async deleteMission(
    @Param("id") missionId: string,
    @Request() req: RequestWithUser,
  ): Promise<{ ok: true }> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    const persisted = await this.store.getById(missionId, userId);
    if (!persisted)
      throw new ForbiddenException(`mission ${missionId} not found`);
    if (persisted.status === "running") {
      throw new BadRequestException(
        `mission ${missionId} 状态为 running，请先 cancel 再 delete（直接删会让 background workers 撞 FK 违约）`,
      );
    }
    await this.store.deleteByUser(missionId, userId);
    this.electionTracker.clear(missionId);
    this.ownership.release(missionId);
    // 高敏操作审计：mission 删除 append-only 留痕（写失败不阻断删除）
    await this.auditLog.record({
      actorUserId: userId,
      action: "mission.delete",
      resourceType: "agent_playground_mission",
      resourceId: missionId,
      result: "success",
      metadata: { priorStatus: persisted.status },
    });
    return { ok: true };
  }

  /**
   * POST /api/v1/playground/missions/cleanup
   * 一键清理当前用户"已结束失败类" mission（failed / quality-failed / cancelled）。
   *
   * 状态白名单服务端硬编码：不删 running（FK 安全）、不删 completed（保留报告）。
   * 客户端不传状态、无法越权删除运行中/已完成。返回删除条数。
   */
  @Post("missions/cleanup")
  async cleanupMissions(
    @Request() req: RequestWithUser,
  ): Promise<{ ok: true; deleted: number }> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    const deleted = await this.store.deleteTerminalByUser(userId);
    await this.auditLog.record({
      actorUserId: userId,
      action: "mission.cleanup",
      resourceType: "agent_playground_mission",
      resourceId: userId,
      result: "success",
      metadata: {
        deleted,
        statuses: ["failed", "quality-failed", "cancelled"],
      },
    });
    return { ok: true, deleted };
  }

  /**
   * PATCH /api/v1/playground/missions/:id
   *
   * 修改 mission 配置：topic（任意状态可改）+ 预算字段（仅非运行状态可改）。
   *
   * 预算字段：
   *   - maxCredits：1 credit ≈ 1k tokens（范围见 BUDGET_FIELD_LIMITS.maxCredits 单一源）
   *   - budgetMultiplierOverride：每个 sub-agent token/iter 缩放（0.3 - 10）
   *   - wallTimeCapMs：mission 总时长上限毫秒（60000 - 86400000，即 1min-24h）
   * status 必须为 terminal（completed/cancelled/failed/quality-failed/rejected）；
   * 下一次「重跑」会读到新值生效。
   */
  @Patch("missions/:id")
  async updateMission(
    @Param("id") missionId: string,
    @Body()
    body: {
      topic?: string;
      maxCredits?: number;
      budgetMultiplierOverride?: number;
      wallTimeCapMs?: number;
    },
    @Request() req: RequestWithUser,
  ): Promise<{ ok: true }> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");

    // 入参先校验，再查 mission（保留 BadRequest 在 NotFound 前的语义）
    if (typeof body.topic === "string") {
      const topic = body.topic.trim();
      if (!topic) throw new BadRequestException("topic is required");
      if (topic.length > 500)
        throw new BadRequestException("topic exceeds 500 chars");
    }

    const persisted = await this.store.getById(missionId, userId);
    if (!persisted)
      throw new ForbiddenException(`mission ${missionId} not found`);

    // topic 任意状态可改
    if (typeof body.topic === "string") {
      await this.store.updateTopicByUser(missionId, userId, body.topic.trim());
    }

    // 预算字段仅非运行状态可改（store 层会再守一遍）
    const hasBudget =
      typeof body.maxCredits === "number" ||
      typeof body.budgetMultiplierOverride === "number" ||
      typeof body.wallTimeCapMs === "number";
    if (hasBudget) {
      if (
        typeof body.maxCredits === "number" &&
        (body.maxCredits < BUDGET_FIELD_LIMITS.maxCredits.min ||
          body.maxCredits > BUDGET_FIELD_LIMITS.maxCredits.max)
      ) {
        throw new BadRequestException(
          `maxCredits must be ${BUDGET_FIELD_LIMITS.maxCredits.min}..${BUDGET_FIELD_LIMITS.maxCredits.max}`,
        );
      }
      if (
        typeof body.budgetMultiplierOverride === "number" &&
        (body.budgetMultiplierOverride < 0.3 ||
          body.budgetMultiplierOverride > 10)
      ) {
        throw new BadRequestException(
          "budgetMultiplierOverride must be 0.3..10",
        );
      }
      if (
        typeof body.wallTimeCapMs === "number" &&
        (body.wallTimeCapMs < 60_000 || body.wallTimeCapMs > 1440 * 60_000)
      ) {
        throw new BadRequestException(
          "wallTimeCapMs must be 60000..86400000 (1min-24h)",
        );
      }
      const res = await this.store.updateBudgetByUser(missionId, userId, {
        maxCredits: body.maxCredits,
        wallTimeCapMs: body.wallTimeCapMs,
        budgetMultiplierOverride: body.budgetMultiplierOverride,
      });
      if (!res.ok) {
        if (res.reason === "non_terminal_status") {
          throw new BadRequestException(
            "Cannot edit budget while mission is running. Cancel first.",
          );
        }
        if (res.reason === "not_found") {
          throw new ForbiddenException(`mission ${missionId} not found`);
        }
        throw new BadRequestException(res.reason ?? "budget update failed");
      }
    }
    return { ok: true };
  }
}
