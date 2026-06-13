/**
 * Tests for AgentError
 */

import { AgentError } from "../agent-error";
import { EngineError } from "@/modules/ai-engine/facade/abstractions/engine.error";
import { AgentErrorCode } from "@/modules/ai-engine/facade/abstractions/error-codes.constants";

describe("AgentError", () => {
  describe("constructor", () => {
    it("is an instance of EngineError", () => {
      const error = new AgentError("test");
      expect(error).toBeInstanceOf(EngineError);
    });

    it("is an instance of AgentError", () => {
      const error = new AgentError("test");
      expect(error).toBeInstanceOf(AgentError);
    });

    it("defaults code to AgentErrorCode.UNKNOWN", () => {
      const error = new AgentError("test");
      expect(error.code).toBe(AgentErrorCode.UNKNOWN);
    });

    it("sets name to AgentError", () => {
      const error = new AgentError("test");
      expect(error.name).toBe("AgentError");
    });

    it("agentId is undefined by default", () => {
      const error = new AgentError("test");
      expect(error.agentId).toBeUndefined();
    });

    it("agentName is undefined by default", () => {
      const error = new AgentError("test");
      expect(error.agentName).toBeUndefined();
    });

    it("sets agentId from options", () => {
      const error = new AgentError("test", AgentErrorCode.UNKNOWN, {
        agentId: "agent-1",
      });
      expect(error.agentId).toBe("agent-1");
    });

    it("sets agentName from options", () => {
      const error = new AgentError("test", AgentErrorCode.UNKNOWN, {
        agentName: "MyAgent",
      });
      expect(error.agentName).toBe("MyAgent");
    });

    it("includes agentId in details when provided", () => {
      const error = new AgentError("test", AgentErrorCode.UNKNOWN, {
        agentId: "agent-1",
      });
      expect(error.details?.agentId).toBe("agent-1");
    });
  });

  describe("notFound factory", () => {
    it("creates error with correct message", () => {
      const error = AgentError.notFound("agent-xyz");
      expect(error.message).toContain("agent-xyz");
      expect(error.message).toContain("not found");
    });

    it("sets agentId", () => {
      const error = AgentError.notFound("agent-1");
      expect(error.agentId).toBe("agent-1");
    });

    it("has retryable false", () => {
      const error = AgentError.notFound("agent-1");
      expect(error.retryable).toBe(false);
    });

    it("has code NOT_FOUND", () => {
      const error = AgentError.notFound("agent-1");
      expect(error.code).toBe(AgentErrorCode.NOT_FOUND);
    });
  });

  describe("notRegistered factory", () => {
    it("creates error with agentId", () => {
      const error = AgentError.notRegistered("agent-2");
      expect(error.agentId).toBe("agent-2");
    });

    it("has retryable false", () => {
      const error = AgentError.notRegistered("agent-2");
      expect(error.retryable).toBe(false);
    });

    it("has code NOT_REGISTERED", () => {
      const error = AgentError.notRegistered("agent-2");
      expect(error.code).toBe(AgentErrorCode.NOT_REGISTERED);
    });
  });

  describe("notReady factory", () => {
    it("creates error with agentId", () => {
      const error = AgentError.notReady("agent-3");
      expect(error.agentId).toBe("agent-3");
    });

    it("has retryable true", () => {
      const error = AgentError.notReady("agent-3");
      expect(error.retryable).toBe(true);
    });

    it("includes reason in message when provided", () => {
      const error = AgentError.notReady("agent-3", "initializing");
      expect(error.message).toContain("initializing");
    });

    it("has code NOT_READY", () => {
      const error = AgentError.notReady("agent-3");
      expect(error.code).toBe(AgentErrorCode.NOT_READY);
    });
  });

  describe("executionFailed factory", () => {
    it("creates error with agentId", () => {
      const error = AgentError.executionFailed("agent-1", "reason");
      expect(error.agentId).toBe("agent-1");
    });

    it("has retryable false", () => {
      const error = AgentError.executionFailed("agent-1", "network error");
      expect(error.retryable).toBe(false);
    });

    it("includes cause when provided", () => {
      const cause = new Error("underlying cause");
      const error = AgentError.executionFailed("agent-1", "failed", cause);
      expect(error.cause).toBe(cause);
    });

    it("has code EXECUTION_FAILED", () => {
      const error = AgentError.executionFailed("agent-1", "reason");
      expect(error.code).toBe(AgentErrorCode.EXECUTION_FAILED);
    });
  });

  describe("timeout factory", () => {
    it("creates error with agentId and timeout", () => {
      const error = AgentError.timeout("agent-1", 5000);
      expect(error.agentId).toBe("agent-1");
      expect(error.message).toContain("5000");
    });

    it("has retryable true", () => {
      const error = AgentError.timeout("agent-1", 5000);
      expect(error.retryable).toBe(true);
    });

    it("has code TIMEOUT", () => {
      const error = AgentError.timeout("agent-1", 5000);
      expect(error.code).toBe(AgentErrorCode.TIMEOUT);
    });
  });

  describe("cancelled factory", () => {
    it("creates error with agentId", () => {
      const error = AgentError.cancelled("agent-1");
      expect(error.agentId).toBe("agent-1");
    });

    it("has retryable false", () => {
      const error = AgentError.cancelled("agent-1");
      expect(error.retryable).toBe(false);
    });

    it("has code CANCELLED", () => {
      const error = AgentError.cancelled("agent-1");
      expect(error.code).toBe(AgentErrorCode.CANCELLED);
    });
  });

  describe("llmCallFailed factory", () => {
    it("creates error with agentId", () => {
      const error = AgentError.llmCallFailed("agent-1", "timeout");
      expect(error.agentId).toBe("agent-1");
    });

    it("has retryable true", () => {
      const error = AgentError.llmCallFailed("agent-1", "rate limited");
      expect(error.retryable).toBe(true);
    });

    it("includes cause when provided", () => {
      const cause = new Error("LLM down");
      const error = AgentError.llmCallFailed("agent-1", "failed", cause);
      expect(error.cause).toBe(cause);
    });
  });

  describe("routingFailed factory", () => {
    it("creates error with reason in message", () => {
      const error = AgentError.routingFailed("no available agents");
      expect(error.message).toContain("no available agents");
    });

    it("has retryable false", () => {
      const error = AgentError.routingFailed("reason");
      expect(error.retryable).toBe(false);
    });

    it("agentId is undefined", () => {
      const error = AgentError.routingFailed("reason");
      expect(error.agentId).toBeUndefined();
    });

    it("has code ROUTING_FAILED", () => {
      const error = AgentError.routingFailed("reason");
      expect(error.code).toBe(AgentErrorCode.ROUTING_FAILED);
    });
  });

  describe("noMatchingAgent factory", () => {
    it("creates error with truncated input preview", () => {
      const longInput = "a".repeat(200);
      const error = AgentError.noMatchingAgent(longInput);
      expect(error.message.length).toBeLessThan(250);
    });

    it("has retryable false", () => {
      const error = AgentError.noMatchingAgent("query");
      expect(error.retryable).toBe(false);
    });

    it("has code NO_MATCHING_AGENT", () => {
      const error = AgentError.noMatchingAgent("query");
      expect(error.code).toBe(AgentErrorCode.NO_MATCHING_AGENT);
    });
  });

  describe("ambiguousRouting factory", () => {
    it("lists candidates in message", () => {
      const error = AgentError.ambiguousRouting(
        ["agent-a", "agent-b"],
        "query",
      );
      expect(error.message).toContain("agent-a");
      expect(error.message).toContain("agent-b");
    });

    it("has retryable false", () => {
      const error = AgentError.ambiguousRouting(["a", "b"], "query");
      expect(error.retryable).toBe(false);
    });

    it("has code AMBIGUOUS_ROUTING", () => {
      const error = AgentError.ambiguousRouting(["a", "b"], "query");
      expect(error.code).toBe(AgentErrorCode.AMBIGUOUS_ROUTING);
    });
  });

  describe("planningFailed factory", () => {
    it("has retryable true", () => {
      const error = AgentError.planningFailed("agent-1", "failed to plan");
      expect(error.retryable).toBe(true);
    });

    it("has code PLANNING_FAILED", () => {
      const error = AgentError.planningFailed("agent-1", "reason");
      expect(error.code).toBe(AgentErrorCode.PLANNING_FAILED);
    });
  });

  describe("fromError static method", () => {
    it("returns same AgentError if passed an AgentError", () => {
      const original = AgentError.notFound("agent-1");
      const result = AgentError.fromError(original);
      expect(result).toBe(original);
    });

    it("wraps a plain Error into AgentError", () => {
      const plain = new Error("plain error");
      const result = AgentError.fromError(plain);
      expect(result).toBeInstanceOf(AgentError);
      expect(result.message).toBe("plain error");
      expect(result.cause).toBe(plain);
    });

    it("wraps string error into AgentError", () => {
      const result = AgentError.fromError("something failed");
      expect(result).toBeInstanceOf(AgentError);
      expect(result.message).toBe("something failed");
    });

    it("wraps unknown value with generic message", () => {
      const result = AgentError.fromError({ foo: "bar" });
      expect(result.message).toBe("Unknown agent error");
    });

    it("extracts agentId from details when provided", () => {
      const result = AgentError.fromError(
        new Error("err"),
        AgentErrorCode.UNKNOWN,
        { agentId: "agent-5" },
      );
      expect(result.agentId).toBe("agent-5");
    });
  });

  describe("fromAgentError static method", () => {
    it("returns same AgentError if passed an AgentError", () => {
      const original = AgentError.notFound("a1");
      const result = AgentError.fromAgentError(original, "a1");
      expect(result).toBe(original);
    });

    it("wraps plain Error with agentId", () => {
      const plain = new Error("fail");
      const result = AgentError.fromAgentError(plain, "agent-xyz");
      expect(result).toBeInstanceOf(AgentError);
      expect(result.agentId).toBe("agent-xyz");
    });

    it("works without agentId", () => {
      const result = AgentError.fromAgentError(new Error("err"));
      expect(result).toBeInstanceOf(AgentError);
      expect(result.agentId).toBeUndefined();
    });
  });

  describe("maxIterationsExceeded factory", () => {
    it("has retryable false", () => {
      const error = AgentError.maxIterationsExceeded("agent-1", 10, 10);
      expect(error.retryable).toBe(false);
    });

    it("includes iterations in message", () => {
      const error = AgentError.maxIterationsExceeded("agent-1", 10, 10);
      expect(error.message).toContain("10");
    });

    it("has code MAX_ITERATIONS_EXCEEDED", () => {
      const error = AgentError.maxIterationsExceeded("agent-1", 5, 5);
      expect(error.code).toBe(AgentErrorCode.MAX_ITERATIONS_EXCEEDED);
    });
  });
});
