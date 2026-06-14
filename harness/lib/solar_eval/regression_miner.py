"""regression_miner.py — mine historical incidents into eval fixtures.

Reads dispatch_ledger (JSONL via LedgerWriter) and EventLedger (SQLite),
classifies incidents into known failure scenarios, and generates structured
eval cases (YAML/JSON + fixture + expected.json) with source traceability.

Supported scenarios (P1):
  - ack_timeout:          pane ack timed out
  - dispatch_swallowed:   dispatch sent but no state transition recorded
  - patch_scope_violation:write outside declared write_scope
  - evidence_missing:     node completed without evidence entries
  - permission_prompt:    unexpected permission prompt blocked execution
"""
from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml


# ── Enums ────────────────────────────────────────────────────────────────────


class IncidentSource(str, Enum):
    DISPATCH_LEDGER = "dispatch_ledger"
    EVENT_LEDGER = "event_ledger"


class EvalScenario(str, Enum):
    ACK_TIMEOUT = "ack_timeout"
    DISPATCH_SWALLOWED = "dispatch_swallowed"
    PATCH_SCOPE_VIOLATION = "patch_scope_violation"
    # Backward-compatible alias used by older fixture tests and ledgers.
    SCOPE_VIOLATION = "patch_scope_violation"
    EVIDENCE_MISSING = "evidence_missing"
    PERMISSION_PROMPT = "permission_prompt"


# ── Data classes ─────────────────────────────────────────────────────────────


@dataclass
class SourceTrace:
    """Provenance link back to the original incident."""
    source: str  # IncidentSource value
    event_id: Optional[str] = None
    pane_id: Optional[str] = None
    sprint_id: Optional[str] = None
    node_id: Optional[str] = None
    timestamp: Optional[str] = None
    raw_event_summary: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"source": self.source}
        for k in ("event_id", "pane_id", "sprint_id", "node_id",
                   "timestamp", "raw_event_summary"):
            v = getattr(self, k)
            if v is not None:
                d[k] = v
        return d


@dataclass
class FixtureData:
    """Synthetic input that reproduces the incident when replayed."""
    scenario: str
    # Minimal IR layers needed to trigger the failure
    spec_write_scope: Optional[Tuple[str, ...]] = None
    spec_read_scope: Optional[Tuple[str, ...]] = None
    effect_entries: Optional[List[Dict[str, Any]]] = None
    evidence_entries: Optional[List[Dict[str, Any]]] = None
    capsule_outputs: Optional[List[Dict[str, str]]] = None
    capsule_effects_write: Optional[Tuple[str, ...]] = None
    # Incident-specific fields
    pane_id: Optional[str] = None
    action: Optional[str] = None
    before_state: Optional[str] = None
    after_state: Optional[str] = None
    reason: Optional[str] = None
    timeout_seconds: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"scenario": self.scenario}
        for k in ("spec_write_scope", "spec_read_scope", "effect_entries",
                   "evidence_entries", "capsule_outputs", "capsule_effects_write",
                   "pane_id", "action", "before_state", "after_state",
                   "reason", "timeout_seconds"):
            v = getattr(self, k)
            if v is not None:
                if isinstance(v, tuple):
                    v = list(v)
                d[k] = v
        return d


@dataclass
class ExpectedResult:
    """What the eval pipeline should produce for this case."""
    verdict: str  # "pass" or "fail"
    fail_checks: List[str] = field(default_factory=list)
    pass_checks: List[str] = field(default_factory=list)
    violation_patterns: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "verdict": self.verdict,
            "fail_checks": list(self.fail_checks),
            "pass_checks": list(self.pass_checks),
            "violation_patterns": list(self.violation_patterns),
        }


@dataclass
class EvalCase:
    """A single regression eval case mined from a historical incident."""
    case_id: str
    scenario: str
    source: SourceTrace
    fixture: FixtureData
    expected: ExpectedResult
    mined_at: str = ""
    schema_version: str = "v1"

    def __post_init__(self) -> None:
        if not self.mined_at:
            self.mined_at = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "case_id": self.case_id,
            "scenario": self.scenario,
            "source": self.source.to_dict(),
            "fixture": self.fixture.to_dict(),
            "expected": self.expected.to_dict(),
            "mined_at": self.mined_at,
            "schema_version": self.schema_version,
        }

    def to_yaml(self) -> str:
        return yaml.dump(self.to_dict(), default_flow_style=False, allow_unicode=True, sort_keys=False)

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _make_case_id(scenario: str) -> str:
    return f"reg-{scenario}-{uuid.uuid4().hex[:8]}"


# ── Classifiers ──────────────────────────────────────────────────────────────

# Keywords in action/reason fields that map to each scenario.
_ACK_TIMEOUT_KEYWORDS = ("ack_timeout", "ack timed out", "no ack", "timeout waiting for ack")
_DISPATCH_SWALLOWED_KEYWORDS = ("dispatch_swallowed", "no state transition", "dispatch lost", "pane_not_idle")
_SCOPE_VIOLATION_KEYWORDS = ("scope_violation", "write_scope", "out of scope", "patch_scope_violation", "scope violation")
_EVIDENCE_MISSING_KEYWORDS = ("evidence_missing", "no evidence", "missing evidence", "evidence_not_found", "empty evidence")
_PERMISSION_PROMPT_KEYWORDS = ("permission_prompt", "permission denied", "blocked by permission", "user denied")


def classify_incident(action: str, reason: str, extra: Optional[Dict[str, Any]] = None) -> Optional[EvalScenario]:
    """Classify a ledger record into a known eval scenario.

    Returns None if the incident doesn't match any known pattern.
    """
    text = f"{action} {reason}".lower()
    if extra:
        text += " " + json.dumps(extra).lower()

    for kw in _ACK_TIMEOUT_KEYWORDS:
        if kw in text:
            return EvalScenario.ACK_TIMEOUT

    for kw in _DISPATCH_SWALLOWED_KEYWORDS:
        if kw in text:
            return EvalScenario.DISPATCH_SWALLOWED

    for kw in _SCOPE_VIOLATION_KEYWORDS:
        if kw in text:
            return EvalScenario.PATCH_SCOPE_VIOLATION

    for kw in _EVIDENCE_MISSING_KEYWORDS:
        if kw in text:
            return EvalScenario.EVIDENCE_MISSING

    for kw in _PERMISSION_PROMPT_KEYWORDS:
        if kw in text:
            return EvalScenario.PERMISSION_PROMPT

    return None


# ── Fixture builders per scenario ────────────────────────────────────────────


def _fixture_ack_timeout(record: Dict[str, Any]) -> FixtureData:
    return FixtureData(
        scenario=EvalScenario.ACK_TIMEOUT.value,
        pane_id=record.get("pane_id", "unknown"),
        action="dispatch",
        before_state="idle",
        after_state="idle",
        reason="ack_timeout",
        timeout_seconds=record.get("extra", {}).get("timeout_seconds") if isinstance(record.get("extra"), dict) else None,
    )


def _fixture_dispatch_swallowed(record: Dict[str, Any]) -> FixtureData:
    return FixtureData(
        scenario=EvalScenario.DISPATCH_SWALLOWED.value,
        pane_id=record.get("pane_id", "unknown"),
        action="dispatch",
        before_state="idle",
        after_state="idle",
        reason="dispatch_swallowed: no state transition recorded",
    )


def _fixture_scope_violation(record: Dict[str, Any]) -> FixtureData:
    declared_scope = record.get("extra", {}).get("declared_write_scope", ("lib/safe/",))
    actual_write = record.get("extra", {}).get("actual_write", "lib/other/file.py")
    if isinstance(declared_scope, (list, tuple)):
        declared_scope = tuple(declared_scope)
    return FixtureData(
        scenario=EvalScenario.PATCH_SCOPE_VIOLATION.value,
        spec_write_scope=declared_scope,
        capsule_outputs=[{
            "name": "scope_violation_report",
            "description": "Regression fixture for an out-of-scope write",
        }],
        capsule_effects_write=(actual_write,),
        effect_entries=[{
            "effect_id": "e-scope-violation",
            "effect_type": "write",
            "target": actual_write,
            "reversible": True,
            "severity": "error",
        }],
    )


def _fixture_evidence_missing(record: Dict[str, Any]) -> FixtureData:
    return FixtureData(
        scenario=EvalScenario.EVIDENCE_MISSING.value,
        evidence_entries=[],
    )


def _fixture_permission_prompt(record: Dict[str, Any]) -> FixtureData:
    return FixtureData(
        scenario=EvalScenario.PERMISSION_PROMPT.value,
        pane_id=record.get("pane_id", "unknown"),
        action="execute",
        before_state="running",
        after_state="blocked",
        reason="permission_prompt: user denied tool execution",
    )


_FIXTURE_BUILDERS = {
    EvalScenario.ACK_TIMEOUT: _fixture_ack_timeout,
    EvalScenario.DISPATCH_SWALLOWED: _fixture_dispatch_swallowed,
    EvalScenario.PATCH_SCOPE_VIOLATION: _fixture_scope_violation,
    EvalScenario.EVIDENCE_MISSING: _fixture_evidence_missing,
    EvalScenario.PERMISSION_PROMPT: _fixture_permission_prompt,
}

_EXPECTED_RESULTS = {
    EvalScenario.ACK_TIMEOUT: ExpectedResult(
        verdict="fail",
        fail_checks=["evidence_exists"],
        violation_patterns=["ack_timeout", "no evidence"],
    ),
    EvalScenario.DISPATCH_SWALLOWED: ExpectedResult(
        verdict="fail",
        fail_checks=["evidence_exists"],
        violation_patterns=["dispatch_swallowed"],
    ),
    EvalScenario.PATCH_SCOPE_VIOLATION: ExpectedResult(
        verdict="fail",
        fail_checks=["scope_check"],
        violation_patterns=["scope_violation"],
    ),
    EvalScenario.EVIDENCE_MISSING: ExpectedResult(
        verdict="fail",
        fail_checks=["evidence_exists"],
        violation_patterns=["evidence_missing"],
    ),
    EvalScenario.PERMISSION_PROMPT: ExpectedResult(
        verdict="fail",
        fail_checks=["evidence_exists"],
        violation_patterns=["permission_prompt"],
    ),
}


# ── RegressionMiner ──────────────────────────────────────────────────────────


class RegressionMiner:
    """Mine historical incidents from ledger sources into eval cases.

    Usage::

        miner = RegressionMiner()
        cases = miner.mine_from_jsonl("path/to/dispatch-ledger.jsonl")
        cases += miner.mine_from_event_db("path/to/events.db", sprint_id="...")

        for case in cases:
            case.to_yaml()  # or .to_json()
    """

    def mine_from_jsonl(self, jsonl_path: str) -> List[EvalCase]:
        """Read LedgerWriter JSONL and generate eval cases for matching incidents."""
        path = Path(jsonl_path)
        if not path.exists():
            return []

        cases: List[EvalCase] = []
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                case = self._record_to_case(record, IncidentSource.DISPATCH_LEDGER)
                if case is not None:
                    cases.append(case)
        return cases

    def mine_from_event_db(
        self,
        db_path: str,
        *,
        sprint_id: Optional[str] = None,
        event_type_filter: Optional[str] = None,
    ) -> List[EvalCase]:
        """Read EventLedger SQLite and generate eval cases for matching events."""
        import sqlite3

        path = Path(db_path)
        if not path.exists():
            return []

        cases: List[EvalCase] = []
        conn: Optional[sqlite3.Connection] = None
        try:
            conn = sqlite3.connect(str(path))
            conn.row_factory = sqlite3.Row

            query = "SELECT * FROM events WHERE 1=1"
            params: list[Any] = []
            if sprint_id:
                query += " AND sprint_id = ?"
                params.append(sprint_id)
            if event_type_filter:
                query += " AND event_type = ?"
                params.append(event_type_filter)
            query += " ORDER BY created_at"

            rows = conn.execute(query, params).fetchall()
            for row in rows:
                record = dict(row)
                if isinstance(record.get("payload"), str):
                    try:
                        record["payload"] = json.loads(record["payload"])
                    except json.JSONDecodeError:
                        pass
                record["action"] = record.get("event_type", "")
                record["reason"] = record.get("payload", {}).get("reason", "")
                record["extra"] = record.get("payload")
                case = self._record_to_case(record, IncidentSource.EVENT_LEDGER)
                if case is not None:
                    cases.append(case)
        except sqlite3.Error:
            return []
        finally:
            if conn:
                conn.close()
        return cases

    def generate_eval_case(
        self,
        scenario: EvalScenario,
        *,
        source: Optional[SourceTrace] = None,
        record: Optional[Dict[str, Any]] = None,
    ) -> EvalCase:
        """Programmatically create an eval case for a given scenario.

        Useful when you want to explicitly specify the scenario rather than
        relying on classification from a ledger record.
        """
        record = record or {}
        builder = _FIXTURE_BUILDERS[scenario]
        fixture = builder(record)
        expected = _EXPECTED_RESULTS[scenario]

        return EvalCase(
            case_id=_make_case_id(scenario.value),
            scenario=scenario.value,
            source=source or SourceTrace(source="synthetic"),
            fixture=fixture,
            expected=expected,
        )

    def _record_to_case(
        self,
        record: Dict[str, Any],
        incident_source: IncidentSource,
    ) -> Optional[EvalCase]:
        action = record.get("action", "")
        reason = record.get("reason", "")
        extra = record.get("extra")

        scenario = classify_incident(action, reason, extra)
        if scenario is None:
            return None

        source = SourceTrace(
            source=incident_source.value,
            event_id=record.get("event_id"),
            pane_id=record.get("pane_id"),
            sprint_id=record.get("sprint_id"),
            node_id=record.get("node_id"),
            timestamp=record.get("ts") or record.get("created_at"),
            raw_event_summary=f"action={action} reason={reason}"[:200],
        )

        builder = _FIXTURE_BUILDERS[scenario]
        fixture = builder(record)
        expected = _EXPECTED_RESULTS[scenario]

        return EvalCase(
            case_id=_make_case_id(scenario.value),
            scenario=scenario.value,
            source=source,
            fixture=fixture,
            expected=expected,
        )


# ── Fixture writer ───────────────────────────────────────────────────────────


def write_fixtures(
    cases: List[EvalCase],
    output_dir: str,
    *,
    hidden_dir: Optional[str] = None,
) -> List[str]:
    """Write eval cases to output_dir as YAML + fixture JSON + expected JSON.

    Returns list of written file paths.
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    hidden: Optional[Path] = None
    if hidden_dir:
        hidden = Path(hidden_dir)
        hidden.mkdir(parents=True, exist_ok=True)

    written: List[str] = []
    for case in cases:
        base = out / case.case_id
        base.mkdir(parents=True, exist_ok=True)

        # eval_case.yaml (full case)
        yaml_path = base / "eval_case.yaml"
        yaml_path.write_text(case.to_yaml(), encoding="utf-8")
        written.append(str(yaml_path))

        # eval_case.json (full case)
        json_path = base / "eval_case.json"
        json_path.write_text(case.to_json(), encoding="utf-8")
        written.append(str(json_path))

        # fixture.json (input only)
        fixture_path = base / "fixture.json"
        fixture_path.write_text(
            json.dumps(case.fixture.to_dict(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        written.append(str(fixture_path))

        # expected.json (expected output only)
        expected_path = base / "expected.json"
        expected_path.write_text(
            json.dumps(case.expected.to_dict(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        written.append(str(expected_path))

        # hidden copy for blind eval
        if hidden is not None:
            hidden_case = hidden / case.case_id
            hidden_case.mkdir(parents=True, exist_ok=True)
            hidden_expected = hidden_case / "expected.json"
            hidden_expected.write_text(
                json.dumps(case.expected.to_dict(), indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
            written.append(str(hidden_expected))

    return written
