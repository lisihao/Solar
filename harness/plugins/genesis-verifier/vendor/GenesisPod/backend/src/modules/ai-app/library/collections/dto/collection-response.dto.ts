import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * 收藏夹项响应 DTO
 */
export class CollectionItemResponseDto {
  @ApiProperty({ description: "项ID" })
  id!: string;

  @ApiProperty({ description: "资源ID" })
  resourceId!: string;

  @ApiPropertyOptional({ description: "备注" })
  note?: string;

  @ApiProperty({ description: "位置顺序" })
  position!: number;

  @ApiProperty({
    description: "阅读状态",
    enum: ["UNREAD", "READING", "COMPLETED", "ARCHIVED"],
  })
  readStatus!: string;

  @ApiProperty({ description: "阅读进度 (0-100)" })
  readProgress!: number;

  @ApiPropertyOptional({ description: "最后阅读时间" })
  lastReadAt?: Date;

  @ApiProperty({ description: "创建时间" })
  createdAt!: Date;

  @ApiProperty({ description: "更新时间" })
  updatedAt!: Date;
}

/**
 * 收藏夹响应 DTO
 */
export class CollectionResponseDto {
  @ApiProperty({ description: "收藏夹ID" })
  id!: string;

  @ApiProperty({ description: "用户ID" })
  userId!: string;

  @ApiProperty({ description: "收藏夹名称" })
  name!: string;

  @ApiPropertyOptional({ description: "收藏夹描述" })
  description?: string;

  @ApiPropertyOptional({ description: "图标 (Emoji)" })
  icon?: string;

  @ApiPropertyOptional({ description: "颜色 (Hex)" })
  color?: string;

  @ApiProperty({ description: "是否公开" })
  isPublic!: boolean;

  @ApiProperty({ description: "排序顺序" })
  sortOrder!: number;

  @ApiProperty({ description: "创建时间" })
  createdAt!: Date;

  @ApiProperty({ description: "更新时间" })
  updatedAt!: Date;

  @ApiPropertyOptional({
    description: "收藏夹项列表",
    type: [CollectionItemResponseDto],
  })
  items?: CollectionItemResponseDto[];
}

/**
 * 收藏夹列表响应 DTO
 */
export class CollectionListResponseDto {
  @ApiProperty({ description: "收藏夹列表", type: [CollectionResponseDto] })
  items!: CollectionResponseDto[];

  @ApiProperty({ description: "总数" })
  total!: number;

  @ApiProperty({ description: "跳过数量" })
  skip!: number;

  @ApiProperty({ description: "获取数量" })
  take!: number;
}

/**
 * 收藏夹统计 DTO
 */
export class CollectionStatsDto {
  @ApiProperty({ description: "收藏夹总数" })
  totalCollections!: number;

  @ApiProperty({ description: "资源总数" })
  totalItems!: number;

  @ApiProperty({ description: "公开收藏夹数量" })
  publicCollections!: number;

  @ApiProperty({ description: "私有收藏夹数量" })
  privateCollections!: number;

  @ApiProperty({
    description: "按阅读状态统计",
    type: "object",
    additionalProperties: { type: "number" },
  })
  byReadStatus!: Record<string, number>;
}
