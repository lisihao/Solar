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


def test_youtube_auto_caption_is_usable_for_backfill():
    mod = _load_module()
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT 'youtube_auto_caption' AS source, 'T1' AS quality_tier, 89540 AS char_count"
    ).fetchone()

    assert mod.is_usable(row) is True


def test_backfill_timeout_default_covers_queue_cooldown():
    mod = _load_module()
    args = mod.build_parser().parse_args([])

    assert args.timeout == 900


def test_retry_queue_pending_enqueues_caption_discovery_job():
    mod = _load_module()
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE youtube_videos(
            video_id TEXT PRIMARY KEY,
            published_at TEXT,
            duration_seconds INTEGER
        );
        CREATE TABLE youtube_transcripts(
            video_id TEXT PRIMARY KEY,
            source TEXT,
            quality_tier TEXT,
            char_count INTEGER,
            transcript_status TEXT
        );
        CREATE TABLE retry_queue(
            retry_id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            source_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            attempt INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 3,
            last_error TEXT NOT NULL DEFAULT '',
            next_retry_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE TABLE youtube_transcript_jobs (
            job_id TEXT PRIMARY KEY,
            video_id TEXT NOT NULL,
            job_type TEXT NOT NULL,
            priority TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            backend TEXT,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 3,
            next_retry_at TEXT,
            error_code TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL DEFAULT '2026-07-03T00:00:00Z',
            started_at TEXT,
            finished_at TEXT
        );
        """
    )
    conn.execute(
        "INSERT INTO youtube_videos(video_id, published_at, duration_seconds) VALUES (?, ?, ?)",
        ("needs_retry", "2026-07-01T12:00:00Z", 1200),
    )
    conn.execute(
        "INSERT INTO youtube_transcripts(video_id, source, quality_tier, char_count, transcript_status) VALUES (?, ?, ?, ?, ?)",
        ("needs_retry", "metadata", "T3", 0, "missing"),
    )
    conn.execute(
        """INSERT INTO retry_queue(source, source_id, operation, next_retry_at, created_at, status)
           VALUES ('youtube', 'needs_retry', 'fetch_transcript', '2026-07-03T00:00:00Z', '2026-07-03T00:00:00Z', 'pending')"""
    )

    result = mod.enqueue_retry_queue_caption_discovery(conn, min_duration=600, limit=5)

    assert result["enqueued"] == 1
    job = conn.execute(
        "SELECT video_id, job_type, status, backend, error_message FROM youtube_transcript_jobs"
    ).fetchone()
    assert dict(job) == {
        "video_id": "needs_retry",
        "job_type": "caption_discovery",
        "status": "pending",
        "backend": "subtitle-first",
        "error_message": "retry-queue-backfill:pending_fetch_transcript",
    }
    retry = conn.execute("SELECT status, last_error FROM retry_queue").fetchone()
    assert retry["status"] == "pending"
    assert retry["last_error"].startswith("queued_transcript_job:")


def test_retry_queue_scan_skips_early_missing_video_rows():
    mod = _load_module()
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE youtube_videos(
            video_id TEXT PRIMARY KEY,
            published_at TEXT,
            duration_seconds INTEGER
        );
        CREATE TABLE youtube_transcripts(
            video_id TEXT PRIMARY KEY,
            source TEXT,
            quality_tier TEXT,
            char_count INTEGER,
            transcript_status TEXT
        );
        CREATE TABLE retry_queue(
            retry_id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            source_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            attempt INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 3,
            last_error TEXT NOT NULL DEFAULT '',
            next_retry_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE TABLE youtube_transcript_jobs (
            job_id TEXT PRIMARY KEY,
            video_id TEXT NOT NULL,
            job_type TEXT NOT NULL,
            priority TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            backend TEXT,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 3,
            next_retry_at TEXT,
            error_code TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL DEFAULT '2026-07-03T00:00:00Z',
            started_at TEXT,
            finished_at TEXT
        );
        """
    )
    for idx in range(6):
        conn.execute(
            """INSERT INTO retry_queue(source, source_id, operation, next_retry_at, created_at, status)
               VALUES ('youtube', ?, 'fetch_transcript', ?, '2026-07-03T00:00:00Z', 'pending')""",
            (f"missing_video_{idx}", f"2026-07-03T00:00:0{idx}Z"),
        )
    conn.execute(
        "INSERT INTO youtube_videos(video_id, published_at, duration_seconds) VALUES (?, ?, ?)",
        ("eligible_after_missing_rows", "2026-07-01T12:00:00Z", 1200),
    )
    conn.execute(
        "INSERT INTO youtube_transcripts(video_id, source, quality_tier, char_count, transcript_status) VALUES (?, ?, ?, ?, ?)",
        ("eligible_after_missing_rows", "metadata", "T3", 0, "missing"),
    )
    conn.execute(
        """INSERT INTO retry_queue(source, source_id, operation, next_retry_at, created_at, status)
           VALUES ('youtube', 'eligible_after_missing_rows', 'fetch_transcript', '2026-07-03T00:01:00Z', '2026-07-03T00:00:00Z', 'pending')"""
    )

    result = mod.enqueue_retry_queue_caption_discovery(conn, min_duration=600, limit=1)

    assert result["scan_limit"] == 50
    assert result["skipped_missing_video_metadata"] == 6
    assert result["enqueued"] == 1
    job = conn.execute("SELECT video_id, job_type, status FROM youtube_transcript_jobs").fetchone()
    assert tuple(job) == ("eligible_after_missing_rows", "caption_discovery", "pending")


def test_retry_queue_metadata_backfill_unblocks_missing_video_rows(monkeypatch):
    mod = _load_module()
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE youtube_channels(
            channel_id TEXT PRIMARY KEY,
            channel_name TEXT NOT NULL,
            channel_url TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '',
            priority TEXT NOT NULL DEFAULT 'rotation',
            scan_rotation_group INTEGER NOT NULL DEFAULT 1,
            enabled INTEGER NOT NULL DEFAULT 1,
            last_scanned_at TEXT,
            imported_at TEXT NOT NULL
        );
        CREATE TABLE youtube_videos(
            video_id TEXT PRIMARY KEY,
            channel_id TEXT NOT NULL,
            channel_name TEXT NOT NULL,
            video_url TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            published_at TEXT,
            duration_seconds INTEGER,
            thumbnail_url TEXT,
            view_count INTEGER,
            like_count INTEGER,
            comment_count INTEGER,
            tags TEXT NOT NULL DEFAULT '',
            fetched_at TEXT NOT NULL
        );
        CREATE TABLE youtube_transcripts(
            video_id TEXT PRIMARY KEY,
            source TEXT,
            quality_tier TEXT,
            char_count INTEGER,
            transcript_status TEXT
        );
        CREATE TABLE retry_queue(
            retry_id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            source_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            attempt INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 3,
            last_error TEXT NOT NULL DEFAULT '',
            next_retry_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE TABLE youtube_transcript_jobs (
            job_id TEXT PRIMARY KEY,
            video_id TEXT NOT NULL,
            job_type TEXT NOT NULL,
            priority TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            backend TEXT,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 3,
            next_retry_at TEXT,
            error_code TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL DEFAULT '2026-07-03T00:00:00Z',
            started_at TEXT,
            finished_at TEXT
        );
        """
    )
    conn.execute(
        """INSERT INTO retry_queue(source, source_id, operation, next_retry_at, created_at, status)
           VALUES ('youtube', 'missing_meta_video', 'fetch_transcript', '2026-07-03T00:00:00Z', '2026-07-03T00:00:00Z', 'pending')"""
    )

    def fake_fetch(video_id: str, timeout: int = 30, yt_dlp_bin: str = "yt-dlp"):
        assert video_id == "missing_meta_video"
        return {
            "id": video_id,
            "title": "Recovered Metadata",
            "channel_id": "channel-1",
            "channel": "Recovered Channel",
            "channel_url": "https://www.youtube.com/channel/channel-1",
            "webpage_url": f"https://www.youtube.com/watch?v={video_id}",
            "duration": 1200,
            "upload_date": "20260701",
            "description": "desc",
            "tags": ["ai"],
        }, ""

    monkeypatch.setattr(mod, "fetch_video_metadata", fake_fetch)

    meta = mod.backfill_retry_queue_video_metadata(conn, limit=1, timeout=5)
    result = mod.enqueue_retry_queue_caption_discovery(conn, min_duration=600, limit=1)

    assert meta["inserted"] == 1
    video = conn.execute(
        "SELECT video_id, title, duration_seconds FROM youtube_videos WHERE video_id='missing_meta_video'"
    ).fetchone()
    assert tuple(video) == ("missing_meta_video", "Recovered Metadata", 1200)
    assert result["enqueued"] == 1
