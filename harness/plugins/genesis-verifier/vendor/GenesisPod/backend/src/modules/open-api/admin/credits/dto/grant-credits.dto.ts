import {
  IsString,
  IsInt,
  IsOptional,
  Min,
  Max,
  IsEnum,
  MaxLength,
} from "class-validator";
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
 * 管理员发放积分 DTO
 */
export class AdminGrantCreditsDto {
  @IsString()
  userId!: string;

  @IsInt()
  @Min(1)
  @Max(2_000_000_000, {
    message: "Single grant amount cannot exceed 2,000,000,000 (INT4 limit)",
  })
  amount!: number;

  @IsOptional()
  @IsEnum(CreditTransactionType)
  type?: PrismaCreditTransactionType = CreditTransactionType.ADMIN_GRANT;

  @IsString()
  @MaxLength(500)
  description!: string;
}

/**
 * 批量发放积分 DTO
 */
export class BatchGrantCreditsDto {
  @IsString({ each: true })
  userIds!: string[];

  @IsInt()
  @Min(1)
  @Max(2_000_000_000, {
    message: "Single grant amount cannot exceed 2,000,000,000 (INT4 limit)",
  })
  amount!: number;

  @IsString()
  @MaxLength(500)
  description!: string;
}
