/**
 * A2ARpcService unit tests — 验证 v0.3 JSON-RPC 兼容性
 */

import { A2ARpcService } from "../a2a-rpc.service";
import { A2ATaskStore } from "../a2a-task-store";
import { A2A_ERROR_CODES, A2A_METHODS, TaskState } from "../a2a-spec.types";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  Message,
} from "../a2a-spec.types";

function makeMessage(text: string, overrides: Partial<Message> = {}): Message {
  return {
    kind: "message",
    role: "user",
    messageId: "msg-1",
    parts: [{ kind: "text", text }],
    ...overrides,
  };
}

function isError(response: JsonRpcResponse): response is JsonRpcResponse & {
  error: { code: number; message: string };
} {
  return "error" in response;
}

describe("A2ARpcService (A2A v0.3 spec)", () => {
  let service: A2ARpcService;
  let mockTeamsService: {
    executeMission: jest.Mock;
    getMissionStatus: jest.Mock;
    getMissionResult: jest.Mock;
    cancelMission: jest.Mock;
  };
  let mockRegistry: {
    getSkillById: jest.Mock;
    getSkills: jest.Mock;
    getAgentCard: jest.Mock;
    getAgentCardV03: jest.Mock;
    isValidSkill: jest.Mock;
  };

  beforeEach(() => {
    mockTeamsService = {
      executeMission: jest.fn().mockResolvedValue("mission-123"),
      getMissionStatus: jest.fn().mockReturnValue({
        status: "running" as const,
        teamId: "research-team",
        startTime: new Date(),
      }),
      getMissionResult: jest.fn().mockResolvedValue({
        summary: "research output",
        deliverables: [],
        statistics: {},
        duration: 123,
        tokensUsed: 456,
      }),
      cancelMission: jest.fn().mockReturnValue(true),
    };
    mockRegistry = {
      getSkillById: jest.fn((id: string) =>
        id === "research"
          ? { id: "research", name: "Research", description: "" }
          : undefined,
      ),
      getSkills: jest
        .fn()
        .mockReturnValue([
          { id: "research", name: "Research", description: "", tags: [] },
        ]),
      getAgentCard: jest.fn(),
      getAgentCardV03: jest.fn(),
      isValidSkill: jest.fn(),
    };
    service = new A2ARpcService(
      mockRegistry as never,
      mockTeamsService as never,
      new A2ATaskStore(), // no CacheService → in-memory (mirrors prior Map behavior)
    );
  });

  describe("JSON-RPC 2.0 envelope", () => {
    it("rejects non-2.0 jsonrpc version", async () => {
      const req = {
        jsonrpc: "1.0",
        id: 1,
        method: A2A_METHODS.MESSAGE_SEND,
      } as JsonRpcRequest;
      const res = await service.handle(req);
      expect(isError(res)).toBe(true);
      if (isError(res)) {
        expect(res.error.code).toBe(A2A_ERROR_CODES.INVALID_REQUEST);
      }
    });

    it("returns METHOD_NOT_FOUND for unknown method", async () => {
      const req: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "unknown/method",
      };
      const res = await service.handle(req);
      expect(isError(res)).toBe(true);
      if (isError(res)) {
        expect(res.error.code).toBe(A2A_ERROR_CODES.METHOD_NOT_FOUND);
      }
    });

    it("preserves request id in response", async () => {
      const req: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: "test-id-abc",
        method: "unknown/method",
      };
      const res = await service.handle(req);
      expect(res.id).toBe("test-id-abc");
    });
  });

  describe("message/send", () => {
    it("creates task and returns A2A v0.3 Task object", async () => {
      const req: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: A2A_METHODS.MESSAGE_SEND,
        params: {
          message: makeMessage("Research quantum computing", {
            metadata: { skillId: "research" },
          }),
        },
      };
      const res = await service.handle(req);
      expect(isError(res)).toBe(false);
      if (!isError(res)) {
        const task = res.result as {
          kind: string;
          id: string;
          contextId: string;
          status: { state: string };
        };
        expect(task.kind).toBe("task");
        expect(task.id).toBe("mission-123");
        expect(task.contextId).toBeTruthy();
        expect(task.status.state).toBe(TaskState.SUBMITTED);
      }
      expect(mockTeamsService.executeMission).toHaveBeenCalledWith(
        expect.objectContaining({
          goal: "Research quantum computing",
          teamId: "research-team",
        }),
      );
    });

    it("rejects message without text part", async () => {
      const req: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: A2A_METHODS.MESSAGE_SEND,
        params: {
          message: {
            kind: "message",
            role: "user",
            messageId: "m",
            parts: [{ kind: "data", data: { x: 1 } }],
          } as Message,
        },
      };
      const res = await service.handle(req);
      expect(isError(res)).toBe(true);
    });

    it("rejects message with content exceeding 100KB", async () => {
      const huge = "x".repeat(100_001);
      const req: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: A2A_METHODS.MESSAGE_SEND,
        params: {
          message: makeMessage(huge, { metadata: { skillId: "research" } }),
        },
      };
      const res = await service.handle(req);
      expect(isError(res)).toBe(true);
    });

    it("rejects unknown skill", async () => {
      const req: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: A2A_METHODS.MESSAGE_SEND,
        params: {
          message: makeMessage("test", {
            metadata: { skillId: "nonexistent" },
          }),
        },
      };
      const res = await service.handle(req);
      expect(isError(res)).toBe(true);
    });

    it("preserves contextId from client", async () => {
      const req: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: A2A_METHODS.MESSAGE_SEND,
        params: {
          message: makeMessage("test", {
            metadata: { skillId: "research" },
            contextId: "ctx-existing-session",
          }),
        },
      };
      const res = await service.handle(req);
      if (!isError(res)) {
        const task = res.result as { contextId: string };
        expect(task.contextId).toBe("ctx-existing-session");
      }
    });
  });

  describe("tasks/get", () => {
    it("maps legacy 'running' state to A2A WORKING", async () => {
      // First create a task to populate context map
      await service.handle({
        jsonrpc: "2.0",
        id: 1,
        method: A2A_METHODS.MESSAGE_SEND,
        params: {
          message: makeMessage("test", { metadata: { skillId: "research" } }),
        },
      });

      const res = await service.handle({
        jsonrpc: "2.0",
        id: 2,
        method: A2A_METHODS.TASKS_GET,
        params: { id: "mission-123" },
      });
      if (!isError(res)) {
        const task = res.result as { status: { state: string } };
        expect(task.status.state).toBe(TaskState.WORKING);
      }
    });

    it("attaches artifact when task COMPLETED", async () => {
      mockTeamsService.getMissionStatus.mockReturnValue({
        status: "completed" as const,
        teamId: "research-team",
        startTime: new Date(),
      });
      // Pre-create context
      await service.handle({
        jsonrpc: "2.0",
        id: 1,
        method: A2A_METHODS.MESSAGE_SEND,
        params: {
          message: makeMessage("test", { metadata: { skillId: "research" } }),
        },
      });

      const res = await service.handle({
        jsonrpc: "2.0",
        id: 2,
        method: A2A_METHODS.TASKS_GET,
        params: { id: "mission-123" },
      });
      if (!isError(res)) {
        const task = res.result as {
          status: { state: string };
          artifacts?: Array<{ parts: Array<{ kind: string; text?: string }> }>;
        };
        expect(task.status.state).toBe(TaskState.COMPLETED);
        expect(task.artifacts).toBeDefined();
        expect(task.artifacts?.[0].parts[0].kind).toBe("text");
        expect(task.artifacts?.[0].parts[0].text).toBe("research output");
      }
    });

    it("attaches error message when task FAILED", async () => {
      mockTeamsService.getMissionStatus.mockReturnValue({
        status: "failed" as const,
        teamId: "research-team",
        startTime: new Date(),
        error: "Out of credits",
      });
      const res = await service.handle({
        jsonrpc: "2.0",
        id: 1,
        method: A2A_METHODS.TASKS_GET,
        params: { id: "mission-123" },
      });
      if (!isError(res)) {
        const task = res.result as {
          status: {
            state: string;
            message?: { parts: Array<{ text?: string }> };
          };
        };
        expect(task.status.state).toBe(TaskState.FAILED);
        expect(task.status.message?.parts[0].text).toContain("Out of credits");
      }
    });

    it("rejects request without id", async () => {
      const res = await service.handle({
        jsonrpc: "2.0",
        id: 1,
        method: A2A_METHODS.TASKS_GET,
        params: {},
      } as JsonRpcRequest);
      expect(isError(res)).toBe(true);
    });
  });

  describe("tasks/cancel", () => {
    it("returns CANCELED Task when cancellation succeeds", async () => {
      const res = await service.handle({
        jsonrpc: "2.0",
        id: 1,
        method: A2A_METHODS.TASKS_CANCEL,
        params: { id: "mission-123" },
      });
      expect(isError(res)).toBe(false);
      if (!isError(res)) {
        const task = res.result as { kind: string; status: { state: string } };
        expect(task.kind).toBe("task");
        expect(task.status.state).toBe(TaskState.CANCELED);
      }
      expect(mockTeamsService.cancelMission).toHaveBeenCalledWith(
        "mission-123",
      );
    });

    it("returns TASK_NOT_CANCELABLE when mission already finished or missing", async () => {
      mockTeamsService.cancelMission.mockReturnValue(false);
      const res = await service.handle({
        jsonrpc: "2.0",
        id: 1,
        method: A2A_METHODS.TASKS_CANCEL,
        params: { id: "mission-123" },
      });
      expect(isError(res)).toBe(true);
    });
  });

  describe("message/stream", () => {
    it("returns UNSUPPORTED_OPERATION (controller handles SSE separately)", async () => {
      const res = await service.handle({
        jsonrpc: "2.0",
        id: 1,
        method: A2A_METHODS.MESSAGE_STREAM,
        params: { message: makeMessage("test") },
      });
      expect(isError(res)).toBe(true);
      if (isError(res)) {
        expect(res.error.code).toBe(A2A_ERROR_CODES.UNSUPPORTED_OPERATION);
      }
    });
  });
});
