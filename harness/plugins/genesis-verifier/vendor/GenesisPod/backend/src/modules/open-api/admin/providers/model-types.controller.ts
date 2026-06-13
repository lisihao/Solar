/**
 * ModelType CRUD admin controller —— 2026-05-11 P3 (BYOK 数据驱动重构)
 *
 * 管理 model_types 表（模型类型字典，含 11 内置 + admin 自定义）。
 * 业务侧仍按 enum AIModelType 路由（兼容期），新增自定义类型走 fallback
 * 通用路径（如 video / 自定义图像编辑器等）。
 *
 * 内置 11 行（isBuiltin=true）UI 显示但不可删除/改 slug；可改其它字段。
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
import { ModelTypeService } from "@/modules/ai-engine/facade";

const CATEGORIES = [
  "text",
  "image",
  "embed",
  "audio",
  "video",
  "other",
] as const;

class UpsertModelTypeDto {
  @IsString()
  @Matches(/^[A-Z0-9_-]+$/)
  @MaxLength(50)
  slug!: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @IsIn(CATEGORIES as unknown as string[])
  category!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  defaultApiFormat?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller("admin/model-types")
export class ModelTypesController {
  constructor(private readonly modelTypeService: ModelTypeService) {}

  @Get()
  list() {
    return this.modelTypeService.list();
  }

  @Post()
  create(@Body() dto: UpsertModelTypeDto) {
    return this.modelTypeService.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: Partial<UpsertModelTypeDto>) {
    return this.modelTypeService.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.modelTypeService.remove(id);
  }
}
