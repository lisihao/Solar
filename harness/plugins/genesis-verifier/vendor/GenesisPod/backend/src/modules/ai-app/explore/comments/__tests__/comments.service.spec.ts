import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { CommentsService } from "../comments.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { CreateCommentDto } from "../dto/create-comment.dto";
import { UpdateCommentDto } from "../dto/update-comment.dto";

const mockComment = {
  id: "com-1",
  content: "Great article!",
  userId: "user-1",
  resourceId: "res-1",
  source: null,
  parentId: null,
  isDeleted: false,
  isEdited: false,
  upvoteCount: 0,
  replyCount: 0,
  createdAt: new Date("2026-01-20"),
  updatedAt: new Date("2026-01-20"),
};

const mockCommentWithUser = {
  ...mockComment,
  user: {
    id: "user-1",
    username: "testuser",
    fullName: "Test User",
    avatarUrl: null,
  },
};

const mockPrisma = {
  comment: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
};

describe("CommentsService", () => {
  let service: CommentsService;

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CommentsService>(CommentsService);
  });

  describe("createComment", () => {
    const createDto: CreateCommentDto = {
      resourceId: "res-1",
      content: "Great article!",
    };

    it("creates a top-level comment successfully", async () => {
      mockPrisma.comment.create.mockResolvedValue(mockCommentWithUser);

      const result = await service.createComment("user-1", createDto);

      expect(result).toEqual(mockCommentWithUser);
      expect(mockPrisma.comment.create).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          resourceId: "res-1",
          source: null,
          content: "Great article!",
          parentId: undefined,
        },
        include: expect.objectContaining({ user: expect.anything() }),
      });
    });

    it("creates a reply with valid parentId", async () => {
      const parentComment = { ...mockComment, id: "parent-com" };
      const replyDto: CreateCommentDto = {
        resourceId: "res-1",
        content: "I agree!",
        parentId: "parent-com",
      };

      mockPrisma.comment.findUnique.mockResolvedValue(parentComment);
      mockPrisma.comment.create.mockResolvedValue({
        ...mockCommentWithUser,
        parentId: "parent-com",
      });
      mockPrisma.comment.update.mockResolvedValue(parentComment);

      const result = await service.createComment("user-1", replyDto);

      expect(result.parentId).toBe("parent-com");
      // should increment parent reply count
      expect(mockPrisma.comment.update).toHaveBeenCalledWith({
        where: { id: "parent-com" },
        data: { replyCount: { increment: 1 } },
      });
    });

    it("throws NotFoundException when parentId refers to nonexistent comment", async () => {
      const replyDto: CreateCommentDto = {
        resourceId: "res-1",
        content: "Reply",
        parentId: "nonexistent",
      };
      mockPrisma.comment.findUnique.mockResolvedValue(null);

      await expect(service.createComment("user-1", replyDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when replying to a deleted comment", async () => {
      const deletedParent = {
        ...mockComment,
        id: "deleted-com",
        isDeleted: true,
      };
      const replyDto: CreateCommentDto = {
        resourceId: "res-1",
        content: "Reply",
        parentId: "deleted-com",
      };
      mockPrisma.comment.findUnique.mockResolvedValue(deletedParent);

      await expect(service.createComment("user-1", replyDto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("creates a source-based comment without resourceId", async () => {
      const sourceDto: CreateCommentDto = {
        source: "youtube:video-123",
        content: "Great video!",
      };
      const sourceComment = {
        ...mockCommentWithUser,
        resourceId: null,
        source: "youtube:video-123",
      };
      mockPrisma.comment.create.mockResolvedValue(sourceComment);

      const result = await service.createComment("user-1", sourceDto);

      expect(result.source).toBe("youtube:video-123");
      expect(mockPrisma.comment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            source: "youtube:video-123",
            resourceId: null,
          }),
        }),
      );
    });
  });

  describe("getResourceComments", () => {
    it("returns threaded comments for a resource", async () => {
      const commentsWithReplies = [
        {
          ...mockCommentWithUser,
          replies: [
            {
              ...mockComment,
              id: "reply-1",
              parentId: "com-1",
              user: mockCommentWithUser.user,
              replies: [],
            },
          ],
        },
      ];
      mockPrisma.comment.findMany.mockResolvedValue(commentsWithReplies);

      const result = await service.getResourceComments("res-1");

      expect(result).toEqual(commentsWithReplies);
      expect(mockPrisma.comment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            resourceId: "res-1",
            parentId: null,
            isDeleted: false,
          },
          include: expect.objectContaining({ replies: expect.anything() }),
        }),
      );
    });

    it("returns empty array when no comments exist", async () => {
      mockPrisma.comment.findMany.mockResolvedValue([]);

      const result = await service.getResourceComments("res-no-comments");

      expect(result).toEqual([]);
    });

    it("orders top-level comments by createdAt desc", async () => {
      mockPrisma.comment.findMany.mockResolvedValue([]);

      await service.getResourceComments("res-1");

      expect(mockPrisma.comment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: "desc" },
        }),
      );
    });
  });

  describe("getSourceComments", () => {
    it("returns comments for a source string", async () => {
      mockPrisma.comment.findMany.mockResolvedValue([mockCommentWithUser]);

      const result = await service.getSourceComments("youtube:abc");

      expect(result).toEqual([mockCommentWithUser]);
      expect(mockPrisma.comment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            source: "youtube:abc",
            parentId: null,
            isDeleted: false,
          },
        }),
      );
    });
  });

  describe("getSourceCommentStats", () => {
    it("returns correct stats with total, topLevel, and replies", async () => {
      mockPrisma.comment.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(6); // topLevel

      const result = await service.getSourceCommentStats("youtube:abc");

      expect(result).toEqual({ total: 10, topLevel: 6, replies: 4 });
    });

    it("returns zero stats when no comments", async () => {
      mockPrisma.comment.count.mockResolvedValue(0);

      const result = await service.getSourceCommentStats("youtube:empty");

      expect(result).toEqual({ total: 0, topLevel: 0, replies: 0 });
    });
  });

  describe("getComment", () => {
    it("returns a single comment with user and replies", async () => {
      mockPrisma.comment.findUnique.mockResolvedValue(mockCommentWithUser);

      const result = await service.getComment("com-1");

      expect(result).toEqual(mockCommentWithUser);
      expect(mockPrisma.comment.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "com-1" },
          include: expect.objectContaining({
            user: expect.anything(),
            parent: expect.anything(),
            replies: expect.anything(),
          }),
        }),
      );
    });

    it("throws NotFoundException when comment not found", async () => {
      mockPrisma.comment.findUnique.mockResolvedValue(null);

      await expect(service.getComment("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("updateComment", () => {
    const updateDto: UpdateCommentDto = { content: "Updated content" };

    it("updates comment content when owner makes request", async () => {
      const updatedComment = {
        ...mockCommentWithUser,
        content: "Updated content",
        isEdited: true,
      };
      mockPrisma.comment.findUnique.mockResolvedValue(mockComment);
      mockPrisma.comment.update.mockResolvedValue(updatedComment);

      const result = await service.updateComment("com-1", "user-1", updateDto);

      expect(result.content).toBe("Updated content");
      expect(mockPrisma.comment.update).toHaveBeenCalledWith({
        where: { id: "com-1" },
        data: { content: "Updated content", isEdited: true },
        include: expect.anything(),
      });
    });

    it("throws NotFoundException when comment does not exist", async () => {
      mockPrisma.comment.findUnique.mockResolvedValue(null);

      await expect(
        service.updateComment("nonexistent", "user-1", updateDto),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when non-owner tries to update", async () => {
      mockPrisma.comment.findUnique.mockResolvedValue(mockComment);

      await expect(
        service.updateComment("com-1", "other-user", updateDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws ForbiddenException when updating deleted comment", async () => {
      const deletedComment = { ...mockComment, isDeleted: true };
      mockPrisma.comment.findUnique.mockResolvedValue(deletedComment);

      await expect(
        service.updateComment("com-1", "user-1", updateDto),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("deleteComment", () => {
    it("soft-deletes a comment by replacing content", async () => {
      mockPrisma.comment.findUnique.mockResolvedValue(mockComment);
      mockPrisma.comment.update.mockResolvedValue({
        ...mockComment,
        isDeleted: true,
        content: "[This comment has been deleted]",
      });

      const result = await service.deleteComment("com-1", "user-1");

      expect(result).toEqual({ success: true });
      expect(mockPrisma.comment.update).toHaveBeenCalledWith({
        where: { id: "com-1" },
        data: {
          isDeleted: true,
          content: "[This comment has been deleted]",
        },
      });
    });

    it("decrements parent replyCount when deleting a reply", async () => {
      const replyComment = { ...mockComment, id: "reply-1", parentId: "com-1" };
      mockPrisma.comment.findUnique.mockResolvedValue(replyComment);
      mockPrisma.comment.update.mockResolvedValue({
        ...replyComment,
        isDeleted: true,
      });

      await service.deleteComment("reply-1", "user-1");

      expect(mockPrisma.comment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "com-1" },
          data: { replyCount: { decrement: 1 } },
        }),
      );
    });

    it("throws NotFoundException when comment does not exist", async () => {
      mockPrisma.comment.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteComment("nonexistent", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when non-owner tries to delete", async () => {
      mockPrisma.comment.findUnique.mockResolvedValue(mockComment);

      await expect(
        service.deleteComment("com-1", "other-user"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("upvoteComment", () => {
    it("increments upvote count on a comment", async () => {
      const upvotedComment = { ...mockCommentWithUser, upvoteCount: 1 };
      mockPrisma.comment.findUnique.mockResolvedValue(mockComment);
      mockPrisma.comment.update.mockResolvedValue(upvotedComment);

      const result = await service.upvoteComment("com-1");

      expect(result.upvoteCount).toBe(1);
      expect(mockPrisma.comment.update).toHaveBeenCalledWith({
        where: { id: "com-1" },
        data: { upvoteCount: { increment: 1 } },
      });
    });

    it("throws NotFoundException when comment does not exist", async () => {
      mockPrisma.comment.findUnique.mockResolvedValue(null);

      await expect(service.upvoteComment("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when upvoting a deleted comment", async () => {
      const deletedComment = { ...mockComment, isDeleted: true };
      mockPrisma.comment.findUnique.mockResolvedValue(deletedComment);

      await expect(service.upvoteComment("com-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("getCommentStats", () => {
    it("returns stats with correct replies calculation", async () => {
      mockPrisma.comment.count
        .mockResolvedValueOnce(15) // total (all non-deleted)
        .mockResolvedValueOnce(8); // topLevel (no parentId)

      const result = await service.getCommentStats("res-1");

      expect(result).toEqual({ total: 15, topLevel: 8, replies: 7 });
    });

    it("queries count with correct where clauses", async () => {
      mockPrisma.comment.count.mockResolvedValue(0);

      await service.getCommentStats("res-1");

      // First call: total (resourceId + isDeleted false)
      expect(mockPrisma.comment.count).toHaveBeenNthCalledWith(1, {
        where: { resourceId: "res-1", isDeleted: false },
      });
      // Second call: topLevel (parentId null + isDeleted false)
      expect(mockPrisma.comment.count).toHaveBeenNthCalledWith(2, {
        where: { resourceId: "res-1", parentId: null, isDeleted: false },
      });
    });
  });
});
