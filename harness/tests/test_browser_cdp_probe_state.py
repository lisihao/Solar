from __future__ import annotations

import importlib.util
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "browser_cdp_probe.py"
spec = importlib.util.spec_from_file_location("browser_cdp_probe", SCRIPT)
probe = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(probe)


def test_classifies_thinking_only_stall() -> None:
    state = {
        "composer_ready": True,
        "generating": True,
        "latest_assistant_text": "已思考 8s",
        "message_count": 1,
        "assistant_count": 1,
    }
    assert probe.classify_chatgpt_snapshot(state)["status"] == "thinking_only_stall"


def test_classifies_result_present() -> None:
    state = {
        "composer_ready": True,
        "generating": False,
        "latest_assistant_text": "这是一个已经生成完成的回答。" * 12,
        "message_count": 2,
        "assistant_count": 1,
    }
    result = probe.classify_chatgpt_snapshot(state)
    assert result["status"] == "result_present"
    assert result["substantive_result"] is True


def test_classifies_login_and_challenge_before_ready() -> None:
    assert probe.classify_chatgpt_snapshot({"login_wall": True, "composer_ready": False})["status"] == "login_required"
    assert probe.classify_chatgpt_snapshot({"challenge_wall": True, "login_wall": True})["status"] == "challenge_wall"
