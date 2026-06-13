/**
 * Simulator Agent
 * AI 推演专家 Agent
 *
 * 使用依赖反转原则，通过接口与 AI Apps 层解耦
 * - ISimulationService: 推演服务抽象接口
 */

import { Injectable, Logger, Optional, Inject } from "@nestjs/common";
import { PlanBasedAgent } from "@/modules/ai-harness/facade";
import { SIMULATOR_AGENT_ID } from "../simulation.constants";
import {
  BUILTIN_TOOLS,
  type AgentInput,
  type AgentPlan,
  type AgentEvent,
  type AgentTemplate,
  type ToolId,
  type PlanStep,
} from "@/modules/ai-harness/facade";
import {
  type ISimulationService,
  SIMULATION_SERVICE_TOKEN,
} from "../ports/simulation-service.port";

/**
 * 推演任务类型
 */
export enum SimulationTaskType {
  SCENARIO_CREATION = "scenario_creation", // 场景创建
  RUN_SIMULATION = "run_simulation", // 运行推演
  ANALYSIS = "analysis", // 结果分析
  STRATEGY_ADVICE = "strategy_advice", // 策略建议
}

/**
 * 推演阵营
 */
export enum SimulationTeam {
  BLUE = "BLUE", // 己方
  RED = "RED", // 竞争对手
  GREEN = "GREEN", // 监管方
  WHITE = "WHITE", // 裁判/观察者
}

@Injectable()
export class SimulatorAgent extends PlanBasedAgent {
  private readonly logger = new Logger(SimulatorAgent.name);

  readonly id = SIMULATOR_AGENT_ID;
  readonly name = "AI Simulator";
  readonly description = "智能推演专家，进行多方博弈和场景模拟";
  readonly capabilities = [
    "多方博弈模拟",
    "场景推演分析",
    "决策建议生成",
    "风险评估",
    "黑天鹅事件模拟",
    "竞争态势分析",
  ];
  readonly requiredTools: ToolId[] = [
    BUILTIN_TOOLS.TEXT_GENERATION,
    BUILTIN_TOOLS.DATA_ANALYSIS,
    BUILTIN_TOOLS.AGENT_COMMUNICATION,
    BUILTIN_TOOLS.CONSENSUS_MECHANISM,
    BUILTIN_TOOLS.DATA_FETCH,
    BUILTIN_TOOLS.WEB_SEARCH,
  ];

  protected templates: AgentTemplate[] = [
    {
      id: "market-competition",
      name: "市场竞争推演",
      description: "模拟市场竞争态势和策略博弈",
      category: "business",
      icon: "📊",
      defaultPrompt: "模拟[公司A]与[公司B]的市场竞争",
      defaultOptions: {
        taskType: SimulationTaskType.RUN_SIMULATION,
        rounds: 5,
        teams: [SimulationTeam.BLUE, SimulationTeam.RED],
      },
    },
    {
      id: "regulatory-response",
      name: "监管应对推演",
      description: "模拟监管政策变化的应对策略",
      category: "regulatory",
      icon: "⚖️",
      defaultPrompt: "模拟[政策变化]对[公司]的影响",
      defaultOptions: {
        taskType: SimulationTaskType.RUN_SIMULATION,
        rounds: 3,
        teams: [SimulationTeam.BLUE, SimulationTeam.GREEN],
      },
    },
    {
      id: "crisis-management",
      name: "危机管理推演",
      description: "模拟突发危机事件的应对",
      category: "risk",
      icon: "🚨",
      defaultPrompt: "模拟[危机事件]的应对策略",
      defaultOptions: {
        taskType: SimulationTaskType.RUN_SIMULATION,
        rounds: 4,
        enableBlackSwan: true,
      },
    },
    {
      id: "negotiation-simulation",
      name: "谈判模拟",
      description: "模拟商业谈判过程",
      category: "negotiation",
      icon: "🤝",
      defaultPrompt: "模拟与[对方]的[谈判议题]谈判",
      defaultOptions: {
        taskType: SimulationTaskType.RUN_SIMULATION,
        rounds: 6,
        teams: [SimulationTeam.BLUE, SimulationTeam.RED],
      },
    },
    {
      id: "strategy-analysis",
      name: "战略分析",
      description: "基于推演结果的战略建议",
      category: "strategy",
      icon: "🎯",
      defaultPrompt: "分析[业务场景]的最优策略",
      defaultOptions: {
        taskType: SimulationTaskType.STRATEGY_ADVICE,
      },
    },
  ];

  protected selectionKeywords: string[] = [
    "推演",
    "模拟",
    "博弈",
    "simulation",
    "simulator",
    "scenario",
  ];

  constructor(
    @Optional()
    @Inject(SIMULATION_SERVICE_TOKEN)
    private readonly simulationService?: ISimulationService,
  ) {
    super();
    // 服务是可选的，如果未提供则 Agent 功能会降级
    void this.simulationService;
  }

  /**
   * 分析用户输入，生成执行计划
   */
  async plan(input: AgentInput): Promise<AgentPlan> {
    this.logger.log(
      `[plan] Planning simulation for: ${input.prompt?.slice(0, 100)}...`,
    );

    const taskId = this.generateTaskId();
    const taskType = this.classifyTask(input.prompt || "");
    const steps: PlanStep[] = [];

    // Step 1: 场景分析
    steps.push({
      id: this.generateStepId(),
      name: "场景分析",
      description: "分析推演需求，确定场景参数",
      toolId: BUILTIN_TOOLS.TEXT_GENERATION,
      dependencies: [],
      estimatedDuration: 5000,
    });

    // Step 2: 数据收集
    steps.push({
      id: this.generateStepId(),
      name: "数据收集",
      description: "收集相关市场和竞争数据",
      toolId: BUILTIN_TOOLS.DATA_FETCH,
      dependencies: [steps[0].id],
      estimatedDuration: 8000,
    });

    // Step 3: 场景构建
    steps.push({
      id: this.generateStepId(),
      name: "场景构建",
      description: "构建推演场景和参与者",
      toolId: BUILTIN_TOOLS.TEXT_GENERATION,
      dependencies: [steps[1].id],
      estimatedDuration: 10000,
    });

    // Step 4: 多轮推演
    const rounds = (input.options?.rounds as number) || 5;
    for (let i = 1; i <= rounds; i++) {
      steps.push({
        id: this.generateStepId(),
        name: `推演第 ${i} 轮`,
        description: `执行第 ${i} 轮多方决策`,
        toolId: BUILTIN_TOOLS.AGENT_COMMUNICATION,
        dependencies: [steps[steps.length - 1].id],
        estimatedDuration: 15000,
      });
    }

    // Step 5: 结果分析
    steps.push({
      id: this.generateStepId(),
      name: "结果分析",
      description: "分析推演结果和关键发现",
      toolId: BUILTIN_TOOLS.DATA_ANALYSIS,
      dependencies: [steps[steps.length - 1].id],
      estimatedDuration: 10000,
    });

    // Step 6: 策略建议
    steps.push({
      id: this.generateStepId(),
      name: "策略建议",
      description: "生成基于推演的策略建议",
      toolId: BUILTIN_TOOLS.TEXT_GENERATION,
      dependencies: [steps[steps.length - 1].id],
      estimatedDuration: 8000,
    });

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
        rounds,
        enableBlackSwan: input.options?.enableBlackSwan,
      },
    };
  }

  /**
   * 执行计划，流式返回进度和结果
   */
  async *execute(plan: AgentPlan): AsyncGenerator<AgentEvent> {
    this.logger.log(`[execute] Starting simulation for task: ${plan.taskId}`);

    const input = (plan as AgentPlan & { input?: AgentInput }).input;
    if (!input) {
      yield {
        type: "error",
        error: "No input provided in plan context",
        stepId: plan.steps[0]?.id,
      };
      return;
    }

    const startTime = Date.now();

    try {
      // 发送计划就绪事件
      yield {
        type: "plan_ready",
        plan,
      };

      const simulationResults: SimulationRound[] = [];
      let scenarioContext = "";

      // 执行每个步骤
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];

        // 步骤开始
        yield {
          type: "step_start",
          stepId: step.id,
          message: `开始 ${step.name}`,
        };

        // 执行步骤
        const result = await this.executeStep(step, input, {
          scenarioContext,
          previousRounds: simulationResults,
        });

        // 更新进度
        yield {
          type: "step_progress",
          stepId: step.id,
          progress: 100,
          message: `${step.name} 完成`,
        };

        // 更新上下文
        if (result.scenarioContext) {
          scenarioContext = result.scenarioContext;
        }
        if (result.roundResult) {
          simulationResults.push(result.roundResult);
        }

        yield {
          type: "step_complete",
          stepId: step.id,
          result: result,
        };
      }

      // 生成最终报告
      const report = this.generateSimulationReport(
        input.prompt || "",
        simulationResults,
        scenarioContext,
      );

      // 完成
      const duration = Date.now() - startTime;

      yield {
        type: "complete",
        result: {
          success: true,
          artifacts: [
            {
              id: this.generateTaskId(),
              type: "data",
              name: "推演报告",
              mimeType: "application/json",
              size: JSON.stringify(report).length,
              content: report,
              metadata: {
                rounds: simulationResults.length,
              },
            },
          ],
          summary: `推演完成，共执行 ${simulationResults.length} 轮`,
          tokensUsed: 0,
          duration,
        },
      };
    } catch (error) {
      this.logger.error(`[execute] Error: ${error}`);
      yield {
        type: "error",
        error: error instanceof Error ? error.message : "推演执行失败",
      };
    }
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(
    step: PlanStep,
    input: AgentInput,
    context: {
      scenarioContext: string;
      previousRounds: SimulationRound[];
    },
  ): Promise<{
    scenarioContext?: string;
    roundResult?: SimulationRound;
    analysis?: string;
  }> {
    // 判断是否是推演轮次
    if (step.name.startsWith("推演第")) {
      const roundNumber = context.previousRounds.length + 1;
      const roundResult = await this.executeSimulationRound(
        roundNumber,
        input,
        context.scenarioContext,
        context.previousRounds,
      );
      return { roundResult };
    }

    switch (step.toolId) {
      case BUILTIN_TOOLS.TEXT_GENERATION:
        if (step.name === "场景分析") {
          const scenarioContext = this.analyzeScenario(input.prompt || "");
          return { scenarioContext };
        }
        if (step.name === "场景构建") {
          return { scenarioContext: context.scenarioContext };
        }
        if (step.name === "策略建议") {
          return {
            analysis: this.generateStrategyAdvice(context.previousRounds),
          };
        }
        return {};

      case BUILTIN_TOOLS.DATA_FETCH:
        // 模拟数据收集
        return { scenarioContext: context.scenarioContext };

      case BUILTIN_TOOLS.DATA_ANALYSIS:
        return {
          analysis: this.analyzeResults(context.previousRounds),
        };

      default:
        return {};
    }
  }

  /**
   * 执行单轮推演
   */
  private async executeSimulationRound(
    roundNumber: number,
    input: AgentInput,
    scenarioContext: string,
    previousRounds: SimulationRound[],
  ): Promise<SimulationRound> {
    const teams = (input.options?.teams as SimulationTeam[]) || [
      SimulationTeam.BLUE,
      SimulationTeam.RED,
    ];

    const actions: TeamAction[] = [];

    for (const team of teams) {
      const action = await this.generateTeamAction(
        team,
        roundNumber,
        scenarioContext,
        previousRounds,
      );
      actions.push(action);
    }

    // 检查是否注入黑天鹅事件
    let blackSwanEvent: BlackSwanEvent | undefined;
    if (input.options?.enableBlackSwan && Math.random() < 0.15) {
      blackSwanEvent = this.generateBlackSwanEvent();
    }

    return {
      roundNumber,
      actions,
      blackSwanEvent,
      worldState: this.calculateWorldState(previousRounds, actions),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 生成团队行动
   */
  private async generateTeamAction(
    team: SimulationTeam,
    roundNumber: number,
    _scenarioContext: string,
    _previousRounds: SimulationRound[],
  ): Promise<TeamAction> {
    // 简化实现：生成模拟行动
    const actionTemplates: Record<SimulationTeam, string[]> = {
      [SimulationTeam.BLUE]: [
        "加大市场投入",
        "优化产品定价",
        "拓展新渠道",
        "提升服务质量",
      ],
      [SimulationTeam.RED]: [
        "发起价格战",
        "推出竞品",
        "挖角关键人才",
        "增加营销预算",
      ],
      [SimulationTeam.GREEN]: [
        "出台新规定",
        "加强监管力度",
        "发布行业指导",
        "约谈企业代表",
      ],
      [SimulationTeam.WHITE]: ["发布市场报告", "评估各方表现", "提出公正建议"],
    };

    const templates = actionTemplates[team] || ["执行常规操作"];
    const action = templates[Math.floor(Math.random() * templates.length)];

    return {
      team,
      role: `${team} 代表`,
      publicAction: `第 ${roundNumber} 轮：${action}`,
      innerMonologue: `根据当前态势，决定 ${action.toLowerCase()}`,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 生成黑天鹅事件
   */
  private generateBlackSwanEvent(): BlackSwanEvent {
    const events: BlackSwanEvent[] = [
      {
        type: "supply_chain",
        name: "供应链中断",
        description: "关键供应商遭遇不可抗力，交付周期延长",
        impact: "high",
      },
      {
        type: "regulation",
        name: "监管政策突变",
        description: "新政策出台，限制部分业务",
        impact: "high",
      },
      {
        type: "competitor_move",
        name: "竞争对手突击",
        description: "主要竞争对手宣布重大技术突破",
        impact: "medium",
      },
      {
        type: "media_exposure",
        name: "媒体曝光事件",
        description: "负面新闻曝光，舆情危机爆发",
        impact: "medium",
      },
    ];

    return events[Math.floor(Math.random() * events.length)];
  }

  /**
   * 计算世界状态
   */
  private calculateWorldState(
    previousRounds: SimulationRound[],
    _currentActions: TeamAction[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- world state is an open domain-specific dynamic record
  ): Record<string, any> {
    // 简化实现：返回基本状态
    return {
      round: previousRounds.length + 1,
      marketShare: {
        BLUE: 50 + (Math.random() - 0.5) * 10,
        RED: 50 - (Math.random() - 0.5) * 10,
      },
      sentiment: Math.random() > 0.5 ? "positive" : "neutral",
    };
  }

  /**
   * 分析场景
   */
  private analyzeScenario(prompt: string): string {
    return `
场景分析:
- 主题: ${prompt.slice(0, 100)}
- 参与方: 多方博弈
- 目标: 优化决策策略
- 约束: 市场规则、监管要求
`;
  }

  /**
   * 分析结果
   */
  private analyzeResults(rounds: SimulationRound[]): string {
    return `
推演结果分析:
- 总轮数: ${rounds.length}
- 关键发现: 多方博弈态势演变
- 风险点: 已识别
- 机会点: 已标记
`;
  }

  /**
   * 生成策略建议
   */
  private generateStrategyAdvice(rounds: SimulationRound[]): string {
    return `
基于 ${rounds.length} 轮推演的策略建议:
1. 保持核心竞争优势
2. 灵活应对竞争态势
3. 建立风险预警机制
4. 把握市场机会窗口
`;
  }

  /**
   * 生成推演报告
   */
  private generateSimulationReport(
    topic: string,
    rounds: SimulationRound[],
    scenarioContext: string,
  ): SimulationReport {
    return {
      topic,
      scenarioContext,
      totalRounds: rounds.length,
      rounds,
      summary: {
        keyFindings: ["多方博弈态势复杂", "竞争格局动态变化", "风险与机会并存"],
        recommendations: [
          "加强市场洞察能力",
          "建立快速响应机制",
          "保持战略灵活性",
        ],
        riskAssessment: {
          level: "medium",
          factors: ["市场竞争", "政策变化", "技术迭代"],
        },
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * 分类任务类型
   */
  private classifyTask(prompt: string): SimulationTaskType {
    const lowerPrompt = prompt.toLowerCase();

    if (lowerPrompt.includes("创建") || lowerPrompt.includes("构建场景")) {
      return SimulationTaskType.SCENARIO_CREATION;
    }
    if (lowerPrompt.includes("分析") || lowerPrompt.includes("评估")) {
      return SimulationTaskType.ANALYSIS;
    }
    if (lowerPrompt.includes("策略") || lowerPrompt.includes("建议")) {
      return SimulationTaskType.STRATEGY_ADVICE;
    }

    return SimulationTaskType.RUN_SIMULATION;
  }
}

// 类型定义
interface TeamAction {
  team: SimulationTeam;
  role: string;
  publicAction: string;
  innerMonologue?: string;
  timestamp: string;
}

interface BlackSwanEvent {
  type: string;
  name: string;
  description: string;
  impact: "high" | "medium" | "low";
}

interface SimulationRound {
  roundNumber: number;
  actions: TeamAction[];
  blackSwanEvent?: BlackSwanEvent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column; world state shape is domain-specific
  worldState: Record<string, any>;
  timestamp: string;
}

interface SimulationReport {
  topic: string;
  scenarioContext: string;
  totalRounds: number;
  rounds: SimulationRound[];
  summary: {
    keyFindings: string[];
    recommendations: string[];
    riskAssessment: {
      level: string;
      factors: string[];
    };
  };
  generatedAt: string;
}
