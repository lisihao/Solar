# Admin 配置界面布局标准 - Admin Config Layout Standard

> ⚠️ **DEPRECATED (2026-05-11)** — 本文档已被 `.claude/standards/20-admin-ui-design.md` v1.0 取代。
>
> 已知冲突：
>
> - Modal 圆角：本文 `rounded-2xl` → 规范 `rounded-xl`
> - Emoji 示例（🤖）：规范明确禁止
> - Domain 命名：本文 `ai/system/content/users` → `lib/admin/styles.ts` 实际 6 域 → 正在演进为 4 实体 `user/secret/data/system`
>
> **新页面请直接参照 `standards/20-admin-ui-design.md`，本文档仅保留作历史参考。**
>
> 基于 AI Models 配置页面布局，适用于 Admin 下所有配置管理页面。

## 核心结构

```tsx
import { AdminPageLayout } from "@/components/admin/layout";

export default function AdminXxxPage() {
  return (
    <AdminPageLayout
      title={t("admin.nav.xxx")}
      description={t("admin.tabDescriptions.xxx")}
      icon={IconComponent}
      domain="ai" // 或 "system" | "content" | "users"
      actions={<ActionButtons />}
    >
      {/* 内容区域 */}
    </AdminPageLayout>
  );
}
```

## AdminPageLayout 组件

### Props

| 属性           | 类型        | 默认值 | 说明                             |
| -------------- | ----------- | ------ | -------------------------------- |
| title          | string      | 必填   | 页面标题                         |
| description    | string      | -      | 页面描述                         |
| icon           | LucideIcon  | -      | 标题图标                         |
| domain         | AdminDomain | -      | 颜色域 (ai/system/content/users) |
| actions        | ReactNode   | -      | 右侧操作按钮                     |
| searchBar      | ReactNode   | -      | 搜索栏                           |
| maxWidth       | string      | '7xl'  | 最大宽度                         |
| showBackButton | boolean     | true   | 显示返回按钮                     |

### 内置布局

```tsx
<div className="flex h-full flex-col bg-gray-50/50">
  {/* Sticky Header */}
  <header className="sticky top-0 z-10 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
    <div className="mx-auto px-6 py-5 max-w-7xl">
      {/* Back + Icon + Title + Actions */}
    </div>
  </header>

  {/* Content - 自动滚动 */}
  <main className="flex-1 overflow-auto">
    <div className="mx-auto px-6 py-6 max-w-7xl">{children}</div>
  </main>
</div>
```

## 配置卡片网格

### 网格布局

```tsx
<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
  {items.map((item) => (
    <ConfigCard key={item.id} item={item} />
  ))}
</div>
```

### 卡片结构

```tsx
<div
  className={`rounded-xl border-2 bg-white p-5 shadow-sm transition-all ${
    item.isDefault ? "border-blue-500" : "border-gray-200"
  } ${!item.isEnabled ? "opacity-60" : ""}`}
>
  {/* 1. Header: Logo + 名称 + 状态 + 开关 */}
  <div className="mb-4 flex items-start justify-between">
    <div className="flex items-center gap-3">
      {/* Logo/Icon */}
      <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-{color}-500 to-{color}-600 text-2xl text-white shadow-sm">
        <img src={iconUrl} alt={name} className="h-8 w-8" />
        {/* 或 emoji: 🤖 */}
      </div>

      {/* 名称 + 状态标签 */}
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-gray-900">{displayName}</h3>
          {isDefault && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              Default
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500">{provider}</p>
      </div>
    </div>

    {/* 启用/禁用开关 */}
    <ToggleSwitch enabled={isEnabled} onChange={handleToggle} />
  </div>

  {/* 2. Info List: Key-Value 配置项 */}
  <div className="mb-4 space-y-2 text-sm">
    <InfoRow label="Model ID" value={modelId} mono />
    <InfoRow label="Type" value={type} badge badgeColor="blue" />
    <InfoRow
      label="API Key"
      value={hasKey ? "✓ Configured" : "✗ Not configured"}
      status
    />
    <InfoRow label="Max Tokens" value={maxTokens} />
    <InfoRow label="Temperature" value={temperature} />
  </div>

  {/* 3. Capability Tags: 能力标签 */}
  <div className="mb-4 flex flex-wrap gap-1">
    {supportsTemperature && (
      <CapabilityTag code="T" label="支持 temperature" color="green" />
    )}
    {supportsStreaming && (
      <CapabilityTag code="S" label="支持流式" color="blue" />
    )}
    {supportsFunctionCalling && (
      <CapabilityTag code="F" label="支持函数调用" color="purple" />
    )}
    {supportsVision && <CapabilityTag code="V" label="支持视觉" color="pink" />}
    <span className="ml-auto text-xs text-gray-400">优先级: {priority}</span>
  </div>

  {/* 4. Test Result: 测试结果 (可选) */}
  {testResult && (
    <div
      className={`mb-4 rounded-lg p-3 text-sm ${
        testResult.success
          ? "bg-green-50 text-green-700"
          : "bg-red-50 text-red-700"
      }`}
    >
      <div className="flex items-center justify-between">
        <span>{testResult.message}</span>
        {testResult.latency && (
          <span className="font-mono text-xs">{testResult.latency}ms</span>
        )}
      </div>
    </div>
  )}

  {/* 5. Actions: 操作按钮 */}
  <div className="flex flex-wrap gap-2">
    <ActionButton variant="success" icon={<ZapIcon />} loading={testing}>
      Test
    </ActionButton>
    {!isDefault && isEnabled && (
      <ActionButton variant="primary">Set Default</ActionButton>
    )}
    <ActionButton variant="secondary" className="flex-1">
      Edit
    </ActionButton>
    <ActionButton variant="danger" icon={<TrashIcon />} disabled={isDefault} />
  </div>
</div>
```

## 子组件样式

### InfoRow (配置项行)

```tsx
// 普通文本
<div className="flex justify-between">
  <span className="text-gray-500">{label}:</span>
  <span className="text-gray-700">{value}</span>
</div>

// 等宽字体
<div className="flex justify-between">
  <span className="text-gray-500">{label}:</span>
  <span className="font-mono text-gray-700">{value}</span>
</div>

// Badge 标签
<div className="flex justify-between">
  <span className="text-gray-500">{label}:</span>
  <span className="rounded-full bg-{color}-100 px-2 py-0.5 text-xs font-medium text-{color}-700">
    {value}
  </span>
</div>

// 状态指示
<div className="flex justify-between">
  <span className="text-gray-500">{label}:</span>
  <span className={`font-mono ${success ? 'text-green-600' : 'text-red-500'}`}>
    {success ? '✓ Configured' : '✗ Not configured'}
  </span>
</div>
```

### CapabilityTag (能力标签)

```tsx
<span
  className="rounded bg-{color}-100 px-1.5 py-0.5 text-xs text-{color}-700"
  title={label}
>
  {code}
</span>
```

颜色映射：

- T (Temperature): green
- S (Streaming): blue
- F (Function Calling): purple
- V (Vision): pink

### ToggleSwitch (开关)

```tsx
<button
  onClick={onChange}
  className={`relative h-6 w-11 rounded-full transition-colors ${
    enabled ? "bg-green-500" : "bg-gray-300"
  }`}
>
  <div
    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
      enabled ? "left-[22px]" : "left-0.5"
    }`}
  />
</button>
```

### ActionButton (操作按钮)

```tsx
// Success (Test)
<button className="flex items-center gap-1 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 transition-colors hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50">
  {icon}
  {label}
</button>

// Primary (Set Default)
<button className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100">
  {label}
</button>

// Secondary (Edit)
<button className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100">
  {label}
</button>

// Danger (Delete)
<button className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50">
  {icon}
</button>
```

## Domain 颜色主题

| Domain  | 渐变                          | 用途                |
| ------- | ----------------------------- | ------------------- |
| ai      | from-violet-500 to-purple-600 | AI 模型、团队、技能 |
| system  | from-blue-500 to-cyan-600     | 系统设置、外部 API  |
| content | from-emerald-500 to-teal-600  | 内容管理            |
| users   | from-orange-500 to-amber-600  | 用户管理            |

## 模态框结构

### 编辑模态框

```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
  <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
    {/* Header */}
    <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <button className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
        <X className="h-6 w-6" />
      </button>
    </div>

    {/* Content - 可滚动 */}
    <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
      {/* 表单字段 */}
      <FormField label="名称" required>
        <input className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm" />
      </FormField>

      {/* 两列布局 */}
      <div className="grid grid-cols-2 gap-4">
        <FormField label="字段1">...</FormField>
        <FormField label="字段2">...</FormField>
      </div>

      {/* 折叠面板 */}
      <details className="rounded-lg border border-gray-200">
        <summary className="cursor-pointer px-4 py-3 font-medium text-gray-700">
          高级设置
        </summary>
        <div className="space-y-3 border-t border-gray-200 p-4">
          {/* 高级字段 */}
        </div>
      </details>
    </div>

    {/* Footer */}
    <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
      <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
        取消
      </button>
      <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        保存
      </button>
    </div>
  </div>
</div>
```

## 检查清单

- [ ] 使用 `AdminPageLayout` 组件包装
- [ ] 设置正确的 `domain` 颜色主题
- [ ] Header 包含返回按钮、图标、标题、操作按钮
- [ ] 卡片使用 3 列网格 `md:grid-cols-2 lg:grid-cols-3`
- [ ] 卡片有 Default 高亮边框
- [ ] 卡片有启用/禁用状态
- [ ] 配置项使用 Key-Value 行格式
- [ ] 能力标签使用单字母缩写
- [ ] 操作按钮区分 Test/SetDefault/Edit/Delete
- [ ] 模态框使用三段式结构

---

**最后更新**: 2026-01-18
**基于**: Admin AI Models 配置页面
**适用**: AI Models, AI Teams, AI Skills, External APIs 等配置页面
