/**
 * NotionAuthService unit tests
 *
 * Coverage:
 * - isConfigured() - returns true/false based on env vars
 * - getAuthorizationUrl() - builds correct OAuth URL with/without state, throws if not configured
 * - exchangeCodeForToken() - creates new connection, updates existing, handles OAuth errors
 * - disconnect() - deletes connection and related data, throws if not found
 * - getConnections() - returns connections for user
 *
 * All fetch() calls are mocked to prevent real HTTP requests.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NotionAuthService } from "../notion-auth.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------
const mockTokenResponse = {
  access_token: "notion-access-token",
  token_type: "bearer",
  bot_id: "bot-123",
  workspace_id: "workspace-abc",
  workspace_name: "My Workspace",
  workspace_icon: "https://notion.so/icon.png",
  owner: {
    type: "user",
    user: {
      id: "user-notion-123",
      name: "Notion User",
      avatar_url: "https://notion.so/avatar.jpg",
    },
  },
};

const mockConnection = {
  id: "conn-1",
  userId: "user-1",
  workspaceId: "workspace-abc",
  workspaceName: "My Workspace",
  workspaceIcon: null,
  botId: "bot-123",
  accessToken: "notion-access-token",
  ownerType: "user",
  status: "ACTIVE",
  lastSyncAt: null,
  lastError: null,
  syncConfig: {},
  createdAt: new Date("2024-01-01"),
  _count: { pages: 5, databases: 2 },
};

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  notionConnection: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  notionSyncHistory: {
    deleteMany: jest.fn(),
  },
  notionBlockVersion: {
    deleteMany: jest.fn(),
  },
  notionPage: {
    deleteMany: jest.fn(),
  },
  notionDatabase: {
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

// ---------------------------------------------------------------------------
// ConfigService mock (configured)
// ---------------------------------------------------------------------------
function makeConfigService(
  clientId = "notion-client-id",
  clientSecret = "notion-client-secret",
  callbackUrl = "http://localhost:8080/api/v1/notion/callback",
) {
  return {
    get: jest.fn((key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        NOTION_CLIENT_ID: clientId,
        NOTION_CLIENT_SECRET: clientSecret,
        NOTION_CALLBACK_URL: callbackUrl,
      };
      return config[key] ?? defaultValue ?? "";
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NotionAuthService", () => {
  let service: NotionAuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotionAuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: makeConfigService() },
      ],
    }).compile();

    service = module.get<NotionAuthService>(NotionAuthService);
  });

  // =========================================================================
  // isConfigured()
  // =========================================================================
  describe("isConfigured()", () => {
    it("returns true when clientId and clientSecret are set", () => {
      expect(service.isConfigured()).toBe(true);
    });

    it("returns false when clientId is empty", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          NotionAuthService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ConfigService, useValue: makeConfigService("", "secret") },
        ],
      }).compile();
      const svc = module.get<NotionAuthService>(NotionAuthService);
      expect(svc.isConfigured()).toBe(false);
    });

    it("returns false when clientSecret is empty", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          NotionAuthService,
          { provide: PrismaService, useValue: mockPrisma },
          {
            provide: ConfigService,
            useValue: makeConfigService("client-id", ""),
          },
        ],
      }).compile();
      const svc = module.get<NotionAuthService>(NotionAuthService);
      expect(svc.isConfigured()).toBe(false);
    });
  });

  // =========================================================================
  // getAuthorizationUrl()
  // =========================================================================
  describe("getAuthorizationUrl()", () => {
    it("returns a valid Notion OAuth URL", () => {
      const url = service.getAuthorizationUrl();
      expect(url).toContain("https://api.notion.com/v1/oauth/authorize");
      expect(url).toContain("client_id=notion-client-id");
      expect(url).toContain("response_type=code");
      expect(url).toContain("owner=user");
    });

    it("includes state parameter when provided", () => {
      const url = service.getAuthorizationUrl("my-state-value");
      expect(url).toContain("state=my-state-value");
    });

    it("does not include state parameter when not provided", () => {
      const url = service.getAuthorizationUrl();
      expect(url).not.toContain("state=");
    });

    it("includes redirect_uri in the URL", () => {
      const url = service.getAuthorizationUrl();
      expect(url).toContain("redirect_uri=");
    });

    it("throws BadRequestException when not configured", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          NotionAuthService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ConfigService, useValue: makeConfigService("", "") },
        ],
      }).compile();
      const svc = module.get<NotionAuthService>(NotionAuthService);

      expect(() => svc.getAuthorizationUrl()).toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // exchangeCodeForToken()
  // =========================================================================
  describe("exchangeCodeForToken()", () => {
    function mockSuccessfulFetch() {
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockTokenResponse),
      });
    }

    it("creates a new connection when none exists", async () => {
      mockSuccessfulFetch();
      mockPrisma.notionConnection.findUnique.mockResolvedValue(null);
      mockPrisma.notionConnection.create.mockResolvedValue({
        ...mockConnection,
        id: "new-conn-1",
      });

      const result = await service.exchangeCodeForToken("user-1", "auth-code");

      expect(result.connectionId).toBe("new-conn-1");
      expect(result.workspaceName).toBe("My Workspace");
      expect(mockPrisma.notionConnection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-1",
            accessToken: "notion-access-token",
            workspaceId: "workspace-abc",
            status: "ACTIVE",
          }),
        }),
      );
    });

    it("updates existing connection when workspace already connected", async () => {
      mockSuccessfulFetch();
      mockPrisma.notionConnection.findUnique.mockResolvedValue(mockConnection);
      mockPrisma.notionConnection.update.mockResolvedValue({
        ...mockConnection,
        accessToken: "new-notion-access-token",
      });

      const result = await service.exchangeCodeForToken("user-1", "auth-code");

      expect(result.connectionId).toBe("conn-1");
      expect(mockPrisma.notionConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "conn-1" },
          data: expect.objectContaining({
            accessToken: "notion-access-token",
            status: "ACTIVE",
          }),
        }),
      );
    });

    it("throws UnauthorizedException when OAuth fails", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: jest.fn().mockResolvedValue({ error: "invalid_grant" }),
      });

      await expect(
        service.exchangeCodeForToken("user-1", "bad-code"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("throws BadRequestException when not configured", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          NotionAuthService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ConfigService, useValue: makeConfigService("", "") },
        ],
      }).compile();
      const svc = module.get<NotionAuthService>(NotionAuthService);

      await expect(svc.exchangeCodeForToken("user-1", "code")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("uses custom redirectUri when provided", async () => {
      mockSuccessfulFetch();
      mockPrisma.notionConnection.findUnique.mockResolvedValue(null);
      mockPrisma.notionConnection.create.mockResolvedValue(mockConnection);

      await service.exchangeCodeForToken(
        "user-1",
        "code",
        "https://custom.app/callback",
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.notion.com/v1/oauth/token",
        expect.objectContaining({
          body: expect.stringContaining("custom.app"),
        }),
      );
    });

    it("wraps unexpected errors in UnauthorizedException", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      await expect(
        service.exchangeCodeForToken("user-1", "code"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("handles workspace without name (uses workspaceId fallback)", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          ...mockTokenResponse,
          workspace_name: undefined,
        }),
      });
      mockPrisma.notionConnection.findUnique.mockResolvedValue(null);
      mockPrisma.notionConnection.create.mockResolvedValue({
        ...mockConnection,
        workspaceName: null,
        workspaceId: "workspace-abc",
      });

      const result = await service.exchangeCodeForToken("user-1", "code");
      expect(result.workspaceName).toBe("workspace-abc");
    });
  });

  // =========================================================================
  // disconnect()
  // =========================================================================
  describe("disconnect()", () => {
    it("deletes connection and related data", async () => {
      mockPrisma.notionConnection.findFirst.mockResolvedValue(mockConnection);
      mockPrisma.$transaction.mockResolvedValue([]);

      await service.disconnect("user-1", "conn-1");

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it("throws BadRequestException if connection not found", async () => {
      mockPrisma.notionConnection.findFirst.mockResolvedValue(null);

      await expect(service.disconnect("user-1", "nonexistent")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("passes correct userId and connectionId to findFirst", async () => {
      mockPrisma.notionConnection.findFirst.mockResolvedValue(mockConnection);
      mockPrisma.$transaction.mockResolvedValue([]);

      await service.disconnect("user-1", "conn-1");

      expect(mockPrisma.notionConnection.findFirst).toHaveBeenCalledWith({
        where: { id: "conn-1", userId: "user-1" },
      });
    });
  });

  // =========================================================================
  // getConnections()
  // =========================================================================
  describe("getConnections()", () => {
    it("returns connections for user", async () => {
      mockPrisma.notionConnection.findMany.mockResolvedValue([mockConnection]);

      const result = await service.getConnections("user-1");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("conn-1");
    });

    it("returns empty array when user has no connections", async () => {
      mockPrisma.notionConnection.findMany.mockResolvedValue([]);

      const result = await service.getConnections("user-1");

      expect(result).toHaveLength(0);
    });

    it("queries by userId", async () => {
      mockPrisma.notionConnection.findMany.mockResolvedValue([]);

      await service.getConnections("user-abc");

      expect(mockPrisma.notionConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-abc" },
        }),
      );
    });
  });
});
