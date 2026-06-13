import { ConfigService } from "@nestjs/config";
import { APP_CONFIG } from "../../../../../common/config/app.config";

/**
 * preset-shared —— PR-DR1b R2 reuse 整改：抽掉三个 preset 的重复辅助
 *
 * 历史包袱：mission-completion / feedback-status-update / radar-mission-complete
 * 三处独立 inline 定义了 escapeHtml、appUrl 拼接、`[brand] ...` 主题前缀。
 * R2 reuse 路评审标 P0：必须单源，避免后续加 preset 时继续复制。
 *
 * 本文件仅提供"邮件相关"纯函数 / 小工具，不持有状态、不感知 channel 实现。
 */

const SUBJECT_BRAND_PREFIX = `[${APP_CONFIG.brand.name}]`;

/**
 * HTML 转义 5 类元字符（& < > " '）—— 防 stored XSS 在邮件 HTML 渲染时执行
 * 输入若不是 string（脏数据），优先 String() 强转再转义，避免 .replace 报 TypeError
 */
export function escapeHtml(value: unknown): string {
  const s = typeof value === "string" ? value : String(value ?? "");
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 构造邮件 subject 统一前缀：`[BrandName] <user-title>`
 * 不做 CRLF strip（由 EmailChannel adapter 兜底，避免双层 sanitize 抹掉合法空格）
 */
export function buildBrandSubject(subtitle: string): string {
  return `${SUBJECT_BRAND_PREFIX} ${subtitle}`;
}

/**
 * 解析 reportUrl：相对路径自动拼 APP_URL；http(s):// 开头视为绝对路径直接返回
 * APP_URL 默认 http://localhost:3000（同其它 module 历史默认值）
 */
export function buildAppUrl(config: ConfigService, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = config.get<string>("APP_URL", "http://localhost:3000");
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}
