/**
 * Leader Tool Service
 *
 * 给 Leader 提供工具调用能力，让 Leader 可以主动获取最新数据
 *
 * ★ 架构重构：通过 ToolRegistry 调用工具，不再直接调用 SearchService
 *
 * 核心功能:
 * 1. Leader 可以主动搜索获取最新信息
 * 2. Leader 可以验证数据的时效性和准确性
 * 3. Leader 在规划前可以先了解当前最新状态
 *
 * 解决的问题:
 * - Leader 不清楚"最新"是什么时候
 * - Leader 无法主动获取参考数据来辅助规划
 */

import { Injectable, Logger } from "@nestjs/common";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import { ChatFacade, ToolFacade } from "@/modules/ai-harness/facade";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  AIModelType,
  DimensionStatus,
  ResearchMissionStatus,
  ResearchTaskStatus,
} from "@prisma/client";
import {
  getCurrentDateString,
  getFreshnessRequirementDescription,
} from "../../prompts/dimension-research.prompt";
import type { AICapabilityContext } from "@/modules/ai-harness/facade";

// ==================== 查询卫语句 ====================

/**
 * 判断一条字符串是不是「假查询」——即 provider/工具的错误或限流通知，
 * 而非真实搜索词。
 *
 * 背景（2026-05-25 生产事故）：deepseek key 缺失时，generateSearchQueries 的
 * LLM 调用软失败，response.content 被填成限流文案（如 "Rate limit exceeded.
 * Please try again in 6 seconds."）。旧代码直接把 content 按行切成查询词，于是
 * 限流文案被 enhanceQueryWithTimestamp 追加 " 2026" 后回灌进 web-search →
 * DDG 再对这条垃圾查询报 VQD 失败，刷屏错误日志、浪费请求配额。
 *
 * 这里在「接受查询」处统一拦截：任何命中限流/错误/配额语义、或长得根本不像
 * 查询词（过长 / 含标准错误句式）的字符串都丢弃。
 */
function isJunkSearchQuery(raw: string): boolean {
  const q = raw.trim();
  if (q.length === 0) return true;
  // 真实搜索词极少超过 ~120 字符；错误句子/堆栈往往很长
  if (q.length > 160) return true;
  return /rate.?limit|too many requests|try again in \d|quota|exceeded|no api key|api key|unauthorized|forbidden|service unavailable|service temporarily|429|5\d{2}\s|insufficient|not enough credits|timed? ?out|请稍后|请求过于频繁|超出.*限额|配额|密钥|无可用/i.test(
    q,
  );
}

// ==================== Action Tool Types ====================

/**
 * Leader 动作类型
 */
export enum LeaderActionType {
  CREATE_DIMENSION = "CREATE_DIMENSION",
  DELETE_DIMENSION = "DELETE_DIMENSION",
  UPDATE_DIMENSION = "UPDATE_DIMENSION",
  MERGE_DIMENSIONS = "MERGE_DIMENSIONS",
  CANCEL_TASK = "CANCEL_TASK",
  PAUSE_TASK = "PAUSE_TASK",
  RESUME_TASK = "RESUME_TASK",
  REORDER_DIMENSIONS = "REORDER_DIMENSIONS",
  NO_ACTION = "NO_ACTION",
}

/**
 * Leader 动作执行结果
 */
export interface LeaderActionResult {
  success: boolean;
  action: LeaderActionType;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * 创建维度参数
 */
export interface CreateDimensionParams {
  topicId: string;
  name: string;
  description?: string;
  /**
   * 可选：当前 mission ID。
   * dim 表已按 (topicId, missionId) 严格隔离，传入后该 dim 会被绑定到此 mission；
   * 未传则落 NULL（legacy 行为）。
   */
  missionId?: string;
}

/**
 * 删除维度参数
 */
export interface DeleteDimensionParams {
  topicId: string;
  dimensionId?: string;
  dimensionName?: string;
}

/**
 * 更新维度参数
 */
export interface UpdateDimensionParams {
  topicId: string;
  dimensionId?: string;
  dimensionName?: string;
  newName?: string;
  newDescription?: string;
}

/**
 * 取消任务参数
 */
export interface CancelTaskParams {
  topicId: string;
  taskId?: string;
  taskName?: string;
  dimensionName?: string;
}

/**
 * 合并维度参数
 */
export interface MergeDimensionsParams {
  topicId: string;
  /** 源维度名称（将被合并到目标维度） */
  sourceDimensionNames: string[];
  /** 目标维度名称 */
  targetDimensionName: string;
}

/**
 * Leader 搜索上下文
 */
export interface LeaderSearchContext {
  topicName: string;
  topicDescription?: string;
  dimensionName: string;
  searchTimeRange?: string;
  userId?: string;
}

/**
 * Leader 搜索结果
 */
export interface LeaderSearchResult {
  query: string;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    publishedAt?: string;
    domain?: string;
  }>;
  currentDate: string;
  freshnessRequirement: string;
}

/**
 * Leader 规划上下文增强
 */
export interface EnhancedPlanningContext {
  currentDate: string;
  freshnessRequirement: string;
  latestSearchResults: LeaderSearchResult[];
  contextSummary: string;
}

@Injectable()
export class LeaderToolService {
  private readonly logger = new Logger(LeaderToolService.name);

  constructor(
    private readonly chatFacade: ChatFacade,
    private readonly toolFacade: ToolFacade,
    private readonly toolRegistry: ToolRegistry,
    private readonly prisma: PrismaService,
  ) {}

  // ==================== Action Tools ====================

  /**
   * ★ 创建新维度
   * Leader 可以通过此方法创建新的研究维度
   */
  async createDimension(
    params: CreateDimensionParams,
  ): Promise<LeaderActionResult> {
    const { topicId, name, description, missionId } = params;
    this.logger.log(
      `[createDimension] Creating dimension "${name}" for topic ${topicId} (mission=${missionId ?? "none"})`,
    );

    try {
      // ★ 在 mission scope 内查重（与新 schema 隔离一致）
      const scopeFilter = missionId
        ? { topicId, missionId }
        : { topicId, missionId: null };

      // 1) 严格匹配
      let existing = await this.prisma.topicDimension.findFirst({
        where: { ...scopeFilter, name },
      });

      // 2) 归一化兜底（忽略大小写/前后空格）
      if (!existing) {
        const normalizedName = name.trim().toLowerCase();
        const candidates =
          (await this.prisma.topicDimension.findMany({
            where: scopeFilter,
            select: { id: true, name: true },
          })) ?? [];
        const fuzzy = candidates.find(
          (d) => d.name.trim().toLowerCase() === normalizedName,
        );
        if (fuzzy) {
          existing = await this.prisma.topicDimension.findUnique({
            where: { id: fuzzy.id },
          });
        }
      }

      if (existing) {
        return {
          success: false,
          action: LeaderActionType.CREATE_DIMENSION,
          message: `维度「${name}」已存在，无需重复创建`,
        };
      }

      // 获取当前最大排序（限定 mission scope）
      const maxOrder = await this.prisma.topicDimension.aggregate({
        where: scopeFilter,
        _max: { sortOrder: true },
      });

      // 创建新维度
      const dimension = await this.prisma.topicDimension.create({
        data: {
          topicId,
          missionId: missionId ?? null,
          name,
          description: description || `关于${name}的研究维度`,
          sortOrder: (maxOrder._max.sortOrder || 0) + 1,
          status: DimensionStatus.PENDING,
        },
      });

      this.logger.log(
        `[createDimension] Successfully created dimension: ${dimension.id}`,
      );

      return {
        success: true,
        action: LeaderActionType.CREATE_DIMENSION,
        message: `已成功创建研究维度「${name}」`,
        data: { dimensionId: dimension.id, name: dimension.name },
      };
    } catch (error) {
      this.logger.error(`[createDimension] Failed: ${error}`);
      return {
        success: false,
        action: LeaderActionType.CREATE_DIMENSION,
        message: `创建维度失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * ★ 删除维度
   * Leader 可以通过此方法删除研究维度
   */
  async deleteDimension(
    params: DeleteDimensionParams,
  ): Promise<LeaderActionResult> {
    const { topicId, dimensionId, dimensionName } = params;
    this.logger.log(
      `[deleteDimension] Deleting dimension for topic ${topicId}`,
    );

    try {
      // 查找维度（通过 ID 或名称）
      let dimension;
      if (dimensionId) {
        dimension = await this.prisma.topicDimension.findUnique({
          where: { id: dimensionId },
        });
      } else if (dimensionName) {
        dimension = await this.prisma.topicDimension.findFirst({
          where: {
            topicId,
            name: { contains: dimensionName, mode: "insensitive" },
          },
        });
      }

      if (!dimension) {
        return {
          success: false,
          action: LeaderActionType.DELETE_DIMENSION,
          message: `未找到匹配的维度「${dimensionName || dimensionId}」`,
        };
      }

      // 先检查是否有正在执行的 Mission 引用此维度，如有则跳过删除（避免 FK violation）
      const inFlightMissionCount = await this.prisma.researchMission.count({
        where: {
          topicId,
          status: {
            in: [
              ResearchMissionStatus.EXECUTING,
              ResearchMissionStatus.REVIEWING,
            ],
          },
          tasks: {
            some: { dimensionId: dimension.id },
          },
        },
      });

      if (inFlightMissionCount > 0) {
        this.logger.warn(
          `[deleteDimension] Skipping deletion of dimension ${dimension.name}: ${inFlightMissionCount} in-flight mission(s) still reference it`,
        );
        return {
          success: false,
          action: LeaderActionType.DELETE_DIMENSION,
          message: `维度「${dimension.name}」有 ${inFlightMissionCount} 个正在执行的任务，无法删除`,
          data: { dimensionId: dimension.id, name: dimension.name },
        };
      }

      // 无 in-flight mission 后，取消残留的 PENDING/EXECUTING 任务
      const runningTasks = await this.prisma.researchTask.count({
        where: {
          dimensionId: dimension.id,
          status: {
            in: [ResearchTaskStatus.PENDING, ResearchTaskStatus.EXECUTING],
          },
        },
      });

      if (runningTasks > 0) {
        await this.prisma.researchTask.updateMany({
          where: {
            dimensionId: dimension.id,
            status: {
              in: [ResearchTaskStatus.PENDING, ResearchTaskStatus.EXECUTING],
            },
          },
          data: { status: ResearchTaskStatus.FAILED },
        });
      }

      // 删除维度
      await this.prisma.topicDimension.delete({
        where: { id: dimension.id },
      });

      this.logger.log(
        `[deleteDimension] Successfully deleted dimension: ${dimension.name}`,
      );

      return {
        success: true,
        action: LeaderActionType.DELETE_DIMENSION,
        message: `已成功删除研究维度「${dimension.name}」${runningTasks > 0 ? `，并取消了 ${runningTasks} 个相关任务` : ""}`,
        data: { dimensionId: dimension.id, name: dimension.name },
      };
    } catch (error) {
      this.logger.error(`[deleteDimension] Failed: ${error}`);
      return {
        success: false,
        action: LeaderActionType.DELETE_DIMENSION,
        message: `删除维度失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * ★ 取消任务
   * Leader 可以通过此方法取消正在执行的任务
   */
  async cancelTask(params: CancelTaskParams): Promise<LeaderActionResult> {
    const { topicId, taskId, taskName, dimensionName } = params;
    this.logger.log(`[cancelTask] Cancelling task for topic ${topicId}`);

    try {
      // 查找任务
      let task;
      if (taskId) {
        task = await this.prisma.researchTask.findUnique({
          where: { id: taskId },
        });
      } else if (dimensionName) {
        // 通过维度名称查找任务
        const dimension = await this.prisma.topicDimension.findFirst({
          where: {
            topicId,
            name: { contains: dimensionName, mode: "insensitive" },
          },
        });
        if (dimension) {
          task = await this.prisma.researchTask.findFirst({
            where: {
              dimensionId: dimension.id,
              status: {
                in: [ResearchTaskStatus.PENDING, ResearchTaskStatus.EXECUTING],
              },
            },
          });
        }
      } else if (taskName) {
        task = await this.prisma.researchTask.findFirst({
          where: {
            dimensionName: { contains: taskName, mode: "insensitive" },
            mission: { topicId },
            status: {
              in: [ResearchTaskStatus.PENDING, ResearchTaskStatus.EXECUTING],
            },
          },
        });
      }

      if (!task) {
        return {
          success: false,
          action: LeaderActionType.CANCEL_TASK,
          message: `未找到匹配的任务「${taskName || dimensionName || taskId}」`,
        };
      }

      if (task.status === ResearchTaskStatus.FAILED) {
        return {
          success: true,
          action: LeaderActionType.CANCEL_TASK,
          message: `任务「${task.dimensionName || task.id}」已经是取消状态`,
        };
      }

      // 取消任务
      await this.prisma.researchTask.update({
        where: { id: task.id },
        data: { status: ResearchTaskStatus.FAILED },
      });

      this.logger.log(
        `[cancelTask] Successfully cancelled task: ${task.dimensionName}`,
      );

      return {
        success: true,
        action: LeaderActionType.CANCEL_TASK,
        message: `已成功取消任务「${task.dimensionName || task.id}」`,
        data: { taskId: task.id, dimensionName: task.dimensionName },
      };
    } catch (error) {
      this.logger.error(`[cancelTask] Failed: ${error}`);
      return {
        success: false,
        action: LeaderActionType.CANCEL_TASK,
        message: `取消任务失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * ★ 更新维度
   * Leader 可以通过此方法更新维度名称或描述
   */
  async updateDimension(
    params: UpdateDimensionParams,
  ): Promise<LeaderActionResult> {
    const { topicId, dimensionId, dimensionName, newName, newDescription } =
      params;
    this.logger.log(
      `[updateDimension] Updating dimension for topic ${topicId}`,
    );

    try {
      // 查找维度
      let dimension;
      if (dimensionId) {
        dimension = await this.prisma.topicDimension.findUnique({
          where: { id: dimensionId },
        });
      } else if (dimensionName) {
        dimension = await this.prisma.topicDimension.findFirst({
          where: {
            topicId,
            name: { contains: dimensionName, mode: "insensitive" },
          },
        });
      }

      if (!dimension) {
        return {
          success: false,
          action: LeaderActionType.UPDATE_DIMENSION,
          message: `未找到匹配的维度「${dimensionName || dimensionId}」`,
        };
      }

      // 构建更新数据
      const updateData: { name?: string; description?: string } = {};
      if (newName) updateData.name = newName;
      if (newDescription) updateData.description = newDescription;

      if (Object.keys(updateData).length === 0) {
        return {
          success: false,
          action: LeaderActionType.UPDATE_DIMENSION,
          message: "没有提供需要更新的内容",
        };
      }

      // 更新维度
      const updated = await this.prisma.topicDimension.update({
        where: { id: dimension.id },
        data: updateData,
      });

      this.logger.log(
        `[updateDimension] Successfully updated dimension: ${updated.name}`,
      );

      return {
        success: true,
        action: LeaderActionType.UPDATE_DIMENSION,
        message: `已成功更新维度「${dimension.name}」${newName ? ` -> 「${newName}」` : ""}`,
        data: { dimensionId: updated.id, name: updated.name },
      };
    } catch (error) {
      this.logger.error(`[updateDimension] Failed: ${error}`);
      return {
        success: false,
        action: LeaderActionType.UPDATE_DIMENSION,
        message: `更新维度失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * ★ 批量创建维度（用于拆分场景）
   */
  async createMultipleDimensions(
    topicId: string,
    dimensions: Array<{ name: string; description?: string }>,
  ): Promise<LeaderActionResult> {
    this.logger.log(
      `[createMultipleDimensions] Creating ${dimensions.length} dimensions for topic ${topicId}`,
    );

    const results: LeaderActionResult[] = [];
    for (const dim of dimensions) {
      const result = await this.createDimension({
        topicId,
        name: dim.name,
        description: dim.description,
      });
      results.push(result);
    }

    const successCount = results.filter((r) => r.success).length;
    const successNames = results
      .filter((r) => r.success)
      .map((r) => r.data?.name)
      .join("、");

    return {
      success: successCount > 0,
      action: LeaderActionType.CREATE_DIMENSION,
      message:
        successCount === dimensions.length
          ? `已成功创建 ${successCount} 个研究维度：${successNames}`
          : `创建了 ${successCount}/${dimensions.length} 个维度`,
      data: { created: successCount, total: dimensions.length },
    };
  }

  /**
   * ★ 合并维度
   * 将一个或多个源维度的内容合并到目标维度，然后删除源维度
   */
  async mergeDimensions(
    params: MergeDimensionsParams,
  ): Promise<LeaderActionResult> {
    const { topicId, sourceDimensionNames, targetDimensionName } = params;
    this.logger.log(
      `[mergeDimensions] Merging dimensions ${sourceDimensionNames.join(", ")} into "${targetDimensionName}" for topic ${topicId}`,
    );

    try {
      // 1. 查找目标维度
      const targetDimension = await this.prisma.topicDimension.findFirst({
        where: {
          topicId,
          name: { contains: targetDimensionName, mode: "insensitive" },
        },
      });

      if (!targetDimension) {
        return {
          success: false,
          action: LeaderActionType.MERGE_DIMENSIONS,
          message: `未找到目标维度「${targetDimensionName}」`,
        };
      }

      // 2. 查找所有源维度
      const sourceDimensions = await this.prisma.topicDimension.findMany({
        where: {
          topicId,
          OR: sourceDimensionNames.map((name) => ({
            name: { contains: name, mode: "insensitive" as const },
          })),
        },
      });

      if (sourceDimensions.length === 0) {
        return {
          success: false,
          action: LeaderActionType.MERGE_DIMENSIONS,
          message: `未找到任何源维度：${sourceDimensionNames.join(", ")}`,
        };
      }

      // 3. 合并描述信息
      const sourceDescriptions = sourceDimensions
        .map((d) => d.description)
        .filter(Boolean)
        .join("\n\n");

      const mergedDescription = targetDimension.description
        ? `${targetDimension.description}\n\n--- 合并内容 ---\n${sourceDescriptions}`
        : sourceDescriptions;

      // 4. 将源维度的任务转移到目标维度
      for (const sourceDim of sourceDimensions) {
        if (sourceDim.id !== targetDimension.id) {
          await this.prisma.researchTask.updateMany({
            where: { dimensionId: sourceDim.id },
            data: { dimensionId: targetDimension.id },
          });
        }
      }

      // 5. 更新目标维度描述
      await this.prisma.topicDimension.update({
        where: { id: targetDimension.id },
        data: { description: mergedDescription },
      });

      // 6. 删除源维度（排除目标维度）
      const sourceIdsToDelete = sourceDimensions
        .filter((d) => d.id !== targetDimension.id)
        .map((d) => d.id);

      if (sourceIdsToDelete.length > 0) {
        await this.prisma.topicDimension.deleteMany({
          where: { id: { in: sourceIdsToDelete } },
        });
      }

      const mergedNames = sourceDimensions.map((d) => d.name).join("、");
      this.logger.log(
        `[mergeDimensions] Successfully merged ${sourceDimensions.length} dimensions into "${targetDimension.name}"`,
      );

      return {
        success: true,
        action: LeaderActionType.MERGE_DIMENSIONS,
        message: `已成功将「${mergedNames}」合并到「${targetDimension.name}」`,
        data: {
          targetDimensionId: targetDimension.id,
          mergedCount: sourceDimensions.length,
        },
      };
    } catch (error) {
      this.logger.error(`[mergeDimensions] Failed: ${error}`);
      return {
        success: false,
        action: LeaderActionType.MERGE_DIMENSIONS,
        message: `合并维度失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ==================== Function Calling (Gap 2) ====================

  /**
   * ★ Gap 2: Leader 自主搜索（Function Calling 模式）
   * LLM 根据研究主题自主决定调用哪些工具，而非手动编排工具调用。
   *
   * 降级：如果 ToolFacade 不可用，回退到现有 searchLatestData()
   */
  async leaderAgenticSearch(params: {
    topicName: string;
    topicType: string;
    researchQuestion: string;
    maxToolCalls?: number;
  }): Promise<{ content: string; toolsUsed: string[]; tokensUsed: number }> {
    if (!this.toolFacade.isToolExecutionAvailable()) {
      this.logger.debug(
        "[leaderAgenticSearch] Tool execution unavailable, falling back to searchLatestData",
      );
      const results = await this.searchLatestData({
        topicName: params.topicName,
        dimensionName: params.researchQuestion,
      });
      const summary = results
        .flatMap((r) => r.results.map((item) => item.snippet))
        .join("\n");
      return { content: summary, toolsUsed: [], tokensUsed: 0 };
    }

    const context: AICapabilityContext = {
      agentId: "topic-insights-leader",
      userId: "system",
      domain: "research",
    };

    try {
      const result = await this.toolFacade.chatWithTools({
        messages: [
          {
            role: "system",
            content:
              `你是一位专业研究助手。请使用可用工具搜索和分析关于「${params.topicName}」（${params.topicType}）的最新信息。` +
              `研究问题：${params.researchQuestion}`,
          },
          { role: "user", content: params.researchQuestion },
        ],
        context,
        modelType: AIModelType.CHAT,
        taskProfile: { creativity: "low", outputLength: "medium" },
        maxToolCalls: params.maxToolCalls ?? 5,
      });

      return {
        content: result.content || "",
        toolsUsed: result.toolCalls?.map((tc) => tc.toolId) || [],
        tokensUsed: result.tokensUsed || 0,
      };
    } catch (error) {
      this.logger.warn(`[leaderAgenticSearch] Failed: ${error}`);
      return { content: "", toolsUsed: [], tokensUsed: 0 };
    }
  }

  // ==================== Existing Search Tools ====================

  /**
   * Leader 主动搜索获取最新数据
   * ★ 通过 ToolRegistry 调用 web-search 工具，不再直接调用 SearchService
   *
   * @param context 搜索上下文
   * @param queries 搜索查询列表（可选，Leader 也可以自己生成）
   * @param capabilityContext AI 能力上下文（用于检查工具可用性）
   * @returns 搜索结果
   */
  async searchLatestData(
    context: LeaderSearchContext,
    queries?: string[],
    capabilityContext?: AICapabilityContext,
  ): Promise<LeaderSearchResult[]> {
    const currentDate = getCurrentDateString();
    const freshnessRequirement = getFreshnessRequirementDescription(
      context.searchTimeRange,
    );

    this.logger.log(
      `[searchLatestData] Leader searching for dimension: ${context.dimensionName}`,
    );

    // ★ 检查 web-search 工具是否可用
    // 2026-05-13 P2-#20: 之前 capability 返空就 return []，但 P0 fix 已让
    //   tool.facade capabilityResolver missing 时 fallback []，那条 warn 实际
    //   非"web-search 被禁"而是"capability resolver 没接 DI"。改成：
    //   capability 返空时 → 直接信任 ToolRegistry（代码层 source of truth），
    //   不阻断 leader 搜索。否则用户每次 mission 都看到一片 web-search 假警告。
    if (capabilityContext) {
      const availableTools = await this.toolFacade
        .capabilityResolveTools(capabilityContext)
        .catch(() => [] as string[]);
      if (availableTools.length > 0 && !availableTools.includes("web-search")) {
        // 仅当 capability resolver 真的明确返非空列表 + 不含 web-search 时
        // 才视为被 admin 禁用。空列表 = resolver 未接 / 资源未就绪，走 fallback。
        this.logger.warn(
          "[searchLatestData] web-search tool disabled by capability resolver (admin)",
        );
        return [];
      }
      if (availableTools.length === 0) {
        this.logger.debug(
          "[searchLatestData] capability resolver returned empty; falling back to ToolRegistry",
        );
      }
    }

    // ★ 通过 ToolRegistry 获取 web-search 工具
    const webSearchTool = this.toolRegistry.tryGet("web-search");
    if (!webSearchTool) {
      this.logger.error(
        "[searchLatestData] web-search tool not registered in ToolRegistry",
      );
      return [];
    }

    // 如果没有提供查询，让 Leader 生成查询
    const rawQueries =
      queries && queries.length > 0
        ? queries
        : await this.generateSearchQueries(context);

    // ★ 2026-05-25 防御层：无论查询来自调用方还是 LLM 生成，都先剔除限流/
    //   错误文案这类「假查询」（见 isJunkSearchQuery）。全被剔光时退回确定性
    //   查询，避免把垃圾字符串发给 web-search 刷错误日志 + 浪费配额。
    const cleanQueries = rawQueries.filter((q) => !isJunkSearchQuery(q));
    if (cleanQueries.length < rawQueries.length) {
      this.logger.warn(
        `[searchLatestData] Dropped ${rawQueries.length - cleanQueries.length} junk quer${
          rawQueries.length - cleanQueries.length === 1 ? "y" : "ies"
        } (rate-limit/error notices) for dimension: ${context.dimensionName}`,
      );
    }
    const searchQueries =
      cleanQueries.length > 0
        ? cleanQueries
        : [
            `${context.topicName} ${context.dimensionName} ${new Date().getFullYear()}`,
          ];

    const results: LeaderSearchResult[] = [];

    for (const query of searchQueries.slice(0, 3)) {
      // 最多 3 个查询
      const enhancedQuery = this.enhanceQueryWithTimestamp(query);

      this.logger.debug(`[searchLatestData] Searching: "${enhancedQuery}"`);

      try {
        // ★ 通过工具系统执行搜索
        const toolResult = await webSearchTool.execute(
          {
            query: enhancedQuery,
            numResults: 5,
            language: "auto",
          },
          {
            executionId: `leader-search-${Date.now()}`,
            toolId: "web-search",
            taskId: capabilityContext?.agentId || "leader",
            userId: context.userId || capabilityContext?.userId,
            callerType: "agent",
            createdAt: new Date(),
          },
        );

        if (toolResult.success && toolResult.data) {
          const searchData = toolResult.data as {
            results: Array<{
              title: string;
              url: string;
              content: string;
              publishedDate?: string;
              domain?: string;
            }>;
            success: boolean;
          };

          if (searchData.success && searchData.results) {
            results.push({
              query: enhancedQuery,
              results: searchData.results.map((r) => ({
                title: r.title,
                url: r.url,
                snippet: r.content,
                publishedAt: r.publishedDate,
                domain: r.domain,
              })),
              currentDate,
              freshnessRequirement,
            });
          } else {
            this.logger.warn(
              `[searchLatestData] Search API returned failure for query "${enhancedQuery}": ${(searchData as Record<string, unknown>).error ?? "unknown error"}`,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `[searchLatestData] Search failed for query "${query}": ${error}`,
        );
      }
    }

    this.logger.log(
      `[searchLatestData] Completed ${results.length} searches with ${results.reduce((sum, r) => sum + r.results.length, 0)} total results`,
    );

    // Note: capability usage logging is handled internally by the facade

    return results;
  }

  /**
   * 生成增强的规划上下文
   * ★ 包含当前日期、时效性要求、最新搜索结果摘要
   *
   * @param context 搜索上下文
   * @param capabilityContext AI 能力上下文（用于检查工具可用性）
   * @returns 增强的规划上下文
   */
  async generateEnhancedPlanningContext(
    context: LeaderSearchContext,
    capabilityContext?: AICapabilityContext,
  ): Promise<EnhancedPlanningContext> {
    const currentDate = getCurrentDateString();
    const freshnessRequirement = getFreshnessRequirementDescription(
      context.searchTimeRange,
    );

    // ★ 检查工具可用性（如果提供了 capability context）
    // 2026-05-13 P2-#20: 同 searchLatestData，capability 返空时不阻断；
    //   交给 searchLatestData 内部的 ToolRegistry fallback。
    if (capabilityContext) {
      const availableTools = await this.toolFacade
        .capabilityResolveTools(capabilityContext)
        .catch(() => [] as string[]);
      this.logger.log(
        `[generateEnhancedPlanningContext] Available tools for Leader: ${availableTools.join(", ") || "(empty — falling back to ToolRegistry)"}`,
      );

      // 仅当 capability resolver 明确返非空列表 + 不含 web-search 时才阻断
      if (availableTools.length > 0 && !availableTools.includes("web-search")) {
        this.logger.warn(
          "[generateEnhancedPlanningContext] web-search tool disabled by capability resolver",
        );
        return {
          currentDate,
          freshnessRequirement,
          latestSearchResults: [],
          contextSummary:
            "（工具不可用：admin 已禁用 web-search，无法获取最新数据，请基于已有证据进行分析）",
        };
      }
    }

    // 先进行搜索获取最新数据（传递 capabilityContext）
    const searchResults = await this.searchLatestData(
      context,
      undefined,
      capabilityContext,
    );

    // 生成上下文摘要
    const contextSummary = await this.summarizeSearchResults(
      context,
      searchResults,
    );

    return {
      currentDate,
      freshnessRequirement,
      latestSearchResults: searchResults,
      contextSummary,
    };
  }

  /**
   * 让 Leader 自己生成搜索查询
   */
  private async generateSearchQueries(
    context: LeaderSearchContext,
  ): Promise<string[]> {
    const currentYear = new Date().getFullYear();

    const prompt = `你是一位研究助手，需要为以下研究任务生成搜索查询词。

## 当前日期
${getCurrentDateString()}

## 研究主题
- 主题名称: ${context.topicName}
- 主题描述: ${context.topicDescription || "无"}

## 研究维度
${context.dimensionName}

## 任务
生成 3 个有效的搜索查询词，用于获取该维度的最新信息。
要求:
1. 查询要精准，能找到最新、最权威的信息
2. 包含当前年份 ${currentYear} 或 "latest" 等时效性关键词
3. 每个查询应该覆盖不同角度

直接输出 3 个查询词，每行一个，不要编号或解释。`;

    try {
      const response = await this.chatFacade.chat({
        messages: [{ role: "user", content: prompt }],
        operationName: "工具调用",
        modelType: AIModelType.CHAT_FAST,
        skipGuardrails: true, // 内部系统调用，生成搜索查询
        taskProfile: {
          creativity: "low",
          outputLength: "minimal",
        },
      });

      const queries = response.content
        .split("\n")
        .map((q) => q.trim())
        .filter((q) => q.length > 0)
        // ★ 2026-05-25: 过滤 provider 软失败时混进 content 的限流/错误文案，
        //   否则会被当成查询词回灌进 web-search（见 isJunkSearchQuery 注释）。
        .filter((q) => !isJunkSearchQuery(q))
        .slice(0, 3);

      return queries.length > 0
        ? queries
        : [`${context.topicName} ${context.dimensionName} ${currentYear}`];
    } catch (error) {
      this.logger.warn(
        `[generateSearchQueries] Failed to generate queries: ${error}`,
      );
      const year = new Date().getFullYear();
      return [
        `${context.topicName} ${context.dimensionName} ${year}`,
        `${context.dimensionName} ${context.topicName} ${year}`,
      ];
    }
  }

  /**
   * 增强搜索查询，添加时间戳关键词
   */
  private enhanceQueryWithTimestamp(query: string): string {
    const currentYear = new Date().getFullYear();
    const hasYearOrLatest = /20\d{2}|latest|recent|最新|最近/i.test(query);

    if (hasYearOrLatest) {
      return query;
    }

    return `${query} ${currentYear}`;
  }

  /**
   * 汇总搜索结果为上下文描述
   */
  private async summarizeSearchResults(
    context: LeaderSearchContext,
    searchResults: LeaderSearchResult[],
  ): Promise<string> {
    if (
      searchResults.length === 0 ||
      searchResults.every((r) => r.results.length === 0)
    ) {
      return "暂无最新搜索结果，请基于已有证据进行分析。";
    }

    const allResults = searchResults.flatMap((r) => r.results);
    const uniqueResults = this.deduplicateResults(allResults);

    // 生成摘要
    const resultsText = uniqueResults
      .slice(0, 10)
      .map(
        (r, i) =>
          `${i + 1}. [${r.domain || "未知来源"}] ${r.title}${r.publishedAt ? ` (${r.publishedAt})` : ""}`,
      )
      .join("\n");

    const prompt = `请根据以下搜索结果，为研究维度「${context.dimensionName}」生成一段简要的背景概述（100-150字）。

搜索结果:
${resultsText}

要求:
1. 概述该领域的当前状态和最新发展
2. 指出主要的趋势或关注点
3. 用客观、简洁的语言
4. 直接输出概述，不要添加标题或前缀`;

    try {
      const response = await this.chatFacade.chat({
        messages: [{ role: "user", content: prompt }],
        operationName: "工具结果分析",
        modelType: AIModelType.CHAT_FAST,
        skipGuardrails: true, // 内部系统调用，搜索结果摘要含外部数据
        taskProfile: {
          creativity: "low",
          outputLength: "short",
        },
      });

      return response.content.trim();
    } catch (error) {
      this.logger.warn(
        `[summarizeSearchResults] Failed to summarize: ${error}`,
      );
      return `找到 ${uniqueResults.length} 条相关结果，涵盖 ${context.dimensionName} 的最新动态。`;
    }
  }

  /**
   * 去重搜索结果
   */
  private deduplicateResults(
    results: Array<{
      title: string;
      url: string;
      snippet: string;
      publishedAt?: string;
      domain?: string;
    }>,
  ): typeof results {
    const seen = new Set<string>();
    return results.filter((r) => {
      if (!r.url) return true; // 保留没有 URL 的结果
      const key = r.url.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}
