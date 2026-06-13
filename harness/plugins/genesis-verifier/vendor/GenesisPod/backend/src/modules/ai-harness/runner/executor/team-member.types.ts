/**
 * Team Member Types — 通用类型
 *
 * 2026-05-01 (PR-X-O): 从 interfaces.ts 拆出。
 */

/**
 * 团队成员基础信息
 */
export interface TeamMemberInfo {
  id: string;
  agentName: string | null;
  displayName: string;
  aiModel: string;
  isLeader: boolean;
  systemPrompt?: string | null;
  persona?: string | null;
}

/**
 * 任务定义
 */
export interface TaskDefinition {
  id?: string;
  title: string;
  description: string;
  assigneeId: string;
  assigneeName: string;
  reason: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  taskType: string;
  dependsOn: number[];
}

/**
 * 任务分解数据
 */
export interface TaskBreakdownData {
  understanding: string;
  tasks: TaskDefinition[];
  executionPlan: string;
  risks: string;
}
