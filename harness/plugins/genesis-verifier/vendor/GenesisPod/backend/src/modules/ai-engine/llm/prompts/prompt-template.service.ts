import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, PromptTemplate } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";

/**
 * Prompt Template 数据结构
 */
export interface PromptTemplateData {
  id: string;
  taskType: string;
  name: string;
  version: number;
  template: string;
  variables: string[] | null;
  isActive: boolean;
  description: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 创建 Prompt Template 的 DTO
 */
export interface CreatePromptTemplateDto {
  taskType: string;
  name: string;
  template: string;
  variables?: string[];
  description?: string;
  createdBy?: string;
}

/**
 * Prompt Template 管理服务
 * 负责：Prompt 模板的版本管理、激活、回滚和渲染
 *
 * 核心功能：
 * - 模板版本管理（创建、激活、回滚）
 * - 模板查询（按任务类型、版本）
 * - 模板渲染（变量替换）
 */
@Injectable()
export class PromptTemplateService {
  private readonly logger = new Logger(PromptTemplateService.name);

  // ==================== 模板缓存 ====================
  // 缓存活跃模板，避免频繁查询数据库
  private activeTemplateCache = new Map<string, PromptTemplateData>();
  private activeCacheTime = 0;
  private readonly ACTIVE_CACHE_TTL = 5 * 60 * 1000; // 5 分钟缓存

  constructor(private readonly prisma: PrismaService) {
    // 初始化时异步加载活跃模板
    this.refreshActiveTemplateCache().catch((err) =>
      this.logger.warn(`Failed to initialize active template cache: ${err}`),
    );
  }

  // ==================== 缓存管理 ====================

  /**
   * 刷新活跃模板缓存
   * 从数据库加载所有活跃的模板
   */
  private async refreshActiveTemplateCache(): Promise<void> {
    try {
      const templates = await this.prisma.promptTemplate.findMany({
        where: { isActive: true },
      });

      this.activeTemplateCache.clear();
      for (const template of templates) {
        const data = this.buildTemplateData(template);
        this.activeTemplateCache.set(template.taskType, data);
      }

      this.activeCacheTime = Date.now();
      this.logger.log(
        `[refreshActiveTemplateCache] Loaded ${templates.length} active templates`,
      );
    } catch (error) {
      this.logger.error(`[refreshActiveTemplateCache] Failed: ${error}`);
    }
  }

  /**
   * 将数据库模型转换为业务数据结构
   */
  private buildTemplateData(template: PromptTemplate): PromptTemplateData {
    return {
      id: template.id,
      taskType: template.taskType,
      name: template.name,
      version: template.version,
      template: template.template,
      variables: Array.isArray(template.variables)
        ? (template.variables as string[])
        : null,
      isActive: template.isActive,
      description: template.description,
      createdBy: template.createdBy,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }

  // ==================== 核心功能 ====================

  /**
   * 获取指定任务类型的 Prompt 模板
   * @param taskType 任务类型（如 "PRD", "CODE_REVIEW"）
   * @param version 版本号（可选，默认返回活跃版本）
   * @returns Prompt 模板数据
   */
  async getPrompt(
    taskType: string,
    version?: number,
  ): Promise<PromptTemplateData | null> {
    // 1. 如果指定版本，直接查询数据库
    if (version !== undefined) {
      try {
        const template = await this.prisma.promptTemplate.findUnique({
          where: {
            taskType_version: {
              taskType,
              version,
            },
          },
        });

        if (template) {
          this.logger.debug(
            `[getPrompt] Found template for ${taskType} v${version}`,
          );
          return this.buildTemplateData(template);
        }

        this.logger.warn(
          `[getPrompt] Template not found: ${taskType} v${version}`,
        );
        return null;
      } catch (error) {
        this.logger.error(
          `[getPrompt] Failed to query template ${taskType} v${version}: ${error}`,
        );
        return null;
      }
    }

    // 2. 未指定版本，返回活跃版本（使用缓存）
    // 检查缓存是否过期
    if (Date.now() - this.activeCacheTime > this.ACTIVE_CACHE_TTL) {
      await this.refreshActiveTemplateCache();
    }

    // 从缓存获取活跃模板
    if (this.activeTemplateCache.has(taskType)) {
      this.logger.debug(
        `[getPrompt] Found active template for ${taskType} from cache`,
      );
      return this.activeTemplateCache.get(taskType)!;
    }

    // 缓存未命中，从数据库查询
    try {
      const template = await this.prisma.promptTemplate.findFirst({
        where: {
          taskType,
          isActive: true,
        },
      });

      if (template) {
        const data = this.buildTemplateData(template);
        // 更新缓存
        this.activeTemplateCache.set(taskType, data);
        this.logger.debug(
          `[getPrompt] Found active template for ${taskType} from DB`,
        );
        return data;
      }

      this.logger.warn(`[getPrompt] No active template found for ${taskType}`);
      return null;
    } catch (error) {
      this.logger.error(
        `[getPrompt] Failed to query active template ${taskType}: ${error}`,
      );
      return null;
    }
  }

  /**
   * 创建新版本的 Prompt 模板
   * @param dto 模板数据
   * @param changeLog 变更说明（可选）
   * @returns 新创建的模板
   */
  async createVersion(
    dto: CreatePromptTemplateDto,
    changeLog?: string,
  ): Promise<PromptTemplateData> {
    try {
      // 1. 查找该任务类型的最大版本号
      const maxVersion = await this.prisma.promptTemplate.findFirst({
        where: { taskType: dto.taskType },
        orderBy: { version: "desc" },
        select: { version: true },
      });

      const newVersion = maxVersion ? maxVersion.version + 1 : 1;

      // 2. 创建新版本
      const template = await this.prisma.promptTemplate.create({
        data: {
          taskType: dto.taskType,
          name: dto.name,
          version: newVersion,
          template: dto.template,
          variables: dto.variables
            ? (dto.variables as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          isActive: false, // 新版本默认不激活
          description: dto.description
            ? `${dto.description}${changeLog ? `\n\n变更说明: ${changeLog}` : ""}`
            : changeLog || null,
          createdBy: dto.createdBy || null,
        },
      });

      this.logger.log(
        `[createVersion] Created new template: ${dto.taskType} v${newVersion}`,
      );

      return this.buildTemplateData(template);
    } catch (error) {
      this.logger.error(`[createVersion] Failed to create template: ${error}`);
      throw error;
    }
  }

  /**
   * 激活指定版本的 Prompt 模板
   * 同时会自动停用该任务类型的其他版本
   * @param taskType 任务类型
   * @param version 要激活的版本号
   * @returns 激活的模板
   */
  async activateVersion(
    taskType: string,
    version: number,
  ): Promise<PromptTemplateData> {
    try {
      // 1. 检查指定版本是否存在
      const template = await this.prisma.promptTemplate.findUnique({
        where: {
          taskType_version: {
            taskType,
            version,
          },
        },
      });

      if (!template) {
        throw new NotFoundException(
          `Template not found: ${taskType} v${version}`,
        );
      }

      // 2. 使用事务：停用其他版本 + 激活指定版本
      const [, activated] = await this.prisma.$transaction([
        // 停用该任务类型的所有其他版本
        this.prisma.promptTemplate.updateMany({
          where: {
            taskType,
            isActive: true,
            version: { not: version },
          },
          data: { isActive: false },
        }),
        // 激活指定版本
        this.prisma.promptTemplate.update({
          where: {
            taskType_version: {
              taskType,
              version,
            },
          },
          data: { isActive: true },
        }),
      ]);

      this.logger.log(
        `[activateVersion] Activated ${taskType} v${version}, deactivated other versions`,
      );

      // 3. 刷新缓存
      await this.refreshActiveTemplateCache();

      return this.buildTemplateData(activated);
    } catch (error) {
      this.logger.error(
        `[activateVersion] Failed to activate ${taskType} v${version}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * 回滚到指定版本
   * 实际上就是激活该版本
   * @param taskType 任务类型
   * @param toVersion 要回滚到的版本号
   * @returns 回滚后的模板
   */
  async rollback(
    taskType: string,
    toVersion: number,
  ): Promise<PromptTemplateData> {
    this.logger.log(
      `[rollback] Rolling back ${taskType} to version ${toVersion}`,
    );
    return this.activateVersion(taskType, toVersion);
  }

  /**
   * 渲染 Prompt 模板
   * 将模板中的变量占位符替换为实际值
   * 支持格式：{{variableName}} 或 ${variableName}
   *
   * @param template 模板字符串
   * @param variables 变量键值对
   * @returns 渲染后的字符串
   */
  renderTemplate(template: string, variables: Record<string, unknown>): string {
    let rendered = template;

    // 替换 {{variableName}} 格式
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
      rendered = rendered.replace(regex, String(value ?? ""));
    }

    // 替换 ${variableName} 格式
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\$\\{\\s*${key}\\s*\\}`, "g");
      rendered = rendered.replace(regex, String(value ?? ""));
    }

    return rendered;
  }

  // ==================== 辅助方法 ====================

  /**
   * 获取指定任务类型的所有版本
   * @param taskType 任务类型
   * @returns 所有版本的模板列表（按版本号降序）
   */
  async getAllVersions(taskType: string): Promise<PromptTemplateData[]> {
    try {
      const templates = await this.prisma.promptTemplate.findMany({
        where: { taskType },
        orderBy: { version: "desc" },
      });

      return templates.map((t) => this.buildTemplateData(t));
    } catch (error) {
      this.logger.error(`[getAllVersions] Failed: ${error}`);
      return [];
    }
  }

  /**
   * 获取所有任务类型列表
   * @returns 所有唯一的任务类型
   */
  async getAllTaskTypes(): Promise<string[]> {
    try {
      const templates = await this.prisma.promptTemplate.findMany({
        select: { taskType: true },
        distinct: ["taskType"],
      });

      return templates.map((t) => t.taskType);
    } catch (error) {
      this.logger.error(`[getAllTaskTypes] Failed: ${error}`);
      return [];
    }
  }

  /**
   * 删除指定版本的模板
   * ⚠️ 不允许删除活跃版本
   * @param taskType 任务类型
   * @param version 版本号
   */
  async deleteVersion(taskType: string, version: number): Promise<void> {
    try {
      // 检查是否为活跃版本
      const template = await this.prisma.promptTemplate.findUnique({
        where: {
          taskType_version: {
            taskType,
            version,
          },
        },
      });

      if (!template) {
        throw new NotFoundException(
          `Template not found: ${taskType} v${version}`,
        );
      }

      if (template.isActive) {
        throw new Error(
          `Cannot delete active version. Please activate another version first.`,
        );
      }

      // 删除
      await this.prisma.promptTemplate.delete({
        where: {
          taskType_version: {
            taskType,
            version,
          },
        },
      });

      this.logger.log(`[deleteVersion] Deleted ${taskType} v${version}`);
    } catch (error) {
      this.logger.error(
        `[deleteVersion] Failed to delete ${taskType} v${version}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * 获取活跃模板的统计信息
   */
  async getActiveTemplateStats(): Promise<{
    totalTemplates: number;
    activeTemplates: number;
    taskTypes: number;
  }> {
    try {
      const [total, active, taskTypes] = await Promise.all([
        this.prisma.promptTemplate.count(),
        this.prisma.promptTemplate.count({ where: { isActive: true } }),
        this.prisma.promptTemplate.findMany({
          select: { taskType: true },
          distinct: ["taskType"],
        }),
      ]);

      return {
        totalTemplates: total,
        activeTemplates: active,
        taskTypes: taskTypes.length,
      };
    } catch (error) {
      this.logger.error(`[getActiveTemplateStats] Failed: ${error}`);
      return {
        totalTemplates: 0,
        activeTemplates: 0,
        taskTypes: 0,
      };
    }
  }
}
