/**
 * GoogleDriveController unit tests
 *
 * Covers:
 * - GET  /connect         — getConnectUrl
 * - GET  /callback        — callback (success, error, parse failure)
 * - DELETE /disconnect    — disconnect
 * - DELETE /disconnect/:id — disconnectById (found / not found)
 * - GET  /connection      — getConnection
 * - PATCH /connection     — updateConnection
 * - GET  /connections     — getConnections
 * - GET  /connections/:id — getConnectionById (found / not found)
 * - GET  /files           — listFiles
 * - POST /import          — importFiles
 * - POST /export          — exportResources
 * - GET  /sync/status     — getSyncStatus
 * - POST /sync            — triggerSync
 * - GET  /config          — getConfig
 * - getUserId throws when no user
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpStatus, Logger } from "@nestjs/common";
import { Request, Response } from "express";

import { GoogleDriveController } from "../google-drive.controller";
import { GoogleDriveAuthService } from "../services/google-drive-auth.service";
import { GoogleDriveFileService } from "../services/google-drive-file.service";
import { GoogleDriveImportService } from "../services/google-drive-import.service";
import { GoogleDriveExportService } from "../services/google-drive-export.service";
import { GoogleDriveSyncService } from "../services/google-drive-sync.service";
import {
  ListFilesDto,
  ImportFilesDto,
  ExportResourcesDto,
  UpdateConnectionDto,
  ExportFormat,
} from "../dto/google-drive.dto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAuthReq(userId = "user-abc"): Request & { user?: { id: string } } {
  return { user: { id: userId }, headers: {} } as unknown as Request & {
    user?: { id: string };
  };
}

function makeAnonReq(): Request & { user?: { id: string } } {
  return { headers: {} } as unknown as Request & { user?: { id: string } };
}

function makeRes() {
  const res = {
    redirect: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("GoogleDriveController", () => {
  let controller: GoogleDriveController;

  let authService: jest.Mocked<
    Pick<
      GoogleDriveAuthService,
      | "getConnection"
      | "getAuthorizationUrl"
      | "exchangeCodeForToken"
      | "disconnect"
      | "updateConnection"
      | "isConfigured"
    >
  >;
  let fileService: jest.Mocked<
    Pick<GoogleDriveFileService, "listFiles" | "getFile">
  >;
  let importService: jest.Mocked<Pick<GoogleDriveImportService, "importFiles">>;
  let exportService: jest.Mocked<
    Pick<GoogleDriveExportService, "exportResources">
  >;
  let syncService: jest.Mocked<
    Pick<
      GoogleDriveSyncService,
      | "getSyncStatus"
      | "sync"
      | "resolveConflict"
      | "linkResource"
      | "unlinkResource"
      | "getSyncHistory"
    >
  >;

  const mockConnection = { id: "conn-1", email: "test@example.com" };

  beforeEach(async () => {
    authService = {
      getConnection: jest.fn().mockResolvedValue(mockConnection),
      getAuthorizationUrl: jest
        .fn()
        .mockReturnValue("https://accounts.google.com/auth"),
      exchangeCodeForToken: jest
        .fn()
        .mockResolvedValue({ email: "test@example.com" }),
      disconnect: jest.fn().mockResolvedValue(undefined),
      updateConnection: jest.fn().mockResolvedValue(mockConnection),
      isConfigured: jest.fn().mockReturnValue(true),
    };

    fileService = {
      listFiles: jest
        .fn()
        .mockResolvedValue({ files: [], nextPageToken: null }),
      getFile: jest.fn().mockResolvedValue({ id: "file-1", name: "test.pdf" }),
    };

    importService = {
      importFiles: jest.fn().mockResolvedValue({
        imported: 2,
        totalFiles: 2,
        failed: 0,
        errors: [],
      }),
    };

    exportService = {
      exportResources: jest.fn().mockResolvedValue({
        exported: 1,
        totalResources: 1,
        failed: 0,
        fileIds: ["f1"],
        errors: [],
      }),
    };

    syncService = {
      getSyncStatus: jest.fn().mockResolvedValue({ status: "synced" }),
      sync: jest.fn().mockResolvedValue({ imported: 1, exported: 1 }),
      resolveConflict: jest.fn().mockResolvedValue(undefined),
      linkResource: jest.fn().mockResolvedValue(undefined),
      unlinkResource: jest.fn().mockResolvedValue(undefined),
      getSyncHistory: jest.fn().mockResolvedValue([{ id: "hist-1" }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GoogleDriveController],
      providers: [
        { provide: GoogleDriveAuthService, useValue: authService },
        { provide: GoogleDriveFileService, useValue: fileService },
        { provide: GoogleDriveImportService, useValue: importService },
        { provide: GoogleDriveExportService, useValue: exportService },
        { provide: GoogleDriveSyncService, useValue: syncService },
      ],
    }).compile();

    controller = module.get<GoogleDriveController>(GoogleDriveController);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // getUserId helper
  // -------------------------------------------------------------------------

  describe("getUserId()", () => {
    it("throws 401 when the request has no user", async () => {
      const req = makeAnonReq();
      await expect(controller.getConnection(req)).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
    });
  });

  // -------------------------------------------------------------------------
  // GET /connect
  // -------------------------------------------------------------------------

  describe("getConnectUrl()", () => {
    it("returns an authorization URL", async () => {
      const result = await controller.getConnectUrl(makeAuthReq());

      expect(result).toHaveProperty("url");
      expect(result.url).toContain("accounts.google.com");
    });

    it("passes forceConsent=false when connection already exists", async () => {
      authService.getConnection.mockResolvedValue(mockConnection);

      await controller.getConnectUrl(makeAuthReq());

      expect(authService.getAuthorizationUrl).toHaveBeenCalledWith(
        expect.any(String),
        false,
      );
    });

    it("passes forceConsent=true when no existing connection", async () => {
      authService.getConnection.mockResolvedValue(
        null as unknown as typeof mockConnection,
      );

      await controller.getConnectUrl(makeAuthReq());

      expect(authService.getAuthorizationUrl).toHaveBeenCalledWith(
        expect.any(String),
        true,
      );
    });
  });

  // -------------------------------------------------------------------------
  // GET /callback
  // -------------------------------------------------------------------------

  describe("callback()", () => {
    it("redirects to success URL on valid code + state", async () => {
      const state = Buffer.from(
        JSON.stringify({ userId: "user-abc" }),
      ).toString("base64");
      const res = makeRes();

      await controller.callback("auth-code", state, "", res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining("success=true"),
      );
    });

    it("redirects to error URL when OAuth error param is present", async () => {
      const res = makeRes();

      await controller.callback("", "", "access_denied", res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining("error=access_denied"),
      );
    });

    it("redirects to error URL when token exchange throws", async () => {
      authService.exchangeCodeForToken.mockRejectedValue(
        new Error("invalid_code"),
      );
      const state = Buffer.from(
        JSON.stringify({ userId: "user-abc" }),
      ).toString("base64");
      const res = makeRes();

      await controller.callback("bad-code", state, "", res);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining("error="),
      );
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /disconnect
  // -------------------------------------------------------------------------

  describe("disconnect()", () => {
    it("disconnects the user and returns a message", async () => {
      const result = await controller.disconnect(makeAuthReq());

      expect(authService.disconnect).toHaveBeenCalledWith("user-abc");
      expect(result.message).toContain("disconnected");
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /disconnect/:connectionId
  // -------------------------------------------------------------------------

  describe("disconnectById()", () => {
    it("disconnects when connectionId matches", async () => {
      const result = await controller.disconnectById(makeAuthReq(), "conn-1");

      expect(authService.disconnect).toHaveBeenCalledWith("user-abc");
      expect(result.message).toContain("disconnected");
    });

    it("throws 404 when connection not found", async () => {
      authService.getConnection.mockResolvedValue(
        null as unknown as typeof mockConnection,
      );

      await expect(
        controller.disconnectById(makeAuthReq(), "conn-999"),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });

    it("throws 404 when connectionId does not belong to user", async () => {
      await expect(
        controller.disconnectById(makeAuthReq(), "wrong-id"),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });
  });

  // -------------------------------------------------------------------------
  // GET /connection
  // -------------------------------------------------------------------------

  describe("getConnection()", () => {
    it("returns the connection for the authenticated user", async () => {
      const result = await controller.getConnection(makeAuthReq());

      expect(result.connection).toEqual(mockConnection);
    });
  });

  // -------------------------------------------------------------------------
  // GET /connections
  // -------------------------------------------------------------------------

  describe("getConnections()", () => {
    it("returns an array containing the existing connection", async () => {
      const result = await controller.getConnections(makeAuthReq());

      expect(result.connections).toHaveLength(1);
      expect(result.connections[0]).toEqual(mockConnection);
    });

    it("returns an empty array when no connection exists", async () => {
      authService.getConnection.mockResolvedValue(
        null as unknown as typeof mockConnection,
      );

      const result = await controller.getConnections(makeAuthReq());

      expect(result.connections).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // GET /connections/:id
  // -------------------------------------------------------------------------

  describe("getConnectionById()", () => {
    it("returns connection when id matches", async () => {
      const result = await controller.getConnectionById(
        makeAuthReq(),
        "conn-1",
      );

      expect(result.connection).toEqual(mockConnection);
    });

    it("throws 404 when id does not match", async () => {
      await expect(
        controller.getConnectionById(makeAuthReq(), "wrong-id"),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /connection & /connections/:id
  // -------------------------------------------------------------------------

  describe("updateConnection()", () => {
    it("calls authService.updateConnection and returns the updated connection", async () => {
      const dto: UpdateConnectionDto = { syncConfig: { autoSync: true } };
      const result = await controller.updateConnection(makeAuthReq(), dto);

      expect(authService.updateConnection).toHaveBeenCalledWith(
        "user-abc",
        dto,
      );
      expect(result.connection).toEqual(mockConnection);
    });
  });

  // -------------------------------------------------------------------------
  // GET /files
  // -------------------------------------------------------------------------

  describe("listFiles()", () => {
    it("delegates to fileService and returns the result", async () => {
      const dto: ListFilesDto = { pageSize: 10 };
      const result = await controller.listFiles(makeAuthReq(), dto);

      expect(fileService.listFiles).toHaveBeenCalledWith("user-abc", dto);
      expect(result).toHaveProperty("files");
    });
  });

  // -------------------------------------------------------------------------
  // POST /import
  // -------------------------------------------------------------------------

  describe("importFiles()", () => {
    it("delegates to importService and returns a summary message", async () => {
      const dto: ImportFilesDto = { fileIds: ["file-1", "file-2"] };
      const result = await controller.importFiles(makeAuthReq(), dto);

      expect(importService.importFiles).toHaveBeenCalledWith("user-abc", dto);
      expect(result.message).toContain("Imported");
    });
  });

  // -------------------------------------------------------------------------
  // POST /export
  // -------------------------------------------------------------------------

  describe("exportResources()", () => {
    it("delegates to exportService and returns a summary message", async () => {
      const dto: ExportResourcesDto = {
        resourceIds: ["res-1"],
        format: ExportFormat.MARKDOWN,
      };
      const result = await controller.exportResources(makeAuthReq(), dto);

      expect(exportService.exportResources).toHaveBeenCalledWith(
        "user-abc",
        dto,
      );
      expect(result.message).toContain("Exported");
    });
  });

  // -------------------------------------------------------------------------
  // GET /sync/status
  // -------------------------------------------------------------------------

  describe("getSyncStatus()", () => {
    it("returns the sync status", async () => {
      const result = await controller.getSyncStatus(makeAuthReq());

      expect(result).toHaveProperty("status");
    });

    it("returns not_connected when syncService throws", async () => {
      syncService.getSyncStatus.mockRejectedValue(new Error("not connected"));

      const result = await controller.getSyncStatus(makeAuthReq());

      expect(result).toEqual({ status: "not_connected" });
    });
  });

  // -------------------------------------------------------------------------
  // POST /sync
  // -------------------------------------------------------------------------

  describe("triggerSync()", () => {
    it("calls syncService.sync and returns a message", async () => {
      const result = await controller.triggerSync(makeAuthReq(), {});

      expect(syncService.sync).toHaveBeenCalledWith("user-abc", {
        forceDirection: undefined,
      });
      expect(result.message).toContain("Synced");
    });

    it("passes forceDirection to syncService.sync", async () => {
      await controller.triggerSync(makeAuthReq(), { direction: "import" });

      expect(syncService.sync).toHaveBeenCalledWith("user-abc", {
        forceDirection: "import",
      });
    });
  });

  // -------------------------------------------------------------------------
  // GET /config
  // -------------------------------------------------------------------------

  describe("getConfig()", () => {
    it("returns configured status and redirectUri", async () => {
      const result = await controller.getConfig();

      expect(result.configured).toBe(true);
      expect(result).toHaveProperty("redirectUri");
    });
  });
});
