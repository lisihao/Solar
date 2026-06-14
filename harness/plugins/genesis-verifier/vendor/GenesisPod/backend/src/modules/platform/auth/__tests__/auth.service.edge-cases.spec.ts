/**
 * AuthService Edge Case Unit Tests
 *
 * Covers auth edge cases and smaller helper branches:
 * - register() - user registration with credit account creation
 * - login() - authentication with login history recording
 * - refreshToken() - token refresh
 * - validateUser() - user validation
 * - getFullProfile() - full profile retrieval
 * - findOrCreateGoogleUser() - Google OAuth flow
 * - updateProfile() - profile updates with interests and preferences
 * - getUserStats() - user statistics aggregation
 * - generateAuthCode() / exchangeAuthCode() - auth code exchange flow
 * - parseUserAgent() - device/browser/OS detection (via login)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { AuthService, LoginRequestInfo } from "../auth.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  CacheService,
  CachePrefix,
} from "../../../../common/cache/cache.service";

// ---------------------------------------------------------------------------
// Top-level jest.mock for bcrypt and crypto to avoid ESM issues
// ---------------------------------------------------------------------------
jest.mock("bcrypt", () => ({
  hash: jest.fn().mockResolvedValue("hashed-password"),
  compare: jest.fn().mockResolvedValue(true),
}));
jest.mock("crypto", () => ({
  ...jest.requireActual("crypto"),
  randomBytes: jest
    .fn()
    .mockReturnValue({ toString: () => "mock-auth-code-32hex" }),
}));

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  user: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  creditAccount: {
    create: jest.fn(),
  },
  loginHistory: {
    create: jest.fn(),
  },
  userInterest: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  userActivity: {
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  comment: {
    count: jest.fn(),
  },
  note: {
    count: jest.fn(),
  },
  report: {
    count: jest.fn(),
  },
  askSession: {
    count: jest.fn(),
  },
  topic: {
    count: jest.fn(),
  },
  generatedImage: {
    count: jest.fn(),
  },
};

// ---------------------------------------------------------------------------
// CacheService mock
// ---------------------------------------------------------------------------
const mockCacheService = {
  buildKey: jest.fn((prefix: string, key: string) => `${prefix}:${key}`),
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
};

// ---------------------------------------------------------------------------
// JwtService mock
// ---------------------------------------------------------------------------
const mockJwtService = {
  sign: jest.fn().mockReturnValue("mock.jwt.token"),
};

// ---------------------------------------------------------------------------
// ConfigService mock
// ---------------------------------------------------------------------------
const mockConfigService = {
  get: jest.fn().mockReturnValue("mock-secret"),
};

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------
function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "test@example.com",
    username: "testuser",
    fullName: "Test User",
    avatarUrl: "https://avatar.example.com/test.jpg",
    bio: "A test user",
    role: "USER",
    passwordHash: "hashed-password",
    oauthProvider: null,
    oauthId: null,
    isVerified: false,
    isActive: true,
    createdAt: new Date("2024-01-01"),
    lastLoginAt: null,
    preferences: null,
    interests: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("AuthService (edge cases)", () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Reset bcrypt mock after clearAllMocks
    const bcrypt = await import("bcrypt");
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue("hashed-password");

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // =========================================================================
  // register()
  // =========================================================================
  describe("register()", () => {
    it("should register a new user and return tokens", async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      const newUser = makeUser();
      mockPrisma.user.create.mockResolvedValue(newUser);
      mockPrisma.creditAccount.create.mockResolvedValue({});

      const result = await service.register(
        "test@example.com",
        "testuser",
        "password123",
      );

      expect(result.user).toBeDefined();
      expect(result.accessToken).toBe("mock.jwt.token");
      expect(result.refreshToken).toBe("mock.jwt.token");
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: "test@example.com",
            username: "testuser",
          }),
        }),
      );
    });

    it("should throw ConflictException if user already exists", async () => {
      mockPrisma.user.findFirst.mockResolvedValue(makeUser());

      await expect(
        service.register("test@example.com", "testuser", "password123"),
      ).rejects.toThrow(ConflictException);
    });

    it("should continue registration even if credit account creation fails", async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(makeUser());
      mockPrisma.creditAccount.create.mockRejectedValue(
        new Error("Credit account creation failed"),
      );

      const result = await service.register(
        "test@example.com",
        "testuser",
        "password123",
      );

      expect(result.user).toBeDefined();
      expect(result.accessToken).toBeDefined();
    });
  });

  // =========================================================================
  // login()
  // =========================================================================
  describe("login()", () => {
    it("should login a user with valid credentials", async () => {
      const user = makeUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue(user);
      mockPrisma.loginHistory.create.mockResolvedValue({});

      const bcrypt = await import("bcrypt");
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login("test@example.com", "password123");

      expect(result.user.email).toBe("test@example.com");
      expect(result.accessToken).toBe("mock.jwt.token");
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: user.id },
          data: expect.objectContaining({ isActive: true }),
        }),
      );
    });

    it("should throw UnauthorizedException if user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login("notfound@example.com", "password"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException if password is invalid", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(makeUser());
      const bcrypt = await import("bcrypt");
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login("test@example.com", "wrong-password"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should record login history with request info", async () => {
      const user = makeUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue(user);
      mockPrisma.loginHistory.create.mockResolvedValue({});

      const requestInfo: LoginRequestInfo = {
        ipAddress: "127.0.0.1",
        userAgent: "Mozilla/5.0 Chrome/120.0",
      };

      await service.login("test@example.com", "password123", requestInfo);

      expect(mockPrisma.loginHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ipAddress: "127.0.0.1",
            browser: "Chrome",
          }),
        }),
      );
    });

    it("should not fail login if login history recording fails", async () => {
      const user = makeUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue(user);
      mockPrisma.loginHistory.create.mockRejectedValue(new Error("DB error"));

      const result = await service.login("test@example.com", "password123");

      expect(result.user).toBeDefined();
    });

    it("should detect mobile user agent", async () => {
      const user = makeUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue(user);
      mockPrisma.loginHistory.create.mockResolvedValue({});

      const requestInfo: LoginRequestInfo = {
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36",
      };

      await service.login("test@example.com", "password123", requestInfo);

      expect(mockPrisma.loginHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            device: "mobile",
          }),
        }),
      );
    });

    it("should detect tablet user agent", async () => {
      const user = makeUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue(user);
      mockPrisma.loginHistory.create.mockResolvedValue({});

      const requestInfo: LoginRequestInfo = {
        userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1",
      };

      await service.login("test@example.com", "password123", requestInfo);

      expect(mockPrisma.loginHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            device: "tablet",
          }),
        }),
      );
    });

    it("should detect Firefox browser", async () => {
      const user = makeUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue(user);
      mockPrisma.loginHistory.create.mockResolvedValue({});

      await service.login("test@example.com", "password123", {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/120.0",
      });

      expect(mockPrisma.loginHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ browser: "Firefox" }),
        }),
      );
    });

    it("should detect Edge browser", async () => {
      const user = makeUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue(user);
      mockPrisma.loginHistory.create.mockResolvedValue({});

      await service.login("test@example.com", "password123", {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120.0",
      });

      expect(mockPrisma.loginHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ browser: "Edge" }),
        }),
      );
    });

    it("should handle no user agent gracefully", async () => {
      const user = makeUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.user.update.mockResolvedValue(user);
      mockPrisma.loginHistory.create.mockResolvedValue({});

      await service.login("test@example.com", "password123", {});

      expect(mockPrisma.loginHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            device: "unknown",
            browser: "unknown",
            os: "unknown",
          }),
        }),
      );
    });
  });

  // =========================================================================
  // refreshToken()
  // =========================================================================
  describe("refreshToken()", () => {
    it("should return new tokens for valid user", async () => {
      const user = makeUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const result = await service.refreshToken("user-1");

      expect(result.accessToken).toBe("mock.jwt.token");
      expect(result.refreshToken).toBe("mock.jwt.token");
    });

    it("should throw UnauthorizedException if user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.refreshToken("nonexistent")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("should throw UnauthorizedException if user has no email", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: null,
        username: "testuser",
      });

      await expect(service.refreshToken("user-1")).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // =========================================================================
  // validateUser()
  // =========================================================================
  describe("validateUser()", () => {
    it("should return user if found", async () => {
      const user = makeUser();
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const result = await service.validateUser("user-1");

      expect(result).toBeDefined();
      expect(result?.id).toBe("user-1");
    });

    it("should return null if user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.validateUser("nonexistent");

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getFullProfile()
  // =========================================================================
  describe("getFullProfile()", () => {
    it("should return full profile with interests mapped", async () => {
      const user = makeUser({
        interests: [{ tag: "AI" }, { tag: "ML" }],
      });
      mockPrisma.user.findUnique.mockResolvedValue(user);

      const result = await service.getFullProfile("user-1");

      expect(result).not.toBeNull();
      expect(result?.interests).toEqual(["AI", "ML"]);
      expect(result?.email).toBe("test@example.com");
    });

    it("should return null if user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.getFullProfile("nonexistent");

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // findOrCreateGoogleUser()
  // =========================================================================
  describe("findOrCreateGoogleUser()", () => {
    const googleProfile = {
      id: "google-123",
      email: "google@example.com",
      displayName: "Google User",
      picture: "https://lh3.googleusercontent.com/photo.jpg",
    };

    it("should create a new Google user if not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null); // findUnique for findOrCreate
      const newUser = makeUser({
        email: googleProfile.email,
        username: googleProfile.displayName,
        oauthProvider: "google",
        oauthId: googleProfile.id,
        avatarUrl: googleProfile.picture,
        isVerified: true,
      });
      mockPrisma.user.create.mockResolvedValue(newUser);
      mockPrisma.creditAccount.create.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue(newUser);
      mockPrisma.loginHistory.create.mockResolvedValue({});

      const result = await service.findOrCreateGoogleUser(googleProfile);

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: googleProfile.email,
            oauthProvider: "google",
            isVerified: true,
          }),
        }),
      );
      expect(result.accessToken).toBe("mock.jwt.token");
    });

    it("should link existing user with Google if oauthId missing", async () => {
      const existingUser = makeUser({
        email: googleProfile.email,
        oauthId: null,
        oauthProvider: null,
      });
      const updatedUser = makeUser({
        ...existingUser,
        oauthProvider: "google",
        oauthId: googleProfile.id,
      });

      mockPrisma.user.findUnique.mockResolvedValueOnce(existingUser);
      mockPrisma.user.update
        .mockResolvedValueOnce(updatedUser) // link google
        .mockResolvedValueOnce(updatedUser); // update lastLoginAt
      mockPrisma.loginHistory.create.mockResolvedValue({});

      const result = await service.findOrCreateGoogleUser(googleProfile);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            oauthProvider: "google",
            oauthId: googleProfile.id,
          }),
        }),
      );
      expect(result.accessToken).toBeDefined();
    });

    it("should skip re-linking if user already has Google OAuth", async () => {
      const existingUser = makeUser({
        email: googleProfile.email,
        oauthProvider: "google",
        oauthId: "google-123",
      });
      mockPrisma.user.findUnique.mockResolvedValueOnce(existingUser);
      mockPrisma.user.update.mockResolvedValue(existingUser);
      mockPrisma.loginHistory.create.mockResolvedValue({});

      await service.findOrCreateGoogleUser(googleProfile);

      // Should call update for lastLoginAt only, not for linking
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastLoginAt: expect.any(Date),
            isActive: true,
          }),
        }),
      );
    });

    it("should continue even if credit account creation fails for Google user", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.user.create.mockResolvedValue(
        makeUser({ email: googleProfile.email }),
      );
      mockPrisma.creditAccount.create.mockRejectedValue(new Error("DB error"));
      mockPrisma.user.update.mockResolvedValue(makeUser());
      mockPrisma.loginHistory.create.mockResolvedValue({});

      const result = await service.findOrCreateGoogleUser(googleProfile);

      expect(result.accessToken).toBeDefined();
    });
  });

  // =========================================================================
  // updateProfile()
  // =========================================================================
  describe("updateProfile()", () => {
    it("should update basic profile fields", async () => {
      const updatedUser = makeUser({ bio: "Updated bio" });
      mockPrisma.user.update.mockResolvedValue({
        ...updatedUser,
        interests: [{ tag: "AI" }],
      });

      const result = await service.updateProfile("user-1", {
        bio: "Updated bio",
      });

      expect(result.bio).toBe("Updated bio");
      expect(result.interests).toEqual(["AI"]);
    });

    it("should throw ConflictException if username already exists for another user", async () => {
      mockPrisma.user.findFirst.mockResolvedValue(
        makeUser({ id: "other-user" }),
      );

      await expect(
        service.updateProfile("user-1", { username: "takenname" }),
      ).rejects.toThrow(ConflictException);
    });

    it("should allow updating to same username (own username)", async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null); // no conflict
      const updatedUser = makeUser({ username: "testuser" });
      mockPrisma.user.update.mockResolvedValue({
        ...updatedUser,
        interests: [],
      });

      const result = await service.updateProfile("user-1", {
        username: "testuser",
      });

      expect(result.username).toBe("testuser");
    });

    it("should update interests by deleting old and creating new", async () => {
      mockPrisma.userInterest.deleteMany.mockResolvedValue({});
      mockPrisma.userInterest.createMany.mockResolvedValue({});
      const updatedUser = makeUser();
      mockPrisma.user.update.mockResolvedValue({
        ...updatedUser,
        interests: [{ tag: "AI" }, { tag: "ML" }],
      });

      await service.updateProfile("user-1", { interests: ["AI", "ML"] });

      expect(mockPrisma.userInterest.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
      });
      expect(mockPrisma.userInterest.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            { userId: "user-1", tag: "AI", source: "manual" },
            { userId: "user-1", tag: "ML", source: "manual" },
          ],
        }),
      );
    });

    it("should not call createMany if interests array is empty", async () => {
      mockPrisma.userInterest.deleteMany.mockResolvedValue({});
      const updatedUser = makeUser();
      mockPrisma.user.update.mockResolvedValue({
        ...updatedUser,
        interests: [],
      });

      await service.updateProfile("user-1", { interests: [] });

      expect(mockPrisma.userInterest.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.userInterest.createMany).not.toHaveBeenCalled();
    });

    it("should merge existing preferences with new ones", async () => {
      const existingUser = makeUser({
        preferences: {
          language: "zh",
          timezone: "Asia/Shanghai",
          theme: "dark",
        },
      });
      mockPrisma.user.findUnique.mockResolvedValue(existingUser);
      const updatedUser = makeUser();
      mockPrisma.user.update.mockResolvedValue({
        ...updatedUser,
        interests: [],
        preferences: {
          language: "en",
          timezone: "Asia/Shanghai",
          theme: "dark",
        },
      });

      await service.updateProfile("user-1", {
        preferences: { language: "en" },
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            preferences: {
              language: "en",
              timezone: "Asia/Shanghai",
              theme: "dark",
            },
          }),
        }),
      );
    });
  });

  // =========================================================================
  // getUserStats()
  // =========================================================================
  describe("getUserStats()", () => {
    it("should return aggregated user statistics", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        makeUser({ createdAt: new Date("2024-01-01") }),
      );
      mockPrisma.userActivity.count
        .mockResolvedValueOnce(5) // bookmarked
        .mockResolvedValueOnce(20) // viewed
        .mockResolvedValueOnce(3); // recent
      mockPrisma.comment.count.mockResolvedValue(2);
      mockPrisma.note.count.mockResolvedValue(4);
      mockPrisma.report.count.mockResolvedValue(1);
      mockPrisma.askSession.count.mockResolvedValue(10);
      mockPrisma.topic.count.mockResolvedValue(3);
      mockPrisma.generatedImage.count.mockResolvedValue(8);
      mockPrisma.userActivity.groupBy.mockResolvedValue([
        { activityType: "SAVE", _count: 5 },
        { activityType: "VIEW", _count: 20 },
      ]);

      const result = await service.getUserStats("user-1");

      expect(result.stats.bookmarked).toBe(5);
      expect(result.stats.viewed).toBe(20);
      expect(result.stats.comments).toBe(2);
      expect(result.stats.notes).toBe(4);
      expect(result.stats.reports).toBe(1);
      expect(result.stats.chatSessions).toBe(10);
      expect(result.stats.topicsCreated).toBe(3);
      expect(result.stats.imagesGenerated).toBe(8);
      expect(result.activity.recentActivityCount).toBe(3);
      expect(result.activity.breakdown).toHaveLength(2);
    });

    it("should throw UnauthorizedException if user not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserStats("nonexistent")).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // =========================================================================
  // generateAuthCode() / exchangeAuthCode()
  // =========================================================================
  describe("generateAuthCode() and exchangeAuthCode()", () => {
    it("should generate an auth code and store it in cache", async () => {
      mockCacheService.set.mockResolvedValue(undefined);

      const code = await service.generateAuthCode(
        "access-token",
        "refresh-token",
        "user-1",
      );

      expect(code).toBe("mock-auth-code-32hex");
      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.stringContaining("mock-auth-code-32hex"),
        expect.objectContaining({
          accessToken: "access-token",
          refreshToken: "refresh-token",
          userId: "user-1",
        }),
        300,
      );
    });

    it("should exchange a valid auth code for tokens", async () => {
      mockCacheService.get.mockResolvedValue({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        userId: "user-1",
        expiresAt: new Date(),
      });
      mockCacheService.del.mockResolvedValue(undefined);

      const result = await service.exchangeAuthCode("valid-code");

      expect(result.accessToken).toBe("access-token");
      expect(result.refreshToken).toBe("refresh-token");
      expect(mockCacheService.del).toHaveBeenCalled();
    });

    it("should throw UnauthorizedException for invalid/expired auth code", async () => {
      mockCacheService.get.mockResolvedValue(null);

      await expect(service.exchangeAuthCode("invalid-code")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("should delete auth code after successful exchange (one-time use)", async () => {
      mockCacheService.get.mockResolvedValue({
        accessToken: "token",
        refreshToken: "rtoken",
        userId: "user-1",
        expiresAt: new Date(),
      });
      mockCacheService.del.mockResolvedValue(undefined);

      await service.exchangeAuthCode("one-time-code");

      expect(mockCacheService.del).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // generateTokens() - indirectly via generateAuthCode flow
  // =========================================================================
  describe("token generation", () => {
    it("should use REFRESH_TOKEN_SECRET when available", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "JWT_SECRET") return "jwt-secret";
        if (key === "REFRESH_TOKEN_SECRET") return "refresh-secret";
        return null;
      });

      mockPrisma.user.findUnique.mockResolvedValue(makeUser());

      await service.refreshToken("user-1");

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ secret: "refresh-secret" }),
      );
    });

    it("should fall back to JWT_SECRET + -refresh if REFRESH_TOKEN_SECRET not set", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "JWT_SECRET") return "jwt-secret";
        return null; // REFRESH_TOKEN_SECRET not set
      });

      mockPrisma.user.findUnique.mockResolvedValue(makeUser());

      await service.refreshToken("user-1");

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ secret: "jwt-secret-refresh" }),
      );
    });

    it("should use email prefix as username when username is null", async () => {
      const userNoUsername = makeUser({ username: null });
      mockPrisma.user.findUnique.mockResolvedValue(userNoUsername);

      await service.refreshToken("user-1");

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ username: "test" }),
        expect.any(Object),
      );
    });
  });

  // =========================================================================
  // CacheService.buildKey usage
  // =========================================================================
  describe("cache key building", () => {
    it("should use AUTH_CODE prefix for auth code keys", async () => {
      mockCacheService.set.mockResolvedValue(undefined);

      await service.generateAuthCode("at", "rt", "u1");

      expect(mockCacheService.buildKey).toHaveBeenCalledWith(
        CachePrefix.AUTH_CODE,
        expect.any(String),
      );
    });
  });
});
