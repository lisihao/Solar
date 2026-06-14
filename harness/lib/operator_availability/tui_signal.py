"""TUI Signal Plane: scrubbed snapshots, extraction, and JSONL ledger."""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
import subprocess
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

from operator_availability.failure_classifier import FailureClassifier


HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))
TUI_SIGNALS_DIR = HARNESS_DIR / "run" / "tui-signals"


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


_SECRET_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"sk-[a-zA-Z0-9]{16,}"), "[SCRUBBED]"),
    (re.compile(r"ghp_[a-zA-Z0-9]{20,}"), "[SCRUBBED]"),
    (re.compile(r"Bearer\s+[a-zA-Z0-9\-._~+/=]{8,}", re.I), "Bearer [SCRUBBED]"),
    (
        re.compile(r"(?i)\b(api[_-]?key|password|token|secret|credential)\s*[=:]\s*[^\s\"']{6,}"),
        r"\1=[SCRUBBED]",
    ),
]

_DISPATCH_MARKER_RE = re.compile(
    r"(?P<dispatch_id>pm-[\w.-]+|graph-[\w.-]+)|"
    r"(?P<sprint_id>sprint-\d{8}-[\w-]+)|"
    r"\bNode:\s*(?P<node_id>[A-Z]\d+)\b|"
    r"(?P<instruction_file>[\w./~-]+\.dispatch\.md)"
)


def scrub_tui_text(text: str) -> str:
    scrubbed = text or ""
    for pattern, replacement in _SECRET_PATTERNS:
        scrubbed = pattern.sub(replacement, scrubbed)
    return scrubbed


def _line_window(text: str, count: int, *, min_count: int, max_count: int) -> list[str]:
    count = max(min_count, min(max_count, count))
    lines = text.splitlines()
    return lines[-count:] if lines else []


def _redacted_hash(scrubbed_text: str) -> str:
    return hashlib.sha256(scrubbed_text.encode("utf-8")).hexdigest()


def _source_tool(text: str, pane_title: str = "", command: str = "") -> str:
    haystack = f"{pane_title}\n{command}\n{text}".lower()
    if "antigravity" in haystack:
        return "antigravity"
    if "codex" in haystack:
        return "codex_cli"
    if "claude" in haystack:
        return "claude_code"
    if "gemini" in haystack:
        return "gemini_cli"
    return "unknown"


def _dispatch_markers(text: str) -> dict[str, str]:
    markers: dict[str, str] = {}
    for match in _DISPATCH_MARKER_RE.finditer(text or ""):
        for key, value in match.groupdict().items():
            if value and key not in markers:
                markers[key] = value
    return markers


def _excerpt(text: str, limit: int = 240) -> str:
    compact = " ".join(scrub_tui_text(text).split())
    return compact[:limit]


@dataclass
class TUISnapshot:
    snapshot_id: str
    operator_id: str
    pane: str
    title: str
    current_command: str
    copy_mode: bool
    bottom_window: str
    recent_window: str
    dispatch_marker: dict[str, str]
    scrubbed_hash: str
    redacted_sha256: str
    timestamp: str
    bottom_lines: list[str] = field(default_factory=list)
    recent_lines: list[str] = field(default_factory=list)
    source_tool: str = "unknown"
    raw_snapshot_ref: str = ""

    @property
    def pane_id(self) -> str:
        return self.pane

    def to_record(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class TUISignal:
    signal_id: str
    snapshot_id: str
    operator_id: str
    pane: str
    source: str
    category: str
    type: str
    severity: str
    confidence: Any
    scope_hint: str
    expires_at: str
    excerpt: str
    raw_snapshot_ref: str
    propagates_to_billing_pool: bool = False
    recovery_action: str = "investigate"
    ledger_target: str = "failure"
    captured_at: str = ""

    @property
    def signal_type(self) -> str:
        return self.type

    @property
    def evidence_excerpt(self) -> str:
        return self.excerpt

    def to_record(self) -> dict[str, Any]:
        return asdict(self)


class TUICollector:
    """Captures tmux panes into scrubbed TUI snapshots."""

    def __init__(
        self,
        *,
        bottom_lines: int = 12,
        recent_lines: int = 120,
        command_timeout_seconds: float = 2.0,
    ) -> None:
        self.bottom_lines = bottom_lines
        self.recent_lines = recent_lines
        self.command_timeout_seconds = command_timeout_seconds

    def capture_tmux_pane(
        self,
        pane: str,
        operator_id: str,
        task_context: Optional[dict[str, Any]] = None,
    ) -> TUISnapshot:
        metadata = self._tmux_metadata(pane)
        recent = self._tmux_capture(pane, self.recent_lines)
        return self.capture_text(
            operator_id,
            recent,
            pane=pane,
            title=metadata.get("title", ""),
            current_command=metadata.get("current_command", ""),
            copy_mode=metadata.get("copy_mode", "0") == "1",
            task_context=task_context,
        )

    def capture_text(
        self,
        operator_id: str,
        text: str,
        *,
        pane: str = "",
        title: str = "",
        current_command: str = "",
        copy_mode: bool = False,
        task_context: Optional[dict[str, Any]] = None,
    ) -> TUISnapshot:
        scrubbed = scrub_tui_text(text)
        marker_text = "\n".join([scrubbed, json.dumps(task_context or {}, sort_keys=True)])
        markers = _dispatch_markers(marker_text)
        bottom = _line_window(scrubbed, self.bottom_lines, min_count=8, max_count=16)
        recent = _line_window(scrubbed, self.recent_lines, min_count=80, max_count=200)
        snapshot_id = str(uuid.uuid4())
        digest = _redacted_hash(scrubbed)
        return TUISnapshot(
            snapshot_id=snapshot_id,
            operator_id=operator_id,
            pane=pane or operator_id,
            title=title,
            current_command=current_command,
            copy_mode=copy_mode,
            bottom_window="\n".join(bottom),
            recent_window="\n".join(recent),
            dispatch_marker=markers,
            scrubbed_hash=digest[:16],
            redacted_sha256=digest,
            timestamp=_now_iso(),
            bottom_lines=bottom,
            recent_lines=recent,
            source_tool=_source_tool(scrubbed, title, current_command),
            raw_snapshot_ref=snapshot_id,
        )

    def _tmux_metadata(self, pane: str) -> dict[str, str]:
        fmt = "#{pane_title}\t#{pane_current_command}\t#{pane_in_mode}"
        result = self._run_tmux(["display-message", "-p", "-t", pane, fmt])
        title, command, copy_mode = (result.split("\t") + ["", "", "0"])[:3]
        return {"title": title, "current_command": command, "copy_mode": copy_mode}

    def _tmux_capture(self, pane: str, recent_lines: int) -> str:
        start = f"-{max(80, min(200, recent_lines))}"
        return self._run_tmux(["capture-pane", "-p", "-J", "-S", start, "-t", pane])

    def _run_tmux(self, args: list[str]) -> str:
        completed = subprocess.run(
            ["tmux", *args],
            check=True,
            capture_output=True,
            text=True,
            timeout=self.command_timeout_seconds,
        )
        return completed.stdout.rstrip("\n")


class TUISignalExtractor:
    """Extracts typed signals from scrubbed snapshots."""

    def __init__(self, *, classifier: Optional[FailureClassifier] = None) -> None:
        self.classifier = classifier or FailureClassifier()

    def extract(self, snapshot: TUISnapshot) -> list[TUISignal]:
        signals: list[TUISignal] = []
        for source, text, source_confidence in (
            ("tmux_bottom", snapshot.bottom_window, 0.85),
            ("tmux_recent", snapshot.recent_window, 0.6),
        ):
            if not text.strip():
                continue
            classification = self.classifier.classify(
                text,
                context=snapshot.pane,
                operator_id=snapshot.operator_id,
                source=source,
                source_confidence=source_confidence,
            )
            signals.append(self._signal_from_classification(snapshot, classification, source, text))
            break
        return signals

    def extract_text(self, text: str, source: str, context: dict[str, Any]) -> list[TUISignal]:
        collector = TUICollector()
        snapshot = collector.capture_text(
            str(context.get("operator_id") or "unknown"),
            text,
            pane=str(context.get("pane") or ""),
            title=str(context.get("title") or ""),
            current_command=str(context.get("current_command") or ""),
            copy_mode=bool(context.get("copy_mode") or False),
            task_context=context,
        )
        signals = self.extract(snapshot)
        for signal in signals:
            signal.source = source
        return signals

    def extract_signals(self, snapshot: TUISnapshot, *, source: str = "tmux_bottom") -> list[TUISignal]:
        signals = self.extract(snapshot)
        for signal in signals:
            signal.source = source
        return signals

    def _signal_from_classification(
        self,
        snapshot: TUISnapshot,
        classification: Any,
        source: str,
        text: str,
    ) -> TUISignal:
        severity = {
            "quota": "error",
            "auth": "error",
            "transport": "warn",
            "closeout": "warn",
            "modal": "info",
            "unknown": "info",
        }.get(classification.category, "warn")
        return TUISignal(
            signal_id=str(uuid.uuid4()),
            snapshot_id=snapshot.snapshot_id,
            operator_id=snapshot.operator_id,
            pane=snapshot.pane,
            source=source,
            category=classification.category,
            type=classification.type,
            severity=severity,
            confidence=classification.confidence,
            scope_hint=classification.scope_hint,
            expires_at=classification.expires_at,
            excerpt=_excerpt(text),
            raw_snapshot_ref=snapshot.raw_snapshot_ref or snapshot.snapshot_id,
            propagates_to_billing_pool=bool(classification.propagates_to_billing_pool),
            recovery_action=classification.recovery_action,
            ledger_target=classification.ledger_target,
            captured_at=_now_iso(),
        )


class TUISignalLedger:
    """Persists scrubbed snapshots and typed TUI signals."""

    def __init__(self, *, run_root: Optional[Path] = None) -> None:
        self.run_root = Path(run_root) if run_root else TUI_SIGNALS_DIR
        self.signals_path = self.run_root / "signals.jsonl"
        self.snapshots_dir = self.run_root / "snapshots"
        self.latest_dir = self.run_root / "latest"

    def _ensure(self) -> None:
        self.signals_path.parent.mkdir(parents=True, exist_ok=True)
        self.snapshots_dir.mkdir(parents=True, exist_ok=True)
        self.latest_dir.mkdir(parents=True, exist_ok=True)

    def append_snapshot(self, snapshot: TUISnapshot) -> str:
        self._ensure()
        ref = self.snapshots_dir / f"{snapshot.snapshot_id}.json"
        data = snapshot.to_record()
        data["raw_snapshot_ref"] = str(ref)
        tmp = ref.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
        tmp.replace(ref)
        return str(ref)

    def append(self, signals: list[TUISignal]) -> None:
        for signal in signals:
            self.append_signal(signal)

    def append_signal(self, signal: TUISignal) -> str:
        self._ensure()
        line = json.dumps(signal.to_record(), ensure_ascii=False, sort_keys=True)
        with open(self.signals_path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        latest_path = self.latest_dir / f"{signal.operator_id}.json"
        tmp = latest_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(signal.to_record(), indent=2, sort_keys=True), encoding="utf-8")
        tmp.replace(latest_path)
        return signal.signal_id

    def head(self, operator_id: str, *, max_age_seconds: int = 3600) -> list[TUISignal]:
        cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=max_age_seconds)
        head: list[TUISignal] = []
        for record in self.read_signals(operator_id=operator_id):
            captured = record.get("captured_at") or record.get("timestamp") or ""
            if captured:
                try:
                    dt = datetime.datetime.strptime(captured, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
                    if dt < cutoff:
                        continue
                except ValueError:
                    pass
            head.append(TUISignal(**record))
        return head

    def get_latest(self, operator_id: str) -> Optional[TUISignal]:
        path = self.latest_dir / f"{operator_id}.json"
        if not path.exists():
            return None
        try:
            return TUISignal(**json.loads(path.read_text(encoding="utf-8")))
        except Exception:
            return None

    def read_signals(self, *, limit: int = 100, operator_id: Optional[str] = None) -> list[dict[str, Any]]:
        if not self.signals_path.exists():
            return []
        results: list[dict[str, Any]] = []
        with open(self.signals_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if operator_id and record.get("operator_id") != operator_id:
                    continue
                results.append(record)
        return results[-limit:]


def capture_tui_snapshot(
    operator_id: str,
    pane_text: str,
    *,
    pane_name: str = "",
    bottom_lines: int = 12,
    recent_lines: int = 120,
) -> TUISnapshot:
    """Create a scrubbed TUI snapshot from already captured pane text."""
    return TUICollector(bottom_lines=bottom_lines, recent_lines=recent_lines).capture_text(
        operator_id,
        pane_text,
        pane=pane_name or operator_id,
    )
