/**
 * 任务响应 DTO
 */

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  AgentId,
  AgentTaskStatus,
  AgentInput,
  AgentPlan,
  AgentResult,
} from "@/modules/ai-harness/agents/abstractions/agent.types";
import {
  PLATFORM_AGENT_IDS,
  SLIDES_AGENT_ID,
} from "@/modules/ai-app/contracts/agent-catalog";

/**
 * 任务详情响应 DTO
 */
export class TaskResponseDto {
  @ApiProperty({
    description: "任务 ID",
    example: "clxxxx12345",
  })
  id!: string;

  @ApiProperty({
    description: "Agent ID",
    enum: PLATFORM_AGENT_IDS,
    example: SLIDES_AGENT_ID,
  })
  agentId!: AgentId;

  @ApiProperty({
    description: "任务状态",
    example: "executing",
  })
  status!: AgentTaskStatus;

  @ApiProperty({
    description: "输入内容",
  })
  input!: AgentInput;

  @ApiPropertyOptional({
    description: "执行计划",
  })
  plan?: AgentPlan;

  @ApiPropertyOptional({
    description: "执行结果",
  })
  result?: AgentResult;

  @ApiPropertyOptional({
    description: "错误信息",
  })
  error?: string;

  @ApiProperty({
    description: "创建时间",
    example: "2025-12-18T10:00:00Z",
  })
  createdAt!: Date;

  @ApiProperty({
    description: "更新时间",
    example: "2025-12-18T10:05:00Z",
  })
  updatedAt!: Date;

  @ApiPropertyOptional({
    description: "完成时间",
    example: "2025-12-18T10:10:00Z",
  })
  completedAt?: Date;
}

/**
 * 产出物 DTO
 */
export class ArtifactDto {
  @ApiProperty({
    description: "产出物 ID",
    example: "clxxxx67890",
  })
  id!: string;

  @ApiProperty({
    description: "产出物类型",
    example: "PPTX",
  })
  type!: string;

  @ApiProperty({
    description: "产出物名称",
    example: "人工智能发展报告.pptx",
  })
  name!: string;

  @ApiProperty({
    description: "MIME 类型",
    example:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  })
  mimeType!: string;

  @ApiProperty({
    description: "文件大小（字节）",
    example: 1024000,
  })
  size!: number;

  @ApiPropertyOptional({
    description: "下载 URL",
    example: "https://example.com/artifacts/clxxxx67890",
  })
  url?: string;

  @ApiPropertyOptional({
    description: "元数据",
  })
  metadata?: Record<string, unknown>;

  @ApiProperty({
    description: "创建时间",
    example: "2025-12-18T10:10:00Z",
  })
  createdAt!: Date;
}

/**
 * 产出物列表响应 DTO
 */
export class ArtifactsResponseDto {
  @ApiProperty({
    description: "产出物列表",
    type: [ArtifactDto],
  })
  artifacts!: ArtifactDto[];
}
