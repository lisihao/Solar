# Mission Runtime 契约单一真源 — Harness 平台层系统设计（权威）

**日期**: 2026-05-22
**作者**: Claude Code（综合 Codex 平台层诊断 + 本会话运行时实证 + Radar/Social 跨 app 勘探）
**状态**: **✅ 已基线（baselined for implementation，2026-05-22）** —— 经 6 轮 Codex + 4 路内部 panel 评审收敛，作为重构的权威基线。后续按 §0.6 G1 波次实施；§0.5/§0.6 修订决议优先级最高。**实施期任何与本基线冲突的散落实现 = 待迁移技术债。**
**适用范围**: 全部 mission 型 AI app — **agent-playground / AI Radar / AI Social**，以及未来任何跑在同一 harness 上的 mission app（writing / report / …）
**定位**: 本文件是 **mission runtime 平台语义的单一真源（single source of truth）**。任何 mission app 涉及"配置 / 预算 / 时间 / 状态 / 失败 / abort / rerun / 存活"的实现，以本文件契约为准；与本文件冲突的散落实现一律视为待迁移的技术债。

---

## 0. 一句话

把 **mission 的真实配置、真实预算、真实时间、真实状态、真实失败原因、真实 abort 语义、rerun 真输入、存活回收** 从"每个 app 各自发明 + 多处投影"收口为 **ai-harness 平台层的类型化 canonical 契约**，并建立**多层看护机制**强制所有 mission app 消费同一套契约——使系统**结构上不可腐朽**，而非靠人自觉。app 只声明业务语义（depth 档位 / style / leader 业务态 / UI）。

---

## 0.5 五路集体评审共识与 v2 修订决议（2026-05-22）

> 设计阶段经 5 路并行评审（architect / migration-reviewer / red-team / harness-fact-check / Codex）。结论一致：**方向对（这是 harness contract 缺口，不是 playground 局部 bug），但 v1 有若干"换皮保留多源 / 固化错误 / 看护可绕"的硬伤，不补则落地后 canonical 体系仍能被 app 绕开。** 以下为采纳的修订决议，**优先级高于下文 v1 正文与之冲突处**。

### R-BLOCKER（必须先解决，否则不实施）

**RB1. 先收口"终态写权限"（单一 terminal-transition owner）——提为 P0 前置项。**
v1 致命缺陷（Codex#1 + red-team M4 + architect）：MissionFailure 由 dispatcher 写、liveness-guard 兜底写、AbortReason 由 controller/stage/framework 多处产生，而"谁有权把 mission 从 running 推到 terminal"直到 C7/P2 才提 lifecycle-manager。→ P0 上线后只是把"多源 message"升级成"多源 canonical code"，**核心承诺不成立**。
**修订**：P0 第一步 = `MissionLifecycleManager` 成为**唯一终态写入口**；所有 dispatcher/liveness/abort 只能**提交终态意图**给它，由它用 **DB 条件写**（`UPDATE … WHERE status='running' AND failure_code IS NULL`）做原子仲裁（首个写入者赢，后续 no-op）。先有单写 owner，再谈 canonical enum，否则枚举也照样竞争。

**RB2. 不要把 `CREDITS_TO_USD=0.002` 当"单一真源"——它是已被代码证明错误的假设。**
red-team B1 + architect M1：真实成本是逐模型的 `ai-engine/llm/pricing/model-pricing.registry.ts`（从 DB 逐模型单价），而 cap 用平的 `×0.002`；跑 Opus vs Haiku 同 credits 真实 USD 差 10×。v1 要把 0.002 封进 harness 唯一常量 + L3 grep 禁任何其它换算 = **用看护机制锁死错误并禁止修正**（SoT 最危险失败模式）。
**修订**：(a) `maxCostUsd` cap 明确改名/标注为 **`creditBudgetProxyUsd`（额度代理值，非真实成本）**，文档与字段注释都写明"这是 credits 的粗略闸，真实成本以 `ModelPricingRegistry`/`BudgetAccountant` 为准"；(b) **不 grep 禁 pricing 路径**；(c) C3 拆成 C3a 平台换算（credits→tokens，平台额度语义）+ C3b 真实成本（复用 ai-infra pricing 单一源，与既有 `no-hardcoded-pricing.spec.ts` 对账，不另立）。

**RB3. conformance 必须"harness 不认识 app 名"——否则撞既有红线 R0-A5。**
architect B1：`layer-boundaries.spec.ts:600-712` 禁 harness 文件（含注释）出现 `playground/social/radar` 等业务名。v1 的 `assertMissionAppConformance(appModule)` 若让 harness 枚举每个 app → 立即红。
**修订**：app **自报 namespace 字符串**注册；harness 启动期只断言"已注册集合非空 + 每个注册项满足接口/注册了 liveness/cancel 接线"，**不硬列 app 名**。conformance 是"对任意注册项的不变量",非"对具体 app 的清单"。

**RB4. 裁决 harness 内已存在的第二套 heartbeat/ownership——否则是"又加一层"非"消除多源"。**
architect B2 + fact-check：harness 已有 (a) `MissionLivenessGuard`+DB 心跳（per-app 注册）与 (b) `MissionRuntimeStateStore` Redis 心跳（`podId/startedAt`/TTL90s）两套；`MissionOwnershipRegistry` 也已是一等公民却不在 v1 契约集。
**修订**：契约集**增 ownership 域**；明确裁决 DB 心跳 vs Redis 心跳谁权威谁退场（建议 Redis 作活性探测、DB 作回收依据，二选一写死职责），写进 §4。

**RB5. `MissionConfigSnapshot.businessInput` 不能是 opaque blob——否则 row+JSON 多源换成 snapshot 内部多源。**
Codex#2：opaque blob 下 app 仍可漏字段/改名/在 rebuilder 暗自 fallback，平台无法做 completeness 校验与 schema 迁移守护。
**修订**：snapshot 的序列化/反序列化升为 **adapter 显式 schema 契约**（app 声明 `businessInputSchema`(zod) + serialize/deserialize），harness 据此做完整性校验 + 版本迁移；businessInput 不再是无类型 blob。

**RB6. social 真停必须解决 S8 半发布原子性——否则产生不可撤销外部副作用。**
migration BLOCKER-3：`s8-publish-execute` 是唯一外部副作用 stage（微信草稿 API 无删除接口）；cancel 在 S8 进行中触发 → 半发布、平台后台残留。
**修订**：abort 采 **gate-before-stage** —— S8 一旦进入即不可中途 abort（signal 在 S8 入口检查：未进入则拒绝进入，已进入则等其完成再落 cancelled）；§11 测试矩阵增"cancel 发生在 S8 前/中"两分支。

**RB7. DB 迁移＝一次性回填 + 原地切换（★ 用户硬约束 2026-05-22：没有双写，也不接受双写）。**
migration BLOCKER-4 原提议双写 + feature flag，**已被用户否决**。无双写=无并行值=无"读优先/回退"歧义，也更贴合"单一源杜绝漂移"。
**修订（替代原双写方案）**：每个 DB 字段迁移在**一个迁移脚本内**完成「加新列 → 一次性回填存量 → 切换所有读写到新列 → 同脚本重命名/删旧列」，**不保留旧列、不写两份**。回滚靠 git revert + 反向迁移脚本（迁移前备份），不靠运行期 flag。代码与迁移**同一 PR 原子上线**，杜绝"接口已变、消费方未迁"窗口。

### R-MAJOR（采纳，调整设计）

- **RM1 看护重心从 grep 移到类型（make illegal states unrepresentable）。** red-team M2/M5 + Codex#4：grep 禁字面量可被等价改写平凡绕过（`const r=0.002`、`x*2/1000`、别名 enum），且 `wallTimeMs` 全仓 297 处/40 文件含 harness 自身 → 全仓禁令必逼出大量白名单 → 守护失效。**修订**：L1 为主——`ResolvedBudgetCaps` 私有构造+只能由工厂产出+readonly（别处拿不到原料散落）；abort 签名收 enum（传字符串 tsc 红）；snapshot 工厂。L3 grep **降级**为"仅扫 budget 目录 + 白名单 + 仅对新增代码 + 带 deadline"，不全仓即时封死。L4 ESLint 全仓 rule 取消（误伤大）。
- **RM2 conformance 分"静态可验" vs "需集成测试"。** red-team M3 + migration MINOR-2：静态只能查存在性（且 social 假停恰是"abort 出现在错的地方"→ 静态会误判合格）。**修订**：liveness 注册=静态可验（保留）；cancel 真停 / 失败写 canonical = **集成测试**（发 mission→cancel→断言 budget 停增/signal.aborted），写进 §11。
- **RM3 C9 落点纠正（保持 app 层）。** architect B3：`STAGE_NUMBER_CONTRACTS` registry 在 app 层是**正确**的（哪个 stage 约束哪个值是 app 业务，上提违反 R0-A5）；只有 primitive `assertNumberProducerWithinSchema` 在 harness。**修订**：§4.9/§5 改为"primitive 在 harness、registry 各 app 自持"，删"radar/social 登记进 harness 注册表"的错误表述。
- **RM4 ConfigSnapshot patch 语义裁决。** red-team M6："冻结+只读"与 rerun `patch?` 冲突。**修订**：rerun 带 patch → **生成新 snapshot（schemaVersion/parentSnapshotId 链）**，不就地改；run/rerun 各自只读"自己那次"的 snapshot。
- **RM5 C2 必须含 agent-level→mission-level 映射表 + 穷尽测试。** architect M3：已有 `failure-extraction.utils.ts` 大写 string code；C2 小写 enum。**修订**：映射表作为 C2 一部分 + "任何新增 agentCode 未映射即红"测试；`FailureCategory/Source` 若无消费场景则砍到 `code+message`。
- **RM6 C7 牵动 `IMissionStore` 端口（completed≠succeeded），blast radius 重估。** architect M5 + fact-check：**修订**：不改 `status` 字面量（保 `completed`），只**新增 `terminalOutcome` 层**，降风险。
- **RM7 social 缺 heartbeat 列。** fact-check A3：social_missions 无 `heartbeatAt` 列。**修订**：C8 对 social 需"先加列再注册 adapter"。
- **RM8 config_snapshot 依赖统一 `MissionRecord<T>`。** fact-check A6 + migration MAJOR-2：三 app store 现返回各自 Prisma 类型。**修订**：C5 前置"统一 MissionRecord 契约"，否则 snapshot 无处安放。
- **RM9 迁移期"双语义窗口"风险（Codex#3）。** v1 先改 C3/C4 字段+协议、P1 才上 Rebuilder，却让 legacy rebuilder 跨整个波次存活读新字段。**修订**：C6 Rebuilder（统一重建入口）**与 C4/C5 同波次或先行**，避免旧重建逻辑读新字段 fallback 错误；缩短双语义并存窗口。
- **RM10 补平台语义路线图：** idempotency（启动/rerun 幂等键防 double-spend）、mission lifecycle **event payload canonical schema**（现 `payload: unknown`）、`rerun-lock` 并发契约归位（architect M6）——至少进 P2/P3 路线图。BYOK/计费明确"归 ai-infra，不另立"。

### R-战略（最重要的一条，决定要不要现在做这件大事）

**RS1. 把"真缺陷修复"从"平台契约收口"里拆出来，前者立即做、后者评审后分波次。**
red-team B2 + Codex 简评一致：整套 9 契约 + 七层看护 + 3 app + DB 迁移，与本会话**真正让你抓狂的"报告质量差(minFindings/章节)"完全正交**（§12 明确划在范围外）。而真正高价值且**立即可做、零新抽象、零 DB 迁移**的只有两个现成缺陷修复：

1. **radar/social 注册 liveness adapter**（各加 ~1 处 `registerAdapter`，guard 现成）——治"孤儿 running 行永不回收"。
2. **social cancel 真停**（`cancelTask` 加 `abortRegistry.abort(id)` + dispatcher `abortMission`，registry 现成）——治"取消后继续烧预算"。
   **决议**：这两项作为**独立 hotfix（P0-now）立即修**，不等平台重构；C2–C7 的契约/枚举/值对象/迁移作为**平台收口（P0-platform 起）**评审通过后分波次。避免用宏大重构挤占并拖延两个一行级真修复。

---

## 0.6 治理模型 / 权力边界（v3，Codex 第二轮评审）

> 第二轮共识：**对象模型（该收口什么）已清楚，治理模型（谁有最终写权 / 谁能改 snapshot / 谁能 patch / 谁验证接入语义）还不够硬。** 不补这些"权力边界"，最终会得到"canonical 类型都在、adapter 都接了，但业务层仍能绕开/覆盖/补丁化平台语义"——看起来平台化、实际仍脆弱。以下 6 条治理决议**优先级最高**，是 §4 对象契约能否真生效的前提。

**G1. 终态状态机（写权 + 最小值域）提到 P0 最前，先于 C1/C2/C8。**（Codex#1）
v2 把 C7 放 P2，但 C2 failure / C8 liveness / C1 abort 的正确性都依赖"终态推进语义已统一"。底层仍是各 app 状态机时，P0 只能"附加 canonical 字段"，做不到单一真源——产出"failure_code 对、status 仍各写各"的**伪收敛**。
**决议**：P0 第 0 步 = 定义平台**最小 `MissionLifecycleStatus` 值域** + **唯一终态写入口**（`MissionLifecycleManager`，承接 RB1 的 DB 条件写仲裁）。**先有"谁能写终态 + 终态值域"，再上 C1/C2/C8**。C7 的"三层状态"其余部分（presentation 聚合）可留 P2，但"终态写权 + 最小值域"必须 P0 前置。

**G2. Snapshot 写路径治理：任何影响 rerun 的配置改动都必须重写 versioned snapshot。**（Codex#2）
v2 只管住"读路径"（run/rerun/resume/hydrate 读 snapshot），没管"写路径"。terminal 后 PATCH budget / 用户改 rerun 参数 / app retry patch / controller override 若只改 row/JSON 不改 snapshot → rebuilder 读到旧 snapshot。
**决议**：立 **versioned mutation contract** —— snapshot 只能由 `openSession()` 与少数**显式声明的 mutation 入口**产出/更新；**任何改动 rerun 相关配置的路径必须生成新 versioned snapshot（snapshotRevision++ / parentSnapshotId 链；schemaVersion 仅结构升级时才动，见 C5 r6 决议），禁止旁路改 row/JSON 而不改 snapshot**。看护：arch 断言"mission 配置字段的写入只允许发生在 snapshot 工厂内"。

**G3. Rebuilder `patch` 必须是 canonical patch schema，不得 app 自由扩展。**（Codex#3）
v2 的 `buildForXxx(snapshot, patch?)` 没定义 patch 约束 → app 各自扩 patch 语义 → "平台 builder 一套 + 业务层再套一层" 双主脑。
**决议**：定义 **`MissionInputPatch` canonical schema**（白名单：哪些字段可 patch、哪些必须走 app 业务层）；**应用顺序钉死**：`snapshot → apply canonical patch → policy re-resolve（budget/limits 重解析）`，不允许 "snapshot-resolved → patch-final" 的旁路。patch 越权字段 → 编译期/校验期红。

**G4. 两级 conformance：wiring（静态）+ behavioral（集成语义）。**（Codex#4）
v2 的 L5 只是"接线检查"（实现 adapter / 注册 liveness / 调了 abort / 写了 failure），挡不住"接了但语义错"（abort reason 乱传、rebuilder patch 越权、heartbeat 刷新点不对、failure category 瞎映射）。
**决议**：L5 拆两级。**L5a wiring conformance（静态）**：注册存在性（治漏注册，保留）。**L5b behavioral conformance（集成测试套件）**：发真 mission → cancel → 断言 signal.aborted + budget 停增 + 终态=cancelled + reason 正确；rerun → 断言 patch 不越权 + 重解析正确；制造预算耗尽 → 断言 failureCode/category/source 映射正确；制造静默 → 断言 liveness 回收。**无 L5b 的接入视为未接入**。

**G5. Rollout 隔离：harness canonical 一次到位，三 app 在同一 PR 链内逐个真实切换（★ 用户硬约束：无双写、无 flag、无 legacy 并行）。**（Codex#5，按用户决议改写）
v2 原提议"per-app adapter version + canonical-read flag + legacy 并行一波次"——**已被用户否决（不接受双写/并行）**。
**决议（替代）**：(a) harness 只提供 canonical（**不留 legacy adapter**）；(b) **隔离靠 worktree + 测试**而非 flag——每 app 切换在独立提交、独立验证全量绿后再合；(c) C3/C4 这类平台级共享命名/单位的改动，harness 与三 app 的切换**在同一波次/同一 PR 链内连续完成**，不跨波次留半切状态。代价（无 flag 即时回滚）由 §11 测试矩阵 + G11 深度检视兜底。

**G6. 平台 terminal outcome 只保 {success, failure, cancelled}——`quality_rejected` 移出平台 enum。**（Codex#6）
v2 把 `quality_rejected` 放进 `MissionTerminalOutcome` 平台 enum,但有些 app 根本没有"质量拒绝"这个终态(或它是业务 gate/retry state 而非 terminal)。平台内建它 = 又把业务模型预设进平台。
**决议**：`MissionTerminalOutcome = { success, failure, cancelled }`(纯平台);`leader_signoff_rejected` 这类**留在 `failureCode` / app 级 `businessOutcomeCode`**。平台 enum 不再吸入任何业务语义。

### 治理模型一句话

**对象模型解决"收口什么",治理模型解决"谁有权改它"。** 没有 G1–G6 的权力边界,§4 的 9 个 canonical 对象会变成"类型都在、却人人能绕"的漂亮空壳。因此实施次序硬性规定:**G1(终态写权)→ G2(snapshot 写治理)→ G3(patch schema)→ 再上对象契约 C1–C8 → G4(behavioral conformance)贯穿 → G5(rollout 隔离)护航**。

---

## 0.7 实施进度回填（live status，随实施更新）

> 实施于 2026-05-22 起,无双写·真实切换,每组 tsc+测试+verify:arch 验证后合并主干。

| 契约/组                                        | 状态          | PR                   | 说明                                                                                                                                                                                                                  |
| ---------------------------------------------- | ------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 策略:无双写·真实切换                           | ✅            | #133                 | 覆盖 RB7/G5 渐进策略(用户硬约束)                                                                                                                                                                                      |
| **G0** radar/social liveness 注册              | ✅            | #134 #135            | 治孤儿 running 行永不回收(C8 注册部分)                                                                                                                                                                                |
| **G0** social cancel 真停                      | ✅            | #136                 | 治取消假停烧预算 + S8 gate-before-stage(RB6)                                                                                                                                                                          |
| **C0** 终态写权(finalize 单写+条件写仲裁)      | ✅            | #137 #138            | 三方竞争测试 + 三 app 终态写条件化(首写赢)                                                                                                                                                                            |
| **C1** MissionAbortReason enum                 | ✅            | #139                 | abort-registry 改签名 + 全调用方切换                                                                                                                                                                                  |
| **C2** MissionFailure 契约 + 三表 failure_code | ✅            | #140 #141 #142       | code/category 投影 + 删 social/radar 正则 + 落库                                                                                                                                                                      |
| **C3a** ResolvedBudgetCaps + 换算收口          | ✅            | #143 #144            | 私有构造工厂 + 删散落 ×1000/×0.002                                                                                                                                                                                    |
| **C4** wallTime 拆 cap/elapsed(三表)           | ✅            | #145 #146 #147 #148  | 类型契约 + radar cap/social+playground elapsed 改名                                                                                                                                                                   |
| **C8** conformance 套件(L5a/L5b)               | ✅            | (本 PR)+#137/154/158 | L5a 静态:mission-app-conformance spec(每 mission app 必注册 liveness,防孤儿);L5b 行为:三方竞争(#137)+三 app cancel 真停/失败 canonical(#154/158)集成测试                                                              |
| **C5** MissionConfigSnapshot                   | ✅ 三 app     | #150 #160-162 #167   | harness 契约 + **三 app 统一**:playground 完整闭环(冻结/只读/改预算派生 G2/无 fallback/userProfile 双写消除);radar/social 也 openSession 冻结+暴露(#167,fresh-only,无 rerun-rebuild 变体);conformance 强制每 app 冻结 |
| **C6** MissionInputPatch + InputRebuilder      | ✅ playground | #150 #160-162        | harness 契约 + PlaygroundMissionInputRebuilder(full/incremental/local/settings_patch 经 applyInputPatch 派生);radar/social 待接入                                                                                     |
| **C5/C6 接入看护**                             | ✅            | (本 PR)              | c5-c6-snapshot-contract spec:rerun 读 snapshot 不读 userProfile + 改预算必派生(防回退)                                                                                                                                |
| **C7** MissionTerminalOutcome + presentation   | ◐ harness     | #150                 | outcome(去 quality_rejected)+ toTerminalOutcome 已合;controller/前端接入待做                                                                                                                                          |
| **G10** 看护落地(L1/L3 arch spec)              | ◐             | #151                 | budget 目录扫换算 + category 投影断言已合(进 verify:arch);新代码禁裸 wallTimeMs 待做                                                                                                                                  |
| **G11** 深度检视 + 推理验证                    | ◐             | #152                 | 全量 5349 测试零回归;修 6 处真实切换缺口(见下);文档收尾中                                                                                                                                                             |

**G11 检视已修(#152,用户两轮实测 + 3 路审查)**:① radar+social 迁移顺序 BLOCKER(C4 改名脚本字典序早于建表/补列脚本,fresh replay 裸 RENAME 必失败 + 重造旧列)→ guarded rename + 建表只产新列;② C4 未切入核心 runtime 接口(MissionRuntimeSession/adapter/framework payload 仍传 wallTimeMs)→ 全切 wallTimeCapMs;③ MissionInputPatch 业务 patch 被擦成 unknown → 补 TBusinessPatch 泛型;④ local-rerun cost guard credits↔USD 单位错配 → 走 ResolvedBudgetCaps 同单位比;⑤ framework abort 裸字符串 → MissionAbortReason enum。

> **⚠️ 诚实落地缺口(G11 结论,勿当"已完成")**:**C5/C6/C7 目前是「契约类型 + 单测」,业务代码尚未消费**——`MissionConfigSnapshot`/`MissionInputRebuilder`/`applyInputPatch`/`MissionTerminalOutcome` 在 `ai-app` 主链路(run/rerun/resume/hydrate/terminal presentation)零消费点。平台收口在 harness 层成立,但**未真实切入主业务流**,违反"真实切换无多路"要求,记为 **#29 app 接入波次**(下一大块)。C8 conformance(#23)同理待做。
>
> **↑ 已部分超越(2026-05-22/23，见 §0.7「✅ 实施收口」+ §0.9)**:C5/C6 playground 已完整闭环消费、radar/social 已 openSession 冻结 snapshot；**C0 finalize 漏斗已全 app 真消费 + 看护焊死（§0.9）**。**仍待**:C7 `MissionTerminalOutcome` 的 controller/前端 presentation 接入（仍 ◐）；CI 盲区（test:quick 漏 ai-social/guardrails 路径，§0.8）。

**小尾(并入收尾)**:C3b 真实成本对账 ai-infra。

> **✅ 实施收口(2026-05-22,#133–165 共 37 PR,main 全程绿)**:全契约 C0–C8 + 治理 G0–G11 落地;
> C0–C4/C7 三 app 真消费;**C5/C6 playground 完整闭环**(config_snapshot openSession 冻结 / rerun
> 只读 / 改预算派生 G2 / **userProfile 双写消除·读时投影** / legacy 拒跑无 fallback);看护三件
> (G10 budget+category / c5-c6-snapshot-contract / mission-app-conformance)进 verify:arch。
> **radar/social C5 已统一接入(#167,用户决议覆盖 YAGNI)**:一致性优先于"按需"——三 app 都在
> openSession 冻结 typed config snapshot(canonical 配置记录),conformance 强制每 app 冻结。
> radar/social 因 rerun 不从 snapshot 重建输入,故只 buildForFreshRun(无 full/incremental/local
> 变体);未来若长出"从历史配置重跑"需求,补变体即可(契约现成)。三 app 统一,无特殊化。

> **已校正(2026-05-22,app 侧 review fix)**:radar `signal.aborted` 误判 cancelled(MAJOR-3,#154)、playground/liveness/孤儿 failureCode 未落库(MAJOR-4/6/MINOR-1,#155)、social StageAbortError 误判(MINOR-2,#156)、social 无 markCancelled 致取消显示失败 + failureCode 类型收紧(#158)——全部修复。

---

## 0.8 多路评审共识与 C5/C6 落地决议(2026-05-22,实现验收阶段)

> 28 PR(C0–C4/C7 + G10 + 全部 app 侧 review fix)落地后,经 **4 路并行评审(架构 / 代码 / 工程看护 / 流程)** 对"已落地是否扎实 + C5/C6 怎么接入主链路"形成共识。结论:**harness 契约层扎实(L1 防线有效)**,问题集中在 app 侧接入与 CI 盲区。以下决议是 C5/C6 落地的权威依据。

### 评审发现(已修 / 待办)

- ✅ 已修:见上"已校正"。
- ⏳ **C4-BLOCKER-1(C5 前置)**:C4 改名未切进 DTO 层——`RunMissionInput.wallTimeMs` / `DEPTH_BUDGET_TIERS.wallTimeMs` / `resolveMissionWallTimeMs` / `mission-rerun-orchestrator` 写回 / `event-schemas` 仍旧名。C5 前必须把业务入口层 cap 字段对齐 `wallTimeCapMs`,否则 rebuilder 要内化一层 `wallTimeMs→wallTimeCapMs` 适配=改名被适配器化。
- ⏳ **RM8(C5 前置)**:`MissionRecord` 接口无 `configSnapshot` 槽位,C5 无处安放到平台契约。
- ✅ **C0 finalize 漏斗收口(2026-05-22/23 完成，原 MAJOR 已闭合)**:social + playground（含 s11-persist）+ radar 终态写**全部**经 `MissionLifecycleManager.finalize → arbiter.applyTerminalIfRunning` 单入口（条件写首写赢）；调用图核实 app 已无任何直调 store 终态写（markCompleted/markFailed/markCancelled/markFailedByLiveness）或直调 arbiter 的旁路点。social dispatcher 外层 catch（原只 emit 留 running）亦经 finalize 写终态（failureCode=runtime_crashed，取代 ad-hoc DISPATCHER_THREW）。机制看护：`mission-contract-guards.spec` 的「C0 终态写收口看护」（禁旧路径 + finalize 真用 × 3 app，baseline=0 焊死，进 verify:arch）。详见 §0.9。
- ✅ **CI 盲区(已澄清，2026-05-23)**:复核确认实际**已被覆盖**——CI(`.github/workflows/ci.yml`)有两步:`test:quick`(快速预检，排除 guardrails/ai-social 等慢/重测试)**与** `test:ci --coverage`(= `backend npm test` = **完整 jest 无 ignore**)。guardrails/C3a 换算不变量 spec、ai-social 契约 spec 在**全量 `test:ci` 步真跑**;C0 收口看护/预算换算守护/conformance 也在 `verify:arch`(pre-push)。`test:quick` 的排除只影响"快速预检"那一步，全量步兜底。结论:不动 `test:quick`(盲目移除排除项会让快速预检变慢/引入 wechat/browser 类 flaky)，原 ⏳ 担忧基本过期。

### C5/C6 接入设计共识(4 路敲定)

1. **snapshot.businessInput = 业务子集**(`depth`/style/length/audience/figures/auditLayers/concurrency 等);`topic`/`language`/`budget: ResolvedBudgetCaps`/`runtimeLimits` 放 snapshot 顶层。**禁**把整个 `RunMissionInput` 塞进 businessInput(否则 maxCredits/wallTimeMs 双份 = RB5 内部多源)。
2. **存量回填 = 一次性代码脚本走 `ResolvedBudgetCaps.resolve()`**(ts-node migration helper,非 Nest 启动批量);**SQL 内零硬编码换算**(禁 `×1000`/`×0.002`,违反 C3a)。重建不了的历史行标 `schemaVersion=legacy` **只读不可 rerun,不做 fallback 双读**。迁移后断言 `config_snapshot IS NULL AND schemaVersion!='legacy'` 计数 = 0。
3. **节奏**:**playground 单 app 先闭环跑稳**(验证契约够用)→ 再以模板推 radar / social。C5/C6 无跨 app 共享列,**不受 G5 三 app 同波次约束**(C3a/C4 那种平台级共享命名才受)。
4. **C6 = 新建 pure `PlaygroundMissionInputRebuilder implements MissionInputRebuilder`**(只依赖 budget 解析,复用 harness `applyInputPatch`);**不重写** `rerun-runtime-builder`,但改其 budget 来源从"解析 RunMissionInput"→"读 `snapshot.budget`"。`ctx-hydrator` / `cloneInputFromMission` 切读 snapshot 后**删旧 userProfile 重拼**(不留双路径)。
5. **拆 4 步 PR(每步独立强成功标准)**:S1 schema 迁移+回填(残留断言=0)→ S2 openSession 写 snapshot(影子写,旧字段仍唯一真源)→ S3 run/rerun/resume/hydrate 切读 snapshot → S4 删旧重拼路径(grep 旧函数 0 调用方)。S2 影子写若用户不接受则 S2+S3 原子合。
6. **补看护**:`c5-c6-app-contract.spec`(rerun 必经 `deriveChildSnapshot`、禁 `snapshot||userProfile` 双读)+ 回填脚本零硬编码换算 spec + 把 C3a/social 契约 spec 拉进 CI 闸。

---

## 0.9 C0 finalize 漏斗收口（2026-05-22/23，闭合 §0.8 MAJOR）

> 背景：§0.8 评审定级 MAJOR——`finalize`/arbiter 已定义，但 app 仍**直调 store 终态写**（条件写已在各 store、首写赢成立，但中央漏斗 `finalize` 未真用）。本轮把三 app 终态写**全部**收口经 finalize，并加机制看护焊死。**这是「真切换」非「抽象建好」——以调用图为证，非测试绿。**

**真实切换（调用图核实：app 生产代码 0 个 `.markX(` / `.applyTerminalIfRunning(` 旁路点）：**

| App              | 终态来源 → 全部经 `finalize → arbiter.applyTerminalIfRunning`                                                                                                                       | 备注                                                                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| social           | dispatcher 完成/取消/orchestrator-失败 + **dispatcher 外层 catch（抛错）** + liveness 回收                                                                                          | `markFailedByLiveness` 删除并入 arbiter；外层 catch 由「只 emit 留 running」改为 finalize 写终态（`runtime_crashed`）                                                                                                     |
| agent-playground | dispatcher `handleMissionFailure` + controller cancel + rerun-guard zombie + local-rerun cascade-abort + stage-rerun s11 handler + **s11-mission-persist（5 终态分支）** + liveness | `markCompleted/markFailed/markCancelled` public delegate 删除→helper 私有 `writeX`（返回 boolean）；s11 经 `lifecycleManager`（plumb 进 `CommonDeps`）；同步删 `userProfile` 列写回（S4，列已 read-never，保留列不 drop） |
| AI Radar         | 此前已切（终态写经 finalize 单入口仲裁）                                                                                                                                            | 本轮纳入看护覆盖                                                                                                                                                                                                          |

**机制看护（防回潮，进 `verify:arch`）**：`backend/src/__tests__/architecture/mission-contract-guards.spec.ts`「C0 终态写收口看护」对 playground/social/radar 各断言三条（grep 级、跳注释行）：① 禁直调 store 旧终态写；② 禁直调 arbiter `applyTerminalIfRunning`（须经 finalize）；③ `finalize` 中央漏斗真被使用（防整体退回旧路径而前两条仍为 0）。**baseline=0 焊死**，新增旁路即红、合不进主干。

**仍待（不埋）**：C7 `MissionTerminalOutcome` 的 controller/前端 presentation 接入仍 ◐；CI 盲区（`test:quick` 的 `testPathIgnorePatterns` 漏 `ai-social`/`guardrails`，§0.8）未解。

---

## 1. 背景、定级、范围

### 1.1 这是一类系统级病（不是单点 bug）

同一运行时语义在"生产方 / 消费方 / 持久化 / 前端 / 跨 app"各定义一份 → 漂移。已实证实例（见 §2 全景表）：

- 预算换算 `×1000 / ×0.002` 数学只在 harness framework 一处，但 3 个 app 又各自发明了**第二套估算**（playground 400K token 基线 / social `0.05×平台` USD / radar 静态 50）→ 单位与口径漂移，local rerun guard 甚至把 credits 当 USD 比。
- wall-time：`wallTimeMs` 字段在 **social 表=实测耗时**、**radar 表=配置上限**——**跨 app 同名异义**；playground 同表内 cap/elapsed 也曾混。
- 失败原因：真因 `budget_exhausted` 被层层改写成 `cancelled` 再成"失联/pod 重启"；social 自己 inline 4 个 failureCode **却不落库**；radar 纯 message 正则。
- abort：`MissionAbortRegistry.abort(id, reason?: string)` 裸字符串；**social 的"取消"根本不调 abort，正在跑的 mission 不真停，继续烧预算**（功能缺陷，非仅风格）。
- 配置快照：input → row+JSON → rerun 重拼 → hydrate 重拼 → 前端再拼（playground 5 处）；social retry 从 task 表重拼；radar 用 payload blob。
- 存活回收：**radar / social 都建了 `heartbeatAt/podId` 列和 `[status,heartbeatAt]` 索引，却都没注册 liveness adapter** → 心跳写了没人扫 → 孤儿 `running` 行永不回收（radar store JSDoc 甚至虚假宣称"Liveness guard 扫描"）。

> 只要 writing / radar / social / report 等都跑在同一 harness 上，这些坑必然复现。**这是平台 contract 缺口，必须在 harness 收口。**

### 1.2 关键前提：harness 平台层"半成品已在"，三 app 已复用框架

设计**不是从零建地基**：

| 已存在（harness）                                                                                       | 文件                                                                          | 三 app 复用情况                                     |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------- |
| `MissionRuntimeShellFramework`（lifecycle runtime：wallTimer/heartbeat/abort/cleanup + 建 budget pool） | `ai-harness/teams/business-team/lifecycle/mission-runtime-shell.framework.ts` | **playground / radar / social 全部经 adapter 复用** |
| `MissionBudgetPool`（`maxTokens=credits×1000`、`maxCostUsd=credits×0.002`）                             | `ai-harness/guardrails/budget/mission-budget-pool.ts`                         | 三者全用（池机制）；但**估算/换算各写一套**         |
| `MissionAbortRegistry`                                                                                  | `ai-harness/lifecycle/mission-lifecycle/abort-registry.ts`                    | reason=裸字符串；radar 真接、**social 不接**        |
| `MissionLivenessGuard`（孤儿回收）                                                                      | `ai-harness/lifecycle/mission-lifecycle/mission-liveness-guard.service.ts`    | **仅 playground 注册 adapter**；radar/social 漏注册 |
| `mission-store.interface` / lifecycle-manager / runtime-state-store / rerun primitive                   | `ai-harness/lifecycle/mission-lifecycle/*`                                    | rerun primitive **三 app 都没用**                   |

**核心判断**：adapter 模式是对的。缺的是 **把 adapter 的输入输出做成类型化 canonical 契约**，并让 framework / pool / registry / guard 成为这些契约的唯一产出/消费点 + **强制每个 app 实现 adapter conformance**。P0 大多是"提升已有散落值为 canonical + 改消费方"，非 greenfield。

### 1.3 范围边界

- **本设计覆盖**：mission runtime 的 8 类平台契约（§4）+ 已落地的 stage-boundary 契约机制（§4.9）+ 看护机制（§7）。
- **本设计不覆盖**（留各 app 业务层，§12）：depth 档位名、budgetProfile 文案、style/audience/searchTimeRange、leader 签字业务解释、维度工具矩阵、章节/字数业务契约、页面交互。

---

## 2. 现状全景（跨 app 证据表）

> 来源：本会话 playground 实证 + Radar/Social 只读勘探（file:line 见各 app 适配清单 §6）。

| 契约域             | agent-playground                                             | AI Radar                                          | AI Social                              | 漂移程度                           |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------- | ---------------------------------- |
| Lifecycle 框架     | ✅ framework                                                 | ✅ framework                                      | ✅ framework                           | 低（已统一）                       |
| BudgetPool 机制    | ✅ pool                                                      | ✅ pool                                           | ✅ pool                                | 低（已统一）                       |
| **预算估算/换算**  | 400K token 基线 × mult                                       | 静态 50 / 10                                      | `0.05×平台×factor` USD                 | **高（三套）**                     |
| **status 值域**    | 5 态 + quality-failed + starting 占位                        | 5 态(running/completed/failed/cancelled/rejected) | 实写 3 态(注释写 4) + 并行 task 状态机 | **高（不一致）**                   |
| **failureCode**    | dispatcher 分类 + BUDGET_EXHAUSTED（本会话加，未 canonical） | 纯 message 正则                                   | inline 4 码**不落库**                  | **高（无 canonical）**             |
| **abort/cancel**   | 真停 + signal.reason 分类                                    | 真停（session.missionAbort）                      | **假停（不调 abort，不真停）**         | **高（功能缺陷）**                 |
| **wall-time 字段** | 注释澄清(本会话)                                             | `wallTimeMs`=上限 + `durationMs`=实测             | `wallTimeMs`=实测（与 radar 同名异义） | **高（二义+跨 app 冲突）**         |
| **配置快照**       | input→row+userProfile，5 处重拼                              | payload JSON blob + 启动时从 topic hydrate        | 类型化列 + retry 从 task 表重拼        | **高（无 canonical snapshot）**    |
| **rerun/resume**   | 完整子系统（自建，未用 harness primitive）                   | 业务重刷                                          | 重拼 DTO 全新跑                        | **高（都不用 harness primitive）** |
| **liveness 注册**  | ✅ 注册 adapter                                              | ❌ 漏注册（孤儿不回收）                           | ❌ 漏注册（孤儿不回收）                | **高（缺陷）**                     |

---

## 3. 分层原则

```
Harness 平台层（mission runtime 语义；所有 mission app 共享；强约束 + 看护）
  canonical 类型 + framework/pool/registry/guard 产出&消费它们
  ──────────────────────────────────────────────
        ▲ adapter（每 app 实现 + conformance 测试强制）
  ──────────────────────────────────────────────
ai-app 业务层（每 app 自己的业务语义；不上提）
  depth 档位 / budgetProfile 文案 / style / audience / searchTimeRange
  leader 签字业务解释 / 工具矩阵 / 章节字数契约 / UI 展示交互
```

**MECE 红线（看护机制强制，§7）**：

1. harness 不认识 `depth=quick|deep`，只接收解析后的 `ResolvedRuntimeLimits` / `ResolvedBudgetCaps`。
2. 任何地方禁止 `credits×0.002` / `credits×1000` / `×0.05` 等估算换算散落 —— 只能读 `ResolvedBudgetCaps` / 调 canonical estimator。
3. 歧义字段 `wallTimeMs` 全栈禁用；拆 `wallTimeCapMs`（上限）/ `elapsedWallTimeMs`（耗时）。
4. failure/abort 只认 canonical enum；app 仅可在"映射到平台终态"处扩展业务态。
5. 每个 mission app **必须**注册 liveness adapter + 实现 abort 真停 + 实现 rerun policy（缺一者 conformance 测试红）。

---

## 4. 完整 canonical 契约清单（平台单一真源）

> 9 类。每类给：**现状 → 目标 → 产出方 → 消费方 → 落点 → 红线**。命名/字段为建议，评审定稿。

### C1 `MissionAbortReason`（enum）— P0

- 现状：`abort(id, reason?: string)` 裸串；radar 传 `"user_cancelled"`，social 不传，playground dispatcher 字符串比对。
- 目标：`enum MissionAbortReason { user_cancelled, budget_exhausted, wall_time_exceeded, mission_row_missing, superseded, orchestrator_shutdown }`
- 产出：所有 abort 调用方（s\*预算 stage / framework wallTimer / controller cancel）传 enum。
- 消费：dispatcher 按 enum→终态映射；不再字符串 if。
- 落点：`abort-registry.ts` 改签名 `abort(id, reason: MissionAbortReason)`。
- 红线：禁止裸字符串 abort reason（看护 §7-L3）。

### C2 `MissionFailure`（failureCode + category + source，enum 组）— P0

- 现状：失败原因来自 abort reason / markFailed message / liveness 兜底 / 前端 banner / app 手拼；无 canonical；social inline 4 码不落库；radar 纯 message。harness 已有**agent 级** taxonomy（`tracing/observability/failure-extraction.utils.ts`）但未升 mission 级。
- 目标：
  ```ts
  enum MissionFailureCode {
    user_cancelled,
    budget_exhausted,
    wall_time_exceeded,
    mission_row_missing,
    leader_signoff_rejected,
    provider_error,
    runtime_crashed,
    unknown,
  }
  enum FailureCategory {
    cancellation,
    budget,
    time,
    quality,
    infra,
    provider,
    unknown,
  }
  interface MissionFailure {
    code: MissionFailureCode;
    // ★ Codex r5 决议：category 不是第二真源——由 code 经【单一映射 codeToCategory】派生（投影，非独立写）。
    //   具体消费方（回答了"谁消费、做什么决策"，故保留）：① 告警路由（budget/infra/provider 走不同
    //   告警通道与 SLO）② retry-eligibility（infra/provider→可自动重试；budget/quality/cancellation→不自动重试）。
    category: FailureCategory; // = codeToCategory(code)，禁独立赋值
    message: string; // human-readable，调试用
    source?: string; // ★ 决议：原 FailureSource enum 砍掉——无具名决策消费方。降级为可选自由文本(调试归因)，非契约枚举。
  }
  ```
- 产出：终态写入口（C0 `MissionLifecycleManager`）写 canonical；`category` 由 `codeToCategory(code)` 派生，调用方只传 `code`（+可选 source 文本）。liveness 仅在 code 尚空时兜底（C0 单写+条件写保证不覆盖）。
- 消费：DB 落 `failure_code`（权威事实源）；前端**永远优先**按 code 出文案；告警/retry 按 category。**不再落 source 列**（调试归因走日志）。
- **★ Codex r6 决议：`failure_category` 只是投影列，绝不是第二事实源。** 原则三条：① 它仅为查询/索引优化（报表按 category 聚合）；② 任意读路径**必须以 `failure_code` 为准**，必要时**实时重算** `codeToCategory(code)`，不信任存量列；③ 映射 `codeToCategory` 变更后，旧 `failure_category` 列**视为脏**，要么回填要么读时重算——禁止"派生列养成事实列"。看护：契约测试断言"任意行 `failure_category === codeToCategory(failure_code)`，否则红"。
- 落点：`ai-harness/lifecycle/mission-lifecycle/abstractions/mission-failure.ts`（新）；复用既有 agent 级 taxonomy 做映射。
- 红线：app 不得用裸 message 表达失败类别；liveness 不得覆盖已有 code。

### C3 `ResolvedBudgetCaps` + `MissionCostEstimator`（值对象 + 端口）— P0

- 现状：换算 `×1000/×0.002` 只在 framework；但 3 app 各发明估算（400K / 0.05×平台 / 静态）。
- 目标：
  ```ts
  interface ResolvedBudgetCaps {
    maxCredits;
    maxTokens;
    // ★ Codex r6 决议：canonical 字段名统一为 creditBudgetProxyUsd（额度代理值，非真实成本）。
    //   全文不再用 maxCostUsd 作 canonical 名——"maxCostUsd" 仅作 MissionBudgetPool 的 legacy
    //   wire/构造名保留(迁移期),内部 canonical 一律 creditBudgetProxyUsd。真实成本走 ai-infra。
    creditBudgetProxyUsd; // = maxCredits × CREDITS_TO_USD（粗略额度闸，非真实美元成本）
    budgetMultiplier;
    source: "default" | "override" | "inherited";
    resolvedAt: ISO;
  }
  // 唯一换算常量（仅平台额度语义；真实成本是逐模型 ModelPricingRegistry，不在此）
  const CREDITS_TO_TOKENS = 1000;
  const CREDITS_TO_USD = 0.002; // 仅用于算 creditBudgetProxyUsd 代理闸，禁当真实成本
  interface MissionCostEstimator {
    estimate(businessSignals): { credits: number };
  }
  ```
- 产出：harness 唯一 `resolveBudgetCaps(credits, multiplier, source)`（含唯一换算数学）；各 app 实现 `MissionCostEstimator`（业务信号→credits），但**换算→caps 一律走 harness**。
- 消费：budget pool / rerun guard / UI DTO（`GET /budget-tiers` 的 capUsd）/ event payload / diagnostics 全读 caps。
- 落点：`ai-harness/guardrails/budget/resolved-budget-caps.ts`（新）；`MissionBudgetPool` 改消费它。
- 红线：删全栈 `×0.002 / ×1000 / ×0.05` 散落；禁止把 credits 当 USD。

### C4 `ResolvedRuntimeLimits` + `MissionLifecycleMetrics`（值对象，含 wall-time 拆字段）— P0

- 现状：`wallTimeMs` 二义且跨 app 同名异义。
- 目标：`interface ResolvedRuntimeLimits { wallTimeCapMs; maxIterations?; maxConcurrentAgents? }` / `interface MissionLifecycleMetrics { elapsedWallTimeMs; iterations? }`
- 落点：harness abstractions；**三 app DB 手写迁移**：明确区分 cap 列与 elapsed 列（radar `wallTimeMs`→`wallTimeCapMs`、`durationMs`→`elapsedWallTimeMs`；social `wallTimeMs`(实测)→`elapsedWallTimeMs` + 新增 `wallTimeCapMs`）；event/DTO/UI 跟改名。
- 红线：全栈禁用裸 `wallTimeMs`。

### C5 `MissionConfigSnapshot`（值对象）— P1

- 现状：playground 5 处重拼；social retry 从 task 表重拼；radar payload blob。
- 目标：
  ```ts
  interface MissionConfigSnapshot {
    // ★ Codex r6 决议：拆两层——schemaVersion=结构契约版本(v1→v2 升级)；snapshotRevision=
    //   同结构下的实例派生次数(rerun/patch 第 N 次)。绝不用 schemaVersion 表派生次数。
    schemaVersion; // 结构契约版本（结构变了才 ++）
    snapshotRevision; // 实例修订号（每次 rerun/patch 派生 ++；同结构内递增）
    // ★ Codex r5 决议：lineage 强化（事故审计——"为什么这次 rerun 用了这个预算"必须可追溯到
    //   是 full/local rerun / settings patch / save-as-new 派生）。仅 sourceMissionId 太弱。
    snapshotId; // 本快照唯一 id
    parentSnapshotId?; // 派生自哪个快照（rerun/patch 链）
    derivedFromMissionId?; // 派生自哪个 mission（继承链）
    mutationReason?; // 'fresh' | 'full_rerun' | 'incremental_rerun' | 'local_rerun' | 'settings_patch' | 'save_as_new'
    resolvedAt;
    topic;
    language;
    // ★ RB5：不是 opaque blob。app 声明 businessInputSchema(zod) + serialize/deserialize 显式契约。
    businessInput: AppBusinessInput; // 受 app 声明的 schema 约束，非无类型 blob
    budget: ResolvedBudgetCaps;
    runtimeLimits: ResolvedRuntimeLimits;
  }
  ```
- 产出：`openSession()` 解析一次 + 持久化（三 app 行加 `config_snapshot` JSONB + version）。
- 消费：run/rerun/resume/hydrate **一律只读 snapshot**。
- 落点：harness abstractions + store interface 扩 `config_snapshot`。

### C6 `MissionInputRebuilder`（service）— P1

- 现状：playground 自建 rerun 子系统；social 重拼 DTO；radar 业务重刷；**都不用 harness rerun primitive**。
- 目标（★ G3 修订：`patch` 升为正式 canonical 类型契约，不是裸 `patch?` 宽口子）：
  ```ts
  // patch 是受白名单约束的 canonical 类型，不允许 app 自由扩展字段
  interface MissionInputPatch {
    budgetOverride?: Partial<Pick<ResolvedBudgetCaps, "maxCredits" | "budgetMultiplier">>;
    runtimeLimitsOverride?: Partial<Pick<ResolvedRuntimeLimits, "wallTimeCapMs">>;
    businessInputPatch?: AppBusinessInputPatch; // 受 app 声明的 patch schema 约束
    // 不在白名单的字段 → 编译期/校验期红；status/failure 等终态敏感字段禁止 patch
  }
  buildForFreshRun(input): MissionConfigSnapshot
  buildForFullRerun(snapshot, patch?: MissionInputPatch): MissionConfigSnapshot      // 产出新 versioned snapshot
  buildForIncrementalRerun(snapshot, checkpoint, patch?: MissionInputPatch): ...
  buildForLocalRerun(snapshot, targetStage, patch?: MissionInputPatch): ...
  ```
- **应用顺序钉死（G3）**：`snapshot → apply MissionInputPatch（白名单校验）→ policy re-resolve（budget/limits 重解析）→ 产出新 versioned snapshot（snapshotRevision++/parentSnapshotId，G2；schemaVersion 不变）`。**不允许** "snapshot-resolved → patch-final" 的旁路就地改。
- 落点：`ai-harness/lifecycle/mission-lifecycle/rerun/`（已有目录，扩 rebuilder + `MissionInputPatch` 类型）。
- 红线：app 不得自己拼 budget/time/status 敏感字段；patch 只能走 canonical `MissionInputPatch` 白名单。

### C7 `CanonicalMissionState`（三层状态）— **拆波次**（G1：终态写权+最小值域 P0 前置 / presentation P2）

- 现状：DB 状态值域三 app 不一（radar 5/social 3）；playground `starting` 占位 + `quality-failed` 当可读完成；其它模块 legacy 全大写。
- 目标三层（★ G1/RM6 修订）：
  ```ts
  // 平台状态机：不改既有 IMissionStore 的 status 字面量（保 'completed' 不改 'succeeded'），仅约束最小值域
  enum MissionLifecycleStatus { starting, running, completed, failed, cancelled }
  // ★ G6 修订：平台 terminal outcome 只保这三个，不含 quality_rejected（业务语义不上提）
  enum MissionTerminalOutcome { success, failure, cancelled }
  interface MissionPresentationState { ... }                                      // 前端聚合（P2）
  ```
- **波次（G1）**：「**唯一终态写入口 `MissionLifecycleManager` + 最小 `MissionLifecycleStatus` 值域**」**提到 P0 第 0 步**（先于 C1/C2/C8）；`MissionTerminalOutcome` 层随 P0；`MissionPresentationState` 前端聚合留 P2。
- 红线：平台 lifecycle/outcome **不掺业务语义**——`quality-failed`/leader 拒签 → 留 `failureCode`/app 级 `businessOutcomeCode`（G6），不进平台 enum。

### C8 `MissionLivenessContract`（强制注册）— P0（缺陷修复）

- 现状：radar/social 建了 heartbeat 列却没注册 liveness adapter → 孤儿行永不回收。
- 目标：harness 提供 `registerMissionLiveness(adapter)`；**conformance 测试要求每个 mission app 必须注册**（否则红）。
- 落点：`ai-harness/lifecycle/mission-lifecycle/mission-liveness-guard.service.ts` + 看护 §7-L5。

### C9 Stage-boundary 契约机制（已落地，纳入单一真源）— DONE

- 本会话已建：`assertNumberProducerWithinSchema` + `STAGE_NUMBER_CONTRACTS` 注册表（playground）。
- 纳入本文件：作为"生产方范围 ⊆ 消费方 schema"的平台测试基元；后续 radar/social 的 stage→agent 数值边界也登记同一机制。
- 落点：`ai-harness/agents/dev-tools/contract-assertions.ts`（已在 harness）。

---

## 5. canonical 契约详表（产出/消费/落点速查）

> 波次以 §0.5/§0.6 修订为准（G1 前置终态写权；RM9 C6 与 C4/C5 同波次；C3 拆换算/估算；C7 拆波次）。

| 契约                                         | 产出方(唯一)                                   | 消费方                                             | harness 落点                                             | 波次                        |
| -------------------------------------------- | ---------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------- | --------------------------- |
| **C0 终态写权 + 最小 LifecycleStatus**（G1） | `MissionLifecycleManager`（唯一终态写入口）    | 所有 markFailed/Completed/Cancelled 调用方提交意图 | lifecycle/mission-lifecycle/mission-lifecycle-manager.ts | **P0-0（最前）**            |
| C1 AbortReason                               | abort 调用方                                   | lifecycle-manager 映射                             | abort-registry.ts                                        | P0                          |
| C2 MissionFailure                            | dispatcher 提交→lifecycle-manager 单写         | DB / 前端文案 / metrics                            | abstractions/mission-failure.ts                          | P0                          |
| C3a 平台换算（credits→tokens）               | harness `resolveBudgetCaps`（唯一换算）        | pool / guard / UI / event                          | guardrails/budget/resolved-budget-caps.ts                | P0                          |
| C3b 真实成本                                 | 复用 ai-infra `ModelPricingRegistry`（不另立） | BudgetAccountant                                   | ai-infra/credits（既有）                                 | —                           |
| C4 RuntimeLimits + Metrics                   | framework / lifecycle.helper                   | wallTimer / DB / UI                                | abstractions/runtime-limits.ts                           | P0                          |
| C8 Liveness 强制                             | framework heartbeat                            | liveness guard 扫描                                | mission-liveness-guard.ts                                | P0                          |
| C5 ConfigSnapshot（显式 schema）             | openSession + 显式 mutation 入口（G2）         | run/rerun/resume/hydrate                           | abstractions/mission-config-snapshot.ts                  | P1                          |
| C6 InputRebuilder（canonical patch）         | harness rebuilder                              | app rerun/hydrate                                  | lifecycle/mission-lifecycle/rerun/                       | P1（与 C4/C5 同波次）       |
| C7 presentation 聚合                         | lifecycle-manager                              | controller / UI / metrics                          | abstractions/mission-state.ts                            | P2（终态写权部分已前移 C0） |
| C9 Stage 契约 primitive                      | harness primitive；registry 各 app 自持        | 契约测试                                           | primitive: agents/dev-tools/contract-assertions.ts       | DONE                        |

---

## 6. 全 app 落地（adapter 改造清单）

> 原则：先 playground 落地 + 跑稳 → radar → social，每 app 一个 PR；adapter conformance 测试随之绿。

### 6.1 agent-playground

本会话已落地的 app 层单一源（DEPTH_BUDGET_TIERS / dispatcher abort 分类 / wallTimeMs 注释 / maxCredits 列）→ **提升为消费 C1–C4 canonical**；rerun 子系统 → 迁到 C6 rebuilder。

### 6.2 AI Radar（`ai-app/radar`）

1. C3：`run-radar-refresh-mission.dto.ts:68-89` resolve\* 静态值 → canonical estimator；补 per-mission estimate。
2. C2：`radar-pipeline-dispatcher.service.ts:91-103 / 298-362` message 正则 → canonical taxonomy；`models.prisma:10602` 旁加 `failure_code`。
3. C4：`models.prisma:10587-10588` `durationMs/wallTimeMs` → `elapsedWallTimeMs/wallTimeCapMs`。
4. C1：`radar-pipeline-dispatcher.service.ts:447-459 abortMission` → `AbortRegistry.abort(id, reason)` 统一接口。
5. C8：`radar.module.ts` 注册 `MissionLivenessGuard.registerAdapter`（当前完全缺失）。
6. C5：`radar-mission-store.service.ts:112-121 payload` blob → 结构化 snapshot。
7. C7：`radar-mission-store.service.ts:21-26`（已 5 态，迁移成本最低）→ canonical enum。

### 6.3 AI Social（`ai-app/social`）

1. **C1（功能缺陷优先）**：`social-task.service.ts:222-252 cancelTask` 增加 `dispatcher.abortMission()/abortRegistry.abort()` **真停**（当前假停继续烧预算）。
2. C3：删 `social-pipeline-dispatcher.service.ts:418-438`（depthFactor/0.05 估算）+ `social-runtime-shell.service.ts:33-69` 散表 → canonical estimator/caps。
3. C2：`social-pipeline-dispatcher.service.ts:640-647` inline 4 码 → canonical taxonomy + 落 `failure_code` 列（`models.prisma:8883` 旁）。
4. C4：`models.prisma:8878 wallTimeMs`(实测) → `elapsedWallTimeMs` + 新增 `wallTimeCapMs`。
5. C7：`social-mission-store.service.ts:66,98,119` → canonical enum；补 `markCancelled/markRejected`；对齐 `models.prisma:8875` 注释。
6. C8：`ai-social.module.ts` 注册 liveness adapter（仿 `agent-playground.module.ts:257`）。
7. C6：`social-task.service.ts:260-299 retryTask` → harness rebuilder + `IMissionRerunPolicy`。

---

## 7. 看护机制（防腐朽 — 本设计的核心要求）

> 目标：让违反契约**编译期/CI 期必红，合不进主干**，而不是靠人自觉。★ RM1 修订：**L1 类型是主防线（make illegal states unrepresentable）**，L3/L4 grep 仅补充、不可作主防线（字面量级可平凡绕过）。

### L1 类型契约（编译期）— ★ 主防线

- canonical 全为 TS 类型/枚举/值对象；adapter 接口强类型。app 传错类型 → tsc 红。
- **关键手段（治本，替代多数 grep 守护）**：`ResolvedBudgetCaps` **私有构造 + 只能由 `resolveBudgetCaps()` 工厂产出 + 字段 readonly**（别处拿不到原料去散落换算）；`abort()` 签名收 `MissionAbortReason` enum（传字符串 tsc 红）；snapshot 只能由工厂产出。**让错误状态无法表达**，比事后 grep 扫描根本。

### L2 契约单测（每 canonical 对象）

- enum 全覆盖；值对象不变量：`maxTokens===maxCredits×CREDITS_TO_TOKENS`；`creditBudgetProxyUsd===maxCredits×CREDITS_TO_USD`（★ RB2：此值是**额度代理**非真实成本，注释写明真实成本以 `ModelPricingRegistry` 为准）。
  （★ m2 修订：删除"`wallTimeCapMs≠elapsedWallTimeMs`"伪不变量——二者是不同字段非不变量关系，cap 可能恰等于某次 elapsed；该约束由 L1 类型层"禁裸 wallTimeMs"覆盖。）
- 沿用本会话 `assertNumberProducerWithinSchema`（C9 primitive，harness）：stage→agent 数值边界 producer ⊆ consumer（registry 各 app 自持，RM3）。

### L3 架构守护 spec（`verify:arch` 扩展，jest 拦截）— ★ RM1 修订：降级为"补充层"，非主防线

> 主防线是 L1 类型（见下）。grep 字面量级守护可被等价改写平凡绕过（`const r=0.002`、`x*2/1000`、别名 enum），且 `wallTimeMs` 全仓 297 处含 harness 自身——**全仓即时封禁会逼出大量白名单使守护失效**。故 grep 守护**收窄**：

1. `× 0.002 / × 1000` 换算：**仅扫 `guardrails/budget` 目录**（白名单 `resolved-budget-caps.ts`）+ **仅对新增代码**；不全仓。（`× 0.05` 是 social 业务估算，不禁。）
2. 裸 `wallTimeMs`：**仅对新增代码禁**（带 deadline 逐步清理存量），不全仓即时封死；用词边界正则避免误伤 `wallTimeCapMs`/`elapsedWallTimeMs`。
3. `abortRegistry.abort(` 第二参字符串字面量——**此条主要靠 L1**（abort 签名收 enum，传字符串 tsc 即红）；grep 仅兜底。
4. markFailed 只写 message 不写 failureCode——**靠 C0 单写入口**（终态只能经 lifecycle-manager，它强制要 failureCode）；grep 测不准数据流，不依赖它。

### L4 ESLint（IDE 实时 + lint-staged）— ★ RM1 修订：取消"全仓 0.002/1000 字面量"规则（误伤大）

- 保留：禁 `ai-app/**` 直接 import harness 内部 budget/lifecycle 路径（必走 facade）——这条是路径级、误伤小、与既有 `no-restricted-imports` 一致。
- **删除**：原"禁字面量 0.002/1000 用于 credits 上下文"——`1000` 全仓到处是毫秒/容量，AST 判"credits 上下文"假阳性多，成本高收益低。改由 L1（值对象私有构造，别处拿不到原料散落）治本。

### L5 Conformance — ★ RB3/G4 修订：harness 不认 app 名 + 两级（wiring 静态 / behavioral 集成）

> RB3：撞既有 R0-A5（harness 文件禁出现 app 名）。故**不是** `assertMissionAppConformance(appModule)` 枚举具体 app，而是 **app 自报 namespace 字符串注册**，harness 对"任意注册项"断言不变量。G4：只查接线挡不住"接了但语义错"，拆两级。

**L5a wiring conformance（静态，启动期）**——对每个注册项断言"接线存在"：

1. 实现了 `IMissionRuntimeAdapter`；2. **注册了 liveness adapter**（治 radar/social 漏注册，静态可验，真有效）；3. 声明了 cancel 入口 + rerun policy（若支持）。harness 只断言"已注册集合非空 + 每项满足接口"，**不硬列 app 名**。

**L5b behavioral conformance（集成测试套件）**——对每个注册项跑真实行为（治"接了但语义错"）：

- 发真 mission → cancel → 断言 `signal.aborted` + budget 停增 + 终态=cancelled + reason 正确（治 social 假停——静态会误判它合格，因为它"出现过 abort 调用"只是在错的地方）；
- rerun → 断言 patch 不越权 + policy 重解析正确；
- 制造预算耗尽 → 断言 failureCode/category 映射正确；
- 制造静默 → 断言 liveness 回收。
- **★ Codex r5 必测：双终态竞争（直接验证 C0"唯一写入口 + 首写者赢"不变量，否则 C0 仍是声明而非已验证不变量）**：
  - `budget_exhausted` 与 `user_cancelled` 几乎同时 → 断言**只落一个终态**（首写赢），另一个 no-op，无覆盖；
  - liveness-guard 与 dispatcher 几乎同时落终态 → 断言 DB 条件写仲裁生效（`WHERE status='running'` 只有一个成功）；
  - **★ Codex r6 必测（最贴真实事故）：三方失败来源并发抢终态** —— dispatcher 提交 `budget_exhausted` + controller 同时提交 `user_cancelled` + liveness 稍后提交 fallback → 断言**最终只一个 terminal write 生效，且后两者不覆盖首个已落库原因**。这是 C0 单写裁决的核心打穿验证，不测则 C0 仍未被真正验证。
    > **无 L5b（含双/三方终态竞争）的接入视为未接入。** 新增 mission app 缺任一级 → 红，无法合并。这是"新 app 接入清单"的可执行版。

### L6 pre-push + CI 二次执行

`.husky/pre-push` 第 0 步跑 `verify:arch`（含 L3）+ conformance（L5）+ 变更测试；CI 复跑全量。违规拒推。

### L7 注册表 + schemaVersion + 文档回链

- `MissionConfigSnapshot.schemaVersion`：契约演进有版本，跨版本回退有据。
- 本文件为单一真源；每个 canonical 文件头注释回链本文件路径；新增 mission app 的 PR 模板要求勾选"已过 conformance"。

---

## 8. 分波次迁移（× 全 app）

> ★ 本表已按 §0.6 G1 重排（终态写权前置）。

| 波次                                | 内容                                                                                                                          | 全 app 落地                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **P0-now（独立 hotfix，不等重构）** | RS1：radar/social 注册 liveness adapter；social cancel 真停（各一行级，零迁移）                                               | radar / social 各一 PR                                                           |
| **P0-0（平台前置）**                | **C0 终态写权（`MissionLifecycleManager` 唯一终态写入口）+ 最小 `MissionLifecycleStatus` 值域**（G1）                         | 三 app 终态写改走单入口                                                          |
| **P0**                              | C1 AbortReason / C2 MissionFailure / C3a 换算 / C4 wall-time 拆 / C8 liveness 强制；**L1 类型为主防线** + L5a/L5b conformance | playground→radar→social 各一 PR（**无双写·真实切换**，隔离靠 worktree+测试，G5） |
| **P1**                              | C5 ConfigSnapshot（显式 schema，G2 写治理）/ C6 InputRebuilder（canonical patch，G3）**与 C4/C5 同波次**（RM9）               | 各 app 接 rebuilder                                                              |
| **P2**                              | C7 presentation 聚合 / starting 占位平台化（终态写权部分已前移 P0-0）                                                         | controller/前端/store                                                            |
| DONE                                | C9 stage 契约 primitive（harness）；registry 各 app 自持（RM3）                                                               | playground 已落；radar/social 各自登记                                           |

**P0 内顺序（硬性，G1）**：C0 终态写权 → C1/C2（依赖终态语义）→ C3a/C4（无双写·真实切换）→ C8。**不再"C3+C4 先行"**；C6 Rebuilder 与 C4/C5 同波次以缩短切换窗口（RM9）。

---

## 9. 兼容策略

- **★ 无双写 · 真实切换（用户硬约束 2026-05-22：没有双写，也不接受双写）。** 取代原"双写过渡 + 灰度切读"。每处迁移：加新列 → 一次性回填 → 切换全部读写到新列 → 同脚本删/重命名旧列；**不写两份、不留旧列、不读优先回退**。代码与迁移**同 PR 原子上线**。
  - 因无并行值，原 Codex r5"双写期 mismatch 告警/fail-closed"**不再适用**（无两份值可比）；改为**迁移后一次性断言**：回填完成后断言"无行残留旧语义"（如无行 `failure_category ≠ codeToCategory(failure_code)`、无裸 `wall_time_ms` 残留列），不通过则迁移失败回滚。
- **in-flight / 历史 mission**：无 `config_snapshot` 的历史行——迁移脚本**一次性回填** snapshot（从 row+JSON 重建一次并落库）；运行期 rebuilder **不做 legacy 拼装回退**（无双路径）。回填不了的历史行明确标记 `schemaVersion=legacy` 只读不可 rerun。
- **DB 迁移**：手写 SQL（项目规范，禁 `prisma migrate dev`）；单脚本内 加列→回填→切换→删旧；三 app 各自迁移脚本；迁移前 DB 备份。
- **跨 app 节奏**：harness canonical 一次到位（不留 legacy）；三 app 在同一波次/PR 链内逐个真实切换，每个切完全量绿再下一个；隔离靠 worktree + 测试，不靠 flag。
- **event/前端协议改名**：走 `playground-frontend-contract.spec` byte-equal 基线（radar/social 补各自基线），改名同步基线 + 前端 client。
- **prompt cache / 在跑任务**：合并节奏避开在跑任务；P0 不动 agent prompt。

## 10. 风险点

| 风险                                                     | 缓解                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 跨 app blast radius（3+ app 同 harness）                 | 先 playground 验证；adapter 边界稳定后逐 app；canonical schemaVersion                 |
| DB 迁移（wall-time/config_snapshot/failure_code × 3 表） | 手写迁移单脚本内 加列→一次性回填→切换→删旧（**无双写**）+ 迁移前备份 + 迁移后残留断言 |
| in-flight / 历史无 snapshot                              | rebuilder legacy 回退分支                                                             |
| social 真停上线后行为变化（之前假停）                    | 灰度 + 明确 changelog；cancel 后 budget 立停是预期改进                                |
| event/前端协议改名                                       | byte-equal 基线 + 前端 client 同步 PR                                                 |
| 看护 L3/L4 误伤合法用法                                  | 白名单（如 `resolved-budget-caps.ts` 允许换算常量）                                   |

## 11. 测试矩阵（全 app × 全域 × 全分支）

- **契约单测**：每 canonical（C0–C9）值对象不变量 + enum 全覆盖。
- **conformance（L5，RB3/G4）**：harness 对**每个已注册项**（按自报 namespace，不硬列 app 名）跑 L5a wiring（静态）+ L5b behavioral（集成）。
- **业务分支矩阵**（每 app）：fresh run / full rerun / incremental / local rerun / **cancel 发生在 S8 前 vs S8 中（RB6 半发布）** / budget-exhaust / wall-time-exceed / quality-reject / 孤儿回收 / 历史无 snapshot legacy 回退 / **liveness markFailed 与正常 markCompleted 的 TOCTOU 竞争** / **★ Codex r6：多失败来源并发抢终态（dispatcher budget_exhausted + controller user_cancelled + liveness fallback 三方几乎同时）→ 只一个 terminal write 生效、首写原因不被覆盖**。
- **架构守护（L3，RM1 降级）**：仅 budget 目录扫换算字面量 + 仅新增代码禁裸 wallTimeMs；主防线是 L1 类型（abort enum / caps 工厂私有构造）。
- **回归基线**：`playground-no-regression` + 三 app `*-frontend-contract` byte-equal（含 REST DTO 字段，非仅 event）。

## 12. 不上提（留 ai-app 业务层）

- `depth=quick|standard|deep` 档位、`budgetProfile` 文案标签。
- `styleProfile/audienceProfile/auditLayers/searchTimeRange` 业务输入。
- leader 签字业务解释（映射到平台 `failureCode=leader_signoff_rejected` 走 C2）。
- 维度工具矩阵 `dimension-tool-matrix`、章节/字数业务契约。
- 详情页 budget meters / 设置弹窗回填 / 布局交互。

## 13. 与本会话已落地工作的衔接

本会话已在 **app 层** 单一源化若干项；本设计 P0 把它们**提升为 harness canonical 并令 radar/social 共同消费**——多为"提升 + 改消费方"，非全新建：

| 本会话已做（app 层）                                      | 提升为（harness canonical）                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| `DEPTH_BUDGET_TIERS` + `resolveMissionCredits/Multiplier` | C3 `ResolvedBudgetCaps` + `MissionCostEstimator`（换算搬进 harness 唯一处） |
| dispatcher `budget_exhausted/user_cancelled` 分类         | C1 `MissionAbortReason` + C2 `MissionFailureCode` enum                      |
| `wallTimeMs` 注释澄清 + maxCredits 列权威                 | C4 字段拆分 + C5 snapshot                                                   |
| `assertNumberProducerWithinSchema` + 注册表               | C9（已在 harness，作为看护 L2 基元）                                        |
| dimension-tool-matrix / chapter/word 契约                 | 留 app 业务层（§12）                                                        |

---

## 14. 评审决策点（待确认后实施）— ★ 已按 §0.5/§0.6 修订

1. **先做 RS1 两个独立 hotfix**（radar/social liveness 注册 + social cancel 真停，零迁移）——认可立即做、不等平台重构？
2. **平台 P0 顺序（G1）**：C0 终态写权前置 → C1/C2 → C3a/C4（带 G5 rollout 隔离）→ C8；**不再 C3/C4 先行**。认可？
3. 粒度：每 canonical × 每 app 一 PR（**无双写·真实切换**，回退靠 git revert + 反向迁移，不靠 flag）。认可？
4. social 真停（含 RB6 S8 gate-before-stage 防半发布）——确认是期望改进？
5. 范围裁剪：是否先只做"地基四件"（C0 终态写权 + RB2 pricing 不固化 + C8 liveness + L1 类型看护），其余 C5/C6/C7 视效果再排？

> 评审通过后，按 §8 波次实施；每步过 §7 看护（L1 主防线）+ §11 测试矩阵。**本文件 §0.5/§0.6 修订决议优先级高于其余正文；如发现冲突以修订为准。**
