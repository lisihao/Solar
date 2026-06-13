import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { RadarTopicStatus } from "@prisma/client";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import type { RequestWithUser } from "../../../../../common/types/express-request.types";
import { UpdateVisibilityDto } from "../../../../../common/visibility";
import { CreateRadarTopicDto, UpdateRadarTopicDto } from "../dto";
import { RadarTopicService } from "../../mission/services/topic/radar-topic.service";

@Controller("radar/topics")
@UseGuards(JwtAuthGuard)
export class RadarTopicController {
  constructor(private readonly topics: RadarTopicService) {}

  @Post()
  async create(
    @Request() req: RequestWithUser,
    @Body() dto: CreateRadarTopicDto,
  ) {
    return this.topics.create(req.user.id, dto);
  }

  @Get()
  async list(
    @Request() req: RequestWithUser,
    @Query("status") status?: RadarTopicStatus,
    @Query("limit", new DefaultValuePipe(30), ParseIntPipe) limit?: number,
    @Query("cursor") cursor?: string,
    @Query("q") q?: string,
  ) {
    return this.topics.listByUser(req.user.id, { status, limit, cursor, q });
  }

  @Get(":id")
  async detail(@Request() req: RequestWithUser, @Param("id") id: string) {
    const topic = await this.topics.getOwnedById(req.user.id, id);
    const counts = await this.topics.getCounts(id);
    return { ...topic, counts };
  }

  @Patch(":id")
  async update(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateRadarTopicDto,
  ) {
    return this.topics.update(req.user.id, id, dto);
  }

  @Delete(":id")
  async delete(@Request() req: RequestWithUser, @Param("id") id: string) {
    await this.topics.delete(req.user.id, id);
    return { deleted: true };
  }

  @Patch(":id/visibility")
  async updateVisibility(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateVisibilityDto,
  ) {
    return this.topics.updateVisibility(req.user.id, id, dto.visibility);
  }

  @Post(":id/pause")
  async pause(@Request() req: RequestWithUser, @Param("id") id: string) {
    return this.topics.pause(req.user.id, id);
  }

  @Post(":id/resume")
  async resume(@Request() req: RequestWithUser, @Param("id") id: string) {
    return this.topics.resume(req.user.id, id);
  }

  @Post(":id/archive")
  async archive(@Request() req: RequestWithUser, @Param("id") id: string) {
    return this.topics.archive(req.user.id, id);
  }
}
