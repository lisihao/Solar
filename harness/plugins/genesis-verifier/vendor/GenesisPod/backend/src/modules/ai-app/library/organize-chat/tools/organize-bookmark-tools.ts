/**
 * 对话式整理 — 书签域 ITool（ADR-006 P1）
 *
 * 6 个工具薄封装既有 `CollectionsService`（不重写 SQL）。全部从 `context.userId`
 * （P0 已验证：AICapabilityContext.userId → ToolContext.userId）做行级鉴权，
 * 不信任 LLM 传的 userId。写工具带单次 itemIds 上限，防 LLM 误改/注入大批量。
 *
 * 隔离：这些工具注册到全局 ToolRegistry，但通过 DB ToolConfig.allowedRoles=['organize-agent']
 * 仅在 organize agent（roleId='organize-agent'）下被 AICapabilityResolver 解析出来。
 */
import { Injectable } from "@nestjs/common";
import { BaseTool } from "@/modules/ai-harness/facade/base-classes";
import type { ToolContext, JSONSchema } from "@/modules/ai-engine/facade";
import {
  CollectionsService,
  type OrganizeItemType,
} from "../../collections/collections.service";
import { ReadStatus } from "../../collections/dto/update-item.dto";

/** 数据源统一整理：非书签源（笔记/图片/飞书/Notion/Drive）的可整理类型。 */
const ORGANIZE_SOURCE_TYPES: readonly OrganizeItemType[] = [
  "NOTE",
  "IMAGE",
  "FEISHU",
  "NOTION",
  "DRIVE",
] as const;

/** 写操作单次最大条目数（评审安全加固：超限拒绝，不截断，避免部分执行状态不一致）*/
const MAX_BATCH_ITEMS = 100;

function requireUserId(context: ToolContext): string {
  const userId = context.userId;
  if (!userId) {
    throw new Error("organize tool: missing userId in tool context");
  }
  return userId;
}

function assertBatchSize(itemIds: string[]): void {
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    throw new Error("itemIds 不能为空");
  }
  if (itemIds.length > MAX_BATCH_ITEMS) {
    throw new Error(
      `单次最多操作 ${MAX_BATCH_ITEMS} 条（收到 ${itemIds.length}），请缩小范围分批处理`,
    );
  }
}

function assertSourceType(itemType: OrganizeItemType): void {
  if (!ORGANIZE_SOURCE_TYPES.includes(itemType)) {
    throw new Error(
      `organize: 不支持的源类型 ${itemType}（跨源工具仅支持 NOTE/IMAGE/FEISHU；书签用 organize-list-items）`,
    );
  }
}

// ───────────────────────────── 读工具 ─────────────────────────────

interface ListCollectionsInput {
  [key: string]: unknown;
}

@Injectable()
export class OrganizeListCollectionsTool extends BaseTool<ListCollectionsInput> {
  readonly id = "organize-list-collections";
  readonly name = "List Collections";
  readonly description =
    "列出当前用户的全部书签集合（含每个集合的条目数），用于了解现有归类结构。";
  readonly category = "information";
  readonly tags = ["organize", "bookmarks"];
  readonly sideEffect = "none" as const;
  readonly inputSchema: JSONSchema = { type: "object", properties: {} };
  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: { collections: { type: "array" } },
  };

  constructor(private readonly collections: CollectionsService) {
    super();
  }

  protected async doExecute(
    _input: ListCollectionsInput,
    context: ToolContext,
  ): Promise<unknown> {
    const userId = requireUserId(context);
    const collections = await this.collections.getUserCollections(userId);
    return {
      collections: collections.map((c) => ({
        id: c.id,
        name: c.name,
        itemCount: c.itemCount ?? 0,
      })),
    };
  }
}

interface ListItemsInput {
  collectionId?: string;
  status?: string;
  limit?: number;
}

@Injectable()
export class OrganizeListItemsTool extends BaseTool<ListItemsInput> {
  readonly id = "organize-list-items";
  readonly name = "List Bookmark Items";
  readonly description =
    "列出书签条目（可按集合、阅读状态 UNREAD/READING/COMPLETED/ARCHIVED 过滤），返回 id/标题/标签/状态。后续写工具的 itemIds 必须来自这里返回的 id。";
  readonly category = "information";
  readonly tags = ["organize", "bookmarks"];
  readonly sideEffect = "none" as const;
  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      collectionId: {
        type: "string",
        description: "限定某集合；不传=全部集合",
      },
      status: {
        type: "string",
        enum: ["UNREAD", "READING", "COMPLETED", "ARCHIVED"],
      },
      limit: { type: "number", description: "默认 30，最大 100" },
    },
  };
  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: { items: { type: "array" }, total: { type: "number" } },
  };

  constructor(private readonly collections: CollectionsService) {
    super();
  }

  protected async doExecute(
    input: ListItemsInput,
    context: ToolContext,
  ): Promise<unknown> {
    const userId = requireUserId(context);
    const result = await this.collections.getCollectionItemsPaginated(
      input.collectionId ?? null,
      userId,
      { status: input.status, limit: Math.min(input.limit ?? 30, 100) },
    );
    return { items: result.items, total: result.pagination.total };
  }
}

// ───────────────────────────── 写工具 ─────────────────────────────

interface CreateCollectionInput {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
}

@Injectable()
export class OrganizeCreateCollectionTool extends BaseTool<CreateCollectionInput> {
  readonly id = "organize-create-collection";
  readonly name = "Create Collection";
  readonly description = "新建一个书签集合（用于把相关条目归到一起）。";
  readonly category = "processing";
  readonly tags = ["organize", "bookmarks"];
  readonly sideEffect = "idempotent" as const;
  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      name: { type: "string", maxLength: 200 },
      description: { type: "string" },
      icon: { type: "string", maxLength: 10 },
      color: { type: "string", maxLength: 20 },
    },
    required: ["name"],
  };
  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: { id: { type: "string" }, name: { type: "string" } },
  };

  constructor(private readonly collections: CollectionsService) {
    super();
  }

  protected async doExecute(
    input: CreateCollectionInput,
    context: ToolContext,
  ): Promise<unknown> {
    const userId = requireUserId(context);
    const collection = await this.collections.createCollection(userId, {
      name: input.name,
      description: input.description,
      icon: input.icon,
      color: input.color,
    });
    return { id: collection.id, name: collection.name };
  }
}

interface TagItemsInput {
  itemIds: string[];
  tags: string[];
  operation?: "add" | "remove" | "set";
}

@Injectable()
export class OrganizeTagItemsTool extends BaseTool<TagItemsInput> {
  readonly id = "organize-tag-items";
  readonly name = "Tag Bookmark Items";
  readonly description =
    "给一批书签打标签。operation: add 追加 / remove 移除 / set 覆盖（set 为破坏性，谨慎）。itemIds 必须来自 organize-list-items 返回的 id。";
  readonly category = "processing";
  readonly tags = ["organize", "bookmarks"];
  readonly sideEffect = "idempotent" as const;
  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      itemIds: {
        type: "array",
        items: { type: "string" },
        maxItems: MAX_BATCH_ITEMS,
      },
      tags: { type: "array", items: { type: "string" } },
      operation: { type: "string", enum: ["add", "remove", "set"] },
    },
    required: ["itemIds", "tags"],
  };
  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: { updated: { type: "number" } },
  };

  constructor(private readonly collections: CollectionsService) {
    super();
  }

  protected async doExecute(
    input: TagItemsInput,
    context: ToolContext,
  ): Promise<unknown> {
    const userId = requireUserId(context);
    assertBatchSize(input.itemIds);
    const result = await this.collections.batchUpdateTags(userId, {
      itemIds: input.itemIds,
      tags: input.tags,
      operation: input.operation ?? "add",
    });
    return result;
  }
}

interface MoveItemsInput {
  itemIds: string[];
  targetCollectionId: string;
}

@Injectable()
export class OrganizeMoveItemsTool extends BaseTool<MoveItemsInput> {
  readonly id = "organize-move-items";
  readonly name = "Move Bookmark Items";
  readonly description =
    "把一批书签移动到目标集合。itemIds 必须来自 organize-list-items，targetCollectionId 来自 organize-list-collections 或 organize-create-collection。";
  readonly category = "processing";
  readonly tags = ["organize", "bookmarks"];
  readonly sideEffect = "idempotent" as const;
  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      itemIds: {
        type: "array",
        items: { type: "string" },
        maxItems: MAX_BATCH_ITEMS,
      },
      targetCollectionId: { type: "string" },
    },
    required: ["itemIds", "targetCollectionId"],
  };
  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: { moved: { type: "number" } },
  };

  constructor(private readonly collections: CollectionsService) {
    super();
  }

  protected async doExecute(
    input: MoveItemsInput,
    context: ToolContext,
  ): Promise<unknown> {
    const userId = requireUserId(context);
    assertBatchSize(input.itemIds);
    const result = await this.collections.batchMoveItems(userId, {
      itemIds: input.itemIds,
      targetCollectionId: input.targetCollectionId,
    });
    return result;
  }
}

interface SetStatusInput {
  itemIds: string[];
  status: "UNREAD" | "READING" | "COMPLETED" | "ARCHIVED";
}

@Injectable()
export class OrganizeSetStatusTool extends BaseTool<SetStatusInput> {
  readonly id = "organize-set-status";
  readonly name = "Set Bookmark Read Status";
  readonly description =
    "批量设置书签阅读状态（UNREAD/READING/COMPLETED/ARCHIVED）。itemIds 必须来自 organize-list-items。";
  readonly category = "processing";
  readonly tags = ["organize", "bookmarks"];
  readonly sideEffect = "idempotent" as const;
  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      itemIds: {
        type: "array",
        items: { type: "string" },
        maxItems: MAX_BATCH_ITEMS,
      },
      status: {
        type: "string",
        enum: ["UNREAD", "READING", "COMPLETED", "ARCHIVED"],
      },
    },
    required: ["itemIds", "status"],
  };
  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: { updated: { type: "number" } },
  };

  constructor(private readonly collections: CollectionsService) {
    super();
  }

  protected async doExecute(
    input: SetStatusInput,
    context: ToolContext,
  ): Promise<unknown> {
    const userId = requireUserId(context);
    assertBatchSize(input.itemIds);
    const result = await this.collections.batchUpdateStatus(userId, {
      itemIds: input.itemIds,
      status: input.status as ReadStatus,
    });
    return result;
  }
}

// ───────────────────── 数据源统一整理：跨源工具 ─────────────────────

interface ListSourceItemsInput {
  itemType: OrganizeItemType;
  limit?: number;
}

@Injectable()
export class OrganizeListSourceItemsTool extends BaseTool<ListSourceItemsInput> {
  readonly id = "organize-list-source-items";
  readonly name = "List Source Items";
  readonly description =
    "列出某数据源（NOTE 笔记 / IMAGE 图片 / FEISHU 飞书）的条目及本地整理状态。返回 sourceId（源条目 id，给 organize-assign-items 用）、collectionItemId（已纳入集合时的整理 id，给 organize-tag-items / organize-set-status 用，未纳入为 null）、所在集合、tags、状态。书签请改用 organize-list-items。";
  readonly category = "information";
  readonly tags = ["organize"];
  readonly sideEffect = "none" as const;
  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      itemType: {
        type: "string",
        enum: ["NOTE", "IMAGE", "FEISHU", "NOTION", "DRIVE"],
      },
      limit: { type: "number", description: "默认 30，最大 100" },
    },
    required: ["itemType"],
  };
  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: { items: { type: "array" }, total: { type: "number" } },
  };

  constructor(private readonly collections: CollectionsService) {
    super();
  }

  protected async doExecute(
    input: ListSourceItemsInput,
    context: ToolContext,
  ): Promise<unknown> {
    const userId = requireUserId(context);
    assertSourceType(input.itemType);
    return this.collections.listOrganizableItems(userId, input.itemType, {
      limit: input.limit,
    });
  }
}

interface AssignItemsInput {
  itemType: OrganizeItemType;
  sourceIds: string[];
  collectionId: string;
}

@Injectable()
export class OrganizeAssignItemsTool extends BaseTool<AssignItemsInput> {
  readonly id = "organize-assign-items";
  readonly name = "Assign Items To Collection";
  readonly description =
    "把一批源条目（笔记/图片/飞书）纳入某集合（建本地整理覆盖层，不动源数据）。sourceIds 必须来自 organize-list-source-items 返回的 sourceId；targetCollectionId 来自 organize-list-collections 或 organize-create-collection。返回 collectionItemIds，可直接传给 organize-tag-items / organize-set-status。";
  readonly category = "processing";
  readonly tags = ["organize"];
  readonly sideEffect = "idempotent" as const;
  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      itemType: {
        type: "string",
        enum: ["NOTE", "IMAGE", "FEISHU", "NOTION", "DRIVE"],
      },
      sourceIds: {
        type: "array",
        items: { type: "string" },
        maxItems: MAX_BATCH_ITEMS,
      },
      collectionId: { type: "string" },
    },
    required: ["itemType", "sourceIds", "collectionId"],
  };
  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: { collectionItemIds: { type: "array" } },
  };

  constructor(private readonly collections: CollectionsService) {
    super();
  }

  protected async doExecute(
    input: AssignItemsInput,
    context: ToolContext,
  ): Promise<unknown> {
    const userId = requireUserId(context);
    assertSourceType(input.itemType);
    assertBatchSize(input.sourceIds);
    return this.collections.assignItemsToCollection(userId, {
      itemType: input.itemType,
      sourceIds: input.sourceIds,
      collectionId: input.collectionId,
    });
  }
}

/** 本域全部工具（供模块 onModuleInit 注册到 ToolRegistry）*/
export const ORGANIZE_BOOKMARK_TOOL_PROVIDERS = [
  OrganizeListCollectionsTool,
  OrganizeListItemsTool,
  OrganizeCreateCollectionTool,
  OrganizeTagItemsTool,
  OrganizeMoveItemsTool,
  OrganizeSetStatusTool,
  OrganizeListSourceItemsTool,
  OrganizeAssignItemsTool,
];

/** organize agent 专用 roleId（DB ToolConfig.allowedRoles 配此值实现隔离）*/
export const ORGANIZE_AGENT_ROLE_ID = "organize-agent";
