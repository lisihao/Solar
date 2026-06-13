/**
 * AgentsController unit tests
 *
 * Tests REST API endpoints for agent management:
 * - GET /agents → getAgents()
 * - GET /agents/status → getStatus()
 * - GET /agents/:type/templates → getTemplates()
 * - POST /agents/execute → execute()
 * - GET /agents/tasks/:taskId → getTask()
 * - SSE /agents/tasks/:taskId/stream → streamTask()
 * - POST /agents/tasks/:taskId/cancel → cancelTask()
 * - GET /agents/tasks/:taskId/artifacts → getArtifacts()
 * - GET /agents/artifacts/:artifactId/download → downloadArtifact()
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus, Logger } from "@nestjs/common";
import { of } from "rxjs";
import { AgentsController } from "../agents.controller";
import { AgentOrchestrator } from "../../../../ai-harness/facade";
import { AgentRegistry } from "../../../../ai-harness/facade";
import { AgentsService } from "../agents.service";
import { AgentsTaskQueueService } from "../agents-task-queue.service";

describe("AgentsController", () => {
  let controller: AgentsController;
  let mockOrchestrator: any;
  let mockAgentRegistry: any;
  let mockAgentsService: any;
  let mockAgentsTaskQueue: { enqueue: jest.Mock };

  const mockAgentConfig = {
    id: "slides",
    name: "Slides Agent",
    description: "Generates presentations",
    icon: "slides",
    color: "#0000FF",
    capabilities: ["presentation"],
    templates: [
      { id: "basic", name: "Basic Presentation", description: "5 slides" },
    ],
    selectionKeywords: ["slides", "presentation"],
  };

  const mockAgent = {
    id: "slides",
    name: "Slides Agent",
    description: "Generates presentations",
    capabilities: [],
    requiredTools: [],
    getConfig: jest.fn().mockReturnValue(mockAgentConfig),
    getTemplates: jest
      .fn()
      .mockReturnValue([
        { id: "basic", name: "Basic Presentation", description: "5 slides" },
      ]),
    plan: jest.fn(),
    execute: jest.fn(),
  };

  const mockTask = {
    id: "task-1",
    status: "PENDING",
    agentType: "SLIDES",
    input: {},
    plan: null,
    result: null,
    createdAt: new Date(),
    artifacts: [],
  };

  beforeEach(async () => {
    mockOrchestrator = {
      execute: jest.fn(),
      getStatusReport: jest.fn().mockReturnValue([
        {
          agentId: "slides",
          name: "Slides Agent",
          available: true,
          executions: 10,
          errors: 1,
        },
      ]),
    };

    mockAgentRegistry = {
      getAllConfigs: jest.fn().mockReturnValue([mockAgentConfig]),
      getStats: jest.fn().mockReturnValue({
        total: 1,
        byId: { slides: { executions: 10, errors: 1 } },
      }),
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue(mockAgent),
    };

    mockAgentsService = {
      createTask: jest.fn().mockResolvedValue({ id: "task-1" }),
      getTask: jest.fn().mockResolvedValue(mockTask),
      getTaskStream: jest.fn().mockReturnValue(of({ type: "progress" })),
      updateTaskStatus: jest.fn().mockResolvedValue(undefined),
      updateTaskPlan: jest.fn().mockResolvedValue(undefined),
      saveArtifact: jest.fn().mockResolvedValue(undefined),
      updateTaskResult: jest.fn().mockResolvedValue(undefined),
      publishEvent: jest.fn(),
      cancelTask: jest.fn().mockResolvedValue(true),
      getArtifacts: jest
        .fn()
        .mockResolvedValue([{ id: "art-1", type: "pptx" }]),
      getArtifactDownload: jest.fn().mockResolvedValue({
        url: "https://storage.example.com/file.pptx",
        name: "presentation.pptx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      }),
    };

    mockAgentsTaskQueue = {
      enqueue: jest.fn().mockResolvedValue({ jobId: "task-1" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [
        { provide: AgentOrchestrator, useValue: mockOrchestrator },
        { provide: AgentRegistry, useValue: mockAgentRegistry },
        { provide: AgentsService, useValue: mockAgentsService },
        { provide: AgentsTaskQueueService, useValue: mockAgentsTaskQueue },
      ],
    }).compile();

    controller = module.get<AgentsController>(AgentsController);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  // ==================== getAgents ====================

  describe("getAgents", () => {
    it("should return all registered agent configs", async () => {
      const result = await controller.getAgents();

      expect(mockAgentRegistry.getAllConfigs).toHaveBeenCalled();
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].id).toBe("slides");
    });
  });

  // ==================== getStatus ====================

  describe("getStatus", () => {
    it("should return status report with stats", async () => {
      const result = await controller.getStatus();

      expect(mockOrchestrator.getStatusReport).toHaveBeenCalled();
      expect(mockAgentRegistry.getStats).toHaveBeenCalled();
      expect(result.agents).toHaveLength(1);
      expect(result.stats).toBeDefined();
    });
  });

  // ==================== getTemplates ====================

  describe("getTemplates", () => {
    it("should return templates for valid agent type", async () => {
      const result = await controller.getTemplates("slides");

      expect(mockAgentRegistry.has).toHaveBeenCalledWith("slides");
      expect(mockAgentRegistry.get).toHaveBeenCalledWith("slides");
      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].id).toBe("basic");
    });

    it("should normalize type to lowercase", async () => {
      await controller.getTemplates("SLIDES");
      expect(mockAgentRegistry.has).toHaveBeenCalledWith("slides");
    });

    it("should throw BAD_REQUEST for invalid agent type", async () => {
      await expect(
        controller.getTemplates("invalid-agent-xyz"),
      ).rejects.toThrow(
        new HttpException("Invalid agent type", HttpStatus.BAD_REQUEST),
      );
    });

    it("should return empty templates when agent not registered", async () => {
      mockAgentRegistry.has.mockReturnValueOnce(false);

      const result = await controller.getTemplates("slides");
      expect(result.templates).toEqual([]);
    });
  });

  // ==================== execute ====================

  describe("execute", () => {
    const mockRequest = { user: { id: "user-1", email: "user@test.com" } };

    it("should create task and return taskId with pending status", async () => {
      const result = await controller.execute(
        {
          prompt: "Create a presentation",
          agentId: "slides",
          files: [],
          urls: [],
          resourceIds: [],
          options: {},
        },
        mockRequest as any,
      );

      expect(mockAgentsService.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          agentId: "slides",
        }),
      );
      expect(result.taskId).toBe("task-1");
      expect(result.status).toBe("pending");
    });

    it("should enqueue the task to BullMQ (no in-memory execution)", async () => {
      await controller.execute(
        { prompt: "Create a presentation", agentId: "slides" },
        mockRequest as any,
      );

      // Durable queue path: enqueue is called, orchestrator is NOT run inline.
      expect(mockAgentsTaskQueue.enqueue).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({ prompt: "Create a presentation" }),
        "slides",
        "user-1",
      );
      expect(mockOrchestrator.execute).not.toHaveBeenCalled();
    });

    it("should pass input fields to agentsService.createTask", async () => {
      await controller.execute(
        {
          prompt: "My prompt",
          files: [{ name: "file.txt", content: "data" }] as any,
          urls: ["https://example.com"],
          resourceIds: ["res-1"],
          templateId: "basic",
          options: { format: "pdf" },
        },
        mockRequest as any,
      );

      expect(mockAgentsService.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            prompt: "My prompt",
            files: expect.any(Array),
            urls: ["https://example.com"],
            resourceIds: ["res-1"],
            templateId: "basic",
            options: { format: "pdf" },
          }),
        }),
      );
    });
  });

  // ==================== getTask ====================

  describe("getTask", () => {
    const req = { user: { id: "user-1", email: "user@test.com" } } as any;

    it("should return task when found (owner-scoped)", async () => {
      const result = await controller.getTask("task-1", req);

      expect(mockAgentsService.getTask).toHaveBeenCalledWith(
        "task-1",
        "user-1",
      );
      expect(result).toBeDefined();
    });

    it("should throw NOT_FOUND when task does not exist (or not owned)", async () => {
      mockAgentsService.getTask.mockResolvedValueOnce(null);

      await expect(controller.getTask("nonexistent", req)).rejects.toThrow(
        new HttpException("Task not found", HttpStatus.NOT_FOUND),
      );
    });

    it("should throw 401 when request has no authenticated user", async () => {
      await expect(
        controller.getTask("task-1", { user: undefined } as any),
      ).rejects.toThrow(
        new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED),
      );
      // 关键：未认证时绝不带 undefined userId 调用 service（防 Prisma 丢谓词越权）
      expect(mockAgentsService.getTask).not.toHaveBeenCalled();
    });
  });

  // ==================== streamTask ====================

  describe("streamTask", () => {
    const req = { user: { id: "user-1", email: "user@test.com" } } as any;

    it("should return observable with JSON-stringified events for the owner", (done) => {
      const observable = controller.streamTask("task-1", req);

      observable.subscribe({
        next: (event) => {
          expect(event.data).toBe(JSON.stringify({ type: "progress" }));
          done();
        },
        error: done,
      });
    });

    it("should handle stream errors gracefully", (done) => {
      const { throwError } = require("rxjs");
      mockAgentsService.getTaskStream.mockReturnValueOnce(
        throwError(() => new Error("Stream broken")),
      );

      const observable = controller.streamTask("task-1", req);

      observable.subscribe({
        next: (event) => {
          const data = JSON.parse(event.data as string);
          expect(data.type).toBe("error");
          expect(data.error).toBe("Stream broken");
          done();
        },
        error: done,
      });
    });

    it("IDOR: emits an error event (404) for a non-owner before streaming", (done) => {
      mockAgentsService.getTask.mockResolvedValueOnce(null); // 非属主
      const observable = controller.streamTask("task-1", req);

      observable.subscribe({
        next: (event) => {
          const data = JSON.parse(event.data as string);
          expect(data.type).toBe("error");
          // getTaskStream 不应在归属校验失败后被订阅
          expect(mockAgentsService.getTaskStream).not.toHaveBeenCalled();
          done();
        },
        error: done,
      });
    });
  });

  // ==================== cancelTask ====================

  describe("cancelTask", () => {
    const req = { user: { id: "user-1", email: "user@test.com" } } as any;

    it("should cancel task and return success: true (owner-scoped)", async () => {
      const result = await controller.cancelTask("task-1", req);

      expect(mockAgentsService.cancelTask).toHaveBeenCalledWith(
        "task-1",
        "user-1",
      );
      expect(result.success).toBe(true);
    });

    it("should return success: false when task cannot be cancelled", async () => {
      mockAgentsService.cancelTask.mockResolvedValueOnce(false);

      const result = await controller.cancelTask("task-1", req);
      expect(result.success).toBe(false);
    });
  });

  // ==================== getArtifacts ====================

  describe("getArtifacts", () => {
    const req = { user: { id: "user-1", email: "user@test.com" } } as any;

    it("should return artifacts for a task (owner-scoped)", async () => {
      const result = await controller.getArtifacts("task-1", req);

      expect(mockAgentsService.getArtifacts).toHaveBeenCalledWith(
        "task-1",
        "user-1",
      );
      expect(result.artifacts).toHaveLength(1);
    });
  });

  // ==================== downloadArtifact ====================

  describe("downloadArtifact", () => {
    const req = { user: { id: "user-1", email: "user@test.com" } } as any;

    it("should return artifact download info (owner-scoped)", async () => {
      const result = await controller.downloadArtifact("artifact-1", req);

      expect(mockAgentsService.getArtifactDownload).toHaveBeenCalledWith(
        "artifact-1",
        "user-1",
      );
      expect(result.url).toBeDefined();
      expect(result.name).toBe("presentation.pptx");
      expect(result.mimeType).toContain("presentationml");
    });
  });

  // ==================== durable enqueue (replaces former in-memory executeTaskAsync) ====================

  describe("execute → durable enqueue", () => {
    const mockReq = { user: { id: "user-1", email: "user@test.com" } };

    it("enqueues with taskId, input, agentId, userId and does not touch the orchestrator", async () => {
      await controller.execute(
        { prompt: "Test", agentId: "slides" },
        mockReq as any,
      );

      expect(mockAgentsTaskQueue.enqueue).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({ prompt: "Test" }),
        "slides",
        "user-1",
      );
      // Execution (PLANNING/EXECUTING/COMPLETED state machine) now runs in the
      // worker (AgentsTaskProcessor), not inline in the controller.
      expect(mockOrchestrator.execute).not.toHaveBeenCalled();
      expect(mockAgentsService.updateTaskStatus).not.toHaveBeenCalled();
    });

    it("enqueues even when agentId is omitted (orchestrator auto-routes in worker)", async () => {
      await controller.execute({ prompt: "Fail" }, mockReq as any);

      expect(mockAgentsTaskQueue.enqueue).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({ prompt: "Fail" }),
        undefined,
        "user-1",
      );
    });
  });
});
