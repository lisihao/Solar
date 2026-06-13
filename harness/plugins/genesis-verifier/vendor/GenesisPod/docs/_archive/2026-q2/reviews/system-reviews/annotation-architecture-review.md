# AI Research 批注功能架构审查报告

## 文档信息

- **版本**: 1.0
- **作者**: Architect Agent
- **审查日期**: 2026-01-16
- **审查范围**: 批注功能全链路 (高亮、跳转、章节切换)
- **状态**: 完成

---

## 1. 现状分析

### 1.1 设计文档需求 vs 当前实现

| 需求 ID | 功能描述               | 优先级 | 当前状态 | 差距说明                   |
| ------- | ---------------------- | ------ | -------- | -------------------------- |
| F-002   | 已批注文本显示高亮背景 | P0     | 部分实现 | 新批注添加后高亮可能不显示 |
| F-005   | 点击批注跳转到对应位置 | P0     | 部分实现 | 跳转后闪烁动画不稳定       |
| -       | 章节切换后高亮保持     | P0     | 故障     | 导致 React 错误 #310 崩溃  |
| -       | 预览/编辑模式一致性    | P1     | 未实现   | 编辑模式无法显示高亮       |

### 1.2 当前架构概览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        TopicContentPanel                                 │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  State: annotations[], highlightedAnnotationId, sidePanelType     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                              │                                           │
│              ┌───────────────┼───────────────┐                          │
│              ▼               ▼               ▼                          │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────┐   │
│  │ ReportEditor    │ │ChapterizedView  │ │ ReportAnnotations       │   │
│  │ (连续视图)       │ │ (章节视图)      │ │ (批注列表面板)           │   │
│  │                 │ │                 │ │                         │   │
│  │ [React.memo]    │ │ [React.memo]    │ │ onNavigate -> set       │   │
│  │ with custom     │ │ with custom     │ │ highlightedAnnotationId │   │
│  │ comparison      │ │ comparison      │ │                         │   │
│  └────────┬────────┘ └────────┬────────┘ └─────────────────────────┘   │
│           │                   │                                         │
│           ▼                   ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │              AnnotationHighlighter (DOM 后处理组件)               │   │
│  │  ┌───────────────────────────────────────────────────────────┐  │   │
│  │  │ useEffect:                                                 │  │   │
│  │  │   1. clearHighlights(container)  // 清除所有 <mark>       │  │   │
│  │  │   2. findTextRange(annotation)   // 查找文本位置          │  │   │
│  │  │   3. highlightRange(range)       // 插入 <mark> 元素      │  │   │
│  │  └───────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘

                    数据流向
                    ─────────
ReactMarkdown 渲染 → DOM 生成 → useEffect 触发 → 修改 DOM (添加 <mark>)
                                     ↑
                                     │ 状态变更触发重新渲染
                                     │
                           annotations 或 content 变更
```

### 1.3 核心文件清单

| 文件                           | 职责               | 代码行数 | 复杂度 |
| ------------------------------ | ------------------ | -------- | ------ |
| `AnnotationHighlighter.tsx`    | DOM 后处理高亮     | ~380     | 高     |
| `ReportEditor.tsx`             | 连续视图报告编辑器 | ~1490    | 高     |
| `ChapterizedReportView.tsx`    | 章节视图           | ~1090    | 高     |
| `ReportAnnotations.tsx`        | 批注列表面板       | ~560     | 中     |
| `TextSelectionContextMenu.tsx` | 文本选择右键菜单   | ~490     | 中     |
| `text-finder.ts`               | 文本定位算法       | ~520     | 高     |
| `dom-highlighter.ts`           | DOM 高亮工具       | ~420     | 高     |

---

## 2. 问题根因分析

### 2.1 问题一: 新批注无高亮背景

**现象**: 用户添加批注后，选中的文本没有显示高亮背景色

**根因分析**:

```
时序图:
─────────────────────────────────────────────────────────────────────────
T1: 用户选中文本，点击"添加批注"
T2: handleAddAnnotation() 调用 API 创建批注
T3: setAnnotations([...prev, newAnnotation]) 触发状态更新
T4: ReportEditor 被 React.memo 阻止重新渲染 (annotations 变更但 memo 比较通过)
T5: AnnotationHighlighter useEffect 触发...
T6: 但 containerRef 可能指向旧 DOM 或者被 memo 跳过
─────────────────────────────────────────────────────────────────────────
```

**问题代码位置**: `ReportEditor.tsx:230-258`

```typescript
function areReportEditorPropsEqual(
  prevProps: ReportEditorProps,
  nextProps: ReportEditorProps,
): boolean {
  // ...
  // Deep compare annotations
  for (let i = 0; i < prevAnnotations.length; i++) {
    const prev = prevAnnotations[i];
    const next = nextAnnotations[i];
    if (
      prev.id !== next.id ||
      prev.selectedText !== next.selectedText ||
      prev.color !== next.color
    ) {
      return false;
    }
  }
  // 问题: 只比较了已有批注，新增批注时长度变化能检测到
  // 但 highlightedAnnotationId 被故意排除，导致 AnnotationHighlighter
  // 可能没有收到正确的 props 更新
  return true;
}
```

**真正的根因**:

1. `areReportEditorPropsEqual` 检查了 annotations 数组长度变化，应该能检测新增
2. 问题在于 `AnnotationHighlighter` 的 useEffect 使用了复杂的延迟调度 (queueMicrotask + setTimeout + requestAnimationFrame)
3. 在这个延迟期间，如果发生其他状态变更，可能导致 containerRef 失效

### 2.2 问题二: 章节切换导致崩溃 (React 错误 #310)

**现象**: 切换章节时页面崩溃，控制台显示 React 错误 #310

**React 错误 #310 说明**:

> "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node."

**根因分析**:

```
React 渲染模型:
────────────────────────────────────────────────────────────────
Virtual DOM:      <p>Hello World</p>
                       ↓
Actual DOM:       <p>Hello <mark>World</mark></p>  (被 AnnotationHighlighter 修改)
                       ↓
React Reconcile:  尝试将 Virtual DOM 应用到 Actual DOM
                  发现 DOM 结构不匹配 → 抛出错误 #310
────────────────────────────────────────────────────────────────
```

**问题代码位置**: `ChapterizedReportView.tsx:596-628`

```typescript
// Navigate to highlighted annotation when it changes
useEffect(() => {
  if (!highlightedAnnotationId) return;

  // Find which chapter contains this annotation text
  const chapterWithAnnotation = chapters.find((chapter) =>
    chapter.content.includes(annotation.selectedText),
  );

  // If found and different from current, select that chapter
  if (
    chapterWithAnnotation &&
    chapterWithAnnotation.id !== selectedChapter?.id
  ) {
    setSelectedChapter(chapterWithAnnotation); // ★ 触发章节切换
  }
  // ...
}, [
  highlightedAnnotationId,
  chapters,
  annotations,
  selectedChapter?.id,
  viewMode,
]);
```

**冲突时序**:

```
T1: 用户点击批注列表中的批注
T2: setHighlightedAnnotationId('ann-123')
T3: ChapterizedReportView useEffect 触发
T4: setSelectedChapter(newChapter) 改变选中章节
T5: React 尝试重新渲染新章节内容
T6: 但旧章节的 DOM 已被 AnnotationHighlighter 修改过
T7: React reconciliation 失败 → 错误 #310
```

### 2.3 问题三: 跳转定位不稳定

**现象**: 点击批注列表跳转时，有时能正确滚动到目标位置，有时不行

**根因分析**:

`scrollToAnnotation` 函数依赖于 `[data-annotation-id]` 属性的 mark 元素存在:

```typescript
// dom-highlighter.ts:358-378
export function scrollToAnnotation(
  container: HTMLElement,
  annotationId: string,
): boolean {
  const mark = container.querySelector(
    `[${ANNOTATION_ATTR}="${annotationId}"]`,
  );
  if (!mark) return false; // ★ mark 元素可能不存在
  mark.scrollIntoView({ behavior: "smooth", block: "center" });
  // ...
}
```

**问题**:

1. 如果高亮还没应用完成，mark 元素不存在
2. 如果文本匹配失败，mark 元素不会创建
3. 如果在章节切换过程中，旧章节的 mark 被清理但新章节的还没创建

### 2.4 问题四: 预览/编辑模式不一致

**现象**: 在编辑模式下，批注高亮不显示

**根因**: 这是设计选择，不是 bug。编辑模式使用 TipTap 编辑器，其 DOM 结构与预览模式不同。

---

## 3. 架构评估

### 3.1 当前架构优点

1. **关注点分离**:
   - `text-finder.ts` 专注文本查找
   - `dom-highlighter.ts` 专注 DOM 操作
   - `AnnotationHighlighter.tsx` 作为 React 组件封装

2. **跨段落支持**:
   - DOM 后处理方案天然支持跨段落高亮
   - 不需要修改 ReactMarkdown 的渲染逻辑

3. **模糊匹配**:
   - 支持去除引用标记后的模糊匹配
   - 处理了一些边界情况

### 3.2 当前架构缺点

1. **React 渲染模型冲突** (严重):
   - 直接操作 DOM 与 React 的 Virtual DOM 协调机制冲突
   - 导致不可预测的崩溃

2. **状态同步问题** (严重):
   - DOM 状态与 React 状态不同步
   - 复杂的延迟调度难以保证时序正确

3. **性能问题** (中等):
   - 每次 annotations 变更都要清除所有高亮再重新应用
   - 大量批注时可能有性能问题

4. **可维护性问题** (中等):
   - 三层调度 (queueMicrotask + setTimeout + requestAnimationFrame) 难以理解和调试
   - 多个 React.memo 和 useMemo 的复杂比较逻辑

### 3.3 架构评分

| 维度       | 评分 | 说明                     |
| ---------- | ---- | ------------------------ |
| 功能完整性 | 3/5  | 核心功能实现，但不稳定   |
| 稳定性     | 2/5  | 存在崩溃风险             |
| 可维护性   | 2/5  | 代码复杂，难以调试       |
| 性能       | 3/5  | 满足基本需求，有优化空间 |
| 可扩展性   | 2/5  | 架构限制扩展性           |

**总体评分: 2.4/5**

---

## 4. 根治方案

### 4.1 方案选型比较

| 方案                       | 描述                             | 优点              | 缺点                         | 复杂度 | 推荐度   |
| -------------------------- | -------------------------------- | ----------------- | ---------------------------- | ------ | -------- |
| A. 优化当前 DOM 后处理     | 改进时序控制、增加稳定性保护     | 改动小            | 治标不治本                   | 低     | 不推荐   |
| B. Portal + 绝对定位覆盖层 | 用独立图层覆盖高亮               | 不修改原 DOM      | 定位计算复杂、滚动同步问题   | 高     | 不推荐   |
| C. CSS 伪元素高亮          | 用 CSS ::before/::after 实现高亮 | 不修改 DOM 结构   | 无法跨元素、样式限制         | 中     | 不推荐   |
| **D. React 受控高亮**      | 在 ReactMarkdown 渲染时内联处理  | 与 React 模型一致 | 需要重构渲染逻辑、跨段落复杂 | 高     | **推荐** |
| E. Shadow DOM 隔离         | 将批注内容放在 Shadow DOM        | 完全隔离          | 样式穿透问题、浏览器兼容     | 高     | 不推荐   |

### 4.2 推荐方案: React 受控高亮 (方案 D)

#### 4.2.1 核心思想

将高亮逻辑从 "DOM 后处理" 转变为 "React 渲染时内联处理":

```
当前方案 (DOM 后处理):
ReactMarkdown 渲染 → DOM 生成 → useEffect 修改 DOM → 添加 <mark>

推荐方案 (React 受控):
标记批注位置 → 拆分文本 → ReactMarkdown 渲染时直接生成 <mark>
```

#### 4.2.2 详细设计

**Step 1: 预处理批注位置**

```typescript
// 新文件: frontend/lib/annotation/annotation-preprocessor.ts

interface AnnotatedSegment {
  text: string;
  annotationId?: string;
  color?: AnnotationColor;
}

/**
 * 将原始 Markdown 文本和批注列表转换为带标记的段落列表
 */
export function preprocessAnnotations(
  markdownContent: string,
  annotations: Annotation[],
): AnnotatedSegment[][] {
  // 1. 解析 Markdown 为段落
  const paragraphs = markdownContent.split(/\n\n+/);

  // 2. 对每个段落，根据批注位置拆分文本
  return paragraphs.map((paragraph) => {
    return splitTextByAnnotations(paragraph, annotations);
  });
}

function splitTextByAnnotations(
  text: string,
  annotations: Annotation[],
): AnnotatedSegment[] {
  // 使用类似 text-finder 的逻辑定位批注
  // 但不操作 DOM，而是返回拆分后的文本段落
  // ...
}
```

**Step 2: 创建受控高亮组件**

```typescript
// 新文件: frontend/components/ai-research/AnnotatedText.tsx

interface AnnotatedTextProps {
  segments: AnnotatedSegment[];
  highlightedId?: string | null;
  onAnnotationClick?: (id: string) => void;
}

export function AnnotatedText({
  segments,
  highlightedId,
  onAnnotationClick,
}: AnnotatedTextProps) {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.annotationId) {
          return (
            <mark
              key={`${segment.annotationId}-${index}`}
              data-annotation-id={segment.annotationId}
              className={cn(
                'rounded px-0.5 cursor-pointer transition-all',
                colorClasses[segment.color || 'yellow'],
                highlightedId === segment.annotationId && 'ring-2 ring-blue-500'
              )}
              onClick={() => onAnnotationClick?.(segment.annotationId!)}
            >
              {segment.text}
            </mark>
          );
        }
        return <span key={index}>{segment.text}</span>;
      })}
    </>
  );
}
```

**Step 3: 集成到 ReactMarkdown**

```typescript
// 修改: ReportEditor.tsx

const processedContent = useMemo(() => {
  return preprocessAnnotations(markdownContent, annotations);
}, [markdownContent, annotations]);

// 在 ReactMarkdown components 中使用
<ReactMarkdown
  components={{
    p: ({ children }) => {
      // 如果 children 是纯文本，检查是否有批注
      const text = extractText(children);
      const segments = processedContent.get(text);
      if (segments) {
        return (
          <p>
            <AnnotatedText
              segments={segments}
              highlightedId={highlightedAnnotationId}
              onAnnotationClick={onAnnotationClick}
            />
          </p>
        );
      }
      return <p>{children}</p>;
    },
    // ... 其他元素类似处理
  }}
>
  {markdownContent}
</ReactMarkdown>
```

**Step 4: 跨段落批注处理**

跨段落批注是复杂场景，需要特殊处理:

```typescript
// 在 annotation-preprocessor.ts 中

interface CrossParagraphAnnotation {
  annotationId: string;
  paragraphIndices: number[]; // 涉及的段落索引
  startOffsetInFirst: number; // 第一段的起始位置
  endOffsetInLast: number; // 最后一段的结束位置
}

export function preprocessCrossParagraphAnnotations(
  paragraphs: string[],
  annotations: Annotation[],
): {
  paragraphSegments: AnnotatedSegment[][];
  crossParagraphAnnotations: CrossParagraphAnnotation[];
} {
  // 1. 标识跨段落批注
  // 2. 对每个段落部分添加批注标记
  // 3. 返回处理结果
}
```

#### 4.2.3 章节切换安全性

方案 D 自动解决章节切换崩溃问题:

```
React 受控方案:
─────────────────────────────────────────────────────────────────
T1: setSelectedChapter(newChapter)
T2: React 计算新的 Virtual DOM (包含 <mark> 元素)
T3: React 清理旧 DOM、渲染新 DOM (完全由 React 控制)
T4: 无冲突，因为 DOM 结构始终与 Virtual DOM 一致
─────────────────────────────────────────────────────────────────
```

### 4.3 迁移策略

采用渐进式迁移，保证稳定性:

#### Phase 1: 基础设施 (2-3天)

1. 创建 `annotation-preprocessor.ts` 预处理模块
2. 创建 `AnnotatedText.tsx` 受控高亮组件
3. 编写单元测试覆盖核心逻辑

#### Phase 2: 连续视图迁移 (2-3天)

1. 在 `ReportEditor.tsx` 中集成新方案
2. 移除 `AnnotationHighlighter` 组件
3. 移除 `React.memo` 的自定义比较函数 (不再需要)
4. 测试验证功能正常

#### Phase 3: 章节视图迁移 (2-3天)

1. 在 `ChapterizedReportView.tsx` 中集成新方案
2. 移除相关的 DOM 后处理代码
3. 测试章节切换稳定性

#### Phase 4: 清理和优化 (1-2天)

1. 删除废弃文件:
   - `AnnotationHighlighter.tsx`
   - `text-finder.ts` (部分逻辑迁移到预处理器)
   - `dom-highlighter.ts`
2. 性能优化和边界情况处理
3. 更新文档

### 4.4 代码改动范围

| 文件                         | 改动类型 | 估计工作量                               |
| ---------------------------- | -------- | ---------------------------------------- |
| `annotation-preprocessor.ts` | 新增     | 200行                                    |
| `AnnotatedText.tsx`          | 新增     | 80行                                     |
| `ReportEditor.tsx`           | 修改     | -150行 (移除 AnnotationHighlighter 相关) |
| `ChapterizedReportView.tsx`  | 修改     | -100行                                   |
| `AnnotationHighlighter.tsx`  | 删除     | -380行                                   |
| `text-finder.ts`             | 重构     | -200行 (核心逻辑迁移)                    |
| `dom-highlighter.ts`         | 删除     | -420行                                   |
| 单元测试                     | 新增     | +300行                                   |

**净代码变化**: 约 -670 行 (删除复杂的 DOM 操作代码)

---

## 5. 短期缓解措施

如果无法立即实施根治方案，以下是短期缓解措施:

### 5.1 添加错误边界

```typescript
// 在 ReportEditor 和 ChapterizedReportView 外层添加
<ErrorBoundary
  fallback={<div>批注功能异常，请刷新页面重试</div>}
  onError={(error) => {
    console.error('Annotation error:', error);
    // 清理批注高亮状态
    clearHighlights(containerRef.current);
  }}
>
  <ReportEditor ... />
</ErrorBoundary>
```

### 5.2 增加稳定性检查

在 `AnnotationHighlighter.tsx` 的 useEffect 中添加:

```typescript
// 在执行 DOM 操作前检查容器是否稳定
const isContainerStable = () => {
  return (
    containerRef.current &&
    containerRef.current.isConnected &&
    containerRef.current.children.length > 0
  );
};

if (!isContainerStable()) {
  console.warn("Container not stable, skipping highlight");
  return;
}
```

### 5.3 延长延迟时间

将延迟从 300ms 增加到 500ms，给 React 更多时间完成渲染:

```typescript
const baseDelay = isSimpleAddition ? 500 : 100; // 增加延迟
```

---

## 6. 风险和缓解

| 风险               | 可能性 | 影响 | 缓解措施                                  |
| ------------------ | ------ | ---- | ----------------------------------------- |
| 迁移过程引入新 Bug | 中     | 高   | 完善单元测试、分阶段迁移、保留回滚能力    |
| 跨段落批注兼容性   | 中     | 中   | 充分测试边界情况、保留旧方案作为 fallback |
| 性能下降           | 低     | 低   | 使用 useMemo 缓存预处理结果               |
| 样式不一致         | 低     | 低   | 复用现有 CSS 类名                         |

---

## 7. 结论

当前批注功能的架构采用 "DOM 后处理" 方案，与 React 的渲染模型存在根本性冲突，导致:

1. 新批注可能无法显示高亮
2. 章节切换导致页面崩溃 (React 错误 #310)
3. 跳转定位不稳定

**根治方案**: 迁移到 "React 受控高亮" 方案，将高亮逻辑从 useEffect DOM 操作转变为 React 渲染时内联处理。这样可以:

- 彻底消除 React reconciliation 冲突
- 简化代码架构
- 提高可维护性和可测试性

**估计工作量**: 8-11 人天

**优先级**: P0 (影响核心功能稳定性)

---

## 8. 附录

### 8.1 相关文件路径

```
frontend/
  components/ai-research/
    AnnotationHighlighter.tsx      # 待删除
    ReportEditor.tsx               # 待修改
    ChapterizedReportView.tsx      # 待修改
    ReportAnnotations.tsx          # 无需修改
    TextSelectionContextMenu.tsx   # 无需修改
  lib/annotation/
    text-finder.ts                 # 待重构
    dom-highlighter.ts             # 待删除
    index.ts                       # 待更新
    annotation-preprocessor.ts     # 新增
```

### 8.2 参考资料

- React Reconciliation: https://react.dev/learn/preserving-and-resetting-state
- React Error #310: https://react.dev/errors/310
- Web Annotation Data Model: https://www.w3.org/TR/annotation-model/

### 8.3 变更记录

| 版本 | 日期       | 变更内容 | 作者            |
| ---- | ---------- | -------- | --------------- |
| 1.0  | 2026-01-16 | 初始版本 | Architect Agent |

---

**文档结束**
