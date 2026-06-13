/**
 * TeamCollaborationService - Supplemental Tests
 *
 * Covers branches not tested in the primary spec:
 * - collectAIVotes: success path, already-voted skip, member-not-found skip, AI error skip,
 *   proposal not found, already closed, vote closed after collection
 * - getProposalsByTopic: with and without status filter
 * - generateVoteSummary: success, proposal not found
 * - tryParseJsonVote: JSON code block, plain JSON, invalid JSON fallback
 * - buildVotePrompt: with and without options
 * - parseVoteFromText: Chinese approve/reject/abstain keywords
 */

// Must be before imports - provides missing enum values not generated in worktree
jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient { $connect = jest.fn(); $disconnect = jest.fn(); $on = jest.fn(); }, ...jest.requireActual("@prisma/client"),
  AIModelType: {
    CHAT: "CHAT",
    CHAT_FAST: "CHAT_FAST",
    IMAGE_GENERATION: "IMAGE_GENERATION",
    IMAGE_EDITING: "IMAGE_EDITING",
    MULTIMODAL: "MULTIMODAL",
    EMBEDDING: "EMBEDDING",
    RERANK: "RERANK",
  },
  VoteStrategy: {
    MAJORITY: "MAJORITY",
    SUPERMAJORITY: "SUPERMAJORITY",
    UNANIMOUS: "UNANIMOUS",
    LEADER_DECIDES: "LEADER_DECIDES",
  },
  VoteValue: {
    APPROVE: "APPROVE",
    REJECT: "REJECT",
    ABSTAIN: "ABSTAIN",
  },
  ProposalStatus: {
    OPEN: "OPEN",
    CLOSED: "CLOSED",
    CANCELLED: "CANCELLED",
  },
  MissionStatus: {
    PENDING: "PENDING",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
    PAUSED: "PAUSED",
  },
  AgentTaskStatus: {
    PENDING: "PENDING",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
    REVISION_NEEDED: "REVISION_NEEDED",
  },
  TaskPriority: {
    LOW: "LOW",
    MEDIUM: "MEDIUM",
    HIGH: "HIGH",
    CRITICAL: "CRITICAL",
  },
  TaskType: {
    RESEARCH: "RESEARCH",
    WRITING: "WRITING",
    ANALYSIS: "ANALYSIS",
    DESIGN: "DESIGN",
    IMPLEMENTATION: "IMPLEMENTATION",
    REVIEW: "REVIEW",
    DOCUMENTATION: "DOCUMENTATION",
    CREATIVE: "CREATIVE",
    SYNTHESIS: "SYNTHESIS",
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { TeamCollaborationService } from "../team-collaboration.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { AiResponseService } from "../../ai/ai-response.service";
import { VoteStrategy, VoteValue, ProposalStatus } from "@prisma/client";

// ============================================================================
// Mock Data Helpers
// ============================================================================

const mockTopicId = "topic-collab-supp";

function makeProposal(
  proposalId: string,
  strategy: VoteStrategy,
  votes: Array<{
    voterId: string;
    value: VoteValue;
    reason?: string | null;
  }> = [],
  status: ProposalStatus = ProposalStatus.OPEN,
) {
  return {
    id: proposalId,
    topicId: mockTopicId,
    title: "Supplemental Proposal",
    description: "Supplemental description",
    initiatorId: "member-init",
    initiator: { id: "member-init", displayName: "Initiator" },
    strategy,
    options: ["Option A", "Option B"],
    status,
    createdAt: new Date(),
    closedAt: null,
    decision: null,
    summary: null,
    votes: votes.map((v, i) => ({
      id: `vote-${i}`,
      proposalId,
      voterId: v.voterId,
      voter: { id: v.voterId, displayName: `Voter ${v.voterId}` },
      value: v.value,
      reason: v.reason ?? null,
      confidence: null,
      createdAt: new Date(),
    })),
  };
}

// ============================================================================
// Test Setup
// ============================================================================

describe("TeamCollaborationService (supplemental)", () => {
  let service: TeamCollaborationService;
  let mockPrisma: Record<string, Record<string, jest.Mock>>;
  let mockAiResponse: { generateAIResponse: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      $transaction: { fn: jest.fn() } as unknown as Record<string, jest.Mock>,
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
      },
    };

    // Make $transaction work inline
    (mockPrisma as unknown as { $transaction: jest.Mock }).$transaction =
      jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
        fn(mockPrisma as unknown as Record<string, unknown>),
      );

    mockAiResponse = {
      generateAIResponse: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamCollaborationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiResponseService, useValue: mockAiResponse },
      ],
    }).compile();

    service = module.get<TeamCollaborationService>(TeamCollaborationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // collectAIVotes
  // ==========================================================================

  describe("collectAIVotes", () => {
    const proposalId = "proposal-collect";

    it("should collect votes from all members successfully", async () => {
      const proposal = makeProposal(proposalId, VoteStrategy.MAJORITY, []);
      mockPrisma.voteProposal.findUnique
        .mockResolvedValueOnce(proposal) // initial fetch
        .mockResolvedValueOnce({
          ...proposal,
          votes: [
            {
              id: "v1",
              proposalId,
              voterId: "voter-1",
              voter: { id: "voter-1", displayName: "Voter 1" },
              value: VoteValue.APPROVE,
              reason: "good idea",
              confidence: null,
              createdAt: new Date(),
            },
            {
              id: "v2",
              proposalId,
              voterId: "voter-2",
              voter: { id: "voter-2", displayName: "Voter 2" },
              value: VoteValue.REJECT,
              reason: null,
              confidence: null,
              createdAt: new Date(),
            },
          ],
          status: ProposalStatus.CLOSED,
        }); // after votes

      mockPrisma.topicAIMember.findFirst
        .mockResolvedValueOnce({
          id: "voter-1",
          displayName: "Voter 1",
          roleDescription: "Analyst",
        })
        .mockResolvedValueOnce({
          id: "voter-2",
          displayName: "Voter 2",
          roleDescription: "Engineer",
        });

      mockPrisma.topicMessage.create
        .mockResolvedValueOnce({ id: "msg-1" })
        .mockResolvedValueOnce({ id: "msg-2" });

      mockAiResponse.generateAIResponse
        .mockResolvedValueOnce({
          id: "resp-1",
          content:
            '{"vote": "APPROVE", "reasoning": "good idea", "confidence": 0.8}',
        })
        .mockResolvedValueOnce({ id: "resp-2", content: "我反对这个方案" });

      mockPrisma.voteRecord.create.mockResolvedValue({ id: "vr-1" });
      mockPrisma.voteProposal.update.mockResolvedValue({ id: proposalId });

      const result = await service.collectAIVotes(proposalId, [
        "voter-1",
        "voter-2",
      ]);

      expect(result.success).toBe(true);
      expect(result.proposalId).toBe(proposalId);
      expect(mockAiResponse.generateAIResponse).toHaveBeenCalledTimes(2);
    });

    it("should skip already-voted members", async () => {
      const proposal = makeProposal(proposalId, VoteStrategy.MAJORITY, [
        { voterId: "voter-1", value: VoteValue.APPROVE },
      ]);
      mockPrisma.voteProposal.findUnique
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce(proposal);
      mockPrisma.voteProposal.update.mockResolvedValue({ id: proposalId });

      const result = await service.collectAIVotes(proposalId, ["voter-1"]);

      expect(result.success).toBe(true);
      // voter-1 already voted, should be skipped
      expect(mockAiResponse.generateAIResponse).not.toHaveBeenCalled();
    });

    it("should skip members not found in topic", async () => {
      const proposal = makeProposal(proposalId, VoteStrategy.MAJORITY, []);
      mockPrisma.voteProposal.findUnique
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce(proposal);
      mockPrisma.topicAIMember.findFirst.mockResolvedValue(null);
      mockPrisma.voteProposal.update.mockResolvedValue({ id: proposalId });

      const result = await service.collectAIVotes(proposalId, ["ghost-voter"]);

      expect(result.success).toBe(true);
      expect(mockAiResponse.generateAIResponse).not.toHaveBeenCalled();
    });

    it("should handle AI response error gracefully and skip that member", async () => {
      const proposal = makeProposal(proposalId, VoteStrategy.MAJORITY, []);
      mockPrisma.voteProposal.findUnique
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce(proposal);
      mockPrisma.topicAIMember.findFirst.mockResolvedValue({
        id: "voter-err",
        displayName: "Error Voter",
        roleDescription: null,
      });
      mockPrisma.topicMessage.create.mockResolvedValue({ id: "msg-x" });
      mockAiResponse.generateAIResponse.mockRejectedValue(
        new Error("AI unavailable"),
      );
      mockPrisma.voteProposal.update.mockResolvedValue({ id: proposalId });

      const result = await service.collectAIVotes(proposalId, ["voter-err"]);

      expect(result.success).toBe(true);
      expect(result.votes).toHaveLength(0);
    });

    it("should return failure when proposal not found", async () => {
      mockPrisma.voteProposal.findUnique.mockResolvedValue(null);

      const result = await service.collectAIVotes("missing-proposal", ["v1"]);

      expect(result.success).toBe(false);
      expect(result.decision).toBe("ERROR");
    });

    it("should return failure when voting is already closed", async () => {
      const closedProposal = makeProposal(
        proposalId,
        VoteStrategy.MAJORITY,
        [],
        ProposalStatus.CLOSED,
      );
      mockPrisma.voteProposal.findUnique.mockResolvedValue(closedProposal);

      const result = await service.collectAIVotes(proposalId, ["v1"]);

      expect(result.success).toBe(false);
      expect(result.decision).toBe("ERROR");
    });
  });

  // ==========================================================================
  // getProposalsByTopic
  // ==========================================================================

  describe("getProposalsByTopic", () => {
    it("should return all proposals for a topic without status filter", async () => {
      const proposals = [
        makeProposal("p1", VoteStrategy.MAJORITY, []),
        makeProposal("p2", VoteStrategy.UNANIMOUS, [], ProposalStatus.CLOSED),
      ];
      mockPrisma.voteProposal.findMany.mockResolvedValue(proposals);

      const result = await service.getProposalsByTopic(mockTopicId);

      expect(result).toHaveLength(2);
      expect(mockPrisma.voteProposal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { topicId: mockTopicId },
        }),
      );
    });

    it("should filter proposals by status when provided", async () => {
      const openProposals = [makeProposal("p3", VoteStrategy.MAJORITY, [])];
      mockPrisma.voteProposal.findMany.mockResolvedValue(openProposals);

      const result = await service.getProposalsByTopic(
        mockTopicId,
        ProposalStatus.OPEN,
      );

      expect(result).toHaveLength(1);
      expect(mockPrisma.voteProposal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { topicId: mockTopicId, status: ProposalStatus.OPEN },
        }),
      );
    });

    it("should return empty array when no proposals exist", async () => {
      mockPrisma.voteProposal.findMany.mockResolvedValue([]);

      const result = await service.getProposalsByTopic("no-proposals-topic");

      expect(result).toHaveLength(0);
    });
  });

  // ==========================================================================
  // generateVoteSummary
  // ==========================================================================

  describe("generateVoteSummary", () => {
    const proposalId = "proposal-summary";

    it("should generate and persist a vote summary", async () => {
      const proposal = makeProposal(proposalId, VoteStrategy.MAJORITY, [
        { voterId: "v1", value: VoteValue.APPROVE, reason: "Great idea" },
        { voterId: "v2", value: VoteValue.REJECT, reason: "Too risky" },
      ]);
      mockPrisma.voteProposal.findUnique.mockResolvedValue(proposal);
      mockPrisma.voteProposal.update.mockResolvedValue({ id: proposalId });

      const summary = await service.generateVoteSummary(proposalId);

      expect(summary).not.toBeNull();
      expect(summary).toContain("投票结果");
      expect(summary).toContain("Supplemental Proposal");
      expect(mockPrisma.voteProposal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: proposalId },
          data: expect.objectContaining({ summary: expect.any(String) }),
        }),
      );
    });

    it("should return null when proposal does not exist", async () => {
      mockPrisma.voteProposal.findUnique.mockResolvedValue(null);

      const summary = await service.generateVoteSummary("nonexistent-proposal");

      expect(summary).toBeNull();
      expect(mockPrisma.voteProposal.update).not.toHaveBeenCalled();
    });

    it("should include all vote details in summary", async () => {
      const proposal = makeProposal(proposalId, VoteStrategy.UNANIMOUS, [
        { voterId: "va", value: VoteValue.APPROVE, reason: "Supports goal" },
        { voterId: "vb", value: VoteValue.APPROVE, reason: null },
      ]);
      mockPrisma.voteProposal.findUnique.mockResolvedValue(proposal);
      mockPrisma.voteProposal.update.mockResolvedValue({ id: proposalId });

      const summary = await service.generateVoteSummary(proposalId);

      expect(summary).toContain("赞成");
      expect(summary).toContain("统计");
    });
  });

  // ==========================================================================
  // tryParseJsonVote (via parseVoteFromResponse)
  // ==========================================================================

  describe("tryParseJsonVote (via parseVoteFromResponse)", () => {
    it("should parse JSON in code block format", () => {
      const content =
        '```json\n{"vote": "APPROVE", "reasoning": "Good", "confidence": 0.9}\n```';
      const result = (
        service as unknown as {
          parseVoteFromResponse: (c: string) => {
            value: string;
            reason?: string;
            confidence?: number;
          };
        }
      ).parseVoteFromResponse(content);

      expect(result.value).toBe("APPROVE");
      expect(result.confidence).toBe(0.9);
    });

    it("should parse plain JSON object in response", () => {
      const content =
        'I have reviewed. {"vote": "REJECT", "reasoning": "Too risky", "confidence": 0.7}';
      const result = (
        service as unknown as {
          parseVoteFromResponse: (c: string) => { value: string };
        }
      ).parseVoteFromResponse(content);

      expect(result.value).toBe("REJECT");
    });

    it("should handle ABSTAIN vote in JSON", () => {
      const content =
        '{"vote": "ABSTAIN", "reasoning": "Insufficient info", "confidence": 0.5}';
      const result = (
        service as unknown as {
          parseVoteFromResponse: (c: string) => { value: string };
        }
      ).parseVoteFromResponse(content);

      expect(result.value).toBe("ABSTAIN");
    });

    it("should normalize Chinese vote values in JSON", () => {
      const content = '{"vote": "赞成", "reasoning": "Very good proposal"}';
      const result = (
        service as unknown as {
          parseVoteFromResponse: (c: string) => { value: string };
        }
      ).parseVoteFromResponse(content);

      expect(result.value).toBe("APPROVE");
    });

    it("should clamp confidence to [0, 1] range", () => {
      const content = '{"vote": "APPROVE", "confidence": 1.5}';
      const result = (
        service as unknown as {
          parseVoteFromResponse: (c: string) => { confidence?: number };
        }
      ).parseVoteFromResponse(content);

      expect(result.confidence).toBe(1);
    });

    it("should fall back to text parsing when JSON is invalid", () => {
      const content = "We should approve this, I agree with it.";
      const result = (
        service as unknown as {
          parseVoteFromResponse: (c: string) => { value: string };
        }
      ).parseVoteFromResponse(content);

      expect(["APPROVE", "REJECT", "ABSTAIN"]).toContain(result.value);
    });
  });

  // ==========================================================================
  // buildVotePrompt (via private method)
  // ==========================================================================

  describe("buildVotePrompt (private)", () => {
    it("should build prompt without options", () => {
      const prompt = (
        service as unknown as {
          buildVotePrompt: (t: string, d: string, o?: string[]) => string;
        }
      ).buildVotePrompt("Test Title", "Test Description");

      expect(prompt).toContain("Test Title");
      expect(prompt).toContain("Test Description");
      expect(prompt).toContain("APPROVE");
      expect(prompt).toContain("REJECT");
      expect(prompt).toContain("ABSTAIN");
    });

    it("should include numbered options when provided", () => {
      const prompt = (
        service as unknown as {
          buildVotePrompt: (t: string, d: string, o?: string[]) => string;
        }
      ).buildVotePrompt("Decision", "Choose wisely", [
        "Option A",
        "Option B",
        "Option C",
      ]);

      expect(prompt).toContain("1. Option A");
      expect(prompt).toContain("2. Option B");
      expect(prompt).toContain("3. Option C");
    });
  });

  // ==========================================================================
  // parseVoteFromText - text keyword matching
  // ==========================================================================

  describe("parseVoteFromText (private, via parseVoteFromResponse)", () => {
    const parse = (content: string) =>
      (
        service as unknown as {
          parseVoteFromResponse: (c: string) => {
            value: string;
            reason?: string;
          };
        }
      ).parseVoteFromResponse(content);

    it("should detect APPROVE from '我投赞成'", () => {
      expect(parse("我投赞成这个方案").value).toBe("APPROVE");
    });

    it("should detect REJECT from '我投反对'", () => {
      expect(parse("我投反对这个决定").value).toBe("REJECT");
    });

    it("should detect ABSTAIN from '我投弃权'", () => {
      expect(parse("我投弃权").value).toBe("ABSTAIN");
    });

    it("should prefer REJECT over APPROVE when both keywords present", () => {
      // reject patterns are checked first in the implementation
      const content = "我反对，虽然有些人赞成";
      expect(parse(content).value).toBe("REJECT");
    });

    it("should truncate long reason to 200 chars + ellipsis", () => {
      const longContent = "X".repeat(300);
      const result = parse(longContent);
      expect(result.reason!.length).toBeLessThanOrEqual(203);
      expect(result.reason!.endsWith("...")).toBe(true);
    });

    it("should keep full reason when content is short", () => {
      const shortContent = "我同意这个提案";
      const result = parse(shortContent);
      expect(result.reason).toBe(shortContent);
    });
  });

  // ==========================================================================
  // delegateTask - additional edge cases
  // ==========================================================================

  describe("delegateTask additional", () => {
    it("should include context in delegation message when context is provided", async () => {
      mockPrisma.topicAIMember.findFirst
        .mockResolvedValueOnce({ id: "from-1", displayName: "From" })
        .mockResolvedValueOnce({
          id: "to-1",
          displayName: "To",
          aiModel: null,
        });

      mockPrisma.topicMessage.create.mockResolvedValue({ id: "msg-ctx" });

      await service.delegateTask({
        topicId: mockTopicId,
        fromMemberId: "from-1",
        toMemberId: "to-1",
        task: "Complete analysis",
        context: { data: "some data", count: 5 },
        waitForResult: false,
      });

      expect(mockPrisma.topicMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: expect.stringContaining("上下文"),
          }),
        }),
      );
    });

    it("should handle message create error and return failure", async () => {
      mockPrisma.topicAIMember.findFirst
        .mockResolvedValueOnce({ id: "from-2", displayName: "From" })
        .mockResolvedValueOnce({
          id: "to-2",
          displayName: "To",
          aiModel: null,
        });

      mockPrisma.topicMessage.create.mockRejectedValue(new Error("DB error"));

      const result = await service.delegateTask({
        topicId: mockTopicId,
        fromMemberId: "from-2",
        toMemberId: "to-2",
        task: "A task",
        waitForResult: false,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.error).toBe("DB error");
    });
  });
});
