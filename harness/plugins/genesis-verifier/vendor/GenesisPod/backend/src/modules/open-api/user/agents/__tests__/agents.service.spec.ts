/**
 * AgentsService unit tests
 *
 * Tests task management and persistence:
 * - createTask()
 * - getTask()
 * - updateTaskStatus()
 * - updateTaskPlan()
 * - updateTaskResult()
 * - saveArtifact()
 * - getArtifacts()
 * - getArtifactDownload()
 * - cancelTask()
 * - publishEvent() / getTaskStream()
 * - getUserTasks()
 * - cleanupExpiredTasks()
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { firstValueFrom } from "rxjs";
import { take } from "rxjs/operators";
import { AgentsService } from "../agents.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  OfficeAgentType,
  OfficeTaskStatus,
  OfficeArtifactType,
} from "@prisma/client";

describe("AgentsService", () => {
  let service: AgentsService;
  let mockPrisma: any;

  const makeTask = (overrides = {}) => ({
    id: "task-1",
    userId: "user-1",
    agentType: OfficeAgentType.DOCS,
    status: OfficeTaskStatus.PENDING,
    input: {},
    plan: null,
    result: null,
    tokensUsed: null,
    error: null,
    startedAt: null,
    completedAt: null,
    duration: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    artifacts: [],
    ...overrides,
  });

  beforeEach(async () => {
    mockPrisma = {
      officeAgentTask: {
        create: jest.fn().mockResolvedValue(makeTask()),
        findUnique: jest.fn().mockResolvedValue(makeTask()),
        findFirst: jest.fn().mockResolvedValue(makeTask()),
        update: jest.fn().mockResolvedValue(makeTask()),
        findMany: jest.fn().mockResolvedValue([makeTask()]),
        deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
      officeAgentArtifact: {
        create: jest.fn().mockResolvedValue({ id: "artifact-1" }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "artifact-1",
            type: OfficeArtifactType.DOCX,
            name: "output.docx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: 1024,
            url: "https://storage.example.com/output.docx",
            content: null,
          },
        ]),
        findUnique: jest.fn().mockResolvedValue({
          id: "artifact-1",
          type: OfficeArtifactType.DOCX,
          name: "output.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          size: 1024,
          url: "https://storage.example.com/output.docx",
          content: null,
          // ★ IDOR：getArtifactDownload 经父 task.userId 校验归属
          task: { userId: "user-1" },
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AgentsService>(AgentsService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== createTask ====================

  describe("createTask", () => {
    it("should create a DOCS task when no agentId is provided", async () => {
      const result = await service.createTask({
        userId: "user-1",
        input: { prompt: "Write a report" },
      });

      expect(mockPrisma.officeAgentTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-1",
            agentType: OfficeAgentType.DOCS,
            status: OfficeTaskStatus.PENDING,
          }),
        }),
      );
      expect(result.id).toBeDefined();
    });

    it("should map slides agentId to SLIDES agent type", async () => {
      await service.createTask({
        userId: "user-1",
        agentId: "slides",
        input: { prompt: "Make slides" },
      });

      expect(mockPrisma.officeAgentTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentType: OfficeAgentType.SLIDES,
          }),
        }),
      );
    });

    it("should map designer agentId to DESIGNER agent type", async () => {
      await service.createTask({
        userId: "user-2",
        agentId: "designer",
        input: { prompt: "Design infographic" },
      });

      expect(mockPrisma.officeAgentTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentType: OfficeAgentType.DESIGNER,
          }),
        }),
      );
    });

    it("should handle optional userId", async () => {
      await service.createTask({
        input: { prompt: "Anonymous task" },
      });

      expect(mockPrisma.officeAgentTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: undefined,
          }),
        }),
      );
    });
  });

  // ==================== getTask ====================

  describe("getTask", () => {
    it("should return task scoped to owner with artifacts when found", async () => {
      const task = await service.getTask("task-1", "user-1");

      expect(mockPrisma.officeAgentTask.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-1", userId: "user-1" },
          include: { artifacts: true },
        }),
      );
      expect(task).toBeDefined();
    });

    it("should return null when task not found", async () => {
      mockPrisma.officeAgentTask.findFirst.mockResolvedValueOnce(null);
      const task = await service.getTask("nonexistent", "user-1");
      expect(task).toBeNull();
    });

    it("IDOR: returns null for a non-owner (other user's task)", async () => {
      // 非属主查询时 findFirst(where:{id,userId}) 不命中 → null（controller 转 404）
      mockPrisma.officeAgentTask.findFirst.mockResolvedValueOnce(null);
      const task = await service.getTask("task-1", "attacker-9");
      expect(task).toBeNull();
      expect(mockPrisma.officeAgentTask.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-1", userId: "attacker-9" },
        }),
      );
    });
  });

  // ==================== updateTaskStatus ====================

  describe("updateTaskStatus", () => {
    it("should update status to PLANNING", async () => {
      await service.updateTaskStatus("task-1", "PLANNING");

      expect(mockPrisma.officeAgentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-1" },
          data: expect.objectContaining({
            status: OfficeTaskStatus.PLANNING,
          }),
        }),
      );
    });

    it("should set startedAt when transitioning to EXECUTING", async () => {
      mockPrisma.officeAgentTask.findUnique.mockResolvedValueOnce(
        makeTask({ startedAt: null }),
      );

      await service.updateTaskStatus("task-1", "EXECUTING");

      expect(mockPrisma.officeAgentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: OfficeTaskStatus.EXECUTING,
            startedAt: expect.any(Date),
          }),
        }),
      );
    });

    it("should not overwrite startedAt if already set", async () => {
      mockPrisma.officeAgentTask.findUnique.mockResolvedValueOnce(
        makeTask({ startedAt: new Date("2025-01-01T00:00:00Z") }),
      );

      await service.updateTaskStatus("task-1", "EXECUTING");

      const updateCall = mockPrisma.officeAgentTask.update.mock.calls[0][0];
      expect(updateCall.data.startedAt).toBeUndefined();
    });

    it("should set completedAt and calculate duration when COMPLETED", async () => {
      const startedAt = new Date(Date.now() - 5000);
      mockPrisma.officeAgentTask.findUnique.mockResolvedValueOnce(
        makeTask({ startedAt }),
      );

      await service.updateTaskStatus("task-1", "COMPLETED");

      expect(mockPrisma.officeAgentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: OfficeTaskStatus.COMPLETED,
            completedAt: expect.any(Date),
            duration: expect.any(Number),
          }),
        }),
      );
    });

    it("should set completedAt when FAILED", async () => {
      mockPrisma.officeAgentTask.findUnique.mockResolvedValueOnce(
        makeTask({ startedAt: null }),
      );

      await service.updateTaskStatus("task-1", "FAILED", "Some error message");

      expect(mockPrisma.officeAgentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: OfficeTaskStatus.FAILED,
            error: "Some error message",
            completedAt: expect.any(Date),
          }),
        }),
      );
    });

    it("should update to CANCELLED without extra fields", async () => {
      await service.updateTaskStatus("task-1", "CANCELLED");

      expect(mockPrisma.officeAgentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: OfficeTaskStatus.CANCELLED,
          }),
        }),
      );
    });
  });

  // ==================== updateTaskPlan ====================

  describe("updateTaskPlan", () => {
    it("should update task plan", async () => {
      const plan = { steps: ["step1", "step2"] } as any;
      await service.updateTaskPlan("task-1", plan);

      expect(mockPrisma.officeAgentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-1" },
          data: { plan },
        }),
      );
    });
  });

  // ==================== updateTaskResult ====================

  describe("updateTaskResult", () => {
    it("should update task result and tokensUsed", async () => {
      const result = { success: true, tokensUsed: 500, output: "Done" } as any;
      await service.updateTaskResult("task-1", result);

      expect(mockPrisma.officeAgentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-1" },
          data: { result, tokensUsed: 500 },
        }),
      );
    });
  });

  // ==================== saveArtifact ====================

  describe("saveArtifact", () => {
    it("should save a PPTX artifact", async () => {
      await service.saveArtifact("task-1", {
        id: "art-1",
        type: "pptx",
        name: "presentation.pptx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size: 2048,
        url: "https://storage.example.com/presentation.pptx",
      });

      expect(mockPrisma.officeAgentArtifact.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taskId: "task-1",
            type: OfficeArtifactType.PPTX,
            name: "presentation.pptx",
          }),
        }),
      );
    });

    it("should map all artifact types correctly", async () => {
      const typeMap: Array<[string, OfficeArtifactType]> = [
        ["pptx", OfficeArtifactType.PPTX],
        ["docx", OfficeArtifactType.DOCX],
        ["pdf", OfficeArtifactType.PDF],
        ["image", OfficeArtifactType.IMAGE],
        ["code", OfficeArtifactType.CODE],
        ["data", OfficeArtifactType.DATA],
        ["unknown", OfficeArtifactType.DATA], // default fallback
      ];

      for (const [inputType, expectedType] of typeMap) {
        mockPrisma.officeAgentArtifact.create.mockClear();
        await service.saveArtifact("task-1", {
          id: `art-${inputType}`,
          type: inputType as any,
          name: `file.${inputType}`,
          mimeType: "application/octet-stream",
          size: 100,
        });

        expect(mockPrisma.officeAgentArtifact.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ type: expectedType }),
          }),
        );
      }
    });
  });

  // ==================== getArtifacts ====================

  describe("getArtifacts", () => {
    it("should return mapped artifacts for the owner", async () => {
      const artifacts = await service.getArtifacts("task-1", "user-1");

      expect(mockPrisma.officeAgentTask.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-1", userId: "user-1" },
        }),
      );
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0].id).toBe("artifact-1");
      expect(artifacts[0].type).toBe("docx"); // lowercased
      expect(artifacts[0].name).toBe("output.docx");
    });

    it("should handle null url by returning undefined", async () => {
      mockPrisma.officeAgentArtifact.findMany.mockResolvedValueOnce([
        {
          id: "artifact-2",
          type: OfficeArtifactType.DATA,
          name: "data.json",
          mimeType: "application/json",
          size: 512,
          url: null,
          content: { key: "value" },
        },
      ]);

      const artifacts = await service.getArtifacts("task-1", "user-1");
      expect(artifacts[0].url).toBeUndefined();
    });

    it("IDOR: throws NotFound for a non-owner and never reads artifacts", async () => {
      mockPrisma.officeAgentTask.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.getArtifacts("task-1", "attacker-9"),
      ).rejects.toThrow("Task not found");
      expect(mockPrisma.officeAgentArtifact.findMany).not.toHaveBeenCalled();
    });
  });

  // ==================== getArtifactDownload ====================

  describe("getArtifactDownload", () => {
    it("should return artifact download info for the owner", async () => {
      const download = await service.getArtifactDownload(
        "artifact-1",
        "user-1",
      );

      expect(download.url).toBe("https://storage.example.com/output.docx");
      expect(download.name).toBe("output.docx");
      expect(download.mimeType).toContain("wordprocessingml");
    });

    it("should throw when artifact not found", async () => {
      mockPrisma.officeAgentArtifact.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.getArtifactDownload("nonexistent", "user-1"),
      ).rejects.toThrow("Artifact not found");
    });

    it("IDOR: throws NotFound when artifact belongs to another user", async () => {
      mockPrisma.officeAgentArtifact.findUnique.mockResolvedValueOnce({
        id: "artifact-1",
        type: OfficeArtifactType.DOCX,
        name: "output.docx",
        mimeType: "application/octet-stream",
        size: 1024,
        url: "https://storage.example.com/output.docx",
        content: null,
        task: { userId: "victim-1" },
      });

      await expect(
        service.getArtifactDownload("artifact-1", "attacker-9"),
      ).rejects.toThrow("Artifact not found");
    });
  });

  // ==================== cancelTask ====================

  describe("cancelTask", () => {
    it("should cancel an EXECUTING task owned by the user and return true", async () => {
      mockPrisma.officeAgentTask.findFirst.mockResolvedValueOnce(
        makeTask({ status: OfficeTaskStatus.EXECUTING }),
      );

      const result = await service.cancelTask("task-1", "user-1");

      expect(result).toBe(true);
      expect(mockPrisma.officeAgentTask.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-1", userId: "user-1" },
        }),
      );
      expect(mockPrisma.officeAgentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: OfficeTaskStatus.CANCELLED },
        }),
      );
    });

    it("should return false when task is not EXECUTING", async () => {
      mockPrisma.officeAgentTask.findFirst.mockResolvedValueOnce(
        makeTask({ status: OfficeTaskStatus.COMPLETED }),
      );

      const result = await service.cancelTask("task-1", "user-1");
      expect(result).toBe(false);
    });

    it("should return false when task not found", async () => {
      mockPrisma.officeAgentTask.findFirst.mockResolvedValueOnce(null);

      const result = await service.cancelTask("nonexistent", "user-1");
      expect(result).toBe(false);
    });

    it("IDOR: non-owner cancel does not match the task and never updates", async () => {
      mockPrisma.officeAgentTask.findFirst.mockResolvedValueOnce(null);

      const result = await service.cancelTask("task-1", "attacker-9");
      expect(result).toBe(false);
      expect(mockPrisma.officeAgentTask.update).not.toHaveBeenCalled();
    });
  });

  // ==================== publishEvent / getTaskStream ====================

  describe("publishEvent / getTaskStream", () => {
    it("should emit events to task stream", async () => {
      const taskId = "task-stream-1";
      const event = { type: "progress" as const, step: "Thinking..." };

      const eventPromise = firstValueFrom(
        service.getTaskStream(taskId).pipe(take(1)),
      );

      service.publishEvent(taskId, event as any);

      const received = await eventPromise;
      expect(received).toEqual(event);
    });

    it("should only emit events for the matching taskId", async () => {
      const receivedEvents: any[] = [];
      const subscription = service.getTaskStream("task-A").subscribe((e) => {
        receivedEvents.push(e);
      });

      service.publishEvent("task-B", { type: "progress" } as any);
      service.publishEvent("task-A", { type: "complete" } as any);

      await new Promise((r) => setTimeout(r, 10));
      subscription.unsubscribe();

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe("complete");
    });
  });

  // ==================== getUserTasks ====================

  describe("getUserTasks", () => {
    it("should query tasks for a user with default pagination", async () => {
      await service.getUserTasks("user-1");

      expect(mockPrisma.officeAgentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1" },
          orderBy: { createdAt: "desc" },
          take: 20,
          skip: 0,
          include: { artifacts: true },
        }),
      );
    });

    it("should apply agentId filter when provided", async () => {
      await service.getUserTasks("user-1", { agentId: "slides" });

      expect(mockPrisma.officeAgentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            agentType: OfficeAgentType.SLIDES,
          }),
        }),
      );
    });

    it("should apply status filter when provided", async () => {
      await service.getUserTasks("user-1", { status: "COMPLETED" });

      expect(mockPrisma.officeAgentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: OfficeTaskStatus.COMPLETED,
          }),
        }),
      );
    });

    it("should apply custom limit and offset", async () => {
      await service.getUserTasks("user-1", { limit: 5, offset: 10 });

      expect(mockPrisma.officeAgentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 5,
          skip: 10,
        }),
      );
    });
  });

  // ==================== cleanupExpiredTasks ====================

  describe("cleanupExpiredTasks", () => {
    it("should delete completed and failed tasks older than maxAge", async () => {
      const count = await service.cleanupExpiredTasks(3600000); // 1 hour

      expect(mockPrisma.officeAgentTask.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({ lt: expect.any(Date) }),
            status: expect.objectContaining({
              in: [OfficeTaskStatus.COMPLETED, OfficeTaskStatus.FAILED],
            }),
          }),
        }),
      );
      expect(count).toBe(3);
    });

    it("should use default maxAge of 24 hours", async () => {
      await service.cleanupExpiredTasks();

      const callArgs = mockPrisma.officeAgentTask.deleteMany.mock.calls[0][0];
      const expiredDate = callArgs.where.createdAt.lt as Date;
      const hoursBefore = (Date.now() - expiredDate.getTime()) / 3600000;

      // Should be approximately 24 hours (allow 1 minute tolerance)
      expect(hoursBefore).toBeGreaterThan(23.9);
      expect(hoursBefore).toBeLessThan(24.1);
    });
  });
});
