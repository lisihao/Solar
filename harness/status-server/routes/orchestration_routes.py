"""Orchestration routes for Solar-Harness status-server.

Five read-only endpoints:
  GET /orchestration/epics                  — list all epics
  GET /orchestration/epics/<epic_id>        — epic detail + child sprint table
  GET /orchestration/sprints/<sid>          — sprint detail + capability hit
  GET /orchestration/panes                  — pane capability map
  GET /orchestration/events                 — SSE stream (or poll fallback)

All responses use envelope: {ok, schema_version, generated_at, degraded_sources, data}
"""
from __future__ import annotations

import datetime
import json
import time
from pathlib import Path
from typing import Any, Generator

try:
    from flask import Blueprint, jsonify, Response, request, stream_with_context
except ModuleNotFoundError:  # status-server.py uses the pure builders without Flask.
    class _NoopBlueprint:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def route(self, *args: Any, **kwargs: Any):
            def decorator(func):
                return func
            return decorator

    class Response:  # type: ignore[no-redef]
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self.args = args
            self.kwargs = kwargs

    class _Request:
        args: dict[str, str] = {}
        headers: dict[str, str] = {}

    def jsonify(value: Any):  # type: ignore[no-redef]
        return value

    def stream_with_context(value: Any):  # type: ignore[no-redef]
        return value

    Blueprint = _NoopBlueprint  # type: ignore[assignment]
    request = _Request()  # type: ignore[assignment]

HARNESS_DIR = Path.home() / ".solar" / "harness"
SCRIPT_HARNESS_DIR = Path(__file__).resolve().parents[2]
SPRINTS_DIR = HARNESS_DIR / "sprints"
STATE_DIR = HARNESS_DIR / "state"
EVENTS_JSONL = HARNESS_DIR / "events.jsonl"

SCHEMA_VERSION = "solar.orchestration.v1"

orchestration_bp = Blueprint("orchestration", __name__, url_prefix="/orchestration")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def _envelope(data: Any, degraded_sources: list[str] | None = None) -> dict:
    return {
        "ok": True,
        "schema_version": SCHEMA_VERSION,
        "generated_at": _now(),
        "degraded_sources": degraded_sources or [],
        "data": data,
    }


def _read_json(path: Path) -> tuple[Any, bool]:
    """Return (parsed, ok). ok=False means file missing or parse error."""
    if not path.exists():
        return None, False
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="replace")), True
    except Exception:
        return None, False


def _active_sprint_ids(limit: int = 8) -> list[str]:
    active = {"active", "dispatched", "reviewing", "ready_for_review", "failed_review"}
    rows: list[tuple[float, str]] = []
    for sf in SPRINTS_DIR.glob("*.status.json"):
        data, ok = _read_json(sf)
        if not ok or not isinstance(data, dict):
            continue
        if data.get("status") in active:
            sid = data.get("sprint_id") or sf.name.removesuffix(".status.json")
            try:
                mtime = sf.stat().st_mtime
            except OSError:
                mtime = 0.0
            rows.append((mtime, sid))
    rows.sort(reverse=True)
    return [sid for _, sid in rows[:limit]]


def _load_status_by_sprint(sid: str) -> dict:
    data, ok = _read_json(SPRINTS_DIR / f"{sid}.status.json")
    return data if ok and isinstance(data, dict) else {}


def _load_task_graph(sid: str) -> tuple[dict, bool]:
    data, ok = _read_json(SPRINTS_DIR / f"{sid}.task_graph.json")
    return (data if ok and isinstance(data, dict) else {}, ok)


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(HARNESS_DIR))
    except ValueError:
        return str(path)


def _normalize_status(status: str | None) -> str:
    value = (status or "").strip().lower()
    if value in {"passed", "completed"}:
        return "passed"
    if value in {"failed", "cancelled", "error"}:
        return "failed"
    if value in {"blocked", "dependency_blocked", "quota_blocked", "auth_blocked"}:
        return "blocked"
    if value in {"active", "dispatched", "reviewing", "ready_for_review", "in_progress"}:
        return "active"
    if value in {"queued", "drafting", "planned", "pending"}:
        return "pending"
    return value or "pending"


def _node_status(node: dict, status_state: dict | None = None) -> str:
    state_nodes = (status_state or {}).get("nodes") or {}
    nid = node.get("id", "")
    if isinstance(state_nodes, dict) and nid in state_nodes:
        nstate = state_nodes[nid]
        if isinstance(nstate, dict):
            return _normalize_status(nstate.get("status"))
        return _normalize_status(str(nstate))
    return _normalize_status(node.get("status"))


def _load_routing_decisions() -> list[dict]:
    data, ok = _read_json(STATE_DIR / "autopilot-state.json")
    if not ok or not isinstance(data, dict):
        return []
    decisions = data.get("routing_decisions", [])
    return decisions if isinstance(decisions, list) else []


def _capability_counts(nodes: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for node in nodes:
        for cap in node.get("required_capabilities") or []:
            if isinstance(cap, str):
                counts[cap] = counts.get(cap, 0) + 1
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))


def _role_counts(nodes: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for node in nodes:
        role = node.get("target_role") or node.get("preferred_role") or node.get("logical_operator") or "unspecified"
        if not isinstance(role, str) or not role:
            role = "unspecified"
        counts[role] = counts.get(role, 0) + 1
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))


def _provided_capability_names(provided: list[Any]) -> set[str]:
    names: set[str] = set()
    for item in provided:
        if not isinstance(item, str):
            continue
        names.add(item.removeprefix("inferred:"))
    return names


def _actorhost_for_pane(pane_id: str, required_capabilities: list[str] | None = None) -> dict[str, Any]:
    import sys

    canonical_host_types = {
        "claude_code_session",
        "tmux_pane",
        "operator_pool",
        "antigravity_managed_env",
        "browser_profile",
        "remote_shell",
        "api_worker",
        "local_process",
    }

    def _pane_matches(configured: str, pane: str) -> bool:
        if not configured or not pane:
            return False
        if configured == pane:
            return True
        if configured.endswith("*"):
            return pane.startswith(configured[:-1])
        return False

    def _operator_id_for_pane(pane: str) -> str:
        data, ok = _read_json(HARNESS_DIR / "config" / "physical-operators.json")
        operators = data.get("operators", {}) if ok and isinstance(data, dict) else {}
        if not isinstance(operators, dict):
            return ""
        for operator_id, cfg in operators.items():
            if isinstance(cfg, dict) and _pane_matches(str(cfg.get("pane") or ""), pane):
                return str(operator_id)
        return ""

    def _lease_state_for_actor(actor_id: str) -> str:
        data, ok = _read_json(HARNESS_DIR / "run" / "actor-leases" / f"{actor_id}.json")
        if not ok or not isinstance(data, dict):
            return "idle"
        if str(data.get("expires_at") or "") > _now():
            return str(data.get("state") or "leased")
        return "stale"

    def _capability_match(actor_cfg: dict[str, Any], required: list[str]) -> dict[str, Any]:
        profile = actor_cfg.get("capability_profile")
        if not isinstance(profile, dict):
            profile = actor_cfg.get("capability") if isinstance(actor_cfg.get("capability"), dict) else {}
        observed = sorted(str(k) for k, v in profile.items() if isinstance(v, (int, float)) and v)
        return {
            "required": required,
            "matched": sorted(set(required).intersection(observed)),
            "missing": sorted(set(required).difference(observed)),
            "observed": observed,
        }

    def _local_actorhost(operator_id: str, required: list[str], import_reason: str = "") -> dict[str, Any]:
        actors_data, actors_ok = _read_json(HARNESS_DIR / "config" / "agent-actors.json")
        hosts_data, hosts_ok = _read_json(HARNESS_DIR / "config" / "actor-hosts.json")
        actors = actors_data.get("actors", {}) if actors_ok and isinstance(actors_data, dict) else {}
        hosts = hosts_data.get("hosts", {}) if hosts_ok and isinstance(hosts_data, dict) else {}
        actor_cfg = actors.get(operator_id) if isinstance(actors, dict) else {}
        if isinstance(actor_cfg, dict) and actor_cfg:
            host_id = str(actor_cfg.get("host_id") or "unknown")
            host_cfg = hosts.get(host_id, {}) if isinstance(hosts, dict) else {}
            host_type = str(host_cfg.get("host_type") or "unknown")
            return {
                "actor_id": operator_id,
                "host_id": host_id,
                "host_type": host_type,
                "lease_state": _lease_state_for_actor(operator_id),
                "capability_match": _capability_match(actor_cfg, required),
                "compat_fallback": False,
                "compat_maps_to": None,
                "resolution_source": "actor_hosts",
                "canonical_host_type": host_type in canonical_host_types,
                "resolver_fallback_reason": import_reason,
            }

        physical_data, physical_ok = _read_json(HARNESS_DIR / "config" / "physical-operators.json")
        operators = physical_data.get("operators", {}) if physical_ok and isinstance(physical_data, dict) else {}
        op_cfg = operators.get(operator_id) if isinstance(operators, dict) else {}
        compat = op_cfg.get("compat_maps_to") if isinstance(op_cfg, dict) else None
        if isinstance(compat, dict):
            host_type = str(compat.get("host_type") or "unknown")
            return {
                "actor_id": operator_id or "N/A",
                "host_id": "N/A",
                "host_type": host_type,
                "lease_state": "unknown",
                "capability_match": {"required": required, "matched": [], "missing": required, "observed": []},
                "compat_fallback": True,
                "compat_maps_to": compat,
                "resolution_source": "physical_operators.compat_maps_to",
                "canonical_host_type": host_type in canonical_host_types,
                "resolver_fallback_reason": import_reason,
            }
        return {
            "actor_id": operator_id or "N/A",
            "host_id": "N/A",
            "host_type": "unknown",
            "lease_state": "unknown",
            "capability_match": {"required": required, "matched": [], "missing": required, "observed": []},
            "compat_fallback": False,
            "compat_maps_to": None,
            "resolution_source": "unresolved",
            "canonical_host_type": False,
            "resolver_fallback_reason": import_reason,
        }

    operator_id = _operator_id_for_pane(pane_id)
    required = required_capabilities or []
    for lib_dir in (HARNESS_DIR / "lib", SCRIPT_HARNESS_DIR / "lib"):
        value = str(lib_dir)
        if value in sys.path:
            sys.path.remove(value)
        sys.path.insert(0, value)
    try:
        from multi_task_status import resolve_actorhost_status  # type: ignore
        if not callable(resolve_actorhost_status):
            raise ImportError("resolve_actorhost_status unavailable")

        return resolve_actorhost_status(
            actor_id=operator_id,
            operator_id=operator_id,
            pane=pane_id,
            actors_path=HARNESS_DIR / "config" / "agent-actors.json",
            hosts_path=HARNESS_DIR / "config" / "actor-hosts.json",
            physical_operators_path=HARNESS_DIR / "config" / "physical-operators.json",
            lease_dir=HARNESS_DIR / "run" / "actor-leases",
            required_capabilities=required,
        )
    except Exception as exc:
        return _local_actorhost(operator_id, required, f"resolver_error:{type(exc).__name__}")


def _build_verification_gate(sid: str, node_id: str, node: dict, routing: list[dict]) -> dict:
    """Build verification_gate section for a node from real artifacts or sidecars."""
    gate = node.get("gate") or ""
    evidence_policy = node.get("evidence_policy") or {}
    risk_level = node.get("risk_level") or ""
    verifier_required = node.get("verifier_required") or False
    cross_provider_required = node.get("cross_provider_required") or False

    # Find routing decision for this node
    routing_decision = {}
    for r in routing:
        if r.get("sprint_id") == sid and r.get("node_id") == node_id:
            routing_decision = r
            break

    # Extract actor IDs from routing or node
    writer_actor_id = routing_decision.get("writer_actor_id") or node.get("assigned_to") or ""
    verifier_actor_id = routing_decision.get("verifier_actor_id") or ""

    # Extract provider information
    def _extract_provider(actor_id: str) -> str:
        if not actor_id:
            return ""
        # Provider prefixes based on known operator IDs
        if "claude" in actor_id.lower():
            return "anthropic"
        if "glm" in actor_id.lower() or "zhipu" in actor_id.lower():
            return "zhipu"
        if "deepseek" in actor_id.lower():
            return "deepseek"
        if "thunderomlx" in actor_id.lower() or "qwen" in actor_id.lower():
            return "thunder"
        if "gpt" in actor_id.lower() or "openai" in actor_id.lower():
            return "openai"
        return "unknown"

    writer_provider = _extract_provider(writer_actor_id)
    verifier_provider = _extract_provider(verifier_actor_id)

    # Check for writer/verifier conflict
    writer_verifier_conflict = (
        "unknown" if not writer_actor_id or not verifier_actor_id
        else writer_actor_id == verifier_actor_id
    )

    # Check for provider conflict
    provider_conflict = (
        "unknown" if not writer_provider or not verifier_provider or risk_level != "high"
        else writer_provider == verifier_provider
    )

    # Build audit refs from routing
    audit_refs = {
        "routing_decision_ref": routing_decision.get("decision_id") or "",
        "runtime_context_ref": routing_decision.get("runtime_context_ref") or "",
        "sidecar_ref": routing_decision.get("sidecar_ref") or "",
    }

    # Try to load review decision artifact
    review_decision_status = "missing"
    must_fix_count = None
    sprint_dir = SPRINTS_DIR / sid
    if sprint_dir.exists():
        # Check for review_decision.yaml/json
        review_paths = [
            sprint_dir / "review_decision.yaml",
            sprint_dir / "review_decision.json",
            sprint_dir / f"{node_id}-review_decision.yaml",
            sprint_dir / f"{node_id}-review_decision.json",
        ]
        for path in review_paths:
            if path.exists():
                try:
                    data, ok = _read_json(path)
                    if ok and isinstance(data, dict):
                        review_decision_status = "present"
                        must_fix_count = data.get("must_fix")
                        if isinstance(must_fix_count, list):
                            must_fix_count = len(must_fix_count)
                        break
                except Exception:
                    pass

    # Try to load test evidence artifact
    test_evidence_status = "missing"
    test_paths = [
        sprint_dir / "test_evidence.json",
        sprint_dir / "test_report.json",
        sprint_dir / f"{node_id}-test_evidence.json",
        sprint_dir / f"{node_id}-test_report.json",
        HARNESS_DIR / "tests" / f"test_{sid.replace('-', '_')}.py",
    ]
    for path in test_paths:
        if path.exists():
            try:
                data, ok = _read_json(path)
                if ok and isinstance(data, dict) and data.get("tests"):
                    test_evidence_status = "present"
                    break
            except Exception:
                pass

    # Try to load patch/artifact evidence
    patch_artifact_status = "missing"
    patch_paths = [
        sprint_dir / "handoff.md",
        sprint_dir / f"{node_id}-handoff.md",
        sprint_dir / "patch.diff",
        sprint_dir / f"{node_id}.patch",
    ]
    for path in patch_paths:
        if path.exists():
            try:
                content = path.read_text(encoding="utf-8", errors="ignore")
                if len(content) > 100:  # Non-trivial content
                    patch_artifact_status = "present"
                    break
            except Exception:
                pass

    return {
        "patch_artifact": {
            "status": patch_artifact_status,
            "source": "artifact_scan",
            "degraded": patch_artifact_status == "missing",
        },
        "test_evidence": {
            "status": test_evidence_status,
            "source": "artifact_scan",
            "degraded": test_evidence_status == "missing",
        },
        "review_decision": {
            "status": review_decision_status,
            "source": "artifact_scan",
            "degraded": review_decision_status == "missing",
            "must_fix_count": must_fix_count,
        },
        "writer_verifier_conflict": {
            "detected": writer_verifier_conflict,
            "writer_actor_id": writer_actor_id,
            "verifier_actor_id": verifier_actor_id,
            "degraded": writer_verifier_conflict is True,
        },
        "provider_conflict": {
            "detected": provider_conflict,
            "writer_provider": writer_provider,
            "verifier_provider": verifier_provider,
            "risk_level": risk_level,
            "cross_provider_required": cross_provider_required,
            "degraded": provider_conflict is True and risk_level == "high",
        },
        "audit_refs": audit_refs,
        "verifier_required": verifier_required,
        "cross_provider_required": cross_provider_required,
        "gate_name": gate,
        "evidence_policy": evidence_policy,
    }


def _build_node_cards(sid: str, nodes: list[dict], status_state: dict, routing: list[dict]) -> list[dict]:
    by_node = {r.get("node_id"): r for r in routing if r.get("sprint_id") == sid}
    cards: list[dict] = []
    for index, node in enumerate(nodes):
        nid = str(node.get("id") or f"N{index + 1}")
        decision = by_node.get(nid, {})
        required = [c for c in (node.get("required_capabilities") or []) if isinstance(c, str)]
        provided = decision.get("provided_capabilities") or []
        missing = [cap for cap in required if cap not in _provided_capability_names(provided)]
        target_pane = str(decision.get("target_pane") or "")
        actorhost = _actorhost_for_pane(target_pane, required) if target_pane else {}
        verification_gate = _build_verification_gate(sid, nid, node, routing)
        cards.append({
            "id": nid,
            "goal": node.get("goal") or "",
            "status": _node_status(node, status_state),
            "depends_on": node.get("depends_on") or [],
            "gate": node.get("gate") or "",
            "estimated_cost": node.get("estimated_cost") or 0,
            "required_capabilities": required,
            "missing_capabilities": missing,
            "target_pane": target_pane,
            "pane_carrier": {"pane_id": target_pane, "source": "autopilot_routing"} if target_pane else {},
            "actorhost": actorhost,
            "actor_id": actorhost.get("actor_id", "N/A") if actorhost else "N/A",
            "host_id": actorhost.get("host_id", "N/A") if actorhost else "N/A",
            "host_type": actorhost.get("host_type", "unknown") if actorhost else "unknown",
            "lease_state": actorhost.get("lease_state", "unknown") if actorhost else "unknown",
            "route_decision": decision.get("decision") or "no_routing_record",
            "blocked_reason": decision.get("blocked_reason") or "",
            "decision": decision.get("decision") or "no_routing_record",
            "write_scope": node.get("write_scope") or [],
            "read_scope": node.get("read_scope") or [],
            "verification_gate": verification_gate,
        })
    return cards


def _diagnostic_guidance(kind: str, subject: str) -> list[str]:
    if kind == "dependency":
        return [
            f"Inspect blocked dependency status: solar-harness status {subject}",
            "Confirm dependency handoff/eval artifact exists under sprints/ before redispatch.",
            "Run graph scheduler validation after dependency changes.",
        ]
    if kind == "node_dependency":
        return [
            f"Open upstream node handoff/eval for {subject}.",
            "Only move this node after upstream status is passed/completed.",
            "If upstream is stale, redispatch that node instead of bypassing the DAG.",
        ]
    if kind == "capability":
        return [
            "Check state/pane-state.json and state/autopilot-state.json for matching pane capabilities.",
            "Verify the selected operator advertises every required_capability.",
            "If no pane matches, update the operator capability registry before redispatch.",
        ]
    if kind == "task_graph":
        return [
            "Restore or regenerate the sprint .task_graph.json artifact.",
            "Run solar-harness graph-scheduler validate --graph <task_graph.json>.",
            "Do not dispatch implementation work until the graph validates.",
        ]
    if kind == "verification_gate":
        return [
            f"Node {subject} requires verification evidence before completion.",
            "Ensure patch/artifact, test evidence, and review decision artifacts exist.",
            "Writer and verifier operators must differ for critical nodes.",
            "High-risk nodes require cross-provider verification.",
        ]
    if kind == "missing_patch":
        return [
            "Ensure the node produced a handoff.md or patch artifact.",
            "Check sprint directory for artifact files.",
            "Verify write_scope includes artifact paths.",
        ]
    if kind == "missing_test":
        return [
            "Ensure test or benchmark evidence was produced.",
            "Check for test_report.json or test_evidence.json files.",
            "Run tests before marking node as complete.",
        ]
    if kind == "missing_review":
        return [
            "Ensure independent review decision was produced.",
            "Check for review_decision.yaml or review_decision.json files.",
            "Independent verifier must differ from writer operator.",
        ]
    if kind == "writer_verifier_conflict":
        return [
            "Writer and verifier cannot be the same operator.",
            "Redispatch with a different verifier operator.",
            "Update node assignment to ensure separation of duties.",
        ]
    if kind == "provider_conflict":
        return [
            "High-risk nodes require cross-provider verification.",
            "Writer and verifier must use different provider models.",
            "Select a verifier from a different provider.",
        ]
    return [
        "Check status-server logs under run/status-server.log.",
        "Refresh /orchestration/dashboard to confirm whether the source recovered.",
    ]


def _build_blocker_diagnostics(sid: str, status: dict, nodes: list[dict], node_cards: list[dict], tg_ok: bool) -> list[dict]:
    diagnostics: list[dict] = []
    if not tg_ok:
        diagnostics.append({
            "severity": "error",
            "kind": "task_graph",
            "title": "Task graph missing",
            "detail": f"{sid}.task_graph.json is missing or invalid.",
            "guidance": _diagnostic_guidance("task_graph", sid),
        })

    for blocker in _extract_blocked_by(status):
        diagnostics.append({
            "severity": "warn",
            "kind": "dependency",
            "title": "Sprint dependency blocked dispatch",
            "detail": blocker,
            "guidance": _diagnostic_guidance("dependency", blocker),
        })

    status_by_id = {n["id"]: n["status"] for n in node_cards}
    for card in node_cards:
        unmet = [dep for dep in card["depends_on"] if status_by_id.get(dep) not in {"passed", "completed"}]
        if card["status"] in {"pending", "blocked"} and unmet:
            subject = ", ".join(unmet)
            diagnostics.append({
                "severity": "warn",
                "kind": "node_dependency",
                "title": f"{card['id']} waiting for upstream node",
                "detail": subject,
                "guidance": _diagnostic_guidance("node_dependency", subject),
            })
        if card["missing_capabilities"]:
            diagnostics.append({
                "severity": "warn",
                "kind": "capability",
                "title": f"{card['id']} capability mismatch",
                "detail": ", ".join(card["missing_capabilities"]),
                "guidance": _diagnostic_guidance("capability", card["id"]),
            })

        # Verification gate diagnostics
        vg = card.get("verification_gate") or {}
        if not isinstance(vg, dict):
            vg = {}

        # Check for missing patch
        if vg.get("patch_artifact", {}).get("status") == "missing":
            diagnostics.append({
                "severity": "error",
                "kind": "missing_patch",
                "title": f"{card['id']} missing patch/artifact evidence",
                "detail": "No handoff.md or patch artifact found",
                "guidance": _diagnostic_guidance("missing_patch", card["id"]),
            })

        # Check for missing test evidence
        if vg.get("test_evidence", {}).get("status") == "missing":
            diagnostics.append({
                "severity": "error",
                "kind": "missing_test",
                "title": f"{card['id']} missing test evidence",
                "detail": "No test_report.json or test_evidence.json found",
                "guidance": _diagnostic_guidance("missing_test", card["id"]),
            })

        # Check for missing review decision
        if vg.get("review_decision", {}).get("status") == "missing" and vg.get("verifier_required"):
            diagnostics.append({
                "severity": "error",
                "kind": "missing_review",
                "title": f"{card['id']} missing independent review decision",
                "detail": "No review_decision.yaml/json found and verifier_required=true",
                "guidance": _diagnostic_guidance("missing_review", card["id"]),
            })

        # Check for writer/verifier conflict
        if vg.get("writer_verifier_conflict", {}).get("detected") is True:
            writer_id = vg.get("writer_verifier_conflict", {}).get("writer_actor_id") or "unknown"
            diagnostics.append({
                "severity": "error",
                "kind": "writer_verifier_conflict",
                "title": f"{card['id']} writer and verifier are the same operator",
                "detail": f"Writer and verifier both: {writer_id}",
                "guidance": _diagnostic_guidance("writer_verifier_conflict", card["id"]),
            })

        # Check for provider conflict
        if vg.get("provider_conflict", {}).get("detected") is True:
            provider = vg.get("provider_conflict", {}).get("writer_provider") or "unknown"
            diagnostics.append({
                "severity": "error",
                "kind": "provider_conflict",
                "title": f"{card['id']} high-risk node uses same provider for writer and verifier",
                "detail": f"Both writer and verifier use provider: {provider}",
                "guidance": _diagnostic_guidance("provider_conflict", card["id"]),
            })

        # Overall verification gate degraded status
        if isinstance(vg, dict) and vg.get("verifier_required"):
            missing_items = []
            if vg.get("patch_artifact", {}).get("status") == "missing":
                missing_items.append("patch")
            if vg.get("test_evidence", {}).get("status") == "missing":
                missing_items.append("test")
            if vg.get("review_decision", {}).get("status") == "missing":
                missing_items.append("review")
            if missing_items and card["status"] in {"passed", "completed"}:
                diagnostics.append({
                    "severity": "warn",
                    "kind": "verification_gate",
                    "title": f"{card['id']} marked {card['status']} but missing verification evidence",
                    "detail": f"Missing: {', '.join(missing_items)}",
                    "guidance": _diagnostic_guidance("verification_gate", card["id"]),
                })

    return diagnostics


def _build_apo_chain_for_nodes(sid: str, nodes: list[dict], graph: dict) -> dict[str, dict]:
    """Build APO chain status per node via apo_chain_status adapter."""
    try:
        sys_path_insert = str(SCRIPT_HARNESS_DIR / "lib")
        if sys_path_insert not in __import__("sys").path:
            __import__("sys").path.insert(0, sys_path_insert)
        from orchestration.apo_chain_status import get_apo_chain_status
    except Exception:
        return {}
    result: dict[str, dict] = {}
    for node in nodes:
        nid = str(node.get("id") or "")
        if not nid:
            continue
        try:
            result[nid] = get_apo_chain_status(sid, nid, graph=graph)
        except Exception:
            result[nid] = {"mode": "unknown_degraded", "degraded_sources": [{"source": "apo_chain_status", "reason": "adapter_exception"}]}
    return result


def _build_pane_evidence(sid: str, node_cards: list[dict]) -> list[dict]:
    """Collect actor mailbox outbox evidence for each dispatched node."""
    actors_dir = HARNESS_DIR / "actors"
    if not actors_dir.exists():
        return []
    evidence: list[dict] = []
    for card in node_cards:
        nid = card.get("id", "")
        actor_id = card.get("actor_id") or ""
        if actor_id in ("N/A", ""):
            continue
        actor_dir = actors_dir / actor_id
        outbox_dir = actor_dir / "outbox"
        if not outbox_dir.exists():
            continue
        outbox_files = sorted(outbox_dir.glob("*.json"))
        for f in outbox_files:
            data, ok = _read_json(f)
            if ok and isinstance(data, dict):
                evidence.append({
                    "node_id": nid,
                    "actor_id": actor_id,
                    "outbox_file": str(f.name),
                    "verdict": data.get("verdict", ""),
                    "task_id": data.get("task_id", ""),
                })
    return evidence


def build_dashboard_payload(sprint_id: str | None = None) -> tuple[dict, list[str]]:
    degraded: list[str] = []
    active = _active_sprint_ids()
    sid = sprint_id or (active[0] if active else "")
    status = _load_status_by_sprint(sid) if sid else {}
    if not sid or not status:
        degraded.append("sprint_status:missing")

    tg, tg_ok = _load_task_graph(sid) if sid else ({}, False)
    if sid and not tg_ok:
        degraded.append(f"task_graph:missing:{sid}")
    nodes = tg.get("nodes") or []
    if not isinstance(nodes, list):
        nodes = []
        degraded.append(f"task_graph:nodes_invalid:{sid}")

    routing = _load_autopilot_routing(sid) if sid else []
    all_routing = _load_routing_decisions()
    panes = _load_pane_state()
    registry = _capability_registry()
    node_cards = _build_node_cards(sid, nodes, tg.get("runtime_state") or {}, routing)

    # APO chain status per node
    apo_chain = _build_apo_chain_for_nodes(sid, nodes, tg) if sid else {}
    # Inject enforcers/rejected_candidates into node cards
    for card in node_cards:
        nid = card.get("id", "")
        apo = apo_chain.get(nid, {})
        card["enforcers"] = apo.get("enforcers", [])
        card["rejected_candidates"] = apo.get("rejected_candidates", [])
        card["apo_mode"] = apo.get("mode", "unknown")
        # Surface APO degraded sources as card-level diagnostic
        apo_degraded = apo.get("degraded_sources", [])
        if apo_degraded:
            card["apo_degraded_sources"] = apo_degraded

    # Pane (actor mailbox) evidence
    pane_evidence = _build_pane_evidence(sid, node_cards)

    diagnostics = _build_blocker_diagnostics(sid, status, nodes, node_cards, tg_ok)

    # Add APO degraded sources to diagnostics
    for nid, apo in apo_chain.items():
        for ds in apo.get("degraded_sources", []):
            diagnostics.append({
                "severity": "warn",
                "kind": "apo_source_degraded",
                "title": f"{nid} APO source degraded",
                "detail": f"{ds.get('source', '?')}: {ds.get('reason', '?')} (file: {ds.get('file', '?')})",
                "guidance": [
                    f"Check {ds.get('file', '?')} exists and is valid JSON.",
                    "Regenerate the compiler artifact if missing.",
                    "APO chain explanation will be limited until source is restored.",
                ],
            })

    status_counts: dict[str, int] = {}
    cost_by_status: dict[str, float] = {}
    total_cost = 0.0
    for card in node_cards:
        st = card["status"]
        cost = float(card.get("estimated_cost") or 0)
        status_counts[st] = status_counts.get(st, 0) + 1
        cost_by_status[st] = cost_by_status.get(st, 0.0) + cost
        total_cost += cost

    return {
        "focus_sprint_id": sid,
        "active_sprints": active,
        "epic_id": status.get("epic_id", ""),
        "title": status.get("title", ""),
        "sprint_status": status.get("status", ""),
        "phase": status.get("phase", ""),
        "generated_from": {
            "status_json": _display_path(SPRINTS_DIR / f"{sid}.status.json") if sid else "",
            "task_graph_json": _display_path(SPRINTS_DIR / f"{sid}.task_graph.json") if sid else "",
            "autopilot_state": _display_path(STATE_DIR / "autopilot-state.json"),
            "pane_state": _display_path(STATE_DIR / "pane-state.json"),
        },
        "progress": {
            "total_nodes": len(node_cards),
            "status_counts": status_counts,
            "passed_nodes": status_counts.get("passed", 0),
            "blocked_nodes": status_counts.get("blocked", 0),
            "active_nodes": status_counts.get("active", 0),
        },
        "dag": {
            "required_gates": tg.get("required_gates") or [],
            "nodes": node_cards,
            "edges": [
                {"from": dep, "to": card["id"]}
                for card in node_cards
                for dep in card.get("depends_on", [])
            ],
        },
        "capabilities": {
            "demand": _capability_counts(nodes),
            "role_demand": _role_counts(nodes),
            "pane_supply": _build_pane_supply(panes, registry),
        },
        "resources": {
            "estimated_total_cost": total_cost,
            "cost_by_status": cost_by_status,
            "routing_records_for_sprint": len(routing),
            "routing_records_total": len(all_routing),
            "busy_panes": sorted({r.get("target_pane") for r in all_routing if r.get("decision") == "dispatched" and r.get("target_pane")}),
        },
        "blocker_diagnostics": diagnostics,
        "apo_chain": apo_chain,
        "pane_evidence": pane_evidence,
    }, degraded


def _build_pane_supply(panes: list[dict], registry: dict[str, list[str]]) -> list[dict]:
    supply: list[dict] = []
    for p in panes:
        pane_id = str(p.get("id") or "")
        provided = registry.get(pane_id, [])
        actorhost = _actorhost_for_pane(pane_id, provided)
        supply.append({
            "pane_id": pane_id,
            "role": p.get("role", ""),
            "state": p.get("state", ""),
            "model": p.get("model", ""),
            "provided_capabilities": provided,
            "pane_carrier": {
                "pane_id": pane_id,
                "role": p.get("role", ""),
                "state": p.get("state", ""),
                "model": p.get("model", ""),
            },
            "actorhost": actorhost,
            "actor_id": actorhost.get("actor_id", "N/A"),
            "host_id": actorhost.get("host_id", "N/A"),
            "host_type": actorhost.get("host_type", "unknown"),
            "lease_state": actorhost.get("lease_state", "unknown"),
            "capability_match": actorhost.get("capability_match") or {},
        })
    return supply


def _list_epics() -> list[dict]:
    """Return lightweight list of known epic IDs from sprints dir."""
    seen: set[str] = set()
    epics: list[dict] = []
    for sf in sorted(SPRINTS_DIR.glob("*.status.json")):
        try:
            s = json.loads(sf.read_text())
        except Exception:
            continue
        epic_id = s.get("epic_id", "")
        if epic_id and epic_id not in seen:
            seen.add(epic_id)
            epics.append({"epic_id": epic_id, "sprint_count": 0})
    # Count child sprints per epic
    counts: dict[str, int] = {}
    for e in epics:
        eid = e["epic_id"]
        counts[eid] = sum(
            1 for sf in SPRINTS_DIR.glob("*.status.json")
            if eid in sf.name
        )
        e["sprint_count"] = counts[eid]
    return epics


def _load_child_sprints(epic_id: str) -> list[dict]:
    children: list[dict] = []
    for sf in sorted(SPRINTS_DIR.glob("*.status.json")):
        try:
            s = json.loads(sf.read_text())
        except Exception:
            continue
        if s.get("epic_id", "") == epic_id:
            children.append({
                "sprint_id": s.get("sprint_id", sf.stem.replace(".status", "")),
                "title": s.get("title", ""),
                "status": s.get("status", ""),
                "phase": s.get("phase", ""),
                "priority": s.get("priority", ""),
                "blocked_by": _extract_blocked_by(s),
            })
    return children


def _extract_blocked_by(status: dict) -> list[str]:
    blocked: list[str] = []
    for h in status.get("history", []):
        if h.get("event", "").startswith("autopilot_epic_child_dependency_blocked"):
            for b in h.get("blocked_by", []):
                if b not in blocked:
                    blocked.append(b)
    return blocked


def _gate_summary(children: list[dict]) -> dict:
    passed = sum(1 for c in children if c["status"] in {"passed", "completed"})
    blocked = sum(1 for c in children if c["blocked_by"])
    active = sum(1 for c in children if c["status"] == "active")
    return {"total": len(children), "passed": passed, "active": active, "blocked": blocked}


def _load_autopilot_routing(sprint_id: str) -> list[dict]:
    ap_path = STATE_DIR / "autopilot-state.json"
    data, ok = _read_json(ap_path)
    if not ok or not data:
        return []
    decisions = data.get("routing_decisions", [])
    return [d for d in decisions if d.get("sprint_id") == sprint_id]


def _load_pane_state() -> list[dict]:
    ps, ok = _read_json(STATE_DIR / "pane-state.json")
    if not ok:
        return []
    panes = ps.get("panes", [])
    if isinstance(panes, list):
        return panes
    return [{"id": k, **v} for k, v in panes.items()]


def _capability_registry() -> dict[str, list[str]]:
    """Build pane_id -> capability list from role-based defaults."""
    import sys
    if str(HARNESS_DIR / "lib") not in sys.path:
        sys.path.insert(0, str(HARNESS_DIR / "lib"))
    try:
        from autopilot import _load_capability_registry
        return _load_capability_registry()
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Route: GET /orchestration/epics
# ---------------------------------------------------------------------------

@orchestration_bp.route("/epics", methods=["GET"])
def list_epics():
    degraded: list[str] = []
    epics = _list_epics()
    return jsonify(_envelope({"epics": epics}, degraded))


@orchestration_bp.route("", methods=["GET"])
@orchestration_bp.route("/", methods=["GET"])
def dashboard_page():
    template_path = HARNESS_DIR / "status-server" / "templates" / "orchestration_panel.html"
    try:
        return Response(template_path.read_text(encoding="utf-8"), mimetype="text/html")
    except OSError:
        return jsonify({"ok": False, "error": "orchestration template missing"}), 500


@orchestration_bp.route("/dashboard", methods=["GET"])
def dashboard_data():
    data, degraded = build_dashboard_payload(request.args.get("sprint_id") or None)
    return jsonify(_envelope(data, degraded))


# ---------------------------------------------------------------------------
# Route: GET /orchestration/epics/<epic_id>
# ---------------------------------------------------------------------------

@orchestration_bp.route("/epics/<path:epic_id>", methods=["GET"])
def get_epic(epic_id: str):
    degraded: list[str] = []

    children = _load_child_sprints(epic_id)
    gate_summary = _gate_summary(children)

    # Load epic task_graph if available
    tg_path = SPRINTS_DIR / f"{epic_id}.task_graph.json"
    tg, tg_ok = _read_json(tg_path)
    if not tg_ok:
        degraded.append(f"task_graph:missing:{epic_id}")
        tg = {}

    return jsonify(_envelope({
        "epic_id": epic_id,
        "child_sprints": children,
        "gate_status_summary": gate_summary,
        "task_graph_nodes": (tg.get("nodes") or []) if tg else [],
        "blocked_by": [b for c in children for b in c.get("blocked_by", [])],
    }, degraded))


# ---------------------------------------------------------------------------
# Route: GET /orchestration/sprints/<sid>
# ---------------------------------------------------------------------------

@orchestration_bp.route("/sprints/<path:sid>", methods=["GET"])
def get_sprint(sid: str):
    degraded: list[str] = []

    status, status_ok = _read_json(SPRINTS_DIR / f"{sid}.status.json")
    if not status_ok:
        return jsonify({"ok": False, "error": f"sprint not found: {sid}"}), 404

    tg, tg_ok = _read_json(SPRINTS_DIR / f"{sid}.task_graph.json")
    if not tg_ok:
        degraded.append(f"task_graph:missing:{sid}")
        tg = {}

    # Routing decisions from autopilot-state
    routing = _load_autopilot_routing(sid)

    # Sidecar/verifier refs from dispatch runtime-context files
    sidecar_refs: list[str] = []
    verifier_refs: list[str] = []
    for rc_file in SPRINTS_DIR.glob(f"{sid}*.runtime-context.json"):
        sidecar_refs.append(str(rc_file.relative_to(HARNESS_DIR)))
    for eval_file in SPRINTS_DIR.glob(f"{sid}*.context-usage.json"):
        verifier_refs.append(str(eval_file.relative_to(HARNESS_DIR)))

    if not sidecar_refs:
        degraded.append("sidecar_ref:missing")
    if not verifier_refs:
        degraded.append("verifier_ref:not_run")

    nodes = (tg.get("nodes") or []) if tg else []
    node_capability_hits = []
    registry = _capability_registry()
    panes = _load_pane_state()
    pane_role_map = {p["id"]: p.get("role", "") for p in panes}

    for node in nodes:
        nid = node.get("id", "")
        req = node.get("required_capabilities", [])
        # Find matching routing decision
        rd = next((r for r in routing if r.get("node_id") == nid), None)
        provided = rd.get("provided_capabilities", []) if rd else []
        provided_names = {
            c.removeprefix("inferred:") if isinstance(c, str) and c.startswith("inferred:") else c
            for c in provided
        }
        missing = [c for c in req if c not in provided_names]
        node_capability_hits.append({
            "node_id": nid,
            "required": req,
            "provided": provided,
            "missing": missing,
            "decision": rd.get("decision", "unknown") if rd else "no_routing_record",
            "target_pane": rd.get("target_pane", "") if rd else "",
            "sidecar_ref": rd.get("sidecar_ref") if rd else None,
            "verifier_ref": rd.get("verifier_ref") if rd else None,
        })

    return jsonify(_envelope({
        "sprint_id": sid,
        "status": status.get("status", ""),
        "phase": status.get("phase", ""),
        "node_capability_hits": node_capability_hits,
        "sidecar_refs": sidecar_refs,
        "verifier_refs": verifier_refs,
        "routing_decisions": routing,
        "apo_chain": _build_apo_chain_for_nodes(sid, nodes, tg) if tg_ok else {},
        "pane_evidence": _build_pane_evidence(sid, [
            {"id": n.get("id", ""), "actor_id": "N/A"}
            for n in nodes
        ]),
    }, degraded))


# ---------------------------------------------------------------------------
# Route: GET /orchestration/panes
# ---------------------------------------------------------------------------

@orchestration_bp.route("/panes", methods=["GET"])
def get_panes():
    degraded: list[str] = []
    panes = _load_pane_state()
    registry = _capability_registry()

    # Determine in_use_by from autopilot-state
    ap_data, ap_ok = _read_json(STATE_DIR / "autopilot-state.json")
    in_use: dict[str, str] = {}
    if ap_ok and ap_data:
        for rd in reversed(ap_data.get("routing_decisions", [])):
            pane_id = rd.get("target_pane", "")
            if pane_id and pane_id not in in_use and rd.get("decision") == "dispatched":
                in_use[pane_id] = rd.get("sprint_id", "")

    pane_info: list[dict] = []
    for p in panes:
        pid = p["id"]
        caps = registry.get(pid, [])
        pane_info.append({
            "pane_id": pid,
            "role": p.get("role", ""),
            "state": p.get("state", ""),
            "provided_capabilities": caps,
            "in_use_by": in_use.get(pid),
        })

    return jsonify(_envelope({"panes": pane_info}, degraded))


# ---------------------------------------------------------------------------
# Route: GET /orchestration/events (SSE + poll fallback)
# ---------------------------------------------------------------------------

@orchestration_bp.route("/events", methods=["GET"])
def stream_events():
    since = request.args.get("since", "")
    accept = request.headers.get("Accept", "")

    if "text/event-stream" in accept:
        return Response(
            stream_with_context(_sse_events(since)),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Poll fallback
    events = _read_events_since(since, limit=50)
    return jsonify(_envelope({"events": events}))


def _read_events_since(since: str, limit: int = 50) -> list[dict]:
    if not EVENTS_JSONL.exists():
        return []
    results: list[dict] = []
    try:
        lines = EVENTS_JSONL.read_text(encoding="utf-8", errors="ignore").splitlines()
        for line in reversed(lines[-200:]):
            try:
                ev = json.loads(line)
            except Exception:
                continue
            ts = ev.get("ts", "")
            if since and ts <= since:
                continue
            event_type = ev.get("event", "")
            if event_type.startswith(("autopilot_capability", "handoff_evidence")):
                results.append(ev)
            if len(results) >= limit:
                break
    except Exception:
        pass
    return list(reversed(results))


def _sse_events(since: str) -> Generator[str, None, None]:
    """Generate SSE stream of capability/evidence events."""
    last_ts = since
    try:
        while True:
            events = _read_events_since(last_ts, limit=10)
            for ev in events:
                last_ts = ev.get("ts", last_ts)
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
            time.sleep(2)
            yield ": heartbeat\n\n"
    except GeneratorExit:
        pass
