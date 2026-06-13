import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { RawDataService } from "@/modules/ai-app/explore/rawdata/rawdata.service";
import { DeduplicationService } from "./deduplication.service";
import { getErrorStack } from "../../../../../common/utils/error.utils";
import axios from "axios";
import { APP_CONFIG } from "../../../../../common/config/app.config";
import { Prisma } from "@prisma/client";

/**
 * GitHub 项目采集器
 *
 * 关键功能：
 * 1. 存储完整信息到 MongoDB raw_data 集合
 * 2. 建立 raw_data ↔ resource 的引用关系
 * 3. 实现去重逻辑（基于 GitHub repo URL）
 * 4. 解析所有字段（名称、描述、星标、语言、README等）
 */
@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);
  private readonly GITHUB_API_URL = "https://api.github.com";
  private readonly githubToken: string;

  constructor(
    private prisma: PrismaService,
    private rawData: RawDataService,
    private dedup: DeduplicationService,
    private config: ConfigService,
  ) {
    this.githubToken = this.config.get<string>("GITHUB_TOKEN") || "";
    if (!this.githubToken || this.githubToken.startsWith("your_")) {
      this.logger.warn(
        "GitHub token not configured, API rate limit will be very low",
      );
    }
  }

  /**
   * 获取 GitHub 趋势项目
   * @param language 编程语言（可选）
   * @param since 时间范围：daily, weekly, monthly
   */
  async fetchTrendingRepos(
    language?: string,
    since: "daily" | "weekly" | "monthly" = "daily",
  ): Promise<number> {
    this.logger.log(
      `Fetching GitHub trending repos (language: ${language || "all"}, since: ${since})`,
    );

    try {
      // GitHub Trending 没有官方 API，使用 GitHub Search API 作为替代
      // 搜索最近创建且星标最多的项目
      const dateThreshold = this.getDateThreshold(since);

      let query = `created:>${dateThreshold} stars:>50`;
      if (language) {
        query += ` language:${language}`;
      }

      const params = {
        q: query,
        sort: "stars",
        order: "desc",
        per_page: 30,
      };

      const response = await axios.get(
        `${this.GITHUB_API_URL}/search/repositories`,
        {
          params,
          ...this.getAxiosConfig(),
        },
      );

      const repos = response.data.items || [];
      this.logger.log(`Found ${repos.length} trending repositories`);

      let successCount = 0;
      for (const repo of repos) {
        try {
          await this.processRepository(repo);
          successCount++;
        } catch (error) {
          this.logger.error(
            `Failed to process repo: ${repo.full_name}`,
            getErrorStack(error),
          );
        }
      }

      this.logger.log(
        `Successfully processed ${successCount}/${repos.length} repos`,
      );
      return successCount;
    } catch (error) {
      this.logger.error(
        "Failed to fetch GitHub trending repos",
        getErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * 搜索 GitHub 项目
   */
  async searchRepositories(query: string, maxResults = 10): Promise<number> {
    this.logger.log(`Searching GitHub repos: "${query}"`);

    try {
      const params = {
        q: query,
        sort: "stars",
        order: "desc",
        per_page: maxResults,
      };

      const response = await axios.get(
        `${this.GITHUB_API_URL}/search/repositories`,
        {
          params,
          ...this.getAxiosConfig(),
        },
      );

      const repos = response.data.items || [];

      let successCount = 0;
      for (const repo of repos) {
        try {
          await this.processRepository(repo);
          successCount++;
        } catch (error) {
          this.logger.error(`Failed to process repo`, getErrorStack(error));
        }
      }

      return successCount;
    } catch (error) {
      this.logger.error("Search failed", getErrorStack(error));
      throw error;
    }
  }

  /**
   * 处理单个仓库
   */
  private async processRepository(
    repo: Record<string, unknown>,
  ): Promise<void> {
    const repoFullName =
      typeof repo.full_name === "string" ? repo.full_name : "";
    if (!repoFullName) {
      this.logger.warn("Repository missing full_name, skipping");
      return;
    }

    // 层级1去重：检查同源是否已存在（GitHub 内部去重）
    const existingRawData = await this.rawData.findRawDataByExternalId(
      "github",
      repoFullName,
    );

    if (existingRawData) {
      this.logger.debug(
        `Repo already exists in GitHub source: ${repoFullName}`,
      );
      return;
    }

    // 层级2去重：跨源检查 - 使用 externalId（防止同一项目从不同源采集）
    const crossSourceDuplicate =
      await this.rawData.findRawDataByExternalIdAcrossAllSources(repoFullName);

    if (crossSourceDuplicate) {
      const source = (crossSourceDuplicate as { source?: string }).source;
      this.logger.debug(
        `Repo already exists from another source: ${repoFullName} (source: ${source})`,
      );
      return;
    }

    // 层级3去重：URL 去重（防止同一链接从不同源采集）
    const repoUrl = typeof repo.html_url === "string" ? repo.html_url : "";

    if (repoUrl) {
      const normalizedUrl = this.dedup.normalizeUrl(repoUrl);
      const urlDuplicate =
        await this.rawData.findRawDataByUrlAcrossAllSources(normalizedUrl);

      if (urlDuplicate) {
        const source = (urlDuplicate as { source?: string }).source;
        this.logger.debug(
          `Repo already exists with same URL: ${normalizedUrl} (source: ${source})`,
        );
        return;
      }
    }

    // 层级4去重：标题相似度检查（使用项目名称）
    const repoName = typeof repo.name === "string" ? repo.name : "";
    const repoDescription =
      typeof repo.description === "string" ? repo.description : "";
    const titleText = `${repoName} ${repoDescription}`.trim();

    if (titleText) {
      const similarTitles =
        await this.rawData.findRawDataByTitleAcrossAllSources(titleText);

      for (const similar of similarTitles) {
        const similarData = similar as {
          data?: { name?: unknown; description?: unknown; title?: unknown };
          source?: string;
        };
        const similarName =
          typeof similarData.data?.name === "string"
            ? similarData.data.name
            : "";
        const similarDescription =
          typeof similarData.data?.description === "string"
            ? similarData.data.description
            : "";
        const similarTitleStr =
          typeof similarData.data?.title === "string"
            ? similarData.data.title
            : "";

        const similarTitle =
          similarName && similarDescription
            ? `${similarName} ${similarDescription}`
            : similarTitleStr;

        if (this.dedup.areTitlesSimilar(titleText, similarTitle, 0.9)) {
          this.logger.debug(
            `Repo already exists with similar title/description (source: ${similarData.source}, similarity threshold: 0.9)`,
          );
          return;
        }
      }
    }

    // 获取完整的仓库信息（包括 README）
    const ownerLogin =
      typeof repo.owner === "object" &&
      repo.owner !== null &&
      "login" in repo.owner &&
      typeof repo.owner.login === "string"
        ? repo.owner.login
        : "";
    if (!ownerLogin || !repoName) {
      this.logger.warn("Repository missing owner or name, skipping");
      return;
    }
    const fullRepoData = await this.fetchFullRepositoryData(
      ownerLogin,
      repoName,
    );

    // 解析完整的原始数据
    const rawData = this.parseRawData(fullRepoData, repoFullName);

    // 1. 存储完整原始数据到 MongoDB
    const rawDataId = await this.rawData.insertRawData("github", rawData);

    this.logger.log(
      `Stored raw data in MongoDB: ${repoFullName} -> ${rawDataId}`,
    );

    // 2. 提取结构化数据并存储到 PostgreSQL
    const resourceData = this.extractResourceData(rawData, rawDataId);

    const resource = await this.prisma.resource.create({
      data: resourceData,
    });

    this.logger.log(
      `Created resource in PostgreSQL: ${resource.id} with rawDataId: ${rawDataId}`,
    );

    // 3. ⚠️ 关键：建立双向引用
    // 3.1 MongoDB → PostgreSQL (resourceId)
    await this.rawData.linkResourceToRawData(rawDataId, resource.id);

    // 3.2 验证引用同步成功
    const linkedRawData = await this.rawData.findRawDataById(rawDataId);
    const linkedResourceId = (linkedRawData as { resourceId?: string })
      ?.resourceId;
    if (linkedResourceId !== resource.id) {
      this.logger.error(
        `Reference sync failed for repo ${repoFullName}: MongoDB resourceId=${linkedResourceId}, expected ${resource.id}`,
      );
      throw new Error(
        `Failed to establish bi-directional reference for resource ${resource.id}`,
      );
    }

    this.logger.log(
      `✅ Reference sync completed: MongoDB(${rawDataId}) ↔ PostgreSQL(${resource.id})`,
    );
  }

  /**
   * 获取完整的仓库数据（包括 README、languages 等）
   */
  private async fetchFullRepositoryData(
    owner: string,
    repo: string,
  ): Promise<Record<string, unknown>> {
    try {
      const axiosConfig = this.getAxiosConfig();
      // 并行获取多个数据
      const [repoData, readmeData, languagesData, contributorsData] =
        await Promise.allSettled([
          axios.get(
            `${this.GITHUB_API_URL}/repos/${owner}/${repo}`,
            axiosConfig,
          ),
          this.fetchReadme(owner, repo),
          axios.get(
            `${this.GITHUB_API_URL}/repos/${owner}/${repo}/languages`,
            axiosConfig,
          ),
          axios.get(
            `${this.GITHUB_API_URL}/repos/${owner}/${repo}/contributors`,
            {
              ...axiosConfig,
              params: { per_page: 5 },
            },
          ),
        ]);

      const data: Record<string, unknown> = {
        ...(repoData.status === "fulfilled"
          ? (repoData.value.data as Record<string, unknown>)
          : {}),
        readme: readmeData.status === "fulfilled" ? readmeData.value : null,
        languages:
          languagesData.status === "fulfilled"
            ? (languagesData.value.data as Record<string, unknown>)
            : {},
        contributors:
          contributorsData.status === "fulfilled"
            ? (contributorsData.value.data as unknown[])
            : [],
      };

      return data;
    } catch (error) {
      this.logger.error(
        `Failed to fetch full repo data for ${owner}/${repo}`,
        getErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * 获取 README 内容
   */
  private async fetchReadme(
    owner: string,
    repo: string,
  ): Promise<string | null> {
    try {
      const response = await axios.get(
        `${this.GITHUB_API_URL}/repos/${owner}/${repo}/readme`,
        {
          ...this.getAxiosConfig(),
          headers: {
            ...this.getHeaders(),
            Accept: "application/vnd.github.v3.raw", // 获取原始内容
          },
        },
      );

      return response.data;
    } catch (error) {
      this.logger.debug(`No README found for ${owner}/${repo}`);
      return null;
    }
  }

  /**
   * 解析完整的原始数据（存储到 MongoDB）
   *
   * ⚠️ 关键：存储所有字段，包括 README、contributors 等！
   */
  private parseRawData(
    repoData: Record<string, unknown>,
    repoFullName: string,
  ): Record<string, unknown> {
    return {
      // 外部 ID（用于去重）
      externalId: repoFullName,

      // 基础信息
      id: repoData.id,
      name: repoData.name,
      fullName: repoData.full_name,
      owner:
        typeof repoData.owner === "object" && repoData.owner !== null
          ? {
              login: (repoData.owner as Record<string, unknown>).login,
              id: (repoData.owner as Record<string, unknown>).id,
              avatarUrl: (repoData.owner as Record<string, unknown>).avatar_url,
              url: (repoData.owner as Record<string, unknown>).url,
              type: (repoData.owner as Record<string, unknown>).type,
            }
          : null,

      // 描述和文档
      description: repoData.description,
      readme: repoData.readme, // ⚠️ 完整 README

      // URL 信息
      htmlUrl: repoData.html_url,
      homepage: repoData.homepage,
      cloneUrl: repoData.clone_url,
      gitUrl: repoData.git_url,

      // 统计数据
      stargazersCount: repoData.stargazers_count,
      watchersCount: repoData.watchers_count,
      forksCount: repoData.forks_count,
      openIssuesCount: repoData.open_issues_count,

      // 语言信息（完整）
      language: repoData.language,
      languages: repoData.languages, // ⚠️ 所有语言的字节数统计

      // 主题标签
      topics: Array.isArray(repoData.topics) ? repoData.topics : [],

      // 许可证
      license:
        typeof repoData.license === "object" && repoData.license !== null
          ? {
              key: (repoData.license as Record<string, unknown>).key,
              name: (repoData.license as Record<string, unknown>).name,
              spdxId: (repoData.license as Record<string, unknown>).spdx_id,
            }
          : null,

      // 时间信息
      createdAt: repoData.created_at,
      updatedAt: repoData.updated_at,
      pushedAt: repoData.pushed_at,

      // 贡献者信息（前5名）
      contributors: Array.isArray(repoData.contributors)
        ? repoData.contributors
        : [],

      // 其他元数据
      size: repoData.size,
      defaultBranch: repoData.default_branch,
      isPrivate: repoData.private,
      isFork: repoData.fork,
      isArchived: repoData.archived,
      isTemplate: repoData.is_template,
      hasIssues: repoData.has_issues,
      hasProjects: repoData.has_projects,
      hasWiki: repoData.has_wiki,
      hasPages: repoData.has_pages,
      hasDownloads: repoData.has_downloads,

      // 原始数据（完整保存）
      _raw: repoData,

      // 采集时间
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * 从原始数据提取结构化数据（存储到 PostgreSQL）
   *
   * ⚠️ 关键：建立 rawDataId 引用关系！
   */
  private extractResourceData(
    rawData: Record<string, unknown>,
    rawDataId: string,
  ): Prisma.ResourceCreateInput {
    // 计算质量评分（基于 stars, forks, 活跃度）
    const qualityScore = this.calculateQualityScore(rawData);

    // 提取README：完整保留，不截断
    // 如果README过大（>500KB），则截断以避免性能问题
    // 但对大多数项目，README通常在50-200KB之间
    const MAX_README_SIZE = 500 * 1024; // 500KB限制
    let readmeContent: string | null =
      typeof rawData.readme === "string" ? rawData.readme : null;
    if (readmeContent && readmeContent.length > MAX_README_SIZE) {
      const fullName =
        typeof rawData.fullName === "string" ? rawData.fullName : "unknown";
      this.logger.warn(
        `README for ${fullName} exceeds size limit (${readmeContent.length}/${MAX_README_SIZE} bytes), truncating`,
      );
      readmeContent = readmeContent.substring(0, MAX_README_SIZE);
    }

    const owner =
      typeof rawData.owner === "object" && rawData.owner !== null
        ? (rawData.owner as Record<string, unknown>)
        : {};
    const ownerLogin = typeof owner.login === "string" ? owner.login : "";
    const ownerUrl = typeof owner.url === "string" ? owner.url : "";
    const ownerType = typeof owner.type === "string" ? owner.type : "";

    return {
      type: "PROJECT",

      // 基础信息
      title: typeof rawData.fullName === "string" ? rawData.fullName : "",
      abstract:
        typeof rawData.description === "string" ? rawData.description : "",
      content: readmeContent, // 完整README内容（无10KB限制）
      sourceUrl: typeof rawData.htmlUrl === "string" ? rawData.htmlUrl : "",
      codeUrl: typeof rawData.cloneUrl === "string" ? rawData.cloneUrl : "",

      // 作者/组织
      authors: [
        {
          name: ownerLogin,
          url: ownerUrl,
          type: ownerType,
        },
      ],
      organizations: ownerType === "Organization" ? [ownerLogin] : null,

      // 发布时间
      publishedAt: new Date(
        typeof rawData.createdAt === "string" ? rawData.createdAt : Date.now(),
      ),

      // 分类和标签
      primaryCategory:
        typeof rawData.language === "string" ? rawData.language : "Unknown",
      categories:
        typeof rawData.languages === "object" && rawData.languages !== null
          ? Object.keys(rawData.languages as Record<string, unknown>)
          : [],
      tags: [
        ...(Array.isArray(rawData.topics) ? rawData.topics : []),
        rawData.language,
      ].filter(Boolean),

      // 统计数据
      viewCount:
        typeof rawData.watchersCount === "number" ? rawData.watchersCount : 0,
      saveCount:
        typeof rawData.stargazersCount === "number"
          ? rawData.stargazersCount
          : 0,
      upvoteCount:
        typeof rawData.stargazersCount === "number"
          ? rawData.stargazersCount
          : 0,

      // 评分
      qualityScore: qualityScore,
      trendingScore: this.calculateTrendingScore(rawData),

      // 元数据
      metadata: {
        githubId: rawData.id,
        fullName: rawData.fullName,
        license: rawData.license,
        forks: rawData.forksCount,
        openIssues: rawData.openIssuesCount,
        homepage: rawData.homepage,
        topics: rawData.topics,
        contributors: Array.isArray(rawData.contributors)
          ? rawData.contributors.map((c: unknown) => {
              const contrib =
                typeof c === "object" && c !== null
                  ? (c as Record<string, unknown>)
                  : {};
              return {
                login: contrib.login,
                contributions: contrib.contributions,
              };
            })
          : [],
        updatedAt: rawData.updatedAt,
        pushedAt: rawData.pushedAt,
      } as Prisma.InputJsonValue,

      // ⚠️ 关键！MongoDB 原始数据引用
      rawDataId: rawDataId,
    } as Prisma.ResourceCreateInput;
  }

  /**
   * 计算质量评分（0-100）
   */
  private calculateQualityScore(rawData: Record<string, unknown>): number {
    const stars =
      typeof rawData.stargazersCount === "number" ? rawData.stargazersCount : 0;
    const forks =
      typeof rawData.forksCount === "number" ? rawData.forksCount : 0;
    const hasReadme = !!rawData.readme;
    const hasLicense = !!rawData.license;
    const pushedAt =
      typeof rawData.pushedAt === "string" ? rawData.pushedAt : "";
    const recentActivity = this.isRecentlyActive(pushedAt);

    // 加权计算
    let score = 0;
    score += Math.min(stars / 100, 50); // 最多50分
    score += Math.min(forks / 50, 20); // 最多20分
    score += hasReadme ? 10 : 0;
    score += hasLicense ? 10 : 0;
    score += recentActivity ? 10 : 0;

    return Math.min(Math.round(score), 100);
  }

  /**
   * 计算趋势评分
   */
  private calculateTrendingScore(rawData: Record<string, unknown>): number {
    const stars =
      typeof rawData.stargazersCount === "number" ? rawData.stargazersCount : 0;
    const createdAt =
      typeof rawData.createdAt === "string" ? rawData.createdAt : "";
    const pushedAt =
      typeof rawData.pushedAt === "string" ? rawData.pushedAt : "";
    const daysSinceCreation = this.getDaysSince(createdAt);
    const daysSinceUpdate = this.getDaysSince(pushedAt);

    // 增长速度（stars per day）
    const starsPerDay = daysSinceCreation > 0 ? stars / daysSinceCreation : 0;

    // 活跃度惩罚（超过30天未更新降低评分）
    const activityPenalty = daysSinceUpdate > 30 ? 0.5 : 1.0;

    return starsPerDay * activityPenalty * 100;
  }

  /**
   * 检查是否最近活跃（30天内）
   */
  private isRecentlyActive(pushedAt: string): boolean {
    if (!pushedAt || typeof pushedAt !== "string") return false;
    const daysSince = this.getDaysSince(pushedAt);
    return daysSince <= 30;
  }

  /**
   * 获取距今天数
   */
  private getDaysSince(dateString: string): number {
    if (!dateString || typeof dateString !== "string")
      return Number.MAX_SAFE_INTEGER;
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return Number.MAX_SAFE_INTEGER;
    const now = new Date();
    return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  }

  /**
   * 获取日期阈值
   */
  private getDateThreshold(since: string): string {
    const now = new Date();
    const daysAgo = since === "daily" ? 1 : since === "weekly" ? 7 : 30;
    const date = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    return date.toISOString().split("T")[0]; // YYYY-MM-DD
  }

  /**
   * 获取请求头
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": APP_CONFIG.brand.userAgent,
    };

    if (this.githubToken && !this.githubToken.startsWith("your_")) {
      headers.Authorization = `token ${this.githubToken}`;
    }

    return headers;
  }

  /**
   * 获取 axios 请求配置
   */
  private getAxiosConfig(): {
    headers: Record<string, string>;
    timeout: number;
  } {
    return {
      headers: this.getHeaders(),
      timeout: 30000, // 30秒超时
    };
  }
}
