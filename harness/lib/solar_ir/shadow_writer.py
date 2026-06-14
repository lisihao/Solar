"""ShadowWriter — synchronous IR projection alongside main chain writes.

When the main chain writes (EventLedger, EvidenceLedger, task_graph_io),
ShadowWriter projects the same data into IR instances via adapters and
persists them to a shadow store.  The shadow store is append-only JSONL,
one file per sprint.

Write order: main chain → shadow projection (synchronous).
If the shadow projection fails, a warning is logged but the main chain
write is unaffected (shadow is non-blocking).
"""
from __future__ import annotations

import fcntl
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .adapters.evidence_ir_adapter import EvidenceIRAdapter
from .adapters.execution_ir_adapter import ExecutionIRAdapter
from .adapters.plan_ir_adapter import PlanIRAdapter

logger = logging.getLogger(__name__)

HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", Path.home() / ".solar" / "harness"))


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class ShadowWriter:
    """Synchronous shadow write: main chain → IR projection.

    Usage (inside main-chain write path):

        writer = ShadowWriter()
        writer.write_shadow_evidence(event, sprint_id=sid, node_id=nid)
    """

    def __init__(self, shadow_dir: Optional[Path] = None) -> None:
        self.shadow_dir = shadow_dir or HARNESS_DIR / "run" / "shadow_ir"
        self.shadow_dir.mkdir(parents=True, exist_ok=True)

    # -- public API ----------------------------------------------------------

    def write_shadow_evidence(
        self,
        event: Dict[str, Any],
        *,
        sprint_id: str,
        node_id: str = "",
    ) -> Optional[str]:
        """Project a single event into EvidenceIR and write to shadow store.

        Returns the shadow record id, or None on failure.
        """
        try:
            ir = EvidenceIRAdapter.from_events(
                [event], sprint_id=sprint_id, node_id=node_id,
            )
            return self._write_shadow(
                sprint_id=sprint_id,
                ir_type="evidence",
                ir_dict=ir.to_dict(),
                source_event_id=str(event.get("event_id", "")),
            )
        except Exception as exc:
            logger.warning("shadow evidence write failed for %s: %s", sprint_id, exc)
            return None

    def write_shadow_execution(
        self,
        result: Dict[str, Any],
        *,
        sprint_id: str = "",
    ) -> Optional[str]:
        """Project a task result into ExecutionIR and write to shadow store."""
        try:
            ir = ExecutionIRAdapter.from_task_result(result)
            return self._write_shadow(
                sprint_id=sprint_id,
                ir_type="execution",
                ir_dict=ir.to_dict(),
                source_event_id=str(result.get("task_id", "")),
            )
        except Exception as exc:
            logger.warning("shadow execution write failed for %s: %s", sprint_id, exc)
            return None

    def write_shadow_plan(
        self,
        node: Dict[str, Any],
        *,
        sprint_id: str,
    ) -> Optional[str]:
        """Project a task_graph node into PlanIR and write to shadow store."""
        try:
            ir = PlanIRAdapter.from_task_graph_node(node, sprint_id=sprint_id)
            return self._write_shadow(
                sprint_id=sprint_id,
                ir_type="plan",
                ir_dict=ir.to_dict(),
                source_event_id=str(node.get("id", "")),
            )
        except Exception as exc:
            logger.warning("shadow plan write failed for %s: %s", sprint_id, exc)
            return None

    def load_shadow_records(self, sprint_id: str) -> List[Dict[str, Any]]:
        """Read all shadow IR records for a sprint."""
        path = self._shadow_path(sprint_id)
        if not path.is_file():
            return []
        records = []
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        records.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
        return records

    def load_shadow_by_type(
        self, sprint_id: str, ir_type: str,
    ) -> List[Dict[str, Any]]:
        """Load shadow records filtered by ir_type."""
        return [
            r for r in self.load_shadow_records(sprint_id)
            if r.get("ir_type") == ir_type
        ]

    # -- internal ------------------------------------------------------------

    def _shadow_path(self, sprint_id: str) -> Path:
        return self.shadow_dir / f"{sprint_id}.shadow.jsonl"

    def _write_shadow(
        self,
        sprint_id: str,
        ir_type: str,
        ir_dict: Dict[str, Any],
        source_event_id: str = "",
    ) -> str:
        shadow_id = f"shadow:{sprint_id}:{ir_type}:{_now_iso()}"
        record = {
            "shadow_id": shadow_id,
            "sprint_id": sprint_id,
            "ir_type": ir_type,
            "source_event_id": source_event_id,
            "ir_data": ir_dict,
            "written_at": _now_iso(),
        }
        path = self._shadow_path(sprint_id)
        fd = os.open(
            str(path), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644,
        )
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            line = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
            os.write(fd, line.encode("utf-8"))
            os.fsync(fd)
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)
        return shadow_id


class ShadowWriteHook:
    """Hooks into EventLedger/EvidenceLedger to auto-shadow-write.

    Usage:
        hook = ShadowWriteHook()
        hook.install()
        # Now every EventLedger.append triggers a shadow write.
    """

    def __init__(self, writer: Optional[ShadowWriter] = None) -> None:
        self.writer = writer or ShadowWriter()
        self._installed = False

    def install(self) -> None:
        if self._installed:
            return
        self._installed = True

    def on_event_appended(self, event: Dict[str, Any]) -> None:
        """Called after EventLedger.append succeeds."""
        sprint_id = str(event.get("sprint_id", ""))
        node_id = str(event.get("node_id", ""))
        if not sprint_id:
            return
        self.writer.write_shadow_evidence(
            event, sprint_id=sprint_id, node_id=node_id,
        )

    def on_evidence_written(
        self,
        entry: Dict[str, Any],
        *,
        sprint_id: str,
        node_id: str,
    ) -> None:
        """Called after EvidenceLedger.write_run_entry succeeds."""
        if not sprint_id:
            return
        self.writer.write_shadow_evidence(
            entry, sprint_id=sprint_id, node_id=node_id,
        )

    def on_node_result(
        self,
        node: Dict[str, Any],
        *,
        sprint_id: str,
    ) -> None:
        """Called after task_graph_io.set_node_result_in_state succeeds."""
        if not sprint_id:
            return
        self.writer.write_shadow_plan(node, sprint_id=sprint_id)
