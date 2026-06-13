import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsInt,
  IsObject,
  MaxLength,
  Min,
  Max,
} from "class-validator";

export class CreateResearchTemplateDto {
  @ApiProperty({
    description: "Unique template identifier",
    example: "competitive-analysis",
  })
  @IsString()
  @MaxLength(100)
  templateId!: string;

  @ApiProperty({
    description: "Template display name",
    example: "Competitive Analysis",
  })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ description: "Template description" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: "Template category",
    example: "competitive_analysis",
  })
  @IsString()
  @MaxLength(50)
  category!: string;

  @ApiProperty({ description: "Research dimensions configuration (JSON)" })
  @IsObject()
  dimensions!: Record<string, unknown>;

  @ApiPropertyOptional({
    description: "Data source identifiers",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dataSources?: string[];

  @ApiPropertyOptional({ description: "Guidance prompt for research" })
  @IsOptional()
  @IsString()
  guidancePrompt?: string;

  @ApiPropertyOptional({ description: "Report structure configuration (JSON)" })
  @IsOptional()
  @IsObject()
  reportStructure?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: "Number of research iterations",
    default: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  iterationCount?: number;

  @ApiPropertyOptional({
    description: "Whether template is enabled",
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateResearchTemplateDto {
  @ApiPropertyOptional({ description: "Template display name" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: "Template description" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: "Template category" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiPropertyOptional({
    description: "Research dimensions configuration (JSON)",
  })
  @IsOptional()
  @IsObject()
  dimensions?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: "Data source identifiers",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dataSources?: string[];

  @ApiPropertyOptional({ description: "Guidance prompt for research" })
  @IsOptional()
  @IsString()
  guidancePrompt?: string;

  @ApiPropertyOptional({ description: "Report structure configuration (JSON)" })
  @IsOptional()
  @IsObject()
  reportStructure?: Record<string, unknown>;

  @ApiPropertyOptional({ description: "Number of research iterations" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  iterationCount?: number;

  @ApiPropertyOptional({ description: "Whether template is enabled" })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
