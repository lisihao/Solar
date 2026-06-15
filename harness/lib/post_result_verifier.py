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


def _parse_iso_ts(value: Any) -> dt.datetime | None:
    """Parse an ISO8601 timestamp (with trailing Z) into an aware datetime."""
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def check_write_scope_touched(result: dict[str, Any]) -> dict[str, Any]:
    """治造假硬门: builder 声称改了 write_scope 文件, 磁盘上必须真的被本次任务改过。

    判定 (source 单一真相: result 里的 write_scope + started_at, 文件 mtime):
      - write_scope 为空/缺失 → passed (planner/分析类节点不产文件, 不误伤)
      - started_at 缺失或不可解析 → warn (无法做 mtime 基准, 不确定不误杀)
      - 声明的文件全部不存在 → failed "声称改动但磁盘无文件"
      - 文件存在但全部 mtime < started_at → failed "文件未被本次任务改动 (造假)"
      - 至少一个声明文件 mtime >= started_at → passed (真有改动)

    severity: 先 warn (观察期), 确认不误伤后由调用方升 blocker。
    """
    write_scope = result.get("write_scope")
    if not write_scope or not isinstance(write_scope, list):
        return _rule(
            "solar.post_result.write_scope_touched",
            "passed",
            "no write_scope to verify (analysis/planner node)",
            severity="warn",
        )

    started = _parse_iso_ts(result.get("started_at") or result.get("dispatch_start_ts"))
    if started is None:
        return _rule(
            "solar.post_result.write_scope_touched",
            "passed",
            "started_at unavailable; cannot establish mtime baseline (not blocking)",
            severity="warn",
        )

    # 容差: 文件系统 mtime 与任务 started_at 可能有秒级偏差, 给 5s 宽限避免误杀
    baseline = started - dt.timedelta(seconds=5)

    declared = [str(p).strip() for p in write_scope if str(p).strip()]
    missing: list[str] = []
    stale: list[str] = []
    touched: list[str] = []
    for raw in declared:
        path = Path(raw).expanduser()
        if not path.exists():
            missing.append(raw)
            continue
        try:
            mtime = dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc)
        except OSError:
            missing.append(raw)
            continue
        if mtime >= baseline:
            touched.append(raw)
        else:
            stale.append(raw)

    if touched:
        return _rule(
            "solar.post_result.write_scope_touched",
            "passed",
            f"{len(touched)}/{len(declared)} declared file(s) modified by this task",
            severity="warn",
            path=touched[0],
        )

    if declared and len(missing) == len(declared):
        return _rule(
            "solar.post_result.write_scope_touched",
            "failed",
            f"claimed write_scope but {len(missing)} declared file(s) absent on disk (fabricated completion)",
            severity="warn",
            path=missing[0] if missing else "N/A",
        )

    return _rule(
        "solar.post_result.write_scope_touched",
        "failed",
        f"declared file(s) exist but none modified since task start (no real change): "
        f"{len(stale)} stale, {len(missing)} missing",
        severity="warn",
        path=(stale or missing or ["N/A"])[0],
    )


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

    eval_artifact = _existing_artifact(str(result.get("eval_path") or "").strip())
    handoff = _existing_artifact(str(result.get("handoff_path") or "").strip())
    if handoff:
        covered_artifacts.append(handoff)
        rules.append(_rule("solar.post_result.handoff_exists", "passed", "handoff artifact exists", path=handoff["path"]))
    elif eval_artifact:
        rules.append(
            _rule(
                "solar.post_result.handoff_exists",
                "passed",
                "handoff artifact is optional when eval artifact exists",
                severity="warn",
            )
        )
    else:
        rules.append(_rule("solar.post_result.handoff_exists", "failed", "handoff artifact is missing"))

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

    # 治造假硬门 (2026-06-14): 声称改的 write_scope 文件磁盘上必须真被本次任务改过。
    # 观察期 severity=warn (不 block, 只留痕), 确认不误伤后升 blocker。
    rules.append(check_write_scope_touched(result))

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
