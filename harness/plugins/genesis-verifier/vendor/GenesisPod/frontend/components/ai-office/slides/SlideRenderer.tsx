'use client';

/**
 * SlideRenderer - 幻灯片主渲染器
 *
 * 功能：
 * - 根据模板类型渲染对应组件
 * - 支持 15 种专业模板
 * - 支持编辑模式
 */

import React from 'react';
import type {
  SlideTemplateTypeString,
  SlideTemplateContent,
} from '@/lib/types/slides';

// 导入模板组件 - 15种完整模板
import CoverSlide from './templates/CoverSlide';
import TocSlide from './templates/TocSlide';
import ChapterTitleSlide from './templates/ChapterTitleSlide';
import ChapterSummarySlide from './templates/ChapterSummarySlide';
import ConclusionSlide from './templates/ConclusionSlide';
import TimelineSlide from './templates/TimelineSlide';
import MultiColumnSlide from './templates/MultiColumnSlide';
import DashboardSlide from './templates/DashboardSlide';
import ComparisonSlide from './templates/ComparisonSlide';
import RecommendationsSlide from './templates/RecommendationsSlide';
// 新增5种模板
import SplitLayoutSlide from './templates/SplitLayoutSlide';
import EvolutionRoadmapSlide from './templates/EvolutionRoadmapSlide';
import CaseStudySlide from './templates/CaseStudySlide';
import MaturityModelSlide from './templates/MaturityModelSlide';
import RiskOpportunitySlide from './templates/RiskOpportunitySlide';

import './styles/slide-tokens.css';

// ============================================
// 类型定义
// ============================================

export interface SlideRendererProps {
  /** 模板类型 */
  templateType: SlideTemplateTypeString;
  /** 模板内容 */
  content: SlideTemplateContent;
  /** 是否可编辑 */
  editable?: boolean;
  /** 编辑回调 */
  onEdit?: (content: SlideTemplateContent) => void;
  /** 自定义类名 */
  className?: string;
}

// ============================================
// 主渲染器组件
// ============================================

export function SlideRenderer({
  templateType,
  content,
  editable = false,
  onEdit,
  className = '',
}: SlideRendererProps) {
  // 根据模板类型渲染对应组件
  const renderTemplate = () => {
    switch (templateType) {
      // 结构性模板
      case 'cover':
        if (content.templateType === 'cover') {
          return <CoverSlide content={content} />;
        }
        break;

      case 'toc':
        if (content.templateType === 'toc') {
          return <TocSlide content={content} />;
        }
        break;

      case 'chapterTitle':
        if (content.templateType === 'chapterTitle') {
          return <ChapterTitleSlide content={content} />;
        }
        break;

      case 'chapterSummary':
        if (content.templateType === 'chapterSummary') {
          return <ChapterSummarySlide content={content} />;
        }
        break;

      case 'conclusion':
        if (content.templateType === 'conclusion') {
          return <ConclusionSlide content={content} />;
        }
        break;

      // 内容型模板
      case 'timeline':
        if (content.templateType === 'timeline') {
          return <TimelineSlide content={content} />;
        }
        break;

      case 'multiColumn':
        if (content.templateType === 'multiColumn') {
          return <MultiColumnSlide content={content} />;
        }
        break;

      case 'dashboard':
        if (content.templateType === 'dashboard') {
          return <DashboardSlide content={content} />;
        }
        break;

      case 'comparison':
        if (content.templateType === 'comparison') {
          return <ComparisonSlide content={content} />;
        }
        break;

      case 'recommendations':
        if (content.templateType === 'recommendations') {
          return <RecommendationsSlide content={content} />;
        }
        break;

      // 新增5种模板
      case 'splitLayout':
        if (content.templateType === 'splitLayout') {
          return <SplitLayoutSlide content={content} />;
        }
        break;

      case 'evolutionRoadmap':
        if (content.templateType === 'evolutionRoadmap') {
          return <EvolutionRoadmapSlide content={content} />;
        }
        break;

      case 'caseStudy':
        if (content.templateType === 'caseStudy') {
          return <CaseStudySlide content={content} />;
        }
        break;

      case 'maturityModel':
        if (content.templateType === 'maturityModel') {
          return <MaturityModelSlide content={content} />;
        }
        break;

      case 'riskOpportunity':
        if (content.templateType === 'riskOpportunity') {
          return <RiskOpportunitySlide content={content} />;
        }
        break;

      default:
        return (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background:
                'linear-gradient(135deg, var(--slide-bg-primary) 0%, var(--slide-bg-secondary) 100%)',
              color: 'var(--slide-text-tertiary)',
              fontSize: 'var(--slide-font-h2)',
            }}
          >
            未知模板类型: {templateType}
          </div>
        );
    }

    // 类型不匹配时的回退
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'linear-gradient(135deg, var(--slide-bg-primary) 0%, var(--slide-bg-secondary) 100%)',
          color: 'var(--slide-text-tertiary)',
          fontSize: 'var(--slide-font-h2)',
        }}
      >
        内容类型不匹配
      </div>
    );
  };

  return (
    <div
      className={`slide-renderer ${editable ? 'editable' : ''} ${className}`}
      style={{
        width: '100%',
        aspectRatio: '16/9',
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 'var(--slide-radius-lg)',
        boxShadow: 'var(--slide-shadow-xl)',
      }}
    >
      {/* 渲染模板内容 */}
      {renderTemplate()}

      {/* 可编辑模式覆盖层 */}
      {editable && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            padding: 'var(--slide-space-md)',
            zIndex: 100,
          }}
        >
          <button
            onClick={() => onEdit?.(content)}
            style={{
              padding: '8px 16px',
              background: 'var(--slide-accent-blue)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--slide-radius-md)',
              fontSize: 'var(--slide-font-caption)',
              fontWeight: 'var(--slide-font-weight-semibold)',
              cursor: 'pointer',
              transition: 'all var(--slide-transition-fast)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background =
                'var(--slide-accent-primary-light)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--slide-accent-blue)';
            }}
          >
            编辑
          </button>
        </div>
      )}
    </div>
  );
}

export default SlideRenderer;
