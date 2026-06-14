from __future__ import annotations

import copy
import http.client
import importlib.util
import json
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[3]
LIB_DIR = ROOT / "lib"
STATUS_SERVER = LIB_DIR / "symphony" / "status-server.py"

sys.path.insert(0, str(LIB_DIR))

from operator_registry_loader import (  # noqa: E402
    ERR_PRIMARY_MISSING,
    ERR_PRIMARY_WRAPPER_FORBIDDEN,
    RegistryValidationError,
    load_registry,
)


def _write_registry(tmp_path: Path, payload: dict) -> Path:
    registry_path = tmp_path / "config" / "operator_registry.json"
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return registry_path


def _registry_with_primary(primary: str) -> dict:
    return {
        "schema_version": "solar.operator_registry.v1",
        "lines": {
            "x_social": {
                "primary": primary,
                "executors": ["tools/playwright_twitter_scraper.py"],
                "fallback": ["scripts/ai_influence_daily.py"],
                "schedule": "daily",
                "output_dir": "reports/x-social/",
            }
        },
    }


def _load_status_server_module():
    spec = importlib.util.spec_from_file_location("solar_status_server_v6_negative", STATUS_SERVER)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _get_json(handler, path: str) -> tuple[int, dict]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
    try:
        conn.request("GET", path)
        response = conn.getresponse()
        body = response.read().decode("utf-8")
        return response.status, json.loads(body)
    finally:
        conn.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_6_1_empty_x_primary_is_rejected_with_explicit_error(tmp_path: Path) -> None:
    registry_path = _write_registry(tmp_path, _registry_with_primary(""))

    with pytest.raises(RegistryValidationError, match=ERR_PRIMARY_MISSING) as raised:
        load_registry(registry_path=registry_path, harness_root=tmp_path, use_cache=False)

    assert "x_social" in str(raised.value)
    assert ERR_PRIMARY_MISSING in str(raised.value)


def test_6_2_browser_agent_wrapper_cannot_be_forced_as_primary(tmp_path: Path) -> None:
    registry_path = _write_registry(
        tmp_path,
        _registry_with_primary("scripts/browser_agent_chatgpt_wrapper.py"),
    )

    with pytest.raises(RegistryValidationError, match=ERR_PRIMARY_WRAPPER_FORBIDDEN) as raised:
        load_registry(registry_path=registry_path, harness_root=tmp_path, use_cache=False)

    message = str(raised.value)
    assert ERR_PRIMARY_WRAPPER_FORBIDDEN in message
    assert "browser_agent_chatgpt_wrapper.py" in message


def test_6_3_ai_influence_route_returns_4xx_when_required_panel_is_missing() -> None:
    mod = _load_status_server_module()
    valid_panels = copy.deepcopy(mod.AI_INFLUENCE_PANEL_CONFIG)
    mod.AI_INFLUENCE_PANEL_CONFIG = [
        panel for panel in valid_panels if panel.get("id") != "resources"
    ]

    status, payload = _get_json(mod.StatusHandler, "/ai-influence")

    assert status == 422
    assert payload["ok"] is False
    assert payload["error_code"] == mod.AI_INFLUENCE_PANEL_CONFIG_ERROR
    assert any("missing_panel:resources" in error for error in payload["errors"])
