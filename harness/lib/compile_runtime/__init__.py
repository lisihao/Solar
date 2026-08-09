"""compile_runtime — Deterministic requirement compilation engine.

Public API
----------
compile_from_profile(profile, raw_intent, *, sprint_id=None) → CompileResult
CompileResult
CompileMetadata

Explicitly NOT exported: propose, promote, rollback (those belong to
compile_eval.harness and must not leak into compile_runtime).
"""
from .deterministic_compile import CompileResult, compile_from_profile
from .metadata import CompileMetadata

__all__ = [
    "compile_from_profile",
    "CompileResult",
    "CompileMetadata",
]
