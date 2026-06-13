# 视觉设计系统

> 专业报告的设计令牌、组件样式和视觉规范

## 一、设计令牌 (Design Tokens)

### 1.1 颜色系统

```css
:root {
  /* ========== 背景颜色 ========== */
  --report-bg-primary: #0f172a; /* Slate-900 主背景 */
  --report-bg-secondary: #1e293b; /* Slate-800 卡片背景 */
  --report-bg-tertiary: #334155; /* Slate-700 边框/分隔 */
  --report-bg-elevated: #475569; /* Slate-600 悬浮元素 */

  /* ========== 文字颜色 ========== */
  --report-text-primary: #f1f5f9; /* Slate-100 主文字 */
  --report-text-secondary: #94a3b8; /* Slate-400 次要文字 */
  --report-text-muted: #64748b; /* Slate-500 辅助文字 */
  --report-text-inverse: #0f172a; /* 反色文字 */

  /* ========== 强调颜色 ========== */
  --report-accent-gold: #f59e0b; /* Amber-500 金色强调 */
  --report-accent-gold-light: #fcd34d; /* Amber-300 浅金色 */
  --report-accent-blue: #3b82f6; /* Blue-500 蓝色强调 */
  --report-accent-blue-light: #60a5fa; /* Blue-400 浅蓝色 */
  --report-accent-green: #10b981; /* Emerald-500 绿色强调 */
  --report-accent-purple: #8b5cf6; /* Violet-500 紫色强调 */
  --report-accent-red: #ef4444; /* Red-500 红色警示 */
  --report-accent-orange: #f97316; /* Orange-500 橙色 */

  /* ========== 语义颜色 ========== */
  --report-success: #10b981; /* 成功/正向 */
  --report-warning: #f59e0b; /* 警告/关注 */
  --report-error: #ef4444; /* 错误/危险 */
  --report-info: #3b82f6; /* 信息/中立 */

  /* ========== 图表颜色 ========== */
  --report-chart-1: #3b82f6; /* 主色 */
  --report-chart-2: #10b981; /* 次色 */
  --report-chart-3: #f59e0b; /* 第三色 */
  --report-chart-4: #8b5cf6; /* 第四色 */
  --report-chart-5: #ef4444; /* 第五色 */
  --report-chart-6: #6b7280; /* 灰色 */
}
```

### 1.2 颜色使用指南

| 颜色类型        | 用途               | 示例                |
| --------------- | ------------------ | ------------------- |
| `accent-gold`   | 重点强调、核心数据 | KPI数值、洞察框标题 |
| `accent-blue`   | 主要元素、链接     | 图表主色、标签      |
| `accent-green`  | 正向趋势、成功状态 | 增长指标、机遇      |
| `accent-red`    | 风险、下降趋势     | 风险警示、负增长    |
| `accent-purple` | 辅助强调、分类     | 第三分类、装饰      |

---

### 1.3 字体系统

```css
:root {
  /* ========== 字体族 ========== */
  --report-font-primary: "Noto Sans SC", "Inter", -apple-system, sans-serif;
  --report-font-display: "Inter", "Noto Sans SC", sans-serif;
  --report-font-mono: "JetBrains Mono", "Fira Code", monospace;

  /* ========== 字号 ========== */
  --report-font-display-xl: 48px; /* 超大标题 */
  --report-font-display: 36px; /* 封面标题 */
  --report-font-h1: 24px; /* 页面标题 */
  --report-font-h2: 18px; /* 卡片标题 */
  --report-font-h3: 14px; /* 小标题 */
  --report-font-body: 13px; /* 正文 */
  --report-font-caption: 11px; /* 注释/标签 */
  --report-font-micro: 10px; /* 微小文字 */

  /* ========== 字重 ========== */
  --report-weight-light: 300;
  --report-weight-regular: 400;
  --report-weight-medium: 500;
  --report-weight-semibold: 600;
  --report-weight-bold: 700;
  --report-weight-black: 800;

  /* ========== 行高 ========== */
  --report-leading-tight: 1.25;
  --report-leading-normal: 1.5;
  --report-leading-relaxed: 1.75;
}
```

### 1.4 字体使用规范

| 场景       | 字号 | 字重 | 行高 |
| ---------- | ---- | ---- | ---- |
| 封面主标题 | 36px | 700  | 1.25 |
| 封面副标题 | 14px | 400  | 1.5  |
| 页面标题   | 24px | 700  | 1.25 |
| 卡片标题   | 18px | 600  | 1.25 |
| 小标题     | 14px | 600  | 1.5  |
| 正文       | 13px | 400  | 1.75 |
| KPI 数值   | 32px | 700  | 1.25 |
| 标签/注释  | 11px | 500  | 1.5  |

---

### 1.5 间距系统

```css
:root {
  /* ========== 基础间距 ========== */
  --report-space-xs: 4px;
  --report-space-sm: 8px;
  --report-space-md: 16px;
  --report-space-lg: 24px;
  --report-space-xl: 32px;
  --report-space-2xl: 48px;
  --report-space-3xl: 64px;

  /* ========== 页面间距 ========== */
  --report-page-padding: 32px;
  --report-section-gap: 24px;
  --report-card-gap: 16px;
  --report-element-gap: 12px;
}
```

### 1.6 圆角系统

```css
:root {
  --report-radius-sm: 4px;
  --report-radius-md: 8px;
  --report-radius-lg: 12px;
  --report-radius-xl: 16px;
  --report-radius-full: 9999px;
}
```

### 1.7 阴影系统

```css
:root {
  --report-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.2);
  --report-shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
  --report-shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.4);
  --report-shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
  --report-shadow-glow: 0 0 20px rgba(245, 158, 11, 0.3);
}
```

---

## 二、页面布局规范

### 2.1 幻灯片尺寸

```css
/* 标准 16:9 幻灯片 */
.report-slide {
  width: 960px;
  height: 540px;
  padding: var(--report-page-padding);
  background: var(--report-bg-primary);
  position: relative;
  overflow: hidden;
}

/* 高清版本 */
.report-slide--hd {
  width: 1920px;
  height: 1080px;
  padding: calc(var(--report-page-padding) * 2);
}
```

### 2.2 页面结构

```
┌─────────────────────────────────────────────┐
│  ┌─────────────────────────────────────┐   │ ← 页眉区
│  │  [标签]  标题                        │   │    高度: 60px
│  │         副标题                       │   │
│  └─────────────────────────────────────┘   │
│  ─────────────────────────────────────────  │ ← 分隔线
│                                             │
│                                             │
│              内容区域                        │ ← 内容区
│              Content Area                   │    高度: 自适应
│                                             │
│                                             │
│                                             │
│  ─────────────────────────────────────────  │ ← 页脚区
│                                    [页码]   │    高度: 32px
└─────────────────────────────────────────────┘
```

### 2.3 页眉组件

```css
.report-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  padding-bottom: var(--report-space-md);
  border-bottom: 2px solid var(--report-bg-tertiary);
  margin-bottom: var(--report-space-lg);
}

.report-header__label {
  display: inline-block;
  padding: var(--report-space-xs) var(--report-space-sm);
  background: var(--report-accent-gold);
  color: var(--report-text-inverse);
  font-size: var(--report-font-caption);
  font-weight: var(--report-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-radius: var(--report-radius-sm);
  margin-bottom: var(--report-space-sm);
}

.report-header__title {
  font-size: var(--report-font-h1);
  font-weight: var(--report-weight-bold);
  color: var(--report-text-primary);
  margin: 0;
}

.report-header__subtitle {
  font-size: var(--report-font-h3);
  font-weight: var(--report-weight-regular);
  color: var(--report-text-secondary);
  margin-top: var(--report-space-xs);
}
```

### 2.4 页脚组件

```css
.report-footer {
  position: absolute;
  bottom: var(--report-page-padding);
  right: var(--report-page-padding);
  font-size: var(--report-font-caption);
  color: var(--report-text-muted);
}

.report-footer__page {
  font-weight: var(--report-weight-medium);
}
```

### 2.5 网格系统

```css
.report-grid {
  display: grid;
  gap: var(--report-card-gap);
}

/* 等宽列 */
.report-grid--2-col {
  grid-template-columns: repeat(2, 1fr);
}
.report-grid--3-col {
  grid-template-columns: repeat(3, 1fr);
}
.report-grid--4-col {
  grid-template-columns: repeat(4, 1fr);
}
.report-grid--5-col {
  grid-template-columns: repeat(5, 1fr);
}

/* 自定义比例 */
.report-grid--split-30-70 {
  grid-template-columns: 30% 70%;
}
.report-grid--split-40-60 {
  grid-template-columns: 40% 60%;
}
.report-grid--split-50-50 {
  grid-template-columns: 50% 50%;
}
```

---

## 三、组件样式库

### 3.1 卡片组件

```css
/* 基础卡片 */
.report-card {
  background: var(--report-bg-secondary);
  border: 1px solid var(--report-bg-tertiary);
  border-radius: var(--report-radius-lg);
  padding: var(--report-space-lg);
  box-shadow: var(--report-shadow-md);
  transition:
    transform 0.3s ease,
    box-shadow 0.3s ease;
}

.report-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--report-shadow-lg);
}

/* 强调边框变体 */
.report-card--accent-gold {
  border-left: 4px solid var(--report-accent-gold);
}

.report-card--accent-blue {
  border-left: 4px solid var(--report-accent-blue);
}

.report-card--accent-green {
  border-left: 4px solid var(--report-accent-green);
}

.report-card--accent-red {
  border-left: 4px solid var(--report-accent-red);
}

/* 卡片头部 */
.report-card__header {
  display: flex;
  align-items: center;
  gap: var(--report-space-sm);
  margin-bottom: var(--report-space-md);
}

.report-card__icon {
  font-size: 24px;
}

.report-card__title {
  font-size: var(--report-font-h2);
  font-weight: var(--report-weight-semibold);
  color: var(--report-text-primary);
  margin: 0;
}

/* 卡片内容 */
.report-card__content {
  font-size: var(--report-font-body);
  color: var(--report-text-secondary);
  line-height: var(--report-leading-relaxed);
}
```

### 3.2 KPI 卡片

```css
.report-kpi {
  display: flex;
  flex-direction: column;
  padding: var(--report-space-md);
  background: var(--report-bg-secondary);
  border-radius: var(--report-radius-lg);
  min-width: 150px;
}

.report-kpi__label {
  font-size: var(--report-font-caption);
  font-weight: var(--report-weight-medium);
  color: var(--report-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: var(--report-space-xs);
}

.report-kpi__value {
  font-size: 32px;
  font-weight: var(--report-weight-bold);
  color: var(--report-accent-gold);
  line-height: 1;
  margin-bottom: var(--report-space-xs);
}

.report-kpi__unit {
  font-size: var(--report-font-h3);
  font-weight: var(--report-weight-regular);
  color: var(--report-text-secondary);
}

.report-kpi__trend {
  display: flex;
  align-items: center;
  gap: var(--report-space-xs);
  font-size: var(--report-font-caption);
  margin-top: var(--report-space-sm);
}

.report-kpi__trend--up {
  color: var(--report-accent-green);
}

.report-kpi__trend--down {
  color: var(--report-accent-red);
}

.report-kpi__trend--neutral {
  color: var(--report-text-muted);
}
```

### 3.3 标签组件

```css
.report-tag {
  display: inline-flex;
  align-items: center;
  padding: var(--report-space-xs) var(--report-space-sm);
  border-radius: var(--report-radius-sm);
  font-size: var(--report-font-caption);
  font-weight: var(--report-weight-medium);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* 变体 */
.report-tag--primary {
  background: var(--report-accent-gold);
  color: var(--report-text-inverse);
}

.report-tag--secondary {
  background: rgba(59, 130, 246, 0.2);
  color: var(--report-accent-blue);
}

.report-tag--outline {
  background: transparent;
  border: 1px solid var(--report-bg-tertiary);
  color: var(--report-text-secondary);
}

.report-tag--success {
  background: rgba(16, 185, 129, 0.2);
  color: var(--report-accent-green);
}

.report-tag--danger {
  background: rgba(239, 68, 68, 0.2);
  color: var(--report-accent-red);
}
```

### 3.4 洞察框

```css
.report-insight {
  background: linear-gradient(
    135deg,
    rgba(245, 158, 11, 0.15) 0%,
    rgba(245, 158, 11, 0.05) 100%
  );
  border-left: 4px solid var(--report-accent-gold);
  border-radius: var(--report-radius-lg);
  padding: var(--report-space-md) var(--report-space-lg);
  margin: var(--report-space-lg) 0;
}

.report-insight__header {
  display: flex;
  align-items: center;
  gap: var(--report-space-sm);
  margin-bottom: var(--report-space-sm);
}

.report-insight__icon {
  color: var(--report-accent-gold);
  font-size: 18px;
}

.report-insight__title {
  font-size: var(--report-font-h3);
  font-weight: var(--report-weight-semibold);
  color: var(--report-accent-gold);
  margin: 0;
}

.report-insight__text {
  font-size: var(--report-font-body);
  color: var(--report-text-primary);
  line-height: var(--report-leading-relaxed);
  margin: 0;
}

.report-insight__highlight {
  color: var(--report-accent-gold);
  font-weight: var(--report-weight-semibold);
}
```

### 3.5 时间线组件

```css
.report-timeline {
  display: flex;
  align-items: flex-start;
  gap: var(--report-space-md);
  position: relative;
}

/* 连接线 */
.report-timeline::before {
  content: "";
  position: absolute;
  top: 20px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--report-bg-tertiary);
  z-index: 0;
}

.report-timeline__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  z-index: 1;
}

.report-timeline__dot {
  width: 40px;
  height: 40px;
  border-radius: var(--report-radius-full);
  background: var(--report-bg-secondary);
  border: 3px solid var(--report-bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--report-font-caption);
  font-weight: var(--report-weight-bold);
  color: var(--report-text-secondary);
  margin-bottom: var(--report-space-md);
}

.report-timeline__item--active .report-timeline__dot {
  border-color: var(--report-accent-gold);
  color: var(--report-accent-gold);
}

.report-timeline__content {
  background: var(--report-bg-secondary);
  border-radius: var(--report-radius-lg);
  padding: var(--report-space-md);
  text-align: center;
  width: 100%;
}

.report-timeline__date {
  font-size: var(--report-font-caption);
  font-weight: var(--report-weight-semibold);
  color: var(--report-accent-blue);
  margin-bottom: var(--report-space-xs);
}

.report-timeline__title {
  font-size: var(--report-font-h3);
  font-weight: var(--report-weight-semibold);
  color: var(--report-text-primary);
  margin-bottom: var(--report-space-xs);
}

.report-timeline__desc {
  font-size: var(--report-font-caption);
  color: var(--report-text-secondary);
}
```

### 3.6 进度条/仪表盘

```css
/* 水平进度条 */
.report-progress {
  display: flex;
  align-items: center;
  gap: var(--report-space-md);
}

.report-progress__bar {
  flex: 1;
  height: 24px;
  background: var(--report-bg-tertiary);
  border-radius: var(--report-radius-full);
  overflow: hidden;
  display: flex;
}

.report-progress__fill {
  height: 100%;
  transition: width 0.5s ease;
}

.report-progress__fill--risk {
  background: linear-gradient(
    90deg,
    var(--report-accent-red),
    var(--report-accent-orange)
  );
}

.report-progress__fill--value {
  background: linear-gradient(
    90deg,
    var(--report-accent-green),
    var(--report-accent-blue)
  );
}

.report-progress__label {
  font-size: var(--report-font-caption);
  font-weight: var(--report-weight-medium);
  white-space: nowrap;
  min-width: 60px;
}

.report-progress__label--left {
  color: var(--report-accent-red);
  text-align: right;
}

.report-progress__label--right {
  color: var(--report-accent-green);
  text-align: left;
}
```

### 3.7 对比表格

```css
.report-comparison {
  display: grid;
  gap: 0;
  border: 1px solid var(--report-bg-tertiary);
  border-radius: var(--report-radius-lg);
  overflow: hidden;
}

.report-comparison--2-col {
  grid-template-columns: repeat(2, 1fr);
}

.report-comparison__header {
  background: var(--report-bg-secondary);
  padding: var(--report-space-md);
  text-align: center;
  border-bottom: 1px solid var(--report-bg-tertiary);
}

.report-comparison__header:not(:last-child) {
  border-right: 1px solid var(--report-bg-tertiary);
}

.report-comparison__title {
  font-size: var(--report-font-h2);
  font-weight: var(--report-weight-bold);
  color: var(--report-text-primary);
  margin-bottom: var(--report-space-xs);
}

.report-comparison__subtitle {
  font-size: var(--report-font-caption);
  color: var(--report-text-secondary);
}

.report-comparison__row {
  display: contents;
}

.report-comparison__cell {
  padding: var(--report-space-md);
  border-bottom: 1px solid var(--report-bg-tertiary);
}

.report-comparison__cell:not(:last-child) {
  border-right: 1px solid var(--report-bg-tertiary);
}

.report-comparison__cell-label {
  font-size: var(--report-font-caption);
  font-weight: var(--report-weight-semibold);
  color: var(--report-accent-blue);
  display: flex;
  align-items: center;
  gap: var(--report-space-xs);
  margin-bottom: var(--report-space-xs);
}

.report-comparison__cell-value {
  font-size: var(--report-font-body);
  color: var(--report-text-primary);
}
```

---

## 四、图标和图形

### 4.1 图标使用规范

**推荐图标库**: Lucide Icons

| 场景      | 推荐图标                         | 示例 |
| --------- | -------------------------------- | ---- |
| 政策/政府 | `building-2`, `landmark`         | 🏛️   |
| 投资/资本 | `dollar-sign`, `trending-up`     | 💰   |
| 技术/研发 | `cpu`, `code`, `flask`           | 🔬   |
| 时间/日期 | `calendar`, `clock`              | 📅   |
| 风险/警告 | `alert-triangle`, `shield-alert` | ⚠️   |
| 成功/增长 | `check-circle`, `arrow-up`       | ✓    |
| 洞察/灯泡 | `lightbulb`, `sparkles`          | 💡   |
| 目标/方向 | `target`, `compass`              | 🎯   |

### 4.2 图标样式

```css
.report-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.report-icon--sm {
  width: 16px;
  height: 16px;
}
.report-icon--md {
  width: 24px;
  height: 24px;
}
.report-icon--lg {
  width: 32px;
  height: 32px;
}
.report-icon--xl {
  width: 48px;
  height: 48px;
}

/* 圆形背景图标 */
.report-icon-circle {
  width: 48px;
  height: 48px;
  border-radius: var(--report-radius-full);
  background: var(--report-bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}

.report-icon-circle--gold {
  background: rgba(245, 158, 11, 0.2);
  color: var(--report-accent-gold);
}

.report-icon-circle--blue {
  background: rgba(59, 130, 246, 0.2);
  color: var(--report-accent-blue);
}

.report-icon-circle--green {
  background: rgba(16, 185, 129, 0.2);
  color: var(--report-accent-green);
}
```

---

## 五、图表样式规范

### 5.1 图表配色

```typescript
const chartColors = {
  primary: "#3B82F6", // 蓝色 - 主要数据
  secondary: "#10B981", // 绿色 - 次要数据/正向
  tertiary: "#F59E0B", // 金色 - 强调
  quaternary: "#8B5CF6", // 紫色 - 第四系列
  danger: "#EF4444", // 红色 - 风险/负向
  neutral: "#6B7280", // 灰色 - 中立数据

  // 渐变
  gradients: {
    blue: ["#3B82F6", "#60A5FA"],
    green: ["#10B981", "#34D399"],
    gold: ["#F59E0B", "#FCD34D"],
  },
};
```

### 5.2 图表容器

```css
.report-chart {
  background: var(--report-bg-secondary);
  border-radius: var(--report-radius-lg);
  padding: var(--report-space-lg);
}

.report-chart__title {
  font-size: var(--report-font-h3);
  font-weight: var(--report-weight-semibold);
  color: var(--report-text-primary);
  margin-bottom: var(--report-space-md);
}

.report-chart__subtitle {
  font-size: var(--report-font-caption);
  color: var(--report-text-secondary);
  margin-top: calc(var(--report-space-xs) * -1);
  margin-bottom: var(--report-space-md);
}

.report-chart__canvas {
  width: 100%;
  height: 200px;
}

.report-chart__legend {
  display: flex;
  gap: var(--report-space-md);
  margin-top: var(--report-space-md);
  padding-top: var(--report-space-md);
  border-top: 1px solid var(--report-bg-tertiary);
}

.report-chart__legend-item {
  display: flex;
  align-items: center;
  gap: var(--report-space-xs);
  font-size: var(--report-font-caption);
  color: var(--report-text-secondary);
}

.report-chart__legend-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--report-radius-full);
}
```

### 5.3 图表类型选择

| 数据特征     | 推荐图表    | 示例场景                   |
| ------------ | ----------- | -------------------------- |
| 时间序列趋势 | 折线图      | 成本下降曲线、市场规模增长 |
| 类别对比     | 柱状图      | 年度收入对比、产品性能对比 |
| 占比构成     | 饼图/环形图 | 市场份额、能源结构         |
| 进度/比例    | 进度条      | 风险判断、目标完成度       |
| 排名/层级    | 横向条形图  | 模型能力排名、公司估值排名 |
| 多维对比     | 分组柱状图  | 不同公司的多指标对比       |

---

## 六、动画与交互

### 6.1 过渡动画

```css
:root {
  --report-transition-fast: 150ms ease;
  --report-transition-normal: 300ms ease;
  --report-transition-slow: 500ms ease;
}

/* 通用过渡 */
.report-transition {
  transition:
    transform var(--report-transition-normal),
    opacity var(--report-transition-normal),
    box-shadow var(--report-transition-normal);
}

/* 淡入动画 */
@keyframes report-fade-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.report-animate-in {
  animation: report-fade-in var(--report-transition-normal) forwards;
}

/* 依次出现动画 */
.report-stagger > * {
  opacity: 0;
  animation: report-fade-in var(--report-transition-normal) forwards;
}

.report-stagger > *:nth-child(1) {
  animation-delay: 0ms;
}
.report-stagger > *:nth-child(2) {
  animation-delay: 100ms;
}
.report-stagger > *:nth-child(3) {
  animation-delay: 200ms;
}
.report-stagger > *:nth-child(4) {
  animation-delay: 300ms;
}
.report-stagger > *:nth-child(5) {
  animation-delay: 400ms;
}
```

### 6.2 悬浮效果

```css
/* 卡片悬浮 */
.report-hover-lift {
  transition: transform var(--report-transition-normal);
}

.report-hover-lift:hover {
  transform: translateY(-4px);
}

/* 发光效果 */
.report-hover-glow:hover {
  box-shadow: var(--report-shadow-glow);
}

/* 边框高亮 */
.report-hover-border {
  transition: border-color var(--report-transition-normal);
}

.report-hover-border:hover {
  border-color: var(--report-accent-gold);
}
```

---

## 七、响应式设计

### 7.1 断点定义

```css
:root {
  --report-breakpoint-sm: 640px;
  --report-breakpoint-md: 768px;
  --report-breakpoint-lg: 1024px;
  --report-breakpoint-xl: 1280px;
}
```

### 7.2 响应式适配

```css
/* 移动端适配 */
@media (max-width: 768px) {
  .report-slide {
    width: 100%;
    height: auto;
    aspect-ratio: 16 / 9;
    padding: var(--report-space-md);
  }

  .report-grid--2-col,
  .report-grid--3-col {
    grid-template-columns: 1fr;
  }

  .report-kpi__value {
    font-size: 24px;
  }

  .report-header__title {
    font-size: var(--report-font-h2);
  }
}

/* 打印样式 */
@media print {
  .report-slide {
    background: white;
    color: black;
    page-break-after: always;
  }

  .report-card {
    border: 1px solid #ddd;
    box-shadow: none;
  }
}
```

---

## 八、导出格式规范

### 8.1 PDF 导出样式

```css
/* PDF 专用样式 */
@media print {
  .report-slide {
    width: 297mm; /* A4 横向 */
    height: 210mm;
  }

  /* 确保背景色打印 */
  * {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
```

### 8.2 PPT 兼容

- 字体: 使用系统通用字体 (Inter, Noto Sans SC)
- 图表: 导出为 SVG 或高清 PNG
- 颜色: 使用 RGB 值确保一致性
- 尺寸: 保持 16:9 比例 (1920x1080px)

---

## 九、参考资料

- [设计概述](./design-overview.md)
- [页面模板规范](./page-template-specification.md)
- [模板选择引擎](./template-selection-engine.md)

---

**文档版本**: v1.0
**创建日期**: 2024-12-28
