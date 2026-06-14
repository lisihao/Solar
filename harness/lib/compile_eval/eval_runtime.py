"""eval_runtime.py — Reusable compile-then-evaluate loop for GEPA fitness.

Provides ``compile_and_evaluate(profile, raw_intent, *, compile_fn, adapter)``
which runs a single deterministic compilation and evaluates the result.

This is the inner loop that ``fitness_function`` calls per golden case.
"""
from __future__ import annotations

import dataclasses
from typing import Any, Callable, Optional

from .harness import CompileEvalResult

# Type alias for the compile function signature
CompileFn = Callable[[dict[str, Any], str], Any]


class CompileFailure(Exception):
    """Raised when deterministic compilation produces invalid output."""

    def __init__(self, message: str, *, case_input: str = "") -> None:
        super().__init__(message)
        self.case_input = case_input


@dataclasses.dataclass
class CaseEvalResult:
    """Result from evaluating a single golden case."""

    case_id: str
    asi_score: float
    compile_failed: bool
    compile_failure_reason: str
    hard_validator_failed: bool
    hard_validator_failures: list[str]
    eval_result: Optional[CompileEvalResult]
    component_asi: Optional[dict] = None


def compile_and_evaluate(
    profile: dict[str, Any],
    raw_intent: str,
    *,
    compile_fn: CompileFn,
    adapter: Any,
    case_id: str = "",
) -> CaseEvalResult:
    """Compile a single case and evaluate the compiled artifacts.

    Steps:
      1. Call ``compile_fn(profile, raw_intent)`` to produce artifacts.
      2. If compilation raises, record failure and score 0.0.
      3. Evaluate compiled artifacts against expected (the raw intent).
      4. If hard validators hard-fail, per-case ASI score = 0.0.

    Parameters
    ----------
    profile : dict
        Compiler profile to compile with.
    raw_intent : str
        The raw requirement text.
    compile_fn : callable
        ``(profile, raw_intent) -> CompileResult`` — defaults to
        ``compile_runtime.deterministic_compile.compile_from_profile``.
    adapter : CompileGEPAAdapter
        The adapter used for evaluation (traces, dimensions, etc.).
    case_id : str
        Identifier for trace recording.

    Returns
    -------
    CaseEvalResult
    """
    # --- Step 1: Compile ---
    try:
        compile_result = compile_fn(profile, raw_intent)
        artifacts = compile_result.artifacts
    except Exception as exc:
        return CaseEvalResult(
            case_id=case_id,
            asi_score=0.0,
            compile_failed=True,
            compile_failure_reason=str(exc),
            hard_validator_failed=False,
            hard_validator_failures=[],
            eval_result=None,
        )

    # --- Step 2: Evaluate ---
    expected = {"requirement_text": raw_intent}
    eval_result = adapter.evaluate(
        artifacts, expected,
        golden_case_id=case_id,
    )

    # --- Step 3: Hard validator check ---
    hard_failed = not eval_result.hard_validators_passed
    asi_score = 0.0 if hard_failed else eval_result.asi_score

    # --- Step 4: Component ASI ---
    traces = artifacts.get("traces") or {}
    profile = getattr(compile_result, "profile", {}) or {}
    try:
        from .asi_components import build_component_asi
        component_asi = build_component_asi(artifacts, traces, profile)
    except Exception:
        component_asi = None

    return CaseEvalResult(
        case_id=case_id,
        asi_score=asi_score,
        compile_failed=False,
        compile_failure_reason="",
        hard_validator_failed=hard_failed,
        hard_validator_failures=eval_result.hard_validator_failures if hard_failed else [],
        eval_result=eval_result,
        component_asi=component_asi,
    )


def default_compile_fn() -> CompileFn:
    """Return the default compile function: deterministic_compile.compile_from_profile."""
    from compile_runtime.deterministic_compile import compile_from_profile

    def _fn(profile: dict[str, Any], raw_intent: str) -> Any:
        return compile_from_profile(profile, raw_intent)

    return _fn
