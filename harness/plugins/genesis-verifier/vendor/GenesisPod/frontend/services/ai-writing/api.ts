/**
 * AI Writing API Client V2
 *
 * 完全采用 AI Teams 的成功模式：
 * - 直接使用 NEXT_PUBLIC_API_URL
 * - fetchWithAuth 处理认证
 * - 简单直接的 fetch 请求
 */

import { getAuthTokens } from '@/lib/utils/auth';

// ==================== Types ====================

export interface WritingProject {
  id: string;
  name: string;
  description?: string;
  genre?: string;
  targetWords: number;
  currentWords: number;
  status: 'PLANNING' | 'OUTLINING' | 'WRITING' | 'REVISING' | 'COMPLETED';
  writingStyle?: string;
  visibility?: 'PRIVATE' | 'PUBLIC';
  createdAt: string;
  updatedAt: string;
}

export interface Chapter {
  id: string;
  volumeId: string;
  title: string;
  content?: string;
  outline?: string; // 章节大纲
  wordCount: number;
  chapterNumber: number;
  status: string;
}

export interface Volume {
  id: string;
  projectId: string;
  title: string;
  volumeNumber: number;
  synopsis?: string;
  targetWords?: number;
  chapters?: Chapter[];
}

export interface WorldSetting {
  id: string;
  bibleId: string;
  category: string;
  name: string; // 设定名称
  description: string; // 设定描述
  rules?: string[]; // 规则/限制
  references?: Record<string, unknown>; // 相关引用
}

// 时间线事件
export interface TimelineEvent {
  id: string;
  bibleId: string;
  eventName: string;
  description: string;
  storyTime: string; // 故事内时间
  importance: number; // 重要程度 1-5
  involvedCharacterIds?: string[];
  relatedChapterId?: string;
}

// 术语/专有名词
export interface Terminology {
  id: string;
  bibleId: string;
  term: string;
  definition: string;
  category: string; // 功法、地名、物品、称谓等
  variants?: string[]; // 同义词/变体
  usage?: string;
}

// 势力/组织
export interface Faction {
  id: string;
  bibleId: string;
  name: string;
  type: string; // 国家、门派、公司、家族等
  description?: string;
  hierarchy?: Record<string, unknown>;
  territory?: string;
}

export interface StoryBible {
  id: string;
  projectId: string;
  premise?: string;
  theme?: string;
  tone?: string;
  worldType?: string;
  // Relations
  worldSettings?: WorldSetting[];
  characters?: Character[];
  timelineEvents?: TimelineEvent[];
  terminologies?: Terminology[];
  factions?: Faction[];
}

export interface CharacterPersonality {
  arc?: string;
  traits?: string[];
  motivation?: string;
}

export interface Character {
  id: string;
  projectId: string;
  name: string;
  role: string;
  description?: string;
  personality?: string | CharacterPersonality;
  background?: string;
}

export interface WritingMission {
  id: string;
  projectId: string;
  type?: 'outline' | 'chapter' | 'full_story';
  missionType?: 'outline' | 'chapter' | 'full_story'; // 后端返回的字段名
  status:
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'FAILED';
  progress?: number;
  result?: string;
  createdAt?: string;
  startedAt?: string; // 后端也返回这个字段
  updatedAt?: string;
  completedAt?: string;
}

export interface CreateProjectDto {
  name: string;
  description?: string;
  genre?: string;
  targetWords?: number;
  writingStyle?: string;
}

// ==================== Writing Style Presets ====================

export interface WritingStylePreset {
  id: string;
  name: string;
  category: string;
  description: string;
  representative?: string;
}

export interface UpdateProjectDto {
  name?: string;
  description?: string;
  genre?: string;
  targetWords?: number;
  status?: string;
  writingStyle?: string;
  visibility?: 'PRIVATE' | 'PUBLIC';
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface StartMissionDto {
  prompt: string;
  missionType?:
    | 'outline'
    | 'chapter'
    | 'full_story'
    | 'edit'
    | 'consistency_check';
  targetWordCount?: number;
  additionalInstructions?: string;
  targetAgent?: string; // @mention 的目标 Agent (leader, keeper, writer, checker, editor)
  conversationHistory?: ConversationMessage[]; // 多轮对话历史
  chapterNumber?: number; // 针对特定章节的操作
}

// ==================== API Base ====================

// Use relative URLs to leverage Next.js rewrites proxy (avoids CORS)
// Next.js rewrites /api/v1/* to the backend URL

// 自定义 API 错误类，保留 HTTP 状态码
export class ApiError extends Error {
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
  options: RequestInit = {}
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

  // Use relative URL to leverage Next.js proxy
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: 'Request failed' }));
    throw new ApiError(
      error.message || `HTTP ${response.status}`,
      response.status
    );
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  const data = JSON.parse(text);

  // Unwrap { success, data } format if present
  if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
    return data.data as T;
  }

  return data as T;
}

// ==================== Writing Style Presets API ====================

/**
 * 获取所有写作风格预设
 */
export async function getStylePresets(): Promise<{
  presets: WritingStylePreset[];
}> {
  return fetchWithAuth('/api/v1/ai-writing/style-presets');
}

/**
 * 根据类型获取推荐的写作风格
 */
export async function getRecommendedStyles(genre: string): Promise<{
  genre: string;
  recommended: WritingStylePreset[];
  all: WritingStylePreset[];
}> {
  return fetchWithAuth(
    `/api/v1/ai-writing/style-presets/recommend?genre=${encodeURIComponent(genre)}`
  );
}

// ==================== Project API ====================

export async function getProjects(options?: {
  status?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ items: WritingProject[]; nextCursor?: string }> {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.cursor) params.set('cursor', options.cursor);

  const query = params.toString();
  return fetchWithAuth(
    `/api/v1/ai-writing/projects${query ? `?${query}` : ''}`
  );
}

export async function getProject(id: string): Promise<WritingProject> {
  return fetchWithAuth(`/api/v1/ai-writing/projects/${id}`);
}

export async function createProject(
  dto: CreateProjectDto
): Promise<WritingProject> {
  return fetchWithAuth('/api/v1/ai-writing/projects', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function updateProject(
  id: string,
  dto: UpdateProjectDto
): Promise<WritingProject> {
  return fetchWithAuth(`/api/v1/ai-writing/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

export async function deleteProject(id: string): Promise<void> {
  return fetchWithAuth(`/api/v1/ai-writing/projects/${id}`, {
    method: 'DELETE',
  });
}

// ==================== Volume & Chapter API ====================

export async function getVolumes(projectId: string): Promise<Volume[]> {
  return fetchWithAuth(`/api/v1/ai-writing/projects/${projectId}/volumes`);
}

export async function createVolume(
  projectId: string,
  dto: {
    title: string;
    volumeNumber: number;
    synopsis?: string;
    targetWords?: number;
  }
): Promise<Volume> {
  return fetchWithAuth(`/api/v1/ai-writing/projects/${projectId}/volumes`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function getChapters(volumeId: string): Promise<Chapter[]> {
  return fetchWithAuth(`/api/v1/ai-writing/volumes/${volumeId}/chapters`);
}

export async function getChapter(id: string): Promise<Chapter> {
  return fetchWithAuth(`/api/v1/ai-writing/chapters/${id}`);
}

export async function updateChapter(
  id: string,
  dto: { title?: string; content?: string; synopsis?: string }
): Promise<Chapter> {
  return fetchWithAuth(`/api/v1/ai-writing/chapters/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

export async function createChapter(
  volumeId: string,
  dto: { title: string; chapterNumber: number; synopsis?: string }
): Promise<Chapter> {
  return fetchWithAuth(`/api/v1/ai-writing/volumes/${volumeId}/chapters`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// ==================== Story Bible API ====================

export async function getStoryBible(projectId: string): Promise<StoryBible> {
  return fetchWithAuth(`/api/v1/ai-writing/projects/${projectId}/bible`);
}

export async function updateStoryBible(
  projectId: string,
  dto: Partial<StoryBible>
): Promise<StoryBible> {
  return fetchWithAuth(`/api/v1/ai-writing/projects/${projectId}/bible`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

// ==================== Character API ====================

export async function getCharacters(projectId: string): Promise<Character[]> {
  return fetchWithAuth(`/api/v1/ai-writing/projects/${projectId}/characters`);
}

export async function createCharacter(
  projectId: string,
  dto: Omit<Character, 'id' | 'projectId'>
): Promise<Character> {
  return fetchWithAuth(`/api/v1/ai-writing/projects/${projectId}/characters`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function updateCharacter(
  projectId: string,
  characterId: string,
  dto: Partial<Character>
): Promise<Character> {
  return fetchWithAuth(
    `/api/v1/ai-writing/projects/${projectId}/characters/${characterId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }
  );
}

export async function deleteCharacter(
  projectId: string,
  characterId: string
): Promise<void> {
  return fetchWithAuth(
    `/api/v1/ai-writing/projects/${projectId}/characters/${characterId}`,
    {
      method: 'DELETE',
    }
  );
}

// ==================== Character Relationships API ====================

export interface RelationshipNode {
  id: string;
  name: string;
  role: string;
  aliases: string[];
  traits: string[];
}

export interface RelationshipEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  description?: string;
}

export interface RelationshipGraph {
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
}

export async function getRelationshipGraph(
  projectId: string
): Promise<RelationshipGraph> {
  return fetchWithAuth(
    `/api/v1/ai-writing/projects/${projectId}/relationships/graph`
  );
}

export async function addCharacterRelationship(
  projectId: string,
  characterId: string,
  dto: {
    targetCharacterId: string;
    relationshipType: string;
    description?: string;
  }
): Promise<{ id: string; targetCharacter: { id: string; name: string } }> {
  return fetchWithAuth(
    `/api/v1/ai-writing/projects/${projectId}/characters/${characterId}/relationships`,
    {
      method: 'POST',
      body: JSON.stringify(dto),
    }
  );
}

export async function deleteCharacterRelationship(
  projectId: string,
  relationshipId: string
): Promise<void> {
  return fetchWithAuth(
    `/api/v1/ai-writing/projects/${projectId}/relationships/${relationshipId}`,
    {
      method: 'DELETE',
    }
  );
}

// ==================== AI Mission API ====================

export async function startMission(
  projectId: string,
  dto: StartMissionDto
): Promise<{
  success: boolean;
  message: string;
  projectId: string;
  missionId: string;
  missionType: string;
}> {
  return fetchWithAuth(`/api/v1/ai-writing/projects/${projectId}/missions`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export interface MissionStatusResponse {
  id: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  missionType: string;
  startedAt: string;
  completedAt?: string;
  result?: {
    success?: boolean;
    content?: string;
    wordCount?: number;
    progress?: number;
    currentStep?: string;
    error?: string;
  };
  orchestratorState?: {
    phase: string;
    completedSteps: string[];
    currentSteps: string[];
    progress: number;
    tokensUsed: number;
    costUsed: number;
  };
}

export async function getMissionStatus(
  missionId: string
): Promise<MissionStatusResponse> {
  return fetchWithAuth(`/api/v1/ai-writing/missions/${missionId}`);
}

export async function cancelMission(
  missionId: string
): Promise<{ success: boolean }> {
  return fetchWithAuth(`/api/v1/ai-writing/missions/${missionId}/cancel`, {
    method: 'POST',
  });
}

// 强制清理项目的所有卡住任务
export async function forceCleanupStuckMissions(
  projectId: string
): Promise<{ success: boolean; cleanedCount: number; message: string }> {
  return fetchWithAuth(
    `/api/v1/ai-writing/projects/${projectId}/force-cleanup`,
    {
      method: 'POST',
    }
  );
}

export async function getProjectMissions(
  projectId: string
): Promise<{ items: WritingMission[]; total: number }> {
  return fetchWithAuth(`/api/v1/ai-writing/projects/${projectId}/missions`);
}

export interface MissionLogItem {
  id: string;
  eventType: string;
  agentId?: string;
  agentName?: string;
  content: string;
  detail?: Record<string, unknown>;
  createdAt: string;
}

export async function getMissionLogs(
  missionId: string,
  limit?: number,
  offset?: number
): Promise<{ items: MissionLogItem[]; total: number }> {
  const params = new URLSearchParams();
  if (limit) params.set('limit', limit.toString());
  if (offset) params.set('offset', offset.toString());
  const query = params.toString();
  return fetchWithAuth(
    `/api/v1/ai-writing/missions/${missionId}/logs${query ? `?${query}` : ''}`
  );
}

// ==================== Writing Actions ====================

export async function startChapterWriting(
  chapterId: string,
  dto: { prompt?: string; continueFrom?: string }
): Promise<{ success: boolean; message: string }> {
  return fetchWithAuth(`/api/v1/ai-writing/chapters/${chapterId}/write`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

// ==================== Chapter Revision (Version History) ====================

export type RevisionChangeType =
  | 'MANUAL_EDIT'
  | 'AI_REWRITE'
  | 'AI_POLISH'
  | 'AI_EXPAND'
  | 'AI_CONDENSE'
  | 'AI_STYLE_FIX'
  | 'IMPORTED'
  | 'ROLLBACK';

export interface ChapterRevision {
  id: string;
  chapterId: string;
  versionNumber: number;
  content: string;
  wordCount: number;
  changeType: RevisionChangeType;
  changeSummary: string | null;
  changedBy: string;
  aiParams: Record<string, unknown> | null;
  createdAt: string;
}

export interface RevisionDiff {
  revision1: ChapterRevision;
  revision2: ChapterRevision;
  diff: {
    additions: string[];
    deletions: string[];
    changes: Array<{ before: string; after: string }>;
  };
}

export type AiEditOperation =
  | 'rewrite'
  | 'polish'
  | 'expand'
  | 'condense'
  | 'style_fix';

export type PolishLevel = 'light' | 'moderate' | 'heavy';

export interface AiEditDto {
  operation: AiEditOperation;
  selection?: {
    startOffset: number;
    endOffset: number;
    originalText: string;
  };
  userFeedback: string;
  polishLevel?: PolishLevel;
  targetStyle?: {
    tone?: string;
    vocabulary?: string;
    sentenceLength?: string;
  };
}

export interface AiEditResult {
  chapter: {
    id: string;
    content: string;
    wordCount: number;
  };
  revision: ChapterRevision;
  changes: Array<{
    type: string;
    before: string;
    after: string;
    description: string;
  }>;
}

/**
 * 获取章节修订历史
 */
export async function getChapterRevisions(
  chapterId: string
): Promise<{ items: ChapterRevision[]; total: number }> {
  return fetchWithAuth(`/api/v1/ai-writing/chapters/${chapterId}/revisions`);
}

/**
 * 更新章节内容（人工编辑，自动创建版本）
 */
export async function updateChapterContent(
  chapterId: string,
  dto: { content: string; changeSummary?: string }
): Promise<{
  chapter: { id: string; content: string; wordCount: number };
  revision: ChapterRevision;
}> {
  return fetchWithAuth(`/api/v1/ai-writing/chapters/${chapterId}/content`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

/**
 * AI 辅助编辑章节
 */
export async function aiEditChapter(
  chapterId: string,
  dto: AiEditDto
): Promise<AiEditResult> {
  return fetchWithAuth(`/api/v1/ai-writing/chapters/${chapterId}/ai-edit`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/**
 * 比较两个版本
 */
export async function compareRevisions(
  chapterId: string,
  revisionId1: string,
  revisionId2: string
): Promise<RevisionDiff> {
  return fetchWithAuth(
    `/api/v1/ai-writing/chapters/${chapterId}/revisions/diff?v1=${revisionId1}&v2=${revisionId2}`
  );
}

/**
 * 回退到指定版本
 */
export async function rollbackRevision(
  chapterId: string,
  revisionId: string,
  reason?: string
): Promise<{
  chapter: { id: string; content: string; wordCount: number };
  newRevision: ChapterRevision;
}> {
  return fetchWithAuth(
    `/api/v1/ai-writing/chapters/${chapterId}/revisions/${revisionId}/rollback`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }
  );
}

// ==================== Chapter Annotations ====================

export type AnnotationType = 'COMMENT' | 'SUGGESTION' | 'ISSUE' | 'REFERENCE';
export type AnnotationStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';

export interface ChapterAnnotation {
  id: string;
  chapterId: string;
  startOffset: number;
  endOffset: number;
  content: string;
  type: AnnotationType;
  status: AnnotationStatus;
  selectedText: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/**
 * 获取章节批注
 */
export async function getChapterAnnotations(
  chapterId: string,
  status?: AnnotationStatus
): Promise<{ items: ChapterAnnotation[]; total: number }> {
  const params = status ? `?status=${status}` : '';
  return fetchWithAuth(
    `/api/v1/ai-writing/chapters/${chapterId}/annotations${params}`
  );
}

/**
 * 创建批注
 */
export async function createAnnotation(
  chapterId: string,
  dto: {
    startOffset: number;
    endOffset: number;
    content: string;
    type?: AnnotationType;
    selectedText?: string;
  }
): Promise<ChapterAnnotation> {
  return fetchWithAuth(`/api/v1/ai-writing/chapters/${chapterId}/annotations`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/**
 * 更新批注
 */
export async function updateAnnotation(
  chapterId: string,
  annotationId: string,
  dto: { content?: string; status?: AnnotationStatus }
): Promise<ChapterAnnotation> {
  return fetchWithAuth(
    `/api/v1/ai-writing/chapters/${chapterId}/annotations/${annotationId}`,
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
  chapterId: string,
  annotationId: string
): Promise<{ success: boolean }> {
  return fetchWithAuth(
    `/api/v1/ai-writing/chapters/${chapterId}/annotations/${annotationId}`,
    {
      method: 'DELETE',
    }
  );
}

/**
 * 批量解决批注
 */
export async function resolveAnnotations(
  chapterId: string,
  annotationIds: string[]
): Promise<{ resolved: number }> {
  return fetchWithAuth(
    `/api/v1/ai-writing/chapters/${chapterId}/annotations/resolve`,
    {
      method: 'POST',
      body: JSON.stringify({ annotationIds }),
    }
  );
}

// ==================== Chapter Import ====================

export type ImportSource =
  | 'PASTE'
  | 'FILE_TXT'
  | 'FILE_DOCX'
  | 'FILE_EPUB'
  | 'FILE_MD'
  | 'URL_QIDIAN'
  | 'URL_JJWXC'
  | 'URL_FANQIE'
  | 'URL_OTHER';

export type ImportStatus =
  | 'PENDING'
  | 'PARSING'
  | 'PREVIEWING'
  | 'IMPORTING'
  | 'POST_PROCESSING'
  | 'COMPLETED'
  | 'FAILED';

export type ChapterPatternType =
  | 'auto'
  | 'standard_chinese'
  | 'chapter_number'
  | 'numbered'
  | 'custom';

export type ConflictStrategy = 'skip' | 'overwrite' | 'append';

export interface ChapterPreview {
  index: number;
  title: string;
  wordCount: number;
  preview: string;
  content: string;
}

export interface ParseImportResult {
  success: boolean;
  importId: string;
  preview: {
    totalChapters: number;
    totalWords: number;
    chapters: ChapterPreview[];
  };
}

export interface ImportStatusResponse {
  id: string;
  status: ImportStatus;
  source: ImportSource;
  totalChapters: number;
  totalWords: number;
  progress?: {
    current: number;
    total: number;
    currentChapter?: string;
  };
  result?: {
    importedChapterIds: string[];
    skippedCount: number;
    errors: Array<{ chapter: string; error: string }>;
  };
  postProcessStatus?: {
    consistencyCheck: 'pending' | 'running' | 'completed' | 'skipped';
    bibleExtraction: 'pending' | 'running' | 'completed' | 'skipped';
  };
  createdAt: string;
  completedAt: string | null;
}

export interface ImportHistoryItem {
  id: string;
  source: ImportSource;
  fileName: string | null;
  sourceUrl: string | null;
  totalChapters: number;
  totalWords: number;
  status: ImportStatus;
  importedChapterIds: string[];
  createdAt: string;
  completedAt: string | null;
}

/**
 * 解析导入内容
 */
export async function parseImport(
  projectId: string,
  dto: {
    source: ImportSource;
    content?: string;
    sourceUrl?: string;
    fileName?: string;
    chapterPattern?: ChapterPatternType;
    customPattern?: string;
  }
): Promise<ParseImportResult> {
  return fetchWithAuth(
    `/api/v1/ai-writing/projects/${projectId}/import/parse`,
    {
      method: 'POST',
      body: JSON.stringify(dto),
    }
  );
}

/**
 * 确认并执行导入
 */
export async function confirmImport(
  projectId: string,
  importId: string,
  dto: {
    targetVolumeId: string;
    startChapterNumber: number;
    selectedChapters: number[];
    conflictStrategy?: ConflictStrategy;
    postProcess?: {
      runConsistencyCheck?: boolean;
      extractToBible?: boolean;
    };
  }
): Promise<{ success: boolean; importId: string }> {
  return fetchWithAuth(
    `/api/v1/ai-writing/projects/${projectId}/import/${importId}/confirm`,
    {
      method: 'POST',
      body: JSON.stringify(dto),
    }
  );
}

/**
 * 获取导入状态
 */
export async function getImportStatus(
  projectId: string,
  importId: string
): Promise<ImportStatusResponse> {
  return fetchWithAuth(
    `/api/v1/ai-writing/projects/${projectId}/import/${importId}`
  );
}

/**
 * 获取导入历史
 */
export async function getImportHistory(
  projectId: string
): Promise<{ items: ImportHistoryItem[]; total: number }> {
  return fetchWithAuth(
    `/api/v1/ai-writing/projects/${projectId}/import/history`
  );
}

/**
 * 取消导入
 */
export async function cancelImport(
  projectId: string,
  importId: string
): Promise<{ success: boolean }> {
  return fetchWithAuth(
    `/api/v1/ai-writing/projects/${projectId}/import/${importId}`,
    {
      method: 'DELETE',
    }
  );
}

// ==================== DOME/SCORE Enhanced Features API ====================

// Story Completion Analysis Types
export interface CompletionSignal {
  type: string;
  confidence: number;
  evidence: string;
  source: string;
}

export interface CompletionAnalysis {
  isComplete: boolean;
  confidence: number;
  signals: CompletionSignal[];
  recommendation: string;
}

export interface CompletionAnalysisResponse {
  projectId: string;
  analysis: CompletionAnalysis;
  analyzedAt: string;
}

// Timeline Conflict Types
export type ConflictSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface TimelineConflict {
  id: string;
  type: string;
  severity: ConflictSeverity;
  description: string;
  sourceChapter: number;
  targetChapter?: number;
  subject: string;
  conflictingStatements: string[];
  suggestedResolution?: string;
}

export interface TimelineConflictsResponse {
  projectId: string;
  conflicts: TimelineConflict[];
  totalConflicts: number;
  analyzedAt: string;
}

// Hierarchical Summary Types
export interface SceneSummary {
  sceneNumber: number;
  summary: string;
  location?: string;
  characters: string[];
  keyAction?: string;
}

export interface ChapterSummary {
  chapterNumber: number;
  title: string;
  summary: string;
  keyEvents: string[];
  emotionalTone: string;
  characterChanges: Record<string, string>;
  scenes?: SceneSummary[];
}

export interface HierarchicalContext {
  recentChapters: ChapterSummary[];
  mediumChapters: ChapterSummary[];
  distantContext: string;
  estimatedTokens: number;
}

export interface HierarchicalSummariesResponse {
  projectId: string;
  context: HierarchicalContext;
  formattedContext: string;
}

// Scratchpad Types
export type ScratchpadEntryType =
  | 'QUESTION'
  | 'ANSWER'
  | 'FACT'
  | 'DECISION'
  | 'TODO'
  | 'WARNING';

export interface ScratchpadEntry {
  id: string;
  type: ScratchpadEntryType;
  content: string;
  source: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ScratchpadResponse {
  projectId: string;
  entries: ScratchpadEntry[];
  totalEntries: number;
}

// Analysis Dashboard Types
export interface AnalysisDashboard {
  projectId: string;
  projectName: string;
  completion: {
    isComplete: boolean;
    confidence: number;
    signals: CompletionSignal[];
    recommendation: string;
  } | null;
  conflicts: {
    total: number;
    highSeverity: number;
    mediumSeverity: number;
    lowSeverity: number;
    recentConflicts: TimelineConflict[];
  };
  agentActivity: {
    recentEntries: ScratchpadEntry[];
    totalEntries: number;
  };
  analyzedAt: string;
}

/**
 * 获取故事完成度分析
 */
export async function getCompletionAnalysis(
  projectId: string
): Promise<CompletionAnalysisResponse> {
  return fetchWithAuth(
    `/api/v1/ai-writing/projects/${projectId}/completion-analysis`
  );
}

/**
 * 获取项目时间线冲突
 */
export async function getTimelineConflicts(
  projectId: string
): Promise<TimelineConflictsResponse> {
  return fetchWithAuth(
    `/api/v1/ai-writing/projects/${projectId}/timeline-conflicts`
  );
}

/**
 * 获取章节时间线冲突
 */
export async function getChapterTimelineConflicts(chapterId: string): Promise<{
  chapterId: string;
  conflicts: TimelineConflict[];
  totalConflicts: number;
  analyzedAt: string;
}> {
  return fetchWithAuth(
    `/api/v1/ai-writing/chapters/${chapterId}/timeline-conflicts`
  );
}

/**
 * 获取层次摘要上下文
 */
export async function getHierarchicalSummaries(
  projectId: string,
  options?: { currentChapter?: number; targetTokens?: number }
): Promise<HierarchicalSummariesResponse> {
  const params = new URLSearchParams();
  if (options?.currentChapter) {
    params.set('currentChapter', options.currentChapter.toString());
  }
  if (options?.targetTokens) {
    params.set('targetTokens', options.targetTokens.toString());
  }
  const query = params.toString();
  return fetchWithAuth(
    `/api/v1/ai-writing/projects/${projectId}/hierarchical-summaries${query ? `?${query}` : ''}`
  );
}

/**
 * 批量生成章节摘要
 */
export async function generateSummaries(
  projectId: string
): Promise<{ projectId: string; updatedCount: number; message: string }> {
  return fetchWithAuth(
    `/api/v1/ai-writing/projects/${projectId}/generate-summaries`,
    {
      method: 'POST',
    }
  );
}

/**
 * 获取共享便签板内容
 */
export async function getScratchpad(
  projectId: string,
  options?: { type?: ScratchpadEntryType; limit?: number }
): Promise<ScratchpadResponse> {
  const params = new URLSearchParams();
  if (options?.type) {
    params.set('type', options.type);
  }
  if (options?.limit) {
    params.set('limit', options.limit.toString());
  }
  const query = params.toString();
  return fetchWithAuth(
    `/api/v1/ai-writing/projects/${projectId}/scratchpad${query ? `?${query}` : ''}`
  );
}

/**
 * 获取项目分析仪表板
 */
export async function getAnalysisDashboard(
  projectId: string
): Promise<AnalysisDashboard> {
  return fetchWithAuth(
    `/api/v1/ai-writing/projects/${projectId}/analysis-dashboard`
  );
}

// ==================== Writing Mission Canonical View (W3) ====================
// Mirror types from backend writing-artifact.projector.ts + writing-mission-read.controller.ts.
// Do NOT hand-write these shapes — they are copied from the backend source of truth.

/** Mirror of WritingArtifact (backend: PersistPhaseCtx["writingArtifact"]) */
export interface WritingArtifact {
  id: string;
  projectId: string;
  sections: Array<{
    chapterId: string;
    chapterNumber: number;
    title: string;
    wordCount: number;
    quality?: number;
  }>;
  metadata: {
    totalWords: number;
    chapterCount: number;
  };
  quality: {
    overall: number;
    consistency: number;
    completeness: number;
  };
}

/** Mirror of WritingChapterListView (backend: writing-artifact.projector.ts) */
export interface WritingChapterListView {
  chapterCount: number;
  chapters: Array<{
    chapterId: string;
    chapterNumber: number;
    title: string;
    wordCount: number;
    quality?: number;
  }>;
  totalWords: number;
}

/** Mirror of WritingFullTextView (backend: writing-artifact.projector.ts) */
export interface WritingFullTextView {
  topic: string;
  premise?: string;
  theme?: string;
  chapterTitles: string[];
  totalWords: number;
  qualityScore: number;
}

/** Mirror of WritingQualityReportView (backend: writing-artifact.projector.ts) */
export interface WritingQualityReportView {
  overall: number;
  score: number;
  passed: boolean;
  dimensions: {
    coherence: number;
    completeness: number;
    consistency: number;
  };
  chapterCount: number;
  revisedCount: number;
  reason?: string;
}

/**
 * Mirror of WritingMissionViewEnvelope (backend: writing-mission-read.controller.ts).
 * Backend returns this directly (not wrapped under a "view" key).
 */
export interface WritingMissionViewEnvelope {
  missionId: string;
  status: string;
  writingArtifact: WritingArtifact | null;
  chapterList: WritingChapterListView | null;
  fullText: WritingFullTextView | null;
  qualityReport: WritingQualityReportView | null;
  /** Terminal event types that signal the view should be re-fetched */
  refreshHints: string[];
}

/**
 * GET /api/v1/ai-writing/missions/:id/view
 *
 * Canonical truth endpoint for writing mission detail.
 * Returns WritingArtifact + 3 views projected by WritingArtifactProjector.
 * writingArtifact/chapterList/fullText/qualityReport are null when mission
 * has no REVISED chapters yet (in progress or not started).
 */
export async function getWritingMissionView(
  missionId: string,
  opts?: { signal?: AbortSignal }
): Promise<WritingMissionViewEnvelope> {
  return fetchWithAuth<WritingMissionViewEnvelope>(
    `/api/v1/ai-writing/missions/${encodeURIComponent(missionId)}/view`,
    { signal: opts?.signal }
  );
}

// TODO: writingReplay — backend replay endpoint (GET /api/v1/ai-writing/replay/:missionId?since=)
// does not exist yet (W1 backend wave pending). Once backend adds MissionEventBuffer adapter
// and the replay route in WritingMissionReadController, implement:
//
//   export interface WritingReplayEvent {
//     type: string;
//     payload: unknown;
//     agentId?: string;
//     traceId?: string;
//     timestamp: number;
//   }
//   export interface WritingReplayResponse {
//     events: WritingReplayEvent[];
//     serverNow: number;
//   }
//   export async function writingReplay(
//     missionId: string,
//     sinceTs?: number
//   ): Promise<WritingReplayResponse> { ... }
//
// Until then, useMissionStream for writing uses terminal-event refetch + shouldPoll fallback.
