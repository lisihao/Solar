/**
 * Slides Engine v4.0 - Data Supplement Skill
 *
 * 数据补全技能：当内容缺失时，主动使用搜索工具查找补充数据
 * 确保 PPT 内容完整、数据真实
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
  ToolRegistry,
} from "@/modules/ai-harness/facade";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { ToolContext } from "@/modules/ai-harness/facade";

/**
 * 搜索结果类型（从工具返回数据中提取）
 */
interface SearchResult {
  title: string;
  url: string;
  content: string;
}
import { PageContent, StatContent } from "../checkpoint/checkpoint.types";
import {
  MISSING_PLACEHOLDER,
  MISSING_NUMBER_PLACEHOLDER,
} from "../templates/base/template-requirements";

/**
 * 数据补全输入
 */
export interface DataSupplementInput {
  /** 页面内容（可能有缺失） */
  pageContent: PageContent;
  /** 页面主题/标题 */
  topic: string;
  /** 源文本（用于上下文） */
  sourceText?: string;
  /** 会话 ID */
  sessionId?: string;
}

/**
 * MissionOrchestrator 输入格式
 */
export interface DataSupplementOrchestratorInput {
  task?: string;
  context?: {
    input?: {
      pageContent?: PageContent;
      topic?: string;
      sourceText?: string;
      sessionId?: string;
    };
    [key: string]: unknown;
  };
  previousOutputs?: Record<string, unknown>;
}

/**
 * 数据补全结果
 */
export interface DataSupplementResult {
  /** 补全后的页面内容 */
  pageContent: PageContent;
  /** 是否进行了补全 */
  wasSupplemented: boolean;
  /** 补全的字段列表 */
  supplementedFields: string[];
  /** 搜索查询记录 */
  searchQueries: string[];
}

/**
 * 缺失数据项
 */
interface MissingDataItem {
  /** 字段路径 (如 "sections[0].content.value") */
  path: string;
  /** 字段类型 */
  type: "stat" | "text" | "label" | "title" | "subtitle";
  /** 上下文提示（用于生成搜索查询） */
  context: string;
}

/**
 * 数据提取系统提示词
 */
const DATA_EXTRACTION_PROMPT = `你是一位数据提取专家，擅长从搜索结果中提取结构化数据。

## 任务
根据搜索结果，提取与主题相关的具体数据填充到 PPT 中。

## 输出格式
返回 JSON 对象，键为字段路径，值为提取的数据：
{
  "sections[0].content.value": "85%",
  "sections[0].content.label": "市场占有率",
  "subtitle": "2024年Q4数据报告"
}

## 提取原则
1. 优先使用具体数字、百分比、金额
2. 数据必须来自搜索结果，不要编造
3. 如果找不到精确数据，使用"约"、"超过"等修饰词
4. 保持数据的时效性标注（如"2024年"）`;

@Injectable()
export class DataSupplementSkill implements ISkill<
  DataSupplementInput,
  DataSupplementResult
> {
  private readonly logger = new Logger(DataSupplementSkill.name);

  // ISkill properties
  readonly id = "slides-data-supplement";
  readonly name = "数据补全";
  readonly description = "检测缺失数据并使用搜索工具补充";
  readonly layer: SkillLayer = SKILL_LAYERS.CONTENT;
  readonly domain = "slides";
  readonly tags = ["slides", "data", "supplement", "search"];
  readonly version = "4.0.0";

  constructor(
    @Optional() private readonly chatFacade: ChatFacade,
    // ★ 架构重构：通过 ToolRegistry 调用工具
    @Optional() private readonly toolRegistry: ToolRegistry,
  ) {}

  /**
   * 创建工具执行上下文
   */
  private createToolContext(toolId: string): ToolContext {
    return {
      executionId: `${toolId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolId,
      createdAt: new Date(),
      callerType: "orchestrator",
    };
  }

  /**
   * 将 MissionOrchestrator 输入格式转换为直接输入格式
   */
  private normalizeInput(
    input: DataSupplementInput | DataSupplementOrchestratorInput,
  ): DataSupplementInput | null {
    // 如果已经是直接格式，直接返回
    if ("pageContent" in input && "topic" in input) {
      return input;
    }

    // 尝试从 orchestrator 格式提取
    const orchestratorInput = input;
    const contextInput = orchestratorInput.context?.input;

    if (!contextInput?.pageContent || !contextInput?.topic) {
      this.logger.warn(
        "[normalizeInput] Missing required fields in orchestrator input: " +
          `pageContent=${!!contextInput?.pageContent}, ` +
          `topic=${!!contextInput?.topic}`,
      );
      return null;
    }

    return {
      pageContent: contextInput.pageContent,
      topic: contextInput.topic,
      sourceText: contextInput.sourceText,
      sessionId: contextInput.sessionId,
    };
  }

  /**
   * 执行数据补全
   */
  async execute(
    input: DataSupplementInput | DataSupplementOrchestratorInput,
    context: SkillContext,
  ): Promise<SkillResult<DataSupplementResult>> {
    const startTime = new Date();

    // Normalize input from orchestrator format if needed
    const normalizedInput = this.normalizeInput(input);
    if (!normalizedInput) {
      return {
        success: false,
        error: {
          code: "INVALID_INPUT",
          message:
            "Failed to normalize input: missing required fields (pageContent, topic)",
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    }

    const { pageContent, topic } = normalizedInput;

    try {
      this.logger.log(`[execute] Checking data completeness for "${topic}"`);

      // 1. 检测缺失数据
      const missingItems = this.detectMissingData(pageContent);

      if (missingItems.length === 0) {
        this.logger.log("[execute] No missing data detected");
        const endTime = new Date();
        return {
          success: true,
          data: {
            pageContent,
            wasSupplemented: false,
            supplementedFields: [],
            searchQueries: [],
          },
          metadata: {
            executionId: context.executionId,
            startTime,
            endTime,
            duration: endTime.getTime() - startTime.getTime(),
            tokensUsed: 0,
          },
        };
      }

      this.logger.log(
        `[execute] Found ${missingItems.length} missing items: ${missingItems.map((m) => m.path).join(", ")}`,
      );

      // 2. 生成搜索查询
      const searchQueries = this.generateSearchQueries(topic, missingItems);

      // 3. 执行搜索
      const searchResults = await this.performSearches(searchQueries);

      if (searchResults.length === 0) {
        this.logger.warn("[execute] No search results found");
        const endTime = new Date();
        return {
          success: true,
          data: {
            pageContent,
            wasSupplemented: false,
            supplementedFields: [],
            searchQueries,
          },
          metadata: {
            executionId: context.executionId,
            startTime,
            endTime,
            duration: endTime.getTime() - startTime.getTime(),
            tokensUsed: 0,
          },
        };
      }

      // 4. 使用 AI 从搜索结果中提取数据
      const { extractedData, tokensUsed } = await this.extractDataFromResults(
        topic,
        missingItems,
        searchResults,
        context.sessionId,
      );

      // 5. 应用补全数据
      const supplementedContent = this.applySupplementedData(
        pageContent,
        extractedData,
      );

      const supplementedFields = Object.keys(extractedData);
      this.logger.log(
        `[execute] Supplemented ${supplementedFields.length} fields`,
      );

      const endTime = new Date();
      return {
        success: true,
        data: {
          pageContent: supplementedContent,
          wasSupplemented: supplementedFields.length > 0,
          supplementedFields,
          searchQueries,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime,
          duration: endTime.getTime() - startTime.getTime(),
          tokensUsed,
        },
      };
    } catch (error) {
      const endTime = new Date();
      this.logger.error(`[execute] Error: ${error}`);
      return {
        success: false,
        error: {
          code: "DATA_SUPPLEMENT_ERROR",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime,
          duration: endTime.getTime() - startTime.getTime(),
          tokensUsed: 0,
        },
      };
    }
  }

  /**
   * 检测缺失数据
   */
  private detectMissingData(pageContent: PageContent): MissingDataItem[] {
    const missing: MissingDataItem[] = [];

    // 检查标题
    if (this.isMissing(pageContent.title)) {
      missing.push({
        path: "title",
        type: "title",
        context: "页面主标题",
      });
    }

    // 检查副标题
    if (this.isMissing(pageContent.subtitle)) {
      missing.push({
        path: "subtitle",
        type: "subtitle",
        context: "页面副标题或描述",
      });
    }

    // 检查 sections
    pageContent.sections?.forEach((section, index) => {
      if (section.type === "stat" && this.isStatContent(section.content)) {
        const stat = section.content;
        if (this.isMissing(stat.value)) {
          missing.push({
            path: `sections[${index}].content.value`,
            type: "stat",
            context: stat.label || `第${index + 1}个统计数据的值`,
          });
        }
        if (this.isMissing(stat.label)) {
          missing.push({
            path: `sections[${index}].content.label`,
            type: "label",
            context: `第${index + 1}个统计数据的标签`,
          });
        }
      } else if (
        section.type === "text" &&
        this.isMissing(section.content as string)
      ) {
        missing.push({
          path: `sections[${index}].content`,
          type: "text",
          context: `第${index + 1}段文本内容`,
        });
      } else if (section.type === "list" && Array.isArray(section.content)) {
        section.content.forEach((item, itemIndex) => {
          if (this.isMissing(item)) {
            missing.push({
              path: `sections[${index}].content[${itemIndex}]`,
              type: "text",
              context: `列表第${itemIndex + 1}项`,
            });
          }
        });
      }
    });

    return missing;
  }

  /**
   * 判断值是否为缺失状态
   * v3.7: 增强检测 - 识别通用填充内容
   */
  private isMissing(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== "string") return false;
    const trimmed = value.trim();

    // 1. 显式占位符检测
    if (
      trimmed === "" ||
      trimmed === MISSING_PLACEHOLDER ||
      trimmed === MISSING_NUMBER_PLACEHOLDER ||
      trimmed === "[内容缺失]" ||
      trimmed === "[--]"
    ) {
      return true;
    }

    // 2. 通用填充内容检测 - 这些内容表示 AI 无法从源文本提取有效数据
    if (this.isGenericFiller(trimmed)) {
      this.logger.debug(`[isMissing] Detected generic filler: "${trimmed}"`);
      return true;
    }

    return false;
  }

  /**
   * 检测是否为通用填充内容（无实际信息量）
   */
  private isGenericFiller(text: string): boolean {
    // 精确匹配的无效内容
    const exactFillers = [
      "核心能力",
      "关键优势",
      "核心支柱",
      "创新驱动",
      "数字化转型",
      "智能化升级",
      "高效协同",
      "战略布局",
      "生态构建",
      "价值创造",
      "商务简约",
      "专业视觉",
      "设计风格",
      "视觉设计",
      "专业呈现",
      "高效传达",
      "详细描述",
      "待补充",
      "待完善",
      "暂无数据",
    ];

    if (exactFillers.includes(text)) {
      return true;
    }

    // 模式匹配的无效内容
    const fillerPatterns = [
      /^支柱\s*\d+$/,
      /^要点\s*\d+$/,
      /^章节\s*\d+$/,
      /^内容\s*\d+$/,
      /^项目\s*\d+$/,
      /^核心\d+$/,
      /^商务简约/,
      /^专业视觉呈现/,
      /^高效信息传达/,
      /^持续创新迭代/,
      /创新驱动[：:]/,
      /^赋能.*发展$/,
      /^助力.*升级$/,
      /^打造.*体系$/,
      /^构建.*生态$/,
    ];

    return fillerPatterns.some((pattern) => pattern.test(text));
  }

  /**
   * 类型守卫：检查是否为 StatContent
   */
  private isStatContent(content: unknown): content is StatContent {
    return (
      typeof content === "object" &&
      content !== null &&
      "value" in content &&
      "label" in content
    );
  }

  /**
   * 生成搜索查询
   */
  private generateSearchQueries(
    topic: string,
    missingItems: MissingDataItem[],
  ): string[] {
    const queries: string[] = [];

    // 主查询：主题 + 统计数据
    const hasStatMissing = missingItems.some((m) => m.type === "stat");
    if (hasStatMissing) {
      queries.push(`${topic} 统计数据 数字 百分比`);
      queries.push(`${topic} 市场规模 增长率 2024`);
    }

    // 针对特定缺失项的查询
    for (const item of missingItems) {
      if (item.type === "stat" && item.context) {
        queries.push(`${topic} ${item.context} 数据`);
      }
    }

    // 去重并限制数量
    const uniqueQueries = [...new Set(queries)].slice(0, 3);
    this.logger.debug(
      `[generateSearchQueries] Generated: ${uniqueQueries.join(" | ")}`,
    );

    return uniqueQueries;
  }

  /**
   * 执行搜索
   */
  private async performSearches(queries: string[]): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];

    // ★ 通过 ToolRegistry 调用 web-search 工具
    const webSearchTool = this.toolRegistry?.tryGet("web-search");
    if (!webSearchTool) {
      this.logger.warn("[performSearches] web-search tool not available");
      return [];
    }

    for (const query of queries) {
      try {
        const toolResult = await webSearchTool.execute(
          { query, numResults: 3 },
          this.createToolContext("web-search"),
        );

        if (toolResult.success && toolResult.data) {
          const searchData = toolResult.data as {
            results: SearchResult[];
            success: boolean;
          };
          if (searchData.success && searchData.results?.length > 0) {
            allResults.push(...searchData.results);
          }
        }
      } catch (error) {
        this.logger.warn(
          `[performSearches] Search failed for "${query}": ${error}`,
        );
      }
    }

    // 去重（基于 URL）
    const seen = new Set<string>();
    return allResults.filter((r) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });
  }

  /**
   * 从搜索结果中提取数据
   */
  private async extractDataFromResults(
    topic: string,
    missingItems: MissingDataItem[],
    searchResults: SearchResult[],
    _sessionId?: string,
  ): Promise<{ extractedData: Record<string, string>; tokensUsed: number }> {
    // 构建搜索结果摘要
    const resultsSummary = searchResults
      .slice(0, 5)
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}`)
      .join("\n\n");

    // 构建缺失字段描述
    const missingDesc = missingItems
      .map((m) => `- ${m.path}: ${m.context} (${m.type})`)
      .join("\n");

    const userMessage = `## 主题
${topic}

## 需要填充的字段
${missingDesc}

## 搜索结果
${resultsSummary}

## 请求
从搜索结果中提取数据，填充上述缺失字段。返回 JSON 格式。`;

    const messages = [
      { role: "system" as const, content: DATA_EXTRACTION_PROMPT },
      { role: "user" as const, content: userMessage },
    ];

    try {
      if (!this.chatFacade) {
        this.logger.warn("[extractDataFromResults] No LLM adapter available");
        return { extractedData: {}, tokensUsed: 0 };
      }

      const response = await this.chatFacade.chat({
        messages,
        modelType: "CHAT" as const,
        taskProfile: {
          creativity: "deterministic",
          outputLength: "short",
        },
      });

      if (!response.content) {
        this.logger.warn("[extractDataFromResults] AI extraction failed");
        return {
          extractedData: {},
          tokensUsed: response.tokensUsed || 0,
        };
      }

      // 解析 JSON 响应
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn("[extractDataFromResults] No JSON found in response");
        return {
          extractedData: {},
          tokensUsed: response.tokensUsed || 0,
        };
      }

      const extracted = JSON.parse(jsonMatch[0]);
      return {
        extractedData: extracted as Record<string, string>,
        tokensUsed: response.tokensUsed || 0,
      };
    } catch (error) {
      this.logger.error(`[extractDataFromResults] Error: ${error}`);
      return { extractedData: {}, tokensUsed: 0 };
    }
  }

  /**
   * 应用补全数据到 PageContent
   */
  private applySupplementedData(
    pageContent: PageContent,
    data: Record<string, string>,
  ): PageContent {
    // 深拷贝
    const result = JSON.parse(JSON.stringify(pageContent)) as PageContent;

    for (const [path, value] of Object.entries(data)) {
      if (!value || this.isMissing(value)) continue;

      try {
        this.setValueByPath(
          result as unknown as Record<string, unknown>,
          path,
          value,
        );
        this.logger.debug(`[applySupplementedData] Set ${path} = "${value}"`);
      } catch (error) {
        this.logger.warn(
          `[applySupplementedData] Failed to set ${path}: ${error}`,
        );
      }
    }

    return result;
  }

  /**
   * 按路径设置值 (支持 "sections[0].content.value" 格式)
   */
  private setValueByPath(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void {
    const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (current[key] === undefined) {
        current[key] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      }
      current = current[key] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }
}
