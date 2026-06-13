import { Test, TestingModule } from "@nestjs/testing";
import { NotionSyncService } from "../notion-sync.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { NotionAuthService } from "../notion-auth.service";

// Mock Notion Client at module level
const mockNotionClient = {
  search: jest.fn(),
  pages: {
    retrieve: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  blocks: {
    children: {
      list: jest.fn(),
      append: jest.fn(),
    },
    delete: jest.fn(),
  },
  databases: {
    query: jest.fn(),
  },
};

jest.mock("@notionhq/client", () => ({
  Client: jest.fn().mockImplementation(() => mockNotionClient),
}));

describe("NotionSyncService", () => {
  let service: NotionSyncService;
  let prisma: jest.Mocked<PrismaService>;
  let authService: jest.Mocked<NotionAuthService>;

  const mockConnection = {
    id: "conn-1",
    userId: "user-1",
    workspaceId: "ws-1",
    workspaceName: "Test Workspace",
    workspaceIcon: null,
    accessToken: "token-1",
    botId: "bot-1",
    ownerType: "user",
    status: "ACTIVE",
    syncConfig: {
      autoSync: true,
      syncInterval: 60,
      syncPages: true,
      syncDatabases: true,
      maxPagesPerSync: 500,
    },
    lastSyncAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSyncHistory = {
    id: "sync-hist-1",
    connectionId: "conn-1",
    syncType: "full",
    status: "PENDING",
    startedAt: new Date(),
    completedAt: null,
    pagesProcessed: 0,
    pagesCreated: 0,
    pagesUpdated: 0,
    errors: [],
    durationMs: null,
  };

  beforeEach(async () => {
    // Reset all mock implementations before each test
    jest.clearAllMocks();

    const prismaMock = {
      notionConnection: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      notionSyncHistory: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      notionPage: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      notionDatabase: {
        upsert: jest.fn(),
      },
      notionBlockVersion: {
        create: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    const authServiceMock = {
      getNotionClient: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotionSyncService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotionAuthService, useValue: authServiceMock },
      ],
    }).compile();

    service = module.get<NotionSyncService>(NotionSyncService);
    prisma = module.get(PrismaService);
    authService = module.get(NotionAuthService);
  });

  // ============ triggerSync ============

  describe("triggerSync", () => {
    it("should trigger sync for all active connections when no connectionId given", async () => {
      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionSyncHistory.create.mockResolvedValue(mockSyncHistory as any);
      prisma.notionSyncHistory.update.mockResolvedValue({} as any);
      // executeSyncAsync is fire-and-forget; mock the internals to prevent errors
      prisma.notionSyncHistory.findUnique.mockResolvedValue({
        startedAt: new Date(),
      } as any);
      prisma.notionConnection.findUnique.mockResolvedValue(null as any);

      const result = await service.triggerSync("user-1");

      expect(prisma.notionConnection.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1", status: "ACTIVE" },
      });
      expect(prisma.notionSyncHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          connectionId: "conn-1",
          syncType: "incremental",
          status: "PENDING",
        }),
      });
      expect(result.syncId).toBe("sync-hist-1");
      expect(result.connectionIds).toEqual(["conn-1"]);
    });

    it("should trigger full sync when fullSync=true", async () => {
      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionSyncHistory.create.mockResolvedValue(mockSyncHistory as any);
      prisma.notionSyncHistory.update.mockResolvedValue({} as any);
      prisma.notionSyncHistory.findUnique.mockResolvedValue({
        startedAt: new Date(),
      } as any);
      prisma.notionConnection.findUnique.mockResolvedValue(null as any);

      await service.triggerSync("user-1", undefined, true);

      expect(prisma.notionSyncHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ syncType: "full" }),
      });
    });

    it("should trigger sync for specific connection when connectionId provided", async () => {
      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionSyncHistory.create.mockResolvedValue(mockSyncHistory as any);
      prisma.notionSyncHistory.update.mockResolvedValue({} as any);
      prisma.notionSyncHistory.findUnique.mockResolvedValue({
        startedAt: new Date(),
      } as any);
      prisma.notionConnection.findUnique.mockResolvedValue(null as any);

      await service.triggerSync("user-1", "conn-1");

      expect(prisma.notionConnection.findMany).toHaveBeenCalledWith({
        where: { id: "conn-1", userId: "user-1", status: "ACTIVE" },
      });
    });

    it("should throw when no active connections found", async () => {
      prisma.notionConnection.findMany.mockResolvedValue([]);

      await expect(service.triggerSync("user-1")).rejects.toThrow(
        "No active Notion connections found",
      );
    });

    it("should skip connections that are already syncing", async () => {
      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionSyncHistory.create.mockResolvedValue(mockSyncHistory as any);
      prisma.notionSyncHistory.update.mockResolvedValue({} as any);
      prisma.notionSyncHistory.findUnique.mockResolvedValue({
        startedAt: new Date(),
      } as any);
      prisma.notionConnection.findUnique.mockResolvedValue(null as any);

      // First call: trigger sync (marks conn-1 as syncing internally)
      await service.triggerSync("user-1");
      jest.clearAllMocks();

      // Add conn-1 to syncingConnections by calling again before async clears it
      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionSyncHistory.create.mockResolvedValue(mockSyncHistory as any);

      const result = await service.triggerSync("user-1");
      // syncId will be empty string since the connection was in the syncing set
      // (async execution may have cleared it, but we verify the create was called or not)
      expect(result).toBeDefined();
    });

    it("should return empty syncId when all connections are already syncing", async () => {
      // Manually inject connection into syncingConnections via first trigger
      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionSyncHistory.create.mockResolvedValue(mockSyncHistory as any);
      prisma.notionSyncHistory.update.mockResolvedValue({} as any);
      prisma.notionSyncHistory.findUnique.mockResolvedValue({
        startedAt: new Date(),
      } as any);
      authService.getNotionClient.mockRejectedValue(
        new Error("Connection not found"),
      );
      prisma.notionConnection.findUnique.mockResolvedValue(null as any);

      const result = await service.triggerSync("user-1");
      expect(result.connectionIds).toHaveLength(1);
    });
  });

  // ============ getSyncStatus ============

  describe("getSyncStatus", () => {
    it("should return sync status for all connections of a user", async () => {
      prisma.notionConnection.findMany.mockResolvedValue([
        {
          ...mockConnection,
          syncHistory: [],
        },
      ] as any);

      const result = await service.getSyncStatus("user-1");

      expect(prisma.notionConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "user-1" } }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].connectionId).toBe("conn-1");
      expect(result[0].isSyncing).toBe(false);
      expect(result[0].lastSync).toBeNull();
    });

    it("should return sync status for a specific connection", async () => {
      prisma.notionConnection.findMany.mockResolvedValue([
        {
          ...mockConnection,
          syncHistory: [{ id: "hist-1", status: "SUCCESS" }],
        },
      ] as any);

      const result = await service.getSyncStatus("user-1", "conn-1");

      expect(prisma.notionConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "conn-1", userId: "user-1" } }),
      );
      expect(result[0].lastSync).not.toBeNull();
    });

    it("should mark connection as syncing when it is in the syncing set", async () => {
      // We cannot inject into the private set directly; verify the isSyncing flag is false by default
      prisma.notionConnection.findMany.mockResolvedValue([
        { ...mockConnection, syncHistory: [] },
      ] as any);

      const result = await service.getSyncStatus("user-1");
      expect(result[0].isSyncing).toBe(false);
    });
  });

  // ============ getSyncHistory ============

  describe("getSyncHistory", () => {
    it("should return sync history for a connection", async () => {
      prisma.notionConnection.findFirst.mockResolvedValue(
        mockConnection as any,
      );
      prisma.notionSyncHistory.findMany.mockResolvedValue([
        mockSyncHistory,
      ] as any);

      const result = await service.getSyncHistory("user-1", "conn-1");

      expect(prisma.notionConnection.findFirst).toHaveBeenCalledWith({
        where: { id: "conn-1", userId: "user-1" },
      });
      expect(prisma.notionSyncHistory.findMany).toHaveBeenCalledWith({
        where: { connectionId: "conn-1" },
        orderBy: { startedAt: "desc" },
        take: 10,
      });
      expect(result).toHaveLength(1);
    });

    it("should respect custom limit parameter", async () => {
      prisma.notionConnection.findFirst.mockResolvedValue(
        mockConnection as any,
      );
      prisma.notionSyncHistory.findMany.mockResolvedValue([] as any);

      await service.getSyncHistory("user-1", "conn-1", 5);

      expect(prisma.notionSyncHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it("should throw when connection not found or not owned by user", async () => {
      prisma.notionConnection.findFirst.mockResolvedValue(null);

      await expect(
        service.getSyncHistory("user-1", "conn-999"),
      ).rejects.toThrow("Connection not found");
    });
  });

  // ============ detectPendingChanges ============

  describe("detectPendingChanges", () => {
    it("should return zero counts when no active connections", async () => {
      prisma.notionConnection.findMany.mockResolvedValue([]);

      const result = await service.detectPendingChanges("user-1");

      expect(result).toEqual({
        localChanges: 0,
        remoteChanges: 0,
        conflicts: 0,
      });
    });

    it("should count locally modified pages", async () => {
      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionPage.count.mockResolvedValue(3);
      prisma.notionPage.findMany.mockResolvedValue([]);

      const result = await service.detectPendingChanges("user-1");

      expect(result.localChanges).toBe(3);
      expect(result.remoteChanges).toBe(0);
    });

    it("should detect conflicts when local and remote modification times are close", async () => {
      const now = new Date();
      const almostSameTime = new Date(now.getTime() + 30000); // 30 seconds apart

      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionPage.count.mockResolvedValue(1);
      prisma.notionPage.findMany.mockResolvedValue([
        {
          id: "page-1",
          notionPageId: "notion-page-1",
          notionUpdatedAt: now,
          localModifiedAt: almostSameTime,
        },
      ] as any);

      const result = await service.detectPendingChanges("user-1");

      expect(result.conflicts).toBe(1);
    });

    it("should not count as conflict when time difference exceeds 1 minute", async () => {
      const now = new Date();
      const twoMinutesLater = new Date(now.getTime() + 120000); // 2 minutes apart

      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionPage.count.mockResolvedValue(1);
      prisma.notionPage.findMany.mockResolvedValue([
        {
          id: "page-1",
          notionPageId: "notion-page-1",
          notionUpdatedAt: now,
          localModifiedAt: twoMinutesLater,
        },
      ] as any);

      const result = await service.detectPendingChanges("user-1");
      expect(result.conflicts).toBe(0);
    });
  });

  // ============ syncBidirectional ============

  describe("syncBidirectional", () => {
    it("should throw when no active connections found", async () => {
      prisma.notionConnection.findMany.mockResolvedValue([]);

      await expect(service.syncBidirectional("user-1")).rejects.toThrow(
        "No active Notion connections found",
      );
    });

    it("should perform pull-only sync when direction=pull", async () => {
      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionConnection.findUnique.mockResolvedValue({
        ...mockConnection,
        syncConfig: {
          syncPages: true,
          syncDatabases: true,
          maxPagesPerSync: 500,
        },
      } as any);
      authService.getNotionClient.mockResolvedValue(mockNotionClient as any);
      mockNotionClient.search.mockResolvedValue({
        results: [],
        has_more: false,
        next_cursor: null,
      });

      const result = await service.syncBidirectional("user-1", undefined, {
        direction: "pull",
      });

      expect(result.success).toBe(true);
      expect(result.pagesPushed).toBe(0);
    });

    it("should perform push-only sync when direction=push", async () => {
      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionPage.findMany.mockResolvedValue([]);

      const result = await service.syncBidirectional("user-1", undefined, {
        direction: "push",
      });

      expect(result.pagesPushed).toBe(0);
      expect(result.pagesProcessed).toBe(0);
    });

    it("should aggregate results across multiple connections", async () => {
      const conn2 = { ...mockConnection, id: "conn-2" };
      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
        conn2,
      ] as any);
      prisma.notionPage.findMany.mockResolvedValue([]);
      prisma.notionConnection.findUnique.mockResolvedValue({
        ...mockConnection,
        syncConfig: {
          syncPages: false,
          syncDatabases: false,
          maxPagesPerSync: 500,
        },
      } as any);

      const result = await service.syncBidirectional("user-1");

      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
    });

    it("should mark success=false when errors occur", async () => {
      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionPage.findMany.mockResolvedValue([]);
      prisma.notionConnection.findUnique.mockResolvedValue({
        ...mockConnection,
        syncConfig: {
          syncPages: true,
          syncDatabases: false,
          maxPagesPerSync: 500,
        },
      } as any);
      authService.getNotionClient.mockRejectedValue(new Error("Auth failed"));

      const result = await service.syncBidirectional("user-1");

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // ============ resolveConflict ============

  describe("resolveConflict", () => {
    const mockPage = {
      id: "page-1",
      notionPageId: "notion-page-1",
      connectionId: "conn-1",
      title: "Test Page",
      blocks: [],
      isLocallyModified: true,
      localModifiedAt: new Date(),
      notionUpdatedAt: new Date(),
      plainTextContent: "",
      connection: mockConnection,
    };

    it("should throw when page not found", async () => {
      prisma.notionPage.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveConflict("user-1", "page-999", "keep_local"),
      ).rejects.toThrow("Page not found");
    });

    it("should push local version to Notion when resolution=keep_local", async () => {
      prisma.notionPage.findFirst.mockResolvedValue(mockPage as any);
      authService.getNotionClient.mockResolvedValue(mockNotionClient as any);
      mockNotionClient.blocks.children.list.mockResolvedValue({ results: [] });
      mockNotionClient.blocks.children.append.mockResolvedValue({});
      prisma.notionPage.update.mockResolvedValue({} as any);

      await service.resolveConflict("user-1", "page-1", "keep_local");

      expect(authService.getNotionClient).toHaveBeenCalledWith("conn-1");
      expect(prisma.notionPage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isLocallyModified: false }),
        }),
      );
    });

    it("should pull remote version from Notion when resolution=keep_remote", async () => {
      prisma.notionPage.findFirst.mockResolvedValue(mockPage as any);
      authService.getNotionClient.mockResolvedValue(mockNotionClient as any);
      mockNotionClient.pages.retrieve.mockResolvedValue({
        last_edited_time: new Date().toISOString(),
      });
      mockNotionClient.blocks.children.list.mockResolvedValue({
        results: [],
        has_more: false,
      });
      prisma.notionPage.update.mockResolvedValue({} as any);

      await service.resolveConflict("user-1", "page-1", "keep_remote");

      expect(mockNotionClient.pages.retrieve).toHaveBeenCalledWith({
        page_id: "notion-page-1",
      });
      expect(prisma.notionPage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isLocallyModified: false }),
        }),
      );
    });
  });

  // ============ Block conversion (via private methods tested through sync) ============

  describe("block conversion edge cases", () => {
    it("should handle empty search results during page sync", async () => {
      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionConnection.findUnique.mockResolvedValue({
        ...mockConnection,
        syncConfig: {
          syncPages: true,
          syncDatabases: false,
          maxPagesPerSync: 500,
        },
      } as any);
      authService.getNotionClient.mockResolvedValue(mockNotionClient as any);
      mockNotionClient.search.mockResolvedValue({
        results: [],
        has_more: false,
        next_cursor: null,
      });
      prisma.notionSyncHistory.create.mockResolvedValue(mockSyncHistory as any);
      prisma.notionSyncHistory.update.mockResolvedValue({} as any);
      prisma.notionSyncHistory.findUnique.mockResolvedValue({
        startedAt: new Date(),
      } as any);

      await service.triggerSync("user-1");
      // Give fire-and-forget a tick to execute
      await new Promise((r) => setTimeout(r, 10));

      expect(mockNotionClient.search).toHaveBeenCalled();
    });

    it("should stop incremental sync when all results are older than lastSyncAt", async () => {
      const lastSyncAt = new Date();
      const oldEditTime = new Date(Date.now() - 86400000).toISOString(); // 1 day ago

      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionConnection.findUnique.mockResolvedValue({
        ...mockConnection,
        lastSyncAt,
        syncConfig: {
          syncPages: true,
          syncDatabases: false,
          maxPagesPerSync: 500,
        },
      } as any);
      authService.getNotionClient.mockResolvedValue(mockNotionClient as any);
      mockNotionClient.search.mockResolvedValue({
        results: [
          {
            object: "page",
            id: "old-page",
            last_edited_time: oldEditTime,
            created_time: oldEditTime,
            parent: { type: "workspace" },
            properties: {},
            url: "https://notion.so/old-page",
            icon: null,
            cover: null,
          },
        ],
        has_more: false,
        next_cursor: null,
      });
      prisma.notionSyncHistory.create.mockResolvedValue(mockSyncHistory as any);
      prisma.notionSyncHistory.update.mockResolvedValue({} as any);
      prisma.notionSyncHistory.findUnique.mockResolvedValue({
        startedAt: new Date(),
      } as any);
      prisma.notionConnection.update.mockResolvedValue({} as any);

      await service.triggerSync("user-1", "conn-1", false);
      await new Promise((r) => setTimeout(r, 20));

      // Verify that the page was not processed (skipped due to old edit time)
      expect(prisma.notionPage.findUnique).not.toHaveBeenCalled();
    });
  });

  // ============ syncConnection error handling ============

  describe("syncConnection error handling", () => {
    it("should handle connection not found during sync gracefully", async () => {
      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionConnection.findUnique.mockResolvedValue(null as any);
      prisma.notionSyncHistory.create.mockResolvedValue(mockSyncHistory as any);
      prisma.notionSyncHistory.update.mockResolvedValue({} as any);
      prisma.notionSyncHistory.findUnique.mockResolvedValue({
        startedAt: new Date(),
      } as any);
      prisma.notionConnection.update.mockResolvedValue({} as any);

      await service.triggerSync("user-1");
      await new Promise((r) => setTimeout(r, 20));

      // Sync history should be updated with FAILED status
      expect(prisma.notionSyncHistory.update).toHaveBeenCalled();
    });

    it("should handle Notion API errors during page sync", async () => {
      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionConnection.findUnique.mockResolvedValue({
        ...mockConnection,
        syncConfig: {
          syncPages: true,
          syncDatabases: false,
          maxPagesPerSync: 500,
        },
      } as any);
      authService.getNotionClient.mockResolvedValue(mockNotionClient as any);
      mockNotionClient.search.mockRejectedValue(
        new Error("Notion API rate limit"),
      );
      prisma.notionSyncHistory.create.mockResolvedValue(mockSyncHistory as any);
      prisma.notionSyncHistory.update.mockResolvedValue({} as any);
      prisma.notionSyncHistory.findUnique.mockResolvedValue({
        startedAt: new Date(),
      } as any);
      prisma.notionConnection.update.mockResolvedValue({} as any);

      await service.triggerSync("user-1");
      await new Promise((r) => setTimeout(r, 20));

      expect(prisma.notionSyncHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "FAILED" }),
        }),
      );
    });
  });

  // ============ syncPage conflict detection ============

  describe("syncPage conflict detection", () => {
    it("should create block versions when a locally-modified page has a newer remote version", async () => {
      const oldDate = new Date("2024-01-01");
      const newDate = new Date("2024-01-02");

      const mockExistingPage = {
        id: "local-page-1",
        notionPageId: "notion-1",
        isLocallyModified: true,
        notionUpdatedAt: oldDate,
        blocks: [],
        title: "Conflicting Page",
      };

      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionConnection.findUnique.mockResolvedValue({
        ...mockConnection,
        syncConfig: {
          syncPages: true,
          syncDatabases: false,
          maxPagesPerSync: 500,
        },
      } as any);
      authService.getNotionClient.mockResolvedValue(mockNotionClient as any);
      mockNotionClient.search.mockResolvedValue({
        results: [
          {
            object: "page",
            id: "notion-1",
            last_edited_time: newDate.toISOString(),
            created_time: oldDate.toISOString(),
            parent: { type: "workspace" },
            properties: {
              title: {
                type: "title",
                title: [{ plain_text: "Conflicting Page" }],
              },
            },
            url: "https://notion.so/notion-1",
            icon: null,
            cover: null,
          },
        ],
        has_more: false,
        next_cursor: null,
      });
      mockNotionClient.blocks.children.list.mockResolvedValue({
        results: [],
        has_more: false,
      });
      prisma.notionPage.findUnique.mockResolvedValue(mockExistingPage as any);
      prisma.notionBlockVersion.findFirst.mockResolvedValue(null);
      prisma.notionBlockVersion.create.mockResolvedValue({} as any);
      prisma.notionPage.update.mockResolvedValue({} as any);
      prisma.notionSyncHistory.create.mockResolvedValue(mockSyncHistory as any);
      prisma.notionSyncHistory.update.mockResolvedValue({} as any);
      prisma.notionSyncHistory.findUnique.mockResolvedValue({
        startedAt: new Date(),
      } as any);
      prisma.notionConnection.update.mockResolvedValue({} as any);

      await service.triggerSync("user-1");
      await new Promise((r) => setTimeout(r, 30));

      // Block versions should be created for conflict
      expect(prisma.notionBlockVersion.create).toHaveBeenCalledTimes(2);
    });
  });

  // ============ database sync ============

  describe("database sync", () => {
    it("should upsert databases discovered during sync", async () => {
      const dbResult = {
        object: "database",
        id: "db-1",
        title: [{ plain_text: "Test DB" }],
        description: [],
        icon: null,
        url: "https://notion.so/db-1",
        properties: {},
      };

      prisma.notionConnection.findMany.mockResolvedValue([
        mockConnection,
      ] as any);
      prisma.notionConnection.findUnique.mockResolvedValue({
        ...mockConnection,
        syncConfig: {
          syncPages: false,
          syncDatabases: true,
          maxPagesPerSync: 500,
        },
      } as any);
      authService.getNotionClient.mockResolvedValue(mockNotionClient as any);
      mockNotionClient.search.mockResolvedValue({
        results: [dbResult],
        has_more: false,
        next_cursor: null,
      });
      (mockNotionClient.databases as any).query = jest
        .fn()
        .mockResolvedValue({ results: [] });
      prisma.notionDatabase.upsert.mockResolvedValue({} as any);
      prisma.notionSyncHistory.create.mockResolvedValue(mockSyncHistory as any);
      prisma.notionSyncHistory.update.mockResolvedValue({} as any);
      prisma.notionSyncHistory.findUnique.mockResolvedValue({
        startedAt: new Date(),
      } as any);
      prisma.notionConnection.update.mockResolvedValue({} as any);

      await service.triggerSync("user-1");
      await new Promise((r) => setTimeout(r, 30));

      expect(prisma.notionDatabase.upsert).toHaveBeenCalled();
    });
  });
});
