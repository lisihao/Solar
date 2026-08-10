from __future__ import annotations

import datetime as dt
import importlib.util
import json
import re
import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COOLDOWN_SPEC = importlib.util.spec_from_file_location(
    "operator_cooldown_db_for_recovery_test",
    ROOT / "lib" / "operator_cooldown_db.py",
)
cooldown_db = importlib.util.module_from_spec(COOLDOWN_SPEC)
assert COOLDOWN_SPEC and COOLDOWN_SPEC.loader
COOLDOWN_SPEC.loader.exec_module(cooldown_db)

SCANNER_SPEC = importlib.util.spec_from_file_location(
    "operator_recovery_scanner_under_test",
    ROOT / "tools" / "operator_recovery_scanner.py",
)
scanner = importlib.util.module_from_spec(SCANNER_SPEC)
assert SCANNER_SPEC and SCANNER_SPEC.loader
SCANNER_SPEC.loader.exec_module(scanner)


def _patch_paths(monkeypatch, tmp_path: Path) -> Path:
    db_path = tmp_path / "operator-cooldowns.sqlite"
    monkeypatch.setattr(cooldown_db, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(scanner.operator_cooldown_db, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(scanner, "RUN_DIR", tmp_path / "run" / "operator-recovery-scanner")
    monkeypatch.setattr(scanner, "LATEST_PATH", tmp_path / "run" / "operator-recovery-scanner" / "latest.json")
    monkeypatch.setattr(scanner, "HISTORY_PATH", tmp_path / "run" / "operator-recovery-scanner" / "history.jsonl")
    monkeypatch.setattr(scanner, "STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(scanner, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(scanner, "ACTOR_MAILBOX_WAKE_TARGETS_PATH", tmp_path / "config" / "actor-mailbox-wake-targets.json")
    monkeypatch.setattr(scanner, "REGISTRY_PATH", tmp_path / "config" / "physical-operators.json")
    monkeypatch.setattr(scanner, "AUTH_REPAIR_REQUESTS_DIR", tmp_path / "run" / "auth-repair-requests")
    monkeypatch.setattr(scanner, "_refresh_quota_snapshot", lambda apply: {"ok": True, "operators_usable": 1, "operators_hard_blocked": 0})
    monkeypatch.setattr(scanner, "_collect_quota_sources", lambda apply: {"ok": True, "configured_sources": 0, "collected": 0, "written": 0})
    monkeypatch.setattr(scanner, "_scan_quota_evidence", lambda apply: {"ok": True, "scanned": 0, "extracted": 0, "recorded": 0, "recorded_active_blocks": 0})
    return db_path


def _write_registry(tmp_path: Path, operators: dict) -> None:
    path = tmp_path / "config" / "physical-operators.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"operators": operators}), encoding="utf-8")


def test_recovery_scanner_clears_expired_cooldown(tmp_path: Path, monkeypatch):
    db_path = _patch_paths(monkeypatch, tmp_path)
    now = dt.datetime(2026, 6, 19, 12, 0, tzinfo=dt.timezone.utc)
    old_now = cooldown_db._now
    monkeypatch.setattr(cooldown_db, "_now", lambda: now - dt.timedelta(hours=2))
    cooldown_db.record_cooldown_event(
        "op-expired",
        "quota_exhausted",
        reason="weekly_quota_exhausted",
        source="test",
        triggered_at=now - dt.timedelta(hours=2),
        expires_at=now - dt.timedelta(hours=1),
        db_path=db_path,
    )
    monkeypatch.setattr(cooldown_db, "_now", old_now)
    monkeypatch.setattr(scanner.operator_cooldown_db, "_now", lambda: now)

    status_dir = tmp_path / "run" / "operator-status"
    status_dir.mkdir(parents=True)
    (status_dir / "op-expired.json").write_text('{"operator_id":"op-expired","runtime_state":"quota_exhausted"}', encoding="utf-8")

    payload = scanner.run_scan(apply=True, refresh_snapshot=True)

    assert payload["recovered"] == 1
    assert payload["runtime_status_cleared"] == 1
    assert not (status_dir / "op-expired.json").exists()
    assert cooldown_db.current_cooldown_block("op-expired", now=now, db_path=db_path) is None


def test_recovery_scanner_clears_when_later_quota_observation_is_positive(tmp_path: Path, monkeypatch):
    db_path = _patch_paths(monkeypatch, tmp_path)
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    cooldown_db.record_quota_observation(
        "op-quota",
        model_key="codex-gpt-5.3-spark",
        scope="model_key",
        quota_window="weekly",
        remaining_percent=0,
        observed_at=now,
        reset_at=now + dt.timedelta(days=5),
        source="test",
        db_path=db_path,
    )
    cooldown_db.record_quota_observation(
        "op-quota",
        model_key="codex-gpt-5.3-spark",
        scope="model_key",
        quota_window="weekly",
        remaining_percent=100,
        observed_at=now + dt.timedelta(minutes=5),
        reset_at=now + dt.timedelta(days=5),
        source="test",
        db_path=db_path,
    )
    cooldown_db.record_cooldown_event(
        "op-quota",
        "quota_exhausted",
        reason="weekly_quota_exhausted",
        source="quota_snapshot_fallback",
        triggered_at=now,
        expires_at=now + dt.timedelta(days=5),
        db_path=db_path,
    )

    payload = scanner.run_scan(apply=True, refresh_snapshot=False)

    assert payload["recovered"] == 1
    assert payload["recovered_items"][0]["reason"] == "quota_observation_remaining_positive"
    assert cooldown_db.current_cooldown_block("op-quota", now=now, db_path=db_path) is None


def test_recovery_scanner_prunes_disabled_deprecated_claude_print_auth_block(tmp_path: Path, monkeypatch):
    db_path = _patch_paths(monkeypatch, tmp_path)
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    _write_registry(
        tmp_path,
        {
            "mini-claude-sonnet-builder-2": {
                "provider": "anthropic",
                "backend": "claude-cli",
                "model": "sonnet",
                "auth_mode": "subscription",
                "enabled": False,
                "available": False,
                "deprecated": True,
                "launch_cmd_kind": "print_once",
                "surface": {"type": "claude_print"},
                "builder_pool": {
                    "enabled": False,
                    "disabled_reason": "claude_subscription_print_once_unsupported",
                },
            }
        },
    )
    cooldown_db.record_cooldown_event(
        "mini-claude-sonnet-builder-2",
        "auth_expired",
        reason="auth_expired",
        source="failure_flow_control",
        triggered_at=now,
        db_path=db_path,
    )
    status_dir = tmp_path / "run" / "operator-status"
    status_dir.mkdir(parents=True)
    (status_dir / "mini-claude-sonnet-builder-2.json").write_text(
        '{"operator_id":"mini-claude-sonnet-builder-2","runtime_state":"auth_expired"}',
        encoding="utf-8",
    )

    payload = scanner.run_scan(apply=True, refresh_snapshot=False)

    assert payload["recovered"] == 1
    assert payload["recovered_items"][0]["reason"] == "disabled_deprecated_claude_print_status_pruned"
    assert payload["runtime_status_cleared"] == 1
    assert cooldown_db.current_cooldown_block("mini-claude-sonnet-builder-2", db_path=db_path) is None
    assert not (status_dir / "mini-claude-sonnet-builder-2.json").exists()


def test_recovery_scanner_writes_auth_repair_request_for_active_claude_interactive(tmp_path: Path, monkeypatch):
    db_path = _patch_paths(monkeypatch, tmp_path)
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    _write_registry(
        tmp_path,
        {
            "mini-claude-sonnet-builder": {
                "provider": "anthropic",
                "backend": "claude-cli",
                "model": "sonnet",
                "auth_mode": "subscription",
                "enabled": True,
                "available": True,
                "launch_cmd_kind": "interactive_repl",
                "surface": {"type": "claude_code_interactive"},
            }
        },
    )
    cooldown_db.record_cooldown_event(
        "mini-claude-sonnet-builder",
        "auth_expired",
        reason="auth_expired",
        source="failure_flow_control",
        triggered_at=now,
        evidence_excerpt="Failed to authenticate",
        db_path=db_path,
    )

    payload = scanner.run_scan(apply=True, refresh_snapshot=False)
    request_path = tmp_path / "run" / "auth-repair-requests" / "shared-claude-subscription.json"
    request = json.loads(request_path.read_text(encoding="utf-8"))

    assert payload["kept"] == 1
    assert request["recovery"]["kind"] == "claude_code_subscription_login"
    assert request["recovery"]["scope"] == "shared_claude_subscription"
    assert request["affected_operator_ids"] == ["mini-claude-sonnet-builder"]


def test_auth_repair_request_aggregates_shared_claude_subscription(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    spec = {
        "provider": "anthropic",
        "backend": "claude-cli",
        "model": "opus",
    }

    scanner._write_auth_repair_request("claude-planner", {"runtime_state": "auth_expired"}, spec)
    scanner._write_auth_repair_request("claude-evaluator", {"runtime_state": "auth_expired"}, spec)

    request = json.loads(
        (tmp_path / "run" / "auth-repair-requests" / "shared-claude-subscription.json").read_text()
    )
    assert request["scope_id"] == "shared-claude-subscription"
    assert request["affected_operator_ids"] == ["claude-evaluator", "claude-planner"]


def test_auth_repair_request_preserves_pending_login_flow(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    spec = {"provider": "anthropic", "backend": "claude-cli", "model": "opus"}
    scanner._write_auth_repair_request("claude-planner", {"runtime_state": "auth_expired"}, spec)
    path = tmp_path / "run" / "auth-repair-requests" / "shared-claude-subscription.json"
    request = json.loads(path.read_text(encoding="utf-8"))
    request["login_flow"] = {"status": "pending", "triggered_at": scanner._iso(), "pane": "session:0.1"}
    path.write_text(json.dumps(request), encoding="utf-8")

    scanner._write_auth_repair_request("claude-evaluator", {"runtime_state": "auth_expired"}, spec)

    updated = json.loads(path.read_text(encoding="utf-8"))
    assert updated["login_flow"] == request["login_flow"]
    assert updated["affected_operator_ids"] == ["claude-evaluator", "claude-planner"]


def test_recovery_scanner_wakes_actor_mailbox_when_blocked_status_recovers(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    monkeypatch.setattr(scanner, "_actor_mailbox_wake_targets", lambda: {"op-auth": "session:0.3"})
    monkeypatch.setattr(scanner, "_runtime_status_state", lambda operator_id: "auth_expired")
    monkeypatch.setattr(scanner, "_actor_inbox_task_count", lambda operator_id: 1)
    monkeypatch.setattr(scanner, "_actor_processing_task_count", lambda operator_id: 0)
    monkeypatch.setattr(scanner, "_ensure_actor_pane_available", lambda actor_id, pane, apply: {"ok": True, "pane_dead": False, "respawned": False})
    calls = []

    def fake_wake(actor_id, pane, *, dry_run=False):
        calls.append({"actor_id": actor_id, "pane": pane, "dry_run": dry_run})
        return {
            "ok": True,
            "status": "processing",
            "reason": "wake_sent",
            "claimed": True,
            "operator_status_cleared": True,
            "processing_path": "/tmp/processing/task.json",
            "wake_prompt_path": "/tmp/logs/wake.md",
        }

    monkeypatch.setitem(
        sys.modules,
        "actor_mailbox_wake",
        types.SimpleNamespace(
            wake_actor=fake_wake,
            capture_pane_tail=lambda pane: "Claude Code v2.1.119\n❯ ",
            classify_tail=lambda tail: ("ok", ""),
        ),
    )

    payload = scanner.run_scan(apply=True, refresh_snapshot=False)

    assert calls == [{"actor_id": "op-auth", "pane": "session:0.3", "dry_run": False}]
    assert payload["mailbox_wake"]["woken"] == 1
    assert payload["mailbox_wake"]["status_cleared"] == 1
    assert payload["mailbox_wake"]["items"][0]["claimed"] is True


def test_actor_mailbox_task_count_helpers(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    inbox = tmp_path / "actors" / "op-auth" / "inbox"
    processing = tmp_path / "actors" / "op-auth" / "processing"
    inbox.mkdir(parents=True)
    processing.mkdir(parents=True)
    (inbox / "task-a.json").write_text("{}", encoding="utf-8")
    (processing / "task-b.json").write_text("{}", encoding="utf-8")

    assert scanner._actor_inbox_task_count("op-auth") == 1
    assert scanner._actor_processing_task_count("op-auth") == 1


def test_recovery_scanner_dry_run_does_not_apply_mailbox_wake(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    monkeypatch.setattr(scanner, "_actor_mailbox_wake_targets", lambda: {"op-auth": "session:0.3"})
    monkeypatch.setattr(scanner, "_runtime_status_state", lambda operator_id: "auth_expired")
    monkeypatch.setattr(scanner, "_actor_inbox_task_count", lambda operator_id: 1)
    monkeypatch.setattr(scanner, "_actor_processing_task_count", lambda operator_id: 0)
    monkeypatch.setattr(scanner, "_ensure_actor_pane_available", lambda actor_id, pane, apply: {"ok": True, "pane_dead": False, "respawned": False})
    calls = []

    def fake_wake(actor_id, pane, *, dry_run=False):
        calls.append({"actor_id": actor_id, "pane": pane, "dry_run": dry_run})
        return {
            "ok": False,
            "status": "auth_expired",
            "reason": "pane_tail_auth_blocker",
            "claimed": False,
        }

    monkeypatch.setitem(
        sys.modules,
        "actor_mailbox_wake",
        types.SimpleNamespace(
            wake_actor=fake_wake,
            capture_pane_tail=lambda pane: "Claude Code v2.1.119\n❯ ",
            classify_tail=lambda tail: ("ok", ""),
        ),
    )

    payload = scanner.run_scan(apply=False, refresh_snapshot=False)

    assert calls == [{"actor_id": "op-auth", "pane": "session:0.3", "dry_run": True}]
    assert payload["mailbox_wake"]["blocked"] == 1
    assert payload["mailbox_wake"]["items"][0]["status"] == "auth_expired"


def test_recovery_scanner_respawns_stale_claude_pane_when_shared_auth_is_ready(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    actor_id = "mini-claude-sonnet-builder"
    _write_registry(
        tmp_path,
        {
            actor_id: {
                "provider": "anthropic",
                "backend": "claude-cli",
                "model": "sonnet",
                "auth_mode": "subscription",
                "enabled": True,
                "available": True,
                "launch_cmd_kind": "interactive_repl",
                "surface": {"type": "claude_code_interactive"},
            }
        },
    )
    monkeypatch.setattr(scanner, "_actor_mailbox_wake_targets", lambda: {actor_id: "session:0.3"})
    monkeypatch.setattr(scanner, "_runtime_status_state", lambda operator_id: "auth_expired")
    monkeypatch.setattr(scanner, "_actor_inbox_task_count", lambda operator_id: 1)
    monkeypatch.setattr(scanner, "_actor_processing_task_count", lambda operator_id: 0)
    monkeypatch.setattr(scanner, "_ensure_actor_pane_available", lambda actor_id, pane, apply: {"ok": True, "pane_dead": False, "respawned": False})
    monkeypatch.setattr(
        scanner,
        "_shared_claude_auth_status",
        lambda: {"ok": True, "logged_in": True, "verified_usable": True},
    )
    monkeypatch.setattr(
        scanner,
        "_respawn_actor_pane_for_shared_auth",
        lambda actor_id, pane: {"ok": True, "reason": "shared_auth_session_respawned", "pane": pane},
    )
    monkeypatch.setattr(scanner, "_accept_claude_trust_prompt", lambda pane: False)
    monkeypatch.setattr(scanner.time, "sleep", lambda seconds: None)
    repair_request = tmp_path / "run" / "auth-repair-requests" / "shared-claude-subscription.json"
    repair_request.parent.mkdir(parents=True)
    repair_request.write_text("{}", encoding="utf-8")
    calls = []

    def fake_wake(actor_id, pane, *, dry_run=False, **kwargs):
        calls.append({"actor_id": actor_id, "pane": pane, "dry_run": dry_run, **kwargs})
        if len(calls) == 1:
            return {"ok": False, "status": "auth_expired", "reason": "pane_tail_auth_blocker"}
        return {"ok": True, "status": "processing", "reason": "rewake_processing", "rewoken": True}

    monkeypatch.setitem(
        sys.modules,
        "actor_mailbox_wake",
        types.SimpleNamespace(
            wake_actor=fake_wake,
            capture_pane_tail=lambda pane: "Claude Code v2.1.119\n❯ ",
            classify_tail=lambda tail: ("ok", ""),
        ),
    )

    payload = scanner.run_scan(apply=True, refresh_snapshot=False)

    assert len(calls) == 2
    assert calls[1]["rewake_processing_after_seconds"] == 0
    item = payload["mailbox_wake"]["items"][0]
    assert item["status"] == "processing"
    assert item["auth_recovery"]["reason"] == "shared_auth_session_respawned"
    assert not repair_request.exists()


def test_recovery_scanner_triggers_shared_login_when_respawn_still_gets_401(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    actor_id = "mini-claude-opus-builder"
    monkeypatch.setattr(scanner, "_actor_mailbox_wake_targets", lambda: {actor_id: "session:0.2"})
    monkeypatch.setattr(scanner, "_configured_claude_interactive_target", lambda operator_id: True)
    monkeypatch.setattr(scanner, "_runtime_status_state", lambda operator_id: "auth_expired")
    monkeypatch.setattr(scanner, "_actor_inbox_task_count", lambda operator_id: 1)
    monkeypatch.setattr(scanner, "_actor_processing_task_count", lambda operator_id: 0)
    monkeypatch.setattr(scanner, "_ensure_actor_pane_available", lambda actor_id, pane, apply: {"ok": True, "pane_dead": False, "respawned": False})
    monkeypatch.setattr(
        scanner,
        "_shared_claude_auth_status",
        lambda: {"ok": True, "logged_in": True, "verified_usable": True},
    )
    monkeypatch.setattr(
        scanner,
        "_respawn_actor_pane_for_shared_auth",
        lambda actor_id, pane: {"ok": True, "reason": "shared_auth_session_respawned", "pane": pane},
    )
    monkeypatch.setattr(scanner, "_accept_claude_trust_prompt", lambda pane: False)
    monkeypatch.setattr(scanner.time, "sleep", lambda seconds: None)
    login_calls = []
    monkeypatch.setattr(
        scanner,
        "_trigger_shared_claude_login",
        lambda actor_id, pane, block, spec: login_calls.append((actor_id, pane)) or {
            "ok": True,
            "triggered": True,
            "reason": "shared_login_triggered",
        },
    )
    wake_calls = []

    def fake_wake(actor_id, pane, *, dry_run=False, **kwargs):
        wake_calls.append(actor_id)
        if len(wake_calls) == 1:
            return {"ok": False, "status": "auth_expired", "reason": "pane_tail_auth_blocker"}
        return {"ok": True, "status": "processing", "reason": "rewake_processing", "rewoken": True}

    monkeypatch.setitem(
        sys.modules,
        "actor_mailbox_wake",
        types.SimpleNamespace(
            wake_actor=fake_wake,
            capture_pane_tail=lambda pane: "Please run /login · API Error: 401",
            classify_tail=lambda tail: ("auth_expired", "pane_tail_auth_blocker"),
        ),
    )

    payload = scanner.run_scan(apply=True, refresh_snapshot=False)

    item = payload["mailbox_wake"]["items"][0]
    assert item["status"] == "auth_expired"
    assert item["auth_recovery"]["login_flow"]["reason"] == "shared_login_triggered"
    assert login_calls == [(actor_id, "session:0.2")]


def test_shared_claude_login_trigger_is_singleton_with_ttl(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(scanner.subprocess, "run", fake_run)
    monkeypatch.setattr(scanner.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(
        scanner,
        "_capture_pane_excerpt",
        lambda pane: "https://claude.com/cai/oauth/authorize?code=true&state=test\n\nPaste code here",
    )
    block = {"runtime_state": "auth_expired", "reason": "pane_tail_auth_blocker"}
    spec = {"provider": "anthropic", "backend": "claude-cli", "model": "opus"}

    first = scanner._trigger_shared_claude_login("claude-a", "session:0.1", block, spec)
    second = scanner._trigger_shared_claude_login("claude-b", "session:0.2", block, spec)

    assert first["triggered"] is True
    assert first["browser_opened"] is True
    assert second["triggered"] is False
    assert second["reason"] == "shared_login_already_pending"
    assert sum(1 for command in calls if command[:2] == ["open", "https://claude.com/cai/oauth/authorize?code=true&state=test"]) == 1


def test_completed_shared_claude_login_clears_pending_request(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    request_path = tmp_path / "run" / "auth-repair-requests" / "shared-claude-subscription.json"
    request_path.parent.mkdir(parents=True)
    request_path.write_text(
        json.dumps(
            {
                "scope_id": "shared-claude-subscription",
                "login_flow": {
                    "status": "pending",
                    "triggered_at": scanner._iso(),
                    "pane": "session:0.1",
                },
            }
        ),
        encoding="utf-8",
    )
    actor_wake = types.SimpleNamespace(
        AUTH_RECOVERY_RE=re.compile(r"Login successful", re.I),
        capture_pane_tail=lambda pane: "Login successful\n❯ ",
    )
    monkeypatch.setattr(
        scanner,
        "_shared_claude_auth_status",
        lambda: {"ok": True, "logged_in": True, "verified_usable": True},
    )

    result = scanner._consume_completed_shared_claude_login(actor_wake, apply=True)

    assert result["completed"] is True
    assert result["request_cleared"] is True
    assert not request_path.exists()


def test_completed_shared_claude_login_keeps_request_when_live_probe_fails(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    request_path = tmp_path / "run" / "auth-repair-requests" / "shared-claude-subscription.json"
    request_path.parent.mkdir(parents=True)
    request_path.write_text(
        json.dumps(
            {
                "scope_id": "shared-claude-subscription",
                "login_flow": {
                    "status": "pending",
                    "triggered_at": scanner._iso(),
                    "pane": "session:0.1",
                },
            }
        ),
        encoding="utf-8",
    )
    actor_wake = types.SimpleNamespace(
        AUTH_RECOVERY_RE=re.compile(r"Login successful", re.I),
        capture_pane_tail=lambda pane: "Login successful\n❯ ",
    )
    monkeypatch.setattr(
        scanner,
        "_shared_claude_auth_status",
        lambda: {
            "ok": False,
            "logged_in": False,
            "credential_present": True,
            "verified_usable": False,
            "reason": "shared_auth_live_probe_401",
        },
    )

    result = scanner._consume_completed_shared_claude_login(actor_wake, apply=True)

    assert result["completed"] is False
    assert result["reason"] == "shared_login_success_marker_unverified"
    assert result["auth_status"]["reason"] == "shared_auth_live_probe_401"
    assert request_path.exists()


def test_shared_claude_auth_status_requires_successful_live_probe(monkeypatch):
    calls = []

    def fake_run(command, **kwargs):
        calls.append(command)
        if command[1:3] == ["auth", "status"]:
            return types.SimpleNamespace(
                returncode=0,
                stdout=json.dumps(
                    {
                        "loggedIn": True,
                        "authMethod": "claude.ai",
                        "subscriptionType": "max",
                    }
                ),
                stderr="",
            )
        return types.SimpleNamespace(
            returncode=0,
            stdout=json.dumps({"result": scanner.SHARED_CLAUDE_AUTH_PROBE_MARKER}),
            stderr="",
        )

    monkeypatch.setattr(scanner.shutil, "which", lambda executable: "/usr/local/bin/claude")
    monkeypatch.setattr(scanner.subprocess, "run", fake_run)

    status = scanner._shared_claude_auth_status()

    assert status["credential_present"] is True
    assert status["verified_usable"] is True
    assert status["logged_in"] is True
    assert status["reason"] == "shared_auth_live_probe_ok"
    assert len(calls) == 2


def test_shared_claude_auth_status_rejects_stale_credential_401(monkeypatch):
    def fake_run(command, **kwargs):
        if command[1:3] == ["auth", "status"]:
            return types.SimpleNamespace(
                returncode=0,
                stdout=json.dumps({"loggedIn": True, "authMethod": "claude.ai", "subscriptionType": "max"}),
                stderr="",
            )
        return types.SimpleNamespace(
            returncode=0,
            stdout='{"is_error":true,"result":"Failed to authenticate. API Error: 401 authentication_error"}',
            stderr="",
        )

    monkeypatch.setattr(scanner.shutil, "which", lambda executable: "/usr/local/bin/claude")
    monkeypatch.setattr(scanner.subprocess, "run", fake_run)

    status = scanner._shared_claude_auth_status()

    assert status["credential_present"] is True
    assert status["verified_usable"] is False
    assert status["logged_in"] is False
    assert status["reason"] == "shared_auth_live_probe_401"


def test_recovery_scanner_scans_actor_with_processing_backlog(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    monkeypatch.setattr(scanner, "_actor_mailbox_wake_targets", lambda: {"op-auth": "session:0.3"})
    monkeypatch.setattr(scanner, "_runtime_status_state", lambda operator_id: "")
    monkeypatch.setattr(scanner, "_actor_inbox_task_count", lambda operator_id: 0)
    monkeypatch.setattr(scanner, "_actor_processing_task_count", lambda operator_id: 2)
    monkeypatch.setattr(scanner, "_ensure_actor_pane_available", lambda actor_id, pane, apply: {"ok": True, "pane_dead": False, "respawned": False})
    calls = []

    def fake_wake(actor_id, pane, *, dry_run=False):
        calls.append({"actor_id": actor_id, "pane": pane, "dry_run": dry_run})
        return {
            "ok": True,
            "status": "processing",
            "reason": "rewake_processing",
            "claimed": False,
            "rewoken": True,
            "wake_prompt_path": "/tmp/logs/wake.md",
        }

    monkeypatch.setitem(sys.modules, "actor_mailbox_wake", types.SimpleNamespace(wake_actor=fake_wake))

    payload = scanner.run_scan(apply=True, refresh_snapshot=False)

    assert calls == [{"actor_id": "op-auth", "pane": "session:0.3", "dry_run": False}]
    assert payload["mailbox_wake"]["items"][0]["rewoken"] is True
    assert payload["mailbox_wake"]["items"][0]["processing_count"] == 2


def test_shared_claude_live_auth_gate_blocks_wake_and_triggers_single_login(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    actor_id = "mini-claude-sonnet-builder"
    monkeypatch.setattr(scanner, "_actor_mailbox_wake_targets", lambda: {actor_id: "session:0.3"})
    monkeypatch.setattr(scanner, "_configured_claude_interactive_target", lambda operator_id: True)
    monkeypatch.setattr(scanner, "_runtime_status_state", lambda operator_id: "")
    monkeypatch.setattr(scanner, "_actor_inbox_task_count", lambda operator_id: 1)
    monkeypatch.setattr(scanner, "_actor_processing_task_count", lambda operator_id: 0)
    monkeypatch.setattr(
        scanner,
        "_shared_claude_auth_status",
        lambda: {
            "ok": False,
            "logged_in": False,
            "credential_present": True,
            "verified_usable": False,
            "reason": "shared_auth_live_probe_401",
        },
    )
    monkeypatch.setattr(scanner, "_shared_claude_login_pending", lambda: None)
    login_calls = []
    monkeypatch.setattr(
        scanner,
        "_trigger_shared_claude_login",
        lambda operator_id, pane, block, spec: login_calls.append((operator_id, pane)) or {
            "ok": True,
            "triggered": True,
            "reason": "shared_login_triggered",
        },
    )
    monkeypatch.setattr(scanner, "_write_auth_repair_request", lambda *args, **kwargs: None)
    monkeypatch.setattr(scanner.operator_cooldown_db, "record_cooldown_event", lambda *args, **kwargs: {"ok": True})
    status_calls = []

    def forbidden_wake(*args, **kwargs):
        raise AssertionError("wake_actor must not run while shared auth probe is failing")

    actor_wake = types.SimpleNamespace(
        wake_actor=forbidden_wake,
        write_operator_status=lambda *args, **kwargs: status_calls.append((args, kwargs)),
        capture_pane_tail=lambda pane: "Please run /login · API Error: 401",
        classify_tail=lambda tail: ("auth_expired", "pane_tail_auth_blocker"),
    )
    monkeypatch.setitem(sys.modules, "actor_mailbox_wake", actor_wake)

    payload = scanner._scan_actor_mailbox_wake(apply=True)

    assert payload["shared_auth_gate"]["verified_usable"] is False
    assert payload["blocked"] == 1
    assert payload["items"][0]["status"] == "auth_expired"
    assert login_calls == [(actor_id, "session:0.3")]
    assert len(status_calls) == 1


def test_recovery_scanner_respawns_dead_actor_pane_before_wake(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    monkeypatch.setattr(scanner, "_actor_mailbox_wake_targets", lambda: {"mini-claude-sonnet-builder": "session:0.3"})
    monkeypatch.setattr(scanner, "_runtime_status_state", lambda operator_id: "")
    monkeypatch.setattr(scanner, "_actor_inbox_task_count", lambda operator_id: 1)
    monkeypatch.setattr(scanner, "_actor_processing_task_count", lambda operator_id: 0)
    monkeypatch.setattr(
        scanner,
        "_shared_claude_auth_status",
        lambda: {"ok": True, "logged_in": True, "verified_usable": True},
    )
    monkeypatch.setattr(scanner, "_tmux_pane_dead", lambda pane: (True, "target pane has exited"))
    monkeypatch.setattr(scanner, "_capture_pane_excerpt", lambda pane: "Claude Code v2\n❯ ")
    run_calls = []
    wake_calls = []

    def fake_run(cmd, **kwargs):
        run_calls.append(cmd)
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")

    def fake_wake(actor_id, pane, *, dry_run=False):
        wake_calls.append({"actor_id": actor_id, "pane": pane, "dry_run": dry_run})
        return {"ok": True, "status": "processing", "reason": "wake_sent", "claimed": True}

    monkeypatch.setattr(scanner.subprocess, "run", fake_run)
    monkeypatch.setitem(sys.modules, "actor_mailbox_wake", types.SimpleNamespace(wake_actor=fake_wake))

    payload = scanner.run_scan(apply=True, refresh_snapshot=False)

    assert run_calls[0][:4] == ["tmux", "respawn-pane", "-t", "session:0.3"]
    assert wake_calls == [{"actor_id": "mini-claude-sonnet-builder", "pane": "session:0.3", "dry_run": False}]
    item = payload["mailbox_wake"]["items"][0]
    assert item["claimed"] is True
    assert item["pane_check"]["respawned"] is True


def test_recovery_scanner_dry_run_reports_respawn_without_wake(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    monkeypatch.setattr(scanner, "_actor_mailbox_wake_targets", lambda: {"mini-claude-sonnet-builder": "session:0.3"})
    monkeypatch.setattr(scanner, "_runtime_status_state", lambda operator_id: "")
    monkeypatch.setattr(scanner, "_actor_inbox_task_count", lambda operator_id: 1)
    monkeypatch.setattr(scanner, "_actor_processing_task_count", lambda operator_id: 0)
    monkeypatch.setattr(
        scanner,
        "_shared_claude_auth_status",
        lambda: {"ok": True, "logged_in": True, "verified_usable": True},
    )
    monkeypatch.setattr(scanner, "_tmux_pane_dead", lambda pane: (True, "target pane has exited"))
    wake_calls = []

    def fake_wake(actor_id, pane, *, dry_run=False):
        wake_calls.append({"actor_id": actor_id, "pane": pane, "dry_run": dry_run})
        return {"ok": True, "status": "processing", "reason": "dry_run", "claimed": False}

    monkeypatch.setitem(sys.modules, "actor_mailbox_wake", types.SimpleNamespace(wake_actor=fake_wake))

    payload = scanner.run_scan(apply=False, refresh_snapshot=False)

    assert wake_calls == []
    item = payload["mailbox_wake"]["items"][0]
    assert item["status"] == "dry_run_respawn_available"
    assert item["pane_check"]["pane_dead"] is True


def test_actor_mailbox_wake_targets_load_from_config(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    config_path = tmp_path / "config" / "actor-mailbox-wake-targets.json"
    config_path.parent.mkdir(parents=True)
    config_path.write_text(
        """
        {
          "schema_version": "solar.actor_mailbox_wake_targets.v1",
          "targets": {
            "op-configured": {
              "pane": "session:0.4",
              "respawn_command": "claude --model sonnet",
              "respawn_cwd": "/tmp/project"
            }
          }
        }
        """,
        encoding="utf-8",
    )

    assert scanner._actor_mailbox_wake_targets() == {"op-configured": "session:0.4"}
    assert scanner._actor_respawn_commands()["op-configured"] == "claude --model sonnet"
    assert scanner._actor_respawn_cwd("op-configured") == "/tmp/project"


def test_recovery_scanner_reports_unmapped_actor_backlog(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    config_path = tmp_path / "config" / "actor-mailbox-wake-targets.json"
    config_path.parent.mkdir(parents=True)
    config_path.write_text(
        '{"targets":{"mapped-actor":{"pane":"session:0.3"}}}',
        encoding="utf-8",
    )
    mapped_inbox = tmp_path / "actors" / "mapped-actor" / "inbox"
    unmapped_inbox = tmp_path / "actors" / "unmapped-actor" / "inbox"
    unmapped_processing = tmp_path / "actors" / "unmapped-actor" / "processing"
    mapped_inbox.mkdir(parents=True)
    unmapped_inbox.mkdir(parents=True)
    unmapped_processing.mkdir(parents=True)
    (mapped_inbox / "task-mapped.json").write_text("{}", encoding="utf-8")
    (unmapped_inbox / "task-one.json").write_text("{}", encoding="utf-8")
    (unmapped_processing / "task-two.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(scanner, "_runtime_status_state", lambda operator_id: "submitted")
    monkeypatch.setattr(scanner, "_ensure_actor_pane_available", lambda actor_id, pane, apply: {"ok": True, "pane_dead": False, "respawned": False})

    def fake_wake(actor_id, pane, *, dry_run=False):
        return {"ok": True, "status": "processing", "reason": "wake_sent", "claimed": True}

    monkeypatch.setitem(sys.modules, "actor_mailbox_wake", types.SimpleNamespace(wake_actor=fake_wake))

    payload = scanner.run_scan(apply=True, refresh_snapshot=False)

    backlog = payload["mailbox_wake"]["unmapped_backlog"]
    assert backlog["count"] == 1
    assert backlog["inbox_total"] == 1
    assert backlog["processing_total"] == 1
    assert backlog["items"][0]["operator_id"] == "unmapped-actor"
    assert payload["mailbox_wake"]["items"][0]["operator_id"] == "mapped-actor"


def test_recovery_scanner_reroutes_configured_unmapped_inbox_to_mapped_actor(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    config_path = tmp_path / "config" / "actor-mailbox-wake-targets.json"
    config_path.parent.mkdir(parents=True)
    config_path.write_text(
        json.dumps(
            {
                "targets": {"target-actor": {"pane": "session:0.3"}},
                "reroute_unmapped_inbox": {"source-actor": "target-actor"},
            }
        ),
        encoding="utf-8",
    )
    source_inbox = tmp_path / "actors" / "source-actor" / "inbox"
    source_inbox.mkdir(parents=True)
    source_task = source_inbox / "task-one.json"
    source_task.write_text('{"task_id":"one","actor_id":"source-actor"}', encoding="utf-8")
    monkeypatch.setattr(scanner, "_runtime_status_state", lambda operator_id: "")
    monkeypatch.setattr(scanner, "_ensure_actor_pane_available", lambda actor_id, pane, apply: {"ok": True, "pane_dead": False, "respawned": False})
    calls = []

    def fake_wake(actor_id, pane, *, dry_run=False):
        calls.append({"actor_id": actor_id, "pane": pane, "dry_run": dry_run})
        return {"ok": True, "status": "processing", "reason": "wake_sent", "claimed": True}

    monkeypatch.setitem(sys.modules, "actor_mailbox_wake", types.SimpleNamespace(wake_actor=fake_wake))

    payload = scanner.run_scan(apply=True, refresh_snapshot=False)

    assert payload["mailbox_wake"]["rerouted"]["moved"] == 1
    assert not source_task.exists()
    target_tasks = list((tmp_path / "actors" / "target-actor" / "inbox").glob("task-*.json"))
    assert len(target_tasks) == 1
    moved = json.loads(target_tasks[0].read_text(encoding="utf-8"))
    assert moved["actor_id"] == "target-actor"
    assert moved["original_actor_id"] == "source-actor"
    assert moved["rerouted_from_actor_id"] == "source-actor"
    assert moved["reroute_history"][0]["reason"] == "source_actor_has_no_mailbox_wake_target"
    assert calls == [{"actor_id": "target-actor", "pane": "session:0.3", "dry_run": False}]


def test_recovery_scanner_reroute_dry_run_does_not_move_files(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    config_path = tmp_path / "config" / "actor-mailbox-wake-targets.json"
    config_path.parent.mkdir(parents=True)
    config_path.write_text(
        '{"targets":{"target-actor":{"pane":"session:0.3"}},"reroute_unmapped_inbox":{"source-actor":"target-actor"}}',
        encoding="utf-8",
    )
    source_inbox = tmp_path / "actors" / "source-actor" / "inbox"
    source_inbox.mkdir(parents=True)
    source_task = source_inbox / "task-one.json"
    source_task.write_text('{"task_id":"one"}', encoding="utf-8")
    monkeypatch.setattr(scanner, "_runtime_status_state", lambda operator_id: "")
    monkeypatch.setattr(scanner, "_ensure_actor_pane_available", lambda actor_id, pane, apply: {"ok": True, "pane_dead": False, "respawned": False})

    def fake_wake(actor_id, pane, *, dry_run=False):
        return {"ok": True, "status": "idle", "reason": "no_inbox_task", "claimed": False}

    monkeypatch.setitem(sys.modules, "actor_mailbox_wake", types.SimpleNamespace(wake_actor=fake_wake))

    payload = scanner.run_scan(apply=False, refresh_snapshot=False)

    assert payload["mailbox_wake"]["rerouted"]["moved"] == 1
    assert source_task.exists()
    assert not (tmp_path / "actors" / "target-actor" / "inbox" / "task-one.json").exists()


def test_recovery_scanner_dead_letters_configured_unmapped_inbox(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    config_path = tmp_path / "config" / "actor-mailbox-wake-targets.json"
    config_path.parent.mkdir(parents=True)
    config_path.write_text(
        '{"targets":{},"dead_letter_unmapped_inbox":{"disabled-actor":"deprecated_no_runner"}}',
        encoding="utf-8",
    )
    inbox = tmp_path / "actors" / "disabled-actor" / "inbox"
    inbox.mkdir(parents=True)
    task_path = inbox / "task-one.json"
    task_path.write_text('{"task_id":"one","sprint_id":"s1","node_id":"N1"}', encoding="utf-8")

    payload = scanner.run_scan(apply=True, refresh_snapshot=False)

    dead_lettered = payload["mailbox_wake"]["dead_lettered"]
    assert dead_lettered["moved"] == 1
    assert not task_path.exists()
    archived = list((tmp_path / "actors" / "disabled-actor" / "dead-letter").glob("task-*.json"))
    outbox = list((tmp_path / "actors" / "disabled-actor" / "outbox").glob("result-*.json"))
    assert len(archived) == 1
    assert len(outbox) == 1
    result = json.loads(outbox[0].read_text(encoding="utf-8"))
    assert result["status"] == "cancelled"
    assert result["verdict"] == "skipped"
    assert result["source"] == "operator_recovery_scanner.disabled_unmapped_actor"
    assert result["reason"] == "deprecated_no_runner"
    status = json.loads((tmp_path / "run" / "operator-status" / "disabled-actor.json").read_text(encoding="utf-8"))
    assert status["runtime_state"] == "disabled"
    assert status["reason"] == "deprecated_no_runner"


def test_recovery_scanner_dead_letter_dry_run_does_not_move_files(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    config_path = tmp_path / "config" / "actor-mailbox-wake-targets.json"
    config_path.parent.mkdir(parents=True)
    config_path.write_text(
        '{"targets":{},"dead_letter_unmapped_inbox":{"disabled-actor":"disabled_no_runner"}}',
        encoding="utf-8",
    )
    inbox = tmp_path / "actors" / "disabled-actor" / "inbox"
    inbox.mkdir(parents=True)
    task_path = inbox / "task-one.json"
    task_path.write_text('{"task_id":"one"}', encoding="utf-8")

    payload = scanner.run_scan(apply=False, refresh_snapshot=False)

    assert payload["mailbox_wake"]["dead_lettered"]["moved"] == 1
    assert task_path.exists()
    assert not (tmp_path / "actors" / "disabled-actor" / "dead-letter").exists()
    assert not (tmp_path / "run" / "operator-status" / "disabled-actor.json").exists()


def test_recovery_scanner_rebalances_mapped_inbox_to_verified_target(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    config_path = tmp_path / "config" / "actor-mailbox-wake-targets.json"
    config_path.parent.mkdir(parents=True)
    config_path.write_text(
        json.dumps(
            {
                "targets": {
                    "source-actor": {"pane": "session:0.1"},
                    "target-actor": {"pane": "session:0.2"},
                },
                "rebalance_mapped_inbox": [
                    {
                        "source_actor": "source-actor",
                        "target_actor": "target-actor",
                        "source_min_inbox": 2,
                        "target_max_inbox": 5,
                        "max_per_scan": 3,
                        "reason": "test_rebalance",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    source_inbox = tmp_path / "actors" / "source-actor" / "inbox"
    source_inbox.mkdir(parents=True)
    for idx in range(6):
        (source_inbox / f"task-{idx}.json").write_text(
            json.dumps({"task_id": f"task-{idx}", "actor_id": "source-actor"}),
            encoding="utf-8",
        )
    monkeypatch.setattr(scanner, "_runtime_status_state", lambda operator_id: "")
    monkeypatch.setattr(scanner, "_ensure_actor_pane_available", lambda actor_id, pane, apply: {"ok": True, "pane_dead": False, "respawned": False})

    def fake_wake(actor_id, pane, *, dry_run=False):
        return {"ok": True, "status": "processing", "reason": "pane_busy_without_processing", "claimed": False}

    monkeypatch.setitem(sys.modules, "actor_mailbox_wake", types.SimpleNamespace(wake_actor=fake_wake))

    payload = scanner.run_scan(apply=True, refresh_snapshot=False)

    assert payload["mailbox_wake"]["rebalanced"]["moved"] == 3
    assert len(list(source_inbox.glob("task-*.json"))) == 3
    target_tasks = sorted((tmp_path / "actors" / "target-actor" / "inbox").glob("task-*.json"))
    assert len(target_tasks) == 3
    moved = json.loads(target_tasks[0].read_text(encoding="utf-8"))
    assert moved["actor_id"] == "target-actor"
    assert moved["original_actor_id"] == "source-actor"
    assert moved["reroute_history"][0]["reason"] == "test_rebalance"


def test_recovery_scanner_rebalance_dry_run_does_not_move_files(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    config_path = tmp_path / "config" / "actor-mailbox-wake-targets.json"
    config_path.parent.mkdir(parents=True)
    config_path.write_text(
        '{"targets":{"source-actor":{"pane":"session:0.1"},"target-actor":{"pane":"session:0.2"}},"rebalance_mapped_inbox":[{"source_actor":"source-actor","target_actor":"target-actor","source_min_inbox":0,"target_max_inbox":10,"max_per_scan":2}]}',
        encoding="utf-8",
    )
    source_inbox = tmp_path / "actors" / "source-actor" / "inbox"
    source_inbox.mkdir(parents=True)
    for idx in range(3):
        (source_inbox / f"task-{idx}.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(scanner, "_runtime_status_state", lambda operator_id: "")
    monkeypatch.setattr(scanner, "_ensure_actor_pane_available", lambda actor_id, pane, apply: {"ok": True, "pane_dead": False, "respawned": False})

    def fake_wake(actor_id, pane, *, dry_run=False):
        return {"ok": True, "status": "idle", "reason": "dry_run", "claimed": False}

    monkeypatch.setitem(sys.modules, "actor_mailbox_wake", types.SimpleNamespace(wake_actor=fake_wake))

    payload = scanner.run_scan(apply=False, refresh_snapshot=False)

    assert payload["mailbox_wake"]["rebalanced"]["moved"] == 2
    assert len(list(source_inbox.glob("task-*.json"))) == 3
    assert not (tmp_path / "actors" / "target-actor" / "inbox").exists()


def test_recovery_scanner_serializes_targets_sharing_same_pane(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    monkeypatch.setattr(scanner, "_actor_mailbox_wake_targets", lambda: {"actor-a": "session:0.3", "actor-b": "session:0.3"})
    monkeypatch.setattr(scanner, "_runtime_status_state", lambda operator_id: "")
    monkeypatch.setattr(scanner, "_actor_inbox_task_count", lambda operator_id: 1)
    monkeypatch.setattr(scanner, "_actor_processing_task_count", lambda operator_id: 0)
    monkeypatch.setattr(scanner, "_ensure_actor_pane_available", lambda actor_id, pane, apply: {"ok": True, "pane_dead": False, "respawned": False})
    calls = []

    def fake_wake(actor_id, pane, *, dry_run=False):
        calls.append(actor_id)
        return {"ok": True, "status": "processing", "reason": "wake_sent", "claimed": True}

    monkeypatch.setitem(sys.modules, "actor_mailbox_wake", types.SimpleNamespace(wake_actor=fake_wake))

    payload = scanner.run_scan(apply=True, refresh_snapshot=False)

    assert calls == ["actor-a"]
    assert payload["mailbox_wake"]["skipped"][0]["operator_id"] == "actor-b"
    assert payload["mailbox_wake"]["skipped"][0]["reason"] == "pane_already_busy_in_scan"


def test_recovery_scanner_does_not_clear_weekly_block_from_5h_positive_observation(tmp_path: Path, monkeypatch):
    db_path = _patch_paths(monkeypatch, tmp_path)
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    cooldown_db.record_quota_observation(
        "op-spark",
        model_key="codex-gpt-5.3-spark",
        scope="model_key",
        quota_window="weekly",
        remaining_percent=0,
        observed_at=now,
        reset_at=now + dt.timedelta(days=4),
        source="test",
        db_path=db_path,
    )
    cooldown_db.record_quota_observation(
        "op-spark",
        model_key="codex-gpt-5.3-spark",
        scope="model_key",
        quota_window="5h",
        remaining_percent=100,
        observed_at=now + dt.timedelta(minutes=5),
        reset_at=now + dt.timedelta(hours=5),
        source="test",
        db_path=db_path,
    )

    payload = scanner.run_scan(apply=True, refresh_snapshot=False)

    assert payload["recovered"] == 0
    block = cooldown_db.current_cooldown_block("op-spark", now=now, db_path=db_path)
    assert block is not None
    assert block["reason"] == "weekly_quota_exhausted"


def test_recovery_scanner_treats_codex_try_again_limit_as_5h_window(tmp_path: Path, monkeypatch):
    db_path = _patch_paths(monkeypatch, tmp_path)
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    cooldown_db.record_cooldown_event(
        "op-spark",
        "cooldown",
        reason="result_log_quota_block",
        source="operator_result_log",
        rule_name="recent_operator_quota_block",
        triggered_at=now,
        expires_at=now + dt.timedelta(hours=1),
        evidence_excerpt="ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. Switch to another model now, or try again at 1:39 PM.",
        db_path=db_path,
    )
    cooldown_db.record_quota_observation(
        "op-spark",
        model_key="codex-gpt-5.3-spark",
        scope="model_key",
        quota_window="weekly",
        remaining_percent=100,
        observed_at=now + dt.timedelta(minutes=5),
        reset_at=now + dt.timedelta(days=5),
        source="test",
        db_path=db_path,
    )
    cooldown_db.record_quota_observation(
        "op-spark",
        model_key="codex-gpt-5.3-spark",
        scope="model_key",
        quota_window="5h",
        remaining_percent=0,
        observed_at=now + dt.timedelta(minutes=5),
        reset_at=now + dt.timedelta(hours=1),
        source="test",
        db_path=db_path,
    )
    cooldown_db.record_cooldown_event(
        "op-spark",
        "cooldown",
        reason="result_log_quota_block",
        source="operator_result_log",
        rule_name="recent_operator_quota_block",
        triggered_at=now,
        expires_at=now + dt.timedelta(hours=1),
        evidence_excerpt="ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. Switch to another model now, or try again at 1:39 PM.",
        db_path=db_path,
    )

    payload = scanner.run_scan(apply=True, refresh_snapshot=False)

    assert payload["recovered"] == 0
    block = cooldown_db.current_cooldown_block("op-spark", now=now, db_path=db_path)
    assert block is not None


def test_recovery_scanner_clears_codex_try_again_block_from_5h_positive_observation(tmp_path: Path, monkeypatch):
    db_path = _patch_paths(monkeypatch, tmp_path)
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    cooldown_db.record_cooldown_event(
        "op-spark",
        "cooldown",
        reason="result_log_quota_block",
        source="operator_result_log",
        rule_name="recent_operator_quota_block",
        triggered_at=now,
        expires_at=now + dt.timedelta(hours=1),
        evidence_excerpt="ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. Switch to another model now, or try again at 1:39 PM.",
        db_path=db_path,
    )
    cooldown_db.record_quota_observation(
        "op-spark",
        model_key="codex-gpt-5.3-spark",
        scope="model_key",
        quota_window="5h",
        remaining_percent=100,
        observed_at=now + dt.timedelta(minutes=5),
        reset_at=now + dt.timedelta(hours=1),
        source="test",
        db_path=db_path,
    )
    cooldown_db.record_cooldown_event(
        "op-spark",
        "cooldown",
        reason="result_log_quota_block",
        source="operator_result_log",
        rule_name="recent_operator_quota_block",
        triggered_at=now,
        expires_at=now + dt.timedelta(hours=1),
        evidence_excerpt="ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. Switch to another model now, or try again at 1:39 PM.",
        db_path=db_path,
    )

    payload = scanner.run_scan(apply=True, refresh_snapshot=False)

    assert payload["recovered"] == 1
    assert payload["recovered_items"][0]["reason"] == "quota_observation_remaining_positive"
    assert cooldown_db.current_cooldown_block("op-spark", now=now, db_path=db_path) is None
