# AI Slides v3.1 视觉升级 PRD

> **文档类型**: 产品需求文档 (PRD)
> **版本**: v1.0
> **作者**: PM Agent
> **创建日期**: 2025-12-31
> **状态**: 待评审
> **优先级**: P0 - 核心体验优化
> **关联文档**: `ai-slides-v3-optimization-plan.md`（完整版8周方案）

---

## 文档信息

| 项目         | 说明                                     |
| ------------ | ---------------------------------------- |
| **目标**     | 2周内达到Genspark 80%视觉效果            |
| **范围**     | AI Slides v3 渲染引擎的视觉输出质量提升  |
| **非目标**   | 不涉及内容生成算法优化、不涉及新模板开发 |
| **前提条件** | 已完成同源导出（PDF/PNG/PPTX视觉一致）   |

---

## 一、背景与目标

### 1.1 项目背景

基于对 Genspark AI Slides 的竞品分析，发现我们的 AI Slides v3 在**视觉呈现**上存在明显差距，尽管在架构完整度、模板数量、版本管理等方面已领先。

**核心矛盾**：

- 已有完善的设计系统代码（5套主题、装饰元素、动画系统）
- 但这些能力**未被正确启用和调用**
- 导致用户感知的视觉质量远低于系统潜力

### 1.2 用户价值分析

| 用户痛点     | 当前体验                    | 目标体验                  | 价值量化        |
| ------------ | --------------------------- | ------------------------- | --------------- |
| PPT视觉单调  | 仅1套深色主题，无装饰       | 5套主题可选，装饰元素丰富 | 用户选择权+500% |
| 图表区域空白 | dashboard/trend模板显示空白 | 图表正常渲染              | 模板可用率+30%  |
| 无配图       | 纯文字/图标                 | 关键页面有语义匹配配图    | 视觉丰富度+200% |
| 内容溢出     | 文字超出边界                | 自动压缩/分页             | 布局问题率-80%  |

### 1.3 量化目标

| 指标           | 基准值 | Week 1目标 | Week 2目标 | 验证方法    |
| -------------- | ------ | ---------- | ---------- | ----------- |
| 视觉专家评分   | 65/100 | 75/100     | 85/100     | 3人评审打分 |
| 主题可用数     | 1套    | 5套        | 5套        | 功能验证    |
| 模板变量替换率 | 70%    | 90%        | 95%        | 自动化测试  |
| 图表渲染成功率 | 0%     | 80%        | 95%        | 自动化测试  |
| 布局溢出率     | 20%    | 10%        | 5%         | 自动化测试  |

---

## 二、现状诊断

### 2.1 核心差距矩阵

| 问题         | 影响     | 根因分析                | 解决难度           | 优先级 |
| ------------ | -------- | ----------------------- | ------------------ | ------ |
| 主题未启用   | 视觉单调 | 渲染层未调用theme变量   | **低**（代码已有） | P0     |
| 装饰未启用   | 缺乏层次 | 渲染层未注入decoration  | **低**（代码已有） | P0     |
| 图表空白     | 致命     | 图表数据未传递给ECharts | 中                 | P0     |
| 变量替换不准 | 内容缺失 | 模板变量映射不完整      | 中                 | P0     |
| 无配图       | 视觉单薄 | 无图片服务集成          | 低                 | P1     |
| 内容溢出     | 布局混乱 | 缺乏溢出检测/处理       | 中                 | P1     |

### 2.2 已有但未启用的能力

```
已实现代码清单：

1. 主题系统 (themes.ts - 682行)
   - 5套完整主题配置
   - CSS变量生成函数
   - 主题切换API

2. 装饰系统 (decorations.ts - 666行)
   - 角落装饰（4个位置）
   - 光晕效果（3种强度）
   - 渐变条（4个方向）
   - 几何图形（5种形状）

3. ECharts生成器 (echarts-generator.ts)
   - 图表配置生成
   - 主题化图表样式

4. 设计令牌 (design-tokens.ts)
   - 统一的排版系统
   - 间距和颜色变量
```

### 2.3 问题根因分析

```
渲染层调用链：

  Orchestrator -> Writer -> Renderer -> Template
        |            |          |           |
        |            |          |           v
        |            |          |     HTML模板（硬编码样式）
        |            |          |
        |            |          v
        |            |     template-rendering.skill.ts
        |            |       - 未调用getTheme()
        |            |       - 未调用getThemeDecorationHtml()
        |            |       - 变量替换逻辑不完整
        |            v
        |     writer.service.ts
        |       - 未传递themeId
        v
  slides-orchestrator-v3.service.ts
    - 缺少主题选择逻辑
```

**结论**：问题不是"代码没有"，而是"调用链断开"。

---

## 三、用户故事

### 3.1 角色定义

- **普通用户**：需要快速生成专业PPT的职场人士
- **高级用户**：对视觉有更高要求，需要定制主题的用户

### 3.2 用户故事清单

| ID     | 角色     | 故事                                                  | 优先级 | AC（验收标准）                  |
| ------ | -------- | ----------------------------------------------------- | ------ | ------------------------------- |
| US-001 | 普通用户 | 作为用户，我希望生成的PPT有视觉装饰，这样看起来更专业 | P0     | 每页都有角落装饰和渐变条        |
| US-002 | 普通用户 | 作为用户，我希望图表能正常显示，而不是空白区域        | P0     | dashboard/trend模板图表正常渲染 |
| US-003 | 高级用户 | 作为用户，我希望能选择不同的主题风格                  | P0     | 5套主题可切换，切换后即时预览   |
| US-004 | 普通用户 | 作为用户，我希望内容不会溢出页面边界                  | P1     | 无文字溢出边界的情况            |
| US-005 | 高级用户 | 作为用户，我希望PPT有合适的配图                       | P1     | 封面和关键页面有语义匹配的配图  |
| US-006 | 普通用户 | 作为用户，我希望变量替换完整，没有`{{XXX}}`残留       | P0     | 变量替换率 > 95%                |

---

## 四、功能需求

### 4.1 功能列表

| ID    | 功能名称     | 描述                      | 优先级 | 预估工时 |
| ----- | ------------ | ------------------------- | ------ | -------- |
| F-001 | 主题系统启用 | 在渲染层正确调用主题配置  | P0     | 4h       |
| F-002 | 装饰系统启用 | 在渲染层注入装饰元素      | P0     | 4h       |
| F-003 | 图表渲染修复 | 正确传递图表数据给ECharts | P0     | 8h       |
| F-004 | 变量映射完善 | 建立完整的模板变量映射表  | P0     | 16h      |
| F-005 | 主题选择器UI | 前端主题切换组件          | P0     | 6h       |
| F-006 | 内容溢出处理 | 检测并自动处理内容溢出    | P1     | 8h       |
| F-007 | 配图集成     | 集成Unsplash/Pexels API   | P1     | 8h       |
| F-008 | 预览优化     | 虚拟列表和缩放手势        | P2     | 6h       |

### 4.2 详细设计

#### F-001: 主题系统启用

**当前问题**：

```typescript
// template-rendering.skill.ts 当前实现
render(input: TemplateRenderingInput) {
  // 硬编码样式，未使用theme
  const html = applyVariables(template.html, variables);
  return { html };
}
```

**目标实现**：

```typescript
// template-rendering.skill.ts 修改后
import { getTheme, generateThemeCSS, getThemeContainerStyle } from '../templates/base/themes';

render(input: TemplateRenderingInput) {
  const themeId = input.themeId || 'genspark-dark';
  const theme = getTheme(themeId);

  // 1. 生成主题CSS
  const themeCSS = generateThemeCSS(theme);

  // 2. 应用容器样式
  const containerStyle = getThemeContainerStyle(theme);

  // 3. 注入变量
  const html = applyVariables(template.html, variables);

  // 4. 组装完整HTML
  return {
    html: wrapWithTheme(html, themeCSS, containerStyle),
    themeId,
  };
}
```

**验收标准**：

- [ ] 5套主题的CSS变量正确注入
- [ ] 颜色、字体、间距符合主题配置
- [ ] 切换主题后无样式冲突
- [ ] 导出PDF/PNG/PPTX保持一致

---

#### F-002: 装饰系统启用

**当前问题**：

- `decorations.ts` 已完整实现，但 `render()` 未调用

**目标实现**：

```typescript
// template-rendering.skill.ts 增加装饰注入
import { getThemeDecorationHtml } from '../templates/base/themes';

render(input: TemplateRenderingInput) {
  // ... existing code ...

  // 获取装饰HTML
  const decorationHtml = getThemeDecorationHtml(theme);

  // 注入到容器
  return {
    html: `
      <div class="slide-container" style="${containerStyle}">
        ${decorationHtml}
        <div class="slide-content">
          ${contentHtml}
        </div>
      </div>
    `,
  };
}
```

**验收标准**：

- [ ] 角落装饰正确显示（根据主题配置）
- [ ] 渐变条位置正确
- [ ] 几何图形不遮挡内容
- [ ] 装饰在导出时正确渲染

---

#### F-003: 图表渲染修复

**当前问题**：

- 图表数据在内容生成阶段产生，但未传递给渲染层
- ECharts生成器存在但未被调用

**数据流分析**：

```
Writer阶段：AI生成包含图表描述的内容
  ↓
Renderer阶段：模板期望{{CHART_SVG}}变量
  ↓
问题：Writer输出与Renderer期望不匹配
```

**目标实现**：

```typescript
// 新增: chart-data-extractor.skill.ts
interface ChartData {
  type: 'line' | 'bar' | 'pie' | 'radar';
  labels: string[];
  datasets: { label: string; data: number[]; color?: string }[];
}

class ChartDataExtractorSkill {
  // 从AI生成的内容中提取图表数据
  extract(sections: ContentSection[]): ChartData | null {
    // 1. 识别包含数字的段落
    // 2. 解析为结构化数据
    // 3. 返回ChartData或null
  }
}

// 修改: template-rendering.skill.ts
render(input: TemplateRenderingInput) {
  // 检测是否需要图表
  if (template.requiresChart) {
    const chartData = this.chartExtractor.extract(input.sections);
    if (chartData) {
      const chartSvg = this.echartsGenerator.generateSvg(chartData, theme);
      variables['CHART_SVG'] = chartSvg;
    }
  }
}
```

**验收标准**：

- [ ] dashboard模板图表正常显示
- [ ] trend模板趋势图正常显示
- [ ] 图表颜色符合当前主题
- [ ] 无数据时显示占位图而非空白

---

#### F-004: 变量映射完善

**当前问题**：

- 32个模板，每个模板有独特的变量名
- Writer生成的内容结构与模板期望不一致
- 导致 `{{VAR_NAME}}` 残留

**目标实现**：

```typescript
// 新增: variable-mapping.ts
export const TEMPLATE_VARIABLE_MAP: Record<string, TemplateMapping> = {
  'D-004': { // Comparison Dual
    id: 'D-004',
    name: 'Comparison Dual',
    required: ['OPTION_A_TITLE', 'OPTION_B_TITLE', 'A_PRO1', 'B_PRO1'],
    optional: ['A_PRO2', 'A_PRO3', 'B_PRO2', 'B_PRO3'],
    extractors: {
      'OPTION_A_TITLE': (content) => content.sections[0]?.title || '方案A',
      'OPTION_B_TITLE': (content) => content.sections[1]?.title || '方案B',
      'A_PRO1': (content) => content.sections[0]?.points?.[0] || '',
      // ... more extractors
    },
    fallbacks: {
      'A_PRO2': '',
      'A_PRO3': '',
      'B_PRO2': '',
      'B_PRO3': '',
    },
  },
  // ... 其他31个模板
};

// 修改: template-rendering.skill.ts
render(input: TemplateRenderingInput) {
  const mapping = TEMPLATE_VARIABLE_MAP[input.templateId];

  // 1. 使用extractor提取变量
  const extracted = this.extractVariables(input.content, mapping);

  // 2. 验证必填变量
  const validation = this.validateVariables(extracted, mapping);
  if (!validation.valid) {
    // 使用fallback或请求Writer重新生成
    this.applyFallbacks(extracted, mapping);
  }

  // 3. 应用变量
  const html = this.applyVariables(template.html, extracted);

  // 4. 最终清理（移除残留的{{}}）
  return { html: this.cleanupVariables(html) };
}
```

**验收标准**：

- [ ] 32个模板都有完整的变量映射
- [ ] 必填变量验证通过
- [ ] 无`{{XXX}}`残留
- [ ] 变量替换率 > 95%

---

#### F-005: 主题选择器UI

**目标实现**：

```tsx
// frontend/components/ai-office/slides-v3/ThemeSelector.tsx
import { THEMES } from "@/types/slides-v3";

interface ThemeSelectorProps {
  value: string;
  onChange: (themeId: string) => void;
  disabled?: boolean;
}

export function ThemeSelector({
  value,
  onChange,
  disabled,
}: ThemeSelectorProps) {
  const themes = [
    {
      id: "genspark-dark",
      name: "深邃金典",
      preview: "linear-gradient(135deg, #0F172A, #D4AF37)",
    },
    {
      id: "tech-purple",
      name: "科技紫韵",
      preview: "linear-gradient(135deg, #13111C, #A855F7)",
    },
    {
      id: "executive-white",
      name: "商务精英",
      preview: "linear-gradient(135deg, #FFFFFF, #1E40AF)",
    },
    {
      id: "nature-green",
      name: "自然清新",
      preview: "linear-gradient(135deg, #0A1F1C, #10B981)",
    },
    {
      id: "warm-sunset",
      name: "暖阳晚霞",
      preview: "linear-gradient(135deg, #1C1414, #F97316)",
    },
  ];

  return (
    <div className="grid grid-cols-5 gap-3">
      {themes.map((theme) => (
        <button
          key={theme.id}
          onClick={() => onChange(theme.id)}
          disabled={disabled}
          className={cn(
            "flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all",
            value === theme.id
              ? "border-orange-500 bg-orange-500/10"
              : "border-gray-700 hover:border-gray-500",
          )}
        >
          <div
            className="w-16 h-10 rounded-md shadow-inner"
            style={{ background: theme.preview }}
          />
          <span className="text-xs text-gray-300">{theme.name}</span>
        </button>
      ))}
    </div>
  );
}
```

**验收标准**：

- [ ] 5套主题可视化展示
- [ ] 选中状态明确
- [ ] 切换后触发重新渲染
- [ ] 移动端响应式

---

## 五、非功能需求

### 5.1 性能要求

| 指标          | 目标值  | 测试方法 |
| ------------- | ------- | -------- |
| 单页渲染时间  | < 200ms | 计时日志 |
| 主题切换响应  | < 100ms | 用户感知 |
| 32页PPT总渲染 | < 5s    | E2E测试  |
| 前端内存占用  | < 200MB | DevTools |

### 5.2 兼容性要求

| 环境     | 要求                                          |
| -------- | --------------------------------------------- |
| 浏览器   | Chrome 90+, Firefox 88+, Safari 14+, Edge 90+ |
| 导出格式 | PDF/PNG/PPTX 渲染一致                         |
| 主题     | 所有5套主题在所有32个模板正常工作             |

### 5.3 可测试性要求

- 每个功能模块有独立的单元测试
- 渲染结果可自动化快照测试
- 变量替换率可自动化计算

---

## 六、技术方案

### 6.1 修改文件清单

```
需要修改的文件：

1. backend/src/modules/ai/ai-office/slides/v3/skills/template-rendering.skill.ts
   - 调用主题系统
   - 调用装饰系统
   - 增加变量映射逻辑

2. backend/src/modules/ai/ai-office/slides/v3/roles/renderer.service.ts
   - 传递themeId参数
   - 处理图表渲染

3. backend/src/modules/ai/ai-office/slides/v3/orchestrator/slides-orchestrator-v3.service.ts
   - 接收和传递主题参数

4. backend/src/modules/ai/ai-office/slides/v3/orchestrator/slides-v3.controller.ts
   - API接口增加themeId参数

需要新增的文件：

1. backend/src/modules/ai/ai-office/slides/v3/skills/variable-mapping.ts
   - 32个模板的变量映射表

2. backend/src/modules/ai/ai-office/slides/v3/skills/chart-data-extractor.skill.ts
   - 图表数据提取

3. frontend/components/ai-office/slides-v3/ThemeSelector.tsx
   - 主题选择器组件

4. frontend/components/ai-office/slides-v3/ThemePreview.tsx
   - 主题预览组件
```

### 6.2 数据结构变更

```typescript
// API请求增加themeId
interface GenerateSlidesRequest {
  topic: string;
  content?: string;
  pageCount?: number;
  themeId?: string; // 新增
}

// 渲染输入增加themeId
interface TemplateRenderingInput {
  templateId: string;
  content: PageContent;
  themeId: string; // 新增
}

// 渲染输出增加主题信息
interface TemplateRenderingResult {
  html: string;
  themeId: string; // 新增
  decorationsApplied: boolean; // 新增
}
```

### 6.3 向后兼容

- `themeId` 默认值为 `'genspark-dark'`，不传参时保持当前行为
- 装饰系统默认启用，可通过配置禁用

---

## 七、任务拆解

### 7.1 Week 1: 视觉急救 (P0)

#### Sprint 1.1: 主题和装饰启用 (Day 1-2)

| 任务ID  | 任务名称           | 描述                                      | 工时 | 验收标准            | 依赖    |
| ------- | ------------------ | ----------------------------------------- | ---- | ------------------- | ------- |
| T-1.1.1 | 修改渲染层调用主题 | template-rendering.skill.ts调用getTheme() | 2h   | 主题CSS变量正确注入 | -       |
| T-1.1.2 | 注入装饰元素       | 调用getThemeDecorationHtml()              | 2h   | 装饰HTML正确渲染    | T-1.1.1 |
| T-1.1.3 | 传递themeId参数    | 从Controller到Renderer完整传递            | 2h   | API支持themeId参数  | T-1.1.1 |
| T-1.1.4 | 单元测试           | 5套主题渲染测试                           | 2h   | 测试覆盖100%        | T-1.1.2 |
| T-1.1.5 | 视觉验证           | 手动验证5套主题效果                       | 2h   | 无样式冲突          | T-1.1.4 |

#### Sprint 1.2: 图表渲染修复 (Day 3-4)

| 任务ID  | 任务名称          | 描述                          | 工时 | 验收标准             | 依赖             |
| ------- | ----------------- | ----------------------------- | ---- | -------------------- | ---------------- |
| T-1.2.1 | 分析图表数据流    | 梳理Writer->Renderer数据传递  | 2h   | 产出数据流图         | -                |
| T-1.2.2 | 实现图表数据提取  | chart-data-extractor.skill.ts | 4h   | 能从内容提取图表数据 | T-1.2.1          |
| T-1.2.3 | 集成ECharts生成器 | 调用echarts-generator.ts      | 2h   | 生成SVG图表          | T-1.2.2          |
| T-1.2.4 | 图表主题化        | 图表颜色符合当前主题          | 2h   | 5套主题图表一致      | T-1.2.3, T-1.1.1 |
| T-1.2.5 | 图表占位处理      | 无数据时显示占位图            | 2h   | 无空白区域           | T-1.2.3          |

#### Sprint 1.3: 前端主题选择器 (Day 5)

| 任务ID  | 任务名称          | 描述              | 工时 | 验收标准       | 依赖             |
| ------- | ----------------- | ----------------- | ---- | -------------- | ---------------- |
| T-1.3.1 | ThemeSelector组件 | 5套主题可视化选择 | 3h   | UI符合设计规范 | -                |
| T-1.3.2 | 状态管理集成      | Zustand状态管理   | 2h   | 切换即时生效   | T-1.3.1          |
| T-1.3.3 | API联调           | 前后端themeId传递 | 1h   | 端到端验证     | T-1.1.3, T-1.3.2 |

### 7.2 Week 2: 质量提升 (P0+P1)

#### Sprint 2.1: 变量映射完善 (Day 6-7)

| 任务ID  | 任务名称           | 描述                        | 工时 | 验收标准       | 依赖    |
| ------- | ------------------ | --------------------------- | ---- | -------------- | ------- |
| T-2.1.1 | 变量映射表设计     | variable-mapping.ts结构设计 | 2h   | 产出设计文档   | -       |
| T-2.1.2 | Narrative模板映射  | 8个叙事类模板               | 4h   | 变量替换率100% | T-2.1.1 |
| T-2.1.3 | Structural模板映射 | 8个结构类模板               | 4h   | 变量替换率100% | T-2.1.1 |
| T-2.1.4 | Data模板映射       | 8个数据类模板               | 4h   | 变量替换率100% | T-2.1.1 |
| T-2.1.5 | Action模板映射     | 8个行动类模板               | 4h   | 变量替换率100% | T-2.1.1 |

#### Sprint 2.2: 溢出处理 (Day 8)

| 任务ID  | 任务名称     | 描述                   | 工时 | 验收标准       | 依赖    |
| ------- | ------------ | ---------------------- | ---- | -------------- | ------- |
| T-2.2.1 | 溢出检测逻辑 | 检测内容是否超出安全区 | 3h   | 检测准确率>95% | -       |
| T-2.2.2 | 内容压缩策略 | 自动缩减字体/行高      | 3h   | 压缩后无溢出   | T-2.2.1 |
| T-2.2.3 | 分页策略     | 过长内容自动分页       | 2h   | 分页逻辑正确   | T-2.2.1 |

#### Sprint 2.3: 配图集成 (Day 9)

| 任务ID  | 任务名称       | 描述                    | 工时 | 验收标准         | 依赖    |
| ------- | -------------- | ----------------------- | ---- | ---------------- | ------- |
| T-2.3.1 | 图片服务抽象层 | 支持Unsplash/Pexels切换 | 2h   | 接口定义完成     | -       |
| T-2.3.2 | Unsplash集成   | 实现Unsplash API调用    | 3h   | 能获取配图       | T-2.3.1 |
| T-2.3.3 | 关键词提取     | 从标题/内容提取搜索词   | 2h   | 关键词相关性>80% | T-2.3.2 |
| T-2.3.4 | 备用策略       | API限流时使用本地图库   | 1h   | 有降级方案       | T-2.3.2 |

#### Sprint 2.4: 集成测试和优化 (Day 10)

| 任务ID  | 任务名称     | 描述                   | 工时 | 验收标准       | 依赖 |
| ------- | ------------ | ---------------------- | ---- | -------------- | ---- |
| T-2.4.1 | E2E测试编写  | 覆盖核心流程           | 3h   | 测试通过率100% | 全部 |
| T-2.4.2 | 性能测试     | 验证渲染性能目标       | 2h   | 符合性能要求   | 全部 |
| T-2.4.3 | 视觉回归测试 | 32模板 x 5主题截图对比 | 2h   | 无意外变更     | 全部 |
| T-2.4.4 | 文档更新     | 更新使用文档           | 1h   | 文档完整       | 全部 |

---

## 八、里程碑和交付物

### 8.1 里程碑定义

| 里程碑       | 日期          | 交付物                      | 验收人  |
| ------------ | ------------- | --------------------------- | ------- |
| M1: 主题启用 | Week 1 Day 2  | 5套主题可切换，装饰正常显示 | 产品    |
| M2: 图表修复 | Week 1 Day 4  | dashboard/trend图表正常渲染 | 产品    |
| M3: 前端UI   | Week 1 Day 5  | 主题选择器上线              | 产品    |
| M4: 变量完善 | Week 2 Day 7  | 32模板变量替换率>95%        | QA      |
| M5: 质量优化 | Week 2 Day 9  | 溢出处理+配图集成           | 产品    |
| M6: 正式发布 | Week 2 Day 10 | 全功能发布                  | 产品+QA |

### 8.2 阶段交付物

```
Week 1 交付物：
├── 后端代码
│   ├── template-rendering.skill.ts (修改)
│   ├── renderer.service.ts (修改)
│   ├── chart-data-extractor.skill.ts (新增)
│   └── 单元测试
├── 前端代码
│   ├── ThemeSelector.tsx (新增)
│   └── 状态管理更新
└── 文档
    └── API变更说明

Week 2 交付物：
├── 后端代码
│   ├── variable-mapping.ts (新增)
│   ├── content-compression增强
│   └── image-fetcher.skill.ts (新增)
├── 测试
│   ├── E2E测试用例
│   └── 视觉回归测试基线
└── 文档
    └── 使用指南更新
```

---

## 九、ROI评估

### 9.1 投入估算

| 资源类型 | 投入量     | 成本估算  |
| -------- | ---------- | --------- |
| 后端开发 | 5人天      | 约25K     |
| 前端开发 | 3人天      | 约15K     |
| 测试     | 2人天      | 约8K      |
| 产品验收 | 1人天      | 约5K      |
| **总计** | **11人天** | **约53K** |

### 9.2 产出价值

| 价值维度   | 量化指标         | 预期效果                |
| ---------- | ---------------- | ----------------------- |
| 用户体验   | 视觉评分 65->85  | 用户满意度提升30%       |
| 产品竞争力 | 达到Genspark 80% | 可正面对标竞品          |
| 开发效率   | 启用已有代码     | 避免重复开发，节省3-4周 |
| 技术债务   | 修复渲染层断链   | 长期维护成本降低        |

### 9.3 ROI结论

- **短期ROI**：投入11人天，获得"达到竞品80%"的效果，性价比高
- **长期ROI**：修复渲染层问题后，后续主题/装饰扩展成本几乎为0
- **机会成本**：如不修复，已有的680+行主题代码将持续浪费

---

## 十、风险评估

### 10.1 技术风险

| 风险            | 概率 | 影响 | 缓解措施                       | 负责人 |
| --------------- | ---- | ---- | ------------------------------ | ------ |
| CSS兼容性问题   | 中   | 中   | 使用CSS变量+内联样式，确保兼容 | 前端   |
| ECharts SSR问题 | 低   | 高   | 使用SVG输出，不依赖Canvas      | 后端   |
| 变量映射遗漏    | 中   | 中   | 建立测试矩阵，覆盖32模板       | QA     |
| 导出样式丢失    | 低   | 高   | 确保所有样式内联               | 后端   |

### 10.2 项目风险

| 风险       | 概率 | 影响 | 缓解措施              | 负责人 |
| ---------- | ---- | ---- | --------------------- | ------ |
| 需求变更   | 低   | 中   | 锁定2周范围，变更延后 | 产品   |
| 资源冲突   | 中   | 中   | 优先保证P0任务        | PM     |
| 测试不充分 | 中   | 中   | 建立自动化测试        | QA     |

### 10.3 外部依赖风险

| 风险             | 概率 | 影响 | 缓解措施                       | 负责人 |
| ---------------- | ---- | ---- | ------------------------------ | ------ |
| Unsplash API限流 | 高   | 低   | 配图功能降级为P1，准备本地图库 | 后端   |
| 用户不接受新主题 | 低   | 低   | 保留原主题为默认，用户可选     | 产品   |

---

## 十一、验收清单

### 11.1 功能验收

| ID     | 验收项   | 验收标准                | 验收方法   | 状态 |
| ------ | -------- | ----------------------- | ---------- | ---- |
| AC-001 | 主题切换 | 5套主题可正常切换       | 手动测试   | [ ]  |
| AC-002 | 装饰显示 | 角落装饰/渐变条正常     | 视觉检查   | [ ]  |
| AC-003 | 图表渲染 | dashboard/trend图表正常 | 生成测试   | [ ]  |
| AC-004 | 变量替换 | 替换率>95%              | 自动化测试 | [ ]  |
| AC-005 | 无溢出   | 内容不超出边界          | 视觉检查   | [ ]  |
| AC-006 | 导出一致 | PDF/PNG/PPTX一致        | 对比测试   | [ ]  |

### 11.2 性能验收

| ID     | 验收项     | 验收标准 | 验收方法 | 状态 |
| ------ | ---------- | -------- | -------- | ---- |
| PF-001 | 单页渲染   | < 200ms  | 性能日志 | [ ]  |
| PF-002 | 主题切换   | < 100ms  | 用户感知 | [ ]  |
| PF-003 | 32页总渲染 | < 5s     | E2E测试  | [ ]  |

### 11.3 质量验收

| ID     | 验收项   | 验收标准     | 验收方法   | 状态 |
| ------ | -------- | ------------ | ---------- | ---- |
| QA-001 | 单元测试 | 覆盖率>80%   | Jest报告   | [ ]  |
| QA-002 | E2E测试  | 核心流程通过 | Playwright | [ ]  |
| QA-003 | 视觉回归 | 无意外变更   | 截图对比   | [ ]  |

---

## 十二、附录

### A. 技术依赖

**已有依赖（无需新增）**：

- ECharts（已安装，用于图表）
- 主题系统（themes.ts）
- 装饰系统（decorations.ts）

**可能新增依赖**：

```bash
# 配图服务（P1，可选）
npm install unsplash-js --save
```

**环境变量**：

```env
# .env.local
UNSPLASH_ACCESS_KEY=xxx  # 配图服务（可选）
```

### B. 参考资料

1. `ai-slides-v3-optimization-plan.md` - 完整8周优化方案
2. `ai-office-slides-upgrade.md` - Genspark对标分析
3. `themes.ts` - 主题系统源码（682行）
4. `decorations.ts` - 装饰系统源码（666行）

### C. 术语表

| 术语       | 定义                         |
| ---------- | ---------------------------- |
| 变量替换率 | 模板变量成功替换的比例       |
| 视觉评分   | 专家对PPT视觉效果的1-100评分 |
| 同源导出   | 预览/PDF/PPTX使用相同渲染源  |
| 装饰元素   | 角落装饰、渐变条、几何图形等 |

---

## 变更记录

| 版本 | 日期       | 变更内容 | 作者     |
| ---- | ---------- | -------- | -------- |
| 1.0  | 2025-12-31 | 初始版本 | PM Agent |
