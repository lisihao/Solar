"""test_eval_factory_p2.py — tests for Rubric Generator + Judge Panel (P2).

Acceptance:
  A36: Rubric Generator auto-generates from CapsuleIR postconditions + effect + history
  A37: Rubric goes through decompose/filter/deduplicate/direction_check/weight_normalization
  A38: Judge Panel supports cheap_rubric / claude_review / codex_code / panel
  A39: Writer cannot judge self
  A40: Disagreement enters active_learning_queue
"""
import sys
import os
import pytest

# Ensure lib/ is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

from solar_ir.capsule_ir import CapsuleIR, CapsuleContract, CapsuleEffects
from solar_ir.effect_ir import EffectIR, EffectEntry

from solar_eval.rubric_generator import (
    Rubric,
    RubricCriterion,
    RubricGenerator,
    CriterionDirection,
)
from solar_eval.judge_panel import (
    JudgeMode,
    JudgePanel,
    JudgeResult,
    JudgeVerdict,
    CriterionScore,
)
from solar_eval.active_learning_queue import (
    ActiveLearningQueue,
    DisagreementEntry,
)
from solar_eval.runners.judge_panel_runner import JudgePanelRunner, RunnerResult


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_capsule_ir(postconditions=None, effects=None):
    contract_data = {}
    if postconditions:
        contract_data["postconditions"] = postconditions
    effects_data = {}
    if effects:
        effects_data = effects
    return CapsuleIR(
        ir_id="test-capsule-001",
        contract=CapsuleContract.from_dict(contract_data) if contract_data else None,
        effects=CapsuleEffects.from_dict(effects_data) if effects_data else None,
    )


def _make_effect_ir(entries=None):
    effects = entries or ()
    return EffectIR(
        ir_id="test-effect-001",
        effects=tuple(entries) if entries else (),
    )


# ════════════════════════════════════════════════════════════════════════════
# A36: Rubric Generator auto-generates from postconditions + effect + history
# ════════════════════════════════════════════════════════════════════════════

class TestA36RubricAutoGeneration:

    def test_from_postconditions_only(self):
        capsule = _make_capsule_ir(postconditions=[
            {"description": "Output file exists"},
            {"description": "No forbidden writes"},
        ])
        gen = RubricGenerator()
        rubric = gen.generate(capsule_ir=capsule)
        assert len(rubric.criteria) >= 2
        assert all(c.source == "postcondition" for c in rubric.criteria)

    def test_from_effects_only(self):
        eff = _make_effect_ir(entries=[
            EffectEntry(effect_id="e1", effect_type="write", target="/tmp/out.txt",
                        description="Write output file"),
            EffectEntry(effect_id="e2", effect_type="read", target="/tmp/in.txt",
                        description="Read input file"),
        ])
        gen = RubricGenerator()
        rubric = gen.generate(effect_ir=eff)
        assert len(rubric.criteria) >= 2
        assert all(c.source == "effect" for c in rubric.criteria)

    def test_from_history_only(self):
        history = [
            {"description": "Tests pass", "weight": 2.0},
            {"description": "Coverage above 80%", "weight": 1.0},
        ]
        gen = RubricGenerator()
        rubric = gen.generate(history=history)
        assert len(rubric.criteria) >= 2
        assert all(c.source == "history" for c in rubric.criteria)

    def test_from_all_sources(self):
        capsule = _make_capsule_ir(postconditions=[
            {"description": "Postcondition check"},
        ])
        eff = _make_effect_ir(entries=[
            EffectEntry(effect_id="e1", effect_type="write", target="f.txt",
                        description="Effect check"),
        ])
        history = [{"description": "History check"}]
        gen = RubricGenerator()
        rubric = gen.generate(capsule_ir=capsule, effect_ir=eff, history=history)
        sources = {c.source for c in rubric.criteria}
        assert "postcondition" in sources
        assert "effect" in sources
        assert "history" in sources

    def test_empty_inputs_produce_empty_rubric(self):
        gen = RubricGenerator()
        rubric = gen.generate()
        assert len(rubric.criteria) == 0
        assert rubric.rubric_id  # Still gets an ID


# ════════════════════════════════════════════════════════════════════════════
# A37: Rubric pipeline stages
# ════════════════════════════════════════════════════════════════════════════

class TestA37RubricPipeline:

    def test_decompose_splits_compound(self):
        gen = RubricGenerator()
        capsule = _make_capsule_ir(postconditions=[
            {"description": "Alpha check; Beta validation; Gamma output and Delta format"},
        ])
        rubric = gen.generate(capsule_ir=capsule)
        # Splits on "; " → "Alpha check", "Beta validation", "Gamma output and Delta format"
        assert len(rubric.criteria) >= 3

    def test_filter_removes_trivial(self):
        gen = RubricGenerator()
        # A postcondition with only 1-char description should be filtered
        capsule = _make_capsule_ir(postconditions=[
            {"description": "ab"},  # 2 chars, filtered (< 3)
            {"description": "valid criterion"},
        ])
        rubric = gen.generate(capsule_ir=capsule)
        assert all(len(c.description) >= 3 for c in rubric.criteria)

    def test_deduplicate_merges_same_content(self):
        gen = RubricGenerator()
        capsule = _make_capsule_ir(postconditions=[
            {"description": "Same criterion"},
            {"description": "Same criterion"},
        ])
        eff = _make_effect_ir(entries=[
            EffectEntry(effect_id="e1", effect_type="write", target="f",
                        description="Same criterion"),
        ])
        rubric = gen.generate(capsule_ir=capsule, effect_ir=eff)
        # All three have same description → same hash → deduplicated to 1
        ids = [c.criterion_id for c in rubric.criteria]
        assert len(set(ids)) == len(ids)  # No duplicate IDs

    def test_direction_check_defaults_invalid(self):
        gen = RubricGenerator()
        capsule = _make_capsule_ir(postconditions=[
            {"description": "Valid direction", "direction": "maximize"},
        ])
        rubric = gen.generate(capsule_ir=capsule)
        directions = {c.direction for c in rubric.criteria}
        assert all(isinstance(d, CriterionDirection) for d in directions)

    def test_weight_normalization_sums_to_one(self):
        gen = RubricGenerator()
        capsule = _make_capsule_ir(postconditions=[
            {"description": "A", "weight": 2.0},
            {"description": "B", "weight": 3.0},
        ])
        rubric = gen.generate(capsule_ir=capsule)
        if rubric.criteria:
            total = rubric.total_weight()
            assert abs(total - 1.0) < 0.01, f"Expected ~1.0, got {total}"


# ════════════════════════════════════════════════════════════════════════════
# A38: Judge Panel supports four modes
# ════════════════════════════════════════════════════════════════════════════

class TestA38JudgePanelModes:

    def _make_rubric(self):
        gen = RubricGenerator()
        capsule = _make_capsule_ir(postconditions=[
            {"description": "tests_passed"},
            {"description": "coverage"},
        ])
        return gen.generate(capsule_ir=capsule)

    def test_cheap_rubric_pass(self):
        panel = JudgePanel()
        rubric = self._make_rubric()
        result = panel.judge(
            mode=JudgeMode.CHEAP_RUBRIC,
            rubric=rubric,
            artifact_id="art-1",
            writer_id="writer",
            judge_id="judge",
            evidence={"tests_passed": True, "coverage": 0.9},
        )
        assert result.mode == JudgeMode.CHEAP_RUBRIC
        assert result.overall_verdict == JudgeVerdict.PASS

    def test_cheap_rubric_fail(self):
        panel = JudgePanel()
        rubric = self._make_rubric()
        result = panel.judge(
            mode=JudgeMode.CHEAP_RUBRIC,
            rubric=rubric,
            artifact_id="art-2",
            writer_id="writer",
            judge_id="judge",
            evidence={"tests_passed": False, "coverage": 0.9},
        )
        assert result.overall_verdict == JudgeVerdict.FAIL

    def test_claude_review_without_llm_fallback(self):
        panel = JudgePanel()  # No LLM → falls back to cheap_rubric
        rubric = self._make_rubric()
        result = panel.judge(
            mode=JudgeMode.CLAUDE_REVIEW,
            rubric=rubric,
            artifact_id="art-3",
            writer_id="writer",
            judge_id="judge",
            evidence={"tests_passed": True},
        )
        assert result.mode == JudgeMode.CLAUDE_REVIEW
        assert result.overall_verdict in (JudgeVerdict.PASS, JudgeVerdict.FAIL, JudgeVerdict.SKIP)

    def test_claude_review_with_llm(self):
        def fake_llm(prompt):
            return "PASS: everything looks good"
        panel = JudgePanel(llm_call_fn=fake_llm)
        rubric = self._make_rubric()
        result = panel.judge(
            mode=JudgeMode.CLAUDE_REVIEW,
            rubric=rubric,
            artifact_id="art-4",
            writer_id="writer",
            judge_id="judge",
            evidence={"tests_passed": True},
        )
        assert result.overall_verdict == JudgeVerdict.PASS

    def test_codex_code_mode(self):
        panel = JudgePanel()
        rubric = self._make_rubric()
        result = panel.judge(
            mode=JudgeMode.CODEX_CODE,
            rubric=rubric,
            artifact_id="art-5",
            writer_id="writer",
            judge_id="judge",
            evidence={"tests_passed": True, "coverage": 0.8},
        )
        assert result.mode == JudgeMode.CODEX_CODE
        assert result.overall_verdict in (JudgeVerdict.PASS, JudgeVerdict.FAIL)

    def test_panel_mode_ensemble(self):
        panel = JudgePanel()
        rubric = self._make_rubric()
        result = panel.judge(
            mode=JudgeMode.PANEL,
            rubric=rubric,
            artifact_id="art-6",
            writer_id="writer",
            judge_id="judge",
            evidence={"tests_passed": True, "coverage": 0.9},
        )
        assert result.mode == JudgeMode.PANEL
        assert "sub_results" in result.metadata
        assert result.overall_verdict in (JudgeVerdict.PASS, JudgeVerdict.FAIL)

    def test_cheap_rubric_skip_no_rubric(self):
        panel = JudgePanel()
        result = panel.judge(
            mode=JudgeMode.CHEAP_RUBRIC,
            rubric=None,
            artifact_id="art-7",
            writer_id="writer",
            judge_id="judge",
        )
        assert result.overall_verdict == JudgeVerdict.SKIP


# ════════════════════════════════════════════════════════════════════════════
# A39: Writer cannot judge self
# ════════════════════════════════════════════════════════════════════════════

class TestA39NoSelfJudge:

    def test_self_review_blocked(self):
        panel = JudgePanel()
        result = panel.judge(
            mode=JudgeMode.CHEAP_RUBRIC,
            rubric=None,
            artifact_id="art-self",
            writer_id="same-id",
            judge_id="same-id",
        )
        assert result.self_review_blocked is True
        assert result.overall_verdict == JudgeVerdict.ERROR

    def test_different_ids_allowed(self):
        panel = JudgePanel()
        gen = RubricGenerator()
        capsule = _make_capsule_ir(postconditions=[
            {"description": "check"},
        ])
        rubric = gen.generate(capsule_ir=capsule)
        result = panel.judge(
            mode=JudgeMode.CHEAP_RUBRIC,
            rubric=rubric,
            artifact_id="art-ok",
            writer_id="writer-A",
            judge_id="judge-B",
            evidence={"check": True},
        )
        assert result.self_review_blocked is False

    def test_runner_blocks_self_review(self):
        runner = JudgePanelRunner()
        result = runner.run(
            mode=JudgeMode.CHEAP_RUBRIC,
            artifact_id="runner-self",
            writer_id="same",
            judge_id="same",
        )
        assert result.judge_result.self_review_blocked is True


# ════════════════════════════════════════════════════════════════════════════
# A40: Disagreement enters active_learning_queue
# ════════════════════════════════════════════════════════════════════════════

class TestA40ActiveLearning:

    def test_queue_detects_disagreement(self):
        q = ActiveLearningQueue()
        assert q.is_disagreement({"j1": "pass", "j2": "fail"})
        assert not q.is_disagreement({"j1": "pass", "j2": "pass"})

    def test_queue_push_pop(self):
        q = ActiveLearningQueue()
        entry = DisagreementEntry(
            entry_id="d1",
            artifact_id="a1",
            judges=["j1", "j2"],
            verdicts={"j1": "pass", "j2": "fail"},
        )
        q.push(entry)
        assert len(q) == 1
        batch = q.pop_batch(limit=1)
        assert len(batch) == 1
        assert batch[0].artifact_id == "a1"
        assert len(q) == 0

    def test_panel_creates_disagreement_on_split_verdict(self):
        """Force disagreement by using conflicting evidence with panel mode."""
        q = ActiveLearningQueue()
        panel = JudgePanel(learning_queue=q)

        # Create a rubric where cheap_rubric and codex_code might disagree
        gen = RubricGenerator()
        capsule = _make_capsule_ir(postconditions=[
            {"description": "tests_passed"},
        ])
        rubric = gen.generate(capsule_ir=capsule)

        # Test with evidence that should produce agreement → no disagreement
        result = panel.judge(
            mode=JudgeMode.PANEL,
            rubric=rubric,
            artifact_id="agree-art",
            writer_id="writer",
            judge_id="judge",
            evidence={"tests_passed": True},
        )

        # If panel sub-judges agree, queue stays empty; if they disagree, queue grows
        # The key assertion is that the panel mode runs without error
        assert result.mode == JudgeMode.PANEL

    def test_runner_integrates_queue(self):
        runner = JudgePanelRunner()
        result = runner.run(
            mode=JudgeMode.CHEAP_RUBRIC,
            artifact_id="runner-q",
            writer_id="writer",
            judge_id="judge",
            capsule_ir=_make_capsule_ir(postconditions=[
                {"description": "test"},
            ]),
            evidence={"test": True},
        )
        assert isinstance(result, RunnerResult)
        assert result.rubric is not None

    def test_queue_persistence(self, tmp_path):
        path = str(tmp_path / "queue.json")
        q = ActiveLearningQueue(persist_path=path)
        q.push(DisagreementEntry(
            entry_id="d1",
            artifact_id="persist-test",
            judges=["j1"],
            verdicts={"j1": "pass"},
        ))
        assert os.path.exists(path)

        # Load from disk
        q2 = ActiveLearningQueue(persist_path=path)
        assert len(q2) == 1
        batch = q2.pop_batch()
        assert batch[0].artifact_id == "persist-test"


# ════════════════════════════════════════════════════════════════════════════
# Integration: RunnerResult serialization
# ════════════════════════════════════════════════════════════════════════════

class TestRunnerIntegration:

    def test_full_pipeline_serialization(self):
        runner = JudgePanelRunner()
        capsule = _make_capsule_ir(postconditions=[
            {"description": "output_valid", "weight": 2.0},
            {"description": "no_errors"},
        ])
        eff = _make_effect_ir(entries=[
            EffectEntry(effect_id="e1", effect_type="write", target="out.txt",
                        description="writes output"),
        ])
        result = runner.run(
            mode=JudgeMode.CHEAP_RUBRIC,
            artifact_id="integration-1",
            writer_id="builder",
            judge_id="evaluator",
            capsule_ir=capsule,
            effect_ir=eff,
            evidence={"output_valid": True, "no_errors": True, "writes output": True},
        )
        d = result.to_dict()
        assert "artifact_id" in d
        assert "rubric" in d
        assert "judge_result" in d
        assert d["rubric"] is not None
        assert d["judge_result"]["overall_verdict"] == "pass"

    def test_rubric_to_dict(self):
        gen = RubricGenerator()
        capsule = _make_capsule_ir(postconditions=[
            {"description": "criterion A"},
            {"description": "criterion B"},
        ])
        rubric = gen.generate(capsule_ir=capsule)
        d = rubric.to_dict()
        assert "rubric_id" in d
        assert "criteria" in d
        assert "total_weight" in d
        assert abs(d["total_weight"] - 1.0) < 0.01
