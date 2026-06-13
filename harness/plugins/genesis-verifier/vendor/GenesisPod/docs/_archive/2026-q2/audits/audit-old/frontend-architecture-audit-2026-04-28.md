# Frontend 全量架构审视报告

**审计日期**: 2026-04-28
**审计范围**: `frontend/` 全量目录（app / components / hooks / stores / services / lib / types / contexts / pages）
**审计员**: Claude Code（基于实地 grep + Read 核验，未依赖记忆或推断）
**Git 状态**: main，HEAD `ab30b9fdf`
**关注点**: 应作废 / 应下沉 / 应抽象 / 应与后端对齐

---

## 一、顶层结构（实地核验）

```
frontend/
├── app/         29 个一级路由（12 AI App + admin + 公共 + redirect 兼容层）
├── components/  ~537 个 .tsx
├── hooks/       core(5) / domain(26) / features(18) / utils(12) / swr(2) + 4 个根级
├── stores/      8 子目录（按模块）+ 3 个根级 .ts
├── services/    25 个文件，覆盖 13 个业务模块的 API 层
├── lib/         markdown / annotation / utils / i18n / cache / templates 等
├── types/       仅 6 个 .ts
├── contexts/    AuthContext.tsx
└── pages/       仅 _document.tsx + _error.tsx（Next.js Pages Router 残留）
```

## 二、与后端 ai-app 模块对齐（实地核验）

| 后端模块       | 路由             | 组件数 | components index.ts | hooks | store           | services                             |
| -------------- | ---------------- | ------ | ------------------- | ----- | --------------- | ------------------------------------ |
| research       | `/ai-research`   | 43     | 有                  | 有    | 无              | **缺**                               |
| teams          | `/ai-teams`      | 9      | 缺                  | 有    | 有              | 有                                   |
| topic-insights | `/ai-insights`   | 70     | 有                  | 部分  | 有              | 有                                   |
| writing        | `/ai-writing`    | 13     | 缺                  | 有    | 有              | 有                                   |
| office         | `/ai-office`     | 83     | 缺                  | 有    | 有（含 Legacy） | 无（用 ai-organizer）                |
| ask            | `/ai-ask`        | 5      | 缺                  | 有    | 无              | **缺**                               |
| image          | `/ai-image`      | 16     | 缺                  | 有    | 有              | **缺**                               |
| social         | `/ai-social`     | 17     | 有                  | 有    | 有              | 有                                   |
| library        | `/library`       | 58     | 缺                  | 有    | 无              | **缺**（部分在 google-drive/notion） |
| simulation     | `/ai-simulation` | 2      | 缺                  | 部分  | 无              | **缺**                               |
| planning       | `/ai-planning`   | 6      | 缺                  | 无    | 有              | 有                                   |
| explore        | `/explore`       | 42     | 有                  | 有    | 无              | **缺**                               |

**对齐缺口**：6 个模块（research / ask / image / library / simulation / explore）缺规范化 services/api.ts 文件。

## 三、问题清单

### A. 真死代码（已 grep 确认零业务引用，可立即清理）

| #   | 路径                                                       | 证据                                                               | 风险 |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------ | ---- |
| A1  | `frontend/pages/_document.tsx` `_error.tsx`                | 仅 `.next/` 构建产物引用                                           | 0    |
| A2  | `components/ai-office/ai-companion/`（3 组件 + index.ts）  | `AICompanionAvatar/AIProgressBar/AITypingIndicator` 全仓零外部引用 | 0    |
| A3  | `stores/ai-office/{slidesStore,slidesHistoryStore}` + 测试 | 除自身 `index.ts` 与单测外零引用                                   | 0    |

合计 ~15 个文件，删除后类型与构建均不受影响。

### B. 半废弃 / 错位

| #   | 现状                                                                                                     | 建议                                                                              |
| --- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| B1  | `stores/aiOfficeStore.ts` 939 行混 5 个 store（resource/document/chat/ui/task），自标 Legacy，9 文件依赖 | 拆为 `stores/ai-office/{resource,document,chat,ui,task}.ts` 后删根文件            |
| B2  | `app/report/[missionId]/page.tsx` 仅由 `components/ai-teams/TeamCanvasModal.tsx` 引用                    | 移到 `app/ai-teams/report/[missionId]/`，旧路径加 redirect                        |
| B3  | `app/ai-store/` 唯一入口是 `/ai-skills` redirect，无 Sidebar/admin 链接                                  | 与产品确认是否仍上线；未上线则连同 `components/ai-store/` + `/ai-skills` 一并下架 |
| B4  | `app/notion/[pageId]/page.tsx` 全仓零内部跳转                                                            | 确认是否 OAuth 外链回跳；是则保留并文件头注明                                     |

### C. 应下沉为公共能力（重复实现）

| #   | 重复点                                                                                                          | 建议归属                                               |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| C1  | `useResearchWebSocket` + `useWritingWebSocket`（根级，模式高度相似）+ `useAgentPlaygroundStream`（根级 stream） | 抽 `hooks/core/useStreamingChannel.ts`，三处特化包一层 |
| C2  | `common/ai-text-edit/` + `library/AIOrganizePanel.tsx` + `ai-office/ai-organizer-panels/`                       | 合并为 `components/common/ai-assistance/`              |
| C3  | `common/chart-viewer/` 与 `ai-office/visualizations/`                                                           | 评估合并；若无法合并则在文件头注释二者职责差异         |
| C4  | `lib/utils/html-capture.service.ts` + `lib/utils/pdf-thumbnail.ts` + `lib/templates/mission-report-pdf.ts`      | 集中到 `lib/document-export/`                          |
| C5  | `useMermaidWorker`（根级 hook，单点引用）                                                                       | 移入 `hooks/features/markdown/` 或 `lib/markdown/` 旁  |

### D. 应抽象 / 重新分层

| #   | 问题                                                                                     | 建议                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| D1  | `services/` 与 `hooks/domain/` 边界不清；`services/` 覆盖 13/19 模块，余 6 模块 API 散落 | 立纪律——所有 HTTP 调用集中到 `services/{module}/api.ts`，`hooks/domain/` 只做 React 状态/SWR 包装；补齐 6 个缺失 services |
| D2  | `hooks/domain/`（26）vs `hooks/features/`（18）职责重合                                  | 明确：domain = 单资源 CRUD；features = 多资源/跨模块业务流程；按此重分类                                                  |
| D3  | `types/` 仅 6 文件，绝大多数业务类型内联组件                                             | 优先补 `types/{research,library,explore,ask,image}.ts`                                                                    |
| D4  | `lib/utils/` 20+ 文件混杂（auth/date/sanitize/logger/html/pdf …）                        | 拆 `lib/{auth,time,html,pdf,text,logger}/`；utils/ 仅留无法分类的小工具                                                   |
| D5  | 重量级模块缺 `index.ts`：ai-office(83) / ai-insights(70) / library(58)                   | 按现有深路径白名单导出，不强制改调用方                                                                                    |
| D6  | 轻量模块（ai-teams 9 / ai-ask 5 / ai-planning 6 / ai-simulation 2）缺 `index.ts`         | **不补**——文件少时深路径反而更清晰                                                                                        |

### E. 应与后端对齐 / 命名

| #   | 问题                                                                                                    | 建议                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| E1  | 路由前缀混用：`ai-research/ai-teams/...` 有 `ai-` 前缀，`library/explore/rag/knowledge-graph/report` 无 | 协商规则：核心 AI App 用 `ai-` 前缀，资源/工具类不加；现状基本符合，仅 `report` 应入 `ai-teams` 子路由 |
| E2  | 后端 `topic-insights` vs 前端 `ai-insights`（路由 + 70 组件目录）                                       | 二选一统一；改名代价大，建议后端对外暴露名也统一为 `insights`，或前端 alias                            |

## 四、关键洞察

1. **死代码很少**——仅 3 处真死代码（pages 残留 / ai-companion / ai-office 子 store），合计 ~15 文件。
2. **真正的债务是"半废弃"和"错位"**——`aiOfficeStore.ts` 的 Legacy 拆分、`/report` 错位、根级 hooks 散落。
3. **services/ 是被低估的资产**——13/19 模块已规范化，缺的是把另外 6 个补齐和确立纪律。
4. **轻量模块不需要被"完整化"**——ai-ask 5 个组件、ai-simulation 2 个组件，强行加 store/index.ts/types 是过度工程。
5. **路由 redirect 不是废弃，是兼容层**——`/rag`、`/knowledge-graph`、`/ai-skills` 都是这个模式，应保留。

## 五、对前一版评估的修正

修正 `docs/analysis/frontend-architecture-evaluation.md`（2026-01-23）中以下结论：

- 一版判定「`stores/aiOfficeStore.ts` 应删」→ 实际是活代码（9 文件依赖 / 含首页），应**拆分**而非删除。
- 一版判定「13 个模块都需补 index.ts」→ 实际深路径导入仅 ~5 处，仅 3 个重量级模块（ai-office/ai-insights/library）值得补。
- 一版判定「services/ 缺失」→ 实际存在且规范，覆盖 13/19 模块。
- 一版判定「`/rag`、`/knowledge-graph` 是重复废弃路由」→ 实际是 redirect 兼容层，应保留。

---

## 关联文档

- 行动计划与执行清单：[docs/architecture/frontend-cleanup-plan-2026-04-28.md](../architecture/frontend-cleanup-plan-2026-04-28.md)
- 历史评估：[docs/analysis/frontend-architecture-evaluation.md](../analysis/frontend-architecture-evaluation.md)
- 项目规范：[.claude/CLAUDE.md](../../.claude/CLAUDE.md)
