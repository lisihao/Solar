/**
 * Topic Insights API Client
 *
 * TI 模块业务 API（按业务/平台分层原则归属业务侧 services 命名空间）。
 * 平台层（lib/markdown / components/common）禁止直接 import 本文件。
 */

import { getAuthTokens, refreshAccessToken, logout } from '@/lib/utils/auth';
import { config } from '@/lib/utils/config';
import type {
  ResearchTopic,
  TopicDimension,
  TopicReport,
  TopicEvidence,
  TopicSchedule,
  TopicRefreshLog,
  TopicStats,
  ResearchTemplate,
  RefreshStatusResponse,
  ReportComparisonResult,
  CreateTopicDto,
  UpdateTopicDto,
  ListTopicsDto,
  TriggerRefreshDto,
  AddDimensionDto,
  UpdateDimensionDto,
  ReorderDimensionsDto,
  ListReportsDto,
  ExportReportDto,
  CompareReportsDto,
  ListEvidenceDto,
  UpdateScheduleDto,
  ListLogsDto,
  ResearchTopicType,
} from '@/lib/types/topic-insights';

// ★ 使用统一的 config.apiBaseUrl，浏览器端返回空字符串以使用相对 URL
// 这样请求会通过 Next.js rewrites 代理到后端，避免 CORS 和认证问题
const API_BASE = config.apiBaseUrl;
const API_PREFIX = '/api/v1/insight';

/**
 * 401 错误类，用于轮询中检测并停止
 */
export class UnauthorizedError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * 带认证的 fetch 封装
 * ★ 处理 401：尝试刷新 token，失败则 logout
 */
async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const tokens = getAuthTokens();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (tokens?.accessToken) {
    (headers as Record<string, string>)['Authorization'] =
      `Bearer ${tokens.accessToken}`;
  }

  let response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
  });

  // ★ 401 处理：尝试刷新 token 并重试
  if (response.status === 401) {
    const newTokens = await refreshAccessToken();
    if (newTokens) {
      (headers as Record<string, string>)['Authorization'] =
        `Bearer ${newTokens.accessToken}`;
      response = await fetch(`${API_BASE}${url}`, { ...options, headers });
    }
    if (!newTokens || response.status === 401) {
      logout();
      throw new UnauthorizedError('Session expired');
    }
  }

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const errorData = await response.json();
        errorMessage = errorData.message || errorMessage;
      } else {
        const text = await response.text();
        if (text) errorMessage = text.slice(0, 200);
      }
    } catch {
      // 忽略解析错误
    }
    throw new Error(errorMessage);
  }

  // ★ 检查响应是否有内容
  const contentLength = response.headers.get('content-length');
  const contentType = response.headers.get('content-type');

  // 204 No Content — 有意的空响应
  if (response.status === 204) {
    return null;
  }

  // ★ 代理失败检测：200 但 content-length=0 或无 content-type 且无 body
  // 这通常是 Next.js rewrite proxy 在后端不可用时返回的空壳响应
  if (contentLength === '0' && !contentType) {
    throw new Error('服务暂时不可用，请稍后刷新重试');
  }

  // 非 JSON 响应
  if (contentType && !contentType.includes('application/json')) {
    return response.text();
  }

  // ★ 安全解析 JSON
  const text = await response.text();
  if (!text || text.trim() === '') {
    // 200 + 空 body = 异常（代理失败或后端重启），不应静默返回 null
    throw new Error('服务暂时不可用，请稍后刷新重试');
  }

  try {
    const result = JSON.parse(text);

    // Auto-unwrap standard response format { success: true, data: T }
    if (
      result &&
      typeof result === 'object' &&
      'success' in result &&
      'data' in result
    ) {
      return result.data;
    }

    return result;
  } catch {
    logger.warn(
      '[fetchWithAuth] Failed to parse JSON response:',
      text.slice(0, 100)
    );
    return null;
  }
}

// ==================== Topics CRUD ====================

/**
 * 创建专题
 */
export async function createTopic(dto: CreateTopicDto): Promise<ResearchTopic> {
  return fetchWithAuth(`${API_PREFIX}/topics`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/**
 * 获取专题列表
 */
export interface GetTopicsResponse {
  topics: ResearchTopic[];
  total: number;
  skip: number;
  take: number;
}

export async function getTopics(
  options?: ListTopicsDto
): Promise<GetTopicsResponse> {
  const params = new URLSearchParams();
  if (options?.type) params.set('type', options.type);
  if (options?.status) params.set('status', options.status);
  if (options?.search) params.set('search', options.search);
  if (options?.skip != null) params.set('skip', options.skip.toString());
  if (options?.take != null) params.set('take', options.take.toString());

  const query = params.toString();
  const response = await fetchWithAuth(
    `${API_PREFIX}/topics${query ? `?${query}` : ''}`
  );
  // Backend returns { topics, total, skip, take }
  if (Array.isArray(response)) {
    return {
      topics: response,
      total: response.length,
      skip: 0,
      take: response.length,
    };
  }
  return {
    topics: response.topics || [],
    total: response.total ?? (response.topics?.length || 0),
    skip: response.skip ?? 0,
    take: response.take ?? 20,
  };
}

/**
 * 获取专题详情
 */
export async function getTopic(topicId: string): Promise<ResearchTopic> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}`);
}

/**
 * 更新专题
 */
export async function updateTopic(
  topicId: string,
  dto: UpdateTopicDto
): Promise<ResearchTopic> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

/**
 * 删除专题
 */
export async function deleteTopic(topicId: string): Promise<void> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}`, {
    method: 'DELETE',
  });
}

// ==================== Refresh Operations ====================

/**
 * 触发刷新
 */
export async function triggerRefresh(
  topicId: string,
  dto?: TriggerRefreshDto
): Promise<{ jobId: string; message: string }> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/refresh`, {
    method: 'POST',
    body: JSON.stringify(dto || {}),
  });
}

/**
 * 获取刷新状态
 */
export async function getRefreshStatus(
  topicId: string
): Promise<RefreshStatusResponse> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/refresh/status`);
}

/**
 * 取消刷新
 */
export async function cancelRefresh(
  topicId: string,
  jobId: string
): Promise<{ success: boolean; message: string }> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/refresh/cancel`, {
    method: 'POST',
    body: JSON.stringify({ jobId }),
  });
}

/**
 * 创建刷新进度 SSE 连接
 */
export function createRefreshProgressStream(
  topicId: string,
  handlers: {
    onProgress?: (event: {
      phase: string;
      progress: number;
      message: string;
      currentDimension?: string;
      completedDimensions: number;
      totalDimensions: number;
    }) => void;
    onComplete?: (event: { reportId: string }) => void;
    onError?: (event: { error: string }) => void;
  }
): { close: () => void } {
  const tokens = getAuthTokens();
  const url = `${API_BASE}${API_PREFIX}/topics/${topicId}/refresh/progress`;

  // SECURITY: EventSource API does not support custom headers, so the JWT
  // token must be passed as a URL query parameter. This is a known limitation
  // of the EventSource spec. TODO: Replace with a one-time SSE ticket endpoint
  // (POST /auth/sse-ticket → short-lived token) to avoid long-lived JWT exposure
  // in server logs and browser history.
  const eventSource = new EventSource(
    `${url}${tokens?.accessToken ? `?token=${tokens.accessToken}` : ''}`
  );

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.phase === 'completed') {
        handlers.onComplete?.({ reportId: data.reportId });
        eventSource.close();
      } else if (data.phase === 'failed') {
        handlers.onError?.({ error: data.error || 'Refresh failed' });
        eventSource.close();
      } else {
        handlers.onProgress?.(data);
      }
    } catch (error) {
      handlers.onError?.({ error: 'Failed to parse progress event' });
      eventSource.close();
    }
  };

  eventSource.onerror = () => {
    handlers.onError?.({ error: 'Connection error' });
    eventSource.close();
  };

  return {
    close: () => eventSource.close(),
  };
}

// ==================== Dimensions ====================

/**
 * 获取维度列表
 */
export async function getDimensions(
  topicId: string
): Promise<TopicDimension[]> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/dimensions`);
}

/**
 * 添加维度
 */
export async function addDimension(
  topicId: string,
  dto: AddDimensionDto
): Promise<TopicDimension> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/dimensions`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/**
 * 更新维度
 */
export async function updateDimension(
  topicId: string,
  dimensionId: string,
  dto: UpdateDimensionDto
): Promise<TopicDimension> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/dimensions/${dimensionId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }
  );
}

/**
 * 删除维度
 */
export async function deleteDimension(
  topicId: string,
  dimensionId: string
): Promise<void> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/dimensions/${dimensionId}`,
    {
      method: 'DELETE',
    }
  );
}

/**
 * 刷新单个维度
 */
export async function refreshDimension(
  topicId: string,
  dimensionId: string,
  options?: { priority?: string; regenerate?: boolean }
): Promise<{ success: boolean; message: string }> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/dimensions/${dimensionId}/refresh`,
    {
      method: 'POST',
      body: JSON.stringify(options || {}),
    }
  );
}

/**
 * 调整维度顺序
 */
export async function reorderDimensions(
  topicId: string,
  dto: ReorderDimensionsDto
): Promise<TopicDimension[]> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/dimensions/reorder`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// ==================== Reports ====================

/**
 * 获取报告列表
 */
export async function getReports(
  topicId: string,
  options?: ListReportsDto
): Promise<{ reports: TopicReport[]; hasMore: boolean; nextCursor?: string }> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.cursor) params.set('cursor', options.cursor);

  const query = params.toString();
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports${query ? `?${query}` : ''}`
  );
}

/**
 * 获取最新报告
 */
export async function getLatestReport(topicId: string): Promise<TopicReport> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/reports/latest`);
}

/**
 * 获取指定报告
 */
export async function getReport(
  topicId: string,
  reportId: string
): Promise<TopicReport> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/reports/${reportId}`);
}

/**
 * ★ v5: 获取报告质量追踪数据
 */
export async function getReportQualityTrace(
  topicId: string,
  reportId: string
): Promise<ReportQualityTrace | null> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/quality-trace`
  );
}

/**
 * ★ v5: 获取报告质量概览
 */
export async function getReportQualitySummary(
  topicId: string,
  reportId: string
): Promise<ReportQualitySummary | null> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/quality-summary`
  );
}

/**
 * ★ v5.1: 获取报告质量缺陷详情
 */
export async function getReportQualityDetails(
  topicId: string,
  reportId: string,
  rule?: string
): Promise<ReportQualityDetails | null> {
  const params = rule ? `?rule=${encodeURIComponent(rule)}` : '';
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/quality-details${params}`
  );
}

export interface DefectDetail {
  line: number;
  text: string;
}

export interface ReportQualityDetails {
  details: Record<string, DefectDetail[]>;
  dimensionBreakdown: Array<{
    dimensionName: string;
    defects: Record<string, number>;
  }>;
}

/** 报告质量追踪数据类型 */
export interface ReportQualityTrace {
  version: number;
  generatedAt: string;
  pipelineVersion: string;
  evidenceQuality: {
    totalEvidences: number;
    credibilityDistribution: {
      high: number;
      medium: number;
      low: number;
      unscored: number;
    };
    uniqueDomains: number;
    fullContentRatio: number;
    evidencesWithFigures: number;
    recentRatio: number;
  };
  dimensionOutputs: Array<{
    dimensionId: string;
    dimensionName: string;
    rawOutput: {
      contentLength: number;
      keyFindingsCount: number;
      citationsUsed: number;
      uniqueSourcesCited: number;
      figureRefsCount: number;
      jsonParsed: boolean;
      usedFallback: boolean;
    };
    defects: {
      bareLatexCount: number;
      brokenDollarNesting: number;
      unwrappedEnvironments: number;
      pseudoCodeLines: number;
      leakedMetaNotes: number;
      leakedFigureNotes: number;
      longListItems: number;
      trappedConclusions: number;
      missingHeadings: number;
      headingEchoes: number;
      htmlEntities: number;
      foreignContentRatio: number;
    };
    qualityGate?: {
      passed: boolean;
      errorCount: number;
      warningCount: number;
      autoFixCount: number;
    };
  }>;
  postProcessing: {
    fixesApplied: Record<string, number>;
    totalFixes: number;
    charsBefore: number;
    charsAfter: number;
    warnings: string[];
  };
  synthesisOutput: {
    sectionLengths: Record<string, number>;
    jsonParsed: boolean;
    fallbackLevel: number;
    generationTimeMs: number;
  };
  finalAssessment: {
    overallScore: number;
    scores: {
      formatting: number;
      completeness: number;
      sourceQuality: number;
      structure: number;
      languageConsistency: number;
    };
    grade: string;
    topIssues: Array<{
      category: string;
      description: string;
      severity: string;
      count: number;
    }>;
  };
}

/** 报告质量概览 */
export interface ReportQualitySummary {
  grade: string;
  overallScore: number;
  scores: Record<string, number>;
  topIssues: Array<{
    category: string;
    description: string;
    severity: string;
    count: number;
  }>;
  postProcessingFixes: number;
  pipelineVersion: string;
  dimensionCount: number;
  evidenceCount: number;
}

/**
 * 删除报告
 */
export async function deleteReport(
  topicId: string,
  reportId: string
): Promise<{ success: boolean; message: string }> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/reports/${reportId}`, {
    method: 'DELETE',
  });
}

/**
 * 导出任务响应类型
 */
export interface ExportJobResponse {
  jobId?: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress?: number;
  downloadUrl?: string;
  fileName?: string;
  fileSize?: number;
  error?: string;
}

/**
 * 导出报告 - 创建导出任务
 */
export async function exportReport(
  topicId: string,
  reportId: string,
  dto: ExportReportDto
): Promise<ExportJobResponse> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/export`,
    {
      method: 'POST',
      body: JSON.stringify(dto),
    }
  );
}

/**
 * 获取导出任务状态
 */
export async function getExportJobStatus(
  jobId: string
): Promise<ExportJobResponse> {
  return fetchWithAuth(`/api/v1/export/${jobId}`, {
    method: 'GET',
  });
}

/**
 * 等待导出完成并返回下载URL
 * 轮询直到任务完成或失败
 */
export async function waitForExportCompletion(
  topicId: string,
  reportId: string,
  dto: ExportReportDto,
  onProgress?: (progress: number) => void
): Promise<string> {
  // 1. 创建导出任务
  const initialResponse = await exportReport(topicId, reportId, dto);

  // 如果已经完成，直接返回
  if (initialResponse.status === 'COMPLETED' && initialResponse.downloadUrl) {
    return initialResponse.downloadUrl;
  }

  // 如果失败，抛出错误
  if (initialResponse.status === 'FAILED') {
    throw new Error(initialResponse.error || '导出失败');
  }

  // 没有 jobId，无法轮询
  if (!initialResponse.jobId) {
    throw new Error('导出任务创建失败');
  }

  // 2. 轮询等待完成
  const maxAttempts = 60; // 最多等待 60 秒
  const pollInterval = 1000; // 每秒轮询一次

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const status = await getExportJobStatus(initialResponse.jobId);
    onProgress?.(status.progress || 0);

    if (status.status === 'COMPLETED' && status.downloadUrl) {
      return status.downloadUrl;
    }

    if (status.status === 'FAILED') {
      throw new Error(status.error || '导出失败');
    }
  }

  throw new Error('导出超时，请稍后重试');
}

/**
 * 比较报告版本
 */
export async function compareReports(
  topicId: string,
  dto: CompareReportsDto
): Promise<ReportComparisonResult> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/reports/compare`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/**
 * 获取报告修订历史
 */
export interface ReportRevision {
  id: string;
  reportId: string;
  revisionNumber: number;
  content: string;
  changeDescription: string;
  editedBy: string;
  editOperation: string;
  createdAt: string;
}

export async function getReportRevisions(
  topicId: string,
  reportId: string
): Promise<ReportRevision[]> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/revisions`
  );
}

/**
 * 回滚报告到指定版本
 */
export interface RollbackReportResponse {
  report: TopicReport;
  rolledBackFrom: number;
  rolledBackTo: number;
}

export async function rollbackReport(
  topicId: string,
  reportId: string,
  revisionNumber: number
): Promise<RollbackReportResponse> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/rollback`,
    {
      method: 'POST',
      body: JSON.stringify({ revisionNumber }),
    }
  );
}

// ==================== Evidence ====================

/**
 * 获取证据列表
 */
export async function getEvidence(
  topicId: string,
  reportId: string,
  options?: ListEvidenceDto
): Promise<{ evidence: TopicEvidence[]; total: number; hasMore: boolean }> {
  const params = new URLSearchParams();
  if (options?.dimensionId) params.set('dimensionId', options.dimensionId);
  if (options?.sourceType) params.set('sourceType', options.sourceType);
  if (options?.minCredibility)
    params.set('minCredibility', options.minCredibility.toString());
  if (options?.sortBy) params.set('sortBy', options.sortBy);
  if (options?.pageSize) params.set('pageSize', options.pageSize.toString());
  if (options?.page) params.set('page', options.page.toString());

  const query = params.toString();
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/evidence${query ? `?${query}` : ''}`
  );
}

/**
 * 获取单个证据详情
 */
export async function getEvidenceDetail(
  topicId: string,
  reportId: string,
  evidenceId: string
): Promise<TopicEvidence> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/evidence/${evidenceId}`
  );
}

/**
 * ★ 重新计算证据可信度评分
 */
export async function recalculateCredibilityScores(
  topicId: string,
  reportId: string
): Promise<{ updated: number; avgScore: number }> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/evidence/recalculate-credibility`,
    { method: 'POST' }
  );
}

// ==================== Templates ====================

/**
 * 获取模板列表
 */
export async function getTemplates(
  type: ResearchTopicType
): Promise<ResearchTemplate[]> {
  const response = await fetchWithAuth(`${API_PREFIX}/templates?type=${type}`);
  // Backend returns { type, dimensions }, convert to template format
  if (Array.isArray(response)) {
    return response;
  }
  // If dimensions exist, create a single template from them
  if (response.dimensions && Array.isArray(response.dimensions)) {
    return [
      {
        id: `template-${response.type}`,
        name:
          response.type === 'MACRO'
            ? '宏观洞察模板'
            : response.type === 'TECHNOLOGY'
              ? '技术趋势模板'
              : '企业追踪模板',
        description: `${response.type} 类型的默认研究维度模板`,
        type: response.type,
        dimensions: response.dimensions,
      },
    ];
  }
  return [];
}

/**
 * 从模板创建专题
 */
export async function createFromTemplate(
  templateId: string,
  overrides?: Partial<CreateTopicDto>
): Promise<ResearchTopic> {
  return fetchWithAuth(`${API_PREFIX}/topics/from-template`, {
    method: 'POST',
    body: JSON.stringify({ templateId, ...overrides }),
  });
}

// ==================== Schedule ====================

/**
 * 获取刷新计划
 */
export async function getSchedule(topicId: string): Promise<TopicSchedule> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/schedule`);
}

/**
 * 更新刷新计划
 */
export async function updateSchedule(
  topicId: string,
  dto: UpdateScheduleDto
): Promise<TopicSchedule> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/schedule`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

// ==================== Logs ====================

/**
 * 获取刷新日志
 */
export async function getLogs(
  topicId: string,
  options?: ListLogsDto
): Promise<TopicRefreshLog[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.status) params.set('status', options.status);

  const query = params.toString();
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/logs${query ? `?${query}` : ''}`
  );
}

// ==================== Stats ====================

/**
 * 获取专题统计
 */
export async function getStats(topicId: string): Promise<TopicStats> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/stats`);
}

// ==================== Leader API ====================

/**
 * Leader 生成研究规划
 * @param mode - 'fresh' 全新开始（取消旧任务），'incremental' 增量更新（保留已完成任务）
 */
export async function leaderPlan(
  topicId: string,
  options?: {
    userPrompt?: string;
    userContext?: Record<string, unknown>;
    mode?: 'fresh' | 'incremental';
    researchDepth?: 'quick' | 'standard' | 'thorough';
  }
): Promise<ResearchMission> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/leader/plan`, {
    method: 'POST',
    body: JSON.stringify(options || {}),
  });
}

/**
 * 处理 @Leader 消息
 */
export async function sendLeaderMessage(
  topicId: string,
  content: string
): Promise<{ response: string; planAdjustments?: unknown }> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/leader/message`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

/**
 * 获取 Leader 决策历史
 */
export async function getLeaderDecisions(
  topicId: string
): Promise<LeaderDecision[]> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/leader/decisions`);
}

// ==================== Mission API ====================

/**
 * 获取当前 Mission 状态
 */
export async function getMission(
  topicId: string
): Promise<MissionStatus | null> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/mission`);
}

/**
 * 审批研究规划，从 PLAN_READY 转为 EXECUTING
 */
export async function approveMissionPlan(
  topicId: string
): Promise<{ success: boolean; message: string }> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/mission/approve-plan`, {
    method: 'POST',
  });
}

/**
 * 重试失败的任务
 */
export async function retryMission(
  topicId: string,
  taskIds?: string[]
): Promise<{ retriedTasks?: number } | ResearchMission> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/mission/retry`, {
    method: 'POST',
    body: JSON.stringify({ taskIds }),
  });
}

/**
 * 取消当前 Mission
 */
export async function cancelMission(
  topicId: string
): Promise<{ success: boolean }> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/mission/cancel`, {
    method: 'POST',
  });
}

/**
 * 获取研究团队信息
 */
export async function getTeam(topicId: string): Promise<TeamInfo> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/team`);
}

// ==================== Mission Types ====================

export interface ResearchMission {
  id: string;
  topicId: string;
  status: 'PLANNING' | 'EXECUTING' | 'REVIEWING' | 'COMPLETED' | 'FAILED';
  leaderModelId?: string;
  leaderModelName?: string;
  leaderPlan?: LeaderPlan;
  userPrompt?: string;
  totalTasks: number;
  completedTasks: number;
  progressPercent: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeaderPlan {
  taskUnderstanding: {
    topic: string;
    scope: string;
    objectives: string[];
    constraints?: string[];
  };
  dimensions: LeaderPlannedDimension[];
  executionStrategy: {
    parallelism: number;
    priorityOrder: string[];
    estimatedTime?: string;
  };
  agentAssignments: AgentAssignment[];
}

export interface LeaderPlannedDimension {
  id: string;
  name: string;
  description: string;
  searchQueries: string[];
  dataSources: string[];
  priority: number;
}

export interface AgentAssignment {
  agentId: string;
  agentType: 'dimension_researcher' | 'quality_reviewer' | 'report_writer';
  assignedDimensions?: string[];
  role: string;
}

export interface MissionStatus {
  id: string;
  /**
   * Mission status state machine:
   * - PLANNING: Leader 正在规划任务
   * - EXECUTING: 研究员正在执行任务
   * - REVIEWING: 审核员正在审核结果
   * - COMPLETED: 任务已完成（终止状态）
   * - FAILED: 任务失败（终止状态）
   * - CANCELLED: 任务被取消（终止状态）
   */
  status:
    | 'PLANNING'
    | 'EXECUTING'
    | 'REVIEWING'
    | 'COMPLETED'
    | 'FAILED'
    | 'CANCELLED';
  progress: number;
  totalTasks: number;
  completedTasks: number;
  currentPhase: string;
  tasks: TaskStatus[];
  leaderPlan?: LeaderPlan;
  researchDepth?: 'quick' | 'standard' | 'thorough';
  leaderModelId?: string;
  leaderModelName?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt?: string;
}

export interface TaskStatus {
  id: string;
  title: string;
  description?: string;
  taskType: string;
  dimensionName?: string;
  assignedAgent: string;
  /** ★ Agent 使用的 AI 模型 ID */
  modelId?: string;
  /** ★ 模型展示名称（用于前端显示和图标匹配） */
  modelDisplayName?: string;
  /**
   * Task status state machine:
   * - PENDING: 待分配
   * - ASSIGNED: 已分配给 Agent
   * - EXECUTING: 正在执行
   * - COMPLETED: 已完成（终止状态）
   * - NEEDS_REVISION: 需要修订（审核未通过）
   * - FAILED: 失败（终止状态）
   * - CANCELLED: 被取消（终止状态）
   */
  status:
    | 'PENDING'
    | 'ASSIGNED'
    | 'EXECUTING'
    | 'COMPLETED'
    | 'NEEDS_REVISION'
    | 'FAILED'
    | 'CANCELLED';
  reviewStatus?: string;
  progress?: number;
  /** 任务结果（包含成功数据或错误信息） */
  result?: {
    error?: string;
    sourcesFound?: number;
    wordCount?: number;
    keyFindings?: number;
    [key: string]: unknown;
  };
  /** 结果摘要 */
  resultSummary?: string;
  /** 开始时间 */
  startedAt?: string;
  /** 完成时间 */
  completedAt?: string;
  /** ★ 依赖的任务 ID 列表（用于可视化任务依赖关系） */
  dependencies?: string[];
}

export interface TeamInfo {
  leaderId: string | null;
  leaderModel: string | null;
  agents: AgentInfo[];
}

export interface AgentInfo {
  id: string;
  type: string;
  role: string;
  status: 'idle' | 'working' | 'completed' | 'failed';
  currentTask?: string;
  assignedDimensions?: string[];
  /** ★ Agent 使用的 AI 模型名称 */
  model?: string;
  /** ★ v8.0: Leader 分配给此 Agent 的技能 */
  skills?: string[];
  /** ★ v8.0: Leader 分配给此 Agent 的工具 */
  tools?: string[];
}

export interface LeaderDecision {
  id: string;
  missionId: string;
  type: 'PLAN' | 'REVIEW' | 'ADJUST' | 'INTERVENE';
  input: unknown;
  decision: unknown;
  reasoning: string;
  modelUsed?: string;
  latencyMs?: number;
  createdAt: string;
}

// ==================== Team Messages & Agent Activities ====================

/**
 * 团队互动消息
 */
export interface TeamMessage {
  id: string;
  topicId: string;
  missionId?: string;
  messageType:
    | 'LEADER_RESPONSE'
    | 'USER_MESSAGE'
    | 'SYSTEM_MESSAGE'
    | 'AGENT_REPORT';
  senderRole: 'leader' | 'user' | 'system';
  senderName: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/**
 * 搜索结果记录（用于工具使用透明度展示）
 */
export interface SearchResultsRecord {
  total: number;
  filtered: number;
  searchTool?: string;
  query?: string;
  searchedAt?: string;
  freshnessInfo?: {
    newestDate?: string;
    oldestDate?: string;
    avgAgeInDays?: number;
  };
  knowledgeBaseInfo?: {
    enabled: boolean;
    knowledgeBaseIds?: string[];
    matchedCount: number;
    avgSimilarity?: number;
  };
  sources?: Array<{
    title: string;
    url: string;
    domain?: string;
    sourceType?: string;
    credibilityScore?: number;
    relevanceScore?: number;
    publishedDate?: string;
    isKnowledgeBase?: boolean;
    similarity?: number;
    documentId?: string;
  }>;
}

/**
 * Agent 活动记录
 */
export interface AgentActivity {
  id: string;
  topicId: string;
  missionId?: string;
  agentId?: string;
  agentName: string;
  agentRole: 'leader' | 'researcher' | 'reviewer' | 'synthesizer';
  activityType:
    | 'THINKING'
    | 'PLANNING'
    | 'RESEARCHING'
    | 'WRITING'
    | 'REVIEWING'
    | 'COMPLETED'
    | 'FAILED';
  phase?: string;
  content: string;
  progress?: number;
  dimensionId?: string;
  dimensionName?: string;
  // ★ v8.1: 思考链增强字段（直接从数据库返回）
  thinkingPhase?: string;
  thinkingContent?: string;
  searchResults?: SearchResultsRecord; // ★ 搜索结果（顶层字段）
  actionTaken?: string; // ★ 审核动作（dimension_review / overall_review）
  actionResult?: Record<string, unknown>; // ★ 审核结果详情
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/**
 * 获取团队互动消息
 */
export async function getTeamMessages(
  topicId: string,
  options?: { limit?: number; missionId?: string }
): Promise<TeamMessage[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.append('limit', options.limit.toString());
  if (options?.missionId) params.append('missionId', options.missionId);

  const queryString = params.toString();
  const url = `${API_PREFIX}/topics/${topicId}/team-messages${queryString ? `?${queryString}` : ''}`;
  return fetchWithAuth(url);
}

/**
 * 获取 Agent 活动记录
 */
export async function getAgentActivities(
  topicId: string,
  options?: { limit?: number; missionId?: string; agentRole?: string }
): Promise<AgentActivity[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.append('limit', options.limit.toString());
  if (options?.missionId) params.append('missionId', options.missionId);
  if (options?.agentRole) params.append('agentRole', options.agentRole);

  const queryString = params.toString();
  const url = `${API_PREFIX}/topics/${topicId}/agent-activities${queryString ? `?${queryString}` : ''}`;
  return fetchWithAuth(url);
}

// ==================== Leader Chat (Claude Code CLI 风格) ====================

/**
 * Leader 解码决策类型
 */
export type LeaderDecisionType =
  | 'DIRECT_ANSWER'
  | 'CREATE_TODO'
  | 'CLARIFY'
  | 'ACKNOWLEDGE';

/**
 * Leader 解码响应
 */
export interface LeaderChatResponse {
  decisionType: LeaderDecisionType;
  understanding: string;
  response: string;
  todo?: {
    id: string;
    title: string;
    /** ★ v7.2: Leader 分配的 Agent 名称 */
    assignedAgent?: string;
  };
  clarifyQuestion?: string;
  clarifyOptions?: string[];
}

/**
 * ★ Leader 解码用户输入（Claude Code CLI 风格）
 * 先理解用户意图，再决定如何响应
 */
export async function leaderChat(
  topicId: string,
  message: string,
  missionId?: string
): Promise<LeaderChatResponse> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/leader/chat`, {
    method: 'POST',
    body: JSON.stringify({ message, missionId }),
  });
}

// ==================== Credibility Report (Phase 2) ====================

/**
 * AI 评审维度
 */
export interface EvaluationDimension {
  id: string;
  name: string;
  nameEn: string;
  weight: number;
  score?: number;
  comment?: string;
}

/**
 * 补救过程追踪
 */
export interface RemediationTrace {
  sectionTitle: string;
  originalModel: string;
  remediationModel?: string;
  selfEvalScores: Record<string, number>;
  actions: Array<{
    type: string;
    dimension: string;
    scoreBefore: number;
    guidance: string;
  }>;
  wasRemediated: boolean;
  skippedReason?: string;
}

/**
 * 单章节评审结果
 */
export interface ChapterEvaluation {
  chapterId: string;
  chapterTitle: string;
  writerModel: string;
  dimensions: EvaluationDimension[];
  chapterScore: number;
  grade: string;
  feedback: string;
  remediationTraces?: RemediationTrace[];
}

/**
 * 模型对比条目
 */
export interface ModelComparisonEntry {
  modelId: string;
  chapterCount: number;
  avgScore: number;
  bestDimension: string;
  weakestDimension: string;
}

/**
 * AI 评审结果（按章节）
 */
export interface AIEvaluation {
  chapters: ChapterEvaluation[];
  overallScore: number;
  grade: string;
  feedback: string;
  modelComparison: ModelComparisonEntry[];
  evaluatorModel: string;
  evaluatedAt: string;
}

/**
 * 可信度报告数据
 */
export interface CredibilityReportData {
  overallScore: number;
  authorityScore: number;
  diversityScore: number;
  timelinessScore: number;
  coverageScore: number;
  sourceBreakdown: {
    government: number;
    academic: number;
    industry: number;
    news: number;
    blog: number;
    other: number;
    total: number;
  };
  timeBreakdown: {
    within1Month: number;
    within3Months: number;
    within6Months: number;
    within1Year: number;
    older: number;
    unknown: number;
    total: number;
  };
  coverageDetails: Array<{
    dimensionId: string;
    dimensionName: string;
    sourceCount: number;
    targetCount: number;
    status: 'excellent' | 'good' | 'fair' | 'poor';
    coveragePercent: number;
  }>;
  aiQualityMetrics: {
    planningRounds: number;
    revisionAverage: number;
    approvalRate: number;
    averageConfidence: string;
    totalAgentActivities: number;
  };
  limitations: string[];
  // AI 评审结果（新增字段，旧报告可能没有）
  aiEvaluation?: AIEvaluation;
  // 综合评分（来源 ×0.4 + AI评审 ×0.6）
  combinedScore?: number;
  // 综合等级
  combinedGrade?: string;
  // 摘要文本
  summaryText?: string;
}

/**
 * 获取报告的可信度评估
 */
export async function getCredibilityReport(
  topicId: string,
  reportId: string
): Promise<CredibilityReportData> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/credibility`
  );
}

/**
 * 重新生成可信度报告
 */
export async function regenerateCredibilityReport(
  topicId: string,
  reportId: string
): Promise<CredibilityReportData> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/credibility/regenerate`,
    { method: 'POST' }
  );
}

/**
 * 重新合成报告内容
 * 用于修复已保存报告中的格式问题
 */
export async function regenerateReportContent(
  topicId: string,
  reportId: string,
  feedback?: string
): Promise<{ success: boolean; report: TopicReport }> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/regenerate`,
    {
      method: 'POST',
      body: JSON.stringify(feedback ? { feedback } : {}),
    }
  );
}

// ==================== Research History (Phase 2.3) ====================

/**
 * 研究历史记录
 */
// 维度研究结果
export interface DimensionResult {
  dimensionName: string;
  result?: {
    summary?: string;
    keyFindings?: Array<{ finding: string; significance?: string }> | number;
    sourcesFound?: number;
    wordCount?: number;
    [key: string]: unknown;
  };
  resultSummary?: string;
}

export interface ResearchHistoryItem {
  id: string;
  topicId: string;
  missionId: string;
  researchNumber: number;
  startedAt: string;
  completedAt?: string;
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'IN_PROGRESS';
  researchGoal?: string;
  researchStrategy?: string;
  dimensionsUpdated: string[];
  dimensionsKept: string[];
  wordsAdded: number;
  wordsRemoved: number;
  newSourcesCount: number;
  totalDurationMs?: number;
  reportVersionBefore?: number;
  reportVersionAfter?: number;
  // ★ 每个维度的研究结果
  dimensionResults?: DimensionResult[];
  // ★ 扩展元数据（用于显示）
  _metadata?: {
    completedTasks: number;
    totalTasks: number;
    title: string;
  };
}

/**
 * 后端返回的研究历史响应格式
 */
interface ResearchHistoryResponse {
  timeline: Array<{
    id: string;
    type: 'mission' | 'report';
    timestamp: string;
    title: string;
    description: string;
    status?: string;
    metadata?: Record<string, unknown>;
  }>;
  totalMissions: number;
  totalReports: number;
}

/**
 * 获取研究历史时间线
 * 注意：后端返回的是 { timeline, totalMissions, totalReports } 对象
 * 需要转换为前端期望的 ResearchHistoryItem[] 格式
 */
export async function getResearchHistory(
  topicId: string,
  limit?: number
): Promise<ResearchHistoryItem[]> {
  const params = new URLSearchParams();
  if (limit) params.append('limit', limit.toString());
  const queryString = params.toString();

  const response = await fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/research-history${queryString ? `?${queryString}` : ''}`
  );

  // ★ 安全处理：后端返回对象，需要提取 timeline 数组并转换格式
  if (!response) return [];

  // 如果直接返回了数组（兼容可能的后端变更）
  if (Array.isArray(response)) {
    return response;
  }

  // 后端返回 { timeline, totalMissions, totalReports } 格式
  const data = response as ResearchHistoryResponse;
  if (!data.timeline || !Array.isArray(data.timeline)) {
    return [];
  }

  // 转换 timeline 项为 ResearchHistoryItem 格式
  // 注意：后端的 timeline 格式和前端 ResearchHistoryItem 不完全匹配
  // 这里做最佳努力转换
  let researchNumber = data.timeline.filter((t) => t.type === 'mission').length;

  // ★ 后端状态映射到前端状态
  // 后端: PLANNING, EXECUTING, REVIEWING, COMPLETED, FAILED, CANCELLED
  // 前端: COMPLETED, FAILED, CANCELLED, IN_PROGRESS
  const mapStatus = (
    backendStatus: string | undefined
  ): ResearchHistoryItem['status'] => {
    if (!backendStatus) return 'COMPLETED'; // 默认已完成
    const statusUpper = backendStatus.toUpperCase();
    switch (statusUpper) {
      case 'COMPLETED':
        return 'COMPLETED';
      case 'FAILED':
        return 'FAILED';
      case 'CANCELLED':
        return 'CANCELLED';
      case 'PLANNING':
      case 'EXECUTING':
      case 'REVIEWING':
      case 'IN_PROGRESS':
        return 'IN_PROGRESS';
      default:
        // 其他状态默认为进行中
        return 'IN_PROGRESS';
    }
  };

  return data.timeline
    .filter((item) => item.type === 'mission') // 只保留 mission 类型
    .map((item) => {
      const metadata = item.metadata || {};
      // ★ 从 metadata 中提取 dimensionsUpdated（后端现在会返回）
      const dimensionsUpdated = Array.isArray(metadata.dimensionsUpdated)
        ? (metadata.dimensionsUpdated as string[])
        : [];
      // ★ 提取更多有用信息
      const completedTasks = (metadata.completedTasks as number) || 0;
      const totalTasks = (metadata.totalTasks as number) || 0;
      // ★ 提取每个维度的研究结果（关键发现、摘要等）
      const dimensionResults = Array.isArray(metadata.dimensionResults)
        ? (metadata.dimensionResults as DimensionResult[])
        : [];

      return {
        id: item.id,
        topicId: topicId,
        missionId: item.id,
        researchNumber: researchNumber--, // 逆序编号
        startedAt: item.timestamp,
        completedAt: (metadata.completedAt as string) || undefined,
        status: mapStatus(item.status), // ★ 使用状态映射
        researchGoal: item.description || undefined, // 使用 description 作为目标摘要
        researchStrategy: undefined,
        dimensionsUpdated, // ★ 使用从 metadata 提取的数据
        dimensionsKept: [],
        wordsAdded: 0,
        wordsRemoved: 0,
        newSourcesCount: completedTasks, // ★ 使用已完成任务数作为近似来源数
        totalDurationMs: undefined,
        reportVersionBefore: undefined,
        reportVersionAfter: undefined,
        dimensionResults, // ★ 每个维度的研究结果
        // ★ 扩展字段供显示使用
        _metadata: {
          completedTasks,
          totalTasks,
          title: item.title,
        },
      };
    });
}

// ==================== Review Workflow (Phase 3.3) ====================

/**
 * 审核任务
 */
export interface ReviewTask {
  id: string;
  reportId: string;
  sectionId?: string;
  sectionName: string;
  sectionOrder: number;
  assigneeId?: string;
  assigneeName?: string;
  assignedById?: string;
  assignedAt?: string;
  dueAt?: string;
  completedAt?: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
  approved?: boolean;
  score?: number;
  comments?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 审核任务统计
 */
export interface ReviewTaskStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  approved: number;
  rejected: number;
  averageScore: number | null;
}

/**
 * 获取报告的审核任务列表
 */
export async function getReviewTasks(
  topicId: string,
  reportId: string
): Promise<ReviewTask[]> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/review-tasks`
  );
}

/**
 * 创建审核任务
 */
export async function createReviewTasks(
  topicId: string,
  reportId: string
): Promise<{
  created: number;
  tasks: Array<{ id: string; sectionName: string }>;
}> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/review-tasks`,
    { method: 'POST' }
  );
}

/**
 * 分配审核任务
 */
export async function assignReviewTask(
  topicId: string,
  reportId: string,
  taskId: string,
  assigneeId: string,
  assigneeName: string
): Promise<ReviewTask> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/review-tasks/${taskId}/assign`,
    {
      method: 'PATCH',
      body: JSON.stringify({ assigneeId, assigneeName }),
    }
  );
}

/**
 * 完成审核任务
 */
export async function completeReviewTask(
  topicId: string,
  reportId: string,
  taskId: string,
  approved: boolean,
  comments?: string,
  score?: number
): Promise<ReviewTask> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/review-tasks/${taskId}/complete`,
    {
      method: 'PATCH',
      body: JSON.stringify({ approved, comments, score }),
    }
  );
}

/**
 * 获取审核任务统计
 */
export async function getReviewTaskStats(
  topicId: string,
  reportId: string
): Promise<ReviewTaskStats> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/review-tasks/stats`
  );
}

/**
 * 检查报告是否可发布
 */
export async function canPublishReport(
  topicId: string,
  reportId: string
): Promise<{
  canPublish: boolean;
  reason?: string;
  pendingTasks: number;
  rejectedTasks: number;
}> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/review-tasks/can-publish`
  );
}

// ==================== TODO API ====================

import { logger } from '@/lib/utils/logger';
import type {
  ResearchTodo,
  TodoListResponse,
  ResearchTodoStatus,
  ResearchTodoType,
} from '@/lib/types/topic-insights';

/**
 * 获取 TODO 列表
 */
export async function getTodos(
  topicId: string,
  options?: {
    missionId?: string;
    status?: ResearchTodoStatus[];
    type?: ResearchTodoType[];
  }
): Promise<TodoListResponse> {
  const params = new URLSearchParams();
  if (options?.missionId) params.append('missionId', options.missionId);
  if (options?.status?.length) {
    options.status.forEach((s) => params.append('status', s));
  }
  if (options?.type?.length) {
    options.type.forEach((t) => params.append('type', t));
  }

  const queryString = params.toString();
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/todos${queryString ? `?${queryString}` : ''}`
  );
}

/**
 * 获取单个 TODO
 */
export async function getTodoById(
  topicId: string,
  todoId: string
): Promise<ResearchTodo> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/todos/${todoId}`);
}

/**
 * 获取 TODO 详情（包含 Agent 活动）
 */
export async function getTodoDetails(
  topicId: string,
  todoId: string
): Promise<{ todo: ResearchTodo; activities: AgentActivity[] }> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/todos/${todoId}/details`
  );
}

/**
 * ★ 获取任务（ResearchTask）相关的活动记录
 * 用于 missionStatus.tasks 转换的任务
 */
export async function getTaskActivities(
  topicId: string,
  taskId: string
): Promise<{ task: Record<string, unknown>; activities: AgentActivity[] }> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/tasks/${taskId}/activities`
  );
}

/**
 * 暂停 TODO
 */
export async function pauseTodo(
  topicId: string,
  todoId: string
): Promise<{ success: boolean; todo: ResearchTodo }> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/todos/${todoId}/pause`,
    { method: 'POST' }
  );
}

/**
 * 恢复 TODO
 */
export async function resumeTodo(
  topicId: string,
  todoId: string
): Promise<{ success: boolean; todo: ResearchTodo }> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/todos/${todoId}/resume`,
    { method: 'POST' }
  );
}

/**
 * 取消 TODO
 */
export async function cancelTodo(
  topicId: string,
  todoId: string,
  reason?: string
): Promise<{ success: boolean; todo: ResearchTodo }> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/todos/${todoId}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }
  );
}

/**
 * 重试 TODO
 */
export async function retryTodo(
  topicId: string,
  todoId: string
): Promise<{ success: boolean; todo: ResearchTodo }> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/todos/${todoId}/retry`,
    { method: 'POST' }
  );
}

/**
 * ★ 执行用户请求的 TODO
 * 用户确认后执行 TODO 任务（如新增维度、深入研究等）
 */
export async function executeTodo(
  topicId: string,
  todoId: string
): Promise<{ success: boolean; todo: ResearchTodo; message: string }> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/todos/${todoId}/execute`,
    { method: 'POST' }
  );
}

/**
 * 调整 TODO 优先级
 */
export async function prioritizeTodo(
  topicId: string,
  todoId: string,
  priority: 'high' | 'normal' | 'low'
): Promise<{ success: boolean; todo: ResearchTodo }> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/todos/${todoId}/priority`,
    {
      method: 'PATCH',
      body: JSON.stringify({ priority }),
    }
  );
}

/**
 * ★ 更新 TODO（编辑标题和描述）
 */
export async function updateTodo(
  topicId: string,
  todoId: string,
  data: { title?: string; description?: string }
): Promise<{ success: boolean; todo: ResearchTodo }> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/todos/${todoId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * ★ 删除 TODO
 */
export async function deleteTodo(
  topicId: string,
  todoId: string
): Promise<{ success: boolean }> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/todos/${todoId}`, {
    method: 'DELETE',
  });
}

/**
 * 创建用户请求 TODO
 */
export async function createUserRequestTodo(
  topicId: string,
  missionId: string,
  title: string,
  description?: string
): Promise<{ success: boolean; todo: ResearchTodo }> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/missions/${missionId}/todos`,
    {
      method: 'POST',
      body: JSON.stringify({ title, description }),
    }
  );
}

/**
 * ★ 重新计算专题统计数据
 * 用于修复历史数据中 totalReports/totalSources/lastRefreshAt 不正确的问题
 */
export async function recalculateTopicStats(
  topicId: string
): Promise<ResearchTopic> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/recalculate-stats`, {
    method: 'POST',
  });
}

// ==================== Topic Visibility ====================

/**
 * 专题可见性类型
 */
export type TopicVisibility = 'PRIVATE' | 'SHARED' | 'PUBLIC';

/**
 * 更新专题可见性
 */
export async function updateTopicVisibility(
  topicId: string,
  visibility: TopicVisibility
): Promise<{ success: boolean; visibility: TopicVisibility }> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/visibility`, {
    method: 'PATCH',
    body: JSON.stringify({ visibility }),
  });
}

// ==================== Public Shared Access (No Auth Required) ====================

/**
 * 获取公开的专题详情（无需认证）
 * ★ 修复：正确提取 data 字段
 */
export async function getSharedTopic(topicId: string): Promise<ResearchTopic> {
  const response = await fetch(
    `${API_BASE}${API_PREFIX}/shared/topics/${topicId}`
  );
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: 'Failed to fetch shared topic' }));
    throw new Error(error.message || 'Failed to fetch shared topic');
  }
  const json = await response.json();
  // API 返回 {success: true, data: {...}}，需要提取 data
  return json.data || json;
}

/**
 * 获取公开专题的最新报告（无需认证）
 * ★ 修复：正确提取 data 字段
 */
export async function getSharedTopicLatestReport(
  topicId: string
): Promise<TopicReport> {
  const response = await fetch(
    `${API_BASE}${API_PREFIX}/shared/topics/${topicId}/reports/latest`
  );
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: 'Failed to fetch shared report' }));
    throw new Error(error.message || 'Failed to fetch shared report');
  }
  const json = await response.json();
  // API 返回 {success: true, data: {...}}，需要提取 data
  return json.data || json;
}

// ==================== Report Annotations ====================

/**
 * 批注类型枚举
 */
export type AnnotationType = 'COMMENT' | 'SUGGESTION' | 'ISSUE' | 'REFERENCE';

/**
 * 批注状态枚举
 */
export type AnnotationStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';

/**
 * 报告批注数据结构
 */
export interface ReportAnnotation {
  id: string;
  reportId: string;
  content: string;
  type: AnnotationType;
  selectedText?: string;
  startOffset: number;
  endOffset: number;
  selectorPrefix?: string;
  selectorSuffix?: string;
  color?: string;
  status: AnnotationStatus;
  createdById: string;
  resolvedById?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: {
    id: string;
    username?: string;
    fullName?: string;
    avatarUrl?: string;
  };
  resolvedBy?: {
    id: string;
    username?: string;
    fullName?: string;
  };
}

/**
 * 创建批注 DTO
 * Note: selectorPrefix, selectorSuffix, color fields are for future use
 * Backend currently doesn't support them - they're stored locally only
 */
export interface CreateAnnotationDto {
  content: string;
  type: AnnotationType;
  selectedText?: string;
  startOffset: number;
  endOffset: number;
  // Future fields (not yet in database):
  // selectorPrefix?: string;
  // selectorSuffix?: string;
  // color?: string;
}

/**
 * 更新批注 DTO
 */
export interface UpdateAnnotationDto {
  content?: string;
  status?: AnnotationStatus;
}

/**
 * 获取报告的所有批注
 */
export async function getAnnotations(
  topicId: string,
  reportId: string,
  status?: AnnotationStatus
): Promise<ReportAnnotation[]> {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  const queryString = params.toString();
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/annotations${queryString ? `?${queryString}` : ''}`
  );
}

/**
 * 创建批注
 */
export async function createAnnotation(
  topicId: string,
  reportId: string,
  dto: CreateAnnotationDto
): Promise<ReportAnnotation> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/annotations`,
    {
      method: 'POST',
      body: JSON.stringify(dto),
    }
  );
}

/**
 * 更新批注
 */
export async function updateAnnotation(
  topicId: string,
  reportId: string,
  annotationId: string,
  dto: UpdateAnnotationDto
): Promise<ReportAnnotation> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/annotations/${annotationId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }
  );
}

/**
 * 删除批注
 */
export async function deleteAnnotation(
  topicId: string,
  reportId: string,
  annotationId: string
): Promise<{ success: boolean }> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/annotations/${annotationId}`,
    {
      method: 'DELETE',
    }
  );
}

/**
 * 解决批注
 */
export async function resolveAnnotation(
  topicId: string,
  reportId: string,
  annotationId: string
): Promise<ReportAnnotation> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/annotations/${annotationId}/resolve`,
    {
      method: 'POST',
    }
  );
}

/**
 * 批量解决批注
 */
export async function resolveAllAnnotations(
  topicId: string,
  reportId: string,
  annotationIds?: string[]
): Promise<number> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/annotations/resolve-all`,
    {
      method: 'POST',
      body: JSON.stringify({ annotationIds }),
    }
  );
}

/**
 * 获取批注统计
 */
export async function getAnnotationStats(
  topicId: string,
  reportId: string
): Promise<{
  total: number;
  byStatus: {
    open: number;
    resolved: number;
    dismissed: number;
  };
  byType: {
    comment: number;
    suggestion: number;
    issue: number;
    reference: number;
  };
}> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/annotations/stats`
  );
}

// ==================== AI Edit Report ====================

/**
 * AI 编辑操作类型
 */
export type AIEditOperation =
  | 'rewrite'
  | 'polish'
  | 'expand'
  | 'compress'
  | 'style';

/**
 * AI 编辑请求 DTO
 */
export interface AIEditReportDto {
  operation: AIEditOperation;
  selectedText?: string;
  fullContent?: string;
  context?: string;
  styleGuide?: string;
  /** Context before selection for reliable matching */
  selectorPrefix?: string;
  /** Context after selection for reliable matching */
  selectorSuffix?: string;
}

/**
 * AI 编辑响应
 */
export interface AIEditReportResponse {
  success: boolean;
  editedContent: string;
  operation: AIEditOperation;
  originalText?: string;
  changeDescription?: string;
}

/**
 * AI 编辑报告
 */
export async function aiEditReport(
  topicId: string,
  reportId: string,
  dto: AIEditReportDto
): Promise<AIEditReportResponse> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/reports/${reportId}/ai-edit`,
    {
      method: 'POST',
      body: JSON.stringify(dto),
    }
  );
}

// ==================== Collaborators ====================

/**
 * 协作者角色
 */
export type CollaboratorRole = 'VIEWER' | 'EDITOR' | 'ADMIN';

/**
 * 协作者申请状态
 */
export type CollaboratorStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

/**
 * 协作者信息
 */
export interface Collaborator {
  id: string;
  userId: string;
  email: string;
  username?: string;
  avatarUrl?: string;
  role: CollaboratorRole;
  status: CollaboratorStatus;
  invitedAt: string;
  requestedAt?: string;
  acceptedAt?: string;
  reviewedAt?: string;
  rejectReason?: string;
  isActive: boolean;
}

/**
 * 申请状态响应
 */
export interface ApplicationStatusResponse {
  status: CollaboratorStatus | null;
  requestedAt?: string;
  rejectReason?: string;
}

/**
 * 协作者列表响应
 */
export interface CollaboratorsResponse {
  topicId: string;
  owner: {
    id: string;
    email: string;
    username?: string;
    avatarUrl?: string;
  };
  collaborators: Collaborator[];
  totalCount: number;
}

/**
 * 获取专题的协作者列表
 */
export async function getCollaborators(
  topicId: string
): Promise<CollaboratorsResponse> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/collaborators`);
}

/**
 * 检查当前用户是否有编辑权限
 * @returns 如果是所有者或 EDITOR/ADMIN 协作者返回 true
 */
export async function checkEditPermission(
  topicId: string,
  currentUserId: string
): Promise<boolean> {
  try {
    const data = await getCollaborators(topicId);
    // 所有者有编辑权限
    if (data.owner.id === currentUserId) {
      return true;
    }
    // 检查是否是 EDITOR 或 ADMIN 协作者
    const userCollaborator = data.collaborators.find(
      (c) => c.userId === currentUserId && c.isActive
    );
    if (
      userCollaborator &&
      ['EDITOR', 'ADMIN'].includes(userCollaborator.role)
    ) {
      return true;
    }
    return false;
  } catch {
    // 如果无法获取协作者信息，默认无权限
    return false;
  }
}

// ==================== 申请审核机制 ====================

/**
 * 申请加入专题
 */
export async function applyToJoin(
  topicId: string,
  message?: string
): Promise<Collaborator> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/apply`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

/**
 * 获取待审核的申请列表
 */
export async function getPendingApplications(
  topicId: string
): Promise<Collaborator[]> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/applications`);
}

/**
 * 审核申请
 */
export async function reviewApplication(
  topicId: string,
  applicationId: string,
  decision: 'ACCEPTED' | 'REJECTED',
  reason?: string
): Promise<Collaborator> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/applications/${applicationId}/review`,
    {
      method: 'POST',
      body: JSON.stringify({ decision, reason }),
    }
  );
}

/**
 * 获取当前用户的申请状态
 */
export async function getMyApplicationStatus(
  topicId: string
): Promise<ApplicationStatusResponse> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/my-application`);
}

// ==================== Health Check API ====================

/**
 * Mission 健康状态
 */
export interface MissionHealthStatus {
  missionId: string;
  isHealthy: boolean;
  status: string;
  progress: number;
  startedAt: string | null;
  lastActivityAt: string | null;
  stuckDurationMs: number;
  estimatedRecoveryPossible: boolean;
  issues: string[];
}

/**
 * 可恢复的 Mission 信息
 */
export interface ResumableMissionInfo {
  missionId: string;
  topicId: string;
  topicName: string;
  status: string;
  progress: number;
  completedTasks: number;
  totalTasks: number;
  lastActivityAt: string;
  canResume: boolean;
  resumeReason: string;
}

/**
 * 获取专题当前 Mission 的健康状态
 */
export async function getMissionHealth(
  topicId: string
): Promise<{ health: MissionHealthStatus | null; message?: string }> {
  return fetchWithAuth(`${API_PREFIX}/topics/${topicId}/health`);
}

/**
 * 获取指定 Mission 的健康状态
 */
export async function getMissionHealthById(
  topicId: string,
  missionId: string
): Promise<{ health: MissionHealthStatus }> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/missions/${missionId}/health`
  );
}

/**
 * 检查 Mission 是否可恢复
 */
export async function canResumeMission(
  topicId: string,
  missionId: string
): Promise<{ canResume: boolean; reason: string }> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/missions/${missionId}/can-resume`
  );
}

/**
 * 恢复失败的 Mission
 */
export async function resumeMission(
  topicId: string,
  missionId: string
): Promise<{ success: boolean; message: string }> {
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/missions/${missionId}/resume`,
    {
      method: 'POST',
    }
  );
}

/**
 * 获取所有可恢复的 Mission 列表
 */
export async function getResumableMissions(): Promise<{
  missions: ResumableMissionInfo[];
}> {
  return fetchWithAuth(`${API_PREFIX}/resumable-missions`);
}

/**
 * 获取专题的算力消耗统计
 */
export async function getComputeUsage(
  topicId: string,
  missionId?: string
): Promise<unknown> {
  const params = missionId ? `?missionId=${missionId}` : '';
  return fetchWithAuth(
    `${API_PREFIX}/topics/${topicId}/compute-usage${params}`
  );
}
