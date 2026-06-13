# PPT 智能设计系统重构计划

## 当前问题分析

从截图和代码分析，当前的 PPT 大纲生成存在以下问题：

1. **前端大纲只有文字内容**：当前 `SlidesTab.tsx` 的 `generateOutline` 函数只生成简单的 JSON（slideNumber, title, points），缺乏视觉设计信息
2. **布局配色步骤是手动默认值**：`confirmOutline` 函数直接给所有页面设置默认 layout（title/content/summary），没有 AI 智能决策
3. **后端有完整架构但前端未使用**：后端 `slide-planning.service.ts` 有完整的 `SlideSpec` 结构（包括布局、背景、图像规格等），但前端 SlidesTab 没有调用

## 解决方案：打通前后端 PPT 规划流程

### 核心思路

将前端的"大纲规划 → 布局配色 → 内容生成"三步流程改造为：

1. **大纲规划**：调用后端 `/api/ppt/outline` 生成完整大纲（包含 purpose、needsImage、needsChart）
2. **详细规划**：调用后端 `/api/ppt/plan-slides` 为每页生成 `SlideSpec`（布局、背景、图像 prompt）
3. **用户确认/调整**：前端展示完整的设计规格，用户可微调
4. **内容生成**：调用后端 `/api/ppt/generate-stream` 流式生成

### 详细实现步骤

---

## Phase 1: 后端 API 增强

### 1.1 新增独立的大纲生成 API

**文件**: `backend/src/modules/ai-office/ppt/ppt-generation.controller.ts`

```typescript
@Post('outline')
async generateOutline(@Body() body: { prompt: string; urls?: string[]; slideCount?: number }) {
  // 调用 slidePlanning.generateOutline
  return outline;
}
```

### 1.2 新增详细规划 API

**文件**: `backend/src/modules/ai-office/ppt/ppt-generation.controller.ts`

```typescript
@Post('plan-slides')
async planSlides(@Body() body: { outline: PPTOutline; themeId: string }) {
  // 调用 slidePlanning.planAllSlides
  // 返回完整的 SlideSpec[] 包含：
  // - layoutType + layoutReasoning
  // - backgroundDecision (solid/gradient/ai_generated)
  // - imageSpec (prompt, position, style)
  // - chartSpec (如果需要)
  return slideSpecs;
}
```

### 1.3 增强规划 Prompt（专业 PPT 大师级别）

更新 `OUTLINE_GENERATION_PROMPT` 和 `SLIDE_PLANNING_PROMPT`，加入更多专业设计考量：

**大纲生成 Prompt 增强**：

```
作为资深 PPT 设计师，你需要考虑：
1. 信息架构：金字塔原理、MECE 分类
2. 视觉节奏：开场冲击、中间铺陈、高潮呈现、结尾收束
3. 内容密度：每页信息量控制（3-5 个要点）
4. 情感曲线：从认知到认同到行动
```

**单页规划 Prompt 增强**：

```
作为资深 PPT 设计师，为这一页选择最佳设计方案：

## 布局决策考量
1. 信息类型：概念/数据/流程/对比/列表
2. 视觉重心：文字为主/图片为主/图文并重
3. 阅读路径：Z 型/F 型/中心发散
4. 视觉层级：标题 → 副标题 → 正文 → 注释

## 配色决策考量
1. 主题色调：商务蓝/科技紫/自然绿/热情红
2. 对比度：确保可读性
3. 情感表达：专业/创新/温暖/冷静

## 图像决策考量
1. 是否需要图像：增强理解 vs 干扰阅读
2. 图像类型：照片/插画/图标/图表
3. 图像位置：左/右/上/下/背景
4. 图像风格：与主题一致

## 排版决策考量
1. 字体大小：标题 36-48pt，正文 18-24pt
2. 行距：1.2-1.5 倍
3. 边距：安全边距 10%
4. 对齐：左对齐/居中/两端对齐
```

---

## Phase 2: 前端 UI 重构

### 2.1 重构大纲编辑器 `OutlineEditor`

**当前**：只显示 title + points 列表
**改造后**：显示完整的 SlideSpec 预览

```tsx
// 每张幻灯片卡片包含：
<SlideOutlineCard>
  <SlideHeader>
    <SlideNumber>1</SlideNumber>
    <SlidePurpose>title</SlidePurpose>
  </SlideHeader>

  <SlideContent>
    <Title editable>{slide.title}</Title>
    <KeyPoints editable>{slide.keyPoints}</KeyPoints>
  </SlideContent>

  <SlideDesign>
    <LayoutPreview type={slide.layoutType} />
    <BackgroundPreview type={slide.backgroundDecision.type} />
    <ImageIndicator hasImage={!!slide.imageSpec} />
    <ChartIndicator hasChart={!!slide.chartSpec} />
  </SlideDesign>

  <SlideActions>
    <RegenerateButton />
    <AdjustLayoutButton />
    <AddImageButton />
  </SlideActions>
</SlideOutlineCard>
```

### 2.2 新增布局选择器组件

```tsx
// components/ai-office/ppt/LayoutSelector.tsx
function LayoutSelector({ currentLayout, onSelect, purpose }) {
  // 根据 purpose 推荐合适的布局
  const recommendedLayouts = getRecommendedLayouts(purpose);

  return (
    <div className="grid grid-cols-4 gap-2">
      {LAYOUT_OPTIONS.map((layout) => (
        <LayoutCard
          key={layout.value}
          layout={layout}
          isSelected={currentLayout === layout.value}
          isRecommended={recommendedLayouts.includes(layout.value)}
          onClick={() => onSelect(layout.value)}
        />
      ))}
    </div>
  );
}
```

### 2.3 新增配色方案选择器

```tsx
// components/ai-office/ppt/ColorSchemeSelector.tsx
function ColorSchemeSelector({ backgroundDecision, theme, onUpdate }) {
  return (
    <div>
      <BackgroundTypeToggle
        type={backgroundDecision.type}
        onTypeChange={...}
      />

      {backgroundDecision.type === 'solid' && (
        <ColorPicker color={backgroundDecision.colors?.primary} />
      )}

      {backgroundDecision.type === 'gradient' && (
        <GradientEditor colors={backgroundDecision.colors} direction={...} />
      )}

      {backgroundDecision.type === 'ai_generated' && (
        <AIBackgroundPromptEditor
          prompt={backgroundDecision.aiConfig?.prompt}
          style={backgroundDecision.aiConfig?.style}
        />
      )}
    </div>
  );
}
```

### 2.4 新增图像规格编辑器

```tsx
// components/ai-office/ppt/ImageSpecEditor.tsx
function ImageSpecEditor({ imageSpec, onUpdate }) {
  return (
    <div>
      <ToggleImageNeeded />

      {imageSpec && (
        <>
          <PromptEditor
            prompt={imageSpec.prompt}
            promptZh={imageSpec.promptZh}
          />

          <PositionSelector
            position={imageSpec.position}
            options={["left", "right", "top", "bottom", "background", "center"]}
          />

          <StyleSelector
            style={imageSpec.style}
            options={[
              "professional",
              "creative",
              "minimal",
              "tech",
              "artistic",
            ]}
          />

          <AspectRatioSelector
            ratio={imageSpec.aspectRatio}
            options={["16:9", "4:3", "1:1", "9:16"]}
          />
        </>
      )}
    </div>
  );
}
```

---

## Phase 3: 流程整合

### 3.1 新的生成流程

```
用户输入 Prompt
    ↓
[Step 1] 调用 POST /api/ppt/outline
    - 返回 PPTOutline（包含 slides[].purpose, keyPoints, needsImage, needsChart）
    ↓
[Step 2] 调用 POST /api/ppt/plan-slides
    - 输入: outline + themeId
    - 返回 SlideSpec[]（每页的布局、背景、图像规格）
    ↓
[Step 3] 用户预览和调整
    - 展示每页的设计规格预览
    - 允许调整布局、配色、图像 prompt
    ↓
[Step 4] 调用 GET /api/ppt/generate-stream
    - 流式生成内容和图像
    - 实时渲染预览
```

### 3.2 状态管理

```typescript
// stores/pptStore.ts
interface PPTGenerationState {
  // 输入
  prompt: string;
  urls: string[];

  // 大纲
  outline: PPTOutline | null;

  // 详细规格
  slideSpecs: SlideSpec[];

  // 主题
  themeId: string;
  theme: PPTTheme;

  // 生成进度
  generationPhase: "idle" | "outline" | "planning" | "generating" | "complete";
  currentSlideIndex: number;

  // 生成结果
  generatedSlides: GeneratedSlide[];
}
```

---

## Phase 4: 专业 PPT 设计规则库

### 4.1 布局推荐引擎

根据内容类型智能推荐布局：

```typescript
const LAYOUT_RULES = {
  // 内容类型 → 推荐布局
  title: ["title_center", "title_subtitle"],
  agenda: ["bullet_points", "numbered_list", "cards_grid"],
  comparison: ["comparison_split", "two_columns"],
  timeline: ["timeline_horizontal", "timeline_vertical"],
  statistics: ["statistics_cards", "chart_with_text"],
  quote: ["quote_highlight", "image_full"],
  content_short: ["text_image_right", "text_image_left"],
  content_long: ["two_columns", "three_columns", "cards_grid"],
  conclusion: ["title_center", "bullet_points"],
};
```

### 4.2 配色方案库

预设专业配色方案：

```typescript
const COLOR_SCHEMES = {
  professional: {
    primary: "#1e3a5f",
    secondary: "#2563eb",
    accent: "#f59e0b",
    background: "#ffffff",
    text: "#1f2937",
  },
  tech: {
    primary: "#6366f1",
    secondary: "#8b5cf6",
    accent: "#06b6d4",
    background: "#0f172a",
    text: "#f8fafc",
  },
  // ... 更多配色方案
};
```

### 4.3 图像风格指南

```typescript
const IMAGE_STYLE_GUIDE = {
  professional: {
    keywords: ["corporate", "business", "clean", "modern"],
    avoid: ["cartoonish", "cluttered", "overly colorful"],
  },
  creative: {
    keywords: ["vibrant", "artistic", "dynamic", "bold"],
    avoid: ["boring", "generic", "stock-photo-like"],
  },
  minimal: {
    keywords: ["simple", "clean", "geometric", "whitespace"],
    avoid: ["complex", "busy", "decorative"],
  },
};
```

---

## 实施优先级

### P0 - 核心功能（立即实施）

1. 后端新增 `/api/ppt/outline` 和 `/api/ppt/plan-slides` API
2. 前端 SlidesTab 调用新 API 替代当前简单 prompt
3. 增强大纲显示，展示布局和设计规格预览

### P1 - 用户体验（1-2 天）

4. 布局选择器 UI 组件
5. 配色方案选择器
6. 图像规格编辑器

### P2 - 高级功能（3-5 天）

7. 实时预览渲染
8. AI 背景图生成
9. 拖拽调整页面顺序
10. 导出为 PPTX

---

## 预期效果

改造后，用户在"大纲规划"步骤将看到：

```
┌─────────────────────────────────────────────────────┐
│ 幻灯片 1 | 标题页                                    │
├─────────────────────────────────────────────────────┤
│ 标题: 多伦多大学简介                                  │
│ 要点: • 世界顶尖研究型大学                           │
│       • 加拿大最具影响力的学府                        │
│                                                     │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│ │ 布局     │ │ 背景     │ │ 图像     │              │
│ │ ────     │ │ ────     │ │ ────     │              │
│ │ 居中标题  │ │ AI生成   │ │ 校园风景  │              │
│ │ [预览]   │ │ [预览]   │ │ [预览]   │              │
│ └──────────┘ └──────────┘ └──────────┘              │
│                                                     │
│ [调整布局] [修改配色] [编辑图像提示词] [重新生成]      │
└─────────────────────────────────────────────────────┘
```

而不是当前的：

```
┌───────────────────────────────┐
│ 1 多伦多大学简介               │
│   • 世界顶尖研究型大学         │
│   • 加拿大最具影响力的学府      │
│   + 添加要点                   │
└───────────────────────────────┘
```
