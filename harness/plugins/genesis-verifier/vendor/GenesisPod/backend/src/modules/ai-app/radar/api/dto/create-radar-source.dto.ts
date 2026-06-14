import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * 读侧 enum（list / query / 旧数据兼容）— 含 X 是因为存量数据 + admin
 * 历史手动加的 X source 仍要能渲染 / 暂停 / 删除。
 */
export enum RadarSourceTypeDto {
  X = "X",
  YOUTUBE = "YOUTUBE",
  RSS = "RSS",
  CUSTOM = "CUSTOM",
}

/**
 * 写侧 enum（POST /sources, POST /sources/recommend/accept）— **禁 X**。
 *
 * 2026-05-17 业务策略：Nitter 全死 + 业界（Feedly/Inoreader）已淡化 X
 * 集成，AI 推荐 + admin 手动新加都禁 X，避免新增 dead source 噪音。
 * 旧 X 源仍可读 / 暂停 / 删除，但任何创建路径都拦在 DTO 校验层。
 */
export enum CreatableRadarSourceTypeDto {
  YOUTUBE = "YOUTUBE",
  RSS = "RSS",
  CUSTOM = "CUSTOM",
}

/**
 * 数据源 config（类型特定，自由 JSON，service 内做类型分发校验）：
 *
 * - YOUTUBE : `{ fetchTranscript?: boolean, region?: string }`
 * - RSS     : 无额外配置（identifier 即 URL）
 * - CUSTOM  : `{ listSelector: string, titleSelector?: string, linkSelector?: string, dateSelector?: string }`
 */
export class CreateRadarSourceDto {
  @IsEnum(CreatableRadarSourceTypeDto)
  type!: CreatableRadarSourceTypeDto;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  identifier!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
