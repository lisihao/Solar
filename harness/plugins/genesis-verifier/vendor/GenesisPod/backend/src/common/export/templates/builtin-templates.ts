/**
 * 统一导出系统 - 内置模板定义
 */

import {
  ExportFormat,
  ExportSourceType,
  ExportTemplateCategory,
} from "@prisma/client";
import { ThemeConfig, LayoutConfig } from "../types/theme-config";

export interface BuiltInTemplate {
  id: string;
  name: string;
  description: string;
  category: ExportTemplateCategory;
  themeConfig: ThemeConfig;
  layoutConfig: LayoutConfig;
  supportedFormats: ExportFormat[];
  supportedSources: ExportSourceType[];
  isDefault?: boolean;
}

/**
 * 专业报告模板
 */
const professionalReportTheme: ThemeConfig = {
  colors: {
    primary: "#1a365d",
    secondary: "#2b6cb0",
    accent: "#3182ce",
    background: "#ffffff",
    backgroundAlt: "#f7fafc",
    text: "#2d3748",
    textLight: "#718096",
    textSecondary: "#a0aec0",
    heading: "#1a202c",
    link: "#2b6cb0",
    border: "#e2e8f0",
    divider: "#edf2f7",
    success: "#38a169",
    warning: "#d69e2e",
    error: "#e53e3e",
    info: "#3182ce",
  },
  fonts: {
    heading: {
      family:
        "Inter, 'Microsoft YaHei', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif",
      size: 24,
      weight: 700,
      lineHeight: 1.3,
    },
    body: {
      family:
        "Inter, 'Microsoft YaHei', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif",
      size: 14,
      weight: 400,
      lineHeight: 1.7,
    },
    mono: {
      family: "JetBrains Mono, Consolas, monospace",
      size: 13,
      weight: 400,
      lineHeight: 1.5,
    },
  },
  spacing: {
    page: { top: 72, right: 72, bottom: 72, left: 72 },
    section: 28,
    paragraph: 14,
    list: 10,
    heading: 20,
  },
  decorations: {
    showHeaderLine: false,
    showFooterLine: false,
    showPageNumbers: true,
    pageNumberPosition: "bottom-center",
    headingUnderline: true,
    headingBorder: false,
    showTableBorders: true,
    roundedCorners: true,
    shadowEffects: false,
  },
};

const professionalReportLayout: LayoutConfig = {
  pageSize: "A4",
  orientation: "portrait",
  cover: {
    enabled: true,
    style: "standard",
    showLogo: true,
    showDate: true,
    showAuthor: true,
  },
  header: {
    enabled: false,
    height: 40,
    showOnFirstPage: false,
  },
  footer: {
    enabled: true,
    height: 40,
    showOnFirstPage: false,
  },
  sections: {
    startOnNewPage: false,
    numberHeadings: true,
    indentLevel: 0,
  },
};

/**
 * 深度研究报告模板
 */
const deepResearchTheme: ThemeConfig = {
  colors: {
    primary: "#7c3aed",
    secondary: "#8b5cf6",
    accent: "#a78bfa",
    background: "#ffffff",
    backgroundAlt: "#faf5ff",
    text: "#1f2937",
    textLight: "#6b7280",
    textSecondary: "#9ca3af",
    heading: "#111827",
    link: "#7c3aed",
    border: "#e5e7eb",
    divider: "#f3f4f6",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
    info: "#6366f1",
  },
  fonts: {
    heading: {
      family:
        "Inter, 'Microsoft YaHei', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif",
      size: 26,
      weight: 700,
      lineHeight: 1.25,
    },
    body: {
      family:
        "Inter, 'Microsoft YaHei', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif",
      size: 14,
      weight: 400,
      lineHeight: 1.75,
    },
    mono: {
      family: "JetBrains Mono, Consolas, monospace",
      size: 13,
      weight: 400,
      lineHeight: 1.5,
    },
  },
  spacing: {
    page: { top: 64, right: 64, bottom: 64, left: 64 },
    section: 32,
    paragraph: 16,
    list: 12,
    heading: 24,
  },
  decorations: {
    showHeaderLine: false,
    showFooterLine: false,
    showPageNumbers: true,
    pageNumberPosition: "bottom-center",
    headingUnderline: false,
    headingBorder: true,
    showTableBorders: true,
    roundedCorners: true,
    shadowEffects: true,
  },
};

const deepResearchLayout: LayoutConfig = {
  pageSize: "A4",
  orientation: "portrait",
  cover: {
    enabled: true,
    style: "prominent",
    showLogo: false,
    showDate: true,
    showAuthor: false,
  },
  header: {
    enabled: false,
    height: 40,
    showOnFirstPage: false,
  },
  footer: {
    enabled: true,
    height: 40,
    showOnFirstPage: false,
  },
  sections: {
    startOnNewPage: false,
    numberHeadings: true,
    indentLevel: 0,
  },
};

/**
 * 简约风格模板
 */
const minimalTheme: ThemeConfig = {
  colors: {
    primary: "#000000",
    secondary: "#333333",
    accent: "#666666",
    background: "#ffffff",
    backgroundAlt: "#fafafa",
    text: "#333333",
    textLight: "#666666",
    textSecondary: "#999999",
    heading: "#000000",
    link: "#000000",
    border: "#eeeeee",
    divider: "#f5f5f5",
    success: "#4caf50",
    warning: "#ff9800",
    error: "#f44336",
    info: "#2196f3",
  },
  fonts: {
    heading: {
      family: "Georgia, serif",
      size: 22,
      weight: 400,
      lineHeight: 1.4,
    },
    body: {
      family: "Georgia, serif",
      size: 14,
      weight: 400,
      lineHeight: 1.8,
    },
    mono: {
      family: "Menlo, monospace",
      size: 13,
      weight: 400,
      lineHeight: 1.5,
    },
  },
  spacing: {
    page: { top: 80, right: 80, bottom: 80, left: 80 },
    section: 36,
    paragraph: 18,
    list: 12,
    heading: 24,
  },
  decorations: {
    showHeaderLine: false,
    showFooterLine: false,
    showPageNumbers: true,
    pageNumberPosition: "bottom-center",
    headingUnderline: false,
    headingBorder: false,
    showTableBorders: false,
    roundedCorners: false,
    shadowEffects: false,
  },
};

const minimalLayout: LayoutConfig = {
  pageSize: "A4",
  orientation: "portrait",
  cover: {
    enabled: true,
    style: "minimal",
    showLogo: false,
    showDate: true,
    showAuthor: true,
  },
  header: {
    enabled: false,
    height: 40,
    showOnFirstPage: false,
  },
  footer: {
    enabled: true,
    height: 40,
    showOnFirstPage: false,
  },
  sections: {
    startOnNewPage: false,
    numberHeadings: false,
    indentLevel: 0,
  },
};

/**
 * 学术论文模板
 */
const academicTheme: ThemeConfig = {
  colors: {
    primary: "#1a1a2e",
    secondary: "#16213e",
    accent: "#0f3460",
    background: "#ffffff",
    backgroundAlt: "#f8f9fa",
    text: "#212529",
    textLight: "#6c757d",
    textSecondary: "#adb5bd",
    heading: "#1a1a2e",
    link: "#0f3460",
    border: "#dee2e6",
    divider: "#e9ecef",
    success: "#28a745",
    warning: "#ffc107",
    error: "#dc3545",
    info: "#17a2b8",
  },
  fonts: {
    heading: {
      family: "Times New Roman, serif",
      size: 18,
      weight: 700,
      lineHeight: 1.4,
    },
    body: {
      family: "Times New Roman, serif",
      size: 12,
      weight: 400,
      lineHeight: 2.0,
    },
    mono: {
      family: "Courier New, monospace",
      size: 11,
      weight: 400,
      lineHeight: 1.5,
    },
  },
  spacing: {
    page: { top: 72, right: 72, bottom: 72, left: 72 },
    section: 24,
    paragraph: 12,
    list: 8,
    heading: 18,
  },
  decorations: {
    showHeaderLine: false,
    showFooterLine: false,
    showPageNumbers: true,
    pageNumberPosition: "bottom-center",
    headingUnderline: false,
    headingBorder: false,
    showTableBorders: true,
    roundedCorners: false,
    shadowEffects: false,
  },
};

const academicLayout: LayoutConfig = {
  pageSize: "A4",
  orientation: "portrait",
  cover: {
    enabled: true,
    style: "standard",
    showLogo: false,
    showDate: true,
    showAuthor: true,
  },
  header: {
    enabled: true,
    height: 40,
    showOnFirstPage: false,
  },
  footer: {
    enabled: true,
    height: 40,
    showOnFirstPage: false,
  },
  sections: {
    startOnNewPage: false,
    numberHeadings: true,
    indentLevel: 0,
  },
};

/**
 * 企业演示模板
 */
const corporatePptTheme: ThemeConfig = {
  colors: {
    primary: "#2563eb",
    secondary: "#3b82f6",
    accent: "#60a5fa",
    background: "#ffffff",
    backgroundAlt: "#f1f5f9",
    text: "#1e293b",
    textLight: "#64748b",
    textSecondary: "#94a3b8",
    heading: "#0f172a",
    link: "#2563eb",
    border: "#e2e8f0",
    divider: "#f1f5f9",
    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4444",
    info: "#3b82f6",
  },
  fonts: {
    heading: {
      family: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      size: 32,
      weight: 700,
      lineHeight: 1.2,
    },
    body: {
      family: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      size: 16,
      weight: 400,
      lineHeight: 1.5,
    },
    mono: {
      family: "JetBrains Mono, Consolas, monospace",
      size: 14,
      weight: 400,
      lineHeight: 1.4,
    },
  },
  spacing: {
    page: { top: 48, right: 48, bottom: 48, left: 48 },
    section: 24,
    paragraph: 12,
    list: 8,
    heading: 16,
  },
  decorations: {
    showHeaderLine: false,
    showFooterLine: true,
    showPageNumbers: true,
    pageNumberPosition: "bottom-right",
    headingUnderline: false,
    headingBorder: false,
    showTableBorders: true,
    roundedCorners: true,
    shadowEffects: true,
  },
};

const corporatePptLayout: LayoutConfig = {
  pageSize: "A4",
  orientation: "landscape",
  cover: {
    enabled: true,
    style: "prominent",
    showLogo: true,
    showDate: true,
    showAuthor: true,
  },
  header: {
    enabled: false,
    height: 40,
    showOnFirstPage: false,
  },
  footer: {
    enabled: true,
    height: 30,
    showOnFirstPage: false,
  },
  sections: {
    startOnNewPage: true,
    numberHeadings: false,
    indentLevel: 0,
  },
};

/**
 * 现代科技演示模板
 */
const modernTechTheme: ThemeConfig = {
  colors: {
    primary: "#8b5cf6",
    secondary: "#a78bfa",
    accent: "#c4b5fd",
    background: "#0f0f23",
    backgroundAlt: "#1a1a2e",
    text: "#e2e8f0",
    textLight: "#94a3b8",
    textSecondary: "#64748b",
    heading: "#ffffff",
    link: "#a78bfa",
    border: "#334155",
    divider: "#1e293b",
    success: "#34d399",
    warning: "#fbbf24",
    error: "#f87171",
    info: "#60a5fa",
  },
  fonts: {
    heading: {
      family: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      size: 36,
      weight: 700,
      lineHeight: 1.1,
    },
    body: {
      family: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      size: 18,
      weight: 400,
      lineHeight: 1.6,
    },
    mono: {
      family: "JetBrains Mono, Consolas, monospace",
      size: 14,
      weight: 400,
      lineHeight: 1.4,
    },
  },
  spacing: {
    page: { top: 40, right: 40, bottom: 40, left: 40 },
    section: 20,
    paragraph: 10,
    list: 8,
    heading: 14,
  },
  decorations: {
    showHeaderLine: false,
    showFooterLine: false,
    showPageNumbers: true,
    pageNumberPosition: "bottom-right",
    headingUnderline: false,
    headingBorder: false,
    showTableBorders: false,
    roundedCorners: true,
    shadowEffects: true,
  },
};

const modernTechLayout: LayoutConfig = {
  pageSize: "A4",
  orientation: "landscape",
  cover: {
    enabled: true,
    style: "prominent",
    showLogo: false,
    showDate: false,
    showAuthor: false,
  },
  header: {
    enabled: false,
    height: 40,
    showOnFirstPage: false,
  },
  footer: {
    enabled: true,
    height: 30,
    showOnFirstPage: false,
  },
  sections: {
    startOnNewPage: true,
    numberHeadings: false,
    indentLevel: 0,
  },
};

/**
 * 商务文档模板
 */
const businessDocTheme: ThemeConfig = {
  colors: {
    primary: "#059669",
    secondary: "#10b981",
    accent: "#34d399",
    background: "#ffffff",
    backgroundAlt: "#f0fdf4",
    text: "#1f2937",
    textLight: "#6b7280",
    textSecondary: "#9ca3af",
    heading: "#111827",
    link: "#059669",
    border: "#d1d5db",
    divider: "#e5e7eb",
    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4444",
    info: "#0ea5e9",
  },
  fonts: {
    heading: {
      family: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      size: 22,
      weight: 600,
      lineHeight: 1.35,
    },
    body: {
      family: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      size: 13,
      weight: 400,
      lineHeight: 1.65,
    },
    mono: {
      family: "JetBrains Mono, Consolas, monospace",
      size: 12,
      weight: 400,
      lineHeight: 1.5,
    },
  },
  spacing: {
    page: { top: 60, right: 60, bottom: 60, left: 60 },
    section: 24,
    paragraph: 12,
    list: 8,
    heading: 18,
  },
  decorations: {
    showHeaderLine: true,
    showFooterLine: true,
    showPageNumbers: true,
    pageNumberPosition: "bottom-right",
    headingUnderline: false,
    headingBorder: true,
    showTableBorders: true,
    roundedCorners: true,
    shadowEffects: false,
  },
};

const businessDocLayout: LayoutConfig = {
  pageSize: "A4",
  orientation: "portrait",
  cover: {
    enabled: true,
    style: "standard",
    showLogo: true,
    showDate: true,
    showAuthor: true,
  },
  header: {
    enabled: true,
    height: 35,
    showOnFirstPage: false,
  },
  footer: {
    enabled: true,
    height: 35,
    showOnFirstPage: false,
  },
  sections: {
    startOnNewPage: false,
    numberHeadings: true,
    indentLevel: 0,
  },
};

/**
 * AI Teams 任务报告模板
 */
const missionReportTheme: ThemeConfig = {
  colors: {
    primary: "#7c3aed",
    secondary: "#8b5cf6",
    accent: "#22c55e",
    background: "#ffffff",
    backgroundAlt: "#faf5ff",
    text: "#1f2937",
    textLight: "#6b7280",
    textSecondary: "#9ca3af",
    heading: "#111827",
    link: "#7c3aed",
    border: "#e5e7eb",
    divider: "#f3f4f6",
    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4444",
    info: "#6366f1",
  },
  fonts: {
    heading: {
      family: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      size: 24,
      weight: 700,
      lineHeight: 1.3,
    },
    body: {
      family: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      size: 14,
      weight: 400,
      lineHeight: 1.7,
    },
    mono: {
      family: "JetBrains Mono, Consolas, monospace",
      size: 13,
      weight: 400,
      lineHeight: 1.5,
    },
  },
  spacing: {
    page: { top: 64, right: 64, bottom: 64, left: 64 },
    section: 28,
    paragraph: 14,
    list: 10,
    heading: 20,
  },
  decorations: {
    showHeaderLine: false,
    showFooterLine: false,
    showPageNumbers: true,
    pageNumberPosition: "bottom-center",
    headingUnderline: true,
    headingBorder: false,
    showTableBorders: true,
    roundedCorners: true,
    shadowEffects: false,
  },
};

const missionReportLayout: LayoutConfig = {
  pageSize: "A4",
  orientation: "portrait",
  cover: {
    enabled: true,
    style: "prominent",
    showLogo: false,
    showDate: true,
    showAuthor: true,
  },
  header: {
    enabled: false,
    height: 40,
    showOnFirstPage: false,
  },
  footer: {
    enabled: true,
    height: 40,
    showOnFirstPage: false,
  },
  sections: {
    startOnNewPage: false,
    numberHeadings: true,
    indentLevel: 0,
  },
};

/**
 * 所有内置模板
 */
export const BUILTIN_TEMPLATES: BuiltInTemplate[] = [
  // AI Teams 任务报告模板
  {
    id: "mission-report",
    name: "AI Teams 任务报告",
    description:
      "专为 AI Teams 任务执行报告设计，紫色主题，突出统计数据和执行详情",
    category: ExportTemplateCategory.REPORT,
    themeConfig: missionReportTheme,
    layoutConfig: missionReportLayout,
    supportedFormats: [
      ExportFormat.PDF,
      ExportFormat.DOCX,
      ExportFormat.MARKDOWN,
      ExportFormat.HTML,
    ],
    supportedSources: [ExportSourceType.MISSION],
    isDefault: false,
  },

  // 报告类模板
  {
    id: "report-professional",
    name: "专业报告",
    description: "适用于商务报告、研究报告，专业蓝色主题",
    category: ExportTemplateCategory.REPORT,
    themeConfig: professionalReportTheme,
    layoutConfig: professionalReportLayout,
    supportedFormats: [
      ExportFormat.PDF,
      ExportFormat.DOCX,
      ExportFormat.MARKDOWN,
      ExportFormat.HTML,
    ],
    supportedSources: [
      ExportSourceType.DOCUMENT,
      ExportSourceType.RESEARCH,
      ExportSourceType.REPORT,
      ExportSourceType.RAW,
    ],
    isDefault: true,
  },
  {
    id: "deep-research",
    name: "深度研究",
    description: "专为 Deep Research 设计，紫色渐变主题，突出引用",
    category: ExportTemplateCategory.REPORT,
    themeConfig: deepResearchTheme,
    layoutConfig: deepResearchLayout,
    supportedFormats: [
      ExportFormat.PDF,
      ExportFormat.DOCX,
      ExportFormat.MARKDOWN,
      ExportFormat.HTML,
    ],
    supportedSources: [ExportSourceType.RESEARCH, ExportSourceType.RAW],
  },
  {
    id: "report-minimal",
    name: "简约风格",
    description: "极简设计，黑白主题，适合快速阅读",
    category: ExportTemplateCategory.REPORT,
    themeConfig: minimalTheme,
    layoutConfig: minimalLayout,
    supportedFormats: [
      ExportFormat.PDF,
      ExportFormat.DOCX,
      ExportFormat.MARKDOWN,
      ExportFormat.HTML,
    ],
    supportedSources: [
      ExportSourceType.DOCUMENT,
      ExportSourceType.RESEARCH,
      ExportSourceType.REPORT,
      ExportSourceType.RAW,
    ],
  },
  {
    id: "report-academic",
    name: "学术论文",
    description: "学术论文格式，Times New Roman 字体，双倍行距",
    category: ExportTemplateCategory.ACADEMIC,
    themeConfig: academicTheme,
    layoutConfig: academicLayout,
    supportedFormats: [ExportFormat.PDF, ExportFormat.DOCX],
    supportedSources: [
      ExportSourceType.DOCUMENT,
      ExportSourceType.RESEARCH,
      ExportSourceType.RAW,
    ],
  },

  // 演示文稿类模板
  {
    id: "ppt-corporate",
    name: "企业商务",
    description: "专业蓝色企业风格，适合商业演示和公司汇报",
    category: ExportTemplateCategory.PPT,
    themeConfig: corporatePptTheme,
    layoutConfig: corporatePptLayout,
    supportedFormats: [ExportFormat.PPTX, ExportFormat.PDF],
    supportedSources: [
      ExportSourceType.DOCUMENT,
      ExportSourceType.RESEARCH,
      ExportSourceType.REPORT,
      ExportSourceType.RAW,
    ],
    isDefault: true,
  },
  {
    id: "ppt-modern",
    name: "现代科技",
    description: "暗色科技风格，适合技术分享和产品发布",
    category: ExportTemplateCategory.PPT,
    themeConfig: modernTechTheme,
    layoutConfig: modernTechLayout,
    supportedFormats: [ExportFormat.PPTX, ExportFormat.PDF],
    supportedSources: [
      ExportSourceType.DOCUMENT,
      ExportSourceType.RESEARCH,
      ExportSourceType.RAW,
    ],
  },

  // 商务文档类模板
  {
    id: "doc-business",
    name: "商务文档",
    description: "绿色清新风格，适合商务提案和工作文档",
    category: ExportTemplateCategory.BUSINESS,
    themeConfig: businessDocTheme,
    layoutConfig: businessDocLayout,
    supportedFormats: [ExportFormat.PDF, ExportFormat.DOCX, ExportFormat.HTML],
    supportedSources: [
      ExportSourceType.DOCUMENT,
      ExportSourceType.REPORT,
      ExportSourceType.RAW,
    ],
  },
];
