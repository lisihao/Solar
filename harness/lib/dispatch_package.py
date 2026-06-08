#!/usr/bin/env python3
"""Utilities for generating and writing Solar dispatch packages."""

from __future__ import annotations

import datetime
import hashlib
import json
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "solar.dispatch_package.v1"
PAYLOAD_SCHEMA_VERSION = "solar.dispatch_payload.v1"

VALID_EVIDENCE_STATUSES = frozenset({"complete", "partial", "incomplete", "not_applicable"})


def _utc_now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def compute_text_digest(text: str) -> str:
    """Return a stable SHA-256 digest for a dispatch text payload."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_dispatch_package(
    *,
    dispatch_id: str,
    sprint_id: str,
    node_id: str,
    dispatch_md_path: str,
    dispatch_text: str,
    payload: dict[str, Any],
    issued_by: str,
    dispatch_json_path: str,
    created_at: str | None = None,
    evidence_refs: list[dict[str, Any]] | None = None,
    evidence_status: str | None = None,
) -> dict[str, Any]:
    digest = compute_text_digest(dispatch_text)
    pkg: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "dispatch_id": dispatch_id,
        "sprint_id": sprint_id,
        "node_id": node_id,
        "digest": digest,
        "dispatch_md_path": dispatch_md_path,
        "dispatch_json_path": dispatch_json_path,
        "issued_by": issued_by,
        "created_at": created_at or _utc_now(),
        "payload": {
            "schema_version": PAYLOAD_SCHEMA_VERSION,
            "content": {
                "dispatch_text_digest": digest,
                "dispatch_text": dispatch_text,
                "text_payload": dict(payload),
                "content_schema_version": payload.get("schema_version") or "",
            },
        },
    }
    if evidence_refs is not None:
        pkg["evidence_refs"] = list(evidence_refs)
    if evidence_status is not None:
        pkg["evidence_status"] = evidence_status
    return pkg


def write_dispatch_package(path: str | Path, package: dict[str, Any]) -> None:
    package_path = Path(path)
    package_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = package_path.with_suffix(package_path.suffix + ".tmp")
    tmp.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    import os

    os.replace(tmp, package_path)


def validate_evidence_status(evidence_status: str | None) -> list[str]:
    """Validate evidence_status value against allowed enum values.

    Args:
        evidence_status: The evidence_status string to validate, or None.

    Returns:
        List of validation error messages. Empty list means valid.
    """
    if evidence_status is None:
        return []
    if evidence_status not in VALID_EVIDENCE_STATUSES:
        return [
            f"evidence_status '{evidence_status}' is not valid; "
            f"must be one of {sorted(VALID_EVIDENCE_STATUSES)}"
        ]
    return []


def validate_evidence_refs(evidence_refs: list[Any] | None) -> list[str]:
    """Validate evidence_refs list structure.

    Each item must be a dict with at least 'type' and 'ref' string keys.
    The 'type' field must be one of the allowed evidence ref types.

    Args:
        evidence_refs: The evidence_refs list to validate, or None.

    Returns:
        List of validation error messages. Empty list means valid.
    """
    if evidence_refs is None:
        return []
    if not isinstance(evidence_refs, list):
        return ["evidence_refs must be an array"]

    allowed_types = frozenset({
        "artifact_path", "event_id", "action_id", "command_result", "run_dir_file"
    })
    errors: list[str] = []
    for i, item in enumerate(evidence_refs):
        if not isinstance(item, dict):
            errors.append(f"evidence_refs[{i}] must be an object, got {type(item).__name__}")
            continue
        if "type" not in item:
            errors.append(f"evidence_refs[{i}] missing required field 'type'")
        elif item["type"] not in allowed_types:
            errors.append(
                f"evidence_refs[{i}].type '{item['type']}' not valid; "
                f"must be one of {sorted(allowed_types)}"
            )
        if "ref" not in item:
            errors.append(f"evidence_refs[{i}] missing required field 'ref'")
        elif not isinstance(item["ref"], str) or not item["ref"]:
            errors.append(f"evidence_refs[{i}].ref must be a non-empty string")
    return errors


def read_dispatch_package(path: str | Path) -> dict[str, Any] | None:
    """Read a dispatch.json package from disk.

    Returns the parsed package dict, or None if the file does not exist or
    cannot be parsed.
    """
    package_path = Path(path)
    if not package_path.exists():
        return None
    try:
        data = json.loads(package_path.read_text(encoding="utf-8"))
        if data.get("schema_version") != SCHEMA_VERSION:
            return None
        return data
    except Exception:
        return None


def read_dispatch_json_or_md(
    json_path: str | Path,
    md_path: str | Path | None = None,
) -> dict[str, Any]:
    """Read dispatch, preferring JSON and falling back to md.

    Returns a dict with:
      - "source": "json" | "md" | "none"
      - "package": the parsed JSON package (if source=="json")
      - "text": the raw dispatch text (from JSON payload or md file)
      - "digest": the digest (from JSON or computed from md text)
      - "compat_path": True if fell back to md (for evidence logging)
    """
    json_path = Path(json_path)
    md_path = Path(md_path) if md_path else None

    # Try JSON first
    pkg = read_dispatch_package(json_path)
    if pkg is not None:
        payload_content = pkg.get("payload", {}).get("content", {})
        return {
            "source": "json",
            "package": pkg,
            "text": payload_content.get("dispatch_text", ""),
            "digest": pkg.get("digest", ""),
            "compat_path": False,
            "json_path": str(json_path),
            "md_path": pkg.get("dispatch_md_path", ""),
        }

    # Fallback to md
    if md_path and md_path.exists():
        try:
            text = md_path.read_text(encoding="utf-8")
            return {
                "source": "md",
                "package": None,
                "text": text,
                "digest": compute_text_digest(text),
                "compat_path": True,
                "json_path": str(json_path),
                "md_path": str(md_path),
            }
        except Exception:
            pass

    return {
        "source": "none",
        "package": None,
        "text": "",
        "digest": "",
        "compat_path": False,
        "json_path": str(json_path),
        "md_path": str(md_path) if md_path else "",
    }
