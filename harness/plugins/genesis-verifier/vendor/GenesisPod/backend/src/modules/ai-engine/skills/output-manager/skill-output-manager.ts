/**
 * AI Engine - Skill Output Manager Implementation
 * 技能输出管理器实现
 *
 * 统一规范 Skill 输出的存储和读取
 */

import { Logger } from "@nestjs/common";
import {
  ISkillOutputManager,
  SkillOutputEntry,
  NormalizedSkillKey,
  SkillOutputManagerConfig,
  DEFAULT_SKILL_OUTPUT_CONFIG,
} from "./skill-output-manager.interface";

/**
 * Skill 输出管理器
 *
 * 核心规范：
 * 1. 所有 Skill ID 在存储时自动规范化
 * 2. 支持多种 ID 格式的读取（自动尝试规范化后查找）
 * 3. 同时维护规范化 Key 和别名映射
 */
export class SkillOutputManager implements ISkillOutputManager {
  private readonly logger = new Logger(SkillOutputManager.name);
  private readonly config: Required<SkillOutputManagerConfig>;

  /** 主存储：规范化 Key -> 输出条目 */
  private readonly _store = new Map<NormalizedSkillKey, SkillOutputEntry>();

  /** 别名映射：原始 ID -> 规范化 Key */
  private readonly _aliasMap = new Map<string, NormalizedSkillKey>();

  constructor(config?: SkillOutputManagerConfig) {
    this.config = {
      ...DEFAULT_SKILL_OUTPUT_CONFIG,
      ...config,
    };
  }

  /**
   * 存储 Skill 输出
   */
  store<T>(
    skillId: string,
    output: T,
    metadata?: Record<string, unknown>,
  ): void {
    const normalizedKey = this.normalizeKey(skillId);

    const entry: SkillOutputEntry<T> = {
      key: normalizedKey,
      originalSkillId: skillId,
      data: output,
      createdAt: new Date(),
      metadata,
    };

    // 存储到主存储
    this._store.set(normalizedKey, entry as SkillOutputEntry);

    // 建立别名映射
    this._aliasMap.set(skillId, normalizedKey);
    this._aliasMap.set(normalizedKey, normalizedKey);

    // 也为常见变体建立别名
    this.registerAliases(skillId, normalizedKey);

    if (this.config.debug) {
      this.logger.debug(
        `[store] Stored output for "${skillId}" -> normalized key: "${normalizedKey}"`,
      );
    }
  }

  /**
   * 获取 Skill 输出
   */
  get<T>(skillId: string): T | undefined {
    const entry = this.getEntry<T>(skillId);
    return entry?.data;
  }

  /**
   * 获取 Skill 输出条目
   */
  getEntry<T>(skillId: string): SkillOutputEntry<T> | undefined {
    // 1. 直接查找（可能已经是规范化 Key）
    if (this._store.has(skillId)) {
      return this._store.get(skillId) as SkillOutputEntry<T>;
    }

    // 2. 通过别名查找
    const aliasKey = this._aliasMap.get(skillId);
    if (aliasKey && this._store.has(aliasKey)) {
      return this._store.get(aliasKey) as SkillOutputEntry<T>;
    }

    // 3. 规范化后查找
    const normalizedKey = this.normalizeKey(skillId);
    if (this._store.has(normalizedKey)) {
      return this._store.get(normalizedKey) as SkillOutputEntry<T>;
    }

    // 4. 尝试带前缀的变体
    for (const prefix of this.config.knownPrefixes) {
      const prefixedKey = `${prefix}${normalizedKey}`;
      const prefixedAliasKey = this._aliasMap.get(prefixedKey);
      if (prefixedAliasKey && this._store.has(prefixedAliasKey)) {
        return this._store.get(prefixedAliasKey) as SkillOutputEntry<T>;
      }
    }

    if (this.config.debug) {
      this.logger.debug(
        `[get] Output not found for "${skillId}", tried: ${[skillId, aliasKey, normalizedKey].filter(Boolean).join(", ")}`,
      );
    }

    return undefined;
  }

  /**
   * 检查输出是否存在
   */
  has(skillId: string): boolean {
    return this.getEntry(skillId) !== undefined;
  }

  /**
   * 删除 Skill 输出
   */
  delete(skillId: string): boolean {
    const normalizedKey = this.normalizeKey(skillId);

    // 删除主存储
    const deleted = this._store.delete(normalizedKey);

    // 清理别名映射
    const aliasesToRemove: string[] = [];
    for (const [alias, key] of this._aliasMap.entries()) {
      if (key === normalizedKey) {
        aliasesToRemove.push(alias);
      }
    }
    for (const alias of aliasesToRemove) {
      this._aliasMap.delete(alias);
    }

    return deleted;
  }

  /**
   * 清空所有输出
   */
  clear(): void {
    this._store.clear();
    this._aliasMap.clear();
  }

  /**
   * 获取所有输出 Key
   */
  keys(): NormalizedSkillKey[] {
    return Array.from(this._store.keys());
  }

  /**
   * 获取所有输出
   */
  getAll(): Record<NormalizedSkillKey, unknown> {
    const result: Record<NormalizedSkillKey, unknown> = {};
    for (const [key, entry] of this._store.entries()) {
      result[key] = entry.data;
    }
    return result;
  }

  /**
   * 从普通对象导入
   */
  importFrom(outputs: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(outputs)) {
      if (value !== undefined) {
        this.store(key, value);
      }
    }
  }

  /**
   * 导出为普通对象（包含原始 key 和规范化 key）
   *
   * 为了向后兼容，同时返回：
   * - 规范化后的 key（如 "outline-planning"）
   * - 原始 skill ID（如 "slides-outline-planning"）
   */
  exportTo(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, entry] of this._store.entries()) {
      // 1. 规范化 key
      result[key] = entry.data;

      // 2. 原始 skill ID（向后兼容）
      if (entry.originalSkillId && entry.originalSkillId !== key) {
        result[entry.originalSkillId] = entry.data;
      }

      // 3. 带前缀的变体（确保 slides-xxx 格式可用）
      for (const prefix of this.config.knownPrefixes) {
        const prefixedKey = `${prefix}${key}`;
        if (!result[prefixedKey]) {
          result[prefixedKey] = entry.data;
        }
      }
    }

    return result;
  }

  /**
   * 规范化 Skill ID 为标准 Key
   */
  normalizeKey(skillId: string): NormalizedSkillKey {
    if (!skillId) {
      return "";
    }

    let key = skillId;

    // 1. 取逗号前的第一个 ID
    if (key.includes(",")) {
      key = key.split(",")[0];
    }

    // 2. trim 空白
    key = key.trim();

    // 3. 去除已知前缀
    for (const prefix of this.config.knownPrefixes) {
      if (key.startsWith(prefix)) {
        key = key.substring(prefix.length);
        break; // 只去除一个前缀
      }
    }

    // 4. 转为 kebab-case（如果包含驼峰或下划线）
    key = key
      .replace(/([a-z])([A-Z])/g, "$1-$2") // camelCase -> kebab-case
      .replace(/_/g, "-") // snake_case -> kebab-case
      .toLowerCase();

    return key;
  }

  /**
   * 为 Skill ID 注册常见别名
   */
  private registerAliases(
    originalId: string,
    normalizedKey: NormalizedSkillKey,
  ): void {
    // 1. 带前缀的变体
    for (const prefix of this.config.knownPrefixes) {
      this._aliasMap.set(`${prefix}${normalizedKey}`, normalizedKey);

      // 如果原始 ID 没有前缀，也注册带前缀版本
      if (!originalId.startsWith(prefix)) {
        this._aliasMap.set(`${prefix}${originalId}`, normalizedKey);
      }
    }

    // 2. 不带前缀的变体
    for (const prefix of this.config.knownPrefixes) {
      if (originalId.startsWith(prefix)) {
        const withoutPrefix = originalId.substring(prefix.length);
        this._aliasMap.set(withoutPrefix, normalizedKey);
      }
    }
  }

  /**
   * 获取调试信息
   */
  getDebugInfo(): {
    storeSize: number;
    aliasCount: number;
    entries: Array<{ key: string; originalId: string; dataType: string }>;
  } {
    return {
      storeSize: this._store.size,
      aliasCount: this._aliasMap.size,
      entries: Array.from(this._store.entries()).map(([key, entry]) => ({
        key,
        originalId: entry.originalSkillId,
        dataType: typeof entry.data,
      })),
    };
  }
}

/**
 * 创建 Skill 输出管理器
 */
export function createSkillOutputManager(
  config?: SkillOutputManagerConfig,
): ISkillOutputManager {
  return new SkillOutputManager(config);
}
