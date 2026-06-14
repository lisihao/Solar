# Solar Harness

## Browser Agent Runtime Bootstrap

Solar Harness does not vendor the local Playwright Node runtime binary at
`harness/python-packages/browser/playwright/driver/node`.

That file is a machine-local browser automation runtime artifact. It can exceed
GitHub's normal 100 MB blob limit and is intentionally excluded from the
repository baseline. When a user runs a browser-agent workflow on a fresh clone,
the browser agent / Playwright bootstrap path should recreate the missing
runtime as part of dependency setup or first browser execution.

If the runtime is missing and a browser-agent command fails before bootstrap,
run the browser-agent setup path used by the workflow, or reinstall the Python
Playwright package in the harness runtime and then rerun the command:

```bash
python3 -m playwright install
```

Do not commit the generated `driver/node` binary after it is recreated.

## DeepDive Insight Runtime v2 Release Checks

S05 verification-release adds a reproducible guard suite for the CAIS Agent
Insight runtime. The suite validates the real DeepDive compiler, insight gates,
activation proof helper, and graph-scheduler parent close guard.

```
┌────────────────────────┬────────┬────────────────────────────────────┐
│ asset                  │ status │ reference                          │
├────────────────────────┼────────┼────────────────────────────────────┤
│ release pytest suite   │ ok     │ test_deepdive_insight_release      │
│ release evidence       │ ok     │ deepdive-insight-runtime-v2-s05    │
│ activation proof CLI   │ ok     │ tools/activation_proof.py          │
│ parent close guard CLI │ ok     │ graph-scheduler parent-check       │
└────────────────────────┴────────┴────────────────────────────────────┘
```

Run the focused release checks:

```bash
python3 -m pytest -q tests/research_survey/test_deepdive_insight_release_gates.py
python3 tools/activation_proof.py --sprint-id sprint-20260604-p0-p1-deepdive-insight-runtime-v2-请读取并执行需求文档-users-lisihao-s05-verification-release --validate
./solar-harness.sh graph-scheduler parent-check --graph sprints/epic-20260604-p0-p1-deepdive-insight-runtime-v2-请读取并执行需求文档-users-lisihao.task_graph.json
```

The parent epic is not release-ready until all child nodes and required release
gates have passed evaluator review.

---

## AI-Influence 5 主线 + Fallback 对照表

> Sprint: `sprint-20260530-p0-将-5-条-ai-influence-算子固化为-solar-harness-默认接入-并将其余实现降级为-fa-s05-verification-release`
> S05 verification-release — 2026-06-05

### 5 主线 (Primary)

| 业务域 | Registry Line | Primary 文件路径 | 输出目录 | 调度频率 |
|--------|--------------|-----------------|---------|---------|
| **X / Twitter Social** | `x_social` | `scripts/ai_influence_daily.py` | `reports/x-social/` | daily |
| **GitHub Trends (新)** | `github` | `scripts/tech_hotspot_radar.py` | `reports/github/` | daily |
| **HF Papers** | `hf_papers` | `scripts/tech_hotspot_radar.py` | `reports/hf-papers/` | daily |
| **Gemini Deep Research** | `gemini_research` | `tools/gemini_deep_research_operator.py` | `reports/gemini/` | on_demand |
| **YouTube Influence** | `youtube` | `scripts/youtube_influence_digest.py` | `reports/youtube/` | daily |

### Fallback / Executor / Legacy

| 类型 | 所属主线 | Fallback/Executor 文件路径 | 角色说明 |
|------|---------|--------------------------|---------|
| Executor (fallback) | X / Twitter Social | `tools/playwright_twitter_scraper.py` | browser 抓取执行器；主线失败时启用 |
| Executor (fallback) | Gemini Deep Research | `scripts/browser_agent_gemini_deep_research_wrapper.py` | browser wrapper；主线失败时启用 |
| Executor (fallback) | YouTube Influence | `scripts/browser_agent_youtube_transcript_wrapper.py` | browser transcript wrapper；主线失败时启用 |
| Legacy Compare | GitHub (legacy) | `tools/github_intelligence/pipeline.py` | `role=legacy_compare`，`is_fallback=true`；仅用于新旧对照展示，不作为 primary |

### 规则约束（S05 固化）

- 所有 Fallback/Executor 文件禁止出现在 primary registry（V2 验证）
- `github_intelligence` 以 `legacy_compare` 角色持续运行，退役计划待制定（见回归报告未闭环节）
- dry-run 调用 fallback/executor 产物 `metadata.kind` 必须为 `executor`，不得为 `final_report`
- 删除或置空任意 primary 时，系统必须显式报错（V6 负控验证）

### 运行验证套件

```bash
# V1: 主线唯一性
python3 -m pytest tests/verification/primary_entries -q \
  --junitxml=reports/s05_verification/v1_primary_entries/junit.xml

# V2: fallback 降级与重复消除
python3 -m pytest tests/verification/fallback_routing -q \
  --junitxml=reports/s05_verification/v2_fallback_routing/junit.xml

# V3: /ai-influence UI 六区块
python3 -m pytest tests/verification/ai_influence_ui -q \
  --junitxml=reports/s05_verification/v3_ai_influence_ui/junit.xml

# V4: GitHub 新旧对照
python3 -m pytest tests/verification/github_compare -q \
  --junitxml=reports/s05_verification/v4_github_compare/junit.xml

# V5: activation-proof 端到端
python3 -m pytest tests/verification/activation_proof -q \
  --junitxml=reports/s05_verification/v5_activation_proof/junit.xml

# V6: negative control
python3 -m pytest tests/verification/negative_control -q \
  --junitxml=reports/s05_verification/v6_negative_control/junit.xml

# 全量回归（V1–V6）
python3 -m pytest tests/verification/ -q
```

回归报告：`reports/s05_verification/regression-report.md`

---

## Task Graph Triface Cutover S05

Sprint: `sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s05-verification-release`

The triface cutover S05 bundle verifies the migration from inline task graph
state toward spec/state/closure evidence. V0-V6 have produced reproducible
evidence, release smoke, closure, and acceptance-verdict artifacts. The
business acceptance verdict is currently `FAIL` because V0 preflight preserved
two upstream truth gaps: S03 phantom closure and S04 G1 traceability staleness.

```
┌────────────────────────────┬────────┬────────────────────────────────────┐
│ artifact                   │ status │ reference                          │
├────────────────────────────┼────────┼────────────────────────────────────┤
│ S05 verification report     │ ok     │ reports/s05-triface-cutover...     │
│ release smoke              │ ok     │ tests/release/test-triface...      │
│ closure.json               │ ok     │ solar.closure.v1                   │
│ acceptance verdict          │ warn   │ verdict=FAIL due upstream gaps     │
│ raw knowledge ingest        │ warn   │ status=blocked                     │
└────────────────────────────┴────────┴────────────────────────────────────┘
```

Primary references:

- `docs/triface-cutover.md`
- `reports/s05-triface-cutover-verification.md`
- `tests/s05-collected-artifacts.triface-cutover.json`
- `sprints/sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s05-verification-release.acceptance-verdict.json`
