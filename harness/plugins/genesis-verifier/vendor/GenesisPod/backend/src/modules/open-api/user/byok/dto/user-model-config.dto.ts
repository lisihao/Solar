import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AIModelType } from "@prisma/client";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

const API_FORMATS = ["openai", "anthropic", "google", "xai", "cohere"] as const;
const TOKEN_PARAM_NAMES = ["max_tokens", "max_completion_tokens"] as const;

export class CreateUserModelConfigDto {
  @ApiProperty({ example: "openai" })
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(50)
  @Transform(({ value }) =>
    typeof value === "string" ? value.toLowerCase().trim() : value,
  )
  provider!: string;

  @ApiProperty({ example: "gpt-4o-mini" })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  modelId!: string;

  @ApiProperty({ example: "My GPT-4o mini" })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName!: string;

  @ApiProperty({ enum: AIModelType })
  @IsEnum(AIModelType)
  modelType!: AIModelType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiEndpoint?: string;

  @ApiPropertyOptional({
    description: "2026-05-27 BYOK：运行时用哪把用户 Key（UserApiKey.id）",
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  apiKeyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  maxTokens?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  @Type(() => Number)
  temperature?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  embeddingDimensions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  maxInputTokens?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isReasoning?: boolean;

  @ApiPropertyOptional({ enum: API_FORMATS })
  @IsOptional()
  @IsString()
  @IsIn(API_FORMATS as unknown as string[])
  apiFormat?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  supportsTemperature?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  supportsStreaming?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  supportsFunctionCalling?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  supportsVision?: boolean;

  @ApiPropertyOptional({ enum: TOKEN_PARAM_NAMES })
  @IsOptional()
  @IsString()
  @IsIn(TOKEN_PARAM_NAMES as unknown as string[])
  tokenParamName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Type(() => Number)
  defaultTimeoutMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  priceInputPerMillion?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  priceOutputPerMillion?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  priority?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: "每分钟请求数上限 (RPM)" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  rpmLimit?: number;

  @ApiPropertyOptional({ description: "每分钟 token 上限 (TPM)" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  tpmLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateUserModelConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  modelId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName?: string;

  @ApiPropertyOptional({ enum: AIModelType })
  @IsOptional()
  @IsEnum(AIModelType)
  modelType?: AIModelType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiEndpoint?: string;

  @ApiPropertyOptional({
    description: "2026-05-27 BYOK：运行时用哪把用户 Key（UserApiKey.id）",
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  apiKeyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  maxTokens?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  @Type(() => Number)
  temperature?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  embeddingDimensions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  maxInputTokens?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isReasoning?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  apiFormat?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  supportsTemperature?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  supportsStreaming?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  supportsFunctionCalling?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  supportsVision?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  tokenParamName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Type(() => Number)
  defaultTimeoutMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  priceInputPerMillion?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  priceOutputPerMillion?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  priority?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: "每分钟请求数上限 (RPM)" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  rpmLimit?: number;

  @ApiPropertyOptional({ description: "每分钟 token 上限 (TPM)" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  tpmLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
