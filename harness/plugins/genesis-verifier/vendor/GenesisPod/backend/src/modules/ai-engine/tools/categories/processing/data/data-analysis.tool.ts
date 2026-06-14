/**
 * Data Analysis Tool
 * 数据分析工具 - 使用 AI 分析数据
 */

import { Injectable } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";

import { AiChatService } from "@/modules/ai-engine/llm/chat/ai-chat.service";

// ============================================================================
// Types
// ============================================================================

export interface DataAnalysisInput {
  /**
   * 要分析的数据
   */
  data: unknown;

  /**
   * 分析类型
   */
  analysisType:
    | "summary"
    | "statistics"
    | "trends"
    | "comparison"
    | "insights"
    | "custom";

  /**
   * 自定义分析指令（当 analysisType 为 custom 时）
   */
  customPrompt?: string;

  /**
   * 输出格式
   */
  outputFormat?: "text" | "json" | "markdown" | "chart_data";

  /**
   * 分析深度
   */
  depth?: "quick" | "standard" | "deep";
}

export interface DataAnalysisOutput {
  /**
   * 分析结果
   */
  analysis: string | Record<string, unknown>;

  /**
   * 关键洞察
   */
  insights?: string[];

  /**
   * 统计数据
   */
  statistics?: Record<string, number | string>;

  /**
   * 图表数据（如果 outputFormat 为 chart_data）
   */
  chartData?: {
    type: string;
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
    }>;
  };

  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 失败时的明细原因
   */
  error?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class DataAnalysisTool extends BaseTool<
  DataAnalysisInput,
  DataAnalysisOutput
> {
  readonly id = "data-analysis";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "processing";
  readonly tags = ["processing", "data", "analysis", "statistics"];
  readonly name = "数据分析";
  readonly description =
    "使用 AI 分析数据并提取洞察。支持统计分析、趋势分析、比较分析等。可输出文本报告或结构化数据。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      data: {
        type: "object",
        description: "要分析的数据，可以是数组、对象或文本",
      },
      analysisType: {
        type: "string",
        description: "分析类型",
        enum: [
          "summary",
          "statistics",
          "trends",
          "comparison",
          "insights",
          "custom",
        ],
      },
      customPrompt: {
        type: "string",
        description: "自定义分析指令（当 analysisType 为 custom 时使用）",
      },
      outputFormat: {
        type: "string",
        description: "输出格式",
        enum: ["text", "json", "markdown", "chart_data"],
        default: "markdown",
      },
      depth: {
        type: "string",
        description: "分析深度",
        enum: ["quick", "standard", "deep"],
        default: "standard",
      },
    },
    required: ["data", "analysisType"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      analysis: {
        type: "string",
        description: "分析结果文本或 JSON 对象",
      },
      insights: {
        type: "array",
        description: "关键洞察列表",
        items: { type: "string" },
      },
      statistics: {
        type: "object",
        description: "统计数据",
      },
      chartData: {
        type: "object",
        description: "图表数据",
      },
      success: {
        type: "boolean",
        description: "分析是否成功",
      },
    },
  };

  constructor(private readonly aiChatService: AiChatService) {
    super();
    // defaultTimeout set in class property // 90 秒超时
  }

  validateInput(input: DataAnalysisInput) {
    return (
      input.data !== undefined && input.data !== null && !!input.analysisType
    );
  }

  protected async doExecute(
    input: DataAnalysisInput,
    _context: ToolContext,
  ): Promise<DataAnalysisOutput> {
    const {
      data,
      analysisType,
      customPrompt,
      outputFormat = "markdown",
      depth = "standard",
    } = input;

    // 构建分析提示词
    const systemPrompt = this.buildSystemPrompt(
      analysisType,
      outputFormat,
      depth,
    );
    const userPrompt = this.buildUserPrompt(data, analysisType, customPrompt);

    try {
      const response = await this.aiChatService.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        taskProfile: {
          creativity: "low",
          outputLength:
            depth === "deep"
              ? "long"
              : depth === "standard"
                ? "medium"
                : "short",
        },
      });

      // 解析响应
      return this.parseAnalysisResponse(response.content, outputFormat);
    } catch (error) {
      // ★ P0-LIVE-TOOL-EMPTY-ERR (2026-04-30): 透传 LLM/parse 真因
      return {
        analysis: "",
        success: false,
        error:
          error instanceof Error
            ? `Data analysis failed: ${error.message}`
            : `Data analysis failed: ${String(error)}`,
      };
    }
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(
    analysisType: string,
    outputFormat: string,
    depth: string,
  ): string {
    const depthInstruction =
      depth === "deep"
        ? "进行深入、全面的分析，考虑各种角度和细节。"
        : depth === "quick"
          ? "进行快速、精简的分析，只关注最重要的点。"
          : "进行标准分析，平衡深度和效率。";

    const formatInstruction =
      outputFormat === "json"
        ? "以有效的 JSON 格式输出结果，包含 analysis, insights, statistics 字段。"
        : outputFormat === "chart_data"
          ? "输出适合图表展示的数据结构，包含 type, labels, datasets 字段。"
          : outputFormat === "markdown"
            ? "以 Markdown 格式输出，使用标题、列表和表格组织内容。"
            : "以纯文本格式输出分析结果。";

    return `你是一个专业的数据分析师。

任务：根据用户提供的数据进行 ${this.getAnalysisTypeDescription(analysisType)} 分析。

要求：
- ${depthInstruction}
- ${formatInstruction}
- 识别关键洞察和模式
- 提供有价值的结论和建议
- 如果数据不足或质量有问题，明确指出`;
  }

  /**
   * 获取分析类型描述
   */
  private getAnalysisTypeDescription(analysisType: string): string {
    const descriptions: Record<string, string> = {
      summary: "总结性",
      statistics: "统计",
      trends: "趋势",
      comparison: "对比",
      insights: "洞察",
      custom: "自定义",
    };
    return descriptions[analysisType] || "综合";
  }

  /**
   * 构建用户提示词
   */
  private buildUserPrompt(
    data: unknown,
    analysisType: string,
    customPrompt?: string,
  ): string {
    const dataStr =
      typeof data === "string" ? data : JSON.stringify(data, null, 2);

    let prompt = `数据：\n${dataStr}\n\n`;

    switch (analysisType) {
      case "summary":
        prompt += "请对上述数据进行总结分析，提炼主要信息和关键点。";
        break;
      case "statistics":
        prompt +=
          "请对上述数据进行统计分析，计算关键统计指标（如平均值、中位数、分布等）。";
        break;
      case "trends":
        prompt += "请分析上述数据的趋势和变化规律，识别增长或下降趋势。";
        break;
      case "comparison":
        prompt += "请对上述数据进行对比分析，比较不同项目/时期的差异。";
        break;
      case "insights":
        prompt += "请从上述数据中提取有价值的洞察和发现，给出可行的建议。";
        break;
      case "custom":
        prompt += customPrompt || "请分析上述数据。";
        break;
      default:
        prompt += "请对上述数据进行综合分析。";
    }

    return prompt;
  }

  /**
   * 解析分析响应
   */
  private parseAnalysisResponse(
    content: string,
    outputFormat: string,
  ): DataAnalysisOutput {
    if (outputFormat === "json" || outputFormat === "chart_data") {
      try {
        // 尝试提取 JSON
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
        const jsonStr = jsonMatch ? jsonMatch[1] : content;
        const parsed = JSON.parse(jsonStr);

        return {
          analysis: parsed.analysis || content,
          insights: parsed.insights,
          statistics: parsed.statistics,
          chartData: parsed.chartData,
          success: true,
        };
      } catch {
        // JSON 解析失败，返回原始文本
        return {
          analysis: content,
          success: true,
        };
      }
    }

    // 文本格式，尝试提取结构化内容
    const insights = this.extractInsights(content);

    return {
      analysis: content,
      insights: insights.length > 0 ? insights : undefined,
      success: true,
    };
  }

  /**
   * 从文本中提取洞察
   */
  private extractInsights(content: string): string[] {
    const insights: string[] = [];

    // 提取列表项作为洞察
    const listMatches = content.match(/[-•*]\s+(.+)/g);
    if (listMatches) {
      for (const match of listMatches.slice(0, 5)) {
        const insight = match.replace(/^[-•*]\s+/, "").trim();
        if (insight.length > 10 && insight.length < 200) {
          insights.push(insight);
        }
      }
    }

    return insights;
  }
}
