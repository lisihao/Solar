/**
 * Agent API 客户端
 * 与后端 Agent 系统通信
 */

import { logger } from '@/lib/utils/logger';
import {
  AgentType,
  AgentInput,
  AgentConfig,
  AgentTask,
  AgentEvent,
  AgentTemplate,
  Artifact,
} from './types';

const API_BASE = '/api/agents';

/**
 * 获取所有 Agent 配置
 */
export async function getAgents(): Promise<AgentConfig[]> {
  const response = await fetch(API_BASE);
  if (!response.ok) {
    throw new Error('Failed to fetch agents');
  }
  const result = await response.json();
  // Handle wrapped API response { success: true, data: T }
  const data = result?.data ?? result;
  return data.agents;
}

/**
 * 获取 Agent 状态
 */
export async function getAgentStatus(): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE}/status`);
  if (!response.ok) {
    throw new Error('Failed to fetch agent status');
  }
  return response.json();
}

/**
 * 获取 Agent 模板
 */
export async function getAgentTemplates(
  agentType: AgentType
): Promise<AgentTemplate[]> {
  const response = await fetch(
    `${API_BASE}/${agentType.toLowerCase()}/templates`
  );
  if (!response.ok) {
    throw new Error('Failed to fetch templates');
  }
  const result = await response.json();
  // Handle wrapped API response { success: true, data: T }
  const data = result?.data ?? result;
  return data.templates;
}

/**
 * 执行 Agent 任务
 */
export async function executeAgent(
  input: AgentInput,
  agentType?: AgentType
): Promise<{ taskId: string; status: string }> {
  const response = await fetch(`${API_BASE}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...input,
      agentType,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to execute agent');
  }

  return response.json();
}

/**
 * 获取任务状态
 */
export async function getTask(taskId: string): Promise<AgentTask> {
  const response = await fetch(`${API_BASE}/tasks/${taskId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch task');
  }
  return response.json();
}

/**
 * 订阅任务进度流 (SSE)
 */
export function subscribeToTask(
  taskId: string,
  onEvent: (event: AgentEvent) => void,
  onError?: (error: Error) => void
): () => void {
  const eventSource = new EventSource(`${API_BASE}/tasks/${taskId}/stream`);

  eventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data) as AgentEvent;
      onEvent(event);

      // 如果是完成或错误事件，关闭连接
      if (event.type === 'complete' || event.type === 'error') {
        eventSource.close();
      }
    } catch (err) {
      logger.error('Failed to parse event:', err);
    }
  };

  eventSource.onerror = (e) => {
    logger.error('SSE error:', e);
    onError?.(new Error('Connection error'));
    eventSource.close();
  };

  // 返回取消函数
  return () => {
    eventSource.close();
  };
}

/**
 * 取消任务
 */
export async function cancelTask(
  taskId: string
): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE}/tasks/${taskId}/cancel`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to cancel task');
  }

  return response.json();
}

/**
 * 获取任务产出物
 */
export async function getArtifacts(taskId: string): Promise<Artifact[]> {
  const response = await fetch(`${API_BASE}/tasks/${taskId}/artifacts`);
  if (!response.ok) {
    throw new Error('Failed to fetch artifacts');
  }
  const result = await response.json();
  // Handle wrapped API response { success: true, data: T }
  const data = result?.data ?? result;
  return data.artifacts;
}

/**
 * 下载产出物
 */
export function getArtifactDownloadUrl(artifactId: string): string {
  return `${API_BASE}/artifacts/${artifactId}/download`;
}

/**
 * 执行 Agent 任务并自动处理事件
 */
export async function executeAndSubscribe(
  input: AgentInput,
  agentType: AgentType | undefined,
  handlers: {
    onEvent?: (event: AgentEvent) => void;
    onComplete?: (result: AgentTask) => void;
    onError?: (error: Error) => void;
  }
): Promise<{ taskId: string; unsubscribe: () => void }> {
  // 1. 创建任务
  const { taskId } = await executeAgent(input, agentType);

  // 2. 订阅事件流
  const unsubscribe = subscribeToTask(
    taskId,
    (event) => {
      handlers.onEvent?.(event);

      if (event.type === 'complete') {
        getTask(taskId).then(handlers.onComplete);
      }

      if (event.type === 'error') {
        handlers.onError?.(new Error(event.error));
      }
    },
    handlers.onError
  );

  return { taskId, unsubscribe };
}

export default {
  getAgents,
  getAgentStatus,
  getAgentTemplates,
  executeAgent,
  getTask,
  subscribeToTask,
  cancelTask,
  getArtifacts,
  getArtifactDownloadUrl,
  executeAndSubscribe,
};
