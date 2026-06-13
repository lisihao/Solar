import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { ChatFacade, TeamFacade } from "@/modules/ai-harness/facade";
import {
  SearchRound,
  SearchSource,
  DeepResearchReport,
  ReportSection,
  ReportReference,
  PreviousReportContext,
} from "./types";
import {
  ResearchLanguage,
  resolveLanguage,
  REPORT_PROMPTS,
} from "./prompt-locale";

/**
 * 报告合成服务
 * 将搜索结果合成为结构化研究报告
 *
 * ✅ 已迁移：使用 AIFacade 统一入口
 */
@Injectable()
export class ReportSynthesizerService {
  private readonly logger = new Logger(ReportSynthesizerService.name);

  constructor(
    private readonly chatFacade: ChatFacade,
    private readonly teamFacade: TeamFacade,
  ) {}

  /**
   * 生成完整研究报告
   */
  async generateReport(
    query: string,
    searchRounds: SearchRound[],
    options?: {
      language?: string;
      style?: "academic" | "business" | "casual";
      isFollowUp?: boolean;
      previousContext?: PreviousReportContext;
    },
  ): Promise<DeepResearchReport> {
    const startTime = Date.now();
    this.logger.debug(
      `Generating report for query: ${query.slice(0, 50)}... (follow-up: ${options?.isFollowUp})`,
    );

    // 准备来源和引用
    const sources = this.prepareSources(searchRounds);

    // 对于追问模式，合并之前的引用
    let allReferences: ReportReference[];
    let previousRefsCount = 0;
    if (options?.isFollowUp && options?.previousContext?.references) {
      previousRefsCount = options.previousContext.references.length;
      // 之前的引用保持原编号
      const previousRefs = options.previousContext.references.map(
        (ref, index) => ({
          id: index + 1,
          title: ref.title,
          url: ref.url,
          snippet: "",
          accessedAt: new Date(),
        }),
      );
      // 新引用从之前的编号继续
      const newRefs = this.buildReferences(sources).map((ref, index) => ({
        ...ref,
        id: previousRefsCount + index + 1,
      }));
      allReferences = [...previousRefs, ...newRefs];
    } else {
      allReferences = this.buildReferences(sources);
    }

    // 生成报告内容
    const reportContent = await this.generateReportContent(
      query,
      sources,
      options?.language || "zh-CN",
      options?.style || "business",
      options?.isFollowUp,
      options?.previousContext,
      previousRefsCount,
    );

    const duration = (Date.now() - startTime) / 1000;

    // ★ 清理 AI 生成内容中的格式问题（使用 Engine 通用清洗）
    return {
      executiveSummary: this.teamFacade.sanitizeReport(
        reportContent.executiveSummary,
      ),
      sections: reportContent.sections.map((section) => ({
        ...section,
        content: this.teamFacade.sanitizeReport(section.content),
      })),
      conclusion: this.teamFacade.sanitizeReport(reportContent.conclusion),
      references: allReferences,
      metadata: {
        totalSources: sources.length + previousRefsCount,
        totalTokens: 0, // TODO: Track token usage
        duration,
        searchRounds: searchRounds.length,
      },
    };
  }

  /**
   * 流式生成报告（用于 SSE）
   */
  async *generateReportStream(
    query: string,
    searchRounds: SearchRound[],
    _options?: {
      language?: string;
      style?: "academic" | "business" | "casual";
    },
  ): AsyncGenerator<{ section: string; content: string }> {
    const sources = this.prepareSources(searchRounds);
    const lang = resolveLanguage(_options?.language);

    // 1. 生成执行摘要
    yield { section: "executive_summary", content: "" };
    const summary = await this.generateSection(
      "executive_summary",
      query,
      sources,
      lang,
    );
    yield { section: "executive_summary", content: summary };

    // 2. 生成主要章节
    const sectionTopics = await this.identifySectionTopics(
      query,
      sources,
      lang,
    );
    for (const topic of sectionTopics) {
      yield { section: topic, content: "" };
      const sectionContent = await this.generateSection(
        topic,
        query,
        sources,
        lang,
      );
      yield { section: topic, content: sectionContent };
    }

    // 3. 生成结论
    yield { section: "conclusion", content: "" };
    const conclusion = await this.generateSection(
      "conclusion",
      query,
      sources,
      lang,
    );
    yield { section: "conclusion", content: conclusion };
  }

  /**
   * 准备和去重来源
   */
  private prepareSources(searchRounds: SearchRound[]): SearchSource[] {
    const urlSet = new Set<string>();
    const sources: SearchSource[] = [];

    for (const round of searchRounds) {
      for (const source of round.sources) {
        if (!urlSet.has(source.url)) {
          urlSet.add(source.url);
          sources.push(source);
        }
      }
    }

    // 按相关性排序
    sources.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return sources.slice(0, 40); // 最多使用 40 个来源
  }

  /**
   * 构建引用列表
   */
  private buildReferences(sources: SearchSource[]): ReportReference[] {
    return sources.map((source, index) => ({
      id: index + 1,
      title: source.title,
      url: source.url,
      snippet: source.snippet.slice(0, 500),
      accessedAt: new Date(),
    }));
  }

  /**
   * 生成报告内容（多步生成：每个部分独立 API 调用，确保充足的 token 预算）
   *
   * 原单次调用仅 8000 tokens，无法生成完整报告。
   * 改为分步生成：执行摘要 + 各章节 + 结论，每部分独立调用。
   */
  private async generateReportContent(
    query: string,
    sources: SearchSource[],
    language: string,
    style: string,
    isFollowUp?: boolean,
    previousContext?: PreviousReportContext,
    previousRefsCount?: number,
  ): Promise<{
    executiveSummary: string;
    sections: ReportSection[];
    conclusion: string;
  }> {
    // Follow-up mode still uses single-call (shorter reports)
    if (isFollowUp && previousContext) {
      return this.generateFollowUpReport(
        query,
        sources,
        language,
        style,
        previousContext,
        previousRefsCount,
      );
    }

    const lang = resolveLanguage(language);
    const rp = REPORT_PROMPTS[lang];

    try {
      // Step 1: Identify section topics
      const sectionTopics = await this.identifySectionTopics(
        query,
        sources,
        lang,
      );
      this.logger.debug(`Report sections: ${sectionTopics.join(", ")}`);

      // Step 2: Build source context (shared across all calls)
      const startIndex = 0;
      const sourceContext = sources
        .slice(0, 30)
        .map(
          (s, i) =>
            `[${startIndex + i + 1}] **${s.title}**\n${rp.sourceLabel}: ${s.domain}${s.publishedDate ? ` (${s.publishedDate})` : ""}\n${rp.contentLabel}: ${s.snippet}`,
        )
        .join("\n\n---\n\n");

      // Step 3: Generate executive summary
      this.logger.debug("Generating executive summary...");
      const executiveSummary = await this.generatePart(
        rp.executiveSummaryPrompt(query, sectionTopics, sourceContext),
        "long",
      );

      // Step 4: Generate all sections in parallel for speed
      this.logger.debug(
        `Generating ${sectionTopics.length} sections in parallel...`,
      );
      const sectionResults = await Promise.allSettled(
        sectionTopics.map((topic) =>
          this.generatePart(
            rp.sectionPrompt(query, topic, sourceContext),
            "long",
          ),
        ),
      );

      const sections: ReportSection[] = sectionTopics.map((topic, i) => {
        const result = sectionResults[i];
        const sectionContent =
          result.status === "fulfilled"
            ? result.value
            : rp.generateSectionError(topic);

        if (result.status === "rejected") {
          this.logger.warn(
            `Section "${topic}" generation failed: ${result.reason}`,
          );
        }

        // Extract citation numbers from content
        const citationMatches = sectionContent.match(/\[(\d+)\]/g) || [];
        const citations = [
          ...new Set(
            citationMatches.map((m: string) =>
              parseInt(m.replace(/[\[\]]/g, "")),
            ),
          ),
        ];

        return {
          title: topic,
          content: sectionContent,
          citations,
        };
      });

      // Step 5: Generate conclusion
      this.logger.debug("Generating conclusion...");
      const sectionSummaries = sections
        .map((s) => `- ${s.title}: ${s.content.substring(0, 200)}...`)
        .join("\n");

      const conclusion = await this.generatePart(
        rp.conclusionPrompt(query, sectionSummaries, sourceContext),
        "long",
      );

      return { executiveSummary, sections, conclusion };
    } catch (error) {
      this.logger.error(`Failed to generate report content: ${error}`);
      return this.getDefaultReport(query, sources, lang);
    }
  }

  /**
   * Generate a single report part via independent API call
   * ★ 升级：使用 chatWithSkills 注入 report-synthesis + evidence-summarization 技能
   */
  private async generatePart(
    prompt: string,
    outputLength: "medium" | "long" = "long",
  ): Promise<string> {
    const result = await this.chatFacade.chatWithSkills({
      messages: [{ role: "user", content: prompt }],
      modelType: AIModelType.CHAT,
      taskProfile: {
        creativity: "medium",
        outputLength,
      },
      additionalSkills: [
        "report-synthesis",
        "evidence-summarization",
        "source-credibility",
      ],
      skipGuardrails: true, // 内部系统调用，研究内容可能触发误报
    });
    return result.content;
  }

  /**
   * Follow-up report generation (single-call, shorter)
   */
  private async generateFollowUpReport(
    query: string,
    sources: SearchSource[],
    language: string,
    style: string,
    previousContext: PreviousReportContext,
    previousRefsCount?: number,
  ): Promise<{
    executiveSummary: string;
    sections: ReportSection[];
    conclusion: string;
  }> {
    const lang = resolveLanguage(language);

    const systemPrompt = this.buildReportSystemPrompt(
      language,
      style,
      true,
      previousContext,
    );
    const userPrompt = this.buildReportUserPrompt(
      query,
      sources,
      true,
      previousContext,
      previousRefsCount,
      language,
    );

    try {
      const result = await this.chatFacade.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "medium",
          outputLength: "long",
        },
        skipGuardrails: true, // 内部系统调用，研究内容可能触发误报
      });

      return this.parseReportResponse(result.content, lang);
    } catch (error) {
      this.logger.error(`Failed to generate follow-up report: ${error}`);
      return this.getDefaultReport(query, sources, lang);
    }
  }

  /**
   * 生成单个章节
   *
   * ★ P3 迁移：使用 AIFacade 替代 AiChatService
   */
  private async generateSection(
    sectionType: string,
    query: string,
    sources: SearchSource[],
    language?: ResearchLanguage,
  ): Promise<string> {
    const lang = language || "zh-CN";
    const prompt = this.buildSectionPrompt(sectionType, query, sources, lang);

    try {
      // ★ 使用 AIFacade 统一入口
      const result = await this.chatFacade.chat({
        messages: [{ role: "user", content: prompt }],
        modelType: AIModelType.CHAT,
        taskProfile: {
          creativity: "medium",
          outputLength: "medium", // 章节需要充足篇幅进行深度分析
        },
        skipGuardrails: true, // 内部系统调用，研究内容可能触发误报
      });

      return result.content;
    } catch (error) {
      this.logger.error(`Failed to generate section ${sectionType}: ${error}`);
      const rp = REPORT_PROMPTS[lang];
      return rp.generateSectionError(sectionType);
    }
  }

  /**
   * 动态识别报告章节主题（基于查询和来源内容）
   */
  private async identifySectionTopics(
    query: string,
    sources: SearchSource[],
    language?: ResearchLanguage,
  ): Promise<string[]> {
    const lang = language || "zh-CN";
    const rp = REPORT_PROMPTS[lang];

    // Extract key themes from source titles and snippets
    const sourceContext = sources
      .slice(0, 15)
      .map((s) => `- ${s.title}: ${s.snippet.slice(0, 100)}`)
      .join("\n");

    try {
      const result = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: rp.sectionTopicsSystem,
          },
          {
            role: "user",
            content: `${rp.researchTopicLabel}：${query}\n\n${rp.sourceMaterialLabel}：\n${sourceContext}`,
          },
        ],
        modelType: AIModelType.CHAT_FAST,
        taskProfile: {
          creativity: "low",
          outputLength: "minimal",
        },
        skipGuardrails: true, // 内部系统调用，研究内容可能触发误报
      });

      const topics = JSON.parse(
        result.content.replace(/```json\s*|\s*```/g, "").trim(),
      );
      if (Array.isArray(topics) && topics.length >= 3) {
        return topics.slice(0, 6);
      }
    } catch (error) {
      this.logger.warn(`Failed to identify dynamic topics: ${error}`);
    }

    // Fallback: derive topics from query
    return rp.fallbackSectionTopics(query);
  }

  /**
   * 构建报告系统提示词
   */
  private buildReportSystemPrompt(
    language: string,
    style: string,
    isFollowUp?: boolean,
    previousContext?: PreviousReportContext,
  ): string {
    const lang = resolveLanguage(language);
    const rp = REPORT_PROMPTS[lang];

    // 追问模式的特殊提示
    if (isFollowUp && previousContext) {
      return rp.followUpSystemPrompt(previousContext, style);
    }

    // 常规模式
    return rp.regularSystemPrompt(style);
  }

  /**
   * 构建报告用户提示词
   */
  private buildReportUserPrompt(
    query: string,
    sources: SearchSource[],
    isFollowUp?: boolean,
    previousContext?: PreviousReportContext,
    previousRefsCount?: number,
    language?: string,
  ): string {
    const lang = resolveLanguage(language);
    const rp = REPORT_PROMPTS[lang];

    // 追问模式：引用编号从之前的数量继续
    const startIndex = isFollowUp && previousRefsCount ? previousRefsCount : 0;

    // Provide full snippet content for richer analysis
    const sourcesList = sources
      .slice(0, 25)
      .map(
        (s, i) =>
          `[${startIndex + i + 1}] **${s.title}**\n${rp.sourceLabel}: ${s.domain} (${rp.relevanceLabel}: ${(s.relevanceScore * 100).toFixed(0)}%)${s.publishedDate ? `\n${rp.dateLabel}: ${s.publishedDate}` : ""}\n${rp.contentLabel}: ${s.snippet}`,
      )
      .join("\n\n---\n\n");

    if (isFollowUp && previousContext) {
      return rp.followUpUserPrompt(
        query,
        sourcesList,
        startIndex,
        Math.min(sources.length, 25),
      );
    }

    return rp.userPrompt(query, sourcesList);
  }

  /**
   * 构建章节提示词
   */
  private buildSectionPrompt(
    sectionType: string,
    query: string,
    sources: SearchSource[],
    language?: ResearchLanguage,
  ): string {
    const lang = language || "zh-CN";
    const rp = REPORT_PROMPTS[lang];

    const guide =
      rp.sectionGuides[sectionType]?.(query) ||
      rp.defaultSectionGuide(query, sectionType);

    const topSources = sources
      .slice(0, 15)
      .map((s, i) => `[${i + 1}] ${s.title}\n${s.snippet}`)
      .join("\n\n");

    return `${guide}\n\n## ${rp.referenceSourcesHeading}\n\n${topSources}`;
  }

  /**
   * 解析报告响应
   */
  private parseReportResponse(
    response: string,
    language?: ResearchLanguage,
  ): {
    executiveSummary: string;
    sections: ReportSection[];
    conclusion: string;
  } {
    const lang = language || "zh-CN";
    const rp = REPORT_PROMPTS[lang];

    try {
      const jsonMatch =
        response.match(/```json\s*([\s\S]*?)\s*```/) ||
        response.match(/\{[\s\S]*"executiveSummary"[\s\S]*\}/);

      if (!jsonMatch) {
        // 如果没有 JSON，尝试直接解析为文本报告
        return {
          executiveSummary: response.slice(0, 500),
          sections: [
            {
              title: rp.fallbackParseTitle,
              content: response,
              citations: [],
            },
          ],
          conclusion: "",
        };
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);

      return {
        executiveSummary: parsed.executiveSummary || "",
        sections: (parsed.sections || []).map((s: Record<string, unknown>) => ({
          title:
            (s["title"] as string) ||
            (language === "en-US" ? "Untitled Section" : "未命名章节"),
          content: (s["content"] as string) || "",
          citations: (s["citations"] as unknown[]) || [],
        })),
        conclusion: parsed.conclusion || "",
      };
    } catch (error) {
      this.logger.error(`Failed to parse report response: ${error}`);
      return {
        executiveSummary: response.slice(0, 500),
        sections: [],
        conclusion: "",
      };
    }
  }

  /**
   * 获取默认报告
   */
  private getDefaultReport(
    query: string,
    sources: SearchSource[],
    language?: ResearchLanguage,
  ): {
    executiveSummary: string;
    sections: ReportSection[];
    conclusion: string;
  } {
    const lang = language || "zh-CN";
    const rp = REPORT_PROMPTS[lang];

    const topSnippets = sources
      .slice(0, 5)
      .map((s, i) => `[${i + 1}] ${s.snippet}`)
      .join("\n\n");

    return {
      executiveSummary: rp.fallbackReportSummary(query, sources.length),
      sections: [
        {
          title: rp.fallbackSectionTitle,
          content: topSnippets,
          citations: [1, 2, 3, 4, 5].slice(0, sources.length),
        },
      ],
      conclusion: rp.fallbackConclusion,
    };
  }
}
