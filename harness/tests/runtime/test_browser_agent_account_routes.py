from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_browser_agent_executable_routes_do_not_use_old_profile_defaults() -> None:
    paths = [
        *(ROOT / "scripts").glob("browser_agent_*wrapper.py"),
        ROOT / "scripts" / "youtube_influence_digest.py",
        ROOT / "scripts" / "tech_hotspot_radar.py",
        ROOT / "tools" / "gemini_deep_research_operator.py",
        ROOT / "tools" / "youtube_transcript_operator.py",
        ROOT / "tools" / "gpt_gemini_cleaner_operator.py",
        ROOT / "tools" / "chatgpt_browser_agent_task_operator.py",
        ROOT / "tools" / "chatgpt_report_operator.py",
        ROOT / "lib" / "social_browser_backend_x" / "real_browser_backend.py",
        ROOT / "config" / "physical-operators.json",
        ROOT / "config" / "physical-operators.example.json",
        ROOT / "config" / "operator_registry.json",
        ROOT / "config" / "operator_schedules.json",
        ROOT / "config" / "logical-operators.json",
        ROOT / "config" / "agent-actors.json",
    ]
    offenders: list[str] = []
    for path in paths:
        text = path.read_text(encoding="utf-8", errors="ignore")
        if 'DEFAULT_PROFILE_DIRECTORY = "Profile 1"' in text:
            offenders.append(f"{path}: DEFAULT_PROFILE_DIRECTORY")
        if "BROWSER_AGENT_PROFILE_DIRECTORY:-Profile 1" in text:
            offenders.append(f"{path}: env default Profile 1")
        if "browser-agent@example.com" in text:
            offenders.append(f"{path}: placeholder account")
    assert offenders == []


def test_gemini_deep_research_physical_operator_uses_canonical_adapter() -> None:
    payload = json.loads((ROOT / "config" / "physical-operators.json").read_text(encoding="utf-8"))
    operator = payload["operators"]["mini-gemini-deep-research"]

    assert operator["backend"] == "command"
    assert operator["command"] == 'python3 "$HARNESS_DIR/tools/gemini_deep_research_operator.py"'
    assert operator["max_concurrency"] == 1


def test_gemini_deep_research_adapter_uses_policy_driven_account_defaults() -> None:
    operator_text = (ROOT / "tools" / "gemini_deep_research_operator.py").read_text(encoding="utf-8")
    wrapper_text = (ROOT / "scripts" / "browser_agent_gemini_deep_research_wrapper.py").read_text(encoding="utf-8")

    assert 'DEFAULT_BROWSER_USE_PYTHON = Path.home() / ".claude" / "mcp-servers" / "browser-use" / ".venv" / "bin" / "python"' in operator_text
    assert 'env.setdefault("BROWSER_AGENT_PROFILE_DIRECTORY", "Default")' in operator_text
    assert 'env.setdefault("BROWSER_AGENT_GEMINI_ACCOUNT_EMAIL", account_email)' in operator_text
    assert "haogege1977@gmail.com" not in operator_text
    assert "DEFAULT_MIN_TIMEOUT_SECONDS = 1800" in operator_text
    assert 'DEFAULT_PROFILE_DIRECTORY = "Default"' in wrapper_text
    assert "haogege1977@gmail.com" not in wrapper_text
    assert "gemini_deep_research" in wrapper_text
    assert 'timeout_s = int(os.environ.get("BROWSER_AGENT_GEMINI_TIMEOUT") or "1800")' in wrapper_text
