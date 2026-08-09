#!/usr/bin/env python3
"""Slow DB-native YouTube transcript backfill for Tech Hotspot Radar.

This is the production backfill path for historical AI Influence YouTube data.
It advances week by week from 2026-W20 down to 2026-W01 and only uses:

  caption_discovery -> subtitle_download -> browser_capture

It does not enqueue or run local/premium ASR. Browser capture is implemented by
YoutubeTranscriptExtractor through youtube.cli's browser_capture job handler.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import traceback
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

try:
    import yaml  # type: ignore
except Exception:
    yaml = None

UTC = dt.timezone.utc
HARNESS_ROOT = Path(os.path.expandvars(os.environ.get("SOLAR_REPO", str(Path.home() / "Solar")))).expanduser() / "harness"
LIVE_ROOT = Path(os.path.expandvars(os.environ.get("HARNESS_DIR", str(Path.home() / ".solar" / "harness")))).expanduser()
DEFAULT_DB = LIVE_ROOT / "state/tech-hotspot-radar/tech-hotspot-radar.sqlite"
DEFAULT_STATE_DIR = LIVE_ROOT / "state/tech-hotspot-radar"
DEFAULT_CONFIG = HARNESS_ROOT / "config/tech-hotspot-radar.yaml"
DEFAULT_STATE_PATH = DEFAULT_STATE_DIR / "youtube-weekly-db-backfill-state.json"
USABLE_SOURCES = {"standard_caption", "youtube_asr_caption", "youtube_auto_caption", "browser_caption"}
USABLE_TIERS = {"T0", "T1", "T2"}
LOCAL_ASR_SOURCES = {"legacy_asr", "faster_whisper", "whisperx", "mlx_whisper", "premium"}
DB_BUSY_TIMEOUT_MS = 300_000


def iso_z(ts: dt.datetime | None = None) -> str:
    ts = ts or dt.datetime.now(UTC)
    return ts.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%fZ")


def parse_week(label: str) -> dt.date:
    year, week = label.split("-W", 1)
    return dt.date.fromisocalendar(int(year), int(week), 1)


def fmt_week(day: dt.date) -> str:
    year, week, _ = day.isocalendar()
    return f"{year}-W{week:02d}"


def local_timezone() -> ZoneInfo:
    return ZoneInfo(os.environ.get("LOCAL_TZ", "America/Toronto"))


def local_business_date(value: str) -> dt.date | None:
    try:
        parsed = dt.datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(local_timezone()).date()
    except Exception:
        try:
            return dt.date.fromisoformat(str(value or "")[:10])
        except Exception:
            return None


def video_ids_for_week(conn: sqlite3.Connection, week: str) -> list[str]:
    start = parse_week(week)
    end = start + dt.timedelta(days=7)
    return [
        str(row["video_id"])
        for row in conn.execute("SELECT video_id, published_at FROM youtube_videos")
        if (local_business_date(str(row["published_at"] or "")) is not None and start <= local_business_date(str(row["published_at"] or "")) < end)
    ]


def sql_placeholders(values: list[str]) -> str:
    return ",".join(["?"] * len(values))


def week_labels_newest_first(start_week: str, end_week: str) -> list[str]:
    start = parse_week(start_week)
    end = parse_week(end_week)
    labels: list[str] = []
    cursor = start
    while cursor >= end:
        labels.append(fmt_week(cursor))
        cursor -= dt.timedelta(days=7)
    return labels


def load_min_duration(config_path: Path) -> int:
    if yaml is None or not config_path.exists():
        return 600
    try:
        payload = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
        return int(((payload.get("youtube") or {}).get("min_transcript_duration_seconds") or 600))
    except Exception:
        return 600


def open_db(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=DB_BUSY_TIMEOUT_MS / 1000)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=" + str(int(DB_BUSY_TIMEOUT_MS)))
    try:
        conn.execute("PRAGMA journal_mode=WAL")
    except sqlite3.OperationalError:
        # Another writer may already hold the DB. busy_timeout still protects
        # this connection; WAL can be established by a later clean connection.
        pass
    return conn


def classify_error(exc: BaseException) -> str:
    message = str(exc).lower()
    if isinstance(exc, sqlite3.OperationalError) and "database is locked" in message:
        return "database_locked"
    return exc.__class__.__name__


def record_failed_state(
    state_path: Path,
    state: dict[str, Any],
    *,
    start_week: str,
    end_week: str,
    week: str | None,
    exc: BaseException,
) -> None:
    state.update(
        {
            "last_run_at": iso_z(),
            "status": "failed",
            "active_week": week or state.get("active_week"),
            "start_week": start_week,
            "end_week": end_week,
            "last_error": {
                "error_code": classify_error(exc),
                "error_type": exc.__class__.__name__,
                "message": str(exc),
                "traceback_tail": traceback.format_exc()[-4000:],
            },
        }
    )
    save_state(state_path, state)


def is_usable(row: sqlite3.Row | None) -> bool:
    if row is None:
        return False
    source = str(row["source"] or "")
    tier = str(row["quality_tier"] or "")
    chars = int(row["char_count"] or 0)
    return source in USABLE_SOURCES and tier in USABLE_TIERS and chars >= 200


def week_bounds(week: str) -> tuple[str, str]:
    start = parse_week(week)
    end = start + dt.timedelta(days=7)
    return start.isoformat(), end.isoformat()


def stable_job_id(video_id: str, job_type: str, reason: str) -> str:
    digest = hashlib.sha1(f"{video_id}:{job_type}:{reason}".encode("utf-8")).hexdigest()[:16]
    return f"ytj-{digest}"


def load_state(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"schema": "youtube-weekly-db-backfill-state.v1", "completed_weeks": []}


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def get_week_stats(conn: sqlite3.Connection, week: str, min_duration: int) -> dict[str, Any]:
    video_ids = video_ids_for_week(conn, week)
    if not video_ids:
        return {
            "week": week,
            "videos": 0,
            "usable": 0,
            "short_or_below_threshold": 0,
            "needs_backfill": 0,
            "jobs": {},
        }
    placeholders = sql_placeholders(video_ids)
    rows = conn.execute(
        f"""SELECT v.video_id, v.duration_seconds, t.source, t.quality_tier, t.char_count
           FROM youtube_videos v
           LEFT JOIN youtube_transcripts t USING(video_id)
           WHERE v.video_id IN ({placeholders})""",
        video_ids,
    ).fetchall()
    videos = len(rows)
    usable = 0
    short_or_unknown = 0
    needs = 0
    for row in rows:
        if is_usable(row):
            usable += 1
            continue
        duration = row["duration_seconds"]
        if duration is not None and int(duration) < min_duration:
            short_or_unknown += 1
            continue
        terminal = conn.execute(
            """SELECT 1 FROM youtube_transcript_jobs
               WHERE video_id=? AND status IN ('metadata_only','cancelled','quarantined')
               LIMIT 1""",
            (row["video_id"],),
        ).fetchone()
        if terminal:
            continue
        needs += 1
    jobs = conn.execute(
        f"""SELECT status, COUNT(*) n
           FROM youtube_transcript_jobs
           WHERE video_id IN ({placeholders})
           GROUP BY status""",
        video_ids,
    ).fetchall()
    return {
        "week": week,
        "videos": videos,
        "usable": usable,
        "short_or_below_threshold": short_or_unknown,
        "needs_backfill": needs,
        "jobs": {str(row["status"]): int(row["n"]) for row in jobs},
    }


def mark_short_metadata(conn: sqlite3.Connection, week: str, min_duration: int, limit: int) -> int:
    video_ids = video_ids_for_week(conn, week)
    if not video_ids:
        return 0
    placeholders = sql_placeholders(video_ids)
    rows = conn.execute(
        f"""SELECT v.video_id, v.duration_seconds
           FROM youtube_videos v
           LEFT JOIN youtube_transcripts t USING(video_id)
           WHERE v.video_id IN ({placeholders})
             AND v.duration_seconds IS NOT NULL AND v.duration_seconds < ?
             AND (t.video_id IS NULL OR NOT (
               t.source IN ('standard_caption','youtube_asr_caption','youtube_auto_caption','browser_caption')
               AND t.quality_tier IN ('T0','T1','T2') AND t.char_count >= 200
             ))
           LIMIT ?""",
        (*video_ids, min_duration, limit),
    ).fetchall()
    now = iso_z()
    for row in rows:
        conn.execute(
            """INSERT INTO youtube_transcripts
               (video_id, transcript_raw, transcript_clean, transcript_status, source, language,
                fetched_at, char_count, quality_score, quality_tier, coverage_ratio, hallucination_risk)
               VALUES (?, '', '', 'metadata_only', 'metadata', '', ?, 0, 0.0, 'T3', 0.0, 1.0)
               ON CONFLICT(video_id) DO UPDATE SET
                 transcript_status='metadata_only',
                 source='metadata',
                 fetched_at=excluded.fetched_at,
                 char_count=0,
                 quality_score=0.0,
                 quality_tier='T3',
                 coverage_ratio=0.0,
                 hallucination_risk=1.0""",
            (row["video_id"], now),
        )
    conn.commit()
    return len(rows)


def purge_local_asr_transcripts(conn: sqlite3.Connection, week: str, limit: int = 500) -> int:
    """Remove local/legacy ASR text from evidence path for a week.

    We keep the video row and a metadata-only transcript shell so the backfill
    can re-acquire captions/browser transcript later. No ASR text remains
    usable or readable from youtube_transcripts after this update.
    """
    video_ids = video_ids_for_week(conn, week)
    if not video_ids:
        return 0
    placeholders = sql_placeholders(video_ids)
    rows = conn.execute(
        f"""SELECT t.video_id
            FROM youtube_transcripts t
            JOIN youtube_videos v USING(video_id)
            WHERE v.video_id IN ({placeholders})
              AND t.source IN ({','.join('?' for _ in LOCAL_ASR_SOURCES)})
            LIMIT ?""",
        (*video_ids, *sorted(LOCAL_ASR_SOURCES), limit),
    ).fetchall()
    now = iso_z()
    for row in rows:
        conn.execute(
            """UPDATE youtube_transcripts
               SET transcript_id='metadata-' || video_id,
                   transcript_raw='',
                   transcript_clean='',
                   transcript_status='metadata_only',
                   source='metadata',
                   language='',
                   fetched_at=?,
                   char_count=0,
                   is_auto_generated=0,
                   model=NULL,
                   model_version=NULL,
                   audio_hash=NULL,
                   transcript_hash=NULL,
                   raw_path=NULL,
                   clean_path=NULL,
                   segments_json_path=NULL,
                   quality_score=0.0,
                   quality_tier='T3',
                   coverage_ratio=0.0,
                   hallucination_risk=1.0
               WHERE video_id=?""",
            (now, row["video_id"]),
        )
    conn.commit()
    return len(rows)


def ensure_metadata_transcript(conn: sqlite3.Connection, video_id: str) -> None:
    now = iso_z()
    conn.execute(
        """INSERT INTO youtube_transcripts
           (video_id, transcript_id, transcript_raw, transcript_clean, transcript_status, source, language,
            fetched_at, char_count, quality_score, quality_tier, coverage_ratio, hallucination_risk)
           VALUES (?, 'metadata-' || ?, '', '', 'metadata_only', 'metadata', '', ?, 0, 0.0, 'T3', 0.0, 1.0)
           ON CONFLICT(video_id) DO UPDATE SET
             transcript_id='metadata-' || youtube_transcripts.video_id,
             transcript_raw='',
             transcript_clean='',
             transcript_status='metadata_only',
             source='metadata',
             language='',
             fetched_at=excluded.fetched_at,
             char_count=0,
             is_auto_generated=0,
             model=NULL,
             model_version=NULL,
             audio_hash=NULL,
             transcript_hash=NULL,
             raw_path=NULL,
             clean_path=NULL,
             segments_json_path=NULL,
             quality_score=0.0,
             quality_tier='T3',
             coverage_ratio=0.0,
             hallucination_risk=1.0""",
        (video_id, video_id, now),
    )


def enqueue_browser_capture(conn: sqlite3.Connection, video_id: str, priority: str, reason: str, message: str) -> None:
    job_id = stable_job_id(video_id, "browser_capture", reason)
    conn.execute(
        """INSERT INTO youtube_transcript_jobs
           (job_id, video_id, job_type, priority, status, backend, max_attempts, error_code, error_message, created_at)
           VALUES (?, ?, 'browser_capture', ?, 'pending', 'browser-agent', 2, ?, ?, ?)
           ON CONFLICT(job_id) DO UPDATE SET
             status=CASE
               WHEN youtube_transcript_jobs.status IN ('succeeded','running','metadata_only','cancelled','quarantined')
               THEN youtube_transcript_jobs.status ELSE 'pending' END,
             next_retry_at=NULL,
             backend='browser-agent',
             priority=excluded.priority,
             error_code=excluded.error_code,
             error_message=excluded.error_message""",
        (job_id, video_id, priority, reason[:80], message[:500], iso_z()),
    )


def reconcile_failed_jobs(conn: sqlite3.Connection, week: str, min_duration: int) -> dict[str, int]:
    """Move exhausted failures to the next allowed non-ASR state.

    subtitle/caption failures go to browser_capture. Browser failures and short
    videos become metadata_only. ASR jobs are terminalized and scrubbed.
    """
    video_ids = video_ids_for_week(conn, week)
    if not video_ids:
        return {"to_browser_capture": 0, "to_metadata_only": 0, "asr_terminalized": 0}
    placeholders = sql_placeholders(video_ids)
    rows = conn.execute(
        f"""SELECT j.*, v.duration_seconds
           FROM youtube_transcript_jobs j
           JOIN youtube_videos v USING(video_id)
           WHERE v.video_id IN ({placeholders})
             AND (
               j.job_type IN ('asr','premium_asr')
               OR (j.status='failed' AND j.job_type IN ('caption_discovery','subtitle_download'))
               OR (j.status='failed' AND (j.attempt_count >= j.max_attempts OR j.error_code='max_attempts'))
               OR (j.job_type='browser_capture' AND j.status IN ('pending','queued') AND j.error_code='max_attempts')
             )""",
        video_ids,
    ).fetchall()
    counts = {"to_browser_capture": 0, "to_metadata_only": 0, "asr_terminalized": 0}
    now = iso_z()
    for row in rows:
        job_type = str(row["job_type"] or "")
        duration = row["duration_seconds"]
        is_short = duration is not None and int(duration) < min_duration
        if job_type in {"asr", "premium_asr"}:
            ensure_metadata_transcript(conn, row["video_id"])
            conn.execute(
                """UPDATE youtube_transcript_jobs
                   SET status='metadata_only', next_retry_at=NULL, error_code='max_attempts',
                       error_message='ASR disabled and scrubbed by weekly backfill', finished_at=?
                   WHERE job_id=?""",
                (now, row["job_id"]),
            )
            counts["asr_terminalized"] += 1
        elif job_type in {"caption_discovery", "subtitle_download"} and not is_short:
            enqueue_browser_capture(
                conn,
                row["video_id"],
                str(row["priority"] or "P2"),
                f"{job_type}_failed_exhausted",
                f"{job_type} exhausted; routed to browser_capture: {row['error_message'] or row['error_code'] or 'failed'}",
            )
            conn.execute(
                """UPDATE youtube_transcript_jobs
                   SET status='cancelled', next_retry_at=NULL,
                       error_message=COALESCE(error_message,'') || ' | routed_to_browser_capture',
                       finished_at=?
                   WHERE job_id=?""",
                (now, row["job_id"]),
            )
            counts["to_browser_capture"] += 1
        else:
            ensure_metadata_transcript(conn, row["video_id"])
            conn.execute(
                """UPDATE youtube_transcript_jobs
                   SET status='metadata_only', next_retry_at=NULL,
                       error_message=COALESCE(error_message,'') || ' | terminal_metadata_only',
                       finished_at=?
                   WHERE job_id=?""",
                (now, row["job_id"]),
            )
            counts["to_metadata_only"] += 1
    conn.commit()
    return counts


def enqueue_caption_discovery(conn: sqlite3.Connection, week: str, min_duration: int, limit: int) -> int:
    video_ids = video_ids_for_week(conn, week)
    if not video_ids:
        return 0
    placeholders = sql_placeholders(video_ids)
    rows = conn.execute(
        f"""SELECT v.video_id, v.duration_seconds, t.source, t.quality_tier, t.char_count
           FROM youtube_videos v
           LEFT JOIN youtube_transcripts t USING(video_id)
           WHERE v.video_id IN ({placeholders})
             AND (v.duration_seconds IS NULL OR v.duration_seconds >= ?)
             AND (t.video_id IS NULL OR NOT (
               t.source IN ('standard_caption','youtube_asr_caption','youtube_auto_caption','browser_caption')
               AND t.quality_tier IN ('T0','T1','T2') AND t.char_count >= 200
             ))
             AND NOT EXISTS (
               SELECT 1 FROM youtube_transcript_jobs j
               WHERE j.video_id=v.video_id
                 AND j.status IN ('pending','running')
             )
             AND NOT EXISTS (
               SELECT 1 FROM youtube_transcript_jobs j
               WHERE j.video_id=v.video_id
                 AND j.status IN ('metadata_only','cancelled','quarantined')
           )
           ORDER BY datetime(v.published_at) DESC
           LIMIT ?""",
        (*video_ids, min_duration, limit),
    ).fetchall()
    now = iso_z()
    for row in rows:
        job_id = stable_job_id(row["video_id"], "caption_discovery", f"weekly-db-backfill:{week}")
        conn.execute(
            """INSERT INTO youtube_transcript_jobs
               (job_id, video_id, job_type, priority, status, backend, max_attempts, error_message, created_at)
               VALUES (?, ?, 'caption_discovery', 'P2', 'pending', 'subtitle-first', 3, ?, ?)
               ON CONFLICT(job_id) DO UPDATE SET
                 status=CASE
                   WHEN youtube_transcript_jobs.status IN ('succeeded','metadata_only','running')
                   THEN youtube_transcript_jobs.status ELSE 'pending' END,
                 next_retry_at=NULL,
                 error_message=excluded.error_message""",
            (job_id, row["video_id"], f"weekly-db-backfill:{week}", now),
        )
    conn.commit()
    return len(rows)


def retry_queue_pending_summary(conn: sqlite3.Connection) -> dict[str, int]:
    rows = conn.execute(
        """SELECT COALESCE(t.transcript_status, 'no_row') AS transcript_status, COUNT(*) AS n
           FROM retry_queue rq
           LEFT JOIN youtube_transcripts t ON t.video_id = rq.source_id
           WHERE rq.source='youtube'
             AND rq.operation='fetch_transcript'
             AND rq.status='pending'
           GROUP BY COALESCE(t.transcript_status, 'no_row')"""
    ).fetchall()
    return {str(row["transcript_status"]): int(row["n"] or 0) for row in rows}


def retry_queue_video_metadata_summary(conn: sqlite3.Connection) -> dict[str, int]:
    rows = conn.execute(
        """SELECT
             CASE
               WHEN v.video_id IS NULL THEN 'missing_video_row'
               WHEN v.duration_seconds IS NULL THEN 'missing_duration'
               ELSE 'has_video_metadata'
             END AS status,
             COUNT(*) AS n
           FROM retry_queue rq
           LEFT JOIN youtube_videos v ON v.video_id = rq.source_id
           LEFT JOIN youtube_transcripts t ON t.video_id = rq.source_id
           WHERE rq.source='youtube'
             AND rq.operation='fetch_transcript'
             AND rq.status='pending'
             AND COALESCE(t.transcript_status, 'missing') != 'fetched'
           GROUP BY status"""
    ).fetchall()
    return {str(row["status"]): int(row["n"] or 0) for row in rows}


def normalize_yt_dlp_datetime(payload: dict[str, Any]) -> str | None:
    timestamp = payload.get("timestamp") or payload.get("release_timestamp")
    if timestamp:
        try:
            return iso_z(dt.datetime.fromtimestamp(float(timestamp), tz=UTC))
        except Exception:
            pass
    upload_date = str(payload.get("upload_date") or payload.get("release_date") or "").strip()
    if len(upload_date) == 8 and upload_date.isdigit():
        try:
            day = dt.datetime.strptime(upload_date, "%Y%m%d").replace(tzinfo=UTC)
            return iso_z(day)
        except Exception:
            pass
    return None


def fetch_video_metadata(video_id: str, timeout: int = 30, yt_dlp_bin: str = "yt-dlp") -> tuple[dict[str, Any] | None, str]:
    try:
        proc = subprocess.run(
            [
                yt_dlp_bin,
                "--skip-download",
                "--dump-single-json",
                f"https://www.youtube.com/watch?v={video_id}",
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
    except Exception as exc:
        return None, f"{type(exc).__name__}: {exc}"
    if proc.returncode != 0:
        return None, (proc.stderr or proc.stdout or f"yt-dlp rc={proc.returncode}")[-500:]
    try:
        payload = json.loads(proc.stdout or "{}")
    except Exception as exc:
        return None, f"json_decode_failed:{type(exc).__name__}: {exc}"
    if not str(payload.get("title") or "").strip():
        return None, "yt-dlp metadata missing title"
    return payload, ""


def upsert_video_metadata(conn: sqlite3.Connection, video_id: str, payload: dict[str, Any]) -> None:
    now = iso_z()
    channel_id = str(payload.get("channel_id") or payload.get("uploader_id") or f"unknown-{video_id}").strip()
    channel_name = str(payload.get("channel") or payload.get("uploader") or "Unknown Channel").strip()
    channel_url = str(payload.get("channel_url") or payload.get("uploader_url") or "").strip()
    title = str(payload.get("title") or "").strip()
    description = str(payload.get("description") or "")
    tags = payload.get("tags") or []
    tags_text = json.dumps(tags, ensure_ascii=False) if isinstance(tags, list) else str(tags or "")
    video_url = str(payload.get("webpage_url") or f"https://www.youtube.com/watch?v={video_id}")
    thumbnail_url = str(payload.get("thumbnail") or "")
    published_at = normalize_yt_dlp_datetime(payload)
    duration = payload.get("duration")

    conn.execute(
        """INSERT INTO youtube_channels
           (channel_id, channel_name, channel_url, category, priority, scan_rotation_group, enabled, imported_at)
           VALUES (?, ?, ?, '', 'retry_queue_metadata', 1, 1, ?)
           ON CONFLICT(channel_id) DO UPDATE SET
             channel_name=excluded.channel_name,
             channel_url=excluded.channel_url""",
        (channel_id, channel_name, channel_url, now),
    )
    conn.execute(
        """INSERT INTO youtube_videos
           (video_id, channel_id, channel_name, video_url, title, description,
            published_at, duration_seconds, thumbnail_url, view_count, like_count,
            comment_count, tags, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(video_id) DO UPDATE SET
             channel_id=excluded.channel_id,
             channel_name=excluded.channel_name,
             video_url=excluded.video_url,
             title=excluded.title,
             description=excluded.description,
             published_at=COALESCE(excluded.published_at, youtube_videos.published_at),
             duration_seconds=COALESCE(excluded.duration_seconds, youtube_videos.duration_seconds),
             thumbnail_url=excluded.thumbnail_url,
             view_count=excluded.view_count,
             like_count=excluded.like_count,
             comment_count=excluded.comment_count,
             tags=excluded.tags,
             fetched_at=excluded.fetched_at""",
        (
            video_id,
            channel_id,
            channel_name,
            video_url,
            title,
            description,
            published_at,
            int(duration) if duration is not None else None,
            thumbnail_url,
            payload.get("view_count"),
            payload.get("like_count"),
            payload.get("comment_count"),
            tags_text,
            now,
        ),
    )


def backfill_retry_queue_video_metadata(conn: sqlite3.Connection, limit: int, timeout: int, yt_dlp_bin: str = "yt-dlp") -> dict[str, Any]:
    result: dict[str, Any] = {
        "metadata_before": retry_queue_video_metadata_summary(conn),
        "attempted": 0,
        "inserted": 0,
        "failed": 0,
        "failures": [],
    }
    if limit <= 0:
        return result
    rows = conn.execute(
        """SELECT DISTINCT rq.source_id AS video_id
           FROM retry_queue rq
           LEFT JOIN youtube_videos v ON v.video_id = rq.source_id
           LEFT JOIN youtube_transcripts t ON t.video_id = rq.source_id
           WHERE rq.source='youtube'
             AND rq.operation='fetch_transcript'
             AND rq.status='pending'
             AND COALESCE(t.transcript_status, 'missing') != 'fetched'
             AND (v.video_id IS NULL OR v.duration_seconds IS NULL)
           ORDER BY datetime(rq.next_retry_at) ASC, rq.retry_id ASC
           LIMIT ?""",
        (limit,),
    ).fetchall()
    for row in rows:
        video_id = str(row["video_id"] or "").strip()
        if not video_id:
            continue
        result["attempted"] = int(result["attempted"]) + 1
        payload, error = fetch_video_metadata(video_id, timeout=timeout, yt_dlp_bin=yt_dlp_bin)
        if payload is None:
            result["failed"] = int(result["failed"]) + 1
            failures = result["failures"]
            if isinstance(failures, list) and len(failures) < 5:
                failures.append({"video_id": video_id, "error": error})
            conn.execute(
                """UPDATE retry_queue
                   SET last_error=?
                   WHERE source='youtube'
                     AND operation='fetch_transcript'
                     AND status='pending'
                     AND source_id=?""",
                (f"metadata_backfill_failed:{error[:220]}", video_id),
            )
            continue
        upsert_video_metadata(conn, video_id, payload)
        result["inserted"] = int(result["inserted"]) + 1
    conn.commit()
    result["metadata_after"] = retry_queue_video_metadata_summary(conn)
    return result


def enqueue_retry_queue_caption_discovery(conn: sqlite3.Connection, min_duration: int, limit: int) -> dict[str, Any]:
    """Bridge legacy retry_queue transcript gaps into the subtitle-first job path.

    Weekly scanning can be complete while retry_queue still contains real
    fetch_transcript gaps. This function treats retry_queue as an explicit
    backfill source, but still avoids ASR and skips active/usable/short rows.
    """
    result: dict[str, Any] = {
        "pending_before": retry_queue_pending_summary(conn),
        "metadata_before": retry_queue_video_metadata_summary(conn),
        "scanned": 0,
        "enqueued": 0,
        "skipped_active_job": 0,
        "skipped_missing_video_metadata": 0,
        "skipped_short": 0,
        "skipped_usable": 0,
    }
    if limit <= 0:
        return result
    scan_limit = max(limit * 50, limit)
    rows = conn.execute(
        """SELECT rq.retry_id, rq.source_id AS video_id, v.duration_seconds,
                  t.source, t.quality_tier, t.char_count
           FROM retry_queue rq
           LEFT JOIN youtube_videos v ON v.video_id = rq.source_id
           LEFT JOIN youtube_transcripts t ON t.video_id = rq.source_id
           WHERE rq.source='youtube'
             AND rq.operation='fetch_transcript'
             AND rq.status='pending'
             AND COALESCE(t.transcript_status, 'missing') != 'fetched'
           ORDER BY datetime(rq.next_retry_at) ASC, rq.retry_id ASC
           LIMIT ?""",
        (scan_limit,),
    ).fetchall()
    result["scan_limit"] = scan_limit
    now = iso_z()
    for row in rows:
        if int(result["enqueued"]) >= limit:
            break
        result["scanned"] = int(result["scanned"]) + 1
        video_id = str(row["video_id"] or "")
        if not video_id or row["duration_seconds"] is None:
            result["skipped_missing_video_metadata"] = int(result["skipped_missing_video_metadata"]) + 1
            continue
        if is_usable(row):
            result["skipped_usable"] = int(result["skipped_usable"]) + 1
            continue
        if int(row["duration_seconds"]) < min_duration:
            result["skipped_short"] = int(result["skipped_short"]) + 1
            continue
        active = conn.execute(
            """SELECT 1 FROM youtube_transcript_jobs
               WHERE video_id=?
                 AND status IN ('pending','running')
               LIMIT 1""",
            (video_id,),
        ).fetchone()
        if active:
            result["skipped_active_job"] = int(result["skipped_active_job"]) + 1
            continue
        job_id = stable_job_id(video_id, "caption_discovery", "retry-queue-backfill")
        conn.execute(
            """INSERT INTO youtube_transcript_jobs
               (job_id, video_id, job_type, priority, status, backend, max_attempts, error_message, created_at)
               VALUES (?, ?, 'caption_discovery', 'P2', 'pending', 'subtitle-first', 3, ?, ?)
               ON CONFLICT(job_id) DO UPDATE SET
                 status=CASE
                   WHEN youtube_transcript_jobs.status IN ('succeeded','running')
                   THEN youtube_transcript_jobs.status ELSE 'pending' END,
                 next_retry_at=NULL,
                 backend='subtitle-first',
                 error_message=excluded.error_message""",
            (job_id, video_id, "retry-queue-backfill:pending_fetch_transcript", now),
        )
        conn.execute(
            """UPDATE retry_queue
               SET last_error=?
               WHERE retry_id=?""",
            (f"queued_transcript_job:{job_id}", row["retry_id"]),
        )
        result["enqueued"] = int(result["enqueued"]) + 1
    conn.commit()
    result["pending_after_enqueue"] = retry_queue_pending_summary(conn)
    result["metadata_after_enqueue"] = retry_queue_video_metadata_summary(conn)
    return result


def run_youtube_cli(db: Path, state_dir: Path, job_type: str, limit: int, timeout: int, dry_run: bool) -> dict[str, Any]:
    if limit <= 0:
        return {"job_count": 0, "processed": 0, "skipped": "limit<=0"}
    env = os.environ.copy()
    env["PYTHONPATH"] = f"{HARNESS_ROOT / 'lib'}:{env.get('PYTHONPATH', '')}"
    cmd = [
        sys.executable,
        "-m",
        "youtube.cli",
        "process-transcript-jobs",
        "--db",
        str(db),
        "--state-dir",
        str(state_dir),
        "--job-type",
        job_type,
        "--priority",
        "P0,P1,P2",
        "--limit",
        str(limit),
        "--timeout",
        str(timeout),
        "--json",
    ]
    if dry_run:
        cmd.append("--dry-run")
    proc = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, cwd=str(HARNESS_ROOT))
    text = proc.stdout or ""
    try:
        payload = json.loads(text[text.find("{"):]) if "{" in text else {}
    except Exception:
        payload = {"raw": text[-2000:]}
    payload["rc"] = proc.returncode
    if proc.returncode != 0:
        payload["error"] = text[-2000:]
    return payload


def pick_week(conn: sqlite3.Connection, weeks: list[str], min_duration: int, only_week: str = "") -> tuple[str | None, dict[str, Any]]:
    if only_week:
        return only_week, get_week_stats(conn, only_week, min_duration)
    for week in weeks:
        stats = get_week_stats(conn, week, min_duration)
        active = sum(stats["jobs"].get(status, 0) for status in ("pending", "running", "failed"))
        if stats["needs_backfill"] > 0 or active > 0:
            return week, stats
    return None, {}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Slow DB-native YouTube transcript weekly backfill")
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--state-dir", default=str(DEFAULT_STATE_DIR))
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--state-path", default=str(DEFAULT_STATE_PATH))
    parser.add_argument("--start-week", default="2026-W20")
    parser.add_argument("--end-week", default="2026-W01")
    parser.add_argument("--only-week", default="")
    parser.add_argument("--enqueue-limit", type=int, default=12)
    parser.add_argument("--short-mark-limit", type=int, default=50)
    parser.add_argument("--caption-limit", type=int, default=12)
    parser.add_argument("--subtitle-limit", type=int, default=12)
    parser.add_argument("--browser-limit", type=int, default=2)
    parser.add_argument("--retry-queue-limit", type=int, default=0)
    parser.add_argument("--retry-queue-metadata-limit", type=int, default=8)
    parser.add_argument("--metadata-timeout", type=int, default=30)
    parser.add_argument("--yt-dlp-bin", default=os.environ.get("YT_DLP_BIN", "yt-dlp"))
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    db = Path(args.db).expanduser()
    state_dir = Path(args.state_dir).expanduser()
    state_path = Path(args.state_path).expanduser()
    min_duration = load_min_duration(Path(args.config).expanduser())
    weeks = week_labels_newest_first(args.start_week, args.end_week)
    state = load_state(state_path)
    week: str | None = None

    try:
        conn = open_db(db)
        try:
            retry_queue_metadata_backfill = (
                backfill_retry_queue_video_metadata(
                    conn,
                    args.retry_queue_metadata_limit,
                    args.metadata_timeout,
                    args.yt_dlp_bin,
                )
                if not args.dry_run and args.retry_queue_limit > 0
                else {"metadata_before": retry_queue_video_metadata_summary(conn), "attempted": 0, "dry_run": bool(args.dry_run)}
            )
            retry_queue_backfill = (
                enqueue_retry_queue_caption_discovery(conn, min_duration, args.retry_queue_limit)
                if not args.dry_run
                else {"pending_before": retry_queue_pending_summary(conn), "enqueued": 0, "dry_run": True}
            )
            if int(retry_queue_backfill.get("enqueued") or 0) > 0:
                week = "retry_queue"
                before_stats = {
                    "week": week,
                    "videos": 0,
                    "usable": 0,
                    "short_or_below_threshold": retry_queue_backfill.get("skipped_short", 0),
                    "needs_backfill": sum(int(v) for v in (retry_queue_backfill.get("pending_before") or {}).values()),
                    "jobs": {},
                }
            else:
                retry_queue_pending_total = sum(int(v) for v in (retry_queue_backfill.get("pending_before") or {}).values())
                if retry_queue_pending_total > 0 and args.retry_queue_limit > 0:
                    state.update({
                        "last_run_at": iso_z(),
                        "status": "retry_queue_pending_no_enqueue",
                        "start_week": args.start_week,
                        "end_week": args.end_week,
                        "last_result": {
                            "retry_queue_metadata_backfill": retry_queue_metadata_backfill,
                            "retry_queue_backfill": retry_queue_backfill,
                        },
                    })
                    save_state(state_path, state)
                    print(
                        json.dumps(
                            {
                                "status": "retry_queue_pending_no_enqueue",
                                "message": "retry_queue has pending fetch_transcript rows, but no eligible subtitle-first jobs were enqueued",
                                "retry_queue_metadata_backfill": retry_queue_metadata_backfill,
                                "retry_queue_backfill": retry_queue_backfill,
                            },
                            ensure_ascii=False,
                            indent=2,
                        )
                    )
                    return 0
                week, before_stats = pick_week(conn, weeks, min_duration, args.only_week)
            if week is None:
                state.update({"last_run_at": iso_z(), "status": "complete", "start_week": args.start_week, "end_week": args.end_week})
                save_state(state_path, state)
                print(json.dumps({"status": "complete", "message": "all target weeks complete"}, ensure_ascii=False, indent=2))
                return 0

            purged_local_asr = 0 if args.dry_run or week == "retry_queue" else purge_local_asr_transcripts(conn, week)
            reconciled = {"to_browser_capture": 0, "to_metadata_only": 0, "asr_terminalized": 0}
            if not args.dry_run and week != "retry_queue":
                reconciled = reconcile_failed_jobs(conn, week, min_duration)
            if week != "retry_queue":
                before_stats = get_week_stats(conn, week, min_duration)
            short_marked = 0 if args.dry_run or week == "retry_queue" else mark_short_metadata(conn, week, min_duration, args.short_mark_limit)
            enqueued = (
                int(retry_queue_backfill.get("enqueued") or 0)
                if week == "retry_queue"
                else (0 if args.dry_run else enqueue_caption_discovery(conn, week, min_duration, args.enqueue_limit))
            )
        finally:
            conn.close()

        caption = run_youtube_cli(db, state_dir, "caption_discovery", args.caption_limit, args.timeout, args.dry_run)
        subtitle = run_youtube_cli(db, state_dir, "subtitle_download", args.subtitle_limit, args.timeout, args.dry_run)
        browser = run_youtube_cli(db, state_dir, "browser_capture", args.browser_limit, args.timeout, args.dry_run)

        conn = open_db(db)
        try:
            after_stats = (
                {
                    "week": "retry_queue",
                    "retry_queue_pending": retry_queue_pending_summary(conn),
                }
                if week == "retry_queue"
                else get_week_stats(conn, week, min_duration)
            )
        finally:
            conn.close()

        result = {
            "schema": "youtube-weekly-db-backfill-run.v1",
            "ran_at": iso_z(),
            "week": week,
            "min_duration_seconds": min_duration,
            "dry_run": bool(args.dry_run),
            "before": before_stats,
            "retry_queue_metadata_backfill": retry_queue_metadata_backfill,
            "retry_queue_backfill": retry_queue_backfill,
            "purged_local_asr_transcripts": purged_local_asr,
            "reconciled_failed_jobs": reconciled,
            "short_marked_metadata": short_marked,
            "caption_discovery_enqueued": enqueued,
            "processed": {
                "caption_discovery": caption,
                "subtitle_download": subtitle,
                "browser_capture": browser,
            },
            "after": after_stats,
        }
        next_status = (
            "retry_queue_processed"
            if week == "retry_queue"
            else ("pending_next_run" if after_stats.get("needs_backfill", 0) else "week_drained")
        )
        completed_weeks = list(state.get("completed_weeks") or [])
        if next_status == "week_drained" and week not in completed_weeks:
            completed_weeks.append(week)
        state.update({
            "last_run_at": result["ran_at"],
            "status": next_status,
            "active_week": week,
            "completed_weeks": completed_weeks,
            "last_result": result,
            "last_error": None,
            "start_week": args.start_week,
            "end_week": args.end_week,
        })
        save_state(state_path, state)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        record_failed_state(
            state_path,
            state,
            start_week=args.start_week,
            end_week=args.end_week,
            week=week,
            exc=exc,
        )
        print(
            json.dumps(
                {
                    "status": "failed",
                    "week": week,
                    "error_code": classify_error(exc),
                    "error_type": exc.__class__.__name__,
                    "message": str(exc),
                },
                ensure_ascii=False,
                indent=2,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
