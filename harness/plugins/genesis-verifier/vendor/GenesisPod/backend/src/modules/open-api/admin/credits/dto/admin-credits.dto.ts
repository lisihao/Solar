import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
} from "class-validator";

/**
 * 冻结账户 DTO
 */
export class FreezeAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(36)
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

/**
 * 解冻账户 DTO
 */
export class UnfreezeAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(36)
  userId!: string;
}

/**
 * 更新积分规则 DTO
 */
export class UpdateCreditRuleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  moduleType!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  operationType!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  baseCredits?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tokenMultiplier?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
