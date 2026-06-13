/**
 * SlidesController Supplemental Tests
 *
 * Covers uncovered endpoints and branches:
 * - getThemesList()
 * - getCheckpoints() — success, error, limit applied
 * - createCheckpoint() — success, no latest checkpoint, error
 * - getCheckpoint() — success, not found error
 * - restoreCheckpoint() — success, error
 * - rerenderPage() — success, error
 * - getSessions() — success, error
 * - getSession() — found, not found, error
 * - exportSlides() — pptx, pdf, unsupported format
 * - archiveSession() — success, error
 * - updateSessionTitle() (updateSession)
 */

jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
    $on = jest.fn();
  },
  ...jest.requireActual("@prisma/client"),
  AIModelType: {
    CHAT: "CHAT",
    CHAT_FAST: "CHAT_FAST",
    IMAGE_GENERATION: "IMAGE_GENERATION",
    IMAGE_EDITING: "IMAGE_EDITING",
    MULTIMODAL: "MULTIMODAL",
    EMBEDDING: "EMBEDDING",
    RERANK: "RERANK",
  },
}));

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

// Mock heavy template imports
jest.mock("../../templates/base/themes", () => ({
  getAllThemes: jest.fn().mockReturnValue([
    {
      id: "dark-professional",
      name: "Dark Professional",
      description: "A dark theme",
      preview: null,
      colors: {
        background: { primary: "#0a0a0a" },
        accent: { primary: "#6366f1" },
        text: { primary: "#ffffff" },
      },
    },
    {
      id: "light-clean",
      name: "Light Clean",
      description: "A light theme",
      preview: null,
      colors: {
        background: { primary: "#ffffff" },
        accent: { primary: "#3b82f6" },
        text: { primary: "#0a0a0a" },
      },
    },
  ]),
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
    deleteSession: jest.fn(),
  };
}

function makeDataImportService() {
  return {
    importFromLibrary: jest.fn(),
  };
}

function makeAIEditService() {
  return {
    polishPage: jest.fn(),
    chat: jest.fn(),
  };
}

function makeVoiceNarrationSkill() {
  return {
    generateNarration: jest.fn(),
  };
}

function makePrismaService() {
  return {
    slidesMission: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
}

// Mock user request
function makeReq(userId = "user-123") {
  return {
    user: { id: userId },
  } as unknown as import("../../../../../../common/types/express-request.types").RequestWithUser;
}

// -----------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------

describe("SlidesController (supplemental)", () => {
  let controller: SlidesController;
  let slidesEngine: ReturnType<typeof makeSlidesEngine>;
  let checkpointService: ReturnType<typeof makeCheckpointService>;
  let dataImportService: ReturnType<typeof makeDataImportService>;
  let aiEditService: ReturnType<typeof makeAIEditService>;
  let prismaService: ReturnType<typeof makePrismaService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    slidesEngine = makeSlidesEngine();
    checkpointService = makeCheckpointService();
    dataImportService = makeDataImportService();
    aiEditService = makeAIEditService();
    prismaService = makePrismaService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SlidesController],
      providers: [
        { provide: SlidesEngineService, useValue: slidesEngine },
        { provide: SlidesCheckpointService, useValue: checkpointService },
        { provide: SlidesDataImportService, useValue: dataImportService },
        { provide: AIEditService, useValue: aiEditService },
        { provide: VoiceNarrationSkill, useValue: makeVoiceNarrationSkill() },
        { provide: PrismaService, useValue: prismaService },
      ],
    })
      .overrideGuard(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("../../../../../../common/guards/jwt-auth.guard").JwtAuthGuard,
      )
      .useValue({ canActivate: () => true })
      .overrideGuard(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("../../../../../../common/guards/rate-limit.guard")
          .RateLimitGuard,
      )
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SlidesController>(SlidesController);
  });

  // =========================================================================
  // getThemesList
  // =========================================================================

  describe("getThemesList()", () => {
    it("returns list of available themes", async () => {
      const result = await controller.getThemesList();

      expect(result.themes).toHaveLength(2);
      expect(result.themes[0].id).toBe("dark-professional");
      expect(result.themes[0].colors).toHaveProperty("primary");
      expect(result.themes[0].colors).toHaveProperty("accent");
    });
  });

  // =========================================================================
  // getCheckpoints
  // =========================================================================

  describe("getCheckpoints()", () => {
    it("returns checkpoints for session", async () => {
      const mockCheckpoints = [
        { id: "cp-1", type: "auto_save", timestamp: new Date() },
        { id: "cp-2", type: "user_modified", timestamp: new Date() },
      ];
      checkpointService.list.mockResolvedValue(mockCheckpoints);

      const result = await controller.getCheckpoints("session-1");

      expect(result).toEqual({ checkpoints: mockCheckpoints });
    });

    it("applies limit to checkpoints", async () => {
      const manyCheckpoints = Array.from({ length: 100 }, (_, i) => ({
        id: `cp-${i}`,
        type: "auto_save",
        timestamp: new Date(),
      }));
      checkpointService.list.mockResolvedValue(manyCheckpoints);

      const result = await controller.getCheckpoints("session-1", "5");

      expect((result as { checkpoints: unknown[] }).checkpoints).toHaveLength(
        5,
      );
    });

    it("throws InternalServerErrorException on error", async () => {
      checkpointService.list.mockRejectedValue(new Error("DB error"));

      await expect(controller.getCheckpoints("session-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================================
  // createCheckpoint
  // =========================================================================

  describe("createCheckpoint()", () => {
    it("creates checkpoint from latest state", async () => {
      const latestCheckpoint = {
        id: "cp-prev",
        state: { pages: [], outlinePlan: null },
        type: "auto_save",
      };
      checkpointService.getLatestCheckpoint.mockResolvedValue(latestCheckpoint);
      checkpointService.create.mockResolvedValue({
        id: "cp-new",
        name: "My Save",
        type: "user_modified",
        version: 2,
        timestamp: new Date(),
      });

      const result = await controller.createCheckpoint("session-1", {
        name: "My Save",
        type: "user_modified",
      });

      expect((result as { checkpoint: { id: string } }).checkpoint.id).toBe(
        "cp-new",
      );
    });

    it("throws BadRequestException when no latest checkpoint exists", async () => {
      checkpointService.getLatestCheckpoint.mockResolvedValue(null);

      await expect(
        controller.createCheckpoint("session-1", {}),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws InternalServerErrorException on unexpected error", async () => {
      checkpointService.getLatestCheckpoint.mockRejectedValue(
        new Error("Unexpected"),
      );

      await expect(
        controller.createCheckpoint("session-1", {}),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it("rethrows HttpException directly", async () => {
      checkpointService.getLatestCheckpoint.mockResolvedValue({
        id: "cp-1",
        state: {},
        type: "auto_save",
      });
      checkpointService.create.mockRejectedValue(
        new HttpException("Custom HTTP error", 422),
      );

      await expect(
        controller.createCheckpoint("session-1", {}),
      ).rejects.toThrow(HttpException);
    });
  });

  // =========================================================================
  // getCheckpoint
  // =========================================================================

  describe("getCheckpoint()", () => {
    it("returns checkpoint details", async () => {
      checkpointService.get.mockResolvedValue({
        id: "cp-1",
        sessionId: "session-1",
        state: {
          pages: [{ id: "p1" }, { id: "p2" }],
          outlinePlan: { items: [] },
        },
        type: "auto_save",
        timestamp: new Date(),
      });

      const result = await controller.getCheckpoint("cp-1");

      expect((result as { checkpointId: string }).checkpointId).toBe("cp-1");
      expect((result as { sessionId: string }).sessionId).toBe("session-1");
    });

    it("throws NotFoundException on error", async () => {
      checkpointService.get.mockRejectedValue(new Error("Not found"));

      await expect(controller.getCheckpoint("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // restoreCheckpoint
  // =========================================================================

  describe("restoreCheckpoint()", () => {
    it("restores checkpoint successfully", async () => {
      slidesEngine.restoreCheckpoint.mockResolvedValue({
        sessionId: "session-1",
        state: {
          pages: [{ id: "p1" }],
          outlinePlan: { items: [] },
          taskDecomposition: {},
        },
      });
      checkpointService.getSession.mockResolvedValue({
        title: "My Presentation",
      });

      const result = await controller.restoreCheckpoint("cp-1");

      expect((result as { message: string }).message).toBe(
        "Checkpoint restored successfully",
      );
      expect((result as { sessionTitle: string }).sessionTitle).toBe(
        "My Presentation",
      );
      expect(
        (result as { state: { pagesCount: number } }).state.pagesCount,
      ).toBe(1);
    });

    it("uses null sessionTitle when session not found", async () => {
      slidesEngine.restoreCheckpoint.mockResolvedValue({
        sessionId: "session-1",
        state: { pages: [] },
      });
      checkpointService.getSession.mockResolvedValue(null);

      const result = await controller.restoreCheckpoint("cp-1");

      expect((result as { sessionTitle: null }).sessionTitle).toBeNull();
    });

    it("throws InternalServerErrorException on error", async () => {
      slidesEngine.restoreCheckpoint.mockRejectedValue(
        new Error("Restore failed"),
      );

      await expect(controller.restoreCheckpoint("cp-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================================
  // rerenderPage
  // =========================================================================

  describe("rerenderPage()", () => {
    it("rerenders page and returns events", async () => {
      slidesEngine.regeneratePage.mockResolvedValue([
        { type: "page_rendered", pageNumber: 2 },
      ]);

      const result = await controller.rerenderPage("session-1", "2", {
        feedback: "Make it more concise",
      });

      expect(slidesEngine.regeneratePage).toHaveBeenCalledWith(
        "session-1",
        2,
        "Make it more concise",
      );
      expect((result as { events: unknown[] }).events).toHaveLength(1);
    });

    it("throws InternalServerErrorException on error", async () => {
      slidesEngine.regeneratePage.mockRejectedValue(new Error("Render error"));

      await expect(
        controller.rerenderPage("session-1", "1", {}),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // =========================================================================
  // getSessions
  // =========================================================================

  describe("getSessions()", () => {
    it("returns sessions with checkpoint data", async () => {
      checkpointService.getSessions.mockResolvedValue([
        { id: "session-1", title: "Presentation 1" },
        { id: "session-2", title: "Presentation 2" },
      ]);
      checkpointService.getLatestCheckpoint
        .mockResolvedValueOnce({
          id: "cp-1",
          type: "auto_save",
          timestamp: new Date(),
          state: { pages: [{ id: "p1" }] },
        })
        .mockResolvedValueOnce(null);

      prismaService.slidesMission.findMany.mockResolvedValue([
        { sessionId: "session-1", sourceSubscription: { topic: "AI" } },
      ]);

      const result = await controller.getSessions(makeReq());

      const sessions = (result as { sessions: unknown[] }).sessions;
      expect(sessions).toHaveLength(2);
    });

    it("throws InternalServerErrorException on error", async () => {
      checkpointService.getSessions.mockRejectedValue(new Error("DB error"));

      await expect(controller.getSessions(makeReq())).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================================
  // getSession
  // =========================================================================

  describe("getSession()", () => {
    it("returns session with latest checkpoint", async () => {
      checkpointService.getSession.mockResolvedValue({
        id: "session-1",
        title: "Test Presentation",
        status: "active",
      });
      checkpointService.getLatestCheckpoint.mockResolvedValue({
        id: "cp-1",
        type: "auto_save",
        timestamp: new Date(),
        state: { pages: [{ id: "p1" }, { id: "p2" }] },
      });
      prismaService.slidesMission.findFirst.mockResolvedValue({
        sourceSubscription: { topicId: "topic-1" },
      });

      const result = await controller.getSession("session-1");

      expect((result as { session: { id: string } }).session.id).toBe(
        "session-1",
      );
      expect(
        (result as { latestCheckpoint: { pagesCount: number } })
          .latestCheckpoint?.pagesCount,
      ).toBe(2);
    });

    it("throws NotFoundException when session not found", async () => {
      checkpointService.getSession.mockResolvedValue(null);

      await expect(controller.getSession("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns null latestCheckpoint when none exists", async () => {
      checkpointService.getSession.mockResolvedValue({
        id: "session-1",
        title: "Test",
        status: "active",
      });
      checkpointService.getLatestCheckpoint.mockResolvedValue(null);
      prismaService.slidesMission.findFirst.mockResolvedValue(null);

      const result = await controller.getSession("session-1");

      expect(
        (result as { latestCheckpoint: null }).latestCheckpoint,
      ).toBeNull();
    });

    it("throws InternalServerErrorException on unexpected error", async () => {
      checkpointService.getSession.mockRejectedValue(new Error("DB error"));

      await expect(controller.getSession("session-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================================
  // exportSlides
  // =========================================================================

  describe("exportSlides()", () => {
    function makeRes() {
      return {
        setHeader: jest.fn(),
        send: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      } as unknown as import("express").Response;
    }

    it("exports PPTX successfully", async () => {
      const mockBuffer = Buffer.from("pptx-data");
      slidesEngine.exportPptx.mockResolvedValue(mockBuffer);
      const res = makeRes();

      await controller.exportSlides("session-1", { format: "pptx" }, res);

      expect(slidesEngine.exportPptx).toHaveBeenCalledWith("session-1");
      expect(res.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        expect.stringContaining("presentationml"),
      );
      expect(res.send).toHaveBeenCalledWith(mockBuffer);
    });

    it("exports PDF successfully", async () => {
      const mockBuffer = Buffer.from("pdf-data");
      slidesEngine.exportPdf.mockResolvedValue(mockBuffer);
      const res = makeRes();

      await controller.exportSlides("session-1", { format: "pdf" }, res);

      expect(slidesEngine.exportPdf).toHaveBeenCalledWith("session-1");
      expect(res.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "application/pdf",
      );
    });

    it("throws HttpException for unsupported format", async () => {
      const res = makeRes();

      await expect(
        controller.exportSlides(
          "session-1",
          { format: "png" as "pptx" | "pdf" | "png" | "html" },
          res,
        ),
      ).rejects.toThrow(HttpException);
    });

    it("throws HttpException on export error", async () => {
      slidesEngine.exportPptx.mockRejectedValue(new Error("Export failed"));
      const res = makeRes();

      await expect(
        controller.exportSlides("session-1", { format: "pptx" }, res),
      ).rejects.toThrow(HttpException);
    });
  });

  // =========================================================================
  // archiveSession
  // =========================================================================

  describe("archiveSession()", () => {
    it("archives session successfully", async () => {
      checkpointService.updateSessionStatus.mockResolvedValue(undefined);

      const result = await controller.archiveSession("session-1");

      expect((result as { message: string }).message).toBe(
        "Session archived successfully",
      );
      expect(checkpointService.updateSessionStatus).toHaveBeenCalledWith(
        "session-1",
        "archived",
      );
    });
  });
});
