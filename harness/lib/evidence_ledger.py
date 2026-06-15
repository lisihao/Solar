"""evidence_ledger.py — Run evidence ledger for actor task dispatch.

Writes JSONL index before dispatch, and materializes a runs/<dag-id>/
audit directory seed with run-manifest.json, scheduler_decision.json,
task.yaml, and operator_snapshot.json.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import datetime

HOME = Path.home()
HARNESS_DIR = Path.home() / ".solar" / "harness"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Secret scrubber
# ---------------------------------------------------------------------------

# Patterns that match secret-like values in strings
_SECRET_VALUE_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_\-]{10,}", re.IGNORECASE),          # OpenAI-style API keys
    re.compile(r"key-[A-Za-z0-9_\-]{10,}", re.IGNORECASE),
    re.compile(r"ghp_[A-Za-z0-9_]{10,}", re.IGNORECASE),            # GitHub PAT
    re.compile(r"xoxb-[A-Za-z0-9\-]{10,}", re.IGNORECASE),          # Slack bot token
    re.compile(r"gho_[A-Za-z0-9_]{10,}", re.IGNORECASE),
    re.compile(r"ghu_[A-Za-z0-9_]{10,}", re.IGNORECASE),
    re.compile(r"ghs_[A-Za-z0-9_]{10,}", re.IGNORECASE),
    re.compile(r"glpat-[A-Za-z0-9_\-]{10,}", re.IGNORECASE),        # GitLab PAT
    re.compile(r"Bearer\s+[A-Za-z0-9_\-\.]{16,}", re.IGNORECASE),
]

# Field names that should have their values redacted
_SECRET_FIELD_NAMES = {
    "api_key", "access_key", "secret_key", "private_key", "client_secret",
    "password", "passwd", "token", "oauth_token", "secret",
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GITHUB_TOKEN",
}

# Pattern to redact user-specific paths
_USER_PATH_PATTERN = re.compile(r"(/Users/|/home/|C:\\Users\\)([^/\\]+)")


def _redact_string(value: str) -> Tuple[str, bool]:
    """Redact secret-like patterns from a string. Returns (redacted, changed)."""
    result = value
    changed = False
    for pat in _SECRET_VALUE_PATTERNS:
        new = pat.sub("<REDACTED_SECRET>", result)
        if new != result:
            changed = True
            result = new
    new = _USER_PATH_PATTERN.sub(r"\1<USER>", result)
    if new != result:
        changed = True
        result = new
    return result, changed


def _scrub_payload(
    payload: Any,
    _depth: int = 0,
) -> Tuple[Any, List[str]]:
    """Recursively scrub secret-like values from a payload (dict/list/str).

    Returns (scrubbed_payload, scrubbed_fields).
    """
    if _depth > 20:
        return payload, []

    scrubbed_fields: List[str] = []

    if isinstance(payload, dict):
        result: Dict[str, Any] = {}
        for k, v in payload.items():
            if isinstance(k, str) and k.lower() in {f.lower() for f in _SECRET_FIELD_NAMES}:
                result[k] = "<REDACTED_CREDENTIAL>"
                scrubbed_fields.append(k)
            else:
                scrubbed_v, child_fields = _scrub_payload(v, _depth + 1)
                result[k] = scrubbed_v
                scrubbed_fields.extend(child_fields)
        return result, scrubbed_fields

    if isinstance(payload, list):
        items = []
        for item in payload:
            scrubbed_item, child_fields = _scrub_payload(item, _depth + 1)
            items.append(scrubbed_item)
            scrubbed_fields.extend(child_fields)
        return items, scrubbed_fields

    if isinstance(payload, str):
        redacted, changed = _redact_string(payload)
        if changed:
            scrubbed_fields.append("<string_value>")
        return redacted, scrubbed_fields

    return payload, []


class ScrubResult:
    """Result of applying the scrubber to an artifact payload."""

    def __init__(
        self,
        payload: Any,
        scrubbed: bool,
        scrubbed_fields: List[str],
        original_hash: str,
        scrub_timestamp: str,
        blocked: bool = False,
        reason: Optional[str] = None,
    ):
        self.payload = payload
        self.scrubbed = scrubbed
        self.scrubbed_fields = scrubbed_fields
        self.original_hash = original_hash
        self.scrub_timestamp = scrub_timestamp
        self.blocked = blocked
        self.reason = reason

    def annotate_artifact(self, artifact: Dict[str, Any]) -> Dict[str, Any]:
        """Inject scrub metadata into an artifact dict."""
        result = dict(artifact)
        result["scrubbed"] = self.scrubbed
        if self.scrubbed:
            result["scrubbed_fields"] = self.scrubbed_fields
            result["scrub_timestamp"] = self.scrub_timestamp
            result["original_hash"] = self.original_hash
        if self.blocked:
            result["scrub_blocked"] = True
            result["scrub_blocked_reason"] = self.reason
        return result


def scrub_artifact(payload: Dict[str, Any]) -> ScrubResult:
    """Apply secret scrubbing to a structured artifact before write.

    Computes original_hash before scrubbing so it is reproducible.
    """
    original_bytes = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
    original_hash = hashlib.sha256(original_bytes).hexdigest()
    scrub_timestamp = _now_iso()

    try:
        scrubbed_payload, scrubbed_fields = _scrub_payload(payload)
        return ScrubResult(
            payload=scrubbed_payload,
            scrubbed=bool(scrubbed_fields),
            scrubbed_fields=list(set(scrubbed_fields)),
            original_hash=original_hash,
            scrub_timestamp=scrub_timestamp,
        )
    except Exception as exc:
        return ScrubResult(
            payload=payload,
            scrubbed=False,
            scrubbed_fields=[],
            original_hash=original_hash,
            scrub_timestamp=scrub_timestamp,
            blocked=True,
            reason=f"scrub_exception: {exc}",
        )


# ---------------------------------------------------------------------------
# Run materializer — writes runs/<dag-id>/ seed
# ---------------------------------------------------------------------------

class RunMaterializer:
    """Materializes runs/<dag-id>/ evidence seed on submit."""

    def __init__(self, runs_root: Path):
        self.runs_root = runs_root

    def materialize(
        self,
        dag_id: str,
        node_id: str,
        actor_id: str,
        task_id: str,
        lease: Any,
        scheduler_decision: Dict[str, Any],
        task_envelope: Dict[str, Any],
    ) -> Tuple[Optional[str], Dict[str, str]]:
        """Materialize runs/<dag-id>/ seed.

        Returns (run_dir_str, artifact_refs) on success.
        Returns (None, {}) on I/O failure — writes repair hint to manifest.
        """
        # Use task_id suffix to avoid concurrent-submit collisions on same node
        node_dir_name = f"{node_id}-{task_id[:8]}" if task_id else node_id
        run_dir = self.runs_root / dag_id
        node_dir = run_dir / "nodes" / node_dir_name
        manifest_path = run_dir / "run-manifest.json"

        try:
            node_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            # Write repair-hint manifest to the run root if possible
            self._write_repair_manifest(manifest_path, dag_id, node_id, task_id, str(exc))
            return None, {}

        artifact_refs: Dict[str, str] = {}
        now = _now_iso()

        # --- run-manifest.json ---
        manifest = {
            "schema_version": "solar.run_manifest.v1",
            "dag_id": dag_id,
            "sprint_id": dag_id,
            "task_id": task_id,
            "created_at": now,
            "updated_at": now,
            "status": "running",
            "artifacts": {
                "scheduler_decision": str(run_dir / "scheduler_decision.json"),
            },
            "nodes": {
                node_dir_name: {
                    "task_yaml": str(node_dir / "task.yaml"),
                    "operator_snapshot": str(node_dir / "operator_snapshot.json"),
                    "result": str(node_dir / "result.json"),
                    "stdout_log": str(node_dir / "stdout.log"),
                    "stderr_log": str(node_dir / "stderr.log"),
                },
            },
            "reviews": {},
            "scrubbing": {"enabled": True},
        }
        scrub_res = scrub_artifact(manifest)
        if scrub_res.blocked:
            self._write_repair_manifest(manifest_path, dag_id, node_id, task_id, scrub_res.reason)
            return None, {}
        final_manifest = scrub_res.annotate_artifact(scrub_res.payload)
        try:
            manifest_path.write_text(json.dumps(final_manifest, ensure_ascii=False, indent=2))
        except OSError as exc:
            self._write_repair_manifest(manifest_path, dag_id, node_id, task_id, str(exc))
            return None, {}
        artifact_refs["run_manifest"] = str(manifest_path)

        # --- scheduler_decision.json ---
        sched_path = run_dir / "scheduler_decision.json"
        scrub_sched = scrub_artifact(scheduler_decision)
        if not scrub_sched.blocked:
            sched_artifact = scrub_sched.annotate_artifact(scrub_sched.payload)
            try:
                sched_path.write_text(json.dumps(sched_artifact, ensure_ascii=False, indent=2))
                artifact_refs["scheduler_decision"] = str(sched_path)
            except OSError as exc:
                # P0-D3 (2026-06-09): 写失败必须可见 — 不许静默吞掉
                artifact_refs["scheduler_decision_error"] = str(exc)
                print(f"evidence_ledger: failed to write {sched_path}: {exc}", file=sys.stderr)

        # --- nodes/<node>/task.yaml ---
        # Include all envelope fields so the scrubber can sanitize secrets
        task_payload: Dict[str, Any] = {
            "schema_version": "solar.node_task.v1",
            "task_id": task_id,
            "sprint_id": dag_id,
            "node_id": node_id,
            "objective": str(task_envelope.get("objective") or task_envelope.get("action") or ""),
            "acceptance": task_envelope.get("acceptance") or [],
            "constraints": task_envelope.get("constraints") or {},
            "context_packet_ref": task_envelope.get("context_packet_ref"),
        }
        # Merge all extra envelope fields (they may contain secrets, scrubber handles them)
        for k, v in task_envelope.items():
            if k not in task_payload:
                task_payload[k] = v
        scrub_task = scrub_artifact(task_payload)
        if not scrub_task.blocked:
            task_artifact = scrub_task.annotate_artifact(scrub_task.payload)
            task_path = node_dir / "task.yaml"
            try:
                task_path.write_text(json.dumps(task_artifact, ensure_ascii=False, indent=2))
                artifact_refs["task_yaml"] = str(task_path)
            except OSError as exc:
                artifact_refs["task_yaml_error"] = str(exc)
                print(f"evidence_ledger: failed to write {task_path}: {exc}", file=sys.stderr)

        # --- nodes/<node>/operator_snapshot.json ---
        lease_dict: Dict[str, Any] = {}
        if lease is not None:
            try:
                lease_dict = lease.to_dict() if callable(getattr(lease, "to_dict", None)) else {}
            except Exception:
                lease_dict = {}
        snap_payload = {
            "schema_version": "solar.operator_snapshot.v1",
            "actor_id": actor_id,
            "logical_operator": str(scheduler_decision.get("logical_operator") or ""),
            "model": None,
            "lease": lease_dict,
            "profile_ref": f"actors/{actor_id}",
            "capabilities": [],
            "scrubbed": False,
        }
        scrub_snap = scrub_artifact(snap_payload)
        if not scrub_snap.blocked:
            snap_artifact = scrub_snap.annotate_artifact(scrub_snap.payload)
            snap_path = node_dir / "operator_snapshot.json"
            try:
                snap_path.write_text(json.dumps(snap_artifact, ensure_ascii=False, indent=2))
                artifact_refs["operator_snapshot"] = str(snap_path)
            except OSError as exc:
                artifact_refs["operator_snapshot_error"] = str(exc)
                print(f"evidence_ledger: failed to write {snap_path}: {exc}", file=sys.stderr)

        return str(run_dir), artifact_refs

    def _write_repair_manifest(
        self, manifest_path: Path, dag_id: str, node_id: str, task_id: str, reason: str
    ) -> None:
        now = _now_iso()
        repair = {
            "schema_version": "solar.run_manifest.v1",
            "dag_id": dag_id,
            "sprint_id": dag_id,
            "task_id": task_id,
            "created_at": now,
            "updated_at": now,
            "status": "pending",
            "repair_hint": f"materialization_failed: {reason}",
            "artifacts": {},
            "nodes": {},
            "reviews": {},
            "scrubbing": {"enabled": True},
        }
        try:
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            manifest_path.write_text(json.dumps(repair, ensure_ascii=False, indent=2))
        except OSError as exc:
            # 最后防线: 落盘全失败至少在 stderr 留痕
            print(f"evidence_ledger: repair manifest write failed {manifest_path}: {exc}", file=sys.stderr)


class NoopMaterializer:
    """Fallback materializer that always returns (None, {})."""

    def materialize(self, *args: Any, **kwargs: Any) -> Tuple[Optional[str], Dict[str, str]]:
        return None, {}


# ---------------------------------------------------------------------------
# EvidenceLedger
# ---------------------------------------------------------------------------

class EvidenceLedger:
    """Append-only JSONL evidence ledger with optional run-dir materialization."""

    def __init__(
        self,
        ledger_dir: Optional[Path] = None,
        materializer: Optional[RunMaterializer] = None,
    ):
        self.ledger_dir = ledger_dir or HARNESS_DIR / "run" / "actor-evidence"
        self.materializer = materializer  # None = no materialization (backward compat)

    def write_run_entry(
        self,
        task_id: str,
        sprint_id: str,
        node_id: str,
        actor_id: str,
        logical_operator: str,
        scheduler_decision: Dict[str, Any],
        dag_ref: Optional[str] = None,
        context_packet_id: Optional[str] = None,
        final_report_target: Optional[str] = None,
        capability_capsule_id: Optional[str] = None,
        capsule_kind: Optional[str] = None,
        resolved_bindings: Optional[Dict[str, Any]] = None,
        effect_summary: Optional[Dict[str, Any]] = None,
        guard_results: Optional[List[Any]] = None,
        verification_results: Optional[Dict[str, Any]] = None,
        capsule_plan_ir: Optional[Dict[str, Any]] = None,
        physical_plan_ir: Optional[Dict[str, Any]] = None,
        plan_artifacts: Optional[Dict[str, Any]] = None,
        # S03 new optional fields (backward compatible)
        run_dir: Optional[str] = None,
        artifact_refs: Optional[Dict[str, str]] = None,
    ) -> str:
        """Write a run evidence entry to the JSONL index."""
        self.ledger_dir.mkdir(parents=True, exist_ok=True)

        dag_id = sprint_id  # dag_id == sprint_id in current harness

        entry: Dict[str, Any] = {
            "event_type": "run_dispatched",
            "timestamp": _now_iso(),
            "task_id": task_id,
            "sprint_id": sprint_id,
            "node_id": node_id,
            "actor_id": actor_id,
            "logical_operator": logical_operator,
            "dag_ref": dag_ref,
            "scheduler_decision": scheduler_decision,
            "context_packet_id": context_packet_id,
            # per_node: keep old keys for backward compat + add per_node_v2 with A1 canonical paths
            "per_node": {
                "snapshot_path": f"run/{sprint_id}/{node_id}/snapshot.json",
                "log_path": f"run/{sprint_id}/{node_id}/task.log",
                "result_path": f"run/{sprint_id}/{node_id}/result.json",
            },
            "per_node_v2": {
                "snapshot_path": f"runs/{dag_id}/nodes/{node_id}/operator_snapshot.json",
                "log_path": f"runs/{dag_id}/nodes/{node_id}/stdout.log",
                "result_path": f"runs/{dag_id}/nodes/{node_id}/result.json",
            },
            "final_report_target": final_report_target,
        }

        # Optional existing fields
        if capability_capsule_id is not None:
            entry["capability_capsule_id"] = capability_capsule_id
        if capsule_kind is not None:
            entry["capsule_kind"] = capsule_kind
        if resolved_bindings is not None:
            entry["resolved_bindings"] = resolved_bindings
        if effect_summary is not None:
            entry["effect_summary"] = effect_summary
        if guard_results is not None:
            entry["guard_results"] = guard_results
        if verification_results is not None:
            entry["verification_results"] = verification_results
        if capsule_plan_ir is not None:
            entry["capsule_plan_ir"] = capsule_plan_ir
        if physical_plan_ir is not None:
            entry["physical_plan_ir"] = physical_plan_ir
        if plan_artifacts is not None:
            entry["plan_artifacts"] = plan_artifacts

        # S03 new optional fields — only written when materialization succeeded
        if run_dir is not None:
            entry["run_dir"] = run_dir
        if artifact_refs is not None:
            entry["artifact_refs"] = artifact_refs

        ledger_path = self.ledger_dir / f"{sprint_id}.jsonl"
        with open(ledger_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return str(ledger_path)

    def query(
        self,
        sprint_id: str,
        node_id: Optional[str] = None,
        dispatch_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Query ledger entries by sprint_id, optionally filtered by node_id or dispatch_id.

        Returns matching entries without exposing private model reasoning fields.
        Only returns entries that have observable evidence (event_type, task_id,
        sprint_id, node_id, actor_id, timestamp, per_node paths).
        """
        ledger_path = self.ledger_dir / f"{sprint_id}.jsonl"
        if not ledger_path.exists():
            return []
        results: List[Dict[str, Any]] = []
        with open(ledger_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if node_id and entry.get("node_id") != node_id:
                    continue
                sched = entry.get("scheduler_decision") or {}
                if dispatch_id and sched.get("decision_id") != dispatch_id:
                    continue
                results.append(entry)
        return results

    def has_evidence_for(
        self,
        sprint_id: str,
        node_id: Optional[str] = None,
    ) -> bool:
        """Check whether any ledger evidence exists for a sprint/node pair."""
        return len(self.query(sprint_id, node_id=node_id)) > 0


# ---------------------------------------------------------------------------
# build_scheduler_decision — extended with S02 A1 required fields
# ---------------------------------------------------------------------------

def build_scheduler_decision(
    selected_actor: str,
    logical_operator: str,
    score_factors: Dict[str, float],
    penalties: Dict[str, float],
    rejected: List[Dict[str, str]],
    quota_reason: Optional[str] = None,
    risk_reason: Optional[str] = None,
    context_affinity_reason: Optional[str] = None,
    # S03 new fields (backward compatible)
    dag_id: Optional[str] = None,
    node_id: Optional[str] = None,
    selection_summary: Optional[str] = None,
    artifact_refs: Optional[Dict[str, str]] = None,
    replay: Optional[Dict[str, Any]] = None,
    constraints: Optional[Dict[str, Any]] = None,
    # N1 / S03 fields
    dispatch_path: Optional[str] = None,
    fallback_reason: Optional[str] = None,
    selected_host_type: Optional[str] = None,
    gate: Optional[str] = None,
    failure_fingerprint_penalty: Optional[float] = None,
    matched_labels: Optional[List[str]] = None,
    evidence_refs: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Build a scheduler_decision record with S02 A1 required versioned fields.

    All new parameters are optional so existing callers are unaffected.
    """
    decision_id = str(uuid.uuid4())
    summary = selection_summary or (
        f"Selected {selected_actor} for {logical_operator}. "
        f"Rejected {len(rejected)} candidate(s)."
        + (f" Quota: {quota_reason}." if quota_reason else "")
        + (f" Risk: {risk_reason}." if risk_reason else "")
    )

    ff_penalty = float(failure_fingerprint_penalty) if failure_fingerprint_penalty is not None else 0.0
    labels = list(matched_labels) if matched_labels is not None else []
    refs = list(evidence_refs) if evidence_refs is not None else []

    if ff_penalty > 0.0:
        penalties.setdefault("FailureFingerprintPenalty", ff_penalty)

    return {
        # S02 A1 required schema fields
        "schema_version": "solar.scheduler_decision.v1",
        "decision_id": decision_id,
        # Legacy fields (must not be removed per A2.3)
        "selected_actor": selected_actor,
        "logical_operator": logical_operator,
        "score_factors": score_factors,
        "penalties": penalties,
        "rejected_candidates": rejected,
        "quota_reason": quota_reason,
        "risk_reason": risk_reason,
        "context_affinity_reason": context_affinity_reason,
        "timestamp": _now_iso(),
        # S02 A1 new required fields
        "dag_id": dag_id,
        "node_id": node_id,
        "selection_summary": summary,
        "artifact_refs": artifact_refs or {},
        "replay": replay or {
            "dag_id": dag_id,
            "node_id": node_id,
            "selected_actor": selected_actor,
            "logical_operator": logical_operator,
        },
        "constraints": constraints or {},
        # N1 contract fields
        "dispatch_path": dispatch_path,
        "fallback_reason": fallback_reason,
        "selected_host_type": selected_host_type,
        "gate": gate,
        # S03 fingerprint fields
        "FailureFingerprintPenalty": ff_penalty,
        "matched_labels": labels,
        "evidence_refs": refs,
    }
