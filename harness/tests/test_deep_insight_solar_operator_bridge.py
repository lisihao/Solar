import json
import os
import subprocess
import sys
import time
import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "tools" / "deep_insight_solar_operator_bridge.py"
CHATGPT_OPERATOR = ROOT / "tools" / "chatgpt_browser_agent_task_operator.py"


def _load_bridge_module():
    spec = importlib.util.spec_from_file_location("deep_insight_solar_operator_bridge_test", BRIDGE)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_chatgpt_operator_module():
    spec = importlib.util.spec_from_file_location("chatgpt_browser_agent_task_operator_test", CHATGPT_OPERATOR)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _request(operator_id: str) -> dict:
    return {
        "missionId": "mission-test",
        "capabilityId": "deep-insight-solar",
        "pipelineId": "deep-insight-solar",
        "stepId": "s2-leader-plan",
        "operatorId": operator_id,
        "idempotencyKey": "test-key",
        "inputStateHash": "test-hash",
        "topic": "Agent system architecture",
        "depth": "standard",
        "language": "zh-CN",
        "promptVersion": "test",
        "outputSchemaVersion": "test",
        "constraints": {"failClosed": True},
        "payload": {"note": "dry run"},
    }


def test_deep_insight_solar_bridge_dry_run_outputs_solar_operator_result(tmp_path: Path) -> None:
    env = os.environ.copy()
    env["DEEP_INSIGHT_SOLAR_BRIDGE_DRY_RUN"] = "1"
    env["DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT"] = str(tmp_path)
    proc = subprocess.run(
        [sys.executable, str(BRIDGE)],
        input=json.dumps(_request("BrowserLeaderPlanner")),
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    result = json.loads(proc.stdout)
    assert result["status"] == "succeeded"
    assert result["structured"]["dimensions"][0]["id"] == "dry-ws-evolution"
    assert result["metrics"]["dryRun"] is True


def test_deep_insight_solar_bridge_uses_dedicated_chatgpt_profile_policy_key(monkeypatch) -> None:
    monkeypatch.delenv("GENESISPOD_SOLAR_CHATGPT_ACCOUNT_EMAIL", raising=False)
    monkeypatch.delenv("DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY", raising=False)
    bridge = _load_bridge_module()
    envelope = bridge._chatgpt_envelope(_request("BrowserAnalyst"))
    request = envelope["chatgpt_browser_agent_request"]
    assert envelope["purpose"] == "deep-insight-solar-BrowserAnalyst"
    assert request["profile_policy_key"] == "deep_insight_solar"
    assert request["account_email"] == "lisihao@gmail.com"


def test_deep_insight_solar_ignores_stale_backend_account_profile_env(tmp_path: Path, monkeypatch) -> None:
    bridge = _load_bridge_module()
    policy = tmp_path / "browser-agent-chatgpt-local.json"
    policy.write_text(
        json.dumps(
            {
                "version": 1,
                "policies": {
                    "deep_insight_solar": {
                        "expected_account_email": "lisihao@gmail.com",
                        "allowed_profiles": ["Profile 2"],
                        "allow_headless": False,
                        "force_headed": True,
                        "profile_strategy": "persistent",
                        "refresh_profile_runtime_on_start": True,
                        "ignore_explicit_profile_id": True,
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE", str(policy))
    monkeypatch.setenv("GENESISPOD_SOLAR_CHATGPT_ACCOUNT_EMAIL", "haogege1977@gmail.com")
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_ACCOUNT_EMAIL", "haogege1977@gmail.com")
    monkeypatch.setenv("BROWSER_AGENT_TARGET_ACCOUNT_EMAIL", "haogege1977@gmail.com")
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PROFILE_DIRECTORY", "Default")
    monkeypatch.setenv("BROWSER_AGENT_PROFILE_DIRECTORY", "Default")

    preflight = bridge._policy_preflight(bridge.DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY)
    envelope = bridge._chatgpt_envelope(_request("BrowserAnalyst"))

    assert preflight["selected_account_email"] == "lisihao@gmail.com"
    assert preflight["selected_profile_directory"] == "Profile 2"
    assert preflight["explicit_profile_ignored"] == "Default"
    assert envelope["chatgpt_browser_agent_request"]["account_email"] == "lisihao@gmail.com"


def test_deep_insight_solar_provider_router_defaults_use_browser_for_high_cognition(monkeypatch) -> None:
    bridge = _load_bridge_module()
    monkeypatch.delenv("DEEP_INSIGHT_SOLAR_OPERATOR_PROVIDER_MAP", raising=False)
    for name in [
        "DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_LEADER_PLANNER",
        "DEEP_INSIGHT_SOLAR_PROVIDER_BROWSERLEADERPLANNER",
        "DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_RESEARCHER",
        "DEEP_INSIGHT_SOLAR_PROVIDER_BROWSERRESEARCHER",
        "DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_ANALYST",
        "DEEP_INSIGHT_SOLAR_PROVIDER_BROWSERANALYST",
        "DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_LONGFORM_WRITER",
        "DEEP_INSIGHT_SOLAR_PROVIDER_BROWSERLONGFORMWRITER",
        "DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_CRITIC",
        "DEEP_INSIGHT_SOLAR_PROVIDER_BROWSERCRITIC",
    ]:
        monkeypatch.delenv(name, raising=False)

    assert bridge._provider_for_operator("BrowserLeaderPlanner") == "chatgpt_browser"
    assert bridge._provider_for_operator("BrowserResearcher") == "deepseek_api"
    assert bridge._provider_for_operator("BrowserAnalyst") == "chatgpt_browser"
    assert bridge._provider_for_operator("BrowserLongformWriter") == "chatgpt_browser"
    assert bridge._provider_for_operator("BrowserCritic") == "chatgpt_browser"


def test_deep_insight_solar_treats_profile_lease_busy_as_cooldown() -> None:
    bridge = _load_bridge_module()
    output = (
        "browser_profile_lease_acquire_failed:"
        '{"acquired":false,"reason":"already_acquired",'
        '"profile_id":"chatgpt/lisihao",'
        '"held_by":"chatgpt-other","expires_at":"2026-06-27T14:05:31Z"}'
    )

    assert bridge._flow_control_cooldown_until(output) == "2026-06-27T14:05:31Z"


def test_deep_insight_solar_leader_planner_normalizes_sparse_tracks() -> None:
    bridge = _load_bridge_module()
    sparse = {
        "centralQuestion": "What is the durable technical control point?",
        "researchTracks": [
            {
                "key": "r1",
                "name": "API 调用验证",
                "question": "Does the API use the expected model?",
                "sourcesToFind": ["system_doc"],
                "falsificationChecks": ["check model id"],
                "expectedReportUse": "核心证据链",
            }
        ],
    }

    normalized = bridge._normalize_structured_result(
        "BrowserLeaderPlanner",
        sparse,
        _request("BrowserLeaderPlanner"),
    )

    assert len(normalized["researchTracks"]) == 6
    assert normalized["normalization"]["applied"] is True
    assert normalized["normalization"]["reason"] == "leader_planner_research_tracks_lt_6"
    bridge._validate_chatgpt_structured_result("BrowserLeaderPlanner", normalized, json.dumps(normalized))


def test_deep_insight_solar_researcher_normalizes_observations_to_evidence_cards() -> None:
    bridge = _load_bridge_module()
    structured = {
        "track": {"key": "r1", "name": "材料创新跟踪", "question": "Question"},
        "sourceNotes": [
            {
                "key": "s1",
                "sourceTitle": "NREL chart",
                "url": "https://example.com/nrel",
                "sourceType": "benchmark",
                "relevantFact": "Fact one",
                "supportedClaim": "Claim one",
                "limitation": "Limit one",
            },
            {
                "key": "s2",
                "sourceTitle": "Company source",
                "url": "https://example.com/company",
                "sourceType": "company_source",
                "relevantFact": "Fact two",
                "supportedClaim": "Claim two",
                "limitation": "Limit two",
            },
        ],
        "observations": [
            {
                "claim": f"Claim {idx}",
                "mechanism": "Mechanism " * 30,
                "supportingSourceKeys": ["s1" if idx % 2 else "s2"],
                "counterpointOrLimit": "Limit " * 20,
                "reportUse": "supporting_argument",
            }
            for idx in range(1, 5)
        ],
        "summaryForSynthesis": "Summary " * 140,
    }

    normalized = bridge._normalize_structured_result(
        "BrowserResearcher",
        structured,
        _request("BrowserResearcher"),
    )

    assert len(normalized["evidenceCards"]) == 4
    assert normalized["normalization"]["reason"] == "researcher_observations_to_evidence_cards"
    bridge._validate_chatgpt_structured_result("BrowserResearcher", normalized, json.dumps(normalized))


def test_deep_insight_solar_provider_router_accepts_env_override(monkeypatch) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setenv(
        "DEEP_INSIGHT_SOLAR_OPERATOR_PROVIDER_MAP",
        json.dumps(
            {
                "BrowserAnalyst": "deepseek_api",
                "BrowserLongformWriter": "deepseek_api",
                "BrowserCritic": "deepseek_api",
            }
        ),
    )
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_RESEARCHER", "deepseek_api")

    assert bridge._provider_for_operator("BrowserResearcher") == "deepseek_api"
    assert bridge._provider_for_operator("BrowserAnalyst") == "deepseek_api"
    assert bridge._provider_for_operator("BrowserLongformWriter") == "deepseek_api"
    assert bridge._provider_for_operator("BrowserCritic") == "deepseek_api"


def test_deep_insight_solar_rejects_openai_compatible_main_chain_override(tmp_path: Path, monkeypatch) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT", str(tmp_path / "run"))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_ANALYST", "openai_compatible")
    bridge.RUN_ROOT = tmp_path / "run"

    result = bridge.handle(_request("BrowserAnalyst"))

    assert result["status"] == "failed"
    assert result["error"]["code"] == "OPENAI_COMPATIBLE_DISABLED_FOR_DEEP_INSIGHT_SOLAR"
    assert result["error"]["retryable"] is False


def test_deep_insight_solar_critic_no_generation_returns_explicit_no_output(tmp_path: Path, monkeypatch) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT", str(tmp_path / "run"))
    bridge.RUN_ROOT = tmp_path / "run"
    calls: list[dict] = []

    monkeypatch.setattr(
        bridge,
        "_chatgpt_preflight",
        lambda *args, **kwargs: {"ok": True, "status": "logged_in"},
    )
    monkeypatch.setattr(
        bridge,
        "_chatgpt_browser_task_dir_retry_reason",
        lambda task_dir: "submitted_without_generation",
    )

    def fake_run_operator_with_cooldown_retry(*args, **kwargs):
        calls.append({"args": args, "kwargs": kwargs})
        return subprocess.CompletedProcess(
            args=["chatgpt"],
            returncode=1,
            stdout="",
            stderr="RuntimeError: chatgpt_submitted_without_generation",
        )

    monkeypatch.setattr(
        bridge,
        "_run_operator_with_cooldown_retry",
        fake_run_operator_with_cooldown_retry,
    )

    result = bridge.handle(_request("BrowserCritic"))

    assert len(calls) == 2
    assert result["status"] == "failed"
    assert result["error"]["code"] == "SOLAR_CHATGPT_NO_OUTPUT"
    assert result["error"]["retryable"] is True
    assert "submitted_without_generation" in result["error"]["message"]


def test_deep_insight_solar_researcher_api_result_retries_repair(tmp_path: Path, monkeypatch) -> None:
    bridge = _load_bridge_module()
    calls: list[dict] = []

    def valid_researcher_result() -> dict:
        source_notes = [
            {
                "key": f"s{i}",
                "sourceTitle": f"Source {i}",
                "url": f"https://example.com/{i}",
                "sourceType": "system_doc",
                "dateOrVersion": "2026",
                "relevantFact": "fact " * 20,
                "supportedClaim": "claim " * 20,
                "limitation": "limit " * 20,
                "confidence": "medium",
            }
            for i in range(1, 5)
        ]
        observations = [
            {
                "claim": f"Recovered claim {i}",
                "mechanism": "mechanism " * 30,
                "supportingSourceKeys": [f"s{i}"],
                "counterpointOrLimit": "counterpoint " * 20,
                "reportUse": "supporting_argument",
            }
            for i in range(1, 4)
        ]
        return {
            "sourceNotes": source_notes,
            "observations": observations,
            "summaryForSynthesis": "修复后的综合摘要。" * 80,
        }

    def fake_call(request: dict, *, provider: str, task_dir: Path):
        calls.append(request)
        if len(calls) == 1:
            return {"sourceNotes": [], "observations": [], "summaryForSynthesis": "too short"}, "{}", {
                "provider": provider,
                "modelId": "test-model",
            }
        assert request["payload"]["repairDirective"]
        return valid_researcher_result(), json.dumps(valid_researcher_result(), ensure_ascii=False), {
            "provider": provider,
            "modelId": "test-model",
        }

    monkeypatch.setattr(bridge, "_call_openai_compatible_json", fake_call)

    result = bridge._run_api_provider_operator(
        _request("BrowserResearcher"),
        provider="deepseek_api",
        task_dir=tmp_path,
    )

    assert result["status"] == "succeeded"
    assert len(calls) == 2
    assert result["metrics"]["retryMode"] == "researcher_json_repair"
    assert len(result["structured"]["evidenceCards"]) == 3


def test_api_provider_salvages_json_from_reasoning_content(tmp_path: Path, monkeypatch) -> None:
    bridge = _load_bridge_module()
    payload = {
        "sourceNotes": [
            {
                "key": "s1",
                "sourceTitle": "Primary source",
                "url": "https://example.com/source",
                "sourceType": "company_source",
                "dateOrVersion": "2026-06",
                "relevantFact": "Fact",
                "supportedClaim": "Claim",
                "limitation": "Limit",
                "confidence": "high",
            }
        ],
        "observations": [
            {
                "claim": "Claim",
                "mechanism": "Mechanism",
                "supportingSourceKeys": ["s1"],
                "counterpointOrLimit": "Limit",
                "reportUse": "lead_argument",
            }
        ],
        "summaryForSynthesis": "Summary",
    }
    response = {
        "choices": [
            {
                "finish_reason": "stop",
                "message": {
                    "content": "",
                    "reasoning_content": "thinking...\n```json\n"
                    + json.dumps(payload, ensure_ascii=False)
                    + "\n```",
                },
            }
        ],
        "usage": {"total_tokens": 42, "prompt_tokens": 20, "completion_tokens": 22},
    }

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps(response, ensure_ascii=False).encode("utf-8")

    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_DEEPSEEK_API_KEY", "test-key")
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_DEEPSEEK_BASE_URL", "https://deepseek.test")
    monkeypatch.setattr(bridge.urllib.request, "urlopen", lambda *args, **kwargs: FakeResponse())

    structured, text, metrics = bridge._call_openai_compatible_json(
        _request("BrowserResearcher"),
        provider="deepseek_api",
        task_dir=tmp_path,
    )

    assert structured["sourceNotes"][0]["key"] == "s1"
    assert text.strip().startswith("{")
    assert metrics["tokensUsed"] == 42


def test_deep_insight_solar_handle_routes_planner_to_browser_with_preflight(
    tmp_path: Path,
    monkeypatch,
) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT", str(tmp_path / "run"))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_LEADER_PLANNER", "chatgpt_browser")
    bridge.RUN_ROOT = tmp_path / "run"

    def fake_preflight(request: dict, **kwargs):
        assert request["operatorId"] == "BrowserLeaderPlanner"
        return {"ok": True}

    class FakeProc:
        returncode = 0
        stdout = ""
        stderr = ""

    structured = {
        "centralQuestion": "What is the durable technical control point?",
        "researchTracks": [
            {
                "key": f"r{idx}",
                "name": f"Track {idx}",
                "question": "Question",
                "sourcesToFind": ["paper"],
                "falsificationChecks": ["check"],
                "expectedReportUse": "supporting_argument",
            }
            for idx in range(1, 7)
        ],
    }

    monkeypatch.setattr(bridge, "_chatgpt_preflight", fake_preflight)
    monkeypatch.setattr(bridge, "_run_operator_with_cooldown_retry", lambda *args, **kwargs: FakeProc())
    monkeypatch.setattr(
        bridge,
        "_load_chatgpt_result",
        lambda task_dir: (structured, json.dumps(structured), {"provider": "chatgpt_browser"}),
    )

    result = bridge.handle(_request("BrowserLeaderPlanner"))

    assert result["status"] == "succeeded"
    assert result["metrics"]["provider"] == "chatgpt_browser"
    task_dir = tmp_path / "run" / "mission-test" / "s2-leader-plan-test-key"
    assert json.loads((task_dir / "provider-router.json").read_text(encoding="utf-8"))["provider"] == "chatgpt_browser"
    assert (task_dir / "chatgpt-preflight.json").exists()
    assert not (task_dir / "chatgpt-browser-agent-result.json").exists()


def test_deep_insight_solar_leader_planner_retries_short_browser_output(
    tmp_path: Path,
    monkeypatch,
) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT", str(tmp_path / "run"))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_LEADER_PLANNER", "chatgpt_browser")
    bridge.RUN_ROOT = tmp_path / "run"
    monkeypatch.setattr(bridge, "_chatgpt_preflight", lambda *args, **kwargs: {"ok": True})

    calls: list[dict] = []
    task_dirs: list[Path] = []

    def fake_run_operator(script: Path, envelope: dict, task_dir: Path):
        calls.append(envelope)
        task_dirs.append(task_dir)
        if len(calls) == 1:
            request_dir = task_dir / "chatgpt-browser-agent-request"
            request_dir.mkdir(parents=True, exist_ok=True)
            (request_dir / "assistant-response.txt").write_text("我会先研究，再返回 JSON。", encoding="utf-8")
            return subprocess.CompletedProcess(
                [str(script)],
                1,
                "",
                "ChatGPT browser-agent captured incomplete output while generation was still active: "
                "chars=12 min_output_chars=1200",
            )
        return subprocess.CompletedProcess([str(script)], 0, "", "")

    structured = {
        "centralQuestion": "What is the durable technical control point?",
        "researchTracks": [
            {
                "key": f"r{idx}",
                "name": f"Track {idx}",
                "question": "Question",
                "sourcesToFind": ["paper"],
                "falsificationChecks": ["check"],
                "expectedReportUse": "supporting_argument",
            }
            for idx in range(1, 7)
        ],
    }

    monkeypatch.setattr(bridge, "_run_operator_with_cooldown_retry", fake_run_operator)
    monkeypatch.setattr(
        bridge,
        "_load_chatgpt_result",
        lambda task_dir: (structured, json.dumps(structured), {"provider": "chatgpt_browser"}),
    )

    result = bridge.handle(_request("BrowserLeaderPlanner"))

    assert result["status"] == "succeeded"
    assert len(calls) == 2
    retry_request = calls[1]["chatgpt_browser_agent_request"]
    assert retry_request["request_dir"].endswith("chatgpt-browser-agent-request-retry-1")
    assert "Repair required" in retry_request["prompt"]
    task_dir = tmp_path / "run" / "mission-test" / "s2-leader-plan-test-key"
    retry_note = json.loads((task_dir / "chatgpt-browser-agent-json-repair-retry.json").read_text(encoding="utf-8"))
    assert retry_note["operatorId"] == "BrowserLeaderPlanner"


def test_deep_insight_solar_leader_planner_retries_generating_without_output(
    tmp_path: Path,
    monkeypatch,
) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT", str(tmp_path / "run"))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_LEADER_PLANNER", "chatgpt_browser")
    bridge.RUN_ROOT = tmp_path / "run"
    monkeypatch.setattr(bridge, "_chatgpt_preflight", lambda *args, **kwargs: {"ok": True})

    calls: list[dict] = []

    def fake_run_operator(script: Path, envelope: dict, task_dir: Path):
        calls.append(envelope)
        if len(calls) == 1:
            return subprocess.CompletedProcess(
                [str(script)],
                124,
                "",
                "chatgpt_wrapper_completion_signal_timed_out: generating_without_output",
            )
        return subprocess.CompletedProcess([str(script)], 0, "", "")

    structured = {
        "centralQuestion": "What is the durable technical control point?",
        "researchTracks": [
            {
                "key": f"r{idx}",
                "name": f"Track {idx}",
                "question": "Question",
                "sourcesToFind": ["paper"],
                "falsificationChecks": ["check"],
                "expectedReportUse": "supporting_argument",
            }
            for idx in range(1, 7)
        ],
    }

    monkeypatch.setattr(bridge, "_run_operator_with_cooldown_retry", fake_run_operator)
    monkeypatch.setattr(
        bridge,
        "_load_chatgpt_result",
        lambda task_dir: (structured, json.dumps(structured), {"provider": "chatgpt_browser"}),
    )

    result = bridge.handle(_request("BrowserLeaderPlanner"))

    assert result["status"] == "succeeded"
    assert len(calls) == 2
    assert calls[1]["chatgpt_browser_agent_request"]["request_dir"].endswith(
        "chatgpt-browser-agent-request-retry-1"
    )


def test_deep_insight_solar_leader_planner_retries_submitted_without_generation_signal(
    tmp_path: Path,
    monkeypatch,
) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT", str(tmp_path / "run"))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_LEADER_PLANNER", "chatgpt_browser")
    bridge.RUN_ROOT = tmp_path / "run"
    monkeypatch.setattr(bridge, "_chatgpt_preflight", lambda *args, **kwargs: {"ok": True})

    calls: list[dict] = []

    def fake_run_operator(script: Path, envelope: dict, task_dir: Path):
        calls.append(envelope)
        if len(calls) == 1:
            request_dir = task_dir / "chatgpt-browser-agent-request"
            request_dir.mkdir(parents=True, exist_ok=True)
            (request_dir / "completion-signal.json").write_text(
                json.dumps(
                    {
                        "schema": "browser_agent_completion_signal.v1",
                        "status": "blocked",
                        "reason": "submitted_without_generation",
                        "login_wall": False,
                        "challenge_wall": False,
                        "assistant_count": 0,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (request_dir / "wrapper-error.json").write_text(
                json.dumps({"error": "chatgpt_submitted_without_generation"}, ensure_ascii=False),
                encoding="utf-8",
            )
            return subprocess.CompletedProcess([str(script)], 1, "", "")
        return subprocess.CompletedProcess([str(script)], 0, "", "")

    structured = {
        "centralQuestion": "What is the durable technical control point?",
        "researchTracks": [
            {
                "key": f"r{idx}",
                "name": f"Track {idx}",
                "question": "Question",
                "sourcesToFind": ["paper"],
                "falsificationChecks": ["check"],
                "expectedReportUse": "supporting_argument",
            }
            for idx in range(1, 7)
        ],
    }

    monkeypatch.setattr(bridge, "_run_operator_with_cooldown_retry", fake_run_operator)
    monkeypatch.setattr(
        bridge,
        "_load_chatgpt_result",
        lambda task_dir: (structured, json.dumps(structured), {"provider": "chatgpt_browser"}),
    )

    result = bridge.handle(_request("BrowserLeaderPlanner"))

    assert result["status"] == "succeeded"
    assert len(calls) == 2
    assert calls[1]["chatgpt_browser_agent_request"]["request_dir"].endswith(
        "chatgpt-browser-agent-request-retry-1"
    )
    retry_note = json.loads(
        (
            tmp_path
            / "run"
            / "mission-test"
            / "s2-leader-plan-test-key"
            / "chatgpt-browser-agent-json-repair-retry.json"
        ).read_text(encoding="utf-8")
    )
    assert retry_note["retryMode"] == "leader_planner_fresh_session_after_no_generation"
    assert retry_note["reason"] == "submitted_without_generation"


def test_deep_insight_solar_writer_retries_submitted_without_generation_signal(
    tmp_path: Path,
    monkeypatch,
) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT", str(tmp_path / "run"))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_LONGFORM_WRITER", "chatgpt_browser")
    bridge.RUN_ROOT = tmp_path / "run"
    monkeypatch.setattr(bridge, "_chatgpt_preflight", lambda *args, **kwargs: {"ok": True})

    request = _request("BrowserLongformWriter")
    request["stepId"] = "s8-writer"
    request["payload"] = {"writerBrief": {"workingTitle": "Sakana Fugu 与 OpenRouter 深度解读"}}
    task_root = tmp_path / "run" / "mission-test" / "s8-writer-test-key"
    (task_root / "writer-retry-1").mkdir(parents=True)
    (task_root / "chatgpt-browser-agent-request-retry-1").mkdir(parents=True)
    calls: list[dict] = []
    task_dirs: list[Path] = []

    def fake_run_operator(script: Path, envelope: dict, task_dir: Path):
        calls.append(envelope)
        task_dirs.append(task_dir)
        if len(calls) == 1:
            request_dir = task_dir / "chatgpt-browser-agent-request"
            request_dir.mkdir(parents=True, exist_ok=True)
            (request_dir / "completion-signal.json").write_text(
                json.dumps(
                    {
                        "schema": "browser_agent_completion_signal.v1",
                        "status": "blocked",
                        "reason": "submitted_without_generation",
                        "login_wall": False,
                        "challenge_wall": False,
                        "assistant_count": 0,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            return subprocess.CompletedProcess([str(script)], 1, "", "")
        return subprocess.CompletedProcess([str(script)], 0, "", "")

    section = (
        "## 需求理解：本次分析要回答什么\n\n"
        "这次报告需要把 Sakana Fugu 与 OpenRouter 放在模型供给、路由市场、开发者分发和推理成本结构中解释。\n\n"
        "## 内容规划：如何展开这份洞察\n\n"
        "分析会先拆技术对象，再看生态位置、商业接口、投资热度和风险约束。\n\n"
        "## 分步骤洞察\n\n"
        "第一步看模型能力与发布策略，第二步看路由网络如何改变模型选择，第三步看开发者入口如何形成市场势能。\n\n"
        "## 综合判断与行动建议\n\n"
        "后续应跟踪开发者采用、价格变化、模型上架节奏和企业集成深度。\n\n"
    )
    structured = {
        "title": "Sakana Fugu 与 OpenRouter 深度解读",
        "executiveBriefMarkdown": "面向外部读者的摘要。",
        "standardReportMarkdown": section * 45,
        "references": [],
    }

    monkeypatch.setattr(bridge, "_run_operator_with_cooldown_retry", fake_run_operator)
    monkeypatch.setattr(
        bridge,
        "_load_chatgpt_result",
        lambda task_dir: (structured, json.dumps(structured, ensure_ascii=False), {"provider": "chatgpt_browser"}),
    )

    result = bridge.handle(request)

    assert result["status"] == "succeeded"
    assert len(calls) == 2
    assert calls[1]["chatgpt_browser_agent_request"]["request_dir"].endswith(
        "chatgpt-browser-agent-request-retry-1-2"
    )
    assert task_dirs[1].name == "writer-retry-1-2"
    retry_note = json.loads(
        (
            tmp_path
            / "run"
            / "mission-test"
            / "s8-writer-test-key"
            / "chatgpt-browser-agent-json-repair-retry.json"
        ).read_text(encoding="utf-8")
    )
    assert retry_note["retryMode"] == "writer_fresh_session_after_no_generation"
    assert retry_note["reason"] == "submitted_without_generation"


def test_deep_insight_solar_writer_recovers_public_language_leak_locally(
    tmp_path: Path,
    monkeypatch,
) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT", str(tmp_path / "run"))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_LONGFORM_WRITER", "chatgpt_browser")
    bridge.RUN_ROOT = tmp_path / "run"
    monkeypatch.setattr(bridge, "_chatgpt_preflight", lambda *args, **kwargs: {"ok": True})

    request = _request("BrowserLongformWriter")
    request["stepId"] = "s8-writer"
    request["payload"] = {"writerBrief": {"workingTitle": "Neo Labs 技术方向与投资谱系"}}
    calls: list[dict] = []

    def fake_run_operator(script: Path, envelope: dict, task_dir: Path):
        calls.append(envelope)
        return subprocess.CompletedProcess([str(script)], 0, "", "")

    bad_structured = {
        "title": "Neo Labs 技术方向与投资谱系",
        "executiveBriefMarkdown": "面向外部读者的摘要。",
        "standardReportMarkdown": (
            "## 需求理解：本次分析要回答什么\n\n"
            "Neo Labs 的投资判断不能越过证据边界，这句话会暴露后台审稿口吻。\n\n"
            "技术团队不应把两个路线作为互斥选项。\n\n"
        )
        * 120,
        "references": [],
    }
    def fake_load_result(task_dir: Path):
        return bad_structured, json.dumps(bad_structured, ensure_ascii=False), {"provider": "chatgpt_browser"}

    monkeypatch.setattr(bridge, "_run_operator_with_cooldown_retry", fake_run_operator)
    monkeypatch.setattr(bridge, "_load_chatgpt_result", fake_load_result)

    result = bridge.handle(request)

    assert result["status"] == "succeeded"
    assert len(calls) == 1
    assert result["metrics"]["publicLanguageRecovered"] is True
    assert "证据边界" not in result["structured"]["standardReportMarkdown"]
    assert "不应把" not in result["structured"]["standardReportMarkdown"]
    assert "公开证据能够支持的范围" in result["structured"]["standardReportMarkdown"]
    task_dir = tmp_path / "run" / "mission-test" / "s8-writer-test-key"
    recovery_note = json.loads(
        (task_dir / "chatgpt-browser-agent-public-language-recovery.json").read_text(encoding="utf-8")
    )
    assert recovery_note["operatorId"] == "BrowserLongformWriter"


def test_deep_insight_solar_writer_reuses_completed_public_language_artifact(
    tmp_path: Path,
    monkeypatch,
) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT", str(tmp_path / "run"))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_LONGFORM_WRITER", "chatgpt_browser")
    bridge.RUN_ROOT = tmp_path / "run"

    request = _request("BrowserLongformWriter")
    request["stepId"] = "s8-writer"
    request["payload"] = {"writerBrief": {"workingTitle": "Sakana Fugu 与 OpenRouter 深度解读"}}
    task_dir = tmp_path / "run" / "mission-test" / "s8-writer-test-key"
    completed_dir = task_dir / "writer-retry-1-3"
    completed_dir.mkdir(parents=True)
    structured = {
        "title": "Sakana Fugu 与 OpenRouter 深度解读",
        "executiveBriefMarkdown": "面向外部读者的摘要。",
        "standardReportMarkdown": (
            "## 需求理解：本次分析要回答什么\n\n"
            "Sakana Fugu 和 OpenRouter 的证据边界不同，前者体现模型生产方法，后者体现开发者分发入口。\n\n"
            "技术团队不应把两个路线作为互斥选项。\n\n"
        )
        * 120,
        "references": [],
    }
    (completed_dir / "chatgpt-browser-agent-result.json").write_text(
        json.dumps(
            {
                "ok": True,
                "model": "chatgpt-5.5",
                "request_dir": str(task_dir / "chatgpt-browser-agent-request-retry-1-3"),
                "text": json.dumps(structured, ensure_ascii=False),
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    def fail_run_operator(*args, **kwargs):
        raise AssertionError("completed S8 artifact should be reused before browser retry")

    monkeypatch.setattr(bridge, "_run_operator_with_cooldown_retry", fail_run_operator)

    result = bridge.handle(request)

    assert result["status"] == "succeeded"
    assert result["metrics"]["reusedCompletedArtifact"] is True
    assert result["metrics"]["publicLanguageRecovered"] is True
    assert "证据边界" not in result["structured"]["standardReportMarkdown"]
    assert "不应把" not in result["structured"]["standardReportMarkdown"]
    assert (task_dir / "chatgpt-browser-agent-result.reused.json").exists()


def test_deep_insight_solar_loads_completed_response_when_result_artifact_races(
    tmp_path: Path,
    monkeypatch,
) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_RESULT_ARTIFACT_WAIT_SECONDS", "0")
    task_dir = tmp_path / "mission" / "s2"
    request_dir = task_dir / "chatgpt-browser-agent-request"
    request_dir.mkdir(parents=True)
    payload = {
        "centralQuestion": "What is the control point?",
        "researchTracks": [
            {
                "key": f"r{idx}",
                "name": f"Track {idx}",
                "question": "Question",
                "sourcesToFind": ["paper"],
                "falsificationChecks": ["check"],
                "expectedReportUse": "supporting",
            }
            for idx in range(1, 7)
        ],
    }
    (request_dir / "assistant-response.txt").write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )
    (request_dir / "completion-signal.json").write_text(
        json.dumps({"status": "completed", "model": "chatgpt-5.5"}, ensure_ascii=False),
        encoding="utf-8",
    )

    structured, text, metrics = bridge._load_chatgpt_result(task_dir)

    assert structured["centralQuestion"] == "What is the control point?"
    assert '"researchTracks"' in text
    assert metrics["recovered"] is True
    assert (task_dir / "chatgpt-browser-agent-result.recovered.json").exists()


def test_deep_insight_solar_does_not_recover_unfinished_response_artifact(
    tmp_path: Path,
    monkeypatch,
) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_RESULT_ARTIFACT_WAIT_SECONDS", "0")
    task_dir = tmp_path / "mission" / "s2"
    request_dir = task_dir / "chatgpt-browser-agent-request"
    request_dir.mkdir(parents=True)
    (request_dir / "assistant-response.txt").write_text('{"centralQuestion":"partial"}', encoding="utf-8")
    (request_dir / "completion-signal.json").write_text(
        json.dumps({"status": "generating"}, ensure_ascii=False),
        encoding="utf-8",
    )

    try:
        bridge._load_chatgpt_result(task_dir)
    except RuntimeError as exc:
        assert "missing chatgpt result artifact" in str(exc)
    else:
        raise AssertionError("unfinished completion signal must not be recovered")


def test_deep_insight_solar_does_not_recover_completed_non_json_response(
    tmp_path: Path,
    monkeypatch,
) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_RESULT_ARTIFACT_WAIT_SECONDS", "0")
    task_dir = tmp_path / "mission" / "s2"
    request_dir = task_dir / "chatgpt-browser-agent-request"
    request_dir.mkdir(parents=True)
    (request_dir / "assistant-response.txt").write_text(
        "我会先把 Neo Labs 作为待界定对象，验证实体边界后再规划。",
        encoding="utf-8",
    )
    (request_dir / "completion-signal.json").write_text(
        json.dumps({"status": "completed", "model": "chatgpt-5.5"}, ensure_ascii=False),
        encoding="utf-8",
    )

    try:
        bridge._load_chatgpt_result(task_dir)
    except RuntimeError as exc:
        assert "missing chatgpt result artifact" in str(exc)
    else:
        raise AssertionError("completed non-json response must not be recovered")


def test_deep_insight_solar_chatgpt_browser_provider_runs_auth_preflight_without_env_allow(
    tmp_path: Path,
    monkeypatch,
) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT", str(tmp_path / "run"))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_RESEARCHER", "chatgpt_browser")
    bridge.RUN_ROOT = tmp_path / "run"

    def fake_preflight(request: dict, **kwargs):
        raise bridge.AuthRepairRequired("auth_repair_required_test")

    monkeypatch.setattr(bridge, "_chatgpt_preflight", fake_preflight)

    result = bridge.handle(_request("BrowserResearcher"))

    assert result["status"] == "failed"
    assert result["error"]["code"] == "AUTH_REPAIR_REQUIRED"
    task_dir = tmp_path / "run" / "mission-test" / "s2-leader-plan-test-key"
    assert json.loads((task_dir / "provider-router.json").read_text(encoding="utf-8"))["provider"] == "chatgpt_browser"
    assert json.loads((task_dir / "genesis-solar-operator-result.json").read_text(encoding="utf-8"))["error"][
        "code"
    ] == "AUTH_REPAIR_REQUIRED"
    assert (task_dir / "chatgpt-preflight.json").exists()
    assert not (task_dir / "operator-envelope.json").exists()


def test_deep_insight_solar_leader_planner_compacts_prompt_payload(monkeypatch) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PLANNER_TOPIC_MAX_CHARS", "80")
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PLANNER_DESCRIPTION_MAX_CHARS", "40")
    request = _request("BrowserLeaderPlanner")
    long_topic = "Ion Stoica " + ("paper list " * 80)
    request["topic"] = long_topic
    request["payload"] = {
        "topic": long_topic,
        "description": "description " * 20,
        "priorPostmortems": [
            {
                "missionId": "m1",
                "summary": "summary " * 300,
                "recommendations": ["recommendation " * 80],
                "rawLargeField": "x" * 10000,
            }
        ],
    }

    envelope = bridge._chatgpt_envelope(request)
    chatgpt_request = envelope["chatgpt_browser_agent_request"]
    prompt = chatgpt_request["prompt"]

    assert chatgpt_request["reasoning_effort"] == "medium"
    assert len(prompt) < 6500
    assert "rawLargeField" not in prompt
    assert "...[truncated for planner budget]..." in prompt


def test_deep_insight_solar_leader_planner_drops_non_actionable_postmortems() -> None:
    bridge = _load_bridge_module()
    request = _request("BrowserLeaderPlanner")
    request["payload"] = {
        "description": "Neo Labs smoke",
        "priorPostmortems": [
            {
                "missionId": "m-noise",
                "qualityScore": None,
                "leaderSigned": False,
                "summary": "失败模式：unknown\n- 本次 mission 健康（null/100），可作为同主题的 baseline reference",
                "recommendations": ["本次 mission 健康（null/100），可作为同主题的 baseline reference"],
            },
            {
                "missionId": "m-actionable",
                "qualityScore": 42,
                "leaderSigned": False,
                "summary": "S2 returned too few research tracks.",
                "recommendations": ["Require at least six research tracks."],
            },
        ],
    }

    prompt = bridge._chatgpt_envelope(request)["chatgpt_browser_agent_request"]["prompt"]

    assert "m-noise" not in prompt
    assert "健康（null/100）" not in prompt
    assert "m-actionable" in prompt
    assert "Require at least six research tracks." in prompt


def test_deep_insight_solar_non_planner_keeps_high_reasoning_effort() -> None:
    bridge = _load_bridge_module()
    envelope = bridge._chatgpt_envelope(_request("BrowserAnalyst"))
    request = envelope["chatgpt_browser_agent_request"]
    assert request["reasoning_effort"] == "high"


def test_deep_insight_solar_critic_prompt_compacts_large_payload(monkeypatch) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_CRITIC_REPORT_MAX_CHARS", "1800")
    request = _request("BrowserCritic")
    request["payload"] = {
        "artifactSummary": {
            "title": "Neo Labs",
            "executiveSummary": "summary " * 1000,
            "sectionTitles": [f"section-{idx}" for idx in range(80)],
        },
        "technologyInsightPlan": {
            "centralQuestion": "question " * 1000,
            "workstreams": [{"id": f"ws-{idx}", "name": "stream " * 20} for idx in range(80)],
        },
        "researchAssetLedger": {
            "sourceCount": 120,
            "assetTypeCounts": {"evidenceCard": 90},
            "assets": [
                {
                    "id": f"asset-{idx}",
                    "type": "evidenceCard",
                    "title": "asset title",
                    "summary": "asset summary " * 200,
                    "claim": "asset claim " * 200,
                    "evidenceIds": [f"ev-{idx}"],
                }
                for idx in range(200)
            ],
            "evidenceCards": [
                {
                    "id": f"ev-{idx}",
                    "title": "evidence title",
                    "claim": "evidence claim " * 200,
                    "evidence": "evidence body " * 200,
                    "sourceUrl": "https://example.com",
                }
                for idx in range(200)
            ],
        },
        "thesisGraph": {
            "theses": [
                {
                    "id": f"thesis-{idx}",
                    "statement": "statement " * 200,
                    "mechanism": "mechanism " * 200,
                    "evidenceIds": [f"ev-{idx}"],
                }
                for idx in range(60)
            ],
            "evidenceBindings": [
                {"thesisId": f"thesis-{idx}", "evidenceId": f"ev-{idx}", "role": "support"}
                for idx in range(200)
            ],
        },
        "reportPackage": {
            "executiveBriefMarkdown": "exec " * 2000,
            "standardReportMarkdown": "report " * 50000,
            "evidenceBook": {
                "assets": [{"id": f"a-{idx}", "type": "evidenceCard", "title": "asset"} for idx in range(200)],
                "thesisBindings": [
                    {"thesisId": f"t-{idx}", "evidenceIds": [f"e-{idx}"], "assetIds": [f"a-{idx}"]}
                    for idx in range(200)
                ],
            },
        },
    }

    prompt = bridge._chatgpt_envelope(request)["chatgpt_browser_agent_request"]["prompt"]

    assert len(prompt) < 120000
    assert "...[truncated for planner budget]..." in prompt
    assert "report " * 1000 not in prompt


def test_deep_insight_solar_researcher_prompt_uses_research_memo_voice_and_tuned_success_cooldown() -> None:
    bridge = _load_bridge_module()
    request = _request("BrowserResearcher")
    request["payload"] = {
        "dimension": {"name": "推理服务与资源调度", "rationale": "系统调度维度"}
    }

    envelope = bridge._chatgpt_envelope(request)
    prompt = envelope["chatgpt_browser_agent_request"]["prompt"]

    assert envelope["chatgpt_success_cooldown_seconds"] == 600
    assert "Return one valid JSON object matching the requested schema." in prompt
    assert "像已经发表的研究分析" in prompt
    assert "source-grounded notes for synthesis" in prompt
    assert "sourceNotes" in prompt


def test_deep_insight_solar_chatgpt_success_cooldowns_are_operator_specific() -> None:
    bridge = _load_bridge_module()

    assert bridge._chatgpt_envelope(_request("BrowserLeaderPlanner"))["chatgpt_success_cooldown_seconds"] == 180
    assert bridge._chatgpt_envelope(_request("BrowserResearcher"))["chatgpt_success_cooldown_seconds"] == 600
    assert bridge._chatgpt_envelope(_request("BrowserAnalyst"))["chatgpt_success_cooldown_seconds"] == 420
    assert bridge._chatgpt_envelope(_request("BrowserLongformWriter"))["chatgpt_success_cooldown_seconds"] == 600
    assert bridge._chatgpt_envelope(_request("BrowserCritic"))["chatgpt_success_cooldown_seconds"] == 300


def test_deep_insight_solar_parses_chatgpt_json_with_raw_newlines_inside_strings() -> None:
    bridge = _load_bridge_module()
    raw = (
        '{"dimension":"D05 推理服务","summary":"ok","findings":[{'
        '"claim":"Foundry reframes cold start.",'
        '"evidence":"source title has a raw newline -> Foundry\n: Template-Based CUDA Graph.",'
        '"source":"https://arxiv.org/abs/2604.06664",'
        '"sourceTitle":"Foundry\n: Template-Based CUDA Graph"}]}'
    )

    parsed = bridge._parse_chatgpt_json_or_raw(raw)

    assert parsed["dimension"] == "D05 推理服务"
    assert parsed["findings"][0]["source"] == "https://arxiv.org/abs/2604.06664"
    assert "Foundry\n:" in parsed["findings"][0]["sourceTitle"]


def test_deep_insight_solar_researcher_body_uses_source_notes_and_observations() -> None:
    bridge = _load_bridge_module()
    structured = {
        "track": {
            "key": "r1",
            "name": "实体消歧与研究边界",
            "question": "Neo Labs 是否是单一公司还是投资谱系类别词？",
        },
        "sourceNotes": [
            {
                "key": f"s{idx}",
                "sourceTitle": f"Source {idx}",
                "url": f"https://example.com/source-{idx}",
                "relevantFact": "该来源提供了关于 Neo Labs 实体、人才网络、投资语境和技术边界的可核验证据。",
                "supportedClaim": "它支持将 Neo Labs 先拆分为同名公司、Ali Partovi 的 Neo 网络，以及研究型 AI lab 类别词。",
                "limitation": "该来源不能单独证明全部投资组合和技术路线，需要与其它来源交叉验证。",
                "confidence": "medium",
            }
            for idx in range(1, 5)
        ],
        "observations": [
            {
                "claim": "Neo Labs 的核心研究对象需要先做实体消歧，避免把应用型同名公司混入前沿 AI lab 谱系。",
                "mechanism": "同名实体、VC 人才网络和 neo-lab 类别词在公开材料中共享相似命名，但技术能力和投资含义不同。",
                "supportingSourceKeys": ["s1", "s2"],
                "counterpointOrLimit": "实体消歧不是最终结论，后续仍需落到技术方向与投资热点。",
                "reportUse": "lead_argument",
            },
            {
                "claim": "投资热点谱系应围绕人才来源、算力承诺、研究优先级和产品化路径建立，而不是只看公司名。",
                "mechanism": "前沿实验室人才外溢与巨额早期融资让 neo-lab 成为组织形态标签，技术路线需要按证据分类。",
                "supportingSourceKeys": ["s3", "s4"],
                "counterpointOrLimit": "媒体榜单和 VC 叙事可能放大概念热度，不能替代 primary evidence。",
                "reportUse": "supporting_argument",
            },
        ],
        "summaryForSynthesis": "短摘要。",
    }

    bridge._validate_chatgpt_structured_result("BrowserResearcher", structured, "")


def test_deep_insight_solar_rejects_public_report_internal_mapping_table() -> None:
    bridge = _load_bridge_module()
    bad_table = (
        "|---|---|---|---| | 相关材料：Neo Labs 应规范化为美国 AI neo-labs 谱系 "
        "| 相关材料、相关材料、相关材料、相关材料 | 同名实体排除、范畴归一、实体辨析 "
        "| counter-1、counter-2：精确同名实体不是美国 research-first AI lab |"
    )
    structured = {
        "executiveBriefMarkdown": "这是一份面向读者的执行摘要，说明技术方向与投资谱系。",
        "standardReportMarkdown": ("# Neo Labs\n\n" + bad_table + "\n\n") * 80,
        "evidenceBook": {"assets": [], "thesisBindings": []},
    }

    with pytest.raises(RuntimeError) as excinfo:
        bridge._validate_chatgpt_structured_result("BrowserLongformWriter", structured, "")

    assert "public_report_internal_jargon" in str(excinfo.value)


def test_deep_insight_solar_allows_public_technical_operator_term() -> None:
    bridge = _load_bridge_module()
    paragraph = (
        "## 需求理解：本次分析要回答什么\n\n"
        "Neo Labs 的推理基础设施判断应放在长上下文 serving、GPU 利用率、"
        "Kubernetes Operator、动态批处理和企业成本归因之间，而不是只看模型名。\n\n"
        "## 内容规划：如何展开这份洞察\n\n"
        "先区分主体边界，再拆解运行时、推理、安全评测和开发者分发，最后形成投资热点谱系。\n\n"
        "## 分步骤洞察\n\n"
        "第一步看运行时是否能控制副作用，第二步看推理系统是否能给出同条件 TCO，"
        "第三步看安全评测是否进入持续治理流程。\n\n"
        "## 综合判断与行动建议\n\n"
        "如果这些系统接口拥有复现数据、客户采用和清晰主体信息，相关叙事才可升级为基础设施候选公司。"
    )
    structured = {
        "title": "Neo Labs 技术方向与投资谱系",
        "executiveBriefMarkdown": "面向外部读者的摘要。",
        "standardReportMarkdown": paragraph * 45,
        "references": [],
    }

    bridge._validate_chatgpt_structured_result("BrowserLongformWriter", structured, "")


def test_deep_insight_solar_rejects_public_internal_field_shape() -> None:
    bridge = _load_bridge_module()
    structured = {
        "title": "Neo Labs 技术方向与投资谱系",
        "executiveBriefMarkdown": "面向外部读者的摘要。",
        "standardReportMarkdown": (
            "## 需求理解：本次分析要回答什么\n\n"
            "operator: BrowserLongformWriter 暴露了后台字段，不应该出现在外部汇报里。\n\n"
        )
        * 120,
        "references": [],
    }

    with pytest.raises(RuntimeError) as excinfo:
        bridge._validate_chatgpt_structured_result("BrowserLongformWriter", structured, "")

    assert "public_report_internal_jargon:internal_field_jargon" in str(excinfo.value)


def test_chatgpt_operator_passes_timeout_settings_to_wrapper(tmp_path: Path, monkeypatch) -> None:
    operator = _load_chatgpt_operator_module()
    wrapper = tmp_path / "fake_chatgpt_wrapper.py"
    wrapper.write_text(
        "import json, os, sys\n"
        "sys.stdin.read()\n"
        "print(json.dumps({\n"
        "  'timeout': os.environ.get('BROWSER_AGENT_CHATGPT_TIMEOUT'),\n"
        "  'ready': os.environ.get('BROWSER_AGENT_CHATGPT_READY_TIMEOUT'),\n"
        "  'new_chat': os.environ.get('BROWSER_AGENT_CHATGPT_NEW_CHAT_TIMEOUT')\n"
        "}, ensure_ascii=False))\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_CMD", f"{sys.executable} {wrapper}")
    monkeypatch.setattr(operator, "apply_profile_policy", lambda env, request: {"ok": True})

    result = operator.run_request(
        {
            "prompt": "timeout smoke",
            "timeout_seconds": 3600,
            "ready_timeout_seconds": 300,
            "new_chat_timeout_seconds": 180,
        },
        task_dir=tmp_path / "task",
    )

    env_snapshot = json.loads(result["text"])
    assert env_snapshot == {
        "timeout": "3600",
        "ready": "300",
        "new_chat": "180",
    }


def test_deep_insight_solar_login_hold_envelope_uses_preflight_action(monkeypatch) -> None:
    monkeypatch.delenv("GENESISPOD_SOLAR_CHATGPT_ACCOUNT_EMAIL", raising=False)
    monkeypatch.delenv("DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY", raising=False)
    bridge = _load_bridge_module()
    envelope = bridge._chatgpt_login_hold_envelope(
        _request("BrowserAnalyst"),
        policy_key=bridge.DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY,
    )
    request = envelope["chatgpt_browser_agent_request"]
    assert envelope["operator_id"] == "deep-insight-solar-auth-preflight"
    assert request["action"] == "login_hold"
    assert request["profile_policy_key"] == "deep_insight_solar"
    assert request["account_email"] == "lisihao@gmail.com"


def test_deep_insight_solar_run_operator_uses_genesispod_queue_dir(tmp_path: Path, monkeypatch) -> None:
    bridge = _load_bridge_module()
    queue_dir = tmp_path / "genesispod-queue"
    probe = tmp_path / "probe.py"
    env_out = tmp_path / "env.json"
    probe.write_text(
        "\n".join(
            [
                "import json, os",
                "payload = {",
                "  'queue_dir': os.environ.get('BROWSER_AGENT_QUEUE_DIR'),",
                "  'queue_script': os.environ.get('BROWSER_AGENT_QUEUE_SCRIPT'),",
                "  'task_dir': os.environ.get('TASK_DIR'),",
                "  'envelope': os.environ.get('SOLAR_OPERATOR_ENVELOPE_JSON'),",
                "}",
                f"open({str(env_out)!r}, 'w').write(json.dumps(payload))",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("GENESISPOD_BROWSER_AGENT_QUEUE_DIR", str(queue_dir))

    proc = bridge._run_operator(
        probe,
        {"operator_id": "deep-insight-solar-auth-preflight", "purpose": "deep-insight-solar-auth-preflight"},
        tmp_path / "task",
    )

    assert proc.returncode == 0, proc.stderr
    env_snapshot = json.loads(env_out.read_text(encoding="utf-8"))
    assert env_snapshot["queue_dir"] == str(queue_dir)
    assert env_snapshot["queue_script"].endswith("harness/scripts/browser_agent_queue.py")
    assert env_snapshot["task_dir"] == str(tmp_path / "task")
    assert env_snapshot["envelope"] == str(tmp_path / "task" / "operator-envelope.json")


def test_deep_insight_solar_profile_policy_key_selects_dedicated_policy(tmp_path: Path, monkeypatch) -> None:
    operator = _load_chatgpt_operator_module()
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
                    "deep_insight_solar": {
                        "expected_account_email": "lisihao@gmail.com",
                        "allowed_profiles": ["Profile 2"],
                        "allow_headless": False,
                        "force_headed": True,
                        "allow_default_profile": True,
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
    env: dict[str, str] = {}
    selected = operator.apply_profile_policy(
        env,
        {
            "purpose": "deep-insight-solar-BrowserAnalyst",
            "profile_policy_key": "deep_insight_solar",
        },
    )
    assert selected["policy_key"] == "deep_insight_solar"
    assert selected["selected_profile_directory"] == "Profile 2"
    assert selected["selected_account_email"] == "lisihao@gmail.com"
    assert env["BROWSER_AGENT_CHATGPT_PROFILE_POLICY_KEY"] == "deep_insight_solar"
    assert env["BROWSER_AGENT_PROFILE_DIRECTORY"] == "Profile 2"
    assert env["BROWSER_AGENT_TARGET_ACCOUNT_EMAIL"] == "lisihao@gmail.com"
    assert env["BROWSER_AGENT_HEADLESS"] == "false"


def test_deep_insight_solar_chatgpt_operator_ignores_inherited_default_profile(
    tmp_path: Path, monkeypatch
) -> None:
    operator = _load_chatgpt_operator_module()
    policy = tmp_path / "browser-agent-chatgpt-local.json"
    policy.write_text(
        json.dumps(
            {
                "version": 1,
                "policies": {
                    "default": {
                        "expected_account_email": "lisihao@gmail.com",
                        "allowed_profiles": ["Default"],
                    },
                    "deep_insight_solar": {
                        "expected_account_email": "lisihao@gmail.com",
                        "allowed_profiles": ["Profile 2"],
                        "allow_headless": False,
                        "force_headed": True,
                        "profile_strategy": "persistent",
                    },
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE", str(policy))
    env = {
        "BROWSER_AGENT_PROFILE_DIRECTORY": "Default",
        "BROWSER_AGENT_CHATGPT_ACCOUNT_EMAIL": "lisihao@gmail.com",
    }

    selected = operator.apply_profile_policy(
        env,
        {
            "purpose": "deep-insight-solar-auth-preflight",
            "profile_policy_key": "deep_insight_solar",
        },
    )

    assert selected["policy_key"] == "deep_insight_solar"
    assert selected["selected_profile_directory"] == "Profile 2"
    assert selected["explicit_profile_ignored"] == "Default"
    assert env["BROWSER_AGENT_PROFILE_DIRECTORY"] == "Profile 2"


def test_deep_insight_solar_preflight_policy_only_writes_cache(tmp_path: Path, monkeypatch) -> None:
    bridge = _load_bridge_module()
    policy = tmp_path / "browser-agent-chatgpt-local.json"
    policy.write_text(
        json.dumps(
            {
                "version": 1,
                "policies": {
                    "deep_insight_solar": {
                        "expected_account_email": "lisihao@gmail.com",
                        "allowed_profiles": ["Profile 2"],
                        "allow_headless": False,
                        "force_headed": True,
                        "profile_strategy": "persistent",
                        "refresh_profile_runtime_on_start": True,
                        "user_data_dir": "/Users/lisihao/Library/Application Support/Google/Chrome",
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE", str(policy))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT", str(tmp_path / "run"))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PREFLIGHT_BROWSER", "0")
    bridge.RUN_ROOT = tmp_path / "run"
    request = _request("BrowserAnalyst")
    result = bridge._chatgpt_preflight(
        request,
        policy_key=bridge.DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY,
        operator_id="deep-insight-solar-analyst",
        task_dir=tmp_path / "task",
    )
    assert result["ok"] is True
    assert result["status"] == "policy_checked"
    assert result["browser_check"]["enabled"] is False
    assert result["policy"]["selected_account_email"] == "lisihao@gmail.com"
    assert result["policy"]["selected_profile_directory"] == "Profile 2"
    assert (tmp_path / "run" / "mission-test" / "_preflight" / "chatgpt-auth-preflight.json").exists()


def test_deep_insight_solar_preflight_cache_requires_browser_login_when_enabled(monkeypatch) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PREFLIGHT_BROWSER", "1")
    cached = {
        "ok": True,
        "checked_at_epoch": time.time(),
        "browser_check": {"enabled": False},
    }

    assert bridge._preflight_cache_is_fresh(cached) is False


def test_deep_insight_solar_handle_returns_auth_repair_required_on_login_wall(
    tmp_path: Path,
    monkeypatch,
) -> None:
    bridge = _load_bridge_module()
    policy = tmp_path / "browser-agent-chatgpt-local.json"
    policy.write_text(
        json.dumps(
            {
                "version": 1,
                "policies": {
                    "deep_insight_solar": {
                        "expected_account_email": "lisihao@gmail.com",
                        "allowed_profiles": ["Profile 2"],
                        "allow_headless": False,
                        "force_headed": True,
                        "profile_strategy": "persistent",
                        "refresh_profile_runtime_on_start": True,
                        "user_data_dir": "/Users/lisihao/Library/Application Support/Google/Chrome",
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE", str(policy))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT", str(tmp_path / "run"))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PREFLIGHT_BROWSER", "1")
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_ANALYST", "chatgpt_browser")
    bridge.RUN_ROOT = tmp_path / "run"

    def fake_run_operator(script: Path, envelope: dict, task_dir: Path):
        request_dir = task_dir / "chatgpt-browser-agent-request"
        request_dir.mkdir(parents=True, exist_ok=True)
        (request_dir / "login-hold-state.json").write_text(
            json.dumps(
                {
                    "ok": False,
                    "state": {
                        "title": "ChatGPT",
                        "url": "https://chatgpt.com/",
                        "login_wall": True,
                        "challenge_wall": False,
                        "composer_ready": True,
                    },
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        (request_dir / "wrapper-meta.json").write_text(
            json.dumps(
                {
                    "policy_key": "deep_insight_solar",
                    "selected_profile_directory": "Profile 2",
                    "selected_account_email": "lisihao@gmail.com",
                    "staged_user_data_dir": str(tmp_path / "runtime-profile"),
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        return subprocess.CompletedProcess([str(script)], 124, "", "timeout waiting for login")

    monkeypatch.setattr(bridge, "_run_operator", fake_run_operator)

    result = bridge.handle(_request("BrowserAnalyst"))

    assert result["status"] == "failed"
    assert result["error"]["code"] == "AUTH_REPAIR_REQUIRED"
    assert result["error"]["retryable"] is False
    assert "login_wall=True" in result["error"]["message"]
    assert "chatgpt-browser-agent-request/login-hold-state.json" in result["error"]["message"]
    task_dir = tmp_path / "run" / "mission-test" / "s2-leader-plan-test-key"
    assert (task_dir / "chatgpt-preflight.json").exists()
    assert not (task_dir / "chatgpt-browser-agent-result.json").exists()


def test_deep_insight_solar_preflight_waits_through_short_flow_control_cooldown(
    tmp_path: Path,
    monkeypatch,
) -> None:
    bridge = _load_bridge_module()
    policy = tmp_path / "browser-agent-chatgpt-local.json"
    policy.write_text(
        json.dumps(
            {
                "version": 1,
                "policies": {
                    "deep_insight_solar": {
                        "expected_account_email": "lisihao@gmail.com",
                        "allowed_profiles": ["Profile 2"],
                        "allow_headless": False,
                        "force_headed": True,
                        "profile_strategy": "persistent",
                        "refresh_profile_runtime_on_start": True,
                        "user_data_dir": "/Users/lisihao/Library/Application Support/Google/Chrome",
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE", str(policy))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT", str(tmp_path / "run"))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PREFLIGHT_BROWSER", "1")
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PREFLIGHT_FLOW_CONTROL_WAIT_SECONDS", "10")
    bridge.RUN_ROOT = tmp_path / "run"
    monkeypatch.setattr(bridge.time, "sleep", lambda seconds: None)
    calls = {"count": 0}

    def fake_run_operator(script: Path, envelope: dict, task_dir: Path):
        calls["count"] += 1
        if calls["count"] == 1:
            until = (
                bridge.dt.datetime.now(bridge.dt.timezone.utc) + bridge.dt.timedelta(seconds=1)
            ).isoformat().replace("+00:00", "Z")
            return subprocess.CompletedProcess(
                [str(script)],
                1,
                "",
                "chatgpt_browser_agent_task_operator failed: "
                "FlowControlBlocked: operator deep-insight-solar-auth-preflight "
                f"blocked by flow control: state=cooldown until {until}",
            )
        request_dir = task_dir / "chatgpt-browser-agent-request"
        request_dir.mkdir(parents=True, exist_ok=True)
        (request_dir / "login-hold-state.json").write_text(
            json.dumps(
                {
                    "ok": True,
                    "state": {
                        "title": "ChatGPT",
                        "url": "https://chatgpt.com/",
                        "login_wall": False,
                        "challenge_wall": False,
                        "composer_ready": True,
                    },
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        return subprocess.CompletedProcess([str(script)], 0, "", "")

    monkeypatch.setattr(bridge, "_run_operator", fake_run_operator)

    result = bridge._chatgpt_preflight(
        _request("BrowserAnalyst"),
        policy_key=bridge.DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY,
        operator_id="deep-insight-solar-analyst",
        task_dir=tmp_path / "run" / "mission-test" / "s2-leader-plan-test-key",
    )

    assert result["status"] == "browser_login_verified"
    assert calls["count"] == 2
    assert result["browser_check"]["result"]["ok"] is True


def test_deep_insight_solar_handle_reports_retryable_flow_control_cooldown(
    tmp_path: Path,
    monkeypatch,
) -> None:
    bridge = _load_bridge_module()
    policy = tmp_path / "browser-agent-chatgpt-local.json"
    policy.write_text(
        json.dumps(
            {
                "version": 1,
                "policies": {
                    "deep_insight_solar": {
                        "expected_account_email": "lisihao@gmail.com",
                        "allowed_profiles": ["Profile 2"],
                        "allow_headless": False,
                        "force_headed": True,
                        "profile_strategy": "persistent",
                        "refresh_profile_runtime_on_start": True,
                        "user_data_dir": "/Users/lisihao/Library/Application Support/Google/Chrome",
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE", str(policy))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT", str(tmp_path / "run"))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PREFLIGHT_BROWSER", "1")
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PREFLIGHT_FLOW_CONTROL_WAIT_SECONDS", "0")
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_ANALYST", "chatgpt_browser")
    bridge.RUN_ROOT = tmp_path / "run"

    def fake_run_operator(script: Path, envelope: dict, task_dir: Path):
        until = (
            bridge.dt.datetime.now(bridge.dt.timezone.utc) + bridge.dt.timedelta(minutes=30)
        ).isoformat().replace("+00:00", "Z")
        return subprocess.CompletedProcess(
            [str(script)],
            1,
            "",
            "chatgpt_browser_agent_task_operator failed: "
            "FlowControlBlocked: operator deep-insight-solar-auth-preflight "
            f"blocked by flow control: state=cooldown until {until}",
        )

    monkeypatch.setattr(bridge, "_run_operator", fake_run_operator)

    result = bridge.handle(_request("BrowserAnalyst"))

    assert result["status"] == "failed"
    assert result["error"]["code"] == "FLOW_CONTROL_COOLDOWN"
    assert result["error"]["retryable"] is True
    assert "cooldown_until=" in result["error"]["message"]


def test_deep_insight_solar_handle_retries_main_chatgpt_flow_control_cooldown(
    tmp_path: Path,
    monkeypatch,
) -> None:
    bridge = _load_bridge_module()
    policy = tmp_path / "browser-agent-chatgpt-local.json"
    policy.write_text(
        json.dumps(
            {
                "version": 1,
                "policies": {
                    "deep_insight_solar": {
                        "expected_account_email": "lisihao@gmail.com",
                        "allowed_profiles": ["Profile 2"],
                        "allow_headless": False,
                        "force_headed": True,
                        "profile_strategy": "persistent",
                        "refresh_profile_runtime_on_start": True,
                        "user_data_dir": "/Users/lisihao/Library/Application Support/Google/Chrome",
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE", str(policy))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT", str(tmp_path / "run"))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PREFLIGHT_BROWSER", "1")
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_FLOW_CONTROL_WAIT_SECONDS", "10")
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_ANALYST", "chatgpt_browser")
    bridge.RUN_ROOT = tmp_path / "run"
    monkeypatch.setattr(bridge.time, "sleep", lambda seconds: None)
    calls = {"count": 0}

    def fake_run_operator(script: Path, envelope: dict, task_dir: Path):
        calls["count"] += 1
        if calls["count"] == 1:
            request_dir = task_dir / "chatgpt-browser-agent-request"
            request_dir.mkdir(parents=True, exist_ok=True)
            (request_dir / "login-hold-state.json").write_text(
                json.dumps(
                    {
                        "ok": True,
                        "state": {
                            "title": "ChatGPT",
                            "url": "https://chatgpt.com/",
                            "login_wall": False,
                            "challenge_wall": False,
                            "composer_ready": True,
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            return subprocess.CompletedProcess([str(script)], 0, "", "")
        if calls["count"] == 2:
            until = (
                bridge.dt.datetime.now(bridge.dt.timezone.utc) + bridge.dt.timedelta(seconds=1)
            ).isoformat().replace("+00:00", "Z")
            return subprocess.CompletedProcess(
                [str(script)],
                1,
                "",
                "chatgpt_browser_agent_task_operator failed: "
                "FlowControlBlocked: operator deep-insight-solar-analyst "
                f"blocked by flow control: state=cooldown until {until}",
            )
        structured = {
            "theses": [
                {
                    "id": "thesis-1",
                    "statement": "Analyst thesis after cooldown.",
                    "mechanism": "Recovered through cooldown retry.",
                    "evidenceIds": ["ev-1"],
                },
                {
                    "id": "thesis-2",
                    "statement": "Second thesis after cooldown.",
                    "mechanism": "Recovered through cooldown retry.",
                    "evidenceIds": ["ev-2"],
                },
            ],
            "reportOutline": [
                {"id": "sec-1", "heading": "Question", "thesisIds": ["thesis-1"]},
                {"id": "sec-2", "heading": "Mechanism", "thesisIds": ["thesis-1"]},
                {"id": "sec-3", "heading": "Implication", "thesisIds": ["thesis-2"]},
            ],
        }
        (task_dir / "chatgpt-browser-agent-result.json").write_text(
            json.dumps({"text": json.dumps(structured, ensure_ascii=False)}, ensure_ascii=False),
            encoding="utf-8",
        )
        return subprocess.CompletedProcess([str(script)], 0, "", "")

    monkeypatch.setattr(bridge, "_run_operator", fake_run_operator)

    result = bridge.handle(_request("BrowserAnalyst"))

    assert result["status"] == "succeeded"
    assert calls["count"] == 3
    assert result["structured"]["theses"][0]["statement"] == "Analyst thesis after cooldown."


def test_deep_insight_solar_bridge_rejects_shared_policy_without_runtime_refresh(
    tmp_path: Path, monkeypatch
) -> None:
    bridge = _load_bridge_module()
    policy = tmp_path / "browser-agent-chatgpt-local.json"
    policy.write_text(
        json.dumps(
            {
                "version": 1,
                "policies": {
                    "deep_insight_solar": {
                        "expected_account_email": "lisihao@gmail.com",
                        "allowed_profiles": ["Default"],
                        "allow_headless": False,
                        "force_headed": True,
                        "profile_strategy": "persistent",
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE", str(policy))

    try:
        bridge._policy_preflight(bridge.DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY)
    except RuntimeError as exc:
        message = str(exc)
    else:
        raise AssertionError("expected shared profile policy without runtime refresh to fail")

    assert "deep_insight_solar_profile_policy_mismatch" in message
    assert "expected_policy_key=deep_insight_solar" in message
    assert "refresh_profile_runtime_on_start=false" in message


def test_deep_insight_solar_bridge_allows_runtime_refresh_policy(
    tmp_path: Path, monkeypatch
) -> None:
    bridge = _load_bridge_module()
    policy = tmp_path / "browser-agent-chatgpt-local.json"
    policy.write_text(
        json.dumps(
            {
                "version": 1,
                "policies": {
                    "deep_insight_solar": {
                        "expected_account_email": "lisihao@gmail.com",
                        "allowed_profiles": ["Profile 2"],
                        "allow_headless": False,
                        "force_headed": True,
                        "profile_strategy": "persistent",
                        "refresh_profile_runtime_on_start": True,
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE", str(policy))

    result = bridge._policy_preflight(bridge.DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY)

    assert result["ok"] is True
    assert result["refresh_profile_runtime_on_start"] is True


def test_deep_insight_solar_handle_fails_closed_on_preflight_policy_mismatch(tmp_path: Path, monkeypatch) -> None:
    bridge = _load_bridge_module()
    policy = tmp_path / "browser-agent-chatgpt-local.json"
    policy.write_text(
        json.dumps(
            {
                "version": 1,
                "policies": {
                    "deep_insight_solar": {
                        "expected_account_email": "wrong@example.com",
                        "allowed_profiles": ["Default"],
                        "force_headed": True,
                        "profile_strategy": "persistent",
                        "refresh_profile_runtime_on_start": True,
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE", str(policy))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT", str(tmp_path / "run"))
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PREFLIGHT_BROWSER", "0")
    monkeypatch.setenv("DEEP_INSIGHT_SOLAR_PROVIDER_BROWSER_ANALYST", "chatgpt_browser")
    bridge.RUN_ROOT = tmp_path / "run"
    result = bridge.handle(_request("BrowserAnalyst"))
    assert result["status"] == "failed"
    assert result["error"]["code"] == "CHATGPT_PREFLIGHT_FAILED"
    assert "profile_policy_account_mismatch" in result["error"]["message"]
    task_dir = tmp_path / "run" / "mission-test" / "s2-leader-plan-test-key"
    assert (task_dir / "chatgpt-preflight.json").exists()
    assert not (task_dir / "operator-envelope.json").exists()


def test_deep_insight_solar_bridge_rejects_unknown_operator(tmp_path: Path) -> None:
    env = os.environ.copy()
    env["DEEP_INSIGHT_SOLAR_BRIDGE_DRY_RUN"] = "0"
    env["DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT"] = str(tmp_path)
    proc = subprocess.run(
        [sys.executable, str(BRIDGE)],
        input=json.dumps(_request("UnknownOperator")),
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )
    assert proc.returncode == 1
    result = json.loads(proc.stdout)
    assert result["status"] == "failed"
    assert result["error"]["code"] == "UNSUPPORTED_SOLAR_OPERATOR"
