import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ResourceType } from "@prisma/client";
import { ParsedUrlMetadata } from "./metadata-extractor.service";
import { stringSimilarity } from "string-similarity-js";

export interface DuplicateDetectionResult {
  isDuplicate: boolean;
  duplicateResourceId?: string;
  duplicateUrl?: string;
  potentialDuplicates: Array<{
    resourceId: string;
    title: string;
    sourceUrl: string;
    similarity: number;
  }>;
}

@Injectable()
export class DuplicateDetectorService {
  private readonly logger = new Logger(DuplicateDetectorService.name);
  private readonly SIMILARITY_THRESHOLD = 0.8; // 80%相似度认为是重复

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 检测导入的元数据是否存在重复
   */
  async detectDuplicates(
    resourceType: ResourceType,
    metadata: ParsedUrlMetadata,
  ): Promise<DuplicateDetectionResult> {
    const potentialDuplicates: DuplicateDetectionResult["potentialDuplicates"] =
      [];

    // 1. 检查完全重复（相同URL）
    const exactDuplicate = await this.findExactUrlDuplicate(metadata.url);
    if (exactDuplicate) {
      return {
        isDuplicate: true,
        duplicateResourceId: exactDuplicate.id,
        duplicateUrl: metadata.url,
        potentialDuplicates: [],
      };
    }

    // 2. 检查标题相似度重复
    const titleDuplicates = await this.findTitleSimilarityDuplicates(
      resourceType,
      metadata.title,
      this.SIMILARITY_THRESHOLD,
    );

    if (titleDuplicates.length > 0) {
      // 如果有多个非常相似的标题，视为重复
      const veryHighSimilarity = titleDuplicates.find(
        (d) => d.similarity > 0.95,
      );
      if (veryHighSimilarity) {
        potentialDuplicates.push(...titleDuplicates);
        return {
          isDuplicate: true,
          duplicateResourceId: veryHighSimilarity.resourceId,
          potentialDuplicates,
        };
      }

      // 否则作为潜在重复项列出
      potentialDuplicates.push(...titleDuplicates.slice(0, 3)); // 只显示前3个
    }

    // 3. 如果启用了内容hash检测，检查内容重复
    if (metadata.contentHash) {
      const contentDuplicates = await this.findContentHashDuplicates(
        resourceType,
        metadata.contentHash,
      );
      if (contentDuplicates.length > 0) {
        return {
          isDuplicate: true,
          duplicateResourceId: contentDuplicates[0].id,
          potentialDuplicates: potentialDuplicates,
        };
      }
    }

    return {
      isDuplicate: false,
      potentialDuplicates,
    };
  }

  /**
   * 检查完全相同的URL是否已导入
   */
  private async findExactUrlDuplicate(sourceUrl: string) {
    try {
      // 检查ImportTask表中是否存在相同的URL
      const existing = await (
        this.prisma as unknown as {
          importTask: {
            findFirst: (args: {
              where: { sourceUrl: string };
            }) => Promise<{ id: string } | null>;
          };
        }
      ).importTask.findFirst({
        where: { sourceUrl },
      });

      return existing
        ? {
            id: existing.id,
            type: "importTask" as const,
          }
        : null;
    } catch (error) {
      this.logger.warn(
        `Error checking exact URL duplicate: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * 基于标题相似度查找潜在重复项
   */
  private async findTitleSimilarityDuplicates(
    resourceType: ResourceType,
    title: string,
    threshold: number,
  ): Promise<
    Array<{
      resourceId: string;
      title: string;
      sourceUrl: string;
      similarity: number;
    }>
  > {
    try {
      // 从ImportTask中获取同resourceType的最近500条记录的元数据
      const recentTasks = (await (
        this.prisma as unknown as {
          importTask: {
            findMany: (args: {
              where: { resourceType: ResourceType; status: string };
              select: { id: boolean; sourceUrl: boolean; metadata: boolean };
              orderBy: { createdAt: string };
              take: number;
            }) => Promise<
              Array<{
                id: string;
                sourceUrl: string;
                metadata?: { title?: string };
              }>
            >;
          };
        }
      ).importTask.findMany({
        where: {
          resourceType,
          status: "SUCCESS", // 只检查成功导入的任务
        },
        select: {
          id: true,
          sourceUrl: true,
          metadata: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 500,
      })) as Array<{
        id: string;
        sourceUrl: string;
        metadata?: { title?: string };
      }>;

      // 转换为元数据对象
      const recentMetadata = recentTasks.map((task) => ({
        id: task.id,
        title: task.metadata?.title || "",
        sourceUrl: task.sourceUrl,
        importTasks: [{ resourceId: task.id }],
      }));

      const duplicates: Array<{
        resourceId: string;
        title: string;
        sourceUrl: string;
        similarity: number;
      }> = [];

      for (const metadata of recentMetadata) {
        if (!metadata.importTasks || metadata.importTasks.length === 0) {
          continue;
        }

        const similarity = stringSimilarity(title, metadata.title);
        if (similarity >= threshold) {
          duplicates.push({
            resourceId: metadata.importTasks[0]?.resourceId || metadata.id,
            title: metadata.title,
            sourceUrl: metadata.sourceUrl,
            similarity: parseFloat((similarity * 100).toFixed(1)),
          });
        }
      }

      // 按相似度倒序排列
      return duplicates.sort((a, b) => b.similarity - a.similarity);
    } catch (error) {
      this.logger.warn(
        `Error finding title similarity duplicates: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 基于内容hash查找重复内容
   */
  private async findContentHashDuplicates(
    resourceType: ResourceType,
    contentHash: string,
  ): Promise<
    Array<{
      id: string;
      title: string;
      sourceUrl: string;
    }>
  > {
    try {
      if (!contentHash) {
        return [];
      }

      // 从ImportTask中查找相同contentHash的任务
      // 使用 Prisma JSON 字段的 path + equals 语法
      const duplicates = (await (
        this.prisma as unknown as {
          importTask: {
            findMany: (args: {
              where: {
                resourceType: ResourceType;
                status: string;
                metadata: { path: string[]; equals: string };
              };
              select: { id: boolean; sourceUrl: boolean; metadata: boolean };
            }) => Promise<
              Array<{
                id: string;
                sourceUrl: string;
                metadata?: { title?: string };
              }>
            >;
          };
        }
      ).importTask.findMany({
        where: {
          resourceType,
          status: "SUCCESS",
          metadata: {
            path: ["contentHash"],
            equals: contentHash,
          },
        },
        select: {
          id: true,
          sourceUrl: true,
          metadata: true,
        },
      })) as Array<{
        id: string;
        sourceUrl: string;
        metadata?: { title?: string };
      }>;

      return duplicates.map((task) => ({
        id: task.id,
        title: task.metadata?.title || "",
        sourceUrl: task.sourceUrl,
      }));
    } catch (error) {
      this.logger.warn(
        `Error finding content hash duplicates: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 计算两个字符串的相似度 (0-100)
   */
  calculateSimilarity(str1: string, str2: string): number {
    const similarity = stringSimilarity(str1, str2);
    return parseFloat((similarity * 100).toFixed(1));
  }
}
