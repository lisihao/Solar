import { IsString, IsOptional, IsEnum, MaxLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { SocialPlatformType } from "../../mission/types";

/**
 * 生成平台版本 DTO
 */
export class GenerateVersionDto {
  @ApiProperty({
    description: "目标平台类型",
    enum: ["WECHAT_MP", "XIAOHONGSHU"],
    example: "WECHAT_MP",
  })
  @IsEnum(SocialPlatformType)
  platformType!: SocialPlatformType;
}

/**
 * 更新版本内容 DTO
 */
export class UpdateVersionDto {
  @ApiPropertyOptional({
    description: "标题",
    example: "文章标题",
  })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    description: "正文内容",
    example: "文章正文内容...",
  })
  @IsString()
  @IsOptional()
  @MaxLength(50000)
  content?: string;

  @ApiPropertyOptional({
    description: "摘要",
    example: "文章摘要...",
  })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  digest?: string;
}

/**
 * 版本响应 DTO
 */
export class ContentVersionResponseDto {
  @ApiProperty({ description: "版本 ID" })
  id!: string;

  @ApiProperty({ description: "内容 ID" })
  contentId!: string;

  @ApiProperty({
    description: "平台类型",
    enum: ["WECHAT_MP", "XIAOHONGSHU"],
  })
  platformType!: SocialPlatformType;

  @ApiProperty({ description: "标题" })
  title!: string;

  @ApiProperty({ description: "正文内容" })
  content!: string;

  @ApiPropertyOptional({ description: "摘要" })
  digest?: string | null;

  @ApiProperty({ description: "是否为默认版本" })
  isDefault!: boolean;

  @ApiPropertyOptional({
    description: "生成方式",
    enum: ["AI", "MANUAL"],
  })
  generatedBy?: string | null;

  @ApiProperty({ description: "创建时间" })
  createdAt!: Date;

  @ApiProperty({ description: "更新时间" })
  updatedAt!: Date;
}

/**
 * 版本列表响应 DTO
 */
export class VersionListResponseDto {
  @ApiProperty({
    description: "版本列表",
    type: [ContentVersionResponseDto],
  })
  versions!: ContentVersionResponseDto[];
}
