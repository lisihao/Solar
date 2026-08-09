#!/usr/bin/env python3
"""Record operator quota observations into the cooldown control plane."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


HARNESS_DIR = Path(__file__).resolve().parents[1]
LIB_DIR = HARNESS_DIR / "lib"
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))

import operator_cooldown_db  # type: ignore


def _load_registry(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"operators": {}}
    return data if isinstance(data, dict) else {"operators": {}}


def _operator_model_key(op: dict[str, Any]) -> str:
    builder_pool = op.get("builder_pool") if isinstance(op.get("builder_pool"), dict) else {}
    group = str(builder_pool.get("group") or "").strip()
    if group:
        return group
    model = str(op.get("model") or "").strip()
    if "gpt-5.3-codex-spark" in model:
        return "codex-gpt-5.3-spark"
    if "gpt-5.5" in model:
        return "codex-gpt-5.5"
    return model


def _select_operator_ids(registry: dict[str, Any], args: argparse.Namespace) -> list[str]:
    selected: list[str] = []
    operators = registry.get("operators") if isinstance(registry.get("operators"), dict) else {}
    for op_id in args.operator_id or []:
        op_id = str(op_id).strip()
        if op_id:
            selected.append(op_id)
    model_key = str(args.model_key or "").strip()
    if model_key:
        for op_id, op in operators.items():
            if not isinstance(op, dict):
                continue
            if _operator_model_key(op) == model_key:
                selected.append(str(op_id))
    return sorted(set(selected))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operator-id", action="append", default=[], help="Operator id to record against. Repeatable.")
    parser.add_argument("--model-key", default="", help="Record for every registry operator in this model/group.")
    parser.add_argument("--provider", default="", help="Quota provider, for example openai or anthropic.")
    parser.add_argument("--billing-pool", default="", help="Billing pool identifier.")
    parser.add_argument("--key-ref", default="", help="Credential/subscription reference.")
    parser.add_argument("--scope", default="operator_id", help="Block scope: operator_id, model_key, billing_pool, account.")
    parser.add_argument("--window", default="", help="Quota window, for example 5h, weekly, monthly.")
    parser.add_argument("--remaining-percent", type=float, required=True, help="Remaining quota percent from UI/probe.")
    parser.add_argument("--reset-at", default="", help="Reset time as ISO-8601 UTC when known.")
    parser.add_argument("--observed-at", default="", help="Observation time as ISO-8601 UTC. Defaults to now.")
    parser.add_argument("--source", default="manual_user_ui_quota_evidence", help="Evidence source label.")
    parser.add_argument("--evidence-ref", default="", help="Stable evidence reference.")
    parser.add_argument("--evidence-path", default="", help="Optional evidence file path.")
    parser.add_argument("--evidence-excerpt", default="", help="Short quota evidence excerpt.")
    parser.add_argument("--registry", type=Path, default=HARNESS_DIR / "config" / "physical-operators.json")
    parser.add_argument("--db-path", type=Path, default=None)
    parser.add_argument("--json", action="store_true", help="Print machine-readable result.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    registry = _load_registry(args.registry)
    operators = registry.get("operators") if isinstance(registry.get("operators"), dict) else {}
    operator_ids = _select_operator_ids(registry, args)
    if not operator_ids:
        print("ERROR: no operators selected; pass --operator-id or --model-key", file=sys.stderr)
        return 2

    results = []
    for op_id in operator_ids:
        op = operators.get(op_id) if isinstance(operators.get(op_id), dict) else {}
        model_key = str(args.model_key or _operator_model_key(op) or "").strip()
        provider = str(args.provider or op.get("provider") or "").strip()
        billing_pool = str(args.billing_pool or op.get("billing_pool") or "").strip()
        key_ref = str(args.key_ref or op.get("key_ref") or "").strip()
        result = operator_cooldown_db.record_quota_observation(
            op_id,
            provider=provider,
            model_key=model_key,
            billing_pool=billing_pool,
            key_ref=key_ref,
            scope=args.scope,
            quota_window=args.window,
            remaining_percent=args.remaining_percent,
            reset_at=args.reset_at,
            observed_at=args.observed_at or None,
            source=args.source,
            evidence_ref=args.evidence_ref,
            evidence_path=args.evidence_path,
            evidence_excerpt=args.evidence_excerpt,
            db_path=args.db_path,
        )
        results.append(result)

    payload = {
        "ok": all(bool(item.get("ok")) for item in results),
        "selected": operator_ids,
        "count": len(operator_ids),
        "active_blocks": sum(1 for item in results if item.get("active_block")),
        "results": results,
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(
            f"quota_observation ok={payload['ok']} selected={payload['count']} "
            f"active_blocks={payload['active_blocks']}"
        )
        for item in results:
            print(
                f"- {item.get('operator_id')}: remaining={item.get('remaining_percent')} "
                f"reset_at={item.get('reset_at') or 'N/A'} active_block={item.get('active_block')}"
            )
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
