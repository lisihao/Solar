"""context_store.py — Context packet store for actor task envelopes.

Loads/stores context packets referenced by task envelopes,
without pane-memory dependence.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

HOME = Path.home()
HARNESS_DIR = Path.home() / ".solar" / "harness"
CONTEXT_STORE_DIR = HARNESS_DIR / "run" / "context-store"


@dataclass(frozen=True)
class ContextResolution:
    """Structured result for context packet reference resolution."""

    status: str
    failure_reason: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    packet_id: Optional[str] = None
    path: Optional[str] = None
    packet_type: Optional[str] = None
    expires_at: Optional[str] = None
    packet_hash: Optional[str] = None
    staleness_warning: bool = False
    path_backed: bool = False

    @property
    def resolved(self) -> bool:
        return self.status == "resolved"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "resolved": self.resolved,
            "status": self.status,
            "failure_reason": self.failure_reason,
            "packet_id": self.packet_id,
            "path": self.path,
            "packet_type": self.packet_type,
            "expires_at": self.expires_at,
            "packet_hash": self.packet_hash,
            "staleness_warning": self.staleness_warning,
            "path_backed": self.path_backed,
        }


class ContextStore:
    """File-based context packet store."""

    def __init__(self, store_dir: Optional[Path] = None):
        self.store_dir = store_dir or CONTEXT_STORE_DIR

    def save(self, packet_id: str, data: Dict[str, Any]) -> str:
        self.store_dir.mkdir(parents=True, exist_ok=True)
        path = self.store_dir / f"{packet_id}.json"
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        return str(path)

    def load(self, packet_id: str) -> Optional[Dict[str, Any]]:
        path = self.store_dir / f"{packet_id}.json"
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None

    def resolve_ref(self, ref: Optional[Dict[str, str]]) -> Optional[Dict[str, Any]]:
        """Resolve a context_packet_ref {path, packet_id} to actual data."""
        return self.resolve_ref_detail(ref).data

    def resolve_ref_detail(
        self,
        ref: Optional[Dict[str, str]],
        expected_packet_type: Optional[str] = None,
    ) -> ContextResolution:
        """Resolve a packet ref and return metadata without changing legacy callers."""
        if not ref:
            return ContextResolution(status="missing", failure_reason="none_ref")

        pid = ref.get("packet_id")
        if pid:
            path = self.store_dir / f"{pid}.json"
            data, raw, failure = self._read_packet(path)
            if failure:
                return ContextResolution(
                    status="missing" if failure == "path_missing" else "corrupt",
                    failure_reason="missing_packet" if failure == "path_missing" else failure,
                    packet_id=pid,
                    path=str(path),
                )
            return self._classify_packet(
                data=data,
                raw=raw,
                path=path,
                ref_packet_id=pid,
                path_backed=False,
                expected_packet_type=expected_packet_type,
            )

        path_value = ref.get("path")
        if path_value:
            path = self._resolve_path(path_value)
            data, raw, failure = self._read_packet(path)
            if failure:
                return ContextResolution(
                    status="missing" if failure == "path_missing" else "corrupt",
                    failure_reason=failure,
                    path=str(path),
                    path_backed=True,
                )
            return self._classify_packet(
                data=data,
                raw=raw,
                path=path,
                ref_packet_id=None,
                path_backed=True,
                expected_packet_type=expected_packet_type,
            )

        return ContextResolution(status="missing", failure_reason="empty_ref")

    def _resolve_path(self, path_value: str) -> Path:
        path = Path(path_value)
        if not path.is_absolute():
            path = HARNESS_DIR / path
        return path

    def _read_packet(self, path: Path) -> Tuple[Optional[Dict[str, Any]], bytes, Optional[str]]:
        if not path.exists():
            return None, b"", "path_missing"
        try:
            raw = path.read_bytes()
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return None, b"", "corrupt_json"
        except (OSError, UnicodeDecodeError):
            return None, b"", "path_unreadable"
        if not isinstance(data, dict):
            return None, b"", "wrong_type"
        return data, raw, None

    def _classify_packet(
        self,
        data: Optional[Dict[str, Any]],
        raw: bytes,
        path: Path,
        ref_packet_id: Optional[str],
        path_backed: bool,
        expected_packet_type: Optional[str],
    ) -> ContextResolution:
        if data is None:
            return ContextResolution(status="corrupt", failure_reason="corrupt_json", path=str(path))

        packet_id = self._metadata_str(data, "packet_id") or ref_packet_id
        packet_type = self._metadata_str(data, "packet_type")
        expires_at = self._metadata_str(data, "expires_at")
        packet_hash = hashlib.sha256(raw).hexdigest() if raw else None
        staleness_warning = self._staleness_warning(data, expires_at)

        base = {
            "data": data,
            "packet_id": packet_id,
            "path": str(path),
            "packet_type": packet_type,
            "expires_at": expires_at,
            "packet_hash": packet_hash,
            "staleness_warning": staleness_warning,
            "path_backed": path_backed,
        }
        if expected_packet_type and packet_type != expected_packet_type:
            return ContextResolution(status="wrong_type", failure_reason="wrong_type", **base)
        if self._is_expired(expires_at):
            return ContextResolution(status="expired", failure_reason="expired", **base)
        if staleness_warning:
            return ContextResolution(status="stale", failure_reason="stale", **base)
        return ContextResolution(status="resolved", **base)

    @staticmethod
    def _metadata_str(data: Dict[str, Any], key: str) -> Optional[str]:
        value = data.get(key)
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _parse_time(value: Optional[str]) -> Optional[dt.datetime]:
        if not value:
            return None
        text = value.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            parsed = dt.datetime.fromisoformat(text)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)

    @classmethod
    def _is_expired(cls, expires_at: Optional[str]) -> bool:
        parsed = cls._parse_time(expires_at)
        if parsed is None:
            return False
        return parsed <= dt.datetime.now(dt.timezone.utc)

    def _staleness_warning(self, data: Dict[str, Any], expires_at: Optional[str]) -> bool:
        if self._is_expired(expires_at):
            return True
        for key in ("stale", "staleness_warning", "context_packet_staleness_warning"):
            value = data.get(key)
            if value is True:
                return True
            if isinstance(value, str) and value.strip().lower() in {"1", "true", "yes"}:
                return True
        return False
