# PRD: 资源到图片生成功能 (Resource-to-Image Generation)

## 1. 概述

### 1.1 背景

用户希望能够基于已有的文档（Papers、Blogs、Reports）或视频（YouTube）内容快速生成相关的 AI 图片。当前的图片生成功能（Sparkle > Images）是独立的，用户需要手动输入内容或 URL，无法直接从 Explore 页面的资源列表快速跳转并携带上下文。

### 1.2 目标

- 在资源卡片操作栏增加"生成图片"入口
- 支持将资源 URL 添加到图片生成的"素材池"
- 在图片生成器中支持通过 @ 引用素材池中的内容
- 实现从内容浏览到图片创作的无缝衔接

## 2. 用户故事

### 2.1 核心场景

1. **文档转图片**：用户浏览一篇 Paper，想要生成一张图片来可视化论文的核心概念
2. **视频转图片**：用户看完一个 YouTube 视频，想要基于视频内容生成缩略图或概念图
3. **多素材组合**：用户想要将多个资源的内容组合起来生成一张综合图片

### 2.2 用户流程

```
Explore 页面资源卡片
    ↓
点击 "To Image" 按钮
    ↓
资源 URL 添加到素材池
    ↓
跳转到 Sparkle > Images
    ↓
在输入框中 @ 引用素材
    ↓
输入额外 Prompt
    ↓
生成图片
```

## 3. 功能设计

### 3.1 资源卡片扩展

#### 3.1.1 新增按钮位置

在现有操作栏 `[Bookmark] [👍 0] [💬 0] [AI Office] [Delete]` 中添加：

```
[Bookmark] [👍 0] [💬 0] [📷 Image] [AI Office] [Delete]
```

#### 3.1.2 按钮行为

- **图标**: 相机/图片图标 (📷)
- **文案**: "Image" 或 "To Image"
- **点击行为**:
  1. 将资源信息添加到全局素材池（Zustand store）
  2. 跳转到 `/library?tab=images`
  3. 显示 toast 提示"已添加到素材池，可在输入框中 @ 引用"

### 3.2 素材池设计

#### 3.2.1 数据结构

```typescript
interface ImageSourceItem {
  id: string; // 唯一标识
  type: "paper" | "blog" | "report" | "youtube" | "news";
  title: string; // 资源标题
  url: string; // 资源 URL
  thumbnailUrl?: string; // 缩略图（可选）
  addedAt: Date; // 添加时间
}

interface ImageSourceStore {
  sources: ImageSourceItem[];
  addSource: (item: ImageSourceItem) => void;
  removeSource: (id: string) => void;
  clearSources: () => void;
}
```

#### 3.2.2 存储方式

- 使用 Zustand 全局状态管理
- 持久化到 localStorage（可选）
- 最多保留 10 个素材，超出时移除最早的

### 3.3 图片生成器增强

#### 3.3.1 素材池显示

在图片生成器顶部或侧边显示当前素材池：

```
┌─────────────────────────────────────────┐
│ 📚 素材池 (2)                    [清空] │
│ ┌─────────────────────────────────────┐ │
│ │ 📄 Paper: Attention Is All You...  × │ │
│ │ 🎬 YouTube: Steve Jobs Speech...   × │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

#### 3.3.2 @ 引用功能

在输入框中输入 `@` 时，显示素材池下拉菜单：

```
┌─────────────────────────────────────────────┐
│ Describe what you want to create...         │
│                                             │
│ 输入: 根据 @|                               │
│       ┌───────────────────────────────────┐ │
│       │ 📄 Attention Is All You Need      │ │
│       │ 🎬 Steve Jobs Speech              │ │
│       └───────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

选择后：

```
输入: 根据 @[Attention Is All You Need] 生成一张展示 Transformer 架构的图
```

#### 3.3.3 后端处理

当检测到 @ 引用时：

1. 解析引用的资源
2. 提取资源内容（使用现有的 ContentExtractor）
3. 将内容作为上下文传递给图片生成 API

### 3.4 交互细节

#### 3.4.1 Toast 提示

- 添加成功: "✓ 已添加到素材池"
- 素材池已满: "素材池已满，已移除最早的素材"
- 已存在: "该资源已在素材池中"

#### 3.4.2 空状态

素材池为空时显示引导：

```
素材池为空
从 Explore 页面点击资源的 📷 按钮添加素材
```

## 4. 技术方案

### 4.1 前端改动

#### 4.1.1 新增文件

- `stores/imageSourceStore.ts` - 素材池状态管理
- `components/ai-image/SourcePool.tsx` - 素材池组件
- `components/ai-image/SourceMention.tsx` - @ 引用组件

#### 4.1.2 修改文件

- `app/page.tsx` - 资源卡片添加按钮
- `components/ai-image/ImageGenerator.tsx` - 集成素材池和 @ 引用

### 4.2 后端改动

- 无需新增 API
- 复用现有的 ContentExtractor 服务

## 5. 里程碑

### Phase 1: 基础功能 (MVP)

- [ ] 创建素材池 store
- [ ] 资源卡片添加 "To Image" 按钮
- [ ] 点击后跳转到图片生成页面
- [ ] 图片生成器显示素材池

### Phase 2: @ 引用功能

- [ ] 实现 @ 触发的下拉菜单
- [ ] 选择后插入引用标记
- [ ] 后端解析引用并提取内容

### Phase 3: 优化

- [ ] 素材池持久化
- [ ] 批量添加素材
- [ ] 素材预览

## 6. 风险与限制

### 6.1 技术风险

- 大型 PDF/视频内容提取可能耗时较长
- @ 引用的解析需要考虑特殊字符转义

### 6.2 用户体验

- 素材池概念可能需要用户学习
- 需要清晰的引导和提示

## 7. 成功指标

- 从资源卡片到图片生成的转化率
- @ 引用功能的使用频率
- 用户生成图片的数量变化
