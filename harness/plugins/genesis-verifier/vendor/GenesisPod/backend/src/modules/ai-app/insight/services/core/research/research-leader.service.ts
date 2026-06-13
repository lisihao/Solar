/**
 * Research Leader Service (Thin Facade)
 *
 * Leader 驱动的研究协调服务 - 薄门面层
 * 委托给专门的子服务处理各类逻辑：
 * - LeaderPlanningService: 研究规划
 * - LeaderIntentService: 用户意图处理
 * - LeaderAgentSelectionService: Agent 选择
 * - LeaderReviewService: 任务审核
 *
 * 本文件保留：
 * - getDecisionHistory: 简单 Prisma 查询
 * - integrateDimensionResults: 维度整合（属于 facade 自身逻辑）
 * - 工具方法: extractJsonFromResponse, extractEvidenceIds, extractKeyFindingsFromContent
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { extractJsonFromResponse } from "../../../utils/extract-json.utils";
import { sanitizeSectionOutput } from "@/modules/ai-harness/facade";
import { LeaderActionResult } from "../../data/leader-tool.service";
import { LeaderPlanningService } from "../leader/leader-planning.service";
import { LeaderIntentService } from "../leader/leader-intent.service";
import { LeaderAgentSelectionService } from "../leader/leader-agent-selection.service";
import { LeaderReviewService } from "../leader/leader-review.service";
import {
  ANALYSIS_SKILL_DEFINITIONS,
  type LeaderPlan,
  type LeaderPlannedDimension,
  type AgentAssignment,
  type ReviewDecision,
  type DimensionIntentUnderstanding,
  type AnalysisSkill,
  type AgentSectionConfig,
  type AllocatedFigure,
  type SectionPlan,
  type DimensionOutline,
  type SectionReviewDecision,
  type IntegratedDimensionResult,
  type LeaderModelInfo,
  type GlobalOutline,
} from "../../../types/leader.types";

// Re-export for backwards compatibility
export type {
  LeaderPlan,
  LeaderPlannedDimension,
  AgentAssignment,
  ReviewDecision,
  DimensionIntentUnderstanding,
  AnalysisSkill,
  AgentSectionConfig,
  AllocatedFigure,
  SectionPlan,
  DimensionOutline,
  SectionReviewDecision,
  IntegratedDimensionResult,
  LeaderModelInfo,
  GlobalOutline,
};
export { ANALYSIS_SKILL_DEFINITIONS };

// ==================== Service ====================

@Injectable()
export class ResearchLeaderService {
  private readonly logger = new Logger(ResearchLeaderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
    private readonly leaderPlanning: LeaderPlanningService,
    private readonly leaderIntent: LeaderIntentService,
    private readonly leaderAgentSelection: LeaderAgentSelectionService,
    private readonly leaderReview: LeaderReviewService,
  ) {}

  // ==================== Delegation: Planning ====================

  /**
   * 获取推理模型信息
   * ★ 委托给 LeaderPlanningService
   */
  async getReasoningModel(): Promise<LeaderModelInfo | null> {
    return this.leaderPlanning.getReasoningModel();
  }

  /**
   * Leader 规划研究任务
   * 分析用户需求，自主决定维度和执行策略
   */
  async planResearch(
    topicId: string,
    userPrompt?: string,
  ): Promise<LeaderPlan> {
    return this.leaderPlanning.planResearch(topicId, userPrompt);
  }

  /**
   * Leader 规划维度分析大纲
   */
  async planDimensionOutline(
    topic: {
      name: string;
      type: string;
      description?: string | null;
      language?: string | null;
    },
    dimension: {
      name: string;
      description?: string | null;
      searchQueries?: string[] | unknown;
    },
    evidenceSummary: string,
    figuresSummary?: string,
    otherDimensions?: Array<{ name: string; description?: string | null }>,
  ): Promise<DimensionOutline> {
    return this.leaderPlanning.planDimensionOutline(
      topic,
      dimension,
      evidenceSummary,
      figuresSummary,
      otherDimensions,
    );
  }

  /**
   * Leader 规划全局协调大纲（Phase 2）
   */
  async planGlobalOutline(
    topic: {
      name: string;
      type: string;
      description?: string | null;
      language?: string | null;
    },
    dimensionSearchResults: Array<{
      dimensionId: string;
      dimensionName: string;
      dimensionDescription?: string | null;
      evidenceSummary: string;
      figuresSummary: string;
      searchQueries?: string[] | unknown;
    }>,
  ): Promise<GlobalOutline> {
    return this.leaderPlanning.planGlobalOutline(topic, dimensionSearchResults);
  }

  // ==================== Delegation: Intent ====================

  /**
   * 处理用户的 @Leader 消息
   */
  async handleUserMessage(
    topicId: string,
    missionId: string,
    userMessage: string,
  ): Promise<{ response: string; actionResults?: LeaderActionResult[] }> {
    return this.leaderIntent.handleUserMessage(topicId, missionId, userMessage);
  }

  /**
   * ★ Leader 解码用户输入
   */
  async decodeUserInput(
    topicId: string,
    userMessage: string,
    missionId?: string,
  ): Promise<{
    decisionType: "DIRECT_ANSWER" | "CREATE_TODO" | "CLARIFY" | "ACKNOWLEDGE";
    understanding: string;
    response: string;
    todoTitle?: string;
    todoDescription?: string;
    clarifyQuestion?: string;
    clarifyOptions?: string[];
  }> {
    return this.leaderIntent.decodeUserInput(topicId, userMessage, missionId);
  }

  /**
   * Leader 解码响应类型（转发静态属性）
   */
  static readonly DecisionTypes = LeaderIntentService.DecisionTypes;

  // ==================== Delegation: Agent Selection ====================

  /**
   * ★ v7.2: 为用户请求的任务选择合适的 Agent
   */
  async selectAgentForTask(
    topicId: string,
    missionId: string,
    taskTitle: string,
    taskDescription?: string,
  ): Promise<AgentAssignment> {
    return this.leaderAgentSelection.selectAgentForTask(
      topicId,
      missionId,
      taskTitle,
      taskDescription,
    );
  }

  // ==================== Delegation: Review ====================

  /**
   * Leader 审核任务结果
   */
  async reviewTaskResult(
    missionId: string,
    taskId: string,
    result: string | Record<string, unknown>,
    dimensionName?: string,
  ): Promise<ReviewDecision> {
    return this.leaderReview.reviewTaskResult(
      missionId,
      taskId,
      result,
      dimensionName,
    );
  }

  /**
   * V5 L3: 从章节内容中提取事实断言
   */
  async extractClaims(
    sectionId: string,
    sectionContent: string,
  ): Promise<import("../../../types/research-depth.types").ExtractedClaim[]> {
    return this.leaderReview.extractClaims(sectionId, sectionContent);
  }

  /**
   * V5 L3: 验证研究假设
   */
  async verifyHypotheses(
    hypotheses: import("../../../types/research-depth.types").ResearchHypothesis[],
    evidenceSummary: string,
  ): Promise<
    import("../../../types/research-depth.types").HypothesisVerificationResult[]
  > {
    return this.leaderReview.verifyHypotheses(hypotheses, evidenceSummary);
  }

  // ==================== Local Methods ====================

  /**
   * 获取 Leader 决策历史
   */
  async getDecisionHistory(
    missionId: string,
  ): Promise<Record<string, unknown>[]> {
    return this.prisma.leaderDecision.findMany({
      where: { missionId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Leader 整合各章节内容
   *
   * 将多个章节整合成完整报告：
   * - 添加过渡语句
   * - 提取关键发现
   * - 生成总结
   */
  async integrateDimensionResults(
    dimension: { name: string; description?: string | null },
    sectionResults: Array<{ title: string; content: string }>,
    topicLanguage?: string | null,
  ): Promise<IntegratedDimensionResult> {
    this.logger.log(
      `[integrateDimensionResults] Integrating ${sectionResults.length} sections for ${dimension.name}`,
    );

    // 如果只有一个章节，直接返回（但仍提取关键发现）
    if (sectionResults.length === 1) {
      const content = sanitizeSectionOutput(sectionResults[0].content);
      const keyFindings = this.extractKeyFindingsFromContent(content);
      return {
        content,
        metadata: {
          summary: content.substring(0, 200),
          keyFindings,
          confidenceLevel: "medium",
        },
        evidenceUsed: this.extractEvidenceIds(content),
        totalWords: content.length,
      };
    }

    const leaderModel = await this.getReasoningModel();

    // Direction B：维度核心结论检测 regex（与 section-writer.service.ts 保持一致）
    const OPENING_CONCLUSION_RE =
      /^(>\s*\*{1,4}(?:核心判断|Key Finding)\*{1,4}[：:][^\n]*)\n*/;

    // 构建章节内容（不添加编号和分割线——编号由 numberSubHeadings 统一处理）
    // Direction B：第一节若以 > **核心判断**：开头，需提升到 ### 标题之前（维度级别）
    // 否则拼接后核心判断会出现在 ### 背景概述 之后，违反"开篇即结论"原则
    const sectionsContent = sectionResults
      .map((s, index) => {
        if (index === 0) {
          const conclusionMatch = s.content.match(OPENING_CONCLUSION_RE);
          if (conclusionMatch) {
            const conclusionLine = conclusionMatch[1];
            const remaining = s.content
              .slice(conclusionMatch[0].length)
              .trimStart();
            return `${conclusionLine}\n\n### ${s.title}\n\n${remaining}`;
          }
        }
        return `### ${s.title}\n\n${s.content}`;
      })
      .join("\n\n");

    // 如果没有推理模型，使用简单拼接（但仍提取关键发现）
    if (!leaderModel) {
      const cleaned = sanitizeSectionOutput(sectionsContent);
      const keyFindings = this.extractKeyFindingsFromContent(cleaned);
      return {
        content: cleaned,
        metadata: {
          summary: `关于"${dimension.name}"的分析报告。`,
          keyFindings,
          confidenceLevel: "medium",
        },
        evidenceUsed: this.extractEvidenceIds(sectionsContent),
        totalWords: sectionsContent.length,
      };
    }

    // ★ 保留完整章节内容（不压缩），仅用AI提取摘要和关键发现
    // ★ 铁墙清理：整合后的内容再执行一次清理
    const fullContent = sanitizeSectionOutput(sectionsContent);
    const totalWords = fullContent.length;

    // 用AI提取摘要和关键发现（但不重写正文）
    let summary = `关于"${dimension.name}"的深度分析报告。`;
    let keyFindings = this.extractKeyFindingsFromContent(fullContent);

    try {
      const isEnglish = topicLanguage === "en";
      const metaPrompt = isEnglish
        ? `Read the following research content and output a JSON summary with key findings:

Dimension: ${dimension.name}
${dimension.description || ""}

Content (first 8000 chars):
${fullContent.substring(0, 8000)}

Output format:
\`\`\`json
{
  "summary": "200-300 word dimension summary",
  "keyFindings": ["Key finding 1 (50-100 words)", "Key finding 2", ...]
}
\`\`\`
Requirements: summary 200-300 words, keyFindings 5-8 items, each 50-100 words.`
        : `请阅读以下研究内容，输出JSON格式的摘要和关键发现：

维度：${dimension.name}
${dimension.description || ""}

内容（前8000字）：
${fullContent.substring(0, 8000)}

输出格式：
\`\`\`json
{
  "summary": "200-300字的维度总结摘要",
  "keyFindings": ["关键发现1（50-100字）", "关键发现2", ...]
}
\`\`\`
要求：summary 200-300字，keyFindings 5-8条，每条50-100字。`;

      const metaResponse = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: isEnglish
              ? "You are a research report integration expert. Output JSON."
              : "你是研究报告整合专家，请输出JSON。",
          },
          { role: "user", content: metaPrompt },
        ],
        operationName: "研究元分析",
        model: leaderModel.modelId,
        skipGuardrails: true, // 内部系统调用，维度报告内容
        responseFormat: "json",
        taskProfile: { creativity: "low", outputLength: "medium" },
      });

      const metaResult = extractJsonFromResponse<{
        summary?: string;
        keyFindings?: string[];
      }>(metaResponse.content, this.logger, "summary");

      if (metaResult?.summary) summary = metaResult.summary;
      if (metaResult?.keyFindings?.length) keyFindings = metaResult.keyFindings;

      // ★ 2026-05-05 (Bug 2 方案 A): keyFindings 必非空硬保障 ——
      //   LLM 第一次返空 / 字段缺失时，发一次更严格 prompt 重试。
      //   截图 8 现象：task.result.keyFindings = []  → TodoDetailPanel
      //   length > 0 判断不渲染 "关键发现" section。根因是首次提取无重试 +
      //   fallback regex 在研究内容上几乎不命中。
      if (
        !metaResult?.keyFindings?.length ||
        metaResult.keyFindings.length === 0
      ) {
        this.logger.warn(
          `[integrateDimensionResults] keyFindings empty after first extract, retrying with strict prompt`,
        );
        const retryPrompt = isEnglish
          ? `The previous extraction returned no key findings, which is unacceptable.
Re-read the content below and produce AT LEAST 3 substantive key findings.
Each finding MUST be 50-150 chars, evidence-grounded, and specific (avoid generic statements).

Dimension: ${dimension.name}
${dimension.description || ""}

Content (first 8000 chars):
${fullContent.substring(0, 8000)}

Output strict JSON only:
\`\`\`json
{ "keyFindings": ["...", "...", "..."] }
\`\`\`
Do NOT output an empty array. Minimum 3 items.`
          : `上一次提取返回了空的 keyFindings，这是不可接受的。
请重新阅读以下内容，至少给出 3 条实质性关键发现。
每条 50-150 字，必须有证据支撑、内容具体（避免泛泛而谈）。

维度：${dimension.name}
${dimension.description || ""}

内容（前 8000 字）：
${fullContent.substring(0, 8000)}

只输出严格 JSON：
\`\`\`json
{ "keyFindings": ["...", "...", "..."] }
\`\`\`
不允许输出空数组，至少 3 条。`;
        try {
          const retryResp = await this.chatFacade.chat({
            messages: [
              {
                role: "system",
                content: isEnglish
                  ? "You are a research report integration expert. Output strict JSON. Do not return empty arrays."
                  : "你是研究报告整合专家，输出严格 JSON，不允许空数组。",
              },
              { role: "user", content: retryPrompt },
            ],
            operationName: "研究元分析-重试",
            model: leaderModel.modelId,
            skipGuardrails: true,
            responseFormat: "json",
            taskProfile: { creativity: "low", outputLength: "medium" },
          });
          const retryMeta = extractJsonFromResponse<{
            keyFindings?: string[];
          }>(retryResp.content, this.logger, "keyFindings");
          if (retryMeta?.keyFindings?.length) {
            keyFindings = retryMeta.keyFindings;
            this.logger.log(
              `[integrateDimensionResults] retry succeeded, got ${keyFindings.length} findings`,
            );
          }
        } catch (retryErr) {
          this.logger.warn(
            `[integrateDimensionResults] retry also failed: ${(retryErr as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `[integrateDimensionResults] Meta extraction failed, using fallback: ${(err as Error).message}`,
      );
    }

    this.logger.log(
      `[integrateDimensionResults] Preserved ${sectionResults.length} sections (${totalWords} chars), ${keyFindings.length} keyFindings`,
    );

    return {
      content: fullContent,
      metadata: {
        summary,
        keyFindings,
        confidenceLevel: "medium",
      },
      evidenceUsed: this.extractEvidenceIds(fullContent),
      totalWords,
    };
  }

  // ==================== Private Utilities ====================

  /**
   * 从内容中提取证据 ID
   */
  private extractEvidenceIds(content: string): string[] {
    const matches = content.match(/\[temp-\d+-\d+\]/g) || [];
    return [...new Set(matches.map((m) => m.slice(1, -1)))];
  }

  /**
   * 从内容中自动提取关键发现
   * 用于 fallback 场景（单章节、无推理模型、整合失败等）
   */
  private extractKeyFindingsFromContent(content: string): string[] {
    const findings: string[] = [];

    // 1. 查找明确标注的关键发现（如"关键发现："后面的内容）
    const markedFindingsMatch = content.match(
      /(?:关键发现|核心观点|主要结论|重要发现)[：:]\s*([^\n]+)/g,
    );
    if (markedFindingsMatch) {
      for (const match of markedFindingsMatch) {
        const finding = match
          .replace(/(?:关键发现|核心观点|主要结论|重要发现)[：:]\s*/, "")
          .trim();
        if (finding.length > 10 && finding.length < 200) {
          findings.push(finding);
        }
      }
    }

    // 2. 从列表项中提取（Markdown 列表）
    //   ★ 2026-05-05 (Bug 2 方案 A): 放宽长度上限（150→400）+ 不强制以"。"结尾。
    //   研究内容里 finding 详细论述往往 150-300 字，且可能以英文 . / ! 收尾。
    const listItemMatches = content.match(/^[-*]\s+.{20,400}/gm);
    if (listItemMatches && findings.length < 5) {
      for (const item of listItemMatches.slice(0, 5 - findings.length)) {
        const finding = item.replace(/^[-*]\s+/, "").trim();
        if (!findings.includes(finding)) {
          findings.push(finding);
        }
      }
    }

    // 3. 从标题下方第一句话提取（Markdown 标题）
    const headerMatches = content.match(
      /^#{2,4}\s+[^\n]+\n+([^#\n][^\n]{20,150})/gm,
    );
    if (headerMatches && findings.length < 5) {
      for (const match of headerMatches.slice(0, 3)) {
        const lines = match.split("\n").filter((l) => l.trim());
        if (lines.length > 1) {
          const sentence = lines[1].trim().replace(/^[-*]\s+/, "");
          if (sentence.length > 20 && !findings.includes(sentence)) {
            findings.push(sentence);
          }
        }
      }
    }

    // 去重并限制数量
    return [...new Set(findings)].slice(0, 5);
  }
}
