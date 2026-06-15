import json
import os
import subprocess
import sys
import importlib.util
from pathlib import Path


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
    assert result["structured"]["dimensions"][0]["id"] == "dry-d1"
    assert result["metrics"]["dryRun"] is True


def test_deep_insight_solar_bridge_sets_dedicated_chatgpt_profile_policy_key() -> None:
    bridge = _load_bridge_module()
    envelope = bridge._chatgpt_envelope(_request("BrowserAnalyst"))
    request = envelope["chatgpt_browser_agent_request"]
    assert envelope["purpose"] == "deep-insight-solar-BrowserAnalyst"
    assert request["profile_policy_key"] == "deep_insight_solar"
    assert request["account_email"] == "haogege1977@gmail.com"


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
    assert len(prompt) < 4000
    assert "rawLargeField" not in prompt
    assert "...[truncated for planner budget]..." in prompt


def test_deep_insight_solar_non_planner_keeps_high_reasoning_effort() -> None:
    bridge = _load_bridge_module()
    envelope = bridge._chatgpt_envelope(_request("BrowserAnalyst"))
    request = envelope["chatgpt_browser_agent_request"]
    assert request["reasoning_effort"] == "high"


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


def test_deep_insight_solar_login_hold_envelope_uses_preflight_action() -> None:
    bridge = _load_bridge_module()
    envelope = bridge._chatgpt_login_hold_envelope(
        _request("BrowserAnalyst"),
        policy_key="deep_insight_solar",
    )
    request = envelope["chatgpt_browser_agent_request"]
    assert envelope["operator_id"] == "deep-insight-solar-auth-preflight"
    assert request["action"] == "login_hold"
    assert request["profile_policy_key"] == "deep_insight_solar"
    assert request["account_email"] == "haogege1977@gmail.com"


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
                        "expected_account_email": "haogege1977@gmail.com",
                        "allowed_profiles": ["Default"],
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
    assert selected["selected_profile_directory"] == "Default"
    assert selected["selected_account_email"] == "haogege1977@gmail.com"
    assert env["BROWSER_AGENT_CHATGPT_PROFILE_POLICY_KEY"] == "deep_insight_solar"
    assert env["BROWSER_AGENT_PROFILE_DIRECTORY"] == "Default"
    assert env["BROWSER_AGENT_TARGET_ACCOUNT_EMAIL"] == "haogege1977@gmail.com"
    assert env["BROWSER_AGENT_HEADLESS"] == "false"


def test_deep_insight_solar_preflight_policy_only_writes_cache(tmp_path: Path, monkeypatch) -> None:
    bridge = _load_bridge_module()
    policy = tmp_path / "browser-agent-chatgpt-local.json"
    policy.write_text(
        json.dumps(
            {
                "version": 1,
                "policies": {
                    "deep_insight_solar": {
                        "expected_account_email": "haogege1977@gmail.com",
                        "allowed_profiles": ["Default"],
                        "allow_headless": False,
                        "force_headed": True,
                        "allow_default_profile": True,
                        "profile_strategy": "persistent",
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
        policy_key="deep_insight_solar",
        operator_id="deep-insight-solar-analyst",
        task_dir=tmp_path / "task",
    )
    assert result["ok"] is True
    assert result["status"] == "policy_checked"
    assert result["browser_check"]["enabled"] is False
    assert result["policy"]["selected_account_email"] == "haogege1977@gmail.com"
    assert result["policy"]["selected_profile_directory"] == "Default"
    assert (tmp_path / "run" / "mission-test" / "_preflight" / "chatgpt-auth-preflight.json").exists()


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
                        "allow_default_profile": True,
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
