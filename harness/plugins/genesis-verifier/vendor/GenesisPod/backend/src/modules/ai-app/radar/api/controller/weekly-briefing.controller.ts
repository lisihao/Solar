/**
 * WeeklyBriefing controller — FC-5 收尾
 *
 * 路由：
 * - GET /api/v1/radar/topics/:topicId/weekly-briefing[?week=YYYY-MM-DD]
 *   无 week 则取最新；带 week 则按周一 UTC 00:00 查
 *
 * 安全：JwtAuthGuard + ownership 校验（topics.getOwnedById）
 */
import {
  Controller,
  Get,
  Param,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import type { RequestWithUser } from "../../../../../common/types/express-request.types";
import {
  RadarWeeklyBriefingService,
  type WeeklyPayload,
} from "../../mission/services/briefing/radar-weekly-briefing.service";
import { RadarTopicService } from "../../mission/services/topic/radar-topic.service";

export interface WeeklyBriefingDto {
  id: string;
  topicId: string;
  weekStart: string;
  weekEnd: string;
  payload: WeeklyPayload;
  generatedAt: string;
}

@Controller("radar/topics")
@UseGuards(JwtAuthGuard)
export class WeeklyBriefingController {
  constructor(
    private readonly weekly: RadarWeeklyBriefingService,
    private readonly topics: RadarTopicService,
  ) {}

  @Get(":topicId/weekly-briefing")
  async get(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Query("week") week?: string,
  ): Promise<WeeklyBriefingDto | null> {
    await this.topics.getOwnedById(req.user.id, topicId);

    const row = week
      ? await this.weekly.findByTopicAndWeek(topicId, parseMonday(week))
      : await this.weekly.findLatestForTopic(topicId);
    if (!row) return null;

    const weekEnd = new Date(row.weekStartDate);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

    return {
      id: row.id,
      topicId: row.topicId,
      weekStart: row.weekStartDate.toISOString().slice(0, 10),
      weekEnd: weekEnd.toISOString().slice(0, 10),
      payload: row.payload as unknown as WeeklyPayload,
      generatedAt: row.generatedAt.toISOString(),
    };
  }
}

function parseMonday(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`invalid week (expect YYYY-MM-DD): ${s}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
