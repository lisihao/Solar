import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsEnum,
  Min,
  MaxLength,
  IsNotEmpty,
} from "class-validator";
import { ChapterStatus } from "@prisma/client";

export class CreateChapterDto {
  @IsNumber()
  @Min(1)
  chapterNumber!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  outline?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dependsOn?: string[];
}

export class UpdateChapterDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  outline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  content?: string;

  @IsOptional()
  @IsEnum(ChapterStatus)
  status?: ChapterStatus;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dependsOn?: string[];
}

export class StartWritingDto {
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  additionalInstructions?: string;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  targetWordCount?: number;
}
