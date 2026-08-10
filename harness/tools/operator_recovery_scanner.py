#!/usr/bin/env python3
"""Scan blocked operators and release recovered cooldown/quota states."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", str(Path(__file__).resolve().parents[1])))
LIB_DIR = HARNESS_DIR / "lib"
TOOLS_DIR = HARNESS_DIR / "tools"
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import operator_cooldown_db  # type: ignore


BLOCKING_STATES = {"cooldown", "quota_exhausted", "auth_expired"}
RUN_DIR = HARNESS_DIR / "run" / "operator-recovery-scanner"
LATEST_PATH = RUN_DIR / "latest.json"
HISTORY_PATH = RUN_DIR / "history.jsonl"
STATUS_DIR = HARNESS_DIR / "run" / "operator-status"
ACTORS_DIR = HARNESS_DIR / "actors"
ACTOR_MAILBOX_WAKE_TARGETS_PATH = HARNESS_DIR / "config" / "actor-mailbox-wake-targets.json"
REGISTRY_PATH = HARNESS_DIR / "config" / "physical-operators.json"
AUTH_REPAIR_REQUESTS_DIR = HARNESS_DIR / "run" / "auth-repair-requests"
DEFAULT_ACTOR_MAILBOX_WAKE_TARGETS = {
    "mini-claude-sonnet-builder": "solar-harness-lab:0.3",
}
DEFAULT_ACTOR_RESPAWN_COMMANDS = {
    "mini-claude-sonnet-builder": (
        "/Users/lisihao/n/bin/claude "
        "--dangerously-skip-permissions "
        "--permission-mode bypassPermissions "
        "--model sonnet"
    ),
}
DEFAULT_ACTOR_RESPAWN_CWD = {
    "mini-claude-sonnet-builder": str(Path.home() / "Solar"),
}


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _iso(moment: dt.datetime | None = None) -> str:
    return (moment or _now()).astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _load_operator_registry() -> dict[str, Any]:
    data = _load_json(REGISTRY_PATH, {"operators": {}})
    return data if isinstance(data, dict) else {"operators": {}}


def _operator_spec(registry: dict[str, Any], operator_id: str) -> dict[str, Any]:
    operators = registry.get("operators") if isinstance(registry.get("operators"), dict) else {}
    spec = operators.get(operator_id) if isinstance(operators, dict) else {}
    return spec if isinstance(spec, dict) else {}


def _is_disabled_deprecated_claude_print_operator(spec: dict[str, Any]) -> bool:
    if not spec:
        return False
    provider = str(spec.get("provider") or "").strip().lower()
    backend = str(spec.get("backend") or "").strip().lower()
    launch_kind = str(spec.get("launch_cmd_kind") or "").strip().lower()
    surface = spec.get("surface") if isinstance(spec.get("surface"), dict) else {}
    surface_type = str(surface.get("type") or "").strip().lower()
    pool = spec.get("builder_pool") if isinstance(spec.get("builder_pool"), dict) else {}
    disabled_reason = str(pool.get("disabled_reason") or spec.get("health_status") or "").strip().lower()
    disabled = spec.get("enabled") is False or spec.get("available") is False or pool.get("enabled") is False
    deprecated = bool(spec.get("deprecated")) or "deprecated" in disabled_reason
    print_once = launch_kind == "print_once" or surface_type == "claude_print" or "print_once" in disabled_reason
    claude = provider == "anthropic" or backend == "claude-cli"
    unsupported = "print_once_unsupported" in disabled_reason or "unsupported" in disabled_reason
    return claude and disabled and print_once and (deprecated or unsupported)


def _is_active_claude_interactive_operator(spec: dict[str, Any]) -> bool:
    if not spec:
        return False
    provider = str(spec.get("provider") or "").strip().lower()
    backend = str(spec.get("backend") or "").strip().lower()
    launch_kind = str(spec.get("launch_cmd_kind") or "").strip().lower()
    auth_mode = str(spec.get("auth_mode") or "").strip().lower()
    surface = spec.get("surface") if isinstance(spec.get("surface"), dict) else {}
    surface_type = str(surface.get("type") or "").strip().lower()
    claude = provider == "anthropic" or backend == "claude-cli"
    enabled = spec.get("enabled") is not False and spec.get("available") is not False
    interactive = launch_kind == "interactive_repl" or surface_type == "claude_code_interactive"
    return claude and enabled and interactive and auth_mode == "subscription"


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")


def _status_path(operator_id: str) -> Path:
    return STATUS_DIR / f"{operator_id}.json"


def _actor_inbox_task_count(operator_id: str) -> int:
    inbox = ACTORS_DIR / operator_id / "inbox"
    if not inbox.exists():
        return 0
    try:
        return sum(1 for _ in inbox.glob("task-*.json"))
    except Exception:
        return 0


def _actor_processing_task_count(operator_id: str) -> int:
    processing = ACTORS_DIR / operator_id / "processing"
    if not processing.exists():
        return 0
    try:
        return sum(1 for _ in processing.glob("task-*.json"))
    except Exception:
        return 0


def _runtime_status_state(operator_id: str) -> str:
    path = _status_path(operator_id)
    data = _load_json(path, {}) if path.exists() else {}
    if not isinstance(data, dict):
        return ""
    return str(data.get("runtime_state") or data.get("state") or "").strip().lower()


def _actor_mailbox_wake_config() -> dict[str, Any]:
    data = _load_json(ACTOR_MAILBOX_WAKE_TARGETS_PATH, {})
    return data if isinstance(data, dict) else {}


def _configured_actor_targets() -> dict[str, dict[str, str]]:
    data = _actor_mailbox_wake_config()
    raw_targets = data.get("targets")
    if not isinstance(raw_targets, dict):
        return {}
    targets: dict[str, dict[str, str]] = {}
    for actor_id, raw_target in raw_targets.items():
        actor = str(actor_id).strip()
        if not actor:
            continue
        if isinstance(raw_target, str):
            pane = raw_target.strip()
            if pane:
                targets[actor] = {"pane": pane}
            continue
        if not isinstance(raw_target, dict):
            continue
        pane = str(raw_target.get("pane") or "").strip()
        if not pane:
            continue
        target: dict[str, str] = {"pane": pane}
        for key in ("respawn_command", "respawn_cwd"):
            value = str(raw_target.get(key) or "").strip()
            if value:
                target[key] = value
        targets[actor] = target
    return targets


def _configured_reroute_map() -> dict[str, str]:
    data = _actor_mailbox_wake_config()
    raw = data.get("reroute_unmapped_inbox")
    if not isinstance(raw, dict):
        return {}
    reroutes: dict[str, str] = {}
    for source, target in raw.items():
        source_actor = str(source).strip()
        target_actor = str(target).strip()
        if source_actor and target_actor and source_actor != target_actor:
            reroutes[source_actor] = target_actor
    return reroutes


def _configured_dead_letter_map() -> dict[str, str]:
    data = _actor_mailbox_wake_config()
    raw = data.get("dead_letter_unmapped_inbox")
    if not isinstance(raw, dict):
        return {}
    disabled: dict[str, str] = {}
    for actor_id, reason in raw.items():
        actor = str(actor_id).strip()
        reason_text = str(reason or "").strip()
        if actor:
            disabled[actor] = reason_text or "unmapped_actor_disabled"
    return disabled


def _configured_rebalance_rules() -> list[dict[str, Any]]:
    data = _actor_mailbox_wake_config()
    raw = data.get("rebalance_mapped_inbox")
    if not isinstance(raw, list):
        return []
    rules: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        source = str(item.get("source_actor") or "").strip()
        target = str(item.get("target_actor") or "").strip()
        if not source or not target or source == target:
            continue
        try:
            max_per_scan = max(0, int(item.get("max_per_scan", 0) or 0))
        except Exception:
            max_per_scan = 0
        try:
            source_min_inbox = max(0, int(item.get("source_min_inbox", 0) or 0))
        except Exception:
            source_min_inbox = 0
        try:
            target_max_inbox = max(0, int(item.get("target_max_inbox", 0) or 0))
        except Exception:
            target_max_inbox = 0
        if max_per_scan <= 0:
            continue
        rules.append(
            {
                "source_actor": source,
                "target_actor": target,
                "max_per_scan": max_per_scan,
                "source_min_inbox": source_min_inbox,
                "target_max_inbox": target_max_inbox,
                "reason": str(item.get("reason") or "mapped_actor_queue_rebalance").strip(),
            }
        )
    return rules


def _actor_mailbox_wake_targets() -> dict[str, str]:
    raw = str(os.environ.get("SOLAR_ACTOR_MAILBOX_WAKE_MAP") or "").strip()
    if not raw:
        configured = _configured_actor_targets()
        if configured:
            return {actor_id: target["pane"] for actor_id, target in configured.items()}
        return dict(DEFAULT_ACTOR_MAILBOX_WAKE_TARGETS)
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {
                str(actor).strip(): str(pane).strip()
                for actor, pane in parsed.items()
                if str(actor).strip() and str(pane).strip()
            }
    except Exception:
        pass
    targets: dict[str, str] = {}
    for item in raw.split(","):
        if "=" not in item:
            continue
        actor, pane = item.split("=", 1)
        actor = actor.strip()
        pane = pane.strip()
        if actor and pane:
            targets[actor] = pane
    return targets or dict(DEFAULT_ACTOR_MAILBOX_WAKE_TARGETS)


def _actor_respawn_commands() -> dict[str, str]:
    raw = str(os.environ.get("SOLAR_ACTOR_RESPAWN_COMMANDS") or "").strip()
    if not raw:
        commands = dict(DEFAULT_ACTOR_RESPAWN_COMMANDS)
        for actor_id, target in _configured_actor_targets().items():
            command = str(target.get("respawn_command") or "").strip()
            if command:
                commands[actor_id] = command
        return commands
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return {
                str(actor).strip(): str(command).strip()
                for actor, command in parsed.items()
                if str(actor).strip() and str(command).strip()
            }
    except Exception:
        pass
    return dict(DEFAULT_ACTOR_RESPAWN_COMMANDS)


def _actor_respawn_cwd(actor_id: str) -> str:
    raw = str(os.environ.get("SOLAR_ACTOR_RESPAWN_CWD_MAP") or "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                value = str(parsed.get(actor_id) or "").strip()
                if value:
                    return value
        except Exception:
            pass
    configured = _configured_actor_targets().get(actor_id, {})
    configured_cwd = str(configured.get("respawn_cwd") or "").strip()
    if configured_cwd:
        return configured_cwd
    return DEFAULT_ACTOR_RESPAWN_CWD.get(actor_id, str(HARNESS_DIR))


def _collect_unmapped_actor_backlog(targets: dict[str, str]) -> list[dict[str, Any]]:
    if not ACTORS_DIR.exists():
        return []
    items: list[dict[str, Any]] = []
    try:
        actor_dirs = [path for path in ACTORS_DIR.iterdir() if path.is_dir()]
    except Exception:
        return []
    for actor_dir in sorted(actor_dirs, key=lambda path: path.name):
        actor_id = actor_dir.name
        if actor_id in targets:
            continue
        inbox_count = _actor_inbox_task_count(actor_id)
        processing_count = _actor_processing_task_count(actor_id)
        if inbox_count <= 0 and processing_count <= 0:
            continue
        items.append(
            {
                "operator_id": actor_id,
                "inbox_count": inbox_count,
                "processing_count": processing_count,
                "runtime_state": _runtime_status_state(actor_id),
                "reason": "actor_mailbox_wake_target_unmapped",
            }
        )
    return items


def _summarize_unmapped_backlog(items: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "count": len(items),
        "inbox_total": sum(int(item.get("inbox_count") or 0) for item in items),
        "processing_total": sum(int(item.get("processing_count") or 0) for item in items),
        "items": items,
    }


def _actor_inbox_tasks(operator_id: str) -> list[Path]:
    inbox = ACTORS_DIR / operator_id / "inbox"
    if not inbox.exists():
        return []
    try:
        return sorted(inbox.glob("task-*.json"), key=lambda path: (path.stat().st_mtime, path.name))
    except Exception:
        return []


def _move_inbox_task(
    task_path: Path,
    *,
    source_actor: str,
    target_actor: str,
    reason: str,
    apply: bool,
) -> tuple[bool, str]:
    target_inbox = ACTORS_DIR / target_actor / "inbox"
    target_path = target_inbox / task_path.name
    if target_path.exists():
        target_path = target_inbox / f"task-rerouted-from-{source_actor}-{task_path.name.removeprefix('task-')}"
    if not apply:
        return True, str(target_path)
    payload = _load_json(task_path, None)
    if not isinstance(payload, dict):
        return False, "invalid_json_task_envelope"
    payload.setdefault("reroute_history", [])
    if isinstance(payload["reroute_history"], list):
        payload["reroute_history"].append(
            {
                "from_actor": source_actor,
                "to_actor": target_actor,
                "rerouted_at": _iso(),
                "source": "operator_recovery_scanner",
                "reason": reason,
            }
        )
    payload["original_actor_id"] = payload.get("original_actor_id") or source_actor
    payload["rerouted_from_actor_id"] = source_actor
    payload["actor_id"] = target_actor
    target_inbox.mkdir(parents=True, exist_ok=True)
    _write_json(target_path, payload)
    task_path.unlink()
    return True, str(target_path)


def _reroute_unmapped_inbox(
    targets: dict[str, str],
    *,
    apply: bool,
) -> dict[str, Any]:
    reroutes = _configured_reroute_map()
    items: list[dict[str, Any]] = []
    moved = 0
    scanned = 0
    for source_actor, target_actor in sorted(reroutes.items()):
        if source_actor in targets:
            continue
        if target_actor not in targets:
            items.append(
                {
                    "source_actor": source_actor,
                    "target_actor": target_actor,
                    "ok": False,
                    "reason": "target_actor_not_wake_mapped",
                    "moved": 0,
                }
            )
            continue
        source_tasks = _actor_inbox_tasks(source_actor)
        scanned += len(source_tasks)
        source_moved = 0
        source_errors: list[dict[str, str]] = []
        for task_path in source_tasks:
            ok, detail = _move_inbox_task(
                task_path,
                source_actor=source_actor,
                target_actor=target_actor,
                reason="source_actor_has_no_mailbox_wake_target",
                apply=apply,
            )
            if not ok:
                source_errors.append({"task_path": str(task_path), "reason": detail})
                continue
            source_moved += 1
            moved += 1
        items.append(
            {
                "source_actor": source_actor,
                "target_actor": target_actor,
                "ok": not source_errors,
                "reason": "rerouted" if not source_errors else "partial_reroute_errors",
                "scanned": len(source_tasks),
                "moved": source_moved,
                "errors": source_errors,
            }
        )
    return {
        "ok": all(bool(item.get("ok")) for item in items),
        "applied": apply,
        "configured": len(reroutes),
        "scanned": scanned,
        "moved": moved,
        "items": items,
    }


def _rebalance_mapped_inbox(
    targets: dict[str, str],
    *,
    apply: bool,
) -> dict[str, Any]:
    rules = _configured_rebalance_rules()
    items: list[dict[str, Any]] = []
    moved = 0
    scanned = 0
    for rule in rules:
        source_actor = str(rule["source_actor"])
        target_actor = str(rule["target_actor"])
        reason = str(rule.get("reason") or "mapped_actor_queue_rebalance")
        if source_actor not in targets or target_actor not in targets:
            items.append(
                {
                    "source_actor": source_actor,
                    "target_actor": target_actor,
                    "ok": False,
                    "reason": "source_or_target_not_wake_mapped",
                    "moved": 0,
                }
            )
            continue
        source_tasks = _actor_inbox_tasks(source_actor)
        source_count = len(source_tasks)
        scanned += source_count
        if source_count <= int(rule["source_min_inbox"]):
            items.append(
                {
                    "source_actor": source_actor,
                    "target_actor": target_actor,
                    "ok": True,
                    "reason": "source_below_threshold",
                    "source_inbox_count": source_count,
                    "moved": 0,
                }
            )
            continue
        target_count = _actor_inbox_task_count(target_actor)
        capacity = int(rule["max_per_scan"])
        target_max = int(rule["target_max_inbox"])
        if target_max > 0:
            capacity = min(capacity, max(0, target_max - target_count))
        source_moved = 0
        errors: list[dict[str, str]] = []
        for task_path in source_tasks[:capacity]:
            ok, detail = _move_inbox_task(
                task_path,
                source_actor=source_actor,
                target_actor=target_actor,
                reason=reason,
                apply=apply,
            )
            if not ok:
                errors.append({"task_path": str(task_path), "reason": detail})
                continue
            source_moved += 1
            moved += 1
        items.append(
            {
                "source_actor": source_actor,
                "target_actor": target_actor,
                "ok": not errors,
                "reason": reason if not errors else "partial_rebalance_errors",
                "source_inbox_count": source_count,
                "target_inbox_count": target_count,
                "max_per_scan": int(rule["max_per_scan"]),
                "moved": source_moved,
                "errors": errors,
            }
        )
    return {
        "ok": all(bool(item.get("ok")) for item in items),
        "applied": apply,
        "configured": len(rules),
        "scanned": scanned,
        "moved": moved,
        "items": items,
    }


def _dead_letter_unmapped_inbox(*, apply: bool) -> dict[str, Any]:
    disabled = _configured_dead_letter_map()
    items: list[dict[str, Any]] = []
    scanned = 0
    moved = 0
    for actor_id, reason in sorted(disabled.items()):
        source_tasks = _actor_inbox_tasks(actor_id)
        scanned += len(source_tasks)
        actor_dir = ACTORS_DIR / actor_id
        dead_letter = actor_dir / "dead-letter"
        outbox = actor_dir / "outbox"
        source_moved = 0
        errors: list[dict[str, str]] = []
        for task_path in source_tasks:
            task = _load_json(task_path, None)
            if not isinstance(task, dict):
                errors.append({"task_path": str(task_path), "reason": "invalid_json_task_envelope"})
                continue
            task_id = str(task.get("task_id") or task_path.stem).strip()
            outbox_path = outbox / f"result-{task_id}-{_iso().replace(':', '-')}.json"
            dead_letter_path = dead_letter / task_path.name
            if dead_letter_path.exists():
                dead_letter_path = dead_letter / f"{task_path.stem}-{_iso().replace(':', '-')}{task_path.suffix}"
            payload = {
                "task_id": task_id,
                "sprint_id": str(task.get("sprint_id") or ""),
                "node_id": str(task.get("node_id") or ""),
                "operator_id": actor_id,
                "status": "cancelled",
                "verdict": "skipped",
                "source": "operator_recovery_scanner.disabled_unmapped_actor",
                "reason": reason,
                "completed_at": _iso(),
                "inbox_path": str(task_path),
                "dead_letter_path": str(dead_letter_path),
                "outbox_path": str(outbox_path),
            }
            if apply:
                outbox.mkdir(parents=True, exist_ok=True)
                dead_letter.mkdir(parents=True, exist_ok=True)
                _write_json(outbox_path, payload)
                task_path.rename(dead_letter_path)
            source_moved += 1
            moved += 1
        status_path = _status_path(actor_id)
        if apply:
            _write_json(
                status_path,
                {
                    "operator_id": actor_id,
                    "runtime_state": "disabled",
                    "state": "disabled",
                    "reason": reason,
                    "source": "operator_recovery_scanner",
                    "updated_at": _iso(),
                    "last_error": reason,
                },
            )
        items.append(
            {
                "operator_id": actor_id,
                "ok": not errors,
                "reason": reason,
                "scanned": len(source_tasks),
                "moved": source_moved,
                "status_path": str(status_path),
                "errors": errors,
            }
        )
    return {
        "ok": all(bool(item.get("ok")) for item in items),
        "applied": apply,
        "configured": len(disabled),
        "scanned": scanned,
        "moved": moved,
        "items": items,
    }


def _tmux_pane_dead(pane: str) -> tuple[bool, str]:
    proc = subprocess.run(
        ["tmux", "display-message", "-p", "-t", pane, "#{pane_dead}"],
        text=True,
        capture_output=True,
        check=False,
        timeout=10,
    )
    if proc.returncode != 0:
        return True, (proc.stderr or proc.stdout or "tmux_display_failed").strip()
    return proc.stdout.strip() == "1", ""


def _capture_pane_excerpt(pane: str) -> str:
    proc = subprocess.run(
        ["tmux", "capture-pane", "-t", pane, "-p", "-S", "-30"],
        text=True,
        capture_output=True,
        check=False,
        timeout=10,
    )
    if proc.returncode != 0:
        return ""
    return proc.stdout[-2000:]


def _accept_claude_trust_prompt(pane: str) -> bool:
    excerpt = _capture_pane_excerpt(pane)
    if "Yes, I trust this folder" not in excerpt and "Claude Code'll be able to read" not in excerpt:
        return False
    subprocess.run(["tmux", "send-keys", "-t", pane, "1", "Enter"], check=False, timeout=10)
    return True


def _ensure_actor_pane_available(actor_id: str, pane: str, *, apply: bool) -> dict[str, Any]:
    dead, reason = _tmux_pane_dead(pane)
    if not dead:
        accepted = False if not apply else _accept_claude_trust_prompt(pane)
        return {"ok": True, "pane_dead": False, "respawned": False, "trust_prompt_accepted": accepted}
    commands = _actor_respawn_commands()
    command = commands.get(actor_id, "")
    if not command:
        return {
            "ok": False,
            "pane_dead": True,
            "respawned": False,
            "reason": "pane_dead_no_respawn_command",
            "tmux_reason": reason,
        }
    if not apply:
        return {
            "ok": True,
            "pane_dead": True,
            "respawned": False,
            "reason": "dry_run_respawn_available",
            "command": command,
        }
    cwd = _actor_respawn_cwd(actor_id)
    proc = subprocess.run(
        ["tmux", "respawn-pane", "-t", pane, "-k", "-c", cwd, command],
        text=True,
        capture_output=True,
        check=False,
        timeout=20,
    )
    if proc.returncode != 0:
        return {
            "ok": False,
            "pane_dead": True,
            "respawned": False,
            "reason": "respawn_failed",
            "stderr": proc.stderr[-1000:],
        }
    accepted = _accept_claude_trust_prompt(pane)
    return {
        "ok": True,
        "pane_dead": True,
        "respawned": True,
        "trust_prompt_accepted": accepted,
        "command": command,
        "cwd": cwd,
    }


def _clear_runtime_status_if_blocked(operator_id: str) -> bool:
    path = _status_path(operator_id)
    data = _load_json(path, {}) if path.exists() else {}
    if not isinstance(data, dict):
        return False
    state = str(data.get("runtime_state") or data.get("state") or "").strip().lower()
    if state not in BLOCKING_STATES:
        return False
    try:
        path.unlink()
        return True
    except OSError:
        return False


def _write_auth_repair_request(operator_id: str, block: dict[str, Any], spec: dict[str, Any]) -> None:
    path = AUTH_REPAIR_REQUESTS_DIR / "shared-claude-subscription.json"
    previous = _load_json(path, {}) if path.exists() else {}
    affected = {
        str(item).strip()
        for item in previous.get("affected_operator_ids", [])
        if str(item).strip()
    } if isinstance(previous, dict) else set()
    affected.add(operator_id)
    payload = {
        "schema_version": "operator_auth_repair_request.v1",
        "scope_id": "shared-claude-subscription",
        "trigger_operator_id": operator_id,
        "affected_operator_ids": sorted(affected),
        "provider": str(spec.get("provider") or ""),
        "backend": str(spec.get("backend") or ""),
        "model": str(spec.get("model") or ""),
        "runtime_state": str(block.get("runtime_state") or ""),
        "reason": str(block.get("reason") or ""),
        "evidence_excerpt": str(block.get("evidence_excerpt") or "")[-1200:],
        "requested_at": _iso(),
        "recovery": {
            "kind": "claude_code_subscription_login",
            "scope": "shared_claude_subscription",
            "note": "Do not login per shadow operator; repair the shared Claude Code tmux subscription session.",
        },
    }
    _write_json(path, payload)


def _clear_shared_claude_auth_repair_request() -> bool:
    path = AUTH_REPAIR_REQUESTS_DIR / "shared-claude-subscription.json"
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False
    except OSError:
        return False


def _shared_claude_auth_status() -> dict[str, Any]:
    executable = shutil.which("claude")
    if not executable:
        return {"ok": False, "logged_in": False, "reason": "claude_cli_missing"}
    try:
        proc = subprocess.run(
            [executable, "auth", "status"],
            text=True,
            capture_output=True,
            check=False,
            timeout=15,
        )
    except Exception as exc:
        return {"ok": False, "logged_in": False, "reason": f"claude_auth_status_failed:{type(exc).__name__}"}
    try:
        payload = json.loads(proc.stdout or "{}")
    except Exception:
        payload = {}
    logged_in = bool(payload.get("loggedIn")) and proc.returncode == 0
    return {
        "ok": proc.returncode == 0,
        "logged_in": logged_in,
        "auth_method": str(payload.get("authMethod") or ""),
        "subscription_type": str(payload.get("subscriptionType") or ""),
        "reason": "shared_auth_ready" if logged_in else "shared_auth_login_required",
    }


def _respawn_actor_pane_for_shared_auth(actor_id: str, pane: str) -> dict[str, Any]:
    command = _actor_respawn_commands().get(actor_id, "")
    if not command:
        return {"ok": False, "reason": "auth_respawn_command_missing", "actor_id": actor_id, "pane": pane}
    cwd = _actor_respawn_cwd(actor_id)
    proc = subprocess.run(
        ["tmux", "respawn-pane", "-t", pane, "-k", "-c", cwd, command],
        text=True,
        capture_output=True,
        check=False,
        timeout=20,
    )
    if proc.returncode != 0:
        return {
            "ok": False,
            "reason": "auth_respawn_failed",
            "actor_id": actor_id,
            "pane": pane,
            "stderr": proc.stderr[-1000:],
        }
    return {
        "ok": True,
        "reason": "shared_auth_session_respawned",
        "actor_id": actor_id,
        "pane": pane,
        "cwd": cwd,
    }


def _quota_window_for_block(block: dict[str, Any]) -> str:
    material = " ".join(
        str(block.get(key) or "").strip().lower()
        for key in ("reason", "rule_name", "evidence_excerpt")
    )
    if "weekly" in material or "每周" in material:
        return "weekly"
    if "monthly" in material or "每月" in material:
        return "monthly"
    if (
        "5h" in material
        or "5 hour" in material
        or "5 小时" in material
        or ("usage limit" in material and "try again at" in material)
    ):
        return "5h"
    if "daily" in material or "每日" in material:
        return "daily"
    return ""


def _quota_observation_shows_recovered(operator_id: str, block: dict[str, Any]) -> bool:
    quota_window = _quota_window_for_block(block)
    observation = operator_cooldown_db.latest_quota_observation(operator_id, quota_window=quota_window)
    if not isinstance(observation, dict):
        return False
    try:
        remaining = float(observation.get("remaining_percent"))
    except Exception:
        return False
    if remaining <= 0:
        return False
    observed = operator_cooldown_db.parse_time(observation.get("observed_at"))
    triggered = operator_cooldown_db.parse_time(block.get("triggered_at"))
    return observed is not None and (triggered is None or observed >= triggered)


def _refresh_quota_snapshot(*, apply: bool) -> dict[str, Any]:
    tool = TOOLS_DIR / "quota_refresh.py"
    if not tool.exists():
        return {"ok": False, "reason": "quota_refresh_missing", "path": str(tool)}
    cmd = [sys.executable or "python3", str(tool), "--json"]
    if apply:
        cmd.insert(2, "--apply")
    try:
        proc = subprocess.run(cmd, cwd=str(HARNESS_DIR), text=True, capture_output=True, timeout=120)
    except Exception as exc:
        return {"ok": False, "reason": f"quota_refresh_failed:{type(exc).__name__}", "error": str(exc)}
    if proc.returncode != 0:
        return {
            "ok": False,
            "reason": "quota_refresh_nonzero",
            "returncode": proc.returncode,
            "stderr": proc.stderr[-1000:],
        }
    try:
        payload = json.loads(proc.stdout)
    except Exception:
        payload = {"ok": True, "stdout_excerpt": proc.stdout[-1000:]}
    return payload if isinstance(payload, dict) else {"ok": True, "payload": payload}


def _collect_quota_sources(*, apply: bool) -> dict[str, Any]:
    tool = TOOLS_DIR / "operator_quota_source_collector.py"
    if not tool.exists():
        return {"ok": True, "reason": "quota_source_collector_missing", "written": 0}
    cmd = [sys.executable or "python3", str(tool), "--json"]
    if apply:
        cmd.insert(2, "--apply")
    try:
        proc = subprocess.run(cmd, cwd=str(HARNESS_DIR), text=True, capture_output=True, timeout=120)
    except Exception as exc:
        return {"ok": False, "reason": f"quota_source_collect_failed:{type(exc).__name__}", "error": str(exc)}
    if proc.returncode != 0:
        return {
            "ok": False,
            "reason": "quota_source_collect_nonzero",
            "returncode": proc.returncode,
            "stderr": proc.stderr[-1000:],
        }
    try:
        payload = json.loads(proc.stdout)
    except Exception:
        payload = {"ok": True, "stdout_excerpt": proc.stdout[-1000:]}
    return payload if isinstance(payload, dict) else {"ok": True, "payload": payload}


def _scan_quota_evidence(*, apply: bool) -> dict[str, Any]:
    tool = TOOLS_DIR / "operator_quota_evidence_scanner.py"
    if not tool.exists():
        return {"ok": True, "reason": "quota_evidence_scanner_missing", "recorded": 0}
    cmd = [sys.executable or "python3", str(tool), "--json"]
    if apply:
        cmd.insert(2, "--apply")
    try:
        proc = subprocess.run(cmd, cwd=str(HARNESS_DIR), text=True, capture_output=True, timeout=120)
    except Exception as exc:
        return {"ok": False, "reason": f"quota_evidence_scan_failed:{type(exc).__name__}", "error": str(exc)}
    if proc.returncode != 0:
        return {
            "ok": False,
            "reason": "quota_evidence_scan_nonzero",
            "returncode": proc.returncode,
            "stderr": proc.stderr[-1000:],
        }
    try:
        payload = json.loads(proc.stdout)
    except Exception:
        payload = {"ok": True, "stdout_excerpt": proc.stdout[-1000:]}
    return payload if isinstance(payload, dict) else {"ok": True, "payload": payload}


def _scan_actor_mailbox_wake(*, apply: bool) -> dict[str, Any]:
    try:
        import actor_mailbox_wake  # type: ignore
    except Exception as exc:
        return {
            "ok": True,
            "reason": "actor_mailbox_wake_missing",
            "error": str(exc),
            "scanned": 0,
            "woken": 0,
            "blocked": 0,
            "skipped": [],
            "items": [],
        }

    targets = _actor_mailbox_wake_targets()
    registry = _load_operator_registry()
    shared_auth_status: dict[str, Any] | None = None
    rerouted = _reroute_unmapped_inbox(targets, apply=apply)
    dead_lettered = _dead_letter_unmapped_inbox(apply=apply)
    rebalanced = _rebalance_mapped_inbox(targets, apply=apply)
    unmapped_backlog = _collect_unmapped_actor_backlog(targets)
    items: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    busy_panes: set[str] = set()
    woken = 0
    blocked = 0
    cleared = 0
    for actor_id, pane in sorted(targets.items()):
        if pane in busy_panes:
            skipped.append({"operator_id": actor_id, "pane": pane, "reason": "pane_already_busy_in_scan"})
            continue
        state = _runtime_status_state(actor_id)
        inbox_count = _actor_inbox_task_count(actor_id)
        processing_count = _actor_processing_task_count(actor_id)
        if state not in BLOCKING_STATES and inbox_count <= 0 and processing_count <= 0:
            skipped.append({"operator_id": actor_id, "pane": pane, "reason": "no_block_or_inbox"})
            continue
        pane_check = _ensure_actor_pane_available(actor_id, pane, apply=apply)
        if not bool(pane_check.get("ok")):
            blocked += 1
            items.append(
                {
                    "operator_id": actor_id,
                    "pane": pane,
                    "ok": False,
                    "status": "error",
                    "reason": str(pane_check.get("reason") or "pane_unavailable"),
                    "inbox_count": inbox_count,
                    "processing_count": processing_count,
                    "runtime_state": state,
                    "pane_check": pane_check,
                }
            )
            continue
        if bool(pane_check.get("pane_dead")) and not apply:
            items.append(
                {
                    "operator_id": actor_id,
                    "pane": pane,
                    "ok": True,
                    "status": "dry_run_respawn_available",
                    "reason": str(pane_check.get("reason") or "dry_run_respawn_available"),
                    "claimed": False,
                    "rewoken": False,
                    "operator_status_cleared": False,
                    "inbox_count": inbox_count,
                    "processing_count": processing_count,
                    "runtime_state": state,
                    "pane_check": pane_check,
                }
            )
            continue
        try:
            result = actor_mailbox_wake.wake_actor(actor_id, pane, dry_run=not apply)
        except Exception as exc:
            blocked += 1
            items.append(
                {
                    "operator_id": actor_id,
                    "pane": pane,
                    "ok": False,
                    "status": "error",
                    "reason": f"{type(exc).__name__}: {exc}",
                    "inbox_count": inbox_count,
                    "processing_count": processing_count,
                    "runtime_state": state,
                    "pane_check": pane_check,
                }
            )
            continue
        status = str(result.get("status") or "")
        auth_recovery: dict[str, Any] = {}
        if status == "auth_expired" and apply:
            spec = _operator_spec(registry, actor_id)
            if _is_active_claude_interactive_operator(spec):
                if shared_auth_status is None:
                    shared_auth_status = _shared_claude_auth_status()
                if bool(shared_auth_status.get("logged_in")):
                    _clear_shared_claude_auth_repair_request()
                    auth_recovery = _respawn_actor_pane_for_shared_auth(actor_id, pane)
                    if auth_recovery.get("ok"):
                        time.sleep(2.0)
                        auth_recovery["trust_prompt_accepted"] = _accept_claude_trust_prompt(pane)
                        if auth_recovery["trust_prompt_accepted"]:
                            time.sleep(1.0)
                        try:
                            recovered_result = actor_mailbox_wake.wake_actor(
                                actor_id,
                                pane,
                                dry_run=False,
                                rewake_processing_after_seconds=0,
                            )
                        except Exception as exc:
                            recovered_result = {
                                "ok": False,
                                "status": "auth_expired",
                                "reason": f"post_respawn_wake_failed:{type(exc).__name__}",
                            }
                        recovered_result["auth_recovery"] = auth_recovery
                        result = recovered_result
                        status = str(result.get("status") or "")
                else:
                    _write_auth_repair_request(
                        actor_id,
                        {
                            "runtime_state": "auth_expired",
                            "reason": str(result.get("reason") or "pane_tail_auth_blocker"),
                            "evidence_excerpt": str(result.get("operator_status_path") or ""),
                        },
                        spec,
                    )
        if bool(result.get("ok")):
            if bool(result.get("claimed")):
                woken += 1
            if bool(result.get("operator_status_cleared")):
                cleared += 1
        else:
            blocked += 1
        items.append(
            {
                "operator_id": actor_id,
                "pane": pane,
                "ok": bool(result.get("ok")),
                "status": status,
                "reason": str(result.get("reason") or ""),
                "claimed": bool(result.get("claimed")),
                "rewoken": bool(result.get("rewoken")),
                "operator_status_cleared": bool(result.get("operator_status_cleared")),
                "inbox_count": inbox_count,
                "processing_count": processing_count,
                "runtime_state": state,
                "pane_check": pane_check,
                "processing_path": str(result.get("processing_path") or ""),
                "wake_prompt_path": str(result.get("wake_prompt_path") or ""),
                "auth_recovery": result.get("auth_recovery") or auth_recovery,
            }
        )
        if status == "processing" or bool(result.get("claimed")) or bool(result.get("rewoken")):
            busy_panes.add(pane)
    return {
        "ok": True,
        "applied": apply,
        "scanned": len(targets),
        "woken": woken,
        "blocked": blocked,
        "status_cleared": cleared,
        "rerouted": rerouted,
        "dead_lettered": dead_lettered,
        "rebalanced": rebalanced,
        "skipped": skipped,
        "items": items,
        "unmapped_backlog": _summarize_unmapped_backlog(unmapped_backlog),
    }


def run_scan(*, apply: bool = False, refresh_snapshot: bool = True) -> dict[str, Any]:
    started_at = _iso()
    registry = _load_operator_registry()
    source_collect = _collect_quota_sources(apply=apply)
    evidence_scan = _scan_quota_evidence(apply=apply)
    mailbox_wake = _scan_actor_mailbox_wake(apply=apply)
    scanned_rows = operator_cooldown_db.list_active_cooldown_blocks()
    kept: list[dict[str, Any]] = []
    recovered: list[dict[str, Any]] = []
    runtime_status_cleared = 0

    for row in scanned_rows:
        operator_id = str(row.get("operator_id") or "").strip()
        if not operator_id:
            continue
        block = operator_cooldown_db.current_cooldown_block(
            operator_id,
            prune_expired=apply,
        )
        if block is None:
            recovered_by_quota_observation = isinstance(
                operator_cooldown_db.quota_recovery_observation(operator_id, block=row),
                dict,
            )
            action = {
                "operator_id": operator_id,
                "runtime_state": str(row.get("runtime_state") or ""),
                "reason": "quota_observation_remaining_positive"
                if recovered_by_quota_observation
                else "expired_or_stale_block",
                "expires_at": str(row.get("expires_at") or ""),
            }
            if apply:
                operator_cooldown_db.clear_operator_cooldown(
                    operator_id,
                    reason="operator_recovery_scanner_expired",
                    source="operator_recovery_scanner",
                )
                if _clear_runtime_status_if_blocked(operator_id):
                    runtime_status_cleared += 1
                    action["runtime_status_cleared"] = True
            recovered.append(action)
            continue

        spec = _operator_spec(registry, operator_id)
        if _is_disabled_deprecated_claude_print_operator(spec):
            action = {
                "operator_id": operator_id,
                "runtime_state": str(block.get("runtime_state") or ""),
                "reason": "disabled_deprecated_claude_print_status_pruned",
                "expires_at": str(block.get("expires_at") or ""),
            }
            if apply:
                operator_cooldown_db.clear_operator_cooldown(
                    operator_id,
                    reason="operator_recovery_scanner_disabled_deprecated_pruned",
                    source="operator_recovery_scanner",
                )
                if _clear_runtime_status_if_blocked(operator_id):
                    runtime_status_cleared += 1
                    action["runtime_status_cleared"] = True
            recovered.append(action)
            continue

        if str(block.get("runtime_state") or "").strip().lower() == "auth_expired" and _is_active_claude_interactive_operator(spec):
            if apply:
                _write_auth_repair_request(operator_id, block, spec)

        if _quota_observation_shows_recovered(operator_id, block):
            action = {
                "operator_id": operator_id,
                "runtime_state": str(block.get("runtime_state") or ""),
                "reason": "quota_observation_remaining_positive",
                "expires_at": str(block.get("expires_at") or ""),
            }
            if apply:
                operator_cooldown_db.clear_operator_cooldown(
                    operator_id,
                    reason="operator_recovery_scanner_quota_recovered",
                    source="operator_recovery_scanner",
                )
                if _clear_runtime_status_if_blocked(operator_id):
                    runtime_status_cleared += 1
                    action["runtime_status_cleared"] = True
            recovered.append(action)
            continue

        kept.append(
            {
                "operator_id": operator_id,
                "runtime_state": str(block.get("runtime_state") or ""),
                "expires_at": str(block.get("expires_at") or ""),
                "next_available_at": str(block.get("next_available_at") or block.get("expires_at") or ""),
                "reason": str(block.get("reason") or ""),
            }
        )

    quota_snapshot = {}
    if refresh_snapshot:
        quota_snapshot = _refresh_quota_snapshot(apply=apply)

    payload = {
        "ok": True,
        "schema_version": "operator_recovery_scanner.v1",
        "started_at": started_at,
        "finished_at": _iso(),
        "applied": apply,
        "scanned": len(scanned_rows),
        "kept": len(kept),
        "recovered": len(recovered),
        "runtime_status_cleared": runtime_status_cleared,
        "mailbox_wake": {
            "ok": bool(mailbox_wake.get("ok", True)) if isinstance(mailbox_wake, dict) else False,
            "scanned": mailbox_wake.get("scanned") if isinstance(mailbox_wake, dict) else None,
            "woken": mailbox_wake.get("woken") if isinstance(mailbox_wake, dict) else None,
            "blocked": mailbox_wake.get("blocked") if isinstance(mailbox_wake, dict) else None,
            "status_cleared": mailbox_wake.get("status_cleared") if isinstance(mailbox_wake, dict) else None,
            "rerouted": mailbox_wake.get("rerouted") if isinstance(mailbox_wake, dict) else {},
            "dead_lettered": mailbox_wake.get("dead_lettered") if isinstance(mailbox_wake, dict) else {},
            "rebalanced": mailbox_wake.get("rebalanced") if isinstance(mailbox_wake, dict) else {},
            "items": mailbox_wake.get("items") if isinstance(mailbox_wake, dict) else [],
            "skipped": mailbox_wake.get("skipped") if isinstance(mailbox_wake, dict) else [],
            "unmapped_backlog": mailbox_wake.get("unmapped_backlog") if isinstance(mailbox_wake, dict) else {},
        },
        "quota_source_collect": {
            "ok": bool(source_collect.get("ok", True)) if isinstance(source_collect, dict) else False,
            "configured_sources": source_collect.get("configured_sources") if isinstance(source_collect, dict) else None,
            "collected": source_collect.get("collected") if isinstance(source_collect, dict) else None,
            "written": source_collect.get("written") if isinstance(source_collect, dict) else None,
        },
        "quota_evidence_scan": {
            "ok": bool(evidence_scan.get("ok", True)) if isinstance(evidence_scan, dict) else False,
            "scanned": evidence_scan.get("scanned") if isinstance(evidence_scan, dict) else None,
            "extracted": evidence_scan.get("extracted") if isinstance(evidence_scan, dict) else None,
            "recorded": evidence_scan.get("recorded") if isinstance(evidence_scan, dict) else None,
            "recorded_active_blocks": evidence_scan.get("recorded_active_blocks") if isinstance(evidence_scan, dict) else None,
        },
        "recovered_items": recovered,
        "kept_items": kept,
        "quota_snapshot": {
            "ok": bool(quota_snapshot.get("ok", True)) if isinstance(quota_snapshot, dict) else False,
            "generated_at": quota_snapshot.get("generated_at") if isinstance(quota_snapshot, dict) else None,
            "operators_usable": quota_snapshot.get("operators_usable") if isinstance(quota_snapshot, dict) else None,
            "operators_hard_blocked": quota_snapshot.get("operators_hard_blocked") if isinstance(quota_snapshot, dict) else None,
        },
    }
    _write_json(LATEST_PATH, payload)
    _append_jsonl(HISTORY_PATH, payload)
    return payload


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Clear recovered cooldown/status rows.")
    parser.add_argument("--no-refresh-snapshot", action="store_true", help="Do not run quota_refresh after scan.")
    parser.add_argument("--json", action="store_true", help="Print JSON payload.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    payload = run_scan(apply=bool(args.apply), refresh_snapshot=not bool(args.no_refresh_snapshot))
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(
            f"operator_recovery_scanner ok={payload['ok']} applied={payload['applied']} "
            f"scanned={payload['scanned']} recovered={payload['recovered']} kept={payload['kept']}"
        )
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
