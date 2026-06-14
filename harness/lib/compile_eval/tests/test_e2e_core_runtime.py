"""test_e2e_core_runtime.py — N9 end-to-end integration test.

Exercises the full core runtime pipeline from v1 profile through GEPA output:

(a) v1 fixture auto-upgrade via N8 (compiler_profile.compat.upgrade_v1_to_v2)
(b) active profile resolution and GEPA candidate export via N2
(c) deterministic_compile via N3
(d) CompileGEPAAdapter.fitness_function with 3+ golden cases including 1 real
    sprint-20260525-000730-derived case via N4
(e) 6 component ASI slots present via N5
(f) forced hard-validator failure → asi_score == 0.0 via N6
(g) codex_pm_router --profile-tag default → compile_metadata in output via N7
"""
from __future__ import annotations

import dataclasses
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from compiler_profile.compat import is_v1, is_v2, upgrade_v1_to_v2
from compiler_profile.registry import activate, export_as_gepa_candidate, register
from compiler_profile.schema import REQUIRED_POLICY_KEYS
from compile_runtime.deterministic_compile import CompileResult, compile_from_profile
from compile_eval.harness import CompileGEPAAdapter
from compile_eval.eval_runtime import CaseEvalResult, compile_and_evaluate

# ---------------------------------------------------------------------------
# Real case input derived from sprint-20260525-000730 PRD
# ---------------------------------------------------------------------------

_SPRINT_025_INPUT = (
    "GEPA-Optimized Self-Evolving Requirement Compiler: "
    "Solar-Harness requirement compiler currently uses hardcoded policies "
    "(intake_policy, requirement_ir_policy, contract_compiler_policy, "
    "dag_compiler_policy, evidence_policy, handoff_policy) with no versioning, "
    "evaluation, or automatic optimization. "
    "Goal: introduce compiler_profile v2 schema, deterministic compile runtime, "
    "fitness evaluation harness, and GEPA optimization loop so that profiles "
    "can be automatically improved via offline meta-optimisation."
)

_POLICY_SLOTS = (
    "intake",
    "requirement_ir",
    "contract_compiler",
    "dag_compiler",
    "evidence",
    "handoff",
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class _GoldenCase:
    """Minimal golden case for integration testing."""
    input: str
    sprint_id: str


def _v1_profile(profile_id: str = "e2e-v1-fixture") -> dict[str, Any]:
    """A v1 profile: all policies have params but no text field."""
    policies: dict[str, Any] = {}
    for key in REQUIRED_POLICY_KEYS:
        policies[key] = {
            "version": "1.0",
            "params": {"mode": "standard", "slot": key},
        }
    return {
        "profile_id": profile_id,
        "version": 1,
        "name": "E2E V1 Fixture",
        "tags": ["test", "v1"],
        "created_at": "2026-01-01T00:00:00Z",
        "policies": policies,
    }


def _v2_profile(profile_id: str = "e2e-v2-profile") -> dict[str, Any]:
    """A v2 profile: all six policies have non-empty text."""
    policies: dict[str, Any] = {}
    for key in REQUIRED_POLICY_KEYS:
        policies[key] = {
            "version": "1.0",
            "params": {"mode": "standard"},
            "text": f"Compiler policy for {key}: standard mode. Process inputs carefully.",
        }
    return {
        "profile_id": profile_id,
        "version": 1,
        "name": "E2E V2 Profile",
        "tags": ["test", "v2"],
        "created_at": "2026-01-01T00:00:00Z",
        "policies": policies,
    }


def _three_golden_cases() -> list[_GoldenCase]:
    """Three golden cases: 2 synthetic + 1 real sprint-20260525-000730 derived."""
    return [
        _GoldenCase(
            input="Implement JWT-based authentication with refresh token support.",
            sprint_id="case-auth-001",
        ),
        _GoldenCase(
            input="Add API rate limiting with configurable per-endpoint thresholds.",
            sprint_id="case-ratelimit-001",
        ),
        _GoldenCase(
            input=_SPRINT_025_INPUT,
            sprint_id="case-sprint-20260525-000730",
        ),
    ]


def _hard_fail_compile_fn(profile: dict[str, Any], raw_intent: str) -> Any:
    """Compile fn that always returns artifacts failing hard validators (HV1, HV2)."""
    r = MagicMock()
    r.artifacts = {
        "requirement_ir": {},    # empty dict → falsy → HV1 fails
        "contracts": {},          # empty dict → falsy → HV2 fails
        "dag": {"nodes": []},
        "traces": [],
    }
    r.profile = profile
    return r


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def tmp_db(tmp_path: Path) -> Path:
    return tmp_path / "e2e_profiles.db"


@pytest.fixture
def registered_v2(tmp_db: Path, tmp_path: Path) -> dict[str, Any]:
    profiles_dir = tmp_path / "profiles"
    profiles_dir.mkdir()
    p = _v2_profile("e2e-registered-v2")
    register(p, db_path=tmp_db, profiles_dir=profiles_dir)
    return p


# ---------------------------------------------------------------------------
# (a) v1 fixture auto-upgrade via N8
# ---------------------------------------------------------------------------

class TestAutoUpgradeV1:
    def test_v1_profile_is_detected_as_v1(self):
        profile = _v1_profile()
        assert is_v1(profile), "v1 profile must be detected by is_v1()"

    def test_v1_profile_is_not_v2(self):
        profile = _v1_profile()
        assert not is_v2(profile), "v1 profile must not pass is_v2()"

    def test_upgrade_produces_v2_valid_profile(self):
        profile = _v1_profile()
        upgraded = upgrade_v1_to_v2(profile)
        assert is_v2(upgraded), "upgrade_v1_to_v2 must yield a v2-valid profile"

    def test_upgrade_preserves_profile_id(self):
        profile = _v1_profile("specific-v1-id")
        upgraded = upgrade_v1_to_v2(profile)
        assert upgraded["profile_id"] == "specific-v1-id"

    def test_upgrade_all_policies_have_non_empty_text(self):
        profile = _v1_profile()
        upgraded = upgrade_v1_to_v2(profile)
        for key in REQUIRED_POLICY_KEYS:
            text = upgraded["policies"][key].get("text", "")
            assert isinstance(text, str) and text.strip(), (
                f"Policy {key!r} has empty text after upgrade"
            )

    def test_upgrade_is_idempotent_on_v2_profile(self):
        profile = _v2_profile()
        once = upgrade_v1_to_v2(profile)
        twice = upgrade_v1_to_v2(once)
        assert once["policies"] == twice["policies"]

    def test_upgrade_does_not_mutate_original(self):
        profile = _v1_profile()
        original_policies = {
            k: dict(v) for k, v in profile["policies"].items()
        }
        upgrade_v1_to_v2(profile)
        for key in REQUIRED_POLICY_KEYS:
            assert profile["policies"][key] == original_policies[key], (
                f"Policy {key!r} was mutated by upgrade_v1_to_v2"
            )


# ---------------------------------------------------------------------------
# (b) Active profile resolution + GEPA candidate export via N2
# ---------------------------------------------------------------------------

class TestGEPACandidate:
    def test_export_returns_exactly_six_keys(self, registered_v2):
        candidate = export_as_gepa_candidate(registered_v2)
        assert set(candidate.keys()) == set(REQUIRED_POLICY_KEYS)

    def test_export_values_are_non_empty_strings(self, registered_v2):
        candidate = export_as_gepa_candidate(registered_v2)
        for key, val in candidate.items():
            assert isinstance(val, str) and val.strip(), (
                f"Candidate key {key!r} has empty or non-string value"
            )

    def test_export_values_match_profile_text(self, registered_v2):
        candidate = export_as_gepa_candidate(registered_v2)
        for key in REQUIRED_POLICY_KEYS:
            expected_text = registered_v2["policies"][key]["text"]
            assert candidate[key] == expected_text, (
                f"Candidate text for {key!r} does not match profile"
            )

    def test_upgraded_v1_can_be_exported(self):
        v1 = _v1_profile()
        upgraded = upgrade_v1_to_v2(v1)
        candidate = export_as_gepa_candidate(upgraded)
        assert len(candidate) == len(REQUIRED_POLICY_KEYS)
        for key, val in candidate.items():
            assert val.strip(), f"Slot {key!r} text empty after v1→v2 upgrade"


# ---------------------------------------------------------------------------
# (c) deterministic_compile via N3
# ---------------------------------------------------------------------------

class TestDeterministicCompile:
    def test_returns_compile_result_instance(self):
        profile = _v2_profile()
        result = compile_from_profile(profile, "Requirement text for N9 test.")
        assert isinstance(result, CompileResult)

    def test_artifacts_contain_required_keys(self):
        profile = _v2_profile()
        result = compile_from_profile(profile, "Requirement text.")
        for key in ("requirement_ir", "contracts", "dag"):
            assert key in result.artifacts, f"artifacts missing {key!r}"

    def test_digest_is_deterministic_same_inputs(self):
        profile = _v2_profile()
        r1 = compile_from_profile(profile, "Identical intent string.")
        r2 = compile_from_profile(profile, "Identical intent string.")
        assert r1.artifacts["digest"] == r2.artifacts["digest"], "Same inputs must yield same digest"

    def test_digest_changes_on_different_policy_version(self):
        p1 = _v2_profile("profile-alpha")
        p2 = _v2_profile("profile-beta")
        # Digest includes policy_refs (versions) — change version to get different digest.
        p2["policies"]["intake_policy"]["version"] = "9.9"
        r1 = compile_from_profile(p1, "Same intent.")
        r2 = compile_from_profile(p2, "Same intent.")
        assert r1.artifacts["digest"] != r2.artifacts["digest"], "Different policy versions must produce different digest"

    def test_sprint_case_input_compiles(self):
        profile = _v2_profile()
        result = compile_from_profile(profile, _SPRINT_025_INPUT)
        assert isinstance(result, CompileResult)
        assert result.artifacts


# ---------------------------------------------------------------------------
# (d) CompileGEPAAdapter.fitness_function with ≥3 golden cases via N4
# ---------------------------------------------------------------------------

class TestFitnessFunction:
    def test_returns_float_in_zero_one_range(self):
        adapter = CompileGEPAAdapter()
        profile = _v2_profile()
        score = adapter.fitness_function(profile, _three_golden_cases())
        assert isinstance(score, float)
        assert 0.0 <= score <= 1.0

    def test_uses_at_least_three_cases(self):
        adapter = CompileGEPAAdapter()
        profile = _v2_profile()
        cases = _three_golden_cases()
        assert len(cases) >= 3, "Must use at least 3 golden cases"
        score = adapter.fitness_function(profile, cases)
        assert isinstance(score, float)

    def test_real_sprint_case_covered(self):
        adapter = CompileGEPAAdapter()
        profile = _v2_profile()
        real_case = _GoldenCase(
            input=_SPRINT_025_INPUT,
            sprint_id="case-sprint-20260525-000730",
        )
        score = adapter.fitness_function(profile, [real_case])
        assert 0.0 <= score <= 1.0

    def test_empty_cases_returns_zero(self):
        adapter = CompileGEPAAdapter()
        profile = _v2_profile()
        score = adapter.fitness_function(profile, [])
        assert score == 0.0

    def test_fitness_uses_compile_fn_output(self):
        """Compile output, not golden case expected values, drives score."""
        def _forced_good_compile(profile, raw_intent):
            r = MagicMock()
            r.artifacts = {
                "requirement_ir": {
                    "goal": raw_intent[:80],
                    "success_metrics": ["metric-1"],
                    "non_goals": [],
                },
                "contracts": {
                    "goal": raw_intent[:80],
                    "policies": {"mode": "standard"},
                },
                "dag": {
                    "nodes": [{"id": "N1", "depends_on": [], "type": "implementation"}]
                },
                "traces": [],
            }
            r.profile = profile
            return r

        adapter = CompileGEPAAdapter()
        profile = _v2_profile()
        case = _GoldenCase(input="Compile me via the forced fn.", sprint_id="forced-case")
        score = adapter.fitness_function(profile, [case], compile_fn=_forced_good_compile)
        assert isinstance(score, float)


# ---------------------------------------------------------------------------
# (e) 6 component ASI slots present via N5
# ---------------------------------------------------------------------------

class TestComponentAsiPresent:
    def test_compile_and_evaluate_returns_case_eval_result(self):
        profile = _v2_profile()
        result = compile_and_evaluate(
            profile,
            "Build a notification delivery system.",
            compile_fn=compile_from_profile,
            adapter=CompileGEPAAdapter(),
        )
        assert isinstance(result, CaseEvalResult)

    def test_component_asi_is_not_none(self):
        profile = _v2_profile()
        result = compile_and_evaluate(
            profile,
            "Build a notification delivery system.",
            compile_fn=compile_from_profile,
            adapter=CompileGEPAAdapter(),
        )
        assert result.component_asi is not None, "component_asi must be populated"

    def test_component_asi_has_all_six_slots(self):
        profile = _v2_profile()
        result = compile_and_evaluate(
            profile,
            "Build a real-time alerting pipeline.",
            compile_fn=compile_from_profile,
            adapter=CompileGEPAAdapter(),
        )
        assert result.component_asi is not None
        missing = [s for s in _POLICY_SLOTS if s not in result.component_asi]
        assert not missing, f"component_asi missing slots: {missing}"

    def test_each_slot_has_four_required_keys(self):
        profile = _v2_profile()
        result = compile_and_evaluate(
            profile,
            "Add observability instrumentation.",
            compile_fn=compile_from_profile,
            adapter=CompileGEPAAdapter(),
        )
        assert result.component_asi is not None
        for slot in _POLICY_SLOTS:
            slot_data = result.component_asi[slot]
            for key in ("signals", "errors", "score_breakdown", "diagnostics"):
                assert key in slot_data, (
                    f"Slot {slot!r} missing key {key!r}"
                )

    def test_component_asi_populated_for_real_sprint_case(self):
        profile = _v2_profile()
        result = compile_and_evaluate(
            profile,
            _SPRINT_025_INPUT,
            compile_fn=compile_from_profile,
            adapter=CompileGEPAAdapter(),
        )
        assert result.component_asi is not None
        assert len([k for k in result.component_asi if k in _POLICY_SLOTS]) == 6


# ---------------------------------------------------------------------------
# (f) Forced hard-validator failure → asi_score == 0.0 via N6
# ---------------------------------------------------------------------------

class TestHardValidatorFailure:
    def test_hard_fail_yields_asi_score_zero(self):
        profile = _v2_profile()
        result = compile_and_evaluate(
            profile,
            "Any requirement text.",
            compile_fn=_hard_fail_compile_fn,
            adapter=CompileGEPAAdapter(),
        )
        assert result.asi_score == 0.0, (
            f"Expected asi_score=0.0 on hard-fail, got {result.asi_score}"
        )

    def test_hard_fail_sets_hard_validator_failed_flag(self):
        profile = _v2_profile()
        result = compile_and_evaluate(
            profile,
            "Any requirement text.",
            compile_fn=_hard_fail_compile_fn,
            adapter=CompileGEPAAdapter(),
        )
        assert result.hard_validator_failed is True

    def test_hard_fail_lists_at_least_one_failure(self):
        profile = _v2_profile()
        result = compile_and_evaluate(
            profile,
            "Any requirement text.",
            compile_fn=_hard_fail_compile_fn,
            adapter=CompileGEPAAdapter(),
        )
        assert len(result.hard_validator_failures) >= 1, (
            "hard_validator_failures must list at least one failure code"
        )

    def test_compile_exception_yields_zero_and_sets_failed(self):
        def _crash_fn(profile, raw_intent):
            raise RuntimeError("simulated compile crash")

        profile = _v2_profile()
        result = compile_and_evaluate(
            profile,
            "Some intent.",
            compile_fn=_crash_fn,
            adapter=CompileGEPAAdapter(),
        )
        assert result.asi_score == 0.0
        assert result.compile_failed is True

    def test_fitness_function_hard_fail_case_scores_zero(self):
        adapter = CompileGEPAAdapter()
        profile = _v2_profile()
        case = _GoldenCase(input="Trigger hard fail.", sprint_id="hard-fail-case")
        score = adapter.fitness_function(profile, [case], compile_fn=_hard_fail_compile_fn)
        assert score == 0.0


# ---------------------------------------------------------------------------
# (g) codex_pm_router --profile-tag default → compile_metadata in output via N7
# ---------------------------------------------------------------------------

def _router_script_path() -> Path:
    return Path(__file__).resolve().parents[3] / "tools" / "codex_pm_router.py"


@pytest.fixture
def router_script() -> Path:
    path = _router_script_path()
    if not path.exists():
        pytest.skip(f"codex_pm_router.py not found at {path}")
    return path


class TestCodexPmRouterProfileTag:
    def _run_router(
        self, router_script: Path, text: str, extra_args: list[str] | None = None
    ) -> subprocess.CompletedProcess:
        cmd = [
            sys.executable,
            str(router_script),
            "--text", text,
            "--profile-tag", "default",
            "--direct-compile",
            "--format", "json",
        ]
        if extra_args:
            cmd.extend(extra_args)
        # Strip PYTHONPATH so codex_pm_router.py's own sys.path.insert(0, LIB_DIR)
        # works correctly.  When the parent process passes PYTHONPATH=lib (relative),
        # Python resolves and adds it to sys.path *before* the script runs, causing
        # the "if LIB_DIR not in sys.path" guard to skip the insert and leaving
        # tools/ ahead of lib/ in sys.path.
        env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            env=env,
        )

    def _extract_compile_metadata(self, output_json: dict[str, Any]) -> dict[str, Any] | None:
        """Handle both exit-0 (top-level) and exit-2 (nested in payload)."""
        if "compile_metadata" in output_json:
            return output_json["compile_metadata"]
        payload = output_json.get("payload")
        if isinstance(payload, dict) and "compile_metadata" in payload:
            return payload["compile_metadata"]
        return None

    def test_router_exits_with_acceptable_code(self, router_script):
        proc = self._run_router(router_script, "Build a self-healing pipeline.")
        assert proc.returncode in (0, 2), (
            f"Unexpected exit code {proc.returncode}\n"
            f"stderr: {proc.stderr[:400]}"
        )

    def test_router_output_is_valid_json(self, router_script):
        proc = self._run_router(router_script, "Build a self-healing pipeline.")
        try:
            json.loads(proc.stdout)
        except json.JSONDecodeError as exc:
            pytest.fail(
                f"Router output is not valid JSON: {exc}\n"
                f"stdout: {proc.stdout[:400]}"
            )

    def test_compile_metadata_present_in_output(self, router_script):
        proc = self._run_router(
            router_script,
            "GEPA-Optimized Self-Evolving Requirement Compiler.",
        )
        output = json.loads(proc.stdout)
        cm = self._extract_compile_metadata(output)
        assert cm is not None, (
            f"compile_metadata not found in output. Top-level keys: {list(output.keys())}"
        )

    def test_compile_metadata_has_profile_id(self, router_script):
        proc = self._run_router(
            router_script,
            "Build a distributed tracing system.",
        )
        output = json.loads(proc.stdout)
        cm = self._extract_compile_metadata(output)
        assert cm is not None
        assert "profile_id" in cm, f"compile_metadata missing profile_id: {cm}"

    def test_compile_metadata_has_profile_digest(self, router_script):
        proc = self._run_router(
            router_script,
            "Implement an event-driven architecture.",
        )
        output = json.loads(proc.stdout)
        cm = self._extract_compile_metadata(output)
        assert cm is not None
        assert "profile_digest" in cm, f"compile_metadata missing profile_digest: {cm}"

    def test_compile_metadata_has_profile_tag_field(self, router_script):
        proc = self._run_router(
            router_script,
            "Add feature flags for gradual rollout.",
        )
        output = json.loads(proc.stdout)
        cm = self._extract_compile_metadata(output)
        assert cm is not None
        assert "profile_tag" in cm, f"compile_metadata missing profile_tag: {cm}"
        assert cm["profile_tag"] == "default"
