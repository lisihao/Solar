import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { FeishuDataSourceService } from "../feishu-data-source.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { FeishuItemType } from "@prisma/client";

const mockPrisma = {
  feishuItem: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    userId: "user-1",
    type: "WIKI_NODE" as FeishuItemType,
    title: "Test Item",
    description: "A description",
    sourceUrl: "https://feishu.example.com/wiki/node1",
    content: "Full content here",
    nodeToken: "token123",
    spaceId: "space1",
    objToken: "obj1",
    author: "Author",
    publishedAt: new Date("2024-01-01"),
    syncedAt: new Date("2024-01-02"),
    syncedToRag: false,
    ragKnowledgeBaseId: null,
    ragDocumentId: null,
    syncSource: "feishu",
    feishuOpenId: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

describe("FeishuDataSourceService", () => {
  let service: FeishuDataSourceService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeishuDataSourceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<FeishuDataSourceService>(FeishuDataSourceService);
  });

  // =========================================================================
  // createItem
  // =========================================================================
  describe("createItem", () => {
    it("creates and returns a new feishu item", async () => {
      mockPrisma.feishuItem.findUnique.mockResolvedValueOnce(null);
      const created = makeItem();
      mockPrisma.feishuItem.create.mockResolvedValueOnce(created);

      const result = await service.createItem({
        userId: "user-1",
        type: "WIKI_NODE",
        title: "Test Item",
        sourceUrl: "https://feishu.example.com/wiki/node1",
      });

      expect(result.id).toBe("item-1");
      expect(result.title).toBe("Test Item");
      expect(mockPrisma.feishuItem.create).toHaveBeenCalledTimes(1);
    });

    it("throws if URL already exists for user", async () => {
      mockPrisma.feishuItem.findUnique.mockResolvedValueOnce(makeItem());

      await expect(
        service.createItem({
          userId: "user-1",
          type: "DOC",
          title: "Duplicate",
          sourceUrl: "https://feishu.example.com/wiki/node1",
        }),
      ).rejects.toThrow("该内容已存在");
    });

    it("uses 'feishu' as default syncSource when not provided", async () => {
      mockPrisma.feishuItem.findUnique.mockResolvedValueOnce(null);
      mockPrisma.feishuItem.create.mockResolvedValueOnce(makeItem());

      await service.createItem({
        userId: "user-1",
        type: "WIKI_NODE",
        title: "Test",
        sourceUrl: "https://example.com",
      });

      const createData = mockPrisma.feishuItem.create.mock.calls[0][0].data;
      expect(createData.syncSource).toBe("feishu");
    });

    it("uses provided syncSource when given", async () => {
      mockPrisma.feishuItem.findUnique.mockResolvedValueOnce(null);
      mockPrisma.feishuItem.create.mockResolvedValueOnce(
        makeItem({ syncSource: "api" }),
      );

      await service.createItem({
        userId: "user-1",
        type: "DOC",
        title: "From API",
        sourceUrl: "https://example.com/doc1",
        syncSource: "api",
      });

      const createData = mockPrisma.feishuItem.create.mock.calls[0][0].data;
      expect(createData.syncSource).toBe("api");
    });
  });

  // =========================================================================
  // getItems
  // =========================================================================
  describe("getItems", () => {
    it("returns paginated items with default options", async () => {
      const items = [makeItem(), makeItem({ id: "item-2", title: "Item 2" })];
      mockPrisma.feishuItem.findMany.mockResolvedValueOnce(items);
      mockPrisma.feishuItem.count.mockResolvedValueOnce(2);

      const result = await service.getItems("user-1");

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("filters by type when provided", async () => {
      mockPrisma.feishuItem.findMany.mockResolvedValueOnce([makeItem()]);
      mockPrisma.feishuItem.count.mockResolvedValueOnce(1);

      await service.getItems("user-1", { type: "WIKI_NODE" });

      const where = mockPrisma.feishuItem.findMany.mock.calls[0][0].where;
      expect(where.type).toBe("WIKI_NODE");
    });

    it("filters by syncedToRag when provided", async () => {
      mockPrisma.feishuItem.findMany.mockResolvedValueOnce([]);
      mockPrisma.feishuItem.count.mockResolvedValueOnce(0);

      await service.getItems("user-1", { syncedToRag: true });

      const where = mockPrisma.feishuItem.findMany.mock.calls[0][0].where;
      expect(where.syncedToRag).toBe(true);
    });

    it("uses custom pagination options", async () => {
      mockPrisma.feishuItem.findMany.mockResolvedValueOnce([]);
      mockPrisma.feishuItem.count.mockResolvedValueOnce(0);

      await service.getItems("user-1", { limit: 10, offset: 20 });

      const call = mockPrisma.feishuItem.findMany.mock.calls[0][0];
      expect(call.take).toBe(10);
      expect(call.skip).toBe(20);
    });

    it("uses custom orderBy and order", async () => {
      mockPrisma.feishuItem.findMany.mockResolvedValueOnce([]);
      mockPrisma.feishuItem.count.mockResolvedValueOnce(0);

      await service.getItems("user-1", { orderBy: "syncedAt", order: "asc" });

      const call = mockPrisma.feishuItem.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual({ syncedAt: "asc" });
    });
  });

  // =========================================================================
  // getItem
  // =========================================================================
  describe("getItem", () => {
    it("returns the item when found", async () => {
      mockPrisma.feishuItem.findFirst.mockResolvedValueOnce(makeItem());

      const result = await service.getItem("user-1", "item-1");

      expect(result.id).toBe("item-1");
    });

    it("throws NotFoundException when item not found", async () => {
      mockPrisma.feishuItem.findFirst.mockResolvedValueOnce(null);

      await expect(service.getItem("user-1", "missing-id")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // deleteItem
  // =========================================================================
  describe("deleteItem", () => {
    it("deletes an existing item", async () => {
      mockPrisma.feishuItem.findFirst.mockResolvedValueOnce(makeItem());
      mockPrisma.feishuItem.delete.mockResolvedValueOnce({});

      await service.deleteItem("user-1", "item-1");

      expect(mockPrisma.feishuItem.delete).toHaveBeenCalledWith({
        where: { id: "item-1" },
      });
    });

    it("throws NotFoundException if item not found before delete", async () => {
      mockPrisma.feishuItem.findFirst.mockResolvedValueOnce(null);

      await expect(service.deleteItem("user-1", "missing-id")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // deleteItems
  // =========================================================================
  describe("deleteItems", () => {
    it("deletes multiple items and returns count", async () => {
      mockPrisma.feishuItem.deleteMany.mockResolvedValueOnce({ count: 3 });

      const count = await service.deleteItems("user-1", ["id1", "id2", "id3"]);

      expect(count).toBe(3);
      expect(mockPrisma.feishuItem.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["id1", "id2", "id3"] }, userId: "user-1" },
      });
    });
  });

  // =========================================================================
  // markSyncedToRag
  // =========================================================================
  describe("markSyncedToRag", () => {
    it("updates item with rag sync data", async () => {
      const updated = makeItem({
        syncedToRag: true,
        ragDocumentId: "doc-1",
        ragKnowledgeBaseId: "kb-1",
      });
      mockPrisma.feishuItem.update.mockResolvedValueOnce(updated);

      const result = await service.markSyncedToRag("item-1", "doc-1", "kb-1");

      expect(result.syncedToRag).toBe(true);
      expect(result.ragKnowledgeBaseId).toBe("kb-1");
      expect(mockPrisma.feishuItem.update).toHaveBeenCalledWith({
        where: { id: "item-1" },
        data: {
          syncedToRag: true,
          ragDocumentId: "doc-1",
          ragKnowledgeBaseId: "kb-1",
        },
      });
    });
  });

  // =========================================================================
  // getStats
  // =========================================================================
  describe("getStats", () => {
    it("returns comprehensive stats", async () => {
      mockPrisma.feishuItem.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(4) // WIKI_NODE
        .mockResolvedValueOnce(2) // DOC
        .mockResolvedValueOnce(1) // SHEET
        .mockResolvedValueOnce(1) // BITABLE
        .mockResolvedValueOnce(2) // EXTERNAL
        .mockResolvedValueOnce(3); // syncedToRag
      mockPrisma.feishuItem.findFirst.mockResolvedValueOnce({
        syncedAt: new Date("2024-03-01"),
      });

      const stats = await service.getStats("user-1");

      expect(stats.totalItems).toBe(10);
      expect(stats.wikiNodeCount).toBe(4);
      expect(stats.docCount).toBe(2);
      expect(stats.sheetCount).toBe(1);
      expect(stats.bitableCount).toBe(1);
      expect(stats.externalCount).toBe(2);
      expect(stats.syncedToRagCount).toBe(3);
      expect(stats.lastSyncAt).toEqual(new Date("2024-03-01"));
    });

    it("returns null for lastSyncAt when no items exist", async () => {
      for (let i = 0; i < 7; i++) {
        mockPrisma.feishuItem.count.mockResolvedValueOnce(0);
      }
      mockPrisma.feishuItem.findFirst.mockResolvedValueOnce(null);

      const stats = await service.getStats("user-1");

      expect(stats.lastSyncAt).toBeNull();
    });
  });

  // =========================================================================
  // urlExists
  // =========================================================================
  describe("urlExists", () => {
    it("returns true when URL exists", async () => {
      mockPrisma.feishuItem.findUnique.mockResolvedValueOnce({ id: "item-1" });

      const result = await service.urlExists("user-1", "https://example.com");

      expect(result).toBe(true);
    });

    it("returns false when URL does not exist", async () => {
      mockPrisma.feishuItem.findUnique.mockResolvedValueOnce(null);

      const result = await service.urlExists(
        "user-1",
        "https://example.com/new",
      );

      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // getFeishuBinding
  // =========================================================================
  describe("getFeishuBinding", () => {
    it("returns binding info when feishuOpenId is present", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        preferences: { feishuOpenId: "open-id-123" },
      });

      const result = await service.getFeishuBinding("user-1");

      expect(result.isBound).toBe(true);
      expect(result.feishuOpenId).toBe("open-id-123");
    });

    it("returns unbound when preferences is null", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ preferences: null });

      const result = await service.getFeishuBinding("user-1");

      expect(result.isBound).toBe(false);
      expect(result.feishuOpenId).toBeNull();
    });

    it("returns unbound when no feishuOpenId in preferences", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        preferences: { someOtherPref: "value" },
      });

      const result = await service.getFeishuBinding("user-1");

      expect(result.isBound).toBe(false);
    });
  });

  // =========================================================================
  // bindFeishuOpenId
  // =========================================================================
  describe("bindFeishuOpenId", () => {
    it("binds feishu open id to user", async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(null); // no existing user with this openId
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        preferences: { theme: "dark" },
      });
      mockPrisma.user.update.mockResolvedValueOnce({});

      const result = await service.bindFeishuOpenId("user-1", "open-id-456");

      expect(result.success).toBe(true);
      expect(result.feishuOpenId).toBe("open-id-456");
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: {
          preferences: { theme: "dark", feishuOpenId: "open-id-456" },
        },
      });
    });

    it("throws if feishu id is already bound to another user", async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce({ id: "other-user" });

      await expect(
        service.bindFeishuOpenId("user-1", "open-id-taken"),
      ).rejects.toThrow("This Feishu account is already bound to another user");
    });
  });

  // =========================================================================
  // unbindFeishuOpenId
  // =========================================================================
  describe("unbindFeishuOpenId", () => {
    it("removes feishuOpenId from preferences", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        preferences: { feishuOpenId: "open-id-123", theme: "light" },
      });
      mockPrisma.user.update.mockResolvedValueOnce({});

      const result = await service.unbindFeishuOpenId("user-1");

      expect(result.success).toBe(true);
      const updateCall = mockPrisma.user.update.mock.calls[0][0];
      expect(updateCall.data.preferences).not.toHaveProperty("feishuOpenId");
      expect(updateCall.data.preferences).toHaveProperty("theme", "light");
    });

    it("works when preferences are empty", async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ preferences: null });
      mockPrisma.user.update.mockResolvedValueOnce({});

      const result = await service.unbindFeishuOpenId("user-1");

      expect(result.success).toBe(true);
    });
  });
});
