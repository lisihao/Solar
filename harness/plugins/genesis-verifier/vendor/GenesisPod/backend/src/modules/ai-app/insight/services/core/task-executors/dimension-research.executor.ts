import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import type { TopicDimension } from "@prisma/client";
import { ResearchEventEmitterService } from "../research/research-event-emitter.service";
import { DimensionMissionService } from "../../dimension/dimension-mission.service";
import type { DimensionAnalysisResult } from "../../../types/research.types";
import type {
  ITaskExecutor,
  TaskExecutionContext,
  TaskExecutionResult,
} from "./task-executor.interface";

@Injectable()
export class DimensionResearchExecutor implements ITaskExecutor {
  private readonly logger = new Logger(DimensionResearchExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dimensionMissionService: DimensionMissionService,
    private readonly researchEventEmitter: ResearchEventEmitterService,
  ) {}

  async execute(context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const {
      task,
      topic,
      missionId,
      reportId,
      depthConfig,
      assignedModelId,
      assignedTools,
      assignedSkills,
      agentName,
    } = context;

    // ★ 发送维度研究开始事件
    const dimensionName = task.dimensionName || task.title;
    await this.researchEventEmitter.emitDimensionResearchStarted(
      topic.id,
      dimensionName,
      agentName,
      missionId,
    );

    // ★ 优先使用 dimensionId 查找（更可靠）
    let dimension = task.dimensionId
      ? topic.dimensions?.find((d: TopicDimension) => d.id === task.dimensionId)
      : null;

    // 回退：按名称查找
    if (!dimension && task.dimensionName) {
      dimension = topic.dimensions?.find(
        (d: TopicDimension) => d.name === task.dimensionName,
      );
    }

    // ★ v8.2: 如果在缓存的 topic.dimensions 中没找到，从数据库重新查询
    // 这处理 Leader 在 Mission 执行过程中创建新维度的情况
    if (!dimension && task.dimensionId) {
      this.logger.log(
        `[DimensionResearchExecutor] Dimension not in cached topic, querying DB for ${task.dimensionId}`,
      );
      dimension = await this.prisma.topicDimension.findUnique({
        where: { id: task.dimensionId },
      });
    }

    let result: TaskExecutionResult;

    if (dimension) {
      this.logger.log(
        `[DimensionResearchExecutor] Found dimension: ${dimension.name} (${dimension.id})${assignedModelId ? `, model: ${assignedModelId}` : ""}`,
      );

      // ★ 发送进度事件：正在采集数据（planning 阶段 5-15%）
      await this.researchEventEmitter.emitDimensionResearchProgress(
        topic.id,
        dimensionName,
        5,
        "正在采集相关数据...",
        missionId,
        task.id, // ★ 传递 taskId 用于前端精确匹配
      );

      // 使用新的 Leader-Agent 协作机制
      const missionResult =
        await this.dimensionMissionService.executeDimensionMission(
          topic,
          dimension,
          reportId, // ★ 传入 reportId 以便关联证据
          missionId, // ★ 传入 missionId 以便持久化团队消息
          assignedModelId, // ★ 传入 Leader 分配的模型
          task.id, // ★ 传入任务ID用于前端精确匹配进度
          assignedTools, // ★ 传入 Leader 分配的工具
          assignedSkills, // ★ 传入 Leader 分配的技能
          depthConfig?.maxRevisionRounds, // V5: 修订轮次
        );

      if (!missionResult.success) {
        throw new InternalServerErrorException(
          missionResult.error || "Dimension mission failed",
        );
      }
      result = missionResult.analysisResult as unknown as TaskExecutionResult;

      // ★ 发送维度研究完成事件
      await this.researchEventEmitter.emitDimensionResearchCompleted(
        topic.id,
        dimensionName,
        result.keyFindings?.length || 0,
        result.detailedContent?.length || 0,
        missionId,
      );
    } else {
      // 如果没有找到维度，创建新维度进行研究
      this.logger.warn(
        `[DimensionResearchExecutor] Dimension not found for task ${task.id}, creating new one`,
      );
      result = (await this.executeGenericDimensionResearch(
        task,
        topic,
        reportId,
        missionId,
      )) as unknown as TaskExecutionResult;

      // ★ 发送维度研究完成事件
      await this.researchEventEmitter.emitDimensionResearchCompleted(
        topic.id,
        dimensionName,
        result.keyFindings?.length || 0,
        result.detailedContent?.length || 0,
        missionId,
      );
    }

    return result;
  }

  /**
   * 执行通用维度研究（当没有预定义维度时）
   * 会在数据库中创建真实的维度记录
   */
  async executeGenericDimensionResearch(
    task: import("@prisma/client").ResearchTask,
    topic: import("@prisma/client").ResearchTopic & {
      dimensions: TopicDimension[];
    },
    reportId: string,
    missionId?: string,
  ): Promise<DimensionAnalysisResult> {
    const dimensionName = task.dimensionName || task.title;

    this.logger.log(
      `[DimensionResearchExecutor] Resolving dimension in DB: ${dimensionName} (mission=${missionId ?? "none"})`,
    );

    // ★ 修复重复 dim bug：在当前 mission scope 内归一化查重。
    //   schema 已让 dim 严格按 (topicId, missionId) 隔离；这里再加命名归一化
    //   防止同一 mission 内大小写/空格差异导致的 dup。
    const normalizedName = dimensionName.trim().toLowerCase();
    const existingDimensions = await this.prisma.topicDimension.findMany({
      where: { topicId: topic.id, missionId: missionId ?? null },
      orderBy: { sortOrder: "desc" },
    });
    const reused = existingDimensions.find(
      (d) => d.name.trim().toLowerCase() === normalizedName,
    );

    let dimension;
    if (reused) {
      this.logger.log(
        `[DimensionResearchExecutor] Reusing existing dimension ${reused.id} for "${dimensionName}" (normalized match)`,
      );
      dimension = reused;
    } else {
      const sortOrder = (existingDimensions[0]?.sortOrder ?? 0) + 1;
      dimension = await this.prisma.topicDimension.create({
        data: {
          topicId: topic.id,
          missionId: missionId ?? null,
          name: dimensionName,
          description: task.description || `研究维度: ${dimensionName}`,
          sortOrder,
          status: "PENDING",
          // ★ 设置默认搜索配置
          searchQueries: [dimensionName],
          searchSources: ["web"],
        },
      });
      this.logger.log(
        `[DimensionResearchExecutor] Created dimension: ${dimension.id} (mission=${missionId ?? "none"})`,
      );
    }

    // 使用新的 Leader-Agent 协作机制
    const missionResult =
      await this.dimensionMissionService.executeDimensionMission(
        topic,
        dimension,
        reportId, // ★ 传入 reportId 以便关联证据
        undefined, // missionId
        task.modelId ?? undefined, // ★ 传入任务分配的模型 ID
      );

    if (!missionResult.success || !missionResult.analysisResult) {
      throw new InternalServerErrorException(
        missionResult.error || "Dimension mission failed",
      );
    }

    return missionResult.analysisResult;
  }
}
