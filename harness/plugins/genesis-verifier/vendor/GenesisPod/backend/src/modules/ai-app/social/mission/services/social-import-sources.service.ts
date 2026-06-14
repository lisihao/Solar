/**
 * SocialImportSourcesService — 跨 app 导入来源列表
 *
 * 拆自 AiSocialService（god class 减重 phase 2.A.5，2026-05-27）。
 * 给 social 发布选材时浏览其它 app 的内容用：
 *   - getExploreSources：Explore Resource 全表（带过滤 + 分页）
 *   - getResearchSources：用户 ResearchTopic
 *   - getOfficeSources：用户 OfficeDocument
 *   - getWritingSources：用户 WritingProject
 *   - getTopicInsightsSources：用户 ResearchTopic + 最新一版 Report
 */

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

@Injectable()
export class SocialImportSourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async getExploreSources(
    _userId: string,
    options: {
      type?: string;
      page: number;
      limit?: number;
      since?: string;
    },
  ) {
    const where: Record<string, unknown> = {};

    if (options.type) {
      where.type = options.type.toUpperCase();
    }

    if (options.since) {
      const sinceDate = new Date(options.since);
      if (!isNaN(sinceDate.getTime())) {
        where.createdAt = { gte: sinceDate };
      }
    }

    const take = options.limit || 200;
    const resources = await this.prisma.resource.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (options.page - 1) * take,
      take,
      select: {
        id: true,
        type: true,
        title: true,
        abstract: true,
        sourceUrl: true,
        thumbnailUrl: true,
        createdAt: true,
      },
    });

    return resources;
  }

  async getResearchSources(userId: string) {
    const topics = await this.prisma.researchTopic.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        updatedAt: true,
      },
    });

    return topics;
  }

  async getOfficeSources(userId: string) {
    const documents = await this.prisma.officeDocument.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        type: true,
        updatedAt: true,
      },
    });

    return documents;
  }

  async getWritingSources(userId: string) {
    const projects = await this.prisma.writingProject.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        updatedAt: true,
      },
    });

    return projects;
  }

  async getTopicInsightsSources(userId: string) {
    const topics = await this.prisma.researchTopic.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        updatedAt: true,
        reports: {
          orderBy: { version: "desc" },
          take: 1,
          select: {
            id: true,
            version: true,
            executiveSummary: true,
            generatedAt: true,
          },
        },
      },
    });

    return topics
      .filter((topic) => topic.reports.length > 0)
      .map((topic) => ({
        id: topic.id,
        name: topic.name,
        description: topic.description,
        status: topic.status,
        updatedAt: topic.updatedAt,
        latestReport:
          topic.reports[0] != null
            ? {
                id: topic.reports[0].id,
                version: topic.reports[0].version,
                executiveSummary: topic.reports[0].executiveSummary?.substring(
                  0,
                  200,
                ),
                generatedAt: topic.reports[0].generatedAt,
              }
            : null,
      }));
  }
}
