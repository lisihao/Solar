import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { UserModelConfigsService } from "@/modules/ai-harness/facade";
import {
  CreateUserModelConfigDto,
  UpdateUserModelConfigDto,
} from "./dto/user-model-config.dto";
import {
  CapabilityOverridesWriterService,
  ApplyCapabilityOverridesDto,
  DeleteCapabilityOverridesDto,
  AiModelConfigService,
} from "@/modules/ai-engine/facade";

interface AuthenticatedRequest {
  user: { id: string; email: string };
  ip?: string;
  headers?: { "user-agent"?: string };
}

@ApiTags("User - Model Configs")
@Controller("user/model-configs")
@UseGuards(JwtAuthGuard)
export class UserModelConfigsController {
  constructor(
    private readonly service: UserModelConfigsService,
    // v3.1 阶段 B 子片 2：capability_overrides 写入面 SSOT（BYOK 用户路径）
    private readonly capabilityOverridesWriter: CapabilityOverridesWriterService,
    // BYOK 配置变更后失效 AiModelConfigService 的 per-(user,modelId) 解析缓存
    // （TTL 60s 是兜底，主动失效消除"删/改配置后 60s 内仍命中旧配置"窗口）。
    private readonly aiModelConfig: AiModelConfigService,
  ) {}

  /**
   * 守护：被改的 user_model_config 行必须属于当前用户。
   * 用 service.findById（已带 ownership 校验）—— null 抛 NotFound，否则 throw Forbidden
   * （Forbidden 比 NotFound 更准确表达"非本人资源"，但与 service.update 同语义保持一致）。
   */
  private async assertOwnership(
    userId: string,
    configId: string,
  ): Promise<void> {
    const row = await this.service.findById(userId, configId);
    if (!row) {
      // findById 在 userId 不匹配时返回 null（service 内部校验），
      // 用 ForbiddenException 让前端清楚是权限问题而非资源不存在
      throw new ForbiddenException(
        "Model config does not belong to current user",
      );
    }
  }

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query("provider") provider?: string,
  ) {
    const items = provider
      ? await this.service.listByUserAndProvider(req.user.id, provider)
      : await this.service.listByUser(req.user.id);
    return { items };
  }

  @Get(":id")
  async detail(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const item = await this.service.findById(req.user.id, id);
    if (!item) throw new NotFoundException("Model config not found");
    return { item };
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateUserModelConfigDto,
  ) {
    const created = await this.service.create(req.user.id, dto);
    this.aiModelConfig.clearResolvedModelCache(req.user.id);
    return created;
  }

  @Patch(":id")
  async update(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateUserModelConfigDto,
  ) {
    const updated = await this.service.update(req.user.id, id, dto);
    this.aiModelConfig.clearResolvedModelCache(req.user.id);
    return updated;
  }

  @Post(":id/set-default")
  async setDefault(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const result = await this.service.setDefault(req.user.id, id);
    this.aiModelConfig.clearResolvedModelCache(req.user.id);
    return result;
  }

  @Delete(":id")
  async remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const result = await this.service.delete(req.user.id, id);
    this.aiModelConfig.clearResolvedModelCache(req.user.id);
    return result;
  }

  /**
   * v3.1 §B.3 BYOK 用户 override 路径 ——
   * PATCH /api/user/model-configs/:id/capability-overrides
   *
   * 写入 UserModelConfig.capability_overrides JSONB（仅本人）。所有校验/写入/AuditLog 在
   * CapabilityOverridesWriterService.applyOverrideTransactional 同事务完成
   * （patch shape strict-zod + reason ≥30 chars + scope=PERSONAL 矩阵）。
   */
  @Patch(":id/capability-overrides")
  async applyCapabilityOverrides(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: ApplyCapabilityOverridesDto,
  ) {
    await this.assertOwnership(req.user.id, id);
    return this.capabilityOverridesWriter.applyOverrideTransactional({
      target: { kind: "user_model_config", id },
      scope: "PERSONAL",
      actor: { id: req.user.id, role: "user" },
      patch: dto.patch,
      // BYOK 用户显式 override 与 admin override 共享 source='admin-override'，
      // 因为两者都是"人类显式选择"：cooling-off 查询 source='admin-override' 时
      // 也要覆盖用户显式选择（防自愈 24h 内覆盖用户意图）。
      // 若未来需区分 admin/user 显式语义，扩 cooling-off 查询 WHERE source IN (...)
      source: "admin-override",
      reason: dto.reason,
      ipAddress: req.ip,
      userAgent: req.headers?.["user-agent"],
    });
  }

  /**
   * v3.1 §B.3 BYOK 用户 override 重置 ——
   * DELETE /api/user/model-configs/:id/capability-overrides
   *
   * 同 admin DELETE 的简洁实现：写入空 patch（不覆盖任何字段）+ 记 AuditLog；
   * B+ 增强 service.clearOverride 把整列置 null。
   */
  @Delete(":id/capability-overrides")
  async clearCapabilityOverrides(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: DeleteCapabilityOverridesDto,
  ) {
    await this.assertOwnership(req.user.id, id);
    // v3.1 §B+.4: 改调 clearOverrideTransactional 真清 overlay 列（SET NULL），
    // 而非旧 patch={} + deep-merge"不覆盖任何字段"的等价 noop。
    return this.capabilityOverridesWriter.clearOverrideTransactional({
      target: { kind: "user_model_config", id },
      scope: "PERSONAL",
      actor: { id: req.user.id, role: "user" },
      // BYOK DELETE 与 admin DELETE 共享 source='admin-override'：reset 也是"人类显式选择"，
      // cooling-off 守护语义一致（见 PATCH 同位置注释）。
      source: "admin-override",
      reason: dto.reason,
      ipAddress: req.ip,
      userAgent: req.headers?.["user-agent"],
    });
  }
}
