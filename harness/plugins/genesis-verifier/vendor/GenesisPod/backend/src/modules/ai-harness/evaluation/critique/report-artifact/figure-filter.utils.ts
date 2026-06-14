/**
 * 图来源垃圾过滤（mission-pipeline-baseline.md §7.4 / 对齐 TI chart-placeholder.utils.ts）
 *
 * 规则：拒绝 QR / favicon / icon / logo / stock photo / 跟踪像素 / 超长 URL 等。
 */

const GARBAGE_HOSTS = [
  "unsplash.com",
  "pexels.com",
  "shutterstock.com",
  "istockphoto.com",
  "gettyimages.com",
  "pixabay.com",
  "depositphotos.com",
  "alamy.com",
  "freepik.com",
];

const GARBAGE_PATH_KEYWORDS = [
  "/qr/",
  "/qrcode/",
  "/favicon",
  "/icon-",
  "/logo-",
  "/badge-",
  "/avatar/",
  "/sprite",
  "/tracking-pixel",
  "/pixel.gif",
  "/spacer",
];

const GARBAGE_FILENAME = [
  "favicon.ico",
  "favicon.png",
  "logo.png",
  "logo.svg",
  "1x1.gif",
  "2x2.gif",
  "transparent.png",
  "spacer.gif",
  "blank.gif",
];

export function isGarbageFigureUrl(url: string | undefined): boolean {
  if (!url) return true;
  const u = url.trim();
  if (!u) return true;

  // 超长 URL（非 data: URI）
  if (u.length > 2048 && !u.startsWith("data:")) return true;

  // data: URI 默认放行（已是有效图片，外部不能进 stock）
  if (u.startsWith("data:image/")) return false;
  // 其他 data: URI 拒绝
  if (u.startsWith("data:")) return true;

  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return true;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  // stock photo 站
  if (GARBAGE_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
    return true;
  }

  const pathLower = parsed.pathname.toLowerCase();
  for (const kw of GARBAGE_PATH_KEYWORDS) {
    if (pathLower.includes(kw)) return true;
  }
  const filename = pathLower.split("/").pop() ?? "";
  for (const fn of GARBAGE_FILENAME) {
    if (filename === fn) return true;
  }

  return false;
}

/**
 * 去重 figure candidates：同 imageUrl / sourceUrl+caption 视为同图，保留 relevanceHint 较高者。
 */
export function dedupeFigureCandidates<
  T extends {
    sourceUrl: string;
    imageUrl?: string;
    caption: string;
    relevanceHint?: "high" | "medium" | "low";
  },
>(figs: readonly T[]): T[] {
  const score = (h?: "high" | "medium" | "low"): number =>
    h === "high" ? 3 : h === "medium" ? 2 : 1;
  const map = new Map<string, T>();
  for (const f of figs) {
    const key = f.imageUrl
      ? `img:${f.imageUrl}`
      : `src:${f.sourceUrl}::${f.caption.slice(0, 40)}`;
    const existing = map.get(key);
    if (!existing || score(f.relevanceHint) > score(existing.relevanceHint)) {
      map.set(key, f);
    }
  }
  return Array.from(map.values());
}
