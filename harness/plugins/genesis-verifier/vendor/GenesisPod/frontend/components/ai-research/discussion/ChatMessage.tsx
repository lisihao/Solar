'use client';

/**
 * ChatMessage - Discussion chat message bubble
 *
 * Features:
 * - Agent role color coding (icon + name)
 * - Message type styling (critique, synthesis, findings, etc.)
 * - AIMessageRenderer for Markdown content
 * - Expandable search source references
 */

import { useState, useMemo } from 'react';
import {
  Crown,
  Search,
  BarChart3,
  PenLine,
  ShieldCheck,
  Info,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  AlertTriangle,
  User,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import AIMessageRenderer from '@/components/ui/content/AIMessageRenderer';
import type {
  DiscussionMessage,
  DiscussionMessageType,
  DiscussionRole,
} from '@/hooks';

// ==================== Direction Card Types ====================

interface ResearchDirection {
  title: string;
  description: string;
  assignedTo?: string;
  searchQueries?: string[];
}

/**
 * Extract JSON direction array from message content.
 * The backend asks the AI to output research directions in JSON format,
 * which may appear as raw JSON or inside markdown code fences.
 * Returns { textBefore, directions, textAfter } or null if not found.
 */
function extractDirections(content: string): {
  textBefore: string;
  directions: ResearchDirection[];
  textAfter: string;
} | null {
  // Try to find JSON inside markdown code fences first
  const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1]);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].title) {
        const fenceStart = content.indexOf(fenceMatch[0]);
        const fenceEnd = fenceStart + fenceMatch[0].length;
        return {
          textBefore: content.slice(0, fenceStart).trim(),
          directions: parsed as ResearchDirection[],
          textAfter: content.slice(fenceEnd).trim(),
        };
      }
    } catch {
      // Not valid JSON, continue
    }
  }

  // Try to find raw JSON array in content
  const arrayStart = content.indexOf('[');
  const arrayEnd = content.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    try {
      const jsonStr = content.slice(arrayStart, arrayEnd + 1);
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].title) {
        return {
          textBefore: content.slice(0, arrayStart).trim(),
          directions: parsed as ResearchDirection[],
          textAfter: content.slice(arrayEnd + 1).trim(),
        };
      }
    } catch {
      // Not valid JSON, continue
    }
  }

  return null;
}

interface ChatMessageProps {
  message: DiscussionMessage;
}

const ICON_MAP: Record<string, LucideIcon> = {
  crown: Crown,
  search: Search,
  'bar-chart-3': BarChart3,
  'pen-line': PenLine,
  'shield-check': ShieldCheck,
  info: Info,
  user: User,
};

const ROLE_COLORS: Record<
  DiscussionRole,
  { bg: string; text: string; border: string }
> = {
  director: {
    bg: 'bg-purple-500',
    text: 'text-purple-600',
    border: 'border-purple-400',
  },
  researcher: {
    bg: 'bg-blue-500',
    text: 'text-blue-600',
    border: 'border-blue-400',
  },
  analyst: {
    bg: 'bg-emerald-500',
    text: 'text-emerald-600',
    border: 'border-emerald-400',
  },
  writer: {
    bg: 'bg-amber-500',
    text: 'text-amber-600',
    border: 'border-amber-400',
  },
  reviewer: {
    bg: 'bg-rose-500',
    text: 'text-rose-600',
    border: 'border-rose-400',
  },
  user: {
    bg: 'bg-indigo-500',
    text: 'text-indigo-600',
    border: 'border-indigo-400',
  },
};

function formatTimestamp(timestamp: Date | string): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getMessageStyle(messageType: DiscussionMessageType): {
  borderClass?: string;
  bgClass?: string;
  layout: 'bubble' | 'compact' | 'divider';
  accentIcon?: LucideIcon;
} {
  switch (messageType) {
    case 'critique':
      return {
        borderClass: 'border-l-4 border-amber-400',
        bgClass: 'bg-amber-50/40',
        layout: 'bubble',
        accentIcon: AlertTriangle,
      };
    case 'cross_check':
      return {
        borderClass: 'border-l-4 border-amber-400',
        bgClass: 'bg-white',
        layout: 'bubble',
        accentIcon: AlertTriangle,
      };
    case 'synthesis':
      return {
        borderClass: 'border-l-4 border-purple-400',
        bgClass: 'bg-purple-50/30',
        layout: 'bubble',
      };
    case 'draft':
    case 'review':
      return {
        borderClass: 'border-l-4 border-purple-400',
        bgClass: 'bg-white',
        layout: 'bubble',
      };
    case 'status':
      return { bgClass: 'bg-gray-100', layout: 'compact' };
    case 'system':
      return {
        bgClass: 'bg-gray-50 border-y border-dashed border-gray-300',
        layout: 'divider',
      };
    case 'user':
      return {
        borderClass: 'border-r-4 border-indigo-400',
        bgClass: 'bg-indigo-50/40',
        layout: 'bubble',
      };
    case 'findings':
      return {
        borderClass: 'border-l-4 border-blue-400',
        bgClass: 'bg-white border border-gray-100',
        layout: 'bubble',
      };
    case 'proposal':
    case 'idea':
    default:
      return {
        bgClass: 'bg-white border border-gray-100',
        layout: 'bubble',
      };
  }
}

// ==================== Direction Cards Component ====================

function DirectionCards({ directions }: { directions: ResearchDirection[] }) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-1">
      {directions.map((dir, index) => (
        <div
          key={index}
          className="rounded-lg border border-purple-200 bg-purple-50/50 p-3"
        >
          <div className="mb-1.5 flex items-start gap-2">
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-purple-500 text-[10px] font-bold text-white">
              {index + 1}
            </span>
            <h4 className="text-sm font-semibold text-gray-900">{dir.title}</h4>
          </div>
          <p className="ml-7 text-xs leading-relaxed text-gray-600">
            {dir.description}
          </p>
          <div className="ml-7 mt-2 flex flex-wrap items-center gap-2">
            {dir.assignedTo && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                <User className="h-2.5 w-2.5" />
                {dir.assignedTo}
              </span>
            )}
            {dir.searchQueries?.map((q, qi) => (
              <span
                key={qi}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600"
              >
                <Search className="h-2.5 w-2.5" />
                {q}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ==================== Main Component ====================

export function ChatMessage({ message }: ChatMessageProps) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const Icon = ICON_MAP[message.agentIcon] || Info;
  const colors = ROLE_COLORS[message.agentRole];
  const style = getMessageStyle(message.messageType);
  const hasSearchResults =
    message.metadata?.searchResults &&
    message.metadata.searchResults.length > 0;

  // Detect and extract JSON direction blocks from content
  const parsedContent = useMemo(
    () => extractDirections(message.content),
    [message.content]
  );

  // System divider
  if (style.layout === 'divider') {
    return (
      <div className="my-6">
        <div className={cn('px-4 py-3 text-center', style.bgClass)}>
          <p className="text-sm font-medium text-gray-600">{message.content}</p>
        </div>
      </div>
    );
  }

  // Compact status message
  if (style.layout === 'compact') {
    return (
      <div className="my-2">
        <div className={cn('rounded-md px-4 py-2', style.bgClass)}>
          <p className="text-xs text-gray-600">{message.content}</p>
        </div>
      </div>
    );
  }

  const isUserMessage = message.messageType === 'user';

  // Full bubble message
  return (
    <div className="my-3">
      <div className={cn('flex gap-3', isUserMessage && 'flex-row-reverse')}>
        {/* Agent Icon */}
        <div
          className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white',
            colors.bg
          )}
        >
          <Icon className="h-4 w-4" />
        </div>

        {/* Message Content */}
        <div className={cn('min-w-0 flex-1', isUserMessage && 'text-right')}>
          {/* Agent Name + Message Type + Timestamp */}
          <div
            className={cn(
              'mb-1 flex items-baseline gap-2',
              isUserMessage && 'justify-end'
            )}
          >
            <span className={cn('text-sm font-semibold', colors.text)}>
              {message.agentName}
            </span>
            {style.accentIcon && (
              <style.accentIcon className="h-3 w-3 text-amber-500" />
            )}
            <span className="text-xs text-gray-400">
              {formatTimestamp(message.timestamp)}
            </span>
          </div>

          {/* Message Bubble with Markdown */}
          <div
            className={cn(
              'rounded-lg p-4 text-left shadow-sm',
              style.bgClass,
              style.borderClass
            )}
          >
            {parsedContent ? (
              <>
                {parsedContent.textBefore && (
                  <AIMessageRenderer content={parsedContent.textBefore} />
                )}
                <DirectionCards directions={parsedContent.directions} />
                {parsedContent.textAfter && (
                  <div className="mt-3">
                    <AIMessageRenderer content={parsedContent.textAfter} />
                  </div>
                )}
              </>
            ) : (
              <AIMessageRenderer content={message.content} />
            )}
          </div>

          {/* Search Sources Footer */}
          {hasSearchResults && (
            <div className="mt-2">
              <button
                onClick={() => setSourcesExpanded(!sourcesExpanded)}
                className="flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-gray-700"
              >
                {sourcesExpanded ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                <span>
                  {sourcesExpanded
                    ? '收起来源'
                    : `查看来源 (${message.metadata?.searchResults?.length ?? 0})`}
                </span>
              </button>

              {sourcesExpanded && (
                <div className="mt-2 space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
                  {(message.metadata?.searchResults ?? []).map(
                    (source, index) => (
                      <div
                        key={index}
                        className="flex items-start gap-2 text-xs"
                      >
                        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-600">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 font-medium text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            <span className="truncate">{source.title}</span>
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                          </a>
                          {source.snippet && (
                            <p className="mt-1 line-clamp-2 text-gray-600">
                              {source.snippet}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
