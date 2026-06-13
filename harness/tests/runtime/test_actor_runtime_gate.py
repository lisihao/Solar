"""Tests for actor_runtime.py — VerificationGate integration in submit()."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "lib"))

from actor_runtime import ActorRuntime, SubmitResult


def _make_runtime():
    return ActorRuntime(
        harness_dir=Path("/tmp/test_actor_runtime_gate"),
    )


def _critical_code_task(**overrides):
    """Build a critical code task envelope."""
    envelope = {
        "task_id": "test-task-001",
        "objective": "implement feature X",
        "task_graph_node": {
            "id": "S2",
            "gate": "G_IMPL",
            "risk": "high",
            "type": "implementation",
        },
        "has_patch": True,
        "has_test_evidence": True,
        "verifier_decision": "pass",
        "verifier_actor_id": "verifier-actor-001",
    }
    envelope.update(overrides)
    return envelope


def _non_critical_task(**overrides):
    """Build a non-critical task envelope (no task_graph_node or low risk)."""
    envelope = {
        "task_id": "test-task-002",
        "objective": "run wake dispatch",
        "task_graph_node": {
            "id": "W1",
            "gate": "",
            "risk": "low",
            "type": "coordination",
        },
    }
    envelope.update(overrides)
    return envelope


# --- _is_critical_task tests ---

def test_critical_high_risk():
    rt = _make_runtime()
    assert rt._is_critical_task(_critical_code_task())


def test_critical_implementation_with_gate():
    rt = _make_runtime()
    env = _critical_code_task()
    env["task_graph_node"]["risk"] = "medium"
    env["task_graph_node"]["gate"] = "G_IMPL"
    env["task_graph_node"]["type"] = "implementation"
    assert rt._is_critical_task(env)


def test_not_critical_low_risk():
    rt = _make_runtime()
    assert not rt._is_critical_task(_non_critical_task())


def test_not_critical_no_graph_node():
    rt = _make_runtime()
    assert not rt._is_critical_task({"objective": "simple task"})


def test_not_critical_approval_gate_false():
    rt = _make_runtime()
    env = _non_critical_task()
    env["task_graph_node"]["approval_gate"] = False
    assert not rt._is_critical_task(env)


def test_critical_approval_gate_true():
    rt = _make_runtime()
    env = _non_critical_task()
    env["task_graph_node"]["approval_gate"] = True
    assert rt._is_critical_task(env)


# --- _check_verification_gate tests ---

def test_gate_blocks_missing_test_evidence():
    rt = _make_runtime()
    env = _critical_code_task(has_test_evidence=False)
    err = rt._check_verification_gate(env, "builder-actor-001")
    assert err is not None
    assert "no_test_evidence" in err


def test_gate_blocks_missing_patch():
    rt = _make_runtime()
    env = _critical_code_task(has_patch=False)
    err = rt._check_verification_gate(env, "builder-actor-001")
    assert err is not None
    assert "no_patch_artifact" in err


def test_gate_blocks_no_verifier():
    rt = _make_runtime()
    env = _critical_code_task(verifier_decision=None)
    err = rt._check_verification_gate(env, "builder-actor-001")
    assert err is not None
    assert "no_verifier_decision" in err


def test_gate_blocks_writer_is_verifier():
    rt = _make_runtime()
    env = _critical_code_task(
        verifier_actor_id="builder-actor-001",
        verifier_decision="pass",
    )
    err = rt._check_verification_gate(env, "builder-actor-001")
    assert err is not None
    assert "writer_and_verifier_same_actor" in err


def test_gate_passes_with_all_evidence():
    rt = _make_runtime()
    env = _critical_code_task(
        verifier_actor_id="verifier-actor-001",
        verifier_decision="pass",
    )
    err = rt._check_verification_gate(env, "builder-actor-001")
    assert err is None


def test_gate_non_code_task_uses_dag_done():
    rt = _make_runtime()
    env = _critical_code_task()
    env["task_graph_node"]["type"] = "review"
    env["task_graph_node"]["risk"] = "high"
    err = rt._check_verification_gate(env, "builder-actor-001")
    assert err is None


# --- Integration: submit() gate wiring ---

def test_submit_critical_blocked_by_gate():
    """Critical task with no test evidence should fail at submit()."""
    rt = _make_runtime()
    env = _critical_code_task(has_test_evidence=False)
    err = rt._check_verification_gate(env, "builder-001")
    assert err is not None
    assert "verification_gate_blocked" in err


def test_submit_critical_gate_blocks_before_lease_or_mailbox(tmp_path):
    """Gate failure must not leave a lease or mailbox task behind."""
    rt = ActorRuntime(harness_dir=tmp_path)
    env = _critical_code_task(has_test_evidence=False)

    result = rt.submit(
        task_envelope=env,
        logical_operator="ImplementationWorker",
        actor_id="builder-001",
        sprint_id="s1",
        node_id="S2",
    )

    assert result.success is False
    assert "verification_gate_blocked" in result.error
    assert not (tmp_path / "run" / "actor-leases" / "builder-001.json").exists()
    assert not (tmp_path / "actors" / "builder-001" / "inbox").exists()


def test_submit_verifier_task_skips_pre_verifier_gate(tmp_path):
    """Verifier nodes must be allowed to run so they can produce verifier_decision."""
    rt = ActorRuntime(harness_dir=tmp_path)
    env = {
        "task_id": "verify-task-001",
        "objective": "Review implementation and evidence before closeout.",
        "task_graph_node": {
            "id": "S3",
            "gate": "G_REVIEW",
            "risk": "high",
            "type": "review",
            "logical_operator": "Verifier",
            "dispatch_task_type": "verification",
            "approval_gate": True,
        },
    }

    result = rt.submit(
        task_envelope=env,
        logical_operator="Verifier",
        actor_id="verifier-001",
        sprint_id="s1",
        node_id="S3",
    )

    assert result.success is True
    assert result.inbox_path is not None
    assert Path(result.inbox_path).exists()
    lease = rt.broker.get("verifier-001")
    assert lease is not None
    assert lease.task_id == "verify-task-001"


def test_submit_non_critical_skips_gate():
    """Non-critical tasks should not be blocked by the gate."""
    rt = _make_runtime()
    assert not rt._is_critical_task(_non_critical_task())
    # No gate check is performed for non-critical tasks


if __name__ == "__main__":
    test_critical_high_risk()
    test_critical_implementation_with_gate()
    test_not_critical_low_risk()
    test_not_critical_no_graph_node()
    test_not_critical_approval_gate_false()
    test_critical_approval_gate_true()
    test_gate_blocks_missing_test_evidence()
    test_gate_blocks_missing_patch()
    test_gate_blocks_no_verifier()
    test_gate_blocks_writer_is_verifier()
    test_gate_passes_with_all_evidence()
    test_gate_non_code_task_uses_dag_done()
    test_submit_critical_blocked_by_gate()
    test_submit_critical_gate_blocks_before_lease_or_mailbox(Path("/tmp/test_actor_runtime_gate_side_effects"))
    test_submit_verifier_task_skips_pre_verifier_gate(Path("/tmp/test_actor_runtime_gate_verifier"))
    test_submit_non_critical_skips_gate()
    print("\nAll 16 tests PASSED")
