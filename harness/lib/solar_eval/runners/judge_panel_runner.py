"""judge_panel_runner.py — orchestrates RubricGenerator + JudgePanel.

Wires rubric generation → judge evaluation → learning queue output.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from solar_ir.capsule_ir import CapsuleIR
from solar_ir.effect_ir import EffectIR

from ..rubric_generator import Rubric, RubricGenerator
from ..judge_panel import (
    JudgeMode,
    JudgePanel,
    JudgeResult,
    JudgeVerdict,
)
from ..active_learning_queue import ActiveLearningQueue, DisagreementEntry


@dataclass
class RunnerResult:
    artifact_id: str
    rubric: Optional[Rubric]
    judge_result: JudgeResult
    disagreements: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "artifact_id": self.artifact_id,
            "rubric": self.rubric.to_dict() if self.rubric else None,
            "judge_result": self.judge_result.to_dict(),
            "disagreements": self.disagreements,
        }


class JudgePanelRunner:
    """End-to-end runner: CapsuleIR + EffectIR → rubric → judge → result.

    Usage::

        runner = JudgePanelRunner()
        result = runner.run(
            capsule_ir=cap,
            effect_ir=eff,
            mode=JudgeMode.PANEL,
            artifact_id="N11",
            writer_id="builder-1",
            judge_id="evaluator-1",
            evidence={"tests_passed": True},
        )
    """

    def __init__(
        self,
        rubric_generator: Optional[RubricGenerator] = None,
        judge_panel: Optional[JudgePanel] = None,
        learning_queue: Optional[ActiveLearningQueue] = None,
        llm_call_fn: Optional[Callable] = None,
    ) -> None:
        self._queue = learning_queue or ActiveLearningQueue()
        self._generator = rubric_generator or RubricGenerator()
        self._panel = judge_panel or JudgePanel(
            learning_queue=self._queue,
            llm_call_fn=llm_call_fn,
        )

    @property
    def learning_queue(self) -> ActiveLearningQueue:
        return self._queue

    def run(
        self,
        mode: JudgeMode,
        artifact_id: str,
        writer_id: str,
        judge_id: str,
        capsule_ir: Optional[CapsuleIR] = None,
        effect_ir: Optional[EffectIR] = None,
        history: Optional[List[Dict[str, Any]]] = None,
        evidence: Optional[Dict[str, Any]] = None,
    ) -> RunnerResult:
        rubric = self._generator.generate(
            capsule_ir=capsule_ir,
            effect_ir=effect_ir,
            history=history,
        )

        judge_result = self._panel.judge(
            mode=mode,
            rubric=rubric,
            artifact_id=artifact_id,
            writer_id=writer_id,
            judge_id=judge_id,
            evidence=evidence,
        )

        return RunnerResult(
            artifact_id=artifact_id,
            rubric=rubric,
            judge_result=judge_result,
            disagreements=len(self._queue),
        )
