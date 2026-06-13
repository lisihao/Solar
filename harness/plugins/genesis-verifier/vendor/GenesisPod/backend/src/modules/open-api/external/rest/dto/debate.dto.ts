/**
 * Public API - Debate DTO
 * Team debate request validation
 */

import {
  IsString,
  IsOptional,
  IsInt,
  IsNotEmpty,
  Min,
  Max,
  MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class StartDebateDto {
  @ApiProperty({ description: "Debate topic" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  topic!: string;

  @ApiPropertyOptional({ description: "Number of debate rounds" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rounds?: number;

  @ApiPropertyOptional({ description: "Team template name to use" })
  @IsOptional()
  @IsString()
  templateName?: string;

  @ApiPropertyOptional({ description: "Language for the debate" })
  @IsOptional()
  @IsString()
  language?: string;
}
