/**
 * Researcher Agent
 * AI 研究助手 Agent
 *
 * 使用依赖反转原则,通过接口与 AI Apps 层解耦
 * - IResearchService: 研究服务抽象接口
 */

import { Injectable, Logger, Optional, Inject } from "@nestjs/common";

/** Research source reference */
type ResearchSource = {
  title?: string;
  url?: string;
  snippet?: string;
  [key: string]: unknown;
};
import { PlanBasedAgent } from "@/modules/ai-harness/facade";
import { RESEARCH_AGENT_ID } from "../research.constants";
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
  type IResearchService,
  RESEARCH_SERVICE_TOKEN,
} from "../ports/research-service.port";

/**
 * 研究任务类型
 */
export enum ResearchTaskType {
  LITERATURE_REVIEW = "literature_review", // 文献综述
  DATA_ANALYSIS = "data_analysis", // 数据分析
  REPORT_GENERATION = "report_generation", // 报告生成
  KNOWLEDGE_EXTRACTION = "knowledge_extraction", // 知识提取
  GENERAL_RESEARCH = "general_research", // 通用研究
}

@Injectable()
export class ResearcherAgent extends PlanBasedAgent {
  private readonly logger = new Logger(ResearcherAgent.name);

  readonly id = RESEARCH_AGENT_ID;
  readonly name = "AI Researcher";
  readonly description = "智能研究助手,帮助用户进行资料调研和知识整理";
  readonly capabilities = [
    "自动调研资料",
    "知识图谱构建",
    "内容摘要生成",
    "研究报告撰写",
    "多源数据整合",
    "文献综述",
  ];
  readonly requiredTools: ToolId[] = [
    BUILTIN_TOOLS.WEB_SEARCH,
    BUILTIN_TOOLS.RAG_SEARCH,
    BUILTIN_TOOLS.KNOWLEDGE_GRAPH,
    BUILTIN_TOOLS.DATA_ANALYSIS,
    BUILTIN_TOOLS.TEXT_GENERATION,
    BUILTIN_TOOLS.LONG_TERM_MEMORY,
    BUILTIN_TOOLS.DATA_FETCH,
  ];

  protected templates: AgentTemplate[] = [
    {
      id: "literature-review",
      name: "文献综述",
      description: "针对特定主题进行文献搜索和综述",
      category: "research",
      icon: "📚",
      defaultPrompt: "对[主题]进行文献综述",
      defaultOptions: {
        taskType: ResearchTaskType.LITERATURE_REVIEW,
        depth: 3,
        language: "zh-CN",
      },
    },
    {
      id: "market-research",
      name: "市场调研",
      description: "市场分析和竞品研究",
      category: "business",
      icon: "📊",
      defaultPrompt: "对[行业/产品]进行市场调研",
      defaultOptions: {
        taskType: ResearchTaskType.DATA_ANALYSIS,
        depth: 2,
        language: "zh-CN",
      },
    },
    {
      id: "technology-analysis",
      name: "技术分析",
      description: "技术趋势和解决方案分析",
      category: "technical",
      icon: "🔧",
      defaultPrompt: "分析[技术领域]的发展趋势",
      defaultOptions: {
        taskType: ResearchTaskType.GENERAL_RESEARCH,
        depth: 3,
        language: "zh-CN",
      },
    },
    {
      id: "knowledge-extraction",
      name: "知识提取",
      description: "从文档中提取关键知识点",
      category: "knowledge",
      icon: "🧠",
      defaultPrompt: "从提供的资料中提取关键知识点",
      defaultOptions: {
        taskType: ResearchTaskType.KNOWLEDGE_EXTRACTION,
        depth: 2,
        language: "zh-CN",
      },
    },
    {
      id: "research-report",
      name: "研究报告",
      description: "生成完整的研究报告",
      category: "research",
      icon: "📝",
      defaultPrompt: "生成关于[主题]的研究报告",
      defaultOptions: {
        taskType: ResearchTaskType.REPORT_GENERATION,
        depth: 3,
        language: "zh-CN",
      },
    },
  ];

  protected selectionKeywords: string[] = [
    "研究",
    "调研",
    "分析",
    "research",
    "文献",
    "综述",
    "知识",
  ];

  constructor(
    @Optional()
    @Inject(RESEARCH_SERVICE_TOKEN)
    private readonly researchService?: IResearchService,
  ) {
    super();
    // 服务是可选的,如果未提供则 Agent 功能会降级
  }

  /**
   * 分析用户输入,生成执行计划
   */
  async plan(input: AgentInput): Promise<AgentPlan> {
    this.logger.log(
      `[plan] Planning research for: ${input.prompt?.slice(0, 100)}...`,
    );

    const taskId = this.generateTaskId();
    const taskType = this.classifyTask(input.prompt || "");
    const steps: PlanStep[] = [];

    // Step 1: 需求分析
    steps.push({
      id: this.generateStepId(),
      name: "需求分析",
      description: "分析研究需求,确定研究范围和目标",
      toolId: BUILTIN_TOOLS.TEXT_GENERATION,
      dependencies: [],
      estimatedDuration: 3000,
    });

    // Step 2: 资料搜集
    steps.push({
      id: this.generateStepId(),
      name: "资料搜集",
      description: "搜索相关资料和文献",
      toolId: BUILTIN_TOOLS.WEB_SEARCH,
      dependencies: [steps[0].id],
      estimatedDuration: 10000,
    });

    // Step 3: 知识库检索
    if (input.options?.useKnowledgeBase !== false) {
      steps.push({
        id: this.generateStepId(),
        name: "知识库检索",
        description: "从知识库中检索相关内容",
        toolId: BUILTIN_TOOLS.RAG_SEARCH,
        dependencies: [steps[0].id],
        estimatedDuration: 5000,
      });
    }

    // Step 4: 数据分析(如果是数据分析任务)
    if (taskType === ResearchTaskType.DATA_ANALYSIS) {
      steps.push({
        id: this.generateStepId(),
        name: "数据分析",
        description: "对收集的数据进行分析",
        toolId: BUILTIN_TOOLS.DATA_ANALYSIS,
        dependencies: [steps[steps.length - 1].id],
        estimatedDuration: 15000,
      });
    }

    // Step 5: 知识图谱构建(如果需要)
    if (input.options?.buildKnowledgeGraph) {
      steps.push({
        id: this.generateStepId(),
        name: "知识图谱构建",
        description: "构建知识关联图谱",
        toolId: BUILTIN_TOOLS.KNOWLEDGE_GRAPH,
        dependencies: [steps[steps.length - 1].id],
        estimatedDuration: 8000,
      });
    }

    // Step 6: 内容整合
    steps.push({
      id: this.generateStepId(),
      name: "内容整合",
      description: "整合分析结果,生成研究内容",
      toolId: BUILTIN_TOOLS.TEXT_GENERATION,
      dependencies: [steps[steps.length - 1].id],
      estimatedDuration: 20000,
    });

    // Step 7: 报告生成
    steps.push({
      id: this.generateStepId(),
      name: "报告生成",
      description: "生成研究报告",
      toolId: BUILTIN_TOOLS.TEXT_GENERATION,
      dependencies: [steps[steps.length - 1].id],
      estimatedDuration: 15000,
    });

    // Step 8: 保存到长期记忆
    if (input.options?.saveToMemory !== false) {
      steps.push({
        id: this.generateStepId(),
        name: "保存研究成果",
        description: "将研究成果保存到长期记忆",
        toolId: BUILTIN_TOOLS.LONG_TERM_MEMORY,
        dependencies: [steps[steps.length - 1].id],
        estimatedDuration: 3000,
      });
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
        projectId: input.options?.projectId,
      },
    };
  }

  /**
   * 执行计划,流式返回进度和结果
   */
  async *execute(plan: AgentPlan): AsyncGenerator<AgentEvent> {
    this.logger.log(`[execute] Starting research for task: ${plan.taskId}`);

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
    const projectId = input.options?.projectId as string | undefined;
    const userId = (input.options?.userId as string) || "system";

    try {
      // 发送计划就绪事件
      yield {
        type: "plan_ready",
        plan,
      };

      let researchContent = "";
      let sources: ResearchSource[] = [];

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
          projectId,
          userId,
          previousContent: researchContent,
          sources,
        });

        if (result.content) {
          researchContent = result.content;
        }
        if (result.sources) {
          sources = [...sources, ...result.sources];
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

      yield {
        type: "complete",
        result: {
          success: true,
          artifacts: [
            {
              id: this.generateTaskId(),
              type: "data",
              name: "研究报告",
              mimeType: "text/markdown",
              size: researchContent.length,
              content: researchContent,
              metadata: {
                sourceCount: sources.length,
                projectId,
              },
            },
          ],
          summary: `研究完成,共引用 ${sources.length} 个来源`,
          tokensUsed: 0,
          duration,
        },
      };
    } catch (error) {
      this.logger.error(`[execute] Error: ${error}`);
      yield {
        type: "error",
        error: error instanceof Error ? error.message : "研究执行失败",
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
      projectId?: string;
      userId: string;
      previousContent: string;
      sources: ResearchSource[];
    },
  ): Promise<{ content?: string; sources?: ResearchSource[] }> {
    const { projectId, userId } = context;

    switch (step.toolId) {
      case BUILTIN_TOOLS.WEB_SEARCH:
        // 模拟网络搜索
        return {
          sources: [
            {
              title: `关于 ${input.prompt?.slice(0, 20)} 的搜索结果`,
              url: "https://example.com",
              snippet: "搜索结果摘要...",
            },
          ],
        };

      case BUILTIN_TOOLS.RAG_SEARCH:
        // 如果有项目 ID,从项目资源中搜索
        if (projectId) {
          // 实际应调用 sourceService.searchSources
          return {
            sources: context.sources,
          };
        }
        return {};

      case BUILTIN_TOOLS.TEXT_GENERATION:
        // 生成研究内容
        const content = await this.generateResearchContent(
          input.prompt || "",
          context.previousContent,
          context.sources,
        );
        return { content };

      case BUILTIN_TOOLS.KNOWLEDGE_GRAPH:
        // 构建知识图谱(简化实现)
        return {
          content: context.previousContent + "\n\n## 知识图谱\n[知识图谱数据]",
        };

      case BUILTIN_TOOLS.LONG_TERM_MEMORY:
        // 保存到长期记忆
        if (projectId) {
          await this.saveResearchOutput(
            userId,
            projectId,
            context.previousContent,
          );
        }
        return {};

      default:
        return {};
    }
  }

  /**
   * 生成研究内容
   */
  private async generateResearchContent(
    prompt: string,
    previousContent: string,
    sources: ResearchSource[],
  ): Promise<string> {
    // 简化实现:生成研究报告结构
    const report = `
# 研究报告

## 研究主题
${prompt}

## 摘要
基于对相关资料的分析,本报告对 "${prompt}" 进行了深入研究。

## 主要发现
${previousContent || "1. 待补充具体发现..."}

## 数据来源
${sources.map((s, i) => `${i + 1}. ${s.title || s.url}`).join("\n") || "- 待补充数据来源"}

## 结论
综合以上分析,得出以下结论...

## 参考文献
${sources.map((s, i) => `[${i + 1}] ${s.title || s.url}`).join("\n") || "- 待补充参考文献"}
`;
    return report;
  }

  /**
   * 保存研究输出
   */
  private async saveResearchOutput(
    userId: string,
    projectId: string,
    content: string,
  ): Promise<void> {
    if (!this.researchService) {
      this.logger.warn("Research service not available, skipping output save");
      return;
    }

    try {
      await this.researchService.saveResearchOutput(userId, projectId, content);
      this.logger.log("Research output saved successfully");
    } catch (error) {
      this.logger.error(`Failed to save research output: ${error}`);
    }
  }

  /**
   * 分类任务类型
   */
  private classifyTask(prompt: string): ResearchTaskType {
    const lowerPrompt = prompt.toLowerCase();

    if (lowerPrompt.includes("文献") || lowerPrompt.includes("综述")) {
      return ResearchTaskType.LITERATURE_REVIEW;
    }
    if (
      lowerPrompt.includes("数据分析") ||
      lowerPrompt.includes("统计") ||
      lowerPrompt.includes("分析")
    ) {
      return ResearchTaskType.DATA_ANALYSIS;
    }
    if (lowerPrompt.includes("报告") || lowerPrompt.includes("撰写")) {
      return ResearchTaskType.REPORT_GENERATION;
    }
    if (lowerPrompt.includes("提取") || lowerPrompt.includes("知识点")) {
      return ResearchTaskType.KNOWLEDGE_EXTRACTION;
    }

    return ResearchTaskType.GENERAL_RESEARCH;
  }
}
