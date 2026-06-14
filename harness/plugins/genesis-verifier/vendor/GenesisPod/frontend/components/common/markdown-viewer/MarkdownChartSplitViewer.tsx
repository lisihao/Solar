'use client';

/**
 * MarkdownChartSplitViewer - 章节内穿插图表的 Markdown 渲染器
 *
 * 抽自 Topic Insights ChapterizedReportView 的 chart-split 渲染逻辑。
 * 解决「一段 Markdown 文本通过 `<!-- chart:ID -->` 占位符切分成多个段落，
 * 段落之间插入图表组件」这一专用渲染模式。
 *
 * 关键设计：
 * - 内部维护一份 `sharedSlugCounts`（跨段共享的标题锚点 Map）
 *   保证多个 ReactMarkdown 实例的 heading ID 不冲突
 * - 内部维护一份 `mdComponents`（跨段共享的 createMarkdownComponents 实例）
 *   保证 `lastH2Text` 等闭包变量在段落间连续
 * - 调用方只需提供 charts 数组 + 渲染回调，不用关心 split / map 逻辑
 *
 * 适用场景：
 * - TI 章节报告里的 chart placeholder 注入
 * - AI Office 报告里的图表与正文混排
 * - 任何「LLM 输出含图表占位符」的渲染需求
 */

import { Fragment, useMemo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { PluggableList } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import { createMarkdownComponents } from '@/lib/markdown/createMarkdownComponents';
import { preprocessLatex } from '@/lib/markdown/preprocessLatex';
import { stripProseBullets } from '@/lib/markdown/stripProseBullets';
import { KATEX_OPTIONS } from '@/lib/markdown/katexOptions';
import { cn } from '@/lib/utils/common';

/** 占位符匹配模式：`<!-- chart:abcd123 -->` */
const CHART_PLACEHOLDER_PATTERN = /<!--\s*chart:([^\s]+?)\s*-->/g;
const CHART_SPLIT_PATTERN = /<!--\s*chart:([^\s]+?)\s*-->/;

const IDENTITY: (text: string) => ReactNode = (t) => t;

export interface MarkdownChartSplitViewerProps<TChart> {
  /** Markdown 源文本，含 `<!-- chart:ID -->` 占位符 */
  content: string;
  /** 可用图表数组 */
  charts?: TChart[];
  /** 从 chart 提取 ID 的函数（用于匹配占位符） */
  getChartId: (chart: TChart) => string;
  /**
   * 渲染单个图表的回调。占位符匹配到 chart 时调用。
   * key 由组件提供，调用方应原样传给最外层节点。
   */
  renderChart: (chart: TChart, key: string) => ReactNode;
  /** 内联文本处理槽（同 MarkdownViewer.processText） */
  processText?: (text: string) => ReactNode;
  /** preprocessLatex + stripProseBullets，默认 true */
  preprocess?: boolean;
  /** 启用 rehype-raw 处理 inline HTML，默认 true（章节渲染普遍需要） */
  enableRawHtml?: boolean;
  /** 标题（h1-h4）也应用 processText，默认 false */
  processHeadings?: boolean;
  className?: string;
}

export function MarkdownChartSplitViewer<TChart>({
  content,
  charts = [],
  getChartId,
  renderChart,
  processText,
  preprocess = true,
  enableRawHtml = true,
  processHeadings = false,
  className,
}: MarkdownChartSplitViewerProps<TChart>) {
  // ★ 跨段共享的锚点 Map：每次组件调用都重建
  // （每次 mount 视为一次"render 周期"，符合 ReactMarkdown 默认 per-render 重置语义）
  const sharedSlugCounts = useMemo(() => new Map<string, number>(), []);

  // 跨段共享的 mdComponents（同时承载 sharedSlugCounts + lastH2Text 闭包态）
  const mdComponents = useMemo(
    () =>
      createMarkdownComponents(processText ?? IDENTITY, {
        applyTextProcessingToHeadings: processHeadings,
        sharedSlugCounts,
      }),
    [processText, processHeadings, sharedSlugCounts]
  );

  const remarkPlugins = useMemo<PluggableList>(
    () => [remarkGfm, remarkMath],
    []
  );
  const rehypePlugins = useMemo<PluggableList>(() => {
    const plugins: PluggableList = [];
    if (enableRawHtml) plugins.push(rehypeRaw);
    plugins.push([rehypeKatex, KATEX_OPTIONS]);
    return plugins;
  }, [enableRawHtml]);

  // 预处理（与 MarkdownViewer 同口径）
  const processedContent = useMemo(() => {
    if (!preprocess) return content;
    return stripProseBullets(preprocessLatex(content));
  }, [content, preprocess]);

  // 没有 charts 或没有占位符 → 走单实例 fast path
  // 输出 Fragment（无 wrapper div），保留与原 TI 代码一致的 DOM 结构（让 prose CSS 能正确 target 直接子元素）
  // 仅当传 className 时才包 div
  if (charts.length === 0 || !processedContent.includes('<!-- chart:')) {
    const cleanContent = processedContent.replace(
      CHART_PLACEHOLDER_PATTERN,
      ''
    );
    const node = (
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={mdComponents as Components}
      >
        {cleanContent}
      </ReactMarkdown>
    );
    return className ? <div className={cn(className)}>{node}</div> : node;
  }

  // 切分：segments alternates [text, chartId, text, chartId, ...]
  const segments = processedContent.split(CHART_SPLIT_PATTERN);
  const chartMap = new Map(charts.map((c) => [getChartId(c), c]));

  const elements: ReactNode[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (i % 2 === 0) {
      // text segment
      const text = segments[i].trim();
      if (text) {
        elements.push(
          <ReactMarkdown
            key={`md-${i}`}
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            components={mdComponents as Components}
          >
            {text}
          </ReactMarkdown>
        );
      }
    } else {
      // chart id segment
      const chartId = segments[i];
      const chart = chartMap.get(chartId);
      if (chart) {
        elements.push(renderChart(chart, `chart-${chartId}`));
      }
    }
  }

  // 与原 TI 代码相同：包成 Fragment 直接挂在父容器（如 <article className="prose">）下
  // 当调用方需要包装节点时显式传 className
  return className ? (
    <div className={cn(className)}>{elements}</div>
  ) : (
    <Fragment>{elements}</Fragment>
  );
}
