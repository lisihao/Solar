/**
 * SlidesCheckpointService Unit Tests
 *
 * Tests for checkpoint creation, restoration, pruning, and session management.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";

import { SlidesCheckpointService } from "../../checkpoint/checkpoint.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { SlidesSessionStatus, SlidesCheckpointType } from "@prisma/client";

import { createMockPrisma, MockPrismaService } from "../mocks";
import {
  mockSession,
  mockSessions,
  mockCheckpoint,
  mockCheckpoints,
  mockUserId,
  mockMission,
} from "../fixtures/slides.fixture";

describe("SlidesCheckpointService", () => {
  let service: SlidesCheckpointService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlidesCheckpointService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SlidesCheckpointService>(SlidesCheckpointService);
  });

  describe("createSession", () => {
    it("should create a new session", async () => {
      prisma.slidesSession.create.mockResolvedValue({
        ...mockSession,
        id: "new-session-id",
      });

      const result = await service.createSession(
        mockUserId,
        "New Presentation",
      );

      expect(prisma.slidesSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockUserId,
          title: "New Presentation",
          status: SlidesSessionStatus.ACTIVE,
        }),
      });
      expect(result.userId).toBe(mockUserId);
      expect(result.title).toBe("Test Presentation");
    });
  });

  describe("getSession", () => {
    it("should return session when found", async () => {
      prisma.slidesSession.findUnique.mockResolvedValue(mockSession);

      const result = await service.getSession("session-1");

      expect(result).toBeDefined();
      expect(result?.id).toBe("session-1");
      expect(result?.status).toBe("active");
    });

    it("should return null when session not found", async () => {
      prisma.slidesSession.findUnique.mockResolvedValue(null);

      const result = await service.getSession("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("getSessions", () => {
    it("should return sessions for user", async () => {
      prisma.slidesSession.findMany.mockResolvedValue(mockSessions);

      const result = await service.getSessions({ userId: mockUserId });

      expect(prisma.slidesSession.findMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        orderBy: { updatedAt: "desc" },
        take: 50,
      });
      expect(result).toHaveLength(2);
    });

    it("should filter by status", async () => {
      prisma.slidesSession.findMany.mockResolvedValue([mockSession]);

      await service.getSessions({ userId: mockUserId, status: "active" });

      expect(prisma.slidesSession.findMany).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
          status: SlidesSessionStatus.ACTIVE,
        },
        orderBy: { updatedAt: "desc" },
        take: 50,
      });
    });

    it("should respect limit parameter", async () => {
      prisma.slidesSession.findMany.mockResolvedValue([mockSession]);

      await service.getSessions({ userId: mockUserId, limit: 10 });

      expect(prisma.slidesSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });
  });

  describe("updateSessionTitle", () => {
    it("should update session title", async () => {
      const updatedSession = { ...mockSession, title: "Updated Title" };
      prisma.slidesSession.update.mockResolvedValue(updatedSession);

      const result = await service.updateSessionTitle(
        "session-1",
        "Updated Title",
      );

      expect(prisma.slidesSession.update).toHaveBeenCalledWith({
        where: { id: "session-1" },
        data: { title: "Updated Title" },
      });
      expect(result.title).toBe("Updated Title");
    });
  });

  describe("deleteSession", () => {
    it("should delete session and all related data", async () => {
      prisma.slidesMission.findMany.mockResolvedValue([mockMission]);
      prisma.slidesMissionEvent.deleteMany.mockResolvedValue({ count: 5 });
      prisma.slidesTask.deleteMany.mockResolvedValue({ count: 3 });
      prisma.slidesMission.deleteMany.mockResolvedValue({ count: 1 });
      prisma.slidesCheckpoint.deleteMany.mockResolvedValue({ count: 2 });
      prisma.slidesSession.delete.mockResolvedValue(mockSession);

      await service.deleteSession("session-1");

      expect(prisma.slidesMission.findMany).toHaveBeenCalledWith({
        where: { sessionId: "session-1" },
        select: { id: true },
      });
      expect(prisma.slidesMissionEvent.deleteMany).toHaveBeenCalled();
      expect(prisma.slidesTask.deleteMany).toHaveBeenCalled();
      expect(prisma.slidesMission.deleteMany).toHaveBeenCalled();
      expect(prisma.slidesCheckpoint.deleteMany).toHaveBeenCalled();
      expect(prisma.slidesSession.delete).toHaveBeenCalledWith({
        where: { id: "session-1" },
      });
    });
  });

  describe("create (checkpoint)", () => {
    it("should create a new checkpoint", async () => {
      prisma.slidesCheckpoint.findFirst.mockResolvedValue(null);
      prisma.slidesCheckpoint.create.mockResolvedValue(mockCheckpoint);
      prisma.slidesSession.update.mockResolvedValue(mockSession);
      prisma.slidesCheckpoint.count.mockResolvedValue(1);

      const result = await service.create({
        sessionId: "session-1",
        type: "task_decomposition",
        state: { taskDecomposition: { totalPages: 5 }, pages: [] } as any,
      });

      expect(prisma.slidesCheckpoint.create).toHaveBeenCalled();
      expect(prisma.slidesSession.update).toHaveBeenCalledWith({
        where: { id: "session-1" },
        data: { currentStateId: expect.any(String) },
      });
      expect(result.type).toBe("task_decomposition");
    });

    it("should generate correct version number", async () => {
      const previousCheckpoint = {
        ...mockCheckpoint,
        version: "1.0.5",
      };
      prisma.slidesCheckpoint.findFirst.mockResolvedValue(previousCheckpoint);
      prisma.slidesCheckpoint.create.mockResolvedValue({
        ...mockCheckpoint,
        version: "1.0.6",
      });
      prisma.slidesSession.update.mockResolvedValue(mockSession);
      prisma.slidesCheckpoint.count.mockResolvedValue(2);

      const result = await service.create({
        sessionId: "session-1",
        type: "page_rendered",
        state: { pages: [{ pageNumber: 0, status: "completed" }] } as any,
      });

      expect(result.version).toBe("1.0.6");
    });
  });

  describe("get (checkpoint)", () => {
    it("should return checkpoint when found", async () => {
      prisma.slidesCheckpoint.findUnique.mockResolvedValue(mockCheckpoint);

      const result = await service.get("checkpoint-1");

      expect(result.id).toBe("checkpoint-1");
      expect(result.type).toBe("task_decomposition");
    });

    it("should throw NotFoundException when not found", async () => {
      prisma.slidesCheckpoint.findUnique.mockResolvedValue(null);

      await expect(service.get("non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("getLatestCheckpoint", () => {
    it("should return latest checkpoint for session", async () => {
      prisma.slidesCheckpoint.findFirst.mockResolvedValue(mockCheckpoints[1]);

      const result = await service.getLatestCheckpoint("session-1");

      expect(prisma.slidesCheckpoint.findFirst).toHaveBeenCalledWith({
        where: { sessionId: "session-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result?.version).toBe("1.0.1");
    });

    it("should return null when no checkpoints exist", async () => {
      prisma.slidesCheckpoint.findFirst.mockResolvedValue(null);

      const result = await service.getLatestCheckpoint("session-1");

      expect(result).toBeNull();
    });
  });

  describe("restore", () => {
    it("should restore to specified checkpoint", async () => {
      prisma.slidesCheckpoint.findUnique.mockResolvedValue(mockCheckpoint);
      prisma.slidesSession.update.mockResolvedValue(mockSession);
      prisma.slidesCheckpoint.findFirst.mockResolvedValue(mockCheckpoint);
      prisma.slidesCheckpoint.create.mockResolvedValue({
        ...mockCheckpoint,
        id: "checkpoint-restored",
        name: "Restored: Task Decomposition",
        type: SlidesCheckpointType.USER_MODIFIED,
      });
      prisma.slidesCheckpoint.count.mockResolvedValue(3);

      const result = await service.restore("checkpoint-1");

      expect(prisma.slidesSession.update).toHaveBeenCalledWith({
        where: { id: "session-1" },
        data: { currentStateId: "checkpoint-1" },
      });
      expect(result.checkpointId).toBe("checkpoint-1");
      expect(result.sessionId).toBe("session-1");
    });
  });

  describe("prune", () => {
    it("should delete old checkpoints beyond limit", async () => {
      const manyCheckpoints = Array.from({ length: 60 }, (_, i) => ({
        ...mockCheckpoint,
        id: `checkpoint-${i}`,
      }));
      prisma.slidesCheckpoint.findMany.mockResolvedValue(manyCheckpoints);
      prisma.slidesCheckpoint.deleteMany.mockResolvedValue({ count: 10 });

      const result = await service.prune("session-1", 50);

      expect(prisma.slidesCheckpoint.deleteMany).toHaveBeenCalledWith({
        where: {
          id: { in: expect.any(Array) },
        },
      });
      expect(result).toBe(10);
    });

    it("should not delete when under limit", async () => {
      prisma.slidesCheckpoint.findMany.mockResolvedValue(mockCheckpoints);

      const result = await service.prune("session-1", 50);

      expect(prisma.slidesCheckpoint.deleteMany).not.toHaveBeenCalled();
      expect(result).toBe(0);
    });
  });

  describe("diff", () => {
    it("should compare two checkpoints", async () => {
      const cp1 = {
        ...mockCheckpoint,
        stateJson: {
          taskDecomposition: { totalPages: 5 },
          outlinePlan: null,
          pages: [],
        },
      };
      const cp2 = {
        ...mockCheckpoint,
        id: "checkpoint-2",
        stateJson: {
          taskDecomposition: { totalPages: 5 },
          outlinePlan: { pages: [] },
          pages: [{ pageNumber: 0, status: "completed" }],
        },
      };

      prisma.slidesCheckpoint.findUnique
        .mockResolvedValueOnce(cp1)
        .mockResolvedValueOnce(cp2);

      const result = await service.diff("checkpoint-1", "checkpoint-2");

      expect(result.from.id).toBe("checkpoint-1");
      expect(result.to.id).toBe("checkpoint-2");
      expect(result.pagesAdded).toContain(0);
    });
  });

  describe("autoSave configuration", () => {
    it("should get default auto-save config", () => {
      const config = service.getAutoSaveConfig();

      expect(config.phaseComplete).toBe(true);
      expect(config.pageInterval).toBe(5);
      expect(config.maxCheckpoints).toBe(50);
    });

    it("should update auto-save config", () => {
      service.setAutoSaveConfig({ pageInterval: 3 });

      const config = service.getAutoSaveConfig();
      expect(config.pageInterval).toBe(3);
    });

    it("should determine if auto-save is needed", () => {
      expect(service.shouldAutoSave("phase_complete")).toBe(true);
      expect(service.shouldAutoSave("page_rendered", 5)).toBe(true);
      expect(service.shouldAutoSave("page_rendered", 3)).toBe(false);
    });
  });
});
