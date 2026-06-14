import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsInt,
  Min,
  Max,
  IsEnum,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";

/**
 * Google Drive OAuth 连接请求
 */
export class ConnectGoogleDriveDto {
  @ApiProperty({ description: "Google OAuth 授权码" })
  @IsString()
  code!: string;

  @ApiPropertyOptional({ description: "前端回调 URL" })
  @IsOptional()
  @IsString()
  redirectUri?: string;
}

/**
 * 列出文件查询参数
 */
export class ListFilesDto {
  @ApiPropertyOptional({ description: "文件夹 ID（不提供则列出根目录）" })
  @IsOptional()
  @IsString()
  folderId?: string;

  @ApiPropertyOptional({
    description: "父文件夹 ID（folderId 的别名，兼容前端）",
  })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({ description: "分页 Token" })
  @IsOptional()
  @IsString()
  pageToken?: string;

  @ApiPropertyOptional({ description: "每页数量", default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ description: "每页数量（pageSize 的别名，兼容前端）" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: "搜索查询（Google Drive 查询语法）" })
  @IsOptional()
  @IsString()
  query?: string;

  @ApiPropertyOptional({ description: "搜索关键字（兼容前端）" })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: "排序字段",
    default: "modifiedTime desc",
  })
  @IsOptional()
  @IsString()
  orderBy?: string;

  @ApiPropertyOptional({ description: "排序字段（兼容前端）" })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ description: "排序方向（兼容前端）" })
  @IsOptional()
  @IsString()
  sortOrder?: string;
}

/**
 * 导入文件到 Library
 */
export class ImportFilesDto {
  @ApiProperty({ description: "文件 ID 列表" })
  @IsArray()
  @IsString({ each: true })
  fileIds!: string[];

  @ApiPropertyOptional({ description: "导入到指定的资源集合 ID" })
  @IsOptional()
  @IsString()
  collectionId?: string;

  @ApiPropertyOptional({ description: "是否提取文本内容", default: true })
  @IsOptional()
  @IsBoolean()
  extractContent?: boolean;

  @ApiPropertyOptional({ description: "是否生成摘要", default: false })
  @IsOptional()
  @IsBoolean()
  generateSummary?: boolean;

  @ApiPropertyOptional({ description: "导入后的标签" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

/**
 * 导出格式
 */
export enum ExportFormat {
  ORIGINAL = "original", // 保持原格式
  PDF = "pdf",
  DOCX = "docx",
  MARKDOWN = "markdown",
  HTML = "html",
  TXT = "txt",
}

/**
 * 导出资源到 Google Drive
 */
export class ExportResourcesDto {
  @ApiProperty({ description: "资源 ID 列表" })
  @IsArray()
  @IsString({ each: true })
  resourceIds!: string[];

  @ApiPropertyOptional({ description: "目标文件夹 ID（不提供则导出到根目录）" })
  @IsOptional()
  @IsString()
  folderId?: string;

  @ApiPropertyOptional({
    description: "导出格式",
    enum: ExportFormat,
    default: ExportFormat.ORIGINAL,
  })
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat;

  @ApiPropertyOptional({ description: "是否创建文件夹组织", default: false })
  @IsOptional()
  @IsBoolean()
  createFolders?: boolean;

  @ApiPropertyOptional({ description: "文件名前缀" })
  @IsOptional()
  @IsString()
  fileNamePrefix?: string;
}

/**
 * 同步配置 DTO
 */
export class SyncConfigDto {
  @ApiPropertyOptional({ description: "启用自动同步", default: false })
  @IsOptional()
  @IsBoolean()
  autoSync?: boolean;

  @ApiPropertyOptional({ description: "同步间隔（分钟）", default: 60 })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(1440)
  syncInterval?: number;

  @ApiPropertyOptional({ description: "监听的文件夹 ID 列表" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  watchedFolders?: string[];
}

/**
 * 更新连接配置
 */
export class UpdateConnectionDto {
  @ApiPropertyOptional({ description: "同步配置" })
  @IsOptional()
  syncConfig?: SyncConfigDto;
}

/**
 * 触发同步请求
 */
export class TriggerSyncDto {
  @ApiPropertyOptional({
    description: "文件夹 ID（不提供则同步所有监听的文件夹）",
  })
  @IsOptional()
  @IsString()
  folderId?: string;

  @ApiPropertyOptional({ description: "强制全量同步", default: false })
  @IsOptional()
  @IsBoolean()
  fullSync?: boolean;
}
