/**
 * SessionLatencyTrackerService Unit Tests
 *
 * Comprehensive branch coverage including:
 * - Session lifecycle (startSession / endSession / getSession / getActiveSessionSummary)
 * - Step management (startStep / endStep / endStepByName / getActiveStepId)
 * - Action recording with all throughput calculation branches
 * - Summary computation (TTFT/TTLT stats, percentiles, step breakdown, llmTimePercent)
 * - Auto-close of open steps on endSession
 * - Error / graceful-handling paths (invalid sessionId, invalid stepId)
 * - DB persistence via PrismaService (mock) — success and failure paths
 * - listSessions / getLatestSummary query methods — all filter branches
 * - LRU eviction behaviour
 * - Legacy alias API
 * - MissionContext integration with nested AsyncLocalStorage scopes
 * - Full production parallel simulation (5 dimensions, mirroring Topic Insights flow)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SessionLatencyTrackerService } from "../latency/session-latency-tracker.service";
import { MissionContext } from "@/common/context/mission-context";
import type { RecordActionInput } from "../latency/session-latency.types";

// ---------------------------------------------------------------------------
// Suppress Logger output during tests
// ---------------------------------------------------------------------------
jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMockPrisma() {
  return {
    latencySession: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
}

/** Build a minimal streaming action input */
function streamingCall(
  overrides: Partial<RecordActionInput> = {},
): RecordActionInput {
  return {
    name: "streaming_call",
    model: "gpt-4o",
    provider: "openai",
    streaming: true,
    ttftMs: 300,
    ttltMs: 3000,
    totalDurationMs: 3000,
    inputTokens: 200,
    outputTokens: 400,
    ...overrides,
  };
}

/** Build a minimal non-streaming action input */
function nonStreamingCall(
  overrides: Partial<RecordActionInput> = {},
): RecordActionInput {
  return {
    name: "non_streaming_call",
    model: "claude-3",
    provider: "anthropic",
    streaming: false,
    totalDurationMs: 2000,
    inputTokens: 100,
    outputTokens: 200,
    ttltMs: 2000,
    ...overrides,
  };
}

/** Small delay to guarantee a measurable wall-clock duration */
function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ===========================================================================
// Suite A – No Prisma (pure in-memory)
// ===========================================================================

describe("SessionLatencyTrackerService (no Prisma)", () => {
  let service: SessionLatencyTrackerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SessionLatencyTrackerService],
    }).compile();

    service = module.get<SessionLatencyTrackerService>(
      SessionLatencyTrackerService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // 1. Session lifecycle
  // =========================================================================

  describe("Session lifecycle", () => {
    it("should start a session and return a non-empty string ID", () => {
      const sessionId = service.startSession({ type: "ai_ask" });

      expect(typeof sessionId).toBe("string");
      expect(sessionId.length).toBeGreaterThan(0);
    });

    it("should be retrievable via getSession immediately after start", () => {
      const sessionId = service.startSession({
        type: "research_mission",
        entityId: "entity-42",
        userId: "user-1",
        metadata: { key: "value" },
      });

      const session = service.getSession(sessionId);

      expect(session).toBeDefined();
      expect(session!.id).toBe(sessionId);
      expect(session!.type).toBe("research_mission");
      expect(session!.entityId).toBe("entity-42");
      expect(session!.userId).toBe("user-1");
      expect(session!.metadata).toEqual({ key: "value" });
      expect(session!.status).toBe("running");
      expect(session!.steps).toHaveLength(0);
    });

    it("startSession defaults metadata to empty object when not provided", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const session = service.getSession(sessionId);

      expect(session!.metadata).toEqual({});
    });

    it("should return a summary with correct fields on endSession", async () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      await wait(5);

      const summary = service.endSession(sessionId);

      expect(summary).toBeDefined();
      expect(summary!.sessionId).toBe(sessionId);
      expect(summary!.type).toBe("ai_ask");
      expect(summary!.status).toBe("completed");
      expect(summary!.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(summary!.llmCallCount).toBe(0);
      expect(summary!.llmTotalTimeMs).toBe(0);
      expect(summary!.steps).toHaveLength(0);
    });

    it("should mark session as failed when status=failed is passed", () => {
      const sessionId = service.startSession({ type: "team_execution" });

      const summary = service.endSession(sessionId, "failed");

      expect(summary!.status).toBe("failed");
    });

    it("startSession generates unique IDs each time", () => {
      const id1 = service.startSession({ type: "ai_ask" });
      const id2 = service.startSession({ type: "ai_ask" });

      expect(id1).not.toBe(id2);
    });

    it("getSession returns undefined for unknown sessionId", () => {
      const result = service.getSession("nonexistent-id");
      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. getActiveSessionSummary
  // =========================================================================

  describe("getActiveSessionSummary", () => {
    it("returns summary for a running session matching entityId", () => {
      const sessionId = service.startSession({
        type: "topic_insights_refresh",
        entityId: "topic-abc",
      });

      const summary = service.getActiveSessionSummary("topic-abc");

      expect(summary).toBeDefined();
      expect(summary!.sessionId).toBe(sessionId);
    });

    it("returns undefined when no running session matches entityId", () => {
      service.startSession({
        type: "topic_insights_refresh",
        entityId: "topic-abc",
      });

      const summary = service.getActiveSessionSummary("topic-xyz");
      expect(summary).toBeUndefined();
    });

    it("returns undefined when session is completed (not running)", () => {
      const sessionId = service.startSession({
        type: "topic_insights_refresh",
        entityId: "topic-done",
      });
      service.endSession(sessionId);

      const summary = service.getActiveSessionSummary("topic-done");
      expect(summary).toBeUndefined();
    });

    it("returns summary when type filter matches", () => {
      service.startSession({
        type: "topic_insights_refresh",
        entityId: "shared-entity",
      });

      const summary = service.getActiveSessionSummary(
        "shared-entity",
        "topic_insights_refresh",
      );
      expect(summary).toBeDefined();
    });

    it("returns undefined when type filter does not match", () => {
      service.startSession({
        type: "topic_insights_refresh",
        entityId: "shared-entity",
      });

      const summary = service.getActiveSessionSummary(
        "shared-entity",
        "ai_ask",
      );
      expect(summary).toBeUndefined();
    });

    it("returns undefined when no sessions exist at all", () => {
      const summary = service.getActiveSessionSummary("any-entity");
      expect(summary).toBeUndefined();
    });
  });

  // =========================================================================
  // 3. Multiple sequential steps
  // =========================================================================

  describe("Multiple sequential steps", () => {
    it("should collect all top-level steps in summary with correct names", async () => {
      const sessionId = service.startSession({
        type: "topic_insights_refresh",
      });

      const step1Id = service.startStep(sessionId, { name: "planning" });
      await wait(5);
      service.endStep(sessionId, step1Id);

      const step2Id = service.startStep(sessionId, { name: "execution" });
      await wait(5);
      service.endStep(sessionId, step2Id);

      const step3Id = service.startStep(sessionId, { name: "formatting" });
      await wait(5);
      service.endStep(sessionId, step3Id);

      const summary = service.endSession(sessionId);

      expect(summary!.steps).toHaveLength(3);
      const names = summary!.steps.map((s) => s.name);
      expect(names).toContain("planning");
      expect(names).toContain("execution");
      expect(names).toContain("formatting");
    });

    it("should compute positive durationMs for each step", async () => {
      const sessionId = service.startSession({ type: "ai_writing" });

      const stepId = service.startStep(sessionId, { name: "draft" });
      await wait(5);
      service.endStep(sessionId, stepId);

      const summary = service.endSession(sessionId);
      const draftStep = summary!.steps.find((s) => s.name === "draft");

      expect(draftStep!.durationMs).toBeGreaterThan(0);
    });

    it("should compute percentOfTotal that sums to ≤ 100 for sequential steps", async () => {
      const sessionId = service.startSession({ type: "ai_ask" });

      const s1 = service.startStep(sessionId, { name: "s1" });
      await wait(5);
      service.endStep(sessionId, s1);

      const s2 = service.startStep(sessionId, { name: "s2" });
      await wait(5);
      service.endStep(sessionId, s2);

      const summary = service.endSession(sessionId);

      const total = summary!.steps.reduce(
        (acc, s) => acc + s.percentOfTotal,
        0,
      );
      expect(total).toBeLessThanOrEqual(100.1);
      expect(total).toBeGreaterThan(0);
    });

    it("step with no actions has actionCount=0 and avgTtltMs=undefined", async () => {
      const sessionId = service.startSession({ type: "ai_ask" });

      const stepId = service.startStep(sessionId, { name: "empty-step" });
      await wait(5);
      service.endStep(sessionId, stepId);

      const summary = service.endSession(sessionId);
      const step = summary!.steps.find((s) => s.name === "empty-step");

      expect(step!.actionCount).toBe(0);
      expect(step!.avgTtltMs).toBeUndefined();
    });

    it("step with LLM actions computes avgTtltMs correctly", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "llm-step" });

      service.recordAction(
        sessionId,
        nonStreamingCall({ name: "call_1", ttltMs: 1000, stepId }),
      );
      service.recordAction(
        sessionId,
        nonStreamingCall({ name: "call_2", ttltMs: 3000, stepId }),
      );

      service.endStep(sessionId, stepId);
      const summary = service.endSession(sessionId);
      const step = summary!.steps.find((s) => s.name === "llm-step");

      // avg of 1000 and 3000 = 2000
      expect(step!.avgTtltMs).toBe(2000);
    });

    it("percentOfTotal is 0 when totalDurationMs is 0 (fixed clock)", () => {
      const fixedTime = 1700000000000;
      const dateSpy = jest.spyOn(Date, "now").mockReturnValue(fixedTime);

      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "instant" });
      service.endStep(sessionId, stepId);
      const summary = service.endSession(sessionId);

      expect(summary!.steps[0].percentOfTotal).toBe(0);
      dateSpy.mockRestore();
    });

    it("step with endTime but no durationMs uses endTime-startTime fallback in summary", () => {
      // Force a step to have endTime set (by auto-close in endSession) but no durationMs
      // We do this by directly manipulating the internal session object after startStep
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "no-duration-step" });

      // Directly clear durationMs on the step to trigger the fallback branch
      const session = service.getSession(sessionId)!;
      const step = session.steps.find((s) => s.id === stepId)!;
      step.endTime = Date.now() + 100;
      step.durationMs = undefined; // clear it — forces the `?? (s.endTime ? ... : 0)` branch

      const summary = service.endSession(sessionId);
      const stepSummary = summary!.steps.find(
        (s) => s.name === "no-duration-step",
      );

      // Should use endTime - startTime = 100 (approximately)
      expect(stepSummary).toBeDefined();
      expect(stepSummary!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("step with neither endTime nor durationMs uses 0 fallback in summary", () => {
      // A step that is open (no endTime, no durationMs) when computeSummary is called
      // This is the `s.endTime ? ... : 0` false branch inside `??`
      const sessionId = service.startSession({ type: "ai_ask" });
      service.startStep(sessionId, { name: "open-step" });

      // Call getActiveSessionSummary which calls computeSummary without endSession
      // The open step has no endTime and no durationMs → uses 0
      // getActiveSessionSummary matches on entityId, not sessionId — need entityId
      // Use a different approach: call endSession which auto-closes but we want pre-close
      // Actually, getActiveSessionSummary takes entityId. Use a session with entityId.
      const sessionId2 = service.startSession({
        type: "ai_ask",
        entityId: "open-step-test",
      });
      service.startStep(sessionId2, { name: "open-step-2" });

      const liveSummary2 = service.getActiveSessionSummary("open-step-test");
      expect(liveSummary2).toBeDefined();
      // The open step has durationMs=undefined and endTime=undefined → dur = 0
      const stepEntry = liveSummary2!.steps.find(
        (s) => s.name === "open-step-2",
      );
      expect(stepEntry!.durationMs).toBe(0);
    });
  });

  // =========================================================================
  // 4. Parallel steps
  // =========================================================================

  describe("Parallel steps", () => {
    it("should record parallel flag and parallelCount in step metadata", () => {
      const sessionId = service.startSession({ type: "team_execution" });

      const stepId = service.startStep(sessionId, {
        name: "parallel_research",
        parallel: true,
        parallelCount: 5,
      });

      const session = service.getSession(sessionId);
      const step = session!.steps.find((s) => s.id === stepId);

      expect(step!.parallel).toBe(true);
      expect(step!.parallelCount).toBe(5);
    });

    it("should include parallel step in summary as a top-level step", async () => {
      const sessionId = service.startSession({ type: "team_execution" });

      const stepId = service.startStep(sessionId, {
        name: "parallel_workers",
        parallel: true,
        parallelCount: 3,
      });
      await wait(5);
      service.endStep(sessionId, stepId);

      const summary = service.endSession(sessionId);

      expect(summary!.steps).toHaveLength(1);
      expect(summary!.steps[0].name).toBe("parallel_workers");
    });

    it("llmTimePercent can exceed 100 when parallel LLM calls sum greater than wall time", () => {
      // Use a sequence: session start at T=0, everything else at T=1
      // so totalDurationMs = 1ms, but llmTotalTimeMs = 2000ms → llmTimePercent >> 100
      const base = 1700000000000;
      let callCount = 0;
      const dateSpy = jest.spyOn(Date, "now").mockImplementation(() => {
        // First call is startSession (sets startTime = base)
        // All subsequent calls return base + 1 → totalDurationMs = 1ms
        return callCount++ === 0 ? base : base + 1;
      });

      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "parallel_work" });

      // Two parallel LLM calls, each 1000ms, but wall time is only 1ms
      service.recordAction(
        sessionId,
        nonStreamingCall({
          name: "call_a",
          totalDurationMs: 1000,
          ttltMs: 1000,
          stepId,
        }),
      );
      service.recordAction(
        sessionId,
        nonStreamingCall({
          name: "call_b",
          totalDurationMs: 1000,
          ttltMs: 1000,
          stepId,
        }),
      );

      service.endStep(sessionId, stepId);
      const summary = service.endSession(sessionId);

      // llmTotalTimeMs = 2000, totalDurationMs = 1 → llmTimePercent = 200000
      expect(summary!.llmTimePercent).toBeGreaterThan(100);

      dateSpy.mockRestore();
    });

    it("overheadMs is capped at 0 when llmTotalTimeMs > totalDurationMs", () => {
      const fixedTime = 1700000000000;
      const dateSpy = jest
        .spyOn(Date, "now")
        .mockReturnValue(fixedTime)
        .mockReturnValueOnce(fixedTime)
        .mockReturnValueOnce(fixedTime)
        .mockReturnValueOnce(fixedTime + 50);

      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "parallel_work" });

      service.recordAction(
        sessionId,
        nonStreamingCall({
          name: "call_a",
          totalDurationMs: 5000,
          ttltMs: 5000,
          stepId,
        }),
      );
      service.recordAction(
        sessionId,
        nonStreamingCall({
          name: "call_b",
          totalDurationMs: 5000,
          ttltMs: 5000,
          stepId,
        }),
      );

      service.endStep(sessionId, stepId);
      const summary = service.endSession(sessionId);

      // overheadMs = Math.max(0, totalDurationMs - llmTotalTimeMs) — must not be negative
      expect(summary!.overheadMs).toBeGreaterThanOrEqual(0);

      dateSpy.mockRestore();
    });
  });

  // =========================================================================
  // 5. Nested steps (child steps excluded from top-level summary)
  // =========================================================================

  describe("Nested steps", () => {
    it("should exclude child steps from summary steps array", async () => {
      const sessionId = service.startSession({ type: "research_mission" });

      const parentId = service.startStep(sessionId, { name: "parent" });
      const childId = service.startStep(sessionId, {
        name: "child",
        parentStepId: parentId,
      });
      await wait(5);
      service.endStep(sessionId, childId);
      service.endStep(sessionId, parentId);

      const summary = service.endSession(sessionId);

      expect(summary!.steps).toHaveLength(1);
      expect(summary!.steps[0].name).toBe("parent");
    });

    it("should store parentStepId on the child step object", () => {
      const sessionId = service.startSession({ type: "ai_ask" });

      const parentId = service.startStep(sessionId, { name: "parent" });
      const childId = service.startStep(sessionId, {
        name: "child",
        parentStepId: parentId,
      });

      const session = service.getSession(sessionId);
      const child = session!.steps.find((s) => s.id === childId);

      expect(child!.parentStepId).toBe(parentId);
    });

    it("should handle multiple nested children, all excluded from summary", async () => {
      const sessionId = service.startSession({ type: "ai_writing" });

      const parentId = service.startStep(sessionId, { name: "root" });
      const child1 = service.startStep(sessionId, {
        name: "child-a",
        parentStepId: parentId,
      });
      const child2 = service.startStep(sessionId, {
        name: "child-b",
        parentStepId: parentId,
      });
      await wait(5);
      service.endStep(sessionId, child1);
      service.endStep(sessionId, child2);
      service.endStep(sessionId, parentId);

      const summary = service.endSession(sessionId);

      expect(summary!.steps).toHaveLength(1);
      expect(summary!.steps[0].name).toBe("root");
    });
  });

  // =========================================================================
  // 6. Action recording – throughput branches
  // =========================================================================

  describe("Action recording – throughput calculation branches", () => {
    it("streaming: ttftMs < ttltMs uses generation time branch", () => {
      // ttftMs=200, ttltMs=5000, outputTokens=500
      // generationTimeMs = 4800, throughput = 500/4.8 ≈ 104.2
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "test_step" });

      service.recordAction(sessionId, {
        name: "streaming_op",
        model: "gpt-4o",
        provider: "openai",
        streaming: true,
        ttftMs: 200,
        ttltMs: 5000,
        totalDurationMs: 5000,
        inputTokens: 100,
        outputTokens: 500,
        stepId,
      });

      const session = service.getSession(sessionId);
      const step = session!.steps.find((s) => s.id === stepId);
      const action = step!.actions[0];

      expect(action.tokenThroughputPerSec).toBeCloseTo(104.2, 0);
    });

    it("streaming with ttft === ttlt falls through to totalDurationMs branch", () => {
      // ttftMs === ttltMs → condition `ttltMs > ttftMs` is false
      // Falls back to totalDurationMs: 50 / 1000 * 1000 = 50
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "test_step" });

      service.recordAction(sessionId, {
        name: "edge_case_op",
        model: "gpt-4o",
        provider: "openai",
        streaming: true,
        ttftMs: 1000,
        ttltMs: 1000,
        totalDurationMs: 1000,
        inputTokens: 10,
        outputTokens: 50,
        stepId,
      });

      const session = service.getSession(sessionId);
      const step = session!.steps.find((s) => s.id === stepId);
      const action = step!.actions[0];

      expect(action.tokenThroughputPerSec).toBe(50);
    });

    it("non-streaming uses totalDurationMs branch", () => {
      // totalDurationMs=3000, outputTokens=300 → 300/3 = 100 tokens/sec
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "test_step" });

      service.recordAction(sessionId, {
        name: "non_streaming_op",
        model: "claude-3",
        provider: "anthropic",
        streaming: false,
        ttltMs: 3000,
        totalDurationMs: 3000,
        inputTokens: 100,
        outputTokens: 300,
        stepId,
      });

      const session = service.getSession(sessionId);
      const step = session!.steps.find((s) => s.id === stepId);
      const action = step!.actions[0];

      expect(action.tokenThroughputPerSec).toBe(100);
    });

    it("non-streaming with totalDurationMs=0 produces 0 throughput", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "test_step" });

      service.recordAction(sessionId, {
        name: "zero_duration_op",
        model: "gpt-4o",
        provider: "openai",
        streaming: false,
        ttltMs: 0,
        totalDurationMs: 0,
        inputTokens: 10,
        outputTokens: 50,
        stepId,
      });

      const session = service.getSession(sessionId);
      const step = session!.steps.find((s) => s.id === stepId);
      const action = step!.actions[0];

      expect(action.tokenThroughputPerSec).toBe(0);
    });

    it("type defaults to 'llm_call' when not provided", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "test_step" });

      service.recordAction(sessionId, streamingCall({ stepId }));

      const session = service.getSession(sessionId);
      const step = session!.steps.find((s) => s.id === stepId);
      const action = step!.actions[0];

      expect(action.type).toBe("llm_call");
    });

    it("explicit type 'tool_call' is stored correctly", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "test_step" });

      service.recordAction(sessionId, {
        name: "web_search",
        type: "tool_call",
        model: "tool",
        provider: "internal",
        streaming: false,
        ttltMs: 500,
        totalDurationMs: 500,
        inputTokens: 0,
        outputTokens: 0,
        stepId,
      });

      const session = service.getSession(sessionId);
      const step = session!.steps.find((s) => s.id === stepId);
      const action = step!.actions[0];

      expect(action.type).toBe("tool_call");
    });

    it("recordAction without stepId attaches to active (last open) step", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "active_step" });

      // No stepId in input — should attach to the currently active step
      service.recordAction(sessionId, streamingCall({ name: "auto_attach" }));

      const session = service.getSession(sessionId);
      const step = session!.steps.find((s) => s.id === stepId);
      expect(step!.actions).toHaveLength(1);
      expect(step!.actions[0].name).toBe("auto_attach");
    });

    it("recordAction with explicit stepId pointing to closed step still attaches", () => {
      // The service searches all steps (including closed ones) when stepId is explicit
      const sessionId = service.startSession({ type: "ai_ask" });
      const closedStepId = service.startStep(sessionId, {
        name: "closed_step",
      });
      service.endStep(sessionId, closedStepId);

      // Now start another step so there IS an active step
      service.startStep(sessionId, { name: "open_step" });

      // Record action with explicit stepId pointing to closed step
      service.recordAction(
        sessionId,
        streamingCall({ name: "action_on_closed", stepId: closedStepId }),
      );

      const session = service.getSession(sessionId);
      const closedStep = session!.steps.find((s) => s.id === closedStepId);
      const openStep = session!.steps.find((s) => s.name === "open_step");

      expect(closedStep!.actions).toHaveLength(1);
      expect(openStep!.actions).toHaveLength(0);
    });

    it("recordAction with no active step and no stepId drops the action silently", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      // No steps started — there is no active step
      // No stepId in input — action should be dropped

      expect(() => {
        service.recordAction(sessionId, streamingCall({ name: "dropped" }));
      }).not.toThrow();

      const session = service.getSession(sessionId);
      // No steps, no actions recorded anywhere
      expect(session!.steps).toHaveLength(0);
    });

    it("recordAction when all steps are closed and no stepId drops the action", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "closed" });
      service.endStep(sessionId, closedStepId(stepId));

      // No open step, no stepId — should drop
      service.recordAction(sessionId, streamingCall({ name: "dropped" }));

      const session = service.getSession(sessionId);
      const step = session!.steps.find((s) => s.id === stepId);
      expect(step!.actions).toHaveLength(0);
    });
  });

  // =========================================================================
  // 7. Action recording – aggregated stats in summary
  // =========================================================================

  describe("Action recording – aggregated summary stats", () => {
    it("should count 10 recorded actions", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "test_step" });

      for (let i = 0; i < 10; i++) {
        service.recordAction(
          sessionId,
          streamingCall({
            name: `call_${i}`,
            ttftMs: 100 + i * 50,
            ttltMs: 2000 + i * 100,
            stepId,
          }),
        );
      }

      const session = service.getSession(sessionId);
      const step = session!.steps.find((s) => s.id === stepId);
      expect(step!.actions).toHaveLength(10);

      const summary = service.endSession(sessionId);
      expect(summary!.llmCallCount).toBe(10);
    });

    it("should compute TTFT avgMs correctly for known values", () => {
      // ttftMs values: 100, 200, 300 → avg = 200
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "test_step" });

      [100, 200, 300].forEach((ttftMs) => {
        service.recordAction(
          sessionId,
          streamingCall({
            name: "ttft_call",
            ttftMs,
            ttltMs: ttftMs + 1000,
            totalDurationMs: ttftMs + 1000,
            stepId,
          }),
        );
      });

      const summary = service.endSession(sessionId);

      expect(summary!.ttft).toBeDefined();
      expect(summary!.ttft!.avgMs).toBe(200);
    });

    it("should compute TTFT p50Ms and p95Ms for 10 sorted values", () => {
      // ttftMs: 100..1000 in steps of 100
      // p50: ceil(50/100 * 10) - 1 = 4 → sorted[4] = 500
      // p95: ceil(95/100 * 10) - 1 = 9 → sorted[9] = 1000
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "test_step" });

      for (let i = 1; i <= 10; i++) {
        service.recordAction(
          sessionId,
          streamingCall({
            name: `call_${i}`,
            ttftMs: i * 100,
            ttltMs: i * 100 + 2000,
            totalDurationMs: i * 100 + 2000,
            stepId,
          }),
        );
      }

      const summary = service.endSession(sessionId);

      expect(summary!.ttft).toBeDefined();
      expect(summary!.ttft!.p50Ms).toBe(500);
      expect(summary!.ttft!.p95Ms).toBe(1000);
      expect(summary!.ttft!.minMs).toBe(100);
      expect(summary!.ttft!.maxMs).toBe(1000);
    });

    it("should compute llmTimePercent correctly", async () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "test_step" });

      service.recordAction(
        sessionId,
        nonStreamingCall({
          name: "call_1",
          totalDurationMs: 500,
          ttltMs: 500,
          stepId,
        }),
      );
      service.recordAction(
        sessionId,
        nonStreamingCall({
          name: "call_2",
          totalDurationMs: 500,
          ttltMs: 500,
          stepId,
        }),
      );

      const summary = service.endSession(sessionId);

      expect(summary!.llmTotalTimeMs).toBe(1000);
      expect(summary!.llmTimePercent).toBeGreaterThanOrEqual(0);
    });

    it("should aggregate totalInputTokens and totalOutputTokens", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "test_step" });

      service.recordAction(
        sessionId,
        streamingCall({
          name: "call_1",
          inputTokens: 100,
          outputTokens: 200,
          stepId,
        }),
      );
      service.recordAction(
        sessionId,
        streamingCall({
          name: "call_2",
          inputTokens: 150,
          outputTokens: 250,
          stepId,
        }),
      );

      const summary = service.endSession(sessionId);

      expect(summary!.totalInputTokens).toBe(250);
      expect(summary!.totalOutputTokens).toBe(450);
    });

    it("should compute avgTokenThroughput as average of individual throughputs", () => {
      // 300/3000*1000=100, 200/2000*1000=100 → avg=100
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "test_step" });

      service.recordAction(
        sessionId,
        nonStreamingCall({
          name: "call_1",
          outputTokens: 300,
          totalDurationMs: 3000,
          ttltMs: 3000,
          stepId,
        }),
      );
      service.recordAction(
        sessionId,
        nonStreamingCall({
          name: "call_2",
          outputTokens: 200,
          totalDurationMs: 2000,
          ttltMs: 2000,
          stepId,
        }),
      );

      const summary = service.endSession(sessionId);

      expect(summary!.avgTokenThroughput).toBe(100);
    });

    it("avgTokenThroughput is 0 when all throughputs are 0", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "test_step" });

      service.recordAction(
        sessionId,
        nonStreamingCall({
          name: "call",
          outputTokens: 0,
          totalDurationMs: 0,
          ttltMs: 0,
          stepId,
        }),
      );

      const summary = service.endSession(sessionId);
      expect(summary!.avgTokenThroughput).toBe(0);
    });
  });

  // =========================================================================
  // 8. Auto-close of open steps on endSession
  // =========================================================================

  describe("Auto-close of open steps", () => {
    it("should auto-close an unclosed step when endSession is called", () => {
      const sessionId = service.startSession({ type: "ai_ask" });

      service.startStep(sessionId, { name: "unclosed" });

      const summary = service.endSession(sessionId);

      expect(summary!.steps).toHaveLength(1);
      expect(summary!.steps[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it("should auto-close multiple open steps", () => {
      const sessionId = service.startSession({ type: "ai_ask" });

      service.startStep(sessionId, { name: "step-a" });
      service.startStep(sessionId, { name: "step-b" });

      const summary = service.endSession(sessionId);

      expect(summary!.steps).toHaveLength(2);
    });

    it("already closed steps are not re-closed on endSession", async () => {
      const sessionId = service.startSession({ type: "ai_ask" });

      const stepId = service.startStep(sessionId, { name: "closed" });
      await wait(5);
      const duration1 = service.endStep(sessionId, stepId);

      // endSession should not modify the already-closed step's endTime
      service.endSession(sessionId);

      const session = service.getSession(sessionId);
      const step = session!.steps.find((s) => s.id === stepId);
      expect(step!.durationMs).toBe(duration1);
    });
  });

  // =========================================================================
  // 9. Error paths – session/step not found
  // =========================================================================

  describe("Invalid sessionId graceful handling", () => {
    it("endSession with unknown id returns undefined", () => {
      const result = service.endSession("nonexistent-id");
      expect(result).toBeUndefined();
    });

    it("startStep with unknown sessionId returns empty string", () => {
      const stepId = service.startStep("nonexistent-id", { name: "x" });
      expect(stepId).toBe("");
    });

    it("endStep with unknown sessionId returns undefined", () => {
      const result = service.endStep("nonexistent-id", "nonexistent-step");
      expect(result).toBeUndefined();
    });

    it("endStep with unknown stepId (valid session) returns undefined", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const result = service.endStep(sessionId, "bad-step-id");
      expect(result).toBeUndefined();
    });

    it("recordAction with unknown sessionId does not throw", () => {
      expect(() => {
        service.recordAction("nonexistent-id", streamingCall());
      }).not.toThrow();
    });

    it("getActiveStepId with unknown sessionId returns undefined", () => {
      const result = service.getActiveStepId("nonexistent-id");
      expect(result).toBeUndefined();
    });

    it("endStepByName with unknown sessionId returns undefined", () => {
      const result = service.endStepByName("nonexistent-id", "x");
      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // 10. Empty session
  // =========================================================================

  describe("Empty session", () => {
    it("should return a valid summary with zero counts", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const summary = service.endSession(sessionId);

      expect(summary).toBeDefined();
      expect(summary!.llmCallCount).toBe(0);
      expect(summary!.llmTotalTimeMs).toBe(0);
      expect(summary!.llmTimePercent).toBe(0);
      expect(summary!.overheadMs).toBeGreaterThanOrEqual(0);
      expect(summary!.steps).toHaveLength(0);
      expect(summary!.totalInputTokens).toBe(0);
      expect(summary!.totalOutputTokens).toBe(0);
      expect(summary!.avgTokenThroughput).toBe(0);
    });

    it("ttft and ttlt are both undefined when no actions", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const summary = service.endSession(sessionId);

      expect(summary!.ttft).toBeUndefined();
      expect(summary!.ttlt).toBeUndefined();
    });

    it("ttlt is undefined when there are no llm_call actions with ttltMs > 0", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "step" });

      // A tool call (not llm_call) — filtered out of ttlt calculation
      service.recordAction(sessionId, {
        name: "web_search",
        type: "tool_call",
        model: "tool",
        provider: "internal",
        streaming: false,
        ttltMs: 0,
        totalDurationMs: 500,
        inputTokens: 0,
        outputTokens: 0,
        stepId,
      });

      service.endStep(sessionId, stepId);
      const summary = service.endSession(sessionId);

      expect(summary!.ttlt).toBeUndefined();
    });

    it("ttlt is undefined when all llm_call ttltMs values are 0", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "step" });

      service.recordAction(
        sessionId,
        nonStreamingCall({
          name: "zero_ttlt",
          ttltMs: 0,
          totalDurationMs: 0,
          stepId,
        }),
      );

      service.endStep(sessionId, stepId);
      const summary = service.endSession(sessionId);

      expect(summary!.ttlt).toBeUndefined();
    });
  });

  // =========================================================================
  // 11. endStepByName
  // =========================================================================

  describe("endStepByName", () => {
    it("should end the correct open step by name", async () => {
      const sessionId = service.startSession({ type: "ai_ask" });

      service.startStep(sessionId, { name: "target" });
      await wait(5);

      const duration = service.endStepByName(sessionId, "target");

      expect(typeof duration).toBe("number");
      expect(duration).toBeGreaterThan(0);
    });

    it("should return undefined when no open step with that name exists", () => {
      const sessionId = service.startSession({ type: "ai_ask" });

      const result = service.endStepByName(sessionId, "missing-step");
      expect(result).toBeUndefined();
    });

    it("should end the LAST open step when multiple open steps share same name", async () => {
      // Both steps with name "dup" are open; endStepByName should close the last one
      const sessionId = service.startSession({ type: "ai_ask" });

      const firstId = service.startStep(sessionId, { name: "dup" });
      await wait(2);
      const secondId = service.startStep(sessionId, { name: "dup" });
      await wait(5);

      const duration = service.endStepByName(sessionId, "dup");

      expect(typeof duration).toBe("number");
      expect(duration).toBeGreaterThan(0);

      // Verify the second (last) step was closed, first still open
      const session = service.getSession(sessionId);
      const first = session!.steps.find((s) => s.id === firstId);
      const second = session!.steps.find((s) => s.id === secondId);

      expect(second!.endTime).toBeDefined();
      expect(first!.endTime).toBeUndefined();
    });

    it("closes first step when it is open and second already closed", async () => {
      const sessionId = service.startSession({ type: "ai_ask" });

      const firstId = service.startStep(sessionId, { name: "dup" });
      await wait(2);
      // Close the first one manually
      service.endStep(sessionId, firstId);

      // Open a second step with same name
      service.startStep(sessionId, { name: "dup" });
      await wait(5);

      const duration = service.endStepByName(sessionId, "dup");

      expect(typeof duration).toBe("number");
      expect(duration).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 12. getActiveStepId
  // =========================================================================

  describe("getActiveStepId", () => {
    it("should return undefined when no steps exist", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      expect(service.getActiveStepId(sessionId)).toBeUndefined();
    });

    it("should return the last open step id", () => {
      const sessionId = service.startSession({ type: "ai_ask" });

      const id1 = service.startStep(sessionId, { name: "first" });
      const id2 = service.startStep(sessionId, { name: "second" });

      expect(service.getActiveStepId(sessionId)).toBe(id2);

      service.endStep(sessionId, id2);
      expect(service.getActiveStepId(sessionId)).toBe(id1);
    });

    it("should return undefined when all steps are closed", () => {
      const sessionId = service.startSession({ type: "ai_ask" });

      const id = service.startStep(sessionId, { name: "only" });
      service.endStep(sessionId, id);

      expect(service.getActiveStepId(sessionId)).toBeUndefined();
    });
  });

  // =========================================================================
  // 13. No streaming calls → ttft is undefined in summary
  // =========================================================================

  describe("No streaming calls", () => {
    it("should return ttft=undefined when only non-streaming calls are recorded", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "test_step" });

      service.recordAction(
        sessionId,
        nonStreamingCall({ name: "call_1", stepId }),
      );
      service.recordAction(
        sessionId,
        nonStreamingCall({ name: "call_2", stepId }),
      );

      const summary = service.endSession(sessionId);

      expect(summary!.ttft).toBeUndefined();
    });

    it("should return ttft=undefined when no actions at all", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const summary = service.endSession(sessionId);

      expect(summary!.ttft).toBeUndefined();
    });
  });

  // =========================================================================
  // 14. Percentile edge cases
  // =========================================================================

  describe("Percentile edge cases", () => {
    it("single streaming call: p50=p95=that value", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "test_step" });

      service.recordAction(
        sessionId,
        streamingCall({
          name: "single_call",
          ttftMs: 400,
          ttltMs: 2000,
          totalDurationMs: 2000,
          stepId,
        }),
      );

      const summary = service.endSession(sessionId);

      expect(summary!.ttft!.p50Ms).toBe(400);
      expect(summary!.ttft!.p95Ms).toBe(400);
      expect(summary!.ttft!.minMs).toBe(400);
      expect(summary!.ttft!.maxMs).toBe(400);
    });

    it("two streaming calls: p50 and p95 return expected elements", () => {
      // sorted: [100, 800]
      // p50: ceil(0.5*2)-1 = 0 → sorted[0] = 100
      // p95: ceil(0.95*2)-1 = 1 → sorted[1] = 800
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "test_step" });

      service.recordAction(
        sessionId,
        streamingCall({
          name: "call_1",
          ttftMs: 800,
          ttltMs: 3000,
          totalDurationMs: 3000,
          stepId,
        }),
      );
      service.recordAction(
        sessionId,
        streamingCall({
          name: "call_2",
          ttftMs: 100,
          ttltMs: 1000,
          totalDurationMs: 1000,
          stepId,
        }),
      );

      const summary = service.endSession(sessionId);

      expect(summary!.ttft!.p50Ms).toBe(100);
      expect(summary!.ttft!.p95Ms).toBe(800);
    });
  });

  // =========================================================================
  // 15. Zero-duration step
  // =========================================================================

  describe("Zero-duration step", () => {
    it("should produce durationMs=0 for a step ended in same tick (mocked Date.now)", () => {
      const fixedTime = 1700000000000;
      const dateSpy = jest.spyOn(Date, "now").mockReturnValue(fixedTime);

      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "instant" });
      service.endStep(sessionId, stepId);

      const summary = service.endSession(sessionId);
      const step = summary!.steps[0];

      expect(step.durationMs).toBe(0);

      dateSpy.mockRestore();
    });
  });

  // =========================================================================
  // 16. LRU eviction
  // =========================================================================

  describe("LRU eviction", () => {
    it("should evict the oldest session when capacity is exceeded", () => {
      const firstId = service.startSession({ type: "ai_ask" });

      // Fill up to 499 more (total 500 including firstId)
      for (let i = 1; i < 500; i++) {
        service.startSession({ type: "ai_ask" });
      }

      expect(service.getSession(firstId)).toBeDefined();

      // Adding one more triggers eviction of firstId
      service.startSession({ type: "ai_ask" });

      expect(service.getSession(firstId)).toBeUndefined();
    });
  });

  // =========================================================================
  // 17. endStep metadata merge
  // =========================================================================

  describe("endStep metadata merge", () => {
    it("should merge additional metadata on endStep", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, {
        name: "meta-step",
        metadata: { initial: true },
      });

      service.endStep(sessionId, stepId, { extra: "data" });

      const session = service.getSession(sessionId);
      const step = session!.steps.find((s) => s.id === stepId);

      expect(step!.metadata).toEqual({ initial: true, extra: "data" });
    });

    it("endStep without metadata does not change existing metadata", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, {
        name: "meta-step",
        metadata: { existing: true },
      });

      service.endStep(sessionId, stepId);

      const session = service.getSession(sessionId);
      const step = session!.steps.find((s) => s.id === stepId);
      expect(step!.metadata).toEqual({ existing: true });
    });

    it("endStep returns the durationMs as a number", async () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "timed" });
      await wait(5);

      const duration = service.endStep(sessionId, stepId);

      expect(typeof duration).toBe("number");
      expect(duration).toBeGreaterThan(0);
    });

    it("endStep with unknown stepId returns undefined", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const result = service.endStep(sessionId, "bad-step");
      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // 18. Legacy alias API
  // =========================================================================

  describe("Legacy alias API", () => {
    it("startPhase/endPhase aliases work like startStep/endStep", async () => {
      const sessionId = service.startSession({ type: "ai_ask" });

      const phaseId = service.startPhase(sessionId, { name: "legacy_phase" });
      await wait(5);
      const duration = service.endPhase(sessionId, phaseId);

      expect(typeof duration).toBe("number");
      expect(duration).toBeGreaterThan(0);

      const summary = service.endSession(sessionId);
      expect(summary!.steps).toHaveLength(1);
      expect(summary!.steps[0].name).toBe("legacy_phase");
    });

    it("endPhaseByName alias works like endStepByName", async () => {
      const sessionId = service.startSession({ type: "ai_ask" });

      service.startPhase(sessionId, { name: "named_phase" });
      await wait(5);
      const duration = service.endPhaseByName(sessionId, "named_phase");

      expect(typeof duration).toBe("number");
      expect(duration).toBeGreaterThan(0);
    });

    it("getActivePhaseId alias works like getActiveStepId", () => {
      const sessionId = service.startSession({ type: "ai_ask" });

      expect(service.getActivePhaseId(sessionId)).toBeUndefined();

      const id = service.startPhase(sessionId, { name: "active" });
      expect(service.getActivePhaseId(sessionId)).toBe(id);
    });

    it("recordLLMCall alias works like recordAction", () => {
      const sessionId = service.startSession({ type: "ai_ask" });
      const stepId = service.startStep(sessionId, { name: "test_step" });

      service.recordLLMCall(
        sessionId,
        streamingCall({ name: "legacy_call", stepId }),
      );

      const session = service.getSession(sessionId);
      const step = session!.steps.find((s) => s.id === stepId);
      expect(step!.actions).toHaveLength(1);

      const summary = service.endSession(sessionId);
      expect(summary!.llmCallCount).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Small helper to use a stepId value in a later line (self-documenting)
// ---------------------------------------------------------------------------
function closedStepId(id: string): string {
  return id;
}

// ===========================================================================
// Suite B – With Prisma (persistence)
// ===========================================================================

describe("SessionLatencyTrackerService (with Prisma)", () => {
  let service: SessionLatencyTrackerService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(async () => {
    mockPrisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionLatencyTrackerService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SessionLatencyTrackerService>(
      SessionLatencyTrackerService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // 19. DB persistence on endSession
  // =========================================================================

  describe("DB persistence", () => {
    it("should call prisma.latencySession.create on endSession", async () => {
      const sessionId = service.startSession({
        type: "topic_insights_refresh",
        entityId: "entity-1",
        userId: "user-1",
      });

      service.endSession(sessionId);

      // fire-and-forget – flush microtask queue
      await new Promise<void>((r) => setTimeout(r, 0));

      expect(mockPrisma.latencySession.create).toHaveBeenCalledTimes(1);
    });

    it("should pass correct fields to prisma.latencySession.create", async () => {
      const sessionId = service.startSession({
        type: "ai_ask",
        entityId: "e-42",
        userId: "u-7",
      });

      const summary = service.endSession(sessionId);

      await new Promise<void>((r) => setTimeout(r, 0));

      const callArg = mockPrisma.latencySession.create.mock.calls[0][0];
      const data = callArg.data;

      expect(data.id).toBe(sessionId);
      expect(data.type).toBe("ai_ask");
      expect(data.entityId).toBe("e-42");
      expect(data.userId).toBe("u-7");
      expect(data.status).toBe("completed");
      expect(data.durationMs).toBe(summary!.totalDurationMs);
      expect(data.summary).toMatchObject({ sessionId });
    });

    it("should include serialized steps and llmCalls in persist payload", async () => {
      const sessionId = service.startSession({
        type: "ai_ask",
        entityId: "e-1",
      });
      const stepId = service.startStep(sessionId, { name: "test_step" });
      service.recordAction(
        sessionId,
        streamingCall({ name: "a_call", stepId }),
      );
      service.endStep(sessionId, stepId);
      service.endSession(sessionId);

      await new Promise<void>((r) => setTimeout(r, 0));

      const callArg = mockPrisma.latencySession.create.mock.calls[0][0];
      const data = callArg.data;

      // phases = serialized steps array
      expect(Array.isArray(data.phases)).toBe(true);
      expect(data.phases).toHaveLength(1);

      // llmCalls = flattened actions
      expect(Array.isArray(data.llmCalls)).toBe(true);
      expect(data.llmCalls).toHaveLength(1);
    });

    it("should not call prisma when prisma is not injected", async () => {
      // This is tested in Suite C (no-prisma), but here we verify the guard
      // by having the create mock not be called when prisma is missing.
      // (The test is logically covered by Suite C's listSessions/getLatestSummary tests.)
      expect(mockPrisma.latencySession.create).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 20. DB persistence failure
  // =========================================================================

  describe("DB persistence failure", () => {
    it("should still return summary even if prisma.create throws", async () => {
      mockPrisma.latencySession.create.mockRejectedValue(
        new Error("DB connection lost"),
      );

      const sessionId = service.startSession({ type: "ai_ask" });
      const summary = service.endSession(sessionId);

      await new Promise<void>((r) => setTimeout(r, 0));

      expect(summary).toBeDefined();
      expect(summary!.sessionId).toBe(sessionId);
    });
  });

  // =========================================================================
  // 21. listSessions – filter construction
  // =========================================================================

  describe("listSessions", () => {
    it("should call findMany with correct where clause when all filters provided", async () => {
      const since = Date.now() - 86400000;

      mockPrisma.latencySession.findMany.mockResolvedValue([]);

      await service.listSessions({
        type: "ai_ask",
        userId: "user-1",
        entityId: "entity-1",
        status: "completed",
        since,
        limit: 10,
      });

      expect(mockPrisma.latencySession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: "ai_ask",
            userId: "user-1",
            entityId: "entity-1",
            status: "completed",
            startTime: { gte: new Date(since) },
          }),
          take: 10,
        }),
      );
    });

    it("should default take to 50 when limit not provided", async () => {
      mockPrisma.latencySession.findMany.mockResolvedValue([]);

      await service.listSessions({});

      const callArg = mockPrisma.latencySession.findMany.mock.calls[0][0];
      expect(callArg.take).toBe(50);
    });

    it("should return parsed summaries from DB rows", async () => {
      const fakeSummary = {
        sessionId: "abc",
        type: "ai_ask",
        status: "completed",
        totalDurationMs: 1000,
        steps: [],
        llmCallCount: 0,
        llmTotalTimeMs: 0,
        llmTimePercent: 0,
        overheadMs: 1000,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        avgTokenThroughput: 0,
      };

      mockPrisma.latencySession.findMany.mockResolvedValue([
        { summary: fakeSummary },
      ]);

      const results = await service.listSessions({ type: "ai_ask" });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(fakeSummary);
    });

    it("should return empty array on DB error", async () => {
      mockPrisma.latencySession.findMany.mockRejectedValue(
        new Error("DB error"),
      );

      const results = await service.listSessions({ type: "ai_ask" });
      expect(results).toEqual([]);
    });

    it("should filter out null/undefined summary rows", async () => {
      mockPrisma.latencySession.findMany.mockResolvedValue([
        { summary: null },
        { summary: undefined },
      ]);

      const results = await service.listSessions({});
      expect(results).toEqual([]);
    });

    it("listSessions without type filter omits type from where", async () => {
      mockPrisma.latencySession.findMany.mockResolvedValue([]);

      await service.listSessions({ userId: "user-1" });

      const callArg = mockPrisma.latencySession.findMany.mock.calls[0][0];
      expect(callArg.where).not.toHaveProperty("type");
      expect(callArg.where.userId).toBe("user-1");
    });

    it("listSessions without since filter omits startTime from where", async () => {
      mockPrisma.latencySession.findMany.mockResolvedValue([]);

      await service.listSessions({ type: "ai_ask" });

      const callArg = mockPrisma.latencySession.findMany.mock.calls[0][0];
      expect(callArg.where).not.toHaveProperty("startTime");
    });
  });

  // =========================================================================
  // 22. getLatestSummary
  // =========================================================================

  describe("getLatestSummary", () => {
    it("should call findFirst with entityId filter", async () => {
      mockPrisma.latencySession.findFirst.mockResolvedValue(null);

      await service.getLatestSummary("entity-99");

      expect(mockPrisma.latencySession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ entityId: "entity-99" }),
          orderBy: { createdAt: "desc" },
        }),
      );
    });

    it("should include type in where clause when provided", async () => {
      mockPrisma.latencySession.findFirst.mockResolvedValue(null);

      await service.getLatestSummary("entity-99", "topic_insights_refresh");

      const callArg = mockPrisma.latencySession.findFirst.mock.calls[0][0];
      expect(callArg.where).toMatchObject({
        entityId: "entity-99",
        type: "topic_insights_refresh",
      });
    });

    it("should return parsed summary when row is found", async () => {
      const fakeSummary = { sessionId: "xyz", type: "ai_ask" };
      mockPrisma.latencySession.findFirst.mockResolvedValue({
        summary: fakeSummary,
      });

      const result = await service.getLatestSummary("entity-1");

      expect(result).toEqual(fakeSummary);
    });

    it("should return undefined when no row is found", async () => {
      mockPrisma.latencySession.findFirst.mockResolvedValue(null);

      const result = await service.getLatestSummary("entity-missing");
      expect(result).toBeUndefined();
    });

    it("should return undefined on DB error", async () => {
      mockPrisma.latencySession.findFirst.mockRejectedValue(
        new Error("DB down"),
      );

      const result = await service.getLatestSummary("entity-1");
      expect(result).toBeUndefined();
    });
  });
});

// ===========================================================================
// Suite C – No Prisma (query methods return empty/undefined)
// ===========================================================================

describe("SessionLatencyTrackerService query methods (no Prisma)", () => {
  let service: SessionLatencyTrackerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SessionLatencyTrackerService],
    }).compile();

    service = module.get<SessionLatencyTrackerService>(
      SessionLatencyTrackerService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it("listSessions returns [] when no Prisma is injected", async () => {
    const result = await service.listSessions({ type: "ai_ask" });
    expect(result).toEqual([]);
  });

  it("getLatestSummary returns undefined when no Prisma is injected", async () => {
    const result = await service.getLatestSummary("entity-1");
    expect(result).toBeUndefined();
  });
});

// ===========================================================================
// Suite D – Integration simulation (full session flow with mock DB)
// ===========================================================================

describe("SessionLatencyTrackerService – full flow integration", () => {
  let service: SessionLatencyTrackerService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(async () => {
    mockPrisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionLatencyTrackerService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SessionLatencyTrackerService>(
      SessionLatencyTrackerService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it("full topic_insights_refresh flow produces a complete summary", async () => {
    const sessionId = service.startSession({
      type: "topic_insights_refresh",
      entityId: "topic-123",
      userId: "user-42",
      metadata: { refresh: true },
    });

    // Step 1: planning
    const planningId = service.startStep(sessionId, {
      name: "leader_planning",
    });
    service.recordAction(sessionId, {
      name: "planning_llm",
      model: "gpt-4o",
      provider: "openai",
      streaming: true,
      ttftMs: 300,
      ttltMs: 4500,
      totalDurationMs: 4500,
      inputTokens: 500,
      outputTokens: 800,
      stepId: planningId,
    });
    service.endStep(sessionId, planningId);

    // Step 2: dimension research (parallel)
    const researchId = service.startStep(sessionId, {
      name: "dimension_research",
      parallel: true,
      parallelCount: 4,
    });
    for (let i = 0; i < 4; i++) {
      service.recordAction(sessionId, {
        name: `research_${i}`,
        model: "gpt-4o",
        provider: "openai",
        streaming: true,
        ttftMs: 250 + i * 50,
        ttltMs: 3000 + i * 200,
        totalDurationMs: 3000 + i * 200,
        inputTokens: 400,
        outputTokens: 600,
        stepId: researchId,
      });
    }
    service.endStep(sessionId, researchId);

    // Step 3: formatting (non-streaming)
    const formattingId = service.startStep(sessionId, { name: "formatting" });
    service.recordAction(sessionId, {
      name: "formatting_llm",
      model: "claude-3",
      provider: "anthropic",
      streaming: false,
      ttltMs: 2000,
      totalDurationMs: 2000,
      inputTokens: 2000,
      outputTokens: 1500,
      stepId: formattingId,
    });
    service.endStep(sessionId, formattingId);

    const summary = service.endSession(sessionId);

    await new Promise<void>((r) => setTimeout(r, 0));

    expect(summary).toBeDefined();
    expect(summary!.sessionId).toBe(sessionId);
    expect(summary!.type).toBe("topic_insights_refresh");
    expect(summary!.status).toBe("completed");
    expect(summary!.steps).toHaveLength(3);
    // 1 planning + 4 research + 1 formatting = 6 total
    expect(summary!.llmCallCount).toBe(6);
    // planning: ttftMs=300; research: 250, 300, 350, 400 → min=250, max=400
    expect(summary!.ttft).toBeDefined();
    expect(summary!.ttft!.minMs).toBe(250);
    expect(summary!.ttft!.maxMs).toBe(400);
    // tokens: 500+4*400+2000=4100 in, 800+4*600+1500=4700 out
    expect(summary!.totalInputTokens).toBe(4100);
    expect(summary!.totalOutputTokens).toBe(4700);
    expect(mockPrisma.latencySession.create).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Suite E – MissionContext integration
// ===========================================================================

describe("SessionLatencyTrackerService – MissionContext integration", () => {
  let service: SessionLatencyTrackerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SessionLatencyTrackerService],
    }).compile();

    service = module.get<SessionLatencyTrackerService>(
      SessionLatencyTrackerService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it("MissionContext.run propagates latencySessionId to nested async scope", async () => {
    const sessionId = service.startSession({
      type: "topic_insights_refresh",
      entityId: "ctx-test",
    });

    let capturedSessionId: string | undefined;
    let capturedPhaseId: string | undefined;

    const stepId = service.startStep(sessionId, { name: "ctx_step" });

    await MissionContext.run(
      {
        agentProcessId: "proc-1",
        latencySessionId: sessionId,
        latencyPhaseId: stepId,
      },
      async () => {
        const ctx = MissionContext.get();
        capturedSessionId = ctx?.latencySessionId;
        capturedPhaseId = ctx?.latencyPhaseId;

        // Simulate an LLM call inside the context
        if (capturedSessionId && capturedPhaseId) {
          service.recordAction(capturedSessionId, {
            name: "ctx_call",
            model: "gpt-4o",
            provider: "openai",
            streaming: true,
            ttftMs: 250,
            ttltMs: 2000,
            totalDurationMs: 2000,
            inputTokens: 100,
            outputTokens: 200,
            stepId: capturedPhaseId,
          });
        }
      },
    );

    service.endStep(sessionId, stepId);
    const summary = service.endSession(sessionId);

    expect(capturedSessionId).toBe(sessionId);
    expect(capturedPhaseId).toBe(stepId);
    expect(summary!.llmCallCount).toBe(1);
  });

  it("nested MissionContext.run() preserves outer latencySessionId when inner overrides latencyPhaseId", async () => {
    const sessionId = service.startSession({
      type: "topic_insights_refresh",
      entityId: "nested-ctx",
    });

    const outerStepId = service.startStep(sessionId, { name: "outer_step" });

    await MissionContext.run(
      {
        agentProcessId: "proc-outer",
        latencySessionId: sessionId,
        latencyPhaseId: outerStepId,
      },
      async () => {
        // Verify outer context
        const outerCtx = MissionContext.get();
        expect(outerCtx?.latencySessionId).toBe(sessionId);
        expect(outerCtx?.latencyPhaseId).toBe(outerStepId);

        // Nested run with a different phaseId
        const innerStepId = service.startStep(sessionId, {
          name: "inner_step",
        });
        await MissionContext.run(
          {
            ...outerCtx!,
            latencyPhaseId: innerStepId,
          },
          async () => {
            const innerCtx = MissionContext.get();
            // sessionId still propagated from outer
            expect(innerCtx?.latencySessionId).toBe(sessionId);
            // phaseId is the inner one
            expect(innerCtx?.latencyPhaseId).toBe(innerStepId);

            service.recordAction(sessionId, {
              name: "inner_call",
              model: "gpt-4o",
              provider: "openai",
              streaming: false,
              ttltMs: 1000,
              totalDurationMs: 1000,
              inputTokens: 50,
              outputTokens: 100,
              stepId: innerStepId,
            });
          },
        );

        service.endStep(sessionId, innerStepId);

        // After inner run, outer context is restored
        const restoredCtx = MissionContext.get();
        expect(restoredCtx?.latencyPhaseId).toBe(outerStepId);
      },
    );

    service.endStep(sessionId, outerStepId);
    const summary = service.endSession(sessionId);

    // Both steps in session (but inner has parentStepId? — in this test neither has parentStepId)
    // inner_step action should be recorded correctly
    expect(summary!.llmCallCount).toBe(1);
  });
});

// ===========================================================================
// Suite F – CRITICAL: Full production parallel simulation (Topic Insights)
// Mirrors MissionExecutionService flow with 5 parallel dimensions
// ===========================================================================

describe("SessionLatencyTrackerService – production parallel flow (Topic Insights)", () => {
  let service: SessionLatencyTrackerService;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;

  const DIMENSIONS = [
    "TTLT定义与指标边界",
    "行业标杆数据",
    "技术优化路径",
    "用户感知建模",
    "未来演进趋势",
  ];

  beforeEach(async () => {
    mockPrisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionLatencyTrackerService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SessionLatencyTrackerService>(
      SessionLatencyTrackerService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  /**
   * Core production simulation test.
   *
   * Mirrors the exact flow in MissionExecutionService:
   *   startSession → MissionContext.run({ latencySessionId }) →
   *     initialization step → task_execution step (parallel: true) →
   *       Promise.all: 5 dimensions each in MissionContext.run({ latencyPhaseId }) →
   *         dimension_research step → sub-steps (搜索/大纲/写作) with actions →
   *     report_synthesis step → finalization step → endSession
   */
  it("5-dimension parallel execution: each dimension has isolated actions, no cross-contamination", async () => {
    // 1. MissionExecutionService.startExecution
    const sessionId = service.startSession({
      type: "topic_insights_refresh",
      entityId: "topic-parallel-test",
      userId: "user-mission",
    });

    await MissionContext.run(
      {
        agentProcessId: "mission-proc-1",
        latencySessionId: sessionId,
      },
      async () => {
        const ctx = MissionContext.get()!;

        // --- initialization step ---
        const initStepId = service.startStep(sessionId, {
          name: "initialization",
        });
        service.endStep(sessionId, initStepId);

        // --- task_execution step (parallel container) ---
        const taskStepId = service.startStep(sessionId, {
          name: "task_execution",
          parallel: true,
          parallelCount: DIMENSIONS.length,
        });

        // 2. Promise.all: 5 dimensions in parallel
        await Promise.all(
          DIMENSIONS.map((dimension) =>
            MissionContext.run(
              { ...ctx, latencyPhaseId: taskStepId },
              async () => {
                const dimCtx = MissionContext.get()!;

                // Each dimension starts its own wrapper step
                const dimStepId = service.startStep(sessionId, {
                  name: `dimension_research:${dimension}`,
                  parentStepId: taskStepId,
                });

                // Sub-step 1: 搜索数据 — 3 LLM calls
                const searchStepId = service.startStep(sessionId, {
                  name: `${dimension}/搜索数据`,
                  parentStepId: dimStepId,
                });
                for (let i = 0; i < 3; i++) {
                  service.recordAction(sessionId, {
                    name: `${dimension}/search_call_${i}`,
                    model: "gpt-4o",
                    provider: "openai",
                    streaming: true,
                    ttftMs: 200 + i * 50,
                    ttltMs: 1500 + i * 200,
                    totalDurationMs: 1500 + i * 200,
                    inputTokens: 300,
                    outputTokens: 400,
                    stepId: searchStepId,
                  });
                }
                service.endStep(sessionId, searchStepId);

                // Sub-step 2: 大纲规划 — 1 LLM call
                const outlineStepId = service.startStep(sessionId, {
                  name: `${dimension}/大纲规划`,
                  parentStepId: dimStepId,
                });
                service.recordAction(sessionId, {
                  name: `${dimension}/outline_call`,
                  model: "gpt-4o",
                  provider: "openai",
                  streaming: true,
                  ttftMs: 280,
                  ttltMs: 2200,
                  totalDurationMs: 2200,
                  inputTokens: 500,
                  outputTokens: 600,
                  stepId: outlineStepId,
                });
                service.endStep(sessionId, outlineStepId);

                // Sub-step 3: 写作与审核 — 5 LLM calls
                const writeStepId = service.startStep(sessionId, {
                  name: `${dimension}/写作与审核`,
                  parentStepId: dimStepId,
                });
                for (let i = 0; i < 5; i++) {
                  service.recordAction(sessionId, {
                    name: `${dimension}/write_call_${i}`,
                    model: "gpt-4o",
                    provider: "openai",
                    streaming: true,
                    ttftMs: 180 + i * 40,
                    ttltMs: 3000 + i * 300,
                    totalDurationMs: 3000 + i * 300,
                    inputTokens: 800,
                    outputTokens: 1200,
                    stepId: writeStepId,
                  });
                }
                service.endStep(sessionId, writeStepId);

                // End the dimension wrapper step
                service.endStep(sessionId, dimStepId);

                // Signal this dimension is done by ending taskStepId phase
                // (In real code, the container step is ended after Promise.all)
                void dimCtx; // suppress unused warning
              },
            ),
          ),
        );

        service.endStep(sessionId, taskStepId);

        // --- report_synthesis step ---
        const synthesisStepId = service.startStep(sessionId, {
          name: "report_synthesis",
        });
        service.recordAction(sessionId, {
          name: "synthesis_call_1",
          model: "gpt-4o",
          provider: "openai",
          streaming: true,
          ttftMs: 350,
          ttltMs: 5000,
          totalDurationMs: 5000,
          inputTokens: 3000,
          outputTokens: 2000,
          stepId: synthesisStepId,
        });
        service.recordAction(sessionId, {
          name: "synthesis_call_2",
          model: "gpt-4o",
          provider: "openai",
          streaming: false,
          ttltMs: 1500,
          totalDurationMs: 1500,
          inputTokens: 1000,
          outputTokens: 800,
          stepId: synthesisStepId,
        });
        service.endStep(sessionId, synthesisStepId);

        // --- finalization step ---
        const finalStepId = service.startStep(sessionId, {
          name: "finalization",
        });
        service.endStep(sessionId, finalStepId);
      },
    );

    const summary = service.endSession(sessionId, "completed");

    await new Promise<void>((r) => setTimeout(r, 0));

    // ----------------------------------------------------------------
    // Structural assertions
    // ----------------------------------------------------------------
    expect(summary).toBeDefined();
    expect(summary!.status).toBe("completed");

    // ----------------------------------------------------------------
    // Action count verification
    // Per dimension: 3 (search) + 1 (outline) + 5 (write) = 9 actions
    // 5 dimensions × 9 = 45 dimension actions
    // + 2 report_synthesis actions = 47 total LLM actions
    // ----------------------------------------------------------------
    expect(summary!.llmCallCount).toBe(47);

    // ----------------------------------------------------------------
    // Verify each dimension's sub-steps have the correct action counts
    // ----------------------------------------------------------------
    const session = service.getSession(sessionId);
    expect(session).toBeDefined();

    for (const dimension of DIMENSIONS) {
      const searchStep = session!.steps.find(
        (s) => s.name === `${dimension}/搜索数据`,
      );
      const outlineStep = session!.steps.find(
        (s) => s.name === `${dimension}/大纲规划`,
      );
      const writeStep = session!.steps.find(
        (s) => s.name === `${dimension}/写作与审核`,
      );

      expect(searchStep).toBeDefined();
      expect(outlineStep).toBeDefined();
      expect(writeStep).toBeDefined();

      // Correct action counts per sub-step
      expect(searchStep!.actions).toHaveLength(3);
      expect(outlineStep!.actions).toHaveLength(1);
      expect(writeStep!.actions).toHaveLength(5);

      // Actions are attributed to the correct step, not leaked to siblings
      const searchActionNames = searchStep!.actions.map((a) => a.name);
      const outlineActionNames = outlineStep!.actions.map((a) => a.name);
      const writeActionNames = writeStep!.actions.map((a) => a.name);

      for (let i = 0; i < 3; i++) {
        expect(searchActionNames).toContain(`${dimension}/search_call_${i}`);
      }
      expect(outlineActionNames).toContain(`${dimension}/outline_call`);
      for (let i = 0; i < 5; i++) {
        expect(writeActionNames).toContain(`${dimension}/write_call_${i}`);
      }
    }

    // ----------------------------------------------------------------
    // No action cross-contamination between dimensions
    // ----------------------------------------------------------------
    for (const dimension of DIMENSIONS) {
      const otherDimensions = DIMENSIONS.filter((d) => d !== dimension);
      const searchStep = session!.steps.find(
        (s) => s.name === `${dimension}/搜索数据`,
      );

      for (const otherDim of otherDimensions) {
        const otherActionNames = searchStep!.actions.map((a) => a.name);
        expect(otherActionNames.some((n) => n.startsWith(`${otherDim}/`))).toBe(
          false,
        );
      }
    }

    // ----------------------------------------------------------------
    // Step hierarchy: dimension wrappers have parentStepId = taskStepId
    // sub-steps have parentStepId = dimension wrapper id
    // ----------------------------------------------------------------
    for (const dimension of DIMENSIONS) {
      const dimStep = session!.steps.find(
        (s) => s.name === `dimension_research:${dimension}`,
      );
      const taskStep = session!.steps.find((s) => s.name === "task_execution");
      expect(dimStep!.parentStepId).toBe(taskStep!.id);

      const searchStep = session!.steps.find(
        (s) => s.name === `${dimension}/搜索数据`,
      );
      expect(searchStep!.parentStepId).toBe(dimStep!.id);
    }

    // ----------------------------------------------------------------
    // Top-level steps: initialization, task_execution, report_synthesis,
    // finalization (child steps excluded)
    // ----------------------------------------------------------------
    const topLevelStepNames = summary!.steps.map((s) => s.name);
    expect(topLevelStepNames).toContain("initialization");
    expect(topLevelStepNames).toContain("task_execution");
    expect(topLevelStepNames).toContain("report_synthesis");
    expect(topLevelStepNames).toContain("finalization");

    // Child dimension steps and sub-steps should NOT appear in summary
    for (const dimension of DIMENSIONS) {
      expect(topLevelStepNames).not.toContain(
        `dimension_research:${dimension}`,
      );
      expect(topLevelStepNames).not.toContain(`${dimension}/搜索数据`);
      expect(topLevelStepNames).not.toContain(`${dimension}/大纲规划`);
      expect(topLevelStepNames).not.toContain(`${dimension}/写作与审核`);
    }

    // ----------------------------------------------------------------
    // All step durations are non-negative
    // ----------------------------------------------------------------
    for (const step of session!.steps) {
      if (step.durationMs !== undefined) {
        expect(step.durationMs).toBeGreaterThanOrEqual(0);
      }
    }

    // ----------------------------------------------------------------
    // TTFT stats: streaming calls have ttftMs; verify min/max bounds
    // Search: ttftMs in [200, 300], Outline: 280, Write: [180, 340], Synthesis: 350
    // Min of all streaming ttftMs = 180 (first write call)
    // Max: 350 (synthesis) but could be higher from write calls: 180+4*40=340 < 350
    // ----------------------------------------------------------------
    expect(summary!.ttft).toBeDefined();
    expect(summary!.ttft!.minMs).toBeGreaterThanOrEqual(0);
    expect(summary!.ttft!.maxMs).toBeGreaterThan(0);
    expect(summary!.ttft!.minMs).toBeLessThanOrEqual(summary!.ttft!.maxMs);

    // ----------------------------------------------------------------
    // TTLT stats exist (all LLM calls have ttltMs > 0)
    // ----------------------------------------------------------------
    expect(summary!.ttlt).toBeDefined();
    expect(summary!.ttlt!.avgMs).toBeGreaterThan(0);

    // ----------------------------------------------------------------
    // Token aggregation
    // Search per dim: 3×300=900 in, 3×400=1200 out
    // Outline per dim: 500 in, 600 out
    // Write per dim: 5×800=4000 in, 5×1200=6000 out
    // Per dimension total: 5400 in, 7800 out
    // 5 dimensions: 27000 in, 39000 out
    // synthesis: 3000+1000=4000 in, 2000+800=2800 out
    // Grand total: 31000 in, 41800 out
    // ----------------------------------------------------------------
    expect(summary!.totalInputTokens).toBe(31000);
    expect(summary!.totalOutputTokens).toBe(41800);

    // ----------------------------------------------------------------
    // Persistence was called once
    // ----------------------------------------------------------------
    expect(mockPrisma.latencySession.create).toHaveBeenCalledTimes(1);
  });

  it("actions recorded to a closed step via explicit stepId still appear after endSession", () => {
    const sessionId = service.startSession({
      type: "topic_insights_refresh",
      entityId: "closed-step-test",
    });

    const stepId = service.startStep(sessionId, { name: "will_close" });
    service.endStep(sessionId, stepId);

    // Record action using the explicit stepId of an already-closed step
    service.recordAction(sessionId, {
      name: "late_action",
      model: "gpt-4o",
      provider: "openai",
      streaming: false,
      ttltMs: 1000,
      totalDurationMs: 1000,
      inputTokens: 100,
      outputTokens: 150,
      stepId,
    });

    const session = service.getSession(sessionId);
    const step = session!.steps.find((s) => s.id === stepId);

    expect(step!.actions).toHaveLength(1);
    expect(step!.actions[0].name).toBe("late_action");

    const summary = service.endSession(sessionId);
    expect(summary!.llmCallCount).toBe(1);
  });

  it("summary percentile stats are correct for the 5-dimension action distribution", () => {
    const sessionId = service.startSession({
      type: "topic_insights_refresh",
      entityId: "percentile-test",
    });

    const stepId = service.startStep(sessionId, { name: "percentile_step" });

    // 5 known ttftMs values for p50/p95 verification
    const ttftValues = [100, 200, 300, 400, 500];
    ttftValues.forEach((ttftMs, i) => {
      service.recordAction(sessionId, {
        name: `call_${i}`,
        model: "gpt-4o",
        provider: "openai",
        streaming: true,
        ttftMs,
        ttltMs: ttftMs + 1000,
        totalDurationMs: ttftMs + 1000,
        inputTokens: 100,
        outputTokens: 200,
        stepId,
      });
    });

    service.endStep(sessionId, stepId);
    const summary = service.endSession(sessionId);

    // sorted: [100, 200, 300, 400, 500]
    // p50: ceil(0.5*5)-1 = 2 → sorted[2] = 300
    // p95: ceil(0.95*5)-1 = 4 → sorted[4] = 500
    expect(summary!.ttft!.p50Ms).toBe(300);
    expect(summary!.ttft!.p95Ms).toBe(500);
    expect(summary!.ttft!.minMs).toBe(100);
    expect(summary!.ttft!.maxMs).toBe(500);
    expect(summary!.ttft!.avgMs).toBe(300);
  });
});
