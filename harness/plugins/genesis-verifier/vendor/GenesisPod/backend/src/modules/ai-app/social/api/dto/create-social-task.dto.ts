import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class SourceRefDto {
  @IsString()
  @IsNotEmpty()
  sourceType!: string;

  @IsString()
  @IsNotEmpty()
  sourceId!: string;
}

export class CreateSocialTaskDto {
  @ValidateNested({ each: true })
  @Type(() => SourceRefDto)
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(20)
  sources!: SourceRefDto[];

  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  @ArrayMaxSize(3)
  externalUrls?: string[];

  /**
   * 任务名称 — 前端 NewTaskDialog 选完源后自动派生（取首个源 title +
   * 其余项数），用户可在 dialog 里覆盖。展示在 TasksTab 表格内容列。
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  prompt?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @IsIn(["WECHAT_MP", "XIAOHONGSHU"], { each: true })
  platforms!: string[];

  @IsObject()
  accountIds!: Record<string, string>;

  @IsOptional()
  @IsIn(["quick", "standard", "deep"])
  depth?: "quick" | "standard" | "deep";
}

/** 重命名任务（卡片「编辑」按钮）*/
export class RenameSocialTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;
}
