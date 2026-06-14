/**
 * Feishu Auth Service
 * Manages tenant_access_token for Feishu API calls
 * Docs: https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";

@Injectable()
export class FeishuAuthService {
  private readonly logger = new Logger(FeishuAuthService.name);

  private appId: string;
  private appSecret: string;
  private tenantAccessToken: string = "";
  private tokenExpiresAt: number = 0;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    this.appId = this.configService.get("FEISHU_APP_ID", "");
    this.appSecret = this.configService.get("FEISHU_APP_SECRET", "");
  }

  /**
   * Get tenant_access_token, auto-refresh if expired
   */
  async getTenantAccessToken(): Promise<string> {
    if (this.tenantAccessToken && Date.now() < this.tokenExpiresAt) {
      return this.tenantAccessToken;
    }

    if (!this.appId || !this.appSecret) {
      throw new Error(
        "Feishu credentials not configured (FEISHU_APP_ID / FEISHU_APP_SECRET)",
      );
    }

    try {
      const url =
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
      const response = await firstValueFrom(
        this.httpService.post(url, {
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      );

      if (response.data.code !== 0) {
        throw new Error(
          `Failed to get tenant_access_token: ${response.data.msg}`,
        );
      }

      this.tenantAccessToken = response.data.tenant_access_token;
      // Token expires in `expire` seconds, refresh 5 min early
      this.tokenExpiresAt = Date.now() + (response.data.expire - 300) * 1000;

      this.logger.log("Feishu tenant_access_token refreshed successfully");
      return this.tenantAccessToken;
    } catch (error) {
      this.logger.error(`Failed to get tenant_access_token: ${error}`);
      throw error;
    }
  }

  /**
   * Get authorization headers for Feishu API calls
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getTenantAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    };
  }

  /**
   * Check if Feishu credentials are configured
   */
  isConfigured(): boolean {
    return !!(this.appId && this.appSecret);
  }

  /**
   * Get masked App ID for display
   */
  getMaskedAppId(): string {
    if (!this.appId) return "";
    return this.appId.substring(0, 6) + "****";
  }
}
