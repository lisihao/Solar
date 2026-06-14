const YOUTUBE_PRECHECK_TIMEOUT_MS = 8000;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

export type YoutubePrecheckVerdict =
  | "healthy"
  | "dead"
  | "unknown"
  | "not-youtube";

export interface YoutubePrecheckResult {
  verdict: YoutubePrecheckVerdict;
  reason: string; // oembed-200 / oembed-400-malformed-id / oembed-401-private / oembed-404-deleted / network-error / not-youtube
}

/**
 * Pre-flight check for YouTube URLs before insertion.
 *
 *   200       → "healthy" (video exists, embeddable as far as oEmbed knows)
 *   400       → "dead"    (malformed/lowercased video ID — see dedup history)
 *   401       → "dead"    (privacy)
 *   404       → "dead"    (deletion)
 *   other     → "unknown" (network error / rate limit — defer to scheduler)
 */
export async function precheckYoutubeUrl(
  url: string,
): Promise<YoutubePrecheckResult> {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { verdict: "not-youtube", reason: "not-youtube" };
  }
  if (!YOUTUBE_HOSTS.has(host)) {
    return { verdict: "not-youtube", reason: "not-youtube" };
  }
  try {
    const axios = (await import("axios")).default;
    const res = await axios.get(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { timeout: YOUTUBE_PRECHECK_TIMEOUT_MS, validateStatus: () => true },
    );
    if (res.status === 200) return { verdict: "healthy", reason: "oembed-200" };
    if (res.status === 400)
      return { verdict: "dead", reason: "oembed-400-malformed-id" };
    if (res.status === 401)
      return { verdict: "dead", reason: "oembed-401-private" };
    if (res.status === 404)
      return { verdict: "dead", reason: "oembed-404-deleted" };
    return { verdict: "unknown", reason: `oembed-${res.status}-ambiguous` };
  } catch (e) {
    return {
      verdict: "unknown",
      reason: `network-error:${(e as Error).message.slice(0, 40)}`,
    };
  }
}
