/**
 * Tests for DiscussionOrchestratorService (thin facade)
 *
 * Since DiscussionOrchestratorService is a thin facade that delegates to
 * DiscussionPhaseCoordinatorService (research execution) and
 * DiscussionSessionService (session CRUD), we mock those sub-services directly.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { DiscussionOrchestratorService } from "../discussion/discussion-orchestrator.service";
import { DiscussionPhaseCoordinatorService } from "../discussion/discussion-phase-coordinator.service";
import { DiscussionSessionService } from "../discussion/discussion-session.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { Observable, Subject } from "rxjs";

jest.mock("@prisma/client", () => ({
  AIModelType: {
    CHAT: "CHAT",
    CHAT_FAST: "CHAT_FAST",
  },
  DeepResearchStatus: {
    IDEATION: "IDEATION",
    PLANNING: "PLANNING",
    SEARCHING: "SEARCHING",
    FINDINGS: "FINDINGS",
    REFLECTING: "REFLECTING",
    SYNTHESIZING: "SYNTHESIZING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
  },
  PrismaClient: class MockPrismaClient {},
}));

jest.mock("../../../../common/prisma/prisma.service", () => ({
  PrismaService: jest.fn().mockImplementation(() => ({
    researchProject: {
      findUnique: jest.fn(),
    },
    deepResearchSession: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  })),
}));

jest.mock("../../../platform/facade", () => ({
  BillingContext: {
    run: jest.fn((_ctx: unknown, fn: () => unknown) => fn()),
  },
}));

describe("DiscussionOrchestratorService", () => {
  let service: DiscussionOrchestratorService;
  let prisma: jest.Mocked<PrismaService>;
  let coordinator: jest.Mocked<DiscussionPhaseCoordinatorService>;
  let sessionService: jest.Mocked<DiscussionSessionService>;

  const projectId = "project-123";
  const sessionId = "session-456";

  const mockSession = {
    id: sessionId,
    projectId,
    status: "COMPLETED",
    discussion: [{ id: "msg1", content: "Test" }],
    updatedAt: new Date(),
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const mockPrismaService = {
      researchProject: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: projectId, userId: "user-123" }),
      },
      deepResearchSession: {
        findUnique: jest.fn().mockResolvedValue(mockSession),
        findMany: jest.fn().mockResolvedValue([mockSession]),
        create: jest.fn().mockResolvedValue(mockSession),
        update: jest.fn().mockResolvedValue(mockSession),
        delete: jest.fn().mockResolvedValue(mockSession),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const mockCoordinator = {
      executeDiscussion: jest.fn().mockResolvedValue(undefined),
      generatePlanOnly: jest.fn().mockResolvedValue({}),
      approvePlan: jest.fn().mockResolvedValue(new Observable()),
    };

    const mockSessionService = {
      getSession: jest.fn().mockResolvedValue(mockSession),
      getProjectSessions: jest.fn().mockResolvedValue([mockSession]),
      deleteSession: jest.fn().mockResolvedValue(mockSession),
      deleteSessions: jest.fn().mockResolvedValue({ count: 1 }),
      updateSession: jest.fn().mockResolvedValue(mockSession),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscussionOrchestratorService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: DiscussionPhaseCoordinatorService,
          useValue: mockCoordinator,
        },
        { provide: DiscussionSessionService, useValue: mockSessionService },
      ],
    }).compile();

    service = module.get<DiscussionOrchestratorService>(
      DiscussionOrchestratorService,
    );
    prisma = module.get(PrismaService);
    coordinator = module.get(DiscussionPhaseCoordinatorService);
    sessionService = module.get(DiscussionSessionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getSession", () => {
    it("should delegate to DiscussionSessionService.getSession", async () => {
      const result = await service.getSession(sessionId);

      expect(result).toBe(mockSession);
      expect(sessionService.getSession).toHaveBeenCalledWith(sessionId);
    });
  });

  describe("getProjectSessions", () => {
    it("should delegate to DiscussionSessionService.getProjectSessions", async () => {
      const result = await service.getProjectSessions(projectId);

      expect(Array.isArray(result)).toBe(true);
      expect(sessionService.getProjectSessions).toHaveBeenCalledWith(projectId);
    });

    it("should auto-correct stale sessions via DiscussionSessionService", async () => {
      const staleCutoff = Date.now() - 20 * 60 * 1000;
      const correctedSession = {
        ...mockSession,
        status: "COMPLETED",
        updatedAt: new Date(staleCutoff),
      };
      (sessionService.getProjectSessions as jest.Mock).mockResolvedValue([
        correctedSession,
      ]);

      const result = await service.getProjectSessions(projectId);

      expect(result[0].status).toBe("COMPLETED");
      expect(sessionService.getProjectSessions).toHaveBeenCalledWith(projectId);
    });

    it("should return sessions from sub-service", async () => {
      const recentSession = {
        ...mockSession,
        status: "SEARCHING",
        updatedAt: new Date(),
      };

      (sessionService.getProjectSessions as jest.Mock).mockResolvedValue([
        recentSession,
      ]);

      const result = await service.getProjectSessions(projectId);

      expect(result).toHaveLength(1);
      expect(sessionService.getProjectSessions).toHaveBeenCalledWith(projectId);
    });
  });

  describe("deleteSession", () => {
    it("should delegate to DiscussionSessionService.deleteSession", async () => {
      await service.deleteSession(sessionId);

      expect(sessionService.deleteSession).toHaveBeenCalledWith(sessionId);
    });
  });

  describe("deleteSessions", () => {
    it("should delegate to DiscussionSessionService.deleteSessions", async () => {
      const sessionIds = ["session-1", "session-2"];
      await service.deleteSessions(sessionIds);

      expect(sessionService.deleteSessions).toHaveBeenCalledWith(sessionIds);
    });
  });

  describe("startResearch", () => {
    it("should return an Observable", () => {
      const obs = service.startResearch(projectId, { query: "test query" });
      expect(obs).toBeDefined();
      expect(typeof obs.subscribe).toBe("function");
    });

    it("should emit error event when project not found", (done) => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(null);

      const events: any[] = [];
      service.startResearch(projectId, { query: "test query" }).subscribe({
        next: (event) => events.push(event),
        error: (err) => done.fail(err),
        complete: () => {
          expect(events.some((e) => e.type === "error")).toBe(true);
          const errorEvent = events.find((e) => e.type === "error");
          expect(errorEvent.data.code).toBe("EXECUTION_ERROR");
          done();
        },
      });
    });

    it("should call coordinator.executeDiscussion when project is found", (done) => {
      (coordinator.executeDiscussion as jest.Mock).mockImplementation(
        async (_projectId: string, _dto: any, subject: Subject<any>) => {
          subject.next({
            type: "interaction.complete",
            data: { status: "success" },
          });
          subject.complete();
        },
      );

      service.startResearch(projectId, { query: "test query" }).subscribe({
        next: () => {},
        error: (err) => done.fail(err),
        complete: () => {
          expect(coordinator.executeDiscussion).toHaveBeenCalled();
          done();
        },
      });
    });
  });
});
