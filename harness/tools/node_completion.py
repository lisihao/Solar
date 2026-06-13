#!/usr/bin/env python3
"""Node completion CLI backed by CompletionPipeline."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


HARNESS_DIR = Path(__file__).resolve().parents[1]
LIB_DIR = HARNESS_DIR / "lib"
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from completion_pipeline import OperatorResult, submit_result  # type: ignore  # noqa: E402
from post_result_verifier import verify_operator_result  # type: ignore  # noqa: E402
from session_log import SessionLog  # type: ignore  # noqa: E402


def _operator_result(args: argparse.Namespace) -> OperatorResult:
    return OperatorResult(
        session_id=args.session_id,
        node_id=args.node_id,
        attempt_id=args.attempt_id,
        result_id=args.result_id,
        artifact_manifest=args.artifact_manifest,
        handoff_path=args.handoff,
        eval_path=args.eval,
        write_scope=args.write_scope or [],
        operator_status="done",
        run_dir=args.run_dir,
    )


def cmd_submit_or_finalize(args: argparse.Namespace) -> tuple[dict, int]:
    result = submit_result(_operator_result(args), harness_dir=HARNESS_DIR)
    return result, 0 if result.get("status") == "completed" else 2


def cmd_verify(args: argparse.Namespace) -> tuple[dict, int]:
    result = _operator_result(args).normalized()
    verifier_dir = Path(args.run_dir or (HARNESS_DIR / "runs" / args.session_id / args.node_id)) / "verifier"
    payload = verify_operator_result(result, verifier_dir)
    return payload, 0 if payload.get("status") == "passed" else 2


def cmd_force_complete(args: argparse.Namespace) -> tuple[dict, int]:
    if not args.exception_id:
        return {"ok": False, "reason": "exception_id_required"}, 2
    log = SessionLog(args.session_id, harness_dir=str(HARNESS_DIR))
    waiver_payload = {
        "node_id": args.node_id,
        "exception_id": args.exception_id,
        "reason": args.reason,
        "severity": "break_glass",
    }
    waiver_event = log.append(
        "verifier.waiver.applied",
        actor="gate_controller",
        source="node_completion",
        sprint_id=args.session_id,
        activity_id=args.node_id,
        payload=waiver_payload,
        writer_role="gate_controller",
    )
    completed_event = log.append(
        "node.completed",
        actor="gate_controller",
        source="node_completion",
        sprint_id=args.session_id,
        activity_id=args.node_id,
        payload={
            "completion_source": "break_glass",
            "exception_id": args.exception_id,
            "waiver_event_id": waiver_event,
            "node_id": args.node_id,
        },
        writer_role="gate_controller",
    )
    return {"ok": True, "waiver_event_id": waiver_event, "completed_event_id": completed_event}, 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Solar node completion gate CLI")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("submit-result", "finalize", "verify-result"):
        p = sub.add_parser(name)
        p.add_argument("--session-id", required=True)
        p.add_argument("--node-id", required=True)
        p.add_argument("--attempt-id", default="attempt-1")
        p.add_argument("--result-id", default="")
        p.add_argument("--artifact-manifest", default="")
        p.add_argument("--handoff", default="")
        p.add_argument("--eval", default="")
        p.add_argument("--write-scope", action="append", default=[])
        p.add_argument("--run-dir", default="")
        p.add_argument("--json", action="store_true")
    force = sub.add_parser("force-complete")
    force.add_argument("--session-id", required=True)
    force.add_argument("--node-id", required=True)
    force.add_argument("--exception-id", required=True)
    force.add_argument("--reason", default="")
    force.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    if args.command in {"submit-result", "finalize"}:
        payload, rc = cmd_submit_or_finalize(args)
    elif args.command == "verify-result":
        payload, rc = cmd_verify(args)
    else:
        payload, rc = cmd_force_complete(args)
    print(json.dumps(payload, ensure_ascii=False, indent=2 if getattr(args, "json", False) else None))
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
