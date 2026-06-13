import {
  IsString,
  IsOptional,
  IsIn,
  IsNotEmpty,
  MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class AnalyzeContentDto {
  @ApiProperty({ description: "Content to analyze" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  content!: string;

  @ApiPropertyOptional({
    description: "Analysis type",
    enum: [
      "comprehensive",
      "summary",
      "key_findings",
      "quality",
      "structure",
      "sentiment",
    ],
  })
  @IsOptional()
  @IsIn([
    "comprehensive",
    "summary",
    "key_findings",
    "quality",
    "structure",
    "sentiment",
  ])
  analysisType?: string;
}
