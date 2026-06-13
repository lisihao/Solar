/**
 * MCP Server - API Key Guard
 * 验证外部调用方的 API Key
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { Request } from "express";
import { SecretsService } from "../../../../platform/credentials/storage/secrets/secrets.service";
import { safeCompare } from "../../../../../common/utils/crypto.utils";

@Injectable()
export class MCPApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(MCPApiKeyGuard.name);

  constructor(private readonly secretsService: SecretsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      throw new UnauthorizedException("API key required");
    }

    try {
      // Validate against stored MCP API keys
      // Check ALL keys to avoid timing side-channel leaking which key matched
      const storedKeys = await this.secretsService.getSecretNames("MCP");
      let matchedKeyName: string | null = null;

      for (const keyName of storedKeys) {
        const storedValue = await this.secretsService.getValueInternal(keyName);
        if (storedValue && safeCompare(storedValue, apiKey)) {
          matchedKeyName = keyName;
          // Don't return early — continue checking to prevent timing leak
        }
      }

      if (matchedKeyName) {
        request.mcpApiKeyId = matchedKeyName;
        return true;
      }

      this.logger.warn("Invalid MCP API key attempted");
      throw new UnauthorizedException("Invalid API key");
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.error(
        `API key validation failed: ${(error as Error).message}`,
      );
      throw new UnauthorizedException("API key validation failed");
    }
  }

  private extractApiKey(request: Request): string | null {
    // Bearer token
    const authHeader = request.headers["authorization"];
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.slice(7);
    }

    // X-API-Key header
    const apiKeyHeader = request.headers["x-api-key"];
    if (apiKeyHeader) {
      return Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
    }

    return null;
  }
}
