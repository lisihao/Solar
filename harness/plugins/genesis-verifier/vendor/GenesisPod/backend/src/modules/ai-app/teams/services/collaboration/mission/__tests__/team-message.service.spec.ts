/**
 * TeamMessageService Unit Tests
 *
 * Tests the two core methods:
 * - createLog: creates a MissionLog record via Prisma
 * - sendMessageToTopic: creates TopicMessage, emits via TopicEventEmitterService,
 *   and returns null on error without rethrowing
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TeamMessageService } from "../team-message.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { TopicEventEmitterService } from "../../../events";
import { MissionLogType, MessageContentType } from "@prisma/client";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = {
  missionLog: {
    create: jest.fn(),
  },
  topicMessage: {
    create: jest.fn(),
  },
};

const mockTopicEventEmitter = {
  emitToTopic: jest.fn(),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("TeamMessageService", () => {
  let service: TeamMessageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamMessageService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TopicEventEmitterService, useValue: mockTopicEventEmitter },
      ],
    }).compile();

    service = module.get<TeamMessageService>(TeamMessageService);
    jest.clearAllMocks();
  });

  // =========================================================================
  // createLog
  // =========================================================================

  describe("createLog", () => {
    it("creates a mission log with required fields", async () => {
      const expected = {
        id: "log-1",
        missionId: "mission-1",
        type: MissionLogType.TASK_STARTED,
        content: "Task started",
      };
      mockPrisma.missionLog.create.mockResolvedValue(expected);

      const result = await service.createLog("mission-1", {
        type: MissionLogType.TASK_STARTED,
        content: "Task started",
      });

      expect(mockPrisma.missionLog.create).toHaveBeenCalledWith({
        data: {
          missionId: "mission-1",
          type: MissionLogType.TASK_STARTED,
          content: "Task started",
        },
      });
      expect(result).toBe(expected);
    });

    it("creates a mission log with all optional fields", async () => {
      const logData = {
        type: MissionLogType.AGENT_RESPONSE,
        agentId: "agent-1",
        agentName: "Research Agent",
        taskId: "task-1",
        taskTitle: "Data Collection",
        content: "Agent completed analysis",
        messageId: "msg-1",
        metadata: { tokens: 1234 } as object,
      };
      const expected = { id: "log-2", missionId: "mission-2", ...logData };
      mockPrisma.missionLog.create.mockResolvedValue(expected);

      const result = await service.createLog("mission-2", logData);

      expect(mockPrisma.missionLog.create).toHaveBeenCalledWith({
        data: {
          missionId: "mission-2",
          ...logData,
        },
      });
      expect(result).toBe(expected);
    });

    it("spreads the data object into the prisma create call", async () => {
      mockPrisma.missionLog.create.mockResolvedValue({ id: "log-3" });

      await service.createLog("mission-3", {
        type: MissionLogType.MISSION_STARTED,
        agentId: "agent-x",
        content: "Mission began",
      });

      const callArg = mockPrisma.missionLog.create.mock.calls[0][0];
      expect(callArg.data.missionId).toBe("mission-3");
      expect(callArg.data.agentId).toBe("agent-x");
      expect(callArg.data.type).toBe(MissionLogType.MISSION_STARTED);
    });

    it("propagates prisma errors", async () => {
      mockPrisma.missionLog.create.mockRejectedValue(new Error("DB error"));

      await expect(
        service.createLog("mission-1", {
          type: MissionLogType.ERROR,
          content: "Failed",
        }),
      ).rejects.toThrow("DB error");
    });
  });

  // =========================================================================
  // sendMessageToTopic
  // =========================================================================

  describe("sendMessageToTopic", () => {
    const topicId = "topic-1";
    const aiMemberId = "member-1";
    const content = "Hello team!";
    const contentType = MessageContentType.TEXT;

    it("creates a TopicMessage with include for aiMember", async () => {
      const expected = {
        id: "msg-1",
        topicId,
        aiMemberId,
        content,
        contentType,
        aiMember: {
          id: "member-1",
          displayName: "Agent",
          agentName: "researcher",
          avatar: null,
          aiModel: "gpt-4",
        },
      };
      mockPrisma.topicMessage.create.mockResolvedValue(expected);
      mockTopicEventEmitter.emitToTopic.mockResolvedValue(undefined);

      const result = await service.sendMessageToTopic(
        topicId,
        aiMemberId,
        content,
        contentType,
      );

      expect(mockPrisma.topicMessage.create).toHaveBeenCalledWith({
        data: { topicId, aiMemberId, content, contentType },
        include: {
          aiMember: {
            select: {
              id: true,
              displayName: true,
              agentName: true,
              avatar: true,
              aiModel: true,
            },
          },
        },
      });
      expect(result).toBe(expected);
    });

    it("emits message:new event via topicEventEmitter after creating message", async () => {
      const message = { id: "msg-2", topicId, content };
      mockPrisma.topicMessage.create.mockResolvedValue(message);
      mockTopicEventEmitter.emitToTopic.mockResolvedValue(undefined);

      await service.sendMessageToTopic(
        topicId,
        aiMemberId,
        content,
        contentType,
      );

      expect(mockTopicEventEmitter.emitToTopic).toHaveBeenCalledWith(
        topicId,
        "message:new",
        message,
      );
    });

    it("accepts null aiMemberId (system messages)", async () => {
      const message = { id: "msg-3", topicId, aiMemberId: null, content };
      mockPrisma.topicMessage.create.mockResolvedValue(message);
      mockTopicEventEmitter.emitToTopic.mockResolvedValue(undefined);

      const result = await service.sendMessageToTopic(
        topicId,
        null,
        content,
        contentType,
      );

      expect(mockPrisma.topicMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ aiMemberId: null }),
        }),
      );
      expect(result).toBe(message);
    });

    it("returns null and does not rethrow when prisma.topicMessage.create throws", async () => {
      mockPrisma.topicMessage.create.mockRejectedValue(
        new Error("Connection lost"),
      );

      const result = await service.sendMessageToTopic(
        topicId,
        aiMemberId,
        content,
        contentType,
      );

      expect(result).toBeNull();
      expect(mockTopicEventEmitter.emitToTopic).not.toHaveBeenCalled();
    });

    it("still returns the created message even if topicEventEmitter.emitToTopic resolves slowly", async () => {
      // emitToTopic is called without await (fire-and-forget) — service returns message
      // regardless of when the emit completes
      const message = { id: "msg-4", topicId };
      mockPrisma.topicMessage.create.mockResolvedValue(message);
      mockTopicEventEmitter.emitToTopic.mockResolvedValue(undefined);

      const result = await service.sendMessageToTopic(
        topicId,
        aiMemberId,
        content,
        contentType,
      );

      // Message is returned immediately; emitToTopic is fire-and-forget
      expect(result).toBe(message);
      expect(mockTopicEventEmitter.emitToTopic).toHaveBeenCalledWith(
        topicId,
        "message:new",
        message,
      );
    });

    it("handles MARKDOWN content type", async () => {
      const markdownContent = "## Heading\n\nSome **bold** text";
      const message = { id: "msg-5", topicId, content: markdownContent };
      mockPrisma.topicMessage.create.mockResolvedValue(message);
      mockTopicEventEmitter.emitToTopic.mockResolvedValue(undefined);

      const result = await service.sendMessageToTopic(
        topicId,
        aiMemberId,
        markdownContent,
        MessageContentType.MARKDOWN,
      );

      expect(mockPrisma.topicMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contentType: MessageContentType.MARKDOWN,
          }),
        }),
      );
      expect(result).toBe(message);
    });
  });
});
