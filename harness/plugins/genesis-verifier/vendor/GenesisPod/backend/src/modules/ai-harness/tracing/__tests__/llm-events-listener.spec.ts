/**
 * LlmEventsListener — branch coverage spec
 *
 * Covers all @OnEvent handlers and their guard branches (optional services absent/present).
 */

import { LlmEventsListener } from "../observability/llm-events.listener";

function makeListener(
  overrides: {
    traceCollector?: unknown;
    eventJournal?: unknown;
    costAttribution?: unknown;
    kernelMetrics?: unknown;
    latencyTracker?: unknown;
  } = {},
) {
  return new LlmEventsListener(
    overrides.traceCollector as any,
    overrides.eventJournal as any,
    overrides.costAttribution as any,
    overrides.kernelMetrics as any,
    overrides.latencyTracker as any,
  );
}

describe("LlmEventsListener", () => {
  describe("onSpanStart()", () => {
    it("no-ops when traceCollector not wired", () => {
      const listener = makeListener();
      expect(() =>
        listener.onSpanStart({
          correlationId: "c1",
          traceId: "t1",
          name: "span-name",
        }),
      ).not.toThrow();
    });

    it("calls addSpan and stores spanId when traceCollector present (spanId returned)", () => {
      const addSpan = jest.fn().mockReturnValue("span-123");
      const traceCollector = { addSpan };
      const listener = makeListener({ traceCollector });

      listener.onSpanStart({
        correlationId: "c1",
        traceId: "t1",
        name: "span-name",
        type: "llm",
        metadata: { key: "val" },
      });

      expect(addSpan).toHaveBeenCalledWith("t1", {
        name: "span-name",
        type: "llm",
        metadata: { key: "val" },
      });
    });

    it("does not store spanId when addSpan returns null/undefined", () => {
      const addSpan = jest.fn().mockReturnValue(null);
      const traceCollector = { addSpan, endSpan: jest.fn() };
      const listener = makeListener({ traceCollector });

      listener.onSpanStart({ correlationId: "c2", traceId: "t2", name: "s" });
      // No spanId stored; onSpanEnd should not call endSpan
      listener.onSpanEnd({
        correlationId: "c2",
        status: "ok",
      });
      expect(traceCollector.endSpan).not.toHaveBeenCalled();
    });
  });

  describe("onSpanEnd()", () => {
    it("no-ops when traceCollector not wired", () => {
      const listener = makeListener();
      expect(() =>
        listener.onSpanEnd({ correlationId: "c1", status: "ok" }),
      ).not.toThrow();
    });

    it("no-ops when spanId not found for correlationId", () => {
      const endSpan = jest.fn();
      const traceCollector = {
        addSpan: jest.fn().mockReturnValue("span-1"),
        endSpan,
      };
      const listener = makeListener({ traceCollector });

      // Don't start a span for "c-unknown"
      listener.onSpanEnd({ correlationId: "c-unknown", status: "ok" });
      expect(endSpan).not.toHaveBeenCalled();
    });

    it("calls endSpan and clears spanId when traceCollector present", () => {
      const addSpan = jest.fn().mockReturnValue("span-abc");
      const endSpan = jest.fn();
      const traceCollector = { addSpan, endSpan };
      const listener = makeListener({ traceCollector });

      listener.onSpanStart({ correlationId: "c3", traceId: "t3", name: "s3" });
      listener.onSpanEnd({
        correlationId: "c3",
        status: "success",
        error: undefined,
        output: { result: 1 },
        metadata: { m: 1 },
      });

      expect(endSpan).toHaveBeenCalledWith("span-abc", {
        status: "success",
        error: undefined,
        output: { result: 1 },
        metadata: { m: 1 },
      });
    });
  });

  describe("onJournalRecord()", () => {
    it("no-ops when eventJournal not wired", () => {
      const listener = makeListener();
      expect(() =>
        listener.onJournalRecord({
          processId: "p1",
          eventType: "test",
          payload: {},
        }),
      ).not.toThrow();
    });

    it("calls eventJournal.record when wired", () => {
      const record = jest.fn().mockResolvedValue(undefined);
      const listener = makeListener({ eventJournal: { record } });

      listener.onJournalRecord({
        processId: "p1",
        eventType: "llm.call",
        payload: { model: "gpt-4" },
      });

      expect(record).toHaveBeenCalledWith("p1", "llm.call", { model: "gpt-4" });
    });

    it("handles eventJournal.record rejection gracefully", async () => {
      const record = jest.fn().mockRejectedValue(new Error("journal fail"));
      const listener = makeListener({ eventJournal: { record } });

      listener.onJournalRecord({
        processId: "p1",
        eventType: "t",
        payload: {},
      });
      await new Promise((r) => setTimeout(r, 10));
      expect(record).toHaveBeenCalled();
    });
  });

  describe("onAgentJournalRecord()", () => {
    it("no-ops when eventJournal not wired", () => {
      const listener = makeListener();
      expect(() =>
        listener.onAgentJournalRecord({
          processId: "a1",
          eventType: "agent.start",
          payload: {},
        }),
      ).not.toThrow();
    });

    it("calls eventJournal.record for agent events", () => {
      const record = jest.fn().mockResolvedValue(undefined);
      const listener = makeListener({ eventJournal: { record } });

      listener.onAgentJournalRecord({
        processId: "a1",
        eventType: "agent.output",
        payload: { text: "hello" },
      });

      expect(record).toHaveBeenCalledWith("a1", "agent.output", {
        text: "hello",
      });
    });
  });

  describe("onCostRecord()", () => {
    it("no-ops when costAttribution not wired", () => {
      const listener = makeListener();
      expect(() =>
        listener.onCostRecord({ model: "gpt-4", cost: 0.01 }),
      ).not.toThrow();
    });

    it("calls costAttribution.recordCost when wired", () => {
      const recordCost = jest.fn();
      const listener = makeListener({ costAttribution: { recordCost } });

      const event = { model: "gpt-4", cost: 0.05 };
      listener.onCostRecord(event);

      expect(recordCost).toHaveBeenCalledWith(event);
    });
  });

  describe("onMetricsRecord()", () => {
    it("no-ops when kernelMetrics not wired", () => {
      const listener = makeListener();
      expect(() =>
        listener.onMetricsRecord({ model: "gpt-4", latencyMs: 200 }),
      ).not.toThrow();
    });

    it("calls kernelMetrics.recordLLMCall when wired", () => {
      const recordLLMCall = jest.fn();
      const listener = makeListener({ kernelMetrics: { recordLLMCall } });

      const event = { model: "gpt-4", latencyMs: 200, tokens: 1000 };
      listener.onMetricsRecord(event);

      expect(recordLLMCall).toHaveBeenCalledWith(event);
    });
  });

  describe("onLatencyAction()", () => {
    it("no-ops when latencyTracker not wired", () => {
      const listener = makeListener();
      expect(() =>
        listener.onLatencyAction({ sessionId: "s1", action: "search" }),
      ).not.toThrow();
    });

    it("calls latencyTracker.recordAction when wired", () => {
      const recordAction = jest.fn();
      const listener = makeListener({ latencyTracker: { recordAction } });

      listener.onLatencyAction({
        sessionId: "s1",
        action: "search",
        duration: 100,
      });

      expect(recordAction).toHaveBeenCalledWith("s1", {
        action: "search",
        duration: 100,
      });
    });
  });
});
