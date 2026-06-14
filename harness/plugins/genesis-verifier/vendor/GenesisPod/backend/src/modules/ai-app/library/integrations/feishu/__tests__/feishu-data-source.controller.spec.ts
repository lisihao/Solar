/**
 * FeishuDataSourceController unit tests
 *
 * Coverage:
 * - getStatus (configured, unconfigured)
 * - listItems (with/without filters: type, syncedToRag, limit, offset)
 * - getItem (happy path)
 * - deleteItem (happy path)
 * - batchDeleteItems (happy path, invalid body)
 * - addItem (success, missing URL, invalid URL, duplicate URL, service error)
 * - syncItemToRag (already synced, not synced)
 * - getBinding
 * - bindFeishu (success, missing openId, already-bound conflict)
 * - unbindFeishu
 * - getUserId throws 401 when no user on request
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger, HttpException, HttpStatus } from "@nestjs/common";
import { FeishuDataSourceController } from "../feishu-data-source.controller";
import { FeishuDataSourceService } from "../feishu-data-source.service";
import { FeishuAuthService } from "../feishu-auth.service";
import { Request } from "express";

// ─── mocks ───────────────────────────────────────────────────────────────────

const mockDataSourceService = {
  getStats: jest.fn(),
  getItems: jest.fn(),
  getItem: jest.fn(),
  deleteItem: jest.fn(),
  deleteItems: jest.fn(),
  urlExists: jest.fn(),
  createItem: jest.fn(),
  getFeishuBinding: jest.fn(),
  bindFeishuOpenId: jest.fn(),
  unbindFeishuOpenId: jest.fn(),
};

const mockAuthService = {
  isConfigured: jest.fn(),
  getMaskedAppId: jest.fn(),
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeRequest(userId?: string): Request {
  return {
    user: userId ? { id: userId } : undefined,
  } as unknown as Request;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("FeishuDataSourceController", () => {
  let controller: FeishuDataSourceController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeishuDataSourceController],
      providers: [
        { provide: FeishuDataSourceService, useValue: mockDataSourceService },
        { provide: FeishuAuthService, useValue: mockAuthService },
      ],
    }).compile();

    controller = module.get<FeishuDataSourceController>(
      FeishuDataSourceController,
    );

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getUserId – authentication guard
  // ──────────────────────────────────────────────────────────────────────────

  describe("getUserId (via getStatus)", () => {
    it("throws 401 Unauthorized when request has no user", async () => {
      await expect(controller.getStatus(makeRequest())).rejects.toThrow(
        new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getStatus
  // ──────────────────────────────────────────────────────────────────────────

  describe("getStatus()", () => {
    it("returns connected status with masked appId when configured", async () => {
      mockAuthService.isConfigured.mockReturnValue(true);
      mockAuthService.getMaskedAppId.mockReturnValue("cli_****");
      mockDataSourceService.getStats.mockResolvedValue({
        total: 10,
        synced: 5,
      });

      const result = await controller.getStatus(makeRequest("user-1"));
      expect(result).toEqual({
        isConnected: true,
        appId: "cli_****",
        stats: { total: 10, synced: 5 },
      });
      expect(mockDataSourceService.getStats).toHaveBeenCalledWith("user-1");
    });

    it("returns disconnected status with null appId when not configured", async () => {
      mockAuthService.isConfigured.mockReturnValue(false);
      mockDataSourceService.getStats.mockResolvedValue({ total: 0, synced: 0 });

      const result = await controller.getStatus(makeRequest("user-2"));
      expect(result.isConnected).toBe(false);
      expect(result.appId).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // listItems
  // ──────────────────────────────────────────────────────────────────────────

  describe("listItems()", () => {
    it("returns items with defaults when no query params provided", async () => {
      mockDataSourceService.getItems.mockResolvedValue({
        items: [{ id: "1" }],
        total: 1,
      });

      const result = await controller.listItems(makeRequest("user-1"));
      expect(result).toEqual({
        items: [{ id: "1" }],
        total: 1,
        limit: 50,
        offset: 0,
      });
      expect(mockDataSourceService.getItems).toHaveBeenCalledWith("user-1", {});
    });

    it("parses valid type filter", async () => {
      mockDataSourceService.getItems.mockResolvedValue({ items: [], total: 0 });
      await controller.listItems(makeRequest("user-1"), "WIKI_NODE");
      expect(mockDataSourceService.getItems).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ type: "WIKI_NODE" }),
      );
    });

    it("ignores invalid type filter values", async () => {
      mockDataSourceService.getItems.mockResolvedValue({ items: [], total: 0 });
      await controller.listItems(makeRequest("user-1"), "INVALID_TYPE");
      const callArgs = mockDataSourceService.getItems.mock.calls[0][1];
      expect(callArgs.type).toBeUndefined();
    });

    it("parses syncedToRag=true", async () => {
      mockDataSourceService.getItems.mockResolvedValue({ items: [], total: 0 });
      await controller.listItems(makeRequest("user-1"), undefined, "true");
      expect(mockDataSourceService.getItems).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ syncedToRag: true }),
      );
    });

    it("parses syncedToRag=false", async () => {
      mockDataSourceService.getItems.mockResolvedValue({ items: [], total: 0 });
      await controller.listItems(makeRequest("user-1"), undefined, "false");
      expect(mockDataSourceService.getItems).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ syncedToRag: false }),
      );
    });

    it("parses limit and offset", async () => {
      mockDataSourceService.getItems.mockResolvedValue({ items: [], total: 0 });
      const result = await controller.listItems(
        makeRequest("user-1"),
        undefined,
        undefined,
        "20",
        "40",
      );
      expect(mockDataSourceService.getItems).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ limit: 20, offset: 40 }),
      );
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(40);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getItem
  // ──────────────────────────────────────────────────────────────────────────

  describe("getItem()", () => {
    it("returns the item from service", async () => {
      const item = { id: "item-1", title: "Test" };
      mockDataSourceService.getItem.mockResolvedValue(item);

      const result = await controller.getItem(makeRequest("user-1"), "item-1");
      expect(result).toEqual(item);
      expect(mockDataSourceService.getItem).toHaveBeenCalledWith(
        "user-1",
        "item-1",
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // deleteItem
  // ──────────────────────────────────────────────────────────────────────────

  describe("deleteItem()", () => {
    it("calls service deleteItem and returns success message", async () => {
      mockDataSourceService.deleteItem.mockResolvedValue(undefined);

      const result = await controller.deleteItem(
        makeRequest("user-1"),
        "item-1",
      );
      expect(result).toEqual({ message: "Item deleted successfully" });
      expect(mockDataSourceService.deleteItem).toHaveBeenCalledWith(
        "user-1",
        "item-1",
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // batchDeleteItems
  // ──────────────────────────────────────────────────────────────────────────

  describe("batchDeleteItems()", () => {
    it("deletes multiple items and returns count", async () => {
      mockDataSourceService.deleteItems.mockResolvedValue(3);

      const result = await controller.batchDeleteItems(makeRequest("user-1"), {
        ids: ["id-1", "id-2", "id-3"],
      });
      expect(result).toEqual({ deletedCount: 3 });
    });

    it("throws 400 when ids array is empty", async () => {
      await expect(
        controller.batchDeleteItems(makeRequest("user-1"), { ids: [] }),
      ).rejects.toThrow(
        new HttpException("Invalid item IDs", HttpStatus.BAD_REQUEST),
      );
    });

    it("throws 400 when ids is not provided", async () => {
      await expect(
        controller.batchDeleteItems(
          makeRequest("user-1"),
          {} as { ids: string[] },
        ),
      ).rejects.toThrow(
        new HttpException("Invalid item IDs", HttpStatus.BAD_REQUEST),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // addItem
  // ──────────────────────────────────────────────────────────────────────────

  describe("addItem()", () => {
    it("creates item successfully with valid URL", async () => {
      mockDataSourceService.urlExists.mockResolvedValue(false);
      const created = { id: "new-1", title: "My URL" };
      mockDataSourceService.createItem.mockResolvedValue(created);

      const result = await controller.addItem(makeRequest("user-1"), {
        url: "https://example.com/page",
        title: "My URL",
      });
      expect(result).toEqual(created);
      expect(mockDataSourceService.createItem).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          type: "EXTERNAL",
          sourceUrl: "https://example.com/page",
          title: "My URL",
          syncSource: "manual",
        }),
      );
    });

    it("uses url as title when title not provided", async () => {
      mockDataSourceService.urlExists.mockResolvedValue(false);
      mockDataSourceService.createItem.mockResolvedValue({ id: "x" });

      await controller.addItem(makeRequest("user-1"), {
        url: "https://example.com",
      });
      expect(mockDataSourceService.createItem).toHaveBeenCalledWith(
        expect.objectContaining({ title: "https://example.com" }),
      );
    });

    it("throws 400 when URL is missing", async () => {
      await expect(
        controller.addItem(makeRequest("user-1"), {} as { url: string }),
      ).rejects.toThrow(
        new HttpException("URL is required", HttpStatus.BAD_REQUEST),
      );
    });

    it("throws 400 when URL format is invalid", async () => {
      await expect(
        controller.addItem(makeRequest("user-1"), { url: "not-a-valid-url" }),
      ).rejects.toThrow(
        new HttpException("Invalid URL format", HttpStatus.BAD_REQUEST),
      );
    });

    it("throws 409 when URL already exists", async () => {
      mockDataSourceService.urlExists.mockResolvedValue(true);
      await expect(
        controller.addItem(makeRequest("user-1"), {
          url: "https://example.com",
        }),
      ).rejects.toThrow(
        new HttpException("URL already exists", HttpStatus.CONFLICT),
      );
    });

    it("throws 400 when createItem service throws", async () => {
      mockDataSourceService.urlExists.mockResolvedValue(false);
      mockDataSourceService.createItem.mockRejectedValue(
        new Error("Database error"),
      );
      await expect(
        controller.addItem(makeRequest("user-1"), {
          url: "https://example.com",
        }),
      ).rejects.toThrow(
        new HttpException("Database error", HttpStatus.BAD_REQUEST),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // syncItemToRag
  // ──────────────────────────────────────────────────────────────────────────

  describe("syncItemToRag()", () => {
    it("throws 400 when item is already synced to RAG", async () => {
      mockDataSourceService.getItem.mockResolvedValue({
        id: "item-1",
        syncedToRag: true,
      });
      await expect(
        controller.syncItemToRag(makeRequest("user-1"), "item-1", {}),
      ).rejects.toThrow(
        new HttpException(
          "Item is already synced to RAG",
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it("returns not-yet-implemented response when item is not synced", async () => {
      const item = { id: "item-1", syncedToRag: false };
      mockDataSourceService.getItem.mockResolvedValue(item);

      const result = await controller.syncItemToRag(
        makeRequest("user-1"),
        "item-1",
        {},
      );
      expect(result.message).toContain("not yet implemented");
      expect(result.item).toEqual(item);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getBinding
  // ──────────────────────────────────────────────────────────────────────────

  describe("getBinding()", () => {
    it("returns binding info from service", async () => {
      const binding = { feishuOpenId: "ou_123", userId: "user-1" };
      mockDataSourceService.getFeishuBinding.mockResolvedValue(binding);

      const result = await controller.getBinding(makeRequest("user-1"));
      expect(result).toEqual(binding);
      expect(mockDataSourceService.getFeishuBinding).toHaveBeenCalledWith(
        "user-1",
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // bindFeishu
  // ──────────────────────────────────────────────────────────────────────────

  describe("bindFeishu()", () => {
    it("binds Feishu Open ID successfully", async () => {
      mockDataSourceService.bindFeishuOpenId.mockResolvedValue({
        feishuOpenId: "ou_abc123",
      });

      const result = await controller.bindFeishu(makeRequest("user-1"), {
        feishuOpenId: "ou_abc123",
      });
      expect(result).toEqual({
        message: "Feishu account bound successfully",
        feishuOpenId: "ou_abc123",
      });
    });

    it("throws 400 when feishuOpenId is empty string", async () => {
      await expect(
        controller.bindFeishu(makeRequest("user-1"), { feishuOpenId: "  " }),
      ).rejects.toThrow(
        new HttpException("Feishu Open ID is required", HttpStatus.BAD_REQUEST),
      );
    });

    it("throws 400 when feishuOpenId is not provided", async () => {
      await expect(
        controller.bindFeishu(
          makeRequest("user-1"),
          {} as { feishuOpenId: string },
        ),
      ).rejects.toThrow(
        new HttpException("Feishu Open ID is required", HttpStatus.BAD_REQUEST),
      );
    });

    it("throws 409 when Open ID is already bound to another account", async () => {
      mockDataSourceService.bindFeishuOpenId.mockRejectedValue(
        new Error("already bound to another user"),
      );
      await expect(
        controller.bindFeishu(makeRequest("user-1"), {
          feishuOpenId: "ou_taken",
        }),
      ).rejects.toThrow(
        new HttpException("already bound to another user", HttpStatus.CONFLICT),
      );
    });

    it("rethrows non-conflict errors from service", async () => {
      const err = new Error("Some other error");
      mockDataSourceService.bindFeishuOpenId.mockRejectedValue(err);
      await expect(
        controller.bindFeishu(makeRequest("user-1"), {
          feishuOpenId: "ou_abc",
        }),
      ).rejects.toThrow(err);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // unbindFeishu
  // ──────────────────────────────────────────────────────────────────────────

  describe("unbindFeishu()", () => {
    it("unbinds Feishu account and returns success message", async () => {
      mockDataSourceService.unbindFeishuOpenId.mockResolvedValue(undefined);

      const result = await controller.unbindFeishu(makeRequest("user-1"));
      expect(result).toEqual({
        message: "Feishu account unbound successfully",
      });
      expect(mockDataSourceService.unbindFeishuOpenId).toHaveBeenCalledWith(
        "user-1",
      );
    });
  });
});
