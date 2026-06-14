import { ApiProperty } from "@nestjs/swagger";

/**
 * 资源响应 DTO
 */
export class ResourceResponseDto {
  @ApiProperty({ description: "资源ID" })
  id!: string;

  @ApiProperty({ description: "资源标题" })
  title!: string;

  @ApiProperty({
    description: "资源类型",
    enum: ["PAPER", "BLOG", "REPORT", "NEWS", "YOUTUBE_VIDEO", "POLICY"],
  })
  type!: string;

  @ApiProperty({ description: "摘要", required: false })
  abstract?: string;

  @ApiProperty({ description: "内容", required: false })
  content?: string;

  @ApiProperty({ description: "来源URL" })
  sourceUrl!: string;

  @ApiProperty({ description: "PDF URL", required: false })
  pdfUrl?: string;

  @ApiProperty({ description: "缩略图URL", required: false })
  thumbnailUrl?: string;

  @ApiProperty({ description: "作者列表", type: [String], required: false })
  authors?: string[];

  @ApiProperty({ description: "发布时间", required: false })
  publishedAt?: Date;

  @ApiProperty({ description: "主要分类", required: false })
  primaryCategory?: string;

  @ApiProperty({ description: "自动标签", type: [String], required: false })
  autoTags?: string[];

  @ApiProperty({ description: "难度等级", required: false })
  difficultyLevel?: string;

  @ApiProperty({ description: "质量分数", required: false })
  qualityScore?: number;

  @ApiProperty({ description: "趋势分数", required: false })
  trendingScore?: number;

  @ApiProperty({ description: "点赞数", required: false })
  upvoteCount?: number;

  @ApiProperty({ description: "AI摘要", required: false })
  aiSummary?: string;

  @ApiProperty({ description: "关键洞察", type: [String], required: false })
  keyInsights?: string[];

  @ApiProperty({ description: "创建时间" })
  createdAt!: Date;

  @ApiProperty({ description: "更新时间" })
  updatedAt!: Date;
}

/**
 * 资源列表响应 DTO
 */
export class ResourceListResponseDto {
  @ApiProperty({ description: "资源列表", type: [ResourceResponseDto] })
  items!: ResourceResponseDto[];

  @ApiProperty({ description: "总数" })
  total!: number;

  @ApiProperty({ description: "跳过数量" })
  skip!: number;

  @ApiProperty({ description: "获取数量" })
  take!: number;
}

/**
 * 资源统计 DTO
 */
export class ResourceStatsDto {
  @ApiProperty({ description: "总资源数" })
  total!: number;

  @ApiProperty({
    description: "按类型统计",
    type: "object",
    additionalProperties: { type: "number" },
  })
  byType!: Record<string, number>;

  @ApiProperty({
    description: "按分类统计",
    type: "object",
    additionalProperties: { type: "number" },
  })
  byCategory!: Record<string, number>;
}
