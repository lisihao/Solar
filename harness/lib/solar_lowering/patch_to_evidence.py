"""patch_to_evidence — lowering pass: PatchIR [+ ExecutionIR] → EvidenceIR."""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from solar_ir.evidence_ir import EvidenceEntry, EvidenceIR
from solar_ir.execution_ir import ExecutionIR
from solar_ir.patch_ir import PatchIR
from solar_ir.provenance import Provenance
from solar_ir.validators import validate_evidence, validate_patch

from .lowering_base import LoweringBase


def _build_test_entries(patch: PatchIR) -> List[EvidenceEntry]:
    entries: List[EvidenceEntry] = []
    passed_set = set(patch.tests_passed)
    for test_name in patch.tests_run:
        passed = test_name in passed_set
        entries.append(
            EvidenceEntry(
                evidence_id=f"ev-test-{uuid.uuid4().hex[:8]}",
                evidence_type="test_run",
                description=f"Test: {test_name}",
                command=test_name,
                passed=passed,
                result_summary="passed" if passed else "failed",
            )
        )
    return entries


def _build_scope_entries(patch: PatchIR) -> List[EvidenceEntry]:
    violations = patch.scope_violations or patch.check_scope()
    if not violations:
        return []
    return [
        EvidenceEntry(
            evidence_id=f"ev-scope-{uuid.uuid4().hex[:8]}",
            evidence_type="diff_review",
            description=f"Scope violations: {len(violations)}",
            passed=False,
            result_summary="; ".join(violations),
        )
    ]


def _build_artifact_entries(patch: PatchIR) -> List[EvidenceEntry]:
    entries: List[EvidenceEntry] = []
    for art in patch.artifacts:
        entries.append(
            EvidenceEntry(
                evidence_id=f"ev-art-{uuid.uuid4().hex[:8]}",
                evidence_type="command_output",
                description=f"Artifact: {art.artifact_type} — {art.path}",
                passed=True,
                artifacts=(art.path,),
            )
        )
    return entries


def _build_execution_entries(execution: ExecutionIR) -> List[EvidenceEntry]:
    entries: List[EvidenceEntry] = []
    for attempt in execution.attempt_lineage:
        entries.append(
            EvidenceEntry(
                evidence_id=f"ev-exec-{uuid.uuid4().hex[:8]}",
                evidence_type="command_output",
                description=f"Attempt {attempt.attempt_id}",
                command=attempt.outcome or "running",
                passed=attempt.outcome == "success",
                result_summary=attempt.error_summary or "",
            )
        )
    return entries


def _build_metadata(patch: PatchIR) -> Dict[str, Any]:
    metadata: Dict[str, Any] = {}
    if patch.node_id:
        metadata["spec_ref"] = patch.node_id
    metadata["tests_run"] = list(patch.tests_run)
    metadata["artifacts"] = [a.path for a in patch.artifacts]
    metadata["claims"] = [
        {"file": f.path, "change_type": f.change_type}
        for f in patch.changed_files
    ]
    if patch.sprint_id:
        metadata["sprint_id"] = patch.sprint_id
    if patch.metadata:
        metadata["patch_metadata"] = dict(patch.metadata)
    return metadata


class PatchToEvidence(LoweringBase[PatchIR, EvidenceIR]):
    """Compile PatchIR [+ ExecutionIR] into EvidenceIR.

    Mapping rules
    -------------
    - entries.test_run      ← PatchIR.tests_run / tests_passed
    - entries.diff_review   ← PatchIR scope violations
    - entries.command_output← PatchIR artifacts + ExecutionIR attempts
    - overall_passed        ← all entries passed AND all required tests ran
    - metadata.spec_ref     ← PatchIR.node_id
    - metadata.claims       ← PatchIR.changed_files (file, change_type)
    - metadata.artifacts    ← PatchIR.artifacts paths
    - metadata.tests_run    ← PatchIR.tests_run list
    - provenance            ← owner="patch_to_evidence", source_ref=patch.ir_id
    """

    name = "patch_to_evidence"

    def __init__(self, execution: Optional[ExecutionIR] = None) -> None:
        self._execution = execution

    def validate_input(self, ir: PatchIR) -> List[str]:
        errors = validate_patch(ir.to_dict())
        if not ir.ir_id:
            errors.append("ir_id must be non-empty")
        return errors

    def transform(self, patch: PatchIR) -> EvidenceIR:
        entries: List[EvidenceEntry] = []
        entries.extend(_build_test_entries(patch))
        entries.extend(_build_scope_entries(patch))
        entries.extend(_build_artifact_entries(patch))

        if self._execution is not None:
            entries.extend(_build_execution_entries(self._execution))

        overall_passed = all(e.passed for e in entries) if entries else False

        # If there are required tests that weren't run, overall is not passed
        required_set = set(patch.tests_required)
        run_set = set(patch.tests_run)
        if required_set and not required_set.issubset(run_set):
            overall_passed = False

        metadata = _build_metadata(patch)
        provenance = Provenance(
            owner="patch_to_evidence",
            source_ref=patch.ir_id,
        )

        return EvidenceIR(
            ir_id=f"evidence-{uuid.uuid4().hex[:12]}",
            entries=tuple(entries),
            overall_passed=overall_passed,
            metadata=metadata,
            provenance=provenance,
        )

    def validate_output(self, ir: EvidenceIR) -> List[str]:
        errors = validate_evidence(ir.to_dict())
        return errors

    def lower_with_execution(
        self, patch: PatchIR, execution: ExecutionIR
    ) -> EvidenceIR:
        """Lower with both PatchIR and ExecutionIR context."""
        self._execution = execution
        return self.lower(patch)
