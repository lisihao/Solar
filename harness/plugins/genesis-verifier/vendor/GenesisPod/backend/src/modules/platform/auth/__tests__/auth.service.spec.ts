import { Test, TestingModule } from "@nestjs/testing";
import { AuthService } from "../auth.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { JwtService } from "@nestjs/jwt";
import { CacheService } from "../../../../common/cache/cache.service";
import { ConfigService } from "@nestjs/config";
import { UnauthorizedException, ConflictException } from "@nestjs/common";
import * as bcrypt from "bcrypt";

// Mock bcrypt
jest.mock("bcrypt", () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe("AuthService", () => {
  let service: AuthService;
  let prismaService: jest.Mocked<PrismaService>;

  const mockUser = {
    id: "user-123",
    email: "test@example.com",
    username: "testuser",
    passwordHash: "hashedPassword123",
    createdAt: new Date("2024-01-01"),
    lastLoginAt: null,
    isActive: true,
    isVerified: false,
    oauthProvider: null,
    oauthId: null,
    avatarUrl: null,
  };

  beforeEach(async () => {
    const mockPrismaService = {
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

    const mockJwtService = {
      sign: jest.fn().mockReturnValue("mock-token"),
    };

    const mockCacheService = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      buildKey: jest
        .fn()
        .mockImplementation(
          (prefix, ...parts) => `${prefix}${parts.join(":")}`,
        ),
    };

    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === "JWT_SECRET") return "test-jwt-secret-minimum-32-chars!!";
        if (key === "REFRESH_TOKEN_SECRET")
          return "test-refresh-secret-32-chars!!!!";
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("register", () => {
    it("should register a new user successfully", async () => {
      const email = "newuser@example.com";
      const username = "newuser";
      const password = "password123";
      const hashedPassword = "hashedPassword";

      (prismaService.user.findFirst as jest.Mock).mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);
      (prismaService.user.create as jest.Mock).mockResolvedValue({
        id: "new-user-id",
        email,
        username,
        createdAt: new Date(),
      });

      const result = await service.register(email, username, password);

      expect(prismaService.user.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ email }, { username }],
        },
      });
      expect(bcrypt.hash).toHaveBeenCalledWith(password, 10);
      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: {
          email,
          username,
          passwordHash: hashedPassword,
        },
        select: {
          id: true,
          email: true,
          username: true,
          createdAt: true,
        },
      });
      expect(result.user).toBeDefined();
      expect(result.accessToken).toBe("mock-token");
      expect(result.refreshToken).toBe("mock-token");
    });

    it("should throw ConflictException if email already exists", async () => {
      (prismaService.user.findFirst as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        service.register("test@example.com", "newuser", "password123"),
      ).rejects.toThrow(ConflictException);
    });

    it("should throw ConflictException if username already exists", async () => {
      (prismaService.user.findFirst as jest.Mock).mockResolvedValue(mockUser);

      await expect(
        service.register("new@example.com", "testuser", "password123"),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("login", () => {
    it("should login successfully with valid credentials", async () => {
      (prismaService.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (prismaService.user.update as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.login("test@example.com", "password123");

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: "test@example.com" },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        "password123",
        mockUser.passwordHash,
      );
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: {
          lastLoginAt: expect.any(Date),
          isActive: true,
        },
      });
      expect(result.user.id).toBe(mockUser.id);
      expect(result.accessToken).toBe("mock-token");
    });

    it("should throw UnauthorizedException if user not found", async () => {
      (prismaService.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.login("nonexistent@example.com", "password123"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException if password is invalid", async () => {
      (prismaService.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login("test@example.com", "wrongpassword"),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("refreshToken", () => {
    it("should refresh token successfully", async () => {
      (prismaService.user.findUnique as jest.Mock).mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
      });

      const result = await service.refreshToken(mockUser.id);

      expect(result.accessToken).toBe("mock-token");
      expect(result.refreshToken).toBe("mock-token");
    });

    it("should throw UnauthorizedException if user not found", async () => {
      (prismaService.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.refreshToken("nonexistent-id")).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
