/**
 * RunSocialMissionDto — POST /ai-social/mission/run 入参
 *
 * 触发 SocialPublishMission（W4 Agent Team 新轨）。Controller 接到请求后
 * fire-and-forget 启动 mission，立即返回 missionId 让前端订阅 WebSocket
 * social.mission:* 事件流跟踪进度。
 */

import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";

export class RunSocialMissionDto {
  /** Social content row id（library / drafts 表的 row id；UUID v4） */
  @IsUUID("4")
  contentId!: string;

  /** 目标平台列表，至少 1 个，如 ["WECHAT_MP", "XIAOHONGSHU"] */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  platforms!: string[];

  /** 平台 → connectionId 映射（已连接账户） */
  @IsObject()
  connectionIds!: Record<string, string>;

  /** 内容质量档位 */
  @IsEnum(["quick", "standard", "deep"])
  depth!: "quick" | "standard" | "deep";

  /** 预算档位（缺省 standard） */
  @IsOptional()
  @IsEnum(["lean", "standard", "rich"])
  budgetProfile?: "lean" | "standard" | "rich";

  /** 主语言（缺省 zh-CN） */
  @IsOptional()
  @IsEnum(["zh-CN", "en-US"])
  language?: "zh-CN" | "en-US";
}
