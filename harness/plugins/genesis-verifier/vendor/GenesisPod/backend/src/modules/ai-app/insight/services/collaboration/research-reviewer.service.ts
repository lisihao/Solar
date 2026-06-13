import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import { mapWithConcurrency } from "@/common/utils/concurrency.utils";
import type { ResearchTopic, TopicDimension } from "@prisma/client";
import type { DimensionAnalysisResult } from "../../types/research.types";
import { extractJsonFromAIResponse } from "@/common/utils/json-extraction.utils";
import {
  ReviewQualityLevel,
  type DimensionReviewResult,
  type ReviewIssue,
  type OverallReviewResult,
} from "../../types/collaboration.types";

/**
 * AI 审核响应
 */
interface AIReviewResponse {
  qualityLevel: ReviewQualityLevel;
  overallScore: number;
  scores: {
    breadth: number;
    depth: number;
    evidence: number;
    coherence: number;
    currency: number;
  };
  issues: Array<{
    type: string;
    severity: string;
    description: string;
    affectedSection?: string;
  }>;
  suggestions: string[];
  needsReresearch: boolean;
  reresearchFocus?: string[];
}

/**
 * Research Reviewer Service
 *
 * 质量审核员服务 - 负责审核研究质量
 *
 * 职责：
 * 1. 审核每个维度的研究质量
 * 2. 检查研究广度（是否覆盖关键角度）
 * 3. 检查研究深度（是否有足够证据支撑）
 * 4. 评估逻辑连贯性和时效性
 * 5. 提出改进建议或触发重新研究
 *
 * 质量标准：
 * - 广度：每个维度必须覆盖主要方面，不能遗漏关键角度
 * - 深度：每个发现必须有至少2个证据支撑，分析要深入本质
 * - 证据：证据来源多样，可信度高，时效性好
 * - 连贯：分析逻辑清晰，结论有依据
 * - 时效：信息来源不超过6个月，关注最新动态
 */
@Injectable()
export class ResearchReviewerService {
  private readonly logger = new Logger(ResearchReviewerService.name);

  // 质量阈值
  private readonly QUALITY_THRESHOLDS = {
    excellent: 90,
    good: 75,
    acceptable: 60,
    needsRevision: 40,
  };

  // 最低可接受分数
  private readonly MIN_ACCEPTABLE_SCORE = 60;

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 审核单个维度的研究质量
   */
  async reviewDimension(
    topic: ResearchTopic,
    dimension: TopicDimension,
    analysis: DimensionAnalysisResult,
    evidenceCount: number,
  ): Promise<DimensionReviewResult> {
    this.logger.log(
      `Reviewing dimension: ${dimension.name} for topic: ${topic.name}`,
    );

    const systemPrompt = this.buildDimensionReviewSystemPrompt(topic.type);
    const userPrompt = this.buildDimensionReviewUserPrompt(
      topic,
      dimension,
      analysis,
      evidenceCount,
    );

    try {
      const response = await this.chatFacade.chatWithSkills({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        additionalSkills: ["dimension-review"],
        operationName: "断言验证",
        modelType: AIModelType.CHAT,
        skipGuardrails: true, // 内部系统调用，研究内容审核
        cachePolicy: "auto",
        taskProfile: {
          creativity: "low",
          outputLength: "medium",
        },
        responseFormat: "json",
      });

      // Use robust JSON extraction to handle markdown code blocks
      const extractionResult = extractJsonFromAIResponse<AIReviewResponse>(
        response.content,
        { requiredKey: "qualityLevel" },
      );

      if (!extractionResult.success || !extractionResult.data) {
        this.logger.error(
          `Failed to parse review response for dimension ${dimension.name}:`,
          extractionResult.error,
        );
        throw new InternalServerErrorException(
          extractionResult.error || "Failed to parse AI response",
        );
      }

      const reviewData = extractionResult.data;

      const result: DimensionReviewResult = {
        dimensionId: dimension.id,
        dimensionName: dimension.name,
        qualityLevel: this.determineQualityLevel(reviewData.overallScore),
        overallScore: reviewData.overallScore,
        scores: reviewData.scores,
        issues: (Array.isArray(reviewData.issues) ? reviewData.issues : []).map(
          (issue) => {
            // Handle plain string issues from LLM
            if (typeof issue === "string") {
              return {
                type: "shallow_analysis" as ReviewIssue["type"],
                severity: "major" as ReviewIssue["severity"],
                description: issue,
              };
            }
            return {
              type: (issue.type || "shallow_analysis") as ReviewIssue["type"],
              severity: this.normalizeSeverity(issue.severity),
              description: issue.description || String(issue),
              affectedSection: issue.affectedSection,
            };
          },
        ),
        suggestions: reviewData.suggestions,
        needsReresearch:
          reviewData.needsReresearch ||
          reviewData.overallScore < this.MIN_ACCEPTABLE_SCORE,
        reresearchFocus: reviewData.reresearchFocus,
        actualModelId: response.model, // ★ 记录实际使用的模型
      };

      // ★ 空内容/拒写检测：检查 detailedContent 是否过短或包含拒写关键词
      const refusalKeywords = [
        "I cannot",
        "I'm unable",
        "I apologize",
        "I'm sorry",
        "I am unable",
        "I'm not able",
        "cannot provide",
        "cannot generate",
        "I do not have",
        "don't have access",
        "beyond my capabilities",
        "outside my scope",
        "Unfortunately, I",
        "I must decline",
        "无法提供",
        "无法生成",
        "无法完成",
        "无法回答",
        "抱歉",
        "我无法",
        "超出范围",
        "不在我的能力",
        "As an AI",
        "作为AI",
        "I don't have access",
      ];
      const contentLength = analysis.detailedContent?.length || 0;
      const hasRefusal = refusalKeywords.some((kw) =>
        analysis.detailedContent?.toLowerCase().includes(kw.toLowerCase()),
      );

      // 只有当内容短且包含拒写关键词时才自动标记为 NEEDS_REVISION
      // 如果只是短内容（< 100）但没有拒写，仅作为警告不强制重做
      if (contentLength < 100 && hasRefusal) {
        this.logger.warn(
          `Dimension ${dimension.name}: empty/refused content detected (length=${contentLength}, hasRefusal=${hasRefusal})`,
        );
        result.needsReresearch = true;
        result.qualityLevel = ReviewQualityLevel.NEEDS_REVISION;
        result.issues.push({
          type: "shallow_analysis",
          severity: "critical",
          description: `内容疑似拒写且严重不足（长度: ${contentLength} 字符，低于 100 字符最低要求）`,
        });
      } else if (contentLength < 100) {
        // 仅短内容，警告但不强制重做
        this.logger.warn(
          `Dimension ${dimension.name}: short content (length=${contentLength})`,
        );
        result.issues.push({
          type: "shallow_analysis",
          severity: "major",
          description: `内容较短（仅 ${contentLength} 字符，低于 100 字符建议值），但未检测到拒写`,
        });
      } else if (hasRefusal) {
        // 有拒写但长度足够（可能是部分拒写），标记为需重做
        this.logger.warn(
          `Dimension ${dimension.name}: refusal detected (length=${contentLength})`,
        );
        result.needsReresearch = true;
        result.qualityLevel = ReviewQualityLevel.NEEDS_REVISION;
        result.issues.push({
          type: "shallow_analysis",
          severity: "critical",
          description: `内容包含拒写关键词（长度: ${contentLength} 字符）`,
        });
      }

      this.logger.log(
        `Dimension ${dimension.name} review complete: ${result.qualityLevel} (${result.overallScore}/100)`,
      );

      return result;
    } catch (error) {
      this.logger.error(`Failed to review dimension ${dimension.name}:`, error);
      // 返回一个需要重新研究的结果
      return this.createFailedReviewResult(dimension, error);
    }
  }

  /**
   * 审核整体研究质量
   */
  async reviewOverall(
    topic: ResearchTopic,
    dimensions: TopicDimension[],
    dimensionReviews: DimensionReviewResult[],
  ): Promise<OverallReviewResult> {
    this.logger.log(`Performing overall review for topic: ${topic.name}`);

    // 计算整体分数（取整，避免显示长小数）
    const overallScore =
      dimensionReviews.length > 0
        ? Math.round(
            dimensionReviews.reduce((sum, r) => sum + r.overallScore, 0) /
              dimensionReviews.length,
          )
        : 0;

    // 检查跨维度问题
    const crossDimensionIssues = await this.analyzeCrossDimensionIssues(
      topic,
      dimensions,
      dimensionReviews,
    );

    // 分析覆盖度
    const coverageAnalysis = this.analyzeCoverage(topic, dimensions);

    // 确定需要重新研究的维度
    const dimensionsToReresearch = dimensionReviews
      .filter((r) => r.needsReresearch)
      .map((r) => r.dimensionId);

    // 生成总体建议
    const recommendations = this.generateOverallRecommendations(
      dimensionReviews,
      crossDimensionIssues,
      coverageAnalysis,
    );

    const result: OverallReviewResult = {
      topicId: topic.id,
      topicName: topic.name,
      qualityLevel: this.determineQualityLevel(overallScore),
      overallScore,
      dimensionReviews,
      crossDimensionIssues,
      coverageAnalysis,
      recommendations,
      needsReresearch: dimensionsToReresearch.length > 0,
      dimensionsToReresearch,
    };

    this.logger.log(
      `Overall review complete: ${result.qualityLevel} (${result.overallScore.toFixed(1)}/100), ` +
        `${dimensionsToReresearch.length} dimensions need reresearch`,
    );

    return result;
  }

  /**
   * V5 L3: 交叉验证 Claims
   * 使用 LLM 语义匹配（非关键词），批量验证每 5 个 claims
   */
  async validateClaims(
    claims: import("../../types/research-depth.types").ExtractedClaim[],
    evidenceSummary: string,
  ): Promise<
    import("../../types/research-depth.types").ClaimValidationBatchResult
  > {
    if (claims.length === 0) {
      return {
        results: [],
        stats: { verified: 0, unverified: 0, disputed: 0, total: 0 },
      };
    }

    this.logger.log(
      `[validateClaims] Validating ${claims.length} claims in batches of 5`,
    );

    const { CLAIM_VALIDATION_PROMPT } =
      await import("../../prompts/research-depth.prompt");
    const BATCH_SIZE = 5;

    // Split claims into batches of 5
    const batches: (typeof claims)[] = [];
    for (let i = 0; i < claims.length; i += BATCH_SIZE) {
      batches.push(claims.slice(i, i + BATCH_SIZE));
    }

    // Process batches sequentially (concurrency=1), each batch = 1 LLM call
    const batchResults = await mapWithConcurrency(
      batches,
      async (batch, batchIndex) => {
        const prompt = CLAIM_VALIDATION_PROMPT.replace(
          "{claimsJson}",
          JSON.stringify(batch, null, 2),
        ).replace("{evidenceSummary}", evidenceSummary.substring(0, 6000));

        try {
          const response = await this.chatFacade.chatWithSkills({
            messages: [
              {
                role: "system",
                content: "你是严谨的事实核查专家。请输出 JSON 格式。",
              },
              { role: "user", content: prompt },
            ],
            additionalSkills: ["fact-verification"],
            operationName: "断言交叉验证",
            modelType: AIModelType.CHAT_FAST,
            skipGuardrails: true, // 内部系统调用，事实核查含外部数据
            cachePolicy: "auto",
            taskProfile: {
              creativity: "deterministic",
              outputLength: "medium",
            },
            responseFormat: "json",
          });

          const result = extractJsonFromAIResponse<{
            results: import("../../types/research-depth.types").ClaimValidationResult[];
          }>(response.content, { requiredKey: "results" });

          if (result.success && result.data?.results) {
            return result.data.results;
          }
        } catch (error) {
          this.logger.warn(
            `[validateClaims] Batch ${batchIndex + 1} failed: ${error}`,
          );
        }

        // Fallback: mark batch claims as unverified
        return batch.map((c) => ({
          claimId: c.id,
          status: "unverified" as const,
          supportingSourceIndices: [] as number[],
          contradictingSourceIndices: [] as number[],
          explanation: "验证过程出错",
        }));
      },
      1, // concurrency=1: sequential LLM calls
    );

    const allResults = batchResults.flat();

    const stats = {
      verified: allResults.filter((r) => r.status === "verified").length,
      unverified: allResults.filter((r) => r.status === "unverified").length,
      disputed: allResults.filter((r) => r.status === "disputed").length,
      total: allResults.length,
    };

    this.logger.log(
      `[validateClaims] Validation complete: ${stats.verified} verified, ${stats.unverified} unverified, ${stats.disputed} disputed`,
    );

    return { results: allResults, stats };
  }

  /**
   * V5 L3: 生成补充搜索查询
   * 分析 disputed/unverified claims，生成针对性搜索查询以填补知识缺口
   */
  async generateGapSearchQueries(
    disputedClaims: import("../../types/research-depth.types").ClaimValidationResult[],
    existingEvidenceSummary: string,
  ): Promise<
    Array<{ query: string; targetClaimIds: string[]; searchType: string }>
  > {
    if (disputedClaims.length === 0) return [];

    this.logger.log(
      `[generateGapSearchQueries] Generating queries for ${disputedClaims.length} disputed/unverified claims`,
    );

    const { GAP_SEARCH_QUERY_PROMPT } =
      await import("../../prompts/research-depth.prompt");

    const claimsStr = JSON.stringify(
      disputedClaims.map((c) => ({
        claimId: c.claimId,
        status: c.status,
        explanation: c.explanation,
      })),
      null,
      2,
    );
    const truncatedClaims =
      claimsStr.length > 3000 ? claimsStr.slice(0, 3000) + "...]" : claimsStr;

    const prompt = GAP_SEARCH_QUERY_PROMPT.replace(
      "{disputedClaimsJson}",
      truncatedClaims,
    ).replace(
      "{existingEvidenceSummary}",
      existingEvidenceSummary.substring(0, 4000),
    );

    try {
      const response = await this.chatFacade.chatWithSkills({
        messages: [
          {
            role: "system",
            content: "你是研究策略专家。请输出 JSON 格式。",
          },
          { role: "user", content: prompt },
        ],
        operationName: "事实核查",
        modelType: AIModelType.CHAT_FAST,
        skipGuardrails: true, // 内部系统调用
        cachePolicy: "auto",
        taskProfile: { creativity: "low", outputLength: "short" },
        responseFormat: "json",
      });

      const result = extractJsonFromAIResponse<{
        queries: Array<{
          query: string;
          targetClaimIds: string[];
          searchType: string;
        }>;
      }>(response.content, { requiredKey: "queries" });

      if (result.success && result.data?.queries) {
        const queries = result.data.queries.slice(0, 4); // Max 4 queries
        this.logger.log(
          `[generateGapSearchQueries] Generated ${queries.length} gap search queries`,
        );
        return queries;
      }
    } catch (error) {
      this.logger.warn(
        `[generateGapSearchQueries] Failed to generate queries: ${error}`,
      );
    }

    return [];
  }

  /**
   * V5 L5: 事实核查报告
   * 提取报告中 [n] 引用及上下文，核对与原始证据是否一致
   * 仅 thorough 模式启用
   */
  async factCheckReport(
    reportContent: string,
    evidenceData: Array<{ id: string; title: string; snippet: string | null }>,
  ): Promise<import("../../types/research-depth.types").FactCheckResult> {
    this.logger.log(`[factCheckReport] Starting fact check`);

    // Extract citations [n] with surrounding context.
    // Previous regex /([^.]*?\[(\d+)\][^.]*\.)/ failed across newlines and
    // paragraph breaks. Now: find each [N], then grab surrounding text as context.
    const citations: Array<{ mark: string; context: string }> = [];
    const inlineCitationPattern = /\[(\d+)\]/g;
    let match: RegExpExecArray | null;

    while ((match = inlineCitationPattern.exec(reportContent)) !== null) {
      if (citations.length >= 30) break; // Limit to 30 citations
      // Skip citations inside the references section (lines starting with [N] )
      const lineStart = reportContent.lastIndexOf("\n", match.index) + 1;
      if (
        reportContent.slice(lineStart).trimStart().startsWith(`[${match[1]}]`)
      ) {
        // This [N] is at the start of a line → likely a reference entry, skip
        const nextChar = reportContent[lineStart + match[0].length];
        if (nextChar === " " || nextChar === "\t") continue;
      }
      // Grab ~100 chars before and after for context
      const start = Math.max(0, match.index - 100);
      const end = Math.min(
        reportContent.length,
        match.index + match[0].length + 100,
      );
      const context = reportContent
        .slice(start, end)
        .replace(/\n+/g, " ")
        .trim();
      citations.push({
        mark: `[${match[1]}]`,
        context: context.substring(0, 200),
      });
    }

    if (citations.length === 0) {
      this.logger.log(`[factCheckReport] No citations found, skipping`);
      return { citations: [], accuracyScore: 100, issues: [] };
    }

    const citationsText = citations
      .map((c) => `- ${c.mark}: "${c.context}"`)
      .join("\n");

    const evidenceText = evidenceData
      .slice(0, 30)
      .map(
        (e, i) =>
          `[${i + 1}] ${e.title}: ${(e.snippet || "").substring(0, 300)}`,
      )
      .join("\n");

    const { FACT_CHECK_PROMPT } =
      await import("../../prompts/research-depth.prompt");
    const prompt = FACT_CHECK_PROMPT.replace(
      "{citationsWithContext}",
      citationsText,
    ).replace("{originalEvidence}", evidenceText);

    try {
      const response = await this.chatFacade.chatWithSkills({
        messages: [
          {
            role: "system",
            content: "你是严谨的事实核查编辑。请输出 JSON 格式。",
          },
          { role: "user", content: prompt },
        ],
        additionalSkills: ["fact-check"],
        operationName: "质量审核",
        modelType: AIModelType.CHAT_FAST,
        skipGuardrails: true, // 内部系统调用，事实核查
        cachePolicy: "auto",
        taskProfile: {
          creativity: "deterministic",
          outputLength: "medium",
        },
        responseFormat: "json",
      });

      const result = extractJsonFromAIResponse<
        import("../../types/research-depth.types").FactCheckResult
      >(response.content, { requiredKey: "citations" });

      if (result.success && result.data) {
        this.logger.log(
          `[factCheckReport] Fact check complete: accuracy ${result.data.accuracyScore}/100`,
        );
        return result.data;
      }
    } catch (error) {
      this.logger.error(`[factCheckReport] Error: ${error}`);
    }

    return { citations: [], accuracyScore: 0, issues: ["事实核查过程出错"] };
  }

  /**
   * 构建维度审核系统提示词
   */
  private buildDimensionReviewSystemPrompt(topicType?: string): string {
    // Currency criteria depends on topic type — academic/technology topics
    // use older sources legitimately; news/market topics need recency.
    const currencyGuidance = this.getCurrencyGuidance(topicType);

    return `你是一位资深的研究质量审核专家，负责审核 AI 研究团队产出的研究报告质量。

## 你的职责

从广度、深度、证据支撑、逻辑连贯、时效性五个维度严格评估研究质量。

## 各维度评分标准

### 广度 (breadth)
- 90+：覆盖所有主要方面和边缘话题
- 70-89：覆盖主要方面，有少量遗漏
- 50-69：覆盖核心方面，遗漏多个重要角度
- <50：严重遗漏，只覆盖片面内容

### 深度 (depth)
- 90+：每个方面有深入分析，揭示底层机制和因果关系
- 70-89：多数方面有较深分析
- 50-69：分析停留在表面，缺少深层洞察
- <50：内容空泛，只有概述

### 证据支撑 (evidence)
- 90+：每个核心论点有 2+ 条可靠来源支撑
- 70-89：多数论点有来源支撑
- 50-69：部分论点缺少来源
- <50：大量论点无依据

### 逻辑连贯 (coherence)
- 90+：论证链清晰完整，结论有据可依
- 70-89：整体逻辑通顺，少量跳跃
- 50-69：存在逻辑断层或矛盾
- <50：结构混乱，逻辑不通

### 时效性 (currency)
${currencyGuidance}

## 输出格式

返回 JSON 格式：
{
  "qualityLevel": "excellent|good|acceptable|needs_revision|rejected",
  "overallScore": <0-100的整数>,
  "scores": {
    "breadth": <0-100>,
    "depth": <0-100>,
    "evidence": <0-100>,
    "coherence": <0-100>,
    "currency": <0-100>
  },
  "issues": [
    {
      "type": "missing_coverage|weak_evidence|outdated_info|logical_gap|shallow_analysis|missing_perspective",
      "severity": "critical|major|minor",
      "description": "问题描述",
      "affectedSection": "受影响的部分（可选）"
    }
  ],
  "suggestions": ["改进建议1", "改进建议2"],
  "needsReresearch": true/false,
  "reresearchFocus": ["需要重新研究的重点方向"]
}

## 审核原则

1. **实事求是**：严格按照上述评分标准评分，不主观臆断
2. **具体可操作**：问题描述和建议必须具体，可以指导改进
3. **建设性反馈**：指出问题的同时给出改进方向
4. **区分维度权重**：时效性权重应低于广度、深度、证据，仅占整体 15%`;
  }

  /**
   * Get currency scoring guidance based on topic type.
   * Academic/technology topics legitimately use older sources;
   * news/market topics need strict recency.
   */
  private getCurrencyGuidance(topicType?: string): string {
    switch (topicType?.toUpperCase()) {
      case "MACRO":
      case "INDUSTRY":
        return `- 90+：包含最近 3 个月内的来源，覆盖最新动态
- 70-89：多数来源在 1 年内
- 50-69：多数来源在 2 年内
- <50：来源普遍超过 2 年，缺少近期数据`;
      case "COMPANY":
        return `- 90+：包含最近 3 个月内的来源，覆盖最新财报/动态
- 70-89：多数来源在 6 个月内
- 50-69：多数来源在 1 年内
- <50：来源普遍超过 1 年`;
      case "TECHNOLOGY":
      default:
        // Technology and general topics: academic papers from 2-5 years ago are normal
        return `- 90+：包含近 1 年内的来源，并引用经典文献
- 70-89：多数来源在 2 年内，包含领域基础文献
- 50-69：多数来源在 3 年内
- <50：来源普遍超过 5 年，缺少近期进展
- **注意**：学术论文和技术文献 2-5 年内属于正常引用范围，不应因此扣分`;
    }
  }

  /**
   * 构建维度审核用户提示词
   */
  private buildDimensionReviewUserPrompt(
    topic: ResearchTopic,
    dimension: TopicDimension,
    analysis: DimensionAnalysisResult,
    evidenceCount: number,
  ): string {
    return `请审核以下研究内容：

## 研究主题
${topic.name}

## 研究维度
名称：${dimension.name}
描述：${dimension.description || "无"}

## 研究结果

### 核心摘要
${analysis.summary}

### 关键发现 (${analysis.keyFindings.length} 条)
${analysis.keyFindings.map((f, i) => `${i + 1}. [${f.significance}重要性] ${f.finding} (${f.evidenceIds.length}个证据支撑)`).join("\n")}

### 趋势分析 (${analysis.trends.length} 条)
${analysis.trends.map((t, i) => `${i + 1}. [${t.direction}] ${t.trend} (时间范围: ${t.timeframe}, ${t.evidenceIds.length}个证据)`).join("\n")}

### 挑战分析 (${analysis.challenges.length} 条)
${analysis.challenges.map((c, i) => `${i + 1}. ${c.challenge}\n   影响: ${c.impact} (${c.evidenceIds.length}个证据)`).join("\n")}

### 机会分析 (${analysis.opportunities.length} 条)
${analysis.opportunities.map((o, i) => `${i + 1}. ${o.opportunity}\n   潜力: ${o.potential} (${o.evidenceIds.length}个证据)`).join("\n")}

### 置信度
${analysis.confidenceLevel}

### 证据统计
- 总证据数: ${evidenceCount}
- 已使用证据: ${analysis.evidenceUsed}

### 详细内容
${(analysis.detailedContent || "").substring(0, 6000)}${(analysis.detailedContent || "").length > 6000 ? "...(已截断)" : ""}

---

请严格按照审核标准评估这份研究报告，输出 JSON 格式的审核结果。`;
  }

  /**
   * 分析跨维度问题
   */
  private async analyzeCrossDimensionIssues(
    _topic: ResearchTopic,
    dimensions: TopicDimension[],
    dimensionReviews: DimensionReviewResult[],
  ): Promise<ReviewIssue[]> {
    const issues: ReviewIssue[] = [];

    // 如果有多个维度分数很低，可能存在系统性问题
    const lowScoreDimensions = dimensionReviews.filter(
      (r) => r.overallScore < 60,
    );
    if (lowScoreDimensions.length >= dimensions.length * 0.5) {
      issues.push({
        type: "shallow_analysis",
        severity: "critical",
        description: `超过一半的维度 (${lowScoreDimensions.length}/${dimensions.length}) 研究质量不达标，可能存在系统性问题`,
      });
    }

    // 检查证据支撑普遍不足
    const weakEvidenceDimensions = dimensionReviews.filter(
      (r) => r.scores.evidence < 60,
    );
    if (weakEvidenceDimensions.length >= dimensions.length * 0.3) {
      issues.push({
        type: "weak_evidence",
        severity: "major",
        description: `多个维度 (${weakEvidenceDimensions.length}/${dimensions.length}) 证据支撑不足，需要加强数据收集`,
      });
    }

    return issues;
  }

  /**
   * 分析研究覆盖度
   */
  private analyzeCoverage(
    topic: ResearchTopic,
    dimensions: TopicDimension[],
  ): OverallReviewResult["coverageAnalysis"] {
    // 根据主题类型确定应该覆盖的方面
    const expectedAspects = this.getExpectedAspects(topic.type);
    const coveredAspects = dimensions.map((d) => d.name);

    // 找出缺失的方面
    const missingAspects = expectedAspects.filter(
      (aspect) =>
        !coveredAspects.some(
          (covered) =>
            covered.includes(aspect) ||
            aspect.includes(covered) ||
            this.areRelatedAspects(covered, aspect),
        ),
    );

    const coverageScore =
      ((expectedAspects.length - missingAspects.length) /
        expectedAspects.length) *
      100;

    return {
      coveredAspects,
      missingAspects,
      coverageScore: Math.round(coverageScore),
    };
  }

  /**
   * 获取期望覆盖的方面
   */
  private getExpectedAspects(topicType: string): string[] {
    switch (topicType) {
      case "MACRO":
        return [
          "政策法规",
          "市场格局",
          "技术趋势",
          "竞争态势",
          "投资动向",
          "人才状况",
          "国际比较",
          "未来展望",
        ];
      case "TECHNOLOGY":
        return [
          "技术原理",
          "发展现状",
          "应用场景",
          "技术难点",
          "竞争格局",
          "未来趋势",
        ];
      case "COMPANY":
        return [
          "公司概况",
          "业务分析",
          "财务状况",
          "竞争优势",
          "战略方向",
          "风险因素",
        ];
      default:
        return ["现状分析", "趋势预测", "竞争格局", "机会与挑战"];
    }
  }

  /**
   * 判断两个方面是否相关
   */
  private areRelatedAspects(aspect1: string, aspect2: string): boolean {
    const relatedPairs = [
      ["市场", "行业"],
      ["竞争", "格局"],
      ["技术", "创新"],
      ["政策", "法规"],
      ["投资", "融资"],
      ["人才", "团队"],
    ];

    return relatedPairs.some(
      (pair) =>
        (aspect1.includes(pair[0]) && aspect2.includes(pair[1])) ||
        (aspect1.includes(pair[1]) && aspect2.includes(pair[0])),
    );
  }

  /**
   * 生成总体建议
   */
  private generateOverallRecommendations(
    dimensionReviews: DimensionReviewResult[],
    crossDimensionIssues: ReviewIssue[],
    coverageAnalysis: OverallReviewResult["coverageAnalysis"],
  ): string[] {
    const recommendations: string[] = [];

    // 根据缺失覆盖提建议
    if (coverageAnalysis.missingAspects.length > 0) {
      recommendations.push(
        `建议补充以下研究维度: ${coverageAnalysis.missingAspects.join(", ")}`,
      );
    }

    // 根据低分维度提建议
    const worstDimensions = dimensionReviews
      .filter((r) => r.overallScore < 70)
      .sort((a, b) => a.overallScore - b.overallScore)
      .slice(0, 3);

    if (worstDimensions.length > 0) {
      recommendations.push(
        `重点改进以下维度: ${worstDimensions.map((d) => `${d.dimensionName}(${d.overallScore}分)`).join(", ")}`,
      );
    }

    // 根据跨维度问题提建议
    const criticalIssues = crossDimensionIssues.filter(
      (i) => i.severity === "critical",
    );
    if (criticalIssues.length > 0) {
      recommendations.push(
        `需要解决的关键问题: ${criticalIssues.map((i) => i.description).join("; ")}`,
      );
    }

    // 通用建议
    const avgEvidenceScore =
      dimensionReviews.reduce((sum, r) => sum + r.scores.evidence, 0) /
      dimensionReviews.length;
    if (avgEvidenceScore < 70) {
      recommendations.push(
        "建议增加高质量证据来源，特别是权威机构报告和学术论文",
      );
    }

    const avgDepthScore =
      dimensionReviews.reduce((sum, r) => sum + r.scores.depth, 0) /
      dimensionReviews.length;
    if (avgDepthScore < 70) {
      recommendations.push(
        "建议深入分析因果关系和底层逻辑，避免停留在表面描述",
      );
    }

    return recommendations;
  }

  /**
   * 确定质量等级
   */
  private determineQualityLevel(score: number): ReviewQualityLevel {
    if (score >= this.QUALITY_THRESHOLDS.excellent)
      return ReviewQualityLevel.EXCELLENT;
    if (score >= this.QUALITY_THRESHOLDS.good) return ReviewQualityLevel.GOOD;
    if (score >= this.QUALITY_THRESHOLDS.acceptable)
      return ReviewQualityLevel.ACCEPTABLE;
    if (score >= this.QUALITY_THRESHOLDS.needsRevision)
      return ReviewQualityLevel.NEEDS_REVISION;
    return ReviewQualityLevel.REJECTED;
  }

  /**
   * 创建失败的审核结果
   */
  private createFailedReviewResult(
    dimension: TopicDimension,
    error: unknown,
  ): DimensionReviewResult {
    return {
      dimensionId: dimension.id,
      dimensionName: dimension.name,
      qualityLevel: ReviewQualityLevel.NEEDS_REVISION,
      overallScore: 0,
      scores: {
        breadth: 0,
        depth: 0,
        evidence: 0,
        coherence: 0,
        currency: 0,
      },
      issues: [
        {
          type: "shallow_analysis",
          severity: "critical",
          description: `审核过程出错: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      suggestions: ["需要重新进行研究和审核"],
      needsReresearch: true,
      reresearchFocus: ["全部内容"],
    };
  }

  /**
   * Normalize LLM severity values to expected enum.
   * Handles Chinese values, typos, and alternative English terms.
   */
  private normalizeSeverity(raw: string | undefined): ReviewIssue["severity"] {
    if (!raw) return "major";
    const lower = raw.toLowerCase().trim();
    // English exact match
    if (lower === "critical") return "critical";
    if (lower === "major") return "major";
    if (lower === "minor") return "minor";
    // Chinese mappings
    if (lower.includes("严重") || lower.includes("致命")) return "critical";
    if (
      lower.includes("重要") ||
      lower.includes("主要") ||
      lower.includes("中等")
    )
      return "major";
    if (
      lower.includes("轻微") ||
      lower.includes("次要") ||
      lower.includes("建议")
    )
      return "minor";
    // Alternative English
    if (lower === "high" || lower === "error") return "critical";
    if (lower === "medium" || lower === "warning") return "major";
    if (lower === "low" || lower === "info") return "minor";
    return "major"; // safe default
  }
}
