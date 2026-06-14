# Playground 业务流深度推理检视（2026-06-10）

> 5 段并行深度推理：dispatch 生命周期 / S1-S3 / S4-S6 / S7-S12 / 消费面（任务列表·Drawer·协作动态·模型/算力列）。
> 覆盖 happy path + corner case 全分支，每处输出（事件发射）与三个用户面的消费逐一对照。
> 本文档同时标注：✅ 已在 588f89e83 及之前修复 / ⏳ 已立案待修（按严重度排序见末节）。
>
> **勘误（2026-06-10 晚，25cedf347）**：下文标 ⏳P1 的 5 项（成本恒 $0、失败通知仲裁、S4 catch
> 全维卡死、extractWeakDimensions 字段、quality-failed 不可达）与 4 项 P2（budget/validation
> 警告透传、S2 复用提示、S5 单维短路、mission:started/completed 桥）已全部闭环；company gateway
> 同步补注册 8 个新 domain 事件。剩余待修以第 6 节扣除上述项后为准
> （主要：S4 retry 闭环、S8 章节流式、S3 全败 early-abort、abort 状态-事件 DB 矫正）。

## 0. 总根因（一句话）

\#16b 硬切把旧 OFF-path 的**结构化事件词汇表**（agent:thought/action/observation 带 toolId/input/output、critic:verdict、leader:signed、reconciliation:completed、cost:tick、researcher:completed…约 70 个注册事件）压扁成 text-only narrative 桥；前端三个面的全部"历史展示方式"建立在被丢弃的词汇表上，而**消费端 handler 全部健在**——修复方式是按旧 stage 形状恢复发射 + 桥接结构化透传，而非改前端。

## 1. Dispatch / 生命周期段（segment 1）

关键分支与发射（详见各 file:line）：

| 分支                                          | 发射                                                                                          | 状态           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------- |
| 并发 supersede                                | mission:cancelled（被顶替文案）                                                               | 正常           |
| openSession 早爆                              | mission:rejected + mission:failed(MISSION_START_FAILED)                                       | 正常           |
| capability runner 不可用                      | mission:failed(PROVIDER_API_ERROR) + 通知                                                     | 正常           |
| 完成（happy）                                 | ⚠️ 无 mission:completed（无 stepId 被桥丢弃）；终态刷新靠 postlude:completed 兜底             | ⏳             |
| 失败                                          | mission:failed 富分类 + partial 落库                                                          | 正常，但 ↓     |
| 失败通知仲裁                                  | runner applyTerminal 先写赢 → dispatcher finalize 输 → **MissionFailedPreset 通知几乎永不发** | ⏳ P1          |
| wall-time/budget abort                        | DB 写 cancelled、事件发 failed（状态-事件错位）                                               | ⏳ P2          |
| cancel 仲裁输                                 | HTTP 返 ok:true 但无事件、刷新后变真实终态                                                    | ⏳ P3          |
| boot orphan 自动续跑                          | 新 missionId 只进日志，旧 mission 文案仍劝手动重跑                                            | ⏳ P3          |
| S2 继承 plan 命中                             | 零事件（用户无法区分复用 vs 异常）                                                            | ⏳ P3          |
| 成功路径 saveReportVersion/saveResearchResult | 端口刻意未实现 + runner 不调用 → 版本历史恒空、"更新"静默全量重跑                             | ✅ 已实现+接线 |

## 2. S1-S3 段（segment 2）

| 分支                             | 发射要点                                                                                   | 状态                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| S2 fresh 成功                    | narrative×2 + trace 流 + lifecycle(modelId) + cost:tick + leader:goals-set + stage:metrics | ✅                                                   |
| S2 校验拒绝→degraded             | validation_failed 全部被 relay 丢弃；degraded:true 仅藏 lifecycle                          | ⏳ P2（relay 透传 budget_warning/validation_failed） |
| S2 硬失败                        | 静默兜底单维假计划继续跑全程，无提示                                                       | ⏳ P2                                                |
| S3 维度 fresh 成功               | started→trace→lifecycle→cost:tick→research:completed→researcher:completed                  | ✅                                                   |
| S3 维度 null-output/runner-throw | 此前只有 started（卡死 UI）                                                                | ✅ 补 dimension:graded{0,failed}+error narrative     |
| S3 全维失败                      | stage:completed 照发，S4-S10 空转烧钱后才判失败                                            | ⏳ P2（early-abort）                                 |
| 维度上限                         | normalizePlan 硬编码 slice(0,6) 砍掉 deep 档 10-12 维                                      | ✅ 71af53b1f 按 depth cap                            |
| 并发                             | recipe s3 无 params.concurrency → 实际串行，叙事称"并行"                                   | ⏳ P2                                                |
| 成本                             | AgentRunner costCents:0 //TODO → cost:tick/lifecycle/终态成本恒 $0（tokens 正确）          | ⏳ P1（接 pricing）                                  |

## 3. S4-S6 段（segment 3）

| 分支                    | 要点                                                                                                                                                             | 状态                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| S4 逐维 graded          | 每 plan 维度恰好 1 条（同源 plan.dimensions，名字必一致）                                                                                                        | ✅                                  |
| S4 LLM 失败 catch       | 零事件 → 全部 dim todo 卡 in_progress 至终态清扫                                                                                                                 | ⏳ P1（catch 补降级事件）           |
| S4 decision=patch/retry | **纯咨询**：旧 OFF-path 的重派 researcher/重评闭环全部丢失；s10 只要 patch 必拒签且 extractWeakDimensions 读错字段（dimensionName vs dimensionId → "(unknown)"） | ⏳ P1（字段 bug）+ P2（retry 闭环） |
| S5 对账                 | reconciliation:completed 不发 → gap todo 死路；失败静默                                                                                                          | ✅ 补发 + 失败 warning              |
| S5 单维短路             | 未接 → 多烧一次 LLM                                                                                                                                              | ⏳ P3                               |
| S6 analyst 空产出       | 无重试、无 fail-loud、quickview 二次合成丢失                                                                                                                     | ⏳ P2                               |

## 4. S7-S12 段（segment 4）

| 分支                 | 要点                                                                                                           | 状态                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| S7/S9 档位跳过       | done-but-blank 无解释                                                                                          | ✅ 补"按档位跳过"narrative                 |
| S7 outline:planned   | payload 无 dimension 被 projector 丢                                                                           | ✅ 补 stage 级完成 narrative               |
| S8 章节事件          | writer 返回后同毫秒 burst started+completed——撰写期间无任何推进                                                | ⏳ P2（流式分段）                          |
| S8 section→dimension | 按 index 近似映射，语义错位                                                                                    | ⏳ P3                                      |
| S9 critic            | verdict 不发不存，S10 的 blindspots 硬编码 []                                                                  | ✅ critic:verdict + CS 存取 + S10 真实传入 |
| S9b 评估             | verifier:verdict 不发                                                                                          | ✅ 补发                                    |
| S10 签字/拒签        | leader:foreword/leader:signed 不发；**拒签后 mission 仍 completed（quality-failed 不可达）**，前台全绿成功观感 | ✅ 事件补发；⏳ P1（quality-failed 语义）  |
| S11                  | completed intent 丢 leaderSigned                                                                               | ✅ 补落库                                  |
| S12 postlude         | 四终态分支均触发 + postlude:\* 事件                                                                            | ✅                                         |
| postlude 分类        | signed=null 的成功 mission 被分类为 failed 污染召回                                                            | ⏳ P3                                      |

## 5. 消费面（segment 5）——三个面的逐事件矩阵要点

| 缺口                                                                                                                    | 状态                                            |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| agentId 命名空间断裂（playground.researcher vs researcher#<dim>/leader）→ Drawer trace/STAGE PROCESS/sub-state 三面全断 | ✅ 发射端+桥统一映射消费侧 id（保留 specId）    |
| trace 丢 input/output（relay 截断好的 500 字被桥丢弃）；action_planned+executed 工具计数 ×2                             | ✅ 透传 + observation 拆分 + planned 归 thought |
| narrative 无 toolId → ToolCallChip 退化                                                                                 | ✅ 补 toolId                                    |
| Drawer TOKENS 恒 "-"（trace 无 tokensUsed）                                                                             | ✅ 兜底 linkedAgent.tokensUsed                  |
| findingsCount/findingCount 字段错位                                                                                     | ✅ 双读                                         |
| stage 级 narrative 不进 system todo                                                                                     | ✅ 路由补齐                                     |
| agent-view tokensUsed 末值覆盖 + dimension last-wins 折叠                                                               | ✅ 累加 + #dimension 分桶                       |
| reconciler/critic role 被前端过滤（s5/s9 模型列 "-"）                                                                   | ✅ 归一 + resolveModel 别名                     |
| stage:metrics / stage:stalled/degraded 零消费                                                                           | ⏳ P3（接 handler 或停发）                      |

## 6. 待修立案（按严重度）

P1：成本恒 $0（AgentRunner pricing 接线）；失败通知仲裁被 runner 抢写吞掉；S4 catch 全维卡死；extractWeakDimensions 字段 bug；leader 拒签 quality-failed 语义不可达。
P2：S4 retry 闭环恢复；S3 全败 early-abort + 串行并发参数；S8 章节流式；S6 空产出 fail-loud；budget_warning/validation_failed relay 透传；abort 状态-事件错位；mission:started/completed 桥接。
P3：S5 单维短路；S8 section 映射；cancel 仲裁输出；orphan 续跑关联；postlude signed=null 分类；零消费事件清理。

## 7. 验证协议

1. `curl https://api.gens.team/health` → `commit` 字段 ≥ `588f89e83`（后端部署确认）。
2. 前端 Railway 部署完成 + 浏览器硬刷新（Ctrl+Shift+R）。
3. **开全新深度 mission**（旧 mission 事件已定格，跨版本 mission 状态机不可判读）。
4. 预期：维度 8-12；模型列各行有值；算力 tokens 实时累加（**成本仍 $0**，P1 待修）；维度 采集→评审→done 推进；Drawer 完整时间线含 thought/工具调用(toolId+query)/tool-result 卡；协作动态思考折叠卡+工具 chip；S5/S9/S10 有对账/盲点/签字卡；版本历史非空。
