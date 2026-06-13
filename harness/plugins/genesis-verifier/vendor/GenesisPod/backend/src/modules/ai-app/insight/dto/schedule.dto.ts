import {
  IsEnum,
  IsOptional,
  IsInt,
  IsBoolean,
  Min,
  Max,
} from "class-validator";
import { RefreshFrequency } from "../types";

export class UpdateScheduleDto {
  @IsEnum(RefreshFrequency)
  frequency!: RefreshFrequency;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  hourOfDay?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
