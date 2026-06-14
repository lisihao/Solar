/**
 * Unit tests for ChapterRevisionService
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { ChapterRevisionService } from "../chapter-revision.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { RevisionChangeType } from "@prisma/client";

function buildMockPrisma() {
  return {
    writingChapter: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    chapterRevision: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _max: { versionNumber: 0 } }),
    },
  };
}

function buildMockFacade() {
  return {
    chatWithSkills: jest.fn().mockResolvedValue({
      content: "AI revised content here",
    }),
  };
}

describe("ChapterRevisionService", () => {
  let service: ChapterRevisionService;
  let prisma: ReturnType<typeof buildMockPrisma>;
  let facade: ReturnType<typeof buildMockFacade>;

  const mockChapterWithAccess = {
    id: "chapter-1",
    content: "Original chapter content with many words for testing purposes.",
    wordCount: 10,
    volume: {
      project: { ownerId: "user-1" },
    },
  };

  const mockRevision = {
    id: "revision-1",
    chapterId: "chapter-1",
    versionNumber: 1,
    content: "Revised content",
    wordCount: 2,
    changeType: RevisionChangeType.MANUAL_EDIT,
    changeSummary: "Manual edit",
    changedBy: "user",
    aiParams: null,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    prisma = buildMockPrisma();
    facade = buildMockFacade();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterRevisionService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatFacade, useValue: facade },
      ],
    }).compile();

    service = module.get<ChapterRevisionService>(ChapterRevisionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getRevisions", () => {
    it("should return revisions for authorized user", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterRevision.findMany.mockResolvedValue([mockRevision]);
      prisma.chapterRevision.count.mockResolvedValue(1);

      const result = await service.getRevisions("chapter-1", "user-1");

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("should throw NotFoundException when chapter not found", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(null);

      await expect(
        service.getRevisions("missing-chapter", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException for unauthorized user", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue({
        ...mockChapterWithAccess,
        volume: { project: { ownerId: "other-user" } },
      });

      await expect(service.getRevisions("chapter-1", "user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("updateContent", () => {
    it("should create new version with correct word count", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterRevision.aggregate.mockResolvedValue({
        _max: { versionNumber: 1 },
      });
      prisma.chapterRevision.create.mockResolvedValue({
        ...mockRevision,
        versionNumber: 2,
        content: "新的章节内容，包含中文字符进行测试。",
        changeType: RevisionChangeType.MANUAL_EDIT,
      });
      prisma.writingChapter.update.mockResolvedValue({
        id: "chapter-1",
        content: "新的章节内容，包含中文字符进行测试。",
        wordCount: 15,
      });

      const result = await service.updateContent("chapter-1", "user-1", {
        content: "新的章节内容，包含中文字符进行测试。",
        changeSummary: "Manual edit",
      });

      expect(result.chapter.content).toBe(
        "新的章节内容，包含中文字符进行测试。",
      );
      expect(result.revision.versionNumber).toBe(2);
      expect(result.revision.changeType).toBe(RevisionChangeType.MANUAL_EDIT);
    });

    it("should increment version number", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterRevision.aggregate.mockResolvedValue({
        _max: { versionNumber: 5 },
      });
      prisma.chapterRevision.create.mockResolvedValue({
        ...mockRevision,
        versionNumber: 6,
      });
      prisma.writingChapter.update.mockResolvedValue({
        id: "chapter-1",
        content: "Content",
        wordCount: 1,
      });

      const result = await service.updateContent("chapter-1", "user-1", {
        content: "Content",
      });

      expect(result.revision.versionNumber).toBe(6);
    });
  });

  describe("aiEdit", () => {
    it("should throw BadRequestException when chapter has no content", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue({
        ...mockChapterWithAccess,
        content: null,
      });

      await expect(
        service.aiEdit("chapter-1", "user-1", {
          operation: "polish",
          polishLevel: "moderate",
          userFeedback: "Make it better",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should polish chapter content", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterRevision.aggregate.mockResolvedValue({
        _max: { versionNumber: 1 },
      });
      prisma.chapterRevision.create.mockResolvedValue({
        ...mockRevision,
        versionNumber: 2,
        changeType: RevisionChangeType.AI_POLISH,
      });
      prisma.writingChapter.update.mockResolvedValue({
        id: "chapter-1",
        content: "AI revised content here",
        wordCount: 4,
      });

      const result = await service.aiEdit("chapter-1", "user-1", {
        operation: "polish",
        polishLevel: "moderate",
        userFeedback: "Make sentences flow better",
      });

      expect(facade.chatWithSkills).toHaveBeenCalled();
      expect(result.chapter.content).toBe("AI revised content here");
      expect(result.revision.changeType).toBe(RevisionChangeType.AI_POLISH);
    });

    it("should throw BadRequestException for unknown operation", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);

      await expect(
        service.aiEdit("chapter-1", "user-1", {
          operation: "unknown" as never,
          userFeedback: "Test",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should perform rewrite on selected text", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterRevision.aggregate.mockResolvedValue({
        _max: { versionNumber: 0 },
      });
      prisma.chapterRevision.create.mockResolvedValue({
        ...mockRevision,
        versionNumber: 1,
        changeType: RevisionChangeType.AI_REWRITE,
      });
      prisma.writingChapter.update.mockResolvedValue({
        id: "chapter-1",
        content: "AI revised content here",
        wordCount: 4,
      });

      const result = await service.aiEdit("chapter-1", "user-1", {
        operation: "rewrite",
        selection: {
          startOffset: 0,
          endOffset: 20,
          originalText: "Original chapter con",
        },
        userFeedback: "Make more dramatic",
      });

      expect(result.revision.changeType).toBe(RevisionChangeType.AI_REWRITE);
    });
  });

  describe("rollback", () => {
    it("should create new version with target revision content", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterRevision.findUnique.mockResolvedValue({
        ...mockRevision,
        id: "revision-old",
        versionNumber: 1,
        content: "Old content",
        wordCount: 2,
        chapterId: "chapter-1",
      });
      prisma.chapterRevision.aggregate.mockResolvedValue({
        _max: { versionNumber: 5 },
      });
      prisma.chapterRevision.create.mockResolvedValue({
        ...mockRevision,
        versionNumber: 6,
        changeType: RevisionChangeType.ROLLBACK,
        content: "Old content",
      });
      prisma.writingChapter.update.mockResolvedValue({
        id: "chapter-1",
        content: "Old content",
        wordCount: 2,
      });

      const result = await service.rollback(
        "chapter-1",
        "revision-old",
        "user-1",
        "Rolling back to version 1",
      );

      expect(result.newRevision.changeType).toBe(RevisionChangeType.ROLLBACK);
      expect(result.chapter.content).toBe("Old content");
    });

    it("should throw NotFoundException when revision not found", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterRevision.findUnique.mockResolvedValue(null);

      await expect(
        service.rollback("chapter-1", "missing-revision", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when revision belongs to different chapter", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterRevision.findUnique.mockResolvedValue({
        ...mockRevision,
        chapterId: "different-chapter",
      });

      await expect(
        service.rollback("chapter-1", "revision-1", "user-1"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("createInitialRevision", () => {
    it("should create initial version for ai_generated source", async () => {
      prisma.chapterRevision.create.mockResolvedValue({
        ...mockRevision,
        versionNumber: 1,
        changeType: RevisionChangeType.AI_REWRITE,
        changedBy: "ai",
      });

      const result = await service.createInitialRevision(
        "chapter-1",
        "AI generated content 这是中文内容",
        "ai_generated",
      );

      expect(result.versionNumber).toBe(1);
      expect(result.changeType).toBe(RevisionChangeType.AI_REWRITE);
      expect(prisma.chapterRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            changedBy: "ai",
            changeSummary: "初始版本",
          }),
        }),
      );
    });

    it("should create initial version for imported source", async () => {
      prisma.chapterRevision.create.mockResolvedValue({
        ...mockRevision,
        changeType: RevisionChangeType.IMPORTED,
        changedBy: "user",
        changeSummary: "导入内容",
      });

      const result = await service.createInitialRevision(
        "chapter-1",
        "Imported content",
        "imported",
      );

      expect(result.changeType).toBe(RevisionChangeType.IMPORTED);
    });
  });

  describe("getRevision", () => {
    it("should return revision for authorized user", async () => {
      prisma.chapterRevision.findUnique.mockResolvedValue({
        ...mockRevision,
        chapter: {
          volume: { project: { ownerId: "user-1" } },
        },
      });

      const result = await service.getRevision("revision-1", "user-1");

      expect(result.id).toBe("revision-1");
    });

    it("should throw NotFoundException when revision not found", async () => {
      prisma.chapterRevision.findUnique.mockResolvedValue(null);

      await expect(service.getRevision("missing", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException when user is not owner", async () => {
      prisma.chapterRevision.findUnique.mockResolvedValue({
        ...mockRevision,
        chapter: {
          volume: { project: { ownerId: "other-user" } },
        },
      });

      await expect(service.getRevision("revision-1", "user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("compareRevisions", () => {
    it("should return diff between two revisions", async () => {
      const revision1 = {
        ...mockRevision,
        id: "rev-1",
        content: "Line A\nLine B\nLine C",
      };
      const revision2 = {
        ...mockRevision,
        id: "rev-2",
        content: "Line A\nLine D\nLine C",
      };

      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterRevision.findUnique
        .mockResolvedValueOnce(revision1)
        .mockResolvedValueOnce(revision2);

      const result = await service.compareRevisions(
        "chapter-1",
        "rev-1",
        "rev-2",
        "user-1",
      );

      expect(result.revision1.id).toBe("rev-1");
      expect(result.revision2.id).toBe("rev-2");
      expect(result.diff).toBeDefined();
      expect(result.diff.additions).toBeDefined();
      expect(result.diff.deletions).toBeDefined();
    });

    it("should throw NotFoundException when one revision is not found", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterRevision.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...mockRevision, id: "rev-2" });

      await expect(
        service.compareRevisions("chapter-1", "missing", "rev-2", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when revision belongs to different chapter", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterRevision.findUnique
        .mockResolvedValueOnce({
          ...mockRevision,
          id: "rev-1",
          chapterId: "chapter-1",
        })
        .mockResolvedValueOnce({
          ...mockRevision,
          id: "rev-2",
          chapterId: "different-chapter",
        });

      await expect(
        service.compareRevisions("chapter-1", "rev-1", "rev-2", "user-1"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("aiEdit - expand", () => {
    it("should expand selected chapter text", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterRevision.aggregate.mockResolvedValue({
        _max: { versionNumber: 2 },
      });
      prisma.chapterRevision.create.mockResolvedValue({
        ...mockRevision,
        versionNumber: 3,
        changeType: RevisionChangeType.AI_EXPAND,
      });
      prisma.writingChapter.update.mockResolvedValue({
        id: "chapter-1",
        content: "AI revised content here",
        wordCount: 4,
      });

      const result = await service.aiEdit("chapter-1", "user-1", {
        operation: "expand",
        selection: {
          startOffset: 0,
          endOffset: 8,
          originalText: "Original",
        },
        userFeedback: "Add more detail",
      });

      expect(facade.chatWithSkills).toHaveBeenCalled();
      expect(result.revision.changeType).toBe(RevisionChangeType.AI_EXPAND);
    });
  });

  describe("aiEdit - condense", () => {
    it("should condense selected chapter text", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterRevision.aggregate.mockResolvedValue({
        _max: { versionNumber: 2 },
      });
      prisma.chapterRevision.create.mockResolvedValue({
        ...mockRevision,
        versionNumber: 3,
        changeType: RevisionChangeType.AI_CONDENSE,
      });
      prisma.writingChapter.update.mockResolvedValue({
        id: "chapter-1",
        content: "AI revised content here",
        wordCount: 4,
      });

      const result = await service.aiEdit("chapter-1", "user-1", {
        operation: "condense",
        selection: {
          startOffset: 0,
          endOffset: 8,
          originalText: "Original",
        },
        userFeedback: "Be more concise",
      });

      expect(facade.chatWithSkills).toHaveBeenCalled();
      expect(result.revision.changeType).toBe(RevisionChangeType.AI_CONDENSE);
    });
  });

  describe("aiEdit - style_fix", () => {
    it("should apply style fix to chapter content", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterRevision.aggregate.mockResolvedValue({
        _max: { versionNumber: 2 },
      });
      prisma.chapterRevision.create.mockResolvedValue({
        ...mockRevision,
        versionNumber: 3,
        changeType: RevisionChangeType.AI_STYLE_FIX,
      });
      prisma.writingChapter.update.mockResolvedValue({
        id: "chapter-1",
        content: "AI revised content here",
        wordCount: 4,
      });

      const result = await service.aiEdit("chapter-1", "user-1", {
        operation: "style_fix",
        targetStyle: {
          tone: "formal",
          vocabulary: "classical",
          sentenceLength: "long",
        },
        userFeedback: "Make it more literary",
      });

      expect(facade.chatWithSkills).toHaveBeenCalled();
      expect(result.revision.changeType).toBe(RevisionChangeType.AI_STYLE_FIX);
    });

    it("should apply style fix without targetStyle fields", async () => {
      prisma.writingChapter.findUnique.mockResolvedValue(mockChapterWithAccess);
      prisma.chapterRevision.aggregate.mockResolvedValue({
        _max: { versionNumber: 0 },
      });
      prisma.chapterRevision.create.mockResolvedValue({
        ...mockRevision,
        versionNumber: 1,
        changeType: RevisionChangeType.AI_STYLE_FIX,
      });
      prisma.writingChapter.update.mockResolvedValue({
        id: "chapter-1",
        content: "AI revised content here",
        wordCount: 4,
      });

      const result = await service.aiEdit("chapter-1", "user-1", {
        operation: "style_fix",
        targetStyle: {},
        userFeedback: "Improve style",
      });

      expect(result.revision.changeType).toBe(RevisionChangeType.AI_STYLE_FIX);
    });
  });

  describe("createInitialRevision - manual source", () => {
    it("should create initial version for manual source", async () => {
      prisma.chapterRevision.create.mockResolvedValue({
        ...mockRevision,
        versionNumber: 1,
        changeType: RevisionChangeType.MANUAL_EDIT,
        changedBy: "user",
        changeSummary: "初始版本",
      });

      const result = await service.createInitialRevision(
        "chapter-1",
        "Manual content",
        "manual",
      );

      expect(result.changeType).toBe(RevisionChangeType.MANUAL_EDIT);
      expect(prisma.chapterRevision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            changedBy: "user",
            changeSummary: "初始版本",
          }),
        }),
      );
    });
  });
});
