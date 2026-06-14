/**
 * StreamingService 单元测试
 *
 * 测试统一流式响应服务：
 * - createEvent() SSE 事件创建
 * - createProgressEvent() 进度事件
 * - createCompleteEvent() 完成事件
 * - createErrorEvent() 错误事件
 * - createHeartbeatEvent() 心跳事件
 * - emitProgress/emitComplete/emitError Subject 事件发射
 * - fromAsyncGenerator() 异步生成器转 SSE
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { Subject } from "rxjs";
import { StreamingService } from "../streaming.service";

describe("StreamingService", () => {
  let service: StreamingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StreamingService],
    }).compile();

    service = module.get<StreamingService>(StreamingService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // createEvent
  // =========================================================================

  describe("createEvent", () => {
    it("should create a NestSSE event with type and JSON data", () => {
      const event = service.createEvent("test", { message: "hello" });

      expect(event.type).toBe("test");
      expect(typeof event.data).toBe("string");

      const parsed = JSON.parse(event.data);
      expect(parsed.type).toBe("test");
      expect(parsed.data.message).toBe("hello");
      expect(parsed.timestamp).toBeDefined();
    });

    it("should include ISO timestamp", () => {
      const event = service.createEvent("test", {});

      const parsed = JSON.parse(event.data);
      expect(() => new Date(parsed.timestamp)).not.toThrow();
    });
  });

  // =========================================================================
  // createProgressEvent
  // =========================================================================

  describe("createProgressEvent", () => {
    it("should create progress event with all fields", () => {
      const event = service.createProgressEvent(
        "searching",
        0.5,
        "Searching 3 of 6 sources",
        3,
        6,
      );

      expect(event.type).toBe("progress");

      const parsed = JSON.parse(event.data);
      expect(parsed.data.phase).toBe("searching");
      expect(parsed.data.progress).toBe(0.5);
      expect(parsed.data.message).toBe("Searching 3 of 6 sources");
      expect(parsed.data.current).toBe(3);
      expect(parsed.data.total).toBe(6);
    });

    it("should work without optional current/total", () => {
      const event = service.createProgressEvent(
        "analyzing",
        0.8,
        "Almost done",
      );

      const parsed = JSON.parse(event.data);
      expect(parsed.data.current).toBeUndefined();
      expect(parsed.data.total).toBeUndefined();
    });
  });

  // =========================================================================
  // createCompleteEvent
  // =========================================================================

  describe("createCompleteEvent", () => {
    it("should create complete event with result", () => {
      const event = service.createCompleteEvent(
        { reportId: "r-123", wordCount: 5000 },
        12345,
      );

      expect(event.type).toBe("complete");

      const parsed = JSON.parse(event.data);
      expect(parsed.data.result.reportId).toBe("r-123");
      expect(parsed.data.totalTime).toBe(12345);
    });
  });

  // =========================================================================
  // createErrorEvent
  // =========================================================================

  describe("createErrorEvent", () => {
    it("should create error event", () => {
      const event = service.createErrorEvent(
        "Research failed",
        "TIMEOUT",
        true,
      );

      expect(event.type).toBe("error");

      const parsed = JSON.parse(event.data);
      expect(parsed.data.error).toBe("Research failed");
      expect(parsed.data.code).toBe("TIMEOUT");
      expect(parsed.data.recoverable).toBe(true);
    });

    it("should work with minimal params", () => {
      const event = service.createErrorEvent("Something went wrong");

      const parsed = JSON.parse(event.data);
      expect(parsed.data.error).toBe("Something went wrong");
      expect(parsed.data.code).toBeUndefined();
    });
  });

  // =========================================================================
  // createHeartbeatEvent
  // =========================================================================

  describe("createHeartbeatEvent", () => {
    it("should create heartbeat event with timestamp", () => {
      const event = service.createHeartbeatEvent();

      expect(event.type).toBe("heartbeat");

      const parsed = JSON.parse(event.data);
      expect(parsed.data.type).toBe("heartbeat");
      expect(parsed.data.timestamp).toBeDefined();
    });
  });

  // =========================================================================
  // createSSESubject
  // =========================================================================

  describe("createSSESubject", () => {
    it("should create a Subject instance", () => {
      const subject = service.createSSESubject();

      expect(subject).toBeInstanceOf(Subject);
    });
  });

  // =========================================================================
  // emitProgress / emitComplete / emitError
  // =========================================================================

  describe("emit methods", () => {
    it("emitProgress should emit to subject", (done) => {
      const subject = service.createSSESubject<any>();

      subject.subscribe({
        next: (event) => {
          expect(event.type).toBe("progress");
          expect(event.data.phase).toBe("planning");
          expect(event.data.progress).toBe(0.1);
          done();
        },
      });

      service.emitProgress(subject, "planning", 0.1, "Starting...");
    });

    it("emitComplete should emit and complete subject", (done) => {
      const subject = service.createSSESubject<any>();

      subject.subscribe({
        next: (event) => {
          expect(event.type).toBe("complete");
        },
        complete: () => {
          done();
        },
      });

      service.emitComplete(subject, { result: "done" });
    });

    it("emitError should emit error event and complete subject", (done) => {
      const subject = service.createSSESubject<any>();

      subject.subscribe({
        next: (event) => {
          expect(event.type).toBe("error");
          expect(event.data.error).toBe("Failed");
        },
        complete: () => {
          done();
        },
      });

      service.emitError(subject, "Failed", "ERR_001");
    });
  });

  // =========================================================================
  // fromAsyncGenerator
  // =========================================================================

  describe("fromAsyncGenerator", () => {
    async function* simpleGenerator() {
      yield "chunk1";
      yield "chunk2";
      yield "chunk3";
    }

    it("should convert async generator to SSE observable", (done) => {
      const events: any[] = [];

      const observable = service.fromAsyncGenerator(simpleGenerator());

      observable.subscribe({
        next: (event) => {
          events.push(event);
        },
        complete: () => {
          // Should have 3 chunks + 1 complete event
          expect(events.length).toBe(4);
          expect(events[0].type).toBe("chunk");
          expect(events[3].type).toBe("complete");
          done();
        },
      });
    });

    it("should handle generator errors", (done) => {
      async function* errorGenerator() {
        yield "chunk1";
        throw new Error("Generator failed");
      }

      const events: any[] = [];

      const observable = service.fromAsyncGenerator(errorGenerator());

      observable.subscribe({
        next: (event) => {
          events.push(event);
        },
        complete: () => {
          const lastEvent = events[events.length - 1];
          expect(lastEvent.type).toBe("error");
          done();
        },
      });
    });

    it("should handle empty generator", (done) => {
      async function* emptyGenerator() {
        // yields nothing
      }

      const events: any[] = [];

      const observable = service.fromAsyncGenerator(emptyGenerator());

      observable.subscribe({
        next: (event) => {
          events.push(event);
        },
        complete: () => {
          // Should have only the complete event
          expect(events.length).toBe(1);
          expect(events[0].type).toBe("complete");
          done();
        },
      });
    });
  });
});
