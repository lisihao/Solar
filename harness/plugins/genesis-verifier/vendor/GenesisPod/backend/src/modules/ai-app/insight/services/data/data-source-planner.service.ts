import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade, ToolFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import {
  DataSourceType,
  DataSourcePlanInput,
  DataSourcePlan,
  DataSourceCapability,
} from "../../types/data-source.types";
import { dataSourceToToolId } from "../../config/data-source-mapping.config";
import { DATA_SOURCE_CAPABILITIES } from "../../config/data-source-capabilities.config";

interface DataSourcePlanResponse {
  recommendedSources: string[];
  sourceRationales: Record<string, string>;
  overallRationale: string;
  fallbackSources?: string[];
  searchStrategy?: {
    suggestedMaxResults?: number;
    needsTimeFilter?: boolean;
    suggestedTimeRangeDays?: number;
    needsEnrichment?: boolean;
  };
  confidence?: number;
}

/**
 * DataSourcePlannerService
 *
 * AI 驱动的数据源规划服务，根据研究维度自动推荐最合适的数据源组合
 *
 * 核心功能：
 * 1. 分析维度描述，理解研究需求
 * 2. 根据可用数据源能力推荐最佳组合
 * 3. 提供推荐理由，支持用户覆盖
 * 4. 动态调整搜索策略
 */
@Injectable()
export class DataSourcePlannerService {
  private readonly logger = new Logger(DataSourcePlannerService.name);

  constructor(
    private readonly chatFacade: ChatFacade,
    private readonly toolFacade: ToolFacade,
  ) {}

  /**
   * 为指定维度规划数据源
   *
   * @param input 规划输入
   * @returns 数据源规划结果
   */
  async planDataSources(input: DataSourcePlanInput): Promise<DataSourcePlan> {
    this.logger.log(
      `[planDataSources] Planning for dimension: ${input.dimensionName} (topic: ${input.topicName})`,
    );

    try {
      // 1. 获取当前可用的数据源（基于 Admin 配置）
      const availableSources = await this.getAvailableDataSources();

      // 2. 构建 AI 规划提示词
      const prompt = this.buildPlanningPrompt(input, availableSources);

      // 3. 调用 AI 进行规划（chatStructured 自动处理 JSON 解析）
      const response =
        await this.chatFacade.chatStructured<DataSourcePlanResponse>({
          systemPrompt: this.getSystemPrompt(),
          messages: [{ role: "user", content: prompt }],
          operationName: "数据源规划",
          modelType: AIModelType.CHAT,
          skipGuardrails: true,
          taskProfile: { creativity: "low", outputLength: "medium" },
          throwOnParseError: false,
          strictMode: false,
          schema: {
            type: "object",
            required: ["recommendedSources"],
            additionalProperties: false,
            properties: {
              recommendedSources: { type: "array", items: { type: "string" } },
              sourceRationales: {
                type: "object",
                additionalProperties: { type: "string" },
              },
              overallRationale: { type: "string" },
              fallbackSources: { type: "array", items: { type: "string" } },
              searchStrategy: {
                type: "object",
                additionalProperties: false,
                properties: {
                  suggestedMaxResults: { type: "number" },
                  needsTimeFilter: { type: "boolean" },
                  suggestedTimeRangeDays: { type: "number" },
                  needsEnrichment: { type: "boolean" },
                },
              },
              confidence: { type: "number" },
            },
          },
        });

      // 4. 验证并构建规划结果
      const plan = this.buildPlanFromResponse(response.data, availableSources);

      this.logger.log(
        `[planDataSources] AI recommended ${plan.recommendedSources.length} sources: ${plan.recommendedSources.join(", ")}`,
      );

      return plan;
    } catch (error) {
      this.logger.error(
        `[planDataSources] Failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      // 返回默认规划
      return this.getDefaultPlan(input);
    }
  }

  /**
   * 获取当前可用的数据源列表
   * 基于 Admin 配置和工具注册状态
   */
  private async getAvailableDataSources(): Promise<DataSourceCapability[]> {
    const availableCapabilities: DataSourceCapability[] = [];

    for (const capability of DATA_SOURCE_CAPABILITIES) {
      // 检查工具是否在 ToolRegistry 中注册并被 Admin 启用
      const toolId = this.dataSourceToToolId(capability.type);
      if (toolId) {
        const isEnabled = await this.isToolEnabled(toolId);
        if (isEnabled) {
          availableCapabilities.push({ ...capability, isAvailable: true });
        }
      } else if (capability.isAvailable) {
        // 没有对应工具 ID 但标记为可用的（如 LOCAL）
        availableCapabilities.push(capability);
      }
    }

    return availableCapabilities;
  }

  /**
   * 数据源类型到工具 ID 的映射（委托到集中配置）
   */
  private dataSourceToToolId(source: DataSourceType): string | null {
    return dataSourceToToolId(source);
  }

  /**
   * 检查工具是否被 Admin 启用
   */
  private async isToolEnabled(toolId: string): Promise<boolean> {
    try {
      const availableTools = await this.toolFacade.capabilityResolveTools({});
      return availableTools.includes(toolId);
    } catch (error) {
      this.logger.debug(
        `[isToolEnabled] Failed to check if tool ${toolId} is enabled: ${error}`,
      );
      return false;
    }
  }

  /**
   * 获取系统提示词
   */
  private getSystemPrompt(): string {
    return `你是一个专业的研究数据源规划助手。你的任务是根据研究维度的描述，推荐最适合的数据源组合。

规划原则：
1. **相关性优先**：选择与研究主题最相关的数据源
2. **覆盖全面**：确保从多个角度获取信息
3. **权威可靠**：优先选择权威性高的数据源
4. **效率平衡**：不要选择过多数据源，通常 2-4 个为宜
5. **吞吐量优先**：同类数据源中优先选择高吞吐量(throughput=high)的，避免过度依赖限速严格(throughput=low)的数据源。学术搜索场景中，OpenAlex 应作为首选主力数据源，ArXiv/Semantic Scholar 作为补充
6. **场景匹配**：
   - 政策法规研究：优先政府官方数据源
   - 技术研究：优先学术（OpenAlex 为主 + ArXiv 补充）和开源数据源
   - 市场分析：优先 Web 搜索和新闻
   - 社区观点：优先社交媒体和论坛
   - 生物医学：优先 PubMed + OpenAlex

输出格式要求：
- 返回 JSON 格式
- 包含推荐数据源列表和理由
- 包含搜索策略建议`;
  }

  /**
   * 构建规划提示词
   */
  private buildPlanningPrompt(
    input: DataSourcePlanInput,
    availableSources: DataSourceCapability[],
  ): string {
    const throughputLabel = (t?: string) =>
      t === "high" ? "✅ 高吞吐" : t === "low" ? "⚠️ 限速严格" : "中等";

    const sourcesDescription = availableSources
      .map(
        (s) =>
          `- **${s.type}** (${s.displayName}): ${s.description}\n  适用场景: ${s.useCases.join("、")}\n  特点: ${s.characteristics.join("、")}\n  吞吐量: ${throughputLabel(s.throughput)}`,
      )
      .join("\n\n");

    return `请为以下研究维度推荐最合适的数据源组合：

## 研究信息

**主题名称**: ${input.topicName}
**主题类型**: ${input.topicType}
**维度名称**: ${input.dimensionName}
**维度描述**: ${input.dimensionDescription}
${input.searchQueries?.length ? `**预设搜索查询**: ${input.searchQueries.join("; ")}` : ""}

## 可用数据源

${sourcesDescription}

## 输出要求

请以 JSON 格式返回规划结果：

\`\`\`json
{
  "recommendedSources": ["source1", "source2"],
  "sourceRationales": {
    "source1": "选择理由...",
    "source2": "选择理由..."
  },
  "overallRationale": "整体规划说明...",
  "fallbackSources": ["fallback1"],
  "searchStrategy": {
    "suggestedMaxResults": 25,
    "needsTimeFilter": true,
    "suggestedTimeRangeDays": 180,
    "needsEnrichment": true
  },
  "confidence": 85
}
\`\`\`

注意：
1. recommendedSources 只能包含上述可用数据源的 type 值
2. 根据维度性质选择 2-4 个最相关的数据源
3. confidence 表示你对这个推荐的置信度 (0-100)`;
  }

  /**
   * 从 chatStructured 解析结果构建数据源规划
   */
  private buildPlanFromResponse(
    parsed: {
      recommendedSources: string[];
      sourceRationales?: Record<string, string>;
      overallRationale?: string;
      fallbackSources?: string[];
      searchStrategy?: {
        suggestedMaxResults?: number;
        needsTimeFilter?: boolean;
        suggestedTimeRangeDays?: number;
        needsEnrichment?: boolean;
      };
      confidence?: number;
    } | null,
    availableSources: DataSourceCapability[],
  ): DataSourcePlan {
    if (!parsed?.recommendedSources) {
      return {
        recommendedSources: [DataSourceType.WEB],
        sourceRationales: {
          [DataSourceType.WEB]: "默认使用 Web 搜索作为通用数据源",
        },
        overallRationale: "AI 响应解析失败，使用默认配置",
        fallbackSources: [],
        searchStrategy: {
          suggestedMaxResults: 25,
          needsTimeFilter: true,
          suggestedTimeRangeDays: 180,
          needsEnrichment: true,
        },
        confidence: 50,
      };
    }

    const validSourceTypes = availableSources.map((s) => s.type);
    const recommendedSources = (parsed.recommendedSources || []).filter(
      (s: string) => validSourceTypes.includes(s as DataSourceType),
    ) as DataSourceType[];

    const fallbackSources = (parsed.fallbackSources || []).filter((s: string) =>
      validSourceTypes.includes(s as DataSourceType),
    ) as DataSourceType[];

    return {
      recommendedSources:
        recommendedSources.length > 0
          ? recommendedSources
          : [DataSourceType.WEB],
      sourceRationales: parsed.sourceRationales || {},
      overallRationale: parsed.overallRationale || "AI 自动推荐",
      fallbackSources,
      searchStrategy: {
        suggestedMaxResults: parsed.searchStrategy?.suggestedMaxResults || 25,
        needsTimeFilter: parsed.searchStrategy?.needsTimeFilter ?? true,
        suggestedTimeRangeDays:
          parsed.searchStrategy?.suggestedTimeRangeDays || 180,
        needsEnrichment: parsed.searchStrategy?.needsEnrichment ?? true,
      },
      confidence: parsed.confidence || 70,
    };
  }

  /**
   * 获取默认规划（当 AI 调用失败时使用）
   */
  private getDefaultPlan(input: DataSourcePlanInput): DataSourcePlan {
    // 根据主题类型返回预设规划
    const topicType = (input.topicType || "").toUpperCase();
    const dimensionLower = (input.dimensionName || "").toLowerCase();

    let recommendedSources: DataSourceType[] = [DataSourceType.WEB];
    let rationale = "默认使用 Web 搜索";

    // 政策相关维度
    if (
      dimensionLower.includes("政策") ||
      dimensionLower.includes("法规") ||
      dimensionLower.includes("regulation") ||
      dimensionLower.includes("policy")
    ) {
      recommendedSources = [
        DataSourceType.WEB,
        DataSourceType.FEDERAL_REGISTER,
        DataSourceType.CONGRESS,
        DataSourceType.WHITEHOUSE,
      ];
      rationale = "政策相关维度，使用政府官方数据源";
    }
    // 技术相关维度
    else if (
      dimensionLower.includes("技术") ||
      dimensionLower.includes("algorithm") ||
      dimensionLower.includes("technology") ||
      topicType === "TECHNOLOGY_INSIGHT"
    ) {
      recommendedSources = [
        DataSourceType.ACADEMIC,
        DataSourceType.GITHUB,
        DataSourceType.HACKERNEWS,
        DataSourceType.WEB,
      ];
      rationale = "技术相关维度，使用学术和开源数据源";
    }
    // 市场相关维度
    else if (
      dimensionLower.includes("市场") ||
      dimensionLower.includes("投资") ||
      dimensionLower.includes("market") ||
      dimensionLower.includes("investment")
    ) {
      recommendedSources = [DataSourceType.WEB, DataSourceType.HACKERNEWS];
      rationale = "市场相关维度，使用 Web 搜索和社区讨论";
    }

    return {
      recommendedSources,
      sourceRationales: Object.fromEntries(
        recommendedSources.map((s) => [s, rationale]),
      ),
      overallRationale: `基于维度类型「${input.dimensionName}」的默认规划`,
      fallbackSources: [DataSourceType.WEB],
      searchStrategy: {
        suggestedMaxResults: 25,
        needsTimeFilter: true,
        suggestedTimeRangeDays: 180,
        needsEnrichment: true,
      },
      confidence: 60,
    };
  }

  /**
   * 获取所有数据源能力描述
   * 用于前端展示或调试
   */
  getDataSourceCapabilities(): DataSourceCapability[] {
    return DATA_SOURCE_CAPABILITIES;
  }
}
