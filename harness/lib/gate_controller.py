#!/usr/bin/env python3
"""Completion gate controller helpers."""
from __future__ import annotations

from typing import Any


def verdict_passed(verdict: dict[str, Any]) -> bool:
    return (
        str(verdict.get("trigger") or "") == "post_result"
        and str(verdict.get("status") or "") == "passed"
        and bool(verdict.get("verdict_id"))
        and bool(verdict.get("covered_result_id"))
    )


def completion_payload(verdict: dict[str, Any]) -> dict[str, Any]:
    return {
        "completion_source": "solar_gate_controller",
        "verifier_verdict_id": verdict.get("verdict_id"),
        "covered_result_id": verdict.get("covered_result_id"),
        "covered_attempt_id": verdict.get("covered_attempt_id"),
        "verifier_artifact": (verdict.get("artifacts") or {}).get("json"),
    }
