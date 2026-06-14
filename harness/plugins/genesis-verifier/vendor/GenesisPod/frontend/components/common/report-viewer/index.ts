/**
 * Report Viewer - 通用报告三视图框架
 *
 * 抽自 Topic Insights `reportViewMode` 切换逻辑，沉淀为跨模块平台能力。
 *
 * - ReportViewer：受控容器，按 activeMode 渲染对应模式
 * - ReportViewModeToggle：3 模式切换按钮组（独立可用）
 * - 类型契约：`ReportViewMode` / `ReportViewModeConfig` / props
 *
 * 与平台 markdown-viewer / chart-viewer / annotations 协同：
 * - continuous mode 用 MarkdownViewer 渲染 fullReport
 * - chapter mode 用 ChapterizedReportView 模式（业务侧自实现，平台不假设）
 * - quick mode 用业务自定义结构化卡片（平台只提供切换骨架）
 */

export { ReportViewer } from './ReportViewer';
export { ReportViewModeToggle } from './ReportViewModeToggle';
export type {
  ReportViewMode,
  ReportViewModeConfig,
  ReportViewerProps,
  ReportViewModeToggleProps,
} from './types';
