#!/usr/bin/env python3
"""Regression test: graph_node_dispatcher dispatch logic.

Validates: pane availability checks, dispatch ID generation,
           rate-limit detection patterns, contract closeout cooldown.
All calls hit real lib/graph_node_dispatcher.py — no mocks.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "lib"))

import graph_node_dispatcher

REPORT_DIR = Path(os.environ.get("HARNESS_DIR", Path.home() / ".solar" / "harness")) / "reports" / "s05" / "regression"


def test_rate_limit_patterns(tmp: Path, sid: str) -> dict:
    """Regex patterns detect rate-limit and quota-exhausted pane output."""
    busy = "You've hit your limit. Please try again later."
    quota = "RESOURCE_EXHAUSTED: Your monthly usage limit has been exceeded"
    normal = "Builder ready to execute task."

    busy_match = bool(graph_node_dispatcher.PANE_TUI_UNAVAILABLE_RE.search(busy))
    quota_match = bool(graph_node_dispatcher.PANE_QUOTA_EXHAUSTED_RE.search(quota))
    normal_busy = bool(graph_node_dispatcher.PANE_TUI_UNAVAILABLE_RE.search(normal))
    normal_quota = bool(graph_node_dispatcher.PANE_QUOTA_EXHAUSTED_RE.search(normal))

    assert busy_match, "should detect rate-limit text"
    assert quota_match, "should detect quota-exhausted text"
    assert not normal_busy, "normal output should not trigger busy pattern"
    assert not normal_quota, "normal output should not trigger quota pattern"
    return {
        "case": "rate_limit_patterns",
        "busy_detected": busy_match,
        "quota_detected": quota_match,
        "normal_clean": not (normal_busy or normal_quota),
    }


def test_tui_busy_patterns(tmp: Path, sid: str) -> dict:
    """TUI busy regex matches Claude CLI busy indicators."""
    busy_outputs = [
        "✳ Thinking…",
        "Compacting conversation",
        "Reticulating splines…",
        "Smooshing something…",
    ]
    clean_outputs = [
        "Task completed successfully",
        "exit code: 0",
    ]

    detected = sum(1 for t in busy_outputs if graph_node_dispatcher.PANE_TUI_BUSY_RE.search(t))
    false_pos = sum(1 for t in clean_outputs if graph_node_dispatcher.PANE_TUI_BUSY_RE.search(t))

    assert detected == len(busy_outputs), f"missed busy patterns: {detected}/{len(busy_outputs)}"
    assert false_pos == 0, f"false positives: {false_pos}"
    return {
        "case": "tui_busy_patterns",
        "detected": detected,
        "expected": len(busy_outputs),
        "false_positives": false_pos,
    }


def test_effective_max_parallel(tmp: Path, sid: str) -> dict:
    """effective_graph_max_parallel returns a positive integer."""
    max_p = graph_node_dispatcher._effective_graph_max_parallel(default=8)
    assert isinstance(max_p, int) and max_p > 0, f"invalid max_parallel: {max_p}"
    return {"case": "effective_max_parallel", "value": max_p}


def test_cooldown_defaults(tmp: Path, sid: str) -> dict:
    """Cooldown constants are reasonable positive integers."""
    recover = graph_node_dispatcher.PANE_RECOVER_COOLDOWN_SEC
    rate_limit = graph_node_dispatcher.PANE_RATE_LIMIT_FALLBACK_SEC
    closeout = graph_node_dispatcher.OPERATOR_CONTRACT_CLOSEOUT_COOLDOWN_SEC

    assert recover > 0, f"recover cooldown: {recover}"
    assert rate_limit > 0, f"rate limit cooldown: {rate_limit}"
    assert closeout > 0, f"closeout cooldown: {closeout}"
    return {
        "case": "cooldown_defaults",
        "recover_sec": recover,
        "rate_limit_sec": rate_limit,
        "closeout_sec": closeout,
    }


def main() -> int:
    sid = "regression-test-triface-gnd"
    errors = []
    results = []

    with tempfile.TemporaryDirectory(prefix="solar-reg-gnd-") as tmp_str:
        tmp = Path(tmp_str)
        os.environ["HARNESS_DIR"] = str(tmp)

        tests = [
            ("rate_limit_patterns", test_rate_limit_patterns),
            ("tui_busy_patterns", test_tui_busy_patterns),
            ("effective_max_parallel", test_effective_max_parallel),
            ("cooldown_defaults", test_cooldown_defaults),
        ]

        for name, fn in tests:
            try:
                r = fn(tmp, sid)
                r["verdict"] = "PASS"
                results.append(r)
                print(f"  PASS: {name}")
            except Exception as e:
                results.append({"case": name, "verdict": "FAIL", "error": str(e)})
                errors.append((name, str(e)))
                print(f"  FAIL: {name} — {e}")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {"suite": "graph_node_dispatcher", "results": results, "total": len(results), "passed": len(results) - len(errors)}
    report_path = REPORT_DIR / "graph_node_dispatcher.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"Report: {report_path}")

    if errors:
        for name, err in errors:
            print(f"FAIL: {name} — {err}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
