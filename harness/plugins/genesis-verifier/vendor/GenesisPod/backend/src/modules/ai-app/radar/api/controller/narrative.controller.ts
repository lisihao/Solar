import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Request,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import type { RequestWithUser } from "../../../../../common/types/express-request.types";
import {
  NarrativeService,
  NarrativeThread,
} from "../../mission/services/briefing/narrative.service";
import { RadarTopicService } from "../../mission/services/topic/radar-topic.service";

@Controller("radar/topics")
@UseGuards(JwtAuthGuard)
export class NarrativeController {
  constructor(
    private readonly svc: NarrativeService,
    private readonly topics: RadarTopicService,
  ) {}

  @Get(":topicId/narratives/:narrativeId")
  async getNarrative(
    @Request() req: RequestWithUser,
    @Param("topicId") topicId: string,
    @Param("narrativeId") narrativeId: string,
  ): Promise<NarrativeThread> {
    await this.topics.getOwnedById(req.user.id, topicId);
    const result = await this.svc.getNarrativeThread(topicId, narrativeId);
    if (!result) {
      throw new NotFoundException(
        "narrative not found or insufficient episodes",
      );
    }
    return result;
  }
}
