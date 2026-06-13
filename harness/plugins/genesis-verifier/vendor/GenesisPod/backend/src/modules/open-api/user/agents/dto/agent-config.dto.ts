/**
 * Agent 配置 DTO
 */

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AgentId } from "@/modules/ai-harness/agents/abstractions/agent.types";
import {
  PLATFORM_AGENT_IDS,
  SLIDES_AGENT_ID,
} from "@/modules/ai-app/contracts/agent-catalog";

/**
 * Agent 模板 DTO
 */
export class AgentTemplateDto {
  @ApiProperty({
    description: "模板 ID",
    example: "template-001",
  })
  id!: string;

  @ApiProperty({
    description: "模板名称",
    example: "商业计划书",
  })
  name!: string;

  @ApiProperty({
    description: "模板描述",
    example: "适合创业公司融资使用的商业计划书模板",
  })
  description!: string;

  @ApiPropertyOptional({
    description: "模板图标",
    example: "💼",
  })
  icon?: string;

  @ApiProperty({
    description: "模板分类",
    example: "商业文档",
  })
  category!: string;

  @ApiPropertyOptional({
    description: "默认提示词",
    example: "生成一份完整的商业计划书",
  })
  defaultPrompt?: string;

  @ApiPropertyOptional({
    description: "默认选项",
  })
  defaultOptions?: Record<string, unknown>;
}

/**
 * Agent 配置 DTO
 */
export class AgentConfigDto {
  @ApiProperty({
    description: "Agent ID",
    enum: PLATFORM_AGENT_IDS,
    example: SLIDES_AGENT_ID,
  })
  id!: AgentId;

  @ApiProperty({
    description: "Agent 名称",
    example: "AI Slides",
  })
  name!: string;

  @ApiProperty({
    description: "Agent 描述",
    example: "智能 PPT 生成器，快速创建专业演示文稿",
  })
  description!: string;

  @ApiProperty({
    description: "Agent 图标",
    example: "📊",
  })
  icon!: string;

  @ApiProperty({
    description: "Agent 主题色",
    example: "#3B82F6",
  })
  color!: string;

  @ApiProperty({
    description: "Agent 能力列表",
    type: [String],
    example: ["自动生成大纲", "智能配图", "多种主题风格", "导出 PPTX"],
  })
  capabilities!: string[];

  @ApiProperty({
    description: "Agent 模板列表",
    type: [AgentTemplateDto],
  })
  templates!: AgentTemplateDto[];
}

/**
 * Agents 列表响应 DTO
 */
export class AgentsResponseDto {
  @ApiProperty({
    description: "Agent 配置列表",
    type: [AgentConfigDto],
  })
  agents!: AgentConfigDto[];
}

/**
 * Agent 模板列表响应 DTO
 */
export class TemplatesResponseDto {
  @ApiProperty({
    description: "模板列表",
    type: [AgentTemplateDto],
  })
  templates!: AgentTemplateDto[];
}
