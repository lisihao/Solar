"""Tests for logical_operator_router.py — Operator routing, bindings, and policy gate.

The policy tests (S03 G_ROUTER_SELECTION) exercise ``select_with_policy``:
the router must read the logical operator's risk_constraints / cost_hint /
effort_hint / required_capabilities, evaluate every candidate against its actor
profile, exclude risk_denied / capability_missing / reserve_miss / quota_reserved
candidates into ``rejected_candidates``, and let a profile/binding edit change the
routing without touching a DAG node.
"""
import json
import tempfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "lib"))

from logical_operator_router import LogicalOperatorRouter, P0_LOGICAL_OPERATORS


def _make_bindings(tmpdir, actors_tmp=None):
    bindings = {}
    for i, op in enumerate(sorted(P0_LOGICAL_OPERATORS)):
        bindings[op] = {
            "operator_type": op,
            "candidates": [
                {"actor_id": f"actor-a-{i%3}", "priority": 1, "condition": "always"},
                {"actor_id": f"actor-b-{i%3}", "priority": 2, "condition": "fallback"},
            ],
            "selection_policy": "score",
            "fallback_policy": "next_candidate",
        }
    bp = Path(tmpdir) / "logical-operators.json"
    bp.write_text(json.dumps({"bindings": bindings}))
    # Minimal actors
    actors = {}
    for i in range(3):
        actors[f"actor-a-{i}"] = {"actor_id": f"actor-a-{i}", "capability_profile": {}}
        actors[f"actor-b-{i}"] = {"actor_id": f"actor-b-{i}", "capability_profile": {}}
    ap = Path(tmpdir) / "agent-actors.json"
    ap.write_text(json.dumps({"actors": actors}))
    return bp, ap


def test_all_17_operators():
    assert len(P0_LOGICAL_OPERATORS) == 17
    expected = {
        "DeepArchitect", "RootCauseDebugger", "ImplementationWorker", "PatchWorker",
        "TestDesigner", "TestRunner", "BenchmarkRunner", "ParallelExplorer",
        "ResearchScout", "ResearchSynthesizer", "Critic", "Verifier", "VerifierLite",
        "SecurityGate", "QuotaBroker", "ContextCompressor", "ArtifactCurator",
    }
    assert P0_LOGICAL_OPERATORS == expected
    print("PASS: all_17_operators")


def test_binding_changes_actor():
    with tempfile.TemporaryDirectory() as td:
        bp, ap = _make_bindings(td)
        router = LogicalOperatorRouter(bp, ap)
        # DeepArchitect -> first candidate
        c1 = router.get_candidates("DeepArchitect")
        assert len(c1) > 0

        # Change binding: swap candidates
        data = json.loads(bp.read_text())
        data["bindings"]["DeepArchitect"]["candidates"] = [
            {"actor_id": "actor-new-1", "priority": 1, "condition": "always"},
            {"actor_id": "actor-new-2", "priority": 2, "condition": "fallback"},
        ]
        bp.write_text(json.dumps(data))

        # Reload
        router2 = LogicalOperatorRouter(bp, ap)
        c2 = router2.get_candidates("DeepArchitect")
        assert c2 != c1
        assert "actor-new-1" in c2
        print("PASS: binding_changes_actor")


def test_fallback_candidate_ordering():
    with tempfile.TemporaryDirectory() as td:
        bp, ap = _make_bindings(td)
        router = LogicalOperatorRouter(bp, ap)

        # Find the actual primary candidate for DeepArchitect
        candidates = router.get_candidates("DeepArchitect")
        primary = candidates[0]

        # Primary unavailable -> fallback
        sel, rej = router.select_actor(
            "DeepArchitect",
            unavailable={primary},
        )
        assert sel is not None
        assert sel != primary
        assert any(r["reason"] == "unavailable" for r in rej)
        print("PASS: fallback_candidate_ordering")


def test_quota_blocked_fallback():
    with tempfile.TemporaryDirectory() as td:
        bp, ap = _make_bindings(td)
        router = LogicalOperatorRouter(bp, ap)
        primary = router.get_candidates("DeepArchitect")[0]
        sel, rej = router.select_actor(
            "DeepArchitect",
            quota_blocked={primary},
        )
        assert sel is not None
        assert any(r["reason"] == "quota_blocked" for r in rej)
        print("PASS: quota_blocked_fallback")


def test_risk_denied_fallback():
    with tempfile.TemporaryDirectory() as td:
        bp, ap = _make_bindings(td)
        router = LogicalOperatorRouter(bp, ap)
        primary = router.get_candidates("DeepArchitect")[0]
        sel, rej = router.select_actor(
            "DeepArchitect",
            risk_denied={primary},
        )
        assert sel is not None
        assert any(r["reason"] == "risk_denied" for r in rej)
        print("PASS: risk_denied_fallback")


def test_all_operators_bound():
    with tempfile.TemporaryDirectory() as td:
        bp, ap = _make_bindings(td)
        router = LogicalOperatorRouter(bp, ap)
        unbound = router.validate_all_operators_bound()
        assert unbound == [], f"unbound: {unbound}"
        print("PASS: all_operators_bound")


# ---------------------------------------------------------------------------
# Policy-aware selection (S03 G_ROUTER_SELECTION)
# ---------------------------------------------------------------------------

def _policy_fixture(tmpdir):
    """A logical operator with risk/cost/effort/capability constraints plus
    three actor profiles: a fit primary, a risk-denied actor, and a
    capability-missing actor.
    """
    operator_def = {
        "operator_type": "SecurityGate",
        "required_capabilities": {"code_impl": 4, "root_cause_debug": 3},
        "risk_constraints": {"git_push": True},
        "cost_hint": "high",
        "effort_hint": "high",
    }
    bindings = {
        "SecurityGate": {
            "operator_type": "SecurityGate",
            "candidates": [
                {"actor_id": "actor-fit", "priority": 1, "condition": "always"},
                {"actor_id": "actor-risk-denied", "priority": 2, "condition": "always"},
                {"actor_id": "actor-cap-missing", "priority": 3, "condition": "always"},
            ],
            "selection_policy": "priority_first",
            "fallback_policy": "queue",
        }
    }
    bp = Path(tmpdir) / "logical-operators.json"
    bp.write_text(json.dumps({"bindings": bindings, "logical_operators": {"SecurityGate": operator_def}}))

    actors = {
        # Meets capabilities AND allowed to git_push.
        "actor-fit": {
            "actor_id": "actor-fit",
            "capability_profile": {"code_impl": 5, "root_cause_debug": 4},
            "risk_profile": {"git_push": "repo_local"},
            "cost_profile": {"cost_tier": "high", "effort": "high"},
        },
        # Meets capabilities but git_push denied -> hard deny.
        "actor-risk-denied": {
            "actor_id": "actor-risk-denied",
            "capability_profile": {"code_impl": 5, "root_cause_debug": 4},
            "risk_profile": {"git_push": "denied"},
            "cost_profile": {"cost_tier": "high", "effort": "high"},
        },
        # Allowed to git_push but missing required capability -> capability_missing.
        "actor-cap-missing": {
            "actor_id": "actor-cap-missing",
            "capability_profile": {"code_impl": 5},  # no root_cause_debug
            "risk_profile": {"git_push": "repo_local"},
            "cost_profile": {"cost_tier": "high", "effort": "high"},
        },
    }
    ap = Path(tmpdir) / "agent-actors.json"
    ap.write_text(json.dumps({"actors": actors}))
    return bp, ap


def test_policy_reads_operator_constraints_and_selects_fit_actor():
    """Router reads risk_constraints/cost_hint/effort_hint/required_capabilities
    as primary selection inputs and selects the policy-fit actor."""
    with tempfile.TemporaryDirectory() as td:
        bp, ap = _policy_fixture(td)
        router = LogicalOperatorRouter(bp, ap)

        # Requirements were actually derived from the operator definition.
        reqs = router._build_requirements("SecurityGate")
        assert "git_push" in reqs.required_risk_actions
        assert reqs.required_capabilities.get("code_impl") == 4
        assert reqs.cost_hint == "high"
        assert reqs.effort_hint == "high"

        result = router.select_with_policy("SecurityGate")
        assert result["selected_actor"] == "actor-fit"
        assert result["eligible"] == ["actor-fit"]
        assert result["policy_version"]
        print("PASS: policy_reads_operator_constraints_and_selects_fit_actor")


def test_policy_excludes_risk_and_capability_into_rejected():
    """risk_denied and capability_missing candidates are excluded from ranking
    and surfaced in rejected_candidates."""
    with tempfile.TemporaryDirectory() as td:
        bp, ap = _policy_fixture(td)
        router = LogicalOperatorRouter(bp, ap)
        result = router.select_with_policy("SecurityGate")

        rejected_ids = {r["actor_id"]: r["reason"] for r in result["rejected_candidates"]}
        assert "actor-risk-denied" in rejected_ids
        assert rejected_ids["actor-risk-denied"].endswith("_denied")
        assert "actor-cap-missing" in rejected_ids
        assert rejected_ids["actor-cap-missing"].startswith("capability_missing")

        # Excluded candidates are NOT in the eligible ranking pool.
        assert "actor-risk-denied" not in result["eligible"]
        assert "actor-cap-missing" not in result["eligible"]
        print("PASS: policy_excludes_risk_and_capability_into_rejected")


def test_policy_excludes_reserve_miss():
    """A reserve_ratio actor on a low-value task is a reserve_miss and is excluded."""
    with tempfile.TemporaryDirectory() as td:
        operator_def = {
            "operator_type": "ArtifactCurator",
            "required_capabilities": {},
            "cost_hint": "low",
        }
        bindings = {
            "ArtifactCurator": {
                "operator_type": "ArtifactCurator",
                "candidates": [
                    {"actor_id": "actor-reserved", "priority": 1, "condition": "always"},
                    {"actor_id": "actor-cheap", "priority": 2, "condition": "always"},
                ],
            }
        }
        bp = Path(td) / "logical-operators.json"
        bp.write_text(json.dumps({"bindings": bindings, "logical_operators": {"ArtifactCurator": operator_def}}))
        actors = {
            "actor-reserved": {
                "actor_id": "actor-reserved",
                "capability_profile": {},
                "risk_profile": {},
                "cost_profile": {"cost_tier": "high", "reserve_ratio": 0.5},
            },
            "actor-cheap": {
                "actor_id": "actor-cheap",
                "capability_profile": {},
                "risk_profile": {},
                "cost_profile": {"cost_tier": "low", "reserve_ratio": 0.0},
            },
        }
        ap = Path(td) / "agent-actors.json"
        ap.write_text(json.dumps({"actors": actors}))

        router = LogicalOperatorRouter(bp, ap)
        # Low value task drives the reserve_miss penalty.
        result = router.select_with_policy(
            "ArtifactCurator",
            task={"task_value_class": "BULK_DOC_EDIT", "task_type": "BULK_DOC_EDIT"},
        )
        rejected_ids = {r["actor_id"]: r["reason"] for r in result["rejected_candidates"]}
        assert rejected_ids.get("actor-reserved") == "reserve_miss"
        assert "actor-reserved" not in result["eligible"]
        assert result["selected_actor"] == "actor-cheap"
        print("PASS: policy_excludes_reserve_miss")


def test_policy_excludes_quota_reserved():
    """quota_reserved candidates are excluded from ranking and recorded."""
    with tempfile.TemporaryDirectory() as td:
        bp, ap = _policy_fixture(td)
        router = LogicalOperatorRouter(bp, ap)
        result = router.select_with_policy(
            "SecurityGate",
            quota_reserved={"actor-fit"},
        )
        rejected_ids = {r["actor_id"]: r["reason"] for r in result["rejected_candidates"]}
        assert rejected_ids.get("actor-fit") == "quota_reserved"
        assert "actor-fit" not in result["eligible"]
        # No remaining candidate passes policy -> nothing selected.
        assert result["selected_actor"] is None
        print("PASS: policy_excludes_quota_reserved")


def test_profile_change_reroutes_without_dag_edit():
    """Changing an actor's profile (not the DAG node / binding order) changes routing."""
    with tempfile.TemporaryDirectory() as td:
        bp, ap = _policy_fixture(td)

        router_before = LogicalOperatorRouter(bp, ap)
        before = router_before.select_with_policy("SecurityGate")
        assert before["selected_actor"] == "actor-fit"

        # Demote the primary's risk profile so it is now git_push denied.
        actors = json.loads(ap.read_text())
        actors["actors"]["actor-fit"]["risk_profile"]["git_push"] = "denied"
        # Promote the previously capability-missing actor to satisfy capabilities.
        actors["actors"]["actor-cap-missing"]["capability_profile"]["root_cause_debug"] = 4
        ap.write_text(json.dumps(actors))

        router_after = LogicalOperatorRouter(bp, ap)
        after = router_after.select_with_policy("SecurityGate")

        # Binding order and DAG node are unchanged; only the profile changed.
        assert after["selected_actor"] != before["selected_actor"]
        assert after["selected_actor"] == "actor-cap-missing"
        rejected_ids = {r["actor_id"]: r["reason"] for r in after["rejected_candidates"]}
        assert rejected_ids["actor-fit"].endswith("_denied")
        print("PASS: profile_change_reroutes_without_dag_edit")


if __name__ == "__main__":
    test_all_17_operators()
    test_binding_changes_actor()
    test_fallback_candidate_ordering()
    test_quota_blocked_fallback()
    test_risk_denied_fallback()
    test_all_operators_bound()
    test_policy_reads_operator_constraints_and_selects_fit_actor()
    test_policy_excludes_risk_and_capability_into_rejected()
    test_policy_excludes_reserve_miss()
    test_policy_excludes_quota_reserved()
    test_profile_change_reroutes_without_dag_edit()
    print("\n11/11 passed")
