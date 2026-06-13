import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { UserSecretsService } from "../../../ai-engine/facade";
import { SecretsService, SecretKeysService } from "../../../platform/facade";
import {
  AddSecretKeyDto,
  UpdateSecretKeyMetaDto,
  ReplaceSecretKeyValueDto,
} from "../../admin/secrets/dto/secret-key.dto";
import {
  CreateUserSecretDto,
  UpdateUserSecretDto,
} from "./dto/user-secret.dto";
import { UserSecretSource } from "../../../platform/credentials/user-owned/user-secrets/user-secrets.types";

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

/**
 * 2026-05-27 BYOK 全量化：用户私有 Secret 统一管理端点（/me/api-keys 页面后端）。
 * 一个表格管所有类别 Key（LLM + 工具 + 其他），后端按 category 分流两张表。
 * 所有操作强制 req.user.id owner 隔离（防 IDOR / 越权）。
 */
@ApiTags("User Secrets (BYOK)")
@Controller("user/secrets")
@UseGuards(JwtAuthGuard)
export class UserSecretsController {
  constructor(
    private readonly userSecrets: UserSecretsService,
    // ★ 2026-05-29 BYOK 多 Key（对齐 admin）：user-scoped secrets/secret_keys
    private readonly secrets: SecretsService,
    private readonly secretKeys: SecretKeysService,
  ) {}

  /** 当前请求的审计上下文（owner 隔离全程用 req.user.id）。 */
  private auditCtx(req: AuthenticatedRequest) {
    return { userId: req.user.id, userEmail: req.user.email };
  }

  /**
   * 校验 :id 这条 user-scoped secret 归属当前用户，返回其 name。
   * 不存在/非本人 → 404（不泄露他人 secret 存在性）。
   */
  private async requireOwnedSecret(
    req: AuthenticatedRequest,
    id: string,
  ): Promise<void> {
    const owned = await this.secrets.getByIdForUser(id, req.user.id);
    if (!owned) throw new NotFoundException(`Secret '${id}' not found`);
  }

  /** 列出用户所有私有 Key（统一表格数据源）。 */
  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    const items = await this.userSecrets.list(req.user.id);
    return { items };
  }

  /** 新增一把 Key（按 category 分流：AI_MODEL→user_api_keys，其余→secrets）。 */
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateUserSecretDto,
  ) {
    return this.userSecrets.create(req.user.id, dto);
  }

  /** 更新一把 Key（source 区分来源表）。 */
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Put(":source/:id")
  async update(
    @Req() req: AuthenticatedRequest,
    @Param("source") source: UserSecretSource,
    @Param("id") id: string,
    @Body() dto: UpdateUserSecretDto,
  ) {
    return this.userSecrets.update(req.user.id, source, id, dto);
  }

  /** 删除一把 Key（owner 校验 + 软删）。 */
  @Delete(":source/:id")
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param("source") source: UserSecretSource,
    @Param("id") id: string,
  ) {
    return this.userSecrets.remove(req.user.id, source, id);
  }

  /**
   * C8：测试用户自己的 Key 是否存在（每用户每小时限 5 次）。
   * 仅验证 Key 存在性，不调付费 API，响应不回传明文。
   */
  @Throttle({ default: { ttl: 3600000, limit: 5 } })
  @Post(":source/:id/test")
  async testKey(
    @Req() req: AuthenticatedRequest,
    @Param("source") source: UserSecretSource,
    @Param("id") id: string,
  ) {
    return this.userSecrets.testKey(req.user.id, source, id);
  }

  /**
   * 揭示用户自己某把 Key 的明文（/me/api-keys 的 👁 查看，对齐 admin /admin/secrets 的 SecretValueModal）。
   * owner 隔离（service 层强制 req.user.id）+ 限流（每用户每分钟 10 次），只返回本人 Key。
   * 段数（3）与下方 `:id/keys`（2）不同，无路由冲突。
   */
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Get(":source/:id/value")
  async getValue(
    @Req() req: AuthenticatedRequest,
    @Param("source") source: UserSecretSource,
    @Param("id") id: string,
  ) {
    const value = await this.userSecrets.getValue(req.user.id, source, id);
    return { value };
  }

  // ═══════════ 同名多 Key 子资源（2026-05-29，呈现/行为对齐 admin /admin/secrets/:id/keys）═══════════
  //   :id = user-scoped secret 行 id（secrets 表，userId=当前用户）。
  //   全部经 SecretKeysService 并传 req.user.id 作 ownerUserId → owner 隔离防 IDOR。
  //   段数与上方 :source/:id 系列不同，无路由冲突。

  /** 列某 secret 下的所有 Key（多 Key 抽屉数据源；返回数组，与 admin GET 同契约）。 */
  @Get(":id/keys")
  async listKeys(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    await this.requireOwnedSecret(req, id);
    return this.secretKeys.listKeys(id, req.user.id);
  }

  /** Add Key：同名下加一把备份 Key（label 唯一 + priority）。 */
  @Throttle({ default: { ttl: 3600000, limit: 30 } })
  @Post(":id/keys")
  async addKey(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: AddSecretKeyDto,
  ) {
    // ★ 2026-05-29 评审修复：纵深防御——先校验 :id 父 secret 归属（service 层 ownerUserId 仍兜底）。
    await this.requireOwnedSecret(req, id);
    return this.secretKeys.addKey(id, dto, this.auditCtx(req), req.user.id);
  }

  /** 改 label / priority / isActive。 */
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @Patch(":id/keys/:keyId")
  async updateKeyMeta(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("keyId") keyId: string,
    @Body() dto: UpdateSecretKeyMetaDto,
  ) {
    await this.requireOwnedSecret(req, id);
    return this.secretKeys.updateKeyMeta(
      keyId,
      dto,
      this.auditCtx(req),
      req.user.id,
    );
  }

  /** Replace：轮换某把 Key 的 value（状态重置）。 */
  @Throttle({ default: { ttl: 3600000, limit: 30 } })
  @Put(":id/keys/:keyId/value")
  async replaceKeyValue(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("keyId") keyId: string,
    @Body() dto: ReplaceSecretKeyValueDto,
  ) {
    await this.requireOwnedSecret(req, id);
    return this.secretKeys.replaceKeyValue(
      keyId,
      dto,
      this.auditCtx(req),
      req.user.id,
    );
  }

  /** 删除某把 Key。 */
  @Delete(":id/keys/:keyId")
  async deleteKey(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("keyId") keyId: string,
  ) {
    await this.requireOwnedSecret(req, id);
    await this.secretKeys.deleteKey(keyId, this.auditCtx(req), req.user.id);
    return { ok: true };
  }

  /** 后端代测某把 Key（真发探测，不回传明文）。 */
  @Throttle({ default: { ttl: 3600000, limit: 30 } })
  @Post(":id/keys/:keyId/test")
  async testSecretKey(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("keyId") keyId: string,
  ) {
    await this.requireOwnedSecret(req, id);
    // ★ 2026-05-29 评审修复：用户侧只回规范化 errorCode，不透传 provider 原始 errorMessage（防内部信息泄露）。
    const r = await this.secretKeys.testKey(
      keyId,
      this.auditCtx(req),
      req.user.id,
    );
    return { ok: r.ok, errorCode: r.errorCode };
  }
}
