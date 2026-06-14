"""Tests for PatchToEvidence lowering pass."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from solar_ir.evidence_ir import EvidenceEntry, EvidenceIR
from solar_ir.execution_ir import AttemptEntry, ExecutionIR
from solar_ir.patch_ir import PatchArtifact, PatchFileScope, PatchIR
from solar_lowering import LoweringError
from solar_lowering.patch_to_evidence import PatchToEvidence


def _make_patch(**kwargs) -> PatchIR:
    defaults = dict(
        ir_id="patch-test-001",
        node_id="N5_lowering_evidence",
        sprint_id="sprint-test",
        changed_files=(
            PatchFileScope(
                path="lib/foo.py",
                change_type="modify",
                symbols_modified=("bar",),
                lines_added=10,
                lines_removed=2,
            ),
        ),
        artifacts=(
            PatchArtifact(
                artifact_type="file",
                path="lib/foo.py",
                description="modified file",
            ),
        ),
        tests_required=("test_foo",),
        tests_run=("test_foo",),
        tests_passed=("test_foo",),
        scope_allowed=("lib/foo.py",),
        scope_actual=("lib/foo.py",),
    )
    defaults.update(kwargs)
    return PatchIR(**defaults)


def _make_execution(**kwargs) -> ExecutionIR:
    defaults = dict(
        ir_id="exec-test-001",
        node_id="N5_lowering_evidence",
        state="idle",
        attempt_lineage=(
            AttemptEntry(
                attempt_id="att-001",
                started_at="2026-06-06T00:00:00Z",
                finished_at="2026-06-06T00:01:00Z",
                outcome="success",
            ),
        ),
    )
    defaults.update(kwargs)
    return ExecutionIR(**defaults)


class TestPatchToEvidenceTransform:
    def test_produces_evidence_ir(self):
        evidence = PatchToEvidence().lower(_make_patch())
        assert isinstance(evidence, EvidenceIR)
        assert evidence.ir_type == "evidence"

    def test_metadata_contains_spec_ref(self):
        evidence = PatchToEvidence().lower(_make_patch())
        assert evidence.metadata["spec_ref"] == "N5_lowering_evidence"

    def test_metadata_contains_claims(self):
        evidence = PatchToEvidence().lower(_make_patch())
        claims = evidence.metadata["claims"]
        assert len(claims) == 1
        assert claims[0]["file"] == "lib/foo.py"
        assert claims[0]["change_type"] == "modify"

    def test_metadata_contains_artifacts(self):
        evidence = PatchToEvidence().lower(_make_patch())
        assert "lib/foo.py" in evidence.metadata["artifacts"]

    def test_metadata_contains_tests_run(self):
        evidence = PatchToEvidence().lower(_make_patch())
        assert "test_foo" in evidence.metadata["tests_run"]

    def test_has_test_run_entries(self):
        evidence = PatchToEvidence().lower(_make_patch())
        test_entries = [e for e in evidence.entries if e.evidence_type == "test_run"]
        assert len(test_entries) == 1
        assert test_entries[0].passed is True

    def test_overall_passed_when_all_pass(self):
        evidence = PatchToEvidence().lower(_make_patch())
        assert evidence.overall_passed is True

    def test_overall_not_passed_when_test_fails(self):
        patch = _make_patch(tests_run=("test_foo",), tests_passed=())
        evidence = PatchToEvidence().lower(patch)
        assert evidence.overall_passed is False

    def test_overall_not_passed_when_required_test_not_run(self):
        patch = _make_patch(
            tests_required=("test_foo", "test_bar"),
            tests_run=("test_foo",),
            tests_passed=("test_foo",),
        )
        evidence = PatchToEvidence().lower(patch)
        assert evidence.overall_passed is False

    def test_has_provenance(self):
        evidence = PatchToEvidence().lower(_make_patch())
        assert evidence.provenance is not None
        assert evidence.provenance.owner == "patch_to_evidence"
        assert evidence.provenance.source_ref == "patch-test-001"


class TestPatchToEvidenceWithExecution:
    def test_execution_attempts_become_entries(self):
        evidence = PatchToEvidence().lower_with_execution(
            _make_patch(), _make_execution()
        )
        exec_entries = [
            e for e in evidence.entries if e.description.startswith("Attempt")
        ]
        assert len(exec_entries) == 1
        assert exec_entries[0].passed is True

    def test_failed_attempt_not_passed(self):
        execution = _make_execution(
            attempt_lineage=(
                AttemptEntry(
                    attempt_id="att-002",
                    started_at="2026-06-06T00:00:00Z",
                    finished_at="2026-06-06T00:01:00Z",
                    outcome="failure",
                    error_summary="import error",
                ),
            ),
        )
        evidence = PatchToEvidence().lower_with_execution(_make_patch(), execution)
        exec_entries = [
            e for e in evidence.entries if e.description.startswith("Attempt")
        ]
        assert len(exec_entries) == 1
        assert exec_entries[0].passed is False

    def test_failed_attempt_makes_overall_not_passed(self):
        execution = _make_execution(
            attempt_lineage=(
                AttemptEntry(
                    attempt_id="att-002",
                    started_at="2026-06-06T00:00:00Z",
                    outcome="failure",
                    error_summary="error",
                ),
            ),
        )
        evidence = PatchToEvidence().lower_with_execution(_make_patch(), execution)
        assert evidence.overall_passed is False


class TestPatchToEvidenceScopeViolations:
    def test_scope_violation_produces_entry(self):
        patch = _make_patch(
            scope_allowed=("lib/foo.py",),
            scope_actual=("lib/foo.py", "lib/bar.py"),
            changed_files=(
                PatchFileScope(path="lib/foo.py", change_type="modify"),
                PatchFileScope(path="lib/bar.py", change_type="create"),
            ),
            scope_violations=("out_of_scope:lib/bar.py",),
        )
        evidence = PatchToEvidence().lower(patch)
        scope_entries = [
            e for e in evidence.entries if e.evidence_type == "diff_review"
        ]
        assert len(scope_entries) == 1
        assert scope_entries[0].passed is False

    def test_scope_violation_makes_overall_not_passed(self):
        patch = _make_patch(
            scope_violations=("out_of_scope:lib/bar.py",),
        )
        evidence = PatchToEvidence().lower(patch)
        assert evidence.overall_passed is False


class TestPatchToEvidenceSchemaValidation:
    def test_output_passes_schema_validation(self):
        from solar_ir.validators import validate_evidence

        evidence = PatchToEvidence().lower(_make_patch())
        errors = validate_evidence(evidence.to_dict())
        assert errors == [], errors

    def test_output_with_execution_passes_schema(self):
        from solar_ir.validators import validate_evidence

        evidence = PatchToEvidence().lower_with_execution(
            _make_patch(), _make_execution()
        )
        errors = validate_evidence(evidence.to_dict())
        assert errors == [], errors


class TestPatchToEvidenceRoundtrip:
    def test_roundtrip_to_dict_from_dict(self):
        evidence = PatchToEvidence().lower(_make_patch())
        rebuilt = EvidenceIR.from_dict(evidence.to_dict())
        assert rebuilt.ir_id == evidence.ir_id
        assert rebuilt.overall_passed == evidence.overall_passed
        assert len(rebuilt.entries) == len(evidence.entries)


class TestPatchToEvidenceInputValidation:
    def test_raises_on_empty_ir_id(self):
        patch = _make_patch(ir_id="")
        with pytest.raises(LoweringError) as exc_info:
            PatchToEvidence().lower(patch)
        assert "validate_input" in str(exc_info.value)


class TestPatchToEvidenceEmptyPatch:
    def test_empty_patch_no_entries_means_not_passed(self):
        patch = _make_patch(
            changed_files=(),
            artifacts=(),
            tests_required=(),
            tests_run=(),
            tests_passed=(),
        )
        evidence = PatchToEvidence().lower(patch)
        assert evidence.overall_passed is False
        assert len(evidence.entries) == 0
