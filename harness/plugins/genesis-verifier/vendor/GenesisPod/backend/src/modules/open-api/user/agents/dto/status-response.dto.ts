/**
 * 状态响应 DTO
 */

import { ApiProperty } from "@nestjs/swagger";

/**
 * Agent 状态详情 DTO
 */
export class AgentStatusDto {
  @ApiProperty({
    description: "任务总数",
    example: 100,
  })
  totalTasks!: number;

  @ApiProperty({
    description: "活跃任务数",
    example: 5,
  })
  activeTasks!: number;

  @ApiProperty({
    description: "成功任务数",
    example: 90,
  })
  successfulTasks!: number;

  @ApiProperty({
    description: "失败任务数",
    example: 5,
  })
  failedTasks!: number;

  @ApiProperty({
    description: "平均执行时间（毫秒）",
    example: 30000,
  })
  averageExecutionTime!: number;

  @ApiProperty({
    description: "成功率",
    example: 0.95,
  })
  successRate!: number;
}

/**
 * Agent 统计信息 DTO
 */
export class AgentStatsDto {
  @ApiProperty({
    description: "注册的 Agent 数量",
    example: 4,
  })
  registeredAgents!: number;

  @ApiProperty({
    description: "可用的工具数量",
    example: 20,
  })
  availableTools!: number;

  @ApiProperty({
    description: "总任务数",
    example: 1000,
  })
  totalTasks!: number;
}

/**
 * 状态报告响应 DTO
 */
export class StatusReportResponseDto {
  @ApiProperty({
    description: "Agent 状态详情",
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- agent status shape varies by agent type
  agents!: Record<string, any>;

  @ApiProperty({
    description: "统计信息",
    type: AgentStatsDto,
  })
  stats!: AgentStatsDto;
}
