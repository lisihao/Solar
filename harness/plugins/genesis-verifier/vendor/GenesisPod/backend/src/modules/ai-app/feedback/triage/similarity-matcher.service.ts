/**
 * Similarity Matcher Service
 *
 * 相似问题匹配服务 - 查找历史相似反馈
 *
 * 职责：
 * 1. 文本相似度计算（TF-IDF + 余弦相似度）
 * 2. 查找历史相似问题
 * 3. 提供解决方案建议
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import type { SimilarIssue, TriageConfig } from "./triage-decision.types";
import { DEFAULT_TRIAGE_CONFIG } from "./triage-decision.types";

interface FeedbackRecord {
  id: string;
  title: string;
  description: string;
  type: string;
  status: string;
  admin_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class SimilarityMatcherService {
  private readonly logger = new Logger(SimilarityMatcherService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查找相似问题
   */
  async findSimilarIssues(
    title: string,
    description: string,
    config: TriageConfig = DEFAULT_TRIAGE_CONFIG,
  ): Promise<SimilarIssue[]> {
    const startTime = Date.now();

    try {
      // 获取历史反馈（排除最近的，避免和自己比较）
      const historicalFeedbacks = await this.getHistoricalFeedbacks(100);

      if (historicalFeedbacks.length === 0) {
        this.logger.log("No historical feedbacks found for comparison");
        return [];
      }

      // 计算相似度
      const inputText = `${title} ${description}`.toLowerCase();
      const inputTokens = this.tokenize(inputText);
      const inputTfIdf = this.calculateTfIdf(inputTokens, historicalFeedbacks);

      const similarities: Array<{ feedback: FeedbackRecord; score: number }> =
        [];

      for (const feedback of historicalFeedbacks) {
        const feedbackText =
          `${feedback.title} ${feedback.description}`.toLowerCase();
        const feedbackTokens = this.tokenize(feedbackText);
        const feedbackTfIdf = this.calculateTfIdf(
          feedbackTokens,
          historicalFeedbacks,
        );

        const similarity = this.cosineSimilarity(inputTfIdf, feedbackTfIdf);

        if (similarity >= config.similarityThreshold) {
          similarities.push({ feedback, score: similarity });
        }
      }

      // 排序并取前N个
      const topSimilar = similarities
        .sort((a, b) => b.score - a.score)
        .slice(0, config.maxSimilarIssues);

      const result: SimilarIssue[] = topSimilar.map(({ feedback, score }) => ({
        feedbackId: feedback.id,
        title: feedback.title,
        similarity: Math.round(score * 100),
        status: feedback.status,
        resolution: feedback.admin_notes || undefined,
        resolvedAt:
          feedback.status === "RESOLVED" || feedback.status === "CLOSED"
            ? feedback.updated_at
            : undefined,
      }));

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `Found ${result.length} similar issues in ${elapsed}ms (checked ${historicalFeedbacks.length} feedbacks)`,
      );

      return result;
    } catch (error) {
      this.logger.error("Failed to find similar issues", error);
      return [];
    }
  }

  /**
   * 检查是否为重复反馈
   */
  async checkDuplicate(
    title: string,
    description: string,
    threshold = 0.9,
  ): Promise<{ isDuplicate: boolean; originalId?: string }> {
    const similarIssues = await this.findSimilarIssues(title, description, {
      ...DEFAULT_TRIAGE_CONFIG,
      similarityThreshold: threshold,
      maxSimilarIssues: 1,
    });

    if (similarIssues.length > 0 && similarIssues[0].similarity >= 90) {
      return {
        isDuplicate: true,
        originalId: similarIssues[0].feedbackId,
      };
    }

    return { isDuplicate: false };
  }

  /**
   * 获取历史反馈
   */
  private async getHistoricalFeedbacks(
    limit: number,
  ): Promise<FeedbackRecord[]> {
    const feedbacks = await this.prisma.$queryRaw<FeedbackRecord[]>`
      SELECT id, title, description, type::text, status::text, admin_notes, created_at, updated_at
      FROM feedbacks
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return feedbacks;
  }

  /**
   * 分词
   */
  private tokenize(text: string): string[] {
    // 简单分词：按空格和标点符号分割，过滤短词
    return text
      .replace(/[^\w\s\u4e00-\u9fa5]/g, " ") // 保留中英文和数字
      .split(/\s+/)
      .filter((token) => token.length > 1)
      .map((token) => token.toLowerCase());
  }

  /**
   * 计算 TF-IDF 向量
   */
  private calculateTfIdf(
    tokens: string[],
    corpus: FeedbackRecord[],
  ): Map<string, number> {
    const tfIdf = new Map<string, number>();

    // 计算词频 (TF)
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    // 计算逆文档频率 (IDF)
    const totalDocs = corpus.length;
    const docFreq = new Map<string, number>();

    for (const doc of corpus) {
      const docText = `${doc.title} ${doc.description}`.toLowerCase();
      const docTokens = new Set(this.tokenize(docText));
      for (const token of docTokens) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
      }
    }

    // 计算 TF-IDF
    for (const [token, freq] of tf) {
      const df = docFreq.get(token) || 1;
      const idf = Math.log(totalDocs / df);
      tfIdf.set(token, (freq / tokens.length) * idf);
    }

    return tfIdf;
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(
    vec1: Map<string, number>,
    vec2: Map<string, number>,
  ): number {
    // 获取所有维度
    const allKeys = new Set([...vec1.keys(), ...vec2.keys()]);

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (const key of allKeys) {
      const v1 = vec1.get(key) || 0;
      const v2 = vec2.get(key) || 0;

      dotProduct += v1 * v2;
      norm1 += v1 * v1;
      norm2 += v2 * v2;
    }

    if (norm1 === 0 || norm2 === 0) return 0;

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * 获取问题的解决方案建议
   */
  async getSolutionSuggestions(
    title: string,
    description: string,
  ): Promise<string[]> {
    const similarIssues = await this.findSimilarIssues(title, description);

    const solutions: string[] = [];

    for (const issue of similarIssues) {
      if (
        issue.resolution &&
        (issue.status === "RESOLVED" || issue.status === "CLOSED")
      ) {
        solutions.push(issue.resolution);
      }
    }

    return solutions;
  }
}
