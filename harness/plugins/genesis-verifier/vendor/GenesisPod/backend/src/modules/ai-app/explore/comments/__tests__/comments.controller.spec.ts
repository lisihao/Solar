import { Test, TestingModule } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { CommentsController } from "../comments.controller";
import { CommentsService } from "../comments.service";
import { CreateCommentDto, UpdateCommentDto } from "../dto";

describe("CommentsController", () => {
  let controller: CommentsController;
  let commentsService: jest.Mocked<CommentsService>;

  const mockComment = {
    id: "comment-1",
    content: "Test comment",
    userId: "user-1",
    resourceId: "resource-1",
    createdAt: new Date(),
  };

  const mockCommentList = [mockComment];

  const mockStats = {
    total: 5,
    upvotes: 12,
  };

  const authenticatedReq = (userId = "user-1") => ({
    user: { id: userId, email: "test@example.com" },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommentsController],
      providers: [
        {
          provide: CommentsService,
          useValue: {
            createComment: jest.fn().mockResolvedValue(mockComment),
            getResourceComments: jest.fn().mockResolvedValue(mockCommentList),
            getSourceComments: jest.fn().mockResolvedValue(mockCommentList),
            getSourceCommentStats: jest.fn().mockResolvedValue(mockStats),
            getComment: jest.fn().mockResolvedValue(mockComment),
            updateComment: jest.fn().mockResolvedValue(mockComment),
            deleteComment: jest.fn().mockResolvedValue(undefined),
            upvoteComment: jest
              .fn()
              .mockResolvedValue({ ...mockComment, upvotes: 1 }),
            getCommentStats: jest.fn().mockResolvedValue(mockStats),
          },
        },
      ],
    }).compile();

    controller = module.get<CommentsController>(CommentsController);
    commentsService = module.get(CommentsService);
  });

  describe("createComment", () => {
    it("should create a comment for authenticated user", async () => {
      const req = authenticatedReq();
      const dto: CreateCommentDto = {
        content: "New comment",
        resourceId: "resource-1",
      } as unknown as CreateCommentDto;

      const result = await controller.createComment(req, dto);
      expect(commentsService.createComment).toHaveBeenCalledWith("user-1", dto);
      expect(result).toBe(mockComment);
    });

    it("should throw UnauthorizedException when user id is missing", async () => {
      const req = { user: { id: "", email: "" } };
      const dto = {} as unknown as CreateCommentDto;

      await expect(controller.createComment(req, dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe("getResourceComments", () => {
    it("should return comments for a resource", async () => {
      const result = await controller.getResourceComments("resource-1");
      expect(commentsService.getResourceComments).toHaveBeenCalledWith(
        "resource-1",
      );
      expect(result).toBe(mockCommentList);
    });
  });

  describe("getSourceComments", () => {
    it("should return comments for a source", async () => {
      const result = await controller.getSourceComments("youtube-video-123");
      expect(commentsService.getSourceComments).toHaveBeenCalledWith(
        "youtube-video-123",
      );
      expect(result).toBe(mockCommentList);
    });
  });

  describe("getSourceCommentStats", () => {
    it("should return comment stats for a source", async () => {
      const result =
        await controller.getSourceCommentStats("youtube-video-123");
      expect(commentsService.getSourceCommentStats).toHaveBeenCalledWith(
        "youtube-video-123",
      );
      expect(result).toBe(mockStats);
    });
  });

  describe("getComment", () => {
    it("should return a single comment by id", async () => {
      const result = await controller.getComment("comment-1");
      expect(commentsService.getComment).toHaveBeenCalledWith("comment-1");
      expect(result).toBe(mockComment);
    });
  });

  describe("updateComment", () => {
    it("should update a comment for authenticated user", async () => {
      const req = authenticatedReq();
      const dto: UpdateCommentDto = {
        content: "Updated content",
      } as unknown as UpdateCommentDto;

      const result = await controller.updateComment("comment-1", req, dto);
      expect(commentsService.updateComment).toHaveBeenCalledWith(
        "comment-1",
        "user-1",
        dto,
      );
      expect(result).toBe(mockComment);
    });

    it("should throw UnauthorizedException when user id is missing", async () => {
      const req = { user: { id: "", email: "" } };
      const dto = {} as unknown as UpdateCommentDto;

      await expect(
        controller.updateComment("comment-1", req, dto),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("deleteComment", () => {
    it("should delete a comment for authenticated user", async () => {
      const req = authenticatedReq();
      await controller.deleteComment("comment-1", req);
      expect(commentsService.deleteComment).toHaveBeenCalledWith(
        "comment-1",
        "user-1",
      );
    });

    it("should throw UnauthorizedException when user id is missing", async () => {
      const req = { user: { id: "", email: "" } };
      await expect(controller.deleteComment("comment-1", req)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe("upvoteComment", () => {
    it("should upvote a comment", async () => {
      const result = await controller.upvoteComment("comment-1");
      expect(commentsService.upvoteComment).toHaveBeenCalledWith("comment-1");
      expect(result).toEqual({ ...mockComment, upvotes: 1 });
    });
  });

  describe("getCommentStats", () => {
    it("should return comment statistics for a resource", async () => {
      const result = await controller.getCommentStats("resource-1");
      expect(commentsService.getCommentStats).toHaveBeenCalledWith(
        "resource-1",
      );
      expect(result).toBe(mockStats);
    });
  });
});
