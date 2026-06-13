# PPT 生成系统架构重构计划 v4.0

> **核心目标**: 从"模板驱动"转变为"内容驱动"的智能布局系统
> **审核标准**:
>
> 1. 内容质量 - 观点清晰、逻辑完整、数据支撑
> 2. 呈现质量 - 最佳阅读和理解体验

---

## 一、当前系统核心缺陷

| 问题         | 根因                                   | 影响                |
| ------------ | -------------------------------------- | ------------------- |
| 模板生搬硬套 | `TEMPLATE_CAPACITY` 硬编码             | 内容被强制压缩/截断 |
| 栏目数固定   | `getMinSectionsForTemplate()`          | 5个支柱只能显示3个  |
| 对比方式僵化 | `renderComparisonSplit()` 只有左右二分 | 无法三栏对比        |
| 内容丢失     | `isPlaceholderText()` 过滤过激         | 有效内容被误删      |
| 渲染效果差   | pptxgenjs 坐标硬编码                   | 视觉原始            |
| 无反馈机制   | 内容→渲染单向流                        | 无法协商优化        |

---

## 二、新架构设计

### 2.1 整体架构（内容驱动）

```
┌─────────────────────────────────────────────────────────────────┐
│                    新架构：内容驱动                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [源文本] → [内容分析器] → [布局优化器] → [渲染引擎] → [PPTX]    │
│                ↓                ↑                               │
│           ContentAnalyzer  ←→  LayoutOptimizer                 │
│           (分析内容特征)      (选择最优布局)                      │
│                                    ↓                            │
│                            ParameterizedRenderer                │
│                            (参数化渲染，非硬编码)                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

旧架构（模板驱动）：
  源文本 → 压缩内容 → 套用固定模板 → 导出
  ❌ 内容适应模板

新架构（内容驱动）：
  源文本 → 分析内容 → 生成最优布局 → 参数化渲染
  ✅ 模板服务内容
```

### 2.2 核心组件

#### A. ContentAnalyzer（内容分析器）

**职责**: 分析内容的"形状"，提取布局决策所需的特征

```typescript
interface ContentFeatures {
  // 内容类型分布
  sectionTypes: {
    stat: number; // 统计数字数量
    list: number; // 列表数量
    text: number; // 文本段落数量
    chart: number; // 图表数量
    image: number; // 图片数量
  };

  // 内容量指标
  totalSections: number;
  totalCharacters: number;
  averageSectionLength: number;

  // 逻辑结构
  hasComparison: boolean; // 是否有对比关系
  comparisonItems: number; // 对比项数量（2/3/4...）
  hasTimeline: boolean; // 是否有时间线
  hasPillars: boolean; // 是否有支柱/核心要点
  pillarCount: number; // 支柱数量

  // 数据密度
  dataPointCount: number; // 数据点数量
  hasKeyInsight: boolean; // 是否有关键洞察
}
```

**文件**: `backend/src/modules/ai/ai-office/slides/skills/content-analyzer.skill.ts` (新建)

#### B. LayoutOptimizer（布局优化器）

**职责**: 根据内容特征选择/生成最优布局

```typescript
interface LayoutDecision {
  layoutType: DynamicLayoutType;

  // 动态参数（而非硬编码）
  gridConfig: {
    columns: number; // 1-4列
    rows: number; // 1-3行
    columnWidths: number[]; // 每列宽度比例
    rowHeights: number[]; // 每行高度比例
  };

  // 内容分配
  sectionPlacements: Array<{
    sectionIndex: number;
    gridArea: { col: number; row: number; colSpan: number; rowSpan: number };
    renderStyle: "card" | "inline" | "highlight" | "compact";
  }>;

  // 视觉层次
  hierarchy: {
    primaryFocus: number; // 主焦点 section 索引
    secondaryItems: number[]; // 次要项
    supportingItems: number[]; // 支撑项
  };
}

// 动态布局类型（取代固定的12种）
type DynamicLayoutType =
  | "single-focus" // 单焦点（封面、章节页）
  | "data-dashboard" // 数据仪表盘
  | "comparison-grid" // 对比网格（支持2-4列）
  | "content-flow" // 内容流（列表+文本）
  | "visual-story" // 视觉故事（图片+文字）
  | "pillar-showcase" // 支柱展示（支持2-6个）
  | "timeline-progress" // 时间线/进度
  | "insight-highlight"; // 洞察高亮
```

**文件**: `backend/src/modules/ai/ai-office/slides/skills/layout-optimizer.skill.ts` (新建)

#### C. ParameterizedRenderer（参数化渲染器）

**职责**: 根据布局参数动态计算坐标和样式，渲染到 PPTX

```typescript
interface RenderContext {
  slide: Slide;
  layout: LayoutDecision;
  content: PageContent;
  theme: PPTTheme;

  // 画布信息
  canvas: {
    width: number; // 13.33 inches
    height: number; // 7.5 inches
    margin: { top: number; right: number; bottom: number; left: number };
  };
}

class ParameterizedRenderer {
  // 核心方法：根据布局参数计算实际坐标
  private calculateGridPositions(layout: LayoutDecision): GridPositions {
    // 不是硬编码，而是根据 gridConfig 动态计算
  }

  // 渲染单个 section
  private renderSection(
    ctx: RenderContext,
    section: ContentSection,
    placement: SectionPlacement,
  ): void {
    // 根据 placement 和 renderStyle 动态渲染
  }
}
```

**文件**: `backend/src/modules/ai/ai-office/slides/rendering/parameterized-renderer.service.ts` (新建)

---

## 三、实现计划

### Phase 1: 内容分析器（ContentAnalyzer）

**目标**: 从内容中提取布局决策所需的特征

**修改文件**:

- 新建 `content-analyzer.skill.ts`
- 修改 `content-compression.skill.ts` - 调用分析器

**关键逻辑**:

```typescript
async analyze(content: PageContent): Promise<ContentFeatures> {
  const sections = content.sections || [];

  // 1. 统计内容类型
  const sectionTypes = this.countSectionTypes(sections);

  // 2. 检测逻辑结构
  const comparison = this.detectComparison(sections);
  const pillars = this.detectPillars(sections);
  const timeline = this.detectTimeline(sections);

  // 3. 计算数据密度
  const dataPoints = this.countDataPoints(sections);

  return {
    sectionTypes,
    totalSections: sections.length,
    hasComparison: comparison.detected,
    comparisonItems: comparison.count,
    hasPillars: pillars.detected,
    pillarCount: pillars.count,
    // ...
  };
}
```

### Phase 2: 布局优化器（LayoutOptimizer）

**目标**: 根据内容特征选择最优布局

**修改文件**:

- 新建 `layout-optimizer.skill.ts`
- 删除 `TEMPLATE_CAPACITY` 硬编码
- 删除 `getMinSectionsForTemplate()` 硬编码

**关键逻辑**:

```typescript
optimize(features: ContentFeatures): LayoutDecision {
  // 1. 选择布局类型
  const layoutType = this.selectLayoutType(features);

  // 2. 动态计算网格配置
  const gridConfig = this.calculateGrid(features, layoutType);

  // 3. 分配内容到网格
  const placements = this.placeSections(features, gridConfig);

  // 4. 确定视觉层次
  const hierarchy = this.determineHierarchy(features, placements);

  return { layoutType, gridConfig, sectionPlacements: placements, hierarchy };
}

private selectLayoutType(features: ContentFeatures): DynamicLayoutType {
  // 对比内容 → comparison-grid
  if (features.hasComparison && features.comparisonItems >= 2) {
    return 'comparison-grid';
  }

  // 多个支柱 → pillar-showcase
  if (features.hasPillars && features.pillarCount >= 3) {
    return 'pillar-showcase';
  }

  // 数据密集 → data-dashboard
  if (features.sectionTypes.stat >= 3 || features.sectionTypes.chart >= 1) {
    return 'data-dashboard';
  }

  // 默认 → content-flow
  return 'content-flow';
}

private calculateGrid(features: ContentFeatures, layoutType: DynamicLayoutType): GridConfig {
  switch (layoutType) {
    case 'comparison-grid':
      // 动态列数：2个对比项=2列，3个=3列，4个=4列
      return {
        columns: Math.min(features.comparisonItems, 4),
        rows: 1,
        columnWidths: this.equalWidths(features.comparisonItems),
        rowHeights: [1],
      };

    case 'pillar-showcase':
      // 动态列数：根据支柱数量
      const cols = features.pillarCount <= 3 ? features.pillarCount : Math.ceil(features.pillarCount / 2);
      const rows = features.pillarCount <= 3 ? 1 : 2;
      return { columns: cols, rows, ... };

    // ... 其他布局类型
  }
}
```

### Phase 3: 参数化渲染器（ParameterizedRenderer）

**目标**: 取代硬编码的 12 个 `renderXXX()` 方法

**修改文件**:

- 新建 `parameterized-renderer.service.ts`
- 重构 `slides-export.service.ts` - 调用新渲染器

**关键逻辑**:

```typescript
async render(ctx: RenderContext): Promise<void> {
  const { slide, layout, content, theme } = ctx;

  // 1. 计算网格位置
  const positions = this.calculateGridPositions(layout);

  // 2. 渲染背景
  this.renderBackground(slide, theme);

  // 3. 渲染标题区
  this.renderTitleArea(slide, content, layout.hierarchy);

  // 4. 渲染各 section（动态位置）
  for (const placement of layout.sectionPlacements) {
    const section = content.sections[placement.sectionIndex];
    const position = positions[placement.gridArea];
    await this.renderSection(slide, section, position, placement.renderStyle);
  }

  // 5. 渲染页脚
  this.renderFooter(slide, theme);
}

private calculateGridPositions(layout: LayoutDecision): GridPositions {
  const { canvas } = this;
  const { gridConfig } = layout;

  const contentWidth = canvas.width - canvas.margin.left - canvas.margin.right;
  const contentHeight = canvas.height - canvas.margin.top - canvas.margin.bottom;

  const positions: GridPositions = {};

  let y = canvas.margin.top + 1.2; // 标题区下方

  for (let row = 0; row < gridConfig.rows; row++) {
    const rowHeight = contentHeight * gridConfig.rowHeights[row];
    let x = canvas.margin.left;

    for (let col = 0; col < gridConfig.columns; col++) {
      const colWidth = contentWidth * gridConfig.columnWidths[col];

      positions[`${row}-${col}`] = {
        x,
        y,
        w: colWidth - 0.2, // 间距
        h: rowHeight - 0.2,
      };

      x += colWidth;
    }

    y += rowHeight;
  }

  return positions;
}
```

### Phase 4: 反馈机制

**目标**: 渲染层可以反馈约束给内容层

**修改文件**:

- 修改 `slides-orchestrator.service.ts`
- 新增 `layout-feedback.types.ts`

**关键逻辑**:

```typescript
interface LayoutFeedback {
  success: boolean;

  // 如果失败，提供约束信息
  constraints?: {
    maxSections: number;
    maxCharactersPerSection: number;
    suggestedSplit?: number; // 建议拆分成几页
  };

  // 建议调整
  suggestions?: {
    mergeSections?: number[]; // 建议合并的 section 索引
    removeSections?: number[]; // 建议删除的 section 索引
  };
}

// 在 orchestrator 中实现反馈循环
async generatePage(outline: PageOutline): Promise<GeneratedSlide[]> {
  let content = await this.writer.generateContent(outline);
  let features = await this.analyzer.analyze(content);
  let layout = await this.optimizer.optimize(features);

  // 尝试渲染
  const feedback = await this.renderer.tryRender(content, layout);

  if (!feedback.success) {
    // 根据反馈调整内容
    if (feedback.constraints?.suggestedSplit) {
      // 拆分成多页
      return this.splitAndGenerate(content, feedback.constraints.suggestedSplit);
    }

    if (feedback.suggestions?.mergeSections) {
      // 合并 sections
      content = this.mergeSections(content, feedback.suggestions.mergeSections);
      // 重新尝试
      return this.generatePage(outline); // 递归
    }
  }

  return [await this.renderer.render(content, layout)];
}
```

---

## 四、关键文件修改清单

| 文件                                | 操作 | 说明                                   |
| ----------------------------------- | ---- | -------------------------------------- |
| `content-analyzer.skill.ts`         | 新建 | 内容特征分析                           |
| `layout-optimizer.skill.ts`         | 新建 | 布局决策引擎                           |
| `parameterized-renderer.service.ts` | 新建 | 参数化渲染器                           |
| `layout-feedback.types.ts`          | 新建 | 反馈机制类型                           |
| `content-compression.skill.ts`      | 重构 | 删除硬编码，调用分析器                 |
| `slides-export.service.ts`          | 重构 | 使用新渲染器，删除 12 个 `renderXXX()` |
| `slides-orchestrator.service.ts`    | 重构 | 实现反馈循环                           |

---

## 五、执行顺序

```
Phase 1: ContentAnalyzer
    ├── 新建 content-analyzer.skill.ts
    └── 定义 ContentFeatures 类型
    ↓
Phase 2: LayoutOptimizer
    ├── 新建 layout-optimizer.skill.ts
    ├── 定义 LayoutDecision 类型
    └── 实现布局选择算法
    ↓
Phase 3: ParameterizedRenderer
    ├── 新建 parameterized-renderer.service.ts
    ├── 实现网格计算
    └── 实现各类型 section 渲染
    ↓
Phase 4: 集成与反馈
    ├── 重构 slides-orchestrator.service.ts
    ├── 实现反馈循环
    └── 删除旧的硬编码逻辑
    ↓
Phase 5: 清理与测试
    ├── 删除 TEMPLATE_CAPACITY
    ├── 删除 getMinSectionsForTemplate()
    └── 验证测试
```

---

## 六、验证标准

### 内容质量审核

- [ ] 内容不被强制截断（根据需要自动拆页）
- [ ] 对比项数量动态支持（2/3/4/...）
- [ ] 支柱数量动态支持（不是固定3个）
- [ ] 数据点完整保留

### 呈现质量审核

- [ ] 布局根据内容自适应
- [ ] 视觉层次清晰（主次分明）
- [ ] 信息密度适中（不拥挤/不稀疏）
- [ ] 阅读流畅（从左到右、从上到下）

### 技术质量审核

- [ ] 无硬编码坐标
- [ ] 类型安全
- [ ] 向后兼容
- [ ] 测试覆盖

---

**计划版本**: 4.0 - 内容驱动架构重构版
**创建日期**: 2026-01-01
**状态**: 已批准，待实施
