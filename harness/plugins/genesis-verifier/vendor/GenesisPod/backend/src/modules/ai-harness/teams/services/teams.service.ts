/**
 * AI Engine - Teams Service
 * 团队服务 - 业务逻辑层
 *
 * 提供团队任务执行的完整 API：
 * - 创建和管理团队实例
 * - 执行任务（Mission）
 * - 监控执行状态
 * - 获取执行结果
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { TeamFactory } from "../factory/team-factory";
import { TeamRegistry } from "../registry/team-registry";
import { RoleRegistry } from "../registry/role-registry";
import { TeamsMissionOrchestrator as MissionOrchestrator } from "../orchestrator/teams-mission-orchestrator";
import {
  MissionEvent,
  MissionResult,
  MissionInput,
} from "../../agents/abstractions/mission.types";
import { ConstraintEngine } from "@/modules/ai-harness/guardrails/constraints/constraint-engine";
import { ITeam, TeamConfig, TeamId } from "../abstractions/team.interface";
import { MissionExecutionProfile } from "../profile/mission-execution-profile";
import { LruMap } from "@/common/utils/lru-map";

// ==================== DTOs ====================

/**
 * 创建任务请求
 */
export interface CreateMissionDto {
  /** å›¢é˜Ÿ ID */
  teamId: TeamId;

  /** 任务目标 */
  goal: string;

  /** 上下文信息 */
  context?: string;

  /** 约束覆盖（可选） */
  constraints?: Partial<MissionExecutionProfile>;

  /** 用户 ID（可选） */
  userId?: string;

  /** 会话 ID（可选） */
  sessionId?: string;

  /** 元数据（可选） */
  metadata?: Record<string, unknown>;
}

/**
 * 任务执行状态
 */
export interface MissionStatus {
  /** ä»»åŠ¡ ID */
  missionId: string;

  /** å›¢é˜Ÿ ID */
  teamId: TeamId;

  /** çŠ¶æ€ */
  status: "pending" | "running" | "completed" | "failed" | "cancelled";

  /** 进度（0-100） */
  progress: number;

  /** 当前阶段 */
  currentPhase?: string;

  /** 开始时间 */
  startTime: Date;

  /** 结束时间 */
  endTime?: Date;

  /** 错误信息 */
  error?: string;
}

/**
 * 团队信息
 */
export interface TeamInfo {
  id: TeamId;
  name: string;
  description: string;
  type: "predefined" | "custom";
  icon?: string;
  color?: string;
  leaderRole: string;
  memberRoles: string[];
  capabilities: string[];
}

// ==================== Service ====================

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  /** 正在执行的任务 */
  private readonly runningMissions = new LruMap<
    string,
    {
      status: MissionStatus;
      abortController: AbortController;
      resultPromise: Promise<MissionResult>;
    }
  >(500);

  /** 已完成的任务结果缓存 */
  private readonly completedMissions = new LruMap<string, MissionResult>(1000);

  constructor(
    private readonly teamFactory: TeamFactory,
    private readonly teamRegistry: TeamRegistry,
    private readonly roleRegistry: RoleRegistry,
    private readonly missionOrchestrator: MissionOrchestrator,
    private readonly constraintEngine: ConstraintEngine,
  ) {}

  // ==================== 团队管理 ====================

  /**
   * 获取所有可用团队
   */
  listTeams(): TeamInfo[] {
    const configs = this.teamRegistry.getAllConfigs();
    return configs.map((config) => this.configToInfo(config));
  }

  /**
   * 获取团队详情
   */
  getTeam(teamId: TeamId): TeamInfo {
    const config = this.teamRegistry.getConfig(teamId);
    if (!config) {
      throw new NotFoundException(`Team ${teamId} not found`);
    }
    return this.configToInfo(config);
  }

  /**
   * 获取团队实例（如需要可实例化）
   */
  getTeamInstance(teamId: TeamId): ITeam {
    return this.teamFactory.createFromId(teamId);
  }

  // ==================== 任务执行 ====================

  /**
   * 创建并执行任务
   */
  async executeMission(dto: CreateMissionDto): Promise<string> {
    // 1. 验证团队存在
    if (!this.teamRegistry.has(dto.teamId)) {
      throw new NotFoundException(`Team ${dto.teamId} not found`);
    }

    // 2. 生成任务 ID
    const missionId = uuidv4();
    this.logger.log(`Creating mission ${missionId} for team ${dto.teamId}`);

    // 3. 实例化团队
    const team = this.teamFactory.createFromId(dto.teamId);

    // 4. 合并约束
    const constraints = this.mergeConstraints(
      team.constraintProfile,
      dto.constraints,
    );

    // 5. 验证约束
    const validation = this.constraintEngine.validate(constraints);
    if (!validation.valid) {
      throw new BadRequestException(
        `Invalid constraints: ${validation.violations.map((v) => v.message).join(", ")}`,
      );
    }

    // 6. 创建 AbortController
    const abortController = new AbortController();

    // 7. 初始化状态
    const status: MissionStatus = {
      missionId,
      teamId: dto.teamId,
      status: "pending",
      progress: 0,
      startTime: new Date(),
    };

    // 8. 启动执行（异步）
    const resultPromise = this.runMission(
      missionId,
      team,
      dto,
      constraints,
      abortController.signal,
    );

    // 9. 存储运行状态
    this.runningMissions.set(missionId, {
      status,
      abortController,
      resultPromise,
    });

    return missionId;
  }

  /**
   * 执行任务并流式返回事件
   */
  async *executeMissionStream(
    dto: CreateMissionDto,
  ): AsyncGenerator<MissionEvent> {
    // 1. 验证团队存在
    if (!this.teamRegistry.has(dto.teamId)) {
      throw new NotFoundException(`Team ${dto.teamId} not found`);
    }

    // 2. 实例化团队
    const team = this.teamFactory.createFromId(dto.teamId);
    this.logger.log(`Creating streaming mission for team ${dto.teamId}`);

    // 3. 构建 MissionInput
    const missionInput: MissionInput = {
      prompt: dto.goal,
      metadata: {
        ...dto.metadata,
        context: dto.context || "",
        teamId: dto.teamId,
        userId: dto.userId,
        sessionId: dto.sessionId,
      },
      constraints: dto.constraints,
    };

    // 4. 执行并流式返回
    const generator = this.missionOrchestrator.execute(
      missionInput,
      team,
      dto.constraints,
    );

    for await (const event of generator) {
      yield event;
    }
  }

  /**
   * 获取任务状态
   */
  getMissionStatus(missionId: string): MissionStatus {
    const running = this.runningMissions.get(missionId);
    if (running) {
      return { ...running.status };
    }

    const completed = this.completedMissions.get(missionId);
    if (completed) {
      return {
        missionId,
        teamId: (completed.metadata?.teamId as TeamId) || ("unknown" as TeamId),
        status: completed.success ? "completed" : "failed",
        progress: 100,
        startTime: (completed.metadata?.startTime as Date) || new Date(),
        endTime: completed.metadata?.endTime as Date,
        error: completed.error?.message,
      };
    }

    throw new NotFoundException(`Mission ${missionId} not found`);
  }

  /**
   * 获取任务结果
   */
  async getMissionResult(missionId: string): Promise<MissionResult> {
    // 检查已完成
    const completed = this.completedMissions.get(missionId);
    if (completed) {
      return completed;
    }

    // 检查正在运行
    const running = this.runningMissions.get(missionId);
    if (running) {
      // 等待完成
      return running.resultPromise;
    }

    throw new NotFoundException(`Mission ${missionId} not found`);
  }

  /**
   * 取消任务
   */
  cancelMission(missionId: string): boolean {
    const running = this.runningMissions.get(missionId);
    if (!running) {
      throw new NotFoundException(`Running mission ${missionId} not found`);
    }

    running.abortController.abort();
    running.status.status = "cancelled";
    running.status.endTime = new Date();

    this.logger.log(`Mission ${missionId} cancelled`);
    return true;
  }

  // ==================== 私有方法 ====================

  /**
   * 运行任务
   */
  private async runMission(
    _missionId: string,
    team: ITeam,
    dto: CreateMissionDto,
    _constraints: MissionExecutionProfile,
    _signal: AbortSignal,
  ): Promise<MissionResult> {
    const running = this.runningMissions.get(_missionId);
    if (!running) {
      throw new InternalServerErrorException(
        `Mission ${_missionId} not initialized`,
      );
    }

    try {
      // 更新状态为运行中
      running.status.status = "running";

      // 构建 MissionInput
      const missionInput: MissionInput = {
        prompt: dto.goal,
        metadata: {
          ...dto.metadata,
          context: dto.context || "",
          teamId: dto.teamId,
          userId: dto.userId,
          sessionId: dto.sessionId,
        },
        constraints: dto.constraints,
      };

      // 执行任务
      let result: MissionResult | undefined;
      const generator = this.missionOrchestrator.execute(
        missionInput,
        team,
        dto.constraints,
      );

      for await (const event of generator) {
        // 更新进度 - 使用 step_started 作为阶段指示
        if (event.type === "step_started") {
          running.status.currentPhase = event.data?.stepId as string;
        }
        // 使用 step_progress 更新进度
        if (event.type === "step_progress") {
          running.status.progress = (event.data?.progress as number) || 0;
        }
        if (event.type === "mission_completed") {
          result = event.data?.result as MissionResult;
        }
        if (event.type === "mission_failed") {
          const errorData = event.data?.error as { message?: string } | string;
          const errorMessage =
            typeof errorData === "string"
              ? errorData
              : errorData?.message || "Mission failed";
          throw new InternalServerErrorException(errorMessage);
        }
      }

      if (!result) {
        throw new InternalServerErrorException(
          "Mission completed without result",
        );
      }

      // 更新状态为完成
      running.status.status = "completed";
      running.status.progress = 100;
      running.status.endTime = new Date();

      // 缓存结果
      this.completedMissions.set(_missionId, result);

      // 清理运行状态
      this.runningMissions.delete(_missionId);

      return result;
    } catch (error) {
      // 更新状态为失败
      running.status.status = "failed";
      running.status.endTime = new Date();
      running.status.error =
        error instanceof Error ? error.message : String(error);

      // 缓存失败结果
      const failedResult: MissionResult = {
        missionId: _missionId,
        success: false,
        summary: "Mission failed",
        tokensUsed: 0,
        costUsed: 0,
        duration: Date.now() - running.status.startTime.getTime(),
        error: {
          code: "MISSION_FAILED",
          message: running.status.error,
          retryable: false,
        },
        deliverables: [],
        statistics: {
          totalSteps: 0,
          completedSteps: 0,
          failedSteps: 1,
          skippedSteps: 0,
          reworkCount: 0,
          membersInvolved: 0,
          toolCalls: 0,
          skillCalls: 0,
          reviewCount: 0,
          reviewPassRate: 0,
        },
        metadata: {
          teamId: dto.teamId,
          startTime: running.status.startTime,
          endTime: running.status.endTime,
        },
      };
      this.completedMissions.set(_missionId, failedResult);

      // 清理运行状态
      this.runningMissions.delete(_missionId);

      throw error;
    }
  }

  /**
   * 合并约束配置
   */
  private mergeConstraints(
    base: MissionExecutionProfile,
    overrides?: Partial<MissionExecutionProfile>,
  ): MissionExecutionProfile {
    if (!overrides) {
      return base;
    }

    return {
      ...base,
      ...overrides,
      cost: { ...base.cost, ...overrides.cost },
      quality: { ...base.quality, ...overrides.quality },
      efficiency: { ...base.efficiency, ...overrides.efficiency },
    };
  }

  /**
   * 将配置转换为团队信息
   */
  private configToInfo(config: TeamConfig): TeamInfo {
    const leaderRole = this.roleRegistry.tryGet(config.leaderRoleId);
    const memberRoles = config.memberRoles
      .map((mr) => this.roleRegistry.tryGet(mr.roleId)?.name)
      .filter((name): name is string => !!name);

    return {
      id: config.id,
      name: config.name,
      description: config.description,
      type: config.type,
      icon: config.icon,
      color: config.color,
      leaderRole: leaderRole?.name || config.leaderRoleId,
      memberRoles,
      capabilities: config.deliverableTypes,
    };
  }
}
