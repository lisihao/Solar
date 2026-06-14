/**
 * UpdateConsolidationConfigDto — class-validator schema for PATCH /admin/dreaming/config
 *
 * 2026-05-15 Round 2 安全评审 Medium 修复：
 *   原 `@Body() updates: Partial<ConsolidationSchedulerConfig>` 是裸 interface，
 *   攻击者可传 `sampleSize: -1` / `tokenBudget: 999999999` / 7 字段 `cronExpression`
 *   → 直接 spread 进 scheduler config，PR-I.2 cron 调度器接通后会被滥用。
 *   本 DTO 给所有字段加 class-validator 边界，配合 controller @UsePipes(ValidationPipe)。
 *
 * 边界来源：
 *   - sampleSize: 1-100（再多 LLM context 撑爆，再少不足以归纳模式）
 *   - sampleWindowHours: 1-168（1h 到 7d）
 *   - tokenBudget: 1000-500000（再少跑不完一次反思，再多单轮预算炸）
 *   - cronExpression: 仅允许 cron 合法字符 [0-9 * / - ,]
 */

import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from "class-validator";

export class UpdateConsolidationConfigDto {
  @ApiPropertyOptional({
    description: "Cron expression (e.g. '0 */6 * * *')",
    example: "0 */6 * * *",
  })
  @IsOptional()
  @IsString()
  @Matches(/^[\d\s*/\-,]+$/, {
    message: "cronExpression must only contain digits, spaces and * / - ,",
  })
  cronExpression?: string;

  @ApiPropertyOptional({
    description: "Sample window in hours (1-168)",
    minimum: 1,
    maximum: 168,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  sampleWindowHours?: number;

  @ApiPropertyOptional({
    description: "Max mission samples per reflection run (1-100)",
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  sampleSize?: number;

  @ApiPropertyOptional({
    description: "Per-run LLM token budget (1000-500000)",
    minimum: 1000,
    maximum: 500_000,
  })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(500_000)
  tokenBudget?: number;

  @ApiPropertyOptional({ description: "Enable or disable the scheduler" })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
