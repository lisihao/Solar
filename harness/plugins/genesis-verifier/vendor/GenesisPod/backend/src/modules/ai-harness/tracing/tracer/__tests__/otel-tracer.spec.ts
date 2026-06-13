import { AgentTracer } from "../otel-tracer";

describe("AgentTracer", () => {
  describe("startSpan", () => {
    it("creates a span with name and default attributes", () => {
      const tracer = new AgentTracer();
      const span = tracer.startSpan("test-span");
      expect(span.name).toBe("test-span");
      expect(span.traceId).toBeTruthy();
      expect(span.spanId).toBeTruthy();
      expect(span.startedAt).toBeGreaterThan(0);
      expect(span.parentSpanId).toBeUndefined();
    });

    it("inherits traceId from parent span", () => {
      const tracer = new AgentTracer();
      const parent = tracer.startSpan("parent");
      const child = tracer.startSpan("child", { parent });
      expect(child.traceId).toBe(parent.traceId);
      expect(child.parentSpanId).toBe(parent.spanId);
    });

    it("accepts initial attributes", () => {
      const tracer = new AgentTracer();
      const span = tracer.startSpan("span", { attributes: { key: "value" } });
      expect(span.attributes.key).toBe("value");
    });

    it("setAttributes merges attributes", () => {
      const tracer = new AgentTracer();
      const span = tracer.startSpan("span", { attributes: { a: 1 } });
      span.setAttributes({ b: 2 });
      expect(span.attributes.a).toBe(1);
      expect(span.attributes.b).toBe(2);
    });

    it("recordException stores error info", () => {
      const tracer = new AgentTracer();
      const span = tracer.startSpan("span");
      span.recordException(new Error("something failed"));
      // No throw — just records exception
    });

    it("end() is idempotent", () => {
      const exporter = { emit: jest.fn() };
      const tracer = new AgentTracer(exporter as never);
      const span = tracer.startSpan("span");
      span.end({ outcome: "ok" });
      span.end({ outcome: "second call" }); // should not re-emit
      expect(exporter.emit).toHaveBeenCalledTimes(1);
    });

    it("emits to exporter on end", () => {
      const exporter = { emit: jest.fn() };
      const tracer = new AgentTracer(exporter as never);
      const span = tracer.startSpan("mission.task");
      span.end({ outcome: "completed" });
      expect(exporter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "mission.task",
          traceId: span.traceId,
        }),
      );
    });

    it("works without exporter (no throw)", () => {
      const tracer = new AgentTracer();
      const span = tracer.startSpan("no-exporter-span");
      expect(() => span.end()).not.toThrow();
    });
  });
});
