#!/usr/bin/env python3
"""Mandatory post-result completion pipeline for Solar-Harness nodes."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", Path.home() / ".solar" / "harness"))
SPRINTS_DIR = Path(os.environ.get("HARNESS_SPRINTS_DIR", HARNESS_DIR / "sprints"))
RUNS_DIR = Path(os.environ.get("SOLAR_RUNS_DIR", HARNESS_DIR / "runs"))
TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from session_log import DuplicateEventError, SessionLog  # type: ignore  # noqa: E402

from gate_controller import completion_payload, verdict_passed  # noqa: E402
from post_result_verifier import verify_operator_result  # noqa: E402


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def stable_id(*parts: Any) -> str:
    raw = "|".join(str(part or "") for part in parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


@dataclass
class OperatorResult:
    session_id: str
    node_id: str
    attempt_id: str = "attempt-1"
    result_id: str = ""
    artifact_manifest: str = ""
    handoff_path: str = ""
    eval_path: str = ""
    write_scope: list[str] = field(default_factory=list)
    exit_code: int | None = None
    operator_status: str = "done"
    run_dir: str = ""
    graph_path: str = ""

    def normalized(self) -> dict[str, Any]:
        result_id = self.result_id or f"result_{self.node_id}_{self.attempt_id}_{stable_id(self.handoff_path, self.eval_path)}"
        run_dir = self.run_dir or str(RUNS_DIR / self.session_id / self.node_id)
        return {
            "session_id": self.session_id,
            "node_id": self.node_id,
            "attempt_id": self.attempt_id,
            "result_id": result_id,
            "artifact_manifest": self.artifact_manifest,
            "handoff_path": self.handoff_path,
            "eval_path": self.eval_path,
            "write_scope": self.write_scope,
            "exit_code": self.exit_code,
            "operator_status": self.operator_status,
            "run_dir": run_dir,
            "graph_path": self.graph_path,
            "submitted_at": utc_now(),
        }


def _append(log: SessionLog, event_type: str, *, actor: str, payload: dict[str, Any], activity_id: str, writer_role: str) -> str:
    idem = f"{event_type}:{payload.get('result_id') or payload.get('verdict_id') or activity_id}:{writer_role}"
    try:
        return log.append(
            event_type,
            actor=actor,
            source="completion_pipeline",
            sprint_id=str(payload.get("session_id") or log.session_id),
            activity_id=activity_id,
            idempotency_key=idem,
            payload=payload,
            writer_role=writer_role,
        )
    except DuplicateEventError:
        return "duplicate"


class CompletionPipeline:
    """Submit an operator result and finalize only after post-result verifier pass."""

    def __init__(self, *, harness_dir: str | Path | None = None) -> None:
        self.harness_dir = Path(harness_dir or HARNESS_DIR)

    def submit_result(self, result: OperatorResult | dict[str, Any]) -> dict[str, Any]:
        if isinstance(result, OperatorResult):
            payload = result.normalized()
        else:
            payload = OperatorResult(**{k: v for k, v in result.items() if k in OperatorResult.__dataclass_fields__}).normalized()

        session_id = str(payload["session_id"])
        node_id = str(payload["node_id"])
        log = SessionLog(session_id, harness_dir=str(self.harness_dir))
        verifier_dir = Path(str(payload.get("run_dir") or RUNS_DIR / session_id / node_id)) / "verifier"

        submitted_event_id = _append(
            log,
            "node.result_submitted",
            actor="operator_runtime",
            payload=payload,
            activity_id=node_id,
            writer_role="operator_runtime",
        )
        _append(
            log,
            "verifier.run.started",
            actor="verifier_runtime",
            payload={**payload, "trigger": "post_result"},
            activity_id=node_id,
            writer_role="verifier_runtime",
        )
        verdict = verify_operator_result(payload, verifier_dir)
        verdict["covered_result_event_id"] = submitted_event_id
        _append(
            log,
            "verifier.gate.verdict",
            actor="verifier_runtime",
            payload=verdict,
            activity_id=node_id,
            writer_role="verifier_runtime",
        )

        if not verdict_passed(verdict):
            blocked_payload = {
                "reason": "post_result_verifier_failed",
                "failed_rules": [rule["id"] for rule in verdict.get("rules", []) if rule.get("status") != "passed" and rule.get("severity") == "blocker"],
                "verifier_verdict_id": verdict.get("verdict_id"),
                "covered_result_id": verdict.get("covered_result_id"),
            }
            _append(
                log,
                "node.blocked",
                actor="gate_controller",
                payload={**payload, **blocked_payload},
                activity_id=node_id,
                writer_role="gate_controller",
            )
            return {"status": "blocked_by_verifier", "result": payload, "verdict": verdict, "completion": blocked_payload}

        completed_payload = {**payload, **completion_payload(verdict)}
        completed_event_id = _append(
            log,
            "node.completed",
            actor="gate_controller",
            payload=completed_payload,
            activity_id=node_id,
            writer_role="gate_controller",
        )
        return {
            "status": "completed",
            "result": payload,
            "verdict": verdict,
            "completion": completed_payload,
            "completed_event_id": completed_event_id,
        }


def submit_result(result: OperatorResult | dict[str, Any], *, harness_dir: str | Path | None = None) -> dict[str, Any]:
    return CompletionPipeline(harness_dir=harness_dir).submit_result(result)
