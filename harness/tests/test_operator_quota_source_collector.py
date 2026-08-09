from __future__ import annotations

import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "operator_quota_source_collector_under_test",
    ROOT / "tools" / "operator_quota_source_collector.py",
)
collector = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(collector)


def _patch_paths(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(collector, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(collector, "RUN_DIR", tmp_path / "run" / "operator-quota-source-collector")
    monkeypatch.setattr(collector, "LATEST_PATH", tmp_path / "run" / "operator-quota-source-collector" / "latest.json")
    monkeypatch.setattr(collector, "HISTORY_PATH", tmp_path / "run" / "operator-quota-source-collector" / "history.jsonl")
    monkeypatch.setattr(collector, "INBOX_DIR", tmp_path / "run" / "quota-evidence-inbox")
    monkeypatch.setattr(collector, "CONFIG_PATH", tmp_path / "config" / "operator-quota-sources.json")


def test_quota_source_collector_no_configured_sources_is_no_source(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    monkeypatch.delenv("SOLAR_CODEX_QUOTA_COMMAND", raising=False)
    monkeypatch.delenv("SOLAR_CLAUDE_QUOTA_COMMAND", raising=False)
    monkeypatch.delenv("SOLAR_CODEX_QUOTA_EVIDENCE_FILES", raising=False)
    monkeypatch.delenv("SOLAR_CLAUDE_QUOTA_EVIDENCE_FILES", raising=False)
    monkeypatch.delenv("SOLAR_QUOTA_SOURCE_COMMANDS_JSON", raising=False)

    payload = collector.run_scan(apply=True)

    assert payload["ok"] is True
    assert payload["configured_sources"] == 0
    assert payload["written"] == 0
    assert {item["status"] for item in payload["items"]} == {"no_source"}


def test_quota_source_collector_writes_configured_command_output(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    script = tmp_path / "spark-quota.sh"
    script.write_text(
        "#!/bin/sh\n"
        "printf '%s\\n' 'GPT-5.3-Codex-Spark 使用限额' '每周使用限制' '重置时间：6月24日' '剩余 0%'\n",
        encoding="utf-8",
    )
    script.chmod(0o755)
    monkeypatch.setenv("SOLAR_CODEX_QUOTA_COMMAND", str(script))
    monkeypatch.delenv("SOLAR_CLAUDE_QUOTA_COMMAND", raising=False)
    monkeypatch.delenv("SOLAR_CODEX_QUOTA_EVIDENCE_FILES", raising=False)
    monkeypatch.delenv("SOLAR_CLAUDE_QUOTA_EVIDENCE_FILES", raising=False)
    monkeypatch.delenv("SOLAR_QUOTA_SOURCE_COMMANDS_JSON", raising=False)

    payload = collector.run_scan(apply=True)

    assert payload["configured_sources"] == 1
    assert payload["written"] == 1
    inbox_files = sorted((tmp_path / "run" / "quota-evidence-inbox").glob("*.txt"))
    assert len(inbox_files) == 1
    assert "GPT-5.3-Codex-Spark" in inbox_files[0].read_text(encoding="utf-8")


def test_quota_source_collector_writes_configured_file_output(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    evidence = tmp_path / "claude-quota.txt"
    evidence.write_text("Claude Sonnet: You've hit your limit · resets 1:40pm\n", encoding="utf-8")
    monkeypatch.delenv("SOLAR_CODEX_QUOTA_COMMAND", raising=False)
    monkeypatch.delenv("SOLAR_CLAUDE_QUOTA_COMMAND", raising=False)
    monkeypatch.setenv("SOLAR_CLAUDE_QUOTA_EVIDENCE_FILES", str(evidence))
    monkeypatch.delenv("SOLAR_CODEX_QUOTA_EVIDENCE_FILES", raising=False)
    monkeypatch.delenv("SOLAR_QUOTA_SOURCE_COMMANDS_JSON", raising=False)

    payload = collector.run_scan(apply=True)

    assert payload["configured_sources"] == 1
    assert payload["written"] == 1
    inbox_files = sorted((tmp_path / "run" / "quota-evidence-inbox").glob("*.txt"))
    assert len(inbox_files) == 1
    assert "Claude Sonnet" in inbox_files[0].read_text(encoding="utf-8")


def test_quota_source_collector_loads_sources_from_config_file(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    evidence = tmp_path / "run" / "quota-evidence-manual" / "codex-ui.txt"
    evidence.parent.mkdir(parents=True)
    evidence.write_text(
        "GPT-5.3-Codex-Spark 使用限额\n每周使用限制\n重置时间：6月24日\n剩余 0%\n",
        encoding="utf-8",
    )
    config = tmp_path / "config" / "operator-quota-sources.json"
    config.parent.mkdir(parents=True)
    config.write_text(
        """
{
  "version": 1,
  "sources": [
    {"name": "codex", "files": ["run/quota-evidence-manual/codex-ui.txt"]}
  ]
}
""",
        encoding="utf-8",
    )
    monkeypatch.delenv("SOLAR_CODEX_QUOTA_COMMAND", raising=False)
    monkeypatch.delenv("SOLAR_CLAUDE_QUOTA_COMMAND", raising=False)
    monkeypatch.delenv("SOLAR_CODEX_QUOTA_EVIDENCE_FILES", raising=False)
    monkeypatch.delenv("SOLAR_CLAUDE_QUOTA_EVIDENCE_FILES", raising=False)
    monkeypatch.delenv("SOLAR_QUOTA_SOURCE_COMMANDS_JSON", raising=False)

    payload = collector.run_scan(apply=True)

    assert payload["config"]["loaded"] is True
    assert payload["configured_sources"] == 1
    assert payload["written"] == 1
    assert [item["source"] for item in payload["items"]] == ["codex"]


def test_quota_source_collector_extracts_codex_spark_session_rate_limits(tmp_path: Path, monkeypatch):
    _patch_paths(monkeypatch, tmp_path)
    session = tmp_path / "codex" / "sessions" / "spark.jsonl"
    session.parent.mkdir(parents=True)
    session.write_text(
        json.dumps(
            {
                "timestamp": "2026-06-20T21:30:57.641Z",
                "type": "event_msg",
                "payload": {
                    "rate_limits": {
                        "limit_id": "codex_bengalfox",
                        "limit_name": "GPT-5.3-Codex-Spark",
                        "primary": {"used_percent": 0.0, "window_minutes": 300, "resets_at": 1782009034},
                        "secondary": {"used_percent": 100.0, "window_minutes": 10080, "resets_at": 1782344557},
                    }
                },
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    config = tmp_path / "config" / "operator-quota-sources.json"
    config.parent.mkdir(parents=True)
    config.write_text(
        json.dumps(
            {
                "version": 1,
                "sources": [
                    {
                        "name": "codex-session-rate-limits",
                        "type": "codex_sessions",
                        "glob": str(tmp_path / "codex" / "sessions" / "*.jsonl"),
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.delenv("SOLAR_CODEX_QUOTA_COMMAND", raising=False)
    monkeypatch.delenv("SOLAR_CLAUDE_QUOTA_COMMAND", raising=False)
    monkeypatch.delenv("SOLAR_CODEX_QUOTA_EVIDENCE_FILES", raising=False)
    monkeypatch.delenv("SOLAR_CLAUDE_QUOTA_EVIDENCE_FILES", raising=False)
    monkeypatch.delenv("SOLAR_QUOTA_SOURCE_COMMANDS_JSON", raising=False)

    payload = collector.run_scan(apply=True)

    assert payload["configured_sources"] == 1
    assert payload["written"] == 1
    inbox_files = sorted((tmp_path / "run" / "quota-evidence-inbox").glob("*.txt"))
    assert len(inbox_files) == 1
    text = inbox_files[0].read_text(encoding="utf-8")
    assert "GPT-5.3-Codex-Spark 使用限额" in text
    assert "每周使用限制" in text
    assert "剩余 0%" in text
