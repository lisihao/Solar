"""actor_runtime.py — Main submit protocol for AgentActor runtime.

Grants lease, writes task_envelope to mailbox inbox,
writes evidence ledger, loads context packet, returns lease/result paths.
No direct tmux scheduler calls.
"""
from __future__ import annotations

import json
import os
import sys
import uuid
import datetime
import importlib.util
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from actor_lease import LeaseBroker, LeaseState, READY, LEASED, RUNNING, FINALIZING
from actor_mailbox import ActorMailbox
from actor_profiles import ActorProfile, evaluate_actor_policy, load_profiles
from logical_operator_router import LogicalOperatorRouter
from operator_score import OperatorScoreResult, rank_actors, TaskEvidence
from evidence_ledger import EvidenceLedger, RunMaterializer, NoopMaterializer, build_scheduler_decision
from context_store import ContextStore
from capability_token import CapabilityToken, PolicyDecision
from verification_gate import VerificationGate
from apo_plan_compiler import compile_execution_plan_for_node, materialize_execution_plan_artifacts
from mode_selector import select_mode
from access_path_optimizer import select_access_path
from optimizer_runtime import merge_trace_payload

HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))

DISPATCH_BLOCKED_RUNTIME_STATES = {
    "auth_expired",
    "cooldown",
    "disabled",
    "leased",
    "quota_exhausted",
    "running",
    "unavailable",
}

SURFACE_TUI = "tui"
SURFACE_HEADLESS = "headless"


def classify_operator_surface(config: Dict[str, Any]) -> str:
    """Classify execution surface without conflating a tmux host with actor identity."""
    surface = config.get("surface") if isinstance(config, dict) else None
    surface_type = str((surface or {}).get("type") or "").strip().lower()
    if surface_type in {"claude_code_interactive", "codex_interactive", "interactive_tui"}:
        return SURFACE_TUI
    physical = config.get("physical") if isinstance(config, dict) else None
    if not surface_type and str((physical or {}).get("backend") or "").lower() == "tmux":
        return SURFACE_TUI
    return SURFACE_HEADLESS


def _load_failure_fingerprint_module():
    for module_name in ("_solar_lib_failure_fingerprint", "failure_fingerprint"):
        loaded = sys.modules.get(module_name)
        if (
            loaded is not None
            and hasattr(loaded, "compute_label_fingerprint_penalty")
            and hasattr(loaded, "adapt_recent_failures_to_evidence")
            and hasattr(loaded, "FingerprintResult")
        ):
            return loaded
    module_path = Path(__file__).with_name("failure_fingerprint.py")
    spec = importlib.util.spec_from_file_location("_solar_lib_failure_fingerprint", module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load failure_fingerprint module from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class SubmitResult:
    """Result of actor_runtime.submit()."""

    def __init__(
        self,
        success: bool,
        lease: Optional[LeaseState] = None,
        inbox_path: Optional[str] = None,
        outbox_path: Optional[str] = None,
        evidence_ledger_path: Optional[str] = None,
        scheduler_decision: Optional[Dict] = None,
        error: Optional[str] = None,
        run_dir: Optional[str] = None,
        artifact_refs: Optional[Dict[str, str]] = None,
        policy_decisions: Optional[List[Dict[str, Any]]] = None,
        # N1 contract fields
        dispatch_path: Optional[str] = None,
        fallback_reason: Optional[str] = None,
        context_packet_id: Optional[str] = None,
        rejected_candidates: Optional[List[Dict[str, str]]] = None,
        score_factors: Optional[Dict[str, float]] = None,
        penalties: Optional[Dict[str, float]] = None,
        selected_host_type: Optional[str] = None,
        gate: Optional[str] = None,
        queued_without_lease: bool = False,
        error_data: Optional[Dict[str, Any]] = None,
    ):
        self.success = success
        self.lease = lease
        self.inbox_path = inbox_path
        self.outbox_path = outbox_path
        self.evidence_ledger_path = evidence_ledger_path
        self.scheduler_decision = scheduler_decision
        self.error = error
        self.run_dir = run_dir
        self.artifact_refs = artifact_refs or {}
        self.policy_decisions = policy_decisions or []
        # N1 contract fields
        self.dispatch_path = dispatch_path
        self.fallback_reason = fallback_reason
        self.context_packet_id = context_packet_id
        self.rejected_candidates = rejected_candidates or []
        self.score_factors = score_factors or {}
        self.penalties = penalties or {}
        self.selected_host_type = selected_host_type
        self.gate = gate
        self.queued_without_lease = queued_without_lease
        self.error_data = error_data or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "lease": self.lease.to_dict() if self.lease else None,
            "inbox_path": self.inbox_path,
            "outbox_path": self.outbox_path,
            "evidence_ledger_path": self.evidence_ledger_path,
            "scheduler_decision": self.scheduler_decision,
            "error": self.error,
            "run_dir": self.run_dir,
            "artifact_refs": self.artifact_refs,
            "policy_decisions": self.policy_decisions,
            # N1 contract fields
            "dispatch_path": self.dispatch_path,
            "fallback_reason": self.fallback_reason,
            "context_packet_id": self.context_packet_id,
            "rejected_candidates": self.rejected_candidates,
            "score_factors": self.score_factors,
            "penalties": self.penalties,
            "selected_host_type": self.selected_host_type,
            "gate": self.gate,
            "queued_without_lease": self.queued_without_lease,
            "error_data": self.error_data,
        }


class ActorRuntime:
    """Main runtime for submitting tasks to actors."""

    def __init__(
        self,
        harness_dir: Optional[Path] = None,
        lease_broker: Optional[LeaseBroker] = None,
        mailbox_base: Optional[Path] = None,
        evidence_ledger: Optional[EvidenceLedger] = None,
        context_store: Optional[ContextStore] = None,
        profiles_path: Optional[Path] = None,
        bindings_path: Optional[Path] = None,
        run_materializer: Optional[RunMaterializer] = None,
    ):
        self.harness_dir = harness_dir or HARNESS_DIR
        self.broker = lease_broker or LeaseBroker(self.harness_dir / "run" / "actor-leases")
        self.mailbox_base = mailbox_base or self.harness_dir / "actors"
        self.ledger = evidence_ledger or EvidenceLedger(self.harness_dir / "run" / "actor-evidence")
        self.ctx_store = context_store or ContextStore()
        self.profiles = load_profiles(profiles_path)
        self.router = LogicalOperatorRouter(bindings_path, actors_path=profiles_path)
        if run_materializer is not None:
            self._materializer = run_materializer
        else:
            ledger_dir = getattr(self.ledger, "ledger_dir", None)
            if harness_dir is None and ledger_dir is not None:
                runs_root = Path(ledger_dir).parent / "runs"
            else:
                runs_root = self.harness_dir / "run" / "runs"
            self._materializer = RunMaterializer(runs_root)

    def _runtime_unavailable_actor_ids(self, logical_operator: str) -> set[str]:
        """Return logical-operator candidates that operator_runtime cannot dispatch now."""
        unavailable: set[str] = set()
        for actor_id in self.router.get_candidates(logical_operator):
            if not actor_id:
                continue
            if self._runtime_state_for_actor(actor_id) in DISPATCH_BLOCKED_RUNTIME_STATES:
                unavailable.add(actor_id)
        return unavailable

    def _runtime_state_for_actor(self, actor_id: str) -> str:
        try:
            import operator_runtime  # type: ignore  # noqa: WPS433
        except Exception:
            return ""
        config_getter = getattr(operator_runtime, "get_operator_config", None)
        if callable(config_getter):
            try:
                if not config_getter(actor_id):
                    return ""
            except Exception:
                return ""
        try:
            return str(operator_runtime.get_operator_runtime_state(actor_id) or "").strip().lower()
        except Exception:
            return ""

    def _physical_plan_runtime_fallback_actor(self, task_envelope: Dict[str, Any]) -> Optional[str]:
        physical_plan = task_envelope.get("physical_plan_ir")
        if not isinstance(physical_plan, dict):
            return None
        for candidate in physical_plan.get("execution_candidates") or []:
            if not isinstance(candidate, dict):
                continue
            actor_id = str(candidate.get("operator_id") or "").strip()
            if not actor_id:
                continue
            profile = str(candidate.get("profile") or "").strip().lower()
            if "advisory" in profile:
                continue
            if self._runtime_state_for_actor(actor_id) in DISPATCH_BLOCKED_RUNTIME_STATES:
                continue
            return actor_id
        return None

    @staticmethod
    def _policy_decision_id(policy_version: str, logical_operator: str, actor_id: str) -> str:
        return f"{policy_version}:{logical_operator or 'direct'}:{actor_id or 'none'}"

    @staticmethod
    def _policy_score_factors(decision: Optional[Dict[str, Any]]) -> Dict[str, float]:
        if not isinstance(decision, dict):
            return {}
        return {
            "RiskFit": float(decision.get("risk_fit", 0.0) or 0.0),
            "CostFit": float(decision.get("cost_fit", 0.0) or 0.0),
            "CapabilityFit": float(decision.get("capability_fit", 0.0) or 0.0),
        }

    @staticmethod
    def _resolve_task_type(task_envelope: Dict[str, Any]) -> str:
        graph_node = task_envelope.get("task_graph_node") if isinstance(task_envelope.get("task_graph_node"), dict) else {}
        return str(
            task_envelope.get("task_type")
            or task_envelope.get("dispatch_task_type")
            or task_envelope.get("type")
            or graph_node.get("dispatch_task_type")
            or graph_node.get("type")
            or ""
        )

    @staticmethod
    def _operator_score_ranking_enabled() -> bool:
        value = str(os.environ.get("SOLAR_OPERATOR_SCORE_RANKING", "1")).strip().lower()
        return value not in {"0", "false", "no", "off"}

    def _rank_eligible_actors(
        self,
        eligible: List[str],
        decisions: Dict[str, Any],
        *,
        task_envelope: Dict[str, Any],
        logical_operator: str,
        task_type: str,
        writer_actor_id: Optional[str],
    ) -> Optional[OperatorScoreResult]:
        """Rank policy-eligible actors by OperatorScore. Returns the winner.

        HistoricalSuccess is drawn from the local task-evidence store so actor
        selection is corrected by Solar's own prior task outcomes rather than a
        neutral prior. Returns None when ranking is disabled or nothing to rank,
        so the caller keeps the policy binding-order fallback.
        """
        if not self._operator_score_ranking_enabled():
            return None
        if not eligible:
            return None

        evidence = self._load_local_task_evidence()
        policy_decisions = [
            decisions[a] for a in eligible
            if isinstance(decisions.get(a), dict)
        ]
        repo = str(task_envelope.get("repo") or "") or None
        provider_by_actor = {
            a: str((decisions.get(a) or {}).get("provider") or "") or None
            for a in eligible
        }

        def _task_fit(actor_id: str) -> float:
            decision = decisions.get(actor_id) or {}
            cap = decision.get("capability_fit")
            return float(cap) if isinstance(cap, (int, float)) else 0.5

        def _historical(actor_id: str) -> float:
            # Prefer the most specific match; progressively relax dimensions so a
            # sparse local history (records lacking repo/operator tags) still
            # contributes actor-level signal instead of collapsing to the neutral
            # prior. success_rate returns 0.5 only when the filter matches nothing.
            filter_sets = [
                dict(repo=repo, task_type=task_type or None,
                     logical_operator=logical_operator or None,
                     provider=provider_by_actor.get(actor_id), actor_id=actor_id),
                dict(task_type=task_type or None, actor_id=actor_id),
                dict(actor_id=actor_id),
            ]
            for filters in filter_sets:
                matched = [r for r in evidence.records if _record_matches(r, filters)]
                if matched:
                    return evidence.success_rate(**filters)
            return 0.5

        def _record_matches(record: Dict[str, Any], filters: Dict[str, Any]) -> bool:
            for key, want in filters.items():
                if want is None:
                    continue
                if record.get(key) != want:
                    return False
            return True

        results = rank_actors(
            eligible,
            task_fit_fn=_task_fit,
            evidence=evidence,
            writer_actor_id=writer_actor_id,
            task_type=task_type or None,
            policy_decisions=policy_decisions or None,
        )
        # rank_actors uses evidence.success_rate(actor_id=...) internally, but the
        # multi-dimensional lookup (repo/task_type/logical_operator/provider) is
        # the richer signal; recompute HistoricalSuccess per candidate and re-rank.
        # factors on the result carry the *weighted* contribution (used for sort);
        # raw_factors carries the un-weighted 0..1 values for the explainable audit.
        if results:
            from operator_score import FACTOR_WEIGHTS as _FW  # local import: sibling module
            for r in results:
                hs = _historical(r.actor_id)
                r.factors["HistoricalSuccess"] = hs * _FW["HistoricalSuccess"]
                r.total_score = sum(r.factors.values()) - sum(r.penalties.values())
                r.raw_factors = {
                    name: (r.factors[name] / _FW[name]) if _FW.get(name) else 0.0
                    for name in _FW
                }
            results.sort(key=lambda r: (-r.total_score, r.actor_id))
            for idx, r in enumerate(results):
                r.selected = idx == 0
            if len(results) > 1:
                results[0].fallback_actor_id = results[1].actor_id
        return results[0] if results else None

    def _load_local_task_evidence(self) -> TaskEvidence:
        """Load local task-outcome evidence for HistoricalSuccess (soft-fail)."""
        try:
            from task_evidence_store import load_task_evidence  # sibling module
        except Exception:
            return TaskEvidence()
        try:
            return load_task_evidence(max_records=5000)
        except Exception:
            return TaskEvidence()

    def _policy_error_data(
        self,
        *,
        logical_operator: str,
        selected_actor: Optional[str],
        rejected_candidates: List[Dict[str, Any]],
        policy_decisions: List[Dict[str, Any]],
        policy_version: str,
        reason: str,
    ) -> Dict[str, Any]:
        return {
            "reason": reason,
            "logical_operator": logical_operator,
            "selected_actor": selected_actor,
            "rejected_candidates": rejected_candidates,
            "policy_decisions": policy_decisions,
            "policy_version": policy_version,
            "policy_decision_id": self._policy_decision_id(policy_version, logical_operator, selected_actor or ""),
        }

    def _direct_actor_policy_gate(
        self,
        actor_id: str,
        logical_operator: str,
        task_envelope: Dict[str, Any],
    ) -> Tuple[bool, List[Dict[str, Any]], List[Dict[str, Any]], str, Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        """Evaluate a directly supplied actor id before runtime lease acquisition."""
        operator_type = logical_operator or str(task_envelope.get("logical_operator") or "")
        profile = self.profiles.get(actor_id) or self.router.get_profile(actor_id)
        if profile is None:
            return True, [], [], "legacy-unprofiled", None, None

        requirements = self.router._build_requirements(operator_type, task_envelope)  # noqa: SLF001 - shared runtime path
        decision = evaluate_actor_policy(profile, requirements).to_dict()
        policy_version = str(decision.get("policy_version") or "unknown")
        if not bool(decision.get("allowed")):
            rejected = [{
                "actor_id": actor_id,
                "reason": ",".join(str(r) for r in decision.get("reasons") or ["policy_denied"]),
            }]
            error_data = self._policy_error_data(
                logical_operator=operator_type,
                selected_actor=actor_id,
                rejected_candidates=rejected,
                policy_decisions=[decision],
                policy_version=policy_version,
                reason="policy_denied",
            )
            return False, rejected, [decision], policy_version, decision, error_data
        return True, [], [decision], policy_version, decision, None

    def _materialize_run_dir(
        self,
        dag_id: str,
        node_id: str,
        actor_id: str,
        task_id: str,
        lease: Any,
        scheduler_decision: Dict[str, Any],
        task_envelope: Dict[str, Any],
    ) -> Tuple[Optional[str], Dict[str, str], Optional[Dict[str, Any]]]:
        """Materialize runs/<dag-id>/ seed. Non-fatal on failure."""
        runs_root = getattr(self._materializer, "runs_root", None)
        try:
            run_dir, artifact_refs = self._materializer.materialize(
                dag_id=dag_id,
                node_id=node_id,
                actor_id=actor_id,
                task_id=task_id,
                lease=lease,
                scheduler_decision=scheduler_decision,
                task_envelope=task_envelope,
            )
            if run_dir is None and runs_root is not None:
                error_data = {
                    "failure_stage": "materialization",
                    "error": "materialization_returned_no_run_dir",
                }
                self._record_run_status(
                    str(Path(runs_root) / dag_id),
                    status="partial",
                    failure_stage=error_data["failure_stage"],
                    error=error_data["error"],
                )
                return run_dir, artifact_refs, error_data
            if run_dir is None:
                return run_dir, artifact_refs, {
                    "failure_stage": "materialization",
                    "error": "materialization_returned_no_run_dir",
                }
            return run_dir, artifact_refs, None
        except Exception as exc:
            error_data = {
                "failure_stage": "materialization",
                "error": f"materialization_failed: {exc}",
            }
            if runs_root is not None:
                self._record_run_status(
                    str(Path(runs_root) / dag_id),
                    status="partial",
                    failure_stage=error_data["failure_stage"],
                    error=error_data["error"],
                )
            return None, {}, error_data

    @staticmethod
    def _utc_now() -> str:
        return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def _record_run_status(
        self,
        run_dir: Optional[str],
        *,
        status: str,
        failure_stage: str,
        error: str,
    ) -> None:
        """Best-effort manifest status update for submit failure paths."""
        if not run_dir:
            return

        manifest_path = Path(run_dir) / "run-manifest.json"
        manifest: Dict[str, Any] = {}
        if manifest_path.exists():
            try:
                loaded = json.loads(manifest_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    manifest = loaded
            except (OSError, json.JSONDecodeError):
                manifest = {}

        now = self._utc_now()
        manifest.setdefault("schema_version", "solar.run_manifest.v1")
        manifest.setdefault("dag_id", Path(run_dir).name)
        manifest.setdefault("sprint_id", Path(run_dir).name)
        manifest.setdefault("created_at", now)
        manifest.setdefault("artifacts", {})
        manifest.setdefault("nodes", {})
        manifest.setdefault("reviews", {})
        manifest.setdefault("scrubbing", {"enabled": True})
        manifest["updated_at"] = now
        manifest["status"] = status
        manifest["failure_stage"] = failure_stage
        manifest["error"] = error
        manifest["repair_hint"] = f"{failure_stage}_failed: {error}"

        try:
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError:
            return

    def _write_failure_ledger_entry(
        self,
        *,
        task_id: str,
        sprint_id: str,
        node_id: str,
        actor_id: str,
        logical_operator: str,
        scheduler_decision: Dict[str, Any],
        failure_stage: str,
        error: str,
        run_dir: Optional[str],
        artifact_refs: Dict[str, str],
        context_packet_id: Optional[str],
        resolved_capsule: Optional[Dict[str, Any]] = None,
        task_envelope: Optional[Dict[str, Any]] = None,
    ) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
        """Best-effort JSONL failure index write after run evidence exists."""
        failure_decision = dict(scheduler_decision)
        failure_decision["status"] = "failed"
        failure_decision["failure_stage"] = failure_stage
        failure_decision["error"] = error
        if artifact_refs:
            failure_decision["artifact_refs"] = artifact_refs

        capsule = resolved_capsule if isinstance(resolved_capsule, dict) else {}
        envelope = task_envelope if isinstance(task_envelope, dict) else {}
        try:
            ledger_path = self.ledger.write_run_entry(
                task_id=task_id,
                sprint_id=sprint_id,
                node_id=node_id,
                actor_id=actor_id,
                logical_operator=logical_operator,
                scheduler_decision=failure_decision,
                context_packet_id=context_packet_id,
                final_report_target=f"run/{sprint_id}/final_report.md",
                capability_capsule_id=capsule.get("capability_capsule_id"),
                capsule_kind=capsule.get("capsule_kind"),
                resolved_bindings=capsule.get("resolved_mcp_bindings"),
                effect_summary=capsule.get("effect_summary"),
                guard_results=capsule.get("attached_guard_capsules"),
                verification_results=capsule.get("verification_hooks"),
                capsule_plan_ir=envelope.get("capsule_plan_ir") if isinstance(envelope.get("capsule_plan_ir"), dict) else None,
                physical_plan_ir=envelope.get("physical_plan_ir") if isinstance(envelope.get("physical_plan_ir"), dict) else None,
                plan_artifacts=envelope.get("plan_artifacts") if isinstance(envelope.get("plan_artifacts"), dict) else None,
                run_dir=run_dir,
                artifact_refs=artifact_refs if artifact_refs else None,
            )
            return ledger_path, None
        except Exception as exc:
            return None, {
                "failure_stage": "jsonl_index",
                "error": str(exc),
                "while_recording": failure_stage,
            }

    def _record_scheduler_decision_status(
        self,
        artifact_refs: Dict[str, str],
        scheduler_decision: Dict[str, Any],
        *,
        status: str,
        failure_stage: str,
        error: str,
    ) -> None:
        """Best-effort update for materialized scheduler decision failure state."""
        sched_path = artifact_refs.get("scheduler_decision")
        if not sched_path:
            return
        payload = dict(scheduler_decision)
        path = Path(sched_path)
        if path.exists():
            try:
                loaded = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    payload = loaded
            except (OSError, json.JSONDecodeError):
                pass
        payload["status"] = status
        payload["failure_stage"] = failure_stage
        payload["error"] = error
        try:
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError:
            return

    def _operator_runtime_bridge_allowed(self) -> bool:
        value = str(os.environ.get("SOLAR_ACTOR_RUNTIME_OPERATOR_BRIDGE", "1")).strip().lower()
        if value in {"0", "false", "no", "off"}:
            return False
        if str(os.environ.get("SOLAR_ACTOR_RUNTIME_OPERATOR_BRIDGE_FORCE", "")).strip().lower() in {"1", "true", "yes", "on"}:
            return True
        try:
            return self.harness_dir.resolve() == HARNESS_DIR.resolve()
        except Exception:
            return False

    def _submit_operator_runtime_bridge(
        self,
        *,
        actor_id: str,
        task_id: str,
        sprint_id: str,
        node_id: str,
        task_envelope: Dict[str, Any],
    ) -> Dict[str, Any]:
        if not self._operator_runtime_bridge_allowed():
            return {"status": "skipped", "reason": "non_production_harness"}

        payload = dict(task_envelope)
        graph_node = payload.get("task_graph_node") if isinstance(payload.get("task_graph_node"), dict) else {}
        payload["task_id"] = str(payload.get("task_id") or task_id)
        payload["sprint_id"] = str(payload.get("sprint_id") or sprint_id)
        payload["node_id"] = str(payload.get("node_id") or node_id)
        payload["operator_id"] = str(payload.get("operator_id") or actor_id)
        payload["task_type"] = str(
            payload.get("task_type")
            or payload.get("dispatch_task_type")
            or payload.get("type")
            or graph_node.get("dispatch_task_type")
            or graph_node.get("type")
            or "tests"
        )
        payload["objective"] = str(
            payload.get("objective")
            or payload.get("goal")
            or graph_node.get("goal")
            or "actor runtime task"
        )
        if not payload.get("dispatch_text") and not payload.get("dispatch_file"):
            payload["dispatch_text"] = self._build_operator_dispatch_text(payload)

        try:
            import operator_runtime  # type: ignore  # noqa: WPS433

            config_getter = getattr(operator_runtime, "get_operator_config", None)
            config = config_getter(actor_id) if callable(config_getter) else {}
            if callable(config_getter) and not config:
                return {
                    "status": "skipped",
                    "reason": "operator_runtime_actor_unregistered",
                    "operator_id": actor_id,
                }
            if self._is_claude_subscription_interactive(config):
                return {
                    "status": "skipped",
                    "reason": "claude_subscription_interactive_mailbox_only",
                    "operator_id": actor_id,
                }

            result = operator_runtime.submit(payload)
        except ValueError as exc:
            return {"status": "failed", "reason": "operator_runtime_unknown_operator", "error": str(exc)}
        except Exception as exc:
            return {"status": "failed", "reason": "operator_runtime_submit_failed", "error": str(exc)}
        return {
            "status": "submitted",
            "operator_id": actor_id,
            "inbox_path": str(result.get("inbox_path") or ""),
            "daemon_pid": str(result.get("daemon_pid") or ""),
            "submit_status": str(result.get("status") or ""),
        }

    @staticmethod
    def _is_claude_subscription_interactive(config: Any) -> bool:
        if not isinstance(config, dict):
            return False
        surface = config.get("surface") if isinstance(config.get("surface"), dict) else {}
        provider = str(config.get("provider") or "").strip().lower()
        backend = str(config.get("backend") or "").strip().lower()
        surface_type = str(surface.get("type") or "").strip().lower()
        launch_cmd_kind = str(config.get("launch_cmd_kind") or "").strip().lower()
        auth_mode = str(config.get("auth_mode") or "").strip().lower()
        key_ref = str(config.get("key_ref") or "").strip().lower()
        billing_surface = str(config.get("billing_surface") or "").strip().lower()
        billing_pool = str(config.get("billing_pool") or "").strip().lower()
        is_claude = provider == "anthropic" or backend == "claude-cli" or surface_type == "claude_code_interactive"
        is_interactive = launch_cmd_kind == "interactive_repl" or surface_type == "claude_code_interactive"
        is_subscription = (
            auth_mode == "subscription"
            or "subscription" in key_ref
            or "subscription_interactive" in billing_surface
            or "subscription_interactive" in billing_pool
        )
        return bool(is_claude and is_interactive and is_subscription)

    @staticmethod
    def _build_operator_dispatch_text(payload: Dict[str, Any]) -> str:
        """Materialize a prompt for operatord backends that require DISPATCH_FILE."""
        node = payload.get("task_graph_node")
        lines = [
            "# Solar Harness Operator Task",
            "",
            f"- task_id: {payload.get('task_id', '')}",
            f"- sprint_id: {payload.get('sprint_id', '')}",
            f"- node_id: {payload.get('node_id', '')}",
            f"- task_type: {payload.get('task_type', '')}",
            "",
            "## Objective",
            str(payload.get("objective") or "Run the assigned Solar Harness task."),
            "",
            "## Instructions",
            "Use the provided envelope and artifacts as evidence. Produce the required task result and do not mark success without evidence.",
        ]
        if isinstance(node, dict) and node:
            lines.extend([
                "",
                "## Task Graph Node",
                "```json",
                json.dumps(node, ensure_ascii=False, indent=2),
                "```",
            ])
        return "\n".join(lines).strip() + "\n"

    def _ensure_execution_plan_metadata(
        self,
        task_envelope: Dict[str, Any],
        *,
        logical_operator: str = "",
        actor_id: str = "",
        sprint_id: str = "",
        node_id: str = "",
    ) -> Dict[str, Any]:
        payload = dict(task_envelope)
        if payload.get("capsule_plan_ir") and payload.get("physical_plan_ir"):
            return payload

        graph_node = payload.get("task_graph_node") if isinstance(payload.get("task_graph_node"), dict) else {}
        node = dict(graph_node or {})
        node.setdefault("id", node_id or str(payload.get("node_id") or ""))
        node.setdefault("goal", str(payload.get("objective") or ""))
        node.setdefault("logical_operator", logical_operator or str(payload.get("logical_operator") or ""))
        node.setdefault("type", str(payload.get("task_type") or ""))
        if payload.get("capability_capsule_id"):
            node.setdefault("capability_native", bool(payload.get("capability_native", True)))
            node.setdefault("capability_capsule_id", str(payload.get("capability_capsule_id")))
        if isinstance(payload.get("capsule_plan"), dict) and payload.get("capsule_plan"):
            node.setdefault("capsule_plan", dict(payload["capsule_plan"]))

        if not node.get("logical_operator"):
            return payload

        try:
            compiled = compile_execution_plan_for_node(
                node,
                request_type=str(payload.get("task_type") or ""),
                prefer_operator=actor_id,
            )
            capsule_plan = compiled.get("capsule_plan") or {}
            physical_plan = compiled.get("physical_plan") or {}
            payload["logical_plan_node"] = compiled.get("logical_plan_node") or {}
            payload["capsule_plan_ir"] = capsule_plan
            payload["physical_plan_ir"] = physical_plan
            if capsule_plan.get("capability_capsule_id") and not payload.get("capability_capsule_id"):
                payload["capability_capsule_id"] = str(capsule_plan["capability_capsule_id"])
            if sprint_id and node_id:
                payload["plan_artifacts"] = materialize_execution_plan_artifacts(
                    sprint_id,
                    node_id,
                    capsule_plan=capsule_plan,
                    physical_plan=physical_plan,
                    base_dir=self.harness_dir / "sprints",
                )
        except Exception:
            return payload
        return payload

    def submit(
        self,
        task_envelope: Dict[str, Any],
        logical_operator: Optional[str] = None,
        actor_id: Optional[str] = None,
        sprint_id: str = "",
        node_id: str = "",
        ttl_sec: int = 2700,
        capability_token: Optional[CapabilityToken] = None,
    ) -> SubmitResult:
        """Submit a task envelope to an actor.

        1. Validate capability token if provided
        2. Resolve actor via logical operator or direct actor_id
        3. Acquire lease
        4. Materialize the auditable runs/<dag-id>/ evidence seed
        5. Write task envelope to mailbox inbox
        6. Write evidence ledger JSONL index
        7. Return lease and evidence paths
        """
        task_id = task_envelope.get("task_id", str(uuid.uuid4()))

        # Validate capability token
        if capability_token:
            validation = capability_token.validate_for_lease()
            if not validation["valid"]:
                return SubmitResult(success=False, error=f"capability_token_invalid: {validation['issues']}")

        # Check safety boundaries
        allowed, safety_err, requires_approval = self.check_safety_boundaries(task_envelope)
        if not allowed:
            return SubmitResult(success=False, error=safety_err)
        if requires_approval and not task_envelope.get("human_approved"):
            return SubmitResult(success=False, error="human_approval_required")

        # Policy requests check (before lease acquisition)
        policy_passed, policy_error, policy_decisions = self._check_policy_requests(
            task_envelope, capability_token
        )
        if not policy_passed:
            return SubmitResult(
                success=False,
                error=policy_error,
                policy_decisions=policy_decisions,
            )

        # Resolve actor and enforce actor-profile policy before any lease/mailbox side effect.
        rejected_candidates: List[Dict[str, Any]] = []
        policy_selection: Dict[str, Any] = {}
        selected_policy_decision: Optional[Dict[str, Any]] = None
        selected_policy_version = ""
        actor_policy_decisions: List[Dict[str, Any]] = []
        operator_score_result: Optional[OperatorScoreResult] = None
        if not actor_id and logical_operator:
            policy_selection = self.router.select_with_policy(
                logical_operator,
                task=task_envelope,
                unavailable=self._runtime_unavailable_actor_ids(logical_operator),
            )
            if not isinstance(policy_selection, dict):
                selector = getattr(self.router, "select_actor_with_trace", None)
                selected = selector(logical_operator) if callable(selector) else None
                if isinstance(selected, tuple):
                    actor_id = selected[0]
                    rejected_candidates = list(selected[1] or []) if len(selected) > 1 else []
                else:
                    selector = getattr(self.router, "select_actor", None)
                    selected = selector(logical_operator) if callable(selector) else None
                    if isinstance(selected, tuple):
                        actor_id = selected[0]
                        rejected_candidates = list(selected[1] or []) if len(selected) > 1 else []
                if not actor_id:
                    return SubmitResult(
                        success=False,
                        error=f"no_available_actor:{logical_operator}",
                        rejected_candidates=rejected_candidates,
                    )
                policy_selection = {}
            rejected_candidates = list(policy_selection.get("rejected_candidates") or [])
            actor_id = actor_id or str(policy_selection.get("selected_actor") or "")
            selected_policy_version = str(policy_selection.get("policy_version") or "")
            decisions = policy_selection.get("decisions") if isinstance(policy_selection.get("decisions"), dict) else {}
            eligible_actors = [str(a) for a in (policy_selection.get("eligible") or [])]

            # OperatorScore main ranking: reorder policy-eligible candidates by the
            # full 7-factor score (HistoricalSuccess drawn from local task evidence),
            # rather than trusting binding order. Policy gating above already filtered
            # to allowed candidates; ranking only reorders within that allowed set.
            operator_score_result = self._rank_eligible_actors(
                eligible_actors,
                decisions,
                task_envelope=task_envelope,
                logical_operator=logical_operator,
                task_type=self._resolve_task_type(task_envelope),
                writer_actor_id=str(task_envelope.get("writer_actor_id") or "") or None,
            )
            if operator_score_result is not None and operator_score_result.actor_id in eligible_actors:
                ranked_actor = operator_score_result.actor_id
                if ranked_actor != actor_id:
                    # Demote the former binding-order pick into the rejected trail
                    # so the decision stays explainable.
                    rejected_candidates.append({
                        "actor_id": actor_id,
                        "reason": "operator_score_lower_rank",
                    })
                    actor_id = ranked_actor

            selected_policy_decision = decisions.get(actor_id) if actor_id else None
            actor_policy_decisions = [d for d in decisions.values() if isinstance(d, dict)]
            if not actor_id:
                error_data = self._policy_error_data(
                    logical_operator=logical_operator,
                    selected_actor=None,
                    rejected_candidates=rejected_candidates,
                    policy_decisions=actor_policy_decisions,
                    policy_version=selected_policy_version or "unknown",
                    reason="no_eligible_actor",
                )
                return SubmitResult(
                    success=False,
                    error=f"policy_denied:no_eligible_actor:{logical_operator}",
                    scheduler_decision=error_data,
                    policy_decisions=actor_policy_decisions,
                    rejected_candidates=rejected_candidates,
                    score_factors={},
                    error_data=error_data,
                )
        elif not actor_id:
            return SubmitResult(success=False, error="no_actor_id_or_logical_operator")
        else:
            gate_ok, rejected, direct_decisions, selected_policy_version, selected_policy_decision, error_data = self._direct_actor_policy_gate(
                actor_id,
                logical_operator or str(task_envelope.get("logical_operator") or ""),
                task_envelope,
            )
            actor_policy_decisions = direct_decisions
            if rejected:
                rejected_candidates.extend(rejected)
            if not gate_ok:
                return SubmitResult(
                    success=False,
                    error=f"policy_denied:{error_data.get('reason')}:{actor_id}" if error_data else f"policy_denied:{actor_id}",
                    scheduler_decision=error_data,
                    policy_decisions=direct_decisions,
                    rejected_candidates=rejected_candidates,
                    score_factors=self._policy_score_factors(selected_policy_decision),
                    error_data=error_data,
                )

        runtime_state = self._runtime_state_for_actor(actor_id)
        if runtime_state in DISPATCH_BLOCKED_RUNTIME_STATES:
            error_data = self._policy_error_data(
                logical_operator=logical_operator or str(task_envelope.get("logical_operator") or ""),
                selected_actor=actor_id,
                rejected_candidates=[
                    {
                        "actor_id": actor_id,
                        "reason": "runtime_state_blocked",
                        "runtime_state": runtime_state,
                    }
                ],
                policy_decisions=actor_policy_decisions,
                policy_version=selected_policy_version or "unknown",
                reason="runtime_state_blocked",
            )
            return SubmitResult(
                success=False,
                error=f"actor_runtime_unavailable:{runtime_state}:{actor_id}",
                scheduler_decision=error_data,
                policy_decisions=actor_policy_decisions,
                rejected_candidates=[
                    {
                        "actor_id": actor_id,
                        "reason": "runtime_state_blocked",
                        "runtime_state": runtime_state,
                    }
                ],
                score_factors=self._policy_score_factors(selected_policy_decision),
                error_data=error_data,
            )

        task_envelope = self._ensure_execution_plan_metadata(
            task_envelope,
            logical_operator=logical_operator or str(task_envelope.get("logical_operator") or ""),
            actor_id=actor_id,
            sprint_id=sprint_id,
            node_id=node_id,
        )

        # Resolve task_type for fingerprinting
        task_type = self._resolve_task_type(task_envelope)

        # Retrieve failure fingerprint evidence
        evidence_events = task_envelope.get("failure_fingerprint_evidence")
        if evidence_events is None and "recent_failures" in task_envelope:
            failure_fingerprint = _load_failure_fingerprint_module()
            evidence_events = failure_fingerprint.adapt_recent_failures_to_evidence(task_envelope["recent_failures"])

        failure_profile = None
        if "failure_fingerprint_profiles" in task_envelope:
            profiles_dict = task_envelope["failure_fingerprint_profiles"] or {}
            failure_profile = profiles_dict.get(actor_id)

        # Check if pre-computed penalty exists
        pre_computed_penalty = None
        if "failure_fingerprint_penalties" in task_envelope:
            penalties_dict = task_envelope["failure_fingerprint_penalties"] or {}
            pre_computed_penalty = penalties_dict.get(actor_id)

        failure_fingerprint = _load_failure_fingerprint_module()
        compute_label_fingerprint_penalty = failure_fingerprint.compute_label_fingerprint_penalty
        FingerprintResult = failure_fingerprint.FingerprintResult
        if pre_computed_penalty is not None:
            if isinstance(pre_computed_penalty, dict):
                penalty_val = float(pre_computed_penalty.get("penalty", 0.0) or 0.0)
                matched_labels = list(pre_computed_penalty.get("matched_labels") or [])
                evidence_refs = list(pre_computed_penalty.get("evidence_refs") or [])
                label_penalties = list(pre_computed_penalty.get("label_penalties") or [])
                ignored_events = list(pre_computed_penalty.get("ignored_events") or [])
                explanation = str(pre_computed_penalty.get("explanation") or "pre-computed penalty from task envelope")
            elif isinstance(pre_computed_penalty, (int, float)):
                penalty_val = float(pre_computed_penalty)
                matched_labels = []
                evidence_refs = []
                label_penalties = []
                ignored_events = []
                explanation = "pre-computed penalty from task envelope"
            else:
                penalty_val = float(getattr(pre_computed_penalty, "penalty", 0.0) or 0.0)
                matched_labels = list(getattr(pre_computed_penalty, "matched_labels", []) or [])
                evidence_refs = list(getattr(pre_computed_penalty, "evidence_refs", []) or [])
                label_penalties = list(getattr(pre_computed_penalty, "label_penalties", []) or [])
                ignored_events = list(getattr(pre_computed_penalty, "ignored_events", []) or [])
                explanation = str(getattr(pre_computed_penalty, "explanation", "") or "pre-computed penalty from task envelope")

            fp_res = FingerprintResult(
                fingerprint_type=task_type or "unknown",
                penalty=max(0.0, penalty_val),
                explanation=explanation,
                actor_id=actor_id,
                matched_labels=matched_labels,
                label_penalties=label_penalties,
                evidence_refs=evidence_refs,
                ignored_events=ignored_events,
            )
        elif task_type:
            fp_res = compute_label_fingerprint_penalty(
                actor_id=actor_id,
                task_type=task_type,
                evidence_events=evidence_events,
                profile=failure_profile
            )
        else:
            fp_res = FingerprintResult(
                fingerprint_type="",
                penalty=0.0,
                explanation="no fingerprint match",
                actor_id=actor_id,
            )

        penalties = {}
        if fp_res.penalty > 0.0:
            penalties["FailureFingerprintPenalty"] = fp_res.penalty

        evidence_path = f"actors/{actor_id}/evidence/{task_id}"
        # Prefer the full 7-factor OperatorScore breakdown when ranking selected
        # this actor; fall back to the 3-field policy factors otherwise so the
        # scheduler_decision is never an empty shell.
        if operator_score_result is not None and operator_score_result.actor_id == actor_id:
            raw = getattr(operator_score_result, "raw_factors", None)
            score_factors = dict(raw) if isinstance(raw, dict) else dict(operator_score_result.factors)
            score_factors["CapabilityFit"] = float((selected_policy_decision or {}).get("capability_fit", 0.0) or 0.0)
            for name, val in operator_score_result.penalties.items():
                penalties.setdefault(name, val)
        else:
            score_factors = self._policy_score_factors(selected_policy_decision)
        policy_decision_id = self._policy_decision_id(
            selected_policy_version or "unknown",
            logical_operator or str(task_envelope.get("logical_operator") or ""),
            actor_id,
        )

        # Verification gate: critical tasks must pass before any runtime side
        # effects. A blocked task must not acquire a lease or leave mailbox
        # residue, otherwise future dispatches see a false busy actor.
        if self._is_critical_task(task_envelope) and not self._is_verifier_task(task_envelope):
            gate_error = self._check_verification_gate(task_envelope, actor_id)
            if gate_error:
                return SubmitResult(success=False, error=gate_error)

        # Context policy gate: mandatory tasks require valid context packet before
        # any lease/mailbox/operator bridge side effects. Missing, unresolved,
        # corrupt, expired, stale, or wrong-type packets fail closed here.
        context_gate_ok, context_error = self._check_context_policy_gate(task_envelope)
        if not context_gate_ok:
            return SubmitResult(success=False, error=context_error)

        # Acquire lease
        lease = self.broker.acquire(
            actor_id=actor_id,
            task_id=task_id,
            sprint_id=sprint_id,
            node_id=node_id,
            ttl_sec=ttl_sec,
            evidence_path=evidence_path,
        )
        if not lease:
            mailbox = ActorMailbox(actor_id, self.mailbox_base)
            try:
                inbox_path = mailbox.submit_task(task_envelope)
            except Exception as exc:
                return SubmitResult(success=False, error=f"mailbox_queue_failed:{exc}")
            return SubmitResult(
                success=True,
                lease=None,
                inbox_path=inbox_path,
                outbox_path=str(mailbox.outbox),
                scheduler_decision={
                    "selected_actor": actor_id,
                    "dag_id": sprint_id,
                    "node_id": node_id,
                    "dispatch_path": "actor_mailbox_queue",
                    "fallback_reason": "actor_lease_active_queued",
                },
                fallback_reason="actor_lease_active_queued",
                selected_host_type=actor_id,
                queued_without_lease=True,
            )

        # Build a preliminary scheduler decision for materialization seed
        # (will be rebuilt after mailbox write with same fields). A failure
        # here must not leave a false busy lease behind.
        try:
            pre_sched = build_scheduler_decision(
                selected_actor=actor_id,
                logical_operator=logical_operator or "",
                score_factors=score_factors,
                penalties=penalties,
                rejected=rejected_candidates,
                dag_id=sprint_id,
                node_id=node_id,
                # N1 contract fields
                dispatch_path="actor_runtime",
                fallback_reason=None,
                selected_host_type=actor_id,
                gate=task_envelope.get("gate"),
                # S03 fingerprint fields
                failure_fingerprint_penalty=fp_res.penalty,
                matched_labels=fp_res.matched_labels,
                evidence_refs=fp_res.evidence_refs,
                failure_fingerprint_detail=fp_res.to_dict(),
                policy_decision_id=policy_decision_id,
                policy_version=selected_policy_version or "unknown",
                policy_decisions=actor_policy_decisions,
                policy_requirements=policy_selection.get("requirements") if policy_selection else None,
            )
        except Exception as exc:
            try:
                self.broker.transition(actor_id, READY)
            except Exception:
                pass
            return SubmitResult(
                success=False,
                lease=lease,
                error=f"scheduler_decision_failed: {exc}",
                policy_decisions=policy_decisions,
            )

        # Materialize runs/<dag-id>/ evidence seed (after lease, before mailbox)
        dag_id = sprint_id
        run_dir, artifact_refs, materialization_error_data = self._materialize_run_dir(
            dag_id=dag_id,
            node_id=node_id,
            actor_id=actor_id,
            task_id=task_id,
            lease=lease,
            scheduler_decision=pre_sched,
            task_envelope=task_envelope,
        )
        if materialization_error_data is not None:
            pre_sched["status"] = "partial"
            pre_sched["failure_stage"] = materialization_error_data["failure_stage"]
            pre_sched["error"] = materialization_error_data["error"]

        # Write to mailbox
        mailbox = ActorMailbox(actor_id, self.mailbox_base)
        # Load context packet if referenced
        ctx_ref = task_envelope.get("context_packet_ref")
        if ctx_ref:
            ctx_data = self.ctx_store.resolve_ref(ctx_ref)
            if ctx_data:
                task_envelope["context_packet"] = ctx_data
        context_packet_id = ctx_ref.get("packet_id") if isinstance(ctx_ref, dict) else None

        try:
            inbox_path = mailbox.submit_task(task_envelope)
        except Exception as exc:
            mailbox_error = str(exc)
            self._record_run_status(
                run_dir,
                status="failed",
                failure_stage="mailbox_write",
                error=mailbox_error,
            )
            self._record_scheduler_decision_status(
                artifact_refs,
                pre_sched,
                status="failed",
                failure_stage="mailbox_write",
                error=mailbox_error,
            )
            ledger_path, ledger_error = self._write_failure_ledger_entry(
                task_id=task_id,
                sprint_id=sprint_id,
                node_id=node_id,
                actor_id=actor_id,
                logical_operator=logical_operator or "",
                scheduler_decision=pre_sched,
                failure_stage="mailbox_write",
                error=mailbox_error,
                run_dir=run_dir,
                artifact_refs=artifact_refs,
                context_packet_id=context_packet_id,
                task_envelope=task_envelope,
            )
            try:
                self.broker.transition(actor_id, READY)
            except Exception:
                pass
            error_data = {
                "failure_stage": "mailbox_write",
                "error": mailbox_error,
            }
            if ledger_error is not None:
                error_data["ledger_error"] = ledger_error
            return SubmitResult(
                success=False,
                lease=lease,
                evidence_ledger_path=ledger_path,
                error=f"mailbox_submit_failed: {exc}",
                run_dir=run_dir,
                artifact_refs=artifact_refs,
                scheduler_decision=pre_sched,
                policy_decisions=policy_decisions,
                error_data=error_data,
            )
        outbox_dir = str(mailbox.outbox)

        operator_bridge = self._submit_operator_runtime_bridge(
            actor_id=actor_id,
            task_id=task_id,
            sprint_id=sprint_id,
            node_id=node_id,
            task_envelope=task_envelope,
        )
        if operator_bridge.get("status") == "failed":
            self._record_run_status(
                run_dir,
                status="failed",
                failure_stage="operator_runtime_bridge",
                error=f"{operator_bridge.get('reason')}: {operator_bridge.get('error')}",
            )
            try:
                Path(inbox_path).unlink(missing_ok=True)
            except Exception:
                pass
            try:
                self.broker.transition(actor_id, READY)
            except Exception:
                pass
            return SubmitResult(
                success=False,
                error=f"operator_runtime_bridge_failed: {operator_bridge.get('reason')}: {operator_bridge.get('error')}",
                lease=lease,
                run_dir=run_dir,
                artifact_refs=artifact_refs,
                policy_decisions=policy_decisions,
            )
        if operator_bridge.get("status") == "submitted":
            mailbox.write_heartbeat("submitted", {"operator_runtime_bridge": operator_bridge})
            artifact_refs["operator_runtime_inbox"] = str(operator_bridge.get("inbox_path") or "")
            artifact_refs["operator_runtime_daemon_pid"] = str(operator_bridge.get("daemon_pid") or "")
        elif operator_bridge.get("status") == "skipped":
            mailbox.write_heartbeat("submitted", {"operator_runtime_bridge": operator_bridge})

        # Build scheduler decision (with S03 extended fields)
        try:
            sched_decision = build_scheduler_decision(
                selected_actor=actor_id,
                logical_operator=logical_operator or "",
                score_factors=score_factors,
                penalties=penalties,
                rejected=rejected_candidates,
                dag_id=sprint_id,
                node_id=node_id,
                # N1 contract fields
                dispatch_path="actor_runtime",
                fallback_reason=None,
                selected_host_type=actor_id,
                gate=task_envelope.get("gate"),
                # S03 fingerprint fields
                failure_fingerprint_penalty=fp_res.penalty,
                matched_labels=fp_res.matched_labels,
                evidence_refs=fp_res.evidence_refs,
                failure_fingerprint_detail=fp_res.to_dict(),
                artifact_refs=artifact_refs if artifact_refs else None,
                policy_decision_id=policy_decision_id,
                policy_version=selected_policy_version or "unknown",
                policy_decisions=actor_policy_decisions,
                policy_requirements=policy_selection.get("requirements") if policy_selection else None,
            )
            if materialization_error_data is not None:
                sched_decision["status"] = "partial"
                sched_decision["failure_stage"] = materialization_error_data["failure_stage"]
                sched_decision["error"] = materialization_error_data["error"]
        except Exception as exc:
            self._record_run_status(
                run_dir,
                status="failed",
                failure_stage="scheduler_decision",
                error=str(exc),
            )
            try:
                Path(inbox_path).unlink(missing_ok=True)
            except Exception:
                pass
            try:
                self.broker.transition(actor_id, READY)
            except Exception:
                pass
            return SubmitResult(
                success=False,
                lease=lease,
                error=f"scheduler_decision_failed: {exc}",
                run_dir=run_dir,
                artifact_refs=artifact_refs,
                policy_decisions=policy_decisions,
            )

        resolved_capsule = task_envelope.get("resolved_capability_capsule") or {}
        if not isinstance(resolved_capsule, dict):
            resolved_capsule = {}

        # Write evidence ledger (with S03 run_dir / artifact_refs if materialized)
        try:
            ledger_path = self.ledger.write_run_entry(
                task_id=task_id,
                sprint_id=sprint_id,
                node_id=node_id,
                actor_id=actor_id,
                logical_operator=logical_operator or "",
                scheduler_decision=sched_decision,
                context_packet_id=context_packet_id,
                final_report_target=f"run/{sprint_id}/final_report.md",
                capability_capsule_id=resolved_capsule.get("capability_capsule_id"),
                capsule_kind=resolved_capsule.get("capsule_kind"),
                resolved_bindings=resolved_capsule.get("resolved_mcp_bindings"),
                effect_summary=resolved_capsule.get("effect_summary"),
                guard_results=resolved_capsule.get("attached_guard_capsules"),
                verification_results=resolved_capsule.get("verification_hooks"),
                capsule_plan_ir=task_envelope.get("capsule_plan_ir") if isinstance(task_envelope.get("capsule_plan_ir"), dict) else None,
                physical_plan_ir=task_envelope.get("physical_plan_ir") if isinstance(task_envelope.get("physical_plan_ir"), dict) else None,
                plan_artifacts=task_envelope.get("plan_artifacts") if isinstance(task_envelope.get("plan_artifacts"), dict) else None,
                run_dir=run_dir,
                artifact_refs=artifact_refs if artifact_refs else None,
            )
        except Exception as exc:
            jsonl_error = str(exc)
            self._record_run_status(
                run_dir,
                status="partial",
                failure_stage="jsonl_index",
                error=jsonl_error,
            )
            sched_decision["status"] = "partial"
            sched_decision["failure_stage"] = "jsonl_index"
            sched_decision["error"] = jsonl_error
            self._record_scheduler_decision_status(
                artifact_refs,
                sched_decision,
                status="partial",
                failure_stage="jsonl_index",
                error=jsonl_error,
            )
            try:
                Path(inbox_path).unlink(missing_ok=True)
            except Exception:
                pass
            try:
                self.broker.transition(actor_id, READY, reason="evidence_ledger_failed")
            except Exception:
                pass
            raise

        result_error_data: Optional[Dict[str, Any]] = None
        if materialization_error_data is not None:
            result_error_data = {"warning": materialization_error_data}

        return SubmitResult(
            success=True,
            lease=lease,
            inbox_path=inbox_path,
            outbox_path=outbox_dir,
            evidence_ledger_path=ledger_path,
            scheduler_decision=sched_decision,
            run_dir=run_dir,
            artifact_refs=artifact_refs,
            policy_decisions=policy_decisions,
            # N1 contract fields
            dispatch_path="actor_runtime",
            fallback_reason=None,
            context_packet_id=context_packet_id,
            rejected_candidates=rejected_candidates,
            score_factors=score_factors,
            penalties=penalties,
            selected_host_type=actor_id,
            gate=task_envelope.get("gate"),
            error_data=result_error_data,
        )

    def _is_critical_task(self, task_envelope: Dict[str, Any]) -> bool:
        """Determine if a task is critical based on task_graph node fields.

        Reads explicit node fields (gate, risk) — not inferred ad hoc.
        Non-critical tasks return False (fail-open to legacy path).
        """
        graph_node = task_envelope.get("task_graph_node")
        if not isinstance(graph_node, dict):
            return False

        # Critical if gate is a verification gate or risk is high
        gate = str(graph_node.get("gate", "")).upper()
        risk = str(graph_node.get("risk", "")).lower()
        node_type = str(graph_node.get("type", "")).lower()

        if risk == "high":
            return True
        # Code/implementation/review nodes with non-trivial gates are critical
        if gate.startswith("G_") and node_type in ("implementation", "review"):
            return True
        # approval_gate explicitly set
        if graph_node.get("approval_gate"):
            return True
        return False

    def _is_verifier_task(self, task_envelope: Dict[str, Any]) -> bool:
        """Return True when this task is the verifier that will produce a decision."""
        graph_node = task_envelope.get("task_graph_node")
        if not isinstance(graph_node, dict):
            graph_node = {}
        logical_operator = str(
            task_envelope.get("logical_operator")
            or graph_node.get("logical_operator")
            or ""
        ).lower()
        task_type = str(
            task_envelope.get("task_type")
            or task_envelope.get("dispatch_task_type")
            or graph_node.get("dispatch_task_type")
            or graph_node.get("type")
            or ""
        ).lower()
        gate = str(graph_node.get("gate") or "").upper()
        return (
            logical_operator in {"verifier", "critic"}
            or task_type in {"verification", "review"}
            or (gate == "G_REVIEW" and task_type == "review")
        )

    def _check_verification_gate(
        self,
        task_envelope: Dict[str, Any],
        actor_id: str,
    ) -> Optional[str]:
        """Run VerificationGate checks for critical tasks.

        Returns None if gate passes, or an error string if blocked.
        """
        graph_node = task_envelope.get("task_graph_node", {})
        if not isinstance(graph_node, dict):
            graph_node = {}

        is_code = graph_node.get("type", "") in ("implementation", "code")
        high_risk = str(graph_node.get("risk", "")).lower() == "high"
        available_providers = ["claude", "gemini", "glm", "deepseek", "antigravity"]

        vg = VerificationGate()

        # Gather evidence flags from the task envelope
        has_patch = bool(task_envelope.get("has_patch") or task_envelope.get("patch_artifact"))
        has_test = bool(
            task_envelope.get("has_test_evidence")
            or task_envelope.get("test_log")
            or task_envelope.get("test_artifact")
        )
        verifier_decision = task_envelope.get("verifier_decision")
        verifier_actor_id = task_envelope.get("verifier_actor_id")
        writer_actor_id = actor_id

        if is_code:
            gate_result = vg.check_code_task(
                has_patch=has_patch,
                has_test_evidence=has_test,
                writer_actor_id=writer_actor_id,
                verifier_actor_id=verifier_actor_id,
                verifier_decision=verifier_decision,
            )
        else:
            gate_result = vg.check_dag_done(
                has_patch=has_patch,
                has_test_or_benchmark=has_test,
                verifier_decision=verifier_decision,
                verifier_actor_id=verifier_actor_id,
                writer_actor_id=writer_actor_id,
                high_risk=high_risk,
                available_providers=available_providers,
            )

        if not gate_result["passed"]:
            return f"verification_gate_blocked: {gate_result['reasons']}"
        return None

    def _check_context_policy_gate(
        self,
        task_envelope: Dict[str, Any],
    ) -> Tuple[bool, str]:
        """Enforce context policy: mandatory tasks require valid context packet.

        Returns (ok, None) if gate passes, or (False, error_message) if blocked.
        Error message always starts with 'context_policy_violation:'.

        Context policy levels (from an explicit context_policy field):
        - 'critical' or 'standard': require valid context packet
        - 'not_required': exempt, no context required
        - 'advisory': warn but never block (read-only, no pane memory)
        - Unknown: treated as standard; missing: legacy-compatible not_required
        """
        # Determine context policy
        graph_node = task_envelope.get("task_graph_node", {})
        if not isinstance(graph_node, dict):
            graph_node = {}
        context_policy = str(
            task_envelope.get("context_policy")
            or graph_node.get("context_policy")
            or "not_required"
        ).strip().lower()

        # Advisory and not_required tasks are exempt
        if context_policy == "not_required":
            return True, ""
        if context_policy == "advisory":
            # Advisory tasks never read pane/screen memory, just warn
            # No blocking here; advisory is informational only
            return True, ""

        # Resolve context packet
        context_ref = task_envelope.get("context_packet_ref")
        inline_context = task_envelope.get("context_packet")
        resolution = None

        if context_ref:
            if isinstance(context_ref, dict):
                resolution = self.ctx_store.resolve_ref_detail(context_ref)
            else:
                resolution = self.ctx_store.resolve_ref_detail(
                    {"packet_id": str(context_ref)} if context_ref else None
                )
        elif inline_context:
            if isinstance(inline_context, dict):
                # Inline context is considered valid if it has required fields
                packet_type = inline_context.get("packet_type", "inline")
                expires_at = inline_context.get("expires_at")
                has_data = bool(inline_context.get("data") or inline_context.get("content"))
                if not has_data:
                    return False, "context_policy_violation:inline_context_empty"
                # Check expiration for inline context
                if expires_at:
                    parsed = self.ctx_store._parse_time(expires_at)
                    if parsed and parsed <= datetime.datetime.now(datetime.timezone.utc):
                        return False, f"context_policy_violation:inline_context_expired:{expires_at}"
                # Inline context is valid
                return True, ""
            else:
                return False, "context_policy_violation:inline_context_wrong_type"

        # No context provided
        if not context_ref and not inline_context:
            return False, "context_policy_violation:no_context_provided"

        # Check resolution result
        if resolution is None:
            return False, "context_policy_violation:resolution_failed"

        if resolution.status == "resolved":
            return True, ""

        # Map resolution status to error message
        if resolution.status == "missing":
            reason = resolution.failure_reason or "missing"
            if reason == "none_ref":
                return False, "context_policy_violation:empty_ref"
            if reason == "missing_packet":
                return False, f"context_policy_violation:missing_packet:{resolution.packet_id}"
            if reason == "path_missing":
                return False, f"context_policy_violation:path_missing:{resolution.path}"
            return False, f"context_policy_violation:missing:{reason}"

        if resolution.status == "corrupt":
            return False, f"context_policy_violation:corrupt:{resolution.failure_reason}"

        if resolution.status == "wrong_type":
            expected = task_envelope.get("expected_packet_type")
            return False, f"context_policy_violation:wrong_type:{resolution.packet_type}_expected:{expected}"

        if resolution.status == "expired":
            return False, f"context_policy_violation:expired:{resolution.expires_at}"

        if resolution.status == "stale":
            return False, f"context_policy_violation:stale:{resolution.packet_id}"

        return False, f"context_policy_violation:{resolution.status}:{resolution.failure_reason}"

    def check_safety_boundaries(
        self,
        task_envelope: Dict[str, Any],
    ) -> Tuple[bool, Optional[str], bool]:
        """Check task compliance with security boundaries.

        Returns (allowed, error_message, requires_human_approval).
        """
        objective = str(task_envelope.get("objective", "")).lower()
        action_type = str(task_envelope.get("action_type", "")).lower()

        forbidden_types = {
            "payment_action",
            "credential_capture",
            "cookie_export_without_approval",
            "bot_detection_bypass",
            "unauthorized_scraping",
            "cookie heist",
        }
        requires_approval_types = {
            "login",
            "external_write",
            "form_submit",
            "account_action",
        }

        # Check explicit action type
        if action_type in forbidden_types:
            return False, f"security_violation: action_type '{action_type}' is forbidden", False
        if action_type in requires_approval_types:
            return True, None, True

        # Check text content of objective
        forbidden_keywords = {
            "payment": "payment_action",
            "cookie heist": "cookie_export_without_approval",
            "export cookies": "cookie_export_without_approval",
            "bot bypass": "bot_detection_bypass",
            "bypass bot": "bot_detection_bypass",
            "credential capture": "credential_capture",
            "unauthorized scraping": "unauthorized_scraping",
        }

        for kw, classification in forbidden_keywords.items():
            if kw in objective:
                return False, f"security_violation: task objective contains keyword associated with forbidden action '{classification}'", False

        approval_keywords = ["login", "submit form", "account action", "external write", "form_submit"]
        for kw in approval_keywords:
            if kw in objective:
                return True, None, True

        return True, None, False

    def _check_policy_requests(
        self,
        task_envelope: Dict[str, Any],
        capability_token: Optional[CapabilityToken],
    ) -> Tuple[bool, Optional[str], List[Dict[str, Any]]]:
        """Check policy_requests against CapabilityToken PolicyEngine.

        Returns (passed, error_message, policy_decisions).
        """
        policy_requests = task_envelope.get("policy_requests") or []
        if not policy_requests:
            return True, None, []

        enforcement = os.environ.get("SOLAR_CAPABILITY_ENFORCEMENT", "on").strip().lower()
        audit_only = os.environ.get("SOLAR_CAPABILITY_AUDIT_ONLY", "").strip() in ("1", "true", "yes")

        if capability_token is None:
            if enforcement == "off":
                return True, None, []
            return True, None, []

        decisions: List[Dict[str, Any]] = []
        for req in policy_requests:
            kind = str(req.get("kind", "")).strip()
            decision = self._dispatch_policy_check(capability_token, kind, req)
            decisions.append({
                "kind": kind,
                "allowed": decision.allowed,
                "reason": decision.reason,
                "rule": decision.rule,
                "audit": decision.audit,
            })
            if not decision.allowed:
                if enforcement == "off":
                    decisions[-1]["bypass"] = "enforcement_off"
                    continue
                if audit_only:
                    decisions[-1]["bypass"] = "audit_only"
                    continue
                return False, f"capability_denied:{decision.reason}", decisions

        return True, None, decisions

    @staticmethod
    def _dispatch_policy_check(
        token: CapabilityToken,
        kind: str,
        req: Dict[str, Any],
    ) -> PolicyDecision:
        if kind == "file":
            return token.check_file(
                op=str(req.get("op", "read")),
                path=str(req.get("path", "")),
            )
        if kind == "shell":
            return token.check_shell(
                command=str(req.get("command", "")),
                argv=req.get("argv") or [],
            )
        if kind == "network":
            return token.check_network(
                mode=str(req.get("mode", "http")),
                host=str(req.get("host", "")),
                port=req.get("port"),
            )
        if kind == "git":
            return token.check_git(
                op=str(req.get("op", "push")),
                remote=req.get("remote"),
            )
        if kind == "secrets":
            return token.check_secrets(
                ref=str(req.get("ref", "")),
            )
        return PolicyDecision(
            allowed=False,
            reason="unknown_policy_kind",
            detail=f"kind={kind}",
        )
