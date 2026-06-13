# AI Ask Teams 模式 - 性能基线 (W6)

> 设计 §12 性能基线锚定。本文记录各 mode 的 p50 / p95 目标与测量方法；
> 实际值在生产环境部署后由 Grafana 仪表盘填入。

**评审日期**：2026-05-08
**关联文档**：[设计 v0.2 §12.4](./teams-mode.md) · [v5 评审](./teams-mode-review-v5.md)

---

## 1. 性能目标（设计 §12.4 锚定）

| 模式                                       | p50 目标      | p95 目标      | 阻断阈值        | 备注                               |
| ------------------------------------------ | ------------- | ------------- | --------------- | ---------------------------------- | --- | ----------- |
| FREECHAT (1 成员)                          | ≤ 3 s         | ≤ 6 s         | p95 > 8 s 阻断  | 与 SOLO Ask 相当                   |
| PARALLEL_MERGE (4 成员 + leader 合成)      | ≤ 8 s         | ≤ 12 s        | p95 > 18 s 阻断 | 5 次并发 chat (4 worker + 1 synth) |
| DEBATE (3 成员 / 2 轮)                     | ≤ 12 s        | ≤ 20 s        | p95 > 30 s 阻断 | 4 次串行 chat (RED/BLUE × 2 轮)    |
| VOTE (3 voters)                            | ≤ 8 s         | ≤ 14 s        | p95 > 20 s      | 1 options gen + 3 voters           |
| REVIEW (1 author + 2 reviewers + revision) | ≤ 14 s        | ≤ 22 s        | p95 > 30 s      | 4 次 chat (draft + 2 review        |     | + revision) |
| HANDOFF (chain 长度 1-3)                   | ≤ 4 s × chain | ≤ 8 s × chain | 单跳 p95 > 10 s | 与链长度线性相关                   |

---

## 2. 测量入口

| 维度           | 方法                                                                      |
| -------------- | ------------------------------------------------------------------------- |
| 后端 turn 时长 | Grafana：`ai-ask.room.turn` span（OTEL trace）`p50/p95`，按 `mode` 维度筛 |
| 单 chat 调用   | Grafana：`ai-engine.chat.latency_ms` 按 `operationType=room-*` 筛         |
| 前端 TTI       | Web Vitals: `LCP` / `INP` 在 `/ai-ask/rooms/[id]` 路由                    |
| Socket 推送    | Grafana：`ask-room.gateway.emit_lag_ms`（W6 follow-up，目前没埋点）       |

---

## 3. 阻断规则（CI / Production gating）

- **PR-time**: 不强制（LLM 调用波动太大；CI 用 mock）
- **Pre-prod**: 单条 turn p95 > 阻断阈值连续 3 次 → 自动阻断 release
- **Prod**: SLO 7 天滚动 p95 > 阻断阈值 → 触发 PagerDuty (`oncall-ai`)

---

## 4. 已知性能瓶颈与 follow-up

| 瓶颈                                                 | 影响                   | 计划                                     |
| ---------------------------------------------------- | ---------------------- | ---------------------------------------- |
| FREECHAT 一次性返回（不流式 token）                  | 用户感知慢             | v0.3 改 `chatFacade.chatStream`（F23）   |
| PARALLEL_MERGE leader 合成顺序串行（必须等所有成员） | 长尾延迟               | v0.3 探索"早收齐就开始合成"策略          |
| DEBATE 多轮严格串行                                  | 时长 = 轮数 × 双方时延 | 协议本身约束，无优化空间                 |
| VOTE 选项生成额外一次 chat                           | +2-3 s                 | 用户传 `voteOptions` 时无该开销          |
| HANDOFF 链长不可预测                                 | p99 不稳定             | UI 层显示进度链 + 给用户取消按钮（已有） |

---

## 5. 性能验证清单（生产部署前）

- [ ] Grafana 看板「AI Ask Room turns」上线
- [ ] OTEL `ai-ask.room.turn` span 在 production 出现，包含 `mode` / `participantCount` / `userId` 属性
- [ ] BillingContext 在 5 路并发 PARALLEL_MERGE 下计费正确（1 turn = N+1 transaction）
- [ ] FREECHAT 4 成员同时 mention 的 turn p95 ≤ 12 s（混合 routing）
- [ ] socket.io `/ai-ask-room` namespace 在 100 并发连接下不掉线（`pingTimeout=60s`）

---

## 6. 关联

- [设计 v0.2](./teams-mode.md)
- [v5 评审](./teams-mode-review-v5.md)
