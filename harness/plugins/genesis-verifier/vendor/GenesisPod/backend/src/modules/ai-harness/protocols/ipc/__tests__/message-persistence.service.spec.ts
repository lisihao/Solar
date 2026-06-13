/**
 * MessagePersistenceService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";

// Suppress logger output in tests
jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

import { MessagePersistenceService } from "../message-persistence.service";
import type { PersistedMessage } from "../message-persistence.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SESSION = "session-001";
const OTHER_SESSION = "session-002";
const AGENT_A = "agent-a";
const AGENT_B = "agent-b";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("MessagePersistenceService", () => {
  let service: MessagePersistenceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MessagePersistenceService],
    }).compile();

    service = module.get<MessagePersistenceService>(MessagePersistenceService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── 1. persist stores message and returns id ──────────────────────────────
  describe("persist", () => {
    it("stores a message and returns a non-empty id", () => {
      // Arrange / Act
      const id = service.persist(SESSION, AGENT_A, AGENT_B, "info_share", {
        data: "hello",
      });

      // Assert
      expect(id).toBeTruthy();
      expect(typeof id).toBe("string");
    });

    it("returns unique ids for successive calls", () => {
      const id1 = service.persist(SESSION, AGENT_A, AGENT_B, "info_share", {});
      const id2 = service.persist(SESSION, AGENT_A, AGENT_B, "info_share", {});

      expect(id1).not.toBe(id2);
    });
  });

  // ─── 2. loadPending returns undelivered messages for target agent ───────────
  describe("loadPending", () => {
    it("returns undelivered messages addressed to the target agent", () => {
      service.persist(SESSION, AGENT_A, AGENT_B, "task_request", {
        task: "run",
      });
      service.persist(SESSION, AGENT_A, AGENT_B, "info_share", {
        info: "note",
      });

      const pending = service.loadPending(SESSION, AGENT_B);

      expect(pending).toHaveLength(2);
      expect(
        pending.every((m: PersistedMessage) => m.toAgentId === AGENT_B),
      ).toBe(true);
    });

    // ─── 3. loadPending excludes delivered messages ────────────────────────
    it("excludes messages that have already been delivered", () => {
      const id = service.persist(SESSION, AGENT_A, AGENT_B, "info_share", {});
      service.markDelivered(id);

      const pending = service.loadPending(SESSION, AGENT_B);

      expect(pending).toHaveLength(0);
    });

    // ─── 4. loadPending excludes expired messages ──────────────────────────
    it("excludes messages whose TTL has elapsed", () => {
      // Persist with a TTL that has already passed by backdating expiresAt
      const id = service.persist(
        SESSION,
        AGENT_A,
        AGENT_B,
        "info_share",
        {},
        {
          ttlMs: 1, // 1ms
        },
      );
      // Advance time conceptually: wait for TTL to expire
      // We manipulate the stored message's expiresAt directly to simulate expiry
      // without using fake timers (keeps test deterministic)
      const messages: Map<string, PersistedMessage> = (
        service as unknown as { messages: Map<string, PersistedMessage> }
      ).messages;
      const msg = messages.get(id)!;
      msg.expiresAt = new Date(Date.now() - 1000); // 1 second in the past

      const pending = service.loadPending(SESSION, AGENT_B);

      expect(pending).toHaveLength(0);
    });

    // ─── 5. loadPending sorts by priority then time ────────────────────────
    it("sorts messages: high priority first, then normal, then low; stable by createdAt", () => {
      const lowId = service.persist(
        SESSION,
        AGENT_A,
        AGENT_B,
        "t",
        {},
        {
          priority: "low",
        },
      );
      const highId = service.persist(
        SESSION,
        AGENT_A,
        AGENT_B,
        "t",
        {},
        {
          priority: "high",
        },
      );
      const normalId = service.persist(
        SESSION,
        AGENT_A,
        AGENT_B,
        "t",
        {},
        {
          priority: "normal",
        },
      );

      const pending = service.loadPending(SESSION, AGENT_B);

      expect(pending[0].id).toBe(highId);
      expect(pending[1].id).toBe(normalId);
      expect(pending[2].id).toBe(lowId);
    });

    // ─── 10. loadPending filters by sessionId ─────────────────────────────
    it("does not return messages from a different session", () => {
      service.persist(OTHER_SESSION, AGENT_A, AGENT_B, "info_share", {});

      const pending = service.loadPending(SESSION, AGENT_B);

      expect(pending).toHaveLength(0);
    });

    it("does not return messages addressed to a different agent", () => {
      service.persist(SESSION, AGENT_A, AGENT_A, "info_share", {});

      const pending = service.loadPending(SESSION, AGENT_B);

      expect(pending).toHaveLength(0);
    });
  });

  // ─── 6. markDelivered marks and returns true ───────────────────────────────
  describe("markDelivered", () => {
    it("returns true and sets deliveredAt on a known undelivered message", () => {
      const id = service.persist(SESSION, AGENT_A, AGENT_B, "info_share", {});

      const result = service.markDelivered(id);

      expect(result).toBe(true);
      const messages: Map<string, PersistedMessage> = (
        service as unknown as { messages: Map<string, PersistedMessage> }
      ).messages;
      expect(messages.get(id)?.deliveredAt).toBeInstanceOf(Date);
    });

    // ─── 7. markDelivered returns false for unknown/already delivered ──────
    it("returns false for an unknown message id", () => {
      expect(service.markDelivered("non-existent-id")).toBe(false);
    });

    it("returns false when called a second time on the same message", () => {
      const id = service.persist(SESSION, AGENT_A, AGENT_B, "info_share", {});
      service.markDelivered(id);

      expect(service.markDelivered(id)).toBe(false);
    });
  });

  // ─── 8. cleanup removes delivered + expired ────────────────────────────────
  describe("cleanup", () => {
    it("removes delivered messages older than the threshold", () => {
      const id = service.persist(SESSION, AGENT_A, AGENT_B, "info_share", {});
      service.markDelivered(id);

      // Use a future threshold so the delivered message is considered old
      const cleaned = service.cleanup(new Date(Date.now() + 1000));

      expect(cleaned).toBe(1);
      const messages: Map<string, PersistedMessage> = (
        service as unknown as { messages: Map<string, PersistedMessage> }
      ).messages;
      expect(messages.has(id)).toBe(false);
    });

    it("removes expired undelivered messages", () => {
      const id = service.persist(
        SESSION,
        AGENT_A,
        AGENT_B,
        "info_share",
        {},
        {
          ttlMs: 1,
        },
      );
      const messages: Map<string, PersistedMessage> = (
        service as unknown as { messages: Map<string, PersistedMessage> }
      ).messages;
      // Backdate expiresAt so cleanup considers it expired
      messages.get(id)!.expiresAt = new Date(Date.now() - 1000);

      const cleaned = service.cleanup();

      expect(cleaned).toBe(1);
      expect(messages.has(id)).toBe(false);
    });

    it("does not remove messages that are neither delivered nor expired", () => {
      service.persist(SESSION, AGENT_A, AGENT_B, "info_share", {});

      const cleaned = service.cleanup(new Date(Date.now() + 1000));

      expect(cleaned).toBe(0);
    });

    it("returns 0 when there is nothing to clean", () => {
      expect(service.cleanup()).toBe(0);
    });
  });

  // ─── 9. getPendingCount returns correct count ──────────────────────────────
  describe("getPendingCount", () => {
    it("returns the number of pending messages for an agent", () => {
      service.persist(SESSION, AGENT_A, AGENT_B, "t1", {});
      service.persist(SESSION, AGENT_A, AGENT_B, "t2", {});
      const delivered = service.persist(SESSION, AGENT_A, AGENT_B, "t3", {});
      service.markDelivered(delivered);

      expect(service.getPendingCount(SESSION, AGENT_B)).toBe(2);
    });

    it("returns 0 when there are no pending messages", () => {
      expect(service.getPendingCount(SESSION, AGENT_B)).toBe(0);
    });
  });
});
