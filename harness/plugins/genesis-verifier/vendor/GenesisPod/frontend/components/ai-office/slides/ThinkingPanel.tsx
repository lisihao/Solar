'use client';

/**
 * AI Slides V5.0 - Thinking Panel
 *
 * Displays AI reasoning process during slide generation:
 * - Real-time streaming of thinking steps
 * - Structured display of reasoning, decisions, and outputs
 * - Expandable sections for detailed content
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Loader2,
  Lightbulb,
  Target,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileText,
  Palette,
  Layout,
  Code,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { useSlidesStore } from '@/stores';
import type { PageState } from '@/lib/types/slides';

// ============================================
// Types
// ============================================

export interface ThinkingEntry {
  id: string;
  type: 'step' | 'decision' | 'insight' | 'warning' | 'output';
  title: string;
  content: string;
  reasoning?: string;
  decision?: string;
  timestamp: Date;
  duration?: number;
  pageIndex?: number;
  skillId?: string;
  metadata?: Record<string, unknown>;
}

interface ThinkingPanelProps {
  missionId?: string;
  isVisible?: boolean;
  className?: string;
}

// ============================================
// Step Icon Mapping
// ============================================

const STEP_ICONS: Record<string, React.ElementType> = {
  drafting: FileText,
  layout: Layout,
  visuals: Palette,
  html: Code,
  default: Brain,
};

const TYPE_ICONS: Record<ThinkingEntry['type'], React.ElementType> = {
  step: Brain,
  decision: Target,
  insight: Lightbulb,
  warning: AlertTriangle,
  output: CheckCircle2,
};

const TYPE_COLORS: Record<ThinkingEntry['type'], string> = {
  step: 'border-blue-500/50 bg-blue-50',
  decision: 'border-green-500/50 bg-green-50',
  insight: 'border-amber-500/50 bg-amber-50',
  warning: 'border-red-500/50 bg-red-50',
  output: 'border-purple-500/50 bg-purple-50',
};

const TYPE_ICON_COLORS: Record<ThinkingEntry['type'], string> = {
  step: 'text-blue-500',
  decision: 'text-green-500',
  insight: 'text-amber-500',
  warning: 'text-red-500',
  output: 'text-purple-500',
};

// ============================================
// ThinkingEntry Component
// ============================================

function ThinkingEntryCard({ entry }: { entry: ThinkingEntry }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TYPE_ICONS[entry.type];
  const hasDetails = entry.reasoning || entry.decision || entry.metadata;

  return (
    <div className={cn('rounded-lg border-l-2 pl-4', TYPE_COLORS[entry.type])}>
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={cn(
          'flex w-full items-start gap-3 py-3 pr-3 text-left',
          hasDetails && 'cursor-pointer'
        )}
        disabled={!hasDetails}
      >
        <div
          className={cn(
            'mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white shadow-sm',
            TYPE_ICON_COLORS[entry.type]
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-gray-900">{entry.title}</h4>
            {entry.pageIndex !== undefined && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                P{entry.pageIndex + 1}
              </span>
            )}
            {entry.duration && (
              <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
                <Clock className="h-2.5 w-2.5" />
                {entry.duration}ms
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-gray-600">{entry.content}</p>
        </div>

        {hasDetails && (
          <ChevronRight
            className={cn(
              'mt-1 h-4 w-4 flex-shrink-0 text-gray-400 transition-transform',
              expanded && 'rotate-90'
            )}
          />
        )}
      </button>

      <AnimatePresence>
        {expanded && hasDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 pb-3 pr-3">
              {entry.reasoning && (
                <div className="rounded-lg bg-white/60 p-2.5">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-orange-600">
                    Reasoning
                  </div>
                  <p className="text-xs text-gray-600">{entry.reasoning}</p>
                </div>
              )}

              {entry.decision && (
                <div className="rounded-lg bg-white/60 p-2.5">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-green-600">
                    Decision
                  </div>
                  <p className="text-xs text-gray-700">{entry.decision}</p>
                </div>
              )}

              {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                <div className="rounded-lg bg-white/60 p-2.5">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                    Details
                  </div>
                  <pre className="text-[10px] text-gray-600">
                    {JSON.stringify(entry.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================
// Design Thinking Section (from PageState)
// ============================================

function DesignThinkingSection({ page }: { page: PageState }) {
  const [expanded, setExpanded] = useState(true);

  if (!page.design) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
        <Brain className="mx-auto mb-2 h-8 w-8 text-gray-400" />
        <p className="text-sm text-gray-500">
          {page.status === 'generating'
            ? 'AI is thinking...'
            : 'Design thinking will appear here during generation'}
        </p>
      </div>
    );
  }

  const steps = [
    {
      key: 'step1',
      number: 1,
      title: 'Drafting',
      subtitle: 'Initial Design',
      data: page.design.step1_drafting,
      color: 'bg-blue-100 text-blue-700',
    },
    {
      key: 'step2',
      number: 2,
      title: 'Layout',
      subtitle: 'Refining Structure',
      data: page.design.step2_refiningLayout,
      color: 'bg-green-100 text-green-700',
    },
    {
      key: 'step3',
      number: 3,
      title: 'Visuals',
      subtitle: 'Planning Colors',
      data: page.design.step3_planningVisuals,
      color: 'bg-purple-100 text-purple-700',
    },
    {
      key: 'step4',
      number: 4,
      title: 'HTML',
      subtitle: 'Generating Code',
      data: page.design.step4_formulatingHTML,
      color: 'bg-orange-100 text-orange-700',
    },
  ];

  return (
    <div className="space-y-3">
      {/* Page Outline Info */}
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
          <FileText className="h-4 w-4 text-orange-500" />
          Page Outline
        </div>
        <div className="mt-2 space-y-1.5 text-sm">
          <div>
            <span className="text-gray-500">Title: </span>
            <span className="font-medium text-gray-700">
              {page.outline?.title || 'Untitled'}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Template: </span>
            <span className="rounded bg-orange-100 px-2 py-0.5 text-xs text-orange-700">
              {page.outline?.templateType || 'Unknown'}
            </span>
          </div>
          {page.outline?.keyPoints && page.outline.keyPoints.length > 0 && (
            <div>
              <span className="text-gray-500">Key Points:</span>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-gray-600">
                {page.outline.keyPoints.map((point, i) => (
                  <li key={i}>{point}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Design Steps */}
      {steps.map((step) => (
        <div
          key={step.key}
          className="rounded-lg border border-gray-200 bg-white p-3"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold',
                step.color
              )}
            >
              {step.number}
            </span>
            {step.title}
            <span className="text-xs font-normal text-gray-400">
              {step.subtitle}
            </span>
          </div>
          <div className="mt-2 space-y-1 text-sm">
            {step.data &&
              Object.entries(step.data).map(([key, value]) => {
                if (!value) return null;
                if (Array.isArray(value)) {
                  if (value.length === 0) return null;
                  // Handle color arrays
                  if (
                    key.toLowerCase().includes('color') &&
                    typeof value[0] === 'string' &&
                    value[0].startsWith('#')
                  ) {
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <span className="text-gray-500">{formatKey(key)}:</span>
                        <div className="flex gap-1">
                          {value.map((color, i) => (
                            <span
                              key={i}
                              className="h-4 w-4 rounded border border-gray-200"
                              style={{ backgroundColor: color as string }}
                              title={color as string}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={key}>
                      <span className="text-gray-500">{formatKey(key)}:</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {value.map((item, i) => (
                          <span
                            key={i}
                            className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                          >
                            {String(item)}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                }
                // Handle single color value
                if (
                  key.toLowerCase().includes('color') &&
                  typeof value === 'string' &&
                  value.startsWith('#')
                ) {
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-gray-500">{formatKey(key)}: </span>
                      <span
                        className="h-4 w-4 rounded border border-gray-200"
                        style={{ backgroundColor: value }}
                      />
                      <span className="font-mono text-xs text-gray-500">
                        {value}
                      </span>
                    </div>
                  );
                }
                return (
                  <div key={key}>
                    <span className="text-gray-500">{formatKey(key)}: </span>
                    <span className="text-gray-700">{String(value)}</span>
                  </div>
                );
              })}
          </div>
        </div>
      ))}

      {/* Raw AI Response */}
      {page.design.rawResponse && (
        <details className="group rounded-lg border border-gray-200 bg-white">
          <summary className="flex cursor-pointer items-center gap-2 p-3 text-sm font-medium text-gray-800 hover:bg-gray-50">
            <Brain className="h-4 w-4 text-orange-500" />
            Full AI Response
            <ChevronRight className="ml-auto h-4 w-4 text-gray-400 transition-transform group-open:rotate-90" />
          </summary>
          <div className="border-t border-gray-100 p-3">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-gray-600">
              {page.design.rawResponse}
            </pre>
          </div>
        </details>
      )}
    </div>
  );
}

// ============================================
// Helper Functions
// ============================================

function formatKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

// ============================================
// Main Component
// ============================================

export function ThinkingPanel({
  missionId,
  isVisible = true,
  className,
}: ThinkingPanelProps) {
  const { pages, selectedPageIndex, streamEvents } = useSlidesStore();
  const [entries, setEntries] = useState<ThinkingEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const currentPage = pages[selectedPageIndex];

  // Parse thinking entries from stream events
  useEffect(() => {
    const thinkingEntries: ThinkingEntry[] = [];

    streamEvents.forEach((event, index) => {
      const data = (event.data || {}) as Record<string, unknown>;
      const timestamp =
        event.timestamp instanceof Date
          ? event.timestamp
          : new Date(event.timestamp);

      // Parse thinking:step events (cast to string for custom event types)
      const eventType = event.type as string;
      if (eventType === 'thinking:step' || eventType.startsWith('thinking:')) {
        thinkingEntries.push({
          id: `thinking-${index}`,
          type: 'step',
          title: String(data.title || 'Thinking'),
          content: String(data.content || data.message || ''),
          reasoning: data.reasoning ? String(data.reasoning) : undefined,
          decision: data.decision ? String(data.decision) : undefined,
          timestamp,
          pageIndex: data.pageIndex as number | undefined,
          skillId: data.skillId as string | undefined,
          metadata: data.metadata as Record<string, unknown> | undefined,
        });
      }

      // Parse agent events as insights
      if (
        event.type === 'agent:working' ||
        event.type === 'mission:agent_working'
      ) {
        const thought = data.thought || data.task;
        if (thought) {
          thinkingEntries.push({
            id: `agent-${index}`,
            type: 'insight',
            title: String(data.agentName || data.agent || 'Agent'),
            content: String(thought),
            timestamp,
          });
        }
      }

      // Parse agent completion as decisions
      if (
        event.type === 'agent:completed' ||
        event.type === 'mission:agent_done'
      ) {
        const result = data.result || data.message;
        if (result) {
          thinkingEntries.push({
            id: `decision-${index}`,
            type: 'decision',
            title: String(data.agentName || data.agent || 'Agent'),
            content: String(result),
            timestamp,
          });
        }
      }
    });

    setEntries(thinkingEntries);
    setIsStreaming(streamEvents.some((e) => e.type === 'phase:progress'));
  }, [streamEvents]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current && isStreaming) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, isStreaming]);

  if (!isVisible) return null;

  return (
    <div
      ref={scrollRef}
      className={cn('h-full overflow-y-auto bg-slate-50 p-4', className)}
    >
      <div className="space-y-4">
        {/* Current Page Design Thinking */}
        {currentPage && <DesignThinkingSection page={currentPage} />}

        {/* Stream Entries */}
        {entries.length > 0 && (
          <div className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Brain className="h-4 w-4 text-orange-500" />
              Generation Log
            </h3>
            {entries.map((entry) => (
              <ThinkingEntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        )}

        {/* Streaming Indicator */}
        {isStreaming && (
          <div className="flex items-center gap-2 text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">AI is thinking...</span>
          </div>
        )}

        {/* Empty State */}
        {!currentPage && entries.length === 0 && (
          <div className="flex h-64 items-center justify-center">
            <div className="text-center">
              <Brain className="mx-auto mb-4 h-10 w-10 text-gray-400" />
              <p className="text-sm text-gray-500">
                Select a page to view AI thinking process
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ThinkingPanel;
