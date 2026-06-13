/**
 * Slides Engine - Zustand Store
 *
 * 管理幻灯片生成的状态，包括：
 * - 会话管理
 * - 检查点管理
 * - 生成进度
 * - 页面状态
 */

import { create } from 'zustand';
import { persist, devtools } from 'zustand/middleware';
import { logger } from '@/lib/utils/logger';
import type {
  SlidesSession,
  Checkpoint,
  CheckpointState,
  PageState,
  GenerationProgress,
  StreamEvent,
  TaskDecomposition,
  OutlinePlan,
  QualityReport,
  GlobalStyles,
  GENSPARK_DESIGN_SYSTEM,
} from '@/lib/types/slides';

// ============================================================================
// Store State
// ============================================================================

interface SlidesState {
  // 会话
  session: SlidesSession | null;
  sessionLoading: boolean;

  // 检查点
  checkpoints: Checkpoint[];
  currentCheckpointId: string | null;
  checkpointsLoading: boolean;

  // 生成状态
  generating: boolean;
  progress: GenerationProgress | null;
  streamEvents: StreamEvent[];

  // 页面状态
  pages: PageState[];
  selectedPageIndex: number;

  // 任务分解和大纲
  taskDecomposition: TaskDecomposition | null;
  outlinePlan: OutlinePlan | null;

  // 质量报告
  qualityReport: QualityReport | null;

  // 全局样式
  globalStyles: GlobalStyles;

  // 错误
  error: string | null;

  // UI 状态
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  previewMode: 'single' | 'thumbnail';
}

// ============================================================================
// Store Actions
// ============================================================================

interface SlidesActions {
  // 会话操作
  setSession: (session: SlidesSession | null) => void;
  setSessionLoading: (loading: boolean) => void;
  clearSession: () => void;

  // 检查点操作
  setCheckpoints: (checkpoints: Checkpoint[]) => void;
  addCheckpoint: (checkpoint: Checkpoint) => void;
  setCurrentCheckpointId: (id: string | null) => void;
  setCheckpointsLoading: (loading: boolean) => void;

  // 生成操作
  setGenerating: (generating: boolean) => void;
  setProgress: (progress: GenerationProgress | null) => void;
  addStreamEvent: (event: StreamEvent) => void;
  clearStreamEvents: () => void;

  // 页面操作
  setPages: (pages: PageState[]) => void;
  updatePage: (pageNumber: number, updates: Partial<PageState>) => void;
  setSelectedPageIndex: (index: number) => void;

  // 任务和大纲
  setTaskDecomposition: (task: TaskDecomposition | null) => void;
  setOutlinePlan: (plan: OutlinePlan | null) => void;

  // 质量报告
  setQualityReport: (report: QualityReport | null) => void;

  // 全局样式
  setGlobalStyles: (styles: Partial<GlobalStyles>) => void;

  // 错误处理
  setError: (error: string | null) => void;

  // UI 状态
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setPreviewMode: (mode: 'single' | 'thumbnail') => void;

  // 从检查点恢复状态
  restoreFromCheckpointState: (state: CheckpointState) => void;

  // 重置
  reset: () => void;
}

// ============================================================================
// Default State
// ============================================================================

const DEFAULT_GLOBAL_STYLES: GlobalStyles = {
  canvasWidth: 1280,
  canvasHeight: 720,
  backgroundColor: '#0F172A',
  cardBackground: '#1E293B',
  borderColor: '#334155',
  accentColor: '#D4AF37',
  accentColorSecondary: '#3B82F6',
  textPrimary: '#F8FAFC',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  fontFamily: "'Noto Sans SC', sans-serif",
  bottomSafeZone: 80,
};

const initialState: SlidesState = {
  session: null,
  sessionLoading: false,
  checkpoints: [],
  currentCheckpointId: null,
  checkpointsLoading: false,
  generating: false,
  progress: null,
  streamEvents: [],
  pages: [],
  selectedPageIndex: 0,
  taskDecomposition: null,
  outlinePlan: null,
  qualityReport: null,
  globalStyles: DEFAULT_GLOBAL_STYLES,
  error: null,
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  previewMode: 'single',
};

// ============================================================================
// Store
// ============================================================================

export const useSlidesStore = create<SlidesState & SlidesActions>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        // 会话操作
        setSession: (session) => set({ session, error: null }),
        setSessionLoading: (sessionLoading) => set({ sessionLoading }),
        clearSession: () =>
          set({
            session: null,
            checkpoints: [],
            currentCheckpointId: null,
            pages: [],
            taskDecomposition: null,
            outlinePlan: null,
            qualityReport: null,
            streamEvents: [],
            progress: null,
            error: null,
          }),

        // 检查点操作
        setCheckpoints: (checkpoints) => set({ checkpoints }),
        addCheckpoint: (checkpoint) =>
          set((state) => ({
            checkpoints: [checkpoint, ...state.checkpoints],
          })),
        setCurrentCheckpointId: (currentCheckpointId) =>
          set({ currentCheckpointId }),
        setCheckpointsLoading: (checkpointsLoading) =>
          set({ checkpointsLoading }),

        // 生成操作
        setGenerating: (generating) => set({ generating }),
        setProgress: (progress) => set({ progress }),
        addStreamEvent: (event) =>
          set((state) => ({
            streamEvents: [...state.streamEvents, event],
          })),
        clearStreamEvents: () => set({ streamEvents: [] }),

        // 页面操作 - 始终按 pageNumber 排序
        setPages: (pages) =>
          set({
            pages: [...pages].sort((a, b) => a.pageNumber - b.pageNumber),
          }),
        updatePage: (pageNumber, updates) =>
          set((state) => {
            // ★★★ 关键诊断日志 ★★★
            logger.debug(
              `[SlidesStore] ★★★ updatePage CALLED ★★★ pageNumber=${pageNumber}, currentPagesCount=${state.pages.length}`
            );
            logger.debug(
              `[SlidesStore] updates.status=${(updates as { status?: string }).status}, updates.html?.length=${(updates as { html?: string }).html?.length || 0}`
            );

            const existingPage = state.pages.find(
              (p) => p.pageNumber === pageNumber
            );

            if (existingPage) {
              // 更新已存在的页面
              logger.debug(
                `[SlidesStore] ★ Updating existing page ${pageNumber}`
              );
              const newPages = state.pages
                .map((p) =>
                  p.pageNumber === pageNumber ? { ...p, ...updates } : p
                )
                .sort((a, b) => a.pageNumber - b.pageNumber);
              logger.debug(
                `[SlidesStore] ★ After update: pages.length=${newPages.length}`
              );
              return { pages: newPages };
            } else {
              // ★ 关键修复：如果页面不存在，创建新页面
              logger.debug(`[SlidesStore] ★ Creating NEW page ${pageNumber}`);
              const updatesWithOutline = updates;
              const newPage: PageState = {
                pageNumber,
                outline: {
                  pageNumber,
                  title:
                    updatesWithOutline.outline?.title || `第 ${pageNumber} 页`,
                  templateType:
                    updatesWithOutline.outline?.templateType || 'pillars',
                  purpose: '',
                  keyPoints: [],
                },
                status: 'pending',
                ...updates,
              };
              const newPages = [...state.pages, newPage].sort(
                (a, b) => a.pageNumber - b.pageNumber
              );
              logger.debug(
                `[SlidesStore] ★ After create: pages.length=${newPages.length}, newPage.status=${newPage.status}`
              );
              return { pages: newPages };
            }
          }),
        setSelectedPageIndex: (selectedPageIndex) => set({ selectedPageIndex }),

        // 任务和大纲
        setTaskDecomposition: (taskDecomposition) => set({ taskDecomposition }),
        setOutlinePlan: (outlinePlan) => set({ outlinePlan }),

        // 质量报告
        setQualityReport: (qualityReport) => set({ qualityReport }),

        // 全局样式
        setGlobalStyles: (styles) =>
          set((state) => ({
            globalStyles: { ...state.globalStyles, ...styles },
          })),

        // 错误处理
        setError: (error) => set({ error }),

        // UI 状态
        toggleLeftPanel: () =>
          set((state) => ({
            leftPanelCollapsed: !state.leftPanelCollapsed,
          })),
        toggleRightPanel: () =>
          set((state) => ({
            rightPanelCollapsed: !state.rightPanelCollapsed,
          })),
        setPreviewMode: (previewMode) => set({ previewMode }),

        // 从检查点恢复状态
        restoreFromCheckpointState: (checkpointState) => {
          // ★ 诊断日志
          logger.debug(
            '[SlidesStore] ★★★ restoreFromCheckpointState CALLED ★★★'
          );
          logger.debug(
            '[SlidesStore] checkpointState keys:',
            Object.keys(checkpointState)
          );
          logger.debug(
            '[SlidesStore] pages count:',
            checkpointState.pages?.length || 0
          );
          logger.debug(
            '[SlidesStore] has taskDecomposition:',
            !!checkpointState.taskDecomposition
          );
          logger.debug(
            '[SlidesStore] has outlinePlan:',
            !!checkpointState.outlinePlan
          );

          // 确保页面状态正确：如果有 HTML，则状态应该是 completed
          // 并按 pageNumber 排序，确保页面顺序正确
          // ★ 关键修复：确保 design 数据被保留
          const restoredPages = (checkpointState.pages || [])
            .map((page) => {
              // 兼容不同的 HTML 字段名
              const html =
                page.html || (page as { renderedHtml?: string }).renderedHtml;
              return {
                ...page,
                html, // 确保 html 字段存在
                // ★ 确保 design 数据被恢复（用于 Thinking TAB）
                design: page.design,
                // 如果页面有 HTML，确保状态是 completed
                status: html
                  ? ('completed' as const)
                  : page.status || ('pending' as const),
              };
            })
            .sort((a, b) => a.pageNumber - b.pageNumber);

          // ★ 诊断日志：检查恢复后的页面数据
          logger.debug('[SlidesStore] ★ Restored pages:', restoredPages.length);
          restoredPages.forEach((p, i) => {
            logger.debug(
              `[SlidesStore]   Page ${i + 1}: status=${p.status}, htmlLength=${p.html?.length || 0}, hasDesign=${!!p.design}`
            );
          });

          // 重建 streamEvents 用于显示生成过程
          const reconstructedEvents: StreamEvent[] = [];

          // 如果有任务分解信息，添加到 events
          if (checkpointState.taskDecomposition) {
            reconstructedEvents.push({
              type: 'phase_started',
              timestamp: new Date(),
              data: {
                phase: 'task_decomposition',
                message: `任务分解完成: ${checkpointState.taskDecomposition.totalPages} 页`,
              },
            });
            reconstructedEvents.push({
              type: 'phase_completed',
              timestamp: new Date(),
              data: {
                phase: 'task_decomposition',
              },
            });
          }

          // 如果有大纲信息，添加到 events
          if (checkpointState.outlinePlan) {
            reconstructedEvents.push({
              type: 'phase_started',
              timestamp: new Date(),
              data: {
                phase: 'outline_planning',
                message: `大纲规划完成: ${checkpointState.outlinePlan.title}`,
              },
            });
            reconstructedEvents.push({
              type: 'phase_completed',
              timestamp: new Date(),
              data: {
                phase: 'outline_planning',
              },
            });
          }

          // ★ 为每个已完成的页面添加事件（包含 design 数据用于 Thinking TAB）
          restoredPages.forEach((page) => {
            if (page.status === 'completed' && page.html) {
              reconstructedEvents.push({
                type: 'page_started',
                timestamp: new Date(),
                data: {
                  pageNumber: page.pageNumber,
                  outline: page.outline,
                },
              });
              // ★ 关键修复：使用 slide:generated 事件类型，包含 HTML 和 design
              reconstructedEvents.push({
                type: 'slide:generated',
                timestamp: new Date(),
                data: {
                  pageNumber: page.pageNumber,
                  title: page.outline?.title || `第 ${page.pageNumber} 页`,
                  html: page.html,
                  design: page.design, // ★ 包含设计思考数据
                },
              });
            }
          });

          // ★ 计算恢复后的进度状态
          const completedCount = restoredPages.filter(
            (p) => p.status === 'completed'
          ).length;
          const totalCount = restoredPages.length;
          const restoredProgress: GenerationProgress | null =
            totalCount > 0
              ? {
                  phase:
                    completedCount === totalCount
                      ? 'quality_review'
                      : 'page_rendering',
                  phaseProgress:
                    totalCount > 0
                      ? Math.round((completedCount / totalCount) * 100)
                      : 0,
                  overallProgress:
                    totalCount > 0
                      ? Math.round((completedCount / totalCount) * 100)
                      : 0,
                  totalPages: totalCount,
                  message:
                    completedCount === totalCount
                      ? '已恢复完成'
                      : `已恢复 ${completedCount}/${totalCount} 页`,
                }
              : null;

          logger.debug(
            '[SlidesStore] ★ Setting state with progress:',
            restoredProgress
          );

          set({
            taskDecomposition: checkpointState.taskDecomposition || null,
            outlinePlan: checkpointState.outlinePlan || null,
            pages: restoredPages,
            globalStyles: checkpointState.globalStyles || DEFAULT_GLOBAL_STYLES,
            error: null,
            // 重置生成状态
            generating: false,
            // ★ 设置恢复后的进度状态（而不是 null）
            progress: restoredProgress,
            // 恢复重建的事件（而不是清空）
            streamEvents: reconstructedEvents,
            selectedPageIndex: 0,
          });

          logger.debug(
            '[SlidesStore] ★★★ restoreFromCheckpointState COMPLETED ★★★'
          );
        },

        // 重置
        reset: () => set(initialState),
      }),
      {
        name: 'slides-storage',
        partialize: (state) => ({
          // 只持久化部分状态
          globalStyles: state.globalStyles,
          leftPanelCollapsed: state.leftPanelCollapsed,
          rightPanelCollapsed: state.rightPanelCollapsed,
          previewMode: state.previewMode,
        }),
      }
    ),
    { name: 'SlidesStore' }
  )
);

// ============================================================================
// Selectors
// ============================================================================

export const selectCurrentPage = (state: SlidesState): PageState | null => {
  const { pages, selectedPageIndex } = state;
  return pages[selectedPageIndex] || null;
};

export const selectCompletedPages = (state: SlidesState): PageState[] => {
  return state.pages.filter((p) => p.status === 'completed');
};

export const selectPendingPages = (state: SlidesState): PageState[] => {
  return state.pages.filter((p) => p.status === 'pending');
};

export const selectGeneratingPages = (state: SlidesState): PageState[] => {
  return state.pages.filter((p) => p.status === 'generating');
};

export const selectOverallProgress = (state: SlidesState): number => {
  const { pages } = state;
  if (pages.length === 0) return 0;
  const completed = pages.filter((p) => p.status === 'completed').length;
  return Math.round((completed / pages.length) * 100);
};

export const selectLatestCheckpoint = (
  state: SlidesState
): Checkpoint | null => {
  const { checkpoints } = state;
  return checkpoints.length > 0 ? checkpoints[0] : null;
};

// ============================================================================
// Utilities
// ============================================================================

/**
 * 根据阶段获取进度百分比权重
 */
export function getPhaseWeight(phase: GenerationProgress['phase']): {
  start: number;
  end: number;
} {
  switch (phase) {
    case 'task_decomposition':
      return { start: 0, end: 10 };
    case 'outline_planning':
      return { start: 10, end: 20 };
    case 'page_rendering':
      return { start: 20, end: 90 };
    case 'quality_review':
      return { start: 90, end: 100 };
    default:
      return { start: 0, end: 100 };
  }
}

/**
 * 计算总体进度
 */
export function calculateOverallProgress(
  phase: GenerationProgress['phase'],
  phaseProgress: number
): number {
  const { start, end } = getPhaseWeight(phase);
  return Math.round(start + (phaseProgress / 100) * (end - start));
}
