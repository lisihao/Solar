"""OperatorAvailabilityResolver — single availability decision source.

Produces AvailabilitySnapshot consumable by PM Dispatch, GraphDrain,
Scheduler, builder-pool-status, watchdog, and operator_runtime.submit.
All availability state is derived from runtime/task/evidence inputs,
not hardcoded operator data.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional

from operator_availability.failure_classifier import FailureClassifier, FailureClassification
from operator_availability.availability_ledgers import (
    QuotaLedger,
    HealthLedger,
    CloseoutLedger,
    FailureLedger,
    AssignmentLedger,
)
from operator_availability.tui_signal import (
    TUISnapshot,
    TUISignalExtractor,
    TUISignalLedger,
    capture_tui_snapshot,
)
from operator_availability.propagation_gate import SharedPoolPropagationGate, PropagationDecision


HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))
PHYSICAL_OPERATORS_PATH = Path(
    os.environ.get("SOLAR_MULTI_TASK_OPERATORS", HARNESS_DIR / "config" / "physical-operators.json")
)


@dataclass
class EvidenceBlock:
    """Structured evidence for a single availability block."""
    source: str
    confidence: float | str
    excerpt: str
    scope: str
    expires_at: str | None
    recovery_action: str
    block_type: str
    evidence_ref: str
    hard_block: bool = True


@dataclass
class AvailabilitySnapshot:
    operator_id: str
    available: bool
    effective_state: str
    decision: str
    blocks: list[dict[str, Any]] = field(default_factory=list)
    shared_pool_blocks: list[dict[str, Any]] = field(default_factory=list)
    confidence: float = 1.0
    reason: str = ""
    evidence_refs: list[str] = field(default_factory=list)
    timestamp: str = ""
    evaluated_at: str = ""
    inputs_digest: str = ""
    billing_pool: str = ""
    key_ref: str = ""
    evidence: list[EvidenceBlock] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Machine-readable output compatible with P0 resolver decisions."""
        d = asdict(self)
        d["evidence"] = [asdict(e) if isinstance(e, EvidenceBlock) else e for e in self.evidence]
        return d

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, sort_keys=False, default=str)

    def evidence_summary(self) -> list[dict[str, Any]]:
        """Return evidence blocks as summary dicts for display consumers."""
        return [
            {
                "source": e.source,
                "confidence": e.confidence,
                "excerpt": e.excerpt[:200],
                "scope": e.scope,
                "expires_at": e.expires_at,
                "recovery_action": e.recovery_action,
            }
            for e in self.evidence
        ]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AvailabilitySnapshot:
        evidence_data = data.pop("evidence", [])
        evidence = []
        for ed in evidence_data:
            if isinstance(ed, dict):
                evidence.append(EvidenceBlock(**{k: v for k, v in ed.items() if k in EvidenceBlock.__dataclass_fields__}))
        snap = cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})
        snap.evidence = evidence
        return snap


class OperatorAvailabilityResolver:
    """Unified availability decision source for all downstream consumers.

    Resolves operator availability from:
    1. Physical operator registry (static config)
    2. Runtime lease/status state
    3. Ledger evidence (quota, health, closeout, failure)
    4. TUI signal evidence
    5. Propagation gate for billing_pool blocks

    Produces AvailabilitySnapshot that PM dispatch, builder-pool-status,
    graph_node_dispatcher, operator_flow_control, and operator_runtime.submit
    all consume identically.
    """

    def __init__(
        self,
        *,
        run_root: Optional[Path] = None,
        classifier: Optional[FailureClassifier] = None,
        propagation_gate: Optional[SharedPoolPropagationGate] = None,
    ) -> None:
        self.run_root = Path(run_root) if run_root else None
        self.quota_ledger = QuotaLedger(run_root=run_root)
        self.health_ledger = HealthLedger(run_root=run_root)
        self.closeout_ledger = CloseoutLedger(run_root=run_root)
        self.failure_ledger = FailureLedger(run_root=run_root)
        self.assignment_ledger = AssignmentLedger(run_root=run_root)
        tui_run_root = None
        if run_root is not None:
            tui_run_root = Path(run_root).parent / "tui-signals"
        self.tui_ledger = TUISignalLedger(run_root=tui_run_root)
        self.tui_extractor = TUISignalExtractor(classifier=classifier or FailureClassifier())
        self.propagation_gate = propagation_gate or SharedPoolPropagationGate(
            quota_ledger=self.quota_ledger,
        )
        self.classifier = classifier or FailureClassifier()

    def resolve(
        self,
        operator_id: str,
        *,
        registry_config: Optional[dict[str, Any]] = None,
        runtime_state: Optional[str] = None,
        lease: Optional[dict[str, Any]] = None,
        dynamic_status: Optional[dict[str, Any]] = None,
        tui_text: Optional[str] = None,
        failure_text: Optional[str] = None,
    ) -> AvailabilitySnapshot:
        """Resolve availability for an operator from runtime/task/evidence inputs."""
        blocks: list[dict[str, Any]] = []
        soft_blocks: list[dict[str, Any]] = []
        shared_pool_blocks: list[dict[str, Any]] = []
        evidence_refs: list[str] = []
        now_iso = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        # 1. Static config check
        config = registry_config or self._load_operator_config(operator_id)
        if config is None:
            return AvailabilitySnapshot(
                operator_id=operator_id,
                available=False,
                effective_state="disabled",
                decision="operator_not_registered",
                confidence=1.0,
                reason="Operator not found in registry",
                timestamp=now_iso,
                evaluated_at=now_iso,
                inputs_digest=self._inputs_digest(),
            )

        if not config.get("enabled", True):
            return AvailabilitySnapshot(
                operator_id=operator_id,
                available=False,
                effective_state="disabled",
                decision="operator_disabled",
                confidence=1.0,
                reason="Operator disabled in registry",
                timestamp=now_iso,
                evaluated_at=now_iso,
                inputs_digest=self._inputs_digest(),
            )

        # 2. Lease check
        if lease and lease.get("expires_at", "") > now_iso:
            ref = f"lease:{lease.get('task_id', '')}"
            blocks.append({
                "type": "lease",
                "scope": "task",
                "state": lease.get("state", "leased"),
                "expires_at": lease.get("expires_at"),
                "confidence": "observed",
                "evidence_ref": ref,
            })
            evidence_refs.append(ref)

        # 3. Runtime state check
        state = runtime_state or "idle"
        non_dispatchable = {"disabled", "leased", "running", "draining", "cooldown", "quota_exhausted", "auth_expired"}
        if state in non_dispatchable and not lease:
            ref = f"runtime_state:{state}"
            blocks.append({
                "type": "runtime_state",
                "scope": "operator_id",
                "state": state,
                "confidence": "observed",
                "evidence_ref": ref,
            })
            evidence_refs.append(ref)

        # 4. Dynamic status check
        if dynamic_status:
            ds_state = str(dynamic_status.get("runtime_state") or "").strip()
            expires_at = str(dynamic_status.get("expires_at") or "") or None
            if ds_state in non_dispatchable and not self._is_expired(expires_at, now_iso):
                expires_at = str(dynamic_status.get("expires_at") or "")
                ref = f"dynamic_status:{ds_state}"
                blocks.append({
                    "type": "dynamic_status",
                    "scope": "operator_id",
                    "state": ds_state,
                    "expires_at": expires_at,
                    "confidence": "observed",
                    "evidence_ref": ref,
                })
                evidence_refs.append(ref)

        # 5. Ledger evidence check. Expired rows are ignored so quota/auth
        # blocks recover without manual cleanup.
        for record in self.quota_ledger.read(operator_id=operator_id):
            if self._is_expired(record.get("expires_at"), now_iso):
                continue
            classification_type = self._record_classification_type(record)
            category = "auth" if "auth" in classification_type else "quota"
            ref = self._record_ref(record)
            block = self._block_from_record(record, classification_type, category)
            if category in ("quota", "auth"):
                classification = FailureClassification(
                    type="provider_auth_expired" if category == "auth" else "provider_rate_limit",
                    category=category,
                    scope_hint="key_ref" if category == "auth" else "provider",
                    confidence=record.get("confidence") or "observed",
                    expires_at=record.get("expires_at"),
                    propagates_to_billing_pool=True,
                    recovery_action="auth_refresh" if category == "auth" else "wait_decay",
                    evidence_refs=[ref],
                )
                prop_decision = self.propagation_gate.evaluate(
                    classification,
                    operator_id=operator_id,
                    billing_pool=config.get("billing_pool", ""),
                )
                if prop_decision.allowed:
                    shared_pool_blocks.append({
                        **block,
                        "target": prop_decision.target,
                        "reason": prop_decision.reason,
                    })
                else:
                    blocks.append(block)
                evidence_refs.append(ref)

        for record in self.health_ledger.read(operator_id=operator_id):
            if self._is_expired(record.get("expires_at"), now_iso):
                continue
            classification_type = self._record_classification_type(record)
            ref = self._record_ref(record)
            blocks.append(self._block_from_record(record, classification_type, "health"))
            evidence_refs.append(ref)

        for record in self.failure_ledger.read(operator_id=operator_id):
            if self._is_expired(record.get("expires_at"), now_iso):
                continue
            classification_type = self._record_classification_type(record)
            ref = self._record_ref(record)
            blocks.append(self._block_from_record(record, classification_type, "failure"))
            evidence_refs.append(ref)

        for record in self.closeout_ledger.read(operator_id=operator_id):
            if self._is_expired(record.get("expires_at"), now_iso):
                continue
            classification_type = self._record_classification_type(record)
            ref = self._record_ref(record)
            soft_blocks.append(self._block_from_record(record, classification_type, "closeout", hard=False))
            evidence_refs.append(ref)

        latest_assignment = self.assignment_ledger.latest(operator_id=operator_id)
        if latest_assignment and not self._is_expired(latest_assignment.get("expires_at"), now_iso):
            action = str(latest_assignment.get("action") or latest_assignment.get("payload", {}).get("action") or "")
            if action in {"assigned", "running", "dispatched"}:
                ref = self._record_ref(latest_assignment)
                blocks.append({
                    "type": "assignment",
                    "scope": "task",
                    "state": action,
                    "expires_at": latest_assignment.get("expires_at"),
                    "confidence": latest_assignment.get("confidence") or "observed",
                    "evidence_ref": ref,
                })
                evidence_refs.append(ref)

        # 6. Failure evidence check (via classifier)
        if failure_text:
            classification = self.classifier.classify(
                failure_text,
                operator_id=operator_id,
                source="resolver",
                source_confidence=0.8,
            )
            if classification.category == "closeout":
                eid = self.closeout_ledger.record_closeout_failure(
                    operator_id=operator_id,
                    classification_type=classification.type,
                )
                evidence_refs.append(f"closeout:{eid}")
                soft_blocks.append({
                    "type": "closeout",
                    "scope": classification.scope_hint,
                    "classification": classification.type,
                    "expires_at": classification.expires_at,
                    "confidence": classification.confidence,
                    "evidence_ref": f"closeout:{eid}",
                    "recovery": classification.recovery_action,
                    "hard_block": False,
                })
            elif classification.category in ("quota", "auth"):
                prop_decision = self.propagation_gate.evaluate(
                    classification,
                    operator_id=operator_id,
                    billing_pool=config.get("billing_pool", ""),
                )
                if prop_decision.allowed:
                    shared_pool_blocks.append({
                        "type": classification.type,
                        "scope": classification.scope_hint,
                        "target": prop_decision.target,
                        "confidence": prop_decision.confidence,
                        "expires_at": classification.expires_at,
                        "evidence_ref": classification.evidence_refs[0] if classification.evidence_refs else f"{classification.category}:{operator_id}",
                    })
                else:
                    blocks.append({
                        "type": classification.category,
                        "scope": classification.scope_hint,
                        "classification": classification.type,
                        "expires_at": classification.expires_at,
                        "confidence": classification.confidence,
                        "evidence_ref": classification.evidence_refs[0] if classification.evidence_refs else f"{classification.category}:{operator_id}",
                    })
            elif classification.category in ("transport", "health", "modal", "prompt", "business"):
                blocks.append({
                    "type": classification.category,
                    "scope": classification.scope_hint,
                    "classification": classification.type,
                    "expires_at": classification.expires_at,
                    "confidence": classification.confidence,
                    "evidence_ref": classification.evidence_refs[0] if classification.evidence_refs else f"{classification.category}:{operator_id}",
                })

        # 7. TUI signal check
        if tui_text:
            snapshot = capture_tui_snapshot(operator_id, tui_text)
            signals = self.tui_extractor.extract_signals(snapshot)
            for signal in signals:
                sid = self.tui_ledger.append_signal(signal)
                evidence_refs.append(f"tui_signal:{sid}")
                if signal.category in ("quota", "auth"):
                    confidence = getattr(signal.confidence, "score", lambda: signal.confidence)()
                    if signal.source in {"tmux_bottom", "tmux_pane"} and confidence >= 0.6:
                        blocks.append({
                            "type": "tui_quota" if signal.category == "quota" else "tui_auth",
                            "scope": signal.scope_hint,
                            "signal_type": signal.signal_type,
                            "confidence": signal.confidence,
                            "expires_at": signal.expires_at,
                            "evidence_ref": f"tui_signal:{sid}",
                        })

        # 8. Compute effective state
        effective_state = state
        if blocks:
            for block in blocks:
                if block.get("type") in ("lease", "runtime_state", "dynamic_status"):
                    effective_state = block.get("state", effective_state)
                    break
            else:
                first_type = str(blocks[0].get("type") or "")
                if "quota" in first_type:
                    effective_state = "quota_blocked"
                elif "auth" in first_type:
                    effective_state = "auth_blocked"
                elif first_type in {"health", "failure", "transport"}:
                    effective_state = "health_blocked"
                elif first_type == "assignment":
                    effective_state = "busy"
                else:
                    effective_state = "pane_dirty"

        available = len(blocks) == 0 and state not in non_dispatchable

        all_blocks = blocks + soft_blocks

        # 9. Extract billing_pool/key_ref from config
        billing_pool = config.get("billing_pool", "")
        key_ref = config.get("key_ref", config.get("auth", {}).get("key_ref", "")) if isinstance(config.get("auth"), dict) else config.get("key_ref", "")
        reason = "; ".join(str(b.get("type", "")) for b in all_blocks[:6]) if all_blocks else ""
        if soft_blocks and not blocks:
            reason = "closeout sidecar recovery pending; dispatch remains provider-available"

        # 10. Build structured evidence from blocks
        evidence = self._build_evidence(all_blocks, shared_pool_blocks, operator_id)

        return AvailabilitySnapshot(
            operator_id=operator_id,
            available=available,
            effective_state=effective_state,
            decision="dispatchable" if available else "do_not_dispatch",
            blocks=all_blocks,
            shared_pool_blocks=shared_pool_blocks,
            confidence=1.0 if not blocks else max(0.3, 1.0 - len(blocks) * 0.2),
            reason=reason[:240],
            evidence_refs=evidence_refs,
            timestamp=now_iso,
            evaluated_at=now_iso,
            inputs_digest=self._inputs_digest(),
            billing_pool=billing_pool,
            key_ref=str(key_ref),
            evidence=evidence,
        )

    def _load_operator_config(self, operator_id: str) -> Optional[dict[str, Any]]:
        if not PHYSICAL_OPERATORS_PATH.exists():
            return None
        try:
            registry = json.loads(PHYSICAL_OPERATORS_PATH.read_text(encoding="utf-8"))
            operators = registry.get("operators", {})
            config = operators.get(operator_id)
            return dict(config) if config else None
        except Exception:
            return None

    def _inputs_digest(self) -> str:
        heads = {
            "quota": self.quota_ledger.head_digest(),
            "health": self.health_ledger.head_digest(),
            "closeout": self.closeout_ledger.head_digest(),
            "failure": self.failure_ledger.head_digest(),
            "assignment": self.assignment_ledger.head_digest(),
        }
        material = json.dumps(heads, sort_keys=True)
        return hashlib.sha256(material.encode("utf-8")).hexdigest()

    @staticmethod
    def _parse_time(value: Any) -> Optional[datetime.datetime]:
        if not value:
            return None
        text = str(value)
        if not text:
            return None
        try:
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            parsed = datetime.datetime.fromisoformat(text)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=datetime.timezone.utc)
            return parsed.astimezone(datetime.timezone.utc)
        except ValueError:
            return None

    @classmethod
    def _is_expired(cls, expires_at: Any, now_iso: str) -> bool:
        expiry = cls._parse_time(expires_at)
        if expiry is None:
            return False
        now = cls._parse_time(now_iso) or datetime.datetime.now(datetime.timezone.utc)
        return expiry <= now

    @staticmethod
    def _record_classification_type(record: dict[str, Any]) -> str:
        payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
        return str(record.get("classification_type") or payload.get("classification_type") or record.get("type") or "unknown")

    @staticmethod
    def _record_ref(record: dict[str, Any]) -> str:
        return str(record.get("evidence_ref") or record.get("row_id") or record.get("event_id") or "unknown")

    def _block_from_record(
        self,
        record: dict[str, Any],
        classification_type: str,
        category: str,
        *,
        hard: bool = True,
    ) -> dict[str, Any]:
        ref = self._record_ref(record)
        return {
            "type": classification_type,
            "category": category,
            "scope": record.get("scope") or record.get("scope_hint") or "operator_id",
            "expires_at": record.get("expires_at"),
            "confidence": record.get("confidence") or "observed",
            "evidence_ref": ref,
            "hard_block": hard,
        }

    @staticmethod
    def _build_evidence(
        all_blocks: list[dict[str, Any]],
        shared_pool_blocks: list[dict[str, Any]],
        operator_id: str,
    ) -> list[EvidenceBlock]:
        """Convert block dicts into structured EvidenceBlock objects."""
        evidence: list[EvidenceBlock] = []
        seen_refs: set[str] = set()

        def _classify_block(block: dict[str, Any]) -> tuple[str, str, str]:
            block_type = str(block.get("type") or block.get("category") or "unknown")
            scope = str(block.get("scope") or "operator_id")
            expires_at = block.get("expires_at")
            source = "resolver"
            recovery_action = ""
            excerpt = ""

            if block_type in ("lease", "runtime_state", "dynamic_status", "assignment"):
                source = "runtime"
                recovery_action = "wait_expiry" if expires_at else "manual_intervention"
                state_val = block.get("state", "")
                excerpt = f"{block_type}: operator {operator_id} state={state_val}"
            elif block_type == "quota" or "quota" in block_type or block_type == "provider_rate_limit":
                source = "provider_quota"
                recovery_action = "wait_decay"
                excerpt = f"quota blocked for {operator_id}"
            elif block_type == "auth" or "auth" in block_type or block_type == "provider_auth_expired":
                source = "provider_auth"
                recovery_action = "auth_refresh"
                excerpt = f"auth expired for {operator_id}"
            elif block_type in ("health", "transport") or block_type.endswith("_timeout") or "transport" in block_type or "health" in block_type:
                source = "health_check"
                recovery_action = "restart_operator"
                excerpt = f"health/transport issue for {operator_id}: {block_type}"
            elif block_type == "closeout" or "closeout" in block_type or block_type.startswith("contract_closeout") or block_type.startswith("missing_"):
                source = "closeout"
                recovery_action = block.get("recovery", "retry_closeout")
                excerpt = f"closeout pending for {operator_id}: {block_type}"
            elif block_type == "failure":
                source = "failure_classifier"
                recovery_action = "investigate"
                excerpt = f"failure classified for {operator_id}"
            else:
                source = "resolver"
                recovery_action = "investigate"
                excerpt = f"block type {block_type} for {operator_id}"

            return source, recovery_action, excerpt

        def _add_block(block: dict[str, Any], *, hard: bool = True) -> None:
            ref = str(block.get("evidence_ref", ""))
            if ref in seen_refs:
                return
            seen_refs.add(ref)
            block_type = str(block.get("type") or block.get("category") or "unknown")
            raw_conf = block.get("confidence", "observed")
            conf_val = raw_conf if isinstance(raw_conf, (int, float)) else 1.0
            source, recovery_action, excerpt = _classify_block(block)
            evidence.append(EvidenceBlock(
                source=source,
                confidence=conf_val,
                excerpt=excerpt[:800],
                scope=str(block.get("scope") or "operator_id"),
                expires_at=block.get("expires_at"),
                recovery_action=recovery_action,
                block_type=block_type,
                evidence_ref=ref,
                hard_block=hard,
            ))

        for block in all_blocks:
            _add_block(block, hard=block.get("hard_block", True))

        for block in shared_pool_blocks:
            _add_block(block, hard=False)

        return evidence


class OperatorStateGarbageCollector:
    """Clean expired/conflicting availability state without creating blocks."""

    def __init__(
        self,
        resolver: Optional[OperatorAvailabilityResolver] = None,
        *,
        run_root: Optional[Path] = None,
        max_tui_age_seconds: int = 3600,
        max_cooldown_age_seconds: int = 1800,
        max_ledger_age_seconds: int = 86400,
    ) -> None:
        self.resolver = resolver or OperatorAvailabilityResolver(run_root=run_root)
        self.max_tui_age_seconds = max_tui_age_seconds
        self.max_cooldown_age_seconds = max_cooldown_age_seconds
        self.max_ledger_age_seconds = max_ledger_age_seconds

    def sweep(self, operator_id: str) -> dict[str, Any]:
        now_iso = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        return {
            "operator_id": operator_id,
            "swept_at": now_iso,
            "expired_blocks": self._sweep_expired_ledger_records(operator_id, now_iso),
            "conflicting_states_resolved": self._resolve_conflicting_states(operator_id, now_iso),
            "stale_tui_pruned": self._prune_stale_tui(operator_id),
            "old_cooldowns_removed": self._remove_old_cooldowns(operator_id, now_iso),
        }

    def sweep_all(self, operator_ids: Optional[list[str]] = None) -> list[dict[str, Any]]:
        if operator_ids is None:
            operator_ids = self._discover_operators()
        return [self.sweep(operator_id) for operator_id in operator_ids]

    def _sweep_expired_ledger_records(self, operator_id: str, now_iso: str) -> int:
        expired_count = 0
        for ledger in (
            self.resolver.quota_ledger,
            self.resolver.health_ledger,
            self.resolver.failure_ledger,
            self.resolver.closeout_ledger,
        ):
            for record in ledger.read(operator_id=operator_id):
                if OperatorAvailabilityResolver._is_expired(record.get("expires_at"), now_iso):
                    expired_count += 1
        return expired_count

    def _resolve_conflicting_states(self, operator_id: str, now_iso: str) -> int:
        categories_seen: set[str] = set()
        for ledger in (
            self.resolver.quota_ledger,
            self.resolver.health_ledger,
            self.resolver.failure_ledger,
            self.resolver.closeout_ledger,
        ):
            latest_record = ledger.latest(operator_id=operator_id)
            if not latest_record:
                continue
            if OperatorAvailabilityResolver._is_expired(latest_record.get("expires_at"), now_iso):
                continue
            categories_seen.add(self._record_category(latest_record))
        return 1 if len(categories_seen) > 1 else 0

    def _prune_stale_tui(self, operator_id: str) -> int:
        pruned = 0
        snapshots_dir = self.resolver.tui_ledger.snapshots_dir
        if not snapshots_dir.exists():
            return 0
        cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=self.max_tui_age_seconds)
        for snapshot_file in snapshots_dir.glob("*.json"):
            try:
                data = json.loads(snapshot_file.read_text(encoding="utf-8"))
                if data.get("operator_id") != operator_id:
                    continue
                ts = str(data.get("timestamp") or "")
                if not ts:
                    continue
                captured_at = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
                if captured_at < cutoff:
                    snapshot_file.unlink()
                    pruned += 1
            except (json.JSONDecodeError, ValueError, OSError):
                continue

        latest_path = self.resolver.tui_ledger.latest_dir / f"{operator_id}.json"
        if latest_path.exists():
            try:
                data = json.loads(latest_path.read_text(encoding="utf-8"))
                ts = str(data.get("captured_at") or data.get("timestamp") or "")
                if ts:
                    captured_at = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
                    if captured_at < cutoff:
                        latest_path.unlink()
                        pruned += 1
            except (json.JSONDecodeError, ValueError, OSError):
                pass
        return pruned

    def _remove_old_cooldowns(self, operator_id: str, now_iso: str) -> int:
        removed = 0
        for record in self.resolver.health_ledger.read(operator_id=operator_id):
            classification_type = str(record.get("classification_type") or "")
            if "cooldown" in classification_type.lower() and OperatorAvailabilityResolver._is_expired(record.get("expires_at"), now_iso):
                removed += 1
        return removed

    def _discover_operators(self) -> list[str]:
        operator_ids: set[str] = set()
        for ledger in (
            self.resolver.quota_ledger,
            self.resolver.health_ledger,
            self.resolver.failure_ledger,
            self.resolver.closeout_ledger,
            self.resolver.assignment_ledger,
        ):
            for record in ledger.read(limit=1000):
                operator_id = str(record.get("operator_id") or "")
                if operator_id:
                    operator_ids.add(operator_id)
        return sorted(operator_ids)

    @staticmethod
    def _record_category(record: dict[str, Any]) -> str:
        payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
        classification_type = str(record.get("classification_type") or payload.get("classification_type") or "unknown")
        lower = classification_type.lower()
        if "quota" in lower or "rate_limit" in lower:
            return "quota"
        if "auth" in lower:
            return "auth"
        if "closeout" in lower:
            return "closeout"
        if "health" in lower or "transport" in lower:
            return "health"
        return "other"


def get_availability_snapshot(
    operator_id: str,
    *,
    run_root: Optional[Path] = None,
    registry_config: Optional[dict[str, Any]] = None,
    runtime_state: Optional[str] = None,
    lease: Optional[dict[str, Any]] = None,
    dynamic_status: Optional[dict[str, Any]] = None,
    tui_text: Optional[str] = None,
    failure_text: Optional[str] = None,
) -> AvailabilitySnapshot:
    """Common read path for status UI, watchdog, builder-pool-status, and GraphDrain.

    Creates a resolver, resolves the operator, and returns the snapshot.
    This is the single entry point all consumers should use.
    """
    resolver = OperatorAvailabilityResolver(run_root=run_root)
    return resolver.resolve(
        operator_id,
        registry_config=registry_config,
        runtime_state=runtime_state,
        lease=lease,
        dynamic_status=dynamic_status,
        tui_text=tui_text,
        failure_text=failure_text,
    )


def get_all_availability_snapshots(
    *,
    run_root: Optional[Path] = None,
) -> list[AvailabilitySnapshot]:
    """Resolve snapshots for all registered operators."""
    resolver = OperatorAvailabilityResolver(run_root=run_root)
    registry = resolver._load_operator_config.__func__(resolver, "__all__")
    if not PHYSICAL_OPERATORS_PATH.exists():
        return []
    try:
        data = json.loads(PHYSICAL_OPERATORS_PATH.read_text(encoding="utf-8"))
        operators = data.get("operators", {})
    except Exception:
        return []
    snapshots: list[AvailabilitySnapshot] = []
    for op_id, op_config in operators.items():
        config = dict(op_config) if isinstance(op_config, dict) else {}
        config["operator_id"] = op_id
        snap = resolver.resolve(op_id, registry_config=config)
        snapshots.append(snap)
    return snapshots
