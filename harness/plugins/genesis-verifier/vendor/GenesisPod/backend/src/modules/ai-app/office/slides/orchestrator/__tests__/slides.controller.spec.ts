/**
 * SlidesController Extended Unit Tests
 *
 * Supplements the existing spec in __tests__/unit/slides.controller.spec.ts
 * focusing on uncovered endpoints:
 * - getThemesList
 * - getCheckpoints / createCheckpoint / getCheckpoint
 * - restoreCheckpoint
 * - rerenderPage
 * - getSession / updateSession / deleteSession
 * - exportSlides
 * - archiveSession / pruneCheckpoints
 * - updateSubscription
 * - importFromXxx / listXxxSources
 * - chatEdit / polishContent / factCheck
 * - generateNarrations
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { Test, TestingModule } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import {
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { SlidesController } from "../slides.controller";
import { SlidesEngineService } from "../../services/slides-engine.service";
import { SlidesDataImportService } from "../../services/data-import.service";
import { AIEditService } from "../../services/ai-edit.service";
import { SlidesCheckpointService } from "../../checkpoint/checkpoint.service";
import { VoiceNarrationSkill } from "../../skills/voice-narration.skill";
import { PrismaService } from "@/common/prisma/prisma.service";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { RateLimitGuard } from "@/common/guards/rate-limit.guard";

import {
  mockAuthenticatedRequest,
  mockUserId,
} from "../../__tests__/fixtures/slides.fixture";

// ============================================================================
// Mock factories
// ============================================================================

function buildMocks() {
  const slidesEngine = {
    generateSlides: jest.fn(),
    restoreCheckpoint: jest.fn(),
    regeneratePage: jest.fn(),
    exportPptx: jest.fn(),
    exportPdf: jest.fn(),
    getSessionState: jest.fn(),
    regenerateSlide: jest.fn(),
  };

  const checkpointService = {
    getSessions: jest.fn().mockResolvedValue([]),
    getSession: jest.fn().mockResolvedValue(null),
    createSession: jest.fn(),
    updateSessionTitle: jest.fn(),
    deleteSession: jest.fn(),
    updateSessionStatus: jest.fn(),
    getLatestCheckpoint: jest.fn().mockResolvedValue(null),
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    restore: jest.fn(),
    get: jest.fn(),
    prune: jest.fn().mockResolvedValue(5),
  };

  const dataImportService = {
    listResearchTopics: jest.fn().mockResolvedValue([]),
    listWritingProjects: jest.fn().mockResolvedValue([]),
    listTeamsTopics: jest.fn().mockResolvedValue([]),
    listLibraryResources: jest.fn().mockResolvedValue([]),
    importFromResearch: jest.fn(),
    importFromResearchProject: jest.fn(),
    importFromWriting: jest.fn(),
    importFromTeams: jest.fn(),
    importFromLibrary: jest.fn(),
    listResearchProjects: jest.fn().mockResolvedValue([]),
  };

  const aiEditService = {
    fixLayout: jest.fn(),
    polishContent: jest.fn(),
    factCheck: jest.fn(),
    chatEdit: jest.fn(),
  };

  const voiceNarrationSkill = {
    execute: jest.fn(),
    id: "voice-narration",
    generateNarrations: jest.fn(),
  };

  const prismaService = {
    slidesMission: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue(null),
    },
    slidesNarration: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  };

  return {
    slidesEngine,
    checkpointService,
    dataImportService,
    aiEditService,
    voiceNarrationSkill,
    prismaService,
  };
}

// ============================================================================
// Test setup
// ============================================================================

async function buildController(mocks: ReturnType<typeof buildMocks>) {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [SlidesController],
    providers: [
      { provide: SlidesEngineService, useValue: mocks.slidesEngine },
      { provide: SlidesCheckpointService, useValue: mocks.checkpointService },
      { provide: SlidesDataImportService, useValue: mocks.dataImportService },
      { provide: AIEditService, useValue: mocks.aiEditService },
      { provide: VoiceNarrationSkill, useValue: mocks.voiceNarrationSkill },
      { provide: PrismaService, useValue: mocks.prismaService },
      { provide: Reflector, useValue: new Reflector() },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({ canActivate: jest.fn().mockReturnValue(true) })
    .overrideGuard(RateLimitGuard)
    .useValue({ canActivate: jest.fn().mockReturnValue(true) })
    .compile();

  return module.get<SlidesController>(SlidesController);
}

// ============================================================================
// Tests
// ============================================================================

describe("SlidesController (extended)", () => {
  let controller: SlidesController;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();
    controller = await buildController(mocks);
  });

  // --------------------------------------------------------------------------
  // getThemesList
  // --------------------------------------------------------------------------

  describe("getThemesList()", () => {
    it("should return list of available themes", async () => {
      const result = await controller.getThemesList();

      expect(result).toHaveProperty("themes");
      expect(Array.isArray((result as { themes: unknown[] }).themes)).toBe(
        true,
      );
    });

    it("should include theme id, name, colors in each theme", async () => {
      const result = (await controller.getThemesList()) as {
        themes: Array<{
          id: string;
          name: string;
          colors: { primary: string; accent: string; text: string };
        }>;
      };

      result.themes.forEach((theme) => {
        expect(theme.id).toBeTruthy();
        expect(theme.name).toBeTruthy();
        expect(theme.colors).toBeDefined();
      });
    });
  });

  // --------------------------------------------------------------------------
  // getCheckpoints
  // --------------------------------------------------------------------------

  describe("getCheckpoints()", () => {
    it("should return checkpoints for a session", async () => {
      mocks.checkpointService.list.mockResolvedValue([
        { id: "ckpt-1", type: "page_rendered", sessionId: "session-1" },
      ] as never);

      const result = await controller.getCheckpoints("session-1");

      expect(mocks.checkpointService.list).toHaveBeenCalledWith({
        sessionId: "session-1",
      });
      expect((result as { checkpoints: unknown[] }).checkpoints).toHaveLength(
        1,
      );
    });

    it("should apply limit query parameter", async () => {
      const manyCheckpoints = Array.from({ length: 20 }, (_, i) => ({
        id: `ckpt-${i}`,
        type: "page_rendered",
      }));
      mocks.checkpointService.list.mockResolvedValue(manyCheckpoints as never);

      const result = await controller.getCheckpoints("session-1", "5");

      expect((result as { checkpoints: unknown[] }).checkpoints).toHaveLength(
        5,
      );
    });

    it("should throw InternalServerErrorException on service error", async () => {
      mocks.checkpointService.list.mockRejectedValue(
        new Error("DB error") as never,
      );

      await expect(controller.getCheckpoints("session-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // createCheckpoint
  // --------------------------------------------------------------------------

  describe("createCheckpoint()", () => {
    it("should throw BadRequestException when no existing checkpoint found", async () => {
      mocks.checkpointService.getLatestCheckpoint.mockResolvedValue(
        null as never,
      );

      await expect(
        controller.createCheckpoint("session-1", { name: "My Checkpoint" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should create checkpoint using latest state", async () => {
      const latestCheckpoint = {
        id: "ckpt-latest",
        state: { pages: [], conversation: [] },
        type: "page_rendered",
      };
      mocks.checkpointService.getLatestCheckpoint.mockResolvedValue(
        latestCheckpoint as never,
      );
      mocks.checkpointService.create.mockResolvedValue({
        id: "ckpt-new",
        name: "My Checkpoint",
        type: "user_modified",
        version: "1.0.0",
        timestamp: new Date(),
      } as never);

      const result = await controller.createCheckpoint("session-1", {
        name: "My Checkpoint",
        type: "user_modified",
      });

      expect(mocks.checkpointService.create).toHaveBeenCalled();
      expect((result as { checkpoint: { name: string } }).checkpoint.name).toBe(
        "My Checkpoint",
      );
    });
  });

  // --------------------------------------------------------------------------
  // getCheckpoint
  // --------------------------------------------------------------------------

  describe("getCheckpoint()", () => {
    it("should return checkpoint state", async () => {
      mocks.checkpointService.get.mockResolvedValue({
        id: "ckpt-abc",
        sessionId: "session-1",
        state: { pages: [{ pageNumber: 1 }], conversation: [] },
      } as never);

      const result = await controller.getCheckpoint("ckpt-abc");

      expect((result as { checkpointId: string }).checkpointId).toBe(
        "ckpt-abc",
      );
      expect((result as { sessionId: string }).sessionId).toBe("session-1");
    });

    it("should throw NotFoundException when checkpoint not found", async () => {
      mocks.checkpointService.get.mockRejectedValue(
        new NotFoundException("Checkpoint not found") as never,
      );

      await expect(controller.getCheckpoint("missing")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // restoreCheckpoint
  // --------------------------------------------------------------------------

  describe("restoreCheckpoint()", () => {
    it("should restore checkpoint and return session info", async () => {
      mocks.slidesEngine.restoreCheckpoint.mockResolvedValue({
        sessionId: "session-restored",
        state: { pages: [{ pageNumber: 1 }], conversation: [] },
      } as never);
      mocks.checkpointService.getSession.mockResolvedValue({
        id: "session-restored",
        title: "Restored Presentation",
      } as never);

      const result = await controller.restoreCheckpoint("ckpt-xyz");

      expect((result as { message: string }).message).toBe(
        "Checkpoint restored successfully",
      );
      expect((result as { sessionId: string }).sessionId).toBe(
        "session-restored",
      );
    });

    it("should throw InternalServerErrorException on failure", async () => {
      mocks.slidesEngine.restoreCheckpoint.mockRejectedValue(
        new Error("Restore failed") as never,
      );

      await expect(controller.restoreCheckpoint("ckpt-fail")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // rerenderPage
  // --------------------------------------------------------------------------

  describe("rerenderPage()", () => {
    it("should return regenerated page events", async () => {
      mocks.slidesEngine.regeneratePage.mockResolvedValue([
        { type: "slide:generated", data: { pageNumber: 2 } },
      ] as never);

      const result = await controller.rerenderPage("session-1", "2", {
        feedback: "Make it more visual",
      });

      expect(mocks.slidesEngine.regeneratePage).toHaveBeenCalledWith(
        "session-1",
        2,
        "Make it more visual",
      );
      expect((result as { events: unknown[] }).events).toHaveLength(1);
    });

    it("should throw InternalServerErrorException on failure", async () => {
      mocks.slidesEngine.regeneratePage.mockRejectedValue(
        new Error("Rerender failed") as never,
      );

      await expect(
        controller.rerenderPage("session-1", "1", {}),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // getSession
  // --------------------------------------------------------------------------

  describe("getSession()", () => {
    it("should return session with latest checkpoint", async () => {
      mocks.checkpointService.getSession.mockResolvedValue({
        id: "session-1",
        title: "Test",
        status: "active",
      } as never);
      mocks.checkpointService.getLatestCheckpoint.mockResolvedValue({
        id: "ckpt-1",
        type: "page_rendered",
        timestamp: new Date(),
        state: { pages: [{ pageNumber: 1 }] },
      } as never);
      mocks.prismaService.slidesMission.findFirst.mockResolvedValue(null);

      const result = await controller.getSession("session-1");

      expect((result as { session: { id: string } }).session.id).toBe(
        "session-1",
      );
    });

    it("should throw NotFoundException when session not found", async () => {
      mocks.checkpointService.getSession.mockResolvedValue(null as never);

      await expect(controller.getSession("missing-session")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // updateSession
  // --------------------------------------------------------------------------

  describe("updateSession()", () => {
    it("should update session title", async () => {
      const updatedSession = { id: "session-1", title: "New Title" };
      mocks.checkpointService.updateSessionTitle.mockResolvedValue(
        updatedSession as never,
      );

      const result = await controller.updateSession("session-1", {
        title: "New Title",
      });

      expect(mocks.checkpointService.updateSessionTitle).toHaveBeenCalledWith(
        "session-1",
        "New Title",
      );
      expect((result as { session: typeof updatedSession }).session).toEqual(
        updatedSession,
      );
    });

    it("should throw InternalServerErrorException on failure", async () => {
      mocks.checkpointService.updateSessionTitle.mockRejectedValue(
        new Error("Update failed") as never,
      );

      await expect(
        controller.updateSession("session-1", { title: "Title" }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // deleteSession
  // --------------------------------------------------------------------------

  describe("deleteSession()", () => {
    it("should delete session and return success message", async () => {
      mocks.checkpointService.deleteSession.mockResolvedValue(
        undefined as never,
      );

      const result = await controller.deleteSession("session-1");

      expect(mocks.checkpointService.deleteSession).toHaveBeenCalledWith(
        "session-1",
      );
      expect((result as { message: string }).message).toContain("deleted");
    });

    it("should throw InternalServerErrorException on failure", async () => {
      mocks.checkpointService.deleteSession.mockRejectedValue(
        new Error("Delete failed") as never,
      );

      await expect(controller.deleteSession("session-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // archiveSession
  // --------------------------------------------------------------------------

  describe("archiveSession()", () => {
    it("should archive session", async () => {
      mocks.checkpointService.updateSessionStatus.mockResolvedValue(
        undefined as never,
      );

      const result = await controller.archiveSession("session-1");

      expect(mocks.checkpointService.updateSessionStatus).toHaveBeenCalledWith(
        "session-1",
        "archived",
      );
      expect((result as { message: string }).message).toContain("archived");
    });

    it("should throw InternalServerErrorException on failure", async () => {
      mocks.checkpointService.updateSessionStatus.mockRejectedValue(
        new Error("Archive failed") as never,
      );

      await expect(controller.archiveSession("session-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // pruneCheckpoints
  // --------------------------------------------------------------------------

  describe("pruneCheckpoints()", () => {
    it("should prune checkpoints with default keepCount=10", async () => {
      mocks.checkpointService.prune.mockResolvedValue(3 as never);

      const result = await controller.pruneCheckpoints("session-1");

      expect(mocks.checkpointService.prune).toHaveBeenCalledWith(
        "session-1",
        10,
      );
      expect((result as { prunedCount: number }).prunedCount).toBe(3);
    });

    it("should prune with specified keepCount", async () => {
      mocks.checkpointService.prune.mockResolvedValue(7 as never);

      await controller.pruneCheckpoints("session-1", "5");

      expect(mocks.checkpointService.prune).toHaveBeenCalledWith(
        "session-1",
        5,
      );
    });
  });

  // --------------------------------------------------------------------------
  // exportSlides
  // --------------------------------------------------------------------------

  describe("exportSlides()", () => {
    it("should export pptx and set headers", async () => {
      const mockBuffer = Buffer.from("pptx-content");
      mocks.slidesEngine.exportPptx.mockResolvedValue(mockBuffer as never);

      const mockRes = {
        setHeader: jest.fn(),
        send: jest.fn(),
      };

      await controller.exportSlides(
        "session-1",
        { format: "pptx" },
        mockRes as unknown as import("express").Response,
      );

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
      expect(mockRes.send).toHaveBeenCalledWith(mockBuffer);
    });

    it("should export pdf and set headers", async () => {
      const mockBuffer = Buffer.from("pdf-content");
      mocks.slidesEngine.exportPdf.mockResolvedValue(mockBuffer as never);

      const mockRes = {
        setHeader: jest.fn(),
        send: jest.fn(),
      };

      await controller.exportSlides(
        "session-1",
        { format: "pdf" },
        mockRes as unknown as import("express").Response,
      );

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "application/pdf",
      );
      expect(mockRes.send).toHaveBeenCalledWith(mockBuffer);
    });

    it("should throw HttpException for unsupported format", async () => {
      const mockRes = {
        setHeader: jest.fn(),
        send: jest.fn(),
      };

      await expect(
        controller.exportSlides(
          "session-1",
          { format: "png" },
          mockRes as unknown as import("express").Response,
        ),
      ).rejects.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // updateSubscription
  // --------------------------------------------------------------------------

  describe("updateSubscription()", () => {
    it("should unsubscribe by setting sourceSubscription to null", async () => {
      mocks.prismaService.slidesMission.updateMany.mockResolvedValue({
        count: 1,
      });

      const result = await controller.updateSubscription(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        "session-1",
        { action: "unsubscribe" },
      );

      expect(mocks.prismaService.slidesMission.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: "session-1", userId: mockUserId },
          data: { sourceSubscription: Prisma.JsonNull },
        }),
      );
      expect((result as { success: boolean }).success).toBe(true);
    });

    it("should throw BadRequestException when refreshing without subscription", async () => {
      mocks.prismaService.slidesMission.findFirst.mockResolvedValue({
        id: "mission-1",
        sourceSubscription: null,
      });

      await expect(
        controller.updateSubscription(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "session-1",
          { action: "refresh" },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should refresh topic-insights subscription", async () => {
      mocks.prismaService.slidesMission.findFirst.mockResolvedValue({
        id: "mission-1",
        sourceSubscription: {
          type: "topic-insights",
          sourceId: "topic-abc",
          isStale: true,
        },
      });
      mocks.dataImportService.importFromResearch.mockResolvedValue({
        sourceText: "Updated content",
      } as never);
      mocks.prismaService.slidesMission.update.mockResolvedValue({} as never);

      const result = await controller.updateSubscription(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        "session-1",
        { action: "refresh" },
      );

      expect(mocks.dataImportService.importFromResearch).toHaveBeenCalledWith(
        "topic-abc",
        mockUserId,
      );
      expect((result as { success: boolean }).success).toBe(true);
      expect((result as { sourceText: string }).sourceText).toBe(
        "Updated content",
      );
    });

    it("should refresh research-project subscription", async () => {
      mocks.prismaService.slidesMission.findFirst.mockResolvedValue({
        id: "mission-1",
        sourceSubscription: {
          type: "research-project",
          sourceId: "project-xyz",
          isStale: false,
        },
      });
      mocks.dataImportService.importFromResearchProject.mockResolvedValue({
        sourceText: "Project content",
      } as never);
      mocks.prismaService.slidesMission.update.mockResolvedValue({} as never);

      await controller.updateSubscription(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        "session-1",
        { action: "refresh" },
      );

      expect(
        mocks.dataImportService.importFromResearchProject,
      ).toHaveBeenCalledWith("project-xyz", mockUserId);
    });
  });

  // --------------------------------------------------------------------------
  // Source listing endpoints
  // --------------------------------------------------------------------------

  describe("listXxxSources()", () => {
    it("should list writing sources", async () => {
      const sources = [{ id: "proj-1", name: "Writing Project" }];
      mocks.dataImportService.listWritingProjects.mockResolvedValue(
        sources as never,
      );

      const result = await controller.listWritingSources(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
      );

      expect(result).toEqual({ sources });
    });

    it("should list teams sources", async () => {
      const sources = [{ id: "topic-1", name: "Teams Topic" }];
      mocks.dataImportService.listTeamsTopics.mockResolvedValue(
        sources as never,
      );

      const result = await controller.listTeamsSources(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
      );

      expect(result).toEqual({ sources });
    });

    it("should list library sources with type filter", async () => {
      const sources = [{ id: "lib-1", name: "Library Resource" }];
      mocks.dataImportService.listLibraryResources.mockResolvedValue(
        sources as never,
      );

      const result = await controller.listLibrarySources(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        "document",
      );

      expect(mocks.dataImportService.listLibraryResources).toHaveBeenCalledWith(
        mockUserId,
        "document",
      );
      expect(result).toEqual({ sources });
    });

    it("should list research project sources", async () => {
      const sources = [{ id: "rp-1", name: "Research Project" }];
      mocks.dataImportService.listResearchProjects.mockResolvedValue(
        sources as never,
      );

      const result = await controller.listResearchProjectSources(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
      );

      expect(result).toEqual({ sources });
    });
  });

  // --------------------------------------------------------------------------
  // Import endpoints
  // --------------------------------------------------------------------------

  describe("importFromXxx()", () => {
    it("should import from research project", async () => {
      const importData = { sourceText: "Project content", sections: [] };
      mocks.dataImportService.importFromResearchProject.mockResolvedValue(
        importData as never,
      );

      const result = await controller.importFromResearchProject(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        "project-1",
      );

      expect(result).toEqual({ data: importData });
    });

    it("should import from writing project", async () => {
      const importData = { sourceText: "Writing content", sections: [] };
      mocks.dataImportService.importFromWriting.mockResolvedValue(
        importData as never,
      );

      const result = await controller.importFromWriting(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        "writing-proj-1",
      );

      expect(result).toEqual({ data: importData });
    });

    it("should import from teams topic", async () => {
      const importData = { sourceText: "Teams discussion", sections: [] };
      mocks.dataImportService.importFromTeams.mockResolvedValue(
        importData as never,
      );

      const result = await controller.importFromTeams(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        "topic-1",
      );

      expect(result).toEqual({ data: importData });
    });

    it("should import from library", async () => {
      const assets = [{ id: "asset-1", content: "Library content" }];
      mocks.dataImportService.importFromLibrary.mockResolvedValue(
        assets as never,
      );

      const result = await controller.importFromLibrary(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        { resourceIds: ["res-1", "res-2"] },
      );

      expect(result).toEqual({ assets });
    });

    it("should throw BadRequestException for empty resourceIds in importFromLibrary", async () => {
      await expect(
        controller.importFromLibrary(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          { resourceIds: [] },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should rethrow NotFoundException from import service", async () => {
      mocks.dataImportService.importFromResearch.mockRejectedValue(
        new NotFoundException("Topic not found") as never,
      );

      await expect(
        controller.importFromResearch(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "nonexistent-topic",
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // --------------------------------------------------------------------------
  // AI Edit endpoints
  // --------------------------------------------------------------------------

  describe("polishContent()", () => {
    it("should polish content for specified mission", async () => {
      const polishResult = { success: true, improvements: 5 };
      mocks.aiEditService.polishContent.mockResolvedValue(
        polishResult as never,
      );

      const result = await controller.polishContent(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        "mission-1",
        { tone: "professional", style: "concise" } as Parameters<
          typeof controller.polishContent
        >[2],
      );

      expect(mocks.aiEditService.polishContent).toHaveBeenCalledWith(
        "mission-1",
        expect.any(Object),
        mockUserId,
      );
      expect((result as { data: typeof polishResult }).data).toEqual(
        polishResult,
      );
    });
  });

  describe("factCheck()", () => {
    it("should run fact check in normal mode", async () => {
      const factCheckResult = { issues: [], accuracy: 95 };
      mocks.aiEditService.factCheck.mockResolvedValue(factCheckResult as never);

      await controller.factCheck(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        "mission-1",
        "false",
      );

      expect(mocks.aiEditService.factCheck).toHaveBeenCalledWith(
        "mission-1",
        false,
        mockUserId,
      );
    });

    it("should run fact check in strict mode", async () => {
      mocks.aiEditService.factCheck.mockResolvedValue({ issues: [] } as never);

      await controller.factCheck(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        "mission-1",
        "true",
      );

      expect(mocks.aiEditService.factCheck).toHaveBeenCalledWith(
        "mission-1",
        true,
        mockUserId,
      );
    });
  });

  describe("chatEdit()", () => {
    it("should perform chat-based edit", async () => {
      const editResult = {
        html: "<div>Updated HTML</div>",
        changes: ["Updated title"],
        confidence: 0.95,
      };
      mocks.aiEditService.chatEdit.mockResolvedValue(editResult as never);

      const result = await controller.chatEdit(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        "session-1",
        { instruction: "Make the title larger", pageIndex: 0 },
      );

      expect(mocks.aiEditService.chatEdit).toHaveBeenCalledWith(
        "session-1",
        0,
        "Make the title larger",
        mockUserId,
      );
      expect((result as { data: typeof editResult }).data).toEqual(editResult);
    });

    it("should throw InternalServerErrorException on chatEdit failure", async () => {
      mocks.aiEditService.chatEdit.mockRejectedValue(
        new Error("Edit failed") as never,
      );

      await expect(
        controller.chatEdit(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "session-1",
          { instruction: "Fix layout", pageIndex: 1 },
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // getSessions
  // --------------------------------------------------------------------------

  describe("getSessions()", () => {
    it("should return sessions with checkpoints and subscriptions", async () => {
      const sessions = [
        { id: "session-1", title: "Test", status: "active" },
        { id: "session-2", title: "Another", status: "completed" },
      ];
      mocks.checkpointService.getSessions.mockResolvedValue(sessions as never);
      mocks.checkpointService.getLatestCheckpoint
        .mockResolvedValueOnce({
          id: "ckpt-1",
          type: "page_rendered",
          timestamp: new Date(),
          state: { pages: [{ pageNumber: 1 }] },
        } as never)
        .mockResolvedValueOnce(null as never);

      mocks.prismaService.slidesMission.findMany.mockResolvedValue([
        {
          sessionId: "session-1",
          sourceSubscription: { type: "topic-insights", sourceId: "t1" },
        },
      ]);

      const result = await controller.getSessions(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        "active",
        "10",
      );

      expect((result as { sessions: unknown[] }).sessions).toHaveLength(2);
    });

    it("should return sessions without subscription when not found", async () => {
      mocks.checkpointService.getSessions.mockResolvedValue([
        { id: "session-1", title: "Test" },
      ] as never);
      mocks.checkpointService.getLatestCheckpoint.mockResolvedValue(
        null as never,
      );
      mocks.prismaService.slidesMission.findMany.mockResolvedValue([]);

      const result = await controller.getSessions(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
      );

      const sessions = (
        result as { sessions: Array<{ sourceSubscription: unknown }> }
      ).sessions;
      expect(sessions[0].sourceSubscription).toBeNull();
    });

    it("should throw InternalServerErrorException when getSessions fails", async () => {
      mocks.checkpointService.getSessions.mockRejectedValue(
        new Error("DB error") as never,
      );

      await expect(
        controller.getSessions(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // listResearchSources
  // --------------------------------------------------------------------------

  describe("listResearchSources()", () => {
    it("should return research sources list", async () => {
      const sources = [{ id: "topic-1", name: "AI Research" }];
      mocks.dataImportService.listResearchTopics.mockResolvedValue(
        sources as never,
      );

      const result = await controller.listResearchSources(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
      );

      expect(result).toEqual({ sources });
    });

    it("should throw InternalServerErrorException when listResearchTopics fails", async () => {
      mocks.dataImportService.listResearchTopics.mockRejectedValue(
        new Error("Service error") as never,
      );

      await expect(
        controller.listResearchSources(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // Error paths for source listing endpoints
  // --------------------------------------------------------------------------

  describe("listXxxSources() error paths", () => {
    it("should throw InternalServerErrorException when listWritingProjects fails", async () => {
      mocks.dataImportService.listWritingProjects.mockRejectedValue(
        new Error("Writing service error") as never,
      );

      await expect(
        controller.listWritingSources(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("should throw InternalServerErrorException when listTeamsTopics fails", async () => {
      mocks.dataImportService.listTeamsTopics.mockRejectedValue(
        new Error("Teams service error") as never,
      );

      await expect(
        controller.listTeamsSources(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("should throw InternalServerErrorException when listLibraryResources fails", async () => {
      mocks.dataImportService.listLibraryResources.mockRejectedValue(
        new Error("Library service error") as never,
      );

      await expect(
        controller.listLibrarySources(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("should throw InternalServerErrorException when listResearchProjects fails", async () => {
      mocks.dataImportService.listResearchProjects.mockRejectedValue(
        new Error("Research project error") as never,
      );

      await expect(
        controller.listResearchProjectSources(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // fixLayout
  // --------------------------------------------------------------------------

  describe("fixLayout()", () => {
    it("should fix layout for specified mission and page", async () => {
      const fixResult = {
        html: "<div>Fixed HTML</div>",
        changes: ["Aligned columns"],
      };
      mocks.aiEditService.fixLayout.mockResolvedValue(fixResult as never);

      const result = await controller.fixLayout(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        "mission-1",
        "0",
      );

      expect(mocks.aiEditService.fixLayout).toHaveBeenCalledWith(
        "mission-1",
        0,
        mockUserId,
      );
      expect((result as { data: typeof fixResult }).data).toEqual(fixResult);
    });

    it("should throw InternalServerErrorException when fixLayout fails", async () => {
      mocks.aiEditService.fixLayout.mockRejectedValue(
        new Error("Layout fix failed") as never,
      );

      await expect(
        controller.fixLayout(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "mission-1",
          "1",
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // Import error paths
  // --------------------------------------------------------------------------

  describe("importFromXxx() error paths", () => {
    it("should throw InternalServerErrorException for non-NotFoundException in importFromResearchProject", async () => {
      mocks.dataImportService.importFromResearchProject.mockRejectedValue(
        new Error("Service unavailable") as never,
      );

      await expect(
        controller.importFromResearchProject(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "project-1",
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("should rethrow NotFoundException from importFromResearchProject", async () => {
      mocks.dataImportService.importFromResearchProject.mockRejectedValue(
        new NotFoundException("Project not found") as never,
      );

      await expect(
        controller.importFromResearchProject(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "nonexistent",
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw InternalServerErrorException for non-NotFoundException in importFromWriting", async () => {
      mocks.dataImportService.importFromWriting.mockRejectedValue(
        new Error("Writing service error") as never,
      );

      await expect(
        controller.importFromWriting(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "project-1",
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("should rethrow NotFoundException from importFromWriting", async () => {
      mocks.dataImportService.importFromWriting.mockRejectedValue(
        new NotFoundException("Writing project not found") as never,
      );

      await expect(
        controller.importFromWriting(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "nonexistent",
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw InternalServerErrorException for non-NotFoundException in importFromTeams", async () => {
      mocks.dataImportService.importFromTeams.mockRejectedValue(
        new Error("Teams error") as never,
      );

      await expect(
        controller.importFromTeams(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "topic-1",
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("should rethrow NotFoundException from importFromTeams", async () => {
      mocks.dataImportService.importFromTeams.mockRejectedValue(
        new NotFoundException("Topic not found") as never,
      );

      await expect(
        controller.importFromTeams(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "nonexistent",
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw InternalServerErrorException when importFromLibrary fails", async () => {
      mocks.dataImportService.importFromLibrary.mockRejectedValue(
        new Error("Library error") as never,
      );

      await expect(
        controller.importFromLibrary(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          { resourceIds: ["res-1"] },
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // polishContent error path
  // --------------------------------------------------------------------------

  describe("polishContent() error path", () => {
    it("should throw InternalServerErrorException when polishContent service fails", async () => {
      mocks.aiEditService.polishContent.mockRejectedValue(
        new Error("Polish failed") as never,
      );

      await expect(
        controller.polishContent(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "mission-1",
          {} as Parameters<typeof controller.polishContent>[2],
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // factCheck error path
  // --------------------------------------------------------------------------

  describe("factCheck() error path", () => {
    it("should throw InternalServerErrorException when factCheck service fails", async () => {
      mocks.aiEditService.factCheck.mockRejectedValue(
        new Error("Fact check error") as never,
      );

      await expect(
        controller.factCheck(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "mission-1",
          "false",
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // --------------------------------------------------------------------------
  // pruneCheckpoints error path
  // --------------------------------------------------------------------------

  describe("pruneCheckpoints() error path", () => {
    it("should throw InternalServerErrorException when prune fails", async () => {
      mocks.checkpointService.prune.mockRejectedValue(
        new Error("Prune failed") as never,
      );

      await expect(controller.pruneCheckpoints("session-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // updateSubscription error paths
  // --------------------------------------------------------------------------

  describe("updateSubscription() error paths", () => {
    it("should throw InternalServerErrorException for unsubscribe failure", async () => {
      mocks.prismaService.slidesMission.updateMany.mockRejectedValue(
        new Error("DB error") as never,
      );

      await expect(
        controller.updateSubscription(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "session-1",
          { action: "unsubscribe" },
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("should throw InternalServerErrorException for refresh failure in data import", async () => {
      mocks.prismaService.slidesMission.findFirst.mockResolvedValue({
        id: "mission-1",
        sourceSubscription: {
          type: "topic-insights",
          sourceId: "topic-abc",
        },
      });
      mocks.dataImportService.importFromResearch.mockRejectedValue(
        new Error("Import failed") as never,
      );

      await expect(
        controller.updateSubscription(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "session-1",
          { action: "refresh" },
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("should handle refresh when no mission found (null sourceSubscription)", async () => {
      mocks.prismaService.slidesMission.findFirst.mockResolvedValue(null);

      await expect(
        controller.updateSubscription(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "session-1",
          { action: "refresh" },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // --------------------------------------------------------------------------
  // getCheckpoint - error when checkpoint not found as generic error
  // --------------------------------------------------------------------------

  describe("getCheckpoint() - generic error path", () => {
    it("should throw NotFoundException for generic error from checkpoint service", async () => {
      mocks.checkpointService.get.mockRejectedValue(
        new Error("Checkpoint not found") as never,
      );

      await expect(controller.getCheckpoint("ckpt-missing")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // --------------------------------------------------------------------------
  // createCheckpoint - error propagation
  // --------------------------------------------------------------------------

  describe("createCheckpoint() - error paths", () => {
    it("should throw InternalServerErrorException when create fails with generic error", async () => {
      const latestCheckpoint = {
        id: "ckpt-latest",
        state: { pages: [], conversation: [] },
      };
      mocks.checkpointService.getLatestCheckpoint.mockResolvedValue(
        latestCheckpoint as never,
      );
      mocks.checkpointService.create.mockRejectedValue(
        new Error("Create failed") as never,
      );

      await expect(
        controller.createCheckpoint("session-1", { name: "Test" }),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("should rethrow HttpException from createCheckpoint", async () => {
      mocks.checkpointService.getLatestCheckpoint.mockResolvedValue(
        null as never,
      );

      await expect(
        controller.createCheckpoint("session-1", {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // --------------------------------------------------------------------------
  // getSession - error propagation
  // --------------------------------------------------------------------------

  describe("getSession() - error paths", () => {
    it("should rethrow HttpException (NotFoundException) as-is", async () => {
      mocks.checkpointService.getSession.mockResolvedValue(null as never);

      await expect(controller.getSession("missing")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw InternalServerErrorException for non-HTTP errors", async () => {
      mocks.checkpointService.getSession.mockRejectedValue(
        new Error("Connection timeout") as never,
      );

      await expect(controller.getSession("session-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it("should include sourceSubscription from latest mission", async () => {
      mocks.checkpointService.getSession.mockResolvedValue({
        id: "session-1",
        title: "Test",
      } as never);
      mocks.checkpointService.getLatestCheckpoint.mockResolvedValue(
        null as never,
      );
      mocks.prismaService.slidesMission.findFirst.mockResolvedValue({
        sourceSubscription: { type: "research-project", sourceId: "proj-1" },
      });

      const result = await controller.getSession("session-1");

      expect(
        (result as { sourceSubscription: { type: string } }).sourceSubscription,
      ).toEqual({ type: "research-project", sourceId: "proj-1" });
    });
  });

  // --------------------------------------------------------------------------
  // exportSlides - error paths
  // --------------------------------------------------------------------------

  describe("exportSlides() - error paths", () => {
    it("should throw HttpException when export service throws", async () => {
      mocks.slidesEngine.exportPptx.mockRejectedValue(
        new Error("Export service down") as never,
      );

      const mockRes = { setHeader: jest.fn(), send: jest.fn() };

      await expect(
        controller.exportSlides(
          "session-1",
          { format: "pptx" },
          mockRes as unknown as import("express").Response,
        ),
      ).rejects.toThrow();
    });

    it("should rethrow HttpException from export handler", async () => {
      const { HttpException, HttpStatus } = await import("@nestjs/common");
      mocks.slidesEngine.exportPptx.mockRejectedValue(
        new HttpException("Not found", HttpStatus.NOT_FOUND) as never,
      );

      const mockRes = { setHeader: jest.fn(), send: jest.fn() };

      await expect(
        controller.exportSlides(
          "session-1",
          { format: "pptx" },
          mockRes as unknown as import("express").Response,
        ),
      ).rejects.toThrow(HttpException);
    });
  });

  // --------------------------------------------------------------------------
  // generateNarrations
  // --------------------------------------------------------------------------

  describe("generateNarrations()", () => {
    it("should throw NotFoundException when mission not found", async () => {
      mocks.prismaService.slidesMission.findUnique.mockResolvedValue(null);

      await expect(
        controller.generateNarrations(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "nonexistent-mission",
          {},
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when user does not own mission", async () => {
      mocks.prismaService.slidesMission.findUnique.mockResolvedValue({
        id: "mission-1",
        userId: "other-user",
        sourceText: "Source",
        pages: [],
      });

      await expect(
        controller.generateNarrations(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "mission-1",
          {},
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should generate narrations for owned mission", async () => {
      const mockMission = {
        id: "mission-1",
        userId: mockUserId,
        sourceText: "Source content",
        pages: [{ index: 0, title: "Slide 1", html: "<div>Content</div>" }],
      };
      mocks.prismaService.slidesMission.findUnique.mockResolvedValue(
        mockMission,
      );
      mocks.voiceNarrationSkill.execute.mockResolvedValue({
        success: true,
        data: {
          narrations: [
            {
              pageIndex: 0,
              script: "Welcome to this presentation",
              estimatedDuration: 30,
            },
          ],
          totalDuration: 30,
          stats: { avgWordsPerSlide: 10, avgDurationPerSlide: 30 },
        },
      } as never);

      const result = await controller.generateNarrations(
        mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
        "mission-1",
        { style: "professional", language: "zh" },
      );

      expect(mocks.voiceNarrationSkill.execute).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should throw BadRequestException when mission has no pages", async () => {
      mocks.prismaService.slidesMission.findUnique.mockResolvedValue({
        id: "mission-1",
        userId: mockUserId,
        sourceText: "Source",
        pages: [],
      });

      await expect(
        controller.generateNarrations(
          mockAuthenticatedRequest as unknown as import("../../../../../common/types/express-request.types").RequestWithUser,
          "mission-1",
          {},
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
