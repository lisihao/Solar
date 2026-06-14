# AI Ask Teams 模式 v1.0 - Release Notes

> 6 mode 多 AI 协作 + 房间持久化 + 流式 socket.io 推送。
> 5 PR 完整交付（W1-W4 backend + FE PR6 + W6 收口）。

**Release 日期**：2026-05-08
**版本**：v1.0
**入口**：`/ai-ask` 工具栏 → 「团队」按钮 / 直接访问 `/ai-ask/rooms/new`

---

## 概述

AI Ask 引入 **Teams 模式**（房间）：单会话内拉入多个 AI 成员一起群聊，支持 6 种协作模式。

**与 SOLO Ask 的关系**：

- 共用 `AskSession` 表与 `GET /sessions` 端点（设计 §8.0）
- 侧边栏会话列表混排 SOLO + ROOM
- `/ai-ask/rooms/...` 仅承载房间专属操作

---

## 6 种协作模式

| Mode             | 行为                                                          | 输出                                 |
| ---------------- | ------------------------------------------------------------- | ------------------------------------ |
| `FREECHAT`       | @-mention 路由命中成员；未命中 leader 选 1 名回               | N 条 AI 消息                         |
| `PARALLEL_MERGE` | 全部 enabled 成员并发 chat，leader 合成综合答                 | N + 1 条（成员 + 合成）              |
| `DEBATE`         | RED ↔ BLUE 多轮交锋，可选 JUDGE 总结                          | 2 × rounds [+ JUDGE] 条              |
| `VOTE`           | leader 出选项 → voters 投票 → 多数票计票                      | 1 (options) + N (votes) + 1 (结论)   |
| `REVIEW`         | 主答者出稿 → reviewers 并行评审 → 主答者修订                  | 1 (draft) + N (feedback) + 1 (final) |
| `HANDOFF`        | `[HANDOFF: targetId]` 标记驱动；最大深度 5；环检测 + 同名消歧 | chain 上每个 member 一条             |

---

## 后端架构

```
L3 ai-app/ask                                       新增
  ├─ ai-ask-room.service.ts                       房间 / 成员 CRUD（软删）
  ├─ ai-ask-room-runtime.service.ts               turn 编排（exhaustiveness check）
  ├─ ai-ask-room.controller.ts                    REST 9 端点
  ├─ ai-ask-room.gateway.ts                       socket.io `/ai-ask-room` (JWT verify)
  ├─ adapters/                                    6 mode adapter
  │   ├─ freechat.adapter.ts
  │   ├─ parallel-merge.adapter.ts
  │   ├─ debate.adapter.ts                        消费 ai-harness DebatePattern
  │   ├─ vote.adapter.ts                          消费 ai-harness VotingManager
  │   ├─ review.adapter.ts                        本期不依赖 Review 表
  │   └─ handoff.adapter.ts                       resolveHandoffTarget 三级消歧
  ├─ gateway/ask-room-events.types.ts             前后端共享事件契约
  └─ dto/                                         5 个 DTO

L2.5 ai-harness/teams/collaboration/debate/        新增（W1 PR2）
  ├─ debate-pattern.ts                            通用辩论编排基元
  ├─ debate-prompts.ts                            纯 prompt 函数
  └─ debate.types.ts                              IDebateAgent port
```

**Prisma schema 变更**（`AskSession` / `AskMessage` 字段扩展 + 新表 `AskRoomMember` / `AskRoomTurn`）：

- 全部默认值兼容，旧 SOLO 数据无迁移压力
- 软删保留历史发言者（单成员退场场景）
- partial unique index `(session_id, sequence_num) WHERE NOT NULL` 保 sequenceNum 单调

---

## 前端架构

```
frontend/
├─ app/ai-ask/
│   ├─ page.tsx                                    ★ 改：工具栏加「团队」按钮（红框）
│   └─ rooms/
│       ├─ new/page.tsx                            创建房间
│       └─ [id]/page.tsx                           房间详情
├─ components/ai-ask/
│   ├─ AskTeamsButton.tsx                          ★ 工具栏入口
│   └─ room/
│       ├─ RoomChatPage.tsx                       主组件
│       ├─ RoomMessageList.tsx                    消息渲染（USER/AI/SYSTEM 三类气泡）
│       ├─ RoomComposer.tsx                       输入区（mode 选择 + @mention 路由）
│       └─ RoomMemberPanel.tsx                    成员管理抽屉
├─ hooks/domain/useAskRoomSocket.ts                socket.io 订阅 + applyEvent
├─ services/ai-ask-room.service.ts                 REST 客户端
├─ stores/ask-room.store.ts                        zustand state（pending streaming）
└─ types/ask-room.ts                               前后端共享事件 mirror
```

---

## 安全/合规

| 维度                 | 落地                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| WebSocket JWT        | gateway `handleConnection` 内 `JwtService.verify`，伪造 userId 即 disconnect          |
| CORS                 | 白名单：`localhost:3000/3001`、`railway.frontendUrl/backendUrl`、`FRONTEND_URL`       |
| 房间隔离             | join 校验 sessionId 归属；`server.to(askRoomKey(sid)).emit` 仅同 room 广播            |
| 错误消息脱敏         | `sanitizeErrorMessage` 白名单（rate limit / timeout / credits / quota）保留；其余兜底 |
| Prompt 注入          | history 中 displayName `replace(/[\[\]\r\n]/g, "").slice(0, 40)`                      |
| 单 turn 并发限制     | runtime 仅维护 1 个活跃 turn 的 AbortController                                       |
| sequenceNum 并发保护 | partial unique index + retry-on-P2002（5 次指数退避）                                 |

---

## 集体评审 5 轮 + 共识

| 轮次 | 文档                                                 | 重点                                                              |
| ---- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| v1   | [teams-mode-review.md](./teams-mode-review.md)       | 设计稿评审 5 组并行 + 5 冲突仲裁，工期 14d → 17.5d                |
| v2   | [teams-mode-review-v2.md](./teams-mode-review-v2.md) | W1 代码 4 组：11/11 .claude 规则 PASS                             |
| v3   | [teams-mode-review-v3.md](./teams-mode-review-v3.md) | W2 PR3 4 组：3 安全阻塞修订（JWT / CORS / namespace）             |
| v4   | [teams-mode-review-v4.md](./teams-mode-review-v4.md) | W3 PR4 4 组 + 反向仲裁（JS 单线程 nextSeq 安全）                  |
| v5   | [teams-mode-review-v5.md](./teams-mode-review-v5.md) | W4 PR5 综合：VOTE session TTL / HANDOFF 消歧 / REVIEW SYSTEM 消息 |

---

## 测试覆盖

| 类型             | 数量                                                                         |
| ---------------- | ---------------------------------------------------------------------------- |
| 后端单元测试     | **70**（W1 16 + W2 20 + W3 16 + W4 18）                                      |
| 架构边界 spec    | 22                                                                           |
| 前端单元测试     | 0（W6 follow-up：useAskRoomSocket / Store reducer / RoomChatPage 各加 spec） |
| E2E (Playwright) | 6（smoke：/ai-ask Teams 按钮、/rooms/new 表单、/rooms/[id] 路由）            |

总计 **92 单元 + 6 E2E** PASS。

---

## 24 项 follow-up 列表

详见 [v2-v5 评审纪要](./teams-mode-review-v5.md#5-follow-up-列表新增)。优先级：

**v0.3（下一个版本）**：

- F1 ai-app/teams DebateService refactor 消费 harness DebatePattern
- F5/F18/F23 全套 i18n（VOTE/REVIEW/HANDOFF/synthesis prompt）
- F19 DebatePattern 显式传 round 给 chat
- F20 REVIEW 集成 ReviewWorkflowService + 建 Prisma `Review` 表
- F21 HANDOFF 升级为 ToolCall-based

**W7+（持续优化）**：

- F6 turn.subscribe + partial-log 端点（断线重连补差）
- F12 socket.io-redis adapter（多副本部署）
- F22 VotingManager session TTL 自动清理
- F24 nextSeq JS 并发安全 ADR
- 前端 spec 补全（useAskRoomSocket / store / RoomChatPage 等 W6 follow-up）
- 完整 happy-path E2E（mock backend or staging）

---

## 部署清单

1. ✅ Prisma 迁移 `20260508d_add_ask_room_tables` 部署到生产 DB（PR1 schema 必须先于 PR3+）
2. ⏳ Grafana 仪表盘 `AI Ask Room turns` 配置 OTEL filter
3. ⏳ 验证 `/api/v1/ask/rooms/...` 路由在 staging 可用
4. ⏳ Socket.io `/ai-ask-room` namespace 通过 NextJS rewrites（如有）正确转发
5. ⏳ 前端环境变量 `NEXT_PUBLIC_API_URL` 在生产指向后端

---

## 关联

- [设计文档 v0.2](./teams-mode.md)
- [ADR-004](../../../decisions/004-ai-ask-teams-mode.md)
- [v1-v5 评审纪要](./README.md#扩展设计)
- [性能基线](./teams-mode-perf-baseline.md)
