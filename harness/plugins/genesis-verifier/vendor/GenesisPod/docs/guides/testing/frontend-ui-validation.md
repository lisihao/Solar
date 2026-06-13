# 前端 UI 一致性验证方案

> **基线日期**：2026-05-18
> **审计方法**：4 路 Explore subagent 并行深扫 + 主线综合
> **覆盖范围**：~100 个页面（user-facing），~200 个组件，frontend/{app,components,tailwind.config.ts,app/globals.css}
> **目标**：解决 UI 一致性 / 组件复用 / 跨页风格统一痛点（不是"能跑"）

---

## TL;DR

**核心反直觉发现**：组件库**已经很全**（AppShell / AssetCard / PageHeaderHero / MissionDialogShell / EmptyState / ErrorState / LoadingState / SideDrawer 都有），但**执行层严重破损**——这是治理问题，不是工具问题。任意值绕过 token、AssetCard 仅 4 处复用、5 套弹层并行、profile/page.tsx 单文件自写卡片 12+ 次。

**唯一正确动作**：先用 ESLint + AST 把"任意值 + 绕公共组件"在源头堵死，再做视觉回归 + LLM 评审。**不要先建新组件**——存量没用够，建了也没人用。

---

## 第一部分：现状审计

### 1.1 组件库完整度

公共组件清单（**实际已存在**）：

| 类别   | 组件               | 当前 import 次数 | 复用度   |
| ------ | ------------------ | ---------------- | -------- |
| Layout | AppShell           | 9+               | ⭐⭐⭐⭐ |
| Card   | **AssetCard**      | **4**            | ⭐⭐     |
| Card   | ResponsiveCard     | 少               | ⭐       |
| Header | **PageHeaderHero** | **4**            | ⭐⭐     |
| Dialog | MissionDialogShell | 2                | ⭐⭐     |
| State  | **EmptyState**     | **2**            | ⭐       |
| State  | ErrorState         | 少               | ⭐       |
| State  | LoadingState       | **2**            | ⭐       |
| Drawer | SideDrawer         | 少               | ⭐       |
| Drawer | AdminDrawer        | admin only       | ⭐⭐⭐   |

**症状**：核心组件设计精良但**普遍未被使用**。每页都在重复造轮子。

**缺失的中粒度组件**（业务高频但库内没有）：

- SettingsSectionCard / FormSection（Profile/Notifications/Settings 自写 20+ 处）
- StatRow / StatCard（独立的统计行组件，目前只内嵌在 AssetCard 里）
- ActionToolbar / ToolbarRow（Settings 高频）
- Alert / Banner（多页自写 `bg-red-50 border-red-200`）

### 1.2 主页结构一致性

| 维度         | 一致性 | 数据                                                          |
| ------------ | ------ | ------------------------------------------------------------- |
| Page Shell   | P0     | Research/Insights **不用 AppShell**，自写 sticky shell        |
| 页头组件     | P1     | 大多自写 icon + h1 + subtitle，仅 4 页用 `PageHeaderHero`     |
| 顶层 padding | P1     | `px-8 py-6` vs `px-6 py-8` vs `px-4 py-8`                     |
| 页头透明度   | P0     | `bg-white/80` vs `bg-white/50` 混用                           |
| Spinner 颜色 | P0     | Research=indigo、Teams=violet、Image=pink                     |
| 搜索框 focus | P0     | focus ring 跟每页主题色（indigo/violet/pink），非品牌 primary |
| Grid 响应式  | P1     | `sm:2 lg:3 xl:4` vs `sm:3 lg:4 xl:5` vs `sm:4`                |

### 1.3 设计 Token 纪律

**Token 真源**：

- 主源：`app/globals.css` 的 CSS 变量（shadcn HSL）
- 备源：`tailwind.config.ts` 的 `extend.colors`（hsl(var(--\*))）
- **冲突源**：`tailwind.config.ts` 同时定义 `primary: { 50-900: '#hex' }` 数字色板，但 **0 处引用**（死代码）
- **平行源**：`lib/playground-design/tokens.ts` + `components/ai-office/slides/slide-tokens.css` + `components/library/tokens.ts` = **4 套 token 系统并存**

**违规精确数（脚本实测，与审计预估高度吻合）**：

| 类型                    | 实测  | 严重度 |
| ----------------------- | ----- | ------ |
| 硬编码 `#hex`           | 0     | OK     |
| `text-[Npx]` 任意字号   | 770   | P0     |
| `w-[]/h-[]/max-[]` 静态 | 193   | P1     |
| 静态 `style={{}}`       | 59    | P1     |
| `rgba/rgb/hsl(` 硬编码  | 63    | P1     |
| 节奏外 .5 半步          | 3,005 | P0     |

### 1.4 交互态 & 响应式

**三态实现复用率**：

- Loading：自写 `animate-pulse` skeleton 6+ 处
- Empty：5+ 页面有 `list.length===0` 分支却无空态 UI
- Error：42 文件涉及，分散自写

**响应式断点**：`md:` 142 / `lg:` 126 / `xl:` 34 → md→lg 跳跃导致 768-1279px 平板塌陷

**弹层 5 套并行**：AdminDrawer / SideDrawer / MissionDialogShell / Modal / 50+ 业务自写

### 1.5 重灾区文件 TOP 5

1. `app/profile/page.tsx`（自写卡片 12+ 次）
2. `app/page.tsx`（首页自写多）
3. `app/settings/notifications/page.tsx`
4. `app/ai-research/page.tsx` + `app/ai-insights/topic-research/page.tsx`（不用 AppShell）
5. `components/playground-design/tokens.ts`（自成 token 系统）

---

## 第二部分：方案

### 2.1 五个验证维度

| #   | 维度       | 主要手段                       |
| --- | ---------- | ------------------------------ |
| D1  | 结构一致性 | AST 强制                       |
| D2  | Token 纪律 | ESLint + 物理收口              |
| D3  | 视觉一致性 | Storybook + Argos + LLM Vision |
| D4  | 交互态一致 | AST 强制 + Story 全状态        |
| D5  | 跨视口     | ESLint 自定义 + Argos 多视口   |

### 2.2 六层栈

```
L0  TypeScript strict + Next build           已有
L1  ESLint: 任意值 + 内联 style 严控          地基
L2  AST 扫描: 公共组件强制复用 + token 收口   地基 2 ★ 已落地
L3  Storybook: 公共组件 + 主页 gallery
L4  Argos 视觉回归（多视口）
L5  Claude Vision 跨页对位审查                兜底
L6  Sentry + RUM                              已有
```

### 2.3 落地路线图

#### Week 1 — 地基堵漏 ★ 已部分完成

**已完成（TOP 1）**：

- `scripts/utils/audit-ui-discipline.ts`（6 条 R 规则）
- `scripts/utils/audit-ui-tokens.ts`（5 类 T 规则）
- `package.json` 入口 `audit:ui` / `audit:ui-strict` / `audit:ui-baseline`
- `.husky/pre-push` [4/5] UI 一致性看护（warn-only）
- 首次基线冻结：discipline 562 + tokens 4,090
- 基线报告 `docs/_archive/ui-audit-baseline-2026-05-18.md`

**待办**：

- 删 `tailwind.config.ts` primary 数字色板（0 引用）
- 写 `docs/guides/testing/frontend-ui-tokens.md`（SSOT 文档）
- 自定义 ESLint `responsive-must-include-md`

#### Week 2 — 重灾区重构

1. `app/profile/page.tsx`：提取 `SettingsSectionCard`，替换 12+ 处
2. `app/page.tsx`：替换自写卡片为 AssetCard
3. `app/ai-research/page.tsx`：接入 `<AppShell>`、自写 hero → `<PageHeaderHero>`
4. 统一 Spinner 颜色到 `text-primary`
5. 统一 focus ring 到 `ring-primary/20`

#### Week 3 — Storybook + Argos

#### Week 4 — LLM Vision

### 2.4 集成与触发

| 时机                       | 触发            | 阻断?        |
| -------------------------- | --------------- | ------------ |
| `git commit` (lint-staged) | L0 + L1         | 是           |
| `git push` (husky)         | L0 + L1 + L2    | warn-only    |
| GitHub PR                  | + L4 Argos      | 必看         |
| 周日 02:00 cron            | L5 vision audit | 否，发 issue |
| Prod                       | L6 Sentry/RUM   | 否，告警     |

### 2.5 关键设计决策

**为什么先 L1 + L2**：1134 处任意值用一条规则止血、AST 强制让公共组件复用率从 4 处涨到 20+ 处，ROI 最高。

**为什么用 Argos 而不是 Chromatic**：开源可自托管、月度免费配额够单人项目几年用量。

**为什么 LLM Vision 是杀手锏**：你的痛点 80% 是"跨页主观一致性"（透明度 0.5 vs 0.8、spinner 颜色），**传统视觉回归只 diff 同页前后，不会发现跨页不一致**。

**为什么不先建新组件**：现有 8 个核心组件复用率 < 10%，建新组件治标不治本。

---

## 第三部分：用法手册

### 跑扫描

```bash
npm run audit:ui                # discipline + tokens
npm run audit:ui-discipline     # 仅结构
npm run audit:ui-tokens         # 仅 token
npm run audit:ui-strict         # 与基线对比，回归 exit 1
```

### 基线管理

```bash
npm run audit:ui-baseline       # 重写基线（重构后用）
```

### pre-push 集成

`.husky/pre-push` 的 `[4/5] UI 一致性看护` 默认 warn-only。

```bash
SKIP_UI_AUDIT=1 git push        # 临时跳过
```

切 strict 阻断：编辑 `.husky/pre-push`，把 `if npm run audit:ui-strict` 改为 `npm run audit:ui-strict || exit 1`。

### 排除范围

- `components/admin/`（独立设计系统）
- `components/ai-office/slides/`（独立 token 域）
- `components/playground-design/`（独立 token 系统）
- `components/ui/`（公共 UI primitives 自身实现）
- `components/common/`（公共组件自身实现）
- `__tests__` / `*.test.*` / `*.spec.*` / `*.stories.*`

新增排除：编辑脚本顶部 `EXCLUDE_PATTERNS`。

---

## 第四部分：评分卡

| 维度            | 当前   | Week 1 末 | Week 4 末 | 目标 |
| --------------- | ------ | --------- | --------- | ---- |
| Token 纪律      | 5/10   | 7/10      | 8.5/10    | 9/10 |
| 公共组件复用率  | <10%   | 基线冻结  | 35-40%    | 60%+ |
| Page Shell 一致 | 75%    | 75%       | 100%      | 100% |
| 三态组件复用    | 30%    | 基线冻结  | 70%       | 85%  |
| 响应式 md 覆盖  | 56%    | 70%       | 80%       | 85%  |
| 跨页视觉一致    | 未度量 | 未度量    | LLM 6/10  | 8/10 |

---

## 附录：审计原始数据要点

四路 Explore subagent 并行审计：

- **A 路（主页结构）**：12 页对比表 + 4 P0（AppShell / 透明度 / spinner / focus ring）+ 5 P1
- **B 路（组件库）**：8 核心组件清单 + 复用统计 + 7 缺口
- **C 路（token）**：5 类违规精确数 + 4 套 token 系统
- **D 路（交互态）**：三态统计 + 5 弹层并行 + 断点画像
