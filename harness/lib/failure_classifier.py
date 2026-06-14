"""Compatibility entrypoint for FailureClassifier v2.

The implementation lives in the operator_availability package; this module
keeps the S2 dispatch contract's historical import path available.
"""

from operator_availability.failure_classifier import (  # noqa: F401
    ClassificationType,
    EvidenceConfidence,
    FailureClassification,
    FailureClassifier,
)

__all__ = [
    "ClassificationType",
    "EvidenceConfidence",
    "FailureClassification",
    "FailureClassifier",
]
