import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Param,
  Body,
  Req,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { UserApiKeysService } from "@/modules/ai-harness/facade";
import { SaveUserApiKeyDto, TestApiKeyDto } from "./dto/user-api-keys.dto";
import { AiModelConfigService } from "@/modules/ai-engine/facade";

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

@ApiTags("User API Keys")
@Controller("user/api-keys")
@UseGuards(JwtAuthGuard)
export class UserApiKeysController {
  constructor(
    private readonly userApiKeysService: UserApiKeysService,
    // M2 fix：加/删 key 后失效 per-(user,modelId) 解析缓存。否则加 key 后模型最长
    // 60s 仍"不可用"、删 key 后最长 60s 仍"可用"（model-config CRUD 已失效，key 漏）。
    private readonly aiModelConfig: AiModelConfigService,
  ) {}

  /**
   * 列出用户的所有 API Key 配置
   */
  @Get()
  async listKeys(@Req() req: AuthenticatedRequest) {
    const keys = await this.userApiKeysService.listUserApiKeys(req.user.id);
    const providers = await this.userApiKeysService.getSupportedProviders(
      req.user.id,
    );
    return { keys, providers };
  }

  /**
   * BYOK 状态概览 — 给首次登录引导 / dashboard banner 用
   * GET /api/v1/user/api-keys/status
   *
   * 返回 { configured, activeProviders, hasModelConfig }，
   * 前端 useByokStatus() 依据这个决定要不要显示 onboarding banner / modal。
   */
  @Get("status")
  async getStatus(@Req() req: AuthenticatedRequest) {
    return this.userApiKeysService.getByokStatus(req.user.id);
  }

  /**
   * 保存/更新 API Key
   */
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Put(":provider")
  async saveKey(
    @Req() req: AuthenticatedRequest,
    @Param("provider") provider: string,
    @Body() dto: SaveUserApiKeyDto,
  ) {
    const result = await this.userApiKeysService.saveKey(
      req.user.id,
      provider,
      dto.apiKey,
      dto.mode,
      dto.preferredModelId,
      dto.apiEndpoint,
      dto.label,
    );
    this.aiModelConfig.clearResolvedModelCache(req.user.id);
    return result;
  }

  /**
   * 删除 API Key（可指定 label，省略则删 default）
   */
  @Delete(":provider")
  async deleteKey(
    @Req() req: AuthenticatedRequest,
    @Param("provider") provider: string,
    @Query("label") label?: string,
  ) {
    const result = await this.userApiKeysService.deleteKey(
      req.user.id,
      provider,
      label,
    );
    this.aiModelConfig.clearResolvedModelCache(req.user.id);
    return result;
  }

  /**
   * 测试 API Key 连接
   */
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post(":provider/test")
  async testKey(
    @Param("provider") provider: string,
    @Body() dto: TestApiKeyDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.userApiKeysService.testKey(
      provider,
      dto.apiKey,
      dto.apiEndpoint,
      req.user.id,
    );
  }

  /**
   * 测试已存储的某把 key（按 id，与 admin SecretKeys 能力对齐）
   * POST /user/api-keys/:provider/keys/:keyId/test
   * 返回 { ok, errorCode? }，写回 testStatus/lastErrorCode 供 UI 展示。
   */
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post(":provider/keys/:keyId/test")
  async testStoredKey(
    @Param("keyId") keyId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.userApiKeysService.testKeyById(req.user.id, keyId);
  }
}
