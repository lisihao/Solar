from __future__ import annotations

import importlib.util
import datetime as dt
import json
import sys
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "ai_influence_daily.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("solar_ai_influence_daily_recency_test", str(SCRIPT))
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_filter_recent_candidates_excludes_posts_older_than_30_days():
    mod = _load_module()
    candidates = [
        mod.Candidate(
            handle="fresh",
            text="recent agent workflow update",
            tweet_url="https://x.com/fresh/status/1",
            published_at="2026-05-25T10:00:00Z",
            source_method="dom_direct",
        ),
        mod.Candidate(
            handle="old",
            text="old pinned vibe coding thread",
            tweet_url="https://x.com/old/status/2",
            published_at="2026-02-02T10:00:00Z",
            source_method="dom_direct",
        ),
    ]

    recent, stale, missing = mod.filter_recent_candidates(
        candidates,
        date_str="2026-05-30",
        max_age_days=30,
    )

    assert [c.handle for c in recent] == ["fresh"]
    assert [c.handle for c in stale] == ["old"]
    assert missing == []


def test_rank_candidates_prefers_newer_post_on_score_tie():
    mod = _load_module()
    older = mod.Candidate(
        handle="older",
        text="agent workflow prompt template",
        tweet_url="https://x.com/older/status/1",
        published_at="2026-05-10T10:00:00Z",
        source_method="dom_direct",
    )
    newer = mod.Candidate(
        handle="newer",
        text="agent workflow prompt template",
        tweet_url="https://x.com/newer/status/2",
        published_at="2026-05-29T10:00:00Z",
        source_method="dom_direct",
    )

    ranked = mod.rank_candidates([older, newer], top_n=2)

    assert [c.handle for c in ranked] == ["newer", "older"]


def test_filter_pinned_candidates_excludes_pinned_rows():
    mod = _load_module()
    candidates = [
        mod.Candidate(
            handle="pinned",
            text="Pinned AI course launch",
            tweet_url="https://x.com/pinned/status/1",
            published_at="2026-05-29T10:00:00Z",
            source_method="dom_direct",
            is_pinned=True,
        ),
        mod.Candidate(
            handle="fresh",
            text="new agent workflow drop",
            tweet_url="https://x.com/fresh/status/2",
            published_at="2026-05-29T11:00:00Z",
            source_method="dom_direct",
        ),
    ]

    kept, pinned = mod.filter_pinned_candidates(candidates)

    assert [c.handle for c in kept] == ["fresh"]
    assert [c.handle for c in pinned] == ["pinned"]


def test_prune_recent_per_handle_keeps_latest_four():
    mod = _load_module()
    candidates = [
        mod.Candidate(
            handle="same",
            text=f"workflow update {idx}",
            tweet_url=f"https://x.com/same/status/{idx}",
            published_at=f"2026-05-{idx:02d}T10:00:00Z",
            source_method="dom_direct",
        )
        for idx in range(20, 26)
    ]

    kept, overflow = mod.prune_recent_per_handle(candidates, max_per_handle=4)

    assert [c.published_at for c in kept] == [
        "2026-05-25T10:00:00Z",
        "2026-05-24T10:00:00Z",
        "2026-05-23T10:00:00Z",
        "2026-05-22T10:00:00Z",
    ]
    assert len(overflow) == 2


def test_existing_digest_collection_count_reads_candidate_pool(tmp_path):
    mod = _load_module()
    digest_dir = tmp_path / "2026-06-05"
    digest_dir.mkdir()
    (digest_dir / "candidate-pool.json").write_text(
        '{"stats":{"total_collected":267,"fresh_candidates":49}}',
        encoding="utf-8",
    )

    assert mod._existing_digest_collection_count(digest_dir) == 267


def test_existing_digest_collection_count_returns_zero_for_empty_or_missing(tmp_path):
    mod = _load_module()
    digest_dir = tmp_path / "2026-06-05"
    digest_dir.mkdir()
    (digest_dir / "candidate-pool.json").write_text(
        '{"stats":{"total_collected":0}}',
        encoding="utf-8",
    )

    assert mod._existing_digest_collection_count(digest_dir) == 0


def test_chatgpt_grouped_prompt_contains_all_candidates():
    mod = _load_module()
    candidates = [
        mod.Candidate(
            handle="a",
            text="agent workflow update",
            tweet_url="https://x.com/a/status/1",
            published_at="2026-06-05T10:00:00Z",
            source_method="dom_direct",
            raw_score=5,
        ),
        mod.Candidate(
            handle="b",
            text="coding model release",
            tweet_url="https://x.com/b/status/2",
            published_at="2026-06-05T11:00:00Z",
            source_method="dom_direct",
            raw_score=3,
        ),
    ]

    prompt = mod._build_chatgpt_grouped_analysis_prompt(candidates, date_str="2026-06-05")

    assert "candidate_count: 2" in prompt
    assert "https://x.com/a/status/1" in prompt
    assert "https://x.com/b/status/2" in prompt
    assert "输出 JSON object" in prompt


def test_analyze_with_chatgpt_grouped_uses_report_operator(monkeypatch, tmp_path):
    mod = _load_module()
    wrapper = tmp_path / "fake_wrapper.py"
    wrapper.write_text(
        "\n".join([
            "import json, os, pathlib, sys",
            "request_dir = pathlib.Path(os.environ['BROWSER_AGENT_REQUEST_DIR'])",
            "request_dir.mkdir(parents=True, exist_ok=True)",
            "(request_dir / 'chatgpt-mode-state.json').write_text('{\"ok\": true}', encoding='utf-8')",
            "prompt = sys.stdin.read()",
            "(request_dir / 'seen-prompt.txt').write_text(prompt, encoding='utf-8')",
            "print(json.dumps({'analysis_status':'ok_chatgpt_grouped','model':'fake-chatgpt','items':[{'handle':'@a','title':'Agent workflow','type':'💡工作流','summary':'把 agent 工作流变成可执行实践。','key_points':['工作流','工具调用'],'why_useful':'可用于判断 agent 工程化趋势。','hotness':'⭐4','tweet_url':'https://x.com/a/status/1'}]}, ensure_ascii=False))",
        ]),
        encoding="utf-8",
    )
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_WRAPPER_CMD", f"{sys.executable} {wrapper}")
    monkeypatch.setenv("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_DISABLED", "1")
    monkeypatch.setenv("AI_INFLUENCE_CHATGPT_REPORT_OPERATOR", str(Path(__file__).resolve().parents[1] / "tools" / "chatgpt_report_operator.py"))
    monkeypatch.setenv("AI_INFLUENCE_CHATGPT_COOLDOWN_FILE", str(tmp_path / "cooldown-until"))
    monkeypatch.setenv("AI_INFLUENCE_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("BROWSER_AGENT_QUEUE_DIR", str(tmp_path / "browser-agent-queue"))
    monkeypatch.setenv("BROWSER_AGENT_QUEUE_BYPASS", "1")

    result = mod.analyze_with_chatgpt_grouped(
        [
            mod.Candidate(
                handle="a",
                text="agent workflow update",
                tweet_url="https://x.com/a/status/1",
                published_at="2026-06-05T10:00:00Z",
                source_method="dom_direct",
                raw_score=5,
            ),
        ],
        top_n=1,
        date_str="2026-06-05",
    )

    assert result["analysis_status"] == "ok_chatgpt_grouped"
    assert result["model"] == "fake-chatgpt"
    assert result["items"][0]["tweet_url"] == "https://x.com/a/status/1"


def test_chatgpt_rate_limit_detection_handles_cloudflare_and_chinese_text():
    mod = _load_module()

    assert mod._is_browser_agent_rate_limited_error("RuntimeError: chatgpt_cloudflare_challenge_detected")
    assert mod._is_browser_agent_rate_limited_error("你的请求过于频繁。请稍等几分钟后再重试。")
    assert not mod._is_browser_agent_rate_limited_error("plain validation error")


def test_default_chatgpt_grouped_respects_cooldown(monkeypatch, tmp_path):
    mod = _load_module()
    cooldown = tmp_path / "cooldown-until"
    future = dt.datetime.now(dt.UTC) + dt.timedelta(minutes=10)
    cooldown.write_text(future.isoformat().replace("+00:00", "Z") + "\n", encoding="utf-8")
    monkeypatch.setenv("AI_INFLUENCE_CHATGPT_COOLDOWN_FILE", str(cooldown))
    monkeypatch.setattr(mod, "DEFAULT_ANALYZER", "chatgpt_grouped")

    analysis = mod._analyze_with_default_model(
        [
            mod.Candidate(
                handle="a",
                text="agent workflow update",
                tweet_url="https://x.com/a/status/1",
                published_at="2026-06-05T10:00:00Z",
                source_method="dom_direct",
                raw_score=5,
            ),
        ],
        1,
        date_str="2026-06-05",
    )

    assert analysis["analysis_status"] == "chatgpt_grouped_cooldown_local"
    assert "chatgpt_grouped_cooldown_active" in analysis["chatgpt_error"]
