"""LoweringBase — abstract base class for all IR lowering passes."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Generic, List, TypeVar

InputT = TypeVar("InputT")
OutputT = TypeVar("OutputT")


class LoweringError(Exception):
    """Raised when a lowering step fails validation."""

    def __init__(self, stage: str, errors: List[str]) -> None:
        self.stage = stage
        self.errors = errors
        super().__init__(f"Lowering failed at {stage}: {'; '.join(errors)}")


class LoweringBase(ABC, Generic[InputT, OutputT]):
    """Abstract base for IR compilation passes.

    Subclasses implement validate_input, transform, and validate_output.
    Call lower() to run the full pipeline with validation gates.
    """

    # Override in subclasses for descriptive names in error messages.
    name: str = "unnamed_lowering"

    @abstractmethod
    def validate_input(self, ir: InputT) -> List[str]:
        """Return a list of validation error strings (empty = valid)."""

    @abstractmethod
    def transform(self, ir: InputT) -> OutputT:
        """Compile/lower the IR without side-effects. Raises only on hard failures."""

    @abstractmethod
    def validate_output(self, ir: OutputT) -> List[str]:
        """Return a list of validation error strings for the output (empty = valid)."""

    def lower(self, ir: InputT) -> OutputT:
        """Run validate_input → transform → validate_output.

        Raises LoweringError on the first failing gate.
        """
        input_errors = self.validate_input(ir)
        if input_errors:
            raise LoweringError(f"{self.name}.validate_input", input_errors)

        result = self.transform(ir)

        output_errors = self.validate_output(result)
        if output_errors:
            raise LoweringError(f"{self.name}.validate_output", output_errors)

        return result
