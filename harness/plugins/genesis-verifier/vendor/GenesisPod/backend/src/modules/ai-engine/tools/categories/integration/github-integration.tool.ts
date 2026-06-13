/**
 * GitHub Integration Tool
 * GitHub 集成工具 - 支持创建 Issue、PR、查看仓库等操作
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";

// ============================================================================
// Types
// ============================================================================

export type GitHubOperation =
  | "CREATE_ISSUE"
  | "UPDATE_ISSUE"
  | "CLOSE_ISSUE"
  | "CREATE_PR"
  | "MERGE_PR"
  | "CREATE_COMMENT"
  | "GET_REPO"
  | "LIST_BRANCHES"
  | "LIST_COMMITS"
  | "GET_FILE"
  | "CREATE_FILE"
  | "UPDATE_FILE";

export interface GitHubIntegrationInput {
  /**
   * 操作类型
   */
  operation: GitHubOperation;

  /**
   * 仓库所有者
   */
  owner: string;

  /**
   * 仓库名称
   */
  repo: string;

  /**
   * 操作数据
   */
  data?: {
    // Issue/PR 相关
    title?: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
    issueNumber?: number;
    prNumber?: number;

    // Branch 相关
    branch?: string;
    baseBranch?: string;
    headBranch?: string;

    // File 相关
    path?: string;
    content?: string;
    message?: string;
    sha?: string;

    // Comment 相关
    commentBody?: string;
  };

  /**
   * 认证配置
   */
  auth?: {
    /**
     * GitHub Token
     */
    token?: string;

    /**
     * GitHub Enterprise URL
     */
    baseUrl?: string;
  };
}

export interface GitHubIntegrationOutput {
  /**
   * 操作是否成功
   */
  success: boolean;

  /**
   * 操作类型
   */
  operation: GitHubOperation;

  /**
   * 返回的数据
   */
  data?: {
    // 通用字段
    id?: number;
    url?: string;
    htmlUrl?: string;

    // Issue/PR
    number?: number;
    state?: string;
    title?: string;

    // Repo
    fullName?: string;
    description?: string;
    defaultBranch?: string;
    stars?: number;
    forks?: number;

    // Branch
    branches?: Array<{ name: string; protected: boolean }>;

    // Commits
    commits?: Array<{
      sha: string;
      message: string;
      author: string;
      date: string;
    }>;

    // File
    content?: string;
    sha?: string;
  };

  /**
   * 错误信息
   */
  error?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class GitHubIntegrationTool extends BaseTool<
  GitHubIntegrationInput,
  GitHubIntegrationOutput
> {
  private readonly logger = new Logger(GitHubIntegrationTool.name);

  readonly id = "github-integration";
  readonly sideEffect = "destructive" as const;
  readonly category: ToolCategory = "integration";
  readonly tags = ["integration", "github", "git", "repository", "vcs"];
  readonly name = "GitHub 集成";
  readonly description =
    "与 GitHub 仓库交互，支持创建/管理 Issue 和 PR、查看仓库信息、管理文件等操作。适用于代码协作、项目管理等场景。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description: "操作类型",
        enum: [
          "CREATE_ISSUE",
          "UPDATE_ISSUE",
          "CLOSE_ISSUE",
          "CREATE_PR",
          "MERGE_PR",
          "CREATE_COMMENT",
          "GET_REPO",
          "LIST_BRANCHES",
          "LIST_COMMITS",
          "GET_FILE",
          "CREATE_FILE",
          "UPDATE_FILE",
        ],
      },
      owner: {
        type: "string",
        description: "仓库所有者（用户名或组织名）",
      },
      repo: {
        type: "string",
        description: "仓库名称",
      },
      data: {
        type: "object",
        description: "操作相关数据",
        properties: {
          title: { type: "string", description: "Issue/PR 标题" },
          body: { type: "string", description: "Issue/PR 内容" },
          labels: {
            type: "array",
            description: "标签列表",
            items: { type: "string" },
          },
          assignees: {
            type: "array",
            description: "指派人列表",
            items: { type: "string" },
          },
          issueNumber: { type: "number", description: "Issue 编号" },
          prNumber: { type: "number", description: "PR 编号" },
          branch: { type: "string", description: "分支名称" },
          baseBranch: { type: "string", description: "基础分支" },
          headBranch: { type: "string", description: "源分支" },
          path: { type: "string", description: "文件路径" },
          content: { type: "string", description: "文件内容" },
          message: { type: "string", description: "提交信息" },
          sha: { type: "string", description: "文件 SHA（更新时需要）" },
          commentBody: { type: "string", description: "评论内容" },
        },
      },
      auth: {
        type: "object",
        description: "认证配置",
        properties: {
          token: {
            type: "string",
            description: "GitHub Personal Access Token",
          },
          baseUrl: {
            type: "string",
            description: "GitHub Enterprise URL（可选）",
          },
        },
      },
    },
    required: ["operation", "owner", "repo"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: { type: "boolean", description: "操作是否成功" },
      operation: { type: "string", description: "操作类型" },
      data: {
        type: "object",
        description: "返回的数据",
      },
      error: { type: "string", description: "错误信息" },
    },
  };

  constructor() {
    super();
    // defaultTimeout set in class property // 60 秒超时
  }

  validateInput(input: GitHubIntegrationInput) {
    if (!input.operation || !input.owner || !input.repo) {
      return false;
    }

    // 验证操作相关的必填字段
    const { operation, data } = input;

    switch (operation) {
      case "CREATE_ISSUE":
      case "CREATE_PR":
        if (!data?.title) return false;
        break;
      case "UPDATE_ISSUE":
      case "CLOSE_ISSUE":
        if (!data?.issueNumber) return false;
        break;
      case "MERGE_PR":
        if (!data?.prNumber) return false;
        break;
      case "CREATE_COMMENT":
        if (!data?.issueNumber || !data?.commentBody) return false;
        break;
      case "GET_FILE":
      case "CREATE_FILE":
      case "UPDATE_FILE":
        if (!data?.path) return false;
        break;
    }

    return true;
  }

  protected async doExecute(
    input: GitHubIntegrationInput,
    _context: ToolContext,
  ): Promise<GitHubIntegrationOutput> {
    const { operation, owner, repo, data } = input;

    this.logger.log(
      `[doExecute] GitHub operation: ${operation} on ${owner}/${repo}`,
    );

    try {
      // 模拟 GitHub API 调用
      // 实际实现时应该使用 @octokit/rest 或 axios 调用 GitHub API
      const result = await this.executeOperation(operation, owner, repo, data);

      return {
        success: true,
        operation,
        data: result,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`[doExecute] GitHub operation failed: ${errorMessage}`);

      return {
        success: false,
        operation,
        error: errorMessage,
      };
    }
  }

  private async executeOperation(
    operation: GitHubOperation,
    owner: string,
    repo: string,
    data?: GitHubIntegrationInput["data"],
  ): Promise<GitHubIntegrationOutput["data"]> {
    // 模拟延迟
    await new Promise((resolve) => setTimeout(resolve, 500));

    switch (operation) {
      case "CREATE_ISSUE":
        return {
          id: Math.floor(Math.random() * 10000),
          number: Math.floor(Math.random() * 1000),
          url: `https://api.github.com/repos/${owner}/${repo}/issues/${Math.floor(Math.random() * 1000)}`,
          htmlUrl: `https://github.com/${owner}/${repo}/issues/${Math.floor(Math.random() * 1000)}`,
          state: "open",
          title: data?.title,
        };

      case "CREATE_PR":
        return {
          id: Math.floor(Math.random() * 10000),
          number: Math.floor(Math.random() * 1000),
          url: `https://api.github.com/repos/${owner}/${repo}/pulls/${Math.floor(Math.random() * 1000)}`,
          htmlUrl: `https://github.com/${owner}/${repo}/pull/${Math.floor(Math.random() * 1000)}`,
          state: "open",
          title: data?.title,
        };

      case "GET_REPO":
        return {
          id: Math.floor(Math.random() * 10000000),
          fullName: `${owner}/${repo}`,
          description: "A sample repository",
          defaultBranch: "main",
          stars: Math.floor(Math.random() * 10000),
          forks: Math.floor(Math.random() * 1000),
          url: `https://api.github.com/repos/${owner}/${repo}`,
          htmlUrl: `https://github.com/${owner}/${repo}`,
        };

      case "LIST_BRANCHES":
        return {
          branches: [
            { name: "main", protected: true },
            { name: "develop", protected: false },
            { name: "feature/example", protected: false },
          ],
        };

      case "LIST_COMMITS":
        return {
          commits: [
            {
              sha: "abc123def456",
              message: "Initial commit",
              author: "developer",
              date: new Date().toISOString(),
            },
            {
              sha: "def456ghi789",
              message: "Add new feature",
              author: "developer",
              date: new Date().toISOString(),
            },
          ],
        };

      case "GET_FILE":
        return {
          content: "# Sample File Content",
          sha: "abc123def456",
          url: `https://api.github.com/repos/${owner}/${repo}/contents/${data?.path}`,
        };

      case "CREATE_FILE":
      case "UPDATE_FILE":
        return {
          sha: "new123sha456",
          url: `https://api.github.com/repos/${owner}/${repo}/contents/${data?.path}`,
          htmlUrl: `https://github.com/${owner}/${repo}/blob/main/${data?.path}`,
        };

      case "UPDATE_ISSUE":
      case "CLOSE_ISSUE":
        return {
          number: data?.issueNumber,
          state: operation === "CLOSE_ISSUE" ? "closed" : "open",
          url: `https://api.github.com/repos/${owner}/${repo}/issues/${data?.issueNumber}`,
        };

      case "MERGE_PR":
        return {
          number: data?.prNumber,
          state: "merged",
          sha: "merged123sha",
        };

      case "CREATE_COMMENT":
        return {
          id: Math.floor(Math.random() * 10000),
          url: `https://api.github.com/repos/${owner}/${repo}/issues/comments/${Math.floor(Math.random() * 10000)}`,
        };

      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
  }
}
