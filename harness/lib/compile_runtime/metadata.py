"""metadata.py — CompileMetadata for compile_runtime.

Records the provenance of every compilation: which profile was used,
which version, its content digest, and the hash of the raw intent.
"""
from __future__ import annotations

import dataclasses
from typing import Any


@dataclasses.dataclass(frozen=True)
class CompileMetadata:
    """Immutable record of a single compilation's provenance.

    All fields are strings so the metadata can be serialised to JSON
    and embedded directly in CompileResult.artifacts['_metadata'].
    """

    profile_id: str
    profile_version: int
    profile_digest: str
    schema_version: int
    compiled_at: str
    profile_source: str
    raw_intent_hash: str

    def to_dict(self) -> dict[str, Any]:
        return dataclasses.asdict(self)
