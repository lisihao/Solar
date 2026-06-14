/**
 * Public API - Research DTO
 * Deep research request validation
 */

import {
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsIn,
  Min,
  Max,
  MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class StartResearchDto {
  @ApiProperty({ description: "Research query or topic" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  query!: string;

  @ApiPropertyOptional({
    description: "Research depth: quick, standard, deep",
    enum: ["quick", "standard", "deep"],
  })
  @IsOptional()
  @IsIn(["quick", "standard", "deep"])
  depth?: "quick" | "standard" | "deep";

  @ApiPropertyOptional({ description: "Maximum iteration count" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxIterations?: number;

  @ApiPropertyOptional({ description: "Specific dimensions to research" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dimensions?: string[];

  @ApiPropertyOptional({ description: "Language for the report" })
  @IsOptional()
  @IsString()
  language?: string;
}
