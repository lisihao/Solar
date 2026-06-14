import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

const baseUrl = `${config.apiUrl}`;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(message || `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const result = await response.json();

  // Auto-unwrap standard response format { success: true, data: T }
  if (
    result &&
    typeof result === 'object' &&
    'success' in result &&
    'data' in result
  ) {
    return result.data as T;
  }

  return result as T;
}

export interface WorkspaceResourceSummary {
  id: string;
  addedAt: string;
  metadata: Record<string, unknown>;
  resource: {
    id: string;
    title: string;
    type: string;
    primaryCategory?: string | null;
    abstract?: string | null;
    tags?: unknown;
    publishedAt?: string | null;
    aiSummary?: string | null;
    thumbnailUrl?: string | null;
  };
}

export interface WorkspaceTaskSummary {
  id: string;
  workspaceId: string;
  templateId: string;
  externalTaskId?: string | null;
  model: string;
  status: string;
  queuePosition?: number | null;
  estimatedTime?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  hasResult: boolean;
  hasError: boolean;
  result?: unknown;
  error?: unknown;
  parameters?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceResponse {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  resourceCount: number;
  resources: WorkspaceResourceSummary[];
  tasks: WorkspaceTaskSummary[];
  reports: Array<{
    id: string;
    title: string;
    template: string;
    createdAt: string;
  }>;
}

export interface WorkspaceTemplate {
  id: string;
  name: string;
  category: string;
  description?: string;
  version: number;
}

export interface CreateWorkspaceTaskPayload {
  templateId: string;
  model: string;
  question?: string;
  overrides?: Record<string, unknown>;
  resourceIds?: string[];
}

export async function createWorkspace(
  resourceIds: string[]
): Promise<WorkspaceResponse> {
  return request<WorkspaceResponse>('/workspaces', {
    method: 'POST',
    body: JSON.stringify({ resourceIds }),
  });
}

export async function getWorkspace(
  workspaceId: string
): Promise<WorkspaceResponse> {
  return request<WorkspaceResponse>(`/workspaces/${workspaceId}`);
}

export async function updateWorkspaceResources(
  workspaceId: string,
  payload: { addResourceIds?: string[]; removeResourceIds?: string[] }
): Promise<WorkspaceResponse> {
  return request<WorkspaceResponse>(`/workspaces/${workspaceId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function createWorkspaceTask(
  workspaceId: string,
  payload: CreateWorkspaceTaskPayload
): Promise<WorkspaceTaskSummary> {
  return request<WorkspaceTaskSummary>(`/workspaces/${workspaceId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getWorkspaceTask(
  workspaceId: string,
  taskId: string
): Promise<WorkspaceTaskSummary> {
  return request<WorkspaceTaskSummary>(
    `/workspaces/${workspaceId}/tasks/${taskId}`
  );
}

export async function listWorkspaceTemplates(
  category?: string
): Promise<WorkspaceTemplate[]> {
  const query = category ? `?category=${encodeURIComponent(category)}` : '';
  return request<WorkspaceTemplate[]>(`/workspaces/templates${query}`);
}

export interface GenerateWorkspaceReportPayload {
  taskId: string;
  templateId: string;
  userId: string;
  title?: string;
  notes?: string;
}

export async function generateWorkspaceReport(
  payload: GenerateWorkspaceReportPayload
) {
  return request('/reports/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
