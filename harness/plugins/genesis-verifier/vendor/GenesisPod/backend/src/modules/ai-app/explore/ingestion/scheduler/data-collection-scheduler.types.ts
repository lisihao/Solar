/**
 * Data Collection Scheduler Types
 * 通用数据采集调度器类型定义
 */

import { IsBoolean, IsOptional, IsIn } from "class-validator";

export interface SchedulerConfig {
  /** 是否启用调度器 */
  enabled: boolean;
  /** 默认采集间隔: "6h" | "12h" | "24h" */
  defaultInterval: string;
  /** 时区 */
  timezone: string;
}

export interface SchedulerInfo {
  /** 资源类型 (PAPER, BLOG, NEWS, etc.) */
  resourceType: string;
  /** 是否正在运行 */
  isRunning: boolean;
  /** cron 表达式 */
  cronExpression: string;
  /** 最大并发数 */
  maxConcurrent: number;
  /** 超时时间(秒) */
  timeout: number;
  /** 上次执行时间 */
  lastRun?: Date;
  /** 下次执行时间 */
  nextRun?: Date;
  /** 活跃数据源数量 */
  activeSourceCount: number;
}

export interface SchedulerStatus {
  /** 是否启用 */
  enabled: boolean;
  /** 默认间隔 */
  defaultInterval: string;
  /** 时区 */
  timezone: string;
  /** 各类型调度器状态 */
  schedulers: SchedulerInfo[];
  /** 当前活跃执行数 */
  activeExecutions: number;
}

export interface TriggerResult {
  /** 资源类型 */
  resourceType: string;
  /** 是否成功触发 */
  success: boolean;
  /** 消息 */
  message: string;
  /** 创建的任务ID列表 */
  taskIds?: string[];
}

export class UpdateSchedulerConfigDto {
  /** 是否启用 */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** 默认间隔: "6h" | "12h" | "24h" */
  @IsOptional()
  @IsIn(["6h", "12h", "24h"])
  defaultInterval?: "6h" | "12h" | "24h";
}

/** 默认 cron 表达式映射 */
export const DEFAULT_CRON_EXPRESSIONS: Record<string, string> = {
  PAPER: "0 0 * * 0", // 每周日凌晨
  BLOG: "0 */12 * * *", // 每12小时
  NEWS: "0 */12 * * *", // 每12小时
  YOUTUBE_VIDEO: "0 0 * * *", // 每天凌晨
  RSS: "0 */12 * * *", // 每12小时
  REPORT: "0 0 1 * *", // 每月1号
  PROJECT: "0 0 * * 0", // 每周日
  EVENT: "0 0 * * 0", // 每周日
  POLICY: "0 0 * * *", // 每天
};

/** 间隔到 cron 表达式映射 */
export const INTERVAL_TO_CRON: Record<string, string> = {
  "6h": "0 */6 * * *",
  "12h": "0 */12 * * *",
  "24h": "0 0 * * *",
};
