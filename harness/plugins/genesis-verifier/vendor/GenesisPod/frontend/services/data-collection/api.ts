import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

const baseUrl = `${config.apiUrl}/data-collection`;

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

// ============ Types ============

export interface DataSource {
  id: string;
  name: string;
  description?: string;
  type: string;
  category: string;
  baseUrl: string;
  apiEndpoint?: string;
  authType?: string;
  crawlerType: string;
  crawlerConfig: Record<string, unknown>;
  rateLimit?: number;
  keywords?: string[];
  categories?: string[];
  languages?: string[];
  minQualityScore: number;
  deduplicationConfig?: Record<string, unknown>;
  status: 'ACTIVE' | 'PAUSED' | 'FAILED' | 'MAINTENANCE';
  isVerified: boolean;
  lastTestedAt?: string;
  lastSuccessAt?: string;
  lastErrorMessage?: string;
  totalCollected: number;
  totalSuccess: number;
  totalFailed: number;
  totalDuplicates: number;
  successRate: number;
  averageQuality: number;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionTask {
  id: string;
  sourceId: string;
  name: string;
  description?: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  totalItems: number;
  processedItems: number;
  successItems: number;
  failedItems: number;
  duplicateItems: number;
  skippedItems: number;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  config?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  source?: DataSource;
}

export interface DashboardStats {
  sourceStats: {
    total: number;
    active: number;
    paused: number;
    failed: number;
  };
  taskStats: {
    total: number;
    running: number;
    completed: number;
    failed: number;
  };
  todayStats: {
    collected: number;
    successRate: number;
    avgQuality: number;
  };
  qualityMetrics: {
    avgCompleteness: number;
    avgAccuracy: number;
    avgTimeliness: number;
    avgUsability: number;
  };
  recentTasks: CollectionTask[];
  timeSeries: {
    date: string;
    collected: number;
    duplicates: number;
    failed: number;
  }[];
}

export interface QualityIssue {
  id: string;
  resourceId: string;
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  detectedAt: string;
  reviewStatus: 'PENDING' | 'REVIEWING' | 'RESOLVED' | 'IGNORED';
  reviewNote?: string;
  resource?: {
    id: string;
    title: string;
    type: string;
  };
}

export interface QualityStats {
  totalIssues: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  byReviewStatus: Record<string, number>;
  avgQualityScore: number;
  trends: {
    date: string;
    issues: number;
    resolved: number;
  }[];
}

export interface HistoryRecord {
  id: string;
  taskName: string;
  sourceName: string;
  status: string;
  totalItems: number;
  successItems: number;
  failedItems: number;
  duplicateItems: number;
  skippedItems: number;
  duration: number;
  startedAt: string;
  completedAt: string;
}

export interface HistoryStats {
  period: 'day' | 'week' | 'month';
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalCollected: number;
  totalDuplicates: number;
  totalFailed: number;
  successRate: number;
  avgDuration: number;
}

// ============ API Functions ============

// Dashboard
export async function getDashboardStats(): Promise<DashboardStats> {
  return request('/dashboard');
}

// Data Sources
export async function getDataSources(): Promise<{
  data: DataSource[];
  total: number;
}> {
  return request('/sources');
}

export async function getDataSource(id: string): Promise<DataSource> {
  return request(`/sources/${id}`);
}

export async function createDataSource(
  data: Partial<DataSource>
): Promise<DataSource> {
  return request('/sources', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateDataSource(
  id: string,
  data: Partial<DataSource>
): Promise<DataSource> {
  return request(`/sources/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteDataSource(id: string): Promise<void> {
  return request(`/sources/${id}`, {
    method: 'DELETE',
  });
}

export async function testDataSource(
  id: string
): Promise<{ message: string; data?: unknown }> {
  return request(`/sources/${id}/test`, {
    method: 'POST',
  });
}

export async function getDataSourceStats(): Promise<unknown> {
  return request('/sources/stats');
}

export async function fixRssUrls(): Promise<{
  fixed: string[];
  failed: string[];
  skipped: string[];
}> {
  return request('/sources/fix-rss-urls', {
    method: 'POST',
  });
}

// Collection Tasks
export async function getCollectionTasks(params?: {
  status?: string;
  sourceId?: string;
}): Promise<{ data: CollectionTask[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.status) query.append('status', params.status);
  if (params?.sourceId) query.append('sourceId', params.sourceId);

  const queryString = query.toString();
  return request(`/tasks${queryString ? `?${queryString}` : ''}`);
}

export async function getCollectionTask(id: string): Promise<CollectionTask> {
  return request(`/tasks/${id}`);
}

export async function createCollectionTask(data: {
  sourceId: string;
  name: string;
  description?: string;
  type: 'MANUAL' | 'SCHEDULED' | 'IMPORT' | 'RETRY';
  sourceConfig: Record<string, unknown>;
  deduplicationRules?: Record<string, unknown>;
  schedule?: string;
  priority?: number;
  maxConcurrency?: number;
  timeout?: number;
  retryCount?: number;
  createdBy?: string;
}): Promise<CollectionTask> {
  return request('/tasks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function executeTask(id: string): Promise<{ message: string }> {
  return request(`/tasks/${id}/execute`, {
    method: 'POST',
  });
}

export async function pauseTask(id: string): Promise<{ message: string }> {
  return request(`/tasks/${id}/pause`, {
    method: 'POST',
  });
}

export async function resumeTask(id: string): Promise<{ message: string }> {
  return request(`/tasks/${id}/resume`, {
    method: 'POST',
  });
}

export async function cancelTask(id: string): Promise<{ message: string }> {
  return request(`/tasks/${id}/cancel`, {
    method: 'POST',
  });
}

// Monitor
export async function getRunningTasks(): Promise<{
  data: CollectionTask[];
  total: number;
}> {
  return request('/monitor/running');
}

export async function getSystemMetrics(): Promise<unknown> {
  return request('/monitor/metrics');
}

export async function getTaskLogs(
  taskId: string,
  params?: {
    level?: string;
    limit?: number;
  }
): Promise<unknown[]> {
  const query = new URLSearchParams();
  if (params?.level) query.append('level', params.level);
  if (params?.limit) query.append('limit', params.limit.toString());

  const queryString = query.toString();
  return request(
    `/monitor/logs/${taskId}${queryString ? `?${queryString}` : ''}`
  );
}

// Quality
export async function getQualityIssues(params?: {
  severity?: string;
  reviewStatus?: string;
  limit?: number;
}): Promise<{ data: QualityIssue[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.severity) query.append('severity', params.severity);
  if (params?.reviewStatus) query.append('reviewStatus', params.reviewStatus);
  if (params?.limit) query.append('limit', params.limit.toString());

  const queryString = query.toString();
  return request(`/quality/issues${queryString ? `?${queryString}` : ''}`);
}

export async function getQualityStats(): Promise<QualityStats> {
  return request('/quality/stats');
}

export async function assessResourceQuality(
  resourceId: string
): Promise<unknown> {
  return request(`/quality/assess/${resourceId}`, {
    method: 'POST',
  });
}

export async function batchAssessQuality(
  limit?: number
): Promise<{ message: string; assessed: number }> {
  const query = limit ? `?limit=${limit}` : '';
  return request(`/quality/batch-assess${query}`, {
    method: 'POST',
  });
}

export async function updateReviewStatus(
  resourceId: string,
  status: string,
  note?: string
): Promise<{ message: string }> {
  return request(`/quality/review/${resourceId}`, {
    method: 'PUT',
    body: JSON.stringify({ status, note }),
  });
}

// History
export async function getHistory(params?: {
  status?: string;
  sourceId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}): Promise<{ data: HistoryRecord[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.status) query.append('status', params.status);
  if (params?.sourceId) query.append('sourceId', params.sourceId);
  if (params?.startDate) query.append('startDate', params.startDate);
  if (params?.endDate) query.append('endDate', params.endDate);
  if (params?.limit) query.append('limit', params.limit.toString());
  if (params?.offset) query.append('offset', params.offset.toString());

  const queryString = query.toString();
  return request(`/history${queryString ? `?${queryString}` : ''}`);
}

export async function getHistoryStats(
  period?: 'day' | 'week' | 'month'
): Promise<HistoryStats> {
  const query = period ? `?period=${period}` : '';
  return request(`/history/stats${query}`);
}

export async function getTaskHistory(id: string): Promise<unknown> {
  return request(`/history/${id}`);
}

export async function deleteHistory(id: string): Promise<void> {
  return request(`/history/${id}`, {
    method: 'DELETE',
  });
}

export async function cleanOldHistory(
  days?: number
): Promise<{ message: string; cleaned: number }> {
  const query = days ? `?days=${days}` : '';
  return request(`/history/cleanup/old${query}`, {
    method: 'DELETE',
  });
}

// ============ Scheduler Types ============

export interface SchedulerInfo {
  resourceType: string;
  isRunning: boolean;
  cronExpression: string;
  maxConcurrent: number;
  timeout: number;
  lastRun?: string;
  nextRun?: string;
  activeSourceCount: number;
}

export interface SchedulerStatus {
  enabled: boolean;
  defaultInterval: string;
  timezone: string;
  schedulers: SchedulerInfo[];
  activeExecutions: number;
}

export interface TriggerResult {
  resourceType: string;
  success: boolean;
  message: string;
  taskIds?: string[];
}

// ============ Scheduler API Functions ============

/**
 * Get scheduler status
 */
export async function getSchedulerStatus(): Promise<SchedulerStatus> {
  return request('/scheduler/status');
}

/**
 * Update scheduler configuration
 */
export async function updateSchedulerConfig(config: {
  enabled?: boolean;
  defaultInterval?: '6h' | '12h' | '24h';
}): Promise<SchedulerStatus> {
  return request('/scheduler/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

/**
 * Trigger collection for a specific resource type
 */
export async function triggerCollection(
  resourceType: string
): Promise<TriggerResult> {
  return request(`/scheduler/trigger/${resourceType}`, {
    method: 'POST',
  });
}

/**
 * Trigger collection for all resource types
 */
export async function triggerAllCollections(): Promise<TriggerResult[]> {
  return request('/scheduler/trigger-all', {
    method: 'POST',
  });
}

/**
 * Restart all schedulers
 */
export async function restartSchedulers(): Promise<{ message: string }> {
  return request('/scheduler/restart', {
    method: 'POST',
  });
}
