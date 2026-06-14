import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { toPrismaJson } from "@/common/utils/prisma-json.utils";
import { EventSourceParsingService } from "./event-source-parsing.service";
import {
  CreateTopicDto,
  UpdateTopicDto,
  ListTopicsDto,
  ListLogsDto,
} from "../../../dto";
import {
  ResearchTopicStatus,
  RefreshFrequency,
  DimensionStatus,
  Prisma,
  type TopicDimension,
} from "@prisma/client";

/**
 * TopicCrudService
 *
 * 负责专题的 CRUD 操作、列表查询、统计数据
 */
@Injectable()
export class TopicCrudService {
  private readonly logger = new Logger(TopicCrudService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventSourceParsing: EventSourceParsingService,
  ) {}

  /**
   * 创建专题
   *
   * ★ v8.0: 不再使用固定模板创建维度
   * - 如果用户提供了自定义维度，使用用户的
   * - 否则不创建任何维度，等到开始研究时由 Leader AI 自主规划
   * - 这确保了维度与主题名称的语义匹配，而不是使用通用模板
   */
  async createTopic(userId: string, dto: CreateTopicDto) {
    this.logger.log(`Creating topic for user ${userId}: ${dto.name}`);
    // ★ Debug: 详细记录接收到的 topicConfig
    this.logger.log(
      `★ [createTopic] Received topicConfig: ${JSON.stringify(dto.topicConfig)}`,
    );
    this.logger.log(
      `★ [createTopic] Full DTO keys: ${Object.keys(dto).join(", ")}`,
    );

    // ★ v8.0: 只有用户明确提供维度时才创建
    // 否则维度将在研究开始时由 Leader AI 根据主题名称动态规划
    const dimensionsToCreate =
      dto.dimensions && dto.dimensions.length > 0 ? dto.dimensions : [];

    // 使用事务创建专题和维度
    const result = await this.prisma.$transaction(async (tx) => {
      // 创建专题
      const topic = await tx.researchTopic.create({
        data: {
          userId,
          name: dto.name,
          description: dto.description,
          type: dto.type,
          topicConfig: toPrismaJson(dto.topicConfig || {}),
          icon: dto.icon,
          color: dto.color,
          refreshFrequency: dto.refreshFrequency || RefreshFrequency.MANUAL,
          visibility: dto.visibility || "PRIVATE", // ★ 默认私有
          language: dto.language || "zh",
          status: ResearchTopicStatus.DRAFT,
        },
      });

      // 只有用户提供了自定义维度时才创建
      let dimensions: TopicDimension[] = [];
      if (dimensionsToCreate.length > 0) {
        dimensions = await Promise.all(
          dimensionsToCreate.map((dim, index) =>
            tx.topicDimension.create({
              data: {
                topicId: topic.id,
                name: dim.name,
                description: dim.description,
                sortOrder: dim.sortOrder ?? index + 1,
                searchQueries: dim.searchQueries || [],
                searchSources: dim.searchSources || [],
                minSources: dim.minSources ?? 5,
                isEnabled: "isEnabled" in dim ? (dim.isEnabled ?? true) : true,
                status: DimensionStatus.PENDING,
              },
            }),
          ),
        );
        this.logger.log(
          `Created topic ${topic.id} with ${dimensions.length} user-defined dimensions`,
        );
      } else {
        this.logger.log(
          `Created topic ${topic.id} without dimensions (will be planned by Leader AI)`,
        );
      }

      return {
        ...topic,
        dimensions,
      };
    });

    // ★ EVENT 类型：异步解析锚定文章（fire-and-forget，不阻塞响应）
    if (dto.type === "EVENT") {
      void this.eventSourceParsing.parseEventSourceAsync(result.id);
    }

    return result;
  }

  /**
   * 获取专题列表
   *
   * 权限规则：
   * - 私有(PRIVATE)：只有创建者可见
   * - 团队(SHARED)：创建者 + 协作者可见
   * - 公开(PUBLIC)：所有登录用户可见
   */
  async listTopics(userId: string, query: ListTopicsDto) {
    const { type, status, search, skip = 0, take = 20 } = query;

    // 单次查询完成权限过滤，避免两步查询
    // 权限规则：
    // 1. 自己创建的（任何 visibility）
    // 2. visibility 为 PUBLIC 的
    // 3. 自己是协作者且 isActive=true 的（visibility 为 SHARED）
    const visibilityFilter: Prisma.ResearchTopicWhereInput = {
      OR: [
        { userId },
        { visibility: "PUBLIC" },
        {
          visibility: "SHARED",
          collaborators: { some: { userId, isActive: true } },
        },
      ],
    };

    const andFilters: Prisma.ResearchTopicWhereInput[] = [visibilityFilter];

    if (type) {
      andFilters.push({ type });
    }

    if (status) {
      andFilters.push({ status });
    }

    if (search) {
      andFilters.push({
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    const where: Prisma.ResearchTopicWhereInput = { AND: andFilters };

    // 并行执行查询和计数
    const [rawTopics, total] = await Promise.all([
      this.prisma.researchTopic.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          dimensions: {
            orderBy: { sortOrder: "asc" },
            select: {
              id: true,
              name: true,
              status: true,
              sortOrder: true,
            },
          },
          // ★ 包含最新【有内容的】报告以获取 totalSources 和 lastRefreshAt
          // 跳过空草稿报告（需有维度分析记录）
          reports: {
            where: {
              dimensionAnalyses: { some: {} },
            },
            orderBy: { generatedAt: "desc" },
            take: 1,
            select: {
              id: true,
              totalSources: true,
              generatedAt: true,
            },
          },
          // ★ 包含最新 Mission 以获取任务进度（Card 显示用）
          missions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              totalTasks: true,
              completedTasks: true,
              progressPercent: true,
            },
          },
          _count: {
            select: {
              reports: true,
              dimensions: true,
            },
          },
        },
      }),
      this.prisma.researchTopic.count({ where }),
    ]);

    // ★ 映射数据，确保 totalReports/totalSources/lastRefreshAt 从实际数据计算
    const topics = rawTopics.map((topic) => {
      const latestReport = topic.reports?.[0];
      const latestMission = topic.missions?.[0];
      return {
        ...topic,
        totalReports: topic._count?.reports || 0,
        totalSources: latestReport?.totalSources || topic.totalSources || 0,
        lastRefreshAt: latestReport?.generatedAt || topic.lastRefreshAt,
        // ★ 任务进度数据（优先使用 Mission 数据，Card 显示用）
        missionTotalTasks: latestMission?.totalTasks ?? 0,
        missionCompletedTasks: latestMission?.completedTasks ?? 0,
        missionProgress: latestMission?.progressPercent ?? 0,
        missionStatus: latestMission?.status ?? null,
        // 移除 reports 和 missions 数组，避免返回多余数据
        reports: undefined,
        missions: undefined,
      };
    });

    return {
      topics,
      total,
      skip,
      take,
    };
  }

  /**
   * 获取专题详情
   *
   * 权限规则：
   * - 私有(PRIVATE)：只有创建者可见
   * - 团队(SHARED)：创建者 + 协作者可见
   * - 公开(PUBLIC)：所有登录用户可见
   */
  async getTopic(userId: string, topicId: string) {
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      include: {
        dimensions: {
          orderBy: { sortOrder: "asc" },
        },
        // ★ 只获取有内容的报告，跳过空草稿（需有维度分析记录）
        reports: {
          where: {
            dimensionAnalyses: { some: {} },
          },
          orderBy: { generatedAt: "desc" },
          take: 1,
          select: {
            id: true,
            version: true,
            generatedAt: true,
            executiveSummary: true,
            totalSources: true,
          },
        },
        _count: {
          select: {
            reports: true,
            refreshLogs: true,
          },
        },
      },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    // 检查访问权限
    const hasAccess = await this.checkTopicAccess(
      userId,
      topicId,
      topic.userId,
    );
    if (!hasAccess) {
      throw new ForbiddenException(
        "You do not have permission to access this topic",
      );
    }

    return topic;
  }

  /**
   * 更新专题
   */
  async updateTopic(userId: string, topicId: string, dto: UpdateTopicDto) {
    // 先验证所有权
    const existing = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      select: { userId: true },
    });

    if (!existing) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    if (existing.userId !== userId) {
      throw new ForbiddenException(
        "You do not have permission to update this topic",
      );
    }

    // 更新专题
    const updated = await this.prisma.researchTopic.update({
      where: { id: topicId },
      data: {
        name: dto.name,
        description: dto.description,
        status: dto.status,
        topicConfig: dto.topicConfig
          ? toPrismaJson(dto.topicConfig)
          : undefined,
        icon: dto.icon,
        color: dto.color,
        refreshFrequency: dto.refreshFrequency,
        language: dto.language,
      },
      include: {
        dimensions: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    this.logger.log(`Updated topic ${topicId}`);
    return updated;
  }

  /**
   * 删除专题
   */
  async deleteTopic(userId: string, topicId: string) {
    // 验证所有权
    const existing = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      select: { userId: true },
    });

    if (!existing) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    if (existing.userId !== userId) {
      throw new ForbiddenException(
        "You do not have permission to delete this topic",
      );
    }

    // 级联删除（Prisma schema 中已配置 onDelete: Cascade）
    await this.prisma.researchTopic.delete({
      where: { id: topicId },
    });

    this.logger.log(`Deleted topic ${topicId}`);
    return { success: true };
  }

  /**
   * 获取研究历史时间线 (Phase 2.3)
   */
  async getResearchHistory(userId: string, topicId: string, limit?: number) {
    // 验证专题读取权限（支持公开专题访问）
    await this.verifyTopicReadAccess(userId, topicId);

    // 获取所有研究任务（Mission）
    const missions = await this.prisma.researchMission.findMany({
      where: { topicId },
      orderBy: { createdAt: "desc" },
      take: limit || 20,
      include: {
        tasks: {
          select: {
            id: true,
            dimensionId: true,
            dimensionName: true, // ★ 包含维度名称
            status: true,
            createdAt: true,
            completedAt: true,
            result: true, // ★ 包含研究结果（关键发现、摘要等）
            // ★ resultUri 必须同时 select，否则 PrismaService hydrate
            //   拉不回 off-loaded 内容（result 会是空 JSON）并打 warning。
            resultUri: true,
            resultSummary: true, // ★ 包含结果摘要
          },
        },
      },
    });

    // 获取所有报告
    const reports = await this.prisma.topicReport.findMany({
      where: { topicId },
      orderBy: { generatedAt: "desc" },
      take: limit || 20,
      select: {
        id: true,
        version: true,
        generatedAt: true,
        totalSources: true,
      },
    });

    // 转换为时间线格式
    const timeline: Array<{
      id: string;
      type: "mission" | "report";
      timestamp: Date;
      title: string;
      description: string;
      status?: string;
      metadata?: Record<string, unknown>;
    }> = [];

    // 添加 Mission 记录（使用索引避免 indexOf 的 O(n²) 性能问题）
    for (let i = 0; i < missions.length; i++) {
      const mission = missions[i];
      const completedTasks = mission.tasks.filter(
        (t) => t.status === "COMPLETED",
      );
      const totalTasks = mission.tasks.length;

      // ★ 提取已完成任务的维度名称
      const dimensionsUpdated = completedTasks
        .filter((t) => t.dimensionName)
        .map((t) => t.dimensionName!);

      // ★ 提取每个维度的研究结果（关键发现、摘要等）
      // 只包含有实际内容的结果（有 summary、keyFindings 或 resultSummary）
      const dimensionResults = completedTasks
        .filter((t) => {
          if (!t.dimensionName) return false;
          // 检查是否有实际内容
          const result = t.result as Record<string, unknown> | null;
          const hasResultContent =
            result &&
            (result.summary ||
              result.keyFindings ||
              result.sourcesFound ||
              result.wordCount);
          return hasResultContent || t.resultSummary;
        })
        .map((t) => ({
          dimensionName: t.dimensionName!,
          result: t.result,
          resultSummary: t.resultSummary,
        }));

      timeline.push({
        id: mission.id,
        type: "mission",
        timestamp: mission.createdAt,
        title: `研究任务 #${i + 1}`,
        description: `完成 ${completedTasks.length}/${totalTasks} 个维度研究`,
        status: mission.status,
        metadata: {
          completedTasks: completedTasks.length,
          totalTasks,
          completedAt: mission.completedAt,
          dimensionsUpdated, // ★ 已更新的维度名称列表
          dimensionResults, // ★ 每个维度的研究结果
        },
      });
    }

    // 添加报告记录
    for (const report of reports) {
      timeline.push({
        id: report.id,
        type: "report",
        timestamp: report.generatedAt,
        title: `研究报告 v${report.version}`,
        description: `${report.totalSources || 0} 条来源`,
        metadata: {
          version: report.version,
          totalSources: report.totalSources,
        },
      });
    }

    // 按时间排序
    timeline.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return {
      timeline,
      totalMissions: missions.length,
      totalReports: reports.length,
    };
  }

  /**
   * 获取刷新日志
   */
  async getLogs(userId: string, topicId: string, query: ListLogsDto) {
    // 验证专题读取权限（支持公开专题访问）
    await this.verifyTopicReadAccess(userId, topicId);

    const where: Record<string, unknown> = { topicId };

    if (query.status) {
      where.status = query.status;
    }

    const [logs, total] = await Promise.all([
      this.prisma.topicRefreshLog.findMany({
        where,
        take: query.limit || 20,
        orderBy: { startedAt: "desc" },
      }),
      this.prisma.topicRefreshLog.count({ where }),
    ]);

    return { logs, total };
  }

  /**
   * 获取专题统计
   */
  async getStats(userId: string, topicId: string) {
    // 验证专题读取权限（支持公开专题访问）
    await this.verifyTopicReadAccess(userId, topicId);

    // 获取专题基本信息
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      include: {
        _count: {
          select: {
            dimensions: true,
            reports: true,
            refreshLogs: true,
          },
        },
      },
    });

    if (!topic) {
      throw new NotFoundException("Topic not found");
    }

    // 获取刷新统计
    const refreshStats = await this.prisma.topicRefreshLog.aggregate({
      where: { topicId },
      _count: true,
      _avg: {
        dimensionsRefreshed: true,
        sourcesFound: true,
      },
    });

    return {
      topic: {
        id: topic.id,
        name: topic.name,
        type: topic.type,
        status: topic.status,
        createdAt: topic.createdAt,
        lastRefreshAt: topic.lastRefreshAt,
      },
      counts: topic._count,
      refreshStats: {
        totalRefreshes: refreshStats._count,
        avgDimensionsRefreshed: refreshStats._avg.dimensionsRefreshed,
        avgSourcesFound: refreshStats._avg.sourcesFound,
      },
    };
  }

  /**
   * ★ 重新计算专题统计数据
   * 用于修复历史数据中 totalReports/totalSources/lastRefreshAt 不正确的问题
   */
  async recalculateTopicStats(userId: string, topicId: string) {
    // 验证专题所有权
    await this.verifyTopicOwnership(userId, topicId);

    // 获取报告统计
    const reportStats = await this.prisma.topicReport.aggregate({
      where: { topicId },
      _count: { id: true },
      _max: { generatedAt: true },
    });

    // 获取最新报告的 totalSources
    const latestReport = await this.prisma.topicReport.findFirst({
      where: { topicId },
      orderBy: { generatedAt: "desc" },
      select: { totalSources: true },
    });

    // 更新专题统计
    const updatedTopic = await this.prisma.researchTopic.update({
      where: { id: topicId },
      data: {
        totalReports: reportStats._count.id || 0,
        totalSources: latestReport?.totalSources || 0,
        lastRefreshAt: reportStats._max.generatedAt,
      },
    });

    this.logger.log(
      `Recalculated stats for topic ${topicId}: ` +
        `reports=${updatedTopic.totalReports}, sources=${updatedTopic.totalSources}`,
    );

    return updatedTopic;
  }

  /**
   * 检查用户是否有权访问专题
   *
   * @returns true 如果用户有权访问
   */
  private async checkTopicAccess(
    userId: string,
    topicId: string,
    ownerId: string,
  ): Promise<boolean> {
    // 1. 创建者始终有权限
    if (userId === ownerId) {
      return true;
    }

    // 2. 检查visibility和协作者状态
    const result = await this.prisma.$queryRaw<
      { visibility: string; is_collaborator: boolean }[]
    >`
      SELECT
        rt.visibility,
        EXISTS(
          SELECT 1 FROM research_topic_collaborators tc
          WHERE tc."topic_id" = rt.id
            AND tc."user_id" = ${userId}
            AND tc."is_active" = true
        ) as is_collaborator
      FROM research_topics rt
      WHERE rt.id = ${topicId}
    `;

    if (!result.length) {
      return false;
    }

    const { visibility, is_collaborator } = result[0];

    // PUBLIC: 所有登录用户可见
    if (visibility === "PUBLIC") {
      return true;
    }

    // SHARED: 协作者可见
    if (visibility === "SHARED" && is_collaborator) {
      return true;
    }

    // PRIVATE: 只有创建者可见（已在上面检查过）
    return false;
  }

  /**
   * 验证专题所有权（仅创建者可访问，用于写入操作）
   */
  private async verifyTopicOwnership(
    userId: string,
    topicId: string,
  ): Promise<void> {
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      select: { userId: true },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    if (topic.userId !== userId) {
      throw new ForbiddenException(
        "You do not have permission to access this topic",
      );
    }
  }

  /**
   * 验证专题读取权限（支持公开专题访问，用于只读操作）
   *
   * 权限规则：
   * - 创建者始终有权限
   * - PUBLIC 专题：所有登录用户可访问
   * - SHARED 专题：协作者可访问
   * - PRIVATE 专题：仅创建者可访问
   */
  private async verifyTopicReadAccess(
    userId: string,
    topicId: string,
  ): Promise<void> {
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      select: { userId: true },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    // 创建者始终有权限
    if (topic.userId === userId) {
      return;
    }

    // 检查 visibility 和协作者状态
    const hasAccess = await this.checkTopicAccess(
      userId,
      topicId,
      topic.userId,
    );
    if (!hasAccess) {
      throw new ForbiddenException(
        "You do not have permission to access this topic",
      );
    }
  }
}
