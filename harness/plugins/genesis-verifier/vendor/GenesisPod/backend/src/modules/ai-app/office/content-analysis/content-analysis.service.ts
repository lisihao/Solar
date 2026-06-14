/**
 * 内容分析服务
 * 分析输入内容的特征，为模板选择提供依据
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import {
  CONTENT_ANALYSIS_SYSTEM_PROMPT,
  CONTENT_ANALYSIS_USER_PROMPT,
} from "./content-analysis.prompts";
import {
  ContentAnalysisInput,
  ContentAnalysisResult,
  ContentFeatures,
  ContentCategory,
  ContentComplexity,
  DataDensity,
  TemporalDimension,
  HierarchyType,
  ExtractedEntity,
  VisualizationOpportunity,
  SuggestedStructure,
} from "./content-analysis.types";

/**
 * ★ P3 迁移：使用 ChatFacade 替代 AiChatService
 */
@Injectable()
export class ContentAnalysisService {
  private readonly logger = new Logger(ContentAnalysisService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 分析内容特征
   */
  async analyzeContent(
    input: ContentAnalysisInput,
  ): Promise<ContentAnalysisResult> {
    const startTime = Date.now();

    try {
      // 1. 基础特征提取（规则引擎）
      const basicFeatures = this.extractBasicFeatures(input.content);

      // 2. AI 深度分析
      const aiAnalysis = await this.performAIAnalysis(input);

      // 3. 合并结果
      const features: ContentFeatures = {
        ...basicFeatures,
        ...aiAnalysis.features,
        // 保留基础统计 (提供默认值)
        wordCount: basicFeatures.wordCount ?? 0,
        paragraphCount: basicFeatures.paragraphCount ?? 0,
        listCount: basicFeatures.listCount ?? 0,
        tableCount: basicFeatures.tableCount ?? 0,
        imageCount: basicFeatures.imageCount ?? 0,
        codeBlockCount: basicFeatures.codeBlockCount ?? 0,
      } as ContentFeatures;

      // 4. 生成建议结构
      const suggestedStructure = this.generateSuggestedStructure(
        features,
        input,
      );

      return {
        features,
        summary: aiAnalysis.summary || this.generateSummary(features),
        suggestedStructure,
        confidence: aiAnalysis.confidence || 0.8,
        processingTime: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error("Content analysis failed", error);
      // 返回基于规则的降级结果
      return this.getFallbackAnalysis(input, Date.now() - startTime);
    }
  }

  /**
   * 基础特征提取（规则引擎，无需 AI）
   */
  private extractBasicFeatures(content: string): Partial<ContentFeatures> {
    const words = content
      .replace(/[^\w\u4e00-\u9fa5]/g, " ")
      .split(/\s+/)
      .filter(Boolean);

    // 统计基础指标
    const wordCount = words.length;
    const paragraphCount = content
      .split(/\n\s*\n/)
      .filter((p) => p.trim()).length;
    const listCount = (content.match(/^[\s]*[-*•]\s/gm) || []).length;
    const tableCount = (content.match(/\|.*\|/g) || []).length > 2 ? 1 : 0;
    const imageCount = (content.match(/!\[.*?\]\(.*?\)/g) || []).length;
    const codeBlockCount = (content.match(/```/g) || []).length / 2;

    // 检测结构特征
    const hasTimeline = this.detectTimeline(content);
    const hasComparison = this.detectComparison(content);
    const hasStatistics = this.detectStatistics(content);
    const hasSteps = this.detectSteps(content);
    const hasCaseStudy = this.detectCaseStudy(content);
    const hasRecommendations = this.detectRecommendations(content);
    const hasRiskAnalysis = this.detectRiskAnalysis(content);

    // 判断数据密度
    const dataDensity = this.calculateDataDensity(content, wordCount);

    // 判断时间维度
    const temporalDimension = this.detectTemporalDimension(content);

    return {
      wordCount,
      paragraphCount,
      listCount,
      tableCount,
      imageCount,
      codeBlockCount,
      hasTimeline,
      hasComparison,
      hasStatistics,
      hasSteps,
      hasCaseStudy,
      hasRecommendations,
      hasRiskAnalysis,
      dataDensity,
      temporalDimension,
      keyTopics: [],
      entities: [],
      visualizationOpportunities: [],
    };
  }

  /**
   * 检测时间线内容
   */
  private detectTimeline(content: string): boolean {
    const timelinePatterns = [
      /\d{4}年/g,
      /第[一二三四五六七八九十]+阶段/g,
      /阶段[一二三四五六七八九十\d]/g,
      /发展历程/g,
      /演进/g,
      /里程碑/g,
      /时间线/g,
      /\d{1,2}月/g,
      /Q[1-4]/gi,
    ];

    let matches = 0;
    for (const pattern of timelinePatterns) {
      const found = content.match(pattern);
      if (found) matches += found.length;
    }

    return matches >= 3;
  }

  /**
   * 检测对比内容
   */
  private detectComparison(content: string): boolean {
    const comparisonPatterns = [
      /vs\.?/gi,
      /对比/g,
      /比较/g,
      /相比/g,
      /优势|劣势/g,
      /优点|缺点/g,
      /区别/g,
      /不同/g,
      /方案[A-Z一二三]/g,
    ];

    let matches = 0;
    for (const pattern of comparisonPatterns) {
      const found = content.match(pattern);
      if (found) matches += found.length;
    }

    return matches >= 2;
  }

  /**
   * 检测统计数据
   */
  private detectStatistics(content: string): boolean {
    const statsPatterns = [
      /\d+\.?\d*%/g, // 百分比
      /\d+\.?\d*[亿万千百]/g, // 中文数字单位
      /\$\d+/g, // 美元
      /¥\d+/g, // 人民币
      /增长|下降|提升|降低/g,
      /同比|环比/g,
      /KPI|ROI|GMV/gi,
    ];

    let matches = 0;
    for (const pattern of statsPatterns) {
      const found = content.match(pattern);
      if (found) matches += found.length;
    }

    return matches >= 3;
  }

  /**
   * 检测步骤/流程
   */
  private detectSteps(content: string): boolean {
    const stepPatterns = [
      /步骤[一二三四五六七八九十\d]/g,
      /第[一二三四五六七八九十]+步/g,
      /\d\.\s/g,
      /首先|其次|然后|最后/g,
      /流程/g,
      /操作指南/g,
    ];

    let matches = 0;
    for (const pattern of stepPatterns) {
      const found = content.match(pattern);
      if (found) matches += found.length;
    }

    return matches >= 3;
  }

  /**
   * 检测案例研究
   */
  private detectCaseStudy(content: string): boolean {
    const casePatterns = [
      /案例/g,
      /实践/g,
      /成功经验/g,
      /客户故事/g,
      /应用场景/g,
      /最佳实践/g,
      /公司|企业.*实施/g,
    ];

    let matches = 0;
    for (const pattern of casePatterns) {
      const found = content.match(pattern);
      if (found) matches += found.length;
    }

    return matches >= 2;
  }

  /**
   * 检测建议内容
   */
  private detectRecommendations(content: string): boolean {
    const recPatterns = [
      /建议/g,
      /推荐/g,
      /应该/g,
      /需要/g,
      /行动项/g,
      /下一步/g,
      /改进措施/g,
      /优化方案/g,
    ];

    let matches = 0;
    for (const pattern of recPatterns) {
      const found = content.match(pattern);
      if (found) matches += found.length;
    }

    return matches >= 3;
  }

  /**
   * 检测风险分析
   */
  private detectRiskAnalysis(content: string): boolean {
    const riskPatterns = [
      /风险/g,
      /威胁/g,
      /挑战/g,
      /问题/g,
      /机会/g,
      /SWOT/gi,
      /应对措施/g,
      /缓解/g,
    ];

    let matches = 0;
    for (const pattern of riskPatterns) {
      const found = content.match(pattern);
      if (found) matches += found.length;
    }

    return matches >= 3;
  }

  /**
   * 计算数据密度
   */
  private calculateDataDensity(
    content: string,
    wordCount: number,
  ): DataDensity {
    const numbers = (content.match(/\d+\.?\d*/g) || []).length;
    const ratio = numbers / Math.max(wordCount, 1);

    if (ratio > 0.1) return DataDensity.DATA_HEAVY;
    if (ratio < 0.02) return DataDensity.TEXT_HEAVY;
    return DataDensity.BALANCED;
  }

  /**
   * 检测时间维度
   */
  private detectTemporalDimension(content: string): TemporalDimension {
    const futureWords = (content.match(/未来|规划|展望|预测|将会|计划/g) || [])
      .length;
    const pastWords = (content.match(/历史|过去|曾经|回顾|发展历程/g) || [])
      .length;
    const timelineWords = (content.match(/\d{4}年|阶段|里程碑/g) || []).length;

    if (timelineWords >= 4) return TemporalDimension.TIMELINE;
    if (futureWords > pastWords && futureWords >= 2)
      return TemporalDimension.FUTURE;
    if (pastWords > futureWords && pastWords >= 2)
      return TemporalDimension.HISTORICAL;
    if (futureWords > 0 || pastWords > 0) return TemporalDimension.CURRENT;
    return TemporalDimension.NONE;
  }

  /**
   * AI 深度分析
   *
   * ★ P3 迁移：使用 ChatFacade 替代 AiChatService
   */
  private async performAIAnalysis(input: ContentAnalysisInput): Promise<{
    features: Partial<ContentFeatures>;
    summary?: string;
    confidence?: number;
  }> {
    try {
      const userPrompt = CONTENT_ANALYSIS_USER_PROMPT.replace(
        "{{title}}",
        input.context?.title || "未知标题",
      )
        .replace("{{purpose}}", input.context?.purpose || "生成专业报告")
        .replace("{{content}}", input.content.slice(0, 8000)); // 限制长度

      // ★ 使用 ChatFacade 统一入口
      const response = await this.chatFacade.chat({
        messages: [
          { role: "system", content: CONTENT_ANALYSIS_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        modelType: AIModelType.CHAT_FAST, // 内容分析使用快速模型
        taskProfile: {
          creativity: "low", // 内容分析需要低创造性，保持客观
          outputLength: "short", // 分析输出较短
        },
      });

      // 解析 JSON 响应
      const jsonMatch = response.content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        return {
          features: {
            category: this.mapContentCategory(parsed.contentCategory),
            complexity: this.mapComplexity(parsed.complexity),
            keyTopics: parsed.keyTopics || [],
            entities: this.mapEntities(parsed.entities || []),
            visualizationOpportunities: this.mapVisualizationOpportunities(
              parsed.visualizationOpportunities || [],
            ),
            hierarchyType: HierarchyType.FLAT,
          },
          summary: parsed.summary,
          confidence: 0.85,
        };
      }

      return { features: {}, confidence: 0.5 };
    } catch (error) {
      this.logger.warn("AI analysis failed, using rule-based fallback", error);
      return { features: {}, confidence: 0.5 };
    }
  }

  /**
   * 映射内容类型
   */
  private mapContentCategory(category: string): ContentCategory {
    const mapping: Record<string, ContentCategory> = {
      narrative: ContentCategory.NARRATIVE,
      analytical: ContentCategory.ANALYTICAL,
      comparative: ContentCategory.COMPARATIVE,
      instructional: ContentCategory.INSTRUCTIONAL,
      persuasive: ContentCategory.PERSUASIVE,
      informational: ContentCategory.INFORMATIONAL,
    };
    return mapping[category?.toLowerCase()] || ContentCategory.INFORMATIONAL;
  }

  /**
   * 映射复杂度
   */
  private mapComplexity(complexity: string): ContentComplexity {
    const mapping: Record<string, ContentComplexity> = {
      low: ContentComplexity.LOW,
      medium: ContentComplexity.MEDIUM,
      high: ContentComplexity.HIGH,
    };
    return mapping[complexity?.toLowerCase()] || ContentComplexity.MEDIUM;
  }

  /**
   * 映射实体
   */
  private mapEntities(
    entities: Array<Record<string, unknown>>,
  ): ExtractedEntity[] {
    return entities.map((e) => ({
      type: (e.type as ExtractedEntity["type"]) || "concept",
      value: String(e.value || ""),
      count: Number(e.count) || 1,
      importance: Number(e.importance) || 0.5,
    }));
  }

  /**
   * 映射可视化机会
   */
  private mapVisualizationOpportunities(
    opportunities: Array<Record<string, unknown>>,
  ): VisualizationOpportunity[] {
    return opportunities.map((o) => ({
      type: (o.type as VisualizationOpportunity["type"]) || "chart",
      description: String(o.description || ""),
      dataPoints: (o.dataPoints as string[]) || [],
      suggestedChartType: o.suggestedChartType as string,
      priority:
        (o.priority as VisualizationOpportunity["priority"]) || "medium",
    }));
  }

  /**
   * 生成建议结构
   */
  private generateSuggestedStructure(
    features: ContentFeatures,
    _input: ContentAnalysisInput,
  ): SuggestedStructure {
    const { wordCount, complexity } = features;

    // Slides 建议
    let suggestedSlideCount = 8;
    if (complexity === ContentComplexity.LOW) suggestedSlideCount = 5;
    if (complexity === ContentComplexity.HIGH) suggestedSlideCount = 15;

    // Docs 建议
    let suggestedWordCount = wordCount * 1.5;
    if (complexity === ContentComplexity.LOW) suggestedWordCount = wordCount;
    if (complexity === ContentComplexity.HIGH)
      suggestedWordCount = wordCount * 2;

    return {
      forSlides: {
        suggestedSlideCount,
        suggestedTemplates: this.suggestSlideTemplates(features),
        chapterBreakdown: this.generateChapterBreakdown(features),
      },
      forDocs: {
        suggestedWordCount: Math.round(suggestedWordCount),
        suggestedSections: this.generateDocsSections(features),
        documentStyle: this.suggestDocumentStyle(features),
      },
    };
  }

  /**
   * 建议幻灯片模板
   */
  private suggestSlideTemplates(features: ContentFeatures): string[] {
    const templates: string[] = ["cover", "toc"];

    if (features.hasTimeline) templates.push("timeline");
    if (features.hasComparison) templates.push("comparison");
    if (features.hasStatistics) templates.push("dashboard");
    if (features.hasCaseStudy) templates.push("caseStudy");
    if (features.hasRecommendations) templates.push("recommendations");
    if (features.hasRiskAnalysis) templates.push("riskOpportunity");

    templates.push("conclusion");
    return templates;
  }

  /**
   * 生成章节分布
   */
  private generateChapterBreakdown(
    features: ContentFeatures,
  ): Array<{ title: string; slideCount: number; templates: string[] }> {
    const chapters: Array<{
      title: string;
      slideCount: number;
      templates: string[];
    }> = [];

    if (features.keyTopics.length > 0) {
      features.keyTopics.slice(0, 4).forEach((topic) => {
        chapters.push({
          title: topic,
          slideCount: 3,
          templates: ["chapterTitle", "splitLayout", "chapterSummary"],
        });
      });
    } else {
      chapters.push({
        title: "主要内容",
        slideCount: 5,
        templates: [
          "chapterTitle",
          "multiColumn",
          "splitLayout",
          "dashboard",
          "chapterSummary",
        ],
      });
    }

    return chapters;
  }

  /**
   * 生成文档章节
   */
  private generateDocsSections(
    features: ContentFeatures,
  ): Array<{ title: string; type: string; estimatedWords: number }> {
    const sections: Array<{
      title: string;
      type: string;
      estimatedWords: number;
    }> = [
      { title: "执行摘要", type: "executiveSummary", estimatedWords: 500 },
      { title: "背景介绍", type: "introduction", estimatedWords: 600 },
    ];

    if (features.hasStatistics) {
      sections.push({
        title: "数据分析",
        type: "dataReport",
        estimatedWords: 800,
      });
    }

    if (features.hasComparison) {
      sections.push({
        title: "对比分析",
        type: "comparison",
        estimatedWords: 700,
      });
    }

    if (features.hasCaseStudy) {
      sections.push({
        title: "案例研究",
        type: "caseStudy",
        estimatedWords: 900,
      });
    }

    if (features.hasRecommendations) {
      sections.push({
        title: "建议",
        type: "recommendations",
        estimatedWords: 600,
      });
    }

    sections.push({ title: "结论", type: "conclusion", estimatedWords: 400 });

    return sections;
  }

  /**
   * 建议文档风格
   */
  private suggestDocumentStyle(
    features: ContentFeatures,
  ): "formal" | "casual" | "technical" | "executive" {
    if (features.codeBlockCount > 0) return "technical";
    if (features.category === ContentCategory.PERSUASIVE) return "executive";
    if (features.complexity === ContentComplexity.HIGH) return "formal";
    return "formal";
  }

  /**
   * 生成摘要
   */
  private generateSummary(features: ContentFeatures): string {
    const parts: string[] = [];

    parts.push(`内容包含 ${features.wordCount} 字`);
    parts.push(`${features.paragraphCount} 个段落`);

    if (features.hasTimeline) parts.push("包含时间线");
    if (features.hasComparison) parts.push("包含对比分析");
    if (features.hasStatistics) parts.push("包含统计数据");
    if (features.hasCaseStudy) parts.push("包含案例研究");

    return parts.join("，") + "。";
  }

  /**
   * 降级分析结果
   */
  private getFallbackAnalysis(
    input: ContentAnalysisInput,
    processingTime: number,
  ): ContentAnalysisResult {
    const basicFeatures = this.extractBasicFeatures(input.content);

    const features: ContentFeatures = {
      category: ContentCategory.INFORMATIONAL,
      complexity: ContentComplexity.MEDIUM,
      dataDensity: basicFeatures.dataDensity || DataDensity.BALANCED,
      temporalDimension:
        basicFeatures.temporalDimension || TemporalDimension.NONE,
      hierarchyType: HierarchyType.FLAT,
      wordCount: basicFeatures.wordCount || 0,
      paragraphCount: basicFeatures.paragraphCount || 0,
      listCount: basicFeatures.listCount || 0,
      tableCount: basicFeatures.tableCount || 0,
      imageCount: basicFeatures.imageCount || 0,
      codeBlockCount: basicFeatures.codeBlockCount || 0,
      keyTopics: [],
      entities: [],
      hasTimeline: basicFeatures.hasTimeline || false,
      hasComparison: basicFeatures.hasComparison || false,
      hasStatistics: basicFeatures.hasStatistics || false,
      hasSteps: basicFeatures.hasSteps || false,
      hasCaseStudy: basicFeatures.hasCaseStudy || false,
      hasRecommendations: basicFeatures.hasRecommendations || false,
      hasRiskAnalysis: basicFeatures.hasRiskAnalysis || false,
      visualizationOpportunities: [],
    };

    return {
      features,
      summary: this.generateSummary(features),
      suggestedStructure: this.generateSuggestedStructure(features, input),
      confidence: 0.6,
      processingTime,
    };
  }
}
