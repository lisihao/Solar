/**
 * AI Engine - Registry Interface
 * 注册表接口定义
 */

/**
 * 可注册项接口
 */
export interface IRegisterable {
  /**
   * 唯一标识符
   */
  readonly id: string;
}

/**
 * 通用注册表接口
 */
export interface IRegistry<T extends IRegisterable> {
  /**
   * 注册项
   * @param item 要注册的项
   * @throws 如果 ID 已存在
   */
  register(item: T): void;

  /**
   * 批量注册
   * @param items 要注册的项列表
   */
  registerMany(items: T[]): void;

  /**
   * 获取项
   * @param id 项 ID
   * @throws 如果不存在
   */
  get(id: string): T;

  /**
   * 尝试获取项（不抛异常）
   * @param id 项 ID
   * @returns 项或 undefined
   */
  tryGet(id: string): T | undefined;

  /**
   * 检查是否存在
   * @param id 项 ID
   */
  has(id: string): boolean;

  /**
   * 检查是否所有项都存在
   * @param ids 项 ID 列表
   */
  hasAll(ids: string[]): boolean;

  /**
   * 获取所有项
   */
  getAll(): T[];

  /**
   * 获取所有项的 ID
   */
  getAllIds(): string[];

  /**
   * 注销项
   * @param id 项 ID
   * @returns 是否成功注销
   */
  unregister(id: string): boolean;

  /**
   * 清空注册表
   */
  clear(): void;

  /**
   * 获取注册项数量
   */
  size(): number;

  /**
   * 获取注册表统计
   */
  getStats(): RegistryStats;
}

/**
 * 注册表统计
 */
export interface RegistryStats {
  /**
   * 总数
   */
  total: number;

  /**
   * 按类别分组（如果适用）
   */
  byCategory?: Record<string, number>;

  /**
   * 按标签分组（如果适用）
   */
  byTag?: Record<string, number>;

  /**
   * 最后注册时间
   */
  lastRegisteredAt?: Date;

  /**
   * 最后访问时间
   */
  lastAccessedAt?: Date;
}

/**
 * 带分类的注册表接口
 */
export interface ICategorizedRegistry<
  T extends IRegisterable & { category?: string },
> extends IRegistry<T> {
  /**
   * 按分类获取
   * @param category 分类
   */
  getByCategory(category: string): T[];

  /**
   * 获取所有分类
   */
  getCategories(): string[];
}

/**
 * 带标签的注册表接口
 */
export interface ITaggedRegistry<
  T extends IRegisterable & { tags?: string[] },
> extends IRegistry<T> {
  /**
   * 按标签获取
   * @param tag 标签
   */
  getByTag(tag: string): T[];

  /**
   * 按多个标签获取（AND）
   * @param tags 标签列表
   */
  getByTags(tags: string[]): T[];

  /**
   * 获取所有标签
   */
  getTags(): string[];
}

/**
 * 可搜索的注册表接口
 */
export interface ISearchableRegistry<
  T extends IRegisterable,
> extends IRegistry<T> {
  /**
   * 搜索
   * @param query 查询条件
   */
  search(query: SearchQuery): T[];

  /**
   * 按条件查找
   * @param predicate 条件函数
   */
  find(predicate: (item: T) => boolean): T | undefined;

  /**
   * 按条件过滤
   * @param predicate 条件函数
   */
  filter(predicate: (item: T) => boolean): T[];
}

/**
 * 搜索查询
 */
export interface SearchQuery {
  /**
   * 关键词
   */
  keyword?: string;

  /**
   * 分类
   */
  category?: string;

  /**
   * 标签
   */
  tags?: string[];

  /**
   * 分页
   */
  pagination?: {
    page: number;
    limit: number;
  };

  /**
   * 排序
   */
  sort?: {
    field: string;
    order: "asc" | "desc";
  };
}

/**
 * 可观察的注册表接口
 */
export interface IObservableRegistry<
  T extends IRegisterable,
> extends IRegistry<T> {
  /**
   * 订阅注册事件
   * @param listener 监听器
   */
  onRegister(listener: (item: T) => void): () => void;

  /**
   * 订阅注销事件
   * @param listener 监听器
   */
  onUnregister(listener: (id: string) => void): () => void;

  /**
   * 订阅清空事件
   * @param listener 监听器
   */
  onClear(listener: () => void): () => void;
}

/**
 * 工厂注册表接口
 * 支持延迟创建
 */
export interface IFactoryRegistry<T extends IRegisterable> {
  /**
   * 注册工厂
   * @param id 项 ID
   * @param factory 工厂函数
   */
  registerFactory(id: string, factory: () => T): void;

  /**
   * 创建实例
   * @param id 项 ID
   */
  create(id: string): T;

  /**
   * 获取或创建实例
   * @param id 项 ID
   */
  getOrCreate(id: string): T;

  /**
   * 检查工厂是否存在
   * @param id 项 ID
   */
  hasFactory(id: string): boolean;
}

/**
 * 基础注册表实现
 */
export abstract class BaseRegistry<
  T extends IRegisterable,
> implements IRegistry<T> {
  protected readonly items = new Map<string, T>();
  protected lastRegisteredAt?: Date;
  protected lastAccessedAt?: Date;

  register(item: T): void {
    if (this.items.has(item.id)) {
      throw new Error(`Item with id '${item.id}' already registered`);
    }
    this.items.set(item.id, item);
    this.lastRegisteredAt = new Date();
  }

  registerMany(items: T[]): void {
    for (const item of items) {
      this.register(item);
    }
  }

  get(id: string): T {
    const item = this.items.get(id);
    if (!item) {
      throw new Error(`Item with id '${id}' not found`);
    }
    this.lastAccessedAt = new Date();
    return item;
  }

  tryGet(id: string): T | undefined {
    const item = this.items.get(id);
    if (item) {
      this.lastAccessedAt = new Date();
    }
    return item;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  hasAll(ids: string[]): boolean {
    return ids.every((id) => this.has(id));
  }

  getAll(): T[] {
    return Array.from(this.items.values());
  }

  getAllIds(): string[] {
    return Array.from(this.items.keys());
  }

  unregister(id: string): boolean {
    return this.items.delete(id);
  }

  clear(): void {
    this.items.clear();
  }

  size(): number {
    return this.items.size;
  }

  getStats(): RegistryStats {
    return {
      total: this.items.size,
      lastRegisteredAt: this.lastRegisteredAt,
      lastAccessedAt: this.lastAccessedAt,
    };
  }
}
