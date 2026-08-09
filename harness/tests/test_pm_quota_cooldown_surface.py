#!/usr/bin/env python3
"""Regression tests: quota text → cooldown detection → surface → dispatch avoid.

Acceptance criteria:
1. planner-print quota text is classified as cooldown.
2. quotaProject= alone is NOT classified as quota exhausted.
3. fleet-status output contains reset ETA when operator is in cooldown.
4. is_dispatchable returns readable reason (not just state=cooldown) with ETA.
5. cmd_submit blocked operators emit human-readable cooldown reason.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

HARNESS_ROOT = Path(__file__).resolve().parents[1]
LIB_DIR = HARNESS_ROOT / "lib"
TOOLS_DIR = HARNESS_ROOT / "tools"

if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def ofc():
    return _load("operator_flow_control", LIB_DIR / "operator_flow_control.py")


@pytest.fixture()
def pm(tmp_path, monkeypatch):
    mod = _load("pm_dispatch", TOOLS_DIR / "pm_dispatch.py")
    monkeypatch.setattr(mod, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    (tmp_path / "run" / "operator-status").mkdir(parents=True, exist_ok=True)

    def _runtime_state(operator_id: str) -> str:
        status_file = mod.OPERATOR_STATUS_DIR / f"{operator_id}.json"
        if not status_file.exists():
            return "idle"
        try:
            return str(json.loads(status_file.read_text(encoding="utf-8")).get("runtime_state", "idle"))
        except Exception:
            return "idle"

    monkeypatch.setattr(mod, "get_operator_runtime_state", _runtime_state)
    return mod, tmp_path


# ---------------------------------------------------------------------------
# 1. quota text classification
# ---------------------------------------------------------------------------

class TestQuotaTextClassification:
    QUOTA_SAMPLES = [
        "You've hit your limit · resets 1:40pm (America/Toronto)",
        "You've hit your limit\nPlease wait before sending more messages.",
        "RESOURCE_EXHAUSTED: quota exceeded",
        "monthly usage limit reached",
        "rate-limit exceeded",
        "too many requests",
        "Upgrade your plan to continue",
        "Individual quota reached",
        "resets in 30 minutes",
        "你的请求过于频繁。为保障数据安全，我们已暂时限制你访问对话记录。请稍等几分钟后再重试。",
    ]

    @pytest.mark.parametrize("text", QUOTA_SAMPLES)
    def test_quota_text_classified_as_cooldown(self, ofc, text):
        state = ofc.classify_failure_state(text)
        assert state == "cooldown", f"Expected cooldown for: {text!r}, got: {state!r}"

    def test_empty_text_not_classified(self, ofc):
        assert ofc.classify_failure_state("") == ""

    def test_normal_output_not_classified(self, ofc):
        assert ofc.classify_failure_state("Task completed successfully") == ""

    def test_capacity_probe_text_not_classified_as_quota(self, ofc):
        text = (
            "capacity probe for graph-dispatch evaluator via mini-codex-gpt55-medium-builder-1\n"
            "Graph dispatch file: /Users/lisihao/.solar/harness/sprints/example.N3-dispatch.md\n"
            "Objective: inspect worker capacity and write the graph node closeout."
        )
        assert ofc.classify_failure_state(text) == ""

    def test_explicit_usage_limit_not_masked_by_closeout_words(self, ofc):
        text = (
            "必须阅读 builder handoff/evidence，写入 eval.md/eval.json verdict，"
            "不要只写 PM result。\n"
            "ERROR: You've hit your usage limit. Visit settings or try again at "
            "Jun 10th, 2026 8:56 PM."
        )
        assert ofc.classify_failure_state(text) == "cooldown"


# ---------------------------------------------------------------------------
# 2. quotaProject= must NOT trigger quota classification
# ---------------------------------------------------------------------------

class TestQuotaProjectFalsePositive:
    FALSE_POSITIVE_SAMPLES = [
        "quotaProject=my-gcp-project",
        "?quotaProject=billing-project-123",
        "request: quotaProject=foobar",
        "quotaProject=",
        "https://api.example.com?quotaProject=xyz&key=abc",
    ]

    @pytest.mark.parametrize("text", FALSE_POSITIVE_SAMPLES)
    def test_quota_project_param_not_classified_as_quota(self, ofc, text):
        state = ofc.classify_failure_state(text)
        assert state != "cooldown", (
            f"False positive: {text!r} classified as cooldown. "
            "quotaProject= URL param should not trigger quota detection."
        )

    def test_quota_project_with_resource_exhausted_is_cooldown(self, ofc):
        """When RESOURCE_EXHAUSTED is also present, cooldown IS correct."""
        text = "RESOURCE_EXHAUSTED: quota exceeded quotaProject=my-project"
        assert ofc.classify_failure_state(text) == "cooldown"


# ---------------------------------------------------------------------------
# 3. fleet-status surface: cooldown ETA column
# ---------------------------------------------------------------------------

class TestFleetStatusCooldownSurface:
    def _write_status(self, status_dir: Path, op_id: str, state: str, expires_at: str = "") -> None:
        status_dir.mkdir(parents=True, exist_ok=True)
        data: dict = {"operator_id": op_id, "runtime_state": state}
        if expires_at:
            data["expires_at"] = expires_at
        (status_dir / f"{op_id}.json").write_text(json.dumps(data), encoding="utf-8")

    def test_format_reset_eta_returns_minutes(self, pm):
        mod, tmp_path = pm
        import datetime
        future = (
            datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=47)
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
        eta = mod._format_reset_eta(future)
        assert "m" in eta
        assert eta.startswith("~")

    def test_format_reset_eta_returns_hours(self, pm):
        mod, tmp_path = pm
        import datetime
        future = (
            datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=2, minutes=15)
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
        eta = mod._format_reset_eta(future)
        assert "h" in eta

    def test_format_reset_eta_empty_string_on_empty_input(self, pm):
        mod, _ = pm
        assert mod._format_reset_eta("") == ""

    def test_format_reset_eta_soon_when_expired(self, pm):
        mod, _ = pm
        assert mod._format_reset_eta("2020-01-01T00:00:00Z") == "soon"

    def test_fleet_status_prints_cooldown_eta(self, pm, monkeypatch, capsys):
        import argparse, datetime
        mod, tmp_path = pm
        future = (
            datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
        self._write_status(tmp_path / "run" / "operator-status", "op-cool", "cooldown", future)

        monkeypatch.setattr(mod, "load_registry", lambda: {
            "version": 1,
            "operators": {
                "op-cool": {
                    "enabled": True, "available": True,
                    "role": "builder", "model": "sonnet",
                },
            },
        })

        rc = mod.cmd_fleet_status(argparse.Namespace())
        out = capsys.readouterr().out
        assert rc == 0
        assert "cooldown" in out
        assert "resets" in out
        assert future[:16] in out or "h" in out  # ETA or timestamp present


# ---------------------------------------------------------------------------
# 4. is_dispatchable returns readable reason with ETA
# ---------------------------------------------------------------------------

class TestIsDispatchableReason:
    def _write_status(self, status_dir: Path, op_id: str, state: str, expires_at: str = "") -> None:
        status_dir.mkdir(parents=True, exist_ok=True)
        data: dict = {"operator_id": op_id, "runtime_state": state}
        if expires_at:
            data["expires_at"] = expires_at
        (status_dir / f"{op_id}.json").write_text(json.dumps(data), encoding="utf-8")

    def test_cooldown_reason_includes_state(self, pm):
        mod, tmp_path = pm
        self._write_status(tmp_path / "run" / "operator-status", "op-a", "cooldown")
        op = {"operator_id": "op-a", "enabled": True, "available": True}
        ok, reason = mod.is_dispatchable(op)
        assert not ok
        assert "cooldown" in reason

    def test_cooldown_reason_includes_eta_when_expires_at_set(self, pm):
        import datetime
        mod, tmp_path = pm
        future = (
            datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=30)
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
        self._write_status(tmp_path / "run" / "operator-status", "op-b", "cooldown", future)
        op = {"operator_id": "op-b", "enabled": True, "available": True}
        ok, reason = mod.is_dispatchable(op)
        assert not ok
        assert "resets" in reason or "until" in reason
        assert future in reason

    def test_cooldown_reason_not_just_state_equals(self, pm):
        """Reason must be more informative than bare 'runtime_state=cooldown'."""
        import datetime
        mod, tmp_path = pm
        future = (
            datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=2)
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
        self._write_status(tmp_path / "run" / "operator-status", "op-c", "cooldown", future)
        op = {"operator_id": "op-c", "enabled": True, "available": True}
        _, reason = mod.is_dispatchable(op)
        assert reason != "runtime_state=cooldown"

    def test_auth_expired_reason_readable(self, pm):
        mod, tmp_path = pm
        self._write_status(tmp_path / "run" / "operator-status", "op-d", "auth_expired")
        op = {"operator_id": "op-d", "enabled": True, "available": True}
        ok, reason = mod.is_dispatchable(op)
        assert not ok
        assert "auth_expired" in reason

    def test_idle_operator_is_dispatchable(self, pm):
        mod, tmp_path = pm
        op = {"operator_id": "op-idle", "enabled": True, "available": True}
        ok, reason = mod.is_dispatchable(op)
        assert ok
        assert reason == ""

    def test_active_cooldown_db_block_prevents_dispatch(self, pm, monkeypatch):
        mod, _ = pm
        monkeypatch.setattr(
            mod,
            "_operator_cooldown_db_block",
            lambda _operator_id: {
                "operator_id": "op-db",
                "runtime_state": "cooldown",
                "reason": "rate_limit",
                "source": "operator_result_log",
                "expires_at": "2026-06-18T17:00:00Z",
                "remaining_seconds": 5 * 3600,
            },
        )
        op = {"operator_id": "op-db", "enabled": True, "available": True}

        ok, reason = mod.is_dispatchable(op)

        assert not ok
        assert "cooldown_db=cooldown" in reason
        assert "rate_limit" in reason
        assert "until 2026-06-18T17:00:00Z" in reason


# ---------------------------------------------------------------------------
# 5. apply_failure_flow_control → operator enters cooldown
# ---------------------------------------------------------------------------

class TestApplyFailureFlowControl:
    def test_parse_try_again_at_reset_hint(self, ofc):
        import datetime
        from zoneinfo import ZoneInfo

        now = datetime.datetime(2026, 6, 4, 20, 33, tzinfo=ZoneInfo("America/Toronto"))
        reset = ofc.parse_rate_limit_reset_at(
            "ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. "
            "Switch to another model now, or try again at 9:25 PM.",
            now=now,
        )

        assert reset == datetime.datetime(2026, 6, 5, 1, 25, tzinfo=datetime.timezone.utc)

    def test_parse_try_again_at_full_date_reset_hint(self, ofc):
        import datetime
        from zoneinfo import ZoneInfo

        now = datetime.datetime(2026, 6, 5, 4, 53, tzinfo=ZoneInfo("America/Toronto"))
        reset = ofc.parse_rate_limit_reset_at(
            "ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. "
            "Switch to another model now, or try again at Jun 10th, 2026 10:25 PM.",
            now=now,
        )

        assert reset == datetime.datetime(2026, 6, 11, 2, 25, tzinfo=datetime.timezone.utc)

    def test_quota_text_sets_cooldown_state(self, tmp_path, monkeypatch):
        import operator_flow_control as ofc

        status_dir = tmp_path / "run" / "operator-status"
        status_dir.mkdir(parents=True, exist_ok=True)
        task_dir = tmp_path / "task"
        task_dir.mkdir()

        calls: list[dict] = []

        def _fake_set_status(op_id, state, ttl_seconds=None):
            calls.append({"op_id": op_id, "state": state, "ttl": ttl_seconds})
            return {"operator_id": op_id, "runtime_state": state}

        import operator_runtime as rt
        monkeypatch.setattr(rt, "set_operator_status", _fake_set_status)

        quota_text = "RESOURCE_EXHAUSTED: quota exceeded"
        result = ofc.apply_failure_flow_control(
            task_dir,
            operator_id="op-planner",
            failure_text=quota_text,
            rate_limit_cooldown_seconds=3600,
            auth_cooldown_seconds=21600,
        )

        assert result["runtime_state"] == "cooldown"
        assert any(c["state"] == "cooldown" for c in calls)
        cooldown_call = next(c for c in calls if c["state"] == "cooldown")
        assert cooldown_call["ttl"] == 3600

    def test_quota_project_param_does_not_set_cooldown(self, tmp_path, monkeypatch):
        import operator_flow_control as ofc

        task_dir = tmp_path / "task2"
        task_dir.mkdir()
        calls: list[dict] = []

        import operator_runtime as rt
        monkeypatch.setattr(rt, "set_operator_status", lambda *a, **kw: calls.append(a) or {})

        result = ofc.apply_failure_flow_control(
            task_dir,
            operator_id="op-planner",
            failure_text="quotaProject=my-gcp-project request succeeded",
            rate_limit_cooldown_seconds=3600,
            auth_cooldown_seconds=21600,
        )

        assert result["runtime_state"] == ""
        assert len(calls) == 0

    def test_browser_history_throttle_defers_for_ten_minutes(self, tmp_path, monkeypatch):
        import operator_flow_control as ofc

        task_dir = tmp_path / "task3"
        task_dir.mkdir()
        calls: list[dict] = []

        import operator_runtime as rt
        monkeypatch.delenv("SOLAR_BROWSER_AGENT_HISTORY_THROTTLE_COOLDOWN_SECONDS", raising=False)
        monkeypatch.setattr(
            rt,
            "set_operator_status",
            lambda op_id, state, ttl_seconds=None: calls.append(
                {"op_id": op_id, "state": state, "ttl": ttl_seconds}
            ) or {"operator_id": op_id, "runtime_state": state},
        )
        monkeypatch.setattr(
            ofc,
            "persist_operator_block",
            lambda *args, **kwargs: {
                "ok": True,
                "reason": kwargs.get("reason"),
                "runtime_state": args[1],
            },
        )

        result = ofc.apply_failure_flow_control(
            task_dir,
            operator_id="chatgpt-report-writer",
            failure_text="你的请求过于频繁。为保障数据安全，我们已暂时限制你访问对话记录。请稍等几分钟后再重试。",
            rate_limit_cooldown_seconds=3600,
            auth_cooldown_seconds=21600,
            defer_on_cooldown=True,
        )

        assert result["runtime_state"] == "cooldown"
        assert calls == [{"op_id": "chatgpt-report-writer", "state": "cooldown", "ttl": 600}]
        assert result["task_control"]["action"] == "defer"
        assert result["task_control"]["delay_seconds"] == 600
        assert result["task_control"]["reason"] == "browser_history_throttle"
        assert result["config_block"]["reason"] == "browser_history_throttle"


class TestQuotaRecoveryPrune:
    def test_registry_prune_clears_stale_dynamic_status(self, ofc, tmp_path, monkeypatch):
        import datetime

        registry_path = tmp_path / "config" / "physical-operators.json"
        status_dir = tmp_path / "run" / "operator-status"
        registry_path.parent.mkdir(parents=True)
        status_dir.mkdir(parents=True)
        operator_id = "mini-claude-sonnet-builder"
        registry_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "operators": {
                        operator_id: {
                            "enabled": True,
                            "available": True,
                            "provider": "anthropic",
                            "backend": "claude-cli",
                            "model": "sonnet",
                            "quota_guard_state": "ok",
                            "quota_refresh_at": None,
                            "state": {
                                "runtime_state": "idle",
                                "cooldown_until": None,
                                "last_pruned_at": "2026-06-14T03:42:53Z",
                            },
                            "flow_control": {
                                "last_pruned_at": "2026-06-14T03:42:53Z",
                                "last_prune_reason": "weak_pane_rate_limit_evidence",
                            },
                        }
                    },
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        status_path = status_dir / f"{operator_id}.json"
        status_path.write_text(
            json.dumps(
                {
                    "operator_id": operator_id,
                    "runtime_state": "cooldown",
                    "updated_at": "2026-06-14T03:42:11Z",
                    "expires_at": "2026-06-14T23:59:59Z",
                }
            ),
            encoding="utf-8",
        )

        class FakeRuntime:
            OPERATOR_STATUS_DIR = status_dir

            @staticmethod
            def clear_operator_status(op_id):
                if op_id == operator_id and status_path.exists():
                    status_path.unlink()

        monkeypatch.setattr(ofc, "PHYSICAL_OPERATORS_PATH", registry_path)
        monkeypatch.setattr(ofc, "HARNESS_DIR", tmp_path)
        monkeypatch.setattr(ofc, "_operator_runtime_module", lambda: FakeRuntime)
        monkeypatch.setattr(ofc, "_now", lambda: datetime.datetime(2026, 6, 14, 3, 45, tzinfo=datetime.timezone.utc))

        result = ofc.prune_expired_operator_config_blocks()

        assert result["ok"] is True
        assert any(
            item["operator_id"] == operator_id
            and item["expired_at"] == "registry_pruned_after_status_block"
            for item in result["pruned"]
        )
        assert not status_path.exists()

    def test_registry_prune_keeps_dynamic_status_with_explicit_quota_evidence(self, ofc, tmp_path, monkeypatch):
        import datetime

        registry_path = tmp_path / "config" / "physical-operators.json"
        status_dir = tmp_path / "run" / "operator-status"
        registry_path.parent.mkdir(parents=True)
        status_dir.mkdir(parents=True)
        operator_id = "mini-codex-gpt53-spark-builder-1"
        registry_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "operators": {
                        operator_id: {
                            "enabled": True,
                            "available": True,
                            "provider": "openai",
                            "model": "gpt-5.3-codex-spark",
                            "quota_guard_state": "ok",
                            "quota_refresh_at": None,
                            "state": {
                                "runtime_state": "idle",
                                "cooldown_until": None,
                                "last_pruned_at": "2026-06-17T01:48:10Z",
                            },
                            "flow_control": {
                                "last_pruned_at": "2026-06-17T01:48:10Z",
                                "last_prune_reason": "weak_failure_flow_rate_limit_evidence",
                            },
                        }
                    },
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        status_path = status_dir / f"{operator_id}.json"
        status_path.write_text(
            json.dumps(
                {
                    "operator_id": operator_id,
                    "runtime_state": "cooldown",
                    "reason": "rate_limit",
                    "evidence_text": "ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark.",
                    "updated_at": "2026-06-17T01:47:00Z",
                    "expires_at": "2026-06-18T04:20:00Z",
                }
            ),
            encoding="utf-8",
        )

        class FakeRuntime:
            OPERATOR_STATUS_DIR = status_dir

            @staticmethod
            def clear_operator_status(op_id):
                if op_id == operator_id and status_path.exists():
                    status_path.unlink()

        monkeypatch.setattr(ofc, "PHYSICAL_OPERATORS_PATH", registry_path)
        monkeypatch.setattr(ofc, "HARNESS_DIR", tmp_path)
        monkeypatch.setattr(ofc, "_operator_runtime_module", lambda: FakeRuntime)
        monkeypatch.setattr(ofc, "_now", lambda: datetime.datetime(2026, 6, 17, 2, 0, tzinfo=datetime.timezone.utc))

        result = ofc.prune_expired_operator_config_blocks()

        assert result["ok"] is True
        assert not any(item["operator_id"] == operator_id for item in result["pruned"])
        assert any(item["operator_id"] == operator_id for item in result["kept"])
        assert status_path.exists()

    def test_weak_failure_flow_cooldown_is_pruned(self, ofc, tmp_path, monkeypatch):
        import datetime

        registry_path = tmp_path / "config" / "physical-operators.json"
        registry_path.parent.mkdir(parents=True)
        operator_id = "mini-codex-gpt53-spark-builder-1"
        registry_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "operators": {
                        operator_id: {
                            "enabled": True,
                            "available": True,
                            "provider": "openai",
                            "model": "gpt-5.3-codex-spark",
                            "quota_guard_state": "cooldown",
                            "quota_refresh_at": "2026-06-18T04:20:00Z",
                            "state": {
                                "runtime_state": "cooldown",
                                "cooldown_until": "2026-06-18T04:20:00Z",
                                "last_error": "rate_limit",
                            },
                            "flow_control": {
                                "last_block_reason": "rate_limit",
                                "last_block_source": "failure_flow_control",
                                "last_block_detected_at": "2026-06-13T19:01:02Z",
                                "last_block_expires_at": "2026-06-18T04:20:00Z",
                                "last_block_excerpt": "capacity probe for graph-dispatch builder objective",
                            },
                        }
                    },
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        class FakeRuntime:
            OPERATOR_STATUS_DIR = tmp_path / "run" / "operator-status"

            @staticmethod
            def get_operator_status(_op_id):
                return None

        monkeypatch.setattr(ofc, "PHYSICAL_OPERATORS_PATH", registry_path)
        monkeypatch.setattr(ofc, "HARNESS_DIR", tmp_path)
        monkeypatch.setattr(ofc, "_operator_runtime_module", lambda: FakeRuntime)
        monkeypatch.setattr(ofc, "_now", lambda: datetime.datetime(2026, 6, 14, 2, 45, tzinfo=datetime.timezone.utc))

        result = ofc.prune_expired_operator_config_blocks()

        assert result["ok"] is True
        assert any(
            item["operator_id"] == operator_id
            and item["expired_at"] == "weak_failure_flow_rate_limit_evidence"
            for item in result["pruned"]
        )
        updated = json.loads(registry_path.read_text(encoding="utf-8"))["operators"][operator_id]
        assert updated["quota_guard_state"] == "ok"
        assert updated["quota_refresh_at"] is None
        assert updated["state"]["runtime_state"] == "idle"

    def test_persist_operator_block_clears_stale_prune_markers(self, ofc, tmp_path, monkeypatch):
        import datetime

        registry_path = tmp_path / "config" / "physical-operators.json"
        registry_path.parent.mkdir(parents=True)
        operator_id = "mini-codex-gpt53-spark-builder-1"
        registry_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "operators": {
                        operator_id: {
                            "enabled": True,
                            "available": True,
                            "quota_guard_state": "ok",
                            "quota_refresh_at": None,
                            "state": {
                                "runtime_state": "idle",
                                "last_pruned_at": "2026-06-17T01:48:10Z",
                            },
                            "flow_control": {
                                "last_pruned_at": "2026-06-17T01:48:10Z",
                                "last_prune_reason": "weak_failure_flow_rate_limit_evidence",
                            },
                        }
                    },
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        monkeypatch.setattr(ofc, "PHYSICAL_OPERATORS_PATH", registry_path)

        result = ofc.persist_operator_block(
            operator_id,
            "cooldown",
            expires_at=datetime.datetime(2026, 6, 18, 4, 20, tzinfo=datetime.timezone.utc),
            reason="rate_limit",
            source="failure_flow_control",
            evidence_text="ERROR: usage limit reached for GPT-5.3-Codex-Spark.",
        )

        assert result["ok"] is True
        updated = json.loads(registry_path.read_text(encoding="utf-8"))["operators"][operator_id]
        assert updated["quota_guard_state"] == "cooldown"
        assert "last_pruned_at" not in updated["state"]
        assert "last_pruned_at" not in updated["flow_control"]
        assert "last_prune_reason" not in updated["flow_control"]

    def test_recent_operator_quota_block_reads_result_logs(self, ofc, tmp_path, monkeypatch):
        import datetime

        operator_id = "mini-codex-gpt53-spark-builder-1"
        log_path = tmp_path / "run" / "operator-results" / operator_id / "task-1" / "codex-cli-output.log"
        log_path.parent.mkdir(parents=True)
        log_path.write_text(
            "ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. "
            "Switch to another model now, or try again at Jun 18th, 2026 12:20 AM.\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(ofc, "OPERATOR_RESULTS_DIR", tmp_path / "run" / "operator-results")

        block = ofc.recent_operator_quota_block(
            operator_id,
            now=datetime.datetime(2026, 6, 17, 11, 0, tzinfo=datetime.timezone.utc),
        )

        assert block is not None
        assert block["runtime_state"] == "cooldown"
        assert block["expires_at"] == "2026-06-18T04:20:00Z"

    def test_recent_operator_quota_block_ignores_other_model_marker(self, ofc, tmp_path, monkeypatch):
        import datetime

        operator_id = "mini-codex-gpt55-medium-builder-1"
        log_path = tmp_path / "run" / "operator-results" / operator_id / "task-1" / "codex-cli-output.log"
        log_path.parent.mkdir(parents=True)
        log_path.write_text(
            "diagnostic output: ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. "
            "Switch to another model now, or try again at Jun 18th, 2026 12:20 AM.\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(ofc, "OPERATOR_RESULTS_DIR", tmp_path / "run" / "operator-results")

        block = ofc.recent_operator_quota_block(
            operator_id,
            model_hint="gpt-5.5",
            now=datetime.datetime(2026, 6, 17, 11, 0, tzinfo=datetime.timezone.utc),
        )

        assert block is None

    def test_claude_live_heartbeat_clears_future_registry_and_status_cooldown(self, ofc, tmp_path, monkeypatch):
        import datetime

        registry_path = tmp_path / "config" / "physical-operators.json"
        status_dir = tmp_path / "run" / "operator-status"
        status_dir.mkdir(parents=True)
        registry_path.parent.mkdir(parents=True)
        operator_id = "mini-claude-opus-evaluator"
        registry_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "operators": {
                        operator_id: {
                            "enabled": True,
                            "available": True,
                            "provider": "anthropic",
                            "backend": "claude-cli",
                            "model": "opus",
                            "quota_guard_state": "cooldown",
                            "quota_refresh_at": "2026-06-13T06:50:00Z",
                            "state": {
                                "runtime_state": "cooldown",
                                "cooldown_until": "2026-06-13T06:50:00Z",
                                "last_error_at": "2026-06-12T21:00:00Z",
                            },
                            "flow_control": {
                                "last_block_detected_at": "2026-06-12T21:00:00Z",
                                "last_block_expires_at": "2026-06-13T06:50:00Z",
                            },
                        }
                    },
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        status_path = status_dir / f"{operator_id}.json"
        status_payload = {
            "operator_id": operator_id,
            "runtime_state": "cooldown",
            "state": "idle",
            "updated_at": "2026-06-12T21:00:00Z",
            "expires_at": "2026-06-13T06:50:00Z",
            "heartbeat_at": "2026-06-12T23:30:00Z",
            "effective_provider": "anthropic",
        }
        status_path.write_text(json.dumps(status_payload), encoding="utf-8")

        class FakeRuntime:
            OPERATOR_STATUS_DIR = status_dir

            @staticmethod
            def get_operator_status(op_id):
                if op_id != operator_id or not status_path.exists():
                    return None
                return json.loads(status_path.read_text(encoding="utf-8"))

            @staticmethod
            def clear_operator_status(op_id):
                if op_id == operator_id and status_path.exists():
                    status_path.unlink()

        monkeypatch.setattr(ofc, "PHYSICAL_OPERATORS_PATH", registry_path)
        monkeypatch.setattr(ofc, "HARNESS_DIR", tmp_path)
        monkeypatch.setattr(ofc, "_operator_runtime_module", lambda: FakeRuntime)
        monkeypatch.setattr(ofc, "_now", lambda: datetime.datetime(2026, 6, 12, 23, 45, tzinfo=datetime.timezone.utc))

        result = ofc.prune_expired_operator_config_blocks()

        assert result["ok"] is True
        assert any(item["operator_id"] == operator_id and item["expired_at"] == "claude_live_heartbeat_after_block" for item in result["pruned"])
        updated = json.loads(registry_path.read_text(encoding="utf-8"))["operators"][operator_id]
        assert updated["quota_guard_state"] == "ok"
        assert updated["quota_refresh_at"] is None
        assert updated["state"]["runtime_state"] == "idle"
        assert not status_path.exists()

    def test_claude_pane_quota_only_prunes_mismatched_model_blocks(self, ofc, tmp_path, monkeypatch):
        import datetime

        registry_path = tmp_path / "config" / "physical-operators.json"
        registry_path.parent.mkdir(parents=True)
        registry_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "operators": {
                        "mini-claude-opus-evaluator": {
                            "enabled": True,
                            "available": True,
                            "provider": "anthropic",
                            "backend": "claude-cli",
                            "model": "opus",
                            "quota_guard_state": "cooldown",
                            "quota_refresh_at": "2026-06-19T00:00:00Z",
                            "state": {"runtime_state": "cooldown", "cooldown_until": "2026-06-19T00:00:00Z"},
                            "flow_control": {
                                "last_block_reason": "pane_tui_rate_limit",
                                "last_block_source": "tmux_pane:solar-harness:0.3",
                                "last_block_excerpt": "Claude Code claude-opus-4-8\nYou've hit your limit · resets 8pm",
                            },
                        },
                        "mini-claude-sonnet-builder": {
                            "enabled": True,
                            "available": True,
                            "provider": "anthropic",
                            "backend": "claude-cli",
                            "model": "sonnet",
                            "quota_guard_state": "cooldown",
                            "quota_refresh_at": "2026-06-19T00:00:00Z",
                            "state": {"runtime_state": "cooldown", "cooldown_until": "2026-06-19T00:00:00Z"},
                            "flow_control": {
                                "last_block_reason": "pane_tui_rate_limit",
                                "last_block_source": "tmux_pane:solar-harness:0.3",
                                "last_block_excerpt": "Claude Code claude-opus-4-8\nYou've hit your limit · resets 8pm",
                            },
                        },
                    },
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        class FakeRuntime:
            OPERATOR_STATUS_DIR = tmp_path / "run" / "operator-status"

            @staticmethod
            def get_operator_status(_op_id):
                return None

        monkeypatch.setattr(ofc, "PHYSICAL_OPERATORS_PATH", registry_path)
        monkeypatch.setattr(ofc, "HARNESS_DIR", tmp_path)
        monkeypatch.setattr(ofc, "_operator_runtime_module", lambda: FakeRuntime)
        monkeypatch.setattr(ofc, "_now", lambda: datetime.datetime(2026, 6, 18, 0, 15, tzinfo=datetime.timezone.utc))

        result = ofc.prune_expired_operator_config_blocks()

        assert result["ok"] is True
        assert any(
            item["operator_id"] == "mini-claude-sonnet-builder"
            and item["expired_at"] == "claude_pane_quota_model_mismatch"
            for item in result["pruned"]
        )
        assert any(item["operator_id"] == "mini-claude-opus-evaluator" for item in result["kept"])
        updated = json.loads(registry_path.read_text(encoding="utf-8"))["operators"]
        assert updated["mini-claude-sonnet-builder"]["quota_guard_state"] == "ok"
        assert updated["mini-claude-sonnet-builder"]["state"]["runtime_state"] == "idle"
        assert updated["mini-claude-opus-evaluator"]["quota_guard_state"] == "cooldown"

    def test_claude_compatible_glm_is_not_pruned_by_claude_model_mismatch(self, ofc, tmp_path, monkeypatch):
        import datetime

        registry_path = tmp_path / "config" / "physical-operators.json"
        registry_path.parent.mkdir(parents=True)
        operator_id = "mini-glm51-builder-1"
        registry_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "operators": {
                        operator_id: {
                            "enabled": True,
                            "available": True,
                            "provider": "glm",
                            "backend": "claude-cli",
                            "model": "glm-5.1",
                            "model_config": "glm-5.1;claude-compatible;print_once;builder-pool",
                            "quota_guard_state": "cooldown",
                            "quota_refresh_at": "2026-06-19T00:00:00Z",
                            "state": {"runtime_state": "cooldown", "cooldown_until": "2026-06-19T00:00:00Z"},
                            "flow_control": {
                                "last_block_reason": "pane_tui_rate_limit",
                                "last_block_source": "tmux_pane:solar-harness:0.3",
                                "last_block_excerpt": "Claude Code claude-opus-4-8\nYou've hit your limit · resets 8pm",
                            },
                        },
                    },
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        class FakeRuntime:
            OPERATOR_STATUS_DIR = tmp_path / "run" / "operator-status"

            @staticmethod
            def get_operator_status(_op_id):
                return None

        monkeypatch.setattr(ofc, "PHYSICAL_OPERATORS_PATH", registry_path)
        monkeypatch.setattr(ofc, "HARNESS_DIR", tmp_path)
        monkeypatch.setattr(ofc, "_operator_runtime_module", lambda: FakeRuntime)
        monkeypatch.setattr(ofc, "_now", lambda: datetime.datetime(2026, 6, 18, 0, 15, tzinfo=datetime.timezone.utc))

        result = ofc.prune_expired_operator_config_blocks()

        assert result["ok"] is True
        assert not any(item["operator_id"] == operator_id for item in result["pruned"])
        assert any(item["operator_id"] == operator_id for item in result["kept"])
