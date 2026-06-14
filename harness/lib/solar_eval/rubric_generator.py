"""rubric_generator.py — generates evaluation rubrics from CapsuleIR + EffectIR.

Pipeline:
  postconditions + effects + history → raw criteria
  → decompose → filter → deduplicate → direction_check → weight_normalization
"""
from __future__ import annotations

import hashlib
import re
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence, Tuple

from solar_ir.capsule_ir import CapsuleIR, CapsuleContract
from solar_ir.effect_ir import EffectIR, EffectEntry


class CriterionDirection(str, Enum):
    """Higher-is-better vs lower-is-better vs boolean."""
    MAXIMIZE = "maximize"
    MINIMIZE = "minimize"
    BOOLEAN = "boolean"


@dataclass(frozen=True)
class RubricCriterion:
    criterion_id: str
    description: str
    weight: float = 1.0
    direction: CriterionDirection = CriterionDirection.BOOLEAN
    source: str = ""  # "postcondition" | "effect" | "history"
    threshold: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "criterion_id": self.criterion_id,
            "description": self.description,
            "weight": self.weight,
            "direction": self.direction.value,
            "source": self.source,
        }
        if self.threshold is not None:
            d["threshold"] = self.threshold
        return d


@dataclass
class Rubric:
    rubric_id: str
    criteria: List[RubricCriterion] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def total_weight(self) -> float:
        return sum(c.weight for c in self.criteria)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "rubric_id": self.rubric_id,
            "criteria": [c.to_dict() for c in self.criteria],
            "metadata": dict(self.metadata),
            "total_weight": self.total_weight(),
        }


def _stable_id(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()[:12]


class RubricGenerator:
    """Generates rubrics from CapsuleIR postconditions + EffectIR effects + history.

    Usage::

        gen = RubricGenerator()
        rubric = gen.generate(capsule_ir=cap, effect_ir=eff, history=past_evals)
    """

    def generate(
        self,
        capsule_ir: Optional[CapsuleIR] = None,
        effect_ir: Optional[EffectIR] = None,
        history: Optional[Sequence[Dict[str, Any]]] = None,
    ) -> Rubric:
        raw = self._extract_raw_criteria(capsule_ir, effect_ir, history)
        criteria = self._pipeline(raw)
        return Rubric(
            rubric_id=uuid.uuid4().hex[:12],
            criteria=criteria,
            metadata={
                "raw_count": len(raw),
                "final_count": len(criteria),
            },
        )

    # ── Raw extraction ──────────────────────────────────────────────────────────

    def _extract_raw_criteria(
        self,
        capsule_ir: Optional[CapsuleIR],
        effect_ir: Optional[EffectIR],
        history: Optional[Sequence[Dict[str, Any]]],
    ) -> List[Dict[str, Any]]:
        raw: List[Dict[str, Any]] = []

        if capsule_ir is not None and capsule_ir.contract is not None:
            for pc in capsule_ir.contract.postconditions:
                raw.append({
                    "description": pc.get("description", str(pc)),
                    "source": "postcondition",
                    "direction": pc.get("direction", "boolean"),
                    "weight_hint": pc.get("weight", 1.0),
                    "threshold": pc.get("threshold"),
                })

        if effect_ir is not None:
            for eff in effect_ir.effects:
                raw.append({
                    "description": eff.description or f"{eff.effect_type}:{eff.target}",
                    "source": "effect",
                    "direction": "boolean",
                    "weight_hint": 1.0,
                    "severity": eff.severity,
                })

        if history:
            for entry in history:
                desc = entry.get("description", "")
                if desc:
                    raw.append({
                        "description": desc,
                        "source": "history",
                        "direction": entry.get("direction", "boolean"),
                        "weight_hint": entry.get("weight", 1.0),
                    })

        return raw

    # ── Pipeline stages ─────────────────────────────────────────────────────────

    def _pipeline(self, raw: List[Dict[str, Any]]) -> List[RubricCriterion]:
        criteria = self._decompose(raw)
        criteria = self._filter(criteria)
        criteria = self._deduplicate(criteria)
        criteria = self._direction_check(criteria)
        criteria = self._weight_normalization(criteria)
        return criteria

    def _decompose(self, raw: List[Dict[str, Any]]) -> List[RubricCriterion]:
        """Split compound criteria into atomic ones."""
        result: List[RubricCriterion] = []
        for r in raw:
            desc = r["description"]
            parts = re.split(r'[.;]\s*', desc)
            for part in parts:
                part = part.strip()
                if not part:
                    continue
                result.append(RubricCriterion(
                    criterion_id=_stable_id(part),
                    description=part,
                    weight=r.get("weight_hint", 1.0),
                    direction=CriterionDirection(r.get("direction", "boolean")),
                    source=r.get("source", ""),
                    threshold=r.get("threshold"),
                ))
        return result

    def _filter(self, criteria: List[RubricCriterion]) -> List[RubricCriterion]:
        """Remove trivial / empty / meaningless criteria."""
        return [
            c for c in criteria
            if len(c.description) >= 3
        ]

    def _deduplicate(self, criteria: List[RubricCriterion]) -> List[RubricCriterion]:
        """Merge criteria with identical criterion_id (same content hash)."""
        seen: Dict[str, RubricCriterion] = {}
        for c in criteria:
            if c.criterion_id not in seen:
                seen[c.criterion_id] = c
            else:
                existing = seen[c.criterion_id]
                # Keep the one with higher weight
                if c.weight > existing.weight:
                    seen[c.criterion_id] = c
        return list(seen.values())

    def _direction_check(self, criteria: List[RubricCriterion]) -> List[RubricCriterion]:
        """Ensure direction is valid; default to BOOLEAN."""
        valid = {d.value for d in CriterionDirection}
        result: List[RubricCriterion] = []
        for c in criteria:
            if c.direction.value not in valid:
                c = RubricCriterion(
                    criterion_id=c.criterion_id,
                    description=c.description,
                    weight=c.weight,
                    direction=CriterionDirection.BOOLEAN,
                    source=c.source,
                    threshold=c.threshold,
                )
            result.append(c)
        return result

    def _weight_normalization(self, criteria: List[RubricCriterion]) -> List[RubricCriterion]:
        """Normalize weights to sum to 1.0."""
        total = sum(c.weight for c in criteria)
        if total == 0:
            return criteria
        result: List[RubricCriterion] = []
        for c in criteria:
            result.append(RubricCriterion(
                criterion_id=c.criterion_id,
                description=c.description,
                weight=round(c.weight / total, 4),
                direction=c.direction,
                source=c.source,
                threshold=c.threshold,
            ))
        return result
