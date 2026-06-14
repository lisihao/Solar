# business-team / span

Mission span framework：OTel root / stage / agent 三级嵌套 span lifecycle 管理。

## 含

- `business-team-mission-span.framework.ts` — `BusinessTeamMissionSpanFramework`（P2；mission root span + stage span + agent span 三级 / status 设定 / 嵌套上下文）

## 业务侧应如何继承

通常无需 extends：framework 实例直接注入到业务 mission runtime，业务方调 `framework.startMissionSpan() / startStageSpan() / startAgentSpan()` 即得 OTel 三级嵌套。

## 历史

- 2026-05-24 P2：从 `playground-mission-span.service` 抽出（`@migrated-from`），保留通用 OTel API 不绑业务事件。
