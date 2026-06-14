# Wave 1b + Wave 4 + Wave 6 — 4 路并行审计汇总

**日期：** 2026-05-24
**审计范围：** Wave 1b（agent team app §8.2 重组）+ Wave 4（守护栏）+ TS1205 修复 + P30/P31 文档
**审计执行：** architect / arch-auditor / reviewer / security-auditor 4 路并发

---

## 综合评分

| Auditor          | 评分                           | 说明                                                                   |
| ---------------- | ------------------------------ | ---------------------------------------------------------------------- |
| architect        | **7.5 / 10**                   | 骨架对、方向对、看护栏对；但有 framework 单消费方债务 + 文档与现实背离 |
| arch-auditor     | **9.1 / 10**                   | 8 维度大体合规，P1 各 1 项                                             |
| reviewer         | **8.0 / 10**                   | 24 export type 修复全部正确；spec 有 2 个结构缺口                      |
| security-auditor | 0 Critical / 0 High / 2 Medium | 仅 radar collector 已知 SSRF 残留（非本次新增）+ 文档安全章节缺失      |
| **综合**         | **8.2 / 10**                   | 落地质量良好，但有需要立即纠正的"文档与现实背离"                       |

---

## 🚨 P0 必修项（合计 4 项）

### P0-1 (architect)：roadmap §6 + blueprint Status 文档错误

**事实**：commits `54b4152d0` (P4)、`2e4b4d851` (P5)、`8947b1e3b` (P6)、`5853ad6d1` (P7) 都已经在 main，落地时间早于 Wave 4。但 `docs/architecture/ai-app/agent-app-mass-migration-roadmap-2026-05-24.md` §6 写 "Wave 1 P4-P7 deferred"，`agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md` Status 写 "P7 待评估,不在 Wave 1b 范围"。

**真实状态**：

- `business-team/helpers/` (P4) — 3 文件，**consumer 只有 playground**
- `business-team/rerun/` (P5) — 5 framework + 2 helper，**consumer 只有 playground**
- `business-team/lifecycle/` (P6) — 7 framework，**consumer 只有 playground**
- `business-team/orchestrator/` (P7) — 1 framework，**3 个 app 都继承 (playground/social/radar)，合理**

**影响**：除 P7 外，P4/P5/P6 是 "为单消费方做框架"，违反 Karpathy "3 处再抽象" 原则。这正是 Wave 1 重新评估时本应该避免的反模式，但已经发生了。

**修法**：

1. 立即修 roadmap §6 + blueprint Status，标注真实状态
2. 把 P4/P5/P6 标为 "已落地，但单消费方 — 待第二消费方激活合理性"
3. 不需要回滚（damage 已成，回滚成本更高）
4. 添加 ESLint / spec 守护，防止再有人新增 "单消费方 framework"

### P0-2 (architect)：`bindings/business-team-stage-bindings.framework.ts` 46 行薄骨架是单消费方

playground 净增 7 行 boilerplate 而非减少。应改成 interface 而不是 class。**修法**：转 interface，移除 class subclass。

### P0-3 (architect)：`mission-app-conformance.spec.ts` config-snapshot 断言是假断言

三家函数名各不同（`buildForFreshRun` / `buildRadarConfigSnapshot` / `buildSocialConfigSnapshot`）。spec 锁的是 string regex，不是 framework-level contract。**修法**：要么 framework 强制统一函数签名，要么 spec 写成 "存在 `*ConfigSnapshot` 函数" 不锁名称。

### P0-4 (architect)：facade contract spec 漏扫 `mission/agents` / `mission/roles` / `mission/services` / `api/`

只查了 `mission/pipeline` + `mission/lifecycle`。**修法**：扩 `DIRS_TO_SCAN`，加 `agents` / `roles` / `services` / `api`。

---

## 🟡 P1 必修项（合计 5 项）

### P1-1 (arch-auditor)：`mission-runtime-shell.interface.ts:18` 违反 PR-E0 规则

`abstractions/mission-runtime-shell.interface.ts:15-18` 用 `import type { BillingRuntimeEnvAdapter, MissionBudgetPool } from "@/modules/ai-harness/facade"`，触发 `ai-harness` 内部反向 import facade barrel。虽然 `import type` 无运行时循环风险，但违反 ESLint 规则。

**修法**：直接 source path：

```ts
import type { BillingRuntimeEnvAdapter } from "@/modules/ai-harness/guardrails/billing/billing-adapter";
import type { MissionBudgetPool } from "@/modules/ai-harness/guardrails/budget/mission-budget-pool";
```

### P1-2 (arch-auditor + reviewer)：`agent-team-facade-contract.spec.ts` 漏扫 `mission/rerun/`

`mission/rerun/` 6 文件 / 741 LOC dispatcher 无 jest facade 覆盖，仅 ESLint 兜底。

**修法**：加 `rerun` 到 `DIRS_TO_SCAN`。

### P1-3 (reviewer)：`agent-team-facade-contract.spec.ts:147` lifecycle block 早返回 = 空断言

lifecycle 目录不存在时直接 `return`，jest 看不到任何 `it()` 注册。应该和 pipeline block 一样有 `files.length > 0` 保底断言。

### P1-4 (reviewer)：`detectHarnessInternalImport` 正则要求 `modules/` 字面段

纯相对路径（`../../../../ai-harness/...`）跳过 `modules/` 段不被匹配。当前生产代码没这种写法但是结构漏洞。

**修法**：regex 允许 `(?:modules/)?ai-harness/...`。

### P1-5 (architect)：framework hook 多态点没匹配所有消费方

`BusinessTeamMissionDispatcherFramework.bridgeOrchestratorStageEvent` 假定三分事件（`stage:lifecycle` / `stalled` / `degraded`），但 radar 用单一 `RUN_STAGE` 事件，被迫绕开 framework hook 直接写。consumer-vs-framework 接口的多态匹配不全。

---

## 🟢 P2 改进项（合计 6 项）

- (architect) §8.2 runtime/ 在三家含义不一致：playground/radar 是 thin config + adapter，social 塞了 `mcp-client.service.ts` / `publish-queue.service.ts` 等 stateful service。layout spec 只查"目录必须存在"，没查"内容性质"
- (arch-auditor) `social/mission/services/ai-social.service.ts` **1608 LOC** + `agent-playground/mission/pipeline/stages/s3-researcher-collect-findings.stage.ts` **1024 LOC** 都接近 god-class
- (arch-auditor) layout spec 应加 `expect(ALLOWED_TOP_DIRS.size).toBe(7)` 防白名单被悄悄扩展
- (reviewer) `listDirEntries` / `listTsFiles` 无 JSDoc
- (reviewer) `runtime/` 现在有 3 个 config 文件没 README 说明区分（playground.config = pipeline manifest；playground-runtime.config = 运行时配置；playground-tuning-profile = 调档）
- (reviewer) commit `80822389c` 没说明根因防回归 —— `--changedSince` 不跟踪 import 路径有效性，应规定 spec 用 `@/` 绝对路径

---

## ✅ 安全侧（无 Critical / High）

- 9 个 radar controller 全部保留类级别 `@UseGuards(JwtAuthGuard)`，目录重组未引入路由暴露
- `playground.config.ts` 的 `path.resolve(__dirname, "..", "mission", "agents")` 无 path traversal 风险（参数全是内部字面量）
- 24 个 `export type` 修复对 `instanceof` 检查无影响（TypeScript 编译期已校验）
- 唯一 Medium 是 radar collectors 已知的 SSRF DNS rebinding + redirect:follow，非本次新增，代码注释已承认
- 文档缺口：`standards/23` 没有"新 agent team app 必须实现的安全控制"章节

---

## 推荐处理顺序

1. **立即修文档不一致**（P0-1）—— roadmap + blueprint Status 与 git 现实背离，必须先纠正
2. **本迭代修 P1**（P1-1 ~ P1-5）—— 都是小改动，闭环看护栏
3. **下迭代 P0-2 ~ P0-4 + P2**：framework 设计层面调整，需要给出回滚 vs 修补的判断
4. **standards/23 补安全控制章节**（security 提议）—— 借机加上

---

## 单独文件位置

- [architect.md](./architect.md) — 505 行系统架构师视角
- [arch-auditor.md](./arch-auditor.md) — 8 维度审计 9.1/10
- [reviewer.md](./reviewer.md) — 7 维度代码审查 8.0/10
- [security-auditor.md](./security-auditor.md) — 7 维度安全审计 0C/0H/2M
