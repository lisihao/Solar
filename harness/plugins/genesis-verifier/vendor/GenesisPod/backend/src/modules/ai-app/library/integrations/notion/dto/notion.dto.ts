import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";

/**
 * Notion OAuth 连接请求
 */
export class ConnectNotionDto {
  @ApiProperty({ description: "Notion OAuth 授权码" })
  @IsString()
  code!: string;

  @ApiPropertyOptional({ description: "前端回调 URL" })
  @IsOptional()
  @IsString()
  redirectUri?: string;
}

/**
 * 同步配置 DTO
 */
export class SyncConfigDto {
  @ApiPropertyOptional({ description: "启用自动同步", default: true })
  @IsOptional()
  @IsBoolean()
  autoSync?: boolean;

  @ApiPropertyOptional({ description: "同步间隔（分钟）", default: 60 })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(1440)
  syncInterval?: number;

  @ApiPropertyOptional({ description: "启动时同步", default: true })
  @IsOptional()
  @IsBoolean()
  syncOnStartup?: boolean;

  @ApiPropertyOptional({ description: "同步普通页面", default: true })
  @IsOptional()
  @IsBoolean()
  syncPages?: boolean;

  @ApiPropertyOptional({ description: "同步数据库", default: true })
  @IsOptional()
  @IsBoolean()
  syncDatabases?: boolean;

  @ApiPropertyOptional({ description: "每次同步最大页数", default: 500 })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(1000)
  maxPagesPerSync?: number;
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
  @ApiPropertyOptional({ description: "连接 ID（不提供则同步所有连接）" })
  @IsOptional()
  @IsString()
  connectionId?: string;

  @ApiPropertyOptional({ description: "强制全量同步", default: false })
  @IsOptional()
  @IsBoolean()
  fullSync?: boolean;
}

/**
 * 页面列表查询
 */
export class ListPagesDto {
  @ApiPropertyOptional({ description: "连接 ID" })
  @IsOptional()
  @IsString()
  connectionId?: string;

  @ApiPropertyOptional({ description: "搜索关键词" })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: "页码", default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: "每页数量", default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/**
 * 链接资源请求
 */
export class LinkResourceDto {
  @ApiProperty({ description: "Library 资源 ID" })
  @IsString()
  resourceId!: string;
}
