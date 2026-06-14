/**
 * AgentLifecycleProtocolService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";

// Suppress logger output in tests
jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

import { AgentLifecycleProtocolService } from "../agent-lifecycle-protocol.service";
import { MessagePersistenceService } from "../message-persistence.service";
import type { PersistedMessage } from "../message-persistence.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SESSION = "session-001";
const AGENT_A = "agent-a";
const AGENT_B = "agent-b";

function buildPersistenceMock() {
  return {
    persist: jest.fn().mockReturnValue("msg-123"),
    loadPending: jest.fn().mockReturnValue([] as PersistedMessage[]),
    markDelivered: jest.fn().mockReturnValue(true),
    cleanup: jest.fn().mockReturnValue(0),
    getPendingCount: jest.fn().mockReturnValue(0),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("AgentLifecycleProtocolService", () => {
  let service: AgentLifecycleProtocolService;
  let persistence: ReturnType<typeof buildPersistenceMock>;

  beforeEach(async () => {
    persistence = buildPersistenceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentLifecycleProtocolService,
        {
          provide: MessagePersistenceService,
          useValue: persistence,
        },
      ],
    }).compile();

    service = module.get<AgentLifecycleProtocolService>(
      AgentLifecycleProtocolService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  // ─── 1. requestShutdown persists high-priority message ────────────────────
  describe("requestShutdown", () => {
    it("persists a shutdown_request with high priority and returns the message id", () => {
      const payload = { reason: "task done", gracePeriodMs: 5000 };

      const id = service.requestShutdown(SESSION, AGENT_A, AGENT_B, payload);

      expect(id).toBe("msg-123");
      expect(persistence.persist).toHaveBeenCalledWith(
        SESSION,
        AGENT_A,
        AGENT_B,
        "shutdown_request",
        payload,
        { priority: "high" },
      );
    });
  });

  // ─── 2. acknowledgeShutdown persists ack ──────────────────────────────────
  describe("acknowledgeShutdown", () => {
    it("persists a shutdown_ack with high priority", () => {
      const id = service.acknowledgeShutdown(SESSION, AGENT_B, AGENT_A, true);

      expect(id).toBe("msg-123");
      expect(persistence.persist).toHaveBeenCalledWith(
        SESSION,
        AGENT_B,
        AGENT_A,
        "shutdown_ack",
        { accepted: true },
        { priority: "high" },
      );
    });

    it("passes accepted=false correctly", () => {
      service.acknowledgeShutdown(SESSION, AGENT_B, AGENT_A, false);

      expect(persistence.persist).toHaveBeenCalledWith(
        SESSION,
        AGENT_B,
        AGENT_A,
        "shutdown_ack",
        { accepted: false },
        { priority: "high" },
      );
    });
  });

  // ─── 3. submitPlanForApproval persists plan ────────────────────────────────
  describe("submitPlanForApproval", () => {
    it("persists a plan_approval message with normal priority", () => {
      const plan = { steps: ["step1", "step2"] };

      const id = service.submitPlanForApproval(
        SESSION,
        AGENT_A,
        AGENT_B,
        "plan-001",
        plan,
      );

      expect(id).toBe("msg-123");
      expect(persistence.persist).toHaveBeenCalledWith(
        SESSION,
        AGENT_A,
        AGENT_B,
        "plan_approval",
        { planId: "plan-001", plan },
        { priority: "normal" },
      );
    });
  });

  // ─── 4. respondToPlan persists approval/rejection ─────────────────────────
  describe("respondToPlan", () => {
    it("uses plan_approval type when approved=true", () => {
      service.respondToPlan(SESSION, AGENT_B, AGENT_A, {
        planId: "plan-001",
        approved: true,
        feedback: "looks good",
      });

      expect(persistence.persist).toHaveBeenCalledWith(
        SESSION,
        AGENT_B,
        AGENT_A,
        "plan_approval",
        expect.objectContaining({ approved: true }),
        { priority: "normal" },
      );
    });

    it("uses plan_rejection type when approved=false", () => {
      service.respondToPlan(SESSION, AGENT_B, AGENT_A, {
        planId: "plan-001",
        approved: false,
        feedback: "needs revision",
      });

      expect(persistence.persist).toHaveBeenCalledWith(
        SESSION,
        AGENT_B,
        AGENT_A,
        "plan_rejection",
        expect.objectContaining({ approved: false }),
        { priority: "normal" },
      );
    });
  });

  // ─── 5. notifyTaskComplete persists notification ───────────────────────────
  describe("notifyTaskComplete", () => {
    it("persists a task_notification with normal priority", () => {
      const payload = {
        taskId: "task-001",
        status: "completed" as const,
        summary: "All done",
        tokensUsed: 1500,
        durationMs: 3200,
      };

      const id = service.notifyTaskComplete(SESSION, AGENT_A, AGENT_B, payload);

      expect(id).toBe("msg-123");
      expect(persistence.persist).toHaveBeenCalledWith(
        SESSION,
        AGENT_A,
        AGENT_B,
        "task_notification",
        payload,
        { priority: "normal" },
      );
    });
  });

  // ─── 6. sendHeartbeat persists with 1min TTL ──────────────────────────────
  describe("sendHeartbeat", () => {
    it("persists a heartbeat broadcast to '*' with low priority and 60s TTL", () => {
      const id = service.sendHeartbeat(SESSION, AGENT_A);

      expect(id).toBe("msg-123");
      expect(persistence.persist).toHaveBeenCalledWith(
        SESSION,
        AGENT_A,
        "*",
        "heartbeat",
        expect.objectContaining({ timestamp: expect.any(String) }),
        { priority: "low", ttlMs: 60_000 },
      );
    });
  });

  // ─── 7. checkAndResume returns true when pending messages exist ────────────
  describe("checkAndResume", () => {
    it("returns true when agent has pending messages", () => {
      persistence.getPendingCount.mockReturnValue(3);

      expect(service.checkAndResume(SESSION, AGENT_A)).toBe(true);
    });

    it("returns false when agent has no pending messages", () => {
      persistence.getPendingCount.mockReturnValue(0);

      expect(service.checkAndResume(SESSION, AGENT_A)).toBe(false);
    });
  });

  // ─── 8. all methods return null when persistence unavailable ──────────────
  describe("without persistence (optional injection)", () => {
    let noPersistService: AgentLifecycleProtocolService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [AgentLifecycleProtocolService],
      }).compile();

      noPersistService = module.get<AgentLifecycleProtocolService>(
        AgentLifecycleProtocolService,
      );
    });

    it("requestShutdown returns null", () => {
      expect(
        noPersistService.requestShutdown(SESSION, AGENT_A, AGENT_B, {
          reason: "done",
          gracePeriodMs: 0,
        }),
      ).toBeNull();
    });

    it("acknowledgeShutdown returns null", () => {
      expect(
        noPersistService.acknowledgeShutdown(SESSION, AGENT_A, AGENT_B, true),
      ).toBeNull();
    });

    it("submitPlanForApproval returns null", () => {
      expect(
        noPersistService.submitPlanForApproval(
          SESSION,
          AGENT_A,
          AGENT_B,
          "p-1",
          {},
        ),
      ).toBeNull();
    });

    it("respondToPlan returns null", () => {
      expect(
        noPersistService.respondToPlan(SESSION, AGENT_A, AGENT_B, {
          planId: "p-1",
          approved: true,
        }),
      ).toBeNull();
    });

    it("notifyTaskComplete returns null", () => {
      expect(
        noPersistService.notifyTaskComplete(SESSION, AGENT_A, AGENT_B, {
          taskId: "t-1",
          status: "completed",
          summary: "done",
        }),
      ).toBeNull();
    });

    it("sendHeartbeat returns null", () => {
      expect(noPersistService.sendHeartbeat(SESSION, AGENT_A)).toBeNull();
    });

    it("checkAndResume returns false", () => {
      expect(noPersistService.checkAndResume(SESSION, AGENT_A)).toBe(false);
    });
  });
});
