"""ModeSelector core decision for execution/evolution routing with audit trace."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from optimizer_runtime import DecisionTrace

try:
    from optimizer_runtime.core import append_trace
    from optimizer_runtime.core import AccessPath
    from optimizer_runtime.core import Decision
    from optimizer_runtime.core import DecisionKind
    from optimizer_runtime.core import Mode
    from optimizer_runtime.core import SelectionState
    from optimizer_runtime.core import now_iso
except Exception:  # pragma: no cover
    from optimizer_runtime.core import append_trace
    from optimizer_runtime.core import AccessPath
    from optimizer_runtime.core import Decision
    from optimizer_runtime.core import DecisionKind
    from optimizer_runtime.core import Mode
    from optimizer_runtime.core import SelectionState
    from optimizer_runtime.core import now_iso


_EVOLUTION_KEYWORDS = {
    "evolution",
    "evolve",
    "policy",
    "optimiz",
    "benchmark",
    "search",
    "discovery",
    "kernel",
    "capsule",
    "research",
}

_UNSURE_FALLBACK = "insufficient task context; default execution_mode"


@dataclass
class ModeSelectionResult:
    """Structured mode decision output for optimizer runtime."""

    decision: Decision
    mode: str
    fallback_chain: list[str]
    rationale: str


def _to_str(value: Any) -> str:
    return str(value) if value is not None else ""


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, tuple):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _get_task_mode_hint(task_envelope: dict[str, Any]) -> str:
    candidates = [
        str(task_envelope.get("mode") or ""),
        str(task_envelope.get("mode_hint") or ""),
        str(task_envelope.get("dispatch_mode") or ""),
        str(task_envelope.get("runtime_mode") or ""),
        str(task_envelope.get("lane_hint") or ""),
    ]
    for value in candidates:
        normalized = value.strip().lower().replace("-", "_")
        if normalized in {"execution", "execution_mode"}:
            return "execution"
        if normalized in {"evolution", "evolution_mode"}:
            return "evolution"
        if normalized == "uncertain":
            return "uncertain"
    return "unspecified"


def _supports_evolution(capsule_registry: dict[str, Any]) -> bool:
    capsule = capsule_registry or {}
    mode_cfg = capsule.get("mode") or {}
    supports = mode_cfg.get("supports")
    if isinstance(supports, list):
        return "evolution" in {str(item).lower() for item in supports}
    if isinstance(supports, str):
        return supports.lower() == "evolution"
    return False


def _evolution_signal(task_envelope: dict[str, Any]) -> bool:
    objective = (
        _to_str(task_envelope.get("objective"))
        + " "
        + _to_str(task_envelope.get("task"))
        + " "
        + _to_str(task_envelope.get("description"))
        + " "
        + _to_str(task_envelope.get("task_type"))
    ).lower()
    if objective and any(token in objective for token in _EVOLUTION_KEYWORDS):
        return True

    task_meta = {_to_str(item).lower() for item in _as_list(task_envelope.get("task_classes"))}
    if any(item in task_meta for item in _EVOLUTION_KEYWORDS):
        return True

    explicit_markers = {"open_ended", "benchmark", "lineage", "population", "kernel"}
    if explicit_markers.intersection(task_meta):
        return True
    return False


def _policy_allows_evolution(policy: dict[str, Any], platform_profile: dict[str, Any]) -> bool:
    policy_allow = True
    if isinstance((policy or {}).get("evolution"), dict):
        policy_allow = bool((policy or {}).get("evolution", {}).get("allow", True))
    if not policy_allow:
        return False
    return bool(platform_profile.get("evolution_available", True)) if platform_profile else True


class ModeSelector:
    """Choose between execution_mode and evolution_mode with policy-aware fallback."""

    def __init__(self, *, policy: dict[str, Any] | None = None):
        self.policy = policy or {}

    def choose(
        self,
        task_envelope: dict[str, Any],
        *,
        capsule_registry: dict[str, Any] | None = None,
        platform_profile: dict[str, Any] | None = None,
        policy: dict[str, Any] | None = None,
    ) -> ModeSelectionResult:
        p = policy if policy is not None else self.policy
        capsule = capsule_registry or {}
        platform = platform_profile or {}

        decision = Decision(
            kind=DecisionKind.MODE,
            selected=Mode.EXECUTION.value,
            rationale="",
            fallback_chain=[],
            policy_denials=[],
            evidence_refs=[],
            confidence=0.0,
        )
        append_trace(
            decision,
            SelectionState.MODE_SELECTING.value,
            "mode_selector_entered",
            {"task_ref": task_envelope.get("task_id") or task_envelope.get("task_ref")},
        )

        supports_evolution = _supports_evolution(capsule)
        policy_evolution = _policy_allows_evolution(p, platform)
        hint = _get_task_mode_hint(task_envelope)

        policy_denials: list[dict[str, str]] = []
        fallback_chain: list[str] = [Mode.EXECUTION.value]
        confidence = 0.82
        selected_mode = Mode.EXECUTION

        if hint == "evolution":
            fallback_chain.insert(0, Mode.EVOLUTION.value)
            if not supports_evolution:
                policy_denials.append({"path": "evolution_mode", "reason_code": "capsule_forbidden_evolution_not_supported"})
            elif not policy_evolution:
                policy_denials.append({"path": "evolution_mode", "reason_code": "policy_blocked_evolution"})
            else:
                selected_mode = Mode.EVOLUTION
                confidence = 0.99
        elif hint == "execution":
            selected_mode = Mode.EXECUTION
            confidence = 0.99
        else:
            if hint in {"uncertain", "unspecified"} or not task_envelope:
                rationale_tail = f"{_UNSURE_FALLBACK}; "
            else:
                rationale_tail = ""

            if _evolution_signal(task_envelope):
                fallback_chain.insert(0, Mode.EVOLUTION.value)
                if supports_evolution and policy_evolution and _to_str(task_envelope.get("task_id")):
                    selected_mode = Mode.EVOLUTION
                    confidence = 0.72
                else:
                    if not supports_evolution:
                        policy_denials.append({"path": "evolution_mode", "reason_code": "capsule_forbidden_evolution_not_supported"})
                    if not policy_evolution:
                        policy_denials.append({"path": "evolution_mode", "reason_code": "policy_blocked_evolution"})
                    selected_mode = Mode.EXECUTION
                    confidence = 0.88
                    append_trace(
                        decision,
                        SelectionState.EXECUTION_FALLBACK.value,
                        "fallback_due_to_evolution_constraints",
                    )
            else:
                selected_mode = Mode.EXECUTION
                confidence = 0.95
                fallback_chain = [Mode.EXECUTION.value]

        rationale = (
            f"selected={selected_mode.value}; hint={hint}; "
            f"capsule_supports_evolution={supports_evolution}; "
            f"policy_allows_evolution={policy_evolution}; "
            f"context_task_id={task_envelope.get('task_id') or 'N/A'}"
        )

        if hint in {"uncertain", "unspecified"} and (not task_envelope or not _to_str(task_envelope.get("task_id"))):
            policy_denials.append({"path": "mode", "reason_code": "insufficient_task_context"})
            rationale = f"{_UNSURE_FALLBACK}; {rationale}"
            append_trace(
                decision,
                SelectionState.EXECUTION_FALLBACK.value,
                "uncertain_hint_or_missing_task_defaulted_to_execution",
            )

        if selected_mode == Mode.EVOLUTION:
            append_trace(
                decision,
                SelectionState.EVOLUTION_READY.value,
                "evolution_mode_selected",
                {"capsule_id": capsule.get("capsule_id")},
            )
            fallback_chain = [Mode.EVOLUTION.value, Mode.EXECUTION.value]
        else:
            append_trace(
                decision,
                SelectionState.EXECUTION_READY.value,
                "execution_mode_selected",
                {"capsule_id": capsule.get("capsule_id")},
            )
            if selected_mode == Mode.EXECUTION and Mode.EVOLUTION.value in fallback_chain:
                fallback_chain = [Mode.EVOLUTION.value, Mode.EXECUTION.value]

        decision.selected = selected_mode.value
        decision.rationale = rationale
        decision.confidence = round(float(confidence), 3)
        decision.fallback_chain = list(dict.fromkeys(fallback_chain))
        decision.policy_denials = policy_denials
        decision.trace_payload = {
            "schema_version": "solar.optimizer.mode_selector.v1",
            "task_ref": task_envelope.get("task_id"),
            "capsule_ref": capsule.get("capsule_id"),
            "platform_ref": platform.get("platform_id") or platform.get("platform"),
            "timestamp": now_iso(),
            "evidence_trace": {
                "task_features": {
                    "objective": task_envelope.get("objective") or task_envelope.get("task") or task_envelope.get("description"),
                    "task_type": task_envelope.get("task_type"),
                    "task_classes": _as_list(task_envelope.get("task_classes")),
                },
                "capsule_features": {
                    "mode_supports": _as_list((capsule.get("mode") or {}).get("supports")),
                },
                "platform_features": {
                    "evolution_available": bool(platform.get("evolution_available", True)) if platform else True,
                },
            },
        }

        return ModeSelectionResult(
            decision=decision,
            mode=selected_mode.value,
            fallback_chain=list(decision.fallback_chain),
            rationale=decision.rationale,
        )


def select_mode(payload: dict[str, Any]) -> DecisionTrace:
    """Backward-compatible entry for historical callers."""
    task = dict(payload or {})
    if "task_envelope" in task and isinstance(task["task_envelope"], dict):
        task_envelope = task["task_envelope"]
    else:
        task_envelope = task

    capsule = {}
    if isinstance(task.get("resolved_capability_capsule"), dict):
        capsule = task["resolved_capability_capsule"]
    elif isinstance(task.get("capsule_registry"), dict):
        capsule = task["capsule_registry"]
    elif isinstance(task.get("capsule"), dict):
        capsule = task["capsule"]

    platform = {}
    if isinstance(task.get("platform_profile"), dict):
        platform = task["platform_profile"]
    elif isinstance(task.get("platform"), dict):
        platform = task["platform"]

    policy = task.get("policy") if isinstance(task.get("policy"), dict) else {}

    result = ModeSelector(policy=policy).choose(task_envelope, capsule_registry=capsule, platform_profile=platform, policy=policy)
    return DecisionTrace(
        component="mode_selector",
        selected=result.mode,
        rationale=result.rationale,
        fallback_chain=list(result.fallback_chain),
        policy_denials=[denial.get("reason_code") for denial in result.decision.policy_denials],
        evidence=result.decision.trace_payload or {},
    )
