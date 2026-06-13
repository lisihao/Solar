import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class ApproveKeyRequestDto {
  @ApiProperty({
    description:
      "AIModel.id to grant access to (2026-05-08 v5: 不再选密钥池，直接选具体模型)",
  })
  @IsString()
  @MinLength(1)
  modelDbId!: string;

  @ApiPropertyOptional({
    description: "User-level quota in cents (null = unlimited)",
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  userQuotaCents?: number | null;

  @ApiPropertyOptional({ description: "Assignment expiration ISO-8601" })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ description: "Internal note" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RejectKeyRequestDto {
  @ApiProperty({ description: "Reason (shown to user)" })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}
