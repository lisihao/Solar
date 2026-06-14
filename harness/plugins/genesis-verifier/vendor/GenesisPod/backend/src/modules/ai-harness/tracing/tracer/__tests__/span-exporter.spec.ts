/**
 * SpanExporter + AgentTracer 集成测试 (PR-G)
 *
 * 验证：
 *   - AgentTracer.startSpan(...).end() 触发 SpanExporter.emit
 *   - exception 被记录到 SpanRecord.exception
 *   - 自定义 sink 收到正确字段（trace/span/parent/duration/attributes）
 *   - sink 抛错不会破坏其它 sink
 */

import { AgentTracer } from "../otel-tracer";
import { SpanExporter, type SpanRecord } from "../span-exporter";

describe("SpanExporter + AgentTracer (PR-G)", () => {
  it("emits a SpanRecord on span.end with attributes merged", () => {
    const records: SpanRecord[] = [];
    const exporter = new SpanExporter();
    exporter.removeSink("logger"); // silence default
    exporter.addSink({
      id: "test",
      emit: (r) => {
        records.push(r);
      },
    });
    const tracer = new AgentTracer(exporter);

    const span = tracer.startSpan("react.iter", {
      attributes: { agentId: "a1", loopKind: "react" },
    });
    span.setAttributes({ modelId: "claude-opus-4-7" });
    span.end({ tokens: 1234, costUsd: 0.05 });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      name: "react.iter",
      attributes: expect.objectContaining({
        agentId: "a1",
        loopKind: "react",
        modelId: "claude-opus-4-7",
        tokens: 1234,
        costUsd: 0.05,
      }),
    });
    expect(records[0].traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(records[0].spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(records[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("propagates parent span correctly", () => {
    const records: SpanRecord[] = [];
    const exporter = new SpanExporter();
    exporter.removeSink("logger");
    exporter.addSink({ id: "t", emit: (r) => records.push(r) });
    const tracer = new AgentTracer(exporter);

    const root = tracer.startSpan("mission");
    const child = tracer.startSpan("task", { parent: root });
    child.end();
    root.end();

    expect(records).toHaveLength(2);
    const childRec = records.find((r) => r.name === "task")!;
    const rootRec = records.find((r) => r.name === "mission")!;
    expect(childRec.traceId).toBe(rootRec.traceId);
    expect(childRec.parentSpanId).toBe(rootRec.spanId);
  });

  it("captures recordException into SpanRecord.exception", () => {
    const records: SpanRecord[] = [];
    const exporter = new SpanExporter();
    exporter.removeSink("logger");
    exporter.addSink({ id: "t", emit: (r) => records.push(r) });
    const tracer = new AgentTracer(exporter);

    const span = tracer.startSpan("tool.call");
    span.recordException(new Error("rate limited"));
    span.end();

    expect(records[0].exception).toMatchObject({
      name: "Error",
      message: "rate limited",
    });
  });

  it("a throwing sink does not block other sinks", () => {
    const good: SpanRecord[] = [];
    const exporter = new SpanExporter();
    exporter.removeSink("logger");
    exporter.addSink({
      id: "boom",
      emit: () => {
        throw new Error("kaboom");
      },
    });
    exporter.addSink({ id: "good", emit: (r) => good.push(r) });
    const tracer = new AgentTracer(exporter);

    expect(() => tracer.startSpan("x").end()).not.toThrow();
    expect(good).toHaveLength(1);
  });

  it("end() is idempotent (calling twice does not double-emit)", () => {
    const records: SpanRecord[] = [];
    const exporter = new SpanExporter();
    exporter.removeSink("logger");
    exporter.addSink({ id: "t", emit: (r) => records.push(r) });
    const tracer = new AgentTracer(exporter);

    const span = tracer.startSpan("x");
    span.end({ a: 1 });
    span.end({ a: 2 });
    expect(records).toHaveLength(1);
  });

  it("falls back to no-op when no exporter is wired (back-compat)", () => {
    const tracer = new AgentTracer();
    expect(() => tracer.startSpan("x").end()).not.toThrow();
  });
});
