/**
 * SecretKeysController — Admin 多 KEY 管理 endpoint（P1）
 *
 * Path: /admin/secrets/:secretId/keys
 *  - 与 SecretsController (/admin/secrets/:name) 路径风格相同（admin 前缀 + JwtAuthGuard + AdminGuard）
 *  - 所有 endpoint 都不返回明文 value（仅 keyHint），明文只能通过现有
 *    /admin/secrets/:name/value endpoint 走（已限流 10/min）
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  Logger,
} from "@nestjs/common";
import { Request } from "express";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { SecretKeysService } from "@/modules/platform/credentials/storage/secrets/secret-keys.service";
import {
  AddSecretKeyDto,
  UpdateSecretKeyMetaDto,
  ReplaceSecretKeyValueDto,
} from "./dto/secret-key.dto";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { AdminGuard } from "@/common/guards/admin.guard";

interface AuthenticatedRequest extends Request {
  user?: { userId: string; email: string };
}

@ApiTags("Admin - Secret Keys")
@Controller("admin/secrets/:secretId/keys")
@UseGuards(JwtAuthGuard, AdminGuard)
export class SecretKeysController {
  private readonly logger = new Logger(SecretKeysController.name);

  constructor(private readonly service: SecretKeysService) {}

  @Get()
  async list(@Param("secretId") secretId: string) {
    return this.service.listKeys(secretId);
  }

  @Throttle({ default: { limit: 30, ttl: 3600000 } })
  @Post()
  async add(
    @Param("secretId") secretId: string,
    @Body() dto: AddSecretKeyDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.logger.log(`SecretKey add request secretId=${secretId}`);
    return this.service.addKey(secretId, dto, this.context(req));
  }

  @Patch(":keyId")
  async updateMeta(
    @Param("secretId") _secretId: string,
    @Param("keyId") keyId: string,
    @Body() dto: UpdateSecretKeyMetaDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.updateKeyMeta(keyId, dto, this.context(req));
  }

  @Throttle({ default: { limit: 30, ttl: 3600000 } })
  @Put(":keyId/value")
  async replaceValue(
    @Param("secretId") _secretId: string,
    @Param("keyId") keyId: string,
    @Body() dto: ReplaceSecretKeyValueDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.replaceKeyValue(keyId, dto, this.context(req));
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Delete(":keyId")
  async delete(
    @Param("secretId") _secretId: string,
    @Param("keyId") keyId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.service.deleteKey(keyId, this.context(req));
    return { ok: true };
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post(":keyId/test")
  async test(
    @Param("secretId") _secretId: string,
    @Param("keyId") keyId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.testKey(keyId, this.context(req));
  }

  private context(req: AuthenticatedRequest) {
    return {
      userId: req.user?.userId,
      userEmail: req.user?.email,
      ipAddress: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers["user-agent"],
    };
  }
}
