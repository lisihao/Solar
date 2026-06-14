/**
 * AI Social API Client
 *
 * API client for social media content publishing (WeChat MP, Xiaohongshu)
 * Uses the same pattern as AI Writing:
 * - fetchWithAuth for authentication
 * - Relative URLs for Next.js proxy
 */

import { getAuthTokens } from '@/lib/utils/auth';

import { logger } from '@/lib/utils/logger';
// ==================== Types ====================

export type SocialPlatformType = 'WECHAT_MP' | 'XIAOHONGSHU';

export type SocialContentType = 'WECHAT_ARTICLE' | 'XIAOHONGSHU_NOTE';

export type SocialContentStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED';

export type SocialContentSourceType =
  | 'MANUAL'
  | 'EXTERNAL_URL'
  | 'AI_EXPLORE'
  | 'AI_RESEARCH'
  | 'AI_OFFICE'
  | 'AI_WRITING'
  | 'AI_TOPIC_INSIGHTS';

export type SocialReviewStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'REVISION_REQUESTED';

export interface SocialPlatformConnection {
  id: string;
  userId: string;
  platformType: SocialPlatformType;
  accountName: string | null;
  accountId: string | null;
  avatarUrl: string | null;
  sessionData: string | null;
  isActive: boolean;
  lastCheckAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SocialContent {
  id: string;
  userId: string;
  connectionId: string | null;
  contentType: SocialContentType;
  sourceType: SocialContentSourceType;
  sourceId: string | null;
  sourceUrl: string | null;
  title: string;
  content: string;
  author: string | null;
  digest: string | null;
  coverImageUrl: string | null;
  images: string[];
  tags: string[];
  location: string | null;
  status: SocialContentStatus;
  aiProcessLog: Record<string, unknown> | null;
  aiSuggestions: Record<string, unknown> | null;
  reviewStatus: SocialReviewStatus | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  complianceCheck: Record<string, unknown> | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  autoPublish: boolean;
  externalId: string | null;
  externalUrl: string | null;
  errorMessage: string | null;
  retryCount: number;
  seriesId?: string | null;
  seriesOrder?: number | null;
  createdAt: string;
  updatedAt: string;
  connection?: SocialPlatformConnection;
}

export interface SeriesPartSummary {
  id: string;
  title: string;
  content: string;
  digest: string | null;
  seriesOrder: number;
  status: SocialContentStatus;
  coverImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SocialPublishLog {
  id: string;
  contentId: string;
  action: string;
  status: string;
  details: Record<string, unknown> | null;
  errorMessage: string | null;
  screenshotUrl: string | null;
  createdAt: string;
}

export interface ComplianceCheckResult {
  passed: boolean;
  issues: Array<{
    type: string;
    message: string;
    severity: 'warning' | 'error';
  }>;
  checkedAt: string;
}

// ==================== DTOs ====================

export interface CreateContentDto {
  contentType: SocialContentType;
  sourceType?: SocialContentSourceType;
  sourceId?: string;
  sourceUrl?: string;
  title: string;
  content: string;
  digest?: string;
  coverImageUrl?: string;
  images?: string[];
  tags?: string[];
  connectionId?: string;
  scheduledAt?: string;
}

export interface UpdateContentDto {
  title?: string;
  content?: string;
  digest?: string;
  coverImageUrl?: string;
  images?: string[];
  tags?: string[];
  connectionId?: string;
  scheduledAt?: string;
}

export interface ProcessUrlDto {
  url: string;
  targetType: SocialContentType;
  additionalInstructions?: string;
}

export interface ProcessSourceDto {
  sourceType: SocialContentSourceType;
  sourceId: string;
  targetType: SocialContentType;
  additionalInstructions?: string;
  keepFormat?: boolean;
}

export interface PublishContentDto {
  connectionId: string;
  scheduledAt?: string;
}

export interface PlatformConfigDto {
  cookies?: string;
  sessionData?: Record<string, unknown>;
}

// ==================== API Base ====================

class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchWithAuth<T>(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<T> {
  const tokens = getAuthTokens();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (tokens?.accessToken) {
    (headers as Record<string, string>)['Authorization'] =
      `Bearer ${tokens.accessToken}`;
  }

  // Use AbortController for timeout (default 90s for AI operations)
  const timeout = options.timeout ?? 90000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorText = await response.text();
        if (errorText) {
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.message || errorJson.error || errorMessage;
          } catch {
            // 如果不是 JSON，可能是 HTML 错误页面
            errorMessage =
              response.status === 502 || response.status === 503
                ? 'Service temporarily unavailable, please try again later'
                : response.status === 504
                  ? 'Request timed out, please try again later'
                  : `Server error (${response.status})`;
          }
        }
      } catch {
        errorMessage = 'Network request failed';
      }
      throw new ApiError(errorMessage, response.status);
    }

    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      logger.error('Failed to parse API response:', text.substring(0, 200));
      throw new ApiError('Invalid server response format', response.status);
    }

    // Unwrap { success, data } format if present
    if (
      data &&
      typeof data === 'object' &&
      'success' in data &&
      'data' in data
    ) {
      return (data as { data: T }).data;
    }

    return data as T;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(
        'Request timed out, AI is generating content, please try again later',
        408
      );
    }
    throw error;
  }
}

// ==================== B7-3: canonical mission detail view ====================
//
// thinning plan §B7-3 / §B2-3 sibling-route semantics。mirror playground 的
// MissionDetailView shape — 后端 SocialDomainView 暴露相同的 base + social 字段。

export type SocialViewStatus =
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'quality-failed';

export type SocialViewStageStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped';

export type SocialViewAgentPhase =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

export type SocialViewRefreshFamily =
  | 'mission'
  | 'stages'
  | 'agents'
  | 'artifact'
  | 'todo'
  | 'cost'
  | 'memory';

export interface SocialViewRefreshHint {
  family: SocialViewRefreshFamily;
  mode: 'refetch' | 'patch';
  id?: string;
}

export interface SocialMissionDetailView {
  mission: {
    id: string;
    title?: string;
    status: SocialViewStatus;
    startedAt?: string;
    finishedAt?: string;
    finalScore?: number;
    failureMessage?: string;
    resumable: boolean;
    canCancel: boolean;
    rerunnableStages: { id: string; allowed: boolean; reason?: string }[];
    contentId?: string;
    platforms?: SocialPlatformType[];
    connectionIds?: Record<string, string>;
    depth?: string;
    budgetProfile?: string;
    language?: string;
    maxCredits?: number;
    failureCode?: string | null;
    terminalOutcome?: string | null;
  };
  stages: {
    id: string;
    label: string;
    status: SocialViewStageStatus;
    startedAt?: string;
    endedAt?: string;
    detail?: string;
    attempts?: number;
  }[];
  agents: {
    id: string;
    role: string;
    phase: SocialViewAgentPhase;
    modelId?: string;
    retryCount?: number;
    failureMessage?: string;
  }[];
  /** SocialPublishedSummary[] | EmptyArtifactSentinel — type guard via `kind` field. */
  reportArtifact?: unknown;
  todoBoard?: unknown;
  cost?: {
    tokensUsed?: string | null;
    costUsd?: number | null;
    elapsedWallTimeMs?: number | null;
    trajectoryStored?: number | null;
    currency: 'USD';
  };
  memory?: { kind: 'empty-memory' | 'memory'; payload?: unknown };
  timelineVersion: number;
  snapshotVersion: number;
  refreshHints?: SocialViewRefreshHint[];
}

/**
 * GET /ai-social/tasks/:id/view — canonical detail view（thinning plan §B7-1 / §B7-3）。
 *
 * 与 getTask sibling 兼容并存：getTask 仍返回 legacy shape；view endpoint 返回
 * single-track truth。前端按需消费。
 */
export async function getSocialMissionDetailView(
  id: string
): Promise<SocialMissionDetailView> {
  const wrapped = await fetchWithAuth<{ view: SocialMissionDetailView }>(
    `/api/v1/ai-social/tasks/${encodeURIComponent(id)}/view`
  );
  if (!wrapped?.view) throw new Error('Social mission view not found');
  return wrapped.view;
}

// ==================== Platform Connection API ====================

/**
 * Get all platform connections for the current user
 */
export async function getConnections(): Promise<SocialPlatformConnection[]> {
  return fetchWithAuth('/api/v1/ai-social/connections');
}

/**
 * Get a specific platform connection
 */
export async function getConnection(
  id: string
): Promise<SocialPlatformConnection> {
  return fetchWithAuth(`/api/v1/ai-social/connections/${id}`);
}

/**
 * Get connection by platform type
 */
export async function getConnectionByPlatform(
  platformType: SocialPlatformType
): Promise<SocialPlatformConnection | null> {
  return fetchWithAuth(
    `/api/v1/ai-social/connections/platform/${platformType}`
  );
}

/**
 * Create or update platform connection
 */
export async function upsertConnection(
  platformType: SocialPlatformType,
  config: PlatformConfigDto
): Promise<SocialPlatformConnection> {
  return fetchWithAuth(
    `/api/v1/ai-social/connections/platform/${platformType}`,
    {
      method: 'POST',
      body: JSON.stringify(config),
    }
  );
}

/**
 * Delete a platform connection by platform type
 * Note: Backend uses platform type, not connection ID
 */
export async function deleteConnection(
  platformType: SocialPlatformType
): Promise<void> {
  return fetchWithAuth(`/api/v1/ai-social/connections/${platformType}`, {
    method: 'DELETE',
  });
}

/**
 * Test platform connection
 */
export async function testConnection(
  id: string
): Promise<{ success: boolean; message: string }> {
  return fetchWithAuth(`/api/v1/ai-social/connections/${id}/test`, {
    method: 'POST',
  });
}

/**
 * Refresh platform connection session
 */
export async function refreshConnection(
  id: string
): Promise<SocialPlatformConnection> {
  return fetchWithAuth(`/api/v1/ai-social/connections/${id}/refresh`, {
    method: 'POST',
  });
}

// ==================== Connection Login API ====================

export interface InitConnectionResponse {
  status: 'existing' | 'pending' | 'success' | 'error';
  connection?: SocialPlatformConnection;
  sessionKey?: string;
  screenshot?: string;
  loginMethod?: 'external-mcp';
  instructions?: string[];
  message: string;
}

export interface VerifyConnectionResponse {
  status: 'success' | 'pending' | 'error';
  connection?: SocialPlatformConnection;
  screenshot?: string;
  message: string;
}

/**
 * Initialize platform connection - starts browser login session
 * Returns screenshot of login page (QR code) for user to scan
 */
export async function initConnection(
  platformType: SocialPlatformType
): Promise<InitConnectionResponse> {
  return fetchWithAuth(`/api/v1/ai-social/connections/${platformType}/init`, {
    method: 'POST',
  });
}

/**
 * Verify platform connection - checks if user has logged in
 * Returns new screenshot if still pending, or connection if successful
 */
export async function verifyConnection(
  platformType: SocialPlatformType
): Promise<VerifyConnectionResponse> {
  return fetchWithAuth(`/api/v1/ai-social/connections/${platformType}/verify`, {
    method: 'POST',
  });
}

// ==================== Content API ====================

/**
 * Get all contents with optional filters
 */
export async function getContents(options?: {
  status?: SocialContentStatus;
  contentType?: SocialContentType;
  sourceType?: SocialContentSourceType;
  reviewStatus?: SocialReviewStatus;
  limit?: number;
  offset?: number;
}): Promise<{ items: SocialContent[]; total: number }> {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.contentType) params.set('contentType', options.contentType);
  if (options?.sourceType) params.set('sourceType', options.sourceType);
  if (options?.reviewStatus) params.set('reviewStatus', options.reviewStatus);
  if (options?.limit) params.set('limit', options.limit.toString());
  // Backend uses 'page' not 'offset', convert offset to page
  if (options?.offset !== undefined && options?.limit) {
    const page = Math.floor(options.offset / options.limit) + 1;
    params.set('page', page.toString());
  }

  const query = params.toString();
  const response = await fetchWithAuth<{
    contents: SocialContent[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }>(`/api/v1/ai-social/contents${query ? `?${query}` : ''}`);

  // Transform backend response format to frontend expected format
  return {
    items: response.contents || [],
    total: response.pagination?.total || 0,
  };
}

/**
 * Get a specific content
 */
export async function getContent(id: string): Promise<SocialContent> {
  return fetchWithAuth(`/api/v1/ai-social/contents/${id}`);
}

/**
 * Create new content
 */
export async function createContent(
  dto: CreateContentDto
): Promise<SocialContent> {
  return fetchWithAuth('/api/v1/ai-social/contents', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/**
 * Update content
 */
export async function updateContent(
  id: string,
  dto: UpdateContentDto
): Promise<SocialContent> {
  return fetchWithAuth(`/api/v1/ai-social/contents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

/**
 * Delete content
 */
export async function deleteContent(id: string): Promise<void> {
  return fetchWithAuth(`/api/v1/ai-social/contents/${id}`, {
    method: 'DELETE',
  });
}

// ==================== AI Engine API ====================

/**
 * Process external URL - AI extracts and transforms content
 */
export async function processUrl(dto: ProcessUrlDto): Promise<{
  content: SocialContent;
  checkResult: ComplianceCheckResult;
  message: string;
}> {
  return fetchWithAuth('/api/v1/ai-social/ai/process-url', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/**
 * Process internal source - AI transforms content from AI Explore/Research/Office/Writing
 */
export async function processSource(dto: ProcessSourceDto): Promise<{
  content: SocialContent;
  seriesId?: string | null;
  seriesContents?: Array<{
    id: string;
    title: string;
    content: string;
    digest: string | null;
    seriesOrder: number | null;
    status: string;
  }>;
  checkResult: ComplianceCheckResult;
  message: string;
}> {
  return fetchWithAuth('/api/v1/ai-social/ai/process-source', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/**
 * Get all contents in a series
 */
export async function getSeriesContents(
  seriesId: string
): Promise<SeriesPartSummary[]> {
  return fetchWithAuth(`/api/v1/ai-social/series/${seriesId}/contents`);
}

/**
 * Regenerate content using AI
 */
export async function regenerateContent(contentId: string): Promise<{
  content: SocialContent;
  checkResult: ComplianceCheckResult;
  message: string;
}> {
  return fetchWithAuth(`/api/v1/ai-social/ai/regenerate/${contentId}`, {
    method: 'POST',
  });
}

/**
 * Run compliance check on content
 */
export async function checkCompliance(
  contentId: string
): Promise<ComplianceCheckResult> {
  return fetchWithAuth(`/api/v1/ai-social/contents/${contentId}/check`, {
    method: 'POST',
  });
}

// ==================== Review API ====================

/**
 * Approve content for publishing
 */
export async function approveContent(
  contentId: string,
  note?: string
): Promise<SocialContent> {
  return fetchWithAuth(`/api/v1/ai-social/contents/${contentId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

/**
 * Reject content
 */
export async function rejectContent(
  contentId: string,
  note: string
): Promise<SocialContent> {
  return fetchWithAuth(`/api/v1/ai-social/contents/${contentId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

/**
 * Request revision for content (maps to reject with note)
 */
export async function requestRevision(
  contentId: string,
  note: string
): Promise<SocialContent> {
  // Note: Backend doesn't have a separate revision endpoint, using reject
  return fetchWithAuth(`/api/v1/ai-social/contents/${contentId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

/**
 * Resubmit content for review after revision
 */
export async function resubmitForReview(
  contentId: string
): Promise<SocialContent> {
  return fetchWithAuth(`/api/v1/ai-social/contents/${contentId}/resubmit`, {
    method: 'POST',
  });
}

// ==================== Publish API ====================

/**
 * Publish content to platform
 */
export async function publishContent(
  contentId: string,
  dto?: PublishContentDto
): Promise<{
  success: boolean;
  externalUrl?: string;
  externalId?: string;
  errorMessage?: string;
}> {
  return fetchWithAuth(`/api/v1/ai-social/contents/${contentId}/publish`, {
    method: 'POST',
    body: JSON.stringify(dto || {}),
  });
}

/**
 * Schedule content for future publishing
 */
export async function scheduleContent(
  contentId: string,
  scheduledAt: string,
  connectionId?: string
): Promise<SocialContent> {
  return fetchWithAuth(`/api/v1/ai-social/contents/${contentId}/schedule`, {
    method: 'POST',
    body: JSON.stringify({ scheduledAt, connectionId }),
  });
}

/**
 * Cancel scheduled publishing
 */
export async function cancelSchedule(
  contentId: string
): Promise<SocialContent> {
  return fetchWithAuth(`/api/v1/ai-social/contents/${contentId}/cancel`, {
    method: 'POST',
  });
}

/**
 * Get publish logs for content
 */
export async function getPublishLogs(
  contentId: string
): Promise<SocialPublishLog[]> {
  return fetchWithAuth(`/api/v1/ai-social/contents/${contentId}/logs`);
}

// ==================== Source Fetcher API ====================

// Source item type for transformation
interface SourceItemBase {
  id: string;
  title?: string;
  name?: string;
  description?: string;
  abstract?: string;
  type?: string;
  sourceUrl?: string;
  thumbnailUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Get available sources from AI Explore
 * Note: Backend returns array directly, we transform to { items, total }
 */
export async function getExploreSources(options?: {
  limit?: number;
  offset?: number;
  type?: string;
}): Promise<{
  items: Array<{
    id: string;
    title: string;
    description?: string;
    url?: string;
    type?: string;
    thumbnail?: string;
    createdAt?: string;
  }>;
  total: number;
}> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.type) params.set('type', options.type);
  // Default: fetch content from the last 7 days
  const since = new Date();
  since.setDate(since.getDate() - 7);
  params.set('since', since.toISOString());
  const query = params.toString();
  const data = await fetchWithAuth<SourceItemBase[]>(
    `/api/v1/ai-social/sources/explore${query ? `?${query}` : ''}`
  );
  const items = Array.isArray(data) ? data : [];
  return {
    items: items.map((item) => ({
      id: item.id,
      title: item.title || item.name || 'Untitled',
      description: item.abstract || item.description,
      url: item.sourceUrl,
      type: item.type,
      thumbnail: item.thumbnailUrl,
      createdAt: item.createdAt,
    })),
    total: items.length,
  };
}

/**
 * Get available sources from AI Research
 * Note: Backend returns array directly, we transform to { items, total }
 */
export async function getResearchSources(options?: {
  limit?: number;
  offset?: number;
}): Promise<{
  items: Array<{
    id: string;
    title: string;
    type?: string;
    createdAt?: string;
  }>;
  total: number;
}> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', options.limit.toString());
  const query = params.toString();
  const data = await fetchWithAuth<SourceItemBase[]>(
    `/api/v1/ai-social/sources/research${query ? `?${query}` : ''}`
  );
  const items = Array.isArray(data) ? data : [];
  return {
    items: items.map((item) => ({
      id: item.id,
      title: item.title || item.name || 'Untitled',
      type: item.type,
      createdAt: item.createdAt || item.updatedAt,
    })),
    total: items.length,
  };
}

/**
 * Get available sources from AI Office
 * Note: Backend returns array directly, we transform to { items, total }
 */
export async function getOfficeSources(options?: {
  limit?: number;
  offset?: number;
}): Promise<{
  items: Array<{
    id: string;
    title: string;
    type?: string;
    createdAt?: string;
  }>;
  total: number;
}> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', options.limit.toString());
  const query = params.toString();
  const data = await fetchWithAuth<SourceItemBase[]>(
    `/api/v1/ai-social/sources/office${query ? `?${query}` : ''}`
  );
  const items = Array.isArray(data) ? data : [];
  return {
    items: items.map((item) => ({
      id: item.id,
      title: item.title || item.name || 'Untitled',
      type: item.type,
      createdAt: item.createdAt || item.updatedAt,
    })),
    total: items.length,
  };
}

/**
 * Get available sources from AI Writing
 * Note: Backend returns array directly, we transform to { items, total }
 */
export async function getWritingSources(options?: {
  limit?: number;
  offset?: number;
}): Promise<{
  items: Array<{
    id: string;
    title: string;
    type?: string;
    wordCount?: number;
    createdAt?: string;
  }>;
  total: number;
}> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', options.limit.toString());
  const query = params.toString();
  const data = await fetchWithAuth<SourceItemBase[]>(
    `/api/v1/ai-social/sources/writing${query ? `?${query}` : ''}`
  );
  const items = Array.isArray(data) ? data : [];
  return {
    items: items.map((item) => ({
      id: item.id,
      title: item.title || item.name || 'Untitled',
      type: item.type,
      createdAt: item.createdAt || item.updatedAt,
    })),
    total: items.length,
  };
}

/**
 * Get available sources from Topic Insights
 * Returns topics that have at least one generated report
 */
export async function getTopicInsightsSources(options?: {
  limit?: number;
  offset?: number;
}): Promise<{
  items: Array<{
    id: string;
    title: string;
    description?: string;
    type?: string;
    createdAt?: string;
    latestReport?: {
      id: string;
      version: number;
      executiveSummary?: string;
      generatedAt?: string;
    };
  }>;
  total: number;
}> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', options.limit.toString());
  const query = params.toString();
  const data = await fetchWithAuth<
    Array<{
      id: string;
      name: string;
      description?: string;
      status?: string;
      updatedAt?: string;
      latestReport?: {
        id: string;
        version: number;
        executiveSummary?: string;
        generatedAt?: string;
      };
    }>
  >(`/api/v1/ai-social/sources/topic-insights${query ? `?${query}` : ''}`);
  const items = Array.isArray(data) ? data : [];
  return {
    items: items.map((item) => ({
      id: item.id,
      title: item.name || 'Untitled',
      description: item.latestReport?.executiveSummary || item.description,
      type: item.status,
      createdAt: item.updatedAt,
      latestReport: item.latestReport,
    })),
    total: items.length,
  };
}

// ==================== Xiaohongshu MCP API ====================

export interface XhsLoginStatus {
  loggedIn: boolean;
  userId?: string;
  nickname?: string;
}

export interface XhsFeed {
  id: string;
  xsecToken?: string;
  title?: string;
  description?: string;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  user?: {
    userId?: string;
    nickname?: string;
    avatar?: string;
  };
  images?: string[];
  [key: string]: unknown;
}

export interface XhsFeedDetail extends XhsFeed {
  comments?: Array<{
    id: string;
    content: string;
    user?: { nickname?: string };
    createTime?: string;
  }>;
}

export interface XhsUserProfile {
  userId: string;
  nickname?: string;
  avatar?: string;
  description?: string;
  followerCount?: number;
  followingCount?: number;
  noteCount?: number;
  likeCount?: number;
  [key: string]: unknown;
}

export async function xhsGetLoginStatus(): Promise<XhsLoginStatus> {
  return fetchWithAuth('/api/v1/ai-social/xhs/login-status');
}

export async function xhsListFeeds(): Promise<XhsFeed[]> {
  return fetchWithAuth('/api/v1/ai-social/xhs/feeds');
}

export async function xhsSearchFeeds(keyword: string): Promise<XhsFeed[]> {
  return fetchWithAuth(
    `/api/v1/ai-social/xhs/search?keyword=${encodeURIComponent(keyword)}`
  );
}

export async function xhsGetFeedDetail(
  feedId: string,
  xsecToken: string
): Promise<XhsFeedDetail> {
  return fetchWithAuth(
    `/api/v1/ai-social/xhs/feeds/${feedId}?xsecToken=${encodeURIComponent(xsecToken)}`
  );
}

export async function xhsPostComment(
  feedId: string,
  xsecToken: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  return fetchWithAuth(`/api/v1/ai-social/xhs/feeds/${feedId}/comment`, {
    method: 'POST',
    body: JSON.stringify({ xsecToken, content }),
  });
}

export async function xhsGetUserProfile(
  userId: string,
  xsecToken: string
): Promise<XhsUserProfile> {
  return fetchWithAuth(
    `/api/v1/ai-social/xhs/users/${userId}?xsecToken=${encodeURIComponent(xsecToken)}`
  );
}

// ==================== Content Version API ====================

export interface SocialContentVersion {
  id: string;
  contentId: string;
  platformType: SocialPlatformType;
  title: string;
  content: string;
  digest: string | null;
  isDefault: boolean;
  generatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateVersionDto {
  title?: string;
  content?: string;
  digest?: string;
}

/**
 * Get all platform versions for a content
 */
export async function getContentVersions(
  contentId: string
): Promise<{ versions: SocialContentVersion[] }> {
  return fetchWithAuth(`/api/v1/ai-social/contents/${contentId}/versions`);
}

/**
 * Generate a version for a specific platform
 */
export async function generateVersion(
  contentId: string,
  platformType: SocialPlatformType
): Promise<{ version: SocialContentVersion }> {
  return fetchWithAuth(
    `/api/v1/ai-social/contents/${contentId}/versions/generate`,
    {
      method: 'POST',
      body: JSON.stringify({ platformType }),
    }
  );
}

/**
 * Generate versions for all platforms
 */
export async function generateAllVersions(
  contentId: string
): Promise<{ versions: SocialContentVersion[] }> {
  return fetchWithAuth(
    `/api/v1/ai-social/contents/${contentId}/versions/generate-all`,
    {
      method: 'POST',
    }
  );
}

/**
 * Update a platform version
 */
export async function updateVersion(
  contentId: string,
  platformType: SocialPlatformType,
  dto: UpdateVersionDto
): Promise<{ version: SocialContentVersion }> {
  return fetchWithAuth(
    `/api/v1/ai-social/contents/${contentId}/versions/${platformType.toLowerCase()}`,
    {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }
  );
}

/**
 * Delete a platform version
 */
export async function deleteVersion(
  contentId: string,
  platformType: SocialPlatformType
): Promise<{ success: boolean }> {
  return fetchWithAuth(
    `/api/v1/ai-social/contents/${contentId}/versions/${platformType.toLowerCase()}`,
    {
      method: 'DELETE',
    }
  );
}

// ==================== Mission Run (W4 Agent Team) ====================

export interface RunSocialMissionRequest {
  contentId: string;
  platforms: SocialPlatformType[];
  connectionIds: Record<string, string>;
  depth: 'quick' | 'standard' | 'deep';
  budgetProfile?: 'lean' | 'standard' | 'rich';
  language?: 'zh-CN' | 'en-US';
}

export interface RunSocialMissionResponse {
  missionId: string;
  status: 'started' | 'in-flight';
}

/**
 * 启动 SocialPublishMission（W4 Agent Team 新轨）
 * Fire-and-forget：立即返回 missionId，mission 异步跑；前端订阅
 * WebSocket social.mission:* / social.stage:lifecycle 事件流跟进度。
 */
export async function runSocialMission(
  request: RunSocialMissionRequest
): Promise<RunSocialMissionResponse> {
  return fetchWithAuth('/api/v1/ai-social/mission/run', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}
