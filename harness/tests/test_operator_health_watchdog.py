#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import os
import fcntl
import json
from pathlib import Path
from types import SimpleNamespace


HARNESS_ROOT = Path(__file__).resolve().parents[1]
TOOLS_DIR = HARNESS_ROOT / "tools"
LIB_DIR = HARNESS_ROOT / "lib"


def _load_watchdog():
    spec = importlib.util.spec_from_file_location("operator_health_watchdog", TOOLS_DIR / "operator_health_watchdog.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_core_watchdog():
    spec = importlib.util.spec_from_file_location("operator_health_watchdog_core", LIB_DIR / "operator_health_watchdog.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_watchdog_dry_run_does_not_prune_or_apply_reconcile(monkeypatch, tmp_path):
    watchdog = _load_watchdog()
    monkeypatch.setattr(watchdog, "LOCK_PATH", tmp_path / "lock")
    monkeypatch.setattr(watchdog, "LATEST_REPORT_PATH", tmp_path / "latest.json")
    monkeypatch.setattr(watchdog, "HISTORY_PATH", tmp_path / "history.jsonl")
    calls: list[tuple[str, object]] = []

    class FakePM:
        PM_INBOX_DIR = tmp_path / "pm-inbox"

        def _prune_expired_operator_blocks(self):
            calls.append(("prune", None))
            return {"ok": True, "pruned": [{"operator_id": "op"}], "kept": []}

        def cmd_reconcile(self, args):
            calls.append(("reconcile", args.apply))
            print('{"ok": true, "summary": {"keep_active": 1}}')
            return 0

    class FakeQuota:
        def refresh_snapshot(self, *, apply=False):
            calls.append(("quota", apply))
            return {
                "ok": True,
                "operators_total": 2,
                "operators_usable": 1,
                "operators_hard_blocked": 1,
                "recommended_level": "high",
                "backlog": 7,
                "groups": {},
            }

    monkeypatch.setattr(watchdog, "_load_tool", lambda name: FakePM() if name == "pm_dispatch" else FakeQuota())

    payload = watchdog.run_watchdog(apply=False, max_age_minutes=30)

    assert payload["ok"] is True
    assert payload["applied"] is False
    assert ("prune", None) not in calls
    assert ("reconcile", False) in calls
    assert ("quota", False) in calls
    assert payload["steps"][0]["result"]["reason"] == "dry_run"


def test_watchdog_apply_prunes_and_applies_reconcile(monkeypatch, tmp_path):
    watchdog = _load_watchdog()
    monkeypatch.setattr(watchdog, "LOCK_PATH", tmp_path / "lock")
    monkeypatch.setattr(watchdog, "LATEST_REPORT_PATH", tmp_path / "latest.json")
    monkeypatch.setattr(watchdog, "HISTORY_PATH", tmp_path / "history.jsonl")
    calls: list[tuple[str, object]] = []

    class FakePM:
        PM_INBOX_DIR = tmp_path / "pm-inbox"

        def _prune_expired_operator_blocks(self):
            calls.append(("prune", None))
            return {"ok": True, "pruned": [{"operator_id": "op-a"}], "kept": [{"operator_id": "op-b"}]}

        def cmd_reconcile(self, args):
            calls.append(("reconcile", args.apply))
            print('{"ok": true, "summary": {"complete": 2, "fail_missing_pm_result": 1}}')
            return 0

    class FakeQuota:
        def refresh_snapshot(self, *, apply=False):
            calls.append(("quota", apply))
            return {
                "ok": True,
                "operators_total": 3,
                "operators_usable": 2,
                "operators_hard_blocked": 1,
                "recommended_level": "burst",
                "backlog": 9,
                "groups": {"claude-opus": {"hard_blocked": 1}},
            }

    monkeypatch.setattr(watchdog, "_load_tool", lambda name: FakePM() if name == "pm_dispatch" else FakeQuota())

    payload = watchdog.run_watchdog(apply=True, max_age_minutes=15)

    assert payload["ok"] is True
    assert payload["applied"] is True
    assert ("prune", None) in calls
    assert ("reconcile", True) in calls
    assert ("quota", True) in calls
    assert payload["summary"]["pruned_blocks"] == 1
    assert payload["summary"]["kept_blocks"] == 1
    assert payload["summary"]["hard_blocked_groups"] == ["claude-opus"]


def test_watchdog_lock_busy_does_not_overwrite_latest(monkeypatch, tmp_path):
    watchdog = _load_core_watchdog()
    latest_path = tmp_path / "latest.json"
    history_path = tmp_path / "history.jsonl"
    lock_path = tmp_path / "lock"
    latest_path.write_text('{"run_id":"previous-ok","ok":true}\n', encoding="utf-8")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(lock_path), os.O_CREAT | os.O_RDWR, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)

        class FakePM:
            PM_INBOX_DIR = tmp_path / "pm-inbox"

        monkeypatch.setattr(watchdog, "_load_tool", lambda name: FakePM())

        payload = watchdog.run_watchdog(
            apply=True,
            max_age_minutes=15,
            lock_path=lock_path,
            latest_path=latest_path,
            history_path=history_path,
            lock_timeout_seconds=1,
        )

        assert payload["lock_acquired"] is False
        assert payload["degraded_reason"] == "lock_busy"
        assert json.loads(latest_path.read_text(encoding="utf-8"))["run_id"] == "previous-ok"
        history = [json.loads(line) for line in history_path.read_text(encoding="utf-8").splitlines()]
        assert history[-1]["degraded_reason"] == "lock_busy"
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def test_watchdog_prefers_operator_and_lease_adapters(monkeypatch, tmp_path):
    watchdog = _load_core_watchdog()
    monkeypatch.setattr(watchdog, "LOCK_PATH", tmp_path / "lock")
    monkeypatch.setattr(watchdog, "LATEST_REPORT_PATH", tmp_path / "latest.json")
    monkeypatch.setattr(watchdog, "HISTORY_PATH", tmp_path / "history.jsonl")
    calls: list[tuple[str, object]] = []

    class FakePM:
        PM_INBOX_DIR = tmp_path / "pm-inbox"

        def __init__(self):
            self.PM_INBOX_DIR.mkdir(parents=True, exist_ok=True)
            (self.PM_INBOX_DIR / "pm-task.json").write_text(
                '{"task_id":"pm-task","status":"completed","sprint_id":"s","node_id":"n"}',
                encoding="utf-8",
            )

        def cmd_reconcile(self, args):
            print('{"ok": true, "summary": {"reconcile_count": 0}}')
            return 0

    class FakeOperatorAdapter:
        def prune_expired_operator_config_blocks(self):
            calls.append(("operator_prune", True))
            return {"ok": True, "pruned": [{"operator_id": "op-a", "runtime_state": "cooldown"}], "kept": []}

        def refresh_snapshot(self, *, apply=False):
            calls.append(("operator_quota", apply))
            return {
                "ok": True,
                "operators_total": 1,
                "operators_usable": 1,
                "operators_hard_blocked": 0,
                "recommended_level": "normal",
                "backlog": 0,
                "groups": {},
            }

    class FakeGraphAdapter:
        def release_builder_assignment_on_transient_failure(self, record):
            return {"ok": False, "released": False, "reason": "not_failed"}

        def release_evaluator_assignment_on_transient_failure(self, record):
            return {"ok": False, "released": False, "reason": "not_failed"}

    class FakeLeaseAdapter:
        def reconcile_stale_leases(self, *, runtime_module=None, apply=True):
            calls.append(("lease_reconcile", apply))
            return {
                "ok": True,
                "actions": [
                    {
                        "action_type": "release_stale_lease",
                        "target": "op-a",
                        "status": "applied",
                        "idempotency_key": "lease|op-a",
                    }
                ],
                "skipped": [],
                "summary": {"released": 1},
            }

        def repair_status_projection(self, record, *, apply=True):
            calls.append(("projection_repair", record.get("task_id")))
            return {
                "ok": True,
                "actions": [
                    {
                        "action_type": "mark_builder_reviewing",
                        "target": record.get("task_id", "pm-task"),
                        "status": "applied",
                        "idempotency_key": "projection|pm-task",
                    }
                ],
                "skipped": [],
                "summary": {"applied": 1},
            }

    class FakeRuntime:
        pass

    def fake_load_tool(name):
        if name == "pm_dispatch":
            return FakePM()
        if name == "operator_health_watchdog_operator_adapters":
            return FakeOperatorAdapter()
        if name == "operator_health_watchdog_graph_adapters":
            return FakeGraphAdapter()
        if name == "operator_health_watchdog_lease_adapters":
            return FakeLeaseAdapter()
        if name == "operator_runtime":
            return FakeRuntime()
        raise FileNotFoundError(name)

    monkeypatch.setattr(watchdog, "_load_tool", fake_load_tool)

    payload = watchdog.run_watchdog(
        apply=True,
        max_age_minutes=15,
        lock_path=tmp_path / "lock",
        latest_path=tmp_path / "latest.json",
        history_path=tmp_path / "history.jsonl",
    )
    phases = {phase["phase"]: phase for phase in payload["phases"]}

    assert payload["ok"] is True
    assert ("operator_prune", True) in calls
    assert ("operator_quota", True) in calls
    assert ("lease_reconcile", True) in calls
    assert ("projection_repair", "pm-task") in calls
    assert phases["repair_status_projection"]["status"] == "ok"
    assert payload["counters"]["stale_leases_released"] == 1


def test_watchdog_safe_drain_uses_pm_drain_dry_run_by_default(monkeypatch, tmp_path):
    watchdog = _load_core_watchdog()
    monkeypatch.setattr(watchdog, "LOCK_PATH", tmp_path / "lock")
    monkeypatch.setattr(watchdog, "LATEST_REPORT_PATH", tmp_path / "latest.json")
    monkeypatch.setattr(watchdog, "HISTORY_PATH", tmp_path / "history.jsonl")
    calls: list[tuple[str, object]] = []

    class FakePM:
        PM_INBOX_DIR = tmp_path / "pm-inbox"

        def __init__(self):
            self.PM_INBOX_DIR.mkdir(parents=True, exist_ok=True)

        def cmd_reconcile(self, args):
            print('{"ok": true, "summary": {}}')
            return 0

        def cmd_drain_builder_ready(self, args):
            calls.append(("drain", {"dry_run": args.dry_run, "max_items": args.max_items, "json": args.json}))
            print(
                '{"ok": false, "dry_run": true, "latent_builder_ready": 1, '
                '"submitted": [], "marked": [], "skipped": [{"reason": "dry_run"}]}'
            )
            return 1

    class FakeQuota:
        def refresh_snapshot(self, *, apply=False):
            return {
                "ok": True,
                "operators_total": 2,
                "operators_usable": 1,
                "operators_hard_blocked": 0,
                "recommended_level": "normal",
                "backlog": 1,
                "groups": {},
            }

    def fake_load_tool(name):
        if name == "pm_dispatch":
            return FakePM()
        if name == "operator_runtime":
            return SimpleNamespace()
        if name == "quota_refresh":
            return FakeQuota()
        raise FileNotFoundError(name)

    monkeypatch.setattr(watchdog, "_load_tool", fake_load_tool)
    monkeypatch.delenv("SOLAR_OHW_ENABLE_DRAIN_APPLY", raising=False)

    payload = watchdog.run_watchdog(
        apply=True,
        max_age_minutes=15,
        lock_path=tmp_path / "lock",
        latest_path=tmp_path / "latest.json",
        history_path=tmp_path / "history.jsonl",
    )
    phases = {phase["phase"]: phase for phase in payload["phases"]}

    assert calls == [("drain", {"dry_run": True, "max_items": 3, "json": True})]
    assert phases["drain_if_capacity_available"]["status"] == "ok"
    assert phases["drain_if_capacity_available"]["counters"]["dry_run"] == 1
    assert payload["counters"]["drain_submitted"] == 0


def test_builder_drain_limit_scales_with_spark_capacity(monkeypatch):
    watchdog = _load_core_watchdog()
    monkeypatch.delenv("SOLAR_OHW_BUILDER_DRAIN_CAP", raising=False)

    assert watchdog._builder_drain_limit_from_capacity({"groups": {}}) == 3
    assert watchdog._builder_drain_limit_from_capacity(
        {"groups": {"codex-gpt-5.3-spark": {"usable": 6}}}
    ) == 6
    assert watchdog._graph_drain_scan_limit_from_builders(3) == 30
    assert watchdog._graph_drain_scan_limit_from_builders(6) == 60
    assert (
        watchdog._graph_drain_scan_limit_from_capacity(
            {"backlog_breakdown": {"builder_planning_complete": 69}},
            6,
        )
        == 300
    )


def test_watchdog_runs_graph_drain_controller_before_pm_drain(monkeypatch, tmp_path):
    watchdog = _load_core_watchdog()
    monkeypatch.setattr(watchdog, "LOCK_PATH", tmp_path / "lock")
    monkeypatch.setattr(watchdog, "LATEST_REPORT_PATH", tmp_path / "latest.json")
    monkeypatch.setattr(watchdog, "HISTORY_PATH", tmp_path / "history.jsonl")
    calls: list[str] = []

    class FakePM:
        PM_INBOX_DIR = tmp_path / "pm-inbox"

        def __init__(self):
            self.PM_INBOX_DIR.mkdir(parents=True, exist_ok=True)

        def cmd_reconcile(self, args):
            print('{"ok": true, "summary": {}}')
            return 0

        def cmd_drain_builder_ready(self, args):
            calls.append("pm_drain")
            print('{"ok": true, "submitted": [], "skipped": []}')
            return 0

    class FakeQuota:
        def refresh_snapshot(self, *, apply=False):
            return {
                "ok": True,
                "operators_total": 2,
                "operators_usable": 2,
                "operators_hard_blocked": 0,
                "recommended_level": "normal",
                "backlog": 2,
                "groups": {},
            }

    class FakeGraphDrain:
        def run_graph_drain(self, **kwargs):
            calls.append("graph_drain")
            return {
                "ok": True,
                "dry_run": False,
                "counters": {
                    "drain_submitted": 2,
                    "evals_dispatched": 1,
                    "builders_dispatched": 1,
                    "reconciled": 0,
                },
                "actions": [
                    {"action_type": "graph_eval_drain", "target": "sprint-a", "status": "applied", "submitted": 1},
                    {"action_type": "graph_builder_drain", "target": "sprint-b", "status": "applied", "submitted": 1},
                ],
                "skipped": [],
            }

    def fake_load_tool(name):
        if name == "pm_dispatch":
            return FakePM()
        if name == "operator_runtime":
            return SimpleNamespace()
        if name == "quota_refresh":
            return FakeQuota()
        if name == "graph_drain_controller":
            return FakeGraphDrain()
        raise FileNotFoundError(name)

    monkeypatch.setattr(watchdog, "_load_tool", fake_load_tool)

    payload = watchdog.run_watchdog(
        apply=True,
        max_age_minutes=15,
        lock_path=tmp_path / "lock",
        latest_path=tmp_path / "latest.json",
        history_path=tmp_path / "history.jsonl",
    )
    phases = {phase["phase"]: phase for phase in payload["phases"]}

    assert calls[:2] == ["graph_drain", "pm_drain"]
    assert phases["graph_drain_controller"]["status"] == "ok"
    assert phases["graph_drain_controller"]["counters"]["submitted"] == 2
    assert payload["counters"]["drain_submitted"] == 2
    assert payload["summary"]["graph_drain_submitted"] == 2
    assert payload["summary"]["drain_submitted"] == 2


def test_watchdog_runs_operator_inbox_pump_before_graph_drain(monkeypatch, tmp_path):
    watchdog = _load_core_watchdog()
    monkeypatch.setattr(watchdog, "LOCK_PATH", tmp_path / "lock")
    monkeypatch.setattr(watchdog, "LATEST_REPORT_PATH", tmp_path / "latest.json")
    monkeypatch.setattr(watchdog, "HISTORY_PATH", tmp_path / "history.jsonl")
    calls: list[tuple[str, object]] = []

    class FakePM:
        PM_INBOX_DIR = tmp_path / "pm-inbox"

        def __init__(self):
            self.PM_INBOX_DIR.mkdir(parents=True, exist_ok=True)

        def _prune_expired_operator_blocks(self):
            return {"ok": True, "pruned": [], "kept": []}

        def cmd_reconcile(self, args):
            print('{"ok": true, "summary": {}}')
            return 0

        def cmd_drain_builder_ready(self, args):
            calls.append(("pm_drain", args.dry_run))
            print('{"ok": true, "submitted": [], "skipped": []}')
            return 0

    class FakeQuota:
        def refresh_snapshot(self, *, apply=False):
            return {
                "ok": True,
                "operators_total": 2,
                "operators_usable": 2,
                "operators_hard_blocked": 0,
                "recommended_level": "normal",
                "backlog": 2,
                "groups": {},
            }

    class FakeInboxPump:
        def run_pump(self, *, apply=False, limit=3):
            calls.append(("inbox_pump", {"apply": apply, "limit": limit}))
            return {
                "ok": True,
                "apply": apply,
                "limit": limit,
                "kicked": [{"operator": "op-a", "pending": 1, "kick_pid": 12345}],
                "skipped": [],
            }

    class FakeGraphDrain:
        def run_graph_drain(self, **kwargs):
            calls.append(("graph_drain", kwargs.get("apply")))
            return {"ok": True, "dry_run": False, "counters": {"drain_submitted": 0}, "actions": [], "skipped": []}

    def fake_load_tool(name):
        if name == "pm_dispatch":
            return FakePM()
        if name == "operator_runtime":
            return SimpleNamespace()
        if name == "quota_refresh":
            return FakeQuota()
        if name == "inbox_pump":
            return FakeInboxPump()
        if name == "graph_drain_controller":
            return FakeGraphDrain()
        raise FileNotFoundError(name)

    monkeypatch.setattr(watchdog, "_load_tool", fake_load_tool)

    payload = watchdog.run_watchdog(
        apply=True,
        max_age_minutes=15,
        lock_path=tmp_path / "lock",
        latest_path=tmp_path / "latest.json",
        history_path=tmp_path / "history.jsonl",
    )
    phases = {phase["phase"]: phase for phase in payload["phases"]}

    assert calls[:3] == [
        ("inbox_pump", {"apply": True, "limit": 3}),
        ("graph_drain", True),
        ("pm_drain", True),
    ]
    assert phases["operator_inbox_pump"]["status"] == "ok"
    assert phases["operator_inbox_pump"]["counters"]["kicked"] == 1
    assert payload["counters"]["operator_inbox_kicked"] == 1
    assert payload["summary"]["operator_inbox_kicked"] == 1


def test_watchdog_runs_operator_inbox_pump_after_graph_drain_submission(monkeypatch, tmp_path):
    watchdog = _load_core_watchdog()
    monkeypatch.setattr(watchdog, "LOCK_PATH", tmp_path / "lock")
    monkeypatch.setattr(watchdog, "LATEST_REPORT_PATH", tmp_path / "latest.json")
    monkeypatch.setattr(watchdog, "HISTORY_PATH", tmp_path / "history.jsonl")
    calls: list[tuple[str, object]] = []

    class FakePM:
        PM_INBOX_DIR = tmp_path / "pm-inbox"

        def __init__(self):
            self.PM_INBOX_DIR.mkdir(parents=True, exist_ok=True)

        def _prune_expired_operator_blocks(self):
            return {"ok": True, "pruned": [], "kept": []}

        def cmd_reconcile(self, args):
            print('{"ok": true, "summary": {}}')
            return 0

        def cmd_drain_builder_ready(self, args):
            calls.append(("pm_drain", args.dry_run))
            print('{"ok": true, "submitted": [], "skipped": []}')
            return 0

    class FakeQuota:
        def refresh_snapshot(self, *, apply=False):
            return {
                "ok": True,
                "operators_total": 2,
                "operators_usable": 2,
                "operators_hard_blocked": 0,
                "recommended_level": "normal",
                "backlog": 2,
                "groups": {},
            }

    class FakeInboxPump:
        def __init__(self):
            self.calls = 0

        def run_pump(self, *, apply=False, limit=3):
            self.calls += 1
            calls.append(("inbox_pump", {"apply": apply, "limit": limit, "call": self.calls}))
            kicked = [] if self.calls == 1 else [{"operator": "op-after-drain", "pending": 1, "kick_pid": 23456}]
            return {"ok": True, "apply": apply, "limit": limit, "kicked": kicked, "skipped": []}

    inbox_pump = FakeInboxPump()

    class FakeGraphDrain:
        def run_graph_drain(self, **kwargs):
            calls.append(("graph_drain", kwargs.get("apply")))
            return {
                "ok": True,
                "dry_run": False,
                "counters": {"drain_submitted": 2},
                "actions": [],
                "skipped": [],
            }

    def fake_load_tool(name):
        if name == "pm_dispatch":
            return FakePM()
        if name == "operator_runtime":
            return SimpleNamespace()
        if name == "quota_refresh":
            return FakeQuota()
        if name == "inbox_pump":
            return inbox_pump
        if name == "graph_drain_controller":
            return FakeGraphDrain()
        raise FileNotFoundError(name)

    monkeypatch.setattr(watchdog, "_load_tool", fake_load_tool)

    payload = watchdog.run_watchdog(
        apply=True,
        max_age_minutes=15,
        lock_path=tmp_path / "lock",
        latest_path=tmp_path / "latest.json",
        history_path=tmp_path / "history.jsonl",
    )
    phases = {phase["phase"]: phase for phase in payload["phases"]}

    assert calls[:4] == [
        ("inbox_pump", {"apply": True, "limit": 3, "call": 1}),
        ("graph_drain", True),
        ("inbox_pump", {"apply": True, "limit": 3, "call": 2}),
        ("pm_drain", True),
    ]
    assert phases["operator_inbox_pump"]["counters"]["kicked"] == 0
    assert phases["operator_inbox_pump_after_graph_drain"]["counters"]["kicked"] == 1
    assert payload["counters"]["operator_inbox_kicked"] == 1
    assert payload["summary"]["operator_inbox_kicked"] == 1


def test_watchdog_operator_inbox_pump_dry_run_reports_would_kick(monkeypatch, tmp_path):
    watchdog = _load_core_watchdog()
    monkeypatch.setattr(watchdog, "LOCK_PATH", tmp_path / "lock")
    monkeypatch.setattr(watchdog, "LATEST_REPORT_PATH", tmp_path / "latest.json")
    monkeypatch.setattr(watchdog, "HISTORY_PATH", tmp_path / "history.jsonl")
    calls: list[tuple[bool, int]] = []

    class FakePM:
        PM_INBOX_DIR = tmp_path / "pm-inbox"

        def __init__(self):
            self.PM_INBOX_DIR.mkdir(parents=True, exist_ok=True)

        def cmd_reconcile(self, args):
            print('{"ok": true, "summary": {}}')
            return 0

        def cmd_drain_builder_ready(self, args):
            print('{"ok": true, "submitted": [], "skipped": []}')
            return 0

    class FakeQuota:
        def refresh_snapshot(self, *, apply=False):
            return {"ok": True, "operators_total": 1, "operators_usable": 1, "backlog": 1}

    class FakeInboxPump:
        def run_pump(self, *, apply=False, limit=3):
            calls.append((apply, limit))
            return {
                "ok": True,
                "apply": apply,
                "limit": limit,
                "kicked": [{"operator": "op-a", "pending": 2, "kick_pid": None}],
                "skipped": [],
            }

    def fake_load_tool(name):
        if name == "pm_dispatch":
            return FakePM()
        if name == "operator_runtime":
            return SimpleNamespace()
        if name == "quota_refresh":
            return FakeQuota()
        if name == "inbox_pump":
            return FakeInboxPump()
        raise FileNotFoundError(name)

    monkeypatch.setattr(watchdog, "_load_tool", fake_load_tool)

    payload = watchdog.run_watchdog(
        apply=False,
        max_age_minutes=15,
        lock_path=tmp_path / "lock",
        latest_path=tmp_path / "latest.json",
        history_path=tmp_path / "history.jsonl",
    )
    phases = {phase["phase"]: phase for phase in payload["phases"]}

    assert calls == [(False, 3)]
    assert phases["operator_inbox_pump"]["counters"]["kicked"] == 0
    assert phases["operator_inbox_pump"]["counters"]["would_kick"] == 1
    assert phases["operator_inbox_pump"]["counters"]["dry_run"] == 1
    assert payload["counters"]["operator_inbox_kicked"] == 0


def test_watchdog_runs_evaluator_closeout_control_plane(monkeypatch, tmp_path):
    watchdog = _load_core_watchdog()
    monkeypatch.setattr(watchdog, "LOCK_PATH", tmp_path / "lock")
    monkeypatch.setattr(watchdog, "LATEST_REPORT_PATH", tmp_path / "latest.json")
    monkeypatch.setattr(watchdog, "HISTORY_PATH", tmp_path / "history.jsonl")
    calls: list[tuple[str, bool]] = []

    class FakePM:
        PM_INBOX_DIR = tmp_path / "pm-inbox"

        def __init__(self):
            self.PM_INBOX_DIR.mkdir(parents=True, exist_ok=True)
            (self.PM_INBOX_DIR / "pm-eval.json").write_text(
                json.dumps(
                    {
                        "task_id": "pm-eval",
                        "requested_role": "evaluator",
                        "status": "failed_contract_closeout",
                        "sprint_id": "sprint-eval",
                        "node_id": "E1",
                    }
                ),
                encoding="utf-8",
            )

        def cmd_reconcile(self, args):
            print('{"ok": true, "summary": {}}')
            return 0

        def cmd_drain_builder_ready(self, args):
            print('{"ok": true, "submitted": [], "skipped": []}')
            return 0

    class FakeQuota:
        def refresh_snapshot(self, *, apply=False):
            return {
                "ok": True,
                "operators_total": 2,
                "operators_usable": 2,
                "operators_hard_blocked": 0,
                "recommended_level": "normal",
                "backlog": 1,
                "groups": {},
            }

    class FakeGraphAdapter:
        def enforce_evaluator_closeout_control_plane(self, record, *, apply=True):
            calls.append((record.get("task_id"), apply))
            return {
                "ok": True,
                "task_id": record.get("task_id"),
                "released": apply,
                "would_release": True,
                "graph": "/tmp/graph.json",
                "node_id": "E1",
                "requeue_reason": "sidecar_contract_closeout",
                "control_plane": {
                    "deterministic_eval_gate": {"status": "checked"},
                    "sidecar_closeout_enforcer": {"status": "required"},
                    "evaluator_retry_router": {"status": "applied" if apply else "would_apply"},
                },
            }

        def release_builder_assignment_on_transient_failure(self, record):
            return {"ok": False, "released": False, "reason": "not_failed"}

        def release_evaluator_assignment_on_transient_failure(self, record):
            raise AssertionError("handled evaluator task should not hit legacy retry releaser")

    def fake_load_tool(name):
        if name == "pm_dispatch":
            return FakePM()
        if name == "operator_runtime":
            return SimpleNamespace()
        if name == "quota_refresh":
            return FakeQuota()
        if name == "operator_health_watchdog_graph_adapters":
            return FakeGraphAdapter()
        raise FileNotFoundError(name)

    monkeypatch.setattr(watchdog, "_load_tool", fake_load_tool)

    payload = watchdog.run_watchdog(
        apply=True,
        max_age_minutes=15,
        lock_path=tmp_path / "lock",
        latest_path=tmp_path / "latest.json",
        history_path=tmp_path / "history.jsonl",
    )
    phases = {phase["phase"]: phase for phase in payload["phases"]}

    assert calls == [("pm-eval", True)]
    assert phases["evaluator_closeout_control_plane"]["status"] == "ok"
    assert phases["evaluator_closeout_control_plane"]["counters"]["sidecar_closeout_enforced"] == 1
    assert payload["counters"]["deterministic_eval_gate_checked"] == 1
    assert payload["counters"]["sidecar_closeout_enforced"] == 1
    assert payload["counters"]["evaluator_retry_routed"] == 1
    assert payload["summary"]["evaluator_retry_routed"] == 1


def test_watchdog_skips_stale_evaluator_closeout_records(monkeypatch, tmp_path):
    watchdog = _load_core_watchdog()
    monkeypatch.setattr(watchdog, "LOCK_PATH", tmp_path / "lock")
    monkeypatch.setattr(watchdog, "LATEST_REPORT_PATH", tmp_path / "latest.json")
    monkeypatch.setattr(watchdog, "HISTORY_PATH", tmp_path / "history.jsonl")
    calls: list[str] = []

    old_ts = "2026-01-01T00:00:00Z"

    class FakePM:
        PM_INBOX_DIR = tmp_path / "pm-inbox"

        def __init__(self):
            self.PM_INBOX_DIR.mkdir(parents=True, exist_ok=True)
            (self.PM_INBOX_DIR / "pm-old-eval.json").write_text(
                json.dumps(
                    {
                        "task_id": "pm-old-eval",
                        "requested_role": "evaluator",
                        "status": "failed_contract_closeout",
                        "sprint_id": "sprint-eval",
                        "node_id": "E1",
                        "completed_at": old_ts,
                    }
                ),
                encoding="utf-8",
            )

        def cmd_reconcile(self, args):
            print('{"ok": true, "summary": {}}')
            return 0

        def cmd_drain_builder_ready(self, args):
            print('{"ok": true, "submitted": [], "skipped": []}')
            return 0

    class FakeQuota:
        def refresh_snapshot(self, *, apply=False):
            return {
                "ok": True,
                "operators_total": 2,
                "operators_usable": 2,
                "operators_hard_blocked": 0,
                "recommended_level": "normal",
                "backlog": 1,
                "groups": {},
            }

    class FakeGraphAdapter:
        def enforce_evaluator_closeout_control_plane(self, record, *, apply=True):
            calls.append(str(record.get("task_id")))
            return {"ok": True, "released": False, "control_plane": {}}

        def release_builder_assignment_on_transient_failure(self, record):
            return {"ok": False, "released": False, "reason": "not_failed"}

        def release_evaluator_assignment_on_transient_failure(self, record):
            return {"ok": False, "released": False, "reason": "not_failed"}

    def fake_load_tool(name):
        if name == "pm_dispatch":
            return FakePM()
        if name == "operator_runtime":
            return SimpleNamespace()
        if name == "quota_refresh":
            return FakeQuota()
        if name == "operator_health_watchdog_graph_adapters":
            return FakeGraphAdapter()
        raise FileNotFoundError(name)

    monkeypatch.setattr(watchdog, "_load_tool", fake_load_tool)

    payload = watchdog.run_watchdog(
        apply=True,
        max_age_minutes=15,
        lock_path=tmp_path / "lock",
        latest_path=tmp_path / "latest.json",
        history_path=tmp_path / "history.jsonl",
    )
    phases = {phase["phase"]: phase for phase in payload["phases"]}

    assert calls == []
    assert phases["evaluator_closeout_control_plane"]["status"] == "ok"
    assert phases["evaluator_closeout_control_plane"]["counters"]["stale_pm_records_skipped"] == 1
    assert phases["evaluator_closeout_control_plane"]["skipped"] == [
        {"reason": "stale_pm_records_skipped", "count": 1, "max_age_minutes": 15}
    ]


def test_watchdog_reconciles_stale_graph_eval_assignments(monkeypatch, tmp_path):
    watchdog = _load_core_watchdog()
    monkeypatch.setattr(watchdog, "LOCK_PATH", tmp_path / "lock")
    monkeypatch.setattr(watchdog, "LATEST_REPORT_PATH", tmp_path / "latest.json")
    monkeypatch.setattr(watchdog, "HISTORY_PATH", tmp_path / "history.jsonl")
    calls: list[tuple[bool, int]] = []

    class FakePM:
        PM_INBOX_DIR = tmp_path / "pm-inbox"

        def __init__(self):
            self.PM_INBOX_DIR.mkdir(parents=True, exist_ok=True)

        def cmd_reconcile(self, args):
            print('{"ok": true, "summary": {}}')
            return 0

        def cmd_drain_builder_ready(self, args):
            print('{"ok": true, "submitted": [], "skipped": []}')
            return 0

    class FakeQuota:
        def refresh_snapshot(self, *, apply=False):
            return {"ok": True, "operators_total": 1, "operators_usable": 1, "backlog": 0}

    class FakeGraphAdapter:
        def enforce_evaluator_closeout_control_plane(self, record, *, apply=True):
            return {"ok": True, "released": False, "control_plane": {}}

        def reconcile_stale_evaluator_assignments(self, *, apply=True, max_age_minutes=15):
            calls.append((apply, max_age_minutes))
            return {
                "ok": True,
                "actions": [
                    {
                        "graph": "/tmp/sprint.task_graph.json",
                        "node_id": "E1",
                        "pm_task_id": "pm-eval-stale",
                        "reason": "stale_eval_assignment_missing_sidecar",
                    }
                ],
                "skipped": [],
                "counters": {"released": 1, "would_release": 0},
            }

        def release_builder_assignment_on_transient_failure(self, record):
            return {"ok": False, "released": False, "reason": "not_failed"}

        def release_evaluator_assignment_on_transient_failure(self, record):
            return {"ok": False, "released": False, "reason": "not_failed"}

    def fake_load_tool(name):
        if name == "pm_dispatch":
            return FakePM()
        if name == "operator_runtime":
            return SimpleNamespace()
        if name == "quota_refresh":
            return FakeQuota()
        if name == "operator_health_watchdog_graph_adapters":
            return FakeGraphAdapter()
        raise FileNotFoundError(name)

    monkeypatch.setattr(watchdog, "_load_tool", fake_load_tool)

    payload = watchdog.run_watchdog(
        apply=True,
        max_age_minutes=15,
        lock_path=tmp_path / "lock",
        latest_path=tmp_path / "latest.json",
        history_path=tmp_path / "history.jsonl",
    )
    phases = {phase["phase"]: phase for phase in payload["phases"]}

    assert calls == [(True, 15)]
    assert phases["evaluator_closeout_control_plane"]["counters"]["stale_eval_assignments_released"] == 1
    assert payload["counters"]["stale_eval_assignments_released"] == 1
    assert payload["summary"]["stale_eval_assignments_released"] == 1


def test_command_status_reads_launchagent_runtime_state(monkeypatch, tmp_path):
    watchdog = _load_core_watchdog()
    latest = tmp_path / "latest.json"
    latest.write_text(
        json.dumps(
            {
                "ok": True,
                "finished_at": "2026-06-05T14:10:00Z",
                "last_exit_code": 0,
                "summary": {
                    "drain_submitted": 1,
                    "deterministic_eval_gate_checked": 4,
                    "sidecar_closeout_enforced": 2,
                    "evaluator_retry_routed": 1,
                },
                "installed": False,
                "launchd_loaded": False,
            }
        ),
        encoding="utf-8",
    )
    run_plist = tmp_path / "com.solar.harness.operator-health-watchdog.plist"
    run_plist.write_text("<plist/>", encoding="utf-8")
    monkeypatch.setattr(watchdog, "RUN_LAUNCH_AGENT_PATH", run_plist)
    monkeypatch.setattr(watchdog, "LIBRARY_LAUNCH_AGENT_PATH", tmp_path / "Library" / "LaunchAgents" / "missing.plist")
    monkeypatch.setattr(watchdog.shutil, "which", lambda name: "/bin/launchctl")

    def fake_run(*args, **kwargs):
        return SimpleNamespace(returncode=0, stdout="state = waiting\nruns = 9\n", stderr="")

    monkeypatch.setattr(watchdog.subprocess, "run", fake_run)

    payload = watchdog.command_status(latest_path=latest)

    assert payload["installed"] is True
    assert payload["launchd_loaded"] is True
    assert payload["launchd_state"] == "waiting"
    assert payload["launchagent"]["plist_path"] == str(run_plist)
    assert payload["last_actions"]["drain_submitted"] == 1
    assert payload["last_actions"]["deterministic_eval_gate_checked"] == 4
    assert payload["last_actions"]["sidecar_closeout_enforced"] == 2
    assert payload["last_actions"]["evaluator_retry_routed"] == 1


def test_watchdog_indexes_large_skipped_lists(monkeypatch):
    watchdog = _load_core_watchdog()
    skipped = [
        {"reason": "not_transient_operator_failure", "target": f"pm-{idx}"}
        for idx in range(30)
    ]
    phase = watchdog._attach_skipped_index(
        {"phase": "reconcile_pm_failures", "status": "ok", "actions": [], "skipped": skipped, "counters": {}},
        skipped,
    )

    assert len(phase["skipped"]) == 25
    assert phase["skipped_index"]["total"] == 30
    assert phase["skipped_index"]["truncated"] is True
    assert phase["skipped_index"]["by_reason"][0]["count"] == 30
    assert phase["counters"]["skipped_total"] == 30
