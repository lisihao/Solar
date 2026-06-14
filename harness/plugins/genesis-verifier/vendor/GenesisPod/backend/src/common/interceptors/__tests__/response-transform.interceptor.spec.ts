/**
 * ResponseTransformInterceptor unit tests
 *
 * Covers:
 * - Standard response wrapping (success / data / metadata)
 * - Skip-transform metadata bypass
 * - requestId taken from x-request-id header
 * - Auto-generated requestId when header is absent
 * - X-Request-Id response header is set
 * - createPaginatedResponse helper function
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { ExecutionContext, CallHandler } from "@nestjs/common";
import { of } from "rxjs";
import {
  ResponseTransformInterceptor,
  SKIP_TRANSFORM_KEY,
  createPaginatedResponse,
  type StandardResponse,
} from "../response-transform.interceptor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCallHandler<T>(returnValue: T): CallHandler<T> {
  return {
    handle: jest.fn().mockReturnValue(of(returnValue)),
  };
}

function createMockExecutionContext(overrides?: {
  requestId?: string;
  skipTransform?: boolean;
}): ExecutionContext {
  const request = {
    headers: overrides?.requestId
      ? { "x-request-id": overrides.requestId }
      : {},
  };

  const response = {
    setHeader: jest.fn(),
  };

  const reflectorGetAllAndOverride = jest
    .fn()
    .mockReturnValue(overrides?.skipTransform ?? false);

  const ctx = {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(request),
      getResponse: jest.fn().mockReturnValue(response),
    }),
    getHandler: jest.fn(),
    getClass: jest.fn(),
    _response: response,
    _reflectorGetAllAndOverride: reflectorGetAllAndOverride,
  };

  return ctx as unknown as ExecutionContext;
}

function _getResponseHeader(
  ctx: ExecutionContext & { _response?: { setHeader: jest.Mock } },
  header: string,
): string | undefined {
  const calls = (ctx as unknown as { _response: { setHeader: jest.Mock } })
    ._response.setHeader.mock.calls as [string, string][];
  const match = calls.find(([name]) => name === header);
  return match ? match[1] : undefined;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ResponseTransformInterceptor", () => {
  let interceptor: ResponseTransformInterceptor<unknown>;
  let mockReflector: jest.Mocked<Pick<Reflector, "getAllAndOverride">>;

  beforeEach(async () => {
    mockReflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResponseTransformInterceptor,
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    interceptor = module.get<ResponseTransformInterceptor<unknown>>(
      ResponseTransformInterceptor,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Standard wrapping
  // -------------------------------------------------------------------------

  describe("standard response wrapping", () => {
    it("wraps data in { success, data, metadata } shape", (done) => {
      mockReflector.getAllAndOverride.mockReturnValue(false);
      const ctx = createMockExecutionContext();
      const handler = createMockCallHandler({ id: 1, name: "Alice" });

      interceptor
        .intercept(ctx, handler)
        .subscribe((r: StandardResponse<unknown>) => {
          expect(r.success).toBe(true);
          expect(r.data).toEqual({ id: 1, name: "Alice" });
          expect(r.metadata).toBeDefined();
          done();
        });
    });

    it("metadata contains requestId, timestamp, and duration", (done) => {
      mockReflector.getAllAndOverride.mockReturnValue(false);
      const ctx = createMockExecutionContext({ requestId: "req-unit-test" });
      const handler = createMockCallHandler("hello");

      interceptor
        .intercept(ctx, handler)
        .subscribe((r: StandardResponse<unknown>) => {
          expect(r.metadata.requestId).toBe("req-unit-test");
          expect(r.metadata.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
          expect(typeof r.metadata.duration).toBe("number");
          expect(r.metadata.duration).toBeGreaterThanOrEqual(0);
          done();
        });
    });

    it("sets X-Request-Id response header", (done) => {
      mockReflector.getAllAndOverride.mockReturnValue(false);
      const ctx = createMockExecutionContext({ requestId: "hdr-123" });
      const extCtx = ctx as unknown as ExecutionContext & {
        _response: { setHeader: jest.Mock };
      };
      const handler = createMockCallHandler(null);

      interceptor.intercept(ctx, handler).subscribe(() => {
        const setHeaderCalls = extCtx._response.setHeader.mock.calls as [
          string,
          string,
        ][];
        const xRequestId = setHeaderCalls.find(
          ([name]) => name === "X-Request-Id",
        );
        expect(xRequestId).toBeDefined();
        expect(xRequestId![1]).toBe("hdr-123");
        done();
      });
    });

    it("uses x-request-id header value as requestId in metadata", (done) => {
      mockReflector.getAllAndOverride.mockReturnValue(false);
      const ctx = createMockExecutionContext({ requestId: "from-header-456" });
      const handler = createMockCallHandler({ ok: true });

      interceptor
        .intercept(ctx, handler)
        .subscribe((r: StandardResponse<unknown>) => {
          expect(r.metadata.requestId).toBe("from-header-456");
          done();
        });
    });

    it("generates a requestId when x-request-id header is absent", (done) => {
      mockReflector.getAllAndOverride.mockReturnValue(false);
      const ctx = createMockExecutionContext(); // no requestId override
      const handler = createMockCallHandler(42);

      interceptor
        .intercept(ctx, handler)
        .subscribe((r: StandardResponse<unknown>) => {
          expect(r.metadata.requestId).toMatch(/^req_\d+_/);
          done();
        });
    });

    it("handles null data without error", (done) => {
      mockReflector.getAllAndOverride.mockReturnValue(false);
      const ctx = createMockExecutionContext();
      const handler = createMockCallHandler(null);

      interceptor
        .intercept(ctx, handler)
        .subscribe((r: StandardResponse<unknown>) => {
          expect(r.success).toBe(true);
          expect(r.data).toBeNull();
          done();
        });
    });

    it("handles array data correctly", (done) => {
      mockReflector.getAllAndOverride.mockReturnValue(false);
      const ctx = createMockExecutionContext();
      const handler = createMockCallHandler([1, 2, 3]);

      interceptor
        .intercept(ctx, handler)
        .subscribe((r: StandardResponse<unknown>) => {
          expect(r.data).toEqual([1, 2, 3]);
          done();
        });
    });

    it("duration is approximately 0 for synchronous handlers", (done) => {
      mockReflector.getAllAndOverride.mockReturnValue(false);
      const ctx = createMockExecutionContext();
      const handler = createMockCallHandler("fast");

      interceptor
        .intercept(ctx, handler)
        .subscribe((r: StandardResponse<unknown>) => {
          // Allow up to 100ms to avoid flakiness in slow CI
          expect(r.metadata.duration).toBeLessThan(100);
          done();
        });
    });
  });

  // -------------------------------------------------------------------------
  // SkipTransform
  // -------------------------------------------------------------------------

  describe("skip transform behaviour", () => {
    it("returns raw data when skipTransform metadata is true", (done) => {
      mockReflector.getAllAndOverride.mockReturnValue(true);
      const ctx = createMockExecutionContext({ skipTransform: true });
      const rawData = { stream: true, content: "raw" };
      const handler = createMockCallHandler(rawData);

      interceptor.intercept(ctx, handler).subscribe((result) => {
        // The result should be the raw data, NOT wrapped in StandardResponse
        expect(result).toEqual(rawData);
        expect((result as Record<string, unknown>).success).toBeUndefined();
        done();
      });
    });

    it("does not set X-Request-Id header when skipping transform", (done) => {
      mockReflector.getAllAndOverride.mockReturnValue(true);
      const ctx = createMockExecutionContext({ skipTransform: true });
      const extCtx = ctx as unknown as ExecutionContext & {
        _response: { setHeader: jest.Mock };
      };
      const handler = createMockCallHandler("skip me");

      interceptor.intercept(ctx, handler).subscribe(() => {
        expect(extCtx._response.setHeader).not.toHaveBeenCalled();
        done();
      });
    });

    it("checks both handler and class metadata via getAllAndOverride", (done) => {
      mockReflector.getAllAndOverride.mockReturnValue(false);
      const ctx = createMockExecutionContext();
      const handler = createMockCallHandler("data");

      interceptor.intercept(ctx, handler).subscribe(() => {
        // getAllAndOverride is called with the SKIP_TRANSFORM_KEY and a two-element
        // array of [handler, class] (which may be undefined in test mocks).
        expect(mockReflector.getAllAndOverride).toHaveBeenCalledWith(
          SKIP_TRANSFORM_KEY,
          expect.any(Array),
        );
        const callArgs = mockReflector.getAllAndOverride.mock.calls[0] as [
          string,
          unknown[],
        ];
        expect(callArgs[0]).toBe(SKIP_TRANSFORM_KEY);
        expect(callArgs[1]).toHaveLength(2);
        done();
      });
    });
  });

  // -------------------------------------------------------------------------
  // SKIP_TRANSFORM_KEY constant
  // -------------------------------------------------------------------------

  describe("SKIP_TRANSFORM_KEY constant", () => {
    it("equals 'skipTransform'", () => {
      expect(SKIP_TRANSFORM_KEY).toBe("skipTransform");
    });
  });
});

// ---------------------------------------------------------------------------
// createPaginatedResponse helper
// ---------------------------------------------------------------------------

describe("createPaginatedResponse", () => {
  it("returns items, total, page, pageSize, hasMore, totalPages", () => {
    const result = createPaginatedResponse(["a", "b", "c"], 10, 1, 3);

    expect(result.items).toEqual(["a", "b", "c"]);
    expect(result.total).toBe(10);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(3);
    expect(result.totalPages).toBe(4); // ceil(10/3) = 4
    expect(result.hasMore).toBe(true); // page 1 < totalPages 4
  });

  it("sets hasMore to false on the last page", () => {
    const result = createPaginatedResponse(["x"], 10, 4, 3);

    expect(result.hasMore).toBe(false); // page 4 >= totalPages 4
  });

  it("sets hasMore to false when all items fit in one page", () => {
    const result = createPaginatedResponse([1, 2, 3], 3, 1, 10);

    expect(result.totalPages).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it("calculates totalPages correctly for exact division", () => {
    const result = createPaginatedResponse([], 9, 1, 3);

    expect(result.totalPages).toBe(3);
  });

  it("calculates totalPages correctly for non-exact division", () => {
    const result = createPaginatedResponse([], 10, 1, 3);

    expect(result.totalPages).toBe(4);
  });

  it("handles empty items array", () => {
    const result = createPaginatedResponse([], 0, 1, 10);

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it("hasMore is false when page equals totalPages", () => {
    const result = createPaginatedResponse(["z"], 5, 5, 1);

    // totalPages = ceil(5/1) = 5, page = 5, hasMore = 5 < 5 = false
    expect(result.hasMore).toBe(false);
  });
});
