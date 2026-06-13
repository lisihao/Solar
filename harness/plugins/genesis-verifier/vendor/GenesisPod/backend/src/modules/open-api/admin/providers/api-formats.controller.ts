/**
 * ApiFormat CRUD admin controller —— 2026-05-11 P3 (BYOK 数据驱动重构)
 *
 * 管理 api_formats 表（API 协议模板，含 4 内置 + admin 自定义）。
 * 自定义 ApiFormat 当前只支持 OpenAI-兼容微调（覆盖 95% 新接入 provider）：
 *   - authStyle: bearer / x-api-key / x-goog-api-key / custom
 *   - custom 时填 customHeaderName + customHeaderPrefix
 *   - body schema 锁死 OpenAI 兼容（{model, messages|input}）
 *
 * 内置 4 行（isBuiltin=true）UI 显示但不可删除；可改 isEnabled/displayOrder。
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  Min,
  IsIn,
} from "class-validator";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { ApiFormatService } from "@/modules/ai-engine/facade";

const AUTH_STYLES = [
  "bearer",
  "x-api-key",
  "x-goog-api-key",
  "custom",
] as const;

class UpsertApiFormatDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(50)
  slug!: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsIn(AUTH_STYLES as unknown as string[])
  authStyle!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customHeaderName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  customHeaderPrefix?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller("admin/api-formats")
export class ApiFormatsController {
  constructor(private readonly apiFormatService: ApiFormatService) {}

  @Get()
  list() {
    return this.apiFormatService.list();
  }

  @Post()
  create(@Body() dto: UpsertApiFormatDto) {
    return this.apiFormatService.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: Partial<UpsertApiFormatDto>) {
    return this.apiFormatService.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.apiFormatService.remove(id);
  }
}
