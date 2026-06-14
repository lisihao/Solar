import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import type { RequestWithUser } from "../../../../../common/types/express-request.types";
import { RadarTopicService } from "../../mission/services/topic/radar-topic.service";

@Controller("radar")
@UseGuards(JwtAuthGuard)
export class RadarInsightController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly topics: RadarTopicService,
  ) {}

  @Get("topics/:topicId/insights")
  async list(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    await this.topics.getOwnedById(req.user.id, topicId);
    const cap = Math.min(Math.max(limit, 1), 100);
    return this.prisma.radarInsight.findMany({
      where: { topicId },
      orderBy: { periodTo: "desc" },
      take: cap,
    });
  }

  @Get("topics/:topicId/insights/latest")
  async latest(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
  ) {
    await this.topics.getOwnedById(req.user.id, topicId);
    const insight = await this.prisma.radarInsight.findFirst({
      where: { topicId },
      orderBy: { periodTo: "desc" },
    });
    return { insight };
  }
}
