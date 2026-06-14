"""Tests for antigravity source-aware orchestration routes.

Covers:
- /orchestration/epics/<id> returns source_summary + per_child_source_lineage
- /orchestration/sprints/<id> returns source_lineage block
- /orchestration/antigravity/sprints filters antigravity-source sprints
- /orchestration/antigravity-bridge returns recent_captures + recent_dispatches
- Degraded fallback when lineage view fails
- No existing endpoint payload field is removed or renamed
"""
from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

HARNESS = Path(__file__).resolve().parents[2]
os.environ.setdefault("SOLAR_HARNESS_DIR", str(HARNESS))

sys.path.insert(0, str(HARNESS / "status-server"))
sys.path.insert(0, str(HARNESS / "status-server" / "routes"))
sys.path.insert(0, str(HARNESS / "tools"))
sys.path.insert(0, str(HARNESS / "lib"))


def _get_orchestration_routes():
    mod_name = "orchestration_routes"
    if mod_name in sys.modules:
        return sys.modules[mod_name]
    mod_path = HARNESS / "status-server" / "routes" / "orchestration_routes.py"
    spec = importlib.util.spec_from_file_location(mod_name, mod_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def flask_app(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Create a Flask test app with the orchestration blueprint and temp dirs."""
    from flask import Flask

    sprints = tmp_path / "sprints"
    sprints.mkdir()
    state = tmp_path / "state"
    state.mkdir()

    mod = _get_orchestration_routes()
    monkeypatch.setattr(mod, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(mod, "STATE_DIR", state)

    app = Flask(__name__)
    app.register_blueprint(mod.orchestration_bp, url_prefix="/orchestration")
    app.config["TESTING"] = True
    return app, sprints, state


def _write_sprint_status(sprints: Path, sprint_id: str, data: dict[str, Any]) -> None:
    p = sprints / f"{sprint_id}.status.json"
    defaults = {"id": sprint_id, "sprint_id": sprint_id, "status": "active", "phase": "implementation"}
    defaults.update(data)
    p.write_text(json.dumps(defaults, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_raw_intent(sprints: Path, sprint_id: str, raw: dict[str, Any]) -> None:
    p = sprints / f"{sprint_id}.raw_intent.json"
    p.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")


def _antigravity_raw() -> dict[str, Any]:
    return {
        "schema_version": "solar.raw_intent.v1",
        "intent_id": "intent-test-ag-route-001",
        "source": {
            "channel": "antigravity_app",
            "actor": "antigravity-user",
            "conversation_id": "conv-route-001",
            "project_id": "proj-route-001",
        },
        "raw": {"text": "test", "received_at": "2026-06-05T10:00:00Z"},
    }


class TestEpicSourceLineage:
    def _ag_lineage(self, sid: str) -> dict[str, Any]:
        return {
            "source": "antigravity-app",
            "source_channel": "antigravity_app",
            "is_antigravity_desktop": True,
            "conversation_id": "conv-route-001",
            "project_id": "proj-route-001",
            "artifact_refs": [],
            "exported_at": "2026-06-05T10:00:00Z",
            "bridge_link": f"/orchestration/antigravity-bridge?intent=intent-{sid}",
            "evidence": {"raw_intent_id": f"intent-{sid}"},
        }

    def _patch_lineage_view(self, mod, lineage_map: dict[str, dict]):
        """Patch _load_lineage_view to return a mock with lineage_for_sprint."""
        mock_lv = patch.object(mod, "_load_lineage_view")
        return mock_lv

    def test_epic_returns_source_summary(self, flask_app) -> None:
        app, sprints, _ = flask_app
        sid = "sprint-ag-route-1"
        _write_sprint_status(sprints, sid, {"epic_id": "epic-test-1"})

        mod = _get_orchestration_routes()
        children = [{"sprint_id": sid, "status": "active", "blocked_by": []}]

        with app.test_client() as client:
            with patch.object(mod, "_load_child_sprints", return_value=children):
                with patch.object(mod, "_load_lineage_view") as mock_lv:
                    mock_lv.return_value.lineage_for_sprint = lambda s: self._ag_lineage(s)
                    resp = client.get("/orchestration/epics/epic-test-1")

        assert resp.status_code == 200
        data = resp.get_json()
        d = data.get("data", {})
        assert "source_summary" in d
        assert "per_child_source_lineage" in d
        lineage = d["per_child_source_lineage"].get(sid, {})
        assert lineage.get("is_antigravity_desktop") is True
        assert lineage.get("source") == "antigravity-app"

    def test_epic_no_existing_fields_removed(self, flask_app) -> None:
        """No existing endpoint payload field is removed or renamed."""
        app, sprints, _ = flask_app
        sid = "sprint-ag-field-check"
        _write_sprint_status(sprints, sid, {"epic_id": "epic-field-check"})

        mod = _get_orchestration_routes()
        children = [{"sprint_id": sid, "status": "active", "blocked_by": []}]

        with app.test_client() as client:
            with patch.object(mod, "_load_child_sprints", return_value=children):
                with patch.object(mod, "_load_lineage_view") as mock_lv:
                    mock_lv.return_value.lineage_for_sprint = lambda s: self._ag_lineage(s)
                    resp = client.get("/orchestration/epics/epic-field-check")

        assert resp.status_code == 200
        d = resp.get_json()["data"]
        required_fields = [
            "epic_id", "child_sprints", "gate_summary", "gate_status_summary",
            "blocked_by", "capability_evidence", "source_summary", "per_child_source_lineage",
        ]
        for field in required_fields:
            assert field in d, f"Missing field: {field}"


class TestSprintSourceLineage:
    def _ag_lineage(self) -> dict[str, Any]:
        return {
            "source": "antigravity-app",
            "source_channel": "antigravity_app",
            "is_antigravity_desktop": True,
            "conversation_id": "conv-route-001",
            "project_id": "proj-route-001",
            "artifact_refs": [],
            "exported_at": "2026-06-05T10:00:00Z",
            "bridge_link": "/orchestration/antigravity-bridge?intent=intent-test-ag-route-001",
            "evidence": {"raw_intent_id": "intent-test-ag-route-001"},
        }

    def test_sprint_returns_source_lineage(self, flask_app) -> None:
        app, sprints, _ = flask_app
        sid = "sprint-ag-route-2"
        _write_sprint_status(sprints, sid, {})

        mod = _get_orchestration_routes()

        with app.test_client() as client:
            with patch.object(mod, "_load_autopilot_routing", return_value=[]):
                with patch.object(mod, "_read_actor_profiles", return_value={}):
                    with patch.object(mod, "_read_actor_hosts", return_value={}):
                        with patch.object(mod, "_read_task_graph_state", return_value={}):
                            with patch.object(mod, "_read_runtime_refs", return_value={"sidecar_refs": [], "verifier_refs": [], "evidence_refs": []}):
                                with patch.object(mod, "_load_lineage_view") as mock_lv:
                                    mock_lv.return_value.lineage_for_sprint = lambda s: self._ag_lineage()
                                    resp = client.get(f"/orchestration/sprints/{sid}")

        assert resp.status_code == 200
        data = resp.get_json()
        d = data.get("data", {})
        assert "source_lineage" in d
        lineage = d["source_lineage"]
        assert lineage.get("is_antigravity_desktop") is True
        assert lineage.get("source") == "antigravity-app"
        assert lineage.get("conversation_id") == "conv-route-001"

    def test_sprint_no_existing_fields_removed(self, flask_app) -> None:
        """No existing sprint endpoint fields removed."""
        app, sprints, _ = flask_app
        sid = "sprint-field-check"
        _write_sprint_status(sprints, sid, {})

        mod = _get_orchestration_routes()

        with app.test_client() as client:
            with patch.object(mod, "_load_autopilot_routing", return_value=[]):
                with patch.object(mod, "_read_actor_profiles", return_value={}):
                    with patch.object(mod, "_read_actor_hosts", return_value={}):
                        with patch.object(mod, "_read_task_graph_state", return_value={}):
                            with patch.object(mod, "_read_runtime_refs", return_value={"sidecar_refs": [], "verifier_refs": [], "evidence_refs": []}):
                                resp = client.get(f"/orchestration/sprints/{sid}")

        assert resp.status_code == 200
        d = resp.get_json()["data"]
        required_fields = [
            "sprint_id", "status", "phase", "node_capability_hits",
            "required_capabilities", "missing_capabilities", "ready_nodes",
            "blocked_by", "sidecar_refs", "verifier_refs", "evidence_refs",
            "routing_decisions", "blocked_reasons", "source_lineage",
            "execution_supply_chain",
        ]
        for field in required_fields:
            assert field in d, f"Missing field: {field}"


class TestAntigravitySprints:
    def _ag_lineage(self, sid: str) -> dict[str, Any]:
        return {
            "source": "antigravity-app",
            "source_channel": "antigravity_app",
            "is_antigravity_desktop": True,
            "conversation_id": "conv-route-001",
            "project_id": "proj-route-001",
            "artifact_refs": [],
            "exported_at": "2026-06-05T10:00:00Z",
            "bridge_link": f"/orchestration/antigravity-bridge?intent=intent-{sid}",
            "evidence": {"raw_intent_id": f"intent-{sid}"},
        }

    def test_filters_antigravity_sprints(self, flask_app) -> None:
        app, sprints, _ = flask_app
        sid = "sprint-ag-route-3"
        _write_sprint_status(sprints, sid, {})

        mod = _get_orchestration_routes()

        with app.test_client() as client:
            with patch.object(mod, "_load_lineage_view") as mock_lv:
                mock_lv.return_value.lineage_for_sprint = lambda s: self._ag_lineage(s)
                with patch.object(mod, "_load_external_integrations_health") as mock_health:
                    mock_health.return_value.antigravity_bridge_health.return_value = {"bridge_state": "active"}
                    resp = client.get("/orchestration/antigravity/sprints")

        assert resp.status_code == 200
        data = resp.get_json()
        d = data.get("data", {})
        assert "sprints" in d
        assert "total" in d
        assert "bridge_health" in d

    def test_status_filter_active(self, flask_app) -> None:
        app, sprints, _ = flask_app
        sid_active = "sprint-ag-active"
        sid_passed = "sprint-ag-passed"
        _write_sprint_status(sprints, sid_active, {"status": "active"})
        _write_sprint_status(sprints, sid_passed, {"status": "passed"})

        mod = _get_orchestration_routes()

        with app.test_client() as client:
            with patch.object(mod, "_load_lineage_view") as mock_lv:
                mock_lv.return_value.lineage_for_sprint = lambda s: self._ag_lineage(s)
                with patch.object(mod, "_load_external_integrations_health") as mock_health:
                    mock_health.return_value.antigravity_bridge_health.return_value = {"bridge_state": "active"}
                    resp = client.get("/orchestration/antigravity/sprints?status=active")

        assert resp.status_code == 200
        data = resp.get_json()["data"]
        sprint_ids = [s["sprint_id"] for s in data["sprints"]]
        assert sid_active in sprint_ids
        assert sid_passed not in sprint_ids

    def test_status_filter_all(self, flask_app) -> None:
        app, sprints, _ = flask_app
        sid = "sprint-ag-all"
        _write_sprint_status(sprints, sid, {"status": "passed"})

        mod = _get_orchestration_routes()

        with app.test_client() as client:
            with patch.object(mod, "_load_lineage_view") as mock_lv:
                mock_lv.return_value.lineage_for_sprint = lambda s: self._ag_lineage(s)
                with patch.object(mod, "_load_external_integrations_health") as mock_health:
                    mock_health.return_value.antigravity_bridge_health.return_value = {"bridge_state": "active"}
                    resp = client.get("/orchestration/antigravity/sprints?status=all")

        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data["total"] >= 1


class TestAntigravityBridge:
    def test_bridge_returns_recent_captures_and_dispatches(self, flask_app) -> None:
        app, sprints, state = flask_app

        # Set up autopilot state with antigravity dispatch history
        ap_state = {
            "activation_history": [
                {
                    "sprint_id": "sprint-ag-bridge-1",
                    "source_lineage": {
                        "source": "antigravity-app",
                        "is_antigravity_desktop": True,
                    },
                },
            ],
        }
        (state / "autopilot-state.json").write_text(json.dumps(ap_state), encoding="utf-8")

        mod = _get_orchestration_routes()

        with app.test_client() as client:
            with patch.object(mod, "_load_external_integrations_health") as mock_health:
                mock_health.return_value.antigravity_bridge_health.return_value = {
                    "bridge_state": "active",
                    "inbox_count": 0,
                    "processed_count": 0,
                    "failed_count": 0,
                    "last_capture_timestamp": None,
                    "degraded_reason": "",
                    "lineage": {},
                }
                resp = client.get("/orchestration/antigravity-bridge?format=json")

        assert resp.status_code == 200
        data = resp.get_json()
        d = data.get("data", {})
        bridge = d.get("bridge", {})
        assert "recent_captures" in bridge
        assert "recent_dispatches" in bridge
        assert isinstance(bridge["recent_captures"], list)
        assert isinstance(bridge["recent_dispatches"], list)
        # Verify dispatch contains antigravity source lineage
        dispatches = bridge["recent_dispatches"]
        assert len(dispatches) >= 1
        assert dispatches[0]["source_lineage"]["source"] == "antigravity-app"

    def test_bridge_recent_captures_with_raw_intent_id(self, flask_app) -> None:
        app, sprints, state = flask_app

        # Set up autopilot state (empty)
        (state / "autopilot-state.json").write_text("{}", encoding="utf-8")

        mod = _get_orchestration_routes()

        with app.test_client() as client:
            with patch.object(mod, "_load_external_integrations_health") as mock_health:
                mock_health.return_value.antigravity_bridge_health.return_value = {
                    "bridge_state": "active",
                    "inbox_count": 0,
                    "processed_count": 0,
                    "failed_count": 0,
                    "last_capture_timestamp": None,
                    "degraded_reason": "",
                    "lineage": {},
                }
                resp = client.get("/orchestration/antigravity-bridge?format=json")

        assert resp.status_code == 200
        data = resp.get_json()["data"]["bridge"]
        assert "recent_captures" in data
        assert isinstance(data["recent_captures"], list)

    def test_bridge_html_render(self, flask_app) -> None:
        app, sprints, state = flask_app

        mod = _get_orchestration_routes()

        with app.test_client() as client:
            with patch.object(mod, "_load_external_integrations_health") as mock_health:
                mock_health.return_value.antigravity_bridge_health.return_value = {
                    "bridge_state": "active",
                    "inbox_count": 1,
                    "processed_count": 2,
                    "failed_count": 0,
                    "last_capture_timestamp": "2026-06-05T10:00:00Z",
                    "degraded_reason": "",
                    "lineage": {
                        "source": "antigravity-app",
                        "source_channel": "antigravity_app",
                        "ingress_kind": "desktop_app_requirement_source",
                        "not_physical_operator": True,
                        "distinct_from": ["agy_cli_physical_operator"],
                    },
                }
                resp = client.get("/orchestration/antigravity-bridge")

        assert resp.status_code == 200
        assert "text/html" in resp.content_type
        html = resp.data.decode("utf-8")
        assert "Antigravity Desktop App Ingress Bridge" in html
        assert "ACTIVE" in html


class TestDegradedFallback:
    def test_lineage_failure_does_not_crash(self, flask_app) -> None:
        app, sprints, _ = flask_app
        sid = "sprint-degrade-1"
        _write_sprint_status(sprints, sid, {})

        mod = _get_orchestration_routes()

        with app.test_client() as client:
            with patch.object(mod, "_load_autopilot_routing", return_value=[]):
                with patch.object(mod, "_read_actor_profiles", return_value={}):
                    with patch.object(mod, "_read_actor_hosts", return_value={}):
                        with patch.object(mod, "_read_task_graph_state", return_value={}):
                            with patch.object(mod, "_read_runtime_refs", return_value={"sidecar_refs": [], "verifier_refs": [], "evidence_refs": []}):
                                resp = client.get(f"/orchestration/sprints/{sid}")

        assert resp.status_code == 200
        data = resp.get_json()
        d = data.get("data", {})
        assert "source_lineage" in d
        assert d["source_lineage"]["source"] == "unknown"

    def test_lineage_view_import_error_degraded(self, flask_app) -> None:
        """If lineage view module cannot be loaded, sprint route still returns 200."""
        app, sprints, _ = flask_app
        sid = "sprint-lv-error"
        _write_sprint_status(sprints, sid, {})

        mod = _get_orchestration_routes()

        with app.test_client() as client:
            with patch.object(mod, "_load_autopilot_routing", return_value=[]):
                with patch.object(mod, "_read_actor_profiles", return_value={}):
                    with patch.object(mod, "_read_actor_hosts", return_value={}):
                        with patch.object(mod, "_read_task_graph_state", return_value={}):
                            with patch.object(mod, "_read_runtime_refs", return_value={"sidecar_refs": [], "verifier_refs": [], "evidence_refs": []}):
                                with patch.object(mod, "_load_lineage_view", side_effect=ModuleNotFoundError("no module")):
                                    resp = client.get(f"/orchestration/sprints/{sid}")

        assert resp.status_code == 200
        data = resp.get_json()
        assert "source_lineage" in data.get("data", {})
        assert data["data"]["source_lineage"]["source"] == "unknown"

    def test_epic_lineage_failure_degraded(self, flask_app) -> None:
        """If lineage view fails on epic route, still returns 200 with degraded."""
        app, sprints, _ = flask_app
        sid = "sprint-epic-degrade"
        _write_sprint_status(sprints, sid, {"epic_id": "epic-degrade-1"})

        mod = _get_orchestration_routes()
        children = [{"sprint_id": sid, "status": "active", "blocked_by": []}]

        with app.test_client() as client:
            with patch.object(mod, "_load_child_sprints", return_value=children):
                with patch.object(mod, "_load_lineage_view", side_effect=RuntimeError("broken")):
                    resp = client.get("/orchestration/epics/epic-degrade-1")

        assert resp.status_code == 200
        data = resp.get_json()
        assert "lineage_view_error" in str(data.get("degraded_sources", []))
