/**
 * Specialized Agents Types
 *
 * P1 优化：专业化 Agent 角色类型定义
 * 参考：Generative Agents (Park et al., 2023), AutoGen (Wu et al., 2023)
 */

/**
 * 专业化 Agent 类型枚举
 */
export enum SpecializedAgentType {
  // 核心研究角色
  DIMENSION_RESEARCHER = "dimension_researcher",
  QUALITY_REVIEWER = "quality_reviewer",
  REPORT_WRITER = "report_writer",

  // P1 新增专业化角色
  FACT_CHECKER = "fact_checker", // 事实核验专家
  DEVIL_ADVOCATE = "devil_advocate", // 质疑者/反方辩手
  TREND_ANALYST = "trend_analyst", // 趋势分析师
  DOMAIN_EXPERT = "domain_expert", // 领域专家
  SYNTHESIZER = "synthesizer", // 跨维度整合者
  DATA_ANALYST = "data_analyst", // 数据分析师
}

/**
 * Agent 协作模式
 */
export enum AgentCollaborationPattern {
  SEQUENTIAL = "sequential", // 顺序执行
  PARALLEL = "parallel", // 并行执行
  REVIEW = "review", // 审核模式
  DEBATE = "debate", // 辩论模式
  HANDOFF = "handoff", // 交接模式
}

/**
 * Agent 角色定义
 */
export interface AgentRoleDefinition {
  type: SpecializedAgentType;
  displayName: string;
  description: string;

  // 角色特有的系统提示词
  systemPrompt: string;

  // 推荐的技能集
  recommendedSkills: string[];

  // 推荐的工具集
  recommendedTools: string[];

  // 任务画像
  taskProfile: {
    creativity: "deterministic" | "low" | "medium" | "high";
    outputLength: "short" | "medium" | "long" | "extended";
  };

  // 该角色适用的场景
  applicableScenarios: string[];

  // 与其他角色的协作关系
  collaborationPatterns: Array<{
    withRole: SpecializedAgentType;
    pattern: AgentCollaborationPattern;
    description: string;
  }>;

  // 优先级（用于排序）
  priority: number;

  // 是否需要领域知识
  requiresDomainKnowledge: boolean;
}

/**
 * Agent 交互消息类型
 */
export enum AgentInteractionType {
  QUESTION = "question", // 提问
  CHALLENGE = "challenge", // 质疑
  SUPPORT = "support", // 支持
  CLARIFICATION = "clarification", // 澄清
  HANDOFF = "handoff", // 交接
  FEEDBACK = "feedback", // 反馈
  SYNTHESIS = "synthesis", // 综合
}

/**
 * Agent 交互消息
 */
export interface AgentInteraction {
  id: string;
  timestamp: Date;

  fromAgent: {
    type: SpecializedAgentType;
    name: string;
    id: string;
  };

  toAgent:
    | {
        type: SpecializedAgentType;
        name: string;
        id: string;
      }
    | "broadcast";

  interactionType: AgentInteractionType;
  content: string;

  // 引用的证据或先前结论
  references?: Array<{
    type: "evidence" | "claim" | "conclusion" | "previous_message";
    id: string;
    quote?: string;
  }>;

  // 响应要求
  responseRequired: boolean;
  responseDeadline?: Date;

  // 状态
  status: "pending" | "responded" | "acknowledged" | "ignored";
  response?: string;
}

/**
 * 辩论轮次
 */
export interface DebateRound {
  roundNumber: number;
  proposition: string;

  proArgument: {
    agentId: string;
    argument: string;
    evidenceUsed: string[];
    confidence: number;
  };

  conArgument: {
    agentId: string;
    argument: string;
    evidenceUsed: string[];
    confidence: number;
  };

  judgeAssessment: {
    proStrengths: string[];
    proWeaknesses: string[];
    conStrengths: string[];
    conWeaknesses: string[];
    currentLeaning: "pro" | "con" | "undecided";
    pointsToAddress: string[];
  };
}

/**
 * 辩论结果
 */
export interface DebateResult {
  proposition: string;
  rounds: DebateRound[];
  totalRounds: number;

  finalVerdict: {
    conclusion: string;
    confidence: number;
    winningPosition: "pro" | "con" | "nuanced";
    keyArguments: string[];
    remainingContention: string[];
    synthesizedView: string;
  };

  metadata: {
    startTime: Date;
    endTime: Date;
    totalTokensUsed: number;
  };
}

/**
 * 专业化分析结果
 */
export interface SpecializedAnalysisResult {
  agentType: SpecializedAgentType;
  agentName: string;

  // 分析内容
  analysis: {
    mainFindings: string[];
    supportingEvidence: string[];
    caveats: string[];
    confidence: number;
  };

  // 角色特定的输出
  roleSpecificOutput?: {
    // 事实核验专家
    factCheckResults?: Array<{
      claim: string;
      verdict: "verified" | "unverified" | "false";
      evidence: string;
    }>;

    // 质疑者
    challenges?: Array<{
      target: string;
      challenge: string;
      severity: "critical" | "major" | "minor";
    }>;

    // 趋势分析师
    trendAnalysis?: {
      identifiedTrends: Array<{
        trend: string;
        direction: "up" | "down" | "stable";
        confidence: number;
      }>;
      predictions: Array<{
        prediction: string;
        timeframe: string;
        confidence: number;
      }>;
    };

    // 领域专家
    domainInsights?: {
      terminology: Array<{ term: string; explanation: string }>;
      expertPerspective: string;
      relatedConcepts: string[];
    };
  };

  // 与其他 Agent 的交互
  interactions: AgentInteraction[];

  // 建议的后续行动
  suggestedActions: Array<{
    action: string;
    priority: "high" | "medium" | "low";
    targetRole?: SpecializedAgentType;
  }>;
}

/**
 * 多角色协作结果
 */
export interface MultiRoleCollaborationResult {
  // 参与的角色
  participatingRoles: SpecializedAgentType[];

  // 各角色的分析结果
  roleResults: Record<SpecializedAgentType, SpecializedAnalysisResult>;

  // 所有交互记录
  interactions: AgentInteraction[];

  // 辩论结果（如果有）
  debateResults?: DebateResult[];

  // 综合洞察
  synthesizedInsights: {
    keyFindings: string[];
    consensusPoints: string[];
    divergencePoints: string[];
    overallConfidence: number;
  };

  // 元数据
  metadata: {
    totalAgents: number;
    totalInteractions: number;
    executionTimeMs: number;
    tokensUsed: number;
  };
}

/**
 * 专业化 Agent 配置
 */
export interface SpecializedAgentConfig {
  // 是否启用专业化 Agent
  enabled: boolean;

  // 启用的专业化角色
  enabledRoles: SpecializedAgentType[];

  // 是否启用辩论模式
  enableDebate: boolean;

  // 辩论轮数
  debateRounds: number;

  // 是否需要所有角色达成共识
  requireConsensus: boolean;

  // 共识阈值
  consensusThreshold: number;

  // 最大交互轮数
  maxInteractionRounds: number;
}

/**
 * 默认专业化 Agent 配置
 */
export const DEFAULT_SPECIALIZED_AGENT_CONFIG: SpecializedAgentConfig = {
  enabled: true,
  enabledRoles: [
    SpecializedAgentType.DIMENSION_RESEARCHER,
    SpecializedAgentType.FACT_CHECKER,
    SpecializedAgentType.QUALITY_REVIEWER,
  ],
  enableDebate: false,
  debateRounds: 2,
  requireConsensus: false,
  consensusThreshold: 0.7,
  maxInteractionRounds: 3,
};
