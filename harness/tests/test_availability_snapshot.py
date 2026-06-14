"""Tests for AvailabilitySnapshot API — S9 acceptance criteria.

Verifies:
- AvailabilitySnapshot API is the common read path for status UI, watchdog,
  builder-pool-status, and GraphDrain consumers.
- Evidence display includes source, confidence, excerpt, scope, expires_at,
  and recovery_action.
- Snapshot output is machine-readable and backward compatible with P0 resolver
  decisions.
"""
from __future__ import annotations

import json
import tempfile
from dataclasses import asdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import pytest

# Ensure lib is on path
import sys
LIB_DIR = str(Path(__file__).resolve().parents[1] / "lib")
if LIB_DIR not in sys.path:
    sys.path.insert(0, LIB_DIR)

from operator_availability.resolver import (
    AvailabilitySnapshot,
    EvidenceBlock,
    OperatorAvailabilityResolver,
    get_availability_snapshot,
    get_all_availability_snapshots,
)
from operator_availability.availability_ledgers import (
    QuotaLedger,
    HealthLedger,
    CloseoutLedger,
    FailureLedger,
    AssignmentLedger,
)


@pytest.fixture
def run_root(tmp_path: Path) -> Path:
    """Provide a clean run root for ledger isolation."""
    root = tmp_path / "run" / "operator-availability"
    root.mkdir(parents=True, exist_ok=True)
    return root


@pytest.fixture
def resolver(run_root: Path) -> OperatorAvailabilityResolver:
    return OperatorAvailabilityResolver(run_root=run_root)


def _enabled_config(**overrides: Any) -> dict[str, Any]:
    cfg = {
        "operator_id": "test-op-1",
        "enabled": True,
        "billing_pool": "test-pool",
        "model": "test-model",
    }
    cfg.update(overrides)
    return cfg


class TestEvidenceBlock:
    """EvidenceBlock dataclass tests."""

    def test_evidence_block_fields(self):
        eb = EvidenceBlock(
            source="resolver",
            confidence=1.0,
            excerpt="test excerpt",
            scope="operator_id",
            expires_at="2026-12-31T23:59:59Z",
            recovery_action="wait_decay",
            block_type="quota",
            evidence_ref="quota:test-op-1",
            hard_block=True,
        )
        assert eb.source == "resolver"
        assert eb.confidence == 1.0
        assert eb.excerpt == "test excerpt"
        assert eb.scope == "operator_id"
        assert eb.expires_at == "2026-12-31T23:59:59Z"
        assert eb.recovery_action == "wait_decay"
        assert eb.block_type == "quota"
        assert eb.evidence_ref == "quota:test-op-1"

    def test_evidence_block_serializable(self):
        eb = EvidenceBlock(
            source="health_check",
            confidence=0.8,
            excerpt="health issue",
            scope="operator_id",
            expires_at=None,
            recovery_action="restart_operator",
            block_type="health",
            evidence_ref="health:test-op",
        )
        d = asdict(eb)
        assert isinstance(d, dict)
        assert d["source"] == "health_check"
        serialized = json.dumps(d)
        assert "health_check" in serialized


class TestAvailabilitySnapshotFields:
    """Verify AvailabilitySnapshot has evidence display fields."""

    def test_snapshot_has_evidence_field(self):
        snap = AvailabilitySnapshot(
            operator_id="test-op",
            available=True,
            effective_state="idle",
            decision="dispatchable",
        )
        assert hasattr(snap, "evidence")
        assert isinstance(snap.evidence, list)
        assert len(snap.evidence) == 0

    def test_snapshot_with_evidence(self):
        evidence = [
            EvidenceBlock(
                source="provider_quota",
                confidence=1.0,
                excerpt="quota blocked for test-op",
                scope="provider",
                expires_at="2026-12-31T23:59:59Z",
                recovery_action="wait_decay",
                block_type="provider_rate_limit",
                evidence_ref="quota:test-op",
            ),
        ]
        snap = AvailabilitySnapshot(
            operator_id="test-op",
            available=False,
            effective_state="quota_blocked",
            decision="do_not_dispatch",
            evidence=evidence,
        )
        assert len(snap.evidence) == 1
        assert snap.evidence[0].source == "provider_quota"
        assert snap.evidence[0].recovery_action == "wait_decay"

    def test_snapshot_to_dict_includes_evidence(self):
        evidence = [
            EvidenceBlock(
                source="closeout",
                confidence=1.0,
                excerpt="closeout pending",
                scope="task",
                expires_at=None,
                recovery_action="retry_closeout",
                block_type="closeout",
                evidence_ref="closeout:test-op",
                hard_block=False,
            ),
        ]
        snap = AvailabilitySnapshot(
            operator_id="test-op",
            available=True,
            effective_state="idle",
            decision="dispatchable",
            evidence=evidence,
        )
        d = snap.to_dict()
        assert "evidence" in d
        assert len(d["evidence"]) == 1
        assert d["evidence"][0]["source"] == "closeout"

    def test_snapshot_to_json_roundtrip(self):
        evidence = [
            EvidenceBlock(
                source="provider_auth",
                confidence=1.0,
                excerpt="auth expired",
                scope="operator_id",
                expires_at="2026-12-31T00:00:00Z",
                recovery_action="auth_refresh",
                block_type="provider_auth_expired",
                evidence_ref="auth:test-op",
            ),
        ]
        snap = AvailabilitySnapshot(
            operator_id="test-op",
            available=False,
            effective_state="auth_blocked",
            decision="do_not_dispatch",
            confidence=0.8,
            evidence=evidence,
            billing_pool="pool-1",
        )
        json_str = snap.to_json()
        parsed = json.loads(json_str)
        assert parsed["operator_id"] == "test-op"
        assert parsed["available"] is False
        assert parsed["effective_state"] == "auth_blocked"
        assert len(parsed["evidence"]) == 1
        assert parsed["evidence"][0]["recovery_action"] == "auth_refresh"
        assert parsed["billing_pool"] == "pool-1"

    def test_snapshot_from_dict(self):
        data = {
            "operator_id": "test-op",
            "available": True,
            "effective_state": "idle",
            "decision": "dispatchable",
            "blocks": [],
            "shared_pool_blocks": [],
            "confidence": 1.0,
            "reason": "",
            "evidence_refs": [],
            "timestamp": "2026-06-06T00:00:00Z",
            "evaluated_at": "2026-06-06T00:00:00Z",
            "inputs_digest": "abc123",
            "billing_pool": "",
            "key_ref": "",
            "evidence": [
                {
                    "source": "runtime",
                    "confidence": 1.0,
                    "excerpt": "lease: operator test-op state=leased",
                    "scope": "task",
                    "expires_at": "2026-12-31T00:00:00Z",
                    "recovery_action": "wait_expiry",
                    "block_type": "lease",
                    "evidence_ref": "lease:task-1",
                    "hard_block": True,
                },
            ],
        }
        snap = AvailabilitySnapshot.from_dict(data)
        assert snap.operator_id == "test-op"
        assert len(snap.evidence) == 1
        assert snap.evidence[0].source == "runtime"
        assert snap.evidence[0].recovery_action == "wait_expiry"


class TestEvidenceSummary:
    """Test evidence_summary() output for display consumers."""

    def test_evidence_summary_fields(self):
        evidence = [
            EvidenceBlock(
                source="provider_quota",
                confidence=0.9,
                excerpt="rate limit hit",
                scope="provider",
                expires_at="2026-12-31T23:59:59Z",
                recovery_action="wait_decay",
                block_type="provider_rate_limit",
                evidence_ref="quota:op-1",
            ),
        ]
        snap = AvailabilitySnapshot(
            operator_id="op-1",
            available=False,
            effective_state="quota_blocked",
            decision="do_not_dispatch",
            evidence=evidence,
        )
        summary = snap.evidence_summary()
        assert len(summary) == 1
        entry = summary[0]
        assert entry["source"] == "provider_quota"
        assert entry["confidence"] == 0.9
        assert "rate limit" in entry["excerpt"]
        assert entry["scope"] == "provider"
        assert entry["expires_at"] == "2026-12-31T23:59:59Z"
        assert entry["recovery_action"] == "wait_decay"

    def test_evidence_summary_exceeds_200_chars(self):
        long_excerpt = "x" * 500
        evidence = [
            EvidenceBlock(
                source="resolver",
                confidence=1.0,
                excerpt=long_excerpt,
                scope="operator_id",
                expires_at=None,
                recovery_action="investigate",
                block_type="failure",
                evidence_ref="fail:op-1",
            ),
        ]
        snap = AvailabilitySnapshot(
            operator_id="op-1",
            available=False,
            effective_state="health_blocked",
            decision="do_not_dispatch",
            evidence=evidence,
        )
        summary = snap.evidence_summary()
        assert len(summary[0]["excerpt"]) <= 200


class TestGetAvailabilitySnapshot:
    """Test get_availability_snapshot() common read path."""

    def test_returns_snapshot_for_enabled_operator(self, run_root: Path):
        config = _enabled_config()
        snap = get_availability_snapshot(
            "test-op-1",
            run_root=run_root,
            registry_config=config,
            runtime_state="idle",
        )
        assert isinstance(snap, AvailabilitySnapshot)
        assert snap.operator_id == "test-op-1"
        assert snap.available is True
        assert snap.decision == "dispatchable"
        assert snap.effective_state == "idle"

    def test_returns_snapshot_with_blocks(self, run_root: Path):
        config = _enabled_config()
        snap = get_availability_snapshot(
            "test-op-1",
            run_root=run_root,
            registry_config=config,
            runtime_state="cooldown",
        )
        assert snap.available is False
        assert len(snap.blocks) > 0
        assert len(snap.evidence) > 0
        ev = snap.evidence[0]
        assert ev.source == "runtime"
        assert ev.recovery_action in ("wait_expiry", "manual_intervention")

    def test_backward_compatible_with_p0(self, run_root: Path):
        """Snapshot must have all P0 fields plus new evidence."""
        config = _enabled_config()
        snap = get_availability_snapshot(
            "test-op-1",
            run_root=run_root,
            registry_config=config,
            runtime_state="idle",
        )
        d = snap.to_dict()
        # P0 required fields
        assert "operator_id" in d
        assert "available" in d
        assert "effective_state" in d
        assert "decision" in d
        assert "blocks" in d
        assert "shared_pool_blocks" in d
        assert "confidence" in d
        assert "reason" in d
        assert "evidence_refs" in d
        assert "timestamp" in d
        assert "evaluated_at" in d
        assert "inputs_digest" in d
        assert "billing_pool" in d
        assert "key_ref" in d
        # P1 new field
        assert "evidence" in d


class TestGetAllAvailabilitySnapshots:
    """Test get_all_availability_snapshots() batch read path."""

    def test_returns_list(self, run_root: Path):
        snapshots = get_all_availability_snapshots(run_root=run_root)
        assert isinstance(snapshots, list)
        for snap in snapshots:
            assert isinstance(snap, AvailabilitySnapshot)
            assert snap.operator_id
            assert isinstance(snap.evidence, list)


class TestResolverEvidencePopulation:
    """Test that resolver.resolve() populates evidence correctly."""

    def test_evidence_from_runtime_state(self, resolver: OperatorAvailabilityResolver):
        config = _enabled_config()
        snap = resolver.resolve("test-op-1", registry_config=config, runtime_state="cooldown")
        assert len(snap.evidence) > 0
        ev = snap.evidence[0]
        assert ev.source == "runtime"
        assert ev.block_type == "runtime_state"
        assert ev.recovery_action == "manual_intervention"
        assert "cooldown" in ev.excerpt

    def test_evidence_from_quota_ledger(self, resolver: OperatorAvailabilityResolver):
        config = _enabled_config()
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        resolver.quota_ledger.record_quota_event(
            "test-op-1",
            "provider_rate_limit",
            expires_at=future,
            source="test",
            excerpt="429 rate limit",
        )
        snap = resolver.resolve("test-op-1", registry_config=config, runtime_state="idle")
        quota_evidence = [e for e in snap.evidence if e.source == "provider_quota"]
        assert len(quota_evidence) > 0
        ev = quota_evidence[0]
        assert ev.source == "provider_quota"
        assert ev.recovery_action == "wait_decay"
        assert ev.scope == "provider"

    def test_evidence_from_health_ledger(self, resolver: OperatorAvailabilityResolver):
        config = _enabled_config()
        resolver.health_ledger.record_health_event(
            "test-op-1",
            "transport_timeout",
            source="test",
            excerpt="connection refused",
        )
        snap = resolver.resolve("test-op-1", registry_config=config, runtime_state="idle")
        health_evidence = [e for e in snap.evidence if e.source == "health_check"]
        assert len(health_evidence) > 0
        assert health_evidence[0].recovery_action == "restart_operator"

    def test_evidence_from_closeout(self, resolver: OperatorAvailabilityResolver):
        config = _enabled_config()
        resolver.closeout_ledger.record_closeout_failure(
            "test-op-1",
            "missing_handoff",
            sprint_id="sprint-123",
            node_id="S5",
            missing_artifact="handoff.md",
            recovery_action="builder_repair",
        )
        snap = resolver.resolve("test-op-1", registry_config=config, runtime_state="idle")
        closeout_evidence = [e for e in snap.evidence if e.source == "closeout"]
        assert len(closeout_evidence) > 0
        assert closeout_evidence[0].recovery_action in ("builder_repair", "retry_closeout")
        assert closeout_evidence[0].hard_block is False

    def test_evidence_from_lease(self, resolver: OperatorAvailabilityResolver):
        config = _enabled_config()
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        lease = {
            "task_id": "task-xyz",
            "state": "leased",
            "expires_at": future,
        }
        snap = resolver.resolve(
            "test-op-1",
            registry_config=config,
            runtime_state="idle",
            lease=lease,
        )
        assert snap.available is False
        lease_evidence = [e for e in snap.evidence if e.block_type == "lease"]
        assert len(lease_evidence) > 0
        assert lease_evidence[0].source == "runtime"
        assert lease_evidence[0].recovery_action == "wait_expiry"

    def test_disabled_operator_has_no_evidence(self, resolver: OperatorAvailabilityResolver):
        config = _enabled_config(enabled=False)
        snap = resolver.resolve("test-op-1", registry_config=config, runtime_state="idle")
        assert snap.available is False
        assert snap.decision == "operator_disabled"
        assert len(snap.evidence) == 0

    def test_unregistered_operator(self, resolver: OperatorAvailabilityResolver):
        snap = resolver.resolve("nonexistent-op", runtime_state="idle")
        assert snap.available is False
        assert snap.decision == "operator_not_registered"

    def test_evidence_ordering_all_blocks(self, resolver: OperatorAvailabilityResolver):
        """Multiple evidence types produce ordered evidence list."""
        config = _enabled_config()
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        resolver.quota_ledger.record_quota_event(
            "test-op-1", "provider_rate_limit", expires_at=future,
        )
        resolver.health_ledger.record_health_event(
            "test-op-1", "transport_timeout",
        )
        snap = resolver.resolve("test-op-1", registry_config=config, runtime_state="idle")
        assert len(snap.evidence) >= 2
        types = {e.block_type for e in snap.evidence}
        assert "provider_rate_limit" in types or any("quota" in t for t in types)
        assert "transport_timeout" in types or any("transport" in t for t in types)


class TestMachineReadability:
    """Snapshot output must be machine-readable (JSON)."""

    def test_to_dict_no_bytes(self, resolver: OperatorAvailabilityResolver):
        config = _enabled_config()
        snap = resolver.resolve("test-op-1", registry_config=config, runtime_state="idle")
        d = snap.to_dict()
        json_str = json.dumps(d, default=str)
        assert isinstance(json_str, str)

    def test_to_json_valid(self, resolver: OperatorAvailabilityResolver):
        config = _enabled_config()
        snap = resolver.resolve("test-op-1", registry_config=config, runtime_state="idle")
        json_str = snap.to_json()
        parsed = json.loads(json_str)
        assert parsed["operator_id"] == "test-op-1"

    def test_evidence_summary_machine_readable(self, resolver: OperatorAvailabilityResolver):
        config = _enabled_config()
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        resolver.quota_ledger.record_quota_event(
            "test-op-1", "provider_rate_limit", expires_at=future,
        )
        snap = resolver.resolve("test-op-1", registry_config=config, runtime_state="idle")
        summary = snap.evidence_summary()
        assert isinstance(summary, list)
        json_str = json.dumps(summary, default=str)
        assert isinstance(json_str, str)
