// 信息图内容结构
export interface InfographicSection {
  title: string;
  summary?: string;
  bullets: string[];
  metrics: { label: string; value: string; comparison?: string }[];
  iconType?: string;
  sectionType?: "main" | "summary"; // AI-determined: main content vs summary/conclusion
}

// 支持的设计风格
export type InfographicStyle =
  | "consulting" // 咨询风格：McKinsey/BCG 风格，专业商务
  | "tech" // 科技风格：现代科技感，渐变色
  | "minimal" // 极简风格：大量留白，简洁
  | "creative" // 创意风格：活泼配色，圆角
  | "dark" // 暗黑风格：深色背景
  | "academic" // 学术风格：严谨正式
  | "business" // 商务简约：专业简洁，蓝灰色调
  | "genspark" // Genspark风格：深蓝渐变背景 + 玻璃态卡片
  | "tech_gradient"; // 科技渐变：紫蓝渐变 + 现代科技感

// 字体风格
export type FontStyle =
  | "sans" // 无衬线：现代感
  | "serif" // 衬线：经典正式
  | "mono" // 等宽：科技感
  | "rounded"; // 圆角：友好亲切

// 模板布局类型
export type TemplateLayout =
  | "cards" // 卡片网格布局（当前默认）
  | "center_visual" // 中心视觉图形 + 周围要点
  | "timeline" // 时间线/流程布局
  | "comparison" // 对比布局（仅限2项对比）
  | "pyramid" // 金字塔/层级布局
  | "radial" // 放射状布局
  | "statistics" // 统计数据展示
  | "checklist" // 清单/要点列表
  | "funnel" // 漏斗图
  | "matrix" // 2x2矩阵/象限图
  | "ranking"; // 排行榜/横向比较表格

export interface InfographicStyleOptions {
  style?: InfographicStyle;
  fontStyle?: FontStyle;
  templateLayout?: TemplateLayout; // 模板布局类型
  borderRadius?: "none" | "small" | "medium" | "large";
  shadowStyle?: "none" | "subtle" | "medium" | "strong";
  iconStyle?: "outline" | "filled" | "duotone";
  // 中心视觉相关配置
  centerVisualTitle?: string; // 中心图形的标题
  centerVisualItems?: string[]; // 中心图形周围的要点
}

export interface InfographicContent {
  title: string;
  subtitle?: string;
  heroStatement?: string;
  sections: InfographicSection[];
  callToAction?: string;
  colorScheme?: {
    primary: string;
    accent: string;
    background: string;
    text: string;
  };
  styleOptions?: InfographicStyleOptions;
}

export interface StylePreset {
  colors: {
    primary: string;
    accent: string;
    background: string;
    text: string;
  };
  font: string;
  borderRadius: number;
  shadow: string;
}
