// Mock BillingContext before imports to avoid real async-local-storage usage
jest.mock("../../../../platform/credits/billing-context.store", () => ({
  BillingContext: {
    run: jest.fn((_ctx: unknown, fn: () => unknown) => fn()),
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { CollectionsController } from "../collections.controller";
import { CollectionsService } from "../collections.service";
import type { RequestWithUser } from "../../../../../common/types/express-request.types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(userId: string | undefined): RequestWithUser {
  return {
    user: userId ? { id: userId } : undefined,
  } as RequestWithUser;
}

const USER_ID = "user-001";

// ── Mock data ─────────────────────────────────────────────────────────────────

const mockCollection = {
  id: "col-001",
  name: "My Collection",
  userId: USER_ID,
};

const mockStats = { totalItems: 5, totalCollections: 2 };

// ── Test suite ────────────────────────────────────────────────────────────────

describe("CollectionsController", () => {
  let controller: CollectionsController;
  let collectionsService: jest.Mocked<CollectionsService>;

  beforeEach(async () => {
    const mockService = {
      createCollection: jest.fn(),
      getUserCollections: jest.fn(),
      getCollection: jest.fn(),
      updateCollection: jest.fn(),
      deleteCollection: jest.fn(),
      addToCollection: jest.fn(),
      removeFromCollection: jest.fn(),
      updateCollectionItemNote: jest.fn(),
      isResourceInUserCollections: jest.fn(),
      getUserTags: jest.fn(),
      getUserStats: jest.fn(),
      getCollectionItemsPaginated: jest.fn(),
      updateCollectionItem: jest.fn(),
      batchMoveItems: jest.fn(),
      batchDeleteItems: jest.fn(),
      batchUpdateTags: jest.fn(),
      batchUpdateStatus: jest.fn(),
      getAIOrganizeStats: jest.fn(),
      aiBatchGenerateTags: jest.fn(),
      aiSmartClassify: jest.fn(),
      aiThemeCluster: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CollectionsController],
      providers: [{ provide: CollectionsService, useValue: mockService }],
    }).compile();

    controller = module.get<CollectionsController>(CollectionsController);
    collectionsService = module.get(CollectionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── createCollection ─────────────────────────────────────────────────────────

  describe("POST /collections", () => {
    it("should delegate to collectionsService.createCollection", async () => {
      collectionsService.createCollection.mockResolvedValue(
        mockCollection as never,
      );

      const dto = { name: "My Collection" };
      const result = await controller.createCollection(makeReq(USER_ID), dto);

      expect(collectionsService.createCollection).toHaveBeenCalledWith(
        USER_ID,
        dto,
      );
      expect(result).toEqual(mockCollection);
    });

    it("should throw UnauthorizedException when user is not authenticated", async () => {
      await expect(
        controller.createCollection(makeReq(undefined), { name: "col" }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── getUserCollections ───────────────────────────────────────────────────────

  describe("GET /collections", () => {
    it("should delegate to collectionsService.getUserCollections", async () => {
      collectionsService.getUserCollections.mockResolvedValue([
        mockCollection,
      ] as never);

      const result = await controller.getUserCollections(makeReq(USER_ID));

      expect(collectionsService.getUserCollections).toHaveBeenCalledWith(
        USER_ID,
      );
      expect(result).toEqual([mockCollection]);
    });

    it("should throw UnauthorizedException when user is missing", async () => {
      await expect(
        controller.getUserCollections(makeReq(undefined)),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── getCollection ────────────────────────────────────────────────────────────

  describe("GET /collections/:id", () => {
    it("should delegate with userId from request (authenticated)", async () => {
      collectionsService.getCollection.mockResolvedValue(
        mockCollection as never,
      );

      const result = await controller.getCollection(
        "col-001",
        makeReq(USER_ID),
      );

      expect(collectionsService.getCollection).toHaveBeenCalledWith(
        "col-001",
        USER_ID,
      );
      expect(result).toEqual(mockCollection);
    });

    it("should delegate with undefined userId for anonymous access", async () => {
      collectionsService.getCollection.mockResolvedValue(
        mockCollection as never,
      );

      const result = await controller.getCollection(
        "col-001",
        makeReq(undefined),
      );

      expect(collectionsService.getCollection).toHaveBeenCalledWith(
        "col-001",
        undefined,
      );
      expect(result).toEqual(mockCollection);
    });
  });

  // ── updateCollection ─────────────────────────────────────────────────────────

  describe("PATCH /collections/:id", () => {
    it("should delegate to collectionsService.updateCollection", async () => {
      collectionsService.updateCollection.mockResolvedValue(
        mockCollection as never,
      );

      const dto = { name: "Updated Name" };
      const result = await controller.updateCollection(
        "col-001",
        makeReq(USER_ID),
        dto,
      );

      expect(collectionsService.updateCollection).toHaveBeenCalledWith(
        "col-001",
        USER_ID,
        dto,
      );
      expect(result).toEqual(mockCollection);
    });

    it("should throw UnauthorizedException when user is missing", async () => {
      await expect(
        controller.updateCollection("col-001", makeReq(undefined), {}),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── deleteCollection ─────────────────────────────────────────────────────────

  describe("DELETE /collections/:id", () => {
    it("should delegate to collectionsService.deleteCollection", async () => {
      collectionsService.deleteCollection.mockResolvedValue(undefined as never);

      await controller.deleteCollection("col-001", makeReq(USER_ID));

      expect(collectionsService.deleteCollection).toHaveBeenCalledWith(
        "col-001",
        USER_ID,
      );
    });

    it("should throw UnauthorizedException when user is missing", async () => {
      await expect(
        controller.deleteCollection("col-001", makeReq(undefined)),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── addToCollection ──────────────────────────────────────────────────────────

  describe("POST /collections/:id/items", () => {
    it("should delegate to collectionsService.addToCollection", async () => {
      const mockItem = { id: "item-001" };
      collectionsService.addToCollection.mockResolvedValue(mockItem as never);

      const dto = { resourceId: "res-001" };
      const result = await controller.addToCollection(
        "col-001",
        makeReq(USER_ID),
        dto as never,
      );

      expect(collectionsService.addToCollection).toHaveBeenCalledWith(
        "col-001",
        USER_ID,
        dto,
      );
      expect(result).toEqual(mockItem);
    });

    it("should throw UnauthorizedException when user is missing", async () => {
      await expect(
        controller.addToCollection("col-001", makeReq(undefined), {} as never),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── removeFromCollection ─────────────────────────────────────────────────────

  describe("DELETE /collections/:id/items/:resourceId", () => {
    it("should delegate to collectionsService.removeFromCollection", async () => {
      collectionsService.removeFromCollection.mockResolvedValue(
        undefined as never,
      );

      await controller.removeFromCollection(
        "col-001",
        "res-001",
        makeReq(USER_ID),
      );

      expect(collectionsService.removeFromCollection).toHaveBeenCalledWith(
        "col-001",
        "res-001",
        USER_ID,
      );
    });

    it("should throw UnauthorizedException when user is missing", async () => {
      await expect(
        controller.removeFromCollection(
          "col-001",
          "res-001",
          makeReq(undefined),
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── updateNote ───────────────────────────────────────────────────────────────

  describe("PATCH /collections/:id/items/:resourceId/note", () => {
    it("should delegate to collectionsService.updateCollectionItemNote", async () => {
      collectionsService.updateCollectionItemNote.mockResolvedValue(
        undefined as never,
      );

      await controller.updateNote("col-001", "res-001", makeReq(USER_ID), {
        note: "My note",
      });

      expect(collectionsService.updateCollectionItemNote).toHaveBeenCalledWith(
        "col-001",
        "res-001",
        USER_ID,
        "My note",
      );
    });

    it("should throw UnauthorizedException when user is missing", async () => {
      await expect(
        controller.updateNote("col-001", "res-001", makeReq(undefined), {
          note: "note",
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── checkResource ────────────────────────────────────────────────────────────

  describe("GET /collections/check/:resourceId", () => {
    it("should delegate to collectionsService.isResourceInUserCollections", async () => {
      collectionsService.isResourceInUserCollections.mockResolvedValue(
        true as never,
      );

      const result = await controller.checkResource(
        "res-001",
        makeReq(USER_ID),
      );

      expect(
        collectionsService.isResourceInUserCollections,
      ).toHaveBeenCalledWith(USER_ID, "res-001");
      expect(result).toBe(true);
    });

    it("should throw UnauthorizedException when user is missing", async () => {
      await expect(
        controller.checkResource("res-001", makeReq(undefined)),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── getUserTags ──────────────────────────────────────────────────────────────

  describe("GET /collections/tags/all", () => {
    it("should delegate to collectionsService.getUserTags", async () => {
      collectionsService.getUserTags.mockResolvedValue([
        "tag1",
        "tag2",
      ] as never);

      const result = await controller.getUserTags(makeReq(USER_ID));

      expect(collectionsService.getUserTags).toHaveBeenCalledWith(USER_ID);
      expect(result).toEqual(["tag1", "tag2"]);
    });
  });

  // ── getUserStats ─────────────────────────────────────────────────────────────

  describe("GET /collections/stats/summary", () => {
    it("should delegate to collectionsService.getUserStats", async () => {
      collectionsService.getUserStats.mockResolvedValue(mockStats as never);

      const result = await controller.getUserStats(makeReq(USER_ID));

      expect(collectionsService.getUserStats).toHaveBeenCalledWith(USER_ID);
      expect(result).toEqual(mockStats);
    });

    it("should throw UnauthorizedException when user is missing", async () => {
      await expect(controller.getUserStats(makeReq(undefined))).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── getItemsPaginated ────────────────────────────────────────────────────────

  describe("GET /collections/items/paginated", () => {
    it("should pass parsed page and limit to service", async () => {
      collectionsService.getCollectionItemsPaginated.mockResolvedValue({
        items: [],
        total: 0,
      } as never);

      await controller.getItemsPaginated(
        makeReq(USER_ID),
        "col-001",
        "2",
        "20",
        "UNREAD",
        "AI",
        "search text",
        "createdAt",
        "desc",
      );

      expect(
        collectionsService.getCollectionItemsPaginated,
      ).toHaveBeenCalledWith("col-001", USER_ID, {
        page: 2,
        limit: 20,
        status: "UNREAD",
        tag: "AI",
        search: "search text",
        sortBy: "createdAt",
        sortOrder: "desc",
      });
    });

    it("should pass null when collectionId is not provided", async () => {
      collectionsService.getCollectionItemsPaginated.mockResolvedValue({
        items: [],
      } as never);

      await controller.getItemsPaginated(makeReq(USER_ID));

      expect(
        collectionsService.getCollectionItemsPaginated,
      ).toHaveBeenCalledWith(null, USER_ID, expect.any(Object));
    });
  });

  // ── updateItem ───────────────────────────────────────────────────────────────

  describe("PATCH /collections/items/:itemId", () => {
    it("should delegate to collectionsService.updateCollectionItem", async () => {
      const updated = { id: "item-001", tags: ["new-tag"] };
      collectionsService.updateCollectionItem.mockResolvedValue(
        updated as never,
      );

      const dto = { tags: ["new-tag"] };
      const result = await controller.updateItem(
        "item-001",
        makeReq(USER_ID),
        dto as never,
      );

      expect(collectionsService.updateCollectionItem).toHaveBeenCalledWith(
        "item-001",
        USER_ID,
        dto,
      );
      expect(result).toEqual(updated);
    });
  });

  // ── batchMoveItems ───────────────────────────────────────────────────────────

  describe("POST /collections/items/batch/move", () => {
    it("should delegate to collectionsService.batchMoveItems", async () => {
      collectionsService.batchMoveItems.mockResolvedValue({
        moved: 2,
      } as never);

      const dto = {
        itemIds: ["item-1", "item-2"],
        targetCollectionId: "col-002",
      };
      const result = await controller.batchMoveItems(makeReq(USER_ID), dto);

      expect(collectionsService.batchMoveItems).toHaveBeenCalledWith(
        USER_ID,
        dto,
      );
      expect(result).toEqual({ moved: 2 });
    });

    it("should throw UnauthorizedException when user is missing", async () => {
      await expect(
        controller.batchMoveItems(makeReq(undefined), {
          itemIds: ["item-1"],
          targetCollectionId: "col-002",
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── batchDeleteItems ─────────────────────────────────────────────────────────

  describe("POST /collections/items/batch/delete", () => {
    it("should delegate to collectionsService.batchDeleteItems", async () => {
      collectionsService.batchDeleteItems.mockResolvedValue({
        deleted: 3,
      } as never);

      const dto = { itemIds: ["item-1", "item-2", "item-3"] };
      const result = await controller.batchDeleteItems(makeReq(USER_ID), dto);

      expect(collectionsService.batchDeleteItems).toHaveBeenCalledWith(
        USER_ID,
        dto,
      );
      expect(result).toEqual({ deleted: 3 });
    });
  });

  // ── batchUpdateTags ──────────────────────────────────────────────────────────

  describe("POST /collections/items/batch/tags", () => {
    it("should delegate to collectionsService.batchUpdateTags", async () => {
      collectionsService.batchUpdateTags.mockResolvedValue({
        updated: 2,
      } as never);

      const dto = {
        itemIds: ["item-1", "item-2"],
        tags: ["AI", "research"],
        operation: "add" as const,
      };

      const result = await controller.batchUpdateTags(makeReq(USER_ID), dto);

      expect(collectionsService.batchUpdateTags).toHaveBeenCalledWith(
        USER_ID,
        dto,
      );
      expect(result).toEqual({ updated: 2 });
    });
  });

  // ── batchUpdateStatus ────────────────────────────────────────────────────────

  describe("POST /collections/items/batch/status", () => {
    it("should delegate to collectionsService.batchUpdateStatus", async () => {
      collectionsService.batchUpdateStatus.mockResolvedValue({
        updated: 1,
      } as never);

      const dto = { itemIds: ["item-1"], status: "READ" as never };
      const result = await controller.batchUpdateStatus(makeReq(USER_ID), dto);

      expect(collectionsService.batchUpdateStatus).toHaveBeenCalledWith(
        USER_ID,
        dto,
      );
      expect(result).toEqual({ updated: 1 });
    });
  });

  // ── AI endpoints ─────────────────────────────────────────────────────────────

  describe("GET /collections/ai/stats", () => {
    it("should delegate to collectionsService.getAIOrganizeStats", async () => {
      collectionsService.getAIOrganizeStats.mockResolvedValue({
        processed: 10,
      } as never);

      const result = await controller.getAIOrganizeStats(makeReq(USER_ID));

      expect(collectionsService.getAIOrganizeStats).toHaveBeenCalledWith(
        USER_ID,
      );
      expect(result).toEqual({ processed: 10 });
    });
  });

  describe("POST /collections/ai/batch-tags", () => {
    it("should run aiBatchGenerateTags inside BillingContext", async () => {
      collectionsService.aiBatchGenerateTags.mockResolvedValue({
        tagged: 5,
      } as never);

      const result = await controller.aiBatchTags(makeReq(USER_ID), {
        collectionId: "col-001",
      });

      expect(collectionsService.aiBatchGenerateTags).toHaveBeenCalledWith(
        USER_ID,
        "col-001",
      );
      expect(result).toEqual({ tagged: 5 });
    });

    it("should throw UnauthorizedException when user is missing", async () => {
      await expect(
        controller.aiBatchTags(makeReq(undefined), {}),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("POST /collections/ai/smart-classify", () => {
    it("should run aiSmartClassify inside BillingContext", async () => {
      collectionsService.aiSmartClassify.mockResolvedValue({
        classified: 3,
      } as never);

      const result = await controller.aiSmartClassify(makeReq(USER_ID));

      expect(collectionsService.aiSmartClassify).toHaveBeenCalledWith(USER_ID);
      expect(result).toEqual({ classified: 3 });
    });
  });

  describe("POST /collections/ai/theme-cluster", () => {
    it("should run aiThemeCluster inside BillingContext", async () => {
      collectionsService.aiThemeCluster.mockResolvedValue({
        clusters: 2,
      } as never);

      const result = await controller.aiThemeCluster(makeReq(USER_ID));

      expect(collectionsService.aiThemeCluster).toHaveBeenCalledWith(USER_ID);
      expect(result).toEqual({ clusters: 2 });
    });

    it("should throw UnauthorizedException when user is missing", async () => {
      await expect(
        controller.aiThemeCluster(makeReq(undefined)),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
