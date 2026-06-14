import {
  IsOptional,
  IsEnum,
  IsArray,
  IsString,
  IsBoolean,
  IsEmail,
  MaxLength,
  IsIn,
  IsNotEmpty,
} from "class-validator";
import { RefreshType, RefreshPriority } from "../types";

export class TriggerRefreshDto {
  @IsOptional()
  @IsEnum(RefreshType)
  type?: RefreshType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dimensionIds?: string[];

  @IsOptional()
  @IsEnum(RefreshPriority)
  priority?: RefreshPriority;

  @IsOptional()
  @IsBoolean()
  notify?: boolean;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  notificationEmail?: string;

  @IsOptional()
  @IsString()
  @IsIn(["quick", "standard", "thorough"])
  @MaxLength(50)
  researchDepth?: string;
}

export class CancelRefreshDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  jobId!: string;
}

export class RefreshDimensionDto {
  @IsOptional()
  @IsEnum(RefreshPriority)
  priority?: RefreshPriority;

  @IsOptional()
  @IsBoolean()
  regenerate?: boolean;
}
