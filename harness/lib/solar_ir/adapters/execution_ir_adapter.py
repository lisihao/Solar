"""ExecutionIRAdapter — project operator_runtime state → ExecutionIR."""
from __future__ import annotations

from typing import Any, Dict, Optional

from ..execution_ir import ExecutionIR, LeaseTimeline, HeartbeatRecord, AttemptEntry
from ..provenance import Provenance


class ExecutionIRAdapter:
    """Project operator_runtime lease/status data into ExecutionIR.

    Reads-only: queries operator_runtime for lease, status, and heartbeat
    information and constructs an ExecutionIR snapshot.  Does not modify
    any operator_runtime state.
    """

    @staticmethod
    def from_operator_state(
        operator_id: str,
        *,
        lease: Optional[Dict[str, Any]] = None,
        status: Optional[Dict[str, Any]] = None,
        task_envelope: Optional[Dict[str, Any]] = None,
    ) -> ExecutionIR:
        """Build ExecutionIR from operator_runtime lease + status dicts."""
        node_id = ""
        sprint_id = ""
        dispatch_id = ""
        if task_envelope:
            node_id = str(task_envelope.get("node_id", ""))
            sprint_id = str(task_envelope.get("sprint_id", ""))
            dispatch_id = str(task_envelope.get("task_id", ""))

        state = "idle"
        if status and isinstance(status, dict):
            rs = str(status.get("runtime_state", "")).strip()
            if rs:
                state = rs

        lease_ir = None
        if lease and isinstance(lease, dict):
            lease_ir = LeaseTimeline(
                acquired_at=str(lease.get("leased_at", "")),
                expires_at=str(lease.get("expires_at", "")),
                lease_id="",
                owner=str(lease.get("operator_id", "")),
            )
            ls = str(lease.get("state", ""))
            if ls:
                state = ls

        heartbeat_ir = None
        if status and isinstance(status, dict):
            hb_at = str(status.get("heartbeat_at", ""))
            if hb_at:
                heartbeat_ir = HeartbeatRecord(
                    last_heartbeat_at=hb_at,
                )

        prov = Provenance(
            owner="execution_ir_adapter",
            source_ref=f"operator_runtime:{operator_id}",
        )

        return ExecutionIR(
            ir_id=f"exec:{sprint_id}:{node_id}:{operator_id}",
            node_id=node_id,
            operator_id=operator_id,
            state=state,
            pane="",
            dispatch_id=dispatch_id,
            lease=lease_ir,
            heartbeat=heartbeat_ir,
            attempt_lineage=(),
            assigned_to="",
            metadata={
                "sprint_id": sprint_id,
            },
            provenance=prov,
        )

    @staticmethod
    def from_task_result(
        result: Dict[str, Any],
    ) -> ExecutionIR:
        """Build ExecutionIR from an operator_runtime result.json artifact."""
        operator_id = str(result.get("operator_id", ""))
        task_id = str(result.get("task_id", ""))
        sprint_id = str(result.get("sprint_id", ""))
        node_id = str(result.get("node_id", ""))
        exit_code = result.get("exit_code", -1)

        outcome = "success" if exit_code == 0 else "failure"
        started_at = str(result.get("started_at", ""))
        finished_at = str(result.get("finished_at", ""))

        attempt = AttemptEntry(
            attempt_id=f"attempt:{task_id}",
            started_at=started_at,
            finished_at=finished_at,
            outcome=outcome,
        )

        state = "idle"
        if exit_code == 0:
            state = "idle"
        else:
            state = "cooldown"

        prov = Provenance(
            owner="execution_ir_adapter",
            source_ref=f"result.json:{operator_id}:{task_id}",
        )

        return ExecutionIR(
            ir_id=f"exec:{sprint_id}:{node_id}:{operator_id}",
            node_id=node_id,
            operator_id=operator_id,
            state=state,
            pane="",
            dispatch_id=task_id,
            attempt_lineage=(attempt,),
            error_log=tuple([result.get("log_tail", "")]) if exit_code != 0 else (),
            assigned_to="",
            metadata={
                "sprint_id": sprint_id,
                "exit_code": exit_code,
            },
            provenance=prov,
        )
