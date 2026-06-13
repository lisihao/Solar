import { Injectable, Logger } from "@nestjs/common";
import type { Page } from "puppeteer";

interface UploadAttempt {
  endpoint: string;
  ret: number;
  url: string | null;
  fileId: string | null;
  aiStatus: number;
  errMsg?: string;
}

interface UploadResult {
  url: string | null;
  fileId: string | null;
  aiStatus: number;
  ext: string;
  attempts: UploadAttempt[];
}

interface UploadDetail {
  url: string;
  fileId: string;
  aiStatus: number;
  ext: string;
}

interface CoverUploadAttempt {
  endpoint: string;
  ret: number;
  mediaId: string | null;
  cdnUrl: string | null;
  errMsg?: string;
}

interface CoverUploadResult {
  mediaId: string | null;
  cdnUrl: string | null;
  aiStatus: number;
  ext: string;
  attempts: CoverUploadAttempt[];
}

interface CropMultiResult {
  ok: boolean;
  cropFileId235: string | null;
  cropCdnUrl235: string | null;
  cropFileId1_1: string | null;
  cropCdnUrl1_1: string | null;
  fingerprintSource: string;
  bodyPreview: string;
}

/**
 * 2026-05-16 PR #111: 完整 WeChat cover schema —— upload 原图 file_id +
 * crop_multi 后的 2.35:1 / 1:1 file_id 与 cdn_url。给 saveDraft 用作
 * cdn_url0 / cdn_235_1_url0 / cdn_1_1_url0 / cdn_url_back0 / crop_list0 等字段。
 */
export interface CoverUpload {
  /** upload 直接返回的 file_id (即 response.content 字段，纯数字串) */
  uploadFileId: string;
  /** upload 直接返回的 cdn_url（mmbiz.qpic.cn 域，作为 cdn_url_back0 原图回链） */
  uploadCdnUrl: string;
  /** upload 返回的 ai_status（1 或 0），用于正文 img data-aistatus 属性 */
  aiStatus: number;
  /** 图片扩展名（png / jpg / jpeg），用于正文 img data-type 属性 */
  imageType: string;
  /** crop_multi result[0] (2.35:1 cover) file_id */
  cropFileId235: string;
  /** crop_multi result[0] (2.35:1 cover) cdnurl，作为 cdn_url0 / cdn_235_1_url0 / cdn_3_4_url0 */
  cropCdnUrl235: string;
  /** crop_multi result[1] (1:1 小卡) file_id */
  cropFileId1_1: string;
  /** crop_multi result[1] (1:1 小卡) cdnurl，作为 cdn_1_1_url0 */
  cropCdnUrl1_1: string;
}

interface RewriteStats {
  rewritten: string;
  uploaded: number;
  failed: number;
  skipped: number;
}

const WECHAT_HOSTED_DOMAINS = [
  "mmbiz.qpic.cn",
  "mmbiz.qlogo.cn",
  "mp.weixin.qq.com",
];

const MMBIZ_URL_PATTERN = /^https:\/\/mmbiz\.qpic\.cn\//i;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const UPLOAD_CONCURRENCY = 3;

// Reviewer 共识 C3：用 matchAll 避免全局正则 lastIndex 状态泄漏
// 同时收紧字符类不允许换行/空白（防止 URL 跨行注入）
const IMG_TAG_REGEX =
  /<img\b([^>\n]*?)\bsrc\s*=\s*(["'])([^"'\s<>]+)\2([^>\n]*?)\/?>/gi;

/**
 * SSRF 防护：默认拒绝，仅放行"标准 hostname"（域名）+"公网 IPv4 dotted-quad"。
 *
 * 迭代 2 (Security re-audit)：之前 isUrlSsrfSafe 漏掉 IPv4-mapped IPv6
 * (`::ffff:127.0.0.1`)、十进制 IP (`2130706433`)、八进制 IP (`0177.0.0.1`)、
 * 十六进制 IP (`0x7f000001`)、ULA `[fc00::/7]` 等绕过。
 *
 * 简化策略：白名单 hostname 形态而非黑名单 IP 形态。
 *   - 域名：必须含至少一个 `.`，且只允许 `[a-z0-9.-]`（lowercase 后比较）
 *   - 标准 IPv4：必须是 4 段、每段 0-255、且不在私网段
 *   - 其他：单段数字 / 含 `:` / 含 `0x` 前缀 / 含字母 'x' / 全数字 → 拒
 *
 * 不做 DNS lookup（async + DNS rebinding 风险），最终防线在 platform
 * 网络层（生产环境用 egress firewall 拦内网）。
 */
function isUrlSsrfSafe(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();

    // 拒绝任何带 ipv6 字面地址的 host（[...]）—— 完全不放行 IPv6，
    // 公网图床用域名足够；IPv6 字面易出绕过（::ffff: / NAT64 / ULA）
    if (host.startsWith("[") || host.includes(":")) return false;

    // 拒绝 localhost / 全 0
    if (host === "localhost" || host === "0.0.0.0") return false;

    // 拒绝 0x / 0o 前缀（十六/八进制 IP 字面值）
    if (/^(0x|0o)/i.test(host)) return false;

    // hostname 第一个字符是数字 → 视为 IP 尝试，必须严格符合标准 dotted-quad。
    //
    // 关于八进制/十进制/十六进制 IP 字面值（如 0177.0.0.1 / 2130706433 /
    // 0x7f000001）：Node 的 URL parser 已经在 new URL() 阶段把它们标准化成
    // dotted-quad（验证见 `node -e "new URL('http://0177.0.0.1').hostname"`
    // → "127.0.0.1"），所以这里只需用标准 RFC1918/loopback/元数据范围检查
    // 就能拦下。leading-zero 显式拦的 defense in depth 是死代码（hostname
    // 看不到带前导零的形态），不必加。
    if (/^\d/.test(host)) {
      const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (!ipv4) return false;
      const [, a, b, c, d] = ipv4.map(Number);
      if (a > 255 || b > 255 || c > 255 || d > 255) return false;
      if (a === 10 || a === 127) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 169 && b === 254) return false; // AWS / GCP metadata
      if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
      if (a === 0) return false;
      return true;
    }

    // 不是 IP → 必须是合法域名：含至少一个 . + 只允许 [a-z0-9.-]
    if (!host.includes(".")) return false;
    if (!/^[a-z0-9.-]+$/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * 上传外部图片到微信公众号 CDN，重写正文 <img src>。
 *
 * 微信对外链图片会做防盗链拦截，必须先把图传到 mmbiz.qpic.cn 域。
 * 走 mp.weixin.qq.com 编辑器自身的上传接口（同域 fetch + cookie 鉴权）。
 *
 * 失败策略：单张图上传失败 → 保留原 URL + 警告日志，不阻塞整体发布。
 */
@Injectable()
export class WechatImageUploaderService {
  private readonly logger = new Logger(WechatImageUploaderService.name);

  async rewriteImagesInHtml(
    page: Page,
    html: string,
    token: string,
  ): Promise<RewriteStats> {
    const matches: Array<{ full: string; src: string }> = [];
    for (const m of html.matchAll(IMG_TAG_REGEX)) {
      matches.push({ full: m[0], src: m[3] });
    }

    // 同源去重 (Reviewer A2)：同一外链 URL 在文章里出现多次只传一次。
    // 并发上传 (Reviewer C2)：unique URL 并行 UPLOAD_CONCURRENCY 路上传。
    const uniqueSrcs = new Set<string>();
    let skipped = 0;
    for (const { src } of matches) {
      if (this.shouldSkip(src)) {
        skipped += 1;
        continue;
      }
      uniqueSrcs.add(src);
    }

    const urlToDetail = await this.uploadConcurrently(
      page,
      Array.from(uniqueSrcs),
      token,
    );

    let uploaded = 0;
    let failed = 0;
    let rewritten = html;

    for (const { full, src } of matches) {
      if (this.shouldSkip(src)) continue;

      const detail = urlToDetail.get(src);
      if (!detail) {
        failed += 1;
        this.logger.warn(
          `Image upload failed, keeping external URL (may be hotlink-blocked by WeChat): ${src.slice(0, 120)}`,
        );
        continue;
      }

      // 防 XSS (Security M1)：微信返回值理论上可能不是预期格式，
      // 拼回 HTML 前严格校验必须是 mmbiz CDN URL。
      if (!MMBIZ_URL_PATTERN.test(detail.url)) {
        failed += 1;
        this.logger.warn(
          `Rejected non-mmbiz upload result, keeping original: ${detail.url.slice(0, 80)}`,
        );
        continue;
      }

      // 2026-05-16 PR #111: 完整 WeChat 编辑器 img schema —— HAR 真鼠标
      // 上传后 content0 里的 img 标签形态。data-imgfileid / data-aistatus
      // 缺一不可，否则草稿箱 / publish 阶段图片会丢失。
      const wechatImgHtml = `<img class="rich_pages wxw-img js_insertlocalimg" data-s="300,640" data-type="${detail.ext}" type="block" data-imgfileid="${detail.fileId}" data-upload="1" data-aistatus="${detail.aiStatus}" data-src="${detail.url}">`;
      rewritten = rewritten.replace(full, wechatImgHtml);
      uploaded += 1;
    }

    this.logger.log(
      `[rewriteImages] total=${matches.length} unique=${uniqueSrcs.size} uploaded=${uploaded} failed=${failed} skipped=${skipped}`,
    );

    return { rewritten, uploaded, failed, skipped };
  }

  /**
   * 并发上传：限制同时活跃 UPLOAD_CONCURRENCY 个 page.evaluate + Node fetch。
   * 微信端单 page 同时跑太多 fetch 会触发限流，3 路是经验上限。
   */
  private async uploadConcurrently(
    page: Page,
    srcs: string[],
    token: string,
  ): Promise<Map<string, UploadDetail | null>> {
    const result = new Map<string, UploadDetail | null>();
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < srcs.length) {
        const idx = cursor++;
        const src = srcs[idx];
        const detail = await this.uploadOne(page, src, token);
        result.set(src, detail);
      }
    };

    const workers = Array.from(
      { length: Math.min(UPLOAD_CONCURRENCY, srcs.length) },
      () => worker(),
    );
    await Promise.all(workers);
    return result;
  }

  /**
   * 上传封面图 + crop_multi 两步走，返回完整 CoverUpload。
   *
   * 2026-05-16 PR #111: HAR 15.6MB 真鼠标录像反推真实链路 ——
   *   1. POST /cgi-bin/filetransfer?action=upload_material&scene=8 上传原图
   *      → 拿到 file_id + cdn_url + ai_status（图自动进素材库）
   *   2. POST /cgi-bin/cropimage?action=crop_multi 把 cdn_url 按 2.35:1 + 1:1
   *      两个比例裁出 → 拿到 2 个新 file_id + 2 个新 cdn_url
   *   3. saveDraft 用 6 个 cdn_url 字段 + crop_list0 JSON（不是 thumb_media_id）
   *
   * 之前 PR #97-110 一直在 thumb_media_id 这条死路上撞墙，
   * HAR 揭示新版编辑器根本不用这个字段，封面靠 CDN URL + crop 几何描述。
   *
   * 失败任何一步返回 null，由调用方决定无封面降级（保存的草稿封面会缺）。
   */
  async uploadCover(
    page: Page,
    externalUrl: string,
    token: string,
    sniffedFingerprint: string,
  ): Promise<CoverUpload | null> {
    if (!externalUrl || externalUrl.startsWith("data:")) return null;
    const normalized = externalUrl.startsWith("//")
      ? `https:${externalUrl}`
      : externalUrl;
    if (!isUrlSsrfSafe(normalized)) {
      this.logger.warn(
        `[uploadCover] Rejected SSRF-unsafe URL: ${normalized.slice(0, 80)}`,
      );
      return null;
    }

    let base64: string;
    let mimeType: string;
    try {
      const fetched = await this.fetchImage(normalized);
      base64 = fetched.base64;
      mimeType = fetched.mimeType;
    } catch (err) {
      this.logger.warn(
        `Failed to fetch cover image ${externalUrl}: ${(err as Error).message}`,
      );
      return null;
    }

    // Step 1: 上传原图进素材库
    const upload = await page.evaluate(
      runCoverUploadAttempts,
      base64,
      mimeType,
      token,
    );
    this.logger.log(
      `[uploadCover] upload attempts=${JSON.stringify(upload.attempts).slice(0, 600)}`,
    );
    if (!upload.mediaId || !upload.cdnUrl) {
      this.logger.warn("[uploadCover] upload step failed, no cover available");
      return null;
    }

    // Step 2: crop_multi 转封面比例 file_id
    const crop = await page.evaluate(
      runCoverCropMulti,
      upload.cdnUrl,
      token,
      sniffedFingerprint,
    );
    this.logger.log(
      `[uploadCover] crop_multi ok=${crop.ok} fp_source=${crop.fingerprintSource} body=${crop.bodyPreview.slice(0, 300)}`,
    );
    if (
      !crop.ok ||
      !crop.cropFileId235 ||
      !crop.cropCdnUrl235 ||
      !crop.cropFileId1_1 ||
      !crop.cropCdnUrl1_1
    ) {
      this.logger.warn(
        "[uploadCover] crop_multi failed, falling back to no-cover (新版编辑器不接受未 crop 的 file_id)",
      );
      return null;
    }

    return {
      uploadFileId: upload.mediaId,
      uploadCdnUrl: upload.cdnUrl,
      aiStatus: upload.aiStatus,
      imageType: upload.ext,
      cropFileId235: crop.cropFileId235,
      cropCdnUrl235: crop.cropCdnUrl235,
      cropFileId1_1: crop.cropFileId1_1,
      cropCdnUrl1_1: crop.cropCdnUrl1_1,
    };
  }

  private shouldSkip(src: string): boolean {
    if (!src || src.startsWith("data:")) return true;
    if (src.startsWith("//")) src = `https:${src}`;
    try {
      const { hostname } = new URL(src);
      return WECHAT_HOSTED_DOMAINS.some((d) => hostname.endsWith(d));
    } catch {
      return true;
    }
  }

  private async uploadOne(
    page: Page,
    externalUrl: string,
    token: string,
  ): Promise<UploadDetail | null> {
    const normalized = externalUrl.startsWith("//")
      ? `https:${externalUrl}`
      : externalUrl;
    if (!isUrlSsrfSafe(normalized)) {
      this.logger.warn(
        `[uploadImage] Rejected SSRF-unsafe URL: ${normalized.slice(0, 80)}`,
      );
      return null;
    }

    let base64: string;
    let mimeType: string;
    try {
      const fetched = await this.fetchImage(normalized);
      base64 = fetched.base64;
      mimeType = fetched.mimeType;
    } catch (err) {
      this.logger.warn(
        `Failed to fetch external image ${externalUrl}: ${(err as Error).message}`,
      );
      return null;
    }

    const result = await page.evaluate(
      runUploadAttempts,
      base64,
      mimeType,
      token,
    );

    this.logger.log(
      `[uploadImage] ${externalUrl.slice(0, 80)} → attempts=${JSON.stringify(
        result.attempts,
      ).slice(0, 600)}`,
    );

    if (!result.url || !result.fileId) return null;
    return {
      url: result.url,
      fileId: result.fileId,
      aiStatus: result.aiStatus,
      ext: result.ext,
    };
  }

  private async fetchImage(
    url: string,
  ): Promise<{ base64: string; mimeType: string }> {
    // 调用方已做 SSRF + 协议规范化。
    // 安全审计 iter2：流式读取 + 累积字节封顶，避免恶意服务器谎报
    // Content-Length 然后实际流出大体积 body（TOCTOU + 内存放大攻击）。
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching image`);
    }
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_IMAGE_BYTES) {
      throw new Error(
        `Image too large (declared ${declaredLength} bytes, limit ${MAX_IMAGE_BYTES})`,
      );
    }

    if (!response.body) {
      throw new Error("Response body unavailable");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error(
          `Image too large (streamed > ${MAX_IMAGE_BYTES} bytes, server may have lied about Content-Length)`,
        );
      }
      chunks.push(value);
    }
    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const mimeType =
      response.headers.get("content-type")?.split(";")[0].trim() ||
      "image/jpeg";
    return { base64: buffer.toString("base64"), mimeType };
  }
}

/**
 * 在 puppeteer page context 内执行的上传逻辑。
 * 同域 fetch 自动携带 mp.weixin.qq.com 的 session cookie。
 *
 * 多 endpoint 候选 —— 微信前端漂移时按顺序回退：
 * - misc/uploadimg2：编辑器正文插图常用接口
 * - cgi-bin/filetransfer：素材库上传（更稳但响应字段不同）
 */
async function runUploadAttempts(
  base64: string,
  mimeType: string,
  token: string,
): Promise<UploadResult> {
  const byteArray = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const rawExt = mimeType.split(";")[0].split("/")[1] || "jpg";
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "jpg";
  const filename = `image_${Date.now()}.${ext}`;
  const blob = new Blob([byteArray], { type: mimeType });

  // 2026-05-16 PR #111: 主路径切到 filetransfer?action=upload_material —— HAR
  // 真鼠标"本地上传"实证就是这条 endpoint，response 含 content (file_id) +
  // cdn_url + ai_status 三个我们需要的字段。misc-uploadimg2 退为 fallback。
  const endpoints: Array<{
    name: string;
    url: string;
    parse: (data: unknown) => {
      ret: number;
      url: string | null;
      fileId: string | null;
      aiStatus: number;
      err?: string;
    };
  }> = [
    {
      name: "filetransfer-upload-material",
      url: `/cgi-bin/filetransfer?action=upload_material&f=json&scene=8&writetype=doublewrite&groupid=1&token=${token}&lang=zh_CN`,
      parse: (data) => {
        const d = data as {
          base_resp?: { ret?: number; err_msg?: string };
          cdn_url?: string;
          url?: string;
          content?: string;
          ai_status?: number;
        };
        const ret = d.base_resp?.ret ?? -1;
        const cdnUrl = d.cdn_url || d.url || null;
        const contentIsUrl =
          typeof d.content === "string" && /^https?:\/\//i.test(d.content);
        const fileId =
          ret === 0 && !contentIsUrl && typeof d.content === "string"
            ? d.content
            : null;
        return {
          ret,
          url: ret === 0 ? cdnUrl : null,
          fileId,
          aiStatus: typeof d.ai_status === "number" ? d.ai_status : 0,
          err: d.base_resp?.err_msg,
        };
      },
    },
    {
      name: "misc-uploadimg2",
      url: `/misc/uploadimg2?t=ajax-editor-upload-img&token=${token}&lang=zh_CN`,
      parse: (data) => {
        // misc-uploadimg2 只回 url，不给 file_id —— 这路上传后正文 img
        // 缺 data-imgfileid 仍可能 saveDraft 成功，但 publish 阶段可能丢图。
        const d = data as {
          base_resp?: { ret?: number; err_msg?: string };
          content?: string;
          url?: string;
        };
        const ret = d.base_resp?.ret ?? -1;
        return {
          ret,
          url: ret === 0 ? d.content || d.url || null : null,
          fileId: null,
          aiStatus: 0,
          err: d.base_resp?.err_msg,
        };
      },
    },
  ];

  const attempts: UploadAttempt[] = [];
  for (const ep of endpoints) {
    try {
      const form = new FormData();
      form.append("file", blob, filename);
      const resp = await fetch(ep.url, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const data = (await resp.json().catch(() => ({}))) as unknown;
      const parsed = ep.parse(data);
      attempts.push({
        endpoint: ep.name,
        ret: parsed.ret,
        url: parsed.url,
        fileId: parsed.fileId,
        aiStatus: parsed.aiStatus,
        errMsg: parsed.err,
      });
      if (parsed.url && parsed.fileId) {
        return {
          url: parsed.url,
          fileId: parsed.fileId,
          aiStatus: parsed.aiStatus,
          ext,
          attempts,
        };
      }
    } catch (err) {
      attempts.push({
        endpoint: ep.name,
        ret: -999,
        url: null,
        fileId: null,
        aiStatus: 0,
        errMsg: (err as Error).message,
      });
    }
  }
  return { url: null, fileId: null, aiStatus: 0, ext, attempts };
}

/**
 * 封面图上传：必须走素材库 endpoint 才能拿到 file_id（作为 thumb_media_id）。
 * 比正文图多一项 file_id 解析。
 */
async function runCoverUploadAttempts(
  base64: string,
  mimeType: string,
  token: string,
): Promise<CoverUploadResult> {
  const byteArray = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const rawExt = mimeType.split(";")[0].split("/")[1] || "jpg";
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "jpg";
  const filename = `cover_${Date.now()}.${ext}`;
  const blob = new Blob([byteArray], { type: mimeType });

  // 2026-05-16 PR #111: HAR 真鼠标实证 endpoint 集合定型 ——
  //   scene=8 + filetransfer?action=upload_material 是真鼠标"本地上传"用的路径。
  //   响应 location 字段（bizfile vs wxmaterial）与 file_id 合法性无关 ——
  //   关键是上传后必须再跑 cropimage?action=crop_multi 才能拿到 cover 合法
  //   的 file_id（uploadCover 上层负责 crop 链路）。
  //   保留 upload_img 作 fallback：占位图 edge case 走兜底。
  const endpoints: Array<{ name: string; url: string }> = [
    {
      name: "filetransfer-upload-material-scene8",
      url: `/cgi-bin/filetransfer?action=upload_material&f=json&scene=8&writetype=doublewrite&groupid=1&token=${token}&lang=zh_CN`,
    },
    {
      name: "filetransfer-upload-img",
      url: `/cgi-bin/filetransfer?action=upload_img&token=${token}&lang=zh_CN`,
    },
  ];

  const attempts: CoverUploadAttempt[] = [];
  let lastAiStatus = 1;
  for (const ep of endpoints) {
    try {
      const form = new FormData();
      form.append("file", blob, filename);
      const resp = await fetch(ep.url, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const rawText = await resp.text();
      let data: {
        base_resp?: { ret?: number; err_msg?: string };
        content_url?: string;
        cdn_url?: string;
        url?: string;
        file_id?: string | number;
        media_id?: string | number;
        mediaid?: string | number;
        id?: string | number;
        mid?: string | number;
        content?: string;
        ai_status?: number;
        [key: string]: unknown;
      } = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        // not JSON
      }
      const ret = data.base_resp?.ret ?? -1;
      const contentIsUrl =
        typeof data.content === "string" && /^https?:\/\//i.test(data.content);
      const cdnUrl =
        typeof data.content_url === "string"
          ? data.content_url
          : typeof data.cdn_url === "string"
            ? data.cdn_url
            : typeof data.url === "string"
              ? data.url
              : contentIsUrl
                ? (data.content as string)
                : null;
      const contentAsMediaId =
        !contentIsUrl && typeof data.content === "string" ? data.content : null;
      const mediaIdRaw =
        data.file_id ??
        data.media_id ??
        data.mediaid ??
        data.id ??
        data.mid ??
        contentAsMediaId ??
        null;
      const fileId = mediaIdRaw != null ? String(mediaIdRaw) : null;
      if (typeof data.ai_status === "number") lastAiStatus = data.ai_status;
      const respKeys = Object.keys(data).slice(0, 20).join(",");
      const bodyPreview = rawText.slice(0, 400).replace(/\s+/g, " ");
      attempts.push({
        endpoint: ep.name,
        ret,
        mediaId: fileId,
        cdnUrl,
        errMsg: `${data.base_resp?.err_msg ?? ""} keys=[${respKeys}] body=${bodyPreview}`,
      });
      if (ret === 0 && fileId && cdnUrl) {
        return {
          mediaId: fileId,
          cdnUrl,
          aiStatus: lastAiStatus,
          ext,
          attempts,
        };
      }
    } catch (err) {
      attempts.push({
        endpoint: ep.name,
        ret: -999,
        mediaId: null,
        cdnUrl: null,
        errMsg: (err as Error).message,
      });
    }
  }
  return { mediaId: null, cdnUrl: null, aiStatus: 0, ext, attempts };
}

/**
 * crop_multi：把已上传到 mmbiz CDN 的图，按 2.35:1（封面）+ 1:1（小卡）两个
 * 比例 crop，返回 2 个新 file_id + 2 个新 cdn_url。
 *
 * 2026-05-16 PR #111: HAR 15.6MB 真鼠标实证。无 crop 直接传素材库 file_id
 * 给 saveDraft.thumb_media_id，WeChat 服务端不认 → type=77 + 红字"必须插入
 * 一张图片"。crop_multi 才是真正生成 cover-合法 file_id 的桥梁，新版编辑器
 * saveDraft 用 cdn_url0 + crop_list0 + 几何描述，不再用 thumb_media_id。
 *
 * 比例参数：原图按 (0,0) → (1,1) 全图裁剪两次，分别贴 2.35_1 + 1_1 format。
 * 我们生成的占位图 1200x630（约 1.9:1），全图按 2.35:1 比例标记给 WeChat
 * 即可 —— WeChat 服务端自己处理实际裁剪几何。
 */
async function runCoverCropMulti(
  cdnUrl: string,
  token: string,
  sniffedFingerprint: string,
): Promise<CropMultiResult> {
  // fingerprint 5 级 fallback（与 saveDraft helper 同套，简化版）：
  // sniffed → window.wx.commonData → window.cgiData → inline-script → outerHTML
  let fingerprint = sniffedFingerprint || "";
  let fingerprintSource = fingerprint ? "sniffed" : "";

  if (!fingerprint) {
    const wx = (
      window as unknown as {
        wx?: {
          commonData?: { fingerprint?: string; t?: string };
          fp?: { t?: string } | string;
        };
      }
    ).wx;
    if (wx?.commonData?.fingerprint) {
      fingerprint = wx.commonData.fingerprint;
      fingerprintSource = "window.wx.commonData.fingerprint";
    } else if (wx?.commonData?.t) {
      fingerprint = wx.commonData.t;
      fingerprintSource = "window.wx.commonData.t";
    } else if (typeof wx?.fp === "string") {
      fingerprint = wx.fp;
      fingerprintSource = "window.wx.fp(string)";
    } else if (typeof wx?.fp === "object" && wx.fp !== null && "t" in wx.fp) {
      fingerprint = wx.fp.t || "";
      fingerprintSource = "window.wx.fp.t";
    }
  }

  if (!fingerprint) {
    const html = document.documentElement.outerHTML;
    const m = html.match(/["']([a-f0-9]{32})["']/);
    if (m) {
      fingerprint = m[1];
      fingerprintSource = "outerHTML";
    }
  }

  const body = new URLSearchParams({
    imgurl: cdnUrl,
    size_count: "2",
    size0_x1: "0",
    size0_y1: "0",
    size0_x2: "1",
    size0_y2: "1",
    format0: "2.35_1",
    size1_x1: "0",
    size1_y1: "0",
    size1_x2: "1",
    size1_y2: "1",
    format1: "1_1",
    fingerprint,
    token,
    lang: "zh_CN",
    f: "json",
    ajax: "1",
  });

  try {
    const resp = await fetch("/cgi-bin/cropimage?action=crop_multi", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: body.toString(),
      credentials: "include",
    });
    const rawText = await resp.text();
    let data: {
      base_resp?: { ret?: number; err_msg?: string };
      result?: Array<{
        cdnurl?: string;
        file_id?: number | string;
        height?: number;
        width?: number;
      }>;
    } = {};
    try {
      data = JSON.parse(rawText);
    } catch {
      // not JSON
    }
    const ret = data.base_resp?.ret ?? -1;
    const result = data.result || [];
    const bodyPreview = rawText.slice(0, 400).replace(/\s+/g, " ");
    if (ret !== 0 || result.length < 2) {
      return {
        ok: false,
        cropFileId235: null,
        cropCdnUrl235: null,
        cropFileId1_1: null,
        cropCdnUrl1_1: null,
        fingerprintSource,
        bodyPreview,
      };
    }
    return {
      ok: true,
      cropFileId235:
        result[0].file_id != null ? String(result[0].file_id) : null,
      cropCdnUrl235: result[0].cdnurl || null,
      cropFileId1_1:
        result[1].file_id != null ? String(result[1].file_id) : null,
      cropCdnUrl1_1: result[1].cdnurl || null,
      fingerprintSource,
      bodyPreview,
    };
  } catch (err) {
    return {
      ok: false,
      cropFileId235: null,
      cropCdnUrl235: null,
      cropFileId1_1: null,
      cropCdnUrl1_1: null,
      fingerprintSource,
      bodyPreview: `error: ${(err as Error).message}`,
    };
  }
}
