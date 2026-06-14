# Evidence Ledger Schema Audit

**Document ID**: EVIDENCE_SCHEMA_AUDIT.md
**Sprint**: s03-core-runtime
**Owner**: S03 Builder + Guardian review pending
**Status**: Draft — pending_human_review
**Date**: 2026-06-05

---

## 1. Purpose

This document audits the Solar Harness evidence ledger schema as implemented
in `tools/evidence_ledger.py::EvidenceLedger.write_run_entry()` and maps each
field to the ASI (Agent Scoring Interface) payload structure defined in the
S02 architecture design §6.

---

## 2. Evidence Ledger Source Fields

The following fields are written by `EvidenceLedger.write_run_entry()`:

### 2.1 Core Identity Fields (always written)

| # | Source Field | Type | Required | Description |
|---|-------------|------|----------|-------------|
| 1 | `event_type` | str | Yes | Event type identifier (e.g. "run_dispatched") |
| 2 | `timestamp` | str | Yes | ISO 8601 UTC timestamp |
| 3 | `task_id` | str | Yes | Unique task identifier |
| 4 | `sprint_id` | str | Yes | Sprint identifier |
| 5 | `node_id` | str | Yes | DAG node identifier |
| 6 | `actor_id` | str | Yes | Actor/pane identifier |
| 7 | `logical_operator` | str | Yes | Logical operator name |

### 2.2 Scheduling Field (always written)

| # | Source Field | Type | Required | Description |
|---|-------------|------|----------|-------------|
| 8 | `scheduler_decision` | dict | Yes | Score factors, penalties, rejections |

### 2.3 Per-Node Paths (always written)

| # | Source Field | Type | Required | Description |
|---|-------------|------|----------|-------------|
| 9 | `per_node` | dict | Yes | Snapshot/log/result path refs |

### 2.4 Report Target (always written)

| # | Source Field | Type | Required | Description |
|---|-------------|------|----------|-------------|
| 10 | `final_report_target` | str | Yes | Target path for final report |

### 2.5 Optional Enrichment Fields (conditionally written)

| # | Source Field | Type | Required | Description |
|---|-------------|------|----------|-------------|
| 11 | `dag_ref` | str | No | Reference to DAG YAML |
| 12 | `context_packet_id` | str | No | Context packet identifier |
| 13 | `capability_capsule_id` | str | No | Capability capsule ID |
| 14 | `capsule_kind` | str | No | Type of capsule |
| 15 | `resolved_bindings` | dict | No | Resolved resource bindings |
| 16 | `effect_summary` | dict | No | Effect/impact summary |
| 17 | `guard_results` | list/dict | No | Guard check results |
| 18 | `verification_results` | dict | No | Verification outcomes |
| 19 | `capsule_plan_ir` | dict | No | Capsule plan intermediate rep |
| 20 | `physical_plan_ir` | dict | No | Physical plan intermediate rep |
| 21 | `plan_artifacts` | dict | No | Plan artifacts bundle |

---

## 3. Required Allowlist (11 Fields)

The following 11 fields form the ASI payload completeness denominator.
Each must have a definition or be explicitly marked `<missing>`:

| # | ASI Field | Source Field(s) | Extraction Logic |
|---|-----------|----------------|-----------------|
| 1 | `verifier_decision` | `verification_results` → `.verifier_decision` or `.decision`; fallback `result.status` | String verdict from verifier |
| 2 | `test_log` | `effect_summary` → `{pass, fail, skip, error_codes}` | TestLogSummary dataclass |
| 3 | `benchmark_report` | `guard_results` → `{baseline, current, delta_pct}` | BenchmarkDelta dataclass |
| 4 | `patch_scope` | `capsule_plan_ir` → `{files_touched, lines_added, lines_removed, scope_type}` | PatchScope dataclass |
| 5 | `runtime_sec` | `physical_plan_ir` → `.runtime_sec` or `.walltime_sec`; fallback `result.runtime_sec` | Float seconds |
| 6 | `quota_used` | `resolved_bindings` → `{tokens_used, cost_usd, walltime_sec}` | QuotaUsage dataclass |
| 7 | `failure_mode` | `scheduler_decision` → `.risk_reason` / `.error` / `.status` | FailureMode enum |
| 8 | `operator_trace_summary` | `plan_artifacts` → `.operator_trace` or `.operators` | List[OperatorCall] |
| 9 | `unsupported_claim` | `capability_capsule_id` — contains "unsupported" | bool |
| 10 | `false_benchmark` | `capsule_kind` — contains "false_benchmark" | bool |
| 11 | `safety_violation` | `dag_ref` — contains "safety_violation" | bool |

### Completeness Formula

```
evidence_completeness = (11 - len(missing_evidence)) / 11
```

- All 11 required fields absent → `completeness = 0.0`
- All 11 required fields present → `completeness = 1.0`
- Range: `[0.0, 1.0]` inclusive

---

## 4. Field → ASI Mapping Table

| Evidence Ledger Source | ASI Payload Field | Type | Sentinel |
|----------------------|-------------------|------|----------|
| `verification_results` | `verifier_decision` | `str \| None` | `None` |
| `effect_summary` | `test_log` | `TestLogSummary \| None` | `None` |
| `guard_results` | `benchmark_report` | `BenchmarkDelta \| None` | `None` |
| `capsule_plan_ir` | `patch_scope` | `PatchScope \| None` | `None` |
| `physical_plan_ir` | `runtime_sec` | `float \| None` | `None` |
| `resolved_bindings` | `quota_used` | `QuotaUsage \| None` | `None` |
| `scheduler_decision` | `failure_mode` | `FailureMode` | `FailureMode.NONE` |
| `plan_artifacts` | `operator_trace_summary` | `list[OperatorCall]` | `[]` |
| `capability_capsule_id` | `unsupported_claim` | `bool` | `False` |
| `capsule_kind` | `false_benchmark` | `bool` | `False` |
| `dag_ref` | `safety_violation` | `bool` | `False` |

**Computed fields** (not sourced from ledger):

| ASI Field | Source | Type |
|-----------|--------|------|
| `evidence_completeness` | Derived from 11 required fields | `float ∈ [0.0, 1.0]` |
| `missing_evidence` | Derived from absent required fields | `list[str]` |
| `raw_artifacts` | Original entry dict | `dict` |

---

## 5. Missing Field Handling

When a required source field is absent from the evidence ledger entry:

1. **Typed fields** (`verifier_decision`, `test_log`, `benchmark_report`, `patch_scope`, `runtime_sec`, `quota_used`): Set to `None`
2. **Enum fields** (`failure_mode`): Set to `FailureMode.NONE` when no scheduler data present
3. **List fields** (`operator_trace_summary`): Set to empty list `[]`
4. **Boolean fields** (`unsupported_claim`, `false_benchmark`, `safety_violation`): Set to `False`

All missing required fields are recorded in `AsiPayload.missing_evidence` as a list of field name strings.

The `evidence_completeness` score is reduced proportionally for each missing field.

---

## 6. Unfrozen / In-Progress Items

| Item | Status | Disposition |
|------|--------|-------------|
| `context_packet_id` source field | Not mapped to ASI payload | Not required for completeness; tracked in `raw_artifacts` only |
| `per_node` paths | Not mapped to ASI payload | Infrastructure field; not scored |
| `final_report_target` | Not mapped to ASI payload | Infrastructure field; not scored |
| Extraction heuristics for `unsupported_claim`, `false_benchmark`, `safety_violation` | Placeholder substring matching | S05 verification to validate with real data |
| `guard_results` as list vs dict | Dual extraction supported | Both forms handled in `_extract_benchmark_report` |

---

## 7. Review Log

| Reviewer | Date | Notes |
|----------|------|-------|
| S03 Builder | 2026-06-05 | Initial audit — pending human review |
| pending_human_review | — | Must be reviewed by Guardian / QMR before S05 |

---

*End of EVIDENCE_SCHEMA_AUDIT.md*
