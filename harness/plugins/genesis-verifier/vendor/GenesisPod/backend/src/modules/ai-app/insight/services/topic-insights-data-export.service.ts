import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  ITopicInsightsDataExport,
  IExportableTopicInsightsData,
  ITopicInsightsListItem,
} from "../../contracts/interfaces/data-export.interface";

/**
 * Topic Insights Data Export Service
 *
 * Owner of the ResearchTopic model. Provides read-only exports for
 * cross-module consumers (Office/Slides) via the TOPIC_INSIGHTS_DATA_EXPORT
 * DI token.
 *
 * Implements ITopicInsightsDataExport directly — the previous
 * adapter+service split (under Research module) has been flattened,
 * since the service is already the boundary object.
 */
@Injectable()
export class TopicInsightsDataExportService implements ITopicInsightsDataExport {
  constructor(private readonly prisma: PrismaService) {}

  async getTopicForExport(
    topicId: string,
    userId: string,
  ): Promise<IExportableTopicInsightsData> {
    const topic = await this.prisma.researchTopic.findFirst({
      where: {
        id: topicId,
        userId,
      },
      include: {
        reports: {
          orderBy: { generatedAt: "desc" },
          take: 1,
          include: {
            dimensionAnalyses: {
              include: {
                dimension: true,
              },
              orderBy: { createdAt: "asc" },
            },
          },
        },
        dimensions: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!topic) {
      throw new NotFoundException(`Topic insights topic not found: ${topicId}`);
    }

    const latestReport = topic.reports[0];

    return {
      id: topic.id,
      name: topic.name,
      description: topic.description,
      language: topic.language,
      createdAt: topic.createdAt,
      dimensions: topic.dimensions.map((d) => ({
        name: d.name,
        description: d.description,
        sortOrder: d.sortOrder,
      })),
      latestReport: latestReport
        ? {
            fullReport: latestReport.fullReport,
            charts: latestReport.charts,
            highlights: latestReport.highlights,
            dimensionAnalyses: latestReport.dimensionAnalyses.map((a) => ({
              summary: a.summary,
              dataPoints: a.dataPoints,
              dimension: {
                name: a.dimension.name,
              },
            })),
          }
        : null,
    };
  }

  async listTopicsForExport(
    userId: string,
    limit = 50,
  ): Promise<ITopicInsightsListItem[]> {
    const topics = await this.prisma.researchTopic.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: {
        _count: {
          select: { dimensions: true },
        },
      },
    });

    return topics.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      createdAt: t.createdAt,
      dimensionCount: t._count.dimensions,
    }));
  }
}
