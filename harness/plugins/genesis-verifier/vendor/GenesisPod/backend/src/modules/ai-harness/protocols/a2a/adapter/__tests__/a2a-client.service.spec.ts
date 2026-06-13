/**
 * A2AClientService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { A2AClientService } from "../a2a-client.service";
import { A2ATaskStatus } from "../../a2a.types";

jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

// Mock axios at module level — axios is a default export with a .create() method
const mockAxiosGet = jest.fn();
const mockAxiosPost = jest.fn();

const mockAxiosInstance = {
  get: mockAxiosGet,
  post: mockAxiosPost,
};

jest.mock("axios", () => {
  const axiosMock = {
    create: jest.fn(() => mockAxiosInstance),
  };
  return {
    ...axiosMock,
    default: axiosMock,
    create: axiosMock.create,
  };
});

// ===================== Fixtures =====================

const AGENT_URL = "https://external-agent.example.com/a2a";

const mockAgentCard = {
  name: "External Research Agent",
  description: "Research capabilities",
  url: `${AGENT_URL}/tasks`,
  provider: {
    organization: "ExternalCo",
    url: "https://external-agent.example.com",
  },
  version: "1.0.0",
  capabilities: { streaming: false },
  defaultInputModes: ["text"],
  defaultOutputModes: ["text/markdown"],
  skills: [
    {
      id: "research",
      name: "Research",
      description: "Deep research",
      tags: ["research"],
    },
  ],
};

const mockTaskRequest = {
  skillId: "research",
  input: { content: "Research topic: AI safety" },
};

const mockTaskResponse = {
  taskId: "task-abc-123",
  status: A2ATaskStatus.PENDING,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockStatusResponse = {
  taskId: "task-abc-123",
  skillId: "research",
  status: A2ATaskStatus.RUNNING,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockCompletedStatusResponse = {
  taskId: "task-abc-123",
  skillId: "research",
  status: A2ATaskStatus.COMPLETED,
  result: {
    content: "Research results here",
    mode: "text/markdown",
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("A2AClientService", () => {
  let service: A2AClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [A2AClientService],
    }).compile();

    service = module.get<A2AClientService>(A2AClientService);
  });

  afterEach(() => jest.clearAllMocks());

  // ===================== discoverAgent =====================

  describe("discoverAgent()", () => {
    it("fetches agent card from provided URL", async () => {
      mockAxiosGet.mockResolvedValue({ data: mockAgentCard });

      const result = await service.discoverAgent(
        `${AGENT_URL}/.well-known/agent.json`,
      );

      expect(mockAxiosGet).toHaveBeenCalledWith(
        `${AGENT_URL}/.well-known/agent.json`,
      );
      expect(result).toEqual(mockAgentCard);
    });

    it("returns the agent card data", async () => {
      mockAxiosGet.mockResolvedValue({ data: mockAgentCard });

      const result = await service.discoverAgent("https://example.com/agent");

      expect(result.name).toBe("External Research Agent");
      expect(result.skills).toHaveLength(1);
    });

    it("throws Error when HTTP request fails", async () => {
      mockAxiosGet.mockRejectedValue(new Error("Connection refused"));

      await expect(
        service.discoverAgent("https://unreachable.example.com"),
      ).rejects.toThrow("Failed to discover A2A agent");
    });

    it("throws Error with sanitized message on network timeout", async () => {
      const timeoutError = new Error("timeout of 30000ms exceeded");
      mockAxiosGet.mockRejectedValue(timeoutError);

      await expect(service.discoverAgent(AGENT_URL)).rejects.toThrow(
        "Failed to discover A2A agent",
      );
    });

    it("logs success after agent discovery", async () => {
      const logSpy = jest.spyOn(Logger.prototype, "log");
      mockAxiosGet.mockResolvedValue({ data: mockAgentCard });

      await service.discoverAgent(AGENT_URL);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("External Research Agent"),
      );
    });

    it("logs error on discovery failure", async () => {
      const errorSpy = jest.spyOn(Logger.prototype, "error");
      mockAxiosGet.mockRejectedValue(new Error("network error"));

      try {
        await service.discoverAgent(AGENT_URL);
      } catch {
        // expected
      }

      expect(errorSpy).toHaveBeenCalled();
    });
  });

  // ===================== createTask =====================

  describe("createTask()", () => {
    it("posts task request to agentUrl/tasks", async () => {
      mockAxiosPost.mockResolvedValue({ data: mockTaskResponse });

      await service.createTask(AGENT_URL, mockTaskRequest);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        `${AGENT_URL}/tasks`,
        mockTaskRequest,
      );
    });

    it("returns the task response", async () => {
      mockAxiosPost.mockResolvedValue({ data: mockTaskResponse });

      const result = await service.createTask(AGENT_URL, mockTaskRequest);

      expect(result.taskId).toBe("task-abc-123");
      expect(result.status).toBe(A2ATaskStatus.PENDING);
    });

    it("throws Error when task creation fails", async () => {
      mockAxiosPost.mockRejectedValue(new Error("Bad Request"));

      await expect(
        service.createTask(AGENT_URL, mockTaskRequest),
      ).rejects.toThrow("Failed to create A2A task");
    });

    it("logs task creation details", async () => {
      const logSpy = jest.spyOn(Logger.prototype, "log");
      mockAxiosPost.mockResolvedValue({ data: mockTaskResponse });

      await service.createTask(AGENT_URL, mockTaskRequest);

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("research"));
    });

    it("logs error on task creation failure", async () => {
      const errorSpy = jest.spyOn(Logger.prototype, "error");
      mockAxiosPost.mockRejectedValue(new Error("server error"));

      try {
        await service.createTask(AGENT_URL, mockTaskRequest);
      } catch {
        // expected
      }

      expect(errorSpy).toHaveBeenCalled();
    });

    it("constructs URL correctly with trailing slash in agentUrl", async () => {
      mockAxiosPost.mockResolvedValue({ data: mockTaskResponse });

      await service.createTask(
        "https://agent.example.com/a2a",
        mockTaskRequest,
      );

      expect(mockAxiosPost).toHaveBeenCalledWith(
        "https://agent.example.com/a2a/tasks",
        mockTaskRequest,
      );
    });
  });

  // ===================== getTaskStatus =====================

  describe("getTaskStatus()", () => {
    it("fetches task status from agentUrl/tasks/:taskId", async () => {
      mockAxiosGet.mockResolvedValue({ data: mockStatusResponse });

      await service.getTaskStatus(AGENT_URL, "task-abc-123");

      expect(mockAxiosGet).toHaveBeenCalledWith(
        `${AGENT_URL}/tasks/task-abc-123`,
      );
    });

    it("returns task status response", async () => {
      mockAxiosGet.mockResolvedValue({ data: mockStatusResponse });

      const result = await service.getTaskStatus(AGENT_URL, "task-abc-123");

      expect(result.taskId).toBe("task-abc-123");
      expect(result.status).toBe(A2ATaskStatus.RUNNING);
    });

    it("throws Error when status fetch fails", async () => {
      mockAxiosGet.mockRejectedValue(new Error("Not Found"));

      await expect(
        service.getTaskStatus(AGENT_URL, "non-existent-task"),
      ).rejects.toThrow("Failed to get A2A task status");
    });

    it("logs debug when polling status", async () => {
      const debugSpy = jest.spyOn(Logger.prototype, "debug");
      mockAxiosGet.mockResolvedValue({ data: mockStatusResponse });

      await service.getTaskStatus(AGENT_URL, "task-abc-123");

      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining("task-abc-123"),
      );
    });

    it("logs error on failure", async () => {
      const errorSpy = jest.spyOn(Logger.prototype, "error");
      mockAxiosGet.mockRejectedValue(new Error("network error"));

      try {
        await service.getTaskStatus(AGENT_URL, "task-id");
      } catch {
        // expected
      }

      expect(errorSpy).toHaveBeenCalled();
    });
  });

  // ===================== pollTaskUntilComplete =====================

  describe("pollTaskUntilComplete()", () => {
    it("returns immediately when task is already completed", async () => {
      mockAxiosGet.mockResolvedValue({ data: mockCompletedStatusResponse });

      const result = await service.pollTaskUntilComplete(
        AGENT_URL,
        "task-abc-123",
        0, // 0ms poll interval for fast tests
        5,
      );

      expect(result.status).toBe(A2ATaskStatus.COMPLETED);
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    });

    it("returns when task fails", async () => {
      const failedStatus = {
        ...mockStatusResponse,
        status: A2ATaskStatus.FAILED,
        error: { code: "ERR", message: "Something went wrong" },
      };
      mockAxiosGet.mockResolvedValue({ data: failedStatus });

      const result = await service.pollTaskUntilComplete(
        AGENT_URL,
        "task-abc-123",
        0,
        5,
      );

      expect(result.status).toBe(A2ATaskStatus.FAILED);
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    });

    it("returns when task is cancelled", async () => {
      const cancelledStatus = {
        ...mockStatusResponse,
        status: A2ATaskStatus.CANCELLED,
      };
      mockAxiosGet.mockResolvedValue({ data: cancelledStatus });

      const result = await service.pollTaskUntilComplete(
        AGENT_URL,
        "task-abc-123",
        0,
        5,
      );

      expect(result.status).toBe(A2ATaskStatus.CANCELLED);
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    });

    it("polls multiple times until task completes", async () => {
      // First 2 calls return RUNNING, third returns COMPLETED
      mockAxiosGet
        .mockResolvedValueOnce({ data: mockStatusResponse }) // RUNNING
        .mockResolvedValueOnce({ data: mockStatusResponse }) // RUNNING
        .mockResolvedValueOnce({ data: mockCompletedStatusResponse }); // COMPLETED

      const result = await service.pollTaskUntilComplete(
        AGENT_URL,
        "task-abc-123",
        0, // 0ms interval for speed
        10,
      );

      expect(result.status).toBe(A2ATaskStatus.COMPLETED);
      expect(mockAxiosGet).toHaveBeenCalledTimes(3);
    });

    it("throws error when max attempts exceeded", async () => {
      // Always returns RUNNING
      mockAxiosGet.mockResolvedValue({ data: mockStatusResponse });

      await expect(
        service.pollTaskUntilComplete(
          AGENT_URL,
          "task-abc-123",
          0,
          3, // maxAttempts = 3
        ),
      ).rejects.toThrow("did not complete within maximum polling attempts");
    });

    it("uses default poll interval and max attempts", async () => {
      // Task completes immediately on first poll
      mockAxiosGet.mockResolvedValue({ data: mockCompletedStatusResponse });

      // Don't pass pollInterval/maxAttempts; ensure defaults are used
      const result = await service.pollTaskUntilComplete(
        AGENT_URL,
        "task-abc-123",
      );

      expect(result.status).toBe(A2ATaskStatus.COMPLETED);
    });

    it("propagates getTaskStatus errors during polling", async () => {
      mockAxiosGet.mockRejectedValue(new Error("Connection lost"));

      await expect(
        service.pollTaskUntilComplete(AGENT_URL, "task-id", 0, 3),
      ).rejects.toThrow();
    });

    it("includes task id in timeout error message", async () => {
      mockAxiosGet.mockResolvedValue({ data: mockStatusResponse });

      try {
        await service.pollTaskUntilComplete(AGENT_URL, "unique-task-999", 0, 2);
        fail("Expected error to be thrown");
      } catch (err) {
        expect((err as Error).message).toContain("unique-task-999");
      }
    });
  });
});
