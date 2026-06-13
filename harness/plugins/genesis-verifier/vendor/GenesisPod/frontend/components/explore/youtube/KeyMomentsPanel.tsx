'use client';

import { useState, useRef, useEffect } from 'react';
import { EmptyState } from '@/components/ui/states/EmptyState';

export interface KeyMoment {
  id: string;
  timestamp: number;
  title: string;
  summary?: string;
  importance: 'high' | 'medium' | 'low';
  tags?: string[];
  hasNote?: boolean;
}

interface KeyMomentsPanelProps {
  moments: KeyMoment[];
  currentTime: number;
  onSeek: (timestamp: number) => void;
  onAddNote?: (momentId: string) => void;
  onToggleMoment?: (momentId: string) => void;
}

export default function KeyMomentsPanel({
  moments,
  currentTime,
  onSeek,
  onAddNote,
  onToggleMoment,
}: KeyMomentsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>(
    'all'
  );
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeMomentRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to active moment
  useEffect(() => {
    if (activeMomentRef.current && scrollContainerRef.current) {
      activeMomentRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [currentTime]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const filteredMoments = moments.filter(
    (m) => filter === 'all' || m.importance === filter
  );

  const getCurrentMoment = () => {
    for (let i = filteredMoments.length - 1; i >= 0; i--) {
      if (filteredMoments[i].timestamp <= currentTime) {
        return filteredMoments[i];
      }
    }
    return null;
  };

  const currentMoment = getCurrentMoment();

  const importanceConfig = {
    high: {
      icon: '⭐',
      color: 'bg-red-50 border-red-200 text-red-900',
      badgeColor: 'bg-red-500 text-white',
      hoverColor: 'hover:border-red-300 hover:bg-red-100',
    },
    medium: {
      icon: '🔸',
      color: 'bg-orange-50 border-orange-200 text-orange-900',
      badgeColor: 'bg-orange-500 text-white',
      hoverColor: 'hover:border-orange-300 hover:bg-orange-100',
    },
    low: {
      icon: '•',
      color: 'bg-gray-50 border-gray-200 text-gray-900',
      badgeColor: 'bg-gray-500 text-white',
      hoverColor: 'hover:border-gray-300 hover:bg-gray-100',
    },
  };

  if (!isExpanded) {
    return (
      <div className="absolute bottom-4 left-4 z-10">
        <button
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-purple-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-all hover:shadow-xl"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <span>关键时刻</span>
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold">
            {moments.length}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="absolute bottom-4 left-4 z-10 flex h-96 w-96 flex-col rounded-xl border border-gray-200 bg-white shadow-2xl">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 bg-gradient-to-r from-purple-50 to-pink-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 text-white shadow-sm">
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">关键时刻</h3>
            <p className="text-xs text-gray-500">
              {filteredMoments.length} 个重点
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsExpanded(false)}
          className="rounded-lg p-1.5 transition-colors hover:bg-white"
        >
          <svg
            className="h-4 w-4 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-shrink-0 gap-1 border-b border-gray-100 bg-gray-50 px-4 py-2">
        {(['all', 'high', 'medium', 'low'] as const).map((level) => (
          <button
            key={level}
            onClick={() => setFilter(level)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-all ${
              filter === level
                ? 'bg-white text-purple-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {
              {
                all: '全部',
                high: '⭐ 重要',
                medium: '🔸 一般',
                low: '• 次要',
              }[level]
            }
          </button>
        ))}
      </div>

      {/* Current Playing Moment */}
      {currentMoment && (
        <div className="flex-shrink-0 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3">
          <div className="mb-1 text-xs font-medium text-blue-600">
            ▶ 正在播放
          </div>
          <div className="flex items-start gap-3">
            <span className="text-lg">
              {importanceConfig[currentMoment.importance].icon}
            </span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-gray-900">
                {currentMoment.title}
              </div>
              {currentMoment.summary && (
                <div className="mt-1 line-clamp-2 text-xs text-gray-600">
                  {currentMoment.summary}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Moments List */}
      <div
        ref={scrollContainerRef}
        className="scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-gray-50 min-h-0 flex-1 overflow-y-auto"
      >
        {filteredMoments.length === 0 ? (
          <EmptyState
            size="sm"
            type="search"
            title={filter === 'all' ? '暂无关键时刻' : '此类别暂无内容'}
          />
        ) : (
          <div className="space-y-2 p-3">
            {filteredMoments.map((moment) => {
              const isActive = currentMoment?.id === moment.id;
              const config = importanceConfig[moment.importance];

              return (
                <div
                  key={moment.id}
                  ref={isActive ? activeMomentRef : null}
                  onClick={() => onSeek(moment.timestamp)}
                  className={`group cursor-pointer rounded-lg border-2 p-3 transition-all ${
                    isActive
                      ? 'border-purple-400 bg-purple-50 shadow-md'
                      : `${config.color} ${config.hoverColor}`
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon & Timestamp */}
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-xl">{config.icon}</span>
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-bold ${
                          isActive
                            ? 'bg-purple-600 text-white'
                            : config.badgeColor
                        }`}
                      >
                        {formatTime(moment.timestamp)}
                      </span>
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <h4
                        className={`text-sm font-semibold leading-snug ${
                          isActive ? 'text-purple-900' : 'text-gray-900'
                        }`}
                      >
                        {moment.title}
                      </h4>

                      {moment.summary && (
                        <p className="mt-1 line-clamp-2 text-xs text-gray-600">
                          {moment.summary}
                        </p>
                      )}

                      {/* Tags */}
                      {moment.tags && moment.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {moment.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-white/60 px-2 py-0.5 text-xs font-medium text-gray-700"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="mt-2 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                        {onAddNote && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddNote(moment.id);
                            }}
                            className="flex items-center gap-1 rounded bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                          >
                            <svg
                              className="h-3 w-3"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                              />
                            </svg>
                            笔记
                          </button>
                        )}
                        {moment.hasNote && (
                          <span className="flex items-center gap-1 text-xs text-blue-600">
                            <svg
                              className="h-3 w-3"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                              <path
                                fillRule="evenodd"
                                d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z"
                                clipRule="evenodd"
                              />
                            </svg>
                            已记录
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div className="flex-shrink-0 border-t border-gray-100 bg-gray-50 px-4 py-2">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <div className="flex items-center gap-3">
            <span>
              ⭐ {moments.filter((m) => m.importance === 'high').length}
            </span>
            <span>
              🔸 {moments.filter((m) => m.importance === 'medium').length}
            </span>
            <span>
              • {moments.filter((m) => m.importance === 'low').length}
            </span>
          </div>
          <span className="text-gray-500">点击时刻快速跳转</span>
        </div>
      </div>
    </div>
  );
}
