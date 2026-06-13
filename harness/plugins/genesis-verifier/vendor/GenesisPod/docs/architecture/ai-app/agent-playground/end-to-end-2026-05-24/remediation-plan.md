# Agent Playground 端到端审计 — 修复路线图

**日期：** 2026-05-25
**来源：** [SUMMARY.md](./SUMMARY.md)（e2e 5 路）+ [P32 4-way 审计](../wave-4-review-2026-05-24/SUMMARY.md)
**用途：** 把审计扫出的存量债转成可执行的修复条目，每条标注 **风险 / 可验证性 / 是否需运行环境**，供按优先级排期。

---

## 分类原则

每个条目按"能不能在当前环境（无运行 app、只有 tsc + jest 单测）安全验证"分三档：

- 🟢 **可单测验证** — 纯逻辑/类型/守护栏，tsc + jest 闭环，可自驱直接做
- 🟡 **需 integration 验证** — 改 hot-path 运行时行为，单测能覆盖逻辑但真实行为要跑 mission 才能确认
- 🔴 **需设计 + 新子系统** — 不是单点改动，要先定方案（新模块 / DB 迁移 / 跨层接口）

---

## 已完成

| 条目                                                          | commit      | 验证                                            |
| ------------------------------------------------------------- | ----------- | ----------------------------------------------- |
| WS gateway 查 blocklist (e2e P0-#6)                           | `b5bdca089` | gateway spec 18 tests + tsc + eslint ✅         |
| P32 守护栏缺口 (facade spec / PR-E0 / layout size / 安全 SOP) | `0b3e88079` | arch 24 suites/227 tests ✅                     |
| liveness wall-time 主动 abort (e2e P0-#2，仅 wall-time 分支)  | `012117358` | tsc + eslint + finalize/conformance 12 tests ✅ |

---

## 待办条目

### A1 — config snapshot 真契约 (P32 P0-3) 🟡

**问题**：`mission-app-conformance.spec.ts` 用 string regex 分别匹配三家函数名（`buildForFreshRun` / `buildRadarConfigSnapshot` / `buildSocialConfigSnapshot`），`|configSnapshot` 兜底使断言退化成"文件里出现 configSnapshot 字样即过"——假契约。

**正确修法**：

1. `MissionRuntimeShellFramework` 暴露抽象/模板方法 `protected abstract buildConfigSnapshot(input): TConfigSnapshot`，在 `openSession()` 里调用并冻结
2. 三家 runtime-shell 把现有 `buildXxxConfigSnapshot` 改成 override 这个统一方法
3. spec 改成断言：子类 override 了 framework 的 `buildConfigSnapshot`（AST 或 grep `buildConfigSnapshot`），而非各自函数名

**风险**：改 framework 抽象方法签名 → 3 家 runtime-shell 同步改。**blast radius = 3 app**。
**验证**：tsc（签名）+ 三家 runtime-shell 现有 spec + conformance spec。逻辑可单测，但"openSession 真的冻结了快照"要跑 mission 确认。
**建议**：值得做（消除假断言），但属 framework API 变更，先确认再动。

---

### A2 — bindings class → interface (P32 P0-2) 🟢/判断题

**问题**：`BusinessTeamStageBindingsFramework` 是 46 行 abstract class，只提供一个 `Logger` 字段 + 两个 abstract 方法，**当前仅 playground 一家继承**。architect 评：让 playground 净增 ~7 行 boilerplate 而非减少。

**两个选项**：

- **选项 A（architect 建议）**：删 abstract class，保留 `BusinessTeamStageBindings` interface；playground `extends` → `implements` + 自建 Logger。删 framework spec。
- **选项 B（与 P4/P5/P6 单消费方债务一致）**：保留 class，文档标注"thin by design，第 2 消费方出现时复用"。零 churn。

**风险**：选项 A churn framework + subclass + 删 spec，但 Logger 行为只是"移动"不是消失（architect 说的 +7 行会搬到 playground，净收益≈0）。
**验证**：tsc + playground bindings spec，可单测闭环。
**建议**：⚠️ **倾向选项 B**。选项 A 的收益（省一层 indirection）≈ 它的成本（churn + Logger 搬家），且若 social/radar 后续要正式 bindings 又得转回 class。与"P4/P5/P6 单消费方不回滚"的决策保持一致更自洽。**需用户拍板 A vs B**。

---

### B2 — 运行时 user-facing budget 告警 🟡

**问题（修正版）**：e2e 原 finding "没有 80% budget 事件" 不准。实测：

- S1 pre-flight：`mission:budget-warning-soft/hard`（user-facing，mission 启动时）✅ 已有
- loop ≥70%：`budget_warning` agent 事件（`react-loop.ts:1198`，内部 tier-downgrade + cost-tick 用）✅ 已有

**真缺口**：loop 的 ≥70% `budget_warning` 是 **agent 层事件**，未桥接成 user-facing **mission 层事件**。长 mission 跑到中途超 70% 预算时，用户 WS 收不到提示。

**正确修法**：

1. 在 dispatcher / bindings 的 event-relay 里，把 agent `budget_warning` 事件映射成 `mission:budget-warning-soft`（schema 已存在）
2. 加 once-latch（每 mission 只桥一次，避免每轮 LLM 调用刷屏）
3. 复用现有 `mission:budget-warning-soft` schema（不新增）

**风险**：改 hot-path event-relay。**blast radius = 事件流**。
**验证**：event-relay 单测能覆盖映射逻辑；"用户真收到"要跑 mission + 看 WS。
**建议**：中价值。先确认是否值得（70% 已 tier-downgrade 自救，告警主要是 UX 透明度）。

---

### B3-1 — Stage 单步独立 timeout (e2e P0-#1) 🟡

**问题**：stage 内部死循环只靠 mission liveness（5min stale + 4h wall）兜底，单 stage 最长可烧到 4h wall-time。stage `timeoutMs*1.5` 只 emit `stage:stalled` 警告，不杀。

**修法选项**：

- 在 orchestrator 给每个 stage 包一个 `Promise.race([stageRun, timeout(step.timeoutMs * N)])`，超时 reject → stage failed → 走正常 fail 路径
- 注意：S3-researcher 等 stage 合法耗时可能很长，timeout 阈值要保守（如 timeoutMs \* 3）+ 可配

**风险**：🟡 高——误杀合法长 stage 会直接破坏正常 mission。**这是设计如此（liveness 兜底）的有意取舍**，改它要权衡。
**验证**：单测能验 race 逻辑；阈值合理性必须跑真实 mission 统计 stage 耗时分布。
**建议**：**先收集生产 stage 耗时 P99 再定阈值**，不可拍脑袋。暂缓。

---

### B3-2 — Liveness markFailed 主动 abort in-flight (e2e P0-#2) ✅ 已完成 `012117358`

> 实施结论修正：只在 **wall-time-exceeded** 分支主动 abort（mission 仍活跃，有 in-flight）。
> stale/crash 分支不 abort（heartbeat 停=worker presumed dead，本 pod 无 in-flight，
> 且 abort enum 无 runtime_crashed 值）。比原 finding"总是 abort"更准。下方原分析保留供参考。

**问题**：LivenessGuard 标 mission failed 后，不主动触发 AbortRegistry，in-flight LLM call 继续烧钱直到 ReAct loop 下一轮顶部检测到（最坏 1 个 LLM turn 的浪费）。

**修法**：`MissionLivenessGuard.markFailed` adapter 回调里，除 finalize 外调 `abortRegistry.abort(missionId, runtime_crashed)`。

**风险**：🟡 中——abort 是幂等的（已验证），加一次主动 abort 安全；但要确认 liveness 扫描线程能访问到 AbortRegistry（跨 pod：被回收的 mission 可能在另一个 pod，本 pod 的 in-memory AbortRegistry abort 无效）。
**验证**：单测可验"markFailed 调 abort"；跨 pod 失效是已知 in-memory 锁限制（E53）。
**建议**：值得做（同 pod 场景有效，省钱）+ 文档标注跨 pod 限制。**单测可闭环**，相对安全。

---

### B3-3 — Graceful shutdown (e2e P0-#3) 🔴

**问题**：`orchestrator_shutdown` reason 定义但 0 调用者。pod rolling deploy 时 in-flight mission 不优雅终止，走 liveness 回收（≥5min 后才标 failed）。

**修法**：

1. NestJS `OnApplicationShutdown` hook → 遍历本 pod in-flight mission → `abortRegistry.abort(id, orchestrator_shutdown)` + checkpoint
2. 配 `app.enableShutdownHooks()` + 容器 SIGTERM grace period
3. 重启后 mission 从 checkpoint resume（依赖 rerun 机制）

**风险**：🔴 跨多个子系统（shutdown hook + checkpoint + resume），需端到端设计。
**验证**：必须在真实容器环境验 SIGTERM 行为。
**建议**：独立 spec 立项，不在本轮范围。

---

### B3-4 — PII / 敏感数据过滤 (e2e P0-#4) 🔴

**问题**：`engine/safety/pii` 目录未实现，prompt 含 PII 直接进 LLM provider。

**修法**：新建 `ai-engine/safety/pii/` 子系统（detector + redactor），接入 ai-chat 调用前的 pipeline。

**风险**：🔴 全新子系统 + 接入 hot-path + 误杀正常内容的权衡（PII 检测 false positive）。
**验证**：detector 可单测；接入效果要跑真实内容评估。
**建议**：独立 epic 立项，需产品定 PII 范围（GDPR? 手机号/邮箱/身份证?）。不在本轮范围。

---

### B3-5 — MISSION_FAILED notification (e2e P0-#5) 🟡

**问题**：`NotificationType` 枚举无 `MISSION_FAILED`，mission 失败用户无 email/push 通知，只能靠 UI WS（关了 UI 就不知道）。

**修法**：

1. Prisma `NotificationType` enum 加 `MISSION_FAILED`（手写 SQL 迁移 `ALTER TYPE ... ADD VALUE IF NOT EXISTS`）
2. 新建 `mission-failed-email.preset.ts`
3. dispatcher finalize-failed 路径调 NotificationDispatcher

**风险**：🟡 中——含 **DB enum 迁移**（手写 SQL，按项目规范不能用 prisma migrate dev）。迁移正确性是关键。
**验证**：dispatcher 单测可验"failed → dispatch notification 调用"；email 真发要 SMTP 环境。
**建议**：值得做（用户体验关键）。DB 迁移需谨慎，**建议单独一个 PR + 仔细 review 迁移 SQL**。

---

### C — 其余 P1/P2（来自 SUMMARY）

| 条目                                                        | 档  | 备注                                             |
| ----------------------------------------------------------- | --- | ------------------------------------------------ |
| RateLimit 单 pod → DistributedRateLimitGuard (P1-#8)        | 🟡  | 换 guard 实现，需 Redis 限流验证                 |
| mission 创建并发 race + 唯一约束 (P1-#9)                    | 🟡  | 加 DB 唯一约束（迁移）+ 乐观锁                   |
| mission row-missing 前端可见 (P1-#10)                       | 🟢  | openSession 失败时 reject 而非静默返回 missionId |
| 3 前缀不一致 (P1-#11)                                       | 🟢  | 文档统一 namespace/room/event 前缀约定           |
| MissionEventBuffer 双调用 (P1-#12)                          | 🟡  | controller/module 直 broadcast 绕 registry，收口 |
| Prisma abort (P1-#13)                                       | 🔴  | 架构限制，加监控 + 注释                          |
| DAG sibling fail 隔离 (P2-#44)                              | 🟡  | 确认 fail-fast vs 隔离策略                       |
| god-class: ai-social.service 1608 / s3-researcher 1024 (P2) | 🟢  | 按职责拆分                                       |

---

## 推荐执行顺序（按"安全可验证 + 价值"）

1. **🟢 立即可做（单测闭环）**：
   - B3-2 liveness 主动 abort（同 pod 省钱，单测可验）
   - P1-#10 mission row-missing 前端可见（openSession reject）
   - P1-#11 前缀统一（文档）
   - P2 god-class 拆分（纯重构）

2. **🟡 需确认方向 / integration 验证**：
   - A1 config snapshot 契约（framework API 变更，确认后做）
   - A2 bindings（**A vs B 选项需用户拍板**，倾向 B 不动）
   - B2 budget 桥接、B3-1 stage timeout（需阈值数据）、B3-5 notification（DB 迁移）

3. **🔴 独立立项**：
   - B3-3 graceful shutdown、B3-4 PII filter

---

## 本轮结论

e2e + P32 审计共暴 ~20 条存量债。本轮自驱**只落地了真正安全可验证的部分**（B1 WS blocklist + P32 守护栏缺口），其余按上表分档。**没有盲目改 hot-path 运行时代码**——因为当前环境无法跑 mission 验证，盲改违反项目"改动后必须验证实际效果"红线。

下一步请按"推荐执行顺序" §1 授权，或指定具体条目。
