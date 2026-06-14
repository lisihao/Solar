import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HEALTH_PATH = ROOT / "lib" / "external-integrations-health.py"


def load_health_module():
    spec = importlib.util.spec_from_file_location("external_integrations_health", HEALTH_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_antigravity_bridge_counts_and_lineage(tmp_path, monkeypatch):
    mod = load_health_module()
    monkeypatch.setattr(mod, "HOME", tmp_path)
    bridge = tmp_path / ".solar" / "antigravity-bridge"
    inbox = bridge / "from-antigravity"
    processed = inbox / ".processed"
    failed = inbox / ".failed"
    processed.mkdir(parents=True)
    failed.mkdir()
    (inbox / "req-001.md").write_text("request", encoding="utf-8")
    (processed / "req-000.md").write_text("processed", encoding="utf-8")
    (failed / "bad.json").write_text("failed", encoding="utf-8")
    (bridge / ".sync_state.json").write_text(json.dumps({"capture": 1780199400.0}), encoding="utf-8")

    health = mod.antigravity_bridge_health()

    assert health["bridge_state"] == "active"
    assert health["inbox_count"] == 1
    assert health["processed_count"] == 1
    assert health["failed_count"] == 1
    assert health["last_capture_timestamp"] == "2026-05-31T03:50:00Z"
    assert health["lineage"]["source"] == "antigravity-app"
    assert health["lineage"]["source_channel"] == "antigravity_app"
    assert health["lineage"]["not_physical_operator"] is True


def test_missing_antigravity_bridge_is_warn_pending(tmp_path, monkeypatch):
    mod = load_health_module()
    monkeypatch.setattr(mod, "HOME", tmp_path)

    item = mod.antigravity_bridge_integration()

    assert item["status"] == "warn"
    assert item["health"]["complete_closed_loop"] == "warn"
    assert item["evidence"]["bridge_state"] == "pending"
    assert item["evidence"]["inbox_count"] == 0
    assert item["evidence"]["processed_count"] == 0
    assert item["evidence"]["failed_count"] == 0


def test_antigravity_status_label_distinguishes_desktop_ingress():
    mod = load_health_module()
    item = mod.antigravity_bridge_integration(
        {
            "bridge_state": "active",
            "inbox_count": 0,
            "processed_count": 4,
            "failed_count": 0,
            "last_capture_timestamp": "2026-05-31T03:50:00Z",
            "lineage": {
                "source": "antigravity-app",
                "source_channel": "antigravity_app",
                "ingress_kind": "desktop_app_requirement_source",
                "not_physical_operator": True,
                "distinct_from": ["agy_cli_physical_operator", "gemini_physical_operator"],
            },
        }
    )

    text = " ".join([item["name"], item["purpose"], item["evidence"]["status_label_hint"]]).lower()
    assert "desktop app ingress" in text
    assert "not agy/gemini operator" in text
    assert item["evidence"]["lineage"]["ingress_kind"] == "desktop_app_requirement_source"


def test_missing_bridge_dir_returns_warn_not_fatal(tmp_path, monkeypatch):
    """Missing bridge directory must report as warn/pending, not crash."""
    mod = load_health_module()
    monkeypatch.setattr(mod, "HOME", tmp_path)

    health = mod.antigravity_bridge_health()
    assert health["bridge_state"] == "pending"
    assert "pending" in health.get("degraded_reason", "").lower()
    assert health["inbox_count"] == 0
    assert health["last_capture_timestamp"] is None

    item = mod.antigravity_bridge_integration(health)
    assert item["status"] in ("warn", "ok")
    assert item["health"]["complete_closed_loop"] == "warn"


def test_probe_includes_antigravity_in_integrations(tmp_path, monkeypatch):
    """probe() output must include the Antigravity integration entry."""
    mod = load_health_module()
    monkeypatch.setattr(mod, "HOME", tmp_path)
    monkeypatch.setattr(mod, "HARNESS", tmp_path / ".solar" / "harness")
    monkeypatch.setattr(mod, "VAULT", tmp_path / "Knowledge")
    monkeypatch.setattr(mod, "SOLAR_DB", tmp_path / ".solar" / "solar.db")
    monkeypatch.setattr(mod, "CACHE_PATH", tmp_path / ".solar" / "harness" / "state" / "probe.json")

    data = mod.probe(deep=False)
    names = [i["name"].lower() for i in data["integrations"]]
    assert any("antigravity" in n for n in names), f"Antigravity integration missing from probe output: {names}"


def test_status_server_route_loads():
    """orchestration_routes module loads without syntax errors and has bridge routes."""
    routes_path = ROOT / "status-server" / "routes" / "orchestration_routes.py"
    spec = importlib.util.spec_from_file_location("orchestration_routes", routes_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    assert hasattr(module, "antigravity_bridge_detail")
    assert hasattr(module, "list_integrations")


def test_status_server_routes_expose_antigravity_health_json():
    """Real Flask routes must load the hyphenated health module and expose bridge lineage."""
    from flask import Flask

    routes_path = ROOT / "status-server" / "routes" / "orchestration_routes.py"
    spec = importlib.util.spec_from_file_location("orchestration_routes_route_smoke", routes_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    app = Flask(__name__)
    app.register_blueprint(module.orchestration_bp)
    client = app.test_client()

    integrations = client.get("/orchestration/integrations").get_json()
    assert integrations["ok"] is True
    assert not any("No module named 'external_integrations_health'" in source for source in integrations["degraded_sources"])
    assert any(
        "antigravity" in item.get("name", "").lower()
        for item in integrations["data"]["antigravity_bridges"]
    )

    bridge = client.get("/orchestration/antigravity-bridge?format=json").get_json()
    assert bridge["ok"] is True
    assert not any("No module named 'external_integrations_health'" in source for source in bridge["degraded_sources"])
    assert bridge["data"]["bridge"]["lineage"]["source"] == "antigravity-app"
    assert bridge["data"]["bridge"]["lineage"]["not_physical_operator"] is True
