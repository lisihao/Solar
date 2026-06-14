import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { ErrorTrackingService } from "../error-reporting/error-tracking.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";

describe("ErrorTrackingService", () => {
  let service: ErrorTrackingService;
  let mockPrisma: jest.Mocked<Partial<PrismaService>>;

  const makeErrorLog = (overrides: Record<string, unknown> = {}) => ({
    id: "error-1",
    errorCode: "TEST_ERROR",
    errorType: "Error",
    message: "Test error message",
    stackTrace: null,
    severity: "error",
    component: "test-service",
    path: "/api/test",
    method: "GET",
    statusCode: 500,
    userId: null,
    requestId: null,
    fingerprint: "abc123",
    metadata: {},
    resolved: false,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    mockPrisma = {
      systemErrorLog: {
        create: jest.fn().mockResolvedValue(makeErrorLog()),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(makeErrorLog()),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      } as unknown as PrismaService["systemErrorLog"],
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ErrorTrackingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ErrorTrackingService>(ErrorTrackingService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== logError ====================

  describe("logError", () => {
    it("creates an error log entry and returns its id", async () => {
      const id = await service.logError({
        errorCode: "NOT_FOUND",
        errorType: "NotFoundException",
        message: "Resource not found",
        severity: "error",
        component: "resource-service",
      });

      expect(id).toBe("error-1");
      expect(mockPrisma.systemErrorLog!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            errorCode: "NOT_FOUND",
            errorType: "NotFoundException",
            severity: "error",
            component: "resource-service",
          }),
        }),
      );
    });

    it("defaults severity to 'error' when not specified", async () => {
      await service.logError({
        errorCode: "GENERIC",
        errorType: "Error",
        message: "Generic error",
      });

      const createCall = (mockPrisma.systemErrorLog!.create as jest.Mock).mock
        .calls[0][0];
      expect(createCall.data.severity).toBe("error");
    });

    it("generates a fingerprint from errorCode and message", async () => {
      await service.logError({
        errorCode: "TEST",
        errorType: "Error",
        message: "Test message",
      });

      const createCall = (mockPrisma.systemErrorLog!.create as jest.Mock).mock
        .calls[0][0];
      expect(createCall.data.fingerprint).toBeDefined();
      expect(typeof createCall.data.fingerprint).toBe("string");
      expect(createCall.data.fingerprint.length).toBe(16);
    });

    it("uses stack trace location in fingerprint generation", async () => {
      await service.logError({
        errorCode: "STACK_ERROR",
        errorType: "Error",
        message: "Stack error",
        stackTrace: "Error: Stack error\n    at Object.<anonymous> (test.ts:1)",
      });

      const createCall = (mockPrisma.systemErrorLog!.create as jest.Mock).mock
        .calls[0][0];
      expect(createCall.data.fingerprint).toBeDefined();
    });

    it("logs a warning when an error is logged", async () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();

      await service.logError({
        errorCode: "TEST",
        errorType: "Error",
        message: "Test error",
      });

      expect(warnSpy).toHaveBeenCalled();
    });

    it("stores metadata as JSON", async () => {
      await service.logError({
        errorCode: "META_ERROR",
        errorType: "Error",
        message: "Error with metadata",
        metadata: { requestId: "req-123", userId: "user-456" },
      });

      const createCall = (mockPrisma.systemErrorLog!.create as jest.Mock).mock
        .calls[0][0];
      expect(createCall.data.metadata).toEqual({
        requestId: "req-123",
        userId: "user-456",
      });
    });
  });

  // ==================== getErrorStats ====================

  describe("getErrorStats", () => {
    it("returns zero stats when no errors", async () => {
      // All count calls (total, critical, error, warning, resolved + 7 trend days) return 0
      (mockPrisma.systemErrorLog!.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.systemErrorLog!.groupBy as jest.Mock).mockResolvedValue([]);

      const stats = await service.getErrorStats();

      expect(stats.total).toBe(0);
      expect(stats.critical).toBe(0);
      expect(stats.error).toBe(0);
      expect(stats.warning).toBe(0);
      expect(stats.resolved).toBe(0);
      expect(stats.unresolved).toBe(0);
    });

    it("computes unresolved as total minus resolved", async () => {
      // Promise.all resolves: [total, critical, error, warning, resolved, byComponent, byErrorCode, trendData]
      // count() is called 5 times total (+ many more inside getTrendData which loops 7 days)
      // Simplify: mock count to return different values via sequential mocks
      (mockPrisma.systemErrorLog!.count as jest.Mock)
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(5) // critical
        .mockResolvedValueOnce(80) // error
        .mockResolvedValueOnce(15) // warning
        .mockResolvedValueOnce(20) // resolved
        .mockResolvedValue(0); // trend day counts (7 calls)
      (mockPrisma.systemErrorLog!.groupBy as jest.Mock).mockResolvedValue([]);

      const stats = await service.getErrorStats();

      expect(stats.total).toBe(100);
      expect(stats.unresolved).toBe(80); // 100 - 20
    });

    it("applies date range filter", async () => {
      const startDate = new Date("2025-01-01");
      (mockPrisma.systemErrorLog!.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.systemErrorLog!.groupBy as jest.Mock).mockResolvedValue([]);

      await service.getErrorStats({ startDate });

      expect(mockPrisma.systemErrorLog!.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({ gte: startDate }),
          }),
        }),
      );
    });

    it("applies component filter", async () => {
      (mockPrisma.systemErrorLog!.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.systemErrorLog!.groupBy as jest.Mock).mockResolvedValue([]);

      await service.getErrorStats({ component: "auth-service" });

      expect(mockPrisma.systemErrorLog!.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ component: "auth-service" }),
        }),
      );
    });

    it("returns byComponent and byErrorCode breakdowns", async () => {
      // count() is called for: total, critical, error, warning, resolved, then 7x for trend
      (mockPrisma.systemErrorLog!.count as jest.Mock).mockResolvedValue(3);
      (mockPrisma.systemErrorLog!.groupBy as jest.Mock)
        .mockResolvedValueOnce([
          { component: "auth", _count: { id: 2 } },
          { component: null, _count: { id: 1 } },
        ]) // byComponent
        .mockResolvedValueOnce([{ errorCode: "AUTH_FAIL", _count: { id: 3 } }]); // byErrorCode

      const stats = await service.getErrorStats();

      expect(stats.byComponent).toEqual({ auth: 2, unknown: 1 });
      expect(stats.byErrorCode).toEqual({ AUTH_FAIL: 3 });
      expect(stats.trend).toHaveLength(7);
    });
  });

  // ==================== getAggregatedErrors ====================

  describe("getAggregatedErrors", () => {
    it("returns aggregated error list", async () => {
      const now = new Date();
      (mockPrisma.systemErrorLog!.groupBy as jest.Mock).mockResolvedValue([
        {
          errorCode: "DB_ERROR",
          severity: "critical",
          component: "prisma",
          _count: { id: 5 },
          _max: { createdAt: now, message: "Connection failed" },
        },
      ]);

      const result = await service.getAggregatedErrors();

      expect(result).toHaveLength(1);
      expect(result[0].errorCode).toBe("DB_ERROR");
      expect(result[0].count).toBe(5);
      expect(result[0].severity).toBe("critical");
      expect(result[0].component).toBe("prisma");
      expect(result[0].latestMessage).toBe("Connection failed");
    });

    it("applies severity filter", async () => {
      (mockPrisma.systemErrorLog!.groupBy as jest.Mock).mockResolvedValue([]);

      await service.getAggregatedErrors({ severity: "critical" });

      expect(mockPrisma.systemErrorLog!.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ severity: "critical" }),
        }),
      );
    });

    it("applies limit parameter", async () => {
      (mockPrisma.systemErrorLog!.groupBy as jest.Mock).mockResolvedValue([]);

      await service.getAggregatedErrors({ limit: 10 });

      expect(mockPrisma.systemErrorLog!.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });
  });

  // ==================== resolveError / resolveErrorsByCode ====================

  describe("resolveError", () => {
    it("marks a single error as resolved", async () => {
      const resolved = makeErrorLog({ resolved: true, resolvedBy: "admin" });
      (mockPrisma.systemErrorLog!.update as jest.Mock).mockResolvedValue(
        resolved,
      );

      await service.resolveError("error-1", "admin");

      expect(mockPrisma.systemErrorLog!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "error-1" },
          data: expect.objectContaining({
            resolved: true,
            resolvedBy: "admin",
          }),
        }),
      );
    });
  });

  describe("resolveErrorsByCode", () => {
    it("batch resolves all unresolved errors by code", async () => {
      (mockPrisma.systemErrorLog!.updateMany as jest.Mock).mockResolvedValue({
        count: 5,
      });

      const result = await service.resolveErrorsByCode("NETWORK_ERROR", "ops");

      expect(result.resolved).toBe(5);
      expect(mockPrisma.systemErrorLog!.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { errorCode: "NETWORK_ERROR", resolved: false },
        }),
      );
    });
  });

  // ==================== cleanupOldErrors ====================

  describe("cleanupOldErrors", () => {
    it("deletes resolved errors older than daysToKeep", async () => {
      (mockPrisma.systemErrorLog!.deleteMany as jest.Mock).mockResolvedValue({
        count: 12,
      });

      const count = await service.cleanupOldErrors(30);

      expect(count).toBe(12);
      expect(mockPrisma.systemErrorLog!.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resolved: true }),
        }),
      );
    });

    it("defaults to 30 days retention", async () => {
      (mockPrisma.systemErrorLog!.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      await service.cleanupOldErrors();

      const deleteCall = (mockPrisma.systemErrorLog!.deleteMany as jest.Mock)
        .mock.calls[0][0];
      const cutoff = deleteCall.where.createdAt.lt;
      const daysDiff = Math.round(
        (Date.now() - cutoff.getTime()) / (1000 * 60 * 60 * 24),
      );
      expect(daysDiff).toBe(30);
    });
  });

  // ==================== getErrorDetail ====================

  describe("getErrorDetail", () => {
    it("returns error detail by id", async () => {
      const errorLog = makeErrorLog();
      (mockPrisma.systemErrorLog!.findUnique as jest.Mock).mockResolvedValue(
        errorLog,
      );

      const result = await service.getErrorDetail("error-1");

      expect(result).toEqual(errorLog);
      expect(mockPrisma.systemErrorLog!.findUnique).toHaveBeenCalledWith({
        where: { id: "error-1" },
      });
    });

    it("returns null when error not found", async () => {
      (mockPrisma.systemErrorLog!.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.getErrorDetail("nonexistent");

      expect(result).toBeNull();
    });
  });
});
