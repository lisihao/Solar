#!/usr/bin/env python3
"""Completion gate controller helpers."""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any


def verdict_passed(verdict: dict[str, Any]) -> bool:
    return (
        str(verdict.get("trigger") or "") == "post_result"
        and str(verdict.get("status") or "") == "passed"
        and bool(verdict.get("verdict_id"))
        and bool(verdict.get("covered_result_id"))
    )


def completion_payload(verdict: dict[str, Any]) -> dict[str, Any]:
    return {
        "completion_source": "solar_gate_controller",
        "verifier_verdict_id": verdict.get("verdict_id"),
        "covered_result_id": verdict.get("covered_result_id"),
        "covered_attempt_id": verdict.get("covered_attempt_id"),
        "verifier_artifact": (verdict.get("artifacts") or {}).get("json"),
    }


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _completion_source(result: dict[str, Any], gate: dict[str, Any], verdict: dict[str, Any]) -> str:
    for payload in (result, gate, verdict):
        source = str(payload.get("completion_source") or "").strip()
        if source:
            return source
    return ""


def _artifact_path(raw_path: str, artifact_base_dirs: list[str | Path] | None) -> Path:
    path = Path(raw_path).expanduser()
    if path.is_absolute() or not artifact_base_dirs:
        return path
    for base_dir in artifact_base_dirs:
        candidate = Path(base_dir).expanduser() / raw_path
        if candidate.exists():
            return candidate
    return path


def validate_parent_child_completion(
    children: list[dict[str, Any]],
    *,
    allow_break_glass: bool = False,
    verify_artifact_hashes: bool = True,
    artifact_base_dirs: list[str | Path] | None = None,
) -> dict[str, Any]:
    """Validate child completion gates before a parent sprint can close.

    Historical child nodes that do not opt into ``completion_gate_required`` are
    left compatible. New gate-era child results fail closed if their verifier
    verdict is missing, stale, break-glass, or artifact hashes drift.
    """
    missing_child_verifiers: list[str] = []
    stale_child_verifiers: list[str] = []
    break_glass_nodes: list[str] = []
    artifact_hash_mismatches: list[dict[str, str]] = []
    checked_nodes: list[str] = []

    for child in children:
        node_id = str(child.get("node_id") or "")
        result = child.get("result") if isinstance(child.get("result"), dict) else {}
        if not result.get("completion_gate_required"):
            continue
        checked_nodes.append(node_id)
        gate = result.get("completion_gate") if isinstance(result.get("completion_gate"), dict) else {}
        verdict = gate.get("verdict") if isinstance(gate.get("verdict"), dict) else {}

        if _completion_source(result, gate, verdict) == "break_glass" and not allow_break_glass:
            break_glass_nodes.append(node_id)

        if not verdict_passed(verdict):
            missing_child_verifiers.append(node_id)
            continue

        result_id = str(result.get("result_id") or "")
        attempt_id = str(result.get("attempt_id") or "")
        covered_result_id = str(verdict.get("covered_result_id") or gate.get("covered_result_id") or "")
        covered_attempt_id = str(verdict.get("covered_attempt_id") or gate.get("covered_attempt_id") or "")
        if not result_id or result_id != covered_result_id or (attempt_id and covered_attempt_id and attempt_id != covered_attempt_id):
            stale_child_verifiers.append(node_id)

        if not verify_artifact_hashes:
            continue
        for artifact in verdict.get("covered_artifacts") or []:
            if not isinstance(artifact, dict):
                continue
            raw_path = str(artifact.get("path") or "")
            expected = str(artifact.get("sha256") or "")
            if not raw_path or not expected:
                continue
            path = _artifact_path(raw_path, artifact_base_dirs)
            if not path.exists():
                artifact_hash_mismatches.append({"node_id": node_id, "path": raw_path, "reason": "missing"})
                continue
            actual = _sha256(path)
            if actual != expected:
                artifact_hash_mismatches.append({
                    "node_id": node_id,
                    "path": raw_path,
                    "reason": "sha256_mismatch",
                    "expected": expected,
                    "actual": actual,
                })

    failed = bool(missing_child_verifiers or stale_child_verifiers or break_glass_nodes or artifact_hash_mismatches)
    return {
        "status": "failed" if failed else "passed",
        "checked_nodes": checked_nodes,
        "missing_child_verifiers": missing_child_verifiers,
        "stale_child_verifiers": stale_child_verifiers,
        "break_glass_nodes": break_glass_nodes,
        "artifact_hash_mismatches": artifact_hash_mismatches,
        "allow_break_glass": allow_break_glass,
    }
