import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  MaxLength,
  Min,
  Max,
} from "class-validator";
import { Transform } from "class-transformer";

export class AddDimensionDto {
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  searchQueries?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  searchSources?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  minSources?: number;
}

export class UpdateDimensionDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  searchQueries?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  searchSources?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  sortOrder?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  minSources?: number;
}

export class ReorderDimensionsDto {
  @IsArray()
  @IsString({ each: true })
  dimensionIds!: string[];
}
