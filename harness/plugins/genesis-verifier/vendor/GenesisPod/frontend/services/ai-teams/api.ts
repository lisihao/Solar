import { getAuthTokens } from '@/lib/utils/auth';
import {
  Topic,
  TopicMember,
  TopicAIMember,
  TopicAIMemberWithTeamRole,
  TopicMessage,
  TopicResource,
  TopicSummary,
  CreateTopicDto,
  UpdateTopicDto,
  AddMemberDto,
  AddAIMemberDto,
  UpdateAIMemberDto,
  SendMessageDto,
  AddResourceDto,
  GenerateSummaryDto,
  MessagesResponse,
  TopicType,
  TopicRole,
  // Team Mission types
  TeamMission,
  MissionLog,
  CreateMissionDto,
  UpdateAIMemberTeamRoleDto,
  MissionStatus,
} from '@/lib/types/ai-teams';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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

  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const result = await response.json();

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
}

// ==================== Topic API ====================

export async function createTopic(dto: CreateTopicDto): Promise<Topic> {
  return fetchWithAuth('/api/v1/topics', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function getTopics(options?: {
  type?: TopicType;
  search?: string;
}): Promise<Topic[]> {
  const params = new URLSearchParams();
  if (options?.type) params.set('type', options.type);
  if (options?.search) params.set('search', options.search);

  const query = params.toString();
  return fetchWithAuth(`/api/v1/topics${query ? `?${query}` : ''}`);
}

export async function getTopicById(topicId: string): Promise<Topic> {
  return fetchWithAuth(`/api/v1/topics/${topicId}`);
}

export async function updateTopic(
  topicId: string,
  dto: UpdateTopicDto
): Promise<Topic> {
  return fetchWithAuth(`/api/v1/topics/${topicId}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

export async function archiveTopic(topicId: string): Promise<Topic> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/archive`, {
    method: 'POST',
  });
}

export async function deleteTopic(topicId: string): Promise<void> {
  return fetchWithAuth(`/api/v1/topics/${topicId}`, {
    method: 'DELETE',
  });
}

// ==================== Member API ====================

export async function getMembers(topicId: string): Promise<TopicMember[]> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/members`);
}

export async function addMember(
  topicId: string,
  dto: AddMemberDto
): Promise<TopicMember> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/members`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function addMemberByEmail(
  topicId: string,
  email: string,
  role?: TopicRole
): Promise<TopicMember> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/members/invite`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
}

export async function addMembers(
  topicId: string,
  userIds: string[],
  role?: TopicRole
): Promise<{ added: number }> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/members/batch`, {
    method: 'POST',
    body: JSON.stringify({ userIds, role }),
  });
}

export async function updateMember(
  topicId: string,
  memberId: string,
  dto: { role?: TopicRole; nickname?: string }
): Promise<TopicMember> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/members/${memberId}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

export async function removeMember(
  topicId: string,
  memberId: string
): Promise<void> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/members/${memberId}`, {
    method: 'DELETE',
  });
}

export async function leaveTopic(topicId: string): Promise<void> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/leave`, {
    method: 'POST',
  });
}

// ==================== AI Member API ====================

export async function getAIMembers(topicId: string): Promise<TopicAIMember[]> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/ai-members`);
}

export async function addAIMember(
  topicId: string,
  dto: AddAIMemberDto
): Promise<TopicAIMember> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/ai-members`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function updateAIMember(
  topicId: string,
  aiMemberId: string,
  dto: UpdateAIMemberDto
): Promise<TopicAIMember> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/ai-members/${aiMemberId}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

export async function removeAIMember(
  topicId: string,
  aiMemberId: string
): Promise<void> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/ai-members/${aiMemberId}`, {
    method: 'DELETE',
  });
}

// ==================== Message API ====================

export async function getMessages(
  topicId: string,
  options?: { cursor?: string; limit?: number }
): Promise<MessagesResponse> {
  const params = new URLSearchParams();
  if (options?.cursor) params.set('cursor', options.cursor);
  if (options?.limit) params.set('limit', options.limit.toString());

  const query = params.toString();
  return fetchWithAuth(
    `/api/v1/topics/${topicId}/messages${query ? `?${query}` : ''}`
  );
}

export async function sendMessage(
  topicId: string,
  dto: SendMessageDto
): Promise<TopicMessage> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/messages`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function deleteMessage(
  topicId: string,
  messageId: string
): Promise<void> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/messages/${messageId}`, {
    method: 'DELETE',
  });
}

export async function addReaction(
  topicId: string,
  messageId: string,
  emoji: string
): Promise<{
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: string;
}> {
  return fetchWithAuth(
    `/api/v1/topics/${topicId}/messages/${messageId}/reactions`,
    {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }
  );
}

export async function removeReaction(
  topicId: string,
  messageId: string,
  emoji: string
): Promise<void> {
  return fetchWithAuth(
    `/api/v1/topics/${topicId}/messages/${messageId}/reactions/${emoji}`,
    {
      method: 'DELETE',
    }
  );
}

export async function markAsRead(
  topicId: string,
  messageId?: string
): Promise<void> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/read`, {
    method: 'POST',
    body: JSON.stringify({ messageId }),
  });
}

// ==================== AI Response API ====================

export async function generateAIResponse(
  topicId: string,
  aiMemberId: string,
  contextMessageIds?: string[]
): Promise<TopicMessage> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/ai/generate`, {
    method: 'POST',
    body: JSON.stringify({ aiMemberId, contextMessageIds }),
  });
}

// ==================== Resource API ====================

export async function getResources(topicId: string): Promise<TopicResource[]> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/resources`);
}

export async function addResource(
  topicId: string,
  dto: AddResourceDto
): Promise<TopicResource> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/resources`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function removeResource(
  topicId: string,
  resourceId: string
): Promise<void> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/resources/${resourceId}`, {
    method: 'DELETE',
  });
}

// ==================== Summary API ====================

export async function getSummaries(topicId: string): Promise<TopicSummary[]> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/summaries`);
}

export async function generateSummary(
  topicId: string,
  dto: GenerateSummaryDto
): Promise<TopicSummary> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/summaries`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function deleteSummary(
  topicId: string,
  summaryId: string
): Promise<void> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/summaries/${summaryId}`, {
    method: 'DELETE',
  });
}

// ==================== Team Mission API ====================

/**
 * 创建团队任务
 */
export async function createMission(
  topicId: string,
  dto: CreateMissionDto
): Promise<TeamMission> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/missions`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/**
 * 获取任务列表
 */
export async function getMissions(
  topicId: string,
  options?: {
    status?: MissionStatus;
    limit?: number;
    offset?: number;
  }
): Promise<{ missions: TeamMission[]; total: number }> {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.offset) params.set('offset', options.offset.toString());

  const query = params.toString();
  return fetchWithAuth(
    `/api/v1/topics/${topicId}/missions${query ? `?${query}` : ''}`
  );
}

/**
 * 获取任务详情
 */
export async function getMissionById(
  topicId: string,
  missionId: string
): Promise<TeamMission> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/missions/${missionId}`);
}

/**
 * 取消任务
 */
export async function cancelMission(
  topicId: string,
  missionId: string
): Promise<TeamMission> {
  return fetchWithAuth(
    `/api/v1/topics/${topicId}/missions/${missionId}/cancel`,
    {
      method: 'POST',
    }
  );
}

/**
 * 暂停任务（可恢复）
 */
export async function pauseMission(
  topicId: string,
  missionId: string
): Promise<{ success: boolean; message: string; previousStatus: string }> {
  return fetchWithAuth(
    `/api/v1/topics/${topicId}/missions/${missionId}/pause`,
    {
      method: 'POST',
    }
  );
}

/**
 * 恢复已暂停的任务
 */
export async function resumeMission(
  topicId: string,
  missionId: string
): Promise<{ success: boolean; message: string; status: string }> {
  return fetchWithAuth(
    `/api/v1/topics/${topicId}/missions/${missionId}/resume`,
    {
      method: 'POST',
    }
  );
}

/**
 * 重试失败或已取消的任务
 * @param mode - 'full' 完全重新规划, 'continue' 继续执行未完成的任务
 */
export async function retryMission(
  topicId: string,
  missionId: string,
  options?: { mode?: 'full' | 'continue'; reason?: string }
): Promise<{
  success: boolean;
  message: string;
  mode: 'full' | 'continue';
  previousStatus: string;
}> {
  return fetchWithAuth(
    `/api/v1/topics/${topicId}/missions/${missionId}/retry`,
    {
      method: 'POST',
      body: JSON.stringify(options || {}),
    }
  );
}

/**
 * 删除任务（仅限历史任务：已完成、失败或取消的任务）
 */
export async function deleteMission(
  topicId: string,
  missionId: string
): Promise<{ success: boolean; message: string }> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/missions/${missionId}`, {
    method: 'DELETE',
  });
}

/**
 * 获取任务执行日志
 */
export async function getMissionLogs(
  topicId: string,
  missionId: string,
  options?: { limit?: number; offset?: number }
): Promise<{ logs: MissionLog[]; total: number }> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.offset) params.set('offset', options.offset.toString());

  const query = params.toString();
  return fetchWithAuth(
    `/api/v1/topics/${topicId}/missions/${missionId}/logs${query ? `?${query}` : ''}`
  );
}

/**
 * 获取完整报告内容（直接从数据库任务构建，确保内容完整）
 */
export async function getFullReport(
  topicId: string,
  missionId: string
): Promise<{
  success: boolean;
  message: string;
  fullContent?: string;
  taskCount?: number;
  totalWords?: number;
}> {
  return fetchWithAuth(
    `/api/v1/topics/${topicId}/missions/${missionId}/full-report`
  );
}

/**
 * 重新生成最终报告（修复内容缺失或排序问题）
 */
export async function regenerateFinalReport(
  topicId: string,
  missionId: string
): Promise<{
  success: boolean;
  message: string;
  finalResult?: string;
  taskCount?: number;
}> {
  return fetchWithAuth(
    `/api/v1/topics/${topicId}/missions/${missionId}/regenerate-report`,
    { method: 'POST' }
  );
}

// ==================== Team Role API ====================

/**
 * 设置团队领导
 */
export async function setTeamLeader(
  topicId: string,
  aiMemberId: string
): Promise<TopicAIMemberWithTeamRole> {
  return fetchWithAuth(
    `/api/v1/topics/${topicId}/ai-members/${aiMemberId}/set-leader`,
    {
      method: 'POST',
    }
  );
}

/**
 * 更新AI成员的团队角色配置
 */
export async function updateTeamRole(
  topicId: string,
  aiMemberId: string,
  dto: UpdateAIMemberTeamRoleDto
): Promise<TopicAIMemberWithTeamRole> {
  return fetchWithAuth(
    `/api/v1/topics/${topicId}/ai-members/${aiMemberId}/team-role`,
    {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }
  );
}

/**
 * 获取团队成员（包含团队角色信息）
 */
export async function getTeamMembers(topicId: string): Promise<{
  leader?: TopicAIMemberWithTeamRole;
  members: TopicAIMemberWithTeamRole[];
  all: TopicAIMemberWithTeamRole[];
}> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/team`);
}

// ==================== URL Parsing API ====================

/**
 * URL 解析类型
 */
export type ParsedUrlType =
  | 'WEBPAGE'
  | 'IMAGE'
  | 'VIDEO'
  | 'DOCUMENT'
  | 'CODE_REPO'
  | 'SOCIAL';

/**
 * 解析状态
 */
export type ParseStatus = 'pending' | 'parsing' | 'success' | 'failed';

/**
 * 链接预览数据
 */
export interface LinkPreview {
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  siteName?: string;
  author?: string;
  publishedAt?: string;
}

/**
 * 提取的内容
 */
export interface ExtractedContent {
  fullText?: string;
  summary?: string;
  keyPoints?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * 解析结果
 */
export interface ParsedUrl {
  type: ParsedUrlType;
  originalText: string;
  url: string;
  platform?: string;
  preview: LinkPreview;
  extractedContent?: ExtractedContent;
  status: ParseStatus;
  error?: string;
}

/**
 * URL 检测结果
 */
export interface DetectedUrl {
  url: string;
  startIndex: number;
  endIndex: number;
  type: ParsedUrlType;
  platform?: string;
}

/**
 * 解析单个 URL
 */
export async function parseUrl(url: string): Promise<ParsedUrl> {
  return fetchWithAuth('/api/v1/topics/parse-url', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

/**
 * 批量解析 URL
 */
export async function parseUrls(urls: string[]): Promise<ParsedUrl[]> {
  return fetchWithAuth('/api/v1/topics/parse-urls', {
    method: 'POST',
    body: JSON.stringify({ urls }),
  });
}

/**
 * 从文本中检测 URL（不解析内容，仅检测）
 */
export async function detectUrls(text: string): Promise<DetectedUrl[]> {
  return fetchWithAuth('/api/v1/topics/detect-urls', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

/**
 * 从文本中检测并解析所有 URL
 */
export async function detectAndParseUrls(text: string): Promise<{
  detectedUrls: DetectedUrl[];
  parsedUrls: ParsedUrl[];
}> {
  return fetchWithAuth('/api/v1/topics/detect-and-parse-urls', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

// ==================== Public Topics & Join Requests API ====================

/**
 * 公开团队信息
 */
export interface PublicTopic {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
  type: TopicType;
  metadata?: {
    tags?: string[];
    [key: string]: unknown;
  };
  memberCount: number;
  aiMemberCount: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    username?: string;
    fullName?: string;
    avatarUrl?: string;
  };
}

/**
 * 加入请求
 */
export interface JoinRequest {
  id: string;
  topicId: string;
  userId: string;
  requestMessage?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  responseNote?: string;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    username?: string;
    fullName?: string;
    avatarUrl?: string;
  };
  topic?: {
    id: string;
    name: string;
  };
}

/**
 * 获取所有公开团队列表
 */
export async function getPublicTopics(options?: {
  search?: string;
  limit?: number;
}): Promise<PublicTopic[]> {
  const params = new URLSearchParams();
  if (options?.search) params.set('search', options.search);
  if (options?.limit) params.set('limit', options.limit.toString());

  const query = params.toString();
  return fetchWithAuth(`/api/v1/topics/public${query ? `?${query}` : ''}`);
}

/**
 * 申请加入团队
 */
export async function requestToJoinTopic(
  topicId: string,
  requestMessage?: string
): Promise<JoinRequest> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/join-request`, {
    method: 'POST',
    body: JSON.stringify({ requestMessage }),
  });
}

/**
 * 获取我的加入请求列表
 */
export async function getMyJoinRequests(): Promise<JoinRequest[]> {
  return fetchWithAuth('/api/v1/topics/my-join-requests');
}

/**
 * 取消加入请求
 */
export async function cancelJoinRequest(requestId: string): Promise<void> {
  return fetchWithAuth(`/api/v1/topics/join-requests/${requestId}`, {
    method: 'DELETE',
  });
}

/**
 * 获取团队的加入请求列表（管理员）
 */
export async function getJoinRequests(topicId: string): Promise<JoinRequest[]> {
  return fetchWithAuth(`/api/v1/topics/${topicId}/join-requests`);
}

/**
 * 审核加入请求
 */
export async function reviewJoinRequest(
  requestId: string,
  approve: boolean,
  responseNote?: string
): Promise<JoinRequest> {
  return fetchWithAuth(`/api/v1/topics/join-requests/${requestId}/review`, {
    method: 'POST',
    body: JSON.stringify({ approve, responseNote }),
  });
}
