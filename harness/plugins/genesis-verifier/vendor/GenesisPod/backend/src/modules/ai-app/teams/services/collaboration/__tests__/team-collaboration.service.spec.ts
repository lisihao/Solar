/**
 * TeamCollaborationService Tests
 * 测试 AI Teams 协作服务（投票、任务委派等）
 *
 * 重构于 2026-01-01: 适配数据库持久化版本
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { TeamCollaborationService } from "../team-collaboration.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { AiResponseService } from "../../ai/ai-response.service";
import { VoteStrategy, VoteValue, ProposalStatus } from "@prisma/client";

// ============================================================================
// Mock Data
// ============================================================================

const mockTopicId = "topic-123";
const mockInitiatorId = "member-initiator";
const mockVoterIds = ["member-1", "member-2", "member-3"];

const mockMembers = [
  { id: "member-initiator", displayName: "Initiator", topicId: mockTopicId },
  { id: "member-1", displayName: "Member 1", topicId: mockTopicId },
  { id: "member-2", displayName: "Member 2", topicId: mockTopicId },
  { id: "member-3", displayName: "Member 3", topicId: mockTopicId },
];

const mockFromMember = {
  id: "member-from",
  displayName: "From Member",
  topicId: mockTopicId,
};

const mockToMember = {
  id: "member-to",
  displayName: "To Member",
  topicId: mockTopicId,
  aiModel: { id: "model-1", modelId: "gemini-pro" },
};

/**
 * 创建 Mock 提案对象
 */
function createMockProposal(
  proposalId: string,
  strategy: VoteStrategy,
  votes: Array<{ voterId: string; voterName: string; value: VoteValue }> = [],
  status: ProposalStatus = ProposalStatus.OPEN,
) {
  return {
    id: proposalId,
    topicId: mockTopicId,
    title: "Test Proposal",
    description: "Test Description",
    initiatorId: mockInitiatorId,
    initiator: { id: mockInitiatorId, displayName: "Initiator" },
    strategy,
    options: [],
    status,
    createdAt: new Date(),
    closedAt: null,
    decision: null,
    summary: null,
    votes: votes.map((v, i) => ({
      id: `vote-${i}`,
      proposalId,
      voterId: v.voterId,
      voter: { id: v.voterId, displayName: v.voterName },
      value: v.value,
      reason: null,
      confidence: null,
      createdAt: new Date(),
    })),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("TeamCollaborationService", () => {
  let service: TeamCollaborationService;
  let prisma: jest.Mocked<PrismaService>;
  let aiResponseService: jest.Mocked<AiResponseService>;

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockPrismaService: any = {
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
        fn(mockPrismaService),
      ),
      topicAIMember: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      topicMessage: {
        create: jest.fn(),
      },
      voteProposal: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      voteRecord: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const mockAiResponseService = {
      generateAIResponse: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamCollaborationService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AiResponseService, useValue: mockAiResponseService },
      ],
    }).compile();

    service = module.get<TeamCollaborationService>(TeamCollaborationService);
    prisma = module.get(PrismaService);
    aiResponseService = module.get(AiResponseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // delegateTask - 任务委派
  // ==========================================================================

  describe("delegateTask", () => {
    const delegationRequest = {
      topicId: mockTopicId,
      fromMemberId: "member-from",
      toMemberId: "member-to",
      task: "Complete this task",
      context: { key: "value" },
      waitForResult: false,
    };

    it("应该成功创建委派任务（异步模式）", async () => {
      (prisma.topicAIMember.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockFromMember)
        .mockResolvedValueOnce(mockToMember);

      (prisma.topicMessage.create as jest.Mock).mockResolvedValue({
        id: "message-123",
        topicId: mockTopicId,
        content: "Delegation message",
      });

      const result = await service.delegateTask(delegationRequest);

      expect(result.success).toBe(true);
      expect(result.targetMemberName).toBe("To Member");
      expect(result.status).toBe("delegated");
      expect(result.handoffId).toBeDefined();
      expect(prisma.topicMessage.create).toHaveBeenCalled();
    });

    it("应该等待 AI 响应（同步模式）", async () => {
      (prisma.topicAIMember.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockFromMember)
        .mockResolvedValueOnce(mockToMember);

      (prisma.topicMessage.create as jest.Mock).mockResolvedValue({
        id: "message-123",
        topicId: mockTopicId,
      });

      (aiResponseService.generateAIResponse as jest.Mock).mockResolvedValue({
        id: "response-123",
        content: "Task completed",
      });

      const result = await service.delegateTask({
        ...delegationRequest,
        waitForResult: true,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("completed");
      expect(result.responseMessageId).toBe("response-123");
      expect(aiResponseService.generateAIResponse).toHaveBeenCalled();
    });

    it("发起者不存在时应该失败", async () => {
      (prisma.topicAIMember.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // fromMember not found
        .mockResolvedValueOnce(mockToMember);

      const result = await service.delegateTask(delegationRequest);

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("From member");
    });

    it("目标成员不存在时应该失败", async () => {
      (prisma.topicAIMember.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockFromMember)
        .mockResolvedValueOnce(null); // toMember not found

      const result = await service.delegateTask(delegationRequest);

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("To member");
    });

    it("AI 响应失败时应该返回失败状态", async () => {
      (prisma.topicAIMember.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockFromMember)
        .mockResolvedValueOnce(mockToMember);

      (prisma.topicMessage.create as jest.Mock).mockResolvedValue({
        id: "message-123",
      });

      (aiResponseService.generateAIResponse as jest.Mock).mockRejectedValue(
        new Error("AI service error"),
      );

      const result = await service.delegateTask({
        ...delegationRequest,
        waitForResult: true,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.error).toBe("AI service error");
    });
  });

  // ==========================================================================
  // createVoteProposal - 创建投票提案（数据库版本）
  // ==========================================================================

  describe("createVoteProposal", () => {
    const voteRequest = {
      topicId: mockTopicId,
      proposalId: "proposal-123",
      title: "Test Proposal",
      description: "This is a test proposal",
      initiatorId: mockInitiatorId,
      voterIds: mockVoterIds,
      strategy: "MAJORITY" as const,
      options: ["Option A", "Option B"],
    };

    it("应该成功创建投票提案", async () => {
      (prisma.topicAIMember.findFirst as jest.Mock).mockResolvedValue(
        mockMembers[0],
      );

      (prisma.topicAIMember.findMany as jest.Mock).mockResolvedValue(
        mockMembers.slice(1),
      );

      // Mock 数据库创建提案
      (prisma.voteProposal.create as jest.Mock).mockResolvedValue({
        id: "proposal-123",
        topicId: mockTopicId,
        title: "Test Proposal",
        status: ProposalStatus.OPEN,
      });

      (prisma.topicMessage.create as jest.Mock).mockResolvedValue({
        id: "message-123",
      });

      const result = await service.createVoteProposal(voteRequest);

      expect(result.proposalId).toBe("proposal-123");
      expect(result.status).toBe(ProposalStatus.OPEN);
      expect(prisma.voteProposal.create).toHaveBeenCalled();
      expect(prisma.topicMessage.create).toHaveBeenCalled();
    });

    it("发起者不存在时应该抛出错误", async () => {
      (prisma.topicAIMember.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.createVoteProposal(voteRequest)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("部分投票者不存在时应该抛出错误", async () => {
      (prisma.topicAIMember.findFirst as jest.Mock).mockResolvedValue(
        mockMembers[0],
      );

      // 只返回部分投票者
      (prisma.topicAIMember.findMany as jest.Mock).mockResolvedValue(
        mockMembers.slice(1, 2),
      );

      await expect(service.createVoteProposal(voteRequest)).rejects.toThrow(
        "Some voters not found",
      );
    });
  });

  // ==========================================================================
  // castMemberVote - 成员投票（数据库版本）
  // ==========================================================================

  describe("castMemberVote", () => {
    const proposalId = "proposal-123";

    it("应该成功记录投票", async () => {
      // Mock 查询提案（无投票）
      const mockProposal = createMockProposal(
        proposalId,
        VoteStrategy.MAJORITY,
        [],
      );
      (prisma.voteProposal.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockProposal) // 第一次查询：投票前
        .mockResolvedValueOnce({
          ...mockProposal,
          votes: [
            {
              id: "vote-1",
              proposalId,
              voterId: "member-1",
              voter: { id: "member-1", displayName: "Member 1" },
              value: VoteValue.APPROVE,
              reason: "I agree",
              confidence: null,
              createdAt: new Date(),
            },
          ],
        }); // 第二次查询：投票后统计

      (prisma.topicAIMember.findFirst as jest.Mock).mockResolvedValue(
        mockMembers[1],
      );
      (prisma.voteRecord.create as jest.Mock).mockResolvedValue({
        id: "vote-1",
        proposalId,
        voterId: "member-1",
        value: VoteValue.APPROVE,
      });

      const result = await service.castMemberVote(
        proposalId,
        "member-1",
        "APPROVE",
        "I agree with this proposal",
      );

      expect(result.success).toBe(true);
      expect(result.statistics).toBeDefined();
      expect(result.statistics.votesReceived).toBe(1);
      expect(result.statistics.approves).toBe(1);
      expect(prisma.voteRecord.create).toHaveBeenCalled();
    });

    it("提案不存在时应该抛出错误", async () => {
      (prisma.voteProposal.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.castMemberVote("invalid-proposal", "member-1", "APPROVE"),
      ).rejects.toThrow("Proposal not found");
    });

    it("成员不在话题中应该抛出错误", async () => {
      const mockProposal = createMockProposal(
        proposalId,
        VoteStrategy.MAJORITY,
        [],
      );
      (prisma.voteProposal.findUnique as jest.Mock).mockResolvedValue(
        mockProposal,
      );
      (prisma.topicAIMember.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.castMemberVote(proposalId, "invalid-member", "APPROVE"),
      ).rejects.toThrow("Member not found in topic");
    });

    it("重复投票应该抛出错误", async () => {
      // Mock 提案已有 member-1 的投票
      const mockProposal = createMockProposal(
        proposalId,
        VoteStrategy.MAJORITY,
        [
          {
            voterId: "member-1",
            voterName: "Member 1",
            value: VoteValue.APPROVE,
          },
        ],
      );
      (prisma.voteProposal.findUnique as jest.Mock).mockResolvedValue(
        mockProposal,
      );

      await expect(
        service.castMemberVote(proposalId, "member-1", "REJECT"),
      ).rejects.toThrow("Member has already voted");
    });

    it("投票已关闭时应该抛出错误", async () => {
      const mockProposal = createMockProposal(
        proposalId,
        VoteStrategy.MAJORITY,
        [],
        ProposalStatus.CLOSED,
      );
      (prisma.voteProposal.findUnique as jest.Mock).mockResolvedValue(
        mockProposal,
      );

      await expect(
        service.castMemberVote(proposalId, "member-1", "APPROVE"),
      ).rejects.toThrow("Voting is closed");
    });
  });

  // ==========================================================================
  // getVoteResult - 获取投票结果（数据库版本）
  // ==========================================================================

  describe("getVoteResult", () => {
    const proposalId = "proposal-456";

    it("应该返回投票结果", async () => {
      // Mock 数据库返回带投票的提案
      const mockProposal = createMockProposal(
        proposalId,
        VoteStrategy.MAJORITY,
        [
          {
            voterId: "member-1",
            voterName: "Member 1",
            value: VoteValue.APPROVE,
          },
        ],
      );
      (prisma.voteProposal.findUnique as jest.Mock).mockResolvedValue(
        mockProposal,
      );

      const result = await service.getVoteResult(proposalId);

      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
      expect(result?.proposalId).toBe(proposalId);
      expect(result?.votes).toHaveLength(1);
    });

    it("提案不存在时应该返回 null", async () => {
      (prisma.voteProposal.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getVoteResult("non-existent");

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // parseVoteFromResponse - 解析 AI 投票响应
  // ==========================================================================

  describe("parseVoteFromResponse", () => {
    it("应该从肯定性文本中解析 APPROVE", () => {
      const testCases = [
        "我赞成这个提案",
        "我同意这个决定",
        "我支持这个方案",
        "I approve this proposal",
      ];

      testCases.forEach((content) => {
        const result = (service as any).parseVoteFromResponse(content);
        expect(result.value).toBe("APPROVE");
      });
    });

    it("应该从否定性文本中解析 REJECT", () => {
      const testCases = [
        "我反对这个提案",
        "我拒绝这个决定",
        "I reject this proposal",
      ];

      testCases.forEach((content) => {
        const result = (service as any).parseVoteFromResponse(content);
        expect(result.value).toBe("REJECT");
      });
    });

    it("应该从中立文本中解析 ABSTAIN", () => {
      const testCases = ["我选择弃权", "我保持中立", "I abstain from voting"];

      testCases.forEach((content) => {
        const result = (service as any).parseVoteFromResponse(content);
        expect(result.value).toBe("ABSTAIN");
      });
    });

    it("不明确的文本应该默认为 ABSTAIN", () => {
      const result = (service as any).parseVoteFromResponse(
        "Some unclear text",
      );
      expect(result.value).toBe("ABSTAIN");
    });

    it("应该提取理由（限制长度）", () => {
      const longText = "A".repeat(300);
      const result = (service as any).parseVoteFromResponse(longText);

      expect(result.reason).toBeDefined();
      expect(result.reason!.length).toBeLessThanOrEqual(203); // 200 + "..."
    });

    it("短文本应该保留完整理由", () => {
      const shortText = "我同意，因为这个提案很好";
      const result = (service as any).parseVoteFromResponse(shortText);

      expect(result.reason).toBe(shortText);
    });
  });

  // ==========================================================================
  // calculateConsensus - 计算共识结果
  // ==========================================================================

  describe("calculateConsensus（数据库版本）", () => {
    describe("MAJORITY 策略", () => {
      const proposalId = "proposal-majority";

      it("超过50%赞成应该达成共识", async () => {
        const mockProposal = createMockProposal(
          proposalId,
          VoteStrategy.MAJORITY,
          [
            {
              voterId: "member-1",
              voterName: "Member 1",
              value: VoteValue.APPROVE,
            },
            {
              voterId: "member-2",
              voterName: "Member 2",
              value: VoteValue.APPROVE,
            },
          ],
        );
        (prisma.voteProposal.findUnique as jest.Mock).mockResolvedValue(
          mockProposal,
        );

        const result = await service.getVoteResult(proposalId, 2);

        expect(result?.consensusReached).toBe(true);
        expect(result?.decision).toBe("APPROVE");
      });

      it("50%或以下赞成应该未达成共识", async () => {
        const mockProposal = createMockProposal(
          proposalId,
          VoteStrategy.MAJORITY,
          [
            {
              voterId: "member-1",
              voterName: "Member 1",
              value: VoteValue.APPROVE,
            },
            {
              voterId: "member-2",
              voterName: "Member 2",
              value: VoteValue.REJECT,
            },
          ],
        );
        (prisma.voteProposal.findUnique as jest.Mock).mockResolvedValue(
          mockProposal,
        );

        const result = await service.getVoteResult(proposalId, 2);

        expect(result?.consensusReached).toBe(false);
        expect(result?.decision).toBe("REJECT");
      });
    });

    describe("SUPERMAJORITY 策略", () => {
      const proposalId = "proposal-super";

      it("接近67%赞成（2/3）边界情况", async () => {
        const mockProposal = createMockProposal(
          proposalId,
          VoteStrategy.SUPERMAJORITY,
          [
            {
              voterId: "member-1",
              voterName: "Member 1",
              value: VoteValue.APPROVE,
            },
            {
              voterId: "member-2",
              voterName: "Member 2",
              value: VoteValue.APPROVE,
            },
            {
              voterId: "member-3",
              voterName: "Member 3",
              value: VoteValue.REJECT,
            },
          ],
        );
        (prisma.voteProposal.findUnique as jest.Mock).mockResolvedValue(
          mockProposal,
        );

        const result = await service.getVoteResult(proposalId, 3);

        // 2/3 = 66.67% - 边界情况
        expect(result?.consensusReached).toBe(false);
        expect(result?.decision).toBe("REJECT");
      });

      it("明确超过67%赞成（3/3=100%）应该达成共识", async () => {
        const mockProposal = createMockProposal(
          proposalId,
          VoteStrategy.SUPERMAJORITY,
          [
            {
              voterId: "member-1",
              voterName: "Member 1",
              value: VoteValue.APPROVE,
            },
            {
              voterId: "member-2",
              voterName: "Member 2",
              value: VoteValue.APPROVE,
            },
            {
              voterId: "member-3",
              voterName: "Member 3",
              value: VoteValue.APPROVE,
            },
          ],
        );
        (prisma.voteProposal.findUnique as jest.Mock).mockResolvedValue(
          mockProposal,
        );

        const result = await service.getVoteResult(proposalId, 3);

        expect(result?.consensusReached).toBe(true);
        expect(result?.decision).toBe("APPROVE");
      });

      it("少于67%赞成应该未达成共识", async () => {
        const mockProposal = createMockProposal(
          proposalId,
          VoteStrategy.SUPERMAJORITY,
          [
            {
              voterId: "member-1",
              voterName: "Member 1",
              value: VoteValue.APPROVE,
            },
            {
              voterId: "member-2",
              voterName: "Member 2",
              value: VoteValue.REJECT,
            },
          ],
        );
        (prisma.voteProposal.findUnique as jest.Mock).mockResolvedValue(
          mockProposal,
        );

        const result = await service.getVoteResult(proposalId, 2);

        expect(result?.consensusReached).toBe(false);
        expect(result?.decision).toBe("REJECT");
      });
    });

    describe("UNANIMOUS 策略", () => {
      const proposalId = "proposal-unanimous";

      it("全票赞成应该达成共识", async () => {
        const mockProposal = createMockProposal(
          proposalId,
          VoteStrategy.UNANIMOUS,
          [
            {
              voterId: "member-1",
              voterName: "Member 1",
              value: VoteValue.APPROVE,
            },
            {
              voterId: "member-2",
              voterName: "Member 2",
              value: VoteValue.APPROVE,
            },
            {
              voterId: "member-3",
              voterName: "Member 3",
              value: VoteValue.APPROVE,
            },
          ],
        );
        (prisma.voteProposal.findUnique as jest.Mock).mockResolvedValue(
          mockProposal,
        );

        const result = await service.getVoteResult(proposalId, 3);

        expect(result?.consensusReached).toBe(true);
        expect(result?.decision).toBe("APPROVE");
      });

      it("任何一票反对应该未达成共识", async () => {
        const mockProposal = createMockProposal(
          proposalId,
          VoteStrategy.UNANIMOUS,
          [
            {
              voterId: "member-1",
              voterName: "Member 1",
              value: VoteValue.APPROVE,
            },
            {
              voterId: "member-2",
              voterName: "Member 2",
              value: VoteValue.APPROVE,
            },
            {
              voterId: "member-3",
              voterName: "Member 3",
              value: VoteValue.REJECT,
            },
          ],
        );
        (prisma.voteProposal.findUnique as jest.Mock).mockResolvedValue(
          mockProposal,
        );

        const result = await service.getVoteResult(proposalId, 3);

        expect(result?.consensusReached).toBe(false);
        expect(result?.decision).toBe("REJECT");
      });
    });
  });

  // ==========================================================================
  // getProposalStatus - 获取提案状态（数据库版本）
  // ==========================================================================

  describe("getProposalStatus", () => {
    it("应该返回提案存在状态", async () => {
      const proposalId = "proposal-status";

      const mockProposal = createMockProposal(
        proposalId,
        VoteStrategy.MAJORITY,
        [
          {
            voterId: "member-1",
            voterName: "Member 1",
            value: VoteValue.APPROVE,
          },
        ],
        ProposalStatus.OPEN,
      );
      (prisma.voteProposal.findUnique as jest.Mock).mockResolvedValue(
        mockProposal,
      );

      const status = await service.getProposalStatus(proposalId);

      expect(status.exists).toBe(true);
      expect(status.status).toBe(ProposalStatus.OPEN);
      expect(status.statistics).toBeDefined();
    });

    it("提案不存在时应该返回不存在状态", async () => {
      (prisma.voteProposal.findUnique as jest.Mock).mockResolvedValue(null);

      const status = await service.getProposalStatus("non-existent");

      expect(status.exists).toBe(false);
      expect(status.status).toBeUndefined();
    });
  });
});
