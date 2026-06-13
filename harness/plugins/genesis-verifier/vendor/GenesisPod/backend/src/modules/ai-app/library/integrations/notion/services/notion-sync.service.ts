import { Injectable, Logger } from "@nestjs/common";
import { Client } from "@notionhq/client";
import {
  PageObjectResponse,
  DatabaseObjectResponse,
  BlockObjectResponse,
  BlockObjectRequest,
} from "@notionhq/client/build/src/api-endpoints";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { NotionAuthService } from "./notion-auth.service";

// Enum values matching Prisma schema
const NotionSyncStatus = {
  PENDING: "PENDING",
  SYNCING: "SYNCING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
} as const;

const NotionConnectionStatus = {
  ACTIVE: "ACTIVE",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
  ERROR: "ERROR",
} as const;

interface SyncConfig {
  autoSync?: boolean;
  syncInterval?: number;
  syncOnStartup?: boolean;
  syncPages?: boolean;
  syncDatabases?: boolean;
  maxPagesPerSync?: number;
}

interface SyncResult {
  success: boolean;
  pagesProcessed: number;
  pagesCreated: number;
  pagesUpdated: number;
  pagesPushed?: number;
  databasesProcessed?: number;
  conflicts: SyncConflict[];
  errors: string[];
}

export interface SyncConflict {
  pageId: string;
  notionPageId: string;
  title: string;
  localModifiedAt: Date;
  remoteModifiedAt: Date;
}

export interface PendingChanges {
  localChanges: number;
  remoteChanges: number;
  conflicts: number;
}

@Injectable()
export class NotionSyncService {
  private readonly logger = new Logger(NotionSyncService.name);
  private syncingConnections = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: NotionAuthService,
  ) {}

  /**
   * 触发同步
   */
  async triggerSync(
    userId: string,
    connectionId?: string,
    fullSync = false,
  ): Promise<{ syncId: string; connectionIds: string[] }> {
    // 获取要同步的连接
    const connections = connectionId
      ? await this.prisma.notionConnection.findMany({
          where: {
            id: connectionId,
            userId,
            status: NotionConnectionStatus.ACTIVE,
          },
        })
      : await this.prisma.notionConnection.findMany({
          where: { userId, status: NotionConnectionStatus.ACTIVE },
        });

    if (connections.length === 0) {
      throw new Error("No active Notion connections found");
    }

    const syncIds: string[] = [];

    // 为每个连接创建同步记录并开始同步
    for (const connection of connections) {
      if (this.syncingConnections.has(connection.id)) {
        this.logger.warn(
          `Connection ${connection.id} is already syncing, skipping`,
        );
        continue;
      }

      const syncHistory = await this.prisma.notionSyncHistory.create({
        data: {
          connectionId: connection.id,
          syncType: fullSync ? "full" : "incremental",
          status: "PENDING",
          startedAt: new Date(),
        },
      });

      syncIds.push(syncHistory.id);

      // 异步执行同步
      void this.executeSyncAsync(connection.id, syncHistory.id, fullSync);
    }

    return {
      syncId: syncIds[0] || "",
      connectionIds: connections.map((c) => c.id),
    };
  }

  /**
   * 异步执行同步
   */
  private async executeSyncAsync(
    connectionId: string,
    syncHistoryId: string,
    fullSync: boolean,
  ): Promise<void> {
    this.syncingConnections.add(connectionId);

    try {
      await this.prisma.notionSyncHistory.update({
        where: { id: syncHistoryId },
        data: { status: "SYNCING" },
      });

      const result = await this.syncConnection(connectionId, fullSync);

      await this.prisma.notionSyncHistory.update({
        where: { id: syncHistoryId },
        data: {
          status: result.success ? "SUCCESS" : "FAILED",
          pagesProcessed: result.pagesProcessed,
          pagesCreated: result.pagesCreated,
          pagesUpdated: result.pagesUpdated,
          errors: result.errors.length > 0 ? result.errors : [],
          completedAt: new Date(),
          durationMs: Date.now() - (await this.getSyncStartTime(syncHistoryId)),
        },
      });

      // 更新连接的最后同步时间
      await this.prisma.notionConnection.update({
        where: { id: connectionId },
        data: {
          lastSyncAt: new Date(),
          lastError: result.errors.length > 0 ? result.errors[0] : null,
        },
      });
    } catch (error) {
      this.logger.error(`Sync failed for connection ${connectionId}: ${error}`);

      await this.prisma.notionSyncHistory.update({
        where: { id: syncHistoryId },
        data: {
          status: "FAILED",
          errors: [error instanceof Error ? error.message : String(error)],
          completedAt: new Date(),
        },
      });

      await this.prisma.notionConnection.update({
        where: { id: connectionId },
        data: {
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      this.syncingConnections.delete(connectionId);
    }
  }

  private async getSyncStartTime(syncHistoryId: string): Promise<number> {
    const history = await this.prisma.notionSyncHistory.findUnique({
      where: { id: syncHistoryId },
      select: { startedAt: true },
    });
    return history?.startedAt.getTime() || Date.now();
  }

  /**
   * 执行连接同步
   */
  private async syncConnection(
    connectionId: string,
    fullSync: boolean,
  ): Promise<SyncResult> {
    const connection = await this.prisma.notionConnection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      return {
        success: false,
        pagesProcessed: 0,
        pagesCreated: 0,
        pagesUpdated: 0,
        pagesPushed: 0,
        conflicts: [],
        errors: ["Connection not found"],
      };
    }

    const config = connection.syncConfig as SyncConfig;
    const maxPages = config.maxPagesPerSync || 500;

    const client = await this.authService.getNotionClient(connectionId);
    const result: SyncResult = {
      success: true,
      pagesProcessed: 0,
      pagesCreated: 0,
      pagesUpdated: 0,
      pagesPushed: 0,
      conflicts: [],
      errors: [],
    };

    try {
      // 获取最后同步时间（用于增量同步）
      const lastSyncAt = fullSync ? null : connection.lastSyncAt;

      // 同步页面
      if (config.syncPages !== false) {
        await this.syncPages(
          client,
          connectionId,
          lastSyncAt,
          maxPages,
          result,
        );
      }

      // 同步数据库
      if (config.syncDatabases !== false) {
        await this.syncDatabases(client, connectionId, lastSyncAt, result);
      }
    } catch (error) {
      this.logger.error(`Sync error for ${connectionId}: ${error}`);
      result.success = false;
      result.errors.push(
        error instanceof Error ? error.message : String(error),
      );
    }

    this.logger.log(
      `Sync completed for ${connectionId}: ${result.pagesProcessed} pages processed, ` +
        `${result.pagesCreated} created, ${result.pagesUpdated} updated`,
    );

    return result;
  }

  /**
   * 同步页面
   */
  private async syncPages(
    client: Client,
    connectionId: string,
    lastSyncAt: Date | null,
    maxPages: number,
    result: SyncResult,
  ): Promise<void> {
    let hasMore = true;
    let startCursor: string | undefined;
    let processedCount = 0;

    while (hasMore && processedCount < maxPages) {
      // 搜索所有页面
      const searchResponse = await client.search({
        filter: { property: "object", value: "page" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        start_cursor: startCursor,
        page_size: Math.min(100, maxPages - processedCount),
      });

      for (const pageResult of searchResponse.results) {
        if (pageResult.object !== "page") continue;
        const page = pageResult as PageObjectResponse;

        // 增量同步：跳过未修改的页面
        if (lastSyncAt) {
          const lastEdited = new Date(page.last_edited_time);
          if (lastEdited <= lastSyncAt) {
            // 已按时间排序，后面的页面都更旧，可以停止
            hasMore = false;
            break;
          }
        }

        try {
          await this.syncPage(client, connectionId, page, result);
          processedCount++;
          result.pagesProcessed++;
        } catch (error) {
          this.logger.warn(`Failed to sync page ${page.id}: ${error}`);
          result.errors.push(
            `Page ${page.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      hasMore = searchResponse.has_more && hasMore;
      startCursor = searchResponse.next_cursor || undefined;
    }
  }

  /**
   * 同步单个页面
   */
  private async syncPage(
    client: Client,
    connectionId: string,
    page: PageObjectResponse,
    result: SyncResult,
  ): Promise<void> {
    // 获取页面标题
    const title = this.extractPageTitle(page);

    // 获取页面块内容
    const blocks = await this.fetchAllBlocks(client, page.id);

    // 提取纯文本内容（用于搜索）
    const plainTextContent = this.extractPlainText(blocks);

    // 获取父级信息
    let parentType: string | null = null;
    let parentId: string | null = null;
    if (page.parent.type === "page_id") {
      parentType = "page";
      parentId = page.parent.page_id;
    } else if (page.parent.type === "database_id") {
      parentType = "database";
      parentId = page.parent.database_id;
    } else if (page.parent.type === "workspace") {
      parentType = "workspace";
    }

    // 检查是否已存在
    const existing = await this.prisma.notionPage.findUnique({
      where: {
        connectionId_notionPageId: {
          connectionId,
          notionPageId: page.id,
        },
      },
    });

    const pageData = {
      title,
      icon: this.extractIcon(page.icon),
      coverUrl:
        page.cover?.type === "external"
          ? page.cover.external.url
          : page.cover?.type === "file"
            ? page.cover.file.url
            : null,
      url: page.url,
      parentType,
      parentId,
      blocks: blocks as unknown as Prisma.InputJsonValue,
      plainTextContent,
      notionCreatedAt: new Date(page.created_time),
      notionUpdatedAt: new Date(page.last_edited_time),
      syncStatus: NotionSyncStatus.SUCCESS,
      lastSyncedAt: new Date(),
    };

    if (existing) {
      // 检查是否有本地修改冲突
      if (existing.isLocallyModified) {
        const existingNotionUpdated = existing.notionUpdatedAt;
        const newNotionUpdated = new Date(page.last_edited_time);

        if (newNotionUpdated > existingNotionUpdated) {
          // 有冲突，保存版本历史
          await this.prisma.notionBlockVersion.create({
            data: {
              pageId: existing.id,
              version: await this.getNextVersion(existing.id),
              blocks: existing.blocks as Prisma.InputJsonValue,
              source: "local",
            },
          });

          await this.prisma.notionBlockVersion.create({
            data: {
              pageId: existing.id,
              version: await this.getNextVersion(existing.id),
              blocks: blocks as unknown as Prisma.InputJsonValue,
              source: "notion",
            },
          });

          this.logger.warn(
            `Conflict detected for page ${page.id}, saved both versions`,
          );
        }
      }

      await this.prisma.notionPage.update({
        where: { id: existing.id },
        data: {
          ...pageData,
          isLocallyModified: existing.isLocallyModified, // 保持本地修改状态
        },
      });
      result.pagesUpdated++;
    } else {
      await this.prisma.notionPage.create({
        data: {
          connectionId,
          notionPageId: page.id,
          ...pageData,
        },
      });
      result.pagesCreated++;
    }
  }

  /**
   * 获取下一个版本号
   */
  private async getNextVersion(pageId: string): Promise<number> {
    const lastVersion = await this.prisma.notionBlockVersion.findFirst({
      where: { pageId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    return (lastVersion?.version || 0) + 1;
  }

  /**
   * 同步数据库
   */
  private async syncDatabases(
    client: Client,
    connectionId: string,
    _lastSyncAt: Date | null,
    result: SyncResult,
  ): Promise<void> {
    let hasMore = true;
    let startCursor: string | undefined;
    let databasesProcessed = 0;

    while (hasMore) {
      const searchResponse = await client.search({
        filter: { property: "object", value: "data_source" },
        start_cursor: startCursor,
        page_size: 100,
      });

      for (const dbResult of searchResponse.results) {
        if (!("title" in dbResult)) continue; // Filter for database objects
        const db = dbResult as unknown as DatabaseObjectResponse;

        try {
          await this.syncDatabase(client, connectionId, db);
          databasesProcessed++;
        } catch (error) {
          this.logger.warn(`Failed to sync database ${db.id}: ${error}`);
          result.errors.push(
            `Database ${db.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      hasMore = searchResponse.has_more;
      startCursor = searchResponse.next_cursor || undefined;
    }

    result.databasesProcessed = databasesProcessed;
  }

  /**
   * 同步单个数据库
   */
  private async syncDatabase(
    client: Client,
    connectionId: string,
    db: DatabaseObjectResponse,
  ): Promise<void> {
    // 获取数据库标题
    const title =
      db.title.map((t) => t.plain_text).join("") || "Untitled Database";

    // 获取数据库条目（限制数量）
    const queryResponse = await (
      client.databases as unknown as {
        query: (params: {
          database_id: string;
          page_size: number;
        }) => Promise<{ results: Array<Record<string, unknown>> }>;
      }
    ).query({
      database_id: db.id,
      page_size: 100,
    });

    const items = queryResponse.results.map((item: Record<string, unknown>) => {
      if ("properties" in item) {
        return {
          id: item.id,
          properties: item.properties,
        };
      }
      return { id: item.id };
    });

    const dbData = {
      title,
      description:
        db.description
          ?.map((d: { plain_text: string }) => d.plain_text)
          .join("") || null,
      icon: this.extractIcon(db.icon),
      url: db.url,
      properties: (db as unknown as { properties: Record<string, unknown> })
        .properties as unknown as Prisma.InputJsonValue,
      items: items as unknown as Prisma.InputJsonValue,
      itemCount: queryResponse.results.length,
      syncStatus: NotionSyncStatus.SUCCESS,
      lastSyncedAt: new Date(),
    };

    await this.prisma.notionDatabase.upsert({
      where: {
        connectionId_notionDbId: {
          connectionId,
          notionDbId: db.id,
        },
      },
      update: dbData,
      create: {
        connectionId,
        notionDbId: db.id,
        ...dbData,
      },
    });
  }

  /**
   * 获取页面的所有块
   */
  private async fetchAllBlocks(
    client: Client,
    blockId: string,
    depth = 0,
  ): Promise<BlockObjectResponse[]> {
    if (depth > 3) return []; // 限制递归深度

    const blocks: BlockObjectResponse[] = [];
    let hasMore = true;
    let startCursor: string | undefined;

    while (hasMore) {
      const response = await client.blocks.children.list({
        block_id: blockId,
        start_cursor: startCursor,
        page_size: 100,
      });

      for (const block of response.results) {
        if ("type" in block) {
          const typedBlock = block;
          blocks.push(typedBlock);

          // 递归获取子块
          if (typedBlock.has_children) {
            const children = await this.fetchAllBlocks(
              client,
              typedBlock.id,
              depth + 1,
            );
            (
              typedBlock as BlockObjectResponse & {
                children?: BlockObjectResponse[];
              }
            ).children = children;
          }
        }
      }

      hasMore = response.has_more;
      startCursor = response.next_cursor || undefined;
    }

    return blocks;
  }

  /**
   * 提取页面标题
   */
  private extractPageTitle(page: PageObjectResponse): string {
    const titleProperty = Object.values(page.properties).find(
      (prop) => prop.type === "title",
    );

    if (titleProperty?.type === "title") {
      return (
        titleProperty.title.map((t) => t.plain_text).join("") || "Untitled"
      );
    }

    return "Untitled";
  }

  /**
   * 提取图标
   */
  private extractIcon(icon: PageObjectResponse["icon"]): string | null {
    if (!icon) return null;
    if (icon.type === "emoji") return icon.emoji;
    if (icon.type === "external") return icon.external.url;
    if (icon.type === "file") return icon.file.url;
    return null;
  }

  /**
   * 从块中提取纯文本
   */
  private extractPlainText(blocks: BlockObjectResponse[]): string {
    const texts: string[] = [];

    const processBlock = (block: BlockObjectResponse) => {
      const richTextTypes = [
        "paragraph",
        "heading_1",
        "heading_2",
        "heading_3",
        "bulleted_list_item",
        "numbered_list_item",
        "to_do",
        "quote",
        "callout",
      ];

      if (richTextTypes.includes(block.type)) {
        const content = (block as Record<string, unknown>)[block.type] as
          | { rich_text?: Array<{ plain_text: string }> }
          | undefined;
        if (content?.rich_text) {
          const text = content.rich_text.map((rt) => rt.plain_text).join("");
          if (text) texts.push(text);
        }
      }

      // 处理子块
      const blockWithChildren = block as BlockObjectResponse & {
        children?: BlockObjectResponse[];
      };
      if (blockWithChildren.children) {
        for (const child of blockWithChildren.children) {
          processBlock(child);
        }
      }
    };

    for (const block of blocks) {
      processBlock(block);
    }

    return texts.join("\n");
  }

  /**
   * 获取同步状态
   */
  async getSyncStatus(userId: string, connectionId?: string) {
    const where = connectionId ? { id: connectionId, userId } : { userId };

    const connections = await this.prisma.notionConnection.findMany({
      where,
      select: {
        id: true,
        workspaceName: true,
        status: true,
        lastSyncAt: true,
        lastError: true,
        syncHistory: {
          take: 1,
          orderBy: { startedAt: "desc" },
          select: {
            id: true,
            syncType: true,
            status: true,
            pagesProcessed: true,
            pagesCreated: true,
            pagesUpdated: true,
            startedAt: true,
            completedAt: true,
            durationMs: true,
            errors: true,
          },
        },
      },
    });

    return connections.map((conn) => ({
      connectionId: conn.id,
      workspaceName: conn.workspaceName,
      status: conn.status,
      lastSyncAt: conn.lastSyncAt,
      lastError: conn.lastError,
      isSyncing: this.syncingConnections.has(conn.id),
      lastSync: conn.syncHistory[0] || null,
    }));
  }

  /**
   * 获取同步历史
   */
  async getSyncHistory(userId: string, connectionId: string, limit = 10) {
    // 验证用户有权访问此连接
    const connection = await this.prisma.notionConnection.findFirst({
      where: { id: connectionId, userId },
    });

    if (!connection) {
      throw new Error("Connection not found");
    }

    return this.prisma.notionSyncHistory.findMany({
      where: { connectionId },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }

  // ============ Bidirectional Sync Methods ============

  /**
   * 检测待同步的变更
   */
  async detectPendingChanges(
    userId: string,
    connectionId?: string,
  ): Promise<PendingChanges> {
    const connections = connectionId
      ? await this.prisma.notionConnection.findMany({
          where: {
            id: connectionId,
            userId,
            status: NotionConnectionStatus.ACTIVE,
          },
        })
      : await this.prisma.notionConnection.findMany({
          where: { userId, status: NotionConnectionStatus.ACTIVE },
        });

    if (connections.length === 0) {
      return { localChanges: 0, remoteChanges: 0, conflicts: 0 };
    }

    const connectionIds = connections.map((c) => c.id);

    // 统计本地修改的页面
    const locallyModifiedPages = await this.prisma.notionPage.count({
      where: {
        connectionId: { in: connectionIds },
        isLocallyModified: true,
      },
    });

    // 检测冲突：本地修改且远程也有更新的页面
    const conflictPages = await this.prisma.notionPage.findMany({
      where: {
        connectionId: { in: connectionIds },
        isLocallyModified: true,
      },
      select: {
        id: true,
        notionPageId: true,
        notionUpdatedAt: true,
        localModifiedAt: true,
      },
    });

    let conflicts = 0;
    for (const page of conflictPages) {
      // 如果远程更新时间晚于我们记录的远程时间，可能有冲突
      // 这里简化处理，实际需要调用 API 检查
      if (page.localModifiedAt && page.notionUpdatedAt) {
        const timeDiff = Math.abs(
          page.localModifiedAt.getTime() - page.notionUpdatedAt.getTime(),
        );
        if (timeDiff < 60000) {
          // 1分钟内的修改可能有冲突
          conflicts++;
        }
      }
    }

    return {
      localChanges: locallyModifiedPages,
      remoteChanges: 0, // 需要调用 Notion API 检查，这里简化
      conflicts,
    };
  }

  /**
   * 执行双向同步
   */
  async syncBidirectional(
    userId: string,
    connectionId?: string,
    options: { direction?: "push" | "pull" | "both" } = {},
  ): Promise<SyncResult> {
    const direction = options.direction || "both";

    const connections = connectionId
      ? await this.prisma.notionConnection.findMany({
          where: {
            id: connectionId,
            userId,
            status: NotionConnectionStatus.ACTIVE,
          },
        })
      : await this.prisma.notionConnection.findMany({
          where: { userId, status: NotionConnectionStatus.ACTIVE },
        });

    if (connections.length === 0) {
      throw new Error("No active Notion connections found");
    }

    const result: SyncResult = {
      success: true,
      pagesProcessed: 0,
      pagesCreated: 0,
      pagesUpdated: 0,
      pagesPushed: 0,
      conflicts: [],
      errors: [],
    };

    for (const connection of connections) {
      try {
        // Step 1: 推送本地变更 (如果需要)
        if (direction === "push" || direction === "both") {
          const pushResult = await this.pushLocalChanges(userId, connection.id);
          result.pagesPushed! += pushResult.pushed;
          result.conflicts.push(...pushResult.conflicts);
          result.errors.push(...pushResult.errors);
        }

        // Step 2: 拉取远程变更 (如果需要)
        if (direction === "pull" || direction === "both") {
          const pullResult = await this.syncConnection(connection.id, false);
          result.pagesProcessed += pullResult.pagesProcessed;
          result.pagesCreated += pullResult.pagesCreated;
          result.pagesUpdated += pullResult.pagesUpdated;
          result.errors.push(...pullResult.errors);
        }
      } catch (error) {
        this.logger.error(
          `Bidirectional sync failed for ${connection.id}: ${error}`,
        );
        result.errors.push(
          `Connection ${connection.workspaceName}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  /**
   * 推送所有本地修改到 Notion
   */
  private async pushLocalChanges(
    _userId: string,
    connectionId: string,
  ): Promise<{ pushed: number; conflicts: SyncConflict[]; errors: string[] }> {
    const modifiedPages = await this.prisma.notionPage.findMany({
      where: {
        connectionId,
        isLocallyModified: true,
      },
      include: {
        connection: true,
      },
    });

    const pushed: string[] = [];
    const conflicts: SyncConflict[] = [];
    const errors: string[] = [];

    for (const page of modifiedPages) {
      try {
        const client = await this.authService.getNotionClient(connectionId);

        // 检查远程是否有更新
        const remotePage = await client.pages.retrieve({
          page_id: page.notionPageId,
        });
        const remoteUpdatedAt = new Date(
          (remotePage as { last_edited_time: string }).last_edited_time,
        );

        // 如果远程有更新，记录冲突
        if (remoteUpdatedAt > page.notionUpdatedAt) {
          conflicts.push({
            pageId: page.id,
            notionPageId: page.notionPageId,
            title: page.title,
            localModifiedAt: page.localModifiedAt!,
            remoteModifiedAt: remoteUpdatedAt,
          });
          continue;
        }

        // 推送变更
        await this.pushPageToNotion(client, page);
        pushed.push(page.id);

        // 更新本地状态
        await this.prisma.notionPage.update({
          where: { id: page.id },
          data: {
            isLocallyModified: false,
            localModifiedAt: null,
            lastSyncedAt: new Date(),
          },
        });
      } catch (error) {
        errors.push(
          `Page ${page.title}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.log(
      `Pushed ${pushed.length} pages, ${conflicts.length} conflicts, ${errors.length} errors`,
    );

    return { pushed: pushed.length, conflicts, errors };
  }

  /**
   * 推送单个页面到 Notion
   */
  private async pushPageToNotion(
    client: Client,
    page: { notionPageId: string; blocks: unknown },
  ): Promise<void> {
    // 删除现有的所有块
    const existingBlocks = await client.blocks.children.list({
      block_id: page.notionPageId,
    });

    for (const block of existingBlocks.results) {
      await client.blocks.delete({ block_id: block.id });
    }

    // 添加新的块
    const blocks = page.blocks as Array<Record<string, unknown>>;
    const notionBlocks = this.convertToNotionBlocks(blocks);

    if (notionBlocks.length > 0) {
      await client.blocks.children.append({
        block_id: page.notionPageId,
        children: notionBlocks as unknown as BlockObjectRequest[],
      });
    }
  }

  /**
   * 解决同步冲突
   */
  async resolveConflict(
    userId: string,
    pageId: string,
    resolution: "keep_local" | "keep_remote",
  ): Promise<void> {
    const page = await this.prisma.notionPage.findFirst({
      where: {
        id: pageId,
        connection: { userId },
      },
      include: {
        connection: true,
      },
    });

    if (!page) {
      throw new Error("Page not found");
    }

    if (resolution === "keep_local") {
      // 强制推送本地版本
      const client = await this.authService.getNotionClient(page.connectionId);
      await this.pushPageToNotion(client, page);

      await this.prisma.notionPage.update({
        where: { id: pageId },
        data: {
          isLocallyModified: false,
          localModifiedAt: null,
          lastSyncedAt: new Date(),
        },
      });
    } else {
      // 从 Notion 重新拉取
      const client = await this.authService.getNotionClient(page.connectionId);
      const remotePage = await client.pages.retrieve({
        page_id: page.notionPageId,
      });
      const blocks = await this.fetchAllBlocks(client, page.notionPageId);

      await this.prisma.notionPage.update({
        where: { id: pageId },
        data: {
          blocks: blocks as unknown as Prisma.InputJsonValue,
          plainTextContent: this.extractPlainText(blocks),
          notionUpdatedAt: new Date(
            (remotePage as { last_edited_time: string }).last_edited_time,
          ),
          isLocallyModified: false,
          localModifiedAt: null,
          lastSyncedAt: new Date(),
        },
      });
    }

    this.logger.log(`Resolved conflict for page ${pageId} with ${resolution}`);
  }

  /**
   * 将 BlockNote 格式转换为 Notion API 格式
   */
  private convertToNotionBlocks(
    blocks: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];

    for (const block of blocks) {
      const notionBlock = this.convertBlock(block);
      if (notionBlock) {
        result.push(notionBlock);
      }
    }

    return result;
  }

  private convertBlock(
    block: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const richText = this.convertContent(
      (block.content as Array<Record<string, unknown>> | undefined) || [],
    );

    const blockProps = block.props as Record<string, unknown> | undefined;

    switch (block.type) {
      case "paragraph":
        return {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: richText },
        };

      case "heading":
        const level =
          typeof blockProps?.level === "number" ? blockProps.level : 1;
        const headingType = `heading_${Math.min(level, 3)}`;
        return {
          object: "block",
          type: headingType,
          [headingType]: { rich_text: richText },
        };

      case "bulletListItem":
        return {
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: { rich_text: richText },
        };

      case "numberedListItem":
        return {
          object: "block",
          type: "numbered_list_item",
          numbered_list_item: { rich_text: richText },
        };

      case "checkListItem":
        return {
          object: "block",
          type: "to_do",
          to_do: {
            rich_text: richText,
            checked:
              typeof blockProps?.checked === "boolean"
                ? blockProps.checked
                : false,
          },
        };

      case "codeBlock":
        return {
          object: "block",
          type: "code",
          code: {
            rich_text: richText,
            language:
              typeof blockProps?.language === "string"
                ? blockProps.language
                : "plain text",
          },
        };

      default:
        if (richText.length > 0) {
          return {
            object: "block",
            type: "paragraph",
            paragraph: { rich_text: richText },
          };
        }
        return null;
    }
  }

  private convertContent(
    content: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    return content
      .filter((item) => item.type === "text" && item.text)
      .map((item) => {
        const styles = item.styles as Record<string, boolean> | undefined;
        return {
          type: "text",
          text: { content: item.text },
          annotations: {
            bold: styles?.bold || false,
            italic: styles?.italic || false,
            strikethrough: styles?.strike || false,
            underline: styles?.underline || false,
            code: styles?.code || false,
          },
        };
      });
  }
}
