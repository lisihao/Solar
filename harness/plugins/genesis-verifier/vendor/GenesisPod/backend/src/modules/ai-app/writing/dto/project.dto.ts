import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  Min,
  Max,
  MaxLength,
  IsNotEmpty,
} from "class-validator";
import { WritingProjectStatus, ContentVisibility } from "@prisma/client";

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  genre!: string;

  @IsOptional()
  @IsNumber()
  @Min(10000)
  targetWords?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  writingStyle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  targetAudience?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  pov?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tense?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  maxParallelWriters?: number;

  @IsOptional()
  @IsEnum(ContentVisibility)
  visibility?: ContentVisibility;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  genre?: string;

  @IsOptional()
  @IsNumber()
  @Min(10000)
  targetWords?: number;

  @IsOptional()
  @IsEnum(WritingProjectStatus)
  status?: WritingProjectStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  writingStyle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  targetAudience?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  pov?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tense?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  maxParallelWriters?: number;

  @IsOptional()
  @IsEnum(ContentVisibility)
  visibility?: ContentVisibility;
}
