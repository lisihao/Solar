import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import type { EstimatedUsage } from "@/modules/platform/credentials/governance/key-requests/key-requests.service";

/**
 * 2026-05-08：用户申请时不再选 provider（admin 未必有该 provider 可用模型，
 * 强制选 provider 会把申请卡死）。所有字段都 optional，admin 审批时根据
 * 当前可用 AIModel 自由决定授权。
 */
export class CreateKeyRequestDto {
  @ApiPropertyOptional({ description: "Why the user needs this key" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason?: string;

  @ApiPropertyOptional({
    description: "Estimated monthly usage",
    enum: ["LIGHT", "MEDIUM", "HEAVY"],
  })
  @IsOptional()
  @IsIn(["LIGHT", "MEDIUM", "HEAVY"])
  estimatedUsage?: EstimatedUsage;

  @ApiPropertyOptional({ description: "Additional note" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
