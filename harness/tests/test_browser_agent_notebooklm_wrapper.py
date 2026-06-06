from __future__ import annotations

import json
import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "harness" / "scripts" / "browser_agent_notebooklm_wrapper.py"


def _load_namespace() -> dict:
    browser_use = types.ModuleType("browser_use")
    browser_use_browser = types.ModuleType("browser_use.browser")
    browser_use_browser_profile = types.ModuleType("browser_use.browser.profile")
    browser_use_browser_session = types.ModuleType("browser_use.browser.session")
    playwright = types.ModuleType("playwright")
    playwright_async_api = types.ModuleType("playwright.async_api")

    class _DummyProfile:
        pass

    class _DummySession:
        pass

    class _DummyPlaywrightContext:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

    def _dummy_async_playwright():
        return _DummyPlaywrightContext()

    browser_use_browser_profile.BrowserProfile = _DummyProfile
    browser_use_browser_session.BrowserSession = _DummySession
    playwright_async_api.async_playwright = _dummy_async_playwright

    prev_modules = {
        name: sys.modules.get(name)
        for name in (
            "browser_use",
            "browser_use.browser",
            "browser_use.browser.profile",
            "browser_use.browser.session",
            "playwright",
            "playwright.async_api",
        )
    }
    sys.modules["browser_use"] = browser_use
    sys.modules["browser_use.browser"] = browser_use_browser
    sys.modules["browser_use.browser.profile"] = browser_use_browser_profile
    sys.modules["browser_use.browser.session"] = browser_use_browser_session
    sys.modules["playwright"] = playwright
    sys.modules["playwright.async_api"] = playwright_async_api
    try:
        ns: dict = {"__file__": str(SCRIPT), "__name__": "browser_agent_notebooklm_wrapper_test"}
        code = compile(SCRIPT.read_text(encoding="utf-8"), str(SCRIPT), "exec")
        exec(code, ns)
        return ns
    finally:
        for name, module in prev_modules.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module


def test_record_request_executor_failure_marks_pending_request(tmp_path):
    ns = _load_namespace()
    request_dir = tmp_path / "request"
    request_dir.mkdir()
    (request_dir / "request.json").write_text(
        json.dumps({"status": "pending_executor", "created_at": "2026-06-06T00:00:00Z"}, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    payload = ns["_record_request_executor_failure"](
        request_dir,
        error_type="RuntimeError",
        error_text="boom",
    )
    assert payload["status"] == "failed_executor"
    assert payload["wrapper_error_type"] == "RuntimeError"
    assert payload["closeout_reason"] == "wrapper_exception"


def test_record_request_executor_failure_does_not_override_completed_request(tmp_path):
    ns = _load_namespace()
    request_dir = tmp_path / "request"
    request_dir.mkdir()
    (request_dir / "request.json").write_text(
        json.dumps({"status": "completed", "created_at": "2026-06-06T00:00:00Z"}, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    payload = ns["_record_request_executor_failure"](
        request_dir,
        error_type="RuntimeError",
        error_text="boom",
    )
    assert payload["status"] == "completed"
    stored = json.loads((request_dir / "request.json").read_text(encoding="utf-8"))
    assert stored["status"] == "completed"
