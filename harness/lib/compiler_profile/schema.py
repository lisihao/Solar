"""schema.py — Compiler profile schema definition, validation, and digest.

A compiler profile is a named, versioned collection of 6 policy
configurations that parameterize the requirement compilation pipeline.
GEPA optimises profiles; the production compile pipeline consumes them
deterministically.

Schema (v2)::

    profile_id:   str           — unique identifier
    version:      int >= 1      — monotonically increasing version
    name:         str           — human-readable name
    tags:         list[str]     — categorisation tags
    created_at:   str (ISO 8601)
    policies:     dict with exactly 6 keys
      intake_policy:              {version: str, params: dict, text: str}
      requirement_ir_policy:      {version: str, params: dict, text: str}
      contract_compiler_policy:   {version: str, params: dict, text: str}
      dag_compiler_policy:        {version: str, params: dict, text: str}
      evidence_policy:            {version: str, params: dict, text: str}
      handoff_policy:             {version: str, params: dict, text: str}

The v2 schema requires every policy to carry a non-empty ``text`` field
(the GEPA-optimisable prompt body).  Legacy v1 profiles (params-only)
validate only under ``mode="compat_v1"``, which downgrades the missing
``text`` errors to warnings.

``compute_digest`` produces a content digest over the *policies* only
(profile_id / version / name metadata are intentionally excluded) so that
two profiles with identical policy content share a digest regardless of
their identity fields.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

__all__ = [
    "validate_profile",
    "compute_digest",
    "REQUIRED_POLICY_KEYS",
    "SCHEMA_VERSION",
    "MAX_TEXT_LEN",
]

SCHEMA_VERSION: int = 2

# Upper bound on a single policy ``text`` body (characters).  Generous enough
# for full prompt bodies while still bounding pathological inputs.
MAX_TEXT_LEN: int = 200_000

REQUIRED_POLICY_KEYS: tuple[str, ...] = (
    "intake_policy",
    "requirement_ir_policy",
    "contract_compiler_policy",
    "dag_compiler_policy",
    "evidence_policy",
    "handoff_policy",
)

_REQUIRED_TOP_LEVEL: tuple[str, ...] = (
    "profile_id",
    "version",
    "name",
    "tags",
    "created_at",
    "policies",
)

_VALID_MODES: tuple[str, ...] = ("strict_v2", "compat_v1")


def validate_profile(
    data: Any,
    *,
    mode: str = "strict_v2",
) -> tuple[bool, list[str]]:
    """Validate a compiler profile dict against the schema.

    Parameters
    ----------
    data:
        The profile to validate.
    mode:
        ``"strict_v2"`` (default) requires every policy to carry a
        non-empty ``text`` field.  ``"compat_v1"`` accepts legacy
        params-only profiles, emitting a warning (kept in the returned
        list) for each policy missing ``text`` but still reporting the
        profile as valid when nothing else is wrong.

    Returns
    -------
    (is_valid, errors) : tuple[bool, list[str]]
        In ``strict_v2`` mode ``is_valid`` is True iff ``errors`` is empty.
        In ``compat_v1`` mode the missing-``text`` entries are warnings and
        do not flip ``is_valid`` to False.
    """
    if mode not in _VALID_MODES:
        raise ValueError(f"unknown validation mode: {mode!r}")

    if not isinstance(data, dict):
        return False, ["profile must be a dict"]

    errors: list[str] = []
    # In compat_v1 mode the missing-text entries are warnings: collected
    # separately so they do not flip the validity result.
    compat_warnings: list[str] = []

    # --- top-level required fields ---
    for key in _REQUIRED_TOP_LEVEL:
        if key not in data:
            errors.append(f"missing required field: {key!r}")

    if errors:
        # Cannot proceed with deeper checks if top-level keys are missing.
        return False, errors

    # --- profile_id ---
    if not isinstance(data["profile_id"], str) or not data["profile_id"].strip():
        errors.append("'profile_id' must be a non-empty string")

    # --- version ---
    version = data["version"]
    if not isinstance(version, int) or version < 1:
        errors.append("'version' must be an integer >= 1")

    # --- name ---
    if not isinstance(data["name"], str) or not data["name"].strip():
        errors.append("'name' must be a non-empty string")

    # --- tags ---
    tags = data["tags"]
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        errors.append("'tags' must be a list of strings")

    # --- created_at ---
    created_at = data["created_at"]
    if not isinstance(created_at, str) or not created_at.strip():
        errors.append("'created_at' must be a non-empty ISO 8601 string")

    # --- policies ---
    policies = data["policies"]
    if not isinstance(policies, dict):
        errors.append("'policies' must be a dict")
    else:
        present_keys = set(policies.keys())
        expected_keys = set(REQUIRED_POLICY_KEYS)
        missing = expected_keys - present_keys
        extra = present_keys - expected_keys
        if missing:
            errors.append(f"'policies' missing keys: {sorted(missing)}")
        if extra:
            errors.append(f"'policies' has unexpected keys: {sorted(extra)}")

        for key in REQUIRED_POLICY_KEYS:
            policy = policies.get(key)
            if policy is None:
                continue  # already reported as missing
            if not isinstance(policy, dict):
                errors.append(f"'policies.{key}' must be a dict")
                continue

            # version
            if "version" not in policy:
                errors.append(f"'policies.{key}' missing 'version'")
            elif not isinstance(policy["version"], str):
                errors.append(f"'policies.{key}.version' must be a string")

            # params
            if "params" not in policy:
                errors.append(f"'policies.{key}' missing 'params'")
            elif not isinstance(policy["params"], dict):
                errors.append(f"'policies.{key}.params' must be a dict")

            # text (v2 requirement)
            text = policy.get("text")
            if not isinstance(text, str) or not text.strip():
                msg = (
                    f"'policies.{key}' missing or empty 'text' "
                    "(required by schema v2)"
                )
                if mode == "compat_v1":
                    compat_warnings.append(f"[compat_v1 warning] {msg}")
                else:
                    errors.append(msg)
            elif len(text) > MAX_TEXT_LEN:
                errors.append(
                    f"'policies.{key}.text' exceeds MAX_TEXT_LEN "
                    f"({len(text)} > {MAX_TEXT_LEN})"
                )

            # optional metadata
            if "metadata" in policy and not isinstance(policy["metadata"], dict):
                errors.append(f"'policies.{key}.metadata' must be a dict")

    is_valid = len(errors) == 0
    # Warnings ride along in the returned list but never flip validity.
    return (is_valid, errors + compat_warnings)


def _canonical_policies(profile: dict[str, Any]) -> str:
    """Return canonical JSON of the digest-relevant policy content.

    Only the policy bodies participate in the digest — identity/metadata
    fields (profile_id, version, name, tags, created_at) are excluded so
    that two profiles with identical policies share a digest.
    """
    policies = profile.get("policies") or {}
    canonical: dict[str, Any] = {}
    for key in REQUIRED_POLICY_KEYS:
        policy = policies.get(key)
        if not isinstance(policy, dict):
            canonical[key] = policy
            continue
        canonical[key] = {
            "version": policy.get("version", ""),
            "params": policy.get("params", {}),
            "text": policy.get("text", ""),
        }
    return json.dumps(canonical, sort_keys=True, ensure_ascii=False)


def compute_digest(profile: dict[str, Any]) -> str:
    """Return a deterministic sha256 hex digest of the profile's policies.

    The digest covers only the policy content (version / params / text per
    policy key), not the identity metadata fields.  Two profiles with the
    same policies therefore share a digest even if their profile_id, version,
    or name differ.

    Returns
    -------
    str
        64-character lowercase hex sha256 digest.
    """
    payload = _canonical_policies(profile)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
