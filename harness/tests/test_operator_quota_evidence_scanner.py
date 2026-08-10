from __future__ import annotations

import datetime as dt
import importlib.util
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "operator_quota_evidence_scanner_under_test",
    ROOT / "tools" / "operator_quota_evidence_scanner.py",
)
scanner = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(scanner)


def test_parse_spark_chinese_ui_weekly_zero_quota():
    now = dt.datetime(2026, 6, 19, 12, 0, tzinfo=dt.timezone.utc)
    text = """
GPT-5.3-Codex-Spark 使用限额
5 小时使用限额
重置时间：02:05
剩余 100%
每周使用限制
重置时间：6月24日
剩余 0%
"""

    observations = scanner.parse_quota_observations(text, now=now)

    assert len(observations) == 2
    assert observations[0]["model_key"] == "codex-gpt-5.3-spark"
    assert observations[0]["quota_window"] == "5h"
    assert observations[0]["remaining_percent"] == 100
    assert observations[1]["quota_window"] == "weekly"
    assert observations[1]["remaining_percent"] == 0
    assert observations[1]["reset_at"] == "2026-06-24T04:00:00Z"


def test_parse_spark_chinese_ui_weekly_recovered_quota():
    now = dt.datetime(2026, 6, 30, 12, 0, tzinfo=dt.timezone.utc)
    text = """
GPT-5.3-Codex-Spark 使用限额
observed_at: 2026-06-30T12:00:00Z
5 小时使用限额
重置时间：13:32
剩余 100%
每周使用限制
重置时间：7月7日
剩余 100%
"""

    observations = scanner.parse_quota_observations(text, now=now)

    assert len(observations) == 2
    assert observations[0]["quota_window"] == "5h"
    assert observations[0]["remaining_percent"] == 100
    assert observations[0]["observed_at"] == "2026-06-30T12:00:00Z"
    assert observations[1]["quota_window"] == "weekly"
    assert observations[1]["remaining_percent"] == 100
    assert observations[1]["reset_at"] == "2026-07-07T04:00:00Z"


def test_parse_limit_hit_without_percent_records_zero_with_reset():
    now = dt.datetime(2026, 6, 19, 12, 0, tzinfo=dt.timezone.utc)

    observations = scanner.parse_quota_observations(
        "Claude Sonnet: You've hit your limit · resets 1:40pm (America/Toronto)",
        now=now,
    )

    assert len(observations) == 1
    assert observations[0]["model_key"] == "claude-sonnet"
    assert observations[0]["remaining_percent"] == 0
    assert observations[0]["reset_at"].startswith("2026-06-19T17:40")


def test_run_scan_records_inbox_quota_observation(tmp_path: Path, monkeypatch):
    db_path = tmp_path / "operator-cooldowns.sqlite"
    inbox = tmp_path / "run" / "quota-evidence-inbox"
    inbox.mkdir(parents=True)
    (inbox / "spark.txt").write_text(
        "GPT-5.3-Codex-Spark 使用限额\n每周使用限制\n重置时间：6月24日\n剩余 0%\n",
        encoding="utf-8",
    )
    registry = tmp_path / "config" / "physical-operators.json"
    registry.parent.mkdir(parents=True)
    registry.write_text(
        """
{
  "operators": {
    "spark-1": {
      "provider": "openai",
      "model": "gpt-5.3-codex-spark",
      "key_ref": "codex_auth",
      "billing_pool": "codex_spark",
      "builder_pool": {"group": "codex-gpt-5.3-spark"}
    }
  }
}
""",
        encoding="utf-8",
    )
    monkeypatch.setattr(scanner.operator_cooldown_db, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(scanner, "INBOX_DIR", inbox)
    monkeypatch.setattr(scanner, "TUI_DIR", tmp_path / "run" / "tui-signals")
    monkeypatch.setattr(scanner, "RESULTS_DIR", tmp_path / "run" / "operator-results")
    monkeypatch.setattr(scanner, "REGISTRY_PATH", registry)
    monkeypatch.setattr(scanner, "RUN_DIR", tmp_path / "run" / "operator-quota-evidence-scanner")
    monkeypatch.setattr(scanner, "LATEST_PATH", tmp_path / "run" / "operator-quota-evidence-scanner" / "latest.json")
    monkeypatch.setattr(scanner, "HISTORY_PATH", tmp_path / "run" / "operator-quota-evidence-scanner" / "history.jsonl")
    monkeypatch.setattr(scanner, "SEEN_PATH", tmp_path / "run" / "operator-quota-evidence-scanner" / "seen.json")

    payload = scanner.run_scan(apply=True)

    assert payload["recorded"] == 1
    assert payload["recorded_active_blocks"] == 1
    block = scanner.operator_cooldown_db.current_cooldown_block("spark-1", db_path=db_path)
    assert block is not None
    assert block["runtime_state"] == "quota_exhausted"


def test_run_scan_does_not_refresh_seen_stale_recovery_past_newer_block(tmp_path: Path, monkeypatch):
    db_path = tmp_path / "operator-cooldowns.sqlite"
    inbox = tmp_path / "run" / "quota-evidence-inbox"
    inbox.mkdir(parents=True)
    (inbox / "spark-recovered.txt").write_text(
        "GPT-5.3-Codex-Spark 使用限额\nobserved_at: 2026-06-30T12:00:00Z\n"
        "每周使用限制\n重置时间：7月7日\n剩余 100%\n",
        encoding="utf-8",
    )
    registry = tmp_path / "config" / "physical-operators.json"
    registry.parent.mkdir(parents=True)
    registry.write_text(
        '{"operators":{"spark-1":{"provider":"openai","model":"gpt-5.3-codex-spark","builder_pool":{"group":"codex-gpt-5.3-spark"}}}}',
        encoding="utf-8",
    )
    run_dir = tmp_path / "run" / "operator-quota-evidence-scanner"
    monkeypatch.setattr(scanner.operator_cooldown_db, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(scanner, "INBOX_DIR", inbox)
    monkeypatch.setattr(scanner, "TUI_DIR", tmp_path / "run" / "tui-signals")
    monkeypatch.setattr(scanner, "RESULTS_DIR", tmp_path / "run" / "operator-results")
    monkeypatch.setattr(scanner, "REGISTRY_PATH", registry)
    monkeypatch.setattr(scanner, "RUN_DIR", run_dir)
    monkeypatch.setattr(scanner, "LATEST_PATH", run_dir / "latest.json")
    monkeypatch.setattr(scanner, "HISTORY_PATH", run_dir / "history.jsonl")
    monkeypatch.setattr(scanner, "SEEN_PATH", run_dir / "seen.json")
    now_value = {"now": dt.datetime(2026, 6, 30, 12, 0, tzinfo=dt.timezone.utc)}
    monkeypatch.setattr(scanner, "_now", lambda: now_value["now"])
    monkeypatch.setattr(scanner.operator_cooldown_db, "_now", lambda: now_value["now"])

    first = scanner.run_scan(apply=True)
    assert first["recorded"] == 1

    scanner.operator_cooldown_db.record_cooldown_event(
        "spark-1",
        "quota_exhausted",
        reason="weekly_quota_exhausted",
        source="quota_snapshot_fallback",
        triggered_at=dt.datetime(2026, 6, 30, 12, 30, tzinfo=dt.timezone.utc),
        expires_at=dt.datetime(2026, 7, 7, 4, 0, tzinfo=dt.timezone.utc),
        db_path=db_path,
    )
    assert scanner.operator_cooldown_db.current_cooldown_block("spark-1", db_path=db_path) is not None

    now_value["now"] = dt.datetime(2026, 6, 30, 13, 0, tzinfo=dt.timezone.utc)
    second = scanner.run_scan(apply=True)

    assert second["recorded"] == 1
    assert scanner.operator_cooldown_db.current_cooldown_block("spark-1", db_path=db_path) is not None


def test_run_scan_ignores_stale_observed_at_even_when_file_mtime_is_fresh(tmp_path: Path, monkeypatch):
    db_path = tmp_path / "operator-cooldowns.sqlite"
    inbox = tmp_path / "run" / "quota-evidence-inbox"
    inbox.mkdir(parents=True)
    (inbox / "spark-old.txt").write_text(
        "\n".join(
            [
                "GPT-5.3-Codex-Spark 使用限额",
                "observed_at: 2026-06-25T19:53:08Z",
                "每周使用限制",
                "重置时间：7月1日",
                "剩余 0%",
            ]
        ),
        encoding="utf-8",
    )
    registry = tmp_path / "config" / "physical-operators.json"
    registry.parent.mkdir(parents=True)
    registry.write_text(
        '{"operators":{"spark-1":{"provider":"openai","model":"gpt-5.3-codex-spark","builder_pool":{"group":"codex-gpt-5.3-spark"}}}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(scanner.operator_cooldown_db, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(scanner, "INBOX_DIR", inbox)
    monkeypatch.setattr(scanner, "TUI_DIR", tmp_path / "run" / "tui-signals")
    monkeypatch.setattr(scanner, "RESULTS_DIR", tmp_path / "run" / "operator-results")
    monkeypatch.setattr(scanner, "REGISTRY_PATH", registry)
    monkeypatch.setattr(scanner, "RUN_DIR", tmp_path / "run" / "operator-quota-evidence-scanner")
    monkeypatch.setattr(scanner, "LATEST_PATH", tmp_path / "run" / "operator-quota-evidence-scanner" / "latest.json")
    monkeypatch.setattr(scanner, "HISTORY_PATH", tmp_path / "run" / "operator-quota-evidence-scanner" / "history.jsonl")
    monkeypatch.setattr(scanner, "SEEN_PATH", tmp_path / "run" / "operator-quota-evidence-scanner" / "seen.json")
    monkeypatch.setattr(scanner, "_now", lambda: dt.datetime(2026, 6, 30, 12, 0, tzinfo=dt.timezone.utc))

    payload = scanner.run_scan(apply=True, max_age_seconds=7200)

    assert payload["recorded"] == 0
    assert scanner.operator_cooldown_db.current_cooldown_block("spark-1", db_path=db_path) is None


def test_run_scan_uses_file_mtime_for_missing_observed_at_and_ignores_stale_recovery(
    tmp_path: Path, monkeypatch
):
    db_path = tmp_path / "operator-cooldowns.sqlite"
    inbox = tmp_path / "run" / "quota-evidence-inbox"
    inbox.mkdir(parents=True)
    stale = inbox / "stale-recovery.txt"
    stale.write_text(
        "GPT-5.3-Codex-Spark 使用限额\n5 小时使用限额\n重置时间：13:32\n剩余 100%\n",
        encoding="utf-8",
    )
    current = inbox / "current-limit.txt"
    current.write_text(
        "GPT-5.3-Codex-Spark 使用限额\nobserved_at: 2026-08-10T12:00:00Z\n"
        "5 小时使用限额\n重置时间：2026-08-16T11:47:43Z\n剩余 0%\n",
        encoding="utf-8",
    )
    old = dt.datetime(2026, 6, 30, 12, 0, tzinfo=dt.timezone.utc).timestamp()
    os.utime(stale, (old, old))
    registry = tmp_path / "config" / "physical-operators.json"
    registry.parent.mkdir(parents=True)
    registry.write_text(
        '{"operators":{"spark-1":{"provider":"openai","model":"gpt-5.3-codex-spark",'
        '"builder_pool":{"group":"codex-gpt-5.3-spark"}}}}',
        encoding="utf-8",
    )
    run_dir = tmp_path / "run" / "operator-quota-evidence-scanner"
    monkeypatch.setattr(scanner.operator_cooldown_db, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(scanner, "INBOX_DIR", inbox)
    monkeypatch.setattr(scanner, "TUI_DIR", tmp_path / "run" / "tui-signals")
    monkeypatch.setattr(scanner, "RESULTS_DIR", tmp_path / "run" / "operator-results")
    monkeypatch.setattr(scanner, "REGISTRY_PATH", registry)
    monkeypatch.setattr(scanner, "RUN_DIR", run_dir)
    monkeypatch.setattr(scanner, "LATEST_PATH", run_dir / "latest.json")
    monkeypatch.setattr(scanner, "HISTORY_PATH", run_dir / "history.jsonl")
    monkeypatch.setattr(scanner, "SEEN_PATH", run_dir / "seen.json")
    now = dt.datetime(2026, 8, 10, 12, 30, tzinfo=dt.timezone.utc)
    monkeypatch.setattr(scanner, "_now", lambda: now)
    monkeypatch.setattr(scanner.operator_cooldown_db, "_now", lambda: now)

    payload = scanner.run_scan(apply=True, max_age_seconds=7200)

    assert payload["recorded"] == 1
    block = scanner.operator_cooldown_db.current_cooldown_block("spark-1", now=now, db_path=db_path)
    assert block is not None
    assert block["scope"] == "model_key"
    observation = scanner.operator_cooldown_db.latest_quota_observation("spark-1", db_path=db_path)
    assert observation is not None
    assert observation["observed_at"] == "2026-08-10T12:00:00Z"


def test_run_scan_replays_seen_exhausted_observation_when_active_state_is_missing(tmp_path: Path, monkeypatch):
    db_path = tmp_path / "operator-cooldowns.sqlite"
    inbox = tmp_path / "run" / "quota-evidence-inbox"
    inbox.mkdir(parents=True)
    (inbox / "current-limit.txt").write_text(
        "GPT-5.3-Codex-Spark 使用限额\nobserved_at: 2026-08-10T12:00:00Z\n"
        "5 小时使用限额\n重置时间：2026-08-16T11:47:43Z\n剩余 0%\n",
        encoding="utf-8",
    )
    registry = tmp_path / "config" / "physical-operators.json"
    registry.parent.mkdir(parents=True)
    registry.write_text(
        '{"operators":{"spark-1":{"provider":"openai","model":"gpt-5.3-codex-spark",'
        '"builder_pool":{"group":"codex-gpt-5.3-spark"}}}}',
        encoding="utf-8",
    )
    run_dir = tmp_path / "run" / "operator-quota-evidence-scanner"
    monkeypatch.setattr(scanner.operator_cooldown_db, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(scanner, "INBOX_DIR", inbox)
    monkeypatch.setattr(scanner, "TUI_DIR", tmp_path / "run" / "tui-signals")
    monkeypatch.setattr(scanner, "RESULTS_DIR", tmp_path / "run" / "operator-results")
    monkeypatch.setattr(scanner, "REGISTRY_PATH", registry)
    monkeypatch.setattr(scanner, "RUN_DIR", run_dir)
    monkeypatch.setattr(scanner, "LATEST_PATH", run_dir / "latest.json")
    monkeypatch.setattr(scanner, "HISTORY_PATH", run_dir / "history.jsonl")
    monkeypatch.setattr(scanner, "SEEN_PATH", run_dir / "seen.json")
    now = dt.datetime(2026, 8, 10, 12, 30, tzinfo=dt.timezone.utc)
    monkeypatch.setattr(scanner, "_now", lambda: now)
    monkeypatch.setattr(scanner.operator_cooldown_db, "_now", lambda: now)

    first = scanner.run_scan(apply=True, max_age_seconds=7200)
    assert first["recorded"] == 1
    scanner.operator_cooldown_db.clear_operator_cooldown(
        "spark-1", reason="simulate_projection_loss", source="test", db_path=db_path
    )

    second = scanner.run_scan(apply=True, max_age_seconds=7200)

    assert second["recorded"] == 1
    assert second["recorded_active_blocks"] == 1
    assert scanner.operator_cooldown_db.current_cooldown_block("spark-1", now=now, db_path=db_path) is not None


def test_run_scan_ignores_unknown_operator_without_model_key(tmp_path: Path, monkeypatch):
    db_path = tmp_path / "operator-cooldowns.sqlite"
    tui_latest = tmp_path / "run" / "tui-signals" / "latest"
    tui_latest.mkdir(parents=True)
    (tui_latest / "test-pane.json").write_text(
        """
{
  "operator_id": "test-pane",
  "category": "quota",
  "excerpt": "You've hit your limit"
}
""",
        encoding="utf-8",
    )
    registry = tmp_path / "config" / "physical-operators.json"
    registry.parent.mkdir(parents=True)
    registry.write_text('{"operators": {}}', encoding="utf-8")
    monkeypatch.setattr(scanner.operator_cooldown_db, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(scanner, "INBOX_DIR", tmp_path / "run" / "quota-evidence-inbox")
    monkeypatch.setattr(scanner, "TUI_DIR", tmp_path / "run" / "tui-signals")
    monkeypatch.setattr(scanner, "RESULTS_DIR", tmp_path / "run" / "operator-results")
    monkeypatch.setattr(scanner, "REGISTRY_PATH", registry)
    monkeypatch.setattr(scanner, "RUN_DIR", tmp_path / "run" / "operator-quota-evidence-scanner")
    monkeypatch.setattr(scanner, "LATEST_PATH", tmp_path / "run" / "operator-quota-evidence-scanner" / "latest.json")
    monkeypatch.setattr(scanner, "HISTORY_PATH", tmp_path / "run" / "operator-quota-evidence-scanner" / "history.jsonl")
    monkeypatch.setattr(scanner, "SEEN_PATH", tmp_path / "run" / "operator-quota-evidence-scanner" / "seen.json")

    payload = scanner.run_scan(apply=True)

    assert payload["scanned"] == 1
    assert payload["recorded"] == 0
    assert scanner.operator_cooldown_db.current_cooldown_block("test-pane", db_path=db_path) is None
