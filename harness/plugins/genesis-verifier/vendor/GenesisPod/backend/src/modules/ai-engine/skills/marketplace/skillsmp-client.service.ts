/**
 * AI Engine - SkillsMP Client Service
 *
 * 与 SkillsMP 生态系统集成
 * 支持搜索、获取和安装远程 Skills
 *
 * SkillsMP: https://skillsmp.com
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  SkillMdDefinition,
  SkillSearchResult,
  SkillFilters,
  SkillUpdateInfo,
} from "../types/skill-md.types";
import { SkillCacheService } from "../loader/caching/skill-cache.service";
import { parseSkillMd } from "../loader/parsing/skill-parser";
import { APP_CONFIG } from "@/common/config/app.config";

/**
 * SkillsMP API 配置
 */
interface SkillsMPConfig {
  /** API 基础 URL */
  baseUrl: string;
  /** API 密钥（可选） */
  apiKey?: string;
  /** 请求超时（毫秒） */
  timeout: number;
  /** 重试次数 */
  maxRetries: number;
}

const DEFAULT_CONFIG: SkillsMPConfig = {
  baseUrl: "https://skillsmp.com/api",
  timeout: 10000,
  maxRetries: 3,
};

/**
 * API 响应类型
 */
interface SkillsMPSearchResponse {
  skills: SkillSearchResult[];
  total: number;
  page: number;
  pageSize: number;
}

interface SkillsMPSkillResponse {
  id: string;
  name: string;
  author: string;
  version: string;
  content: string;
  downloads: number;
  rating: number;
  tags: string[];
  updatedAt: string;
}

@Injectable()
export class SkillsMPClientService {
  private readonly logger = new Logger(SkillsMPClientService.name);

  /** 配置 */
  private config: SkillsMPConfig;

  /** 是否启用（某些环境可能禁用远程访问） */
  private enabled: boolean = true;

  /** 最大 Skill 内容大小（100KB） */
  private readonly MAX_SKILL_SIZE = 100 * 1024;

  /** 危险的内容模式（XSS 防护） */
  private readonly DANGEROUS_PATTERNS: RegExp[] = [
    /<script[^>]*>[\s\S]*?<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi, // onclick, onerror 等
    /<iframe/gi,
    /<embed/gi,
    /<object/gi,
    /data:\s*text\/html/gi,
  ];

  /** 重试配置 */
  private readonly BASE_DELAY_MS = 1000;
  private readonly MAX_DELAY_MS = 30000;

  constructor(private readonly cacheService: SkillCacheService) {
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * 配置客户端
   */
  configure(config: Partial<SkillsMPConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 启用/禁用客户端
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 搜索 Skills
   */
  async searchSkills(
    query: string,
    filters?: SkillFilters,
  ): Promise<SkillSearchResult[]> {
    if (!this.enabled) {
      this.logger.debug("SkillsMP client is disabled");
      return [];
    }

    const params = new URLSearchParams();
    params.set("q", query);

    if (filters) {
      if (filters.domain) params.set("domain", filters.domain);
      if (filters.tags?.length) params.set("tags", filters.tags.join(","));
      if (filters.author) params.set("author", filters.author);
      if (filters.minRating) params.set("minRating", String(filters.minRating));
      if (filters.sortBy) params.set("sortBy", filters.sortBy);
      if (filters.sortOrder) params.set("sortOrder", filters.sortOrder);
      if (filters.limit) params.set("limit", String(filters.limit));
      if (filters.offset) params.set("offset", String(filters.offset));
    }

    try {
      const response = await this.fetchWithRetry<SkillsMPSearchResponse>(
        `/skills/search?${params.toString()}`,
      );

      return response.skills;
    } catch (error) {
      this.logger.error(
        `Failed to search SkillsMP: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * 获取 Skill 详情
   *
   * 安全措施：
   * - 验证内容大小限制
   * - 验证字符编码和清理危险字符
   * - 扫描 XSS 攻击模式
   * - 验证 Skill ID 一致性
   * - 验证内容格式有效性
   */
  async getSkill(skillId: string): Promise<SkillMdDefinition | null> {
    if (!this.enabled) {
      this.logger.debug("SkillsMP client is disabled");
      return null;
    }

    // 先检查缓存
    const cached = await this.cacheService.get(skillId);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.fetchWithRetry<SkillsMPSkillResponse>(
        `/skills/${skillId}`,
      );

      // 安全检查 1: 验证内容大小
      if (response.content.length > this.MAX_SKILL_SIZE) {
        this.logger.warn(
          `[Security] Skill content exceeds size limit: ${skillId} (${response.content.length} > ${this.MAX_SKILL_SIZE})`,
        );
        throw new Error(
          `Skill content exceeds size limit: ${response.content.length} > ${this.MAX_SKILL_SIZE}`,
        );
      }

      // 安全检查 2: 验证内容不为空
      if (!response.content || response.content.trim().length === 0) {
        this.logger.warn(`[Security] Empty skill content: ${skillId}`);
        throw new Error(`Empty skill content for: ${skillId}`);
      }

      // 安全检查 3: 清理内容并扫描危险模式
      const sanitizedContent = this.sanitizeContent(response.content);
      this.scanForDangerousPatterns(sanitizedContent, skillId);

      // 解析 Skill 内容
      const skill = parseSkillMd(sanitizedContent);

      // 安全检查 4: 验证 Skill ID 一致性
      if (skill.metadata.id !== skillId && skill.metadata.name !== skillId) {
        this.logger.warn(
          `[Security] Skill ID mismatch: expected ${skillId}, got ${skill.metadata.id}/${skill.metadata.name}`,
        );
        throw new Error(
          `Skill ID mismatch: expected ${skillId}, got ${skill.metadata.id}`,
        );
      }

      // 安全检查 5: 验证必需字段存在
      if (!skill.metadata.name || !skill.metadata.description) {
        this.logger.warn(
          `[Security] Skill missing required fields: ${skillId}`,
        );
        throw new Error(`Skill missing required fields: ${skillId}`);
      }

      // 缓存结果
      await this.cacheService.set(skillId, skill);

      this.logger.debug(`Successfully fetched and validated skill: ${skillId}`);
      return skill;
    } catch (error) {
      this.logger.error(
        `Failed to get skill ${skillId} from SkillsMP: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 清理内容（移除 BOM、控制字符、过长行）
   */
  private sanitizeContent(content: string): string {
    // 1. 移除 BOM
    let sanitized = content.replace(/^\uFEFF/, "");

    // 2. 移除危险的控制字符（保留换行、制表符）
    sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");

    // 3. 限制单行长度（防止 ReDoS 攻击）
    const lines = sanitized
      .split("\n")
      .map((line) =>
        line.length > 10000 ? line.slice(0, 10000) + "..." : line,
      );

    return lines.join("\n");
  }

  /**
   * 扫描危险模式（XSS 防护）
   */
  private scanForDangerousPatterns(content: string, skillId: string): void {
    for (const pattern of this.DANGEROUS_PATTERNS) {
      // 重置正则表达式状态
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        this.logger.warn(
          `[Security] Skill contains dangerous pattern: ${skillId} (matched: ${pattern.source})`,
        );
        throw new Error(
          `Skill content contains potentially dangerous code: ${skillId}`,
        );
      }
    }
  }

  /**
   * 安装 Skill 到本地缓存
   */
  async installSkill(skillId: string): Promise<boolean> {
    const skill = await this.getSkill(skillId);
    if (!skill) {
      return false;
    }

    // 持久化到本地
    await this.cacheService.set(skillId, skill, true);

    this.logger.log(`Installed skill from SkillsMP: ${skillId}`);
    return true;
  }

  /**
   * 检查 Skills 更新
   */
  async checkUpdates(
    installedSkills: Array<{ id: string; version: string }>,
  ): Promise<SkillUpdateInfo[]> {
    if (!this.enabled || installedSkills.length === 0) {
      return [];
    }

    try {
      const response = await this.fetchWithRetry<{
        updates: SkillUpdateInfo[];
      }>("/skills/check-updates", {
        method: "POST",
        body: JSON.stringify({ skills: installedSkills }),
      });

      return response.updates;
    } catch (error) {
      this.logger.error(`Failed to check updates: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * 获取热门 Skills
   */
  async getPopularSkills(
    domain?: string,
    limit: number = 10,
  ): Promise<SkillSearchResult[]> {
    if (!this.enabled) {
      return [];
    }

    const params = new URLSearchParams();
    params.set("sortBy", "downloads");
    params.set("sortOrder", "desc");
    params.set("limit", String(limit));
    if (domain) params.set("domain", domain);

    try {
      const response = await this.fetchWithRetry<SkillsMPSearchResponse>(
        `/skills/popular?${params.toString()}`,
      );

      return response.skills;
    } catch (error) {
      this.logger.error(
        `Failed to get popular skills: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * 获取推荐 Skills（基于已安装的 Skills）
   */
  async getRecommendedSkills(
    installedSkillIds: string[],
    limit: number = 5,
  ): Promise<SkillSearchResult[]> {
    if (!this.enabled || installedSkillIds.length === 0) {
      return [];
    }

    try {
      const response = await this.fetchWithRetry<{
        skills: SkillSearchResult[];
      }>("/skills/recommend", {
        method: "POST",
        body: JSON.stringify({ installed: installedSkillIds, limit }),
      });

      return response.skills;
    } catch (error) {
      this.logger.error(
        `Failed to get recommended skills: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * 带重试的 fetch 请求（指数退避 + 抖动）
   *
   * 安全措施：
   * - 指数退避：1s, 2s, 4s, 8s... (上限 30s)
   * - 随机抖动：防止"雷鸣羊群"问题
   * - 智能重试：只重试 5xx、429、408 错误
   */
  private async fetchWithRetry<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeout,
        );

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "User-Agent": APP_CONFIG.brand.userAgent,
        };

        if (this.config.apiKey) {
          headers["Authorization"] = `Bearer ${this.config.apiKey}`;
        }

        const response = await fetch(url, {
          ...options,
          headers: { ...headers, ...options.headers },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const shouldRetry = this.shouldRetryStatus(response.status);
          const errorMsg = `HTTP ${response.status}: ${response.statusText}`;

          if (!shouldRetry) {
            // 4xx 客户端错误（除 429, 408），不重试
            throw new Error(`${errorMsg} (non-retryable)`);
          }

          // 5xx 或可重试错误
          throw new Error(errorMsg);
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error as Error;

        // 不可重试的错误，直接抛出
        if (lastError.message.includes("non-retryable")) {
          throw lastError;
        }

        // 计算指数退避延迟 + 随机抖动
        if (attempt < this.config.maxRetries - 1) {
          const exponentialDelay = Math.min(
            this.BASE_DELAY_MS * Math.pow(2, attempt),
            this.MAX_DELAY_MS,
          );
          const jitter = Math.random() * exponentialDelay * 0.3; // 30% 抖动
          const delay = Math.round(exponentialDelay + jitter);

          this.logger.debug(
            `SkillsMP request failed (attempt ${attempt + 1}/${this.config.maxRetries}): ${lastError.message}, retrying in ${delay}ms`,
          );

          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          this.logger.error(
            `SkillsMP request failed after ${this.config.maxRetries} attempts: ${lastError.message}`,
          );
        }
      }
    }

    throw lastError || new Error("Unknown error");
  }

  /**
   * 判断 HTTP 状态码是否应该重试
   */
  private shouldRetryStatus(status: number): boolean {
    // 重试：5xx 服务器错误、429 限流、408 超时
    if (status >= 500) return true;
    if (status === 429) return true; // Too Many Requests
    if (status === 408) return true; // Request Timeout

    // 不重试：其他 4xx 客户端错误
    return false;
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    try {
      await this.fetchWithRetry<{ status: string }>("/health");
      return true;
    } catch {
      return false;
    }
  }
}
