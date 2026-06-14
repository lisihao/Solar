from __future__ import annotations

import importlib.util
import json
import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATUS_SERVER = ROOT / "lib" / "symphony" / "status-server.py"


def _load_status_server():
    spec = importlib.util.spec_from_file_location("solar_status_server_orchestration_bridge", STATUS_SERVER)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["solar_status_server_orchestration_bridge"] = mod
    spec.loader.exec_module(mod)
    return mod


def _request(handler, path: str) -> tuple[int, str, str]:
    response: dict[str, object] = {}
    instance = handler.__new__(handler)
    instance.path = path

    def send_json(self, data, status=200):
        response["status"] = status
        response["content_type"] = "application/json"
        response["body"] = json.dumps(data, default=str)

    def send_text(self, text, status=200, content_type="text/plain; charset=utf-8"):
        response["status"] = status
        response["content_type"] = content_type
        response["body"] = text

    instance._send_json = types.MethodType(send_json, instance)
    instance._send_text = types.MethodType(send_text, instance)
    handler.do_GET(instance)
    return int(response["status"]), str(response["content_type"]), str(response["body"])


def test_orchestration_page_is_served_by_status_server_handler() -> None:
    mod = _load_status_server()
    mod.HARNESS_DIR = ROOT

    status, content_type, body = _request(mod.StatusHandler, "/orchestration")

    assert status == 200
    assert content_type.startswith("text/html")
    assert "orchestration" in body.lower()


def test_orchestration_dashboard_is_served_by_status_server_handler(tmp_path: Path) -> None:
    mod = _load_status_server()
    harness = tmp_path / "harness"
    sprints = harness / "sprints"
    sprints.mkdir(parents=True)
    (harness / "status-server" / "routes").mkdir(parents=True)
    (harness / "status-server" / "templates").mkdir(parents=True)
    (harness / "status-server" / "static").mkdir(parents=True)

    # Use the real route implementation while isolating runtime data.
    route_src = ROOT / "status-server" / "routes" / "orchestration_routes.py"
    route_dst = harness / "status-server" / "routes" / "orchestration_routes.py"
    route_dst.write_text(route_src.read_text(encoding="utf-8"), encoding="utf-8")
    (harness / "status-server" / "templates" / "orchestration_panel.html").write_text(
        "<!doctype html><title>orchestration</title>",
        encoding="utf-8",
    )
    (sprints / "sprint-bridge.status.json").write_text(
        json.dumps({"sprint_id": "sprint-bridge", "status": "active"}),
        encoding="utf-8",
    )

    mod.HARNESS_DIR = harness
    mod.SPRINTS_DIR = sprints
    mod.STATE_DIR = harness / "state"
    mod.EVENTS_DIR = harness / "events"
    mod.ALL_EVENTS = harness / "events" / "all.jsonl"

    status, content_type, body = _request(
        mod.StatusHandler,
        "/orchestration/dashboard?sprint_id=sprint-bridge",
    )

    payload = json.loads(body)
    assert status == 200
    assert content_type.startswith("application/json")
    assert payload["schema_version"] == "orchestration.http.bridge.v1"
    assert payload["data"]["focus_sprint_id"] == "sprint-bridge"
