import {
  IsString,
  IsOptional,
  IsArray,
  MaxLength,
  ArrayMaxSize,
} from "class-validator";

export class UpdateContentDto {
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: "标题过长（最大 200 字符）" })
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500000, { message: "内容过长（最大 500000 字符）" })
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: "作者名过长（最大 100 字符）" })
  author?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: "摘要过长（最大 500 字符）" })
  digest?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048, { message: "封面图 URL 过长" })
  coverImageUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(9, { message: "最多 9 张图片" })
  images?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20, { message: "最多 20 个标签" })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: "位置信息过长" })
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  connectionId?: string;
}
