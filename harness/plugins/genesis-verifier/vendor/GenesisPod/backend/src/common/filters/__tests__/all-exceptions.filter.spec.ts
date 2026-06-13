import { Test, TestingModule } from "@nestjs/testing";
import { AllExceptionsFilter } from "../all-exceptions.filter";
import { ErrorTrackingService } from "../../../modules/platform/monitoring";
import {
  HttpException,
  HttpStatus,
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { Request, Response } from "express";
import { RequestContext } from "../../context/request-context";

describe("AllExceptionsFilter", () => {
  let filter: AllExceptionsFilter;
  let errorTrackingService: jest.Mocked<ErrorTrackingService>;
  let mockResponse: Partial<Response>;
  let mockRequest: Partial<Request>;
  let mockArgumentsHost: ArgumentsHost;

  beforeEach(async () => {
    const mockErrorTrackingService = {
      logError: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AllExceptionsFilter,
        { provide: ErrorTrackingService, useValue: mockErrorTrackingService },
      ],
    }).compile();

    filter = module.get<AllExceptionsFilter>(AllExceptionsFilter);
    errorTrackingService = module.get(ErrorTrackingService);

    // Mock Express Request
    mockRequest = {
      url: "/api/test",
      method: "GET",
      ip: "127.0.0.1",
      get: jest.fn((header: string) => {
        if (header === "user-agent") return "test-agent";
        return undefined;
      }) as any,
    };

    // Mock Express Response
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    // Mock ArgumentsHost
    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
      getArgByIndex: jest.fn(),
      getArgs: jest.fn(),
      getType: jest.fn(),
      switchToRpc: jest.fn(),
      switchToWs: jest.fn(),
    };

    // Spy on logger
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    // Mock RequestContext
    jest.spyOn(RequestContext, "getRequestId").mockReturnValue("req-123");
    jest.spyOn(RequestContext, "getTraceId").mockReturnValue("trace-123");
    jest.spyOn(RequestContext, "getUserId").mockReturnValue("user-123");
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("HTTP exceptions", () => {
    it("should handle BadRequestException correctly", () => {
      // Arrange
      const exception = new BadRequestException("Invalid input");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          message: "Invalid input",
          path: "/api/test",
          method: "GET",
          requestId: "req-123",
          traceId: "trace-123",
        }),
      );
    });

    it("should handle NotFoundException correctly", () => {
      // Arrange
      const exception = new NotFoundException("Resource not found");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.NOT_FOUND,
          message: "Resource not found",
        }),
      );
    });

    it("should handle UnauthorizedException correctly", () => {
      // Arrange
      const exception = new UnauthorizedException("Invalid token");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.UNAUTHORIZED,
          message: "Invalid token",
        }),
      );
    });

    it("should handle ForbiddenException correctly", () => {
      // Arrange
      const exception = new ForbiddenException("Access denied");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.FORBIDDEN,
          message: "Access denied",
        }),
      );
    });

    it("should handle InternalServerErrorException correctly", () => {
      // Arrange
      const exception = new InternalServerErrorException("Server error");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: "Server error",
        }),
      );
    });

    it("should handle HttpException with object response", () => {
      // Arrange
      const exception = new HttpException(
        {
          message: "Validation failed",
          error: "VALIDATION_ERROR",
          details: { field: "email" },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          message: "Validation failed",
          code: "VALIDATION_ERROR",
        }),
      );
    });

    it("should handle HttpException with string response", () => {
      // Arrange
      const exception = new HttpException(
        "Custom error",
        HttpStatus.BAD_GATEWAY,
      );

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_GATEWAY,
          message: "Custom error",
        }),
      );
    });
  });

  describe("Prisma exceptions", () => {
    it("should handle P2002 (unique constraint violation)", () => {
      // Arrange
      const exception = new PrismaClientKnownRequestError(
        "Unique constraint failed",
        {
          code: "P2002",
          clientVersion: "5.0.0",
          meta: { target: ["email"] },
        },
      );

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.CONFLICT,
          message: "Duplicate entry: email",
          code: "DUPLICATE_ERROR",
          details: { field: ["email"] },
        }),
      );
    });

    it("should handle P2003 (foreign key constraint violation)", () => {
      // Arrange
      const exception = new PrismaClientKnownRequestError("Foreign key error", {
        code: "P2003",
        clientVersion: "5.0.0",
        meta: { field_name: "userId" },
      });

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          message: "Invalid reference: related record not found",
          code: "FOREIGN_KEY_VIOLATION",
        }),
      );
    });

    it("should handle P2025 (record not found)", () => {
      // Arrange
      const exception = new PrismaClientKnownRequestError("Record not found", {
        code: "P2025",
        clientVersion: "5.0.0",
        meta: { cause: "Record to update not found" },
      });

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.NOT_FOUND,
          message: "Record not found",
          code: "NOT_FOUND",
        }),
      );
    });

    it("should handle P2014 (relation violation)", () => {
      // Arrange
      const exception = new PrismaClientKnownRequestError("Relation error", {
        code: "P2014",
        clientVersion: "5.0.0",
        meta: { relation_name: "posts" },
      });

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          message: "Invalid relation: required relation is missing",
          code: "RELATION_VIOLATION",
        }),
      );
    });

    it("should handle P2011 (null constraint violation)", () => {
      // Arrange
      const exception = new PrismaClientKnownRequestError("Null constraint", {
        code: "P2011",
        clientVersion: "5.0.0",
        meta: { target: ["email"] },
      });

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          message: "Required field cannot be null",
          code: "NULL_CONSTRAINT_VIOLATION",
        }),
      );
    });

    it("should handle P2023 (inconsistent column data)", () => {
      // Arrange
      const exception = new PrismaClientKnownRequestError("Inconsistent data", {
        code: "P2023",
        clientVersion: "5.0.0",
        meta: { column_name: "id" },
      });

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          code: "DATA_INCONSISTENCY",
        }),
      );
    });

    it("should handle unknown Prisma error codes", () => {
      // Arrange
      const exception = new PrismaClientKnownRequestError("Unknown error", {
        code: "P9999",
        clientVersion: "5.0.0",
        meta: {},
      });

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: "Database error occurred",
          code: "DATABASE_ERROR",
          details: { prismaCode: "P9999" },
        }),
      );
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining("Unhandled Prisma error: P9999"),
        expect.any(String),
      );
    });
  });

  describe("generic errors", () => {
    it("should handle generic Error instances", () => {
      // Arrange
      const exception = new Error("Something went wrong");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: "Something went wrong",
        }),
      );
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        "Uncaught exception",
        expect.any(String),
      );
    });

    it("should handle unknown exception types", () => {
      // Arrange
      const exception = "string error";

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: "Internal server error",
        }),
      );
    });

    it("should handle null exception", () => {
      // Arrange
      const exception = null;

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: "Internal server error",
        }),
      );
    });
  });

  describe("response format", () => {
    it("should include timestamp in ISO format", () => {
      // Arrange
      const exception = new NotFoundException("Not found");
      const beforeTime = new Date().toISOString();

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      const responseCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(responseCall.timestamp).toBeDefined();
      expect(new Date(responseCall.timestamp).toISOString()).toBe(
        responseCall.timestamp,
      );
      expect(responseCall.timestamp >= beforeTime).toBe(true);
    });

    it("should include path and method from request", () => {
      // Arrange
      const exception = new BadRequestException("Bad request");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/api/test",
          method: "GET",
        }),
      );
    });

    it("should include requestId and traceId when available", () => {
      // Arrange
      const exception = new BadRequestException("Bad request");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "req-123",
          traceId: "trace-123",
        }),
      );
    });

    it("should not include stack trace in production", () => {
      // Arrange
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      const exception = new Error("Production error");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      const responseCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(responseCall.stack).toBeUndefined();

      // Cleanup
      process.env.NODE_ENV = originalEnv;
    });

    it("should include stack trace in development", () => {
      // Arrange
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      const exception = new Error("Development error");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      const responseCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(responseCall.stack).toBeDefined();
      expect(responseCall.stack).toContain("Development error");

      // Cleanup
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe("logging behavior", () => {
    it("should log server errors (5xx) as errors", () => {
      // Arrange
      const exception = new InternalServerErrorException("Server error");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining("Server Error"),
        expect.any(String),
      );
    });

    it("should log client errors (4xx) as warnings", () => {
      // Arrange
      const exception = new BadRequestException("Bad request");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining("Client Error"),
      );
    });

    it("should downgrade 401 (Unauthorized) to debug to silence scanner noise", () => {
      // Arrange
      const exception = new UnauthorizedException("Please sign in to continue");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(Logger.prototype.warn).not.toHaveBeenCalled();
      expect(Logger.prototype.debug).toHaveBeenCalledWith(
        expect.stringContaining("Auth rejected"),
      );
    });

    it("should downgrade 403 (Forbidden) to debug to silence scanner noise", () => {
      // Arrange
      const exception = new ForbiddenException("Access denied");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(Logger.prototype.warn).not.toHaveBeenCalled();
      expect(Logger.prototype.debug).toHaveBeenCalledWith(
        expect.stringContaining("Auth rejected"),
      );
    });

    it("should include user context in logs when available", () => {
      // Arrange
      mockRequest.user = { id: "user-456" };
      const exception = new BadRequestException("Bad request");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining("user-456"),
      );
    });
  });

  describe("error tracking integration", () => {
    it("should report 5xx errors to monitoring service", () => {
      // Arrange
      const exception = new InternalServerErrorException("Critical error");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(errorTrackingService.logError).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: expect.any(String),
          errorType: "http_exception",
          severity: "error",
          component: "http",
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        }),
      );
    });

    it("should not report 4xx errors to monitoring service", () => {
      // Arrange
      const exception = new BadRequestException("Client error");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      expect(errorTrackingService.logError).not.toHaveBeenCalled();
    });

    it("should handle monitoring service failures gracefully", async () => {
      // Arrange
      errorTrackingService.logError.mockRejectedValue(
        new Error("Monitoring failed"),
      );
      const exception = new InternalServerErrorException("Server error");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Wait for async promise to resolve
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Assert - should not throw, just log warning
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to track error"),
      );
    });

    it("should work without ErrorTrackingService", () => {
      // Arrange
      const filterWithoutTracking = new AllExceptionsFilter(undefined);
      const exception = new InternalServerErrorException("Server error");

      // Act & Assert - should not throw
      expect(() => {
        filterWithoutTracking.catch(exception, mockArgumentsHost);
      }).not.toThrow();
    });
  });

  describe("edge cases", () => {
    it("should handle missing RequestContext gracefully", () => {
      // Arrange
      jest.spyOn(RequestContext, "getRequestId").mockReturnValue(undefined);
      jest.spyOn(RequestContext, "getTraceId").mockReturnValue(undefined);
      const exception = new BadRequestException("Test");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert
      const responseCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(responseCall.requestId).toBeUndefined();
      expect(responseCall.traceId).toBeUndefined();
    });

    it("should handle missing user-agent header", () => {
      // Arrange
      mockRequest.get = jest.fn().mockReturnValue(undefined);
      const exception = new BadRequestException("Test");

      // Act
      filter.catch(exception, mockArgumentsHost);

      // Assert - should not throw
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    });

    it("should handle exceptions with circular references", () => {
      // Arrange
      const circularObject: any = { name: "test" };
      circularObject.self = circularObject;
      const exception = new HttpException(
        circularObject,
        HttpStatus.BAD_REQUEST,
      );

      // Act & Assert - should not throw
      expect(() => {
        filter.catch(exception, mockArgumentsHost);
      }).not.toThrow();
    });
  });
});
