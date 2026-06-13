# 页面布局标准 - Page Layout Standard

> 基于 AI Writing 首页布局，适用于 AI Teams、AI Tools、AI Skills 等左侧子菜单的首页布局。

## 核心结构

```tsx
<AppShell>
  <main className="flex-1 overflow-y-auto">
    {/* Sticky Header */}
    <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
      <div className="px-8 py-6">{/* Header Content */}</div>
    </div>

    {/* Content Area */}
    <div className="px-8 py-6">{/* Main Content */}</div>
  </main>
</AppShell>
```

## 关键布局规则

### 1. AppShell 包装

```tsx
<AppShell>
  <main className="flex-1 overflow-y-auto">{/* 内容 */}</main>
</AppShell>
```

- **必须**使用 `<main className="flex-1 overflow-y-auto">` 包装内容
- 确保左侧菜单固定，右侧内容独立滚动

### 2. Sticky Header

```tsx
<div className="sticky top-0 z-10 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
  <div className="px-8 py-6">
    {/* 标题行 */}
    <div className="flex items-center justify-between">
      {/* 左侧: 图标 + 标题 */}
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-{color}-500 to-{color}-600 shadow-lg shadow-{color}-500/25">
          {/* Icon */}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500">{subtitle}</p>
        </div>
      </div>

      {/* 右侧: 主操作按钮 */}
      <button className="flex items-center gap-2 rounded-lg bg-{color}-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-{color}-700">
        <PlusIcon className="h-5 w-5" />
        {actionLabel}
      </button>
    </div>

    {/* 搜索栏 (可选) */}
    <div className="mt-4">
      <div className="relative">
        <SearchIcon className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder={searchPlaceholder}
          className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-12 pr-4 text-sm outline-none transition-all focus:border-{color}-500 focus:ring-2 focus:ring-{color}-500/20"
        />
      </div>
    </div>
  </div>
</div>
```

### 3. Content Area

```tsx
<div className="px-8 py-6">{/* 根据状态显示不同内容 */}</div>
```

### 4. 状态处理

#### Loading 状态

```tsx
<div className="flex items-center justify-center py-12">
  <div className="h-8 w-8 animate-spin rounded-full border-4 border-{color}-500 border-t-transparent" />
</div>
```

#### Empty 状态

```tsx
<div className="flex flex-col items-center justify-center py-12">
  <Icon className="h-16 w-16 text-gray-300" />
  <h3 className="mt-4 text-lg font-medium text-gray-700">{emptyTitle}</h3>
  <p className="mt-2 text-sm text-gray-500">{emptyDescription}</p>
  <button className="mt-4 rounded-lg bg-{color}-600 px-4 py-2 text-sm font-medium text-white hover:bg-{color}-700">
    {createLabel}
  </button>
</div>
```

#### No Results 状态

```tsx
<div className="flex flex-col items-center justify-center py-12">
  <SearchIcon className="h-16 w-16 text-gray-300" />
  <h3 className="mt-4 text-lg font-medium text-gray-700">{noResultsTitle}</h3>
  <p className="mt-2 text-sm text-gray-500">{noResultsDescription}</p>
</div>
```

### 5. 网格卡片布局

```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
  {items.map((item) => (
    <div
      key={item.id}
      onClick={() => handleClick(item)}
      className="group relative cursor-pointer rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:border-{color}-300 hover:shadow-md"
    >
      {/* 卡片内容 */}
    </div>
  ))}

  {/* 创建新项卡片 */}
  <button
    onClick={handleCreate}
    className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-white p-6 transition-colors hover:border-{color}-400 hover:bg-{color}-50"
  >
    <PlusIcon className="h-10 w-10 text-gray-400" />
    <span className="mt-2 text-sm font-medium text-gray-600">
      {createLabel}
    </span>
  </button>
</div>
```

### 6. 卡片结构

```tsx
<div className="group relative cursor-pointer rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:border-{color}-300 hover:shadow-md">
  {/* 悬停操作按钮 */}
  <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
    <button className="rounded-lg bg-white p-1.5 text-gray-400 shadow-sm hover:bg-gray-50 hover:text-gray-600">
      {/* 操作图标 */}
    </button>
  </div>

  {/* 头部: 图标 + 状态 */}
  <div className="flex items-start justify-between">
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-{color}-500 to-{color}-600 shadow-lg">
      {/* 图标 */}
    </div>
    <span className="rounded-full bg-{status-color}-100 px-2 py-0.5 text-xs font-medium text-{status-color}-700">
      {statusLabel}
    </span>
  </div>

  {/* 标题 & 描述 */}
  <h3 className="mt-3 truncate text-base font-semibold text-gray-900 group-hover:text-{color}-600">
    {title}
  </h3>
  <p className="mt-1 line-clamp-2 text-sm text-gray-500">{description}</p>

  {/* 进度条 (可选) */}
  <div className="mt-4">
    <div className="mb-1.5 flex items-center justify-between text-xs">
      <span className="text-gray-500">{progressText}</span>
      <span className="font-medium text-{color}-600">{progressPercent}%</span>
    </div>
    <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
      <div
        className="h-full rounded-full bg-gradient-to-r from-{color}-400 to-{color2}-400"
        style={{ width: `${progressPercent}%` }}
      />
    </div>
  </div>

  {/* 底部: 标签 + 时间 */}
  <div className="mt-4 flex items-center justify-between">
    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
      {tag}
    </span>
    <span className="text-xs text-gray-400">{timeAgo}</span>
  </div>
</div>
```

## 模块颜色主题

| 模块        | 主色    | 渐变                          |
| ----------- | ------- | ----------------------------- |
| AI Writing  | amber   | from-amber-500 to-orange-600  |
| AI Teams    | violet  | from-violet-500 to-purple-600 |
| AI Tools    | blue    | from-blue-500 to-cyan-500     |
| AI Skills   | emerald | from-emerald-500 to-teal-500  |
| AI Image    | pink    | from-pink-500 to-rose-500     |
| AI Research | indigo  | from-indigo-500 to-blue-600   |

## 模态框结构

```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
  <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
    {/* Header - Fixed */}
    <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <button className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
        <CloseIcon className="h-6 w-6" />
      </button>
    </div>

    {/* Content - Scrollable */}
    <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
      {/* 表单内容 */}
    </div>

    {/* Footer - Fixed */}
    <div className="flex flex-shrink-0 justify-end gap-3 border-t border-gray-200 px-6 py-4">
      <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
        取消
      </button>
      <button className="rounded-lg bg-{color}-600 px-4 py-2 text-sm font-medium text-white hover:bg-{color}-700 disabled:cursor-not-allowed disabled:opacity-50">
        确认
      </button>
    </div>
  </div>
</div>
```

## 响应式断点

```
sm: 640px   - 2 列网格
lg: 1024px  - 3 列网格
xl: 1280px  - 4 列网格
```

## 使用示例

### AI Teams 首页

```tsx
// 替换变量
{color} → violet
{title} → "AI Teams"
{subtitle} → "多 Agent 协作研究"
{actionLabel} → "创建团队"
{searchPlaceholder} → "搜索团队..."
```

### AI Tools 首页

```tsx
// 替换变量
{color} → blue
{title} → "AI Tools"
{subtitle} → "AI 工具集合"
{actionLabel} → "添加工具"
{searchPlaceholder} → "搜索工具..."
```

## 检查清单

- [ ] 使用 `<AppShell>` 包装
- [ ] 使用 `<main className="flex-1 overflow-y-auto">` 确保侧边栏固定
- [ ] Sticky Header 使用毛玻璃效果
- [ ] 统一内边距 `px-8 py-6`
- [ ] 处理 Loading/Empty/NoResults 三种状态
- [ ] 网格布局响应式适配
- [ ] 卡片悬停效果
- [ ] 模态框三段式结构
- [ ] 颜色主题与模块匹配

---

**最后更新**: 2026-01-18
**基于**: AI Writing 首页布局
**适用**: AI Teams, AI Tools, AI Skills, AI Simulation 等首页
