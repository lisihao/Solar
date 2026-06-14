import { Injectable } from "@nestjs/common";
import { InfographicStyle, FontStyle, StylePreset } from "../types";
import { APP_CONFIG } from "../../../../../common/config/app.config";

/**
 * 数据处理服务
 * 负责：数据格式化、文本处理、常量管理
 */
@Injectable()
export class InfographicDataService {
  // 预设风格配置
  private readonly STYLE_PRESETS: Record<InfographicStyle, StylePreset> = {
    consulting: {
      colors: {
        primary: "#1e3a5f",
        accent: "#0891b2",
        background: "#f8fafc",
        text: "#334155",
      },
      font: "'Noto Sans SC', 'Microsoft YaHei', sans-serif",
      borderRadius: 12,
      shadow: "0 2px 8px rgba(0,0,0,0.06)",
    },
    tech: {
      colors: {
        primary: "#6366f1",
        accent: "#22d3ee",
        background: "#f0f9ff",
        text: "#1e293b",
      },
      font: "'Inter', 'Noto Sans SC', sans-serif",
      borderRadius: 16,
      shadow: "0 4px 20px rgba(99,102,241,0.15)",
    },
    minimal: {
      colors: {
        primary: "#18181b",
        accent: "#a1a1aa",
        background: "#ffffff",
        text: "#3f3f46",
      },
      font: "'Noto Sans SC', 'Helvetica Neue', sans-serif",
      borderRadius: 4,
      shadow: "none",
    },
    creative: {
      colors: {
        primary: "#ec4899",
        accent: "#f59e0b",
        background: "#fdf4ff",
        text: "#581c87",
      },
      font: "'Noto Sans SC', 'Comic Sans MS', sans-serif",
      borderRadius: 24,
      shadow: "0 8px 30px rgba(236,72,153,0.2)",
    },
    dark: {
      colors: {
        primary: "#e2e8f0",
        accent: "#38bdf8",
        background: "#0f172a",
        text: "#cbd5e1",
      },
      font: "'Noto Sans SC', 'Segoe UI', sans-serif",
      borderRadius: 12,
      shadow: "0 4px 20px rgba(0,0,0,0.4)",
    },
    academic: {
      colors: {
        primary: "#1e40af",
        accent: "#059669",
        background: "#fffbeb",
        text: "#1f2937",
      },
      font: "'Noto Serif SC', 'Times New Roman', serif",
      borderRadius: 2,
      shadow: "0 1px 3px rgba(0,0,0,0.1)",
    },
    business: {
      colors: {
        primary: "#374151",
        accent: "#3b82f6",
        background: "#f9fafb",
        text: "#111827",
      },
      font: "'Noto Sans SC', 'Segoe UI', sans-serif",
      borderRadius: 8,
      shadow: "0 1px 2px rgba(0,0,0,0.05)",
    },
    genspark: {
      colors: {
        primary: "#0A2B4E",
        accent: "#3B82F6",
        background: "#0A2B4E",
        text: "#E5E7EB",
      },
      font: "'Noto Sans SC', 'Inter', sans-serif",
      borderRadius: 12,
      shadow: "0 8px 32px rgba(0,0,0,0.3)",
    },
    tech_gradient: {
      colors: {
        primary: "#6366F1",
        accent: "#8B5CF6",
        background: "#0F172A",
        text: "#F1F5F9",
      },
      font: "'Inter', 'Noto Sans SC', sans-serif",
      borderRadius: 16,
      shadow: "0 12px 40px rgba(99,102,241,0.25)",
    },
  };

  // 字体映射
  private readonly FONT_STYLES: Record<FontStyle, string> = {
    sans: "'Noto Sans SC', 'Microsoft YaHei', 'PingFang SC', sans-serif",
    serif: "'Noto Serif SC', 'SimSun', 'Times New Roman', serif",
    mono: "'JetBrains Mono', 'Noto Sans SC', 'Consolas', monospace",
    rounded: "'Nunito', 'Noto Sans SC', 'Comic Sans MS', sans-serif",
  };

  // 图标SVG映射
  private readonly ICONS: Record<string, string> = {
    target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
    chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>`,
    briefcase: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>`,
    shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    lightbulb: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 019 14"/></svg>`,
    gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
    users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
    trending: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>`,
    star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>`,
  };

  private readonly DEFAULT_ICON = this.ICONS.star;

  /**
   * 获取风格预设
   */
  getStylePreset(style: InfographicStyle): StylePreset {
    return this.STYLE_PRESETS[style] || this.STYLE_PRESETS.consulting;
  }

  /**
   * 获取字体样式
   */
  getFontStyle(fontStyle: FontStyle): string {
    return this.FONT_STYLES[fontStyle] || this.FONT_STYLES.sans;
  }

  /**
   * 获取图标 SVG
   */
  getIcon(type?: string): string {
    if (!type) return this.DEFAULT_ICON;
    const normalized = type.toLowerCase().replace(/[^a-z]/g, "");
    return this.ICONS[normalized] || this.DEFAULT_ICON;
  }

  /**
   * 获取品牌名称
   */
  getBrandName(): string {
    return APP_CONFIG.brand.name;
  }

  /**
   * 获取品牌全称
   */
  getBrandFullName(): string {
    return APP_CONFIG.brand.fullName;
  }

  /**
   * 获取卡片渐变色数组
   */
  getCardGradients(): string[] {
    return [
      "linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)", // 蓝色
      "linear-gradient(135deg, #10B981 0%, #059669 100%)", // 绿色
      "linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)", // 紫色
      "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)", // 橙色
      "linear-gradient(135deg, #EF4444 0%, #DC2626 100%)", // 红色
      "linear-gradient(135deg, #06B6D4 0%, #0891B2 100%)", // 青色
    ];
  }

  /**
   * HTML 转义
   */
  escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * 文本截断
   */
  truncateText(text: string, _maxLength: number): string {
    // 智能截断：保留完整单词/词组
    // 中文按字符，英文按单词
    // 当前简化：直接返回原文，由CSS处理
    return text;
  }

  /**
   * 调整颜色亮度
   */
  adjustColor(hex: string, amount: number): string {
    const num = parseInt(hex.replace("#", ""), 16);
    const r = Math.max(0, Math.min(255, (num >> 16) + amount));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amount));
    const b = Math.max(0, Math.min(255, (num & 0x0000ff) + amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  }
}
