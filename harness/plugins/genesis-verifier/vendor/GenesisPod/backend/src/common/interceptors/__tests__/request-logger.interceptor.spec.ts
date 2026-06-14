/**
 * RequestLoggerInterceptor unit tests
 *
 * Covers:
 * - Server-Timing header injection (happy path and headersSent guard)
 * - Metrics recording (histogram + counter, error counter for 4xx/5xx)
 * - shouldSkipLog: skips /health, /api/v1/health, /favicon.ico
 * - isProduction: slow-request-only logging vs always log in dev
 * - extractRoutePattern: UUID / numeric / CUID replacement
 * - Error path: sets Server-Timing, records metrics, logs error
 * - Optional MetricsService: works when not injected
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, CallHandler } from "@nestjs/common";
import { of, throwError } from "rxjs";
import { RequestLoggerInterceptor } from "../request-logger.interceptor";
import { MetricsService } from "@/modules/platform/monitoring/metrics/metrics.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockRequest {
  method: string;
  path: string;
  url: string;
  headers: Record<string, string>;
  user?: { id?: string };
}

interface MockResponse {
  statusCode: number;
  headersSent: boolean;
  setHeader: jest.Mock;
}

function createMockContext(overrides?: {
  method?: string;
  path?: string;
  url?: string;
  statusCode?: number;
  headersSent?: boolean;
  requestId?: string;
  userId?: string;
}): { ctx: ExecutionContext; request: MockRequest; response: MockResponse } {
  const request: MockRequest = {
    method: overrides?.method ?? "GET",
    path: overrides?.path ?? "/api/v1/test",
    url: overrides?.url ?? "/api/v1/test",
    headers: overrides?.requestId
      ? { "x-request-id": overrides.requestId }
      : {},
    user: overrides?.userId ? { id: overrides.userId } : undefined,
  };

  const response: MockResponse = {
    statusCode: overrides?.statusCode ?? 200,
    headersSent: overrides?.headersSent ?? false,
    setHeader: jest.fn(),
  };

  const ctx = {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(request),
      getResponse: jest.fn().mockReturnValue(response),
    }),
    getHandler: jest.fn(),
    getClass: jest.fn(),
  } as unknown as ExecutionContext;

  return { ctx, request, response };
}

function createSuccessHandler(value: unknown = {}): CallHandler {
  return { handle: jest.fn().mockReturnValue(of(value)) };
}

function createErrorHandler(error: unknown): CallHandler {
  return { handle: jest.fn().mockReturnValue(throwError(() => error)) };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("RequestLoggerInterceptor", () => {
  let interceptor: RequestLoggerInterceptor;
  let mockMetrics: jest.Mocked<
    Pick<MetricsService, "recordHistogram" | "incrementCounter">
  >;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    mockMetrics = {
      recordHistogram: jest.fn(),
      incrementCounter: jest.fn(),
    };

    // Suppress structured logger output in tests
    jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    jest.spyOn(console, "log").mockImplementation();
    jest.spyOn(console, "warn").mockImplementation();
    jest.spyOn(console, "error").mockImplementation();
    jest.spyOn(console, "debug").mockImplementation();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestLoggerInterceptor,
        { provide: MetricsService, useValue: mockMetrics },
      ],
    }).compile();

    interceptor = module.get<RequestLoggerInterceptor>(
      RequestLoggerInterceptor,
    );
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Server-Timing header
  // -------------------------------------------------------------------------

  describe("Server-Timing header", () => {
    it("sets Server-Timing header with total duration on success", (done) => {
      process.env.NODE_ENV = "development";
      const { ctx, response } = createMockContext();
      const handler = createSuccessHandler();

      interceptor.intercept(ctx, handler).subscribe(() => {
        expect(response.setHeader).toHaveBeenCalledWith(
          "Server-Timing",
          expect.stringMatching(/^total;dur=\d+$/),
        );
        done();
      });
    });

    it("does NOT set Server-Timing header when headersSent is true", (done) => {
      process.env.NODE_ENV = "development";
      const { ctx, response } = createMockContext({ headersSent: true });
      const handler = createSuccessHandler();

      interceptor.intercept(ctx, handler).subscribe(() => {
        expect(response.setHeader).not.toHaveBeenCalledWith(
          "Server-Timing",
          expect.anything(),
        );
        done();
      });
    });

    it("sets Server-Timing header on error when headersSent is false", (done) => {
      process.env.NODE_ENV = "development";
      const { ctx, response } = createMockContext();
      const handler = createErrorHandler(new Error("Something failed"));

      interceptor.intercept(ctx, handler).subscribe({
        error: () => {
          expect(response.setHeader).toHaveBeenCalledWith(
            "Server-Timing",
            expect.stringMatching(/^total;dur=\d+$/),
          );
          done();
        },
      });
    });

    it("does NOT set Server-Timing header on error when headersSent is true", (done) => {
      process.env.NODE_ENV = "development";
      const { ctx, response } = createMockContext({ headersSent: true });
      const handler = createErrorHandler(new Error("Already flushed"));

      interceptor.intercept(ctx, handler).subscribe({
        error: () => {
          expect(response.setHeader).not.toHaveBeenCalledWith(
            "Server-Timing",
            expect.anything(),
          );
          done();
        },
      });
    });
  });

  // -------------------------------------------------------------------------
  // Metrics recording
  // -------------------------------------------------------------------------

  describe("metrics recording", () => {
    it("records http_request_duration_ms histogram on success", (done) => {
      const { ctx } = createMockContext({
        method: "POST",
        path: "/api/v1/items",
        statusCode: 201,
      });
      const handler = createSuccessHandler();

      interceptor.intercept(ctx, handler).subscribe(() => {
        expect(mockMetrics.recordHistogram).toHaveBeenCalledWith(
          "http_request_duration_ms",
          expect.any(Number),
          expect.objectContaining({ method: "POST", status: "201" }),
        );
        done();
      });
    });

    it("increments http_requests_total counter on success", (done) => {
      const { ctx } = createMockContext({
        method: "GET",
        path: "/api/v1/users",
        statusCode: 200,
      });
      const handler = createSuccessHandler();

      interceptor.intercept(ctx, handler).subscribe(() => {
        expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
          "http_requests_total",
          expect.objectContaining({ method: "GET", status: "200" }),
        );
        done();
      });
    });

    it("increments http_errors_total counter for 4xx responses", (done) => {
      const { ctx } = createMockContext({ statusCode: 404 });
      const handler = createSuccessHandler();

      interceptor.intercept(ctx, handler).subscribe(() => {
        expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
          "http_errors_total",
          expect.objectContaining({ status: "404", error_class: "4xx" }),
        );
        done();
      });
    });

    it("increments http_errors_total counter for 5xx responses", (done) => {
      const { ctx } = createMockContext({ statusCode: 500 });
      const handler = createSuccessHandler();

      interceptor.intercept(ctx, handler).subscribe(() => {
        expect(mockMetrics.incrementCounter).toHaveBeenCalledWith(
          "http_errors_total",
          expect.objectContaining({ status: "500", error_class: "5xx" }),
        );
        done();
      });
    });

    it("does NOT increment http_errors_total for 2xx responses", (done) => {
      const { ctx } = createMockContext({ statusCode: 200 });
      const handler = createSuccessHandler();

      interceptor.intercept(ctx, handler).subscribe(() => {
        const calls = mockMetrics.incrementCounter.mock.calls as [string][];
        const errorCounterCall = calls.find(
          ([name]) => name === "http_errors_total",
        );
        expect(errorCounterCall).toBeUndefined();
        done();
      });
    });

    it("records metrics even on error paths", (done) => {
      const err = new Error("Request failed");
      (err as Error & { status: number }).status = 500;
      const { ctx } = createMockContext({ method: "PUT" });
      const handler = createErrorHandler(err);

      interceptor.intercept(ctx, handler).subscribe({
        error: () => {
          expect(mockMetrics.recordHistogram).toHaveBeenCalledWith(
            "http_request_duration_ms",
            expect.any(Number),
            expect.objectContaining({ method: "PUT" }),
          );
          done();
        },
      });
    });
  });

  // -------------------------------------------------------------------------
  // Without MetricsService
  // -------------------------------------------------------------------------

  describe("when MetricsService is not injected", () => {
    it("works without throwing when metricsService is undefined", (done) => {
      process.env.NODE_ENV = "development";
      const interceptorWithoutMetrics = new RequestLoggerInterceptor(undefined);
      const { ctx } = createMockContext();
      const handler = createSuccessHandler();

      expect(() => {
        interceptorWithoutMetrics.intercept(ctx, handler).subscribe({
          complete: done,
        });
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // shouldSkipLog (health check paths)
  // -------------------------------------------------------------------------

  describe("shouldSkipLog — high-frequency paths are not logged", () => {
    const skipPaths = ["/health", "/api/v1/health", "/favicon.ico"];

    skipPaths.forEach((path) => {
      it(`does not produce an application log for path: ${path}`, (done) => {
        process.env.NODE_ENV = "development";
        const { ctx } = createMockContext({ path });
        const handler = createSuccessHandler();

        const logSpy = jest.spyOn(console, "log").mockImplementation();

        interceptor.intercept(ctx, handler).subscribe(() => {
          // The StructuredLogger uses console.log for info messages.
          // Because the path is skipped, no HTTP log should be emitted.
          // Metrics are still recorded (checked separately), but we confirm
          // that the path is considered a skip candidate by verifying that
          // console.log was not called with this path inside a JSON log entry
          // that mentions the path.
          const loggedWithPath = logSpy.mock.calls.some((args) => {
            try {
              const entry = JSON.parse(String(args[0]));
              return (
                entry.metadata?.path === path || entry.message?.includes(path)
              );
            } catch {
              return false;
            }
          });
          expect(loggedWithPath).toBe(false);
          done();
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // extractRoutePattern
  // -------------------------------------------------------------------------

  describe("extractRoutePattern — dynamic segment normalisation", () => {
    const patterns: [string, string][] = [
      [
        "/api/v1/users/123e4567-e89b-12d3-a456-426614174000",
        "/api/v1/users/:id",
      ],
      ["/api/v1/items/42", "/api/v1/items/:id"],
      ["/api/v1/posts/42/comments", "/api/v1/posts/:id/comments"],
      ["/api/v1/sessions/cjld2cyuq0000t3rmniod1foy", "/api/v1/sessions/:id"],
    ];

    patterns.forEach(([inputPath, expectedPattern]) => {
      it(`normalises "${inputPath}" to "${expectedPattern}"`, (done) => {
        const { ctx } = createMockContext({
          path: inputPath,
          statusCode: 200,
        });
        const handler = createSuccessHandler();

        interceptor.intercept(ctx, handler).subscribe(() => {
          expect(mockMetrics.recordHistogram).toHaveBeenCalledWith(
            "http_request_duration_ms",
            expect.any(Number),
            expect.objectContaining({ route: expectedPattern }),
          );
          done();
        });
      });
    });

    it("strips query string before pattern extraction", (done) => {
      const { ctx } = createMockContext({
        path: "/api/v1/items/99?page=1&limit=10",
        statusCode: 200,
      });
      const handler = createSuccessHandler();

      interceptor.intercept(ctx, handler).subscribe(() => {
        expect(mockMetrics.recordHistogram).toHaveBeenCalledWith(
          "http_request_duration_ms",
          expect.any(Number),
          expect.objectContaining({ route: "/api/v1/items/:id" }),
        );
        done();
      });
    });

    it("returns '/' for an empty path", (done) => {
      const { ctx } = createMockContext({ path: "", url: "/" });
      const handler = createSuccessHandler();

      interceptor.intercept(ctx, handler).subscribe(() => {
        expect(mockMetrics.recordHistogram).toHaveBeenCalledWith(
          "http_request_duration_ms",
          expect.any(Number),
          expect.objectContaining({ route: "/" }),
        );
        done();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Production mode — slow request threshold
  // -------------------------------------------------------------------------

  describe("production mode logging", () => {
    it("does not call console.log for fast requests in production", (done) => {
      // Must set NODE_ENV before constructing the interceptor so isProduction=true
      process.env.NODE_ENV = "production";
      const prodInterceptor = new RequestLoggerInterceptor(
        mockMetrics as unknown as MetricsService,
      );

      const logSpy = jest.spyOn(console, "log").mockImplementation();

      const { ctx } = createMockContext({ path: "/api/v1/data" });
      const handler = createSuccessHandler();

      prodInterceptor.intercept(ctx, handler).subscribe(() => {
        // Fast synchronous handler is well under 500ms threshold, so no HTTP
        // log entry should be emitted in production mode.
        const loggedHttpEntry = logSpy.mock.calls.some((args) => {
          try {
            const entry = JSON.parse(String(args[0]));
            return entry.metadata?.path === "/api/v1/data";
          } catch {
            return false;
          }
        });
        expect(loggedHttpEntry).toBe(false);
        done();
      });
    });
  });
});
