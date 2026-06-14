"""status_projection.py — Status UI / livework projection for orchestration traces.

Extends status UI to show epic, child sprint, graph node, capability usage,
operator, pane hygiene, blocked_reason, and evidence-based state determination.

Remains backward compatible when trace artifacts are absent.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

from .trace_model import (
    DispatchStatus,
    PaneHygieneState,
    VerifierDecision,
)
from .trace_writer import _resolve_harness_dir


class StatusProjection:
    """Projects orchestration trace data into a UI-friendly status view.

    Falls back to existing status fields when trace artifacts are absent.
    """

    def __init__(self, harness_dir: Path | None = None) -> None:
        self.harness_dir = _resolve_harness_dir(harness_dir)
        self.traces_dir = self.harness_dir / "traces" / "orchestration"

    def project_sprint(self, sprint_id: str) -> dict[str, Any]:
        """Build status projection for a sprint from its traces and status.json.

        Returns a dict with:
        - epic_id, child sprint status, node statuses
        - capability usage, operator assignments
        - pane hygiene states, blocked reasons
        - evidence-based status determination
        """
        sprints_dir = self.harness_dir / "sprints"
        status = self._load_status(sprints_dir, sprint_id)
        traces = self._load_traces_for_sprint(sprint_id)

        nodes = self._project_nodes(traces)
        epic_id = status.get("epic_id", "")
        pane_hygiene = self._aggregate_hygiene(traces)
        blocked_reason = self._find_blocked_reason(traces)
        capabilities = self._collect_capabilities(traces)
        operators = self._collect_operators(traces)

        evidence_status = self._determine_status_from_evidence(traces, status)

        return {
            "sprint_id": sprint_id,
            "epic_id": epic_id,
            "status": evidence_status,
            "legacy_status": status.get("status", ""),
            "nodes": nodes,
            "node_count": len(nodes),
            "open_nodes": [n for n in nodes if n["status"] not in {"passed", "skipped"}],
            "pane_hygiene": pane_hygiene,
            "blocked_reason": blocked_reason,
            "capabilities_used": capabilities,
            "operators": operators,
            "trace_count": len(traces),
            "has_verifier_evidence": any(
                t.get("verifier", {}).get("decision") in {"PASS", "FAIL", "WARNING"}
                for t in traces
            ),
        }

    def _load_status(self, sprints_dir: Path, sprint_id: str) -> dict[str, Any]:
        sf = sprints_dir / f"{sprint_id}.status.json"
        if sf.exists():
            try:
                return json.loads(sf.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {}

    def _load_traces_for_sprint(self, sprint_id: str) -> list[dict[str, Any]]:
        traces: list[dict[str, Any]] = []
        if not self.traces_dir.exists():
            return traces
        for tf in self.traces_dir.glob("*.json"):
            try:
                data = json.loads(tf.read_text(encoding="utf-8"))
                if data.get("sprint_id") == sprint_id:
                    traces.append(data)
            except Exception:
                continue
        return traces

    def _project_nodes(self, traces: list[dict[str, Any]]) -> list[dict[str, Any]]:
        node_map: dict[str, dict[str, Any]] = {}
        for t in traces:
            node_id = t.get("node_id") or t.get("trace_id", "unknown")
            if node_id not in node_map:
                node_map[node_id] = {
                    "node_id": node_id,
                    "status": "pending",
                    "operator_id": "",
                    "capabilities": [],
                    "pane_hygiene": "",
                    "verifier_decision": "PENDING",
                }
            entry = node_map[node_id]
            dispatch = t.get("dispatch", {})
            dispatch_status = dispatch.get("dispatch_status", "")
            verifier = t.get("verifier", {})
            verifier_decision = verifier.get("decision", "PENDING")

            entry["operator_id"] = t.get("operator_id", "") or entry["operator_id"]
            entry["capabilities"] = dispatch.get("required_capabilities", []) or entry["capabilities"]
            entry["pane_hygiene"] = t.get("pane_hygiene_state", "") or entry["pane_hygiene"]
            entry["verifier_decision"] = verifier_decision

            if verifier_decision == "PASS":
                entry["status"] = "passed"
            elif verifier_decision == "FAIL":
                entry["status"] = "failed"
            elif verifier_decision == "WARNING":
                entry["status"] = "warning"
            elif dispatch_status in {"dispatched", "active"}:
                entry["status"] = "active"
            elif dispatch_status == "queued":
                entry["status"] = "blocked"
            else:
                entry["status"] = dispatch_status or entry["status"]

        return list(node_map.values())

    def _aggregate_hygiene(self, traces: list[dict[str, Any]]) -> list[dict[str, str]]:
        result: list[dict[str, str]] = []
        for t in traces:
            state = t.get("pane_hygiene_state", "")
            if state:
                result.append({
                    "operator_id": t.get("operator_id", ""),
                    "node_id": t.get("node_id", ""),
                    "state": state,
                })
        return result

    def _find_blocked_reason(self, traces: list[dict[str, Any]]) -> str:
        for t in traces:
            reason = (t.get("dispatch", {}) or {}).get("blocked_reason", "")
            if reason:
                return reason
        return ""

    def _collect_capabilities(self, traces: list[dict[str, Any]]) -> list[str]:
        caps: set[str] = set()
        for t in traces:
            for cap in (t.get("dispatch", {}) or {}).get("required_capabilities", []):
                caps.add(cap)
        return sorted(caps)

    def _collect_operators(self, traces: list[dict[str, Any]]) -> list[str]:
        ops: set[str] = set()
        for t in traces:
            op = t.get("operator_id", "")
            if op:
                ops.add(op)
        return sorted(ops)

    def _determine_status_from_evidence(
        self, traces: list[dict[str, Any]], status: dict[str, Any]
    ) -> str:
        """Determine status from evidence traces.

        Without verifier evidence, nodes show warn/blocked, NOT passed.
        """
        if not traces:
            return status.get("status", "unknown")

        has_pass = any(
            t.get("verifier", {}).get("decision") == "PASS" for t in traces
        )
        has_fail = any(
            t.get("verifier", {}).get("decision") == "FAIL" for t in traces
        )
        has_active = any(
            (t.get("dispatch", {}) or {}).get("dispatch_status") in {"dispatched", "active"}
            for t in traces
        )

        if has_fail:
            return "failed"
        if has_pass:
            # Only show passed if there's actual verifier evidence
            return "passed"
        if has_active:
            return "in_progress"
        return "pending"
