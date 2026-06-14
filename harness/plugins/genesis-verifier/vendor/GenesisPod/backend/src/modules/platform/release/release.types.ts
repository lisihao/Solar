/**
 * Release 发布通知模块内部类型
 *
 * 定义发布说明、Git 变更信息和通知相关的数据结构
 */

import { IsString, IsOptional, IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";

/**
 * Git 提交信息
 */
export interface GitCommit {
  /** 提交 hash */
  hash: string;
  /** 提交类型 (feat, fix, refactor, etc.) */
  type: string;
  /** 影响范围 (module name) */
  scope?: string;
  /** 提交描述 */
  message: string;
  /** 作者 */
  author: string;
  /** 提交日期 */
  date: string;
}

/**
 * Git 变更统计
 */
export interface GitChangeStats {
  /** 修改的文件数 */
  filesChanged: number;
  /** 新增行数 */
  insertions: number;
  /** 删除行数 */
  deletions: number;
}

/**
 * 发布信息（用于 AI 生成发布说明的输入）
 */
export interface ReleaseInfo {
  /** 起始版本号 */
  fromVersion: string;
  /** 目标版本号 */
  toVersion: string;
  /** 提交列表 */
  commits: GitCommit[];
  /** 变更统计 */
  stats: GitChangeStats;
}

/**
 * 发布亮点
 */
export class ReleaseHighlightDto {
  @ApiProperty({ description: "亮点标题" })
  @IsString()
  title!: string;

  @ApiProperty({ description: "亮点描述" })
  @IsString()
  description!: string;
}

/**
 * 变更条目
 */
export class ReleaseChangeDto {
  @ApiProperty({
    description: "变更类型",
    enum: ["feat", "fix", "perf", "refactor", "docs", "chore"],
  })
  @IsString()
  type!: string;

  @ApiProperty({ description: "影响范围" })
  @IsOptional()
  @IsString()
  scope?: string;

  @ApiProperty({ description: "变更描述" })
  @IsString()
  description!: string;
}

/**
 * AI 生成的发布说明
 */
export class ReleaseNotesDto {
  @ApiProperty({ description: "版本号" })
  @IsString()
  version!: string;

  @ApiProperty({ description: "一句话总结" })
  @IsString()
  summary!: string;

  @ApiProperty({ description: "发布亮点列表", type: [ReleaseHighlightDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReleaseHighlightDto)
  highlights!: ReleaseHighlightDto[];

  @ApiProperty({ description: "详细变更列表", type: [ReleaseChangeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReleaseChangeDto)
  changes!: ReleaseChangeDto[];
}

/**
 * 发布通知处理结果
 */
export interface ReleaseNotificationResult {
  /** 是否成功 */
  success: boolean;
  /** 版本号 */
  version: string;
  /** 生成的发布说明 */
  releaseNotes: ReleaseNotesDto;
  /** 通知发送统计 */
  notification: {
    /** 成功发送数量 */
    sent: number;
    /** 失败数量 */
    failed: number;
    /** 失败用户列表 */
    failedUsers?: string[];
  };
  /** 是否为 dry-run 模式 */
  dryRun: boolean;
}
