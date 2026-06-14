/**
 * Public API - Writing DTO
 * Writing assistance request validation
 */

import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsIn,
  MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class WritingAssistDto {
  @ApiProperty({ description: "Content to assist with or writing prompt" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  content!: string;

  @ApiPropertyOptional({
    description:
      "Type of assistance: improve, expand, summarize, rewrite, proofread",
    enum: ["improve", "expand", "summarize", "rewrite", "proofread"],
  })
  @IsOptional()
  @IsIn(["improve", "expand", "summarize", "rewrite", "proofread"])
  assistType?: "improve" | "expand" | "summarize" | "rewrite" | "proofread";

  @ApiPropertyOptional({ description: "Target tone or style" })
  @IsOptional()
  @IsString()
  tone?: string;

  @ApiPropertyOptional({ description: "Language for output" })
  @IsOptional()
  @IsString()
  language?: string;
}
