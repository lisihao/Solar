/**
 * AI Engine - Skill Content Service
 *
 * 桥接文件系统 Skill 与数据库 Skill，管理 prompt 内容和版本历史。
 *
 * 优先级规则：
 * - source = "db"：DB 是 truth（用户通过 UI 编辑过），文件系统不再覆盖
 * - source = "local"：文件系统是 truth，DB 只做备份
 * - source = "marketplace"：SkillsMP 远程源
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SkillMdDefinition, SkillMdFrontmatter } from "../types/skill-md.types";
import { parseSkillMd } from "../loader/parsing/skill-parser";

/** 版本历史上限 */
const MAX_VERSIONS_PER_SKILL = 50;

/** skillId 合法字符：字母、数字、连字符、下划线、点 */
const SKILL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9\-_.]{0,127}$/;

export interface SkillVersionRecord {
  id: string;
  skillId: string;
  version: string;
  promptContent: string;
  frontmatter: Record<string, unknown> | null;
  contentHash: string;
  changeNote: string | null;
  changedBy: string | null;
  createdAt: Date;
}

export interface FullSkillDefinition {
  id: string;
  skillId: string;
  displayName: string | null;
  description: string | null;
  enabled: boolean;
  layer: string | null;
  domain: string | null;
  tags: string[];
  version: string | null;
  source: string | null;
  promptContent: string | null;
  frontmatter: Record<string, unknown> | null;
  contentHash: string | null;
  filePath: string | null;
  taskProfileJson: Record<string, unknown> | null;
  inputSchemaJson: Record<string, unknown> | null;
  outputSchemaJson: Record<string, unknown> | null;
  lastUsedAt: Date | null;
  usageCount: number;
}

@Injectable()
export class SkillContentService {
  private readonly logger = new Logger(SkillContentService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 启动时扫描所有已加载的 SKILL.md 定义，按 contentHash 去重 upsert 到 DB。
   * 只更新 source="local" 的记录（source="db" 的不覆盖，因为用户已通过 UI 编辑）。
   */
  async syncFilesystemToDb(
    loadedSkills: SkillMdDefinition[],
  ): Promise<{ synced: number; skipped: number }> {
    let synced = 0;
    let skipped = 0;

    for (const skill of loadedSkills) {
      try {
        const existing = await this.prisma.skillConfig.findUnique({
          where: { skillId: skill.metadata.id },
          select: { source: true, contentHash: true },
        });

        // source="db" 表示用户已通过 UI 编辑，不覆盖
        if (existing?.source === "db") {
          skipped++;
          continue;
        }

        // contentHash 相同则跳过（无变更）
        if (existing?.contentHash === skill.contentHash) {
          skipped++;
          continue;
        }

        const contentHash =
          skill.contentHash ??
          crypto.createHash("md5").update(skill.content).digest("hex");

        await this.prisma.skillConfig.upsert({
          where: { skillId: skill.metadata.id },
          create: {
            skillId: skill.metadata.id,
            displayName: skill.metadata.name,
            description: skill.metadata.description,
            enabled: skill.metadata.enabled !== false,
            layer: skill.metadata.layer ?? "content",
            domain: skill.metadata.domain ?? "general",
            tags: skill.metadata.tags ?? [],
            promptContent: skill.content,
            frontmatter: skill.metadata as unknown as Prisma.InputJsonValue,
            contentHash,
            version: skill.metadata.version ?? "1.0.0",
            source: "local",
            filePath: skill.filePath ?? null,
            taskProfileJson: skill.metadata.taskProfile
              ? (skill.metadata.taskProfile as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            inputSchemaJson: skill.metadata.inputSchema
              ? (skill.metadata.inputSchema as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            outputSchemaJson: skill.metadata.outputSchema
              ? (skill.metadata
                  .outputSchema as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          },
          update: {
            promptContent: skill.content,
            frontmatter: skill.metadata as unknown as Prisma.InputJsonValue,
            contentHash,
            version: skill.metadata.version ?? "1.0.0",
            source: "local",
            filePath: skill.filePath ?? null,
            taskProfileJson: skill.metadata.taskProfile
              ? (skill.metadata.taskProfile as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            inputSchemaJson: skill.metadata.inputSchema
              ? (skill.metadata.inputSchema as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            outputSchemaJson: skill.metadata.outputSchema
              ? (skill.metadata
                  .outputSchema as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          },
        });
        synced++;
      } catch (error) {
        this.logger.warn(
          `Failed to sync skill ${skill.metadata.id}: ${(error as Error).message}`,
        );
      }
    }

    this.logger.log(
      `[SkillContent] Filesystem sync complete: ${synced} synced, ${skipped} skipped`,
    );
    return { synced, skipped };
  }

  /**
   * 获取有效的 prompt 内容。
   * 合并优先级：DB(source=db) > 文件系统 > null
   */
  async getEffectiveContent(
    skillId: string,
  ): Promise<{ promptContent: string | null; source: string | null } | null> {
    const config = await this.prisma.skillConfig.findUnique({
      where: { skillId },
      select: { promptContent: true, source: true },
    });

    if (!config) return null;
    return { promptContent: config.promptContent, source: config.source };
  }

  /**
   * 保存 prompt 内容 + 自动创建版本快照 + 自增版本号。
   * 调用后 source 自动变为 "db"。
   */
  async savePromptContent(
    skillId: string,
    content: string,
    frontmatter: Record<string, unknown> | null,
    changeNote?: string,
    changedBy?: string,
  ): Promise<{ version: string }> {
    const existing = await this.prisma.skillConfig.findUnique({
      where: { skillId },
      select: {
        promptContent: true,
        version: true,
        contentHash: true,
        frontmatter: true,
      },
    });

    if (!existing) {
      throw new NotFoundException(`Skill not found: ${skillId}`);
    }

    // 计算新 hash 和新版本号
    const newHash = crypto.createHash("md5").update(content).digest("hex");
    const newVersion = this.incrementVersion(existing.version ?? "1.0.0");

    // Atomic transaction: snapshot old version + update content
    await this.prisma.$transaction(async (tx) => {
      // 创建旧版本快照（如果有旧内容）
      if (existing.promptContent) {
        await tx.skillVersion.create({
          data: {
            skillId,
            version: existing.version ?? "1.0.0",
            promptContent: existing.promptContent,
            frontmatter:
              (existing.frontmatter as Prisma.InputJsonValue) ?? undefined,
            contentHash: existing.contentHash ?? "",
            changeNote: changeNote ?? null,
            changedBy: changedBy ?? null,
          },
        });
      }

      // 更新 DB
      await tx.skillConfig.update({
        where: { skillId },
        data: {
          promptContent: content,
          frontmatter: (frontmatter as Prisma.InputJsonValue) || undefined,
          contentHash: newHash,
          version: newVersion,
          source: "db", // 标记为 DB 编辑
        },
      });
    });

    // 版本上限归档（post-transaction, non-critical）
    if (existing.promptContent) {
      await this.pruneOldVersions(skillId);
    }

    this.logger.log(
      `[SkillContent] Saved prompt for ${skillId}: v${existing.version} → v${newVersion}`,
    );

    return { version: newVersion };
  }

  /**
   * 获取版本历史列表
   */
  async getVersionHistory(
    skillId: string,
    limit = 20,
  ): Promise<SkillVersionRecord[]> {
    const versions = await this.prisma.skillVersion.findMany({
      where: { skillId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return versions.map((v) => ({
      id: v.id,
      skillId: v.skillId,
      version: v.version,
      promptContent: v.promptContent,
      frontmatter: v.frontmatter as Record<string, unknown> | null,
      contentHash: v.contentHash,
      changeNote: v.changeNote,
      changedBy: v.changedBy,
      createdAt: v.createdAt,
    }));
  }

  /**
   * 恢复到指定版本（创建新版本记录，不删除历史）
   */
  async restoreVersion(
    skillId: string,
    versionId: string,
  ): Promise<{ version: string }> {
    const target = await this.prisma.skillVersion.findFirst({
      where: { id: versionId, skillId },
    });

    if (!target) {
      throw new Error(`Version not found: ${versionId} for skill ${skillId}`);
    }

    // 使用 savePromptContent 保存恢复内容（自动创建版本快照）
    return this.savePromptContent(
      skillId,
      target.promptContent,
      target.frontmatter as Record<string, unknown> | null,
      `Restored from v${target.version}`,
    );
  }

  /**
   * 返回 DB 合并后的完整定义
   */
  async getFullSkillDefinition(
    skillId: string,
  ): Promise<FullSkillDefinition | null> {
    const config = await this.prisma.skillConfig.findUnique({
      where: { skillId },
    });

    if (!config) return null;

    return {
      id: config.id,
      skillId: config.skillId,
      displayName: config.displayName,
      description: config.description,
      enabled: config.enabled,
      layer: config.layer,
      domain: config.domain,
      tags: config.tags,
      version: config.version,
      source: config.source,
      promptContent: config.promptContent,
      frontmatter: config.frontmatter as Record<string, unknown> | null,
      contentHash: config.contentHash,
      filePath: config.filePath,
      taskProfileJson: config.taskProfileJson as Record<string, unknown> | null,
      inputSchemaJson: config.inputSchemaJson as Record<string, unknown> | null,
      outputSchemaJson: config.outputSchemaJson as Record<
        string,
        unknown
      > | null,
      lastUsedAt: config.lastUsedAt,
      usageCount: config.usageCount,
    };
  }

  /**
   * 从 UI 创建新的 DB-only Skill（不需要文件系统）
   */
  async createSkillFromUI(data: {
    skillId: string;
    displayName: string;
    description: string;
    promptContent: string;
    frontmatter?: Record<string, unknown>;
    layer?: string;
    domain?: string;
    tags?: string[];
    taskProfileJson?: Record<string, unknown>;
    inputSchemaJson?: Record<string, unknown>;
    outputSchemaJson?: Record<string, unknown>;
  }): Promise<FullSkillDefinition> {
    if (!SKILL_ID_PATTERN.test(data.skillId)) {
      throw new BadRequestException(
        `Invalid skillId: must match ${SKILL_ID_PATTERN} (alphanumeric, hyphens, underscores, dots, 1-128 chars)`,
      );
    }

    const contentHash = crypto
      .createHash("md5")
      .update(data.promptContent)
      .digest("hex");

    const config = await this.prisma.skillConfig.create({
      data: {
        skillId: data.skillId,
        displayName: data.displayName,
        description: data.description,
        enabled: true,
        layer: data.layer ?? "content",
        domain: data.domain ?? "general",
        tags: data.tags ?? [],
        promptContent: data.promptContent,
        frontmatter: (data.frontmatter as Prisma.InputJsonValue) ?? undefined,
        contentHash,
        version: "1.0.0",
        source: "db",
        taskProfileJson:
          (data.taskProfileJson as Prisma.InputJsonValue) ?? undefined,
        inputSchemaJson:
          (data.inputSchemaJson as Prisma.InputJsonValue) ?? undefined,
        outputSchemaJson:
          (data.outputSchemaJson as Prisma.InputJsonValue) ?? undefined,
      },
    });

    this.logger.log(`[SkillContent] Created DB skill: ${data.skillId}`);

    return this.getFullSkillDefinition(
      config.skillId,
    ) as Promise<FullSkillDefinition>;
  }

  /**
   * 将 DB prompt 内容解析为 SkillMdDefinition（用于注册到 SkillRegistry）
   */
  parseDbContentToDefinition(
    skillId: string,
    promptContent: string,
    frontmatter: Record<string, unknown> | null,
  ): SkillMdDefinition | null {
    try {
      // 从 frontmatter + content 重建 SKILL.md 格式
      if (frontmatter) {
        // 直接构建 SkillMdDefinition（避免 parse 不必要的开销）
        return {
          metadata: frontmatter as unknown as SkillMdFrontmatter,
          content: promptContent,
          loadedAt: new Date(),
          contentHash: crypto
            .createHash("md5")
            .update(promptContent)
            .digest("hex"),
        };
      }

      // 如果没有 frontmatter，尝试从 promptContent 解析（假设是完整 SKILL.md）
      return parseSkillMd(promptContent);
    } catch (error) {
      this.logger.warn(
        `Failed to parse DB content for ${skillId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 更新 lastUsedAt 和 usageCount（fire-and-forget）
   */
  async recordUsage(skillId: string): Promise<void> {
    try {
      await this.prisma.skillConfig.updateMany({
        where: { skillId },
        data: {
          lastUsedAt: new Date(),
          usageCount: { increment: 1 },
        },
      });
    } catch {
      // fire-and-forget, don't block execution
    }
  }

  /**
   * 自增版本号（patch 级别）
   */
  private incrementVersion(current: string): string {
    const parts = current.split(".");
    if (parts.length !== 3) return "1.0.1";

    const [major, minor, patch] = parts.map(Number);
    return `${major}.${minor}.${patch + 1}`;
  }

  /**
   * 版本上限归档：删除超出上限的最旧版本
   */
  private async pruneOldVersions(skillId: string): Promise<void> {
    const count = await this.prisma.skillVersion.count({
      where: { skillId },
    });

    if (count <= MAX_VERSIONS_PER_SKILL) return;

    const toDelete = count - MAX_VERSIONS_PER_SKILL;
    const oldVersions = await this.prisma.skillVersion.findMany({
      where: { skillId },
      orderBy: { createdAt: "asc" },
      take: toDelete,
      select: { id: true },
    });

    if (oldVersions.length > 0) {
      await this.prisma.skillVersion.deleteMany({
        where: { id: { in: oldVersions.map((v) => v.id) } },
      });
      this.logger.debug(
        `[SkillContent] Pruned ${oldVersions.length} old versions for ${skillId}`,
      );
    }
  }
}
