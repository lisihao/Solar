const PRIVATE_HOST_REGEX =
  /^(?:localhost|127\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1|fe80:)/i;

/**
 * SSRF 防护：拒绝内网 / 私有 IP / loopback / 非 http(s) 协议。
 *
 * 局限：hostname 字符串匹配，未做 DNS rebinding 二次解析（生产场景应在出站
 * HTTP 层再做一次 IP 解析校验；本工具仅作 host-string 黑名单兜底）。
 */
export function assertSafeHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`非法 URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL 必须是 http:// 或 https://");
  }
  if (PRIVATE_HOST_REGEX.test(parsed.hostname)) {
    throw new Error("禁止使用内网 / 私有 IP / loopback 地址");
  }
}
