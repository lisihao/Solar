/**
 * 应用配置
 * ★ 统一管理环境变量、品牌名称、URL 等配置
 */

// ==================== 核心品牌配置（环境变量优先）====================
const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME || 'GenesisPod';
const BRAND_FULL_NAME = process.env.NEXT_PUBLIC_BRAND_FULL_NAME || 'GenesisPod';
const BRAND_SUBTITLE = process.env.NEXT_PUBLIC_BRAND_SUBTITLE || '';
const BRAND_TAGLINE =
  process.env.NEXT_PUBLIC_BRAND_TAGLINE || 'AI-Powered Research Platform';
const RAILWAY_DOMAIN = process.env.NEXT_PUBLIC_RAILWAY_DOMAIN || 'genesis-ai';

// ==================== Railway URL 配置 ====================
const RAILWAY_FRONTEND_URL = `https://${RAILWAY_DOMAIN}.up.railway.app`;
const RAILWAY_BACKEND_URL = `https://${RAILWAY_DOMAIN}-backend.up.railway.app`;

// 检测是否在浏览器环境
const isBrowser = () => typeof window !== 'undefined';

// 检测是否在 Railway 生产环境（通过检查当前域名）
const isRailwayProduction = () => {
  if (isBrowser()) {
    return window.location.hostname.includes('railway.app');
  }
  return process.env.RAILWAY_ENVIRONMENT === 'production';
};

// 获取正确的 API 基础 URL
// Railway 生产环境直连后端（绕过 Fastly CDN 代理）
// 本地开发使用相对 URL（利用 Next.js rewrites 代理）
const getApiBaseUrl = () => {
  if (isBrowser()) {
    // Railway 生产环境：直连后端，绕过 CDN 代理
    // Railway 的 Fastly CDN 在高负载时会触发限流（"Pop visit count exceeded"），
    // 导致所有经过 CDN 的请求返回 503。直连后端更稳定可靠。
    // 后端 CORS 已正确配置，允许前端域名跨域访问。
    if (isRailwayProduction()) {
      return RAILWAY_BACKEND_URL;
    }
    // 本地开发：使用相对 URL，让 Next.js rewrites 代理请求到后端
    return '';
  }

  // 服务端渲染时需要完整 URL
  // 1. 优先使用环境变量
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  // 2. Railway 生产环境使用后端 URL
  if (isRailwayProduction()) {
    return RAILWAY_BACKEND_URL;
  }
  // 3. 开发环境默认 localhost
  return 'http://localhost:4000';
};

export const config = {
  // ==================== 品牌信息 ====================
  brand: {
    /** 品牌简称 */
    name: BRAND_NAME,
    /** 品牌全称 */
    fullName: BRAND_FULL_NAME,
    /** 品牌副标题（Logo 下方小字） */
    subtitle: BRAND_SUBTITLE,
    /** 品牌标语 */
    tagline: BRAND_TAGLINE,
    /** HTTP User-Agent */
    userAgent: `${BRAND_NAME}-AI-Engine/1.0`,
    /** Logo 路径 */
    logo: {
      path: process.env.NEXT_PUBLIC_BRAND_LOGO_PATH || '/favicon.svg',
      faviconPath: process.env.NEXT_PUBLIC_BRAND_FAVICON_PATH || '/favicon.svg',
    },
    /** 默认邮件发送者 */
    emailFrom:
      process.env.NEXT_PUBLIC_BRAND_EMAIL_FROM ||
      `${BRAND_NAME} <noreply@${BRAND_NAME.toLowerCase()}.ai>`,
    /** 联系邮箱 */
    contactEmail:
      process.env.NEXT_PUBLIC_BRAND_CONTACT_EMAIL || 'hello@gens.team',
    /** GitHub Issues URL */
    githubIssuesUrl:
      process.env.NEXT_PUBLIC_BRAND_GITHUB_ISSUES_URL ||
      'https://github.com/genesis-agents/GenesisPod/issues',
  },

  // ==================== Railway URL 配置 ====================
  railway: {
    /** Railway 域名前缀 */
    domain: RAILWAY_DOMAIN,
    /** 前端 Railway URL */
    frontendUrl: RAILWAY_FRONTEND_URL,
    /** 后端 Railway URL */
    backendUrl: RAILWAY_BACKEND_URL,
  },

  // ==================== API 配置 ====================
  /**
   * API版本
   */
  apiVersion: process.env.NEXT_PUBLIC_API_VERSION || 'v1',

  /**
   * API基础URL (getter，每次访问重新计算)
   * Railway 生产环境返回直连后端 URL（绕过 CDN）
   * 本地开发返回空字符串（使用相对 URL + Next.js proxy）
   */
  get apiBaseUrl() {
    return getApiBaseUrl();
  },

  /**
   * 完整API URL前缀
   */
  get apiUrl() {
    return `${this.apiBaseUrl}/api/${this.apiVersion}`;
  },

  /**
   * 获取后端 API URL（用于服务端调用）
   * 优先使用环境变量，否则使用 Railway 默认值
   */
  getBackendUrl(): string {
    return process.env.NEXT_PUBLIC_API_URL || RAILWAY_BACKEND_URL;
  },

  /**
   * 获取完整 API 路径
   */
  getApiPath(path: string): string {
    return `${this.getBackendUrl()}/api/v1${path}`;
  },

  /**
   * 获取 SSE 流式请求的直连 API URL（绕过 Next.js rewrites 代理）
   * Next.js rewrites 会缓冲整个响应体，导致 SSE 实时流无法工作。
   * 此方法返回直连后端的完整 URL，用于 SSE fetch 请求。
   */
  get streamApiUrl(): string {
    if (isBrowser()) {
      // 浏览器端 Railway 公网直连，绕 CDN 缓冲
      if (isRailwayProduction()) {
        return `${RAILWAY_BACKEND_URL}/api/${this.apiVersion}`;
      }
      // ★ 2026-05-27 真根因 fix (Screenshot_86 "Failed to fetch"):
      //   原 fallback "http://localhost:4000" 烤死在 client bundle 后,
      //   onprem 部署 (无论本地 docker 或远端服务器) 都让浏览器去自己的 localhost
      //   :4000 找后端 → 找不到 → fail。所有 NEXT_PUBLIC_API_URL 未注入的部署
      //   都中招。改用 same-origin '' 让请求走 frontend 同源 → middleware
      //   实时 rewrite 到 API_INTERNAL_URL。SSE 也兼容 (Next.js middleware
      //   NextResponse.rewrite 不缓冲)。
      const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
      return `${apiBase}/api/${this.apiVersion}`;
    }
    // 服务端：与 apiUrl 相同
    return this.apiUrl;
  },

  // ==================== 环境配置 ====================
  /**
   * Workspace AI v2 开启状态
   */
  get workspaceAiV2Enabled() {
    const value =
      process.env.NEXT_PUBLIC_WORKSPACE_AI_V2_ENABLED ??
      process.env.WORKSPACE_AI_V2_ENABLED ??
      'false';
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  },

  /**
   * 环境标识
   */
  env: process.env.NEXT_PUBLIC_ENV || process.env.NODE_ENV || 'development',

  /**
   * 是否开发环境
   */
  get isDevelopment() {
    return this.env === 'development';
  },

  /**
   * 是否生产环境
   */
  get isProduction() {
    return this.env === 'production';
  },

  /**
   * 是否 Railway 环境
   */
  get isRailway() {
    return isRailwayProduction();
  },

  // ==================== 构建信息 ====================
  /**
   * Git commit hash (构建时注入)
   */
  gitCommitHash: process.env.NEXT_PUBLIC_GIT_COMMIT_HASH || 'dev',

  /**
   * Git commit hash 完整版 (构建时注入)
   */
  gitCommitHashFull: process.env.NEXT_PUBLIC_GIT_COMMIT_HASH_FULL || 'dev',

  /**
   * 构建时间 (构建时注入)
   */
  buildTime: process.env.NEXT_PUBLIC_BUILD_TIME || new Date().toISOString(),
} as const;

// 导出便捷常量
export const BRAND = config.brand;
export const RAILWAY_URLS = config.railway;
