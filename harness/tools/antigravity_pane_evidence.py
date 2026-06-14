#!/usr/bin/env python3
"""Per-pane antigravity bridge evidence strip writer + pane evidence gate.

Three concerns:

1. **Bridge evidence strip** — writes per-pane evidence into
   state/pane-state.json for the antigravity desktop bridge.

2. **Pane evidence gate** — validates that handoff output carries
   structured command evidence, artifact refs, runtime/execution IR refs,
   and evidence IR refs.  Natural-language-only claims are rendered as
   unverified.  Legacy handoffs with explicit `evidence_status` are
   accepted as degraded.  All evidence fields are scrubbed for secrets.

3. **Pane completion claims** — records structured completion events
   with mandatory evidence fields (profile_id, profile_digest,
   validator_hits, asi_summary, compile_metadata).  Missing fields are
   accepted but flagged severity=warn + evidence_missing=true.  Old
   events written via the legacy bridge API are tagged legacy=true.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

HARNESS_DIR = Path(os.environ.get(
    "SOLAR_HARNESS_DIR",
    Path(__file__).resolve().parents[1],
))
STATE_DIR = HARNESS_DIR / "state"
PANE_STATE_PATH = STATE_DIR / "pane-state.json"
CLAIMS_PATH = STATE_DIR / "pane-completion-claims.jsonl"

EVIDENCE_REQUIRED_FIELDS = (
    "profile_id",
    "profile_digest",
    "validator_hits",
    "asi_summary",
    "compile_metadata",
)

# ── secret scrubbing ────────────────────────────────────────────────────────

_SECRET_KEY_RE = re.compile(
    r"(secret|token|password|passwd|credential|api[_-]?key|"
    r"access[_-]?key|private[_-]?key|auth[_-]?token|refresh[_-]?token)",
    re.I,
)
_SECRET_VALUE_RE = re.compile(
    r"(sk-[A-Za-z0-9_-]{12,}|"
    r"xox[baprs]-[A-Za-z0-9-]{12,}|"
    r"AKIA[0-9A-Z]{12,}|"
    r"(?i:bearer\s+)[A-Za-z0-9._~+/=-]{12,})"
)


def _redact_secrets(value: Any, *, key: str = "") -> Any:
    """Scrub secret-shaped values from evidence fields."""
    if _SECRET_KEY_RE.search(key):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {str(k): _redact_secrets(v, key=str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact_secrets(item, key=key) for item in value]
    if isinstance(value, str):
        return _SECRET_VALUE_RE.sub("[REDACTED]", value)
    return value


# ── bridge evidence strip (legacy) ─────────────────────────────────────────

def _read_json_safe(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _atomic_write(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=str(path.parent),
        prefix=f".{path.name}.", suffix=".tmp", delete=False,
    ) as handle:
        tmp = Path(handle.name)
        handle.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


def write_evidence(
    pane_id: str,
    *,
    last_capture_ts: str | None = None,
    last_capture_intent_id: str | None = None,
    last_consume_ts: str | None = None,
    last_consume_sprint: str | None = None,
    last_failure: str | None = None,
    inbox_now: int = 0,
    processed_total: int = 0,
    pane_state_path: Path | None = None,
) -> dict[str, Any]:
    """Write antigravity bridge evidence strip for a pane."""
    path = pane_state_path or PANE_STATE_PATH
    state = _read_json_safe(path)

    pane_data = state.setdefault(pane_id, {})
    existing = pane_data.get("antigravity_bridge_evidence") or {}

    new_capture_ts = last_capture_ts
    old_capture_ts = existing.get("last_capture_ts")
    if old_capture_ts and new_capture_ts and new_capture_ts < old_capture_ts:
        return existing

    evidence: dict[str, Any] = {
        "last_capture_ts": new_capture_ts,
        "last_capture_intent_id": last_capture_intent_id,
        "last_consume_ts": last_consume_ts or existing.get("last_consume_ts"),
        "last_consume_sprint": last_consume_sprint or existing.get("last_consume_sprint"),
        "last_failure": last_failure if last_failure is not None else existing.get("last_failure"),
        "inbox_now": inbox_now,
        "processed_total": processed_total or existing.get("processed_total", 0),
        "legacy": True,
    }

    pane_data["antigravity_bridge_evidence"] = evidence
    _atomic_write(path, state)
    return evidence


def read_evidence(pane_id: str, pane_state_path: Path | None = None) -> dict[str, Any] | None:
    """Read the antigravity bridge evidence for a pane, or None if absent."""
    path = pane_state_path or PANE_STATE_PATH
    state = _read_json_safe(path)
    pane_data = state.get(pane_id, {})
    return pane_data.get("antigravity_bridge_evidence")


def read_all_evidence(pane_state_path: Path | None = None) -> dict[str, dict[str, Any]]:
    """Read all panes with antigravity bridge evidence strips."""
    path = pane_state_path or PANE_STATE_PATH
    state = _read_json_safe(path)
    result: dict[str, dict[str, Any]] = {}
    for pane_id, pane_data in state.items():
        if not isinstance(pane_data, dict):
            continue
        evidence = pane_data.get("antigravity_bridge_evidence")
        if isinstance(evidence, dict):
            result[pane_id] = evidence
    return result


# ── pane completion claims (evidence-enforced) ─────────────────────────────

def _append_jsonl(path: Path, record: dict[str, Any]) -> None:
    """Atomically append a JSON record to a JSONL file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n"
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(line)
        fh.flush()
        os.fsync(fh.fileno())


def record_pane_completion_claim(
    sprint_id: str,
    node_id: str,
    *,
    evidence: dict[str, Any] | None = None,
    claims_path: Path | None = None,
) -> dict[str, Any]:
    """Record a pane completion claim with structured evidence.

    The evidence dict should contain:
      - profile_id: str
      - profile_digest: str
      - validator_hits: list
      - asi_summary: dict
      - compile_metadata: dict

    If any required field is missing, the claim is still recorded but
    flagged with severity="warn" and evidence_missing=True.

    Returns the claim record that was persisted.
    """
    from datetime import datetime, timezone

    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    evidence = _redact_secrets(evidence or {})

    missing_fields = [
        f for f in EVIDENCE_REQUIRED_FIELDS if f not in evidence
    ]

    claim: dict[str, Any] = {
        "ts": ts,
        "sprint_id": sprint_id,
        "node_id": node_id,
        "evidence": evidence,
        "missing_fields": missing_fields,
        "evidence_missing": bool(missing_fields),
        "severity": "warn" if missing_fields else "info",
        "legacy": False,
    }

    path = claims_path or CLAIMS_PATH
    _append_jsonl(path, claim)
    return claim


def read_claims(
    claims_path: Path | None = None,
    *,
    sprint_id: str | None = None,
    node_id: str | None = None,
    severity: str | None = None,
    include_legacy: bool = True,
) -> list[dict[str, Any]]:
    """Read pane completion claims, optionally filtered."""
    path = claims_path or CLAIMS_PATH
    if not path.exists():
        return []

    claims: list[dict[str, Any]] = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                claim = json.loads(line)
            except json.JSONDecodeError:
                continue

            if not include_legacy and claim.get("legacy"):
                continue
            if sprint_id and claim.get("sprint_id") != sprint_id:
                continue
            if node_id and claim.get("node_id") != node_id:
                continue
            if severity and claim.get("severity") != severity:
                continue
            claims.append(claim)
    return claims


# ── pane evidence gate ──────────────────────────────────────────────────────

def extract_evidence_refs_from_handoff(handoff_text: str) -> dict[str, Any]:
    """Extract structured evidence refs from handoff markdown text.

    Looks for:
    - command_result: lines starting with ``` followed by $ or containing
      command output blocks
    - artifact_path: paths referenced in the handoff
    - event_id: UUID-shaped refs
    - action_id: dispatch/graph action IDs

    Returns dict with extracted refs, all scrubbed for secrets.
    """
    refs: dict[str, list[str]] = {
        "command_refs": [],
        "artifact_paths": [],
        "event_ids": [],
        "action_ids": [],
    }

    # Command refs: bash command blocks
    command_pattern = re.compile(r"```\w*\s*\n\s*[$>]\s*.+", re.MULTILINE)
    for match in command_pattern.finditer(handoff_text):
        refs["command_refs"].append(match.group().strip()[:200])

    # Artifact paths: /path/to/file patterns
    path_pattern = re.compile(r"(?:^|[\s(])((?:/[\w._-]+){2,}(?:\.\w+)?)", re.MULTILINE)
    seen_paths: set[str] = set()
    for match in path_pattern.finditer(handoff_text):
        p = match.group(1)
        if p not in seen_paths and not p.startswith("/tmp/"):
            seen_paths.add(p)
            refs["artifact_paths"].append(p)

    # Event IDs: UUID pattern
    uuid_pattern = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
    seen_uuids: set[str] = set()
    for match in uuid_pattern.finditer(handoff_text):
        uid = match.group().lower()
        if uid not in seen_uuids:
            seen_uuids.add(uid)
            refs["event_ids"].append(uid)

    # Action IDs: graph-sprint or pm- prefixed dispatch IDs
    action_pattern = re.compile(r"(graph-sprint-[\w.-]+|pm-sprint-[\w.-]+)", re.I)
    seen_actions: set[str] = set()
    for match in action_pattern.finditer(handoff_text):
        aid = match.group()
        if aid not in seen_actions:
            seen_actions.add(aid)
            refs["action_ids"].append(aid)

    return _redact_secrets(refs)


def check_evidence_gate(handoff_text: str) -> dict[str, Any]:
    """Validate handoff evidence against the pane evidence gate.

    Returns a gate result dict:
    - passed: bool — whether the gate accepts this handoff
    - verification: "verified" | "unverified" | "degraded"
    - evidence_refs: extracted structured refs
    - missing: list of missing evidence categories
    - reason: human-readable reason for rejection if not passed

    Rules:
    - Handoff with structured refs (command, artifact, event, action) → verified
    - Handoff with explicit evidence_status field → degraded (accepted)
    - Natural-language-only handoff → unverified (rejected)
    - All evidence fields are scrubbed for secrets before return
    """
    refs = extract_evidence_refs_from_handoff(handoff_text)

    # Check for explicit evidence_status (legacy degraded acceptance)
    status_match = re.search(
        r"evidence_status\s*:\s*(complete|partial|incomplete|not_applicable)",
        handoff_text, re.I,
    )
    if status_match:
        status_value = status_match.group(1).lower()
        is_acceptable = status_value in {"complete", "partial", "not_applicable"}
        return {
            "passed": is_acceptable,
            "verification": "degraded",
            "evidence_refs": refs,
            "evidence_status": status_value,
            "missing": [] if is_acceptable else ["evidence_status_is_incomplete"],
            "reason": "" if is_acceptable else f"evidence_status={status_value} is not accepted",
        }

    # Count structured evidence categories present
    has_command = bool(refs["command_refs"])
    has_artifact = bool(refs["artifact_paths"])
    has_event = bool(refs["event_ids"])
    has_action = bool(refs["action_ids"])
    evidence_count = sum([has_command, has_artifact, has_event, has_action])

    if evidence_count == 0:
        return {
            "passed": False,
            "verification": "unverified",
            "evidence_refs": refs,
            "missing": ["command_refs", "artifact_paths", "event_ids", "action_ids"],
            "reason": "Natural-language completion without Evidence IR; no structured refs found",
        }

    missing: list[str] = []
    if not has_command:
        missing.append("command_refs")
    if not has_artifact:
        missing.append("artifact_paths")
    if not has_event:
        missing.append("event_ids")
    if not has_action:
        missing.append("action_ids")

    return {
        "passed": True,
        "verification": "verified",
        "evidence_refs": refs,
        "missing": missing,
        "reason": "",
    }


# ── CLI ─────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    import argparse
    parser = argparse.ArgumentParser(prog="antigravity_pane_evidence")
    sub = parser.add_subparsers(dest="cmd")

    write_p = sub.add_parser("write")
    write_p.add_argument("--pane-id", required=True)
    write_p.add_argument("--capture-ts", default="")
    write_p.add_argument("--intent-id", default="")
    write_p.add_argument("--consume-ts", default="")
    write_p.add_argument("--consume-sprint", default="")
    write_p.add_argument("--failure", default="")
    write_p.add_argument("--inbox-now", type=int, default=0)
    write_p.add_argument("--processed-total", type=int, default=0)

    check_p = sub.add_parser("check-gate")
    check_p.add_argument("--handoff-file", required=True)

    extract_p = sub.add_parser("extract-refs")
    extract_p.add_argument("--handoff-file", required=True)

    claim_p = sub.add_parser("record-claim")
    claim_p.add_argument("--sprint-id", required=True)
    claim_p.add_argument("--node-id", required=True)
    claim_p.add_argument("--evidence", default=None,
                         help="JSON string with evidence fields")

    claims_p = sub.add_parser("list-claims")
    claims_p.add_argument("--sprint-id", default=None)
    claims_p.add_argument("--node-id", default=None)
    claims_p.add_argument("--severity", default=None,
                          choices=["info", "warn"])
    claims_p.add_argument("--no-legacy", action="store_true",
                          help="Exclude legacy claims")

    args = parser.parse_args(argv)

    if args.cmd == "write":
        result = write_evidence(
            args.pane_id,
            last_capture_ts=args.capture_ts or None,
            last_capture_intent_id=args.intent_id or None,
            last_consume_ts=args.consume_ts or None,
            last_consume_sprint=args.consume_sprint or None,
            last_failure=args.failure or None,
            inbox_now=args.inbox_now,
            processed_total=args.processed_total,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.cmd == "check-gate":
        handoff_text = Path(args.handoff_file).read_text(encoding="utf-8")
        result = check_evidence_gate(handoff_text)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.cmd == "extract-refs":
        handoff_text = Path(args.handoff_file).read_text(encoding="utf-8")
        refs = extract_evidence_refs_from_handoff(handoff_text)
        print(json.dumps(refs, ensure_ascii=False, indent=2))
    elif args.cmd == "record-claim":
        ev = json.loads(args.evidence) if args.evidence else None
        result = record_pane_completion_claim(
            args.sprint_id,
            args.node_id,
            evidence=ev,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.cmd == "list-claims":
        results = read_claims(
            sprint_id=args.sprint_id,
            node_id=args.node_id,
            severity=args.severity,
            include_legacy=not args.no_legacy,
        )
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        parser.print_help()
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
