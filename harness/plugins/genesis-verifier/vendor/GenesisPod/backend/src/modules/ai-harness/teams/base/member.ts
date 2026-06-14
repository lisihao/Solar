/**
 * AI Engine - Team Member Implementation
 * 团队成员实现类
 */

import { v4 as uuidv4 } from "uuid";
import { ToolId, SkillId } from "@/modules/ai-harness/agents/abstractions/agent.types";
import { IRole, RoleId, WorkStyle } from "../abstractions/role.interface";
import {
  ITeamMember,
  TeamMemberId,
  MemberStatus,
  MemberConfig,
  ILeader,
  TaskInput,
  SubTask,
  TaskAssignment,
  MemberOutput,
  ReviewResult,
  IntegratedResult,
  ReworkDecision,
} from "../abstractions/member.interface";
import { Role } from "./role";
import { ILeaderLLMAdapter } from "./leader-llm-adapter";

/**
 * 团队成员实现类
 */
export class TeamMember implements ITeamMember {
  readonly id: TeamMemberId;
  readonly name: string;
  readonly role: IRole;
  readonly model: string;
  readonly skills: SkillId[];
  readonly tools: ToolId[];
  readonly persona: string;
  readonly workStyle: WorkStyle;
  readonly metadata?: Record<string, unknown>;

  status: MemberStatus = "idle";

  constructor(config: MemberConfig, role: IRole) {
    this.id = config.id || uuidv4();
    this.name = config.name || `${role.name}-${this.id.slice(0, 4)}`;
    this.role = role;
    this.model = config.model;

    // 合并技能：角色核心技能 + 额外技能
    this.skills = [...role.coreSkills, ...(config.additionalSkills || [])];

    // 合并工具：角色核心工具 + 额外工具
    this.tools = [...role.coreTools, ...(config.additionalTools || [])];

    this.persona = config.persona || this.generateDefaultPersona(role);
    this.workStyle = this.mergeWorkStyle(
      role.defaultWorkStyle,
      config.workStyle,
    );
    this.metadata = config.metadata;
  }

  /**
   * 是否为 Leader
   */
  isLeader(): boolean {
    return this.role.type === "leader";
  }

  /**
   * 检查是否有某技能
   */
  hasSkill(skillId: SkillId): boolean {
    return this.skills.includes(skillId);
  }

  /**
   * 检查是否有某工具
   */
  hasTool(toolId: ToolId): boolean {
    return this.tools.includes(toolId);
  }

  /**
   * 获取系统提示词
   */
  getSystemPrompt(): string {
    const role = this.role as Role;
    return role.generateSystemPrompt({
      persona: this.persona,
      member_name: this.name,
      model: this.model,
    });
  }

  /**
   * 生成默认人设
   */
  private generateDefaultPersona(role: IRole): string {
    return `你是一名专业的${role.name}，${role.description}。
你的职责包括：${role.responsibilities.join("、")}。
请始终保持专业、准确、高效的工作态度。`;
  }

  /**
   * 合并工作风格
   */
  private mergeWorkStyle(
    base: WorkStyle,
    override?: Partial<WorkStyle>,
  ): WorkStyle {
    if (!override) return base;
    return { ...base, ...override };
  }

  /**
   * 更新状态
   */
  updateStatus(status: MemberStatus): void {
    this.status = status;
  }

  /**
   * 转换为 JSON
   */
  toJSON(): MemberConfig & { roleId: string } {
    return {
      id: this.id,
      name: this.name,
      roleId: this.role.id,
      model: this.model,
      persona: this.persona,
      workStyle: this.workStyle,
      metadata: this.metadata,
    };
  }
}

/**
 * Leader 配置（扩展 MemberConfig）
 */
export interface LeaderConfig extends MemberConfig {
  /** LLM 适配器（可选，用于真正的 LLM 调用） */
  llmAdapter?: ILeaderLLMAdapter;

  /** 可分配的角色列表（用于任务分解） */
  availableRoles?: RoleId[];

  /** 审核标准 */
  reviewCriteria?: string[];

  /** 任务目标（用于结果整合） */
  goal?: string;
}

/**
 * Leader 实现类
 */
export class Leader extends TeamMember implements ILeader {
  private readonly llmAdapter?: ILeaderLLMAdapter;
  private availableRoles: RoleId[] = [];
  private reviewCriteria: string[] = [
    "内容完整性：是否涵盖所有要求的要点",
    "准确性：信息是否准确可靠",
    "逻辑性：论述是否清晰有条理",
    "专业性：是否符合专业标准",
  ];
  private goal: string = "";

  constructor(config: LeaderConfig, role: IRole) {
    super(config, role);

    // 确保角色是 Leader 类型
    if (role.type !== "leader") {
      throw new Error(`Role ${role.id} is not a leader role`);
    }

    this.llmAdapter = config.llmAdapter;
    this.availableRoles = config.availableRoles || [];
    if (config.reviewCriteria) {
      this.reviewCriteria = config.reviewCriteria;
    }
    if (config.goal) {
      this.goal = config.goal;
    }
  }

  /**
   * 设置可分配的角色列表
   */
  setAvailableRoles(roles: RoleId[]): void {
    this.availableRoles = roles;
  }

  /**
   * 设置审核标准
   */
  setReviewCriteria(criteria: string[]): void {
    this.reviewCriteria = criteria;
  }

  /**
   * 设置任务目标
   */
  setGoal(goal: string): void {
    this.goal = goal;
  }

  /**
   * 分解任务
   */
  async decomposeTask(task: TaskInput): Promise<SubTask[]> {
    // 如果有 LLM 适配器，使用真正的 LLM 调用
    if (this.llmAdapter) {
      return this.llmAdapter.decomposeTask(
        task,
        this.availableRoles.length > 0
          ? this.availableRoles
          : ["researcher", "analyst", "writer"],
        this.persona,
      );
    }

    // 回退到占位实现
    return [
      {
        id: uuidv4(),
        parentTaskId: task.id,
        description: task.description,
        suggestedRole: this.availableRoles[0] || "researcher",
        dependencies: [],
        estimatedDuration: 60000,
        priority: 1,
      },
    ];
  }

  /**
   * 分配任务给成员
   */
  async assignTask(
    subTask: SubTask,
    member: ITeamMember,
  ): Promise<TaskAssignment> {
    return {
      id: uuidv4(),
      subTask,
      assignee: member.id,
      assignedAt: new Date(),
      instructions: `请完成以下任务：${subTask.description}`,
    };
  }

  /**
   * 审核成员输出
   */
  async reviewOutput(output: MemberOutput): Promise<ReviewResult> {
    // 如果有 LLM 适配器，使用真正的 LLM 调用
    if (this.llmAdapter) {
      const result = await this.llmAdapter.reviewOutput(
        output,
        this.reviewCriteria,
        this.persona,
      );
      // 更新 reviewerId 为当前 Leader
      return {
        ...result,
        reviewerId: this.id,
      };
    }

    // 回退到占位实现
    return {
      id: uuidv4(),
      outputId: output.id,
      reviewerId: this.id,
      passed: true,
      score: 8,
      feedback: "审核通过",
      reviewedAt: new Date(),
    };
  }

  /**
   * 整合最终结果
   */
  async integrateResults(results: MemberOutput[]): Promise<IntegratedResult> {
    // 如果有 LLM 适配器，使用真正的 LLM 调用
    if (this.llmAdapter) {
      return this.llmAdapter.integrateResults(
        results,
        this.goal || "完成任务",
        this.persona,
      );
    }

    // 回退到占位实现
    return {
      id: uuidv4(),
      sourceOutputIds: results.map((r) => r.id),
      content: results.map((r) => r.content),
      contentType: "integrated",
      summary: "整合完成",
      integratedAt: new Date(),
    };
  }

  /**
   * 决定是否需要返工
   */
  async decideRework(review: ReviewResult): Promise<ReworkDecision> {
    return {
      needsRework: !review.passed || review.score < 7,
      outputId: review.outputId,
      reason: review.passed ? undefined : review.feedback,
      guidance: review.issues?.[0]?.suggestion,
      maxRetries: 3,
      currentRetry: 0,
    };
  }
}

/**
 * 创建成员工厂函数
 */
export function createMember(config: MemberConfig, role: IRole): TeamMember {
  if (role.type === "leader") {
    return new Leader(config as LeaderConfig, role);
  }
  return new TeamMember(config, role);
}

/**
 * 创建 Leader 工厂函数
 */
export function createLeader(config: LeaderConfig, role: IRole): Leader {
  return new Leader(config, role);
}
