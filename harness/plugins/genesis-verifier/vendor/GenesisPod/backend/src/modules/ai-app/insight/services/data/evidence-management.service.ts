import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import type { TopicEvidence } from "@prisma/client";

/**
 * Evidence Query Options
 */
export interface EvidenceQueryOptions {
  skip?: number;
  take?: number;
  sourceType?: string;
  minCredibility?: number;
}

/**
 * Evidence Management Service
 *
 * 负责管理证据的生命周期：
 * 1. 证据查询和过滤
 * 2. 证据可信度管理
 * 3. 引用索引管理
 * 4. 证据去重
 */
@Injectable()
export class EvidenceManagementService {
  private readonly logger = new Logger(EvidenceManagementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取报告的证据列表
   */
  async listEvidence(
    reportId: string,
    options: EvidenceQueryOptions = {},
  ): Promise<{ evidences: TopicEvidence[]; total: number }> {
    // ★ 默认 500 条，确保报告引用能完整显示
    const { skip = 0, take = 500, sourceType, minCredibility } = options;

    const where: Record<string, unknown> = { reportId };

    if (sourceType) {
      where.sourceType = sourceType;
    }

    if (minCredibility !== undefined) {
      where.credibilityScore = { gte: minCredibility };
    }

    const [evidences, total] = await Promise.all([
      this.prisma.topicEvidence.findMany({
        where,
        skip,
        take,
        orderBy: { citationIndex: "asc" },
      }),
      this.prisma.topicEvidence.count({ where }),
    ]);

    return { evidences, total };
  }

  /**
   * 获取单个证据详情
   */
  async getEvidence(evidenceId: string): Promise<TopicEvidence | null> {
    return this.prisma.topicEvidence.findUnique({
      where: { id: evidenceId },
    });
  }

  /**
   * 获取维度分析的证据
   */
  async getEvidenceForAnalysis(analysisId: string): Promise<TopicEvidence[]> {
    return this.prisma.topicEvidence.findMany({
      where: { analysisId },
      orderBy: { citationIndex: "asc" },
    });
  }

  /**
   * 更新证据可信度评分
   */
  async updateCredibilityScore(
    evidenceId: string,
    score: number,
  ): Promise<TopicEvidence> {
    return this.prisma.topicEvidence.update({
      where: { id: evidenceId },
      data: { credibilityScore: Math.min(100, Math.max(0, Math.round(score))) },
    });
  }

  /**
   * 批量更新证据的引用索引
   */
  async reindexCitations(reportId: string): Promise<void> {
    const evidences = await this.prisma.topicEvidence.findMany({
      where: { reportId },
      orderBy: [{ analysisId: "asc" }, { accessedAt: "asc" }],
    });

    await this.prisma.$transaction(
      evidences.map((evidence, index) =>
        this.prisma.topicEvidence.update({
          where: { id: evidence.id },
          data: { citationIndex: index + 1 },
        }),
      ),
    );

    this.logger.log(
      `Reindexed ${evidences.length} citations for report ${reportId}`,
    );
  }

  /**
   * 检查 URL 是否已存在于报告中
   */
  async isDuplicateUrl(reportId: string, url: string): Promise<boolean> {
    const normalizedUrl = this.normalizeUrl(url);
    const existing = await this.prisma.topicEvidence.findFirst({
      where: {
        reportId,
        url: { contains: normalizedUrl },
      },
    });
    return !!existing;
  }

  /**
   * 获取证据统计信息
   */
  async getEvidenceStats(reportId: string): Promise<{
    total: number;
    bySourceType: Record<string, number>;
    byCredibility: { high: number; medium: number; low: number };
    avgCredibility: number;
  }> {
    const evidences = await this.prisma.topicEvidence.findMany({
      where: { reportId },
      select: {
        sourceType: true,
        credibilityScore: true,
      },
    });

    const bySourceType: Record<string, number> = {};
    let high = 0;
    let medium = 0;
    let low = 0;
    let totalScore = 0;
    let scoredCount = 0;

    for (const e of evidences) {
      // 按来源类型统计
      const sourceType = e.sourceType || "unknown";
      bySourceType[sourceType] = (bySourceType[sourceType] || 0) + 1;

      // 按可信度统计
      if (e.credibilityScore !== null) {
        scoredCount++;
        totalScore += e.credibilityScore;
        if (e.credibilityScore >= 70) {
          high++;
        } else if (e.credibilityScore >= 40) {
          medium++;
        } else {
          low++;
        }
      }
    }

    return {
      total: evidences.length,
      bySourceType,
      byCredibility: { high, medium, low },
      avgCredibility:
        scoredCount > 0 ? Math.round(totalScore / scoredCount) : 0,
    };
  }

  /**
   * 从 URL 中提取域名
   */
  private extractDomainFromUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch (error) {
      this.logger.debug(`[extractDomainFromUrl] Invalid URL: ${error}`);
      return null;
    }
  }

  /**
   * ★ 重新计算报告中所有证据的可信度评分
   * 用于修复历史数据中可信度评分不正确的问题
   * 同时修复缺失的 domain 字段
   */
  async recalculateCredibilityScores(reportId: string): Promise<{
    updated: number;
    avgScore: number;
  }> {
    this.logger.log(`Recalculating credibility scores for report: ${reportId}`);

    const evidences = await this.prisma.topicEvidence.findMany({
      where: { reportId },
    });

    if (evidences.length === 0) {
      return { updated: 0, avgScore: 0 };
    }

    let totalScore = 0;

    // 批量更新 - 同时修复缺失的 domain 并重新计算分数
    await this.prisma.$transaction(
      evidences.map((evidence) => {
        // 如果 domain 为空，尝试从 URL 提取
        const domain =
          evidence.domain || this.extractDomainFromUrl(evidence.url);

        // 使用修复后的数据计算分数
        const evidenceWithDomain = { ...evidence, domain };
        const newScore = this.calculateCredibilityScore(evidenceWithDomain);
        totalScore += newScore;

        return this.prisma.topicEvidence.update({
          where: { id: evidence.id },
          data: {
            credibilityScore: newScore,
            // 同时更新 domain 如果之前为空
            ...(evidence.domain === null && domain ? { domain } : {}),
          },
        });
      }),
    );

    const avgScore = Math.round(totalScore / evidences.length);

    this.logger.log(
      `Updated ${evidences.length} evidence scores, avg: ${avgScore}`,
    );

    return { updated: evidences.length, avgScore };
  }

  /**
   * ★ 计算单个证据的可信度评分
   * 综合考虑域名权威性、来源类型、内容深度、时效性
   */
  private calculateCredibilityScore(evidence: {
    domain: string | null;
    sourceType: string | null;
    snippet: string | null;
    publishedAt: Date | null;
  }): number {
    let score = 0;

    // 1. 域名权威性评分 (最高 40 分)
    if (evidence.domain) {
      const domain = evidence.domain.toLowerCase();

      // 最高权威 (政府、教育、顶级学术)
      const topAuthority = [
        ".gov",
        ".edu",
        ".ac.",
        "nature.com",
        "science.org",
        "sciencedirect.com",
        "springer.com",
        "wiley.com",
        "arxiv.org",
        "pubmed.ncbi",
        "ieee.org",
        "acm.org",
        "who.int",
        "un.org",
        "worldbank.org",
        "imf.org",
        "oecd.org",
        // Chinese academic/institutional domains
        "cnki.net",
        "wanfangdata.com.cn",
        "cas.cn",
        ".edu.cn",
        "gov.cn",
        "csdb.cn",
        "nsfc.gov.cn",
      ];

      // 高权威 (知名媒体、智库)
      const highAuthority = [
        "reuters.com",
        "bloomberg.com",
        "wsj.com",
        "nytimes.com",
        "washingtonpost.com",
        "bbc.com",
        "economist.com",
        "ft.com",
        "theguardian.com",
        "apnews.com",
        "stanford.edu",
        "mit.edu",
        "harvard.edu",
        "brookings.edu",
        "rand.org",
        "mckinsey.com",
        "gartner.com",
        "forrester.com",
        "statista.com",
      ];

      // 中等权威 (行业媒体、知名博客)
      const mediumAuthority = [
        "techcrunch.com",
        "wired.com",
        "arstechnica.com",
        "theverge.com",
        "venturebeat.com",
        "forbes.com",
        "businessinsider.com",
        "cnbc.com",
        "cnn.com",
        "medium.com",
        "substack.com",
        "hbr.org",
      ];

      if (topAuthority.some((auth) => domain.includes(auth))) {
        score += 40;
      } else if (highAuthority.some((auth) => domain.includes(auth))) {
        score += 30;
      } else if (mediumAuthority.some((auth) => domain.includes(auth))) {
        score += 22;
      } else {
        // 普通网站基础分
        score += 15;
      }
    } else {
      score += 10; // 无域名信息给最低基础分
    }

    // 2. 来源类型评分 (最高 30 分)
    const sourceTypeLower = (evidence.sourceType || "").toLowerCase();
    switch (sourceTypeLower) {
      case "academic":
        score += 30;
        break;
      case "official":
      case "government":
        score += 28;
        break;
      case "news":
        score += 22;
        break;
      case "report":
      case "industry":
        score += 20;
        break;
      case "web":
        score += 15;
        break;
      default:
        score += 12; // 默认给基础分
        break;
    }

    // 3. 内容深度评分 (最高 15 分) - 基于 snippet 长度
    const snippetLength = evidence.snippet?.length || 0;
    if (snippetLength > 500) {
      score += 15;
    } else if (snippetLength > 200) {
      score += 10;
    } else if (snippetLength > 50) {
      score += 5;
    }

    // 4. 时效性评分 (最高 15 分)
    if (evidence.publishedAt) {
      const ageInDays = Math.floor(
        (Date.now() - new Date(evidence.publishedAt).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      if (ageInDays <= 30) {
        score += 15; // 近一个月
      } else if (ageInDays <= 180) {
        score += 12; // 近半年
      } else if (ageInDays <= 365) {
        score += 8; // 近一年
      } else if (ageInDays <= 730) {
        score += 5; // 近两年
      }
      // 超过两年不加分
    }

    // 确保分数在合理范围内 (最低 20，最高 100)
    return Math.max(20, Math.min(100, score));
  }

  /**
   * 删除孤立的证据（未关联到任何报告的证据）
   */
  async cleanupOrphanedEvidence(): Promise<number> {
    // 注意：这个操作可能会删除正在创建中的证据
    // 只删除超过24小时的孤立证据
    const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const result = await this.prisma.topicEvidence.deleteMany({
      where: {
        analysisId: null,
        accessedAt: { lt: cutoffDate },
      },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} orphaned evidences`);
    }

    return result.count;
  }

  /**
   * URL 标准化
   */
  private normalizeUrl(url: string): string {
    if (!url) return "";
    try {
      const parsed = new URL(url);
      // 移除 tracking 参数
      parsed.searchParams.delete("utm_source");
      parsed.searchParams.delete("utm_medium");
      parsed.searchParams.delete("utm_campaign");
      parsed.searchParams.delete("ref");
      // 移除尾部斜杠
      return parsed.toString().replace(/\/$/, "").toLowerCase();
    } catch (error) {
      this.logger.debug(`[normalizeUrl] Failed to normalize URL: ${error}`);
      return url.toLowerCase();
    }
  }
}
