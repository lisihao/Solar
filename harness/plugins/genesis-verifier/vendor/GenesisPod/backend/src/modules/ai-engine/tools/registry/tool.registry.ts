/**
 * AI Engine - Tool Registry
 * 工具注册表实现
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseRegistry, IRegistry, RegistryStats } from "@/modules/ai-engine/facade/abstractions/registry.interface";
import {
  ITool,
  ToolCategory,
  FunctionDefinition,
  ToolDefinition,
  CompactToolSummary,
  ToolListOptions,
} from "../abstractions/tool.interface";

/**
 * 工具注册表
 */
@Injectable()
export class ToolRegistry
  extends BaseRegistry<ITool>
  implements IRegistry<ITool>
{
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly byCategory = new Map<string, Set<string>>();
  private readonly byTag = new Map<string, Set<string>>();
  private readonly factories = new Map<string, () => ITool>();

  /**
   * 注册工具
   */
  override register(tool: ITool): void {
    if (this.has(tool.id)) {
      this.logger.warn(
        `Tool already registered, skipping: ${tool.id} (${tool.name})`,
      );
      return;
    }

    super.register(tool);

    // 索引分类
    if (!this.byCategory.has(tool.category)) {
      this.byCategory.set(tool.category, new Set());
    }
    this.byCategory.get(tool.category)!.add(tool.id);

    // 索引标签
    if (tool.tags) {
      for (const tag of tool.tags) {
        if (!this.byTag.has(tag)) {
          this.byTag.set(tag, new Set());
        }
        this.byTag.get(tag)!.add(tool.id);
      }
    }
  }

  /**
   * 注册工具定义（延迟创建）
   */
  registerDefinition<TInput, TOutput>(
    definition: ToolDefinition<TInput, TOutput>,
  ): void {
    if (definition.factory) {
      this.factories.set(definition.id, definition.factory);
    }
  }

  /**
   * 注销工具
   */
  override unregister(id: string): boolean {
    const tool = this.tryGet(id);
    if (!tool) {
      return false;
    }

    // 清理分类索引
    this.byCategory.get(tool.category)?.delete(id);

    // 清理标签索引
    if (tool.tags) {
      for (const tag of tool.tags) {
        this.byTag.get(tag)?.delete(id);
      }
    }

    return super.unregister(id);
  }

  /**
   * 按分类获取工具
   */
  getByCategory(category: ToolCategory): ITool[] {
    const ids = this.byCategory.get(category);
    if (!ids) {
      return [];
    }
    return Array.from(ids)
      .map((id) => this.tryGet(id))
      .filter((tool): tool is ITool => tool !== undefined);
  }

  /**
   * ★ 按多类别召回（Tool Recall 基础召回 Step 1）
   *
   * 输入若干 category，返回这些类别下所有 enabled 工具的去重并集。
   *
   * 与 getByCategory 的差异：
   *   - 多类别一次取并集，对应 mission-pipeline-tool-recall.md §4 Step 1
   *   - 自动 dedupe（不同类别共用 id 时不重复）
   *   - 只返回 enabled 工具（disabled 的不进 catalog）
   */
  listByCategory(categories: readonly ToolCategory[]): ITool[] {
    if (categories.length === 0) return [];
    const seen = new Set<string>();
    const result: ITool[] = [];
    for (const cat of categories) {
      const ids = this.byCategory.get(cat);
      if (!ids) continue;
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const tool = this.tryGet(id);
        if (tool && tool.enabled !== false) {
          result.push(tool);
        }
      }
    }
    return result;
  }

  /**
   * 按标签获取工具
   */
  getByTag(tag: string): ITool[] {
    const ids = this.byTag.get(tag);
    if (!ids) {
      return [];
    }
    return Array.from(ids)
      .map((id) => this.tryGet(id))
      .filter((tool): tool is ITool => tool !== undefined);
  }

  /**
   * 获取所有分类
   */
  getCategories(): ToolCategory[] {
    return Array.from(this.byCategory.keys());
  }

  /**
   * 获取所有标签
   */
  getTags(): string[] {
    return Array.from(this.byTag.keys());
  }

  /**
   * 获取启用的工具
   */
  getEnabled(): ITool[] {
    return this.getAll().filter((tool) => tool.enabled !== false);
  }

  /**
   * 获取所有工具的 Function Definition
   */
  getAllFunctionDefinitions(): FunctionDefinition[] {
    return this.getEnabled().map((tool) => tool.toFunctionDefinition());
  }

  /**
   * 获取指定工具的 Function Definition
   */
  getFunctionDefinitions(ids: string[]): FunctionDefinition[] {
    return ids
      .map((id) => this.tryGet(id))
      .filter(
        (tool): tool is ITool => tool !== undefined && tool.enabled !== false,
      )
      .map((tool) => tool.toFunctionDefinition());
  }

  /**
   * ★ NEW: 获取所有工具的精简摘要（节省 Token）
   * 用于 LLM 工具列表展示，不包含参数 Schema
   */
  getAllCompactSummaries(): CompactToolSummary[] {
    return this.getEnabled().map((tool) => tool.toCompactSummary());
  }

  /**
   * ★ NEW: 获取指定工具的精简摘要
   */
  getCompactSummaries(ids: string[]): CompactToolSummary[] {
    return ids
      .map((id) => this.tryGet(id))
      .filter(
        (tool): tool is ITool => tool !== undefined && tool.enabled !== false,
      )
      .map((tool) => tool.toCompactSummary());
  }

  /**
   * ★ NEW: 根据选项获取工具列表
   * 支持精简模式和完整模式
   */
  getToolList(
    ids: string[],
    options: ToolListOptions = {},
  ): CompactToolSummary[] | FunctionDefinition[] {
    const { compact = true, maxTools, categories, tags } = options;

    // 过滤工具
    let tools = ids
      .map((id) => this.tryGet(id))
      .filter(
        (tool): tool is ITool => tool !== undefined && tool.enabled !== false,
      );

    // 按类别过滤
    if (categories && categories.length > 0) {
      tools = tools.filter((tool) => categories.includes(tool.category));
    }

    // 按标签过滤
    if (tags && tags.length > 0) {
      tools = tools.filter(
        (tool) => tool.tags && tags.some((tag) => tool.tags!.includes(tag)),
      );
    }

    // 限制数量
    if (maxTools && maxTools > 0) {
      tools = tools.slice(0, maxTools);
    }

    // 返回精简或完整格式
    if (compact) {
      return tools.map((tool) => tool.toCompactSummary());
    } else {
      return tools.map((tool) => tool.toFunctionDefinition());
    }
  }

  /**
   * ★ NEW: 估算工具列表的 Token 消耗
   * 基于 JSON schema 字符串长度估算，而非固定魔法常量。
   * compact 模式约 1 token/10 字符，完整模式约 1 token/4 字符。
   */
  estimateTokens(ids: string[], compact = true): number {
    return ids
      .filter((id) => this.isAvailable(id))
      .reduce((sum, id) => {
        const tool = this.tryGet(id);
        if (!tool) return sum;
        const schemaLen = JSON.stringify(tool.inputSchema ?? {}).length;
        return sum + Math.ceil(compact ? schemaLen / 10 : schemaLen / 4);
      }, 0);
  }

  /**
   * 检查工具是否可用
   */
  isAvailable(id: string): boolean {
    const tool = this.tryGet(id);
    return tool !== undefined && tool.enabled !== false;
  }

  /**
   * 获取统计信息
   */
  override getStats(): ToolRegistryStats {
    const baseStats = super.getStats();
    const byCategory: Record<string, number> = {};

    for (const [category, ids] of this.byCategory.entries()) {
      byCategory[category] = ids.size;
    }

    return {
      ...baseStats,
      byCategory,
      enabledCount: this.getEnabled().length,
      disabledCount: this.size() - this.getEnabled().length,
    };
  }

  /**
   * 搜索工具
   */
  search(query: ToolSearchQuery): ITool[] {
    let results = this.getAll();

    // 按关键词过滤
    if (query.keyword) {
      const keyword = query.keyword.toLowerCase();
      results = results.filter(
        (tool) =>
          tool.id.toLowerCase().includes(keyword) ||
          tool.name.toLowerCase().includes(keyword) ||
          tool.description.toLowerCase().includes(keyword),
      );
    }

    // 按分类过滤
    if (query.category) {
      results = results.filter((tool) => tool.category === query.category);
    }

    // 按标签过滤
    if (query.tags && query.tags.length > 0) {
      results = results.filter(
        (tool) =>
          tool.tags && query.tags!.some((tag) => tool.tags!.includes(tag)),
      );
    }

    // 只返回启用的
    if (query.enabledOnly) {
      results = results.filter((tool) => tool.enabled !== false);
    }

    return results;
  }
}

/**
 * 工具注册表统计
 */
export interface ToolRegistryStats extends RegistryStats {
  /**
   * 按分类统计
   */
  byCategory: Record<string, number>;

  /**
   * 启用的工具数量
   */
  enabledCount: number;

  /**
   * 禁用的工具数量
   */
  disabledCount: number;
}

/**
 * 工具搜索查询
 */
export interface ToolSearchQuery {
  /**
   * 关键词
   */
  keyword?: string;

  /**
   * 分类
   */
  category?: ToolCategory;

  /**
   * 标签
   */
  tags?: string[];

  /**
   * 只返回启用的
   */
  enabledOnly?: boolean;
}
