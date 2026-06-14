/**
 * artifact-markdown.utils.ts — PR-A6 (2026-05-07)
 *
 * 上游：docs/architecture/ai-harness/evaluation/report-assembly-invariant-redesign.md
 *      v1.4 §6.6 katexAwareSchema + §5 PR-A6 NB-3
 *
 * 职责：把 hast (rehype) defaultSchema 扩展，允许 KaTeX 渲染所需的
 * MathML / SVG / 类名白名单，同时仍然剥掉用户内容里的危险 attrs（onerror /
 * onclick / javascript: 等）。前端 ArtifactMarkdown 把本 schema 喂给
 * rehype-sanitize 即可。
 *
 * 不做：
 *   - 不运行任何 LLM
 *   - 不依赖 backend
 *   - 不依赖 katex 包本体（仅引用元素名）
 */

import { katexAwareSchema as sharedKatexAwareSchema } from '@/lib/markdown/katexAwareSchema';

/**
 * KaTeX 渲染产物 attrs/elements 白名单
 *
 * 来源：KaTeX 输出的 HTML/MathML 元素与 attrs（katex.render() 文档）。
 * 与 defaultSchema 合并后允许：
 *   - <span class="katex"> ... </span>
 *   - <math xmlns="..."> ... </math>
 *   - <semantics><mrow><mi>...</mi></mrow><annotation>...</annotation></semantics>
 *   - SVG 路径数据（KaTeX 用来画分数线 / 根号）
 */
/**
 * 自定义 katexAwareSchema —— defaultSchema + KaTeX 元素 / attrs。
 *
 * **安全收紧 (R2 共识 P1)**：
 *   - **不**把 `style` 放进 `'*'` 全局白名单（CSS 注入面：
 *     `<span style="background:url(//evil.com/track)">` SSRF 追踪 /
 *     `<div style="position:fixed;...">` 视觉劫持）
 *   - `style` 仅在 KaTeX 元素 + svg/path 上放行（KaTeX 渲染期需要 inline style 排版）
 *   - 普通 markdown 元素继承 defaultSchema 默认 attrs（不放 style）
 *
 * 用法（注意顺序，**rehypeSanitize 必须在 rehypeKatex 之后**）：
 *   <ReactMarkdown rehypePlugins={[rehypeKatex, [rehypeSanitize, katexAwareSchema]]} />
 */
export const katexAwareSchema = sharedKatexAwareSchema;
