import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client } from "@notionhq/client";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

// Enum values matching Prisma schema
const NotionConnectionStatus = {
  ACTIVE: "ACTIVE",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
  ERROR: "ERROR",
} as const;

interface NotionOAuthResponse {
  access_token: string;
  token_type: string;
  bot_id: string;
  workspace_id: string;
  workspace_name?: string;
  workspace_icon?: string;
  owner?: {
    type: string;
    user?: {
      id: string;
      name: string;
      avatar_url?: string;
    };
  };
  duplicated_template_id?: string | null;
}

@Injectable()
export class NotionAuthService {
  private readonly logger = new Logger(NotionAuthService.name);

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly callbackUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.clientId = this.configService.get<string>("NOTION_CLIENT_ID", "");
    this.clientSecret = this.configService.get<string>(
      "NOTION_CLIENT_SECRET",
      "",
    );
    this.callbackUrl = this.configService.get<string>(
      "NOTION_CALLBACK_URL",
      "http://localhost:8080/api/v1/notion/callback",
    );

    if (!this.clientId || !this.clientSecret) {
      this.logger.warn(
        "Notion OAuth not configured. Set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET environment variables.",
      );
    } else {
      this.logger.log("Notion OAuth Service initialized");
    }
  }

  /**
   * 检查 Notion OAuth 是否已配置
   */
  isConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret;
  }

  /**
   * 获取 OAuth 授权 URL
   */
  getAuthorizationUrl(state?: string): string {
    if (!this.isConfigured()) {
      throw new BadRequestException("Notion OAuth not configured");
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      owner: "user",
      redirect_uri: this.callbackUrl,
    });

    if (state) {
      params.append("state", state);
    }

    return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
  }

  /**
   * 用授权码换取访问令牌并创建连接
   */
  async exchangeCodeForToken(
    userId: string,
    code: string,
    redirectUri?: string,
  ): Promise<{ connectionId: string; workspaceName: string }> {
    if (!this.isConfigured()) {
      throw new BadRequestException("Notion OAuth not configured");
    }

    try {
      // 请求 Notion OAuth token
      const credentials = Buffer.from(
        `${this.clientId}:${this.clientSecret}`,
      ).toString("base64");

      const response = await fetch("https://api.notion.com/v1/oauth/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri || this.callbackUrl,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        this.logger.error(`Notion OAuth error: ${JSON.stringify(error)}`);
        throw new UnauthorizedException(
          `Failed to exchange code: ${error.error || "Unknown error"}`,
        );
      }

      const tokenData: NotionOAuthResponse = await response.json();

      this.logger.log(
        `Notion OAuth success for workspace: ${tokenData.workspace_name || tokenData.workspace_id}`,
      );

      // 检查是否已存在相同工作区的连接
      const existingConnection = await this.prisma.notionConnection.findUnique({
        where: {
          userId_workspaceId: {
            userId,
            workspaceId: tokenData.workspace_id,
          },
        },
      });

      if (existingConnection) {
        // 更新现有连接
        const updated = await this.prisma.notionConnection.update({
          where: { id: existingConnection.id },
          data: {
            accessToken: tokenData.access_token,
            botId: tokenData.bot_id,
            workspaceName: tokenData.workspace_name,
            workspaceIcon: tokenData.workspace_icon,
            ownerType: tokenData.owner?.type || "user",
            status: NotionConnectionStatus.ACTIVE,
            lastError: null,
          },
        });

        return {
          connectionId: updated.id,
          workspaceName: updated.workspaceName || updated.workspaceId,
        };
      }

      // 创建新连接
      const connection = await this.prisma.notionConnection.create({
        data: {
          userId,
          accessToken: tokenData.access_token,
          botId: tokenData.bot_id,
          workspaceId: tokenData.workspace_id,
          workspaceName: tokenData.workspace_name,
          workspaceIcon: tokenData.workspace_icon,
          ownerType: tokenData.owner?.type || "user",
          status: NotionConnectionStatus.ACTIVE,
          syncConfig: {
            autoSync: true,
            syncInterval: 60,
            syncOnStartup: true,
            syncPages: true,
            syncDatabases: true,
            maxPagesPerSync: 500,
          },
        },
      });

      return {
        connectionId: connection.id,
        workspaceName: connection.workspaceName || connection.workspaceId,
      };
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(`Notion OAuth exchange failed: ${error}`);
      throw new UnauthorizedException("Failed to connect to Notion");
    }
  }

  /**
   * 断开 Notion 连接
   */
  async disconnect(userId: string, connectionId: string): Promise<void> {
    const connection = await this.prisma.notionConnection.findFirst({
      where: {
        id: connectionId,
        userId,
      },
    });

    if (!connection) {
      throw new BadRequestException("Connection not found");
    }

    // 删除所有相关数据
    await this.prisma.$transaction([
      // 删除同步历史
      this.prisma.notionSyncHistory.deleteMany({
        where: { connectionId },
      }),
      // 删除块版本历史
      this.prisma.notionBlockVersion.deleteMany({
        where: {
          page: {
            connectionId,
          },
        },
      }),
      // 删除页面
      this.prisma.notionPage.deleteMany({
        where: { connectionId },
      }),
      // 删除数据库
      this.prisma.notionDatabase.deleteMany({
        where: { connectionId },
      }),
      // 删除连接
      this.prisma.notionConnection.delete({
        where: { id: connectionId },
      }),
    ]);

    this.logger.log(`Disconnected Notion workspace for user ${userId}`);
  }

  /**
   * 获取用户的所有 Notion 连接
   */
  async getConnections(userId: string) {
    const connections = await this.prisma.notionConnection.findMany({
      where: { userId },
      select: {
        id: true,
        workspaceId: true,
        workspaceName: true,
        workspaceIcon: true,
        status: true,
        lastSyncAt: true,
        lastError: true,
        syncConfig: true,
        createdAt: true,
        _count: {
          select: {
            pages: true,
            databases: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return connections.map((conn) => ({
      ...conn,
      pagesCount: conn._count.pages,
      databasesCount: conn._count.databases,
      _count: undefined,
    }));
  }

  /**
   * 获取连接详情
   */
  async getConnection(userId: string, connectionId: string) {
    const connection = await this.prisma.notionConnection.findFirst({
      where: {
        id: connectionId,
        userId,
      },
      include: {
        _count: {
          select: {
            pages: true,
            databases: true,
            syncHistory: true,
          },
        },
      },
    });

    if (!connection) {
      throw new BadRequestException("Connection not found");
    }

    // 不返回敏感的 accessToken
    const { accessToken: _accessToken, ...safeConnection } = connection;
    return {
      ...safeConnection,
      pagesCount: connection._count.pages,
      databasesCount: connection._count.databases,
    };
  }

  /**
   * 更新连接配置
   */
  async updateConnection(
    userId: string,
    connectionId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { syncConfig?: Record<string, any> },
  ) {
    const connection = await this.prisma.notionConnection.findFirst({
      where: {
        id: connectionId,
        userId,
      },
    });

    if (!connection) {
      throw new BadRequestException("Connection not found");
    }

    const updated = await this.prisma.notionConnection.update({
      where: { id: connectionId },
      data: {
        syncConfig: data.syncConfig
          ? {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ...(connection.syncConfig as Record<string, any>),
              ...data.syncConfig,
            }
          : undefined,
      },
    });

    const { accessToken: _accessToken, ...safeConnection } = updated;
    return safeConnection;
  }

  /**
   * 获取 Notion 客户端实例
   */
  async getNotionClient(connectionId: string): Promise<Client> {
    const connection = await this.prisma.notionConnection.findUnique({
      where: { id: connectionId },
      select: { accessToken: true, status: true },
    });

    if (!connection) {
      throw new BadRequestException("Connection not found");
    }

    if (connection.status !== NotionConnectionStatus.ACTIVE) {
      throw new BadRequestException(`Connection is ${connection.status}`);
    }

    return new Client({
      auth: connection.accessToken,
    });
  }

  /**
   * 验证连接是否有效
   */
  async validateConnection(connectionId: string): Promise<boolean> {
    try {
      const client = await this.getNotionClient(connectionId);
      const response = await client.users.me({});
      return !!response.id;
    } catch (error) {
      this.logger.warn(
        `Connection validation failed for ${connectionId}: ${error}`,
      );

      // 更新连接状态
      await this.prisma.notionConnection.update({
        where: { id: connectionId },
        data: {
          status: NotionConnectionStatus.ERROR,
          lastError: error instanceof Error ? error.message : String(error),
        },
      });

      return false;
    }
  }
}
