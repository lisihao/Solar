"""evidence_ir.py — Evidence IR dataclass and validator."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .provenance import Provenance

SCHEMA_VERSION = "solar.evidence_ir.v1"
VERDICT_OPTIONS = ("PASS", "FAIL", "SKIP")


@dataclass(frozen=True)
class EvidenceClaim:
    claim_id: str = ""
    text: str = ""
    kind: str = ""
    evidence_refs: tuple[str, ...] = ()
    falsifiable: bool = True

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"claim_id": self.claim_id, "text": self.text}
        if self.kind:
            d["kind"] = self.kind
        if self.evidence_refs:
            d["evidence_refs"] = list(self.evidence_refs)
        d["falsifiable"] = self.falsifiable
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EvidenceClaim:
        return cls(
            claim_id=str(data.get("claim_id") or ""),
            text=str(data.get("text") or ""),
            kind=str(data.get("kind") or ""),
            evidence_refs=tuple(data.get("evidence_refs") or []),
            falsifiable=bool(data.get("falsifiable", True)),
        )


@dataclass(frozen=True)
class EvidenceItem:
    evidence_id: str = ""
    kind: str = ""
    artifact_path: str = ""
    verified: bool = False

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"evidence_id": self.evidence_id, "kind": self.kind, "artifact_path": self.artifact_path}
        d["verified"] = self.verified
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EvidenceItem:
        return cls(
            evidence_id=str(data.get("evidence_id") or ""),
            kind=str(data.get("kind") or ""),
            artifact_path=str(data.get("artifact_path") or ""),
            verified=bool(data.get("verified", False)),
        )


@dataclass(frozen=True)
class TestRun:
    command: str = ""
    exit_code: int = 1
    output_summary: str = ""

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"command": self.command, "exit_code": self.exit_code}
        if self.output_summary:
            d["output_summary"] = self.output_summary
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TestRun:
        return cls(
            command=str(data.get("command") or ""),
            exit_code=int(data.get("exit_code") or 1),
            output_summary=str(data.get("output_summary") or ""),
        )


@dataclass(frozen=True)
class VerifierDecision:
    verifier_id: str = ""
    verdict: str = "SKIP"
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"verifier_id": self.verifier_id, "verdict": self.verdict}
        if self.reason:
            d["reason"] = self.reason
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> VerifierDecision:
        return cls(
            verifier_id=str(data.get("verifier_id") or ""),
            verdict=str(data.get("verdict") or "SKIP"),
            reason=str(data.get("reason") or ""),
        )


@dataclass(frozen=True)
class EvidenceIR:
    evidence_id: str = ""
    spec_ref: str = ""
    capsule_ref: str = ""
    claims: tuple[EvidenceClaim, ...] = ()
    evidence: tuple[EvidenceItem, ...] = ()
    artifacts: tuple[str, ...] = ()
    approvals: tuple[str, ...] = ()
    tests_run: tuple[TestRun, ...] = ()
    verifier_decisions: tuple[VerifierDecision, ...] = ()
    provenance: Provenance = field(default_factory=Provenance, hash=False)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "evidence_id": self.evidence_id,
            "claims": [c.to_dict() for c in self.claims],
        }
        if self.spec_ref:
            d["spec_ref"] = self.spec_ref
        if self.capsule_ref:
            d["capsule_ref"] = self.capsule_ref
        if self.evidence:
            d["evidence"] = [e.to_dict() for e in self.evidence]
        if self.artifacts:
            d["artifacts"] = list(self.artifacts)
        if self.approvals:
            d["approvals"] = list(self.approvals)
        if self.tests_run:
            d["tests_run"] = [t.to_dict() for t in self.tests_run]
        if self.verifier_decisions:
            d["verifier_decisions"] = [v.to_dict() for v in self.verifier_decisions]
        prov = self.provenance.to_dict()
        if prov:
            d["provenance"] = prov
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EvidenceIR:
        prov_data = data.get("provenance") if isinstance(data.get("provenance"), dict) else {}
        return cls(
            evidence_id=str(data.get("evidence_id") or ""),
            spec_ref=str(data.get("spec_ref") or ""),
            capsule_ref=str(data.get("capsule_ref") or ""),
            claims=tuple(EvidenceClaim.from_dict(c) for c in (data.get("claims") or []) if isinstance(c, dict)),
            evidence=tuple(EvidenceItem.from_dict(e) for e in (data.get("evidence") or []) if isinstance(e, dict)),
            artifacts=tuple(data.get("artifacts") or []),
            approvals=tuple(data.get("approvals") or []),
            tests_run=tuple(TestRun.from_dict(t) for t in (data.get("tests_run") or []) if isinstance(t, dict)),
            verifier_decisions=tuple(VerifierDecision.from_dict(v) for v in (data.get("verifier_decisions") or []) if isinstance(v, dict)),
            provenance=Provenance(**{k: v for k, v in prov_data.items() if k in ("owner", "created_at", "source_ref")}),
        )


def validate_evidence_ir(ir: EvidenceIR) -> dict[str, Any]:
    errors: list[str] = []
    if not ir.evidence_id:
        errors.append("evidence_id_required")
    if not ir.claims:
        errors.append("claims_required")
    for claim in ir.claims:
        if not claim.claim_id:
            errors.append("claim_missing_id")
    for vd in ir.verifier_decisions:
        if vd.verdict not in VERDICT_OPTIONS:
            errors.append(f"invalid_verdict:{vd.verdict}")
    return {"ok": not errors, "errors": errors, "schema_version": SCHEMA_VERSION}
