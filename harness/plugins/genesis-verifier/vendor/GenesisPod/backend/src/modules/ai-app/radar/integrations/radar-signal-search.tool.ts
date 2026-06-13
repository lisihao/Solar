/**
 * RadarSignalSearchTool —— 雷达信号检索（雷达 → 洞察的供料通道）
 *
 * 把 AI 雷达持续采集的高分信号（RadarItem, accepted = true，已过 S4 相关性 +
 * S5 质量双重 AI 筛选）暴露为 ToolRegistry 'information' 类目下的检索工具。
 *
 * 消费方：playground / 洞察 mission 的 researcher 在采证阶段调用，获取
 * 用户雷达话题下的近期一手信号 —— 与 rag-search（私有沉淀）、web-search
 * （公开网页）互补的第三层时效性输入。
 *
 * 隔离：从 context.userId 做行级鉴权（topic.userId = userId），不信任 LLM
 * 传入的任何身份参数。无雷达话题 / 无命中 → success:true + 空结果 + note，
 * 让 LLM 自然回落 web-search（与 rag-search 同款行为，不发假 error）。
 */
import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "@/modules/ai-harness/facade/base-classes";
import type { ToolContext, JSONSchema } from "@/modules/ai-engine/facade";
import { PrismaService } from "../../../../common/prisma/prisma.service";

export interface RadarSignalSearchInput {
  /** 检索查询（自然语言或关键词；内部拆词做 OR 匹配） */
  query: string;
  /** 回看天数，默认 30，最大 90 */
  days?: number;
  /** 返回条数，默认 8，最大 20 */
  topK?: number;
}

export interface RadarSignalItem {
  itemId: string;
  title: string;
  /** AI 摘要（采集 pipeline S4/S5 写入） */
  summary: string | null;
  url: string | null;
  publishedAt: string;
  topicName: string;
  sourceLabel: string;
  relevanceScore: number | null;
}

export interface RadarSignalSearchOutput {
  results: RadarSignalItem[];
  success: boolean;
  totalResults: number;
  /** 成功但无结果时的说明（如"用户无雷达话题"），引导 LLM 回落 web-search */
  note?: string;
  error?: string;
}

const MAX_DAYS = 90;
const MAX_TOP_K = 20;

@Injectable()
export class RadarSignalSearchTool extends BaseTool<
  RadarSignalSearchInput,
  RadarSignalSearchOutput
> {
  private readonly logger = new Logger(RadarSignalSearchTool.name);
  readonly id = "radar-signal-search";
  readonly sideEffect = "none" as const;
  readonly category = "information";
  readonly tags = ["radar", "signal", "news", "realtime", "internal"];
  readonly name = "雷达信号检索";
  readonly description =
    "检索当前用户 AI 雷达订阅话题持续采集的高分信号（已过 AI 相关性 + 质量双重筛选的近期资讯，带 AI 摘要与原文链接）。适合获取话题的最新动态、一手信号、近 30 天市场与社区反应；时效性强于通用 web-search。用户没有雷达话题时返回空结果，此时回落 web-search 即可。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "检索查询，关键词或短语（内部按词拆分做 OR 匹配）",
      },
      days: {
        type: "number",
        description: `回看天数，默认 30，最大 ${MAX_DAYS}`,
        default: 30,
      },
      topK: {
        type: "number",
        description: `返回条数，默认 8，最大 ${MAX_TOP_K}`,
        default: 8,
      },
    },
    required: ["query"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      results: {
        type: "array",
        description: "命中的雷达信号（按相关性评分降序）",
        items: {
          type: "object",
          properties: {
            itemId: { type: "string" },
            title: { type: "string" },
            summary: { type: "string" },
            url: { type: "string" },
            publishedAt: { type: "string" },
            topicName: { type: "string" },
            sourceLabel: { type: "string" },
            relevanceScore: { type: "number" },
          },
        },
      },
      success: { type: "boolean" },
      totalResults: { type: "number" },
      note: { type: "string", description: "成功但无结果时的说明" },
      error: { type: "string", description: "失败原因" },
    },
  };

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  validateInput(input: RadarSignalSearchInput) {
    if (
      !input.query ||
      typeof input.query !== "string" ||
      input.query.trim().length === 0
    ) {
      this.logger.error("Invalid query: must be a non-empty string");
      return false;
    }
    if (input.query.length > 2000) {
      this.logger.error("Invalid query: too long (max 2000 characters)");
      return false;
    }
    if (
      input.days !== undefined &&
      (typeof input.days !== "number" ||
        input.days < 1 ||
        input.days > MAX_DAYS)
    ) {
      this.logger.error(`Invalid days: must be between 1 and ${MAX_DAYS}`);
      return false;
    }
    if (
      input.topK !== undefined &&
      (typeof input.topK !== "number" ||
        input.topK < 1 ||
        input.topK > MAX_TOP_K)
    ) {
      this.logger.error(`Invalid topK: must be between 1 and ${MAX_TOP_K}`);
      return false;
    }
    return true;
  }

  protected async doExecute(
    input: RadarSignalSearchInput,
    context: ToolContext,
  ): Promise<RadarSignalSearchOutput> {
    const userId = context.userId;
    if (!userId) {
      // mission 上下文未带 userId（理论上不应发生）：返回空而非假 error
      return {
        results: [],
        success: true,
        totalResults: 0,
        note: "no userId in tool context — fall back to web-search",
      };
    }

    const { query, days = 30, topK = 8 } = input;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // 拆词 OR 匹配：自然语言长 query 直接 contains 会必然 0 命中
    const terms = query
      .split(/[\s,，、;；/]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
      .slice(0, 6);

    const where: Record<string, unknown> = {
      accepted: true,
      topic: { userId },
      publishedAt: { gte: since },
    };
    if (terms.length > 0) {
      where.OR = terms.flatMap((t) => [
        { title: { contains: t, mode: "insensitive" } },
        { aiSummary: { contains: t, mode: "insensitive" } },
      ]);
    }

    try {
      const items = await this.prisma.radarItem.findMany({
        where,
        select: {
          id: true,
          title: true,
          aiSummary: true,
          url: true,
          publishedAt: true,
          relevanceScore: true,
          topic: { select: { name: true } },
          source: { select: { type: true, label: true } },
        },
        orderBy: [
          { relevanceScore: { sort: "desc", nulls: "last" } },
          { publishedAt: "desc" },
        ],
        take: Math.min(topK, MAX_TOP_K),
      });

      if (items.length === 0) {
        return {
          results: [],
          success: true,
          totalResults: 0,
          note: "no radar signals matched (user may have no radar topics covering this query) — fall back to web-search",
        };
      }

      const results: RadarSignalItem[] = items.map((it) => ({
        itemId: it.id,
        title: it.title ?? it.url ?? "(无标题信号)",
        summary: it.aiSummary,
        url: it.url,
        publishedAt: it.publishedAt.toISOString(),
        topicName: it.topic.name,
        sourceLabel: it.source.label ?? it.source.type,
        relevanceScore: it.relevanceScore,
      }));

      this.logger.log(
        `radar-signal-search: query="${query.substring(0, 80)}" terms=${terms.length} hits=${results.length}`,
      );
      return { results, success: true, totalResults: results.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`radar-signal-search failed: ${message}`);
      return { results: [], success: false, totalResults: 0, error: message };
    }
  }
}
