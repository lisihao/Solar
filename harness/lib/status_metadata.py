"""Bounded readers for the leading metadata in legacy sprint status files."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Union


DEFAULT_READ_LIMIT = 128 * 1024


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
