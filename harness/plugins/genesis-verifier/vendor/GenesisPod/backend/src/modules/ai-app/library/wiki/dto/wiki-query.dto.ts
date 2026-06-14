import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { WikiLintType } from "@prisma/client";

export class WikiQueryHistoryItemDto {
  @IsEnum(["user", "assistant"])
  role!: "user" | "assistant";

  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  content!: string;
}

export class WikiQueryRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  question!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WikiQueryHistoryItemDto)
  history?: WikiQueryHistoryItemDto[];

  @IsOptional()
  @IsEnum(["inline", "rag", "auto"])
  mode?: "inline" | "rag" | "auto";
}

export class WikiLintFindingsQueryDto {
  @IsOptional()
  @IsEnum(WikiLintType)
  type?: WikiLintType;

  @IsOptional()
  @IsString()
  resolved?: string; // "true" | "false" — parsed in service
}

export class WikiPageSearchQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  q!: string;

  @IsOptional()
  @IsString()
  limit?: string; // parsed to int in service (1–50)
}

export class ToggleWikiEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}
