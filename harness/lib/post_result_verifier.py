#!/usr/bin/env python3
"""Post-result verifier for Solar-Harness completion gating.

This verifier is intentionally deterministic: it validates the evidence ABI
around an operator result and writes a stable verdict artifact. Model-heavy
quality checks can remain separate providers, but completion cannot bypass this
minimal artifact/hash/write-scope gate.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "solar.verifier.result.v1"


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _rule(rule_id: str, status: str, message: str, *, severity: str = "blocker", path: str = "") -> dict[str, Any]:
    return {
        "id": rule_id,
        "severity": severity,
        "status": status,
        "message": message,
        "path": path or "N/A",
    }


def _existing_artifact(path_value: str | None) -> dict[str, str] | None:
    if not path_value:
        return None
    path = Path(path_value).expanduser()
    if not path.exists() or not path.is_file():
        return None
    return {"path": str(path), "sha256": sha256_file(path)}


def ensure_artifact_manifest(result: dict[str, Any], verifier_dir: Path) -> Path:
    """Create a manifest from known result artifacts if caller did not provide one."""
    raw_manifest = str(result.get("artifact_manifest") or "").strip()
    if raw_manifest:
        return Path(raw_manifest).expanduser()

    artifacts: list[dict[str, str]] = []
    for key in ("handoff_path", "eval_path"):
        artifact = _existing_artifact(str(result.get(key) or "").strip())
        if artifact:
            artifacts.append(artifact)

    manifest = {
        "schema_version": "solar.operator_result.artifact_manifest.v1",
        "session_id": result.get("session_id"),
        "node_id": result.get("node_id"),
        "attempt_id": result.get("attempt_id"),
        "result_id": result.get("result_id"),
        "artifacts": artifacts,
        "created_at": utc_now(),
    }
    verifier_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = verifier_dir / "artifact_manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    result["artifact_manifest"] = str(manifest_path)
    return manifest_path


def verify_operator_result(result: dict[str, Any], verifier_dir: str | Path) -> dict[str, Any]:
    verifier_path = Path(verifier_dir).expanduser()
    verifier_path.mkdir(parents=True, exist_ok=True)

    session_id = str(result.get("session_id") or "")
    node_id = str(result.get("node_id") or "")
    attempt_id = str(result.get("attempt_id") or "attempt-1")
    result_id = str(result.get("result_id") or f"result_{node_id}_{attempt_id}")
    verdict_id = f"verdict_{node_id}_{attempt_id}_{hashlib.sha1(result_id.encode()).hexdigest()[:8]}"

    manifest_path = ensure_artifact_manifest(result, verifier_path)
    covered_artifacts: list[dict[str, str]] = []
    rules: list[dict[str, Any]] = []

    handoff = _existing_artifact(str(result.get("handoff_path") or "").strip())
    if handoff:
        covered_artifacts.append(handoff)
        rules.append(_rule("solar.post_result.handoff_exists", "passed", "handoff artifact exists", path=handoff["path"]))
    else:
        rules.append(_rule("solar.post_result.handoff_exists", "failed", "handoff artifact is missing"))

    eval_artifact = _existing_artifact(str(result.get("eval_path") or "").strip())
    if eval_artifact:
        covered_artifacts.append(eval_artifact)
        rules.append(_rule("solar.post_result.eval_artifact_exists", "passed", "eval artifact exists", path=eval_artifact["path"]))
    else:
        rules.append(
            _rule(
                "solar.post_result.eval_artifact_exists",
                "passed",
                "eval artifact is optional for this minimal post-result gate",
                severity="warn",
            )
        )

    if manifest_path.exists() and manifest_path.is_file():
        manifest_hash = sha256_file(manifest_path)
        covered_artifacts.append({"path": str(manifest_path), "sha256": manifest_hash})
        rules.append(
            _rule(
                "solar.post_result.artifact_manifest_exists",
                "passed",
                "artifact manifest exists",
                path=str(manifest_path),
            )
        )
    else:
        rules.append(_rule("solar.post_result.artifact_manifest_exists", "failed", "artifact manifest is missing"))

    write_scope = result.get("write_scope")
    if write_scope is None or isinstance(write_scope, list):
        rules.append(_rule("solar.post_result.write_scope_declared", "passed", "write_scope is machine-readable"))
    else:
        rules.append(_rule("solar.post_result.write_scope_declared", "failed", "write_scope must be a list"))

    blocker_failed = [rule for rule in rules if rule["severity"] == "blocker" and rule["status"] != "passed"]
    status = "passed" if not blocker_failed else "failed"
    finished_at = utc_now()
    payload = {
        "schema_version": SCHEMA_VERSION,
        "verdict_id": verdict_id,
        "session_id": session_id,
        "node_id": node_id,
        "attempt_id": attempt_id,
        "trigger": "post_result",
        "status": status,
        "covered_result_id": result_id,
        "covered_attempt_id": attempt_id,
        "covered_artifacts": covered_artifacts,
        "rules": rules,
        "created_at": finished_at,
        "artifacts": {
            "json": str(verifier_path / "verifier-result.json"),
            "markdown": str(verifier_path / "verifier-result.md"),
            "rule_events": str(verifier_path / "rule-events.jsonl"),
            "covered_artifacts": str(verifier_path / "covered-artifacts.json"),
        },
    }

    (verifier_path / "verifier-result.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    md_lines = [
        f"# Post-result verifier: {status}",
        "",
        f"- verdict_id: `{verdict_id}`",
        f"- node_id: `{node_id}`",
        f"- result_id: `{result_id}`",
        "",
        "## Rules",
    ]
    md_lines.extend(f"- {rule['status']}: `{rule['id']}` - {rule['message']}" for rule in rules)
    (verifier_path / "verifier-result.md").write_text("\n".join(md_lines) + "\n", encoding="utf-8")
    (verifier_path / "covered-artifacts.json").write_text(
        json.dumps({"covered_artifacts": covered_artifacts}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    with (verifier_path / "rule-events.jsonl").open("w", encoding="utf-8") as fh:
        for rule in rules:
            fh.write(json.dumps({"type": f"verifier.rule.{rule['status']}", "rule": rule}, ensure_ascii=False) + "\n")
    return payload
