# 批注高亮功能 UX 设计说明

**版本**: v1.0
**日期**: 2026-01-17
**作者**: Claude Code
**状态**: 已实现

---

## 1. 功能概述

批注（Annotation）是报告协作编辑的核心功能，允许用户在报告内容上添加评论、标记和反馈。本文档定义批注高亮在不同视图模式下的显示逻辑，以提供最佳用户体验。

---

## 2. 用户角色与场景

### 2.1 审阅者（Reviewer）

- **工作模式**: 预览模式
- **核心任务**: 阅读报告内容，发现问题，添加批注
- **需求**:
  - 干净的阅读体验（默认不被高亮干扰）
  - 查看批注时能看到高亮定位
  - 能够添加新批注

### 2.2 编辑者（Editor）

- **工作模式**: 编辑模式
- **核心任务**: 修改报告内容，处理批注反馈
- **需求**:
  - 看到批注高亮，知道哪里需要修改
  - 快速定位批注位置
  - 解决批注后高亮消失

### 2.3 普通读者（Reader）

- **工作模式**: 预览模式
- **核心任务**: 阅读最终报告
- **需求**:
  - 纯净的阅读体验
  - 不需要看到内部协作信息

---

## 3. 核心设计原则

### 3.1 批注高亮与面板联动

**原则**: 批注高亮仅在批注面板打开时显示

| 批注面板状态 | 高亮显示  | 用户体验               |
| ------------ | --------- | ---------------------- |
| **关闭**     | ❌ 不显示 | 干净的阅读/编辑体验    |
| **打开**     | ✅ 显示   | 协作工作模式，帮助定位 |

**理由**:

- 用户主动打开批注面板 = 用户关心批注内容
- 用户关闭批注面板 = 用户想要专注内容本身

### 3.2 已解决批注不显示高亮

**原则**: 只有 `active` 状态的批注显示高亮

| 批注状态   | 高亮显示  | 说明           |
| ---------- | --------- | -------------- |
| `active`   | ✅ 显示   | 需要关注和处理 |
| `resolved` | ❌ 不显示 | 已处理完毕     |
| `archived` | ❌ 不显示 | 已归档存档     |

**理由**:

- 已解决的批注不需要再吸引注意力
- 减少视觉噪音

### 3.3 预览模式与编辑模式一致性

**原则**: 预览模式和编辑模式使用相同的批注匹配算法

- 两种模式下相同的批注应该高亮相同的文本
- 避免用户在切换模式时产生困惑

---

## 4. 技术实现

### 4.1 统一匹配算法

所有视图模式使用 `annotation-preprocessor.ts` 的 `splitTextIntoSegments()` 函数：

```typescript
// 10种匹配策略，确保高匹配率
function findAnnotationPosition(content, annotation) {
  // 策略1: 精确匹配
  // 策略2: 移除引用标记后匹配
  // 策略3: 前50字符匹配
  // 策略4: 前3个词匹配
  // 策略5: 前缀/后缀上下文匹配
  // 策略6: 后50字符匹配
  // 策略7: 中间片段匹配
  // 策略8: 首句匹配
  // 策略9: 尾句匹配
  // 策略10: 唯一短语匹配
}
```

### 4.2 高亮显示控制

通过 `showAnnotationHighlights` 属性控制：

```typescript
interface ReportEditorProps {
  // ...其他属性
  showAnnotationHighlights?: boolean; // 默认 true
}

// 使用示例
<ReportEditor
  annotations={annotations}
  showAnnotationHighlights={sidePanelType === 'annotations'}
/>
```

### 4.3 状态过滤

在 `findAnnotationMatches()` 中过滤非活跃批注：

```typescript
const activeAnnotations = annotations.filter(
  (a) => a.status !== "resolved" && a.status !== "archived",
);
```

---

## 5. 用户交互流程

### 5.1 添加批注

```
用户选中文本 → 右键菜单 → 选择"添加批注" → 选择颜色
                                          ↓
批注面板自动打开 ← 批注创建成功 ← 填写批注内容
        ↓
   高亮显示新批注
```

### 5.2 查看批注

```
用户点击"批注"按钮 → 批注面板打开 → 内容区显示高亮
                                    ↓
                        点击批注列表项 → 滚动到高亮位置
```

### 5.3 解决批注

```
用户点击批注"解决" → 批注状态变为 resolved → 高亮消失
                                          ↓
                              批注移到"已解决"列表
```

---

## 6. 视觉设计

### 6.1 高亮颜色

| 颜色 | CSS类           | 使用场景      |
| ---- | --------------- | ------------- |
| 黄色 | `bg-yellow-200` | 默认/一般批注 |
| 绿色 | `bg-green-200`  | 正面反馈      |
| 蓝色 | `bg-blue-200`   | 信息补充      |
| 粉色 | `bg-pink-200`   | 重要提醒      |
| 紫色 | `bg-purple-200` | 问题标记      |

### 6.2 高亮样式

```css
mark.annotation-highlight {
  /* 背景色由颜色属性决定 */
  padding: 0 2px;
  border-radius: 2px;
  cursor: pointer;
}

/* 当前选中的批注 */
mark.annotation-highlight[data-highlighted="true"] {
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5);
  animation: pulse 1s ease-in-out;
}
```

---

## 7. 边界情况处理

### 7.1 跨段落批注

- 使用多种匹配策略确保跨段落文本能被正确匹配
- 首句/尾句匹配策略专门处理多行批注

### 7.2 内容编辑后批注失效

- 当内容被修改导致批注文本不再匹配时：
  - 批注在列表中仍然可见
  - 高亮不显示（无法定位）
  - 可以手动删除或保留批注

### 7.3 批注数量限制

- 建议单篇报告批注数量不超过500个
- 超过时可能影响渲染性能

---

## 8. 相关文件

| 文件                                                        | 描述             |
| ----------------------------------------------------------- | ---------------- |
| `frontend/lib/annotation/annotation-preprocessor.ts`        | 批注匹配算法核心 |
| `frontend/components/ai-research/ReportEditor.tsx`          | 报告编辑器组件   |
| `frontend/components/ai-research/ReportEditPanel.tsx`       | 报告编辑面板     |
| `frontend/components/ai-research/ChapterizedReportView.tsx` | 章节视图组件     |
| `frontend/components/ai-research/AnnotatedText.tsx`         | 批注高亮渲染组件 |

---

## 9. 修订历史

| 版本 | 日期       | 变更                         |
| ---- | ---------- | ---------------------------- |
| v1.0 | 2026-01-17 | 初始版本，定义批注高亮UX规范 |

---

**文档归档位置**: `docs/prd/annotation-highlight-ux-design.md`
