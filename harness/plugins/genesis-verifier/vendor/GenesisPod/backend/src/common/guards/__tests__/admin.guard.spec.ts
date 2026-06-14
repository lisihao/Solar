/**
 * AdminGuard unit tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException, Logger } from "@nestjs/common";
import { AdminGuard } from "../admin.guard";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminAuthService } from "../../services";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockExecutionContext(overrides?: { user?: unknown }) {
  const request = {
    user: overrides?.user ?? undefined,
    isAdmin: false,
  };

  return {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(request),
      getResponse: jest.fn(),
    }),
    getHandler: jest.fn(),
    getClass: jest.fn(),
    _request: request,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AdminGuard", () => {
  let guard: AdminGuard;
  let mockPrisma: jest.Mocked<Pick<PrismaService, "user">>;
  let mockAdminAuthService: jest.Mocked<
    Pick<AdminAuthService, "isAdmin" | "getAdminEmailCount">
  >;

  beforeEach(async () => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
      } as unknown as jest.Mocked<PrismaService["user"]>,
    };

    mockAdminAuthService = {
      isAdmin: jest.fn(),
      getAdminEmailCount: jest.fn().mockReturnValue(2),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminGuard,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AdminAuthService, useValue: mockAdminAuthService },
      ],
    }).compile();

    guard = module.get<AdminGuard>(AdminGuard);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // canActivate — missing user
  // -------------------------------------------------------------------------

  describe("when request has no user (unauthenticated)", () => {
    it("throws ForbiddenException with 'Authentication required'", async () => {
      const ctx = createMockExecutionContext({ user: undefined });

      await expect(
        guard.canActivate(
          ctx as unknown as import("@nestjs/common").ExecutionContext,
        ),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        guard.canActivate(
          ctx as unknown as import("@nestjs/common").ExecutionContext,
        ),
      ).rejects.toThrow("Authentication required");
    });

    it("does not query the database when user is absent", async () => {
      const ctx = createMockExecutionContext({ user: undefined });

      try {
        await guard.canActivate(
          ctx as unknown as import("@nestjs/common").ExecutionContext,
        );
      } catch {
        // expected
      }

      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // canActivate — user not in database
  // -------------------------------------------------------------------------

  describe("when user is authenticated but not found in database", () => {
    it("throws ForbiddenException with 'User not found'", async () => {
      const ctx = createMockExecutionContext({ user: { id: "ghost-user" } });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        guard.canActivate(
          ctx as unknown as import("@nestjs/common").ExecutionContext,
        ),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        guard.canActivate(
          ctx as unknown as import("@nestjs/common").ExecutionContext,
        ),
      ).rejects.toThrow("User not found");
    });

    it("queries the database with the correct user id", async () => {
      const ctx = createMockExecutionContext({ user: { id: "user-abc" } });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      try {
        await guard.canActivate(
          ctx as unknown as import("@nestjs/common").ExecutionContext,
        );
      } catch {
        // expected
      }

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-abc" },
        select: { role: true, email: true },
      });
    });
  });

  // -------------------------------------------------------------------------
  // canActivate — user is not admin
  // -------------------------------------------------------------------------

  describe("when user exists but is not an admin", () => {
    it("throws ForbiddenException with 'Admin access required'", async () => {
      const ctx = createMockExecutionContext({ user: { id: "user-123" } });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        role: "USER",
        email: "user@example.com",
      });
      mockAdminAuthService.isAdmin.mockReturnValue(false);

      await expect(
        guard.canActivate(
          ctx as unknown as import("@nestjs/common").ExecutionContext,
        ),
      ).rejects.toThrow("Admin access required");
    });

    it("logs a warning when access is denied", async () => {
      const ctx = createMockExecutionContext({ user: { id: "user-123" } });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        role: "USER",
        email: "user@example.com",
      });
      mockAdminAuthService.isAdmin.mockReturnValue(false);

      try {
        await guard.canActivate(
          ctx as unknown as import("@nestjs/common").ExecutionContext,
        );
      } catch {
        // expected
      }

      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining("Admin access denied"),
      );
    });

    it("does not set isAdmin on the request object", async () => {
      const ctx = createMockExecutionContext({ user: { id: "user-123" } });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        role: "USER",
        email: "user@example.com",
      });
      mockAdminAuthService.isAdmin.mockReturnValue(false);

      try {
        await guard.canActivate(
          ctx as unknown as import("@nestjs/common").ExecutionContext,
        );
      } catch {
        // expected
      }

      expect(ctx._request.isAdmin).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // canActivate — successful admin access
  // -------------------------------------------------------------------------

  describe("when user is an admin", () => {
    it("returns true", async () => {
      const ctx = createMockExecutionContext({ user: { id: "admin-1" } });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        role: "ADMIN",
        email: "admin@example.com",
      });
      mockAdminAuthService.isAdmin.mockReturnValue(true);

      const result = await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(result).toBe(true);
    });

    it("sets request.isAdmin = true on the request object", async () => {
      const ctx = createMockExecutionContext({ user: { id: "admin-1" } });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        role: "ADMIN",
        email: "admin@example.com",
      });
      mockAdminAuthService.isAdmin.mockReturnValue(true);

      await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(ctx._request.isAdmin).toBe(true);
    });

    it("calls adminAuthService.isAdmin with the db user object", async () => {
      const dbUser = { role: "ADMIN", email: "admin@example.com" };
      const ctx = createMockExecutionContext({ user: { id: "admin-1" } });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(dbUser);
      mockAdminAuthService.isAdmin.mockReturnValue(true);

      await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(mockAdminAuthService.isAdmin).toHaveBeenCalledWith(dbUser);
    });

    it("does not log a warning when access is granted", async () => {
      const ctx = createMockExecutionContext({ user: { id: "admin-1" } });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        role: "ADMIN",
        email: "admin@example.com",
      });
      mockAdminAuthService.isAdmin.mockReturnValue(true);

      await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(Logger.prototype.warn).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // AdminAuthService.getAdminEmailCount used in warning message
  // -------------------------------------------------------------------------

  describe("warning message includes admin email count", () => {
    it("calls getAdminEmailCount when denying access", async () => {
      const ctx = createMockExecutionContext({ user: { id: "user-x" } });
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
        role: "USER",
        email: "user@example.com",
      });
      mockAdminAuthService.isAdmin.mockReturnValue(false);
      mockAdminAuthService.getAdminEmailCount.mockReturnValue(5);

      try {
        await guard.canActivate(
          ctx as unknown as import("@nestjs/common").ExecutionContext,
        );
      } catch {
        // expected
      }

      expect(mockAdminAuthService.getAdminEmailCount).toHaveBeenCalled();
    });
  });
});
