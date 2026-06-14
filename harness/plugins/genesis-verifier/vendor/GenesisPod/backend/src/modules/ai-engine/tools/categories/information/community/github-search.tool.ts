/**
 * GitHub Search Tool
 * GitHub 仓库搜索工具 - 用于 Topic Research 的开源项目数据源
 *
 * API 文档: https://docs.github.com/en/rest/search
 * 认证: GitHub Personal Access Token (可选但推荐)
 * 限速: 无 Token 10 req/hour, 有 Token 30 req/min
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../../abstractions/tool.interface";
import { PolicyDataService } from "../policy/policy-data.service";
import {
  formatDateYmd,
  resolveEffectiveTimeRange,
  resolveSearchTimeRangeSince,
  SEARCH_TIME_RANGE_VALUES,
  type SearchTimeRange,
} from "@/common/search/search-time-range";

// ============================================================================
// Types
// ============================================================================

/**
 * GitHub 搜索排序方式
 */
export type GithubSortType = "stars" | "forks" | "updated";

/**
 * 输入参数
 */
export interface GithubSearchInput {
  /** 搜索查询 */
  query: string;
  /** 最大结果数，默认 10 */
  maxResults?: number;
  /** 编程语言过滤 */
  language?: string;
  /** 排序方式 */
  sort?: GithubSortType;
  /** 搜索时间范围 */
  timeRange?: SearchTimeRange;
}

/**
 * GitHub 仓库所有者
 */
export interface GithubOwner {
  /** 用户名 */
  login: string;
  /** 头像 URL */
  avatarUrl: string;
}

/**
 * GitHub 仓库
 */
export interface GithubRepository {
  /** 仓库 ID */
  id: number;
  /** 仓库名 */
  name: string;
  /** 完整名称 (owner/repo) */
  fullName: string;
  /** 描述 */
  description: string;
  /** 仓库 URL */
  url: string;
  /** Star 数 */
  stars: number;
  /** Fork 数 */
  forks: number;
  /** 主要编程语言 */
  language: string;
  /** 主题标签 */
  topics: string[];
  /** 最后更新时间 */
  updatedAt: string;
  /** 所有者信息 */
  owner: GithubOwner;
}

/**
 * 输出结果
 */
export interface GithubSearchOutput {
  /** 仓库列表 */
  repositories: GithubRepository[];
  /** 结果总数 */
  totalCount: number;
  /** 搜索查询 */
  query: string;
}

// ============================================================================
// API Response Types
// ============================================================================

interface GithubApiResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GithubApiRepository[];
}

interface GithubApiRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  topics: string[];
  updated_at: string;
  owner: {
    login: string;
    avatar_url: string;
  };
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class GithubSearchTool extends BaseTool<
  GithubSearchInput,
  GithubSearchOutput
> {
  private readonly logger = new Logger(GithubSearchTool.name);

  readonly id = "github-search";
  readonly sideEffect = "none" as const;
  readonly name = "GitHub Repository Search";
  readonly description =
    "搜索 GitHub 开源项目仓库：按关键词、编程语言、Stars 数等条件查找。用于技术调研、开源项目分析、趋势追踪。";
  readonly category: ToolCategory = "information";
  readonly tags = ["github", "opensource", "research", "repository"];
  readonly defaultTimeout = 30000;

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "搜索查询，支持 GitHub 搜索语法，如 'machine learning', 'stars:>1000', 'language:python'",
      },
      maxResults: {
        type: "number",
        description: "最大结果数量，默认 10，最大 100",
        default: 10,
      },
      language: {
        type: "string",
        description: "编程语言过滤，如 JavaScript, Python, Go, Rust",
      },
      sort: {
        type: "string",
        enum: ["stars", "forks", "updated"],
        description:
          "排序方式：stars=按 Star 数排序，forks=按 Fork 数排序，updated=按更新时间排序",
        default: "stars",
      },
      timeRange: {
        type: "string",
        description:
          "搜索时间范围：30d=最近1个月，90d=最近3个月，180d=最近6个月，365d=最近12个月，730d=最近24个月，all=不限",
        enum: [...SEARCH_TIME_RANGE_VALUES],
        default: "all",
      },
    },
    required: ["query"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      repositories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "number" },
            name: { type: "string" },
            fullName: { type: "string" },
            description: { type: "string" },
            url: { type: "string" },
            stars: { type: "number" },
            forks: { type: "number" },
            language: { type: "string" },
            topics: { type: "array", items: { type: "string" } },
            updatedAt: { type: "string" },
            owner: {
              type: "object",
              properties: {
                login: { type: "string" },
                avatarUrl: { type: "string" },
              },
            },
          },
        },
      },
      totalCount: { type: "number" },
      query: { type: "string" },
    },
  };

  constructor(private readonly policyDataService: PolicyDataService) {
    super();
  }

  protected async doExecute(
    input: GithubSearchInput,
    context: ToolContext,
  ): Promise<GithubSearchOutput> {
    const { query, maxResults = 10, language, sort = "stars" } = input;
    const timeRange = resolveEffectiveTimeRange(
      input.timeRange,
      context.metadata,
    );

    this.logger.log(
      `[doExecute] Searching GitHub: query="${query}", language=${language}, sort=${sort}`,
    );

    // 获取 GitHub Token (可选, hoisted for catch block access)
    const token = await this.policyDataService.getApiKey("github-search");

    try {
      // 构建搜索查询
      let searchQuery = query;
      if (language) {
        searchQuery += ` language:${language}`;
      }
      const since = resolveSearchTimeRangeSince(timeRange);
      if (since) {
        searchQuery += ` pushed:>=${formatDateYmd(since)}`;
      }

      // 构建 API URL 和参数
      const baseUrl = "https://api.github.com/search/repositories";
      const params: Record<string, string | number | boolean | undefined> = {
        q: searchQuery,
        per_page: Math.min(maxResults, 100),
        sort,
        order: "desc",
      };

      // 构建 Headers
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      };

      // 如果有 Token，添加 Authorization Header
      if (token) {
        headers.Authorization = `Bearer ${token}`;
        this.logger.debug(
          "[doExecute] Using GitHub Token for authenticated request",
        );
      } else {
        this.logger.warn(
          "[doExecute] No GitHub Token found, using unauthenticated request (10 req/hour limit)",
        );
      }

      // 发送请求
      const response = await this.policyDataService.httpGet<GithubApiResponse>(
        baseUrl,
        params,
        headers,
      );

      // 检查是否触发限速
      if (!response?.items) {
        throw new Error("Invalid response from GitHub API");
      }

      // 转换结果
      const repositories: GithubRepository[] = (response.items || []).map(
        (repo) => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description || "",
          url: repo.html_url,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          language: repo.language || "Unknown",
          topics: repo.topics || [],
          updatedAt: repo.updated_at,
          owner: {
            login: repo.owner.login,
            avatarUrl: repo.owner.avatar_url,
          },
        }),
      );

      this.logger.log(
        `[doExecute] Found ${repositories.length} repositories (total: ${response.total_count})`,
      );

      // Mark key as healthy on success
      if (token) {
        this.policyDataService.clearKeyFailure("github-search", token);
      }

      return {
        repositories,
        totalCount: response.total_count,
        query: searchQuery,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Track key failure for multi-key rotation
      if (token) {
        const statusMatch = errorMessage.match(/\b(4\d{2}|5\d{2})\b/);
        const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 500;
        this.policyDataService.markKeyFailed(
          "github-search",
          token,
          statusCode,
        );
      }

      // 检查是否是限速错误
      if (errorMessage.includes("403") || errorMessage.includes("rate limit")) {
        this.logger.error(
          "[doExecute] GitHub API rate limit exceeded. Please add a GitHub Token for higher limits.",
        );
        throw new Error(
          "GitHub API 限速超出。请添加 GitHub Token 以提高限速上限（无 Token: 10 req/hour，有 Token: 30 req/min）",
        );
      }

      this.logger.error(`[doExecute] GitHub API error: ${error}`);
      throw new Error(`GitHub 搜索失败: ${errorMessage}`);
    }
  }

  validateInput(input: GithubSearchInput): boolean {
    // 必须有搜索查询
    return !!input.query && input.query.trim().length > 0;
  }
}
