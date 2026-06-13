/**
 * TopicSummariesService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { TopicSummariesService } from "../topic-summaries.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { TopicCrudService } from "../topic-crud.service";

const mockTopic = {
  id: "topic-1",
  name: "Test Topic",
  members: [
    {
      user: { fullName: "User One", username: "user1" },
    },
  ],
  aiMembers: [{ id: "ai-1", displayName: "AI Assistant" }],
};

const mockMessages = [
  {
    id: "msg-1",
    content: "Hello world",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    sender: { username: "user1", fullName: "User One" },
    aiMember: null,
  },
  {
    id: "msg-2",
    content: "AI response",
    createdAt: new Date("2024-01-01T00:01:00Z"),
    sender: null,
    aiMember: { displayName: "AI Assistant" },
  },
];

const mockSummary = {
  id: "summary-1",
  topicId: "topic-1",
  title: "Test Summary",
  content: "Summary content",
  createdById: "user-1",
  createdBy: { id: "user-1", username: "user1", fullName: "User One" },
};

describe("TopicSummariesService", () => {
  let service: TopicSummariesService;
  let prisma: {
    topicSummary: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
    topic: { findUnique: jest.Mock };
    topicMessage: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let aiFacade: { chat: jest.Mock }; // shape matches ChatFacade.chat
  let topicCrudService: {
    checkTopicMembership: jest.Mock;
    checkTopicPermission: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      topicSummary: {
        findMany: jest.fn().mockResolvedValue([mockSummary]),
        findFirst: jest.fn().mockResolvedValue(mockSummary),
        create: jest.fn().mockResolvedValue(mockSummary),
        delete: jest.fn().mockResolvedValue(mockSummary),
      },
      topic: {
        findUnique: jest.fn().mockResolvedValue(mockTopic),
      },
      topicMessage: {
        findUnique: jest.fn().mockResolvedValue({ createdAt: new Date() }),
        findMany: jest.fn().mockResolvedValue(mockMessages),
      },
    };

    aiFacade = {
      chat: jest
        .fn()
        .mockResolvedValue({ content: "Generated summary", tokensUsed: 200 }),
    };

    topicCrudService = {
      checkTopicMembership: jest.fn().mockResolvedValue({ role: "MEMBER" }),
      checkTopicPermission: jest.fn().mockResolvedValue({ role: "OWNER" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicSummariesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatFacade, useValue: aiFacade },
        { provide: TopicCrudService, useValue: topicCrudService },
      ],
    }).compile();

    service = module.get<TopicSummariesService>(TopicSummariesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getSummaries", () => {
    it("should return summaries for a topic", async () => {
      const result = await service.getSummaries("topic-1", "user-1");

      expect(result).toEqual([mockSummary]);
      expect(topicCrudService.checkTopicMembership).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
      expect(prisma.topicSummary.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { topicId: "topic-1" },
        }),
      );
    });

    it("should throw when user is not a member", async () => {
      topicCrudService.checkTopicMembership.mockRejectedValue(
        new Error("Not a member"),
      );

      await expect(service.getSummaries("topic-1", "user-x")).rejects.toThrow();
    });
  });

  describe("generateSummary", () => {
    it("should generate summary using AI and save it", async () => {
      const result = await service.generateSummary("topic-1", "user-1", {
        title: "My Summary",
      });

      expect(aiFacade.chat).toHaveBeenCalled();
      expect(prisma.topicSummary.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            topicId: "topic-1",
            content: "Generated summary",
          }),
        }),
      );
      expect(result).toEqual(mockSummary);
    });

    it("should throw BadRequestException when no messages exist", async () => {
      prisma.topicMessage.findMany.mockResolvedValue([]);

      await expect(
        service.generateSummary("topic-1", "user-1", {}),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw NotFoundException when topic not found", async () => {
      prisma.topic.findUnique.mockResolvedValue(null);

      await expect(
        service.generateSummary("topic-1", "user-1", {}),
      ).rejects.toThrow(NotFoundException);
    });

    it("should fall back to basic summary when AI fails", async () => {
      aiFacade.chat.mockRejectedValue(new Error("AI service unavailable"));

      const result = await service.generateSummary("topic-1", "user-1", {});

      expect(result).toBeDefined();
      expect(prisma.topicSummary.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: expect.stringContaining("AI服务暂时不可用"),
          }),
        }),
      );
    });

    it("should filter messages from fromMessageId", async () => {
      const fromMsgDate = new Date("2024-01-01T00:00:30Z");
      prisma.topicMessage.findUnique.mockResolvedValueOnce({
        createdAt: fromMsgDate,
      });
      prisma.topicMessage.findMany.mockResolvedValue(mockMessages);

      await service.generateSummary("topic-1", "user-1", {
        fromMessageId: "msg-1",
      });

      expect(prisma.topicMessage.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "msg-1" } }),
      );
    });

    it("should filter messages to toMessageId", async () => {
      const toMsgDate = new Date("2024-01-01T00:01:00Z");
      prisma.topicMessage.findUnique.mockResolvedValueOnce({
        createdAt: toMsgDate,
      });
      prisma.topicMessage.findMany.mockResolvedValue(mockMessages);

      await service.generateSummary("topic-1", "user-1", {
        toMessageId: "msg-2",
      });

      expect(prisma.topicMessage.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "msg-2" } }),
      );
    });

    it("should use default aiModel when not specified", async () => {
      await service.generateSummary("topic-1", "user-1", {});

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "grok" }),
      );
    });

    it("should use specified aiModel", async () => {
      await service.generateSummary("topic-1", "user-1", {
        aiModel: "gemini-pro",
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gemini-pro" }),
      );
    });

    it("should use dto.title for summary title", async () => {
      await service.generateSummary("topic-1", "user-1", {
        title: "Custom Title",
      });

      expect(prisma.topicSummary.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: "Custom Title" }),
        }),
      );
    });

    it("should use topic name as default title", async () => {
      await service.generateSummary("topic-1", "user-1", {});

      expect(prisma.topicSummary.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: expect.stringContaining("Test Topic"),
          }),
        }),
      );
    });
  });

  describe("deleteSummary", () => {
    it("should delete summary when user is the creator", async () => {
      prisma.topicSummary.findFirst.mockResolvedValue({
        ...mockSummary,
        createdById: "user-1",
      });

      await service.deleteSummary("topic-1", "user-1", "summary-1");

      expect(prisma.topicSummary.delete).toHaveBeenCalledWith({
        where: { id: "summary-1" },
      });
    });

    it("should throw NotFoundException when summary not found", async () => {
      prisma.topicSummary.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteSummary("topic-1", "user-1", "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should allow OWNER/ADMIN to delete others' summaries", async () => {
      prisma.topicSummary.findFirst.mockResolvedValue({
        ...mockSummary,
        createdById: "another-user",
      });
      topicCrudService.checkTopicPermission.mockResolvedValue({
        role: "OWNER",
      });

      await service.deleteSummary("topic-1", "user-1", "summary-1");

      expect(topicCrudService.checkTopicPermission).toHaveBeenCalled();
      expect(prisma.topicSummary.delete).toHaveBeenCalled();
    });

    it("should throw when non-creator lacks permission", async () => {
      prisma.topicSummary.findFirst.mockResolvedValue({
        ...mockSummary,
        createdById: "another-user",
      });
      topicCrudService.checkTopicPermission.mockRejectedValue(
        new Error("Forbidden"),
      );

      await expect(
        service.deleteSummary("topic-1", "user-member", "summary-1"),
      ).rejects.toThrow();
    });
  });
});
