/**
 * A2A Server - API Key Guard
 * 验证外部 Agent 调用方的 API Key
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "@/common/decorators/public.decorator";
import { SecretsService } from "../../../../platform/facade";
import { safeCompare } from "@/common/utils/crypto.utils";

@Injectable()
export class A2AApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(A2AApiKeyGuard.name);

  constructor(
    private readonly secretsService: SecretsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 检查是否为公开端点
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      throw new UnauthorizedException("API key required");
    }

    try {
      // 验证 A2A API keys（使用 MCP category，因为都是 agent-to-agent 协议）
      // TODO: 未来可以在 Prisma schema 中添加 A2A category
      const storedKeys = await this.secretsService.getSecretNames("MCP");

      for (const keyName of storedKeys) {
        const storedValue = await this.secretsService.getValueInternal(keyName);
        if (storedValue && safeCompare(storedValue, apiKey)) {
          request.a2aApiKeyId = keyName;
          this.logger.log(`A2A API key validated: ${keyName}`);
          return true;
        }
      }

      this.logger.warn("Invalid A2A API key attempted");
      throw new UnauthorizedException("Invalid API key");
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.error(
        `API key validation failed: ${(error as Error).message}`,
      );
      throw new UnauthorizedException("API key validation failed");
    }
  }

  private extractApiKey(request: {
    headers: Record<string, string | string[] | undefined>;
  }): string | null {
    // Bearer token
    const authHeaderRaw = request.headers["authorization"];
    const authHeader = Array.isArray(authHeaderRaw)
      ? authHeaderRaw[0]
      : authHeaderRaw;
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.slice(7);
    }

    // X-API-Key header
    const apiKeyHeaderRaw = request.headers["x-api-key"];
    const apiKeyHeader = Array.isArray(apiKeyHeaderRaw)
      ? apiKeyHeaderRaw[0]
      : apiKeyHeaderRaw;
    if (apiKeyHeader) {
      return apiKeyHeader;
    }

    return null;
  }
}
