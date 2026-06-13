# Admin UI 设计规范

> GenesisPod 后台管理界面（`/admin/*`）的视觉一致性规范，基线参考 `/admin/data-management`。任何新增或重构的 admin 页面必须遵循本规范，否则视为视觉债务。

**版本**: 1.1
**最后更新**: 2026-05-11
**适用范围**: `frontend/app/admin/**`、`frontend/components/admin/**`、`frontend/components/admin/shared/**`

## v1.1 变更（2026-05-11）

- L1 Infrastructure 从 4 group × 12 卡 演进为 **4 实体大卡**（用户 / 密钥 / 数据 / 系统）。架构图配置：`frontend/lib/admin/architecture.ts:429-`。
- `AdminDomain` 重定义：新增 `user`（blue）/ `secret`（amber）/ `data`（emerald）/ `system`（slate）4 域。原 `access` 标记 `@deprecated`，将在所有 access 子页迁移完成后移除。配置：`frontend/lib/admin/styles.ts`。
- 新增 8 个共享组件（在 `frontend/components/admin/shared/`）：
  - `AdminStatsCards`（≤4 卡，封装段 1 网格）
  - `AdminToolbar`（搜索+filter+actions 一条线）
  - `AdminTabs`（segmented control，支持 `?tab=` URL 同步）
  - `AdminModal`（强制 `rounded-xl`，禁止 `rounded-2xl`）
  - `AdminDrawer`（右侧滑出，用于行内编辑/详情）
  - `AdminEmptyState`（独立空态，table 外使用）
  - `AdminLoadingSkeleton`（table / cards / list 三个 variant）
  - `AdminStatusBadge`（强制 `getStatusBadgeClasses`，禁止 inline 拼 className）
- 新增 1 个工具：`bodyScrollLock`（module-level 计数器，解决嵌套 dialog scroll lock 错乱）
- Sidebar 4 组对齐 L1：`user / secret / data / system`，旧 `access` / 旧 `system` 平铺组已删除。
- Release 横幅 `<VersionUpdateBanner />` 已删除；版本更新走后端 `NotificationPresetsService.notifyVersionUpdate` 推送到通知中心。
- 已废弃文档：`.claude/skills/frontend/admin-config-layout.skill.md` 顶部加 DEPRECATED 注释，新页面请只参照本文。
- UsersSettings 行内 5 图标按钮 → **4 命名按钮 + Delete 兜底** 模式（`[资料][权限][积分][计费] + ⌫`），对应行内 Drawer 操作。各页面行级操作应遵循此模式。

## v1.1 4 路评审 + UI 专家深度审视已知债（2026-05-11）

以下为 5 路评审共识、按严重度排：

### P0 已修

- 架构测试 `__tests__/architecture.test.ts` 已对齐新 4 卡结构
- `AdminPageLayout.tsx:68` icon container 改 `rounded-xl`
- backend `notifyKeyRequestSubmitted` actionUrl 改 `/admin/access/secrets?tab=requests`
- `data/page.tsx` Tab labels 走 i18n `admin.data.groups.*`

### P1 已修

- UsersSettings: 行内 5 图标 → 4 命名按钮；violet → blue；UserStatsCards 迁 AdminStatsCards
- AdminModal/AdminDrawer 嵌套 scroll lock 用 module-level 计数器修正

### P1 留单（独立 follow-up）

- AdminModal/AdminDrawer **focus trap**（Tab 键循环、open 时焦点转移、close 时恢复焦点）
- AdminDrawer **入场动画**（300ms transform ease-out，iOS Safari 体验）
- 旧 URL `redirect()` 静默无提示，应 `?from=permissions` 触发一次性 toast
- `/admin/*` 前端路由守卫（`app/admin/layout.tsx` + Next middleware）
- `/me` 卡跳目标页未做"我的视角"裁剪（`/library` 是全资源库不是"我的"）

### P2 已知违规（清扫单）

- `dark:` 变体残留 **166 处 / 8 文件**（重灾区：`secrets/ExpectedSecretsPanel.tsx`、`ai-config/AIModelSettings.tsx`）
- `rounded-2xl` 残留 **13 处 / 9 文件**（重灾区：`ai-config/AIModelSettings.tsx` 3 个 Modal、`workspace/page.tsx` 6 处）
- inline `fixed inset-0 z-50 bg-black/50` Modal **17 处**（应迁 AdminModal/AdminDrawer，重灾区：`secrets/SecretForm.tsx` 等 4 文件）
- emoji **2 处**（`AIModelSettings.tsx:1151 🤖` / `:2704 🚀`）
- 自实现 toast **2 处**（`feedback/page.tsx`、`system/notifications/page.tsx`），应换 `toast` from '@/stores'
- UsersSettings 表格本身未迁 `AdminDataTable`；Search 框 `rounded-xl py-3` 违规（应 `rounded-lg py-2`）
- 旧 `data-management/StorageStatsCards.tsx` / `TableStatsCards.tsx` 在共享组件之前已存在，未走 `AdminStatsCards`

### P3 可演进性洞察（UI 专家）

- `AdminStatsCards.length > 4` 半强制 slice 是反模式 → 改 tuple 类型或 throw（避免静默丢数据）
- L1 `lg:grid-cols-4` 硬编码 → 应支持 4-6 卡退化（企业增长必新增横切关注点）
- `ROUTE_REDIRECTS` 应有退役机制（约定 N 个月后删）
- `AdminStatusBadge`/`AdminEmptyState`/`AdminLoadingSkeleton` 三个纯展示组件可去掉 `'use client'`（让 RSC 复用，bundle 减小）
- `/admin/data/page.tsx`、`/admin/access/secrets/page.tsx` 当前整页 `'use client'` + Suspense 包装，**丢失了 SSR 红利**。应改 server shell + client island

### 跨页一致性约定

- 各页面行级操作统一遵循 UsersSettings 的"4 命名按钮 + Delete"模式
- 各页面 stats 必须走 `AdminStatsCards`，禁止自建 4 卡 grid
- 各页面 Modal/Drawer 必须走 `AdminModal`/`AdminDrawer`（含 scroll lock 计数器）
- 各页面 Status badge 必须走 `AdminStatusBadge` / `getStatusBadgeClasses`

---

## 设计原则

1. **数据密度优先**：admin 页面服务运维 / 排错，不是营销。每屏可见信息密度高于美感装饰
2. **视觉一致 > 视觉创新**：所有 admin 页面共用同一套色板、卡片、表格、工具栏样式，不允许"这个页面我自己重新设计一下"
3. **Light-only**：项目锁定 light mode，**禁止 `dark:` 变体**（详见 `feedback_light_only_no_dark_mode`）
4. **不要 emoji**：用 Lucide React 图标（详见 CLAUDE.md 行为红线）
5. **YAGNI**：能用 4 张 stat 卡 + 1 张表格说清的事，不要拆 5 个 tab + 6 个 panel 套娃

---

## 页面骨架（标准三段式）

所有 admin 页面**必须**遵循这个结构：

```tsx
<AdminPageLayout
  title={t('admin.xxx.title')}
  description={t('admin.xxx.description')}
  icon={SomeIcon}
  domain="data" // 'data' | 'ai' | 'system' | 'user' 等
  maxWidth="7xl"
>
  <div className="space-y-6">
    <XxxStatsCards ... />     {/* 段 1：4 张 stat 卡（必须）*/}
    <XxxToolbar ... />         {/* 段 2：搜索 / filter / 操作按钮 */}
    {error && <ErrorBanner />} {/* 段 2.5：error banner（可选）*/}
    <XxxDataGrid ... />        {/* 段 3：主体表格 / 内容卡 */}
    <XxxModal ... />           {/* 段 4：可选弹窗 */}
  </div>
</AdminPageLayout>
```

**禁止反模式**：

- ❌ 在 `AdminPageLayout` 之外自己堆 hero 横幅 / "Storage Governance" 风的大标题
- ❌ 把 `text-3xl font-semibold tracking-tight` 大标题塞进 panel header（`AdminPageLayout` 已经有 sticky 标题了）
- ❌ 在 `<ResponsiveCard>` 里再嵌一层 `<ResponsiveCardHeader>` 营销风外观

---

## 段 1：StatsCards 规范

**功能**：在页面顶部用 4 张卡展示核心数字（"我现在到底是什么状态"）。

**必备结构**：

```tsx
<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
  {cards.map((card) => (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-2xl font-bold {colorText}">{value}</p>
          <p className="mt-1 truncate text-xs text-gray-400">{hint}</p>
        </div>
        <div className="rounded-lg p-2.5 {iconBg}">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  ))}
</div>
```

**色板**（卡片右上角图标背景 + 数字主色）：

| 语义      | 用途             | iconBg                            | text               |
| --------- | ---------------- | --------------------------------- | ------------------ |
| `emerald` | 主指标 / 健康    | `bg-emerald-100 text-emerald-600` | `text-emerald-700` |
| `blue`    | 第二指标 / 信息  | `bg-blue-100 text-blue-600`       | `text-blue-700`    |
| `violet`  | 受管 / 配额      | `bg-violet-100 text-violet-600`   | `text-violet-700`  |
| `amber`   | 待处理 / 警告    | `bg-amber-100 text-amber-600`     | `text-amber-700`   |
| `slate`   | 中性 / 时间      | `bg-slate-100 text-slate-600`     | `text-slate-700`   |
| `red`     | 严重错误（罕用） | `bg-red-100 text-red-600`         | `text-red-700`     |

**禁止**：

- ❌ 卡片用 `rounded-3xl` / `rounded-2xl`（太胖，浪费像素）
- ❌ 卡片用 gradient 背景或 colorbg（太花，admin 不是营销页）
- ❌ stat 卡数量 > 4（核心数字不超过 4 个；多了说明你在凑）

---

## 段 2：Toolbar 规范

**功能**：search / filter / 主操作按钮在一条横向工具栏。

**布局规则**：

```
[search] [filter1] [filter2] ...    [actionA] [actionB] [primary]
                                  ↑ flex-1 撑开
```

**实现**：

```tsx
<div className="flex flex-wrap items-center gap-3">
  {/* Search */}
  <div className="relative min-w-[200px] max-w-md flex-1">
    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
    <input className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
  </div>

  {/* Filter dropdown 或 Tab segmented control */}
  <FilterDropdown ... />

  <div className="flex-1" />

  {/* Secondary action */}
  <button className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
    <Icon className="h-4 w-4" />
    操作名
  </button>

  {/* Primary action */}
  <button className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100">
    <Icon className="h-4 w-4" />
    主操作
  </button>
</div>
```

**Tab 段控制**（替代多 tab 大卡片）：

```tsx
<div className="inline-flex items-center rounded-lg border border-gray-300 bg-white p-1 shadow-sm">
  {tabs.map((t) => (
    <button
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-emerald-50 text-emerald-700"
          : "text-gray-600 hover:bg-gray-50"
      }`}
    >
      {t.label}
    </button>
  ))}
</div>
```

**禁止**：

- ❌ Tab 用 `rounded-2xl border px-4 py-3` 大卡片（吃掉视口高度，对运维无价值）
- ❌ Tab 内放 `text-xs uppercase tracking-[0.16em]` 副标题（admin 不是品牌网站）
- ❌ Toolbar 高度 > 56px（搜索框 + 按钮的高度上限）

---

## 段 3：DataGrid 规范

**功能**：主体表格，承载 80% 的数据展示。

**容器**：

```tsx
<div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
  <div className="overflow-x-auto">
    <table className="min-w-full divide-y divide-gray-200">...</table>
  </div>
  {/* Optional pagination at bottom */}
</div>
```

**表头**：

```tsx
<thead className="bg-gray-50">
  <tr>
    <th className="w-[180px] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 cursor-pointer hover:bg-gray-100">
      <div className="flex items-center gap-1">
        Column Name
        <SortIcon />
      </div>
    </th>
  </tr>
</thead>
```

**表体**：

```tsx
<tbody className="divide-y divide-gray-100 bg-white">
  <tr className="transition-colors hover:bg-gray-50">
    <td className="px-4 py-3 text-sm text-gray-600">{value}</td>
    <td className="px-4 py-3">
      {/* Status badge */}
      <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700">
        Healthy
      </span>
    </td>
    <td className="px-4 py-3">
      {/* Action icons */}
      <div className="flex items-center gap-1">
        <button
          className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title="查看"
        >
          <Eye className="h-4 w-4" />
        </button>
      </div>
    </td>
  </tr>
</tbody>
```

**字体规则**：

| 元素             | 字号      | 字色            | 字重                                     |
| ---------------- | --------- | --------------- | ---------------------------------------- |
| 表头             | `text-xs` | `text-gray-600` | `font-semibold uppercase tracking-wider` |
| 主单元格（重要） | `text-sm` | `text-gray-900` | `font-medium`                            |
| 次单元格         | `text-sm` | `text-gray-600` | 默认                                     |
| 无值占位         | `text-sm` | `text-gray-400` | 默认（用 `-`）                           |
| 表名 / ID        | `text-sm` | `text-gray-900` | `font-mono font-medium`                  |
| 副标识           | `text-xs` | `text-gray-400` | `font-mono`                              |

**进度条**：

```tsx
<div className="flex items-center gap-2">
  <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
    <div
      className={`h-full rounded-full ${
        progress >= 95
          ? "bg-emerald-500"
          : progress >= 50
            ? "bg-blue-500"
            : "bg-amber-500"
      }`}
      style={{ width: `${progress}%` }}
    />
  </div>
  <span className="w-10 text-right text-xs font-medium text-gray-600">
    {progress.toFixed(0)}%
  </span>
</div>
```

**Status badge 色板**：

| 语义                      | 类名                              |
| ------------------------- | --------------------------------- |
| Healthy / Done / Complete | `bg-emerald-100 text-emerald-700` |
| Active / Running          | `bg-blue-100 text-blue-700`       |
| Warning / Pending         | `bg-amber-100 text-amber-700`     |
| Critical / Failed         | `bg-red-100 text-red-700`         |
| Managed / Owned           | `bg-emerald-100 text-emerald-700` |
| Observed / Neutral        | `bg-gray-100 text-gray-600`       |

**Loading skeleton**：

```tsx
{
  loading
    ? Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="animate-pulse">
          {columns.map((col) => (
            <td key={col.key} className="px-4 py-3">
              <div className="h-5 rounded bg-gray-200" />
            </td>
          ))}
        </tr>
      ))
    : null;
}
```

**Empty state**：

```tsx
<tr>
  <td colSpan={columns.length} className="px-4 py-12 text-center">
    <Icon className="mx-auto h-12 w-12 text-gray-300" />
    <p className="mt-2 text-sm text-gray-500">{t("admin.xxx.empty")}</p>
  </td>
</tr>
```

**Pagination**：

```tsx
<div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-3">
  <div className="text-sm text-gray-500">显示 1-20，共 100 条</div>
  <div className="flex items-center gap-2">
    <button className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
      上一页
    </button>
    <span className="text-sm text-gray-600">1 / 5</span>
    <button className="...">下一页</button>
  </div>
</div>
```

**禁止**：

- ❌ 表格容器 `rounded-3xl` / `rounded-[28px]`（视觉太重）
- ❌ 表头用 `text-slate-500 uppercase tracking-[0.16em]`（letter-spacing 太散）
- ❌ 单元格 padding > `px-5 py-4`（密度差）
- ❌ 行 hover 没有 `transition-colors`（生硬）

---

## 颜色系统

**主色**（admin 通用）：

- 主操作 / 主指标：`emerald-600` / `emerald-700`（绿色，与 light mode brand 一致）
- 次操作 / 信息：`blue-600` / `blue-700`
- 警告：`amber-600` / `amber-700`
- 错误：`red-600` / `red-700`
- 装饰 / 受管：`violet-600` / `violet-700`

**中性灰阶**（统一用 `gray-*` 不用 `slate-*`，避免两套灰色）：

| 用途              | 类名              |
| ----------------- | ----------------- |
| 主背景            | `bg-white`        |
| 页面背景          | `bg-gray-50/50`   |
| 表头背景 / 弱区块 | `bg-gray-50`      |
| 边框              | `border-gray-200` |
| 行分隔线          | `divide-gray-100` |
| 主文字            | `text-gray-900`   |
| 次文字            | `text-gray-600`   |
| 弱标签            | `text-gray-500`   |
| 占位              | `text-gray-400`   |
| 描边图标          | `text-gray-300`   |

> **历史例外**：`StorageStatsCards` 中 `slate` 仍作为色板备选名（语义上"无主色"）。新代码优先用 `gray`。

---

## 圆角与间距

| 元素         | 圆角           | 备注 |
| ------------ | -------------- | ---- |
| Stat 卡      | `rounded-xl`   | 12px |
| 表格容器     | `rounded-xl`   | 12px |
| 按钮         | `rounded-lg`   | 8px  |
| Badge / Pill | `rounded-full` | 全圆 |
| Input        | `rounded-lg`   | 8px  |
| Modal        | `rounded-xl`   | 12px |

**禁止**：`rounded-2xl` / `rounded-3xl` / `rounded-[28px]`（admin 不需要这种装饰）

**间距**：

- 段间：`space-y-6`（24px）
- Stat 卡间：`gap-4`（16px）
- Toolbar 元素间：`gap-3`（12px）
- 单元格内：`px-4 py-3`（16/12）

---

## 图标

**库**：`lucide-react`（项目唯一 icon 源）

**尺寸**：

| 场景           | 类名                               |
| -------------- | ---------------------------------- |
| Stat 卡右上    | `h-5 w-5`                          |
| Toolbar / 按钮 | `h-4 w-4`                          |
| 表格 action    | `h-4 w-4`                          |
| Empty state    | `h-12 w-12`                        |
| 主 page icon   | `h-5 w-5`（在 AdminPageLayout 内） |

**禁止**：

- ❌ 用 emoji 代替图标
- ❌ 用 SVG inline 写自定义图标（除非 lucide 没有 + 必要）
- ❌ 图标和文字用不同色（图标默认跟文字色 `currentColor`）

---

## 字体

- **正文**：默认 sans-serif（Tailwind base）
- **代码 / 表名 / ID**：`font-mono`（必须）
- **数字**（stat 卡 value）：`font-bold`（数字才 bold；标题 / label 用 `font-semibold`）
- **禁止 `tracking-[0.16em]` / `tracking-[0.22em]`**：字距 > `tracking-wider`（0.05em）属于品牌装饰，不适合 admin

---

## 可访问性

1. 所有可点击 icon 按钮必须有 `title` 或 `aria-label`
2. 表头 sort 必须键盘可操作（默认 button 即可）
3. Empty state / loading 必须有文字提示，不能只有动画
4. Toast 必须用项目 `toast` store（`from '@/stores'`），不允许自定义 toast 实现

---

## 重构 checklist（旧 admin 页面迁移到本规范）

- [ ] 删除自建 hero / "Governance" 横幅，仅保留 `AdminPageLayout`
- [ ] Stat 卡数量 ≤ 4，圆角 `rounded-xl`，色板从 6 色板挑
- [ ] Toolbar 单行 flex，actions 右对齐，flex-1 撑开
- [ ] Tab 用 segmented control（不要大卡片 tab）
- [ ] 表格容器 `rounded-xl border border-gray-200 bg-white shadow-sm`
- [ ] 表头 `bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-600`
- [ ] 灰阶用 `gray-*` 不用 `slate-*`
- [ ] 圆角 ≤ `rounded-xl`，没有 `rounded-3xl`/`rounded-[28px]`
- [ ] 字距没有 `tracking-[0.1em]+`
- [ ] 图标全 `lucide-react`，没有 emoji
- [ ] Loading / empty / error 三态全覆盖

---

## 参考实现（基线）

**视觉基线**：`frontend/components/admin/data-management/TableManagementPage.tsx` + 同目录的 `TableStatsCards.tsx` / `TableToolbar.tsx` / `TableDataGrid.tsx`

**应用本规范完成的重构**：`frontend/components/admin/data-management/StorageInventoryPanel.tsx`（2026-05-10 重构后）+ 拆分出的 `Storage*Cards/Toolbar/PipelineGrid/CatalogGrid/DatabaseGrid/TrendPanel.tsx`

**反例（请勿复制）**：原 `StorageInventoryPanel.tsx`（2026-05-10 之前）—— `text-3xl font-semibold tracking-tight`+ `rounded-[28px]` + `tracking-[0.22em]` + 5 个大卡片 tab，已在 commit 中重构。

---

## 演进策略

- 新增 admin 页面：直接复用 `AdminPageLayout` + 本规范的 6 段，**不允许**重新设计
- 现有页面发现违规：开 issue / 顺便修；不要"为重构而重构"，按 P0/P1 排期
- 本规范变更：必须 4 路集体评审（设计 / 一致性 / 易用 / 兼容），通过后改本文 + bump 版本号

---

**最后更新**: 2026-05-11
**维护者**: Claude Code
**版本**: 1.1
