"""test_operator_runtime_core.py — B4 Operator Runtime Core Tests.

Covers:
- tmux pane = physical host, operator_id = runtime actor (separation)
- lease/ack/hygiene/quota state recording and queryability
- TUI vs headless surface classification
- send-keys bootstrap-only semantics (documented contract)

Tests use a temporary HARNESS_DIR so they never touch real operator state.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any, Dict
from unittest.mock import patch


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_temp_harness() -> Path:
    """Create a minimal temporary harness directory structure."""
    tmp = Path(tempfile.mkdtemp(prefix="solar_test_harness_"))
    (tmp / "run" / "operator-leases").mkdir(parents=True)
    (tmp / "run" / "operator-status").mkdir(parents=True)
    (tmp / "run" / "operator-inbox").mkdir(parents=True)
    (tmp / "run" / "operator-quota").mkdir(parents=True)
    (tmp / "config").mkdir(parents=True)
    (tmp / "personas").mkdir(parents=True)
    return tmp


def _write_operator_registry(harness_dir: Path, operators: Dict[str, Any]) -> None:
    """Write a minimal physical-operators.json to the temp harness config."""
    registry = {"version": 1, "operators": operators}
    (harness_dir / "config" / "physical-operators.json").write_text(
        json.dumps(registry, indent=2), encoding="utf-8"
    )


def _make_tui_operator_config(pane_ref: str = "solar-harness:0.0") -> Dict[str, Any]:
    return {
        "display_name": "Test TUI Operator",
        "enabled": True,
        "surface": {"type": "claude_code_interactive"},
        "physical": {"backend": "tmux", "pane_ref": pane_ref, "session": "solar-harness"},
        "auth": {"mode": "subscription_cli"},
        "quota": {"period": "monthly"},
        "state": {"availability": "enabled", "runtime_state": "idle"},
    }


def _make_headless_operator_config() -> Dict[str, Any]:
    return {
        "display_name": "Test Headless Operator",
        "enabled": True,
        "surface": {"type": "claude_print"},
        "auth": {"mode": "api_key"},
        "quota": {"period": "api_balance"},
        "state": {"availability": "enabled", "runtime_state": "idle"},
    }


# ─── Test base with temp harness ──────────────────────────────────────────────

class HarnessTestCase(unittest.TestCase):
    """Base class: patches operator_runtime module-level globals to use a tmpdir."""

    def setUp(self) -> None:
        self.tmpdir = _make_temp_harness()
        self._patches: list = []

        # We patch the module-level directory constants AFTER import so
        # the module uses our temp dir.
        tools_dir = str(Path(__file__).resolve().parent.parent / "tools")
        if tools_dir not in sys.path:
            sys.path.insert(0, tools_dir)

        # Import fresh (or reuse cached)
        import operator_runtime as _or_mod
        import actor_runtime as _ar_mod

        # Patch directory constants in operator_runtime
        for attr, subpath in [
            ("OPERATOR_LEASE_DIR", "run/operator-leases"),
            ("OPERATOR_STATUS_DIR", "run/operator-status"),
            ("OPERATOR_INBOX_DIR", "run/operator-inbox"),
            ("OPERATOR_RESULTS_DIR", "run/operator-results"),
            ("OPERATOR_QUOTA_DIR", "run/operator-quota"),
            ("OPERATOR_PERSONAS_DIR", "personas"),
            ("HARNESS_DIR", ""),
        ]:
            target = self.tmpdir if not subpath else (self.tmpdir / subpath)
            p = patch.object(_or_mod, attr, target)
            p.start()
            self._patches.append(p)

        # Patch physical operators path
        ops_path = self.tmpdir / "config" / "physical-operators.json"
        p2 = patch.object(_or_mod, "PHYSICAL_OPERATORS_PATH", ops_path)
        p2.start()
        self._patches.append(p2)

        self.or_mod = _or_mod
        self.ar_mod = _ar_mod

    def tearDown(self) -> None:
        for p in self._patches:
            p.stop()
        shutil.rmtree(str(self.tmpdir), ignore_errors=True)


# ─── Test: pane = host, operator_id = actor ───────────────────────────────────

class TestPaneIsHostOperatorIsActor(HarnessTestCase):
    """Verify the S03 identity model: tmux pane is host, operator_id is actor."""

    def test_operator_id_is_actor_identity(self) -> None:
        """OperatorRuntimeEntity uses operator_id as its actor key, not pane location."""
        _write_operator_registry(self.tmpdir, {
            "op-alpha": _make_tui_operator_config("solar-harness:0.1"),
        })
        entity = self.or_mod.OperatorRuntimeEntity("op-alpha")
        self.assertEqual(entity.operator_id, "op-alpha")

    def test_physical_host_meta_is_read_only_info(self) -> None:
        """physical_host_meta() returns pane metadata but does not drive runtime state."""
        _write_operator_registry(self.tmpdir, {
            "op-alpha": _make_tui_operator_config("solar-harness:0.2"),
        })
        entity = self.or_mod.OperatorRuntimeEntity("op-alpha")
        meta = entity.physical_host_meta()
        self.assertIsNotNone(meta)
        self.assertEqual(meta.get("backend"), "tmux")
        self.assertEqual(meta.get("pane_ref"), "solar-harness:0.2")
        # Changing pane_ref externally must not change the operator_id
        self.assertEqual(entity.operator_id, "op-alpha")

    def test_pane_ref_not_required_for_headless(self) -> None:
        """Headless operators do not need pane_ref; operator_id is still the actor."""
        _write_operator_registry(self.tmpdir, {
            "op-headless": _make_headless_operator_config(),
        })
        entity = self.or_mod.OperatorRuntimeEntity("op-headless")
        meta = entity.physical_host_meta()
        # No physical block expected for headless
        self.assertIsNone(meta)
        # But operator_id is still the actor
        self.assertEqual(entity.operator_id, "op-headless")


# ─── Test: lease / ack / hygiene / quota queryable ────────────────────────────

class TestLeaseAckHygieneQuotaQueryable(HarnessTestCase):

    def _register_and_lease(self, op_id: str) -> Dict[str, Any]:
        _write_operator_registry(self.tmpdir, {op_id: _make_tui_operator_config()})
        return self.or_mod.acquire_operator_lease(
            operator_id=op_id,
            task_id=f"task-{op_id}",
            sprint_id="sprint-test",
            node_id="N1_test",
            ttl_seconds=3600,
        )

    def test_lease_is_queryable_after_acquire(self) -> None:
        lease = self._register_and_lease("op-lease")
        fetched = self.or_mod.get_operator_lease("op-lease")
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched["operator_id"], "op-lease")
        self.assertEqual(fetched["state"], "leased")

    def test_ack_updates_lease_metadata(self) -> None:
        self._register_and_lease("op-ack")
        entity = self.or_mod.OperatorRuntimeEntity("op-ack")
        updated = entity.ack(task_id="task-op-ack", node_id="N4_operator_runtime")
        self.assertIn("ack_at", updated)
        self.assertEqual(updated["ack_task_id"], "task-op-ack")
        self.assertEqual(updated["ack_node_id"], "N4_operator_runtime")
        # Re-read from disk to confirm persistence
        lease = self.or_mod.get_operator_lease("op-ack")
        self.assertIsNotNone(lease)
        self.assertIn("ack_at", lease)

    def test_hygiene_ok_after_fresh_lease_and_ack(self) -> None:
        self._register_and_lease("op-healthy")
        entity = self.or_mod.OperatorRuntimeEntity("op-healthy")
        entity.ack(task_id="task-op-healthy", node_id="N4")
        report = entity.hygiene_check()
        self.assertEqual(report["operator_id"], "op-healthy")
        self.assertTrue(report["has_ack"])
        # lease_expired should NOT be present with TTL=3600
        self.assertNotIn("lease_expired", report["issues"])

    def test_hygiene_detects_disabled_operator(self) -> None:
        disabled = dict(_make_tui_operator_config())
        disabled["enabled"] = False
        _write_operator_registry(self.tmpdir, {"op-disabled": disabled})
        entity = self.or_mod.OperatorRuntimeEntity("op-disabled")
        report = entity.hygiene_check()
        self.assertIn("operator_disabled", report["issues"])
        self.assertFalse(report["hygiene_ok"])

    def test_quota_record_and_status(self) -> None:
        _write_operator_registry(self.tmpdir, {"op-quota": _make_tui_operator_config()})
        entity = self.or_mod.OperatorRuntimeEntity("op-quota")
        entry = entity.record_quota_event("task_start", units=1.0)
        self.assertEqual(entry["event"], "task_start")
        self.assertEqual(entry["units"], 1.0)
        entity.record_quota_event("token_consumed", units=0.5, metadata={"tokens": 500})
        status = entity.quota_status()
        self.assertEqual(status["operator_id"], "op-quota")
        self.assertEqual(status["event_count"], 2)
        self.assertAlmostEqual(status["total_units"], 1.5)
        events = status["events"]
        self.assertEqual(events[0]["event"], "task_start")
        self.assertEqual(events[1]["event"], "token_consumed")

    def test_quota_status_empty_when_no_log(self) -> None:
        summary = self.or_mod.get_quota_status("op-no-log")
        self.assertEqual(summary["event_count"], 0)
        self.assertEqual(summary["total_units"], 0.0)
        self.assertEqual(summary["events"], [])

    def test_runtime_summary_contains_all_sections(self) -> None:
        self._register_and_lease("op-summary")
        entity = self.or_mod.OperatorRuntimeEntity("op-summary")
        entity.ack(task_id="task-op-summary", node_id="N4")
        entity.record_quota_event("task_start")
        summary = entity.runtime_summary()
        self.assertIn("operator_id", summary)
        self.assertIn("runtime_state", summary)
        self.assertIn("lease", summary)
        self.assertIn("hygiene", summary)
        self.assertIn("quota_summary", summary)
        self.assertIn("queried_at", summary)
        self.assertEqual(summary["operator_id"], "op-summary")
        self.assertIsNotNone(summary["lease"])
        self.assertEqual(summary["quota_summary"]["event_count"], 1)

    def test_runtime_state_is_leased_when_lease_active(self) -> None:
        self._register_and_lease("op-state-check")
        state = self.or_mod.get_operator_runtime_state("op-state-check")
        self.assertEqual(state, "leased")

    def test_runtime_state_is_idle_after_release(self) -> None:
        self._register_and_lease("op-released")
        self.or_mod.release_operator_lease("op-released")
        state = self.or_mod.get_operator_runtime_state("op-released")
        self.assertEqual(state, "idle")


# ─── Test: TUI vs headless surface routing ────────────────────────────────────

class TestTUIHeadlessSurfaceRouting(unittest.TestCase):
    """Verify surface classification and send-keys semantic contract."""

    def setUp(self) -> None:
        tools_dir = str(Path(__file__).resolve().parent.parent / "tools")
        if tools_dir not in sys.path:
            sys.path.insert(0, tools_dir)
        import actor_runtime as _ar_mod
        self.ar = _ar_mod

    def test_claude_code_interactive_is_tui(self) -> None:
        config = _make_tui_operator_config()
        result = self.ar.classify_operator_surface(config)
        self.assertEqual(result, self.ar.SURFACE_TUI)

    def test_claude_print_is_headless(self) -> None:
        config = _make_headless_operator_config()
        result = self.ar.classify_operator_surface(config)
        self.assertEqual(result, self.ar.SURFACE_HEADLESS)

    def test_claude_sdk_is_headless(self) -> None:
        config = {"surface": {"type": "claude_sdk"}, "enabled": True}
        result = self.ar.classify_operator_surface(config)
        self.assertEqual(result, self.ar.SURFACE_HEADLESS)

    def test_managed_agent_is_headless(self) -> None:
        config = {"surface": {"type": "managed_agent"}, "enabled": True}
        result = self.ar.classify_operator_surface(config)
        self.assertEqual(result, self.ar.SURFACE_HEADLESS)

    def test_tmux_backend_fallback_is_tui(self) -> None:
        config = {
            "enabled": True,
            "physical": {"backend": "tmux"},
        }
        result = self.ar.classify_operator_surface(config)
        self.assertEqual(result, self.ar.SURFACE_TUI)

    def test_unknown_surface_defaults_to_headless(self) -> None:
        config = {"enabled": True}
        result = self.ar.classify_operator_surface(config)
        self.assertEqual(result, self.ar.SURFACE_HEADLESS)

    def test_surface_constants_defined(self) -> None:
        """SURFACE_TUI and SURFACE_HEADLESS must be importable constants."""
        self.assertEqual(self.ar.SURFACE_TUI, "tui")
        self.assertEqual(self.ar.SURFACE_HEADLESS, "headless")


# ─── Test: send-keys bootstrap-only semantics ─────────────────────────────────

class TestSendKeysBootstrapSemantics(unittest.TestCase):
    """Verify the documented send-keys compat/bootstrap contract.

    send-keys is not a dispatch channel; it is only used for initial pane
    bootstrap in TUI operators. This test validates the classification that
    determines WHEN send-keys is applicable.
    """

    def setUp(self) -> None:
        tools_dir = str(Path(__file__).resolve().parent.parent / "tools")
        if tools_dir not in sys.path:
            sys.path.insert(0, tools_dir)
        import actor_runtime as _ar_mod
        self.ar = _ar_mod

    def test_send_keys_applicable_only_for_tui(self) -> None:
        """Only TUI operators should use send-keys (bootstrap/compat only)."""
        tui_config = _make_tui_operator_config()
        headless_config = _make_headless_operator_config()
        tui_surface = self.ar.classify_operator_surface(tui_config)
        headless_surface = self.ar.classify_operator_surface(headless_config)
        self.assertEqual(tui_surface, self.ar.SURFACE_TUI)
        self.assertEqual(headless_surface, self.ar.SURFACE_HEADLESS)
        # The classification result is the signal for whether send-keys bootstrap applies
        self.assertNotEqual(tui_surface, headless_surface)

    def test_classify_returns_string_not_bool(self) -> None:
        """Surface classification returns a string constant, not a boolean."""
        result = self.ar.classify_operator_surface(_make_tui_operator_config())
        self.assertIsInstance(result, str)


# ─── Test: module-level quota functions ───────────────────────────────────────

class TestModuleLevelQuotaFunctions(HarnessTestCase):

    def test_record_and_get_quota_round_trip(self) -> None:
        entry = self.or_mod.record_quota_event("op-x", "cooldown_entered", units=0.0)
        self.assertEqual(entry["operator_id"], "op-x")
        self.assertEqual(entry["event"], "cooldown_entered")
        status = self.or_mod.get_quota_status("op-x")
        self.assertEqual(status["event_count"], 1)

    def test_multiple_events_accumulate(self) -> None:
        for i in range(5):
            self.or_mod.record_quota_event("op-multi", f"ev_{i}", units=float(i + 1))
        status = self.or_mod.get_quota_status("op-multi")
        self.assertEqual(status["event_count"], 5)
        self.assertAlmostEqual(status["total_units"], 1 + 2 + 3 + 4 + 5)

    def test_last_n_limits_returned_events(self) -> None:
        for i in range(10):
            self.or_mod.record_quota_event("op-limit", "ev", units=1.0)
        status = self.or_mod.get_quota_status("op-limit", last_n=3)
        self.assertEqual(len(status["events"]), 3)


# ─── Test: ack without active lease raises ───────────────────────────────────

class TestAckWithoutLease(HarnessTestCase):

    def test_ack_without_lease_raises(self) -> None:
        _write_operator_registry(self.tmpdir, {
            "op-nolease": _make_tui_operator_config()
        })
        entity = self.or_mod.OperatorRuntimeEntity("op-nolease")
        with self.assertRaises(RuntimeError):
            entity.ack(task_id="task-nolease", node_id="N4")


# ─── Edge cases ───────────────────────────────────────────────────────────────

class TestEdgeCases(HarnessTestCase):

    def test_hygiene_no_lease_no_status(self) -> None:
        _write_operator_registry(self.tmpdir, {
            "op-bare": _make_tui_operator_config()
        })
        entity = self.or_mod.OperatorRuntimeEntity("op-bare")
        report = entity.hygiene_check()
        self.assertIsNone(report["lease_state"])
        self.assertFalse(report["has_ack"])
        self.assertEqual(report["inbox_depth"], 0)
        # No issues expected for an idle operator with no lease
        self.assertTrue(report["hygiene_ok"])

    def test_quota_event_with_metadata(self) -> None:
        entry = self.or_mod.record_quota_event(
            "op-meta", "token_consumed", units=2.5,
            metadata={"model": "claude-opus-4-7", "prompt_tokens": 1000}
        )
        self.assertIn("metadata", entry)
        self.assertEqual(entry["metadata"]["model"], "claude-opus-4-7")

    def test_runtime_summary_no_lease(self) -> None:
        _write_operator_registry(self.tmpdir, {
            "op-idle": _make_tui_operator_config()
        })
        entity = self.or_mod.OperatorRuntimeEntity("op-idle")
        summary = entity.runtime_summary()
        self.assertEqual(summary["runtime_state"], "idle")
        self.assertIsNone(summary["lease"])
        self.assertIn("hygiene", summary)
        self.assertIn("quota_summary", summary)


if __name__ == "__main__":
    unittest.main(verbosity=2)
