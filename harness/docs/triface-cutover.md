# Task Graph Triface Cutover

## Scope

This note tracks the S05 verification-release for moving Solar Harness task
graph execution toward a triface model:

- `task_graph.spec.json` for planned graph shape.
- `task_dag.state.json` for execution truth.
- `closure.json` / `acceptance-verdict.json` for closeout truth.

Current sprint:

`sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s05-verification-release`

## Evidence Map

```
┌──────────────────────────────┬────────┬──────────────────────────────────────────────┐
│ Node                         │ 状态   │ Evidence                                     │
├──────────────────────────────┼────────┼──────────────────────────────────────────────┤
│ V0 preflight                 │ ok     │ preflight.json, upstream-gaps.md             │
│ V1 regression                │ ok     │ reports/s05/regression/*.json                │
│ V2 negative controls         │ ok     │ reports/s05/negative/*.log                   │
│ V3 canary activation         │ ok     │ state/orchestration-cutover-canary/s05       │
│ V4 UI live verdict           │ ok     │ reports/s05/ui-live/*                        │
│ V5 release smoke bundle      │ ok     │ tests/release/test-triface-release-smoke.sh  │
│ V6 closure acceptance        │ warn   │ acceptance-verdict.json verdict=FAIL         │
└──────────────────────────────┴────────┴──────────────────────────────────────────────┘
```

## Release Smoke

Run:

```bash
cd /Users/lisihao/.solar/harness
bash tests/release/test-triface-release-smoke.sh
```

Expected result:

```text
ALL PASS
```

The smoke verifies:

- `tests/s05-collected-artifacts.triface-cutover.json` has schema
  `solar.s05.collected_artifacts.v2` and the current sprint id.
- Two V1 regression cases still pass.
- The V3 canary summary remains replayable.
- `reports/s05-triface-cutover-verification.md` contains V0 through V4
  evidence sections.

## Closure State

Generated artifacts:

- `sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s05-verification-release.closure.json`
- `sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s05-verification-release.task_dag.closure.json`
- `sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s05-verification-release.acceptance-verdict.json`

`closure.json` is schema-valid with `status=pass`, but
`acceptance-verdict.json` is intentionally `FAIL`: V0 preserved two upstream
truth gaps that must not be hidden by S05 verification.

## Blocking Gaps

- S03 has a phantom `task_dag.closure.json`; evaluable truth exists in
  `task_dag.state.json` and eval sidecars.
- S04 G1 traceability is stale in epic traceability, while authoritative graph
  evidence shows the S04 path closed.

Because of those gaps, the knowledge raw artifact for this sprint is marked
`status: blocked`, not `accepted`.
