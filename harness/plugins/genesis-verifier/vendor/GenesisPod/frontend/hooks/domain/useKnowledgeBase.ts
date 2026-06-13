'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useApiGet, useApiPost, useApiMutation } from '@/hooks/core';
import { apiClient } from '@/lib/api/client';

/**
 * KB 向量化进度形状（与后端 KbVectorizeProgress 对齐，2026-05-12）
 */
export interface KbVectorizeProgress {
  stage: 'embedding' | 'cooling';
  processed: number;
  total: number;
  startedAt: string;
  cooldownUntil?: string;
  lastError?: string;
}

export interface KbProgressResponse {
  status: KnowledgeBase['status'];
  progress: KbVectorizeProgress | null;
  lastError?: string | null;
}

/**
 * Knowledge Base 类型定义
 */
export type KnowledgeBaseSourceType =
  | 'GOOGLE_DRIVE'
  | 'MANUAL'
  | 'URL'
  | 'NOTION'
  | 'BOOKMARK'
  | 'NOTE'
  | 'IMAGE';

export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  type?: 'PERSONAL' | 'TEAM';
  visibility?: 'PRIVATE' | 'SHARED' | 'PUBLIC';
  sourceType: KnowledgeBaseSourceType; // 保持向后兼容
  sourceTypes?: KnowledgeBaseSourceType[]; // 新增：多数据源类型
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'UPDATING' | 'ERROR';
  teamId?: string;
  googleDriveConnectionId?: string;
  googleDriveFolderIds?: string[];
  googleDriveFileIds?: string[]; // 单独选择的文件 IDs
  lastSyncedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    documents: number;
  };
  // 团队成员 (仅团队知识库)
  members?: { id: string }[];
}

export interface KnowledgeBaseStats {
  documentCount: number;
  parentChunkCount: number;
  childChunkCount: number;
  embeddingCount: number; // 向量化数量
  totalTokens: number;
  lastSyncedAt?: string;
}

export interface KnowledgeBaseDocument {
  id: string;
  title: string;
  sourceType: string;
  sourceId?: string;
  sourceUrl?: string;
  mimeType?: string;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'ERROR';
  processedAt?: string;
  chunkCount: number;
  embeddingCount?: number;
  isVectorized?: boolean;
  lastError?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateKnowledgeBaseDto {
  name: string;
  description?: string;
  type?: 'PERSONAL' | 'TEAM';
  sourceType: KnowledgeBaseSourceType; // 保持向后兼容
  sourceTypes?: KnowledgeBaseSourceType[]; // 新增：多数据源类型
  teamId?: string;
  googleDriveConnectionId?: string;
  googleDriveFolderIds?: string[];
  googleDriveFileIds?: string[]; // 单独选择的文件 IDs
}

export interface AddDocumentDto {
  title: string;
  content: string;
  sourceType?: string;
  sourceUrl?: string;
  mimeType?: string;
}

export interface GoogleDriveFolder {
  id: string;
  name: string;
  parentId?: string;
  fileCount: number;
  modifiedTime?: string;
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
}

export interface RAGQueryResult {
  context: {
    text: string;
    sources: Array<{
      documentId: string;
      documentTitle: string;
      chunkId: string;
      excerpt: string;
      score: number;
      pageStart?: number;
      pageEnd?: number;
      sectionTitle?: string;
    }>;
    totalTokens: number;
  };
  hydeQuery?: string;
  searchResults: Array<{
    childChunkId: string;
    parentChunkId: string;
    documentId: string;
    content: string;
    parentContent: string;
    score: number;
  }>;
  processingTime: {
    hyde?: number;
    search: number;
    rerank?: number;
    total: number;
  };
}

/**
 * Knowledge Base 管理 Hook
 */
export function useKnowledgeBase() {
  const [deleting, setDeleting] = useState(false);

  // 获取知识库列表 - 不使用缓存，每次都从API获取
  const {
    data: knowledgeBases,
    loading: listLoading,
    error: listError,
    execute: fetchList,
  } = useApiGet<KnowledgeBase[]>('/rag/knowledge-bases', {
    immediate: true,
    initialData: [],
    // 不使用缓存 - 每次都从API获取最新数据
  });

  // 创建知识库
  const { execute: createKnowledgeBase, loading: creating } = useApiPost<
    KnowledgeBase,
    CreateKnowledgeBaseDto
  >('/rag/knowledge-bases');

  // 删除知识库 - 使用 apiClient 直接调用
  const deleteKnowledgeBase = useCallback(
    async (id: string) => {
      setDeleting(true);
      try {
        await apiClient.delete(`/rag/knowledge-bases/${id}`);
        await fetchList();
      } finally {
        setDeleting(false);
      }
    },
    [fetchList]
  );

  const setVisibility = useCallback(
    async (id: string, visibility: 'PRIVATE' | 'SHARED' | 'PUBLIC') => {
      await apiClient.patch(`/rag/knowledge-bases/${id}/visibility`, {
        visibility,
      });
      await fetchList();
    },
    [fetchList]
  );

  return {
    knowledgeBases: knowledgeBases || [],
    loading: listLoading,
    error: listError,
    creating,
    deleting,
    fetchList,
    refreshList: fetchList, // 直接调用 API，无缓存
    createKnowledgeBase: async (dto: CreateKnowledgeBaseDto) => {
      const result = await createKnowledgeBase(dto);
      await fetchList(); // 创建后刷新列表
      return result;
    },
    deleteKnowledgeBase,
    setVisibility,
  };
}

/**
 * 单个知识库详情 Hook
 */
export function useKnowledgeBaseDetail(id: string | null) {
  // 获取知识库详情 - 只在有 id 时请求
  const {
    data: knowledgeBase,
    loading,
    error,
    execute: refresh,
  } = useApiGet<KnowledgeBase>(id ? `/rag/knowledge-bases/${id}` : '', {
    immediate: !!id,
    deps: [id],
  });

  // 获取统计信息
  const {
    data: stats,
    loading: statsLoading,
    execute: fetchStats,
  } = useApiGet<KnowledgeBaseStats>(
    id ? `/rag/knowledge-bases/${id}/stats` : '',
    { immediate: !!id, deps: [id] }
  );

  // 获取文档列表 (带向量化状态)
  const {
    data: documents,
    loading: docsLoading,
    execute: fetchDocuments,
  } = useApiGet<KnowledgeBaseDocument[]>(
    id ? `/rag/knowledge-bases/${id}/documents` : '',
    { immediate: !!id, deps: [id] }
  );

  // 更新知识库
  const { execute: updateKnowledgeBase, loading: updating } = useApiMutation<
    KnowledgeBase,
    Partial<CreateKnowledgeBaseDto>
  >('patch', id ? `/rag/knowledge-bases/${id}` : '');

  // 处理文档
  const { execute: processDocuments, loading: processing } = useApiPost<
    { processed: number },
    Record<string, never>
  >(id ? `/rag/knowledge-bases/${id}/process` : '');

  // 同步 Google Drive
  const { execute: syncGoogleDrive, loading: syncing } = useApiPost<
    {
      added: number;
      updated: number;
      deleted: number;
      errors: string[];
    },
    Record<string, never>
  >(id ? `/rag/knowledge-bases/${id}/sync` : '');

  // 添加文档
  const { execute: addDocument, loading: addingDocument } = useApiPost<
    KnowledgeBaseDocument,
    AddDocumentDto
  >(id ? `/rag/knowledge-bases/${id}/documents` : '');

  // 删除文档状态
  const [deletingDocument, setDeletingDocument] = useState(false);

  // 向量化进度（2026-05-12）：当 KB.status === 'PROCESSING' 时 2s 轮询 /progress
  const [progress, setProgress] = useState<KbVectorizeProgress | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // 清理已有轮询
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }

    if (!id) return;

    const shouldPoll = processing || knowledgeBase?.status === 'PROCESSING';
    if (!shouldPoll) {
      setProgress(null);
      return;
    }

    let aborted = false;
    const fetchProgress = async () => {
      try {
        const resp = await apiClient.get<KbProgressResponse>(
          `/rag/knowledge-bases/${id}/progress`
        );
        if (aborted) return;
        setProgress(resp?.progress ?? null);
        // status 切走（READY/ERROR）→ 刷新 KB / stats / docs 并停轮询
        if (resp?.status && resp.status !== 'PROCESSING') {
          await Promise.all([refresh(), fetchStats(), fetchDocuments()]);
          if (progressTimerRef.current) {
            clearInterval(progressTimerRef.current);
            progressTimerRef.current = null;
          }
        }
      } catch {
        // 网络抖动忽略，下次 tick 再试
      }
    };

    void fetchProgress();
    progressTimerRef.current = setInterval(fetchProgress, 2000);

    return () => {
      aborted = true;
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    };
  }, [
    id,
    processing,
    knowledgeBase?.status,
    refresh,
    fetchStats,
    fetchDocuments,
  ]);

  return {
    knowledgeBase: id ? knowledgeBase : undefined,
    stats: id ? stats : undefined,
    documents: id ? documents : undefined,
    loading: id ? loading || statsLoading || docsLoading : false,
    updating,
    processing,
    syncing,
    addingDocument,
    progress,
    error: id ? error : null,
    refresh,
    fetchStats,
    fetchDocuments,
    updateKnowledgeBase: async (data: Partial<CreateKnowledgeBaseDto>) => {
      if (!id) return undefined;
      const result = await updateKnowledgeBase(data);
      await refresh();
      return result;
    },
    processDocuments: async () => {
      if (!id) return undefined;
      const result = await processDocuments({} as Record<string, never>);
      await Promise.all([refresh(), fetchStats(), fetchDocuments()]);
      return result;
    },
    syncGoogleDrive: async () => {
      if (!id) return undefined;
      const result = await syncGoogleDrive({} as Record<string, never>);
      await Promise.all([refresh(), fetchStats(), fetchDocuments()]);
      return result;
    },
    addDocument: async (doc: AddDocumentDto) => {
      if (!id) return undefined;
      const result = await addDocument(doc);
      await Promise.all([refresh(), fetchStats(), fetchDocuments()]);
      return result;
    },
    deletingDocument,
    deleteDocument: async (documentId: string) => {
      setDeletingDocument(true);
      try {
        await apiClient.delete(`/rag/documents/${documentId}`);
        await fetchStats();
        await fetchDocuments();
      } finally {
        setDeletingDocument(false);
      }
    },
  };
}

/**
 * Google Drive 文件夹选择 Hook
 */
export function useGoogleDriveFolders() {
  const [folders, setFolders] = useState<GoogleDriveFolder[]>([]);
  const [files, setFiles] = useState<GoogleDriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [parentStack, setParentStack] = useState<
    Array<{ id: string; name: string }>
  >([]);

  const fetchFolders = useCallback(async (parentId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = parentId
        ? `/rag/google-drive/folders?parentId=${parentId}`
        : '/rag/google-drive/folders';
      const data = await apiClient.get<{
        folders: GoogleDriveFolder[];
        files: GoogleDriveFile[];
      }>(url);
      setFolders(data.folders);
      setFiles(data.files);
      return data;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const navigateToFolder = useCallback(
    async (folder: GoogleDriveFolder) => {
      setParentStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
      await fetchFolders(folder.id);
    },
    [fetchFolders]
  );

  const navigateBack = useCallback(async () => {
    if (parentStack.length === 0) return;

    const newStack = [...parentStack];
    newStack.pop();
    setParentStack(newStack);

    const parentId =
      newStack.length > 0 ? newStack[newStack.length - 1].id : undefined;
    await fetchFolders(parentId);
  }, [parentStack, fetchFolders]);

  const navigateToRoot = useCallback(async () => {
    setParentStack([]);
    await fetchFolders();
  }, [fetchFolders]);

  return {
    folders,
    files,
    loading,
    error,
    parentStack,
    currentParentId:
      parentStack.length > 0
        ? parentStack[parentStack.length - 1].id
        : undefined,
    fetchFolders,
    navigateToFolder,
    navigateBack,
    navigateToRoot,
  };
}

/**
 * RAG 查询 Hook
 */
export function useRAGQuery() {
  const [result, setResult] = useState<RAGQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const query = useCallback(
    async (
      queryText: string,
      knowledgeBaseIds: string[],
      options?: {
        topK?: number;
        useHyde?: boolean;
        useRerank?: boolean;
        hybridAlpha?: number;
        minScore?: number;
      }
    ) => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiClient.post<RAGQueryResult>('/rag/query', {
          query: queryText,
          knowledgeBaseIds,
          ...options,
        });
        setResult(data);
        return data;
      } catch (err) {
        setError(err as Error);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    result,
    loading,
    error,
    query,
    reset,
  };
}
