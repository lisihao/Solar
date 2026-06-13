/**
 * Knowledge Base Tool
 * 知识库工具 - 管理结构化知识文章
 *
 * 功能:
 * - create: 创建知识条目
 * - read: 读取知识条目
 * - update: 更新知识条目
 * - delete: 删除知识条目
 * - search: 搜索知识条目
 * - list: 列出知识条目
 *
 * 特点:
 * - 结构化存储（标题、内容、标签、分类）
 * - 全文搜索
 * - 分类和标签管理
 * - 版本追踪
 */

import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";

// ============================================================================
// Types
// ============================================================================

/**
 * 知识条目
 */
export interface KnowledgeEntry {
  /**
   * 条目 ID
   */
  id: string;

  /**
   * 标题
   */
  title: string;

  /**
   * 内容
   */
  content: string;

  /**
   * 分类
   */
  category: string;

  /**
   * 标签
   */
  tags: string[];

  /**
   * 元数据
   */
  metadata?: Record<string, unknown>;

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 更新时间
   */
  updatedAt: Date;

  /**
   * 版本号
   */
  version: number;

  /**
   * 来源
   */
  source?: string;

  /**
   * 引用链接
   */
  references?: string[];
}

/**
 * 操作类型
 */
export enum KnowledgeOperation {
  CREATE = "create",
  READ = "read",
  UPDATE = "update",
  DELETE = "delete",
  SEARCH = "search",
  LIST = "list",
  LIST_CATEGORIES = "list_categories",
  LIST_TAGS = "list_tags",
}

/**
 * 知识库工具输入
 */
export interface KnowledgeBaseInput {
  /**
   * 操作类型
   */
  operation: KnowledgeOperation;

  /**
   * 条目 ID（用于 read, update, delete）
   */
  entryId?: string;

  /**
   * 条目数据（用于 create, update）
   */
  entry?: {
    title: string;
    content: string;
    category?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    source?: string;
    references?: string[];
  };

  /**
   * 搜索查询（用于 search）
   */
  query?: string;

  /**
   * 过滤器（用于 search, list）
   */
  filter?: {
    category?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
    sortBy?: "createdAt" | "updatedAt" | "title" | "relevance";
    sortOrder?: "asc" | "desc";
  };
}

/**
 * 知识库工具输出
 */
export interface KnowledgeBaseOutput {
  /**
   * 操作是否成功
   */
  success: boolean;

  /**
   * 操作类型
   */
  operation: KnowledgeOperation;

  /**
   * 单个条目（用于 create, read, update, delete）
   */
  entry?: KnowledgeEntry;

  /**
   * 多个条目（用于 search, list）
   */
  entries?: KnowledgeEntry[];

  /**
   * 分类列表（用于 list_categories）
   */
  categories?: string[];

  /**
   * 标签列表（用于 list_tags）
   */
  tags?: string[];

  /**
   * 错误信息
   */
  error?: string;

  /**
   * 元数据
   */
  metadata?: {
    totalCount?: number;
    page?: number;
    pageSize?: number;
    processingTime?: number;
  };
}

// ============================================================================
// Tool Implementation
// ============================================================================

/**
 * 知识库工具
 *
 * 用于管理结构化知识文章，支持：
 * - CRUD 操作
 * - 全文搜索
 * - 分类和标签管理
 * - 版本追踪
 *
 * @example
 * ```typescript
 * // 创建知识条目
 * {
 *   operation: "create",
 *   entry: {
 *     title: "React Hooks 最佳实践",
 *     content: "1. 使用 useState 管理状态...",
 *     category: "前端开发",
 *     tags: ["React", "Hooks", "JavaScript"],
 *     source: "官方文档",
 *     references: ["https://react.dev/hooks"]
 *   }
 * }
 *
 * // 搜索知识
 * {
 *   operation: "search",
 *   query: "React Hooks",
 *   filter: {
 *     category: "前端开发",
 *     limit: 10
 *   }
 * }
 * ```
 */
@Injectable()
export class KnowledgeBaseTool extends BaseTool<
  KnowledgeBaseInput,
  KnowledgeBaseOutput
> {
  private readonly logger = new Logger(KnowledgeBaseTool.name);

  readonly id = "knowledge-base";
  readonly sideEffect = "idempotent" as const;
  readonly category: ToolCategory = "memory";
  readonly tags = ["memory", "knowledge", "kb", "documents", "internal"];
  readonly name = "知识库";
  readonly description =
    "管理结构化知识文章。支持创建、读取、更新、删除、搜索和分类知识条目，适用于构建和维护知识库、文档库、FAQ 等内容系统。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description: "操作类型",
        enum: Object.values(KnowledgeOperation),
      },
      entryId: {
        type: "string",
        description: "知识条目 ID（用于 read, update, delete 操作）",
      },
      entry: {
        type: "object",
        description: "知识条目数据（用于 create, update 操作）",
        properties: {
          title: {
            type: "string",
            description: "条目标题",
          },
          content: {
            type: "string",
            description: "条目内容（支持 Markdown）",
          },
          category: {
            type: "string",
            description: "条目分类",
            default: "未分类",
          },
          tags: {
            type: "array",
            description: "标签列表",
            items: {
              type: "string",
            },
          },
          metadata: {
            type: "object",
            description: "附加元数据",
          },
          source: {
            type: "string",
            description: "知识来源",
          },
          references: {
            type: "array",
            description: "参考链接",
            items: {
              type: "string",
            },
          },
        },
        required: ["title", "content"],
      },
      query: {
        type: "string",
        description: "搜索查询（用于 search 操作）",
      },
      filter: {
        type: "object",
        description: "过滤和排序选项",
        properties: {
          category: {
            type: "string",
            description: "按分类过滤",
          },
          tags: {
            type: "array",
            description: "按标签过滤（满足任一标签）",
            items: {
              type: "string",
            },
          },
          limit: {
            type: "number",
            description: "返回结果数量限制",
            default: 20,
          },
          offset: {
            type: "number",
            description: "结果偏移量（用于分页）",
            default: 0,
          },
          sortBy: {
            type: "string",
            description: "排序字段",
            enum: ["createdAt", "updatedAt", "title", "relevance"],
            default: "updatedAt",
          },
          sortOrder: {
            type: "string",
            description: "排序顺序",
            enum: ["asc", "desc"],
            default: "desc",
          },
        },
      },
    },
    required: ["operation"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: {
        type: "boolean",
        description: "操作是否成功",
      },
      operation: {
        type: "string",
        description: "执行的操作类型",
      },
      entry: {
        type: "object",
        description: "单个知识条目",
      },
      entries: {
        type: "array",
        description: "知识条目列表",
        items: {
          type: "object",
        },
      },
      categories: {
        type: "array",
        description: "分类列表",
        items: {
          type: "string",
        },
      },
      tags: {
        type: "array",
        description: "标签列表",
        items: {
          type: "string",
        },
      },
      error: {
        type: "string",
        description: "错误信息",
      },
    },
  };

  private static readonly USER_ID = "system";
  private static readonly ENTRY_TYPE = "knowledge_entry";

  private memoryTableReady: boolean | null = null;
  /** ★ P0-LIVE-TOOL-EMPTY-ERR (2026-04-30): 记录 unavailable 具体原因 */
  private memoryTableUnavailableReason: string | null = null;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  private async ensureMemoryTable(): Promise<boolean> {
    if (this.memoryTableReady !== null) return this.memoryTableReady;
    try {
      const result = await this.prisma.$queryRaw<[{ exists: boolean }]>(
        Prisma.sql`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='long_term_memories') AS "exists"`,
      );
      this.memoryTableReady = result[0]?.exists ?? false;
      if (!this.memoryTableReady) {
        this.memoryTableUnavailableReason =
          "Postgres table 'long_term_memories' does not exist (Prisma migration not run on this database)";
      }
    } catch (err) {
      this.memoryTableReady = false;
      this.memoryTableUnavailableReason =
        err instanceof Error
          ? `Failed to query information_schema for 'long_term_memories': ${err.message}`
          : `Failed to query information_schema for 'long_term_memories': ${String(err)}`;
    }
    return this.memoryTableReady;
  }

  private get knowledgeBaseUnavailableError(): string {
    return `Knowledge base unavailable: ${this.memoryTableUnavailableReason || "long_term_memories table not initialized"}`;
  }

  /**
   * 验证输入
   */
  validateInput(input: KnowledgeBaseInput) {
    // 验证操作类型
    if (!Object.values(KnowledgeOperation).includes(input.operation)) {
      return false;
    }

    // 验证各操作所需参数
    switch (input.operation) {
      case KnowledgeOperation.CREATE:
        return !!input.entry?.title && !!input.entry?.content;

      case KnowledgeOperation.READ:
      case KnowledgeOperation.UPDATE:
      case KnowledgeOperation.DELETE:
        return !!input.entryId;

      case KnowledgeOperation.SEARCH:
        return !!input.query;

      case KnowledgeOperation.LIST:
      case KnowledgeOperation.LIST_CATEGORIES:
      case KnowledgeOperation.LIST_TAGS:
        return true;

      default:
        return false;
    }
  }

  /**
   * 执行知识库操作
   */
  protected async doExecute(
    input: KnowledgeBaseInput,
    context: ToolContext,
  ): Promise<KnowledgeBaseOutput> {
    const startTime = Date.now();

    try {
      switch (input.operation) {
        case KnowledgeOperation.CREATE:
          return await this.createEntry(input.entry, context);

        case KnowledgeOperation.READ:
          return await this.readEntry(input.entryId!);

        case KnowledgeOperation.UPDATE:
          return await this.updateEntry(input.entryId!, input.entry);

        case KnowledgeOperation.DELETE:
          return await this.deleteEntry(input.entryId!);

        case KnowledgeOperation.SEARCH:
          return await this.searchEntries(input.query!, input.filter);

        case KnowledgeOperation.LIST:
          return await this.listEntries(input.filter);

        case KnowledgeOperation.LIST_CATEGORIES:
          return await this.listCategories();

        case KnowledgeOperation.LIST_TAGS:
          return await this.listTags();

        default:
          return {
            success: false,
            operation: input.operation,
            error: `Unknown operation: ${input.operation}`,
          };
      }
    } catch (error) {
      this.logger.error(
        `Knowledge base operation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );

      return {
        success: false,
        operation: input.operation,
        error: error instanceof Error ? error.message : "Unknown error",
        metadata: {
          processingTime: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * 创建知识条目
   */
  private async createEntry(
    entryData: KnowledgeBaseInput["entry"],
    _context: ToolContext,
  ): Promise<KnowledgeBaseOutput> {
    if (!(await this.ensureMemoryTable())) {
      return {
        success: false,
        operation: KnowledgeOperation.CREATE,
        error: this.knowledgeBaseUnavailableError,
      };
    }

    const entryId = this.generateEntryId();
    const now = new Date();

    const entry: KnowledgeEntry = {
      id: entryId,
      title: entryData!.title,
      content: entryData!.content,
      category: entryData!.category || "未分类",
      tags: entryData!.tags || [],
      metadata: entryData!.metadata || {},
      createdAt: now,
      updatedAt: now,
      version: 1,
      source: entryData!.source,
      references: entryData!.references || [],
    };

    await this.prisma.longTermMemory.create({
      data: {
        userId: KnowledgeBaseTool.USER_ID,
        key: entryId,
        type: KnowledgeBaseTool.ENTRY_TYPE,
        value: entry as object,
        tags: entry.tags,
      },
    });

    this.logger.log(`Created knowledge entry: ${entry.title} [${entryId}]`);

    return {
      success: true,
      operation: KnowledgeOperation.CREATE,
      entry,
    };
  }

  /**
   * 读取知识条目
   */
  private async readEntry(entryId: string): Promise<KnowledgeBaseOutput> {
    if (!(await this.ensureMemoryTable())) {
      return {
        success: false,
        operation: KnowledgeOperation.READ,
        error: this.knowledgeBaseUnavailableError,
      };
    }

    const record = await this.prisma.longTermMemory.findUnique({
      where: {
        userId_key: { userId: KnowledgeBaseTool.USER_ID, key: entryId },
      },
    });

    if (!record || record.type !== KnowledgeBaseTool.ENTRY_TYPE) {
      return {
        success: false,
        operation: KnowledgeOperation.READ,
        error: `Knowledge entry not found: ${entryId}`,
      };
    }

    return {
      success: true,
      operation: KnowledgeOperation.READ,
      entry: record.value as unknown as KnowledgeEntry,
    };
  }

  /**
   * 更新知识条目
   */
  private async updateEntry(
    entryId: string,
    updates: KnowledgeBaseInput["entry"],
  ): Promise<KnowledgeBaseOutput> {
    if (!(await this.ensureMemoryTable())) {
      return {
        success: false,
        operation: KnowledgeOperation.UPDATE,
        error: this.knowledgeBaseUnavailableError,
      };
    }

    const record = await this.prisma.longTermMemory.findUnique({
      where: {
        userId_key: { userId: KnowledgeBaseTool.USER_ID, key: entryId },
      },
    });

    if (!record || record.type !== KnowledgeBaseTool.ENTRY_TYPE) {
      return {
        success: false,
        operation: KnowledgeOperation.UPDATE,
        error: `Knowledge entry not found: ${entryId}`,
      };
    }

    const entry = record.value as unknown as KnowledgeEntry;

    if (updates!.title) entry.title = updates!.title;
    if (updates!.content) entry.content = updates!.content;
    if (updates!.category) entry.category = updates!.category;
    if (updates!.tags) entry.tags = updates!.tags;
    if (updates!.metadata) {
      entry.metadata = { ...entry.metadata, ...updates!.metadata };
    }
    if (updates!.source) entry.source = updates!.source;
    if (updates!.references) entry.references = updates!.references;

    entry.updatedAt = new Date();
    entry.version++;

    await this.prisma.longTermMemory.update({
      where: {
        userId_key: { userId: KnowledgeBaseTool.USER_ID, key: entryId },
      },
      data: { value: entry as object, tags: entry.tags },
    });

    this.logger.log(
      `Updated knowledge entry: ${entry.title} [${entryId}] (v${entry.version})`,
    );

    return {
      success: true,
      operation: KnowledgeOperation.UPDATE,
      entry,
    };
  }

  /**
   * 删除知识条目
   */
  private async deleteEntry(entryId: string): Promise<KnowledgeBaseOutput> {
    if (!(await this.ensureMemoryTable())) {
      return {
        success: false,
        operation: KnowledgeOperation.DELETE,
        error: this.knowledgeBaseUnavailableError,
      };
    }

    const record = await this.prisma.longTermMemory.findUnique({
      where: {
        userId_key: { userId: KnowledgeBaseTool.USER_ID, key: entryId },
      },
    });

    if (!record || record.type !== KnowledgeBaseTool.ENTRY_TYPE) {
      return {
        success: false,
        operation: KnowledgeOperation.DELETE,
        error: `Knowledge entry not found: ${entryId}`,
      };
    }

    const entry = record.value as unknown as KnowledgeEntry;

    await this.prisma.longTermMemory.delete({
      where: {
        userId_key: { userId: KnowledgeBaseTool.USER_ID, key: entryId },
      },
    });

    this.logger.log(`Deleted knowledge entry: ${entry.title} [${entryId}]`);

    return {
      success: true,
      operation: KnowledgeOperation.DELETE,
      entry,
    };
  }

  /**
   * 搜索知识条目
   */
  private async loadAllEntries(): Promise<KnowledgeEntry[]> {
    if (!(await this.ensureMemoryTable())) {
      return [];
    }

    const records = await this.prisma.longTermMemory.findMany({
      where: {
        userId: KnowledgeBaseTool.USER_ID,
        type: KnowledgeBaseTool.ENTRY_TYPE,
      },
    });
    return records.map((r) => r.value as unknown as KnowledgeEntry);
  }

  private async searchEntries(
    query: string,
    filter?: KnowledgeBaseInput["filter"],
  ): Promise<KnowledgeBaseOutput> {
    let entries = await this.loadAllEntries();

    // 全文搜索
    const lowerQuery = query.toLowerCase();
    entries = entries.filter(
      (entry) =>
        entry.title.toLowerCase().includes(lowerQuery) ||
        entry.content.toLowerCase().includes(lowerQuery) ||
        entry.tags.some((tag) => tag.toLowerCase().includes(lowerQuery)),
    );

    // 应用过滤器
    entries = this.applyFilter(entries, filter);

    // 排序（相关性排序基于匹配度）
    if (filter?.sortBy === "relevance") {
      entries.sort((a, b) => {
        const scoreA = this.calculateRelevance(a, lowerQuery);
        const scoreB = this.calculateRelevance(b, lowerQuery);
        return scoreB - scoreA;
      });
    } else {
      entries = this.sortEntries(entries, filter);
    }

    // 分页
    const totalCount = entries.length;
    const offset = filter?.offset || 0;
    const limit = filter?.limit || 20;
    entries = entries.slice(offset, offset + limit);

    return {
      success: true,
      operation: KnowledgeOperation.SEARCH,
      entries,
      metadata: {
        totalCount,
        page: Math.floor(offset / limit) + 1,
        pageSize: limit,
      },
    };
  }

  /**
   * 列出知识条目
   */
  private async listEntries(
    filter?: KnowledgeBaseInput["filter"],
  ): Promise<KnowledgeBaseOutput> {
    let entries = await this.loadAllEntries();

    // 应用过滤器
    entries = this.applyFilter(entries, filter);

    // 排序
    entries = this.sortEntries(entries, filter);

    // 分页
    const totalCount = entries.length;
    const offset = filter?.offset || 0;
    const limit = filter?.limit || 20;
    entries = entries.slice(offset, offset + limit);

    return {
      success: true,
      operation: KnowledgeOperation.LIST,
      entries,
      metadata: {
        totalCount,
        page: Math.floor(offset / limit) + 1,
        pageSize: limit,
      },
    };
  }

  /**
   * 列出所有分类
   */
  private async listCategories(): Promise<KnowledgeBaseOutput> {
    const entries = await this.loadAllEntries();
    const categories = [...new Set(entries.map((e) => e.category))].sort();

    return {
      success: true,
      operation: KnowledgeOperation.LIST_CATEGORIES,
      categories,
      metadata: {
        totalCount: categories.length,
      },
    };
  }

  /**
   * 列出所有标签
   */
  private async listTags(): Promise<KnowledgeBaseOutput> {
    if (!(await this.ensureMemoryTable())) {
      return {
        success: true,
        operation: KnowledgeOperation.LIST_TAGS,
        tags: [],
        metadata: { totalCount: 0 },
      };
    }

    const records = await this.prisma.longTermMemory.findMany({
      where: {
        userId: KnowledgeBaseTool.USER_ID,
        type: KnowledgeBaseTool.ENTRY_TYPE,
      },
      select: { tags: true },
    });
    const tags = [...new Set(records.flatMap((r) => r.tags))].sort();

    return {
      success: true,
      operation: KnowledgeOperation.LIST_TAGS,
      tags,
      metadata: {
        totalCount: tags.length,
      },
    };
  }

  /**
   * 应用过滤器
   */
  private applyFilter(
    entries: KnowledgeEntry[],
    filter?: KnowledgeBaseInput["filter"],
  ): KnowledgeEntry[] {
    if (!filter) return entries;

    // 按分类过滤
    if (filter.category) {
      entries = entries.filter((e) => e.category === filter.category);
    }

    // 按标签过滤（满足任一标签）
    if (filter.tags && filter.tags.length > 0) {
      entries = entries.filter((e) =>
        filter.tags!.some((tag) => e.tags.includes(tag)),
      );
    }

    return entries;
  }

  /**
   * 排序条目
   */
  private sortEntries(
    entries: KnowledgeEntry[],
    filter?: KnowledgeBaseInput["filter"],
  ): KnowledgeEntry[] {
    const sortBy = filter?.sortBy || "updatedAt";
    const sortOrder = filter?.sortOrder || "desc";

    entries.sort((a, b) => {
      let result = 0;

      switch (sortBy) {
        case "title":
          result = a.title.localeCompare(b.title);
          break;
        case "createdAt":
          result = a.createdAt.getTime() - b.createdAt.getTime();
          break;
        case "updatedAt":
        default:
          result = a.updatedAt.getTime() - b.updatedAt.getTime();
          break;
      }

      return sortOrder === "asc" ? result : -result;
    });

    return entries;
  }

  /**
   * 计算相关性分数
   */
  private calculateRelevance(entry: KnowledgeEntry, query: string): number {
    let score = 0;

    // 标题匹配权重最高
    if (entry.title.toLowerCase().includes(query)) {
      score += 10;
    }

    // 内容匹配
    const contentLower = entry.content.toLowerCase();
    const matches = (contentLower.match(new RegExp(query, "g")) || []).length;
    score += matches * 2;

    // 标签匹配
    if (entry.tags.some((tag) => tag.toLowerCase().includes(query))) {
      score += 5;
    }

    return score;
  }

  /**
   * 生成条目 ID
   */
  private generateEntryId(): string {
    return `kb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
