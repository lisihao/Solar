/**
 * toMissionEventRecord unit tests (RB-Gap5)
 *
 * Verifies that the emit→persist boundary helper correctly serializes
 * representative AgentEventType variants into MissionEventRecord.
 */

import { toMissionEventRecord } from "../agent-event-to-record";
import type {
  IAgentEvent,
  IThinkingEvent,
  ITerminatedEvent,
  IErrorEvent,
  IIterationProgressEvent,
  IBudgetWarningEvent,
} from "../agent-event.interface";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeBase(overrides: Partial<IAgentEvent> = {}): IAgentEvent {
  return {
    type: "output",
    agentId: "agent-1",
    timestamp: 1_000_000,
    payload: { output: "hello" },
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("toMissionEventRecord", () => {
  it("maps missionId and agentId correctly", () => {
    const event = makeBase();
    const record = toMissionEventRecord(event, "mission-42");

    expect(record.missionId).toBe("mission-42");
    expect(record.agentId).toBe("agent-1");
  });

  it("maps type and timestamp (ts)", () => {
    const event = makeBase({ type: "output", timestamp: 9_999 });
    const record = toMissionEventRecord(event, "m1");

    expect(record.type).toBe("output");
    expect(record.ts).toBe(9_999);
  });

  it("uses supplied eventId when provided", () => {
    const event = makeBase();
    const record = toMissionEventRecord(event, "m1", "fixed-id");

    expect(record.eventId).toBe("fixed-id");
  });

  it("generates a UUID eventId when not provided", () => {
    const record = toMissionEventRecord(makeBase(), "m1");

    expect(typeof record.eventId).toBe("string");
    expect(record.eventId.length).toBeGreaterThan(0);
  });

  it("two calls without explicit eventId produce distinct IDs", () => {
    const event = makeBase();
    const r1 = toMissionEventRecord(event, "m1");
    const r2 = toMissionEventRecord(event, "m1");

    expect(r1.eventId).not.toBe(r2.eventId);
  });

  it("thinking event — payload preserved verbatim", () => {
    const event: IThinkingEvent = {
      type: "thinking",
      agentId: "agent-2",
      timestamp: 100,
      payload: { text: "reasoning...", tokenCount: 42 },
    };
    const record = toMissionEventRecord(event, "m2");

    expect(record.type).toBe("thinking");
    expect(record.payload).toEqual({ text: "reasoning...", tokenCount: 42 });
  });

  it("terminated event — reason preserved in payload", () => {
    const event: ITerminatedEvent = {
      type: "terminated",
      agentId: "agent-3",
      timestamp: 200,
      payload: { reason: "completed", note: "all done" },
    };
    const record = toMissionEventRecord(event, "m3");

    expect(record.type).toBe("terminated");
    expect(record.payload).toEqual({ reason: "completed", note: "all done" });
  });

  it("error event — full IHarnessErrorPayload preserved", () => {
    const event: IErrorEvent = {
      type: "error",
      agentId: "agent-4",
      timestamp: 300,
      payload: {
        message: "rate limit",
        recoverable: true,
        failureCode: "PROVIDER_RATE_LIMIT",
        diagnostic: { modelId: "claude-3" },
      },
    };
    const record = toMissionEventRecord(event, "m4");

    expect(record.type).toBe("error");
    const p = record.payload as IErrorEvent["payload"];
    expect(p.failureCode).toBe("PROVIDER_RATE_LIMIT");
    expect(p.recoverable).toBe(true);
  });

  it("iteration_progress event — progress fields preserved", () => {
    const event: IIterationProgressEvent = {
      type: "iteration_progress",
      agentId: "agent-5",
      timestamp: 400,
      payload: {
        iteration: 3,
        maxIterations: 15,
        progress: 0.2,
        approachingLimit: false,
        lastActionKind: "search",
      },
    };
    const record = toMissionEventRecord(event, "m5");

    expect(record.type).toBe("iteration_progress");
    const p = record.payload as IIterationProgressEvent["payload"];
    expect(p.iteration).toBe(3);
    expect(p.approachingLimit).toBe(false);
  });

  it("budget_warning event — severity preserved", () => {
    const event: IBudgetWarningEvent = {
      type: "budget_warning",
      agentId: "agent-6",
      timestamp: 500,
      payload: {
        severity: "soft",
        tokensUsed: 9_000,
        tokensLimit: 10_000,
        costUsd: 0.05,
      },
    };
    const record = toMissionEventRecord(event, "m6");

    expect(record.type).toBe("budget_warning");
    const p = record.payload as IBudgetWarningEvent["payload"];
    expect(p.severity).toBe("soft");
  });

  it("output event — string output preserved", () => {
    const event: IAgentEvent = {
      type: "output",
      agentId: "agent-7",
      timestamp: 600,
      payload: { output: "final answer" },
    };
    const record = toMissionEventRecord(event, "m7");

    expect(record.type).toBe("output");
    expect((record.payload as { output: string }).output).toBe("final answer");
  });

  it("does not mutate the original event", () => {
    const payload = { text: "think", tokenCount: 1 };
    const event: IThinkingEvent = {
      type: "thinking",
      agentId: "a",
      timestamp: 1,
      payload,
    };
    toMissionEventRecord(event, "m");

    expect(event.payload).toBe(payload);
  });

  it("returned record is a plain object (no class prototype)", () => {
    const record = toMissionEventRecord(makeBase(), "m1");

    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  });
});
