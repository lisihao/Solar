"""evidence_collector — Collect runtime metrics and validate evidence artifacts.

Ensures builder/evaluator exits produce standard Nx-handoff.md and Nx-eval.json
with metrics (throughput, duration, token counts) written to status.json.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional


def collect_node_metrics(
    handoff_path: Path,
    eval_json_path: Path,
    session_start_ts: Optional[str] = None,
    session_end_ts: Optional[str] = None,
    token_consumed: Optional[int] = None,
) -> Dict[str, Any]:
    """Collect metrics from node artifacts.

    Returns a metrics dict suitable for writing into status.json.
    """
    metrics: Dict[str, Any] = {
        "handoff_exists": handoff_path.is_file(),
        "eval_json_exists": eval_json_path.is_file(),
    }

    if eval_json_path.is_file():
        try:
            eval_data = json.loads(eval_json_path.read_text(encoding="utf-8"))
            metrics["verdict"] = eval_data.get("verdict")
            metrics["eval_checked_at"] = eval_data.get("checked_at")
        except (json.JSONDecodeError, OSError):
            metrics["eval_parse_error"] = True

    if token_consumed is not None:
        metrics["token_consumed"] = token_consumed

    if session_start_ts and session_end_ts:
        metrics["session_start"] = session_start_ts
        metrics["session_end"] = session_end_ts

    return metrics


def validate_evidence_artifacts(
    sprint_dir: Path,
    sprint_id: str,
    node_ids: List[str],
) -> Dict[str, Any]:
    """Validate that all nodes have handoff.md and eval.json artifacts.

    Returns a report with per-node status and missing artifacts.
    """
    results: Dict[str, Any] = {
        "sprint_id": sprint_id,
        "nodes": {},
        "all_present": True,
        "missing": [],
    }

    for node_id in node_ids:
        handoff = sprint_dir / f"{sprint_id}.{node_id}-handoff.md"
        eval_json = sprint_dir / f"{sprint_id}.{node_id}-eval.json"
        eval_md = sprint_dir / f"{sprint_id}.{node_id}-eval.md"

        node_status = {
            "handoff_md": handoff.is_file(),
            "eval_json": eval_json.is_file(),
            "eval_md": eval_md.is_file(),
        }

        if not all(node_status.values()):
            results["all_present"] = False
            missing = [k for k, v in node_status.items() if not v]
            results["missing"].append(f"{node_id}: {', '.join(missing)}")

        # Extract verdict from eval.json if present
        if eval_json.is_file():
            try:
                data = json.loads(eval_json.read_text(encoding="utf-8"))
                node_status["verdict"] = data.get("verdict")
            except (json.JSONDecodeError, OSError):
                node_status["verdict"] = "parse_error"

        results["nodes"][node_id] = node_status

    return results


def update_status_metrics(
    status_path: Path,
    metrics: Dict[str, Any],
) -> bool:
    """Write metrics into a sprint status.json file.

    Returns True on success.
    """
    if not status_path.is_file():
        return False

    try:
        data = json.loads(status_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return False

    data["metrics"] = metrics

    try:
        status_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return True
    except OSError:
        return False
