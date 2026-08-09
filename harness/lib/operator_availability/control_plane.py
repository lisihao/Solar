"""control_plane.py — Operator availability control-plane.

Derives operator availability exclusively from runtime/task/evidence inputs.
No operator availability data is hardcoded here; all state comes from:

  1. config/physical-operators.json      — operator registry (static spec)
  2. run/operator-status/{id}.json        — live runtime state files
  3. run/actor-evidence/                  — actor-level evidence artifacts
  4. config/operator-availability/rules.json — data-driven availability rules

Output: OperatorSignal objects ready for PM/TUI signal views.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", Path.home() / ".solar" / "harness"))
PHYSICAL_OPERATORS_PATH = Path(
    os.environ.get("SOLAR_MULTI_TASK_OPERATORS", HARNESS_DIR / "config" / "physical-operators.json")
)
OPERATOR_STATUS_DIR = HARNESS_DIR / "run" / "operator-status"
ACTOR_EVIDENCE_DIR = HARNESS_DIR / "run" / "actor-evidence"
AVAILABILITY_RULES_PATH = HARNESS_DIR / "config" / "operator-availability" / "rules.json"

# States that make an operator non-dispatchable (from pm_dispatch.py canonical set)
NON_DISPATCHABLE_STATES = frozenset(
    {"leased", "running", "draining", "cooldown", "quota_exhausted", "auth_expired", "disabled"}
)


# ─── Data types ───────────────────────────────────────────────────────────────

@dataclass
class EvidenceEntry:
    """A single piece of evidence that contributed to availability derivation."""
    source: str          # e.g. "runtime_state_file", "flow_control", "actor_evidence"
    key: str             # field name read
    value: Any           # value observed
    path: str = ""       # file path if applicable


@dataclass
class OperatorSignal:
    """Availability signal payload consumable by PM/TUI signal views."""
    operator_id: str
    availability_state: str          # "available" | "cooldown" | "quota_exhausted" | "auth_expired" | "disabled" | "unknown"
    dispatchable: bool
    runtime_state: str               # raw runtime_state from status file
    block_type: Optional[str]        # None if dispatchable
    block_reason: Optional[str]      # human-readable reason
    cooldown_until: Optional[str]    # ISO timestamp if in cooldown
    evidence_chain: List[EvidenceEntry] = field(default_factory=list)
    # Signal metadata for downstream rendering
    model: str = ""
    role: str = ""
    enabled: bool = True
    derived_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["evidence_chain"] = [asdict(e) for e in self.evidence_chain]
        return d

    def to_tui_row(self) -> Dict[str, Any]:
        """Minimal row format for TUI tabular display."""
        return {
            "operator_id": self.operator_id,
            "model": self.model,
            "role": self.role,
            "enabled": self.enabled,
            "runtime_state": self.runtime_state,
            "available": self.dispatchable,
            "availability_state": self.availability_state,
            "block_type": self.block_type or "none",
            "block_reason": self.block_reason or "ok",
            "cooldown_until": self.cooldown_until or "",
            "derived_at": self.derived_at,
        }


# ─── Rules loader ─────────────────────────────────────────────────────────────

def _load_availability_rules() -> Dict[str, Any]:
    """Load data-driven availability rules from config file."""
    if AVAILABILITY_RULES_PATH.exists():
        try:
            return json.loads(AVAILABILITY_RULES_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


# ─── Runtime input readers ────────────────────────────────────────────────────

def _read_operator_registry() -> Dict[str, Dict[str, Any]]:
    """Load operator registry from config/physical-operators.json."""
    if not PHYSICAL_OPERATORS_PATH.exists():
        return {}
    try:
        data = json.loads(PHYSICAL_OPERATORS_PATH.read_text(encoding="utf-8"))
        ops = data.get("operators", {})
        if isinstance(ops, dict):
            return ops
        if isinstance(ops, list):
            return {op.get("id", op.get("operator_id", f"op-{i}")): op for i, op in enumerate(ops)}
    except Exception:
        pass
    return {}


def _read_runtime_state_file(operator_id: str) -> Tuple[str, str, EvidenceEntry | None]:
    """Read operator runtime state from run/operator-status/{id}.json.

    Returns (runtime_state, cooldown_until, evidence_entry).
    """
    status_file = OPERATOR_STATUS_DIR / f"{operator_id}.json"
    if not status_file.exists():
        return "idle", "", None
    try:
        data = json.loads(status_file.read_text(encoding="utf-8"))
        runtime_state = str(data.get("runtime_state", "idle"))
        cooldown_until = str(data.get("cooldown_until") or data.get("expires_at") or "")
        entry = EvidenceEntry(
            source="runtime_state_file",
            key="runtime_state",
            value=runtime_state,
            path=str(status_file),
        )
        return runtime_state, cooldown_until, entry
    except Exception:
        return "idle", "", None


def _read_actor_evidence(operator_id: str) -> List[EvidenceEntry]:
    """Scan actor evidence directory for entries matching this operator."""
    entries: List[EvidenceEntry] = []
    if not ACTOR_EVIDENCE_DIR.exists():
        return entries
    for candidate in ACTOR_EVIDENCE_DIR.iterdir():
        if operator_id not in candidate.name:
            continue
        if candidate.suffix not in {".json", ".jsonl"}:
            continue
        try:
            if candidate.suffix == ".jsonl":
                lines = candidate.read_text(encoding="utf-8").splitlines()
                for line in lines[-5:]:
                    record = json.loads(line)
                    for key in ("runtime_state", "block_state", "availability", "event"):
                        if key in record:
                            entries.append(EvidenceEntry(
                                source="actor_evidence",
                                key=key,
                                value=record[key],
                                path=str(candidate),
                            ))
            else:
                record = json.loads(candidate.read_text(encoding="utf-8"))
                for key in ("runtime_state", "block_state", "availability", "event"):
                    if key in record:
                        entries.append(EvidenceEntry(
                            source="actor_evidence",
                            key=key,
                            value=record[key],
                            path=str(candidate),
                        ))
        except Exception:
            continue
    return entries


def _extract_flow_control_evidence(operator_id: str, spec: Dict[str, Any]) -> Tuple[Optional[str], Optional[str], List[EvidenceEntry]]:
    """Extract block type and reason from flow_control field in operator spec."""
    flow = spec.get("flow_control") or {}
    if not isinstance(flow, dict):
        return None, None, []

    evidence: List[EvidenceEntry] = []
    block_state = flow.get("last_block_state") or ""
    block_reason = flow.get("last_block_reason") or ""
    expires_at = flow.get("last_block_expires_at") or ""

    # Only report block if not yet expired
    if block_state and expires_at:
        try:
            exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            if exp <= now:
                # Block has expired — prune it from consideration
                return None, None, []
        except Exception:
            pass

    if block_state:
        evidence.append(EvidenceEntry(
            source="flow_control",
            key="last_block_state",
            value=block_state,
            path=str(PHYSICAL_OPERATORS_PATH),
        ))
    if block_reason:
        evidence.append(EvidenceEntry(
            source="flow_control",
            key="last_block_reason",
            value=block_reason,
            path=str(PHYSICAL_OPERATORS_PATH),
        ))

    return block_state or None, block_reason or None, evidence


def _classify_availability_state(
    enabled: bool,
    runtime_state: str,
    flow_block_state: Optional[str],
    rules: Dict[str, Any],
) -> str:
    """Classify availability state using data-driven rules.

    State priority (highest to lowest):
      disabled → quota_exhausted → auth_expired → cooldown → running → available
    """
    if not enabled:
        return "disabled"

    # Check runtime_state against NON_DISPATCHABLE_STATES
    if runtime_state in NON_DISPATCHABLE_STATES:
        # Map to canonical availability state
        state_map = rules.get("runtime_state_to_availability", {})
        if runtime_state in state_map:
            return state_map[runtime_state]
        # Default canonical mapping
        if runtime_state == "quota_exhausted":
            return "quota_exhausted"
        if runtime_state == "auth_expired":
            return "auth_expired"
        if runtime_state in {"cooldown", "draining"}:
            return "cooldown"
        if runtime_state in {"leased", "running"}:
            return "busy"
        if runtime_state == "disabled":
            return "disabled"
        return runtime_state

    # Check flow_control block state
    if flow_block_state:
        block_map = rules.get("flow_block_to_availability", {})
        if flow_block_state in block_map:
            return block_map[flow_block_state]
        if "quota" in flow_block_state or "rate_limit" in flow_block_state:
            return "quota_exhausted"
        if "auth" in flow_block_state:
            return "auth_expired"
        if "cooldown" in flow_block_state:
            return "cooldown"

    return "available"


# ─── Core control-plane ───────────────────────────────────────────────────────

class OperatorAvailabilityControlPlane:
    """Derives operator availability from runtime/task/evidence inputs.

    No availability state is hardcoded. All state is read from:
    - Physical operator registry (static spec + embedded state)
    - Runtime status files (live runtime_state)
    - Actor evidence artifacts (historical signals)
    - Availability rules config (data-driven classification)
    """

    def __init__(
        self,
        harness_dir: Optional[Path] = None,
        operators_path: Optional[Path] = None,
        status_dir: Optional[Path] = None,
        evidence_dir: Optional[Path] = None,
        rules_path: Optional[Path] = None,
    ) -> None:
        self._harness_dir = harness_dir or HARNESS_DIR
        self._operators_path = operators_path or PHYSICAL_OPERATORS_PATH
        self._status_dir = status_dir or OPERATOR_STATUS_DIR
        self._evidence_dir = evidence_dir or ACTOR_EVIDENCE_DIR
        self._rules_path = rules_path or AVAILABILITY_RULES_PATH
        self._rules: Dict[str, Any] = {}
        self._registry: Dict[str, Dict[str, Any]] = {}
        self._loaded = False

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        self._rules = _load_availability_rules()
        self._registry = _read_operator_registry()
        self._loaded = True

    def derive_one(self, operator_id: str) -> OperatorSignal:
        """Derive availability signal for a single operator from runtime inputs."""
        self._ensure_loaded()
        spec = self._registry.get(operator_id, {})
        evidence_chain: List[EvidenceEntry] = []

        # Input 1: enabled flag from registry
        enabled = bool(spec.get("enabled", True))

        # Input 2: model / role metadata
        model = str(spec.get("model", ""))
        role = str(spec.get("role", spec.get("profile", "")))

        # Input 3: runtime state file (live input)
        runtime_state, cooldown_until, rt_evidence = _read_runtime_state_file(operator_id)
        if rt_evidence:
            evidence_chain.append(rt_evidence)

        # If no runtime state file, fall back to embedded state in registry
        if runtime_state == "idle" and not rt_evidence:
            embedded_state = spec.get("state") or {}
            if isinstance(embedded_state, dict):
                runtime_state = str(embedded_state.get("runtime_state", "idle"))
                cooldown_until = str(embedded_state.get("cooldown_until") or "")
                evidence_chain.append(EvidenceEntry(
                    source="registry_embedded_state",
                    key="runtime_state",
                    value=runtime_state,
                    path=str(self._operators_path),
                ))

        # Input 4: flow_control block signals from registry
        flow_block_state, flow_block_reason, flow_evidence = _extract_flow_control_evidence(
            operator_id, spec
        )
        evidence_chain.extend(flow_evidence)

        # Input 5: actor evidence artifacts
        actor_evidence = _read_actor_evidence(operator_id)
        evidence_chain.extend(actor_evidence)

        # Classify availability using data-driven rules
        availability_state = _classify_availability_state(
            enabled, runtime_state, flow_block_state, self._rules
        )
        dispatchable = availability_state == "available"

        # Derive block_type for signal view
        block_type: Optional[str] = None
        block_reason: Optional[str] = None
        if not dispatchable:
            block_type = availability_state if availability_state != "available" else None
            block_reason = flow_block_reason or (f"runtime_state={runtime_state}" if runtime_state != "idle" else None)

        return OperatorSignal(
            operator_id=operator_id,
            availability_state=availability_state,
            dispatchable=dispatchable,
            runtime_state=runtime_state,
            block_type=block_type,
            block_reason=block_reason,
            cooldown_until=cooldown_until or None,
            evidence_chain=evidence_chain,
            model=model,
            role=role,
            enabled=enabled,
        )

    def derive_all(self, role_filter: Optional[str] = None) -> List[OperatorSignal]:
        """Derive availability signals for all registered operators.

        Args:
            role_filter: if set, only return operators whose role matches.
        """
        self._ensure_loaded()
        signals: List[OperatorSignal] = []
        for operator_id in self._registry:
            spec = self._registry[operator_id]
            if role_filter:
                op_role = str(spec.get("role", spec.get("profile", "")))
                if op_role != role_filter:
                    continue
            signals.append(self.derive_one(operator_id))
        return signals

    def snapshot(self, role_filter: Optional[str] = None) -> Dict[str, Any]:
        """Return a full control-plane snapshot consumable by PM/TUI signal views."""
        self._ensure_loaded()
        signals = self.derive_all(role_filter=role_filter)
        rows = [s.to_tui_row() for s in signals]

        total = len(rows)
        available_count = sum(1 for s in signals if s.dispatchable)
        blocked_count = total - available_count
        block_type_counts: Dict[str, int] = {}
        for s in signals:
            if s.block_type:
                block_type_counts[s.block_type] = block_type_counts.get(s.block_type, 0) + 1

        return {
            "schema": "solar.operator_availability.control_plane.v1",
            "derived_at": datetime.now(timezone.utc).isoformat(),
            "summary": {
                "total": total,
                "available": available_count,
                "blocked": blocked_count,
                "available_ratio": round(available_count / total, 3) if total else 0.0,
                "block_type_counts": block_type_counts,
            },
            "operators": rows,
            "evidence_sources": [
                str(self._operators_path),
                str(self._status_dir),
                str(self._evidence_dir),
                str(self._rules_path),
            ],
        }


# ─── Module-level convenience functions ───────────────────────────────────────

_default_plane: Optional[OperatorAvailabilityControlPlane] = None


def _get_default_plane() -> OperatorAvailabilityControlPlane:
    global _default_plane
    if _default_plane is None:
        _default_plane = OperatorAvailabilityControlPlane()
    return _default_plane


def derive_all(role_filter: Optional[str] = None) -> List[OperatorSignal]:
    """Derive availability signals for all operators (module-level convenience)."""
    return _get_default_plane().derive_all(role_filter=role_filter)


def derive_one(operator_id: str) -> OperatorSignal:
    """Derive availability signal for a single operator (module-level convenience)."""
    return _get_default_plane().derive_one(operator_id)


def snapshot(role_filter: Optional[str] = None) -> Dict[str, Any]:
    """Return full control-plane snapshot for PM/TUI consumption."""
    return _get_default_plane().snapshot(role_filter=role_filter)
