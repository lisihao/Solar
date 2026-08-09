"""
objectives.py — Multi-objective scoring for GEPA optimizer ASI payloads.

Design
------
* 8 soft-score dimensions (each in [0.0, 1.0]) combined into a single scalar
  via configurable weights.
* 4 penalty dimensions that reduce the scalar post-hoc.
* Hard-policy separation: ``safety_violation`` is a **penalty only** and must
  never appear in the soft-score components.  It does not replace or bypass
  the separate ``policy_check`` layer — it merely informs the objective
  function that a safety concern was observed.
* No dependency on the ``gepa`` package.

Public symbols
--------------
* ``ObjectiveScore``  — frozen result dataclass
* ``ObjectiveScorer`` — configurable scorer
"""
from __future__ import annotations

import dataclasses
import math
from typing import Any, Mapping


# ---------------------------------------------------------------------------
# Soft-score dimension names (8)
# ---------------------------------------------------------------------------

SOFT_DIMENSIONS: tuple[str, ...] = (
    "evidence_quality",
    "completeness",
    "consistency",
    "recency",
    "source_diversity",
    "specificity",
    "actionability",
    "relevance",
)

# ---------------------------------------------------------------------------
# Penalty dimension names (4)
# ---------------------------------------------------------------------------

PENALTY_DIMENSIONS: tuple[str, ...] = (
    "stale_evidence",
    "missing_critical_field",
    "low_confidence",
    "safety_violation",
)

# Default weights — must sum to 1.0 for the 8 soft dimensions.
DEFAULT_SOFT_WEIGHTS: dict[str, float] = {
    "evidence_quality": 0.175,
    "completeness": 0.175,
    "consistency": 0.125,
    "recency": 0.100,
    "source_diversity": 0.100,
    "specificity": 0.125,
    "actionability": 0.100,
    "relevance": 0.100,
}

# Default penalty strengths (0.0–1.0 multiplier applied to scalar).
DEFAULT_PENALTY_STRENGTHS: dict[str, float] = {
    "stale_evidence": 0.15,
    "missing_critical_field": 0.25,
    "low_confidence": 0.10,
    "safety_violation": 0.50,
}


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------

@dataclasses.dataclass(frozen=True)
class ObjectiveScore:
    """Immutable result from :meth:`ObjectiveScorer.score`.

    Attributes
    ----------
    scalar:
        Weighted composite score in [0.0, 1.0] after penalties are applied.
    components:
        Per-dimension soft scores (8 keys from :data:`SOFT_DIMENSIONS`).
    penalties:
        Per-dimension penalty flags/values (4 keys from :data:`PENALTY_DIMENSIONS`).
    """
    scalar: float
    components: dict[str, float]
    penalties: dict[str, float]


# ---------------------------------------------------------------------------
# Internal extractors — one per soft dimension
# ---------------------------------------------------------------------------

def _extract_evidence_quality(payload: dict[str, Any]) -> float:
    facts = payload.get("verified_facts", [])
    if not facts:
        return 0.0
    scores = [float(f.get("confidence", 0.0)) for f in facts if isinstance(f, dict)]
    return sum(scores) / len(scores) if scores else 0.0


def _extract_completeness(payload: dict[str, Any]) -> float:
    raw = payload.get("raw_artifacts", [])
    missing = payload.get("missing_evidence", [])
    total = len(raw) + len(missing)
    if total == 0:
        return 1.0
    return len(raw) / total


def _extract_consistency(payload: dict[str, Any]) -> float:
    metrics = payload.get("derived_metrics", {})
    if isinstance(metrics, dict):
        return float(metrics.get("consistency_score", 1.0))
    return 1.0


def _extract_recency(payload: dict[str, Any]) -> float:
    facts = payload.get("verified_facts", [])
    if not facts:
        return 0.0
    recency_scores = []
    for f in facts:
        if isinstance(f, dict):
            recency_scores.append(float(f.get("recency", 0.0)))
    return sum(recency_scores) / len(recency_scores) if recency_scores else 0.0


def _extract_source_diversity(payload: dict[str, Any]) -> float:
    facts = payload.get("verified_facts", [])
    if not facts:
        return 0.0
    sources = set()
    for f in facts:
        if isinstance(f, dict):
            src = f.get("source")
            if src is not None:
                sources.add(str(src))
    return min(len(sources) / max(len(facts), 1), 1.0)


def _extract_specificity(payload: dict[str, Any]) -> float:
    metrics = payload.get("derived_metrics", {})
    if isinstance(metrics, dict):
        return float(metrics.get("specificity", 0.5))
    return 0.5


def _extract_actionability(payload: dict[str, Any]) -> float:
    metrics = payload.get("derived_metrics", {})
    if isinstance(metrics, dict):
        return float(metrics.get("actionability", 0.5))
    return 0.5


def _extract_relevance(payload: dict[str, Any]) -> float:
    metrics = payload.get("derived_metrics", {})
    if isinstance(metrics, dict):
        return float(metrics.get("relevance", 0.5))
    return 0.5


_SOFT_EXTRACTORS: dict[str, Any] = {
    "evidence_quality": _extract_evidence_quality,
    "completeness": _extract_completeness,
    "consistency": _extract_consistency,
    "recency": _extract_recency,
    "source_diversity": _extract_source_diversity,
    "specificity": _extract_specificity,
    "actionability": _extract_actionability,
    "relevance": _extract_relevance,
}


# ---------------------------------------------------------------------------
# Internal penalty detectors
# ---------------------------------------------------------------------------

def _detect_stale_evidence(payload: dict[str, Any]) -> float:
    facts = payload.get("verified_facts", [])
    if not facts:
        return 0.0
    stale_count = sum(
        1 for f in facts
        if isinstance(f, dict) and f.get("is_stale", False)
    )
    return stale_count / len(facts)


def _detect_missing_critical_field(payload: dict[str, Any]) -> float:
    missing = payload.get("missing_evidence", [])
    if not missing:
        return 0.0
    critical = [m for m in missing if isinstance(m, dict) and m.get("critical", False)]
    return min(len(critical) / max(len(missing), 1), 1.0)


def _detect_low_confidence(payload: dict[str, Any]) -> float:
    facts = payload.get("verified_facts", [])
    if not facts:
        return 0.0
    low = sum(
        1 for f in facts
        if isinstance(f, dict) and float(f.get("confidence", 1.0)) < 0.3
    )
    return low / len(facts)


def _detect_safety_violation(payload: dict[str, Any]) -> float:
    metrics = payload.get("derived_metrics", {})
    if isinstance(metrics, dict):
        return float(metrics.get("safety_violation", 0.0))
    return 0.0


_PENALTY_DETECTORS: dict[str, Any] = {
    "stale_evidence": _detect_stale_evidence,
    "missing_critical_field": _detect_missing_critical_field,
    "low_confidence": _detect_low_confidence,
    "safety_violation": _detect_safety_violation,
}


# ---------------------------------------------------------------------------
# Scorer
# ---------------------------------------------------------------------------

class ObjectiveScorer:
    """Configurable multi-objective scorer for ASI payloads.

    Parameters
    ----------
    soft_weights:
        Per-dimension weights for the 8 soft scores.  Must contain all keys
        in :data:`SOFT_DIMENSIONS` and sum to 1.0 (within tolerance).
    penalty_strengths:
        Per-dimension penalty strength multipliers (0.0–1.0).  Must contain
        all keys in :data:`PENALTY_DIMENSIONS`.

    Raises
    ------
    ValueError
        If weights/strengths are missing keys or out of range.
    """

    def __init__(
        self,
        *,
        soft_weights: dict[str, float] | None = None,
        penalty_strengths: dict[str, float] | None = None,
    ) -> None:
        self._soft_weights = self._validate_soft_weights(
            soft_weights or dict(DEFAULT_SOFT_WEIGHTS)
        )
        self._penalty_strengths = self._validate_penalty_strengths(
            penalty_strengths or dict(DEFAULT_PENALTY_STRENGTHS)
        )

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_soft_weights(w: dict[str, float]) -> dict[str, float]:
        missing = set(SOFT_DIMENSIONS) - set(w.keys())
        if missing:
            raise ValueError(f"Missing soft weight keys: {sorted(missing)}")
        extra = set(w.keys()) - set(SOFT_DIMENSIONS)
        if extra:
            raise ValueError(f"Unknown soft weight keys: {sorted(extra)}")
        for k, v in w.items():
            if not (0.0 <= v <= 1.0):
                raise ValueError(f"Soft weight '{k}' must be in [0.0, 1.0], got {v}")
        total = sum(w.values())
        if not math.isclose(total, 1.0, abs_tol=1e-6):
            raise ValueError(f"Soft weights must sum to 1.0, got {total}")
        return dict(w)

    @staticmethod
    def _validate_penalty_strengths(s: dict[str, float]) -> dict[str, float]:
        missing = set(PENALTY_DIMENSIONS) - set(s.keys())
        if missing:
            raise ValueError(f"Missing penalty strength keys: {sorted(missing)}")
        extra = set(s.keys()) - set(PENALTY_DIMENSIONS)
        if extra:
            raise ValueError(f"Unknown penalty strength keys: {sorted(extra)}")
        for k, v in s.items():
            if not (0.0 <= v <= 1.0):
                raise ValueError(f"Penalty strength '{k}' must be in [0.0, 1.0], got {v}")
        return dict(s)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def score(self, asi_payload: Mapping[str, Any]) -> ObjectiveScore:
        """Score an ASI payload and return a structured result.

        Parameters
        ----------
        asi_payload:
            A dict-like object produced by the ASI adapter.  Expected keys:
            ``verified_facts``, ``derived_metrics``, ``missing_evidence``,
            ``raw_artifacts``.  Missing keys are treated as empty / default.

        Returns
        -------
        ObjectiveScore
            ``scalar`` in [0.0, 1.0], ``components`` with 8 soft-score
            dimensions, ``penalties`` with 4 penalty dimensions.
        """
        payload = dict(asi_payload)

        # Compute soft scores
        components: dict[str, float] = {}
        for dim in SOFT_DIMENSIONS:
            extractor = _SOFT_EXTRACTORS[dim]
            raw = extractor(payload)
            components[dim] = max(0.0, min(1.0, float(raw)))

        # Weighted scalar
        raw_scalar = sum(
            self._soft_weights[dim] * components[dim] for dim in SOFT_DIMENSIONS
        )

        # Compute penalties
        penalties: dict[str, float] = {}
        for dim in PENALTY_DIMENSIONS:
            detector = _PENALTY_DETECTORS[dim]
            raw_pen = detector(payload)
            penalties[dim] = max(0.0, min(1.0, float(raw_pen)))

        # Apply penalties multiplicatively
        scalar = raw_scalar
        for dim in PENALTY_DIMENSIONS:
            reduction = penalties[dim] * self._penalty_strengths[dim]
            scalar *= (1.0 - reduction)

        scalar = max(0.0, min(1.0, scalar))

        return ObjectiveScore(
            scalar=scalar,
            components=components,
            penalties=penalties,
        )

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def soft_weights(self) -> dict[str, float]:
        return dict(self._soft_weights)

    @property
    def penalty_strengths(self) -> dict[str, float]:
        return dict(self._penalty_strengths)
