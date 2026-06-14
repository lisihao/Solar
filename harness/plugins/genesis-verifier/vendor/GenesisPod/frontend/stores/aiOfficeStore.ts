/**
 * AI Office Zustand Store
 * 管理AI Office的全局状态
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Resource,
  Document,
  ChatMessage,
  UIState,
  ResourceType,
  DocumentType,
  DocumentVersion,
  AIConfig,
} from '@/lib/types/ai-office';
import { calculateSlideCount } from '@/lib/features/ai-office/ppt-utils';
import { logger } from '@/lib/utils/logger';

// ============================================================================
// Resource Store (持久化 + 去重)
// ============================================================================

interface ResourceState {
  resources: Resource[];
  selectedResourceIds: string[];
  isLoading: boolean;
  error: string | null;

  // Actions
  addResource: (resource: Resource) => void;
  removeResource: (id: string) => void;
  updateResource: (id: string, updates: Partial<Resource>) => void;
  selectResource: (id: string) => void;
  deselectResource: (id: string) => void;
  clearSelection: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useResourceStore = create<ResourceState>()(
  persist(
    (set) => ({
      resources: [],
      selectedResourceIds: [],
      isLoading: false,
      error: null,

      addResource: (resource) =>
        set((state) => {
          // 去重：检查资源是否已存在
          const exists = state.resources.some((r) => r._id === resource._id);
          if (exists) {
            logger.warn(`Resource ${resource._id} already exists, skipping`);
            return state;
          }
          return {
            resources: [...state.resources, resource],
          };
        }),

      removeResource: (id) =>
        set((state) => ({
          resources: state.resources.filter((r) => r._id !== id),
          selectedResourceIds: state.selectedResourceIds.filter(
            (rid) => rid !== id
          ),
        })),

      updateResource: (id, updates) =>
        set((state) => ({
          resources: state.resources.map((r) =>
            r._id === id ? ({ ...r, ...updates } as Resource) : r
          ),
        })),

      selectResource: (id) =>
        set((state) => ({
          selectedResourceIds: state.selectedResourceIds.includes(id)
            ? state.selectedResourceIds
            : [...state.selectedResourceIds, id],
        })),

      deselectResource: (id) =>
        set((state) => ({
          selectedResourceIds: state.selectedResourceIds.filter(
            (rid) => rid !== id
          ),
        })),

      clearSelection: () =>
        set({
          selectedResourceIds: [],
        }),

      setLoading: (loading) =>
        set({
          isLoading: loading,
        }),

      setError: (error) =>
        set({
          error,
        }),
    }),
    {
      name: 'ai-office-resource-storage',
      partialize: (state) => ({
        resources: state.resources,
        selectedResourceIds: state.selectedResourceIds,
      }),
      onRehydrateStorage: () => {
        return (state, action) => {
          // Prevent hydration errors during server-side rendering
          if (typeof window === 'undefined') {
            return;
          }
        };
      },
    }
  )
);

// ============================================================================
// Document Store
// ============================================================================

export interface GenerationStep {
  id: string;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  message?: string;
}

interface DocumentState {
  documents: Document[];
  currentDocumentId: string | null;
  selectedSlideIndex: number | null; // 选中的幻灯片索引（用于页面级别编辑）
  isGenerating: boolean;
  generationProgress: number;
  generationSteps: GenerationStep[];
  currentStep: string;
  resourcesFound: number;
  estimatedTime: number | null;
  error: string | null;

  // Actions
  addDocument: (document: Document) => void;
  updateDocument: (id: string, updates: Partial<Document>) => void;
  deleteDocument: (id: string) => void;
  setCurrentDocument: (id: string | null) => void;
  setSelectedSlideIndex: (index: number | null) => void; // 设置选中的幻灯片
  setGenerating: (generating: boolean) => void;
  setGenerationProgress: (progress: number) => void;
  setGenerationSteps: (steps: GenerationStep[]) => void;
  updateGenerationStep: (
    stepId: string,
    updates: Partial<GenerationStep>
  ) => void;
  setCurrentStep: (stepId: string) => void;
  setResourcesFound: (count: number) => void;
  setEstimatedTime: (seconds: number | null) => void;
  setError: (error: string | null) => void;

  // Version management actions
  saveVersion: (
    documentId: string,
    type: 'auto' | 'manual',
    trigger: 'ai_generation' | 'user_edit' | 'manual_save',
    description?: string
  ) => string; // 返回版本ID
  getVersions: (documentId: string) => DocumentVersion[];
  restoreVersion: (documentId: string, versionId: string) => void;
  deleteVersion: (documentId: string, versionId: string) => void;
}

export const useDocumentStore = create<DocumentState>()(
  persist(
    (set, get) => ({
      documents: [],
      currentDocumentId: null,
      selectedSlideIndex: null,
      isGenerating: false,
      generationProgress: 0,
      generationSteps: [],
      currentStep: '',
      resourcesFound: 0,
      estimatedTime: null,
      error: null,

      addDocument: (document) =>
        set((state) => ({
          documents: [...state.documents, document],
        })),

      updateDocument: (id, updates) =>
        set((state) => ({
          documents: state.documents.map((d) =>
            d._id === id ? ({ ...d, ...updates } as Document) : d
          ),
        })),

      deleteDocument: (id) =>
        set((state) => ({
          documents: state.documents.filter((d) => d._id !== id),
          currentDocumentId:
            state.currentDocumentId === id ? null : state.currentDocumentId,
        })),

      setCurrentDocument: (id) =>
        set({
          currentDocumentId: id,
          selectedSlideIndex: null, // 切换文档时清除选中的幻灯片
        }),

      setSelectedSlideIndex: (index) =>
        set({
          selectedSlideIndex: index,
        }),

      setGenerating: (generating) =>
        set({
          isGenerating: generating,
          // 重置进度状态
          ...(generating === false && {
            generationSteps: [],
            currentStep: '',
            resourcesFound: 0,
            estimatedTime: null,
          }),
        }),

      setGenerationProgress: (progress) =>
        set({
          generationProgress: progress,
        }),

      setGenerationSteps: (steps) =>
        set({
          generationSteps: steps,
        }),

      updateGenerationStep: (stepId, updates) =>
        set((state) => ({
          generationSteps: state.generationSteps.map((step) =>
            step.id === stepId ? { ...step, ...updates } : step
          ),
        })),

      setCurrentStep: (stepId) =>
        set({
          currentStep: stepId,
        }),

      setResourcesFound: (count) =>
        set({
          resourcesFound: count,
        }),

      setEstimatedTime: (seconds) =>
        set({
          estimatedTime: seconds,
        }),

      setError: (error) =>
        set({
          error,
        }),

      // Version management implementations
      saveVersion: (documentId, type, trigger, description) => {
        logger.debug('[saveVersion] Called with:', {
          documentId,
          type,
          trigger,
          description,
        });
        let versionId = '';
        set((state) => {
          const document = state.documents.find((d) => d._id === documentId);
          if (!document) {
            logger.warn('[saveVersion] Document not found:', documentId);
            return state;
          }

          // 生成版本ID
          versionId = `v_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          // 计算 slideCount（如果是PPT文档）
          let slideCount = document.metadata.slideCount;
          if (
            document.type === 'ppt' &&
            typeof document.content === 'object' &&
            document.content !== null &&
            'markdown' in document.content
          ) {
            slideCount = calculateSlideCount(
              (document.content as { markdown: string }).markdown
            );
          }

          // 创建版本快照 - 深拷贝内容
          const version: DocumentVersion = {
            id: versionId,
            timestamp: new Date(),
            type,
            trigger,
            content: JSON.parse(JSON.stringify(document.content)), // 深拷贝当前内容
            metadata: {
              title: document.title,
              wordCount: document.metadata.wordCount,
              slideCount: slideCount,
              description,
            },
          };

          // 如果有AI配置，记录模型信息
          if (document.aiConfig) {
            version.aiModel = document.aiConfig.model;
          }

          const currentVersionCount = document.versions?.length || 0;
          logger.debug('[saveVersion] Creating version:', {
            versionId,
            slideCount,
            currentVersionCount,
            newVersionCount: currentVersionCount + 1,
          });

          return {
            documents: state.documents.map((d) =>
              d._id === documentId
                ? {
                    ...d,
                    versions: [...(d.versions || []), version],
                    currentVersionId: versionId,
                    updatedAt: new Date(),
                  }
                : d
            ),
          };
        });

        // 验证版本是否被正确保存
        const updatedDoc = useDocumentStore
          .getState()
          .documents.find((d) => d._id === documentId);
        logger.debug(
          '[saveVersion] Version saved successfully. Total versions:',
          updatedDoc?.versions?.length || 0
        );

        return versionId;
      },

      getVersions: (documentId: string): DocumentVersion[] => {
        const state = get();
        const document = state.documents.find((d) => d._id === documentId);
        return document?.versions || [];
      },

      restoreVersion: (documentId, versionId) => {
        set((state) => {
          const document = state.documents.find((d) => d._id === documentId);
          if (!document) return state;

          const version = document.versions?.find((v) => v.id === versionId);
          if (!version) return state;

          // 恢复版本内容
          const updatedDocuments = state.documents.map((d) =>
            d._id === documentId
              ? ({
                  ...d,
                  content: version.content,
                  currentVersionId: versionId,
                  metadata: {
                    ...d.metadata,
                    wordCount: version.metadata.wordCount,
                    slideCount: version.metadata.slideCount,
                  },
                  updatedAt: new Date(),
                } as Document)
              : d
          );

          return {
            documents: updatedDocuments,
          };
        });
      },

      deleteVersion: (documentId, versionId) => {
        set((state) => ({
          documents: state.documents.map((d) =>
            d._id === documentId
              ? {
                  ...d,
                  versions: d.versions?.filter((v) => v.id !== versionId) || [],
                }
              : d
          ),
        }));
      },
    }),
    {
      name: 'ai-office-document-storage',
      partialize: (state) => ({
        documents: state.documents,
        currentDocumentId: state.currentDocumentId,
      }),
    }
  )
);

// ============================================================================
// Chat Store
// ============================================================================

interface ChatState {
  sessions: Record<string, ChatMessage[]>; // documentId -> messages
  isStreaming: boolean;
  streamingMessage: string;
  shouldStopGeneration: boolean;
  error: string | null;
  agentMode: 'basic' | 'enhanced'; // Multi-Agent mode toggle
  agentStatus: string | null; // Current agent operation status (e.g., "Analyzing resources...", "Verifying content...")

  // Actions
  addMessage: (documentId: string, message: ChatMessage) => void;
  updateMessage: (
    documentId: string,
    messageId: string,
    updates: Partial<ChatMessage>
  ) => void;
  updateStreamingMessage: (content: string) => void;
  setStreaming: (streaming: boolean) => void;
  stopGeneration: () => void;
  clearSession: (documentId: string) => void;
  setError: (error: string | null) => void;
  setAgentMode: (mode: 'basic' | 'enhanced') => void;
  setAgentStatus: (status: string | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  sessions: {},
  isStreaming: false,
  streamingMessage: '',
  shouldStopGeneration: false,
  error: null,
  agentMode: 'basic', // Default to basic mode
  agentStatus: null,

  addMessage: (documentId, message) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [documentId]: [...(state.sessions[documentId] || []), message],
      },
    })),

  updateMessage: (documentId, messageId, updates) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [documentId]: (state.sessions[documentId] || []).map((msg) =>
          msg.id === messageId ? { ...msg, ...updates } : msg
        ),
      },
    })),

  updateStreamingMessage: (content) =>
    set({
      streamingMessage: content,
    }),

  setStreaming: (streaming) =>
    set({
      isStreaming: streaming,
      streamingMessage: streaming ? '' : '',
      shouldStopGeneration: false,
    }),

  stopGeneration: () =>
    set({
      shouldStopGeneration: true,
    }),

  clearSession: (documentId) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [documentId]: [],
      },
    })),

  setError: (error) =>
    set({
      error,
    }),

  setAgentMode: (mode) =>
    set({
      agentMode: mode,
    }),

  setAgentStatus: (status) =>
    set({
      agentStatus: status,
    }),
}));

// ============================================================================
// UI Store (持久化)
// ============================================================================

interface UIStoreState extends UIState {
  // Actions
  setMiddlePanelWidth: (width: number) => void;
  toggleResourceList: () => void;
  setResourceListCollapsed: (collapsed: boolean) => void;
  setLoading: (loading: boolean, message?: string) => void;
  setError: (message: string | null, code?: string) => void;
  clearError: () => void;
}

export const useUIStore = create<UIStoreState>()(
  persist(
    (set) => ({
      // Initial state
      // 默认宽度调整为窗口的2/5，确保与文档区域比例为2:3
      middlePanelWidth:
        typeof window !== 'undefined'
          ? Math.min(650, Math.max(400, (window.innerWidth - 64) * 0.4))
          : 650,
      resourceListCollapsed: false,
      selectedResourceIds: [],
      isLoading: false,

      // Actions
      setMiddlePanelWidth: (width) =>
        set({
          middlePanelWidth: Math.max(400, Math.min(800, width)),
        }),

      toggleResourceList: () =>
        set((state) => ({
          resourceListCollapsed: !state.resourceListCollapsed,
        })),

      setResourceListCollapsed: (collapsed) =>
        set({
          resourceListCollapsed: collapsed,
        }),

      setLoading: (loading, message) =>
        set({
          isLoading: loading,
          loadingMessage: message,
        }),

      setError: (message, code) =>
        set({
          error: message
            ? {
                message,
                code,
              }
            : undefined,
        }),

      clearError: () =>
        set({
          error: undefined,
        }),
    }),
    {
      name: 'ai-office-ui-storage',
      partialize: (state) => ({
        middlePanelWidth: state.middlePanelWidth,
        resourceListCollapsed: state.resourceListCollapsed,
      }),
    }
  )
);

// ============================================================================
// Task Store (Genspark风格任务管理) - 优化版
// ============================================================================

export interface Task {
  _id: string;
  title: string;
  type: 'article' | 'ppt' | 'summary' | 'analysis';
  createdAt: Date;
  refreshedAt: Date; // 最后一次更新/编辑时间

  // 任务上下文 - 关键：用于恢复任务环境
  context: {
    resourceIds: string[]; // 关联的资源
    documentId?: string; // 生成的文档
    documentContent?: Document['content']; // 文档内容快照 - 用于恢复文档状态
    documentMetadata?: Document['metadata']; // 文档元数据快照 - 用于恢复 slideCount 等信息
    documentVersions?: DocumentVersion[]; // 文档版本历史快照 - 用于恢复版本管理
    chatMessages: ChatMessage[]; // AI对话历史
    aiConfig?: Partial<AIConfig>; // AI配置
    prompt?: string; // 原始用户提示词
  };

  // 元数据
  metadata: {
    thumbnail?: string; // 缩略图
    wordCount?: number; // 字数
    description?: string; // 任务描述
    progress?: number; // 任务进度 (0-100)
    error?: string; // 错误信息
  };
}

interface TaskState {
  tasks: Task[];
  currentTaskId: string | null;
  isTaskListOpen: boolean;

  // Actions
  addTask: (task: Task) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  setCurrentTask: (id: string | null) => void;
  toggleTaskList: () => void;
  setTaskListOpen: (open: boolean) => void;

  // 任务上下文操作
  saveTaskContext: (taskId: string, context: Partial<Task['context']>) => void;
  restoreTaskContext: (taskId: string) => void;
}

export const useTaskStore = create<TaskState>()(
  persist(
    (set, get) => ({
      tasks: [],
      currentTaskId: null,
      isTaskListOpen: false,

      addTask: (task) =>
        set((state) => ({
          tasks: [task, ...state.tasks], // 新任务在最前面
        })),

      updateTask: (id, updates) =>
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t._id === id
              ? {
                  ...t,
                  ...updates,
                  // 深度合并 context 对象，而不是替换
                  context: updates.context
                    ? {
                        ...t.context,
                        ...updates.context,
                      }
                    : t.context,
                  refreshedAt: new Date(),
                }
              : t
          ),
        })),

      deleteTask: (id) =>
        set((state) => ({
          tasks: state.tasks.filter((t) => t._id !== id),
          currentTaskId:
            state.currentTaskId === id ? null : state.currentTaskId,
        })),

      setCurrentTask: (id) =>
        set({
          currentTaskId: id,
        }),

      toggleTaskList: () =>
        set((state) => ({
          isTaskListOpen: !state.isTaskListOpen,
        })),

      setTaskListOpen: (open) =>
        set({
          isTaskListOpen: open,
        }),

      saveTaskContext: (taskId, context) =>
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t._id === taskId
              ? {
                  ...t,
                  context: {
                    ...t.context,
                    ...context,
                  },
                  refreshedAt: new Date(),
                }
              : t
          ),
        })),

      restoreTaskContext: (taskId: string) => {
        const task = get().tasks.find((t) => t._id === taskId);
        if (!task) return;

        // 恢复资源选择
        const resourceStore = useResourceStore.getState();
        resourceStore.clearSelection();
        task.context.resourceIds.forEach((id) => {
          resourceStore.selectResource(id);
        });

        // 恢复文档和文档内容
        if (task.context.documentId) {
          const documentStore = useDocumentStore.getState();
          let existingDoc = documentStore.documents.find(
            (d) => d._id === task.context.documentId
          );

          logger.debug(
            '[restoreTaskContext] Document ID:',
            task.context.documentId
          );
          logger.debug('[restoreTaskContext] Found document:', !!existingDoc);
          logger.debug(
            '[restoreTaskContext] Has saved content:',
            !!task.context.documentContent
          );

          // 如果文档不存在，但任务有保存的内容快照，从快照重建文档
          if (
            !existingDoc &&
            task.context.documentContent &&
            task.context.documentMetadata
          ) {
            logger.debug(
              '[restoreTaskContext] Document not found, recreating from snapshot'
            );

            // 转换task type到document type (summary/analysis映射为article)
            const documentType: Document['type'] =
              task.type === 'summary' || task.type === 'analysis'
                ? 'article'
                : task.type;

            const restoredDocument: Document = {
              _id: task.context.documentId,
              userId: 'local', // 本地用户ID
              title: task.title,
              type: documentType,
              content: task.context.documentContent,
              metadata: task.context.documentMetadata,
              status: 'completed',
              resources: [], // 从task恢复的文档没有resources关联
              aiConfig: {
                model: 'grok',
                temperature: 0.7,
                maxTokens: 4000,
                language: 'zh-CN',
                detailLevel: 3,
                professionalLevel: 3,
              },
              generationHistory: [
                {
                  timestamp: task.createdAt,
                  action: 'create',
                  aiModel: 'grok',
                },
              ],
              createdAt: task.createdAt,
              updatedAt: new Date(),
              versions: task.context.documentVersions || [], // 恢复版本历史
              currentVersionId:
                task.context.documentVersions &&
                task.context.documentVersions.length > 0
                  ? task.context.documentVersions[
                      task.context.documentVersions.length - 1
                    ].id
                  : undefined,
            } as Document;
            documentStore.addDocument(restoredDocument);
            existingDoc = restoredDocument;
            logger.debug('[restoreTaskContext] Document recreated', {
              versionsCount: restoredDocument.versions?.length || 0,
            });
          }

          // 只有当文档存在时才进行恢复和切换
          if (existingDoc) {
            // 如果有保存的内容，恢复内容和元数据
            if (task.context.documentContent) {
              // 计算 slideCount（如果是PPT文档）
              let slideCount = task.context.documentMetadata?.slideCount;
              if (
                existingDoc.type === 'ppt' &&
                typeof task.context.documentContent === 'object' &&
                task.context.documentContent !== null &&
                'markdown' in task.context.documentContent
              ) {
                slideCount = calculateSlideCount(
                  (task.context.documentContent as { markdown: string })
                    .markdown
                );
              }

              const updatePayload = {
                content: task.context.documentContent, // 直接替换 content，不是合并
                updatedAt: new Date(),
                metadata: task.context.documentMetadata
                  ? {
                      ...existingDoc.metadata,
                      ...task.context.documentMetadata,
                      slideCount:
                        slideCount || task.context.documentMetadata.slideCount,
                    }
                  : existingDoc.metadata,
              };

              logger.debug(
                '[restoreTaskContext] Updating document with payload:',
                {
                  documentId: task.context.documentId,
                  hasContent: !!updatePayload.content,
                  hasMarkdown: !!(
                    typeof updatePayload.content === 'object' &&
                    updatePayload.content !== null &&
                    'markdown' in updatePayload.content
                  ),
                  markdownLength:
                    typeof updatePayload.content === 'object' &&
                    updatePayload.content !== null &&
                    'markdown' in updatePayload.content
                      ? (updatePayload.content as { markdown: string }).markdown
                          ?.length || 0
                      : 0,
                  slideCount: updatePayload.metadata?.slideCount,
                }
              );

              documentStore.updateDocument(
                task.context.documentId,
                updatePayload as Partial<Document>
              );

              // 验证更新是否成功
              const updatedDoc = documentStore.documents.find(
                (d) => d._id === task.context.documentId
              );
              logger.debug(
                '[restoreTaskContext] After update - document content length:',
                typeof updatedDoc?.content === 'object' &&
                  updatedDoc.content !== null &&
                  'markdown' in updatedDoc.content
                  ? (updatedDoc.content as { markdown: string }).markdown
                      ?.length || 0
                  : 0
              );
            } else {
              logger.warn(
                '[restoreTaskContext] Task has no saved documentContent'
              );
            }

            // 设置为当前文档（只有当文档存在时）
            documentStore.setCurrentDocument(task.context.documentId);
            logger.debug(
              '[restoreTaskContext] Set current document to:',
              task.context.documentId
            );
          } else {
            logger.warn(`任务关联的文档不存在: ${task.context.documentId}`);
          }
        }

        // 恢复聊天历史
        const chatStore = useChatStore.getState();
        if (task.context.documentId && task.context.chatMessages.length > 0) {
          // 清空当前会话
          chatStore.clearSession(task.context.documentId);
          // 恢复历史消息
          task.context.chatMessages.forEach((msg) => {
            chatStore.addMessage(task.context.documentId!, msg);
          });
        }

        // 设置当前任务
        set({ currentTaskId: taskId });
      },
    }),
    {
      name: 'ai-office-task-storage',
      partialize: (state) => ({
        tasks: state.tasks,
        currentTaskId: state.currentTaskId,
      }),
    }
  )
);

// ============================================================================
// Selectors (派生状态)
// ============================================================================

export const useSelectedResources = () => {
  const resources = useResourceStore((state) => state.resources);
  const selectedIds = useResourceStore((state) => state.selectedResourceIds);

  return resources.filter((r) => selectedIds.includes(r._id));
};

export const useCurrentDocument = (): Document | undefined => {
  const documents = useDocumentStore((state) => state.documents);
  const currentId = useDocumentStore((state) => state.currentDocumentId);

  return documents.find((d) => d._id === currentId);
};

export const useCurrentChatMessages = (): ChatMessage[] => {
  const sessions = useChatStore((state) => state.sessions);
  const currentDocumentId = useDocumentStore(
    (state) => state.currentDocumentId
  );

  return currentDocumentId ? sessions[currentDocumentId] || [] : [];
};

export const useCurrentTask = (): Task | undefined => {
  const tasks = useTaskStore((state) => state.tasks);
  const currentId = useTaskStore((state) => state.currentTaskId);

  return tasks.find((t) => t._id === currentId);
};
