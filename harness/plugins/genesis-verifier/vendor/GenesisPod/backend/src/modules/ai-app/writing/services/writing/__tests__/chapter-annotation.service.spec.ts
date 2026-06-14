/**
 * Unit tests for ChapterAnnotationService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { ChapterAnnotationService } from "../chapter-annotation.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { AnnotationStatus } from "@prisma/client";

function buildMockPrisma() {
  return {
    writingChapter: {
      findUnique: jest.fn(),
    },
    chapterAnnotation: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };
}

describe("ChapterAnnotationService", () => {
  let service: ChapterAnnotationService;
  let prisma: ReturnType<typeof buildMockPrisma>;

  const mockChapterWithAccess = {
    id: "chapter-1",
    volume: {
      project: { ownerId: "user-1" },
    },
    content: "Chapter content",
  };

  const mockAnnotation = {
    id: "annotation-1",
    chapterId: "chapter-1",
    startOffset: 0,
    endOffset: 50,
    content: "This needs improvement",
    type: "COMMENT",
    status: "OPEN",
    selectedText: "sample text",
    createdAt: new Date(),
    resolvedAt: null,
  };

  beforeEach(async () => {
    prisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterAnnotationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ChapterAnnotationService>(ChapterAnnotationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getAnnotations", () => {
    it("should return annotations for authorized user", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterAnnotation.findMany.mockResolvedValue([mockAnnotation]);
      prisma.chapterAnnotation.count.mockResolvedValue(1);

      const result = await service.getAnnotations("chapter-1", "user-1");

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("should throw NotFoundException when chapter not found", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(null);

      await expect(
        service.getAnnotations("missing-chapter", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException for unauthorized user", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue({
        ...mockChapterWithAccess,
        volume: { project: { ownerId: "other-user" } },
      });

      await expect(
        service.getAnnotations("chapter-1", "user-1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should filter by status when provided", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterAnnotation.findMany.mockResolvedValue([]);
      prisma.chapterAnnotation.count.mockResolvedValue(0);

      await service.getAnnotations(
        "chapter-1",
        "user-1",
        AnnotationStatus.RESOLVED,
      );

      expect(prisma.chapterAnnotation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: AnnotationStatus.RESOLVED,
          }),
        }),
      );
    });
  });

  describe("createAnnotation", () => {
    it("should create annotation for authorized user", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterAnnotation.create.mockResolvedValue(mockAnnotation);

      const result = await service.createAnnotation("chapter-1", "user-1", {
        startOffset: 0,
        endOffset: 50,
        content: "This needs improvement",
        type: "COMMENT",
        selectedText: "sample text",
      });

      expect(result.id).toBe("annotation-1");
      expect(result.content).toBe("This needs improvement");
    });

    it("should use COMMENT as default type", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterAnnotation.create.mockResolvedValue({
        ...mockAnnotation,
        type: "COMMENT",
      });

      await service.createAnnotation("chapter-1", "user-1", {
        startOffset: 0,
        endOffset: 10,
        content: "Note",
      });

      expect(prisma.chapterAnnotation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "COMMENT",
          }),
        }),
      );
    });
  });

  describe("updateAnnotation", () => {
    const mockAnnotationWithAccess = {
      ...mockAnnotation,
      chapter: {
        volume: {
          project: { ownerId: "user-1" },
        },
      },
    };

    it("should update annotation content", async () => {
      prisma.chapterAnnotation.findUnique.mockResolvedValue(
        mockAnnotationWithAccess,
      );
      prisma.chapterAnnotation.update.mockResolvedValue({
        ...mockAnnotation,
        content: "Updated comment",
      });

      const result = await service.updateAnnotation("annotation-1", "user-1", {
        content: "Updated comment",
      });

      expect(result.content).toBe("Updated comment");
    });

    it("should set resolvedAt when status is RESOLVED", async () => {
      prisma.chapterAnnotation.findUnique.mockResolvedValue(
        mockAnnotationWithAccess,
      );
      prisma.chapterAnnotation.update.mockResolvedValue({
        ...mockAnnotation,
        status: "RESOLVED",
        resolvedAt: new Date(),
      });

      await service.updateAnnotation("annotation-1", "user-1", {
        status: AnnotationStatus.RESOLVED,
      });

      const updateCall = prisma.chapterAnnotation.update.mock.calls[0][0];
      expect(updateCall.data.resolvedAt).toBeDefined();
    });

    it("should throw NotFoundException when annotation not found", async () => {
      prisma.chapterAnnotation.findUnique.mockResolvedValue(null);

      await expect(
        service.updateAnnotation("missing", "user-1", { content: "test" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("deleteAnnotation", () => {
    it("should delete annotation for authorized user", async () => {
      prisma.chapterAnnotation.findUnique.mockResolvedValue({
        ...mockAnnotation,
        chapter: {
          volume: { project: { ownerId: "user-1" } },
        },
      });
      prisma.chapterAnnotation.delete.mockResolvedValue(mockAnnotation);

      await service.deleteAnnotation("annotation-1", "user-1");

      expect(prisma.chapterAnnotation.delete).toHaveBeenCalledWith({
        where: { id: "annotation-1" },
      });
    });
  });

  describe("resolveAnnotations", () => {
    it("should bulk resolve annotations", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterAnnotation.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.resolveAnnotations("chapter-1", "user-1", [
        "annotation-1",
        "annotation-2",
        "annotation-3",
      ]);

      expect(result.resolved).toBe(3);
      expect(prisma.chapterAnnotation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AnnotationStatus.RESOLVED,
          }),
        }),
      );
    });
  });

  describe("getAnnotationStats", () => {
    it("should return correct stats grouped by status and type", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterAnnotation.findMany.mockResolvedValue([
        { status: "OPEN", type: "COMMENT" },
        { status: "OPEN", type: "SUGGESTION" },
        { status: "RESOLVED", type: "COMMENT" },
      ]);

      const result = await service.getAnnotationStats("chapter-1", "user-1");

      expect(result.total).toBe(3);
      expect(result.byStatus["OPEN"]).toBe(2);
      expect(result.byStatus["RESOLVED"]).toBe(1);
      expect(result.byType["COMMENT"]).toBe(2);
    });
  });
});
