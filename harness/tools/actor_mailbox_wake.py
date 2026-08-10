#!/usr/bin/env python3
"""Wake a tmux-backed AgentActor mailbox consumer.

The actor runtime writes durable task envelopes to
``actors/<actor>/inbox``.  Claude Code subscription operators are
interactive tmux panes, so they need a small wake bridge: claim the next
mailbox task, write an auditable prompt file, and nudge the pane with the
prompt path.  The task body stays in the mailbox; tmux only carries the
path-sized wake signal.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))
ACTORS_DIR = HARNESS_DIR / "actors"
OPERATOR_STATUS_DIR = HARNESS_DIR / "run" / "operator-status"

AUTH_BLOCK_RE = re.compile(
    r"Please run /login|API Error:\s*401|Invalid authentication credentials|"
    r"authentication_error|login required|no active conversation",
    re.I,
)
AUTH_RECOVERY_RE = re.compile(
    r"Login successful|Authentication successful|Successfully (?:logged|signed) in",
    re.I,
)
QUOTA_BLOCK_RE = re.compile(
    r"You(?:'|’)ve hit (?:your|the org(?:anization)?(?:'s)?) .*limit|"
    r"rate[- ]limit|quota exhausted|RESOURCE_EXHAUSTED|429",
    re.I,
)
NON_CLAUDE_API_QUOTA_RE = re.compile(
    r"Insufficient balance|no resource package|Please recharge|"
    r'\"code\"\s*:\s*\"?1113\"?|ZHIPU|Z\.AI|api\.z\.ai|GLM-?\d|'
    r"ANTHROPIC_BASE_URL|ANTHROPIC_API_KEY",
    re.I,
)
FEEDBACK_PROMPT_RE = re.compile(
    r"How is Claude doing this session\?|1:\s*Bad\s+2:\s*Fine\s+3:\s*Good\s+0:\s*Dismiss",
    re.I,
)
READY_PROMPT_RE = re.compile(r"(?m)^\s*❯(?:\s|$)")


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _safe_id(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.:-]+", "-", value.strip())
    return safe.strip("-") or uuid.uuid4().hex[:12]


def _read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _parse_iso(value: str) -> dt.datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        return dt.datetime.fromisoformat(raw).astimezone(dt.timezone.utc)
    except Exception:
        return None


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def capture_pane_tail(pane: str, *, lines: int = 120) -> str:
    proc = subprocess.run(
        ["tmux", "capture-pane", "-t", pane, "-p", "-S", f"-{lines}"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"tmux capture-pane failed for {pane}")
    return proc.stdout


def tail_has_ready_prompt_after_last_blocker(tail: str, blocker_re: re.Pattern[str]) -> bool:
    matches = list(blocker_re.finditer(tail or ""))
    if not matches:
        return False
    suffix = tail[matches[-1].end():]
    if not READY_PROMPT_RE.search(suffix):
        return False
    if blocker_re is AUTH_BLOCK_RE:
        # An expired Claude session returns to the normal-looking prompt and
        # still renders the "bypass permissions" footer.  Neither proves that
        # the shared OAuth credential was reloaded.  Require positive login or
        # an explicit successful login marker after the last auth failure.
        return bool(AUTH_RECOVERY_RE.search(suffix))
    return "Claude Code v" in suffix or "bypass permissions" in suffix


def classify_tail(tail: str) -> tuple[str, str]:
    if AUTH_BLOCK_RE.search(tail) and not tail_has_ready_prompt_after_last_blocker(tail, AUTH_BLOCK_RE):
        return "auth_expired", "pane_tail_auth_blocker"
    if NON_CLAUDE_API_QUOTA_RE.search(tail or "") and not tail_has_ready_prompt_after_last_blocker(
        tail,
        NON_CLAUDE_API_QUOTA_RE,
    ):
        return "runtime_misroute", "pane_tail_non_claude_api_quota"
    if QUOTA_BLOCK_RE.search(tail) and not tail_has_ready_prompt_after_last_blocker(tail, QUOTA_BLOCK_RE):
        return "quota_exhausted", "pane_tail_quota_blocker"
    return "ok", ""


def tail_needs_feedback_dismissal(tail: str) -> bool:
    return bool(FEEDBACK_PROMPT_RE.search(tail or ""))


def tail_has_interrupt_ready_prompt(tail: str) -> bool:
    text = tail or ""
    if "Interrupt· What should Claude do" not in text and "Interrupt · What should Claude do" not in text:
        return False
    return bool(READY_PROMPT_RE.search(text))


def tail_indicates_busy(tail: str) -> bool:
    text = tail or ""
    if tail_has_interrupt_ready_prompt(text):
        return False
    markers = (
        "Running…",
        "Running...",
        "Spinning…",
        "Spinning...",
        "Forming…",
        "Forming...",
        "Transfiguring…",
        "Transfiguring...",
        "Precipitating…",
        "Precipitating...",
        "✢ Precipitating",
        "Effecting…",
        "Effecting...",
        "✳ Effecting",
        "Crunching…",
        "Crunching...",
        "✻ Crunching",
        "Metamorphosing…",
        "Metamorphosing...",
        "✽ Metamorphosing",
        "⎿ \xa0Running",
        "⎿  Running",
    )
    positions = [(text.rfind(marker), marker) for marker in markers]
    positions = [(idx, marker) for idx, marker in positions if idx >= 0]
    if not positions:
        return False
    last_idx, last_marker = max(positions, key=lambda item: item[0])
    suffix = text[last_idx + len(last_marker):]
    if READY_PROMPT_RE.search(suffix) and (
        "bypass permissions" in suffix
        or "new task? /clear" in suffix
        or 'Try "edit' in suffix
    ):
        return False
    return True


def write_operator_status(
    actor_id: str,
    runtime_state: str,
    *,
    reason: str,
    excerpt: str,
    ttl_seconds: int,
) -> Path:
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "operator_id": actor_id,
        "runtime_state": runtime_state,
        "reason": reason,
        "source": "actor_mailbox_wake",
        "updated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expires_at": (now + dt.timedelta(seconds=ttl_seconds)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "last_block_excerpt": excerpt[-2000:],
    }
    path = OPERATOR_STATUS_DIR / f"{actor_id}.json"
    _write_json_atomic(path, payload)
    return path


def clear_operator_status_if_blocked(actor_id: str) -> bool:
    path = OPERATOR_STATUS_DIR / f"{actor_id}.json"
    data = _read_json(path) if path.exists() else {}
    state = str(data.get("runtime_state") or data.get("state") or "").strip().lower()
    if state not in {"cooldown", "quota_exhausted", "auth_expired"}:
        return False
    try:
        path.unlink()
        return True
    except OSError:
        return False


def write_heartbeat(actor_dir: Path, actor_id: str, status: str, metadata: dict[str, Any]) -> Path:
    payload = {
        "actor_id": actor_id,
        "status": status,
        "timestamp": _now_iso(),
        "metadata": metadata,
    }
    path = actor_dir / "heartbeat.json"
    _write_json_atomic(path, payload)
    return path


def next_inbox_task(actor_dir: Path) -> Path | None:
    inbox = actor_dir / "inbox"
    if not inbox.exists():
        return None
    tasks = sorted(inbox.glob("task-*.json"), key=lambda p: (p.stat().st_mtime, p.name))
    return tasks[0] if tasks else None


def processing_task_count(actor_dir: Path) -> int:
    processing = actor_dir / "processing"
    if not processing.exists():
        return 0
    try:
        return sum(1 for _ in processing.glob("task-*.json"))
    except Exception:
        return 0


def _processing_tasks(actor_dir: Path) -> list[Path]:
    processing = actor_dir / "processing"
    if not processing.exists():
        return []
    try:
        return sorted(processing.glob("task-*.json"), key=lambda p: (p.stat().st_mtime, p.name))
    except Exception:
        return []


def _processing_task_markers(actor_dir: Path) -> list[str]:
    markers: list[str] = []
    for task_path in _processing_tasks(actor_dir):
        task = _read_json(task_path)
        task_id = str(task.get("task_id") or "").strip()
        if task_id:
            markers.append(f"Task: {task_id}")
        markers.append(str(task_path))
    return markers


def _latest_processing_prompt(actor_dir: Path) -> Path | None:
    logs = actor_dir / "logs"
    if not logs.exists():
        return None
    candidates = sorted(logs.glob("wake-*.md"), key=lambda p: (p.stat().st_mtime, p.name))
    markers = _processing_task_markers(actor_dir)
    if markers:
        for prompt in reversed(candidates):
            try:
                text = prompt.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue
            if any(marker and marker in text for marker in markers):
                return prompt
    if processing_task_count(actor_dir) == 1 and candidates:
        return candidates[-1]
    return None


def _outbox_result_exists(actor_dir: Path, task_id: str) -> bool:
    if not task_id:
        return False
    outbox = actor_dir / "outbox"
    if not outbox.exists():
        return False
    for path in outbox.glob("result-*.json"):
        payload = _read_json(path)
        if str(payload.get("task_id") or "") == task_id:
            return True
    return False


def _outbox_result_for_task(actor_dir: Path, task_id: str) -> dict[str, Any] | None:
    if not task_id:
        return None
    outbox = actor_dir / "outbox"
    if not outbox.exists():
        return None
    best: tuple[int, float, dict[str, Any]] | None = None
    for path in outbox.glob("*.json"):
        payload = _read_json(path)
        if str(payload.get("task_id") or "") != task_id:
            continue
        try:
            mtime = path.stat().st_mtime
        except OSError:
            mtime = 0.0
        payload["_path"] = str(path)
        richness = 0
        if str(payload.get("summary") or "").strip():
            richness += 4
        if isinstance(payload.get("tests"), dict) and payload["tests"]:
            richness += 3
        if isinstance(payload.get("verified_acceptance"), list) and payload["verified_acceptance"]:
            richness += 2
        if str(payload.get("status") or "").strip().lower() in {"reviewing", "completed"}:
            richness += 1
        if best is None or (richness, mtime) > (best[0], best[1]):
            best = (richness, mtime, payload)
    return best[2] if best else None


def _archive_completed_task(processing_path: Path, actor_dir: Path) -> Path:
    completed = actor_dir / "completed"
    completed.mkdir(parents=True, exist_ok=True)
    dest = completed / processing_path.name
    if dest.exists():
        dest = completed / f"{processing_path.stem}-{_safe_id(_now_iso())}{processing_path.suffix}"
    processing_path.rename(dest)
    return dest


def _archive_dead_letter_task(processing_path: Path, actor_dir: Path) -> Path:
    dead_letter = actor_dir / "dead-letter"
    dead_letter.mkdir(parents=True, exist_ok=True)
    dest = dead_letter / processing_path.name
    if dest.exists():
        dest = dead_letter / f"{processing_path.stem}-{_safe_id(_now_iso())}{processing_path.suffix}"
    processing_path.rename(dest)
    return dest


def _completed_tasks(actor_dir: Path) -> list[Path]:
    completed = actor_dir / "completed"
    if not completed.exists():
        return []
    try:
        return sorted(completed.glob("task-*.json"), key=lambda p: (p.stat().st_mtime, p.name))
    except Exception:
        return []


def _canonical_handoff_path(task: dict[str, Any]) -> Path | None:
    sprint_id = str(task.get("sprint_id") or "").strip()
    node_id = str(task.get("node_id") or "").strip()
    if not sprint_id or not node_id:
        return None
    return HARNESS_DIR / "sprints" / f"{sprint_id}.{node_id}-handoff.md"


def _builder_handoff_path(task: dict[str, Any]) -> Path | None:
    role = str(task.get("requested_role") or task.get("role") or "").strip().lower()
    if role != "builder":
        return None
    return _canonical_handoff_path(task)


def _ensure_builder_handoff_from_result(
    task: dict[str, Any],
    result_path: Path,
    *,
    dry_run: bool = False,
) -> Path | None:
    handoff_path = _builder_handoff_path(task)
    if handoff_path is None:
        return None
    if handoff_path.exists() and handoff_path.stat().st_size > 0:
        return None
    try:
        result_text = result_path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        result_text = ""
    if not result_text.strip():
        return None
    content = "\n".join(
        [
            f"# Builder Handoff — {task.get('node_id') or ''}",
            "",
            "Source: actor_mailbox_wake.result_path_reconcile",
            f"Task: {task.get('task_id') or ''}",
            f"Result: {result_path}",
            "",
            result_text.rstrip(),
            "",
        ]
    )
    if not dry_run:
        handoff_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = handoff_path.with_name(f".{handoff_path.name}.{os.getpid()}.tmp")
        tmp.write_text(content, encoding="utf-8")
        os.replace(tmp, handoff_path)
    return handoff_path


def _task_has_nonrecoverable_smoke_block(task: dict[str, Any]) -> bool:
    task_id = str(task.get("task_id") or "").strip()
    if not task_id.startswith("_smoke"):
        return False
    access = task.get("access_path_decision") if isinstance(task.get("access_path_decision"), dict) else {}
    selected = str(access.get("selected") or "").strip()
    return selected == "no_available_access_path"


def _result_is_fresh_for_task(result_stat: os.stat_result, task_path: Path) -> bool:
    try:
        task_mtime = task_path.stat().st_mtime
    except OSError:
        return True
    return result_stat.st_mtime >= task_mtime - 1.0


def _result_path_matches_task(task: dict[str, Any], result_path: Path) -> bool:
    task_id = str(task.get("task_id") or "").strip()
    if not task_id.startswith("pm-"):
        return True
    if not task_id:
        return False
    try:
        text = result_path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return False
    return task_id in text


def _fresh_eval_sidecar_for_task(task: dict[str, Any], task_path: Path) -> tuple[Path | None, Path | None]:
    sprint_id = str(task.get("sprint_id") or "").strip()
    node_id = str(task.get("node_id") or "").strip()
    if not sprint_id or not node_id:
        return None, None
    base = Path.home() / ".solar" / "harness" / "sprints" / f"{sprint_id}.{node_id}"
    candidates = (base.with_name(f"{base.name}-eval.json"), base.with_name(f"{base.name}-eval.md"))
    fresh: list[Path] = []
    for path in candidates:
        try:
            stat = path.stat()
        except OSError:
            continue
        if stat.st_size <= 0:
            continue
        if not _result_is_fresh_for_task(stat, task_path):
            continue
        fresh.append(path)
    if not fresh:
        return None, None
    eval_json = next((path for path in fresh if path.suffix == ".json"), None)
    eval_md = next((path for path in fresh if path.suffix == ".md"), None)
    return eval_json, eval_md


def _task_graph_key(task: dict[str, Any]) -> tuple[str, str] | None:
    sprint_id = str(task.get("sprint_id") or "").strip()
    node_id = str(task.get("node_id") or "").strip()
    if not sprint_id or not node_id:
        return None
    return sprint_id, node_id


def _completed_graph_keys(actor_dir: Path) -> set[tuple[str, str]]:
    keys: set[tuple[str, str]] = set()
    outbox = actor_dir / "outbox"
    if outbox.exists():
        for path in outbox.glob("*.json"):
            payload = _read_json(path)
            key = _task_graph_key(payload)
            if key is None:
                continue
            status = str(payload.get("status") or "").strip().lower()
            verdict = str(payload.get("verdict") or "").strip().lower()
            if status in {"completed", "reviewing"} and verdict not in {"failed", "error"}:
                keys.add(key)
    for task_path in _completed_tasks(actor_dir):
        task = _read_json(task_path)
        key = _task_graph_key(task)
        if key is not None:
            keys.add(key)
    return keys


def reconcile_duplicate_inbox_tasks(actor_dir: Path, actor_id: str, *, dry_run: bool = False) -> list[dict[str, Any]]:
    inbox = actor_dir / "inbox"
    if not inbox.exists():
        return []
    completed_keys = _completed_graph_keys(actor_dir)
    if not completed_keys:
        return []
    reconciled: list[dict[str, Any]] = []
    for task_path in sorted(inbox.glob("task-*.json"), key=lambda p: (p.stat().st_mtime, p.name)):
        task = _read_json(task_path)
        key = _task_graph_key(task)
        if key is None or key not in completed_keys:
            continue
        task_id = str(task.get("task_id") or task_path.stem).strip()
        dead_letter_path = actor_dir / "dead-letter" / task_path.name
        outbox_path = actor_dir / "outbox" / f"result-{_safe_id(task_id)}-{_safe_id(_now_iso())}.json"
        payload = {
            "task_id": task_id,
            "sprint_id": str(task.get("sprint_id") or ""),
            "node_id": str(task.get("node_id") or ""),
            "operator_id": actor_id,
            "verdict": "skipped",
            "status": "cancelled",
            "source": "actor_mailbox_wake.duplicate_inbox_completed_node",
            "reason": "duplicate_inbox_task_for_completed_graph_node",
            "completed_at": _now_iso(),
            "inbox_path": str(task_path),
            "dead_letter_path": str(dead_letter_path),
            "outbox_path": str(outbox_path),
        }
        if not dry_run:
            actor_dir.joinpath("outbox").mkdir(parents=True, exist_ok=True)
            actor_dir.joinpath("dead-letter").mkdir(parents=True, exist_ok=True)
            if not _outbox_result_exists(actor_dir, task_id):
                _write_json_atomic(outbox_path, payload)
            archived_path = _archive_dead_letter_task(task_path, actor_dir)
            payload["dead_letter_path"] = str(archived_path)
        reconciled.append(payload)
    return reconciled


def _markdown_list(items: Any) -> list[str]:
    if not isinstance(items, list):
        return []
    return [f"- {item}" for item in items if str(item).strip()]


def _restore_pm_artifacts_from_outbox(
    task: dict[str, Any],
    outbox_payload: dict[str, Any],
    *,
    dry_run: bool = False,
) -> tuple[Path | None, Path | None]:
    result_path_raw = str(task.get("result_path") or outbox_payload.get("result_path") or "").strip()
    result_path = Path(result_path_raw).expanduser() if result_path_raw else None
    handoff_path = _canonical_handoff_path(task)
    if result_path is None and handoff_path is None:
        return None, None
    task_id = str(task.get("task_id") or outbox_payload.get("task_id") or "").strip()
    node_id = str(task.get("node_id") or outbox_payload.get("node_id") or "").strip()
    lines = [
        f"# PM Task Result — {task_id or node_id}",
        "",
        "Source: actor_mailbox_wake.outbox_artifact_restore",
        f"Outbox: {outbox_payload.get('_path') or 'N/A'}",
        "",
        "## Summary",
        "",
        str(outbox_payload.get("summary") or outbox_payload.get("status") or "completed").strip(),
        "",
    ]
    tests = outbox_payload.get("tests") if isinstance(outbox_payload.get("tests"), dict) else {}
    if tests:
        lines.extend(
            [
                "## Tests",
                "",
                f"- Command: {tests.get('command') or 'N/A'}",
                f"- Result: {tests.get('result') or 'N/A'}",
                f"- Passed: {tests.get('passed')}",
                "",
            ]
        )
    acceptance = _markdown_list(outbox_payload.get("verified_acceptance"))
    if acceptance:
        lines.extend(["## Verified Acceptance", "", *acceptance, ""])
    risks = _markdown_list(outbox_payload.get("risks"))
    if risks:
        lines.extend(["## Risks", "", *risks, ""])
    content = "\n".join(lines).rstrip() + "\n"
    if not dry_run:
        if result_path is not None and (not result_path.exists() or result_path.stat().st_size <= 0):
            result_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = result_path.with_name(f".{result_path.name}.{os.getpid()}.tmp")
            tmp.write_text(content, encoding="utf-8")
            os.replace(tmp, result_path)
        if handoff_path is not None and (not handoff_path.exists() or handoff_path.stat().st_size <= 0):
            handoff = "\n".join(
                [
                    f"# Builder Handoff — {node_id}",
                    "",
                    "Source: actor_mailbox_wake.outbox_artifact_restore",
                    f"Task: {task_id}",
                    f"Result: {result_path or 'N/A'}",
                    "",
                    content.rstrip(),
                    "",
                ]
            )
            handoff_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = handoff_path.with_name(f".{handoff_path.name}.{os.getpid()}.tmp")
            tmp.write_text(handoff, encoding="utf-8")
            os.replace(tmp, handoff_path)
    return result_path, handoff_path


def reconcile_completed_processing_tasks(actor_dir: Path, actor_id: str, *, dry_run: bool = False) -> list[dict[str, Any]]:
    reconciled: list[dict[str, Any]] = []
    for task_path in [*_processing_tasks(actor_dir), *_completed_tasks(actor_dir)]:
        task = _read_json(task_path)
        task_id = str(task.get("task_id") or task_path.stem).strip()
        is_processing = task_path.parent.name == "processing"
        result_path_raw = str(task.get("result_path") or "").strip()
        if is_processing:
            eval_json, eval_md = _fresh_eval_sidecar_for_task(task, task_path)
            if eval_json is not None or eval_md is not None:
                outbox_path = actor_dir / "outbox" / f"result-{_safe_id(task_id)}-{_safe_id(_now_iso())}.json"
                archived_path = actor_dir / "completed" / task_path.name
                already_has_outbox = _outbox_result_exists(actor_dir, task_id)
                payload = {
                    "task_id": task_id,
                    "sprint_id": str(task.get("sprint_id") or ""),
                    "node_id": str(task.get("node_id") or ""),
                    "operator_id": actor_id,
                    "verdict": "passed",
                    "status": "completed",
                    "source": "actor_mailbox_wake.eval_sidecar_reconcile",
                    "eval_json_path": str(eval_json or ""),
                    "eval_md_path": str(eval_md or ""),
                    "completed_at": _now_iso(),
                    "processing_path": str(task_path),
                    "archived_processing_path": str(archived_path),
                }
                if not dry_run:
                    if not already_has_outbox:
                        _write_json_atomic(outbox_path, payload)
                    archived_path = _archive_completed_task(task_path, actor_dir)
                    payload["archived_processing_path"] = str(archived_path)
                payload["outbox_path"] = str(outbox_path)
                reconciled.append(payload)
                continue
        if not result_path_raw:
            handoff_path = _canonical_handoff_path(task)
            handoff_exists = bool(handoff_path and handoff_path.exists() and handoff_path.stat().st_size > 0)
            if handoff_exists:
                outbox_path = actor_dir / "outbox" / f"result-{_safe_id(task_id)}-{_safe_id(_now_iso())}.json"
                archived_path = actor_dir / "completed" / task_path.name
                already_has_outbox = _outbox_result_exists(actor_dir, task_id)
                if already_has_outbox and not is_processing:
                    continue
                payload = {
                    "task_id": task_id,
                    "sprint_id": str(task.get("sprint_id") or ""),
                    "node_id": str(task.get("node_id") or ""),
                    "operator_id": actor_id,
                    "verdict": "passed",
                    "status": "completed",
                    "source": "actor_mailbox_wake.handoff_reconcile",
                    "handoff_path": str(handoff_path),
                    "completed_at": _now_iso(),
                    "processing_path": str(task_path),
                    "archived_processing_path": str(archived_path),
                }
                if not dry_run:
                    if not already_has_outbox:
                        _write_json_atomic(outbox_path, payload)
                    archived_path = _archive_completed_task(task_path, actor_dir) if is_processing else task_path
                    payload["archived_processing_path"] = str(archived_path)
                payload["outbox_path"] = str(outbox_path)
                reconciled.append(payload)
                continue
            if is_processing and _task_has_nonrecoverable_smoke_block(task):
                outbox_path = actor_dir / "outbox" / f"result-{_safe_id(task_id)}-{_safe_id(_now_iso())}.json"
                archived_path = actor_dir / "dead-letter" / task_path.name
                payload = {
                    "task_id": task_id,
                    "sprint_id": str(task.get("sprint_id") or ""),
                    "node_id": str(task.get("node_id") or ""),
                    "operator_id": actor_id,
                    "verdict": "skipped",
                    "status": "cancelled",
                    "source": "actor_mailbox_wake.stale_smoke_dead_letter",
                    "reason": "nonrecoverable_smoke_no_available_access_path",
                    "completed_at": _now_iso(),
                    "processing_path": str(task_path),
                    "archived_processing_path": str(archived_path),
                }
                if not dry_run:
                    if not _outbox_result_exists(actor_dir, task_id):
                        _write_json_atomic(outbox_path, payload)
                    archived_path = _archive_dead_letter_task(task_path, actor_dir)
                    payload["archived_processing_path"] = str(archived_path)
                payload["outbox_path"] = str(outbox_path)
                reconciled.append(payload)
            continue
        result_path = Path(result_path_raw).expanduser()
        try:
            result_stat = result_path.stat()
        except OSError:
            outbox_payload = _outbox_result_for_task(actor_dir, task_id)
            if not outbox_payload:
                continue
            restored_result_path, restored_handoff_path = _restore_pm_artifacts_from_outbox(
                task,
                outbox_payload,
                dry_run=dry_run,
            )
            if restored_result_path is None and restored_handoff_path is None:
                continue
            reconciled.append(
                {
                    "task_id": task_id,
                    "sprint_id": str(task.get("sprint_id") or ""),
                    "node_id": str(task.get("node_id") or ""),
                    "operator_id": actor_id,
                    "status": str(outbox_payload.get("status") or "completed"),
                    "source": "actor_mailbox_wake.outbox_artifact_restore",
                    "result_path": str(restored_result_path or ""),
                    "handoff_path": str(restored_handoff_path or ""),
                    "processing_path": str(task_path),
                    "archived_processing_path": str(task_path),
                    "outbox_path": str(outbox_payload.get("_path") or ""),
                }
            )
            continue
        if result_stat.st_size <= 0:
            continue
        if is_processing and not _result_is_fresh_for_task(result_stat, task_path):
            continue
        if not _result_path_matches_task(task, result_path):
            continue
        handoff_path = _ensure_builder_handoff_from_result(task, result_path, dry_run=dry_run)
        if _outbox_result_exists(actor_dir, task_id):
            archived_path = None
            if is_processing and not dry_run:
                archived_path = _archive_completed_task(task_path, actor_dir)
            if handoff_path is not None or archived_path is not None:
                reconciled.append(
                    {
                        "task_id": task_id,
                        "sprint_id": str(task.get("sprint_id") or ""),
                        "node_id": str(task.get("node_id") or ""),
                        "operator_id": actor_id,
                        "status": "completed",
                        "source": "actor_mailbox_wake.result_path_reconcile",
                        "result_path": str(result_path),
                        "handoff_path": str(handoff_path or ""),
                        "processing_path": str(task_path),
                        "archived_processing_path": str(archived_path or ""),
                        "outbox_path": "",
                    }
                )
            continue
        if not is_processing:
            if handoff_path is not None:
                reconciled.append(
                    {
                        "task_id": task_id,
                        "sprint_id": str(task.get("sprint_id") or ""),
                        "node_id": str(task.get("node_id") or ""),
                        "operator_id": actor_id,
                        "status": "completed",
                        "source": "actor_mailbox_wake.result_path_reconcile",
                        "result_path": str(result_path),
                        "handoff_path": str(handoff_path),
                        "processing_path": str(task_path),
                        "archived_processing_path": str(task_path),
                        "outbox_path": "",
                    }
                )
            continue
        outbox_path = actor_dir / "outbox" / f"result-{_safe_id(task_id)}-{_safe_id(_now_iso())}.json"
        archived_path = actor_dir / "completed" / task_path.name
        payload = {
            "task_id": task_id,
            "sprint_id": str(task.get("sprint_id") or ""),
            "node_id": str(task.get("node_id") or ""),
            "operator_id": actor_id,
            "verdict": "passed",
            "status": "completed",
            "source": "actor_mailbox_wake.result_path_reconcile",
            "result_path": str(result_path),
            "handoff_path": str(handoff_path or ""),
            "result_size_bytes": result_stat.st_size,
            "result_mtime": dt.datetime.fromtimestamp(result_stat.st_mtime, tz=dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "completed_at": _now_iso(),
            "processing_path": str(task_path),
            "archived_processing_path": str(archived_path),
        }
        if not dry_run:
            _write_json_atomic(outbox_path, payload)
            archived_path = _archive_completed_task(task_path, actor_dir)
            payload["archived_processing_path"] = str(archived_path)
        payload["outbox_path"] = str(outbox_path)
        reconciled.append(payload)
    return reconciled


def stale_processing_prompt(actor_dir: Path, *, after_seconds: int) -> Path | None:
    tasks = _processing_tasks(actor_dir)
    if not tasks:
        return None
    oldest_task = tasks[0]
    age = dt.datetime.now(dt.timezone.utc).timestamp() - oldest_task.stat().st_mtime
    if age < max(1, int(after_seconds)):
        return None
    heartbeat = _read_json(actor_dir / "heartbeat.json")
    metadata = heartbeat.get("metadata") if isinstance(heartbeat.get("metadata"), dict) else {}
    raw_prompt = str(metadata.get("wake_prompt_path") or "").strip()
    if raw_prompt and raw_prompt != ".":
        prompt = Path(raw_prompt)
    else:
        prompt = _latest_processing_prompt(actor_dir) or Path("")
    if str(prompt) in {"", "."}:
        task = _read_json(oldest_task)
        return build_wake_prompt(actor_dir.name, oldest_task, task, actor_dir)
    if not prompt.exists():
        task = _read_json(oldest_task)
        return build_wake_prompt(actor_dir.name, oldest_task, task, actor_dir)
    return prompt


def claim_task(task_path: Path, actor_dir: Path) -> Path:
    processing = actor_dir / "processing"
    processing.mkdir(parents=True, exist_ok=True)
    dest = processing / task_path.name
    try:
        task_path.rename(dest)
    except FileNotFoundError as exc:
        raise RuntimeError(f"inbox task disappeared before claim: {task_path}") from exc
    now = time.time()
    os.utime(dest, (now, now))
    return dest


def touch_processing_tasks(actor_dir: Path) -> None:
    now = time.time()
    for task_path in _processing_tasks(actor_dir):
        try:
            os.utime(task_path, (now, now))
        except OSError:
            continue


def build_wake_prompt(actor_id: str, processing_path: Path, task: dict[str, Any], actor_dir: Path) -> Path:
    task_id = str(task.get("task_id") or processing_path.stem)
    sprint_id = str(task.get("sprint_id") or "")
    node_id = str(task.get("node_id") or "")
    dispatch_file = str(task.get("dispatch_file") or "")
    result_path = str(task.get("result_path") or "")
    prompt = "\n".join(
        [
            "Solar Harness actor mailbox wake.",
            "",
            f"Actor: {actor_id}",
            f"Task: {task_id}",
            f"Sprint: {sprint_id}",
            f"Node: {node_id}",
            f"Mailbox processing envelope: {processing_path}",
            f"Graph dispatch file: {dispatch_file}",
            f"Expected result path: {result_path}",
            "",
            "请完整读取 mailbox processing envelope 和 graph dispatch file。",
            "不要只总结；请执行节点要求，并按 dispatch 文件里的 closeout/verdict 规则回写。",
            "完成后把机器可读结果写入 actor outbox，或在要求的 result path/sidecar 中留下证据。",
        ]
    )
    logs = actor_dir / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    path = logs / f"wake-{_safe_id(task_id)}-{_safe_id(_now_iso())}.md"
    path.write_text(prompt + "\n", encoding="utf-8")
    return path


def send_wake_to_pane(pane: str, prompt_path: Path, *, dismiss_feedback: bool = False) -> None:
    message = f"读取并执行 {prompt_path}"
    buffer_name = f"solar_actor_wake_{os.getpid()}"
    subprocess.run(["tmux", "send-keys", "-t", pane, "C-u"], check=False)
    subprocess.run(["tmux", "set-buffer", "-b", buffer_name, message], check=True)
    subprocess.run(["tmux", "paste-buffer", "-b", buffer_name, "-t", pane], check=True)
    subprocess.run(["tmux", "delete-buffer", "-b", buffer_name], check=False)
    time.sleep(0.25)
    subprocess.run(["tmux", "send-keys", "-t", pane, "Enter"], check=True)
    time.sleep(0.5)
    tail = capture_pane_tail(pane, lines=25)
    if message in tail and not tail_indicates_busy(tail):
        subprocess.run(["tmux", "send-keys", "-t", pane, "Enter"], check=True)


def wake_actor(
    actor_id: str,
    pane: str,
    *,
    dry_run: bool = False,
    auth_ttl_seconds: int = 3600,
    quota_ttl_seconds: int = 1800,
    rewake_processing_after_seconds: int = 900,
) -> dict[str, Any]:
    actor_dir = ACTORS_DIR / actor_id
    actor_dir.mkdir(parents=True, exist_ok=True)

    preflight_reconciled = reconcile_completed_processing_tasks(actor_dir, actor_id, dry_run=dry_run)
    if preflight_reconciled:
        remaining_processing = processing_task_count(actor_dir)
        has_next_task = remaining_processing == 0 and next_inbox_task(actor_dir) is not None
        has_remaining_processing = remaining_processing > 0
        if has_next_task or has_remaining_processing:
            # Continue into the normal wake path so a cleanup-only preflight does
            # not burn an entire scanner interval while runnable inbox or stale
            # processing work waits.
            pass
        else:
            status = "processing" if remaining_processing > 0 else "idle"
            heartbeat_path = None if dry_run else write_heartbeat(
                actor_dir,
                actor_id,
                status,
                {
                    "pane": pane,
                    "reason": "processing_result_reconciled",
                    "reconcile_phase": "preflight",
                    "reconciled_count": len(preflight_reconciled),
                    "remaining_processing_count": remaining_processing,
                    "outbox_paths": [str(item.get("outbox_path") or "") for item in preflight_reconciled],
                },
            )
            return {
                "ok": True,
                "status": status,
                "reason": "processing_result_reconciled" if not dry_run else "dry_run_processing_result_reconcile",
                "reconcile_phase": "preflight",
                "actor_id": actor_id,
                "pane": pane,
                "claimed": False,
                "rewoken": False,
                "reconciled_count": len(preflight_reconciled),
                "remaining_processing_count": remaining_processing,
                "outbox_paths": [str(item.get("outbox_path") or "") for item in preflight_reconciled],
                "heartbeat_path": str(heartbeat_path or ""),
            }

    tail = capture_pane_tail(pane)
    tail_state, reason = classify_tail(tail)
    if tail_state != "ok":
        ttl = auth_ttl_seconds if tail_state in {"auth_expired", "runtime_misroute"} else quota_ttl_seconds
        status_path = None if dry_run else write_operator_status(
            actor_id,
            tail_state,
            reason=reason,
            excerpt=tail,
            ttl_seconds=ttl,
        )
        heartbeat_path = None if dry_run else write_heartbeat(
            actor_dir,
            actor_id,
            tail_state,
            {"pane": pane, "reason": reason, "operator_status_path": str(status_path or "")},
        )
        return {
            "ok": False,
            "status": tail_state,
            "reason": reason,
            "actor_id": actor_id,
            "pane": pane,
            "claimed": False,
            "operator_status_path": str(status_path or ""),
            "heartbeat_path": str(heartbeat_path or ""),
        }

    status_cleared = False if dry_run else clear_operator_status_if_blocked(actor_id)
    reconciled = reconcile_completed_processing_tasks(actor_dir, actor_id, dry_run=dry_run)
    remaining_processing = processing_task_count(actor_dir)
    duplicate_inbox_reconciled: list[dict[str, Any]] = []
    if reconciled:
        if remaining_processing == 0:
            duplicate_inbox_reconciled = reconcile_duplicate_inbox_tasks(actor_dir, actor_id, dry_run=dry_run)
        if remaining_processing == 0 and next_inbox_task(actor_dir) is None:
            status = "processing" if remaining_processing > 0 else "idle"
            heartbeat_path = None if dry_run else write_heartbeat(
                actor_dir,
                actor_id,
                status,
                {
                    "pane": pane,
                    "reason": "processing_result_reconciled",
                    "operator_status_cleared": status_cleared,
                    "reconciled_count": len(reconciled),
                    "duplicate_inbox_reconciled_count": len(duplicate_inbox_reconciled),
                    "remaining_processing_count": remaining_processing,
                    "outbox_paths": [str(item.get("outbox_path") or "") for item in reconciled],
                    "duplicate_outbox_paths": [str(item.get("outbox_path") or "") for item in duplicate_inbox_reconciled],
                },
            )
            return {
                "ok": True,
                "status": status,
                "reason": "processing_result_reconciled" if not dry_run else "dry_run_processing_result_reconcile",
                "actor_id": actor_id,
                "pane": pane,
                "claimed": False,
                "rewoken": False,
                "operator_status_cleared": status_cleared,
                "reconciled_count": len(reconciled),
                "duplicate_inbox_reconciled_count": len(duplicate_inbox_reconciled),
                "remaining_processing_count": remaining_processing,
                "outbox_paths": [str(item.get("outbox_path") or "") for item in reconciled],
                "duplicate_outbox_paths": [str(item.get("outbox_path") or "") for item in duplicate_inbox_reconciled],
                "heartbeat_path": str(heartbeat_path or ""),
            }

    if remaining_processing == 0:
        duplicate_inbox_reconciled = reconcile_duplicate_inbox_tasks(actor_dir, actor_id, dry_run=dry_run)
        task_path = next_inbox_task(actor_dir)
        if not task_path and duplicate_inbox_reconciled:
            reason = "duplicate_inbox_reconciled"
            heartbeat_path = None if dry_run else write_heartbeat(
                actor_dir,
                actor_id,
                "idle",
                {
                    "pane": pane,
                    "reason": reason,
                    "operator_status_cleared": status_cleared,
                    "duplicate_inbox_reconciled_count": len(duplicate_inbox_reconciled),
                    "remaining_processing_count": remaining_processing,
                    "duplicate_outbox_paths": [str(item.get("outbox_path") or "") for item in duplicate_inbox_reconciled],
                },
            )
            return {
                "ok": True,
                "status": "idle",
                "reason": reason if not dry_run else f"dry_run_{reason}",
                "actor_id": actor_id,
                "pane": pane,
                "claimed": False,
                "rewoken": False,
                "operator_status_cleared": status_cleared,
                "duplicate_inbox_reconciled_count": len(duplicate_inbox_reconciled),
                "remaining_processing_count": remaining_processing,
                "duplicate_outbox_paths": [str(item.get("outbox_path") or "") for item in duplicate_inbox_reconciled],
                "heartbeat_path": str(heartbeat_path or ""),
            }
    else:
        task_path = None

    if remaining_processing > 0:
        if remaining_processing > 1:
            processing_paths = [str(path) for path in _processing_tasks(actor_dir)]
            heartbeat_path = None if dry_run else write_heartbeat(
                actor_dir,
                actor_id,
                "processing",
                {
                    "pane": pane,
                    "reason": "multiple_processing_blocked",
                    "operator_status_cleared": status_cleared,
                    "processing_count": remaining_processing,
                    "processing_paths": processing_paths,
                },
            )
            return {
                "ok": True,
                "status": "processing",
                "reason": "multiple_processing_blocked",
                "actor_id": actor_id,
                "pane": pane,
                "claimed": False,
                "rewoken": False,
                "operator_status_cleared": status_cleared,
                "processing_count": remaining_processing,
                "processing_paths": processing_paths,
                "heartbeat_path": str(heartbeat_path or ""),
            }
        if tail_indicates_busy(tail):
            heartbeat_path = None if dry_run else write_heartbeat(
                actor_dir,
                actor_id,
                "processing",
                {
                    "pane": pane,
                    "reason": "processing_active",
                    "operator_status_cleared": status_cleared,
                    "processing_count": remaining_processing,
                },
            )
            return {
                "ok": True,
                "status": "processing",
                "reason": "processing_active",
                "actor_id": actor_id,
                "pane": pane,
                "claimed": False,
                "rewoken": False,
                "operator_status_cleared": status_cleared,
                "heartbeat_path": str(heartbeat_path or ""),
            }
        prompt_path = stale_processing_prompt(actor_dir, after_seconds=rewake_processing_after_seconds)
        if prompt_path is None and tail_has_interrupt_ready_prompt(tail):
            processing_tasks = _processing_tasks(actor_dir)
            if processing_tasks:
                prompt_path = _latest_processing_prompt(actor_dir) or build_wake_prompt(
                    actor_id,
                    processing_tasks[0],
                    _read_json(processing_tasks[0]),
                    actor_dir,
                )
        if prompt_path is not None:
            if not dry_run:
                send_wake_to_pane(pane, prompt_path, dismiss_feedback=tail_needs_feedback_dismissal(tail))
                touch_processing_tasks(actor_dir)
                heartbeat_path = write_heartbeat(
                    actor_dir,
                    actor_id,
                    "processing",
                    {
                        "pane": pane,
                        "reason": "rewake_processing",
                        "wake_prompt_path": str(prompt_path),
                        "operator_status_cleared": status_cleared,
                        "dismissed_feedback_prompt": tail_needs_feedback_dismissal(tail),
                    },
                )
            else:
                heartbeat_path = None
            return {
                "ok": True,
                "status": "processing",
                "reason": "rewake_processing" if not dry_run else "dry_run_rewake_processing",
                "actor_id": actor_id,
                "pane": pane,
                "claimed": False,
                "rewoken": not dry_run,
                "operator_status_cleared": status_cleared,
                "wake_prompt_path": str(prompt_path),
                "dismissed_feedback_prompt": tail_needs_feedback_dismissal(tail),
                "heartbeat_path": str(heartbeat_path or ""),
            }
        heartbeat_path = None if dry_run else write_heartbeat(
            actor_dir,
            actor_id,
            "processing",
            {
                "pane": pane,
                "reason": "processing_not_stale",
                "operator_status_cleared": status_cleared,
                "processing_count": remaining_processing,
            },
        )
        return {
            "ok": True,
            "status": "processing",
            "reason": "processing_not_stale",
            "actor_id": actor_id,
            "pane": pane,
            "claimed": False,
            "rewoken": False,
            "operator_status_cleared": status_cleared,
            "heartbeat_path": str(heartbeat_path or ""),
        }

    if tail_indicates_busy(tail):
        heartbeat_path = None if dry_run else write_heartbeat(
            actor_dir,
            actor_id,
            "processing",
            {
                "pane": pane,
                "reason": "pane_busy_without_processing",
                "operator_status_cleared": status_cleared,
                "processing_count": remaining_processing,
            },
        )
        return {
            "ok": True,
            "status": "processing",
            "reason": "pane_busy_without_processing",
            "actor_id": actor_id,
            "pane": pane,
            "claimed": False,
            "rewoken": False,
            "operator_status_cleared": status_cleared,
            "heartbeat_path": str(heartbeat_path or ""),
        }

    if not task_path:
        task_path = next_inbox_task(actor_dir)
    if not task_path:
        heartbeat_path = None if dry_run else write_heartbeat(
            actor_dir,
            actor_id,
            "idle",
            {"pane": pane, "reason": "no_inbox_task", "operator_status_cleared": status_cleared},
        )
        return {
            "ok": True,
            "status": "idle",
            "reason": "no_inbox_task",
            "actor_id": actor_id,
            "pane": pane,
            "claimed": False,
            "operator_status_cleared": status_cleared,
            "heartbeat_path": str(heartbeat_path or ""),
        }

    task = _read_json(task_path)
    processing_path = task_path if dry_run else claim_task(task_path, actor_dir)
    prompt_path = build_wake_prompt(actor_id, processing_path, task, actor_dir) if not dry_run else actor_dir / "logs" / "dry-run-wake.md"
    if not dry_run:
        send_wake_to_pane(pane, prompt_path, dismiss_feedback=tail_needs_feedback_dismissal(tail))
    heartbeat_path = None if dry_run else write_heartbeat(
        actor_dir,
        actor_id,
        "processing",
        {
            "pane": pane,
            "task_id": str(task.get("task_id") or ""),
            "processing_path": str(processing_path),
            "wake_prompt_path": str(prompt_path),
            "operator_status_cleared": status_cleared,
            "dismissed_feedback_prompt": tail_needs_feedback_dismissal(tail),
        },
    )
    return {
        "ok": True,
        "status": "processing",
        "reason": "wake_sent" if not dry_run else "dry_run",
        "actor_id": actor_id,
        "pane": pane,
        "claimed": not dry_run,
        "task_id": str(task.get("task_id") or ""),
        "processing_path": str(processing_path),
        "wake_prompt_path": str(prompt_path),
        "operator_status_cleared": status_cleared,
        "dismissed_feedback_prompt": tail_needs_feedback_dismissal(tail),
        "heartbeat_path": str(heartbeat_path or ""),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--actor", required=True, help="Actor/operator id, e.g. mini-claude-sonnet-builder")
    parser.add_argument("--pane", required=True, help="tmux pane target, e.g. solar-harness-lab:0.3")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--auth-ttl-seconds", type=int, default=3600)
    parser.add_argument("--quota-ttl-seconds", type=int, default=1800)
    parser.add_argument("--rewake-processing-after-seconds", type=int, default=900)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)

    try:
        result = wake_actor(
            args.actor,
            args.pane,
            dry_run=args.dry_run,
            auth_ttl_seconds=args.auth_ttl_seconds,
            quota_ttl_seconds=args.quota_ttl_seconds,
            rewake_processing_after_seconds=args.rewake_processing_after_seconds,
        )
    except Exception as exc:
        result = {
            "ok": False,
            "status": "error",
            "reason": str(exc),
            "actor_id": args.actor,
            "pane": args.pane,
            "claimed": False,
        }
        if args.as_json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(result.get("reason") or result.get("status"))
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
