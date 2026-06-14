from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "youtube_transcript_weekly_db_backfill.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("youtube_transcript_weekly_db_backfill_test", str(SCRIPT))
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_video_ids_for_week_uses_eastern_business_week(monkeypatch):
    mod = _load_module()
    monkeypatch.setenv("LOCAL_TZ", "America/Toronto")
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE youtube_videos(video_id TEXT PRIMARY KEY, published_at TEXT)")
    conn.executemany(
        "INSERT INTO youtube_videos(video_id, published_at) VALUES (?, ?)",
        [
            ("utc_monday_but_eastern_sunday_prev_week", "2026-06-01T01:30:00Z"),
            ("mid_week", "2026-06-03T12:00:00Z"),
            ("utc_monday_but_eastern_sunday_current_week", "2026-06-08T01:30:00Z"),
        ],
    )

    week_ids = set(mod.video_ids_for_week(conn, "2026-W23"))

    assert "utc_monday_but_eastern_sunday_prev_week" not in week_ids
    assert "mid_week" in week_ids
    assert "utc_monday_but_eastern_sunday_current_week" in week_ids
