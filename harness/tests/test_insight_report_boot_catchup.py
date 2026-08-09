import importlib.util
import json
import sqlite3
import sys
from pathlib import Path


def _load_module():
    module_path = Path(__file__).resolve().parents[1] / "scripts" / "insight_report_boot_catchup.py"
    spec = importlib.util.spec_from_file_location("insight_report_boot_catchup_for_test", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_youtube_collect_is_first_boot_catchup_task():
    mod = _load_module()
    assert mod.TASKS[0].key == "youtube_collect"
    assert mod.TASKS[0].date_env == "YOUTUBE_DAILY_COLLECT_TARGET_DATE"
    assert mod.TASKS[0].target_offset_days == 1
    assert mod.TASKS[1].key == "youtube_transcript_backfill"
    assert mod.TASKS[2].key == "youtube_planned"


def test_youtube_collect_complete_requires_usable_long_transcript(monkeypatch, tmp_path):
    db = tmp_path / "tech-hotspot-radar.sqlite"
    conn = sqlite3.connect(db)
    conn.executescript(
        """
        CREATE TABLE youtube_videos (
          video_id TEXT PRIMARY KEY,
          published_at TEXT,
          duration_seconds INTEGER
        );
        CREATE TABLE youtube_transcripts (
          video_id TEXT PRIMARY KEY,
          transcript_status TEXT,
          transcript_clean TEXT,
          char_count INTEGER
        );
        """
    )
    conn.execute(
        "INSERT INTO youtube_videos(video_id, published_at, duration_seconds) VALUES (?, ?, ?)",
        ("vid-1", "2026-06-23T12:00:00Z", 1800),
    )
    conn.commit()
    conn.close()

    monkeypatch.setenv("TECH_HOTSPOT_RADAR_DB", str(db))
    mod = _load_module()
    complete, reason = mod.youtube_collect_complete("2026-06-23")
    assert not complete
    assert "usable_long_transcripts=0" in reason

    conn = sqlite3.connect(db)
    conn.execute(
        """
        INSERT INTO youtube_transcripts(video_id, transcript_status, transcript_clean, char_count)
        VALUES (?, ?, ?, ?)
        """,
        ("vid-1", "fetched", "usable transcript", 18000),
    )
    conn.commit()
    conn.close()

    complete, reason = mod.youtube_collect_complete("2026-06-23")
    assert complete
    assert "usable_long_transcripts=1" in reason


def test_youtube_planned_no_input_artifact_is_complete(monkeypatch, tmp_path):
    knowledge = tmp_path / "Knowledge"
    no_input = (
        knowledge
        / "_raw"
        / "tech-hotspot-radar"
        / "ai-influence-planned"
        / "2026-06-24"
        / "no-input-result.json"
    )
    no_input.parent.mkdir(parents=True)
    no_input.write_text(json.dumps({"status": "no_input"}, ensure_ascii=False), encoding="utf-8")

    monkeypatch.setenv("SOLAR_KNOWLEDGE_DIR", str(knowledge))
    mod = _load_module()
    complete, reason = mod.report_complete("youtube_planned", "2026-06-24")
    assert complete
    assert "no reportable" in reason


def test_youtube_transcript_backfill_state_must_be_settled(monkeypatch, tmp_path):
    solar_home = tmp_path / ".solar"
    state_path = solar_home / "harness" / "state" / "tech-hotspot-radar" / "youtube-weekly-db-backfill-state.json"
    state_path.parent.mkdir(parents=True)
    state_path.write_text(
        json.dumps({"status": "failed", "last_error": {"message": "no such table"}}, ensure_ascii=False),
        encoding="utf-8",
    )

    monkeypatch.setenv("SOLAR_HOME", str(solar_home))
    mod = _load_module()
    complete, reason = mod.youtube_transcript_backfill_complete()
    assert not complete
    assert "last_error" in reason

    state_path.write_text(json.dumps({"status": "complete", "last_error": None}, ensure_ascii=False), encoding="utf-8")
    complete, reason = mod.youtube_transcript_backfill_complete()
    assert complete
    assert "status=complete" in reason


def test_youtube_digest_skipped_mail_is_settled(tmp_path):
    mod = _load_module()
    digest_path = tmp_path / "20260619T214611Z-youtube-influence-digest.md"
    digest_path.write_text("# YouTube Influence Transcript Digest\n", encoding="utf-8")
    mail_path = tmp_path / "mail-result.json"
    mail_path.write_text(
        json.dumps(
            {
                "mail": {
                    "ok": True,
                    "status": "skipped",
                    "skipped": True,
                    "reason": "YOUTUBE_INFLUENCE_DIGEST_SEND_MAIL=false",
                },
                "digest_path": str(digest_path),
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    assert mod.youtube_digest_mail_settled(mail_path, digest_path)


def test_youtube_digest_other_skips_are_not_settled(tmp_path):
    mod = _load_module()
    digest_path = tmp_path / "20260619T214611Z-youtube-influence-digest.md"
    digest_path.write_text("# YouTube Influence Transcript Digest\n", encoding="utf-8")
    mail_path = tmp_path / "mail-result.json"
    mail_path.write_text(
        json.dumps({"mail": {"status": "skipped", "reason": "temporary_mail_error"}}, ensure_ascii=False),
        encoding="utf-8",
    )

    assert not mod.youtube_digest_mail_settled(mail_path, digest_path)
