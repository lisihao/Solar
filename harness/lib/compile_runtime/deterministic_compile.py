"""deterministic_compile.py — Pure-function requirement compilation.

compile_from_profile(profile, raw_intent, *, sprint_id=None) → CompileResult

Given the same (profile, raw_intent) pair the function always produces
artifacts whose canonical digest is identical (pure function guarantee).
No timestamps, random IDs, or external I/O inside the artifacts path.
"""
from __future__ import annotations

import dataclasses
import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Optional

from compiler_profile.schema import REQUIRED_POLICY_KEYS, SCHEMA_VERSION, compute_digest

from .metadata import CompileMetadata


__all__ = [
    "CompileResult",
    "compile_from_profile",
]


# ---------------------------------------------------------------------------
# CompileResult
# ---------------------------------------------------------------------------

@dataclasses.dataclass(frozen=True)
class CompileResult:
    """Output of a single deterministic compilation.

    Attributes
    ----------
    artifacts : dict
        The compiled artifacts dict.  ``artifacts['digest']`` is the
        sha256 of the canonical JSON of all content fields.
    metadata : CompileMetadata
        Provenance record for this compilation.
    traces : list[dict]
        Ordered list of trace entries produced during compilation.
    """

    artifacts: dict[str, Any]
    metadata: CompileMetadata
    traces: list[dict[str, Any]]


# ---------------------------------------------------------------------------
# Internal helpers (pure)
# ---------------------------------------------------------------------------

def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False)


def _build_requirement_ir(raw_intent: str, sprint_id: Optional[str]) -> dict[str, Any]:
    """Build a deterministic requirement IR from *raw_intent*."""
    intent_hash = _sha256(raw_intent)
    goal = raw_intent.strip().splitlines()[0][:256] if raw_intent.strip() else "No intent provided"
    return {
        "schema_version": "solar.requirement_ir.v1",
        "id": f"IR-{intent_hash[:12]}",
        "sprint_id": sprint_id or "",
        "goal": goal,
        "success_metrics": [
            "Compilation completes without hard validator failures.",
        ],
        "non_goals": [],
        "normalized_goal": goal,
        "user_intent": raw_intent.strip(),
        "requirements": [
            {
                "id": "REQ-001",
                "source_text": goal,
                "success_criteria": [goal],
                "verification_method": "task_graph_closeout",
                "priority": "P1",
            }
        ],
    }


def _build_contracts(requirement_ir: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    """Build contracts from IR, passing the profile's contract policy params through."""
    contract_policy = (profile.get("policies") or {}).get("contract_compiler_policy") or {}
    policy_params = contract_policy.get("params") or {}
    return {
        "schema_version": "solar.contracts.v1",
        "goal": requirement_ir["goal"],
        "policies": {
            "contract_mode": policy_params.get("mode", "standard"),
            "strictness": policy_params.get("strictness", "normal"),
        },
        "acceptance": {
            "ACC-001": {
                "criterion": requirement_ir["goal"],
                "verification": "task_graph_closeout",
            }
        },
    }


def _build_dag(requirement_ir: dict[str, Any], sprint_id: Optional[str]) -> dict[str, Any]:
    """Build a minimal deterministic DAG from the IR."""
    intent_hash = _sha256(requirement_ir["user_intent"])
    return {
        "schema_version": "solar.dag.v1",
        "sprint_id": sprint_id or "",
        "nodes": [
            {
                "id": f"N-{intent_hash[:8]}-01",
                "type": "implementation",
                "goal": requirement_ir["goal"],
                "depends_on": [],
                "requirement_ids": ["REQ-001"],
            }
        ],
    }


def _build_policy_refs(profile: dict[str, Any]) -> dict[str, str]:
    """Return a mapping of policy key → policy version (for audit)."""
    policies = profile.get("policies") or {}
    return {
        key: str((policies.get(key) or {}).get("version", ""))
        for key in REQUIRED_POLICY_KEYS
    }


def _compute_artifacts_digest(
    requirement_ir: dict[str, Any],
    contracts: dict[str, Any],
    dag: dict[str, Any],
    policy_refs: dict[str, str],
) -> str:
    """Return sha256 of the canonical JSON of all artifact content fields."""
    payload = _canonical_json({
        "requirement_ir": requirement_ir,
        "contracts": contracts,
        "dag": dag,
        "policy_refs": policy_refs,
    })
    return _sha256(payload)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def compile_from_profile(
    profile: dict[str, Any],
    raw_intent: str,
    *,
    sprint_id: Optional[str] = None,
    runtime_metadata: Optional[Any] = None,
) -> CompileResult:
    """Compile *raw_intent* using the given *profile*.

    This is a pure function with respect to ``artifacts['digest']``:
    identical (profile, raw_intent) inputs always produce the same digest.

    Parameters
    ----------
    profile : dict
        A v2 compiler profile (all six policy slots).
    raw_intent : str
        The raw requirement text to compile.
    sprint_id : str, optional
        Sprint identifier embedded in the artifacts for traceability.
    runtime_metadata : RuntimeMetadata, optional
        The resolution-time metadata produced by
        ``resolver.resolve_active_profile`` (via
        ``profile_resolution.resolve_profile_for_compile``).  When provided,
        its ``compiler_version`` / ``validators_version`` are propagated into
        the compile metadata and the full 4-tuple resolution record is
        embedded under ``artifacts['_metadata']['resolution']`` so every
        compiled artifact carries an auditable link back to the active-profile
        resolution (INV-4).  The resolution record is excluded from the
        deterministic digest (it is identity/provenance, not content).

    Returns
    -------
    CompileResult
    """
    traces: list[dict[str, Any]] = []

    # --- Step 1: build IR ---
    traces.append({"step": "build_requirement_ir", "status": "ok"})
    requirement_ir = _build_requirement_ir(raw_intent, sprint_id)

    # --- Step 2: build contracts ---
    traces.append({"step": "build_contracts", "status": "ok"})
    contracts = _build_contracts(requirement_ir, profile)

    # --- Step 3: build DAG ---
    traces.append({"step": "build_dag", "status": "ok"})
    dag = _build_dag(requirement_ir, sprint_id)

    # --- Step 4: collect policy refs ---
    policy_refs = _build_policy_refs(profile)

    # --- Step 5: compute deterministic digest ---
    digest = _compute_artifacts_digest(requirement_ir, contracts, dag, policy_refs)
    traces.append({"step": "compute_digest", "digest": digest, "status": "ok"})

    # --- Build metadata (compiled_at is NOT included in the digest) ---
    compiled_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    raw_intent_hash = _sha256(raw_intent)
    profile_digest = compute_digest(profile)

    # 4-tuple version axes flow in from the resolver when present.
    compiler_version = ""
    validators_version = ""
    if runtime_metadata is not None:
        compiler_version = getattr(runtime_metadata, "compiler_version", "") or ""
        validators_version = getattr(runtime_metadata, "validators_version", "") or ""

    metadata = CompileMetadata(
        profile_id=profile.get("profile_id", ""),
        profile_version=int(profile.get("version", 1)),
        profile_digest=profile_digest,
        schema_version=SCHEMA_VERSION,
        compiled_at=compiled_at,
        profile_source=profile.get("_source", "registry"),
        raw_intent_hash=raw_intent_hash,
        compiler_version=compiler_version,
        validators_version=validators_version,
    )

    artifacts: dict[str, Any] = {
        "requirement_ir": requirement_ir,
        "contracts": contracts,
        "dag": dag,
        "policy_refs": policy_refs,
        "digest": digest,
        # Provenance (excluded from the deterministic digest above).
        "_metadata": metadata.to_dict(),
    }

    # Embed the full auditable resolution record (the 4-tuple + trace) so a
    # compiled artifact can be traced back to the active-profile resolution.
    if runtime_metadata is not None and hasattr(runtime_metadata, "to_dict"):
        artifacts["_metadata"]["resolution"] = runtime_metadata.to_dict()

    return CompileResult(
        artifacts=artifacts,
        metadata=metadata,
        traces=traces,
    )
