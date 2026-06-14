/**
 * AI File Organizer API 客户端
 */

import { apiClient } from '@/lib/api/client';
import { getAuthHeader } from '@/lib/utils/auth';

// ==================== 类型定义 ====================

export interface FileInfo {
  id: string;
  name: string;
  mimeType?: string;
  content?: string;
  description?: string;
  size?: number;
  createdAt?: string;
  modifiedAt?: string;
  source: 'google_drive' | 'notion' | 'library';
}

export interface CategorySuggestion {
  category: string;
  confidence: number;
  reason: string;
}

export interface TagSuggestion {
  tag: string;
  confidence: number;
  reason: string;
}

export interface FolderSuggestion {
  folderPath: string;
  confidence: number;
  reason: string;
}

export interface OrganizationSuggestion {
  fileId: string;
  fileName: string;
  categories: CategorySuggestion[];
  tags: TagSuggestion[];
  suggestedFolder: FolderSuggestion | null;
  summary: string;
  relatedFiles?: string[];
}

export interface BatchOrganizationResult {
  success: boolean;
  suggestions: OrganizationSuggestion[];
  totalFiles: number;
  processedFiles: number;
  errors: Array<{ fileId: string; error: string }>;
}

export interface ApplySuggestionParams {
  resourceId: string;
  suggestion: Partial<OrganizationSuggestion>;
}

export interface RelatedFile {
  id: string;
  title: string;
  similarity: number;
}

// ==================== API 函数 ====================

/**
 * 分析文件并生成整理建议
 */
export async function analyzeFiles(
  files: FileInfo[]
): Promise<BatchOrganizationResult> {
  return apiClient.post(
    '/ai-organizer/analyze',
    { files },
    { headers: getAuthHeader() }
  );
}

/**
 * 分析单个文件
 */
export async function analyzeSingleFile(
  file: FileInfo
): Promise<{ success: boolean; suggestion: OrganizationSuggestion }> {
  return apiClient.post('/ai-organizer/analyze-single', file, {
    headers: getAuthHeader(),
  });
}

/**
 * 应用整理建议到资源
 */
export async function applySuggestion(
  params: ApplySuggestionParams
): Promise<{ success: boolean; message: string }> {
  return apiClient.post('/ai-organizer/apply', params, {
    headers: getAuthHeader(),
  });
}

/**
 * 获取现有分类列表
 */
export async function getCategories(): Promise<{ categories: string[] }> {
  return apiClient.get('/ai-organizer/categories', {
    headers: getAuthHeader(),
  });
}

/**
 * 获取现有标签列表
 */
export async function getTags(): Promise<{ tags: string[] }> {
  return apiClient.get('/ai-organizer/tags', {
    headers: getAuthHeader(),
  });
}

/**
 * 查找相关文件
 */
export async function findRelatedFiles(
  fileId: string,
  file: FileInfo
): Promise<{ relatedFiles: RelatedFile[] }> {
  return apiClient.get(`/ai-organizer/related/${fileId}`, {
    headers: getAuthHeader(),
    body: JSON.stringify(file),
  });
}

// ==================== 默认导出 ====================

export default {
  analyzeFiles,
  analyzeSingleFile,
  applySuggestion,
  getCategories,
  getTags,
  findRelatedFiles,
};
