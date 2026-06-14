import {
  IsString,
  IsOptional,
  IsEnum,
  MaxLength,
  IsNotEmpty,
} from "class-validator";

export enum PlanningDepth {
  QUICK = "quick",
  STANDARD = "standard",
  COMPREHENSIVE = "comprehensive",
}

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  goal!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  templateId?: string;

  @IsOptional()
  @IsEnum(PlanningDepth)
  depth?: PlanningDepth;
}
