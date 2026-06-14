# Operator Availability Control Plane (OACP) + TUI Signal Plane

> **Status:** P0 Architecture Design Doc
> **Sprint:** sprint-20260606-012005-intent-p0-operator-availability-con-8d584536
> **Planner Handoff:** `sprints/sprint-20260606-012005-intent-p0-operator-availability-con-8d584536.S1-planner-handoff.md`
> **Contract:** `sprints/sprint-20260606-012005-intent-p0-operator-availability-con-8d584536.contract.md`
> **Date:** 2026-06-06

---

## 1. Problem Statement

Solar-Harness dispatches work to operator panes (Claude Code, Codex CLI, GLM, etc.). Each consumer — PM Dispatch, GraphDrain, Scheduler, `builder-pool-status`, watchdog, and `operator_runtime` — independently interprets quota, health, TUI text, cooldown, assignment, and closeout state. This causes:

1. **Closeout failures misclassified as quota blocks.** A missing `pm_result` or `handoff` file triggers provider cooldown instead of closeout retry, starving the billing pool.
2. **TUI keyword matches written directly into quota state.** Regex on pane text mutates `physical-operators.json` runtime cooldown without evidence provenance.
3. **Shared billing pool operators incorrectly blocked together.** One operator's closeout failure propagates to sibling operators sharing the same API key.
4. **Conflicting availability decisions.** PM dispatch and `operator_runtime.submit` reach different conclusions about the same operator at the same time.

The OACP establishes a single resolver decision consumed by all schedulers, backed by typed ledgers and a structured TUI Signal Plane.

---

## 2. Architecture Overview

```
                          ┌─────────────────────────────┐
                          │   TUI Signal Plane (S3)     │
                          │  TUICollector → Extractor    │
                          │  → TUISignalLedger (JSONL)   │
                          └──────────┬──────────────────┘
                                     │ TUISignal[]
                          ┌──────────▼──────────────────┐
                          │  FailureClassifier v2 (S2)  │
                          │  classify_signal             │
                          │  classify_closeout           │
                          │  classify_runtime_error      │
                          └──────────┬──────────────────┘
                                     │ FailureClassification
                    ┌────────────────┼────────────────┐
                    │                │                │
         ┌──────────▼──┐  ┌──────────▼──┐  ┌─────────▼───┐
         │ QuotaLedger │  │HealthLedger │  │CloseoutLgdr │
         │ FailureLgdr │  │AssignLedger │  │TUISignalLgdr│
         │ (JSONL)     │  │ (JSONL)     │  │(JSONL)      │
         └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
                │                │                │
                └────────┬───────┘────────────────┘
                         │
              ┌──────────▼──────────────────────┐
              │  OperatorAvailabilityResolver    │
              │  + SharedPoolPropagationGate     │
              │  (S4)                            │
              └──────────┬───────────────────────┘
                         │ AvailabilityDecision
          ┌──────────────┼──────────────────┐
          │              │                  │
  ┌───────▼──────┐ ┌─────▼───────┐ ┌───────▼──────────┐
  │ pm_dispatch  │ │ graph_node  │ │ operator_        │
  │ .is_         │ │ _dispatcher │ │ runtime.submit   │
  │ dispatchable │ │ (S6)        │ │ (S5)             │
  │ (S5)         │ │             │ │                  │
  └──────────────┘ └─────────────┘ └──────────────────┘
          │              │                  │
          └──────┬───────┘──────────────────┘
                 │
        ┌────────▼─────────┐
        │ builder-pool-    │
        │ status (S5)      │
        │ GraphDrain (S6)  │
        │ watchdog (P1)    │
        └──────────────────┘
```

**Data flow:** TUI text → structured signals → typed classifications → append-only ledgers → resolver → single `AvailabilityDecision` consumed by all schedulers.

---

## 3. Interface Contracts

All types below are **frozen** per planner handoff section 2. Builders must not redefine field names, types, or required-ness without a planner amendment.

### 3.1 TUISnapshot — Collector Output

| Field | Type | Description |
|-------|------|-------------|
| `snapshot_id` | `str` (uuid4) | Unique snapshot identifier |
| `captured_at` | `str` (RFC3339) | Capture timestamp UTC |
| `operator_id` | `str` | Physical operator ID |
| `pane` | `str` | tmux pane ID (e.g. `solar-harness:1.3`) |
| `pane_metadata` | `dict` | `{title, current_command, copy_mode, pid}` |
| `bottom_window` | `list[str]` | Last 8–16 lines (high-signal zone) |
| `recent_window` | `list[str]` | Last 80–200 lines (context zone) |
| `dispatch_marker` | `dict \| None` | `{dispatch_id, instruction_file, sprint_id, node_id}` |
| `redacted_sha256` | `str` | SHA-256 of secret-scrubbed full capture |
| `source_tool` | `str` | `claude_code \| codex_cli \| antigravity \| gemini_cli \| unknown` |

**Module:** `harness/lib/tui_signal.py` → `TUICollector.capture_tmux_pane()`

### 3.2 TUISignal — Extractor Output / Ledger Row

| Field | Type | Description |
|-------|------|-------------|
| `signal_id` | `str` (uuid4) | Unique signal ID |
| `snapshot_id` | `str` | Parent snapshot reference |
| `operator_id` | `str` | Physical operator ID |
| `pane` | `str` | tmux pane ID |
| `source` | `Literal` | `tmux_bottom \| tmux_recent \| pane_title \| operator_log_tail \| result_text` |
| `category` | `Literal` | `quota \| auth \| transport \| health \| progress \| prompt \| modal \| closeout` |
| `type` | `str` | e.g. `provider_rate_limit`, `missing_pm_result` |
| `severity` | `Literal` | `info \| warn \| error \| critical` |
| `confidence` | `Literal` | `observed \| inferred \| estimated` |
| `scope_hint` | `Literal` | `operator_id \| task \| dispatch_id \| key_ref \| billing_pool \| provider` |
| `expires_at` | `str \| None` | RFC3339 UTC, `None` = no decay |
| `evidence_excerpt` | `str` | ≤240 chars, redacted |
| `raw_snapshot_ref` | `str` | Path or content-addressed ref |
| `captured_at` | `str` | RFC3339 UTC |

**Module:** `harness/lib/tui_signal.py` → `TUISignalExtractor.extract()`

### 3.3 FailureClassification — Classifier v2 Output

| Field | Type | Description |
|-------|------|-------------|
| `type` | `Literal` (12 types) | `provider_rate_limit`, `provider_auth_expired`, `transport_timeout`, `transport_network`, `health_pane_dirty`, `modal_plan_mode`, `prompt_queued_residue`, `prompt_interrupt_block`, `contract_closeout_missing_pm_result`, `contract_closeout_missing_handoff`, `contract_closeout_missing_eval`, `business_failed` |
| `category` | `Literal` | `quota \| auth \| transport \| health \| modal \| prompt \| closeout \| business` |
| `scope_hint` | `Literal` | Scope of the failure |
| `confidence` | `Literal` | `observed \| inferred \| estimated` |
| `expires_at` | `str \| None` | When this classification expires |
| `propagates_to_billing_pool` | `bool` | Only `True` for observed provider quota/auth |
| `recovery_action` | `Literal` | `wait_decay \| closeout_retry \| builder_repair \| evaluator_retry \| auth_refresh \| manual` |
| `evidence_refs` | `list[str]` | Ledger row IDs |

**Hard rule:** `category in {closeout, business, transport, health, modal, prompt}` ⇒ `propagates_to_billing_pool = False`.

**Module:** `harness/lib/failure_classifier.py` → `FailureClassifier`

### 3.4 AvailabilityDecision — Resolver Output (SINGLE TRUTH)

| Field | Type | Description |
|-------|------|-------------|
| `operator_id` | `str` | Physical operator ID |
| `available` | `bool` | Can accept dispatch |
| `effective_state` | `Literal` (11 states) | `idle \| busy \| dispatched \| running \| quota_blocked \| auth_blocked \| health_blocked \| pane_dirty \| modal_blocked \| closeout_blocked \| unknown` |
| `decision` | `Literal` | `dispatchable \| do_not_dispatch \| deprioritize \| drain_only` |
| `blocks` | `list[Block]` | Operator-local blocks |
| `shared_pool_blocks` | `list[Block]` | Only observed quota/auth blocks |
| `confidence` | `Literal` | Evidence confidence |
| `reason` | `str` | Human-readable, ≤240 chars |
| `evaluated_at` | `str` | RFC3339 UTC |
| `inputs_digest` | `str` | SHA-256 of ledger heads for caching |

**Block sub-type:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | `str` | Mirrors `FailureClassification.type` |
| `scope` | `Literal` | Block scope |
| `expires_at` | `str \| None` | Block expiry |
| `confidence` | `Literal` | Evidence confidence |
| `evidence_ref` | `str` | Ledger row ID |

**Module:** `harness/lib/operator_availability.py` → `OperatorAvailabilityResolver.resolve()`

### 3.5 AvailabilitySnapshot — Aggregate Status API Contract

`AvailabilityDecision` is the scheduler truth for one operator. `AvailabilitySnapshot` is the aggregate read model for status UI, watchdog, builder-pool-status, GraphDrain, and later P1 background refresh. It is frozen here so P0 implementers do not create a second incompatible status shape.

| Field | Type | Description |
|-------|------|-------------|
| `snapshot_id` | `str` | Stable UUID for this aggregate view |
| `generated_at` | `str` | RFC3339 UTC |
| `schema_version` | `Literal["oacp.availability_snapshot.v1"]` | Snapshot schema |
| `source` | `Literal` | `resolver \| watchdog \| status_ui \| builder_pool_status \| graph_drain` |
| `operators` | `dict[str, AvailabilityDecision]` | Per-operator decisions keyed by `operator_id` |
| `billing_pool_blocks` | `dict[str, list[Block]]` | Shared-pool blocks admitted by `SharedPoolPropagationGate` |
| `counts` | `dict[str, int]` | `total`, `available`, `busy`, `quota_blocked`, `auth_blocked`, `health_blocked`, `closeout_blocked`, `unknown` |
| `backlog` | `dict[str, int]` | PM/graph backlog counts as observed by the caller |
| `ledger_heads` | `dict[str, str]` | Content digests or last row IDs for quota/health/closeout/failure/assignment/tui ledgers |
| `warnings` | `list[str]` | Non-blocking degraded-source or legacy-state warnings |
| `generated_by` | `str` | Tool/module that produced the snapshot |

**Hard rules:**

- `AvailabilitySnapshot` may aggregate decisions, but it must not reinterpret raw TUI text, failure strings, or legacy cooldown fields.
- `billing_pool_blocks` may contain only observed quota/auth blocks admitted by `SharedPoolPropagationGate`.
- Status UI and watchdog may render `AvailabilitySnapshot`; schedulers must still dispatch from `AvailabilityDecision.available` / `decision`.

**Module:** `harness/lib/operator_availability.py` → `build_availability_snapshot()` (P1 API, schema frozen in P0)

### 3.6 Public Function Signatures

```python
# harness/lib/tui_signal.py
class TUICollector:
    def capture_tmux_pane(self, pane, operator_id, task_context) -> TUISnapshot: ...

class TUISignalExtractor:
    def extract(self, snapshot: TUISnapshot) -> list[TUISignal]: ...
    def extract_text(self, text, source, context) -> list[TUISignal]: ...

class TUISignalLedger:
    def append(self, signals: list[TUISignal]) -> None: ...
    def head(self, operator_id, *, max_age_seconds=3600) -> list[TUISignal]: ...
```

```python
# harness/lib/failure_classifier.py
class FailureClassifier:
    def classify_signal(self, signal: TUISignal, context) -> FailureClassification | None: ...
    def classify_closeout(self, dispatch_id, missing_artifact, context) -> FailureClassification: ...
    def classify_runtime_error(self, dispatch_id, error, context) -> FailureClassification: ...
```

```python
# harness/lib/operator_availability.py
class OperatorAvailabilityResolver:
    def __init__(self, *, ledgers: LedgerSet, gate: SharedPoolPropagationGate): ...
    def resolve(self, operator_id) -> AvailabilityDecision: ...
    def resolve_pool(self, billing_pool) -> dict[str, AvailabilityDecision]: ...

def build_availability_snapshot(
    decisions: dict[str, AvailabilityDecision],
    *,
    source: str,
    backlog: dict[str, int] | None = None,
    ledger_heads: dict[str, str] | None = None,
) -> AvailabilitySnapshot: ...

class SharedPoolPropagationGate:
    def admit(self, classification: FailureClassification) -> bool: ...
```

```python
# harness/lib/closeout_retry_router.py
class SidecarCloseoutRetryRouter:
    def route(self, classification) -> Literal["closeout_retry", "builder_repair",
                                                "evaluator_retry", "manual"]: ...
```

---

## 4. Ledger Paths & Integration Points

### 4.1 Ledger Storage (JSONL)

All ledgers share the envelope:

```json
{
  "row_id": "uuid4",
  "appended_at": "RFC3339 UTC",
  "schema_version": "oacp.ledger.v1",
  "ledger": "quota|health|closeout|failure|assignment|tui_signal",
  "operator_id": "string",
  "scope": "operator_id|task|dispatch_id|key_ref|billing_pool|provider",
  "confidence": "observed|inferred|estimated",
  "expires_at": "RFC3339 UTC | null",
  "evidence_ref": "string",
  "payload": {}
}
```

### 4.2 Ledger File Paths (Frozen)

| Ledger | Path |
|--------|------|
| Quota | `run/operator-availability/quota-ledger.jsonl` |
| Health | `run/operator-availability/health-ledger.jsonl` |
| Closeout | `run/operator-availability/closeout-ledger.jsonl` |
| Failure | `run/operator-availability/failure-ledger.jsonl` |
| Assignment | `run/operator-availability/assignment-ledger.jsonl` |
| TUI Signal | `run/tui-signals/signals.jsonl` |
| TUI Latest per Op | `run/tui-signals/latest/<operator_id>.json` |

### 4.3 Integration Points by Consumer

| Consumer | Integration | Module (DAG Node) |
|----------|------------|-------------------|
| `pm_dispatch.is_dispatchable()` | Delegates to `OperatorAvailabilityResolver.resolve()` | `harness/tools/pm_dispatch.py` (S5) |
| `builder-pool-status` | Renders resolver/`AvailabilityDecision` output | `harness/tools/pm_dispatch.py` (S5) |
| `graph_node_dispatcher._pane_unavailable_reason()` | Uses TUI snapshot/signal evidence, no direct regex blocks | `harness/lib/graph_node_dispatcher.py` (S6) |
| `operator_flow_control.apply_failure_flow_control()` | Routes classifier results to typed ledgers, no transient cooldown writes to static config | `harness/lib/operator_flow_control.py` (S6) |
| `operator_runtime.submit` | Accepts resolver decision as dispatch truth | `harness/lib/operator_runtime.py` (S5) |
| GraphDrain / watchdog | Same `AvailabilitySnapshot` API (P1, after G_VERIFY) | Future (P1) |

---

## 5. DAG Implementation Plan

### 5.1 Phase Overview

| Batch | Nodes | After | Gate | Parallel |
|-------|-------|-------|------|----------|
| A | S2, S3, S1-doc | S1 passes G_PLAN | G_IMPL | Yes |
| B | S4 | S2 + S3 pass G_IMPL | G_IMPL | No (join) |
| C | S5, S6 | S4 passes G_IMPL | G_IMPL | Yes |
| D | S7 | S5 + S6 pass G_IMPL | G_VERIFY | No |
| E | S8 | S7 passes G_VERIFY | G_REVIEW | No |

### 5.2 Node-to-Module Mapping

| Node | Goal | Anchor Module | Write Scope |
|------|------|---------------|-------------|
| S2 | FailureClassifier v2 + SharedPoolPropagationGate | `harness/lib/failure_classifier.py` | `failure_classifier.py`, `test_failure_classifier.py` |
| S3 | TUI Collector + Extractor + Ledger + 16 golden fixtures | `harness/lib/tui_signal.py` | `tui_signal.py`, `test_tui_signal.py`, `fixtures/tui/*` |
| S1-doc | This design document | `docs/operator-availability-control-plane.md` | This file |
| S4 | OperatorAvailabilityResolver + 5 typed ledgers + TUI signal ledger | `harness/lib/operator_availability.py`, `harness/lib/_oacp_ledger.py` | `operator_availability.py`, `_oacp_ledger.py`, `test_operator_availability.py`, `run/` gitkeeps |
| S5 | Integrate resolver into pm_dispatch, builder-pool-status, operator_runtime.submit | `harness/tools/pm_dispatch.py`, `harness/lib/operator_runtime.py` | `pm_dispatch.py`, `operator_runtime.py`, test files |
| S6 | Integrate resolver into graph_node_dispatcher, operator_flow_control + SidecarCloseoutRetryRouter | `harness/lib/graph_node_dispatcher.py`, `operator_flow_control.py`, `closeout_retry_router.py` | Dispatcher, flow control, closeout router, test files |
| S7 | Golden corpus + integration tests + 10 must-pass acceptance | `harness/tests/test_oacp_*` | Test files, eval sidecar |
| S8 | Live verification on backlog window | Verification report + release probes | `S8-verification.md`, `release-probes/` |

### 5.3 Acceptance Traceability

Each requirement maps to at least one node and at least one validation step:

| Requirement | Owner Nodes | Validation |
|-------------|-------------|------------|
| REQ-000: Unified OACP | S2, S4, S5, S6 | S7 unit + S8 live |
| REQ-001: Closeout ≠ quota | S2, S7 | S7 tests 1–3,6,10 |
| REQ-002: Shared pool propagation gate | S2, S4, S7 | S7 tests 1,2,4 |
| REQ-003: TUI is sensor, not truth | S3, S6 | S7 tests 5,6; S8 live |
| REQ-OACP-A: Pytest coverage | S7 | S7 pytest suite |
| REQ-OACP-B: builder-pool-status correctness | S5, S8 | S8 live probe |
| REQ-OACP-C: Billing pool observed-only | S2, S4, S8 | S7 test 4 + S8 live |
| REQ-OACP-D: GraphDrain drain_submitted accuracy | S6, S8 | S8 live drain probe |
| REQ-OACP-E: No new runtime cooldown writes | S5, S6, S7 | S7 test 10 + S8 grep |

---

## 6. Migration Strategy

### 6.1 Compatibility Lock

**Must remain unchanged:**
- `config/physical-operators.json` schema and existing keys
- Existing PM → Planner → Builder pane-message protocol
- Sprint artifact layout (`*.contract.md`, `*.task_graph.json`, `*.status.json`)
- Eval sidecar contract (`*.eval.md` / `*.eval.json`)
- Existing dispatch envelope under `run/operator-inbox/` and `run/operator-results/`

### 6.2 Behavior-Preserving Migration

1. **`physical-operators.json` runtime cooldown:** Resolver ignores these fields with a deprecation warning. Legacy behavior persists when no ledger evidence exists. Removal scheduled for P1.
2. **`operator_flow_control.apply_failure_flow_control()`:** Public signature unchanged; internals route through classifier → ledger.
3. **`pm_dispatch.is_dispatchable()`:** Return contract preserved (`bool` or `tuple`), now sourced from `AvailabilityDecision.available`.

### 6.3 Stop Conditions (G_REVIEW auto-fail)

- Any code path writes to `physical-operators.json` runtime cooldown after P0-6 ships.
- Any closeout-typed failure causes a `billing_pool`-scoped block.
- Any TUI regex outside `harness/lib/tui_signal.py` produces an availability block.
- Scheduler / GraphDrain / pm_dispatch reads any ledger directly (must go through resolver).
- PM dispatch and `operator_runtime.submit` produce conflicting availability decisions for the same operator at the same dispatch time.
- Expected JSON for golden corpus is missing or unverifiable.

---

## 7. Non-Goals (Verbatim from Contract)

- Do not rewrite all PM, GraphDrain, operator runtime, or watchdog logic in one pass.
- Do not write raw TUI keyword matches directly into `physical-operators.json` or quota guard state.
- Do not use deterministic heuristics to claim provider quota, report success, or evaluator pass.
- Do not change task success truth: handoff, eval sidecar, task_graph/node_results, and status must remain consistent.

---

## 8. Hard Rules (Verbatim from Contract)

1. Missing `pm_result`, `missing handoff`, `missing eval.json`, and `failed_contract_closeout` classify as closeout/failure — **never** quota, **never** shared billing_pool propagation.
2. Claude/Codex/Antigravity TUI text is captured into `TUISignalLedger` with source, confidence, scope, excerpt, snapshot reference, and scrubbed hash before it affects availability.
3. Only observed provider quota/auth evidence from trusted provider/current-dispatch or high-confidence TUI bottom sources can hard-block `billing_pool`/`key_ref`.
4. `physical-operators.json` remains static capability/config truth; it is not used as transient cooldown truth.
5. No token, credential, or raw secret can be persisted in TUI snapshots, excerpts, hashes, fixtures, or PM result artifacts.
6. Runtime paths must use harness config/run-root resolution, not user-specific hardcoded paths or credentials.

---

## 9. Security Requirements

- **Secret scrubbing:** `TUICollector` reuses existing scrub utilities (`harness/lib/*scrub*`). `redacted_sha256` must match scrubbed text only.
- **No secret persistence:** TUI snapshots, excerpts, hashes, and fixtures must not contain tokens or credentials.
- **Path resolution:** All runtime paths use harness config/run-root, never hardcoded user paths.
- **Propagation gate:** `SharedPoolPropagationGate.admit()` returns `False` for non-observed quota/auth, preventing false billing pool blocks.

---

## 10. P1/P2 Scope (Not This Sprint)

### P1 (Next Sprint)
1. `AvailabilitySnapshot` aggregate API for status UI / watchdog / builder-pool-status / GraphDrain.
2. `OperatorStateGarbageCollector` for expired blocks, stale snapshots, legacy cooldown removal.
3. Watchdog backgrounding (auto-collect, auto-refresh, GraphDrain trigger).
4. Status UI surfaces `source / confidence / scope / excerpt / expires_at / recovery_action`.
5. Canary probe for `estimated` calibration (never hard-blocks).

### P2 (Backlog)
1. Provider-specific quota probe adapters.
2. Cross-tool TUI adapters (Codex CLI, Antigravity, Gemini CLI alignment).
3. Ledger compaction + dashboard.
4. Backpressure auto-scaling per operator role.

---

## 11. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|---------|------------|
| Builders bypass resolver, read ledgers directly | High | G_REVIEW grep: `quota-ledger.jsonl` reads outside `operator_availability.py` auto-fail |
| Closeout failure during S5/S6 causes recursive block | Medium | Resolver ignores ledger rows whose `evidence_ref` points to S5/S6 dispatches via allow-list |
| `physical-operators.json` legacy cooldown still drifts | Medium | S5 adds deprecation log + dashboard counter; S7 regression test fails on new writes |
| Snapshot capture leaks secrets | High | `TUICollector` reuses existing scrub; S3 review checks `redacted_sha256` |
| Parallel S5/S6 race on overlapping files | Medium | Write-scope disjoint by file; CI lints diff for cross-file writes |
| Resolver caching staleness during high churn | Low | `inputs_digest` forces re-evaluation when ledger heads change; cache TTL ≤ 2s |

---

## 12. Must-Pass Tests (Owned by S7)

| # | Test | Maps to REQ |
|---|------|-------------|
| 1 | `missing pm_result` → closeout, no quota, no billing_pool propagation | REQ-001 |
| 2 | `missing handoff` → closeout, no sibling-builder impact | REQ-001 |
| 3 | `missing eval.json` → evaluator retry, no provider cooldown | REQ-001 |
| 4 | Claude Code explicit rate limit → observed quota → billing_pool admitted | REQ-002 |
| 5 | Recent scrollback stale limit does NOT override bottom idle prompt | REQ-003 |
| 6 | Queued prompt residue / interrupt prompt → `pane_dirty`, not quota | REQ-003 |
| 7 | PM and `operator_runtime.submit` agree on dispatchability | REQ-000 |
| 8 | builder-pool-status, watchdog, GraphDrain read same `AvailabilityDecision` | REQ-000 |
| 9 | Expired quota block auto-recovers to dispatchable | REQ-000 |
| 10 | `failed_contract_closeout` → CloseoutLedger/FailureLedger only; never runtime cooldown in `physical-operators.json` | REQ-001 |

Golden fixtures: 16 fixtures in `harness/tests/fixtures/tui/`, each paired with sibling `.expected.json`.

---

*End of OACP Design Document*
*Source: S1 Planner Handoff + compiled contract + task graph*
