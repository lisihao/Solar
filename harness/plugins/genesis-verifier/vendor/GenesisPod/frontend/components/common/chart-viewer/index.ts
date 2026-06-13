/**
 * Chart Viewer - 通用图表渲染平台
 *
 * 抽自 Topic Insights 的图表系统，沉淀为跨模块平台能力。
 * 双通道渲染：
 * - reference 图（外部 URL → <img>）
 * - generated 图（Recharts 引擎 → bar / line / area / pie / scatter / radar / risk-matrix）
 *
 * 适用场景：
 * - AI Office Slides 图表展示
 * - AI Research / Writing 报告中的可视化
 * - Agent Playground mission report 数据图
 *
 * 使用方式：参考 ReportChartRenderer + FigureRenderer 的 prop 文档。
 */

export { ReportChartRenderer, RiskMatrixRenderer } from './ReportChartRenderer';
export { FigureRenderer, FigureGallery } from './FigureRenderer';
export type { FigureEvidenceInfo } from './FigureRenderer';
export {
  ChartErrorBoundary,
  withChartErrorBoundary,
} from './ChartErrorBoundary';
// ★ 平台层结构性类型 — 业务方的 ReportChart / SlidesChart 等只要满足
//   shape 即可直接传入，不必类型转换。
export type {
  RenderableChart,
  RenderableChartDataPoint,
  RenderableChartSourceType,
  RenderableEvidence,
} from './types';
