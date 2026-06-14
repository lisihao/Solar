from __future__ import annotations

import json
import os
import sys

_HARNESS_LIB = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "lib")
if _HARNESS_LIB not in sys.path:
    sys.path.insert(0, _HARNESS_LIB)

from research.survey import backends


def test_browser_agent_writer_backend_calls_shared_operator(tmp_path, monkeypatch):
    section_dir = tmp_path / "sections" / "s1"
    prompt_dir = section_dir / "prompt_packets"
    prompt_dir.mkdir(parents=True)
    prompt_md = prompt_dir / "round_00.md"
    prompt_md.write_text("# Prompt Packet\n\nUse evidence only.\n", encoding="utf-8")
    calls = []

    def fake_run_chatgpt_browser_agent(prompt, **kwargs):
        calls.append({"prompt": prompt, **kwargs})
        return {
            "ok": True,
            "text": "## 本节判断\n\nBrowser agent section output.\n",
            "result_path": str(tmp_path / "result.json"),
        }

    monkeypatch.setattr(backends, "run_chatgpt_browser_agent", fake_run_chatgpt_browser_agent)
    backend = backends.get_writer_backend("browser-agent-chatgpt", timeout_seconds=1800)
    packet = {
        "section_id": "s1",
        "round_index": 0,
        "insight_mode": True,
        "artifact_paths": {
            "prompt_packet_md": str(prompt_md),
            "final": str(section_dir / "final.md"),
            "model_usage": str(tmp_path / "model_usage.jsonl"),
        },
    }

    output = backend.write(packet, "deterministic fallback")

    assert output.startswith("## 本节判断")
    assert len(calls) == 1
    assert calls[0]["purpose"] == "ai-influence-report-deepdive-section-s1"
    assert calls[0]["timeout_seconds"] == 1800
    assert "deterministic fallback" not in calls[0]["prompt"]
    rows = [
        json.loads(line)
        for line in (tmp_path / "model_usage.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert rows[0]["backend"] == "browser-agent-chatgpt"
