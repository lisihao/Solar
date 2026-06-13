'use client';

/**
 * AI Image Generator Component - Professional Three-Column Layout (Light Theme)
 * - Left: Vertical thumbnail gallery (scroll + selection)
 * - Center: Large image canvas with tools
 * - Right: Insights panel + Input area
 * - Responsive: Mobile uses horizontal thumbnails at top
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { confirm, useImageSourceStore } from '@/stores';

// Note: The following extracted components are available for future integration:
import { InputArea } from './components/InputArea';
// import { ThumbnailGallery } from './components/ThumbnailGallery';
// import { InsightsPanel } from './components/InsightsPanel';
// import { ContextMenu } from './components/ContextMenu';
// import { LightboxModal } from './components/LightboxModal';
// import { ControlBar } from './components/ControlBar';
// import { StreamingProgress } from './components/StreamingProgress';
// Types are available at: import type { ... } from './types';
// Utilities are available at: import { ... } from './utils';

import SourcePool from './SourcePool';
import { ClientDate } from '@/components/common/ClientDate';

import { logger } from '@/lib/utils/logger';
import { Tabs } from '@/components/ui/tabs';
// ===================== TYPE DEFINITIONS =====================

interface ProcessingStep {
  step: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  title: string;
  content?: string;
  timestamp?: string;
}

interface PromptDesignJournalEntry {
  title: string;
  narrative: string;
}

interface PromptMetric {
  label: string;
  value: string;
  comparison?: string;
}

interface PromptVisualCue {
  type?: string;
  description?: string;
}

interface PromptSection {
  title?: string;
  summary?: string;
  bullets: string[];
  metrics: PromptMetric[];
  visual?: PromptVisualCue;
}

interface PromptInformationArchitecture {
  title?: string;
  subtitle?: string;
  heroStatement?: string;
  sections: PromptSection[];
  callToAction?: string;
}

interface PromptVisualLanguage {
  colorPalette: string[];
  typography?: string;
  iconography?: string;
  chartStyle?: string;
  background?: string;
  gridSystem?: string;
}

interface PromptInsights {
  imagePrompt: string;
  fallbackPrompt?: string;
  designJournal: PromptDesignJournalEntry[];
  informationArchitecture: PromptInformationArchitecture;
  visualLanguage: PromptVisualLanguage;
  layoutPlan: string[];
  qualityChecks: string[];
  negativeKeywords: string[];
  styleShiftReasoning: string[];
  inspiration: string[];
}

interface GeneratedImage {
  id: string;
  prompt: string;
  enhancedPrompt?: string;
  promptInsights?: PromptInsights;
  negativePrompt?: string;
  imageUrl: string;
  createdAt: string;
  width: number;
  height: number;
  isBookmarked?: boolean;
  processingSteps?: ProcessingStep[];
  extractedContent?: string;
  textModelUsed?: string;
  imageModelUsed?: string;
}

interface AIModel {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  icon?: string;
  isDefault: boolean;
}

interface ModelsResponse {
  textModels: AIModel[];
  imageModels: AIModel[];
}

interface UploadedFile {
  file: File;
  id: string;
  preview?: string;
}

type InputMode = 'prompt' | 'youtube' | 'url' | 'files' | 'refine';
type InsightsTab = 'insights' | 'steps';

interface ImageGeneratorProps {
  initialImageId?: string;
}

// ===================== HELPER COMPONENTS =====================

// Thumbnail Gallery Component (Left Side / Top on Mobile)
function ThumbnailGallery({
  images,
  selectedImage,
  bookmarkedImages,
  onSelect,
  onContextMenu,
  onWheel,
  isVertical = true,
}: {
  images: GeneratedImage[];
  selectedImage: GeneratedImage | null;
  bookmarkedImages: Set<string>;
  onSelect: (img: GeneratedImage) => void;
  onContextMenu: (e: React.MouseEvent, img: GeneratedImage) => void;
  onWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  isVertical?: boolean;
}) {
  const galleryRef = useRef<HTMLDivElement>(null);

  if (images.length === 0) {
    return (
      <div
        className={`flex items-center justify-center ${isVertical ? 'h-full' : 'h-20'}`}
      >
        <div className="p-4 text-center">
          {/* 更精美的空状态图标 */}
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-gray-100 to-gray-50 shadow-inner">
            <svg
              className="h-6 w-6 text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <p className="text-xs font-medium text-gray-400">
            {isVertical ? 'History' : 'Images'}
          </p>
          <p className="mt-1 text-[10px] leading-tight text-gray-300">
            {isVertical ? 'Your creations appear here' : 'No images yet'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={galleryRef}
      onWheel={onWheel}
      className={`
        ${
          isVertical
            ? 'flex flex-col items-center gap-2 overflow-y-auto overflow-x-hidden px-2 py-2'
            : 'flex flex-row gap-2 overflow-x-auto overflow-y-hidden px-2 py-2'
        }
        scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-300 hover:scrollbar-thumb-gray-400
      `}
    >
      {images.map((img, index) => (
        <button
          key={img.id}
          onClick={() => onSelect(img)}
          onContextMenu={(e) => onContextMenu(e, img)}
          className={`
            relative flex-shrink-0 overflow-hidden rounded-lg transition-all duration-200
            ${isVertical ? 'h-16 w-16' : 'h-14 w-14'}
            ${
              selectedImage?.id === img.id
                ? 'scale-105 ring-2 ring-purple-500 ring-offset-2 ring-offset-white'
                : 'hover:scale-102 opacity-70 hover:opacity-100'
            }
          `}
        >
          {/* Number indicator */}
          <div className="absolute left-0.5 top-0.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[9px] font-medium text-white">
            {images.length - index}
          </div>
          {/* Library indicator */}
          {bookmarkedImages.has(img.id) && (
            <div className="absolute right-0.5 top-0.5 z-10">
              <svg
                className="h-3 w-3 text-amber-500 drop-shadow"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
          )}
          {/* Time indicator */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1 py-0.5">
            <span className="text-[8px] text-white/90">
              <ClientDate
                date={img.createdAt}
                format="time"
                timeOptions={{
                  hour: '2-digit',
                  minute: '2-digit',
                }}
              />
            </span>
          </div>
          <img
            src={img.imageUrl}
            alt={img.prompt}
            className="h-full w-full object-cover"
          />
        </button>
      ))}
    </div>
  );
}

// Canvas Toolbar Component
function CanvasToolbar({
  image,
  onExpand,
  onDownload,
  onRefine,
  onCopy,
}: {
  image: GeneratedImage;
  onExpand: () => void;
  onDownload: () => void;
  onRefine: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 shadow-lg">
      <button
        onClick={onExpand}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-gray-700 transition hover:bg-gray-100"
        title="View fullscreen"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
          />
        </svg>
        <span className="hidden sm:inline">Expand</span>
      </button>
      <div className="h-4 w-px bg-gray-300" />
      <button
        onClick={onRefine}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-purple-600 transition hover:bg-purple-50"
        title="Refine this image"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        <span className="hidden sm:inline">Refine</span>
      </button>
      <div className="h-4 w-px bg-gray-300" />
      <button
        onClick={onDownload}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-gray-700 transition hover:bg-gray-100"
        title="Download image"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        <span className="hidden sm:inline">Download</span>
      </button>
      <button
        onClick={onCopy}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-gray-700 transition hover:bg-gray-100"
        title="Copy image"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
          />
        </svg>
      </button>
    </div>
  );
}

// Insights Panel Component
function InsightsPanel({
  image,
  activeTab,
  onTabChange,
  templateLayout = 'auto',
}: {
  image: GeneratedImage;
  activeTab: InsightsTab;
  onTabChange: (tab: InsightsTab) => void;
  templateLayout?: string;
}) {
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
        variant="underline"
        size="sm"
        value={activeTab}
        onChange={(key) => onTabChange(key as InsightsTab)}
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
                  {/* 数据量统计与布局提示 */}
                  {(() => {
                    const sectionCount =
                      insights.informationArchitecture.sections.length;
                    const totalMetrics =
                      insights.informationArchitecture.sections.reduce(
                        (acc, s) => acc + (s.metrics?.length || 0),
                        0
                      );
                    // 根据模板类型显示容量信息
                    const getLayoutCapacity = () => {
                      if (templateLayout === 'statistics') {
                        return { max: 12, type: '指标' };
                      } else if (
                        templateLayout === 'cards' ||
                        templateLayout === 'auto'
                      ) {
                        return { max: 15, type: '卡片' };
                      } else if (templateLayout === 'timeline') {
                        return { max: 5, type: '阶段' };
                      } else if (templateLayout === 'ranking') {
                        return { max: 15, type: '排名项' }; // ranking模板支持15个实体
                      }
                      return null;
                    };
                    const capacity = getLayoutCapacity();
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
                      "{insights.informationArchitecture.heroStatement}"
                    </p>
                  )}
                  {insights.informationArchitecture.sections.map(
                    (section, idx) => {
                      // 计算该section在当前模板下是否会被截断
                      const getMaxSections = () => {
                        if (templateLayout === 'statistics') return 12;
                        if (templateLayout === 'timeline') return 5;
                        if (templateLayout === 'matrix') return 4;
                        if (templateLayout === 'ranking') return 15;
                        return 15; // cards/auto
                      };
                      const willBeTruncated = idx >= getMaxSections();

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

// Insight Card Component
function InsightCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-100"
      >
        <svg
          className="h-4 w-4 flex-shrink-0 text-purple-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d={icon}
          />
        </svg>
        <span className="flex-1 text-xs font-medium text-gray-700">
          {title}
        </span>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
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
      {isExpanded && <div className="bg-white px-3 pb-3">{children}</div>}
    </div>
  );
}

// ===================== MAIN COMPONENT =====================

export default function ImageGenerator({
  initialImageId,
}: ImageGeneratorProps) {
  // Input state
  const [inputMode, setInputMode] = useState<InputMode>('prompt');
  const [prompt, setPrompt] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubePrompt, setYoutubePrompt] = useState('');
  const [urls, setUrls] = useState<string[]>(['']);
  const [urlPrompt, setUrlPrompt] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [filesPrompt, setFilesPrompt] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // Refine mode
  const [refineImage, setRefineImage] = useState<GeneratedImage | null>(null);
  const [refinePrompt, setRefinePrompt] = useState('');

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  // SSE streaming state
  const [streamingSteps, setStreamingSteps] = useState<ProcessingStep[]>([]);
  const [streamingInsights, setStreamingInsights] = useState<{
    textModelUsed?: string;
    imageModelUsed?: string;
    renderingMode?: string;
  } | null>(null);

  // Model state
  const [models, setModels] = useState<ModelsResponse>({
    textModels: [],
    imageModels: [],
  });
  const [selectedImageModelId, setSelectedImageModelId] = useState<string>('');
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [skipEnhancement, setSkipEnhancement] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<
    '1:1' | '16:9' | '9:16' | '4:3'
  >(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ai-image-aspect-ratio');
      if (saved && ['1:1', '16:9', '9:16', '4:3'].includes(saved)) {
        return saved as '1:1' | '16:9' | '9:16' | '4:3';
      }
    }
    return '1:1';
  });
  // Template layout selection (auto = AI decides)
  type TemplateLayout =
    | 'auto'
    | 'cards'
    | 'center_visual'
    | 'timeline'
    | 'comparison'
    | 'pyramid'
    | 'radial'
    | 'statistics'
    | 'checklist'
    | 'funnel'
    | 'matrix'
    | 'ranking'; // 新增：排行榜/横向比较
  const [templateLayout, setTemplateLayout] = useState<TemplateLayout>('auto');
  const [imageStyle, setImageStyle] = useState<string>('');

  // UI state
  const [insightsTab, setInsightsTab] = useState<InsightsTab>('insights');
  const [lightboxImage, setLightboxImage] = useState<GeneratedImage | null>(
    null
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    image: GeneratedImage;
  } | null>(null);
  const [bookmarkedImages, setBookmarkedImages] = useState<Set<string>>(
    new Set()
  );
  const [isMobile, setIsMobile] = useState(false);

  // Source Pool & Mentions
  const { sources } = useImageSourceStore();
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Fetch models
  const fetchModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/ai-image/models`,
        {
          headers: { ...getAuthHeader() },
        }
      );
      if (response.ok) {
        const result = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const data: ModelsResponse = result?.data ?? result;
        setModels(data);
        // 严格 BYOK：用户 key 模型优先（同 pickPreferredModel 规则；这里 ModelsResponse
        // 不是 AIModel[]，单独 inline 一次以避免类型耦合）。
        const userKeyImageModel = data.imageModels.find(
          (m) => (m as { isUserKey?: boolean }).isUserKey
        );
        const defaultImageModel =
          userKeyImageModel ||
          data.imageModels.find((m) => m.isDefault) ||
          data.imageModels[0];
        if (defaultImageModel) setSelectedImageModelId(defaultImageModel.id);
      }
    } catch (err) {
      logger.error('Failed to fetch models:', err);
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  // Fetch history
  const fetchHistory = useCallback(async () => {
    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/ai-image/history`,
        {
          headers: { ...getAuthHeader() },
        }
      );
      if (response.ok) {
        const result = await response.json();
        // Handle wrapped response { success: true, data: [...] }
        const data: GeneratedImage[] = result?.data ?? result;
        if (data && data.length > 0) {
          setGeneratedImages(data);
          if (initialImageId) {
            const targetImage = data.find((img) => img.id === initialImageId);
            setSelectedImage(targetImage || data[0]);
          } else {
            setSelectedImage(data[0]);
          }
          const bookmarked = new Set<string>();
          data.forEach((img) => {
            if (img.isBookmarked) bookmarked.add(img.id);
          });
          setBookmarkedImages(bookmarked);
        }
      }
    } catch (err) {
      logger.error('Failed to fetch history:', err);
    }
  }, [initialImageId]);

  useEffect(() => {
    fetchModels();
    fetchHistory();
  }, [fetchModels, fetchHistory]);

  // Save aspect ratio
  useEffect(() => {
    localStorage.setItem('ai-image-aspect-ratio', aspectRatio);
  }, [aspectRatio]);

  // ESC key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (contextMenu) setContextMenu(null);
        else if (lightboxImage) setLightboxImage(null);
      }
    };
    const handleClick = () => {
      if (contextMenu) setContextMenu(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', handleClick);
    };
  }, [lightboxImage, contextMenu]);

  // URL helpers
  const addUrlInput = () => setUrls([...urls, '']);
  const removeUrlInput = (index: number) => {
    if (urls.length > 1) setUrls(urls.filter((_, i) => i !== index));
  };
  const updateUrl = (index: number, value: string) => {
    const newUrls = [...urls];
    newUrls[index] = value;
    setUrls(newUrls);
  };

  // File handling
  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;
    const newFiles: UploadedFile[] = [];
    Array.from(files).forEach((file) => {
      const supportedTypes = [
        'text/plain',
        'text/markdown',
        'text/html',
        'application/json',
        'application/pdf',
        'text/vtt',
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
      ];
      const supportedExtensions = [
        '.txt',
        '.md',
        '.html',
        '.json',
        '.pdf',
        '.srt',
        '.vtt',
      ];
      const isSupported =
        supportedTypes.includes(file.type) ||
        supportedExtensions.some((ext) =>
          file.name.toLowerCase().endsWith(ext)
        ) ||
        file.type.startsWith('image/');

      if (isSupported && file.size <= 50 * 1024 * 1024) {
        const uploadedFile: UploadedFile = {
          file,
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        };
        if (file.type.startsWith('image/')) {
          uploadedFile.preview = URL.createObjectURL(file);
        }
        newFiles.push(uploadedFile);
      }
    });
    setUploadedFiles((prev) => [...prev, ...newFiles]);
  };

  const removeFile = (id: string) => {
    setUploadedFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file?.preview) URL.revokeObjectURL(file.preview);
      return prev.filter((f) => f.id !== id);
    });
  };

  // Drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  // File icon helper
  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/'))
      return 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z';
    if (file.type === 'application/pdf')
      return 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z';
    return 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';
  };

  // Validation
  const hasValidInput = () => {
    switch (inputMode) {
      case 'prompt':
        return prompt.trim().length > 0;
      case 'youtube':
        return youtubeUrl.trim().length > 0;
      case 'url':
        return urls.some((u) => u.trim().length > 0);
      case 'files':
        return uploadedFiles.length > 0;
      case 'refine':
        return refineImage !== null && refinePrompt.trim().length > 0;
      default:
        return false;
    }
  };

  // Convert image URL to Base64
  const imageUrlToBase64 = async (imageUrl: string): Promise<string> => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          const base64Data = base64.split(',')[1] || base64;
          resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      logger.error('Failed to convert image to base64:', err);
      throw err;
    }
  };

  // Refine mode
  const handleRefineImage = (image: GeneratedImage) => {
    setRefineImage(image);
    setRefinePrompt('');
    setInputMode('refine');
    setContextMenu(null);
  };

  const handleCancelRefine = () => {
    setRefineImage(null);
    setRefinePrompt('');
    setInputMode('prompt');
  };

  // Generate image with SSE streaming
  const handleGenerate = async () => {
    if (!hasValidInput() || isGenerating) return;

    setIsGenerating(true);
    setError(null);
    setSelectedImage(null);
    setStreamingSteps([]);
    setStreamingInsights(null);

    try {
      // File uploads still use the regular POST endpoint
      if (inputMode === 'files' && uploadedFiles.length > 0) {
        const formData = new FormData();
        uploadedFiles.forEach((uf) => formData.append('files', uf.file));
        if (selectedImageModelId)
          formData.append('imageModelId', selectedImageModelId);
        formData.append('skipEnhancement', String(skipEnhancement));
        formData.append('aspectRatio', aspectRatio);
        if (imageStyle) formData.append('style', imageStyle);
        if (filesPrompt.trim()) formData.append('prompt', filesPrompt.trim());

        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/ai-image/generate-with-files`,
          {
            method: 'POST',
            headers: { ...getAuthHeader() },
            body: formData,
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || 'Failed to generate image');
        }

        const result = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const data = result?.data ?? result;
        const newImage: GeneratedImage = {
          ...data,
          createdAt: new Date().toISOString(),
        };
        setGeneratedImages((prev) => [newImage, ...prev]);
        setSelectedImage(newImage);
        setIsGenerating(false);
        return;
      }

      // Build SSE URL params
      const params = new URLSearchParams();
      params.set('aspectRatio', aspectRatio);
      params.set('skipEnhancement', String(skipEnhancement));
      if (selectedImageModelId)
        params.set('imageModelId', selectedImageModelId);
      // Only pass template if user explicitly selected (not auto)
      if (templateLayout !== 'auto')
        params.set('templateLayout', templateLayout);
      // Pass image style if selected
      if (imageStyle) params.set('style', imageStyle);

      switch (inputMode) {
        case 'prompt':
          params.set('prompt', prompt.trim());
          const mentions = prompt.match(/@\[(.*?)\]/g);
          if (mentions) {
            const extractedUrls: string[] = [];
            mentions.forEach((mention) => {
              const title = mention.slice(2, -1);
              const source = sources.find((s) => s.title === title);
              if (source) extractedUrls.push(source.url);
            });
            if (extractedUrls.length > 0)
              params.set('urls', extractedUrls.join(','));
          }
          break;
        case 'youtube':
          params.set('urls', youtubeUrl.trim());
          if (youtubePrompt.trim()) params.set('prompt', youtubePrompt.trim());
          break;
        case 'url':
          params.set('urls', urls.filter((u) => u.trim()).join(','));
          if (urlPrompt.trim()) params.set('prompt', urlPrompt.trim());
          break;
        case 'refine':
          // Refine mode: send referenceImageUrl to backend (avoids CORS issues)
          if (refineImage) {
            const response = await fetch(
              `${config.apiBaseUrl}/api/v1/ai-image/generate`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...getAuthHeader(),
                },
                body: JSON.stringify({
                  referenceImageUrl: refineImage.imageUrl,
                  prompt: refinePrompt.trim(),
                  skipEnhancement: true,
                  imageModelId: selectedImageModelId,
                  aspectRatio,
                }),
              }
            );
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(errorData.message || 'Failed to generate image');
            }
            const result = await response.json();
            // Handle wrapped response { success: true, data: {...} }
            const data = result?.data ?? result;
            const newImage: GeneratedImage = {
              ...data,
              createdAt: new Date().toISOString(),
            };
            setGeneratedImages((prev) => [newImage, ...prev]);
            setSelectedImage(newImage);
            setRefineImage(null);
            setRefinePrompt('');
            setInputMode('prompt');
            setIsGenerating(false);
            return;
          }
          break;
      }

      // Use SSE for streaming generation with POST (supports long prompts)
      const sseUrl = `${config.apiBaseUrl}/api/v1/ai-image/generate/stream`;

      // Convert URLSearchParams to object for POST body
      const bodyData: Record<string, string> = {};
      params.forEach((value, key) => {
        bodyData[key] = value;
      });

      const response = await fetch(sseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...getAuthHeader(),
        },
        body: JSON.stringify(bodyData),
      });

      if (!response.ok) {
        // Try to extract error message from response
        let errorMessage = 'Failed to connect to stream';
        try {
          const errorData = await response.json();
          errorMessage =
            errorData.message ||
            errorData.error ||
            `Server error: ${response.status}`;
        } catch {
          // If response is not JSON, try to get text
          try {
            const errorText = await response.text();
            if (errorText) {
              errorMessage = errorText.slice(0, 200); // Limit error message length
            }
          } catch {
            errorMessage = `Server error: ${response.status} ${response.statusText}`;
          }
        }
        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let buffer = '';
      let sawComplete = false;
      // proxy 兜底基线：本次生成前已有的图 id，用于流被掐断后回捞新图
      const knownImageIds = new Set(generatedImages.map((img) => img.id));

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'step') {
                setStreamingSteps(data.allSteps || []);
              } else if (data.type === 'insights') {
                setStreamingInsights({
                  textModelUsed: data.textModelUsed,
                  renderingMode: data.renderingMode,
                });
              } else if (data.type === 'complete') {
                sawComplete = true;
                const newImage: GeneratedImage = {
                  ...data.result,
                  createdAt: new Date().toISOString(),
                };
                setGeneratedImages((prev) => [newImage, ...prev]);
                setSelectedImage(newImage);
                setStreamingSteps([]);
                setStreamingInsights(null);
              } else if (data.type === 'error') {
                throw new Error(data.error || 'Generation failed');
              }
            } catch (parseError) {
              logger.warn('Failed to parse SSE data:', line);
            }
          }
        }
      }

      // proxy 兜底：未收到 complete（流被代理/网络掐断）→ 后端通常已生成入库，
      // 轮询 history 回捞本次新图，避免「转完了却没图」的黑洞。
      if (!sawComplete) {
        let recovered: GeneratedImage | null = null;
        for (let attempt = 0; attempt < 12 && !recovered; attempt++) {
          await new Promise((r) => setTimeout(r, attempt < 3 ? 1500 : 3000));
          try {
            const histRes = await fetch(
              `${config.apiBaseUrl}/api/v1/ai-image/history`,
              { headers: getAuthHeader() }
            );
            if (!histRes.ok) continue;
            const histJson = await histRes.json();
            const list: GeneratedImage[] = histJson?.data ?? histJson ?? [];
            recovered =
              list.find((img) => img?.id && !knownImageIds.has(img.id)) ?? null;
          } catch {
            // 轮询期间瞬时错误，继续重试
          }
        }
        if (recovered) {
          const found = recovered;
          setGeneratedImages((prev) => [found, ...prev]);
          setSelectedImage(found);
        } else {
          setError(
            '生成流被网络/代理中断，且未回捞到结果，请稍后在历史查看或重试。'
          );
        }
      }

      if (inputMode === 'refine') {
        setRefineImage(null);
        setRefinePrompt('');
        setInputMode('prompt');
      }
    } catch (err) {
      logger.error('Image generation failed:', err);
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to generate image';
      setError(errorMessage);
    } finally {
      setIsGenerating(false);
      setStreamingSteps([]);
      setStreamingInsights(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && inputMode === 'prompt') {
      e.preventDefault();
      handleGenerate();
    }
  };

  // Download
  const handleDownload = async (image: GeneratedImage) => {
    try {
      // Include auth header for protected URLs (e.g., /api/v1/ai-image/{id}/image)
      const headers =
        image.imageUrl.startsWith(config.apiBaseUrl || '') ||
        image.imageUrl.startsWith('/') ||
        image.imageUrl.includes(config.apiBaseUrl || '')
          ? getAuthHeader()
          : undefined;

      const response = await fetch(image.imageUrl, { headers });
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-image-${image.id}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      logger.error('Download failed:', err);
      // Fallback: open in new tab so the user can manually save
      window.open(image.imageUrl, '_blank', 'noopener,noreferrer');
    }
  };

  // Context menu
  const handleContextMenu = (e: React.MouseEvent, image: GeneratedImage) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, image });
  };

  // Bookmark
  const handleBookmark = async (image: GeneratedImage) => {
    try {
      const isBookmarked = bookmarkedImages.has(image.id);
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/ai-image/${image.id}/bookmark`,
        {
          method: isBookmarked ? 'DELETE' : 'POST',
          headers: { ...getAuthHeader() },
        }
      );

      if (response.ok) {
        setBookmarkedImages((prev) => {
          const newSet = new Set(prev);
          if (isBookmarked) newSet.delete(image.id);
          else newSet.add(image.id);
          return newSet;
        });
        setGeneratedImages((prev) =>
          prev.map((img) =>
            img.id === image.id ? { ...img, isBookmarked: !isBookmarked } : img
          )
        );
      }
    } catch (err) {
      logger.error('Bookmark failed:', err);
    }
    setContextMenu(null);
  };

  // Delete
  const handleDelete = async (image: GeneratedImage) => {
    if (
      !(await confirm({
        title: 'Are you sure you want to delete this image?',
        type: 'danger',
      }))
    ) {
      setContextMenu(null);
      return;
    }

    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/ai-image/${image.id}`,
        {
          method: 'DELETE',
          headers: { ...getAuthHeader() },
        }
      );

      if (response.ok) {
        setGeneratedImages((prev) => prev.filter((img) => img.id !== image.id));
        if (selectedImage?.id === image.id) setSelectedImage(null);
        setBookmarkedImages((prev) => {
          const newSet = new Set(prev);
          newSet.delete(image.id);
          return newSet;
        });
      }
    } catch (err) {
      logger.error('Delete failed:', err);
    }
    setContextMenu(null);
  };

  // Copy
  const handleCopyLink = async (image: GeneratedImage) => {
    try {
      await navigator.clipboard.writeText(image.imageUrl);
    } catch (err) {
      logger.error('Copy link failed:', err);
    }
    setContextMenu(null);
  };

  const handleCopyImage = async (image: GeneratedImage) => {
    try {
      const response = await fetch(image.imageUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
    } catch (err) {
      logger.error('Copy image failed:', err);
    }
    setContextMenu(null);
  };

  const handleOpenInNewTab = (image: GeneratedImage) => {
    window.open(image.imageUrl, '_blank');
    setContextMenu(null);
  };

  // Wheel navigation
  const handleGalleryWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (generatedImages.length <= 1) return;

      const currentIndex = generatedImages.findIndex(
        (img) => img.id === selectedImage?.id
      );
      if (currentIndex === -1) return;

      const direction = e.deltaY > 0 ? 1 : -1;
      const newIndex = Math.max(
        0,
        Math.min(generatedImages.length - 1, currentIndex + direction)
      );

      if (newIndex !== currentIndex) {
        setSelectedImage(generatedImages[newIndex]);
      }
    },
    [generatedImages, selectedImage]
  );

  // Filtered sources for mentions
  const filteredSources = useMemo(() => {
    return sources.filter((s) =>
      s.title.toLowerCase().includes(mentionQuery.toLowerCase())
    );
  }, [sources, mentionQuery]);

  // URL input handlers for InputArea
  const handleUrlChange = useCallback((index: number, value: string) => {
    setUrls((prev) => {
      const newUrls = [...prev];
      newUrls[index] = value;
      return newUrls;
    });
  }, []);

  const handleAddUrl = useCallback(() => {
    if (urls.length < 5) {
      setUrls((prev) => [...prev, '']);
    }
  }, [urls.length]);

  const handleRemoveUrl = useCallback((index: number) => {
    setUrls((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // File remove handler for InputArea
  const handleRemoveFile = useCallback((id: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  // ===================== RENDER =====================

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* Mobile: Horizontal Thumbnails at Top */}
      {isMobile && generatedImages.length > 0 && (
        <div className="flex-shrink-0 border-b border-gray-200 bg-gray-50">
          <ThumbnailGallery
            images={generatedImages}
            selectedImage={selectedImage}
            bookmarkedImages={bookmarkedImages}
            onSelect={setSelectedImage}
            onContextMenu={handleContextMenu}
            onWheel={handleGalleryWheel}
            isVertical={false}
          />
        </div>
      )}

      {/* Main Three-Column Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: Vertical Thumbnail Gallery (Desktop Only) */}
        {!isMobile && (
          <div className="scrollbar-thin w-20 flex-shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50">
            <ThumbnailGallery
              images={generatedImages}
              selectedImage={selectedImage}
              bookmarkedImages={bookmarkedImages}
              onSelect={setSelectedImage}
              onContextMenu={handleContextMenu}
              onWheel={handleGalleryWheel}
              isVertical={true}
            />
          </div>
        )}

        {/* CENTER: Main Canvas */}
        <div className="flex flex-1 flex-col overflow-hidden bg-white">
          {/* Canvas Area */}
          <div className="relative flex flex-1 items-center justify-center overflow-auto p-4">
            {selectedImage ? (
              <div className="relative max-h-full max-w-full">
                {/* Image Info Bar */}
                <div className="absolute left-0 right-0 top-0 flex items-center justify-between rounded-t-xl bg-gradient-to-b from-black/50 to-transparent px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white/90">
                      {selectedImage.width} x {selectedImage.height}
                    </span>
                    {selectedImage.imageModelUsed && (
                      <>
                        <span className="text-white/40">|</span>
                        <span className="text-xs text-purple-200">
                          {selectedImage.imageModelUsed}
                        </span>
                      </>
                    )}
                  </div>
                  <span className="text-xs text-white/70">
                    <ClientDate
                      date={selectedImage.createdAt}
                      format="datetime"
                    />
                  </span>
                </div>
                {/* Main Image */}
                <img
                  src={selectedImage.imageUrl}
                  alt={selectedImage.prompt}
                  className="max-h-[80vh] cursor-pointer rounded-xl object-contain shadow-2xl transition hover:shadow-purple-500/30"
                  onClick={() => setLightboxImage(selectedImage)}
                  onContextMenu={(e) => handleContextMenu(e, selectedImage)}
                />
                {/* Toolbar */}
                <CanvasToolbar
                  image={selectedImage}
                  onExpand={() => setLightboxImage(selectedImage)}
                  onDownload={() => handleDownload(selectedImage)}
                  onRefine={() => handleRefineImage(selectedImage)}
                  onCopy={() => handleCopyImage(selectedImage)}
                />
              </div>
            ) : isGenerating ? (
              <div className="flex flex-col items-center gap-4 p-8">
                {/* Spinner */}
                <div className="relative h-20 w-20">
                  <div className="absolute inset-0 animate-spin rounded-full border-4 border-purple-200 border-t-purple-500" />
                  <div
                    className="absolute inset-3 animate-spin rounded-full border-4 border-blue-200 border-t-blue-500"
                    style={{
                      animationDirection: 'reverse',
                      animationDuration: '1.5s',
                    }}
                  />
                </div>
                <p className="text-sm text-gray-500">
                  See progress in the right panel
                </p>
              </div>
            ) : (
              <div className="flex max-w-lg flex-col items-center gap-8 px-6 text-center">
                {/* 精美的渐变图标 */}
                <div className="relative">
                  {/* 背景光晕效果 */}
                  <div className="absolute -inset-4 rounded-full bg-gradient-to-r from-purple-200 via-pink-100 to-blue-200 opacity-60 blur-xl" />
                  <div className="relative flex h-28 w-28 items-center justify-center rounded-3xl bg-gradient-to-br from-purple-500 via-purple-400 to-indigo-500 shadow-xl shadow-purple-200">
                    <svg
                      className="h-14 w-14 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    {/* AI 星星装饰 */}
                    <div className="absolute -right-1 -top-1 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg">
                      <svg
                        className="h-4 w-4 text-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* 标题和描述 */}
                <div className="space-y-3">
                  <h2 className="text-2xl font-bold tracking-tight text-gray-900">
                    Create with AI
                  </h2>
                  <p className="text-base leading-relaxed text-gray-500">
                    Transform your ideas into stunning visuals
                  </p>
                </div>

                {/* 简洁的操作提示 */}
                <p className="text-sm text-gray-400">
                  Use the input panel on the right to get started →
                </p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Insights Panel + Input Area */}
        <div
          className={`flex flex-col border-l border-gray-200 bg-white ${isMobile ? 'w-full' : 'w-96'}`}
        >
          {/* Insights Panel (when image selected and NOT generating) */}
          {selectedImage && !isGenerating && (
            <div className="flex-1 overflow-hidden border-b border-gray-200">
              <InsightsPanel
                image={selectedImage}
                activeTab={insightsTab}
                onTabChange={setInsightsTab}
                templateLayout={templateLayout}
              />
            </div>
          )}

          {/* Streaming Progress Panel (when generating - always show regardless of selectedImage) */}
          {isGenerating && (
            <div className="flex-1 overflow-auto border-b border-gray-200 p-4">
              <div className="space-y-3">
                {/* Header */}
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-300 border-t-purple-600" />
                  <span className="text-sm font-medium text-gray-700">
                    Creating your image...
                  </span>
                </div>
                {streamingInsights?.textModelUsed && (
                  <p className="text-xs text-gray-500">
                    Text Model: {streamingInsights.textModelUsed}
                  </p>
                )}

                {/* Real-time Steps */}
                {streamingSteps.length > 0 && (
                  <div className="space-y-2">
                    {streamingSteps.map((step) => (
                      <div
                        key={step.step}
                        className={`flex items-start gap-2 rounded-lg p-2 text-xs transition-all ${
                          step.status === 'processing'
                            ? 'border border-purple-200 bg-purple-50'
                            : step.status === 'completed'
                              ? 'border border-green-200 bg-green-50'
                              : step.status === 'error'
                                ? 'border border-red-200 bg-red-50'
                                : 'bg-gray-50'
                        }`}
                      >
                        {/* Status Icon */}
                        <div className="mt-0.5 flex-shrink-0">
                          {step.status === 'processing' ? (
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-purple-300 border-t-purple-600" />
                          ) : step.status === 'completed' ? (
                            <svg
                              className="h-3 w-3 text-green-500"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          ) : step.status === 'error' ? (
                            <svg
                              className="h-3 w-3 text-red-500"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                          ) : (
                            <div className="h-3 w-3 rounded-full bg-gray-300" />
                          )}
                        </div>

                        {/* Content */}
                        <div className="min-w-0 flex-1">
                          <p
                            className={`font-medium ${
                              step.status === 'processing'
                                ? 'text-purple-700'
                                : step.status === 'completed'
                                  ? 'text-green-700'
                                  : step.status === 'error'
                                    ? 'text-red-700'
                                    : 'text-gray-700'
                            }`}
                          >
                            {step.title}
                          </p>
                          {step.content && (
                            <p className="mt-0.5 truncate text-[10px] text-gray-500">
                              {step.content.slice(0, 80)}
                              {step.content.length > 80 ? '...' : ''}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Empty State - Insights placeholder */}
          {!selectedImage && !isGenerating && (
            <div className="flex flex-1 flex-col items-center justify-center border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white p-8 text-center">
              {/* 精美的空状态图标 */}
              <div className="relative mb-5">
                <div className="absolute -inset-3 rounded-full bg-gradient-to-r from-purple-100 to-blue-100 opacity-50 blur-lg" />
                <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-gray-100 bg-gradient-to-br from-gray-100 to-white shadow-inner">
                  <svg
                    className="h-8 w-8 text-gray-300"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
              </div>
              <p className="mb-2 text-sm font-semibold text-gray-600">
                Insights Panel
              </p>
              <p className="max-w-[200px] text-xs leading-relaxed text-gray-400">
                Select an image to view details, or generate a new one below
              </p>
              {/* 装饰性虚线 */}
              <div className="mt-6 flex items-center gap-2">
                <div className="h-px w-8 bg-gradient-to-r from-transparent to-gray-200" />
                <div className="h-1.5 w-1.5 rounded-full bg-gray-200" />
                <div className="h-px w-8 bg-gradient-to-l from-transparent to-gray-200" />
              </div>
            </div>
          )}

          {/* Input Area - Using extracted InputArea component */}
          <InputArea
            // Control bar props
            models={models.imageModels}
            selectedModelId={selectedImageModelId}
            onModelChange={setSelectedImageModelId}
            templateLayout={templateLayout}
            onLayoutChange={setTemplateLayout}
            imageStyle={imageStyle}
            onStyleChange={setImageStyle}
            aspectRatio={aspectRatio}
            onAspectRatioChange={setAspectRatio}
            skipEnhancement={skipEnhancement}
            onSkipEnhancementChange={setSkipEnhancement}
            isLoadingModels={isLoadingModels}
            onRefreshModels={fetchModels}
            // Input mode
            inputMode={inputMode}
            onInputModeChange={setInputMode}
            // Prompt mode
            prompt={prompt}
            onPromptChange={setPrompt}
            textareaRef={textareaRef}
            showMentions={showMentions}
            onShowMentionsChange={setShowMentions}
            mentionQuery={mentionQuery}
            onMentionQueryChange={setMentionQuery}
            cursorPosition={cursorPosition}
            onCursorPositionChange={setCursorPosition}
            filteredSources={filteredSources}
            onKeyDown={handleKeyDown}
            // YouTube mode
            youtubeUrl={youtubeUrl}
            onYoutubeUrlChange={setYoutubeUrl}
            youtubePrompt={youtubePrompt}
            onYoutubePromptChange={setYoutubePrompt}
            // URL mode
            urls={urls}
            onUrlChange={handleUrlChange}
            onAddUrl={handleAddUrl}
            onRemoveUrl={handleRemoveUrl}
            urlPrompt={urlPrompt}
            onUrlPromptChange={setUrlPrompt}
            // Files mode
            uploadedFiles={uploadedFiles}
            filesPrompt={filesPrompt}
            onFilesPromptChange={setFilesPrompt}
            isDragging={isDragging}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onFileSelect={handleFileSelect}
            onRemoveFile={handleRemoveFile}
            // Refine mode
            refineImage={refineImage}
            refinePrompt={refinePrompt}
            onRefinePromptChange={setRefinePrompt}
            onCancelRefine={handleCancelRefine}
            // Common
            error={error}
            isGenerating={isGenerating}
            onGenerate={handleGenerate}
            hasValidInput={hasValidInput}
          />
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightboxImage(null)}
        >
          <button
            onClick={() => setLightboxImage(null)}
            className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/20"
          >
            <svg
              className="h-6 w-6"
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
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDownload(lightboxImage);
            }}
            className="absolute right-20 top-4 z-10 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/20"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
          </button>
          <div
            className="flex max-h-[90vh] max-w-[95vw] flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightboxImage.imageUrl}
              alt={lightboxImage.prompt}
              className="max-h-[70vh] max-w-[95vw] rounded-t-lg object-contain shadow-2xl"
              onContextMenu={(e) => handleContextMenu(e, lightboxImage)}
            />
            <div className="w-full max-w-[95vw] rounded-b-lg bg-gray-900/95 px-4 py-3">
              {lightboxImage.enhancedPrompt && (
                <p className="line-clamp-2 text-sm text-gray-300">
                  {lightboxImage.enhancedPrompt}
                </p>
              )}
              <div className="mt-1 flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {lightboxImage.width} x {lightboxImage.height} -{' '}
                  <ClientDate
                    date={lightboxImage.createdAt}
                    format="datetime"
                  />
                </p>
                <p className="text-xs text-gray-600">ESC to close</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-[110] min-w-[160px] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 180),
            top: Math.min(contextMenu.y, window.innerHeight - 320),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleBookmark(contextMenu.image)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
          >
            <svg
              className={`h-3.5 w-3.5 ${bookmarkedImages.has(contextMenu.image.id) ? 'text-amber-500' : 'text-gray-400'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            {bookmarkedImages.has(contextMenu.image.id)
              ? 'Remove from Library'
              : 'Add to Library'}
          </button>
          <button
            onClick={() => handleRefineImage(contextMenu.image)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-purple-600 hover:bg-gray-100"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refine Image
          </button>
          <div className="my-1 border-t border-gray-200" />
          <button
            onClick={() => {
              handleDownload(contextMenu.image);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
          >
            <svg
              className="h-3.5 w-3.5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Download
          </button>
          <button
            onClick={() => handleCopyImage(contextMenu.image)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
          >
            <svg
              className="h-3.5 w-3.5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
              />
            </svg>
            Copy Image
          </button>
          <button
            onClick={() => handleCopyLink(contextMenu.image)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
          >
            <svg
              className="h-3.5 w-3.5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
            Copy Link
          </button>
          <div className="my-1 border-t border-gray-200" />
          <button
            onClick={() => handleOpenInNewTab(contextMenu.image)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
          >
            <svg
              className="h-3.5 w-3.5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
            Open in New Tab
          </button>
          {!lightboxImage && (
            <button
              onClick={() => {
                setLightboxImage(contextMenu.image);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
            >
              <svg
                className="h-3.5 w-3.5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                />
              </svg>
              View Fullscreen
            </button>
          )}
          <div className="my-1 border-t border-gray-200" />
          <button
            onClick={() => handleDelete(contextMenu.image)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
