import { Test, TestingModule } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import { AgentsTaskQueueService } from "../agents-task-queue.service";
import { AgentsService } from "../agents.service";
import { OfficeAgentType } from "@prisma/client";
import {
  SLIDES_AGENT_ID,
  DOCS_AGENT_ID,
} from "@/modules/ai-app/contracts/agent-catalog";

describe("AgentsTaskQueueService", () => {
  let service: AgentsTaskQueueService;
  let mockQueue: {
    add: jest.Mock;
    getWaitingCount: jest.Mock;
    getActiveCount: jest.Mock;
    getFailedCount: jest.Mock;
  };
  let mockAgentsService: {
    findInFlightTasks: jest.Mock;
    getTaskInput: jest.Mock;
    officeAgentTypeToAgentId: jest.Mock;
  };

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: "task-1" }),
      getWaitingCount: jest.fn().mockResolvedValue(2),
      getActiveCount: jest.fn().mockResolvedValue(1),
      getFailedCount: jest.fn().mockResolvedValue(0),
    };
    mockAgentsService = {
      findInFlightTasks: jest.fn().mockResolvedValue([]),
      getTaskInput: jest.fn(),
      officeAgentTypeToAgentId: jest
        .fn()
        .mockImplementation((t: OfficeAgentType) =>
          t === OfficeAgentType.SLIDES ? SLIDES_AGENT_ID : DOCS_AGENT_ID,
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsTaskQueueService,
        {
          provide: getQueueToken(AgentsTaskQueueService.QUEUE_NAME),
          useValue: mockQueue,
        },
        { provide: AgentsService, useValue: mockAgentsService },
      ],
    }).compile();

    service = module.get(AgentsTaskQueueService);
  });

  describe("enqueue", () => {
    it("adds a job with jobId=taskId for idempotency and returns jobId", async () => {
      const result = await service.enqueue(
        "task-1",
        { prompt: "hello" },
        SLIDES_AGENT_ID,
        "user-1",
      );

      expect(result.jobId).toBe("task-1");
      expect(mockQueue.add).toHaveBeenCalledWith(
        AgentsTaskQueueService.JOB_NAME,
        {
          taskId: "task-1",
          input: { prompt: "hello" },
          agentId: SLIDES_AGENT_ID,
          userId: "user-1",
        },
        expect.objectContaining({ jobId: "task-1", attempts: 3 }),
      );
    });
  });

  describe("getStats", () => {
    it("returns waiting, active, failed counts", async () => {
      const stats = await service.getStats();
      expect(stats).toEqual({ waiting: 2, active: 1, failed: 0 });
    });
  });

  describe("onModuleInit (boot recovery)", () => {
    it("re-enqueues in-flight tasks (jobId=taskId guarantees idempotency)", async () => {
      mockAgentsService.findInFlightTasks.mockResolvedValueOnce([
        { id: "task-A", agentType: OfficeAgentType.SLIDES, userId: "user-A" },
        { id: "task-B", agentType: OfficeAgentType.DOCS, userId: null },
      ]);
      mockAgentsService.getTaskInput
        .mockResolvedValueOnce({ prompt: "A" })
        .mockResolvedValueOnce({ prompt: "B" });

      await service.onModuleInit();

      expect(mockQueue.add).toHaveBeenCalledTimes(2);
      expect(mockQueue.add).toHaveBeenCalledWith(
        AgentsTaskQueueService.JOB_NAME,
        expect.objectContaining({ taskId: "task-A", agentId: SLIDES_AGENT_ID }),
        expect.objectContaining({ jobId: "task-A" }),
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        AgentsTaskQueueService.JOB_NAME,
        expect.objectContaining({ taskId: "task-B", userId: undefined }),
        expect.objectContaining({ jobId: "task-B" }),
      );
    });

    it("skips tasks whose input is missing", async () => {
      mockAgentsService.findInFlightTasks.mockResolvedValueOnce([
        { id: "task-X", agentType: OfficeAgentType.DOCS, userId: "user-X" },
      ]);
      mockAgentsService.getTaskInput.mockResolvedValueOnce(null);

      await service.onModuleInit();

      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it("is fail-open when recovery throws (does not block boot)", async () => {
      mockAgentsService.findInFlightTasks.mockRejectedValueOnce(
        new Error("DB down"),
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it("does nothing when there are no in-flight tasks", async () => {
      await service.onModuleInit();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });
});
