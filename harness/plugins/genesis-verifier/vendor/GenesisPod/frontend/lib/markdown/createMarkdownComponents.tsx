import React from 'react';
import dynamic from 'next/dynamic';
import { Table, Th, Td } from '@/components/ui/table';

const MermaidDiagram = dynamic(
  () => import('@/components/ui/viewers/MermaidDiagram'),
  {
    ssr: false,
  }
);

const MERMAID_KEYWORDS = [
  'graph',
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'erDiagram',
  'gantt',
  'pie',
  'mindmap',
  'gitGraph',
  'journey',
];

function isMermaidDiagram(code: string, language?: string): boolean {
  if (language === 'mermaid') return true;
  const trimmed = code.trim();
  return MERMAID_KEYWORDS.some((kw) => trimmed.startsWith(kw));
}

type ProcessTextFn = (text: string) => React.ReactNode;

/** Extract plain text from React children */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node) && node.props?.children) {
    return extractText(node.props.children as React.ReactNode);
  }
  return '';
}

/** Generate GitHub-flavored heading slug with dedup suffix */
function headingSlug(
  children: React.ReactNode,
  slugCounts?: Map<string, number>
): string {
  const text = extractText(children);
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[#*`~^|\\[\]{}<>&=+!@$%;"'?,]/g, '') // strip markdown/special ASCII symbols
    .replace(/\./g, '-') // dots → dashes
    .replace(/\s/g, '-') // spaces → dashes
    .replace(/-{2,}/g, '-') // collapse consecutive dashes
    .replace(/^-|-$/g, ''); // trim leading/trailing dashes

  if (!slugCounts) return base;

  const count = slugCounts.get(base) ?? 0;
  slugCounts.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

function processChildren(
  children: React.ReactNode,
  processText: ProcessTextFn
): React.ReactNode {
  if (typeof children === 'string') {
    return processText(children);
  }
  if (Array.isArray(children)) {
    return children.map((child, i) =>
      typeof child === 'string' ? (
        <span key={i}>{processText(child)}</span>
      ) : (
        child
      )
    );
  }
  return children;
}

function processChildrenSimple(
  children: React.ReactNode,
  processText: ProcessTextFn
): React.ReactNode {
  if (typeof children === 'string') {
    return processText(children);
  }
  return children;
}

function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const [error, setError] = React.useState(false);
  if (error || !src) {
    return null; // Hide broken images
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt || ''}
      className="max-w-full rounded-lg"
      loading="lazy"
      onError={() => setError(true)}
    />
  );
}

export interface CreateMarkdownComponentsOptions {
  /**
   * 是否对标题（h1-h4）也应用 processText，默认 false。
   * 默认 simple 模式：标题 children 是数组（嵌入 inline 元素如 `## Hello *world*`）时
   * 原样 passthrough，避免对已 parse 的 inline 元素做二次干预。
   *
   * 设为 true 时切换为 full 模式：标题 children 是数组的情况下，
   * 也会递归处理其中的 string 段落。适用于「标题里也含 [1] 引用徽章」等场景。
   */
  applyTextProcessingToHeadings?: boolean;

  /**
   * 是否对 blockquote 应用完整的 processChildren（递归 array），默认 false。
   * 默认 simple 模式：只处理 string children，array passthrough。
   * 设为 true 时与标题/段落同口径，块级 quote 内的 inline 元素也会被处理。
   */
  applyTextProcessingToBlockquote?: boolean;

  /**
   * 是否在 inline 元素（strong / em）里调用 processText，默认 true。
   *
   * 默认 true 是历史 TI 行为：`*hello [1]*` 会渲染 [1] 为 CitationBadge。
   *
   * 在 TopicContentPanel L2502 的特定场景里需要 false，因为原 ReactMarkdown
   * 自定义只覆盖了 p/li/td/th/h1-h4/blockquote，emphasis/bold 走默认渲染，
   * 不会处理 citations。设为 false 可严格幂等。
   */
  applyTextProcessingToInlineElements?: boolean;

  /**
   * 跨实例共享的标题锚点计数 Map。
   * 默认每次调用 createMarkdownComponents 内建一个新 Map（per-render 重置）。
   * 当一段逻辑文本被切分成多个 ReactMarkdown 实例渲染（如章节里穿插图表），
   * 必须传入同一个外部 Map 才能保证锚点去重正确。
   */
  sharedSlugCounts?: Map<string, number>;
}

export function createMarkdownComponents(
  processText: ProcessTextFn,
  opts: CreateMarkdownComponentsOptions = {}
) {
  // Track heading slug counts for dedup (reset per render unless caller injects a shared Map)
  const slugCounts = opts.sharedSlugCounts ?? new Map<string, number>();
  // Track the last seen h2 heading text for context-aware rendering
  let lastH2Text = '';
  // Headings children 处理器：默认 simple，opts 切到 full（递归 array）
  const processHeading = opts.applyTextProcessingToHeadings
    ? processChildren
    : processChildrenSimple;
  // blockquote children 处理器：默认 simple，opts 切到 full
  const processBlockquote = opts.applyTextProcessingToBlockquote
    ? processChildren
    : processChildrenSimple;
  // inline 元素 (strong / em) 处理器：默认 simple（历史 TI 行为，处理 string）；
  // 显式 opts.applyTextProcessingToInlineElements=false 时返回 children 不动
  const processInline = (
    children: React.ReactNode,
    fn: ProcessTextFn
  ): React.ReactNode => {
    if (opts.applyTextProcessingToInlineElements === false) return children;
    return processChildrenSimple(children, fn);
  };

  return {
    img: ({ src, alt }: { src?: string; alt?: string }) => (
      <MarkdownImage src={src} alt={alt} />
    ),
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const isHash = href?.startsWith('#');
      const handleHashClick = isHash
        ? (e: React.MouseEvent) => {
            e.preventDefault();
            const raw = decodeURIComponent(href!.slice(1));

            // 1. Try exact ID match
            let target = document.getElementById(raw);

            // 2. Fuzzy: normalize the hash the same way headingSlug does, then try
            if (!target) {
              const normalized = raw
                .toLowerCase()
                .trim()
                .replace(/[#*`~^|\\[\]{}<>&=+!@$%;"'?,]/g, '')
                .replace(/\./g, '-')
                .replace(/\s/g, '-')
                .replace(/-{2,}/g, '-')
                .replace(/^-|-$/g, '');
              if (normalized !== raw) {
                target = document.getElementById(normalized);
              }
            }

            // 3. Fallback: 按文字匹配标题。用【锚点 raw + 链接显示文字】两个 needle，
            //    先精确（剥"N. "编号 + 去空格后相等），再包含式模糊（writer 改写过目录措辞
            //    时局部出入也能命中）。覆盖 renumberHeadings 加编号 / TOC 与标题措辞不完全一致。
            if (!target) {
              const clean = (s: string) =>
                s
                  .replace(/^[\d.]+[\s.、:：)]+/, '') // 剥前导编号 "1. " / "1.2 " / "1)"
                  .replace(/\s+/g, '')
                  .toLowerCase();
              const needles = Array.from(
                new Set([clean(raw), clean(extractText(children))])
              ).filter((n) => n.length > 0);
              // 不限 [id]：即便标题无 id（别的渲染器 / sanitize 滤掉）也能按文字命中并滚动
              const headings = Array.from(
                document.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
              );
              // 3a. 精确相等
              target =
                headings.find((h) =>
                  needles.includes(clean(h.textContent || ''))
                ) ?? null;
              // 3b. 包含式模糊（needle ⊆ 标题 或 标题 ⊆ needle，长度≥4 防误命中）
              if (!target) {
                target =
                  headings.find((h) => {
                    const ht = clean(h.textContent || '');
                    return needles.some(
                      (n) => n.length >= 4 && (ht.includes(n) || n.includes(ht))
                    );
                  }) ?? null;
              }
            }

            if (target) {
              // Find the nearest scrollable ancestor
              let container: HTMLElement | null = target.parentElement;
              while (container) {
                const style = getComputedStyle(container);
                if (
                  (style.overflowY === 'auto' ||
                    style.overflowY === 'scroll') &&
                  container.scrollHeight > container.clientHeight
                ) {
                  break;
                }
                container = container.parentElement;
              }
              if (container) {
                const containerRect = container.getBoundingClientRect();
                const targetRect = target.getBoundingClientRect();
                container.scrollTo({
                  top: container.scrollTop + targetRect.top - containerRect.top,
                  behavior: 'smooth',
                });
              } else {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }
          }
        : undefined;
      return (
        <a
          href={href}
          onClick={handleHashClick}
          {...(isHash ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
          className="cursor-pointer text-blue-600 hover:text-blue-800 hover:underline"
        >
          {children}
        </a>
      );
    },
    p: ({
      children,
      node: _node,
      ...props
    }: React.HTMLAttributes<HTMLParagraphElement> & {
      children?: React.ReactNode;
      node?: unknown;
    }) => <p {...props}>{processChildren(children, processText)}</p>,
    li: ({
      children,
      node: _node,
      ...props
    }: React.LiHTMLAttributes<HTMLLIElement> & {
      children?: React.ReactNode;
      node?: unknown;
    }) => <li {...props}>{processChildren(children, processText)}</li>,
    strong: ({
      children,
      node: _node,
      ...props
    }: React.HTMLAttributes<HTMLElement> & {
      children?: React.ReactNode;
      node?: unknown;
    }) => {
      const isConclusionSection = /结语|Conclusion/i.test(lastH2Text);
      if (isConclusionSection) {
        return (
          <strong className="text-purple-700" {...props}>
            {processInline(children, processText)}
          </strong>
        );
      }
      return <strong {...props}>{processInline(children, processText)}</strong>;
    },
    em: ({
      children,
      node: _node,
      ...props
    }: React.HTMLAttributes<HTMLElement> & {
      children?: React.ReactNode;
      node?: unknown;
    }) => <em {...props}>{processInline(children, processText)}</em>,
    table: ({
      children,
      node: _node,
      ...props
    }: React.TableHTMLAttributes<HTMLTableElement> & {
      children?: React.ReactNode;
      node?: unknown;
    }) => {
      // Extract text from children to detect risk matrix table
      function extractText(node: React.ReactNode): string {
        if (typeof node === 'string') return node;
        if (typeof node === 'number') return String(node);
        if (Array.isArray(node)) return node.map(extractText).join('');
        if (React.isValidElement(node) && node.props?.children) {
          return extractText(node.props.children as React.ReactNode);
        }
        return '';
      }

      const tableText = extractText(children);
      const isRiskMatrix =
        /风险类型|概率|影响|Risk Type|Probability|Impact/i.test(tableText);

      return (
        <Table
          {...props}
          className={isRiskMatrix ? 'border border-red-100' : ''}
        >
          {children}
        </Table>
      );
    },
    td: ({
      children,
      node: _node,
      ...props
    }: React.TdHTMLAttributes<HTMLTableCellElement> & {
      children?: React.ReactNode;
      node?: unknown;
    }) => {
      // Extract text from children to detect risk level
      function extractText(node: React.ReactNode): string {
        if (typeof node === 'string') return node;
        if (typeof node === 'number') return String(node);
        if (Array.isArray(node)) return node.map(extractText).join('');
        if (React.isValidElement(node) && node.props?.children) {
          return extractText(node.props.children as React.ReactNode);
        }
        return '';
      }

      const cellText = extractText(children).trim();

      // Check if cell contains risk level indicator
      const riskLevelMap: Record<string, string> = {
        高: 'bg-red-100 text-red-700 font-medium',
        High: 'bg-red-100 text-red-700 font-medium',
        中: 'bg-amber-100 text-amber-700 font-medium',
        Medium: 'bg-amber-100 text-amber-700 font-medium',
        低: 'bg-green-100 text-green-700 font-medium',
        Low: 'bg-green-100 text-green-700 font-medium',
      };

      const riskClass = riskLevelMap[cellText];

      if (riskClass) {
        return (
          <Td {...props}>
            <span
              className={`inline-block rounded-sm px-1.5 py-0.5 ${riskClass}`}
            >
              {processChildren(children, processText)}
            </span>
          </Td>
        );
      }

      return <Td {...props}>{processChildren(children, processText)}</Td>;
    },
    th: ({
      children,
      node: _node,
      ...props
    }: React.ThHTMLAttributes<HTMLTableCellElement> & {
      children?: React.ReactNode;
      node?: unknown;
    }) => <Th {...props}>{processChildren(children, processText)}</Th>,
    h1: ({
      children,
      node: _node,
      ...props
    }: React.HTMLAttributes<HTMLHeadingElement> & {
      children?: React.ReactNode;
      node?: unknown;
    }) => (
      <h1 id={headingSlug(children, slugCounts)} {...props}>
        {processHeading(children, processText)}
      </h1>
    ),
    h2: ({
      children,
      node: _node,
      ...props
    }: React.HTMLAttributes<HTMLHeadingElement> & {
      children?: React.ReactNode;
      node?: unknown;
    }) => {
      lastH2Text = extractText(children);
      return (
        <h2 id={headingSlug(children, slugCounts)} {...props}>
          {processHeading(children, processText)}
        </h2>
      );
    },
    h3: ({
      children,
      node: _node,
      ...props
    }: React.HTMLAttributes<HTMLHeadingElement> & {
      children?: React.ReactNode;
      node?: unknown;
    }) => (
      <h3 id={headingSlug(children, slugCounts)} {...props}>
        {processHeading(children, processText)}
      </h3>
    ),
    h4: ({
      children,
      node: _node,
      ...props
    }: React.HTMLAttributes<HTMLHeadingElement> & {
      children?: React.ReactNode;
      node?: unknown;
    }) => (
      <h4 id={headingSlug(children, slugCounts)} {...props}>
        {processHeading(children, processText)}
      </h4>
    ),
    blockquote: ({
      children,
      node: _node,
      ...props
    }: React.BlockquoteHTMLAttributes<HTMLQuoteElement> & {
      children?: React.ReactNode;
      node?: unknown;
    }) => {
      return (
        <blockquote {...props}>
          {processBlockquote(children, processText)}
        </blockquote>
      );
    },
    ul: ({
      children,
      node: _node,
      depth: depthProp,
      ...props
    }: React.HTMLAttributes<HTMLUListElement> & {
      children?: React.ReactNode;
      node?: unknown;
      depth?: number;
    }) => {
      const depth = depthProp ?? 0;
      const listStyle = depth > 0 ? 'circle' : 'disc';
      return (
        <ul {...props} style={{ listStyleType: listStyle, ...props.style }}>
          {children}
        </ul>
      );
    },
    ol: ({
      children,
      node: _node,
      depth: depthProp,
      ...props
    }: React.OlHTMLAttributes<HTMLOListElement> & {
      children?: React.ReactNode;
      node?: unknown;
      depth?: number;
    }) => {
      const depth = depthProp ?? 0;
      const listStyle = depth > 0 ? 'lower-alpha' : 'decimal';
      return (
        <ol {...props} style={{ listStyleType: listStyle, ...props.style }}>
          {children}
        </ol>
      );
    },
    code: ({
      className,
      children,
      node: _node,
      ...props
    }: React.HTMLAttributes<HTMLElement> & {
      children?: React.ReactNode;
      node?: unknown;
    }) => {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';
      const codeString = String(children).replace(/\n$/, '');
      const hasLanguage = !!match;
      const hasNewlines = codeString.includes('\n');
      const isInline = !hasLanguage && !hasNewlines;

      if (!isInline && isMermaidDiagram(codeString, language)) {
        return <MermaidDiagram chart={codeString} className="my-4" />;
      }

      if (isInline) {
        return (
          <code
            className="font-mono rounded bg-gray-100 px-1.5 py-0.5 text-sm text-red-600"
            {...props}
          >
            {children}
          </code>
        );
      }

      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
  };
}
