# AI Slides - 前端模板组件

## 概览

AI Slides 是基于 15 种专业模板的幻灯片渲染系统，支持深色主题和高质量视觉呈现。

## 目录结构

```
slides/
├── styles/
│   └── slide-tokens.css         # 设计令牌（颜色、字体、间距等）
├── base/                         # 基础组件
│   ├── SlideCard.tsx            # 通用卡片
│   ├── KpiCard.tsx              # KPI 指标卡片
│   ├── InsightBox.tsx           # 洞察框
│   ├── SlideTag.tsx             # 标签
│   ├── SlideTimeline.tsx        # 时间线
│   ├── ProgressBar.tsx          # 进度条
│   └── index.ts
├── templates/                    # 模板组件
│   ├── CoverSlide.tsx           # 封面页
│   ├── TocSlide.tsx             # 目录页
│   ├── ChapterTitleSlide.tsx    # 章节标题
│   ├── ChapterSummarySlide.tsx  # 章节摘要
│   ├── ConclusionSlide.tsx      # 结论页
│   ├── TimelineSlide.tsx        # 时间线页
│   ├── MultiColumnSlide.tsx     # 多栏布局
│   ├── DashboardSlide.tsx       # 仪表盘
│   ├── ComparisonSlide.tsx      # 对比分析
│   ├── RecommendationsSlide.tsx # 建议列表
│   └── index.ts
├── SlideRenderer.tsx             # 主渲染器
├── index.ts                      # 导出入口
└── README.md
```

## 使用方法

### 1. 基础使用

```tsx
import { SlideRenderer } from '@/components/ai-office/slides';
import type { CoverSlideContent } from '@/lib/types/slides';

const coverContent: CoverSlideContent = {
  templateType: 'cover',
  title: 'AI 驱动的未来',
  subtitle: '探索人工智能的无限可能',
  author: 'GenesisPod Team',
  organization: 'GenesisPod',
  date: '2025-12-28',
  tagline: '创新 · 洞察 · 行动',
};

function MySlide() {
  return <SlideRenderer templateType="cover" content={coverContent} />;
}
```

### 2. 可编辑模式

```tsx
import { SlideRenderer } from '@/components/ai-office/slides';
import { useState } from 'react';

function EditableSlide() {
  const [content, setContent] = useState<CoverSlideContent>({
    templateType: 'cover',
    title: '我的演示',
  });

  const handleEdit = (newContent) => {
    setContent(newContent);
    // 保存到后端...
  };

  return (
    <SlideRenderer
      templateType="cover"
      content={content}
      editable
      onEdit={handleEdit}
    />
  );
}
```

### 3. 使用基础组件

```tsx
import { KpiCard, SlideCard, InsightBox } from '@/components/ai-office/slides';

function MyDashboard() {
  return (
    <div
      style={{
        display: 'grid',
        gap: '16px',
        gridTemplateColumns: 'repeat(3, 1fr)',
      }}
    >
      <KpiCard
        label="总用户数"
        value={10000}
        unit="人"
        trend="up"
        trendValue="+15%"
        color="var(--slide-accent-blue)"
      />

      <SlideCard title="重要提示" highlight>
        <p>这是一个高亮的卡片</p>
      </SlideCard>

      <InsightBox title="关键洞察" emphasis="high">
        <p>用户增长加速，需要扩展基础设施</p>
      </InsightBox>
    </div>
  );
}
```

## 15 种模板类型

### 结构性模板（5种）

1. **cover** - 封面页
   - 用于：演示开篇
   - 包含：标题、副标题、作者、机构、日期

2. **toc** - 目录页
   - 用于：导航、结构概览
   - 支持：编号、图标、卡片三种样式

3. **chapterTitle** - 章节标题
   - 用于：章节过渡
   - 特点：大号章节号背景

4. **chapterSummary** - 章节摘要
   - 用于：章节总结
   - 支持：多个要点卡片

5. **conclusion** - 结论页
   - 用于：总结、行动号召
   - 支持：关键要点、下一步

### 内容型模板（10种）

6. **timeline** - 时间线
   - 布局：水平/垂直
   - 状态：过去/当前/未来

7. **multiColumn** - 多栏布局
   - 支持：2-4栏
   - 适合：并列概念

8. **splitLayout** - 分屏布局（待实现）
   - 比例：50-50, 60-40, 40-60等
   - 适合：图文结合

9. **dashboard** - 仪表盘
   - 功能：KPI 展示
   - 布局：网格/流式/Bento

10. **evolutionRoadmap** - 演进路线图（待实现）
    - 适合：战略规划
    - 状态：完成/进行中/计划/未来

11. **comparison** - 对比分析
    - 布局：表格/卡片/并列
    - 支持：获胜者标记

12. **caseStudy** - 案例研究（待实现）
    - 结构：问题-解决方案-结果
    - 支持：客户评价

13. **maturityModel** - 成熟度模型（待实现）
    - 可视化：雷达图
    - 适合：能力评估

14. **riskOpportunity** - 风险机会（待实现）
    - 布局：矩阵/列表
    - 维度：概率-影响

15. **recommendations** - 建议列表
    - 优先级：Critical/High/Medium/Low
    - 时间线：即时/短期/中期/长期

## 设计令牌

所有组件使用统一的设计令牌（CSS变量）：

### 颜色

```css
--slide-bg-primary: #0f172a; /* 主背景 */
--slide-bg-secondary: #1e293b; /* 次背景 */
--slide-text-primary: #f1f5f9; /* 主文字 */
--slide-accent-blue: #3b82f6; /* 强调蓝 */
--slide-accent-gold: #f59e0b; /* 强调金 */
```

### 字体

```css
--slide-font-display: 36px; /* 显示级 */
--slide-font-h1: 24px; /* 标题1 */
--slide-font-h2: 18px; /* 标题2 */
--slide-font-body: 13px; /* 正文 */
```

### 间距

```css
--slide-space-md: 16px;
--slide-space-lg: 24px;
--slide-space-xl: 32px;
--slide-space-2xl: 48px;
```

## 响应式

设计令牌支持响应式调整：

- **1920x1080**: 基准尺寸
- **1680x945**: 自动缩小字体
- **1366x768**: 进一步缩小

## 主题支持

当前支持深色主题（默认），浅色主题通过 `data-theme="light"` 激活：

```tsx
<div data-theme="light">
  <SlideRenderer ... />
</div>
```

## 最佳实践

### 1. 内容准备

```tsx
// ✅ 好的做法：明确类型
const content: DashboardSlideContent = {
  templateType: 'dashboard',
  title: '业务概览',
  metrics: [{ id: '1', label: '日活', value: 50000, trend: 'up' }],
  layout: 'grid',
};

// ❌ 避免：缺少类型
const content = {
  title: '业务概览',
  // 缺少 templateType
};
```

### 2. 性能优化

```tsx
// ✅ 使用 React.memo 避免不必要的重渲染
const MemoizedSlide = React.memo(SlideRenderer);

// ✅ 大列表使用虚拟滚动
import { FixedSizeList } from 'react-window';
```

### 3. 样式定制

```tsx
// ✅ 使用 CSS 变量覆盖
<div style={{ '--slide-accent-blue': '#10b981' } as React.CSSProperties}>
  <SlideRenderer ... />
</div>
```

## 开发计划

### 已完成 ✅

- [x] 设计令牌系统
- [x] 6 个基础组件
- [x] 5 个结构性模板
- [x] 5 个内容型模板
- [x] 主渲染器

### 待完成 🚧

- [ ] splitLayout 模板
- [ ] evolutionRoadmap 模板
- [ ] caseStudy 模板
- [ ] maturityModel 模板
- [ ] riskOpportunity 模板
- [ ] 图表集成（Chart.js / Recharts）
- [ ] 导出功能（PNG / PDF）
- [ ] 动画效果
- [ ] 辅助功能（A11y）

## 贡献指南

添加新模板组件时：

1. 在 `types/slides.ts` 中定义内容类型
2. 在 `templates/` 中创建模板组件
3. 在 `SlideRenderer.tsx` 中添加渲染逻辑
4. 更新文档

## 许可

MIT License - GenesisPod
