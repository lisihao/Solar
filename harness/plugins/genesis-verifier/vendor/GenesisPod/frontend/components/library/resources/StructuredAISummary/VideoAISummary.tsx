'use client';

import React from 'react';
import { Play } from 'lucide-react';
import type { VideoAISummary } from '@/lib/types/ai-office';
import ClientDate from '@/components/common/ClientDate';
import { SectionPanelCard } from '@/components/ui/cards';
import { MarkdownViewer } from '@/components/common/markdown-viewer';

/**
 * 视频专属结构化摘要组件
 * 针对视频资源优化，突出讲者、章节和关键时间戳
 */
interface VideoAISummaryProps {
  summary: VideoAISummary;
  compact?: boolean;
  expandable?: boolean;
  onTimestampClick?: (timestamp: number) => void;
}

const VideoTypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const types = {
    lecture: {
      emoji: '🎓',
      label: 'Lecture',
      color: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    tutorial: {
      emoji: '📖',
      label: 'Tutorial',
      color: 'bg-green-50 text-green-700 border-green-200',
    },
    interview: {
      emoji: '🎤',
      label: 'Interview',
      color: 'bg-purple-50 text-purple-700 border-purple-200',
    },
    demo: {
      emoji: '🎬',
      label: 'Demo',
      color: 'bg-orange-50 text-orange-700 border-orange-200',
    },
    discussion: {
      emoji: '💬',
      label: 'Discussion',
      color: 'bg-pink-50 text-pink-700 border-pink-200',
    },
  };

  const t = types[type as keyof typeof types] || types.lecture;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium ${t.color}`}
    >
      <span>{t.emoji}</span>
      {t.label}
    </span>
  );
};

const formatTimestamp = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

export const VideoAISummaryComponent: React.FC<VideoAISummaryProps> = ({
  summary,
  compact = false,
  expandable = true,
  onTimestampClick,
}) => {
  const [isExpanded, setIsExpanded] = React.useState(!compact);

  return (
    <SectionPanelCard
      title={summary.mainTopic}
      icon={<Play className="h-4 w-4" />}
      accent="red"
      actions={
        <div className="flex items-center gap-2">
          <VideoTypeBadge type={summary.videoType} />
          <span className="rounded border border-gray-200 bg-white px-2 py-1 text-xs">
            {summary.pace}
          </span>
        </div>
      }
    >
      {/* 子头部：概览 + 视频指标 */}
      <div className="border-b border-gray-100 px-4 py-3">
        {/* 核心概览 */}
        {compact && !isExpanded ? (
          <p className="text-sm leading-relaxed text-gray-700">
            {summary.overview.substring(0, 150)}...
          </p>
        ) : (
          <div className="prose prose-sm max-w-none text-gray-700">
            <MarkdownViewer content={summary.overview} />
          </div>
        )}

        {/* 视频指标 */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-600">
          <span>⏱️ {summary.estimatedWatchTime} min watch</span>
          <span>🎯 {summary.audience}</span>
          <span>📖 {summary.readingTime} min read</span>
          <div className="ml-auto flex items-center gap-1">
            <span className="text-yellow-500">⭐</span>
            <span>{(summary.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      {isExpanded && (
        <div className="space-y-4 p-4">
          {/* 讲者信息 */}
          {summary.speakers.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                🎤 Speakers
              </h4>
              <div className="grid grid-cols-1 gap-2">
                {summary.speakers.map((speaker, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 rounded bg-gray-50 p-2"
                  >
                    <span className="text-lg">👤</span>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {speaker.name}
                      </p>
                      {speaker.role && (
                        <p className="text-xs text-gray-600">{speaker.role}</p>
                      )}
                      {speaker.expertise && (
                        <p className="text-xs text-blue-600">
                          Expertise: {speaker.expertise}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 章节 */}
          {summary.chapters.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                📑 Chapters & Timeline
              </h4>
              <div className="space-y-2">
                {summary.chapters.map((chapter, idx) => (
                  <button
                    key={idx}
                    onClick={() => onTimestampClick?.(chapter.timestamp)}
                    className="w-full rounded border border-blue-200 bg-blue-50 p-2.5 text-left transition-colors hover:bg-blue-100"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {chapter.title}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-600">
                          {chapter.summary}
                        </p>
                      </div>
                      <span className="font-mono flex-shrink-0 rounded border border-blue-200 bg-white px-2 py-1 text-xs text-blue-700">
                        {formatTimestamp(chapter.timestamp)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 主题和子主题 */}
          {summary.subtopics.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                📚 Topics Covered
              </h4>
              <div className="flex flex-wrap gap-2">
                {summary.subtopics.map((topic, idx) => (
                  <span
                    key={idx}
                    className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 关键要点 */}
          {summary.keyPoints.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                📌 Key Takeaways
              </h4>
              <ul className="space-y-1.5">
                {summary.keyPoints.map((point, idx) => (
                  <li key={idx} className="flex gap-2 text-sm text-gray-700">
                    <span className="flex-shrink-0 text-red-500">▸</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 关键帧 */}
          {summary.keyFrames && summary.keyFrames.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                🎬 Key Moments
              </h4>
              <div className="space-y-2">
                {summary.keyFrames.map((frame, idx) => (
                  <button
                    key={idx}
                    onClick={() => onTimestampClick?.(frame.timestamp)}
                    className="w-full rounded border border-purple-200 bg-purple-50 p-2 text-left transition-colors hover:bg-purple-100"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium text-purple-900">
                          {frame.description}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1 w-full rounded bg-gray-200">
                            <div
                              className="h-1 rounded bg-purple-500"
                              style={{
                                width: `${(frame.importance * 100).toFixed(0)}%`,
                              }}
                            ></div>
                          </div>
                        </div>
                      </div>
                      <span className="font-mono flex-shrink-0 rounded bg-white px-2 py-1 text-xs text-purple-700">
                        {formatTimestamp(frame.timestamp)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 关键词 */}
          {summary.keywords.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">
                🏷️ Keywords
              </h4>
              <div className="flex flex-wrap gap-2">
                {summary.keywords.map((keyword, idx) => (
                  <span
                    key={idx}
                    className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 元信息 */}
          <div className="border-t border-gray-100 pt-2">
            <p className="text-xs text-gray-500">
              AI-analyzed on{' '}
              <ClientDate date={summary.generatedAt} format="date" /> using{' '}
              {summary.model}
            </p>
          </div>
        </div>
      )}

      {/* 展开/收起按钮 */}
      {expandable && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full py-1 text-sm font-medium text-red-600 transition-colors hover:text-red-700"
          >
            {isExpanded ? '▼ Collapse' : '▶ View Chapters & Timeline'}
          </button>
        </div>
      )}
    </SectionPanelCard>
  );
};
