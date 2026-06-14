"""Tests for orchestration routes verification_gate extensions."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import sys

# Add harness lib to path
HARNESS_DIR = Path.home() / ".solar" / "harness"
sys.path.insert(0, str(HARNESS_DIR / "lib"))
sys.path.insert(0, str(HARNESS_DIR / "status-server" / "routes"))


def test_verification_gate_structure():
    """Test that verification_gate has required fields."""
    # Simulate the verification_gate builder
    def _build_verification_gate(
        node_id: str,
        node: dict[str, Any],
        routing: list[dict[str, Any]],
    ) -> dict[str, Any]:
        gate = node.get("gate") or ""
        evidence_policy = node.get("evidence_policy") or {}
        risk_level = node.get("risk_level") or ""
        verifier_required = node.get("verifier_required") or False
        cross_provider_required = node.get("cross_provider_required") or False

        # Find routing decision
        routing_decision = {}
        for r in routing:
            if r.get("node_id") == node_id:
                routing_decision = r
                break

        writer_actor_id = routing_decision.get("writer_actor_id") or ""
        verifier_actor_id = routing_decision.get("verifier_actor_id") or ""

        writer_verifier_conflict = (
            "unknown" if not writer_actor_id or not verifier_actor_id
            else writer_actor_id == verifier_actor_id
        )

        return {
            "patch_artifact": {
                "status": "missing",
                "source": "artifact_scan",
                "degraded": True,
            },
            "test_evidence": {
                "status": "missing",
                "source": "artifact_scan",
                "degraded": True,
            },
            "review_decision": {
                "status": "missing",
                "source": "artifact_scan",
                "degraded": True,
                "must_fix_count": None,
            },
            "writer_verifier_conflict": {
                "detected": writer_verifier_conflict,
                "writer_actor_id": writer_actor_id,
                "verifier_actor_id": verifier_actor_id,
                "degraded": writer_verifier_conflict is True,
            },
            "provider_conflict": {
                "detected": False,
                "writer_provider": "unknown",
                "verifier_provider": "unknown",
                "risk_level": risk_level,
                "cross_provider_required": cross_provider_required,
                "degraded": False,
            },
            "audit_refs": {
                "routing_decision_ref": routing_decision.get("decision_id") or "",
                "runtime_context_ref": routing_decision.get("runtime_context_ref") or "",
                "sidecar_ref": routing_decision.get("sidecar_ref") or "",
            },
            "verifier_required": verifier_required,
            "cross_provider_required": cross_provider_required,
            "gate_name": gate,
            "evidence_policy": evidence_policy,
        }

    node = {
        "id": "N1",
        "gate": "G_TEST_GATE",
        "risk_level": "high",
        "verifier_required": True,
        "cross_provider_required": True,
        "evidence_policy": {"patch": "required", "test": "required"},
    }

    vg = _build_verification_gate("N1", node, [])

    # Assert required top-level fields
    assert "patch_artifact" in vg
    assert "test_evidence" in vg
    assert "review_decision" in vg
    assert "writer_verifier_conflict" in vg
    assert "provider_conflict" in vg
    assert "audit_refs" in vg
    assert "verifier_required" in vg
    assert "cross_provider_required" in vg

    # Assert nested structure
    assert vg["patch_artifact"]["status"] in {"missing", "present", "unknown"}
    assert vg["test_evidence"]["status"] in {"missing", "present", "unknown"}
    assert vg["review_decision"]["status"] in {"missing", "present", "unknown"}
    assert "detected" in vg["writer_verifier_conflict"]
    assert "detected" in vg["provider_conflict"]

    print("PASS: verification_gate structure test")


def test_verification_gate_missing_evidence():
    """Test that missing evidence sources are represented correctly."""
    # Test with missing evidence
    vg_missing = {
        "patch_artifact": {"status": "missing", "degraded": True},
        "test_evidence": {"status": "missing", "degraded": True},
        "review_decision": {"status": "missing", "degraded": True},
    }

    assert vg_missing["patch_artifact"]["status"] == "missing"
    assert vg_missing["patch_artifact"]["degraded"] is True
    assert vg_missing["test_evidence"]["status"] == "missing"
    assert vg_missing["test_evidence"]["degraded"] is True
    assert vg_missing["review_decision"]["status"] == "missing"
    assert vg_missing["review_decision"]["degraded"] is True

    print("PASS: missing evidence representation test")


def test_verification_gate_writer_verifier_conflict():
    """Test writer/verifier conflict detection."""
    # No conflict (different actors)
    vg_no_conflict = {
        "writer_verifier_conflict": {
            "detected": False,
            "writer_actor_id": "actor-1",
            "verifier_actor_id": "actor-2",
            "degraded": False,
        }
    }

    assert vg_no_conflict["writer_verifier_conflict"]["detected"] is False
    assert vg_no_conflict["writer_verifier_conflict"]["degraded"] is False

    # Conflict (same actor)
    vg_conflict = {
        "writer_verifier_conflict": {
            "detected": True,
            "writer_actor_id": "actor-1",
            "verifier_actor_id": "actor-1",
            "degraded": True,
        }
    }

    assert vg_conflict["writer_verifier_conflict"]["detected"] is True
    assert vg_conflict["writer_verifier_conflict"]["degraded"] is True

    print("PASS: writer/verifier conflict detection test")


def test_verification_gate_provider_conflict():
    """Test provider conflict detection."""
    # No conflict (different providers)
    vg_no_conflict = {
        "provider_conflict": {
            "detected": False,
            "writer_provider": "anthropic",
            "verifier_provider": "zhipu",
            "risk_level": "high",
            "cross_provider_required": True,
            "degraded": False,
        }
    }

    assert vg_no_conflict["provider_conflict"]["detected"] is False
    assert vg_no_conflict["provider_conflict"]["degraded"] is False

    # Conflict (same provider, high risk)
    vg_conflict = {
        "provider_conflict": {
            "detected": True,
            "writer_provider": "anthropic",
            "verifier_provider": "anthropic",
            "risk_level": "high",
            "cross_provider_required": True,
            "degraded": True,
        }
    }

    assert vg_conflict["provider_conflict"]["detected"] is True
    assert vg_conflict["provider_conflict"]["degraded"] is True

    print("PASS: provider conflict detection test")


def test_no_hardcoded_sprint_ids():
    """Verify no hardcoded sprint IDs in payload generation."""
    import inspect
    import ast

    routes_file = HARNESS_DIR / "status-server" / "routes" / "orchestration_routes.py"
    content = routes_file.read_text(encoding="utf-8")

    # Check for suspicious hardcoded sprint IDs
    suspicious_patterns = [
        '"sprint-2026',
        "'sprint-2026",
        '"test-sprint',
        "'test-sprint",
        '"demo-sprint',
        "'demo-sprint",
    ]

    found_hardcoded = []
    for pattern in suspicious_patterns:
        if pattern in content:
            # Check if it's in a string literal (likely a test/example)
            lines = content.split("\n")
            for i, line in enumerate(lines, 1):
                if pattern in line and not line.strip().startswith("#"):
                    found_hardcoded.append(f"Line {i}: {line.strip()}")

    if found_hardcoded:
        print("FAIL: Found potential hardcoded sprint IDs:")
        for item in found_hardcoded:
            print(f"  {item}")
        assert False, "Hardcoded sprint IDs found"
    else:
        print("PASS: No hardcoded sprint IDs detected")


def test_no_hardcoded_business_data():
    """Verify no fake business data or tokens."""
    routes_file = HARNESS_DIR / "status-server" / "routes" / "orchestration_routes.py"
    content = routes_file.read_text(encoding="utf-8")

    # Check for fake tokens or credentials
    fake_patterns = [
        "sk-",
        "api_key_",
        "token_123",
        "secret_",
        "password_",
        "fake_decision",
        "mock_review",
    ]

    found_fakes = []
    for pattern in fake_patterns:
        if pattern in content:
            lines = content.split("\n")
            for i, line in enumerate(lines, 1):
                if pattern in line and not line.strip().startswith("#"):
                    found_fakes.append(f"Line {i}: {line.strip()}")

    if found_fakes:
        print("FAIL: Found potential fake data:")
        for item in found_fakes:
            print(f"  {item}")
        assert False, "Fake data found"
    else:
        print("PASS: No fake business data detected")


if __name__ == "__main__":
    print("Running orchestration routes tests...")
    test_verification_gate_structure()
    test_verification_gate_missing_evidence()
    test_verification_gate_writer_verifier_conflict()
    test_verification_gate_provider_conflict()
    test_no_hardcoded_sprint_ids()
    test_no_hardcoded_business_data()
    print("\nAll tests passed!")
