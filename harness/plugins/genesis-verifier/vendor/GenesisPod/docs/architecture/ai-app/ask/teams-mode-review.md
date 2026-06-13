# AI Ask Teams 模式 - 集体评审纪要 v1.0

> 五组并行评审 + 仲裁 + 共识收敛。本纪要为最终结论；具体修订已回灌设计稿 [teams-mode.md](./teams-mode.md)。

**评审日期**：2026-05-08
**评审版本**：teams-mode.md v0.1
**收敛后版本**：teams-mode.md v0.2（本纪要发布同日更新）
**关联 ADR**：[004-ai-ask-teams-mode.md](../../../decisions/004-ai-ask-teams-mode.md)

---

## 1. 评审组与产出

| 评审组 | 视角                        | 主要产出                             |
| ------ | --------------------------- | ------------------------------------ |
| R1     | 架构合规与分层守护          | 7 条缺陷（1 阻塞 / 4 重要 / 2 次要） |
| R2     | 数据模型与迁移安全          | 8 条缺陷（3 阻塞 / 2 重要 / 3 次要） |
| R3     | harness/engine pattern 复用 | 9 项评分（绿 7 / 黄 1 / 红 1）       |
| R4     | 前端与流式协议              | 8 条缺陷（2 阻塞 / 4 重要 / 2 次要） |
| R5     | 工期与可执行性风险          | 8 条风险，工期重估 14d → 17–18d      |

---

## 2. 冲突仲裁

### 2.1 R1 vs R3：harness/facade exports 现状

**冲突陈述**：

- R1 主张 `runner.parallel` / `MemoryFacade.working` / `ChatFacade` / `ToolFacade` / `RAGFacade` 等"facade 没有暴露"，是设计稿臆测。
- R3 主张以上能力在 `ai-harness/facade/index.ts` 已 export，给出行号。

**仲裁方法**：直接读 `backend/src/modules/ai-harness/facade/index.ts`（共 1147 行）。

**仲裁结论（R3 胜出）**：

| 符号                                      | 真实位置                                                                                   | 状态  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ | ----- |
| `ChatFacade` / `ToolFacade` / `RAGFacade` | `facade/index.ts:39 → export * from "./domain"` → `domain/chat.facade.ts:81`               | ✓     |
| `ConcurrencyLimiter`                      | `facade/index.ts:208`                                                                      | ✓     |
| `MissionRuntimeShellFramework`            | `facade/index.ts:418`                                                                      | ✓     |
| `EventRelayFramework`                     | `facade/index.ts:425`                                                                      | ✓     |
| `ProcessMemoryManagerService`             | `facade/index.ts:730`                                                                      | ✓     |
| `MissionExecutorService`                  | `facade/index.ts:842`                                                                      | ✓     |
| `ReviewWorkflowService`                   | `facade/index.ts:891`（但 Prisma `Review` 模型未建，运行时 `isModelAvailable()` 恒 false） | ✓ / ⚠ |
| `VotingManager`                           | `facade/index.ts:893`                                                                      | ✓     |
| `HandoffCoordinator`                      | `facade/index.ts:895`                                                                      | ✓     |
| `DebateService`                           | 仍在 `ai-app/teams/services/collaboration/debate.service.ts`，未提层                       | ✗     |

**R1 在该项上 4 条缺陷被推翻**；保留的有效论点是 freechat 编排下沉、virtual member、leader prompt 规范、mission 升格映射。

### 2.2 R2 vs 设计稿：ID 生成方式

**仲裁方法**：读 `backend/prisma/schema/models.prisma:3026-3047`。

**仲裁结论（R2 胜出）**：现有 `AskSession.id` 与 `AskMessage.id` 均用 `@default(uuid())`，设计稿 `@default(cuid())` 错误，必须全部新表改 `uuid()`。

### 2.3 R4 vs 设计稿：socket.io namespace

**仲裁方法**：读 `ai-teams.gateway.ts:23-24`。

**仲裁结论（R4 胜出）**：现有 namespace 是 `/ai-teams`。新建 gateway **必须**用独立 namespace `/ai-ask-room`，前端用独立 socket 实例。

### 2.4 R4 vs 设计稿：现有 SOLO Ask 是否流式

**仲裁方法**：grep `frontend/components/ai-ask/`、`frontend/hooks/domain/` 中的 `EventSource` / `fetch.*stream` / `socket.on`。

**仲裁结论**：现有 SOLO Ask 前端**不流式**（无 EventSource、无 socket、唯一 socket.on 在 `useNotificationSocket.ts`，与 Ask 无关）。引入 socket.io 是**新协议**而非"复用现有"，设计稿 §6 措辞需更正。

### 2.5 R2 vs 设计稿：迁移目录命名

**仲裁方法**：列 `backend/prisma/migrations/` 最近目录。今天已有 `20260508a` / `20260508b` / `20260508c` 三条。

**仲裁结论**：新迁移应命名 `20260508d_add_ask_room_tables` 或顺延到 `20260509_add_ask_room_tables`，**不**用设计稿写的 `20260512_ask_room`。

---

## 3. 共识：收敛后的修订清单

按严重度 + 落地波次组织。**所有 P0/P1 必须在对应波次内完成；P2 视进度延后**。

### 3.1 P0 阻塞（W1 内必须解决）

| #   | 来源     | 问题                                                                                        | 修订                                                                                                                                                                             |
| --- | -------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | R2       | 设计稿 §4.1 所有新表 `@default(cuid())` 与现有 `AskSession`/`AskMessage` 的 `uuid()` 不一致 | 全部改 `@default(uuid())`                                                                                                                                                        |
| 2   | R2       | `AskRoomTurn.triggerMessageId` 缺 FK 关系                                                   | 补 `trigger AskMessage @relation(fields: [triggerMessageId], references: [id], onDelete: Restrict)`                                                                              |
| 3   | R2       | `AskMessage.parentMessageId` 缺自引用 FK                                                    | 补 `parent AskMessage? @relation(name: "ask_msg_replies", fields: [parentMessageId], references: [id], onDelete: SetNull)` + `replies AskMessage[] @relation("ask_msg_replies")` |
| 4   | R1+R3+R5 | DebateService 未提层；W1 假设它是同步前置                                                   | 拆 PR：PR1 (Prisma 迁移 + facade exports) 与 PR2 (debate 提层) 并行；PR2 必须在 PR3 (W2 room 基础) 启动前 **48h 合入**；W3 PR4 严格依赖 PR2，无并行余地。详见 §4                 |
| 5   | R4       | 流式协议 §6.2 缺 `messageId` 生成时机定义 + `sequenceNum`                                   | 修订 §6.2：(a) `messageId` 在 adapter 入口生成 uuid；(b) 所有 server event 加 `sequenceNum: number`（房间内单调递增）；(c) 前端按 `sequenceNum` 排序而非 `createdAt`             |
| 6   | R4       | 断线重连"v0.1 不补偿"会让 UI 抽搐                                                           | 修订 §6.3：(a) AskRoomTurn.metadata 增量记录 partial deltas；(b) 新增 `GET /turns/:tid/partial-log?since=:seq` 让前端补差量；(c) 若 5s 内重连失败，降级展示最终消息              |
| 7   | R5       | PARALLEL_MERGE 5 路并行调用与 BillingContext 的 AsyncLocalStorage 是否会交叉污染            | W3 启动前先做 1 工程日 spike：用 4 个 mock chat 验证嵌套 BillingContext 计费正确；不达标则降级为 leader 串行调度                                                                 |

### 3.2 P1 重要（W2 之前 / 各波内）

| #   | 来源 | 问题                                                                                            | 修订                                                                                                                                                                  | 落地波次 |
| --- | ---- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 8   | R2   | `mentionedMemberIds: String[]` 高频解析无 GIN 索引                                              | 迁移 SQL 加 `CREATE INDEX CONCURRENTLY ask_messages_mentioned_members_gin_idx ON ask_messages USING GIN (mentioned_member_ids)`                                       | W1       |
| 9   | R2   | `AskRoomMember` `onDelete: Cascade` 与 `AskMessage.senderMember SetNull` 组合会丢历史发言者信息 | 改为软删：`AskRoomMember.deletedAt DateTime?` + `enabled Boolean`，物理删除路径仅在 AskSession cascade 时触发，单成员不允许硬删                                       | W1       |
| 10  | R4   | gateway namespace 没显式声明，可能与 `/ai-teams` 隐性冲突                                       | `@WebSocketGateway({ namespace: "/ai-ask-room", cors: { ... } })`，前端独立 `io(${baseUrl}/ai-ask-room, ...)`                                                         | W2       |
| 11  | R4   | SSR 下 `useParams()` 首次 undefined，socket 初始化错位会漏前几秒事件                            | hook 加 `enabled` 守门：`useAskRoomEvents({ sessionId, enabled: !!sessionId })`；page.tsx 标 `'use client'`                                                           | W2       |
| 12  | R1   | `AskRoomMember.agentId` 没区分"已注册 agent"vs"虚拟成员"                                        | (a) `agentId` 改为 nullable；(b) 增字段 `memberType AskRoomMemberType`（`REGISTERED` / `VIRTUAL`）；(c) virtual 时 adapter 直接 `ChatFacade.chat`，不走 AgentRegistry | W1       |
| 13  | R3   | `ProcessMemory` 表未创建 → working memory 读写降级为空                                          | W1 迁移脚本同步建 `ProcessMemory` 表（参考 harness `MemoryLayer` enum）                                                                                               | W1       |
| 14  | R3   | `Review` / `ReviewFeedback` 表未创建 → REVIEW 模式无法落库                                      | W1 或 W4 初迁移建 `Review` / `ReviewFeedback`；本期 v0.1 REVIEW 暂不依赖落库（可在 turn metadata 内承载）                                                             | W4       |
| 15  | R5   | PR2→PR3 强串行依赖在原分波表未明示                                                              | §13 分波表加显式串行注释；PR2 review 阻塞超 1d 即在 facade 加 stub 补丁让 W3 解锁                                                                                     | W1       |
| 16  | R5   | E2E 6 用例 2d 不现实，单条 30–45 分钟实施 + debug                                               | 工期改为 W4 跑 3 条 (1.5d) + W6 跑 3 条 (1.5d)，总 3d                                                                                                                 | W4/W6    |
| 17  | R5   | 前后端 socket 事件类型无 contract 测试                                                          | 新建 `backend/src/modules/ai-app/ask/gateway/types.ts` 单文件导出，前端 import；W2 收尾加 1 条 socket 事件契约 unit                                                   | W2       |
| 18  | R5   | mission 升格事件 relay 顺序与幂等性                                                             | W5 实现时 SYSTEM 消息按 `sequenceNumber` 排序；同一 turnId 升格幂等（DB unique 约束 `mission_for_turn`）                                                              | W5       |
| 19  | R5   | ESLint / `verify:arch` 白名单未同步更新                                                         | PR1 同步修改 `backend/.eslintrc.js` 与 `layer-boundaries.spec.ts`，加 `ai-harness/teams/collaboration/debate` 路径                                                    | W1       |

### 3.3 P2 次要（不阻挡，但纳入设计稿）

| #   | 来源 | 问题                                                                   | 修订                                                                                                             |
| --- | ---- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 20  | R1   | FREECHAT 的 fan-out selector 是编排能力，不应留 ai-app                 | v0.2 仍留 ai-app 内（先验证业务），v0.3 评估下沉到 `ai-harness/teams/collaboration/patterns/freechat-pattern.ts` |
| 21  | R1   | Leader 合成 prompt 没规范                                              | §5 增加小节"Leader Synthesis Spec"：模板 / 约束 / billing 计算样例                                               |
| 22  | R1   | 升格 mission 时 AskRoomMember → TeamMember 映射缺                      | §7 增小表，明示字段映射 + 实现位 `adapters/promote-to-mission.adapter.ts`                                        |
| 23  | R2   | `roomConfig` JSON 无 schema 校验                                       | DTO 层 class-validator 已校验；DB 层加 CHECK：`(room_config->>'maxParticipants')::int <= 8`                      |
| 24  | R2   | 迁移目录命名应符合现有惯例                                             | 改为 `20260508d_add_ask_room_tables` 或 `20260509_add_ask_room_tables`                                           |
| 25  | R2   | `roomConfig` 未给默认值                                                | schema `@default("{}")`，迁移 SQL `ADD COLUMN room_config JSONB DEFAULT '{}'`                                    |
| 26  | R4   | §10.2 列了 7 个组件而非 5；可能要引 `react-flow` / `react-diff-viewer` | §10 加复杂度评估表 + 第三方库决策（默认自写轻量版本，不引新库）                                                  |
| 27  | R4   | "复用 chatWithToolsStream" 措辞不准确——现有 SOLO Ask 不流式            | 修订 §6.0：明示 ROOM 是新流式协议（基于 socket.io），SOLO 维持 fetch+JSON 不变                                   |

---

## 4. 工期重估（共识）

R5 重估，全员认可：**14 工程日 → 17–18 工程日**。

| 波次     | 原估    | 调整后    | 关键调整                                                                                              |
| -------- | ------- | --------- | ----------------------------------------------------------------------------------------------------- |
| W1       | 2d      | **3d**    | debate 提层 + 补 spec + ProcessMemory/Review 迁移 + ESLint/verify:arch 白名单（P0-1~4, P1-8, 13, 19） |
| W2       | 3d      | **3.5d**  | room 基础 + FREECHAT + namespace 显式 + SSR 守门 + WebSocket 类型契约（P1-10, 11, 17）                |
| W3       | 2d      | **2.5d**  | PARALLEL_MERGE/DEBATE adapter + Billing 嵌套 spike + 并发计费集成测试（P0-7）                         |
| W4       | 3d      | **3.5d**  | VOTE/REVIEW/HANDOFF 三 adapter + FE 模式 UI + 3 条 E2E + Review 表迁移（P1-14, 16）                   |
| W5       | 2d      | **3d**    | mission 升格 + event-relay 集成 + 幂等性 + Billing 接入（P1-18）                                      |
| W6       | 2d      | **2d**    | 后续 3 条 E2E + 性能基线 + 回归 + 文档收尾                                                            |
| **合计** | **14d** | **17.5d** |                                                                                                       |

PR 串行依赖（**新增显式声明**）：

```
PR1 (Prisma + facade + ESLint)  ┐
                                ├── 必须先合 ──→ PR3 (room 基础)
PR2 (debate 提层 + spec)        ┘                  │
                                                   ↓
                              PR4 (DEBATE adapter, 严格依赖 PR2)
```

---

## 5. 设计稿修订状态

本纪要发布同日，[teams-mode.md](./teams-mode.md) 已更新到 v0.2，所有 P0 + P1 均已落入文档：

- §2 决策表加冲突仲裁结论 + 工期 17.5d
- §4 Prisma schema 全部 `uuid()`，三处 FK 补齐，AskRoomMember 软删，ProcessMemory/Review 迁移加入 §4.2
- §5.1 IModeAdapter 增 `messageId` 生成时机说明
- §5.4 增 virtual member 处理流程
- §5（新增小节）Leader Synthesis Spec
- §6.0 明示 ROOM = 新协议；§6.2 增 `sequenceNum`；§6.3 增 partial-log 端点与降级策略
- §7（修订）AskRoomMember → Mission 映射表 + 幂等性约束
- §10 新增组件复杂度表
- §13 分波表 + PR 串行依赖 + 工期 17.5d

P2 项标记 `(待 v0.3)` 留在文档相应小节。

---

## 6. 集体共识

5 组评审一致同意以下三点结论：

1. **方向通过**：消息级编排 + 房间级状态 + mission 升格逃生口的整体架构合理，复用 ai-harness 既有 pattern 是正确选择。
2. **不允许跳过 P0/P1**：所有 P0 在 W1 内强制完成；P1 按落地波次硬截止；P2 可延后但需在文档登记。
3. **工期 17.5 工程日**为最终承诺；PR1/PR2 任一延误超过 1 个工作日，立刻同步给项目负责人决定是否拆解功能或延期。

---

## 7. 评审过程

为保证评审独立性：5 组评审在并行启动前互相不可见对方意见；汇总阶段由协调者亲自仲裁有冲突的事实声明（直接读源码对账）；P0/P1 修订条目在回灌设计稿前再做一次反向追溯（每条都能链回某个评审组的具体段落）。

| 时间线（同日） | 动作                               |
| -------------- | ---------------------------------- |
| T0             | 5 组并行启动，各拿真实代码挑刺     |
| T0 + 2h        | 5 组陆续返回意见                   |
| T0 + 2.5h      | 协调者读源码仲裁 5 条冲突陈述      |
| T0 + 3h        | 共识纪要落档；设计稿 v0.2 同步发布 |

---

## 8. 关联文档

- [设计文档 v0.2](./teams-mode.md)
- [ADR-004 AI Ask Teams 模式](../../../decisions/004-ai-ask-teams-mode.md)
- [SOLO Ask 现状文档](./README.md)
