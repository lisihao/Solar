from __future__ import annotations

import importlib.util
import json
import os
import sqlite3
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "youtube_report_replan_needed.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("youtube_report_replan_needed_test", str(SCRIPT))
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _init_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    try:
        conn.execute(
            """CREATE TABLE youtube_videos(
                 video_id TEXT PRIMARY KEY,
                 title TEXT,
                 channel_name TEXT,
                 published_at TEXT
               )"""
        )
        conn.execute(
            """CREATE TABLE youtube_transcripts(
                 video_id TEXT PRIMARY KEY,
                 source TEXT,
                 quality_tier TEXT,
                 char_count INTEGER,
                 fetched_at TEXT,
                 created_at TEXT
               )"""
        )
        conn.execute(
            "INSERT INTO youtube_videos(video_id, title, channel_name, published_at) VALUES (?, ?, ?, ?)",
            ("3Amlu4y94Ho", "World's First Trillionaire", "All-In Podcast", "2026-06-19T22:22:20Z"),
        )
        conn.execute(
            """INSERT INTO youtube_transcripts(video_id, source, quality_tier, char_count, fetched_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            ("3Amlu4y94Ho", "youtube_auto_caption", "T1", 89540, "2026-06-20T10:38:24Z", "2026-06-20T10:38:24Z"),
        )
        conn.commit()
    finally:
        conn.close()


def _touch(path: Path, epoch: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{}", encoding="utf-8")
    os.utime(path, (epoch, epoch))


def test_replan_needed_when_auto_caption_arrives_after_latest_plan(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCAL_TZ", "America/Toronto")
    mod = _load_module()
    db = tmp_path / "radar.sqlite"
    knowledge = tmp_path / "Knowledge"
    _init_db(db)
    _touch(
        knowledge / "_raw/tech-hotspot-radar/ai-influence-planned/2026-06-20/report-plan.json",
        1_781_950_000,
    )

    payload = mod.evaluate(db, knowledge, "2026-06-20", "2026-06-19", "2026-06-20")

    assert payload["should_replan"] is True
    assert payload["upgraded_after_latest_count"] == 1
    assert payload["videos"][0]["video_id"] == "3Amlu4y94Ho"


def test_replan_not_needed_when_video_already_reported(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCAL_TZ", "America/Toronto")
    mod = _load_module()
    db = tmp_path / "radar.sqlite"
    knowledge = tmp_path / "Knowledge"
    _init_db(db)
    evidence = (
        knowledge
        / "_raw/tech-hotspot-radar/ai-influence-planned/2026-06-20/reports/all-in/evidence-pack.json"
    )
    evidence.parent.mkdir(parents=True, exist_ok=True)
    evidence.write_text(json.dumps({"videos": [{"video_id": "3Amlu4y94Ho"}]}), encoding="utf-8")

    payload = mod.evaluate(db, knowledge, "2026-06-20", "2026-06-19", "2026-06-20")

    assert payload["should_replan"] is False
    assert payload["missing_report_count"] == 0
