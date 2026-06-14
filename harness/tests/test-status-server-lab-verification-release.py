#!/usr/bin/env python3
"""S05 regression matrix — automated tests for lab pane visibility gap fix.

Covers:
  - runtime truth priority over pane hygiene
  - pane hygiene fallback when runtime truth is stale/missing
  - mismatch visibility (runtime busy vs pane idle)
  - special states (cooldown, auth_expired, blocked) not collapsing to idle
  - legacy payload backward compatibility (no source/mismatch fields)

All tests use temporary fixtures — no dependency on live operator ids or fixed pane titles.
"""

import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


MODULE = Path(__file__).resolve().parents[1] / "lib" / "symphony" / "status-server.py"
spec = importlib.util.spec_from_file_location("status_server", MODULE)
status_server = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(status_server)


# ---------------------------------------------------------------------------
# Helpers — all use temporary directories (tmp_path), never live paths
# ---------------------------------------------------------------------------

def _write_operator_status(
    path: Path,
    operator_id: str,
    runtime_state: str,
    *,
    age_seconds: int = 0,
    current_task_id: str = "",
    **extra: object,
) -> None:
    """Write a temporary operator-status JSON file."""
    data: dict = {
        "operator_id": operator_id,
        "runtime_state": runtime_state,
        "heartbeat_at": (
            datetime.now(timezone.utc) - timedelta(seconds=age_seconds)
        ).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expires_at": (
            datetime.now(timezone.utc) + timedelta(hours=1)
        ).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if current_task_id:
        data["current_task_id"] = current_task_id
    data.update(extra)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _set_harness(monkeypatch, harness: Path) -> None:
    monkeypatch.setattr(status_server, "HARNESS_DIR", harness)
    monkeypatch.delenv("SOLAR_LAB_RUNTIME_TRUTH_ENABLED", raising=False)
    monkeypatch.delenv("SOLAR_LAB_HEARTBEAT_FRESH_SECONDS", raising=False)


def _fake_tmux_single_pane(
    pane_target: str,
    title: str,
    command: str = "zsh",
    tail: str = "",
):
    """Return a fake _run_tmux that provides one lab pane."""
    def _fake_tmux(cmd, timeout=0.8, **_kw):
        if cmd[0] == "list-panes":
            return f"0\tBuilder Lab\t1\t0\t{command}\t{title}\t1\t%1"
        if cmd[0] == "capture-pane" and cmd[1] == "-t" and cmd[2] == pane_target:
            return tail
        return ""
    return _fake_tmux


def _patch_status_payload_deps(monkeypatch):
    """Monkeypatch all heavy status-payload dependencies to stubs."""
    monkeypatch.setattr(status_server, "_pane_info", lambda: [])
    monkeypatch.setattr(status_server, "_main_screen", lambda *a, **kw: {})
    monkeypatch.setattr(status_server, "_lab_screen", lambda *a, **kw: {})
    monkeypatch.setattr(
        status_server,
        "_sprint_meta",
        lambda sid="": {"sprint_id": sid or "sprint-s05-test", "status": "active", "is_active": True},
    )
    monkeypatch.setattr(
        status_server,
        "_current_sprint",
        lambda: {"sprint_id": "sprint-s05-test", "status": "active", "is_active": True, "title": "sprint-s05-test"},
    )
    monkeypatch.setattr(status_server, "_execution_plan_summary", lambda sid="": {"count": 0, "summary": "", "items": []})
    monkeypatch.setattr(status_server, "_current_understand_anything_summary", lambda plan: {"present": False, "summary": "N/A"})
    monkeypatch.setattr(status_server, "_latest_task_graph_gate_audit_summary", lambda: {"present": False, "summary": "N/A"})
    monkeypatch.setattr(status_server, "_runtime_interfaces_status", lambda sid: {"ok": True, "status": "ok"})
    monkeypatch.setattr(status_server, "_capability_health_summary", lambda runtime=None: {"ok": True, "status": "ok"})
    monkeypatch.setattr(status_server, "_thunderomlx_status", lambda: {"ok": False, "status": "disabled"})
    monkeypatch.setattr(status_server, "_read_jsonl", lambda *a, **kw: [])
    monkeypatch.setattr(status_server, "_kpi", lambda: {"sprints_total": 0, "sprints_passed": 0, "sprints_failed": 0, "pass_rate": 0.0})
    for attr in (
        "_obsidian_wiki_readiness", "_mirage_status", "_knowledge_ingest_progress_payload",
        "_tech_hotspot_reasoning_policy_summary", "_solar_kb_status", "_obsidian_sync_status",
        "_apple_notes_ingest_status", "_evolution_status", "_human_search_waiting_status",
        "_research_status_summary", "_autoresearch_impact_summary", "_meta_harness_summary",
        "_pm_dispatch_summary", "_collector_scheduler_payload", "_final_contract_summary_status",
        "_requirement_coverage_summary",
    ):
        monkeypatch.setattr(status_server, attr, lambda *a, **kw: {"status": "warn"})
    status_server._STATUS_PAYLOAD_CACHE.clear()


# ===========================================================================
# 1. Pane hygiene: running shell command → status="running" (basic hygiene)
# ===========================================================================

class TestPaneHygieneRunning:
    """Pane hygiene detects a non-shell command as running."""

    def test_non_shell_command_seen_as_running(self, tmp_path, monkeypatch):
        harness = tmp_path / "harness"
        _set_harness(monkeypatch, harness)
        monkeypatch.setattr(
            status_server,
            "_run_tmux",
            _fake_tmux_single_pane(
                "solar-harness-lab:0.0",
                "Builder 0 | working/sprint-abc",
                command="claude",
                tail="",
            ),
        )
        panes = status_server._builder_lab_panes_info()
        assert len(panes) == 1
        assert panes[0]["status"] == "running"


# ===========================================================================
# 2. Pane hygiene: shell (zsh) + idle title → status="idle"
# ===========================================================================

class TestPaneHygieneIdle:
    """Pane hygiene detects idle shell panes."""

    def test_shell_idle_title_seen_as_idle(self, tmp_path, monkeypatch):
        harness = tmp_path / "harness"
        _set_harness(monkeypatch, harness)
        monkeypatch.setattr(
            status_server,
            "_run_tmux",
            _fake_tmux_single_pane(
                "solar-harness-lab:0.0",
                "Builder 0 | status:idle/no active sprint | 模型:glm",
                command="zsh",
                tail="",
            ),
        )
        panes = status_server._builder_lab_panes_info()
        assert len(panes) == 1
        assert panes[0]["status"] == "idle"


# ===========================================================================
# 3. Special states via pane title
# ===========================================================================

class TestSpecialStatesViaTitle:
    """Title-based special states (cooldown, auth_expired, blocked) are
    correctly classified by _headless_pane_status."""

    @pytest.mark.parametrize("state,title_token", [
        ("cooldown", "cooldown"),
        ("auth_expired", "auth_expired"),
        ("pane_overlay_blocked", "blocked"),
    ])
    def test_special_state_from_title(self, state, title_token):
        status = status_server._headless_pane_status(
            "zsh",
            f"Builder 0 | status:{title_token}",
            "",
        )
        assert status == state

    def test_idle_not_misclassified(self):
        status = status_server._headless_pane_status(
            "zsh",
            "Builder 0 | status:idle/no active sprint",
            "",
        )
        assert status == "idle"


# ===========================================================================
# 4. Physical operator summary — runtime truth from operator-status files
# ===========================================================================

class TestPhysicalOperatorRuntimeTruth:
    """_physical_operator_summary reads operator-status files and correctly
    reports runtime_state."""

    def test_running_operator_from_status_file(self, tmp_path, monkeypatch):
        harness = tmp_path / "harness"
        config_dir = harness / "config"
        config_dir.mkdir(parents=True)
        status_dir = harness / "run" / "operator-status"
        status_dir.mkdir(parents=True)
        lease_dir = harness / "run" / "operator-leases"
        lease_dir.mkdir(parents=True)
        results_dir = harness / "run" / "operator-results"
        results_dir.mkdir(parents=True)
        health_dir = harness / "run" / "operator-health"
        health_dir.mkdir(parents=True)

        operators_cfg = {
            "operators": {
                "test-op-runner": {
                    "enabled": True,
                    "available": True,
                    "role": "builder",
                    "backend": "claude-cli",
                    "provider": "test",
                    "model": "test-model",
                },
            }
        }
        (config_dir / "physical-operators.json").write_text(
            json.dumps(operators_cfg), encoding="utf-8"
        )
        _write_operator_status(
            status_dir / "test-op-runner.json",
            "test-op-runner",
            "running",
            age_seconds=5,
            current_task_id="task-regression-001",
        )
        _set_harness(monkeypatch, harness)

        summary = status_server._physical_operator_summary(limit=10)
        items = [i for i in summary["items"] if i["operator_id"] == "test-op-runner"]
        assert len(items) == 1
        assert items[0]["runtime_state"] == "running"
        assert items[0]["runtime_state_source"] == "operator_status"
        assert items[0]["task_id"] == "task-regression-001"

    def test_cooldown_operator(self, tmp_path, monkeypatch):
        harness = tmp_path / "harness"
        config_dir = harness / "config"
        config_dir.mkdir(parents=True)
        (harness / "run" / "operator-status").mkdir(parents=True)
        (harness / "run" / "operator-leases").mkdir(parents=True)
        (harness / "run" / "operator-results").mkdir(parents=True)
        (harness / "run" / "operator-health").mkdir(parents=True)

        operators_cfg = {
            "operators": {
                "test-op-cool": {
                    "enabled": True,
                    "available": True,
                    "role": "builder",
                    "backend": "claude-cli",
                    "provider": "test",
                    "model": "test-model",
                },
            }
        }
        (config_dir / "physical-operators.json").write_text(
            json.dumps(operators_cfg), encoding="utf-8"
        )
        _write_operator_status(
            (harness / "run" / "operator-status" / "test-op-cool.json"),
            "test-op-cool",
            "cooldown",
            age_seconds=10,
        )
        _set_harness(monkeypatch, harness)

        summary = status_server._physical_operator_summary(limit=10)
        items = [i for i in summary["items"] if i["operator_id"] == "test-op-cool"]
        assert len(items) == 1
        assert items[0]["runtime_state"] == "cooldown"

    def test_auth_expired_operator(self, tmp_path, monkeypatch):
        harness = tmp_path / "harness"
        config_dir = harness / "config"
        config_dir.mkdir(parents=True)
        (harness / "run" / "operator-status").mkdir(parents=True)
        (harness / "run" / "operator-leases").mkdir(parents=True)
        (harness / "run" / "operator-results").mkdir(parents=True)
        (harness / "run" / "operator-health").mkdir(parents=True)

        operators_cfg = {
            "operators": {
                "test-op-auth": {
                    "enabled": True,
                    "available": True,
                    "role": "builder",
                    "backend": "claude-cli",
                    "provider": "test",
                    "model": "test-model",
                },
            }
        }
        (config_dir / "physical-operators.json").write_text(
            json.dumps(operators_cfg), encoding="utf-8"
        )
        _write_operator_status(
            (harness / "run" / "operator-status" / "test-op-auth.json"),
            "test-op-auth",
            "auth_expired",
            age_seconds=10,
        )
        _set_harness(monkeypatch, harness)

        summary = status_server._physical_operator_summary(limit=10)
        items = [i for i in summary["items"] if i["operator_id"] == "test-op-auth"]
        assert len(items) == 1
        assert items[0]["runtime_state"] == "auth_expired"

    def test_blocked_operator(self, tmp_path, monkeypatch):
        harness = tmp_path / "harness"
        config_dir = harness / "config"
        config_dir.mkdir(parents=True)
        (harness / "run" / "operator-status").mkdir(parents=True)
        (harness / "run" / "operator-leases").mkdir(parents=True)
        (harness / "run" / "operator-results").mkdir(parents=True)
        (harness / "run" / "operator-health").mkdir(parents=True)

        operators_cfg = {
            "operators": {
                "test-op-blocked": {
                    "enabled": True,
                    "available": True,
                    "role": "builder",
                    "backend": "claude-cli",
                    "provider": "test",
                    "model": "test-model",
                },
            }
        }
        (config_dir / "physical-operators.json").write_text(
            json.dumps(operators_cfg), encoding="utf-8"
        )
        _write_operator_status(
            (harness / "run" / "operator-status" / "test-op-blocked.json"),
            "test-op-blocked",
            "blocked",
            age_seconds=10,
        )
        _set_harness(monkeypatch, harness)

        summary = status_server._physical_operator_summary(limit=10)
        items = [i for i in summary["items"] if i["operator_id"] == "test-op-blocked"]
        assert len(items) == 1
        assert items[0]["runtime_state"] == "blocked"

    def test_no_status_file_defaults_to_idle(self, tmp_path, monkeypatch):
        harness = tmp_path / "harness"
        config_dir = harness / "config"
        config_dir.mkdir(parents=True)
        (harness / "run" / "operator-status").mkdir(parents=True)
        (harness / "run" / "operator-leases").mkdir(parents=True)
        (harness / "run" / "operator-results").mkdir(parents=True)
        (harness / "run" / "operator-health").mkdir(parents=True)

        operators_cfg = {
            "operators": {
                "test-op-nostatus": {
                    "enabled": True,
                    "available": True,
                    "role": "builder",
                    "backend": "claude-cli",
                    "provider": "test",
                    "model": "test-model",
                },
            }
        }
        (config_dir / "physical-operators.json").write_text(
            json.dumps(operators_cfg), encoding="utf-8"
        )
        _set_harness(monkeypatch, harness)

        summary = status_server._physical_operator_summary(limit=10)
        items = [i for i in summary["items"] if i["operator_id"] == "test-op-nostatus"]
        assert len(items) == 1
        assert items[0]["runtime_state"] == "idle"
        assert items[0]["runtime_state_source"] == "default"


# ===========================================================================
# 5. Legacy payload — panes without source/mismatch fields degrade safely
# ===========================================================================

class TestLegacyPayloadCompatibility:
    """Panels without new runtime-truth fields still render correctly."""

    def test_legacy_pane_pool_counts(self, monkeypatch):
        legacy_panes = [
            {
                "pane": "solar-harness-lab:0.1",
                "pool": "builder-lab",
                "status": "idle",
                "window_name": "builder-lab-window",
                "current_command": "zsh",
                "title": "Builder 1 | status:idle",
                "lease": {},
                "task": {},
                "model": "glm",
                "backend": "tmux",
                "operator_type": "builder",
                "profile": "builder-lab",
            },
            {
                "pane": "solar-harness-lab:0.2",
                "pool": "builder-lab",
                "status": "running",
                "window_name": "builder-lab-window",
                "current_command": "claude",
                "title": "Builder 2 | working/sprint-abc",
                "lease": {},
                "task": {},
                "model": "glm",
                "backend": "tmux",
                "operator_type": "builder",
                "profile": "builder-lab",
            },
        ]
        _patch_status_payload_deps(monkeypatch)
        monkeypatch.setattr(status_server, "_multi_task_panes_info", lambda *a, **kw: legacy_panes)
        monkeypatch.setattr(
            status_server,
            "_physical_operator_summary",
            lambda limit=8: {"items": [], "role_pools": {}, "ok": True, "status": "ok"},
        )
        payload = status_server._status_payload(limit=50, sprint_id="sprint-s05-test")

        pool = payload["multi_task_pane_pool"]
        assert pool["idle"] == 1
        assert pool["running"] == 1

    def test_legacy_payload_no_source_mismatch_crash(self, monkeypatch):
        legacy_panes = [
            {
                "pane": "solar-harness-lab:0.1",
                "pool": "builder-lab",
                "status": "idle",
                "window_name": "builder-lab-window",
                "current_command": "zsh",
                "title": "Builder 1 | status:idle",
                "lease": {},
                "task": {},
            },
        ]
        _patch_status_payload_deps(monkeypatch)
        monkeypatch.setattr(status_server, "_multi_task_panes_info", lambda *a, **kw: legacy_panes)
        monkeypatch.setattr(
            status_server,
            "_physical_operator_summary",
            lambda limit=8: {"items": [], "role_pools": {}, "ok": True, "status": "ok"},
        )
        payload = status_server._status_payload(limit=50, sprint_id="sprint-s05-test")

        assert payload is not None
        assert len(payload["multi_task_panes"]) == 1
        assert payload["multi_task_panes"][0]["status"] == "idle"


# ===========================================================================
# 6. Mismatch visibility — runtime busy vs pane idle
# ===========================================================================

class TestMismatchVisibility:
    """When physical operators show running but panes show idle,
    the mismatch must be observable in the payload."""

    def test_runtime_busy_pane_idle_mismatch_visible(self, monkeypatch):
        panes = [
            {
                "pane": "solar-harness-lab:0.0",
                "pool": "builder-lab",
                "status": "idle",
                "window_name": "builder-lab-window",
                "current_command": "zsh",
                "title": "Builder 0 | status:idle/no active sprint",
                "lease": {},
                "task": {},
                "model": "glm",
                "backend": "tmux",
                "operator_type": "builder",
                "profile": "builder-lab",
            }
        ]
        physical_operators = {
            "items": [
                {
                    "operator_id": "test-op-mismatch",
                    "role": "builder",
                    "roles": ["builder"],
                    "runtime_state": "running",
                    "runtime_state_source": "operator_status",
                    "enabled": True,
                    "source": "runtime_truth",
                    "operator_type": "builder",
                    "runtime_truth_available": True,
                    "heartbeat_at": "2026-06-04T17:00:00Z",
                    "heartbeat_age_seconds": 5,
                    "current_task_id": "task-mismatch-001",
                    "mismatch": {"reason": "pane-hygiene-idle"},
                },
            ],
            "role_pools": {},
            "ok": True,
            "status": "ok",
        }
        _patch_status_payload_deps(monkeypatch)
        monkeypatch.setattr(status_server, "_multi_task_panes_info", lambda *a, **kw: panes)
        monkeypatch.setattr(
            status_server,
            "_physical_operator_summary",
            lambda limit=8: physical_operators,
        )
        payload = status_server._status_payload(limit=50, sprint_id="sprint-s05-test")

        pool = payload["multi_task_pane_pool"]
        items = payload["physical_operators"].get("items", [])
        runtime_busy = sum(
            1 for i in items if i.get("runtime_state") in {"running", "leased"}
        )
        assert runtime_busy > 0
        assert pool["running"] == 0
        assert runtime_busy > pool["running"]


# ===========================================================================
# 7. Feature flag — disabled runtime truth keeps old hygiene behavior
# ===========================================================================

class TestFeatureFlagDisabled:
    """SOLAR_LAB_RUNTIME_TRUTH_ENABLED=0 keeps pane hygiene behavior."""

    def test_feature_flag_off_pane_idle(self, tmp_path, monkeypatch):
        harness = tmp_path / "harness"
        status_dir = harness / "run" / "operator-status"
        status_dir.mkdir(parents=True)
        _write_operator_status(
            status_dir / "test-op-flag.json",
            "test-op-flag",
            "running",
            age_seconds=5,
        )
        monkeypatch.setattr(status_server, "HARNESS_DIR", harness)
        monkeypatch.setenv("SOLAR_LAB_RUNTIME_TRUTH_ENABLED", "0")
        monkeypatch.setattr(
            status_server,
            "_run_tmux",
            _fake_tmux_single_pane(
                "solar-harness-lab:0.0",
                "Builder 0 | status:idle/no active sprint",
                command="zsh",
                tail="",
            ),
        )
        panes = status_server._builder_lab_panes_info()
        assert panes[0]["status"] == "idle"


# ===========================================================================
# 8. py_compile smoke — status-server.py must be syntactically valid
# ===========================================================================

class TestPyCompile:
    def test_status_server_compiles(self):
        import py_compile
        py_compile.compile(str(MODULE), doraise=True)
