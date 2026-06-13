/**
 * Release 发布通知服务
 *
 * 功能：
 * 1. 收集 Git 变更信息
 * 2. 使用 AI 生成用户友好的发布说明
 * 3. 批量推送通知给所有用户
 */

import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  Inject,
  Optional,
} from "@nestjs/common";
import { execFileSync } from "child_process";
import { PrismaService } from "../../../common/prisma/prisma.service";
import {
  type IAiChat,
  AI_CHAT_TOKEN,
} from "../abstractions/ai-services.interface";
import { NotificationService } from "../notifications/notification.service";
import { NotificationTypeDto } from "../notifications/notification.types";
import { APP_CONFIG } from "../../../common/config/app.config";
import {
  GitCommit,
  GitChangeStats,
  ReleaseInfo,
  ReleaseNotesDto,
  ReleaseNotificationResult,
} from "./release.types";

@Injectable()
export class ReleaseService {
  private readonly logger = new Logger(ReleaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_CHAT_TOKEN)
    @Optional()
    private readonly aiFacade: IAiChat | undefined,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * 收集 Git 变更信息
   * @param fromTag 起始 tag（如 v1.0.0）
   * @param toTag 目标 tag（如 v1.1.0）
   */
  async collectGitChanges(
    fromTag: string,
    toTag: string,
  ): Promise<{ commits: GitCommit[]; stats: GitChangeStats }> {
    this.logger.log(`Collecting git changes from ${fromTag} to ${toTag}`);

    // Security: validate tag format to prevent command injection
    const TAG_PATTERN = /^[a-zA-Z0-9._\-/]+$/;
    if (!TAG_PATTERN.test(fromTag) || !TAG_PATTERN.test(toTag)) {
      throw new BadRequestException(
        `Invalid tag format. Tags must match ${TAG_PATTERN}. Got: "${fromTag}", "${toTag}"`,
      );
    }

    try {
      // 获取 commits (use execFileSync to avoid shell injection)
      const rawCommits = execFileSync(
        "git",
        [
          "log",
          `${fromTag}..${toTag}`,
          "--pretty=format:%H|%s|%an|%ad",
          "--date=short",
        ],
        { encoding: "utf-8", cwd: process.cwd() },
      );

      const commits = this.parseCommits(rawCommits);

      // 获取变更统计
      const rawStats = execFileSync(
        "git",
        ["diff", `${fromTag}..${toTag}`, "--stat"],
        { encoding: "utf-8", cwd: process.cwd() },
      );

      const stats = this.parseStats(rawStats);

      this.logger.log(
        `Found ${commits.length} commits, ${stats.filesChanged} files changed`,
      );

      return { commits, stats };
    } catch (error) {
      this.logger.error("Failed to collect git changes", error);
      throw new InternalServerErrorException(
        `Failed to collect git changes: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * 解析 conventional commits
   */
  private parseCommits(rawCommits: string): GitCommit[] {
    if (!rawCommits.trim()) {
      return [];
    }

    const lines = rawCommits.trim().split("\n");
    const commits: GitCommit[] = [];

    for (const line of lines) {
      const [hash, message, author, date] = line.split("|");
      if (!hash || !message) continue;

      // 解析 conventional commit 格式: type(scope): message
      const conventionalMatch = message.match(
        /^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/,
      );

      if (conventionalMatch) {
        commits.push({
          hash: hash.trim(),
          type: conventionalMatch[1],
          scope: conventionalMatch[2] || undefined,
          message: conventionalMatch[3],
          author: author?.trim() || "Unknown",
          date: date?.trim() || new Date().toISOString().split("T")[0],
        });
      } else {
        // 非 conventional commit，归类为 chore
        commits.push({
          hash: hash.trim(),
          type: "chore",
          message: message.trim(),
          author: author?.trim() || "Unknown",
          date: date?.trim() || new Date().toISOString().split("T")[0],
        });
      }
    }

    return commits;
  }

  /**
   * 解析变更统计
   */
  private parseStats(rawStats: string): GitChangeStats {
    // 解析最后一行的统计信息，格式如：
    // 10 files changed, 150 insertions(+), 20 deletions(-)
    const statsMatch = rawStats.match(
      /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/,
    );

    if (statsMatch) {
      return {
        filesChanged: parseInt(statsMatch[1]) || 0,
        insertions: parseInt(statsMatch[2]) || 0,
        deletions: parseInt(statsMatch[3]) || 0,
      };
    }

    return {
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
    };
  }

  /**
   * 使用 AI 生成发布说明
   */
  async generateReleaseNotes(
    releaseInfo: ReleaseInfo,
  ): Promise<ReleaseNotesDto> {
    this.logger.log(`Generating release notes for ${releaseInfo.toVersion}`);

    // 按类型分组 commits
    const commitsByType: Record<string, GitCommit[]> = {};
    for (const commit of releaseInfo.commits) {
      const type = commit.type;
      if (!commitsByType[type]) {
        commitsByType[type] = [];
      }
      commitsByType[type].push(commit);
    }

    // 构建 AI prompt
    const prompt = `你是一个技术产品经理，需要为 ${APP_CONFIG.brand.fullName} 生成面向用户的发布说明。

## 版本信息
- 从版本: ${releaseInfo.fromVersion}
- 到版本: ${releaseInfo.toVersion}
- 变更文件数: ${releaseInfo.stats.filesChanged}
- 新增行数: ${releaseInfo.stats.insertions}
- 删除行数: ${releaseInfo.stats.deletions}

## 提交记录
${Object.entries(commitsByType)
  .map(([type, commits]) => {
    const typeLabel = this.getTypeLabel(type);
    return `### ${typeLabel}\n${commits.map((c) => `- ${c.scope ? `[${c.scope}] ` : ""}${c.message}`).join("\n")}`;
  })
  .join("\n\n")}

## 要求
请生成一份用户友好的发布说明，包含：
1. summary: 一句话总结本次更新的核心价值（不超过50字）
2. highlights: 2-4个主要亮点，每个包含 title（5字以内）和 description（20字以内）
3. changes: 按类型整理的变更列表，每个包含 type、scope（可选）和 description

重要：
- 面向普通用户，避免技术术语
- 突出用户价值而非技术实现
- 使用中文
- 只输出 JSON，不要其他内容

## 输出格式
{
  "summary": "...",
  "highlights": [
    { "title": "...", "description": "..." }
  ],
  "changes": [
    { "type": "feat", "scope": "...", "description": "..." }
  ]
}`;

    if (!this.aiFacade) {
      throw new InternalServerErrorException(
        "AI chat service is not available",
      );
    }

    try {
      const response = await this.aiFacade.chat({
        messages: [{ role: "user", content: prompt }],
        taskProfile: {
          creativity: "low",
          outputLength: "medium",
        },
      });

      // 解析 AI 响应
      const content = response.content.trim();
      // 提取 JSON（处理可能的 markdown 代码块）
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new InternalServerErrorException(
          "AI response does not contain valid JSON",
        );
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        version: releaseInfo.toVersion,
        summary: parsed.summary,
        highlights: parsed.highlights || [],
        changes: parsed.changes || [],
      };
    } catch (error) {
      this.logger.error("Failed to generate release notes with AI", error);
      // 降级：生成基础发布说明
      return this.generateFallbackReleaseNotes(releaseInfo);
    }
  }

  /**
   * 获取提交类型的中文标签
   */
  private getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      feat: "新功能",
      fix: "Bug 修复",
      perf: "性能优化",
      refactor: "代码重构",
      docs: "文档更新",
      style: "样式调整",
      test: "测试更新",
      chore: "其他更新",
    };
    return labels[type] || type;
  }

  /**
   * 降级：生成基础发布说明
   */
  private generateFallbackReleaseNotes(
    releaseInfo: ReleaseInfo,
  ): ReleaseNotesDto {
    const feats = releaseInfo.commits.filter((c) => c.type === "feat");
    const fixes = releaseInfo.commits.filter((c) => c.type === "fix");

    const summary =
      feats.length > 0
        ? `本次更新包含 ${feats.length} 个新功能${fixes.length > 0 ? `和 ${fixes.length} 个问题修复` : ""}`
        : fixes.length > 0
          ? `本次更新修复了 ${fixes.length} 个问题`
          : `本次更新包含 ${releaseInfo.commits.length} 项改进`;

    const highlights = feats.slice(0, 3).map((c) => ({
      title: c.scope || "新功能",
      description: c.message.slice(0, 20),
    }));

    const changes = releaseInfo.commits.map((c) => ({
      type: c.type,
      scope: c.scope,
      description: c.message,
    }));

    return {
      version: releaseInfo.toVersion,
      summary,
      highlights,
      changes,
    };
  }

  /**
   * 获取所有活跃用户 ID
   */
  async getAllActiveUserIds(): Promise<string[]> {
    this.logger.log("Fetching all active user IDs");

    const users = await this.prisma.user.findMany({
      where: {
        // 活跃用户：最近30天有登录
        lastLoginAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      select: {
        id: true,
      },
    });

    this.logger.log(`Found ${users.length} active users`);
    return users.map((u) => u.id);
  }

  /**
   * 发送发布通知
   */
  async sendReleaseNotification(
    releaseNotes: ReleaseNotesDto,
    userIds: string[],
  ): Promise<{ sent: number; failed: number; failedUsers?: string[] }> {
    this.logger.log(`Sending release notification to ${userIds.length} users`);

    if (userIds.length === 0) {
      return { sent: 0, failed: 0 };
    }

    try {
      const result = await this.notificationService.batchCreateNotifications({
        userIds,
        type: NotificationTypeDto.UPDATE,
        title: `${APP_CONFIG.brand.name} ${releaseNotes.version} 发布`,
        message: releaseNotes.summary,
        actionUrl: "/changelog",
        actionLabel: "查看更新",
        metadata: {
          version: releaseNotes.version,
          highlights: releaseNotes.highlights,
        },
      });

      this.logger.log(
        `Notification sent: ${result.succeeded.length} succeeded, ${result.failed.length} failed`,
      );

      return {
        sent: result.succeeded.length,
        failed: result.failed.length,
        failedUsers:
          result.failed.length > 0
            ? result.failed.map((f) => f.userId)
            : undefined,
      };
    } catch (error) {
      this.logger.error("Failed to send release notification", error);
      return {
        sent: 0,
        failed: userIds.length,
        failedUsers: userIds,
      };
    }
  }

  /**
   * 主流程：处理发布通知
   *
   * @param fromTag 起始版本
   * @param toTag 目标版本
   * @param dryRun 是否为预览模式（不发送通知）
   */
  async processRelease(
    fromTag: string,
    toTag: string,
    dryRun = false,
  ): Promise<ReleaseNotificationResult> {
    this.logger.log(
      `Processing release from ${fromTag} to ${toTag}${dryRun ? " (dry-run)" : ""}`,
    );

    // 1. 收集 Git 变更
    const { commits, stats } = await this.collectGitChanges(fromTag, toTag);

    if (commits.length === 0) {
      throw new BadRequestException(
        `No commits found between ${fromTag} and ${toTag}`,
      );
    }

    // 2. 生成发布说明
    const releaseInfo: ReleaseInfo = {
      fromVersion: fromTag,
      toVersion: toTag,
      commits,
      stats,
    };

    const releaseNotes = await this.generateReleaseNotes(releaseInfo);

    // 3. 获取用户列表
    const userIds = await this.getAllActiveUserIds();

    // 4. 发送通知（除非是 dry-run）
    let notificationResult: {
      sent: number;
      failed: number;
      failedUsers?: string[];
    };

    if (dryRun) {
      this.logger.log("Dry-run mode: skipping notification sending");
      notificationResult = {
        sent: 0,
        failed: 0,
      };
    } else {
      notificationResult = await this.sendReleaseNotification(
        releaseNotes,
        userIds,
      );
    }

    const result: ReleaseNotificationResult = {
      success: notificationResult.failed === 0 || dryRun,
      version: toTag,
      releaseNotes,
      notification: notificationResult,
      dryRun,
    };

    this.logger.log(
      `Release processing completed: ${result.success ? "SUCCESS" : "PARTIAL FAILURE"}`,
    );

    return result;
  }
}
