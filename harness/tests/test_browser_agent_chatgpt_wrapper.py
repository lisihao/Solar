from __future__ import annotations

import asyncio
import os
import json
import sys
import types
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


def test_profile_policy_selects_hf_default_profile(tmp_path, monkeypatch):
    ns = _load_namespace()
    policy = tmp_path / "browser-agent-chatgpt-local.json"
    policy.write_text(
        json.dumps(
            {
                "version": 1,
                "policies": {
                    "default": {
                        "expected_account_email": "wrong@example.com",
                        "allowed_profiles": ["Profile X"],
                    },
                    "hf_paper_insight": {
                        "expected_account_email": "haogege1977@gmail.com",
                        "allowed_profiles": ["Default"],
                        "allow_headless": False,
                        "force_headed": True,
                        "refresh_profile_runtime_on_start": True,
                        "profile_strategy": "persistent",
                        "user_data_dir": "/Users/lisihao/Library/Application Support/Google/Chrome",
                    },
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE", str(policy))
    selected = ns["_select_chatgpt_profile_policy"]("hf-paper-report-plan-2026-06-13")
    assert selected["enabled"] is True
    assert selected["policy_key"] == "hf_paper_insight"
    assert selected["selected_profile_directory"] == "Default"
    assert selected["selected_account_email"] == "haogege1977@gmail.com"
    assert selected["allow_headless"] is False
    assert selected["force_headed"] is True
    assert selected["refresh_profile_runtime_on_start"] is True


def test_profile_policy_selects_ai_influence_for_grouping_purpose(tmp_path, monkeypatch):
    ns = _load_namespace()
    policy = tmp_path / "browser-agent-chatgpt-local.json"
    policy.write_text(
        json.dumps(
            {
                "version": 1,
                "policies": {
                    "default": {
                        "expected_account_email": "wrong@example.com",
                        "allowed_profiles": ["Default"],
                    },
                    "ai_influence_report": {
                        "expected_account_email": "browser-agent@example.com",
                        "allowed_profiles": ["Profile 1"],
                        "allow_headless": False,
                        "force_headed": True,
                        "refresh_profile_runtime_on_start": True,
                        "profile_strategy": "persistent",
                    },
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE", str(policy))
    selected = ns["_select_chatgpt_profile_policy"]("ai-influence-video-grouping-2026-06-19")
    assert selected["enabled"] is True
    assert selected["policy_key"] == "ai_influence_report"
    assert selected["selected_profile_directory"] == "Profile 1"
    assert selected["selected_account_email"] == "browser-agent@example.com"
    assert selected["refresh_profile_runtime_on_start"] is True


def test_profile_policy_uses_dedicated_profile_for_deep_insight_solar_purpose(tmp_path, monkeypatch):
    ns = _load_namespace()
    policy = tmp_path / "browser-agent-chatgpt-local.json"
    policy.write_text(
        json.dumps(
            {
                "version": 1,
                "policies": {
                    "default": {
                        "expected_account_email": "wrong@example.com",
                        "allowed_profiles": ["Profile X"],
                    },
                    "ai_influence_report": {
                        "expected_account_email": "browser-agent@example.com",
                        "allowed_profiles": ["Profile 1"],
                        "allow_headless": False,
                        "force_headed": True,
                        "refresh_profile_runtime_on_start": True,
                        "profile_strategy": "persistent",
                        "user_data_dir": "/Users/lisihao/Library/Application Support/Google/Chrome",
                    },
                    "deep_insight_solar": {
                        "expected_account_email": "browser-agent@example.com",
                        "allowed_profiles": ["Profile 2"],
                        "allow_headless": False,
                        "force_headed": True,
                        "refresh_profile_runtime_on_start": True,
                        "profile_strategy": "persistent",
                        "user_data_dir": "/Users/lisihao/Library/Application Support/Google/Chrome",
                    },
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE", str(policy))
    selected = ns["_select_chatgpt_profile_policy"]("deep-insight-solar-BrowserLongformWriter")
    assert selected["enabled"] is True
    assert selected["policy_key"] == "deep_insight_solar"
    assert selected["selected_profile_directory"] == "Profile 2"
    assert selected["selected_account_email"] == "browser-agent@example.com"
    assert selected["allow_headless"] is False
    assert selected["force_headed"] is True
    assert selected["refresh_profile_runtime_on_start"] is True


def test_profile_policy_rejects_scratch_profile_mismatch(tmp_path, monkeypatch):
    ns = _load_namespace()
    policy = tmp_path / "browser-agent-chatgpt-local.json"
    policy.write_text(
        json.dumps(
            {
                "version": 1,
                "policies": {
                    "default": {
                        "expected_account_email": "haogege1977@gmail.com",
                        "allowed_profiles": ["Default"],
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE", str(policy))
    monkeypatch.setenv("BROWSER_AGENT_PROFILE_DIRECTORY", "Profile 7")
    try:
        ns["_select_chatgpt_profile_policy"]("github-trend-report-2026-06-13")
    except RuntimeError as exc:
        assert "browser_agent_profile_policy_profile_mismatch" in str(exc)
    else:
        raise AssertionError("expected profile mismatch")


def test_json_short_answer_continuation_demands_plain_json(monkeypatch):
    ns = _load_namespace()
    prompts: list[str] = []

    async def _fake_submit(page, prompt):
        prompts.append(prompt)

    async def _fake_wait(page, baseline_assistant_count, timeout_s=0, **kwargs):
        return {
            "latest_assistant_text": "{\"ok\": true, \"items\": []}",
            "assistant_count": baseline_assistant_count + 1,
        }

    monkeypatch.setenv("BROWSER_AGENT_EXPECTED_OUTPUT", "json")
    monkeypatch.setitem(ns, "_submit_prompt", _fake_submit)
    monkeypatch.setitem(ns, "_wait_for_answer", _fake_wait)

    result = asyncio.run(
        ns["_continue_if_answer_too_short"](
            object(),
            {"latest_assistant_text": "我会先确认实体边界", "assistant_count": 1},
            min_chars=1200,
            timeout_s=60,
        )
    )

    assert result["_continuation_trigger"]["reason"] == "answer_too_short"
    assert prompts
    assert "输出完整 JSON 对象" in prompts[0]
    assert "第一个字符必须是 {" in prompts[0]
    assert "不要使用 Markdown 代码块" in prompts[0]


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


def test_chatgpt_wrapper_has_generating_without_output_timeout(monkeypatch):
    ns = _load_namespace()
    monkeypatch.delenv("BROWSER_AGENT_GENERATING_NO_OUTPUT_TIMEOUT_SECONDS", raising=False)
    monkeypatch.delenv("BROWSER_AGENT_CHATGPT_GENERATING_NO_OUTPUT_TIMEOUT_SECONDS", raising=False)
    assert ns["_generating_without_output_timeout_seconds"]() == 420
    monkeypatch.setenv("BROWSER_AGENT_GENERATING_NO_OUTPUT_TIMEOUT_SECONDS", "90")
    assert ns["_generating_without_output_timeout_seconds"]() == 90
    monkeypatch.setenv("BROWSER_AGENT_GENERATING_NO_OUTPUT_TIMEOUT_SECONDS", "bad")
    assert ns["_generating_without_output_timeout_seconds"]() == 420


def test_chatgpt_wrapper_defaults_to_chrome_channel(monkeypatch):
    ns = _load_namespace()
    monkeypatch.delenv("BROWSER_AGENT_CHATGPT_BROWSER_CHANNEL", raising=False)
    monkeypatch.delenv("BROWSER_AGENT_BROWSER_CHANNEL", raising=False)
    assert ns["_browser_channel"]() == "chrome"


def test_submit_js_rejects_continue_button_for_long_prompt_submit():
    ns = _load_namespace()
    submit_js = ns["SUBMIT_JS"]
    assert "continue|继续|resume|next|下一步" in submit_js
    assert "candidate.strict && !sendLike(label)" in submit_js


def test_long_prompt_submit_has_synthetic_paste_fallback():
    ns = _load_namespace()
    assert "ClipboardEvent(\"paste\"" in ns["PASTE_EVENT_PROMPT_JS"]
    submit_prompt = ns["_submit_prompt"]
    names = submit_prompt.__code__.co_names
    assert "PASTE_EVENT_PROMPT_JS" in names


def test_chatgpt_wrapper_disables_extensions_by_default(monkeypatch):
    ns = _load_namespace()
    monkeypatch.delenv("BROWSER_AGENT_CHATGPT_DISABLE_EXTENSIONS", raising=False)
    monkeypatch.delenv("BROWSER_AGENT_DISABLE_EXTENSIONS", raising=False)
    assert ns["_disable_browser_extensions"]() is True


def test_chatgpt_wrapper_can_reenable_extensions(monkeypatch):
    ns = _load_namespace()
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_DISABLE_EXTENSIONS", "false")
    assert ns["_disable_browser_extensions"]() is False


def test_cloudflare_challenge_grace_defaults_and_expires(monkeypatch):
    ns = _load_namespace()
    monkeypatch.delenv("BROWSER_AGENT_CHATGPT_CHALLENGE_GRACE_SECONDS", raising=False)
    monkeypatch.delenv("BROWSER_AGENT_CHALLENGE_GRACE_SECONDS", raising=False)
    assert ns["_challenge_grace_seconds"]() == 75.0
    assert ns["_challenge_persisted_too_long"](100.0, now=174.9, grace_s=75.0) is False
    assert ns["_challenge_persisted_too_long"](100.0, now=175.0, grace_s=75.0) is True


def test_cloudflare_detector_does_not_match_generic_chinese_wait_text():
    ns = _load_namespace()
    capture_js = ns["CAPTURE_JS"]
    assert "请稍候" not in capture_js
    assert "verify you are human" in capture_js
    assert "turnstile" in capture_js


def test_capture_js_detects_chatgpt_request_rate_limit_modal():
    ns = _load_namespace()
    capture_js = ns["CAPTURE_JS"]
    assert "request_rate_limit_wall" in capture_js
    assert "请求过于频繁" in capture_js
    assert "暂时限制你访问对话记录" in capture_js
    assert "request_rate_limit_action_visible" in capture_js


def test_request_rate_limit_dismiss_js_clicks_acknowledge_button():
    ns = _load_namespace()
    dismiss_js = ns["DISMISS_REQUEST_RATE_LIMIT_MODAL_JS"]
    assert "请求过于频繁" in dismiss_js
    assert "明白了" in dismiss_js
    assert "modal_not_found" in dismiss_js
    assert "action_not_found" in dismiss_js


def test_completion_payload_includes_request_rate_limit_state():
    ns = _load_namespace()
    payload = ns["_completion_payload"](
        status="rate_limited",
        data={
            "latest_assistant_text": "",
            "request_rate_limit_wall": True,
            "request_rate_limit_action_visible": True,
        },
        prompt="hello",
        reason="request_rate_limit_modal_seen",
    )
    assert payload["request_rate_limit_wall"] is True
    assert payload["request_rate_limit_action_visible"] is True
    assert payload["status"] == "rate_limited"


def test_wait_for_answer_has_one_shot_retry_after_rate_limit_dismissal():
    ns = _load_namespace()
    source = SCRIPT.read_text(encoding="utf-8")
    assert "BROWSER_AGENT_RATE_LIMIT_RETRY_SUBMIT_AFTER_SECONDS" in source
    assert "rate-limit-modal-retry-submit.json" in source
    assert "request_rate_limit_dismissed_but_no_generation" in source
    assert "rate_limit_retry_submitted = True" in source


def test_submitted_no_generation_retry_limit_defaults_and_reads_env(monkeypatch):
    ns = _load_namespace()
    monkeypatch.delenv("BROWSER_AGENT_SUBMITTED_NO_GENERATION_RETRIES", raising=False)
    monkeypatch.delenv("BROWSER_AGENT_CHATGPT_SUBMITTED_NO_GENERATION_RETRIES", raising=False)
    assert ns["_submitted_no_generation_retry_limit"]() == 2
    monkeypatch.setenv("BROWSER_AGENT_SUBMITTED_NO_GENERATION_RETRIES", "0")
    assert ns["_submitted_no_generation_retry_limit"]() == 0
    monkeypatch.setenv("BROWSER_AGENT_SUBMITTED_NO_GENERATION_RETRIES", "bad")
    assert ns["_submitted_no_generation_retry_limit"]() == 2


def test_submitted_no_generation_retry_prompt_respects_json_expected(monkeypatch):
    ns = _load_namespace()
    monkeypatch.setenv("BROWSER_AGENT_EXPECTED_OUTPUT", "json")
    prompt = ns["_submitted_no_generation_retry_prompt"](2)
    assert "合法 JSON object" in prompt
    assert "第 2 次恢复提交" in prompt
    assert "Markdown" in prompt


def test_wait_for_answer_retries_submitted_without_generation_before_blocking():
    source = SCRIPT.read_text(encoding="utf-8")
    assert "submitted-no-generation-retry-" in source
    assert "submitted-no-generation-retries.jsonl" in source
    assert "submitted_without_generation" in source
    assert "submitted_no_generation_retries < submitted_no_generation_retry_limit" in source


def test_runtime_finalize_has_fallback_profile_lease_release():
    source = SCRIPT.read_text(encoding="utf-8")
    assert "_finalize_runtime_contract_safely" in source
    assert "runtime-finalize-error.json" in source
    assert "fallback_release" in source
    assert "lease_manager.release" in source


def test_reasoning_retry_triggers_only_for_stalled_generating_conversation(monkeypatch):
    ns = _load_namespace()
    monkeypatch.delenv("BROWSER_AGENT_CHATGPT_REASONING_RETRY_AFTER_SECONDS", raising=False)
    monkeypatch.delenv("BROWSER_AGENT_REASONING_RETRY_AFTER_SECONDS", raising=False)
    assert ns["_should_attempt_reasoning_retry"](
        {
            "is_generating": True,
            "assistant_count": 0,
            "message_count": 1,
            "conversation_id": "abc",
            "url": "https://chatgpt.com/c/abc",
        },
        elapsed_s=25.0,
        retried=False,
    ) is True


def test_reasoning_retry_skips_once_response_or_no_conversation(monkeypatch):
    ns = _load_namespace()
    assert ns["_should_attempt_reasoning_retry"](
        {
            "is_generating": True,
            "assistant_count": 1,
            "message_count": 2,
            "conversation_id": "abc",
            "url": "https://chatgpt.com/c/abc",
        },
        elapsed_s=25.0,
        retried=False,
    ) is False
    assert ns["_should_attempt_reasoning_retry"](
        {
            "is_generating": True,
            "assistant_count": 0,
            "message_count": 1,
            "conversation_id": "",
            "url": "https://chatgpt.com/",
        },
        elapsed_s=25.0,
        retried=False,
    ) is False


def test_isolated_post_submit_accepts_duplicate_user_nodes_when_prompt_present():
    ns = _load_namespace()
    prompt = "- purpose: hf-paper-report-plan-2026-06-28\n\n请输出完整 JSON"
    assert ns["_post_submit_is_isolated_current_prompt"](
        {
            "conversation_id": "fresh-conversation",
            "message_count": 3,
            "assistant_count": 1,
            "is_generating": True,
            "messages": [
                {"role": "user", "text": "older dom residue"},
                {"role": "user", "text": prompt},
                {"role": "assistant", "text": "Pro 思考中"},
            ],
        },
        prompt,
    ) is True


def test_isolated_post_submit_rejects_missing_current_prompt():
    ns = _load_namespace()
    assert ns["_post_submit_is_isolated_current_prompt"](
        {
            "conversation_id": "fresh-conversation",
            "message_count": 2,
            "assistant_count": 1,
            "is_generating": True,
            "messages": [
                {"role": "user", "text": "older dom residue"},
                {"role": "assistant", "text": "Pro 思考中"},
            ],
        },
        "- purpose: hf-paper-report-plan-2026-06-28",
    ) is False


def test_minimum_answer_chars_defaults_and_reads_env(monkeypatch):
    ns = _load_namespace()
    monkeypatch.delenv("BROWSER_AGENT_CHATGPT_MIN_ANSWER_CHARS", raising=False)
    monkeypatch.delenv("BROWSER_AGENT_MIN_ANSWER_CHARS", raising=False)
    assert ns["_minimum_answer_chars"]() == 0

    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_MIN_ANSWER_CHARS", "1500")
    assert ns["_minimum_answer_chars"]() == 1500

    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_MIN_ANSWER_CHARS", "bad")
    assert ns["_minimum_answer_chars"]() == 0


def test_browser_user_agent_defaults_to_non_headless_chrome(monkeypatch):
    ns = _load_namespace()
    monkeypatch.delenv("BROWSER_AGENT_CHATGPT_USER_AGENT", raising=False)
    monkeypatch.delenv("BROWSER_AGENT_USER_AGENT", raising=False)
    ua = ns["_browser_user_agent"](browser_channel="chrome")
    assert "Chrome/" in ua
    assert "HeadlessChrome/" not in ua


def test_normalize_capture_payload_prefers_substantive_assistant_text():
    ns = _load_namespace()
    payload = ns["_normalize_capture_payload"](
        {
            "latest_assistant_text": "Pro 思考中",
            "messages": [
                {"role": "user", "text": "prompt"},
                {"role": "assistant", "text": "{\"date\": \"2026-06-05\", \"accepted\": true}"},
                {"role": "assistant", "text": "Pro 思考中"},
            ],
        }
    )
    assert payload["latest_assistant_text_raw"] == "Pro 思考中"
    assert payload["latest_assistant_text"] == "{\"date\": \"2026-06-05\", \"accepted\": true}"


def test_normalize_capture_payload_keeps_status_only_when_no_body_exists():
    ns = _load_namespace()
    payload = ns["_normalize_capture_payload"](
        {
            "latest_assistant_text": "Pro 思考中",
            "messages": [
                {"role": "user", "text": "prompt"},
                {"role": "assistant", "text": "Pro 思考中"},
            ],
        }
    )
    assert payload["latest_assistant_text_raw"] == "Pro 思考中"
    assert payload["latest_assistant_text"] == ""
