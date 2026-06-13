import {
  IsString,
  IsOptional,
  IsArray,
  MaxLength,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
} from "class-validator";

export class CreateMissionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  description!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  leaderId!: string; // 指定的 Leader AI Member ID

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  objectives?: string[]; // 任务目标列表

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  constraints?: string[]; // 约束条件

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deliverables?: string[]; // 期望交付物

  @IsOptional()
  @IsBoolean()
  autoStart?: boolean; // 是否自动开始（默认 true）

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  notificationEmail?: string; // 任务完成后通知的邮箱
}

/**
 * 更新任务通知邮箱 DTO
 */
export class UpdateMissionNotificationDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  notificationEmail?: string | null; // 设为 null 可清除邮箱
}
