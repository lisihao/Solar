#!/usr/bin/env python3
"""Profile Promotion DAG Scheduling Suggestion Generator.

Reads Pareto frontier candidates from state cache (or S03 lib if available),
generates a promotion-plan.json with DAG-structured promotion suggestions.
Hard-fail candidates are excluded with reasons recorded.
Does NOT dispatch sprints, write task_graph.json, or modify coordinator/autopilot.

Design: S04 §5.4, §6.4 — tools/profile_promotion_scheduler.py
"""
from __future__ import annotations

import json
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

HARNESS_ROOT = Path(__file__).resolve().parents[1]
STATE_DIR = HARNESS_ROOT / "state" / "profile-orchestration"
PLAN_PATH = STATE_DIR / "promotion-plan.json"

VALID_PHASES = ("proposed", "reviewed", "canary", "active", "rolled_back")

PROMOTION_PLAN_SCHEMA_KEYS = {
    "generated_at", "candidates_considered", "hard_fail_candidates", "plan",
}

PLAN_ENTRY_SCHEMA_KEYS = {
    "candidate_id", "profile_id", "digest_target", "phase",
    "depends_on", "acceptance", "evidence_required",
}

HARD_FAIL_ENTRY_KEYS = {"candidate_id", "reasons"}


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ensure_state_dir() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)


def _read_existing_plan() -> Optional[dict[str, Any]]:
    if PLAN_PATH.exists():
        try:
            data = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return None


def _validate_candidate(candidate: Any, index: int) -> list[str]:
    """Validate a single candidate dict. Returns list of error strings (empty = valid)."""
    errors: list[str] = []
    if not isinstance(candidate, dict):
        return [f"candidate[{index}] is not a dict"]

    cid = candidate.get("candidate_id")
    if not cid or not isinstance(cid, str):
        errors.append(f"candidate[{index}] missing or invalid candidate_id")

    pid = candidate.get("profile_id")
    if not pid or not isinstance(pid, str):
        errors.append(f"candidate[{index}] missing or invalid profile_id")

    digest = candidate.get("digest")
    if digest is not None and not isinstance(digest, str):
        errors.append(f"candidate[{index}] digest must be a string if present")

    scores = candidate.get("scores")
    if scores is not None and not isinstance(scores, dict):
        errors.append(f"candidate[{index}] scores must be a dict if present")

    return errors


def _is_hard_fail(candidate: dict[str, Any]) -> tuple[bool, list[str]]:
    """Check if a candidate has hard_fail flag set. Returns (is_hard_fail, reasons)."""
    reasons: list[str] = []
    hard_fail = candidate.get("hard_fail", False)

    if hard_fail is True:
        reasons.append("hard_fail=True in candidate metadata")

    fail_reasons = candidate.get("hard_fail_reasons")
    if isinstance(fail_reasons, list) and fail_reasons:
        reasons.extend(str(r) for r in fail_reasons)
    elif isinstance(fail_reasons, str) and fail_reasons:
        reasons.append(fail_reasons)

    return (bool(reasons), reasons) if reasons else (False, [])


def _build_plan_entry(candidate: dict[str, Any]) -> dict[str, Any]:
    """Build a promotion plan entry from a valid candidate."""
    return {
        "candidate_id": candidate["candidate_id"],
        "profile_id": candidate["profile_id"],
        "digest_target": candidate.get("digest", ""),
        "phase": "proposed",
        "depends_on": candidate.get("depends_on", []),
        "acceptance": [
            "compile_eval_score >= current_active",
            "no regression on hard validators",
        ],
        "evidence_required": [
            "compile_eval trace with score",
            "validator hit summary",
            "ASI digest comparison",
        ],
    }


def _validate_plan_schema(plan: dict[str, Any]) -> list[str]:
    """Validate the output plan against the design schema. Returns error list."""
    errors: list[str] = []
    missing = PROMOTION_PLAN_SCHEMA_KEYS - set(plan.keys())
    if missing:
        errors.append(f"missing top-level keys: {sorted(missing)}")

    for i, entry in enumerate(plan.get("plan", [])):
        emissing = PLAN_ENTRY_SCHEMA_KEYS - set(entry.keys())
        if emissing:
            errors.append(f"plan[{i}] missing keys: {sorted(emissing)}")

    for i, hf in enumerate(plan.get("hard_fail_candidates", [])):
        hfmissing = HARD_FAIL_ENTRY_KEYS - set(hf.keys())
        if hfmissing:
            errors.append(f"hard_fail_candidates[{i}] missing keys: {sorted(hfmissing)}")

    return errors


def generate_promotion_plan(
    candidates: list[dict[str, Any]],
    *,
    force: bool = False,
) -> dict[str, Any]:
    """Generate promotion plan from candidate list.

    Args:
        candidates: List of candidate dicts from Pareto frontier.
        force: If True, overwrite even when candidates list is empty/invalid.

    Returns:
        Dict with keys: ok, plan_path, count, hard_fail_count, generated_at,
        warnings (if any).
    """
    warnings: list[str] = []

    # Validate all candidates first
    valid_candidates: list[dict[str, Any]] = []
    all_valid = True
    for i, c in enumerate(candidates):
        errs = _validate_candidate(c, i)
        if errs:
            all_valid = False
            warnings.append(f"invalid candidate skipped: {errs}")
        else:
            valid_candidates.append(c)

    if not valid_candidates and not force:
        existing = _read_existing_plan()
        warning_msg = (
            f"no valid candidates ({len(candidates)} input, "
            f"{len(warnings)} validation errors); "
            f"preserving existing plan"
        )
        warnings.insert(0, warning_msg)
        return {
            "ok": False,
            "plan_path": str(PLAN_PATH),
            "count": 0,
            "hard_fail_count": 0,
            "generated_at": _utc_now(),
            "warnings": warnings,
            "existing_plan_preserved": existing is not None,
        }

    # Separate hard-fail from promotable
    hard_fail_entries: list[dict[str, Any]] = []
    promotable: list[dict[str, Any]] = []

    for c in valid_candidates:
        is_hf, reasons = _is_hard_fail(c)
        if is_hf:
            hard_fail_entries.append({
                "candidate_id": c.get("candidate_id", "unknown"),
                "reasons": reasons,
            })
        else:
            promotable.append(c)

    plan_entries = [_build_plan_entry(c) for c in promotable]

    plan = {
        "generated_at": _utc_now(),
        "candidates_considered": len(valid_candidates),
        "hard_fail_candidates": hard_fail_entries,
        "plan": plan_entries,
    }

    # Schema self-check
    schema_errors = _validate_plan_schema(plan)
    if schema_errors:
        existing = _read_existing_plan()
        warnings.append(f"schema validation failed: {schema_errors}; preserving existing plan")
        return {
            "ok": False,
            "plan_path": str(PLAN_PATH),
            "count": 0,
            "hard_fail_count": len(hard_fail_entries),
            "generated_at": plan["generated_at"],
            "warnings": warnings,
            "schema_errors": schema_errors,
            "existing_plan_preserved": existing is not None,
        }

    # Write plan
    _ensure_state_dir()
    PLAN_PATH.write_text(json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    result: dict[str, Any] = {
        "ok": True,
        "plan_path": str(PLAN_PATH),
        "count": len(plan_entries),
        "hard_fail_count": len(hard_fail_entries),
        "generated_at": plan["generated_at"],
    }
    if warnings:
        result["warnings"] = warnings

    return result


def _load_candidates_from_state() -> list[dict[str, Any]]:
    """Try to load candidates from state cache or S03 lib."""
    cache_path = STATE_DIR / "pareto-candidates.json"
    if cache_path.exists():
        try:
            data = json.loads(cache_path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return data
            if isinstance(data, dict) and "candidates" in data:
                return data["candidates"]
        except (json.JSONDecodeError, OSError):
            pass

    # Try S03 lib if available
    try:
        from lib.compiler_profile.registry import list_pareto_candidates  # type: ignore[import-untyped]
        return list_pareto_candidates()
    except (ImportError, Exception):
        pass

    return []


def main(argv: list[str] | None = None) -> int:
    """CLI entry point for standalone execution."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Generate profile promotion plan from Pareto frontier candidates",
    )
    parser.add_argument(
        "--candidates-file",
        type=str,
        default=None,
        help="JSON file with candidates array (default: read from state cache)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        default=False,
        help="Generate plan even with no valid candidates (overwrites empty)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Print plan to stdout without writing file",
    )
    args = parser.parse_args(argv)

    if args.candidates_file:
        try:
            raw = json.loads(Path(args.candidates_file).read_text(encoding="utf-8"))
            if isinstance(raw, list):
                candidates = raw
            elif isinstance(raw, dict) and "candidates" in raw:
                candidates = raw["candidates"]
            else:
                print(f"Error: unexpected format in {args.candidates_file}", file=sys.stderr)
                return 1
        except (json.JSONDecodeError, OSError) as e:
            print(f"Error reading {args.candidates_file}: {e}", file=sys.stderr)
            return 1
    else:
        candidates = _load_candidates_from_state()

    if args.dry_run:
        # Dry-run: generate plan but write to stdout, not to file
        _ensure_state_dir()
        valid_candidates: list[dict[str, Any]] = []
        for i, c in enumerate(candidates):
            errs = _validate_candidate(c, i)
            if not errs:
                valid_candidates.append(c)

        hard_fail_entries: list[dict[str, Any]] = []
        promotable: list[dict[str, Any]] = []
        for c in valid_candidates:
            is_hf, reasons = _is_hard_fail(c)
            if is_hf:
                hard_fail_entries.append({
                    "candidate_id": c.get("candidate_id", "unknown"),
                    "reasons": reasons,
                })
            else:
                promotable.append(c)

        plan = {
            "generated_at": _utc_now(),
            "candidates_considered": len(valid_candidates),
            "hard_fail_candidates": hard_fail_entries,
            "plan": [_build_plan_entry(c) for c in promotable],
        }
        print(json.dumps(plan, indent=2, ensure_ascii=False))
        return 0

    result = generate_promotion_plan(candidates, force=args.force)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
