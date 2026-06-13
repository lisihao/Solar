import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import {
  AiModelDiscoveryService,
  AiConnectionTestService,
  UserApiKeysService,
  UserModelConfigsService,
  AutoConfigureService,
} from "@/modules/ai-harness/facade";
import {
  KeyHealthStore,
  buildPersonalKeyId,
} from "@/modules/platform/credentials/governance/key-health";

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

interface FetchUserModelsDto {
  /** 用户当前在表单里输入的 Key（还没保存），优先用它。 */
  apiKey?: string;
  /** 用户在「使用 Key」下拉里选定的 BYOK 密钥 id（UserApiKey.id）。
   *  选了就用这把 key 拉列表，使预览与运行时实际用的 key 一致。 */
  apiKeyId?: string;
  /** 自定义 endpoint（可选） */
  apiEndpoint?: string;
  /** 过滤模型类型：CHAT/CHAT_FAST/EMBEDDING/... */
  modelType?: string;
}

/**
 * 用户端动态模型发现接口：与管理员的 /admin/ai-models/fetch-available
 * 等价，但用用户自己的 Personal Key（或表单里当场输入的新 Key）去拉
 * provider 的 /v1/models。
 *
 * 迁移自 ai-engine/llm/user-models.controller.ts (PR-X17)
 * 只暴露给登录用户（JwtAuthGuard），没有管理员限制。
 */
@ApiTags("User - Models")
@Controller("user/api-keys")
@UseGuards(JwtAuthGuard)
export class UserModelsController {
  constructor(
    private readonly modelDiscovery: AiModelDiscoveryService,
    private readonly userApiKeys: UserApiKeysService,
  ) {}

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post(":provider/available-models")
  async fetchAvailableModels(
    @Req() req: AuthenticatedRequest,
    @Param("provider") provider: string,
    @Body() dto: FetchUserModelsDto,
  ) {
    const normalized = provider.toLowerCase();

    // Key 解析优先级（必须与运行时一致，否则预览“能拉到”但运行时用别的 key 失败）：
    //   1. 表单里当场输入的明文 Key（用户还没保存时也能拉列表）
    //   2. 「使用 Key」下拉选定的 BYOK 密钥（按 id 解析，跨 provider 也按用户所选）
    //   3. 回退到该 provider 的 Personal Key
    let apiKey = dto.apiKey?.trim();
    let endpointFromKey: string | undefined;
    const selectedKeyId = dto.apiKeyId?.trim();
    if (!apiKey && selectedKeyId) {
      // 不传 provider：尊重用户在下拉里的显式选择（下拉本就列出全部 provider 的 key）。
      const selected = await this.userApiKeys.getPersonalKeyById(
        req.user.id,
        selectedKeyId,
      );
      if (!selected?.apiKey) {
        throw new BadRequestException(
          "Selected BYOK key not found or inactive.",
        );
      }
      apiKey = selected.apiKey;
      endpointFromKey = selected.apiEndpoint?.trim() || undefined;
    }
    if (!apiKey) {
      const personal = await this.userApiKeys.getPersonalKey(
        req.user.id,
        normalized,
      );
      apiKey = personal?.apiKey;
      endpointFromKey = personal?.apiEndpoint?.trim() || undefined;
    }
    if (!apiKey) {
      throw new BadRequestException(
        "No API Key available. Please provide one in the form or save one first.",
      );
    }

    const result = await this.modelDiscovery.fetchAvailableModels(
      normalized,
      apiKey,
      dto.apiEndpoint?.trim() || endpointFromKey,
      dto.modelType,
    );
    return result;
  }
}

/**
 * 一键 AI 配置：基于用户所有已配 Personal Keys，自动创建推荐的 UserModelConfig
 * （CHAT / CHAT_FAST / EMBEDDING / RERANK / ...），尽可能为每个 modelType 都
 * 配上一个合适的默认模型。
 *
 * 迁移自 ai-engine/llm/user-models.controller.ts (PR-X17)
 */
@ApiTags("User - Model Configs")
@Controller("user/model-configs")
@UseGuards(JwtAuthGuard)
export class UserModelConfigsAutoController {
  private readonly logger = new Logger(UserModelConfigsAutoController.name);

  constructor(
    private readonly autoConfigure: AutoConfigureService,
    private readonly userModelConfigs: UserModelConfigsService,
    private readonly userApiKeys: UserApiKeysService,
    private readonly connectionTest: AiConnectionTestService,
    private readonly keyHealth: KeyHealthStore,
  ) {}

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post("auto-configure")
  async autoConfigureModels(@Req() req: AuthenticatedRequest) {
    return this.autoConfigure.runForUser(req.user.id);
  }

  /**
   * 测试用户自配模型的连接：用用户的 Personal Key + 模型参数实际调一次 provider
   * 路径：POST /user/model-configs/:id/test
   */
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post(":id/test")
  async testConnection(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    const cfg = await this.userModelConfigs.findById(req.user.id, id);
    if (!cfg) throw new NotFoundException("Model config not found");

    // 测试必须用与运行时一致的 key：运行时走 keyResolver(preferredKeyId=cfg.apiKeyId)，
    // 所以这里也必须先按 cfg.apiKeyId 解析那把具体 BYOK key，否则"测试通过但运行时挂"。
    let apiKey: string | undefined;
    let keyEndpoint: string | null | undefined;
    // ★ key label 用于复原运行时 healthKeyId（personal:{userId}:{provider}:{label}），
    //   测试通过后清除该 key 的 DEAD/cooldown 健康状态。
    let keyLabel: string | undefined;
    if (cfg.apiKeyId) {
      const selected = await this.userApiKeys.getPersonalKeyById(
        req.user.id,
        cfg.apiKeyId,
      );
      apiKey = selected?.apiKey;
      keyEndpoint = selected?.apiEndpoint;
      keyLabel = selected?.label;
    }
    if (!apiKey) {
      const personal = await this.userApiKeys.getPersonalKey(
        req.user.id,
        cfg.provider,
      );
      apiKey = personal?.apiKey;
      keyEndpoint = personal?.apiEndpoint;
      keyLabel = personal?.label;
    }
    if (!apiKey) {
      throw new BadRequestException(
        `No active key for provider "${cfg.provider}"（选定的 BYOK 密钥可能已被删除或停用）。请在 API Keys Tab 配置 Key 或重新选择。`,
      );
    }

    const endpoint = cfg.apiEndpoint?.trim() || keyEndpoint?.trim() || "";

    const result = await this.connectionTest.testModelConnectionWithKey(
      cfg.provider,
      cfg.modelId,
      apiKey,
      endpoint,
      cfg.modelType,
    );

    // ★ 2026-06-02 修"测试通过但运行时仍说 key 失效"：测试连接实际调通 provider 即证明
    //   key 有效，必须把该 key 在 KeyHealthStore 里的 DEAD/cooldown 状态清掉（forceHealthy
    //   → markSuccess），否则之前被偶发 401 标死的 key 仍会被 filterUsable 过滤，mission
    //   继续报 "No API Key available"。健康状态写失败不影响测试结果返回。
    if (result?.success && keyLabel) {
      try {
        await this.keyHealth.forceHealthy(
          buildPersonalKeyId(req.user.id, cfg.provider, keyLabel),
        );
      } catch (err) {
        this.logger.warn(
          `[testConnection] forceHealthy failed for ${cfg.provider}/${keyLabel}: ${
            (err as Error).message
          }`,
        );
      }
    }

    return result;
  }
}
