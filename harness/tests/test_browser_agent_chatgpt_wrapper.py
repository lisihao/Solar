from __future__ import annotations

import os
import sys
import types
import asyncio
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "harness" / "scripts" / "browser_agent_chatgpt_wrapper.py"


def _load_namespace() -> dict:
    browser_use = types.ModuleType("browser_use")
    browser_use_browser = types.ModuleType("browser_use.browser")
    browser_use_browser_profile = types.ModuleType("browser_use.browser.profile")
    browser_use_browser_session = types.ModuleType("browser_use.browser.session")

    class _DummyProfile:
        pass

    class _DummySession:
        pass

    browser_use_browser_profile.BrowserProfile = _DummyProfile
    browser_use_browser_session.BrowserSession = _DummySession

    prev_modules = {
        name: sys.modules.get(name)
        for name in (
            "browser_use",
            "browser_use.browser",
            "browser_use.browser.profile",
            "browser_use.browser.session",
        )
    }
    sys.modules["browser_use"] = browser_use
    sys.modules["browser_use.browser"] = browser_use_browser
    sys.modules["browser_use.browser.profile"] = browser_use_browser_profile
    sys.modules["browser_use.browser.session"] = browser_use_browser_session
    try:
        ns: dict = {"__file__": str(SCRIPT), "__name__": "browser_agent_chatgpt_wrapper_test"}
        code = compile(SCRIPT.read_text(encoding="utf-8"), str(SCRIPT), "exec")
        exec(code, ns)
        return ns
    finally:
        for name, module in prev_modules.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module


def test_post_submit_confirms_chinese_thinking_banner():
    ns = _load_namespace()
    result = ns["_post_submit_confirms_chatgpt_mode"](
        {
            "latest_assistant_text": "正在思考",
            "is_generating": True,
            "assistant_count": 1,
        },
        model_mode="thinking",
        reasoning_effort="high",
    )
    assert result["ok"] is True
    assert result["model_ok"] is True
    assert result["reasoning_ok"] is True


def test_post_submit_accepts_configured_high_reasoning_when_response_started():
    ns = _load_namespace()
    result = ns["_post_submit_confirms_chatgpt_mode"](
        {
            "latest_assistant_text": '{"accepted": true, "summary": "partial json"}',
            "is_generating": True,
            "assistant_count": 1,
            "_configure_result": {
                "steps": [
                    {
                        "step": "open_model_dropdown",
                        "ok": True,
                        "clicked": {"text": "ChatGPT", "aria": "模型选择器"},
                    },
                    {
                        "step": "select_high_reasoning",
                        "ok": True,
                        "clicked": {"text": "思考时间更长", "aria": ""},
                    },
                ]
            },
        },
        model_mode="thinking",
        reasoning_effort="high",
    )
    assert result["ok"] is True
    assert result["model_selector_confirmed"] is True
    assert result["high_reasoning_confirmed"] is True


def test_post_submit_accepts_json_response_started_on_chatgpt_page():
    ns = _load_namespace()
    result = ns["_post_submit_confirms_chatgpt_mode"](
        {
            "latest_assistant_text": '{"accepted": true, "trend_type": "weak_signal", "summary": "partial json"}',
            "is_generating": True,
            "assistant_count": 1,
            "_configure_result": {
                "steps": [
                    {
                        "step": "open_model_dropdown",
                        "ok": True,
                        "clicked": {"text": "ChatGPT", "aria": "模型选择器"},
                    },
                    {
                        "step": "select_high_reasoning",
                        "ok": False,
                        "clicked": None,
                    },
                ]
            },
        },
        model_mode="thinking",
        reasoning_effort="high",
    )
    assert result["ok"] is True
    assert result["json_response_started"] is True
    assert result["reasoning_ok"] is True


def test_headed_run_requires_explicit_opt_in(monkeypatch):
    ns = _load_namespace()
    monkeypatch.delenv("BROWSER_AGENT_CHATGPT_ALLOW_HEADED", raising=False)
    monkeypatch.delenv("TECH_HOTSPOT_BROWSER_CHATGPT_ALLOW_HEADED", raising=False)
    monkeypatch.delenv("BROWSER_AGENT_ALLOW_HEADED", raising=False)
    assert ns["_headed_run_allowed"]() is False


def test_headed_run_accepts_explicit_opt_in(monkeypatch):
    ns = _load_namespace()
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_ALLOW_HEADED", "true")
    assert ns["_headed_run_allowed"]() is True


def test_chatgpt_wrapper_defaults_to_persistent_profile_strategy(monkeypatch):
    ns = _load_namespace()
    monkeypatch.delenv("BROWSER_AGENT_CHATGPT_PROFILE_STRATEGY", raising=False)
    monkeypatch.delenv("BROWSER_AGENT_PROFILE_STRATEGY", raising=False)
    strategy = str(
        os.environ.get("BROWSER_AGENT_CHATGPT_PROFILE_STRATEGY")
        or os.environ.get("BROWSER_AGENT_PROFILE_STRATEGY")
        or "persistent"
    ).strip().lower()
    assert strategy == "persistent"


def test_chatgpt_wrapper_defaults_to_chrome_channel(monkeypatch):
    ns = _load_namespace()
    monkeypatch.delenv("BROWSER_AGENT_CHATGPT_BROWSER_CHANNEL", raising=False)
    monkeypatch.delenv("BROWSER_AGENT_BROWSER_CHANNEL", raising=False)
    assert ns["_browser_channel"]() == "chrome"


def test_cloudflare_challenge_grace_defaults_and_expires(monkeypatch):
    ns = _load_namespace()
    monkeypatch.delenv("BROWSER_AGENT_CHATGPT_CHALLENGE_GRACE_SECONDS", raising=False)
    monkeypatch.delenv("BROWSER_AGENT_CHALLENGE_GRACE_SECONDS", raising=False)
    assert ns["_challenge_grace_seconds"]() == 20.0
    assert ns["_challenge_persisted_too_long"](100.0, now=119.9, grace_s=20.0) is False
    assert ns["_challenge_persisted_too_long"](100.0, now=120.0, grace_s=20.0) is True


def test_browser_user_agent_defaults_to_non_headless_chrome(monkeypatch):
    ns = _load_namespace()
    monkeypatch.delenv("BROWSER_AGENT_CHATGPT_USER_AGENT", raising=False)
    monkeypatch.delenv("BROWSER_AGENT_USER_AGENT", raising=False)
    ua = ns["_browser_user_agent"](browser_channel="chrome")
    assert "Chrome/" in ua
    assert "HeadlessChrome/" not in ua


def test_normalize_capture_state_promotes_conversation_url_from_canonical():
    ns = _load_namespace()
    data = ns["_normalize_capture_state"](
        {
            "url": "https://chatgpt.com/",
            "canonical_url": "https://chatgpt.com/c/conv-123",
            "conversation_id": "",
        }
    )
    assert data["conversation_id"] == "conv-123"
    assert data["url"] == "https://chatgpt.com/c/conv-123"


def test_normalize_capture_state_recovers_visible_assistant_when_role_nodes_missing():
    ns = _load_namespace()
    prompt_text = "# ChatGPT Report Chapter Writer 固化执行协议\noperator_kind: chapter_writer\n[SCRATCH_CHAT_RESET_CONTRACT]\nchapter_evidence_pack:"
    assistant_text = (
        "已思考 7s\n"
        "Conference keynote 原意摘要与观点归纳：AI Engineer 社区如何定义 2026 主题\n\n"
        "V004，AI Engineer《AI Engineer Melbourne 2026 Keynote Livestream | Day 1》的 keynote 先把会议主题收束成一组判断。"
    )
    data = ns["_normalize_capture_state"](
        {
            "url": "https://chatgpt.com/c/conv-visible",
            "canonical_url": "https://chatgpt.com/c/conv-visible",
            "conversation_id": "conv-visible",
            "message_count": 1,
            "assistant_count": 0,
            "latest_assistant_text": "",
            "messages": [{"role": "user", "text": prompt_text, "turn_index": 1}],
            "visible_blocks": [
                {"source": ".markdown", "text": prompt_text},
                {"source": ".prose", "text": assistant_text},
            ],
        }
    )
    assert data["assistant_count"] == 1
    assert data["message_count"] == 2
    assert data["latest_assistant_text"] == assistant_text
    assert data["_assistant_capture_fallback"]["used"] is True
    assert data["messages"][-1]["role"] == "assistant"


def test_normalize_capture_state_does_not_promote_prompt_like_visible_block():
    ns = _load_namespace()
    prompt_text = "# ChatGPT Report Chapter Writer 固化执行协议\noperator_kind: chapter_writer\n[SCRATCH_CHAT_RESET_CONTRACT]\nchapter_evidence_pack:"
    data = ns["_normalize_capture_state"](
        {
            "url": "https://chatgpt.com/c/conv-prompt-only",
            "canonical_url": "https://chatgpt.com/c/conv-prompt-only",
            "conversation_id": "conv-prompt-only",
            "message_count": 1,
            "assistant_count": 0,
            "latest_assistant_text": "",
            "messages": [{"role": "user", "text": prompt_text, "turn_index": 1}],
            "visible_blocks": [
                {"source": ".markdown", "text": prompt_text + "\n当前报告：\n输出硬规则："},
            ],
        }
    )
    assert data["assistant_count"] == 0
    assert data["latest_assistant_text"] == ""
    assert "_assistant_capture_fallback" not in data


def test_normalize_capture_state_does_not_promote_capture_noise_block():
    ns = _load_namespace()
    noise_text = "window.__oai_logHTML?window.__oai_logHTML():window.__oai_SSR_HTML=window.__oai_SSR_HTML||Date.now();requestAnimationFrame((function(){window.__oai_logTTI?window.__oai_logTTI():window.__oai_SSR_TTI=window.__oai_SSR_TTI||Date.now()}))"
    data = ns["_normalize_capture_state"](
        {
            "url": "https://chatgpt.com/",
            "canonical_url": "https://chatgpt.com/",
            "conversation_id": "",
            "message_count": 0,
            "assistant_count": 0,
            "latest_assistant_text": "",
            "messages": [],
            "visible_blocks": [
                {"source": "[class*='prose']", "text": noise_text},
            ],
        }
    )
    assert data["assistant_count"] == 0
    assert data["latest_assistant_text"] == ""
    assert "_assistant_capture_fallback" not in data


def test_conversation_id_from_url_extracts_chatgpt_path():
    ns = _load_namespace()
    assert ns["_conversation_id_from_url"]("https://chatgpt.com/c/abc-123?foo=bar") == "abc-123"
    assert ns["_conversation_id_from_url"]("https://chatgpt.com/") == ""


def test_placeholder_assistant_text_detects_thinking_only_states():
    ns = _load_namespace()
    assert ns["_is_placeholder_assistant_text"]("正在思考") is True
    assert ns["_is_placeholder_assistant_text"]("Thought for 8 seconds") is True
    assert ns["_is_placeholder_assistant_text"]("已思考 8 秒") is True
    assert ns["_is_placeholder_assistant_text"]("这里已经开始输出正文") is False
    assert ns["_has_substantive_assistant_text"]("正在思考") is False
    assert ns["_has_substantive_assistant_text"]("") is False
    assert ns["_has_substantive_assistant_text"]("Conference keynote 原意摘要与观点归纳") is True


def test_capture_state_retries_after_timeout(monkeypatch, tmp_path):
    ns = _load_namespace()
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_CAPTURE_EVALUATE_TIMEOUT_SECONDS", "0.01")

    class _FakePage:
        def __init__(self):
            self.calls = 0

        async def evaluate(self, _js):
            self.calls += 1
            if self.calls == 1:
                await asyncio.sleep(0.05)
            return json.dumps(
                {
                    "url": "https://chatgpt.com/c/retry-ok",
                    "canonical_url": "https://chatgpt.com/c/retry-ok",
                    "conversation_id": "retry-ok",
                    "assistant_count": 1,
                    "message_count": 2,
                    "is_generating": True,
                    "latest_assistant_text": "正在思考",
                },
                ensure_ascii=False,
            )

    req = tmp_path / "req"
    req.mkdir()
    data = asyncio.run(
        ns["_capture_state"](
            _FakePage(),
            request_dir=req,
            phase="answer_poll",
            retries=1,
            timeout_s=0.01,
        )
    )
    assert data["conversation_id"] == "retry-ok"
    timeout_note = json.loads((req / "capture-evaluate-timeout.json").read_text(encoding="utf-8"))
    assert timeout_note["phase"] == "answer_poll"
    assert timeout_note["attempt"] == 1


def test_wait_for_answer_marks_thinking_stall_even_if_later_poll_loses_assistant_bubble(monkeypatch, tmp_path):
    ns = _load_namespace()
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_THINKING_STALL_SECONDS", "30")
    payloads = iter([
        {
            "conversation_id": "conv-stall",
            "url": "https://chatgpt.com/c/conv-stall",
            "assistant_count": 1,
            "message_count": 2,
            "is_generating": True,
            "latest_assistant_text": "正在思考",
        },
        {
            "conversation_id": "conv-stall",
            "url": "https://chatgpt.com/c/conv-stall",
            "assistant_count": 0,
            "message_count": 2,
            "is_generating": True,
            "latest_assistant_text": "",
        },
    ])

    async def _fake_capture_state(_page, **_kwargs):
        return next(payloads)

    time_values = iter([0.0, 1.0, 2.0, 3.0, 40.0, 41.0])

    def _fake_time():
        try:
            return next(time_values)
        except StopIteration:
            return 41.0

    monkeypatch.setitem(ns, "_capture_state", _fake_capture_state)
    monkeypatch.setattr(ns["time"], "time", _fake_time)

    req = tmp_path / "req"
    req.mkdir()
    try:
        asyncio.run(ns["_wait_for_answer"](object(), 0, request_dir=req))
    except TimeoutError as exc:
        assert "thinking_only" in str(exc)
    else:
        raise AssertionError("expected TimeoutError")

    poll_state = json.loads((req / "answer-poll-state.json").read_text(encoding="utf-8"))
    assert poll_state["assistant_count"] == 0
    assert poll_state["first_response_seen"] is True
    stall_state = json.loads((req / "thinking-stall-state.json").read_text(encoding="utf-8"))
    assert stall_state["status"] == "thinking_only_stall"
    assert stall_state["baseline_assistant_count"] == 0


def test_wait_for_answer_refreshes_before_thinking_stall_failure(monkeypatch, tmp_path):
    ns = _load_namespace()
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_THINKING_STALL_SECONDS", "30")
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_NO_ASSISTANT_RELOAD_CONFIRM_SECONDS", "6")
    monkeypatch.setenv("BROWSER_AGENT_STABLE_POLLS", "1")
    payloads = iter([
        {
            "conversation_id": "conv-thinking-refresh",
            "url": "https://chatgpt.com/c/conv-thinking-refresh",
            "assistant_count": 1,
            "message_count": 2,
            "is_generating": True,
            "latest_assistant_text": "正在思考",
        },
        {
            "conversation_id": "conv-thinking-refresh",
            "url": "https://chatgpt.com/c/conv-thinking-refresh",
            "assistant_count": 0,
            "message_count": 1,
            "is_generating": False,
            "latest_assistant_text": "",
        },
        {
            "conversation_id": "conv-thinking-refresh",
            "url": "https://chatgpt.com/c/conv-thinking-refresh",
            "assistant_count": 1,
            "message_count": 2,
            "is_generating": False,
            "latest_assistant_text": "Conference keynote 原意摘要与观点归纳：AI Engineer 社区如何定义 2026 主题\n\nV004，AI Engineer 频道……",
        },
        {
            "conversation_id": "conv-thinking-refresh",
            "url": "https://chatgpt.com/c/conv-thinking-refresh",
            "assistant_count": 1,
            "message_count": 2,
            "is_generating": False,
            "latest_assistant_text": "Conference keynote 原意摘要与观点归纳：AI Engineer 社区如何定义 2026 主题\n\nV004，AI Engineer 频道……",
        },
    ])

    async def _fake_capture_state(_page, **_kwargs):
        return next(payloads)

    refresh_calls: list[dict] = []

    async def _fake_refresh(_page, data, *, request_dir=None):
        refresh_calls.append({"conversation_id": data.get("conversation_id"), "url": data.get("url")})
        if request_dir is not None:
            (request_dir / "no-assistant-refresh-attempt.json").write_text(
                json.dumps(
                    {
                        "status": "reloaded",
                        "conversation_id": data.get("conversation_id"),
                        "url": data.get("url"),
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
        return True

    time_values = iter([0.0, 1.0, 2.0, 35.0, 36.0, 37.0, 38.0, 39.0, 40.0, 41.0])

    def _fake_time():
        try:
            return next(time_values)
        except StopIteration:
            return 41.0

    async def _fast_sleep(_seconds):
        return None

    monkeypatch.setitem(ns, "_capture_state", _fake_capture_state)
    monkeypatch.setitem(ns, "_refresh_conversation_before_no_assistant_failure", _fake_refresh)
    monkeypatch.setattr(ns["time"], "time", _fake_time)
    monkeypatch.setattr(ns["asyncio"], "sleep", _fast_sleep)

    req = tmp_path / "req"
    req.mkdir()
    result = asyncio.run(ns["_wait_for_answer"](object(), 0, request_dir=req))
    assert result["assistant_count"] == 1
    assert len(refresh_calls) == 1
    assert not (req / "thinking-stall-state.json").exists()


def test_wait_for_answer_marks_no_assistant_response_after_submit(monkeypatch, tmp_path):
    ns = _load_namespace()
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_NO_ASSISTANT_STALL_SECONDS", "30")
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_NO_ASSISTANT_QUIET_SECONDS", "1")
    payloads = iter([
        {
            "conversation_id": "conv-no-assistant",
            "url": "https://chatgpt.com/c/conv-no-assistant",
            "assistant_count": 0,
            "message_count": 1,
            "is_generating": True,
            "latest_assistant_text": "",
        },
        {
            "conversation_id": "conv-no-assistant",
            "url": "https://chatgpt.com/c/conv-no-assistant",
            "assistant_count": 0,
            "message_count": 1,
            "is_generating": False,
            "latest_assistant_text": "",
        },
        {
            "conversation_id": "conv-no-assistant",
            "url": "https://chatgpt.com/c/conv-no-assistant",
            "assistant_count": 0,
            "message_count": 1,
            "is_generating": False,
            "latest_assistant_text": "",
        },
        {
            "conversation_id": "conv-no-assistant",
            "url": "https://chatgpt.com/c/conv-no-assistant",
            "assistant_count": 0,
            "message_count": 1,
            "is_generating": False,
            "latest_assistant_text": "",
        },
        {
            "conversation_id": "conv-no-assistant",
            "url": "https://chatgpt.com/c/conv-no-assistant",
            "assistant_count": 0,
            "message_count": 1,
            "is_generating": False,
            "latest_assistant_text": "",
        },
    ])

    async def _fake_capture_state(_page, **_kwargs):
        return next(payloads)

    time_values = iter([0.0, 0.1, 1.0, 1.1, 2.5, 2.6, 4.5, 4.6, 5.9, 6.0])

    def _fake_time():
        try:
            return next(time_values)
        except StopIteration:
            return 6.0

    async def _fast_sleep(_seconds):
        return None

    monkeypatch.setitem(ns, "_capture_state", _fake_capture_state)
    monkeypatch.setattr(ns["time"], "time", _fake_time)
    monkeypatch.setattr(ns["asyncio"], "sleep", _fast_sleep)

    req = tmp_path / "req"
    req.mkdir()
    try:
        asyncio.run(ns["_wait_for_answer"](object(), 0, request_dir=req))
    except TimeoutError as exc:
        assert "no_assistant_response_after_submit" in str(exc)
    else:
        raise AssertionError("expected TimeoutError")

    poll_state = json.loads((req / "answer-poll-state.json").read_text(encoding="utf-8"))
    assert poll_state["assistant_count"] == 0
    assert poll_state["first_response_seen"] is False
    no_assistant_state = json.loads((req / "no-assistant-response-state.json").read_text(encoding="utf-8"))
    assert no_assistant_state["status"] == "no_assistant_response_after_submit"
    assert no_assistant_state["reason"] == "generation_stopped_before_first_assistant"
    assert no_assistant_state["baseline_assistant_count"] == 0


def test_wait_for_answer_rejects_stale_prior_assistant_response(monkeypatch, tmp_path):
    ns = _load_namespace()
    previous_text = (
        "Conference keynote 原意摘要与观点归纳：AI Engineer 社区如何定义 2026 主题\n"
        "V004，AI Engineer 频道《AI Engineer Melbourne 2026 Keynote Livestream | Day 1》……"
    )
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_NO_ASSISTANT_STALL_SECONDS", "30")
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_NO_ASSISTANT_QUIET_SECONDS", "1")
    payloads = [
        {
            "conversation_id": "conv-stale-assistant",
            "url": "https://chatgpt.com/c/conv-stale-assistant",
            "assistant_count": 2,
            "message_count": 5,
            "is_generating": True,
            "latest_assistant_text": "正在思考",
        },
        {
            "conversation_id": "conv-stale-assistant",
            "url": "https://chatgpt.com/c/conv-stale-assistant",
            "assistant_count": 1,
            "message_count": 3,
            "is_generating": False,
            "latest_assistant_text": previous_text,
        },
        {
            "conversation_id": "conv-stale-assistant",
            "url": "https://chatgpt.com/c/conv-stale-assistant",
            "assistant_count": 1,
            "message_count": 3,
            "is_generating": False,
            "latest_assistant_text": previous_text,
        },
        {
            "conversation_id": "conv-stale-assistant",
            "url": "https://chatgpt.com/c/conv-stale-assistant",
            "assistant_count": 1,
            "message_count": 3,
            "is_generating": False,
            "latest_assistant_text": previous_text,
        },
        {
            "conversation_id": "conv-stale-assistant",
            "url": "https://chatgpt.com/c/conv-stale-assistant",
            "assistant_count": 1,
            "message_count": 3,
            "is_generating": False,
            "latest_assistant_text": previous_text,
        },
    ]
    state = {"idx": 0}

    async def _fake_capture_state(_page, **_kwargs):
        idx = state["idx"]
        if idx < len(payloads) - 1:
            state["idx"] = idx + 1
        return payloads[idx]

    time_values = iter([0.0, 0.1, 1.0, 1.1, 2.5, 2.6, 4.5, 4.6, 5.9, 6.0])

    def _fake_time():
        try:
            return next(time_values)
        except StopIteration:
            return 6.0

    monkeypatch.setitem(ns, "_capture_state", _fake_capture_state)
    monkeypatch.setattr(ns["time"], "time", _fake_time)

    req = tmp_path / "req"
    req.mkdir()
    try:
        asyncio.run(
            ns["_wait_for_answer"](
                object(),
                1,
                baseline_latest_assistant_text=previous_text,
                timeout_s=5,
                request_dir=req,
            )
        )
    except TimeoutError as exc:
        assert "no_assistant_response_after_submit" in str(exc)
    else:
        raise AssertionError("expected TimeoutError")

    poll_state = json.loads((req / "answer-poll-state.json").read_text(encoding="utf-8"))
    assert poll_state["assistant_count"] == 1
    assert poll_state["first_response_seen"] is True
    assert poll_state["substantive_response_seen"] is False


def test_refresh_conversation_before_no_assistant_failure_reloads_existing_conversation(tmp_path):
    ns = _load_namespace()
    req = tmp_path / "req"
    req.mkdir()

    class _FakePage:
        def __init__(self):
            self.reload_calls = 0

        async def reload(self):
            self.reload_calls += 1
            return None

    page = _FakePage()
    result = asyncio.run(
        ns["_refresh_conversation_before_no_assistant_failure"](
            page,
            {
                "conversation_id": "conv-reload",
                "url": "https://chatgpt.com/c/conv-reload",
            },
            request_dir=req,
        )
    )
    assert result is True
    assert page.reload_calls == 1
    refresh_note = json.loads((req / "no-assistant-refresh-attempt.json").read_text(encoding="utf-8"))
    assert refresh_note["status"] == "reloaded"


def test_best_effort_page_state_prefers_answer_poll_over_ready_state(tmp_path):
    ns = _load_namespace()
    req = tmp_path / "req"
    req.mkdir()
    (req / "ready-state.json").write_text(json.dumps({
        "url": "https://chatgpt.com/",
        "conversation_id": "",
        "latest_assistant_text": "",
    }, ensure_ascii=False), encoding="utf-8")
    (req / "post-submit-state.json").write_text(json.dumps({
        "url": "https://chatgpt.com/c/conv-post",
        "conversation_id": "conv-post",
        "latest_assistant_text": "正在思考",
    }, ensure_ascii=False), encoding="utf-8")
    (req / "answer-poll-state.json").write_text(json.dumps({
        "url": "https://chatgpt.com/c/conv-final",
        "conversation_id": "conv-final",
        "latest_assistant_text": "",
        "assistant_count": 0,
    }, ensure_ascii=False), encoding="utf-8")
    data = ns["_best_effort_page_state"](req)
    assert data["conversation_id"] == "conv-final"
    assert data["url"] == "https://chatgpt.com/c/conv-final"


def test_write_startup_stage_persists_stage_file(tmp_path):
    ns = _load_namespace()
    req = tmp_path / "req"
    req.mkdir()
    ns["_write_startup_stage"](req, "browser.start", status="ok", target_url="https://chatgpt.com/")
    payload = json.loads((req / "startup-stage.json").read_text(encoding="utf-8"))
    assert payload["stage"] == "browser.start"
    assert payload["status"] == "ok"
    assert payload["target_url"] == "https://chatgpt.com/"


def test_failed_executor_status_for_error_returns_specific_failed_codes():
    ns = _load_namespace()
    assert ns["_failed_executor_status_for_error"]("chatgpt_no_assistant_response_after_submit") == "failed_no_assistant_response_after_submit"
    assert ns["_failed_executor_status_for_error"]("chatgpt_generation_stalled_thinking_only") == "failed_chatgpt_generation_stalled_thinking_only"
    assert ns["_failed_executor_status_for_error"]("RuntimeError: something else") == "failed_executor"
