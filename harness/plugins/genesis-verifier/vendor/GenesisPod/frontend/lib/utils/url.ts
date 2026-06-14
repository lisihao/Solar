/**
 * URL 安全工具 —— 渲染用户/第三方来源 URL 为 <a href> 前必须校验协议，
 * 防 javascript: / data: 等伪协议 XSS（CWE-79）。
 */

/** 仅允许 http/https 的可点击链接；非法/非字符串返回 false */
export function isSafeHttpUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url) return false;
  try {
    const p = new URL(url);
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch {
    return false;
  }
}
