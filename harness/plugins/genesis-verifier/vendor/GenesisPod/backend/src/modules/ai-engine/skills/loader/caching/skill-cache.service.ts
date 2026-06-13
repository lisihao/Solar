/**
 * AI Engine - Skill Cache Service
 *
 * 负责缓存远程 Skills（来自 SkillsMP 或自定义 URL）
 * 支持内存缓存和文件持久化
 */

import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import { SkillMdDefinition, SkillCacheItem } from "../../types/skill-md.types";
import { parseSkillMd, serializeSkillMd } from "../parsing/skill-parser";

/**
 * 缓存配置
 */
interface CacheConfig {
  /** 缓存过期时间（毫秒） */
  ttl: number;
  /** 最大缓存数量 */
  maxSize: number;
  /** 持久化目录 */
  persistDir?: string;
}

const DEFAULT_CONFIG: CacheConfig = {
  ttl: 24 * 60 * 60 * 1000, // 24 小时
  maxSize: 100,
  persistDir: undefined,
};

@Injectable()
export class SkillCacheService {
  private readonly logger = new Logger(SkillCacheService.name);

  /** 内存缓存 */
  private cache: Map<string, SkillCacheItem> = new Map();

  /** 配置 */
  private config: CacheConfig;

  /** 持久化目录 */
  private persistDir: string | null = null;

  constructor() {
    this.config = { ...DEFAULT_CONFIG };

    // 设置默认持久化目录
    this.persistDir = path.resolve(__dirname, "../../../../cached/skills");
  }

  /**
   * 配置缓存
   */
  configure(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.persistDir) {
      this.persistDir = config.persistDir;
    }
  }

  /**
   * 获取缓存的 Skill
   */
  async get(skillId: string): Promise<SkillMdDefinition | null> {
    // 1. 检查内存缓存
    const cached = this.cache.get(skillId);
    if (cached) {
      // 检查是否过期
      if (new Date() < cached.expiresAt) {
        cached.hitCount++;
        return cached.skill;
      }
      // 已过期，删除
      this.cache.delete(skillId);
    }

    // 2. 检查持久化缓存
    if (this.persistDir) {
      try {
        const persistedSkill = await this.loadFromDisk(skillId);
        if (persistedSkill) {
          // 加载到内存缓存
          this.setMemoryCache(skillId, persistedSkill);
          return persistedSkill;
        }
      } catch (error) {
        this.logger.debug(
          `Failed to load persisted skill ${skillId}: ${(error as Error).message}`,
        );
      }
    }

    return null;
  }

  /**
   * 设置缓存
   */
  async set(
    skillId: string,
    skill: SkillMdDefinition,
    persist: boolean = true,
  ): Promise<void> {
    // 检查缓存大小限制
    if (this.cache.size >= this.config.maxSize) {
      this.evictLeastUsed();
    }

    // 设置内存缓存
    this.setMemoryCache(skillId, skill);

    // 持久化到磁盘
    if (persist && this.persistDir) {
      try {
        await this.saveToDisk(skillId, skill);
      } catch (error) {
        this.logger.warn(
          `Failed to persist skill ${skillId}: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * 设置内存缓存
   */
  private setMemoryCache(skillId: string, skill: SkillMdDefinition): void {
    const now = new Date();
    const cacheItem: SkillCacheItem = {
      skill,
      cachedAt: now,
      expiresAt: new Date(now.getTime() + this.config.ttl),
      hitCount: 0,
    };
    this.cache.set(skillId, cacheItem);
  }

  /**
   * 删除缓存
   */
  async delete(skillId: string): Promise<boolean> {
    const deleted = this.cache.delete(skillId);

    // 删除持久化文件
    if (this.persistDir) {
      try {
        const filePath = this.getSkillFilePath(skillId);
        await fs.unlink(filePath);
      } catch {
        // 文件不存在，忽略
      }
    }

    return deleted;
  }

  /**
   * 清空所有缓存
   */
  async clear(): Promise<void> {
    this.cache.clear();

    // 清空持久化目录
    if (this.persistDir) {
      try {
        const files = await fs.readdir(this.persistDir);
        for (const file of files) {
          if (file.endsWith(".skill.md")) {
            await fs.unlink(path.join(this.persistDir, file));
          }
        }
      } catch {
        // 目录不存在，忽略
      }
    }
  }

  /**
   * 检查是否存在缓存
   */
  has(skillId: string): boolean {
    const cached = this.cache.get(skillId);
    if (cached && new Date() < cached.expiresAt) {
      return true;
    }
    return false;
  }

  /**
   * 获取缓存统计
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    totalHits: number;
  } {
    let totalHits = 0;
    for (const item of this.cache.values()) {
      totalHits += item.hitCount;
    }

    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hitRate: this.cache.size > 0 ? totalHits / this.cache.size : 0,
      totalHits,
    };
  }

  /**
   * 淘汰最少使用的缓存项
   */
  private evictLeastUsed(): void {
    let leastUsedKey: string | null = null;
    let leastHits = Infinity;

    for (const [key, item] of this.cache) {
      if (item.hitCount < leastHits) {
        leastHits = item.hitCount;
        leastUsedKey = key;
      }
    }

    if (leastUsedKey) {
      this.cache.delete(leastUsedKey);
      this.logger.debug(`Evicted least used skill: ${leastUsedKey}`);
    }
  }

  /**
   * 获取 Skill 文件路径
   */
  private getSkillFilePath(skillId: string): string {
    return path.join(this.persistDir!, `${skillId}.skill.md`);
  }

  /**
   * 从磁盘加载 Skill
   */
  private async loadFromDisk(
    skillId: string,
  ): Promise<SkillMdDefinition | null> {
    if (!this.persistDir) {
      return null;
    }

    const filePath = this.getSkillFilePath(skillId);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const skill = parseSkillMd(content, filePath);
      return skill;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.debug(`Failed to load skill from disk: ${skillId}`);
      }
      return null;
    }
  }

  /**
   * 保存 Skill 到磁盘
   */
  private async saveToDisk(
    skillId: string,
    skill: SkillMdDefinition,
  ): Promise<void> {
    if (!this.persistDir) {
      return;
    }

    // 确保目录存在
    await fs.mkdir(this.persistDir, { recursive: true });

    const filePath = this.getSkillFilePath(skillId);
    const content = serializeSkillMd(skill);

    await fs.writeFile(filePath, content, "utf-8");
    this.logger.debug(`Persisted skill to disk: ${skillId}`);
  }

  /**
   * 预热缓存（加载所有持久化的 Skills）
   */
  async warmup(): Promise<number> {
    if (!this.persistDir) {
      return 0;
    }

    let loaded = 0;

    try {
      const files = await fs.readdir(this.persistDir);

      for (const file of files) {
        if (file.endsWith(".skill.md")) {
          const skillId = file.replace(".skill.md", "");
          const skill = await this.loadFromDisk(skillId);
          if (skill) {
            this.setMemoryCache(skillId, skill);
            loaded++;
          }
        }
      }
    } catch {
      // 目录不存在，忽略
    }

    this.logger.log(`Cache warmup: loaded ${loaded} skills from disk`);
    return loaded;
  }
}
