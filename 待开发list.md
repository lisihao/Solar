# 待开发list

> 数据截止：`2026-08-14T01:16:39.087325+00:00`；范围：`created_at >= 2026-05-20T00:00:00Z`；共 `421` 张需求单。
> 本清单是代码仓内的只读盘点，不会改写 sprint/status/task_graph/eval 运行态。状态以当前侧车和 task graph 为准，不以历史口头汇报为准。

## 口径

- `实际交付代码`：只从 handoff 的 `Changed Files/Actual Writes` 段抽取；它表示有交付证据，不等于本次重新验收通过。
- `计划代码范围`：来自 task graph 节点的 `write_scope`；它表示预定修改面，不冒充已实现。
- 代码路径统一转换为仓库相对路径；路径可能来自尚未合并的历史分支或运行态 handoff，是否存在于当前分支需以对应提交为准。
- `error`：状态异常或父单虽终态但仍有失败节点；`warn`：仍需 builder/eval/对账；`pending`：尚未进入实现；`ok`：图与父状态已闭环。
- `N/A`：当前侧车没有可核实字段；不做猜测补全。
- 本文件名沿用用户指定名称。已完成项仍保留在附录，便于确认 5 月 20 日以来没有漏单。

## 总览

```text
┌────────────────┬─────────┐
│ 指标           │ 数量    │
├────────────────┼─────────┤
│ 需求单总数     │ 421     │
│ 待开发/待收口  │ 134     │
│ 已完成/已归档  │ 287     │
│ 有实际代码证据 │ 168/421 │
│ 有计划代码范围 │ 222/421 │
└────────────────┴─────────┘
```

```text
┌─────────┬──────┐
│ 状态    │ 数量 │
├─────────┼──────┤
│ ok      │ 273  │
│ warn    │ 124  │
│ error   │ 13   │
│ pending │ 11   │
└─────────┴──────┘
```

### 执行队列

```text
┌─────────────────┬──────┐
│ 队列桶          │ 数量 │
├─────────────────┼──────┤
│ error           │ 13   │
│ reconcile       │ 13   │
│ evaluator       │ 2    │
│ builder_or_eval │ 68   │
│ intake          │ 11   │
│ other           │ 27   │
│ archived        │ 14   │
│ done            │ 273  │
└─────────────────┴──────┘
```

### 当前卡点

```text
┌─────────────────────────┬──────┐
│ 卡点类别                │ 数量 │
├─────────────────────────┼──────┤
│ Builder/Eval 阶段未闭环 │ 68   │
│ 非标准阶段待核          │ 27   │
│ 父状态与子图真值冲突    │ 13   │
│ 终态父单仍有失败节点    │ 12   │
│ 尚未进入实现链路        │ 11   │
│ 等待 evaluator/sidecar  │ 2    │
│ 失败或异常状态          │ 1    │
└─────────────────────────┴──────┘
```

## 待开发 / 待收口

> 共 `134` 张，按 `error -> reconcile -> evaluator -> builder_or_eval -> intake -> other`、优先级和高进度优先排序。

### 错误修复 (13)

- [ ] **P0 | 请为 solar-harness 开一个新的 P0/P1 聚焦执行单：GEPA Requirement Compiler · 核心实现与数据模型**
  - ID：`sprint-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler-s03-core-runtime`
  - 真值：`error` · `passed/finalized` · `88%` · 更新 `2026-08-09T18:13:21+00:00`
  - 卡点：父状态终态但失败节点仍存在: B6_compat_repair
  - 实际交付代码：`harness/lib/compile_eval/dataset.py`；`harness/lib/compile_eval/dataset_loader.py`；`harness/lib/compiler_profile/__init__.py`；`harness/lib/compiler_profile/resolver.py`；`harness/schemas/dataset.schema.json`；`harness/schemas/eval-case.schema.json`；`harness/tests/test_compile_eval_dataset.py`；`harness/tests/test_compiler_profile_active_profile.py`；`harness/tools/compiler_profile/__init__.py`；`harness/tools/compiler_profile/resolver.py`
  - 计划代码范围：`harness/lib/compile_eval`；`harness/lib/compiler_profile`；`harness/tests/compile_eval`；`harness/tests/compiler_profile`；`harness/tests/integrations/gepa_optimizer`；`harness/tests/test_antigravity_ingress_schema.py`；`harness/tests/test_codex_pm_router.py`；`harness/tests/test_compile_eval`；`harness/tests/test_compiler_profile`；`harness/tests/test_core_runtime_compat.py`；`harness/tests/test_gepa_optimizer_release.py`；`harness/tests/test_intent_consumer.py`；另 5 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler-s03-core-runtime.task_graph.json`；`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler-s03-core-runtime.eval.json`

- [ ] **P0 | P0 修复单：把 capability/risk/cost 三张画像从配置层升级为 runtime 强约束 · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束-s03-core-runtime`
  - 真值：`error` · `passed/finalized` · `83%` · 更新 `2026-08-09T16:54:24+00:00`
  - 卡点：父状态终态但失败节点仍存在: S5
  - 实际交付代码：`harness/config/agent-actors.json`；`harness/config/agent-actors.schema.json`；`harness/config/logical-operators.json`；`harness/config/logical-operators.schema.json`；`harness/lib/actor_profiles.py`；`harness/lib/actor_runtime.py`；`harness/lib/evidence_ledger.py`；`harness/lib/execution_broker.py`；`harness/lib/logical_operator_router.py`；`harness/lib/operator_score.py`；`harness/tests/runtime/test_actor_profiles.py`；`harness/tests/runtime/test_actor_runtime.py`；另 6 项
  - 计划代码范围：`harness/config/agent-actors.json`；`harness/config/agent-actors.schema.json`；`harness/config/logical-operators.json`；`harness/config/logical-operators.schema.json`；`harness/lib/actor_profiles.py`；`harness/lib/actor_runtime.py`；`harness/lib/evidence_ledger.py`；`harness/lib/execution_broker.py`；`harness/lib/logical_operator_router.py`；`harness/lib/operator_score.py`；`harness/tests/runtime/test_actor_profiles.py`；`harness/tests/runtime/test_actor_runtime.py`；另 7 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束-s03-core-runtime.task_graph.json`

- [ ] **P0 | P0 修复单：把验证做成 DAG 强制结构，不允许 writer 自证完成 · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成-s04-orchestration-ui`
  - 真值：`error` · `passed/completed` · `83%` · 更新 `2026-08-10T22:47:05+00:00`
  - 卡点：父状态终态但失败节点仍存在: V1_INDEPENDENT_REVIEW
  - 实际交付代码：`harness/lib/compiled_sprint_review_closeout.py`；`harness/status-server/routes/orchestration_routes.py`；`harness/tests/runtime/test_actor_runtime.py`；`harness/tests/test_compiled_sprint_review_closeout.py`；`harness/tests/test_dispatch_evidence.py`；`harness/tests/test_dispatch_scheduler.py`；`harness/tests/test_orchestration_routes.py`；`harness/tests/test_pm_dispatch.py`；`harness/tests/test_status_server_orchestration.py`；`harness/tools/compiled_sprint_review_closeout.py`；`harness/tools/dispatch_scheduler.py`；`harness/tools/graph_node_dispatcher.py`；另 4 项
  - 计划代码范围：`harness/tests/regression/test-triface-graph_node_dispatcher.py`；`harness/tests/runtime/test_actor_runtime.py`；`harness/tests/test_compiled_sprint_review_closeout.py`；`harness/tests/test_dispatch_scheduler.py`；`harness/tests/test_orchestration_routes.py`；`harness/tests/test_pm_dispatch.py`；`harness/tests/test_status_server_orchestration.py`；`harness/tools/compiled_sprint_review_closeout.py`；`harness/tools/dispatch_scheduler.py`；`harness/tools/graph_node_dispatcher.py`；`harness/tools/pm_dispatch.py`；`harness/ui/orchestration/index.html`；另 2 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成-s04-orchestration-ui.task_graph.json`

- [ ] **P0 | P0 修复单：把 Evidence Ledger 从 JSONL 索引升级为可审计的完整 runs 证据链 · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链-s04-orchestration-ui`
  - 真值：`error` · `passed/completed` · `83%` · 更新 `2026-08-10T22:47:09+00:00`
  - 卡点：父状态终态但失败节点仍存在: O6_s04_integration_regression_closeout
  - 实际交付代码：`harness/lib/autopilot.py`；`harness/lib/dispatch_package.py`；`harness/lib/dispatch_prompt_injector.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/orchestration/run_evidence_projection.py`；`harness/schemas/dispatch-package.schema.json`；`harness/tests/livework/test_ui_template.py`；`harness/tests/orchestration/test_dispatch_gate_hint.py`；`harness/tests/orchestration/test_epic_status_view.py`；`harness/tests/orchestration/test_pane_evidence_gate.py`；`harness/tests/orchestration/test_run_evidence_projection.py`；另 9 项
  - 计划代码范围：`harness/lib/autopilot.py`；`harness/lib/dispatch_package.py`；`harness/lib/dispatch_prompt_injector.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/orchestration`；`harness/lib/pane_handoff`；`harness/reports`；`harness/status-server/research_routes.py`；`harness/status-server/routes/orchestration_routes.py`；`harness/status-server/static/orchestration_panel.css`；`harness/status-server/static/orchestration_panel.js`；另 21 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链-s04-orchestration-ui.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链-s04-orchestration-ui.handoff.md`

- [ ] **P0 | P0 修复单：把 Agent Plan Optimizer 从静态映射升级为 skills/MCP/capsules/p · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-把-agent-plan-optimizer-从静态映射升级为-skills-mcp-capsules-p-s03-core-runtime`
  - 真值：`error` · `passed/completed` · `80%` · 更新 `2026-08-10T22:46:48+00:00`
  - 卡点：父状态终态但失败节点仍存在: N5
  - 实际交付代码：`harness/config/capability-capsules/cap.flashmlx-performance-debugger.yaml`；`harness/config/logical-operators.json`；`harness/config/skill-operator-bindings.yaml`；`harness/config/task-classification-taxonomy.json`；`harness/lib/apo_plan_compiler.py`；`harness/schemas/apo-planner-artifact.v1.json`；`harness/schemas/draft/workflow-stage-skill-resolution.v1.draft.json`；`harness/schemas/task-classification-taxonomy.v1.json`；`harness/schemas/task-classification.v1.json`；`harness/skills/registry.yaml`
  - 计划代码范围：`harness/config/capability-capsules`；`harness/config/logical-operators.json`；`harness/config/skill-operator-bindings.yaml`；`harness/config/task-classification-taxonomy.json`；`harness/lib/actor_runtime.py`；`harness/lib/apo_plan_compiler.py`；`harness/lib/capability_capsules.py`；`harness/lib/evidence_ledger.py`；`harness/lib/graph_scheduler.py`；`harness/lib/skill_operator_registry.py`；`harness/lib/solar_skills.py`；`harness/schemas/draft`；另 1 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-agent-plan-optimizer-从静态映射升级为-skills-mcp-capsules-p-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-agent-plan-optimizer-从静态映射升级为-skills-mcp-capsules-p-s03-core-runtime.task_graph.json`

- [ ] **P0 | GEPA Requirement Compiler 外循环第二阶段 · 架构设计与接口契约**
  - ID：`sprint-20260531-gepa-requirement-compiler-外循环第二阶段-s02-architecture`
  - 真值：`error` · `passed/planning_complete` · `80%` · 更新 `2026-08-10T22:47:32+00:00`
  - 卡点：父状态终态但失败节点仍存在: N5_orchestration_obs
  - 实际交付代码：`harness/integrations/gepa_optimizer/asi_adapter.py`；`harness/integrations/gepa_optimizer/evaluator.py`
  - 计划代码范围：`harness/integrations/gepa_optimizer/asi_adapter.py`；`harness/integrations/gepa_optimizer/cli.py`；`harness/integrations/gepa_optimizer/evaluator.py`；`harness/integrations/gepa_optimizer/governance.py`；`harness/integrations/gepa_optimizer/promote.py`；`harness/integrations/gepa_optimizer/runner.py`；`harness/lib/compile_eval`；`harness/lib/compile_eval/splits`；`harness/lib/compiler_profile`；`harness/state`；`harness/status-server`；`harness/tools`；另 2 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-gepa-requirement-compiler-外循环第二阶段-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260531-gepa-requirement-compiler-外循环第二阶段-s02-architecture.task_graph.json`

- [ ] **P0 | P0 修复单：把 capability token 从 helper/schema 提升为 runtime 权限执行边界 · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s05-verification-release`
  - 真值：`error` · `passed/planning_complete` · `36%` · 更新 `2026-08-10T22:46:59+00:00`
  - 卡点：父状态终态但失败节点仍存在: B1_v1_token_expiry,B4_v4_network_scope
  - 实际交付代码：`harness/lib/browser_job_runtime.py`；`harness/lib/capability_token.py`；`harness/tests/verification/_audit_assert.py`；`harness/tests/verification/conftest.py`；`harness/tests/verification/fixtures/token_full_scope_v2.json`；`harness/tests/verification/fixtures/token_minimal_v2.json`；`harness/tests/verification/fixtures/token_revoked_v2.json`；`harness/tests/verification/fixtures/token_v1.json`；`harness/tests/verification/test_v1_token_expiry.py`；`harness/tests/verification/test_v2_file_scope.py`；`harness/tests/verification/test_v3_shell_scope.py`；`harness/tests/verification/test_v4_network_scope.py`；另 2 项
  - 计划代码范围：`harness/schemas/capability-verification-summary.schema.json`；`harness/tests/security/test_no_raw_token_leak.py`；`harness/tests/verification/_audit_assert.py`；`harness/tests/verification/conftest.py`；`harness/tests/verification/fixtures`；`harness/tests/verification/test_v1_token_expiry.py`；`harness/tests/verification/test_v2_file_scope.py`；`harness/tests/verification/test_v3_shell_scope.py`；`harness/tests/verification/test_v4_network_scope.py`；`harness/tests/verification/test_v5_git_scope.py`；`harness/tests/verification/test_v6_parity.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s05-verification-release.handoff.md`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 总体架构升级单，正式命名为： · 调度、自动化与可视化**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s04-orchestration-ui`
  - 真值：`error` · `passed/completed` · `33%` · 更新 `2026-08-11T00:21:17+00:00`
  - 卡点：父状态终态但失败节点仍存在: O2_dispatch_chain,O3_operator_ack_hygiene,O4_status_ui_p…
  - 实际交付代码：`harness/lib/packages/orchestration_ui/__init__.py`；`harness/lib/packages/orchestration_ui/dispatch_trace.py`；`harness/lib/packages/orchestration_ui/operator_evidence.py`；`harness/lib/packages/orchestration_ui/status_projection.py`；`harness/lib/packages/orchestration_ui/trace_model.py`；`harness/lib/packages/orchestration_ui/trace_writer.py`；`harness/lib/packages/orchestration_ui/verifier.py`；`harness/schemas/orchestration-execution-trace.schema.json`；`harness/tests/test_orchestration_ui_dispatch.py`；`harness/tests/test_orchestration_ui_operator_runtime.py`；`harness/tests/test_orchestration_ui_status.py`；`harness/tests/test_orchestration_ui_trace.py`；另 1 项
  - 计划代码范围：`harness/lib/actor_runtime.py`；`harness/lib/autopilot.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/livework/dispatch_visibility.py`；`harness/lib/livework/state_aggregator.py`；`harness/lib/packages/orchestration_ui`；`harness/lib/pane_lease.py`；`harness/lib/symphony/status-server.py`；`harness/schemas/orchestration-execution-trace.schema.json`；`harness/tests/fixtures/orchestration_ui`；`harness/tests/test_orchestration_ui_dispatch.py`；另 8 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s04-orchestration-ui.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s04-orchestration-ui.eval.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s04-orchestration-ui.handoff.md`

- [ ] **P0 | P0: AI Influence YouTube 报告流质量增强 — Report IR + 逐章写作 + Deep W · 验证、回归与发布证据**
  - ID：`sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s05-verification-release`
  - 真值：`error` · `passed/planning_complete` · `33%` · 更新 `2026-08-10T22:47:36+00:00`
  - 卡点：父状态终态但失败节点仍存在: V3,V5,V6
  - 实际交付代码：`harness/tests/fixtures/ai_influence_report/negative/manifest.json`；`harness/tests/test_ai_influence_youtube_report_negative_controls.py`；`harness/tests/test_report_deep_verifier_repair.py`；`harness/tests/test_report_quality_score.py`
  - 计划代码范围：`harness/docs/ai_influence_youtube_report_release_runbook.md`；`harness/tests/fixtures/ai_influence_report/negative`；`harness/tests/fixtures/ai_influence_report/w21`；`harness/tests/fixtures/ai_influence_report/w22`；`harness/tests/test_ai_influence_youtube_report_activation_proof.py`；`harness/tests/test_ai_influence_youtube_report_e2e_w21.py`；`harness/tests/test_ai_influence_youtube_report_e2e_w22.py`；`harness/tests/test_ai_influence_youtube_report_epic_gate_close.py`；`harness/tests/test_ai_influence_youtube_report_negative_controls.py`；`harness/tests/test_report_deep_verifier_repair.py`；`harness/tests/test_report_pipeline_regression.py`；`harness/tests/test_report_quality_score.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s05-verification-release.eval.json`；`~/.solar/harness/sprints/sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s05-verification-release.handoff.md`

- [ ] **P0 | P0 修复单：把上下文主权收口到 Context Store，压缩长寿 pane 记忆污染路径 · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s04-orchestration-ui`
  - 真值：`error` · `passed/planning_complete` · `25%` · 更新 `2026-08-10T22:47:03+00:00`
  - 卡点：父状态终态但失败节点仍存在: N1_activation_trace_bridge,N2_status_context_projection
  - 实际交付代码：`harness/lib/graph_scheduler.py`；`harness/lib/livework/dispatch_visibility.py`；`harness/lib/packages/orchestration_ui/dispatch_trace.py`；`harness/lib/packages/orchestration_ui/status_projection.py`；`harness/tests/livework/test_dispatch_visibility.py`；`harness/tests/test_orchestration_ui_status.py`；`harness/tests/test_s04_activation_graph_route.py`；`harness/tests/test_s04_activation_mailbox_dispatch.py`；`harness/tools/autopilot.py`；`harness/tools/livework/dispatch_visibility.py`
  - 计划代码范围：`harness/lib/graph_scheduler.py`；`harness/lib/livework/dispatch_visibility.py`；`harness/lib/multi_task_status.py`；`harness/lib/packages/orchestration_ui/dispatch_trace.py`；`harness/lib/packages/orchestration_ui/status_projection.py`；`harness/lib/packages/orchestration_ui/verifier.py`；`harness/status-server/static/orchestration_panel.css`；`harness/status-server/static/orchestration_panel.js`；`harness/status-server/templates/orchestration_panel.html`；`harness/tests/livework/test_dispatch_visibility.py`；`harness/tests/orchestration_ui`；`harness/tests/orchestration_ui/test_epic_status_view.py`；另 10 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s04-orchestration-ui.task_graph.json`

- [ ] **P0 | P0 修复单：把验证做成 DAG 强制结构，不允许 writer 自证完成 · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成-s05-verification-release`
  - 真值：`error` · `passed/handoff_ready` · `17%` · 更新 `2026-08-10T22:47:07+00:00`
  - 卡点：父状态终态但失败节点仍存在: R2_RUNTIME_REGRESSION,R3_ORCH_RELEASE_REGRESSION
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成-s05-verification-release.task_graph.json`

- [ ] **P0 | 需求单：APO v2 Lease / Quota / Cost-Aware Agent Plan Optimizer · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-需求单-apo-v2-lease-quota-cost-aware-agent-plan-optimizer-s01-requirements`
  - 真值：`error` · `failed_review/eval_failed` · `0%` · 更新 `2026-08-09T17:08:54+00:00`
  - 卡点：状态异常: failed_review/eval_failed
  - 实际交付代码：`harness/config/apo-config.json`；`harness/lib/apo_cli.py`；`harness/lib/apo_config.py`；`harness/lib/apo_enforcer_rules.py`；`harness/lib/apo_explain.py`；`harness/lib/apo_feedback.py`；`harness/lib/apo_plan_compiler.py`；`harness/lib/apo_shadow.py`；`harness/tests/test_apo_enforcer_rules.py`；`harness/tests/test_apo_explain.py`；`harness/tests/test_apo_feedback.py`；`harness/tests/test_apo_plan_compiler.py`；另 1 项
  - 计划代码范围：`harness/config/apo-config.json`；`harness/config/apo-weights.json`；`harness/lib/apo_config.py`；`harness/lib/apo_cost_model.py`；`harness/lib/apo_enforcer_rules.py`；`harness/lib/apo_explain.py`；`harness/lib/apo_feedback.py`；`harness/lib/apo_plan_compiler.py`；`harness/lib/apo_shadow.py`；`harness/tests/test_apo_cost_model.py`；`harness/tests/test_apo_enforcer_rules.py`；`harness/tests/test_apo_explain.py`；另 3 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-需求单-apo-v2-lease-quota-cost-aware-agent-plan-optimizer-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-需求单-apo-v2-lease-quota-cost-aware-agent-plan-optimizer-s01-requirements.task_graph.json`

- [ ] **N/A | sprint-20260605-060742-intent-browser-agent-requirement-pa-81144b2e**
  - ID：`sprint-20260605-060742-intent-browser-agent-requirement-pa-81144b2e`
  - 真值：`error` · `passed/completed` · `50%` · 更新 `2026-08-10T22:47:49+00:00`
  - 卡点：父状态终态但失败节点仍存在: S4
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib`；`harness/schemas`；`harness/tests`；`harness/tools`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260605-060742-intent-browser-agent-requirement-pa-81144b2e.status.json`；`~/.solar/harness/sprints/sprint-20260605-060742-intent-browser-agent-requirement-pa-81144b2e.task_graph.json`

### 状态对账 (13)

- [ ] **P0 | P0 修复单：从 pane lease 升级到 actor lease，并补齐生命周期状态机**
  - ID：`epic-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机`
  - 真值：`warn` · `passed/completed` · `90%` · 更新 `2026-06-16T07:37:26+00:00`
  - 卡点：父状态终态但未完成节点仍存在: S05_verification_release
  - 实际交付代码：`harness/tests/livework/test_integration_s04.py`；`harness/tests/orchestration/test_autopilot_capability_routing.py`；`harness/tests/orchestration/test_orchestration_routes.py`；`harness/tests/runtime/test_actor_lease.py`；`harness/tests/test_actor_observability.py`；`harness/tests/test_operator_status_observability.py`
  - 计划代码范围：`harness/config/agent-actors.schema.json`；`harness/config/physical-operators.schema.json`；`harness/lib/actor_lease.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/multi_task_status.py`；`harness/lib/operator_runtime.py`；`harness/lib/pane_lease.py`；`harness/lib/runtime_status.py`；`harness/tests/graph/test_graph_dispatch_lease_busy.py`；`harness/tests/livework/test_integration_s04.py`；`harness/tests/orchestration/test_autopilot_capability_routing.py`；`harness/tests/orchestration/test_orchestration_routes.py`；另 14 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是“把 Mirage 从统一 VFS wrapper**
  - ID：`epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把-mirage-从统一-vfs-wrapper`
  - 真值：`warn` · `passed/completed` · `90%` · 更新 `2026-06-14T23:51:29+00:00`
  - 卡点：父状态终态但未完成节点仍存在: S04_orchestration_ui
  - 实际交付代码：`harness/tests/verification/s05/test_s05_activation_proof.py`；`harness/tests/verification/s05/test_s05_doctor.py`；`harness/tests/verification/s05/test_s05_e2e_pipeline.py`；`harness/tests/verification/s05/test_s05_evidence_ledger.py`；`harness/tests/verification/s05/test_s05_negative_context_usage.py`；`harness/tests/verification/s05/test_s05_search_sidecar.py`；`harness/tools/evidence/replay_context_ledger.py`
  - 计划代码范围：`harness/lib/*.py`；`harness/tests/**/*.py`；`harness/tests/verification/s05/test_s05_activation_proof.py`；`harness/tests/verification/s05/test_s05_doctor.py`；`harness/tests/verification/s05/test_s05_e2e_pipeline.py`；`harness/tests/verification/s05/test_s05_evidence_ledger.py`；`harness/tests/verification/s05/test_s05_negative_context_usage.py`；`harness/tests/verification/s05/test_s05_search_sidecar.py`；`harness/tools/evidence/replay_context_ledger.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把-mirage-从统一-vfs-wrapper.status.json`；`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把-mirage-从统一-vfs-wrapper.task_graph.json`

- [ ] **P0 | P0 修复单：把 failure fingerprint 从 task-type penalty 升级为按 operat · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s03-core-runtime`
  - 真值：`warn` · `passed/completed` · `83%` · 更新 `2026-08-10T22:47:12+00:00`
  - 卡点：父状态终态但未完成节点仍存在: S03-R5-status-projection
  - 实际交付代码：`harness/config/capability-token.schema.json`；`harness/lib/actor_runtime.py`；`harness/lib/evidence_ledger.py`；`harness/lib/failure_fingerprint.py`；`harness/lib/multi_task_status.py`；`harness/lib/operator_score.py`；`harness/tests/runtime/test_operator_score.py`；`harness/tests/test_actor_dispatch_bridge.py`；`harness/tests/test_actor_observability.py`；`harness/tests/test_capability_token_schema.py`；`harness/tests/test_evidence_ledger.py`；`harness/tests/test_failure_fingerprint_scoring.py`
  - 计划代码范围：`harness/config/capability-token.schema.json`；`harness/lib/actor_runtime.py`；`harness/lib/evidence_ledger.py`；`harness/lib/failure_fingerprint.py`；`harness/lib/multi_task_status.py`；`harness/lib/operator_score.py`；`harness/tests/runtime/test_operator_score.py`；`harness/tests/test_actor_dispatch_bridge.py`；`harness/tests/test_actor_observability.py`；`harness/tests/test_capability_token_schema.py`；`harness/tests/test_evidence_ledger.py`；`harness/tests/test_failure_fingerprint_scoring.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s03-core-runtime.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s03-core-runtime.eval.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 总体架构升级单，正式命名为： · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s01-requirements`
  - 真值：`warn` · `passed/planning_complete` · `83%` · 更新 `2026-08-11T00:23:33+00:00`
  - 卡点：父状态终态但未完成节点仍存在: N4_verification_risk_matrix
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s01-requirements.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s01-requirements.handoff.md`

- [ ] **P0 | P0 修复单：把 Antigravity 收口到 fan-out / exploration 位，禁止进入最终裁决位 · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s04-orchestration-ui`
  - 真值：`warn` · `passed/completed` · `80%` · 更新 `2026-08-10T22:46:56+00:00`
  - 卡点：父状态终态但未完成节点仍存在: N5_smoke_handoff
  - 实际交付代码：`harness/tests/test_antigravity_dispatch_evidence.py`；`harness/tests/test_antigravity_placement_view.py`；`harness/tests/test_orchestration_antigravity_routes.py`；`harness/tests/test_orchestration_antigravity_static.py`；`harness/tools/antigravity_orchestration_view.py`；`harness/tools/antigravity_placement_view.py`；`harness/tools/evidence_ledger.py`；`harness/tools/pane_handoff/dispatch_evidence_writer.py`；`harness/tools/pm_dispatch.py`；`harness/tools/smoke/antigravity_orchestration_ui_smoke.py`；`harness/ui/orchestration/index.html`；`harness/ui/orchestration/main.js`；另 1 项
  - 计划代码范围：`harness/tests/test_antigravity_dispatch_evidence.py`；`harness/tests/test_antigravity_placement_view.py`；`harness/tests/test_orchestration_antigravity_routes.py`；`harness/tests/test_orchestration_antigravity_static.py`；`harness/tools/antigravity_orchestration_view.py`；`harness/tools/antigravity_placement_view.py`；`harness/tools/evidence_ledger.py`；`harness/tools/orchestration_smoke.py`；`harness/tools/pane_handoff/dispatch_evidence_writer.py`；`harness/tools/pm_dispatch.py`；`harness/tools/smoke/antigravity_orchestration_ui_smoke.py`；`harness/ui/orchestration/index.html`；另 2 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s04-orchestration-ui.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s04-orchestration-ui.eval.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s04-orchestration-ui.handoff.md`

- [ ] **P0 | P0 修复单：把 OperatorScore 从公式/测试层升级为 runtime 主评分与本地任务证据闭环 · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环-s04-orchestration-ui`
  - 真值：`warn` · `passed/completed` · `75%` · 更新 `2026-08-10T22:47:15+00:00`
  - 卡点：父状态终态但未完成节点仍存在: N3_orchestration_ui_rendering
  - 实际交付代码：`harness/tests/test_orchestration_routes.py`；`harness/tests/test_orchestration_ui_smoke.py`；`harness/ui/orchestration/main.js`
  - 计划代码范围：`harness/status-server/routes/orchestration_routes.py`；`harness/tests/test_orchestration_routes.py`；`harness/tests/test_orchestration_ui_smoke.py`；`harness/tests/test_orchestration_ui_status.py`；`harness/tests/test_s04_orchestration_ui_smoke.py`；`harness/tests/test_status_server_orchestration.py`；`harness/ui/orchestration/index.html`；`harness/ui/orchestration/main.js`；`harness/ui/orchestration/styles.css`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环-s04-orchestration-ui.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环-s04-orchestration-ui.handoff.md`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 优化器架构升级单，目标不是简单“接入一个 GEPA 包”或“套一个 · 调度、自动化与可视化**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s04-orchestration-ui`
  - 真值：`warn` · `passed/completed` · `75%` · 更新 `2026-08-10T22:56:28+00:00`
  - 卡点：父状态终态但未完成节点仍存在: N1_runtime_activation_evidence
  - 实际交付代码：`harness/tests/livework/test_ui_template.py`；`harness/tests/orchestration/test_capability_panel_dom.py`；`harness/tests/test_orchestration_ui_smoke.py`；`harness/tests/test_s04_activation_graph_route.py`；`harness/tests/test_s04_orchestration_routes.py`；`harness/tools/autopilot.py`；`harness/ui/orchestration/main.js`
  - 计划代码范围：`harness/tests/livework/test_ui_template.py`；`harness/tests/orchestration/test_capability_panel_dom.py`；`harness/tests/orchestration/test_orchestration_routes.py`；`harness/tests/test-status-server-task-graph-gate-audit.py`；`harness/tests/test_autopilot_capability_routing.py`；`harness/tests/test_orchestration_ui_smoke.py`；`harness/tests/test_s04_activation_graph_route.py`；`harness/tests/test_s04_orchestration_routes.py`；`harness/tools/autopilot.py`；`harness/tools/solar-autopilot-monitor.py`；`harness/ui/orchestration/main.js`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s04-orchestration-ui.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s04-orchestration-ui.eval.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s04-orchestration-ui.handoff.md`

- [ ] **P0 | P0 修复单：去除 tmux send-keys 作为主任务协议，收口到 operatord mailbox runti**
  - ID：`epic-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti`
  - 真值：`warn` · `passed/completed` · `70%` · 更新 `2026-07-02T22:04:56+00:00`
  - 卡点：父状态终态但未完成节点仍存在: S03_core_runtime,S05_verification_release
  - 实际交付代码：`harness/config/task-envelope.schema.json`；`harness/docs/mailbox-migration-runbook.md`；`harness/docs/mailbox-protocol.md`；`harness/docs/operatord-runtime.md`；`harness/lib/actor_mailbox.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/pane_mailbox/__init__.py`；`harness/lib/pane_mailbox/api.pyi`；`harness/tests/test_operatord_daemon.py`；`harness/tools/__init__.py`；`harness/tools/autopilot.py`；`harness/tools/dispatch_scheduler.py`；另 8 项
  - 计划代码范围：`harness/config/task-envelope.schema.json`；`harness/docs/DISPATCH-PROTOCOL.md`；`harness/docs/mailbox-migration-runbook.md`；`harness/docs/mailbox-protocol.md`；`harness/docs/operatord-runtime.md`；`harness/lib/actor_mailbox.py`；`harness/lib/actor_runtime.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/pane_handoff/evidence_validator.py`；`harness/lib/pane_mailbox/__init__.py`；`harness/lib/pane_mailbox/api.pyi`；`harness/tests/runtime/test_actor_mailbox.py`；另 26 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 优化器架构升级单，目标不是简单“接入一个 GEPA 包”或“套一个 · 架构设计与接口契约**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s02-architecture`
  - 真值：`warn` · `passed/completed` · `50%` · 更新 `2026-08-10T19:48:11+00:00`
  - 卡点：父状态终态但未完成节点仍存在: N2_architecture_design,N4_handoff_graph_readiness
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s02-architecture.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s02-architecture.handoff.md`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，把现有的 Capsule-native Agent Pl · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl-s01-requirements`
  - 真值：`warn` · `passed/finalized` · `0%` · 更新 `2026-06-05T02:56:14+00:00`
  - 卡点：父状态终态但未完成节点仍存在: N0,N1,N2,N3,N4
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl-s01-requirements.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl-s01-requirements.eval.json`

- [ ] **P0 | cmux 多标签四分屏 tmux 状态监控工作台 · 调度、自动化与可视化**
  - ID：`sprint-20260531-cmux-多标签四分屏-tmux-状态监控工作台-s04-orchestration-ui`
  - 真值：`warn` · `passed/finalized` · `0%` · 更新 `2026-08-09T16:54:37+00:00`
  - 卡点：父状态终态但未完成节点仍存在: B1_orchestration_api,B2_status_dashboard,B3_evidence_ob…
  - 实际交付代码：N/A
  - 计划代码范围：`harness/tools/cmux_orch.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-cmux-多标签四分屏-tmux-状态监控工作台-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260531-cmux-多标签四分屏-tmux-状态监控工作台-s04-orchestration-ui.task_graph.json`

- [ ] **N/A | RawIntent Consumer Request - mobile auto consume smoke**
  - ID：`sprint-20260525-153720-intent-mobile-auto-consume-smoke-e33e59fb`
  - 真值：`warn` · `passed/planning_complete` · `0%` · 更新 `2026-08-10T22:46:11+00:00`
  - 卡点：父状态终态但未完成节点仍存在: S1,S2,S3,S4,S5
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-153720-intent-mobile-auto-consume-smoke-e33e59fb.status.json`；`~/.solar/harness/sprints/sprint-20260525-153720-intent-mobile-auto-consume-smoke-e33e59fb.task_graph.json`；`~/.solar/harness/sprints/sprint-20260525-153720-intent-mobile-auto-consume-smoke-e33e59fb.handoff.md`

- [ ] **N/A | RawIntent Consumer Request - # Execution Contract**
  - ID：`sprint-20260525-155508-intent-execution-contract-fceccdaa`
  - 真值：`warn` · `passed/finalized` · `0%` · 更新 `2026-07-04T02:53:02+00:00`
  - 卡点：父状态终态但未完成节点仍存在: S1,S2,S3,S4,S5
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-155508-intent-execution-contract-fceccdaa.status.json`；`~/.solar/harness/sprints/sprint-20260525-155508-intent-execution-contract-fceccdaa.task_graph.json`

### Evaluator 收口 (2)

- [ ] **P0 | P0 修复单：把 capability token 从 helper/schema 提升为 runtime 权限执行边界**
  - ID：`epic-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界`
  - 真值：`warn` · `reviewing/handoff_ready` · `100%` · 更新 `2026-06-13T21:00:46+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：`harness/lib/actor_runtime.py`；`harness/lib/browser_job_runtime.py`；`harness/lib/capability_token.py`；`harness/tests/orchestration/test_capability_endpoints.py`；`harness/tests/orchestration/test_capability_panel_dom.py`；`harness/tests/runtime/test_browser_security_policies.py`；`harness/tests/runtime/test_browser_security_policies.py`（session broker + scrubbing + payment/secrets/destructive 默认拦截 + U7 PolicyDecision 等价用例 7 条，共 18 测试）`；`harness/tests/test_actor_runtime_capability.py`；`harness/tests/test_actor_runtime_capability.py`（U8a–h：out_of_scope、shell deny_by_default、allowed、混合 first-allow second-deny、enforcement_off bypass、no-policy-requests、expired token、no-token-legacy，共 8 测试）`；`harness/tests/test_capability_token_runtime.py`；`harness/tests/test_capability_token_runtime.py`（U1 v1 兼容 + U2 check_file + U3 check_shell + U4 check_network + U5 check_git + check_secrets + audit_view redaction + validate_for_lease revoked，共 42 测试）`；`harness/tests/test_capability_token_schema.py`；另 20 项
  - 计划代码范围：`harness/config/capability-token.schema.json`；`harness/lib/actor_runtime.py`；`harness/lib/browser_job_runtime.py`；`harness/lib/capability_observability.py`；`harness/lib/capability_token.py`；`harness/lib/event_ledger.py`；`harness/schemas/capability-decision.schema.json`；`harness/schemas/capability-verification-summary.schema.json`；`harness/tests/observability/test_capability_observability.py`；`harness/tests/orchestration/test_capability_endpoints.py`；`harness/tests/orchestration/test_capability_panel_dom.py`；`harness/tests/runtime/test_browser_security_policies.py`；另 24 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 优化器架构升级单，目标不是简单“接入一个 GEPA 包”或“套一个 · 核心实现与数据模型**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s03-core-runtime`
  - 真值：`warn` · `approved/plan_reviewed` · `71%` · 更新 `2026-08-11T00:20:04+00:00`
  - 卡点：reviewing 但缺 eval sidecar
  - 实际交付代码：`harness/lib/compat/legacy_adapter.py`；`harness/tests/fixtures/compat`；`harness/tests/fixtures/state/fixture_events.jsonl`；`harness/tests/fixtures/state/fixture_status.json`；`harness/tests/runtime/test_state_machine_persistence.py`；`harness/tests/test_runtime_compat_adapters.py`
  - 计划代码范围：`harness/tests/**/fixtures/compat`；`harness/tests/**/fixtures/evidence`；`harness/tests/**/fixtures/ir`；`harness/tests/**/fixtures/replay`；`harness/tests/**/fixtures/state`；`harness/tests/**/test_*attempt`；`harness/tests/**/test_*compat`；`harness/tests/**/test_*evaluator`；`harness/tests/**/test_*ir`；`harness/tests/**/test_*replay`；`harness/tests/**/test_*state`；`harness/tests/**/test_*trace`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s03-core-runtime.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s03-core-runtime.handoff.md`

### Builder / Eval 推进 (68)

- [ ] **P0 | 请为 solar-harness 开一个新的 P0/P1 架构升级单，主题是：基于 GEPA optimize_anyt**
  - ID：`epic-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt`
  - 真值：`warn` · `active/planning_complete` · `100%` · 更新 `2026-06-05T11:39:19+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：`harness/lib/compile_eval/asi_components/__init__.py`；`harness/lib/compile_eval/asi_components/contract_compiler.py`；`harness/lib/compile_eval/asi_components/dag_compiler.py`；`harness/lib/compile_eval/asi_components/evidence.py`；`harness/lib/compile_eval/asi_components/handoff.py`；`harness/lib/compile_eval/asi_components/intake.py`；`harness/lib/compile_eval/asi_components/requirement_ir.py`；`harness/lib/compile_eval/asi_trace.py`；`harness/lib/compile_eval/eval_runtime.py`；`harness/lib/compile_eval/harness.py`；`harness/lib/compile_eval/tests/test_asi_components.py`；`harness/lib/compile_eval/tests/test_e2e_core_runtime.py`；另 7 项
  - 计划代码范围：`harness/bin/solar-compile-eval-e2e`；`harness/lib/compile_eval/asi_components/__init__.py`；`harness/lib/compile_eval/asi_components/contract_compiler.py`；`harness/lib/compile_eval/asi_components/dag_compiler.py`；`harness/lib/compile_eval/asi_components/evidence.py`；`harness/lib/compile_eval/asi_components/handoff.py`；`harness/lib/compile_eval/asi_components/intake.py`；`harness/lib/compile_eval/asi_components/requirement_ir.py`；`harness/lib/compile_eval/e2e`；`harness/lib/compile_eval/eval_runtime.py`；`harness/lib/compile_eval/hard_validators.py`；`harness/lib/compile_eval/harness.py`；另 41 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt.status.json`；`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt.task_graph.json`

- [ ] **P0 | P0 修复单：把现有 GEPA Stage 1 substrate 升级为 Solar Optimizer 的离线元优化 · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s03-core-runtime`
  - 真值：`warn` · `active/planning_complete` · `90%` · 更新 `2026-08-10T00:50:50+00:00`
  - 卡点：pending nodes: H1
  - 实际交付代码：`harness/integrations/gepa_optimizer/evaluator.py`；`harness/integrations/gepa_optimizer/evaluator.py` (+26 lines net)`；`harness/integrations/gepa_optimizer/loop/__init__.py`；`harness/integrations/gepa_optimizer/loop/__init__.py`：导出 `CandidateMetadata / FailureEventReason / IllegalTransition / LoopState / LoopStateSnapshot / LoopTransition / EvolutionLoop`。`；`harness/integrations/gepa_optimizer/loop/state_machine.py`；`harness/integrations/gepa_optimizer/loop/state_machine.py`：实现 FSM 与持久化逻辑。`；`harness/tests/integrations/gepa_optimizer/test_adapter_evaluator_promoter.py`；`harness/tests/integrations/gepa_optimizer/test_asi_mapper.py`；`harness/tests/integrations/gepa_optimizer/test_candidate_schema.py`；`harness/tests/integrations/gepa_optimizer/test_candidate_store.py`；`harness/tests/integrations/gepa_optimizer/test_evaluator.py`；`harness/tests/integrations/gepa_optimizer/test_evaluator.py` (+126 lines)`；另 2 项
  - 计划代码范围：`harness/integrations/gepa_optimizer/__init__.py`；`harness/integrations/gepa_optimizer/adapter.py`；`harness/integrations/gepa_optimizer/artifact_store.py`；`harness/integrations/gepa_optimizer/backend.py`；`harness/integrations/gepa_optimizer/candidate_schema.py`；`harness/integrations/gepa_optimizer/cli.py`；`harness/integrations/gepa_optimizer/compile_backend.py`；`harness/integrations/gepa_optimizer/evaluator.py`；`harness/integrations/gepa_optimizer/evidence/EVIDENCE_SCHEMA_AUDIT.md`；`harness/integrations/gepa_optimizer/evidence/__init__.py`；`harness/integrations/gepa_optimizer/evidence/asi_mapper.py`；`harness/integrations/gepa_optimizer/loop/__init__.py`；另 15 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s03-core-runtime.task_graph.json`

- [ ] **P0 | P0 修复单：把 Agent Plan Optimizer 从静态映射升级为 skills/MCP/capsules/p**
  - ID：`epic-20260530-p0-修复单-把-agent-plan-optimizer-从静态映射升级为-skills-mcp-capsules-p`
  - 真值：`warn` · `reviewing/handoff_ready` · `90%` · 更新 `2026-07-01T20:07:13+00:00`
  - 卡点：pending nodes: S05_verification_release
  - 实际交付代码：`harness/config/capability-capsules/cap.flashmlx-performance-debugger.yaml`；`harness/config/logical-operators.json`；`harness/config/skill-operator-bindings.yaml`；`harness/config/task-classification-taxonomy.json`；`harness/lib/apo_plan_compiler.py`；`harness/lib/dispatch_prompt_injector.py`；`harness/schemas/apo-planner-artifact.v1.json`；`harness/schemas/dispatch-package.schema.json`；`harness/schemas/draft/workflow-stage-skill-resolution.v1.draft.json`；`harness/schemas/task-classification-taxonomy.v1.json`；`harness/schemas/task-classification.v1.json`；`harness/skills/registry.yaml`；另 6 项
  - 计划代码范围：`harness/config/capability-capsules`；`harness/config/capability-capsules.registry.yaml`；`harness/config/logical-operators.json`；`harness/config/skill-operator-bindings.yaml`；`harness/config/task-classification-taxonomy.json`；`harness/lib/actor_runtime.py`；`harness/lib/apo_plan_compiler.py`；`harness/lib/capability_capsules.py`；`harness/lib/dispatch_prompt_injector.py`；`harness/lib/evidence_ledger.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；另 38 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-agent-plan-optimizer-从静态映射升级为-skills-mcp-capsules-p.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-agent-plan-optimizer-从静态映射升级为-skills-mcp-capsules-p.task_graph.json`

- [ ] **P0 | P0 修复单：把 Capsule-native Agent OS 的深层设计从 ADR/draft schema 收口到**
  - ID：`epic-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到`
  - 真值：`warn` · `reviewing/handoff_ready` · `90%` · 更新 `2026-07-01T19:49:25+00:00`
  - 卡点：pending nodes: S05_verification_release
  - 实际交付代码：`harness/config/physical-operators.json`；`harness/config/physical-operators.schema.json`；`harness/lib/apo_plan_compiler.py`；`harness/lib/autopilot.py`；`harness/lib/autopilot_capability_routing.py`；`harness/lib/capsule_graph.py`；`harness/lib/operator_runtime.py`；`harness/lib/packages/orchestration_ui/__init__.py`；`harness/lib/packages/orchestration_ui/readiness_metadata.py`；`harness/schemas/draft/capsule-graph.v1.draft.json`；`harness/tests/fixtures/s05_capsule_native_negative/nc_cases.json`；`harness/tests/livework/test_integration_s04.py`；另 17 项
  - 计划代码范围：`harness/config/physical-operators.json`；`harness/config/physical-operators.schema.json`；`harness/lib/apo_plan_compiler.py`；`harness/lib/autopilot.py`；`harness/lib/autopilot_capability_routing.py`；`harness/lib/capability_capsules.py`；`harness/lib/capsule_execution_gate.py`；`harness/lib/capsule_graph.py`；`harness/lib/dispatch_package.py`；`harness/lib/dispatch_prompt_injector.py`；`harness/lib/evidence_ledger.py`；`harness/lib/graph_node_dispatcher.py`；另 53 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到.task_graph.json`

- [ ] **P0 | P0 修复单：把 Evidence Ledger 从 JSONL 索引升级为可审计的完整 runs 证据链**
  - ID：`epic-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链`
  - 真值：`warn` · `reviewing/handoff_ready` · `90%` · 更新 `2026-07-01T20:07:13+00:00`
  - 卡点：pending nodes: S05_verification_release
  - 实际交付代码：`harness/lib/autopilot.py`；`harness/lib/dispatch_package.py`；`harness/lib/dispatch_prompt_injector.py`；`harness/lib/evidence_ledger.py`；`harness/lib/evidence_ledger.py` **[VERIFIED, NOT MODIFIED`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/orchestration/run_evidence_projection.py`；`harness/reports/evidence-ledger-s05-e2e.md`；`harness/reports/evidence-ledger-s05-negative.md`；`harness/reports/evidence-ledger-s05-release-gate.md`；`harness/schemas/dispatch-package.schema.json`；另 24 项
  - 计划代码范围：`harness/README.md`；`harness/lib/actor_runtime.py`；`harness/lib/autopilot.py`；`harness/lib/dispatch_package.py`；`harness/lib/dispatch_prompt_injector.py`；`harness/lib/evidence_ledger.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/orchestration`；`harness/lib/pane_handoff`；`harness/reports`；`harness/reports/evidence-ledger-s05-e2e.md`；另 36 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链.task_graph.json`

- [ ] **P0 | P0 修复单：把 failure fingerprint 从 task-type penalty 升级为按 operat**
  - ID：`epic-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat`
  - 真值：`warn` · `reviewing/handoff_ready` · `90%` · 更新 `2026-07-02T16:52:30+00:00`
  - 卡点：pending nodes: S05_verification_release
  - 实际交付代码：`harness/config/capability-token.schema.json`；`harness/lib/actor_runtime.py`；`harness/lib/evidence_ledger.py`；`harness/lib/failure_fingerprint.py`；`harness/lib/multi_task_status.py`；`harness/lib/operator_score.py`；`harness/tests/fixtures/s05_failure_fingerprint_release/actor_runtime_scoring_events.json`；`harness/tests/fixtures/s05_failure_fingerprint_release/events_negative_controls.json`；`harness/tests/runtime/test_operator_score.py`；`harness/tests/test_actor_dispatch_bridge.py`；`harness/tests/test_actor_observability.py`；`harness/tests/test_capability_token_schema.py`；另 11 项
  - 计划代码范围：`harness/config/capability-token.schema.json`；`harness/lib/actor_runtime.py`；`harness/lib/evidence_ledger.py`；`harness/lib/failure_fingerprint.py`；`harness/lib/multi_task_status.py`；`harness/lib/operator_score.py`；`harness/status-server/routes/orchestration_routes.py`；`harness/status-server/static/orchestration_panel.css`；`harness/status-server/static/orchestration_panel.js`；`harness/status-server/templates/orchestration_panel.html`；`harness/tests/fixtures/s05_failure_fingerprint_release`；`harness/tests/fixtures/s05_multi_task_status_projection`；另 16 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat.task_graph.json`

- [ ] **P0 | P0 修复单：把 Logical Operator / Capsule / Physical Operator 收口到同**
  - ID：`epic-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同`
  - 真值：`warn` · `reviewing/handoff_ready` · `90%` · 更新 `2026-07-01T20:07:13+00:00`
  - 卡点：pending nodes: S05_verification_release
  - 实际交付代码：`harness/config/capability-capsules.registry.yaml`；`harness/config/physical-operators.example.json`；`harness/config/physical-operators.json`；`harness/config/physical-operators.schema.json`；`harness/lib/actor_runtime.py`；`harness/lib/apo_plan_compiler.py`；`harness/lib/apo_runtime_reoptimizer.py`；`harness/lib/capability_capsules.py`；`harness/lib/evidence_ledger.py`；`harness/reports/apo-s05/negative-controls.json`；`harness/reports/apo-s05/negative-controls.md`；`harness/schemas/draft/capability-capsule.v1.draft.json`；另 9 项
  - 计划代码范围：`harness/config/capability-capsules.registry.yaml`；`harness/config/physical-operators.example.json`；`harness/config/physical-operators.json`；`harness/config/physical-operators.schema.json`；`harness/lib/actor_runtime.py`；`harness/lib/apo_plan_compiler.py`；`harness/lib/apo_runtime_reoptimizer.py`；`harness/lib/capability_capsules.py`；`harness/lib/evidence_ledger.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/model_call_runtime.py`；另 30 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同.task_graph.json`

- [ ] **P0 | P0 修复单：把推荐最终架构图收口为 solar-harness 默认主执行脊柱**
  - ID：`epic-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱`
  - 真值：`warn` · `active/planning_complete` · `90%` · 更新 `2026-06-10T00:55:50+00:00`
  - 卡点：pending nodes: S05_verification_release
  - 实际交付代码：`harness/config/agent-actors.json`；`harness/config/agent-hosts.json`；`harness/lib/actor_dispatch_bridge.py`；`harness/lib/actor_runtime.py`；`harness/lib/evidence_ledger.py`；`harness/lib/graph_node_dispatcher.py`；`harness/tests/orchestration/test_epic_status_view.py`；`harness/tests/orchestration/test_orchestration_routes.py`；`harness/tests/test_actor_dispatch_bridge.py`；`harness/tests/test_actor_runtime_contract.py`；`harness/tools/operatord.py`；`harness/ui/orchestration/index.html`；另 2 项
  - 计划代码范围：`harness/lib/actor_dispatch_bridge.py`；`harness/lib/actor_runtime.py`；`harness/lib/evidence_ledger.py`；`harness/lib/graph_node_dispatcher.py`；`harness/tests/control_plane/test-autopilot-pane-gate-reconcile.py`；`harness/tests/control_plane/test-s04-runtime-fallback-negative.sh`；`harness/tests/fixtures/s05_actor_runtime_activation`；`harness/tests/fixtures/s05_negative_controls`；`harness/tests/orchestration/test_autopilot_capability_routing.py`；`harness/tests/orchestration/test_epic_status_view.py`；`harness/tests/orchestration/test_orchestration_routes.py`；`harness/tests/orchestration/test_s04_runtime_surface.py`；另 11 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱.task_graph.json`

- [ ] **P0 | P0 修复单：补齐 Antigravity 2.0 desktop app 作为与 Codex app 对等的 requ**
  - ID：`epic-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ`
  - 真值：`warn` · `reviewing/handoff_ready` · `90%` · 更新 `2026-07-01T20:41:45+00:00`
  - 卡点：pending nodes: S05_verification_release
  - 实际交付代码：`harness/lib/antigravity_bridge.py`；`harness/tests/fixtures/antigravity-ingress/req-lineage-fixture.json`；`harness/tests/orchestration_ui/test_orchestration_routes_antigravity.py`；`harness/tests/test_antigravity_bridge.py`；`harness/tests/test_antigravity_observability.py`；`harness/tests/test_antigravity_rawintent_chain.py`；`harness/tests/test_frontdoor_ingress_parity.py`；`harness/tests/test_intent_consumer.py`；`harness/tools/smoke/antigravity_orchestration_ui_smoke.py`
  - 计划代码范围：`harness/lib/antigravity_bridge.py`；`harness/lib/external-integrations-health.py`；`harness/lib/intent_gateway.py`；`harness/schemas/requirement-ir.schema.json`；`harness/schemas/requirement-ir.schema.v1.draft.json`；`harness/tests/antigravity_release/test_s05_e2e_release.py`；`harness/tests/antigravity_release/test_s05_negative_controls.py`；`harness/tests/fixtures/antigravity-ingress`；`harness/tests/orchestration_ui/__init__.py`；`harness/tests/orchestration_ui/test_autopilot_source_routing.py`；`harness/tests/orchestration_ui/test_lineage_view.py`；`harness/tests/orchestration_ui/test_orchestration_routes_antigravity.py`；另 24 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 总体架构升级单，正式命名为： · 核心实现与数据模型**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s03-core-runtime`
  - 真值：`warn` · `active/planning_complete` · `86%` · 更新 `2026-06-25T16:37:24+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：`harness/bin/solar-harness`；`harness/tests/livework/test_core_runtime_dispatch_smoke.py`；`harness/tests/test_attempt_ledger.py`；`harness/tests/test_core_runtime_compat.py`；`harness/tests/test_execution_trace_ledger.py`；`harness/tests/test_execution_trace_ledger.py` (NEW`；`harness/tests/test_operator_runtime_core.py`；`harness/tools/actor_runtime.py`；`harness/tools/compile_eval/attempt_feed.py`；`harness/tools/core_runtime_trace.py`；`harness/tools/core_runtime_trace.py` (NEW`；`harness/tools/event_ledger.py`；另 8 项
  - 计划代码范围：`harness/bin/solar-harness`；`harness/config/solar-core-runtime-ir.schema.json`；`harness/tests/livework/test_core_runtime_dispatch_smoke.py`；`harness/tests/test_attempt_ledger.py`；`harness/tests/test_core_runtime_compat.py`；`harness/tests/test_core_runtime_ir_schema.py`；`harness/tests/test_execution_trace_ledger.py`；`harness/tests/test_operator_runtime_core.py`；`harness/tests/test_verifier_factory_mvp.py`；`harness/tools/actor_runtime.py`；`harness/tools/compile_eval/attempt_feed.py`；`harness/tools/compile_eval/verifier_plan.py`；另 11 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s03-core-runtime.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s03-core-runtime.handoff.md`

- [ ] **P0 | P0 修复单：收口逻辑算子类型系统为 DAG 第一公民，并对齐 canonical bindings · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-收口逻辑算子类型系统为-dag-第一公民-并对齐-canonical-bindings-s01-requirements`
  - 真值：`warn` · `active/planning_complete` · `83%` · 更新 `2026-06-13T12:28:48+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-收口逻辑算子类型系统为-dag-第一公民-并对齐-canonical-bindings-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-收口逻辑算子类型系统为-dag-第一公民-并对齐-canonical-bindings-s01-requirements.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-收口逻辑算子类型系统为-dag-第一公民-并对齐-canonical-bindings-s01-requirements.handoff.md`

- [ ] **P0 | P0 修复单：把 Antigravity 收口到 fan-out / exploration 位，禁止进入最终裁决位 · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s03-core-runtime`
  - 真值：`warn` · `active/planning_complete` · `83%` · 更新 `2026-08-10T14:48:46+00:00`
  - 卡点：pending nodes: N6_handoff_closeout
  - 实际交付代码：`harness/config/logical-operators.json`；`harness/lib/actor_runtime.py`；`harness/lib/antigravity_bridge.py`；`harness/lib/antigravity_placement_policy.py`；`harness/lib/evidence_ledger.py`；`harness/lib/failure_fingerprint.py`；`harness/lib/logical_operator_router.py`；`harness/lib/operator_score.py`；`harness/tests/test_actor_observability.py`；`harness/tests/test_actor_runtime_capability.py`；`harness/tests/test_antigravity_ingress_chain.py`；`harness/tests/test_antigravity_placement_policy.py`；另 2 项
  - 计划代码范围：`harness/config/logical-operators.json`；`harness/config/logical-operators.schema.json`；`harness/lib/actor_runtime.py`；`harness/lib/antigravity_placement_policy.py`；`harness/lib/evidence_ledger.py`；`harness/lib/failure_fingerprint.py`；`harness/lib/logical_operator_registry.py`；`harness/lib/logical_operator_router.py`；`harness/lib/operator_runtime_core.py`；`harness/lib/operator_score.py`；`harness/tests/test_actor_observability.py`；`harness/tests/test_actor_runtime_capability.py`；另 4 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s03-core-runtime.task_graph.json`

- [ ] **P0 | P0 修复单：把 failure fingerprint 从 task-type penalty 升级为按 operat · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s05-verification-release`
  - 真值：`warn` · `active/planning_complete` · `80%` · 更新 `2026-08-09T20:38:29+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：`harness/lib/multi_task_status.py`；`harness/tests/fixtures/s05_failure_fingerprint_release/actor_runtime_scoring_events.json`；`harness/tests/fixtures/s05_failure_fingerprint_release/events_negative_controls.json`；`harness/tests/test_s05_failure_fingerprint_release.py`；`harness/tests/test_s05_multi_task_status_projection.py`；`harness/tools/multi_task_status.py`
  - 计划代码范围：`harness/lib/multi_task_status.py`；`harness/tests/fixtures/s05_failure_fingerprint_release`；`harness/tests/fixtures/s05_multi_task_status_projection`；`harness/tests/test_s05_failure_fingerprint_release.py`；`harness/tests/test_s05_multi_task_status_projection.py`；`harness/tools/multi_task_status.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s05-verification-release.eval.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s05-verification-release.handoff.md`

- [ ] **P0 | P0 修复单：把现有 capability capsule substrate 升级为完整的 capsule-nativ · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-把现有-capability-capsule-substrate-升级为完整的-capsule-nativ-s02-architecture`
  - 真值：`warn` · `active/planning_complete` · `80%` · 更新 `2026-06-25T23:44:11+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-capability-capsule-substrate-升级为完整的-capsule-nativ-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-capability-capsule-substrate-升级为完整的-capsule-nativ-s02-architecture.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-capability-capsule-substrate-升级为完整的-capsule-nativ-s02-architecture.handoff.md`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0/P1 总体架构升级单，主题是：把现有 Solar Harness 从 · 调度、自动化与可视化**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从-s04-orchestration-ui`
  - 真值：`warn` · `active/planning_complete` · `80%` · 更新 `2026-06-25T16:03:34+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：`harness/tools/autopilot.py`；`harness/tools/dispatch_scheduler.py`；`harness/tools/evidence_ledger.py`；`harness/tools/evidence_ledger.py` (modified`；`harness/tools/ledger_writer.py`；`harness/tools/ledger_writer.py` (modified`；`harness/tools/multi_task_status.py`；`harness/tools/pane_handoff/__init__.py`；`harness/tools/pane_handoff/__init__.py` (modified`；`harness/tools/pane_handoff/dispatch_evidence_writer.py`；`harness/tools/pane_handoff/dispatch_evidence_writer.py` (NEW`；`harness/tools/runtime_bridge.py`；另 4 项
  - 计划代码范围：`harness/tests/orchestration`；`harness/tools/autopilot.py`；`harness/tools/dispatch_scheduler.py`；`harness/tools/evidence_ledger.py`；`harness/tools/ledger_writer.py`；`harness/tools/livework`；`harness/tools/multi_task_status.py`；`harness/tools/pane_handoff`；`harness/tools/runtime_bridge.py`；`harness/tools/symphony/status-server.py`；`harness/ui/orchestration/index.html`；`harness/ui/orchestration/main.js`；另 1 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从-s04-orchestration-ui.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从-s04-orchestration-ui.eval.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从-s04-orchestration-ui.handoff.md`

- [ ] **P0 | P0 修复单：把 capability/risk/cost 三张画像从配置层升级为 runtime 强约束 · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束-s04-orchestration-ui`
  - 真值：`warn` · `active/planning_complete` · `78%` · 更新 `2026-06-28T02:45:17+00:00`
  - 卡点：pending nodes: N8
  - 实际交付代码：`harness/config/agent-actors.json`；`harness/tools/autopilot_decision_capture.py`；`harness/tools/orchestration_activation_snapshot.py`；`harness/tools/orchestration_evidence_writer.py`；`harness/tools/orchestration_smoke.py`；`harness/tools/render_orchestration_evidence_html.py`；`harness/ui/orchestration/index.html`；`harness/ui/orchestration/main.js`；`harness/ui/orchestration/styles.css`
  - 计划代码范围：`harness/state/orchestration/.gitkeep`；`harness/state/orchestration/README.md`；`harness/status-server/routes/orchestration_routes.py`；`harness/status-server/static/orchestration_panel.css`；`harness/status-server/static/orchestration_panel.js`；`harness/status-server/templates/orchestration_panel.html`；`harness/tools/autopilot_decision_capture.py`；`harness/tools/orchestration_activation_snapshot.py`；`harness/tools/orchestration_evidence_writer.py`；`harness/tools/orchestration_smoke.py`；`harness/tools/render_orchestration_evidence_html.py`；`harness/ui/orchestration/index.html`；另 2 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束-s04-orchestration-ui.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束-s04-orchestration-ui.handoff.md`

- [ ] **P0 | P0 修复单：把 Antigravity 收口到 fan-out / exploration 位，禁止进入最终裁决位**
  - ID：`epic-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位`
  - 真值：`warn` · `active/planning_complete` · `70%` · 更新 `2026-06-05T11:39:19+00:00`
  - 卡点：pending nodes: S03_core_runtime,S05_verification_release
  - 实际交付代码：`harness/config/logical-operators.json`；`harness/lib/actor_runtime.py`；`harness/lib/antigravity_bridge.py`；`harness/lib/antigravity_placement_policy.py`；`harness/lib/evidence_ledger.py`；`harness/lib/failure_fingerprint.py`；`harness/lib/logical_operator_registry.py`；`harness/lib/logical_operator_router.py`；`harness/lib/multi_task_status.py`；`harness/lib/operator_runtime.py`；`harness/lib/operator_score.py`；`harness/lib/symphony/status-server.py`；另 20 项
  - 计划代码范围：`harness/config/logical-operators.json`；`harness/config/logical-operators.schema.json`；`harness/lib/actor_runtime.py`；`harness/lib/antigravity_placement_policy.py`；`harness/lib/evidence_ledger.py`；`harness/lib/failure_fingerprint.py`；`harness/lib/logical_operator_registry.py`；`harness/lib/logical_operator_router.py`；`harness/lib/operator_runtime.py`；`harness/lib/operator_runtime_core.py`；`harness/lib/operator_score.py`；`harness/lib/symphony/status-server.py`；另 21 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位.task_graph.json`

- [ ] **P0 | P0 修复单：把 capability/risk/cost 三张画像从配置层升级为 runtime 强约束**
  - ID：`epic-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束`
  - 真值：`warn` · `active/planning_complete` · `70%` · 更新 `2026-06-05T11:39:19+00:00`
  - 卡点：pending nodes: S04_orchestration_ui,S05_verification_release
  - 实际交付代码：`harness/config/agent-actors.json`；`harness/config/agent-actors.schema.json`；`harness/config/logical-operators.json`；`harness/config/logical-operators.schema.json`；`harness/lib/actor_profiles.py`；`harness/lib/actor_runtime.py`；`harness/lib/evidence_ledger.py`；`harness/lib/execution_broker.py`；`harness/lib/logical_operator_router.py`；`harness/lib/operator_score.py`；`harness/tests/runtime/test_actor_profiles.py`；`harness/tests/runtime/test_actor_runtime.py`；另 14 项
  - 计划代码范围：`harness/config/agent-actors.json`；`harness/config/agent-actors.schema.json`；`harness/config/logical-operators.json`；`harness/config/logical-operators.schema.json`；`harness/lib/actor_profiles.py`；`harness/lib/actor_runtime.py`；`harness/lib/evidence_ledger.py`；`harness/lib/execution_broker.py`；`harness/lib/logical_operator_router.py`；`harness/lib/operator_score.py`；`harness/state/orchestration/.gitkeep`；`harness/state/orchestration/README.md`；另 21 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束.task_graph.json`

- [ ] **P0 | P0 修复单：把 OperatorScore 从公式/测试层升级为 runtime 主评分与本地任务证据闭环**
  - ID：`epic-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环`
  - 真值：`warn` · `active/planning_complete` · `70%` · 更新 `2026-06-05T11:39:19+00:00`
  - 卡点：pending nodes: S03_core_runtime,S05_verification_release
  - 实际交付代码：`harness/lib/actor_runtime.py`；`harness/lib/task_evidence_store.py`；`harness/tests/test_orchestration_routes.py`；`harness/tests/test_orchestration_ui_smoke.py`；`harness/ui/orchestration/main.js`
  - 计划代码范围：`harness/lib/actor_runtime.py`；`harness/lib/task_evidence_store.py`；`harness/status-server/routes/orchestration_routes.py`；`harness/tests/runtime/test_operator_score_runtime.py`；`harness/tests/runtime/test_task_evidence_store.py`；`harness/tests/test_orchestration_routes.py`；`harness/tests/test_orchestration_ui_smoke.py`；`harness/tests/test_orchestration_ui_status.py`；`harness/tests/test_s04_orchestration_ui_smoke.py`；`harness/tests/test_status_server_orchestration.py`；`harness/ui/orchestration/index.html`；`harness/ui/orchestration/main.js`；另 1 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环.task_graph.json`

- [ ] **P0 | P0 修复单：把上下文主权收口到 Context Store，压缩长寿 pane 记忆污染路径**
  - ID：`epic-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径`
  - 真值：`warn` · `reviewing/handoff_ready` · `70%` · 更新 `2026-08-09T19:31:58+00:00`
  - 卡点：pending nodes: S03_core_runtime,S05_verification_release
  - 实际交付代码：`harness/lib/context_store.py`；`harness/lib/graph_scheduler.py`；`harness/lib/livework/dispatch_visibility.py`；`harness/lib/multi_task_runner.py`；`harness/lib/packages/orchestration_ui/dispatch_trace.py`；`harness/lib/packages/orchestration_ui/status_projection.py`；`harness/tests/livework/test_dispatch_visibility.py`；`harness/tests/test_context_store_runtime.py`；`harness/tests/test_orchestration_ui_status.py`；`harness/tests/test_s04_activation_graph_route.py`；`harness/tests/test_s04_activation_mailbox_dispatch.py`；`harness/tools/autopilot.py`；另 1 项
  - 计划代码范围：`harness/lib/actor_runtime.py`；`harness/lib/context_store.py`；`harness/lib/evidence_ledger.py`；`harness/lib/graph_scheduler.py`；`harness/lib/livework/dispatch_visibility.py`；`harness/lib/multi_task_runner.py`；`harness/lib/multi_task_status.py`；`harness/lib/packages/orchestration_ui/dispatch_trace.py`；`harness/lib/packages/orchestration_ui/status_projection.py`；`harness/lib/packages/orchestration_ui/verifier.py`；`harness/status-server/static/orchestration_panel.css`；`harness/status-server/static/orchestration_panel.js`；另 16 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径.task_graph.json`

- [ ] **P0 | P0 修复单：把现有 GEPA Stage 1 substrate 升级为 Solar Optimizer 的离线元优化**
  - ID：`epic-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化`
  - 真值：`warn` · `active/planning_complete` · `70%` · 更新 `2026-06-05T11:39:19+00:00`
  - 卡点：pending nodes: S03_core_runtime,S05_verification_release
  - 实际交付代码：`harness/integrations/gepa_optimizer/evaluator.py`；`harness/integrations/gepa_optimizer/evaluator.py` (+26 lines net)`；`harness/integrations/gepa_optimizer/loop/__init__.py`；`harness/integrations/gepa_optimizer/loop/__init__.py`：导出 `CandidateMetadata / FailureEventReason / IllegalTransition / LoopState / LoopStateSnapshot / LoopTransition / EvolutionLoop`。`；`harness/integrations/gepa_optimizer/loop/state_machine.py`；`harness/integrations/gepa_optimizer/loop/state_machine.py`：实现 FSM 与持久化逻辑。`；`harness/tests/integrations/gepa_optimizer/test_adapter_evaluator_promoter.py`；`harness/tests/integrations/gepa_optimizer/test_asi_mapper.py`；`harness/tests/integrations/gepa_optimizer/test_candidate_schema.py`；`harness/tests/integrations/gepa_optimizer/test_candidate_store.py`；`harness/tests/integrations/gepa_optimizer/test_evaluator.py`；`harness/tests/integrations/gepa_optimizer/test_evaluator.py` (+126 lines)`；另 2 项
  - 计划代码范围：`harness/integrations/gepa_optimizer/__init__.py`；`harness/integrations/gepa_optimizer/adapter.py`；`harness/integrations/gepa_optimizer/artifact_store.py`；`harness/integrations/gepa_optimizer/backend.py`；`harness/integrations/gepa_optimizer/candidate_schema.py`；`harness/integrations/gepa_optimizer/cli.py`；`harness/integrations/gepa_optimizer/compile_backend.py`；`harness/integrations/gepa_optimizer/evaluator.py`；`harness/integrations/gepa_optimizer/evidence/EVIDENCE_SCHEMA_AUDIT.md`；`harness/integrations/gepa_optimizer/evidence/__init__.py`；`harness/integrations/gepa_optimizer/evidence/asi_mapper.py`；`harness/integrations/gepa_optimizer/loop/__init__.py`；另 32 项
  - 提交证据：`50f838a4`
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0/P1 总体架构升级单，主题是：把现有 Solar Harness 从**
  - ID：`epic-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从`
  - 真值：`warn` · `active/planning_complete` · `70%` · 更新 `2026-06-05T11:39:19+00:00`
  - 卡点：pending nodes: S04_orchestration_ui,S05_verification_release
  - 实际交付代码：`harness/cli/closure_cli.py`；`harness/lib/contract_closure.py`；`harness/lib/dispatch_package.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/task_graph_split.py`；`harness/lib/workflow_guard.py`；`harness/schemas/schema_loader.py`；`harness/schemas/schema_loader.py`：未修改（当前已注册 11 个文件名）。`；`harness/tests/graph/test_s03_core_runtime_integration.py`；`harness/tests/test_s02_architecture.py`；`harness/tools/autopilot.py`；另 15 项
  - 计划代码范围：`harness/cli/closure_cli.py`；`harness/lib/contract_closure.py`；`harness/lib/dispatch_package.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/task_graph_io.py`；`harness/lib/task_graph_split.py`；`harness/lib/task_graph_state_io.py`；`harness/lib/workflow_guard.py`；`harness/schemas`；`harness/schemas/closure.schema.json`；`harness/schemas/contract-manifest.schema.json`；另 37 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从.status.json`；`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 优化器架构升级单，目标不是简单“接入一个 GEPA 包”或“套一个**
  - ID：`epic-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个`
  - 真值：`warn` · `reviewing/handoff_ready` · `70%` · 更新 `2026-07-02T16:31:53+00:00`
  - 卡点：pending nodes: S03_core_runtime,S05_verification_release
  - 实际交付代码：`harness/lib/compat/legacy_adapter.py`；`harness/lib/execution_trace_builder.py`；`harness/lib/execution_trace_builder.py` (新建`；`harness/schemas/attempt-ledger.schema.json`；`harness/schemas/execution-trace.schema.json`；`harness/tests/fixtures/compat`；`harness/tests/fixtures/state/fixture_events.jsonl`；`harness/tests/fixtures/state/fixture_status.json`；`harness/tests/fixtures/tui_recovery/*.json`；`harness/tests/livework/test_ui_template.py`；`harness/tests/orchestration/test_capability_panel_dom.py`；`harness/tests/runtime/test_state_machine_persistence.py`；另 14 项
  - 计划代码范围：`harness/schemas/attempt-ledger.schema.json`；`harness/schemas/execution-trace.schema.json`；`harness/tests/**/fixtures/compat`；`harness/tests/**/fixtures/evidence`；`harness/tests/**/fixtures/ir`；`harness/tests/**/fixtures/replay`；`harness/tests/**/fixtures/state`；`harness/tests/**/test_*attempt`；`harness/tests/**/test_*compat`；`harness/tests/**/test_*evaluator`；`harness/tests/**/test_*ir`；`harness/tests/**/test_*replay`；另 19 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个.status.json`；`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 总体架构升级单，正式命名为：**
  - ID：`epic-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为`
  - 真值：`warn` · `active/planning_complete` · `70%` · 更新 `2026-06-05T11:39:19+00:00`
  - 卡点：pending nodes: S03_core_runtime,S05_verification_release
  - 实际交付代码：`harness/bin/solar-harness`；`harness/lib/packages/orchestration_ui/__init__.py`；`harness/lib/packages/orchestration_ui/dispatch_trace.py`；`harness/lib/packages/orchestration_ui/operator_evidence.py`；`harness/lib/packages/orchestration_ui/status_projection.py`；`harness/lib/packages/orchestration_ui/trace_model.py`；`harness/lib/packages/orchestration_ui/trace_writer.py`；`harness/lib/packages/orchestration_ui/verifier.py`；`harness/schemas/orchestration-execution-trace.schema.json`；`harness/tests/livework/test_core_runtime_dispatch_smoke.py`；`harness/tests/test_attempt_ledger.py`；`harness/tests/test_core_runtime_compat.py`；另 21 项
  - 计划代码范围：`harness/bin/solar-harness`；`harness/config/solar-core-runtime-ir.schema.json`；`harness/lib/actor_runtime.py`；`harness/lib/autopilot.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/livework/dispatch_visibility.py`；`harness/lib/livework/state_aggregator.py`；`harness/lib/packages/orchestration_ui`；`harness/lib/pane_lease.py`；`harness/lib/symphony/status-server.py`；`harness/schemas/orchestration-execution-trace.schema.json`；另 30 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为.status.json`；`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是：**
  - ID：`epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是`
  - 真值：`warn` · `active/planning_complete` · `70%` · 更新 `2026-06-05T11:39:19+00:00`
  - 卡点：pending nodes: S03_core_runtime,S05_verification_release
  - 实际交付代码：`harness/lib/orchestration/run_evidence_projection.py`；`harness/lib/solar_eval/__init__.py`；`harness/lib/solar_eval/active_learning_queue.py`；`harness/lib/solar_eval/eval_factory.py`；`harness/lib/solar_eval/hidden/__init__.py`；`harness/lib/solar_eval/hidden/anti_reward_hacking.py`；`harness/lib/solar_eval/hidden/holdout_manager.py`；`harness/lib/solar_eval/judge_panel.py`；`harness/lib/solar_eval/proof_obligation_compiler.py`；`harness/lib/solar_eval/registry/__init__.py`；`harness/lib/solar_eval/registry/evaluator_registry.py`；`harness/lib/solar_eval/registry/promotion.py`；另 69 项
  - 计划代码范围：`harness/lib/graph_drain_controller.py`；`harness/lib/multi_task_runner.py`；`harness/lib/orchestration/epic_status_view.py`；`harness/lib/orchestration/run_evidence_projection.py`；`harness/lib/solar_eval`；`harness/lib/solar_eval/__init__.py`；`harness/lib/solar_eval/active_learning_queue.py`；`harness/lib/solar_eval/eval_factory.py`；`harness/lib/solar_eval/fixtures`；`harness/lib/solar_eval/hidden`；`harness/lib/solar_eval/hidden/anti_reward_hacking.py`；`harness/lib/solar_eval/hidden/holdout_manager.py`；另 104 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是.status.json`；`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，把现有的 Capsule-native Agent Pl**
  - ID：`epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl`
  - 真值：`warn` · `active/planning_complete` · `70%` · 更新 `2026-06-05T11:39:19+00:00`
  - 卡点：pending nodes: S04_orchestration_ui,S05_verification_release
  - 实际交付代码：`harness/lib/actor_runtime.py`；`harness/lib/attempt_ledger.py`；`harness/lib/attempt_ledger.py` (MODIFIED`；`harness/lib/dispatch_scheduler.py`；`harness/lib/mode_selector.py`；`harness/lib/operator_registry_loader.py`；`harness/lib/runtime_context_inject.py`；`harness/lib/skill_capsule_bridge.py`；`harness/schemas/access-path-decision.schema.json`；`harness/schemas/attempt-ledger.schema.json`；`harness/schemas/capsule-schema.yaml`；`harness/schemas/evolution-runtime-ir.schema.json`；另 12 项
  - 计划代码范围：`harness/lib/access_path_optimizer.py`；`harness/lib/actor_runtime.py`；`harness/lib/attempt_ledger.py`；`harness/lib/dispatch_scheduler.py`；`harness/lib/mode_selector.py`；`harness/lib/operator_registry_loader.py`；`harness/lib/optimizer_runtime`；`harness/lib/runtime_context_inject.py`；`harness/lib/skill_capsule_bridge.py`；`harness/schemas/access-path-decision.schema.json`；`harness/schemas/attempt-ledger.schema.json`；`harness/schemas/capsule-schema.yaml`；另 28 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl.status.json`；`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构整改单，主题是：**
  - ID：`epic-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是`
  - 真值：`warn` · `reviewing/handoff_ready` · `70%` · 更新 `2026-07-03T14:44:37+00:00`
  - 卡点：pending nodes: S04_orchestration_ui,S05_verification_release
  - 实际交付代码：`harness/lib/autopilot.py`；`harness/lib/autopilot_operator_dispatcher.py`；`harness/lib/operator_health_watchdog_operator_adapters.py`；`harness/lib/operator_runtime.py`；`harness/lib/operator_runtime_core.py`；`harness/lib/orchestration_status_view.py`；`harness/schemas/operator-runtime-core.schema.json`；`harness/tools/autopilot.py`；`harness/ui/orchestration/main.js`
  - 计划代码范围：`harness/lib/autopilot.py`；`harness/lib/autopilot_operator_dispatcher.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/orchestration_status_view.py`；`harness/lib/pane_hygiene_registry.py`；`harness/tests/test_s04_orchestration_integration.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是.status.json`；`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是.task_graph.json`

- [ ] **P0 | P0 修复单：去除 tmux send-keys 作为主任务协议，收口到 operatord mailbox runti · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s03-core-runtime`
  - 真值：`warn` · `active/planning_complete` · `67%` · 更新 `2026-06-30T05:36:42+00:00`
  - 卡点：pending nodes: N6
  - 实际交付代码：`harness/docs/operatord-runtime.md`；`harness/lib/actor_mailbox.py`；`harness/tests/test_operatord_daemon.py`；`harness/tools/operatord.py`
  - 计划代码范围：`harness/config/task-envelope.schema.json`；`harness/docs/DISPATCH-PROTOCOL.md`；`harness/docs/operatord-runtime.md`；`harness/lib/actor_mailbox.py`；`harness/lib/actor_runtime.py`；`harness/lib/graph_node_dispatcher.py`；`harness/tests/runtime/test_actor_mailbox.py`；`harness/tests/runtime/test_actor_runtime.py`；`harness/tests/test_actor_runtime_contract.py`；`harness/tests/test_graph_node_dispatcher_rate_limit_detection.py`；`harness/tests/test_graph_node_dispatcher_role_fallback.py`；`harness/tests/test_graph_node_dispatcher_tui_integration.py`；另 6 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s03-core-runtime.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s03-core-runtime.eval.json`

- [ ] **P0 | P0 修复单：把 OperatorScore 从公式/测试层升级为 runtime 主评分与本地任务证据闭环 · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环-s03-core-runtime`
  - 真值：`warn` · `reviewing/handoff_ready` · `67%` · 更新 `2026-07-03T18:59:23+00:00`
  - 卡点：pending nodes: n3_tests
  - 实际交付代码：`harness/lib/actor_runtime.py`；`harness/lib/task_evidence_store.py`
  - 计划代码范围：`harness/lib/actor_runtime.py`；`harness/lib/task_evidence_store.py`；`harness/tests/runtime/test_operator_score_runtime.py`；`harness/tests/runtime/test_task_evidence_store.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环-s03-core-runtime.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环-s03-core-runtime.handoff.md`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 修复单，作为现有 GEPA 元优化器落地的第二刀，目标是把 GEPA · 架构设计与接口契约**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-修复单-作为现有-gepa-元优化器落地的第二刀-目标是把-gepa-s02-architecture`
  - 真值：`warn` · `active/planning_complete` · `67%` · 更新 `2026-08-09T22:36:21+00:00`
  - 卡点：pending nodes: B6_planner_artifact_closeout
  - 实际交付代码：`harness/tests/integrations/gepa_optimizer/test_objectives.py`
  - 计划代码范围：`harness/tests/integrations/gepa_optimizer/test_asi_adapter.py`；`harness/tests/integrations/gepa_optimizer/test_asi_mapper.py`；`harness/tests/integrations/gepa_optimizer/test_backend.py`；`harness/tests/integrations/gepa_optimizer/test_evidence_pipeline.py`；`harness/tests/integrations/gepa_optimizer/test_objectives.py`；`harness/tests/integrations/gepa_optimizer/test_package.py`；`harness/tests/integrations/gepa_optimizer/test_replay_suite.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-修复单-作为现有-gepa-元优化器落地的第二刀-目标是把-gepa-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-修复单-作为现有-gepa-元优化器落地的第二刀-目标是把-gepa-s02-architecture.task_graph.json`

- [ ] **P0 | 需求单：APO v2 Lease / Quota / Cost-Aware Agent Plan Optimizer · 架构设计与接口契约**
  - ID：`sprint-20260530-需求单-apo-v2-lease-quota-cost-aware-agent-plan-optimizer-s02-architecture`
  - 真值：`warn` · `active/planning_complete` · `60%` · 更新 `2026-06-29T20:22:36+00:00`
  - 卡点：pending nodes: A5
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-需求单-apo-v2-lease-quota-cost-aware-agent-plan-optimizer-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-需求单-apo-v2-lease-quota-cost-aware-agent-plan-optimizer-s02-architecture.task_graph.json`

- [ ] **P0 | P0 修复单：把 Evidence Ledger 从 JSONL 索引升级为可审计的完整 runs 证据链 · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链-s05-verification-release`
  - 真值：`warn` · `active/planning_complete` · `60%` · 更新 `2026-08-10T13:54:29+00:00`
  - 卡点：pending nodes: V5_report_handoff_kb
  - 实际交付代码：`harness/reports/evidence-ledger-s05-e2e.md`；`harness/reports/evidence-ledger-s05-negative.md`；`harness/reports/evidence-ledger-s05-release-gate.md`；`harness/tests/graph/test_evidence_ledger_s05_parent_gate.py`；`harness/tests/verification/s05/test_s05_evidence_negative_controls.py`；`harness/tests/verification/s05/test_s05_evidence_run_chain.py`
  - 计划代码范围：`harness/README.md`；`harness/reports/evidence-ledger-s05-e2e.md`；`harness/reports/evidence-ledger-s05-final-report.md`；`harness/reports/evidence-ledger-s05-negative.md`；`harness/reports/evidence-ledger-s05-preflight.md`；`harness/reports/evidence-ledger-s05-release-gate.md`；`harness/tests/graph/test_evidence_ledger_s05_parent_gate.py`；`harness/tests/verification/s05/test_s05_evidence_negative_controls.py`；`harness/tests/verification/s05/test_s05_evidence_run_chain.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链-s05-verification-release.task_graph.json`

- [ ] **P0 | P0 修复单：把推荐最终架构图收口为 solar-harness 默认主执行脊柱 · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s05-verification-release`
  - 真值：`warn` · `active/planning_complete` · `60%` · 更新 `2026-06-19T03:06:51+00:00`
  - 卡点：pending nodes: V5_final_handoff_eval_raw
  - 实际交付代码：N/A
  - 计划代码范围：`harness/tests/fixtures/s05_actor_runtime_activation`；`harness/tests/fixtures/s05_negative_controls`；`harness/tests/test_s05_actor_runtime_activation_proof.py`；`harness/tests/test_s05_actor_runtime_negative_controls.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s05-verification-release.handoff.md`

- [ ] **P0 | P0 修复单：把 Capsule-native Agent OS 的深层设计从 ADR/draft schema 收口到 · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到-s05-verification-release`
  - 真值：`warn` · `active/planning_complete` · `60%` · 更新 `2026-08-10T02:23:34+00:00`
  - 卡点：pending nodes: N5
  - 实际交付代码：`harness/tests/fixtures/s05_capsule_native_negative/nc_cases.json`；`harness/tests/s05-capsule-native-negctl-results.json`；`harness/tests/s05-capsule-native-regression-matrix.json`；`harness/tests/s05-capsule-native-regression-matrix.json`：本次复跑产物。`；`harness/tests/s05/regression-matrix.sh`；`harness/tests/s05/regression-matrix.sh`：加入已知失败兜底，确保既存回归在审计下可落地为 skipped，并复核状态汇总逻辑。`；`harness/tests/test_s05_capsule_native_negative_controls.py`
  - 计划代码范围：`harness/tests/fixtures/s05_capsule_native/expected_capsule_graph_edges.json`；`harness/tests/fixtures/s05_capsule_native/task_ir.json`；`harness/tests/fixtures/s05_capsule_native_activation`；`harness/tests/fixtures/s05_capsule_native_negative`；`harness/tests/s05-capsule-native-activation-proof.json`；`harness/tests/s05-capsule-native-e2e-results.json`；`harness/tests/s05-capsule-native-negctl-results.json`；`harness/tests/s05-capsule-native-regression-matrix.json`；`harness/tests/s05/capsule-native-e2e.sh`；`harness/tests/s05/capsule_native_e2e.py`；`harness/tests/s05/regression-matrix.sh`；`harness/tests/test_s05_capsule_native_activation_proof.py`；另 2 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到-s05-verification-release.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构整改单，主题是： · 调度、自动化与可视化**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是-s04-orchestration-ui`
  - 真值：`warn` · `active/planning_complete` · `60%` · 更新 `2026-08-10T19:10:44+00:00`
  - 卡点：pending nodes: N1_dispatcher_or_bridge,N5_evidence_closeout
  - 实际交付代码：`harness/lib/autopilot.py`；`harness/lib/autopilot_operator_dispatcher.py`；`harness/lib/orchestration_status_view.py`
  - 计划代码范围：`harness/lib/autopilot.py`；`harness/lib/autopilot_operator_dispatcher.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/orchestration_status_view.py`；`harness/lib/pane_hygiene_registry.py`；`harness/tests/test_s04_orchestration_integration.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是-s04-orchestration-ui.task_graph.json`

- [ ] **P0 | P0/P1 修复单：autopilot planner 空转去重与 dispatcher operator-pool compatibility · 调度、自动化与可视化**
  - ID：`sprint-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility-s04-orchestration-ui`
  - 真值：`warn` · `active/planning_complete` · `60%` · 更新 `2026-08-09T23:00:57+00:00`
  - 卡点：pending nodes: N5_integration_verification_handoff
  - 实际交付代码：N/A
  - 计划代码范围：`harness/tools/antigravity_orchestration_view.py`；`harness/tools/dispatch_prompt_injector.py`；`harness/tools/evidence_ledger.py`；`harness/tools/graph_drain_controller.py`；`harness/tools/knowledge_dashboard.py`；`harness/tools/livework/dispatch_visibility.py`；`harness/tools/multi_task_status.py`；`harness/tools/pane_handoff`；`harness/tools/pm_dispatch.py`；`harness/tools/report_evidence.py`；`harness/tools/solar_monitor_bridge.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility-s04-orchestration-ui.task_graph.json`；`~/.solar/harness/sprints/sprint-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility-s04-orchestration-ui.handoff.md`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0/P1 聚焦执行单：GEPA Requirement Compiler**
  - ID：`epic-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler`
  - 真值：`warn` · `reviewing/handoff_ready` · `60%` · 更新 `2026-08-09T19:31:57+00:00`
  - 卡点：pending nodes: S01_requirements,S04_orchestration_ui,S05_verification_r…
  - 实际交付代码：`harness/lib/compile_eval/dataset.py`；`harness/lib/compile_eval/dataset_loader.py`；`harness/lib/compiler_profile/__init__.py`；`harness/lib/compiler_profile/resolver.py`；`harness/lib/graph_scheduler.py`；`harness/schemas/dataset.schema.json`；`harness/schemas/eval-case.schema.json`；`harness/tests/graph/test_s04_ready_node_dispatch_activation.py`；`harness/tests/test_compile_eval_dataset.py`；`harness/tests/test_compiler_profile_active_profile.py`；`harness/tests/test_pane_runtime_contract.py`；`harness/tests/test_s04_orchestration_acceptance.py`；另 7 项
  - 计划代码范围：`harness/lib/compile_eval`；`harness/lib/compiler_profile`；`harness/tests/compile_eval`；`harness/tests/compiler_profile`；`harness/tests/graph/test_s04_ready_node_dispatch_activation.py`；`harness/tests/integrations/gepa_optimizer`；`harness/tests/test-status-server-assets.py`；`harness/tests/test-status-server-task-graph-gate-audit.py`；`harness/tests/test_antigravity_ingress_schema.py`；`harness/tests/test_codex_pm_router.py`；`harness/tests/test_compile_eval`；`harness/tests/test_compiler_profile`；另 29 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler.status.json`；`~/.solar/harness/sprints/epic-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是“统一数据访问层 / 上下文数据平面升级：把现有 · 架构设计与接口契约**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-统一数据访问层-上下文数据平面升级-把现有-s02-architecture`
  - 真值：`warn` · `active/planning_complete` · `50%` · 更新 `2026-08-09T23:19:58+00:00`
  - 卡点：pending nodes: A5_migration_compatibility_rollout,A6_join_handoff_valid…
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-统一数据访问层-上下文数据平面升级-把现有-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-统一数据访问层-上下文数据平面升级-把现有-s02-architecture.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-统一数据访问层-上下文数据平面升级-把现有-s02-architecture.handoff.md`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0/P1 聚焦执行单：GEPA Requirement Compiler · 调度、自动化与可视化**
  - ID：`sprint-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler-s04-orchestration-ui`
  - 真值：`warn` · `active/planning_complete` · `43%` · 更新 `2026-08-10T14:31:52+00:00`
  - 卡点：pending nodes: N5_pane_closeout_gate,N6_integration_acceptance,H1_hando…
  - 实际交付代码：`harness/lib/graph_scheduler.py`；`harness/tests/graph/test_s04_ready_node_dispatch_activation.py`；`harness/tests/test_pane_runtime_contract.py`；`harness/tests/test_s04_orchestration_acceptance.py`；`harness/tests/test_s04_orchestration_routes.py`；`harness/tools/autopilot.py`；`harness/tools/graph_node_dispatcher.py`；`harness/tools/graph_scheduler.py`；`harness/tools/pm_dispatch.py`
  - 计划代码范围：`harness/tests/graph/test_s04_ready_node_dispatch_activation.py`；`harness/tests/test-status-server-assets.py`；`harness/tests/test-status-server-task-graph-gate-audit.py`；`harness/tests/test_graph_dispatcher_actor_lease.py`；`harness/tests/test_graph_dispatcher_multi_task_reconcile.py`；`harness/tests/test_graph_node_dispatcher_role_fallback.py`；`harness/tests/test_orchestration_ui_verifier.py`；`harness/tests/test_pane_runtime_contract.py`；`harness/tests/test_s04_orchestration_acceptance.py`；`harness/tests/test_s04_orchestration_routes.py`；`harness/tests/test_status_server_orchestration.py`；`harness/tools/autopilot.py`；另 12 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler-s04-orchestration-ui.task_graph.json`

- [ ] **P0 | P0 修复单：把上下文主权收口到 Context Store，压缩长寿 pane 记忆污染路径 · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s03-core-runtime`
  - 真值：`warn` · `active/planning_complete` · `40%` · 更新 `2026-06-29T05:03:40+00:00`
  - 卡点：pending nodes: N4_audit_evidence_propagation,N5_tests_and_regression
  - 实际交付代码：`harness/lib/context_store.py`；`harness/lib/multi_task_runner.py`；`harness/tests/test_context_store_runtime.py`
  - 计划代码范围：`harness/lib/actor_runtime.py`；`harness/lib/context_store.py`；`harness/lib/evidence_ledger.py`；`harness/lib/multi_task_runner.py`；`harness/tests`；`harness/tests/test_context_store_runtime.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s03-core-runtime.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，把现有的 Capsule-native Agent Pl · 调度、自动化与可视化**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl-s04-orchestration-ui`
  - 真值：`warn` · `active/planning_complete` · `40%` · 更新 `2026-06-27T22:01:17+00:00`
  - 卡点：pending nodes: N4_orchestration_ui_surface,N5_integration_handoff
  - 实际交付代码：`harness/tests/control_plane/test-autopilot-graph-status.py`；`harness/tests/test_pane_handoff_evidence.py`；`harness/tools/autopilot.py`；`harness/tools/evidence_ledger.py`；`harness/tools/pane_handoff/completion_evidence_gate.py`；`harness/tools/pane_handoff/dispatch_evidence_writer.py`
  - 计划代码范围：`harness/tests/control_plane/test-autopilot-graph-status.py`；`harness/tests/control_plane/test-dag-autopilot-planner.sh`；`harness/tests/control_plane/test-graph-scheduler.sh`；`harness/tests/orchestration/test_pane_evidence_gate.py`；`harness/tests/regression/run-vnext-regression-suite.sh`；`harness/tests/test-status-server-multi-task-pane-pool.py`；`harness/tests/test-status-server-pane-hygiene.py`；`harness/tests/test-status-server-physical-operators-summary.py`；`harness/tests/test-status-server-task-graph-gate-audit.py`；`harness/tests/test_pane_handoff_evidence.py`；`harness/tools/autopilot.py`；`harness/tools/evidence_ledger.py`；另 6 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl-s04-orchestration-ui.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl-s04-orchestration-ui.handoff.md`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是： · 架构设计与接口契约**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-2-s02-architecture`
  - 真值：`warn` · `active/planning_complete` · `38%` · 更新 `2026-08-09T23:07:06+00:00`
  - 卡点：pending nodes: N6_execution_runners,N7_control_plane_integration,N8_rel…
  - 实际交付代码：`harness/lib/solar_eval/deterministic_checks.py`；`harness/lib/solar_eval/proof_obligation_compiler.py`；`harness/lib/solar_eval/verifier_generator.py`；`harness/tests/fixtures/eval_factory/verifier_inputs/artifact_valid.json`；`harness/tests/test_proof_obligation_compiler.py`
  - 计划代码范围：`harness/lib/evidence_ledger.py`；`harness/lib/graph_scheduler.py`；`harness/lib/solar_eval/__init__.py`；`harness/lib/solar_eval/active_learning_queue.py`；`harness/lib/solar_eval/deterministic_checks.py`；`harness/lib/solar_eval/evaluator_daemon.py`；`harness/lib/solar_eval/evaluator_families.py`；`harness/lib/solar_eval/evaluator_generator.py`；`harness/lib/solar_eval/hidden_holdout.py`；`harness/lib/solar_eval/incident_sources.py`；`harness/lib/solar_eval/judge_panel.py`；`harness/lib/solar_eval/models.py`；另 28 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-2-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-2-s02-architecture.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-2-s02-architecture.handoff.md`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是： · 核心实现与数据模型**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-s03-core-runtime`
  - 真值：`warn` · `active/planning_complete` · `33%` · 更新 `2026-08-10T00:32:37+00:00`
  - 卡点：pending nodes: N5_legacy_call_chain_adapter,N6_core_runtime_release
  - 实际交付代码：`harness/lib/solar_ir/__init__.py`；`harness/lib/solar_ir/capsule_ir.py`；`harness/lib/solar_ir/execution_ir.py`；`harness/lib/solar_ir/patch_ir.py`；`harness/lib/solar_ir/physical_plan_ir.py`；`harness/lib/solar_ir/validators.py`；`harness/tests/test_ir_schemas.py`
  - 计划代码范围：`harness/lib/multi_task_runner.py`；`harness/lib/solar_eval`；`harness/lib/solar_ir/__init__.py`；`harness/lib/solar_ir/capsule_ir.py`；`harness/lib/solar_ir/effect_ir.py`；`harness/lib/solar_ir/evidence_ir.py`；`harness/lib/solar_ir/execution_ir.py`；`harness/lib/solar_ir/intent_ir.py`；`harness/lib/solar_ir/patch_ir.py`；`harness/lib/solar_ir/physical_plan_ir.py`；`harness/lib/solar_ir/plan_ir.py`；`harness/lib/solar_ir/provenance.py`；另 49 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-s03-core-runtime.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-s03-core-runtime.handoff.md`

- [ ] **P0 | P0 修复单：把现有 capability capsule substrate 升级为完整的 capsule-nativ**
  - ID：`epic-20260530-p0-修复单-把现有-capability-capsule-substrate-升级为完整的-capsule-nativ`
  - 真值：`warn` · `active/planning_complete` · `30%` · 更新 `2026-06-12T16:58:48+00:00`
  - 卡点：pending nodes: S02_architecture,S03_core_runtime,S04_orchestration_ui,S…
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-把现有-capability-capsule-substrate-升级为完整的-capsule-nativ.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-把现有-capability-capsule-substrate-升级为完整的-capsule-nativ.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 修复单，作为现有 GEPA 元优化器落地的第二刀，目标是把 GEPA**
  - ID：`epic-20260530-请为-solar-harness-开一个新的-p0-修复单-作为现有-gepa-元优化器落地的第二刀-目标是把-gepa`
  - 真值：`warn` · `active/planning_complete` · `30%` · 更新 `2026-06-05T11:39:19+00:00`
  - 卡点：pending nodes: S02_architecture,S03_core_runtime,S04_orchestration_ui,S…
  - 实际交付代码：`harness/tests/integrations/gepa_optimizer/test_asi_adapter.py`；`harness/tests/integrations/gepa_optimizer/test_evidence_pipeline.py`；`harness/tests/integrations/gepa_optimizer/test_objectives.py`；`harness/tests/integrations/gepa_optimizer/test_replay_suite.py`
  - 计划代码范围：`harness/tests/integrations/gepa_optimizer/test_asi_adapter.py`；`harness/tests/integrations/gepa_optimizer/test_asi_mapper.py`；`harness/tests/integrations/gepa_optimizer/test_backend.py`；`harness/tests/integrations/gepa_optimizer/test_evidence_pipeline.py`；`harness/tests/integrations/gepa_optimizer/test_objectives.py`；`harness/tests/integrations/gepa_optimizer/test_package.py`；`harness/tests/integrations/gepa_optimizer/test_replay_suite.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-修复单-作为现有-gepa-元优化器落地的第二刀-目标是把-gepa.status.json`；`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-修复单-作为现有-gepa-元优化器落地的第二刀-目标是把-gepa.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是：**
  - ID：`epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-2`
  - 真值：`warn` · `active/planning_complete` · `30%` · 更新 `2026-06-05T11:39:19+00:00`
  - 卡点：pending nodes: S02_architecture,S03_core_runtime,S04_orchestration_ui,S…
  - 实际交付代码：`harness/lib/solar_eval/deterministic_checks.py`；`harness/lib/solar_eval/proof_obligation_compiler.py`；`harness/lib/solar_eval/verifier_generator.py`；`harness/tests/fixtures/eval_factory/verifier_inputs/artifact_valid.json`；`harness/tests/test_proof_obligation_compiler.py`
  - 计划代码范围：`harness/lib/evidence_ledger.py`；`harness/lib/graph_scheduler.py`；`harness/lib/solar_eval/__init__.py`；`harness/lib/solar_eval/active_learning_queue.py`；`harness/lib/solar_eval/deterministic_checks.py`；`harness/lib/solar_eval/evaluator_daemon.py`；`harness/lib/solar_eval/evaluator_families.py`；`harness/lib/solar_eval/evaluator_generator.py`；`harness/lib/solar_eval/hidden_holdout.py`；`harness/lib/solar_eval/incident_sources.py`；`harness/lib/solar_eval/judge_panel.py`；`harness/lib/solar_eval/models.py`；另 28 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-2.status.json`；`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-2.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是“把现有 PM pane / Requiremen**
  - ID：`epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把现有-pm-pane-requiremen`
  - 真值：`warn` · `reviewing/handoff_ready` · `30%` · 更新 `2026-07-03T19:09:02+00:00`
  - 卡点：pending nodes: S02_architecture,S03_core_runtime,S04_orchestration_ui,S…
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把现有-pm-pane-requiremen.status.json`；`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把现有-pm-pane-requiremen.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是“统一数据访问层 / 上下文数据平面升级：把现有**
  - ID：`epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-统一数据访问层-上下文数据平面升级-把现有`
  - 真值：`warn` · `active/planning_complete` · `30%` · 更新 `2026-06-05T11:39:19+00:00`
  - 卡点：pending nodes: S02_architecture,S03_core_runtime,S04_orchestration_ui,S…
  - 实际交付代码：`harness/lib/cocoindex_adapter.py`；`harness/lib/cocoindex_flows`；`harness/lib/context_usage_verifier.py`；`harness/lib/runtime_context_inject.py`；`harness/lib/solar-unified-context.py`；`harness/lib/understand_anything_adapter.py`；`harness/tests/test_coco_cli.py`；`harness/tests/test_context_usage_verifier.py`；`harness/tests/test_ua_cli.py`；`harness/tests/test_understanding_artifact_schema.py`；`harness/tools/solar_harness_coco_cli.py`；`harness/tools/solar_harness_ua_cli.py`
  - 计划代码范围：`harness/config/capability-capsules/cap.context-deep-understanding.yaml`；`harness/config/capability-capsules/cap.incremental-context-index.yaml`；`harness/config/capability-capsules/cap.solar-context-fusion.yaml`；`harness/config/skill-operator-bindings.yaml`；`harness/lib/cocoindex_adapter.py`；`harness/lib/cocoindex_flows`；`harness/lib/context_usage_verifier.py`；`harness/lib/runtime_context_inject.py`；`harness/lib/solar-unified-context.py`；`harness/lib/understand_anything_adapter.py`；`harness/schemas/understanding-artifact-v1.json`；`harness/tests/test_coco_cli.py`；另 5 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-统一数据访问层-上下文数据平面升级-把现有.status.json`；`~/.solar/harness/sprints/epic-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-统一数据访问层-上下文数据平面升级-把现有.task_graph.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是“把现有 PM pane / Requiremen · 架构设计与接口契约**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把现有-pm-pane-requiremen-s02-architecture`
  - 真值：`warn` · `active/planning_complete` · `20%` · 更新 `2026-08-10T14:12:10+00:00`
  - 卡点：pending nodes: N03_ModuleBoundaryAndAdapters,N04_DAGAndQualityIntegrati…
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把现有-pm-pane-requiremen-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把现有-pm-pane-requiremen-s02-architecture.task_graph.json`

- [ ] **P0 | P0 修复单：把 Logical Operator / Capsule / Physical Operator 收口到同 · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同-s05-verification-release`
  - 真值：`warn` · `active/planning_complete` · `17%` · 更新 `2026-08-10T01:40:30+00:00`
  - 卡点：pending nodes: N4_workflow_capsule_reoptimizer_proof,N5_regression_rele…
  - 实际交付代码：`harness/reports/apo-s05/negative-controls.json`；`harness/reports/apo-s05/negative-controls.md`
  - 计划代码范围：`harness/reports/apo-s05/activation-proof.json`；`harness/reports/apo-s05/activation-proof.md`；`harness/reports/apo-s05/negative-controls.json`；`harness/reports/apo-s05/negative-controls.md`；`harness/reports/apo-s05/regression-report.json`；`harness/reports/apo-s05/regression-report.md`；`harness/reports/apo-s05/reoptimizer-proof.json`；`harness/reports/apo-s05/workflow-capsule-proof.json`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同-s05-verification-release.task_graph.json`

- [ ] **P0 | P0 修复单：收口逻辑算子类型系统为 DAG 第一公民，并对齐 canonical bindings**
  - ID：`epic-20260530-p0-修复单-收口逻辑算子类型系统为-dag-第一公民-并对齐-canonical-bindings`
  - 真值：`warn` · `active/planning_complete` · `10%` · 更新 `2026-06-05T11:39:19+00:00`
  - 卡点：pending nodes: S01_requirements,S02_architecture,S03_core_runtime,S04_o…
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-收口逻辑算子类型系统为-dag-第一公民-并对齐-canonical-bindings.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-收口逻辑算子类型系统为-dag-第一公民-并对齐-canonical-bindings.task_graph.json`

- [ ] **P0 | P0 修复单：从 pane lease 升级到 actor lease，并补齐生命周期状态机 · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机-s05-verification-release`
  - 真值：`warn` · `active/planning_complete` · `0%` · 更新 `2026-06-29T07:11:17+00:00`
  - 卡点：pending nodes: B-TEST-SYNC,B-ACTIVATION,B-EVIDENCE
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机-s05-verification-release.task_graph.json`

- [ ] **P0 | P0 修复单：补齐 Antigravity 2.0 desktop app 作为与 Codex app 对等的 requ · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ-s05-verification-release`
  - 真值：`warn` · `active/planning_complete` · `0%` · 更新 `2026-06-30T17:20:26+00:00`
  - 卡点：pending nodes: N2_e2e_regression_suite,N3_negative_control_suite,N4_act…
  - 实际交付代码：N/A
  - 计划代码范围：`harness/tests/antigravity_release/test_s05_e2e_release.py`；`harness/tests/antigravity_release/test_s05_negative_controls.py`；`harness/tools/smoke/antigravity_s05_activation_proof.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ-s05-verification-release.task_graph.json`

- [ ] **N/A | RawIntent Consumer Request - 新增 intent consumer，把 RawIntent 自动编译成 PM/Planner spr**
  - ID：`sprint-20260525-153618-intent-intent-consumer-rawintent-pm-465350b1`
  - 真值：`warn` · `active/planning_complete` · `100%` · 更新 `2026-07-06T18:47:39+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-153618-intent-intent-consumer-rawintent-pm-465350b1.status.json`；`~/.solar/harness/sprints/sprint-20260525-153618-intent-intent-consumer-rawintent-pm-465350b1.task_graph.json`；`~/.solar/harness/sprints/sprint-20260525-153618-intent-intent-consumer-rawintent-pm-465350b1.handoff.md`

- [ ] **N/A | RawIntent Consumer Request - [entrypoint_metadata]**
  - ID：`sprint-20260525-153719-intent-entrypoint_metadata-122e9c9c`
  - 真值：`warn` · `active/planning_complete` · `100%` · 更新 `2026-07-03T12:53:57+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-153719-intent-entrypoint_metadata-122e9c9c.status.json`；`~/.solar/harness/sprints/sprint-20260525-153719-intent-entrypoint_metadata-122e9c9c.task_graph.json`；`~/.solar/harness/sprints/sprint-20260525-153719-intent-entrypoint_metadata-122e9c9c.handoff.md`

- [ ] **N/A | RawIntent Consumer Request - mobile untrusted compile only smoke 1779724491**
  - ID：`sprint-20260525-155452-intent-mobile-untrusted-compile-onl-58f5ff7c`
  - 真值：`warn` · `active/planning_complete` · `100%` · 更新 `2026-07-03T19:11:00+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-155452-intent-mobile-untrusted-compile-onl-58f5ff7c.status.json`；`~/.solar/harness/sprints/sprint-20260525-155452-intent-mobile-untrusted-compile-onl-58f5ff7c.task_graph.json`；`~/.solar/harness/sprints/sprint-20260525-155452-intent-mobile-untrusted-compile-onl-58f5ff7c.handoff.md`

- [ ] **N/A | 在 Mac mini 的 Claude Code 环境安装并集成 Lum1104/Understand-Anything**
  - ID：`epic-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything`
  - 真值：`warn` · `active/planning_complete` · `100%` · 更新 `2026-05-29T20:42:31+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything.status.json`；`~/.solar/harness/sprints/epic-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything.task_graph.json`

- [ ] **N/A | task-graph dump sprint-20260525-tech-hotspot-radar-social-br**
  - ID：`sprint-20260529-080448`
  - 真值：`warn` · `active/planning_complete` · `100%` · 更新 `2026-08-11T00:16:26+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/social_browser_backend_x/backend_selector.py`；`harness/lib/social_browser_backend_x/browser_lease_client.py`；`harness/lib/social_browser_backend_x/cli.py`；`harness/lib/social_browser_backend_x/dedup_keys_table.py`；`harness/lib/social_browser_backend_x/dedup_queue.py`；`harness/lib/social_browser_backend_x/hard_blocker_guard.py`；`harness/lib/social_browser_backend_x/migrations/001_add_browser_backend_columns.sql`；`harness/lib/social_browser_backend_x/operator_lease_manager.py`；`harness/lib/social_browser_backend_x/pipeline.py`；`harness/lib/social_browser_backend_x/post_extractor.py`；`harness/lib/social_browser_backend_x/ratelimiter.py`；`harness/lib/social_browser_backend_x/schema.py`；另 6 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260529-080448.status.json`；`~/.solar/harness/sprints/sprint-20260529-080448.task_graph.json`

- [ ] **N/A | probe**
  - ID：`sprint-20260605-045816-intent-probe-1a4b22b1`
  - 真值：`warn` · `active/planning_complete` · `100%` · 更新 `2026-06-16T02:03:52+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260605-045816-intent-probe-1a4b22b1.status.json`；`~/.solar/harness/sprints/sprint-20260605-045816-intent-probe-1a4b22b1.task_graph.json`；`~/.solar/harness/sprints/sprint-20260605-045816-intent-probe-1a4b22b1.handoff.md`

- [ ] **N/A | 请按照 PRD 开发 AI Influence GitHub 趋势情报系统: # PRD: AI Influence G**
  - ID：`epic-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g`
  - 真值：`warn` · `active/planning_complete` · `100%` · 更新 `2026-06-12T15:52:37+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：`harness/lib/github_intelligence/cards.py`；`harness/lib/github_intelligence/detectors.py`；`harness/lib/github_intelligence/evidence.py`；`harness/lib/github_intelligence/model_ledger.py`；`harness/lib/github_intelligence/scoring.py`；`harness/lib/github_intelligence/snapshots.py`；`harness/lib/graph_scheduler.make_batches`；`harness/lib/graph_scheduler.validate_graph`；`harness/lib/symphony/status-server.py`；`harness/tests/orchestration/test_orchestration_routes.py`；`harness/tests/test_ai_influence_github_activation_proof.py`；`harness/tests/test_ai_influence_github_activation_proof.py`（`~/Solar/harness` 树）：**新建** 4-test activation-proof 套件。每个测试以真实子进程/真实 import 驱动真实入口（`run_pipeline`、`pipeline.py` `__main__` smoke、`tech_hotspot_radar.py init/github-fixture/status`），断言落盘 SQLite artifact 存在且行数非空；每个子进程出口用 `_classify_environment_blocker()` 扫描 stdout+stderr，命中网络/DNS 即 `pytest.skip` 分类为环境 blocker。目的：让真实 runtime 调用回归在此处失败。`；另 20 项
  - 计划代码范围：`harness/lib/github_intelligence/cards.py`；`harness/lib/github_intelligence/detectors.py`；`harness/lib/github_intelligence/evidence.py`；`harness/lib/github_intelligence/model_ledger.py`；`harness/lib/github_intelligence/schema.py`；`harness/lib/github_intelligence/scoring.py`；`harness/lib/github_intelligence/snapshots.py`；`harness/tests/test_ai_influence_github_activation_proof.py`；`harness/tests/test_ai_influence_github_negative_controls.py`；`harness/tests/test_ai_influence_github_verification_release.py`；`harness/tests/test_github_intelligence.py`；`harness/tools/autopilot`；另 2 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g.status.json`；`~/.solar/harness/sprints/epic-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g.task_graph.json`

- [ ] **N/A | P0/P1 修复单：autopilot planner 空转去重与 dispatcher operator-pool compatibility**
  - ID：`epic-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility`
  - 真值：`warn` · `active/planning_complete` · `70%` · 更新 `2026-06-05T11:39:19+00:00`
  - 卡点：pending nodes: S04_orchestration_ui,S05_verification_release
  - 实际交付代码：`harness/tests/control_plane/test-autopilot-pane-gate-reconcile.py`；`harness/tests/test_pm_dispatch.py`；`harness/tools/solar-autopilot-monitor.py`
  - 计划代码范围：`harness/lib/pane_role_pool.py`；`harness/tests/control_plane/test-autopilot-pane-gate-reconcile.py`；`harness/tests/test_dispatcher_integration.py`；`harness/tests/test_graph_node_dispatch_duplicate_guard.py`；`harness/tests/test_graph_node_dispatcher_role_fallback.py`；`harness/tests/test_graph_node_dispatcher_worker_catalog.py`；`harness/tests/test_pm_dispatch.py`；`harness/tools/antigravity_orchestration_view.py`；`harness/tools/dispatch_prompt_injector.py`；`harness/tools/evidence_ledger.py`；`harness/tools/graph_drain_controller.py`；`harness/tools/graph_node_dispatcher.py`；另 8 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility.status.json`；`~/.solar/harness/sprints/epic-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility.task_graph.json`

- [ ] **N/A | RawIntent Consumer Request - 实现 Browser Agent 物理执行算子，调用 ChatGPT Deep Research 和 **
  - ID：`sprint-20990101-browser-agent-smoke`
  - 真值：`warn` · `active/planning_complete` · `60%` · 更新 `2026-08-09T18:29:40+00:00`
  - 卡点：pending nodes: S5
  - 实际交付代码：`harness/config/physical-operators.json`；`harness/tests/runtime/test_browser_agent_account_routes.py`
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20990101-browser-agent-smoke.status.json`；`~/.solar/harness/sprints/sprint-20990101-browser-agent-smoke.task_graph.json`；`~/.solar/harness/sprints/sprint-20990101-browser-agent-smoke.handoff.md`

- [ ] **N/A | GEPA Requirement Compiler 外循环第二阶段**
  - ID：`epic-20260531-gepa-requirement-compiler-外循环第二阶段`
  - 真值：`warn` · `reviewing/handoff_ready` · `60%` · 更新 `2026-07-03T19:09:02+00:00`
  - 卡点：pending nodes: S03_core_runtime,S05_verification_release
  - 实际交付代码：`harness/integrations/gepa_optimizer/asi_adapter.py`；`harness/integrations/gepa_optimizer/evaluator.py`；`harness/lib/autopilot.py`；`harness/lib/autopilot.py`（运行时真实调用链）：新增 `_PLANNING_ARTIFACT_KEYS` / `_ARTIFACT_DISK_SUFFIX` / `_discover_planning_artifacts()`；在 `dag_bridge_activate()` 顶部插入 Gate 0（提升或精确 blocker）。目的：把 status/artifact 发现接到 design/plan/task_graph/design_html/planning_html，终结 invalid_prd 循环。`；`harness/lib/compile_eval/datasets/loader.py`；`harness/lib/compile_eval/datasets/test_dataset_plane.py`；`harness/lib/reviewing_route_normalizer.py`；`harness/lib/reviewing_route_normalizer.py`（coordinator 真实调用）：新增 `promote_nested_artifacts()`，`normalize_status()` 里先提升嵌套 artifacts 再做 review 路由归一化。`；`harness/tools/autopilot.py`；`harness/tools/autopilot.py`（声明写域内的镜像副本）：同上改动，保持两份一致。`；`harness/tools/orchestration_activation_snapshot.py`；`harness/tools/render_orchestration_evidence_html.py`；另 2 项
  - 计划代码范围：`harness/integrations/gepa_optimizer`；`harness/integrations/gepa_optimizer/asi_adapter.py`；`harness/integrations/gepa_optimizer/cli.py`；`harness/integrations/gepa_optimizer/evaluator.py`；`harness/integrations/gepa_optimizer/governance.py`；`harness/integrations/gepa_optimizer/promote.py`；`harness/integrations/gepa_optimizer/runner.py`；`harness/lib/compile_eval`；`harness/lib/compile_eval/datasets`；`harness/lib/compile_eval/splits`；`harness/lib/compiler_profile`；`harness/state`；另 16 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260531-gepa-requirement-compiler-外循环第二阶段.status.json`；`~/.solar/harness/sprints/epic-20260531-gepa-requirement-compiler-外循环第二阶段.task_graph.json`

- [ ] **N/A | 将该 PRD-ready sprint 编译为正式 planner 交付：读取 prd.md/status/task context，产出 design.md、**
  - ID：`sprint-20260604-164024-intent-prd-ready-sprint-planner-prd-fe49a0c5`
  - 真值：`warn` · `active/planning_complete` · `40%` · 更新 `2026-06-19T13:22:11+00:00`
  - 卡点：pending nodes: S4,S5
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260604-164024-intent-prd-ready-sprint-planner-prd-fe49a0c5.status.json`；`~/.solar/harness/sprints/sprint-20260604-164024-intent-prd-ready-sprint-planner-prd-fe49a0c5.task_graph.json`；`~/.solar/harness/sprints/sprint-20260604-164024-intent-prd-ready-sprint-planner-prd-fe49a0c5.handoff.md`

- [ ] **N/A | capacity probe after shared quota fix**
  - ID：`sprint-20260605-145159-intent-capacity-probe-after-shared--9c424db9`
  - 真值：`warn` · `active/planning_complete` · `33%` · 更新 `2026-07-07T13:51:10+00:00`
  - 卡点：pending nodes: S2,S3
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260605-145159-intent-capacity-probe-after-shared--9c424db9.status.json`；`~/.solar/harness/sprints/sprint-20260605-145159-intent-capacity-probe-after-shared--9c424db9.task_graph.json`；`~/.solar/harness/sprints/sprint-20260605-145159-intent-capacity-probe-after-shared--9c424db9.handoff.md`

- [ ] **N/A | 需求单：APO v2 Lease / Quota / Cost-Aware Agent Plan Optimizer**
  - ID：`epic-20260530-需求单-apo-v2-lease-quota-cost-aware-agent-plan-optimizer`
  - 真值：`warn` · `active/planning_complete` · `30%` · 更新 `2026-06-05T11:39:19+00:00`
  - 卡点：pending nodes: S02_architecture,S03_core_runtime,S04_orchestration_ui
  - 实际交付代码：`harness/config/apo-config.json`；`harness/lib/apo_cli.py`；`harness/lib/apo_config.py`；`harness/lib/apo_enforcer_rules.py`；`harness/lib/apo_explain.py`；`harness/lib/apo_feedback.py`；`harness/lib/apo_plan_compiler.py`；`harness/lib/apo_shadow.py`；`harness/tests/test_apo_enforcer_rules.py`；`harness/tests/test_apo_explain.py`；`harness/tests/test_apo_feedback.py`；`harness/tests/test_apo_plan_compiler.py`；另 1 项
  - 计划代码范围：`harness/_raw/apo-v2-s05-verification-release.md`；`harness/config/apo-config.json`；`harness/config/apo-weights.json`；`harness/lib/apo_config.py`；`harness/lib/apo_cost_model.py`；`harness/lib/apo_enforcer_rules.py`；`harness/lib/apo_explain.py`；`harness/lib/apo_feedback.py`；`harness/lib/apo_plan_compiler.py`；`harness/lib/apo_shadow.py`；`harness/tests/runtime/test_operator_runtime.py`；`harness/tests/test_apo_cost_model.py`；另 6 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-需求单-apo-v2-lease-quota-cost-aware-agent-plan-optimizer.status.json`；`~/.solar/harness/sprints/epic-20260530-需求单-apo-v2-lease-quota-cost-aware-agent-plan-optimizer.task_graph.json`

- [ ] **N/A | live capacity smoke only**
  - ID：`sprint-20260809-175751-intent-entrypoint_metadata-33c9fccb`
  - 真值：`warn` · `active/planning_complete` · `0%` · 更新 `2026-08-09T18:09:58+00:00`
  - 卡点：pending nodes: S1,S2,S3
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260809-175751-intent-entrypoint_metadata-33c9fccb.status.json`；`~/.solar/harness/sprints/sprint-20260809-175751-intent-entrypoint_metadata-33c9fccb.task_graph.json`；`~/.solar/harness/sprints/sprint-20260809-175751-intent-entrypoint_metadata-33c9fccb.handoff.md`

- [ ] **N/A | Solar insight history to GenesisPod Radar**
  - ID：`genesispod-solar-insight-history-v1`
  - 真值：`warn` · `active/graph_in_progress` · `0%` · 更新 `2026-08-11T01:10:57+00:00`
  - 卡点：pending nodes: M1,M2,M3,M4
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/genesispod-solar-insight-history-v1.status.json`；`~/.solar/harness/sprints/genesispod-solar-insight-history-v1.task_graph.json`

### 需求受理与规划 (11)

- [ ] **P0 | P0 修复单：去除 tmux send-keys 作为主任务协议，收口到 operatord mailbox runti · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s05-verification-release`
  - 真值：`pending` · `drafting/spec` · `50%` · 更新 `2026-08-10T20:11:17+00:00`
  - 卡点：仍在 spec/drafting
  - 实际交付代码：`harness/tools/__init__.py`；`harness/tools/autopilot.py`；`harness/tools/smoke/s05_activation_proof.py`；`harness/tools/smoke/s05_e2e_mailbox.py`；`harness/tools/smoke/s05_e2e_mailbox.py` (NEW, 21721 bytes`；`harness/tools/smoke/s05_negative_controls.py`
  - 计划代码范围：`harness/tools/__init__.py`；`harness/tools/smoke/s05_activation_proof.py`；`harness/tools/smoke/s05_e2e_mailbox.py`；`harness/tools/smoke/s05_negative_controls.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s05-verification-release.handoff.md`

- [ ] **P0 | P0 修复单：把现有 GEPA Stage 1 substrate 升级为 Solar Optimizer 的离线元优化 · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s05-verification-release`
  - 真值：`pending` · `active/spec` · `50%` · 更新 `2026-08-11T00:23:06+00:00`
  - 卡点：仍在 spec/drafting
  - 实际交付代码：N/A
  - 计划代码范围：`harness/tests/test_gepa_optimizer_policy_negative.py`；`harness/tests/test_gepa_optimizer_release.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s05-verification-release.eval.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s05-verification-release.handoff.md`

- [ ] **P0 | GEPA Requirement Compiler 外循环第二阶段 · 核心实现与数据模型**
  - ID：`sprint-20260531-gepa-requirement-compiler-外循环第二阶段-s03-core-runtime`
  - 真值：`pending` · `drafting/spec` · `20%` · 更新 `2026-07-08T05:21:22+00:00`
  - 卡点：仍在 spec/drafting
  - 实际交付代码：`harness/lib/compile_eval/datasets/loader.py`；`harness/lib/compile_eval/datasets/test_dataset_plane.py`
  - 计划代码范围：`harness/integrations/gepa_optimizer`；`harness/lib/compile_eval`；`harness/lib/compile_eval/datasets`；`harness/lib/compiler_profile`；`harness/tests`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-gepa-requirement-compiler-外循环第二阶段-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260531-gepa-requirement-compiler-外循环第二阶段-s03-core-runtime.task_graph.json`；`~/.solar/harness/sprints/sprint-20260531-gepa-requirement-compiler-外循环第二阶段-s03-core-runtime.handoff.md`

- [ ] **P0 | P0 修复单：收口逻辑算子类型系统为 DAG 第一公民，并对齐 canonical bindings · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-收口逻辑算子类型系统为-dag-第一公民-并对齐-canonical-bindings-s05-verification-release`
  - 真值：`pending` · `drafting/spec` · `10%` · 更新 `2026-08-11T00:20:55+00:00`
  - 卡点：仍在 spec/drafting
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-收口逻辑算子类型系统为-dag-第一公民-并对齐-canonical-bindings-s05-verification-release.status.json`

- [ ] **P0 | P0 修复单：把 OperatorScore 从公式/测试层升级为 runtime 主评分与本地任务证据闭环 · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环-s05-verification-release`
  - 真值：`pending` · `drafting/spec` · `10%` · 更新 `2026-08-11T00:20:26+00:00`
  - 卡点：仍在 spec/drafting
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环-s05-verification-release.status.json`

- [ ] **P0 | P0 修复单：把 Antigravity 收口到 fan-out / exploration 位，禁止进入最终裁决位 · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s05-verification-release`
  - 真值：`pending` · `drafting/spec` · `10%` · 更新 `2026-08-11T00:22:59+00:00`
  - 卡点：仍在 spec/drafting
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s05-verification-release.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 修复单，作为现有 GEPA 元优化器落地的第二刀，目标是把 GEPA · 验证、回归与发布证据**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-修复单-作为现有-gepa-元优化器落地的第二刀-目标是把-gepa-s05-verification-release`
  - 真值：`pending` · `drafting/spec` · `10%` · 更新 `2026-08-11T00:20:38+00:00`
  - 卡点：仍在 spec/drafting
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-修复单-作为现有-gepa-元优化器落地的第二刀-目标是把-gepa-s05-verification-release.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是： · 验证、回归与发布证据**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-s05-verification-release`
  - 真值：`pending` · `drafting/spec` · `10%` · 更新 `2026-08-11T00:20:41+00:00`
  - 卡点：仍在 spec/drafting
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-s05-verification-release.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构整改单，主题是： · 验证、回归与发布证据**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是-s05-verification-release`
  - 真值：`pending` · `drafting/spec` · `10%` · 更新 `2026-08-11T00:21:12+00:00`
  - 卡点：仍在 spec/drafting
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是-s05-verification-release.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 优化器架构升级单，目标不是简单“接入一个 GEPA 包”或“套一个 · 验证、回归与发布证据**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s05-verification-release`
  - 真值：`pending` · `drafting/spec` · `10%` · 更新 `2026-08-11T00:21:29+00:00`
  - 卡点：仍在 spec/drafting
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s05-verification-release.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0/P1 聚焦执行单：GEPA Requirement Compiler · 验证、回归与发布证据**
  - ID：`sprint-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler-s05-verification-release`
  - 真值：`pending` · `drafting/spec` · `10%` · 更新 `2026-08-11T00:20:25+00:00`
  - 卡点：仍在 spec/drafting
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler-s05-verification-release.status.json`

### 其他待核 (27)

- [ ] **P0 | P0 修复单：把 capability/risk/cost 三张画像从配置层升级为 runtime 强约束 · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束-s05-verification-release`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:36+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束-s05-verification-release.status.json`

- [ ] **P0 | 需求单：APO v2 Lease / Quota / Cost-Aware Agent Plan Optimizer · 核心实现与数据模型**
  - ID：`sprint-20260530-需求单-apo-v2-lease-quota-cost-aware-agent-plan-optimizer-s03-core-runtime`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:42+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-需求单-apo-v2-lease-quota-cost-aware-agent-plan-optimizer-s03-core-runtime.status.json`

- [ ] **P0 | 需求单：APO v2 Lease / Quota / Cost-Aware Agent Plan Optimizer · 调度、自动化与可视化**
  - ID：`sprint-20260530-需求单-apo-v2-lease-quota-cost-aware-agent-plan-optimizer-s04-orchestration-ui`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:42+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-需求单-apo-v2-lease-quota-cost-aware-agent-plan-optimizer-s04-orchestration-ui.status.json`

- [ ] **P0 | P0 修复单：收口逻辑算子类型系统为 DAG 第一公民，并对齐 canonical bindings · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-收口逻辑算子类型系统为-dag-第一公民-并对齐-canonical-bindings-s02-architecture`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:37+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-收口逻辑算子类型系统为-dag-第一公民-并对齐-canonical-bindings-s02-architecture.status.json`

- [ ] **P0 | P0 修复单：收口逻辑算子类型系统为 DAG 第一公民，并对齐 canonical bindings · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-收口逻辑算子类型系统为-dag-第一公民-并对齐-canonical-bindings-s03-core-runtime`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:38+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-收口逻辑算子类型系统为-dag-第一公民-并对齐-canonical-bindings-s03-core-runtime.status.json`

- [ ] **P0 | P0 修复单：收口逻辑算子类型系统为 DAG 第一公民，并对齐 canonical bindings · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-收口逻辑算子类型系统为-dag-第一公民-并对齐-canonical-bindings-s04-orchestration-ui`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:38+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-收口逻辑算子类型系统为-dag-第一公民-并对齐-canonical-bindings-s04-orchestration-ui.status.json`

- [ ] **P0 | P0 修复单：把上下文主权收口到 Context Store，压缩长寿 pane 记忆污染路径 · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s05-verification-release`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:36+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s05-verification-release.status.json`

- [ ] **P0 | P0 修复单：把现有 capability capsule substrate 升级为完整的 capsule-nativ · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-把现有-capability-capsule-substrate-升级为完整的-capsule-nativ-s03-core-runtime`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:37+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-capability-capsule-substrate-升级为完整的-capsule-nativ-s03-core-runtime.status.json`

- [ ] **P0 | P0 修复单：把现有 capability capsule substrate 升级为完整的 capsule-nativ · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-把现有-capability-capsule-substrate-升级为完整的-capsule-nativ-s04-orchestration-ui`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:37+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-capability-capsule-substrate-升级为完整的-capsule-nativ-s04-orchestration-ui.status.json`

- [ ] **P0 | P0 修复单：把现有 capability capsule substrate 升级为完整的 capsule-nativ · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-把现有-capability-capsule-substrate-升级为完整的-capsule-nativ-s05-verification-release`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:37+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-capability-capsule-substrate-升级为完整的-capsule-nativ-s05-verification-release.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 修复单，作为现有 GEPA 元优化器落地的第二刀，目标是把 GEPA · 核心实现与数据模型**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-修复单-作为现有-gepa-元优化器落地的第二刀-目标是把-gepa-s03-core-runtime`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:39+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-修复单-作为现有-gepa-元优化器落地的第二刀-目标是把-gepa-s03-core-runtime.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 修复单，作为现有 GEPA 元优化器落地的第二刀，目标是把 GEPA · 调度、自动化与可视化**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-修复单-作为现有-gepa-元优化器落地的第二刀-目标是把-gepa-s04-orchestration-ui`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:39+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-修复单-作为现有-gepa-元优化器落地的第二刀-目标是把-gepa-s04-orchestration-ui.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，把现有的 Capsule-native Agent Pl · 验证、回归与发布证据**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl-s05-verification-release`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:41+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl-s05-verification-release.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是： · 核心实现与数据模型**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-2-s03-core-runtime`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:39+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-2-s03-core-runtime.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是： · 调度、自动化与可视化**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-2-s04-orchestration-ui`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:40+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-2-s04-orchestration-ui.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是： · 验证、回归与发布证据**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-2-s05-verification-release`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:40+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-2-s05-verification-release.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 总体架构升级单，正式命名为： · 验证、回归与发布证据**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s05-verification-release`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:39+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s05-verification-release.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是“统一数据访问层 / 上下文数据平面升级：把现有 · 核心实现与数据模型**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-统一数据访问层-上下文数据平面升级-把现有-s03-core-runtime`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:41+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-统一数据访问层-上下文数据平面升级-把现有-s03-core-runtime.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是“统一数据访问层 / 上下文数据平面升级：把现有 · 调度、自动化与可视化**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-统一数据访问层-上下文数据平面升级-把现有-s04-orchestration-ui`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:41+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-统一数据访问层-上下文数据平面升级-把现有-s04-orchestration-ui.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是“统一数据访问层 / 上下文数据平面升级：把现有 · 验证、回归与发布证据**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-统一数据访问层-上下文数据平面升级-把现有-s05-verification-release`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:41+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-统一数据访问层-上下文数据平面升级-把现有-s05-verification-release.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是“把现有 PM pane / Requiremen · 核心实现与数据模型**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把现有-pm-pane-requiremen-s03-core-runtime`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:40+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把现有-pm-pane-requiremen-s03-core-runtime.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是“把现有 PM pane / Requiremen · 调度、自动化与可视化**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把现有-pm-pane-requiremen-s04-orchestration-ui`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:40+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把现有-pm-pane-requiremen-s04-orchestration-ui.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是“把现有 PM pane / Requiremen · 验证、回归与发布证据**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把现有-pm-pane-requiremen-s05-verification-release`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:41+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把现有-pm-pane-requiremen-s05-verification-release.status.json`

- [ ] **P0 | 请为 solar-harness 开一个新的 P0/P1 总体架构升级单，主题是：把现有 Solar Harness 从 · 验证、回归与发布证据**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从-s05-verification-release`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:39+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从-s05-verification-release.status.json`

- [ ] **P0 | P0/P1 修复单：autopilot planner 空转去重与 dispatcher operator-pool compatibility · 验证、回归与发布证据**
  - ID：`sprint-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility-s05-verification-release`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:42+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility-s05-verification-release.status.json`

- [ ] **P0 | GEPA Requirement Compiler 外循环第二阶段 · 验证、回归与发布证据**
  - ID：`sprint-20260531-gepa-requirement-compiler-外循环第二阶段-s05-verification-release`
  - 真值：`warn` · `queued/epic_waiting_dependency` · `25%` · 更新 `2026-08-11T00:16:42+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-gepa-requirement-compiler-外循环第二阶段-s05-verification-release.status.json`

- [ ] **N/A | Review Solar insight history migration**
  - ID：`genesispod-solar-insight-history-review-v1`
  - 真值：`warn` · `active/graph_in_progress` · `0%` · 更新 `2026-08-11T01:13:28+00:00`
  - 卡点：等待下一轮执行
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/genesispod-solar-insight-history-review-v1.status.json`；`~/.solar/harness/sprints/genesispod-solar-insight-history-review-v1.task_graph.json`

## 已完成 / 已归档附录

> 共 `287` 张。勾选表示当前真值已闭环或已归档，不表示本次重新运行了其历史测试。

### 2026-W21 (53)

- [x] **N/A | list**
  - ID：`sprint-20260524-090505`
  - 真值：`warn` · `cancelled/aborted_empty_intake` · `0%` · 队列 `archived`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260524-090505.status.json`

- [x] **P0 | P0 修复 ThunderOMLX KVTC 接入质量：基于 arXiv 2511.01815 / ICLR 2026 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s01-requirements`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s01-requirements.task_graph.json`；`~/.solar/harness/sprints/sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s01-requirements.eval.json`

- [x] **P0 | P0 修复 ThunderOMLX KVTC 接入质量：基于 arXiv 2511.01815 / ICLR 2026 · 架构设计与接口契约**
  - ID：`sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s02-architecture.task_graph.json`；`~/.solar/harness/sprints/sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s02-architecture.eval.json`

- [x] **P0 | P0 修复 ThunderOMLX KVTC 接入质量：基于 arXiv 2511.01815 / ICLR 2026 · 核心实现与数据模型**
  - ID：`sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s03-core-runtime`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s03-core-runtime.task_graph.json`

- [x] **P0 | P0 修复 ThunderOMLX KVTC 接入质量：基于 arXiv 2511.01815 / ICLR 2026 · 调度、自动化与可视化**
  - ID：`sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s04-orchestration-ui`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s04-orchestration-ui.task_graph.json`；`~/.solar/harness/sprints/sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s04-orchestration-ui.eval.json`

- [x] **P0 | P0 修复 ThunderOMLX KVTC 接入质量：基于 arXiv 2511.01815 / ICLR 2026 · 验证、回归与发布证据**
  - ID：`sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s05-verification-release`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026-s05-verification-release.handoff.md`

- [x] **P0 | P0 修复 ThunderOMLX KVTC 接入质量：基于 arXiv 2511.01815 / ICLR 2026**
  - ID：`epic-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026.status.json`；`~/.solar/harness/sprints/epic-20260521-p0-修复-thunderomlx-kvtc-接入质量-基于-arxiv-2511-01815-iclr-2026.task_graph.json`

- [x] **P0 | Pane-as-Physical-Operator Architecture**
  - ID：`sprint-20260523-pane-as-physical-operator-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/schemas/physical-operators.schema.v2.draft.json`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260523-pane-as-physical-operator-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260523-pane-as-physical-operator-architecture.task_graph.json`

- [x] **P0 | Physical Operator Taxonomy Truthification**
  - ID：`sprint-20260523-physical-operator-taxonomy-truthification`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260523-physical-operator-taxonomy-truthification.status.json`；`~/.solar/harness/sprints/sprint-20260523-physical-operator-taxonomy-truthification.task_graph.json`

- [x] **P0 | Operator Class Compatibility Cutover**
  - ID：`sprint-20260523-operator-class-compatibility-cutover`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260523-operator-class-compatibility-cutover.status.json`；`~/.solar/harness/sprints/sprint-20260523-operator-class-compatibility-cutover.task_graph.json`

- [x] **P0 | Tech Hotspot Radar 科技热点雷达一期产品化**
  - ID：`sprint-20260523-tech-hotspot-radar-productization`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/ai-influence-digest/references/accounts_extended.txt`；`harness/config/github-trends.yaml`；`harness/config/tech-hotspot-radar.yaml`；`harness/docs/tech-hotspot-radar.md`；`harness/scripts/ai_influence_daily.py`；`harness/scripts/ai_influence_unified_report.py`；`harness/scripts/github_trends_digest.py`；`harness/scripts/tech_hotspot_radar.py`；`harness/scripts/youtube_influence_digest.py`；`harness/solar-harness.sh`；`harness/tests/test-tech-hotspot-radar.sh`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260523-tech-hotspot-radar-productization.status.json`；`~/.solar/harness/sprints/sprint-20260523-tech-hotspot-radar-productization.task_graph.json`

- [x] **P0 | Actor Host Runtime Completion Audit**
  - ID：`sprint-20260524-actor-host-runtime-completion-audit`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/monitor-reports/actor-host-runtime-completion-audit.md`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260524-actor-host-runtime-completion-audit.status.json`；`~/.solar/harness/sprints/sprint-20260524-actor-host-runtime-completion-audit.task_graph.json`

- [x] **P0 | P0: Knowledge-wide ThunderOMLX semantic layer. Scope: all kn · 需求拆解与追踪矩阵**
  - ID：`sprint-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn-s01-requirements`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn-s01-requirements.task_graph.json`

- [x] **P0 | P0: Knowledge-wide ThunderOMLX semantic layer. Scope: all kn · 架构设计与接口契约**
  - ID：`sprint-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn-s02-architecture.task_graph.json`

- [x] **P0 | P0: Knowledge-wide ThunderOMLX semantic layer. Scope: all kn · 核心实现与数据模型**
  - ID：`sprint-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn-s03-core-runtime`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/knowledge_extracted_renderer.py`；`harness/lib/knowledge_ingest_dispatcher.py`；`harness/lib/knowledge_ingest_registry.py`；`harness/lib/knowledge_source_adapters.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn-s03-core-runtime.task_graph.json`

- [x] **P0 | P0: Knowledge-wide ThunderOMLX semantic layer. Scope: all kn · 调度、自动化与可视化**
  - ID：`sprint-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn-s04-orchestration-ui`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/knowledge_dashboard.py`；`harness/lib/knowledge_grounding_hook.py`；`harness/lib/knowledge_ingest_dispatcher.py`；`harness/lib/knowledge_ingest_health.py`；`harness/lib/solar-knowledge-context.py`；`harness/tools/tech-hotspot-report-reader.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn-s04-orchestration-ui.task_graph.json`

- [x] **P0 | P0: Knowledge-wide ThunderOMLX semantic layer. Scope: all kn · 验证、回归与发布证据**
  - ID：`sprint-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn-s05-verification-release`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/tests/test_knowledge_v2.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn-s05-verification-release.task_graph.json`

- [x] **P0 | P0: AI Influence GitHub Project Intelligence System. Upgrade · 需求拆解与追踪矩阵**
  - ID：`sprint-20260524-p0-ai-influence-github-project-intelligence-system-upgrade-s01-requirements`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260524-p0-ai-influence-github-project-intelligence-system-upgrade-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260524-p0-ai-influence-github-project-intelligence-system-upgrade-s01-requirements.task_graph.json`

- [x] **P0 | P0: AI Influence GitHub Project Intelligence System. Upgrade · 架构设计与接口契约**
  - ID：`sprint-20260524-p0-ai-influence-github-project-intelligence-system-upgrade-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/config/github_intelligence_config.yaml`；`harness/lib/github_intelligence/__init__.py`；`harness/lib/github_intelligence/adapters/__init__.py`；`harness/lib/github_intelligence/adapters/base.py`；`harness/lib/github_intelligence/adapters/cross_source.py`；`harness/lib/github_intelligence/adapters/topic.py`；`harness/lib/github_intelligence/adapters/tracked.py`；`harness/lib/github_intelligence/adapters/trending.py`；`harness/lib/github_intelligence/alerts.py`；`harness/lib/github_intelligence/cards.py`；`harness/lib/github_intelligence/detectors.py`；`harness/lib/github_intelligence/model_ledger.py`；另 7 项
  - 计划代码范围：`harness/config/github_intelligence_config.yaml`；`harness/lib/github_intelligence/adapters`；`harness/lib/github_intelligence/alerts.py`；`harness/lib/github_intelligence/briefs.py`；`harness/lib/github_intelligence/cards.py`；`harness/lib/github_intelligence/detectors.py`；`harness/lib/github_intelligence/evidence.py`；`harness/lib/github_intelligence/model_ledger.py`；`harness/lib/github_intelligence/packets.py`；`harness/lib/github_intelligence/percentiles.py`；`harness/lib/github_intelligence/pipeline.py`；`harness/lib/github_intelligence/reports/daily.py`；另 5 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260524-p0-ai-influence-github-project-intelligence-system-upgrade-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260524-p0-ai-influence-github-project-intelligence-system-upgrade-s02-architecture.task_graph.json`

- [x] **P0 | P0: AI Influence GitHub Project Intelligence System. Upgrade · 核心实现与数据模型**
  - ID：`sprint-20260524-p0-ai-influence-github-project-intelligence-system-upgrade-s03-core-runtime`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/github_intelligence/adapters/__init__.py`；`harness/lib/github_intelligence/adapters/cross_source.py`；`harness/lib/github_intelligence/adapters/topic.py`；`harness/lib/github_intelligence/adapters/tracked.py`；`harness/lib/github_intelligence/adapters/trending.py`；`harness/lib/github_intelligence/briefs.py`；`harness/lib/github_intelligence/cards.py`；`harness/lib/github_intelligence/detectors.py`；`harness/lib/github_intelligence/detectors.py` (24692 bytes, 2026-05-26 10`；`harness/lib/github_intelligence/evidence.py`；`harness/lib/github_intelligence/evidence.py` (34997 bytes, 2026-05-26 01`；`harness/lib/github_intelligence/pipeline.py`；另 4 项
  - 计划代码范围：`harness/lib/github_intelligence/adapters`；`harness/lib/github_intelligence/briefs.py`；`harness/lib/github_intelligence/cards.py`；`harness/lib/github_intelligence/detectors.py`；`harness/lib/github_intelligence/evidence.py`；`harness/lib/github_intelligence/model_ledger.py`；`harness/lib/github_intelligence/pipeline.py`；`harness/lib/github_intelligence/reports`；`harness/lib/github_intelligence/schema.py`；`harness/lib/github_intelligence/snapshots.py`；`harness/tests/test_github_intelligence.py`；`harness/tests/test_pipeline.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260524-p0-ai-influence-github-project-intelligence-system-upgrade-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260524-p0-ai-influence-github-project-intelligence-system-upgrade-s03-core-runtime.task_graph.json`

- [x] **P0 | P0: AI Influence GitHub Project Intelligence System. Upgrade · 调度、自动化与可视化**
  - ID：`sprint-20260524-p0-ai-influence-github-project-intelligence-system-upgrade-s04-orchestration-ui`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib`；`harness/reports`；`harness/reports/orchestration-release-20260528.md`；`harness/tests/graph/test_multi_task_runner_success_status.py`；`harness/tests/graph/test_node_proof_obligations.py`
  - 计划代码范围：`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/multi_task_runner.py`；`harness/reports`；`harness/tests/graph`；`harness/tests/graph/test_graph_status_sync.py`；`harness/tests/graph/test_multi_task_runner_success_status.py`；`harness/tests/graph/test_node_proof_obligations.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260524-p0-ai-influence-github-project-intelligence-system-upgrade-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260524-p0-ai-influence-github-project-intelligence-system-upgrade-s04-orchestration-ui.task_graph.json`

- [x] **P0 | P0: AI Influence GitHub Project Intelligence System. Upgrade · 验证、回归与发布证据**
  - ID：`sprint-20260524-p0-ai-influence-github-project-intelligence-system-upgrade-s05-verification-release`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/docs/github-project-intelligence/RELEASE.md`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260524-p0-ai-influence-github-project-intelligence-system-upgrade-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260524-p0-ai-influence-github-project-intelligence-system-upgrade-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260524-p0-ai-influence-github-project-intelligence-system-upgrade-s05-verification-release.eval.json`

- [x] **P0 | P0: AI Influence GitHub Project Intelligence System. Upgrade**
  - ID：`epic-20260524-p0-ai-influence-github-project-intelligence-system-upgrade`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/config/github_intelligence_config.yaml`；`harness/lib`；`harness/lib/github_intelligence/__init__.py`；`harness/lib/github_intelligence/adapters/__init__.py`；`harness/lib/github_intelligence/adapters/base.py`；`harness/lib/github_intelligence/adapters/cross_source.py`；`harness/lib/github_intelligence/adapters/topic.py`；`harness/lib/github_intelligence/adapters/tracked.py`；`harness/lib/github_intelligence/adapters/trending.py`；`harness/lib/github_intelligence/alerts.py`；`harness/lib/github_intelligence/briefs.py`；`harness/lib/github_intelligence/cards.py`；另 20 项
  - 计划代码范围：`harness/config/github_intelligence_config.yaml`；`harness/docs/github-project-intelligence/RELEASE.md`；`harness/lib/github_intelligence/adapters`；`harness/lib/github_intelligence/alerts.py`；`harness/lib/github_intelligence/briefs.py`；`harness/lib/github_intelligence/cards.py`；`harness/lib/github_intelligence/detectors.py`；`harness/lib/github_intelligence/evidence.py`；`harness/lib/github_intelligence/model_ledger.py`；`harness/lib/github_intelligence/packets.py`；`harness/lib/github_intelligence/percentiles.py`；`harness/lib/github_intelligence/pipeline.py`；另 16 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260524-p0-ai-influence-github-project-intelligence-system-upgrade.status.json`；`~/.solar/harness/sprints/epic-20260524-p0-ai-influence-github-project-intelligence-system-upgrade.task_graph.json`

- [x] **P0 | P0: Knowledge-wide ThunderOMLX semantic layer. Scope: all kn**
  - ID：`epic-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/knowledge_dashboard.py`；`harness/lib/knowledge_extracted_renderer.py`；`harness/lib/knowledge_grounding_hook.py`；`harness/lib/knowledge_ingest_dispatcher.py`；`harness/lib/knowledge_ingest_health.py`；`harness/lib/knowledge_ingest_registry.py`；`harness/lib/knowledge_source_adapters.py`；`harness/lib/solar-knowledge-context.py`；`harness/tests/test_knowledge_v2.py`；`harness/tools/tech-hotspot-report-reader.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn.status.json`；`~/.solar/harness/sprints/epic-20260524-p0-knowledge-wide-thunderomlx-semantic-layer-scope-all-kn.task_graph.json`

- [x] **P1 | GEPA optimize_anything integration design for Solar-Harness**
  - ID：`sprint-20260522-gepa-optimize-anything-integration`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/monitor-reports/gepa-optimize-anything-integration.md`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260522-gepa-optimize-anything-integration.status.json`；`~/.solar/harness/sprints/sprint-20260522-gepa-optimize-anything-integration.task_graph.json`

- [x] **P1 | GEPA optimize_anything Stage 1 implementation**
  - ID：`sprint-20260522-gepa-optimize-anything-implementation`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/integrations/gepa_optimizer/__init__.py`；`harness/integrations/gepa_optimizer/adapter.py`；`harness/integrations/gepa_optimizer/artifact_store.py`；`harness/integrations/gepa_optimizer/budgets.py`；`harness/integrations/gepa_optimizer/cli.py`；`harness/integrations/gepa_optimizer/evaluator.py`；`harness/integrations/gepa_optimizer/operator_router.py`；`harness/integrations/gepa_optimizer/promote.py`；`harness/monitor-reports/gepa-optimize-anything-implementation.md`；`harness/optimizer-runs`；`harness/tests/integrations/gepa_optimizer`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260522-gepa-optimize-anything-implementation.status.json`；`~/.solar/harness/sprints/sprint-20260522-gepa-optimize-anything-implementation.task_graph.json`

- [x] **N/A | ThunderOMLX P0 cache warm and advisor metrics**
  - ID：`sprint-20260520-thunderomlx-cache-warm-advisor`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/monitor-reports`；`harness/scripts`；`harness/scripts/thunderomlx_prewarm_four_pane.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260520-thunderomlx-cache-warm-advisor.status.json`；`~/.solar/harness/sprints/sprint-20260520-thunderomlx-cache-warm-advisor.task_graph.json`；`~/.solar/harness/sprints/sprint-20260520-thunderomlx-cache-warm-advisor.handoff.md`

- [x] **N/A | ThunderOMLX + Qwen3.6 pane overhead analysis**
  - ID：`sprint-20260520-thunderomlx-qwen36-pane-overhead`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/monitor-reports`；`harness/run/claude-settings`；`harness/scripts`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260520-thunderomlx-qwen36-pane-overhead.status.json`；`~/.solar/harness/sprints/sprint-20260520-thunderomlx-qwen36-pane-overhead.task_graph.json`

- [x] **N/A | Fix stale Python multi-task scheduler runners after completed graphs**
  - ID：`sprint-20260520-multitask-stale-python-runner`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/multi_task_runner.py`；`harness/monitor-reports`；`harness/scripts`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260520-multitask-stale-python-runner.status.json`；`~/.solar/harness/sprints/sprint-20260520-multitask-stale-python-runner.task_graph.json`

- [x] **N/A | Clarify multi-task completed window status and safe archive path**
  - ID：`sprint-20260521-multitask-history-window-label`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/multi_task_runner.py`；`harness/monitor-reports`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260521-multitask-history-window-label.status.json`；`~/.solar/harness/sprints/sprint-20260521-multitask-history-window-label.task_graph.json`；`~/.solar/harness/sprints/sprint-20260521-multitask-history-window-label.eval.json`

- [x] **N/A | ThunderOMLX Prompt Cache API and Cache Advisor repair**
  - ID：`sprint-20260521-thunderomlx-prompt-cache-advisor-repair`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/monitor-reports/live-regression/r3-*.log`；`harness/monitor-reports/live-regression/r4-*.log`；`harness/monitor-reports/regression/prompt-cache-save-regression.sh`；`harness/monitor-reports/repo-cleanup/r2-advisor-rerun-20260529T180151Z.json`；`harness/monitor-reports/thunderomlx-cache-advisor-report.md`；`harness/scripts/thunderomlx_cache_advisor_report.py`；`harness/scripts/thunderomlx_prewarm_four_pane.py`
  - 计划代码范围：`harness/monitor-reports/final-acceptance`；`harness/monitor-reports/live-regression`；`harness/monitor-reports/repo-cleanup`；`harness/scripts/thunderomlx_cache_advisor_report.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260521-thunderomlx-prompt-cache-advisor-repair.status.json`；`~/.solar/harness/sprints/sprint-20260521-thunderomlx-prompt-cache-advisor-repair.task_graph.json`

- [x] **N/A | ThunderOMLX full cache mechanism audit and optimization backlog**
  - ID：`sprint-20260521-thunderomlx-cache-mechanism-audit`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/monitor-reports/thunderomlx-cache-mechanism-audit-N1-inventory.md`；`harness/monitor-reports/thunderomlx-cache-mechanism-audit-N2-runtime.md`；`harness/monitor-reports/thunderomlx-cache-mechanism-audit.md`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260521-thunderomlx-cache-mechanism-audit.status.json`；`~/.solar/harness/sprints/sprint-20260521-thunderomlx-cache-mechanism-audit.task_graph.json`

- [x] **N/A | ThunderOMLX AnthropicProxy prefix cache repair for pane4**
  - ID：`sprint-20260521-thunderomlx-anthropic-prefix-cache`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/monitor-reports/thunderomlx-anthropic-prefix-cache-N1-before.md`；`harness/monitor-reports/thunderomlx-anthropic-prefix-cache-repair.md`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260521-thunderomlx-anthropic-prefix-cache.status.json`；`~/.solar/harness/sprints/sprint-20260521-thunderomlx-anthropic-prefix-cache.task_graph.json`

- [x] **N/A | ThunderOMLX AnthropicProxy cache hit without garbled output**
  - ID：`sprint-20260521-thunderomlx-anthropic-cache-hit-no-garbled`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/monitor-reports/thunderomlx-anthropic-cache-hit-no-garbled-N3-stress.md`
  - 计划代码范围：`harness/logs`；`harness/monitor-reports/thunderomlx-anthropic-cache-hit-no-garbled-N1-baseline.md`；`harness/monitor-reports/thunderomlx-anthropic-cache-hit-no-garbled-N2-cache-hit.md`；`harness/monitor-reports/thunderomlx-anthropic-cache-hit-no-garbled-N3-stress.md`；`harness/monitor-reports/thunderomlx-anthropic-cache-hit-no-garbled.md`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260521-thunderomlx-anthropic-cache-hit-no-garbled.status.json`；`~/.solar/harness/sprints/sprint-20260521-thunderomlx-anthropic-cache-hit-no-garbled.task_graph.json`

- [x] **N/A | ThunderOMLX Anthropic cache usage observability**
  - ID：`sprint-20260521-thunderomlx-anthropic-cache-usage-observability`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/monitor-reports/thunderomlx-anthropic-cache-usage-observability-N1-audit.md`；`harness/monitor-reports/thunderomlx-anthropic-cache-usage-observability.md`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260521-thunderomlx-anthropic-cache-usage-observability.status.json`；`~/.solar/harness/sprints/sprint-20260521-thunderomlx-anthropic-cache-usage-observability.task_graph.json`

- [x] **N/A | ThunderOMLX authenticated readiness probe**
  - ID：`sprint-20260521-thunderomlx-readiness-probe-auth`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/monitor-reports/thunderomlx-readiness-probe-auth-N1-audit.md`；`harness/monitor-reports/thunderomlx-readiness-probe-auth.md`；`harness/tests/test_thunderomlx_health_probe.py`；`harness/tools/thunderomlx_health_probe.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260521-thunderomlx-readiness-probe-auth.status.json`；`~/.solar/harness/sprints/sprint-20260521-thunderomlx-readiness-probe-auth.task_graph.json`

- [x] **N/A | Knowledge extraction runtime artifact backfill**
  - ID：`sprint-20260521-knowledge-extraction-runtime-artifact-backfill`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/monitor-reports/knowledge-extraction-runtime-artifact-backfill-N1-audit.md`；`harness/monitor-reports/knowledge-extraction-runtime-artifact-backfill-N2-exporter.md`；`harness/monitor-reports/knowledge-extraction-runtime-artifact-backfill.md`；`harness/tests/test-runtime-artifact-knowledge-export.sh`；`harness/tools/runtime-artifact-knowledge-export.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260521-knowledge-extraction-runtime-artifact-backfill.status.json`；`~/.solar/harness/sprints/sprint-20260521-knowledge-extraction-runtime-artifact-backfill.task_graph.json`

- [x] **N/A | ThunderOMLX knowledge extraction smoke**
  - ID：`sprint-20260521-thunderomlx-knowledge-extract-smoke`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/monitor-reports/thunderomlx-knowledge-extract-smoke.md`；`harness/run/knowledge-extract-smoke/output`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260521-thunderomlx-knowledge-extract-smoke.status.json`；`~/.solar/harness/sprints/sprint-20260521-thunderomlx-knowledge-extract-smoke.task_graph.json`

- [x] **N/A | ThunderOMLX knowledge extraction smoke rerun for cache hit verification**
  - ID：`sprint-20260521-thunderomlx-knowledge-extract-smoke-rerun`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/monitor-reports/thunderomlx-knowledge-extract-smoke-rerun.md`；`harness/run/knowledge-extract-smoke-rerun/output`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260521-thunderomlx-knowledge-extract-smoke-rerun.status.json`；`~/.solar/harness/sprints/sprint-20260521-thunderomlx-knowledge-extract-smoke-rerun.task_graph.json`

- [x] **N/A | ThunderOMLX knowledge extraction cache benchmark**
  - ID：`sprint-20260521-thunderomlx-knowledge-cache-benchmark`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/monitor-reports/thunderomlx-knowledge-cache-benchmark.md`；`harness/run/thunderomlx-knowledge-cache-benchmark`；`harness/run/thunderomlx-knowledge-cache-benchmark/results.json`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260521-thunderomlx-knowledge-cache-benchmark.status.json`；`~/.solar/harness/sprints/sprint-20260521-thunderomlx-knowledge-cache-benchmark.task_graph.json`

- [x] **N/A | Solar-Harness physical operator registry for tmux headless panes**
  - ID：`sprint-20260521-physical-operator-registry`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/monitor-reports/physical-operator-registry.md`；`harness/monitor-reports/physical-operator-registry.md` (new`
  - 计划代码范围：`harness/config/physical-operators.json`；`harness/lib/multi_task_runner.py`；`harness/monitor-reports/physical-operator-registry.md`；`harness/tests/test-physical-operator-registry.sh`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260521-physical-operator-registry.status.json`；`~/.solar/harness/sprints/sprint-20260521-physical-operator-registry.task_graph.json`

- [x] **N/A | 20260522-model-fleet-operator-runtime-foundation**
  - ID：`sprint-20260522-model-fleet-operator-runtime-foundation`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/config/physical-operators.schema.json`；`harness/lib/multi_task_runner.py`；`harness/lib/operator_runtime.py`；`harness/monitor-reports/model-fleet-operator-runtime-foundation.md`；`harness/tests/test-physical-operator-logical-selector.py`；`harness/tests/test-solar-monitor-bridge-global.py`；`harness/tools/solar_monitor_bridge.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260522-model-fleet-operator-runtime-foundation.status.json`；`~/.solar/harness/sprints/sprint-20260522-model-fleet-operator-runtime-foundation.task_graph.json`

- [x] **N/A | Operatord Daemon + Submit Production Cutover**
  - ID：`sprint-20260522-operatord-daemon-submit-production`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/docs/operatord-daemon-submit-cutover.md`；`harness/lib/multi_task_runner.py`；`harness/lib/multi_task_status.py`；`harness/lib/operator_persona.py`；`harness/lib/operator_runtime.py`；`harness/monitor-reports/operatord-daemon-submit-production.md`；`harness/tests/runtime/test_multi_task_runner_submit_path.py`；`harness/tests/runtime/test_operator_persona.py`；`harness/tests/runtime/test_operator_runtime.py`；`harness/tests/test_no_direct_tmux_send_keys.py`；`harness/tests/test_operator_status_observability.py`；`harness/tests/test_operatord_daemon.py`；另 2 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260522-operatord-daemon-submit-production.status.json`；`~/.solar/harness/sprints/sprint-20260522-operatord-daemon-submit-production.task_graph.json`

- [x] **N/A | Claude Interactive vs Programmatic Physical Operator Split**
  - ID：`sprint-20260523-claude-operator-billing-split`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/config/physical-operators.json`；`harness/config/physical-operators.schema.json`；`harness/docs/claude-operator-billing-split.md`；`harness/lib/claude_surface.py`；`harness/lib/multi_task_runner.py`；`harness/lib/multi_task_status.py`；`harness/monitor-reports/claude-operator-billing-split.md`；`harness/tests/test_claude_surface.py`；`harness/tests/test_operator_status_observability.py`；`harness/tests/test_physical_operator_logical_selector.py`；`harness/tests/test_physical_operator_schema.py`；`harness/tools/monitor_bridge.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260523-claude-operator-billing-split.status.json`；`~/.solar/harness/sprints/sprint-20260523-claude-operator-billing-split.task_graph.json`

- [x] **N/A | Lease-based Model Fleet Runtime**
  - ID：`sprint-20260523-lease-based-model-fleet-runtime`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/actor_lease.py`；`harness/lib/actor_mailbox.py`；`harness/lib/actor_profiles.py`；`harness/lib/actor_runtime.py`；`harness/lib/capability_token.py`；`harness/lib/context_store.py`；`harness/lib/evidence_ledger.py`；`harness/lib/failure_fingerprint.py`；`harness/lib/logical_operator_router.py`；`harness/lib/multi_task_status.py`；`harness/lib/operator_score.py`；`harness/lib/verification_gate.py`；另 14 项
  - 计划代码范围：`harness/config/actor-hosts.json`；`harness/config/actor-hosts.schema.json`；`harness/config/agent-actors.json`；`harness/config/agent-actors.schema.json`；`harness/config/capability-token.schema.json`；`harness/config/context-store.json`；`harness/config/context-store.schema.json`；`harness/config/logical-operators.json`；`harness/config/logical-operators.schema.json`；`harness/docs/lease-based-model-fleet-runtime.md`；`harness/lib/actor_lease.py`；`harness/lib/actor_mailbox.py`；另 29 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260523-lease-based-model-fleet-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260523-lease-based-model-fleet-runtime.task_graph.json`；`~/.solar/harness/sprints/sprint-20260523-lease-based-model-fleet-runtime.eval.json`

- [x] **N/A | PM Pane Requirement Compiler — Backend Foundation**
  - ID：`sprint-20260523-pm-pane-requirement-compiler-backend-foundation`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/schemas/requirement-ir.schema.v1.draft.json`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260523-pm-pane-requirement-compiler-backend-foundation.status.json`；`~/.solar/harness/sprints/sprint-20260523-pm-pane-requirement-compiler-backend-foundation.task_graph.json`

- [x] **N/A | 为 PM pane / Requirement Compiler 建立 Quality Loop：以 Requirement IR 为唯一事实源，补齐 gold**
  - ID：`sprint-20260523-requirement-compiler-quality-loop`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/schemas/compile-quality-metrics.schema.v1.draft.json`；`harness/schemas/feedback-event.schema.v1.draft.json`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260523-requirement-compiler-quality-loop.status.json`；`~/.solar/harness/sprints/sprint-20260523-requirement-compiler-quality-loop.task_graph.json`

- [x] **N/A | Agent Plan Optimizer Foundation (APO/AQO)**
  - ID：`sprint-20260523-agent-plan-optimizer-foundation`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260523-agent-plan-optimizer-foundation.status.json`；`~/.solar/harness/sprints/sprint-20260523-agent-plan-optimizer-foundation.task_graph.json`

- [x] **N/A | 小修复单：把控制面的 external prerequisite 从只能按整张 sprint status 放行，升级为支持按关键阶段/关键节点放行，避免像 s**
  - ID：`sprint-20260524-133807`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/epic_decomposer.py`；`harness/lib/graph_scheduler.py`；`harness/lib/prerequisite_resolver.py`；`harness/lib/workflow_guard.py`；`harness/tests/test_prerequisite_resolver.py`；`harness/tools/solar-autopilot-monitor.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260524-133807.status.json`；`~/.solar/harness/sprints/sprint-20260524-133807.task_graph.json`

- [x] **N/A | 基于现有 APO/AQO 方向，正式补一张 strategy sprint：把 Skill、MCP、Capsule、Physical Operator、Opti**
  - ID：`sprint-20260524-134738`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/docs/architecture`；`harness/docs/architecture/` (new`；`harness/docs/architecture/apo-optimizer-flow-integration-note.md`；`harness/docs/architecture/mcp-policy-guard-rationale.md`；`harness/docs/architecture/skill-mcp-capsule-operator-optimizer.adr.md`；`harness/schemas/draft`；`harness/schemas/draft/` (new`；`harness/schemas/draft/execution-capsule.v1.draft.json`；`harness/schemas/draft/mcp-capability.v1.draft.json`；`harness/schemas/draft/operator-profile.addendum.v1.draft.json`；`harness/schemas/draft/skill.v2.draft.json`
  - 计划代码范围：`harness/docs/architecture/apo-optimizer-flow-integration-note.md`；`harness/docs/architecture/mcp-policy-guard-rationale.md`；`harness/docs/architecture/skill-mcp-capsule-operator-optimizer.adr.md`；`harness/schemas/draft/execution-capsule.v1.draft.json`；`harness/schemas/draft/mcp-capability.v1.draft.json`；`harness/schemas/draft/operator-profile.addendum.v1.draft.json`；`harness/schemas/draft/skill.v2.draft.json`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260524-134738.status.json`；`~/.solar/harness/sprints/sprint-20260524-134738.task_graph.json`

- [x] **N/A | P0: Knowledge Ingest Dispatcher 统一控制面：所有 raw、Obsidian vault、**
  - ID：`sprint-20260524-105859`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/knowledge_extract_json.py`；`harness/lib/knowledge_extracted_renderer.py`；`harness/lib/knowledge_ingest_dispatcher.py`；`harness/lib/knowledge_ingest_health.py`；`harness/lib/knowledge_ingest_health.py` (171 lines`；`harness/lib/knowledge_ingest_registry.py`；`harness/lib/knowledge_ingest_registry.py` (324 lines`；`harness/tests/test-knowledge-extract-json.sh`；`harness/tests/test-knowledge-ingest-dispatcher.sh`；`harness/tests/test-knowledge-ingest-health.sh`；`harness/tests/test-knowledge-ingest-health.sh` (56 lines`；`harness/tests/test-knowledge-ingest-registry.sh`；另 1 项
  - 计划代码范围：`harness/lib/knowledge_extract_json.py`；`harness/lib/knowledge_extracted_renderer.py`；`harness/lib/knowledge_extracted_validator.py`；`harness/lib/knowledge_ingest_dispatcher.py`；`harness/lib/knowledge_ingest_health.py`；`harness/lib/knowledge_ingest_registry.py`；`harness/lib/knowledge_qmd_indexer.py`；`harness/lib/knowledge_source_adapters.py`；`harness/lib/knowledge_spans.py`；`harness/scripts/knowledge_ingest_sample_backfill.py`；`harness/tests/test-knowledge-extract-json.sh`；`harness/tests/test-knowledge-extracted-validator.sh`；另 5 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260524-105859.status.json`；`~/.solar/harness/sprints/sprint-20260524-105859.task_graph.json`

- [x] **N/A | ess/sprints/sprint-20260524-p0-knowledge-wide-thunderomlx-se**
  - ID：`sprint-20260524-141723`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/knowledge_extracted_renderer.py`；`harness/lib/knowledge_ingest_dispatcher.py`；`harness/lib/knowledge_ingest_registry.py`；`harness/lib/knowledge_source_adapters.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260524-141723.status.json`；`~/.solar/harness/sprints/sprint-20260524-141723.task_graph.json`

- [x] **N/A | 请基于以下两版战略需求，为 Solar-Harness 开启一个正式实现 sprint：**
  - ID：`sprint-20260524-solar-research-os-v1-core`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/research/claim_compiler.py`；`harness/lib/research/cli.py`；`harness/lib/research/evaluator.py`；`harness/lib/research/sources/__init__.py`；`harness/lib/research/sources/registry.py`；`harness/lib/research/state_machine.py`；`harness/lib/research/storage.py`；`harness/lib/research/survey/finalize_run.py`；`harness/schemas/draft/claim-compiler-v2-contract.draft.json`；`harness/schemas/draft/research-task-spec.v1.draft.json`；`harness/tests/research_integration/test_deepresearch_quality_gate_verdict.py`
  - 计划代码范围：`harness/docs/architecture`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/operator_runtime.py`；`harness/lib/research`；`harness/lib/research/cli.py`；`harness/lib/research/evaluator.py`；`harness/lib/research/sources`；`harness/lib/research/state_machine.py`；`harness/lib/research/storage.py`；`harness/lib/research/survey`；`harness/monitor-reports/sprint-20260524-solar-research-os-v1-core-rollout.md`；`harness/schemas/draft`；另 2 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260524-solar-research-os-v1-core.status.json`；`~/.solar/harness/sprints/sprint-20260524-solar-research-os-v1-core.task_graph.json`

### 2026-W22 (188)

- [x] **P0 | 在 Mac mini 的 Claude Code 环境安装并集成 Lum1104/Understand-Anything · 架构设计与接口契约**
  - ID：`sprint-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything-s02-architecture`
  - 真值：`warn` · `cancelled/superseded` · `0%` · 队列 `archived`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything-s02-architecture.eval.json`；`~/.solar/harness/sprints/sprint-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything-s02-architecture.handoff.md`

- [x] **P0 | 在 Mac mini 的 Claude Code 环境安装并集成 Lum1104/Understand-Anything · 核心实现与数据模型**
  - ID：`sprint-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything-s03-core-runtime`
  - 真值：`warn` · `cancelled/superseded` · `0%` · 队列 `archived`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything-s03-core-runtime.status.json`

- [x] **P0 | 在 Mac mini 的 Claude Code 环境安装并集成 Lum1104/Understand-Anything · 调度、自动化与可视化**
  - ID：`sprint-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything-s04-orchestration-ui`
  - 真值：`warn` · `cancelled/superseded` · `0%` · 队列 `archived`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything-s04-orchestration-ui.status.json`

- [x] **P0 | 在 Mac mini 的 Claude Code 环境安装并集成 Lum1104/Understand-Anything · 验证、回归与发布证据**
  - ID：`sprint-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything-s05-verification-release`
  - 真值：`warn` · `cancelled/superseded` · `0%` · 队列 `archived`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything-s05-verification-release.status.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0/P1 聚焦执行单：GEPA Requirement Compiler · 需求拆解与追踪矩阵**
  - ID：`sprint-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler-s01-requirements`
  - 真值：`warn` · `superseded/prd_ready` · `0%` · 队列 `archived`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler-s01-requirements.status.json`

- [x] **N/A | task-graph status sprint-20260525-tech-hotspot-radar-social-**
  - ID：`sprint-20260529-080443`
  - 真值：`warn` · `cancelled/superseded` · `0%` · 队列 `archived`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260529-080443.status.json`

- [x] **P0 | HTML Anything Default Renderer Integration**
  - ID：`sprint-20260525-p0-html-anything-default-renderer-integration`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/docs`；`harness/docs/html-renderer-migration.md`；`harness/lib/accepted-artifact-export.py`；`harness/lib/html_anything_adapter.py`；`harness/lib/html_artifact.py`；`harness/lib/render_sprint_html.py`；`harness/templates/html-anything-profiles/design.json`；`harness/templates/html-anything-profiles/planning.json`；`harness/templates/html-anything-profiles/prd.json`；`harness/tests/test-html-anything-adapter.sh`；`harness/tests/test-html-anything-self-contained.py`；`harness/vendor/html-anything`；另 1 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-p0-html-anything-default-renderer-integration.status.json`；`~/.solar/harness/sprints/sprint-20260525-p0-html-anything-default-renderer-integration.task_graph.json`

- [x] **P0 | P0: AI Influence GitHub Trend & Action Analyzer Ultimate**
  - ID：`epic-20260525-p0-ai-influence-github-trend-action-analyzer-ultimate`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260525-p0-ai-influence-github-trend-action-analyzer-ultimate.status.json`；`~/.solar/harness/sprints/epic-20260525-p0-ai-influence-github-trend-action-analyzer-ultimate.task_graph.json`

- [x] **P0 | Requirements Slice — AI Influence GitHub Trend & Action Analyzer Ultimate**
  - ID：`sprint-20260525-p0-ai-influence-github-trend-action-analyzer-ultimate-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/scripts/tech-hotspot-radar/decide-strategy.sh`；`harness/scripts/tech-hotspot-radar/lib/chart-action-matrix.sh`；`harness/scripts/tech-hotspot-radar/lib/chart-burst-quadrant.sh`；`harness/scripts/tech-hotspot-radar/lib/chart-pain-heatmap.sh`；`harness/scripts/tech-hotspot-radar/lib/hard-gates.sh`；`harness/scripts/tech-hotspot-radar/lib/license-policy.sh`；`harness/scripts/tech-hotspot-radar/lib/strategy-engine.sh`；`harness/scripts/tech-hotspot-radar/report-github-ultimate.sh`；`harness/scripts/tech-hotspot-radar/tech-hotspot-radar`；`harness/state/tech-hotspot-radar/tech-hotspot-radar.sqlite`
  - 计划代码范围：`harness/scripts/tech-hotspot-radar/analyze-repos.sh`；`harness/scripts/tech-hotspot-radar/compute-velocity.sh`；`harness/scripts/tech-hotspot-radar/config/tracks.yaml`；`harness/scripts/tech-hotspot-radar/decide-strategy.sh`；`harness/scripts/tech-hotspot-radar/fetch-github-ultimate.sh`；`harness/scripts/tech-hotspot-radar/lib/anomaly-detectors.sh`；`harness/scripts/tech-hotspot-radar/lib/api-budget.sh`；`harness/scripts/tech-hotspot-radar/lib/chart-action-matrix.sh`；`harness/scripts/tech-hotspot-radar/lib/chart-burst-quadrant.sh`；`harness/scripts/tech-hotspot-radar/lib/chart-pain-heatmap.sh`；`harness/scripts/tech-hotspot-radar/lib/evidence-extractor.sh`；`harness/scripts/tech-hotspot-radar/lib/hard-gates.sh`；另 10 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-p0-ai-influence-github-trend-action-analyzer-ultimate-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260525-p0-ai-influence-github-trend-action-analyzer-ultimate-s01-requirements.task_graph.json`

- [x] **P0 | Tech Hotspot Radar: Social Browser Backend for X 大咖监控 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s01-requirements`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s01-requirements.task_graph.json`

- [x] **P0 | Tech Hotspot Radar: Social Browser Backend for X 大咖监控 · 架构设计与接口契约**
  - ID：`sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/docs/social-browser-backend-x/A1-control-plane-data-plane-interfaces.md`
  - 计划代码范围：`harness/docs/social-browser-backend-x/A1-control-plane-data-plane-interfaces.md`；`harness/docs/social-browser-backend-x/A2-data-model-schema.md`；`harness/docs/social-browser-backend-x/A3-compat-migration.md`；`harness/docs/social-browser-backend-x/A4-oq-resolutions.md`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s02-architecture.task_graph.json`；`~/.solar/harness/sprints/sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s02-architecture.eval.json`

- [x] **P0 | Tech Hotspot Radar: Social Browser Backend for X 大咖监控 · 核心实现与数据模型**
  - ID：`sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/social_browser_backend_x`；`harness/lib/social_browser_backend_x/__init__.py`；`harness/lib/social_browser_backend_x/backend_selector.py`；`harness/lib/social_browser_backend_x/browser_lease_client.py`；`harness/lib/social_browser_backend_x/cli.py`；`harness/lib/social_browser_backend_x/dedup_keys_table.py`；`harness/lib/social_browser_backend_x/dedup_queue.py`；`harness/lib/social_browser_backend_x/hard_blocker_guard.py`；`harness/lib/social_browser_backend_x/migrations/001_add_browser_backend_columns.sql`；`harness/lib/social_browser_backend_x/mock_browser_fixture.py`；`harness/lib/social_browser_backend_x/operator_lease_manager.py`；`harness/lib/social_browser_backend_x/pipeline.py`；另 10 项
  - 计划代码范围：`harness/lib/social_browser_backend_x/__init__.py`；`harness/lib/social_browser_backend_x/backend_selector.py`；`harness/lib/social_browser_backend_x/browser_lease_client.py`；`harness/lib/social_browser_backend_x/cli.py`；`harness/lib/social_browser_backend_x/dedup_keys_table.py`；`harness/lib/social_browser_backend_x/dedup_queue.py`；`harness/lib/social_browser_backend_x/hard_blocker_guard.py`；`harness/lib/social_browser_backend_x/migrations/001_add_browser_backend_columns.sql`；`harness/lib/social_browser_backend_x/mock_browser_fixture.py`；`harness/lib/social_browser_backend_x/operator_lease_manager.py`；`harness/lib/social_browser_backend_x/pipeline.py`；`harness/lib/social_browser_backend_x/post_extractor.py`；另 6 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s03-core-runtime.task_graph.json`；`~/.solar/harness/sprints/sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s03-core-runtime.eval.json`

- [x] **P0 | Tech Hotspot Radar: Social Browser Backend for X 大咖监控 · 调度、自动化与可视化**
  - ID：`sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s04-orchestration-ui`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/docs/social-browser-backend-x/C1-dashboard-renderer-spec.md`；`harness/docs/social-browser-backend-x/C2-cli-command-tree-spec.md`；`harness/docs/social-browser-backend-x/C3-config-ui-spec.md`；`harness/docs/social-browser-backend-x/C4-autopilot-integration-plan.md`
  - 计划代码范围：`harness/docs/social-browser-backend-x/C1-dashboard-renderer-spec.md`；`harness/docs/social-browser-backend-x/C2-cli-command-tree-spec.md`；`harness/docs/social-browser-backend-x/C3-config-ui-spec.md`；`harness/docs/social-browser-backend-x/C4-autopilot-integration-plan.md`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s04-orchestration-ui.task_graph.json`；`~/.solar/harness/sprints/sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s04-orchestration-ui.eval.json`

- [x] **P0 | Tech Hotspot Radar: Social Browser Backend for X 大咖监控 · 验证、回归与发布证据**
  - ID：`sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s05-verification-release`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/docs/social-browser-backend-x/RELEASE.md`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控-s05-verification-release.eval.json`

- [x] **P0 | Browser Agent ChatGPT Frontdoor Requirement Research**
  - ID：`sprint-20260526-p0-browser-agent-chatgpt-frontdoor-requirement-research`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/browser_job_runtime.py`；`harness/lib/intent_consumer.py`；`harness/lib/intent_gateway.py`；`harness/tests/runtime/test_browser_agent_operator.py`；`harness/tests/test_browser_agent_frontdoor_ingress.py`；`harness/tests/test_intent_consumer.py`；`harness/tests/test_intent_gateway.py`
  - 计划代码范围：`harness/docs`；`harness/lib`；`harness/lib/browser_job_runtime.py`；`harness/lib/chatgpt-conversation-ingest.py`；`harness/lib/intent_consumer.py`；`harness/lib/intent_gateway.py`；`harness/tests`；`harness/tests/runtime`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260526-p0-browser-agent-chatgpt-frontdoor-requirement-research.status.json`；`~/.solar/harness/sprints/sprint-20260526-p0-browser-agent-chatgpt-frontdoor-requirement-research.task_graph.json`

- [x] **P0 | 在 Mac mini 的 Claude Code 环境安装并集成 Lum1104/Understand-Anything · 需求拆解与追踪矩阵**
  - ID：`sprint-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything-s01-requirements`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260526-在-mac-mini-的-claude-code-环境安装并集成-lum1104-understand-anything-s01-requirements.task_graph.json`

- [x] **P0 | Tech Hotspot Radar: YouTube Transcript 高质量抓取与 ASR 分层重构 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构-s01-requirements`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构-s01-requirements.task_graph.json`

- [x] **P0 | Tech Hotspot Radar: YouTube Transcript 高质量抓取与 ASR 分层重构 · 架构设计与接口契约**
  - ID：`sprint-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构-s02-architecture.task_graph.json`

- [x] **P0 | Tech Hotspot Radar: YouTube Transcript 高质量抓取与 ASR 分层重构 · 核心实现与数据模型**
  - ID：`sprint-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构-s03-core-runtime`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/youtube/audio_middleware.py`；`harness/lib/youtube/job_scheduler.py`；`harness/lib/youtube/pollution_repair.py`；`harness/lib/youtube/transcript_storage.py`；`harness/tests/fixtures/pollution_seed.sql`；`harness/tests/test_youtube_audio_middleware.py`；`harness/tests/test_youtube_job_scheduler.py`；`harness/tests/test_youtube_pollution_repair.py`；`harness/tests/test_youtube_transcript_storage.py`
  - 计划代码范围：`harness/lib/tech_hotspot_radar/_youtube_cli_wrapper.py`；`harness/lib/youtube/__init__.py`；`harness/lib/youtube/acquisition_ladder.py`；`harness/lib/youtube/asr_router.py`；`harness/lib/youtube/audio_middleware.py`；`harness/lib/youtube/cli.py`；`harness/lib/youtube/cross_source_extractor.py`；`harness/lib/youtube/dashboard.py`；`harness/lib/youtube/job_scheduler.py`；`harness/lib/youtube/pollution_repair.py`；`harness/lib/youtube/premium_escape.py`；`harness/lib/youtube/priority_queue.py`；另 44 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构-s03-core-runtime.task_graph.json`

- [x] **P0 | Tech Hotspot Radar: YouTube Transcript 高质量抓取与 ASR 分层重构 · 调度、自动化与可视化**
  - ID：`sprint-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构-s04-orchestration-ui`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构-s04-orchestration-ui.task_graph.json`

- [x] **P0 | Tech Hotspot Radar: YouTube Transcript 高质量抓取与 ASR 分层重构 · 验证、回归与发布证据**
  - ID：`sprint-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构-s05-verification-release`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/backups/youtube`；`harness/docs/youtube-transcript/RELEASE.md`；`harness/lib/youtube/cli.py`；`harness/lib/youtube/html_render.py`；`harness/lib/youtube/tui_render.py`；`harness/scripts/tech_hotspot_radar.py`；`harness/tests/test_youtube_cli.py`；`harness/tests/test_youtube_dashboard.py`；`harness/tools/youtube/cli.py`；`harness/tools/youtube/html_render.py`；`harness/tools/youtube/tui_render.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构-s05-verification-release.eval.json`

- [x] **P0 | P0: Solar Harness TUI Pane Recover 与 Clean Pane 生命周期治理 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理-s01-requirements`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理-s01-requirements.task_graph.json`

- [x] **P0 | P0: Solar Harness TUI Pane Recover 与 Clean Pane 生命周期治理**
  - ID：`epic-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/docs/tui-pane-recover/RELEASE.md`；`harness/lib/pane_constants.py`；`harness/lib/pane_hygiene_registry.py`；`harness/lib/test_v2_autopilot_respawn_e2e.py`；`harness/personas`；`harness/reports/tui-pane/s05-acceptance/V1-capture.json`；`harness/reports/tui-pane/s05-acceptance/V1-clear.json`；`harness/reports/tui-pane/s05-acceptance/V1-init.json`；`harness/reports/tui-pane/s05-acceptance/V1-reinject.json`；`harness/reports/tui-pane/s05-acceptance/V1-state.json`；`harness/run/pane-hygiene.json`；`harness/run/pane_hygiene_diff.json`；另 8 项
  - 计划代码范围：`harness/docs/tui-pane-recover/RELEASE.md`；`harness/lib/dispatch_scheduler.py`；`harness/lib/ledger_writer.py`；`harness/lib/pane_clear_manager.py`；`harness/lib/pane_constants.py`；`harness/lib/pane_hygiene_registry.py`；`harness/lib/pane_lifecycle_jobs.py`；`harness/lib/persona_reinjector.py`；`harness/lib/recover_detector.py`；`harness/reports/tui-pane/s03-acceptance/V1-proceed.json`；`harness/reports/tui-pane/s03-acceptance/V2-queued.json`；`harness/reports/tui-pane/s03-acceptance/V3-builder_clear.json`；另 37 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理.status.json`；`~/.solar/harness/sprints/epic-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理.task_graph.json`

- [x] **P0 | P0: Solar Harness TUI Pane Recover 与 Clean Pane 生命周期治理 · 架构设计与接口契约**
  - ID：`sprint-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理-s02-architecture.task_graph.json`

- [x] **P0 | P0: Solar Harness TUI Pane Recover 与 Clean Pane 生命周期治理 · 核心实现与数据模型**
  - ID：`sprint-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理-s03-core-runtime`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/pane_constants.py`；`harness/lib/pane_hygiene_registry.py`；`harness/scripts/init_pane_hygiene.py`；`harness/tests/fixtures/pane_hygiene_seed.json`；`harness/tests/test_init_pane_hygiene.py`；`harness/tests/test_pane_constants.py`；`harness/tests/test_pane_hygiene_registry.py`
  - 计划代码范围：`harness/lib/dispatch_scheduler.py`；`harness/lib/ledger_writer.py`；`harness/lib/pane_clear_manager.py`；`harness/lib/pane_constants.py`；`harness/lib/pane_hygiene_registry.py`；`harness/lib/pane_lifecycle_jobs.py`；`harness/lib/persona_reinjector.py`；`harness/lib/recover_detector.py`；`harness/reports/tui-pane/s03-acceptance/V1-proceed.json`；`harness/reports/tui-pane/s03-acceptance/V2-queued.json`；`harness/reports/tui-pane/s03-acceptance/V3-builder_clear.json`；`harness/reports/tui-pane/s03-acceptance/V4-evaluator_clear.json`；另 22 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理-s03-core-runtime.task_graph.json`

- [x] **P0 | P0: Solar Harness TUI Pane Recover 与 Clean Pane 生命周期治理 · 调度、自动化与可视化**
  - ID：`sprint-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理-s04-orchestration-ui`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理-s04-orchestration-ui.task_graph.json`

- [x] **P0 | P0: Solar Harness TUI Pane Recover 与 Clean Pane 生命周期治理 · 验证、回归与发布证据**
  - ID：`sprint-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理-s05-verification-release`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/docs/tui-pane-recover/RELEASE.md`；`harness/lib/test_v2_autopilot_respawn_e2e.py`；`harness/personas`；`harness/reports/tui-pane/s05-acceptance/V1-capture.json`；`harness/reports/tui-pane/s05-acceptance/V1-clear.json`；`harness/reports/tui-pane/s05-acceptance/V1-init.json`；`harness/reports/tui-pane/s05-acceptance/V1-reinject.json`；`harness/reports/tui-pane/s05-acceptance/V1-state.json`；`harness/run/pane-hygiene.json`；`harness/run/pane_hygiene_diff.json`；`harness/templates/persona`；`harness/templates/runtime_policy.md`；另 1 项
  - 计划代码范围：`harness/docs/tui-pane-recover/RELEASE.md`；`harness/reports/tui-pane/s05-acceptance/V1-capture.json`；`harness/reports/tui-pane/s05-acceptance/V1-clear.json`；`harness/reports/tui-pane/s05-acceptance/V1-init.json`；`harness/reports/tui-pane/s05-acceptance/V1-reinject.json`；`harness/reports/tui-pane/s05-acceptance/V1-state.json`；`harness/reports/tui-pane/s05-acceptance/V2-kill_fail.json`；`harness/reports/tui-pane/s05-acceptance/V2-marker_timeout.json`；`harness/reports/tui-pane/s05-acceptance/V2-split_fail.json`；`harness/reports/tui-pane/s05-acceptance/V2-success.json`；`harness/reports/tui-pane/s05-acceptance/V3-ledger_consistency.json`；`harness/reports/tui-pane/s05-acceptance/V3-p99_latency.json`；另 3 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260527-p0-solar-harness-tui-pane-recover-与-clean-pane-生命周期治理-s05-verification-release.eval.json`

- [x] **P0 | P0: AI Influence HF Paper Insight Flow — Paper-to-Project 研究**
  - ID：`epic-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/hf_paper_insight/__init__.py`；`harness/lib/hf_paper_insight/__init__.py` (0 lines`；`harness/lib/hf_paper_insight/compat.py`；`harness/lib/hf_paper_insight/compat.py` (106 lines`；`harness/lib/hf_paper_insight/packet.py`；`harness/lib/hf_paper_insight/providers/__init__.py`；`harness/lib/hf_paper_insight/providers/arxiv_metadata.py`；`harness/lib/hf_paper_insight/providers/hf_assets.py`；`harness/lib/hf_paper_insight/providers/hf_metadata.py`；`harness/lib/hf_paper_insight/schema.py`；`harness/lib/hf_paper_insight/schema.py` (304 lines`；`harness/lib/hf_paper_insight/scoring.py`；另 8 项
  - 计划代码范围：`docs/hf-paper-insight/RELEASE.md`；`harness/lib/hf_paper_insight/canonicalizer.py`；`harness/lib/hf_paper_insight/collector.py`；`harness/lib/hf_paper_insight/compat.py`；`harness/lib/hf_paper_insight/compiler.py`；`harness/lib/hf_paper_insight/knowledge_store.py`；`harness/lib/hf_paper_insight/packet.py`；`harness/lib/hf_paper_insight/providers`；`harness/lib/hf_paper_insight/reasoning.py`；`harness/lib/hf_paper_insight/schema.py`；`harness/lib/hf_paper_insight/scoring.py`；`harness/lib/hf_paper_insight/state_machine.py`；另 8 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究.status.json`；`~/.solar/harness/sprints/epic-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究.task_graph.json`

- [x] **P0 | P0: AI Influence HF Paper Insight Flow — Paper-to-Project 研究 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究-s01-requirements`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究-s01-requirements.task_graph.json`

- [x] **P0 | P0: AI Influence HF Paper Insight Flow — Paper-to-Project 研究 · 架构设计与接口契约**
  - ID：`sprint-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究-s02-architecture.task_graph.json`

- [x] **P0 | P0: AI Influence HF Paper Insight Flow — Paper-to-Project 研究 · 核心实现与数据模型**
  - ID：`sprint-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/hf_paper_insight/__init__.py`；`harness/lib/hf_paper_insight/__init__.py` (0 lines`；`harness/lib/hf_paper_insight/compat.py`；`harness/lib/hf_paper_insight/compat.py` (106 lines`；`harness/lib/hf_paper_insight/packet.py`；`harness/lib/hf_paper_insight/providers/__init__.py`；`harness/lib/hf_paper_insight/providers/arxiv_metadata.py`；`harness/lib/hf_paper_insight/providers/hf_assets.py`；`harness/lib/hf_paper_insight/providers/hf_metadata.py`；`harness/lib/hf_paper_insight/schema.py`；`harness/lib/hf_paper_insight/schema.py` (304 lines`；`harness/lib/hf_paper_insight/scoring.py`；另 8 项
  - 计划代码范围：`harness/lib/hf_paper_insight/canonicalizer.py`；`harness/lib/hf_paper_insight/collector.py`；`harness/lib/hf_paper_insight/compat.py`；`harness/lib/hf_paper_insight/compiler.py`；`harness/lib/hf_paper_insight/knowledge_store.py`；`harness/lib/hf_paper_insight/packet.py`；`harness/lib/hf_paper_insight/providers`；`harness/lib/hf_paper_insight/reasoning.py`；`harness/lib/hf_paper_insight/schema.py`；`harness/lib/hf_paper_insight/scoring.py`；`harness/lib/hf_paper_insight/state_machine.py`；`harness/lib/hf_paper_insight/storage.py`；另 7 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究-s03-core-runtime.task_graph.json`

- [x] **P0 | P0: AI Influence HF Paper Insight Flow — Paper-to-Project 研究 · 调度、自动化与可视化**
  - ID：`sprint-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究-s04-orchestration-ui`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究-s04-orchestration-ui.task_graph.json`

- [x] **P0 | P0: AI Influence HF Paper Insight Flow — Paper-to-Project 研究 · 验证、回归与发布证据**
  - ID：`sprint-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究-s05-verification-release`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`docs/hf-paper-insight/RELEASE.md`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260527-p0-ai-influence-hf-paper-insight-flow-paper-to-project-研究-s05-verification-release.eval.json`

- [x] **P0 | P0: AI Influence YouTube 报告流默认流程固化与验收**
  - ID：`epic-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/docs/ai-influence-youtube-report`；`harness/docs/ai-influence-youtube-report/A1-layering-failure-recovery.md`；`harness/docs/ai-influence-youtube-report/A3-data-model.md`；`harness/docs/ai-influence-youtube-report/N1-transcript-gate-classification.md`；`harness/docs/ai-influence-youtube-report/N2-high-model-chatgpt-plan-writing.md`；`harness/docs/ai-influence-youtube-report/N3-output-validator-archive-fixture.md`
  - 计划代码范围：`harness/docs/ai-influence-youtube-report/A1-layering-failure-recovery.md`；`harness/docs/ai-influence-youtube-report/A2-interfaces.md`；`harness/docs/ai-influence-youtube-report/A3-data-model.md`；`harness/docs/ai-influence-youtube-report/A4-compat-migration.md`；`harness/docs/ai-influence-youtube-report/N1-transcript-gate-classification.md`；`harness/docs/ai-influence-youtube-report/N2-high-model-chatgpt-plan-writing.md`；`harness/docs/ai-influence-youtube-report/N3-output-validator-archive-fixture.md`；`harness/lib/accepted-artifact-export.py`；`harness/lib/ai_influence_youtube_report/__init__.py`；`harness/lib/ai_influence_youtube_report/archive.py`；`harness/lib/ai_influence_youtube_report/archive_controls.py`；`harness/lib/ai_influence_youtube_report/automation_policy.py`；另 41 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收.status.json`；`~/.solar/harness/sprints/epic-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收.task_graph.json`

- [x] **P0 | P0: AI Influence YouTube 报告流默认流程固化与验收 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s01-requirements`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/docs/ai-influence-youtube-report`；`harness/docs/ai-influence-youtube-report/N1-transcript-gate-classification.md`；`harness/docs/ai-influence-youtube-report/N2-high-model-chatgpt-plan-writing.md`；`harness/docs/ai-influence-youtube-report/N3-output-validator-archive-fixture.md`
  - 计划代码范围：`harness/docs/ai-influence-youtube-report/N1-transcript-gate-classification.md`；`harness/docs/ai-influence-youtube-report/N2-high-model-chatgpt-plan-writing.md`；`harness/docs/ai-influence-youtube-report/N3-output-validator-archive-fixture.md`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s01-requirements.task_graph.json`；`~/.solar/harness/sprints/sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s01-requirements.eval.json`

- [x] **P0 | P0: AI Influence YouTube 报告流默认流程固化与验收 · 架构设计与接口契约**
  - ID：`sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/docs/ai-influence-youtube-report/A1-layering-failure-recovery.md`；`harness/docs/ai-influence-youtube-report/A3-data-model.md`
  - 计划代码范围：`harness/docs/ai-influence-youtube-report/A1-layering-failure-recovery.md`；`harness/docs/ai-influence-youtube-report/A2-interfaces.md`；`harness/docs/ai-influence-youtube-report/A3-data-model.md`；`harness/docs/ai-influence-youtube-report/A4-compat-migration.md`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s02-architecture.task_graph.json`；`~/.solar/harness/sprints/sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s02-architecture.eval.json`

- [x] **P0 | P0: AI Influence YouTube 报告流默认流程固化与验收 · 核心实现与数据模型**
  - ID：`sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/ai_influence_youtube_report/__init__.py`；`harness/lib/ai_influence_youtube_report/archive.py`；`harness/lib/ai_influence_youtube_report/browser_agent.py`；`harness/lib/ai_influence_youtube_report/classifier.py`；`harness/lib/ai_influence_youtube_report/compat.py`；`harness/lib/ai_influence_youtube_report/evidence_map.py`；`harness/lib/ai_influence_youtube_report/gate.py`；`harness/lib/ai_influence_youtube_report/hierarchy.py`；`harness/lib/ai_influence_youtube_report/ledger.py`；`harness/lib/ai_influence_youtube_report/prompts.py`；`harness/lib/ai_influence_youtube_report/render.py`；`harness/lib/ai_influence_youtube_report/schema.py`；另 17 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s03-core-runtime.task_graph.json`

- [x] **P0 | P0: AI Influence YouTube 报告流默认流程固化与验收 · 调度、自动化与可视化**
  - ID：`sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s04-orchestration-ui`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/accepted-artifact-export.py`；`harness/lib/ai_influence_youtube_report/archive_controls.py`；`harness/lib/ai_influence_youtube_report/automation_policy.py`；`harness/lib/ai_influence_youtube_report/epic_projection.py`；`harness/lib/ai_influence_youtube_report/orchestration.py`；`harness/lib/ai_influence_youtube_report/pane_surface.py`；`harness/lib/ai_influence_youtube_report/status_surface.py`；`harness/scripts/tech_hotspot_radar.py`；`harness/status-server/research_routes.py`；`harness/tests/test_ai_influence_youtube_report_archive_controls.py`；`harness/tests/test_ai_influence_youtube_report_automation_policy.py`；`harness/tests/test_ai_influence_youtube_report_dashboard_payload.py`；另 6 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s04-orchestration-ui.task_graph.json`

- [x] **P0 | P0: AI Influence YouTube 报告流默认流程固化与验收 · 验证、回归与发布证据**
  - ID：`sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s05-verification-release`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260528-p0-ai-influence-youtube-报告流默认流程固化与验收-s05-verification-release.eval.json`

- [x] **P0 | 跑通 Gemini Deep Research.我的具体要求是:1)从用户那里或者上游调用\上游算子那里获取问题输入,2 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2-s01-requirements.task_graph.json`

- [x] **P0 | 跑通 Gemini Deep Research.我的具体要求是:1)从用户那里或者上游调用\上游算子那里获取问题输入,2 · 架构设计与接口契约**
  - ID：`sprint-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2-s02-architecture.task_graph.json`

- [x] **P0 | 跑通 Gemini Deep Research.我的具体要求是:1)从用户那里或者上游调用\上游算子那里获取问题输入,2 · 核心实现与数据模型**
  - ID：`sprint-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/capabilities/gemini_deep_research/compat`；`harness/lib/capabilities/gemini_deep_research/core`；`harness/lib/capabilities/gemini_deep_research/schemas`；`harness/lib/capabilities/gemini_deep_research/tests`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2-s03-core-runtime.task_graph.json`

- [x] **P0 | 跑通 Gemini Deep Research.我的具体要求是:1)从用户那里或者上游调用\上游算子那里获取问题输入,2 · 调度、自动化与可视化**
  - ID：`sprint-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2-s04-orchestration-ui`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2-s04-orchestration-ui.task_graph.json`

- [x] **P0 | 跑通 Gemini Deep Research.我的具体要求是:1)从用户那里或者上游调用\上游算子那里获取问题输入,2 · 验证、回归与发布证据**
  - ID：`sprint-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2-s05-verification-release`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/tests/gemini_deep_research/control`；`harness/tests/gemini_deep_research/e2e`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2-s05-verification-release.eval.json`

- [x] **P0 | 请按照 PRD 开发 AI Influence GitHub 趋势情报系统: # PRD: AI Influence G · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g-s01-requirements.task_graph.json`

- [x] **P0 | 请按照 PRD 开发 AI Influence GitHub 趋势情报系统: # PRD: AI Influence G · 架构设计与接口契约**
  - ID：`sprint-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g-s02-architecture.task_graph.json`

- [x] **P0 | 请按照 PRD 开发 AI Influence GitHub 趋势情报系统: # PRD: AI Influence G · 核心实现与数据模型**
  - ID：`sprint-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/github_intelligence/cards.py`；`harness/lib/github_intelligence/detectors.py`；`harness/lib/github_intelligence/evidence.py`；`harness/lib/github_intelligence/model_ledger.py`；`harness/lib/github_intelligence/scoring.py`；`harness/lib/github_intelligence/snapshots.py`；`harness/tests/test_github_intelligence.py`
  - 计划代码范围：`harness/lib/github_intelligence/cards.py`；`harness/lib/github_intelligence/detectors.py`；`harness/lib/github_intelligence/evidence.py`；`harness/lib/github_intelligence/model_ledger.py`；`harness/lib/github_intelligence/schema.py`；`harness/lib/github_intelligence/scoring.py`；`harness/lib/github_intelligence/snapshots.py`；`harness/tests/test_github_intelligence.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g-s03-core-runtime.task_graph.json`

- [x] **P0 | 请按照 PRD 开发 AI Influence GitHub 趋势情报系统: # PRD: AI Influence G · 调度、自动化与可视化**
  - ID：`sprint-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g-s04-orchestration-ui`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/graph_scheduler.make_batches`；`harness/lib/graph_scheduler.validate_graph`；`harness/lib/symphony/status-server.py`；`harness/tests/orchestration/test_orchestration_routes.py`；`harness/tests/test_evidence_collector.py`；`harness/tests/test_evidence_collector.py` (new`；`harness/tools/autopilot`；`harness/tools/autopilot/__init__.py`；`harness/tools/autopilot/event_recorder.py`；`harness/tools/autopilot`) to satisfy architecture guard`；`harness/tools/evidence_collector/__init__.py`；`harness/tools/evidence_collector/__init__.py` (new`；另 8 项
  - 计划代码范围：`harness/tools/autopilot`；`harness/tools/evidence_collector`；`harness/tools/graph_scheduler`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g-s04-orchestration-ui.task_graph.json`

- [x] **P0 | 请按照 PRD 开发 AI Influence GitHub 趋势情报系统: # PRD: AI Influence G · 验证、回归与发布证据**
  - ID：`sprint-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g-s05-verification-release`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/tests/test_ai_influence_github_activation_proof.py`；`harness/tests/test_ai_influence_github_activation_proof.py`（`~/Solar/harness` 树）：**新建** 4-test activation-proof 套件。每个测试以真实子进程/真实 import 驱动真实入口（`run_pipeline`、`pipeline.py` `__main__` smoke、`tech_hotspot_radar.py init/github-fixture/status`），断言落盘 SQLite artifact 存在且行数非空；每个子进程出口用 `_classify_environment_blocker()` 扫描 stdout+stderr，命中网络/DNS 即 `pytest.skip` 分类为环境 blocker。目的：让真实 runtime 调用回归在此处失败。`；`harness/tests/test_ai_influence_github_negative_controls.py`；`harness/tests/test_ai_influence_github_verification_release.py`；`harness/tests/test_ai_influence_github_verification_release.py`（`~/Solar/harness` 树）：**重写**为 25-test 矩阵。逐区域调用真实入口：`snapshots.take_snapshot`/`compute_deltas`、`detectors.detect_*`/`compute_heat_score`、`evidence.build_reasoning_packet`、`schema.AnalysisCard.validate_evidence_floor`/`Detection`。目的：让任一区域生产代码回归在此处失败。`
  - 计划代码范围：`harness/tests/test_ai_influence_github_activation_proof.py`；`harness/tests/test_ai_influence_github_negative_controls.py`；`harness/tests/test_ai_influence_github_verification_release.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-请按照-prd-开发-ai-influence-github-趋势情报系统-prd-ai-influence-g-s05-verification-release.task_graph.json`

- [x] **P0 | P0: 将 5 条 AI Influence 算子固化为 solar-harness 默认接入，并将其余实现降级为 fa · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa-s01-requirements.task_graph.json`

- [x] **P0 | P0: 将 5 条 AI Influence 算子固化为 solar-harness 默认接入，并将其余实现降级为 fa · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa-s02-architecture.task_graph.json`

- [x] **P0 | P0: 将 5 条 AI Influence 算子固化为 solar-harness 默认接入，并将其余实现降级为 fa · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/config/operator_registry.json`；`harness/lib/metadata_validator.py`；`harness/lib/operator_registry_loader.py`；`harness/lib/operator_router.py`；`harness/lib/operator_router.py` (NEW`；`harness/lib/operator_state_machine.py`；`harness/lib/unified_output_adapter.py`；`harness/scripts/tech_hotspot_radar.py --help`；`harness/tests/test_compat_integration.py`；`harness/tests/test_compat_integration.py` (新增, 12304B`；`harness/tests/test_operator_registry.py`；`harness/tests/test_operator_router.py`；另 3 项
  - 计划代码范围：`harness/config/operator_registry.json`；`harness/lib/metadata_validator.py`；`harness/lib/operator_registry_loader.py`；`harness/lib/operator_router.py`；`harness/lib/operator_state_machine.py`；`harness/lib/unified_output_adapter.py`；`harness/tests/test_compat_integration.py`；`harness/tests/test_operator_registry.py`；`harness/tests/test_operator_router.py`；`harness/tests/test_operator_state_machine.py`；`harness/tests/test_unified_output.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa-s03-core-runtime.task_graph.json`

- [x] **P0 | P0: 将 5 条 AI Influence 算子固化为 solar-harness 默认接入，并将其余实现降级为 fa · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa-s04-orchestration-ui`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/config/operator_schedules.json`；`harness/lib/ai_influence_status_page.py`；`harness/lib/autopilot_operator_dispatcher.py`；`harness/lib/evidence_collector.py`；`harness/lib/metadata_validator.py`；`harness/lib/operator_schedule_binder.py`；`harness/lib/unified_output_adapter.py`；`harness/templates/ai_influence.html`；`harness/tests/test_autopilot_dispatcher.py`；`harness/tests/test_evidence_collector.py`；`harness/tests/test_schedule_binder.py`；`harness/tests/test_status_page.py`；另 1 项
  - 计划代码范围：`harness/config/operator_schedules.json`；`harness/lib/ai_influence_status_page.py`；`harness/lib/autopilot_operator_dispatcher.py`；`harness/lib/evidence_collector.py`；`harness/lib/github_comparison_view.py`；`harness/lib/operator_schedule_binder.py`；`harness/templates/ai_influence.html`；`harness/tests/test_autopilot_dispatcher.py`；`harness/tests/test_comparison_view.py`；`harness/tests/test_evidence_collector.py`；`harness/tests/test_orchestration_compat.py`；`harness/tests/test_schedule_binder.py`；另 1 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa-s04-orchestration-ui.task_graph.json`

- [x] **P0 | P0: 将 5 条 AI Influence 算子固化为 solar-harness 默认接入，并将其余实现降级为 fa · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa-s05-verification-release`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/config/operator_registry.json`；`harness/lib/operator_registry_loader.py`；`harness/scripts/browser_agent_gemini_deep_research_wrapper.py`；`harness/scripts/browser_agent_youtube_transcript_wrapper.py`；`harness/tests/verification/fallback_routing/__init__.py`；`harness/tests/verification/fallback_routing/test_v2_fallback_routing.py`；`harness/tools/playwright_twitter_scraper.py`
  - 计划代码范围：`harness/tests/verification/activation_proof`；`harness/tests/verification/ai_influence_ui`；`harness/tests/verification/fallback_routing`；`harness/tests/verification/github_compare`；`harness/tests/verification/negative_control`；`harness/tests/verification/primary_entries`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa-s05-verification-release.eval.json`

- [x] **P0 | P0 修复单：ActorHost taxonomy 与 actor-first runtime 落地补齐 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐-s01-requirements`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：ActorHost taxonomy 与 actor-first runtime 落地补齐 · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐-s02-architecture.task_graph.json`

- [x] **P0 | P0 修复单：ActorHost taxonomy 与 actor-first runtime 落地补齐 · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐-s03-core-runtime`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`docs/migration-physical-operators-to-actor-hosts.md`；`harness/config/actor-hosts.json`；`harness/config/actor-hosts.schema.json`；`harness/config/physical-operators.json`；`harness/config/physical-operators.schema.json`；`harness/tests/runtime/test_compat_mapping.py`；`harness/tests/runtime/test_host_taxonomy.py`
  - 计划代码范围：`docs/migration-physical-operators-to-actor-hosts.md`；`harness/config/actor-hosts.json`；`harness/config/actor-hosts.schema.json`；`harness/config/physical-operators.json`；`harness/config/physical-operators.schema.json`；`harness/tests/runtime/test_compat_mapping.py`；`harness/tests/runtime/test_host_taxonomy.py`
  - 提交证据：`d58564c7`
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐-s03-core-runtime.task_graph.json`

- [x] **P0 | P0 修复单：ActorHost taxonomy 与 actor-first runtime 落地补齐 · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐-s04-orchestration-ui`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/multi_task_status.py`；`harness/tests/test_s04_activation_graph_route.py`；`harness/tests/test_s04_actorhost_status_bridge.py`；`harness/tests/test_s04_orchestration_acceptance.py`；`harness/tests/test_s04_orchestration_routes.py`；`harness/tests/test_s04_orchestration_ui_smoke.py`；`harness/tools/autopilot.py`；`harness/ui/orchestration/index.html`；`harness/ui/orchestration/main.js`；`harness/ui/orchestration/styles.css`
  - 提交证据：`aeeab159`
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐-s04-orchestration-ui.task_graph.json`

- [x] **P0 | P0 修复单：ActorHost taxonomy 与 actor-first runtime 落地补齐 · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐-s05-verification-release`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/tests/s05-collected-artifacts.json`；`harness/tests/s05-e2e-results.json`；`harness/tests/s05-e2e-runtime.sh`；`harness/tests/s05-negative-control.sh`；`harness/tests/s05-negctl-results.json`；`harness/tests/s05-schema-results.json`；`harness/tests/s05-schema-validation.sh`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐-s05-verification-release.eval.json`

- [x] **P0 | P0 修复单：去除 tmux send-keys 作为主任务协议，收口到 operatord mailbox runti · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：去除 tmux send-keys 作为主任务协议，收口到 operatord mailbox runti · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/config/task-envelope.schema.json`；`harness/docs/mailbox-migration-runbook.md`；`harness/docs/mailbox-protocol.md`；`harness/docs/operatord-runtime.md`；`harness/lib/pane_mailbox/__init__.py`；`harness/lib/pane_mailbox/api.pyi`
  - 计划代码范围：`harness/config/task-envelope.schema.json`；`harness/docs/DISPATCH-PROTOCOL.md`；`harness/docs/mailbox-migration-runbook.md`；`harness/docs/mailbox-protocol.md`；`harness/docs/operatord-runtime.md`；`harness/lib/pane_mailbox/__init__.py`；`harness/lib/pane_mailbox/api.pyi`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s02-architecture.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s02-architecture.eval.json`

- [x] **P0 | P0 修复单：去除 tmux send-keys 作为主任务协议，收口到 operatord mailbox runti · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s04-orchestration-ui`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/graph_node_dispatcher.py`；`harness/tools/autopilot.py`；`harness/tools/dispatch_scheduler.py`；`harness/tools/evidence_ledger.py`；`harness/tools/pane_handoff/evidence_validator.py`；`harness/tools/smoke/orchestration_mailbox_evidence_smoke.py`
  - 计划代码范围：`harness/lib/graph_node_dispatcher.py`；`harness/lib/pane_handoff/evidence_validator.py`；`harness/tools/autopilot.py`；`harness/tools/dispatch_scheduler.py`；`harness/tools/evidence_ledger.py`；`harness/tools/orchestration_mailbox_projection.py`；`harness/tools/pane_handoff/evidence_validator.py`；`harness/tools/refresh/sources/dashboards.py`；`harness/tools/smoke/orchestration_mailbox_evidence_smoke.py`；`harness/tools/symphony/status-server.py`；`harness/ui/orchestration/index.html`；`harness/ui/orchestration/main.js`；另 1 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s04-orchestration-ui.task_graph.json`

- [x] **P0 | P0 修复单：从 pane lease 升级到 actor lease，并补齐生命周期状态机 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：从 pane lease 升级到 actor lease，并补齐生命周期状态机 · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机-s02-architecture.task_graph.json`

- [x] **P0 | P0 修复单：从 pane lease 升级到 actor lease，并补齐生命周期状态机 · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/config/agent-actors.schema.json`；`harness/config/physical-operators.schema.json`；`harness/lib/actor_lease.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/multi_task_status.py`；`harness/lib/operator_runtime.py`；`harness/lib/pane_lease.py`；`harness/lib/runtime_status.py`；`harness/tests/graph/test_graph_dispatch_lease_busy.py`；`harness/tests/runtime/test_actor_lease.py`；`harness/tests/runtime/test_actor_lifecycle_acceptance.py`；`harness/tests/runtime/test_operator_runtime.py`；另 9 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机-s03-core-runtime.task_graph.json`

- [x] **P0 | P0 修复单：从 pane lease 升级到 actor lease，并补齐生命周期状态机 · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机-s04-orchestration-ui`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/tests/livework/test_integration_s04.py`；`harness/tests/orchestration/test_autopilot_capability_routing.py`；`harness/tests/orchestration/test_orchestration_routes.py`；`harness/tests/runtime/test_actor_lease.py`；`harness/tests/test_actor_observability.py`；`harness/tests/test_operator_status_observability.py`
  - 计划代码范围：`harness/tests/livework/test_integration_s04.py`；`harness/tests/orchestration/test_autopilot_capability_routing.py`；`harness/tests/orchestration/test_orchestration_routes.py`；`harness/tests/runtime/test_actor_lease.py`；`harness/tests/test_actor_observability.py`；`harness/tests/test_graph_dispatcher_actor_lease.py`；`harness/tests/test_operator_status_observability.py`；`harness/tools/graph_node_dispatcher.py`；`harness/tools/monitor_bridge.py`；`harness/tools/multi_task_status.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机-s04-orchestration-ui.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-从-pane-lease-升级到-actor-lease-并补齐生命周期状态机-s04-orchestration-ui.eval.json`

- [x] **P0 | P0 修复单：把 capability/risk/cost 三张画像从配置层升级为 runtime 强约束 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：把 capability/risk/cost 三张画像从配置层升级为 runtime 强约束 · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-risk-cost-三张画像从配置层升级为-runtime-强约束-s02-architecture.task_graph.json`

- [x] **P0 | 需求单：APO v2 Lease / Quota / Cost-Aware Agent Plan Optimizer · 验证、回归与发布证据**
  - ID：`sprint-20260530-需求单-apo-v2-lease-quota-cost-aware-agent-plan-optimizer-s05-verification-release`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/_raw/apo-v2-s05-verification-release.md`；`harness/tests/runtime/test_operator_runtime.py`；`harness/tests/test_apo_cost_model.py`；`harness/tests/test_apo_enforcer_rules.py`；`harness/tests/test_apo_explain.py`；`harness/tests/test_apo_feedback.py`；`harness/tests/test_apo_plan_compiler.py`；`harness/tests/test_pm_dispatch.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-需求单-apo-v2-lease-quota-cost-aware-agent-plan-optimizer-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-需求单-apo-v2-lease-quota-cost-aware-agent-plan-optimizer-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-需求单-apo-v2-lease-quota-cost-aware-agent-plan-optimizer-s05-verification-release.eval.json`

- [x] **P0 | P0 修复单：把 OperatorScore 从公式/测试层升级为 runtime 主评分与本地任务证据闭环 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：把 OperatorScore 从公式/测试层升级为 runtime 主评分与本地任务证据闭环 · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-operatorscore-从公式-测试层升级为-runtime-主评分与本地任务证据闭环-s02-architecture.task_graph.json`

- [x] **P0 | P0 修复单：把验证做成 DAG 强制结构，不允许 writer 自证完成 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：把验证做成 DAG 强制结构，不允许 writer 自证完成 · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成-s02-architecture.task_graph.json`

- [x] **P0 | P0 修复单：把验证做成 DAG 强制结构，不允许 writer 自证完成 · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/actor_runtime.py`；`harness/tests/runtime/test_actor_runtime_gate.py`
  - 计划代码范围：`harness/lib/actor_runtime.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/verification_gate.py`；`harness/schemas/review_decision.schema.json`；`harness/tests/runtime/test_actor_runtime_gate.py`；`harness/tests/runtime/test_graph_completion_gate.py`；`harness/tests/runtime/test_verification_gate.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成-s03-core-runtime.task_graph.json`

- [x] **P0 | P0 修复单：把 Evidence Ledger 从 JSONL 索引升级为可审计的完整 runs 证据链 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：把 Evidence Ledger 从 JSONL 索引升级为可审计的完整 runs 证据链 · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/state/dispatch/pm-sprint-...-A5_architecture_handoff-778f2bbf.json`
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链-s02-architecture.task_graph.json`

- [x] **P0 | P0 修复单：把 Evidence Ledger 从 JSONL 索引升级为可审计的完整 runs 证据链 · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/evidence_ledger.py`；`harness/lib/evidence_ledger.py` **[VERIFIED, NOT MODIFIED`；`harness/schemas/evidence-run.schema.json`；`harness/schemas/evidence-run.schema.json` **[NEW`；`harness/schemas/scheduler-decision.schema.json`；`harness/schemas/scheduler-decision.schema.json` **[NEW`；`harness/tests/runtime/test_actor_runtime.py`；`harness/tests/test_evidence_ledger.py`
  - 计划代码范围：`harness/lib/actor_runtime.py`；`harness/lib/evidence_ledger.py`；`harness/schemas/evidence-run.schema.json`；`harness/schemas/scheduler-decision.schema.json`；`harness/tests/runtime/test_actor_runtime.py`；`harness/tests/test_evidence_ledger.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链-s03-core-runtime.task_graph.json`

- [x] **P0 | P0 修复单：把上下文主权收口到 Context Store，压缩长寿 pane 记忆污染路径 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s01-requirements`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：把上下文主权收口到 Context Store，压缩长寿 pane 记忆污染路径 · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s02-architecture.task_graph.json`

- [x] **P0 | P0 修复单：把 capability token 从 helper/schema 提升为 runtime 权限执行边界 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：把 capability token 从 helper/schema 提升为 runtime 权限执行边界 · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s02-architecture.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s02-architecture.eval.json`

- [x] **P0 | P0 修复单：把 capability token 从 helper/schema 提升为 runtime 权限执行边界 · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/actor_runtime.py`；`harness/lib/browser_job_runtime.py`；`harness/lib/capability_token.py`；`harness/tests/runtime/test_browser_security_policies.py`；`harness/tests/runtime/test_browser_security_policies.py`（session broker + scrubbing + payment/secrets/destructive 默认拦截 + U7 PolicyDecision 等价用例 7 条，共 18 测试）`；`harness/tests/test_actor_runtime_capability.py`；`harness/tests/test_actor_runtime_capability.py`（U8a–h：out_of_scope、shell deny_by_default、allowed、混合 first-allow second-deny、enforcement_off bypass、no-policy-requests、expired token、no-token-legacy，共 8 测试）`；`harness/tests/test_capability_token_runtime.py`；`harness/tests/test_capability_token_runtime.py`（U1 v1 兼容 + U2 check_file + U3 check_shell + U4 check_network + U5 check_git + check_secrets + audit_view redaction + validate_for_lease revoked，共 42 测试）`；`harness/tests/test_capability_token_schema.py`；`harness/tests/test_capability_token_schema.py`（schema 结构 + failure_fingerprint labels + v1/v2 字段断言 + U6 v1 token jsonschema 通过 + from_dict round-trip，共 50 测试）`；`harness/tests/test_operatord_capability_pre_dispatch.py`；另 3 项
  - 计划代码范围：`harness/config/capability-token.schema.json`；`harness/lib/actor_runtime.py`；`harness/lib/browser_job_runtime.py`；`harness/lib/capability_token.py`；`harness/lib/event_ledger.py`；`harness/schemas/capability-decision.schema.json`；`harness/tests/runtime/test_browser_security_policies.py`；`harness/tests/test_actor_runtime_capability.py`；`harness/tests/test_capability_token_runtime.py`；`harness/tests/test_capability_token_schema.py`；`harness/tests/test_operatord_capability_pre_dispatch.py`；`harness/tools/capability_token.py`；另 1 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s03-core-runtime.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s03-core-runtime.eval.json`

- [x] **P0 | P0 修复单：把 capability token 从 helper/schema 提升为 runtime 权限执行边界 · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s04-orchestration-ui`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/tests/orchestration/test_capability_endpoints.py`；`harness/tests/orchestration/test_capability_panel_dom.py`；`harness/tests/tools/__init__.py`；`harness/tests/tools/test_pane_evidence_capability.py`；`harness/tools/antigravity_pane_evidence.py`
  - 计划代码范围：`harness/lib/capability_observability.py`；`harness/tests/observability/test_capability_observability.py`；`harness/tests/orchestration/test_capability_endpoints.py`；`harness/tests/orchestration/test_capability_panel_dom.py`；`harness/tests/tools/test_autopilot_capability_fault.py`；`harness/tests/tools/test_dispatch_capability_attach.py`；`harness/tests/tools/test_pane_evidence_capability.py`；`harness/tools/activation_proof_vnext.py`；`harness/tools/antigravity_pane_evidence.py`；`harness/tools/autopilot.py`；`harness/tools/graph_node_dispatcher.py`；`harness/tools/run_s04_redaction_audit.sh`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s04-orchestration-ui.task_graph.json`

- [x] **P0 | P0 修复单：把 Antigravity 收口到 fan-out / exploration 位，禁止进入最终裁决位 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s01-requirements.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s01-requirements.eval.json`

- [x] **P0 | P0 修复单：把 Antigravity 收口到 fan-out / exploration 位，禁止进入最终裁决位 · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/config/logical-operators.json`；`harness/lib/actor_runtime.py`；`harness/lib/antigravity_placement_policy.py`；`harness/lib/evidence_ledger.py`；`harness/lib/failure_fingerprint.py`；`harness/lib/logical_operator_registry.py`；`harness/lib/logical_operator_router.py`；`harness/lib/multi_task_status.py`；`harness/lib/operator_runtime.py`；`harness/lib/operator_score.py`；`harness/lib/symphony/status-server.py`；`harness/tests/test_actor_observability.py`；另 3 项
  - 计划代码范围：`harness/config/logical-operators.json`；`harness/lib/actor_runtime.py`；`harness/lib/antigravity_placement_policy.py`；`harness/lib/evidence_ledger.py`；`harness/lib/failure_fingerprint.py`；`harness/lib/logical_operator_registry.py`；`harness/lib/logical_operator_router.py`；`harness/lib/operator_runtime.py`；`harness/lib/operator_score.py`；`harness/lib/symphony/status-server.py`；`harness/tests/test_actor_observability.py`；`harness/tests/test_actor_runtime_capability.py`；另 2 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s02-architecture.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s02-architecture.eval.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-antigravity-收口到-fan-out-exploration-位-禁止进入最终裁决位-s02-architecture.handoff.md`

- [x] **P0 | P0 修复单：把 failure fingerprint 从 task-type penalty 升级为按 operat · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：把 failure fingerprint 从 task-type penalty 升级为按 operat · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s02-architecture.task_graph.json`

- [x] **P0 | P0 修复单：把 failure fingerprint 从 task-type penalty 升级为按 operat · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s04-orchestration-ui`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/tests/test_failure_fingerprint_orchestration_ui.py`；`harness/tests/test_failure_fingerprint_status_observability.py`；`harness/tests/test_s04_orchestration_routes.py`；`harness/tools/multi_task_status.py`；`harness/ui/orchestration/index.html`；`harness/ui/orchestration/main.js`；`harness/ui/orchestration/styles.css`
  - 计划代码范围：`harness/status-server/routes/orchestration_routes.py`；`harness/status-server/static/orchestration_panel.css`；`harness/status-server/static/orchestration_panel.js`；`harness/status-server/templates/orchestration_panel.html`；`harness/tests/test_failure_fingerprint_orchestration_ui.py`；`harness/tests/test_failure_fingerprint_status_observability.py`；`harness/tests/test_s04_orchestration_acceptance.py`；`harness/tests/test_s04_orchestration_routes.py`；`harness/tools/multi_task_status.py`；`harness/ui/orchestration/index.html`；`harness/ui/orchestration/main.js`；`harness/ui/orchestration/styles.css`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-failure-fingerprint-从-task-type-penalty-升级为按-operat-s04-orchestration-ui.task_graph.json`

- [x] **P0 | P0 修复单：把推荐最终架构图收口为 solar-harness 默认主执行脊柱 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：把推荐最终架构图收口为 solar-harness 默认主执行脊柱 · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s02-architecture.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s02-architecture.handoff.md`

- [x] **P0 | P0 修复单：把推荐最终架构图收口为 solar-harness 默认主执行脊柱 · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/actor_dispatch_bridge.py`；`harness/lib/actor_runtime.py`；`harness/lib/evidence_ledger.py`；`harness/lib/graph_node_dispatcher.py`；`harness/tests/test_actor_dispatch_bridge.py`；`harness/tests/test_actor_runtime_contract.py`；`harness/tools/operatord.py`
  - 计划代码范围：`harness/lib/actor_dispatch_bridge.py`；`harness/lib/actor_runtime.py`；`harness/lib/evidence_ledger.py`；`harness/lib/graph_node_dispatcher.py`；`harness/tests/test_actor_dispatch_bridge.py`；`harness/tests/test_actor_runtime_contract.py`；`harness/tools/operatord.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s03-core-runtime.task_graph.json`

- [x] **P0 | P0 修复单：把推荐最终架构图收口为 solar-harness 默认主执行脊柱 · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s04-orchestration-ui`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/config/agent-actors.json`；`harness/config/agent-hosts.json`；`harness/tests/orchestration/test_epic_status_view.py`；`harness/tests/orchestration/test_orchestration_routes.py`；`harness/ui/orchestration/index.html`；`harness/ui/orchestration/main.js`；`harness/ui/orchestration/styles.css`
  - 计划代码范围：`harness/tests/control_plane/test-autopilot-pane-gate-reconcile.py`；`harness/tests/control_plane/test-s04-runtime-fallback-negative.sh`；`harness/tests/orchestration/test_autopilot_capability_routing.py`；`harness/tests/orchestration/test_epic_status_view.py`；`harness/tests/orchestration/test_orchestration_routes.py`；`harness/tests/orchestration/test_s04_runtime_surface.py`；`harness/tests/test-status-server-assets.py`；`harness/tools/autopilot.py`；`harness/tools/graph_node_dispatcher.py`；`harness/ui/orchestration/index.html`；`harness/ui/orchestration/main.js`；`harness/ui/orchestration/styles.css`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s04-orchestration-ui.task_graph.json`

- [x] **P0 | P0 修复单：把 Agent Plan Optimizer 从静态映射升级为 skills/MCP/capsules/p · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-把-agent-plan-optimizer-从静态映射升级为-skills-mcp-capsules-p-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/config/capability-capsules`；`harness/config/capability-capsules.registry.yaml`；`harness/config/logical-operators.json`；`harness/config/skill-operator-bindings.yaml`；`harness/lib/actor_runtime.py`；`harness/lib/apo_plan_compiler.py`；`harness/lib/capability_capsules.py`；`harness/lib/evidence_ledger.py`；`harness/lib/graph_scheduler.py`；`harness/lib/skill_operator_registry.py`；`harness/schemas`；`harness/skills/registry.yaml`；另 11 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-agent-plan-optimizer-从静态映射升级为-skills-mcp-capsules-p-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-agent-plan-optimizer-从静态映射升级为-skills-mcp-capsules-p-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：把 Agent Plan Optimizer 从静态映射升级为 skills/MCP/capsules/p · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-把-agent-plan-optimizer-从静态映射升级为-skills-mcp-capsules-p-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/actor_runtime.py`；`harness/lib/evidence_ledger.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/schemas/apo-planner-artifact.v1.json`；`harness/schemas/task-classification.v1.json`；`harness/state/dispatch/pm-sprint-20260530-p0-修复单-把-agent-plan-optimizer-从静态映射升级为-skills-mcp-capsules-p-s02-architecture-N0-714bec7a.json`；`harness/tests/test_apo_dynamic_planner.py`；`harness/tests/test_apo_plan_compiler.py`；`harness/tests/test_capability_capsules.py`；`harness/tests/test_evidence_ledger.py`；`harness/tests/test_skill_operator_registry.py`；另 2 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-agent-plan-optimizer-从静态映射升级为-skills-mcp-capsules-p-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-agent-plan-optimizer-从静态映射升级为-skills-mcp-capsules-p-s02-architecture.task_graph.json`

- [x] **P0 | P0 修复单：把 Agent Plan Optimizer 从静态映射升级为 skills/MCP/capsules/p · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-把-agent-plan-optimizer-从静态映射升级为-skills-mcp-capsules-p-s04-orchestration-ui`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/apo_plan_compiler.py`；`harness/lib/dispatch_prompt_injector.py`；`harness/schemas/dispatch-package.schema.json`；`harness/tests/test-status-server-execution-plan-summary.py`；`harness/tests/test_dispatch_package_schema.py`；`harness/tests/test_dispatch_prompt_injector.py`；`harness/tests/test_skill_operator_registry.py`；`harness/tools/dispatch_prompt_injector.py`；`harness/tools/pane_handoff/evidence_validator.py`
  - 计划代码范围：`harness/config/skill-operator-bindings.yaml`；`harness/lib/actor_runtime.py`；`harness/lib/dispatch_prompt_injector.py`；`harness/lib/evidence_ledger.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/skill_operator_registry.py`；`harness/lib/solar_skills.py`；`harness/lib/symphony/status-server.py`；`harness/schemas/dispatch-package.schema.json`；`harness/schemas/draft/mcp-capability.v1.draft.json`；`harness/schemas/draft/skill.v2.draft.json`；另 19 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-agent-plan-optimizer-从静态映射升级为-skills-mcp-capsules-p-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-agent-plan-optimizer-从静态映射升级为-skills-mcp-capsules-p-s04-orchestration-ui.task_graph.json`

- [x] **P0 | P0 修复单：把现有 capability capsule substrate 升级为完整的 capsule-nativ · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-把现有-capability-capsule-substrate-升级为完整的-capsule-nativ-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-capability-capsule-substrate-升级为完整的-capsule-nativ-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-capability-capsule-substrate-升级为完整的-capsule-nativ-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：把 Logical Operator / Capsule / Physical Operator 收口到同 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：把 Logical Operator / Capsule / Physical Operator 收口到同 · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同-s02-architecture.task_graph.json`

- [x] **P0 | P0 修复单：把 Logical Operator / Capsule / Physical Operator 收口到同 · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/config/capability-capsules.registry.yaml`；`harness/config/physical-operators.example.json`；`harness/config/physical-operators.json`；`harness/config/physical-operators.schema.json`；`harness/lib/actor_runtime.py`；`harness/lib/apo_plan_compiler.py`；`harness/lib/apo_runtime_reoptimizer.py`；`harness/lib/capability_capsules.py`；`harness/lib/evidence_ledger.py`；`harness/schemas/draft/capability-capsule.v1.draft.json`；`harness/tests/test_apo_runtime_reoptimizer.py`；`harness/tests/test_capability_capsule_taxonomy.py`；另 1 项
  - 计划代码范围：`harness/config/capability-capsules.registry.yaml`；`harness/config/physical-operators.example.json`；`harness/config/physical-operators.json`；`harness/config/physical-operators.schema.json`；`harness/lib/actor_runtime.py`；`harness/lib/apo_plan_compiler.py`；`harness/lib/apo_runtime_reoptimizer.py`；`harness/lib/capability_capsules.py`；`harness/lib/evidence_ledger.py`；`harness/schemas/draft/capability-capsule.v1.draft.json`；`harness/schemas/draft/capsule-plan-ir.v1.draft.json`；`harness/schemas/draft/logical-plan-ir.v1.draft.json`；另 7 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同-s03-core-runtime.task_graph.json`

- [x] **P0 | P0 修复单：把 Logical Operator / Capsule / Physical Operator 收口到同 · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同-s04-orchestration-ui`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/tests/orchestration/test_orchestration_routes.py`；`harness/tests/test_s04_orchestration_routes.py`；`harness/tests/test_s04_orchestration_ui_smoke.py`；`harness/ui/orchestration/index.html`；`harness/ui/orchestration/main.js`；`harness/ui/orchestration/styles.css`
  - 计划代码范围：`harness/lib/evidence_ledger.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/model_call_runtime.py`；`harness/lib/orchestration/apo_chain_status.py`；`harness/status-server/routes/orchestration_routes.py`；`harness/tests/graph/test_s04_ready_node_dispatch_activation.py`；`harness/tests/orchestration/test_apo_chain_status.py`；`harness/tests/orchestration/test_orchestration_routes.py`；`harness/tests/test_s04_orchestration_acceptance.py`；`harness/tests/test_s04_orchestration_routes.py`；`harness/tests/test_s04_orchestration_ui_smoke.py`；另 4 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-logical-operator-capsule-physical-operator-收口到同-s04-orchestration-ui.task_graph.json`

- [x] **P0 | P0 修复单：把 Capsule-native Agent OS 的深层设计从 ADR/draft schema 收口到 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：把 Capsule-native Agent OS 的深层设计从 ADR/draft schema 收口到 · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到-s02-architecture.task_graph.json`

- [x] **P0 | P0 修复单：把 Capsule-native Agent OS 的深层设计从 ADR/draft schema 收口到 · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到-s03-core-runtime`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/config/physical-operators.json`；`harness/config/physical-operators.schema.json`；`harness/lib/apo_plan_compiler.py`；`harness/lib/capsule_graph.py`；`harness/lib/operator_runtime.py`；`harness/schemas/draft/capsule-graph.v1.draft.json`；`harness/tests/runtime/test_operator_runtime.py`；`harness/tests/test_apo_plan_compiler.py`；`harness/tests/test_capsule_graph_runtime.py`；`harness/tests/test_physical_operator_schema.py`；`harness/tools/operator_runtime.py`
  - 计划代码范围：`harness/config/physical-operators.json`；`harness/config/physical-operators.schema.json`；`harness/lib/apo_plan_compiler.py`；`harness/lib/capability_capsules.py`；`harness/lib/capsule_execution_gate.py`；`harness/lib/capsule_graph.py`；`harness/lib/operator_runtime.py`；`harness/lib/runtime_reoptimizer.py`；`harness/schemas/apo-planner-artifact.v1.json`；`harness/schemas/draft/capability-capsule.v1.draft.json`；`harness/schemas/draft/capsule-graph.v1.draft.json`；`harness/schemas/draft/capsule-runtime-contract.v1.draft.json`；另 15 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到-s03-core-runtime.task_graph.json`

- [x] **P0 | P0 修复单：把 Capsule-native Agent OS 的深层设计从 ADR/draft schema 收口到 · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到-s04-orchestration-ui`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/autopilot.py`；`harness/lib/autopilot_capability_routing.py`；`harness/lib/packages/orchestration_ui/__init__.py`；`harness/lib/packages/orchestration_ui/readiness_metadata.py`；`harness/tests/livework/test_integration_s04.py`；`harness/tests/test_autopilot_capability_routing.py`；`harness/tests/test_autopilot_capability_routing.py``；`harness/tests/test_capsule_readiness_metadata.py`；`harness/tests/test_graph_scheduler.py`；`harness/tools/autopilot.py`；`harness/tools/graph_scheduler.py`
  - 计划代码范围：`harness/lib/autopilot.py`；`harness/lib/autopilot_capability_routing.py`；`harness/lib/dispatch_package.py`；`harness/lib/dispatch_prompt_injector.py`；`harness/lib/evidence_ledger.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/pane_handoff/evidence_validator.py`；`harness/lib/prerequisite_resolver.py`；`harness/lib/task_graph_io.py`；`harness/lib/task_graph_state_io.py`；`harness/status-server/routes/orchestration_routes.py`；另 13 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把-capsule-native-agent-os-的深层设计从-adr-draft-schema-收口到-s04-orchestration-ui.task_graph.json`

- [x] **P0 | P0 修复单：补齐 Antigravity 2.0 desktop app 作为与 Codex app 对等的 requ · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：补齐 Antigravity 2.0 desktop app 作为与 Codex app 对等的 requ · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/tests/test_antigravity_observability.py`
  - 计划代码范围：`harness/lib/antigravity_bridge.py`；`harness/lib/external-integrations-health.py`；`harness/lib/intent_gateway.py`；`harness/schemas/requirement-ir.schema.json`；`harness/schemas/requirement-ir.schema.v1.draft.json`；`harness/tests/fixtures/antigravity-ingress`；`harness/tests/test_antigravity_bridge*.py`；`harness/tests/test_antigravity_ingress_chain.py`；`harness/tests/test_antigravity_ingress_schema.py`；`harness/tests/test_antigravity_observability*.py`；`harness/tests/test_frontdoor_ingress_parity.py`；`harness/tools/antigravity_bridge.py`；另 3 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ-s02-architecture.task_graph.json`

- [x] **P0 | P0 修复单：补齐 Antigravity 2.0 desktop app 作为与 Codex app 对等的 requ · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/antigravity_bridge.py`；`harness/tests/fixtures/antigravity-ingress/req-lineage-fixture.json`；`harness/tests/test_antigravity_bridge.py`；`harness/tests/test_antigravity_rawintent_chain.py`；`harness/tests/test_frontdoor_ingress_parity.py`；`harness/tests/test_intent_consumer.py`
  - 计划代码范围：`harness/lib/antigravity_bridge.py`；`harness/schemas/requirement-ir.schema.json`；`harness/schemas/requirement-ir.schema.v1.draft.json`；`harness/tests/fixtures/antigravity-ingress`；`harness/tests/test_antigravity_bridge.py`；`harness/tests/test_antigravity_ingress_schema.py`；`harness/tests/test_antigravity_rawintent_chain.py`；`harness/tests/test_frontdoor_ingress_parity.py`；`harness/tests/test_intent_consumer.py`；`harness/tools/antigravity_bridge.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ-s03-core-runtime.task_graph.json`

- [x] **P0 | P0 修复单：补齐 Antigravity 2.0 desktop app 作为与 Codex app 对等的 requ · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ-s04-orchestration-ui`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/tests/orchestration_ui/test_orchestration_routes_antigravity.py`；`harness/tools/smoke/antigravity_orchestration_ui_smoke.py`
  - 计划代码范围：`harness/tests/orchestration_ui/__init__.py`；`harness/tests/orchestration_ui/test_autopilot_source_routing.py`；`harness/tests/orchestration_ui/test_lineage_view.py`；`harness/tests/orchestration_ui/test_orchestration_routes_antigravity.py`；`harness/tests/orchestration_ui/test_pane_evidence_writer.py`；`harness/tools/antigravity_orchestration_view.py`；`harness/tools/antigravity_pane_evidence.py`；`harness/tools/autopilot.py`；`harness/tools/autopilot/event_recorder.py`；`harness/tools/multi_task_screen_health.py`；`harness/tools/smoke/__init__.py`；`harness/tools/smoke/antigravity_orchestration_ui_smoke.py`；另 3 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-补齐-antigravity-2-0-desktop-app-作为与-codex-app-对等的-requ-s04-orchestration-ui.task_graph.json`

- [x] **P0 | P0 修复单：修复 status 页面 /#lab 将运行中 lab panes 误报为 idle 的可见性缺口 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：修复 status 页面 /#lab 将运行中 lab panes 误报为 idle 的可见性缺口 · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s02-architecture.task_graph.json`

- [x] **P0 | P0 修复单：修复 status 页面 /#lab 将运行中 lab panes 误报为 idle 的可见性缺口 · 核心实现与数据模型**
  - ID：`sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s03-core-runtime`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/symphony/status-server.py`
  - 计划代码范围：`harness/lib/symphony/status-server.py`；`harness/tests/test-status-server-builder-lab-runtime-truth.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s03-core-runtime.task_graph.json`

- [x] **P0 | P0 修复单：修复 status 页面 /#lab 将运行中 lab panes 误报为 idle 的可见性缺口 · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s04-orchestration-ui`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/symphony/status-server.py`
  - 计划代码范围：`harness/lib/symphony/status-server.py`；`harness/tests/test-status-server-lab-runtime-truth-ui.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s04-orchestration-ui.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s04-orchestration-ui.eval.json`

- [x] **P0 | P0 修复单：修复 status 页面 /#lab 将运行中 lab panes 误报为 idle 的可见性缺口 · 验证、回归与发布证据**
  - ID：`sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s05-verification-release`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/reports/sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s05-live-activation-proof.md`；`harness/run/_v2_activation_probe/lab-screen-direct.json`；`harness/run/_v2_activation_probe/mismatch-summary.json`；`harness/run/_v2_activation_probe/operator-status-snapshot.json`；`harness/run/_v2_activation_probe/pane-hygiene-snapshot.json`；`harness/run/_v2_activation_probe/pane-leases-snapshot.json`；`harness/scripts/generate_snapshots.py`
  - 计划代码范围：`harness/tests/test-status-server-lab-verification-release.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s05-verification-release.eval.json`

- [x] **P0 | P0 修复单：把现有 GEPA Stage 1 substrate 升级为 Solar Optimizer 的离线元优化 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s01-requirements.task_graph.json`

- [x] **P0 | P0 修复单：把现有 GEPA Stage 1 substrate 升级为 Solar Optimizer 的离线元优化 · 架构设计与接口契约**
  - ID：`sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s02-architecture.task_graph.json`

- [x] **P0 | P0 修复单：把现有 GEPA Stage 1 substrate 升级为 Solar Optimizer 的离线元优化 · 调度、自动化与可视化**
  - ID：`sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s04-orchestration-ui`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/graph_scheduler.py`；`harness/lib/orchestration/epic_status_view.py`；`harness/lib/pane_handoff/evidence_validator.py`；`harness/tests/control_plane/test-dag-autopilot-planner.sh`；`harness/tests/graph/test_graph_scheduler_external_deps.py`；`harness/tests/graph/test_graph_status_sync.py`；`harness/tests/orchestration/test_autopilot_capability_routing.py`；`harness/tests/orchestration/test_epic_status_view.py`；`harness/tests/orchestration/test_orchestration_routes.py`；`harness/tests/orchestration/test_pane_evidence_gate.py`；`harness/tests/test_pane_handoff_evidence.py`；`harness/tools/graph_node_dispatcher.py`；另 3 项
  - 提交证据：`50f838a4`
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s04-orchestration-ui.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-s04-orchestration-ui.eval.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 修复单，作为现有 GEPA 元优化器落地的第二刀，目标是把 GEPA · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-修复单-作为现有-gepa-元优化器落地的第二刀-目标是把-gepa-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/tests/integrations/gepa_optimizer/test_asi_adapter.py`；`harness/tests/integrations/gepa_optimizer/test_evidence_pipeline.py`；`harness/tests/integrations/gepa_optimizer/test_objectives.py`；`harness/tests/integrations/gepa_optimizer/test_replay_suite.py`
  - 计划代码范围：`harness/tests/integrations/gepa_optimizer/test_asi_adapter.py`；`harness/tests/integrations/gepa_optimizer/test_evidence_pipeline.py`；`harness/tests/integrations/gepa_optimizer/test_objectives.py`；`harness/tests/integrations/gepa_optimizer/test_replay_suite.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-修复单-作为现有-gepa-元优化器落地的第二刀-目标是把-gepa-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-修复单-作为现有-gepa-元优化器落地的第二刀-目标是把-gepa-s01-requirements.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，把现有的 Capsule-native Agent Pl · 架构设计与接口契约**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl-s02-architecture.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，把现有的 Capsule-native Agent Pl · 核心实现与数据模型**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/actor_runtime.py`；`harness/lib/attempt_ledger.py`；`harness/lib/attempt_ledger.py` (MODIFIED`；`harness/lib/dispatch_scheduler.py`；`harness/lib/mode_selector.py`；`harness/lib/operator_registry_loader.py`；`harness/lib/runtime_context_inject.py`；`harness/lib/skill_capsule_bridge.py`；`harness/schemas/access-path-decision.schema.json`；`harness/schemas/attempt-ledger.schema.json`；`harness/schemas/capsule-schema.yaml`；`harness/schemas/evolution-runtime-ir.schema.json`；另 6 项
  - 计划代码范围：`harness/lib/access_path_optimizer.py`；`harness/lib/actor_runtime.py`；`harness/lib/attempt_ledger.py`；`harness/lib/dispatch_scheduler.py`；`harness/lib/mode_selector.py`；`harness/lib/operator_registry_loader.py`；`harness/lib/optimizer_runtime`；`harness/lib/runtime_context_inject.py`；`harness/lib/skill_capsule_bridge.py`；`harness/schemas/access-path-decision.schema.json`；`harness/schemas/attempt-ledger.schema.json`；`harness/schemas/capsule-schema.yaml`；另 10 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl-s03-core-runtime.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-把现有的-capsule-native-agent-pl-s03-core-runtime.handoff.md`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是： · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-s01-requirements.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是： · 架构设计与接口契约**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/solar_eval/__init__.py`；`harness/lib/solar_eval/active_learning_queue.py`；`harness/lib/solar_eval/eval_factory.py`；`harness/lib/solar_eval/hidden/__init__.py`；`harness/lib/solar_eval/hidden/anti_reward_hacking.py`；`harness/lib/solar_eval/hidden/holdout_manager.py`；`harness/lib/solar_eval/judge_panel.py`；`harness/lib/solar_eval/proof_obligation_compiler.py`；`harness/lib/solar_eval/registry/__init__.py`；`harness/lib/solar_eval/registry/evaluator_registry.py`；`harness/lib/solar_eval/registry/promotion.py`；`harness/lib/solar_eval/registry/verifier_registry.py`；另 62 项
  - 计划代码范围：`harness/lib/solar_eval/__init__.py`；`harness/lib/solar_eval/active_learning_queue.py`；`harness/lib/solar_eval/eval_factory.py`；`harness/lib/solar_eval/fixtures`；`harness/lib/solar_eval/hidden`；`harness/lib/solar_eval/hidden/anti_reward_hacking.py`；`harness/lib/solar_eval/hidden/holdout_manager.py`；`harness/lib/solar_eval/judge_panel.py`；`harness/lib/solar_eval/proof_obligation_compiler.py`；`harness/lib/solar_eval/registry/evaluator_registry.py`；`harness/lib/solar_eval/registry/promotion.py`；`harness/lib/solar_eval/registry/verifier_registry.py`；另 66 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-s02-architecture.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是： · 调度、自动化与可视化**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-s04-orchestration-ui`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/orchestration/run_evidence_projection.py`；`harness/tests/livework/test_integration_s04.py`；`harness/tests/orchestration_ui/test_runtime_evidence_projection.py`；`harness/tests/orchestration_ui/test_s04_e2e.py`；`harness/tools/graph_scheduler`；`harness/tools/orchestration/run_evidence_projection.py`
  - 计划代码范围：`harness/lib/graph_drain_controller.py`；`harness/lib/orchestration/epic_status_view.py`；`harness/lib/orchestration/run_evidence_projection.py`；`harness/tests/livework/test_integration_s04.py`；`harness/tests/orchestration_ui/test_epic_status_view.py`；`harness/tests/orchestration_ui/test_pane_evidence_gate.py`；`harness/tests/orchestration_ui/test_runtime_evidence_projection.py`；`harness/tests/orchestration_ui/test_s04_e2e.py`；`harness/tests/test_graph_drain_controller.py`；`harness/tests/test_s04_activation_graph_route.py`；`harness/tools/antigravity_pane_evidence.py`；`harness/tools/autopilot.py`；另 6 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-s04-orchestration-ui.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 架构整改单，主题是： · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是-s01-requirements.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 架构整改单，主题是： · 架构设计与接口契约**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是-s02-architecture.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 架构整改单，主题是： · 核心实现与数据模型**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是-s03-core-runtime`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是-s03-core-runtime.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构整改单-主题是-s03-core-runtime.handoff.md`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 优化器架构升级单，目标不是简单“接入一个 GEPA 包”或“套一个 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/schemas/attempt-ledger.schema.json`；`harness/schemas/execution-trace.schema.json`；`harness/tests/fixtures/tui_recovery/*.json`；`harness/tests/test_binding_policy.py`；`harness/tests/test_capsule_evaluator.py`；`harness/tests/test_evolution/test_coral_evolution.py`；`harness/tests/test_trace_builder.py`；`harness/tests/test_tui_recovery_policy.py`
  - 计划代码范围：`harness/schemas/attempt-ledger.schema.json`；`harness/schemas/execution-trace.schema.json`；`harness/tests/fixtures/tui_recovery`；`harness/tests/test_binding_policy.py`；`harness/tests/test_capsule_evaluator.py`；`harness/tests/test_evolution`；`harness/tests/test_trace_builder.py`；`harness/tests/test_tui_recovery_policy.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-优化器架构升级单-目标不是简单-接入一个-gepa-包-或-套一个-s01-requirements.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是： · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-2-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-2-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-2-s01-requirements.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 总体架构升级单，正式命名为： · 架构设计与接口契约**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s02-architecture.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是“统一数据访问层 / 上下文数据平面升级：把现有 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-统一数据访问层-上下文数据平面升级-把现有-s01-requirements`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/cocoindex_adapter.py`；`harness/lib/cocoindex_flows`；`harness/lib/context_usage_verifier.py`；`harness/lib/runtime_context_inject.py`；`harness/lib/solar-unified-context.py`；`harness/lib/understand_anything_adapter.py`；`harness/tests/test_coco_cli.py`；`harness/tests/test_context_usage_verifier.py`；`harness/tests/test_ua_cli.py`；`harness/tests/test_understanding_artifact_schema.py`；`harness/tools/solar_harness_coco_cli.py`；`harness/tools/solar_harness_ua_cli.py`
  - 计划代码范围：`harness/config/capability-capsules/cap.context-deep-understanding.yaml`；`harness/config/capability-capsules/cap.incremental-context-index.yaml`；`harness/config/capability-capsules/cap.solar-context-fusion.yaml`；`harness/config/skill-operator-bindings.yaml`；`harness/lib/cocoindex_adapter.py`；`harness/lib/cocoindex_flows`；`harness/lib/context_usage_verifier.py`；`harness/lib/runtime_context_inject.py`；`harness/lib/solar-unified-context.py`；`harness/lib/understand_anything_adapter.py`；`harness/schemas/understanding-artifact-v1.json`；`harness/tests/test_coco_cli.py`；另 5 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-统一数据访问层-上下文数据平面升级-把现有-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-统一数据访问层-上下文数据平面升级-把现有-s01-requirements.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是“把 Mirage 从统一 VFS wrapper · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把-mirage-从统一-vfs-wrapper-s01-requirements`
  - 真值：`ok` · `passed/eval_passed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把-mirage-从统一-vfs-wrapper-s01-requirements.status.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是“把 Mirage 从统一 VFS wrapper · 架构设计与接口契约**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把-mirage-从统一-vfs-wrapper-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把-mirage-从统一-vfs-wrapper-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把-mirage-从统一-vfs-wrapper-s02-architecture.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是“把 Mirage 从统一 VFS wrapper · 核心实现与数据模型**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把-mirage-从统一-vfs-wrapper-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/*.py`；`harness/tests/**/*.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把-mirage-从统一-vfs-wrapper-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把-mirage-从统一-vfs-wrapper-s03-core-runtime.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是“把 Mirage 从统一 VFS wrapper · 验证、回归与发布证据**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把-mirage-从统一-vfs-wrapper-s05-verification-release`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/tests/verification/s05/test_s05_activation_proof.py`；`harness/tests/verification/s05/test_s05_doctor.py`；`harness/tests/verification/s05/test_s05_e2e_pipeline.py`；`harness/tests/verification/s05/test_s05_evidence_ledger.py`；`harness/tests/verification/s05/test_s05_negative_context_usage.py`；`harness/tests/verification/s05/test_s05_search_sidecar.py`；`harness/tools/evidence/replay_context_ledger.py`
  - 计划代码范围：`harness/tests/verification/s05/test_s05_activation_proof.py`；`harness/tests/verification/s05/test_s05_doctor.py`；`harness/tests/verification/s05/test_s05_e2e_pipeline.py`；`harness/tests/verification/s05/test_s05_evidence_ledger.py`；`harness/tests/verification/s05/test_s05_negative_context_usage.py`；`harness/tests/verification/s05/test_s05_search_sidecar.py`；`harness/tools/evidence/replay_context_ledger.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把-mirage-从统一-vfs-wrapper-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把-mirage-从统一-vfs-wrapper-s05-verification-release.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把-mirage-从统一-vfs-wrapper-s05-verification-release.eval.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0 架构升级单，主题是“把现有 PM pane / Requiremen · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把现有-pm-pane-requiremen-s01-requirements`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把现有-pm-pane-requiremen-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把现有-pm-pane-requiremen-s01-requirements.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把现有-pm-pane-requiremen-s01-requirements.eval.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0/P1 架构升级单，主题是：基于 GEPA optimize_anyt · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s01-requirements`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/compile_eval/asi_trace.py`
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s01-requirements.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0/P1 架构升级单，主题是：基于 GEPA optimize_anyt · 架构设计与接口契约**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s02-architecture.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0/P1 架构升级单，主题是：基于 GEPA optimize_anyt · 核心实现与数据模型**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/compile_eval/asi_components/__init__.py`；`harness/lib/compile_eval/asi_components/contract_compiler.py`；`harness/lib/compile_eval/asi_components/dag_compiler.py`；`harness/lib/compile_eval/asi_components/evidence.py`；`harness/lib/compile_eval/asi_components/handoff.py`；`harness/lib/compile_eval/asi_components/intake.py`；`harness/lib/compile_eval/asi_components/requirement_ir.py`；`harness/lib/compile_eval/eval_runtime.py`；`harness/lib/compile_eval/harness.py`；`harness/lib/compile_eval/tests/test_asi_components.py`；`harness/lib/compile_eval/tests/test_e2e_core_runtime.py`；`harness/lib/compile_eval/tests/test_harness_fitness_rewrite.py`
  - 计划代码范围：`harness/lib/compile_eval/asi_components/__init__.py`；`harness/lib/compile_eval/asi_components/contract_compiler.py`；`harness/lib/compile_eval/asi_components/dag_compiler.py`；`harness/lib/compile_eval/asi_components/evidence.py`；`harness/lib/compile_eval/asi_components/handoff.py`；`harness/lib/compile_eval/asi_components/intake.py`；`harness/lib/compile_eval/asi_components/requirement_ir.py`；`harness/lib/compile_eval/eval_runtime.py`；`harness/lib/compile_eval/hard_validators.py`；`harness/lib/compile_eval/harness.py`；`harness/lib/compile_eval/tests/test_asi_components.py`；`harness/lib/compile_eval/tests/test_e2e_core_runtime.py`；另 17 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s03-core-runtime.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s03-core-runtime.eval.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0/P1 架构升级单，主题是：基于 GEPA optimize_anyt · 调度、自动化与可视化**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s04-orchestration-ui`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/symphony/status-server.py`；`harness/ui/orchestration/main.js`；`harness/ui/profile-orchestration/index.html`；`harness/ui/profile-orchestration/main.js`；`harness/ui/profile-orchestration/styles.css`
  - 计划代码范围：`harness/tools/antigravity_pane_evidence.py`；`harness/tools/autopilot/hooks/__init__.py`；`harness/tools/autopilot/hooks/gepa_profile_signals.py`；`harness/tools/profile_orchestration_lib/__init__.py`；`harness/tools/profile_orchestration_lib/blocked_view.py`；`harness/tools/profile_orchestration_lib/capability_view.py`；`harness/tools/profile_orchestration_lib/fallback.py`；`harness/tools/profile_orchestration_lib/governance_view.py`；`harness/tools/profile_orchestration_lib/pareto_view.py`；`harness/tools/profile_orchestration_lib/registry_view.py`；`harness/tools/profile_promotion_scheduler.py`；`harness/ui/orchestration/main.js`；另 3 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s04-orchestration-ui.task_graph.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s04-orchestration-ui.eval.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0/P1 架构升级单，主题是：基于 GEPA optimize_anyt · 验证、回归与发布证据**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s05-verification-release`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/reports/s05-release/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s05-verification-release-V5-kb-raw-manifest.json`
  - 计划代码范围：`harness/bin/solar-compile-eval-e2e`；`harness/lib/compile_eval/e2e`；`harness/lib/compile_eval/regression`；`harness/reports/s05-regression`；`harness/reports/s05-release`；`harness/tests/test_s05_e2e.py`；`harness/tests/test_s05_negative_control.py`；`harness/tests/test_s05_regression_report.py`；`harness/tests/test_s05_router_profile.py`；`harness/tools/codex_pm_router.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-基于-gepa-optimize-anyt-s05-verification-release.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0/P1 总体架构升级单，主题是：把现有 Solar Harness 从 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从-s01-requirements.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0/P1 总体架构升级单，主题是：把现有 Solar Harness 从 · 架构设计与接口契约**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/cli/closure_cli.py`；`harness/lib/contract_closure.py`；`harness/lib/dispatch_package.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/task_graph_split.py`；`harness/lib/workflow_guard.py`；`harness/schemas/schema_loader.py`；`harness/schemas/schema_loader.py`：未修改（当前已注册 11 个文件名）。`；`harness/tests/test_s02_architecture.py`
  - 计划代码范围：`harness/cli/closure_cli.py`；`harness/lib/contract_closure.py`；`harness/lib/dispatch_package.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/task_graph_split.py`；`harness/lib/workflow_guard.py`；`harness/schemas`；`harness/tests/test_s02_architecture.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从-s02-architecture.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0/P1 总体架构升级单，主题是：把现有 Solar Harness 从 · 核心实现与数据模型**
  - ID：`sprint-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从-s03-core-runtime`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/tests/graph/test_s03_core_runtime_integration.py`
  - 计划代码范围：`harness/lib/contract_closure.py`；`harness/lib/dispatch_package.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/task_graph_io.py`；`harness/lib/task_graph_split.py`；`harness/lib/task_graph_state_io.py`；`harness/lib/workflow_guard.py`；`harness/schemas/closure.schema.json`；`harness/schemas/contract-manifest.schema.json`；`harness/schemas/dispatch-package.schema.json`；`harness/schemas/operator-plan.schema.json`；另 21 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260530-请为-solar-harness-开一个新的-p0-p1-总体架构升级单-主题是-把现有-solar-harness-从-s03-core-runtime.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0/P1 架构升级单，主题是：把 task_graph 从现网单文件主读 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s01-requirements`
  - 真值：`ok` · `passed/eval_passed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s01-requirements.status.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0/P1 架构升级单，主题是：把 task_graph 从现网单文件主读 · 架构设计与接口契约**
  - ID：`sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s02-architecture.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0/P1 架构升级单，主题是：把 task_graph 从现网单文件主读 · 核心实现与数据模型**
  - ID：`sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/*.py`；`harness/tests/**/*.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s03-core-runtime.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0/P1 架构升级单，主题是：把 task_graph 从现网单文件主读 · 调度、自动化与可视化**
  - ID：`sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s04-orchestration-ui`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/tests/test-orchestration-cutover-canary.sh`；`harness/tests/test_orchestration_triface_reader.py`；`harness/tools/autopilot.py`；`harness/tools/autopilot.py` (519→766 lines`；`harness/tools/multi_task_status.py`；`harness/tools/multi_task_status.py` (mtime=2026-06-03T20:10:51Z`；`harness/tools/prerequisite_resolver.py`；`harness/tools/prerequisite_resolver.py` (328→399 lines`；`harness/tools/runtime_status.py`；`harness/tools/runtime_status.py` (mtime=2026-06-03T20:11:14Z`
  - 计划代码范围：`harness/lib/graph_scheduler.py`；`harness/lib/prerequisite_resolver.py`；`harness/tests/test-orchestration-cutover-canary.sh`；`harness/tests/test_orchestration_triface_reader.py`；`harness/tools/autopilot.py`；`harness/tools/multi_task_status.py`；`harness/tools/orchestration_canary_replay.py`；`harness/tools/prerequisite_resolver.py`；`harness/tools/runtime_status.py`；`harness/ui/orchestration`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s04-orchestration-ui.task_graph.json`；`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s04-orchestration-ui.eval.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0/P1 架构升级单，主题是：把 task_graph 从现网单文件主读 · 验证、回归与发布证据**
  - ID：`sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s05-verification-release`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/docs/triface-cutover.md`；`harness/tests/integration/test-epic-close-guard.sh`；`harness/tests/integration/test-triface-ui-live.sh`；`harness/tests/orchestration/test-triface-canary-replay.sh`；`harness/tests/release/test-triface-release-smoke.sh`；`harness/tests/s05-collected-artifacts.triface-cutover.json`
  - 计划代码范围：`harness/docs/triface-cutover.md`；`harness/tests/fixtures/triface-negative`；`harness/tests/integration/test-epic-close-guard.sh`；`harness/tests/integration/test-triface-ui-live.sh`；`harness/tests/negative/test-triface-closeout-incomplete.sh`；`harness/tests/negative/test-triface-concurrent-write.sh`；`harness/tests/negative/test-triface-inline-status-in-spec.sh`；`harness/tests/negative/test-triface-mirror-fallback.sh`；`harness/tests/negative/test-triface-stale-node-results.sh`；`harness/tests/orchestration/test-triface-canary-replay.sh`；`harness/tests/regression/run-vnext-regression-suite.sh`；`harness/tests/regression/test-triface-contract_closure.sh`；另 9 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s05-verification-release.task_graph.json`

- [x] **P0 | P0/P1 修复单：autopilot planner 空转去重与 dispatcher operator-pool compatibility · 需求拆解与追踪矩阵**
  - ID：`sprint-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility-s01-requirements.task_graph.json`

- [x] **P0 | P0/P1 修复单：autopilot planner 空转去重与 dispatcher operator-pool compatibility · 架构设计与接口契约**
  - ID：`sprint-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility-s02-architecture.task_graph.json`

- [x] **P0 | P0/P1 修复单：autopilot planner 空转去重与 dispatcher operator-pool compatibility · 核心实现与数据模型**
  - ID：`sprint-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/tests/control_plane/test-autopilot-pane-gate-reconcile.py`；`harness/tests/test_pm_dispatch.py`；`harness/tools/solar-autopilot-monitor.py`
  - 计划代码范围：`harness/lib/pane_role_pool.py`；`harness/tests/control_plane/test-autopilot-pane-gate-reconcile.py`；`harness/tests/test_dispatcher_integration.py`；`harness/tests/test_graph_node_dispatch_duplicate_guard.py`；`harness/tests/test_graph_node_dispatcher_role_fallback.py`；`harness/tests/test_graph_node_dispatcher_worker_catalog.py`；`harness/tests/test_pm_dispatch.py`；`harness/tools/graph_node_dispatcher.py`；`harness/tools/pm_dispatch.py`；`harness/tools/solar-autopilot-monitor.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibility-s03-core-runtime.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0/P1 聚焦执行单：GEPA Requirement Compiler · 架构设计与接口契约**
  - ID：`sprint-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler-s02-architecture.task_graph.json`；`~/.solar/harness/sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-聚焦执行单-gepa-requirement-compiler-s02-architecture.eval.json`

- [x] **P0 | GEPA Requirement Compiler 外循环第二阶段 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260531-gepa-requirement-compiler-外循环第二阶段-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-gepa-requirement-compiler-外循环第二阶段-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260531-gepa-requirement-compiler-外循环第二阶段-s01-requirements.task_graph.json`；`~/.solar/harness/sprints/sprint-20260531-gepa-requirement-compiler-外循环第二阶段-s01-requirements.eval.json`

- [x] **P0 | GEPA Requirement Compiler 外循环第二阶段 · 调度、自动化与可视化**
  - ID：`sprint-20260531-gepa-requirement-compiler-外循环第二阶段-s04-orchestration-ui`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/autopilot.py`；`harness/lib/autopilot.py`（运行时真实调用链）：新增 `_PLANNING_ARTIFACT_KEYS` / `_ARTIFACT_DISK_SUFFIX` / `_discover_planning_artifacts()`；在 `dag_bridge_activate()` 顶部插入 Gate 0（提升或精确 blocker）。目的：把 status/artifact 发现接到 design/plan/task_graph/design_html/planning_html，终结 invalid_prd 循环。`；`harness/lib/reviewing_route_normalizer.py`；`harness/lib/reviewing_route_normalizer.py`（coordinator 真实调用）：新增 `promote_nested_artifacts()`，`normalize_status()` 里先提升嵌套 artifacts 再做 review 路由归一化。`；`harness/tools/autopilot.py`；`harness/tools/autopilot.py`（声明写域内的镜像副本）：同上改动，保持两份一致。`；`harness/tools/orchestration_activation_snapshot.py`；`harness/tools/render_orchestration_evidence_html.py`；`harness/tools/reviewing_route_normalizer.py`；`harness/tools/reviewing_route_normalizer.py`（声明写域内的源副本）：同上改动。`
  - 计划代码范围：`harness/tools/apo_plan_compiler.py`；`harness/tools/autopilot.py`；`harness/tools/core_runtime_trace.py`；`harness/tools/dispatch_prompt_injector.py`；`harness/tools/harness_graph.py`；`harness/tools/orchestration_activation_snapshot.py`；`harness/tools/pm_dispatch.py`；`harness/tools/render_orchestration_evidence_html.py`；`harness/tools/reviewing_route_normalizer.py`；`harness/tools/worker_runtime.py`；`harness/ui/orchestration`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-gepa-requirement-compiler-外循环第二阶段-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260531-gepa-requirement-compiler-外循环第二阶段-s04-orchestration-ui.task_graph.json`；`~/.solar/harness/sprints/sprint-20260531-gepa-requirement-compiler-外循环第二阶段-s04-orchestration-ui.handoff.md`

- [x] **P0 | cmux 多标签四分屏 tmux 状态监控工作台 · 需求拆解与追踪矩阵**
  - ID：`sprint-20260531-cmux-多标签四分屏-tmux-状态监控工作台-s01-requirements`
  - 真值：`ok` · `passed/eval_passed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-cmux-多标签四分屏-tmux-状态监控工作台-s01-requirements.status.json`

- [x] **P0 | cmux 多标签四分屏 tmux 状态监控工作台 · 架构设计与接口契约**
  - ID：`sprint-20260531-cmux-多标签四分屏-tmux-状态监控工作台-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-cmux-多标签四分屏-tmux-状态监控工作台-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260531-cmux-多标签四分屏-tmux-状态监控工作台-s02-architecture.task_graph.json`

- [x] **P0 | cmux 多标签四分屏 tmux 状态监控工作台 · 核心实现与数据模型**
  - ID：`sprint-20260531-cmux-多标签四分屏-tmux-状态监控工作台-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/config/*.yaml`；`harness/docs/*.md`；`harness/scripts/cmux`；`harness/tests/**/*.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-cmux-多标签四分屏-tmux-状态监控工作台-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260531-cmux-多标签四分屏-tmux-状态监控工作台-s03-core-runtime.task_graph.json`

- [x] **P0 | cmux 多标签四分屏 tmux 状态监控工作台 · 验证、回归与发布证据**
  - ID：`sprint-20260531-cmux-多标签四分屏-tmux-状态监控工作台-s05-verification-release`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/tests/cmux/test_cmux_s05_negative_controls.py`；`harness/tests/cmux/test_cmux_s05_regression.py`
  - 计划代码范围：`harness/docs/cmux-monitoring-workspace.md`；`harness/tests/cmux/test_cmux_s05_negative_controls.py`；`harness/tests/cmux/test_cmux_s05_regression.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-cmux-多标签四分屏-tmux-状态监控工作台-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260531-cmux-多标签四分屏-tmux-状态监控工作台-s05-verification-release.task_graph.json`

- [x] **P0 | P0: AI Influence YouTube 报告流质量增强 — Report IR + 逐章写作 + Deep W · 需求拆解与追踪矩阵**
  - ID：`sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s01-requirements`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s01-requirements.task_graph.json`

- [x] **P0 | P0: AI Influence YouTube 报告流质量增强 — Report IR + 逐章写作 + Deep W · 架构设计与接口契约**
  - ID：`sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s02-architecture`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s02-architecture.task_graph.json`

- [x] **P0 | P0: AI Influence YouTube 报告流质量增强 — Report IR + 逐章写作 + Deep W · 核心实现与数据模型**
  - ID：`sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/scripts/tech_hotspot_radar.py`；`harness/tests/test_report_pipeline.py`；`harness/tools/report_evidence.py`；`harness/tools/report_ir.py`；`harness/tools/report_synthesis.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s03-core-runtime.task_graph.json`；`~/.solar/harness/sprints/sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s03-core-runtime.eval.json`

- [x] **P0 | P0: AI Influence YouTube 报告流质量增强 — Report IR + 逐章写作 + Deep W · 调度、自动化与可视化**
  - ID：`sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s04-orchestration-ui`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/ai_influence_youtube_report/pane_surface.py`；`harness/lib/ai_influence_youtube_report/status_surface.py`；`harness/scripts/tech_hotspot_radar.py`；`harness/tests/test_ai_influence_youtube_report_status_surface.py`；`harness/tests/test_report_deep_verifier_repair.py`
  - 计划代码范围：`harness/scripts/tech_hotspot_radar.py`；`harness/status-server`；`harness/tests`；`harness/tests/test_ai_influence_youtube_report_status_surface.py`；`harness/tests/test_report_deep_verifier_repair.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w-s04-orchestration-ui.task_graph.json`

- [x] **N/A | 请为 Solar-Harness 开启一个正式实现 sprint，把 Requirement Compiler 升级为可由 GEPA 离线优化的自进化需求编译器**
  - ID：`sprint-20260525-000730`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/compile_eval/__init__.py`；`harness/lib/compile_eval/asi_trace.py`；`harness/lib/compile_eval/dimensions.py`；`harness/lib/compile_eval/golden_cases.py`；`harness/lib/compile_eval/hard_validators.py`；`harness/lib/compile_eval/harness.py`；`harness/lib/compiler_profile/__init__.py`；`harness/lib/compiler_profile/loader.py`；`harness/lib/compiler_profile/registry.py`；`harness/lib/compiler_profile/schema.py`；`harness/tests/test_compile_eval.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-000730.status.json`；`~/.solar/harness/sprints/sprint-20260525-000730.task_graph.json`

- [x] **N/A | RawIntent Consumer Request**
  - ID：`sprint-20260525-153733-intent-rawintent-d0bbf8d0`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/intent_consumer.py consume`；`harness/lib/intent_execution/__init__.py`；`harness/lib/intent_execution/codex_bridge.py`；`harness/lib/intent_gateway.py capture`；`harness/tests/test_codex_bridge_intent_execution.py`
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-153733-intent-rawintent-d0bbf8d0.status.json`；`~/.solar/harness/sprints/sprint-20260525-153733-intent-rawintent-d0bbf8d0.task_graph.json`

- [x] **N/A | RawIntent Consumer Request - [entrypoint_metadata]**
  - ID：`sprint-20260525-155416-intent-entrypoint_metadata-c7d24d4b`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-155416-intent-entrypoint_metadata-c7d24d4b.status.json`；`~/.solar/harness/sprints/sprint-20260525-155416-intent-entrypoint_metadata-c7d24d4b.task_graph.json`

- [x] **N/A | RawIntent Consumer Request - mobile untrusted compile only smoke**
  - ID：`sprint-20260525-155513-intent-mobile-untrusted-compile-onl-029157d3`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-155513-intent-mobile-untrusted-compile-onl-029157d3.status.json`；`~/.solar/harness/sprints/sprint-20260525-155513-intent-mobile-untrusted-compile-onl-029157d3.task_graph.json`

- [x] **N/A | RawIntent Consumer Request - # Execution Contract**
  - ID：`sprint-20260525-155538-intent-execution-contract-44d68383`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/intent_execution/__init__.py`；`harness/lib/intent_execution/contract.py`；`harness/lib/intent_execution/evidence.py`；`harness/lib/intent_execution/executor.py`
  - 计划代码范围：`harness/lib/intent_execution`；`harness/tests/intent_execution`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-155538-intent-execution-contract-44d68383.status.json`；`~/.solar/harness/sprints/sprint-20260525-155538-intent-execution-contract-44d68383.task_graph.json`；`~/.solar/harness/sprints/sprint-20260525-155538-intent-execution-contract-44d68383.eval.json`

- [x] **N/A | RawIntent Consumer Request - # 需求：Browser Agent 物理执行算子 / 高级研究算子池**
  - ID：`sprint-20260525-browser-agent-research-operators`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/config/*.schema.json`；`harness/config/actor-hosts.json`；`harness/config/agent-actors.json`；`harness/config/logical-operators.json`；`harness/config/physical-operators.json`；`harness/docs`；`harness/lib`；`harness/lib/logical_operator_router.py`；`harness/lib/operator_score.py`；`harness/monitor-reports/sprint-20260525-browser-agent-research-operators.md`；`harness/tests`；`harness/tests/runtime`；另 1 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-browser-agent-research-operators.status.json`；`~/.solar/harness/sprints/sprint-20260525-browser-agent-research-operators.task_graph.json`

- [x] **N/A | Browser Agent Global Physical Operator Cutover**
  - ID：`sprint-20260525-browser-agent-global-operator-cutover`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/config`；`harness/docs`；`harness/lib`；`harness/lib/logical_operator_router.py`；`harness/lib/operator_score.py`；`harness/monitor-reports/sprint-20260525-browser-agent-global-operator-cutover.md`；`harness/tests`；`harness/tools/monitor_bridge.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260525-browser-agent-global-operator-cutover.status.json`；`~/.solar/harness/sprints/sprint-20260525-browser-agent-global-operator-cutover.task_graph.json`

- [x] **N/A | Tech Hotspot Radar: Social Browser Backend for X 大咖监控**
  - ID：`epic-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/docs/social-browser-backend-x/A1-control-plane-data-plane-interfaces.md`；`harness/docs/social-browser-backend-x/C1-dashboard-renderer-spec.md`；`harness/docs/social-browser-backend-x/C2-cli-command-tree-spec.md`；`harness/docs/social-browser-backend-x/C3-config-ui-spec.md`；`harness/docs/social-browser-backend-x/C4-autopilot-integration-plan.md`；`harness/lib/social_browser_backend_x`；`harness/lib/social_browser_backend_x/__init__.py`；`harness/lib/social_browser_backend_x/backend_selector.py`；`harness/lib/social_browser_backend_x/browser_lease_client.py`；`harness/lib/social_browser_backend_x/cli.py`；`harness/lib/social_browser_backend_x/dedup_keys_table.py`；`harness/lib/social_browser_backend_x/dedup_queue.py`；另 15 项
  - 计划代码范围：`harness/docs/social-browser-backend-x/A1-control-plane-data-plane-interfaces.md`；`harness/docs/social-browser-backend-x/A2-data-model-schema.md`；`harness/docs/social-browser-backend-x/A3-compat-migration.md`；`harness/docs/social-browser-backend-x/A4-oq-resolutions.md`；`harness/docs/social-browser-backend-x/C1-dashboard-renderer-spec.md`；`harness/docs/social-browser-backend-x/C2-cli-command-tree-spec.md`；`harness/docs/social-browser-backend-x/C3-config-ui-spec.md`；`harness/docs/social-browser-backend-x/C4-autopilot-integration-plan.md`；`harness/docs/social-browser-backend-x/RELEASE.md`；`harness/lib/social_browser_backend_x/__init__.py`；`harness/lib/social_browser_backend_x/backend_selector.py`；`harness/lib/social_browser_backend_x/browser_lease_client.py`；另 15 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控.status.json`；`~/.solar/harness/sprints/epic-20260525-tech-hotspot-radar-social-browser-backend-for-x-大咖监控.task_graph.json`

- [x] **N/A | 20260526-understand-anything-claude-code-integration**
  - ID：`sprint-20260526-understand-anything-claude-code-integration`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/monitor-reports/understand-anything-analysis.md`；`harness/monitor-reports/understand-anything-claude-code-integration.md`；`harness/monitor-reports/understand-anything-install.md`；`harness/monitor-reports/understand-anything-preflight.md`；`harness/monitor-reports/understand-anything-smoke.md`
  - 提交证据：`c12f8966d`
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260526-understand-anything-claude-code-integration.status.json`；`~/.solar/harness/sprints/sprint-20260526-understand-anything-claude-code-integration.task_graph.json`

- [x] **N/A | Tech Hotspot Radar: YouTube Transcript 高质量抓取与 ASR 分层重构**
  - ID：`epic-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/youtube/audio_middleware.py`；`harness/lib/youtube/job_scheduler.py`；`harness/lib/youtube/pollution_repair.py`；`harness/lib/youtube/transcript_storage.py`；`harness/tests/fixtures/pollution_seed.sql`；`harness/tests/test_youtube_audio_middleware.py`；`harness/tests/test_youtube_job_scheduler.py`；`harness/tests/test_youtube_pollution_repair.py`；`harness/tests/test_youtube_transcript_storage.py`
  - 计划代码范围：`harness/backups/youtube`；`harness/docs/youtube-transcript/RELEASE.md`；`harness/lib/tech_hotspot_radar/_youtube_cli_wrapper.py`；`harness/lib/youtube/__init__.py`；`harness/lib/youtube/acquisition_ladder.py`；`harness/lib/youtube/asr_router.py`；`harness/lib/youtube/audio_middleware.py`；`harness/lib/youtube/cli.py`；`harness/lib/youtube/cross_source_extractor.py`；`harness/lib/youtube/dashboard.py`；`harness/lib/youtube/html_render.py`；`harness/lib/youtube/job_scheduler.py`；另 52 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构.status.json`；`~/.solar/harness/sprints/epic-20260526-tech-hotspot-radar-youtube-transcript-高质量抓取与-asr-分层重构.task_graph.json`

- [x] **N/A | sprint-20260527-skill-to-capsule-operator-auto-productization**
  - ID：`sprint-20260527-skill-to-capsule-operator-auto-productization`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260527-skill-to-capsule-operator-auto-productization.status.json`；`~/.solar/harness/sprints/sprint-20260527-skill-to-capsule-operator-auto-productization.task_graph.json`

- [x] **N/A | Understand Anything 全仓知识图后台生成（分阶段、非阻塞）**
  - ID：`sprint-20260527-understand-anything-background-knowledge-graph`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260527-understand-anything-background-knowledge-graph.status.json`；`~/.solar/harness/sprints/sprint-20260527-understand-anything-background-knowledge-graph.task_graph.json`

- [x] **N/A | sprint-20260527-github-hotspot-radar-code-signal-plane-convergence**
  - ID：`sprint-20260527-github-hotspot-radar-code-signal-plane-convergence`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/config/code-signal-plane.yaml`；`harness/docs/architecture/code-signal-plane-migration.md`；`harness/lib/github_intelligence/code_signal/__init__.py`；`harness/lib/github_intelligence/code_signal/assets.py`；`harness/lib/github_intelligence/code_signal/legacy_adapter.py`；`harness/lib/github_intelligence/code_signal/models.py`；`harness/lib/github_intelligence/code_signal/operators/__init__.py`；`harness/lib/github_intelligence/code_signal/operators/discovery.py`；`harness/lib/github_intelligence/code_signal/operators/enrichment.py`；`harness/lib/github_intelligence/code_signal/operators/insight.py`；`harness/lib/github_intelligence/code_signal/operators/knowledge_store.py`；`harness/lib/github_intelligence/code_signal/operators/packet_compiler.py`；另 17 项
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260527-github-hotspot-radar-code-signal-plane-convergence.status.json`；`~/.solar/harness/sprints/sprint-20260527-github-hotspot-radar-code-signal-plane-convergence.task_graph.json`

- [x] **N/A | sprint-20260527-ai-influence-social-signal-plane-convergence**
  - ID：`sprint-20260527-ai-influence-social-signal-plane-convergence`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/config/influence/gate_thresholds.yaml`；`harness/config/influence/seed_accounts.yaml`；`harness/config/influence/source_adapters.yaml`；`harness/lib/influence/__init__.py`；`harness/lib/influence/evidence_packet_compiler.py`；`harness/lib/influence/gates.py`；`harness/lib/influence/insight_compiler.py`；`harness/lib/influence/models.py`；`harness/lib/influence/seed_registry.py`；`harness/lib/influence/statement_collector.py`；`harness/lib/influence/statement_normalizer.py`；`harness/lib/influence/store.py`；另 12 项
  - 计划代码范围：`harness/config/influence`；`harness/lib/influence`；`harness/schemas/influence`；`harness/scripts/influence`；`harness/tests/influence`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260527-ai-influence-social-signal-plane-convergence.status.json`；`~/.solar/harness/sprints/sprint-20260527-ai-influence-social-signal-plane-convergence.task_graph.json`

- [x] **N/A | 对 Solar Harness 正式接入 understand-anything 做一轮 full PRD 发单。目标不是让 Claude 手动执行 /unde**
  - ID：`sprint-20260527-understand-anything-operator-productization`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260527-understand-anything-operator-productization.status.json`；`~/.solar/harness/sprints/sprint-20260527-understand-anything-operator-productization.task_graph.json`；`~/.solar/harness/sprints/sprint-20260527-understand-anything-operator-productization.eval.json`

- [x] **N/A | sprint-20260527-operator-architecture-convergence**
  - ID：`sprint-20260527-operator-architecture-convergence`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/docs/operator-arch-convergence/N1-unified-selector-spec.md`；`harness/docs/operator-arch-convergence/N2-provider-adapter-registry-spec.md`；`harness/docs/operator-arch-convergence/N3-actor-derivation-spec.md`；`harness/docs/operator-arch-convergence/N4-migration-compat-plan.md`
  - 计划代码范围：`harness/docs/operator-arch-convergence/N1-unified-selector-spec.md`；`harness/docs/operator-arch-convergence/N2-provider-adapter-registry-spec.md`；`harness/docs/operator-arch-convergence/N3-actor-derivation-spec.md`；`harness/docs/operator-arch-convergence/N4-migration-compat-plan.md`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260527-operator-architecture-convergence.status.json`；`~/.solar/harness/sprints/sprint-20260527-operator-architecture-convergence.task_graph.json`

- [x] **N/A | 跑通 Gemini Deep Research.我的具体要求是:1)从用户那里或者上游调用\上游算子那里获取问题输入,2**
  - ID：`epic-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/capabilities/gemini_deep_research/compat`；`harness/lib/capabilities/gemini_deep_research/core`；`harness/lib/capabilities/gemini_deep_research/schemas`；`harness/lib/capabilities/gemini_deep_research/tests`；`harness/tests/gemini_deep_research/control`；`harness/tests/gemini_deep_research/e2e`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2.status.json`；`~/.solar/harness/sprints/epic-20260529-跑通-gemini-deep-research-我的具体要求是-1-从用户那里或者上游调用-上游算子那里获取问题输入-2.task_graph.json`

- [x] **N/A | Execution Contract — Webwright Three-Layer Integration in Solar-harness**
  - ID：`sprint-20260530-032545-intent-rawintent-8f1b76d6`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/config/capsules`；`harness/config/logical-operators.json`；`harness/config/physical-operators.json`；`harness/lib/actor_runtime.py`；`harness/lib/webwright_adapter.py`；`harness/solar-harness.sh`；`harness/tests`；`harness/tools/webwright_operator.py`；`skills/browser-automation/setup.json`；`skills/fast-browser-use/SKILL.md`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-032545-intent-rawintent-8f1b76d6.status.json`；`~/.solar/harness/sprints/sprint-20260530-032545-intent-rawintent-8f1b76d6.task_graph.json`

- [x] **N/A | 请使用大咖数据采集算子 (ai_influence_daily.py 和相关的无头抓取流程)，对本周的大咖动态进行一次全面的全量数据采集，提取外链与图片，并生成**
  - ID：`sprint-20260530-224715-intent-ai_influence_daily.py-a29076bc`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260530-224715-intent-ai_influence_daily.py-a29076bc.status.json`

- [x] **N/A | Request**
  - ID：`sprint-20260531-021355-intent-request-b4714c89`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/config/operator_registry.json`；`harness/lib/operator_registry_audit_view.py`；`harness/lib/operator_registry_loader.py`；`harness/templates/html-artifact.visual-template.html`；`harness/tests/test_operator_registry_audit_view.py`；`harness/tools/operator_registry_audit.py`
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-021355-intent-request-b4714c89.status.json`；`~/.solar/harness/sprints/sprint-20260531-021355-intent-request-b4714c89.task_graph.json`

- [x] **N/A | conversation_id: aabbccdd-1122-3344**
  - ID：`sprint-20260531-021356-intent-conversation_id-aabbccdd-112-b4369f9c`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-021356-intent-conversation_id-aabbccdd-112-b4369f9c.status.json`；`~/.solar/harness/sprints/sprint-20260531-021356-intent-conversation_id-aabbccdd-112-b4369f9c.task_graph.json`

- [x] **N/A | conversation_id: b40a3129-4357-4189-a760-2ae49e57d663**
  - ID：`sprint-20260531-021945-intent-conversation_id-b40a3129-435-5a99b902`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-021945-intent-conversation_id-b40a3129-435-5a99b902.status.json`；`~/.solar/harness/sprints/sprint-20260531-021945-intent-conversation_id-b40a3129-435-5a99b902.task_graph.json`

- [x] **N/A | conversation_id: b40a3129-4357-4189-a760-2ae49e57d663**
  - ID：`sprint-20260531-035000-intent-conversation_id-b40a3129-435-45d8707e`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/intent_execution/__init__.py`；`harness/lib/intent_execution/contract.py`；`harness/lib/intent_execution/evidence.py`；`harness/lib/intent_execution/executor.py`
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-035000-intent-conversation_id-b40a3129-435-45d8707e.status.json`；`~/.solar/harness/sprints/sprint-20260531-035000-intent-conversation_id-b40a3129-435-45d8707e.task_graph.json`

- [x] **N/A | planner pool dry run [context] source=codex dryrun=1**
  - ID：`sprint-20260531-122926-intent-entrypoint_metadata-cea4cb99`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/intent_gateway.py`；`harness/lib/intent_gateway.py``；`harness/tests/test_intent_gateway.py`；`harness/tests/test_intent_gateway.py``；`harness/tools/codex_pm_router.py`；`harness/tools/codex_pm_router.py``；`harness/tools/intent_gateway.py`；`harness/tools/intent_gateway.py` (peer copy, kept in sync)`
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-122926-intent-entrypoint_metadata-cea4cb99.status.json`；`~/.solar/harness/sprints/sprint-20260531-122926-intent-entrypoint_metadata-cea4cb99.task_graph.json`

- [x] **N/A | evaluator pool dry run [context] source=codex dryrun=1**
  - ID：`sprint-20260531-122926-intent-entrypoint_metadata-fcec1b55`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-122926-intent-entrypoint_metadata-fcec1b55.status.json`；`~/.solar/harness/sprints/sprint-20260531-122926-intent-entrypoint_metadata-fcec1b55.task_graph.json`

- [x] **N/A | pool smoke [context] manual smoke**
  - ID：`sprint-20260531-123120-intent-entrypoint_metadata-950c677b`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-123120-intent-entrypoint_metadata-950c677b.status.json`；`~/.solar/harness/sprints/sprint-20260531-123120-intent-entrypoint_metadata-950c677b.task_graph.json`

- [x] **N/A | planner pool probe**
  - ID：`sprint-20260531-152547-intent-entrypoint_metadata-f25339ce`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260531-152547-intent-entrypoint_metadata-f25339ce.status.json`；`~/.solar/harness/sprints/sprint-20260531-152547-intent-entrypoint_metadata-f25339ce.task_graph.json`

### 2026-W23 (38)

- [x] **P0 | P0: AI Influence YouTube 报告流质量增强 — Report IR + 逐章写作 + Deep W**
  - ID：`epic-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w`
  - 真值：`warn` · `cancelled/cancelled` · `0%` · 队列 `archived`
  - 实际交付代码：`harness/lib/ai_influence_youtube_report/pane_surface.py`；`harness/lib/ai_influence_youtube_report/status_surface.py`；`harness/scripts/tech_hotspot_radar.py`；`harness/tests/fixtures/ai_influence_report/negative/manifest.json`；`harness/tests/test_ai_influence_youtube_report_negative_controls.py`；`harness/tests/test_ai_influence_youtube_report_status_surface.py`；`harness/tests/test_report_deep_verifier_repair.py`；`harness/tests/test_report_quality_score.py`
  - 计划代码范围：`harness/docs/ai_influence_youtube_report_release_runbook.md`；`harness/scripts/tech_hotspot_radar.py`；`harness/status-server`；`harness/tests`；`harness/tests/fixtures/ai_influence_report/negative`；`harness/tests/fixtures/ai_influence_report/w21`；`harness/tests/fixtures/ai_influence_report/w22`；`harness/tests/test_ai_influence_youtube_report_activation_proof.py`；`harness/tests/test_ai_influence_youtube_report_e2e_w21.py`；`harness/tests/test_ai_influence_youtube_report_e2e_w22.py`；`harness/tests/test_ai_influence_youtube_report_epic_gate_close.py`；`harness/tests/test_ai_influence_youtube_report_negative_controls.py`；另 8 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w.status.json`；`~/.solar/harness/sprints/epic-20260531-p0-ai-influence-youtube-报告流质量增强-report-ir-逐章写作-deep-w.task_graph.json`

- [x] **N/A | 为 sprint-20260606-012005-intent-p0-operator-availability-con-8d584536 读取已编译的 P0 **
  - ID：`sprint-20260606-012045-intent-sprint-20260606-012005-inten-ceead7c7`
  - 真值：`warn` · `superseded/closed` · `0%` · 队列 `archived`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260606-012045-intent-sprint-20260606-012005-inten-ceead7c7.status.json`；`~/.solar/harness/sprints/sprint-20260606-012045-intent-sprint-20260606-012005-inten-ceead7c7.task_graph.json`；`~/.solar/harness/sprints/sprint-20260606-012045-intent-sprint-20260606-012005-inten-ceead7c7.handoff.md`

- [x] **P0 | 需求拆解与追踪矩阵**
  - ID：`sprint-20260604-p0-p1-deepdive-insight-runtime-v2-请读取并执行需求文档-users-lisihao-s01-requirements`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260604-p0-p1-deepdive-insight-runtime-v2-请读取并执行需求文档-users-lisihao-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260604-p0-p1-deepdive-insight-runtime-v2-请读取并执行需求文档-users-lisihao-s01-requirements.task_graph.json`

- [x] **P0 | 架构设计与接口契约**
  - ID：`sprint-20260604-p0-p1-deepdive-insight-runtime-v2-请读取并执行需求文档-users-lisihao-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/research/deepdive_requirement_compiler.py`；`harness/lib/research/profiles/__init__.py`；`harness/lib/research/profiles/cais_agent_insight.yaml`；`harness/lib/research/survey/chief_editor.py`；`harness/lib/research/survey/planner.py`；`harness/lib/research/survey/schemas.py`；`harness/lib/research/survey/section_compiler.py`；`harness/lib/research/survey/source_gap.py`；`harness/lib/research/survey/writing_loop.py`；`harness/tests/research_survey/test_chief_editor.py`；`harness/tests/research_survey/test_deepdive_requirement_compiler.py`；`harness/tests/research_survey/test_planner.py`；另 3 项
  - 计划代码范围：`harness/lib/graph_node_dispatcher.py`；`harness/lib/research/deepdive_requirement_compiler.py`；`harness/lib/research/profiles`；`harness/lib/research/schemas.py`；`harness/lib/research/survey/chief_editor.py`；`harness/lib/research/survey/evaluator.py`；`harness/lib/research/survey/finalize_run.py`；`harness/lib/research/survey/insight_gates.py`；`harness/lib/research/survey/planner.py`；`harness/lib/research/survey/schemas.py`；`harness/lib/research/survey/section_compiler.py`；`harness/lib/research/survey/source_gap.py`；另 12 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260604-p0-p1-deepdive-insight-runtime-v2-请读取并执行需求文档-users-lisihao-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260604-p0-p1-deepdive-insight-runtime-v2-请读取并执行需求文档-users-lisihao-s02-architecture.task_graph.json`

- [x] **P0 | 核心实现与数据模型**
  - ID：`sprint-20260604-p0-p1-deepdive-insight-runtime-v2-请读取并执行需求文档-users-lisihao-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/research`；`harness/lib/research/deepdive_requirement_compiler.py`；`harness/lib/research/profiles/__init__.py`；`harness/lib/research/profiles/cais_agent_insight.yaml`；`harness/lib/research/schemas.py`；`harness/lib/research/survey/conference_signal_extractor.py`；`harness/lib/research/survey/evaluator.py`；`harness/lib/research/survey/evaluator.py` (MODIFIED`；`harness/lib/research/survey/insight_gates.py`；`harness/lib/research/survey/insight_gates.py` (NEW`；`harness/lib/research/survey/prediction_packet_builder.py`；`harness/lib/research/survey/schemas.py`；另 13 项
  - 计划代码范围：`harness/lib/research/deepdive_requirement_compiler.py`；`harness/lib/research/profiles`；`harness/lib/research/schemas.py`；`harness/lib/research/survey/chief_editor.py`；`harness/lib/research/survey/conference_signal_extractor.py`；`harness/lib/research/survey/evaluator.py`；`harness/lib/research/survey/finalize_run.py`；`harness/lib/research/survey/insight_gates.py`；`harness/lib/research/survey/prediction_packet_builder.py`；`harness/lib/research/survey/schemas.py`；`harness/lib/research/survey/section_compiler.py`；`harness/lib/research/survey/solar_absorption_mapper.py`；另 10 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260604-p0-p1-deepdive-insight-runtime-v2-请读取并执行需求文档-users-lisihao-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260604-p0-p1-deepdive-insight-runtime-v2-请读取并执行需求文档-users-lisihao-s03-core-runtime.task_graph.json`

- [x] **P0 | 调度、自动化与可视化**
  - ID：`sprint-20260604-p0-p1-deepdive-insight-runtime-v2-请读取并执行需求文档-users-lisihao-s04-orchestration-ui`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260604-p0-p1-deepdive-insight-runtime-v2-请读取并执行需求文档-users-lisihao-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260604-p0-p1-deepdive-insight-runtime-v2-请读取并执行需求文档-users-lisihao-s04-orchestration-ui.task_graph.json`

- [x] **P0 | 验证、回归与发布证据**
  - ID：`sprint-20260604-p0-p1-deepdive-insight-runtime-v2-请读取并执行需求文档-users-lisihao-s05-verification-release`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/tests/graph/test_deepdive_insight_parent_release_guard.py`；`harness/tests/research_survey/test_deepdive_insight_release_gates.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260604-p0-p1-deepdive-insight-runtime-v2-请读取并执行需求文档-users-lisihao-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260604-p0-p1-deepdive-insight-runtime-v2-请读取并执行需求文档-users-lisihao-s05-verification-release.task_graph.json`

- [x] **P0 | P0 Operator Health Watchdog：请读取并执行需求文档 <Solar>/ · 需求拆解与追踪矩阵**
  - ID：`sprint-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar-s01-requirements`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar-s01-requirements.task_graph.json`

- [x] **P0 | P0 Operator Health Watchdog：请读取并执行需求文档 <Solar>/ · 架构设计与接口契约**
  - ID：`sprint-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar-s02-architecture`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar-s02-architecture.status.json`；`~/.solar/harness/sprints/sprint-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar-s02-architecture.task_graph.json`

- [x] **P0 | P0 Operator Health Watchdog：请读取并执行需求文档 <Solar>/ · 核心实现与数据模型**
  - ID：`sprint-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar-s03-core-runtime`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/operator_health_watchdog.py`；`harness/lib/operator_health_watchdog_graph_adapters.py`；`harness/lib/operator_health_watchdog_lease_adapters.py`；`harness/lib/operator_health_watchdog_operator_adapters.py`；`harness/schemas/operator_health_watchdog_report.schema.json`；`harness/tests/test_operator_health_watchdog.py`；`harness/tests/test_operator_health_watchdog_graph_adapters.py`；`harness/tests/test_operator_health_watchdog_lease_adapters.py`；`harness/tests/test_operator_health_watchdog_operator_adapters.py`；`harness/tests/test_pm_dispatch.py`；`harness/tools/operator_health_watchdog.py`；`harness/tools/pm_dispatch.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar-s03-core-runtime.status.json`；`~/.solar/harness/sprints/sprint-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar-s03-core-runtime.task_graph.json`

- [x] **P0 | P0 Operator Health Watchdog：请读取并执行需求文档 <Solar>/ · 调度、自动化与可视化**
  - ID：`sprint-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar-s04-orchestration-ui`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/scripts/operator-health-watchdog-daemon.sh`；`harness/status-server/routes/orchestration_routes.py`；`harness/status-server/static/orchestration_panel.js`；`harness/status-server/templates/orchestration_panel.html`；`harness/tests/orchestration/test_orchestration_routes.py`；`harness/tests/test_operator_health_watchdog.py`；`harness/tests/test_operator_health_watchdog_cli.py`；`harness/tests/test_operator_health_watchdog_launchagent.py`；`harness/tests/test_operator_health_watchdog_status.py`；`harness/tests/test_pm_dispatch.py`；`harness/tools/operator_health_watchdog.py`；`harness/tools/pm_dispatch.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar-s04-orchestration-ui.status.json`；`~/.solar/harness/sprints/sprint-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar-s04-orchestration-ui.task_graph.json`

- [x] **P0 | P0 Operator Health Watchdog：请读取并执行需求文档 <Solar>/ · 验证、回归与发布证据**
  - ID：`sprint-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar-s05-verification-release`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar-s05-verification-release.status.json`；`~/.solar/harness/sprints/sprint-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar-s05-verification-release.task_graph.json`

- [x] **P0 | 评审 sprint-20260530-p0-修复单-把现有-gepa-stage-1-substrate-升级为-solar-optimizer-的离线元优化-**
  - ID：`sprint-20260605-104732-intent-sprint-20260530-p0-----gepa--c40b9ebb`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260605-104732-intent-sprint-20260530-p0-----gepa--c40b9ebb.status.json`；`~/.solar/harness/sprints/sprint-20260605-104732-intent-sprint-20260530-p0-----gepa--c40b9ebb.task_graph.json`

- [x] **P0 | P0 修复单：ActorHost taxonomy 与 actor-first runtime 落地补齐**
  - ID：`epic-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`docs/migration-physical-operators-to-actor-hosts.md`；`harness/config/actor-hosts.json`；`harness/config/actor-hosts.schema.json`；`harness/config/physical-operators.json`；`harness/config/physical-operators.schema.json`；`harness/tests/runtime/test_compat_mapping.py`；`harness/tests/runtime/test_host_taxonomy.py`
  - 计划代码范围：`docs/migration-physical-operators-to-actor-hosts.md`；`harness/config/actor-hosts.json`；`harness/config/actor-hosts.schema.json`；`harness/config/physical-operators.json`；`harness/config/physical-operators.schema.json`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/graph_scheduler.py`；`harness/lib/multi_task_status.py`；`harness/tests/runtime/test_compat_mapping.py`；`harness/tests/runtime/test_host_taxonomy.py`；`harness/tests/s05-collected-artifacts.json`；`harness/tests/s05-e2e-results.json`；另 14 项
  - 提交证据：`aeeab159`；`d58564c7`
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-actorhost-taxonomy-与-actor-first-runtime-落地补齐.task_graph.json`

- [x] **P0 | P0 修复单：修复 status 页面 /#lab 将运行中 lab panes 误报为 idle 的可见性缺口**
  - ID：`epic-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/symphony/status-server.py`；`harness/reports/sprint-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口-s05-live-activation-proof.md`；`harness/run/_v2_activation_probe/lab-screen-direct.json`；`harness/run/_v2_activation_probe/mismatch-summary.json`；`harness/run/_v2_activation_probe/operator-status-snapshot.json`；`harness/run/_v2_activation_probe/pane-hygiene-snapshot.json`；`harness/run/_v2_activation_probe/pane-leases-snapshot.json`；`harness/scripts/generate_snapshots.py`
  - 计划代码范围：`harness/lib/symphony/status-server.py`；`harness/tests/test-status-server-builder-lab-runtime-truth.py`；`harness/tests/test-status-server-lab-runtime-truth-ui.py`；`harness/tests/test-status-server-lab-verification-release.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-修复-status-页面-lab-将运行中-lab-panes-误报为-idle-的可见性缺口.task_graph.json`

- [x] **P0 | P0 修复单：把验证做成 DAG 强制结构，不允许 writer 自证完成**
  - ID：`epic-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/actor_runtime.py`；`harness/lib/compiled_sprint_review_closeout.py`；`harness/status-server/routes/orchestration_routes.py`；`harness/tests/runtime/test_actor_runtime.py`；`harness/tests/runtime/test_actor_runtime_gate.py`；`harness/tests/test_compiled_sprint_review_closeout.py`；`harness/tests/test_dispatch_evidence.py`；`harness/tests/test_dispatch_scheduler.py`；`harness/tests/test_orchestration_routes.py`；`harness/tests/test_pm_dispatch.py`；`harness/tests/test_status_server_orchestration.py`；`harness/tools/compiled_sprint_review_closeout.py`；另 6 项
  - 计划代码范围：`harness/lib/actor_runtime.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/verification_gate.py`；`harness/schemas/review_decision.schema.json`；`harness/tests/regression/test-triface-graph_node_dispatcher.py`；`harness/tests/runtime/test_actor_runtime.py`；`harness/tests/runtime/test_actor_runtime_gate.py`；`harness/tests/runtime/test_graph_completion_gate.py`；`harness/tests/runtime/test_verification_gate.py`；`harness/tests/test_compiled_sprint_review_closeout.py`；`harness/tests/test_dispatch_scheduler.py`；`harness/tests/test_orchestration_routes.py`；另 9 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-修复单-把验证做成-dag-强制结构-不允许-writer-自证完成.task_graph.json`

- [x] **P0 | P0: 将 5 条 AI Influence 算子固化为 solar-harness 默认接入，并将其余实现降级为 fa**
  - ID：`epic-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/config/operator_registry.json`；`harness/config/operator_schedules.json`；`harness/lib/ai_influence_status_page.py`；`harness/lib/autopilot_operator_dispatcher.py`；`harness/lib/evidence_collector.py`；`harness/lib/metadata_validator.py`；`harness/lib/operator_registry_loader.py`；`harness/lib/operator_router.py`；`harness/lib/operator_router.py` (NEW`；`harness/lib/operator_schedule_binder.py`；`harness/lib/operator_state_machine.py`；`harness/lib/unified_output_adapter.py`；另 19 项
  - 计划代码范围：`harness/config/operator_registry.json`；`harness/config/operator_schedules.json`；`harness/lib/ai_influence_status_page.py`；`harness/lib/autopilot_operator_dispatcher.py`；`harness/lib/evidence_collector.py`；`harness/lib/github_comparison_view.py`；`harness/lib/metadata_validator.py`；`harness/lib/operator_registry_loader.py`；`harness/lib/operator_router.py`；`harness/lib/operator_schedule_binder.py`；`harness/lib/operator_state_machine.py`；`harness/lib/unified_output_adapter.py`；另 18 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa.status.json`；`~/.solar/harness/sprints/epic-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa.task_graph.json`

- [x] **P0 | 请为 solar-harness 开一个新的 P0/P1 架构升级单，主题是：把 task_graph 从现网单文件主读**
  - ID：`epic-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/docs/triface-cutover.md`；`harness/tests/integration/test-epic-close-guard.sh`；`harness/tests/integration/test-triface-ui-live.sh`；`harness/tests/orchestration/test-triface-canary-replay.sh`；`harness/tests/release/test-triface-release-smoke.sh`；`harness/tests/s05-collected-artifacts.triface-cutover.json`；`harness/tests/test-orchestration-cutover-canary.sh`；`harness/tests/test_orchestration_triface_reader.py`；`harness/tools/autopilot.py`；`harness/tools/autopilot.py` (519→766 lines`；`harness/tools/multi_task_status.py`；`harness/tools/multi_task_status.py` (mtime=2026-06-03T20:10:51Z`；另 4 项
  - 计划代码范围：`harness/docs/triface-cutover.md`；`harness/lib/*.py`；`harness/lib/graph_scheduler.py`；`harness/lib/prerequisite_resolver.py`；`harness/tests/**/*.py`；`harness/tests/fixtures/triface-negative`；`harness/tests/integration/test-epic-close-guard.sh`；`harness/tests/integration/test-triface-ui-live.sh`；`harness/tests/negative/test-triface-closeout-incomplete.sh`；`harness/tests/negative/test-triface-concurrent-write.sh`；`harness/tests/negative/test-triface-inline-status-in-spec.sh`；`harness/tests/negative/test-triface-mirror-fallback.sh`；另 21 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读.status.json`；`~/.solar/harness/sprints/epic-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读.task_graph.json`

- [x] **P0 | P0 Operator Health Watchdog：请读取并执行需求文档 <Solar>/**
  - ID：`epic-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：`harness/lib/operator_health_watchdog.py`；`harness/lib/operator_health_watchdog_graph_adapters.py`；`harness/lib/operator_health_watchdog_lease_adapters.py`；`harness/lib/operator_health_watchdog_operator_adapters.py`；`harness/schemas/operator_health_watchdog_report.schema.json`；`harness/scripts/operator-health-watchdog-daemon.sh`；`harness/status-server/routes/orchestration_routes.py`；`harness/status-server/static/orchestration_panel.js`；`harness/status-server/templates/orchestration_panel.html`；`harness/tests/orchestration/test_orchestration_routes.py`；`harness/tests/test_operator_health_watchdog.py`；`harness/tests/test_operator_health_watchdog_cli.py`；另 8 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar.status.json`；`~/.solar/harness/sprints/epic-20260604-p0-operator-health-watchdog-请读取并执行需求文档-users-lisihao-solar.task_graph.json`

- [x] **P0 | P0 架构升级单：Operator Availability Control Plane + TUI Signal Plane**
  - ID：`sprint-20260606-012005-intent-p0-operator-availability-con-8d584536`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib`；`harness/lib/failure_classifier.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/operator_availability/__init__.py`；`harness/lib/operator_availability/failure_classifier.py`；`harness/lib/operator_availability/propagation_gate.py`；`harness/lib/operator_availability/resolver.py`；`harness/lib/operator_flow_control.py`；`harness/lib/operator_runtime.py`；`harness/lib/sidecar_closeout_retry.py`；`harness/lib/sidecar_closeout_retry.py` (NEW`；`harness/tests/test_availability_snapshot.py`；另 13 项
  - 计划代码范围：`harness/docs/operator-availability-control-plane.md`；`harness/lib/failure_classifier.py`；`harness/lib/graph_node_dispatcher.py`；`harness/lib/operator_availability.py`；`harness/lib/operator_flow_control.py`；`harness/lib/operator_runtime.py`；`harness/lib/sidecar_closeout_retry.py`；`harness/lib/tui_signal.py`；`harness/tests/fixtures/tui`；`harness/tests/test_availability_snapshot*.py`；`harness/tests/test_failure_classifier*.py`；`harness/tests/test_graph_node_dispatcher*.py`；另 13 项
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260606-012005-intent-p0-operator-availability-con-8d584536.status.json`；`~/.solar/harness/sprints/sprint-20260606-012005-intent-p0-operator-availability-con-8d584536.task_graph.json`

- [x] **N/A | 为 YouTube Report IR / chapter writing / deep writer / verifier / synthesizer epi**
  - ID：`sprint-20260603-015237-intent-youtube-report-ir-chapter-wr-b957741e`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/docs/ai_influence_youtube_report_release_runbook.md`；`harness/tests/test_ai_influence_youtube_report_negative_controls.py`
  - 计划代码范围：`harness/docs/ai_influence_youtube_report_release_runbook.md`；`harness/tests/fixtures/ai_influence_report/negative`；`harness/tests/fixtures/ai_influence_report/w21`；`harness/tests/fixtures/ai_influence_report/w22`；`harness/tests/test_ai_influence_youtube_report_activation_proof.py`；`harness/tests/test_ai_influence_youtube_report_e2e_w21.py`；`harness/tests/test_ai_influence_youtube_report_e2e_w22.py`；`harness/tests/test_ai_influence_youtube_report_epic_gate_close.py`；`harness/tests/test_ai_influence_youtube_report_negative_controls.py`；`harness/tests/test_report_deep_verifier_repair.py`；`harness/tests/test_report_pipeline_regression.py`；`harness/tests/test_report_quality_score.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260603-015237-intent-youtube-report-ir-chapter-wr-b957741e.status.json`；`~/.solar/harness/sprints/sprint-20260603-015237-intent-youtube-report-ir-chapter-wr-b957741e.task_graph.json`

- [x] **N/A | real chain smoke**
  - ID：`sprint-20260605-051526-intent-real-chain-smoke-4df4ca2d`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260605-051526-intent-real-chain-smoke-4df4ca2d.status.json`；`~/.solar/harness/sprints/sprint-20260605-051526-intent-real-chain-smoke-4df4ca2d.task_graph.json`

- [x] **N/A | watcher smoke**
  - ID：`sprint-20260605-051539-intent-watcher-smoke-50ef825b`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260605-051539-intent-watcher-smoke-50ef825b.status.json`；`~/.solar/harness/sprints/sprint-20260605-051539-intent-watcher-smoke-50ef825b.task_graph.json`

- [x] **N/A | Antigravity Requirement**
  - ID：`sprint-20260605-054847-intent-antigravity-requirement-10150ff6`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260605-054847-intent-antigravity-requirement-10150ff6.status.json`；`~/.solar/harness/sprints/sprint-20260605-054847-intent-antigravity-requirement-10150ff6.task_graph.json`

- [x] **N/A | 评审 sprint-20260531-autopilot-planner-dedupe-dispatcher-operator-pool-compatibili**
  - ID：`sprint-20260605-104732-intent-sprint-20260531-autopilot-pl-43e179f1`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260605-104732-intent-sprint-20260531-autopilot-pl-43e179f1.status.json`；`~/.solar/harness/sprints/sprint-20260605-104732-intent-sprint-20260531-autopilot-pl-43e179f1.task_graph.json`

- [x] **N/A | 执行 S05 V1_vnext_regression：扩展 regression suite 新增 task_graph_io/state_io/contrac**
  - ID：`sprint-20260605-110523-intent-s05-v1_vnext_regression-regr-94ab8cb3`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/tests/regression/test-triface-contract_closure.sh`；`harness/tests/regression/test-triface-graph_node_dispatcher.sh`；`harness/tests/regression/test-triface-graph_scheduler.sh`；`harness/tests/regression/test-triface-multi_task_status.sh`；`harness/tests/regression/test-triface-orchestration_routes.sh`；`harness/tests/regression/test-triface-state_io.sh`；`harness/tests/regression/test-triface-task_graph_io.sh`；`harness/tests/regression/test-triface-workflow_guard.sh`
  - 计划代码范围：`harness/tests/regression/run-vnext-regression-suite.sh`；`harness/tests/regression/test-triface-contract_closure.sh`；`harness/tests/regression/test-triface-graph_node_dispatcher.sh`；`harness/tests/regression/test-triface-graph_scheduler.sh`；`harness/tests/regression/test-triface-multi_task_status.sh`；`harness/tests/regression/test-triface-orchestration_routes.sh`；`harness/tests/regression/test-triface-state_io.sh`；`harness/tests/regression/test-triface-task_graph_io.sh`；`harness/tests/regression/test-triface-workflow_guard.sh`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260605-110523-intent-s05-v1_vnext_regression-regr-94ab8cb3.status.json`；`~/.solar/harness/sprints/sprint-20260605-110523-intent-s05-v1_vnext_regression-regr-94ab8cb3.task_graph.json`

- [x] **N/A | canonical dispatch package replay**
  - ID：`b4-replay-canonical-dispatch-codex`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/graph_node_dispatcher.py`
  - 计划代码范围：`harness/lib/graph_node_dispatcher.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/b4-replay-canonical-dispatch-codex.status.json`；`~/.solar/harness/sprints/b4-replay-canonical-dispatch-codex.task_graph.json`

- [x] **N/A | B4 canonical dispatch rereview replay**
  - ID：`b4-rereview-canonical-dispatch-codex`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/b4-rereview-canonical-dispatch-codex.status.json`；`~/.solar/harness/sprints/b4-rereview-canonical-dispatch-codex.task_graph.json`

- [x] **N/A | cmux 多标签四分屏 tmux 状态监控工作台**
  - ID：`epic-20260531-cmux-多标签四分屏-tmux-状态监控工作台`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/tests/cmux/test_cmux_s05_negative_controls.py`；`harness/tests/cmux/test_cmux_s05_regression.py`
  - 计划代码范围：`harness/config/*.yaml`；`harness/docs/*.md`；`harness/docs/cmux-monitoring-workspace.md`；`harness/scripts/cmux`；`harness/tests/**/*.py`；`harness/tests/cmux/test_cmux_s05_negative_controls.py`；`harness/tests/cmux/test_cmux_s05_regression.py`；`harness/tools/cmux_orch.py`
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/epic-20260531-cmux-多标签四分屏-tmux-状态监控工作台.status.json`；`~/.solar/harness/sprints/epic-20260531-cmux-多标签四分屏-tmux-状态监控工作台.task_graph.json`

- [x] **N/A | 执行 GEPA S04 B4_integration_handoff。严格读取并完成 Graph dispatch file: ~/.**
  - ID：`sprint-20260605-124351-intent-gepa-s04-b4_integration_hand-3accbbdb`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260605-124351-intent-gepa-s04-b4_integration_hand-3accbbdb.status.json`；`~/.solar/harness/sprints/sprint-20260605-124351-intent-gepa-s04-b4_integration_hand-3accbbdb.task_graph.json`

- [x] **N/A | Evaluate graph node N6_verification_suite using the dispatch file at ~**
  - ID：`sprint-20260605-202820-intent-evaluate-graph-node-n6_verif-37330295`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260605-202820-intent-evaluate-graph-node-n6_verif-37330295.status.json`；`~/.solar/harness/sprints/sprint-20260605-202820-intent-evaluate-graph-node-n6_verif-37330295.task_graph.json`

- [x] **N/A | capacity probe deepseek eval fallback**
  - ID：`sprint-20260605-223708-intent-capacity-probe-deepseek-eval-c1f0b9fd`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/tests/test_requirement_compiler_deepseek_fallback.py`
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260605-223708-intent-capacity-probe-deepseek-eval-c1f0b9fd.status.json`；`~/.solar/harness/sprints/sprint-20260605-223708-intent-capacity-probe-deepseek-eval-c1f0b9fd.task_graph.json`

- [x] **N/A | capacity probe gpt55 eval fallback**
  - ID：`sprint-20260605-223708-intent-capacity-probe-gpt55-eval-fa-5772e9c8`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：`harness/lib/graph_node_dispatcher.py`
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260605-223708-intent-capacity-probe-gpt55-eval-fa-5772e9c8.status.json`；`~/.solar/harness/sprints/sprint-20260605-223708-intent-capacity-probe-gpt55-eval-fa-5772e9c8.task_graph.json`

- [x] **N/A | capacity probe for graph-dispatch evaluator via mini-codex-gpt55-medium-builder-**
  - ID：`sprint-20260606-121120-intent-capacity-probe-for-graph-dis-0653c69d`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260606-121120-intent-capacity-probe-for-graph-dis-0653c69d.status.json`；`~/.solar/harness/sprints/sprint-20260606-121120-intent-capacity-probe-for-graph-dis-0653c69d.task_graph.json`

- [x] **N/A | 请读取并执行 ~/.solar/harness/sprints/sprint-20260604-p0-p1-deepdive-insi**
  - ID：`sprint-20260606-121234-intent-users-lisihao-.solar-harness-97cfb614`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260606-121234-intent-users-lisihao-.solar-harness-97cfb614.status.json`

- [x] **N/A | capacity probe for graph-dispatch evaluator via mini-reasonix-deepseek-v4-builde**
  - ID：`sprint-20260606-144423-intent-capacity-probe-for-graph-dis-377c7481`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260606-144423-intent-capacity-probe-for-graph-dis-377c7481.status.json`；`~/.solar/harness/sprints/sprint-20260606-144423-intent-capacity-probe-for-graph-dis-377c7481.task_graph.json`

- [x] **N/A | capacity probe for graph-dispatch evaluator via mini-codex-gpt55-medium-builder-**
  - ID：`sprint-20260606-144423-intent-capacity-probe-for-graph-dis-8047d7a0`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260606-144423-intent-capacity-probe-for-graph-dis-8047d7a0.status.json`；`~/.solar/harness/sprints/sprint-20260606-144423-intent-capacity-probe-for-graph-dis-8047d7a0.task_graph.json`

- [x] **N/A | capacity probe for graph-dispatch evaluator**
  - ID：`sprint-20260606-144423-intent-capacity-probe-for-graph-dis-ee452e9b`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260606-144423-intent-capacity-probe-for-graph-dis-ee452e9b.status.json`；`~/.solar/harness/sprints/sprint-20260606-144423-intent-capacity-probe-for-graph-dis-ee452e9b.task_graph.json`

### 2026-W24 (7)

- [x] **P0 | 需求拆解与追踪矩阵**
  - ID：`sprint-20260609-p0-修复单-harness-稳定性三连修-定时任务复活-告警接线-派发-requeue-s01-requirements`
  - 真值：`warn` · `superseded/superseded_by_manual_fix` · `0%` · 队列 `archived`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260609-p0-修复单-harness-稳定性三连修-定时任务复活-告警接线-派发-requeue-s01-requirements.status.json`；`~/.solar/harness/sprints/sprint-20260609-p0-修复单-harness-稳定性三连修-定时任务复活-告警接线-派发-requeue-s01-requirements.task_graph.json`；`~/.solar/harness/sprints/sprint-20260609-p0-修复单-harness-稳定性三连修-定时任务复活-告警接线-派发-requeue-s01-requirements.handoff.md`

- [x] **P0 | 架构设计与接口契约**
  - ID：`sprint-20260609-p0-修复单-harness-稳定性三连修-定时任务复活-告警接线-派发-requeue-s02-architecture`
  - 真值：`warn` · `superseded/superseded_by_manual_fix` · `0%` · 队列 `archived`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260609-p0-修复单-harness-稳定性三连修-定时任务复活-告警接线-派发-requeue-s02-architecture.status.json`

- [x] **P0 | 核心实现与数据模型**
  - ID：`sprint-20260609-p0-修复单-harness-稳定性三连修-定时任务复活-告警接线-派发-requeue-s03-core-runtime`
  - 真值：`warn` · `superseded/superseded_by_manual_fix` · `0%` · 队列 `archived`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260609-p0-修复单-harness-稳定性三连修-定时任务复活-告警接线-派发-requeue-s03-core-runtime.status.json`

- [x] **P0 | 调度、自动化与可视化**
  - ID：`sprint-20260609-p0-修复单-harness-稳定性三连修-定时任务复活-告警接线-派发-requeue-s04-orchestration-ui`
  - 真值：`warn` · `superseded/superseded_by_manual_fix` · `0%` · 队列 `archived`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260609-p0-修复单-harness-稳定性三连修-定时任务复活-告警接线-派发-requeue-s04-orchestration-ui.status.json`

- [x] **P0 | 验证、回归与发布证据**
  - ID：`sprint-20260609-p0-修复单-harness-稳定性三连修-定时任务复活-告警接线-派发-requeue-s05-verification-release`
  - 真值：`warn` · `superseded/superseded_by_manual_fix` · `0%` · 队列 `archived`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260609-p0-修复单-harness-稳定性三连修-定时任务复活-告警接线-派发-requeue-s05-verification-release.status.json`

- [x] **N/A | capacity probe for graph-dispatch evaluator via mini-reasonix-deepseek-v4-builde**
  - ID：`sprint-20260612-175805-intent-entrypoint_metadata-f316ade1`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：`harness/sprints`
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260612-175805-intent-entrypoint_metadata-f316ade1.status.json`；`~/.solar/harness/sprints/sprint-20260612-175805-intent-entrypoint_metadata-f316ade1.task_graph.json`

- [x] **N/A | Repair B8_handoff after evaluator FAIL. Only modify B8 handoff artifacts within **
  - ID：`sprint-20260613-200227-intent-entrypoint_metadata-d231c04e`
  - 真值：`ok` · `passed/completed` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260613-200227-intent-entrypoint_metadata-d231c04e.status.json`；`~/.solar/harness/sprints/sprint-20260613-200227-intent-entrypoint_metadata-d231c04e.task_graph.json`

### 2026-W27 (1)

- [x] **N/A | import path probe**
  - ID：`sprint-20260630-023515-intent-entrypoint_metadata-a52ef56d`
  - 真值：`ok` · `passed/finalized` · `100%` · 队列 `done`
  - 实际交付代码：N/A
  - 计划代码范围：N/A
  - 提交证据：N/A
  - 侧车证据：`~/.solar/harness/sprints/sprint-20260630-023515-intent-entrypoint_metadata-a52ef56d.status.json`；`~/.solar/harness/sprints/sprint-20260630-023515-intent-entrypoint_metadata-a52ef56d.task_graph.json`

## 维护说明

1. 重新盘点时先运行 `RefreshProgress.py --format json --days <窗口>`，再按 `created_at` 精确截断到 5 月 20 日。
2. 若父状态与 task graph 冲突，保留 `error/reconcile`，不得仅因父状态为 `passed` 就勾选完成。
3. 若 handoff 缺失，`实际交付代码` 保持 `N/A`；只能把 task graph `write_scope` 写进 `计划代码范围`。
4. 运行态侧车位于本机 `~/.solar/harness/sprints/`，未复制进 Git 仓库；本文件只保存其 basename，避免把易漂移运行态当代码真值。
