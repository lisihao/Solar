"""EvidenceIRAdapter — project event_ledger entries → EvidenceIR overlay."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..evidence_ir import EvidenceIR, EvidenceEntry
from ..provenance import Provenance


class EvidenceIRAdapter:
    """Project event_ledger replay output into EvidenceIR instances.

    Each sprint's event stream is folded into an EvidenceIR containing one
    EvidenceEntry per event that represents a verifiable result (e.g.
    command_issued, activity_completed, handoff_written).

    The adapter is read-only: it never modifies the source event ledger.
    """

    @staticmethod
    def from_events(
        events: List[Dict[str, Any]],
        *,
        sprint_id: str = "",
        node_id: str = "",
    ) -> EvidenceIR:
        """Fold a list of event dicts into a single EvidenceIR."""
        entries: List[EvidenceEntry] = []
        for idx, event in enumerate(events):
            event_type = str(event.get("event_type", ""))
            payload = event.get("payload", {})
            if not isinstance(payload, dict):
                payload = {}

            eid = str(event.get("event_id", f"ev-{idx}"))
            actor = str(event.get("actor", ""))
            created_at = str(event.get("created_at", ""))

            passed = False
            description = f"{event_type} by {actor}"
            if event_type == "state_transition":
                to_state = str(payload.get("to", ""))
                from_state = str(payload.get("from", ""))
                description = f"{from_state} → {to_state}"
                passed = "passed" in to_state or "completed" in to_state
            elif event_type in ("command_issued", "activity_completed"):
                passed = True
            elif event_type == "activity_failed":
                passed = False
                reason = payload.get("reason") or payload.get("error", "")
                if reason:
                    description += f": {reason}"

            entries.append(
                EvidenceEntry(
                    evidence_id=eid,
                    evidence_type=event_type,
                    description=description,
                    result_summary=created_at,
                    passed=passed,
                )
            )

        overall_passed = all(e.passed for e in entries) if entries else False

        prov = Provenance(
            owner="evidence_ir_adapter",
            source_ref=f"event_ledger:{sprint_id}:{node_id}",
        )

        return EvidenceIR(
            ir_id=f"evidence:{sprint_id}:{node_id}",
            entries=tuple(entries),
            overall_passed=overall_passed,
            metadata={
                "event_count": len(entries),
                "sprint_id": sprint_id,
                "node_id": node_id,
            },
            provenance=prov,
        )

    @staticmethod
    def from_node_events(
        events: List[Dict[str, Any]],
        node_id: str,
        *,
        sprint_id: str = "",
    ) -> EvidenceIR:
        """Filter events for a specific node and project to EvidenceIR."""
        node_events = [
            e for e in events
            if str(e.get("node_id", "")) == node_id
        ]
        return EvidenceIRAdapter.from_events(
            node_events, sprint_id=sprint_id, node_id=node_id,
        )

    @staticmethod
    def overlay(
        base: EvidenceIR,
        additional: EvidenceIR,
    ) -> EvidenceIR:
        """Merge two EvidenceIR instances by appending entries from additional."""
        merged_entries = list(base.entries) + list(additional.entries)
        overall = base.overall_passed and additional.overall_passed
        return EvidenceIR(
            ir_id=base.ir_id,
            entries=tuple(merged_entries),
            overall_passed=overall,
            metadata={
                **base.metadata,
                "overlaid_from": additional.ir_id,
                "total_entries": len(merged_entries),
            },
            provenance=base.provenance,
        )
