#!/usr/bin/env python3
"""evidence_validator.py — validate handoff.md for real evidence references.

A handoff is considered evidenced when it references at least one of:
  - event_id  (UUID-format: 8-4-4-4-12 hex, e.g. 19cafd5a-0f1a-46b3-ab07-88f15596c12a)
  - artifact_path (an absolute filesystem path or a backtick-quoted relative path)
  - action_id (dispatch-id / graph-node-id, e.g. graph-sprint-...-N2-20260520T155216Z)

Pure claim keywords ('done', 'passed', 'finished', 'complete', 'implemented',
'fixed', 'resolved') without any adjacent reference trigger ok=False.

Referenced event_ids are looked up in events.jsonl with a 5-second timeout
fallback: if lookup exceeds 5s the result still reflects reference presence.
"""
from __future__ import annotations

import json
import os
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))

# ------------------------------------------------------------------
# Reference patterns
# ------------------------------------------------------------------

# UUID-format event_id
_EVENT_ID_RE = re.compile(
    r'\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b',
    re.I,
)

# Absolute filesystem paths (must start with / and contain /)
_ABS_PATH_RE = re.compile(
    r'(?:^|[\s`\'"])(/(?:Users|home|tmp|var|etc|opt|solar)[^\s`\'">\])\n]{4,})',
    re.M,
)

# Backtick-quoted paths that contain path separators
_BACKTICK_PATH_RE = re.compile(r'`(/[^`\n]{3,}|[./][^`\n]{3,}/[^`\n]{1,})`')

# Backtick-quoted variable paths such as `${HARNESS_DIR}/sprints/foo.md`
_VAR_PATH_RE = re.compile(r'`(\$\{[A-Z0-9_]+\}/[^`\n]{3,})`')

# Backtick-quoted harness-relative artifact paths such as `sprints/foo.json`.
_REL_PATH_RE = re.compile(r'`((?:sprints|run|reports|state|events)/[^`\n]{3,})`')

# Dispatch / action IDs (graph-sprint-..., d-TIMESTAMP-hex, dispatch-id patterns)
_ACTION_ID_RE = re.compile(
    r'\b((?:graph|dispatch|d)-[A-Za-z0-9_.-]{10,})\b'
)

_APO_ARTIFACT_FIELDS = (
    "skill_plan",
    "mcp_plan",
    "capsule_plan_artifact",
    "physical_plan_artifact",
    "task_classification",
    "operator_selection",
    "capability_capsule",
    "execution_plan",
)
_APO_ARTIFACT_RE = re.compile(
    r'`?(' + "|".join(re.escape(field) for field in _APO_ARTIFACT_FIELDS) + r')`?',
    re.I,
)
_APO_SELECTION_RE = re.compile(r'\b(selected|rejected|fallback)\b', re.I)

# Claim keywords that assert completion without evidence
_CLAIM_RE = re.compile(
    r'\b(done|passed|finished|complete|completed|implemented|fixed|resolved)\b',
    re.I,
)

# Lines that are section headers — used to bound "nearby" heuristic
_HEADER_RE = re.compile(r'^#{1,6}\s+', re.M)

# Window (in chars) within which a reference must appear to "cover" a claim
_PROXIMITY_WINDOW = 400


# ------------------------------------------------------------------
# Public result type
# ------------------------------------------------------------------

@dataclass
class ValidationResult:
    ok: bool
    refs: dict[str, list[str]] = field(default_factory=lambda: {
        "event_ids": [],
        "artifact_paths": [],
        "action_ids": [],
        "apo_artifact_refs": [],
    })
    claim_keywords: list[str] = field(default_factory=list)
    missing_refs: list[dict[str, Any]] = field(default_factory=list)
    verified_event_ids: list[str] = field(default_factory=list)
    unverified_event_ids: list[str] = field(default_factory=list)
    events_lookup_timeout: bool = False
    events_lookup_sources: list[str] = field(default_factory=list)
    apo_artifacts_found: list[str] = field(default_factory=list)
    apo_selection_markers: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "refs": self.refs,
            "claim_keywords": self.claim_keywords,
            "missing_refs": self.missing_refs,
            "verified_event_ids": self.verified_event_ids,
            "unverified_event_ids": self.unverified_event_ids,
            "events_lookup_timeout": self.events_lookup_timeout,
            "events_lookup_sources": self.events_lookup_sources,
            "apo_artifacts_found": self.apo_artifacts_found,
            "apo_selection_markers": self.apo_selection_markers,
        }


@dataclass
class EvidenceReport:
    ok: bool
    refs: dict[str, list[str]] = field(default_factory=dict)
    missing: list[dict[str, Any]] = field(default_factory=list)
    task_kind: str = "builder"
    has_sidecar_ref: bool = False
    has_verifier_ref: bool = False
    has_apo_refs: bool = False
    verdict: str = "claim_only"

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "refs": self.refs,
            "missing": self.missing,
            "task_kind": self.task_kind,
            "has_sidecar_ref": self.has_sidecar_ref,
            "has_verifier_ref": self.has_verifier_ref,
            "has_apo_refs": self.has_apo_refs,
            "verdict": self.verdict,
        }


@dataclass
class MailboxEvidenceResult:
    ok: bool
    blocker_reason: str = ""
    outbox_results: list[dict[str, Any]] = field(default_factory=list)
    state_present: bool = False
    heartbeat_present: bool = False
    evidence_sources: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "blocker_reason": self.blocker_reason,
            "outbox_results": self.outbox_results,
            "state_present": self.state_present,
            "heartbeat_present": self.heartbeat_present,
            "evidence_sources": self.evidence_sources,
        }


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------

def _extract_refs(text: str) -> dict[str, list[str]]:
    """Extract all reference tokens from handoff text."""
    event_ids = list(dict.fromkeys(m.group(1).lower() for m in _EVENT_ID_RE.finditer(text)))
    paths: list[str] = []
    for m in _ABS_PATH_RE.finditer(text):
        p = m.group(1).strip()
        if p not in paths:
            paths.append(p)
    for m in _BACKTICK_PATH_RE.finditer(text):
        p = m.group(1).strip()
        if p not in paths:
            paths.append(p)
    for m in _VAR_PATH_RE.finditer(text):
        p = m.group(1).strip()
        if p not in paths:
            paths.append(p)
    for m in _REL_PATH_RE.finditer(text):
        p = m.group(1).strip()
        if p not in paths:
            paths.append(p)
    action_ids = list(dict.fromkeys(m.group(1) for m in _ACTION_ID_RE.finditer(text)))
    apo_refs = list(dict.fromkeys(m.group(1) for m in _APO_ARTIFACT_RE.finditer(text)))
    return {
        "event_ids": event_ids,
        "artifact_paths": paths,
        "action_ids": action_ids,
        "apo_artifact_refs": apo_refs,
    }


def _has_ref_nearby(text: str, pos: int) -> bool:
    """Return True if any reference pattern appears within _PROXIMITY_WINDOW chars of pos."""
    start = max(0, pos - _PROXIMITY_WINDOW)
    end = min(len(text), pos + _PROXIMITY_WINDOW)
    window = text[start:end]
    return bool(
        _EVENT_ID_RE.search(window)
        or _ABS_PATH_RE.search(window)
        or _BACKTICK_PATH_RE.search(window)
        or _VAR_PATH_RE.search(window)
        or _REL_PATH_RE.search(window)
        or _ACTION_ID_RE.search(window)
        or _APO_ARTIFACT_RE.search(window)
    )


def _find_uncovered_claims(text: str) -> list[dict[str, Any]]:
    """Find claim keywords that have no reference within proximity window."""
    uncovered: list[dict[str, Any]] = []
    for m in _CLAIM_RE.finditer(text):
        if not _has_ref_nearby(text, m.start()):
            # Find which section we're in for context
            last_header = ""
            for hm in _HEADER_RE.finditer(text):
                if hm.start() <= m.start():
                    last_header = text[hm.start():text.find("\n", hm.start())].strip()
                else:
                    break
            uncovered.append({
                "keyword": m.group(1),
                "pos": m.start(),
                "section": last_header or "(top)",
                "context": text[max(0, m.start() - 60):m.end() + 60].strip(),
            })
    return uncovered


def _load_event_ids_from_file(path: Path) -> set[str]:
    """Load all event_id values from a jsonl file."""
    ids: set[str] = set()
    if not path.exists():
        return ids
    try:
        for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            try:
                ev = json.loads(raw)
            except Exception:
                continue
            # Check common event_id fields
            for key in ("id", "event_id", "seq_id", "dispatch_id"):
                val = ev.get(key)
                if val and isinstance(val, str):
                    ids.add(val.lower())
            # Also check payload for event_ids
            payload = ev.get("payload") or ev.get("data") or {}
            if isinstance(payload, dict):
                for key in ("event_id", "id", "dispatch_id"):
                    val = payload.get(key)
                    if val and isinstance(val, str):
                        ids.add(val.lower())
    except Exception:
        pass
    return ids


def _lookup_event_ids(
    event_ids: list[str],
    events_sources: list[Path],
    timeout: float = 5.0,
) -> tuple[list[str], list[str], bool, list[str]]:
    """Look up event_ids across events_sources with timeout.

    Returns (verified, unverified, timed_out, sources_checked).
    """
    if not event_ids:
        return [], [], False, []

    known: set[str] = set()
    sources_checked: list[str] = []
    timed_out = False

    result_container: list[set[str]] = [set()]

    def _do_load() -> None:
        loaded: set[str] = set()
        for src in events_sources:
            loaded |= _load_event_ids_from_file(src)
        result_container[0] = loaded

    t = threading.Thread(target=_do_load, daemon=True)
    t.start()
    t.join(timeout=timeout)
    if t.is_alive():
        timed_out = True
    else:
        known = result_container[0]
        sources_checked = [str(s) for s in events_sources if s.exists()]

    verified = [eid for eid in event_ids if eid.lower() in known]
    unverified = [eid for eid in event_ids if eid.lower() not in known]
    return verified, unverified, timed_out, sources_checked


def _default_events_sources(sprint_id: str | None = None) -> list[Path]:
    """Return default events.jsonl search paths."""
    sources = [HARNESS_DIR / "run" / "events.jsonl"]
    if sprint_id:
        sources.append(HARNESS_DIR / "sprints" / f"{sprint_id}.events.jsonl")
    return sources


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------

def validate(
    handoff: str | Path,
    *,
    events_jsonl_paths: list[str | Path] | None = None,
    sprint_id: str | None = None,
    timeout: float = 5.0,
) -> ValidationResult:
    """Validate a handoff.md for real evidence references.

    Args:
        handoff: Path to handoff.md or raw handoff text (if str containing newlines).
        events_jsonl_paths: Optional explicit list of events.jsonl paths to search.
                            Defaults to harness/run/events.jsonl + sprint events.jsonl.
        sprint_id: Sprint ID used to locate sprint-specific events.jsonl.
        timeout: Seconds before events.jsonl lookup gives up (fallback: reference
                 presence alone determines ok).

    Returns:
        ValidationResult with ok=True iff at least one real reference is present
        and there are no uncovered claim keywords.
    """
    # Resolve handoff text
    if isinstance(handoff, Path) or (isinstance(handoff, str) and "\n" not in handoff and len(handoff) < 512):
        p = Path(handoff)
        if p.exists():
            text = p.read_text(encoding="utf-8", errors="replace")
        else:
            text = str(handoff)
    else:
        text = str(handoff)

    refs = _extract_refs(text)
    total_refs = (
        len(refs["event_ids"])
        + len(refs["artifact_paths"])
        + len(refs["action_ids"])
        + len(refs["apo_artifact_refs"])
    )
    uncovered_claims = _find_uncovered_claims(text)

    # Determine events sources
    if events_jsonl_paths is not None:
        sources = [Path(p) for p in events_jsonl_paths]
    else:
        sources = _default_events_sources(sprint_id)

    # Look up event_ids
    verified, unverified, timed_out, sources_checked = _lookup_event_ids(
        refs["event_ids"], sources, timeout=timeout
    )

    # ok=True iff: at least one ref present AND no uncovered claim keywords
    has_refs = total_refs > 0
    ok = has_refs and not uncovered_claims

    missing_refs = [
        {"keyword": c["keyword"], "section": c["section"], "context": c["context"]}
        for c in uncovered_claims
    ]

    return ValidationResult(
        ok=ok,
        refs=refs,
        claim_keywords=[c["keyword"] for c in uncovered_claims],
        missing_refs=missing_refs,
        verified_event_ids=verified,
        unverified_event_ids=unverified,
        events_lookup_timeout=timed_out,
        events_lookup_sources=sources_checked,
        apo_artifacts_found=refs["apo_artifact_refs"],
        apo_selection_markers=list(dict.fromkeys(m.group(1).lower() for m in _APO_SELECTION_RE.finditer(text))),
    )


def _resolve_artifact_path(ref: str) -> Path:
    value = str(ref)
    value = value.replace("${HARNESS_DIR}", str(HARNESS_DIR))
    value = value.replace("$HARNESS_DIR", str(HARNESS_DIR))
    path = Path(value)
    if not path.is_absolute():
        path = HARNESS_DIR / path
    return path


def validate_sprint_handoff(
    sprint_id: str,
    *,
    task_kind: str = "builder",
    handoff_path: str | Path | None = None,
) -> EvidenceReport:
    path = Path(handoff_path) if handoff_path else HARNESS_DIR / "sprints" / f"{sprint_id}.handoff.md"
    if not path.exists():
        return EvidenceReport(
            ok=False,
            refs={"event_ids": [], "artifact_paths": [], "action_ids": [], "apo_artifact_refs": []},
            missing=[{"keyword": "handoff", "section": "(file)", "context": str(path)}],
            task_kind=task_kind,
            verdict="no_handoff_file",
        )

    result = validate(path)
    artifact_paths = result.refs.get("artifact_paths", [])
    sidecar_refs = [p for p in artifact_paths if p.endswith(".runtime-context.json")]
    verifier_refs = [p for p in artifact_paths if p.endswith(".context-usage.json")]
    missing_artifacts = [p for p in artifact_paths if not _resolve_artifact_path(p).exists()]
    has_sidecar = any(_resolve_artifact_path(p).exists() for p in sidecar_refs)
    has_verifier = any(_resolve_artifact_path(p).exists() for p in verifier_refs)
    has_apo = bool(result.refs.get("apo_artifact_refs"))
    non_artifact_refs = bool(result.refs.get("event_ids") or result.refs.get("action_ids") or has_apo)
    existing_artifact_refs = bool(artifact_paths) and not missing_artifacts

    ok = result.ok and (non_artifact_refs or existing_artifact_refs or has_sidecar or has_verifier)
    missing = list(result.missing_refs)
    if missing_artifacts and not non_artifact_refs:
        ok = False
        missing.extend(
            {"keyword": "artifact_path", "section": "(artifact)", "context": ref}
            for ref in missing_artifacts
        )

    if not ok:
        verdict = "claim_only"
    elif has_sidecar and has_verifier:
        verdict = "both_verified"
    elif has_sidecar:
        verdict = "sidecar_verified"
    elif has_verifier:
        verdict = "verifier_verified"
    elif has_apo:
        verdict = "apo_artifact_verified"
    else:
        verdict = "refs_only"

    return EvidenceReport(
        ok=ok,
        refs=result.refs,
        missing=missing,
        task_kind=task_kind,
        has_sidecar_ref=has_sidecar,
        has_verifier_ref=has_verifier,
        has_apo_refs=has_apo,
        verdict=verdict,
    )


def _read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _graph_node(graph: dict[str, Any], node_id: str) -> dict[str, Any]:
    for node in graph.get("nodes", []) or []:
        if node.get("id") == node_id:
            return node
    return {}


def _actor_capabilities(actor_dir: Path, state: dict[str, Any]) -> list[str]:
    caps = state.get("capabilities") or state.get("provided_capabilities") or []
    if isinstance(caps, list):
        return [str(item) for item in caps]
    return []


def _load_outbox_results(actor_dir: Path) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for path in sorted((actor_dir / "outbox").glob("*.json")):
        data = _read_json(path)
        if data:
            data.setdefault("_path", str(path))
            results.append(data)
    return results


def validate_mailbox_evidence(
    graph_path: str | Path,
    node_id: str,
    *,
    actor_base_dir: str | Path | None = None,
) -> MailboxEvidenceResult:
    graph = _read_json(Path(graph_path))
    node = _graph_node(graph, node_id)
    if not node:
        return MailboxEvidenceResult(ok=False, blocker_reason="node_missing")

    nodes = {str(item.get("id")): item for item in graph.get("nodes", []) or []}
    for dep_id in node.get("depends_on", []) or []:
        dep = nodes.get(str(dep_id), {})
        if dep.get("status") not in ("passed", "complete", "completed"):
            return MailboxEvidenceResult(
                ok=False,
                blocker_reason="upstream",
                evidence_sources={"upstream_blocker": {"dep_id": dep_id, "status": dep.get("status", "")}},
            )

    actor_id = str(node.get("actor_id") or node.get("target_actor_id") or "")
    actor_root = Path(actor_base_dir) if actor_base_dir else HARNESS_DIR / "actors"
    actor_dir = actor_root / actor_id if actor_id else actor_root / "__missing__"
    state_path = actor_dir / "state.json"
    heartbeat_path = actor_dir / "heartbeat.json"
    state = _read_json(state_path)
    state_present = state_path.exists()
    heartbeat_present = heartbeat_path.exists()

    required = [str(item) for item in node.get("required_capabilities", []) or []]
    if required:
        caps = set(_actor_capabilities(actor_dir, state))
        missing = [cap for cap in required if cap not in caps]
        if missing:
            return MailboxEvidenceResult(
                ok=False,
                blocker_reason="capability_mismatch",
                state_present=state_present,
                heartbeat_present=heartbeat_present,
                evidence_sources={"missing_capabilities": missing},
            )

    outbox_results = _load_outbox_results(actor_dir)
    passed_outbox = [item for item in outbox_results if str(item.get("verdict", "")).lower() in ("passed", "ok", "success")]
    if passed_outbox:
        return MailboxEvidenceResult(
            ok=True,
            outbox_results=passed_outbox,
            state_present=state_present,
            heartbeat_present=heartbeat_present,
            evidence_sources={"outbox": [item.get("_path", "") for item in passed_outbox]},
        )
    if state_present and heartbeat_present:
        return MailboxEvidenceResult(
            ok=False,
            blocker_reason="gate_pending",
            state_present=True,
            heartbeat_present=True,
        )
    if state_present and not heartbeat_present:
        return MailboxEvidenceResult(
            ok=False,
            blocker_reason="runtime_stale",
            state_present=True,
            heartbeat_present=False,
        )
    return MailboxEvidenceResult(ok=False, blocker_reason="evidence_missing")


def validate_pane_verdict_with_evidence(
    pane_text: str,
    graph_path: str | Path,
    node_id: str,
    *,
    actor_base_dir: str | Path | None = None,
) -> MailboxEvidenceResult:
    result = validate_mailbox_evidence(graph_path, node_id, actor_base_dir=actor_base_dir)
    if _CLAIM_RE.search(str(pane_text)):
        result.evidence_sources["pane_text_claims_passed"] = True
        if not result.ok and not result.blocker_reason:
            result.blocker_reason = "evidence_missing"
    return result


# ------------------------------------------------------------------
# CLI
# ------------------------------------------------------------------

def main() -> int:
    import argparse
    import sys

    ap = argparse.ArgumentParser(prog="evidence_validator.py",
                                 description="Validate handoff.md for evidence references.")
    ap.add_argument("handoff", help="Path to handoff.md")
    ap.add_argument("--sprint-id", default=None)
    ap.add_argument("--events", nargs="*", metavar="JSONL",
                    help="Explicit events.jsonl paths to search.")
    ap.add_argument("--timeout", type=float, default=5.0)
    args = ap.parse_args()

    result = validate(
        args.handoff,
        events_jsonl_paths=args.events,
        sprint_id=args.sprint_id,
        timeout=args.timeout,
    )
    print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    return 0 if result.ok else 1


if __name__ == "__main__":
    import sys
    raise SystemExit(main())
