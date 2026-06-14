import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { createHash } from "crypto";

/**
 * 去重结果
 */
export interface DeduplicationResult {
  isDuplicate: boolean;
  existingResourceId?: string;
  similarity?: number;
  action: "created" | "merged" | "skipped";
  reason?: string;
}

/**
 * 质量评估结果
 */
export interface QualityAssessment {
  sourceCredibility: number;
  contentCompleteness: number;
  freshnessScore: number;
  citationCount: number;
  overallScore: number;
}

/**
 * 资源去重服务
 */
@Injectable()
export class DeduplicationService {
  private readonly logger = new Logger(DeduplicationService.name);

  private readonly sourceCredibilityMap: Record<string, number> = {
    arxiv: 95,
    semantic_scholar: 90,
    github: 85,
    ieee: 90,
    acm: 90,
    hackernews: 70,
    techcrunch: 75,
    medium: 60,
    devto: 60,
    blog: 50,
    rss: 55,
    unknown: 30,
  };

  constructor(private prisma: PrismaService) {}

  /**
   * URL 规范化
   */
  normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const trackingParams = [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "ref",
        "source",
        "fbclid",
        "gclid",
        "msclkid",
        "_ga",
      ];
      trackingParams.forEach((param) => parsed.searchParams.delete(param));
      parsed.protocol = "https:";
      // Lowercase only host (case-insensitive per RFC 3986). Path/query are
      // case-sensitive — lowercasing them destroys YouTube IDs (kotam_vvnmy
      // ≠ kOTAM_vVnMY), Drive IDs, JWT tokens, etc. Bug fixed 2026-04-29
      // after 8 corrupted YouTube IDs were ingested via this path.
      parsed.hostname = parsed.hostname.toLowerCase();

      let normalized = parsed.toString();
      if (normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
      }
      return this.normalizePlatformUrl(normalized);
    } catch {
      return url;
    }
  }

  private normalizePlatformUrl(url: string): string {
    if (url.includes("arxiv.org")) {
      const match = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/);
      if (match) return `https://arxiv.org/abs/${match[1]}`;
    }
    if (
      url.includes("github.com") &&
      !url.includes("/blob/") &&
      !url.includes("/issues/")
    ) {
      const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (match) return `https://github.com/${match[1]}/${match[2]}`;
    }
    if (url.includes("youtube.com") || url.includes("youtu.be")) {
      const match = url.match(
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/,
      );
      if (match) return `https://www.youtube.com/watch?v=${match[1]}`;
    }
    return url;
  }

  /**
   * 计算内容指纹
   */
  computeFingerprint(content: string): string {
    if (!content || content.length < 50) return "";
    const normalized = content
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .sort()
      .slice(0, 100)
      .join(" ");
    return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
  }

  computeTitleFingerprint(title: string): string {
    if (!title || title.length < 5) return "";
    const normalized = title
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5]/g, "")
      .trim();
    return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  }

  computeUrlHash(url: string): string {
    return createHash("sha256")
      .update(this.normalizeUrl(url))
      .digest("hex")
      .slice(0, 16);
  }

  /**
   * Jaccard 相似度
   */
  calculateJaccardSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    const set1 = new Set(str1.toLowerCase().split(/\s+/));
    const set2 = new Set(str2.toLowerCase().split(/\s+/));
    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return intersection.size / union.size;
  }

  /**
   * 检查重复
   */
  async checkDuplicate(
    url: string,
    title: string,
    content?: string,
    threshold = 0.85,
  ): Promise<DeduplicationResult> {
    const normalizedUrl = this.normalizeUrl(url);

    // 1. 精确 URL 匹配
    const exactMatch = await this.prisma.resource.findFirst({
      where: { OR: [{ sourceUrl: normalizedUrl }, { sourceUrl: url }] },
      select: { id: true },
    });
    if (exactMatch) {
      return {
        isDuplicate: true,
        existingResourceId: exactMatch.id,
        similarity: 1.0,
        action: "skipped",
        reason: "exact_url",
      };
    }

    // 2. 标题相似度
    if (title?.length >= 10) {
      const similar = await this.prisma.resource.findMany({
        where: { title: { contains: title.slice(0, 50), mode: "insensitive" } },
        select: { id: true, title: true },
        take: 10,
      });
      for (const r of similar) {
        const sim = this.calculateJaccardSimilarity(title, r.title);
        if (sim >= threshold) {
          return {
            isDuplicate: true,
            existingResourceId: r.id,
            similarity: sim,
            action: "merged",
            reason: "title_similarity",
          };
        }
      }
    }

    // 3. 内容指纹
    if (content && content.length >= 100) {
      const fp = this.computeFingerprint(content);
      const match = await this.prisma.deduplicationRecord.findFirst({
        where: { contentFingerprint: fp },
        select: { resourceId: true },
      });
      if (match?.resourceId) {
        return {
          isDuplicate: true,
          existingResourceId: match.resourceId,
          similarity: 0.95,
          action: "merged",
          reason: "content_fingerprint",
        };
      }
    }

    return { isDuplicate: false, action: "created" };
  }

  /**
   * 质量评估
   */
  assessQuality(resource: {
    source: string;
    content?: string;
    abstract?: string;
    citationCount?: number;
    publishedAt?: Date;
    authors?: unknown[];
  }): QualityAssessment {
    const sourceCredibility =
      this.sourceCredibilityMap[resource.source?.toLowerCase()] || 30;

    let contentCompleteness = 0;
    if (resource.abstract && resource.abstract.length > 50)
      contentCompleteness += 25;
    if (resource.abstract && resource.abstract.length > 200)
      contentCompleteness += 10;
    if (resource.content && resource.content.length > 500)
      contentCompleteness += 25;
    if (resource.content && resource.content.length > 2000)
      contentCompleteness += 15;
    if (resource.authors?.length) contentCompleteness += 15;
    contentCompleteness = Math.min(contentCompleteness, 100);

    let freshnessScore = 50;
    if (resource.publishedAt) {
      const days =
        (Date.now() - new Date(resource.publishedAt).getTime()) / 86400000;
      if (days <= 7) freshnessScore = 100;
      else if (days <= 30) freshnessScore = 90;
      else if (days <= 90) freshnessScore = 75;
      else if (days <= 365) freshnessScore = 50;
      else freshnessScore = 30;
    }

    const citationCount = resource.citationCount || 0;
    const overallScore = Math.round(
      sourceCredibility * 0.3 +
        contentCompleteness * 0.3 +
        freshnessScore * 0.2 +
        Math.min(citationCount / 10, 100) * 0.2,
    );

    return {
      sourceCredibility,
      contentCompleteness,
      freshnessScore,
      citationCount,
      overallScore,
    };
  }

  /**
   * 合并资源
   */
  async mergeResources(
    existingId: string,
    newData: Record<string, unknown>,
  ): Promise<boolean> {
    const existing = await this.prisma.resource.findUnique({
      where: { id: existingId },
    });
    if (!existing) return false;

    const updates: Record<string, unknown> = {};
    if (
      newData.title &&
      (!existing.title ||
        (newData.title as string).length > existing.title.length)
    ) {
      updates.title = newData.title;
    }
    if (
      newData.abstract &&
      (!existing.abstract ||
        (newData.abstract as string).length > existing.abstract.length)
    ) {
      updates.abstract = newData.abstract;
    }
    if (
      newData.content &&
      (!existing.content ||
        (newData.content as string).length > (existing.content?.length || 0))
    ) {
      updates.content = newData.content;
    }
    if (
      newData.aiSummary &&
      (!existing.aiSummary ||
        (newData.aiSummary as string).length > existing.aiSummary.length)
    ) {
      updates.aiSummary = newData.aiSummary;
    }

    if (Object.keys(updates).length > 0) {
      await this.prisma.resource.update({
        where: { id: existingId },
        data: updates,
      });
      this.logger.log(
        `Merged resource ${existingId}: ${Object.keys(updates).join(", ")}`,
      );
      return true;
    }
    return false;
  }

  /**
   * 记录去重决策
   */
  async recordDeduplication(params: {
    taskId?: string;
    resourceId?: string;
    duplicateOfId?: string;
    method: string;
    similarity: number;
    decision: "AUTO_SKIP" | "MERGED" | "PENDING_REVIEW";
    originalData: Record<string, unknown>;
    url: string;
    title?: string;
    content?: string;
  }): Promise<void> {
    await this.prisma.deduplicationRecord.create({
      data: {
        taskId: params.taskId,
        resourceId: params.resourceId,
        duplicateOfId: params.duplicateOfId,
        method: params.method,
        similarity: params.similarity,
        decision: params.decision,
        urlHash: this.computeUrlHash(params.url),
        titleHash: params.title
          ? this.computeTitleFingerprint(params.title)
          : null,
        contentFingerprint: params.content
          ? this.computeFingerprint(params.content)
          : null,
        originalData: params.originalData as object,
        processedBy: "SYSTEM",
      },
    });
  }

  /**
   * 获取去重统计
   */
  async getStats() {
    const [total, recent] = await Promise.all([
      this.prisma.deduplicationRecord.count(),
      this.prisma.deduplicationRecord.count({
        where: { createdAt: { gte: new Date(Date.now() - 86400000) } },
      }),
    ]);
    return { totalRecords: total, last24h: recent };
  }
}
