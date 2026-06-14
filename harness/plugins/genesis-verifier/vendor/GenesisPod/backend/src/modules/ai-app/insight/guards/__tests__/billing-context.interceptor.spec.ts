/**
 * BillingContextInterceptor Tests
 *
 * Covers:
 * - No userId → passes through next.handle() directly
 * - Existing BillingContext → passes through next.handle() directly
 * - userId present, no existing context → wraps in BillingContext.run()
 * - topicId extracted from params.id and params.topicId
 * - Observable plumbing: next, error, complete forwarded correctly
 */

jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
    $on = jest.fn();
  },
  AIModelType: { CHAT: "CHAT" },
}));

// Mock BillingContext before importing the interceptor
const mockBillingContextGet = jest.fn();
const mockBillingContextRun = jest.fn();

jest.mock("@/modules/platform/facade", () => ({
  BillingContext: {
    get: mockBillingContextGet,
    run: mockBillingContextRun,
  },
}));

import { BillingContextInterceptor } from "../billing-context.interceptor";
import { of, throwError } from "rxjs";

// Helper to build a minimal CallHandler
function buildCallHandler(
  observable: ReturnType<typeof of | typeof throwError>,
) {
  return {
    handle: jest.fn().mockReturnValue(observable),
  };
}

// Helper to build ExecutionContext
function buildContext(
  userId: string | undefined,
  params: Record<string, string> = {},
) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user: userId !== undefined ? { id: userId } : undefined,
        params,
      }),
    }),
  };
}

describe("BillingContextInterceptor", () => {
  let interceptor: BillingContextInterceptor;

  beforeEach(() => {
    interceptor = new BillingContextInterceptor();
    jest.clearAllMocks();
  });

  describe("when userId is absent", () => {
    it("should return next.handle() directly when user is undefined", (done) => {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ user: undefined, params: {} }),
        }),
      };
      const handler = buildCallHandler(of("result"));

      interceptor.intercept(context as never, handler as never).subscribe({
        next: (val) => {
          expect(val).toBe("result");
          expect(handler.handle).toHaveBeenCalledTimes(1);
          expect(mockBillingContextRun).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it("should return next.handle() directly when user has no id", (done) => {
      const context = buildContext(undefined);
      const handler = buildCallHandler(of("data"));

      interceptor.intercept(context as never, handler as never).subscribe({
        next: (val) => {
          expect(val).toBe("data");
          expect(mockBillingContextRun).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it("should return next.handle() directly when userId is empty string", (done) => {
      const context = buildContext("");
      const handler = buildCallHandler(of("data"));

      interceptor.intercept(context as never, handler as never).subscribe({
        next: (val) => {
          expect(val).toBe("data");
          expect(mockBillingContextRun).not.toHaveBeenCalled();
          done();
        },
      });
    });
  });

  describe("when BillingContext already exists", () => {
    it("should skip wrapping and call next.handle() directly", (done) => {
      mockBillingContextGet.mockReturnValue({ userId: "existing-user" });
      const context = buildContext("user-1", { id: "topic-1" });
      const handler = buildCallHandler(of("skipped"));

      interceptor.intercept(context as never, handler as never).subscribe({
        next: (val) => {
          expect(val).toBe("skipped");
          expect(mockBillingContextRun).not.toHaveBeenCalled();
          expect(handler.handle).toHaveBeenCalledTimes(1);
          done();
        },
      });
    });
  });

  describe("when userId is present and no existing context", () => {
    beforeEach(() => {
      mockBillingContextGet.mockReturnValue(null);
      // Make BillingContext.run call the callback synchronously
      mockBillingContextRun.mockImplementation(
        (_opts: unknown, cb: () => void) => {
          cb();
        },
      );
    });

    it("should wrap the call in BillingContext.run with correct options", (done) => {
      const context = buildContext("user-42", { id: "topic-99" });
      const handler = buildCallHandler(of("wrapped-result"));

      interceptor.intercept(context as never, handler as never).subscribe({
        next: (val) => {
          expect(val).toBe("wrapped-result");
          expect(mockBillingContextRun).toHaveBeenCalledTimes(1);
          expect(mockBillingContextRun).toHaveBeenCalledWith(
            {
              userId: "user-42",
              moduleType: "topic-insights",
              operationType: "research",
              referenceId: "topic-99",
            },
            expect.any(Function),
          );
          done();
        },
      });
    });

    it("should use params.topicId when params.id is absent", (done) => {
      const context = buildContext("user-1", { topicId: "topic-xyz" });
      const handler = buildCallHandler(of("ok"));

      interceptor.intercept(context as never, handler as never).subscribe({
        next: () => {
          expect(mockBillingContextRun).toHaveBeenCalledWith(
            expect.objectContaining({ referenceId: "topic-xyz" }),
            expect.any(Function),
          );
          done();
        },
      });
    });

    it("should set referenceId to undefined when no params", (done) => {
      const context = buildContext("user-1", {});
      const handler = buildCallHandler(of("ok"));

      interceptor.intercept(context as never, handler as never).subscribe({
        next: () => {
          expect(mockBillingContextRun).toHaveBeenCalledWith(
            expect.objectContaining({ referenceId: undefined }),
            expect.any(Function),
          );
          done();
        },
      });
    });

    it("should forward errors from next.handle() to subscriber", (done) => {
      const testError = new Error("downstream error");
      const context = buildContext("user-1", { id: "topic-1" });
      const handler = buildCallHandler(throwError(() => testError));

      interceptor.intercept(context as never, handler as never).subscribe({
        error: (err) => {
          expect(err).toBe(testError);
          done();
        },
      });
    });

    it("should call subscriber.complete when observable completes", (done) => {
      const context = buildContext("user-1", { id: "topic-1" });
      const handler = buildCallHandler(of("val"));

      interceptor.intercept(context as never, handler as never).subscribe({
        next: () => {},
        complete: () => {
          done();
        },
      });
    });

    it("should forward multiple emitted values", (done) => {
      const { Subject } = require("rxjs") as typeof import("rxjs");
      const subject = new Subject<string>();

      mockBillingContextRun.mockImplementation(
        (_opts: unknown, cb: () => void) => {
          cb();
        },
      );

      const context = buildContext("user-1", { id: "topic-1" });
      const handler = {
        handle: jest.fn().mockReturnValue(subject.asObservable()),
      };

      const collected: string[] = [];

      interceptor.intercept(context as never, handler as never).subscribe({
        next: (val) => collected.push(val as string),
        complete: () => {
          expect(collected).toEqual(["a", "b", "c"]);
          done();
        },
      });

      subject.next("a");
      subject.next("b");
      subject.next("c");
      subject.complete();
    });
  });
});
