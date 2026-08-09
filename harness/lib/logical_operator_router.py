"""logical_operator_router.py — Maps logical operators to candidate actors via bindings.

16 P0 logical operator types mapped through data bindings, not hard-coded.
Changing a binding changes the selected actor without editing the DAG node.

Policy-aware selection (S03 runtime constraints) reads each logical operator's
``risk_constraints``, ``cost_hint``, ``effort_hint`` and ``required_capabilities``
from ``logical-operators.json`` and evaluates every candidate against its actor
profile via :mod:`actor_profiles`.  Candidates whose policy decision is a hard
deny (``risk_denied`` / ``capability_missing``) or a cost-reserve miss
(``reserve_miss``) are excluded from the ranking pool and recorded in
``rejected_candidates``; ``quota_reserved`` candidates are likewise excluded.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:  # actor_profiles ships alongside this module on the harness lib path
    from actor_profiles import (
        ActorProfile,
        PolicyDecision,
        evaluate_actor_policy,
        normalize_policy_requirements,
    )
except ImportError:  # pragma: no cover - exercised only when lib layout differs
    from .actor_profiles import (  # type: ignore
        ActorProfile,
        PolicyDecision,
        evaluate_actor_policy,
        normalize_policy_requirements,
    )

HOME = Path.home()
HARNESS_DIR = Path.home() / ".solar" / "harness"
LOGICAL_OPS_PATH = HARNESS_DIR / "config" / "logical-operators.json"
ACTORS_PATH = HARNESS_DIR / "config" / "agent-actors.json"

# Policy reason codes that remove a candidate from the ranking pool entirely.
HARD_DENY_REASON_SUFFIX = "_denied"
EXCLUDING_REASON_CODES = frozenset({"reserve_miss", "actor_profile_missing"})

P0_LOGICAL_OPERATORS = frozenset([
    "DeepArchitect", "RootCauseDebugger", "ImplementationWorker", "PatchWorker",
    "TestDesigner", "TestRunner", "BenchmarkRunner", "ParallelExplorer",
    "ResearchScout", "ResearchSynthesizer", "Critic", "Verifier", "VerifierLite",
    "SecurityGate", "QuotaBroker", "ContextCompressor", "ArtifactCurator",
])


class LogicalOperatorRouter:
    """Routes logical operators to candidate actors through bindings."""

    def __init__(
        self,
        bindings_path: Optional[Path] = None,
        actors_path: Optional[Path] = None,
    ):
        self.bindings_path = bindings_path or LOGICAL_OPS_PATH
        self.actors_path = actors_path or ACTORS_PATH
        self._bindings: Dict[str, Dict[str, Any]] = {}
        self._actors: Dict[str, Dict[str, Any]] = {}
        self._operator_defs: Dict[str, Dict[str, Any]] = {}
        self._profiles: Dict[str, ActorProfile] = {}
        self._load()

    def _load(self) -> None:
        if self.bindings_path.exists():
            data = json.loads(self.bindings_path.read_text(encoding="utf-8"))
            bindings = data.get("bindings", {})
            # bindings can be dict (keyed by operator_type) or list
            if isinstance(bindings, dict):
                for op, entry in bindings.items():
                    self._bindings[op] = entry
            elif isinstance(bindings, list):
                for entry in bindings:
                    op = entry.get("operator_type", "")
                    self._bindings[op] = entry
            # Logical operator definitions (risk/cost/effort/capability hints)
            # live in the same file as the bindings.
            defs = data.get("logical_operators", {})
            if isinstance(defs, dict):
                self._operator_defs = dict(defs)
            elif isinstance(defs, list):
                for entry in defs:
                    op = entry.get("operator_type", "")
                    if op:
                        self._operator_defs[op] = entry

        if self.actors_path.exists():
            data = json.loads(self.actors_path.read_text(encoding="utf-8"))
            self._actors = data.get("actors", {})
            self._profiles = {
                actor_id: ActorProfile.from_actor_data(actor_data)
                for actor_id, actor_data in self._actors.items()
                if isinstance(actor_data, dict) and actor_data.get("actor_id")
            }

    def operator_definition(self, operator_type: str) -> Dict[str, Any]:
        """Return the logical-operator definition (risk/cost/effort/capabilities)."""
        return dict(self._operator_defs.get(operator_type, {}))

    def get_profile(self, actor_id: str) -> Optional[ActorProfile]:
        """Return the loaded actor profile, if any."""
        return self._profiles.get(actor_id)

    def get_candidates(self, operator_type: str) -> List[str]:
        """Get ordered candidate actor_ids for a logical operator."""
        binding = self._bindings.get(operator_type, {})
        candidates = binding.get("candidates", [])
        # candidates can be list of dicts with actor_id or list of strings
        if candidates and isinstance(candidates[0], dict):
            return [c.get("actor_id", "") for c in candidates]
        return list(candidates)

    def select_actor(
        self,
        operator_type: str,
        unavailable: Optional[set] = None,
        quota_blocked: Optional[set] = None,
        risk_denied: Optional[set] = None,
    ) -> Tuple[Optional[str], List[Dict[str, str]]]:
        """Select best available actor for operator_type.

        Returns (selected_actor_id, rejected_list_with_reasons).
        """
        candidates = self.get_candidates(operator_type)
        unavail = unavailable or set()
        blocked = quota_blocked or set()
        denied = risk_denied or set()
        rejected: List[Dict[str, str]] = []

        for actor_id in candidates:
            if actor_id in unavail:
                rejected.append({"actor_id": actor_id, "reason": "unavailable"})
                continue
            if actor_id in blocked:
                rejected.append({"actor_id": actor_id, "reason": "quota_blocked"})
                continue
            if actor_id in denied:
                rejected.append({"actor_id": actor_id, "reason": "risk_denied"})
                continue
            return actor_id, rejected

        return None, rejected

    def _build_requirements(
        self,
        operator_type: str,
        task: Optional[Dict[str, Any]] = None,
        resource_context: Optional[Dict[str, Any]] = None,
    ):
        """Normalize the logical-operator definition + task overrides into policy requirements."""
        operator_def = dict(self._operator_defs.get(operator_type, {}))
        # Ensure operator_type is carried so PolicyRequirements.logical_operator is populated.
        operator_def.setdefault("operator_type", operator_type)
        return normalize_policy_requirements(operator_def, task, resource_context)

    def select_with_policy(
        self,
        operator_type: str,
        *,
        task: Optional[Dict[str, Any]] = None,
        resource_context: Optional[Dict[str, Any]] = None,
        unavailable: Optional[set] = None,
        quota_blocked: Optional[set] = None,
        quota_reserved: Optional[set] = None,
    ) -> Dict[str, Any]:
        """Select an actor for ``operator_type`` using actor-profile policy decisions.

        The router reads the logical operator's ``risk_constraints``, ``cost_hint``,
        ``effort_hint`` and ``required_capabilities`` (via the operator definition),
        evaluates every bound candidate against its actor profile, and constructs:

        - ``eligible``: ordered actor ids that pass policy (allowed, not reserve-miss,
          not quota-reserved, available);
        - ``rejected_candidates``: ``[{actor_id, reason}]`` for every excluded candidate;
        - ``selected_actor``: the first eligible candidate (binding order is priority).

        Returns a machine-readable dict suitable for evidence/lease replay.
        """
        unavail = set(unavailable or set())
        blocked = set(quota_blocked or set())
        reserved = set(quota_reserved or set())

        requirements = self._build_requirements(operator_type, task, resource_context)
        candidates = self.get_candidates(operator_type)

        eligible: List[str] = []
        rejected: List[Dict[str, str]] = []
        decisions: Dict[str, Dict[str, Any]] = {}

        for actor_id in candidates:
            profile = self._profiles.get(actor_id)
            if profile is None:
                rejected.append({"actor_id": actor_id, "reason": "actor_profile_missing"})
                continue

            # Runtime availability gates run before policy so the rejection reason
            # is the most actionable one for the operator.
            if actor_id in unavail:
                rejected.append({"actor_id": actor_id, "reason": "unavailable"})
                continue
            if actor_id in blocked:
                rejected.append({"actor_id": actor_id, "reason": "quota_blocked"})
                continue
            if actor_id in reserved:
                rejected.append({"actor_id": actor_id, "reason": "quota_reserved"})
                continue

            decision = evaluate_actor_policy(profile, requirements)
            decisions[actor_id] = decision.to_dict()
            reason = self._exclusion_reason(decision)
            if reason is not None:
                rejected.append({"actor_id": actor_id, "reason": reason})
                continue
            eligible.append(actor_id)

        selected = eligible[0] if eligible else None
        return {
            "operator_type": operator_type,
            "selected_actor": selected,
            "eligible": eligible,
            "rejected_candidates": rejected,
            "decisions": decisions,
            "requirements": requirements.to_dict(),
            "policy_version": (
                decisions[selected]["policy_version"]
                if selected and selected in decisions
                else (PolicyDecision(actor_id="", logical_operator=operator_type,
                                     allowed=False, reasons=[], risk_fit=0.0,
                                     cost_fit=0.0, capability_fit=0.0).policy_version)
            ),
        }

    @staticmethod
    def _exclusion_reason(decision: "PolicyDecision") -> Optional[str]:
        """Return the reason a policy decision excludes a candidate, else ``None``.

        A candidate is excluded from the ranking pool when:
        - it carries a hard deny reason (``*_denied``: risk_denied / git_push etc.),
        - capability is missing (``capability_missing:*``),
        - it is a cost-reserve miss (``reserve_miss``),
        - ``allowed=false`` for any other policy reason.
        """
        for reason in decision.reasons:
            if reason.endswith(HARD_DENY_REASON_SUFFIX):
                return reason
            if reason.startswith("capability_missing"):
                return reason
            if reason in EXCLUDING_REASON_CODES:
                return reason
        if not decision.allowed:
            # allowed=false without a more specific code above (e.g. capability
            # below requirement that drove allowed to false): surface first reason.
            return decision.reasons[0] if decision.reasons else "policy_denied"
        return None

    def validate_all_operators_bound(self) -> List[str]:
        """Return list of operators with no bindings."""
        unbound = []
        for op in P0_LOGICAL_OPERATORS:
            if op not in self._bindings or not self._bindings[op].get("candidates"):
                unbound.append(op)
        return unbound
