import { createHash } from "crypto";

/**
 * 内容指纹：sha256(normalized(title + content[:1000]))。
 *
 * - normalize: trim + collapse whitespace + lowercase
 * - 用 title + 截断 content 而非整篇，避免长文 hash 算太久
 * - 跨 source 同主题转发的相同内容会算出同一个 hash → dedupe stage 命中
 */
export function computeContentHash(
  title: string | null | undefined,
  content: string | null | undefined,
): string {
  const t = normalize(title ?? "");
  const c = normalize(content ?? "").slice(0, 1000);
  return createHash("sha256").update(`${t}|${c}`).digest("hex");
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}
