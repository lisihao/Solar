#!/usr/bin/env python3
"""Detect YouTube transcript upgrades that should reopen report planning."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

USABLE_SOURCES = {"standard_caption", "youtube_asr_caption", "youtube_auto_caption", "browser_caption"}
USABLE_TIERS = {"T0", "T1", "T2"}


def _parse_time(value: str) -> float:
    raw = str(value or "").strip()
    if not raw:
        return 0.0
    try:
        parsed = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.timestamp()
    except Exception:
        return 0.0


def _iso_from_epoch(value: float) -> str:
    if value <= 0:
        return ""
    return dt.datetime.fromtimestamp(value, tz=dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _local_business_date(value: str) -> dt.date | None:
    local_tz = ZoneInfo(os.environ.get("LOCAL_TZ", "America/Toronto"))
    try:
        parsed = dt.datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(local_tz).date()
    except Exception:
        try:
            return dt.date.fromisoformat(str(value or "")[:10])
        except Exception:
            return None


def _planned_root(knowledge_dir: Path) -> Path:
    return knowledge_dir / "_raw" / "tech-hotspot-radar" / "ai-influence-planned"


def _latest_plan_or_report_epoch(knowledge_dir: Path, report_date: str) -> float:
    date_root = _planned_root(knowledge_dir) / report_date
    if not date_root.exists():
        return 0.0
    candidates = [date_root / "report-plan.json"]
    reports_root = date_root / "reports"
    if reports_root.exists():
        candidates.extend(reports_root.glob("*/report.html"))
        candidates.extend(reports_root.glob("*/evidence-pack.json"))
        candidates.extend(reports_root.glob("*/mail-result.json"))
    latest = 0.0
    for path in candidates:
        try:
            if path.exists():
                latest = max(latest, path.stat().st_mtime)
        except OSError:
            continue
    return latest


def _reported_video_ids(knowledge_dir: Path) -> set[str]:
    root = _planned_root(knowledge_dir)
    if not root.exists():
        return set()
    reported: set[str] = set()
    for evidence_path in root.glob("*/reports/*/evidence-pack.json"):
        try:
            payload = json.loads(evidence_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        videos = payload.get("videos") if isinstance(payload, dict) else None
        if not isinstance(videos, list):
            continue
        for video in videos:
            if isinstance(video, dict):
                video_id = str(video.get("video_id") or "").strip()
                if video_id:
                    reported.add(video_id)
    return reported


def _eligible_rows(db: Path, window_start: dt.date, window_end: dt.date) -> list[dict[str, Any]]:
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """SELECT
                 v.video_id, v.title, v.channel_name, v.published_at,
                 t.source, t.quality_tier, t.char_count,
                 COALESCE(t.fetched_at, t.created_at, '') AS transcript_updated_at
               FROM youtube_videos v
               JOIN youtube_transcripts t USING(video_id)
               WHERE t.source IN ('standard_caption','youtube_asr_caption','youtube_auto_caption','browser_caption')
                 AND t.quality_tier IN ('T0','T1','T2')
                 AND t.char_count >= 200"""
        ).fetchall()
    finally:
        conn.close()
    eligible: list[dict[str, Any]] = []
    for row in rows:
        local_day = _local_business_date(str(row["published_at"] or ""))
        if local_day is None or not (window_start <= local_day < window_end):
            continue
        item = dict(row)
        item["local_date"] = local_day.isoformat()
        item["transcript_updated_epoch"] = _parse_time(str(item.get("transcript_updated_at") or ""))
        eligible.append(item)
    return eligible


def evaluate(db: Path, knowledge_dir: Path, report_date: str, window_start: str, window_end: str) -> dict[str, Any]:
    start_day = dt.date.fromisoformat(window_start)
    end_day = dt.date.fromisoformat(window_end)
    latest_epoch = _latest_plan_or_report_epoch(knowledge_dir, report_date)
    reported = _reported_video_ids(knowledge_dir)
    eligible = _eligible_rows(db, start_day, end_day)
    missing = [row for row in eligible if str(row.get("video_id") or "") not in reported]
    upgraded_after_latest = [
        row for row in missing
        if latest_epoch <= 0 or float(row.get("transcript_updated_epoch") or 0.0) > latest_epoch
    ]
    compact = []
    for row in upgraded_after_latest[:50]:
        compact.append({
            "video_id": row.get("video_id"),
            "title": row.get("title"),
            "channel": row.get("channel_name"),
            "published_at": row.get("published_at"),
            "quality_tier": row.get("quality_tier"),
            "source": row.get("source"),
            "char_count": row.get("char_count"),
            "transcript_updated_at": row.get("transcript_updated_at"),
        })
    return {
        "ok": True,
        "report_date": report_date,
        "window_start": start_day.isoformat(),
        "window_end_exclusive": end_day.isoformat(),
        "latest_plan_or_report_at": _iso_from_epoch(latest_epoch),
        "eligible_count": len(eligible),
        "missing_report_count": len(missing),
        "upgraded_after_latest_count": len(upgraded_after_latest),
        "should_replan": bool(upgraded_after_latest),
        "videos": compact,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Check whether YouTube report planning should reopen after transcript backfill")
    parser.add_argument("--db", required=True)
    parser.add_argument("--knowledge-dir", required=True)
    parser.add_argument("--report-date", required=True)
    parser.add_argument("--window-start", required=True)
    parser.add_argument("--window-end", required=True)
    parser.add_argument("--exit-code", action="store_true", help="Return 10 when should_replan=true, 0 otherwise")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    payload = evaluate(
        Path(args.db).expanduser(),
        Path(args.knowledge_dir).expanduser(),
        args.report_date,
        args.window_start,
        args.window_end,
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    if args.exit_code and payload.get("should_replan"):
        return 10
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
