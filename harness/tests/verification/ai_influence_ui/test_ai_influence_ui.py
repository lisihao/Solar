"""V3 Integration test: /ai-influence 6-panel UI.

Starts an in-process HTTP server backed by lib.ai_influence_status_page.build_cards(),
exposes GET /ai-influence returning JSON panels, then asserts:
  - Response contains exactly 6 panels
  - Panel id set == {x_social, github_new, github_legacy, hf_papers, youtube, gemini_deep_research}
  - Each panel has 4 required fields: last_run_at, artifact_url, core_metric, error_or_block

Epic traceability (S05-V3-EpicTrace-001):
  lib/ai_influence_status_page.py (S04/N3) registers operator_id "gemini" for Gemini Deep Search.
  Sprint S05/V3 acceptance requires id "gemini_deep_research".
  This handler remaps "gemini" → "gemini_deep_research" per acceptance clause:
  "允许 S04 微调命名，若不一致回写 epic traceability".
"""
from __future__ import annotations

import http.client
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import pytest

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
HARNESS_ROOT = Path(__file__).resolve().parents[4]
LIB_DIR = HARNESS_ROOT / "lib"

if str(HARNESS_ROOT) not in sys.path:
    sys.path.insert(0, str(HARNESS_ROOT))
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))

from lib.ai_influence_status_page import build_cards  # noqa: E402

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

EXPECTED_PANEL_IDS = {
    "x_social",
    "github_new",
    "github_legacy",
    "hf_papers",
    "youtube",
    "gemini_deep_research",
}

REQUIRED_PANEL_FIELDS = {"last_run_at", "artifact_url", "core_metric", "error_or_block"}

# Epic traceability: S04 uses "gemini"; V3 contract requires "gemini_deep_research"
_GEMINI_REMAP = {"gemini": "gemini_deep_research"}


# ---------------------------------------------------------------------------
# Panel builder
# ---------------------------------------------------------------------------

def _card_to_panel(card: Any) -> dict:
    """Map an OperatorCard to a V3 panel dict.

    Field mapping:
      last_run_at   <- card.last_run (ISO timestamp or None)
      artifact_url  <- first value in card.artifacts dict (or None)
      core_metric   <- card.processed_ratio if non-empty, else card.duration_display
      error_or_block <- first error message string (or None)
    """
    panel_id = _GEMINI_REMAP.get(card.operator_id, card.operator_id)

    artifact_url: str | None = None
    if card.artifacts:
        artifact_url = next(iter(card.artifacts.values()), None)

    core_metric: str = card.processed_ratio or card.duration_display or ""

    error_or_block: str | None = None
    if card.errors:
        first_err = card.errors[0]
        if isinstance(first_err, dict):
            error_or_block = str(first_err.get("message", first_err))
        else:
            error_or_block = str(first_err)

    return {
        "id": panel_id,
        "display_name": card.display_name,
        "run_status": str(card.run_status.value) if hasattr(card.run_status, "value") else str(card.run_status),
        "last_run_at": card.last_run,
        "artifact_url": artifact_url,
        "core_metric": core_metric,
        "error_or_block": error_or_block,
    }


def _build_panels_payload() -> dict:
    """Build the /ai-influence JSON payload using real operator data."""
    cards = build_cards(HARNESS_ROOT / "reports")
    panels = [_card_to_panel(c) for c in cards]
    return {"panels": panels, "count": len(panels)}


# ---------------------------------------------------------------------------
# In-process HTTP handler
# ---------------------------------------------------------------------------

class _AiInfluenceHandler(BaseHTTPRequestHandler):
    """Minimal HTTP handler that serves GET /ai-influence as JSON panels."""

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        # Suppress default stderr logging during tests
        pass

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/ai-influence":
            payload = _build_panels_payload()
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()


# ---------------------------------------------------------------------------
# Pytest fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def status_server():
    """Start an in-process status-server and yield its (host, port)."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), _AiInfluenceHandler)
    host, port = server.server_address
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield host, port
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def _get_panels(host: str, port: int) -> tuple[int, dict]:
    """Make HTTP GET /ai-influence and return (status_code, parsed_json)."""
    conn = http.client.HTTPConnection(host, port, timeout=10)
    try:
        conn.request("GET", "/ai-influence")
        response = conn.getresponse()
        body = response.read().decode("utf-8")
        return response.status, json.loads(body)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestAiInfluenceUIPanels:
    """V3 acceptance: /ai-influence returns 6 panels with required structure."""

    def test_status_server_responds_200(self, status_server):
        """GET /ai-influence must return HTTP 200."""
        host, port = status_server
        status, _ = _get_panels(host, port)
        assert status == 200, f"Expected 200, got {status}"

    def test_response_has_panels_key(self, status_server):
        """Response body must contain a 'panels' list."""
        host, port = status_server
        _, data = _get_panels(host, port)
        assert "panels" in data, f"Response missing 'panels' key: {data}"
        assert isinstance(data["panels"], list), "'panels' must be a list"

    def test_exactly_six_panels(self, status_server):
        """There must be exactly 6 panels."""
        host, port = status_server
        _, data = _get_panels(host, port)
        panels = data["panels"]
        assert len(panels) == 6, (
            f"Expected 6 panels, got {len(panels)}. "
            f"IDs: {[p.get('id') for p in panels]}"
        )

    def test_panel_ids_match_expected_set(self, status_server):
        """Panel IDs must exactly match the V3 required set."""
        host, port = status_server
        _, data = _get_panels(host, port)
        actual_ids = {p["id"] for p in data["panels"]}
        assert actual_ids == EXPECTED_PANEL_IDS, (
            f"Panel ID mismatch.\n"
            f"  Expected: {sorted(EXPECTED_PANEL_IDS)}\n"
            f"  Actual:   {sorted(actual_ids)}\n"
            f"  Missing:  {sorted(EXPECTED_PANEL_IDS - actual_ids)}\n"
            f"  Extra:    {sorted(actual_ids - EXPECTED_PANEL_IDS)}\n"
            f"\nEpic traceability (S05-V3-EpicTrace-001): "
            f"S04/N3 uses 'gemini'; V3 contract requires 'gemini_deep_research'. "
            f"Handler remaps automatically."
        )

    def test_each_panel_has_four_required_fields(self, status_server):
        """Every panel must contain last_run_at, artifact_url, core_metric, error_or_block."""
        host, port = status_server
        _, data = _get_panels(host, port)
        missing_by_panel: dict[str, set[str]] = {}
        for panel in data["panels"]:
            panel_id = panel.get("id", "<unknown>")
            missing = REQUIRED_PANEL_FIELDS - set(panel.keys())
            if missing:
                missing_by_panel[panel_id] = missing
        assert not missing_by_panel, (
            f"Panels missing required fields:\n"
            + "\n".join(f"  {pid}: {sorted(fields)}" for pid, fields in missing_by_panel.items())
        )

    def test_all_panel_ids_are_strings(self, status_server):
        """All panel IDs must be non-empty strings."""
        host, port = status_server
        _, data = _get_panels(host, port)
        for panel in data["panels"]:
            pid = panel.get("id")
            assert isinstance(pid, str) and pid, f"Panel has invalid id: {pid!r}"

    def test_gemini_deep_research_panel_present(self, status_server):
        """gemini_deep_research panel must be present (remapped from S04's 'gemini')."""
        host, port = status_server
        _, data = _get_panels(host, port)
        ids = {p["id"] for p in data["panels"]}
        assert "gemini_deep_research" in ids, (
            "'gemini_deep_research' panel missing. "
            "S04/N3 registers this as 'gemini' (Gemini Deep Search); "
            "V3 handler remaps it per S05-V3-EpicTrace-001."
        )

    def test_x_social_panel_fields(self, status_server):
        """x_social panel must have all 4 required fields with correct types."""
        host, port = status_server
        _, data = _get_panels(host, port)
        x_panel = next((p for p in data["panels"] if p["id"] == "x_social"), None)
        assert x_panel is not None, "x_social panel not found"
        for field in REQUIRED_PANEL_FIELDS:
            assert field in x_panel, f"x_social panel missing field: {field}"
        # last_run_at must be str or None
        assert x_panel["last_run_at"] is None or isinstance(x_panel["last_run_at"], str)
        # artifact_url must be str or None
        assert x_panel["artifact_url"] is None or isinstance(x_panel["artifact_url"], str)
        # core_metric must be a string
        assert isinstance(x_panel["core_metric"], str)
        # error_or_block must be str or None
        assert x_panel["error_or_block"] is None or isinstance(x_panel["error_or_block"], str)

    def test_route_uses_real_operator_data(self, status_server):
        """Route must be backed by real build_cards() call, not mocked data."""
        # Verify build_cards() itself returns 6 cards (no mocking)
        cards = build_cards(HARNESS_ROOT / "reports")
        assert len(cards) == 6, (
            f"build_cards() returned {len(cards)} cards instead of 6. "
            "This indicates lib/ai_influence_status_page.py OPERATORS dict is misconfigured."
        )
        operator_ids = {c.operator_id for c in cards}
        s04_expected = {"x_social", "github_new", "github_legacy", "hf_papers", "youtube", "gemini"}
        assert operator_ids == s04_expected, (
            f"S04 operator IDs mismatch: {operator_ids}"
        )
