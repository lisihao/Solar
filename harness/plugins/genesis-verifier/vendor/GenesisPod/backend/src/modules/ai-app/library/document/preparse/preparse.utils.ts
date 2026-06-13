/**
 * Preparse Utilities (W1 v2.0 rebuild)
 *
 * 纯函数：从 markdown / HTML / URL 抽取媒体、语种、章节结构。
 * 不依赖 NestJS / Prisma —— 给 service spec 独立测试。
 */

const MARKDOWN_IMG_RE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HTML_IMG_RE = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
const YOUTUBE_URL_RE =
  /^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/;
const MARKDOWN_HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/gm;

/**
 * 抽取 markdown / HTML 中全部图片 URL。
 * 包括：`![alt](url)` / `<img src="url">` / cover image URL 显式传入。
 * 输出去重 + http(s):// 协议过滤（拒 data: / blob: / javascript:）。
 */
export function extractImageUrls(input: {
  markdown?: string | null;
  coverImageUrl?: string | null;
  videoId?: string | null;
}): string[] {
  const out = new Set<string>();

  const accept = (raw: string): void => {
    const url = raw.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) return;
    if (url.length > 2048) return;
    out.add(url);
  };

  if (input.coverImageUrl) accept(input.coverImageUrl);

  if (input.markdown) {
    let m: RegExpExecArray | null;
    while ((m = MARKDOWN_IMG_RE.exec(input.markdown)) !== null) accept(m[1]);
    while ((m = HTML_IMG_RE.exec(input.markdown)) !== null) accept(m[1]);
  }

  if (input.videoId) {
    accept(`https://i.ytimg.com/vi/${input.videoId}/maxresdefault.jpg`);
  }

  return Array.from(out);
}

/**
 * URL → YouTube videoId 提取（与 ContentFetchService.extractYoutubeVideoId
 * 同款正则，复用避免双源；该 service 私有方法不可外部调）。
 */
export function extractYoutubeVideoId(url: string): string | null {
  const m = YOUTUBE_URL_RE.exec(url);
  return m ? m[1] : null;
}

/**
 * 简易语种检测（不调 LLM）：扫描前 500 字符，按中文字符比例判定 zh / en。
 * 含 >20% CJK 字符 → zh；其他 → en。
 *
 * 真源：用户场景就 zh / en 两种；更精细的语种检测交给 W3 后续 LLM mini-call。
 */
export function detectLocale(text: string): "zh" | "en" {
  const sample = (text ?? "").slice(0, 500);
  if (sample.length === 0) return "en";
  let cjk = 0;
  for (const ch of sample) {
    const code = ch.charCodeAt(0);
    // CJK Unified Ideographs (常用汉字主区) + 扩展 A
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf)
    ) {
      cjk++;
    }
  }
  return cjk / sample.length > 0.2 ? "zh" : "en";
}

/**
 * Markdown 章节结构抽取。
 * 把 H2/H3 标题切成段，每段含 heading + 该 heading 下到下一个同级 heading 之前的内容。
 * 跳过 H1（视为文档标题，由外层 title 字段存）。
 *
 * 用途：W2 outline pass 直接消费，不让 LLM 现场切章节。
 */
export interface ParsedSection {
  heading: string;
  level: 2 | 3;
  content: string;
  images: string[];
}

export function parseSections(markdown: string): ParsedSection[] {
  if (!markdown || markdown.length === 0) return [];

  const sections: ParsedSection[] = [];
  const matches: Array<{ index: number; level: number; heading: string }> = [];
  const headingRe = new RegExp(MARKDOWN_HEADING_RE.source, "gm");
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(markdown)) !== null) {
    const level = m[1].length;
    if (level === 2 || level === 3) {
      matches.push({ index: m.index, level, heading: m[2].trim() });
    }
  }

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const lineEnd = markdown.indexOf("\n", cur.index);
    const startOfContent = lineEnd === -1 ? cur.index : lineEnd + 1;
    const endOfContent = next ? next.index : markdown.length;
    const content = markdown.slice(startOfContent, endOfContent).trim();
    sections.push({
      heading: cur.heading,
      level: cur.level as 2 | 3,
      content,
      images: extractImageUrls({ markdown: content }),
    });
  }

  return sections;
}

/**
 * preparse JSON sub-key 形状（用作 KbDocument.metadata.preparse）。
 * service / spec / consumer 共用一个 type 单源。
 */
export interface PreparseMetadata {
  status: "pending" | "parsing" | "ready" | "failed";
  mediaUrls: string[];
  structuredContent?: {
    title: string;
    sections: ParsedSection[];
  };
  sourceLocale?: "zh" | "en";
  parsedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  retryCount?: number;
}
