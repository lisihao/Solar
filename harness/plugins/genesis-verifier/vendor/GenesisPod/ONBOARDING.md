# GenesisPod — 团队上手 & 工程边界

> 给新同事 / 新 agent 的「先读这一篇」。目标：5 分钟知道项目是什么、代码放哪、**哪些边界有机器闸门守着（别去撞）**。
> 深规范在 `.claude/standards/`，行为红线在 `.claude/CLAUDE.md`，前端组件索引在 `frontend/components/COMPONENTS.md`。

---

## 1. 这是什么

企业级 AI 深度研究 + 内容管理平台。核心模块：AI Research / Agent Playground（多 Agent mission 编排）/ Insight（话题洞察）/ AI Teams / AI Office / Writing / Ask / Image / Social / Radar / Simulation / Planning / Library / Explore / Custom Agents。

```
Frontend: Next.js 14 + TypeScript + Zustand + TailwindCSS
Backend:  NestJS 10 + Prisma + PostgreSQL 16 + Redis 7
AI:       LiteLLM + OpenAI/Claude/Grok
```

## 2. 代码放哪

**Backend** 顶层即 5 个分层模块：`backend/src/modules/{open-api,ai-app,ai-harness,ai-engine,platform}/`，跨层共享工具在 `common/`，插件系统在 `src/plugins/`（core + observability/security/storage 实现域）。
AI 分层（严格单向 L4→L3→L2.5→L2→L1）：`open-api/` → `ai-app/`（应用）→ `ai-harness/`（Agent 运行时）→ `ai-engine/`（LLM/tools/rag 基元）→ `platform/`（L1 基础设施，旧称 ai-infra）。App 只经各层 facade（`AIEngineFacade` 等）+ Registry 访问下层，**禁穿透内部路径**（ESLint + 架构 spec 测试 + pre-push 三层守护）。

**Frontend** 七层（单向 `app → components → hooks/stores/contexts → services → lib`）：

| 目录                    | 职责                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `app/`                  | App Router：page 只取参+渲染，业务进 `components/{feature}/XxxPage.tsx`                  |
| `components/ui/`        | **无业务设计系统**（primitive + app-agnostic composite）                                 |
| `components/common/`    | **跨 feature 业务/领域组件**，按 concern 子目录，根目录禁堆散落文件                      |
| `components/{feature}/` | 单 feature 专属                                                                          |
| `lib/`                  | 纯逻辑（无 React / 无 HTTP） · `services/` 所有 API · `hooks/` · `stores/` · `contexts/` |

## 3. 前端 UI：先复用，别自写

写任何 **卡片 / 弹层 / 抽屉 / 空态 / 加载 / 错误 / 页头 / Tab / 表格** 前，先查 `frontend/components/COMPONENTS.md` 的 canonical 清单，有就必须用。

- **所有卡片只在 `components/ui/cards/`**（`AssetCard` / `StatCard` / `SectionPanelCard` / `MessageCardShell` / `CardGrid` / `FeedCard` / `CreateCard` / `SettingsSectionCard` / `asset-card/`）。卡片网格用 `<CardGrid>`（响应式 + 等高），别各页硬编码 `grid-cols`。
- **主页头部用 `<PageHeaderHero>`**（`components/ui/page-header-hero`）。
- **页壳用 `<AppShell>`**；空/错/载用 `EmptyState`/`ErrorState`/`LoadingState`。
- **反馈**：瞬时通知用 `toast`、确认弹窗用全局 `confirm`（都 `from '@/stores'`）。**禁原生 `alert()`/`confirm()`**。
- 颜色/字号/间距走 `lib/design/tokens.ts` + globals.css 变量，禁任意值 `text-[Npx]` / 硬编码 `#hex`。
- **canonical 不适配 / 缺口 → 停下问用户**（标准 22 §3），不要静默自写，也不要擅自新建公共组件（放 `ui/` 还是 `common/` 是用户决策）。

## 4. ⚠️ 这些边界有机器闸门——撞了 `git push` 直接被拒

约定不是写进文档就算数；下面每条都接进 pre-push / CI，**违规拒推**（每条都造过违规实例验证确实拦得住）：

| 闸门                                             | 守什么                                                                                                               | 触发点                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `audit:ui-discipline` **R1–R15**（全 hard-zero） | 强制复用 canonical（页壳/卡/态/弹层/Tab/表格/spinner…）+ R14 主页必用 PageHeaderHero + **R15 卡片只许在 `ui/cards`** | pre-push `[4/6]`       |
| `component-placement.spec.ts`                    | `ui/` vs `common/` 目录归属：concern 白名单 + common 根禁散落 `.tsx` + 卡/页头不得回流 common                        | pre-push `[0c]`        |
| eslint `no-restricted-globals/-properties`       | 禁原生 `alert/confirm`（用 toast / 全局 confirm）                                                                    | pre-commit lint-staged |
| 架构 spec + ESLint `no-restricted-imports`       | AI 分层单向 + facade 不穿透                                                                                          | pre-push `[0]` + IDE   |
| `first-level-directory` / `lib-layer` 结构测试   | 顶层七层 + lib 分层白名单                                                                                            | pre-push `[0c]`        |
| god-class size guard / i18n / runtime-deps       | 大文件恶性增长 / 单花括号占位 / 未声明依赖                                                                           | pre-push               |

**要新增一个 canonical 组件或一个 concern 目录？** 正确姿势：① 先问用户放 `ui/` 还是 `common/` → ② 建 → ③ 登记到 `COMPONENTS.md` + 对应 audit/测试白名单。**不登记 = pre-push 拒推**（这是 feature，不是 bug——防止目录腐化 / 组件乱放）。

## 5. 验证命令

```bash
npm run verify:quick      # 类型 + 测试（快速）
npm run verify:full       # Lint + 类型 + 测试 + 构建
npm run audit:ui-discipline   # 前端 UI 一致性（R1–R15）
npm run verify:arch       # AI 分层边界
```

提交前自检（详见 CLAUDE.md「交付前自检清单」）：DB 配套迁移 / 前后端协议对齐 / 错误路径完整 / 资源清理 / 安全边界 / 旧代码清理 / 无 emoji·无 console.log·无 any。

## 6. 延伸阅读

- 行为红线 + 自检清单：`.claude/CLAUDE.md`
- 目录结构：`.claude/standards/02-directory-structure.md`
- 前端 UI 治理：`.claude/standards/22-frontend-ui-component-governance.md` + `frontend/components/COMPONENTS.md`
- AI 调用规范：`docs/guides/ai-calling-standards.md`
- agent 团队 mission 呈现：`.claude/standards/21-agent-teams-presentation.md`
