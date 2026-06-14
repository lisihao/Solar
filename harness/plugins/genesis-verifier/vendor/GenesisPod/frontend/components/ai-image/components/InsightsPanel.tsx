'use client';

import type { GeneratedImage, InsightsTab } from '../types';
import { Tabs } from '@/components/ui/tabs';
import { getLayoutCapacity, getMaxSections } from '../utils';
import { InsightCard } from './InsightCard';

interface InsightsPanelProps {
  image: GeneratedImage;
  activeTab: InsightsTab;
  onTabChange: (tab: InsightsTab) => void;
  templateLayout?: string;
}

export function InsightsPanel({
  image,
  activeTab,
  onTabChange,
  templateLayout = 'auto',
}: InsightsPanelProps) {
  const insights = image.promptInsights;

  // Check if insights has any meaningful content
  const hasInsightsContent =
    insights &&
    (insights.designJournal.length > 0 ||
      insights.informationArchitecture.sections.length > 0 ||
      insights.layoutPlan.length > 0 ||
      insights.visualLanguage.colorPalette.length > 0 ||
      insights.qualityChecks.length > 0 ||
      insights.negativeKeywords.length > 0 ||
      insights.inspiration.length > 0 ||
      insights.imagePrompt);

  return (
    <div className="flex h-full flex-col">
      {/* Tab Headers */}
      <Tabs
        className="bg-gray-50"
        value={activeTab}
        onChange={(k) => onTabChange(k as InsightsTab)}
        items={[
          { key: 'insights', label: 'Prompt Insights' },
          { key: 'steps', label: 'Processing Steps' },
        ]}
      />

      {/* Tab Content */}
      <div className="scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-300 flex-1 overflow-y-auto">
        {activeTab === 'insights' && hasInsightsContent && insights ? (
          <div className="space-y-4 p-4">
            {/* Design Journal */}
            {insights.designJournal.length > 0 && (
              <InsightCard
                title="Design Journal"
                icon="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              >
                <div className="space-y-3">
                  {insights.designJournal.map((entry, idx) => (
                    <div
                      key={idx}
                      className="border-l-2 border-purple-400 pl-3"
                    >
                      <p className="text-xs font-medium text-purple-700">
                        {entry.title}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-600">
                        {entry.narrative}
                      </p>
                    </div>
                  ))}
                </div>
              </InsightCard>
            )}

            {/* Information Architecture */}
            {insights.informationArchitecture.sections.length > 0 && (
              <InsightCard
                title="Information Architecture"
                icon="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              >
                <div className="space-y-3">
                  {/* Data statistics and layout hint */}
                  {(() => {
                    const sectionCount =
                      insights.informationArchitecture.sections.length;
                    const totalMetrics =
                      insights.informationArchitecture.sections.reduce(
                        (acc, s) => acc + (s.metrics?.length || 0),
                        0
                      );
                    const capacity = getLayoutCapacity(templateLayout);
                    const isOverCapacity =
                      capacity &&
                      ((capacity.type === '指标' &&
                        totalMetrics > capacity.max) ||
                        (capacity.type !== '指标' &&
                          sectionCount > capacity.max));

                    return (
                      <div className="flex items-center justify-between rounded-md bg-blue-50 px-2.5 py-1.5">
                        <span className="text-xs text-blue-700">
                          {sectionCount} 个区块 · {totalMetrics} 个指标
                        </span>
                        {isOverCapacity && (
                          <span className="flex items-center gap-1 text-xs text-amber-600">
                            <svg
                              className="h-3.5 w-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                              />
                            </svg>
                            超出{capacity.type}容量({capacity.max})
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  {insights.informationArchitecture.title && (
                    <p className="text-sm font-semibold text-gray-900">
                      {insights.informationArchitecture.title}
                    </p>
                  )}
                  {insights.informationArchitecture.subtitle && (
                    <p className="text-xs text-gray-600">
                      {insights.informationArchitecture.subtitle}
                    </p>
                  )}
                  {insights.informationArchitecture.heroStatement && (
                    <p className="text-xs italic text-purple-600">
                      &quot;{insights.informationArchitecture.heroStatement}
                      &quot;
                    </p>
                  )}
                  {insights.informationArchitecture.sections.map(
                    (section, idx) => {
                      const maxSections = getMaxSections(templateLayout);
                      const willBeTruncated = idx >= maxSections;

                      return (
                        <div
                          key={idx}
                          className={`rounded-lg p-2.5 ${
                            willBeTruncated
                              ? 'border border-dashed border-amber-300 bg-amber-50/50'
                              : 'bg-gray-50'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            {section.title && (
                              <p className="text-xs font-medium text-gray-900">
                                {section.title}
                              </p>
                            )}
                            {willBeTruncated && (
                              <span className="ml-2 shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                                可能不显示
                              </span>
                            )}
                          </div>
                          {section.summary && (
                            <p className="mt-1 text-xs text-gray-600">
                              {section.summary}
                            </p>
                          )}
                          {section.bullets.length > 0 && (
                            <ul className="mt-1.5 space-y-0.5">
                              {section.bullets.map((bullet, bIdx) => (
                                <li
                                  key={bIdx}
                                  className="flex items-start gap-1.5 text-xs text-gray-600"
                                >
                                  <span className="mt-0.5 text-purple-500">
                                    -
                                  </span>
                                  {bullet}
                                </li>
                              ))}
                            </ul>
                          )}
                          {section.metrics.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {section.metrics.map((metric, mIdx) => (
                                <div
                                  key={mIdx}
                                  className="rounded bg-purple-50 px-2 py-1"
                                >
                                  <span className="text-[10px] text-gray-500">
                                    {metric.label}
                                  </span>
                                  <p className="text-xs font-medium text-purple-700">
                                    {metric.value}
                                  </p>
                                  {metric.comparison && (
                                    <span className="text-[10px] text-green-600">
                                      {metric.comparison}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    }
                  )}
                </div>
              </InsightCard>
            )}

            {/* Layout Plan */}
            {insights.layoutPlan.length > 0 && (
              <InsightCard
                title="Layout Plan"
                icon="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
              >
                <ul className="space-y-1">
                  {insights.layoutPlan.map((item, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-1.5 text-xs text-gray-600"
                    >
                      <span className="font-mono text-blue-500">
                        {idx + 1}.
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </InsightCard>
            )}

            {/* Visual Language */}
            {(insights.visualLanguage.colorPalette.length > 0 ||
              insights.visualLanguage.typography) && (
              <InsightCard
                title="Visual Language"
                icon="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
              >
                <div className="space-y-3">
                  {/* Color Palette */}
                  {insights.visualLanguage.colorPalette.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[10px] uppercase tracking-wider text-gray-500">
                        Color Palette
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {insights.visualLanguage.colorPalette.map(
                          (color, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-1.5 rounded bg-gray-100 px-2 py-1"
                            >
                              <div
                                className="h-3 w-3 rounded-full border border-gray-300"
                                style={{
                                  backgroundColor: color.startsWith('#')
                                    ? color
                                    : undefined,
                                }}
                              />
                              <span className="text-xs text-gray-700">
                                {color}
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}
                  {/* Typography */}
                  {insights.visualLanguage.typography && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                        Typography
                      </p>
                      <p className="text-xs text-gray-700">
                        {insights.visualLanguage.typography}
                      </p>
                    </div>
                  )}
                  {/* Iconography */}
                  {insights.visualLanguage.iconography && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                        Iconography
                      </p>
                      <p className="text-xs text-gray-700">
                        {insights.visualLanguage.iconography}
                      </p>
                    </div>
                  )}
                  {/* Chart Style */}
                  {insights.visualLanguage.chartStyle && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                        Chart Style
                      </p>
                      <p className="text-xs text-gray-700">
                        {insights.visualLanguage.chartStyle}
                      </p>
                    </div>
                  )}
                  {/* Background */}
                  {insights.visualLanguage.background && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                        Background
                      </p>
                      <p className="text-xs text-gray-700">
                        {insights.visualLanguage.background}
                      </p>
                    </div>
                  )}
                  {/* Grid System */}
                  {insights.visualLanguage.gridSystem && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                        Grid System
                      </p>
                      <p className="text-xs text-gray-700">
                        {insights.visualLanguage.gridSystem}
                      </p>
                    </div>
                  )}
                </div>
              </InsightCard>
            )}

            {/* Quality Checks */}
            {insights.qualityChecks.length > 0 && (
              <InsightCard
                title="Quality Checks"
                icon="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              >
                <ul className="space-y-1">
                  {insights.qualityChecks.map((check, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-1.5 text-xs text-gray-600"
                    >
                      <svg
                        className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-green-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      {check}
                    </li>
                  ))}
                </ul>
              </InsightCard>
            )}

            {/* Negative Keywords */}
            {insights.negativeKeywords.length > 0 && (
              <InsightCard
                title="Negative Keywords"
                icon="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
              >
                <div className="flex flex-wrap gap-1.5">
                  {insights.negativeKeywords.map((keyword, idx) => (
                    <span
                      key={idx}
                      className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-600"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              </InsightCard>
            )}

            {/* Inspiration */}
            {insights.inspiration.length > 0 && (
              <InsightCard
                title="Inspiration"
                icon="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              >
                <ul className="space-y-1">
                  {insights.inspiration.map((item, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-1.5 text-xs text-gray-600"
                    >
                      <span className="text-yellow-500">*</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </InsightCard>
            )}

            {/* Original Input & Final Prompts */}
            <InsightCard
              title="Prompts"
              icon="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            >
              <div className="space-y-3">
                {image.prompt && (
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                      Original Input
                    </p>
                    <p className="rounded bg-gray-50 p-2 text-xs text-gray-700">
                      {image.prompt}
                    </p>
                  </div>
                )}
                {insights.imagePrompt && (
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                      Final Prompt
                    </p>
                    <p className="rounded bg-purple-50 p-2 text-xs text-gray-700">
                      {insights.imagePrompt}
                    </p>
                  </div>
                )}
                {insights.fallbackPrompt && (
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                      Fallback Prompt
                    </p>
                    <p className="rounded bg-gray-50 p-2 text-xs text-gray-600">
                      {insights.fallbackPrompt}
                    </p>
                  </div>
                )}
                {image.negativePrompt && (
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                      Negative Prompt
                    </p>
                    <p className="rounded bg-red-50 p-2 text-xs text-red-600">
                      {image.negativePrompt}
                    </p>
                  </div>
                )}
              </div>
            </InsightCard>
          </div>
        ) : activeTab === 'insights' ? (
          <div className="p-4">
            {/* Show basic prompt info even without full insights */}
            {image.prompt || image.enhancedPrompt ? (
              <div className="space-y-4">
                <InsightCard
                  title="Prompts"
                  icon="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                >
                  <div className="space-y-3">
                    {image.prompt && (
                      <div>
                        <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                          Original Input
                        </p>
                        <p className="rounded bg-gray-50 p-2 text-xs text-gray-700">
                          {image.prompt}
                        </p>
                      </div>
                    )}
                    {image.enhancedPrompt && (
                      <div>
                        <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                          Final Prompt
                        </p>
                        <p className="rounded bg-purple-50 p-2 text-xs text-gray-700">
                          {image.enhancedPrompt}
                        </p>
                      </div>
                    )}
                    {image.negativePrompt && (
                      <div>
                        <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
                          Negative Prompt
                        </p>
                        <p className="rounded bg-red-50 p-2 text-xs text-red-600">
                          {image.negativePrompt}
                        </p>
                      </div>
                    )}
                  </div>
                </InsightCard>
                <div className="flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <svg
                      className="mx-auto mb-2 h-6 w-6 opacity-50"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                      />
                    </svg>
                    <p className="text-[10px]">
                      Uncheck &quot;Skip AI&quot; for detailed insights
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400">
                <div className="text-center">
                  <svg
                    className="mx-auto mb-2 h-8 w-8 opacity-50"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                  <p className="text-xs">No prompt insights available</p>
                  <p className="mt-1 text-[10px] text-gray-400">
                    Enable AI enhancement to see insights
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4">
            {/* Processing Steps */}
            {image.processingSteps && image.processingSteps.length > 0 ? (
              <div className="space-y-3">
                {/* Models Used */}
                {(image.textModelUsed || image.imageModelUsed) && (
                  <div className="space-y-1.5 rounded-lg bg-gray-50 p-3">
                    {image.textModelUsed && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500">
                          Text Model:
                        </span>
                        <span className="text-xs text-gray-700">
                          {image.textModelUsed}
                        </span>
                      </div>
                    )}
                    {image.imageModelUsed && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500">
                          Image Model:
                        </span>
                        <span className="text-xs text-gray-700">
                          {image.imageModelUsed}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {/* Steps Timeline */}
                <div className="space-y-2">
                  {image.processingSteps.map((step, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <div
                        className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                          step.status === 'completed'
                            ? 'text-green-500'
                            : step.status === 'processing'
                              ? 'animate-pulse text-blue-500'
                              : step.status === 'error'
                                ? 'text-red-500'
                                : 'text-gray-300'
                        }`}
                      >
                        {step.status === 'completed' && (
                          <svg
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                        {step.status === 'processing' && (
                          <svg
                            className="animate-spin"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                        )}
                        {step.status === 'error' && (
                          <svg
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        )}
                        {step.status === 'pending' && (
                          <svg
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              cx="12"
                              cy="12"
                              r="10"
                              strokeWidth="2"
                              className="opacity-30"
                            />
                          </svg>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-gray-700">
                          {step.title}
                        </p>
                        {step.content && (
                          <p className="mt-0.5 line-clamp-2 break-all text-xs text-gray-500">
                            {step.content}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Enhanced Prompt */}
                {image.enhancedPrompt && (
                  <div className="mt-4 border-t border-gray-200 pt-4">
                    <p className="mb-1.5 text-[10px] uppercase tracking-wider text-gray-500">
                      Final Image Prompt
                    </p>
                    <p className="rounded bg-gray-50 p-2 text-xs leading-relaxed text-gray-700">
                      {image.enhancedPrompt}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center text-gray-400">
                <div className="text-center">
                  <svg
                    className="mx-auto mb-2 h-8 w-8 opacity-50"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <p className="text-xs">No processing steps recorded</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
