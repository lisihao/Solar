"""S05 acceptance: OperatorScore as runtime main ranker + local evidence loop.

Verifies actor_runtime.submit() actually:
- ranks policy-eligible candidates by OperatorScore (not binding order),
- draws HistoricalSuccess from the local task-evidence store,
- writes a full (non-empty-shell) scheduler_decision.score_factors,
- flips selection when local evidence changes.
"""
import json
import tempfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "lib"))

from actor_runtime import ActorRuntime
from evidence_ledger import NoopMaterializer
from task_evidence_store import record_task_outcome


def _write_actor_config(td: str, actors: dict) -> Path:
    actors_dir = Path(td) / "config"
    actors_dir.mkdir(parents=True, exist_ok=True)
    cfg = actors_dir / "agent-actors.json"
    cfg.write_text(json.dumps({"actors": actors}), encoding="utf-8")
    return cfg


def _write_logical_operator_config(td: str, operator_type: str, candidates: list) -> Path:
    cfg = Path(td) / "config" / "logical-operators.json"
    cfg.parent.mkdir(parents=True, exist_ok=True)
    cfg.write_text(
        json.dumps({
            "logical_operators": {
                operator_type: {
                    "operator_type": operator_type,
                    "cost_hint": "low",
                    "effort_hint": "light",
                }
            },
            "bindings": {
                operator_type: {
                    "operator_type": operator_type,
                    "candidates": [{"actor_id": aid} for aid in candidates],
                }
            },
        }),
        encoding="utf-8",
    )
    return cfg


def _two_actor_runtime(td: str) -> ActorRuntime:
    profiles_path = _write_actor_config(td, {
        "actor_a": {
            "actor_id": "actor_a",
            "capability_profile": {"code_impl": 5},
            "risk_profile": {},
            "cost_profile": {"cost_tier": "low", "effort": "light"},
        },
        "actor_b": {
            "actor_id": "actor_b",
            "capability_profile": {"code_impl": 5},
            "risk_profile": {},
            "cost_profile": {"cost_tier": "low", "effort": "light"},
        },
    })
    bindings_path = _write_logical_operator_config(td, "ImplementationWorker", ["actor_a", "actor_b"])
    return ActorRuntime(
        harness_dir=Path(td),
        mailbox_base=Path(td) / "actors",
        profiles_path=profiles_path,
        bindings_path=bindings_path,
        run_materializer=NoopMaterializer(),
    )


def _store(td: str) -> Path:
    return Path(td) / "run" / "task-evidence.jsonl"


def test_scheduler_decision_has_full_score_factors(monkeypatch):
    """score_factors must be a real 7-factor breakdown, not an empty shell."""
    with tempfile.TemporaryDirectory() as td:
        monkeypatch.setenv("HARNESS_DIR", td)
        rt = _two_actor_runtime(td)
        result = rt.submit(
            {"task_id": "t1", "context_policy": "not_required"},
            logical_operator="ImplementationWorker",
            sprint_id="s1",
            node_id="n1",
        )
        assert result.success
        sf = result.scheduler_decision["score_factors"]
        for factor in ("TaskFit", "HistoricalSuccess", "FreshQuota",
                       "LatencyFit", "ContextAffinity", "RiskFit", "CostFit"):
            assert factor in sf, f"missing factor {factor}: {sf}"
        assert sf != {}
    print("PASS: scheduler_decision_has_full_score_factors")


def test_local_evidence_flips_ranking(monkeypatch):
    """Changing local task evidence changes which actor gets selected."""
    with tempfile.TemporaryDirectory() as td:
        monkeypatch.setenv("HARNESS_DIR", td)
        rt = _two_actor_runtime(td)

        # No evidence: binding order → actor_a (first candidate).
        r0 = rt.submit(
            {"task_id": "t0", "context_policy": "not_required"},
            logical_operator="ImplementationWorker",
            sprint_id="s0", node_id="n0",
        )
        assert r0.success
        assert r0.scheduler_decision["selected_actor"] == "actor_a"

        # Give actor_b a strong local success history, actor_a failures.
        store = _store(td)
        for _ in range(5):
            record_task_outcome("actor_b", "success", store_path=store)
            record_task_outcome("actor_a", "failure", store_path=store)

        # Release actor_a lease so both are available again for a fresh submit.
        rt2 = _two_actor_runtime(td)
        r1 = rt2.submit(
            {"task_id": "t2", "context_policy": "not_required"},
            logical_operator="ImplementationWorker",
            sprint_id="s2", node_id="n2",
        )
        assert r1.success
        assert r1.scheduler_decision["selected_actor"] == "actor_b", (
            f"expected actor_b after evidence, got {r1.scheduler_decision['selected_actor']}; "
            f"HistoricalSuccess={r1.scheduler_decision['score_factors'].get('HistoricalSuccess')}"
        )
        assert "actor_a" in [c["actor_id"] for c in r1.rejected_candidates]
    print("PASS: local_evidence_flips_ranking")


def test_ranking_disabled_env_falls_back(monkeypatch):
    """SOLAR_OPERATOR_SCORE_RANKING=0 restores binding-order selection."""
    with tempfile.TemporaryDirectory() as td:
        monkeypatch.setenv("HARNESS_DIR", td)
        monkeypatch.setenv("SOLAR_OPERATOR_SCORE_RANKING", "0")
        store = _store(td)
        for _ in range(5):
            record_task_outcome("actor_b", "success", store_path=store)
            record_task_outcome("actor_a", "failure", store_path=store)
        rt = _two_actor_runtime(td)
        result = rt.submit(
            {"task_id": "t1", "context_policy": "not_required"},
            logical_operator="ImplementationWorker",
            sprint_id="s1", node_id="n1",
        )
        assert result.success
        # Ranking off → binding order wins despite evidence favoring actor_b.
        assert result.scheduler_decision["selected_actor"] == "actor_a"
    print("PASS: ranking_disabled_env_falls_back")


def test_historical_success_differs_by_dimension(monkeypatch):
    """Same actor, different task_type → different HistoricalSuccess reflected."""
    with tempfile.TemporaryDirectory() as td:
        monkeypatch.setenv("HARNESS_DIR", td)
        store = _store(td)
        # actor_a good at CODE_IMPL, bad at ARCH_DESIGN.
        for _ in range(4):
            record_task_outcome("actor_a", "success", task_type="CODE_IMPL", store_path=store)
            record_task_outcome("actor_a", "failure", task_type="ARCH_DESIGN", store_path=store)

        rt = _two_actor_runtime(td)
        r_code = rt.submit(
            {"task_id": "tc", "context_policy": "not_required", "task_type": "CODE_IMPL"},
            logical_operator="ImplementationWorker", sprint_id="sc", node_id="nc",
        )
        rt2 = _two_actor_runtime(td)
        r_arch = rt2.submit(
            {"task_id": "ta", "context_policy": "not_required", "task_type": "ARCH_DESIGN"},
            logical_operator="ImplementationWorker", sprint_id="sa", node_id="na",
        )
        hs_code = r_code.scheduler_decision["score_factors"]["HistoricalSuccess"]
        hs_arch = r_arch.scheduler_decision["score_factors"]["HistoricalSuccess"]
        # Only meaningful when actor_a was the selected actor in at least one.
        assert hs_code != hs_arch or (
            r_code.scheduler_decision["selected_actor"]
            != r_arch.scheduler_decision["selected_actor"]
        )
    print("PASS: historical_success_differs_by_dimension")


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))
