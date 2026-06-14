/**
 * Team Collaboration Agent
 * AI 团队协作专家 Agent
 *
 * 使用 AI Engine 内置能力：
 * - VotingManager: 共识投票
 * - HandoffCoordinator: 任务交接
 * - DAGExecutor: 工作流编排
 */

import { Injectable, Logger } from "@nestjs/common";
import { PlanBasedAgent } from "@/modules/ai-harness/facade";
import { TEAM_COLLABORATION_AGENT_ID } from "../teams.constants";
import {
  BUILTIN_TOOLS,
  type AgentInput,
  type AgentPlan,
  type AgentEvent,
  type AgentTemplate,
  type ToolId,
  type PlanStep,
} from "@/modules/ai-harness/facade";

/**
 * 团队协作任务类型
 */
export enum TeamTaskType {
  TEAM_BRAINSTORM = "team_brainstorm", // 团队头脑风暴
  TASK_DELEGATION = "task_delegation", // 任务分配
  CONSENSUS_VOTING = "consensus_voting", // 共识投票
  DEBATE_SESSION = "debate_session", // 辩论会话
  MISSION_EXECUTION = "mission_execution", // 任务执行
}

/**
 * 投票策略
 */
export enum VotingStrategy {
  MAJORITY = "MAJORITY", // 简单多数 (>50%)
  SUPERMAJORITY = "SUPERMAJORITY", // 超级多数 (>66%)
  UNANIMOUS = "UNANIMOUS", // 全票通过 (100%)
}

@Injectable()
export class TeamCollaborationAgent extends PlanBasedAgent {
  private readonly logger = new Logger(TeamCollaborationAgent.name);

  readonly id = TEAM_COLLABORATION_AGENT_ID;
  readonly name = "AI Team Collaboration";
  readonly description =
    "智能团队协作专家，管理多 AI 成员协作、任务分配和共识投票";
  readonly capabilities = [
    "团队任务协调",
    "智能任务分配",
    "共识投票决策",
    "辩论主持管理",
    "任务编排执行",
    "多 AI 成员管理",
  ];
  readonly requiredTools: ToolId[] = [
    BUILTIN_TOOLS.TASK_DELEGATION,
    BUILTIN_TOOLS.AGENT_HANDOFF,
    BUILTIN_TOOLS.CONSENSUS_MECHANISM,
    BUILTIN_TOOLS.AGENT_COMMUNICATION,
    BUILTIN_TOOLS.WORKFLOW_ORCHESTRATION,
    BUILTIN_TOOLS.TEXT_GENERATION,
    BUILTIN_TOOLS.SHORT_TERM_MEMORY,
    BUILTIN_TOOLS.STRUCTURED_OUTPUT,
  ];

  protected templates: AgentTemplate[] = [
    {
      id: "team-brainstorm",
      name: "团队头脑风暴",
      description: "多 AI 成员共同对主题进行头脑风暴",
      category: "collaboration",
      icon: "💡",
      defaultPrompt: "组织团队成员对[主题]进行头脑风暴",
      defaultOptions: {
        taskType: TeamTaskType.TEAM_BRAINSTORM,
        maxRounds: 3,
        language: "zh-CN",
      },
    },
    {
      id: "task-breakdown",
      name: "任务分解",
      description: "将复杂任务分解并分配给合适的团队成员",
      category: "management",
      icon: "📋",
      defaultPrompt: "将[任务描述]分解为子任务并分配给团队成员",
      defaultOptions: {
        taskType: TeamTaskType.TASK_DELEGATION,
        autoAssign: true,
        language: "zh-CN",
      },
    },
    {
      id: "consensus-decision",
      name: "共识决策",
      description: "通过投票达成团队共识",
      category: "decision",
      icon: "🗳️",
      defaultPrompt: "就[议题]进行团队投票表决",
      defaultOptions: {
        taskType: TeamTaskType.CONSENSUS_VOTING,
        votingStrategy: VotingStrategy.MAJORITY,
        language: "zh-CN",
      },
    },
    {
      id: "red-blue-debate",
      name: "红蓝对抗辩论",
      description: "组织正反方辩论分析问题",
      category: "analysis",
      icon: "⚔️",
      defaultPrompt: "就[论题]组织红蓝两方进行辩论",
      defaultOptions: {
        taskType: TeamTaskType.DEBATE_SESSION,
        maxRounds: 5,
        includeJudge: true,
        language: "zh-CN",
      },
    },
    {
      id: "mission-planning",
      name: "任务规划执行",
      description: "规划并执行完整的团队任务",
      category: "execution",
      icon: "🎯",
      defaultPrompt: "规划并执行[任务目标]",
      defaultOptions: {
        taskType: TeamTaskType.MISSION_EXECUTION,
        maxRevisions: 2,
        language: "zh-CN",
      },
    },
  ];

  protected selectionKeywords: string[] = [
    "团队",
    "协作",
    "头脑风暴",
    "brainstorm",
    "投票",
    "表决",
    "vote",
    "共识",
    "辩论",
    "debate",
    "红蓝",
    "分配",
    "委派",
    "assign",
    "delegate",
    "team",
    "collaboration",
  ];

  constructor() {
    super();
  }

  /**
   * 分析用户输入，生成执行计划
   */
  async plan(input: AgentInput): Promise<AgentPlan> {
    this.logger.log(
      `[plan] Planning team collaboration for: ${input.prompt?.slice(0, 100)}...`,
    );

    const taskId = this.generateTaskId();
    const taskType = this.classifyTask(input.prompt || "", input.options);
    const steps: PlanStep[] = [];

    switch (taskType) {
      case TeamTaskType.TEAM_BRAINSTORM:
        this.planBrainstorm(steps, input);
        break;
      case TeamTaskType.TASK_DELEGATION:
        this.planTaskDelegation(steps, input);
        break;
      case TeamTaskType.CONSENSUS_VOTING:
        this.planConsensusVoting(steps, input);
        break;
      case TeamTaskType.DEBATE_SESSION:
        this.planDebateSession(steps, input);
        break;
      case TeamTaskType.MISSION_EXECUTION:
        this.planMissionExecution(steps, input);
        break;
    }

    const estimatedTime = steps.reduce(
      (acc, step) => acc + step.estimatedDuration,
      0,
    );

    return {
      taskId,
      agentId: this.id,
      steps,
      estimatedTime,
      toolsRequired: this.requiredTools,
      modelsRequired: ["chat"],
      metadata: {
        taskType,
        topicId: input.options?.topicId,
      },
    };
  }

  /**
   * 规划头脑风暴流程
   */
  private planBrainstorm(steps: PlanStep[], input: AgentInput): void {
    const maxRounds = (input.options?.maxRounds as number) || 3;

    // Step 1: 初始化头脑风暴
    steps.push({
      id: this.generateStepId(),
      name: "初始化头脑风暴",
      description: "设置头脑风暴主题和参与成员",
      toolId: BUILTIN_TOOLS.WORKFLOW_ORCHESTRATION,
      dependencies: [],
      estimatedDuration: 2000,
    });

    // Step 2-N: 头脑风暴轮次
    for (let i = 0; i < maxRounds; i++) {
      steps.push({
        id: this.generateStepId(),
        name: `头脑风暴第 ${i + 1} 轮`,
        description: `收集第 ${i + 1} 轮成员想法`,
        toolId: BUILTIN_TOOLS.AGENT_COMMUNICATION,
        dependencies: [steps[steps.length - 1].id],
        estimatedDuration: 15000,
      });
    }

    // 最后一步：整合想法
    steps.push({
      id: this.generateStepId(),
      name: "整合头脑风暴结果",
      description: "汇总和归纳所有想法",
      toolId: BUILTIN_TOOLS.TEXT_GENERATION,
      dependencies: [steps[steps.length - 1].id],
      estimatedDuration: 10000,
    });
  }

  /**
   * 规划任务分配流程
   */
  private planTaskDelegation(steps: PlanStep[], _input: AgentInput): void {
    // Step 1: 分析任务
    steps.push({
      id: this.generateStepId(),
      name: "任务分析",
      description: "分析任务需求和复杂度",
      toolId: BUILTIN_TOOLS.TEXT_GENERATION,
      dependencies: [],
      estimatedDuration: 5000,
    });

    // Step 2: 任务分解
    steps.push({
      id: this.generateStepId(),
      name: "任务分解",
      description: "将任务分解为子任务",
      toolId: BUILTIN_TOOLS.STRUCTURED_OUTPUT,
      dependencies: [steps[0].id],
      estimatedDuration: 8000,
    });

    // Step 3: 成员能力评估
    steps.push({
      id: this.generateStepId(),
      name: "成员能力评估",
      description: "评估各成员能力和可用性",
      toolId: BUILTIN_TOOLS.TASK_DELEGATION,
      dependencies: [steps[1].id],
      estimatedDuration: 3000,
    });

    // Step 4: 任务分配
    steps.push({
      id: this.generateStepId(),
      name: "任务分配",
      description: "将子任务分配给合适的成员",
      toolId: BUILTIN_TOOLS.AGENT_HANDOFF,
      dependencies: [steps[2].id],
      estimatedDuration: 5000,
    });

    // Step 5: 生成分配报告
    steps.push({
      id: this.generateStepId(),
      name: "生成分配报告",
      description: "生成任务分配总结报告",
      toolId: BUILTIN_TOOLS.TEXT_GENERATION,
      dependencies: [steps[3].id],
      estimatedDuration: 5000,
    });
  }

  /**
   * 规划共识投票流程
   */
  private planConsensusVoting(steps: PlanStep[], _input: AgentInput): void {
    // Step 1: 创建投票提案
    steps.push({
      id: this.generateStepId(),
      name: "创建投票提案",
      description: "整理投票议题和选项",
      toolId: BUILTIN_TOOLS.CONSENSUS_MECHANISM,
      dependencies: [],
      estimatedDuration: 3000,
    });

    // Step 2: 通知成员投票
    steps.push({
      id: this.generateStepId(),
      name: "通知成员投票",
      description: "向所有参与成员发送投票通知",
      toolId: BUILTIN_TOOLS.AGENT_COMMUNICATION,
      dependencies: [steps[0].id],
      estimatedDuration: 2000,
    });

    // Step 3: 收集投票（使用结构化输出）
    steps.push({
      id: this.generateStepId(),
      name: "收集成员投票",
      description: "收集各成员的投票结果",
      toolId: BUILTIN_TOOLS.STRUCTURED_OUTPUT,
      dependencies: [steps[1].id],
      estimatedDuration: 20000,
    });

    // Step 4: 计算共识
    steps.push({
      id: this.generateStepId(),
      name: "计算投票结果",
      description: "统计投票并判断是否达成共识",
      toolId: BUILTIN_TOOLS.CONSENSUS_MECHANISM,
      dependencies: [steps[2].id],
      estimatedDuration: 3000,
    });

    // Step 5: 生成投票报告
    steps.push({
      id: this.generateStepId(),
      name: "生成投票报告",
      description: "生成详细的投票结果报告",
      toolId: BUILTIN_TOOLS.TEXT_GENERATION,
      dependencies: [steps[3].id],
      estimatedDuration: 5000,
    });
  }

  /**
   * 规划辩论会话流程
   */
  private planDebateSession(steps: PlanStep[], input: AgentInput): void {
    const maxRounds = (input.options?.maxRounds as number) || 5;
    const includeJudge = input.options?.includeJudge !== false;

    // Step 1: 初始化辩论
    steps.push({
      id: this.generateStepId(),
      name: "初始化辩论",
      description: "设置辩论主题和双方立场",
      toolId: BUILTIN_TOOLS.WORKFLOW_ORCHESTRATION,
      dependencies: [],
      estimatedDuration: 3000,
    });

    // Step 2-N: 辩论轮次
    for (let i = 0; i < maxRounds; i++) {
      // 红方发言
      steps.push({
        id: this.generateStepId(),
        name: `第 ${i + 1} 轮 - 正方发言`,
        description: `正方第 ${i + 1} 轮陈述观点`,
        toolId: BUILTIN_TOOLS.AGENT_COMMUNICATION,
        dependencies: [steps[steps.length - 1].id],
        estimatedDuration: 10000,
      });

      // 蓝方发言
      steps.push({
        id: this.generateStepId(),
        name: `第 ${i + 1} 轮 - 反方发言`,
        description: `反方第 ${i + 1} 轮陈述观点`,
        toolId: BUILTIN_TOOLS.AGENT_COMMUNICATION,
        dependencies: [steps[steps.length - 1].id],
        estimatedDuration: 10000,
      });
    }

    // 裁判评判（可选）
    if (includeJudge) {
      steps.push({
        id: this.generateStepId(),
        name: "裁判评判",
        description: "裁判对辩论进行评判",
        toolId: BUILTIN_TOOLS.TEXT_GENERATION,
        dependencies: [steps[steps.length - 1].id],
        estimatedDuration: 15000,
      });
    }

    // 生成辩论总结
    steps.push({
      id: this.generateStepId(),
      name: "生成辩论总结",
      description: "汇总辩论要点和结论",
      toolId: BUILTIN_TOOLS.TEXT_GENERATION,
      dependencies: [steps[steps.length - 1].id],
      estimatedDuration: 10000,
    });
  }

  /**
   * 规划任务执行流程
   */
  private planMissionExecution(steps: PlanStep[], _input: AgentInput): void {
    // Step 1: 创建任务
    steps.push({
      id: this.generateStepId(),
      name: "创建任务",
      description: "初始化任务目标和约束",
      toolId: BUILTIN_TOOLS.WORKFLOW_ORCHESTRATION,
      dependencies: [],
      estimatedDuration: 3000,
    });

    // Step 2: Leader 规划
    steps.push({
      id: this.generateStepId(),
      name: "Leader 任务分解",
      description: "Leader 分解任务并分配",
      toolId: BUILTIN_TOOLS.TASK_DELEGATION,
      dependencies: [steps[0].id],
      estimatedDuration: 15000,
    });

    // Step 3: 执行子任务
    steps.push({
      id: this.generateStepId(),
      name: "执行子任务",
      description: "各成员执行分配的子任务",
      toolId: BUILTIN_TOOLS.AGENT_HANDOFF,
      dependencies: [steps[1].id],
      estimatedDuration: 60000,
    });

    // Step 4: Leader 审核
    steps.push({
      id: this.generateStepId(),
      name: "Leader 审核",
      description: "Leader 审核各成员提交的结果",
      toolId: BUILTIN_TOOLS.TEXT_GENERATION,
      dependencies: [steps[2].id],
      estimatedDuration: 20000,
    });

    // Step 5: 综合输出
    steps.push({
      id: this.generateStepId(),
      name: "综合任务输出",
      description: "整合所有成果生成最终输出",
      toolId: BUILTIN_TOOLS.TEXT_GENERATION,
      dependencies: [steps[3].id],
      estimatedDuration: 15000,
    });
  }

  /**
   * 执行计划，流式返回进度和结果
   */
  async *execute(plan: AgentPlan): AsyncGenerator<AgentEvent> {
    this.logger.log(
      `[execute] Starting team collaboration for task: ${plan.taskId}`,
    );

    const input = (plan as unknown as { input?: AgentInput }).input;
    if (!input) {
      yield {
        type: "error",
        error: "No input provided in plan context",
        stepId: plan.steps[0]?.id,
      };
      return;
    }

    const startTime = Date.now();
    const topicId = input.options?.topicId as string | undefined;
    const taskType = plan.metadata?.taskType as TeamTaskType;

    try {
      // 发送计划就绪事件
      yield {
        type: "plan_ready",
        plan,
      };

      let collaborationResult: Record<string, unknown> = {};
      const memberContributions: Array<Record<string, unknown>> = [];

      // 执行每个步骤
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];

        // 步骤开始
        yield {
          type: "step_start",
          stepId: step.id,
          message: `开始 ${step.name}`,
        };

        // 模拟步骤进度
        yield {
          type: "step_progress",
          stepId: step.id,
          progress: 30,
          message: `正在执行 ${step.name}...`,
        };

        // 根据步骤类型执行相应操作
        const result = await this.executeStep(step, input, {
          topicId,
          taskType,
          previousResult: collaborationResult,
          contributions: memberContributions,
        });

        if (result.data) {
          collaborationResult = { ...collaborationResult, ...result.data };
        }
        if (result.contribution) {
          memberContributions.push(result.contribution);
        }

        yield {
          type: "step_progress",
          stepId: step.id,
          progress: 100,
          message: `${step.name} 完成`,
        };

        yield {
          type: "step_complete",
          stepId: step.id,
          result: result,
        };
      }

      // 完成
      const duration = Date.now() - startTime;
      const summary = this.generateSummary(
        taskType,
        collaborationResult,
        memberContributions,
      );

      yield {
        type: "complete",
        result: {
          success: true,
          artifacts: [
            {
              id: this.generateTaskId(),
              type: "data",
              name: this.getArtifactName(taskType),
              mimeType: "application/json",
              size: JSON.stringify(collaborationResult).length,
              content: collaborationResult,
              metadata: {
                taskType,
                topicId,
                memberCount: memberContributions.length,
              },
            },
          ],
          summary,
          tokensUsed: 0,
          duration,
        },
      };
    } catch (error) {
      this.logger.error(`[execute] Error: ${error}`);
      yield {
        type: "error",
        error: error instanceof Error ? error.message : "团队协作执行失败",
      };
    }
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(
    step: PlanStep,
    _input: AgentInput,
    context: {
      topicId?: string;
      taskType: TeamTaskType;
      previousResult: Record<string, unknown>;
      contributions: Array<Record<string, unknown>>;
    },
  ): Promise<{
    data?: Record<string, unknown>;
    contribution?: Record<string, unknown>;
  }> {
    const { topicId: _topicId, taskType } = context;

    // 根据工具类型模拟执行
    switch (step.toolId) {
      case BUILTIN_TOOLS.WORKFLOW_ORCHESTRATION:
        return {
          data: {
            initialized: true,
            taskType,
            timestamp: new Date().toISOString(),
          },
        };

      case BUILTIN_TOOLS.AGENT_COMMUNICATION:
        // 模拟成员交流
        return {
          contribution: {
            stepId: step.id,
            stepName: step.name,
            content: `成员在 "${step.name}" 中的贡献`,
            timestamp: new Date().toISOString(),
          },
        };

      case BUILTIN_TOOLS.TASK_DELEGATION:
        // 模拟任务分配
        return {
          data: {
            tasksAssigned: true,
            assignmentCount: 3,
          },
        };

      case BUILTIN_TOOLS.AGENT_HANDOFF:
        // 模拟任务交接
        return {
          data: {
            handoffCompleted: true,
          },
        };

      case BUILTIN_TOOLS.CONSENSUS_MECHANISM:
        // 模拟共识机制
        return {
          data: {
            consensusReached: true,
            votingResult: {
              approve: 3,
              reject: 1,
              abstain: 0,
            },
          },
        };

      case BUILTIN_TOOLS.STRUCTURED_OUTPUT:
        // 模拟结构化输出
        return {
          data: {
            structuredData: {
              summary: step.description,
              details: [],
            },
          },
        };

      case BUILTIN_TOOLS.TEXT_GENERATION:
        // 模拟文本生成
        return {
          data: {
            generatedContent: `${step.name} 生成的内容...`,
          },
        };

      default:
        return {};
    }
  }

  /**
   * 生成执行总结
   */
  private generateSummary(
    taskType: TeamTaskType,
    _result: Record<string, unknown>,
    contributions: Array<Record<string, unknown>>,
  ): string {
    const typeNames: Record<TeamTaskType, string> = {
      [TeamTaskType.TEAM_BRAINSTORM]: "团队头脑风暴",
      [TeamTaskType.TASK_DELEGATION]: "任务分配",
      [TeamTaskType.CONSENSUS_VOTING]: "共识投票",
      [TeamTaskType.DEBATE_SESSION]: "辩论会话",
      [TeamTaskType.MISSION_EXECUTION]: "任务执行",
    };

    return `${typeNames[taskType]}完成，共 ${contributions.length} 个协作步骤`;
  }

  /**
   * 获取产出物名称
   */
  private getArtifactName(taskType: TeamTaskType): string {
    const names: Record<TeamTaskType, string> = {
      [TeamTaskType.TEAM_BRAINSTORM]: "头脑风暴结果",
      [TeamTaskType.TASK_DELEGATION]: "任务分配报告",
      [TeamTaskType.CONSENSUS_VOTING]: "投票结果",
      [TeamTaskType.DEBATE_SESSION]: "辩论记录",
      [TeamTaskType.MISSION_EXECUTION]: "任务执行报告",
    };

    return names[taskType] || "协作结果";
  }

  /**
   * 分类任务类型
   */
  private classifyTask(
    prompt: string,
    options?: Record<string, unknown>,
  ): TeamTaskType {
    // 优先使用 options 中指定的类型
    if (options?.taskType) {
      return options.taskType as TeamTaskType;
    }

    const lowerPrompt = prompt.toLowerCase();

    if (
      lowerPrompt.includes("头脑风暴") ||
      lowerPrompt.includes("brainstorm") ||
      lowerPrompt.includes("集思广益")
    ) {
      return TeamTaskType.TEAM_BRAINSTORM;
    }

    if (
      lowerPrompt.includes("分配") ||
      lowerPrompt.includes("委派") ||
      lowerPrompt.includes("assign") ||
      lowerPrompt.includes("delegate")
    ) {
      return TeamTaskType.TASK_DELEGATION;
    }

    if (
      lowerPrompt.includes("投票") ||
      lowerPrompt.includes("表决") ||
      lowerPrompt.includes("vote") ||
      lowerPrompt.includes("共识")
    ) {
      return TeamTaskType.CONSENSUS_VOTING;
    }

    if (
      lowerPrompt.includes("辩论") ||
      lowerPrompt.includes("debate") ||
      lowerPrompt.includes("红蓝") ||
      lowerPrompt.includes("正反")
    ) {
      return TeamTaskType.DEBATE_SESSION;
    }

    if (
      lowerPrompt.includes("任务") ||
      lowerPrompt.includes("mission") ||
      lowerPrompt.includes("执行") ||
      lowerPrompt.includes("完成")
    ) {
      return TeamTaskType.MISSION_EXECUTION;
    }

    // 默认为任务执行
    return TeamTaskType.MISSION_EXECUTION;
  }
}
