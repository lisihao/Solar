/**
 * radar-email-helpers — 共享 Handlebars helpers
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §7.3.3 B14 邮件 helpers 安全契约
 *
 * 历史：原先在 platform/email/rendering/handlebars-renderer.service.ts（邮件
 * 渲染） 与 ai-engine/tools/.../template-render.tool.ts（LLM 工具渲染）各
 * 实现一份，5 处重复（R5 reuse audit 列入 FU3 follow-up）。本模块作为单一
 * 实现源，两端 import 注册即可。
 *
 * 设计约束：
 * - 中性工具函数，不依赖任何模块（不能 import ai-engine / platform 内部）
 * - 处于 common/，allow downward imports from both ai-engine 和 platform
 * - detailUrl helper 暂保留两端各自实现（参数签名差异 by design：邮件传 baseUrl
 *   + topicId，LLM 工具用全局 config + 无 topicId）
 */

export type HelperFn = (...args: unknown[]) => unknown;

/**
 * urlEncode — RFC 3986 encodeURIComponent + strip CR/LF/Tab（防 SMTP header injection）
 */
export const urlEncodeHelper: HelperFn = (v: unknown) => {
  if (v == null) return "";
  return encodeURIComponent(String(v).replace(/[\r\n\t]/g, ""));
};

/**
 * truncate — codepoint-aware（emoji 不裂开），超长加 U+2026 …
 */
export const truncateHelper: HelperFn = (s: unknown, n: unknown) => {
  if (s == null) return "";
  const str = String(s);
  const maxN = typeof n === "number" ? n : parseInt(String(n), 10) || 80;
  if (!Number.isFinite(maxN) || str.length <= maxN) return str;
  const chars = Array.from(str);
  return chars.slice(0, Math.max(0, maxN - 1)).join("") + "…";
};

/**
 * tierBadge — tier {1,2,3} → star string
 */
export const tierBadgeHelper: HelperFn = (tier: unknown) => {
  const n = typeof tier === "number" ? tier : parseInt(String(tier), 10);
  if (n === 3) return "⭐⭐⭐";
  if (n === 2) return "⭐⭐";
  return "⭐";
};

/**
 * evidenceSources — array of {name} → "A / B / C"（name-only，不输出 raw HTML 防 XSS）
 */
export const evidenceSourcesHelper: HelperFn = (sources: unknown) => {
  if (!Array.isArray(sources)) return "";
  return sources
    .filter(
      (s): s is { name: string } =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as Record<string, unknown>)["name"] === "string",
    )
    .map((s) => s.name)
    .join(" / ");
};

/**
 * 一次注册全部 helpers（除 detailUrl —— 两端签名差异 by design，由调用方注册）
 */
export interface HbsLike {
  registerHelper(name: string, fn: HelperFn): void;
}

export function registerRadarEmailHelpers(hbs: HbsLike): void {
  hbs.registerHelper("urlEncode", urlEncodeHelper);
  hbs.registerHelper("truncate", truncateHelper);
  hbs.registerHelper("tierBadge", tierBadgeHelper);
  hbs.registerHelper("evidenceSources", evidenceSourcesHelper);
}
