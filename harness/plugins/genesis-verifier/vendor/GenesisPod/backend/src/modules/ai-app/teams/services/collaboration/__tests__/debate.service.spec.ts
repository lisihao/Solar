/**
 * DebateService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { DebateService } from "../debate.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChatFacade, TeamFacade } from "@/modules/ai-harness/facade";
import { NotFoundException } from "@nestjs/common";
import { DebateStatus, DebateRole } from "@prisma/client";

const mockRedAi = {
  id: "ai-red-1",
  displayName: "Red Agent",
  aiModel: "gpt-4",
};

const mockBlueAi = {
  id: "ai-blue-1",
  displayName: "Blue Agent",
  aiModel: "gemini-pro",
};

const mockSession = {
  id: "session-1",
  topicId: "topic-1",
  topic: "Should AI be regulated?",
  status: DebateStatus.ACTIVE,
  maxRounds: 3,
  currentRound: 1,
  roundTimeoutMs: 120000,
  initiatedById: "user-1",
  agents: [
    {
      id: "agent-red-1",
      aiMemberId: "ai-red-1",
      displayName: "Red Agent",
      aiModel: "gpt-4",
      role: DebateRole.RED,
      stance: "Support",
      stancePrompt: "You are the RED debater",
      conversationHistory: [],
      session: {
        id: "session-1",
        currentRound: 1,
        topic: "Should AI be regulated?",
        initiatedById: "user-1",
        maxRounds: 3,
      },
    },
    {
      id: "agent-blue-1",
      aiMemberId: "ai-blue-1",
      displayName: "Blue Agent",
      aiModel: "gemini-pro",
      role: DebateRole.BLUE,
      stance: "Oppose",
      stancePrompt: "You are the BLUE debater",
      conversationHistory: [],
      session: {
        id: "session-1",
        currentRound: 1,
        topic: "Should AI be regulated?",
        initiatedById: "user-1",
        maxRounds: 3,
      },
    },
  ],
};

const mockAgent = mockSession.agents[0];

describe("DebateService", () => {
  let service: DebateService;
  let prisma: jest.Mocked<PrismaService>;
  let aiFacade: jest.Mocked<ChatFacade>;

  const mockAiFacade = {
    chat: jest.fn().mockResolvedValue({
      content: "Debate response content",
      tokensUsed: 150,
    }),
    getModelById: jest.fn().mockResolvedValue({ id: "gpt-4", name: "GPT-4" }),
    a2aPublish: jest.fn().mockResolvedValue(undefined),
    a2aClearSession: jest.fn(),
    votingCreate: jest.fn().mockReturnValue({ id: "vote-1" }),
    votingCastVote: jest.fn(),
    votingClose: jest
      .fn()
      .mockReturnValue({ winner: "agent-red-1", consensus: false, tally: {} }),
  };

  const mockPrisma = {
    topicAIMember: {
      findUnique: jest.fn(),
    },
    debateSession: {
      create: jest.fn().mockResolvedValue(mockSession),
      findUnique: jest.fn().mockResolvedValue(mockSession),
      update: jest.fn().mockResolvedValue(mockSession),
      findMany: jest.fn().mockResolvedValue([mockSession]),
    },
    debateAgent: {
      findUnique: jest.fn().mockResolvedValue(mockAgent),
      update: jest.fn().mockResolvedValue(mockAgent),
    },
    debateMessage: {
      create: jest.fn().mockResolvedValue({ id: "msg-1" }),
      update: jest.fn().mockResolvedValue({ id: "msg-1" }),
    },
    topicMessage: {
      create: jest.fn().mockResolvedValue({ id: "topic-msg-1" }),
    },
    $transaction: jest.fn().mockImplementation(async (operations) => {
      if (Array.isArray(operations)) {
        return Promise.all(operations);
      }
      return operations({
        debateMessage: { create: jest.fn().mockResolvedValue({}) },
        debateAgent: { update: jest.fn().mockResolvedValue({}) },
      });
    }),
  };

  beforeEach(async () => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Default mock for topicAIMember (can be overridden per test)
    mockPrisma.topicAIMember.findUnique
      .mockResolvedValueOnce(mockRedAi)
      .mockResolvedValueOnce(mockBlueAi);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DebateService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockAiFacade },
        { provide: TeamFacade, useValue: mockAiFacade },
      ],
    }).compile();

    service = module.get<DebateService>(DebateService);
    prisma = module.get(PrismaService);
    aiFacade = module.get(ChatFacade);
  });

  afterEach(() => {
    // Mocks are cleared in beforeEach
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== createDebateSession ====================

  describe("createDebateSession", () => {
    it("should create a debate session successfully", async () => {
      // topicAIMember mocks already set in beforeEach
      const request = {
        topicId: "topic-1",
        userId: "user-1",
        debateTopic: "Should AI be regulated?",
        redAiMemberId: "ai-red-1",
        blueAiMemberId: "ai-blue-1",
        config: { maxRounds: 3 },
      };

      const result = await service.createDebateSession(request);

      expect(prisma.topicAIMember.findUnique).toHaveBeenCalledTimes(2);
      expect(prisma.debateSession.create).toHaveBeenCalled();
      expect(result.id).toBe("session-1");
    });

    it("should throw NotFoundException when red AI not found", async () => {
      // Reset and set up: red returns null, blue returns value
      mockPrisma.topicAIMember.findUnique
        .mockReset()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockBlueAi);

      await expect(
        service.createDebateSession({
          topicId: "topic-1",
          userId: "user-1",
          debateTopic: "Test topic",
          redAiMemberId: "nonexistent",
          blueAiMemberId: "ai-blue-1",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when blue AI not found", async () => {
      // Reset and set up: red returns value, blue returns null
      mockPrisma.topicAIMember.findUnique
        .mockReset()
        .mockResolvedValueOnce(mockRedAi)
        .mockResolvedValueOnce(null);

      await expect(
        service.createDebateSession({
          topicId: "topic-1",
          userId: "user-1",
          debateTopic: "Test topic",
          redAiMemberId: "ai-red-1",
          blueAiMemberId: "nonexistent",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should use default config values when not provided", async () => {
      // topicAIMember mocks already set in beforeEach
      await service.createDebateSession({
        topicId: "topic-1",
        userId: "user-1",
        debateTopic: "Test topic",
        redAiMemberId: "ai-red-1",
        blueAiMemberId: "ai-blue-1",
      });

      expect(prisma.debateSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            maxRounds: 3,
            roundTimeoutMs: 120000,
          }),
        }),
      );
    });
  });

  // ==================== executeDebateRound ====================

  describe("executeDebateRound", () => {
    it("should execute a debate round for an agent", async () => {
      const result = await service.executeDebateRound(
        "session-1",
        "agent-red-1",
      );

      expect(aiFacade.chat).toHaveBeenCalled();
      expect(result.content).toBe("Debate response content");
      expect(result.tokensUsed).toBe(150);
    });

    it("should throw NotFoundException when agent not found", async () => {
      mockPrisma.debateAgent.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.executeDebateRound("session-1", "nonexistent-agent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw when AI model not found", async () => {
      mockAiFacade.getModelById.mockResolvedValueOnce(null);

      await expect(
        service.executeDebateRound("session-1", "agent-red-1"),
      ).rejects.toThrow("AI model not found");
    });

    it("should include opponent message in round context", async () => {
      await service.executeDebateRound(
        "session-1",
        "agent-blue-1",
        "Red position message",
      );

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining("Red position message"),
            }),
          ]),
        }),
      );
    });

    it("should send first round message without opponent message", async () => {
      await service.executeDebateRound("session-1", "agent-red-1");

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ content: expect.stringContaining("第") }),
          ]),
        }),
      );
    });

    it("should save message via transaction", async () => {
      await service.executeDebateRound("session-1", "agent-red-1");

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("should publish via A2A bus", async () => {
      await service.executeDebateRound("session-1", "agent-red-1");

      expect(aiFacade.a2aPublish).toHaveBeenCalled();
    });

    it("should use billing config when user is set", async () => {
      await service.executeDebateRound("session-1", "agent-red-1");

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          billing: expect.objectContaining({
            userId: "user-1",
            moduleType: "ai-teams",
          }),
        }),
      );
    });

    it("should include conversation history in messages", async () => {
      const agentWithHistory = {
        ...mockAgent,
        conversationHistory: [
          {
            role: "user",
            content: "Previous message",
            timestamp: new Date().toISOString(),
          },
          {
            role: "assistant",
            content: "Previous response",
            timestamp: new Date().toISOString(),
          },
        ],
      };
      mockPrisma.debateAgent.findUnique.mockResolvedValueOnce(agentWithHistory);

      await service.executeDebateRound("session-1", "agent-red-1");

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ content: "Previous message" }),
          ]),
        }),
      );
    });
  });

  // ==================== runDebate ====================

  describe("runDebate", () => {
    it("should throw NotFoundException when session not found", async () => {
      mockPrisma.debateSession.findUnique.mockResolvedValueOnce(null);

      await expect(service.runDebate("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw when red or blue agent is missing", async () => {
      mockPrisma.debateSession.findUnique.mockResolvedValueOnce({
        ...mockSession,
        agents: [mockSession.agents[0]], // only red agent
      });

      await expect(service.runDebate("session-1")).rejects.toThrow(
        "Missing red or blue agent",
      );
    });

    it("should run debate for configured rounds", async () => {
      const twoRoundSession = {
        ...mockSession,
        maxRounds: 2,
      };
      mockPrisma.debateSession.findUnique.mockResolvedValueOnce(
        twoRoundSession,
      );
      mockPrisma.debateAgent.findUnique.mockResolvedValue(mockAgent);

      await service.runDebate("session-1");

      expect(prisma.debateSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DebateStatus.COMPLETED }),
        }),
      );
    });

    it("should clear A2A session after debate", async () => {
      await service.runDebate("session-1");

      expect(aiFacade.a2aClearSession).toHaveBeenCalledWith("session-1");
    });
  });

  // ==================== completeDebate ====================

  describe("completeDebate", () => {
    it("should mark session as completed", async () => {
      await service.completeDebate("session-1");

      expect(prisma.debateSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "session-1" },
          data: expect.objectContaining({ status: DebateStatus.COMPLETED }),
        }),
      );
    });

    it("should clear A2A session", async () => {
      await service.completeDebate("session-1");

      expect(aiFacade.a2aClearSession).toHaveBeenCalledWith("session-1");
    });
  });

  // ==================== getDebateSession ====================

  describe("getDebateSession", () => {
    it("should return debate session with agents and messages", async () => {
      await service.getDebateSession("session-1");

      expect(prisma.debateSession.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "session-1" },
          include: expect.objectContaining({
            agents: true,
            messages: expect.any(Object),
          }),
        }),
      );
    });
  });

  // ==================== getDebatesByTopic ====================

  describe("getDebatesByTopic", () => {
    it("should return all debates for a topic", async () => {
      const result = await service.getDebatesByTopic("topic-1");

      expect(prisma.debateSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { topicId: "topic-1" },
        }),
      );
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ==================== syncDebateToTopic ====================

  describe("syncDebateToTopic", () => {
    it("should throw when session not found", async () => {
      mockPrisma.debateSession.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.syncDebateToTopic("nonexistent", "topic-1", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should sync messages to topic", async () => {
      const sessionWithMessages = {
        ...mockSession,
        messages: [
          {
            id: "msg-1",
            agentId: "agent-red-1",
            content: "Debate content",
            modelUsed: "gpt-4",
            tokensUsed: 100,
          },
        ],
      };
      mockPrisma.debateSession.findUnique.mockResolvedValueOnce(
        sessionWithMessages,
      );

      await service.syncDebateToTopic("session-1", "topic-1", "user-1");

      expect(prisma.topicMessage.create).toHaveBeenCalled();
      expect(prisma.debateMessage.update).toHaveBeenCalled();
    });

    it("should skip messages with unknown agents", async () => {
      const sessionWithUnknownAgent = {
        ...mockSession,
        messages: [
          {
            id: "msg-1",
            agentId: "unknown-agent",
            content: "Debate content",
            modelUsed: "gpt-4",
            tokensUsed: 100,
          },
        ],
      };
      mockPrisma.debateSession.findUnique.mockResolvedValueOnce(
        sessionWithUnknownAgent,
      );

      await service.syncDebateToTopic("session-1", "topic-1", "user-1");

      expect(prisma.topicMessage.create).not.toHaveBeenCalled();
    });
  });
});
