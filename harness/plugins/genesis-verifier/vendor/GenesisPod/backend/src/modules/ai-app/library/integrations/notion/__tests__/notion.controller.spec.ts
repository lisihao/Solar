import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import { NotionController } from "../notion.controller";
import { NotionAuthService } from "../services/notion-auth.service";
import { NotionSyncService } from "../services/notion-sync.service";
import { NotionPageService } from "../services/notion-page.service";
import {
  ConnectNotionDto,
  TriggerSyncDto,
  ListPagesDto,
  LinkResourceDto,
  UpdateConnectionDto,
} from "../dto/notion.dto";

// Helpers

function mockReq(userId = "user-1") {
  return { user: { id: userId } } as any;
}

function mockRes() {
  const res = {
    redirect: jest.fn(),
  };
  return res as any;
}

describe("NotionController", () => {
  let controller: NotionController;
  let authService: jest.Mocked<NotionAuthService>;
  let syncService: jest.Mocked<NotionSyncService>;
  let pageService: jest.Mocked<NotionPageService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const authServiceMock: Partial<jest.Mocked<NotionAuthService>> = {
      getAuthorizationUrl: jest.fn(),
      exchangeCodeForToken: jest.fn(),
      disconnect: jest.fn(),
      getConnections: jest.fn(),
      getConnection: jest.fn(),
      updateConnection: jest.fn(),
      isConfigured: jest.fn(),
    };

    const syncServiceMock: Partial<jest.Mocked<NotionSyncService>> = {
      triggerSync: jest.fn(),
      getSyncStatus: jest.fn(),
      getSyncHistory: jest.fn(),
      detectPendingChanges: jest.fn(),
      syncBidirectional: jest.fn(),
      resolveConflict: jest.fn(),
    };

    const pageServiceMock: Partial<jest.Mocked<NotionPageService>> = {
      listPages: jest.fn(),
      getPage: jest.fn(),
      updatePageLocally: jest.fn(),
      pushToNotion: jest.fn(),
      linkToResource: jest.fn(),
      unlinkFromResource: jest.fn(),
      listDatabases: jest.fn(),
      getDatabase: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotionController],
      providers: [
        { provide: NotionAuthService, useValue: authServiceMock },
        { provide: NotionSyncService, useValue: syncServiceMock },
        { provide: NotionPageService, useValue: pageServiceMock },
      ],
    }).compile();

    controller = module.get<NotionController>(NotionController);
    authService = module.get(NotionAuthService);
    syncService = module.get(NotionSyncService);
    pageService = module.get(NotionPageService);
  });

  // ============ getConnectUrl ============

  describe("getConnectUrl", () => {
    it("should return authorization URL", async () => {
      authService.getAuthorizationUrl.mockReturnValue(
        "https://api.notion.com/oauth",
      );

      const result = await controller.getConnectUrl(mockReq());

      expect(authService.getAuthorizationUrl).toHaveBeenCalled();
      expect(result).toEqual({ url: "https://api.notion.com/oauth" });
    });

    it("should throw Unauthorized when no user in request", async () => {
      const req = { user: undefined } as any;

      await expect(controller.getConnectUrl(req)).rejects.toThrow(
        HttpException,
      );
    });

    it("should include userId in state parameter", async () => {
      authService.getAuthorizationUrl.mockReturnValue("https://auth-url");

      await controller.getConnectUrl(mockReq("user-42"));

      expect(authService.getAuthorizationUrl).toHaveBeenCalledWith(
        expect.stringContaining(""), // base64 encoded state
      );
      // Verify the state contains the userId
      const stateArg = authService.getAuthorizationUrl.mock
        .calls[0][0] as string;
      const decoded = JSON.parse(Buffer.from(stateArg, "base64").toString());
      expect(decoded.userId).toBe("user-42");
    });
  });

  // ============ connect ============

  describe("connect", () => {
    it("should exchange code, trigger sync, and return connection info", async () => {
      authService.exchangeCodeForToken.mockResolvedValue({
        connectionId: "conn-1",
        workspaceName: "My Workspace",
      });
      syncService.triggerSync.mockResolvedValue({
        syncId: "sync-1",
        connectionIds: ["conn-1"],
      });

      const dto: ConnectNotionDto = { code: "auth-code" };
      const result = await controller.connect(mockReq(), dto);

      expect(authService.exchangeCodeForToken).toHaveBeenCalledWith(
        "user-1",
        "auth-code",
        undefined,
      );
      expect(syncService.triggerSync).toHaveBeenCalledWith(
        "user-1",
        "conn-1",
        true,
      );
      expect(result).toEqual({
        connectionId: "conn-1",
        workspaceName: "My Workspace",
        message: "Notion workspace connected successfully",
      });
    });

    it("should still return success even if initial sync fails", async () => {
      authService.exchangeCodeForToken.mockResolvedValue({
        connectionId: "conn-1",
        workspaceName: "My Workspace",
      });
      syncService.triggerSync.mockRejectedValue(new Error("Sync failed"));

      const dto: ConnectNotionDto = { code: "auth-code" };
      const result = await controller.connect(mockReq(), dto);

      expect(result.connectionId).toBe("conn-1");
    });
  });

  // ============ callback ============

  describe("callback", () => {
    it("should redirect to frontend success URL on successful OAuth", async () => {
      const userId = "user-1";
      const state = Buffer.from(JSON.stringify({ userId })).toString("base64");
      const res = mockRes();

      authService.exchangeCodeForToken.mockResolvedValue({
        connectionId: "conn-1",
        workspaceName: "My WS",
      });
      syncService.triggerSync.mockResolvedValue({
        syncId: "sync-1",
        connectionIds: [],
      });

      await controller.callback("code-123", state, "", res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining("success=true"),
      );
    });

    it("should redirect to error URL when error parameter is present", async () => {
      const res = mockRes();

      await controller.callback("", "", "access_denied", res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining("error=access_denied"),
      );
    });

    it("should redirect to error URL when token exchange fails", async () => {
      const userId = "user-1";
      const state = Buffer.from(JSON.stringify({ userId })).toString("base64");
      const res = mockRes();

      authService.exchangeCodeForToken.mockRejectedValue(
        new Error("Token exchange failed"),
      );

      await controller.callback("bad-code", state, "", res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining("error="),
      );
    });

    it("should redirect to error URL when state is malformed", async () => {
      const res = mockRes();

      await controller.callback("code", "bad-state!!", "", res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining("error="),
      );
    });
  });

  // ============ disconnect ============

  describe("disconnect", () => {
    it("should disconnect and return success message", async () => {
      authService.disconnect.mockResolvedValue();

      const result = await controller.disconnect(mockReq(), "conn-1");

      expect(authService.disconnect).toHaveBeenCalledWith("user-1", "conn-1");
      expect(result).toEqual({ message: "Notion workspace disconnected" });
    });
  });

  // ============ getConnections ============

  describe("getConnections", () => {
    it("should return user connections wrapped in object", async () => {
      authService.getConnections.mockResolvedValue([{ id: "conn-1" }] as any);

      const result = await controller.getConnections(mockReq());

      expect(authService.getConnections).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({ connections: [{ id: "conn-1" }] });
    });
  });

  // ============ getConnection ============

  describe("getConnection", () => {
    it("should return single connection details", async () => {
      authService.getConnection.mockResolvedValue({
        id: "conn-1",
        workspaceName: "WS",
      } as any);

      const result = await controller.getConnection(mockReq(), "conn-1");

      expect(authService.getConnection).toHaveBeenCalledWith(
        "user-1",
        "conn-1",
      );
      expect(result).toEqual({
        connection: { id: "conn-1", workspaceName: "WS" },
      });
    });
  });

  // ============ updateConnection ============

  describe("updateConnection", () => {
    it("should update connection and return result", async () => {
      const updatedConn = { id: "conn-1", syncConfig: { autoSync: false } };
      authService.updateConnection.mockResolvedValue(updatedConn as any);

      const dto: UpdateConnectionDto = { syncConfig: { autoSync: false } };
      const result = await controller.updateConnection(
        mockReq(),
        "conn-1",
        dto,
      );

      expect(authService.updateConnection).toHaveBeenCalledWith(
        "user-1",
        "conn-1",
        dto,
      );
      expect(result).toEqual({ connection: updatedConn });
    });
  });

  // ============ triggerSync ============

  describe("triggerSync", () => {
    it("should trigger sync and return result", async () => {
      syncService.triggerSync.mockResolvedValue({
        syncId: "sync-1",
        connectionIds: ["conn-1"],
      });

      const dto: TriggerSyncDto = { connectionId: "conn-1", fullSync: false };
      const result = await controller.triggerSync(mockReq(), dto);

      expect(syncService.triggerSync).toHaveBeenCalledWith(
        "user-1",
        "conn-1",
        false,
      );
      expect(result).toEqual(
        expect.objectContaining({ message: "Sync started", syncId: "sync-1" }),
      );
    });
  });

  // ============ getSyncStatus ============

  describe("getSyncStatus", () => {
    it("should return sync status", async () => {
      syncService.getSyncStatus.mockResolvedValue([
        { connectionId: "conn-1", isSyncing: false },
      ] as any);

      const result = await controller.getSyncStatus(mockReq(), "conn-1");

      expect(syncService.getSyncStatus).toHaveBeenCalledWith(
        "user-1",
        "conn-1",
      );
      expect(result).toEqual({ status: expect.any(Array) });
    });
  });

  // ============ getSyncHistory ============

  describe("getSyncHistory", () => {
    it("should return sync history", async () => {
      syncService.getSyncHistory.mockResolvedValue([{ id: "hist-1" }] as any);

      const result = await controller.getSyncHistory(mockReq(), "conn-1", 5);

      expect(syncService.getSyncHistory).toHaveBeenCalledWith(
        "user-1",
        "conn-1",
        5,
      );
      expect(result).toEqual({ history: [{ id: "hist-1" }] });
    });

    it("should use default limit of 10 when not specified", async () => {
      syncService.getSyncHistory.mockResolvedValue([]);

      await controller.getSyncHistory(mockReq(), "conn-1", undefined);

      expect(syncService.getSyncHistory).toHaveBeenCalledWith(
        "user-1",
        "conn-1",
        10,
      );
    });
  });

  // ============ getPendingChanges ============

  describe("getPendingChanges", () => {
    it("should return pending changes", async () => {
      syncService.detectPendingChanges.mockResolvedValue({
        localChanges: 2,
        remoteChanges: 0,
        conflicts: 0,
      });

      const result = await controller.getPendingChanges(mockReq());

      expect(result).toEqual({
        pendingChanges: { localChanges: 2, remoteChanges: 0, conflicts: 0 },
      });
    });
  });

  // ============ syncBidirectional ============

  describe("syncBidirectional", () => {
    it("should perform bidirectional sync and return result", async () => {
      syncService.syncBidirectional.mockResolvedValue({
        success: true,
        pagesProcessed: 5,
        pagesCreated: 2,
        pagesUpdated: 3,
        pagesPushed: 1,
        conflicts: [],
        errors: [],
      });

      const result = await controller.syncBidirectional(mockReq(), {
        connectionId: "conn-1",
        direction: "both",
      });

      expect(syncService.syncBidirectional).toHaveBeenCalledWith(
        "user-1",
        "conn-1",
        {
          direction: "both",
        },
      );
      expect(result.message).toContain("1 pushed");
      expect(result.message).toContain("5 pulled");
    });
  });

  // ============ resolveConflict ============

  describe("resolveConflict", () => {
    it("should resolve conflict and return success message", async () => {
      syncService.resolveConflict.mockResolvedValue();

      const result = await controller.resolveConflict(mockReq(), {
        pageId: "page-1",
        resolution: "keep_local",
      });

      expect(syncService.resolveConflict).toHaveBeenCalledWith(
        "user-1",
        "page-1",
        "keep_local",
      );
      expect(result).toEqual({ message: "Conflict resolved" });
    });
  });

  // ============ Pages endpoints ============

  describe("listPages", () => {
    it("should return pages list", async () => {
      pageService.listPages.mockResolvedValue({
        pages: [{ id: "page-1" }] as any,
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });

      const dto: ListPagesDto = { page: 1, limit: 20 };
      const result = await controller.listPages(mockReq(), dto);

      expect(pageService.listPages).toHaveBeenCalledWith("user-1", dto);
      expect(result.pages).toHaveLength(1);
    });
  });

  describe("getPage", () => {
    it("should return page wrapped in object", async () => {
      pageService.getPage.mockResolvedValue({ id: "page-1" } as any);

      const result = await controller.getPage(mockReq(), "page-1");

      expect(result).toEqual({ page: { id: "page-1" } });
    });
  });

  describe("updatePage", () => {
    it("should update page blocks and return updated page", async () => {
      pageService.updatePageLocally.mockResolvedValue({ id: "page-1" } as any);

      const result = await controller.updatePage(mockReq(), "page-1", {
        blocks: [],
      });

      expect(pageService.updatePageLocally).toHaveBeenCalledWith(
        "user-1",
        "page-1",
        [],
      );
      expect(result).toEqual({ page: { id: "page-1" } });
    });
  });

  describe("pushPage", () => {
    it("should push page and return success message", async () => {
      pageService.pushToNotion.mockResolvedValue();

      const result = await controller.pushPage(mockReq(), "page-1");

      expect(pageService.pushToNotion).toHaveBeenCalledWith("user-1", "page-1");
      expect(result).toEqual({ message: "Changes pushed to Notion" });
    });
  });

  describe("linkResource", () => {
    it("should link page to resource and return message", async () => {
      pageService.linkToResource.mockResolvedValue();

      const dto: LinkResourceDto = { resourceId: "resource-1" };
      const result = await controller.linkResource(mockReq(), "page-1", dto);

      expect(pageService.linkToResource).toHaveBeenCalledWith(
        "user-1",
        "page-1",
        "resource-1",
      );
      expect(result).toEqual({ message: "Page linked to resource" });
    });
  });

  describe("unlinkResource", () => {
    it("should unlink page from resource and return message", async () => {
      pageService.unlinkFromResource.mockResolvedValue();

      const result = await controller.unlinkResource(mockReq(), "page-1");

      expect(pageService.unlinkFromResource).toHaveBeenCalledWith(
        "user-1",
        "page-1",
      );
      expect(result).toEqual({ message: "Page unlinked from resource" });
    });
  });

  // ============ Databases endpoints ============

  describe("listDatabases", () => {
    it("should return databases wrapped in object", async () => {
      pageService.listDatabases.mockResolvedValue([{ id: "db-1" }] as any);

      const result = await controller.listDatabases(mockReq(), "conn-1");

      expect(pageService.listDatabases).toHaveBeenCalledWith(
        "user-1",
        "conn-1",
      );
      expect(result).toEqual({ databases: [{ id: "db-1" }] });
    });
  });

  describe("getDatabase", () => {
    it("should return database wrapped in object", async () => {
      pageService.getDatabase.mockResolvedValue({ id: "db-1" } as any);

      const result = await controller.getDatabase(mockReq(), "db-1");

      expect(pageService.getDatabase).toHaveBeenCalledWith("user-1", "db-1");
      expect(result).toEqual({ database: { id: "db-1" } });
    });
  });

  // ============ getConfig ============

  describe("getConfig", () => {
    it("should return configuration status", async () => {
      authService.isConfigured.mockReturnValue(true);

      const result = await controller.getConfig();

      expect(result.configured).toBe(true);
      expect(result).toHaveProperty("callbackUrl");
    });

    it("should return configured=false when OAuth not configured", async () => {
      authService.isConfigured.mockReturnValue(false);

      const result = await controller.getConfig();

      expect(result.configured).toBe(false);
    });
  });

  // ============ Authorization guard ============

  describe("getUserId guard", () => {
    it("should throw HttpException with UNAUTHORIZED status when user missing", async () => {
      const req = { user: undefined } as any;

      let caughtError: HttpException | null = null;
      try {
        await controller.getConnections(req);
      } catch (error) {
        caughtError = error as HttpException;
      }

      expect(caughtError).toBeInstanceOf(HttpException);
      expect(caughtError?.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    });
  });
});
