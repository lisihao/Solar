# 智能模板选择引擎

> AI 驱动的内容特征分析与模板智能匹配系统

## 一、引擎概述

### 1.1 核心目标

模板选择引擎的核心任务是：**分析内容特征，选择最佳模板**

```
┌─────────────────────────────────────────────────────────────┐
│                Template Selection Engine                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  内容块 ──► 特征提取器 ──► 决策规则 ──► 模板+参数           │
│                                                             │
│  Content    Feature      Decision    Template               │
│  Block      Extractor    Rules       Config                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 设计原则

1. **内容驱动**: 始终从内容特征出发，而非预设模板
2. **多因素权衡**: 综合考虑目的、数据、结构、情感等维度
3. **上下文感知**: 考虑前后页面，保持连贯又有变化
4. **动态适应**: 模板确定后，参数仍需根据具体内容调整
5. **可解释性**: 每次选择都要能说明理由，便于调试优化

---

## 二、内容特征分类体系

### 2.1 特征模型定义

```typescript
interface ContentFeatures {
  // ========== 数据特征 ==========
  dataType: "quantitative" | "qualitative" | "mixed" | "none";
  dataDensity: "high" | "medium" | "low";
  hasTimeSeries: boolean;
  hasComparison: boolean;
  comparisonDimensions: number; // 对比的维度数量

  // ========== 结构特征 ==========
  structureType:
    | "hierarchical" // 层级结构
    | "parallel" // 并列结构
    | "sequential" // 顺序结构
    | "contrasting" // 对比结构
    | "narrative"; // 叙事结构
  elementCount: number; // 核心信息点数量
  hasProcessFlow: boolean; // 是否有流程
  hasLevelsOrStages: boolean; // 是否有层级/阶段

  // ========== 内容性质 ==========
  contentPurpose:
    | "introduce" // 介绍引入
    | "analyze" // 分析论证
    | "compare" // 对比评估
    | "conclude" // 总结归纳
    | "recommend" // 建议行动
    | "warn" // 风险警示
    | "showcase"; // 案例展示
  argumentType: "thesis" | "evidence" | "synthesis" | "action";
  emotionalTone: "neutral" | "positive" | "cautionary" | "urgent";

  // ========== 视觉需求 ==========
  needsVisualization: boolean;
  visualizationType:
    | "chart" // 图表
    | "diagram" // 示意图
    | "iconGrid" // 图标网格
    | "timeline" // 时间线
    | "matrix" // 矩阵
    | "none";
  spacePriority: "text" | "visual" | "balanced";
}
```

### 2.2 特征提取规则

| 特征维度     | 识别信号             | 提取方法          |
| ------------ | -------------------- | ----------------- |
| **数据类型** | 数字、百分比、金额   | 正则匹配+语义分析 |
| **时间序列** | 年份、日期、阶段词   | 时间关键词识别    |
| **对比结构** | "vs"、"对比"、"相比" | 对比词汇检测      |
| **层级结构** | L1/L2、级别、层次    | 层级标识符识别    |
| **并列结构** | "三大"、"四个"、枚举 | 并列数量词检测    |
| **内容目的** | 动词意图分析         | 意图分类模型      |
| **情感基调** | 风险词、机遇词       | 情感词典匹配      |

---

## 三、决策树设计

### 3.1 主决策流程

```
START: 分析当前内容块
        │
        ▼
┌───────────────────┐
│ Q1: 是否为结构性页面? │
│ (封面/目录/章节标题) │
└─────────┬─────────┘
          │
    ┌─────┴─────┐
    Yes         No
    │           │
    ▼           ▼
[固定模板]    ┌───────────────────┐
              │ Q2: 内容核心目的是? │
              └─────────┬─────────┘
                        │
        ┌───────┬───────┼───────┬───────┬───────┐
        ▼       ▼       ▼       ▼       ▼       ▼
     展示趋势  对比分析  层级展示  数据展示  行动建议  综合分析
        │       │       │       │       │       │
        ▼       ▼       ▼       ▼       ▼       ▼
   [规则集A] [规则集B] [规则集C] [规则集D] [规则集E] [规则集F]
```

### 3.2 规则集详解

#### 规则集 A: 趋势/演进类内容

```python
def select_template_for_trend(features: ContentFeatures) -> str:
    """
    当内容核心是展示趋势、演进、发展历程时的模板选择
    """

    # 规则 A1: 有明确时间节点的历史演进
    if features.hasTimeSeries and features.elementCount >= 3:
        if features.elementCount <= 5:
            return "timeline"  # 时间线页
        else:
            return "evolutionRoadmap"  # 演进路线图（更复杂）

    # 规则 A2: 阶段性能力演进（如L1→L2→L3）
    if features.hasLevelsOrStages:
        if features.structureType == 'sequential':
            return "evolutionRoadmap"
        else:
            return "maturityModel"  # 成熟度模型

    # 规则 A3: 数据驱动的趋势展示
    if features.dataDensity == 'high':
        return "dashboard"  # 数据仪表盘，用图表展示趋势

    # 规则 A4: 叙事性的趋势描述
    return "splitLayout"  # 左文字右图表
```

**决策表**:

| 条件               | 模板               | 示例场景           |
| ------------------ | ------------------ | ------------------ |
| 时间序列 + 3-5阶段 | `timeline`         | "AI政策四个阶段"   |
| 时间序列 + 6+阶段  | `evolutionRoadmap` | "技术发展十年路线" |
| 层级阶段 + 顺序    | `evolutionRoadmap` | "能力演进三阶段"   |
| 层级阶段 + 非顺序  | `maturityModel`    | "L0-L5成熟度"      |
| 高密度数据         | `dashboard`        | "市场增长趋势图表" |
| 叙事性趋势         | `splitLayout`      | "行业发展概述"     |

---

#### 规则集 B: 对比/比较类内容

```python
def select_template_for_comparison(features: ContentFeatures) -> str:
    """
    当内容核心是对比、比较、竞争分析时的模板选择
    """

    comparison_count = features.comparisonDimensions

    # 规则 B1: 二元对比（A vs B）
    if comparison_count == 2:
        if features.emotionalTone == 'cautionary':
            return "riskOpportunity"  # 风险/机遇对比
        elif features.dataDensity == 'high':
            return "comparison"  # 并排对比（带数据）
        else:
            return "splitLayout"  # 左右分栏

    # 规则 B2: 三项对比
    if comparison_count == 3:
        return "multiColumn"  # 三栏并列

    # 规则 B3: 四项及以上对比
    if comparison_count >= 4:
        if comparison_count <= 5:
            return "multiColumn"  # 4-5栏并列
        else:
            return "caseStudy"  # 案例卡片网格（更灵活）

    # 规则 B4: 多维度对比（如公司 × 指标）
    if features.structureType == 'contrasting':
        return "comparison"  # 对比表格形式

    return "splitLayout"  # 默认
```

**决策表**:

| 条件            | 模板              | 示例场景         |
| --------------- | ----------------- | ---------------- |
| 2项 + 风险/机遇 | `riskOpportunity` | "泡沫vs理性繁荣" |
| 2项 + 高数据    | `comparison`      | "两产品详细对比" |
| 2项 + 低数据    | `splitLayout`     | "两种观点阐述"   |
| 3项             | `multiColumn`     | "三大支柱"       |
| 4-5项           | `multiColumn`     | "五大趋势"       |
| 6+项            | `caseStudy`       | "多案例展示"     |

---

#### 规则集 C: 层级/框架类内容

```python
def select_template_for_hierarchy(features: ContentFeatures) -> str:
    """
    当内容是展示框架、体系、层级结构时的模板选择
    """

    level_count = features.elementCount

    # 规则 C1: 成熟度/等级模型（L0-L5类）
    if features.hasLevelsOrStages and features.structureType == 'hierarchical':
        return "maturityModel"

    # 规则 C2: 并列支柱/要素（如"三大支柱"）
    if features.structureType == 'parallel':
        if level_count <= 3:
            return "multiColumn"  # 三栏并列
        elif level_count <= 5:
            return "multiColumn"  # 五栏并列
        else:
            return "splitLayout"  # 左侧概述 + 右侧列表

    # 规则 C3: 流程/步骤类
    if features.hasProcessFlow:
        if level_count <= 4:
            return "evolutionRoadmap"  # 流程展示
        else:
            return "splitLayout"  # 步骤卡片列表

    # 规则 C4: 分类体系
    return "multiColumn"  # 默认并列展示
```

**决策表**:

| 条件            | 模板               | 示例场景           |
| --------------- | ------------------ | ------------------ |
| 层级 + 等级模型 | `maturityModel`    | "Data Agent L0-L5" |
| 并列 + ≤3项     | `multiColumn`      | "三大战略方向"     |
| 并列 + 4-5项    | `multiColumn`      | "五大核心能力"     |
| 并列 + 6+项     | `splitLayout`      | "八大要素清单"     |
| 流程 + ≤4步     | `evolutionRoadmap` | "四步实施流程"     |
| 流程 + 5+步     | `splitLayout`      | "详细操作步骤"     |

---

#### 规则集 D: 数据展示类内容

```python
def select_template_for_data(features: ContentFeatures) -> str:
    """
    当内容主要是数据、指标展示时的模板选择
    """

    # 规则 D1: 高密度多指标
    if features.dataDensity == 'high' and features.elementCount >= 4:
        return "dashboard"  # KPI卡片 + 图表组合

    # 规则 D2: 单一主题数据分析
    if features.visualizationType == 'chart':
        if features.spacePriority == 'visual':
            return "dashboard"  # 图表为主
        else:
            return "splitLayout"  # 左分析右图表

    # 规则 D3: 对比性数据
    if features.hasComparison:
        return "comparison"  # 对比卡片 + 数据

    # 规则 D4: 监测/指标体系
    if features.contentPurpose == 'warn':
        return "riskOpportunity"  # 带风险指示

    return "dashboard"  # 默认仪表盘
```

**决策表**:

| 条件            | 模板              | 示例场景       |
| --------------- | ----------------- | -------------- |
| 高密度 + 4+指标 | `dashboard`       | "关键业务指标" |
| 图表 + 视觉优先 | `dashboard`       | "市场数据大图" |
| 图表 + 分析优先 | `splitLayout`     | "数据解读分析" |
| 对比性数据      | `comparison`      | "竞品数据对比" |
| 风险警示数据    | `riskOpportunity` | "风险监测指标" |

---

#### 规则集 E: 建议/行动类内容

```python
def select_template_for_recommendations(features: ContentFeatures) -> str:
    """
    当内容是给出建议、行动指南时的模板选择
    """

    rec_count = features.elementCount

    # 规则 E1: 少量关键建议（≤4条）
    if rec_count <= 4:
        if features.emotionalTone == 'urgent':
            return "recommendations"  # 带CTA的建议页
        else:
            return "multiColumn"  # 并列展示

    # 规则 E2: 多条建议（5-7条）
    if rec_count <= 7:
        return "recommendations"  # 建议网格 + 时间线

    # 规则 E3: 大量建议（>7条）
    return "splitLayout"  # 左侧分类 + 右侧详细列表

    # 规则 E4: 带时间节点的行动路线
    if features.hasTimeSeries:
        return "recommendations"  # 底部带时间轴
```

**决策表**:

| 条件        | 模板              | 示例场景         |
| ----------- | ----------------- | ---------------- |
| ≤4条 + 紧迫 | `recommendations` | "四大紧急行动"   |
| ≤4条 + 普通 | `multiColumn`     | "四个建议方向"   |
| 5-7条       | `recommendations` | "七项战略建议"   |
| >7条        | `splitLayout`     | "详细行动清单"   |
| 带时间节点  | `recommendations` | "分阶段行动路线" |

---

## 四、上下文感知选择

### 4.1 上下文规则

```python
def select_with_context(
    current_content: ContentBlock,
    previous_pages: List[Page],
    chapter_context: ChapterContext
) -> str:
    """
    结合上下文优化模板选择
    """

    # 获取基础模板推荐
    base_template = select_template(current_content)

    # 规则 1: 避免连续使用相同模板
    if len(previous_pages) > 0:
        last_template = previous_pages[-1].template
        if base_template == last_template:
            base_template = get_alternative_template(base_template, current_content)

    # 规则 2: 章节内模板多样性
    chapter_templates = [p.template for p in previous_pages
                         if p.chapter == chapter_context]
    template_variety = len(set(chapter_templates))
    if template_variety < 2 and len(chapter_templates) >= 3:
        base_template = get_different_template(base_template, chapter_templates)

    # 规则 3: 数据页和分析页交替
    if is_data_heavy(previous_pages[-1]) and is_data_heavy_template(base_template):
        if can_be_narrative(current_content):
            base_template = "splitLayout"

    # 规则 4: 章节结尾收敛
    if is_near_chapter_end(chapter_context):
        if base_template not in ['chapterSummary', 'splitLayout']:
            base_template = adjust_for_conclusion(base_template)

    return base_template
```

### 4.2 上下文规则表

| 规则         | 条件               | 调整策略        |
| ------------ | ------------------ | --------------- |
| **避免重复** | 连续2页相同模板    | 切换到备选模板  |
| **保持多样** | 章节内3页仅1种模板 | 强制引入新类型  |
| **节奏交替** | 连续数据密集页     | 插入叙事性模板  |
| **章节收敛** | 接近章节结尾       | 倾向总结性布局  |
| **开篇展开** | 章节开始           | 优先背景/时间线 |

### 4.3 备选模板映射

```typescript
const alternativeTemplates: Record<string, string[]> = {
  timeline: ["evolutionRoadmap", "splitLayout"],
  multiColumn: ["splitLayout", "caseStudy"],
  splitLayout: ["multiColumn", "dashboard"],
  dashboard: ["splitLayout", "comparison"],
  comparison: ["multiColumn", "caseStudy"],
  caseStudy: ["multiColumn", "splitLayout"],
  maturityModel: ["evolutionRoadmap", "splitLayout"],
  riskOpportunity: ["comparison", "splitLayout"],
  recommendations: ["multiColumn", "splitLayout"],
  evolutionRoadmap: ["timeline", "splitLayout"],
};
```

---

## 五、动态布局参数调整

### 5.1 参数调整逻辑

```typescript
function adjustLayoutParams(
  template: string,
  content: ContentBlock,
): LayoutParams {
  const params = getDefaultParams(template);

  switch (template) {
    case "multiColumn":
      // 自动计算栏数
      params.columnCount = Math.min(
        5,
        Math.max(2, content.mainElements.length),
      );

      // 根据内容长度调整
      const maxContentLength = Math.max(
        ...content.mainElements.map((e) => e.description.length),
      );
      if (maxContentLength > 200) {
        params.columnCount = Math.min(params.columnCount, 3);
      }

      // 是否显示图标
      params.showIcons = content.mainElements.every((e) => e.canBeIconified);

      // 是否有KPI
      params.hasKpiFooter = content.mainElements.some((e) => e.hasMetric);
      break;

    case "splitLayout":
      // 计算左右比例
      const leftWeight = calculateContentWeight(content.leftPanel);
      const rightWeight = calculateContentWeight(content.rightPanel);
      const total = leftWeight + rightWeight;
      params.ratio = `${Math.round((leftWeight / total) * 100)}:${Math.round((rightWeight / total) * 100)}`;
      break;

    case "dashboard":
      // KPI卡片数量
      const kpiCount = content.dataPoints.filter((d) => d.isKeyMetric).length;
      params.kpiCount = Math.min(4, kpiCount);

      // 图表布局
      const chartCount = content.charts.length;
      if (chartCount === 1) {
        params.chartLayout = "fullWidth";
      } else if (chartCount === 2) {
        params.chartLayout = "sideBySide";
      } else {
        params.chartLayout = "grid";
      }
      break;

    case "timeline":
      // 时间轴方向
      params.axis = content.periods.length > 4 ? "vertical" : "horizontal";
      break;
  }

  return params;
}
```

### 5.2 参数调整规则表

| 模板          | 参数        | 调整规则                      |
| ------------- | ----------- | ----------------------------- |
| `multiColumn` | columnCount | min(5, max(2, 元素数量))      |
| `multiColumn` | columnCount | 内容>200字时限制≤3栏          |
| `splitLayout` | ratio       | 根据左右内容权重计算          |
| `dashboard`   | kpiCount    | min(4, 关键指标数)            |
| `dashboard`   | chartLayout | 1图=fullWidth, 2图=sideBySide |
| `timeline`    | axis        | >4阶段时用vertical            |

---

## 六、AI Agent 提示词设计

### 6.1 模板选择 Prompt

````markdown
# Template Selection Agent

## 你的角色

你是一个专业的报告版式设计专家。你的任务是分析内容特征，选择最佳的页面模板。

## 决策流程

### Step 1: 内容特征提取

分析给定内容，提取以下特征：

```json
{
  "content_summary": "一句话概括这页要表达什么",
  "primary_purpose": "introduce|analyze|compare|conclude|recommend|warn|showcase",
  "data_characteristics": {
    "has_numbers": true/false,
    "data_density": "high|medium|low|none",
    "has_time_dimension": true/false,
    "comparison_items": 0-N
  },
  "structure_characteristics": {
    "main_elements_count": N,
    "structure_type": "hierarchical|parallel|sequential|contrasting|narrative",
    "has_sub_items": true/false,
    "depth_levels": N
  },
  "presentation_needs": {
    "needs_visual": true/false,
    "visual_type": "chart|diagram|icons|timeline|matrix|none",
    "text_to_visual_ratio": "text_heavy|balanced|visual_heavy"
  }
}
```
````

### Step 2: 应用决策规则

根据提取的特征，按以下优先级匹配模板：

**优先级1：内容目的匹配**

- 对比分析 → comparison / riskOpportunity / multiColumn
- 趋势演进 → timeline / evolutionRoadmap
- 框架展示 → multiColumn / maturityModel
- 行动建议 → recommendations
- 数据展示 → dashboard

**优先级2：元素数量适配**

- 2个主元素 → splitLayout / riskOpportunity
- 3个主元素 → multiColumn (3-col)
- 4-5个主元素 → multiColumn (4-5-col) / caseStudy
- 6+个主元素 → splitLayout (列表形式) / recommendations

**优先级3：数据密度适配**

- 高密度数据 → dashboard
- 中等数据 → splitLayout (带图表)
- 低/无数据 → multiColumn / splitLayout (纯文字)

### Step 3: 输出决策

```json
{
  "selected_template": "模板名称",
  "selection_reasoning": "选择该模板的原因，50字以内",
  "layout_variant": "模板的具体变体配置",
  "alternative_template": "备选模板（如果首选不可行）"
}
```

## 禁止的模板误用

❌ 不要用 `timeline` 展示非时间序列内容
❌ 不要用 `dashboard` 展示纯文字分析
❌ 不要用 `multiColumn` 展示超过5个并列项
❌ 不要用 `comparison` 展示单一主体分析
❌ 不要用 `maturityModel` 展示非层级内容

````

### 6.2 决策示例

#### 示例 1: 时间演进

**内容**: "美国AI政策演进四个阶段：2016-2019市场引导期、2020-2022产业成型期、2023-2024治理并进期、2025+举国体制期"

**特征分析**:
- purpose: analyze（分析演进）
- has_time_dimension: true
- main_elements_count: 4
- structure_type: sequential

**决策**: `timeline`
**理由**: 有明确时间节点，4个阶段按时间顺序排列，时间线最直观

---

#### 示例 2: 项目对比

**内容**: "Genesis与Stargate两大项目对比：Genesis是ASSP国家级安全AI平台，Stargate是10GW级算力集群超级工程，两者体现国家意志×巨头执行的模式"

**特征分析**:
- purpose: compare
- comparison_items: 2
- data_density: medium
- structure_type: contrasting

**决策**: `comparison`
**理由**: 两个项目并排对比，各有多个属性，对比页最清晰

---

#### 示例 3: 建议清单

**内容**: "对我司的七项关键建议：1.坚定盘古基础大模型 2.打造Data Agent 3.构建数据联盟 4.优先布局AI4Sci 5.鸿蒙端侧Agent标准化 6.AI2D加速迁移 7.加强政策沟通"

**特征分析**:
- purpose: recommend
- main_elements_count: 7
- structure_type: parallel
- emotional_tone: urgent

**决策**: `recommendations`
**理由**: 7条建议是典型的行动清单，需要编号展示+CTA引导

---

#### 示例 4: 双支柱战略

**内容**: "NVIDIA的双支柱战略——企业级AI（NIMs微服务降低门槛）和主权AI（为各国政府提供本土化方案），毛利率维持70%+，核心护城河是软件生态"

**特征分析**:
- purpose: analyze
- main_elements_count: 2 (双支柱)
- data_density: medium
- has_sub_items: true

**决策**: `splitLayout`
**理由**: 左侧放战略概述和关键指标，右侧用两个卡片展示双支柱详情

---

#### 示例 5: 成熟度模型

**内容**: "Data Agent成熟度L0-L5：L0无辅助、L1增强展示、L2部分辅助、L3有条件自治、L4高度自治、L5完全自主"

**特征分析**:
- purpose: showcase（展示框架）
- main_elements_count: 6
- structure_type: hierarchical
- has_levels_or_stages: true

**决策**: `maturityModel`
**理由**: 明确的等级递进结构，成熟度模型页专为此设计

---

## 七、模板选择速查表

### 7.1 按内容特征快速选择

| 内容特征组合 | 首选模板 | 备选模板 | 决策关键点 |
|-------------|---------|---------|-----------|
| 时间+3-5阶段+顺序 | `timeline` | `evolutionRoadmap` | 时间轴是否为核心 |
| 时间+能力演进+阶段 | `evolutionRoadmap` | `maturityModel` | 是否强调能力跃迁 |
| 2项对比+高数据 | `comparison` | `splitLayout` | 数据是否需要可视化 |
| 2项对比+风险/机遇 | `riskOpportunity` | `comparison` | 是否有正反论证 |
| 3项并列+框架 | `multiColumn` | `splitLayout` | 每项内容复杂度 |
| 4-5项并列+案例 | `caseStudy` | `multiColumn` | 是否有KPI数据 |
| 层级+5-6级 | `maturityModel` | `splitLayout` | 是否为递进关系 |
| 高密度数据+多指标 | `dashboard` | `splitLayout` | 图表数量 |
| 5-7条建议+行动 | `recommendations` | `multiColumn` | 是否有时间节点 |
| 深度分析+数据佐证 | `splitLayout` | `dashboard` | 文字vs图表比重 |

### 7.2 按场景快速选择

| 场景 | 推荐模板 | 理由 |
|------|---------|------|
| 政策/技术演进 | `timeline` | 时间维度是核心 |
| 竞品对比分析 | `comparison` | 多维度并排对比 |
| 市场数据展示 | `dashboard` | KPI+图表组合 |
| 战略框架展示 | `multiColumn` | 并列要素清晰 |
| 能力成熟度 | `maturityModel` | 层级递进可视 |
| 风险机遇评估 | `riskOpportunity` | 正反对比明确 |
| 案例最佳实践 | `caseStudy` | 案例卡片展示 |
| 行动建议清单 | `recommendations` | 编号+CTA引导 |
| 深度分析论证 | `splitLayout` | 论点+证据结合 |

---

## 八、服务实现规范

### 8.1 服务接口定义

```typescript
// backend/src/modules/ai/ai-office/services/template-selector.service.ts

@Injectable()
export class TemplateSelectorService {
  /**
   * 分析内容特征
   */
  analyzeContentFeatures(content: ContentBlock): ContentFeatures;

  /**
   * 选择最佳模板
   */
  selectTemplate(
    content: ContentBlock,
    context?: SelectionContext
  ): TemplateSelection;

  /**
   * 调整布局参数
   */
  adjustLayoutParams(
    template: PageTemplate,
    content: ContentBlock
  ): LayoutParams;

  /**
   * 获取备选模板
   */
  getAlternativeTemplate(
    template: PageTemplate,
    content: ContentBlock
  ): PageTemplate;
}

interface TemplateSelection {
  template: PageTemplate;
  reasoning: string;
  confidence: number;  // 0-1
  params: LayoutParams;
  alternative?: PageTemplate;
}

interface SelectionContext {
  previousPages: PageConfig[];
  chapterContext: ChapterContext;
  reportType: 'quick' | 'standard' | 'deep';
}
````

### 8.2 使用流程

```typescript
// 在报告生成流程中使用
async function generateReportPage(
  content: ContentBlock,
  context: SelectionContext,
) {
  // 1. 选择模板
  const selection = templateSelector.selectTemplate(content, context);

  // 2. 调整参数
  const params = templateSelector.adjustLayoutParams(
    selection.template,
    content,
  );

  // 3. 生成页面配置
  const pageConfig = buildPageConfig(content, selection.template, params);

  // 4. 渲染页面
  return renderPage(pageConfig);
}
```

---

## 九、参考资料

- [设计概述](./design-overview.md)
- [页面模板规范](./page-template-specification.md)
- [视觉设计系统](./visual-design-system.md)

---

**文档版本**: v1.0
**创建日期**: 2024-12-28
