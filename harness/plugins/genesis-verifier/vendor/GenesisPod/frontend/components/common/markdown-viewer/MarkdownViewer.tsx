'use client';

/**
 * MarkdownViewer - 通用 Markdown 渲染组件
 *
 * 抽自 Topic Insights 的报告渲染管线，沉淀为跨模块平台能力。
 * 一站式整合：
 * - ReactMarkdown + remark-gfm（GFM 表格 / 列表 / 删除线）
 * - remark-math + rehype-katex（LaTeX 公式，错误不抛、不静默 hydration）
 * - createMarkdownComponents 工厂（标题锚点、链接安全、Mermaid 图、风险矩阵染色）
 * - preprocessLatex / stripProseBullets 预处理（清理 LLM 脏输出）
 * - 可选 processText 槽（注入引用 / 注解高亮等内联变换）
 *
 * 适用场景：
 * - AI Writing 长文档渲染
 * - AI Research 报告渲染
 * - Agent Playground mission 报告
 * - 任何需要展示 LLM 生成 Markdown 的位置
 *
 * 不在平台层做的：
 * - 引用徽章具体业务（CitationBadge 仍在 components/common/citations）
 * - 注解高亮业务（components/common/annotations 提供，由调用方传入 processText）
 * - 编辑（TipTap 等编辑器层是 ReportEditor 的职责，不在 viewer 范围）
 */

import { useMemo, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';
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

export interface MarkdownViewerProps {
  /** Markdown 源文本 */
  content: string;
  /**
   * @deprecated 用 enableLatexPreprocess + enableBulletStrip 单独控制。
   * 旧聚合开关：true = 同时 enable 两项；false = 都 disable。
   * 新代码请使用细分 flag。
   */
  preprocess?: boolean;
  /**
   * 是否运行 LaTeX 预处理（preprocessLatex）。默认 true。
   * 处理 LLM 输出的 LaTeX 边界（双美元 / 单美元 / 反斜杠转义等）。
   */
  enableLatexPreprocess?: boolean;
  /**
   * 是否运行 bullet 清理（stripProseBullets）。默认 true。
   * 把行首误用为列表的「• / · / *」prose 段去掉，避免双重列表。
   * 仅当原内容确实需要保留行首符号时关闭。
   */
  enableBulletStrip?: boolean;
  /**
   * 内联文本处理槽。每段文本 / 列表项会经过这个函数。
   * 用于注入引用徽章 `[1][2]`、注解高亮、关键词链接等。
   * 不传则原样输出。
   */
  processText?: (text: string) => ReactNode;
  /** 容器自定义 className */
  className?: string;
  /** 是否启用 GFM 表格/列表/删除线，默认 true */
  enableGfm?: boolean;
  /** 是否启用 LaTeX 数学公式，默认 true */
  enableMath?: boolean;
  /**
   * 是否启用 rehype-raw 允许内联 HTML（默认 false）。
   * 报告含 `<sup>` / `<details>` 等手写 HTML 时需要开启。
   * 注意：开启 = 信任内容来源；用户输入禁用。
   */
  enableRawHtml?: boolean;
  /**
   * 是否对 h1-h4 标题也应用 processText（默认 false）。
   * 默认标题里的 string 会过 processText，但 array（嵌套元素）不递归。
   * 设为 true 时，标题里的「`## Hello [1]`」也会渲染成 CitationBadge。
   */
  processHeadings?: boolean;
  /**
   * 是否对 blockquote 也应用完整 processChildren（递归 array），默认 false。
   * 与 processHeadings 同口径，启用后块级引用文本也会处理 inline 元素。
   */
  processBlockquote?: boolean;
  /**
   * 是否在 strong / em 等 inline 元素里调用 processText，默认 true。
   * 设为 false 可严格匹配「只在 p/li/td/th/h1-h4/blockquote 处理 citations」
   * 的旧 ReactMarkdown 用法（避免在 *emphasis* / **bold** 里误生成 badge）。
   */
  processInlineElements?: boolean;
  /**
   * 跨实例共享的标题锚点计数 Map。
   * 默认每个 MarkdownViewer 实例自建，仅当多实例需要共享去重时传入。
   * 一般用 MarkdownChartSplitViewer 而不是手动管理。
   */
  sharedSlugCounts?: Map<string, number>;
  /** Optional component overrides merged on top of platform defaults. */
  components?: Partial<Components>;
  /** Optional URL transformer passed to ReactMarkdown. */
  urlTransform?: Options['urlTransform'];
  /**
   * Optional rehype plugins appended after the platform defaults.
   * Use this for call-site specific sanitation or post-processing.
   */
  rehypePluginsExtra?: PluggableList;
}

const IDENTITY: (text: string) => ReactNode = (t) => t;

export function MarkdownViewer({
  content,
  preprocess = true,
  processText,
  className,
  enableGfm = true,
  enableMath = true,
  enableRawHtml = false,
  enableLatexPreprocess,
  enableBulletStrip,
  processHeadings = false,
  processBlockquote = false,
  processInlineElements = true,
  sharedSlugCounts,
  components: componentOverrides,
  urlTransform,
  rehypePluginsExtra,
}: MarkdownViewerProps) {
  // 兼容 deprecated `preprocess`：未显式传细分 flag 时按旧聚合规则
  const doLatex = enableLatexPreprocess ?? preprocess ?? true;
  const doBullets = enableBulletStrip ?? preprocess ?? true;

  const finalText = useMemo(() => {
    let processed = content;
    if (doLatex && enableMath) processed = preprocessLatex(processed);
    if (doBullets) processed = stripProseBullets(processed);
    return processed;
  }, [content, doLatex, doBullets, enableMath]);

  // 每次 processText / opts 变化重建 components 工厂
  // (slugCounts / lastH2Text 是闭包态，sharedSlugCounts 由调用方注入支持跨实例去重)
  const components = useMemo(
    () =>
      ({
        ...createMarkdownComponents(processText ?? IDENTITY, {
          applyTextProcessingToHeadings: processHeadings,
          applyTextProcessingToBlockquote: processBlockquote,
          applyTextProcessingToInlineElements: processInlineElements,
          sharedSlugCounts,
        }),
        ...(componentOverrides ?? {}),
      }) as Components,
    [
      processText,
      processHeadings,
      processBlockquote,
      processInlineElements,
      sharedSlugCounts,
      componentOverrides,
    ]
  );

  const remarkPlugins = useMemo<PluggableList>(
    () => [
      ...(enableGfm ? [remarkGfm] : []),
      ...(enableMath ? [remarkMath] : []),
    ],
    [enableGfm, enableMath]
  );

  const rehypePlugins = useMemo<PluggableList>(() => {
    // 顺序关键：rehype-raw 必须在 rehype-katex 之前，否则 raw HTML 会吞掉数学块
    const plugins: PluggableList = [];
    if (enableRawHtml) plugins.push(rehypeRaw);
    if (enableMath) plugins.push([rehypeKatex, KATEX_OPTIONS]);
    if (rehypePluginsExtra?.length) plugins.push(...rehypePluginsExtra);
    return plugins;
  }, [enableMath, enableRawHtml, rehypePluginsExtra]);

  return (
    <div className={cn('markdown-viewer', className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
        urlTransform={urlTransform}
      >
        {finalText}
      </ReactMarkdown>
    </div>
  );
}
