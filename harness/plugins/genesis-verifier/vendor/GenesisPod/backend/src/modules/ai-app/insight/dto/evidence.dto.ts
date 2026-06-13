import {
  IsOptional,
  IsString,
  IsEnum,
  IsInt,
  Min,
  Max,
  MaxLength,
} from "class-validator";
import { Type } from "class-transformer";
import { SourceType } from "../types";

export class ListEvidenceDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  dimensionId?: string;

  @IsOptional()
  @IsEnum(SourceType)
  sourceType?: SourceType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minCredibility?: number;

  @IsOptional()
  @IsEnum(["citationIndex", "credibilityScore", "publishedAt"])
  sortBy?: "citationIndex" | "credibilityScore" | "publishedAt";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
