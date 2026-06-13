/**
 * HierarchicalSummaryTab - 层次摘要浏览组件
 *
 * 基于 SCORE 论文的 Context-Aware Summarization，展示四级层次摘要：
 * - 场景级摘要
 * - 章节级摘要
 * - 弧线级摘要（远期上下文）
 */

import { useState, useEffect, useCallback } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Sparkles,
  Clock,
  Users,
  MapPin,
  Zap,
  FileText,
} from 'lucide-react';
import {
  getHierarchicalSummaries,
  generateSummaries,
  type HierarchicalSummariesResponse,
  type ChapterSummary,
  type SceneSummary,
} from '@/services/ai-writing/api';

// ==================== Constants ====================

/** 默认当前章节号（用于获取全部摘要） */
const DEFAULT_CURRENT_CHAPTER = 999;

/** 默认目标 token 数 */
const DEFAULT_TARGET_TOKENS = 8000;

// ==================== Types ====================

interface HierarchicalSummaryTabProps {
  projectId: string;
  currentChapter?: number;
}

export function HierarchicalSummaryTab({
  projectId,
  currentChapter,
}: HierarchicalSummaryTabProps) {
  const [data, setData] = useState<HierarchicalSummariesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(
    new Set()
  );
  const [viewMode, setViewMode] = useState<'structured' | 'context'>(
    'structured'
  );

  const fetchSummaries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getHierarchicalSummaries(projectId, {
        currentChapter: currentChapter || DEFAULT_CURRENT_CHAPTER,
        targetTokens: DEFAULT_TARGET_TOKENS,
      });
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load summaries');
    } finally {
      setLoading(false);
    }
  }, [projectId, currentChapter]);

  useEffect(() => {
    fetchSummaries();
  }, [fetchSummaries]);

  const handleGenerateSummaries = async () => {
    setGenerating(true);
    try {
      await generateSummaries(projectId);
      await fetchSummaries();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to generate summaries'
      );
    } finally {
      setGenerating(false);
    }
  };

  const toggleChapter = (chapterNumber: number) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chapterNumber)) {
        next.delete(chapterNumber);
      } else {
        next.add(chapterNumber);
      }
      return next;
    });
  };

  const hasSummaries =
    data &&
    (data.context.recentChapters.length > 0 ||
      data.context.mediumChapters.length > 0 ||
      data.context.distantContext);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-emerald-500" />
          <h3 className="font-semibold text-gray-900">Story Summaries</h3>
          {data && (
            <span className="text-xs text-gray-500">
              ~{data.context.estimatedTokens.toLocaleString()} tokens
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div
            className="flex rounded-md border border-gray-200"
            role="group"
            aria-label="View mode"
          >
            <button
              onClick={() => setViewMode('structured')}
              className={`px-2 py-1 text-xs ${
                viewMode === 'structured'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
              aria-pressed={viewMode === 'structured'}
            >
              Structured
            </button>
            <button
              onClick={() => setViewMode('context')}
              className={`px-2 py-1 text-xs ${
                viewMode === 'context'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
              aria-pressed={viewMode === 'context'}
            >
              Context
            </button>
          </div>

          <button
            onClick={handleGenerateSummaries}
            disabled={generating}
            className="flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-sm text-emerald-700 hover:bg-emerald-200 disabled:opacity-50"
            aria-label="Generate chapter summaries"
          >
            {generating ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Generate
          </button>

          <button
            onClick={fetchSummaries}
            disabled={loading}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Refresh summaries"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && !data ? (
          <div className="flex items-center justify-center p-8">
            <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="p-4">
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          </div>
        ) : !hasSummaries ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <FileText className="h-12 w-12 text-gray-300" />
            <p className="mt-2 font-medium text-gray-600">No Summaries Yet</p>
            <p className="mb-4 text-sm text-gray-500">
              Generate summaries for your chapters to see them here
            </p>
            <button
              onClick={handleGenerateSummaries}
              disabled={generating}
              className="flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {generating ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generate Summaries
            </button>
          </div>
        ) : viewMode === 'structured' ? (
          <StructuredView
            data={data}
            expandedChapters={expandedChapters}
            onToggleChapter={toggleChapter}
          />
        ) : (
          <ContextView formattedContext={data.formattedContext} />
        )}
      </div>
    </div>
  );
}

// ==================== Sub Components ====================

interface StructuredViewProps {
  data: HierarchicalSummariesResponse;
  expandedChapters: Set<number>;
  onToggleChapter: (chapterNumber: number) => void;
}

function StructuredView({
  data,
  expandedChapters,
  onToggleChapter,
}: StructuredViewProps) {
  const { context } = data;

  return (
    <div className="space-y-6 p-4">
      {/* Distant Context (Arc/Volume Level) */}
      {context.distantContext && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Clock className="h-4 w-4 text-purple-500" />
            <h4 className="font-medium text-purple-700">Story Background</h4>
            <span className="text-xs text-purple-500">(Arc Level)</span>
          </div>
          <p className="text-sm leading-relaxed text-gray-700">
            {context.distantContext}
          </p>
        </div>
      )}

      {/* Medium Chapters */}
      {context.mediumChapters.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-blue-500" />
            <h4 className="font-medium text-gray-700">Recent Plot</h4>
            <span className="text-xs text-gray-500">(Chapter Level)</span>
          </div>
          <div className="space-y-2">
            {context.mediumChapters.map((chapter) => (
              <ChapterCard
                key={chapter.chapterNumber}
                chapter={chapter}
                expanded={expandedChapters.has(chapter.chapterNumber)}
                onToggle={() => onToggleChapter(chapter.chapterNumber)}
                variant="medium"
              />
            ))}
          </div>
        </div>
      )}

      {/* Recent Chapters (Detailed) */}
      {context.recentChapters.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            <h4 className="font-medium text-gray-700">Recent Chapters</h4>
            <span className="text-xs text-gray-500">(Scene Level)</span>
          </div>
          <div className="space-y-2">
            {context.recentChapters.map((chapter) => (
              <ChapterCard
                key={chapter.chapterNumber}
                chapter={chapter}
                expanded={expandedChapters.has(chapter.chapterNumber)}
                onToggle={() => onToggleChapter(chapter.chapterNumber)}
                variant="recent"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface ChapterCardProps {
  chapter: ChapterSummary;
  expanded: boolean;
  onToggle: () => void;
  variant: 'recent' | 'medium';
}

function ChapterCard({
  chapter,
  expanded,
  onToggle,
  variant,
}: ChapterCardProps) {
  const isRecent = variant === 'recent';
  const borderColor = isRecent ? 'border-amber-200' : 'border-blue-200';
  const bgColor = isRecent ? 'bg-amber-50' : 'bg-blue-50';
  const textColor = isRecent ? 'text-amber-700' : 'text-blue-700';

  return (
    <div className={`overflow-hidden rounded-lg border ${borderColor}`}>
      <button
        onClick={onToggle}
        className={`flex w-full items-start gap-3 p-3 text-left ${bgColor}`}
      >
        {expanded ? (
          <ChevronDown className={`mt-0.5 h-4 w-4 ${textColor}`} />
        ) : (
          <ChevronRight className={`mt-0.5 h-4 w-4 ${textColor}`} />
        )}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`font-medium ${textColor}`}>
              Chapter {chapter.chapterNumber}
            </span>
            {chapter.title && (
              <span className="text-gray-600">{chapter.title}</span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-gray-600">
            {chapter.summary}
          </p>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 bg-white p-3">
          {/* Full Summary */}
          <p className="mb-3 text-sm leading-relaxed text-gray-700">
            {chapter.summary}
          </p>

          {/* Key Events */}
          {chapter.keyEvents.length > 0 && (
            <div className="mb-3">
              <h5 className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-500">
                <Zap className="h-3 w-3" /> Key Events
              </h5>
              <div className="flex flex-wrap gap-1">
                {chapter.keyEvents.map((event, idx) => (
                  <span
                    key={idx}
                    className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                  >
                    {event}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Character Changes */}
          {Object.keys(chapter.characterChanges).length > 0 && (
            <div className="mb-3">
              <h5 className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-500">
                <Users className="h-3 w-3" /> Character Changes
              </h5>
              <div className="space-y-1">
                {Object.entries(chapter.characterChanges).map(
                  ([name, change]) => (
                    <div key={name} className="text-xs">
                      <span className="font-medium text-gray-700">{name}:</span>{' '}
                      <span className="text-gray-600">{change}</span>
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          {/* Emotional Tone */}
          {chapter.emotionalTone && (
            <div className="mb-3">
              <h5 className="mb-1 text-xs font-medium text-gray-500">
                Emotional Tone
              </h5>
              <span className="rounded-full bg-pink-100 px-2 py-0.5 text-xs text-pink-600">
                {chapter.emotionalTone}
              </span>
            </div>
          )}

          {/* Scenes (only for recent chapters) */}
          {isRecent && chapter.scenes && chapter.scenes.length > 0 && (
            <div>
              <h5 className="mb-2 text-xs font-medium text-gray-500">Scenes</h5>
              <div className="space-y-2">
                {chapter.scenes.map((scene) => (
                  <SceneCard key={scene.sceneNumber} scene={scene} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SceneCard({ scene }: { scene: SceneSummary }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-2 text-xs">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-medium text-gray-700">
          Scene {scene.sceneNumber}
        </span>
        {scene.location && (
          <span className="flex items-center gap-0.5 text-gray-500">
            <MapPin className="h-3 w-3" />
            {scene.location}
          </span>
        )}
      </div>
      <p className="text-gray-600">{scene.summary}</p>
      {scene.characters.length > 0 && (
        <div className="mt-1 flex items-center gap-1">
          <Users className="h-3 w-3 text-gray-400" />
          <span className="text-gray-500">{scene.characters.join(', ')}</span>
        </div>
      )}
      {scene.keyAction && (
        <div className="mt-1 text-gray-500">
          <Zap className="inline h-3 w-3" /> {scene.keyAction}
        </div>
      )}
    </div>
  );
}

interface ContextViewProps {
  formattedContext: string;
}

function ContextView({ formattedContext }: ContextViewProps) {
  return (
    <div className="p-4">
      <div className="mb-2 text-sm text-gray-500">
        Pre-formatted context for AI prompts:
      </div>
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <pre className="whitespace-pre-wrap text-sm text-gray-700">
          {formattedContext || 'No context available'}
        </pre>
      </div>
    </div>
  );
}

export default HierarchicalSummaryTab;
