/**
 * Leader Agent Selection Service
 *
 * 负责 Agent 选择相关逻辑：
 * - selectAgentForTask: 为用户请求的任务选择合适的 Agent
 * - selectSkillsAndToolsForTask: 根据任务内容智能选择技能和工具
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { LeaderDecisionType } from "@prisma/client";
import { toPrismaJson } from "@/common/utils/prisma-json.utils";
import { type AgentAssignment } from "../../../types/leader.types";

@Injectable()
export class LeaderAgentSelectionService {
  private readonly logger = new Logger(LeaderAgentSelectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * ★ v7.2: 为用户请求的任务选择合适的 Agent
   *
   * 功能：
   * 1. 从当前 Mission 的已有 Agent 中选择合适的
   * 2. 如果没有合适的，动态创建新 Agent
   * 3. 返回 Agent 分配信息（包含模型）
   *
   * @param topicId 专题 ID
   * @param missionId 任务 ID
   * @param taskTitle 任务标题
   * @param taskDescription 任务描述
   * @returns Agent 分配信息
   */
  async selectAgentForTask(
    _topicId: string,
    missionId: string,
    taskTitle: string,
    taskDescription?: string,
  ): Promise<AgentAssignment> {
    this.logger.log(
      `[selectAgentForTask] Selecting agent for task: "${taskTitle}"`,
    );

    // 1. 获取当前 Mission 的任务列表，了解已有 Agent
    const mission = await this.prisma.researchMission.findUnique({
      where: { id: missionId },
      include: {
        tasks: {
          where: { assignedAgentType: "dimension_researcher" },
          select: {
            assignedAgent: true,
            assignedAgentType: true,
            modelId: true,
            status: true,
          },
        },
      },
    });

    // 2. 获取可用模型列表（过滤不可用模型，优先用于对话的模型）
    const allModelsRaw = await this.chatFacade.getAvailableModelsExtended();
    const availableModels = allModelsRaw.filter((m) => m.isAvailable !== false);
    // 过滤掉推理模型（用于研究任务的应是普通对话模型）
    const chatModels = availableModels.filter((m) => !m.isReasoning);

    // 3. 统计已有 Agent 的工作负载
    const agentWorkload = new Map<string, number>();
    const agentModels = new Map<string, string>();

    if (mission?.tasks) {
      for (const task of mission.tasks) {
        const agentId = task.assignedAgent;
        const currentLoad = agentWorkload.get(agentId) || 0;
        agentWorkload.set(agentId, currentLoad + 1);
        if (task.modelId) {
          agentModels.set(agentId, task.modelId);
        }
      }
    }

    // 4. 选择策略：优先选择工作负载最少的已有 Agent
    let selectedAgentId: string;
    let selectedModelId: string;
    let agentName: string;

    // 确保有可用模型（如果没有 chat 模型，使用所有可用模型）
    const modelsToUse = chatModels.length > 0 ? chatModels : availableModels;
    const defaultModel = modelsToUse[0]?.id || "";

    if (agentWorkload.size > 0) {
      // 找出工作负载最少的 Agent
      let minLoad = Infinity;
      let minLoadAgent = "";

      for (const [agentId, load] of agentWorkload.entries()) {
        if (load < minLoad) {
          minLoad = load;
          minLoadAgent = agentId;
        }
      }

      selectedAgentId = minLoadAgent;
      selectedModelId = agentModels.get(minLoadAgent) || defaultModel;

      // 从 agentId 提取 Agent 编号用于命名
      // 格式如: researcher_1, researcher_market_trends 等
      const idMatch = selectedAgentId.match(/(\d+)$/);
      const agentNum = idMatch ? idMatch[1] : String(agentWorkload.size);
      agentName = `研究员 ${agentNum}`;

      this.logger.log(
        `[selectAgentForTask] Selected existing agent: ${selectedAgentId} (load: ${minLoad}) with model: ${selectedModelId}`,
      );
    } else {
      // 没有已有 Agent，创建新的
      const timestamp = Date.now();
      selectedAgentId = `researcher_user_${timestamp}`;

      // 随机选择模型实现多元化（确保有模型可选）
      if (modelsToUse.length > 0) {
        const modelIndex = Math.floor(Math.random() * modelsToUse.length);
        selectedModelId = modelsToUse[modelIndex].id;
      } else {
        selectedModelId = "";
      }
      agentName = "新研究员";

      this.logger.log(
        `[selectAgentForTask] Created new agent: ${selectedAgentId} with model: ${selectedModelId}`,
      );
    }

    // 5. 根据任务内容智能选择技能和工具
    const { skills, tools } = this.selectSkillsAndToolsForTask(
      taskTitle,
      taskDescription,
    );

    this.logger.log(
      `[selectAgentForTask] Selected skills: [${skills.join(", ")}], tools: [${tools.join(", ")}]`,
    );

    // 6. 记录 Leader 决策（使用 ADJUST 类型表示动态调整任务分配）
    await this.recordDecision(
      missionId,
      LeaderDecisionType.ADJUST,
      { taskTitle, taskDescription },
      {
        agentId: selectedAgentId,
        agentName,
        modelId: selectedModelId,
        skills,
        tools,
      },
      `Leader 为任务「${taskTitle}」选择了 ${agentName}（${selectedModelId}），技能：[${skills.join(", ")}]，工具：[${tools.join(", ")}]`,
    );

    return {
      agentId: selectedAgentId,
      agentName,
      agentType: "dimension_researcher",
      role: "用户请求研究员",
      modelId: selectedModelId,
      skills,
      tools,
    };
  }

  /**
   * 根据任务标题和描述智能选择技能和工具
   * 用于 Leader 对话创建的任务
   */
  private selectSkillsAndToolsForTask(
    taskTitle: string,
    taskDescription?: string,
  ): { skills: string[]; tools: string[] } {
    const content = `${taskTitle || ""} ${taskDescription || ""}`.toLowerCase();

    // 政策法规类关键词
    const policyKeywords = [
      "政策",
      "法规",
      "监管",
      "立法",
      "法案",
      "法律",
      "policy",
      "regulation",
      "regulatory",
      "legislation",
      "law",
      "compliance",
      "执法",
      "合规",
      "框架",
      "framework",
      "白宫",
      "国会",
      "联邦",
      "行政命令",
    ];

    // 市场分析类关键词
    const marketKeywords = [
      "市场",
      "竞争",
      "格局",
      "份额",
      "趋势",
      "投资",
      "融资",
      "资本",
      "商业",
      "market",
      "competition",
      "trend",
      "investment",
      "business",
      "产业",
      "行业",
      "企业",
      "公司",
    ];

    // 技术研究类关键词
    const techKeywords = [
      "技术",
      "研发",
      "创新",
      "算法",
      "架构",
      "系统",
      "technology",
      "research",
      "innovation",
      "algorithm",
      "infrastructure",
      "基础设施",
      "底层",
      "核心",
    ];

    // 数据分析类关键词
    const dataKeywords = [
      "数据",
      "统计",
      "分析",
      "指标",
      "报告",
      "data",
      "statistics",
      "metrics",
      "analysis",
      "report",
      "增长",
      "下降",
      "百分比",
    ];

    // 战略/综合类关键词
    const strategyKeywords = [
      "战略",
      "布局",
      "发展",
      "规划",
      "展望",
      "预测",
      "未来",
      "strategy",
      "development",
      "outlook",
      "forecast",
      "思想",
      "哲学",
      "根源",
      "动向",
    ];

    let skills: string[] = [];
    let tools: string[] = [];

    // 判断任务类型并选择技能和工具
    const isPolicyRelated = policyKeywords.some((kw) => content.includes(kw));
    const isMarketRelated = marketKeywords.some((kw) => content.includes(kw));
    const isTechRelated = techKeywords.some((kw) => content.includes(kw));
    const isDataRelated = dataKeywords.some((kw) => content.includes(kw));
    const isStrategyRelated = strategyKeywords.some((kw) =>
      content.includes(kw),
    );

    // 政策法规类
    if (isPolicyRelated) {
      skills.push(
        "fact-verification",
        "critical-thinking",
        "dimension-research",
      );
      tools.push("federal-register", "congress-gov", "whitehouse-news");
    }

    // 市场分析类
    if (isMarketRelated) {
      skills.push(
        "trend-analysis",
        "competitive-analysis",
        "data-interpretation",
      );
      tools.push("web-search", "data-analysis");
    }

    // 技术研究类
    if (isTechRelated) {
      skills.push("deep-dive", "comparison", "synthesis");
      tools.push("academic-search", "web-search");
    }

    // 数据分析类
    if (isDataRelated) {
      skills.push("data-interpretation", "trend-analysis");
      tools.push("data-analysis", "web-search");
    }

    // 战略/综合类
    if (isStrategyRelated) {
      skills.push(
        "future-projection",
        "cause-effect",
        "synthesis",
        "swot-analysis",
      );
      tools.push("web-search", "news");
    }

    // 评估/审核类关键词
    const evaluationKeywords = [
      "评估",
      "审查",
      "评价",
      "利弊",
      "优劣",
      "风险",
      "挑战",
      "问题",
      "evaluate",
      "assess",
      "review",
      "risk",
      "challenge",
      "opportunity",
      "swot",
      "优势",
      "劣势",
      "机遇",
      "威胁",
    ];
    const isEvaluationRelated = evaluationKeywords.some((kw) =>
      content.includes(kw),
    );
    if (isEvaluationRelated) {
      skills.push("critical-thinking", "swot-analysis");
    }

    // 去重
    skills = [...new Set(skills)];
    tools = [...new Set(tools)];

    // 如果没有匹配到任何关键词，使用默认值
    if (skills.length === 0) {
      skills = ["deep-dive", "synthesis", "data-interpretation"];
    }
    if (tools.length === 0) {
      tools = ["web-search"];
    }

    // 限制数量：skills 2-5 个，tools 1-3 个
    if (skills.length > 5) {
      skills = skills.slice(0, 5);
    }
    if (tools.length > 3) {
      tools = tools.slice(0, 3);
    }

    return { skills, tools };
  }

  /**
   * 记录 Leader 决策
   */
  private async recordDecision(
    missionId: string,
    type: LeaderDecisionType,
    input: Record<string, unknown>,
    decision: Record<string, unknown>,
    reasoning: string,
    modelUsed?: string,
    latencyMs?: number,
  ): Promise<void> {
    try {
      await this.prisma.leaderDecision.create({
        data: {
          missionId,
          type,
          input: toPrismaJson(input),
          decision: toPrismaJson(decision),
          reasoning,
          modelUsed,
          latencyMs,
        },
      });
    } catch (error) {
      this.logger.error(`[recordDecision] Failed to record decision: ${error}`);
    }
  }
}
