#!/usr/bin/env python3
from __future__ import annotations

import json
import importlib.util
import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import chatgpt_browser_agent_task_operator as cto  # noqa: E402


def _load_wrapper_module():
    if "browser_use.browser.profile" not in sys.modules:
        browser_use = types.ModuleType("browser_use")
        browser_mod = types.ModuleType("browser_use.browser")
        profile_mod = types.ModuleType("browser_use.browser.profile")
        session_mod = types.ModuleType("browser_use.browser.session")

        class BrowserProfile:  # pragma: no cover - import stub only
            pass

        class BrowserSession:  # pragma: no cover - import stub only
            pass

        profile_mod.BrowserProfile = BrowserProfile
        session_mod.BrowserSession = BrowserSession
        sys.modules.setdefault("browser_use", browser_use)
        sys.modules.setdefault("browser_use.browser", browser_mod)
        sys.modules.setdefault("browser_use.browser.profile", profile_mod)
        sys.modules.setdefault("browser_use.browser.session", session_mod)
    path = ROOT / "scripts" / "browser_agent_chatgpt_wrapper.py"
    spec = importlib.util.spec_from_file_location("browser_agent_chatgpt_wrapper_test", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_build_request_reads_prompt_file(tmp_path):
    prompt_file = tmp_path / "prompt.txt"
    prompt_file.write_text("hello chatgpt", encoding="utf-8")
    payload = cto.build_request({"prompt_file": str(prompt_file)}, task_dir=tmp_path)
    assert payload["prompt"] == "hello chatgpt"
    assert "project_name" not in payload
    assert payload["expected_output"] == "markdown"
    assert payload["model"] == "chatgpt-5.5"
    assert payload["reasoning_effort"] == "high"
    assert payload["model_mode"] == "thinking"
    assert payload["tool_mode"] == "none"
    assert payload["require_ui_mode"] is True


def test_deep_insight_solar_policy_defaults_to_dedicated_profile(monkeypatch):
    monkeypatch.delenv("DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY", raising=False)

    assert (
        cto._pick_policy_key({"purpose": "deep-insight-solar-auth-preflight"})
        == "deep_insight_solar"
    )


def test_deep_insight_solar_policy_can_be_explicitly_overridden(monkeypatch):
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY", "deep_insight_solar_canary")

    assert cto._pick_policy_key({"purpose": "deep-insight-solar-writer"}) == "deep_insight_solar_canary"


def test_wrapper_rejects_truncated_large_prompt_submission():
    wrapper = _load_wrapper_module()
    prompt = "You are a Solar-Harness browser-agent logical operator.\n" + ("payload line\n" * 1000)
    post_submit = {
        "messages": [
            {
                "role": "user",
                "text": "You are a Solar-Harness browser-agent logical operator.",
            }
        ]
    }

    assert wrapper._post_submit_has_current_prompt(post_submit, prompt) is False


def test_wrapper_accepts_large_prompt_when_submitted_text_is_substantial():
    wrapper = _load_wrapper_module()
    prompt = "You are a Solar-Harness browser-agent logical operator.\n" + ("payload line\n" * 1000)
    post_submit = {
        "messages": [
            {
                "role": "user",
                "text": prompt[: max(1200, int(len(prompt) * 0.3))],
            }
        ]
    }

    assert wrapper._post_submit_has_current_prompt(post_submit, prompt) is True


def test_run_request_writes_result(monkeypatch, tmp_path, capsys):
    class Result:
        returncode = 0
        stdout = "final answer"
        stderr = ""

    monkeypatch.setattr(cto, "_wrapper_cmd", lambda: ["fake-wrapper"])
    seen_env = {}

    def _fake_run(*args, **kwargs):
        seen_env.update(kwargs.get("env") or {})
        return Result()

    monkeypatch.setattr(cto, "_run_wrapper_with_watchdog", _fake_run)
    result = cto.run_request(
        {"prompt": "hello", "project_name": "1234", "min_output_chars": 1200},
        task_dir=tmp_path,
    )
    assert result["ok"] is True
    assert seen_env["CHATGPT_MODEL"] == "chatgpt-5.5"
    assert seen_env["CHATGPT_REASONING_EFFORT"] == "high"
    assert seen_env["BROWSER_AGENT_CHATGPT_MIN_ANSWER_CHARS"] == "1200"
    assert seen_env["BROWSER_AGENT_CHATGPT_MIN_OUTPUT_CHARS"] == "1200"
    assert seen_env["BROWSER_AGENT_CHATGPT_MODEL_MODE"] == "thinking"
    assert seen_env["BROWSER_AGENT_CHATGPT_REQUIRE_UI_MODE"] == "true"
    assert (tmp_path / "chatgpt-browser-agent-request.json").exists()
    assert (tmp_path / "chatgpt-browser-agent-result.json").exists()
    assert "ChatGPT Browser Agent Result" in capsys.readouterr().out


def test_wrapper_watchdog_recovers_when_final_artifact_is_ready(monkeypatch, tmp_path):
    request_dir = tmp_path / "request"
    request_dir.mkdir()
    final_text = "This is the complete final response from ChatGPT." * 10
    (request_dir / "assistant-response.txt").write_text(final_text, encoding="utf-8")
    (request_dir / "page.json").write_text(
        json.dumps(
            {
                "login_wall": False,
                "challenge_wall": False,
                "is_generating": False,
                "assistant_count": 1,
            }
        ),
        encoding="utf-8",
    )

    class FakeProc:
        returncode = None

        def __init__(self):
            self.terminated = False

        def communicate(self, input=None, timeout=None):
            if not self.terminated:
                raise cto.subprocess.TimeoutExpired(["fake-wrapper"], timeout)
            return "", ""

        def poll(self):
            return None if not self.terminated else 0

        def terminate(self):
            self.terminated = True

        def wait(self, timeout=None):
            self.terminated = True
            return 0

    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_FINALIZE_GRACE_SECONDS", "0")
    monkeypatch.setattr(cto.subprocess, "Popen", lambda *args, **kwargs: FakeProc())

    proc = cto._run_wrapper_with_watchdog(
        ["fake-wrapper"],
        prompt="hello",
        env={},
        timeout=60,
        request_dir=request_dir,
    )

    assert proc.returncode == 0
    assert proc.stdout == final_text
    assert "final_artifact_watchdog" in proc.stderr
    watchdog = json.loads((request_dir / "wrapper-final-artifact-watchdog.json").read_text(encoding="utf-8"))
    assert watchdog["ok"] is True
    assert watchdog["chars"] == len(final_text)


def test_main_applies_success_cooldown(monkeypatch, tmp_path):
    envelope = {"task_id": "T1", "operator_id": "mini-browser-chatgpt", "prompt": "hello"}
    envelope_path = tmp_path / "envelope.json"
    envelope_path.write_text(json.dumps(envelope), encoding="utf-8")
    monkeypatch.setenv("SOLAR_OPERATOR_ENVELOPE_JSON", str(envelope_path))
    monkeypatch.setenv("TASK_DIR", str(tmp_path / "task"))
    monkeypatch.setenv("BROWSER_AGENT_QUEUE_BYPASS", "1")
    monkeypatch.setenv("SOLAR_CHATGPT_SUCCESS_COOLDOWN_SECONDS", "222")
    monkeypatch.setattr(cto.ofc, "ensure_operator_available", lambda operator_id: None)
    monkeypatch.setattr(cto, "run_request", lambda request, task_dir: {"ok": True})
    calls: list[tuple[str, int]] = []
    monkeypatch.setattr(
        cto.ofc,
        "apply_success_cooldown",
        lambda operator_id, *, success_cooldown_seconds: calls.append((operator_id, success_cooldown_seconds)) or {},
    )
    assert cto.main() == 0
    assert calls == [("mini-browser-chatgpt", 222)]


def test_main_applies_failure_flow_control(monkeypatch, tmp_path):
    envelope = {"task_id": "T2", "operator_id": "mini-browser-chatgpt", "prompt": "hello"}
    envelope_path = tmp_path / "envelope.json"
    envelope_path.write_text(json.dumps(envelope), encoding="utf-8")
    monkeypatch.setenv("SOLAR_OPERATOR_ENVELOPE_JSON", str(envelope_path))
    monkeypatch.setenv("TASK_DIR", str(tmp_path / "task"))
    monkeypatch.setenv("BROWSER_AGENT_QUEUE_BYPASS", "1")
    monkeypatch.setattr(cto.ofc, "ensure_operator_available", lambda operator_id: None)

    def _boom(request, task_dir):
        raise RuntimeError("429 rate limit")

    monkeypatch.setattr(cto, "run_request", _boom)
    calls: list[tuple[str, int, int, bool, bool]] = []
    monkeypatch.setattr(
        cto.ofc,
        "apply_failure_flow_control",
        lambda task_dir, *, operator_id, failure_text, rate_limit_cooldown_seconds, auth_cooldown_seconds, defer_on_cooldown, defer_on_auth: calls.append(
            (operator_id, rate_limit_cooldown_seconds, auth_cooldown_seconds, defer_on_cooldown, defer_on_auth)
        ) or {"runtime_state": "cooldown"},
    )
    assert cto.main() == 1
    assert calls == [("mini-browser-chatgpt", 3600, 21600, True, True)]
