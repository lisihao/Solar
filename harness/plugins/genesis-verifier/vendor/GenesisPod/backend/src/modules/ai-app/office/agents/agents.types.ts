/**
 * Agent 系统类型定义
 */

export enum AgentType {
  SLIDES = "SLIDES",
  DEVELOPER = "DEVELOPER",
}

export interface AgentInput {
  prompt: string;
  title?: string;
  files?: Array<{
    filename: string;
    mimeType: string;
    buffer: Buffer;
  }>;
  urls?: string[];
  resourceIds?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- open-ended agent options bag; shape varies by step type
  options?: Record<string, any>;
}

export interface AgentTask {
  id: string;
  agentType: AgentType;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  input: AgentInput;
  result?: AgentResult;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface AgentResult {
  documentId?: string;
  artifacts: AgentArtifact[];
  summary: string;
  tokensUsed?: number;
  duration: number;
}

export interface AgentArtifact {
  id: string;
  type: "document" | "image" | "html" | "pdf" | "pptx" | "docx";
  name: string;
  url?: string;
  content?: string;
  mimeType?: string;
  size?: number;
}

export interface AgentStreamEvent {
  type:
    | "progress"
    | "plan_ready"
    | "step_start"
    | "step_progress"
    | "step_complete"
    | "tool_call"
    | "artifact"
    | "complete"
    | "error";
  timestamp: string;
  taskId: string;
  data?: unknown;
}

// 任务存储（内存，生产环境应使用 Redis）
export interface TaskStore {
  tasks: Map<string, AgentTask>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SSE event shape varies by task type
  streams: Map<string, any[]>; // taskId -> events
}

export const taskStore: TaskStore = {
  tasks: new Map(),
  streams: new Map(),
};
