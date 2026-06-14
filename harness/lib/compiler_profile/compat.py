"""compat.py — V1 → V2 compiler profile upgrade helpers.

Provides upgrade_v1_to_v2(), is_v1(), is_v2(), and default_v2_profile()
for migrating legacy params-only profiles to the v2 text-bearing schema.

Text generation uses stable JSON serialisation (sorted keys) so that
the same params dict always produces the same text string across Python
versions and process restarts.
"""
from __future__ import annotations

import copy
import datetime
import json
from typing import Any

from compiler_profile.schema import REQUIRED_POLICY_KEYS, validate_profile

__all__ = [
    "is_v1",
    "is_v2",
    "upgrade_v1_to_v2",
    "default_v2_profile",
]


# ---------------------------------------------------------------------------
# Policy-level text generation
# ---------------------------------------------------------------------------

def _policy_text(policy_key: str, params: dict[str, Any]) -> str:
    """Generate deterministic text for *policy_key* from *params*.

    Uses ``json.dumps`` with ``sort_keys=True`` so that identical params
    always produce identical text regardless of insertion order.
    """
    params_json = json.dumps(params, sort_keys=True)
    return f"{policy_key}: {params_json}"


# ---------------------------------------------------------------------------
# Profile classification
# ---------------------------------------------------------------------------

def is_v1(profile: dict[str, Any]) -> bool:
    """Return True if *profile* is a legacy v1 profile.

    A profile is considered v1 when any of the six required policies is
    missing a non-empty ``text`` field.  Non-dict inputs return False.
    """
    if not isinstance(profile, dict):
        return False
    policies = profile.get("policies")
    if not isinstance(policies, dict):
        return False
    for key in REQUIRED_POLICY_KEYS:
        policy = policies.get(key)
        if not isinstance(policy, dict):
            continue
        text = policy.get("text")
        if not isinstance(text, str) or not text.strip():
            return True
    return False


def is_v2(profile: dict[str, Any]) -> bool:
    """Return True if *profile* passes strict_v2 validation.

    Delegates to ``validate_profile`` so the definition of "v2" stays
    in a single place.  Non-dict inputs return False.
    """
    if not isinstance(profile, dict):
        return False
    ok, _ = validate_profile(profile, mode="strict_v2")
    return ok


# ---------------------------------------------------------------------------
# Upgrade
# ---------------------------------------------------------------------------

def upgrade_v1_to_v2(profile: dict[str, Any]) -> dict[str, Any]:
    """Return a new profile with all policy ``text`` fields populated.

    For each policy that already has a non-empty ``text``, the existing
    value is preserved — making the function idempotent on v2 profiles.
    For policies that lack ``text`` (or have only whitespace), a
    deterministic default is generated from the policy's ``params`` via
    stable JSON serialisation (sorted keys).

    The original *profile* dict is never mutated (deep-copy semantics).

    Parameters
    ----------
    profile:
        A compiler profile dict (v1 or v2).

    Returns
    -------
    dict
        A new profile that passes ``validate_profile`` in ``strict_v2`` mode,
        provided the input was otherwise structurally valid.
    """
    upgraded = copy.deepcopy(profile)
    policies = upgraded.get("policies")
    if not isinstance(policies, dict):
        return upgraded

    for key in REQUIRED_POLICY_KEYS:
        policy = policies.get(key)
        if not isinstance(policy, dict):
            continue
        text = policy.get("text")
        if not isinstance(text, str) or not text.strip():
            params = policy.get("params") or {}
            policy["text"] = _policy_text(key, params)

    return upgraded


# ---------------------------------------------------------------------------
# Default v2 profile factory
# ---------------------------------------------------------------------------

# Per-policy default params used by default_v2_profile().
# Keys are kept stable; the resulting text is derived deterministically.
_DEFAULT_POLICY_PARAMS: dict[str, dict[str, Any]] = {
    "intake_policy": {
        "description": "Parse raw requirements into structured form.",
        "max_tokens": 4096,
        "mode": "standard",
    },
    "requirement_ir_policy": {
        "description": "Transform structured requirements into internal IR.",
        "ir_version": "2",
        "mode": "standard",
    },
    "contract_compiler_policy": {
        "description": "Compile IR into formal contracts.",
        "mode": "standard",
        "strictness": "normal",
    },
    "dag_compiler_policy": {
        "description": "Build execution DAG from compiled contracts.",
        "mode": "standard",
        "parallelism": "auto",
    },
    "evidence_policy": {
        "description": "Evidence collection and traceability configuration.",
        "mode": "standard",
        "trace_level": "full",
    },
    "handoff_policy": {
        "description": "Handoff document generation configuration.",
        "format": "markdown",
        "mode": "standard",
    },
}


def default_v2_profile() -> dict[str, Any]:
    """Return a minimal but complete default v2 profile.

    All six ``text`` fields are non-empty and generated deterministically
    from the built-in default params.  The ``created_at`` timestamp
    reflects the moment the function is called.

    This profile is intended as a last-resort fallback when no user-defined
    profile is configured or loadable.
    """
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    policies: dict[str, Any] = {}
    for key in REQUIRED_POLICY_KEYS:
        params = _DEFAULT_POLICY_PARAMS[key]
        policies[key] = {
            "version": "1.0",
            "params": params,
            "text": _policy_text(key, params),
        }
    return {
        "profile_id": "__builtin_default_v2__",
        "version": 1,
        "name": "Default V2 Profile",
        "tags": ["default", "v2"],
        "created_at": now,
        "policies": policies,
    }
