/**
 * SlidesController Supplemental3 Tests
 *
 * Covers endpoints not hit by supplemental / supplemental2:
 * - getThemesList() — success, getAllThemes mapped shape
 * - getCheckpoints() — success with limit, error
 * - createCheckpoint() — success, no latest checkpoint error, service error
 * - getCheckpoint() — success, not found error
 * - restoreCheckpoint() — success, error
 * - rerenderPage() — success, error
 * - getSessions() — success, error
 * - getSession() — success, session not found, generic error
 * - exportSlides() — pptx success, pdf success, unsupported format, error
 * - generateSlides() (SSE Observable) — success + error paths
 */

jest.mock("@prisma/client", () => {
  const enumProxy = new Proxy(
    {},
    { get: (_t, prop) => (typeof prop === "string" ? prop : undefined) },
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

jest.mock("../../templates/base/themes", () => ({
  getAllThemes: jest.fn().mockReturnValue([
    {
      id: "dark-pro",
      name: "Dark Pro",
      description: "A dark theme",
      preview: "/preview.png",
      colors: {
        background: { primary: "#000" },
        accent: { primary: "#f00" },
        text: { primary: "#fff" },
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

// ---- Mock factories ----

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
    getSession: jest.fn().mockResolvedValue(null),
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
    status: jest.fn().mockReturnThis(),
  } as unknown as jest.Mocked<Response>;
}

// ---- Test suite ----

describe("SlidesController (supplemental3)", () => {
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

  // ======================================================================
  // getThemesList
  // ======================================================================

  describe("getThemesList()", () => {
    it("returns mapped theme list", async () => {
      const result = await controller.getThemesList();

      expect((result as { themes: unknown[] }).themes).toHaveLength(1);
      const theme = (
        result as {
          themes: { id: string; name: string; colors: { primary: string } }[];
        }
      ).themes[0];
      expect(theme.id).toBe("dark-pro");
      expect(theme.name).toBe("Dark Pro");
      expect(theme.colors.primary).toBe("#000");
    });
  });

  // ======================================================================
  // getCheckpoints
  // ======================================================================

  describe("getCheckpoints()", () => {
    it("returns checkpoint list for session", async () => {
      const checkpoints = [
        { id: "cp-1", type: "auto_save", version: 1, timestamp: new Date() },
        {
          id: "cp-2",
          type: "user_modified",
          version: 2,
          timestamp: new Date(),
        },
      ];
      checkpointService.list.mockResolvedValue(checkpoints);

      const result = await controller.getCheckpoints("session-1");

      expect(
        (result as { checkpoints: typeof checkpoints }).checkpoints,
      ).toEqual(checkpoints);
    });

    it("applies limit to checkpoint list", async () => {
      const checkpoints = Array.from({ length: 10 }, (_, i) => ({
        id: `cp-${i}`,
        type: "auto_save",
        version: i,
        timestamp: new Date(),
      }));
      checkpointService.list.mockResolvedValue(checkpoints);

      const result = await controller.getCheckpoints("session-1", "3");

      expect((result as { checkpoints: unknown[] }).checkpoints).toHaveLength(
        3,
      );
    });

    it("throws InternalServerErrorException on error", async () => {
      checkpointService.list.mockRejectedValue(new Error("DB error"));

      await expect(controller.getCheckpoints("session-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ======================================================================
  // createCheckpoint
  // ======================================================================

  describe("createCheckpoint()", () => {
    it("throws BadRequestException when no latest checkpoint", async () => {
      checkpointService.getLatestCheckpoint.mockResolvedValue(null);

      await expect(
        controller.createCheckpoint("session-1", { name: "Manual save" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("creates checkpoint from latest state", async () => {
      const latestCheckpoint = {
        id: "cp-0",
        state: { pages: [], outlinePlan: null, taskDecomposition: null },
        type: "auto_save",
        version: 1,
        timestamp: new Date(),
      };
      checkpointService.getLatestCheckpoint.mockResolvedValue(latestCheckpoint);

      const newCheckpoint = {
        id: "cp-new",
        name: "My Save",
        type: "user_modified",
        version: 2,
        timestamp: new Date(),
      };
      checkpointService.create.mockResolvedValue(newCheckpoint);

      const result = await controller.createCheckpoint("session-1", {
        name: "My Save",
        type: "user_modified",
      });

      expect((result as { checkpoint: { id: string } }).checkpoint.id).toBe(
        "cp-new",
      );
    });

    it("throws InternalServerErrorException on service error", async () => {
      const latestCheckpoint = {
        id: "cp-0",
        state: { pages: [] },
        type: "auto_save",
        version: 1,
        timestamp: new Date(),
      };
      checkpointService.getLatestCheckpoint.mockResolvedValue(latestCheckpoint);
      checkpointService.create.mockRejectedValue(new Error("Create failed"));

      await expect(
        controller.createCheckpoint("session-1", {}),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ======================================================================
  // getCheckpoint
  // ======================================================================

  describe("getCheckpoint()", () => {
    it("returns checkpoint state by id", async () => {
      const checkpoint = {
        id: "cp-1",
        sessionId: "session-1",
        state: { pages: [{ id: "p1" }, { id: "p2" }], outlinePlan: {} },
      };
      checkpointService.get.mockResolvedValue(checkpoint);

      const result = await controller.getCheckpoint("cp-1");

      expect((result as { checkpointId: string }).checkpointId).toBe("cp-1");
      expect((result as { sessionId: string }).sessionId).toBe("session-1");
      expect((result as { state: typeof checkpoint.state }).state).toEqual(
        checkpoint.state,
      );
    });

    it("throws NotFoundException on error", async () => {
      checkpointService.get.mockRejectedValue(new Error("Not found"));

      await expect(controller.getCheckpoint("unknown-cp")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ======================================================================
  // restoreCheckpoint
  // ======================================================================

  describe("restoreCheckpoint()", () => {
    it("restores checkpoint and returns summary", async () => {
      slidesEngine.restoreCheckpoint.mockResolvedValue({
        sessionId: "session-1",
        state: {
          pages: [{ id: "p1" }, { id: "p2" }],
          outlinePlan: { title: "Plan" },
          taskDecomposition: {},
        },
      });
      checkpointService.getSession.mockResolvedValue({
        id: "session-1",
        title: "My Presentation",
      });

      const result = await controller.restoreCheckpoint("cp-1");

      expect((result as { message: string }).message).toBe(
        "Checkpoint restored successfully",
      );
      expect((result as { sessionId: string }).sessionId).toBe("session-1");
      expect(
        (result as { state: { pagesCount: number } }).state.pagesCount,
      ).toBe(2);
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

  // ======================================================================
  // rerenderPage
  // ======================================================================

  describe("rerenderPage()", () => {
    it("rerenders page and returns events", async () => {
      const events = [{ type: "page_rendered", pageNumber: 3 }];
      slidesEngine.regeneratePage.mockResolvedValue(events);

      const result = await controller.rerenderPage("session-1", "3", {
        feedback: "Make it clearer",
      });

      expect((result as { events: typeof events }).events).toEqual(events);
      expect(slidesEngine.regeneratePage).toHaveBeenCalledWith(
        "session-1",
        3,
        "Make it clearer",
      );
    });

    it("throws InternalServerErrorException on error", async () => {
      slidesEngine.regeneratePage.mockRejectedValue(
        new Error("Rerender failed"),
      );

      await expect(
        controller.rerenderPage("session-1", "2", {}),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ======================================================================
  // getSessions
  // ======================================================================

  describe("getSessions()", () => {
    it("returns sessions with latest checkpoint info", async () => {
      const sessions = [{ id: "sess-1", title: "My PPT", status: "active" }];
      checkpointService.getSessions.mockResolvedValue(sessions);
      checkpointService.getLatestCheckpoint.mockResolvedValue({
        id: "cp-1",
        type: "auto_save",
        timestamp: new Date(),
        state: { pages: [1, 2, 3] },
      });
      prismaService.slidesMission.findMany.mockResolvedValue([
        { sessionId: "sess-1", sourceSubscription: { type: "topic-insights" } },
      ]);

      const result = await controller.getSessions(makeReq(), "active", "10");

      const sess = (
        result as {
          sessions: { id: string; latestCheckpoint: { pagesCount: number } }[];
        }
      ).sessions[0];
      expect(sess.id).toBe("sess-1");
      expect(sess.latestCheckpoint.pagesCount).toBe(3);
    });

    it("returns sessions with null latestCheckpoint when none exist", async () => {
      checkpointService.getSessions.mockResolvedValue([
        { id: "sess-2", title: "Empty PPT", status: "active" },
      ]);
      checkpointService.getLatestCheckpoint.mockResolvedValue(null);
      prismaService.slidesMission.findMany.mockResolvedValue([]);

      const result = await controller.getSessions(makeReq());

      const sess = (
        result as { sessions: { id: string; latestCheckpoint: null }[] }
      ).sessions[0];
      expect(sess.latestCheckpoint).toBeNull();
    });

    it("throws InternalServerErrorException on error", async () => {
      checkpointService.getSessions.mockRejectedValue(new Error("DB error"));

      await expect(controller.getSessions(makeReq())).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ======================================================================
  // getSession
  // ======================================================================

  describe("getSession()", () => {
    it("returns session with latest checkpoint", async () => {
      const session = { id: "sess-1", title: "My Slides", status: "active" };
      checkpointService.getSession.mockResolvedValue(session);
      checkpointService.getLatestCheckpoint.mockResolvedValue({
        id: "cp-1",
        type: "auto_save",
        timestamp: new Date(),
        state: { pages: [1] },
      });
      prismaService.slidesMission.findFirst.mockResolvedValue({
        sourceSubscription: { type: "research-project", sourceId: "proj-1" },
      });

      const result = await controller.getSession("sess-1");

      expect((result as { session: typeof session }).session).toEqual(session);
      expect(
        (result as { latestCheckpoint: { id: string } }).latestCheckpoint?.id,
      ).toBe("cp-1");
    });

    it("throws NotFoundException when session does not exist", async () => {
      checkpointService.getSession.mockResolvedValue(null);

      await expect(controller.getSession("unknown-session")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws InternalServerErrorException on generic error", async () => {
      checkpointService.getSession.mockRejectedValue(new Error("DB error"));

      await expect(controller.getSession("session-1")).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ======================================================================
  // exportSlides
  // ======================================================================

  describe("exportSlides()", () => {
    it("exports as pptx", async () => {
      const buffer = Buffer.from("pptx content");
      slidesEngine.exportPptx.mockResolvedValue(buffer);
      const res = makeRes();

      await controller.exportSlides("session-1", { format: "pptx" }, res);

      expect(res.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
      expect(res.send).toHaveBeenCalledWith(buffer);
    });

    it("exports as pdf", async () => {
      const buffer = Buffer.from("pdf content");
      slidesEngine.exportPdf.mockResolvedValue(buffer);
      const res = makeRes();

      await controller.exportSlides("session-1", { format: "pdf" }, res);

      expect(res.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "application/pdf",
      );
      expect(res.send).toHaveBeenCalledWith(buffer);
    });

    it("throws HttpException for unsupported format", async () => {
      const res = makeRes();

      await expect(
        controller.exportSlides(
          "session-1",
          { format: "png" as unknown as "pptx" },
          res,
        ),
      ).rejects.toThrow(HttpException);
    });

    it("throws HttpException on export engine error", async () => {
      slidesEngine.exportPptx.mockRejectedValue(new Error("Export failed"));
      const res = makeRes();

      await expect(
        controller.exportSlides("session-1", { format: "pptx" }, res),
      ).rejects.toThrow(HttpException);
    });
  });

  // ======================================================================
  // generateSlides (SSE Observable)
  // ======================================================================

  describe("generateSlides() SSE observable", () => {
    it("emits SSE events from generator", (done) => {
      async function* fakeGen() {
        yield { type: "started" };
        yield { type: "page_rendered", pageNumber: 1 };
      }
      slidesEngine.generateSlides.mockReturnValue(fakeGen());

      const req = makeReq();
      const observable = controller.generateSlides(
        req,
        "Test Title",
        "Source text",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      const events: unknown[] = [];
      observable.subscribe({
        next: (event) => events.push(event),
        error: done.fail,
        complete: () => {
          expect(events.length).toBeGreaterThan(0);
          done();
        },
      });
    });

    it("emits error SSE event when generator throws", (done) => {
      async function* failingGen() {
        yield { type: "started" };
        throw new Error("SSE generation error");
      }
      slidesEngine.generateSlides.mockReturnValue(failingGen());

      const req = makeReq();
      const observable = controller.generateSlides(
        req,
        "Test Title",
        "Source text",
      );

      const events: unknown[] = [];
      observable.subscribe({
        next: (event) => events.push(event),
        error: done.fail,
        complete: () => {
          const hasErrorEvent = events.some((e) => {
            const parsed = JSON.parse((e as { data: string }).data);
            return parsed.type === "error";
          });
          expect(hasErrorEvent).toBe(true);
          done();
        },
      });
    });
  });
});
