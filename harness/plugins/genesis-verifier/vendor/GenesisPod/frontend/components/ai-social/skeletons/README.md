# AI Social Skeletons - 骨架屏组件

改善 AI Social 模块加载体验的占位符组件。

## 组件列表

### 1. ConnectionCardSkeleton

模拟平台连接卡片的加载状态。

```tsx
import { ConnectionCardSkeleton, ConnectionCardSkeletonGrid } from '@/components/ai-social/skeletons';

// 单个卡片
<ConnectionCardSkeleton />

// 网格布局（默认 3 个）
<ConnectionCardSkeletonGrid />

// 自定义数量
<ConnectionCardSkeletonGrid count={6} />
```

**使用场景**:

- ConnectionsTab 初次加载
- 平台连接列表刷新

**布局特点**:

- 包含平台图标、名称、账号占位符
- 状态指示器占位符
- 操作按钮区域占位符
- 使用 `animate-pulse` 动画

### 2. ContentTableSkeleton

模拟内容表格的加载状态。

```tsx
import { ContentTableSkeleton } from '@/components/ai-social/skeletons';

// 默认 5 行
<ContentTableSkeleton />

// 自定义行数
<ContentTableSkeleton rows={10} />
```

**使用场景**:

- ContentsTab 初次加载
- 内容列表筛选/刷新

**布局特点**:

- 完整的表格结构（表头 + 表体）
- 6 列：标题、类型、来源、状态、日期、操作
- 每行包含图标、文本、徽章、按钮占位符
- 使用 `animate-pulse` 动画

## 使用示例

### ConnectionsTab

```tsx
{
  loading && connections.length === 0 ? (
    <ConnectionCardSkeletonGrid count={3} />
  ) : (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {/* 实际卡片内容 */}
    </div>
  );
}
```

### ContentsTab

```tsx
{
  loading && contents.length === 0 ? (
    <ContentTableSkeleton rows={5} />
  ) : filteredContents.length > 0 ? (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {/* 实际表格内容 */}
    </div>
  ) : (
    <EmptyState />
  );
}
```

## 设计原则

1. **结构匹配**: 骨架屏布局与实际组件保持一致
2. **适当细节**: 包含关键元素的占位符,避免过度复杂
3. **视觉和谐**: 使用项目统一的灰色调 (`bg-gray-100`, `bg-gray-200`)
4. **动画效果**: 使用 Tailwind 的 `animate-pulse` 提供加载反馈
5. **响应式**: 支持不同屏幕尺寸,与实际组件保持一致

## 性能考虑

- 骨架屏组件轻量级,无状态
- 使用纯 CSS 动画 (`animate-pulse`)
- 避免复杂计算和数据处理
- 仅在初次加载时显示 (`loading && items.length === 0`)

## 扩展建议

如需添加新的骨架屏组件:

1. 分析目标组件的视觉结构
2. 创建对应的骨架屏组件
3. 使用相同的布局类名
4. 添加 `animate-pulse` 动画
5. 导出到 `index.ts`
6. 更新此 README

## 相关文件

- `ConnectionCardSkeleton.tsx` - 连接卡片骨架屏
- `ContentTableSkeleton.tsx` - 内容表格骨架屏
- `index.ts` - 统一导出
- `../ConnectionsTab.tsx` - 使用示例
- `../ContentsTab.tsx` - 使用示例
