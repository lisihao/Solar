/**
 * Research Fact Checker Service
 *
 * 3 层质量控制体系的第二层：技能验证（依赖 ChatFacade + Skills）。
 *
 * - checkCitations: 使用 fact-check / claim-extraction 技能验证引用一致性
 * - checkConsistency: 使用 consistency-check 技能检查章节内部矛盾
 *
 * 注意：ChatFacade 通过 @Optional() 注入，服务在 Skills 不可用时
 * 优雅降级返回 null，不抛出异常。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { FactCheckResult, ConsistencyCheckResult } from "./quality.types";

/** 传入 LLM 的最大报告字符数，防止 token 超限 */
const MAX_CONTENT_CHARS = 8000;

/** 最多参考来源条目数 */
const MAX_REFERENCES = 20;

interface FactCheckJsonResult {
  claims: Array<{
    claim: string;
    verdict: string;
    confidence: number;
    supportingSources: string[];
  }>;
}

interface ConsistencyJsonResult {
  isConsistent: boolean;
  conflicts: Array<{
    type: string;
    description: string;
    sections: string[];
    severity: string;
  }>;
}

@Injectable()
export class ResearchFactCheckerService {
  private readonly logger = new Logger(ResearchFactCheckerService.name);

  constructor(@Optional() private readonly chatFacade?: ChatFacade) {}

  /**
   * 验证报告中的引用声明与参考来源的一致性。
   *
   * 仅在 ChatFacade 可用时执行，否则返回 null。
   *
   * @param reportContent 报告 Markdown 内容
   * @param references    参考来源列表
   */
  async checkCitations(
    reportContent: string,
    references: Array<{ title: string; url: string }>,
  ): Promise<FactCheckResult | null> {
    if (!this.chatFacade) {
      this.logger.warn(
        "[FactChecker] ChatFacade not available, skipping fact check",
      );
      return null;
    }

    try {
      const truncatedContent = reportContent.slice(0, MAX_CONTENT_CHARS);
      const refList = references
        .slice(0, MAX_REFERENCES)
        .map((r, i) => `[${i + 1}] ${r.title} (${r.url})`)
        .join("\n");

      const prompt = `请分析以下研究报告中的关键声明，并检查它们与参考来源的一致性。

## 报告内容
${truncatedContent}

## 参考来源
${refList}

请以 JSON 格式返回分析结果：
{
  "claims": [
    {
      "claim": "声明内容",
      "verdict": "verified|disputed|unverified",
      "confidence": 0.0-1.0,
      "supportingSources": ["[1]", "[3]"]
    }
  ]
}

只返回 JSON，不要其他内容。`;

      const response = await this.chatFacade.chatWithSkills({
        messages: [{ role: "user", content: prompt }],
        taskProfile: { creativity: "deterministic", outputLength: "long" },
        additionalSkills: ["fact-check", "claim-extraction"],
        responseFormat: "json",
        skipGuardrails: true,
      });

      const text = response.content ?? "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn("[FactChecker] No JSON found in fact-check response");
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]) as FactCheckJsonResult;
      const claims = parsed.claims ?? [];

      const verified = claims.filter((c) => c.verdict === "verified").length;
      const disputed = claims.filter((c) => c.verdict === "disputed").length;
      const unverified = claims.filter(
        (c) => c.verdict === "unverified",
      ).length;

      return {
        totalClaims: claims.length,
        verifiedClaims: verified,
        disputedClaims: disputed,
        unverifiedClaims: unverified,
        accuracyScore:
          claims.length > 0 ? Math.round((verified / claims.length) * 100) : 0,
        details: claims.map((c) => ({
          claim: c.claim,
          verdict: c.verdict as FactCheckResult["details"][0]["verdict"],
          confidence: c.confidence,
          supportingSources: c.supportingSources,
        })),
      };
    } catch (error) {
      this.logger.error(`[FactChecker] checkCitations failed: ${error}`);
      return null;
    }
  }

  /**
   * 检查报告各章节之间的内部一致性。
   *
   * 仅在 ChatFacade 可用时执行，否则返回 null。
   *
   * @param reportContent 报告 Markdown 内容
   */
  async checkConsistency(
    reportContent: string,
  ): Promise<ConsistencyCheckResult | null> {
    if (!this.chatFacade) {
      this.logger.warn(
        "[FactChecker] ChatFacade not available, skipping consistency check",
      );
      return null;
    }

    try {
      const truncatedContent = reportContent.slice(0, MAX_CONTENT_CHARS);

      const prompt = `请检查以下研究报告各章节之间是否存在矛盾或不一致。

## 报告内容
${truncatedContent}

检查以下类型的不一致：
1. 数据冲突：不同章节引用的数字/统计相互矛盾
2. 逻辑矛盾：一个章节的结论与另一个章节的分析矛盾
3. 来源冲突：相同指标引用了不同的数值

请以 JSON 格式返回：
{
  "isConsistent": true,
  "conflicts": [
    {
      "type": "data_conflict|logic_contradiction|source_conflict",
      "description": "冲突描述",
      "sections": ["章节A", "章节B"],
      "severity": "high|medium|low"
    }
  ]
}

只返回 JSON，不要其他内容。`;

      const response = await this.chatFacade.chatWithSkills({
        messages: [{ role: "user", content: prompt }],
        taskProfile: { creativity: "deterministic", outputLength: "medium" },
        additionalSkills: ["consistency-check"],
        responseFormat: "json",
        skipGuardrails: true,
      });

      const text = response.content ?? "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn(
          "[FactChecker] No JSON found in consistency-check response",
        );
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]) as ConsistencyJsonResult;
      const conflicts = parsed.conflicts ?? [];

      return {
        isConsistent: parsed.isConsistent ?? conflicts.length === 0,
        conflicts: conflicts.map((c) => ({
          type: c.type as ConsistencyCheckResult["conflicts"][0]["type"],
          description: c.description,
          sections: c.sections,
          severity:
            c.severity as ConsistencyCheckResult["conflicts"][0]["severity"],
        })),
        overallScore:
          conflicts.length === 0
            ? 100
            : Math.max(0, 100 - conflicts.length * 20),
      };
    } catch (error) {
      this.logger.error(`[FactChecker] checkConsistency failed: ${error}`);
      return null;
    }
  }
}
