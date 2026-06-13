import { BadRequestException } from "@nestjs/common";

/**
 * URL 验证和 SSRF 保护工具
 *
 * 防止服务端请求伪造（SSRF）攻击，阻止访问：
 * - 内网 IP（10.x.x.x, 172.16-31.x.x, 192.168.x.x）
 * - 本地回环（127.x.x.x, localhost）
 * - 特殊地址（0.0.0.0, 169.254.x.x 等）
 */

// 允许的协议
const ALLOWED_PROTOCOLS = ["http:", "https:"];

// 禁止的 IP 范围（CIDR 格式）
const BLOCKED_IP_PATTERNS = [
  // 私有 IP 地址
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  // 本地回环
  /^127\./,
  /^localhost$/i,
  // 链路本地
  /^169\.254\./,
  // 特殊地址
  /^0\./,
  /^224\./, // 多播
  /^240\./, // 保留
];

// 禁止的主机名
const BLOCKED_HOSTNAMES = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "[::0]",
  "metadata.google.internal", // GCP metadata
  "169.254.169.254", // AWS/Azure/GCP metadata
  "metadata.azure.com", // Azure metadata
];

// 最大 URL 长度
const MAX_URL_LENGTH = 2048;

/**
 * 验证 URL 是否安全可访问
 */
export function validateUrl(url: string): URL {
  // 1. 长度检查
  if (!url || url.length > MAX_URL_LENGTH) {
    throw new BadRequestException(
      `URL 过长或为空（最大 ${MAX_URL_LENGTH} 字符）`,
    );
  }

  // 2. 解析 URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new BadRequestException("无效的 URL 格式");
  }

  // 3. 协议检查
  if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
    throw new BadRequestException(
      `不支持的协议: ${parsedUrl.protocol}（仅支持 HTTP/HTTPS）`,
    );
  }

  // 4. 主机名检查
  const hostname = parsedUrl.hostname.toLowerCase();

  // 检查禁止的主机名
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    throw new BadRequestException("不允许访问内部服务地址");
  }

  // 检查禁止的 IP 模式
  for (const pattern of BLOCKED_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new BadRequestException("不允许访问内网 IP 地址");
    }
  }

  // 5. 检查 IPv6 格式
  if (hostname.startsWith("[") || hostname.includes(":")) {
    throw new BadRequestException("不支持 IPv6 地址");
  }

  // 6. 端口检查（可选：禁止非标准端口）
  const port = parsedUrl.port;
  if (port && !["80", "443", ""].includes(port)) {
    throw new BadRequestException(`不允许访问非标准端口: ${port}`);
  }

  return parsedUrl;
}

/**
 * 检查 URL 是否为已知的安全来源
 * 白名单模式，只允许特定域名
 */
export function isAllowedDomain(url: string): boolean {
  try {
    const parsedUrl = validateUrl(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    // 允许的域名列表
    const allowedDomains = [
      // 视频平台
      "youtube.com",
      "www.youtube.com",
      "youtu.be",
      "bilibili.com",
      "www.bilibili.com",
      // 社交媒体
      "twitter.com",
      "x.com",
      "weibo.com",
      "www.weibo.com",
      // 内容平台
      "medium.com",
      "substack.com",
      "zhihu.com",
      "www.zhihu.com",
      "juejin.cn",
      // 新闻媒体
      "bbc.com",
      "www.bbc.com",
      "cnn.com",
      "www.cnn.com",
      "reuters.com",
      "www.reuters.com",
      // 技术网站
      "github.com",
      "github.io",
      "stackoverflow.com",
      "dev.to",
      // 维基百科
      "wikipedia.org",
      "en.wikipedia.org",
      "zh.wikipedia.org",
    ];

    // 检查是否匹配允许的域名（支持子域名）
    return allowedDomains.some((domain) => {
      return hostname === domain || hostname.endsWith(`.${domain}`);
    });
  } catch {
    return false;
  }
}

/**
 * 验证并返回安全的 URL
 * 严格模式：只允许白名单域名
 */
export function validateUrlStrict(url: string): URL {
  const parsedUrl = validateUrl(url);

  if (!isAllowedDomain(url)) {
    throw new BadRequestException("该域名不在允许列表中，请联系管理员添加支持");
  }

  return parsedUrl;
}

/**
 * 内容长度限制常量
 */
export const CONTENT_LIMITS = {
  // 标题最大长度
  TITLE_MAX_LENGTH: 200,
  // 摘要最大长度
  DIGEST_MAX_LENGTH: 500,
  // 正文最大长度（不同平台有不同限制）
  // 注意：微信公众号正文无明确限制，但标题限64字节、摘要限120字
  CONTENT_MAX_LENGTH: {
    XIAOHONGSHU: 1000, // 小红书笔记最多1000字
    WEIBO: 2000,
    WECHAT: 50000, // 微信公众号正文无明确限制
    WECHAT_ARTICLE: 50000,
    TWITTER: 280,
    LINKEDIN: 3000,
    DEFAULT: 20000,
  },
  // 标题最大长度（按平台）
  TITLE_MAX_LENGTH_BY_PLATFORM: {
    WECHAT: 30, // 64字节 ≈ 32汉字，保守取30
    XIAOHONGSHU: 20,
    DEFAULT: 200,
  },
  // 摘要/描述最大长度（按平台）
  DIGEST_MAX_LENGTH_BY_PLATFORM: {
    WECHAT: 120,
    XIAOHONGSHU: 100,
    DEFAULT: 500,
  },
  // 标签数量限制
  MAX_TAGS: 20,
  // 单个标签最大长度
  TAG_MAX_LENGTH: 50,
  // 图片数量限制
  MAX_IMAGES: 9,
  // URL 最大长度
  URL_MAX_LENGTH: 2048,
} as const;

/**
 * 验证内容长度
 */
export function validateContentLength(
  content: string,
  platform?: string,
): void {
  const maxLength =
    CONTENT_LIMITS.CONTENT_MAX_LENGTH[
      (platform?.toUpperCase() as keyof typeof CONTENT_LIMITS.CONTENT_MAX_LENGTH) ||
        "DEFAULT"
    ] || CONTENT_LIMITS.CONTENT_MAX_LENGTH.DEFAULT;

  if (content && content.length > maxLength) {
    throw new BadRequestException(
      `内容超出${platform || ""}平台限制（最大 ${maxLength} 字符）`,
    );
  }
}

/**
 * 截断内容到安全长度
 */
export function truncateContent(content: string, platform?: string): string {
  const maxLength =
    CONTENT_LIMITS.CONTENT_MAX_LENGTH[
      (platform?.toUpperCase() as keyof typeof CONTENT_LIMITS.CONTENT_MAX_LENGTH) ||
        "DEFAULT"
    ] || CONTENT_LIMITS.CONTENT_MAX_LENGTH.DEFAULT;

  if (content && content.length > maxLength) {
    return content.slice(0, maxLength - 3) + "...";
  }
  return content;
}
