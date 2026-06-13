import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsNotEmpty,
} from "class-validator";

export class AddAIMemberDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  aiModel!: string; // grok, gpt-4, claude, gemini

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  displayName!: string; // 显示名称，如 "AI-Grok"

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  avatar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  roleDescription?: string; // 角色描述，如 "技术专家"

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  systemPrompt?: string; // 系统提示词

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(100)
  contextWindow?: number; // 上下文消息数，默认20

  @IsOptional()
  @IsString()
  @MaxLength(50)
  responseStyle?: string; // concise, detailed, academic

  @IsOptional()
  @IsBoolean()
  autoRespond?: boolean; // 是否自动参与

  @IsOptional()
  @IsBoolean()
  canMentionOtherAI?: boolean; // 是否可以@其他AI

  @IsOptional()
  @IsString()
  @MaxLength(50)
  collaborationStyle?: string; // AI协作风格
}
