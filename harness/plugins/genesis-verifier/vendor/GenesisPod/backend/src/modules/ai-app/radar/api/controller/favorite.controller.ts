/**
 * Favorite controller（B16）
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §4.2 §15 B3
 *
 * 路由：
 * - POST /api/v1/radar/signals/:signalId/favorite (toggle)
 * - GET  /api/v1/radar/favorites（用户收藏列表）
 *
 * 安全：JwtAuthGuard 必须先过；ownership 通过 userId 自然隔离
 */
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { IsString, IsUUID } from "class-validator";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import {
  RateLimit,
  RateLimitGuard,
} from "../../../../../common/guards/rate-limit.guard";
import type { RequestWithUser } from "../../../../../common/types/express-request.types";
import { FavoriteService } from "../../mission/services/briefing/favorite.service";

class ToggleFavoriteDto {
  @IsUUID("4")
  signalId!: string;
  @IsString()
  topicId!: string;
}

@Controller("radar")
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class FavoriteController {
  constructor(private readonly svc: FavoriteService) {}

  // PR-DR2 P1-B (X8 安全评审整改) — 防止 toggle 滥用 DB 写
  @RateLimit({ maxRequests: 30, windowSeconds: 60 })
  @Post("favorites/toggle")
  async toggle(
    @Request() req: RequestWithUser,
    @Body() dto: ToggleFavoriteDto,
  ): Promise<{ favorited: boolean }> {
    return this.svc.toggle({
      userId: req.user.id,
      signalId: dto.signalId,
      topicId: dto.topicId,
    });
  }

  @Get("favorites")
  async list(@Request() req: RequestWithUser, @Query("limit") limit?: string) {
    const lim = limit ? Math.max(1, Math.min(100, Number(limit) || 50)) : 50;
    // FC-6: 返回带 signal 内容的丰富列表，前端可直接渲染
    return this.svc.listForUserWithSignals(req.user.id, lim);
  }
}
