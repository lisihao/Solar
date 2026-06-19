# deep-insight-solar

`deep-insight-solar` is the GenesisPod experimental strong-model line for the
existing `deep-insight` mission kernel. It now runs the `research-os.v1`
contract: question-driven planning, research asset ledgers, thesis graph
synthesis, evidence-backed report packages, and rubric gates.

It keeps the original 13-step recipe shape and replaces the high-cognition
stages with Solar browser-agent operators:

- `s2-leader-plan` -> `BrowserLeaderPlanner`
- `s3-research` -> `BrowserResearcher`
- `s6-analyst` -> `BrowserAnalyst`
- `s8-writer` -> `BrowserLongformWriter`
- `s9-critic` -> `BrowserCritic`

The original `deep-insight` capability is not modified and remains the A/B
baseline.

## Research OS Contract

The stage bindings use `deep-insight-solar.research-os.v1` as the primary
schema. Legacy `dimensions/findings/sections` are still generated where the
existing orchestrator needs them, but they are compatibility shells rather than
the source of truth.

Required state artifacts:

- `deep-insight-solar.technologyInsightPlan`
- `deep-insight-solar.researchAssetLedger`
- `deep-insight-solar.coverageReport`
- `deep-insight-solar.repairPackets`
- `deep-insight-solar.thesisGraph`
- `deep-insight-solar.reportPackage`
- `deep-insight-solar.insightRubricResult`

The bridge fails closed if real browser-agent output omits the Research OS
shape: `TechnologyInsightPlan`, `ResearchAssetLedger`, `ThesisGraph`, or
`ReportPackage`.

## Solar Bridge

GenesisPod does not import Solar-Harness internals. It calls a subprocess bridge
through `SolarHarnessOperatorPort`.

Local wiring:

```bash
export GENESISPOD_SOLAR_OPERATOR_CMD=python3
export GENESISPOD_SOLAR_OPERATOR_ARGS='["/Users/lisihao/Solar/harness/tools/deep_insight_solar_operator_bridge.py"]'
```

The bridge maps GenesisPod operator requests to existing Solar browser-agent
operators:

- ChatGPT strong-model stages use `harness/tools/chatgpt_browser_agent_task_operator.py`.
- Diagram generation uses `harness/tools/technology_diagram_painter_operator.py`.
- Those operators keep using Solar's FIFO queue, profile policy, and flow control.

If the bridge command is not configured, `deep-insight-solar` fails closed instead
of pretending that the stage succeeded.

## Test Mode

Dry-run mode is only for tests:

```bash
DEEP_INSIGHT_SOLAR_BRIDGE_DRY_RUN=1 python3 /Users/lisihao/Solar/harness/tools/deep_insight_solar_operator_bridge.py
```

Production should leave `DEEP_INSIGHT_SOLAR_BRIDGE_DRY_RUN` unset.
