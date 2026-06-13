/**
 * Section Writer Service
 *
 * Agent 服务：负责撰写单个章节内容
 * 每次调用只生成 300-800 字，确保不超 token 限制
 *
 * ★ 增强：内容质量检查和自动重试
 * - 检查 API 错误状态，自动抛出异常触发重试
 * - 检查内容长度，极短内容视为失败
 */

import {
  Injectable,
  Logger,
  InternalServerErrorException,
  Optional,
} from "@nestjs/common";
import { InsufficientCreditsException } from "../../types/research.exceptions";
import {
  inferIsReasoning,
  PromptCacheCoordinatorService,
} from "@/modules/ai-harness/facade";
import {
  ChatFacade,
  AIFacade,
  type QueryLoopConfig,
} from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import type { SectionPlan } from "../core/research/research-leader.service";
import type { FigureRegistryEntry } from "./evidence-summary.utils";
import {
  SECTION_WRITING_SYSTEM_PROMPT,
  SECTION_WRITING_USER_PROMPT_TEMPLATE,
  SECTION_REVISION_USER_PROMPT_TEMPLATE,
  formatEvidenceForPrompt,
  formatEvidenceForPromptContiguous,
  renderPromptTemplate,
  getLanguageInstruction,
} from "../../prompts/dimension-research.prompt";
import {
  restoreGlobalIndices,
  verifyCitations,
  type EvidenceForVerification,
} from "../../utils/citation-verifier.utils";
import { getExternalContentNotice } from "../../utils/external-content-wrapper.utils";
import {
  getWritingStandards,
  getDimensionResearchStandards,
} from "@/modules/ai-app/contracts/report-template";
import { classifyModelTier } from "../../config/model-tier.config";
import { TIER_ADAPTATIONS } from "../../config/prompt-adaptation.config";
import { isValidFigureUrl } from "../../utils/sanitize-image-url.utils";
import {
  sanitizeSectionOutput,
  stripAnalyticalInlineBullets,
  stripSectionOpeningShortLines,
  normalizeTransitionHeadings,
  fixOrdinalBoldPosition,
  convertLongListItemsToParagraphs,
  normalizeBoldStyle,
  convertOrdinalBulletsToParagraphs,
} from "@/modules/ai-harness/facade";
import type {
  EvidenceData,
  GeneratedChart,
  FigureReference,
} from "../../types/research.types";

/**
 * 内容质量检查阈值
 */
const MIN_CONTENT_LENGTH = 200; // 最小内容长度（字符）
const MIN_CONTENT_LENGTH_RATIO = 0.1; // 最小内容长度比例（相对于目标字数）

/**
 * Direction B：维度核心结论检测 regex
 *
 * 匹配范围：
 *   > **核心判断**：      ← 标准中文（ChatGPT / Grok / Deepseek）
 *   > ***核心判断***：    ← 强调三星号（Gemini 偶发）
 *   > **Key Finding**:   ← 英文标准
 *   >**核心判断**：       ← 无空格（Grok 偶发）
 *   > **核心判断**: 英文冒号
 *
 * \*{1,4} 覆盖 1-4 个星号，容忍 Gemini/Deepseek 格式漂移
 */
const OPENING_CONCLUSION_RE =
  /^>\s*\*{1,4}(?:核心判断|Key Finding)\*{1,4}[：:]/m;

/**
 * 提示词最大字符数安全上限
 * ~80K chars ≈ ~20K tokens，为推理模型保留足够的 completion token 空间
 * 防止 reasoning model 将所有 completion token 用于 CoT 而输出空内容
 */
const MAX_PROMPT_CHARS = 80000;

/**
 * 时间上下文配置
 * 用于向 LLM 传递当前时间和时效性要求
 */
export interface TemporalContext {
  /** 当前日期字符串，如 "2025年1月19日" */
  currentDate: string;
  /** 时效性要求描述 */
  freshnessRequirement: string;
}

/**
 * 章节写作结果
 */
export interface SectionWriteResult {
  sectionId: string;
  title: string;
  content: string;
  wordCount: number;
  referencesUsed: string[];
  generatedCharts?: GeneratedChart[];
  figureReferences?: FigureReference[];
  actualModelId?: string; // ★ 实际使用的模型（可能与分配的不同）
  remediationTrace?: import("../../types/quality.types").RemediationTrace;
}

/**
 * 章节写作输入
 */
export interface SectionWriteInput {
  section: SectionPlan;
  evidenceData: EvidenceData[];
  previousSections?: Array<{ title: string; content: string }>;
  /** ★ 指定使用的模型ID（用于实现 Agent 多元化） */
  modelId?: string;
  /** ★ 时间上下文（当前日期和时效性要求） */
  temporalContext?: TemporalContext;
  /** ★ Leader 预分配的图表（避免写手重复选图） */
  allocatedFigures?: import("../core/research/research-leader.service").AllocatedFigure[];
  /** V5: 验证结果上下文（注入到写作 prompt 中） */
  validationContext?: string;
  /** 研究语言设置 (zh/en) */
  topicLanguage?: string | null;
  /** ★ Leader 分配的任务级技能（与 section.agentConfig.skills 合并后注入 chatWithSkills） */
  assignedSkills?: string[];
  /** ★ 图表注册表（figureId → 元数据），用于 backfillFigureUrls 的单一可信来源 */
  figureRegistry?: Map<string, FigureRegistryEntry>;
  /**
   * Direction B: 标记该章节是否为整个维度的绝对第一节（需要生成核心判断）
   * 由 dimension-writing.service.ts 在并行组遍历时精确设置，
   * 避免同一并行组内所有无依赖章节都被误判为"第一节"
   */
  isFirstDimensionSection?: boolean;
  /** ★ Phase 5: Mission ID for prompt cache prefix sharing */
  missionId?: string;
}

/**
 * 章节修订输入
 */
export interface SectionRevisionInput {
  section: SectionPlan;
  originalContent: string;
  reviewFeedback: string;
  revisionInstructions: string;
  evidenceData: EvidenceData[];
  /** ★ 指定使用的模型ID（用于实现 Agent 多元化） */
  modelId?: string;
  /** 研究语言设置 (zh/en) */
  topicLanguage?: string | null;
  /** ★ Leader 分配的任务级技能（与 section.agentConfig.skills 合并后注入 chatWithSkills） */
  assignedSkills?: string[];
}

@Injectable()
export class SectionWriterService {
  private readonly logger = new Logger(SectionWriterService.name);

  constructor(
    private readonly chatFacade: ChatFacade,
    private readonly engineFacade: AIFacade,
    @Optional()
    private readonly promptCacheCoordinator?: PromptCacheCoordinatorService,
  ) {}

  /**
   * 撰写单个章节
   *
   * @param input 章节写作输入
   * @returns 章节写作结果
   */
  async writeSection(input: SectionWriteInput): Promise<SectionWriteResult> {
    const {
      section,
      evidenceData,
      previousSections,
      modelId,
      temporalContext,
    } = input;

    this.logger.log(
      `[writeSection] Writing section: ${section.title} (${section.targetWords} words)${modelId ? `, model: ${modelId}` : ""}`,
    );

    // ★ Direction A: 模型 tier 自适应 — 证据截断 + prompt suffix + taskProfile
    const tier = classifyModelTier(modelId ?? "");
    const tierAdaptation = TIER_ADAPTATIONS[tier];

    // 对弱模型截断证据条数，避免上下文过长导致质量下降
    const effectiveEvidence =
      tierAdaptation.maxEvidenceItems > 0 &&
      evidenceData.length > tierAdaptation.maxEvidenceItems
        ? evidenceData.slice(0, tierAdaptation.maxEvidenceItems)
        : evidenceData;

    // ★ 连续编号：将不连续的全局编号映射为 1, 2, 3...，降低 LLM 混淆概率
    const { formatted: evidenceContiguous, localToGlobalMap } =
      formatEvidenceForPromptContiguous(effectiveEvidence);
    let evidenceFormatted = evidenceContiguous;

    // 格式化要点为编号列表（LLM 理解编号列表更好，裸 bullets 由后处理铁墙删除）
    const keyPointsFormatted = section.keyPoints
      .map((p, i) => {
        let normalized = p
          .replace(/^[第]?[一二三四五六七八九十]+[类层点条项]?[是：:]\s*/u, "")
          .replace(/^[类层点条项][是：:]\s*/u, "")
          .replace(/^[是][：:]\s*/u, "");
        if (normalized.trim().length < 5) normalized = p;
        return `${i + 1}. ${normalized.trim()}`;
      })
      .join("\n");

    // 格式化前置章节：传入所有已写 section，但智能截断控制总量
    let previousContent = "无";
    if (previousSections && previousSections.length > 0) {
      const MAX_PREVIOUS_TOTAL = 6000; // 总量上限
      const parts: string[] = [];
      let totalLength = 0;

      // 从最近的开始，每个 section 摘要 800 字符
      const reversed = [...previousSections].reverse();
      for (const s of reversed) {
        if (totalLength >= MAX_PREVIOUS_TOTAL) {
          // 超出总量上限，停止添加更多章节
          break;
        }
        // 智能截断：在句子结尾处截断，而非粗暴的 substring
        let truncated = s.content.substring(0, 800);
        if (s.content.length > 800) {
          // 寻找最后一个句子结束符（中英文）
          const lastSentenceEnd = Math.max(
            truncated.lastIndexOf("。"),
            truncated.lastIndexOf("."),
            truncated.lastIndexOf("！"),
            truncated.lastIndexOf("？"),
            truncated.lastIndexOf("!"),
            truncated.lastIndexOf("?"),
          );
          // 仅当找到的位置不太靠前（至少保留 600 字符）时才截断
          if (lastSentenceEnd > 600) {
            truncated = truncated.substring(0, lastSentenceEnd + 1);
          }
          truncated += "...";
        }
        const entry = `### ${s.title}\n${truncated}`;
        parts.push(entry);
        totalLength += entry.length;
      }

      // 恢复原始顺序
      previousContent = parts.reverse().join("\n\n");
    }

    // ★ 提示词大小安全检查：防止超大 prompt 导致推理模型将所有 completion token 用于 CoT
    // 估算固定部分（系统提示 + 要点 + 其他变量）约占 8000 字符，剩余预算分配给可变部分
    const EVIDENCE_BUDGET = MAX_PROMPT_CHARS - previousContent.length - 8000;
    if (evidenceFormatted.length > EVIDENCE_BUDGET && EVIDENCE_BUDGET > 0) {
      this.logger.warn(
        `[writeSection] Prompt too large for section "${section.title}": evidence=${evidenceFormatted.length} chars, budget=${EVIDENCE_BUDGET} chars. Truncating evidence.`,
      );
      // 在段落边界处截断，保持内容完整性
      let truncated = evidenceFormatted.substring(0, EVIDENCE_BUDGET);
      const lastSeparator = truncated.lastIndexOf("\n---\n");
      if (lastSeparator > EVIDENCE_BUDGET * 0.5) {
        truncated = truncated.substring(0, lastSeparator);
      }
      evidenceFormatted = truncated + "\n\n[部分证据因长度限制已省略]";
      this.logger.warn(
        `[writeSection] Evidence truncated to ${evidenceFormatted.length} chars for section "${section.title}"`,
      );
    }

    // 如果截断证据后 previousContent 仍导致超限，进一步截断前置章节
    const remainingBudget = MAX_PROMPT_CHARS - evidenceFormatted.length - 8000;
    if (previousContent.length > remainingBudget && remainingBudget > 0) {
      this.logger.warn(
        `[writeSection] previousContent too large (${previousContent.length} chars), truncating to ${remainingBudget} chars`,
      );
      previousContent = previousContent.substring(0, remainingBudget) + "...";
    }

    // 格式化 Agent 配置指导（拆分为 leader 指导 + skill IDs）
    // ★ 合并 section-level 和 mission-level assignedSkills
    const { leaderGuidance, skillIds } = this.formatAgentGuidance(
      section,
      input.assignedSkills,
    );

    // 准备提示词变量（包含时间上下文）
    const promptVariables = {
      sectionTitle: section.title,
      sectionDescription: section.description,
      targetWords: String(section.targetWords),
      minReferences: String(section.evidenceRequirements.minReferences),
      keyPoints: keyPointsFormatted,
      evidenceList: evidenceFormatted,
      previousContent,
      agentGuidance: leaderGuidance,
      // ★ 时间上下文
      currentDate: temporalContext?.currentDate || this.getCurrentDate(),
      freshnessRequirement:
        temporalContext?.freshnessRequirement ||
        "不限制时间范围，但建议优先使用最近的数据",
      // ★ 图片资源列表（使用 figureId 标识，与注册表一致）
      figuresList: this.formatFiguresForSection(input.allocatedFigures),
    };

    // 渲染用户提示词
    const userPrompt = renderPromptTemplate(
      SECTION_WRITING_USER_PROMPT_TEMPLATE,
      promptVariables,
    );

    // Direction B: 第一节强制注入核心判断指令（代码保证，不依赖 LLM 推理）
    // 使用 isFirstDimensionSection 精确标记（由 dimension-writing.service 设置），
    // 避免同一并行组多个无依赖章节都注入核心判断指令
    const isFirstSection = input.isFirstDimensionSection === true;
    const lang = input.topicLanguage || "zh";
    const openingInstruction = isFirstSection
      ? lang.startsWith("en")
        ? `\n\n⚠️ **You are writing the FIRST section of this dimension.** Your output must begin (before any ### heading) with:\n> **Key Finding**: [The single most important conclusion of this dimension, ≤50 words, must include specific data or a verifiable fact]`
        : `\n\n⚠️ **你是本维度的第一节**：输出内容的绝对第一行（在任何 ### 标题之前）必须是：\n> **核心判断**：[本维度最重要的结论，≤50字，必须包含具体数据或可验证的事实，禁止泛化描述]`
      : lang.startsWith("en")
        ? `\n\n⚠️ **You are NOT the first section of this dimension.** Do NOT add a "> **Key Finding**" line. Start directly with your ### heading or content.`
        : `\n\n⚠️ **你不是本维度的第一节**：禁止在输出中添加 > **核心判断** 行，直接从 ### 标题或正文内容开始。`;

    // V5: Inject validation context if available
    let finalUserPrompt =
      (input.validationContext
        ? `${userPrompt}\n\n${input.validationContext}`
        : userPrompt) + openingInstruction;

    // ★ Direction A: prompt suffix 追加
    if (tierAdaptation.promptSuffix) {
      finalUserPrompt += tierAdaptation.promptSuffix;
    }

    // 调用 AI 写作
    // ★ 支持指定模型实现 Agent 多元化
    const languageInstruction = getLanguageInstruction(
      input.topicLanguage || "zh",
    );
    const systemPrompt = renderPromptTemplate(SECTION_WRITING_SYSTEM_PROMPT, {
      languageInstruction,
      externalContentNotice: getExternalContentNotice(input.topicLanguage),
      writingStandards: getWritingStandards(input.topicLanguage || "zh"),
      researchStandards: getDimensionResearchStandards(
        input.topicLanguage || "zh",
      ),
    });

    const isReasoningModel = inferIsReasoning(modelId ?? "");
    const effectiveSystemPrompt = isReasoningModel
      ? this.stripChartInstructions(systemPrompt)
      : systemPrompt;
    if (isReasoningModel) {
      this.logger.log(
        `[writeSection] Reasoning model detected (${modelId}), chart instructions stripped from prompt`,
      );
    }

    const startTime = Date.now();
    // ★ Phase 1: Use chatWithLoop for auto-continuation on truncated sections.
    // Falls back to chat() internally if QueryLoopService is unavailable.
    // Skills are injected via additionalSkills → chat() → chatWithSkills().
    const loopConfig: QueryLoopConfig = {
      maxContinuations: 3,
      diminishingThreshold: 500,
      minContinuationsForDiminishing: 2,
      continuationPrompt:
        "Your previous response was truncated. Continue writing from exactly where you left off. Do not repeat any content already written. Do not add any preamble or transition — continue the text seamlessly.",
    };
    // ★ Phase 5: Get frozen cache prefix for prompt cache sharing across dimensions
    const cachePrefix = input.missionId
      ? this.promptCacheCoordinator?.getPrefix(input.missionId)
      : null;

    const response = await this.chatFacade.chatWithLoop(
      {
        messages: [
          { role: "system", content: effectiveSystemPrompt },
          { role: "user", content: finalUserPrompt },
        ],
        // 不传 domain（避免加载全部 11 个 research skills）
        // 只传 additionalSkills：精确加载 Leader 分配的 skill
        additionalSkills: skillIds,
        operationName: "章节写作",
        modelType: AIModelType.CHAT,
        model: modelId, // ★ 使用指定模型（如果提供）
        skipGuardrails: true, // 内部系统调用，章节写作含外部研究数据
        cachePolicy: "auto",
        taskProfile: tierAdaptation.taskProfile,
        sharedCachePrefix: cachePrefix
          ? { systemPromptText: cachePrefix.systemPromptText }
          : undefined,
      },
      loopConfig,
    );
    const latencyMs = Date.now() - startTime;

    // ★ 检查 API 错误状态
    if (response.isError) {
      const errorPreview = response.content.slice(0, 200);
      this.logger.error(
        `[writeSection] API error for ${section.title}: ${errorPreview}`,
      );

      // ★ 积分不足：不重试，直接抛出特殊错误让上层快速失败
      const lc = errorPreview.toLowerCase();
      if (
        lc.includes("insufficient credits") ||
        lc.includes("insufficient_credits")
      ) {
        throw new InsufficientCreditsException(response.content);
      }

      throw new InternalServerErrorException(
        `API error while writing section "${section.title}": ${response.content}`,
      );
    }

    // 提取内容（移除可能的 markdown 代码块包装）
    const rawContent = this.extractContent(response.content);

    // 解析图表数据
    const { markdown, charts } = this.parseChartOutput(rawContent);
    // ★ 第一道铁墙：白名单清理 LLM 输出中的 JSON 残留、元注释、指令泄漏等
    let content = sanitizeSectionOutput(markdown);
    // ★ 过渡词标题降级：### 一方面 / ### 首先 等不应作为章节标题
    content = normalizeTransitionHeadings(content);
    // ★ 开头短句块清理：删除 GPT 在章节开头生成的无 marker 短句罗列（keyPoints 伪摘要）
    content = stripSectionOpeningShortLines(content);
    // ★ 分析性 bullet 清理：将正文中被错误列表化的分析段落还原为段落
    content = stripAnalyticalInlineBullets(content);
    // ★ 序数词加粗位置修复：第一**类是...** → **第一类**是...
    content = fixOrdinalBoldPosition(content);
    // ★ 超长列表项转段落：>120字的 bullet 项转为段落
    content = convertLongListItemsToParagraphs(content);
    // ★ Bold 枚举/引导词/段落开头导语句去粗
    content = normalizeBoldStyle(content);
    // ★ 序数词 bullet（其一/其二/第一/第二）转段落
    content = convertOrdinalBulletsToParagraphs(content);

    // ★ 连续编号还原：将 LLM 使用的连续编号 [1],[2],[3]... 还原为全局编号
    if (localToGlobalMap.size > 0) {
      content = restoreGlobalIndices(content, localToGlobalMap);
    }

    // ★ 引用后验证：用文本相似度独立校验每个引用是否匹配上下文
    // 注意：此时 content 已经通过 restoreGlobalIndices 还原为全局编号，
    // 因此 evidence 的 index 也必须使用全局编号才能正确匹配。
    const evidenceForVerification: EvidenceForVerification[] = evidenceData.map(
      (e, i) => {
        const localIdx = e.promptIndex || i + 1;
        const globalIdx = localToGlobalMap.get(localIdx) ?? localIdx;
        return {
          index: globalIdx,
          title: e.title,
          domain: e.domain,
          content:
            (e as { fullContent?: string | null }).fullContent || e.snippet,
        };
      },
    );
    const verifyResult = verifyCitations(content, evidenceForVerification);
    if (verifyResult.stats.corrected > 0 || verifyResult.stats.removed > 0) {
      this.logger.warn(
        `[writeSection] Citation verification for "${section.title}": ` +
          `${verifyResult.stats.corrected} corrected, ${verifyResult.stats.removed} removed ` +
          `(out of ${verifyResult.stats.total} total)`,
      );
      content = verifyResult.content;
    }

    // ★ 检查内容质量（长度检查）
    const minLength = Math.max(
      MIN_CONTENT_LENGTH,
      section.targetWords * MIN_CONTENT_LENGTH_RATIO,
    );
    if (content.length < minLength) {
      this.logger.error(
        `[writeSection] Content too short for ${section.title}: ${content.length} chars < ${minLength} min`,
      );
      throw new InternalServerErrorException(
        `Content too short for section "${section.title}": got ${content.length} chars, expected at least ${minLength}`,
      );
    }

    // 统计字数和引用
    const wordCount = content.length;
    const referencesUsed = this.extractReferences(content);

    // ★ 用 allocatedFigures + evidenceData 补全 figureReferences 中缺失的 imageUrl
    let figureRefsToBackfill = charts.figureReferences;

    // ★ v9: 引用驱动图表注入 — 扫描 figureRegistry，找到与已引用证据匹配的图表并自动注入
    // 背景：Leader 在写作前分配图表，仅基于文本元数据（caption/type/title），无法预知章节会引用哪些证据。
    // 本机制在写作完成后，根据章节实际引用的证据索引 [N]，将 figureRegistry 中 evidenceIndex===N 的图表注入。
    // 相比 Leader 分配，citation-driven 注入精确匹配引用，每章节最多补充 2 张，且不重复 Leader 已分配的图表。
    if (
      input.figureRegistry &&
      input.figureRegistry.size > 0 &&
      referencesUsed.length > 0
    ) {
      const citedIndices = new Set(
        referencesUsed.map(Number).filter((n) => !isNaN(n)),
      );
      const alreadyAssignedFigureIds = new Set<string>(
        (input.allocatedFigures || []).map((f) => f.figureId),
      );
      // 当前 LLM 已输出的 figureId 集合
      for (const ref of figureRefsToBackfill) {
        if (ref.figureId) alreadyAssignedFigureIds.add(ref.figureId);
      }

      const citationInjected: typeof figureRefsToBackfill = [];
      for (const [figureId, entry] of input.figureRegistry.entries()) {
        if (citationInjected.length >= 2) break; // 每章节最多补充 2 张
        if (alreadyAssignedFigureIds.has(figureId)) continue; // 已分配，跳过
        if (!citedIndices.has(entry.evidenceIndex)) continue; // 未引用此证据，跳过
        if (!entry.imageUrl || !isValidFigureUrl(entry.imageUrl)) continue; // URL 无效，跳过

        citationInjected.push({
          id: `citation-fig-${figureId}`,
          figureId,
          evidenceCitationIndex: entry.evidenceIndex,
          figureIndex: entry.figureIndex,
          imageUrl: entry.imageUrl,
          caption: entry.caption || "",
          position: "end_of_section",
          source: entry.evidenceTitle || entry.evidenceDomain || figureId,
          relevance: `来自已引用证据[${entry.evidenceIndex}]`,
        });
      }

      if (citationInjected.length > 0) {
        figureRefsToBackfill = [...figureRefsToBackfill, ...citationInjected];
        this.logger.log(
          `[writeSection] Citation-driven injection: +${citationInjected.length} figures from cited evidence [${[...citedIndices].join(",")}] (${section.title})`,
        );
      }
    }

    // ★ 诊断日志：记录 allocatedFigures 状态
    this.logger.log(
      `[writeSection] ${section.title}: allocatedFigures=${input.allocatedFigures?.length ?? 0}, ` +
        `figureRefsFromLLM=${figureRefsToBackfill.length}, ` +
        `figureRegistry=${input.figureRegistry?.size ?? "N/A"}`,
    );

    // ★ v8: 补充模式 — LLM 输出的 figureReferences 保留，未被 LLM 提及的 allocatedFigures 自动补充
    // LLM 现在只输出 figureId，通过注册表回填 imageUrl 等字段
    if (input.allocatedFigures && input.allocatedFigures.length > 0) {
      // 诊断日志
      for (const fig of input.allocatedFigures) {
        this.logger.log(
          `[writeSection] allocatedFig[${fig.figureId}]: imageUrl=${fig.imageUrl ? `"${fig.imageUrl.substring(0, 60)}..."` : "EMPTY"}, caption="${(fig.caption || "").substring(0, 50)}", reason="${(fig.relevanceReason || "").substring(0, 50)}"`,
        );
      }

      // 找出 LLM 已提及的 figureId 集合
      const llmMentionedIds = new Set<string>();
      for (const ref of figureRefsToBackfill) {
        if (ref.figureId) llmMentionedIds.add(ref.figureId);
      }

      // 将 LLM 未提及的 allocatedFigures 追加
      const supplementFigures = input.allocatedFigures
        .filter((fig) => {
          if (llmMentionedIds.has(fig.figureId)) return false; // LLM 已引用，不重复
          if (!fig.imageUrl || !isValidFigureUrl(fig.imageUrl)) {
            this.logger.warn(
              `[writeSection] Dropping ${fig.figureId} — no valid imageUrl`,
            );
            return false;
          }
          return true;
        })
        .map((fig, idx) => {
          const entry = input.figureRegistry?.get(fig.figureId);
          let sourceText = entry?.evidenceTitle || "";
          if (!sourceText && fig.imageUrl) {
            try {
              sourceText = new URL(fig.imageUrl).hostname.replace(/^www\./, "");
            } catch {
              // invalid URL, skip
            }
          }
          if (!sourceText) {
            sourceText = fig.figureId;
          }
          return {
            id: `auto-fig-${idx}`,
            figureId: fig.figureId,
            evidenceCitationIndex: entry?.evidenceIndex,
            figureIndex: entry?.figureIndex,
            imageUrl: fig.imageUrl,
            caption: fig.caption || "",
            position: "end_of_section",
            source: sourceText,
            relevance: fig.relevanceReason || "",
          };
        });

      if (supplementFigures.length > 0) {
        figureRefsToBackfill = [...figureRefsToBackfill, ...supplementFigures];
        this.logger.log(
          `[writeSection] Supplemented ${supplementFigures.length} unmentioned allocated figures (LLM output ${charts.figureReferences.length}, total now ${figureRefsToBackfill.length})`,
        );
      }
    }

    const backfilledRefs = this.backfillFigureUrls(
      figureRefsToBackfill,
      input.allocatedFigures,
      input.figureRegistry,
    );

    // ★ 最终相关性校验（v10）：
    // 1. 关键词匹配（同步，快）：bigram + latin word
    // 2. Embedding fallback（异步，仅当 matchCount=0 且 keywords 存在时触发）
    //    解决跨语言误杀：英文 caption（"AI agent adoption"）vs 中文 section（"AI智能体采用率"）
    const sectionCtx = [
      section.title,
      ...section.keyPoints,
      section.description || "",
    ]
      .join(" ")
      .toLowerCase();

    // Cosine similarity helper
    const cosine = (a: number[], b: number[]): number => {
      let dot = 0,
        magA = 0,
        magB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
      }
      return magA === 0 || magB === 0
        ? 0
        : dot / (Math.sqrt(magA) * Math.sqrt(magB));
    };

    // Section embedding：Promise 缓存（修复 B1 竞态：memoize Promise 本身，而非结果值）
    // 原 null-based 缓存在 Promise.all 并发下不生效：多个 map 回调在首个 await 返回前
    // 同时读到 null，重复发起 N 次 embeddingGenerate 请求。
    let sectionEmbeddingPromise: Promise<number[] | null> | null = null;
    const getSectionEmbedding = (): Promise<number[] | null> => {
      if (sectionEmbeddingPromise === null) {
        sectionEmbeddingPromise = this.engineFacade
          .embeddingGenerate(sectionCtx.substring(0, 500))
          .then((r) => r?.embedding ?? null)
          .catch(() => null);
      }
      return sectionEmbeddingPromise;
    };

    const keepFlags = await Promise.all(
      backfilledRefs.map(async (ref) => {
        const refText =
          `${ref.caption || ""} ${ref.relevance || ""}`.toLowerCase();
        // Extract CJK bigrams + latin words for matching
        const cjkChars = refText.replace(/[^\u4e00-\u9fff]/g, "");
        const latinWords = refText
          .replace(/[\u4e00-\u9fff]+/g, " ")
          .split(/[\s\W]+/)
          .filter((w) => w.length >= 3);
        const bigrams: string[] = [];
        for (let bi = 0; bi < cjkChars.length - 1; bi++) {
          bigrams.push(cjkChars.substring(bi, bi + 2));
        }
        const keywords = [...bigrams, ...latinWords];
        const matchCount = keywords.filter((kw) =>
          sectionCtx.includes(kw),
        ).length;

        // Embedding fallback：matchCount=0 且 keywords 存在时触发（跨语言场景）
        const embeddingFallback = async (): Promise<boolean> => {
          try {
            const [secEmb, figResult] = await Promise.all([
              getSectionEmbedding(),
              this.engineFacade.embeddingGenerate(refText.substring(0, 300)),
            ]);
            // fail-open：任一 embedding 不可用时放行（宁可保留，不误删）
            if (!secEmb?.length || !figResult?.embedding?.length) {
              this.logger.warn(
                `[writeSection] Embedding unavailable for "${ref.caption?.substring(0, 50)}" — allowing (fail-open)`,
              );
              return true;
            }
            const sim = cosine(secEmb, figResult.embedding);
            const keep = sim >= 0.3;
            this.logger.log(
              `[writeSection] Embedding fallback for "${ref.caption?.substring(0, 50)}" — sim=${sim.toFixed(3)} → ${keep ? "keep" : "remove"}`,
            );
            return keep;
          } catch {
            // Embedding 失败时宁可放行，不误删
            this.logger.warn(
              `[writeSection] Embedding fallback failed for "${ref.caption?.substring(0, 50)}" — allowing (fail-open)`,
            );
            return true;
          }
        };

        // ★ v10: Embedding 主力方案
        // 关键词命中 → 快速放行（跳过 embedding，节省调用）
        if (matchCount >= 1) return true;

        // 无有效文本 → 无法判断，拒绝
        if (refText.trim().length < 5) {
          this.logger.warn(
            `[writeSection] Removing figure with empty caption from section "${section.title}"`,
          );
          return false;
        }

        // Embedding 主力判断（涵盖：跨语言、关键词不重叠、短 caption 等所有场景）
        const keep = await embeddingFallback();
        if (!keep) {
          this.logger.warn(
            `[writeSection] Removing irrelevant figure "${ref.caption?.substring(0, 60)}" from section "${section.title}" — embedding sim < 0.3`,
          );
        }
        return keep;
      }),
    );

    const finalFigureRefs = backfilledRefs.filter((_, i) => keepFlags[i]);

    // Direction B：验证第一节核心判断，缺失时自动 fallback prepend
    if (isFirstSection) {
      const hasOpeningConclusion = OPENING_CONCLUSION_RE.test(content);
      if (hasOpeningConclusion) {
        const matchLine = content.match(OPENING_CONCLUSION_RE);
        const lineStart = matchLine ? (matchLine.index ?? 0) : 0;
        const preview = content
          .substring(lineStart, lineStart + 80)
          .replace(/\n/g, "\\n");
        this.logger.log(
          `[writeSection][Direction-B] ✅ Opening conclusion present: "${preview}"`,
        );
      } else {
        // 模型未遵循指令 → 从正文自动提取并强制 prepend（无需 LLM 调用）
        const fallback = this.extractFallbackConclusion(content, lang);
        const label = lang.startsWith("en")
          ? "**Key Finding**"
          : "**核心判断**";
        content = `> ${label}：${fallback}\n\n${content}`;
        this.logger.warn(
          `[writeSection][Direction-B] ⚠️ MISSING — auto-prepended fallback for "${section.title}": "${fallback}"`,
        );
      }
    }

    this.logger.log(
      `[writeSection] Completed ${section.title}: ${wordCount} chars, ${referencesUsed.length} refs, ${finalFigureRefs.length} figRefs (${backfilledRefs.length - finalFigureRefs.length} filtered), ${charts.generatedCharts.length} charts, ${latencyMs}ms`,
    );

    return {
      sectionId: section.id,
      title: section.title,
      content,
      wordCount,
      referencesUsed,
      generatedCharts: charts.generatedCharts,
      figureReferences: finalFigureRefs,
      actualModelId: response.model, // ★ 记录实际使用的模型
    };
  }

  /**
   * 修订章节
   *
   * @param input 修订输入
   * @returns 修订后的章节
   */
  async reviseSection(
    input: SectionRevisionInput,
  ): Promise<SectionWriteResult> {
    const {
      section,
      originalContent,
      reviewFeedback,
      revisionInstructions,
      evidenceData,
      modelId,
    } = input;

    this.logger.log(
      `[reviseSection] Revising section: ${section.title}${modelId ? `, model: ${modelId}` : ""}`,
    );

    // 格式化证据列表
    let evidenceFormattedRevision = formatEvidenceForPrompt(evidenceData);

    // ★ 提示词大小安全检查（与 writeSection 保持一致）
    // reviseSection 的固定部分还包含 originalContent + reviewFeedback，因此预算更保守
    const REVISION_FIXED_OVERHEAD =
      8000 + originalContent.length + reviewFeedback.length;
    const REVISION_EVIDENCE_BUDGET = MAX_PROMPT_CHARS - REVISION_FIXED_OVERHEAD;
    if (
      evidenceFormattedRevision.length > REVISION_EVIDENCE_BUDGET &&
      REVISION_EVIDENCE_BUDGET > 0
    ) {
      this.logger.warn(
        `[reviseSection] Prompt too large for section "${section.title}": evidence=${evidenceFormattedRevision.length} chars, budget=${REVISION_EVIDENCE_BUDGET} chars. Truncating evidence.`,
      );
      let truncated = evidenceFormattedRevision.substring(
        0,
        REVISION_EVIDENCE_BUDGET,
      );
      const lastSeparator = truncated.lastIndexOf("\n---\n");
      if (lastSeparator > REVISION_EVIDENCE_BUDGET * 0.5) {
        truncated = truncated.substring(0, lastSeparator);
      }
      evidenceFormattedRevision = truncated + "\n\n[部分证据因长度限制已省略]";
      this.logger.warn(
        `[reviseSection] Evidence truncated to ${evidenceFormattedRevision.length} chars for section "${section.title}"`,
      );
    }

    // 准备提示词变量
    const promptVariables = {
      sectionTitle: section.title,
      targetWords: String(section.targetWords),
      minReferences: String(section.evidenceRequirements.minReferences),
      originalContent,
      reviewFeedback,
      revisionInstructions: revisionInstructions || "请根据反馈改进内容",
      evidenceList: evidenceFormattedRevision,
    };

    // 渲染用户提示词
    const userPrompt = renderPromptTemplate(
      SECTION_REVISION_USER_PROMPT_TEMPLATE,
      promptVariables,
    );

    // Direction B：若原始内容包含核心判断，修订时必须保留
    const originalHasConclusion = OPENING_CONCLUSION_RE.test(originalContent);
    const conclusionPreservationInstruction = originalHasConclusion
      ? (input.topicLanguage || "zh").startsWith("en")
        ? `\n\n⚠️ **Direction B — PRESERVE opening conclusion**: The original content starts with a "Key Finding" blockquote. Your revised output MUST keep this line as the absolute first line, unchanged. Only revise the content that follows it.`
        : `\n\n⚠️ **Direction B — 必须保留核心判断**：原始内容以 \`> **核心判断**：\` 开头。修订后输出的绝对第一行必须保留此行不变，只修订其后的正文内容。`
      : "";
    const finalRevisionPrompt = userPrompt + conclusionPreservationInstruction;

    // 调用 AI 修订
    // ★ 支持指定模型实现 Agent 多元化
    const revisionLanguageInstruction = getLanguageInstruction(
      input.topicLanguage || "zh",
    );
    const revisionSystemPrompt = renderPromptTemplate(
      SECTION_WRITING_SYSTEM_PROMPT,
      {
        languageInstruction: revisionLanguageInstruction,
        externalContentNotice: getExternalContentNotice(input.topicLanguage),
        writingStandards: getWritingStandards(input.topicLanguage || "zh"),
      },
    );

    // ★ 提取 Leader 分配的 skill（与 writeSection 保持一致）
    // ★ 合并 section-level 和 mission-level assignedSkills
    const { skillIds } = this.formatAgentGuidance(
      section,
      input.assignedSkills,
    );

    const isReasoningModelRevision = inferIsReasoning(modelId ?? "");
    const effectiveRevisionSystemPrompt = isReasoningModelRevision
      ? this.stripChartInstructions(revisionSystemPrompt)
      : revisionSystemPrompt;
    if (isReasoningModelRevision) {
      this.logger.log(
        `[reviseSection] Reasoning model detected (${modelId}), chart instructions stripped from prompt`,
      );
    }

    const startTime = Date.now();
    const response = await this.chatFacade.chatWithSkills({
      messages: [
        { role: "system", content: effectiveRevisionSystemPrompt },
        { role: "user", content: finalRevisionPrompt },
      ],
      additionalSkills: skillIds,
      operationName: "章节写作(技能)",
      modelType: AIModelType.CHAT,
      model: modelId, // ★ 使用指定模型（如果提供）
      skipGuardrails: true, // 内部系统调用，章节修订
      cachePolicy: "auto",
      taskProfile: {
        creativity: "low", // 修订时降低创造性，保持一致性
        outputLength: "long", // 支持 800-1500 字的章节
      },
    });
    const latencyMs = Date.now() - startTime;

    // ★ 检查 API 错误状态
    if (response.isError) {
      const errorPreview = response.content.slice(0, 200);
      this.logger.error(
        `[reviseSection] API error for ${section.title}: ${errorPreview}`,
      );

      // ★ 积分不足：不重试，直接抛出特殊错误让上层快速失败
      const lc = errorPreview.toLowerCase();
      if (
        lc.includes("insufficient credits") ||
        lc.includes("insufficient_credits")
      ) {
        throw new InsufficientCreditsException(response.content);
      }

      throw new InternalServerErrorException(
        `API error while revising section "${section.title}": ${response.content}`,
      );
    }

    // 提取内容
    const rawContent = this.extractContent(response.content);
    const { markdown, charts } = this.parseChartOutput(rawContent);
    const content = markdown;

    // ★ 检查内容质量（长度检查）
    const minLength = Math.max(
      MIN_CONTENT_LENGTH,
      section.targetWords * MIN_CONTENT_LENGTH_RATIO,
    );
    if (content.length < minLength) {
      this.logger.error(
        `[reviseSection] Content too short for ${section.title}: ${content.length} chars < ${minLength} min`,
      );
      throw new InternalServerErrorException(
        `Revised content too short for section "${section.title}": got ${content.length} chars, expected at least ${minLength}`,
      );
    }

    // 统计字数和引用
    const wordCount = content.length;
    const referencesUsed = this.extractReferences(content);

    // Direction B 诊断：修订后验证核心判断是否存活
    if (originalHasConclusion) {
      const revisedHasConclusion = OPENING_CONCLUSION_RE.test(content);
      if (revisedHasConclusion) {
        this.logger.log(
          `[reviseSection][Direction-B] ✅ Opening conclusion preserved after revision: "${section.title}"`,
        );
      } else {
        this.logger.warn(
          `[reviseSection][Direction-B] ⚠️ Opening conclusion LOST during revision of "${section.title}". ` +
            `Revised content starts: "${content.substring(0, 200).replace(/\n/g, "\\n")}"`,
        );
      }
    }

    this.logger.log(
      `[reviseSection] Revised ${section.title}: ${wordCount} chars, ${referencesUsed.length} refs, ${latencyMs}ms`,
    );

    return {
      sectionId: section.id,
      title: section.title,
      content,
      wordCount,
      referencesUsed,
      generatedCharts: charts.generatedCharts,
      figureReferences: charts.figureReferences,
      actualModelId: response.model, // ★ 记录实际使用的模型
    };
  }

  /**
   * 批量并行写作多个章节
   *
   * ★ 增强：支持单个章节失败时的容错和自动重试
   * - 使用 Promise.allSettled 避免单个失败影响整体
   * - 对失败的章节自动使用备用模型重试
   * - 保持结果顺序与输入顺序一致
   *
   * @param inputs 多个章节写作输入
   * @returns 所有章节的写作结果（顺序与输入一致）
   */
  async writeSectionsParallel(
    inputs: SectionWriteInput[],
  ): Promise<SectionWriteResult[]> {
    this.logger.log(
      `[writeSectionsParallel] Writing ${inputs.length} sections in parallel`,
    );

    // 初始化结果数组，保持与输入相同的长度和顺序
    const results: (SectionWriteResult | null)[] = new Array(
      inputs.length,
    ).fill(null);
    const failedIndices: {
      index: number;
      input: SectionWriteInput;
      error: string;
      reason: unknown;
    }[] = [];

    // 第一轮：并行执行所有章节
    const firstRoundResults = await Promise.allSettled(
      inputs.map((input) => this.writeSection(input)),
    );

    // 收集成功和失败的结果，保持索引位置
    for (let i = 0; i < firstRoundResults.length; i++) {
      const result = firstRoundResults[i];
      if (result.status === "fulfilled") {
        results[i] = result.value;
      } else {
        failedIndices.push({
          index: i,
          input: inputs[i],
          error: result.reason?.message || String(result.reason),
          reason: result.reason,
        });
        this.logger.warn(
          `[writeSectionsParallel] Section "${inputs[i].section.title}" failed: ${result.reason?.message}`,
        );
      }
    }

    // ★ 积分不足快速失败：如果任何章节因积分不足失败，直接抛出不重试
    const creditFailure = failedIndices.find(
      ({ reason }) => reason instanceof InsufficientCreditsException,
    );
    if (creditFailure) {
      this.logger.error(
        `[writeSectionsParallel] Insufficient credits detected, aborting all sections without retry`,
      );
      throw new InsufficientCreditsException(
        "User has insufficient credits to continue research",
      );
    }

    // 如果有失败的章节，尝试用备用模型重试
    if (failedIndices.length > 0) {
      // 获取备用模型（使用 AI Engine 的智能选择，一次性获取）
      const fallbackModel = await this.chatFacade.selectModel({
        modelType: AIModelType.CHAT,
      });

      if (fallbackModel) {
        // 过滤掉原模型就是 fallbackModel 的情况，避免无意义重试
        const retryableItems = failedIndices.filter(
          ({ input }) => input.modelId !== fallbackModel.id,
        );
        const skipItems = failedIndices.filter(
          ({ input }) => input.modelId === fallbackModel.id,
        );

        // 记录跳过的项
        for (const { index, input, error } of skipItems) {
          this.logger.warn(
            `[writeSectionsParallel] Skipping retry for "${input.section.title}" - fallback model same as original`,
          );
          results[index] = this.createFailedResult(input, error);
        }

        if (retryableItems.length > 0) {
          this.logger.log(
            `[writeSectionsParallel] Retrying ${retryableItems.length} failed sections with ${fallbackModel.id}`,
          );

          const retryResults = await Promise.allSettled(
            retryableItems.map(({ input }) =>
              this.writeSection({
                ...input,
                modelId: fallbackModel.id,
              }),
            ),
          );

          // 处理重试结果，放回正确的索引位置
          for (let i = 0; i < retryResults.length; i++) {
            const result = retryResults[i];
            const { index, input, error: originalError } = retryableItems[i];

            if (result.status === "fulfilled") {
              this.logger.log(
                `[writeSectionsParallel] Section "${input.section.title}" succeeded on retry with ${fallbackModel.id}`,
              );
              results[index] = result.value;
            } else {
              this.logger.error(
                `[writeSectionsParallel] Section "${input.section.title}" failed even after retry: ${result.reason?.message}`,
              );
              results[index] = this.createFailedResult(input, originalError);
            }
          }
        }
      } else {
        // 没有可用的备用模型，记录所有失败
        this.logger.error(
          `[writeSectionsParallel] No fallback model available, ${failedIndices.length} sections failed`,
        );
        for (const { index, input, error } of failedIndices) {
          results[index] = this.createFailedResult(input, error);
        }
      }
    }

    // 确保所有位置都有结果（防御性编程）
    const finalResults = results.map(
      (r, i) => r ?? this.createFailedResult(inputs[i], "Unknown error"),
    );

    const successCount = finalResults.filter((r) => r.wordCount > 0).length;
    this.logger.log(
      `[writeSectionsParallel] Completed: ${successCount}/${inputs.length} sections successful`,
    );

    return finalResults;
  }

  /**
   * 创建失败结果占位对象
   */
  private createFailedResult(
    input: SectionWriteInput,
    error: string,
  ): SectionWriteResult {
    return {
      sectionId: input.section.id,
      title: input.section.title,
      content: `[内容生成失败] 原因: ${error}`,
      wordCount: 0,
      referencesUsed: [],
    };
  }

  /**
   * 提取内容（移除可能的 markdown 代码块包装）
   */
  private extractContent(response: string): string {
    // 移除 markdown 代码块包装
    let content = response.trim();

    // 移除 ```markdown 包装
    if (content.startsWith("```markdown")) {
      content = content.replace(/^```markdown\s*/, "").replace(/\s*```$/, "");
    }
    // 移除 ``` 包装
    else if (content.startsWith("```")) {
      content = content.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    return content.trim();
  }

  /**
   * 提取内容中的证据引用
   * ★ 更新为匹配数字格式 [1], [2], [3]
   */
  private extractReferences(content: string): string[] {
    const matches = content.match(/\[\d+\]/g) || [];
    return [...new Set(matches.map((m) => m.slice(1, -1)))];
  }

  /**
   * 格式化 Agent 配置为指导文本
   * 将 Leader 的 agentConfig 拆分为：
   * - skillIds: 需要加载的 skill ID 列表（kebab-case，给 chatWithSkills 的 additionalSkills 用）
   * - leaderGuidance: Leader 指导文本（analysisGuidance + outputStyle + preferredDataSources）
   */
  private formatAgentGuidance(
    section: SectionPlan,
    assignedSkills?: string[],
  ): {
    leaderGuidance: string;
    skillIds: string[];
  } {
    const config = section.agentConfig;

    const parts: string[] = [];
    let skillIds: string[] = [];

    // 技能 ID 到文件 ID 的映射（下划线转换为连字符）
    const skillIdMapping: Record<string, string> = {
      trend_analysis: "trend-analysis",
      swot_analysis: "swot-analysis",
      competitive_analysis: "competitive-analysis",
      deep_dive: "deep-dive",
      data_interpretation: "data-interpretation",
      synthesis: "synthesis",
      critical_thinking: "critical-thinking",
      future_projection: "future-projection",
      cause_effect: "cause-effect",
      comparison: "comparison",
      dimension_research: "dimension-research",
      entity_extraction: "entity-extraction",
      fact_check: "fact-check",
      hypothesis_verification: "hypothesis-verification",
      report_editing: "report-editing",
      claim_extraction: "claim-extraction",
      fact_verification: "fact-verification",
      multi_path_reasoning: "multi-path-reasoning",
      multi_view_synthesizer: "multi-view-synthesizer",
      specialized_role_analysis: "specialized-role-analysis",
      content_critique: "content-critique",
      consistency_check: "consistency-check",
    };

    // 将 section-level skill IDs 映射为 kebab-case
    if (config?.skills && config.skills.length > 0) {
      skillIds = config.skills.map(
        (id: string) => skillIdMapping[id] || id.replace(/_/g, "-"),
      );
    }

    // ★ 合并 mission-level assignedSkills（Leader 分配的任务级技能）
    if (assignedSkills && assignedSkills.length > 0) {
      const mappedAssigned = assignedSkills.map(
        (id) => skillIdMapping[id] || id.replace(/_/g, "-"),
      );
      skillIds = [...new Set([...skillIds, ...mappedAssigned])];
    }

    if (!config) {
      return {
        leaderGuidance: assignedSkills?.length
          ? "请参考系统提示中的分析技能指导"
          : "无特殊指导",
        skillIds,
      };
    }

    // 分析指导
    if (config.analysisGuidance) {
      parts.push(`**Leader 指导**: ${config.analysisGuidance}`);
    }

    // 输出风格
    if (config.outputStyle) {
      const styleDescriptions: Record<string, string> = {
        analytical: "逻辑严谨、数据支撑、论证充分",
        narrative: "故事性强、易于理解、引人入胜",
        concise: "精炼要点、去除冗余、直击核心",
        detailed: "面面俱到、深入展开、不遗漏细节",
      };
      parts.push(
        `**输出风格**: ${styleDescriptions[config.outputStyle] || config.outputStyle}`,
      );
    }

    // 数据源偏好
    if (config.preferredDataSources && config.preferredDataSources.length > 0) {
      parts.push(`**优先数据源**: ${config.preferredDataSources.join("、")}`);
    }

    const leaderGuidance =
      parts.length > 0 ? parts.join("\n\n") : "请参考系统提示中的分析技能指导";

    return { leaderGuidance, skillIds };
  }

  /**
   * 从系统提示词中剥离图表输出指令（用于推理模型）
   *
   * 推理模型不支持 response_format: json_object，且混合格式（Markdown + ---CHARTS--- + JSON）
   * 对推理模型输出不稳定。此方法将"## 输出格式"章节替换为简单的纯文本指令。
   */
  private stripChartInstructions(prompt: string): string {
    // Replace the entire "## 输出格式" section with a simple instruction.
    // The section starts at "## 输出格式" and ends at the end of the prompt
    // (it's the last major section in SECTION_WRITING_SYSTEM_PROMPT).
    const sectionStart = prompt.indexOf("\n## 输出格式\n");
    if (sectionStart === -1) {
      return prompt;
    }
    const before = prompt.substring(0, sectionStart);
    return (
      before +
      "\n## 输出格式\n\n直接输出 Markdown 格式的章节内容，不要附加任何 JSON 数据。"
    );
  }

  /**
   * 解析混合输出（markdown + 图表 JSON）
   */
  private parseChartOutput(raw: string): {
    markdown: string;
    charts: {
      generatedCharts: GeneratedChart[];
      figureReferences: FigureReference[];
    };
  } {
    // ★ 支持多种 AI 输出变体：---CHARTS---、CHARTS---、---CHARTS 等
    // ★ 要求至少一侧有 dash（防止误匹配）
    const separatorPattern = /\n*(?:-+\s*CHARTS\s*-*|CHARTS\s*-+)\n*/i;
    const separatorMatch = raw.match(separatorPattern);

    // ★ 优先检测 ```json\n{"generatedCharts": ...}``` 格式（AI 有时用代码块包裹 JSON）
    // 必须在 inlineJsonPattern 之前检测，否则 inlineMatch.index 会指向 \n{ 而非 ``` 起点，
    // 导致 markdown 末尾残留未关闭的 ```json，使后续内容全部被渲染为代码块。
    const codeFenceJsonPattern =
      /\n(\s*```json\s*\n\s*\{[\s\S]*?"(?:generatedCharts|figureReferences)")/;
    const codeFenceMatch = !separatorMatch
      ? raw.match(codeFenceJsonPattern)
      : null;

    // 也检测直接嵌入的 {"generatedCharts": 或 { "generatedCharts": 模式
    const inlineJsonPattern =
      /\n\s*\{[\s\n]*"(?:generatedCharts|figureReferences)"/;
    const inlineMatch =
      !separatorMatch && !codeFenceMatch ? raw.match(inlineJsonPattern) : null;

    if (!separatorMatch && !codeFenceMatch && !inlineMatch) {
      return {
        markdown: raw,
        charts: { generatedCharts: [], figureReferences: [] },
      };
    }

    // splitIdx：分割点前的是正文 markdown，后的是 JSON 图表数据
    const splitIdx = separatorMatch
      ? separatorMatch.index!
      : codeFenceMatch
        ? codeFenceMatch.index! // 指向 \n```json 前的 \n，不含代码块
        : inlineMatch!.index!;
    const markdown = raw.substring(0, splitIdx).trim();
    const jsonPart = separatorMatch
      ? raw.substring(splitIdx + separatorMatch[0].length).trim()
      : raw.substring(splitIdx).trim(); // 保留 ```json 或 { 开头的部分，由 extractJsonBlock 处理
    try {
      const parsed = JSON.parse(this.extractJsonBlock(jsonPart));
      if (typeof parsed !== "object" || parsed === null) {
        this.logger.warn(
          "[parseChartOutput] Parsed chart data is not an object",
        );
        return {
          markdown,
          charts: { generatedCharts: [], figureReferences: [] },
        };
      }
      return {
        markdown,
        charts: {
          generatedCharts: this.normalizeGeneratedCharts(
            parsed.generatedCharts,
          ),
          figureReferences: this.normalizeFigureReferences(
            parsed.figureReferences,
          ),
        },
      };
    } catch (parseErr) {
      // ★ 2026-05-05 P2 修复：原 catch 仅 "Failed to parse chart JSON"，无法
      //   定位失败模式（截断 / 多余 markdown / 转义错误）。新增 jsonPart
      //   preview + parse error message 供诊断。
      const cleanJson = this.extractJsonBlock(jsonPart);
      const preview =
        cleanJson.length > 500
          ? cleanJson.substring(0, 250) +
            " ...[truncated]... " +
            cleanJson.substring(cleanJson.length - 250)
          : cleanJson;
      const errMsg =
        parseErr instanceof Error ? parseErr.message : String(parseErr);
      this.logger.warn(
        `[parseChartOutput] Failed to parse chart JSON: ${errMsg} | jsonLen=${cleanJson.length} | preview=${JSON.stringify(preview)}`,
      );
      return {
        markdown,
        charts: { generatedCharts: [], figureReferences: [] },
      };
    }
  }

  /**
   * 提取 JSON 块（移除可能的 ```json 包装）
   */
  private extractJsonBlock(text: string): string {
    let content = text.trim();
    if (content.startsWith("```json")) {
      content = content.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (content.startsWith("```")) {
      content = content.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }
    return content.trim();
  }

  /**
   * 标准化图表引用列表
   */
  private normalizeFigureReferences(
    refs: FigureReference[] | undefined,
  ): FigureReference[] {
    if (!refs || !Array.isArray(refs)) {
      return [];
    }
    return refs.map((ref, idx) => ({
      id: ref.id || `fig-${idx}`,
      figureId: ref.figureId,
      evidenceCitationIndex: ref.evidenceCitationIndex,
      figureIndex: ref.figureIndex,
      imageUrl: ref.imageUrl,
      caption: ref.caption || "",
      position: ref.position || `after_paragraph_${idx + 1}`,
      source: this.sanitizeFigureSource(ref.source),
      relevance: ref.relevance,
    }));
  }

  /**
   * ★ 清理 LLM 输出的 figure source 中泄露的内部 prompt 元数据
   *
   * LLM 经常将 prompt 中的内部标注（如"Leader 分配图片资源"、"【已分配】"、
   * "证据[N] 图M"、"分配原因"等）回吐到 source 字段。这些文本不应呈现给用户。
   */
  private sanitizeFigureSource(source: string | undefined): string | undefined {
    if (!source) return source;
    let cleaned = source;
    // Strip internal allocation markers
    cleaned = cleaned.replace(
      /[，,]?\s*Leader\s*[已为]*.*?分配.*?(?:图[表片]?资源|以下图表)[^，。;]*[，。;]?/g,
      "",
    );
    cleaned = cleaned.replace(/【已分配】/g, "");
    // Strip "证据[N] 图M" or "（证据N图M）" patterns
    cleaned = cleaned.replace(/[（(]?\s*证据\[?\d+\]?\s*图\d+\s*[）)]?/g, "");
    // Strip "分配原因: xxx" patterns
    cleaned = cleaned.replace(/分配原因[:：][^，。\n]*/g, "");
    // Strip "(URL: https://...)" patterns leaked from prompt
    cleaned = cleaned.replace(/\(URL:\s*https?:\/\/[^\s)]+\)/g, "");
    // Clean up leftover delimiters
    cleaned = cleaned.replace(/^[，,；;\s]+|[，,；;\s]+$/g, "").trim();
    return cleaned || undefined;
  }

  /**
   * 标准化生成图表列表
   */
  private normalizeGeneratedCharts(
    charts: GeneratedChart[] | undefined,
  ): GeneratedChart[] {
    if (!charts || !Array.isArray(charts)) {
      return [];
    }
    return charts.map((chart, idx) => ({
      id: chart.id || `chart-${idx}`,
      type: this.validateChartType(chart.type),
      title: chart.title || `图表 ${idx + 1}`,
      position: chart.position || `after_paragraph_${idx + 1}`,
      data: Array.isArray(chart.data) ? chart.data : [],
      source: chart.source || "基于证据数据生成",
      reason: chart.reason,
    }));
  }

  /**
   * 验证图表类型是否在支持列表内
   */
  private validateChartType(type: string | undefined): GeneratedChart["type"] {
    const validTypes: GeneratedChart["type"][] = [
      "line",
      "bar",
      "pie",
      "area",
      "radar",
    ];
    if (type && validTypes.includes(type as GeneratedChart["type"])) {
      return type as GeneratedChart["type"];
    }
    return "bar";
  }

  /**
   * 格式化证据中的图片列表（用于图表生成提示）
   * ★ 使用 figureId 标识图表，LLM 引用时只需提供 figureId
   */
  private formatFiguresForSection(
    allocatedFigures?: import("../core/research/research-leader.service").AllocatedFigure[],
  ): string {
    if (allocatedFigures && allocatedFigures.length > 0) {
      const entries = allocatedFigures
        .filter((fig) => isValidFigureUrl(fig.imageUrl))
        .map((fig) => {
          return `- 【已分配】${fig.figureId}: "${fig.caption}" (URL: ${fig.imageUrl})\n  分配原因: ${fig.relevanceReason}`;
        });
      if (entries.length === 0) {
        return "无可用图片资源";
      }
      return `Leader 已为本章节分配以下图表（请优先使用，引用时使用 figureId）：\n${entries.join("\n")}`;
    }
    return "无可用图片资源";
  }

  /**
   * 用 figureRegistry（单一可信来源）补全 Writer 输出的 figureReferences
   *
   * LLM 只输出 figureId，系统通过注册表回填 imageUrl、evidenceCitationIndex 等字段。
   * 仍无 URL 的引用被过滤（无法渲染）。
   */
  private backfillFigureUrls(
    figureRefs: FigureReference[],
    allocatedFigures?: import("../core/research/research-leader.service").AllocatedFigure[],
    figureRegistry?: Map<string, FigureRegistryEntry>,
  ): FigureReference[] {
    if (figureRefs.length === 0) {
      return figureRefs;
    }

    // Build allocated figureId → AllocatedFigure map for fallback
    const allocatedMap = new Map<
      string,
      import("../core/research/research-leader.service").AllocatedFigure
    >();
    if (allocatedFigures) {
      for (const fig of allocatedFigures) {
        allocatedMap.set(fig.figureId, fig);
      }
    }

    let backfilled = 0;

    for (const ref of figureRefs) {
      const fid = ref.figureId;
      if (fid) {
        // Primary: look up in registry (single source of truth)
        const entry = figureRegistry?.get(fid);
        if (entry) {
          ref.imageUrl = entry.imageUrl;
          ref.evidenceCitationIndex = entry.evidenceIndex;
          ref.figureIndex = entry.figureIndex;
          if (!ref.caption) ref.caption = entry.caption;
          if (!ref.source) ref.source = entry.evidenceTitle;
          backfilled++;
        } else {
          // Fallback: try allocated figures map
          const allocated = allocatedMap.get(fid);
          if (allocated?.imageUrl && isValidFigureUrl(allocated.imageUrl)) {
            ref.imageUrl = allocated.imageUrl;
            if (!ref.caption) ref.caption = allocated.caption;
            backfilled++;
          }
        }
      } else {
        this.logger.warn(
          `[backfillFigureUrls] FigureReference missing figureId (id=${ref.id}, caption="${ref.caption?.slice(0, 40)}"), cannot backfill — old-format LLM output?`,
        );
      }

      // ★ v10: 最终 caption fallback — 如果 caption 仍然为空，用 source（证据标题）生成
      if (!ref.caption && ref.source) {
        ref.caption = ref.source;
      }

      // Clean up caption and source
      if (ref.caption) ref.caption = this.cleanFigureCaption(ref.caption);
      if (ref.source) {
        ref.source = this.sanitizeFigureSource(ref.source) || ref.source;
      }
    }

    if (backfilled > 0) {
      this.logger.log(
        `[backfillFigureUrls] Backfilled ${backfilled}/${figureRefs.length} figure URLs via registry`,
      );
    }

    // Filter out refs without valid imageUrl
    const result = figureRefs.filter((ref) => isValidFigureUrl(ref.imageUrl));
    if (result.length < figureRefs.length) {
      this.logger.warn(
        `[backfillFigureUrls] Dropped ${figureRefs.length - result.length} figure refs without valid imageUrl`,
      );
    }
    return result;
  }

  /**
   * 清理 figure caption：去除原始网页标题中的平台/作者信息
   *
   * 例如: "Understanding LLM Inference | by Saiii | Medium" → "Understanding LLM Inference"
   */
  private cleanFigureCaption(caption: string): string {
    // Remove "| by Author | Platform" suffixes (Medium, Substack, etc.)
    let cleaned = caption.replace(/\s*\|\s*by\s+[^|]+\|\s*\w+\s*$/i, "");
    // Remove trailing "| Platform" (e.g., "Title | Medium")
    cleaned = cleaned.replace(
      /\s*\|\s*(?:Medium|Substack|Dev\.to|Towards Data Science|HackerNoon|Analytics Vidhya)\s*$/i,
      "",
    );
    // Remove trailing "- Platform" (e.g., "Title - arXiv")
    cleaned = cleaned.replace(
      /\s*[-–—]\s*(?:arXiv|Medium|Substack|Wikipedia|YouTube|GitHub)\s*$/i,
      "",
    );
    // Remove internal allocation metadata (e.g., "来源: 分配图表" or "- 来源: 分配图表")
    cleaned = cleaned.replace(
      /\s*[-–—]?\s*(?:来源|Source)\s*[：:]\s*分配图表\s*(?:\[\d+\])?\s*/g,
      "",
    );
    return cleaned.trim();
  }

  /**
   * Direction B fallback：从正文中提取第一条有实质内容的判断句
   *
   * 策略：跳过标题行，找第一个含有数字或具体事实的段落句子，截取 ≤50 字。
   * 不依赖 LLM，纯文本提取，保证零延迟。
   */
  private extractFallbackConclusion(content: string, lang: string): string {
    const isEn = lang.startsWith("en");
    const lines = content.split("\n");
    const paragraphs: string[] = [];
    let cur = "";

    for (const line of lines) {
      const t = line.trim();
      if (!t) {
        if (cur.trim()) {
          paragraphs.push(cur.trim());
          cur = "";
        }
      } else if (t.startsWith("#") || t.startsWith(">") || t.startsWith("|")) {
        // skip headings, blockquotes, tables
      } else if (!t.startsWith("-") && !t.startsWith("*")) {
        cur += (cur ? " " : "") + t;
      }
    }
    if (cur.trim()) paragraphs.push(cur.trim());

    // 优先选含数字的段落（有量化数据的判断更有价值）
    const withData = paragraphs.find((p) => /\d/.test(p) && p.length > 15);
    const src = withData || paragraphs.find((p) => p.length > 15) || "";

    if (!src) {
      return isEn
        ? "Key insights from this dimension."
        : "本维度核心结论见正文。";
    }

    // 提取第一句话
    const sentenceRe = isEn ? /[.!?](?:\s|$)/ : /[。！？]/;
    const match = src.match(sentenceRe);
    const firstSentence = match
      ? src.substring(0, (match.index ?? 0) + 1).trim()
      : src;

    // 截断到 50 字（中文字符计 1，英文单词计约 5 字符/词）
    const MAX = 50;
    if (firstSentence.length <= MAX) return firstSentence;

    // 在 MAX 处找最近的断句符或逗号
    const cut = Math.max(
      firstSentence.lastIndexOf("，", MAX),
      firstSentence.lastIndexOf("、", MAX),
      firstSentence.lastIndexOf(",", MAX),
    );
    if (cut > 15) return firstSentence.substring(0, cut) + "…";
    return firstSentence.substring(0, MAX) + "…";
  }

  /**
   * 获取当前日期字符串
   */
  private getCurrentDate(): string {
    const now = new Date();
    return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  }
}
