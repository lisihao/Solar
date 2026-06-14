import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleDriveAuthService } from "../google-drive-auth.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";

// Mock google-auth-library
const mockOAuth2ClientInstance = {
  generateAuthUrl: jest.fn(),
  getToken: jest.fn(),
  setCredentials: jest.fn(),
  refreshAccessToken: jest.fn(),
};

jest.mock("google-auth-library", () => ({
  OAuth2Client: jest.fn().mockImplementation(() => mockOAuth2ClientInstance),
}));

// Mock @googleapis/oauth2
const mockUserinfoGet = jest.fn();
jest.mock("@googleapis/oauth2", () => ({
  oauth2: jest.fn().mockImplementation(() => ({
    userinfo: {
      get: mockUserinfoGet,
    },
  })),
}));

describe("GoogleDriveAuthService", () => {
  let service: GoogleDriveAuthService;
  let prisma: jest.Mocked<PrismaService>;

  const mockConnection = {
    id: "conn-1",
    userId: "user-1",
    googleId: "gid-1",
    email: "test@example.com",
    displayName: "Test User",
    photoUrl: "https://photo.url",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenExpiry: new Date(Date.now() + 3600000),
    status: "ACTIVE",
    lastSyncAt: null,
    lastError: null,
    storageLimit: null,
    storageUsage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Set env vars for service initialization
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    process.env.GOOGLE_DRIVE_REDIRECT_URI =
      "http://localhost:8080/api/v1/google-drive/callback";

    const prismaMock = {
      googleDriveConnection: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      googleDriveSyncHistory: {
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const configMock = {
      get: jest.fn((key: string, defaultValue?: string) => {
        const envMap: Record<string, string | undefined> = {
          GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
          GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
          GOOGLE_DRIVE_REDIRECT_URI: process.env.GOOGLE_DRIVE_REDIRECT_URI,
        };
        return envMap[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleDriveAuthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = module.get<GoogleDriveAuthService>(GoogleDriveAuthService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  // ============ isConfigured ============

  describe("isConfigured", () => {
    it("should return true when client ID and secret are set", () => {
      expect(service.isConfigured()).toBe(true);
    });
  });

  // ============ getAuthorizationUrl ============

  describe("getAuthorizationUrl", () => {
    it("should return authorization URL from OAuth2 client", () => {
      mockOAuth2ClientInstance.generateAuthUrl.mockReturnValue(
        "https://accounts.google.com/oauth",
      );

      const url = service.getAuthorizationUrl("my-state");

      expect(mockOAuth2ClientInstance.generateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          access_type: "offline",
          state: "my-state",
        }),
      );
      expect(url).toBe("https://accounts.google.com/oauth");
    });

    it("should use consent prompt when forceConsent=true", () => {
      mockOAuth2ClientInstance.generateAuthUrl.mockReturnValue(
        "https://auth-url",
      );

      service.getAuthorizationUrl(undefined, true);

      expect(mockOAuth2ClientInstance.generateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "consent" }),
      );
    });

    it("should use select_account prompt when forceConsent=false", () => {
      mockOAuth2ClientInstance.generateAuthUrl.mockReturnValue(
        "https://auth-url",
      );

      service.getAuthorizationUrl(undefined, false);

      expect(mockOAuth2ClientInstance.generateAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "select_account" }),
      );
    });

    it("should throw BadRequestException when not configured", async () => {
      // Create unconfigured service
      delete process.env.GOOGLE_CLIENT_ID;

      const module = await Test.createTestingModule({
        providers: [
          GoogleDriveAuthService,
          { provide: PrismaService, useValue: { googleDriveConnection: {} } },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn(
                (_key: string, defaultValue?: string) => defaultValue,
              ),
            },
          },
        ],
      }).compile();
      const unconfiguredService = module.get<GoogleDriveAuthService>(
        GoogleDriveAuthService,
      );

      expect(() => unconfiguredService.getAuthorizationUrl()).toThrow(
        BadRequestException,
      );
    });
  });

  // ============ exchangeCodeForToken ============

  describe("exchangeCodeForToken", () => {
    const mockTokens = {
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
      expiry_date: Date.now() + 3600000,
    };

    beforeEach(() => {
      mockOAuth2ClientInstance.getToken.mockResolvedValue({
        tokens: mockTokens,
      });
      mockUserinfoGet.mockResolvedValue({
        data: {
          id: "gid-1",
          email: "test@example.com",
          name: "Test User",
          picture: "https://photo.url",
        },
      });
    });

    it("should create new connection when user has no existing connection", async () => {
      prisma.googleDriveConnection.findUnique.mockResolvedValue(null);
      prisma.googleDriveConnection.create.mockResolvedValue({
        ...mockConnection,
        id: "new-conn-1",
        email: "test@example.com",
      } as any);

      const result = await service.exchangeCodeForToken("user-1", "auth-code");

      expect(mockOAuth2ClientInstance.getToken).toHaveBeenCalledWith(
        "auth-code",
      );
      expect(prisma.googleDriveConnection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-1",
            email: "test@example.com",
            accessToken: "new-access-token",
            refreshToken: "new-refresh-token",
            status: "ACTIVE",
          }),
        }),
      );
      expect(result.email).toBe("test@example.com");
    });

    it("should update existing connection when user already has one", async () => {
      prisma.googleDriveConnection.findUnique.mockResolvedValue(
        mockConnection as any,
      );
      prisma.googleDriveConnection.update.mockResolvedValue({
        ...mockConnection,
        accessToken: "new-access-token",
      } as any);

      const result = await service.exchangeCodeForToken("user-1", "auth-code");

      expect(prisma.googleDriveConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accessToken: "new-access-token",
            status: "ACTIVE",
            lastError: null,
          }),
        }),
      );
      expect(result.connectionId).toBeDefined();
    });

    it("should throw UnauthorizedException when tokens are missing", async () => {
      mockOAuth2ClientInstance.getToken.mockResolvedValue({
        tokens: { access_token: null, refresh_token: null },
      });

      await expect(
        service.exchangeCodeForToken("user-1", "bad-code"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should throw UnauthorizedException on network errors", async () => {
      mockOAuth2ClientInstance.getToken.mockRejectedValue(
        new Error("Network error"),
      );

      await expect(
        service.exchangeCodeForToken("user-1", "code"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should throw BadRequestException when service not configured", async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      const module = await Test.createTestingModule({
        providers: [
          GoogleDriveAuthService,
          { provide: PrismaService, useValue: { googleDriveConnection: {} } },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn(
                (_key: string, defaultValue?: string) => defaultValue,
              ),
            },
          },
        ],
      }).compile();
      const unconfiguredService = module.get<GoogleDriveAuthService>(
        GoogleDriveAuthService,
      );

      await expect(
        unconfiguredService.exchangeCodeForToken("user-1", "code"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============ refreshAccessToken ============

  describe("refreshAccessToken", () => {
    it("should refresh token and return new access token", async () => {
      const connectionWithRefreshToken = {
        ...mockConnection,
        refreshToken: "valid-refresh-token",
        status: "ACTIVE",
      };
      prisma.googleDriveConnection.findUnique.mockResolvedValue(
        connectionWithRefreshToken as any,
      );
      mockOAuth2ClientInstance.refreshAccessToken.mockResolvedValue({
        credentials: {
          access_token: "new-refreshed-token",
          expiry_date: Date.now() + 3600000,
        },
      });
      prisma.googleDriveConnection.update.mockResolvedValue({} as any);

      const result = await service.refreshAccessToken("conn-1");

      expect(mockOAuth2ClientInstance.setCredentials).toHaveBeenCalledWith({
        refresh_token: "valid-refresh-token",
      });
      expect(prisma.googleDriveConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            accessToken: "new-refreshed-token",
            status: "ACTIVE",
          }),
        }),
      );
      expect(result).toBe("new-refreshed-token");
    });

    it("should throw BadRequestException when connection not found", async () => {
      prisma.googleDriveConnection.findUnique.mockResolvedValue(null);

      await expect(service.refreshAccessToken("missing-conn")).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.refreshAccessToken("missing-conn")).rejects.toThrow(
        "Connection not found",
      );
    });

    it("should throw UnauthorizedException when no refresh token available", async () => {
      prisma.googleDriveConnection.findUnique.mockResolvedValue({
        ...mockConnection,
        refreshToken: null,
      } as any);

      await expect(service.refreshAccessToken("conn-1")).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.refreshAccessToken("conn-1")).rejects.toThrow(
        "No refresh token available",
      );
    });

    it("should set connection status to ERROR on refresh failure", async () => {
      prisma.googleDriveConnection.findUnique.mockResolvedValue({
        ...mockConnection,
        refreshToken: "refresh-token",
      } as any);
      mockOAuth2ClientInstance.refreshAccessToken.mockRejectedValue(
        new Error("Token revoked"),
      );
      prisma.googleDriveConnection.update.mockResolvedValue({} as any);

      await expect(service.refreshAccessToken("conn-1")).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.googleDriveConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "ERROR" }),
        }),
      );
    });

    it("should throw UnauthorizedException when new credentials have no access_token", async () => {
      prisma.googleDriveConnection.findUnique.mockResolvedValue({
        ...mockConnection,
        refreshToken: "refresh-token",
      } as any);
      mockOAuth2ClientInstance.refreshAccessToken.mockResolvedValue({
        credentials: { access_token: null },
      });
      prisma.googleDriveConnection.update.mockResolvedValue({} as any);

      await expect(service.refreshAccessToken("conn-1")).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ============ disconnect ============

  describe("disconnect", () => {
    it("should delete connection and all related data", async () => {
      prisma.googleDriveConnection.findFirst.mockResolvedValue(
        mockConnection as any,
      );
      prisma.$transaction.mockResolvedValue([]);

      await service.disconnect("user-1");

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("should throw BadRequestException when connection not found", async () => {
      prisma.googleDriveConnection.findFirst.mockResolvedValue(null);

      await expect(service.disconnect("user-1")).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.disconnect("user-1")).rejects.toThrow(
        "Connection not found",
      );
    });
  });

  // ============ getConnection ============

  describe("getConnection", () => {
    it("should return connection without sensitive token fields", async () => {
      const connectionWithCount = {
        ...mockConnection,
        _count: { syncHistory: 5 },
      };
      prisma.googleDriveConnection.findFirst.mockResolvedValue(
        connectionWithCount as any,
      );

      const result = await service.getConnection("user-1");

      expect(result).not.toBeNull();
      expect(result?.refreshToken).toBeUndefined();
      expect(result?.tokenExpiry).toBeUndefined();
      expect(result?.syncHistoryCount).toBe(5);
    });

    it("should return null when no connection exists", async () => {
      prisma.googleDriveConnection.findFirst.mockResolvedValue(null);

      const result = await service.getConnection("user-1");

      expect(result).toBeNull();
    });

    it("should indicate tokenExpired=false when token is still valid", async () => {
      const validConnection = {
        ...mockConnection,
        tokenExpiry: new Date(Date.now() + 3600000), // 1 hour from now
        _count: { syncHistory: 0 },
      };
      prisma.googleDriveConnection.findFirst.mockResolvedValue(
        validConnection as any,
      );

      const result = await service.getConnection("user-1");

      expect(result?.tokenExpired).toBe(false);
    });

    it("should indicate tokenExpired=true and schedule background refresh when token expired", async () => {
      const expiredConnection = {
        ...mockConnection,
        tokenExpiry: new Date(Date.now() - 1000), // 1 second ago (expired)
        status: "ACTIVE",
        refreshToken: "valid-refresh",
        _count: { syncHistory: 0 },
      };
      prisma.googleDriveConnection.findFirst.mockResolvedValue(
        expiredConnection as any,
      );
      // Mock refreshAccessToken to not throw
      mockOAuth2ClientInstance.refreshAccessToken.mockResolvedValue({
        credentials: {
          access_token: "refreshed",
          expiry_date: Date.now() + 3600000,
        },
      });
      prisma.googleDriveConnection.update.mockResolvedValue({} as any);

      const result = await service.getConnection("user-1");

      expect(result?.tokenExpired).toBe(true);
    });
  });

  // ============ getAuthenticatedClient ============

  describe("getAuthenticatedClient", () => {
    it("should return OAuth2 client with credentials", async () => {
      const validConnection = {
        id: "conn-1",
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenExpiry: new Date(Date.now() + 3600000),
        status: "ACTIVE",
      };
      prisma.googleDriveConnection.findFirst.mockResolvedValue(
        validConnection as any,
      );

      const client = await service.getAuthenticatedClient("user-1");

      expect(mockOAuth2ClientInstance.setCredentials).toHaveBeenCalledWith(
        expect.objectContaining({ access_token: "access-token" }),
      );
      expect(client).toBeDefined();
    });

    it("should throw BadRequestException when connection not found", async () => {
      prisma.googleDriveConnection.findFirst.mockResolvedValue(null);

      await expect(service.getAuthenticatedClient("user-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException when connection is not ACTIVE", async () => {
      prisma.googleDriveConnection.findFirst.mockResolvedValue({
        id: "conn-1",
        status: "REVOKED",
        accessToken: "token",
        refreshToken: null,
        tokenExpiry: null,
      } as any);

      await expect(service.getAuthenticatedClient("user-1")).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.getAuthenticatedClient("user-1")).rejects.toThrow(
        "Connection is REVOKED",
      );
    });

    it("should refresh expired token before returning client", async () => {
      const expiredConnection = {
        id: "conn-1",
        accessToken: "old-token",
        refreshToken: "refresh-token",
        tokenExpiry: new Date(Date.now() - 1000), // Expired
        status: "ACTIVE",
      };
      prisma.googleDriveConnection.findFirst.mockResolvedValue(
        expiredConnection as any,
      );
      prisma.googleDriveConnection.findUnique.mockResolvedValue({
        ...expiredConnection,
        refreshToken: "refresh-token",
      } as any);
      mockOAuth2ClientInstance.refreshAccessToken.mockResolvedValue({
        credentials: {
          access_token: "new-token",
          expiry_date: Date.now() + 3600000,
        },
      });
      prisma.googleDriveConnection.update.mockResolvedValue({} as any);

      await service.getAuthenticatedClient("user-1");

      // refreshAccessToken should have been called
      expect(mockOAuth2ClientInstance.refreshAccessToken).toHaveBeenCalled();
    });
  });

  // ============ validateConnection ============

  describe("validateConnection", () => {
    it("should return true when connection is valid", async () => {
      const validConnection = {
        id: "conn-1",
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenExpiry: new Date(Date.now() + 3600000),
        status: "ACTIVE",
      };
      prisma.googleDriveConnection.findFirst.mockResolvedValue(
        validConnection as any,
      );
      mockUserinfoGet.mockResolvedValue({ data: { id: "gid-1" } });

      const result = await service.validateConnection("user-1");

      expect(result).toBe(true);
    });

    it("should return false and mark connection as ERROR on validation failure", async () => {
      const validConnection = {
        id: "conn-1",
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenExpiry: new Date(Date.now() + 3600000),
        status: "ACTIVE",
      };
      prisma.googleDriveConnection.findFirst.mockResolvedValue(
        validConnection as any,
      );
      // Make userinfo.get throw so getAuthenticatedClient flow completes but oauth2 call fails
      mockUserinfoGet.mockRejectedValue(new Error("Token invalid"));
      prisma.googleDriveConnection.update.mockResolvedValue({} as any);

      const result = await service.validateConnection("user-1");

      expect(result).toBe(false);
      expect(prisma.googleDriveConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "ERROR" }),
        }),
      );
    });

    it("should return false without throwing when connection not found", async () => {
      prisma.googleDriveConnection.findFirst.mockResolvedValue(null);

      const result = await service.validateConnection("user-1");

      expect(result).toBe(false);
    });
  });

  // ============ updateConnection ============

  describe("updateConnection", () => {
    it("should return connection info without sensitive fields", async () => {
      const connectionWithTokens = {
        ...mockConnection,
        accessToken: "secret-token",
        refreshToken: "secret-refresh",
      };
      prisma.googleDriveConnection.findFirst.mockResolvedValue(
        connectionWithTokens as any,
      );
      prisma.googleDriveConnection.findUnique.mockResolvedValue(
        connectionWithTokens as any,
      );

      const result = await service.updateConnection("user-1", {});

      expect(result).not.toHaveProperty("accessToken");
      expect(result).not.toHaveProperty("refreshToken");
    });

    it("should throw BadRequestException when connection not found", async () => {
      prisma.googleDriveConnection.findFirst.mockResolvedValue(null);

      await expect(service.updateConnection("user-1", {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
