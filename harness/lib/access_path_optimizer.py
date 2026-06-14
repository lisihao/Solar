"""AccessPathOptimizer core decision for terminal-first access routing."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from optimizer_runtime import DecisionTrace

from optimizer_runtime.core import AccessPath
from optimizer_runtime.core import Decision
from optimizer_runtime.core import DecisionKind
from optimizer_runtime.core import SelectionState
from optimizer_runtime.core import append_trace
from optimizer_runtime.core import now_iso

_PATH_ORDER = [
    AccessPath.TERMINAL_DIRECT_API.value,
    AccessPath.TERMINAL_EXPLORE_API.value,
    AccessPath.MCP_ADAPTER.value,
    AccessPath.HYBRID_MIN_BROWSER.value,
    AccessPath.BROWSER_FALLBACK.value,
]
_NO_AVAILABLE_ACCESS_PATH = "no_available_access_path"


def _to_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        lowered = value.strip().lower()
        return lowered in {"1", "true", "yes", "on"}
    return default


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp_0_1(value: Any, default: float) -> float:
    value = _to_float(value, default=default)
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


def _coerce_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, tuple):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


@dataclass
class AccessPathDecisionResult:
    """Structured access-path decision result returned by AccessPathOptimizer."""

    decision: Decision
    access_path: str
    fallback_chain: list[str]
    rationale: str


def _evaluate_policy_denials(
    task_inputs: dict[str, Any],
    policy_cfg: dict[str, Any],
    capsule_access_cfg: dict[str, Any],
) -> list[dict[str, str]]:
    denials: list[dict[str, str]] = []
    browser_gate = bool(policy_cfg.get("browser_as_min_fallback", True))
    if not browser_gate and (
        _to_bool(task_inputs.get("need_rendered_state"))
        or _to_bool(task_inputs.get("session_bound_workflow"))
        or _to_bool(task_inputs.get("arbitrary_payload_discovery"))
    ):
        denials.append({"path": "browser_fallback", "reason_code": "policy_forbidden_browser"})
        denials.append({"path": "hybrid_min_browser", "reason_code": "policy_forbidden_browser"})

    mcp_forbid = _to_bool(policy_cfg.get("forbid_mcp", False))
    if mcp_forbid:
        denials.append({"path": "mcp_adapter", "reason_code": "policy_forbidden"})
    if "mcp_adapter" in capsule_access_cfg.get("forbidden", []):
        denials.append({"path": "mcp_adapter", "reason_code": "capsule_forbidden"})
    if "browser_fallback" in capsule_access_cfg.get("forbidden", []):
        denials.append({"path": "browser_fallback", "reason_code": "capsule_forbidden"})
    if "hybrid_min_browser" in capsule_access_cfg.get("forbidden", []):
        denials.append({"path": "hybrid_min_browser", "reason_code": "capsule_forbidden"})
    return denials


def _is_forbidden(path: str, capsule_access_cfg: dict[str, Any], policy_denials: list[dict[str, str]]) -> bool:
    for reason in policy_denials:
        if reason.get("path") == path:
            return True
    allowed = capsule_access_cfg.get("allowed")
    if isinstance(allowed, list):
        if allowed and path not in {str(item) for item in allowed}:
            return True
    return False


def _build_signals(task: dict[str, Any], capsule: dict[str, Any], platform: dict[str, Any], policy_cfg: dict[str, Any]) -> dict[str, Any]:
    return {
        "api_completeness": _clamp_0_1(task.get("api_completeness", _clamp_0_1(platform.get("api_completeness", 0.0), 0.0)), 0.0),
        "mcp_tool_schema_coverage": _clamp_0_1(task.get("mcp_tool_schema_coverage", platform.get("mcp_tool_schema_coverage", 0.0)), 0.0),
        "need_rendered_state": _to_bool(task.get("need_rendered_state") or task.get("needs_rendered_state"), False),
        "session_bound_workflow": _to_bool(
            task.get("session_bound_workflow") or task.get("requires_session_workflow"),
            False,
        ),
        "arbitrary_payload_discovery": _to_bool(
            task.get("arbitrary_payload_discovery"),
            bool(capsule.get("access_contract", {}).get("api_requirements")),
        ),
        "browser_as_min_fallback": _to_bool(
            policy_cfg.get("browser_as_min_fallback"),
            bool(capsule.get("access_contract", {}).get("browser_required_conditions")),
        ),
    }


def _ordered_candidates(capsule_access_cfg: dict[str, Any]) -> list[str]:
    preferred = _coerce_list(capsule_access_cfg.get("preferred"))
    if not preferred:
        return list(_PATH_ORDER)
    # Force terminal-first regardless of preferred ordering.
    ordered_set = [p for p in _PATH_ORDER if p in preferred]
    for candidate in _PATH_ORDER:
        if candidate not in ordered_set:
            ordered_set.append(candidate)
    return ordered_set


def _select_decision(
    signals: dict[str, Any],
    candidates: list[str],
    policy_denials: list[dict[str, str]],
    policy_cfg: dict[str, Any],
    capsule_access_cfg: dict[str, Any],
) -> tuple[str, list[str], list[dict[str, str]]]:
    denials = list(policy_denials)
    fallback_chain: list[str] = []
    for candidate in _PATH_ORDER:
        if candidate not in candidates:
            continue
        if _is_forbidden(candidate, capsule_access_cfg, denials):
            denials.append({"path": candidate, "reason_code": "forbidden_by_capsule_or_policy"})
            continue

        if candidate == AccessPath.TERMINAL_DIRECT_API.value:
            if signals["api_completeness"] >= float(policy_cfg.get("terminal_direct_api_min", 0.8)):
                return candidate, [candidate] + [c for c in _PATH_ORDER if c != candidate], denials
            denials.append({"path": candidate, "reason_code": "insufficient_api_coverage"})
        elif candidate == AccessPath.TERMINAL_EXPLORE_API.value:
            if signals["api_completeness"] >= float(policy_cfg.get("terminal_explore_api_min", 0.35)):
                return candidate, [candidate] + [c for c in _PATH_ORDER if c != candidate], denials
            denials.append({"path": candidate, "reason_code": "insufficient_api_coverage"})
        elif candidate == AccessPath.MCP_ADAPTER.value:
            if signals["mcp_tool_schema_coverage"] >= float(policy_cfg.get("mcp_adapter_min", 0.45)):
                return candidate, [candidate] + [c for c in _PATH_ORDER if c != candidate], denials
            denials.append({"path": candidate, "reason_code": "insufficient_mcp_schema"})
        elif candidate == AccessPath.HYBRID_MIN_BROWSER.value:
            if signals["browser_as_min_fallback"] and (
                signals["need_rendered_state"]
                or signals["session_bound_workflow"]
                or signals["arbitrary_payload_discovery"]
            ):
                return candidate, [candidate] + [c for c in _PATH_ORDER if c != candidate], denials
            denials.append({"path": candidate, "reason_code": "browser_conditions_not_met"})
        elif candidate == AccessPath.BROWSER_FALLBACK.value:
            if signals["browser_as_min_fallback"]:
                return candidate, [candidate] + [c for c in _PATH_ORDER if c != candidate], denials
            denials.append({"path": candidate, "reason_code": "browser_forbidden_by_policy"})

    fallback_chain = [c for c in _PATH_ORDER if c in candidates and not _is_forbidden(c, capsule_access_cfg, denials)]
    return _NO_AVAILABLE_ACCESS_PATH, fallback_chain, denials


class AccessPathOptimizer:
    """Pick terminal-first access path with evidence trace output."""

    def __init__(self, *, policy: dict[str, Any] | None = None):
        self.policy = policy or {}

    def decide(
        self,
        task_envelope: dict[str, Any],
        *,
        capsule_registry: dict[str, Any] | None = None,
        platform_profile: dict[str, Any] | None = None,
        policy: dict[str, Any] | None = None,
    ) -> AccessPathDecisionResult:
        task = task_envelope or {}
        capsule = capsule_registry or {}
        platform = platform_profile or {}
        policy_root = policy or self.policy
        policy_cfg = policy_root.get("access_path", {}) if isinstance(policy_root, dict) else {}

        access_contract = capsule.get("access_contract", {})
        capsule_access = {
            "preferred": _coerce_list(access_contract.get("preferred")),
            "allowed": _coerce_list(access_contract.get("allowed")),
            "forbidden": _coerce_list(access_contract.get("forbidden")),
        }

        signals = _build_signals(task, capsule, platform, policy_cfg)
        policy_denials = _evaluate_policy_denials(task, policy_cfg, capsule_access)
        candidates = _ordered_candidates(capsule_access)

        decision = Decision(
            kind=DecisionKind.ACCESS_PATH,
            selected=AccessPath.BROWSER_FALLBACK.value,
            rationale="",
            fallback_chain=[],
            policy_denials=[],
            evidence_refs=[],
            confidence=0.0,
        )
        append_trace(
            decision,
            SelectionState.ACCESS_PATH_SELECTING.value,
            "access_path_selector_entered",
            {"task_ref": task.get("task_id") or task.get("task_ref")},
        )

        selected_path, fallback_chain, denials = _select_decision(
            signals,
            candidates,
            policy_denials,
            policy_cfg,
            capsule_access,
        )
        decision.selected = selected_path

        if selected_path == AccessPath.TERMINAL_DIRECT_API.value:
            rationale = "terminal_direct_api selected because direct API coverage meets terminal-first threshold"
        elif selected_path == AccessPath.TERMINAL_EXPLORE_API.value:
            rationale = "terminal_explore_api selected after direct API fallback due to partial API coverage"
        elif selected_path == AccessPath.MCP_ADAPTER.value:
            rationale = "mcp_adapter selected as policy adapter for API-constrained path; browser kept as fallback only"
        elif selected_path == AccessPath.HYBRID_MIN_BROWSER.value:
            rationale = "hybrid_min_browser selected for rendered/session/arbitrary payload requirement"
        elif selected_path == _NO_AVAILABLE_ACCESS_PATH:
            rationale = "no_available_access_path selected because all viable terminal/MCP/browser candidates were denied or below threshold"
        else:
            rationale = "browser_fallback selected as terminal-only-minimum fallback"

        if selected_path == _NO_AVAILABLE_ACCESS_PATH:
            append_trace(decision, SelectionState.DENIED.value, "no_available_access_path")
        elif selected_path in {AccessPath.BROWSER_FALLBACK.value, AccessPath.HYBRID_MIN_BROWSER.value}:
            append_trace(decision, SelectionState.DENIED.value, "browser_selected_as_fallback_only")
        else:
            append_trace(decision, SelectionState.EXECUTION_READY.value, "primary_or_secondary_access_path_selected")

        decision.rationale = rationale
        decision.fallback_chain = list(dict.fromkeys(fallback_chain))
        decision.policy_denials = denials
        decision.confidence = max(0.35, 1.0 - len(denials) * 0.05)
        decision.trace_payload = {
            "schema_version": "solar.access_path_decision.v1",
            "task_ref": task.get("task_id"),
            "capsule_ref": capsule.get("capsule_id"),
            "input_signals": {
                "api_completeness": signals["api_completeness"],
                "mcp_tool_schema_coverage": signals["mcp_tool_schema_coverage"],
                "need_rendered_state": signals["need_rendered_state"],
                "session_bound_workflow": signals["session_bound_workflow"],
                "arbitrary_payload_discovery": signals["arbitrary_payload_discovery"],
                "browser_as_min_fallback": signals["browser_as_min_fallback"],
            },
            "evidence_refs": [str(item) for item in task.get("evidence_refs", [])],
            "policy_denials": denials,
            "timestamp": now_iso(),
        }

        return AccessPathDecisionResult(
            decision=decision,
            access_path=selected_path,
            fallback_chain=list(decision.fallback_chain),
            rationale=rationale,
        )


def select_access_path(payload: dict[str, Any], actor_profile: dict[str, Any] | None = None) -> DecisionTrace:
    """Backward-compatible entry for historical callers."""
    env = dict(payload or {})
    task = env
    if isinstance(env.get("task_envelope"), dict):
        task = env["task_envelope"]

    capsule = {}
    if isinstance(env.get("resolved_capability_capsule"), dict):
        capsule = env["resolved_capability_capsule"]
    elif isinstance(env.get("capsule"), dict):
        capsule = env["capsule"]
    elif isinstance(env.get("capsule_registry"), dict):
        capsule = env["capsule_registry"]

    platform = {}
    if isinstance(env.get("platform_profile"), dict):
        platform = env["platform_profile"]
    elif isinstance(env.get("platform"), dict):
        platform = env["platform"]

    policy = {}
    if isinstance(env.get("policy"), dict):
        policy = env["policy"]

    result = AccessPathOptimizer(policy=policy).decide(task, capsule_registry=capsule, platform_profile=platform, policy=policy)
    return DecisionTrace(
        component="access_path_optimizer",
        selected=result.access_path,
        rationale=result.rationale,
        fallback_chain=[str(item) for item in result.fallback_chain],
        policy_denials=[str(denial.get("reason_code")) for denial in result.decision.policy_denials],
        evidence=dict(result.decision.trace_payload or {}),
    )
