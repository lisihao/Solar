/**
 * Secrets Controller
 *
 * Admin-only API endpoints for managing secrets.
 * All endpoints require admin authentication.
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Logger,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { ApiTags } from "@nestjs/swagger";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";
import { CreateSecretDto } from "./dto/create-secret.dto";
import { UpdateSecretDto } from "./dto/update-secret.dto";
import { SecretNameValidationPipe } from "@/modules/platform/credentials/storage/secrets/pipes/secret-name-validation.pipe";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { AdminGuard } from "@/common/guards/admin.guard";
import { SecretCategory } from "@prisma/client";

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
  };
}

/**
 * Secrets Management Controller
 * All endpoints require admin privileges
 */
@ApiTags("Admin - Secrets")
@Controller("admin/secrets")
@UseGuards(JwtAuthGuard, AdminGuard)
export class SecretsController {
  private readonly logger = new Logger(SecretsController.name);

  constructor(private readonly secretsService: SecretsService) {}

  /**
   * Get all secrets (with masked values)
   * GET /api/v1/admin/secrets
   */
  @Get()
  async findAll(@Query("category") category?: SecretCategory) {
    this.logger.log(
      `Fetching secrets${category ? ` (category: ${category})` : ""}`,
    );
    return this.secretsService.findAll(category);
  }

  /**
   * Get secret names for dropdown selection
   * GET /api/v1/admin/secrets/names
   */
  @Get("names")
  async getSecretNames(@Query("category") category?: SecretCategory) {
    return this.secretsService.getSecretNames(category);
  }

  /**
   * GET /admin/secrets/expected
   * 返回平台预期应配置的 secret 列表 + 当前配置状态
   */
  @Get("expected")
  async getExpected() {
    return this.secretsService.getExpectedSecrets();
  }

  /**
   * Create a new secret
   * POST /api/v1/admin/secrets
   * M1 Fix: Rate limit 50 req/hour to prevent spam creation
   */
  @Throttle({ default: { limit: 50, ttl: 3600000 } })
  @Post()
  async create(@Body() dto: CreateSecretDto, @Req() req: AuthenticatedRequest) {
    this.logger.log(`Creating new secret`); // H4: Removed secret name from log;
    const context = this.getAuditContext(req);
    return this.secretsService.create(dto, context);
  }

  /**
   * Get a single secret by name (with masked value)
   * GET /api/v1/admin/secrets/:name
   */
  @Get(":name")
  async findByName(@Param("name", SecretNameValidationPipe) name: string) {
    this.logger.debug(`Fetching secret by name`); // H4: Reduced log level, removed name;
    return this.secretsService.findByName(name);
  }

  /**
   * Get the decrypted value of a secret (logs access)
   * GET /api/v1/admin/secrets/:name/value
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // C3 Fix: 10 req/min for secret value reveal
  @Get(":name/value")
  async getValue(
    @Param("name", SecretNameValidationPipe) name: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.logger.debug(`Secret value access requested`); // H4: Reduced log level, removed name;
    const context = this.getAuditContext(req);
    const value = await this.secretsService.getValue(name, context);
    return { value };
  }

  /**
   * Update a secret
   * PATCH /api/v1/admin/secrets/:name
   */
  @Patch(":name")
  async update(
    @Param("name", SecretNameValidationPipe) name: string,
    @Body() dto: UpdateSecretDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.logger.debug(`Secret update requested`); // H4: Reduced log level, removed name;
    const context = this.getAuditContext(req);
    return this.secretsService.update(name, dto, context);
  }

  /**
   * Delete a secret
   * DELETE /api/v1/admin/secrets/:name
   */
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // C3 Fix: 20 req/min for delete
  @Delete(":name")
  async delete(
    @Param("name", SecretNameValidationPipe) name: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.logger.debug(`Secret deletion requested`); // H4: Reduced log level, removed name;
    const context = this.getAuditContext(req);
    await this.secretsService.delete(name, context);
    return { message: `Secret '${name}' deleted` };
  }

  /**
   * Get access logs for a secret
   * GET /api/v1/admin/secrets/:name/logs
   */
  @Get(":name/logs")
  async getAccessLogs(
    @Param("name", SecretNameValidationPipe) name: string,
    @Query("limit") limit?: string,
  ) {
    this.logger.debug(`Fetching access logs`); // H4: Reduced log level, removed name;
    return this.secretsService.getAccessLogs(
      name,
      limit ? parseInt(limit) : 50,
    );
  }

  /**
   * Get configurations that reference this secret
   * GET /api/v1/admin/secrets/:name/references
   */
  @Get(":name/references")
  async getReferences(@Param("name", SecretNameValidationPipe) name: string) {
    this.logger.debug(`Fetching secret references`); // H4: Reduced log level, removed name;
    return this.secretsService.getReferences(name);
  }

  /**
   * Migrate existing API keys from database to Secrets table
   * POST /api/v1/admin/secrets/migrate
   */
  @Throttle({ default: { limit: 3, ttl: 3600000 } }) // C3 Fix: 3 req/hour for migration
  @Post("migrate")
  async migrateExistingKeys(@Req() req: AuthenticatedRequest) {
    this.logger.log("Starting migration of existing API keys to Secrets");
    const context = this.getAuditContext(req);
    return this.secretsService.migrateExistingKeys(context);
  }

  /**
   * Extract audit context from request
   */
  private getAuditContext(req: AuthenticatedRequest) {
    return {
      userId: req.user?.userId,
      userEmail: req.user?.email,
      ipAddress: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers["user-agent"],
    };
  }

  // ========== Version Management Endpoints ==========

  /**
   * Get all versions of a secret
   * GET /api/v1/admin/secrets/:name/versions
   */
  @Get(":name/versions")
  async getVersions(@Param("name", SecretNameValidationPipe) name: string) {
    this.logger.debug("Fetching secret versions");
    return this.secretsService.getVersions(name);
  }

  /**
   * Get decrypted value of a specific version
   * GET /api/v1/admin/secrets/:name/versions/:version/value
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Get(":name/versions/:version/value")
  async getVersionValue(
    @Param("name", SecretNameValidationPipe) name: string,
    @Param("version") version: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.logger.debug("Secret version value access requested");
    const context = this.getAuditContext(req);
    const value = await this.secretsService.getVersionValue(
      name,
      parseInt(version),
      context,
    );
    return { value };
  }

  /**
   * Rollback to a previous version
   * POST /api/v1/admin/secrets/:name/rollback/:version
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(":name/rollback/:version")
  async rollback(
    @Param("name", SecretNameValidationPipe) name: string,
    @Param("version") version: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.logger.log(`Secret rollback requested to version ${version}`);
    const context = this.getAuditContext(req);
    return this.secretsService.rollback(name, parseInt(version), context);
  }

  /**
   * Initialize versions for all existing secrets (migration)
   * POST /api/v1/admin/secrets/init-versions
   */
  @Throttle({ default: { limit: 1, ttl: 3600000 } })
  @Post("init-versions")
  async initializeVersions() {
    this.logger.log("Initializing versions for all secrets");
    return this.secretsService.initializeAllVersions();
  }
}
