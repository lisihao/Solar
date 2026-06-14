# business-team / lifecycle

Mission 生命周期 framework：wall-time + heartbeat + abort/cleanup + store / checkpoint / event-buffer / postmortem / report / update / event-categories。

## 含

- `mission-runtime-shell.framework.ts` — `MissionRuntimeShellFramework`（E0；wallTimer + abort + try-finally 死手准则；adapter 注入 wallTime/credits/budget/heartbeat）
- `business-team-mission-store.framework.ts` — generic mission CRUD（create / update / list / decisions）
- `business-team-checkpoint-store.framework.ts` — stage checkpoint 持久化 + degraded 标记
- `business-team-event-buffer.framework.ts` — in-memory event buffer + TTL/GC（NestJS server-sent fallback）
- `business-team-lifecycle-transitions.framework.ts` — 5×5 状态机 + REPORT/ERROR size guards
- `business-team-update-helper.framework.ts` — JSON field map + safe update
- `business-team-postmortem-helper.framework.ts` — 失败 postmortem 嵌入与查询
- `business-team-report-helper.framework.ts` — report version list / 版本快照
- `business-team-event-categories.ts` — event type 分类纯函数（business / lifecycle / unknown）
- `abstractions/` — 7 件 contract（mission-store / checkpoint-store / event-buffer / lifecycle-state-transitions / update-helper / postmortem-helper / report-helper）

## 业务侧应如何继承

reference 实现（playground）：`@Injectable() class PlaygroundMissionStore extends BusinessTeamMissionStoreFramework { ... }` 等 7 个 framework 各 extends 一次，hook 注入业务表名/字段映射/事件 namespace。social / radar 接入 mission-pipeline 时复用同样模式。

## 历史

- 2026-05-08 PR-E0：mission-runtime-shell 上提（首个 lifecycle framework）
- 2026-05-24 P6：剩余 7 件 framework 抽自 `ai-app/agent-playground/services/mission/lifecycle/` （`@migrated-from`）
