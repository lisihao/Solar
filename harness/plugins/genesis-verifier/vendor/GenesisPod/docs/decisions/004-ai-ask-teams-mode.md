# 004. AI Ask Teams 模式 - 消息级编排 + harness 直接复用

**Date**: 2026-05-08
**Status**: Accepted（集体评审通过 v0.2）
**关联设计文档**: [ai-app/ask/teams-mode.md](../architecture/ai-app/ask/teams-mode.md)
**评审纪要**: [ai-app/ask/teams-mode-review.md](../architecture/ai-app/ask/teams-mode-review.md)

## 背景

AI Ask 当前是 1:1 单聊。需求是支持「Teams 模式」：单会话内拉入多个 AI 成员一起群聊，支持自由群聊 / 并行合并 / 辩论 / 投票 / 评审 / handoff 等模式。已有 `ai-app/teams` 的 mission/topic 模型偏重，复用会让 Ask 失去轻量性；ai-harness 已有完整的协作 pattern（handoff / voting / review）和 agent runtime。

## 决策

在 `ai-app/ask` 内新增 **房间（Room）** 子能力，消息级编排，直接消费 ai-harness 既有 pattern：

1. **轻量新建，非下沉 teams**
   - 在 `ai-app/ask` 新增 room 子模块（`ai-ask-room.service` / `ai-ask-room-runtime.service` / `adapters/`），不引入 mission/topic 模型
   - `ai-app/ask` 仅依赖 `ai-harness/facade`，禁止 import `ai-app/teams` 任意符号
   - `ai-app/teams` 与 Ask Room 长期并存，定位不同（mission 长任务 vs 消息级群聊）

2. **扩展持久化，0 破坏性**
   - `AskSession` 加 `mode: SOLO|ROOM` 与 `roomConfig: Json?` 字段（默认 SOLO，行为不变）
   - 新增 `AskRoomMember`（房间内每个 AI = 一行）与 `AskRoomTurn`（每条用户消息触发的一次编排）
   - `AskMessage` 加 `senderType` / `senderMemberId` / `mentionedMemberIds` / `turnId` / `parentMessageId`
   - 手写 SQL 迁移，全部 `ADD COLUMN ... DEFAULT`

3. **消息级编排为主，mission 升格为辅**
   - 默认每条用户消息 = 一次 turn；turn 内由 mode adapter 调 harness pattern，可任意复杂
   - 用户离线时 AI 自主推进的长任务由「升格 mission」按钮触发，调 `ai-harness/business-team/mission-runtime-shell` 后台执行，事件回灌房间

4. **6 种模式 → harness pattern 适配**
   | Mode | 实现 |
   | ---------------- | ------------------------------------------------------------- |
   | `FREECHAT` | @-mention 路由 + leader fan-out 选择 |
   | `PARALLEL_MERGE` | `runner.parallel` + leader 合成 |
   | `DEBATE` | `ai-harness/teams/collaboration/debate`（本期从 app 提层） |
   | `VOTE` | `voting-pattern.VotingManager` |
   | `REVIEW` | `review-workflow.service` |
   | `HANDOFF` | `handoff-pattern.HandoffCoordinator` |

5. **附带架构修复：debate 提层**
   - 把 `ai-app/teams/services/collaboration/debate.service.ts` 移到 `ai-harness/teams/collaboration/debate/`，与 handoff/voting 同级
   - 修复"通用协作 pattern 错放在 ai-app 层"的历史问题，避免 Ask Room 建立 `ai-app/ask → ai-app/teams` 横向依赖

## 替代方案与放弃理由

| 方案                             | 放弃理由                                                             |
| -------------------------------- | -------------------------------------------------------------------- |
| 下沉到 ai-app/teams 复用 mission | Ask 体验被 mission 模型同化，失去"轻量即时问答"定位                  |
| 共享层下沉到 ai-harness 双消费   | 改动面最大，14d 工期翻倍，回报递减                                   |
| 全新 `AskRoomSession` 模型       | 会话列表合流困难，前端要分两套 hook 与页面，用户感知割裂             |
| 复用 Topic/Mission 表            | Ask 强耦合 Teams 数据模型，未来 Teams 演进会牵连 Ask                 |
| 纯会话级 mission 编排            | 与 Ask "提问 → 立即得到回复" 的语义不符，每次提问都创建 mission 太重 |

## 影响

**Positive**

- AI Ask 获得多 AI 群聊能力，覆盖日常即时问答场景
- 复用 ai-harness 既有 pattern，不重写抽象
- 0 数据破坏，旧 SOLO 会话与客户端继续工作
- 顺带修复 debate 错位的架构层级，9.8/10 架构合规度不降

**Negative**

- 新增 2 张表 + 5 个字段，Prisma schema 体积增加
- 前端新增 5 个组件、3 个 hook、1 个 store，AI Ask 页面复杂度上升
- PARALLEL_MERGE 4 成员并行的单 turn 成本约为 SOLO 的 5x（4 成员 + leader 合成），需要前端预扣提示

**Risk**

- debate 提层 PR 需要 `ai-app/teams` 既有 spec 全绿才能合，存在意外回归风险（缓解：单独 PR、跑完整套测试再合）
- mission 升格的事件回灌顺序若错乱可能造成会话错位（缓解：event-relay 带 sequence，前端按 sequence 排序）

## 实施

按 [设计文档](../architecture/ai-app/ask/teams-mode.md#13-实施分波-评审收敛-v02) 分 6 波，**17.5 工程日**（评审收敛后调整）：

- W1（3d）：Prisma 迁移（含 ProcessMemory）+ facade + ESLint 白名单 + debate 提层 + 补 spec
- W2（3.5d）：room 基础 + FREECHAT + namespace 显式 + WebSocket 类型契约
- W3（2.5d）：Billing 嵌套 spike + PARALLEL_MERGE + DEBATE
- W4（3.5d）：VOTE / REVIEW（含 Review 表迁移）/ HANDOFF + FE 模式 UI + 3 条 E2E
- W5（3d）：mission 升格 + event-relay + 幂等性 + Billing
- W6（2d）：后续 3 条 E2E + 性能 + 回归 + 文档

PR1（schema）与 PR2（debate 提层）可并行；PR3+ 严格串行依赖 PR1+PR2。

每波采用独立 git worktree（`feat/ask-room-w{N}-{scope}`）。

## 验收

- `npm run verify:arch` 全绿
- `npm run verify:full` 全绿
- 各 mode adapter ≥ 90% 行覆盖
- 6 个 E2E 用例全过
- 性能：FREECHAT p95 ≤ 6s；PARALLEL_MERGE 4 成员 p95 ≤ 12s
- 现有 SOLO Ask spec 0 回归

## 关联

- [ADR-003 A2A 协议采用](./003-a2a-protocol-adoption.md)：A2A 外部 agent 接入 Ask Room 的路径在本设计 v0.2 评估
- [设计文档](../architecture/ai-app/ask/teams-mode.md)：完整方案、数据模型、API、前端、测试、风险
