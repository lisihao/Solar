from __future__ import annotations

import datetime as dt
import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("operator_cooldown_db_under_test", ROOT / "lib" / "operator_cooldown_db.py")
cooldown_db = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(cooldown_db)


def test_record_cooldown_event_creates_active_computable_state(tmp_path: Path):
    db_path = tmp_path / "operator-cooldowns.sqlite"
    now = cooldown_db._now()
    expires = now + dt.timedelta(hours=5)

    result = cooldown_db.record_cooldown_event(
        "op-spark-1",
        "cooldown",
        reason="rate_limit",
        source="operator_result_log",
        triggered_at=now,
        expires_at=expires,
        evidence_ref="log:1",
        db_path=db_path,
    )

    assert result["ok"] is True
    assert result["active"] is True

    block = cooldown_db.current_cooldown_block(
        "op-spark-1",
        now=now + dt.timedelta(hours=1),
        db_path=db_path,
    )
    assert block is not None
    assert block["runtime_state"] == "cooldown"
    assert block["reason"] == "rate_limit"
    assert 4 * 3600 - 2 <= block["remaining_seconds"] <= 4 * 3600
    assert block["next_available_at"] == cooldown_db.iso_z(expires)


def test_expired_cooldown_event_is_not_dispatch_block(tmp_path: Path):
    db_path = tmp_path / "operator-cooldowns.sqlite"
    now = dt.datetime(2026, 6, 18, 12, 0, tzinfo=dt.timezone.utc)

    cooldown_db.record_cooldown_event(
        "op-spark-2",
        "cooldown",
        reason="rate_limit",
        source="operator_result_log",
        triggered_at=now,
        cooldown_seconds=60,
        evidence_ref="log:2",
        db_path=db_path,
    )

    block = cooldown_db.current_cooldown_block(
        "op-spark-2",
        now=now + dt.timedelta(minutes=2),
        db_path=db_path,
    )

    assert block is None


def test_stale_result_log_cooldown_is_not_dispatch_block(tmp_path: Path, monkeypatch):
    db_path = tmp_path / "operator-cooldowns.sqlite"
    now = dt.datetime(2026, 6, 18, 12, 0, tzinfo=dt.timezone.utc)
    monkeypatch.setenv("SOLAR_OPERATOR_RESULT_QUOTA_BLOCK_MAX_AGE_SECONDS", "7200")

    cooldown_db.record_cooldown_event(
        "op-spark-2b",
        "cooldown",
        reason="result_log_quota_block",
        source="operator_result_log",
        rule_name="recent_operator_quota_block",
        triggered_at=now,
        expires_at=now + dt.timedelta(days=6),
        evidence_ref="log:weekly-limit",
        db_path=db_path,
    )

    block = cooldown_db.current_cooldown_block(
        "op-spark-2b",
        now=now + dt.timedelta(hours=3),
        db_path=db_path,
    )

    assert block is None


def test_clear_operator_cooldown_removes_active_state(tmp_path: Path):
    db_path = tmp_path / "operator-cooldowns.sqlite"

    cooldown_db.record_cooldown_event(
        "op-spark-3",
        "cooldown",
        reason="consecutive_failures",
        source="consecutive_failure_breaker",
        cooldown_seconds=3600,
        evidence_ref="failure:3",
        db_path=db_path,
    )
    assert cooldown_db.current_cooldown_block("op-spark-3", db_path=db_path) is not None

    cooldown_db.clear_operator_cooldown(
        "op-spark-3",
        reason="successful_operator_outcome",
        source="test",
        db_path=db_path,
    )

    assert cooldown_db.current_cooldown_block("op-spark-3", db_path=db_path) is None


def test_record_quota_observation_persists_raw_evidence_and_blocks_when_exhausted(tmp_path: Path):
    db_path = tmp_path / "operator-cooldowns.sqlite"
    now = dt.datetime(2099, 6, 19, 12, 0, tzinfo=dt.timezone.utc)
    reset = now + dt.timedelta(days=5)

    result = cooldown_db.record_quota_observation(
        "op-spark-4",
        provider="openai",
        model_key="codex-gpt-5.3-spark",
        billing_pool="codex_spark_weekly",
        key_ref="codex_auth",
        scope="model_key",
        quota_window="weekly",
        remaining_percent=0,
        reset_at=reset,
        observed_at=now,
        source="manual_user_ui_quota_evidence",
        evidence_ref="ui:spark-weekly",
        evidence_excerpt="weekly quota remaining 0%",
        db_path=db_path,
    )

    assert result["ok"] is True
    assert result["active_block"] is True

    observation = cooldown_db.latest_quota_observation("op-spark-4", db_path=db_path)
    assert observation is not None
    assert observation["model_key"] == "codex-gpt-5.3-spark"
    assert observation["remaining_percent"] == 0
    assert observation["scope"] == "model_key"

    block = cooldown_db.current_cooldown_block("op-spark-4", now=now, db_path=db_path)
    assert block is not None
    assert block["runtime_state"] == "quota_exhausted"
    assert block["reason"] == "weekly_quota_exhausted"
    assert block["scope"] == "model_key"
    assert block["next_available_at"] == cooldown_db.iso_z(reset)


def test_record_quota_observation_does_not_block_when_quota_remains(tmp_path: Path):
    db_path = tmp_path / "operator-cooldowns.sqlite"
    now = dt.datetime(2026, 6, 19, 12, 0, tzinfo=dt.timezone.utc)

    result = cooldown_db.record_quota_observation(
        "op-spark-5",
        model_key="codex-gpt-5.3-spark",
        quota_window="weekly",
        remaining_percent=42,
        reset_at=now + dt.timedelta(days=5),
        observed_at=now,
        source="manual_user_ui_quota_evidence",
        db_path=db_path,
    )

    assert result["ok"] is True
    assert result["active_block"] is False
    assert cooldown_db.current_cooldown_block("op-spark-5", now=now, db_path=db_path) is None


def test_positive_quota_observation_clears_prior_exhausted_block(tmp_path: Path):
    db_path = tmp_path / "operator-cooldowns.sqlite"
    now = dt.datetime(2099, 6, 19, 12, 0, tzinfo=dt.timezone.utc)

    cooldown_db.record_quota_observation(
        "op-spark-6",
        model_key="codex-gpt-5.3-spark",
        quota_window="weekly",
        remaining_percent=0,
        reset_at=now + dt.timedelta(days=5),
        observed_at=now,
        source="manual_user_ui_quota_evidence",
        db_path=db_path,
    )
    assert cooldown_db.current_cooldown_block("op-spark-6", now=now, db_path=db_path) is not None

    result = cooldown_db.record_quota_observation(
        "op-spark-6",
        model_key="codex-gpt-5.3-spark",
        quota_window="weekly",
        remaining_percent=100,
        reset_at=now + dt.timedelta(days=12),
        observed_at=now + dt.timedelta(hours=1),
        source="manual_user_ui_quota_evidence",
        db_path=db_path,
    )

    assert result["active_block"] is False
    assert result["cleared_block"] is True
    assert cooldown_db.current_cooldown_block("op-spark-6", now=now + dt.timedelta(hours=1), db_path=db_path) is None


def test_positive_5h_observation_clears_codex_try_again_result_log_block(tmp_path: Path):
    db_path = tmp_path / "operator-cooldowns.sqlite"
    now = dt.datetime(2099, 7, 2, 12, 0, tzinfo=dt.timezone.utc)

    cooldown_db.record_cooldown_event(
        "op-spark-7",
        "cooldown",
        reason="result_log_quota_block",
        source="operator_result_log",
        rule_name="recent_operator_quota_block",
        triggered_at=now,
        expires_at=now + dt.timedelta(hours=5),
        evidence_excerpt="ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. Switch to another model now, or try again at 1:39 PM.",
        db_path=db_path,
    )
    assert cooldown_db.current_cooldown_block("op-spark-7", now=now, db_path=db_path) is not None

    result = cooldown_db.record_quota_observation(
        "op-spark-7",
        model_key="codex-gpt-5.3-spark",
        quota_window="5h",
        remaining_percent=100,
        observed_at=now + dt.timedelta(minutes=5),
        reset_at=now + dt.timedelta(hours=5),
        source="manual_user_ui_quota_evidence",
        db_path=db_path,
    )

    assert result["cleared_block"] is True
    assert cooldown_db.current_cooldown_block("op-spark-7", now=now + dt.timedelta(minutes=5), db_path=db_path) is None


def test_positive_5h_observation_clears_windowless_strict_result_log_block(tmp_path: Path):
    db_path = tmp_path / "operator-cooldowns.sqlite"
    now = dt.datetime(2099, 7, 7, 12, 26, tzinfo=dt.timezone.utc)

    cooldown_db.record_cooldown_event(
        "op-spark-strict",
        "cooldown",
        reason="result_log_quota_block",
        source="operator_result_log_strict",
        rule_name="recent_operator_quota_block",
        triggered_at=now,
        expires_at=now + dt.timedelta(days=1),
        evidence_ref="codex-cli-output.log",
        db_path=db_path,
    )
    assert cooldown_db.current_cooldown_block("op-spark-strict", now=now, db_path=db_path) is not None

    result = cooldown_db.record_quota_observation(
        "op-spark-strict",
        model_key="codex-gpt-5.3-spark",
        quota_window="5h",
        remaining_percent=100,
        observed_at=now + dt.timedelta(minutes=1),
        reset_at=now + dt.timedelta(hours=5),
        source="quota_evidence_inbox",
        evidence_ref="ui:spark-5h-recovered",
        db_path=db_path,
    )

    assert result["cleared_block"] is True
    recovery = cooldown_db.quota_recovery_observation(
        "op-spark-strict",
        block={
            "runtime_state": "cooldown",
            "source": "operator_result_log_strict",
            "reason": "result_log_quota_block",
            "rule_name": "recent_operator_quota_block",
            "triggered_at": cooldown_db.iso_z(now),
            "expires_at": cooldown_db.iso_z(now + dt.timedelta(days=1)),
        },
        db_path=db_path,
    )
    assert recovery is not None
    assert recovery["quota_window"] == "5h"
    assert cooldown_db.current_cooldown_block(
        "op-spark-strict",
        now=now + dt.timedelta(minutes=2),
        db_path=db_path,
    ) is None


def test_recovery_observation_finds_weekly_positive_when_5h_rows_are_newer(tmp_path: Path):
    db_path = tmp_path / "operator-cooldowns.sqlite"
    triggered = dt.datetime(2099, 7, 3, 14, 52, tzinfo=dt.timezone.utc)
    block = {
        "operator_id": "op-spark-8",
        "runtime_state": "cooldown",
        "source": "operator_result_log_strict",
        "triggered_at": cooldown_db.iso_z(triggered),
        "expires_at": cooldown_db.iso_z(triggered + dt.timedelta(days=4)),
    }

    for i in range(10):
        cooldown_db.record_quota_observation(
            "op-spark-8",
            model_key="codex-gpt-5.3-spark",
            quota_window="5h",
            remaining_percent=100,
            observed_at=triggered + dt.timedelta(hours=3, minutes=i),
            reset_at=triggered + dt.timedelta(hours=5, minutes=i),
            source="quota_evidence_inbox",
            db_path=db_path,
        )
    cooldown_db.record_quota_observation(
        "op-spark-8",
        model_key="codex-gpt-5.3-spark",
        quota_window="weekly",
        remaining_percent=100,
        observed_at=triggered + dt.timedelta(minutes=5),
        reset_at=triggered + dt.timedelta(days=4),
        source="quota_evidence_inbox",
        db_path=db_path,
    )

    recovery = cooldown_db.quota_recovery_observation("op-spark-8", block=block, db_path=db_path)

    assert recovery is not None
    assert recovery["quota_window"] == "weekly"
    assert recovery["remaining_percent"] == 100
