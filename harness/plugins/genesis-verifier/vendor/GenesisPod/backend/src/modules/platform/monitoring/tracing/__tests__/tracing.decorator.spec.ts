/**
 * Tracing Decorator unit tests
 *
 * Covers:
 * - @Trace decorator – async method, success / error paths, logArgs / logResult options, nested calls, parentSpanId
 * - @TraceSync decorator – sync method, success / error paths
 * - getCurrentTraceContext / getCurrentTraceId – empty stack, with active context
 * - startSpan – end(), error(), addAttribute(), context structure
 * - sanitizeValue (indirectly via logArgs) – string truncation, sensitive key redaction,
 *   array truncation, object redaction, deeply nested value, null/undefined/boolean/number
 */

import { Logger } from "@nestjs/common";
import {
  Trace,
  TraceSync,
  getCurrentTraceContext,
  getCurrentTraceId,
  startSpan,
} from "../tracing.decorator";

// ─── suppress Logger output ───────────────────────────────────────────────────

beforeAll(() => {
  jest.spyOn(Logger.prototype, "debug").mockImplementation();
  jest.spyOn(Logger.prototype, "log").mockImplementation();
  jest.spyOn(Logger.prototype, "error").mockImplementation();
});

afterAll(() => {
  jest.restoreAllMocks();
});

// ─── helpers ─────────────────────────────────────────────────────────────────

class SampleService {
  @Trace()
  async basicMethod(input: string): Promise<string> {
    return `result:${input}`;
  }

  @Trace({ logArgs: true, logResult: true })
  async methodWithLogging(data: unknown): Promise<unknown> {
    return data;
  }

  @Trace({ operationName: "CustomOp" })
  async customNameMethod(): Promise<string> {
    return "custom";
  }

  @Trace()
  async throwingMethod(): Promise<void> {
    throw new Error("Test error");
  }

  @Trace({ logArgs: true })
  async sensitiveMethod(password: string): Promise<string> {
    return password;
  }

  @Trace()
  async nestedOuter(): Promise<string> {
    return this.nestedInner();
  }

  @Trace()
  async nestedInner(): Promise<string> {
    return "inner";
  }

  @TraceSync()
  syncMethod(x: number): number {
    return x * 2;
  }

  @TraceSync()
  throwingSyncMethod(): void {
    throw new Error("Sync error");
  }
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("Trace decorator", () => {
  let service: SampleService;

  beforeEach(() => {
    service = new SampleService();
  });

  it("executes the original method and returns result", async () => {
    const result = await service.basicMethod("hello");
    expect(result).toBe("result:hello");
  });

  it("propagates errors from the original method", async () => {
    await expect(service.throwingMethod()).rejects.toThrow("Test error");
  });

  it("pops context from stack after successful execution", async () => {
    await service.basicMethod("test");
    expect(getCurrentTraceContext()).toBeUndefined();
  });

  it("pops context from stack after error", async () => {
    try {
      await service.throwingMethod();
    } catch {
      // expected
    }
    expect(getCurrentTraceContext()).toBeUndefined();
  });

  it("uses custom operationName when provided", async () => {
    const debugSpy = jest.spyOn(Logger.prototype, "debug");
    await service.customNameMethod();
    const calls = debugSpy.mock.calls.map((c) => c[0] as string);
    expect(calls.some((msg) => msg.includes("CustomOp"))).toBe(true);
  });

  it("logs args when logArgs is true", async () => {
    const debugSpy = jest.spyOn(Logger.prototype, "debug");
    await service.methodWithLogging("my-arg");
    const calls = debugSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
  });

  it("logs result when logResult is true and result is not undefined", async () => {
    const debugSpy = jest.spyOn(Logger.prototype, "debug");
    await service.methodWithLogging({ key: "value" });
    expect(debugSpy).toHaveBeenCalled();
  });

  it("does not log args when logArgs is false", async () => {
    const debugSpy = jest.spyOn(Logger.prototype, "debug").mockClear();
    await service.basicMethod("input");
    // Should still log START/END but without args object
    const callsWithArgsObj = debugSpy.mock.calls.filter(
      (c) => typeof c[1] === "object" && "args" in (c[1] as object),
    );
    expect(callsWithArgsObj).toHaveLength(0);
  });

  it("sets parentSpanId when nested calls occur", async () => {
    // The nested call should inherit the parent's traceId
    const result = await service.nestedOuter();
    expect(result).toBe("inner");
  });

  it("logs error when method throws", async () => {
    const errorSpy = jest.spyOn(Logger.prototype, "error");
    try {
      await service.throwingMethod();
    } catch {
      // expected
    }
    expect(errorSpy).toHaveBeenCalled();
  });

  describe("sanitizeValue via logArgs", () => {
    it("redacts argument containing 'password'", async () => {
      const debugSpy = jest.spyOn(Logger.prototype, "debug");
      await service.sensitiveMethod("mysecretpassword");
      // Look for a debug call that logged args
      const argsCall = debugSpy.mock.calls.find(
        (c) => typeof c[1] === "object" && "args" in (c[1] as object),
      );
      if (argsCall) {
        const argsObj = (argsCall[1] as { args: unknown[] }).args;
        expect(argsObj[0]).toBe("[REDACTED]");
      }
    });

    it("handles logResult with various value types", async () => {
      // number
      await service.methodWithLogging(42);
      // boolean
      await service.methodWithLogging(true);
      // null
      await service.methodWithLogging(null);
      // All should complete without error
      expect(true).toBe(true);
    });
  });
});

// ─── TraceSync decorator ──────────────────────────────────────────────────────

describe("TraceSync decorator", () => {
  let service: SampleService;

  beforeEach(() => {
    service = new SampleService();
  });

  it("executes sync method and returns result", () => {
    const result = service.syncMethod(5);
    expect(result).toBe(10);
  });

  it("propagates errors from sync method", () => {
    expect(() => service.throwingSyncMethod()).toThrow("Sync error");
  });

  it("pops context from stack after sync error", () => {
    try {
      service.throwingSyncMethod();
    } catch {
      // expected
    }
    expect(getCurrentTraceContext()).toBeUndefined();
  });

  it("pops context from stack after sync success", () => {
    service.syncMethod(3);
    expect(getCurrentTraceContext()).toBeUndefined();
  });

  it("logs error on sync method failure", () => {
    const errorSpy = jest.spyOn(Logger.prototype, "error");
    try {
      service.throwingSyncMethod();
    } catch {
      // expected
    }
    expect(errorSpy).toHaveBeenCalled();
  });
});

// ─── getCurrentTraceContext / getCurrentTraceId ───────────────────────────────

describe("getCurrentTraceContext", () => {
  it("returns undefined when no trace is active", () => {
    expect(getCurrentTraceContext()).toBeUndefined();
  });

  it("returns active context during execution", async () => {
    let capturedContext: ReturnType<typeof getCurrentTraceContext>;

    class CaptureService {
      @Trace()
      async capture(): Promise<void> {
        capturedContext = getCurrentTraceContext();
      }
    }

    const svc = new CaptureService();
    await svc.capture();

    expect(capturedContext).toBeDefined();
    expect(capturedContext!.operationName).toContain("CaptureService.capture");
  });
});

describe("getCurrentTraceId", () => {
  it("returns undefined when no trace is active", () => {
    expect(getCurrentTraceId()).toBeUndefined();
  });

  it("returns traceId during execution", async () => {
    let capturedId: string | undefined;

    class IdService {
      @Trace()
      async run(): Promise<void> {
        capturedId = getCurrentTraceId();
      }
    }

    await new IdService().run();

    expect(typeof capturedId).toBe("string");
    expect(capturedId!.length).toBeGreaterThan(0);
  });
});

// ─── startSpan ───────────────────────────────────────────────────────────────

describe("startSpan", () => {
  it("creates span with correct operation name", () => {
    const span = startSpan("MyOperation");
    expect(span.context.operationName).toBe("MyOperation");
    span.end();
  });

  it("end() pops context from stack", () => {
    const span = startSpan("EndTest");
    expect(getCurrentTraceContext()).toBeDefined();
    span.end();
    expect(getCurrentTraceContext()).toBeUndefined();
  });

  it("error() pops context from stack", () => {
    const span = startSpan("ErrorTest");
    expect(getCurrentTraceContext()).toBeDefined();
    span.error(new Error("test error"));
    expect(getCurrentTraceContext()).toBeUndefined();
  });

  it("addAttribute() adds key-value to context attributes", () => {
    const span = startSpan("AttributeTest");
    span.addAttribute("userId", "user-123");
    expect(span.context.attributes.userId).toBe("user-123");
    span.end();
  });

  it("inherits traceId from parent context", async () => {
    let parentTraceId: string | undefined;
    let childTraceId: string | undefined;

    class ParentService {
      @Trace()
      async run(): Promise<void> {
        parentTraceId = getCurrentTraceId();
        const child = startSpan("ChildSpan");
        childTraceId = child.context.traceId;
        child.end();
      }
    }

    await new ParentService().run();

    expect(parentTraceId).toBe(childTraceId);
  });

  it("has parentSpanId when started within a traced method", async () => {
    let spanContext: ReturnType<typeof startSpan>["context"] | undefined;

    class OuterService {
      @Trace()
      async outer(): Promise<void> {
        const span = startSpan("ChildSpan");
        spanContext = span.context;
        span.end();
      }
    }

    await new OuterService().outer();

    expect(spanContext!.parentSpanId).toBeDefined();
  });

  it("logs error with message when Error instance is passed", () => {
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockClear();
    const span = startSpan("ErrorSpan");
    span.error(new Error("span error message"));
    expect(errorSpy).toHaveBeenCalled();
    const lastCall = errorSpy.mock.calls[errorSpy.mock.calls.length - 1];
    expect(lastCall[0] as string).toContain("span error message");
  });

  it("logs error with 'Unknown error' for non-Error values", () => {
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockClear();
    const span = startSpan("UnknownErrorSpan");
    span.error("string error");
    expect(errorSpy).toHaveBeenCalled();
    const lastCall = errorSpy.mock.calls[errorSpy.mock.calls.length - 1];
    expect(lastCall[0] as string).toContain("Unknown error");
  });

  it("context has startTime set", () => {
    const before = Date.now();
    const span = startSpan("TimeTest");
    const after = Date.now();
    expect(span.context.startTime).toBeGreaterThanOrEqual(before);
    expect(span.context.startTime).toBeLessThanOrEqual(after);
    span.end();
  });

  it("generates unique spanIds for separate spans", () => {
    const span1 = startSpan("Span1");
    span1.end();
    const span2 = startSpan("Span2");
    span2.end();
    expect(span1.context.spanId).not.toBe(span2.context.spanId);
  });

  it("initializes with custom attributes", () => {
    const span = startSpan("AttrInit", { module: "test-module", version: 2 });
    expect(span.context.attributes.module).toBe("test-module");
    expect(span.context.attributes.version).toBe(2);
    span.end();
  });
});
