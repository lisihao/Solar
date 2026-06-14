/**
 * 前端 YouTube 字幕提取工具
 *
 * 设计思路：
 * 1. 用户浏览器不会被 YouTube 封锁（普通住宅 IP）
 * 2. 通过 YouTube 的 timedtext API 直接获取字幕
 * 3. 获取成功后上传到服务器缓存，供其他用户使用
 *
 * 注意：由于 CORS 限制，需要通过后端代理请求
 */

import { logger } from '@/lib/utils/logger';

export interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

export interface TranscriptResult {
  videoId: string;
  title?: string;
  transcript: TranscriptSegment[];
  language: string;
  source: 'cache' | 'server' | 'client';
}

/**
 * 解析 YouTube timedtext XML 格式
 */
function parseTimedTextXML(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  // 匹配 <text start="..." dur="...">...</text>
  const textPattern =
    /<text[^>]*\bstart=["']?([\d.]+)["']?[^>]*\bdur=["']?([\d.]+)["']?[^>]*>([^<]*)<\/text>/gi;

  let match;
  while ((match = textPattern.exec(xml)) !== null) {
    const start = parseFloat(match[1]);
    const duration = parseFloat(match[2]);
    // 解码 HTML 实体
    const text = decodeHTMLEntities(match[3].trim());

    if (text) {
      segments.push({ start, duration, text });
    }
  }

  // 尝试另一种属性顺序
  if (segments.length === 0) {
    const altPattern =
      /<text[^>]*\bdur=["']?([\d.]+)["']?[^>]*\bstart=["']?([\d.]+)["']?[^>]*>([^<]*)<\/text>/gi;
    while ((match = altPattern.exec(xml)) !== null) {
      const duration = parseFloat(match[1]);
      const start = parseFloat(match[2]);
      const text = decodeHTMLEntities(match[3].trim());

      if (text) {
        segments.push({ start, duration, text });
      }
    }
  }

  return segments;
}

/**
 * 解码 HTML 实体
 */
function decodeHTMLEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&#x27;': "'",
    '&#x2F;': '/',
    '&#32;': ' ',
    '&nbsp;': ' ',
  };

  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity, 'gi'), char);
  }

  // 处理数字实体 &#NNN;
  result = result.replace(/&#(\d+);/g, (_, code) =>
    String.fromCharCode(parseInt(code, 10))
  );

  // 处理十六进制实体 &#xHHH;
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
    String.fromCharCode(parseInt(code, 16))
  );

  return result;
}

/**
 * 从 YouTube 视频页面 HTML 中提取字幕 track 信息
 */
function extractCaptionTracksFromHTML(html: string): Array<{
  baseUrl: string;
  languageCode: string;
  name: string;
}> {
  const tracks: Array<{ baseUrl: string; languageCode: string; name: string }> =
    [];

  try {
    // 查找 ytInitialPlayerResponse
    const playerResponseMatch = html.match(
      /ytInitialPlayerResponse\s*=\s*({.+?});/s
    );
    if (!playerResponseMatch) return tracks;

    const playerResponse = JSON.parse(playerResponseMatch[1]);
    const captionTracks =
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (Array.isArray(captionTracks)) {
      for (const track of captionTracks) {
        if (track.baseUrl && track.languageCode) {
          tracks.push({
            baseUrl: track.baseUrl,
            languageCode: track.languageCode,
            name: track.name?.simpleText || track.languageCode,
          });
        }
      }
    }
  } catch (e) {
    logger.warn('Failed to extract caption tracks from HTML:', e);
  }

  return tracks;
}

/**
 * 从 YouTube 视频页面 HTML 中提取视频标题
 */
function extractVideoTitleFromHTML(html: string): string | null {
  try {
    // 方法1: 从 ytInitialPlayerResponse 提取
    const playerResponseMatch = html.match(
      /ytInitialPlayerResponse\s*=\s*({.+?});/s
    );
    if (playerResponseMatch) {
      const playerResponse = JSON.parse(playerResponseMatch[1]);
      const title = playerResponse?.videoDetails?.title;
      if (title) return title;
    }

    // 方法2: 从 meta 标签提取
    const metaMatch = html.match(/<meta\s+name="title"\s+content="([^"]+)"/i);
    if (metaMatch) return decodeHTMLEntities(metaMatch[1]);

    // 方法3: 从 og:title 提取
    const ogMatch = html.match(
      /<meta\s+property="og:title"\s+content="([^"]+)"/i
    );
    if (ogMatch) return decodeHTMLEntities(ogMatch[1]);
  } catch (e) {
    logger.warn('Failed to extract video title:', e);
  }

  return null;
}

/**
 * 客户端直接从 YouTube 获取字幕
 * 通过后端代理请求来绕过 CORS
 */
export async function fetchTranscriptFromClient(
  videoId: string,
  apiBaseUrl: string,
  preferredLang: string = 'en'
): Promise<TranscriptResult | null> {
  try {
    // 调用后端的代理 API
    const response = await fetch(
      `${apiBaseUrl}/api/v1/youtube/client-fetch/${videoId}?lang=${preferredLang}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      logger.warn(`Client fetch failed: ${response.status}`);
      return null;
    }

    const result = await response.json();
    // API returns { success, data: { transcript, title, language } } format
    const data = result?.data ?? result;

    if (data.transcript && data.transcript.length > 0) {
      return {
        videoId,
        title: data.title,
        transcript: data.transcript,
        language: data.language || preferredLang,
        source: 'client',
      };
    }

    return null;
  } catch (error) {
    logger.error('Client transcript fetch error:', error);
    return null;
  }
}

export interface TranslatedSegment extends TranscriptSegment {
  translatedText: string;
}

/**
 * 上传翻译结果到服务器缓存（全局共享，所有用户复用）
 * 注意：调用前后端要求该 videoId 的原始字幕已通过 uploadTranscriptToCache 入库
 */
export async function saveTranslationToCache(
  videoId: string,
  translatedTranscript: TranslatedSegment[],
  targetLanguage: string,
  apiBaseUrl: string
): Promise<boolean> {
  if (!translatedTranscript.length) return true;
  try {
    const response = await fetch(
      `${apiBaseUrl}/api/v1/youtube/save-translation`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          translatedTranscript,
          targetLanguage,
        }),
      }
    );
    return response.ok;
  } catch (error) {
    logger.error('Failed to save translation to cache:', error);
    return false;
  }
}

/**
 * 查询某视频是否已有保存的翻译
 */
export async function getTranslationStatus(
  videoId: string,
  apiBaseUrl: string
): Promise<{ hasTranslation: boolean; targetLanguage?: string }> {
  try {
    const response = await fetch(
      `${apiBaseUrl}/api/v1/youtube/translation-status/${videoId}`
    );
    if (!response.ok) return { hasTranslation: false };
    const result = await response.json();
    const data = result?.data ?? result;
    return {
      hasTranslation: !!data?.hasTranslation,
      targetLanguage: data?.targetLanguage,
    };
  } catch (error) {
    logger.warn('Failed to get translation status:', error);
    return { hasTranslation: false };
  }
}

/**
 * 拉取已保存的翻译（双语对齐）
 * 复用 /youtube/subtitles，命中保存翻译时其 chinese 字段会被自动填充
 */
export async function fetchSavedTranslation(
  videoId: string,
  apiBaseUrl: string
): Promise<TranscriptSegment[] | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/youtube/subtitles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    });
    if (!response.ok) return null;
    const result = await response.json();
    const data = result?.data ?? result;
    if (!data?.hasTranslation || !Array.isArray(data?.chinese)) return null;
    return data.chinese as TranscriptSegment[];
  } catch (error) {
    logger.warn('Failed to fetch saved translation:', error);
    return null;
  }
}

/**
 * 上传字幕到服务器缓存
 */
export async function uploadTranscriptToCache(
  videoId: string,
  title: string,
  transcript: TranscriptSegment[],
  language: string,
  apiBaseUrl: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `${apiBaseUrl}/api/v1/youtube/cache-transcript`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoId,
          title,
          transcript,
          language,
        }),
      }
    );

    return response.ok;
  } catch (error) {
    logger.error('Failed to upload transcript to cache:', error);
    return false;
  }
}

/**
 * 智能获取字幕：先服务器，失败则客户端获取并缓存
 */
export async function fetchTranscriptSmart(
  videoId: string,
  apiBaseUrl: string,
  preferredLang: string = 'en',
  onStatusChange?: (status: string) => void
): Promise<TranscriptResult | null> {
  // 1. 先尝试从服务器获取（可能命中缓存或服务端能获取成功）
  onStatusChange?.('正在从服务器获取字幕...');

  try {
    const serverResponse = await fetch(
      `${apiBaseUrl}/api/v1/youtube/transcript/${videoId}`
    );

    if (serverResponse.ok) {
      const result = await serverResponse.json();
      // API returns { success, data: { transcript, title, fromCache } } format
      const data = result?.data ?? result;
      if (
        data.transcript &&
        Array.isArray(data.transcript) &&
        data.transcript.length > 0
      ) {
        onStatusChange?.('已从服务器获取字幕');
        return {
          videoId,
          title: data.title,
          transcript: data.transcript,
          language: preferredLang,
          source: data.fromCache ? 'cache' : 'server',
        };
      }
    }
  } catch (e) {
    logger.warn('Server fetch failed, trying client fetch:', e);
  }

  // 2. 服务器失败，尝试客户端获取
  onStatusChange?.('服务器获取失败，正在通过客户端获取...');

  const clientResult = await fetchTranscriptFromClient(
    videoId,
    apiBaseUrl,
    preferredLang
  );

  if (clientResult && clientResult.transcript.length > 0) {
    onStatusChange?.('已从客户端获取字幕，正在缓存...');

    // 3. 上传到服务器缓存
    const cached = await uploadTranscriptToCache(
      videoId,
      clientResult.title || `YouTube Video ${videoId}`,
      clientResult.transcript,
      clientResult.language,
      apiBaseUrl
    );

    if (cached) {
      onStatusChange?.('字幕已缓存到服务器');
    }

    return clientResult;
  }

  onStatusChange?.('无法获取字幕');
  return null;
}
