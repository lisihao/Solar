/**
 * SlidesController Supplemental2 Tests
 *
 * Covers uncovered endpoints not in slides.controller-supplemental.spec.ts:
 * - generateSlidesPost() — no-res error, SSE write, error event write
 * - generateTeam() — no-res error, SSE write, error event write
 * - updateSubscription() — unsubscribe, refresh topic-insights, refresh research-project, no subscription error
 * - updateSession() — success, error
 * - deleteSession() — success, error
 * - pruneCheckpoints() — success, error, default keepCount
 * - chatEdit() — success, error
 * - importFromLibrary() — success, empty resourceIds error, service error
 * - listResearchSources() — success, error
 * - listWritingSources() — success, error
 * - listTeamsSources() — success, error
 * - listLibrarySources() — success, error
 * - importFromResearch() — success, NotFoundException rethrow, other error
 * - importFromResearchProject() — success, error
 * - importFromWriting() — success, error
 * - importFromTeams() — success, error
 * - archiveSession() — error path
 */

// Mock @prisma/client so enum accesses don't throw in this isolated test context
jest.mock("@prisma/client", () => {
  const enumProxy = new Proxy(
    {},
    { get: (_target, prop) => (typeof prop === "string" ? prop : undefined) },
  );
  return new Proxy(
    { PrismaClient: jest.fn().mockImplementation(() => ({})) },
    {
      get(target, prop) {
        if (prop in target)
          return (target as Record<string | symbol, unknown>)[prop];
        return enumProxy;
      },
    },
  );
});

import { Test, TestingModule } from "@nestjs/testing";
import {
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  HttpException,
} from "@nestjs/common";
import { SlidesController } from "../slides.controller";
import { SlidesEngineService } from "../../services/slides-engine.service";
import { SlidesDataImportService } from "../../services/data-import.service";
import { AIEditService } from "../../services/ai-edit.service";
import { SlidesCheckpointService } from "../../checkpoint/checkpoint.service";
import { VoiceNarrationSkill } from "../../skills/voice-narration.skill";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import type { Response } from "express";

// Mock heavy template imports
jest.mock("../../templates/base/themes", () => ({
  getAllThemes: jest.fn().mockReturnValue([]),
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  MissionExecutorService: jest.fn(),
  MissionContext: {
    run: jest
      .fn()
      .mockImplementation((_opts: unknown, fn: () => Promise<unknown>) => fn()),
  },
  EventJournalService: jest.fn(),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  MissionExecutorService: jest.fn(),
  MissionContext: {
    run: jest
      .fn()
      .mockImplementation((_opts: unknown, fn: () => Promise<unknown>) => fn()),
  },
  EventJournalService: jest.fn(),
}));

jest.mock("@/modules/platform/facade", () => ({
  BillingContext: {
    run: jest
      .fn()
      .mockImplementation((_opts: unknown, fn: () => Promise<unknown>) => fn()),
  },
}));

// -----------------------------------------------------------------------
// Mock factory helpers
// -----------------------------------------------------------------------

function makeSlidesEngine() {
  return {
    generateSlides: jest.fn(),
    restoreCheckpoint: jest.fn(),
    regeneratePage: jest.fn(),
    exportPptx: jest.fn(),
    exportPdf: jest.fn(),
    polishPage: jest.fn(),
    chatEdit: jest.fn(),
  };
}

function makeCheckpointService() {
  return {
    list: jest.fn().mockResolvedValue([]),
    getLatestCheckpoint: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    get: jest.fn(),
    getSession: jest.fn(),
    getSessions: jest.fn().mockResolvedValue([]),
    updateSessionStatus: jest.fn().mockResolvedValue(undefined),
    updateSession: jest.fn(),
    updateSessionTitle: jest.fn(),
    deleteSession: jest.fn(),
    prune: jest.fn().mockResolvedValue(5),
  };
}

function makeDataImportService() {
  return {
    importFromLibrary: jest.fn(),
    importFromResearch: jest.fn(),
    importFromResearchProject: jest.fn(),
    importFromWriting: jest.fn(),
    importFromTeams: jest.fn(),
    listResearchTopics: jest.fn().mockResolvedValue([]),
    listWritingProjects: jest.fn().mockResolvedValue([]),
    listTeamsTopics: jest.fn().mockResolvedValue([]),
    listLibraryResources: jest.fn().mockResolvedValue([]),
    listResearchProjects: jest.fn().mockResolvedValue([]),
  };
}

function makeAIEditService() {
  return {
    polishPage: jest.fn(),
    chat: jest.fn(),
    chatEdit: jest.fn(),
    fixLayout: jest.fn(),
    polishContent: jest.fn(),
    factCheck: jest.fn(),
  };
}

function makeVoiceNarrationSkill() {
  return {
    id: "voice-narration",
    execute: jest.fn(),
    generateNarration: jest.fn(),
  };
}

function makePrismaService() {
  return {
    slidesMission: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    slidesNarration: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function makeReq(userId = "user-123") {
  return {
    user: { id: userId },
  } as unknown as import("../../../../../../common/types/express-request.types").RequestWithUser;
}

function makeRes(): jest.Mocked<Response> {
  return {
    setHeader: jest.fn(),
    send: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    flushHeaders: jest.fn(),
  } as unknown as jest.Mocked<Response>;
}

// -----------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------

describe("SlidesController (supplemental2)", () => {
  let controller: SlidesController;
  let slidesEngine: ReturnType<typeof makeSlidesEngine>;
  let checkpointService: ReturnType<typeof makeCheckpointService>;
  let dataImportService: ReturnType<typeof makeDataImportService>;
  let aiEditService: ReturnType<typeof makeAIEditService>;
  let prismaService: ReturnType<typeof makePrismaService>;
  let voiceNarrationSkill: ReturnType<typeof makeVoiceNarrationSkill>;

  beforeEach(async () => {
    jest.clearAllMocks();
    slidesEngine = makeSlidesEngine();
    checkpointService = makeCheckpointService();
    dataImportService = makeDataImportService();
    aiEditService = makeAIEditService();
    prismaService = makePrismaService();
    voiceNarrationSkill = makeVoiceNarrationSkill();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SlidesController],
      providers: [
        { provide: SlidesEngineService, useValue: slidesEngine },
        { provide: SlidesCheckpointService, useValue: checkpointService },
        { provide: SlidesDataImportService, useValue: dataImportService },
        { provide: AIEditService, useValue: aiEditService },
        { provide: VoiceNarrationSkill, useValue: voiceNarrationSkill },
        { provide: PrismaService, useValue: prismaService },
      ],
    })
      .overrideGuard(
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
        require("../../../../../../common/guards/jwt-auth.guard").JwtAuthGuard,
      )
      .useValue({ canActivate: () => true })
      .overrideGuard(
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
        require("../../../../../../common/guards/rate-limit.guard")
          .RateLimitGuard,
      )
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SlidesController>(SlidesController);
  });

  // =========================================================================
  // generateSlidesPost
  // =========================================================================

  describe("generateSlidesPost()", () => {
    it("throws HttpException when res is not provided", async () => {
      const req = makeReq();
      const dto = {
        title: "Test",
        sourceText: "source text",
        userRequirement: undefined,
        targetPages: undefined,
        stylePreference: undefined,
        targetAudience: undefined,
        themeId: undefined,
        customStyles: undefined,
        crossModuleSource: undefined,
      };

      await expect(
        controller.generateSlidesPost(req, dto, undefined),
      ).rejects.toThrow(HttpException);
    });

    it("writes SSE events and ends response on success", async () => {
      const req = makeReq();
      const dto = {
        title: "Test PPT",
        sourceText: "some source text",
        userRequirement: "Make it concise",
        targetPages: 5,
        stylePreference: "dark" as const,
        targetAudience: "executives",
        themeId: "dark-pro",
        customStyles: undefined,
        crossModuleSource: undefined,
      };
      const res = makeRes();

      function* fakeGenerator() {
        yield { type: "page_rendered", pageNumber: 1 };
        yield { type: "completed" };
      }
      slidesEngine.generateSlides.mockReturnValue(fakeGenerator());

      await controller.generateSlidesPost(req, dto, res);

      expect(res.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "text/event-stream",
      );
      expect(res.write).toHaveBeenCalledTimes(2);
      expect(res.end).toHaveBeenCalled();
    });

    it("writes error SSE event when generation throws", async () => {
      const req = makeReq();
      const dto = {
        title: "Test",
        sourceText: "text",
        userRequirement: undefined,
        targetPages: undefined,
        stylePreference: undefined,
        targetAudience: undefined,
        themeId: undefined,
        customStyles: undefined,
        crossModuleSource: undefined,
      };
      const res = makeRes();

      function* failingGenerator() {
        yield { type: "started" };
        throw new Error("Generation error");
      }
      slidesEngine.generateSlides.mockReturnValue(failingGenerator());

      await controller.generateSlidesPost(req, dto, res);

      // Should write an error event and still call end()
      expect(res.write).toHaveBeenCalledWith(
        expect.stringContaining("Generation error"),
      );
      expect(res.end).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // generateTeam
  // =========================================================================

  describe("generateTeam()", () => {
    it("throws HttpException when res is not provided", async () => {
      const req = makeReq();
      const dto = {
        title: "Team PPT",
        sourceText: "text",
        userRequirement: undefined,
        targetPages: undefined,
        stylePreference: undefined,
        targetAudience: undefined,
        themeId: undefined,
        customStyles: undefined,
        crossModuleSource: undefined,
      };

      await expect(
        controller.generateTeam(req, dto, undefined),
      ).rejects.toThrow(HttpException);
    });

    it("writes SSE events and ends response for team generation", async () => {
      const req = makeReq();
      const dto = {
        title: "Team Analysis",
        sourceText: "Analysis content",
        userRequirement: undefined,
        targetPages: 8,
        stylePreference: "light" as const,
        targetAudience: undefined,
        themeId: undefined,
        customStyles: undefined,
        crossModuleSource: {
          type: "topic-insights",
          sourceId: "topic-1",
          sourceName: "AI Trends",
        },
      };
      const res = makeRes();

      function* fakeGenerator() {
        yield { type: "started" };
        yield { type: "page_rendered", pageNumber: 1 };
      }
      slidesEngine.generateSlides.mockReturnValue(fakeGenerator());

      await controller.generateTeam(req, dto, res);

      expect(res.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "text/event-stream",
      );
      expect(res.end).toHaveBeenCalled();
    });

    it("writes error SSE event when team generation throws", async () => {
      const req = makeReq();
      const dto = {
        title: "Team",
        sourceText: "text",
        userRequirement: undefined,
        targetPages: undefined,
        stylePreference: undefined,
        targetAudience: undefined,
        themeId: undefined,
        customStyles: undefined,
        crossModuleSource: undefined,
      };
      const res = makeRes();

      // Generator that throws immediately
      const failingGen = {
        [Symbol.asyncIterator]() {
          return {
            next: jest
              .fn()
              .mockRejectedValue(new Error("Team generation failed")),
            return: jest.fn(),
            throw: jest.fn(),
          };
        },
      };
      slidesEngine.generateSlides.mockReturnValue(failingGen);

      await controller.generateTeam(req, dto, res);

      expect(res.write).toHaveBeenCalledWith(
        expect.stringContaining("Team generation failed"),
      );
      expect(res.end).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // updateSubscription
  // =========================================================================

  describe("updateSubscription()", () => {
    it("unsubscribes successfully", async () => {
      prismaService.slidesMission.updateMany.mockResolvedValue({ count: 1 });

      const result = await controller.updateSubscription(
        makeReq(),
        "session-1",
        { action: "unsubscribe" },
      );

      expect((result as { success: boolean }).success).toBe(true);
      expect(prismaService.slidesMission.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: "session-1", userId: "user-123" },
        }),
      );
    });

    it("throws BadRequestException when no subscription found during refresh", async () => {
      prismaService.slidesMission.findFirst.mockResolvedValue({
        id: "mission-1",
        sourceSubscription: null,
      });

      await expect(
        controller.updateSubscription(makeReq(), "session-1", {
          action: "refresh",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when subscription has no type during refresh", async () => {
      prismaService.slidesMission.findFirst.mockResolvedValue({
        id: "mission-1",
        sourceSubscription: { sourceId: "topic-1" }, // missing type
      });

      await expect(
        controller.updateSubscription(makeReq(), "session-1", {
          action: "refresh",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("refreshes topic-insights subscription successfully", async () => {
      prismaService.slidesMission.findFirst.mockResolvedValue({
        id: "mission-1",
        sourceSubscription: { type: "topic-insights", sourceId: "topic-1" },
      });
      dataImportService.importFromResearch.mockResolvedValue({
        sourceText: "refreshed content",
      });
      prismaService.slidesMission.update.mockResolvedValue({});

      const result = await controller.updateSubscription(
        makeReq(),
        "session-1",
        { action: "refresh" },
      );

      expect((result as { success: boolean }).success).toBe(true);
      expect(
        (result as { subscription: { isStale: boolean } }).subscription.isStale,
      ).toBe(false);
      expect(dataImportService.importFromResearch).toHaveBeenCalledWith(
        "topic-1",
        "user-123",
      );
    });

    it("refreshes research-project subscription successfully", async () => {
      prismaService.slidesMission.findFirst.mockResolvedValue({
        id: "mission-1",
        sourceSubscription: {
          type: "research-project",
          sourceId: "project-1",
        },
      });
      dataImportService.importFromResearchProject.mockResolvedValue({
        sourceText: "project content",
      });
      prismaService.slidesMission.update.mockResolvedValue({});

      const result = await controller.updateSubscription(
        makeReq(),
        "session-1",
        { action: "refresh" },
      );

      expect((result as { success: boolean }).success).toBe(true);
      expect(dataImportService.importFromResearchProject).toHaveBeenCalledWith(
        "project-1",
        "user-123",
      );
    });

    it("throws InternalServerErrorException on unexpected error", async () => {
      prismaService.slidesMission.updateMany.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(
        controller.updateSubscription(makeReq(), "session-1", {
          action: "unsubscribe",
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // =========================================================================
  // updateSession
  // =========================================================================

  describe("updateSession()", () => {
    it("updates session title successfully", async () => {
      const updatedSession = { id: "session-1", title: "New Title" };
      checkpointService.updateSessionTitle.mockResolvedValue(updatedSession);

      const result = await controller.updateSession("session-1", {
        title: "New Title",
      });

      expect((result as { session: { title: string } }).session.title).toBe(
        "New Title",
      );
      expect(checkpointService.updateSessionTitle).toHaveBeenCalledWith(
        "session-1",
        "New Title",
      );
    });

    it("throws InternalServerErrorException on error", async () => {
      checkpointService.updateSessionTitle.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(
        controller.updateSession("session-1", { title: "New Title" }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // =========================================================================
  // deleteSession
  // =========================================================================

  describe("deleteSession()", () => {
    it("deletes session successfully", async () => {
      checkpointService.deleteSession.mockResolvedValue(undefined);

      const result = await controller.deleteSession("session-1");

      expect((result as { message: string }).message).toBe(
        "Session deleted successfully",
      );
      expect(checkpointService.deleteSession).toHaveBeenCalledWith("session-1");
    });

    it("throws InternalServerErrorException on error", async () => {
      checkpointService.deleteSession.mockRejectedValue(
        new Error("Delete failed"),
      );

      await expect(controller.deleteSession("session-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================================
  // pruneCheckpoints
  // =========================================================================

  describe("pruneCheckpoints()", () => {
    it("prunes checkpoints with specified keepCount", async () => {
      checkpointService.prune.mockResolvedValue(3);

      const result = await controller.pruneCheckpoints("session-1", "5");

      expect((result as { prunedCount: number }).prunedCount).toBe(3);
      expect((result as { message: string }).message).toContain("3");
      expect(checkpointService.prune).toHaveBeenCalledWith("session-1", 5);
    });

    it("uses default keepCount of 10 when not specified", async () => {
      checkpointService.prune.mockResolvedValue(7);

      await controller.pruneCheckpoints("session-1");

      expect(checkpointService.prune).toHaveBeenCalledWith("session-1", 10);
    });

    it("throws InternalServerErrorException on error", async () => {
      checkpointService.prune.mockRejectedValue(new Error("Prune failed"));

      await expect(controller.pruneCheckpoints("session-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================================
  // chatEdit
  // =========================================================================

  describe("chatEdit()", () => {
    it("performs chat edit successfully", async () => {
      const editResult = {
        updatedPage: { id: "page-1", content: "new content" },
        summary: "Changed layout",
      };
      aiEditService.chatEdit.mockResolvedValue(editResult);

      const result = await controller.chatEdit(makeReq(), "session-1", {
        instruction: "Change the layout",
        pageIndex: 0,
      });

      expect((result as { data: typeof editResult }).data).toEqual(editResult);
      expect(aiEditService.chatEdit).toHaveBeenCalledWith(
        "session-1",
        0,
        "Change the layout",
        "user-123",
      );
    });

    it("throws InternalServerErrorException on error", async () => {
      aiEditService.chatEdit.mockRejectedValue(new Error("Edit failed"));

      await expect(
        controller.chatEdit(makeReq(), "session-1", {
          instruction: "test",
          pageIndex: 0,
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // =========================================================================
  // importFromLibrary
  // =========================================================================

  describe("importFromLibrary()", () => {
    it("imports from library successfully", async () => {
      const assets = [{ id: "asset-1", url: "https://example.com/img.png" }];
      dataImportService.importFromLibrary.mockResolvedValue(assets);

      const result = await controller.importFromLibrary(makeReq(), {
        resourceIds: ["resource-1", "resource-2"],
      });

      expect((result as { assets: typeof assets }).assets).toEqual(assets);
    });

    it("throws BadRequestException when resourceIds is empty", async () => {
      await expect(
        controller.importFromLibrary(makeReq(), { resourceIds: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws InternalServerErrorException on service error", async () => {
      dataImportService.importFromLibrary.mockRejectedValue(
        new Error("Import failed"),
      );

      await expect(
        controller.importFromLibrary(makeReq(), {
          resourceIds: ["resource-1"],
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // =========================================================================
  // listResearchSources / listWritingSources / listTeamsSources / listLibrarySources
  // =========================================================================

  describe("listResearchSources()", () => {
    it("returns research sources", async () => {
      const sources = [{ id: "topic-1", name: "AI Research" }];
      dataImportService.listResearchTopics.mockResolvedValue(sources);

      const result = await controller.listResearchSources(makeReq());

      expect((result as { sources: typeof sources }).sources).toEqual(sources);
    });

    it("throws InternalServerErrorException on error", async () => {
      dataImportService.listResearchTopics.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(controller.listResearchSources(makeReq())).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe("listWritingSources()", () => {
    it("returns writing project sources", async () => {
      const sources = [{ id: "proj-1", title: "My Novel" }];
      dataImportService.listWritingProjects.mockResolvedValue(sources);

      const result = await controller.listWritingSources(makeReq());

      expect((result as { sources: typeof sources }).sources).toEqual(sources);
    });

    it("throws InternalServerErrorException on error", async () => {
      dataImportService.listWritingProjects.mockRejectedValue(
        new Error("Error"),
      );

      await expect(controller.listWritingSources(makeReq())).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe("listTeamsSources()", () => {
    it("returns teams topics", async () => {
      const sources = [{ id: "topic-1", name: "Team Discussion" }];
      dataImportService.listTeamsTopics.mockResolvedValue(sources);

      const result = await controller.listTeamsSources(makeReq());

      expect((result as { sources: typeof sources }).sources).toEqual(sources);
    });

    it("throws InternalServerErrorException on error", async () => {
      dataImportService.listTeamsTopics.mockRejectedValue(new Error("Error"));

      await expect(controller.listTeamsSources(makeReq())).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe("listLibrarySources()", () => {
    it("returns library resources with type filter", async () => {
      const sources = [{ id: "res-1", title: "Image" }];
      dataImportService.listLibraryResources.mockResolvedValue(sources);

      const result = await controller.listLibrarySources(makeReq(), "image");

      expect((result as { sources: typeof sources }).sources).toEqual(sources);
      expect(dataImportService.listLibraryResources).toHaveBeenCalledWith(
        "user-123",
        "image",
      );
    });

    it("throws InternalServerErrorException on error", async () => {
      dataImportService.listLibraryResources.mockRejectedValue(
        new Error("Error"),
      );

      await expect(controller.listLibrarySources(makeReq())).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================================
  // importFromResearch / importFromResearchProject / importFromWriting / importFromTeams
  // =========================================================================

  describe("importFromResearch()", () => {
    it("imports research topic data successfully", async () => {
      const data = { sourceText: "AI content", title: "AI Trends" };
      dataImportService.importFromResearch.mockResolvedValue(data);

      const result = await controller.importFromResearch(makeReq(), "topic-1");

      expect((result as { data: typeof data }).data).toEqual(data);
    });

    it("rethrows NotFoundException", async () => {
      dataImportService.importFromResearch.mockRejectedValue(
        new NotFoundException("Topic not found"),
      );

      await expect(
        controller.importFromResearch(makeReq(), "unknown-topic"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws InternalServerErrorException on other errors", async () => {
      dataImportService.importFromResearch.mockRejectedValue(
        new Error("Network error"),
      );

      await expect(
        controller.importFromResearch(makeReq(), "topic-1"),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe("importFromResearchProject()", () => {
    it("imports research project data successfully", async () => {
      const data = { sourceText: "Project content" };
      dataImportService.importFromResearchProject.mockResolvedValue(data);

      const result = await controller.importFromResearchProject(
        makeReq(),
        "project-1",
      );

      expect((result as { data: typeof data }).data).toEqual(data);
    });

    it("rethrows NotFoundException", async () => {
      dataImportService.importFromResearchProject.mockRejectedValue(
        new NotFoundException("Project not found"),
      );

      await expect(
        controller.importFromResearchProject(makeReq(), "unknown"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws InternalServerErrorException on other errors", async () => {
      dataImportService.importFromResearchProject.mockRejectedValue(
        new Error("Error"),
      );

      await expect(
        controller.importFromResearchProject(makeReq(), "project-1"),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe("importFromWriting()", () => {
    it("imports writing project data successfully", async () => {
      const data = { sourceText: "Writing content" };
      dataImportService.importFromWriting.mockResolvedValue(data);

      const result = await controller.importFromWriting(makeReq(), "proj-1");

      expect((result as { data: typeof data }).data).toEqual(data);
    });

    it("rethrows NotFoundException", async () => {
      dataImportService.importFromWriting.mockRejectedValue(
        new NotFoundException("Not found"),
      );

      await expect(
        controller.importFromWriting(makeReq(), "unknown"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws InternalServerErrorException on other errors", async () => {
      dataImportService.importFromWriting.mockRejectedValue(new Error("Error"));

      await expect(
        controller.importFromWriting(makeReq(), "proj-1"),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe("importFromTeams()", () => {
    it("imports teams topic data successfully", async () => {
      const data = { sourceText: "Teams content" };
      dataImportService.importFromTeams.mockResolvedValue(data);

      const result = await controller.importFromTeams(makeReq(), "topic-1");

      expect((result as { data: typeof data }).data).toEqual(data);
    });

    it("rethrows NotFoundException", async () => {
      dataImportService.importFromTeams.mockRejectedValue(
        new NotFoundException("Not found"),
      );

      await expect(
        controller.importFromTeams(makeReq(), "unknown"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws InternalServerErrorException on other errors", async () => {
      dataImportService.importFromTeams.mockRejectedValue(new Error("Error"));

      await expect(
        controller.importFromTeams(makeReq(), "topic-1"),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // =========================================================================
  // archiveSession — error path
  // =========================================================================

  describe("archiveSession() error path", () => {
    it("throws InternalServerErrorException on archive failure", async () => {
      checkpointService.updateSessionStatus.mockRejectedValue(
        new Error("Archive failed"),
      );

      await expect(controller.archiveSession("session-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================================
  // listResearchProjectSources
  // =========================================================================

  describe("listResearchProjectSources()", () => {
    it("returns research project sources", async () => {
      const sources = [{ id: "proj-1", name: "My Research Project" }];
      dataImportService.listResearchProjects.mockResolvedValue(sources);

      const result = await controller.listResearchProjectSources(makeReq());

      expect((result as { sources: typeof sources }).sources).toEqual(sources);
    });

    it("throws InternalServerErrorException on error", async () => {
      dataImportService.listResearchProjects.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(
        controller.listResearchProjectSources(makeReq()),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
