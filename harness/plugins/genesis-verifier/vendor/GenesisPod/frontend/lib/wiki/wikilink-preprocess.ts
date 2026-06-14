/**
 * Wiki body markdown 预处理：把多种"slug 引用"形态统一转 [title](wikilink:slug)
 *
 * 2026-05-14 故事：LLM ingest 在 body 里应该用 `[[slug]]` 语法引用别的 wiki page；
 * 但实测 prod LLM 经常错用 inline code `\`slug\``，前端 regex 不匹配 → 用户看到的就是
 * 一堆拼音 inline code 块，不是真 wikilink button。
 *
 * 兜底策略（不破坏真正的代码 inline）：
 *   1. `[[slug]]`  → 永远转 wikilink
 *   2. `\`slug\``  → 仅在 slug 出现在 titleBySlug map（已知 page slug 集）时才转
 *   3. 其他 inline code 保留原样（如 `tensor.compile`）
 *
 * anchor 文本用真 title，没 lookup 到时 fallback 到 slug 字符串。
 */

const WIKILINK_RE = /\[\[([a-z0-9][a-z0-9-]*[a-z0-9])\]\]/g;
// Inline code 守门 + slug 形态 (kebab-case, 仅 a-z0-9 + 连字符)
const INLINE_CODE_SLUG_RE = /`([a-z0-9][a-z0-9-]{1,}[a-z0-9])`/g;

export function preprocessWikiBody(
  body: string,
  titleBySlug: Map<string, string>
): string {
  let out = body.replace(
    WIKILINK_RE,
    (_m, slug: string) => `[${titleBySlug.get(slug) ?? slug}](wikilink:${slug})`
  );

  // 兜底：把"看起来像 slug 且确实是已知 page slug"的 inline code 转 wikilink。
  // 关键守门：必须 hit titleBySlug 才转——避免破坏真正的代码片段
  out = out.replace(INLINE_CODE_SLUG_RE, (match, candidate: string) => {
    if (!titleBySlug.has(candidate)) return match; // 真代码 inline，保留
    return `[${titleBySlug.get(candidate)}](wikilink:${candidate})`;
  });

  return out;
}
