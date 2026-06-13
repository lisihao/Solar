/**
 * GenesisPod v2.1 - Multi-Agent 执行器
 *
 * 实现 Orchestrator + Content/Layout/Visual/Style 四个子Agent协作
 * ★ P3 迁移：使用 AIFacade 统一入口
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import {
  AgentResult,
  ContentAgentOutput,
  LayoutAgentOutput,
  VisualAgentOutput,
  StyleAgentOutput,
  VisualSpecification,
  ContentAnalysis,
  BackgroundDecision,
  TemplateLayoutType,
  InformationArchitecture,
} from "../core/engine.types";

// Agent 系统提示词
const CONTENT_AGENT_PROMPT = `你是内容分析专家。分析提供的内容，提取核心信息架构。

任务：
1. 识别内容的主要结构（并列主题、顺序流程、中心概念、对比、层级）
2. 提取标题、副标题、核心陈述
3. 将内容组织为2-6个章节，每个章节包含：
   - 标题（简短有力）
   - 摘要（1-2句话）
   - 要点（2-4个）
   - 指标（如有数据）
   - 章节类型（main 或 summary）
4. 识别是否有总结/结论章节

输出 JSON 格式：
{
  "informationArchitecture": {
    "title": "标题",
    "subtitle": "副标题",
    "heroStatement": "核心陈述",
    "sections": [
      {
        "title": "章节标题",
        "summary": "摘要",
        "bullets": ["要点1", "要点2"],
        "metrics": [{"label": "指标", "value": "数值"}],
        "sectionType": "main|summary"
      }
    ],
    "callToAction": "行动号召"
  },
  "contentAnalysis": {
    "type": "data_heavy|balanced|visual_concept",
    "structureType": "parallel_stories|sequential_process|central_concept|comparison|hierarchy",
    "language": "zh|en|mixed",
    "complexity": "high|medium|low",
    "wordCount": 100,
    "hasData": true,
    "hasTimeline": false,
    "mainPointsCount": 3,
    "hasSummaryConclusion": true
  }
}`;

const LAYOUT_AGENT_PROMPT = `你是布局设计专家。根据内容结构选择最佳模板布局。

模板选择规则：
- cards: 3+个并列主题，同等重要性
- center_visual: 1个中心概念 + 4-8个支持点
- timeline: 顺序流程、步骤、时间线
- comparison: 恰好2个事物对比（A vs B）
- pyramid: 层级结构、优先级
- radial: 中心辐射、生态系统
- statistics: 数据密集、KPI、指标
- checklist: 清单、提示、最佳实践
- funnel: 漏斗、转化流程
- matrix: 2x2矩阵、象限分析

重要：
- comparison 只能用于恰好2个事物对比，不能用于3+并列主题
- 3个并列故事/主题必须用 cards，不是 comparison

输出 JSON 格式：
{
  "templateLayout": "cards|center_visual|timeline|comparison|pyramid|radial|statistics|checklist|funnel|matrix",
  "layoutPlan": ["布局决策1", "布局决策2"],
  "reasoning": "选择这个布局的原因"
}`;

const VISUAL_AGENT_PROMPT = `你是视觉设计专家。负责背景类型决策和图标/图表建议。

背景类型选择规则：
- solid: 数据报表、KPI、简洁信息图 → 纯色背景突出内容
- gradient: 流程图、架构图、一般信息图 → 渐变背景增加层次
- ai_generated: 营销物料、文章配图、需要视觉冲击的内容 → AI生成背景

颜色方向：
- horizontal: 水平渐变
- vertical: 垂直渐变
- diagonal: 对角渐变
- radial: 径向渐变

输出 JSON 格式：
{
  "backgroundDecision": {
    "type": "solid|gradient|ai_generated",
    "reasoning": "选择原因",
    "colors": {
      "primary": "#1e3a5f",
      "secondary": "#0891b2",
      "direction": "diagonal"
    },
    "aiConfig": {
      "prompt": "背景描述，如果type是ai_generated",
      "style": "abstract|nature|tech|minimal",
      "colorTone": "warm|cool|neutral",
      "complexity": "minimal|moderate|detailed"
    }
  },
  "iconMapping": {
    "section_id": "target|chart|briefcase|shield|lightbulb|gear|users|globe|clock|trending|star|check"
  },
  "chartRecommendations": []
}`;

const STYLE_AGENT_PROMPT = `你是视觉风格专家。负责整体设计风格和配色方案。

设计风格：
- consulting: 专业商务，深蓝色系，McKinsey/BCG风格
- tech: 科技感，紫蓝渐变，现代感
- minimal: 极简，黑白灰，大量留白
- creative: 创意活泼，明亮色彩，圆角设计
- dark: 深色模式，深背景浅文字
- academic: 学术风，衬线字体，传统配色
- business: 商务简约，灰蓝色系
- genspark: 玻璃态，深蓝背景，渐变卡片
- tech_gradient: 紫蓝渐变，科技未来感

检测关键词：
- 科技/tech/modern → tech
- 简约/minimal/clean → minimal
- 创意/creative/fun → creative
- 暗黑/dark/night → dark

输出 JSON 格式：
{
  "visualLanguage": {
    "colorPalette": ["#1e3a5f", "#0891b2", "#f8fafc", "#334155"],
    "primaryColor": "#1e3a5f",
    "accentColor": "#0891b2",
    "backgroundColor": "#f7f9fc",
    "textColor": "#1a202c",
    "designStyle": "consulting|tech|minimal|creative|dark|academic|business|genspark|tech_gradient",
    "fontStyle": "sans|serif|mono|rounded",
    "borderRadius": "none|small|medium|large",
    "shadowStyle": "none|subtle|medium|strong"
  },
  "designJournal": [
    {"title": "设计决策", "narrative": "详细说明"}
  ],
  "qualityChecks": ["检查项1", "检查项2"]
}`;

@Injectable()
export class AgentExecutorService {
  private readonly logger = new Logger(AgentExecutorService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 调用 LLM API
   * ★ P3 迁移：使用 AIFacade 统一入口
   */
  private async callLLM(
    systemPrompt: string,
    userContent: string,
    _temperature = 0.7,
  ): Promise<string> {
    const result = await this.chatFacade.chat({
      messages: [{ role: "user", content: userContent }],
      systemPrompt,
      modelType: AIModelType.CHAT,
      taskProfile: {
        creativity: "medium", // 原 temperature: 0.7
        outputLength: "standard", // 原 maxTokens: 4096
      },
    });

    return result.content || "";
  }

  /**
   * 解析 JSON 响应
   */
  private parseJSONResponse<T>(response: string): T | null {
    try {
      // 移除可能的 markdown 代码块
      let cleaned = response.trim();
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.slice(7);
      }
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith("```")) {
        cleaned = cleaned.slice(0, -3);
      }
      return JSON.parse(cleaned.trim());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to parse JSON response: ${message}`);
      return null;
    }
  }

  /**
   * 执行 Content Agent
   */
  async executeContentAgent(
    content: string,
  ): Promise<AgentResult<ContentAgentOutput>> {
    const startTime = Date.now();

    try {
      const response = await this.callLLM(CONTENT_AGENT_PROMPT, content);

      const data = this.parseJSONResponse<ContentAgentOutput>(response);

      return {
        success: !!data,
        data: data || undefined,
        executionTime: Date.now() - startTime,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * 执行 Layout Agent
   */
  async executeLayoutAgent(
    contentAnalysis: ContentAnalysis,
    informationArchitecture: InformationArchitecture,
  ): Promise<AgentResult<LayoutAgentOutput>> {
    const startTime = Date.now();

    try {
      const context = JSON.stringify(
        {
          contentAnalysis,
          sections: informationArchitecture.sections?.length || 0,
          hasMetrics: informationArchitecture.sections?.some(
            (s) => (s.metrics?.length ?? 0) > 0,
          ),
        },
        null,
        2,
      );

      const response = await this.callLLM(LAYOUT_AGENT_PROMPT, context);

      const data = this.parseJSONResponse<LayoutAgentOutput>(response);

      // 硬性约束：comparison模板只能用于恰好2个sections
      // 如果有3+个sections但AI选择了comparison，强制改为cards
      if (data) {
        const sectionCount = informationArchitecture.sections?.length || 0;
        if (data.templateLayout === "comparison" && sectionCount > 2) {
          this.logger.warn(
            `Layout correction: comparison template invalid for ${sectionCount} sections, switching to cards`,
          );
          data.templateLayout = "cards";
          data.reasoning = `[Auto-corrected] ${data.reasoning} → comparison只支持2项对比，${sectionCount}个sections必须用cards`;
        }
        // matrix模板需要恰好4个sections
        if (data.templateLayout === "matrix" && sectionCount !== 4) {
          this.logger.warn(
            `Layout correction: matrix template requires exactly 4 sections, got ${sectionCount}, switching to cards`,
          );
          data.templateLayout = "cards";
          data.reasoning = `[Auto-corrected] ${data.reasoning} → matrix需要4个sections，当前${sectionCount}个，改用cards`;
        }
      }

      return {
        success: !!data,
        data: data || undefined,
        executionTime: Date.now() - startTime,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * 执行 Visual Agent
   */
  async executeVisualAgent(
    contentAnalysis: ContentAnalysis,
    templateLayout: TemplateLayoutType,
    originalContent: string,
  ): Promise<AgentResult<VisualAgentOutput>> {
    const startTime = Date.now();

    try {
      const context = JSON.stringify(
        {
          contentAnalysis,
          templateLayout,
          contentPreview: originalContent.slice(0, 500),
        },
        null,
        2,
      );

      const response = await this.callLLM(VISUAL_AGENT_PROMPT, context);

      const data = this.parseJSONResponse<VisualAgentOutput>(response);

      return {
        success: !!data,
        data: data || undefined,
        executionTime: Date.now() - startTime,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * 执行 Style Agent
   */
  async executeStyleAgent(
    contentAnalysis: ContentAnalysis,
    templateLayout: TemplateLayoutType,
    backgroundType: string,
    originalContent: string,
  ): Promise<AgentResult<StyleAgentOutput>> {
    const startTime = Date.now();

    try {
      const context = JSON.stringify(
        {
          contentAnalysis,
          templateLayout,
          backgroundType,
          contentPreview: originalContent.slice(0, 300),
        },
        null,
        2,
      );

      const response = await this.callLLM(STYLE_AGENT_PROMPT, context);

      const data = this.parseJSONResponse<StyleAgentOutput>(response);

      return {
        success: !!data,
        data: data || undefined,
        executionTime: Date.now() - startTime,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * 编排所有 Agent，生成完整的 VisualSpecification
   * 这是统一渲染模式的核心方法
   */
  async orchestrate(content: string): Promise<VisualSpecification> {
    this.logger.log("Starting Multi-Agent orchestration...");

    // Step 1: Content Agent - 内容分析
    this.logger.log("Step 1: Executing Content Agent...");
    const contentResult = await this.executeContentAgent(content);

    if (!contentResult.success || !contentResult.data) {
      throw new Error(
        `Content Agent failed: ${contentResult.error || "Unknown error"}`,
      );
    }

    const { informationArchitecture, contentAnalysis } = contentResult.data;

    // 补充 reasoning
    const fullContentAnalysis: ContentAnalysis = {
      ...contentAnalysis,
      reasoning: `Content type: ${contentAnalysis.type}, Structure: ${contentAnalysis.structureType}`,
    };

    // Step 2: Layout Agent - 布局决策
    this.logger.log("Step 2: Executing Layout Agent...");
    const layoutResult = await this.executeLayoutAgent(
      fullContentAnalysis,
      informationArchitecture,
    );

    const templateLayout: TemplateLayoutType =
      layoutResult.data?.templateLayout || "cards";
    const layoutPlan = layoutResult.data?.layoutPlan || [];

    // Step 3: Visual Agent - 背景和视觉决策
    this.logger.log("Step 3: Executing Visual Agent...");
    const visualResult = await this.executeVisualAgent(
      fullContentAnalysis,
      templateLayout,
      content,
    );

    const backgroundDecision: BackgroundDecision = visualResult.data
      ?.backgroundDecision || {
      type: "gradient",
      reasoning: "Default gradient background",
      colors: {
        primary: "#1e3a5f",
        secondary: "#0891b2",
        direction: "diagonal",
      },
    };

    // Step 4: Style Agent - 风格决策
    this.logger.log("Step 4: Executing Style Agent...");
    const styleResult = await this.executeStyleAgent(
      fullContentAnalysis,
      templateLayout,
      backgroundDecision.type,
      content,
    );

    const visualLanguage = styleResult.data?.visualLanguage || {
      colorPalette: ["#1e3a5f", "#0891b2", "#f8fafc", "#334155"],
      primaryColor: "#1e3a5f",
      accentColor: "#0891b2",
      backgroundColor: "#f7f9fc",
      textColor: "#1a202c",
      designStyle: "consulting",
      fontStyle: "sans",
      borderRadius: "medium",
      shadowStyle: "subtle",
    };

    // 组装最终的 VisualSpecification
    const specification: VisualSpecification = {
      backgroundDecision,
      templateLayout,
      contentAnalysis: fullContentAnalysis,
      informationArchitecture,
      visualLanguage,
      designJournal: styleResult.data?.designJournal || [],
      layoutPlan,
      qualityChecks: styleResult.data?.qualityChecks || [],
      negativeKeywords: [
        "text",
        "words",
        "letters",
        "typography",
        "3D render",
        "photorealistic",
      ],
    };

    // 如果需要 AI 生成背景，添加图像提示词
    if (
      backgroundDecision.type === "ai_generated" &&
      backgroundDecision.aiConfig
    ) {
      specification.imagePrompt = backgroundDecision.aiConfig.prompt;
    }

    this.logger.log("Multi-Agent orchestration completed successfully");
    return specification;
  }
}
