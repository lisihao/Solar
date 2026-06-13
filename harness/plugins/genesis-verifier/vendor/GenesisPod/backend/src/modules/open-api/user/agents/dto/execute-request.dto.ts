/**
 * 执行 Agent 请求 DTO
 */

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsObject,
  IsNumber,
  Min,
  IsIn,
} from "class-validator";
import { Type } from "class-transformer";
import { AgentId } from "@/modules/ai-harness/agents/abstractions/agent.types";
import {
  PLATFORM_AGENT_IDS,
  SLIDES_AGENT_ID,
} from "@/modules/ai-app/contracts/agent-catalog";

/**
 * 上传文件 DTO
 */
export class UploadedFileDto {
  @ApiProperty({ description: "文件 ID" })
  @IsString()
  id!: string;

  @ApiProperty({ description: "文件名" })
  @IsString()
  name!: string;

  @ApiProperty({ description: "MIME 类型" })
  @IsString()
  mimeType!: string;

  @ApiProperty({ description: "文件大小（字节）" })
  @IsNumber()
  @Min(0)
  size!: number;

  @ApiPropertyOptional({ description: "文件 URL" })
  @IsOptional()
  @IsString()
  url?: string;
}

/**
 * 执行 Agent 请求 DTO
 */
export class ExecuteRequestDto {
  @ApiPropertyOptional({
    description: "Agent ID（可选，系统会自动推断）",
    enum: PLATFORM_AGENT_IDS,
    example: SLIDES_AGENT_ID,
  })
  @IsOptional()
  @IsIn(PLATFORM_AGENT_IDS)
  agentId?: AgentId;

  @ApiProperty({
    description: "用户输入的提示词",
    example: "帮我生成一份关于人工智能发展的 PPT",
  })
  @IsString()
  prompt!: string;

  @ApiPropertyOptional({
    description: "上传的文件列表",
    type: [UploadedFileDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UploadedFileDto)
  files?: UploadedFileDto[];

  @ApiPropertyOptional({
    description: "参考网址列表",
    type: [String],
    example: ["https://example.com"],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  urls?: string[];

  @ApiPropertyOptional({
    description: "引用的资源 ID 列表",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resourceIds?: string[];

  @ApiPropertyOptional({
    description: "使用的模板 ID",
  })
  @IsOptional()
  @IsString()
  templateId?: string;

  @ApiPropertyOptional({
    description: "额外选项配置",
    example: { theme: "professional", language: "zh-CN" },
  })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;
}
