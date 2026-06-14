from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import youtube_influence_digest as yid


def _base_meta() -> dict[str, str]:
    return {
        "video_id": "abc123xyz00",
        "channel_id": "chan1",
        "channel_name": "Demo Channel",
        "category": "AI / Tech",
        "priority": "tier1",
        "title": "Build an AI agent demo with tools",
        "url": "https://www.youtube.com/watch?v=abc123xyz00",
        "published_at": "2026-05-30T10:00:00Z",
        "fetched_at": "2026-05-30T11:00:00Z",
        "source": "fixture:feed",
    }


def test_assess_transcript_quality_marks_short_text_t3():
    result = yid.assess_transcript_quality(
        meta=_base_meta(),
        transcript="bad",
        status="ok_asr",
        source="browser_agent_operator:abc123xyz00",
        config={"analysis_keywords": {"agent": ["agent", "tools"]}},
    )
    assert result["tier"] == "T3"
    assert result["status"] == "degraded"


def test_render_transcript_for_report_hides_t3_body():
    video = yid.build_video(
        _base_meta(),
        "bad",
        "ok_asr",
        "browser_agent_operator:abc123xyz00",
        {"analysis_keywords": {"agent": ["agent", "tools"]}},
    )
    rendered = yid.render_transcript_for_report(video)
    assert "质量门禁判定为 `T3`" in rendered


def test_resolve_browser_agent_target_account_email_reads_profile_policy(tmp_path: Path):
    policy = tmp_path / "browser-policy.json"
    policy.write_text(
        json.dumps(
            {
                "policies": {
                    "youtube_transcript": {
                        "expected_account_email": "yt-account@example.invalid",
                    },
                },
            }
        ),
        encoding="utf-8",
    )

    assert yid._resolve_browser_agent_target_account_email({
        "BROWSER_AGENT_YOUTUBE_PROFILE_POLICY_FILE": str(policy),
    }) == "yt-account@example.invalid"


def test_resolve_browser_agent_target_account_email_without_config_is_empty(tmp_path: Path):
    missing_policy = tmp_path / "missing.json"

    assert yid._resolve_browser_agent_target_account_email({
        "BROWSER_AGENT_YOUTUBE_PROFILE_POLICY_FILE": str(missing_policy),
    }) == ""
