/**
 * Mission Query Service
 *
 * 负责 Mission 和 Task 的查询、状态更新
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  ResearchMissionStatus,
  ResearchTaskStatus,
  AIModelType,
  Prisma,
} from "@prisma/client";
import type { ResearchTask, ResearchAgentActivity } from "@prisma/client";
import {
  ResearchEventEmitterService,
  RESEARCH_INTERNAL_EVENTS,
} from "../research/research-event-emitter.service";

import { ChatFacade } from "@/modules/ai-harness/facade";
import type { LeaderPlan } from "../../../types/leader.types";
import { getModelDisplayNameMap } from "../../../utils/model-display-name";
import type {
  MissionStatus,
  TaskStatus,
  MissionProgressEvent,
  TeamInfo,
  AgentInfo,
} from "../../../types/mission.types";

@Injectable()
export class MissionQueryService {
  private readonly logger = new Logger(MissionQueryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly researchEventEmitter: ResearchEventEmitterService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * 获取 Mission 状态
   */
  async getMissionStatus(missionId: string): Promise<MissionStatus> {
    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      include: { tasks: { orderBy: { priority: "asc" } } },
    });

    if (!mission) {
      throw new NotFoundException(`Mission ${missionId} not found`);
    }

    // ★ 查询模型展示名称映射（modelId → displayName）
    const modelDisplayNameMap = await getModelDisplayNameMap(
      this.prisma,
      mission.tasks.map((t) => t.modelId).filter((id): id is string => !!id),
    );

    const tasks: TaskStatus[] = mission.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      taskType: task.taskType,
      dimensionName: task.dimensionName ?? undefined,
      assignedAgent: task.assignedAgent,
      modelId: task.modelId ?? undefined, // ★ 返回 Agent 使用的模型 ID
      modelDisplayName: task.modelId
        ? modelDisplayNameMap.get(task.modelId)
        : undefined,
      status: task.status,
      progress: task.progress ?? 0, // ★ 返回任务进度
      reviewStatus: task.reviewStatus ?? undefined,
      // ★ 修复：返回完整的任务结果，包含成功数据或错误信息
      result: task.result ?? undefined,
      resultSummary: task.resultSummary ?? undefined,
      startedAt: task.startedAt ?? undefined,
      completedAt: task.completedAt ?? undefined,
    }));

    return {
      id: mission.id,
      status: mission.status,
      progress: mission.progressPercent,
      totalTasks: mission.totalTasks,
      completedTasks: mission.completedTasks,
      currentPhase: this.getPhaseFromStatus(mission.status),
      tasks,
      leaderPlan: mission.leaderPlan as unknown as LeaderPlan | undefined,
      researchDepth: mission.researchDepth ?? undefined,
      startedAt: mission.startedAt?.toISOString(),
      completedAt: mission.completedAt?.toISOString(),
      createdAt: mission.createdAt?.toISOString(),
    };
  }

  /**
   * 获取专题当前 Mission 状态
   */
  async getMissionByTopicId(topicId: string): Promise<MissionStatus | null> {
    const mission = await this.prisma.researchMission.findFirst({
      where: { topicId },
      orderBy: { createdAt: "desc" },
      include: { tasks: { orderBy: { priority: "asc" } } },
    });

    if (!mission) {
      return null;
    }

    // ★ 查询模型展示名称映射
    const modelDisplayNameMap = await getModelDisplayNameMap(
      this.prisma,
      mission.tasks.map((t) => t.modelId).filter((id): id is string => !!id),
    );

    const tasks: TaskStatus[] = mission.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      taskType: task.taskType,
      dimensionName: task.dimensionName ?? undefined,
      assignedAgent: task.assignedAgent,
      modelId: task.modelId ?? undefined, // ★ 返回 Agent 使用的模型 ID
      modelDisplayName: task.modelId
        ? modelDisplayNameMap.get(task.modelId)
        : undefined,
      status: task.status,
      progress: task.progress ?? 0, // ★ 返回任务进度
      reviewStatus: task.reviewStatus ?? undefined,
      // ★ 修复：返回完整的任务结果
      result: task.result ?? undefined,
      resultSummary: task.resultSummary ?? undefined,
      startedAt: task.startedAt ?? undefined,
      completedAt: task.completedAt ?? undefined,
      // ★ 返回依赖关系用于可视化
      dependencies: task.dependencies ?? [],
    }));

    return {
      id: mission.id,
      status: mission.status,
      progress: mission.progressPercent,
      totalTasks: mission.totalTasks,
      completedTasks: mission.completedTasks,
      currentPhase: this.getPhaseFromStatus(mission.status),
      tasks,
      leaderPlan: mission.leaderPlan as unknown as LeaderPlan | undefined,
      leaderModelId: mission.leaderModelId ?? undefined,
      leaderModelName: mission.leaderModelName ?? undefined,
      startedAt: mission.startedAt?.toISOString() ?? undefined,
      completedAt: mission.completedAt?.toISOString() ?? undefined,
      createdAt: mission.createdAt?.toISOString() ?? undefined,
    };
  }

  /**
   * 验证 ResearchTask 属于指定专题。
   * 用于 controller 接收 URL 路径参数时的归属校验。
   * @throws NotFoundException 若 task 不存在或不属于该专题
   */
  async verifyTaskBelongsToTopic(
    taskId: string,
    topicId: string,
  ): Promise<void> {
    const task = await this.prisma.researchTask.findUnique({
      where: { id: taskId },
      select: { mission: { select: { topicId: true } } },
    });
    if (!task || task.mission.topicId !== topicId) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }
  }

  /**
   * ★ 获取任务相关的 Agent 活动记录
   * 通过 ResearchTask.id 查找关联的 ResearchAgentActivity
   */
  async getTaskActivities(taskId: string): Promise<{
    task: ResearchTask;
    activities: ResearchAgentActivity[];
  }> {
    // 1. 获取任务信息
    const task = await this.prisma.researchTask.findUnique({
      where: { id: taskId },
      include: { mission: true },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }

    // 2. 构建查询条件
    // ★ 修复：根据任务类型精确过滤活动
    //   - 维度研究任务：只显示该维度的活动（不包含 Leader 的规划活动）
    //   - Leader 规划任务：显示 Leader 的规划活动
    //   - 报告撰写/质量审核任务：显示对应阶段的活动
    let whereCondition: Prisma.ResearchAgentActivityWhereInput;

    // ★ 获取 topicId 用于跨 Mission 查询
    const topicId = task.mission?.topicId;

    if (task.dimensionId) {
      // ★ 修复：维度研究任务使用 topicId + dimensionId 查询
      // 这样即使 Mission 更新（新 missionId），也能找到旧 Mission 下的活动记录
      whereCondition = {
        topicId: topicId,
        dimensionId: task.dimensionId,
      };
    } else if (task.taskType === "leader_planning") {
      // Leader 规划任务：只获取 Leader 的活动
      whereCondition = {
        missionId: task.missionId,
        agentRole: "leader",
      };
    } else if (task.taskType === "report_synthesis") {
      // 报告撰写任务：获取 synthesizer 的活动
      whereCondition = {
        missionId: task.missionId,
        agentRole: "synthesizer",
      };
    } else if (task.taskType === "quality_review") {
      // 质量审核任务：获取 reviewer 的活动
      whereCondition = {
        missionId: task.missionId,
        agentRole: "reviewer",
      };
    } else {
      // 其他任务：按 missionId 和 agentId 查询
      whereCondition = {
        missionId: task.missionId,
        ...(task.assignedAgent && { agentId: task.assignedAgent }),
      };
    }

    // 3. 查询活动记录
    const activities = await this.prisma.researchAgentActivity.findMany({
      where: whereCondition,
      orderBy: { createdAt: "asc" },
    });

    return { task, activities };
  }

  /**
   * 更新任务状态
   */
  async updateTaskStatus(
    taskId: string,
    status: ResearchTaskStatus,
    options?: {
      result?: Prisma.InputJsonValue;
      resultSummary?: string;
      actualModelId?: string;
    },
  ): Promise<ResearchTask> {
    const { result, resultSummary, actualModelId } = options ?? {};
    const now = new Date();
    const updateData: Prisma.ResearchTaskUpdateInput = { status };

    if (status === ResearchTaskStatus.EXECUTING) {
      updateData.startedAt = now;
    } else if (
      status === ResearchTaskStatus.COMPLETED ||
      status === ResearchTaskStatus.FAILED
    ) {
      updateData.completedAt = now;
    }

    if (result !== undefined) {
      updateData.result = result;
    }

    if (resultSummary !== undefined) {
      updateData.resultSummary = resultSummary;
    }

    // ★ 更新实际使用的模型ID（如果提供）
    if (actualModelId) {
      updateData.modelId = actualModelId;
    }

    // ★ For terminal status transitions, use conditional update to prevent race conditions
    if (
      status === ResearchTaskStatus.COMPLETED ||
      status === ResearchTaskStatus.FAILED
    ) {
      const result = await this.prisma.researchTask.updateMany({
        where: {
          id: taskId,
          status: {
            notIn: [ResearchTaskStatus.FAILED, ResearchTaskStatus.COMPLETED],
          },
        },
        data: updateData,
      });

      if (result.count === 0) {
        this.logger.warn(
          `[updateTaskStatus] Task ${taskId} already in terminal state, skipping update to ${status}`,
        );
      }

      // Still return the current task state
      const task = await this.prisma.researchTask.findUnique({
        where: { id: taskId },
        include: { mission: true },
      });

      if (!task) {
        throw new NotFoundException(
          `Task ${taskId} not found after conditional update`,
        );
      }

      // Update Mission progress
      await this.updateMissionProgress(task.missionId);

      return task;
    }

    // For non-terminal statuses, use regular update
    const task = await this.prisma.researchTask.update({
      where: { id: taskId },
      data: updateData,
      include: { mission: true },
    });

    // 更新 Mission 进度
    await this.updateMissionProgress(task.missionId);

    return task;
  }

  /**
   * 更新 Mission 进度
   */
  async updateMissionProgress(missionId: string): Promise<void> {
    const tasks = await this.prisma.researchTask.findMany({
      where: { missionId },
    });

    const completedTasks = tasks.filter(
      (t) => t.status === ResearchTaskStatus.COMPLETED,
    ).length;
    const totalTasks = tasks.length;
    const calculatedProgress =
      totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // ★ 单调递增：进度只能前进不能后退，避免多源竞争导致的视觉跳跃
    // 场景：emitProgress 手动发 10%（规划完成），随后 updateMissionProgress 按
    // completedTasks/totalTasks 计算出更低的值（增量模式下已复制任务会导致跳跃）
    const currentMission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      select: { progressPercent: true },
    });
    const progressPercent = Math.max(
      calculatedProgress,
      currentMission?.progressPercent ?? 0,
    );

    // 检查任务状态
    const failedTasks = tasks.filter(
      (t) => t.status === ResearchTaskStatus.FAILED,
    ).length;
    const allCompleted = completedTasks === totalTasks;

    // ★ 修复：只有当所有任务都是终态时才判断最终状态
    // 终态 = COMPLETED 或 FAILED
    const terminalTaskCount = completedTasks + failedTasks;
    const allTerminal = terminalTaskCount === totalTasks;

    let status: ResearchMissionStatus | undefined;
    if (allCompleted) {
      // 所有任务都成功完成
      status = ResearchMissionStatus.COMPLETED;
    } else if (allTerminal && failedTasks > 0) {
      // 所有任务都已结束，且有失败的任务
      status = ResearchMissionStatus.FAILED;
    }
    // 否则保持当前状态（IN_PROGRESS）

    await this.prisma.researchMission.updateMany({
      where: {
        id: missionId,
        status: { not: ResearchMissionStatus.CANCELLED },
      },
      data: {
        completedTasks,
        progressPercent,
        ...(status && { status }),
        ...(status === ResearchMissionStatus.COMPLETED && {
          completedAt: new Date(),
        }),
      },
    });
  }

  /**
   * 获取当前团队组成
   * ★ 查询数据库获取各 Agent 使用的模型名称
   * ★ v8.0: 从 leaderPlan 提取 Agent 的 skills/tools
   */
  async getTeamInfo(missionId: string): Promise<TeamInfo> {
    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      include: { tasks: true },
    });

    if (!mission) {
      throw new NotFoundException(`Mission ${missionId} not found`);
    }

    // ★ 查询各类型的默认模型（用于显示 Agent 使用的模型）
    const modelTypeMap = await this.getDefaultModelNames();

    // ★ 获取 Leader 模型：优先使用存储的，否则动态获取当前推理模型
    let leaderModel = mission.leaderModelId || mission.leaderModelName;
    if (!leaderModel) {
      // 旧数据没有存储模型ID，动态获取当前使用的推理模型
      const currentModel = await this.chatFacade.getReasoningModel();
      leaderModel = currentModel?.id || currentModel?.name || null;
      this.logger.log(
        `[getTeamInfo] Mission ${missionId} has no stored model, using current: ${leaderModel}`,
      );
    }
    // ★ 最终 fallback：从 modelTypeMap 获取默认模型
    if (!leaderModel) {
      leaderModel = modelTypeMap.get(AIModelType.CHAT) || null;
      this.logger.warn(
        `[getTeamInfo] All model lookups failed for mission ${missionId}, using default: ${leaderModel}`,
      );
    }

    // ★ v8.0: 从 leaderPlan 提取 agentAssignments（包含 skills/tools）
    //
    // 运行时类型验证说明：
    // - v8.0 之前的 leaderPlan 没有 skills/tools 字段
    // - 必须验证数组元素是非空字符串，防止类型污染
    // - 空数组 [] 转为 undefined，保持前端显示逻辑一致
    const agentAssignmentsMap = new Map<
      string,
      { skills?: string[]; tools?: string[]; modelId?: string }
    >();

    // ★ 辅助函数：验证是否为非空字符串数组
    const isNonEmptyStringArray = (value: unknown): value is string[] => {
      if (!Array.isArray(value) || value.length === 0) return false;
      return value.every(
        (item) => typeof item === "string" && item.trim().length > 0,
      );
    };

    try {
      const rawPlan = mission.leaderPlan;
      if (
        rawPlan &&
        typeof rawPlan === "object" &&
        "agentAssignments" in rawPlan &&
        Array.isArray((rawPlan as Record<string, unknown>).agentAssignments)
      ) {
        const assignments = (rawPlan as Record<string, unknown>)
          .agentAssignments as unknown[];
        for (const item of assignments) {
          // 验证每个 assignment 的基本结构
          if (
            item &&
            typeof item === "object" &&
            "agentId" in item &&
            typeof (item as Record<string, unknown>).agentId === "string"
          ) {
            const assignment = item as Record<string, unknown>;
            const agentId = assignment.agentId as string;

            // ★ 严格验证 skills/tools 是非空字符串数组
            // 空数组 [] 或无效数据都转为 undefined
            agentAssignmentsMap.set(agentId, {
              skills: isNonEmptyStringArray(assignment.skills)
                ? assignment.skills
                : undefined,
              tools: isNonEmptyStringArray(assignment.tools)
                ? assignment.tools
                : undefined,
              modelId:
                typeof assignment.modelId === "string" &&
                assignment.modelId.trim()
                  ? assignment.modelId
                  : undefined,
            });
          }
        }
        // ★ skills/tools 分配情况（debug 级别，避免轮询时刷屏）
        this.logger.debug(
          `[getTeamInfo] Found ${agentAssignmentsMap.size} agents with capabilities`,
        );
      }
    } catch (parseError) {
      // 旧数据解析失败是预期行为，使用 debug 级别
      this.logger.debug(
        `[getTeamInfo] Failed to parse leaderPlan (may be legacy data): ${parseError instanceof Error ? parseError.message : parseError}`,
      );
    }

    // 从任务中提取 Agent 信息
    const agentMap = new Map<string, AgentInfo>();

    for (const task of mission.tasks) {
      if (!agentMap.has(task.assignedAgent)) {
        const agentType = task.assignedAgentType || "unknown";
        // ★ v8.0: 从 leaderPlan 获取 skills/tools
        const assignment = agentAssignmentsMap.get(task.assignedAgent);
        // ★ 模型优先使用任务级别存储的，其次是 leaderPlan 中的，最后是默认
        const model =
          task.modelId ||
          assignment?.modelId ||
          this.getModelForAgentType(agentType, modelTypeMap);

        agentMap.set(task.assignedAgent, {
          id: task.assignedAgent,
          type: agentType,
          role: this.getAgentRole(task.assignedAgentType),
          status: "idle",
          assignedDimensions: [],
          model,
          skills: assignment?.skills,
          tools: assignment?.tools,
        });
      }

      const agent = agentMap.get(task.assignedAgent)!;

      // 更新 Agent 状态
      if (task.status === ResearchTaskStatus.EXECUTING) {
        agent.status = "working";
        agent.currentTask = task.title;
      } else if (task.status === ResearchTaskStatus.COMPLETED) {
        if (agent.status !== "working") {
          agent.status = "completed";
        }
      } else if (task.status === ResearchTaskStatus.FAILED) {
        agent.status = "failed";
      }

      // 收集分配的维度
      if (task.dimensionName) {
        agent.assignedDimensions?.push(task.dimensionName);
      }
    }

    return {
      leaderId: "leader",
      leaderModel, // ★ 使用上面获取的模型（存储的或动态获取的）
      agents: Array.from(agentMap.values()),
    };
  }

  /**
   * ★ 查询各模型类型的默认模型名称
   * 使用 AIFacade 获取模型配置
   */
  async getDefaultModelNames(): Promise<Map<AIModelType, string>> {
    const map = new Map<AIModelType, string>();

    // 获取 CHAT 类型的默认模型
    const chatModel = await this.chatFacade.getDefaultModelByType(
      AIModelType.CHAT,
    );
    if (chatModel) {
      map.set(AIModelType.CHAT, chatModel.displayName || chatModel.modelId);
    }

    return map;
  }

  /**
   * ★ 根据 Agent 类型获取对应的模型名称
   * 所有 worker agent 使用 CHAT 类型模型
   * Leader 的模型名称存储在 mission.leaderModelName 中
   */
  getModelForAgentType(
    _agentType: string,
    modelMap: Map<AIModelType, string>,
  ): string | undefined {
    // 所有 worker agent 都使用 CHAT 模型
    // Leader 的模型在 TeamInfo.leaderModel 中单独返回
    return modelMap.get(AIModelType.CHAT);
  }

  /**
   * 获取可执行的任务（依赖已完成）
   * ★ v7.3: 按 priority 升序排序（数字越小越先执行）
   */
  async getExecutableTasks(missionId: string): Promise<ResearchTask[]> {
    // ★ v7.3: 查询时按 priority 排序
    const allTasks = await this.prisma.researchTask.findMany({
      where: { missionId },
      orderBy: { priority: "asc" },
    });

    const completedTaskIds = new Set(
      allTasks
        .filter((t) => t.status === ResearchTaskStatus.COMPLETED)
        .map((t) => t.id),
    );

    const executableTasks = allTasks.filter((task) => {
      // 必须是 PENDING 状态
      if (task.status !== ResearchTaskStatus.PENDING) {
        return false;
      }

      // 所有依赖必须已完成
      const dependencies = task.dependencies || [];
      return dependencies.every((depId) => completedTaskIds.has(depId));
    });

    // ★ v7.3: 确保返回的任务按 priority 排序（虽然查询已排序，但 filter 不保证顺序）
    return executableTasks.sort(
      (a, b) => (a.priority || 0) - (b.priority || 0),
    );
  }

  /**
   * 发送进度事件
   * 同时通过 EventEmitter2（内部）和 WebSocket（前端）发送
   */
  emitProgress(event: MissionProgressEvent): void {
    // 内部事件（用于服务间通信）
    this.eventEmitter.emit(RESEARCH_INTERNAL_EVENTS.MISSION_PROGRESS, event);

    // WebSocket 事件（推送给前端）
    void this.researchEventEmitter.emitMissionProgress(event.topicId, {
      missionId: event.missionId,
      progress: event.progress,
      phase: event.phase,
      message: event.message,
      currentTask: event.currentTask,
      completedTasks: event.completedTasks,
      totalTasks: event.totalTasks,
    });
  }

  // ==================== Helper Methods ====================

  /**
   * 获取 Agent 角色名称
   */
  getAgentRole(agentType?: string | null): string {
    switch (agentType) {
      case "dimension_researcher":
        return "维度研究员";
      case "quality_reviewer":
        return "质量审核员";
      case "report_writer":
        return "报告撰写员";
      default:
        return "研究员";
    }
  }

  /**
   * 根据任务类型获取 Agent 角色（用于事件发送）
   */
  getAgentRoleFromTaskType(
    taskType: string,
  ): "leader" | "researcher" | "reviewer" | "synthesizer" {
    switch (taskType) {
      case "dimension_research":
        return "researcher";
      case "quality_review":
        return "reviewer";
      case "report_synthesis":
        return "synthesizer";
      default:
        return "researcher";
    }
  }

  /**
   * 根据任务类型获取 Agent 名称（用于事件发送）
   */
  getAgentNameFromTaskType(taskType: string): string {
    switch (taskType) {
      case "dimension_research":
        return "研究员";
      case "quality_review":
        return "质量审核员";
      case "report_synthesis":
        return "报告撰写员";
      default:
        return "研究员";
    }
  }

  getPhaseFromStatus(status: ResearchMissionStatus): string {
    switch (status) {
      case ResearchMissionStatus.PLANNING:
        return "planning";
      case ResearchMissionStatus.EXECUTING:
        return "researching";
      case ResearchMissionStatus.REVIEWING:
        return "reviewing";
      case ResearchMissionStatus.COMPLETED:
        return "completed";
      case ResearchMissionStatus.FAILED:
        return "failed";
      default:
        return "unknown";
    }
  }
}
