import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { SecretCategory } from "@prisma/client";
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * Platform-layer input DTOs for user-owned secret operations.
 * These live at L1 (platform) so the service can reference them directly
 * without crossing the L4 (open-api) boundary.
 */

export class CreateUserSecretDto {
  @ApiProperty({ example: "tavily-search-api-key" })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: "Tavily 搜索 Key" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @ApiProperty({ enum: SecretCategory, example: SecretCategory.SEARCH })
  @IsEnum(SecretCategory)
  category!: SecretCategory;

  @ApiPropertyOptional({ example: "tavily" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  provider?: string;

  @ApiPropertyOptional({
    description: "明文密钥值（与 sourceSecretId 二选一）",
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  value?: string;

  @ApiPropertyOptional({
    description:
      "从已保存密钥复制（与 value 二选一）：传入另一条 user_credential 的 id，后端解密其值后作为本条密钥值写入",
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sourceSecretId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateUserSecretDto {
  @ApiPropertyOptional({ description: "新明文密钥值（留空表示不改值）" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  value?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
