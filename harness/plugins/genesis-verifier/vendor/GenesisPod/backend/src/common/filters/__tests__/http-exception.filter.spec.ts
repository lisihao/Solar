/**
 * HttpExceptionFilter unit tests
 *
 * Covers:
 * - HttpException (object response, string response)
 * - Generic Error instances
 * - Unknown / non-Error exceptions
 * - Production vs development stack trace visibility
 * - Logging level routing (5xx error, 4xx warn, other log)
 * - Response shape (statusCode, timestamp, path, method)
 */

import {
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ArgumentsHost } from "@nestjs/common";
import { Request, Response } from "express";
import { HttpExceptionFilter } from "../http-exception.filter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockHost(overrides?: {
  url?: string;
  method?: string;
  ip?: string;
}): {
  host: ArgumentsHost;
  request: Partial<Request>;
  response: jest.Mocked<Partial<Response>>;
} {
  const request: Partial<Request> = {
    url: overrides?.url ?? "/api/test",
    method: overrides?.method ?? "GET",
    ip: overrides?.ip ?? "127.0.0.1",
    get: jest.fn((header: string) => {
      if (header === "user-agent") return "test-agent";
      return undefined;
    }) as unknown as Request["get"],
  };

  const response: jest.Mocked<Partial<Response>> = {
    status: jest.fn().mockReturnThis() as unknown as jest.Mocked<
      Response["status"]
    >,
    json: jest.fn().mockReturnThis() as unknown as jest.Mocked<
      Response["json"]
    >,
  };

  const host = {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getArgByIndex: jest.fn(),
    getArgs: jest.fn(),
    getType: jest.fn(),
    switchToRpc: jest.fn(),
    switchToWs: jest.fn(),
  } as unknown as ArgumentsHost;

  return { host, request, response };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("HttpExceptionFilter", () => {
  let filter: HttpExceptionFilter;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    filter = new HttpExceptionFilter();

    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // HttpException — object response
  // -------------------------------------------------------------------------

  describe("HttpException with object response", () => {
    it("spreads exception response object into the base response", () => {
      const { host, response } = createMockHost();
      const exception = new HttpException(
        { message: "Validation failed", errors: ["field required"] },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, host);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          message: "Validation failed",
          errors: ["field required"],
        }),
      );
    });

    it("handles BadRequestException with default NestJS response object", () => {
      const { host, response } = createMockHost();
      const exception = new BadRequestException("Bad input");

      filter.catch(exception, host);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST }),
      );
    });

    it("handles NotFoundException", () => {
      const { host, response } = createMockHost();
      const exception = new NotFoundException("Resource not found");

      filter.catch(exception, host);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    });

    it("handles ForbiddenException", () => {
      const { host, response } = createMockHost();
      const exception = new ForbiddenException("Forbidden");

      filter.catch(exception, host);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    });

    it("handles UnauthorizedException", () => {
      const { host, response } = createMockHost();
      const exception = new UnauthorizedException("Unauthorized");

      filter.catch(exception, host);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    });

    it("handles InternalServerErrorException", () => {
      const { host, response } = createMockHost();
      const exception = new InternalServerErrorException("ISE");

      filter.catch(exception, host);

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    });
  });

  // -------------------------------------------------------------------------
  // HttpException — string response
  // -------------------------------------------------------------------------

  describe("HttpException with string response", () => {
    it("sets message to the string and error to the HTTP status name", () => {
      const { host, response } = createMockHost();
      const exception = new HttpException(
        "Custom error message",
        HttpStatus.BAD_GATEWAY,
      );

      filter.catch(exception, host);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_GATEWAY,
          message: "Custom error message",
          error: HttpStatus[HttpStatus.BAD_GATEWAY],
        }),
      );
    });

    it("includes path, method, and timestamp in string-response error", () => {
      const { host, response } = createMockHost({
        url: "/api/users",
        method: "POST",
      });
      const exception = new HttpException("Conflict", HttpStatus.CONFLICT);

      filter.catch(exception, host);

      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/api/users",
          method: "POST",
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Generic Error
  // -------------------------------------------------------------------------

  describe("generic Error instances", () => {
    it("returns 500 with the error message in non-production mode", () => {
      process.env.NODE_ENV = "development";
      const { host, response } = createMockHost();
      const exception = new Error("Something broke");

      filter.catch(exception, host);

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: "Something broke",
        }),
      );
    });

    it("includes stack trace in development mode", () => {
      process.env.NODE_ENV = "development";
      const { host, response } = createMockHost();
      const exception = new Error("Dev error");

      filter.catch(exception, host);

      const body = (response.json as jest.Mock).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(body.stack).toBeDefined();
      expect(typeof body.stack).toBe("string");
    });

    it("hides stack trace and uses generic message in production", () => {
      process.env.NODE_ENV = "production";
      const { host, response } = createMockHost();
      const exception = new Error("Sensitive internal detail");

      filter.catch(exception, host);

      const body = (response.json as jest.Mock).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(body.stack).toBeUndefined();
      expect(body.message).toBe("Internal server error");
    });
  });

  // -------------------------------------------------------------------------
  // Unknown / non-Error exceptions
  // -------------------------------------------------------------------------

  describe("unknown exception types", () => {
    it("handles a plain string exception with 500", () => {
      process.env.NODE_ENV = "development";
      const { host, response } = createMockHost();

      filter.catch("some string error", host);

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    });

    it("handles a null exception with 500", () => {
      const { host, response } = createMockHost();

      filter.catch(null, host);

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    });

    it("handles an object that is not an Error with 500", () => {
      const { host, response } = createMockHost();

      filter.catch({ code: "UNKNOWN" }, host);

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    });

    it("does not include stack for non-Error exceptions even in development", () => {
      process.env.NODE_ENV = "development";
      const { host, response } = createMockHost();

      filter.catch("string error", host);

      const body = (response.json as jest.Mock).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(body.stack).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Response shape guarantees
  // -------------------------------------------------------------------------

  describe("base response shape", () => {
    it("always includes statusCode, timestamp, path, and method", () => {
      const { host, response } = createMockHost({
        url: "/api/items/42",
        method: "DELETE",
      });
      const exception = new NotFoundException();

      filter.catch(exception, host);

      const body = (response.json as jest.Mock).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(body.statusCode).toBe(HttpStatus.NOT_FOUND);
      expect(body.timestamp).toBeDefined();
      expect(body.path).toBe("/api/items/42");
      expect(body.method).toBe("DELETE");
    });

    it("timestamp is a valid ISO 8601 date string", () => {
      const { host, response } = createMockHost();
      const exception = new BadRequestException();

      filter.catch(exception, host);

      const body = (response.json as jest.Mock).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(new Date(body.timestamp as string).toISOString()).toBe(
        body.timestamp,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Logging behaviour
  // -------------------------------------------------------------------------

  describe("logging behaviour", () => {
    it("logs at ERROR level for 5xx exceptions", () => {
      const { host } = createMockHost();
      const exception = new InternalServerErrorException("Server error");

      filter.catch(exception, host);

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining("Server Error"),
        expect.anything(),
      );
    });

    it("logs at WARN level for 4xx exceptions", () => {
      const { host } = createMockHost();
      const exception = new BadRequestException("Bad request");

      filter.catch(exception, host);

      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining("Client Error"),
      );
    });

    it("logs at LOG level for non-4xx non-5xx status codes", () => {
      const { host } = createMockHost();
      // HttpStatus 301 is a redirect — not 4xx or 5xx
      const exception = new HttpException("Moved", 301);

      filter.catch(exception, host);

      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.stringContaining("Request completed"),
      );
    });

    it("includes request path and method in error log", () => {
      const { host } = createMockHost({ url: "/api/users", method: "POST" });
      const exception = new BadRequestException("Validation error");

      filter.catch(exception, host);

      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining("/api/users"),
      );
    });

    it("passes error stack to logger for 5xx generic errors", () => {
      const { host } = createMockHost();
      const exception = new Error("Generic 500");

      filter.catch(exception, host);

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String), // stack trace
      );
    });
  });
});
