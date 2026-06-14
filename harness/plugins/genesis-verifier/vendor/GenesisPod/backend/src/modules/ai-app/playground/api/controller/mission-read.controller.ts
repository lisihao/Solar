/**
 * MissionReadController —— playground mission 只读端点
 *
 * 2026-05-15 PR-C god-class 拆分：原 playground.controller.ts 856 行 →
 * 拆 read / rerun / lifecycle 三 controller。本 controller 聚焦读路径：
 *   - GET /missions, /missions/resumable, /missions/:id
 *   - GET /missions/:id/export, /missions/:id/report-versions[/:version]
 *   - GET /missions/:id/leader-chat
 *   - GET /replay/:missionId
 *
 * 写路径见 mission-rerun.controller.ts 与 playground.controller.ts。
 */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import { UpdateVisibilityDto } from "../../../../../common/visibility";
import {
  RateLimit,
  RateLimitGuard,
} from "../../../../../common/guards/rate-limit.guard";
import { Public } from "../../../../../common/decorators/public.decorator";
import type { RequestWithUser } from "../../../../../common/types/express-request.types";
import {
  MissionCheckpointService,
  MissionOwnershipRegistry,
} from "@/modules/ai-harness/facade";
import { MissionEventBuffer } from "../../mission/lifecycle/mission-event-buffer.service";
import { MissionStore } from "../../mission/lifecycle/mission-store.service";
import { LeaderChatService } from "../../mission/chat/leader-chat.service";
import { MissionExportService } from "../../mission/export/mission-export.service";
import { MissionQueryService } from "../../mission/query/mission-query.service";
import { projectMissionView } from "../../mission/projectors/mission-view.projector";
import type {
  MissionViewEnvelope,
  PlaygroundDomainView,
} from "../contracts/view-state.contract";
import { BaseMissionController } from "./base-mission.controller";

@Controller("playground")
@UseGuards(JwtAuthGuard)
export class MissionReadController extends BaseMissionController {
  private readonly log = new Logger(MissionReadController.name);

  // ★ format 参数 whitelist（防路径注入 + 非预期格式 handler 触达）
  private static readonly ALLOWED_EXPORT_FORMATS = new Set([
    "md",
    "markdown",
    "json",
    "pdf",
    "docx",
    "csv-facts",
    "csv-citations",
  ]);

  constructor(
    ownership: MissionOwnershipRegistry,
    store: MissionStore,
    private readonly checkpoint: MissionCheckpointService,
    private readonly exportService: MissionExportService,
    private readonly buffer: MissionEventBuffer,
    private readonly leaderChat: LeaderChatService,
    // ★ B2-3 (2026-05-26 thinning plan)：canonical mission detail view
    private readonly missionQuery: MissionQueryService,
  ) {
    super(ownership, store);
  }

  /**
   * GET /api/v1/playground/missions/:id/view
   *
   * thinning plan §B2-3 canonical detail endpoint。
   *
   * 与现有 GET /missions/:id 的关系：sibling-route。该路由是 canonical truth
   * source（mission.status / stages / agents / resumable / rerunnableStages 等
   * §6 contract 锁定字段），现有 /missions/:id 仅作为 backward-compatible 兼容入口
   * （§6.9 disposition table 第三行），不重新定义 view 已暴露字段（§3.1 scope clarification）。
   *
   * Empty-state sentinels：reportArtifact / todoBoard 在 B3 才填实，B2 阶段返回
   * stable sentinel（plan §B2-3 第 4 条）。
   */
  @Get("missions/:id/view")
  async getMissionView(
    @Param("id") id: string,
    @Request() req: RequestWithUser,
  ): Promise<MissionViewEnvelope> {
    // ★ P-IDOR2：统一走 assertReadAccess（own ∨ PUBLIC，否则 404）。放行后按
    //   所有者身份载入 —— PUBLIC mission 跨用户可读时 loadInputs 内部 (id, userId)
    //   过滤需用所有者 id 命中行。
    const ownerId = await this.assertReadAccess(id, req.user?.id);
    const inputs = await this.missionQuery.loadInputs(id, ownerId);
    const view: PlaygroundDomainView = projectMissionView(inputs);
    return { view };
  }

  /**
   * GET /api/v1/playground/missions
   * 当前用户的 mission 列表（所有历史，按 startedAt 倒序）
   */
  @Get("missions")
  async listMissions(
    @Request() req: RequestWithUser,
  ): Promise<{ items: unknown[] }> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    const items = await this.store.listByUser(userId, 100);
    return { items };
  }

  /**
   * GET /api/v1/playground/missions/resumable
   * 列出当前用户有 checkpoint 的可恢复 mission
   */
  @Get("missions/resumable")
  async listResumable(@Request() req: RequestWithUser): Promise<{
    items: { missionId: string; savedAt: string; completedKeys: string[] }[];
  }> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    const snapshots = await this.checkpoint.listResumable(userId);
    return {
      items: snapshots.map((s) => ({
        missionId: s.missionId,
        savedAt: s.savedAt.toISOString(),
        completedKeys: s.completedKeys,
      })),
    };
  }

  /**
   * GET /api/v1/playground/missions/:id
   * 单个 mission 完整 detail（sibling 兼容路由，§6.9 disposition table）
   *
   * §6.9 收口：starting placeholder 语义由 canonical view 唯一拥有（见
   * GET /missions/:id/view，走 MissionQueryService.buildStartingPlaceholderInputs）。
   * 此路由不再自带 starting fallback：row 未持久化时 404；新代码应改吃 canonical view。
   */
  @Get("missions/:id")
  async getMission(
    @Param("id") id: string,
    @Request() req: RequestWithUser,
  ): Promise<{ mission: unknown }> {
    // ★ P-IDOR2：统一走 assertReadAccess（own ∨ PUBLIC，否则 404）。放行后按
    //   所有者身份取行，使 PUBLIC mission 跨用户可读。
    const ownerId = await this.assertReadAccess(id, req.user?.id);
    const mission = await this.store.getById(id, ownerId);
    if (mission) return { mission };
    throw new NotFoundException("Mission not found");
  }

  /**
   * GET /api/v1/playground/missions/:id/cost
   *
   * per-mission 成本明细 + 汇总（chargeback / showback / 审计）。台账由 CostLedgerStore
   * 逐 stage 落库，此前只在终态内部 SUM、无读端点暴露（PG-04）。走 assertReadAccess
   * （own ∨ PUBLIC，否则 404），与其余只读端点一致。
   */
  @Get("missions/:id/cost")
  async getMissionCost(
    @Param("id") id: string,
    @Request() req: RequestWithUser,
  ): Promise<{
    summary: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      costUsd: number;
      entryCount: number;
    };
    entries: Array<{
      id: string;
      stepId: string | null;
      role: string | null;
      model: string | null;
      promptTokens: number;
      completionTokens: number;
      costUsd: number;
      createdAt: string;
    }>;
  }> {
    await this.assertReadAccess(id, req.user?.id);
    const [summary, rows] = await Promise.all([
      this.store.sumCostByMission(id),
      this.store.listCostByMission(id),
    ]);
    return {
      summary,
      entries: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * PATCH /api/v1/playground/missions/:id/visibility
   * 多租户可见性切换（仅所有者）。
   */
  @Patch("missions/:id/visibility")
  async updateVisibility(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateVisibilityDto,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    return this.store.updateVisibility(userId, id, dto.visibility);
  }

  /**
   * GET /api/v1/playground/missions/:id/export?format=csv-facts|csv-citations|markdown
   * 数据集导出。format 走 whitelist，防路径注入。
   */
  @Get("missions/:id/export")
  async exportMission(
    @Param("id") id: string,
    @Query("format") format: string,
    @Request() req: RequestWithUser,
  ): Promise<{ filename: string; mimeType: string; content: string }> {
    if (!format || !MissionReadController.ALLOWED_EXPORT_FORMATS.has(format)) {
      throw new BadRequestException(
        `Invalid export format "${format ?? ""}". Allowed: ${[...MissionReadController.ALLOWED_EXPORT_FORMATS].join(", ")}`,
      );
    }
    // ★ P-IDOR2：统一走 assertReadAccess（own ∨ PUBLIC，否则 404）。放行后按
    //   所有者身份导出，使 PUBLIC mission 跨用户可导出。
    const ownerId = await this.assertReadAccess(id, req.user?.id);
    return this.exportService.export(id, ownerId, format);
  }

  /**
   * GET /api/v1/playground/missions/:id/report-versions
   * 报告版本列表（不含 reportFull，仅 summary 字段，用于版本切换器下拉）。
   */
  @Get("missions/:id/report-versions")
  async listMissionReportVersions(
    @Param("id") id: string,
    @Request() req: RequestWithUser,
  ): Promise<{
    items: Array<{
      version: number;
      versionLabel: string | null;
      reportTitle: string | null;
      reportSummary: string | null;
      finalScore: number | null;
      leaderSigned: boolean | null;
      triggerType: string;
      generatedAt: string;
    }>;
  }> {
    // ★ P-IDOR2：统一走 assertReadAccess（own ∨ PUBLIC，否则 404）。版本列表本身
    //   按 missionId 取（非 userId 过滤），访问决策交 assertReadAccess。
    await this.assertReadAccess(id, req.user?.id);
    const rows = await this.store.listReportVersions(id);
    return {
      items: rows.map((r) => ({
        version: r.version,
        versionLabel: r.versionLabel,
        reportTitle: r.reportTitle,
        reportSummary: r.reportSummary,
        finalScore: r.finalScore,
        leaderSigned: r.leaderSigned,
        triggerType: r.triggerType,
        generatedAt: r.generatedAt.toISOString(),
      })),
    };
  }

  /**
   * GET /api/v1/playground/missions/:id/report-versions/:version
   * 单版本完整 reportFull（用于版本切换时替换 ArtifactReader 的 artifact prop）。
   */
  @Get("missions/:id/report-versions/:version")
  async getMissionReportVersion(
    @Param("id") id: string,
    @Param("version") versionRaw: string,
    @Request() req: RequestWithUser,
  ): Promise<{
    version: number;
    versionLabel: string | null;
    triggerType: string;
    generatedAt: string;
    reportFull: unknown;
    changesFromPrev: unknown;
  }> {
    const version = Number.parseInt(versionRaw, 10);
    if (!Number.isFinite(version) || version <= 0) {
      throw new BadRequestException("version must be a positive integer");
    }
    // ★ P-IDOR2：统一走 assertReadAccess（own ∨ PUBLIC，否则 404）。单版本本身按
    //   (missionId, version) 取，访问决策交 assertReadAccess。
    await this.assertReadAccess(id, req.user?.id);
    const row = await this.store.getReportVersion(id, version);
    if (!row) {
      throw new BadRequestException(
        `Report version v${version} not found for mission ${id}`,
      );
    }
    return {
      version: row.version,
      versionLabel: row.versionLabel,
      triggerType: row.triggerType,
      generatedAt: row.generatedAt.toISOString(),
      reportFull: row.reportFull,
      changesFromPrev: row.changesFromPrev,
    };
  }

  /**
   * GET /api/v1/playground/replay/:missionId?since=<ts>
   * 从 MissionEventBuffer 读取累积事件。前端可：
   *   - 初次进页面用此端点 hydrate（防 socket 断线/掉包）
   *   - WS 失败时 polling 兜底
   */
  @UseGuards(RateLimitGuard)
  @RateLimit({ maxRequests: 60, windowSeconds: 60, keyType: "user" })
  @Get("replay/:missionId")
  async replay(
    @Param("missionId") missionId: string,
    @Query("since") since: string | undefined,
    @Request() req: RequestWithUser,
  ): Promise<{ events: readonly unknown[]; serverNow: number }> {
    // ★ P-IDOR2：只读端点改走 assertReadAccess（own ∨ PUBLIC ∨ SHARED+TopicMember，
    //   否则 404 不泄露存在性）。当前 store.getById 按 (id, userId) 过滤，故非所有者
    //   的 PUBLIC/SHARED 暂无 visibility 数据源 → 实际仍只放行 own（见 risks）。
    await this.assertReadAccess(missionId, req.user?.id);
    const sinceTs = since ? Number(since) : undefined;
    const ts = Number.isFinite(sinceTs as number)
      ? (sinceTs as number)
      : undefined;
    let events: readonly unknown[] = this.buffer.read(missionId, ts);
    // 兜底：内存空（Railway recycle 后），从 DB 持久化层读
    if (events.length === 0) {
      events = await this.buffer.readPersisted(missionId, ts);
    }
    return { events, serverNow: Date.now() };
  }

  /**
   * GET /api/v1/playground/missions/:id/leader-chat
   * 拉取该 mission 的 Leader 对话历史。
   */
  @Get("missions/:id/leader-chat")
  async listLeaderChat(
    @Param("id") missionId: string,
    @Request() req: RequestWithUser,
  ): Promise<{ messages: unknown[] }> {
    // ★ P-IDOR2：只读端点改走 assertReadAccess（own ∨ PUBLIC ∨ SHARED+TopicMember，
    //   否则 404）。详见 replay 注释与 base-mission.controller assertReadAccess。
    await this.assertReadAccess(missionId, req.user?.id);
    const messages = await this.leaderChat.list(missionId);
    return { messages };
  }

  /**
   * POST /api/v1/playground/error-report
   * 接收前端 mission detail ErrorBoundary 上报的渲染崩溃。仅写日志（Railway
   * stderr），不写 DB（避免崩溃风暴时打满 DB）。Logger.error 被 Railway
   * severity=error 索引便于告警。
   */
  @Public()
  @Post("error-report")
  async reportClientError(
    @Body()
    body: {
      missionId?: string;
      message?: string;
      stack?: string;
      digest?: string;
      pathname?: string;
      userAgent?: string;
      timestamp?: string;
    },
    @Request() req: RequestWithUser,
  ): Promise<{ ok: true }> {
    const userId = req.user?.id ?? "anon";
    const safeMessage = (body.message ?? "unknown").slice(0, 500);
    const safeStack = (body.stack ?? "").slice(0, 2000);
    const missionId = body.missionId ?? "unknown";
    this.log.error(
      `[ClientError] mission=${missionId} user=${userId} digest=${body.digest ?? ""} ` +
        `path=${body.pathname ?? ""} msg="${safeMessage}"`,
    );
    if (safeStack) this.log.error(`[ClientError] stack:\n${safeStack}`);
    return { ok: true };
  }
}
