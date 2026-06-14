"""Tests for autopilot source-aware routing (S04 N4).

Covers: _lineage_decision annotation, degraded fallback, report-source-mix CLI.
"""
from __future__ import annotations

import importlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

HARNESS = Path(__file__).resolve().parents[2]
os.environ.setdefault("SOLAR_HARNESS_DIR", str(HARNESS))

sys.path.insert(0, str(HARNESS / "tools"))
sys.path.insert(0, str(HARNESS / "lib"))


def _get_autopilot_module():
    """Load tools/autopilot.py (script, not the autopilot/ package)."""
    mod_name = "autopilot_script"
    if mod_name in sys.modules:
        return sys.modules[mod_name]
    mod_path = HARNESS / "tools" / "autopilot.py"
    spec = importlib.util.spec_from_file_location(mod_name, mod_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)
    return mod


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _child_graph(sprint_id: str = "sprint-cx-route") -> dict:
    return {
        "sprint_id": sprint_id,
        "nodes": [
            {
                "id": "N1_ready",
                "goal": "ready node",
                "depends_on": [],
                "status": "pending",
                "write_scope": ["tools/autopilot.py"],
            }
        ],
    }


class TestLineageDecision:
    def test_returns_lineage_for_valid_sprint(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        sprints = tmp_path / "sprints"
        sprints.mkdir()
        raw = {
            "intent_id": "intent-test-1",
            "source": {"channel": "antigravity_app", "conversation_id": "conv-1"},
            "raw": {"text": "test"},
        }
        p = sprints / "sprint-test-1.raw_intent.json"
        p.write_text(json.dumps(raw), encoding="utf-8")

        import tools.antigravity_orchestration_view as lv_mod
        monkeypatch.setattr(lv_mod, "SPRINTS_DIR", sprints)

        # Ensure autopilot's importlib finds the same patched module
        sys.modules["antigravity_orchestration_view"] = lv_mod

        mod = _get_autopilot_module()
        result = mod._lineage_decision("sprint-test-1")
        assert result["source"] == "antigravity-app"
        assert result["is_antigravity_desktop"] is True

    def test_returns_unknown_on_missing(self) -> None:
        mod = _get_autopilot_module()
        result = mod._lineage_decision("sprint-nonexistent-xyz")
        assert result["source"] == "unknown"
        assert result["is_antigravity_desktop"] is False

    def test_codex_sprint_not_antigravity(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        sprints = tmp_path / "sprints"
        sprints.mkdir()
        raw = {
            "intent_id": "intent-cx-1",
            "source": {"channel": "codex_bridge"},
            "raw": {"text": "test"},
        }
        p = sprints / "sprint-cx-1.raw_intent.json"
        p.write_text(json.dumps(raw), encoding="utf-8")

        import tools.antigravity_orchestration_view as lv_mod
        monkeypatch.setattr(lv_mod, "SPRINTS_DIR", sprints)
        sys.modules["antigravity_orchestration_view"] = lv_mod

        mod = _get_autopilot_module()
        result = mod._lineage_decision("sprint-cx-1")
        assert result["source"] == "codex"
        assert result["is_antigravity_desktop"] is False

    def test_returns_unknown_when_lineage_lookup_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        mod = _get_autopilot_module()

        class BrokenLineage:
            @staticmethod
            def lineage_for_sprint(_sprint_id: str) -> dict:
                raise RuntimeError("fixture lineage failure")

        monkeypatch.setitem(sys.modules, "antigravity_orchestration_view", BrokenLineage)

        result = mod._lineage_decision("sprint-broken")

        assert result["source"] == "unknown"
        assert result["is_antigravity_desktop"] is False
        assert "fixture lineage failure" in result["degraded_reason"]


class TestActivateGraphSourceAnnotation:
    def test_annotates_activation_history_and_preserves_codex_route(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        harness = tmp_path / "harness"
        sprints = harness / "sprints"
        state = harness / "state"
        sprint_id = "sprint-cx-route"
        _write_json(sprints / f"{sprint_id}.task_graph.json", _child_graph(sprint_id))
        _write_json(
            sprints / f"{sprint_id}.status.json",
            {
                "sprint_id": sprint_id,
                "phase": "planning_complete",
                "target_role": "builder_main",
                "history": [],
            },
        )
        _write_json(
            sprints / f"{sprint_id}.raw_intent.json",
            {
                "intent_id": "intent-cx-route",
                "source": {"channel": "codex_bridge"},
                "raw": {"text": "codex route regression"},
            },
        )

        import graph_scheduler
        import tools.antigravity_orchestration_view as lv_mod

        monkeypatch.setattr(graph_scheduler, "HARNESS_DIR", harness)
        monkeypatch.setattr(graph_scheduler, "SPRINTS_DIR", sprints)
        monkeypatch.setattr(lv_mod, "SPRINTS_DIR", sprints)
        monkeypatch.setitem(sys.modules, "antigravity_orchestration_view", lv_mod)

        mod = _get_autopilot_module()
        monkeypatch.setattr(mod, "HARNESS_DIR", harness)

        result = mod.activate_graph(sprint_id)

        assert result["decision"]["phase"] == "planning_complete"
        assert result["decision"]["target_role"] == "builder_main"
        assert result["decision"]["route_role"] == "builder_main"
        assert result["source_lineage"]["source"] == "codex"
        assert result["decision"]["source_lineage"]["source"] == "codex"

        status = json.loads((sprints / f"{sprint_id}.status.json").read_text(encoding="utf-8"))
        event = status["history"][-1]
        assert event["source_lineage"]["source"] == "codex"
        assert event["lineage"]["source"] == "codex"
        assert event["routing_origin"] == "unified_orchestration"

        autopilot_state = json.loads((state / "autopilot-state.json").read_text(encoding="utf-8"))
        activation = autopilot_state["activation_history"][-1]
        assert activation["source_lineage"]["source"] == "codex"
        assert activation["phase"] == "planning_complete"
        assert activation["target_role"] == "builder_main"
        assert activation["ready_nodes"] == ["N1_ready"]

    def test_activate_graph_continues_when_lineage_raises(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        harness = tmp_path / "harness"
        sprints = harness / "sprints"
        sprint_id = "sprint-broken-lineage"
        _write_json(sprints / f"{sprint_id}.task_graph.json", _child_graph(sprint_id))
        _write_json(
            sprints / f"{sprint_id}.status.json",
            {"sprint_id": sprint_id, "phase": "planning_complete", "target_role": "builder_main", "history": []},
        )

        import graph_scheduler

        class BrokenLineage:
            @staticmethod
            def lineage_for_sprint(_sprint_id: str) -> dict:
                raise RuntimeError("lineage backend unavailable")

        monkeypatch.setattr(graph_scheduler, "HARNESS_DIR", harness)
        monkeypatch.setattr(graph_scheduler, "SPRINTS_DIR", sprints)
        monkeypatch.setitem(sys.modules, "antigravity_orchestration_view", BrokenLineage)

        mod = _get_autopilot_module()
        monkeypatch.setattr(mod, "HARNESS_DIR", harness)

        result = mod.activate_graph(sprint_id)

        assert result["ok"] is True
        assert result["decision"]["can_dispatch"] is True
        assert result["source_lineage"]["source"] == "unknown"
        assert "lineage backend unavailable" in result["source_lineage"]["degraded_reason"]


class TestReportSourceMix:
    def test_empty_when_no_state(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        mod = _get_autopilot_module()
        monkeypatch.setattr(mod, "HARNESS_DIR", tmp_path)
        result = mod._report_source_mix()
        assert result["by_source"] == {}
        assert result["ready_routes"] == []

    def test_counts_by_source(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        mod = _get_autopilot_module()
        monkeypatch.setattr(mod, "HARNESS_DIR", tmp_path)
        state_dir = tmp_path / "state"
        state_dir.mkdir()
        state = {
            "activation_history": [
                {
                    "ts": "2026-06-05T10:00:00Z",
                    "sprint_id": "sprint-ag-1",
                    "source_lineage": {"source": "antigravity-app", "is_antigravity_desktop": True},
                    "route_role": "builder_main",
                    "target_role": "builder_main",
                    "phase": "planning_complete",
                    "ready_nodes": ["N1"],
                    "can_dispatch": True,
                    "routing_origin": "antigravity_desktop_bridge",
                },
                {"ts": "2026-06-05T10:01:00Z", "source_lineage": {"source": "antigravity-app"}},
                {"ts": "2026-06-05T10:02:00Z", "source_lineage": {"source": "codex"}},
            ]
        }
        (state_dir / "autopilot-state.json").write_text(json.dumps(state), encoding="utf-8")

        result = mod._report_source_mix(since_hours=9999)
        assert result["by_source"]["antigravity-app"] == 2
        assert result["by_source"]["codex"] == 1
        assert result["ready_routes"] == [
            {
                "ts": "2026-06-05T10:00:00Z",
                "sprint_id": "sprint-ag-1",
                "source": "antigravity-app",
                "route_role": "builder_main",
                "target_role": "builder_main",
                "phase": "planning_complete",
                "ready_nodes": ["N1"],
                "routing_origin": "antigravity_desktop_bridge",
            }
        ]

    def test_cli_report_source_mix_flag(self, tmp_path: Path) -> None:
        state_dir = tmp_path / "state"
        state_dir.mkdir()
        _write_json(
            state_dir / "autopilot-state.json",
            {
                "activation_history": [
                    {
                        "ts": "2026-06-05T10:00:00Z",
                        "sprint_id": "sprint-cli",
                        "source_lineage": {"source": "codex"},
                        "ready_nodes": ["N1"],
                        "route_role": "builder_main",
                        "target_role": "builder_main",
                        "phase": "planning_complete",
                    }
                ]
            },
        )

        env = os.environ.copy()
        env["HARNESS_DIR"] = str(tmp_path)
        proc = subprocess.run(
            [sys.executable, str(HARNESS / "tools" / "autopilot.py"), "--report-source-mix", "--since-hours", "9999"],
            check=True,
            text=True,
            capture_output=True,
            env=env,
        )
        result = json.loads(proc.stdout)

        assert result["by_source"] == {"codex": 1}
        assert result["ready_routes"][0]["target_role"] == "builder_main"
