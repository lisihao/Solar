"""actor_runtime.py — Main submit protocol for AgentActor runtime.

Grants lease, writes task_envelope to mailbox inbox,
writes evidence ledger, loads context packet, returns lease/result paths.
No direct tmux scheduler calls.
"""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from actor_lease import LeaseBroker, LeaseState, READY, LEASED, RUNNING, FINALIZING
from actor_mailbox import ActorMailbox
from actor_profiles import ActorProfile, load_profiles
from logical_operator_router import LogicalOperatorRouter
from operator_score import OperatorScoreResult, rank_actors, TaskEvidence
from evidence_ledger import EvidenceLedger, RunMaterializer, NoopMaterializer, build_scheduler_decision
from context_store import ContextStore
from capability_token import CapabilityToken, PolicyDecision
from verification_gate import VerificationGate
from apo_plan_compiler import compile_execution_plan_for_node, materialize_execution_plan_artifacts

HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))


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
        self.router = LogicalOperatorRouter(bindings_path)
        if run_materializer is not None:
            self._materializer = run_materializer
        else:
            runs_root = self.harness_dir / "run" / "runs"
            self._materializer = RunMaterializer(runs_root)

    def _runtime_unavailable_actor_ids(self, logical_operator: str) -> set[str]:
        """Return logical-operator candidates that operator_runtime cannot dispatch now."""
        try:
            import operator_runtime  # type: ignore  # noqa: WPS433
        except Exception:
            return set()
        unavailable_states = {
            "auth_expired",
            "cooldown",
            "disabled",
            "leased",
            "quota_exhausted",
            "running",
            "unavailable",
        }
        unavailable: set[str] = set()
        for actor_id in self.router.get_candidates(logical_operator):
            if not actor_id:
                continue
            try:
                state = str(operator_runtime.get_operator_runtime_state(actor_id) or "").strip().lower()
            except Exception:
                continue
            if state in unavailable_states:
                unavailable.add(actor_id)
        return unavailable

    def _runtime_state_for_actor(self, actor_id: str) -> str:
        try:
            import operator_runtime  # type: ignore  # noqa: WPS433
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
        unavailable_states = {
            "auth_expired",
            "cooldown",
            "disabled",
            "leased",
            "quota_exhausted",
            "running",
            "unavailable",
        }
        for candidate in physical_plan.get("execution_candidates") or []:
            if not isinstance(candidate, dict):
                continue
            actor_id = str(candidate.get("operator_id") or "").strip()
            if not actor_id:
                continue
            profile = str(candidate.get("profile") or "").strip().lower()
            if "advisory" in profile:
                continue
            if self._runtime_state_for_actor(actor_id) in unavailable_states:
                continue
            return actor_id
        return None

    def _materialize_run_dir(
        self,
        dag_id: str,
        node_id: str,
        actor_id: str,
        task_id: str,
        lease: Any,
        scheduler_decision: Dict[str, Any],
        task_envelope: Dict[str, Any],
    ) -> Tuple[Optional[str], Dict[str, str]]:
        """Materialize runs/<dag-id>/ seed. Non-fatal on failure."""
        try:
            return self._materializer.materialize(
                dag_id=dag_id,
                node_id=node_id,
                actor_id=actor_id,
                task_id=task_id,
                lease=lease,
                scheduler_decision=scheduler_decision,
                task_envelope=task_envelope,
            )
        except Exception:
            return None, {}

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
        4. Write task envelope to mailbox inbox
        5. Write evidence ledger
        6. Return lease and paths
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

        # Resolve actor
        if not actor_id and logical_operator:
            is_browser_op = (
                logical_operator in ("DeepResearchBrowser", "WebwrightPlaywright", "BrowserUseMcp") or
                task_envelope.get("requires_replayable_evidence") or
                task_envelope.get("is_long_horizon_web_task") or
                task_envelope.get("is_localhost_smoke_or_quick_extract")
            )
            if is_browser_op:
                if (
                    task_envelope.get("requires_replayable_evidence") or
                    task_envelope.get("is_long_horizon_web_task")
                ):
                    actor_id = "op.browser.webwright.playwright.01"
                elif task_envelope.get("is_localhost_smoke_or_quick_extract"):
                    actor_id = "op.browser.browser_use_mcp.quick.01"
                else:
                    # Default Fallback: Webwright
                    actor_id = "op.browser.webwright.playwright.01"
            else:
                selected, rejected = self.router.select_actor(
                    logical_operator,
                    unavailable=self._runtime_unavailable_actor_ids(logical_operator),
                )
                if not selected:
                    selected = self._physical_plan_runtime_fallback_actor(task_envelope)
                if not selected:
                    return SubmitResult(success=False, error=f"no_available_actor_for_{logical_operator}")
                actor_id = selected
        elif not actor_id:
            return SubmitResult(success=False, error="no_actor_id_or_logical_operator")

        task_envelope = self._ensure_execution_plan_metadata(
            task_envelope,
            logical_operator=logical_operator or str(task_envelope.get("logical_operator") or ""),
            actor_id=actor_id,
            sprint_id=sprint_id,
            node_id=node_id,
        )

        # Check profile risk denial
        profile = self.profiles.get(actor_id)
        evidence_path = f"actors/{actor_id}/evidence/{task_id}"

        # Verification gate: critical tasks must pass before any runtime side
        # effects. A blocked task must not acquire a lease or leave mailbox
        # residue, otherwise future dispatches see a false busy actor.
        if self._is_critical_task(task_envelope) and not self._is_verifier_task(task_envelope):
            gate_error = self._check_verification_gate(task_envelope, actor_id)
            if gate_error:
                return SubmitResult(success=False, error=gate_error)

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
            return SubmitResult(success=False, error=f"lease_acquisition_failed_for_{actor_id}")

        # Build a preliminary scheduler decision for materialization seed
        # (will be rebuilt after mailbox write with same fields)
        pre_sched = build_scheduler_decision(
            selected_actor=actor_id,
            logical_operator=logical_operator or "",
            score_factors={},
            penalties={},
            rejected=[],
            dag_id=sprint_id,
            node_id=node_id,
        )

        # Materialize runs/<dag-id>/ evidence seed (after lease, before mailbox)
        dag_id = sprint_id
        run_dir, artifact_refs = self._materialize_run_dir(
            dag_id=dag_id,
            node_id=node_id,
            actor_id=actor_id,
            task_id=task_id,
            lease=lease,
            scheduler_decision=pre_sched,
            task_envelope=task_envelope,
        )

        # Write to mailbox
        mailbox = ActorMailbox(actor_id, self.mailbox_base)
        # Load context packet if referenced
        ctx_ref = task_envelope.get("context_packet_ref")
        if ctx_ref:
            ctx_data = self.ctx_store.resolve_ref(ctx_ref)
            if ctx_data:
                task_envelope["context_packet"] = ctx_data

        inbox_path = mailbox.submit_task(task_envelope)
        outbox_dir = str(mailbox.outbox)

        operator_bridge = self._submit_operator_runtime_bridge(
            actor_id=actor_id,
            task_id=task_id,
            sprint_id=sprint_id,
            node_id=node_id,
            task_envelope=task_envelope,
        )
        if operator_bridge.get("status") == "failed":
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
            )
        if operator_bridge.get("status") == "submitted":
            mailbox.write_heartbeat("submitted", {"operator_runtime_bridge": operator_bridge})
            artifact_refs["operator_runtime_inbox"] = str(operator_bridge.get("inbox_path") or "")
            artifact_refs["operator_runtime_daemon_pid"] = str(operator_bridge.get("daemon_pid") or "")

        # Build scheduler decision (with S03 extended fields)
        sched_decision = build_scheduler_decision(
            selected_actor=actor_id,
            logical_operator=logical_operator or "",
            score_factors={},
            penalties={},
            rejected=[],
            dag_id=sprint_id,
            node_id=node_id,
        )

        resolved_capsule = task_envelope.get("resolved_capability_capsule") or {}
        if not isinstance(resolved_capsule, dict):
            resolved_capsule = {}

        # Write evidence ledger (with S03 run_dir / artifact_refs if materialized)
        ledger_path = self.ledger.write_run_entry(
            task_id=task_id,
            sprint_id=sprint_id,
            node_id=node_id,
            actor_id=actor_id,
            logical_operator=logical_operator or "",
            scheduler_decision=sched_decision,
            context_packet_id=ctx_ref.get("packet_id") if ctx_ref else None,
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
