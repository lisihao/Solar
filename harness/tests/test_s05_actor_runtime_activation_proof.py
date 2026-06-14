"""S05 V2 Activation Proof Tests — Verify actor_runtime submit path end-to-end.

Acceptance (from verification-matrix):
  A1: A DAG node compiles to dispatch via actor_runtime, not direct pane send-keys
  A2: scheduler decision is auditable (decision_reason, score_factors, selected_actor)
  A3: context packet is loaded into the runtime submit chain
  A4: evidence ledger records dispatch/result/verification references
  A7: At least one real sprint/graph node runs through the new main chain

No mocks — uses real ActorRuntime, LeaseBroker, EvidenceLedger, ContextStore.
Uses temp dirs to avoid polluting production state.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

import pytest

# ---------------------------------------------------------------------------
# Path setup — ensure lib/ is importable
# ---------------------------------------------------------------------------
_LIB_DIR = Path(__file__).resolve().parents[2] / "lib"
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

_HARNESS_DIR = Path(__file__).resolve().parents[1]  # tests/ → harness/
_FIXTURES = Path(__file__).resolve().parent / "fixtures" / "s05_actor_runtime_activation"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_fixture(name: str) -> Dict[str, Any]:
    path = _FIXTURES / name
    assert path.exists(), f"Fixture not found: {path}"
    return json.loads(path.read_text(encoding="utf-8"))


def _make_runtime(tmp_path: Path):
    """Build an ActorRuntime pointed at temp dirs (no production side-effects)."""
    from actor_runtime import ActorRuntime
    from actor_lease import LeaseBroker
    from actor_mailbox import ActorMailbox
    from evidence_ledger import EvidenceLedger
    from context_store import ContextStore
    from actor_profiles import load_profiles

    harness_dir = tmp_path / "harness"
    harness_dir.mkdir(parents=True, exist_ok=True)

    # Create minimal config dirs
    (harness_dir / "config").mkdir(parents=True, exist_ok=True)
    (harness_dir / "actors").mkdir(parents=True, exist_ok=True)
    (harness_dir / "run" / "actor-leases").mkdir(parents=True, exist_ok=True)
    (harness_dir / "run" / "actor-evidence").mkdir(parents=True, exist_ok=True)
    (harness_dir / "run" / "context-store").mkdir(parents=True, exist_ok=True)
    (harness_dir / "run" / "runs").mkdir(parents=True, exist_ok=True)
    (harness_dir / "sprints").mkdir(parents=True, exist_ok=True)

    # Copy real config files for logical-operators and agent-actors
    real_config = _HARNESS_DIR / "config"
    bindings_src = real_config / "logical-operators.json"
    actors_src = real_config / "agent-actors.json"
    if bindings_src.exists():
        (harness_dir / "config" / "logical-operators.json").write_text(
            bindings_src.read_text(encoding="utf-8"), encoding="utf-8"
        )
    if actors_src.exists():
        (harness_dir / "config" / "agent-actors.json").write_text(
            actors_src.read_text(encoding="utf-8"), encoding="utf-8"
        )

    broker = LeaseBroker(harness_dir / "run" / "actor-leases")
    ledger = EvidenceLedger(ledger_dir=harness_dir / "run" / "actor-evidence")
    ctx_store = ContextStore(store_dir=harness_dir / "run" / "context-store")

    rt = ActorRuntime(
        harness_dir=harness_dir,
        lease_broker=broker,
        mailbox_base=harness_dir / "actors",
        evidence_ledger=ledger,
        context_store=ctx_store,
        profiles_path=actors_src if actors_src.exists() else None,
        bindings_path=bindings_src if bindings_src.exists() else None,
    )
    return rt, harness_dir, ledger, ctx_store


# ---------------------------------------------------------------------------
# Test: A1 — dispatch_path is actor_runtime, not direct_pane
# ---------------------------------------------------------------------------

class TestDispatchPathActorRuntime:
    """A1: Verify dispatch goes through actor_runtime, not direct pane send-keys."""

    def test_submit_returns_success_via_actor_runtime(self, tmp_path):
        rt, harness_dir, ledger, ctx_store = _make_runtime(tmp_path)

        envelope = _load_fixture("test_task_envelope.json")
        context_packet = _load_fixture("test_context_packet.json")

        # Save context packet to store
        ctx_store.save(context_packet["packet_id"], context_packet)

        result = rt.submit(
            task_envelope=envelope,
            logical_operator="ImplementationWorker",
            sprint_id=envelope["sprint_id"],
            node_id=envelope["node_id"],
        )

        assert result.success, f"Submit failed: {result.error}"
        assert result.scheduler_decision is not None, "Missing scheduler_decision"

        # Verify dispatch_path is actor_runtime (not direct_pane)
        decision = result.scheduler_decision
        assert decision.get("selected_actor"), "selected_actor is empty"
        assert decision.get("logical_operator") == "ImplementationWorker"
        assert decision.get("schema_version") == "solar.scheduler_decision.v1"

    def test_no_direct_pane_in_submit_result(self, tmp_path):
        rt, harness_dir, ledger, ctx_store = _make_runtime(tmp_path)

        envelope = _load_fixture("test_task_envelope.json")
        context_packet = _load_fixture("test_context_packet.json")
        ctx_store.save(context_packet["packet_id"], context_packet)

        result = rt.submit(
            task_envelope=envelope,
            logical_operator="ImplementationWorker",
            sprint_id=envelope["sprint_id"],
            node_id=envelope["node_id"],
        )

        assert result.success
        # The actor_runtime submit path does NOT use tmux send-keys.
        # Evidence: submit returns lease + mailbox paths, not tmux references.
        assert result.lease is not None, "Missing lease — direct pane does not use leases"
        assert result.inbox_path is not None, "Missing inbox_path — actor mailbox required"
        assert "tmux" not in str(result.inbox_path).lower(), "inbox_path must not reference tmux"


# ---------------------------------------------------------------------------
# Test: A2 — scheduler decision is auditable
# ---------------------------------------------------------------------------

class TestSchedulerDecisionAuditable:
    """A2: scheduler decision has decision_reason, score_factors, selected_actor."""

    def test_decision_has_required_fields(self, tmp_path):
        rt, harness_dir, ledger, ctx_store = _make_runtime(tmp_path)

        envelope = _load_fixture("test_task_envelope.json")
        context_packet = _load_fixture("test_context_packet.json")
        ctx_store.save(context_packet["packet_id"], context_packet)

        result = rt.submit(
            task_envelope=envelope,
            logical_operator="ImplementationWorker",
            sprint_id=envelope["sprint_id"],
            node_id=envelope["node_id"],
        )

        assert result.success, f"Submit failed: {result.error}"
        decision = result.scheduler_decision

        # A2 required fields
        assert decision.get("selected_actor"), "selected_actor missing or empty"
        assert decision.get("logical_operator"), "logical_operator missing or empty"
        assert "score_factors" in decision, "score_factors missing"
        assert isinstance(decision["score_factors"], dict), "score_factors must be dict"
        assert decision.get("decision_id"), "decision_id missing"
        assert decision.get("schema_version"), "schema_version missing"

    def test_decision_reason_present(self, tmp_path):
        rt, harness_dir, ledger, ctx_store = _make_runtime(tmp_path)

        envelope = _load_fixture("test_task_envelope.json")
        context_packet = _load_fixture("test_context_packet.json")
        ctx_store.save(context_packet["packet_id"], context_packet)

        result = rt.submit(
            task_envelope=envelope,
            logical_operator="ImplementationWorker",
            sprint_id=envelope["sprint_id"],
            node_id=envelope["node_id"],
        )

        assert result.success
        decision = result.scheduler_decision
        # decision_reason or selection_summary must be non-empty
        reason = decision.get("decision_reason") or decision.get("selection_summary")
        assert reason, "decision_reason or selection_summary must be present"


# ---------------------------------------------------------------------------
# Test: A3 — context packet loaded into submit chain
# ---------------------------------------------------------------------------

class TestContextPacketLoaded:
    """A3: context packet is truly loaded into the runtime submit chain."""

    def test_context_packet_ref_resolved(self, tmp_path):
        rt, harness_dir, ledger, ctx_store = _make_runtime(tmp_path)

        envelope = _load_fixture("test_task_envelope.json")
        context_packet = _load_fixture("test_context_packet.json")

        # Save to context store
        saved_path = ctx_store.save(context_packet["packet_id"], context_packet)
        assert Path(saved_path).exists(), "Context packet file must exist"

        # Resolve it back
        ref = {"packet_id": context_packet["packet_id"]}
        resolved = ctx_store.resolve_ref(ref)
        assert resolved is not None, "Context packet could not be resolved"
        assert resolved["packet_id"] == "s05-activation-proof-context"
        assert resolved["node_id"] == "V2_activation_proof_tests"

    def test_submit_with_context_packet(self, tmp_path):
        rt, harness_dir, ledger, ctx_store = _make_runtime(tmp_path)

        envelope = _load_fixture("test_task_envelope.json")
        context_packet = _load_fixture("test_context_packet.json")
        ctx_store.save(context_packet["packet_id"], context_packet)

        result = rt.submit(
            task_envelope=envelope,
            logical_operator="ImplementationWorker",
            sprint_id=envelope["sprint_id"],
            node_id=envelope["node_id"],
        )

        assert result.success, f"Submit failed: {result.error}"

        # Verify the context packet ref was used — check evidence ledger
        ledger_dir = harness_dir / "run" / "actor-evidence"
        ledger_files = list(ledger_dir.glob("*.jsonl"))
        assert len(ledger_files) > 0, "No evidence ledger files created"

        # Check the ledger entry references the context packet
        latest_ledger = ledger_files[-1]
        entries = []
        for line in latest_ledger.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                entries.append(json.loads(line))

        assert len(entries) > 0, "Ledger is empty"
        entry = entries[0]
        assert entry.get("context_packet_id") == "s05-activation-proof-context", \
            f"context_packet_id not recorded in ledger: {entry.get('context_packet_id')}"


# ---------------------------------------------------------------------------
# Test: A4 — evidence ledger records dispatch/result/verification
# ---------------------------------------------------------------------------

class TestEvidenceLedgerRecords:
    """A4: evidence ledger records dispatch, result, verification references."""

    def test_ledger_has_dispatch_entry(self, tmp_path):
        rt, harness_dir, ledger, ctx_store = _make_runtime(tmp_path)

        envelope = _load_fixture("test_task_envelope.json")
        context_packet = _load_fixture("test_context_packet.json")
        ctx_store.save(context_packet["packet_id"], context_packet)

        result = rt.submit(
            task_envelope=envelope,
            logical_operator="ImplementationWorker",
            sprint_id=envelope["sprint_id"],
            node_id=envelope["node_id"],
        )

        assert result.success
        assert result.evidence_ledger_path, "evidence_ledger_path missing from result"
        ledger_path = Path(result.evidence_ledger_path)
        assert ledger_path.exists(), f"Evidence ledger file not found: {ledger_path}"

        entries = []
        for line in ledger_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                entries.append(json.loads(line))

        assert len(entries) >= 1, "No entries in evidence ledger"
        entry = entries[0]
        assert entry.get("event_type") == "run_dispatched", \
            f"Expected event_type=run_dispatched, got {entry.get('event_type')}"
        assert entry.get("task_id") == envelope["task_id"]
        assert entry.get("sprint_id") == envelope["sprint_id"]
        assert entry.get("node_id") == envelope["node_id"]
        assert entry.get("actor_id"), "actor_id missing from ledger entry"
        assert entry.get("scheduler_decision"), "scheduler_decision missing from ledger"

    def test_ledger_has_required_paths(self, tmp_path):
        rt, harness_dir, ledger, ctx_store = _make_runtime(tmp_path)

        envelope = _load_fixture("test_task_envelope.json")
        context_packet = _load_fixture("test_context_packet.json")
        ctx_store.save(context_packet["packet_id"], context_packet)

        result = rt.submit(
            task_envelope=envelope,
            logical_operator="ImplementationWorker",
            sprint_id=envelope["sprint_id"],
            node_id=envelope["node_id"],
        )

        assert result.success
        ledger_path = Path(result.evidence_ledger_path)
        entries = []
        for line in ledger_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                entries.append(json.loads(line))

        assert len(entries) >= 1
        entry = entries[0]

        # Check per_node paths (legacy) and per_node_v2 (S03)
        assert "per_node" in entry or "per_node_v2" in entry, \
            "Missing per_node/per_node_v2 path references"
        if "per_node" in entry:
            assert "snapshot_path" in entry["per_node"]
            assert "log_path" in entry["per_node"]
            assert "result_path" in entry["per_node"]


# ---------------------------------------------------------------------------
# Test: A7 — real sprint/graph node runs through new main chain
# ---------------------------------------------------------------------------

class TestRealSprintGraphNodeActivation:
    """A7: At least one real sprint/graph node runs through the new main chain."""

    def test_real_graph_node_activation(self, tmp_path):
        rt, harness_dir, ledger, ctx_store = _make_runtime(tmp_path)

        # Find the specific sprint graph file by looking for V2_activation_proof_tests
        graph_candidates = sorted(
            _HARNESS_DIR.glob("sprints/*把推荐最终架构图收口为*s05-verification-release.task_graph.json")
        )
        graph_candidates = [p for p in graph_candidates if ".legacy" not in p.name]

        if not graph_candidates:
            # Fallback: try listing the sprints dir directly
            sprints_dir = _HARNESS_DIR / "sprints"
            if sprints_dir.exists():
                for f in sprints_dir.iterdir():
                    if "s05-verification-release" in f.name and f.name.endswith(".task_graph.json") and ".legacy" not in f.name and "把推荐最终架构图收口为" in f.name:
                        graph_candidates.append(f)
            if not graph_candidates:
                pytest.skip("Real task_graph.json not found — skip A7 real graph test")

        graph_path = graph_candidates[0]

        graph = json.loads(graph_path.read_text(encoding="utf-8"))

        # Find V2 node (this very node)
        v2_node = None
        for node in graph.get("nodes", []):
            if node.get("id") == "V2_activation_proof_tests":
                v2_node = node
                break

        if not v2_node:
            pytest.skip("V2 node not found in graph — skip A7 test")

        # Build a task envelope from the graph node
        sprint_id = "sprint-20260530-p0-verification-release"
        node_id = "V2_activation_proof_tests"
        logical_op = v2_node.get("logical_operator", "Builder")

        context_data = {
            "packet_id": f"s05-a7-context-{node_id}",
            "sprint_id": sprint_id,
            "node_id": node_id,
            "verification_matrix_ref": v2_node.get("goal", ""),
        }
        ctx_store.save(context_data["packet_id"], context_data)

        envelope = {
            "task_id": f"s05-a7-activation-{node_id}",
            "objective": v2_node.get("goal", "Activation proof test"),
            "logical_operator": logical_op,
            "sprint_id": sprint_id,
            "node_id": node_id,
            "context_packet_ref": {"packet_id": context_data["packet_id"]},
        }

        result = rt.submit(
            task_envelope=envelope,
            logical_operator=logical_op,
            actor_id="mini-claude-opus-planner",  # Specify actor directly for real graph test
            sprint_id=sprint_id,
            node_id=node_id,
        )

        assert result.success, f"Real graph node submit failed: {result.error}"
        assert result.lease is not None, "Lease not acquired for real graph node"
        assert result.inbox_path is not None, "Mailbox inbox not created"
        assert result.evidence_ledger_path is not None, "Evidence ledger not written"

        # Verify the evidence ledger file exists and has content
        ledger_file = Path(result.evidence_ledger_path)
        assert ledger_file.exists()
        content = ledger_file.read_text(encoding="utf-8").strip()
        assert len(content) > 0, "Evidence ledger file is empty"


# ---------------------------------------------------------------------------
# Test: Lease + Mailbox integrity
# ---------------------------------------------------------------------------

class TestLeaseAndMailboxIntegrity:
    """Verify lease state and mailbox paths are valid after submit."""

    def test_lease_acquired_and_valid(self, tmp_path):
        rt, harness_dir, ledger, ctx_store = _make_runtime(tmp_path)

        envelope = _load_fixture("test_task_envelope.json")
        context_packet = _load_fixture("test_context_packet.json")
        ctx_store.save(context_packet["packet_id"], context_packet)

        result = rt.submit(
            task_envelope=envelope,
            logical_operator="ImplementationWorker",
            sprint_id=envelope["sprint_id"],
            node_id=envelope["node_id"],
        )

        assert result.success
        lease = result.lease
        assert lease is not None
        assert lease.actor_id, "Lease missing actor_id"
        assert lease.task_id, "Lease missing task_id"
        assert lease.state in ("LEASED", "RUNNING"), f"Unexpected lease state: {lease.state}"
        assert lease.lease_id, "Lease missing lease_id"

    def test_mailbox_inbox_has_task_file(self, tmp_path):
        rt, harness_dir, ledger, ctx_store = _make_runtime(tmp_path)

        envelope = _load_fixture("test_task_envelope.json")
        context_packet = _load_fixture("test_context_packet.json")
        ctx_store.save(context_packet["packet_id"], context_packet)

        result = rt.submit(
            task_envelope=envelope,
            logical_operator="ImplementationWorker",
            sprint_id=envelope["sprint_id"],
            node_id=envelope["node_id"],
        )

        assert result.success
        inbox = Path(result.inbox_path)
        assert inbox.exists(), f"Inbox file not found: {inbox}"
        task_data = json.loads(inbox.read_text(encoding="utf-8"))
        assert task_data.get("task_id") == envelope["task_id"]

    def test_mailbox_outbox_dir_exists(self, tmp_path):
        rt, harness_dir, ledger, ctx_store = _make_runtime(tmp_path)

        envelope = _load_fixture("test_task_envelope.json")
        context_packet = _load_fixture("test_context_packet.json")
        ctx_store.save(context_packet["packet_id"], context_packet)

        result = rt.submit(
            task_envelope=envelope,
            logical_operator="ImplementationWorker",
            sprint_id=envelope["sprint_id"],
            node_id=envelope["node_id"],
        )

        assert result.success
        outbox = Path(result.outbox_path)
        assert outbox.exists(), f"Outbox dir not found: {outbox}"
        assert outbox.is_dir(), f"Outbox must be a directory: {outbox}"
