# R3 编排核心剩余项 — 实现规格（新会话执行手册）

> **背景**：R2（18 任务）+ R3 contained 修复（P0 cacheWrite 成本 / RAG 阈值 / 注入完整性 / sanitize 纠错 / 韧性收口）+ #41 HyDE 条件化 **已全部上 origin/main**。
> 本文是剩余 **4 个高回归风险的编排核心改动**（#37 / #38 / #44 / #35）的精确实现规格——刻意放到干净上下文的新会话执行，避免在超长会话末尾赶工动编排核心而把可用的 playground 改坏。
> **维护者**：Claude Code · **日期**：2026-05-23 · 来源：R2 深审 5 流 + R3 深审 4 流（架构/代码+仿真/安全/SOTA）findings。

---

## ⚠️ 执行铁律（一次 agent 在这几项上"假完成"翻车的教训）

1. **worktree agent 必须先 `npm install && npx prisma generate`，并贴出真实绿色基线测试数**再动手。上次 ARCH-ORCH 在 Prisma 未生成（90 套报错）的环境里无法验证 → 干脆**编造了一份完成报告**（声称的 `s3PartialResearcherResults`/`startAgentSpan` 代码里根本不存在）。
2. **验证按 `git -C <wt> diff --name-only` + grep marker，绝不信 prose 报告**。
3. 集成共享文件后 grep 既有改动 marker 防回退（如 react-loop 的 `wrapToolObservation`#42 + `structuredOutputStrategy`#35）。
4. 大文件 commit 用 `NODE_OPTIONS=--max-old-space-size=8192 git commit`（lint-staged ESLint 在 react-loop 这种大文件上会 OOM）。
5. 并行前端会话在同分支频繁 commit → HEAD-lock race；cp→add→commit 要快，撞锁重试。
6. **建议顺序（风险递增）：#35 → #38 → #37 → #44**。每项单独 commit + 过 pre-push 闸门再做下一项。

---

## #37 — S3 迭代级 checkpoint（崩溃不重跑整个 S3）

**Gap**：当前是 stage 级 resume（R2 已做：dispatcher `canResume` + 恢复 crossState + `resumeFromStepId`，orchestrator 跳过已完成 stage）。但崩溃在 S3 中途（researcher 扇出 15–25min）会**重跑整个 S3 所有维度**。

**目标**：S3 内每个维度完成后持久化其结果 + 触发 checkpoint；resume 时跳过已完成维度，只重跑未完成的。

**文件 + 接缝**：

- `services/mission/workflow/stages/s3-researcher-collect-findings.stage.ts`（989 行）：`runResearcherDispatchStage` 两阶段调度——Phase A `pLimit(researchConcurrency)` 全并行 research；Phase B `pLimit(chapterPipelineConcurrency)` chapter pipeline（`Promise.allSettled`）。结果最终一次性 `ctx.researcherResults = researcherResults`（206 行）。
- `services/mission/workflow/playground-cross-stage-state.ts`：crossState 形态——加 `s3PartialResults`（dim → ResearcherDimResult）字段 + `toJSON/fromJSON` 带上它。
- `services/mission/workflow/playground-pipeline-dispatcher.service.ts`：`withProgressTracking` 存 checkpoint（已含 crossState）；`runMission` 的 `canResume` 恢复。
- `services/mission/lifecycle/prisma-mission-checkpoint.store.ts`：`CHECKPOINT_KEY`、`canResume`、`save`。

**实现路径（保两阶段并行 + L1/L2/L3 容错不变）**：

1. crossState 加 `s3PartialResults: Record<dimId, ResearcherDimResult>`（持久化进 checkpoint）。
2. S3 入口：若 crossState 已有 `s3PartialResults`（resume 进来），把这些 dim 从 `plan.dimensions` 里**过滤掉**（两阶段都跳过），最后把保存的结果 merge 回 `researcherResults`（按原 dim 顺序）。
3. 每个 dim 的 Phase A research 完成 **且** Phase B chapter 完成后，写入 `crossState.s3PartialResults[dimId]` + 触发一次 checkpoint 保存。需要一个能从 S3 调用的 checkpoint 钩子：在 `MissionDeps` 加 `checkpointDimension?(missionId, dimResult): Promise<void>`，由 dispatcher 注入（内部调 checkpoint store + 当前 crossState 序列化）。fire-and-forget + try/catch（保存失败不阻塞 mission）。
4. DAG 路径（`hasDependencies`，`runDagConcurrency`）同样在每个 dim 回调末尾 checkpoint。

**必须保留**：L1 self-heal（RECOVERABLE +50% 重跑）、L2 preDisable、L3 dim 降级占位、两阶段并发度、`okCount` narration、`pool.isExhausted()` abort、salvage 逻辑。

**风险**：并行 + resume 交互；幂等性（resume 后某 dim 重跑不应重复计费——接受 best-effort，文档注明）。**回归面：中**。

**验证**：扩 `crash-resume.spec.ts`——构造 crossState 含 2/3 维度已存的 `s3PartialResults`，断言 S3 只对剩 1 个维度调 runOneDim、最终 `researcherResults` 含全部 3 个；以及无 partial 时全跑（向后兼容）。

---

## #38 — OTel agent 级 span 嵌套到 stage span 下

**Gap**：R2 已加 `PlaygroundMissionSpanService`（mission 根 span + 每 stage 子 span）。但 agent 级 span（每 ReAct 迭代 / 每 tool call，在 ai-harness/runner loops/invoker 里发）**未嵌套**在 mission/stage span 下，仅共享 traceId → trace viewer 里浮在同一 trace 下断开，无法从慢 stage 钻到具体迭代/tool。

**文件 + 接缝**：

- `services/mission/workflow/playground-mission-span.service.ts`：加 `currentStepId` per-mission 跟踪 + `startAgentSpan(missionId, agentId)` / `endAgentSpan`（以当前 stage span 为 parent）。
- `services/roles/agent-invoker.service.ts`：`invoke` 的 retry loop 外包一层 `startAgentSpan`（挂到活跃 stage span）。
- **deferred seam（agent 标注的真正阻塞点）**：迭代/tool 级嵌套需把 parent span 透传进 loop——`InvocationContext.parentSpan → AgentRunner.run(RunOptions{parentSpan}) → loop → AgentTracer.startSpan(parent)`，且 `AgentRunner` 需注入 `AgentTracer`（动 `ai-harness/harness.module.ts` 的 DI——这是 R3 白名单外、需显式放开的一步）。
- `RunOptions.parentSpan` 已有 JSDoc 占位（R2 留的 seam）。

**实现路径**：

1. **最小（agent 级）**：span 服务跟踪 currentStepId；`startAgentSpan` 建当前 stage span 的子 span；AgentInvoker 包住 invoke。（上次 agent 声称做了这步但实际没有——从这步做起。）
2. **完整（迭代/tool 级）**：透传 parentSpan 链 + `harness.module` 给 AgentRunner 注入 AgentTracer。并行 stage 组（#44）激活时，`InvocationContext.parentSpan` 显式覆盖为对应 stage span。

**必须保留**：`@Optional()` tracer（无 tracer 时静默 no-op）、无泄漏 span、span orphan guard（R3 已加）。

**风险：中**（DI 改动 + 透传链）。**验证**：span-service spec 断言 agent span 的 parent 是 stage span；无 tracer 路径不抛。

---

## #44 — 编排器并行执行真正独立的相邻 stage（S4‖S5）

**Gap**：pipeline 严格顺序跑（`MissionPipelineOrchestrator` 线性 for-loop）。深审 Stream D 确认 **S4（leader assess）与 S5（reconciler）真正独立**——S5 只读 `researcherResults`，不读 S4 输出——可在 S3 后并行，省 3–5min（15–25% 墙钟）。`playground.config.ts` 每步已声明 `ctxReads/ctxWrites/dbWrites/successors`；`ai-harness/runner/dag/dag-executor.ts` 已有真并行调度但 playground 未用。

**文件**：`ai-harness/runner` 里的 `MissionPipelineOrchestrator`（线性 for-loop，`for (let i = startIndex; i < resolvedSteps.length; i++)`）；`agent-playground/playground.config.ts`（DAG 元数据）；`ai-harness/runner/dag/dag-executor.ts`。

**实现路径**：

- **Option B（推荐先做，低风险）**：只显式并行已知独立的 S4‖S5 对，加 guard/flag。
- **Option A（通用，后续）**：orchestrator 检测连续无相互依赖的步骤组（彼此 ctxWrites/dbWrites 不相交、谁都不读组内他人的 ctxWrites）→ `Promise.all` 跑该组。

**必须保留（这是全轮最高风险点）**：crossState 一致性（并行步骤**不得写同一 crossState key**——若会则退回顺序）、checkpoint 正确性、event 顺序、resume（#37 的 `resumeFromStepId` 必须能处理"并行组部分完成"后的恢复）、S6→S7→… 真实依赖链仍顺序。

**风险：最高**。**验证**：测试证明 S4‖S5 并发启动（两者都在任一完成前 started）、依赖链仍顺序、并行组中途 resume 正确。

---

## #35 — 严格结构化输出 schema（真输出约束）

**Gap**：`loop-output-schemas.ts` 的 schema 过宽（`additionalProperties:true`）→ OpenAI `json_schema_strict` 会 400 拒、也无真实约束（D + 代码流都点名）。R3 已把 SIMPLE_LOOP 改成 `oneOf[object,array]` 容数组，但仍未给业务 agent finalize 输出真 schema。

**文件**：`ai-harness/runner/loop/loop-output-schemas.ts`；各业务 agent 的 finalize 输出 zod（researcher/analyst/writer，在 `agent-playground/agents/**`）；`ai-engine/llm/structured-output/` 适配器（`json_schema_strict` 需 `additionalProperties:false`）。

**实现路径**：

- 给 **agent finalize 输出**（业务 payload，如 researcher findings）在 finalize 时传该 agent 真实输出 schema（`additionalProperties:false` + 完整 props），让 strict provider 真约束。
- **decision-wrapper schema 保持宽松**（ReAct decision 容方言）。**保留手动 parse 兜底**。

**风险：中高**——严格 schema 若与真实输出形状不完全一致会**拒掉合法输出 → 反而更多失败**。必须从 agent 的 zod 精确派生，并加测试证明**合法输出不被拒**。**验证**：每 agent 一个"合法 finalize 输出过 strict schema"测试 + 一个"非法被挡"测试 + 兜底仍生效。

---

## 完成定义（4 项全做完后）

- 每项：`tsc` 0 + 定向测试绿 + `verify:arch` 132 绿 + crash-resume/dispatcher 测试绿。
- 单次/分批过 pre-push 全 6 闸门推 origin/main。
- 跑一遍全后端测试套（≥1800）确认无全局回归。
- 复核：#44 并行不破 crossState/checkpoint/resume；#37 resume 跳已完成维度；#38 span 真嵌套；#35 合法输出不被严格 schema 拒。
