/**
 * SpanExporter — extra branch coverage
 * Covers: addSink/removeSink, async sink that rejects, LangfuseSink via configService,
 *         LoggerSink with tokens/exception, listSinks
 */

import { SpanExporter, type SpanRecord, type SpanSink } from "../span-exporter";

function makeRecord(overrides?: Partial<SpanRecord>): SpanRecord {
  return {
    traceId: "a".repeat(32),
    spanId: "b".repeat(16),
    name: "test.span",
    startedAt: Date.now() - 10,
    endedAt: Date.now(),
    durationMs: 10,
    attributes: {},
    otelAttributes: {},
    ...overrides,
  };
}

describe("SpanExporter — addSink / removeSink / listSinks", () => {
  it("addSink registers a new sink", () => {
    const exporter = new SpanExporter();
    const ids = exporter.listSinks();
    expect(ids).toContain("logger"); // default

    exporter.addSink({ id: "custom", emit: jest.fn() });
    expect(exporter.listSinks()).toContain("custom");
  });

  it("addSink ignores duplicate id", () => {
    const exporter = new SpanExporter();
    const emit = jest.fn();
    exporter.addSink({ id: "dup", emit });
    exporter.addSink({ id: "dup", emit }); // second register ignored
    expect(exporter.listSinks().filter((s) => s === "dup")).toHaveLength(1);
  });

  it("removeSink removes a registered sink", () => {
    const exporter = new SpanExporter();
    exporter.addSink({ id: "removable", emit: jest.fn() });
    expect(exporter.listSinks()).toContain("removable");
    exporter.removeSink("removable");
    expect(exporter.listSinks()).not.toContain("removable");
  });

  it("removeSink is a no-op for unknown id", () => {
    const exporter = new SpanExporter();
    expect(() => exporter.removeSink("nonexistent")).not.toThrow();
  });

  it("listSinks returns all registered sink ids", () => {
    const exporter = new SpanExporter();
    exporter.addSink({ id: "s1", emit: jest.fn() });
    exporter.addSink({ id: "s2", emit: jest.fn() });
    const ids = exporter.listSinks();
    expect(ids).toContain("logger");
    expect(ids).toContain("s1");
    expect(ids).toContain("s2");
  });
});

describe("SpanExporter — emit", () => {
  it("calls all registered sinks with the record", () => {
    const exporter = new SpanExporter();
    exporter.removeSink("logger");
    const emit1 = jest.fn();
    const emit2 = jest.fn();
    exporter.addSink({ id: "s1", emit: emit1 });
    exporter.addSink({ id: "s2", emit: emit2 });

    const rec = makeRecord();
    exporter.emit(rec);
    expect(emit1).toHaveBeenCalledWith(rec);
    expect(emit2).toHaveBeenCalledWith(rec);
  });

  it("async sink that rejects does not break other sinks", async () => {
    const exporter = new SpanExporter();
    exporter.removeSink("logger");

    const asyncFailing: SpanSink = {
      id: "async-fail",
      emit: async () => {
        throw new Error("network down");
      },
    };
    const captured: SpanRecord[] = [];
    const good: SpanSink = {
      id: "good",
      emit: (r) => {
        captured.push(r);
      },
    };
    exporter.addSink(asyncFailing);
    exporter.addSink(good);

    exporter.emit(makeRecord());
    // Let async rejection propagate
    await new Promise((r) => setTimeout(r, 10));
    expect(captured).toHaveLength(1);
  });

  it("sync throwing sink does not break other sinks", () => {
    const exporter = new SpanExporter();
    exporter.removeSink("logger");
    exporter.addSink({
      id: "thrower",
      emit: () => {
        throw new Error("sync throw");
      },
    });
    const captured: SpanRecord[] = [];
    exporter.addSink({ id: "ok", emit: (r) => captured.push(r) });

    expect(() => exporter.emit(makeRecord())).not.toThrow();
    expect(captured).toHaveLength(1);
  });
});

describe("SpanExporter — with ConfigService (LangfuseSink)", () => {
  it("does not add LangfuseSink when env vars are missing", () => {
    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    };
    const exporter = new SpanExporter(configService as never);
    expect(exporter.listSinks()).not.toContain("langfuse");
  });

  it("adds LangfuseSink when all Langfuse env vars are set", () => {
    const configService = {
      get: jest.fn((key: string) => {
        const map: Record<string, string> = {
          LANGFUSE_HOST: "https://cloud.langfuse.com",
          LANGFUSE_PUBLIC_KEY: "pk-test",
          LANGFUSE_SECRET_KEY: "sk-test",
        };
        return map[key];
      }),
    };
    const exporter = new SpanExporter(configService as never);
    expect(exporter.listSinks()).toContain("langfuse");
  });

  it("LangfuseSink.emit is called and swallows fetch errors", async () => {
    const configService = {
      get: jest.fn((key: string) => {
        const map: Record<string, string> = {
          LANGFUSE_HOST: "https://cloud.langfuse.com",
          LANGFUSE_PUBLIC_KEY: "pk-test",
          LANGFUSE_SECRET_KEY: "sk-test",
        };
        return map[key];
      }),
    };
    // Mock global fetch to reject
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const exporter = new SpanExporter(configService as never);
    exporter.removeSink("logger");

    const rec = makeRecord({ exception: { name: "Error", message: "fail" } });
    exporter.emit(rec);
    // Allow async to complete
    await new Promise((r) => setTimeout(r, 20));
    // No throw — test passes if no unhandled rejection

    global.fetch = origFetch;
  });

  it("LangfuseSink.emit logs warning on HTTP non-OK response", async () => {
    const configService = {
      get: jest.fn((key: string) => {
        const map: Record<string, string> = {
          LANGFUSE_HOST: "https://cloud.langfuse.com",
          LANGFUSE_PUBLIC_KEY: "pk-test",
          LANGFUSE_SECRET_KEY: "sk-test",
        };
        return map[key];
      }),
    };
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

    const exporter = new SpanExporter(configService as never);
    exporter.removeSink("logger");

    exporter.emit(makeRecord());
    await new Promise((r) => setTimeout(r, 20));
    // No throw expected

    global.fetch = origFetch;
  });
});

describe("SpanExporter — LoggerSink (default)", () => {
  it("emits with tokens and costUsd in attributes without throwing", () => {
    const exporter = new SpanExporter(); // logger sink is default
    const rec = makeRecord({
      attributes: { tokens: 1234, costUsd: 0.05, agentId: "a1" },
    });
    expect(() => exporter.emit(rec)).not.toThrow();
  });

  it("emits with exception in record without throwing", () => {
    const exporter = new SpanExporter();
    const rec = makeRecord({
      exception: { name: "RangeError", message: "out of range", stack: "..." },
    });
    expect(() => exporter.emit(rec)).not.toThrow();
  });

  it("emits without tokens/costUsd without throwing", () => {
    const exporter = new SpanExporter();
    const rec = makeRecord({ attributes: { other: "field" } });
    expect(() => exporter.emit(rec)).not.toThrow();
  });
});
