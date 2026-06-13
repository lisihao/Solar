/**
 * StructuredLogger Unit Tests
 *
 * Tests for StructuredLogger class, createLogger factory,
 * logRequest, logOperation, and logPerformance helpers.
 */

import {
  StructuredLogger,
  createLogger,
  logRequest,
  logOperation,
  logPerformance,
  LogLevelEnum,
  LogEntry,
} from "../structured-logger";
import { RequestContext } from "../../context/request-context";

// ========== Helpers ==========

function parseLastCall(mockFn: jest.Mock): LogEntry {
  const lastCallArg = mockFn.mock.calls[mockFn.mock.calls.length - 1][0];
  return JSON.parse(lastCallArg) as LogEntry;
}

describe("StructuredLogger", () => {
  let consolLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleDebugSpy: jest.SpyInstance;
  let getLogContextSpy: jest.SpyInstance;

  beforeEach(() => {
    consolLogSpy = jest.spyOn(console, "log").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
    consoleDebugSpy = jest.spyOn(console, "debug").mockImplementation();

    // Default: no request context
    getLogContextSpy = jest
      .spyOn(RequestContext, "getLogContext")
      .mockReturnValue({});

    // Default: non-production
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ========== Constructor & setContext ==========

  describe("constructor", () => {
    it("should create a logger without context", () => {
      const logger = new StructuredLogger();
      logger.log("test message");

      const entry = parseLastCall(consolLogSpy);
      expect(entry.context).toBeUndefined();
    });

    it("should create a logger with a context string", () => {
      const logger = new StructuredLogger("MyService");
      logger.log("test");

      const entry = parseLastCall(consolLogSpy);
      expect(entry.context).toBe("MyService");
    });

    it("should detect production mode when NODE_ENV is production", () => {
      process.env.NODE_ENV = "production";
      const logger = new StructuredLogger("Prod");

      // In production, debug should NOT output
      logger.debug("debug message");
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it("should output debug in non-production mode", () => {
      process.env.NODE_ENV = "development";
      const logger = new StructuredLogger("Dev");

      logger.debug("debug message");
      expect(consoleDebugSpy).toHaveBeenCalled();
    });
  });

  describe("setContext", () => {
    it("should update the context", () => {
      const logger = new StructuredLogger("OldContext");
      logger.setContext("NewContext");
      logger.log("message");

      const entry = parseLastCall(consolLogSpy);
      expect(entry.context).toBe("NewContext");
    });
  });

  // ========== log ==========

  describe("log", () => {
    it("should output a JSON log entry via console.log", () => {
      const logger = new StructuredLogger("TestService");
      logger.log("Hello world");

      expect(consolLogSpy).toHaveBeenCalledTimes(1);
      const entry = parseLastCall(consolLogSpy);
      expect(entry.level).toBe(LogLevelEnum.INFO);
      expect(entry.message).toBe("Hello world");
    });

    it("should include a timestamp in ISO format", () => {
      const logger = new StructuredLogger();
      logger.log("msg");

      const entry = parseLastCall(consolLogSpy);
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("should include context when set", () => {
      const logger = new StructuredLogger("Service");
      logger.log("msg");

      const entry = parseLastCall(consolLogSpy);
      expect(entry.context).toBe("Service");
    });

    it("should include metadata rest fields", () => {
      const logger = new StructuredLogger();
      logger.log("msg", { action: "create", resourceId: "123" });

      const entry = parseLastCall(consolLogSpy);
      expect(entry.metadata).toEqual({ action: "create", resourceId: "123" });
    });

    it("should extract requestId from metadata and set on top-level entry", () => {
      const logger = new StructuredLogger();
      logger.log("msg", { requestId: "req-abc" });

      const entry = parseLastCall(consolLogSpy);
      expect(entry.requestId).toBe("req-abc");
      // requestId should not appear in metadata
      expect(entry.metadata?.requestId).toBeUndefined();
    });

    it("should extract userId from metadata", () => {
      const logger = new StructuredLogger();
      logger.log("msg", { userId: "user-xyz" });

      const entry = parseLastCall(consolLogSpy);
      expect(entry.userId).toBe("user-xyz");
    });

    it("should extract duration from metadata", () => {
      const logger = new StructuredLogger();
      logger.log("msg", { duration: 150 });

      const entry = parseLastCall(consolLogSpy);
      expect(entry.duration).toBe(150);
    });

    it("should not set duration if value is not a number", () => {
      const logger = new StructuredLogger();
      logger.log("msg", { duration: "fast" as unknown as number });

      const entry = parseLastCall(consolLogSpy);
      expect(entry.duration).toBeUndefined();
    });

    it("should incorporate requestId from RequestContext when available", () => {
      getLogContextSpy.mockReturnValue({
        requestId: "ctx-req-id",
        traceId: "ctx-trace-id",
        userId: "ctx-user-id",
      });

      const logger = new StructuredLogger();
      logger.log("msg");

      const entry = parseLastCall(consolLogSpy);
      expect(entry.requestId).toBe("ctx-req-id");
      expect(entry.traceId).toBe("ctx-trace-id");
      expect(entry.userId).toBe("ctx-user-id");
    });

    it("should let metadata requestId override RequestContext requestId", () => {
      getLogContextSpy.mockReturnValue({ requestId: "ctx-req" });

      const logger = new StructuredLogger();
      logger.log("msg", { requestId: "override-req" });

      const entry = parseLastCall(consolLogSpy);
      expect(entry.requestId).toBe("override-req");
    });

    it("should not include metadata property when metadata object is empty after extraction", () => {
      const logger = new StructuredLogger();
      logger.log("msg", { requestId: "r", userId: "u", duration: 10 });

      const entry = parseLastCall(consolLogSpy);
      expect(entry.metadata).toBeUndefined();
    });
  });

  // ========== debug ==========

  describe("debug", () => {
    it("should output via console.debug in non-production", () => {
      process.env.NODE_ENV = "development";
      const logger = new StructuredLogger();
      logger.debug("debug msg");

      expect(consoleDebugSpy).toHaveBeenCalled();
      const entry = parseLastCall(consoleDebugSpy);
      expect(entry.level).toBe(LogLevelEnum.DEBUG);
    });

    it("should NOT output in production mode", () => {
      process.env.NODE_ENV = "production";
      const logger = new StructuredLogger();
      logger.debug("debug msg");

      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it("should include metadata", () => {
      process.env.NODE_ENV = "development";
      const logger = new StructuredLogger();
      logger.debug("debug", { extra: "data" });

      const entry = parseLastCall(consoleDebugSpy);
      expect(entry.metadata).toEqual({ extra: "data" });
    });
  });

  // ========== warn ==========

  describe("warn", () => {
    it("should output via console.warn", () => {
      const logger = new StructuredLogger();
      logger.warn("warning message");

      expect(consoleWarnSpy).toHaveBeenCalled();
      const entry = parseLastCall(consoleWarnSpy);
      expect(entry.level).toBe(LogLevelEnum.WARN);
      expect(entry.message).toBe("warning message");
    });

    it("should include metadata", () => {
      const logger = new StructuredLogger();
      logger.warn("warn", { code: "RATE_LIMIT" });

      const entry = parseLastCall(consoleWarnSpy);
      expect(entry.metadata).toEqual({ code: "RATE_LIMIT" });
    });
  });

  // ========== error ==========

  describe("error", () => {
    it("should output via console.error", () => {
      const logger = new StructuredLogger();
      logger.error("error message");

      expect(consoleErrorSpy).toHaveBeenCalled();
      const entry = parseLastCall(consoleErrorSpy);
      expect(entry.level).toBe(LogLevelEnum.ERROR);
      expect(entry.message).toBe("error message");
    });

    it("should include error name and message when Error is provided", () => {
      process.env.NODE_ENV = "development";
      const logger = new StructuredLogger();
      const err = new Error("Something broke");
      err.name = "TypeError";

      logger.error("Failure", err);

      const entry = parseLastCall(consoleErrorSpy);
      expect(entry.error?.name).toBe("TypeError");
      expect(entry.error?.message).toBe("Something broke");
    });

    it("should include stack trace in non-production mode", () => {
      process.env.NODE_ENV = "development";
      const logger = new StructuredLogger();
      const err = new Error("Boom");

      logger.error("Crash", err);

      const entry = parseLastCall(consoleErrorSpy);
      expect(entry.error?.stack).toBeDefined();
    });

    it("should omit stack trace in production mode", () => {
      process.env.NODE_ENV = "production";
      const logger = new StructuredLogger();
      const err = new Error("Boom");

      logger.error("Crash", err);

      const entry = parseLastCall(consoleErrorSpy);
      expect(entry.error?.stack).toBeUndefined();
    });

    it("should handle non-Error error argument gracefully", () => {
      const logger = new StructuredLogger();
      // Passing a string as error — should not include error field
      logger.error("Crash", "string error");

      const entry = parseLastCall(consoleErrorSpy);
      expect(entry.error).toBeUndefined();
    });

    it("should include extra metadata alongside error", () => {
      const logger = new StructuredLogger();
      const err = new Error("failure");

      logger.error("Failed", err, { operation: "createUser" });

      const entry = parseLastCall(consoleErrorSpy);
      expect(entry.metadata).toEqual({ operation: "createUser" });
      expect(entry.error?.message).toBe("failure");
    });
  });

  // ========== verbose / fatal ==========

  describe("verbose", () => {
    it("should call debug internally", () => {
      process.env.NODE_ENV = "development";
      const logger = new StructuredLogger();
      logger.verbose("verbose message");

      expect(consoleDebugSpy).toHaveBeenCalled();
    });

    it("should include context when provided", () => {
      process.env.NODE_ENV = "development";
      const logger = new StructuredLogger("MyService");
      logger.verbose("msg", "ExtraContext");

      const entry = parseLastCall(consoleDebugSpy);
      expect(entry.metadata).toEqual({ context: "ExtraContext" });
    });
  });

  describe("fatal", () => {
    it("should call error internally", () => {
      const logger = new StructuredLogger();
      logger.fatal("fatal error");

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("should include context when provided", () => {
      const logger = new StructuredLogger();
      logger.fatal("fatal msg", "CrashContext");

      const entry = parseLastCall(consoleErrorSpy);
      expect(entry.metadata).toEqual({ context: "CrashContext" });
    });
  });

  // ========== createLogger ==========

  describe("createLogger", () => {
    it("should return a StructuredLogger instance", () => {
      const logger = createLogger("TestModule");
      expect(logger).toBeInstanceOf(StructuredLogger);
    });

    it("should set the context on the created logger", () => {
      const logger = createLogger("MyModule");
      logger.log("hello");

      const entry = parseLastCall(consolLogSpy);
      expect(entry.context).toBe("MyModule");
    });
  });

  // ========== logRequest ==========

  describe("logRequest", () => {
    it("should log at INFO level for 2xx status", () => {
      const logger = new StructuredLogger("HTTP");
      logRequest(logger, "GET", "/api/users", 200, 45);

      expect(consolLogSpy).toHaveBeenCalled();
      const entry = parseLastCall(consolLogSpy);
      expect(entry.level).toBe(LogLevelEnum.INFO);
      expect(entry.message).toBe("GET /api/users 200");
      expect(entry.metadata?.statusCode).toBe(200);
      expect(entry.metadata?.duration).toBeUndefined(); // duration is extracted to top-level
      expect(entry.duration).toBe(45);
    });

    it("should log at INFO level for 3xx status", () => {
      const logger = new StructuredLogger("HTTP");
      logRequest(logger, "GET", "/redirect", 302, 10);

      expect(consolLogSpy).toHaveBeenCalled();
    });

    it("should log at WARN level for 4xx status", () => {
      const logger = new StructuredLogger("HTTP");
      logRequest(logger, "POST", "/api/login", 401, 20);

      expect(consoleWarnSpy).toHaveBeenCalled();
      const entry = parseLastCall(consoleWarnSpy);
      expect(entry.level).toBe(LogLevelEnum.WARN);
      expect(entry.message).toBe("POST /api/login 401");
    });

    it("should log at ERROR level for 5xx status", () => {
      const logger = new StructuredLogger("HTTP");
      logRequest(logger, "GET", "/api/data", 500, 300);

      expect(consoleErrorSpy).toHaveBeenCalled();
      const entry = parseLastCall(consoleErrorSpy);
      expect(entry.level).toBe(LogLevelEnum.ERROR);
      expect(entry.message).toBe("GET /api/data 500");
    });

    it("should include method, path, statusCode in metadata", () => {
      const logger = new StructuredLogger("HTTP");
      logRequest(logger, "DELETE", "/api/item/1", 204, 30);

      const entry = parseLastCall(consolLogSpy);
      expect(entry.metadata?.method).toBe("DELETE");
      expect(entry.metadata?.path).toBe("/api/item/1");
      expect(entry.metadata?.statusCode).toBe(204);
    });

    it("should merge extra metadata", () => {
      const logger = new StructuredLogger("HTTP");
      logRequest(logger, "GET", "/api/x", 200, 10, { userId: "u-123" });

      const entry = parseLastCall(consolLogSpy);
      expect(entry.userId).toBe("u-123");
    });
  });

  // ========== logOperation ==========

  describe("logOperation", () => {
    it("should log at INFO level when operation succeeds", () => {
      const logger = new StructuredLogger("Ops");
      logOperation(logger, "createUser", true);

      expect(consolLogSpy).toHaveBeenCalled();
      const entry = parseLastCall(consolLogSpy);
      expect(entry.message).toBe("Operation completed: createUser");
    });

    it("should log at WARN level when operation fails", () => {
      const logger = new StructuredLogger("Ops");
      logOperation(logger, "deleteRecord", false);

      expect(consoleWarnSpy).toHaveBeenCalled();
      const entry = parseLastCall(consoleWarnSpy);
      expect(entry.message).toBe("Operation failed: deleteRecord");
    });

    it("should include metadata in success log", () => {
      const logger = new StructuredLogger("Ops");
      logOperation(logger, "upload", true, { fileSize: 1024 });

      const entry = parseLastCall(consolLogSpy);
      expect(entry.metadata).toEqual({ fileSize: 1024 });
    });

    it("should include metadata in failure log", () => {
      const logger = new StructuredLogger("Ops");
      logOperation(logger, "process", false, { reason: "timeout" });

      const entry = parseLastCall(consoleWarnSpy);
      expect(entry.metadata).toEqual({ reason: "timeout" });
    });
  });

  // ========== logPerformance ==========

  describe("logPerformance", () => {
    it("should log at DEBUG level when duration is within threshold", () => {
      process.env.NODE_ENV = "development";
      const logger = new StructuredLogger("Perf");

      logPerformance(logger, "fetchData", 500, 1000);

      expect(consoleDebugSpy).toHaveBeenCalled();
      const entry = parseLastCall(consoleDebugSpy);
      expect(entry.message).toBe("Performance: fetchData");
    });

    it("should log at WARN level when duration exceeds threshold", () => {
      const logger = new StructuredLogger("Perf");

      logPerformance(logger, "slowQuery", 2000, 1000);

      expect(consoleWarnSpy).toHaveBeenCalled();
      const entry = parseLastCall(consoleWarnSpy);
      expect(entry.message).toBe("Slow operation: slowQuery");
      // duration is extracted to top-level by createLogEntry
      expect(entry.duration).toBe(2000);
      // threshold is not a special field, so it stays in metadata
      expect(entry.metadata?.threshold).toBe(1000);
    });

    it("should use default threshold of 1000ms when not specified", () => {
      const logger = new StructuredLogger("Perf");

      // 1500ms > default threshold of 1000ms → warn
      logPerformance(logger, "operation", 1500);

      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it("should log DEBUG when duration equals threshold (not exceeds)", () => {
      process.env.NODE_ENV = "development";
      const logger = new StructuredLogger("Perf");

      logPerformance(logger, "operation", 1000, 1000);

      // 1000 is NOT > 1000, so debug
      expect(consoleDebugSpy).toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it("should include duration at top-level entry (not in metadata)", () => {
      process.env.NODE_ENV = "development";
      const logger = new StructuredLogger("Perf");

      logPerformance(logger, "op", 200, 500);

      const entry = parseLastCall(consoleDebugSpy);
      // duration is extracted from metadata to top-level by createLogEntry
      expect(entry.duration).toBe(200);
    });

    it("should include extra metadata in warn log", () => {
      const logger = new StructuredLogger("Perf");

      logPerformance(logger, "heavyOp", 3000, 1000, { query: "SELECT *" });

      const entry = parseLastCall(consoleWarnSpy);
      expect(entry.metadata?.query).toBe("SELECT *");
      // duration is extracted to top-level by createLogEntry
      expect(entry.duration).toBe(3000);
      expect(entry.metadata?.threshold).toBe(1000);
    });
  });
});
