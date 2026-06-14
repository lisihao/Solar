import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../common/prisma/prisma.service";

@Injectable()
export class AiWritingService {
  private readonly logger = new Logger(AiWritingService.name);

  constructor(private readonly prisma: PrismaService) {
    void this.logger;
  }

  async getProjectStats(projectId: string, userId: string) {
    const project = await this.prisma.writingProject.findFirst({
      where: { id: projectId, ownerId: userId },
      include: {
        volumes: {
          include: {
            chapters: {
              select: {
                id: true,
                status: true,
                wordCount: true,
              },
            },
          },
        },
        storyBible: {
          include: {
            characters: { select: { id: true } },
            worldSettings: { select: { id: true } },
            terminologies: { select: { id: true } },
            timelineEvents: { select: { id: true } },
            factions: { select: { id: true } },
          },
        },
      },
    });

    if (!project) {
      return null;
    }

    // Calculate stats
    type ChapterSummary = { id: string; status: string; wordCount: number };
    const chapters = project.volumes.flatMap(
      (v: { chapters: ChapterSummary[] }) => v.chapters,
    );
    const totalChapters = chapters.length;
    const completedChapters = chapters.filter(
      (c: ChapterSummary) => c.status === "FINAL",
    ).length;
    const totalWords = chapters.reduce(
      (sum: number, c: ChapterSummary) => sum + c.wordCount,
      0,
    );

    return {
      projectId,
      totalVolumes: project.volumes.length,
      totalChapters,
      completedChapters,
      totalWords,
      progress: totalChapters > 0 ? completedChapters / totalChapters : 0,
      storyBible: project.storyBible
        ? {
            characters: project.storyBible.characters.length,
            worldSettings: project.storyBible.worldSettings.length,
            terminologies: project.storyBible.terminologies.length,
            timelineEvents: project.storyBible.timelineEvents.length,
            factions: project.storyBible.factions.length,
          }
        : null,
    };
  }
}
