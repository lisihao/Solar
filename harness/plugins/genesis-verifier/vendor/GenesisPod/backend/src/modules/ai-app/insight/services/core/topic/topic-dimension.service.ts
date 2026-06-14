import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  AddDimensionDto,
  UpdateDimensionDto,
  RefreshDimensionDto,
  ReorderDimensionsDto,
  GetTemplatesDto,
  CreateFromTemplateDto,
} from "../../../dto";
import { ResearchTopicType, DimensionStatus } from "@prisma/client";
import {
  MACRO_INSIGHT_DIMENSIONS,
  TECH_INSIGHT_DIMENSIONS,
  COMPANY_INSIGHT_DIMENSIONS,
  EVENT_INSIGHT_REFERENCE_DIMENSIONS,
} from "../../../config/dimension-templates.config";

/**
 * TopicDimensionService
 *
 * 负责专题维度的管理：添加、更新、删除、重排、刷新、模板
 */
@Injectable()
export class TopicDimensionService {
  private readonly logger = new Logger(TopicDimensionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取维度列表
   */
  async listDimensions(userId: string, topicId: string) {
    // 验证专题读取权限（支持公开专题访问）
    await this.verifyTopicReadAccess(userId, topicId);

    const dimensions = await this.prisma.topicDimension.findMany({
      where: { topicId },
      orderBy: { sortOrder: "asc" },
      include: {
        analyses: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    // 将最新 analysis 的数据扁平化到 dataPoints 字段
    return dimensions.map((dim) => {
      const latestAnalysis = dim.analyses?.[0];
      return {
        ...dim,
        analyses: undefined,
        dataPoints: latestAnalysis
          ? {
              summary: latestAnalysis.summary,
              keyFindings: latestAnalysis.keyFindings,
              dataPoints: latestAnalysis.dataPoints,
              dimensionAnalysis: (
                latestAnalysis.dataPoints as Record<string, unknown>
              )?.dimensionAnalysis,
              detailedContent: (
                latestAnalysis.dataPoints as Record<string, unknown>
              )?.detailedContent,
            }
          : null,
      };
    });
  }

  /**
   * 添加维度
   */
  async addDimension(userId: string, topicId: string, dto: AddDimensionDto) {
    // 验证专题所有权
    await this.verifyTopicOwnership(userId, topicId);

    // 如果没有指定 sortOrder，设置为最大值 + 1
    let sortOrder = dto.sortOrder;
    if (!sortOrder) {
      const maxDimension = await this.prisma.topicDimension.findFirst({
        where: { topicId },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      sortOrder = (maxDimension?.sortOrder || 0) + 1;
    }

    const dimension = await this.prisma.topicDimension.create({
      data: {
        topicId,
        name: dto.name,
        description: dto.description,
        sortOrder,
        searchQueries: dto.searchQueries || [],
        searchSources: dto.searchSources || [],
        minSources: dto.minSources ?? 5,
        isEnabled: true,
        status: DimensionStatus.PENDING,
      },
    });

    this.logger.log(`Added dimension ${dimension.id} to topic ${topicId}`);
    return dimension;
  }

  /**
   * 更新维度
   */
  async updateDimension(
    userId: string,
    topicId: string,
    dimensionId: string,
    dto: UpdateDimensionDto,
  ) {
    // 验证专题所有权
    await this.verifyTopicOwnership(userId, topicId);

    // 验证维度属于该专题
    const existing = await this.prisma.topicDimension.findFirst({
      where: { id: dimensionId, topicId },
    });

    if (!existing) {
      throw new NotFoundException(
        `Dimension ${dimensionId} not found in topic ${topicId}`,
      );
    }

    const updated = await this.prisma.topicDimension.update({
      where: { id: dimensionId },
      data: {
        name: dto.name,
        description: dto.description,
        isEnabled: dto.isEnabled,
        searchQueries: dto.searchQueries,
        searchSources: dto.searchSources,
        sortOrder: dto.sortOrder,
        minSources: dto.minSources,
      },
    });

    this.logger.log(`Updated dimension ${dimensionId}`);
    return updated;
  }

  /**
   * 删除维度
   */
  async deleteDimension(userId: string, topicId: string, dimensionId: string) {
    // 验证专题所有权
    await this.verifyTopicOwnership(userId, topicId);

    // 验证维度属于该专题
    const existing = await this.prisma.topicDimension.findFirst({
      where: { id: dimensionId, topicId },
    });

    if (!existing) {
      throw new NotFoundException(
        `Dimension ${dimensionId} not found in topic ${topicId}`,
      );
    }

    await this.prisma.topicDimension.delete({
      where: { id: dimensionId },
    });

    this.logger.log(`Deleted dimension ${dimensionId}`);
    return { success: true };
  }

  /**
   * 刷新单个维度
   */
  async refreshDimension(
    _userId: string,
    _topicId: string,
    _dimensionId: string,
    _dto: RefreshDimensionDto,
  ) {
    // TODO: Implement refreshDimension (高级功能，暂不实现)
    throw new HttpException(
      "refreshDimension is not yet implemented",
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  /**
   * 调整维度顺序
   */
  async reorderDimensions(
    userId: string,
    topicId: string,
    dto: ReorderDimensionsDto,
  ) {
    // 验证专题所有权
    await this.verifyTopicOwnership(userId, topicId);

    // 验证所有维度都属于该专题
    const dimensions = await this.prisma.topicDimension.findMany({
      where: {
        id: { in: dto.dimensionIds },
        topicId,
      },
    });

    if (dimensions.length !== dto.dimensionIds.length) {
      throw new NotFoundException("Some dimensions not found in this topic");
    }

    // 使用事务更新所有维度的 sortOrder
    await this.prisma.$transaction(
      dto.dimensionIds.map((dimensionId, index) =>
        this.prisma.topicDimension.update({
          where: { id: dimensionId },
          data: { sortOrder: index + 1 },
        }),
      ),
    );

    this.logger.log(
      `Reordered ${dto.dimensionIds.length} dimensions in topic ${topicId}`,
    );
    return { success: true };
  }

  /**
   * 获取模板列表
   */
  async getTemplates(query: GetTemplatesDto) {
    const dimensions = this.getDefaultDimensionsByType(query.type);

    return {
      type: query.type,
      dimensions: dimensions.map((dim) => ({
        id: dim.id,
        name: dim.name,
        description: dim.description,
        searchQueries: dim.searchQueries,
        searchSources: dim.searchSources,
        minSources: dim.minSources,
        sortOrder: dim.sortOrder,
      })),
    };
  }

  /**
   * 从模板创建专题
   */
  async createFromTemplate(_userId: string, _dto: CreateFromTemplateDto) {
    // TODO: Implement createFromTemplate (高级功能，暂不实现)
    throw new HttpException(
      "createFromTemplate is not yet implemented",
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  /**
   * 根据专题类型获取默认维度模板
   */
  private getDefaultDimensionsByType(topicType: ResearchTopicType) {
    switch (topicType) {
      case ResearchTopicType.MACRO:
        return MACRO_INSIGHT_DIMENSIONS;
      case ResearchTopicType.TECHNOLOGY:
        return TECH_INSIGHT_DIMENSIONS;
      case ResearchTopicType.COMPANY:
        return COMPANY_INSIGHT_DIMENSIONS;
      case ResearchTopicType.EVENT:
        return EVENT_INSIGHT_REFERENCE_DIMENSIONS;
      default:
        throw new BadRequestException(`Unknown topic type: ${topicType}`);
    }
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

  /**
   * 检查用户是否有权访问专题
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
}
