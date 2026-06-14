/**
 * AI Provider catalog admin controller
 *
 * 管理 ai_providers 表的 system 级 provider（admin 维护，全局共享）。
 * 用户级 (scope=user) provider 由 byok 模块 user-api-keys.controller 管。
 *
 * 数据驱动 BYOK：admin 这里 +/-/edit provider，前端 catalog tile 自动更新，
 * 无需改代码 / 重启 / 重 deploy。
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
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  Min,
} from "class-validator";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { AiProviderService } from "@/modules/ai-engine/facade";

class UpsertAIProviderDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(50)
  slug!: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(500)
  endpoint!: string;

  @IsString()
  @Matches(/^(openai|anthropic|google|cohere)$/)
  apiFormat!: string;

  @IsString()
  @MaxLength(100)
  testModel!: string;

  @IsArray()
  @IsString({ each: true })
  capabilities!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  iconUrl?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  docUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  freeTierNote?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller("admin/ai-providers")
export class AiProvidersController {
  constructor(private readonly aiProviderService: AiProviderService) {}

  @Get()
  list() {
    return this.aiProviderService.list();
  }

  @Post()
  create(@Body() dto: UpsertAIProviderDto) {
    return this.aiProviderService.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: Partial<UpsertAIProviderDto>) {
    return this.aiProviderService.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.aiProviderService.remove(id);
  }
}
