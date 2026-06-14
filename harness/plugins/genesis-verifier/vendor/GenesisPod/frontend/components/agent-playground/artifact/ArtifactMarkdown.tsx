'use client';

import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize from 'rehype-sanitize';
import type {
  ArtifactCitation,
  ArtifactFigure,
} from '@/lib/features/agent-playground/report-artifact.types';
import { CitationBadge } from '@/components/common/citations/CitationBadge';
import { FigureRenderer as PublicFigureRenderer } from '@/components/common/chart-viewer/FigureRenderer';
import type { RenderableChart } from '@/components/common/chart-viewer/types';
import {
  createMarkdownComponents,
  preprocessLatex,
  stripProseBullets,
  KATEX_OPTIONS,
} from '@/components/common/markdown-viewer';
// ★ PR-A6 (2026-05-07): rehype-sanitize + KaTeX-aware schema
//   防御 LLM 产出的 markdown 含 <script> / onerror / onclick 等 XSS 向量；
//   KaTeX 渲染所需的 <math>/<semantics>/<mrow>... 元素由 katexAwareSchema 显式放行。
import { katexAwareSchema } from './artifact-markdown.utils';

interface Props {
  markdown: string;
  citations: readonly ArtifactCitation[];
  figures: readonly ArtifactFigure[];
  /**
   * ★ 2026-05-07：真维度名列表（从 plan.dimensions[].name 或
   * sections.filter(type='dimension').map(s.title) 来）。renumberHeadings 用
   * 严格 prefix match 辨认哪些 H2 是维度（加 N. 编号），哪些 H2 是被老 reportAssembler
   * 错写成 H2 的章节（降为 H3 + N.M. 编号）。
   * 缺省时所有非 supplementary H2 都按维度处理（适合新格式纯净 markdown）。
   */
  dimNames?: readonly string[];
  /**
   * ★ 2026-05-07 集体评审 P0：单章 slice 阅读（ChapterReader）时，slice 只含 1 个
   * H2，但用户上下文是"第 N 章"。传入 dimStartIndex 让 renumberHeadings 从该编号
   * 起算（默认 1），避免在第 7 章看到"## 1. xxx"。
   * ContinuousReader 全文渲染保持默认 1。
   */
  dimStartIndex?: number;
}

/**
 * ★ 2026-04-30 (#64 图片仍闪烁): 把"#fig-id 占位 → FigureRenderer"包成 React.memo
 * 组件，外部父级 re-render（如 LeadJournal poll、events 流入引发的 view 重算）
 * 不会再让 figure 内部 next/Image 走 unmount → loading=true 的初始态，避免视觉闪烁。
 */
const StableFigureBlock = React.memo(
  function StableFigureBlock({
    figure,
    citation,
  }: {
    figure: ArtifactFigure;
    citation: ArtifactCitation | null;
  }) {
    return (
      <div className="my-4">
        <PublicFigureRenderer
          chart={toRenderableChart(figure)}
          showSource
          allowZoom
          evidenceInfo={citation ? toEvidence(citation) : null}
        />
      </div>
    );
  },
  (prev, next) =>
    prev.figure.id === next.figure.id &&
    prev.figure.imageUrl === next.figure.imageUrl &&
    prev.figure.title === next.figure.title &&
    prev.figure.caption === next.figure.caption &&
    (prev.citation?.uuid ?? null) === (next.citation?.uuid ?? null)
);

/**
 * ★ 2026-05-07 编号清洗 + 重写（学 TI numberSubHeadings 模式，但纯前端实现）：
 * 历史 mission 的 fullMarkdown 里可能含老 numberSubHeadings bug 写入的过大编号
 * （如 "## 36. xxx" / "### 37. 1. xxx"），是后端老代码 dimIndex 累加错误导致的
 * 字面值（既有 mission 不重跑无法救）。
 *
 * 这里在 ReactMarkdown 渲染前做一次预处理：剥光所有 H2/H3 旧编号前缀，按
 * 当前文档中 H2 出现顺序重新加 "N. "（H2 维度，supplementary 跳过）+ "N.M. "
 * （H3 章节，N 跟随父维度，M 在每维度内递增）。
 *
 * 对**新 mission** 也无害：新报告原本就不带前缀，剥光等于不动；前端再加正确的
 * "1. xxx" / "1.1. xxx"。
 *
 * 对**既有 mission** 有效：错的 "36." / "37. 1." 被剥掉再重新编号成 "1." / "1.1."。
 */
const SUPPLEMENTARY_H2_LIST = [
  '执行摘要',
  '前言',
  '目录',
  '跨维度分析',
  '风险评估',
  '战略建议',
  '结论',
  '参考文献',
  '参考资料',
  'executive summary',
  'preface',
  'table of contents',
  'cross-dimension analysis',
  'risk assessment',
  'strategic recommendations',
  'conclusion',
  'references',
];
function isSupplementaryHeading(text: string): boolean {
  const t = text.trim().toLowerCase();
  for (const s of SUPPLEMENTARY_H2_LIST) {
    if (t === s.toLowerCase()) return true;
    if (t.startsWith(s.toLowerCase())) return true;
  }
  return false;
}

/** 剥前缀编号（如 "36. " / "37. 1. " / "1.2.3. "）；保留实际标题文本 */
function stripHeadingNumberPrefix(title: string): string {
  // 匹配 N / N.M / N.M.K 前缀（中间允许空格、点、全角点）
  return title.replace(/^\d+(\s*[\.。]\s*\d+)*\s*[\.。]\s*/, '').trim();
}

/**
 * H2 是否匹配某真维度名（严格 prefix）。dimNames 缺省时，所有非 supplementary H2
 * 都按维度处理。
 *
 * ★ 2026-05-07 集体评审 P0 收紧：旧版用"前 8 字 substring 双向 includes"，会把
 * 共享前缀的章节（如"中国训练数据合规"vs 维度"中国训练成本演进"前 4 字"中国训练"）
 * 误升为维度。改为"必须是 dimName 的精确 prefix（cleaned 以 dimName 开头）或
 * 反之（dimName 以 cleaned 开头且 cleaned 至少 6 字符）"，杜绝 substring 误判。
 */
function matchDimName(
  cleaned: string,
  dimNames: readonly string[] | undefined
): boolean {
  if (!dimNames || dimNames.length === 0) return true; // 无信息时按维度处理
  const t = cleaned.toLowerCase().trim();
  if (!t) return false;
  for (const d of dimNames) {
    const n = d.toLowerCase().trim();
    if (!n) continue;
    if (t === n) return true;
    // cleaned 以 dimName 开头（dimName 是 cleaned 的前缀）→ 维度
    if (t.startsWith(n)) return true;
    // dimName 以 cleaned 开头且 cleaned 足够长（避免 H2 被截短的边缘 case）
    if (n.startsWith(t) && t.length >= 6) return true;
  }
  return false;
}

/**
 * 检测是否为 JSON 字面片段被 chapter-writer 老 bug 误写成 H3（如
 * `### "label": "经济型模型"`）。守卫住这类残片，避免渲染成章节标题。
 * ★ 2026-05-07 集体评审 P0 守卫。
 */
function looksLikeJsonFragment(cleaned: string): boolean {
  const t = cleaned.trim();
  if (!t) return false;
  // 以 " { } [ ] 起始，或匹配 `"key": "value"` / `"key":` 模式
  return (
    /^["'{}\[\]]/.test(t) ||
    /^[a-zA-Z_][\w\-]*\s*:\s*["'\d{[]/.test(t) ||
    /^"[^"]+"\s*:/.test(t)
  );
}

/**
 * 重写 H2/H3/H4 编号 + 修复老格式三层结构压扁问题。
 *
 * 编号策略（学 TI buildFullReportFromDimensions:351 + 用户偏好）：
 *   - H2 维度：加 "N. " 前缀
 *   - H3 章节：加 "N.M. " 前缀
 *   - H4 子小节：**不加序号**（保留裸标题，避免数字噪声）
 *
 * 老格式特征（用户实证 mission ddc90bfd）：
 *   ## 核心架构与设计哲学              (维度 H2)
 *   ### 核心架构与设计哲学              (重复占位 — 删)
 *   ## 1. LangGraph的有状态图架构...    (章节误用 H2 — 降为 H3 章节)
 *   ### 有状态图架构赋予...             (子小节 — 降为 H4)
 *   ### 状态持久化机制...               (子小节 — 降为 H4)
 *   ## 2. LangGraph的循环与分支...      (章节误用 H2 — 降为 H3 章节)
 *
 * 重写后（恢复"维度→章节→子小节"包含关系）：
 *   ## 1. 核心架构与设计哲学            (维度)
 *   ### 1.1. LangGraph的有状态图架构    (章节)
 *   #### 有状态图架构赋予...            (子小节，无编号)
 *   #### 状态持久化机制...              (子小节，无编号)
 *   ### 1.2. LangGraph的循环与分支...   (章节)
 *   #### 循环机制赋能...                (子小节，无编号)
 */
function renumberHeadings(
  markdown: string,
  dimNames?: readonly string[],
  dimStartIndex: number = 1
): string {
  let dim = Math.max(0, dimStartIndex - 1);
  let chap = 0;
  const lines = markdown.split('\n');
  let inFence = false;
  let underDim = false;
  let lastDimNameLower: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(```|~~~)/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const h2 = line.match(/^(##\s+)(.+)$/);
    if (h2) {
      const cleaned = stripHeadingNumberPrefix(h2[2]);
      if (isSupplementaryHeading(cleaned)) {
        lines[i] = `${h2[1]}${cleaned}`;
        underDim = false;
        lastDimNameLower = null;
        continue;
      }
      if (matchDimName(cleaned, dimNames)) {
        // 真维度
        dim++;
        chap = 0;
        underDim = true;
        lastDimNameLower = cleaned.toLowerCase().trim();
        lines[i] = `${h2[1]}${dim}. ${cleaned}`;
      } else if (underDim && dim > 0) {
        // 老格式：章节误用 H2 → 降为 H3 章节
        chap++;
        lines[i] = `### ${dim}.${chap}. ${cleaned}`;
      } else {
        lines[i] = `${h2[1]}${cleaned}`;
      }
      continue;
    }
    const h3 = line.match(/^(###\s+)(.+)$/);
    if (h3) {
      const cleaned = stripHeadingNumberPrefix(h3[2]);
      // ★ 2026-05-07 集体评审 P0 守卫：legacy chapter-writer 老 bug 把 JSON 字面
      //   片段写成 `### "label": "经济型模型"`，这类残片不能视作章节，否则
      //   chap 计数会被污染、目录会出现 4 行 JSON 标题。整行降级为普通段落
      //   保留原文，让 markdown 自由渲染（用户至少不再看到伪标题）。
      if (looksLikeJsonFragment(cleaned)) {
        lines[i] = cleaned;
        continue;
      }
      if (underDim && dim > 0) {
        // 跳过"### {dim name}"重复占位（与父维度同名）
        if (
          lastDimNameLower &&
          cleaned.toLowerCase().trim() === lastDimNameLower
        ) {
          lines[i] = '';
          continue;
        }
        if (chap > 0) {
          // 子小节：降为 H4，**不加编号**（保留裸标题，避免噪声）
          lines[i] = `#### ${cleaned}`;
        } else {
          // 维度下还未遇章节就出现 H3（少见）→ 升为章节，加 N.M. 编号
          chap++;
          lines[i] = `${h3[1]}${dim}.${chap}. ${cleaned}`;
        }
      } else {
        lines[i] = `${h3[1]}${cleaned}`;
      }
      continue;
    }
    const h4 = line.match(/^(####\s+)(.+)$/);
    if (h4) {
      // H4 子小节统一不加编号，仅剥旧前缀（裸标题）
      const cleaned = stripHeadingNumberPrefix(h4[2]);
      lines[i] = `${h4[1]}${cleaned}`;
      continue;
    }
  }
  return lines.join('\n');
}

/**
 * 把 ArtifactCitation 适配为公共 CitationBadge 的 evidence shape
 */
function toEvidence(c: ArtifactCitation) {
  return {
    id: c.uuid || `cite-${c.index}`,
    title: c.title ?? null,
    url: c.url ?? null,
    snippet: c.snippet ?? null,
    domain: c.domain ?? null,
    sourceType: c.sourceType ?? null,
    credibilityScore: c.credibilityScore ?? null,
    publishedAt: c.publishedAt ?? null,
    accessedAt: c.accessedAt ?? null,
  };
}

/**
 * 把 ArtifactFigure 适配为公共 FigureRenderer 的 RenderableChart
 */
function toRenderableChart(f: ArtifactFigure): RenderableChart {
  return {
    id: f.id,
    chartType:
      f.type === 'extracted_chart' || f.type === 'reference'
        ? 'reference'
        : 'generated',
    type: f.chartType,
    title: f.title,
    description: f.caption,
    imageUrl: f.imageUrl,
    evidenceCitationIndex: f.evidenceCitationIndex,
    sectionId: f.sectionId,
    position: f.position,
    data: undefined,
  };
}

/**
 * Markdown 渲染器（基于公共能力，agent-playground 层只做适配）：
 *   - createMarkdownComponents：KaTeX / Mermaid / 标题锚点 / hash 链接平滑跳转
 *   - CitationBadge：[N] 角标 hover 卡 + 跨面板跳 references
 *   - PublicFigureRenderer：![alt](#fig-id) 图占位符 → 图片/Recharts 通用渲染
 */
function ArtifactMarkdownInner({
  markdown,
  citations,
  figures,
  dimNames,
  dimStartIndex,
}: Props) {
  // ★ 2026-04-30 (#64): 全部稳定化 —— 父级 re-render（events 流入 / setNow 500ms tick）
  //   不再触发 ReactMarkdown 整树重建，<img>/figure 不再 unmount-remount。

  // 1. processText：拆分 [N] → 公共 CitationBadge（依赖 citations，引用稳定即稳定）
  const processText = useMemo(() => {
    return (text: string): React.ReactNode => {
      const parts: React.ReactNode[] = [];
      const re = /\[(\d+)\]/g;
      let lastIdx = 0;
      let m: RegExpExecArray | null;
      let key = 0;
      while ((m = re.exec(text)) !== null) {
        if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
        const num = parseInt(m[1], 10);
        const cite = citations.find((c) => c.index === num);
        if (cite) {
          parts.push(
            <CitationBadge
              key={`cite-${key++}-${num}`}
              index={num}
              evidence={toEvidence(cite)}
            />
          );
        } else {
          parts.push(
            <sup
              key={`cite-missing-${key++}-${num}`}
              className="mx-0.5 inline-block cursor-not-allowed rounded px-0.5 align-super text-[10px] text-gray-400"
              title="引用元数据缺失"
            >
              [{num}]
            </sup>
          );
        }
        lastIdx = re.lastIndex;
      }
      if (lastIdx < text.length) parts.push(text.slice(lastIdx));
      return parts.length > 0 ? parts : text;
    };
  }, [citations]);

  // 2. 公共 components（含 KaTeX / Mermaid / 标题锚点 / hash 链接 / 图片）
  const baseComponents = useMemo(
    () =>
      createMarkdownComponents(processText, {
        applyTextProcessingToHeadings: true,
        applyTextProcessingToBlockquote: true,
      }),
    [processText]
  );

  // 3. 覆盖 img：拦截 #fig-* 占位符 → StableFigureBlock（memo 化避免闪烁）
  //    H2/H3 编号由 cleaned 预处理阶段统一重写（见下方 cleaned useMemo），
  //    脱离 React closure 状态，对既有报告与新报告同样有效。
  const components = useMemo(() => {
    return {
      ...baseComponents,
      img: ({ src, alt }: { src?: string; alt?: string }) => {
        if (src?.startsWith('#fig-')) {
          const figId = src.slice(1);
          const figure = figures.find((f) => f.id === figId);
          if (figure) {
            const cite =
              citations.find((c) => c.index === figure.evidenceCitationIndex) ??
              null;
            return (
              <StableFigureBlock
                key={figure.id}
                figure={figure}
                citation={cite}
              />
            );
          }
          return (
            <span className="my-2 block rounded border border-dashed border-amber-300 bg-amber-50 p-2 text-xs text-amber-700">
              [图占位 {figId} 未找到]
            </span>
          );
        }
        // 普通图片：交给公共 MarkdownImage
        return baseComponents.img({ src, alt });
      },
    };
  }, [baseComponents, figures, citations]);

  // 与 TI 报告管线对齐：preprocessLatex + stripProseBullets + KaTeX +
  // ★ 2026-05-07 renumberHeadings：剥旧编号 + 按 H2 顺序重写 N. / N.M.
  // 对既有 mission（错的 "36." / "37. 1."）和新 mission（裸标题）同样有效
  const cleaned = useMemo(
    () =>
      renumberHeadings(
        stripProseBullets(preprocessLatex(markdown)),
        dimNames,
        dimStartIndex
      ),
    [markdown, dimNames, dimStartIndex]
  );

  // ★ TI 对齐：与 ChapterizedReportView preview / ReportEditor preview 完全相同的 prose 类
  //   不引入新的颜色 / 字号 / 间距，确保两条产品线视觉同款。
  return (
    <article className="prose prose-gray prose-strong:text-blue-600 dark:prose-strong:text-blue-400 prose-headings:font-semibold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-h4:text-base prose-h5:text-sm prose-h6:text-sm prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-code:text-purple-600 prose-code:bg-purple-50 prose-code:px-1 prose-code:rounded max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        // ★ PR-A6 R2 共识 P0 (2026-05-07): rehypeSanitize 必须放在 rehypeKatex
        //   之后（rehype-sanitize 官方 README："put it last in the list"）。
        //   pipeline 是串行变换：先跑 rehypeKatex 把 $...$ 渲染成 MathML/SVG
        //   节点，再由 rehypeSanitize 按 katexAwareSchema 白名单过滤
        //   KaTeX 输出 + 原始 markdown，让两者都受 sanitize 保护。
        //   反过来（sanitize 在前）会让 KaTeX 后续输出的 SVG path / svg 节点
        //   完全绕过 sanitize（一旦 KaTeX 有 CVE 漏洞 → 直接 XSS 落地）。
        rehypePlugins={[
          [rehypeKatex, KATEX_OPTIONS],
          [rehypeSanitize, katexAwareSchema],
        ]}
        components={components as never}
      >
        {cleaned}
      </ReactMarkdown>
    </article>
  );
}

/**
 * ★ 2026-04-30 (#64): 用 React.memo 包一层。父级（page.tsx setNow 500ms）re-render
 * 时，只要 markdown / citations / figures 引用没变（已被 useMemo 稳定），
 * ArtifactMarkdown 内部不再重跑 ReactMarkdown 解析，<img> DOM 完全稳定不闪烁。
 */
export const ArtifactMarkdown = React.memo(
  ArtifactMarkdownInner,
  (prev, next) =>
    prev.markdown === next.markdown &&
    prev.citations === next.citations &&
    prev.figures === next.figures &&
    prev.dimNames === next.dimNames &&
    prev.dimStartIndex === next.dimStartIndex
);
