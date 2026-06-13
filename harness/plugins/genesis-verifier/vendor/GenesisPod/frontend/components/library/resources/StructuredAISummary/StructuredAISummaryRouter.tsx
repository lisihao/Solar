'use client';

import React from 'react';
import type {
  ResourceAISummary,
  PaperAISummary,
  NewsAISummary,
  VideoAISummary,
  ProjectAISummary,
  ReportAISummary,
  StructuredAISummary,
} from '@/lib/types/ai-office';
import { StructuredAISummaryBase } from './StructuredAISummaryBase';
import { PaperAISummaryComponent } from './PaperAISummary';
import { NewsAISummaryComponent } from './NewsAISummary';
import { VideoAISummaryComponent } from './VideoAISummary';
import { ProjectAISummaryComponent } from './ProjectAISummary';
import { ReportAISummaryComponent } from './ReportAISummary';

/**
 * 结构化AI摘要路由组件
 * 根据AI摘要的具体类型自动选择合适的展示组件
 *
 * 使用示例：
 * ```tsx
 * <StructuredAISummaryRouter
 *   summary={aiSummary}
 *   compact={true}
 *   onTimestampClick={(time) => videoPlayer.seekTo(time)}
 * />
 * ```
 */
export interface StructuredAISummaryProps {
  // 结构化AI摘要数据（可以是任何资源类型的摘要）
  summary: ResourceAISummary;

  // UI模式
  compact?: boolean; // 紧凑模式（用于列表和卡片）
  expandable?: boolean; // 可展开式UI

  // 事件回调
  onTimestampClick?: (timestamp: number) => void; // 视频时间戳点击事件
  onResourceClick?: (resourceId: string) => void; // 相关资源点击事件
}

/**
 * 判断是否为特定类型的AI摘要
 */
const isPaperSummary = (
  summary: ResourceAISummary
): summary is PaperAISummary => {
  return 'contributions' in summary;
};

const isNewsSummary = (
  summary: ResourceAISummary
): summary is NewsAISummary => {
  return 'headline' in summary && 'newsFactor' in summary;
};

const isVideoSummary = (
  summary: ResourceAISummary
): summary is VideoAISummary => {
  return 'chapters' in summary && 'speakers' in summary;
};

const isProjectSummary = (
  summary: ResourceAISummary
): summary is ProjectAISummary => {
  return 'projectName' in summary && 'techStack' in summary;
};

const isReportSummary = (
  summary: ResourceAISummary
): summary is ReportAISummary => {
  return (
    'reportTitle' in summary &&
    'publisherName' in summary &&
    'keyFindings' in summary
  );
};

/**
 * 主路由组件
 */
export const StructuredAISummaryRouter: React.FC<StructuredAISummaryProps> = ({
  summary,
  compact = false,
  expandable = true,
  onTimestampClick,
  onResourceClick,
}) => {
  // 论文摘要
  if (isPaperSummary(summary)) {
    return (
      <PaperAISummaryComponent
        summary={summary}
        compact={compact}
        expandable={expandable}
      />
    );
  }

  // 新闻摘要
  if (isNewsSummary(summary)) {
    return (
      <NewsAISummaryComponent
        summary={summary}
        compact={compact}
        expandable={expandable}
      />
    );
  }

  // 视频摘要
  if (isVideoSummary(summary)) {
    return (
      <VideoAISummaryComponent
        summary={summary}
        compact={compact}
        expandable={expandable}
        onTimestampClick={onTimestampClick}
      />
    );
  }

  // 项目摘要
  if (isProjectSummary(summary)) {
    return (
      <ProjectAISummaryComponent
        summary={summary}
        compact={compact}
        expandable={expandable}
      />
    );
  }

  // 报告摘要
  if (isReportSummary(summary)) {
    return (
      <ReportAISummaryComponent
        summary={summary}
        compact={compact}
        expandable={expandable}
      />
    );
  }

  // 通用摘要（默认）
  return (
    <StructuredAISummaryBase
      summary={summary}
      compact={compact}
      expandable={expandable}
    />
  );
};

/**
 * 导出工具函数：检查摘要是否是结构化格式
 */
export function isStructuredAISummary(
  summary: unknown
): summary is ResourceAISummary {
  return (
    summary !== null &&
    summary !== undefined &&
    typeof summary === 'object' &&
    'overview' in summary &&
    'category' in summary &&
    'keyPoints' in summary &&
    'confidence' in summary &&
    'generatedAt' in summary
  );
}

/**
 * 导出工具函数：转换常规AI摘要为结构化AI摘要
 * 当AI服务还没有返回结构化格式时使用此函数作为降级方案
 */
export function convertToStructuredSummary(
  plainSummary: string,
  category: string = 'General',
  difficulty:
    | 'beginner'
    | 'intermediate'
    | 'advanced'
    | 'expert' = 'intermediate'
): StructuredAISummary {
  // 估算阅读时间（中文约100字/分钟，英文约200字/分钟）
  const estimatedReadTime = Math.max(1, Math.ceil(plainSummary.length / 150));

  return {
    overview: plainSummary,
    category,
    subcategories: [],
    keyPoints: [
      plainSummary.substring(0, 100),
      plainSummary.substring(100, 200),
      plainSummary.substring(200, 300),
    ].filter((p) => p.length > 0),
    keywords: [],
    difficulty,
    readingTime: estimatedReadTime,
    confidence: 0.7, // 转换后的摘要置信度较低
    generatedAt: new Date(),
    model: 'converted',
  };
}
