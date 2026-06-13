# AI Ask Teams 模式 - FE PR6 + W6 PR7 综合评审纪要 v6

> 第六轮评审：FE 前端 + W6 收口（E2E + 性能 + 文档）综合评审。
> 单一综合评审 + 修订 + 共识。

**评审日期**：2026-05-08
**评审对象**：

- FE PR6（commit `21f2dc013`）
- W6 PR7（commit `f4e0b8958`）
- 修订（commit `34a215460`）

---

## 1. 评审产出

| 视角           | 阻塞 | 重要 | 次要 | 总评                   |
| -------------- | ---- | ---- | ---- | ---------------------- |
| FE+W6 综合评审 | 3    | 5    | 4    | 6.5/10 → 修订后 8.5/10 |

---

## 2. 修订记录（已落地于 `34a215460`）

### 2.1 阻塞修订

| #   | 问题                                                                              | 修订                                                                                                                                      |
| --- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `service.ts` 错误消息直接 throw 后端 errMsg，可能泄露                             | 新增 `sanitizeErrorMessage(status, raw)`：401/403/404/429 走中文兜底；rate limit/timeout/quota/unauthor/forbid 等白名单保留；其余统一文案 |
| B2  | `useAskRoomSocket` 仅 join ack 失败回调，连接失败时 UI 卡 loading                 | `socket.on('connect_error')` 也调用 `onJoinErrorRef.current()`，RoomChatPage 能感知并显示 error                                           |
| B3  | `app/ai-ask/rooms/[id]/page.tsx` SSR 下 `useParams()` undefined 返回 null（白屏） | 改返回 `<AppShell>` 包裹的「房间加载中…」骨架，避免 Layout Shift                                                                          |

### 2.2 重要修订

| #   | 问题                                                                       | 修订                                                                                                                                                   |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I1  | `applyEvent` 未严格单调（turn.started 例外子句）                           | 改为「event.sequenceNum ≤ lastSeq 直接丢弃」，无例外。后端保证 turn.started seq 严格大于 user message seq                                              |
| I2  | `participant.done` 仅 mark status='done'，messages 未真正落入 state        | done 时把 pending 转为 final AskRoomMessage 推入 `messages` 数组，并从 `pending` 删除（防双重渲染）。content 用累积的 partialText（无 partial 时为空） |
| I3  | `RoomChatPage.onEvent` `turn.complete` 仅 logger.debug，未触发 reload      | 改为 `void reload()`，turn 结束后拉最新 members + recentTurns（messages 由 applyEvent 累积）。后端 `GET /rooms/:id/messages` 端点为 follow-up F12      |
| I4  | `RoomComposer` @mention 按钮在所有 mode 下都渲染，VOTE/DEBATE 等模式无意义 | 仅 FREECHAT 显示 @mention 按钮组；其他模式显示该模式行为提示文案                                                                                       |

### 2.3 次要（W6+ follow-up）

| #   | 项                                                             | 触发       |
| --- | -------------------------------------------------------------- | ---------- |
| F25 | E2E 404 路由错误状态 UI（"房间不存在"文本断言）                | W6+        |
| F26 | 工具栏两入口共存性 E2E（getByRole "工具" + "团队" 两按钮 ≥ 2） | W6+        |
| F27 | 性能基线表格补具体 socket RTT / first message time 数值        | 生产部署后 |
| F28 | RoomMessageList merged 排序 + 去重测 spec                      | W7         |

---

## 3. 总体合规度

| 维度                 | 结果                                                          |
| -------------------- | ------------------------------------------------------------- |
| `tsc --noEmit`（FE） | 0 error                                                       |
| 后端单测             | 92 PASS（继承 W4）                                            |
| FE Playwright smoke  | 6 用例（路由/工具栏入口/创建表单/模式选择/成员行/404 不白屏） |
| 前后端类型同步       | 11 个 server event 枚举值全对齐                               |
| 9 个 REST 端点       | 路径全吻合                                                    |
| 错误消息脱敏         | 前端 sanitizeErrorMessage + 后端 一致                         |
| Socket 连接异常处理  | `connect_error` 与 join ack 都通知 UI                         |
| sequenceNum 严格单调 | applyEvent 内强制                                             |

---

## 4. 进度统计（最终）

| 波次    | 状态 | 主要交付                                                        | commit          |
| ------- | ---- | --------------------------------------------------------------- | --------------- |
| W1 PR1  | ✅   | Prisma schema + 手写迁移                                        | `fe8c5211e`     |
| W1 PR2  | ✅   | DebatePattern 抽象 + 16 单测                                    | `a80fa2423`     |
| W2 PR3  | ✅   | room CRUD + FREECHAT + Gateway + 20 单测                        | `a41b0275c`     |
| W3 PR4  | ✅   | PARALLEL_MERGE + DEBATE + 16 单测                               | `6120f7ec1`     |
| W4 PR5  | ✅   | VOTE + REVIEW + HANDOFF + 18 单测                               | `0fbb97b63`     |
| FE PR6  | ✅   | 工具栏入口 + 创建/详情页 + store + socket + 4 组件              | `21f2dc013`     |
| W6 PR7  | ✅   | 6 E2E smoke + perf baseline + release notes                     | `f4e0b8958`     |
| v6 修订 | ✅   | 3 阻塞 + 4 重要落地（脱敏/连接错误/SSR/单调/落库/mention 门控） | **`34a215460`** |

---

## 5. 累计 follow-up（28 项）

详见 [v1-v6 评审纪要](./README.md)。重点：

**v0.3（主要功能优化）**：F1（teams DebateService 重构）/ F5/F18/F23（i18n）/ F19（pattern round 显式传）/ F20（REVIEW 集成）/ F21（HANDOFF ToolCall）

**W7+（持续优化）**：F6（resumeFromSeq）/ F12（GET /rooms/:id/messages）/ F22（VotingManager TTL）/ F24（nextSeq ADR）/ F25-F28（FE 测试补全）

---

## 6. 关联

- [设计文档 v0.2](./teams-mode.md)
- [v1 设计评审](./teams-mode-review.md)
- [v2 W1 评审](./teams-mode-review-v2.md)
- [v3 W2 评审](./teams-mode-review-v3.md)
- [v4 W3 评审](./teams-mode-review-v4.md)
- [v5 W4 评审](./teams-mode-review-v5.md)
- [v1.0 Release Notes](./teams-mode-release-notes.md)
- [性能基线](./teams-mode-perf-baseline.md)
- [ADR-004](../../../decisions/004-ai-ask-teams-mode.md)
