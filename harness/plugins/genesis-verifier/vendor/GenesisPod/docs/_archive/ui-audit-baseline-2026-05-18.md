# GenesisPod 前端 UI 审计基线（2026-05-18）

> **基线日期**：2026-05-18
> **审计工具**：`scripts/utils/audit-ui-discipline.ts` + `scripts/utils/audit-ui-tokens.ts`
> **配套方案**：[`docs/guides/testing/frontend-ui-validation.md`](../guides/testing/frontend-ui-validation.md)
> **目的**：冻结当前违规数为基线；新代码不许增长；存量按重灾区分批改

---

## Discipline 扫描（562 处）

公共组件强制复用——AI app 主页绕过 AppShell、列表自写卡片、缺空态/错态/加载态、自写弹层。

| 规则 | 数量 | 含义 |
|------|------|------|
| R1-AppShell-Required | 8 | AI app 主页未用 `<AppShell>` |
| R2-AssetCard-Required | **261** | 列表/卡片自写 `rounded-(xl/lg/2xl) + border + bg-white` 三件套，未用 `<AssetCard>` |
| R3-EmptyState-Required | **203** | 含 `length === 0` 分支但未用 `<EmptyState>` |
| R4-ErrorState-Required | 6 | 含 error 渲染但未用 `<ErrorState>` |
| R5-LoadingState-Required | 8 | 自写 `animate-pulse + bg-gray-*` skeleton，未用 `<LoadingState>` / `<LoadingSkeleton>` |
| R6-Dialog-Component-Required | **76** | 自写 `fixed inset-0` 弹层，未用 `<MissionDialogShell>`/`<SideDrawer>`/`<Modal>` |
| **TOTAL** | **562** | |

### 重灾区文件（discipline）

- `frontend/app/page.tsx`（首页，自写卡片 + skeleton 多次）
- `frontend/app/profile/page.tsx`（自写 settings 卡片 12+ 次）
- `frontend/components/profile/UserApiKeyDrawer.tsx`（老式自写 Drawer，已记入重构）
- `frontend/components/library/AIOrganizePanel.tsx`（自写 dialog）

### 误报排除（已加 EXCLUDE）

- `components/admin/**`（admin 自成设计系统）
- `components/ai-office/slides/**`（slides 独立域）
- `components/playground-design/**`（playground 独立 token）
- `components/ui/**`（公共 UI primitives 自身实现）
- `components/common/**`（公共组件自身实现）

---

## Tokens 扫描（4,090 处）

Tailwind 任意值、内联 style、硬编码颜色、节奏外间距。

| 规则 | 数量 | 含义 |
|------|------|------|
| T1-text-arbitrary | **770** | `text-[Npx]` 任意字号（应用 text-xs/sm/base/lg） |
| T2-size-arbitrary | 193 | `w-[*] / h-[*] / max-w-[*]` 静态任意值（已过滤 % / vh / vw / calc / var 等动态值） |
| T3-inline-style-static | 59 | 静态 `style={{...}}` 字面量（已过滤模板字符串 / 三元 / 变量引用等动态值） |
| T4-color-hardcoded | 63 | `rgb()/rgba()/hsl()` 硬编码颜色 |
| T5-spacing-off-rhythm | **3,005** | `p/m/gap-(0.5/1.5/2.5/3.5)` 节奏外半步刻度 |
| **TOTAL** | **4,090** | |

### 重灾区 TOP 8（token 违规密度）

| Rank | 文件 | 违规数 |
|------|------|--------|
| 1 | `frontend/components/agent-playground/TodoDetailDrawer.tsx` | 90 |
| 2 | `frontend/components/ai-insights/topics/TopicContentPanel.tsx` | 83 |
| 3 | `frontend/app/ai-simulation/components/EditorModal.tsx` | 76 |
| 4 | `frontend/components/ai-simulation/SandboxView.tsx` | 74 |
| 5 | `frontend/app/ai-simulation/run/[id]/page.tsx` | 64 |
| 6 | `frontend/components/ai-image/ImageGenerator.tsx` | 62 |
| 7 | `frontend/app/ai-writing/[id]/page.tsx` | 51 |
| 8 | `frontend/app/agent-playground/team/[missionId]/page.tsx` | 51 |

### Token 真源（保持单源）

- **主源**：`frontend/app/globals.css` shadcn HSL CSS vars
- **备源**：`frontend/tailwind.config.ts` 的 `extend.colors` 走 `hsl(var(--*))`
- **死代码（Week 1 Day 3 待删）**：`tailwind.config.ts` 的 `primary: { 50-900: '#hex' }` 数字色板，**0 处引用**

### 平行 token 系统（已记录、新代码禁 import）

- `frontend/lib/playground-design/tokens.ts`（playground 独立 token，Top 1 重灾区里 `xs: 'p-1.5'` 等违规来源）
- `frontend/components/ai-office/slides/slide-tokens.css`（slides 独立深色主题 token）
- `frontend/components/library/tokens.ts`（library KB 渐变 token）

---

## 与 2026-05-18 四路审计的数据对照

| 维度 | 审计预估 | 脚本实测 | 差异原因 |
|------|----------|----------|----------|
| text-[Npx] | 815 | **770** | 接近，排除 admin 等域后更精确 |
| w-[*]/h-[*] | 319 | 193 | 脚本过滤了 %/vh/calc/var 动态值 |
| 内联 style | 696 | 59 | 脚本过滤了模板字符串/三元等动态值 |
| rgb/rgba/hsl | 106 | 63 | 排除了 admin / globals.css / config |
| AssetCard 复用率 | 4 处 | 261 处自写违规 | 自写远多于复用证据明确 |
| EmptyState 复用率 | 2 处 | 203 处缺空态 | 同上 |

---

## 用法

```bash
# 跑扫描看现状（warn-only）
npm run audit:ui                # discipline + tokens
npm run audit:ui-discipline     # 仅结构
npm run audit:ui-tokens          # 仅 token

# 与基线对比（违规增长 exit 1）
npm run audit:ui-strict

# 重写基线（重构后或新增公共组件后用）
npm run audit:ui-baseline

# 跳过 pre-push 看护（临时）
SKIP_UI_AUDIT=1 git push
```

## pre-push 集成

`.husky/pre-push` 的 `[4/5] UI 一致性看护` 步骤跑 `audit:ui-strict`，**warn-only** 模式：
- 无回归 → 打印每规则计数 + "无回归"
- 有回归 → 打印违规清单 + 链接到本文档，**不阻断 push**

切 strict 阻断模式：编辑 `.husky/pre-push`，把 `if npm run audit:ui-strict` 改为 `npm run audit:ui-strict || exit 1`。

---

## 后续路线（4 周）

详见 [`docs/guides/testing/frontend-ui-validation.md`](../guides/testing/frontend-ui-validation.md)。

**Week 1 已完成**：
- [x] `scripts/utils/audit-ui-discipline.ts`
- [x] `scripts/utils/audit-ui-tokens.ts`
- [x] `package.json` 入口（`audit:ui` / `audit:ui-strict` / `audit:ui-baseline`）
- [x] `.husky/pre-push` [4/5] 步骤（warn-only）
- [x] 首次基线冻结（562 + 4,090 = 4,652 处）

**Week 1 待办**：
- [ ] Day 3: 删 `tailwind.config.ts` primary 数字色板（0 引用死代码）
- [ ] Day 3: 写 `docs/guides/testing/frontend-ui-tokens.md`（SSOT 文档）
- [ ] Day 6-7: 响应式断点 lint（`responsive-must-include-md`）

**Week 2**：profile/page.tsx + 首页 + ai-research 三大重灾区重构。
