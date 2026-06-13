/**
 * 执行 Agent 响应 DTO
 */

import { ApiProperty } from "@nestjs/swagger";
import { AgentTaskStatus } from "@/modules/ai-harness/agents/abstractions/agent.types";

/**
 * 任务状态值列表（用于 Swagger）
 */
const TASK_STATUS_VALUES: AgentTaskStatus[] = [
  "pending",
  "planning",
  "executing",
  "completed",
  "failed",
  "cancelled",
];

/**
 * 执行响应 DTO
 */
export class ExecuteResponseDto {
  @ApiProperty({
    description: "任务 ID",
    example: "clxxxx12345",
  })
  taskId!: string;

  @ApiProperty({
    description: "任务状态",
    enum: TASK_STATUS_VALUES,
    example: "pending",
  })
  status!: AgentTaskStatus;
}
