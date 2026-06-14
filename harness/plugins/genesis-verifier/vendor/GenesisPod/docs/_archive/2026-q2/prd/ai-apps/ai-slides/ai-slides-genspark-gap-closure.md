# AI Slides 追赶 Genspark 方案

> 目标：2周内达到Genspark 80%视觉效果

## 一、现状诊断

### 核心差距

| 问题         | 影响    | 解决难度     |
| ------------ | ------- | ------------ |
| 图表区域空白 | 🔴 致命 | 中           |
| 无配图       | 🔴 致命 | 低           |
| 主题单一     | 🟡 明显 | 低(已有代码) |
| 无装饰元素   | 🟡 明显 | 低(已有代码) |
| 内容填充不准 | 🟡 明显 | 中           |

### 已有但未启用的能力

```
✅ 5套专业主题 (themes.ts)
✅ 装饰系统 (decorations.ts)
✅ 动画系统 (design-tokens.ts)
✅ 32+模板库
```

---

## 二、三阶段方案

### Phase 1: 视觉急救 (3天)

**目标**: 让生成的PPT看起来"完整"

#### 1.1 图表渲染 (Day 1-2)

**问题**: dashboard/trend模板的图表区域显示空白

**方案**: 使用 ECharts 生成 SVG 内嵌

```typescript
// 新增: backend/src/modules/ai/ai-office/slides/v3/skills/chart-renderer.skill.ts

interface ChartData {
  type: "line" | "bar" | "pie" | "radar";
  labels: string[];
  datasets: { label: string; data: number[]; color?: string }[];
}

class ChartRendererSkill {
  // 生成 SVG 字符串，可直接内嵌到 HTML
  renderToSvg(data: ChartData, width: number, height: number): string;

  // 从 PageContent 提取图表数据
  extractChartData(sections: ContentSection[]): ChartData | null;
}
```

**模板修改**:

```html
<!-- 原来 -->
<div class="chart-placeholder">趋势图表</div>

<!-- 修改后 -->
<div class="chart-container">{{CHART_SVG}}</div>
```

#### 1.2 配图集成 (Day 2-3)

**方案**: 集成 Unsplash API (免费)

```typescript
// 新增: backend/src/modules/ai/ai-office/slides/v3/skills/image-fetcher.skill.ts

class ImageFetcherSkill {
  // 根据关键词获取配图URL
  async fetchImage(
    keywords: string[],
    size: "small" | "medium" | "large",
  ): Promise<string>;

  // 从页面标题/内容提取关键词
  extractKeywords(title: string, content: string): string[];
}
```

**配置**:

```env
UNSPLASH_ACCESS_KEY=xxx  # 免费50次/小时
```

#### 1.3 启用主题系统 (Day 3)

**当前**: 所有模板硬编码暗色背景

**修改**: 渲染时注入主题变量

```typescript
// template-rendering.skill.ts 修改

render(input: TemplateRenderingInput): TemplateRenderingResult {
  const theme = getTheme(input.themeId || 'genspark-dark');

  // 注入主题CSS变量
  const themedHtml = injectThemeVariables(html, theme);

  return { html: themedHtml, ... };
}
```

---

### Phase 2: 质量提升 (5天)

**目标**: 内容准确、布局美观

#### 2.1 智能内容提取 (Day 4-5)

**问题**: 变量提取逻辑与模板期望不匹配

**方案**: 建立模板变量映射表

```typescript
// 新增: backend/src/modules/ai/ai-office/slides/v3/skills/variable-mapper.skill.ts

const TEMPLATE_VARIABLE_MAP = {
  'D-004': { // Comparison Dual
    required: ['OPTION_A_TITLE', 'OPTION_B_TITLE', 'A_PRO1', 'B_PRO1'],
    extractors: {
      'OPTION_A_TITLE': (sections) => sections[0]?.content?.[0] || '方案A',
      // ...
    }
  },
  'A-003': { // Key Conclusions
    required: ['CONCLUSION1_TITLE', 'CONCLUSION1_DESC', ...],
    extractors: { ... }
  }
};

class VariableMapperSkill {
  // 验证变量是否完整
  validate(templateId: string, variables: Record<string, string>): ValidationResult;

  // 填充缺失变量
  fillMissing(templateId: string, variables: Record<string, string>): Record<string, string>;
}
```

#### 2.2 装饰元素应用 (Day 6)

**当前**: decorations.ts 已有代码但未使用

**修改**: 在渲染时自动添加装饰

```typescript
// template-rendering.skill.ts 修改

render(input) {
  let html = applyVariables(template, variables);

  // 添加角落装饰
  html = injectCornerAccents(html, theme);

  // 添加渐变条
  html = injectGradientBar(html, theme);

  return { html };
}
```

#### 2.3 布局自适应 (Day 7-8)

**问题**: 内容过多时溢出

**方案**: 内容压缩 + 分页

```typescript
// content-compression.skill.ts 增强

class ContentCompressionSkill {
  // 检测内容是否会溢出
  willOverflow(content: PageContent, templateId: string): boolean;

  // 智能压缩
  compress(content: PageContent, targetRatio: number): PageContent;

  // 拆分为多页
  split(content: PageContent, templateId: string): PageContent[];
}
```

---

### Phase 3: 体验优化 (4天)

**目标**: 接近 Genspark 交互体验

#### 3.1 主题选择器 (Day 9)

前端添加主题切换UI:

```tsx
// frontend/components/ai-office/slides-v3/ThemeSelector.tsx

const THEMES = [
  { id: "genspark-dark", name: "深邃蓝", preview: "/themes/dark.png" },
  { id: "tech-purple", name: "科技紫", preview: "/themes/purple.png" },
  { id: "executive-white", name: "商务白", preview: "/themes/white.png" },
  { id: "nature-green", name: "自然绿", preview: "/themes/green.png" },
  { id: "warm-sunset", name: "暖阳橙", preview: "/themes/sunset.png" },
];

function ThemeSelector({ value, onChange }) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {THEMES.map((theme) => (
        <button
          key={theme.id}
          onClick={() => onChange(theme.id)}
          className={cn(
            "rounded-lg overflow-hidden border-2",
            value === theme.id ? "border-orange-500" : "border-transparent",
          )}
        >
          <img src={theme.preview} alt={theme.name} />
          <span>{theme.name}</span>
        </button>
      ))}
    </div>
  );
}
```

#### 3.2 实时预览优化 (Day 10)

- 缩略图加载优化 (虚拟列表)
- 预览缩放手势支持
- 键盘导航 (←→ 切页)

#### 3.3 导出增强 (Day 11-12)

```typescript
// 导出时保留动画
export async function exportToPptx(pages: PageState[], options: ExportOptions) {
  // 添加入场动画
  if (options.includeAnimations) {
    pages = pages.map(addSlideAnimations);
  }

  // 嵌入字体
  if (options.embedFonts) {
    // ...
  }
}
```

---

## 三、具体任务清单

### Week 1 (Phase 1 + 2前半)

| 天  | 任务              | 产出                         | 负责 |
| --- | ----------------- | ---------------------------- | ---- |
| D1  | 图表渲染-架构设计 | chart-renderer.skill.ts 骨架 | -    |
| D2  | 图表渲染-实现     | 支持 line/bar/pie            | -    |
| D3  | 配图集成          | image-fetcher.skill.ts       | -    |
| D4  | 启用主题系统      | 渲染时注入主题               | -    |
| D5  | 变量映射表        | 32个模板完整映射             | -    |

### Week 2 (Phase 2后半 + 3)

| 天  | 任务         | 产出            | 负责 |
| --- | ------------ | --------------- | ---- |
| D6  | 装饰元素应用 | 角落装饰/渐变条 | -    |
| D7  | 内容溢出处理 | 自动压缩/分页   | -    |
| D8  | 主题选择器UI | 前端组件        | -    |
| D9  | 预览优化     | 虚拟列表/缩放   | -    |
| D10 | 导出增强     | 动画/字体嵌入   | -    |

---

## 四、成功指标

### 视觉质量

- [ ] 无空白图表区域
- [ ] 每页至少1张配图
- [ ] 5套主题可切换
- [ ] 装饰元素正常显示

### 内容质量

- [ ] 变量替换率 > 95%
- [ ] 无文字溢出
- [ ] 内容与模板匹配

### 用户体验

- [ ] 缩略图点击切页正常 ✅ 已修复
- [ ] 大纲点击切页正常 ✅ 已修复
- [ ] 导出PPTX可正常打开

---

## 五、技术依赖

### 需要安装

```bash
# 图表渲染
npm install echarts echarts-for-react --save

# 图片服务 (可选，也可直接HTTP调用)
npm install unsplash-js --save
```

### 环境变量

```env
# .env.local
UNSPLASH_ACCESS_KEY=your_key_here
```

### API 额度

- Unsplash: 免费50次/小时, 足够测试
- 生产环境考虑: Pexels (200次/小时免费) 或自建图床

---

## 六、风险与备选

| 风险                 | 影响       | 备选方案               |
| -------------------- | ---------- | ---------------------- |
| Unsplash API 限流    | 配图失败   | 使用本地图片库         |
| ECharts SSR 问题     | 图表不显示 | 改用 Chart.js + canvas |
| 主题切换导致布局错乱 | 视觉问题   | 主题仅改颜色不改布局   |

---

## 七、立即可执行

今天就可以开始的任务:

1. **启用主题** - 修改 `template-rendering.skill.ts`，注入主题变量
2. **启用装饰** - 在渲染时添加角落装饰
3. **重新生成测试** - 验证变量替换修复效果

需要我现在开始实现哪个部分?
