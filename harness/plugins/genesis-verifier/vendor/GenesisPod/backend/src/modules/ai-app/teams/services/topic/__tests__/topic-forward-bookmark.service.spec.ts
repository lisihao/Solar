/**
 * TopicForwardBookmarkService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TopicForwardBookmarkService } from "../topic-forward-bookmark.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { TopicType, MessageContentType, MergeMode } from "@prisma/client";

const mockTopic = {
  id: "topic-1",
  name: "Test Topic",
  type: TopicType.PRIVATE,
  members: [{ userId: "user-1", role: "MEMBER" }],
};

const mockMessage = {
  id: "msg-1",
  topicId: "topic-1",
  content: "Hello world",
  contentType: MessageContentType.TEXT,
  senderId: "user-1",
  aiMemberId: null,
  deletedAt: null,
  createdAt: new Date(),
  sender: { username: "sender", fullName: "Sender User" },
  aiMember: null,
};

const mockForwardRecord = {
  id: "fwd-1",
  originalMessageIds: ["msg-1"],
  sourceTopicId: "topic-1",
  targetType: "TOPIC",
  targetTopicId: "topic-2",
  targetUserId: null,
  mergeMode: MergeMode.SEPARATE,
  forwardNote: null,
  forwardedById: "user-1",
};

const mockBookmark = {
  id: "bm-1",
  messageId: "msg-1",
  userId: "user-1",
  category: "important",
  note: "Save this",
  tags: ["note", "reference"],
  createdAt: new Date(),
};

describe("TopicForwardBookmarkService", () => {
  let service: TopicForwardBookmarkService;
  let prisma: jest.Mocked<PrismaService>;

  const mockPrisma = {
    topic: {
      findUnique: jest.fn().mockResolvedValue(mockTopic),
      update: jest.fn().mockResolvedValue(mockTopic),
    },
    topicMessage: {
      findMany: jest.fn().mockResolvedValue([mockMessage]),
      findFirst: jest.fn().mockResolvedValue(mockMessage),
      create: jest.fn().mockResolvedValue({ id: "new-msg-1" }),
    },
    topicMessageForward: {
      create: jest.fn().mockResolvedValue(mockForwardRecord),
      update: jest.fn().mockResolvedValue(mockForwardRecord),
    },
    topicMessageBookmark: {
      upsert: jest.fn().mockResolvedValue(mockBookmark),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([mockBookmark]),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicForwardBookmarkService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TopicForwardBookmarkService>(
      TopicForwardBookmarkService,
    );
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== forwardMessages ====================

  describe("forwardMessages", () => {
    const forwardDto = {
      messageIds: ["msg-1"],
      targetType: "TOPIC" as const,
      targetTopicId: "topic-2",
      mergeMode: "SEPARATE" as any,
    };

    it("should forward messages in SEPARATE mode", async () => {
      // Second topic check for membership
      mockPrisma.topic.findUnique
        .mockResolvedValueOnce(mockTopic) // source topic membership check
        .mockResolvedValueOnce({
          ...mockTopic,
          id: "topic-2",
          members: [{ userId: "user-1" }],
        }); // target topic

      const result = await service.forwardMessages(
        "topic-1",
        "user-1",
        forwardDto as any,
      );

      expect(result.success).toBe(true);
      expect(result.forwardId).toBe("fwd-1");
      expect(result.mergeMode).toBe("SEPARATE");
      expect(prisma.topicMessage.create).toHaveBeenCalled();
    });

    it("should forward messages in MERGED mode", async () => {
      mockPrisma.topic.findUnique
        .mockResolvedValueOnce(mockTopic)
        .mockResolvedValueOnce({
          ...mockTopic,
          id: "topic-2",
          members: [{ userId: "user-1" }],
        });

      const dto = {
        ...forwardDto,
        mergeMode: "MERGED" as any,
        forwardNote: "Important",
      };
      const result = await service.forwardMessages(
        "topic-1",
        "user-1",
        dto as any,
      );

      expect(result.success).toBe(true);
      expect(result.mergeMode).toBe("MERGED");
    });

    it("should forward messages in SUMMARY mode", async () => {
      mockPrisma.topic.findUnique
        .mockResolvedValueOnce(mockTopic)
        .mockResolvedValueOnce({
          ...mockTopic,
          id: "topic-2",
          members: [{ userId: "user-1" }],
        });

      const dto = { ...forwardDto, mergeMode: "SUMMARY" as any };
      const result = await service.forwardMessages(
        "topic-1",
        "user-1",
        dto as any,
      );

      expect(result.success).toBe(true);
      expect(result.mergeMode).toBe("SUMMARY");
    });

    it("should throw when topic not found", async () => {
      mockPrisma.topic.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.forwardMessages("nonexistent", "user-1", forwardDto as any),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when some messages not found", async () => {
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([]); // No messages found

      await expect(
        service.forwardMessages("topic-1", "user-1", forwardDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw when user is not a member of private topic", async () => {
      mockPrisma.topic.findUnique.mockResolvedValueOnce({
        ...mockTopic,
        members: [], // not a member
      });

      await expect(
        service.forwardMessages("topic-1", "user-1", forwardDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it("should update topic updatedAt when forwarding to a topic", async () => {
      mockPrisma.topic.findUnique
        .mockResolvedValueOnce(mockTopic)
        .mockResolvedValueOnce({
          ...mockTopic,
          id: "topic-2",
          members: [{ userId: "user-1" }],
        });

      await service.forwardMessages("topic-1", "user-1", forwardDto as any);

      expect(prisma.topic.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "topic-2" } }),
      );
    });

    it("should not create topic messages when forwarding to user (not topic)", async () => {
      mockPrisma.topic.findUnique.mockResolvedValueOnce(mockTopic);

      const userForwardDto = {
        messageIds: ["msg-1"],
        targetType: "USER" as const,
        targetUserId: "user-3",
      };

      const result = await service.forwardMessages(
        "topic-1",
        "user-1",
        userForwardDto as any,
      );

      expect(result.success).toBe(true);
      // No topic messages should be created for user forwards
      expect(prisma.topicMessage.create).not.toHaveBeenCalled();
    });

    it("should include forward note in MERGED content", async () => {
      mockPrisma.topic.findUnique
        .mockResolvedValueOnce(mockTopic)
        .mockResolvedValueOnce({
          ...mockTopic,
          id: "topic-2",
          members: [{ userId: "user-1" }],
        });

      const dto = {
        ...forwardDto,
        mergeMode: "MERGED" as any,
        forwardNote: "Important forward",
      };

      await service.forwardMessages("topic-1", "user-1", dto as any);

      expect(prisma.topicMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: expect.stringContaining("Important forward"),
          }),
        }),
      );
    });
  });

  // ==================== bookmarkMessage ====================

  describe("bookmarkMessage", () => {
    const bookmarkDto = {
      category: "important",
      note: "Save this message",
      tags: ["reference"],
    };

    it("should bookmark a message", async () => {
      await service.bookmarkMessage(
        "topic-1",
        "user-1",
        "msg-1",
        bookmarkDto as any,
      );

      expect(prisma.topicMessageBookmark.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { messageId_userId: { messageId: "msg-1", userId: "user-1" } },
          create: expect.objectContaining({
            messageId: "msg-1",
            userId: "user-1",
            category: "important",
          }),
        }),
      );
    });

    it("should throw NotFoundException when message not found", async () => {
      mockPrisma.topicMessage.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.bookmarkMessage(
          "topic-1",
          "user-1",
          "nonexistent",
          bookmarkDto as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw when user not a member of private topic", async () => {
      mockPrisma.topic.findUnique.mockResolvedValueOnce({
        ...mockTopic,
        members: [],
        type: TopicType.PRIVATE,
      });

      await expect(
        service.bookmarkMessage(
          "topic-1",
          "user-1",
          "msg-1",
          bookmarkDto as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should use empty array for tags when not provided", async () => {
      await service.bookmarkMessage("topic-1", "user-1", "msg-1", {
        category: "notes",
      } as any);

      expect(prisma.topicMessageBookmark.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ tags: [] }),
        }),
      );
    });
  });

  // ==================== unbookmarkMessage ====================

  describe("unbookmarkMessage", () => {
    it("should remove bookmark", async () => {
      await service.unbookmarkMessage("topic-1", "user-1", "msg-1");

      expect(prisma.topicMessageBookmark.deleteMany).toHaveBeenCalledWith({
        where: { messageId: "msg-1", userId: "user-1" },
      });
    });

    it("should throw when topic not found", async () => {
      mockPrisma.topic.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.unbookmarkMessage("nonexistent", "user-1", "msg-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== getBookmarks ====================

  describe("getBookmarks", () => {
    it("should return user bookmarks with message details", async () => {
      const messages = [
        { ...mockMessage, topic: { id: "topic-1", name: "Test" } },
      ];
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce(messages);

      const result = await service.getBookmarks("user-1");

      expect(prisma.topicMessageBookmark.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "user-1" } }),
      );
      expect(result[0].message).toBeDefined();
    });

    it("should filter by category when provided", async () => {
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([]);

      await service.getBookmarks("user-1", { category: "important" });

      expect(prisma.topicMessageBookmark.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: "user-1",
            category: "important",
          }),
        }),
      );
    });

    it("should handle bookmarks with no corresponding messages", async () => {
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([]); // no messages found

      const result = await service.getBookmarks("user-1");

      expect(result[0].message).toBeUndefined();
    });
  });

  // ==================== getBookmarkCategories ====================

  describe("getBookmarkCategories", () => {
    it("should return distinct categories", async () => {
      mockPrisma.topicMessageBookmark.findMany.mockResolvedValueOnce([
        { category: "important" },
        { category: "notes" },
      ]);

      const result = await service.getBookmarkCategories("user-1");

      expect(prisma.topicMessageBookmark.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1", category: { not: null } },
          distinct: ["category"],
        }),
      );
      expect(result).toContain("important");
      expect(result).toContain("notes");
    });

    it("should filter out null categories", async () => {
      mockPrisma.topicMessageBookmark.findMany.mockResolvedValueOnce([
        { category: null },
        { category: "important" },
      ]);

      const result = await service.getBookmarkCategories("user-1");

      expect(result).not.toContain(null);
      expect(result).toContain("important");
    });
  });
});
