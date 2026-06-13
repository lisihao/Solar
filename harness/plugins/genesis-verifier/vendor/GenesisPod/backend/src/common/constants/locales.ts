/**
 * locales —— 项目唯一支持的 locale 白名单（PR-DR1b R2 reuse 整改）
 *
 * 来源：daily-briefing-redesign-2026-05-18.md §10.1 K6 i18n
 *
 * 单一真值源：
 * - DTO @IsIn(SUPPORTED_LOCALES)（应用层校验）
 * - DB CHECK users_locale_whitelist_chk（兜底）
 * - 前端 brand/config（展示侧；通过 backend api response 拿）
 *
 * 加新语言：本表加值 + 同步 migration CHECK 约束 + 跑回归。
 */

export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** 邮件 subject 998 字截断（RFC 5322 §2.1.1）—— 跨 EmailChannel / EmailSenderTool 共用 */
export const EMAIL_SUBJECT_MAX_LENGTH = 998;
