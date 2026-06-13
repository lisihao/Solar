import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OAuth2Client } from "google-auth-library";
import { oauth2 } from "@googleapis/oauth2";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

// Google Drive connection status
const GoogleDriveConnectionStatus = {
  ACTIVE: "ACTIVE",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
  ERROR: "ERROR",
} as const;

// Google OAuth scopes
const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

@Injectable()
export class GoogleDriveAuthService {
  private readonly logger = new Logger(GoogleDriveAuthService.name);

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly oauth2Client: OAuth2Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.clientId = this.configService.get<string>("GOOGLE_CLIENT_ID", "");
    this.clientSecret = this.configService.get<string>(
      "GOOGLE_CLIENT_SECRET",
      "",
    );
    this.redirectUri = this.configService.get<string>(
      "GOOGLE_DRIVE_REDIRECT_URI",
      "http://localhost:8080/api/v1/google-drive/callback",
    );

    if (!this.clientId || !this.clientSecret) {
      this.logger.warn(
        "Google Drive OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.",
      );
    } else {
      this.logger.log("Google Drive OAuth Service initialized");
    }

    // Initialize OAuth2 client
    this.oauth2Client = new OAuth2Client(
      this.clientId,
      this.clientSecret,
      this.redirectUri,
    );
  }

  /**
   * 检查 Google Drive OAuth 是否已配置
   */
  isConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret;
  }

  /**
   * 获取 OAuth 授权 URL
   * @param state 状态参数
   * @param forceConsent 是否强制显示授权页面（首次连接需要，以获取 refresh_token）
   */
  getAuthorizationUrl(state?: string, forceConsent = false): string {
    if (!this.isConfigured()) {
      throw new BadRequestException("Google Drive OAuth not configured");
    }

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      state: state,
      // 只在首次连接时强制 consent 以获取 refresh_token
      // 后续重新授权时只需选择账号即可
      prompt: forceConsent ? "consent" : "select_account",
    });

    return authUrl;
  }

  /**
   * 用授权码换取访问令牌并创建连接
   */
  async exchangeCodeForToken(
    userId: string,
    code: string,
  ): Promise<{ connectionId: string; email: string }> {
    if (!this.isConfigured()) {
      throw new BadRequestException("Google Drive OAuth not configured");
    }

    try {
      // 交换授权码获取 tokens
      const { tokens } = await this.oauth2Client.getToken(code);

      if (!tokens.access_token || !tokens.refresh_token) {
        throw new UnauthorizedException(
          "Failed to obtain access token or refresh token",
        );
      }

      // 使用 access_token 获取用户信息
      this.oauth2Client.setCredentials(tokens);
      const oauth2Client = oauth2({ version: "v2", auth: this.oauth2Client });
      const userInfo = await oauth2Client.userinfo.get();

      const email = userInfo.data.email || "";
      const googleId = userInfo.data.id || "";
      const displayName = userInfo.data.name || email;
      const photoUrl = userInfo.data.picture || null;

      this.logger.log(`Google OAuth success for user: ${email}`);

      // 检查是否已存在相同用户的连接
      const existingConnection =
        await this.prisma.googleDriveConnection.findUnique({
          where: { userId },
        });

      if (existingConnection) {
        // 更新现有连接
        const updated = await this.prisma.googleDriveConnection.update({
          where: { id: existingConnection.id },
          data: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            tokenExpiry: tokens.expiry_date
              ? new Date(tokens.expiry_date)
              : new Date(Date.now() + 3600000),
            googleId,
            email,
            displayName,
            photoUrl,
            status: GoogleDriveConnectionStatus.ACTIVE,
            lastError: null,
          },
        });

        return {
          connectionId: updated.id,
          email: updated.email,
        };
      }

      // 创建新连接
      const connection = await this.prisma.googleDriveConnection.create({
        data: {
          userId,
          googleId,
          email,
          displayName,
          photoUrl,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiry: tokens.expiry_date
            ? new Date(tokens.expiry_date)
            : new Date(Date.now() + 3600000),
          status: GoogleDriveConnectionStatus.ACTIVE,
        },
      });

      return {
        connectionId: connection.id,
        email: connection.email,
      };
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(`Google OAuth exchange failed: ${error}`);
      throw new UnauthorizedException("Failed to connect to Google Drive");
    }
  }

  /**
   * 刷新访问令牌
   */
  async refreshAccessToken(connectionId: string): Promise<string> {
    const connection = await this.prisma.googleDriveConnection.findUnique({
      where: { id: connectionId },
      select: { refreshToken: true, status: true },
    });

    if (!connection) {
      throw new BadRequestException("Connection not found");
    }

    if (!connection.refreshToken) {
      throw new UnauthorizedException("No refresh token available");
    }

    try {
      this.oauth2Client.setCredentials({
        refresh_token: connection.refreshToken,
      });

      const { credentials } = await this.oauth2Client.refreshAccessToken();

      if (!credentials.access_token) {
        throw new UnauthorizedException("Failed to refresh access token");
      }

      // 更新数据库中的 token
      await this.prisma.googleDriveConnection.update({
        where: { id: connectionId },
        data: {
          accessToken: credentials.access_token,
          tokenExpiry: credentials.expiry_date
            ? new Date(credentials.expiry_date)
            : new Date(Date.now() + 3600000),
          status: GoogleDriveConnectionStatus.ACTIVE,
        },
      });

      return credentials.access_token;
    } catch (error) {
      this.logger.error(`Token refresh failed for ${connectionId}: ${error}`);

      await this.prisma.googleDriveConnection.update({
        where: { id: connectionId },
        data: {
          status: GoogleDriveConnectionStatus.ERROR,
          lastError: error instanceof Error ? error.message : String(error),
        },
      });

      throw new UnauthorizedException("Failed to refresh access token");
    }
  }

  /**
   * 断开 Google Drive 连接
   */
  async disconnect(userId: string): Promise<void> {
    const connection = await this.prisma.googleDriveConnection.findFirst({
      where: { userId },
    });

    if (!connection) {
      throw new BadRequestException("Connection not found");
    }

    // 删除所有相关数据
    await this.prisma.$transaction([
      // 删除同步历史
      this.prisma.googleDriveSyncHistory.deleteMany({
        where: { connectionId: connection.id },
      }),
      // 删除连接
      this.prisma.googleDriveConnection.delete({
        where: { id: connection.id },
      }),
    ]);

    this.logger.log(`Disconnected Google Drive for user ${userId}`);
  }

  /**
   * 获取连接信息（自动验证并刷新 token）
   */
  async getConnection(userId: string) {
    const connection = await this.prisma.googleDriveConnection.findFirst({
      where: { userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        photoUrl: true,
        status: true,
        lastSyncAt: true,
        lastError: true,
        storageLimit: true,
        storageUsage: true,
        createdAt: true,
        tokenExpiry: true,
        refreshToken: true,
        _count: {
          select: {
            syncHistory: true,
          },
        },
      },
    });

    if (!connection) {
      return null;
    }

    // 如果连接状态是 ACTIVE，检查 token 是否过期
    // 即发即忘（fire-and-forget）后台刷新，不阻塞当前请求
    const now = new Date();
    const tokenExpired = !!(
      connection.status === GoogleDriveConnectionStatus.ACTIVE &&
      connection.tokenExpiry &&
      connection.tokenExpiry <= now
    );

    if (tokenExpired && connection.refreshToken) {
      this.logger.log(
        `Token expired for user ${userId}, scheduling background refresh...`,
      );
      void this.refreshAccessToken(connection.id).catch((error) => {
        this.logger.warn(
          `Background token refresh failed for user ${userId}: ${error}`,
        );
      });
    }

    return {
      ...connection,
      name: connection.displayName,
      picture: connection.photoUrl,
      syncHistoryCount: connection._count.syncHistory,
      // tokenExpired=true 时表示后台刷新进行中，前端应提示功能暂不可用
      tokenExpired,
      tokenExpiry: undefined,
      refreshToken: undefined,
      _count: undefined,
    };
  }

  /**
   * 更新连接配置
   */
  async updateConnection(
    userId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _data: { syncConfig?: Record<string, any> },
  ) {
    const connection = await this.prisma.googleDriveConnection.findFirst({
      where: { userId },
    });

    if (!connection) {
      throw new BadRequestException("Connection not found");
    }

    // Note: syncConfig is not in the schema, so we skip it for now
    // In the future, you may want to add a syncConfig JSON field to the schema
    const updated = await this.prisma.googleDriveConnection.findUnique({
      where: { id: connection.id },
    });

    if (!updated) {
      throw new BadRequestException("Connection not found");
    }

    const {
      accessToken: _accessToken,
      refreshToken: _refreshToken,
      ...safeConnection
    } = updated;
    return safeConnection;
  }

  /**
   * 获取有效的 OAuth2 客户端实例
   */
  async getAuthenticatedClient(userId: string): Promise<OAuth2Client> {
    const connection = await this.prisma.googleDriveConnection.findFirst({
      where: { userId },
      select: {
        id: true,
        accessToken: true,
        refreshToken: true,
        tokenExpiry: true,
        status: true,
      },
    });

    if (!connection) {
      throw new BadRequestException("Connection not found");
    }

    if (connection.status !== GoogleDriveConnectionStatus.ACTIVE) {
      throw new BadRequestException(`Connection is ${connection.status}`);
    }

    // 检查 token 是否过期
    const now = new Date();
    const isExpired = connection.tokenExpiry && connection.tokenExpiry <= now;

    if (isExpired && connection.refreshToken) {
      // Token 已过期，刷新
      const newAccessToken = await this.refreshAccessToken(connection.id);

      const client = new OAuth2Client(
        this.clientId,
        this.clientSecret,
        this.redirectUri,
      );
      client.setCredentials({
        access_token: newAccessToken,
        refresh_token: connection.refreshToken,
      });
      return client;
    }

    // Token 仍然有效
    const client = new OAuth2Client(
      this.clientId,
      this.clientSecret,
      this.redirectUri,
    );
    client.setCredentials({
      access_token: connection.accessToken,
      refresh_token: connection.refreshToken,
    });
    return client;
  }

  /**
   * 验证连接是否有效
   */
  async validateConnection(userId: string): Promise<boolean> {
    try {
      const client = await this.getAuthenticatedClient(userId);
      const oauth2Api = oauth2({ version: "v2", auth: client });
      const response = await oauth2Api.userinfo.get();
      return !!response.data.id;
    } catch (error) {
      this.logger.warn(
        `Connection validation failed for user ${userId}: ${error}`,
      );

      const connection = await this.prisma.googleDriveConnection.findFirst({
        where: { userId },
      });

      if (connection) {
        await this.prisma.googleDriveConnection.update({
          where: { id: connection.id },
          data: {
            status: GoogleDriveConnectionStatus.ERROR,
            lastError: error instanceof Error ? error.message : String(error),
          },
        });
      }

      return false;
    }
  }
}
