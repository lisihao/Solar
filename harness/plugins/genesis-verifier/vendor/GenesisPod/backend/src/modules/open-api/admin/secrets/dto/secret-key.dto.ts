/**
 * SecretKey DTOs（多 KEY 管理）
 *
 * 与既有 CreateSecretDto/UpdateSecretDto 不同：这里操作的是单个 KEY 行，
 * 不动 Secret 元信息（displayName/category/provider/...）。
 */

import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
  MinLength,
  MaxLength,
  Matches,
} from "class-validator";

const LABEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;

export class AddSecretKeyDto {
  /// 标签：alphanumeric / dash / underscore，1-100 字符
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(LABEL_PATTERN, {
    message: "label must be alphanumeric with - or _",
  })
  label!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  value!: string;

  @IsInt()
  @Min(0)
  @Max(999)
  @IsOptional()
  priority?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateSecretKeyMetaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(LABEL_PATTERN, {
    message: "label must be alphanumeric with - or _",
  })
  @IsOptional()
  label?: string;

  @IsInt()
  @Min(0)
  @Max(999)
  @IsOptional()
  priority?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class ReplaceSecretKeyValueDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  value!: string;
}
