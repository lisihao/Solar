/**
 * Slides Engine v5.0 - Fact Checker Skill
 *
 * 事实核查技能：核查幻灯片内容中的事实准确性
 * - 提取可验证的声明（数字数据、事实陈述、引用来源）
 * - 使用 AI 评估声明的可信度
 * - 返回验证结果和修改建议
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
  ChatMessage,
} from "@/modules/ai-harness/facade";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";

// ============================================================================
// Types
// ============================================================================

/**
 * 声明类型
 */
export type ClaimType = "statistic" | "fact" | "quote" | "date" | "comparison";

/**
 * 验证状态
 */
export type VerificationStatus =
  | "verified"
  | "unverified"
  | "disputed"
  | "outdated"
  | "needs_citation";

/**
 * 声明
 */
export interface Claim {
  /** 声明文本 */
  text: string;
  /** 声明类型 */
  type: ClaimType;
  /** 置信度 (0-1) */
  confidence: number;
  /** 声明出现的上下文 */
  context?: string;
}

/**
 * 声明验证结果
 */
export interface ClaimVerification {
  /** 原始声明 */
  claim: Claim;
  /** 验证状态 */
  status: VerificationStatus;
  /** 可信度评分 (0-100) */
  credibilityScore: number;
  /** 支持来源 */
  sources: string[];
  /** 修改建议 */
  suggestion?: string;
  /** 验证说明 */
  explanation?: string;
}

/**
 * 页面事实核查结果
 */
export interface PageFactCheckResult {
  /** 页面索引 */
  pageIndex: number;
  /** 验证结果列表 */
  claims: ClaimVerification[];
  /** 整体评分 (0-100) */
  overallScore: number;
  /** 可信度等级 */
  credibilityLevel: "high" | "medium" | "low" | "needs_review";
}

/**
 * 幻灯片页面（用于事实核查）
 */
export interface FactCheckSlidePage {
  /** 页面索引 */
  index: number;
  /** 页面标题 */
  title: string;
  /** 页面内容 (HTML 或文本) */
  content: string;
}

/**
 * 输入参数
 */
export interface FactCheckerInput {
  /** 需要核查的页面列表 */
  pages: FactCheckSlidePage[];
  /** 是否严格模式（更高的验证标准） */
  strictMode?: boolean;
  /** 语言 */
  language?: "zh" | "en";
}

/**
 * 输出结果
 */
export interface FactCheckerResult {
  /** 各页面的核查结果 */
  results: PageFactCheckResult[];
  /** 总结 */
  summary: {
    /** 总声明数 */
    totalClaims: number;
    /** 已验证数 */
    verifiedCount: number;
    /** 存疑数 */
    disputedCount: number;
    /** 需要引用数 */
    needsCitationCount: number;
    /** 整体可信度评分 */
    overallCredibility: number;
  };
}

// ============================================================================
// Fact Checker Skill
// ============================================================================

@Injectable()
export class FactCheckerSkill implements ISkill<
  FactCheckerInput,
  FactCheckerResult
> {
  private readonly logger = new Logger(FactCheckerSkill.name);

  // ============================================================================
  // ISkill Implementation - Required Properties
  // ============================================================================

  readonly id = "slides-fact-checker";
  readonly name = "事实核查";
  readonly description = "核查幻灯片内容中的事实准确性";
  readonly layer: SkillLayer = SKILL_LAYERS.QUALITY;
  readonly domain = "slides";
  readonly tags = ["slides", "fact-check", "verification", "quality"];
  readonly version = "5.0.0";

  constructor(@Optional() private readonly chatFacade: ChatFacade) {}

  // ============================================================================
  // ISkill Methods
  // ============================================================================

  /**
   * 执行事实核查
   */
  async execute(
    input: FactCheckerInput,
    context: SkillContext,
  ): Promise<SkillResult<FactCheckerResult>> {
    const startTime = new Date();

    if (!input.pages || input.pages.length === 0) {
      return {
        success: false,
        error: {
          code: "INVALID_INPUT",
          message: "Pages are required for fact checking",
          retryable: false,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    }

    try {
      this.logger.debug(
        `[execute] Starting fact check for ${input.pages.length} pages (executionId: ${context.executionId})`,
      );

      const results: PageFactCheckResult[] = [];

      // 逐页处理（因为每页可能有多个声明需要核查）
      for (const page of input.pages) {
        const pageResult = await this.checkPage(
          page,
          input.strictMode,
          input.language,
        );
        results.push(pageResult);
      }

      // 生成总结
      const summary = this.generateSummary(results);

      const outputResult: FactCheckerResult = {
        results,
        summary,
      };

      const endTime = new Date();

      this.logger.log(
        `[execute] Fact check completed: ${summary.totalClaims} claims, ${summary.verifiedCount} verified, ${summary.disputedCount} disputed`,
      );

      return {
        success: true,
        data: outputResult,
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    } catch (error) {
      const endTime = new Date();
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      this.logger.error(`[execute] Fact check failed: ${errorMessage}`);

      return {
        success: false,
        error: {
          code: "FACT_CHECK_FAILED",
          message: errorMessage,
          retryable: true,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * 核查单个页面
   */
  private async checkPage(
    page: FactCheckSlidePage,
    strictMode?: boolean,
    language?: string,
  ): Promise<PageFactCheckResult> {
    // 1. 提取声明
    const claims = await this.extractClaims(page, language);

    if (claims.length === 0) {
      return {
        pageIndex: page.index,
        claims: [],
        overallScore: 100,
        credibilityLevel: "high",
      };
    }

    // 2. 验证声明
    const verifications = await this.verifyClaims(claims, strictMode, language);

    // 3. 计算整体评分
    const overallScore = this.calculateScore(verifications);
    const credibilityLevel = this.getCredibilityLevel(overallScore);

    return {
      pageIndex: page.index,
      claims: verifications,
      overallScore,
      credibilityLevel,
    };
  }

  /**
   * 提取可验证的声明
   */
  private async extractClaims(
    page: FactCheckSlidePage,
    language?: string,
  ): Promise<Claim[]> {
    if (!this.chatFacade) {
      this.logger.warn(
        "[extractClaims] AIFacade not available, using regex-based extraction",
      );
      return this.extractClaimsWithRegex(page.content);
    }

    const isZh = language === "zh";
    const prompt = isZh
      ? `分析以下幻灯片内容，提取所有可验证的声明（数据、事实、日期、引用等）。

## 页面标题
${page.title}

## 内容
${page.content}

## 输出格式
返回 JSON 数组：
\`\`\`json
[
  {
    "text": "声明原文",
    "type": "statistic|fact|quote|date|comparison",
    "confidence": 0.0-1.0,
    "context": "声明出现的上下文"
  }
]
\`\`\`

只返回 JSON 数组，不要其他内容。如果没有可验证的声明，返回空数组 []。`
      : `Analyze the following slide content and extract all verifiable claims (data, facts, dates, quotes, etc.).

## Page Title
${page.title}

## Content
${page.content}

## Output Format
Return JSON array:
\`\`\`json
[
  {
    "text": "claim text",
    "type": "statistic|fact|quote|date|comparison",
    "confidence": 0.0-1.0,
    "context": "context where claim appears"
  }
]
\`\`\`

Return only JSON array, no other content. If no verifiable claims, return empty array [].`;

    try {
      const messages: ChatMessage[] = [{ role: "user", content: prompt }];
      const response = await this.chatFacade.chat({
        messages,
        modelType: AIModelType.CHAT,
        taskProfile: { creativity: "deterministic", outputLength: "short" },
      });

      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as Claim[];
      }

      return [];
    } catch (error) {
      this.logger.warn(
        `[extractClaims] AI extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return this.extractClaimsWithRegex(page.content);
    }
  }

  /**
   * 使用正则表达式提取声明（回退方案）
   */
  private extractClaimsWithRegex(content: string): Claim[] {
    const claims: Claim[] = [];

    // 提取数字统计
    const statPatterns = [
      /(\d+(?:\.\d+)?%)/g, // 百分比
      /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:万|亿|billion|million|trillion)/gi, // 大数字
      /(?:增长|下降|上涨|提升|减少).{0,10}(\d+(?:\.\d+)?%?)/g, // 变化率
    ];

    for (const pattern of statPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        claims.push({
          text: match[0],
          type: "statistic",
          confidence: 0.7,
          context: content.substring(
            Math.max(0, match.index - 30),
            Math.min(content.length, match.index + match[0].length + 30),
          ),
        });
      }
    }

    // 提取日期
    const datePatterns = [
      /(\d{4}年\d{1,2}月(?:\d{1,2}日)?)/g, // 中文日期
      /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/g, // ISO 日期
      /((?:19|20)\d{2})/g, // 年份
    ];

    for (const pattern of datePatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        claims.push({
          text: match[0],
          type: "date",
          confidence: 0.8,
          context: content.substring(
            Math.max(0, match.index - 30),
            Math.min(content.length, match.index + match[0].length + 30),
          ),
        });
      }
    }

    return claims;
  }

  /**
   * 验证声明
   */
  private async verifyClaims(
    claims: Claim[],
    strictMode?: boolean,
    language?: string,
  ): Promise<ClaimVerification[]> {
    if (!this.chatFacade || claims.length === 0) {
      // 没有 AI 能力时，返回需要人工核查的状态
      return claims.map((claim) => ({
        claim,
        status: "needs_citation" as VerificationStatus,
        credibilityScore: 50,
        sources: [],
        suggestion: "建议添加数据来源引用",
      }));
    }

    const isZh = language === "zh";
    const prompt = isZh
      ? `你是专业的事实核查员。请评估以下声明的可信度：

## 声明列表
${claims.map((c, i) => `${i + 1}. [${c.type}] ${c.text}`).join("\n")}

## 核查标准
${strictMode ? "- 严格模式：需要确切的数据来源才能标记为 verified" : "- 标准模式：合理的声明可以标记为 verified"}

## 输出格式
返回 JSON 数组：
\`\`\`json
[
  {
    "claimIndex": 0,
    "status": "verified|unverified|disputed|outdated|needs_citation",
    "credibilityScore": 0-100,
    "sources": ["可能的来源1", "可能的来源2"],
    "suggestion": "修改建议（如果需要）",
    "explanation": "核查说明"
  }
]
\`\`\`

只返回 JSON 数组。`
      : `You are a professional fact checker. Please evaluate the credibility of the following claims:

## Claims
${claims.map((c, i) => `${i + 1}. [${c.type}] ${c.text}`).join("\n")}

## Verification Standards
${strictMode ? "- Strict mode: exact data sources required to mark as verified" : "- Standard mode: reasonable claims can be marked as verified"}

## Output Format
Return JSON array:
\`\`\`json
[
  {
    "claimIndex": 0,
    "status": "verified|unverified|disputed|outdated|needs_citation",
    "credibilityScore": 0-100,
    "sources": ["possible source 1", "possible source 2"],
    "suggestion": "modification suggestion (if needed)",
    "explanation": "verification explanation"
  }
]
\`\`\`

Return only JSON array.`;

    try {
      const messages: ChatMessage[] = [{ role: "user", content: prompt }];
      const response = await this.chatFacade.chat({
        messages,
        modelType: AIModelType.CHAT,
        taskProfile: { creativity: "deterministic", outputLength: "medium" },
      });

      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<{
          claimIndex: number;
          status: VerificationStatus;
          credibilityScore: number;
          sources: string[];
          suggestion?: string;
          explanation?: string;
        }>;

        return parsed.map((v) => ({
          claim: claims[v.claimIndex] || claims[0],
          status: v.status,
          credibilityScore: v.credibilityScore,
          sources: v.sources || [],
          suggestion: v.suggestion,
          explanation: v.explanation,
        }));
      }

      return claims.map((claim) => ({
        claim,
        status: "needs_citation" as VerificationStatus,
        credibilityScore: 50,
        sources: [],
      }));
    } catch (error) {
      this.logger.warn(
        `[verifyClaims] AI verification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return claims.map((claim) => ({
        claim,
        status: "needs_citation" as VerificationStatus,
        credibilityScore: 50,
        sources: [],
      }));
    }
  }

  /**
   * 计算整体评分
   */
  private calculateScore(verifications: ClaimVerification[]): number {
    if (verifications.length === 0) {
      return 100;
    }

    const totalScore = verifications.reduce(
      (sum, v) => sum + v.credibilityScore,
      0,
    );

    return Math.round(totalScore / verifications.length);
  }

  /**
   * 获取可信度等级
   */
  private getCredibilityLevel(
    score: number,
  ): "high" | "medium" | "low" | "needs_review" {
    if (score >= 80) return "high";
    if (score >= 60) return "medium";
    if (score >= 40) return "low";
    return "needs_review";
  }

  /**
   * 生成总结
   */
  private generateSummary(
    results: PageFactCheckResult[],
  ): FactCheckerResult["summary"] {
    let totalClaims = 0;
    let verifiedCount = 0;
    let disputedCount = 0;
    let needsCitationCount = 0;
    let totalScore = 0;

    for (const result of results) {
      totalClaims += result.claims.length;
      totalScore += result.overallScore;

      for (const verification of result.claims) {
        switch (verification.status) {
          case "verified":
            verifiedCount++;
            break;
          case "disputed":
          case "outdated":
            disputedCount++;
            break;
          case "needs_citation":
          case "unverified":
            needsCitationCount++;
            break;
        }
      }
    }

    return {
      totalClaims,
      verifiedCount,
      disputedCount,
      needsCitationCount,
      overallCredibility:
        results.length > 0 ? Math.round(totalScore / results.length) : 100,
    };
  }
}
