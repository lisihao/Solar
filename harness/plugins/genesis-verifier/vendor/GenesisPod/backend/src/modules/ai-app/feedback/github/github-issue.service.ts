/**
 * GitHub Issue Service
 *
 * 自动创建 GitHub Issue 以触发 Claude Code 自动修复
 *
 * 流程：
 * 1. Triage Agent 判定 auto_fix
 * 2. 创建 GitHub Issue (带特定标签)
 * 3. GitHub Actions 检测到 Issue 并触发 Claude Code
 * 4. Claude Code 创建 PR
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Octokit } from "@octokit/rest";
import type { TriageDecision } from "../triage/triage-decision.types";
import { APP_CONFIG } from "../../../../common/config/app.config";

interface CreateIssueResult {
  success: boolean;
  issueNumber?: number;
  issueUrl?: string;
  error?: string;
}

// 默认值从 APP_CONFIG 获取
const DEFAULT_GITHUB_OWNER = APP_CONFIG.github.owner;
const DEFAULT_GITHUB_REPO = APP_CONFIG.github.repo;

@Injectable()
export class GitHubIssueService {
  private readonly logger = new Logger(GitHubIssueService.name);
  private readonly octokit: Octokit | null;
  private readonly owner: string;
  private readonly repo: string;
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const token = this.configService.get<string>("GITHUB_TOKEN");
    this.owner =
      this.configService.get<string>("GITHUB_OWNER") || DEFAULT_GITHUB_OWNER;
    this.repo =
      this.configService.get<string>("GITHUB_REPO") || DEFAULT_GITHUB_REPO;
    this.enabled =
      this.configService.get<string>("AUTO_FIX_GITHUB_ENABLED") === "true";

    if (token) {
      this.octokit = new Octokit({ auth: token });
      this.logger.log(
        `GitHub Issue Service initialized for ${this.owner}/${this.repo}`,
      );
    } else {
      this.octokit = null;
      this.logger.warn(
        "GitHub Issue Service not configured - missing GITHUB_TOKEN",
      );
    }
  }

  /**
   * 检查服务是否可用
   */
  isEnabled(): boolean {
    return this.enabled && this.octokit !== null;
  }

  /**
   * 创建自动修复 Issue
   */
  async createAutoFixIssue(
    feedbackId: string,
    decision: TriageDecision,
    additionalContext?: {
      userDescription?: string;
      screenshotUrls?: string[];
      pageUrl?: string;
      errorStack?: string;
    },
  ): Promise<CreateIssueResult> {
    if (!this.isEnabled()) {
      return {
        success: false,
        error: "GitHub Issue Service is not enabled or configured",
      };
    }

    try {
      const issueBody = this.buildIssueBody(
        feedbackId,
        decision,
        additionalContext,
      );
      const labels = this.buildLabels(decision);
      const title = this.buildTitle(feedbackId, decision);

      this.logger.log(`Creating GitHub Issue for feedback ${feedbackId}`);

      const response = await this.octokit!.issues.create({
        owner: this.owner,
        repo: this.repo,
        title,
        body: issueBody,
        labels,
      });

      this.logger.log(
        `Created GitHub Issue #${response.data.number}: ${response.data.html_url}`,
      );

      return {
        success: true,
        issueNumber: response.data.number,
        issueUrl: response.data.html_url,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create GitHub Issue: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 构建 Issue 标题
   */
  private buildTitle(feedbackId: string, decision: TriageDecision): string {
    const module = decision.classification.affectedModule || "unknown";
    const subType = decision.classification.subType || "issue";
    const shortId = feedbackId.slice(0, 8);

    return `[Auto-Fix] ${module}: ${subType} (${shortId})`;
  }

  /**
   * 构建 Issue 标签
   */
  private buildLabels(decision: TriageDecision): string[] {
    const labels = ["auto-fix-candidate", "ai-generated"];

    // 优先级标签
    labels.push(`priority:${decision.priority.level}`);

    // 模块标签
    if (decision.classification.affectedModule) {
      labels.push(`module:${decision.classification.affectedModule}`);
    }

    // 类型标签
    labels.push(`type:${decision.classification.type}`);

    // 复杂度标签
    if (decision.routing.autoFixPlan?.estimatedComplexity) {
      labels.push(
        `complexity:${decision.routing.autoFixPlan.estimatedComplexity}`,
      );
    }

    return labels;
  }

  /**
   * 构建 Issue 正文
   */
  private buildIssueBody(
    feedbackId: string,
    decision: TriageDecision,
    additionalContext?: {
      userDescription?: string;
      screenshotUrls?: string[];
      pageUrl?: string;
      errorStack?: string;
    },
  ): string {
    const sections: string[] = [];

    // 元信息
    sections.push(`## Feedback Information
| Field | Value |
|-------|-------|
| Feedback ID | \`${feedbackId}\` |
| Type | ${decision.classification.type} |
| Sub-Type | ${decision.classification.subType} |
| Priority | ${decision.priority.level} (score: ${decision.priority.score}) |
| Module | ${decision.classification.affectedModule || "unknown"} |
| Keywords | ${decision.classification.keywords.join(", ") || "none"} |
`);

    // 问题描述
    if (additionalContext?.userDescription) {
      sections.push(`## User Description
${additionalContext.userDescription}
`);
    }

    // 截图分析
    if (decision.screenshotAnalysis?.hasScreenshot) {
      let screenshotSection = `## Screenshot Analysis\n`;

      if (decision.screenshotAnalysis.issueDescription) {
        screenshotSection += `**Issue**: ${decision.screenshotAnalysis.issueDescription}\n\n`;
      }

      if (decision.screenshotAnalysis.detectedErrors?.length) {
        screenshotSection += `**Detected Errors**:\n`;
        for (const error of decision.screenshotAnalysis.detectedErrors) {
          screenshotSection += `- ${error}\n`;
        }
        screenshotSection += "\n";
      }

      if (decision.screenshotAnalysis.pageIdentified) {
        screenshotSection += `**Page**: ${decision.screenshotAnalysis.pageIdentified}\n`;
      }

      if (additionalContext?.screenshotUrls?.length) {
        screenshotSection += `\n**Screenshots**:\n`;
        for (const url of additionalContext.screenshotUrls) {
          screenshotSection += `![screenshot](${url})\n`;
        }
      }

      sections.push(screenshotSection);
    }

    // 错误堆栈
    if (additionalContext?.errorStack) {
      sections.push(`## Error Stack
\`\`\`
${additionalContext.errorStack}
\`\`\`
`);
    }

    // 修复指令 (Claude Code 会读取这部分)
    sections.push(`## Fix Instructions
请按照以下要求修复问题：

### 问题信息
- **问题模块**: \`${decision.classification.affectedModule || "unknown"}\`
- **问题类型**: ${decision.classification.subType}
- **页面 URL**: ${additionalContext?.pageUrl || "未知"}

### 修复方法
${decision.routing.autoFixPlan?.approach || "请根据问题描述进行修复"}

### 预估复杂度
${decision.routing.autoFixPlan?.estimatedComplexity || "unknown"}

### 风险等级
${decision.routing.autoFixPlan?.riskLevel || "low"}

### 修复要求
1. 只修改必要的代码，避免不相关的更改
2. 保持现有代码风格一致
3. 添加适当的错误处理和边界检查
4. 如果涉及 UI 变更，确保样式一致
5. 如果需要，为关键逻辑添加单元测试

### 项目上下文
- 前端: Next.js 14 + TypeScript + TailwindCSS
- 后端: NestJS + Prisma + PostgreSQL
- 代码规范: 参考 \`.claude/CLAUDE.md\`
`);

    // 优先级理由
    sections.push(`## Priority Assessment
**Level**: ${decision.priority.level}
**Score**: ${decision.priority.score}/100

**Factors**:
- User Impact: ${decision.priority.factors.userImpact}
- Severity: ${decision.priority.factors.severity}
- Frequency: ${decision.priority.factors.frequency}
- Business Impact: ${decision.priority.factors.businessImpact}

**Reasoning**: ${decision.priority.reasoning}
`);

    // 相似问题
    if (decision.similarIssues?.length) {
      let similarSection = `## Similar Issues\n`;
      for (const issue of decision.similarIssues.slice(0, 3)) {
        similarSection += `- ${issue.title} (${issue.similarity}% similar) - Status: ${issue.status}\n`;
        if (issue.resolution) {
          similarSection += `  - Resolution: ${issue.resolution}\n`;
        }
      }
      sections.push(similarSection);
    }

    // 元数据 (供 GitHub Actions 解析)
    sections.push(`## Metadata
\`\`\`json
{
  "feedbackId": "${feedbackId}",
  "module": "${decision.classification.affectedModule || "unknown"}",
  "type": "${decision.classification.type}",
  "subType": "${decision.classification.subType}",
  "priority": "${decision.priority.level}",
  "complexity": "${decision.routing.autoFixPlan?.estimatedComplexity || "unknown"}",
  "riskLevel": "${decision.routing.autoFixPlan?.riskLevel || "low"}",
  "requiresReview": ${decision.routing.autoFixPlan?.requiresReview ?? true}
}
\`\`\`
`);

    return sections.join("\n");
  }

  /**
   * 更新 Issue 状态
   */
  async updateIssueStatus(
    issueNumber: number,
    status: "in_progress" | "completed" | "failed",
    comment?: string,
  ): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    try {
      // 添加评论
      if (comment) {
        await this.octokit!.issues.createComment({
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber,
          body: comment,
        });
      }

      // 更新标签
      const labelToAdd =
        status === "in_progress"
          ? "status:in-progress"
          : status === "completed"
            ? "status:completed"
            : "status:failed";

      await this.octokit!.issues.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        labels: [labelToAdd],
      });

      // 如果完成，关闭 Issue
      if (status === "completed") {
        await this.octokit!.issues.update({
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber,
          state: "closed",
        });
      }

      return true;
    } catch (error) {
      this.logger.error(`Failed to update Issue #${issueNumber}:`, error);
      return false;
    }
  }

  /**
   * 关联 PR 到 Issue
   */
  async linkPullRequest(
    issueNumber: number,
    prNumber: number,
  ): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    try {
      await this.octokit!.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        body: `🔗 Auto-fix PR created: #${prNumber}`,
      });

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to link PR #${prNumber} to Issue #${issueNumber}:`,
        error,
      );
      return false;
    }
  }
}
