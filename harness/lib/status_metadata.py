"""Bounded readers for the leading metadata in legacy sprint status files."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Union


DEFAULT_READ_LIMIT = 128 * 1024
DEFAULT_TAIL_READ_LIMIT = 8 * 1024 * 1024
_TOP_LEVEL_ARRAY_END_RE = re.compile(r"(?m)^  \],?\s*$")


def read_status_metadata(
    path: Union[str, Path],
    *,
    read_limit: int = DEFAULT_READ_LIMIT,
) -> Dict[str, Any]:
    """Read fields serialized before ``history`` without loading that array."""
    resolved = Path(path)
    lines = []
    bytes_read = 0
    history_found = False
    reached_eof = False

    with resolved.open(encoding="utf-8") as fh:
        while bytes_read < read_limit:
            line = fh.readline()
            if not line:
                reached_eof = True
                break
            bytes_read += len(line.encode("utf-8"))
            if line.lstrip().startswith('"history"'):
                history_found = True
                break
            lines.append(line)

    if history_found:
        prefix = "".join(lines).rstrip()
        if prefix.endswith(","):
            prefix = prefix[:-1]
        data = json.loads(f"{prefix}\n}}")
    elif reached_eof:
        data = json.loads("".join(lines))
    else:
        # Non-standard field ordering falls back to a full, correctness-first read.
        data = json.loads(resolved.read_text(encoding="utf-8"))

    if not isinstance(data, dict):
        raise ValueError("status document must be a JSON object")
    return data


def read_status_projection_metadata(
    path: Union[str, Path],
    *,
    tail_read_limit: int = DEFAULT_TAIL_READ_LIMIT,
) -> Dict[str, Any]:
    """Read status metadata on both sides of history without parsing history."""
    resolved = Path(path)
    metadata = read_status_metadata(resolved)
    size = resolved.stat().st_size
    with resolved.open("rb") as fh:
        fh.seek(max(0, size - tail_read_limit))
        tail = fh.read().decode("utf-8", errors="replace")

    history_end = _TOP_LEVEL_ARRAY_END_RE.search(tail)
    if history_end is None:
        data = json.loads(resolved.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("status document must be a JSON object")
        data.pop("history", None)
        return data

    suffix = tail[history_end.end():].lstrip()
    if not suffix or suffix == "}":
        return metadata
    trailing = json.loads(f"{{\n{suffix}")
    if not isinstance(trailing, dict):
        raise ValueError("status trailing metadata must be a JSON object")
    trailing.pop("history", None)
    metadata.update(trailing)
    return metadata
