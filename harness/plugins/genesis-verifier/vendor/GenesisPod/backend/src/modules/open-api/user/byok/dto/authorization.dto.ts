import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AuthRequestType } from "@prisma/client";
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

/**
 * 2026-05-27 BYOK：用户向系统申请授权（工具 / 技能）。
 * 注：LLM Key / 模型授权走既有 key-requests 流，本流主要服务 TOOL_GRANT / SKILL_GRANT。
 */
export class CreateAuthorizationRequestDto {
  @ApiProperty({ enum: AuthRequestType, example: AuthRequestType.TOOL_GRANT })
  @IsEnum(AuthRequestType)
  type!: AuthRequestType;

  @ApiProperty({
    example: "tavily",
    description: "工具 id / 技能 id / secret name",
  })
  @IsString()
  @MaxLength(200)
  targetId!: string;

  @ApiPropertyOptional({
    description: "仅 KEY_ASSIGNMENT 用：申请的 Key 类别（SecretCategory 值）",
    example: "SEARCH",
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiPropertyOptional({ description: "申请理由" })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class ApproveAuthorizationDto {
  @ApiPropertyOptional({ description: "授权到期时间（ISO8601，空=永久）" })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class RejectAuthorizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
