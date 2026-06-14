/**
 * Topic Insights Agent
 * 多维度深度研究 Agent
 *
 * 注册到 AgentRegistry，让 IntentRouter 可以发现和路由到 topic-insights 模块。
 * 实际执行管线由 ResearchMissionService 驱动，此 Agent 提供声明式元数据。
 */

import { Injectable, Logger } from "@nestjs/common";
import { PlanBasedAgent } from "@/modules/ai-harness/facade";
import { TOPIC_INSIGHTS_AGENT_ID } from "../topic-insights.constants";
import {
  BUILTIN_TOOLS,
  type AgentInput,
  type AgentPlan,
  type AgentEvent,
  type AgentTemplate,
  type ToolId,
  type PlanStep,
} from "@/modules/ai-harness/facade";

@Injectable()
export class TopicInsightsAgent extends PlanBasedAgent {
  private readonly logger = new Logger(TopicInsightsAgent.name);

  readonly id = TOPIC_INSIGHTS_AGENT_ID;
  readonly name = "Topic Insights Researcher";
  readonly description = "多维度深度研究与专业报告生成";
  readonly capabilities = [
    "多维度深度研究",
    "自动化报告生成",
    "事实核查",
    "多Agent辩论分析",
    "跨维度关联分析",
  ];
  readonly requiredTools: ToolId[] = [
    BUILTIN_TOOLS.WEB_SEARCH,
    BUILTIN_TOOLS.RAG_SEARCH,
    BUILTIN_TOOLS.DATA_ANALYSIS,
    BUILTIN_TOOLS.TEXT_GENERATION,
    BUILTIN_TOOLS.DATA_FETCH,
  ];

  protected templates: AgentTemplate[] = [
    {
      id: "topic-deep-research",
      name: "主题深度研究",
      description: "对特定主题进行多维度深度研究并生成报告",
      category: "research",
      icon: "💡",
      defaultPrompt: "对[主题]进行多维度深度分析",
      defaultOptions: { depth: "standard", language: "zh-CN" },
    },
    {
      id: "topic-tracking",
      name: "主题追踪",
      description: "持续追踪主题动态并更新洞察",
      category: "research",
      icon: "📡",
      defaultPrompt: "追踪[主题]的最新动态",
      defaultOptions: { depth: "standard", language: "zh-CN" },
    },
  ];

  protected selectionKeywords: string[] = [
    "深度研究",
    "洞察",
    "topic",
    "insights",
    "多维度",
    "专题",
    "追踪",
  ];

  /**
   * 构建研究规划
   * topic-insights 有自己的执行管线（ResearchMissionService），
   * 此处提供声明式规划供 AgentRegistry 查询。
   */
  async plan(input: AgentInput): Promise<AgentPlan> {
    this.logger.log(
      `[plan] Planning topic insights for: ${input.prompt?.slice(0, 100)}...`,
    );

    const taskId = this.generateTaskId();
    const steps: PlanStep[] = [
      {
        id: this.generateStepId(),
        name: "研究规划",
        description: "Leader 分析主题并规划研究维度",
        toolId: BUILTIN_TOOLS.TEXT_GENERATION,
        dependencies: [],
        estimatedDuration: 10000,
      },
      {
        id: this.generateStepId(),
        name: "多维度研究",
        description: "并行执行各维度的深度研究",
        toolId: BUILTIN_TOOLS.WEB_SEARCH,
        dependencies: [],
        estimatedDuration: 60000,
      },
      {
        id: this.generateStepId(),
        name: "质量审核",
        description: "Leader 审核各维度研究质量",
        toolId: BUILTIN_TOOLS.TEXT_GENERATION,
        dependencies: [],
        estimatedDuration: 15000,
      },
      {
        id: this.generateStepId(),
        name: "报告综合",
        description: "综合各维度结果生成完整报告",
        toolId: BUILTIN_TOOLS.TEXT_GENERATION,
        dependencies: [],
        estimatedDuration: 30000,
      },
    ];

    // Wire up dependencies sequentially
    for (let i = 1; i < steps.length; i++) {
      steps[i].dependencies = [steps[i - 1].id];
    }

    return {
      taskId,
      agentId: this.id,
      steps,
      estimatedTime: steps.reduce((acc, s) => acc + s.estimatedDuration, 0),
      toolsRequired: this.requiredTools,
      modelsRequired: ["chat"],
      metadata: { module: "topic-insights" },
    };
  }

  /**
   * 声明式 placeholder
   * topic-insights 的执行管线由 ResearchMissionService 驱动，
   * 不通过 Agent.execute() 路径执行。
   */
  async *execute(_plan: AgentPlan): AsyncGenerator<AgentEvent> {
    this.logger.log(
      `[execute] Topic insights execution is handled by ResearchMissionService, not this Agent path`,
    );

    yield {
      type: "complete",
      result: {
        success: true,
        artifacts: [],
        summary:
          "Topic insights execution is managed by ResearchMissionService. Use the /topics API to create and manage research missions.",
        tokensUsed: 0,
        duration: 0,
      },
    };
  }
}
