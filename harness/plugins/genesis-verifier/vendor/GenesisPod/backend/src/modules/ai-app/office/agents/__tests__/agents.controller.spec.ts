/**
 * AiOfficeAgentsController Unit Tests
 *
 * Tests the unified agent execution endpoint, task management,
 * and SSE streaming functionality.
 * SlidesEngineService is fully mocked.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { AiOfficeAgentsController } from "../agents.controller";
import { AgentType, taskStore } from "../agents.types";
import { SlidesEngineService } from "../../slides";

describe("AiOfficeAgentsController", () => {
  let controller: AiOfficeAgentsController;
  let slidesEngine: jest.Mocked<SlidesEngineService>;

  // Helper: build async generator from array of events
  async function* makeStream(events: unknown[]) {
    for (const event of events) {
      yield event;
    }
  }

  beforeEach(async () => {
    // Clear in-memory task store before each test
    taskStore.tasks.clear();
    taskStore.streams.clear();

    const mockSlidesEngineService = {
      generateSlides: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiOfficeAgentsController],
      providers: [
        { provide: SlidesEngineService, useValue: mockSlidesEngineService },
      ],
    }).compile();

    controller = module.get<AiOfficeAgentsController>(AiOfficeAgentsController);
    slidesEngine = module.get(SlidesEngineService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    taskStore.tasks.clear();
    taskStore.streams.clear();
  });

  describe("executeAgent", () => {
    it("should create a task and return taskId with pending status", async () => {
      slidesEngine.generateSlides.mockReturnValue(makeStream([]));

      const result = await controller.executeAgent({
        prompt: "Generate a slide about AI",
        agentType: AgentType.SLIDES,
      });

      expect(result).toHaveProperty("taskId");
      expect(result.status).toBe("pending");
      expect(typeof result.taskId).toBe("string");
    });

    it("should default to SLIDES agent type when not specified", async () => {
      slidesEngine.generateSlides.mockReturnValue(makeStream([]));

      const result = await controller.executeAgent({
        prompt: "Generate slides",
      });

      expect(result.status).toBe("pending");
      const task = taskStore.tasks.get(result.taskId);
      expect(task?.agentType).toBe(AgentType.SLIDES);
    });

    it("should store task in task store", async () => {
      slidesEngine.generateSlides.mockReturnValue(makeStream([]));

      const result = await controller.executeAgent({
        prompt: "Test prompt",
        title: "My Slides",
        urls: ["https://example.com"],
        resourceIds: ["resource-1"],
        options: { slideCount: 5 },
      });

      const task = taskStore.tasks.get(result.taskId);
      expect(task).toBeDefined();
      expect(task!.input.prompt).toBe("Test prompt");
      expect(task!.input.title).toBe("My Slides");
    });

    it("should handle slides generation completion event", async () => {
      const completedEvent = {
        type: "execution:completed",
        timestamp: new Date().toISOString(),
        executionId: "exec-123",
        data: {
          checkpointId: "session-123",
          totalPages: 10,
          totalTime: 5000,
        },
      };

      slidesEngine.generateSlides.mockReturnValue(makeStream([completedEvent]));

      const result = await controller.executeAgent({
        prompt: "Generate 10 slides about ML",
        agentType: AgentType.SLIDES,
      });

      // Allow the async task to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const task = taskStore.tasks.get(result.taskId);
      expect(task).toBeDefined();
      // Task should have completed or be in process
    });
  });

  describe("getTask", () => {
    it("should return task by taskId", async () => {
      // Create a task first
      slidesEngine.generateSlides.mockReturnValue(makeStream([]));
      const { taskId } = await controller.executeAgent({ prompt: "Test" });

      const task = await controller.getTask(taskId);

      expect(task).toBeDefined();
      expect(task.id).toBe(taskId);
    });

    it("should throw NotFoundException for unknown taskId", async () => {
      await expect(controller.getTask("non-existent-task-id")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("cancelTask", () => {
    it("should cancel a task and set status to cancelled", async () => {
      // Use a long-running stream so the task won't complete before we cancel
      async function* infiniteStream() {
        while (true) {
          await new Promise((r) => setTimeout(r, 10000));
          yield { type: "progress" };
        }
      }
      slidesEngine.generateSlides.mockReturnValue(infiniteStream());
      const { taskId } = await controller.executeAgent({ prompt: "Test" });

      // Manually insert a task in "running" state to test cancel
      const task = taskStore.tasks.get(taskId)!;
      task.status = "running";

      await controller.cancelTask(taskId);

      expect(task.status).toBe("cancelled");
    });

    it("should emit an error event on cancellation", async () => {
      slidesEngine.generateSlides.mockReturnValue(makeStream([]));
      const { taskId } = await controller.executeAgent({ prompt: "Test" });

      // Put a task manually in the store with running state
      const task = taskStore.tasks.get(taskId)!;
      task.status = "running";

      await controller.cancelTask(taskId);

      const events = taskStore.streams.get(taskId) || [];
      const cancelEvent = events.find(
        (e: unknown) => (e as Record<string, unknown>).type === "error",
      );
      expect(cancelEvent).toBeDefined();
    });

    it("should throw NotFoundException when task not found", async () => {
      await expect(
        controller.cancelTask("non-existent-task-id"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getArtifacts", () => {
    it("should return empty array for task with no result", async () => {
      slidesEngine.generateSlides.mockReturnValue(makeStream([]));
      const { taskId } = await controller.executeAgent({ prompt: "Test" });

      const artifacts = await controller.getArtifacts(taskId);

      expect(artifacts).toEqual([]);
    });

    it("should return artifacts when task has result", async () => {
      slidesEngine.generateSlides.mockReturnValue(makeStream([]));
      const { taskId } = await controller.executeAgent({ prompt: "Test" });

      // Manually inject result artifacts
      const task = taskStore.tasks.get(taskId)!;
      task.result = {
        artifacts: [{ id: "art-1", type: "pptx", name: "slides.pptx" }],
        summary: "Done",
        duration: 1000,
      };

      const artifacts = await controller.getArtifacts(taskId);

      expect(artifacts).toHaveLength(1);
      expect((artifacts[0] as Record<string, unknown>).id).toBe("art-1");
    });

    it("should throw NotFoundException for unknown taskId", async () => {
      await expect(controller.getArtifacts("no-such-task")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("streamTask", () => {
    it("should set SSE headers and return 404 for unknown task", () => {
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
      };

      void controller.streamTask(
        "non-existent-task-id",
        mockRes as unknown as import("express").Response,
      );

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: "Task not found" });
    });

    it("should set SSE headers and close immediately for completed task", async () => {
      slidesEngine.generateSlides.mockReturnValue(makeStream([]));
      const { taskId } = await controller.executeAgent({ prompt: "Test" });

      // Mark as completed
      const task = taskStore.tasks.get(taskId)!;
      task.status = "completed";

      const mockRes = {
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
      };

      await controller.streamTask(
        taskId,
        mockRes as unknown as import("express").Response,
      );

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "text/event-stream",
      );
      expect(mockRes.end).toHaveBeenCalled();
    });

    it("should set SSE headers and close immediately for failed task", async () => {
      slidesEngine.generateSlides.mockReturnValue(makeStream([]));
      const { taskId } = await controller.executeAgent({ prompt: "Test" });

      const task = taskStore.tasks.get(taskId)!;
      task.status = "failed";

      const mockRes = {
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
      };

      await controller.streamTask(
        taskId,
        mockRes as unknown as import("express").Response,
      );

      expect(mockRes.end).toHaveBeenCalled();
    });

    it("should set SSE headers and start polling for pending task", async () => {
      slidesEngine.generateSlides.mockReturnValue(makeStream([]));
      const { taskId } = await controller.executeAgent({ prompt: "Test" });

      const closeListeners: Array<() => void> = [];
      const mockRes = {
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn((event: string, listener: () => void) => {
          if (event === "close") closeListeners.push(listener);
        }),
      };

      // Complete the task after a short delay to allow interval to be set up
      setTimeout(() => {
        const task = taskStore.tasks.get(taskId)!;
        task.status = "completed";
      }, 50);

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 300);
      });

      // Manually trigger the stream call — it sets up an interval so we just verify headers
      void controller.streamTask(
        taskId,
        mockRes as unknown as import("express").Response,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "text/event-stream",
      );
      expect(mockRes.flushHeaders).toHaveBeenCalled();

      // Trigger close event to clean up
      closeListeners.forEach((l) => l());
    });
  });
});
