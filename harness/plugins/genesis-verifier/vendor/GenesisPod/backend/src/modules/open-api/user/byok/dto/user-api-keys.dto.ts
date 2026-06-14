import {
  IsString,
  IsOptional,
  IsEnum,
  MaxLength,
  MinLength,
  Matches,
} from "class-validator";

// 2026-05-28 H6: 捐赠池退役 —— 仅保留 PERSONAL。
export enum ApiKeyMode {
  PERSONAL = "personal",
}

export class SaveUserApiKeyDto {
  @IsString()
  @MinLength(1, { message: "API Key cannot be empty" })
  @MaxLength(500)
  apiKey!: string;

  @IsEnum(ApiKeyMode)
  mode!: ApiKeyMode;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  preferredModelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiEndpoint?: string;

  /**
   * PR-2 (2026-05-05): 多 key 标签。同一 user + provider 可有多条，用 label
   * 区分（"default" / "personal-org-a" / "backup"）。省略时默认 "default"。
   */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: "label must be lowercase + dash only" })
  @MaxLength(50)
  label?: string;
}

export class TestApiKeyDto {
  @IsString()
  @MinLength(1, { message: "API Key cannot be empty" })
  @MaxLength(500)
  apiKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiEndpoint?: string;
}
