"""profile_resolution.py — Thin wrapper around resolver.resolve_active_profile.

Provides resolve_profile_for_compile() as the single entry point for
codex_pm_router and other callers that need a compiler profile attached
to a compilation run.

Contract
--------
* When all arguments are None → returns (None, None).
  The caller MUST preserve baseline behaviour in this case.
* When profile_id is provided but not found in the registry → raises
  ValueError with a descriptive message (never silently falls back).
* Otherwise → returns (profile_dict, RuntimeMetadata).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from compiler_profile.resolver import RuntimeMetadata

__all__ = ["resolve_profile_for_compile"]


def resolve_profile_for_compile(
    profile_id: Optional[str] = None,
    profile_digest: Optional[str] = None,
    profile_tag: Optional[str] = None,
    profile_source: Optional[str] = None,
    *,
    compiler_version: str = "",
    validators_version: str = "",
    db_path: Optional[Path] = None,
) -> tuple[Optional[dict[str, Any]], Optional["RuntimeMetadata"]]:
    """Resolve a compiler profile for use in a compilation run.

    Parameters
    ----------
    profile_id : str, optional
        Explicit profile id pin.  If provided and not found → raises ValueError.
    profile_digest : str, optional
        If provided, the resolved profile's digest must match this value.
    profile_tag : str, optional
        Resolve via use_case override keyed to this tag.
    profile_source : str, optional
        Informational hint attached to the metadata (not used for resolution).
    compiler_version : str, optional
        Compiler version tag injected into the resolution metadata and the
        ``_resolution_audit_log`` (part of the runtime 4-tuple).
    validators_version : str, optional
        Validators version tag injected into the resolution metadata and the
        ``_resolution_audit_log`` (part of the runtime 4-tuple).
    db_path : Path, optional
        Override SQLite database path (for testing).

    Returns
    -------
    (profile, meta) or (None, None)
        Returns (None, None) when no arguments are supplied — the caller
        should behave as if no profile is attached.

    Raises
    ------
    ValueError
        If ``profile_id`` is given but the profile is not found in the registry,
        OR if ``profile_digest`` is provided and does not match the resolved
        profile's digest.
    """
    from compiler_profile.resolver import resolve_active_profile, BUILTIN_DEFAULT_PROFILE_ID

    no_flags = (
        profile_id is None
        and profile_digest is None
        and profile_tag is None
        and profile_source is None
    )
    if no_flags:
        return None, None

    # When profile_id is explicitly given, must find it — no silent fallback.
    if profile_id is not None:
        # Verify existence before calling resolve_active_profile
        from compiler_profile.registry import query
        matches = query(profile_id=profile_id, db_path=db_path)
        if not matches:
            raise ValueError(
                f"Profile {profile_id!r} not found in registry. "
                "Cannot proceed with explicit --profile-id that does not exist."
            )

    # Resolve using the full precedence chain.  ``profile_tag`` maps to the
    # use_case override axis so a tag can select a profile via precedence.
    profile, meta = resolve_active_profile(
        use_case=profile_tag,
        pinned_profile_id=profile_id,
        pinned_digest=profile_digest,
        compiler_version=compiler_version,
        validators_version=validators_version,
        db_path=db_path,
    )

    # If profile_id was given but resolution fell back to builtin, reject it
    if profile_id is not None and profile["profile_id"] == BUILTIN_DEFAULT_PROFILE_ID:
        raise ValueError(
            f"Profile {profile_id!r} resolved to builtin fallback unexpectedly. "
            "Ensure the profile is registered before pinning."
        )

    return profile, meta
