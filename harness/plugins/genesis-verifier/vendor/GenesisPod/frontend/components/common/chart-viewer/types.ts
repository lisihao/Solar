/**
 * Chart Viewer 平台类型
 *
 * 抽自 TI 的 ReportChart 业务类型，作为跨模块（TI / AI Office /
 * AI Research / 任何报告类视图）共享的"可渲染图表"结构性接口。
 *
 * 不依赖任何业务 domain；纯结构性接口。业务方的 ReportChart / SlidesChart
 * 等只要满足这个 shape 就能直接传入 chart-viewer 组件，不需类型转换。
 */

/** 图表数据来源（reference 引用原图 / generated AI 合成数据图） */
export type RenderableChartSourceType = 'reference' | 'generated';

/** 单数据点（兼容业务方的 ChartDataPoint） */
export interface RenderableChartDataPoint {
  /** X 轴标签（时间 / 类别） */
  label: string;
  /** 数值 */
  value: number;
  /** 系列名（多系列图表） */
  series?: string;
  /** 业务自定义扩展字段 */
  extra?: Record<string, unknown>;
}

/**
 * chart 引用的"证据"最小契约 —— 用于 chart 来源里的 [N] 引用 hover/jump。
 * 业务方的 TopicEvidence 等满足此 shape 即可直接传入，无需类型转换。
 */
export interface RenderableEvidence {
  id: string;
  citationIndex?: number;
  title?: string | null;
  url?: string | null;
  snippet?: string | null;
  domain?: string | null;
}

/** chart-viewer 渲染所需的最小契约。 */
export interface RenderableChart {
  /** 图表 ID */
  id: string;
  /** 来源类型 */
  chartType?: RenderableChartSourceType;
  /** 图形类型（bar / line / pie / scatter / radar / area / table / risk-matrix 等）*/
  type?: string;
  /** 标题 */
  title?: string;
  /** 描述 */
  description?: string;
  /** 数据（generated 类型需要） */
  data?: RenderableChartDataPoint[];
  /** X 轴配置 */
  xAxis?: {
    label?: string;
    type?: 'category' | 'number' | 'time';
  };
  /** Y 轴配置 */
  yAxis?: {
    label?: string;
    unit?: string;
    min?: number;
    max?: number;
  };
  /** 系列配置 */
  series?: Array<{
    name: string;
    color?: string;
  }>;
  /** 数据来源 / 出处 */
  source?: string;
  /** 章节关联（业务方按需用） */
  sectionId?: string;
  /** 位置 hint（与 injectChartPlaceholders 同口径） */
  position?: string;
  /** reference 类型：图片 URL */
  imageUrl?: string;
  /** reference 类型：引用证据 index */
  evidenceCitationIndex?: number;
  /** 全文顺序编号（图 1 / 图 2 / ...） */
  figureNumber?: number;
}
