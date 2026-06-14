"""solar_eval — Proof Obligation Compiler + Deterministic Verifier Generator."""
from __future__ import annotations

from .proof_obligation_compiler import (
    ProofObligation,
    ProofObligationCompiler,
    CHECK_NO_FORBIDDEN,
    CHECK_EVIDENCE_EXISTS,
    CHECK_SCOPE_CHECK,
    CHECK_SECRET_LEAK,
)
from .verifier_generator import (
    Verdict,
    ObligationResult,
    VerifierReport,
    VerifierGenerator,
)
from .eval_factory import (
    EvalFactory,
    EvalResult,
    CheckerSummary,
)
from .rubric_generator import (
    Rubric,
    RubricCriterion,
    RubricGenerator,
    CriterionDirection,
)
from .judge_panel import (
    JudgeMode,
    JudgePanel,
    JudgeResult,
    JudgeVerdict,
    CriterionScore,
    SelfReviewBlockedError,
)
from .active_learning_queue import (
    ActiveLearningQueue,
    DisagreementEntry,
)
from .runners.judge_panel_runner import (
    JudgePanelRunner,
    RunnerResult,
)

__all__ = [
    # Compiler
    "ProofObligation",
    "ProofObligationCompiler",
    "CHECK_NO_FORBIDDEN",
    "CHECK_EVIDENCE_EXISTS",
    "CHECK_SCOPE_CHECK",
    "CHECK_SECRET_LEAK",
    # Verifier
    "Verdict",
    "ObligationResult",
    "VerifierReport",
    "VerifierGenerator",
    # Factory
    "EvalFactory",
    "EvalResult",
    "CheckerSummary",
    # P2: Rubric + Judge
    "Rubric",
    "RubricCriterion",
    "RubricGenerator",
    "CriterionDirection",
    "JudgeMode",
    "JudgePanel",
    "JudgeResult",
    "JudgeVerdict",
    "CriterionScore",
    "SelfReviewBlockedError",
    "ActiveLearningQueue",
    "DisagreementEntry",
    "JudgePanelRunner",
    "RunnerResult",
]
