import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
} from "class-validator";

export enum RadarEntityType {
  PERSON = "person",
  COMPANY = "company",
  PRODUCT = "product",
  EVENT = "event",
  TOPIC = "topic",
}

// cron 表达式简单白名单（5 段，允许数字 / 星号 / 斜杠步进 / 范围 / 列表）。
// 不接受秒级（6 段），避免高频刷新。
const CRON_REGEX = new RegExp(
  "^[\\d*/,-]+\\s+[\\d*/,-]+\\s+[\\d*/,-]+\\s+[\\d*/,-]+\\s+[\\d*/,-]+$",
);

const BRIEFING_TIME_VALUES = ["08:00", "12:00", "18:00", "21:00"] as const;
const OUTPUT_LANGUAGE_VALUES = ["zh-CN", "en-US"] as const;
const SIGNAL_TYPE_VALUES = [
  "turning_point",
  "trend_acceleration",
  "new_entity",
  "key_event",
  "anomaly",
] as const;
export const MATCH_MODE_VALUES = ["semantic", "literal", "hybrid"] as const;

export class CreateRadarTopicDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(RadarEntityType)
  entityType?: RadarEntityType;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  keywords!: string[];

  /** 关键词匹配模式（semantic 默认 / literal 硬过滤 / hybrid 加分） */
  @IsOptional()
  @IsIn(MATCH_MODE_VALUES)
  matchMode?: (typeof MATCH_MODE_VALUES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(CRON_REGEX, {
    message: "refreshCron 必须是 5 段标准 cron 表达式",
  })
  refreshCron?: string;

  // 2026-05-18 PR-DR2: 每日精选配置字段（创建时可选，均有 DB 默认值）

  /** 精选生成时间（K6 白名单：08:00/12:00/18:00/21:00） */
  @IsOptional()
  @IsIn(BRIEFING_TIME_VALUES)
  briefingTime?: string;

  /** IANA 时区（null = 跟 user.timezone） */
  @IsOptional()
  @IsString()
  briefingTimezone?: string;

  /** 每日精选信号数量（1-10） */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  signalsTarget?: number;

  /** 用户勾选的信号类型多选 */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  signalTypes?: Array<(typeof SIGNAL_TYPE_VALUES)[number]>;

  /** 是否跳过周末精选 */
  @IsOptional()
  @IsBoolean()
  weekendSkip?: boolean;

  /** AI 输出语言（zh-CN/en-US） */
  @IsOptional()
  @IsIn(OUTPUT_LANGUAGE_VALUES)
  outputLanguage?: string;

  /** 推送配置（null = 用账户级默认） */
  @IsOptional()
  @IsObject()
  pushConfig?: Record<string, unknown>;
}
