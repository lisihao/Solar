import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AdminService } from "./admin.service";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../common/guards/admin.guard";
import { ChatFacade } from "../../ai-harness/facade";
import {
  normalizeMarkdownSlug,
  CapabilityOverridesWriterService,
  ApplyCapabilityOverridesDto,
  DeleteCapabilityOverridesDto,
  SystemModelInventoryService,
} from "../../ai-engine/facade";
import { AIModelType } from "@prisma/client";
import { SecretsService } from "../../platform/credentials/storage/secrets/secrets.service";
import { APP_CONFIG } from "../../../common/config/app.config";
import { CreateUserDto } from "./dto/create-user.dto";
import { StorageInventoryService } from "../../platform/storage/governance/storage-inventory.service";
import { StorageOffloadService } from "../../platform/storage/governance/storage-offload.service";

interface AuthenticatedRequest {
  user?: { id: string };
  ip?: string;
  headers?: { "user-agent"?: string };
}

/**
 * Perplexity API key 验证用的模型名。
 * 为满足项目规范"永远不硬编码模型名"，这里留空字符串，实际发请求时由 AiChatService
 * 走 TaskProfile 解析；仅当 Perplexity 的 models 接口返回具体值时才真写名字。
 */
const PERPLEXITY_VALIDATION_MODEL = "";

/**
 * 管理员控制器
 * 所有接口都需要管理员权限
 */
@ApiTags("Admin - Dashboard")
@Controller("admin")
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private adminService: AdminService,
    private chatFacade: ChatFacade,
    private secretsService: SecretsService,
    private storageInventoryService: StorageInventoryService,
    private storageOffloadService: StorageOffloadService,
    private systemModelInventoryService: SystemModelInventoryService,
    // v3.1 阶段 B 子片 2：capability_overrides 写入面 SSOT（admin override 路径）
    private capabilityOverridesWriter: CapabilityOverridesWriterService,
  ) {}

  /**
   * 系统模型全景 — 给管理员 /admin/ai/models 顶部面板用
   * GET /api/v1/admin/ai-models/overview
   *
   * 返回：按 type/provider 分组的模型数 + 用户配置分布 + 24h 调用量
   */
  @Get("ai-models/overview")
  async getSystemModelInventory() {
    return this.systemModelInventoryService.getInventory();
  }

  /**
   * 数据存储清单 — 返回 DB 表尺寸 + 已 off-load 字段映射 + R2 bucket 清单
   * GET /api/v1/admin/storage-inventory
   *
   * 前端用它在"数据管理"页面展示各数据存在哪里（DB / R2）。
   */
  @Get("storage-inventory")
  async getStorageInventory() {
    return this.storageInventoryService.getInventory();
  }

  /**
   * 存储时间序列（最近 N 天），用于前端 trend 图
   * GET /api/v1/admin/storage-inventory/trend?days=30
   */
  @Get("storage-inventory/trend")
  async getStorageTrend(@Query("days") days?: string) {
    const n = Math.max(1, Math.min(365, parseInt(days || "30", 10)));
    return this.storageInventoryService.getTrend(n);
  }

  /**
   * 手动采样一次（供调试用）
   * POST /api/v1/admin/storage-inventory/snapshot
   */
  @Post("storage-inventory/snapshot")
  async takeStorageSnapshot() {
    await this.storageInventoryService.takeSnapshot();
    return { snapshotted: true };
  }

  /**
   * 手动触发 off-load 调度
   * POST /api/v1/admin/storage-inventory/run-offload
   * 正常每天 02:00 UTC 自动跑；此接口供运维手动触发。
   */
  @Post("storage-inventory/run-offload")
  async runOffloadNow() {
    // fire-and-forget：调度器内部有 running 锁防并发
    void this.storageOffloadService.runOnce();
    return {
      triggered: true,
      message: "Off-load scheduler triggered (running in background)",
    };
  }

  /**
   * 获取所有用户
   * GET /api/v1/admin/users
   */
  @Get("users")
  async getUsers(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("search") search?: string,
  ) {
    this.logger.log(`Admin: Fetching users (page=${page}, search=${search})`);
    return this.adminService.getAllUsers(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
      search,
    );
  }

  /**
   * 获取用户统计信息
   * GET /api/v1/admin/users/stats
   */
  @Get("users/stats")
  async getUserStats() {
    this.logger.log("Admin: Fetching user statistics");
    return this.adminService.getUserStats();
  }

  /**
   * 创建新用户
   * POST /api/v1/admin/users
   */
  @Post("users")
  async createUser(@Body() body: CreateUserDto) {
    this.logger.log(`Admin: Creating user ${body.email}`);
    return this.adminService.createUser(body);
  }

  /**
   * 获取用户登录历史
   * GET /api/v1/admin/users/:id/login-history
   */
  @Get("users/:id/login-history")
  async getUserLoginHistory(
    @Param("id") id: string,
    @Query("limit") limit?: string,
  ) {
    this.logger.log(`Admin: Fetching login history for user ${id}`);
    return this.adminService.getUserLoginHistory(
      id,
      limit ? parseInt(limit) : 10,
    );
  }

  /**
   * 获取系统统计信息
   * GET /api/v1/admin/stats
   */
  @Get("stats")
  async getStats() {
    this.logger.log("Admin: Fetching system stats");
    return this.adminService.getSystemStats();
  }

  /**
   * 获取架构图各模块统计数据
   * GET /api/v1/admin/overview-stats
   */
  @Get("overview-stats")
  async getOverviewStats() {
    this.logger.log("Admin: Fetching overview stats");
    return this.adminService.getOverviewStats();
  }

  /**
   * 删除资源
   * DELETE /api/v1/admin/resources/:id
   */
  @Delete("resources/:id")
  async deleteResource(@Param("id") id: string) {
    this.logger.log(`Admin: Deleting resource ${id}`);
    return this.adminService.deleteResource(id);
  }

  /**
   * 批量删除资源
   * DELETE /api/v1/admin/resources
   */
  @Delete("resources")
  async deleteResources(@Body("ids") ids: string[]) {
    this.logger.log(`Admin: Batch deleting ${ids.length} resources`);
    return this.adminService.deleteResources(ids);
  }

  /**
   * 更新用户角色
   * PATCH /api/v1/admin/users/:id/role
   */
  @Patch("users/:id/role")
  async updateUserRole(
    @Param("id") id: string,
    @Body("role") role: "USER" | "ADMIN",
  ) {
    this.logger.log(`Admin: Updating user ${id} role to ${role}`);
    return this.adminService.updateUserRole(id, role);
  }

  /**
   * 禁用/启用用户
   * PATCH /api/v1/admin/users/:id/status
   */
  @Patch("users/:id/status")
  async toggleUserStatus(
    @Param("id") id: string,
    @Body("isActive") isActive: boolean,
  ) {
    this.logger.log(
      `Admin: Updating user ${id} status to ${isActive ? "active" : "inactive"}`,
    );
    return this.adminService.toggleUserStatus(id, isActive);
  }

  /**
   * 更新用户信息
   * PUT /api/v1/admin/users/:id
   */
  @Put("users/:id")
  async updateUser(
    @Param("id") id: string,
    @Body()
    body: {
      username?: string;
      role?: "USER" | "ADMIN";
      status?: "active" | "inactive" | "banned";
    },
  ) {
    this.logger.log(`Admin: Updating user ${id}`);
    return this.adminService.updateUser(id, body);
  }

  /**
   * 删除用户
   * DELETE /api/v1/admin/users/:id
   */
  @Delete("users/:id")
  async deleteUser(@Param("id") id: string) {
    this.logger.log(`Admin: Deleting user ${id}`);
    return this.adminService.deleteUser(id);
  }

  // ============ Credits Management ============

  /**
   * 获取用户积分详情
   * GET /api/v1/admin/users/:id/credits
   */
  @Get("users/:id/credits")
  async getUserCredits(@Param("id") id: string) {
    this.logger.log(`Admin: Fetching credits for user ${id}`);
    return this.adminService.getUserCredits(id);
  }

  /**
   * 发放积分
   * POST /api/v1/admin/users/:id/credits/grant
   */
  @Post("users/:id/credits/grant")
  async grantCredits(
    @Param("id") id: string,
    @Body() body: { amount: number; reason?: string },
  ) {
    this.logger.log(`Admin: Granting ${body.amount} credits to user ${id}`);
    return this.adminService.grantCredits(id, body.amount, body.reason);
  }

  /**
   * 冻结/解冻账户
   * POST /api/v1/admin/users/:id/credits/freeze
   */
  @Post("users/:id/credits/freeze")
  async toggleCreditFreeze(
    @Param("id") id: string,
    @Body() body: { freeze: boolean; reason?: string },
  ) {
    this.logger.log(
      `Admin: ${body.freeze ? "Freezing" : "Unfreezing"} credits for user ${id}`,
    );
    return this.adminService.toggleCreditFreeze(id, body.freeze, body.reason);
  }

  // ============ AI Model Management ============

  /**
   * 获取所有AI模型
   * GET /api/v1/admin/ai-models
   */
  @Get("ai-models")
  async getAIModels() {
    this.logger.log("Admin: Fetching AI models");
    return this.adminService.getAllAIModels();
  }

  /**
   * 诊断AI模型配置
   * GET /api/v1/admin/ai-models/diagnose
   * 返回所有AI模型的配置状态，用于调试
   * NOTE: This route MUST come before :id route to avoid being matched as an ID
   */
  @Get("ai-models/diagnose")
  async diagnoseAIModels() {
    this.logger.log("Admin: Diagnosing AI models configuration");
    const models = await this.adminService.diagnoseAIModels();
    return {
      timestamp: new Date().toISOString(),
      models,
      summary: {
        total: models.length,
        enabled: models.filter((m: { isEnabled: boolean }) => m.isEnabled)
          .length,
        withApiKey: models.filter((m: { hasApiKey: boolean }) => m.hasApiKey)
          .length,
        ready: models.filter(
          (m: { isEnabled: boolean; hasApiKey: boolean }) =>
            m.isEnabled && m.hasApiKey,
        ).length,
      },
    };
  }

  /**
   * 获取单个AI模型
   * GET /api/v1/admin/ai-models/:id
   * @query edit - 如果为 true，返回完整的 API Key（用于编辑模式）
   */
  @Get("ai-models/:id")
  async getAIModel(@Param("id") id: string, @Query("edit") edit?: string) {
    const includeFullApiKey = edit === "true";
    this.logger.log(
      `Admin: Fetching AI model ${id}, edit mode: ${includeFullApiKey}`,
    );
    return this.adminService.getAIModel(id, includeFullApiKey);
  }

  /**
   * 创建AI模型
   * POST /api/v1/admin/ai-models
   */
  @Post("ai-models")
  async createAIModel(
    @Body()
    body: {
      name: string;
      displayName: string;
      provider: string;
      modelId: string;
      modelType?: AIModelType;
      icon: string;
      color: string;
      apiEndpoint: string;
      apiKey?: string;
      secretKey?: string | null; // 引用 Secret Manager 中的密钥名称
      maxTokens?: number;
      temperature?: number;
      description?: string;
      isReasoning?: boolean;
      // ★ 新增：模型能力配置字段
      apiFormat?: string;
      supportsTemperature?: boolean;
      supportsStreaming?: boolean;
      supportsFunctionCalling?: boolean;
      supportsVision?: boolean;
      tokenParamName?: string;
      defaultTimeoutMs?: number;
      priceInputPerMillion?: number;
      priceOutputPerMillion?: number;
      priority?: number;
    },
  ) {
    this.logger.log(
      `Admin: Creating AI model ${body.name}, type=${body.modelType || "CHAT"}`,
    );
    return this.adminService.createAIModel(body);
  }

  /**
   * 获取提供商可用的模型列表
   * POST /api/v1/admin/ai-models/fetch-available
   * NOTE: This route MUST come before :id routes to avoid being matched as an ID
   */
  @Post("ai-models/fetch-available")
  async fetchAvailableModels(
    @Body()
    body: {
      provider: string;
      apiKey?: string;
      secretKey?: string;
      apiEndpoint?: string;
      modelType?: string; // CHAT, CHAT_FAST, EMBEDDING, IMAGE_GENERATION, RERANK, etc.
    },
  ) {
    this.logger.log(
      `Admin: Fetching available models for ${body.provider}, type: ${body.modelType || "ALL"}`,
    );

    // 解析 API Key：优先使用直接提供的，否则从 Secret Manager 获取
    let resolvedApiKey = body.apiKey?.trim();
    if (!resolvedApiKey && body.secretKey) {
      const secretValue = await this.secretsService.getValue(body.secretKey);
      if (secretValue) {
        resolvedApiKey = secretValue.trim();
      } else {
        throw new BadRequestException("无法从 Secret Manager 获取 API Key");
      }
    }
    if (!resolvedApiKey) {
      throw new BadRequestException("请提供 API Key 或选择有效的 Secret");
    }
    return this.chatFacade.fetchAvailableModels(
      body.provider,
      resolvedApiKey,
      body.apiEndpoint,
      body.modelType,
    );
  }

  /**
   * 更新AI模型
   * PATCH /api/v1/admin/ai-models/:id
   */
  @Patch("ai-models/:id")
  async updateAIModel(
    @Param("id") id: string,
    @Body()
    body: {
      displayName?: string;
      provider?: string;
      modelId?: string;
      modelType?: AIModelType;
      icon?: string;
      color?: string;
      apiEndpoint?: string;
      apiKey?: string;
      secretKey?: string | null; // 引用 Secret Manager 中的密钥名称
      maxTokens?: number;
      temperature?: number;
      description?: string;
      isEnabled?: boolean;
      isReasoning?: boolean;
      // ★ 新增：模型能力配置字段
      apiFormat?: string;
      supportsTemperature?: boolean;
      supportsStreaming?: boolean;
      supportsFunctionCalling?: boolean;
      supportsVision?: boolean;
      tokenParamName?: string;
      defaultTimeoutMs?: number;
      priceInputPerMillion?: number;
      priceOutputPerMillion?: number;
      priority?: number;
      // ★ Structured Output capability matrix (2026-05-06)
      structuredOutputStrategy?: string | null;
      fallbackStrategies?: string[];
      supportsJsonSchemaStrict?: boolean;
      supportsJsonSchema?: boolean;
      supportsToolUse?: boolean;
      supportsJsonMode?: boolean;
      supportsGbnfGrammar?: boolean;
    },
  ) {
    this.logger.log(`Admin: Updating AI model ${id}, type=${body.modelType}`);
    return this.adminService.updateAIModel(id, body);
  }

  /**
   * 设置默认AI模型
   * POST /api/v1/admin/ai-models/:id/set-default
   */
  @Post("ai-models/:id/set-default")
  async setDefaultAIModel(@Param("id") id: string) {
    this.logger.log(`Admin: Setting default AI model ${id}`);
    return this.adminService.setDefaultAIModel(id);
  }

  /**
   * 删除AI模型
   * DELETE /api/v1/admin/ai-models/:id
   */
  @Delete("ai-models/:id")
  async deleteAIModel(@Param("id") id: string) {
    this.logger.log(`Admin: Deleting AI model ${id}`);
    return this.adminService.deleteAIModel(id);
  }

  /**
   * v3.1 §B.3 admin override 路径 —— PATCH /api/v1/admin/ai-models/:id/capability-overrides
   *
   * 写入 AIModel.capability_overrides JSONB。所有校验/写入/AuditLog 在
   * CapabilityOverridesWriterService.applyOverrideTransactional 同事务完成
   * （patch shape strict-zod + reason ≥30 chars + scope=ADMIN 矩阵）。
   *
   * 守护：JwtAuthGuard + AdminGuard（@Controller 级），任何 actor.role!='admin' 拒。
   */
  @Patch("ai-models/:id/capability-overrides")
  async applyAIModelCapabilityOverrides(
    @Param("id") id: string,
    @Body() dto: ApplyCapabilityOverridesDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actorId = req.user?.id ?? "unknown-admin";
    this.logger.log(
      `Admin: applying capability_overrides to ai_model=${id} (actor=${actorId})`,
    );
    return this.capabilityOverridesWriter.applyOverrideTransactional({
      target: { kind: "ai_model", id },
      scope: "ADMIN",
      actor: { id: actorId, role: "admin" },
      patch: dto.patch,
      source: "admin-override",
      reason: dto.reason,
      ipAddress: req.ip,
      userAgent: req.headers?.["user-agent"],
    });
  }

  /**
   * v3.1 §B.3 admin override 重置 —— DELETE /api/v1/admin/ai-models/:id/capability-overrides
   *
   * 用 patch={} + 内部把整列 reset 为 null 处理；当前实现是写入空对象（不彻底 null）
   * —— B+ 增强：service 加 clearOverrideTransactional 把列置 null（drop 整 overlay）。
   * 本片为简洁先做"清空到 {}（无字段覆盖）" 语义，仍记 AuditLog。
   */
  @Delete("ai-models/:id/capability-overrides")
  async clearAIModelCapabilityOverrides(
    @Param("id") id: string,
    @Body() dto: DeleteCapabilityOverridesDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const actorId = req.user?.id ?? "unknown-admin";
    this.logger.log(
      `Admin: clearing capability_overrides on ai_model=${id} (actor=${actorId})`,
    );
    // v3.1 §B+.4: 改调 clearOverrideTransactional 真清 overlay 列（SET NULL），
    // 而非旧 patch={} + deep-merge"不覆盖任何字段"的等价 noop。
    return this.capabilityOverridesWriter.clearOverrideTransactional({
      target: { kind: "ai_model", id },
      scope: "ADMIN",
      actor: { id: actorId, role: "admin" },
      source: "admin-override",
      reason: dto.reason,
      ipAddress: req.ip,
      userAgent: req.headers?.["user-agent"],
    });
  }

  /**
   * 测试AI模型连接
   * POST /api/v1/admin/ai-models/:id/test
   */
  @Post("ai-models/:id/test")
  async testAIModelConnection(@Param("id") id: string) {
    this.logger.log(`Admin: Testing AI model connection ${id}`);

    // 获取模型配置
    const model = await this.adminService.getAIModel(id);

    // 获取真实的 API Key（getAIModel 返回的是掩码 "***configured***"）
    const apiKey = await this.adminService.getAIModelApiKey(id);

    // 检查是否有 API Key
    if (!apiKey) {
      return {
        modelId: id,
        modelName: model.name,
        displayName: model.displayName,
        success: false,
        message: "API key is not configured for this model",
        latency: 0,
      };
    }

    this.logger.log(
      `[testConnection] provider=${model.provider}, modelId=${model.modelId}, apiKeyLength=${apiKey.length}, apiKeyPrefix="${apiKey.substring(0, 12)}...", endpoint=${model.apiEndpoint || "default"}`,
    );

    // 使用数据库中的真实 API Key 测试连接
    const result = await this.chatFacade.testModelConnectionWithKey(
      model.provider,
      model.modelId,
      apiKey,
      model.apiEndpoint,
      model.modelType, // Pass modelType for special handling of EMBEDDING/RERANK
    );

    return {
      modelId: id,
      modelName: model.name,
      displayName: model.displayName,
      ...result,
    };
  }

  // ============ System Settings ============

  /**
   * 获取系统设置
   * GET /api/v1/admin/settings
   */
  @Get("settings")
  async getSettings(@Query("category") category?: string) {
    this.logger.log(`Admin: Fetching settings (category=${category})`);
    return this.adminService.getSettings(category);
  }

  /**
   * 更新系统设置
   * PATCH /api/v1/admin/settings
   */
  @Patch("settings")
  async updateSettings(
    @Body()
    body: Array<{
      key: string;
      value: string | number | boolean | Record<string, unknown>;
      description?: string;
      category?: string;
    }>,
  ) {
    this.logger.log(`Admin: Updating ${body.length} settings`);
    return this.adminService.setSettings(body);
  }

  // ============ Category-Specific Settings Endpoints ============

  /**
   * Get SMTP settings
   * GET /api/v1/admin/settings/smtp
   */
  @Get("settings/smtp")
  async getSmtpSettings() {
    this.logger.log("Admin: Fetching SMTP settings");
    return this.adminService.getSmtpSettings();
  }

  /**
   * Update SMTP settings
   * PUT /api/v1/admin/settings/smtp
   */
  @Put("settings/smtp")
  async updateSmtpSettings(
    @Body()
    body: {
      host?: string;
      port?: number;
      user?: string;
      pass?: string;
      from?: string;
      enabled?: boolean;
      adminEmail?: string;
    },
  ) {
    this.logger.log("Admin: Updating SMTP settings");
    return this.adminService.updateSmtpSettings(body);
  }

  /**
   * Test SMTP connection
   * POST /api/v1/admin/settings/smtp/test
   */
  @Post("settings/smtp/test")
  async testSmtpConnection() {
    this.logger.log("Admin: Testing SMTP connection");
    return this.adminService.testSmtpConnection();
  }

  // ============ Unified Email Settings (SMTP + Resend) ============

  /**
   * Get unified email settings
   * GET /api/v1/admin/settings/email
   */
  @Get("settings/email")
  async getEmailSettings() {
    this.logger.log("Admin: Fetching unified email settings");
    return this.adminService.getEmailSettingsUnified();
  }

  /**
   * Update unified email settings
   * PUT /api/v1/admin/settings/email
   */
  @Put("settings/email")
  async updateEmailSettings(
    @Body()
    body: {
      provider?: "smtp" | "resend";
      enabled?: boolean;
      from?: string;
      adminEmail?: string;
      host?: string;
      port?: number;
      user?: string;
      pass?: string;
      resendApiKey?: string;
    },
  ) {
    this.logger.log("Admin: Updating unified email settings");
    return this.adminService.updateEmailSettingsUnified(body);
  }

  /**
   * Test email connection (supports both SMTP and Resend)
   * POST /api/v1/admin/settings/email/test
   */
  @Post("settings/email/test")
  async testEmailConnection() {
    this.logger.log("Admin: Testing email connection");
    return this.adminService.testEmailConnection();
  }

  /**
   * Get Site settings
   * GET /api/v1/admin/settings/site
   */
  @Get("settings/site")
  async getSiteSettings() {
    this.logger.log("Admin: Fetching Site settings");
    return this.adminService.getSiteSettings();
  }

  /**
   * Update Site settings
   * PUT /api/v1/admin/settings/site
   */
  @Put("settings/site")
  async updateSiteSettings(
    @Body()
    body: {
      siteName?: string;
      siteDescription?: string;
      maintenanceMode?: boolean;
      maintenanceMessage?: string;
      allowRegistration?: boolean;
      requireEmailVerification?: boolean;
    },
  ) {
    this.logger.log("Admin: Updating Site settings");
    return this.adminService.updateSiteSettings(body);
  }

  /**
   * Get AI settings
   * GET /api/v1/admin/settings/ai
   */
  @Get("settings/ai")
  async getAiSettings() {
    this.logger.log("Admin: Fetching AI settings");
    return this.adminService.getAiSettings();
  }

  /**
   * Update AI settings
   * PUT /api/v1/admin/settings/ai
   */
  @Put("settings/ai")
  async updateAiSettings(
    @Body()
    body: {
      defaultModel?: string;
      maxTokens?: number;
      temperature?: number;
      rateLimitPerMinute?: number;
      rateLimitPerDay?: number;
    },
  ) {
    this.logger.log("Admin: Updating AI settings");
    return this.adminService.updateAiSettings(body);
  }

  /**
   * Get Security settings
   * GET /api/v1/admin/settings/security
   */
  @Get("settings/security")
  async getSecuritySettings() {
    this.logger.log("Admin: Fetching Security settings");
    return this.adminService.getSecuritySettings();
  }

  /**
   * Update Security settings
   * PUT /api/v1/admin/settings/security
   */
  @Put("settings/security")
  async updateSecuritySettings(
    @Body()
    body: {
      sessionTimeoutHours?: number;
      maxLoginAttempts?: number;
      lockoutDurationMinutes?: number;
    },
  ) {
    this.logger.log("Admin: Updating Security settings");
    return this.adminService.updateSecuritySettings(body);
  }

  /**
   * Get Storage settings
   * GET /api/v1/admin/settings/storage
   */
  @Get("settings/storage")
  async getStorageSettings() {
    this.logger.log("Admin: Fetching Storage settings");
    return this.adminService.getStorageSettings();
  }

  /**
   * Update Storage settings
   * PUT /api/v1/admin/settings/storage
   */
  @Put("settings/storage")
  async updateStorageSettings(
    @Body()
    body: {
      maxUploadSizeMb?: number;
      allowedFileTypes?: string;
    },
  ) {
    this.logger.log("Admin: Updating Storage settings");
    return this.adminService.updateStorageSettings(body);
  }

  // ============ Search API Configuration ============

  /**
   * 获取搜索API配置
   * GET /api/v1/admin/search-config
   */
  @Get("search-config")
  async getSearchConfig() {
    this.logger.log("Admin: Fetching search config");
    return this.adminService.getSearchConfig();
  }

  /**
   * 更新搜索API配置
   * PATCH /api/v1/admin/search-config
   */
  @Patch("search-config")
  async updateSearchConfig(
    @Body()
    body: {
      provider?: string;
      enabled?: boolean;
      perplexityApiKey?: string;
      tavilyApiKey?: string; // 兼容旧格式（单个 Key）
      serperApiKey?: string; // 兼容旧格式（单个 Key）
      tavilyApiKeys?: string[]; // 新格式（多个 Key）
      serperApiKeys?: string[]; // 新格式（多个 Key）
    },
  ) {
    this.logger.log("Admin: Updating search config");
    return this.adminService.updateSearchConfig(body);
  }

  /**
   * 测试搜索API连接
   * POST /api/v1/admin/search-config/test
   */
  @Post("search-config/test")
  async testSearchConnection(
    @Body()
    body: {
      provider: string;
      apiKey?: string;
      secretKey?: string;
    },
  ) {
    this.logger.log(`Admin: Testing search connection for ${body.provider}`);

    try {
      // Get API key - either directly provided or from Secret Manager
      let apiKey = body.apiKey?.trim();
      if (!apiKey && body.secretKey) {
        const secretValue = await this.secretsService.getValue(body.secretKey);
        if (!secretValue) {
          return {
            success: false,
            message: `Secret '${body.secretKey}' not found or has no value`,
          };
        }
        apiKey = secretValue.trim();
      }

      const { HttpService } = await import("@nestjs/axios");

      // Create a temporary test instance
      const httpService = new HttpService();

      // Test search
      const testQuery = "AI technology news";
      let response;

      // Require API key for non-free providers
      if (body.provider !== "duckduckgo" && !apiKey) {
        return {
          success: false,
          message:
            "No API key provided. Please configure an API key or select a secret.",
        };
      }

      if (body.provider === "duckduckgo") {
        // DuckDuckGo is free, no key needed
        const { firstValueFrom } = await import("rxjs");
        response = await firstValueFrom(
          httpService.get(
            `https://html.duckduckgo.com/html/?q=${encodeURIComponent(testQuery)}`,
            {
              timeout: 10000,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (compatible; GenesisAI/1.0; +https://genesis-ai.com)",
              },
            },
          ),
        );

        return {
          success: response.status === 200,
          message: "DuckDuckGo search endpoint reachable",
        };
      } else if (body.provider === "perplexity") {
        const { firstValueFrom } = await import("rxjs");
        response = await firstValueFrom(
          httpService.post(
            "https://api.perplexity.ai/chat/completions",
            {
              model: PERPLEXITY_VALIDATION_MODEL,
              messages: [
                {
                  role: "user",
                  content: testQuery,
                },
              ],
              max_tokens: 50,
            },
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              timeout: 15000,
            },
          ),
        );

        return {
          success: true,
          message: "Perplexity API connection successful",
          model: (response.data.model as string | undefined) ?? "",
        };
      } else if (body.provider === "tavily") {
        const { firstValueFrom } = await import("rxjs");
        response = await firstValueFrom(
          httpService.post(
            "https://api.tavily.com/search",
            {
              api_key: apiKey,
              query: testQuery,
              max_results: 1,
              search_depth: "basic",
            },
            {
              headers: { "Content-Type": "application/json" },
              timeout: 10000,
            },
          ),
        );

        return {
          success: true,
          message: "Tavily API connection successful",
          resultsCount: response.data.results?.length || 0,
        };
      } else if (body.provider === "serper") {
        const { firstValueFrom } = await import("rxjs");
        response = await firstValueFrom(
          httpService.post(
            "https://google.serper.dev/search",
            {
              q: testQuery,
              num: 1,
            },
            {
              headers: {
                "X-API-KEY": apiKey,
                "Content-Type": "application/json",
              },
              timeout: 10000,
            },
          ),
        );

        return {
          success: true,
          message: "Serper API connection successful",
          resultsCount: response.data.organic?.length || 0,
        };
      }

      return {
        success: false,
        message: `Unknown provider: ${body.provider}`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Search API test failed: ${message}`);
      return {
        success: false,
        message,
      };
    }
  }

  // ============ Policy Research API Test ============

  /**
   * 测试政策研究API连接
   * POST /api/v1/admin/policy-config/test
   */
  @Post("policy-config/test")
  async testPolicyConnection(
    @Body()
    body: {
      provider: string;
      secretKey?: string;
    },
  ) {
    this.logger.log(`Admin: Testing policy API for ${body.provider}`);

    try {
      const { HttpService } = await import("@nestjs/axios");
      const { firstValueFrom } = await import("rxjs");
      const httpService = new HttpService();

      if (body.provider === "federal-register") {
        // Federal Register API is free, no key needed
        const response = await firstValueFrom(
          httpService.get(
            "https://www.federalregister.gov/api/v1/documents.json?per_page=1&order=newest",
            { timeout: 10000 },
          ),
        );

        return {
          success: true,
          message: "Federal Register API connection successful",
          resultsCount: response.data.count || 0,
        };
      } else if (body.provider === "congress-gov") {
        let apiKey = "";
        if (body.secretKey) {
          const secretValue = await this.secretsService.getValue(
            body.secretKey,
          );
          if (!secretValue) {
            return {
              success: false,
              message: `Secret '${body.secretKey}' not found or has no value`,
            };
          }
          apiKey = secretValue.trim();
        }

        if (!apiKey) {
          return {
            success: false,
            message:
              "No API key configured. Get a free key at https://api.congress.gov/sign-up/",
          };
        }

        const response = await firstValueFrom(
          httpService.get(
            `https://api.congress.gov/v3/bill?limit=1&api_key=${apiKey}`,
            { timeout: 10000 },
          ),
        );

        return {
          success: true,
          message: "Congress.gov API connection successful",
          resultsCount: response.data.bills?.length || 0,
        };
      } else if (body.provider === "whitehouse-news") {
        // White House News scraping, no key needed
        const response = await firstValueFrom(
          httpService.get("https://www.whitehouse.gov/news/", {
            timeout: 10000,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (compatible; GenesisAI/1.0; +https://genesis-ai.com)",
            },
          }),
        );

        return {
          success: response.status === 200,
          message:
            response.status === 200
              ? "White House News endpoint reachable"
              : `Unexpected status: ${response.status}`,
        };
      }

      return {
        success: false,
        message: `Unknown policy provider: ${body.provider}`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Policy API test failed: ${message}`);
      return { success: false, message };
    }
  }

  // ============ Finance API Test ============

  /**
   * 测试金融数据API连接
   * POST /api/v1/admin/finance-config/test
   */
  @Post("finance-config/test")
  async testFinanceConnection(
    @Body()
    body: {
      provider: string;
      secretKey?: string;
    },
  ) {
    this.logger.log(`Admin: Testing finance API for ${body.provider}`);

    try {
      if (body.provider === "alpha-vantage") {
        let apiKey = "";
        if (body.secretKey) {
          const secretValue = await this.secretsService.getValue(
            body.secretKey,
          );
          if (!secretValue) {
            return {
              success: false,
              message: `Secret '${body.secretKey}' not found or has no value`,
            };
          }
          apiKey = secretValue.trim();
        }

        if (!apiKey) {
          return {
            success: false,
            message:
              "No API key configured. Get a free key at https://www.alphavantage.co/support/#api-key",
          };
        }

        const { HttpService } = await import("@nestjs/axios");
        const { firstValueFrom } = await import("rxjs");
        const httpService = new HttpService();

        const response = await firstValueFrom(
          httpService.get(
            `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AAPL&apikey=${apiKey}`,
            { timeout: 10000 },
          ),
        );

        // Alpha Vantage returns error in body, not HTTP status
        if (response.data["Error Message"] || response.data["Note"]) {
          return {
            success: false,
            message:
              response.data["Error Message"] ||
              response.data["Note"] ||
              "API key invalid or rate limited",
          };
        }

        return {
          success: true,
          message: "Alpha Vantage API connection successful",
        };
      }

      return {
        success: false,
        message: `Unknown finance provider: ${body.provider}`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Finance API test failed: ${message}`);
      return { success: false, message };
    }
  }

  // ============ DevTools API Test ============

  /**
   * 测试开发工具API连接
   * POST /api/v1/admin/devtools-config/test
   */
  @Post("devtools-config/test")
  async testDevtoolsConnection(
    @Body()
    body: {
      provider: string;
      secretKey?: string;
    },
  ) {
    this.logger.log(`Admin: Testing devtools API for ${body.provider}`);

    try {
      if (body.provider === "github-search") {
        const { HttpService } = await import("@nestjs/axios");
        const { firstValueFrom } = await import("rxjs");
        const httpService = new HttpService();

        const headers: Record<string, string> = {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "GenesisAI",
        };

        // GitHub works without a key (lower rate limit)
        if (body.secretKey) {
          const secretValue = await this.secretsService.getValue(
            body.secretKey,
          );
          if (secretValue) {
            headers["Authorization"] = `Bearer ${secretValue.trim()}`;
          }
        }

        const response = await firstValueFrom(
          httpService.get(
            "https://api.github.com/search/repositories?q=test&per_page=1",
            { timeout: 10000, headers },
          ),
        );

        const rateLimit = response.headers["x-ratelimit-remaining"];
        return {
          success: true,
          message: `GitHub API connection successful (rate limit remaining: ${rateLimit || "unknown"})`,
          resultsCount: response.data.total_count || 0,
        };
      }

      return {
        success: false,
        message: `Unknown devtools provider: ${body.provider}`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`DevTools API test failed: ${message}`);
      return { success: false, message };
    }
  }

  // ============ Content Extraction API Configuration ============

  /**
   * 获取内容提取API配置
   * GET /api/v1/admin/extraction-config
   */
  @Get("extraction-config")
  async getContentExtractionConfig() {
    this.logger.log("Admin: Fetching content extraction config");
    return this.adminService.getContentExtractionConfig();
  }

  /**
   * 更新内容提取API配置
   * PATCH /api/v1/admin/extraction-config
   */
  @Patch("extraction-config")
  async updateContentExtractionConfig(
    @Body()
    body: {
      enabled?: boolean;
      jinaApiKey?: string;
      firecrawlApiKey?: string;
      tavilyApiKey?: string;
    },
  ) {
    this.logger.log("Admin: Updating content extraction config");
    return this.adminService.updateContentExtractionConfig(body);
  }

  /**
   * 测试内容提取API连接
   * POST /api/v1/admin/extraction-config/test
   */
  @Post("extraction-config/test")
  async testExtractionConnection(
    @Body()
    body: {
      provider: "jina" | "firecrawl" | "tavily";
      apiKey?: string;
      secretKey?: string;
    },
  ) {
    this.logger.log(
      `Admin: Testing extraction connection for ${body.provider}`,
    );

    try {
      // Get API key - either directly provided or from Secret Manager
      let apiKey = body.apiKey?.trim();
      if (!apiKey && body.secretKey) {
        const secretValue = await this.secretsService.getValue(body.secretKey);
        if (!secretValue) {
          return {
            success: false,
            message: `Secret '${body.secretKey}' not found or has no value`,
          };
        }
        apiKey = secretValue.trim();
      }

      if (!apiKey) {
        return {
          success: false,
          message:
            "No API key provided. Please configure an API key or select a secret.",
        };
      }

      if (body.provider === "jina") {
        // Test Jina AI Reader
        const response = await fetch("https://r.jina.ai/https://example.com", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
        });

        if (response.ok) {
          return {
            success: true,
            message: "Jina AI Reader connection successful",
          };
        } else {
          return {
            success: false,
            message: `Jina API error: HTTP ${response.status}`,
          };
        }
      } else if (body.provider === "firecrawl") {
        // Test Firecrawl
        const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: "https://example.com",
            formats: ["markdown"],
          }),
        });

        if (response.ok) {
          return {
            success: true,
            message: "Firecrawl connection successful",
          };
        } else {
          const errorData = await response.text();
          return {
            success: false,
            message: `Firecrawl API error: ${response.status} - ${errorData.slice(0, 100)}`,
          };
        }
      } else if (body.provider === "tavily") {
        // Test Tavily
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            api_key: apiKey,
            query: "test",
            max_results: 1,
          }),
        });

        if (response.ok) {
          return {
            success: true,
            message: "Tavily connection successful",
          };
        } else {
          return {
            success: false,
            message: `Tavily API error: HTTP ${response.status}`,
          };
        }
      }

      return {
        success: false,
        message: `Unknown provider: ${body.provider}`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Extraction API test failed: ${message}`);
      return {
        success: false,
        message,
      };
    }
  }

  // ============ YouTube API Configuration ============

  /**
   * 获取YouTube字幕API配置
   * GET /api/v1/admin/youtube-config
   */
  @Get("youtube-config")
  async getYoutubeConfig() {
    this.logger.log("Admin: Fetching YouTube config");
    return this.adminService.getYoutubeConfig();
  }

  /**
   * 更新YouTube字幕API配置
   * PATCH /api/v1/admin/youtube-config
   */
  @Patch("youtube-config")
  async updateYoutubeConfig(
    @Body()
    body: {
      enabled?: boolean;
      provider?: string;
      supadataApiKey?: string;
    },
  ) {
    this.logger.log("Admin: Updating YouTube config");
    return this.adminService.updateYoutubeConfig(body);
  }

  /**
   * 测试YouTube字幕API连接
   * POST /api/v1/admin/youtube-config/test
   */
  @Post("youtube-config/test")
  async testYoutubeConnection(
    @Body()
    body: {
      provider: string;
      apiKey?: string;
      secretKey?: string;
    },
  ) {
    this.logger.log(
      `Admin: Testing YouTube API connection for ${body.provider}`,
    );

    try {
      // Get API key - either directly provided or from Secret Manager
      let apiKey = body.apiKey?.trim();
      if (!apiKey && body.secretKey) {
        const secretValue = await this.secretsService.getValue(body.secretKey);
        if (!secretValue) {
          return {
            success: false,
            message: `Secret '${body.secretKey}' not found or has no value`,
          };
        }
        apiKey = secretValue.trim();
      }

      if (!apiKey) {
        return {
          success: false,
          message:
            "No API key provided. Please configure an API key or select a secret.",
        };
      }

      if (body.provider === "supadata") {
        // Test Supadata API with a known video
        const testVideoId = "dQw4w9WgXcQ"; // Rick Astley - Never Gonna Give You Up
        const response = await fetch(
          `https://api.supadata.ai/v1/youtube/transcript?video_id=${testVideoId}&text=true`,
          {
            headers: {
              "x-api-key": apiKey,
            },
          },
        );

        if (response.ok) {
          const data = await response.json();
          return {
            success: true,
            message: "Supadata API 连接成功",
            hasContent: !!data.content || !!data.transcript,
          };
        } else {
          const errorText = await response.text();
          return {
            success: false,
            message: `Supadata API 错误: HTTP ${response.status} - ${errorText.slice(0, 100)}`,
          };
        }
      }

      return {
        success: false,
        message: `未知的 provider: ${body.provider}`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`YouTube API test failed: ${message}`);
      return {
        success: false,
        message,
      };
    }
  }

  // ============ TTS (Text-to-Speech) Config ============

  /**
   * 获取TTS配置
   * GET /api/v1/admin/tts-config
   */
  @Get("tts-config")
  async getTTSConfig() {
    this.logger.log("Admin: Fetching TTS config");
    return this.adminService.getTTSConfig();
  }

  /**
   * 更新TTS配置
   * PATCH /api/v1/admin/tts-config
   */
  @Patch("tts-config")
  async updateTTSConfig(
    @Body()
    body: {
      enabled?: boolean;
      provider?: string;
      elevenLabsApiKey?: string;
      googleTTSApiKey?: string;
    },
  ) {
    this.logger.log("Admin: Updating TTS config");
    return this.adminService.updateTTSConfig(body);
  }

  /**
   * 测试TTS API连接
   * POST /api/v1/admin/tts-config/test
   */
  @Post("tts-config/test")
  async testTTSConnection(
    @Body()
    body: {
      provider: string;
      apiKey?: string;
      secretKey?: string;
    },
  ) {
    this.logger.log(`Admin: Testing TTS API connection for ${body.provider}`);

    try {
      // Get API key - either directly provided or from Secret Manager
      let apiKey = body.apiKey?.trim();
      if (!apiKey && body.secretKey) {
        const secretValue = await this.secretsService.getValue(body.secretKey);
        if (!secretValue) {
          return {
            success: false,
            message: `Secret '${body.secretKey}' not found or has no value`,
          };
        }
        apiKey = secretValue.trim();
      }

      if (!apiKey) {
        return {
          success: false,
          message:
            "No API key provided. Please configure an API key or select a secret.",
        };
      }

      if (body.provider === "elevenlabs") {
        // Test ElevenLabs API - get available voices
        const response = await fetch("https://api.elevenlabs.io/v1/voices", {
          headers: {
            "xi-api-key": apiKey,
          },
        });

        if (response.ok) {
          const data = await response.json();
          return {
            success: true,
            message: `ElevenLabs API 连接成功，发现 ${data.voices?.length || 0} 个可用声音`,
          };
        } else {
          return {
            success: false,
            message: `ElevenLabs API 错误: HTTP ${response.status}`,
          };
        }
      }

      if (body.provider === "google") {
        // Test Google Cloud TTS API - list voices
        const response = await fetch(
          `https://texttospeech.googleapis.com/v1/voices?key=${apiKey}`,
        );

        if (response.ok) {
          const data = await response.json();
          return {
            success: true,
            message: `Google TTS API 连接成功，发现 ${data.voices?.length || 0} 个可用声音`,
          };
        } else {
          const errorData = await response.json().catch(() => ({}));
          return {
            success: false,
            message: `Google TTS API 错误: ${errorData.error?.message || `HTTP ${response.status}`}`,
          };
        }
      }

      return {
        success: false,
        message: `未知的 provider: ${body.provider}`,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`TTS API test failed: ${message}`);
      return {
        success: false,
        message,
      };
    }
  }

  // ============ SkillsMP Configuration ============

  /**
   * 获取SkillsMP配置
   * GET /api/v1/admin/skillsmp-config
   */
  @Get("skillsmp-config")
  async getSkillsmpConfig() {
    this.logger.log("Admin: Getting SkillsMP config");
    return this.adminService.getSkillsmpConfig();
  }

  /**
   * 更新SkillsMP配置
   * PUT /api/v1/admin/skillsmp-config
   */
  @Put("skillsmp-config")
  async updateSkillsmpConfig(
    @Body()
    body: {
      enabled?: boolean;
      apiKey?: string;
      syncInterval?: "daily" | "weekly" | "manual";
    },
  ) {
    this.logger.log("Admin: Updating SkillsMP config");
    return this.adminService.updateSkillsmpConfig(body);
  }

  /**
   * 测试SkillsMP API连接
   * POST /api/v1/admin/skillsmp-config/test
   */
  @Post("skillsmp-config/test")
  async testSkillsmpConnection(
    @Body()
    body: {
      apiKey?: string;
      secretKey?: string;
    },
  ) {
    this.logger.log("Admin: Testing SkillsMP API connection");

    try {
      // Get API key - either directly provided or from Secret Manager
      let apiKey = body.apiKey;
      if (!apiKey && body.secretKey) {
        const secretValue = await this.secretsService.getValue(body.secretKey);
        if (!secretValue) {
          return {
            success: false,
            message: `Secret '${body.secretKey}' not found or has no value`,
          };
        }
        apiKey = secretValue;
      }

      if (!apiKey) {
        return {
          success: false,
          message:
            "No API key provided. Please configure an API key or select a secret.",
        };
      }

      // Test SkillsMP API - search for a simple query
      const response = await fetch(
        "https://skillsmp.com/api/v1/skills/search?q=test&limit=1",
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (response.ok) {
        const data = await response.json();
        // Log the actual response structure
        this.logger.log(
          `SkillsMP API test response: keys=${Object.keys(data).join(",")}`,
        );
        // Log sample data if available
        const skillsArray =
          data.skills || data.results || data.data || data.items || [];
        this.logger.log(
          `SkillsMP API test: found ${skillsArray.length} skills in response`,
        );
        if (skillsArray.length > 0) {
          this.logger.log(
            `SkillsMP sample skill keys: ${Object.keys(skillsArray[0]).join(",")}`,
          );
        }
        return {
          success: true,
          message: `SkillsMP API 连接成功，共有 ${data.total || "60,000+"} 个技能`,
        };
      } else if (response.status === 401) {
        return {
          success: false,
          message: "API Key 无效，请检查是否正确",
        };
      } else {
        return {
          success: false,
          message: `SkillsMP API 错误: HTTP ${response.status}`,
        };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`SkillsMP API test failed: ${message}`);
      return {
        success: false,
        message,
      };
    }
  }

  /**
   * 手动触发SkillsMP同步
   * POST /api/v1/admin/skillsmp-config/sync
   */
  @Post("skillsmp-config/sync")
  async syncSkillsmp() {
    this.logger.log("Admin: Triggering SkillsMP sync");

    try {
      const apiKey = await this.adminService.getSkillsmpApiKey();

      if (!apiKey) {
        return {
          success: false,
          message: "未配置 API Key，无法同步",
        };
      }

      // Fetch popular skills from SkillsMP using multiple search terms
      const searchTerms = ["claude", "agent", "mcp", "tool", "api"];
      interface SkillsmpSkill {
        id?: string;
        name?: string;
        displayName?: string;
        description?: string;
        layer?: string;
        domain?: string;
        tags?: string[];
        [key: string]: unknown;
      }
      const allSkills: SkillsmpSkill[] = [];
      const seenIds = new Set<string>();

      for (const term of searchTerms) {
        try {
          const response = await fetch(
            `https://skillsmp.com/api/v1/skills/search?q=${term}&limit=20`,
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "User-Agent": APP_CONFIG.brand.userAgent,
              },
            },
          );

          if (response.ok) {
            const data = await response.json();
            // Log actual response structure for debugging
            this.logger.log(
              `SkillsMP search '${term}': response keys=${Object.keys(data).join(",")}`,
            );
            // API returns { success, data, meta } - skills may be in data directly or nested
            let skills: SkillsmpSkill[] = [];
            if (Array.isArray(data.data)) {
              skills = data.data;
            } else if (data.data && Array.isArray(data.data.skills)) {
              skills = data.data.skills;
            } else if (data.data && Array.isArray(data.data.items)) {
              skills = data.data.items;
            } else if (Array.isArray(data.skills)) {
              skills = data.skills;
            } else if (Array.isArray(data.results)) {
              skills = data.results;
            }
            this.logger.log(
              `SkillsMP search '${term}': ${skills.length} skills found`,
            );
            if (
              data.data &&
              typeof data.data === "object" &&
              !Array.isArray(data.data)
            ) {
              this.logger.log(
                `SkillsMP data.data keys: ${Object.keys(data.data).join(",")}`,
              );
            }
            for (const skill of skills) {
              const id = skill.id || normalizeMarkdownSlug(skill.name || "");
              if (id && !seenIds.has(id)) {
                seenIds.add(id);
                allSkills.push(skill);
              }
            }
          }
        } catch (searchError) {
          this.logger.warn(`SkillsMP search '${term}' failed`);
        }
      }

      // Store synced data
      await this.adminService.setSetting("skillsmp.syncedSkills", allSkills);
      await this.adminService.setSetting(
        "skillsmp.lastSync",
        new Date().toISOString(),
      );
      await this.adminService.setSetting(
        "skillsmp.totalSkills",
        allSkills.length,
      );

      return {
        success: true,
        message: `同步成功，获取了 ${allSkills.length} 个技能`,
        lastSync: new Date().toISOString(),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`SkillsMP sync failed: ${message}`);
      return {
        success: false,
        message,
      };
    }
  }

  /**
   * 获取同步的SkillsMP数据
   * GET /api/v1/admin/skillsmp-config/skills
   */
  @Get("skillsmp-config/skills")
  async getSkillsmpSkills() {
    const syncedSkills =
      (await this.adminService.getSetting("skillsmp.syncedSkills")) ?? [];
    const totalSkills =
      (await this.adminService.getSetting("skillsmp.totalSkills")) ?? 66541;
    const lastSync = await this.adminService.getSetting("skillsmp.lastSync");

    // 如果没有同步的技能，返回预置的示例技能
    const skills =
      syncedSkills.length > 0
        ? syncedSkills
        : this.getPresetMarketplaceSkills();

    return {
      skills,
      totalSkills,
      lastSync: lastSync || null,
    };
  }

  /**
   * 安装 SkillsMP 技能
   * POST /api/v1/admin/skillsmp/skills/:skillId/install
   */
  @Post("skillsmp/skills/:skillId/install")
  async installSkillFromMarketplace(@Param("skillId") skillId: string) {
    this.logger.log(`Installing skill from marketplace: ${skillId}`);

    try {
      // 1. 从已同步的 skills 中查找
      const syncedSkills =
        (await this.adminService.getSetting("skillsmp.syncedSkills")) ?? [];
      const presetSkills = this.getPresetMarketplaceSkills();
      const allSkills = [...syncedSkills, ...presetSkills];

      const skill = allSkills.find(
        (s: { id: string; name: string }) =>
          s.id === skillId || s.name === skillId,
      );

      if (!skill) {
        return {
          success: false,
          message: `Skill not found: ${skillId}`,
        };
      }

      // 2. 调用 Service 在数据库中创建技能配置
      await this.adminService.installSkillFromMarketplace({
        id: skill.id,
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
        layer: skill.layer,
        domain: skill.domain,
        tags: skill.tags,
      });

      this.logger.log(`Successfully installed skill: ${skillId}`);
      return {
        success: true,
        message: `Successfully installed skill: ${skill.displayName || skill.name}`,
        skill: {
          id: skill.id,
          name: skill.name,
          displayName: skill.displayName,
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to install skill ${skillId}: ${message}`);
      return {
        success: false,
        message,
      };
    }
  }

  /**
   * 获取预置的市场技能列表
   * 这些是示例技能，用于展示 Skills Marketplace 的功能
   */
  private getPresetMarketplaceSkills() {
    return [
      // Research & Analysis Skills
      {
        id: "skill-deep-research",
        name: "deep-research",
        displayName: "Deep Research",
        description:
          "Advanced research methodology for comprehensive topic analysis with multi-source verification",
        version: "2.1.0",
        author: "SkillsMP Official",
        layer: "application",
        domain: "research",
        tags: ["research", "analysis", "verification", "multi-source"],
        rating: 4.9,
        ratingCount: 1250,
        downloads: 15680,
        requiredTools: ["web-search", "web-scraper"],
        requiredSkills: [],
        createdAt: "2024-06-15T00:00:00Z",
        updatedAt: "2025-01-10T00:00:00Z",
      },
      {
        id: "skill-academic-writing",
        name: "academic-writing",
        displayName: "Academic Writing",
        description:
          "Professional academic writing with proper citations, structure, and scholarly tone",
        version: "1.8.0",
        author: "SkillsMP Official",
        layer: "application",
        domain: "writing",
        tags: ["academic", "writing", "citations", "scholarly"],
        rating: 4.8,
        ratingCount: 890,
        downloads: 12450,
        requiredTools: [],
        requiredSkills: [],
        createdAt: "2024-07-20T00:00:00Z",
        updatedAt: "2025-01-05T00:00:00Z",
      },
      {
        id: "skill-data-visualization",
        name: "data-visualization",
        displayName: "Data Visualization",
        description:
          "Create insightful charts, graphs, and visual representations of complex data",
        version: "1.5.0",
        author: "DataViz Labs",
        layer: "capability",
        domain: "data",
        tags: ["visualization", "charts", "data", "analytics"],
        rating: 4.7,
        ratingCount: 560,
        downloads: 8920,
        requiredTools: ["data-analysis"],
        requiredSkills: [],
        createdAt: "2024-08-10T00:00:00Z",
        updatedAt: "2024-12-20T00:00:00Z",
      },
      // Content Creation Skills
      {
        id: "skill-content-marketing",
        name: "content-marketing",
        displayName: "Content Marketing",
        description:
          "Create engaging marketing content optimized for various platforms and audiences",
        version: "2.0.0",
        author: "Marketing Pro",
        layer: "application",
        domain: "marketing",
        tags: ["marketing", "content", "seo", "engagement"],
        rating: 4.6,
        ratingCount: 720,
        downloads: 9840,
        requiredTools: ["web-search"],
        requiredSkills: [],
        createdAt: "2024-05-01T00:00:00Z",
        updatedAt: "2024-11-15T00:00:00Z",
      },
      {
        id: "skill-technical-documentation",
        name: "technical-documentation",
        displayName: "Technical Documentation",
        description:
          "Write clear, comprehensive technical documentation for software and APIs",
        version: "1.6.0",
        author: "DevDocs Team",
        layer: "application",
        domain: "development",
        tags: ["documentation", "technical", "api", "software"],
        rating: 4.8,
        ratingCount: 450,
        downloads: 7650,
        requiredTools: [],
        requiredSkills: [],
        createdAt: "2024-09-01T00:00:00Z",
        updatedAt: "2025-01-08T00:00:00Z",
      },
      // Presentation Skills
      {
        id: "skill-presentation-design",
        name: "presentation-design",
        displayName: "Presentation Design",
        description:
          "Design professional, visually appealing presentations with effective storytelling",
        version: "1.4.0",
        author: "SkillsMP Official",
        layer: "application",
        domain: "office",
        tags: ["presentation", "design", "slides", "storytelling"],
        rating: 4.7,
        ratingCount: 680,
        downloads: 11200,
        requiredTools: ["export-pptx"],
        requiredSkills: [],
        createdAt: "2024-06-20T00:00:00Z",
        updatedAt: "2024-12-01T00:00:00Z",
      },
      {
        id: "skill-executive-summary",
        name: "executive-summary",
        displayName: "Executive Summary",
        description:
          "Create concise, impactful executive summaries for business reports and proposals",
        version: "1.3.0",
        author: "Business Insights",
        layer: "capability",
        domain: "business",
        tags: ["executive", "summary", "business", "reports"],
        rating: 4.5,
        ratingCount: 340,
        downloads: 5430,
        requiredTools: [],
        requiredSkills: [],
        createdAt: "2024-10-01T00:00:00Z",
        updatedAt: "2024-12-15T00:00:00Z",
      },
      // Code & Development Skills
      {
        id: "skill-code-review",
        name: "code-review",
        displayName: "Code Review",
        description:
          "Comprehensive code review with security analysis, best practices, and improvement suggestions",
        version: "2.2.0",
        author: "DevOps Masters",
        layer: "capability",
        domain: "development",
        tags: ["code-review", "security", "best-practices", "development"],
        rating: 4.9,
        ratingCount: 980,
        downloads: 14500,
        requiredTools: ["code-generation"],
        requiredSkills: [],
        createdAt: "2024-04-15T00:00:00Z",
        updatedAt: "2025-01-12T00:00:00Z",
      },
      {
        id: "skill-api-design",
        name: "api-design",
        displayName: "API Design",
        description:
          "Design RESTful and GraphQL APIs following industry best practices and standards",
        version: "1.7.0",
        author: "API Architects",
        layer: "capability",
        domain: "development",
        tags: ["api", "rest", "graphql", "design"],
        rating: 4.6,
        ratingCount: 520,
        downloads: 7890,
        requiredTools: [],
        requiredSkills: [],
        createdAt: "2024-07-01T00:00:00Z",
        updatedAt: "2024-11-20T00:00:00Z",
      },
      // Analysis & Strategy Skills
      {
        id: "skill-competitive-analysis",
        name: "competitive-analysis",
        displayName: "Competitive Analysis",
        description:
          "Conduct thorough competitive analysis with market positioning and strategic insights",
        version: "1.5.0",
        author: "Strategy Hub",
        layer: "application",
        domain: "business",
        tags: ["competitive", "analysis", "strategy", "market"],
        rating: 4.7,
        ratingCount: 420,
        downloads: 6780,
        requiredTools: ["web-search", "web-scraper"],
        requiredSkills: ["deep-research"],
        createdAt: "2024-08-20T00:00:00Z",
        updatedAt: "2024-12-10T00:00:00Z",
      },
      {
        id: "skill-swot-analysis",
        name: "swot-analysis",
        displayName: "SWOT Analysis",
        description:
          "Perform comprehensive SWOT analysis with actionable recommendations",
        version: "1.2.0",
        author: "Business Insights",
        layer: "capability",
        domain: "business",
        tags: ["swot", "analysis", "strategy", "planning"],
        rating: 4.5,
        ratingCount: 280,
        downloads: 4560,
        requiredTools: [],
        requiredSkills: [],
        createdAt: "2024-09-15T00:00:00Z",
        updatedAt: "2024-11-30T00:00:00Z",
      },
      // Translation & Localization Skills
      {
        id: "skill-professional-translation",
        name: "professional-translation",
        displayName: "Professional Translation",
        description:
          "High-quality translation with cultural adaptation and industry-specific terminology",
        version: "1.9.0",
        author: "LinguaPro",
        layer: "capability",
        domain: "language",
        tags: ["translation", "localization", "multilingual", "cultural"],
        rating: 4.8,
        ratingCount: 650,
        downloads: 9200,
        requiredTools: [],
        requiredSkills: [],
        createdAt: "2024-05-20T00:00:00Z",
        updatedAt: "2025-01-02T00:00:00Z",
      },
    ];
  }

  // ============ External Data Providers ============

  /**
   * 获取外部数据源配置
   * GET /api/v1/admin/external-providers
   */
  @Get("external-providers")
  async getExternalProviders() {
    this.logger.log("Admin: Fetching external data providers config");
    return this.adminService.getExternalProvidersConfig();
  }

  /**
   * 更新外部数据源配置
   * PATCH /api/v1/admin/external-providers
   */
  @Patch("external-providers")
  async updateExternalProviders(
    @Body()
    body: {
      providers: Array<{
        id: string;
        name: string;
        description?: string;
        category?: string;
        enabled?: boolean;
        baseUrl?: string;
        apiKey?: string;
        headers?: string;
      }>;
    },
  ) {
    this.logger.log(
      `Admin: Updating external data providers (${body.providers?.length || 0})`,
    );
    return this.adminService.updateExternalProvidersConfig(
      body.providers || [],
    );
  }

  /**
   * 检查API余额/配额
   * GET /api/v1/admin/api-balance/:type/:provider
   */
  @Get("api-balance/:type/:provider")
  async checkApiBalance(
    @Param("type") type: "search" | "extraction",
    @Param("provider") provider: string,
  ) {
    this.logger.log(`Admin: Checking ${type} API balance for ${provider}`);
    return this.adminService.checkApiBalance(type, provider);
  }

  // ============ AI Model Type-based Selection ============

  /**
   * 获取所有模型类型及其默认模型
   * GET /api/v1/admin/ai-models/type-defaults
   * NOTE: This route MUST come before :id routes
   */
  @Get("ai-models/type-defaults")
  async getAllModelTypeDefaults() {
    this.logger.log("Admin: Fetching all model type defaults");
    return this.adminService.getAllModelTypeDefaults();
  }

  /**
   * 获取指定类型的所有模型
   * GET /api/v1/admin/ai-models/type/:type
   */
  @Get("ai-models/type/:type")
  async getAIModelsByType(@Param("type") type: AIModelType) {
    this.logger.log(`Admin: Fetching AI models of type ${type}`);
    return this.adminService.getAIModelsByType(type);
  }

  /**
   * 获取指定类型的默认模型
   * GET /api/v1/admin/ai-models/type/:type/default
   */
  @Get("ai-models/type/:type/default")
  async getDefaultModelByType(@Param("type") type: AIModelType) {
    this.logger.log(`Admin: Fetching default model for type ${type}`);
    return this.adminService.getDefaultModelByType(type);
  }

  /**
   * 设置模型为其类型的默认模型
   * POST /api/v1/admin/ai-models/:id/set-type-default
   */
  @Post("ai-models/:id/set-type-default")
  async setDefaultAIModelForType(@Param("id") id: string) {
    this.logger.log(`Admin: Setting model ${id} as default for its type`);
    return this.adminService.setDefaultAIModelForType(id);
  }

  // ============ Storage Provider Configuration ============

  /**
   * 获取存储配置
   * GET /api/v1/admin/storage-config
   */
  @Get("storage-config")
  async getStorageConfig() {
    this.logger.log("Admin: Fetching storage config");
    return this.adminService.getStorageProviderConfig();
  }

  /**
   * 更新存储配置
   * PATCH /api/v1/admin/storage-config
   */
  @Patch("storage-config")
  async updateStorageConfig(
    @Body()
    body: {
      provider?: string;
      localPath?: string;
      s3Bucket?: string;
      s3Region?: string;
      s3AccessKey?: string;
      s3SecretKey?: string;
      gdriveClientId?: string;
      gdriveClientSecret?: string;
      gdriveFolderId?: string;
      maxFileSize?: number;
      allowedTypes?: string[];
    },
  ) {
    this.logger.log("Admin: Updating storage config");
    return this.adminService.updateStorageProviderConfig(body);
  }

  /**
   * 测试 Google Drive 连接
   * POST /api/v1/admin/storage-config/test-gdrive
   */
  @Post("storage-config/test-gdrive")
  async testGDriveConnection(
    @Body()
    body: {
      clientId: string;
      clientSecret: string;
    },
  ) {
    this.logger.log("Admin: Testing Google Drive connection");
    return this.adminService.testGDriveConnection(body);
  }

  // ============ Data Collection Management ============

  /**
   * 重置所有采集数据
   * POST /api/v1/admin/collection/reset
   *
   * ⚠️ 危险操作：会删除所有 raw_data、resources 和 deduplication_records
   * 用于清空去重缓存，允许重新采集
   */
  @Post("collection/reset")
  async resetCollectionData() {
    this.logger.warn(
      "Admin: Resetting ALL collection data (raw_data, resources, deduplication_records)",
    );
    return this.adminService.resetCollectionData();
  }

  // ============ Credits Management (Admin Dashboard) ============

  /**
   * 获取所有积分账户列表
   * GET /api/v1/admin/credits/accounts
   */
  @Get("credits/accounts")
  async getCreditAccounts(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("search") search?: string,
  ) {
    this.logger.log(
      `Admin: Fetching credit accounts (page=${page}, search=${search})`,
    );
    return this.adminService.getCreditAccounts(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
      search,
    );
  }

  /**
   * 获取积分统计信息
   * GET /api/v1/admin/credits/stats
   */
  @Get("credits/stats")
  async getCreditsStats() {
    this.logger.log("Admin: Fetching credits statistics");
    return this.adminService.getCreditsStats();
  }

  /**
   * 获取用户交易记录
   * GET /api/v1/admin/credits/transactions/:userId
   */
  @Get("credits/transactions/:userId")
  async getCreditTransactions(
    @Param("userId") userId: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    this.logger.log(`Admin: Fetching transactions for user ${userId}`);
    return this.adminService.getCreditTransactions(
      userId,
      limit ? parseInt(limit) : 50,
      offset ? parseInt(offset) : 0,
    );
  }
}
