/**
 * AI Skills API Service
 *
 * 提供 SkillsMP 数据的业务逻辑
 * 从数据库读取已同步的数据，或从 SkillsMP API 获取
 */

import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { APP_CONFIG } from "../../../../common/config/app.config";
import { SkillRegistry } from "../../../ai-engine/facade";

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  category: string;
  author: string;
  stars: number;
  downloads: string;
  tags: string[];
  featured: boolean;
  url: string;
  lastUpdated: string;
}

export interface SkillsStats {
  totalSkills: number;
  lastUpdated: string | null;
  weeklyGrowth: number;
  featuredCount: number;
  categoryCount: number;
}

export interface TimelineDataPoint {
  date: string;
  count: number;
  cumulative: number;
}

export interface SearchParams {
  query?: string;
  category?: string;
  sortBy?: "stars" | "downloads" | "name";
  limit?: number;
  offset?: number;
}

export interface SkillEffectiveness {
  usageCount: number;
  successCount: number;
  successRate: number;
  avgDuration: number | null;
}

export interface DomainSkillItem {
  skillId: string;
  displayName: string;
  description: string;
  layer: string | null;
  domain: string | null;
  enabled: boolean;
  tags: string[];
  source: string;
  effectiveness: SkillEffectiveness;
}

export interface DomainSkillsResponse {
  skills: DomainSkillItem[];
  stats: {
    total: number;
    enabled: number;
    byLayer: Record<string, number>;
  };
}

@Injectable()
export class SkillsService {
  private readonly logger = new Logger(SkillsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly skillRegistry: SkillRegistry,
  ) {}

  /**
   * 获取设置值
   */
  private async getSetting(key: string): Promise<unknown> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
    });
    if (!setting?.value) return null;
    try {
      return JSON.parse(setting.value);
    } catch {
      return setting.value;
    }
  }

  /**
   * 设置值
   */
  private async setSetting(key: string, value: unknown): Promise<void> {
    const stringValue =
      typeof value === "string" ? value : JSON.stringify(value);
    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value: stringValue },
      create: { key, value: stringValue },
    });
  }

  /**
   * 获取统计数据
   */
  async getStats(): Promise<SkillsStats> {
    const totalSkillsSetting = await this.getSetting("skillsmp.totalSkills");
    const totalSkills =
      typeof totalSkillsSetting === "number" ? totalSkillsSetting : 66541;

    const lastSyncSetting = await this.getSetting("skillsmp.lastSync");
    const lastSync =
      typeof lastSyncSetting === "string" ? lastSyncSetting : null;

    const skillsSetting = await this.getSetting("skillsmp.syncedSkills");
    const skills = Array.isArray(skillsSetting) ? skillsSetting : [];

    // Calculate featured count
    const featuredCount = skills.filter(
      (s: unknown): s is SkillItem => (s as SkillItem).featured,
    ).length;

    // Get unique categories
    const categories = new Set(
      skills.map((s: unknown) => (s as SkillItem).category),
    );

    return {
      totalSkills,
      lastUpdated: lastSync,
      weeklyGrowth: 12.5, // TODO: Calculate from timeline data
      featuredCount,
      categoryCount: categories.size,
    };
  }

  /**
   * 获取时间线数据
   */
  async getTimeline(): Promise<TimelineDataPoint[]> {
    // Try to get from stored data
    const storedTimeline = await this.getSetting("skillsmp.timeline");
    if (storedTimeline && Array.isArray(storedTimeline)) {
      return storedTimeline;
    }

    // Generate realistic trend data if not available
    const data: TimelineDataPoint[] = [];
    let cumulative = 0;
    const baseDate = new Date("2024-11-01");
    const counts = [
      2500, 3200, 4100, 5800, 7200, 9500, 12000, 18000, 28000, 38000, 45000,
      52000,
    ];

    for (let i = 0; i < counts.length; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + i * 7);
      const count = counts[i];
      cumulative += count;
      data.push({
        date: date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        count,
        cumulative,
      });
    }

    return data;
  }

  /**
   * 搜索 Skills
   */
  async searchSkills(params: SearchParams): Promise<{
    skills: SkillItem[];
    total: number;
  }> {
    let skills = ((await this.getSetting("skillsmp.syncedSkills")) ??
      []) as SkillItem[];

    if (!Array.isArray(skills)) {
      skills = [];
    }

    // Filter by query
    if (params.query) {
      const q = params.query.toLowerCase();
      skills = skills.filter(
        (skill) =>
          skill.name?.toLowerCase().includes(q) ||
          skill.description?.toLowerCase().includes(q) ||
          skill.tags?.some((t: string) => t.toLowerCase().includes(q)),
      );
    }

    // Filter by category
    if (params.category && params.category !== "all") {
      skills = skills.filter((skill) => skill.category === params.category);
    }

    // Sort
    const sortBy = params.sortBy || "stars";
    skills.sort((skillA, skillB) => {
      if (sortBy === "stars") {
        return (skillB.stars || 0) - (skillA.stars || 0);
      }
      if (sortBy === "downloads") {
        const parseDownloads = (d?: string) => {
          if (!d) return 0;
          return (
            parseFloat(d.replace(/[^0-9.]/g, "")) *
            (d.includes("M") ? 1000000 : d.includes("K") ? 1000 : 1)
          );
        };
        return (
          parseDownloads(skillB.downloads) - parseDownloads(skillA.downloads)
        );
      }
      return (skillA.name || "").localeCompare(skillB.name || "");
    });

    const total = skills.length;
    const offset = params.offset || 0;
    const limit = params.limit || 50;

    return {
      skills: skills.slice(offset, offset + limit),
      total,
    };
  }

  /**
   * 获取热门 Skills
   */
  async getPopularSkills(limit: number = 50): Promise<SkillItem[]> {
    const result = await this.searchSkills({ sortBy: "stars", limit });
    return result.skills;
  }

  /**
   * 获取精选 Skills
   */
  async getFeaturedSkills(limit: number = 20): Promise<SkillItem[]> {
    const skills = (await this.getSetting("skillsmp.syncedSkills")) ?? [];

    if (!Array.isArray(skills)) {
      return [];
    }

    return skills
      .filter((s: unknown) => (s as SkillItem).featured)
      .sort(
        (a: unknown, b: unknown) =>
          ((b as SkillItem).stars || 0) - ((a as SkillItem).stars || 0),
      )
      .slice(0, limit);
  }

  /**
   * 获取所有分类
   */
  async getCategories(): Promise<
    Array<{ id: string; name: string; count: number }>
  > {
    const skills = (await this.getSetting("skillsmp.syncedSkills")) ?? [];

    if (!Array.isArray(skills)) {
      return [];
    }

    const categoryMap = new Map<string, number>();
    for (const skill of skills) {
      const skillItem = skill as SkillItem;
      const category = skillItem.category || "other";
      categoryMap.set(category, (categoryMap.get(category) || 0) + 1);
    }

    return Array.from(categoryMap.entries()).map(([id, count]) => ({
      id,
      name: this.formatCategoryName(id),
      count,
    }));
  }

  /**
   * 格式化分类名称
   */
  private formatCategoryName(id: string): string {
    const names: Record<string, string> = {
      tools: "Tools",
      development: "Development",
      testing: "Testing",
      documentation: "Documentation",
      database: "Database",
      devops: "DevOps",
      security: "Security",
      "ai-agents": "AI Agents",
      other: "Other",
    };
    return names[id] || id.charAt(0).toUpperCase() + id.slice(1);
  }

  /**
   * 从 SkillsMP 同步数据
   */
  async syncFromSkillsMP(): Promise<{
    success: boolean;
    message: string;
    skillsCount?: number;
  }> {
    try {
      const apiKey = await this.getSetting("skillsmp.apiKey");

      if (!apiKey) {
        return {
          success: false,
          message: "未配置 SkillsMP API Key",
        };
      }

      this.logger.log("Starting SkillsMP sync...");

      // ★ Fetch ALL skills from SkillsMP API using pagination
      const allSkills: unknown[] = [];
      const seenIds = new Set<string>();
      let totalFromApi = 0;
      const pageSize = 100; // Max per page
      let offset = 0;
      let hasMore = true;

      // Helper function to extract skills from response
      const extractSkills = (data: unknown): unknown[] => {
        const response = data as Record<string, unknown>;
        const dataField = response.data as
          | Record<string, unknown>
          | unknown[]
          | undefined;

        if (Array.isArray(dataField)) return dataField;
        if (dataField && typeof dataField === "object") {
          const skills = dataField.skills;
          const items = dataField.items;
          if (Array.isArray(skills)) return skills;
          if (Array.isArray(items)) return items;
        }
        if (Array.isArray(response.skills)) return response.skills as unknown[];
        if (Array.isArray(response.results))
          return response.results as unknown[];
        return [];
      };

      // Paginate through all skills
      while (hasMore) {
        try {
          // ★ 使用不同的 API 端点尝试获取数据
          // 1. 首先尝试 list 端点（不需要 search query）
          // 2. 如果失败，尝试带通配符的 search
          const endpoints = [
            `https://skillsmp.com/api/v1/skills?limit=${pageSize}&offset=${offset}`,
            `https://skillsmp.com/api/v1/skills/list?limit=${pageSize}&offset=${offset}`,
            `https://skillsmp.com/api/v1/skills/search?limit=${pageSize}&offset=${offset}`,
          ];

          let response: Response | null = null;
          let usedEndpoint = "";

          for (const endpoint of endpoints) {
            try {
              response = await fetch(endpoint, {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                  "User-Agent": APP_CONFIG.brand.userAgent,
                  Accept: "application/json",
                },
              });

              if (response.ok) {
                usedEndpoint = endpoint;
                break;
              } else if (offset === 0) {
                // 只在第一次请求时记录失败的端点
                this.logger.debug(
                  `SkillsMP endpoint ${endpoint.split("?")[0]} returned ${response.status}`,
                );
              }
            } catch (endpointError) {
              // 继续尝试下一个端点
            }
          }

          if (!response) {
            this.logger.warn(
              `SkillsMP: all endpoints threw exceptions at offset ${offset}`,
            );
            hasMore = false;
            break;
          }

          // ★ 修复：处理所有端点都返回非 200 状态的情况
          if (!response.ok) {
            // 尝试读取错误信息
            let errorBody = "";
            try {
              errorBody = await response.text();
            } catch {
              // ignore
            }
            const errorMsg =
              `SkillsMP API 请求失败: ${response.status} ${response.statusText}. ` +
              `请检查 API Key 是否有效，或联系 SkillsMP 支持确认 API 端点。`;
            this.logger.error(errorMsg);
            this.logger.debug(`Response body: ${errorBody.substring(0, 500)}`);

            // 返回明确的错误信息给用户
            return {
              success: false,
              message: errorMsg,
              skillsCount: 0,
            };
          }

          if (offset === 0 && usedEndpoint) {
            this.logger.log(
              `SkillsMP using endpoint: ${usedEndpoint.split("?")[0]}`,
            );
          }

          // 此时 response.ok 一定为 true（非 ok 情况已在上面提前返回）
          const data = await response.json();
          const skills = extractSkills(data);

          // Capture total count from pagination
          if (totalFromApi === 0) {
            const responseData = data as Record<string, unknown>;
            const dataField = responseData.data as
              | Record<string, unknown>
              | undefined;
            const metaField = responseData.meta as
              | Record<string, unknown>
              | undefined;
            const paginationField = dataField?.pagination as
              | Record<string, unknown>
              | undefined;

            totalFromApi =
              (paginationField?.total as number) ||
              (metaField?.total as number) ||
              (responseData.total as number) ||
              0;
            this.logger.log(
              `SkillsMP total skills in platform: ${totalFromApi}`,
            );
          }

          if (skills.length === 0) {
            hasMore = false;
            break;
          }

          // Deduplicate and add skills
          for (const skill of skills) {
            const skillData = skill as Record<string, unknown>;
            const id =
              (skillData.id as string | undefined) ||
              (skillData.name as string | undefined)
                ?.toLowerCase()
                .replace(/\s+/g, "-");
            if (id && !seenIds.has(id)) {
              seenIds.add(id);
              allSkills.push(skill);
            }
          }

          this.logger.log(
            `SkillsMP page ${Math.floor(offset / pageSize) + 1}: fetched ${skills.length} skills, total collected: ${allSkills.length}`,
          );

          offset += pageSize;

          // Stop if we've reached the total or fetched less than page size
          if (skills.length < pageSize || allSkills.length >= totalFromApi) {
            hasMore = false;
          }

          // Rate limiting: small delay between requests
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (pageError) {
          this.logger.warn(
            `SkillsMP pagination error at offset ${offset}: ${pageError}`,
          );
          hasMore = false;
        }
      }

      this.logger.log(
        `SkillsMP total unique skills collected: ${allSkills.length}`,
      );

      // Transform and store skills
      const skills = this.transformSkillsData(allSkills);

      await this.setSetting("skillsmp.syncedSkills", skills);
      await this.setSetting("skillsmp.lastSync", new Date().toISOString());
      // Store total from API (platform total), not just synced count
      await this.setSetting(
        "skillsmp.totalSkills",
        totalFromApi || skills.length,
      );

      // Fetch and store timeline data if available
      try {
        const timelineResponse = await fetch(
          "https://skillsmp.com/api/v1/stats/timeline",
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
          },
        );

        if (timelineResponse.ok) {
          const timelineData = await timelineResponse.json();
          if (timelineData.timeline) {
            await this.setSetting("skillsmp.timeline", timelineData.timeline);
          }
        }
      } catch (timelineError) {
        this.logger.warn("Failed to fetch timeline data, using generated data");
      }

      this.logger.log(`SkillsMP sync completed: ${skills.length} skills`);

      return {
        success: true,
        message: `成功同步 ${skills.length} 个 Skills`,
        skillsCount: skills.length,
      };
    } catch (error) {
      this.logger.error(`SkillsMP sync failed: ${(error as Error).message}`);
      return {
        success: false,
        message: `同步失败: ${(error as Error).message}`,
      };
    }
  }

  /**
   * 转换 SkillsMP API 数据格式
   */
  private transformSkillsData(rawSkills: unknown[]): SkillItem[] {
    return rawSkills.map((skill, index) => {
      const skillData = skill as Record<string, unknown>;
      const tags = skillData.tags as string[] | undefined;
      const firstTag = tags?.[0];
      const stars =
        (skillData.stars as number | undefined) ||
        (skillData.rating as number | undefined) ||
        0;

      return {
        id:
          (skillData.id as string | undefined) ||
          (skillData.name as string | undefined)
            ?.toLowerCase()
            .replace(/\s+/g, "-") ||
          `skill-${index}`,
        name: (skillData.name as string | undefined) || "Unknown Skill",
        description: (skillData.description as string | undefined) || "",
        category: this.mapCategory(
          (skillData.category as string | undefined) || firstTag || "other",
        ),
        author:
          (skillData.author as string | undefined) ||
          (skillData.owner as string | undefined) ||
          "unknown",
        stars,
        downloads: this.formatDownloads(
          (skillData.downloads as number | undefined) || 0,
        ),
        tags: tags || [],
        featured:
          (skillData.featured as boolean | undefined) || stars > 10000 || false,
        url:
          (skillData.url as string | undefined) ||
          (skillData.github_url as string | undefined) ||
          `https://skillsmp.com/skills/${skillData.id}`,
        lastUpdated:
          (skillData.updated_at as string | undefined) ||
          (skillData.lastUpdated as string | undefined) ||
          new Date().toISOString(),
      };
    });
  }

  /**
   * 映射分类
   */
  private mapCategory(category: string): string {
    const categoryMap: Record<string, string> = {
      tool: "tools",
      tools: "tools",
      dev: "development",
      development: "development",
      test: "testing",
      testing: "testing",
      docs: "documentation",
      documentation: "documentation",
      db: "database",
      database: "database",
      ops: "devops",
      devops: "devops",
      ci: "devops",
      cd: "devops",
      security: "security",
      sec: "security",
      ai: "ai-agents",
      agent: "ai-agents",
      "ai-agents": "ai-agents",
      llm: "ai-agents",
    };

    return categoryMap[category.toLowerCase()] || "other";
  }

  /**
   * 格式化下载数
   */
  private formatDownloads(count: number): string {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M+`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(0)}K+`;
    }
    return `${count}+`;
  }

  // ==================== Domain Skills API ====================

  /**
   * 获取指定领域的 Skills
   * 包含 domain-specific + general skills + effectiveness 数据
   */
  async getSkillsByDomain(domain: string): Promise<DomainSkillsResponse> {
    // 1. 获取 SkillConfig 中属于该 domain 或 general 的技能
    const skillConfigs = await this.prisma.skillConfig.findMany({
      where: {
        OR: [
          { domain },
          { domain: "general" },
          { domain: "common" },
          { domain: null },
        ],
      },
    });

    // 2. 也从 SkillRegistry 获取已注册但可能没有 SkillConfig 的技能
    const domainSet = new Set([domain, "general", "common"]);
    const registrySkills = Array.from(domainSet).flatMap((d) =>
      this.skillRegistry.getByDomain(d),
    );

    // 3. 合并去重，以 SkillConfig 为主
    const configSkillIds = new Set(skillConfigs.map((c) => c.skillId));
    const allSkillIds = new Set<string>(configSkillIds);
    for (const skill of registrySkills) {
      allSkillIds.add(skill.id);
    }

    // 4. 批量查询 effectiveness
    const effectivenessMap = await this.getSkillEffectiveness(
      Array.from(allSkillIds),
    );

    // 5. 构建返回数据
    const skills: DomainSkillItem[] = [];
    const byLayer: Record<string, number> = {};

    for (const skillId of allSkillIds) {
      const config = skillConfigs.find((c) => c.skillId === skillId);
      const registrySkill = this.skillRegistry.tryGet(skillId);

      // allowedDomains enforcement: 与 resolveSkillsForAgent 对齐
      if (
        config?.allowedDomains &&
        config.allowedDomains.length > 0 &&
        !config.allowedDomains.includes(domain)
      ) {
        continue;
      }

      // 检查 domain override
      const domainOverrides = (config?.config as Record<string, unknown>)
        ?.domainOverrides as Record<string, { enabled: boolean }> | undefined;
      const domainOverride = domainOverrides?.[domain];
      const isEnabled = domainOverride
        ? domainOverride.enabled
        : (config?.enabled ?? true);

      const layer = config?.layer ?? registrySkill?.layer ?? null;
      const skillDomain = config?.domain ?? registrySkill?.domain ?? null;

      const item: DomainSkillItem = {
        skillId,
        displayName: config?.displayName ?? registrySkill?.name ?? skillId,
        description: config?.description ?? registrySkill?.description ?? "",
        layer,
        domain: skillDomain,
        enabled: isEnabled,
        tags: config?.tags ?? registrySkill?.tags ?? [],
        source: registrySkill ? "local" : "config",
        effectiveness: effectivenessMap.get(skillId) ?? {
          usageCount: 0,
          successCount: 0,
          successRate: 0,
          avgDuration: null,
        },
      };
      skills.push(item);

      // Count by layer
      const layerKey = layer ?? "unknown";
      byLayer[layerKey] = (byLayer[layerKey] ?? 0) + 1;
    }

    return {
      skills,
      stats: {
        total: skills.length,
        enabled: skills.filter((s) => s.enabled).length,
        byLayer,
      },
    };
  }

  /**
   * 批量获取 Skill effectiveness 数据
   * 使用 groupBy 避免 N+1 查询
   */
  async getSkillEffectiveness(
    skillIds: string[],
  ): Promise<Map<string, SkillEffectiveness>> {
    const result = new Map<string, SkillEffectiveness>();

    if (skillIds.length === 0) {
      return result;
    }

    try {
      const grouped = await this.prisma.aIUsageLog.groupBy({
        by: ["capabilityId"],
        where: {
          capabilityType: "skill",
          capabilityId: { in: skillIds },
        },
        _count: { id: true },
        _avg: { duration: true },
      });

      // 另外查询成功次数
      const successGrouped = await this.prisma.aIUsageLog.groupBy({
        by: ["capabilityId"],
        where: {
          capabilityType: "skill",
          capabilityId: { in: skillIds },
          success: true,
        },
        _count: { id: true },
      });

      const successMap = new Map<string, number>();
      for (const item of successGrouped) {
        successMap.set(item.capabilityId, item._count.id);
      }

      for (const item of grouped) {
        const usageCount = item._count.id;
        const successCount = successMap.get(item.capabilityId) ?? 0;
        const successRate =
          usageCount > 0 ? Math.round((successCount / usageCount) * 100) : 0;

        result.set(item.capabilityId, {
          usageCount,
          successCount,
          successRate,
          avgDuration: item._avg.duration ?? null,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Failed to query skill effectiveness: ${(error as Error).message}`,
      );
    }

    return result;
  }

  /**
   * 设置 Skill 的 domain-specific override
   * 使用 config JSON 字段存储 domainOverrides
   */
  async setSkillDomainOverride(
    skillId: string,
    domain: string,
    enabled: boolean,
  ): Promise<void> {
    // 查找或创建 SkillConfig
    const existing = await this.prisma.skillConfig.findUnique({
      where: { skillId },
    });

    if (existing) {
      const config = (existing.config as Record<string, unknown>) ?? {};
      const domainOverrides =
        (config.domainOverrides as Record<string, unknown>) ?? {};
      domainOverrides[domain] = { enabled };
      config.domainOverrides = domainOverrides;

      await this.prisma.skillConfig.update({
        where: { skillId },
        data: { config: config as Prisma.InputJsonValue },
      });
    } else {
      // 从 registry 获取信息创建 config
      const registrySkill = this.skillRegistry.tryGet(skillId);
      await this.prisma.skillConfig.create({
        data: {
          skillId,
          enabled: true,
          displayName: registrySkill?.name ?? skillId,
          description: registrySkill?.description ?? "",
          domain: registrySkill?.domain ?? "general",
          layer: registrySkill?.layer ?? null,
          tags: registrySkill?.tags ?? [],
          config: {
            domainOverrides: {
              [domain]: { enabled },
            },
          } as Prisma.InputJsonValue,
        },
      });
    }

    this.logger.log(
      `Set skill domain override: ${skillId} -> ${domain}: enabled=${enabled}`,
    );
  }
}
