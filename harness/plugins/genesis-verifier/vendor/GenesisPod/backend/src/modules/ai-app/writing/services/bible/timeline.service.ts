import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  CreateTimelineEventData,
  UpdateTimelineEventData,
} from "./bible-entity.types";

@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async create(bibleId: string, data: CreateTimelineEventData) {
    return this.prisma.timelineEvent.create({
      data: {
        bibleId,
        eventName: data.eventName,
        description: data.description,
        storyTime: data.storyTime,
        importance: data.importance || 1,
        involvedCharacterIds: data.involvedCharacterIds || [],
        relatedChapterId: data.relatedChapterId,
      },
    });
  }

  async findAll(bibleId: string) {
    return this.prisma.timelineEvent.findMany({
      where: { bibleId },
      orderBy: { storyTime: "asc" },
    });
  }

  async update(id: string, data: UpdateTimelineEventData) {
    return this.prisma.timelineEvent.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return this.prisma.timelineEvent.delete({
      where: { id },
    });
  }
}
