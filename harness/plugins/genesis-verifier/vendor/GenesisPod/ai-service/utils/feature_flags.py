"""
Feature flag helpers for the AI service.
"""
import os
from typing import Optional

_TRUTHY_VALUES = {"true", "1", "yes", "on"}


def _is_truthy(value: Optional[str]) -> bool:
    if value is None:
        return False
    return value.strip().lower() in _TRUTHY_VALUES


def is_workspace_ai_v2_enabled() -> bool:
    """
    Returns whether the Workspace AI v2 features should be enabled.
    """
    env_value = os.getenv("WORKSPACE_AI_V2_ENABLED")
    if env_value is not None:
        return _is_truthy(env_value)

    # Fallback to public env variable if present (useful in shared env files)
    public_value = os.getenv("NEXT_PUBLIC_WORKSPACE_AI_V2_ENABLED")
    if public_value is not None:
        return _is_truthy(public_value)

    # Default to enabled for local/dev environments to avoid accidental 404 gating
    return True
