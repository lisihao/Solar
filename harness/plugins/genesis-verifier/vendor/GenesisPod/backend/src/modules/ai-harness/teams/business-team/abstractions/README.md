# business-team / abstractions

跨子目录共享的 BusinessAgentTeam 契约（业务方实现这些接口即得 framework 装配）。

## 含

- `business-team-spec.interface.ts` — `BusinessAgentTeamSpec`：一站装配规约（聚合 4 个核心 adapter，PR-E4）
- `mission-runtime-shell.interface.ts` — `IMissionRuntimeAdapter` + `MissionRuntimeSession`（E0，wallTime/credits/heartbeat 业务决策注入）
- `mission-store.interface.ts` — `IBusinessTeamMissionStore`（E2，lifecycle 核心方法签名，业务 store 用 structural typing satisfies）
- `rerun-guard.interface.ts` — `IBusinessRerunGuard`（E3，`checkInFlight` / `ensureRerunable` 核心签名）

## 业务侧应如何继承

reference impl：`ai-app/agent-playground` 的 4 个 adapter 类（event-relay / mission-runtime-shell / mission-store / rerun-guard）通过结构化类型隐式 satisfies 本目录全部接口；新业务方（social / radar / research 反向迁移）只需提供同名方法即可对接 framework。

## 历史

- 2026-05-08 PR-E0~E4：从 reference impl `agent-playground` 抽出 4 个核心接口（`@migrated-from`），由 `EventRelayFramework` / `MissionRuntimeShellFramework` 等 framework 类经接口消费。
- 后续子目录各自的 `abstractions/` 存放与该子目录强相关的 contract（如 `lifecycle/abstractions/*.contract.ts`），本目录只放跨子目录共享的核心 4 件接口。
