/**
 * A2AMessageBusService Tests
 *
 * Covers:
 * 1. subscribe – returns unsubscribe function
 * 2. publish – targeted delivery to single agent
 * 3. publish – broadcast to all except sender
 * 4. publish – no subscribers case
 * 5. publish – TTL expiry guard (non-throwable path)
 * 6. subscribe / unsubscribe flow
 * 7. getHistory – accumulates messages per session
 * 8. clearSession – removes subscribers and history
 * 9. Message structure validation (id, correlationId, timestamp)
 * 10. Multiple sessions isolation
 */

import { MessageBusService as A2AMessageBusService } from "@/modules/ai-harness/facade";

describe("A2AMessageBusService", () => {
  let service: A2AMessageBusService;

  beforeEach(() => {
    service = new A2AMessageBusService();
  });

  // ============================================================
  // subscribe
  // ============================================================

  describe("subscribe", () => {
    it("should return an unsubscribe function", () => {
      const unsubscribe = service.subscribe("session-1", "agent-a", jest.fn());
      expect(typeof unsubscribe).toBe("function");
    });

    it("should register multiple handlers for the same agent", () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      service.subscribe("session-1", "agent-a", handler1);
      service.subscribe("session-1", "agent-a", handler2);

      void service.publish({
        sessionId: "session-1",
        fromAgentId: "agent-z",
        toAgentId: "agent-a",
        type: "task_request",
        payload: { data: "hello" },
      });

      // Both handlers should fire
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // publish – targeted delivery
  // ============================================================

  describe("publish - targeted delivery", () => {
    it("should deliver message to the specified target agent", async () => {
      const handler = jest.fn();
      service.subscribe("s1", "agent-b", handler);

      await service.publish({
        sessionId: "s1",
        fromAgentId: "agent-a",
        toAgentId: "agent-b",
        type: "task_request",
        payload: { task: "write" },
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should NOT deliver to non-target agents", async () => {
      const handlerB = jest.fn();
      const handlerC = jest.fn();
      service.subscribe("s1", "agent-b", handlerB);
      service.subscribe("s1", "agent-c", handlerC);

      await service.publish({
        sessionId: "s1",
        fromAgentId: "agent-a",
        toAgentId: "agent-b",
        type: "task_request",
        payload: {},
      });

      expect(handlerB).toHaveBeenCalledTimes(1);
      expect(handlerC).not.toHaveBeenCalled();
    });

    it("should return the published message with generated id", async () => {
      const message = await service.publish({
        sessionId: "s1",
        fromAgentId: "agent-a",
        toAgentId: "agent-b",
        type: "task_request",
        payload: {},
      });

      expect(typeof message.id).toBe("string");
      expect(message.id.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // publish – broadcast
  // ============================================================

  describe("publish - broadcast", () => {
    it("should deliver to all agents except sender on broadcast", async () => {
      const handlerB = jest.fn();
      const handlerC = jest.fn();
      const handlerA = jest.fn(); // sender - should NOT receive

      service.subscribe("s1", "agent-a", handlerA);
      service.subscribe("s1", "agent-b", handlerB);
      service.subscribe("s1", "agent-c", handlerC);

      await service.publish({
        sessionId: "s1",
        fromAgentId: "agent-a",
        // no toAgentId = broadcast
        type: "task_update",
        payload: { status: "done" },
      });

      expect(handlerA).not.toHaveBeenCalled();
      expect(handlerB).toHaveBeenCalledTimes(1);
      expect(handlerC).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // publish – no subscribers
  // ============================================================

  describe("publish - no subscribers", () => {
    it("should return message even when no subscribers in session", async () => {
      const message = await service.publish({
        sessionId: "empty-session",
        fromAgentId: "agent-a",
        type: "task_request",
        payload: {},
      });
      expect(message).toBeDefined();
      expect(message.fromAgentId).toBe("agent-a");
    });
  });

  // ============================================================
  // Message structure
  // ============================================================

  describe("message structure", () => {
    it("should include generated id, correlationId, and timestamp", async () => {
      const message = await service.publish({
        sessionId: "s1",
        fromAgentId: "sender",
        type: "task_request",
        payload: { x: 1 },
      });

      expect(message.id).toBeTruthy();
      expect(message.correlationId).toBeTruthy();
      expect(message.timestamp).toBeInstanceOf(Date);
    });

    it("should preserve custom correlationId", async () => {
      const message = await service.publish({
        sessionId: "s1",
        fromAgentId: "sender",
        type: "task_request",
        payload: {},
        correlationId: "my-correlation-id",
      });

      expect(message.correlationId).toBe("my-correlation-id");
    });

    it("should preserve replyToId", async () => {
      const message = await service.publish({
        sessionId: "s1",
        fromAgentId: "sender",
        type: "task_result",
        payload: {},
        replyToId: "orig-message-id",
      });

      expect(message.replyToId).toBe("orig-message-id");
    });

    it("should use 'normal' as default priority", async () => {
      const message = await service.publish({
        sessionId: "s1",
        fromAgentId: "sender",
        type: "task_request",
        payload: {},
      });

      expect(message.priority).toBe("normal");
    });

    it("should preserve specified priority", async () => {
      const message = await service.publish({
        sessionId: "s1",
        fromAgentId: "sender",
        type: "task_request",
        payload: {},
        priority: "high",
      });

      expect(message.priority).toBe("high");
    });

    it("should preserve the payload", async () => {
      const payload = { key: "value", nested: { num: 42 } };
      const message = await service.publish({
        sessionId: "s1",
        fromAgentId: "sender",
        type: "task_request",
        payload,
      });

      expect(message.payload).toEqual(payload);
    });
  });

  // ============================================================
  // unsubscribe
  // ============================================================

  describe("unsubscribe", () => {
    it("should stop delivering messages after unsubscribe", async () => {
      const handler = jest.fn();
      const unsubscribe = service.subscribe("s1", "agent-a", handler);

      unsubscribe();

      await service.publish({
        sessionId: "s1",
        fromAgentId: "sender",
        toAgentId: "agent-a",
        type: "task_request",
        payload: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should only remove the specific handler on unsubscribe", async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      service.subscribe("s1", "agent-a", handler1);
      const unsubscribe2 = service.subscribe("s1", "agent-a", handler2);

      unsubscribe2();

      await service.publish({
        sessionId: "s1",
        fromAgentId: "sender",
        toAgentId: "agent-a",
        type: "task_request",
        payload: {},
      });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // getHistory
  // ============================================================

  describe("getHistory", () => {
    it("should return empty array for session with no messages", () => {
      expect(service.getHistory("unknown-session")).toHaveLength(0);
    });

    it("should accumulate message history per session", async () => {
      await service.publish({
        sessionId: "s1",
        fromAgentId: "a",
        type: "task_request",
        payload: { n: 1 },
      });
      await service.publish({
        sessionId: "s1",
        fromAgentId: "b",
        type: "task_update",
        payload: { n: 2 },
      });

      expect(service.getHistory("s1")).toHaveLength(2);
    });

    it("should keep sessions isolated", async () => {
      await service.publish({
        sessionId: "session-A",
        fromAgentId: "a",
        type: "task_request",
        payload: {},
      });
      await service.publish({
        sessionId: "session-B",
        fromAgentId: "b",
        type: "task_update",
        payload: {},
      });

      expect(service.getHistory("session-A")).toHaveLength(1);
      expect(service.getHistory("session-B")).toHaveLength(1);
    });

    it("should trim history when MAX_HISTORY exceeded", async () => {
      // Publish 210 messages (MAX_HISTORY = 200)
      const publishAll = Array.from({ length: 210 }, (_, i) =>
        service.publish({
          sessionId: "s1",
          fromAgentId: "a",
          type: "task_request",
          payload: { i },
        }),
      );
      await Promise.all(publishAll);

      const history = service.getHistory("s1");
      expect(history.length).toBeLessThanOrEqual(200);
    });
  });

  // ============================================================
  // clearSession
  // ============================================================

  describe("clearSession", () => {
    it("should remove history for a session", async () => {
      await service.publish({
        sessionId: "s1",
        fromAgentId: "a",
        type: "task_request",
        payload: {},
      });
      service.clearSession("s1");
      expect(service.getHistory("s1")).toHaveLength(0);
    });

    it("should remove subscribers for a session", async () => {
      const handler = jest.fn();
      service.subscribe("s1", "agent-a", handler);
      service.clearSession("s1");

      await service.publish({
        sessionId: "s1",
        fromAgentId: "sender",
        toAgentId: "agent-a",
        type: "task_request",
        payload: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should not affect other sessions", async () => {
      const handler = jest.fn();
      service.subscribe("s2", "agent-a", handler);

      await service.publish({
        sessionId: "s1",
        fromAgentId: "x",
        type: "task_request",
        payload: {},
      });
      service.clearSession("s1");

      await service.publish({
        sessionId: "s2",
        fromAgentId: "x",
        toAgentId: "agent-a",
        type: "task_request",
        payload: {},
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should not throw when clearing nonexistent session", () => {
      expect(() => service.clearSession("ghost")).not.toThrow();
    });
  });

  // ============================================================
  // Async handler error handling
  // ============================================================

  describe("handler error handling", () => {
    it("should not throw when a sync handler throws", async () => {
      service.subscribe("s1", "agent-a", () => {
        throw new Error("handler error");
      });

      await expect(
        service.publish({
          sessionId: "s1",
          fromAgentId: "sender",
          toAgentId: "agent-a",
          type: "task_request",
          payload: {},
        }),
      ).resolves.toBeDefined();
    });

    it("should still deliver to other handlers when one throws", async () => {
      const goodHandler = jest.fn();
      service.subscribe("s1", "agent-a", () => {
        throw new Error("fail");
      });
      service.subscribe("s1", "agent-a", goodHandler);

      await service.publish({
        sessionId: "s1",
        fromAgentId: "sender",
        toAgentId: "agent-a",
        type: "task_request",
        payload: {},
      });

      expect(goodHandler).toHaveBeenCalledTimes(1);
    });
  });
});
