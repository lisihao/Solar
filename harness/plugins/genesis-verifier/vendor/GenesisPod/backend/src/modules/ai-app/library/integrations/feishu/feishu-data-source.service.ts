/**
 * Feishu Data Source Service
 * Manages Feishu items as a data source (Wiki nodes, docs, external links)
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { FeishuItem, FeishuItemType, Prisma } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

export interface CreateFeishuItemParams {
  userId: string;
  type: FeishuItemType;
  title: string;
  sourceUrl: string;
  description?: string;
  content?: string;
  nodeToken?: string;
  spaceId?: string;
  objToken?: string;
  author?: string;
  publishedAt?: Date;
  syncSource?: string;
  feishuOpenId?: string;
}

export interface FeishuItemWithMeta {
  id: string;
  type: FeishuItemType;
  title: string;
  description: string | null;
  sourceUrl: string;
  content: string | null;
  nodeToken: string | null;
  spaceId: string | null;
  objToken: string | null;
  author: string | null;
  publishedAt: Date | null;
  syncedAt: Date;
  syncedToRag: boolean;
  ragKnowledgeBaseId: string | null;
  createdAt: Date;
}

export interface FeishuDataSourceStats {
  totalItems: number;
  wikiNodeCount: number;
  docCount: number;
  sheetCount: number;
  bitableCount: number;
  externalCount: number;
  syncedToRagCount: number;
  lastSyncAt: Date | null;
}

@Injectable()
export class FeishuDataSourceService {
  private readonly logger = new Logger(FeishuDataSourceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new Feishu item
   */
  async createItem(
    params: CreateFeishuItemParams,
  ): Promise<FeishuItemWithMeta> {
    // Check for duplicates by URL
    const existingItem = await this.prisma.feishuItem.findUnique({
      where: {
        userId_sourceUrl: {
          userId: params.userId,
          sourceUrl: params.sourceUrl,
        },
      },
    });

    if (existingItem) {
      throw new Error("该内容已存在");
    }

    const item = await this.prisma.feishuItem.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        sourceUrl: params.sourceUrl,
        description: params.description,
        content: params.content,
        nodeToken: params.nodeToken,
        spaceId: params.spaceId,
        objToken: params.objToken,
        author: params.author,
        publishedAt: params.publishedAt,
        syncSource: params.syncSource || "feishu",
        feishuOpenId: params.feishuOpenId,
      },
    });

    this.logger.log(
      `Created Feishu item: ${item.id} for user ${params.userId}`,
    );

    return this.mapToItemWithMeta(item);
  }

  /**
   * Get items with pagination
   */
  async getItems(
    userId: string,
    options: {
      type?: FeishuItemType;
      syncedToRag?: boolean;
      limit?: number;
      offset?: number;
      orderBy?: "createdAt" | "syncedAt";
      order?: "asc" | "desc";
    } = {},
  ): Promise<{ items: FeishuItemWithMeta[]; total: number }> {
    const {
      type,
      syncedToRag,
      limit = 50,
      offset = 0,
      orderBy = "createdAt",
      order = "desc",
    } = options;

    const where: Prisma.FeishuItemWhereInput = {
      userId,
      ...(type && { type }),
      ...(syncedToRag !== undefined && { syncedToRag }),
    };

    try {
      const [items, total] = await Promise.all([
        this.prisma.feishuItem.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: { [orderBy]: order },
        }),
        this.prisma.feishuItem.count({ where }),
      ]);

      return {
        items: items.map((item) => this.mapToItemWithMeta(item)),
        total,
      };
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === "P2021"
      ) {
        this.logger.warn("[getItems] feishu_items table does not exist yet");
        return { items: [], total: 0 };
      }
      throw err;
    }
  }

  /**
   * Get a single item
   */
  async getItem(userId: string, itemId: string): Promise<FeishuItemWithMeta> {
    const item = await this.prisma.feishuItem.findFirst({
      where: { id: itemId, userId },
    });

    if (!item) {
      throw new NotFoundException("Feishu item not found");
    }

    return this.mapToItemWithMeta(item);
  }

  /**
   * Delete an item
   */
  async deleteItem(userId: string, itemId: string): Promise<void> {
    const item = await this.prisma.feishuItem.findFirst({
      where: { id: itemId, userId },
    });

    if (!item) {
      throw new NotFoundException("Feishu item not found");
    }

    await this.prisma.feishuItem.delete({ where: { id: itemId } });
    this.logger.log(`Deleted Feishu item: ${itemId}`);
  }

  /**
   * Delete multiple items
   */
  async deleteItems(userId: string, itemIds: string[]): Promise<number> {
    const result = await this.prisma.feishuItem.deleteMany({
      where: { id: { in: itemIds }, userId },
    });

    this.logger.log(`Deleted ${result.count} Feishu items for user ${userId}`);
    return result.count;
  }

  /**
   * Mark item as synced to RAG
   */
  async markSyncedToRag(
    itemId: string,
    ragDocumentId: string,
    ragKnowledgeBaseId: string,
  ): Promise<FeishuItemWithMeta> {
    const item = await this.prisma.feishuItem.update({
      where: { id: itemId },
      data: {
        syncedToRag: true,
        ragDocumentId,
        ragKnowledgeBaseId,
      },
    });

    return this.mapToItemWithMeta(item);
  }

  /**
   * Get statistics
   */
  async getStats(userId: string): Promise<FeishuDataSourceStats> {
    try {
      const [
        totalItems,
        wikiNodeCount,
        docCount,
        sheetCount,
        bitableCount,
        externalCount,
        syncedToRagCount,
        lastItem,
      ] = await Promise.all([
        this.prisma.feishuItem.count({ where: { userId } }),
        this.prisma.feishuItem.count({ where: { userId, type: "WIKI_NODE" } }),
        this.prisma.feishuItem.count({ where: { userId, type: "DOC" } }),
        this.prisma.feishuItem.count({ where: { userId, type: "SHEET" } }),
        this.prisma.feishuItem.count({ where: { userId, type: "BITABLE" } }),
        this.prisma.feishuItem.count({ where: { userId, type: "EXTERNAL" } }),
        this.prisma.feishuItem.count({ where: { userId, syncedToRag: true } }),
        this.prisma.feishuItem.findFirst({
          where: { userId },
          orderBy: { syncedAt: "desc" },
          select: { syncedAt: true },
        }),
      ]);

      return {
        totalItems,
        wikiNodeCount,
        docCount,
        sheetCount,
        bitableCount,
        externalCount,
        syncedToRagCount,
        lastSyncAt: lastItem?.syncedAt || null,
      };
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === "P2021"
      ) {
        this.logger.warn(
          "[getStats] feishu_items table does not exist yet, returning empty stats",
        );
        return {
          totalItems: 0,
          wikiNodeCount: 0,
          docCount: 0,
          sheetCount: 0,
          bitableCount: 0,
          externalCount: 0,
          syncedToRagCount: 0,
          lastSyncAt: null,
        };
      }
      throw err;
    }
  }

  /**
   * Check if URL already exists
   */
  async urlExists(userId: string, sourceUrl: string): Promise<boolean> {
    try {
      const item = await this.prisma.feishuItem.findUnique({
        where: {
          userId_sourceUrl: { userId, sourceUrl },
        },
        select: { id: true },
      });

      return !!item;
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === "P2021"
      ) {
        return false;
      }
      throw err;
    }
  }

  // =========================================================================
  // Feishu Binding Management
  // =========================================================================

  /**
   * Get user's Feishu binding info
   */
  async getFeishuBinding(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });

    const preferences = user?.preferences as Record<string, unknown> | null;
    const feishuOpenId = preferences?.feishuOpenId as string | undefined;

    return {
      isBound: !!feishuOpenId,
      feishuOpenId: feishuOpenId || null,
    };
  }

  /**
   * Bind Feishu Open ID
   */
  async bindFeishuOpenId(userId: string, feishuOpenId: string) {
    // Check if already bound to another user
    const existingUser = await this.prisma.user.findFirst({
      where: {
        preferences: {
          path: ["feishuOpenId"],
          equals: feishuOpenId,
        },
        NOT: { id: userId },
      },
    });

    if (existingUser) {
      throw new Error("This Feishu account is already bound to another user");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });

    const currentPreferences =
      (user?.preferences as Record<string, unknown>) || {};

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        preferences: {
          ...currentPreferences,
          feishuOpenId,
        },
      },
    });

    this.logger.log(`User ${userId} bound Feishu Open ID: ${feishuOpenId}`);

    return { success: true, feishuOpenId };
  }

  /**
   * Unbind Feishu Open ID
   */
  async unbindFeishuOpenId(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });

    const currentPreferences =
      (user?.preferences as Record<string, unknown>) || {};

    const { feishuOpenId: _removed, ...remainingPreferences } =
      currentPreferences;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        preferences: remainingPreferences as object,
      },
    });

    this.logger.log(`User ${userId} unbound Feishu Open ID`);

    return { success: true };
  }

  private mapToItemWithMeta(item: FeishuItem): FeishuItemWithMeta {
    return {
      id: item.id,
      type: item.type,
      title: item.title,
      description: item.description,
      sourceUrl: item.sourceUrl,
      content: item.content,
      nodeToken: item.nodeToken,
      spaceId: item.spaceId,
      objToken: item.objToken,
      author: item.author,
      publishedAt: item.publishedAt,
      syncedAt: item.syncedAt,
      syncedToRag: item.syncedToRag,
      ragKnowledgeBaseId: item.ragKnowledgeBaseId,
      createdAt: item.createdAt,
    };
  }
}
