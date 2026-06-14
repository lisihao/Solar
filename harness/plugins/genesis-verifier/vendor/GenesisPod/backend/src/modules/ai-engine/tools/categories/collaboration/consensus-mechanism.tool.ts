/**
 * Consensus Mechanism Tool
 * 共识机制工具 - 收集多个 Agent 的意见并达成共识
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";
// AgentId and AgentResult available from "@/modules/ai-harness/agents/abstractions/agent.types" if needed

// ============================================================================
// Types
// ============================================================================

export type ConsensusStrategy =
  | "MAJORITY" // 多数决（>50%）
  | "SUPERMAJORITY" // 超级多数（>66%）
  | "UNANIMOUS" // 全票通过
  | "WEIGHTED" // 加权投票
  | "RANKED" // 排名选择
  | "APPROVAL"; // 赞成投票

export type VoteValue = "APPROVE" | "REJECT" | "ABSTAIN";

export interface Voter {
  /**
   * 投票者 ID（Agent ID）
   */
  voterId: string;

  /**
   * 投票者名称
   */
  name?: string;

  /**
   * 权重（加权投票时使用）
   */
  weight?: number;
}

export interface Vote {
  /**
   * 投票者 ID
   */
  voterId: string;

  /**
   * 投票值
   */
  value: VoteValue;

  /**
   * 排名（RANKED 策略时使用）
   */
  ranking?: number[];

  /**
   * 投票理由
   */
  reason?: string;

  /**
   * 投票时间
   */
  timestamp: string;
}

export interface ConsensusProposal {
  /**
   * 提案 ID
   */
  proposalId: string;

  /**
   * 提案标题
   */
  title: string;

  /**
   * 提案描述
   */
  description: string;

  /**
   * 选项（RANKED/APPROVAL 策略时使用）
   */
  options?: string[];

  /**
   * 投票者列表
   */
  voters: Voter[];

  /**
   * 共识策略
   */
  strategy: ConsensusStrategy;

  /**
   * 投票截止时间
   */
  deadline?: string;

  /**
   * 最小参与率（百分比）
   */
  quorum?: number;
}

export interface ConsensusMechanismInput {
  /**
   * 操作类型
   */
  operation:
    | "CREATE_PROPOSAL"
    | "CAST_VOTE"
    | "GET_STATUS"
    | "CLOSE_VOTING"
    | "GET_RESULT";

  /**
   * 提案数据
   */
  proposal?: ConsensusProposal;

  /**
   * 提案 ID
   */
  proposalId?: string;

  /**
   * 投票数据
   */
  vote?: {
    voterId: string;
    value: VoteValue;
    ranking?: number[];
    reason?: string;
  };
}

export interface ConsensusMechanismOutput {
  /**
   * 操作是否成功
   */
  success: boolean;

  /**
   * 操作类型
   */
  operation: string;

  /**
   * 提案 ID
   */
  proposalId?: string;

  /**
   * 投票状态
   */
  status?: "OPEN" | "CLOSED" | "REACHED" | "NOT_REACHED";

  /**
   * 投票统计
   */
  statistics?: {
    totalVoters: number;
    votesReceived: number;
    participationRate: number;
    approves: number;
    rejects: number;
    abstains: number;
  };

  /**
   * 共识结果
   */
  result?: {
    consensusReached: boolean;
    decision: VoteValue | string;
    winningOption?: string;
    margin?: number;
    votes: Vote[];
  };

  /**
   * 错误信息
   */
  error?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class ConsensusMechanismTool extends BaseTool<
  ConsensusMechanismInput,
  ConsensusMechanismOutput
> {
  private readonly logger = new Logger(ConsensusMechanismTool.name);

  // 模拟提案存储
  private proposalStore: Map<
    string,
    ConsensusProposal & {
      votes: Vote[];
      status: "OPEN" | "CLOSED";
      createdAt: string;
    }
  > = new Map();

  readonly id = "consensus-mechanism";
  readonly sideEffect = "none" as const;
  readonly category: ToolCategory = "collaboration";
  readonly tags = ["collaboration", "consensus", "voting", "agreement"];
  readonly name = "共识机制";
  readonly description =
    "在多个 Agent 之间建立共识，支持多种投票策略（多数决、全票通过、加权投票等）。适用于需要多方决策的场景。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description: "操作类型",
        enum: [
          "CREATE_PROPOSAL",
          "CAST_VOTE",
          "GET_STATUS",
          "CLOSE_VOTING",
          "GET_RESULT",
        ],
      },
      proposal: {
        type: "object",
        description: "提案数据",
        properties: {
          proposalId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          voters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                voterId: { type: "string" },
                name: { type: "string" },
                weight: { type: "number" },
              },
            },
          },
          strategy: {
            type: "string",
            enum: [
              "MAJORITY",
              "SUPERMAJORITY",
              "UNANIMOUS",
              "WEIGHTED",
              "RANKED",
              "APPROVAL",
            ],
          },
          deadline: { type: "string", format: "date-time" },
          quorum: { type: "number", minimum: 0, maximum: 100 },
        },
      },
      proposalId: { type: "string", description: "提案 ID" },
      vote: {
        type: "object",
        description: "投票数据",
        properties: {
          voterId: { type: "string" },
          value: { type: "string", enum: ["APPROVE", "REJECT", "ABSTAIN"] },
          ranking: { type: "array", items: { type: "number" } },
          reason: { type: "string" },
        },
      },
    },
    required: ["operation"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: { type: "boolean" },
      operation: { type: "string" },
      proposalId: { type: "string" },
      status: { type: "string" },
      statistics: { type: "object" },
      result: { type: "object" },
      error: { type: "string" },
    },
  };

  constructor() {
    super();
    // defaultTimeout set in class property
  }

  validateInput(input: ConsensusMechanismInput) {
    if (!input.operation) return false;

    const { operation, proposal, proposalId, vote } = input;

    switch (operation) {
      case "CREATE_PROPOSAL":
        if (
          !proposal?.title ||
          !proposal?.voters ||
          proposal.voters.length === 0 ||
          !proposal?.strategy
        ) {
          return false;
        }
        break;
      case "CAST_VOTE":
        if (!proposalId || !vote?.voterId || !vote?.value) return false;
        break;
      case "GET_STATUS":
      case "CLOSE_VOTING":
      case "GET_RESULT":
        if (!proposalId) return false;
        break;
    }

    return true;
  }

  protected async doExecute(
    input: ConsensusMechanismInput,
    _context: ToolContext,
  ): Promise<ConsensusMechanismOutput> {
    const { operation, proposal, proposalId, vote } = input;

    this.logger.log(`[doExecute] Consensus operation: ${operation}`);

    try {
      switch (operation) {
        case "CREATE_PROPOSAL":
          return this.createProposal(proposal!);

        case "CAST_VOTE":
          return this.castVote(proposalId!, vote!);

        case "GET_STATUS":
          return this.getStatus(proposalId!);

        case "CLOSE_VOTING":
          return this.closeVoting(proposalId!);

        case "GET_RESULT":
          return this.getResult(proposalId!);

        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[doExecute] Consensus operation failed: ${errorMessage}`,
      );

      return {
        success: false,
        operation,
        error: errorMessage,
      };
    }
  }

  private createProposal(
    proposal: ConsensusProposal,
  ): ConsensusMechanismOutput {
    const proposalId =
      proposal.proposalId ||
      `prop_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    this.proposalStore.set(proposalId, {
      ...proposal,
      proposalId,
      votes: [],
      status: "OPEN",
      createdAt: new Date().toISOString(),
    });

    this.logger.log(`[createProposal] Proposal ${proposalId} created`);

    return {
      success: true,
      operation: "CREATE_PROPOSAL",
      proposalId,
      status: "OPEN",
      statistics: {
        totalVoters: proposal.voters.length,
        votesReceived: 0,
        participationRate: 0,
        approves: 0,
        rejects: 0,
        abstains: 0,
      },
    };
  }

  private castVote(
    proposalId: string,
    vote: NonNullable<ConsensusMechanismInput["vote"]>,
  ): ConsensusMechanismOutput {
    const proposal = this.proposalStore.get(proposalId);

    if (!proposal) {
      return {
        success: false,
        operation: "CAST_VOTE",
        proposalId,
        error: `Proposal not found (proposalId="${proposalId}", available: [${Array.from(this.proposalStore.keys()).join(", ") || "<none>"}])`,
      };
    }

    if (proposal.status === "CLOSED") {
      return {
        success: false,
        operation: "CAST_VOTE",
        proposalId,
        error: `Voting is closed (proposalId="${proposalId}", closedAt previous CLOSE_VOTING action)`,
      };
    }

    // 检查投票者是否在列表中
    const isValidVoter = proposal.voters.some(
      (v) => v.voterId === vote.voterId,
    );
    if (!isValidVoter) {
      return {
        success: false,
        operation: "CAST_VOTE",
        proposalId,
        error: `Voter not in voter list (voterId="${vote.voterId}", allowed voters: [${proposal.voters.map((v) => v.voterId).join(", ") || "<none>"}])`,
      };
    }

    // 检查是否已投票
    const existingVote = proposal.votes.find((v) => v.voterId === vote.voterId);
    if (existingVote) {
      return {
        success: false,
        operation: "CAST_VOTE",
        proposalId,
        error: `Voter has already voted (voterId="${vote.voterId}", previousVote=${JSON.stringify(existingVote.value)} at ${existingVote.timestamp})`,
      };
    }

    // 记录投票
    proposal.votes.push({
      ...vote,
      timestamp: new Date().toISOString(),
    });

    const stats = this.calculateStatistics(proposal);

    return {
      success: true,
      operation: "CAST_VOTE",
      proposalId,
      status: "OPEN",
      statistics: stats,
    };
  }

  private getStatus(proposalId: string): ConsensusMechanismOutput {
    const proposal = this.proposalStore.get(proposalId);

    if (!proposal) {
      return {
        success: false,
        operation: "GET_STATUS",
        proposalId,
        error: `Proposal not found (proposalId="${proposalId}", available: [${Array.from(this.proposalStore.keys()).join(", ") || "<none>"}])`,
      };
    }

    return {
      success: true,
      operation: "GET_STATUS",
      proposalId,
      status: proposal.status,
      statistics: this.calculateStatistics(proposal),
    };
  }

  private closeVoting(proposalId: string): ConsensusMechanismOutput {
    const proposal = this.proposalStore.get(proposalId);

    if (!proposal) {
      return {
        success: false,
        operation: "CLOSE_VOTING",
        proposalId,
        error: `Proposal not found (proposalId="${proposalId}", available: [${Array.from(this.proposalStore.keys()).join(", ") || "<none>"}])`,
      };
    }

    proposal.status = "CLOSED";

    return this.getResult(proposalId);
  }

  private getResult(proposalId: string): ConsensusMechanismOutput {
    const proposal = this.proposalStore.get(proposalId);

    if (!proposal) {
      return {
        success: false,
        operation: "GET_RESULT",
        proposalId,
        error: `Proposal not found (proposalId="${proposalId}", available: [${Array.from(this.proposalStore.keys()).join(", ") || "<none>"}])`,
      };
    }

    const stats = this.calculateStatistics(proposal);
    const result = this.calculateConsensus(proposal, stats);

    return {
      success: true,
      operation: "GET_RESULT",
      proposalId,
      status: result.consensusReached ? "REACHED" : "NOT_REACHED",
      statistics: stats,
      result,
    };
  }

  private calculateStatistics(
    proposal: ConsensusProposal & { votes: Vote[] },
  ): NonNullable<ConsensusMechanismOutput["statistics"]> {
    const totalVoters = proposal.voters.length;
    const votesReceived = proposal.votes.length;

    const approves = proposal.votes.filter((v) => v.value === "APPROVE").length;
    const rejects = proposal.votes.filter((v) => v.value === "REJECT").length;
    const abstains = proposal.votes.filter((v) => v.value === "ABSTAIN").length;

    return {
      totalVoters,
      votesReceived,
      participationRate:
        totalVoters > 0 ? (votesReceived / totalVoters) * 100 : 0,
      approves,
      rejects,
      abstains,
    };
  }

  private calculateConsensus(
    proposal: ConsensusProposal & { votes: Vote[] },
    stats: NonNullable<ConsensusMechanismOutput["statistics"]>,
  ): NonNullable<ConsensusMechanismOutput["result"]> {
    const { strategy, quorum, voters } = proposal;
    const { approves, rejects, votesReceived, totalVoters, participationRate } =
      stats;

    // 检查法定人数
    if (quorum && participationRate < quorum) {
      return {
        consensusReached: false,
        decision: "QUORUM_NOT_MET",
        votes: proposal.votes,
      };
    }

    let consensusReached = false;
    let decision: VoteValue | string = "REJECT";
    let margin = 0;

    switch (strategy) {
      case "MAJORITY":
        // 简单多数（>50%）
        consensusReached = approves > votesReceived / 2;
        decision = consensusReached ? "APPROVE" : "REJECT";
        margin = approves - rejects;
        break;

      case "SUPERMAJORITY":
        // 超级多数（>66%）
        consensusReached = approves >= votesReceived * 0.667;
        decision = consensusReached ? "APPROVE" : "REJECT";
        margin = approves - Math.ceil(votesReceived * 0.667);
        break;

      case "UNANIMOUS":
        // 全票通过
        consensusReached = approves === totalVoters;
        decision = consensusReached ? "APPROVE" : "REJECT";
        margin = totalVoters - approves;
        break;

      case "WEIGHTED":
        // 加权投票
        let weightedApproves = 0;
        let totalWeight = 0;

        for (const vote of proposal.votes) {
          const voter = voters.find((v) => v.voterId === vote.voterId);
          const weight = voter?.weight || 1;
          totalWeight += weight;
          if (vote.value === "APPROVE") {
            weightedApproves += weight;
          }
        }

        consensusReached = weightedApproves > totalWeight / 2;
        decision = consensusReached ? "APPROVE" : "REJECT";
        margin = weightedApproves - totalWeight / 2;
        break;

      default:
        consensusReached = approves > rejects;
        decision = consensusReached ? "APPROVE" : "REJECT";
        margin = approves - rejects;
    }

    return {
      consensusReached,
      decision,
      margin,
      votes: proposal.votes,
    };
  }
}
