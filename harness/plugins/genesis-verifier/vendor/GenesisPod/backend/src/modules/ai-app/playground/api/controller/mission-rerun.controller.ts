/**
 * MissionRerunController —— playground 重跑 + Leader Chat post 端点
 *
 * 2026-05-15 PR-C god-class 拆分：抽 rerun + leader-chat post 类端点出来：
 *   - POST /missions/:id/rerun（全量重跑 fresh|incremental）
 *   - POST /missions/:id/todos/:todoId/rerun（单 todo 开新 mission）
 *   - POST /missions/:id/todos/:todoId/local-rerun（单 stage 局部重跑）
 *   - POST /missions/:id/leader-chat（用户向 Leader 提问）
 *
 * 读路径见 mission-read.controller.ts；lifecycle (run/cancel/delete/update/dev)
 * 见 playground.controller.ts。
 */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import {
  RateLimit,
  RateLimitGuard,
} from "../../../../../common/guards/rate-limit.guard";
import type { RequestWithUser } from "../../../../../common/types/express-request.types";
import { MissionOwnershipRegistry } from "@/modules/ai-harness/facade";
import { MissionEventBuffer } from "../../mission/lifecycle/mission-event-buffer.service";
import { MissionStore } from "../../mission/lifecycle/mission-store.service";
import { LeaderChatService } from "../../mission/chat/leader-chat.service";
import { LocalRerunService } from "../../mission/rerun/local-rerun.service";
import { MissionRerunOrchestratorService } from "../../mission/rerun/mission-rerun-orchestrator.service";
import { BaseMissionController } from "./base-mission.controller";

@Controller("playground")
@UseGuards(JwtAuthGuard)
export class MissionRerunController extends BaseMissionController {
  constructor(
    ownership: MissionOwnershipRegistry,
    store: MissionStore,
    private readonly buffer: MissionEventBuffer,
    private readonly leaderChat: LeaderChatService,
    private readonly localRerun: LocalRerunService,
    private readonly rerunOrchestrator: MissionRerunOrchestratorService,
  ) {
    super(ownership, store);
  }

  /**
   * POST /api/v1/playground/missions/:id/rerun?mode=fresh|incremental
   *
   * 用原 mission 的 userProfile 全字段启动新 mission：
   *   - mode=fresh       全新从头跑（清 checkpoint）— "开始"按钮语义
   *   - mode=incremental 跳过已完成 stage（clone checkpoint）— "更新"按钮语义
   * 默认 incremental（向后兼容）。
   */
  @Post("missions/:id/rerun")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    maxRequests: 30,
    windowSeconds: 60,
    message: "重跑 mission 过于频繁，请稍后再试",
  })
  async rerunMission(
    @Param("id") missionId: string,
    @Query("mode") mode: string | undefined,
    @Request() req: RequestWithUser,
  ): Promise<{ missionId: string; streamNamespace: string }> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    await this.assertOwnership(missionId, userId);
    const resolvedMode: "fresh" | "incremental" =
      mode === "fresh" ? "fresh" : "incremental";
    return this.rerunOrchestrator.rerunFullMission(
      missionId,
      userId,
      resolvedMode,
    );
  }

  /**
   * POST /api/v1/playground/missions/:id/todos/:todoId/rerun
   *
   * 单 todo 重跑 v1 —— 创建新 mission，沿用原 input + 注入 focusHint，
   *   让 leader 在 S2 plan 阶段重点优化该 dim/chapter/finding。
   *
   * 不允许重跑：origin = leader-assess-abort（已放弃）/ system:s11-persist（终态归档）。
   */
  @Post("missions/:id/todos/:todoId/rerun")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    maxRequests: 30,
    windowSeconds: 60,
    message: "todo 重跑过于频繁，请稍后再试",
  })
  async rerunTodo(
    @Param("id") missionId: string,
    @Param("todoId") todoId: string,
    @Body()
    body: {
      origin?: string;
      scope?: "dimension" | "chapter" | "review" | "system" | "mission";
      dimensionRef?: string;
      chapterIndex?: number;
      todoTitle?: string;
      reasonText?: string;
    },
    @Request() req: RequestWithUser,
  ): Promise<{ missionId: string; streamNamespace: string }> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    await this.assertOwnership(missionId, userId);
    return this.rerunOrchestrator.rerunFromTodo({
      sourceMissionId: missionId,
      userId,
      todoId,
      body,
    });
  }

  /**
   * POST /api/v1/playground/missions/:id/todos/:todoId/local-rerun
   *
   * 单 stage 局部重跑（B 路线）—— 与 rerunTodo 对偶：
   *   ✓ 复用原 missionId（不创建新 mission）
   *   ✓ 跑指定的 stage（按 todo.scope 路由）
   *   ✓ 产物 patch 回原 mission（markRerunPatch）
   *   ✓ 失败时原产物保留
   */
  @Post("missions/:id/todos/:todoId/local-rerun")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    maxRequests: 30,
    windowSeconds: 60,
    message: "局部重跑过于频繁，请稍后再试",
  })
  async localRerunTodo(
    @Param("id") missionId: string,
    @Param("todoId") todoId: string,
    @Body()
    body: {
      origin?: string;
      scope?: "dimension" | "chapter" | "review" | "system" | "mission";
      dimensionRef?: string;
      chapterIndex?: number;
      todoTitle?: string;
      reasonText?: string;
      stepId?: string;
    },
    @Request() req: RequestWithUser,
  ): Promise<{
    ok: true;
    missionId: string;
    scope: string;
    durationMs: number;
    cascade?: {
      completed: string[];
      abortedAt?: string;
      remaining?: string[];
    };
  }> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    await this.assertOwnership(missionId, userId);

    const result = await this.localRerun.run(
      {
        missionId,
        userId,
        todoId,
        origin: (body?.origin ?? "").trim(),
        scope: (body?.scope ?? "mission") as
          | "dimension"
          | "chapter"
          | "review"
          | "system"
          | "mission",
        dimensionRef: body?.dimensionRef?.trim() || undefined,
        chapterIndex: body?.chapterIndex,
        todoTitle: body?.todoTitle?.trim() || undefined,
        reasonText: body?.reasonText?.trim() || undefined,
        stepId: body?.stepId?.trim() || undefined,
      },
      // emit fn —— 直接走 buffer.broadcast（与老 rerunTodo 同款）
      async (args) => {
        await this.buffer.broadcast({
          type: args.type,
          scope: { missionId: args.missionId, userId: args.userId },
          payload: args.payload as Record<string, unknown>,
          timestamp: Date.now(),
        });
      },
    );
    return result;
  }

  /**
   * POST /api/v1/playground/missions/:id/leader-chat
   * Body: { content: string }
   * 用户向 Leader 提问 → 系统回复（基于 mission 上下文）→ 两条都持久化。
   */
  @Post("missions/:id/leader-chat")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    maxRequests: 30,
    windowSeconds: 60,
    message: "Leader Chat 请求过于频繁，请稍后再试",
  })
  async sendLeaderChat(
    @Param("id") missionId: string,
    @Body() body: { content?: string },
    @Request() req: RequestWithUser,
  ): Promise<{ user: unknown; assistant: unknown }> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    await this.assertOwnership(missionId, userId);
    // 先 trim 再校验长度 —— 否则大量空格的 4000 字符可绕过校验
    const content = (body?.content ?? "").toString().trim();
    if (!content) {
      throw new BadRequestException("content must be a non-empty string");
    }
    if (content.length > 4000) {
      throw new BadRequestException("content exceeds 4000 chars");
    }
    return this.leaderChat.send(missionId, userId, content);
  }
}
