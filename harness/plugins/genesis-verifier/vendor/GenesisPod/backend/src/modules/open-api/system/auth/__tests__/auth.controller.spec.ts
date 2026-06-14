/**
 * AuthController 单元测试
 *
 * 覆盖所有 9 个端点：
 * - POST /auth/register  (Public)
 * - POST /auth/login     (Public)
 * - POST /auth/refresh   (JWT)
 * - GET  /auth/me        (JWT)
 * - GET  /auth/google    (Google OAuth)
 * - GET  /auth/google/callback (Google OAuth)
 * - POST /auth/exchange  (Public)
 * - PATCH /auth/profile  (JWT)
 * - GET  /auth/stats     (JWT)
 */

// Module-level mocks to prevent transitive import failures
jest.mock("@nestjs/cache-manager", () => ({ CACHE_MANAGER: "CACHE_MANAGER" }));
jest.mock("cache-manager", () => ({}));
jest.mock("ioredis", () => ({}));

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthController } from "../auth.controller";
import { AuthService } from "@/modules/platform/auth/auth.service";
import { AdminAuthService } from "@/common/services";
import { RegisterDto } from "@/modules/open-api/system/auth/dto/register.dto";
import { LoginDto } from "@/modules/open-api/system/auth/dto/login.dto";
import { UpdateProfileDto } from "@/modules/open-api/system/auth/dto/update-profile.dto";

// ---------------------------------------------------------------------------
// Mock service factories
// ---------------------------------------------------------------------------

const mockAuthService = {
  register: jest.fn(),
  login: jest.fn(),
  refreshToken: jest.fn(),
  getFullProfile: jest.fn(),
  findOrCreateGoogleUser: jest.fn(),
  generateAuthCode: jest.fn(),
  exchangeAuthCode: jest.fn(),
  updateProfile: jest.fn(),
  getUserStats: jest.fn(),
};

const mockAdminAuthService = {
  isAdmin: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockImplementation((_key: string, defaultValue?: string) => {
    return defaultValue ?? "http://localhost:3000";
  }),
};

// ---------------------------------------------------------------------------
// Shared request/response helpers
// ---------------------------------------------------------------------------

const mockUserPayload = {
  id: "user-1",
  email: "test@example.com",
  username: "testuser",
};

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    ip: "127.0.0.1",
    headers: { "user-agent": "jest-test-agent" },
    user: mockUserPayload,
    ...overrides,
  };
}

function makeResponse() {
  return { redirect: jest.fn() };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("AuthController", () => {
  let controller: AuthController;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Reset configService mock to default behavior each test
    mockConfigService.get.mockImplementation(
      (_key: string, defaultValue?: string) =>
        defaultValue ?? "http://localhost:3000",
    );

    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ limit: 100, ttl: 60000 }])],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: AdminAuthService, useValue: mockAdminAuthService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    })
      // Bypass all Passport guards — guard logic is tested separately
      .overrideGuard(AuthGuard("jwt"))
      .useValue({ canActivate: () => true })
      .overrideGuard(AuthGuard("google"))
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  // -------------------------------------------------------------------------
  // register()
  // -------------------------------------------------------------------------

  describe("register()", () => {
    const dto: RegisterDto = {
      email: "newuser@example.com",
      username: "newuser",
      password: "StrongPass1",
    };

    const authResponse = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: {
        id: "user-1",
        email: dto.email,
        username: dto.username,
        role: "USER",
        createdAt: new Date(),
      },
    };

    it("should call authService.register with email, username and password", async () => {
      mockAuthService.register.mockResolvedValue(authResponse);

      const result = await controller.register(dto);

      expect(mockAuthService.register).toHaveBeenCalledWith(
        dto.email,
        dto.username,
        dto.password,
      );
      expect(result).toEqual(authResponse);
    });

    it("should propagate errors thrown by authService.register", async () => {
      mockAuthService.register.mockRejectedValue(
        new Error("Email already exists"),
      );

      await expect(controller.register(dto)).rejects.toThrow(
        "Email already exists",
      );
    });

    it("should propagate conflict errors (duplicate email/username)", async () => {
      const conflictError = Object.assign(new Error("Conflict"), {
        status: 409,
      });
      mockAuthService.register.mockRejectedValue(conflictError);

      await expect(controller.register(dto)).rejects.toThrow("Conflict");
    });
  });

  // -------------------------------------------------------------------------
  // login()
  // -------------------------------------------------------------------------

  describe("login()", () => {
    const dto: LoginDto = {
      email: "user@example.com",
      password: "password123",
    };

    const authResponse = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: {
        id: "user-1",
        email: dto.email,
        username: "testuser",
        role: "USER",
        createdAt: new Date(),
      },
    };

    it("should call authService.login with email, password and requestInfo from headers", async () => {
      mockAuthService.login.mockResolvedValue(authResponse);
      const req = makeRequest({
        headers: {
          "user-agent": "Mozilla/5.0",
          "x-forwarded-for": "203.0.113.1, 10.0.0.1",
        },
        ip: "127.0.0.1",
      });

      const result = await controller.login(req as never, dto);

      // x-forwarded-for first segment takes precedence over req.ip
      expect(mockAuthService.login).toHaveBeenCalledWith(
        dto.email,
        dto.password,
        {
          ipAddress: "203.0.113.1",
          userAgent: "Mozilla/5.0",
        },
      );
      expect(result).toEqual(authResponse);
    });

    it("should fall back to req.ip when x-forwarded-for header is absent", async () => {
      mockAuthService.login.mockResolvedValue(authResponse);
      const req = makeRequest({
        headers: { "user-agent": "jest-agent" },
        ip: "10.10.10.10",
      });

      await controller.login(req as never, dto);

      expect(mockAuthService.login).toHaveBeenCalledWith(
        dto.email,
        dto.password,
        {
          ipAddress: "10.10.10.10",
          userAgent: "jest-agent",
        },
      );
    });

    it("should propagate UnauthorizedException on invalid credentials", async () => {
      mockAuthService.login.mockRejectedValue(
        new UnauthorizedException("Invalid credentials"),
      );
      const req = makeRequest();

      await expect(controller.login(req as never, dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // refresh()
  // -------------------------------------------------------------------------

  describe("refresh()", () => {
    const refreshResponse = {
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
    };

    it("should call authService.refreshToken with req.user.id", async () => {
      mockAuthService.refreshToken.mockResolvedValue(refreshResponse);
      const req = { user: { id: "user-1" } };

      const result = await controller.refresh(req);

      expect(mockAuthService.refreshToken).toHaveBeenCalledWith("user-1");
      expect(result).toEqual(refreshResponse);
    });

    it("should propagate errors from authService.refreshToken", async () => {
      mockAuthService.refreshToken.mockRejectedValue(
        new UnauthorizedException("Token expired"),
      );
      const req = { user: { id: "user-1" } };

      await expect(controller.refresh(req)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // getProfile() — GET /auth/me
  // -------------------------------------------------------------------------

  describe("getProfile()", () => {
    const fullProfile = {
      id: "user-1",
      email: "test@example.com",
      username: "testuser",
      role: "USER",
      fullName: "Test User",
      avatarUrl: null,
      bio: null,
      createdAt: new Date(),
    };

    it("should return profile merged with isAdmin flag when user found", async () => {
      mockAuthService.getFullProfile.mockResolvedValue(fullProfile);
      mockAdminAuthService.isAdmin.mockReturnValue(false);
      const req = { user: { id: "user-1" } };

      const result = await controller.getProfile(req);

      expect(mockAuthService.getFullProfile).toHaveBeenCalledWith("user-1");
      expect(mockAdminAuthService.isAdmin).toHaveBeenCalledWith(fullProfile);
      expect(result).toEqual({ ...fullProfile, isAdmin: false });
    });

    it("should set isAdmin: true for admin users", async () => {
      const adminProfile = { ...fullProfile, role: "ADMIN" };
      mockAuthService.getFullProfile.mockResolvedValue(adminProfile);
      mockAdminAuthService.isAdmin.mockReturnValue(true);
      const req = { user: { id: "user-1" } };

      const result = await controller.getProfile(req);

      expect(result).toEqual({ ...adminProfile, isAdmin: true });
    });

    it("should return req.user directly when getFullProfile returns null", async () => {
      mockAuthService.getFullProfile.mockResolvedValue(null);
      const req = {
        user: { id: "user-1", email: "test@example.com", username: "testuser" },
      };

      const result = await controller.getProfile(req);

      expect(result).toEqual(req.user);
      expect(mockAdminAuthService.isAdmin).not.toHaveBeenCalled();
    });

    it("should propagate errors from authService.getFullProfile", async () => {
      mockAuthService.getFullProfile.mockRejectedValue(new Error("DB error"));
      const req = { user: { id: "user-1" } };

      await expect(controller.getProfile(req)).rejects.toThrow("DB error");
    });
  });

  // -------------------------------------------------------------------------
  // googleAuth() — GET /auth/google
  // -------------------------------------------------------------------------

  describe("googleAuth()", () => {
    it("should exist and return undefined (guard handles redirect)", async () => {
      const result = await controller.googleAuth();
      expect(result).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // googleAuthCallback() — GET /auth/google/callback
  // -------------------------------------------------------------------------

  describe("googleAuthCallback()", () => {
    const googleUser = { email: "oauth@example.com", id: "user-google-1" };
    const oauthTokens = {
      accessToken: "g-access-token",
      refreshToken: "g-refresh-token",
    };

    it("should generate auth code and redirect to frontend callback URL", async () => {
      mockAuthService.generateAuthCode.mockResolvedValue("auth-code-abc123");
      const req = makeRequest({
        user: { user: googleUser, ...oauthTokens },
      });
      const res = makeResponse();

      mockConfigService.get.mockImplementation(
        (key: string, defaultValue?: string) =>
          key === "FRONTEND_URL"
            ? "https://app.example.com"
            : (defaultValue ?? "http://localhost:3000"),
      );

      await controller.googleAuthCallback(req as never, res as never);

      expect(mockAuthService.generateAuthCode).toHaveBeenCalledWith(
        oauthTokens.accessToken,
        oauthTokens.refreshToken,
        googleUser.id,
      );
      expect(res.redirect).toHaveBeenCalledWith(
        "https://app.example.com/auth/callback?code=auth-code-abc123",
      );
    });

    it("should fall back to localhost:3000 when FRONTEND_URL is not set", async () => {
      mockAuthService.generateAuthCode.mockResolvedValue("auth-code-xyz");
      const req = makeRequest({
        user: { user: googleUser, ...oauthTokens },
      });
      const res = makeResponse();

      // ConfigService returns defaultValue when key is not configured

      await controller.googleAuthCallback(req as never, res as never);

      expect(res.redirect).toHaveBeenCalledWith(
        "http://localhost:3000/auth/callback?code=auth-code-xyz",
      );
    });

    it("should propagate errors from authService.generateAuthCode", async () => {
      mockAuthService.generateAuthCode.mockRejectedValue(
        new Error("Redis unavailable"),
      );
      const req = makeRequest({
        user: { user: googleUser, ...oauthTokens },
      });
      const res = makeResponse();

      await expect(
        controller.googleAuthCallback(req as never, res as never),
      ).rejects.toThrow("Redis unavailable");
    });
  });

  // -------------------------------------------------------------------------
  // exchangeAuthCode() — POST /auth/exchange
  // -------------------------------------------------------------------------

  describe("exchangeAuthCode()", () => {
    const exchangeResponse = {
      accessToken: "exchanged-access",
      refreshToken: "exchanged-refresh",
      user: {
        id: "user-1",
        email: "test@example.com",
        username: "testuser",
        role: "USER",
        createdAt: new Date(),
      },
    };

    it("should call authService.exchangeAuthCode with the code string", async () => {
      mockAuthService.exchangeAuthCode.mockResolvedValue(exchangeResponse);

      const result = await controller.exchangeAuthCode("auth-code-abc123");

      expect(mockAuthService.exchangeAuthCode).toHaveBeenCalledWith(
        "auth-code-abc123",
      );
      expect(result).toEqual(exchangeResponse);
    });

    it("should propagate error when the auth code is invalid or expired", async () => {
      mockAuthService.exchangeAuthCode.mockRejectedValue(
        new UnauthorizedException("Code expired"),
      );

      await expect(controller.exchangeAuthCode("expired-code")).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // updateProfile() — PATCH /auth/profile
  // -------------------------------------------------------------------------

  describe("updateProfile()", () => {
    const dto: UpdateProfileDto = {
      username: "updated-user",
      fullName: "Updated Name",
      bio: "My bio",
    };

    const updatedUser = {
      id: "user-1",
      email: "test@example.com",
      username: "updated-user",
      fullName: "Updated Name",
      bio: "My bio",
      role: "USER",
      createdAt: new Date(),
    };

    it("should call authService.updateProfile with req.user.id and dto", async () => {
      mockAuthService.updateProfile.mockResolvedValue(updatedUser);
      const req = { user: { id: "user-1" } };

      const result = await controller.updateProfile(req, dto);

      expect(mockAuthService.updateProfile).toHaveBeenCalledWith("user-1", dto);
      expect(result).toEqual(updatedUser);
    });

    it("should handle partial profile updates (only username)", async () => {
      const partialDto: UpdateProfileDto = { username: "new-username" };
      const partialResult = { ...updatedUser, username: "new-username" };
      mockAuthService.updateProfile.mockResolvedValue(partialResult);
      const req = { user: { id: "user-1" } };

      const result = await controller.updateProfile(req, partialDto);

      expect(mockAuthService.updateProfile).toHaveBeenCalledWith(
        "user-1",
        partialDto,
      );
      expect(result).toEqual(partialResult);
    });

    it("should propagate errors from authService.updateProfile", async () => {
      mockAuthService.updateProfile.mockRejectedValue(
        new Error("Username already taken"),
      );
      const req = { user: { id: "user-1" } };

      await expect(controller.updateProfile(req, dto)).rejects.toThrow(
        "Username already taken",
      );
    });
  });

  // -------------------------------------------------------------------------
  // getUserStats() — GET /auth/stats
  // -------------------------------------------------------------------------

  describe("getUserStats()", () => {
    const statsResponse = {
      resourcesCount: 10,
      researchCount: 3,
      teamsCount: 2,
      uploadsCount: 5,
    };

    it("should call authService.getUserStats with req.user.id", async () => {
      mockAuthService.getUserStats.mockResolvedValue(statsResponse);
      const req = { user: { id: "user-1" } };

      const result = await controller.getUserStats(req);

      expect(mockAuthService.getUserStats).toHaveBeenCalledWith("user-1");
      expect(result).toEqual(statsResponse);
    });

    it("should return zero counts for a new user", async () => {
      const emptyStats = {
        resourcesCount: 0,
        researchCount: 0,
        teamsCount: 0,
        uploadsCount: 0,
      };
      mockAuthService.getUserStats.mockResolvedValue(emptyStats);
      const req = { user: { id: "new-user-1" } };

      const result = await controller.getUserStats(req);

      expect(result).toEqual(emptyStats);
    });

    it("should propagate errors from authService.getUserStats", async () => {
      mockAuthService.getUserStats.mockRejectedValue(
        new Error("User not found"),
      );
      const req = { user: { id: "ghost-user" } };

      await expect(controller.getUserStats(req)).rejects.toThrow(
        "User not found",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Controller bootstrap sanity
  // -------------------------------------------------------------------------

  describe("controller definition", () => {
    it("should be defined", () => {
      expect(controller).toBeDefined();
    });
  });
});
