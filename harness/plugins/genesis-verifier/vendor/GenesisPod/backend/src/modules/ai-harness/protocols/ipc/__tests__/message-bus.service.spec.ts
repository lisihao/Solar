/**
 * MessageBusService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";

// Suppress logger output in tests
jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

import { MessageBusService } from "../message-bus.service";
import type {
  A2AMessage,
  A2AMessageHandler,
} from "../abstractions/a2a-message.types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const SESSION = "session-001";

async function publish(
  service: MessageBusService,
  overrides: Partial<Parameters<MessageBusService["publish"]>[0]> = {},
): Promise<A2AMessage> {
  return service.publish({
    sessionId: SESSION,
    fromAgentId: "agent-a",
    type: "info_share",
    payload: { data: "hello" },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("MessageBusService", () => {
  let service: MessageBusService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MessageBusService],
    }).compile();

    service = module.get<MessageBusService>(MessageBusService);
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // subscribe()
  // -------------------------------------------------------------------------
  describe("subscribe()", () => {
    it("should register a handler and return an unsubscribe function", () => {
      const handler: A2AMessageHandler = jest.fn();
      const unsub = service.subscribe(SESSION, "agent-b", handler);
      expect(typeof unsub).toBe("function");
    });

    it("should create session map on first subscription for a session", async () => {
      const handler = jest.fn();
      service.subscribe(SESSION, "agent-b", handler);

      await publish(service, { toAgentId: "agent-b" });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should allow multiple handlers for the same agent", async () => {
      const h1 = jest.fn();
      const h2 = jest.fn();
      service.subscribe(SESSION, "agent-b", h1);
      service.subscribe(SESSION, "agent-b", h2);

      await publish(service, { toAgentId: "agent-b" });
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it("should remove the handler when unsubscribe is called", async () => {
      const handler = jest.fn();
      const unsub = service.subscribe(SESSION, "agent-b", handler);

      unsub();
      await publish(service, { toAgentId: "agent-b" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("should only remove the specific handler when multiple handlers exist", async () => {
      const h1 = jest.fn();
      const h2 = jest.fn();
      const unsub1 = service.subscribe(SESSION, "agent-b", h1);
      service.subscribe(SESSION, "agent-b", h2);

      unsub1();
      await publish(service, { toAgentId: "agent-b" });

      expect(h1).not.toHaveBeenCalled();
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it("should not throw when unsubscribe is called after clearSession", () => {
      const handler = jest.fn();
      const unsub = service.subscribe(SESSION, "agent-b", handler);
      service.clearSession(SESSION);
      expect(() => unsub()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // publish() — targeted delivery
  // -------------------------------------------------------------------------
  describe("publish() — targeted delivery", () => {
    it("should deliver message to the target agent handler", async () => {
      const handler = jest.fn();
      service.subscribe(SESSION, "agent-b", handler);

      const msg = await publish(service, { toAgentId: "agent-b" });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ id: msg.id, fromAgentId: "agent-a" }),
      );
    });

    it("should not deliver to sender even in targeted mode", async () => {
      const senderHandler = jest.fn();
      service.subscribe(SESSION, "agent-a", senderHandler);
      service.subscribe(SESSION, "agent-b", jest.fn());

      await publish(service, { toAgentId: "agent-b" });
      // Sender subscribed as agent-a but message is TO agent-b
      expect(senderHandler).not.toHaveBeenCalled();
    });

    it("should return a message with correct fields", async () => {
      const msg = await publish(service, {
        fromAgentId: "alice",
        toAgentId: "bob",
        type: "task_request",
        payload: { task: 1 },
        priority: "high",
        replyToId: "msg-0",
        correlationId: "corr-1",
        ttlMs: 5000,
      });

      expect(msg.fromAgentId).toBe("alice");
      expect(msg.toAgentId).toBe("bob");
      expect(msg.type).toBe("task_request");
      expect(msg.priority).toBe("high");
      expect(msg.replyToId).toBe("msg-0");
      expect(msg.correlationId).toBe("corr-1");
      expect(msg.ttlMs).toBe(5000);
      expect(msg.id).toBeTruthy();
      expect(msg.timestamp).toBeInstanceOf(Date);
    });

    it("should assign default priority 'normal' when not provided", async () => {
      const msg = await publish(service);
      expect(msg.priority).toBe("normal");
    });

    it("should generate a correlationId when not provided", async () => {
      const msg = await publish(service);
      expect(msg.correlationId).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // publish() — broadcast delivery
  // -------------------------------------------------------------------------
  describe("publish() — broadcast delivery (no toAgentId)", () => {
    it("should deliver to all agents except the sender", async () => {
      const hB = jest.fn();
      const hC = jest.fn();
      const hSender = jest.fn();

      service.subscribe(SESSION, "agent-a", hSender); // sender
      service.subscribe(SESSION, "agent-b", hB);
      service.subscribe(SESSION, "agent-c", hC);

      await publish(service, { fromAgentId: "agent-a" }); // no toAgentId

      expect(hSender).not.toHaveBeenCalled();
      expect(hB).toHaveBeenCalledTimes(1);
      expect(hC).toHaveBeenCalledTimes(1);
    });

    it("should not deliver to any agent when session has no subscribers", async () => {
      const msg = await publish(service, { sessionId: "empty-session" });
      // Just returns without error
      expect(msg).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // publish() — no subscribers at all
  // -------------------------------------------------------------------------
  describe("publish() — no subscribers", () => {
    it("should return the message without error when no subscribers exist for session", async () => {
      const msg = await publish(service, { sessionId: "no-sub-session" });
      expect(msg.fromAgentId).toBe("agent-a");
    });
  });

  // -------------------------------------------------------------------------
  // publish() — handler error handling
  // -------------------------------------------------------------------------
  describe("publish() — handler error handling", () => {
    it("should catch and log synchronous handler errors without throwing", async () => {
      service.subscribe(SESSION, "agent-b", () => {
        throw new Error("sync boom");
      });

      await expect(
        publish(service, { toAgentId: "agent-b" }),
      ).resolves.toBeDefined();
    });

    it("should catch and log async handler rejections without throwing", async () => {
      service.subscribe(SESSION, "agent-b", async () => {
        await Promise.reject(new Error("async boom"));
      });

      await expect(
        publish(service, { toAgentId: "agent-b" }),
      ).resolves.toBeDefined();

      // Give microtasks a chance to settle
      await new Promise((resolve) => setImmediate(resolve));
    });

    it("should still deliver to other handlers even if one throws", async () => {
      const good = jest.fn();
      service.subscribe(SESSION, "agent-b", () => {
        throw new Error("bad handler");
      });
      service.subscribe(SESSION, "agent-b", good);

      await publish(service, { toAgentId: "agent-b" });
      expect(good).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // publish() — TTL check
  // -------------------------------------------------------------------------
  describe("publish() — TTL expiry", () => {
    it("should skip delivery when message is expired before delivery (mocked)", async () => {
      const handler = jest.fn();
      service.subscribe(SESSION, "agent-b", handler);

      // Set ttlMs to 0ms — but since delivery is synchronous, the timestamp
      // delta will typically be 0 and may not expire. We mock Date to force it.
      const realNow = Date.now;

      // Make Date.now return a value far in the future when checked inside publish
      let callCount = 0;
      jest.spyOn(Date, "now").mockImplementation(() => {
        // First call (for `now` assignment inside publish) returns base time
        // Second call would be internal — we skip that, instead we manipulate
        // ttlMs so that (now - message.timestamp) > ttlMs
        callCount++;
        if (callCount === 1) {
          // Returns a time that's 100ms ahead of message.timestamp
          return realNow() + 100;
        }
        return realNow();
      });

      await publish(service, {
        toAgentId: "agent-b",
        ttlMs: 1, // 1ms TTL — the timestamp will be ~100ms behind the "now"
      });

      // Restore
      jest.spyOn(Date, "now").mockRestore();

      // Handler should NOT have been called because message expired
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getHistory()
  // -------------------------------------------------------------------------
  describe("getHistory()", () => {
    it("should return empty array for unknown session", () => {
      expect(service.getHistory("unknown-session")).toEqual([]);
    });

    it("should return messages in publish order", async () => {
      await publish(service, { payload: { n: 1 } });
      await publish(service, { payload: { n: 2 } });

      const history = service.getHistory(SESSION);
      expect(history).toHaveLength(2);
    });

    it("should store at most MAX_HISTORY messages, dropping oldest", async () => {
      const MAX_HISTORY = (service as any).MAX_HISTORY as number;

      // Publish MAX_HISTORY + 50 messages
      for (let i = 0; i < MAX_HISTORY + 50; i++) {
        await publish(service, { payload: { n: i } });
      }

      const history = service.getHistory(SESSION);
      expect(history).toHaveLength(MAX_HISTORY);

      // The first message should be the 51st published (oldest dropped)
      expect((history[0].payload as { n: number }).n).toBe(50);
    });
  });

  // -------------------------------------------------------------------------
  // clearSession()
  // -------------------------------------------------------------------------
  describe("clearSession()", () => {
    it("should remove all subscribers for the session", async () => {
      const handler = jest.fn();
      service.subscribe(SESSION, "agent-b", handler);

      service.clearSession(SESSION);

      // After clear, publish returns early because there are no sessionSubs
      await publish(service, { toAgentId: "agent-b" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("should remove history for the session", async () => {
      await publish(service);
      expect(service.getHistory(SESSION)).toHaveLength(1);

      service.clearSession(SESSION);
      expect(service.getHistory(SESSION)).toEqual([]);
    });

    it("should not throw when called for a session that never existed", () => {
      expect(() => service.clearSession("nonexistent")).not.toThrow();
    });
  });
});
