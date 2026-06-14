import { IsString, IsOptional, MaxLength } from "class-validator";

export class GenerateSummaryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string; // 可选，不提供则AI自动生成

  @IsOptional()
  @IsString()
  @MaxLength(500)
  fromMessageId?: string; // 纪要起始消息ID

  @IsOptional()
  @IsString()
  @MaxLength(500)
  toMessageId?: string; // 纪要结束消息ID

  @IsOptional()
  @IsString()
  @MaxLength(50)
  aiModel?: string; // 使用的AI模型，默认使用系统配置
}
