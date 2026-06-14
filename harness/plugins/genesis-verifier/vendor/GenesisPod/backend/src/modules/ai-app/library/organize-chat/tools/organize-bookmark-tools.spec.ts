import type { ToolContext } from "@/modules/ai-engine/facade";
import { CollectionsService } from "../../collections/collections.service";
import {
  OrganizeListCollectionsTool,
  OrganizeListItemsTool,
  OrganizeCreateCollectionTool,
  OrganizeTagItemsTool,
  OrganizeMoveItemsTool,
  OrganizeSetStatusTool,
} from "./organize-bookmark-tools";

function makeContext(userId?: string): ToolContext {
  return {
    executionId: "exec-1",
    toolId: "t",
    userId,
    createdAt: new Date(),
  };
}

function makeCollections() {
  return {
    getUserCollections: jest
      .fn()
      .mockResolvedValue([{ id: "c1", name: "C1", itemCount: 3 }]),
    getCollectionItemsPaginated: jest
      .fn()
      .mockResolvedValue({ items: [{ id: "i1" }], pagination: { total: 1 } }),
    createCollection: jest.fn().mockResolvedValue({ id: "c2", name: "New" }),
    batchUpdateTags: jest.fn().mockResolvedValue({ updated: 2 }),
    batchMoveItems: jest.fn().mockResolvedValue({ moved: 2 }),
    batchUpdateStatus: jest.fn().mockResolvedValue({ updated: 2 }),
  } as unknown as CollectionsService;
}

describe("organize bookmark tools", () => {
  let collections: CollectionsService;

  beforeEach(() => {
    collections = makeCollections();
  });

  describe("行级鉴权：userId 来自 context（不信任 LLM）", () => {
    it("list-collections 用 context.userId 调 collections", async () => {
      const tool = new OrganizeListCollectionsTool(collections);
      const res = await tool.execute({}, makeContext("user-1"));

      expect(res.success).toBe(true);
      expect(collections.getUserCollections).toHaveBeenCalledWith("user-1");
      expect(res.data).toEqual({
        collections: [{ id: "c1", name: "C1", itemCount: 3 }],
      });
    });

    it("缺 userId 时失败（不静默用空 userId 改库）", async () => {
      const tool = new OrganizeListCollectionsTool(collections);
      const res = await tool.execute({}, makeContext(undefined));

      expect(res.success).toBe(false);
      expect(collections.getUserCollections).not.toHaveBeenCalled();
    });
  });

  describe("写工具透传 userId + DTO", () => {
    it("create-collection", async () => {
      const tool = new OrganizeCreateCollectionTool(collections);
      const res = await tool.execute({ name: "AI 论文" }, makeContext("u2"));

      expect(res.success).toBe(true);
      expect(collections.createCollection).toHaveBeenCalledWith("u2", {
        name: "AI 论文",
        description: undefined,
        icon: undefined,
        color: undefined,
      });
    });

    it("tag-items 默认 operation=add", async () => {
      const tool = new OrganizeTagItemsTool(collections);
      const res = await tool.execute(
        { itemIds: ["i1", "i2"], tags: ["LLM"] },
        makeContext("u3"),
      );

      expect(res.success).toBe(true);
      expect(collections.batchUpdateTags).toHaveBeenCalledWith("u3", {
        itemIds: ["i1", "i2"],
        tags: ["LLM"],
        operation: "add",
      });
    });

    it("move-items 透传 targetCollectionId", async () => {
      const tool = new OrganizeMoveItemsTool(collections);
      const res = await tool.execute(
        { itemIds: ["i1"], targetCollectionId: "c9" },
        makeContext("u4"),
      );

      expect(res.success).toBe(true);
      expect(collections.batchMoveItems).toHaveBeenCalledWith("u4", {
        itemIds: ["i1"],
        targetCollectionId: "c9",
      });
    });

    it("set-status", async () => {
      const tool = new OrganizeSetStatusTool(collections);
      const res = await tool.execute(
        { itemIds: ["i1"], status: "COMPLETED" },
        makeContext("u5"),
      );

      expect(res.success).toBe(true);
      expect(collections.batchUpdateStatus).toHaveBeenCalledWith("u5", {
        itemIds: ["i1"],
        status: "COMPLETED",
      });
    });
  });

  describe("安全：写工具单次条数上限", () => {
    it("超过 100 条拒绝（不截断、不落地）", async () => {
      const tool = new OrganizeTagItemsTool(collections);
      const itemIds = Array.from({ length: 101 }, (_, i) => `i${i}`);
      const res = await tool.execute(
        { itemIds, tags: ["x"] },
        makeContext("u6"),
      );

      expect(res.success).toBe(false);
      expect(collections.batchUpdateTags).not.toHaveBeenCalled();
    });

    it("空 itemIds 拒绝", async () => {
      const tool = new OrganizeMoveItemsTool(collections);
      const res = await tool.execute(
        { itemIds: [], targetCollectionId: "c1" },
        makeContext("u7"),
      );

      expect(res.success).toBe(false);
      expect(collections.batchMoveItems).not.toHaveBeenCalled();
    });
  });

  describe("list-items 状态过滤透传（支撑「已读的别动」）", () => {
    it("status + limit 透传给 collections", async () => {
      const tool = new OrganizeListItemsTool(collections);
      const res = await tool.execute(
        { status: "UNREAD", limit: 18 },
        makeContext("u8"),
      );

      expect(res.success).toBe(true);
      expect(collections.getCollectionItemsPaginated).toHaveBeenCalledWith(
        null,
        "u8",
        { status: "UNREAD", limit: 18 },
      );
    });
  });
});
