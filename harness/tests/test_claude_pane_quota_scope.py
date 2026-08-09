from __future__ import annotations

import sys
from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "lib"
if str(LIB) not in sys.path:
    sys.path.insert(0, str(LIB))

import operator_flow_control as ofc  # noqa: E402


SONNET_OPERATOR = {
    "provider": "anthropic",
    "backend": "claude-cli",
    "model": "sonnet",
    "surface": {"type": "claude_code_interactive"},
}


def test_claude_subscription_ignores_non_claude_api_balance_429() -> None:
    evidence = """
    API Error: 429
    {"type":"error","error":{"type":"rate_limit_error","code":"1113",
    "message":"[1113][Insufficient balance or no resource package. Please recharge.]"}}
    """

    assert not ofc._claude_quota_evidence_matches_operator(
        "mini-claude-sonnet-builder",
        SONNET_OPERATOR,
        evidence,
    )


def test_claude_subscription_accepts_matching_sonnet_usage_limit() -> None:
    evidence = "Claude Code: You've hit your limit for claude sonnet; try again at 8:39 AM"

    assert ofc._claude_quota_evidence_matches_operator(
        "mini-claude-sonnet-builder",
        SONNET_OPERATOR,
        evidence,
    )


def test_claude_subscription_rejects_cross_model_quota_text() -> None:
    evidence = "Claude Opus: You've hit your limit; resets at 8pm (America/Toronto)"

    assert not ofc._claude_quota_evidence_matches_operator(
        "mini-claude-sonnet-builder",
        SONNET_OPERATOR,
        evidence,
    )


def test_persist_operator_block_rejects_non_claude_pane_429(tmp_path, monkeypatch) -> None:
    registry = tmp_path / "physical-operators.json"
    registry.write_text(
        json.dumps(
            {
                "operators": {
                    "mini-claude-sonnet-builder": {
                        **SONNET_OPERATOR,
                        "enabled": True,
                        "available": True,
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(ofc, "PHYSICAL_OPERATORS_PATH", registry)

    result = ofc.persist_operator_block(
        "mini-claude-sonnet-builder",
        "cooldown",
        reason="pane_tui_rate_limit_fallback_ttl",
        source="tmux_pane:solar-harness-lab:0.3",
        evidence_text="API Error: 429 rate_limit_error code 1113 Insufficient balance or no resource package. Please recharge.",
    )

    assert result["ok"] is False
    assert result["reason"] == "claude_pane_quota_model_mismatch"
    updated = json.loads(registry.read_text(encoding="utf-8"))
    assert updated["operators"]["mini-claude-sonnet-builder"].get("quota_guard_state") is None
