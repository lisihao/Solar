'use client';

/**
 * AI Slides - 主页面
 *
 * 基于后端 Team 协作架构的全新实现
 * - 使用 useSlideGenerationTeam hook 处理 SSE 流
 * - 使用 useSlidesStore 管理状态
 * - 显示 Agent 团队协作进度
 * - 渲染后端返回的 HTML 页面
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  Suspense,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Download,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Send,
  StopCircle,
  Loader2,
  CheckCircle2,
  FileText,
  Users,
  Play,
  RotateCcw,
  Maximize2,
  Minimize2,
  History,
  Crown,
  Search,
  Palette,
  PenTool,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import Link from 'next/link';

import AppShell from '@/components/layout/AppShell';
import { cn } from '@/lib/utils/common';
import { useSlidesStore } from '@/stores';
import { useSlideGenerationTeam } from '@/hooks/features/slides/useSlideGenerationTeam';
import type {
  SlidesAgentRole,
  AgentState,
  TeamExecutionState,
  SLIDES_TEAM_AGENTS,
} from '@/lib/types/slides-team';
import type { PageState, GenerationProgress } from '@/lib/types/slides';
import { sanitizeSlideHtml } from '@/lib/utils/sanitize';
import { useI18n } from '@/lib/i18n';
import { logger } from '@/lib/utils/logger';
import { AutoImportFlow } from '@/components/ai-office/slides/AutoImportFlow';
// ============================================
// Agent 图标映射
// ============================================
const AGENT_ICONS: Record<SlidesAgentRole, React.ReactNode> = {
  leader: <Crown className="h-4 w-4" />,
  analyst: <Search className="h-4 w-4" />,
  strategist: <Palette className="h-4 w-4" />,
  writer: <PenTool className="h-4 w-4" />,
  reviewer: <CheckCircle className="h-4 w-4" />,
};

const AGENT_NAMES: Record<SlidesAgentRole, string> = {
  leader: 'Slides Architect',
  analyst: 'Content Analyst',
  strategist: 'Visual Strategist',
  writer: 'Content Writer',
  reviewer: 'Quality Reviewer',
};

const AGENT_DESCRIPTIONS: Record<SlidesAgentRole, string> = {
  leader: '协调整个生成流程',
  analyst: '分析源文本内容',
  strategist: '规划设计策略',
  writer: '生成页面内容',
  reviewer: '检查质量一致性',
};

// ============================================
// AgentCard 组件
// ============================================
function AgentCard({
  role,
  state,
  isActive,
  t,
}: {
  role: SlidesAgentRole;
  state: AgentState;
  isActive: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const statusColors = {
    idle: 'bg-gray-100 border-gray-200 text-gray-500',
    thinking: 'bg-purple-50 border-purple-300 text-purple-600',
    working: 'bg-blue-50 border-blue-300 text-blue-600',
    completed: 'bg-green-50 border-green-300 text-green-600',
    error: 'bg-red-50 border-red-300 text-red-600',
  };

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3 transition-all',
        isActive ? 'ring-2 ring-blue-500 ring-offset-2' : '',
        statusColors[state.status]
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full',
          state.status === 'working' || state.status === 'thinking'
            ? 'bg-current/10 animate-pulse'
            : 'bg-current/10'
        )}
      >
        {AGENT_ICONS[role]}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {AGENT_NAMES[role]}
          </span>
          {state.status === 'working' && (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
        </div>
        <p className="truncate text-xs opacity-70">
          {state.currentTask || state.result || AGENT_DESCRIPTIONS[role]}
        </p>
      </div>
      {state.lastScore !== undefined && (
        <div className="text-xs font-medium">
          {t('office.slides.score', { score: Math.round(state.lastScore) })}
        </div>
      )}
    </div>
  );
}

// ============================================
// ProgressBar 组件
// ============================================
function ProgressBar({
  progress,
  label,
}: {
  progress: number;
  label?: string;
}) {
  return (
    <div className="space-y-1">
      {label && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{label}</span>
          <span>{Math.round(progress)}%</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <motion.div
          className="h-full bg-gradient-to-r from-blue-500 to-blue-600"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
    </div>
  );
}

// ============================================
// SlidePreview 组件 - 渲染 HTML 页面
// ============================================
function SlidePreview({
  html,
  pageNumber,
  title,
  isSelected,
  onClick,
}: {
  html: string;
  pageNumber: number;
  title: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative aspect-video w-full overflow-hidden rounded-lg border-2 transition-all',
        isSelected
          ? 'border-blue-500 ring-2 ring-blue-200'
          : 'border-gray-200 hover:border-gray-300'
      )}
    >
      <div
        className="h-full w-full origin-top-left scale-[0.25] transform bg-gray-900"
        style={{ width: '400%', height: '400%' }}
        dangerouslySetInnerHTML={{ __html: sanitizeSlideHtml(html) }}
      />
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-white">
            {pageNumber}. {title}
          </span>
        </div>
      </div>
    </button>
  );
}

// ============================================
// 主页面组件
// ============================================
export default function SlidesPage() {
  const { t } = useI18n();

  // Store 状态
  const {
    pages,
    progress,
    error,
    selectedPageIndex,
    setSelectedPageIndex,
    reset: resetStore,
  } = useSlidesStore();

  // Team 生成 Hook
  const { generating, teamState, generateWithTeam, cancel } =
    useSlideGenerationTeam({
      onExecutionStarted: (sessionId) => {
        logger.debug('Execution started:', sessionId);
      },
      onSlideGenerated: (pageNumber, html) => {
        logger.debug('Slide generated:', pageNumber);
      },
      onComplete: (result) => {
        logger.debug('Generation complete:', result);
      },
      onError: (error) => {
        logger.error('Generation error:', error);
      },
    });

  // UI 状态
  const [leftPanelWidth, setLeftPanelWidth] = useState(480);
  const [isDragging, setIsDragging] = useState(false);
  const [inputText, setInputText] = useState('');
  const [title, setTitle] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [thumbnailsExpanded, setThumbnailsExpanded] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 当前选中的页面
  const currentPage = pages[selectedPageIndex];
  const completedPages = pages.filter((p) => p.status === 'completed');

  // 拖拽调整面板宽度
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      setLeftPanelWidth(Math.max(350, Math.min(600, newWidth)));
    };

    const handleMouseUp = () => setIsDragging(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // 开始生成
  const handleGenerate = useCallback(async () => {
    if (!inputText.trim()) return;

    await generateWithTeam({
      title: title || '演示文稿',
      sourceText: inputText,
      userRequirement: '',
      stylePreference: 'dark',
      themeId: 'genspark-dark',
    });
  }, [inputText, title, generateWithTeam]);

  // 自动导入触发生成（用于跨模块导入流程）
  const handleAutoImport = useCallback(
    (options: {
      title: string;
      sourceText: string;
      userRequirement?: string;
      stylePreference?: string;
      themeId?: string;
      crossModuleSource?: {
        type: 'topic-insights' | 'research-project';
        sourceId: string;
        sourceName?: string;
      };
      preset?: string;
    }) => {
      generateWithTeam({
        title: options.title || '演示文稿',
        sourceText: options.sourceText,
        userRequirement: options.userRequirement || '',
        stylePreference:
          (options.stylePreference as 'dark' | 'light' | 'custom') || 'dark',
        themeId: options.themeId || 'genspark-dark',
        ...(options.crossModuleSource && {
          crossModuleSource: options.crossModuleSource,
        }),
        ...(options.preset && { preset: options.preset }),
      });
    },
    [generateWithTeam]
  );

  // 重置
  const handleReset = useCallback(() => {
    resetStore();
    setInputText('');
    setTitle('');
  }, [resetStore]);

  // 获取阶段名称
  const getPhaseName = (phase?: string): string => {
    const phaseNames: Record<string, string> = {
      task_decomposition: '任务分解',
      outline_planning: '大纲规划',
      page_rendering: '页面生成',
      quality_review: '质量检查',
      initializing: '初始化',
      analyzing: '内容分析',
      planning: '结构规划',
      generating: '内容生成',
      rendering: '渲染中',
      reviewing: '审核中',
      completed: '已完成',
      failed: '生成失败',
    };
    return phaseNames[phase || ''] || phase || '处理中';
  };

  return (
    <AppShell>
      <Suspense fallback={null}>
        <AutoImportFlow onGenerate={handleAutoImport} />
      </Suspense>
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* 左侧面板：输入 + 进度 */}
        <div
          className="relative flex flex-shrink-0 flex-col border-r border-gray-200 bg-white"
          style={{ width: `${leftPanelWidth}px` }}
        >
          {/* 头部 */}
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div className="flex items-center gap-3">
              <Link
                href="/ai-office"
                className="rounded-lg p-2 hover:bg-gray-100"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div>
                <h1 className="font-semibold">{t('office.slides.title')}</h1>
                <p className="text-xs text-gray-500">
                  {t('office.slides.subtitle')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {(generating || completedPages.length > 0) && (
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>{t('office.slides.reset')}</span>
                </button>
              )}
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={cn(
                  'rounded-lg p-2 transition-colors',
                  showSettings
                    ? 'bg-blue-100 text-blue-600'
                    : 'hover:bg-gray-100'
                )}
              >
                <Settings className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* 主内容区 */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* 输入区域（非生成状态时显示） */}
            {!generating && completedPages.length === 0 && (
              <div className="flex flex-1 flex-col p-4">
                <div className="mb-4">
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {t('office.slides.presentationTitle')}
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t('office.slides.titlePlaceholder')}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="flex flex-1 flex-col">
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {t('office.slides.sourceContent')}
                  </label>
                  <textarea
                    ref={inputRef}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder={t('office.slides.contentPlaceholder')}
                    className="w-full flex-1 resize-none rounded-lg border border-gray-300 p-3 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="mt-4">
                  <button
                    onClick={handleGenerate}
                    disabled={!inputText.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    <Sparkles className="h-5 w-5" />
                    <span>{t('office.slides.startGeneration')}</span>
                  </button>
                </div>
              </div>
            )}

            {/* 生成进度区域 */}
            {(generating || completedPages.length > 0) && (
              <div className="flex flex-1 flex-col overflow-hidden">
                {/* 整体进度 */}
                <div className="border-b border-gray-100 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {generating ? (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      )}
                      <span className="font-medium">
                        {generating
                          ? getPhaseName(progress?.phase || teamState?.phase)
                          : t('office.slides.generationComplete')}
                      </span>
                    </div>
                    {generating && (
                      <button
                        onClick={cancel}
                        className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700"
                      >
                        <StopCircle className="h-4 w-4" />
                        <span>{t('office.slides.stop')}</span>
                      </button>
                    )}
                  </div>

                  <ProgressBar
                    progress={
                      progress?.overallProgress ||
                      teamState?.overallProgress ||
                      0
                    }
                    label={progress?.message}
                  />

                  {/* 页面进度 */}
                  {pages.length > 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      {t('office.slides.completedCount', {
                        completed: completedPages.length,
                        total: pages.length,
                      })}
                    </div>
                  )}
                </div>

                {/* Agent 团队状态 */}
                {teamState && (
                  <div className="border-b border-gray-100 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Users className="h-4 w-4 text-gray-500" />
                      <span className="text-sm font-medium text-gray-700">
                        {t('office.slides.aiTeam')}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {(Object.keys(teamState.agents) as SlidesAgentRole[]).map(
                        (role) => (
                          <AgentCard
                            key={role}
                            role={role}
                            state={teamState.agents[role]}
                            isActive={teamState.currentAgent === role}
                            t={t}
                          />
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* 页面列表 */}
                <div className="flex-1 overflow-y-auto p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700">
                      {t('office.slides.pageList')}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {pages.map((page, index) => (
                      <button
                        key={page.pageNumber}
                        onClick={() => setSelectedPageIndex(index)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all',
                          selectedPageIndex === index
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        )}
                      >
                        <div
                          className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium',
                            page.status === 'completed'
                              ? 'bg-green-100 text-green-700'
                              : page.status === 'generating'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-gray-100 text-gray-500'
                          )}
                        >
                          {page.status === 'generating' ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : page.status === 'completed' ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            page.pageNumber
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">
                            {page.outline?.title ||
                              t('office.slides.page', {
                                number: page.pageNumber,
                              })}
                          </p>
                          <p className="text-xs text-gray-500">
                            {page.status === 'completed'
                              ? t('office.slides.completed')
                              : page.status === 'generating'
                                ? t('office.slides.generating')
                                : t('office.slides.waiting')}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 错误提示 */}
                {error && (
                  <div className="border-t border-gray-200 p-4">
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                      <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
                      <div>
                        <p className="text-sm font-medium text-red-800">
                          {t('office.slides.generationError')}
                        </p>
                        <p className="mt-0.5 text-xs text-red-600">{error}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 拖拽调节手柄 */}
          <div
            className={cn(
              'absolute right-0 top-0 h-full w-1 cursor-col-resize transition-colors hover:bg-blue-500',
              isDragging && 'bg-blue-500'
            )}
            onMouseDown={() => setIsDragging(true)}
          />
        </div>

        {/* 右侧面板：PPT 预览 */}
        <div className="flex flex-1 flex-col overflow-hidden bg-gray-100">
          {/* 工具栏 */}
          <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-lg">📊</span>
              <div>
                <h2 className="font-medium text-gray-900">
                  {title || t('office.slides.presentationPreview')}
                </h2>
                <p className="text-xs text-gray-500">
                  {completedPages.length > 0
                    ? t('office.slides.noSlides', {
                        count: completedPages.length,
                      })
                    : t('office.slides.waitingGeneration')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {completedPages.length > 0 && (
                <>
                  <button
                    onClick={() => setThumbnailsExpanded(!thumbnailsExpanded)}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                  >
                    {thumbnailsExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                    <span>{t('office.slides.thumbnails')}</span>
                  </button>
                  <button
                    onClick={() => setIsFullscreen(!isFullscreen)}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                  >
                    {isFullscreen ? (
                      <Minimize2 className="h-4 w-4" />
                    ) : (
                      <Maximize2 className="h-4 w-4" />
                    )}
                  </button>
                  <button className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
                    <Download className="h-4 w-4" />
                    <span>{t('office.slides.export')}</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 预览内容 */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* 缩略图栏 */}
            <AnimatePresence>
              {thumbnailsExpanded && completedPages.length > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-b border-gray-200 bg-white"
                >
                  <div className="p-3">
                    <div className="flex gap-3 overflow-x-auto pb-2">
                      {pages.map((page, index) => {
                        if (!page.html) return null;
                        return (
                          <div
                            key={page.pageNumber}
                            className="w-40 flex-shrink-0"
                          >
                            <SlidePreview
                              html={page.html}
                              pageNumber={page.pageNumber}
                              title={
                                page.outline?.title ||
                                t('office.slides.page', {
                                  number: page.pageNumber,
                                })
                              }
                              isSelected={selectedPageIndex === index}
                              onClick={() => setSelectedPageIndex(index)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 主预览区 */}
            <div className="flex flex-1 items-center justify-center overflow-auto p-8">
              {currentPage?.html ? (
                <div className="relative w-full max-w-5xl">
                  {/* 页面导航 */}
                  <div className="absolute -left-12 top-1/2 z-10 -translate-y-1/2">
                    <button
                      onClick={() =>
                        setSelectedPageIndex(Math.max(0, selectedPageIndex - 1))
                      }
                      disabled={selectedPageIndex === 0}
                      className="rounded-full bg-white p-2 shadow-lg hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="absolute -right-12 top-1/2 z-10 -translate-y-1/2">
                    <button
                      onClick={() =>
                        setSelectedPageIndex(
                          Math.min(pages.length - 1, selectedPageIndex + 1)
                        )
                      }
                      disabled={selectedPageIndex === pages.length - 1}
                      className="rounded-full bg-white p-2 shadow-lg hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </div>

                  {/* 幻灯片内容 */}
                  <div
                    className="aspect-video w-full overflow-hidden rounded-xl bg-gray-900 shadow-2xl"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeSlideHtml(currentPage.html),
                    }}
                  />

                  {/* 页码指示 */}
                  <div className="absolute -bottom-8 left-1/2 -translate-x-1/2">
                    <span className="text-sm text-gray-500">
                      {selectedPageIndex + 1} / {pages.length}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <div className="mb-4 text-6xl">📊</div>
                  <p className="mb-2 text-lg font-medium text-gray-700">
                    {generating
                      ? t('office.slides.generatingInProgress')
                      : t('office.slides.preparingPPT')}
                  </p>
                  <p className="text-sm text-gray-500">
                    {generating
                      ? t('office.slides.teamCollaborating')
                      : t('office.slides.enterContentLeft')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
