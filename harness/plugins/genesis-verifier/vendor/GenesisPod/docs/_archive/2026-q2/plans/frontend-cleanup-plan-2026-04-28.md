# Frontend 架构整治方案

**起草日期**: 2026-04-28
**起草者**: Claude Code
**前置审计**: [docs/audit/frontend-architecture-audit-2026-04-28.md](../audit/frontend-architecture-audit-2026-04-28.md)
**目标**: 清理死代码、消除半废弃错位、收敛重复实现、统一分层纪律
**原则**: 每个 Phase 自带"成功标准"（验收命令），失败回滚至 Phase 起点

---

## Phase 0 · 待决策项（先于 Phase 1 跟产品/后端确认）

| ID  | 待决策项                                                                 | 决策方      | 影响                      |
| --- | ------------------------------------------------------------------------ | ----------- | ------------------------- |
| Q1  | `app/ai-store/` + `app/ai-skills/` + `components/ai-store/` 是否仍上线？ | 产品        | 决定 Phase 2 是否包含下架 |
| Q2  | `app/notion/[pageId]/page.tsx` 是 OAuth 回跳还是孤儿？                   | 产品/后端   | 决定 Phase 2 是否包含删除 |
| Q3  | `topic-insights`（后端命名）vs `ai-insights`（前端命名）统一方案         | 后端 + 前端 | 决定 Phase 4 改名范围     |
| Q4  | `report` 是否归 `ai-teams` 子路由                                        | 后端        | 决定 Phase 1.B2 是否执行  |

**未确认前不动 Phase 4，Phase 1-3 可独立推进。**

---

## Phase 1 · 立即清理（30 分钟，零风险）

### 范围

仅删除已 grep 实证零业务引用的死代码，不改任何被引用文件。

### 操作清单

| #   | 操作        | 文件                                                               |
| --- | ----------- | ------------------------------------------------------------------ |
| 1   | `git rm`    | `frontend/pages/_document.tsx`                                     |
| 2   | `git rm`    | `frontend/pages/_error.tsx`                                        |
| 3   | `git rm -r` | `frontend/components/ai-office/ai-companion/`                      |
| 4   | `git rm -r` | `frontend/stores/ai-office/`（含 `__tests__`）                     |
| 5   | Edit        | `frontend/stores/index.ts` 删除 `export * from './ai-office'` 一行 |

### 成功标准

```bash
cd frontend
npm run type-check          # 0 error
npm run lint                # 0 error
npm run build               # 构建成功
npm run test:quick          # 测试通过
```

### 回滚

`git checkout -- frontend/pages frontend/components/ai-office/ai-companion frontend/stores/ai-office frontend/stores/index.ts`

### 风险

- `pages/_document.tsx` 删除后需要确认 Next.js 不再有 Pages Router 默认行为依赖（理论上无，因项目全量 App Router）
- 若 `stores/index.ts` 在某处被星号导入并依赖 `slidesStore` 间接导出，会暴露——所以须跑 type-check

---

## Phase 2 · 半废弃修复（1-2 天，中风险）

### 2.1 拆分 `stores/aiOfficeStore.ts`

**现状**: 939 行，5 个独立 zustand store（resource/document/chat/ui/task），自标 Legacy，9 文件依赖。

**目标结构**:

```
stores/ai-office/
├── index.ts            # 统一 re-export
├── resource.store.ts   # useResourceStore + useSelectedResources
├── document.store.ts   # useDocumentStore + useCurrentDocument + GenerationStep
├── chat.store.ts       # useChatStore + useCurrentChatMessages
├── ui.store.ts         # useUIStore
└── task.store.ts       # useTaskStore + Task interface
```

**操作**:

1. 按行号切分（resource: 42-128 / document: 129-445 / chat: 446-527 / ui: 528-591 / task: 592-910 / hooks: 911-925）
2. 删除根 `stores/aiOfficeStore.ts`
3. 更新 `stores/index.ts` 重新导出 `./ai-office`
4. 9 个引用文件无需改 import 路径（通过 `stores/index.ts` 透传）

**成功标准**: 9 个引用文件 type-check 通过 + 现有单测全绿。

### 2.2 移动 `app/report/[missionId]/`（待 Q4 确认）

```
app/report/[missionId]/page.tsx  →  app/ai-teams/report/[missionId]/page.tsx
```

旧路径替换为 redirect 页（参考 `app/rag/page.tsx` 的写法）。

更新 `components/ai-teams/TeamCanvasModal.tsx` 中跳转 URL。

**成功标准**: 旧 URL 仍可访问（redirect）+ 新路径渲染正常。

### 2.3 下架 `ai-store` / `ai-skills`（待 Q1 确认）

如确认下线：

1. `git rm app/ai-skills/page.tsx app/ai-store/page.tsx`
2. `git rm -r components/ai-store/`
3. grep 确认无残留引用

### 2.4 处理 `app/notion/[pageId]/page.tsx`（待 Q2 确认）

- 若是 OAuth 回跳：在文件头加注释说明用途
- 若是孤儿：删除

---

## Phase 3 · 下沉重复能力（3-5 天，中风险，分 PR 推进）

### 3.1 抽 `hooks/core/useStreamingChannel.ts`

**整合**:

- `hooks/useResearchWebSocket.ts`（refs: 2）
- `hooks/useWritingWebSocket.ts`（refs: 2）
- `hooks/useAgentPlaygroundStream.ts`（refs: 3）

**做法**: 提取通用 streaming 抽象（连接 / 消息处理 / 重连 / 清理），三处改为薄包装层。

**成功标准**: 三处现有功能（WebSocket 连接 / 消息流转 / 重连）行为完全一致；现有单测通过。

### 3.2 合并 AI 辅助编辑能力

**整合**:

- `components/common/ai-text-edit/`
- `components/library/AIOrganizePanel.tsx`
- `components/ai-office/ai-organizer-panels/`

**目标**: `components/common/ai-assistance/`，子组件 `AITextEdit / AIOrganizePanel / AIFloatingToolbar`。

**做法**: 先提取共享逻辑（流式响应展示、操作按钮、prompt 输入框），再让三处特化版本继承公共部分。

**成功标准**: ai-office / library / 通用文本编辑三处入口功能不变；视觉无回归。

### 3.3 整理 `lib/utils/`

**拆分**:

```
lib/utils/                    →  lib/{auth,time,html,pdf,text,logger}/
├── auth.ts                   →  lib/auth/
├── date.ts                   →  lib/time/
├── sanitize.ts               →  lib/text/
├── logger.ts                 →  lib/logger/
├── html-capture.service.ts   →  lib/document-export/
├── pdf-thumbnail.ts          →  lib/document-export/
└── (剩余真零碎工具留在 utils/)
```

并入 `lib/templates/mission-report-pdf.ts` → `lib/document-export/`。

**做法**: 渐进式 PR，每次只移动一个领域目录，全仓 grep 替换 import 路径。

**成功标准**: `npm run type-check` 通过 + 一次提交一个 import 替换。

### 3.4 移动根级 hooks

```
hooks/useResearchWebSocket.ts      →  hooks/features/realtime/  (或 3.1 后下沉)
hooks/useWritingWebSocket.ts       →  hooks/features/realtime/
hooks/useAgentPlaygroundStream.ts  →  hooks/features/agent-playground/
hooks/useMermaidWorker.ts          →  hooks/features/markdown/
```

**成功标准**: 7 个引用文件 import 路径更新 + type-check 通过。

---

## Phase 4 · 分层纪律建立（中长期，需先达成共识）

### 4.1 services/ 与 hooks/domain/ 边界

**纪律**:

- `services/{module}/api.ts` = 纯 HTTP 层（`fetch`/`axios` + DTO 类型 + 错误规范化）
- `hooks/domain/use{Resource}.ts` = React 绑定层（SWR / state / mutation），调用 `services/`
- `hooks/features/use{Flow}.ts` = 多资源协作的业务流程

**补齐缺失 services**（6 个）:

- `services/ai-research/api.ts`
- `services/ai-image/api.ts`
- `services/ai-ask/api.ts`
- `services/ai-simulation/api.ts`
- `services/library/api.ts`（现有 google-drive / notion 是子集）
- `services/explore/api.ts`

**做法**: 每个模块独立 PR，从 `hooks/domain/` 抽取 HTTP 调用到 `services/`，hooks 改为消费 services。

### 4.2 重量级模块补 `index.ts`

仅以下 3 个：

- `components/ai-office/index.ts`（83 组件）
- `components/ai-insights/index.ts`（70 组件）
- `components/library/index.ts`（58 组件）

**做法**: 一次性按现有目录结构白名单导出，不强制改调用方深路径，新代码鼓励顶层导入。

**轻量模块不补**（ai-teams 9 / ai-ask 5 / ai-planning 6 / ai-simulation 2）——避免过度抽象。

### 4.3 补充 types/

优先 5 个高频模块：

- `types/research.ts`
- `types/library.ts`
- `types/explore.ts`
- `types/ask.ts`
- `types/image.ts`

**做法**: 从对应组件中提取内联接口，集中后从 types/ 引用。

### 4.4 hooks/domain vs hooks/features 重分类

按"单资源 CRUD" vs "多资源业务流程"重分类，必要时合并 features/ 进 domain/ 二级目录。

**先文档化规则，再启动重分类**——避免抽象先行。

---

## Phase 5 · 后端对齐（待 Q3 决策）

- 路由前缀规则文档化到 [docs/standards/](../standards/)
- `topic-insights` ↔ `ai-insights` 统一改名（决策方案二选一）

---

## 整体执行顺序

```
Phase 1 (立即, 零风险)
   ↓
Phase 0 决策（Q1-Q4 与产品/后端确认）
   ↓
Phase 2.1 (拆 aiOfficeStore，独立 PR)
   ↓
Phase 2.2-2.4 (依据 Q1/Q2/Q4 结果)
   ↓
Phase 3.1-3.4 (并行可拆 4 个 PR)
   ↓
Phase 4.1-4.4 (中长期，按月推进)
   ↓
Phase 5 (待 Q3 决策)
```

## 度量指标

| 指标            | 当前  | Phase 1 后 | Phase 3 后 | Phase 4 后 |
| --------------- | ----- | ---------- | ---------- | ---------- |
| 真死代码文件数  | 15    | 0          | 0          | 0          |
| 半废弃文件      | 4 处  | 4 处       | 0          | 0          |
| 重复实现点      | 5     | 5          | 0          | 0          |
| services 覆盖率 | 13/19 | 13/19      | 13/19      | 19/19      |
| 路由层异常      | 4     | 4          | 4          | 0          |

## 不在本方案范围

明确**不做**的事项：

- 重写已稳定运行的业务组件（ai-research / ai-teams 业务逻辑）
- 给所有模块强制补 store / index.ts / types（轻量模块保持现状）
- 改造已规范化的 `services/` 13 个文件
- 把 components/ui/、components/common/、layout/ 重新组织（这三块结构良好）

## 关联文档

- 审视报告：[docs/audit/frontend-architecture-audit-2026-04-28.md](../audit/frontend-architecture-audit-2026-04-28.md)
- 一版评估：[docs/analysis/frontend-architecture-evaluation.md](../analysis/frontend-architecture-evaluation.md)
- 项目规范：[.claude/CLAUDE.md](../../.claude/CLAUDE.md)
- 文档规范：[docs/standards/10-documentation-organization.md](../standards/10-documentation-organization.md)（如存在）
