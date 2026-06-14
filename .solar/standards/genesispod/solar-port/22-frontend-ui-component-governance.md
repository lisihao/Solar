# 前端 UI 组件复用治理标准

**版本：** 1.0
**强制级别：** 🔴 MUST
**状态：** 已采纳
**日期：** 2026-05-20

> **核心原则**：**可标准化的 UI 一律复用公共组件；自写 bespoke 或新建公共组件，必须先经用户批准。**
> 本文是"用什么组件 / 各类 UI 的格式要求 / 例外如何审批"的唯一权威。
> 分析背书见 [docs/guides/testing/frontend-ui-validation.md](../../docs/guides/testing/frontend-ui-validation.md)；机器执行见 `scripts/utils/audit-ui-discipline.ts`（R1–R8：R7=Tabs、R8=表格）+ `audit-ui-tokens.ts`。

---

## 1. 治理原则（MUST）

1. **复用优先**：写任何卡片/弹层/空态/加载/错误/页头/Tab/表格前，**先查本文 §3 的 canonical 组件**，有就必须用。
2. **不重复造**：现有公共组件复用率 < 10% 是治理问题不是工具问题（[validation 文档 TL;DR](../../docs/guides/testing/frontend-ui-validation.md)）。**不允许**在 feature 代码里内联 `rounded-xl border bg-white` 卡片、`fixed inset-0 z-50` 弹层、`animate-spin` 自写 spinner、自写 tab 条。
3. **例外须审批**：canonical 组件确实不适配时——**停下来问用户**，不要静默自写。获批后，把该次例外**记进基线**（`npm run audit:ui-baseline`，同 PR 附理由注释）= 审批留痕。基线增长 = 一次被批准的例外；**未经批准不得让基线上涨**。
4. **缺口先补 canonical 再用**：若某 archetype 没有 canonical 组件（见 §4），**先建公共组件**（需用户批准建在 `components/ui` 还是 `common`），不得各 feature 各写一份。
5. **Token 纪律**：颜色/字号/间距走 `frontend/lib/design/tokens.ts` + globals.css 变量，禁任意值 `text-[Npx]` / 硬编码 `#hex` / 主题色散落（spinner/focus ring 必须 `primary`，不准每页一个色）。

---

## 2. 各类 UI 的格式要求（回答"格式是什么"）

### 2.1 菜单主页（home page）

```
<AppShell>                                  ← R1 强制
  <PageHeaderHero icon title subtitle       ← 渐变图标 + 标题 + 副标题 + 右侧操作 + 内联搜索
                  actions search />
  [可选 Tabs]                                ← 用 canonical Tabs（见 §4 缺口）
  <main 内容区>
    grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4   ← 统一响应式
    {loading}  → <LoadingState/>            ← R5
    {empty}    → <EmptyState/>              ← R3
    {error}    → <ErrorState/>             ← R4
    {data.map} → <AssetCard/>              ← R2（+ 末尾"新建"虚线卡）
  </main>
  新建动作：右上角按钮 + Modal（不另开整页）
</AppShell>
```

mission 类功能的主页/详情另见 [21-agent-teams-presentation.md](21-agent-teams-presentation.md)。

### 2.2 卡片（card）

> **单一归属（2026-05-21 收口）**：所有卡片 canonical **一律在 `components/ui/cards/`**，不得散落到
> `common/cards`、`common/asset-card` 等。由 audit **R15** 守护（卡片目录只能出现在 `ui/cards/`）。
> 历史曾分裂为 ui/cards（primitive）+ common（composite），因无守护而漂移——现统一收口。

| 用途            | canonical             | 路径                               |
| --------------- | --------------------- | ---------------------------------- |
| 内容/资产列表项 | `AssetCard`           | `components/ui/cards/asset-card/`  |
| 统计/指标 tile  | `StatCard`            | `components/ui/cards/`             |
| 区块/面板卡     | `SectionPanelCard`    | `components/ui/cards/`             |
| 对话消息卡外壳  | `MessageCardShell`    | `components/ui/cards/`             |
| 设置/区块卡     | `SettingsSectionCard` | `components/ui/cards/`             |
| 标准卡片网格    | `CardGrid`            | `components/ui/cards/`             |
| 横向信息流行卡  | `FeedCard`            | `components/ui/cards/`             |
| “+新建”占位卡   | `CreateCard`          | `components/ui/cards/`             |
| 通用容器卡      | `ResponsiveCard`      | `components/ui/ResponsiveCard.tsx` |

禁止：① feature 内联 `rounded-(xl\|lg\|2xl) + border + bg-white` 三件套（R2 拦截，≥3 处即违规）；
② 在 `components/ui/cards/` 以外新建卡片组件或 `cards`/`asset-card` 目录（R15 拦截）。
卡片网格统一用 `<CardGrid>`（1/2/3/4 列响应式 + 等高），不要各页硬编码 `grid-cols` 串。

### 2.3 Tab 页

✅ **canonical 已建**：`Tabs`（`@/components/ui/tabs`，支持 `iconNode`）。规则：

- **横向 Tab 一律用 `Tabs`**，禁止再自写 `activeTab` + `border-b-2` 按钮条。
- 历史欠账：仍有自写 tab bar 待迁（R7 已入基线，数见 `docs/_archive/ui-discipline-baseline.json`，逐步清零）。**新代码不得新增自写 tab**。

### 2.4 表格（table）

🔴 **实测现状（2026-05-20，纠正旧版"非 admin 表格极少"的错误）**：全仓 **65 个文件直接写原生 `<table>`**——admin 41（26 组件 + 15 页）、**非 admin 24（22 组件 + 2 页）**。另有 ~10 个各自造的表格组件（admin 8 个 + `common/tables/MultiKeyTable`）。表格是高频自写重灾区，**不是**少数例外。

**表格分两层治理（勿一刀切）**：把 markdown 渲染、对比幻灯片硬塞进重型 DataTable = 过度抽象（Karpathy 反模式）。展示表只需统一**样式**，数据网格才需统一**行为**。

| 层                          | 是什么                            | 例子                                                                                                   | canonical                                                            | 何时用                            |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | --------------------------------- |
| ① **DataTable**（数据网格） | 可排序/分页/选择/行操作的交互列表 | admin 8 表、ai-social `TasksTab`/`ContentsTab`、me `models`/`keys`、custom-agents `MyAgentsTab`        | `components/common/tables/DataTable`（admin 留薄壳主题）             | 列表型、需排序/分页/搜索          |
| ② **ui/table**（展示原语）  | 纯展示、不交互                    | markdown 表、slides `ComparisonSlide`、`FactTablePanel`、`ComputeUsage*`、`CredibilityPanel`、消息渲染 | `components/ui/table/`（`Table/THead/TBody/Tr/Th/Td` 带 token 样式） | 静态展示，套 DataTable 是过度抽象 |

**禁止**：feature 代码直接写 `<table>` / `<thead>` / `<tbody>`（R8 拦截）。交互表用 `DataTable`，展示表用 `ui/table` 原语。例外仅限两个 canonical 实现本身 + admin 薄壳。

### 2.5 各类组件（states / 弹层 / 控件）

| Archetype     | canonical                        | 路径                                         | audit |
| ------------- | -------------------------------- | -------------------------------------------- | ----- |
| 空态          | `EmptyState`                     | `components/ui/states/`                      | R3    |
| 错误态        | `ErrorState`                     | `components/ui/states/`                      | R4    |
| 加载/骨架     | `LoadingState`/`LoadingSkeleton` | `components/ui/states/`                      | R5    |
| 弹窗          | `Modal`/`ConfirmDialog`          | `components/ui/dialogs/`                     | R6    |
| 抽屉          | `SideDrawer`                     | `components/common/drawers/`                 | R6    |
| mission 弹层  | `MissionDialogShell`             | `components/common/dialogs/`                 | R6    |
| 按钮          | `Button`(variants)               | `components/ui/primitives/button.tsx`        | —     |
| 下拉/菜单     | `DropdownMenu`                   | `components/ui/primitives/dropdown-menu.tsx` | —     |
| 开关          | `Switch`                         | `components/ui/primitives/switch.tsx`        | —     |
| 提示          | `Tooltip` / `Toast`              | `components/ui/`                             | —     |
| 徽章          | `ModelBadge`/`TierBadge`         | `components/common/badges/`                  | —     |
| 提示条/banner | `Alert`(tone)                    | `components/ui/feedback/Alert.tsx`           | —     |
| 关键词标签    | `Tag`                            | `components/ui/tag/`                         | —     |
| 复制按钮      | `CopyButton`                     | `components/ui/primitives/CopyButton.tsx`    | —     |

---

## 2.6 模块识别色体系（SSOT，2026-05-22）

> **原则**：骨架统一（圆角 ≤ rounded-xl / 弹框外壳 / 间距 / 组件复用 全站一致），
> **识别色按模块区分**——每个菜单一个主色调。颜色唯一事实源是
> `frontend/lib/design/module-themes.ts`，**禁止**在 feature 里散落硬编码
> `bg-{hue}-50` / `from-x to-y` / 随机激活色。

**色系分配（13 菜单）**：ask=blue · explore=sky · library=teal · radar=cyan ·
insights=indigo · research=purple · discuss(ai-teams)=amber · planning=orange ·
decision(ai-simulation)=red · report(ai-office)=emerald · writing=fuchsia ·
social=rose · playground=violet。

**接入方式（已落地，新代码照此）**：

| 表面                | 怎么拿模块色                                                                         |
| ------------------- | ------------------------------------------------------------------------------------ |
| 侧边栏菜单激活态    | 读 `MODULE_THEMES[key].activeBg/text`（图标 `currentColor` 自动跟随）                |
| 主页 hero           | `PageHeaderHero` 按 `moduleFromPath(pathname)` 自动上色（零页改动）                  |
| 详情页头部          | `MissionDetailFrame` 同样按路由自动取 `gradient`                                     |
| 主按钮 / focus ring | `AppShell` 按路由覆盖 `--primary`/`--ring` CSS 变量 → 全页 `bg-primary` 自动变模块色 |

**MUST / MUST NOT**：

- 新增模块 → 在 `module-themes.ts` 补一整行（含 `gradient` + `primaryHsl`）+ 在 `ROUTE_MODULE` 注册路由；不要在组件里写色。
- 不得在 feature 内联模块识别色（`bg-rose-50`/`from-violet-500` 等）——一律走注册表。
- 骨架色（中性灰阶、边框、surface）与语义色（done/failed/danger）不属于模块识别色，照旧用 `tokens.ts`。

**看护机制（焊死，2026-05-22）**：

- `audit:ui-tokens` 的 **T6-module-gradient-hardcoded** 规则扫描 feature 代码硬编码的模块识别渐变
  （`from-/via-/to-{hue}-{400..700}`），排除 `components/ui/` canonical 层与 `module-themes` SSOT。
- **T6 为焊死规则**：超基线即 `exit 1`（不依赖 `--strict`），已接入 pre-push `[4/6]`，新违规拒推。
- 基线 = **800**（2026-05-22 存量，`docs/_archive/ui-tokens-baseline.json`）。这 800 处是「彻底整改」
  的 burn-down 目标，逐步迁到 `module-themes`；基线只减不增，新增即拦。

## 3. 例外审批流程（MUST）

```
需要一个 UI 块
   → §2 有 canonical？ ── 有 ──→ 必须用，结束
                        └─ 无/不适配 ──→ 停！向用户说明：缺口 / 为何不适配 / 建议方案
                                          ├─ 用户批准自写一次 → 写 + audit:ui-baseline 记录 + 注明理由
                                          └─ 用户批准建 canonical → 确认放 ui/ 还是 common/ → 建 + 加 audit 规则
```

**Agent 红线**：禁止在未问用户的情况下自写 canonical 已覆盖的 UI，或擅自新建公共组件。（同步见 CLAUDE.md 行为红线「前端 UI 组件复用优先」。）

---

## 4. 缺口与提升台账

### 4.1 已补的 canonical（迁移调用方进行中）

| Archetype                      | 状态                                       | 剩余行动                            |
| ------------------------------ | ------------------------------------------ | ----------------------------------- |
| Tabs / Tab 条                  | ✅ `ui/tabs/` + audit R7                   | 迁余自写 tab（R7 已抓全，数见基线） |
| 表单 Input/Textarea            | ✅ `ui/form/`（Checkbox 待补）             | 迁调用方 + 补 Checkbox              |
| Pagination                     | ✅ `ui/pagination/`                        | 迁调用方                            |
| **通用 DataTable**（数据网格） | ✅ `common/tables/DataTable`（admin 薄壳） | 迁 R8 名单交互表（admin 8 + 其余）  |
| **ui/table**（展示原语）       | ✅ `components/ui/table/` + audit R8       | 迁 R8 名单展示表                    |

### 4.2 待补 canonical（实测高频自写，按证据强度排；先补 Alert + Tag）

> **抽取原则（Karpathy 防过度抽象）**：先 scope 再抽。Tag/Avatar 数大但噪声大，必须先界定收哪类用途，别把状态点 / 图标圆圈 / 圆角按钮全塞进来。

| 优先    | Archetype             | 实证                                                                        | 去向                                                             |
| ------- | --------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| ✅ done | **Alert / Banner**    | 31 文件内联 `bg-{c}-50 + border` → 已建 canonical（2026-05-22）             | `components/ui/feedback/Alert.tsx`（toneToken 语义色）；存量待迁 |
| ✅ done | **Tag / Chip / Pill** | 204 文件 `rounded-full px-2/3` → 已建 canonical（仅收关键词标签）           | `components/ui/tag/Tag.tsx`（状态片仍归 StatusBadge）；存量待迁  |
| ✅ done | CopyButton            | 27 文件 `navigator.clipboard` → 已建 canonical（2026-05-22）                | `components/ui/primitives/CopyButton.tsx`；存量待迁              |
| 🟡 P1   | SearchBar             | `explore/SearchBar` 成品，admin 用裸 input                                  | 上提 `ui/SearchBar`                                              |
| 🟡 P1   | SectionHeader         | `library/_design/SectionTitle` + `agent-playground/ui/Section`              | `ui/SectionHeader`                                               |
| 🟡 P1   | Skeleton 原语         | `AdminLoadingSkeleton`/`RadarBriefingSkeleton`/`ai-social/skeletons/*` 各造 | 把 `LoadingSkeleton` 做成可组合原语                              |
| 🟡 P1   | FileUploader          | `ai-research/FileUploader` + import 弹窗各写                                | `common/FileUploader`                                            |
| 🟡 P2   | Avatar                | `rounded-full` 357（噪声大）                                                | `ui/Avatar`（**仅收真头像**，先 scope）                          |
| 🟡 P2   | ExpandableText        | `agent-playground/ui/ExpandableText`                                        | `ui/ExpandableText`                                              |

### 4.3 三套迷你设计系统抽取映射（agent-playground/ui · admin/shared · library/\_design）

| 来源                       | → 应提取为                                  |
| -------------------------- | ------------------------------------------- |
| `RoleChip` `ToolBadge`     | `ui/Tag`                                    |
| `MetricStat`               | `ui/cards/StatCard`（register 已挂未建）    |
| `StatusPill` · `StatusDot` | `ui/badges/StatusBadge`（已建，迁过去）     |
| `Section` · `SectionTitle` | `ui/SectionHeader`                          |
| `ToneCard`                 | `ui/Alert`（语气色卡 = Alert 变体）         |
| `SourceLink`               | `common/citations`（并入 CitationListItem） |
| `ExpandableText`           | `ui/ExpandableText`                         |

> 与 register 早前未完成项（StatCard / action-bar / detail-header / CitationListItem / spinner）合并统筹，合计约 9 个待抽。

---

## 5. 执行与现状

- **机器执行**：`npm run audit:ui`（discipline R1–R8 + tokens）；`audit:ui-strict` 回归即 exit 1；`audit:ui-baseline` 更新基线（= 例外审批留痕）。
- **pre-push**：`.husky/pre-push` `[4/6]` 当前 **warn-only**。
- **现状（2026-05-20）**：discipline TOTAL ≈ 242（R3 空态 108、R6 弹层 75 为大头；R7 Tabs 21、R8 表格 0）。R8 表格已全迁 ui/table/DataTable 清零；R7 检测器修宽（旧版只认 `border-b-2` 单行 button 造成假绿 0，现按 `setActiveTab`/`activeTab` 状态信号抓全 21 处自写 tab，入基线待迁）。
- 🔴 **建议（待批准执行）**：① pre-push `[4/6]` 由 warn-only 切 **strict**（新例外即阻断，逼出 §3 审批）；② 完成表格两层迁移后把 R8 基线压到 admin 薄壳 + 两个 canonical 实现本身。

---

**维护者**: Claude Code · 关联：[21-agent-teams-presentation.md](21-agent-teams-presentation.md) · [02-directory-structure.md](02-directory-structure.md) · [validation 分析](../../docs/guides/testing/frontend-ui-validation.md)
