import {
  IsString,
  IsOptional,
  IsInt,
  IsEnum,
  Min,
  Max,
  IsDateString,
} from "class-validator";
import { Type } from "class-transformer";
import { CreditTransactionType as PrismaCreditTransactionType } from "@prisma/client";

const CreditTransactionType = PrismaCreditTransactionType ?? {
  AI_ASK: "AI_ASK",
  ADJUSTMENT: "ADJUSTMENT",
  AI_TEAMS: "AI_TEAMS",
  AI_PLANNING: "AI_PLANNING",
  EXPLORE: "EXPLORE",
  AI_OFFICE: "AI_OFFICE",
  AI_SIMULATION: "AI_SIMULATION",
  AI_WRITING: "AI_WRITING",
  AI_IMAGE: "AI_IMAGE",
  AI_SOCIAL: "AI_SOCIAL",
  AI_RESEARCH: "AI_RESEARCH",
  AI_INSIGHTS: "AI_INSIGHTS",
  NOTEBOOK_RESEARCH: "NOTEBOOK_RESEARCH",
  LIBRARY: "LIBRARY",
  NOTES: "NOTES",
  COLLECTIONS: "COLLECTIONS",
  ADMIN_GRANT: "ADMIN_GRANT",
  DONATION_REWARD: "DONATION_REWARD",
  DONATION_USAGE_REWARD: "DONATION_USAGE_REWARD",
  DAILY_CHECKIN: "DAILY_CHECKIN",
  INITIAL: "INITIAL",
  REFUND: "REFUND",
  TASK_REWARD: "TASK_REWARD",
};

/**
 * 交易记录查询 DTO
 */
export class TransactionQueryDto {
  @IsOptional()
  @IsEnum(CreditTransactionType)
  type?: PrismaCreditTransactionType;

  @IsOptional()
  @IsString()
  moduleType?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
