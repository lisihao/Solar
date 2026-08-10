#!/usr/bin/env python3
"""Extract quota observations from local UI/TUI/log evidence."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", str(Path(__file__).resolve().parents[1])))
LIB_DIR = HARNESS_DIR / "lib"
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))

import operator_cooldown_db  # type: ignore
import operator_flow_control  # type: ignore


RUN_DIR = HARNESS_DIR / "run" / "operator-quota-evidence-scanner"
LATEST_PATH = RUN_DIR / "latest.json"
HISTORY_PATH = RUN_DIR / "history.jsonl"
SEEN_PATH = RUN_DIR / "seen.json"
INBOX_DIR = HARNESS_DIR / "run" / "quota-evidence-inbox"
TUI_DIR = HARNESS_DIR / "run" / "tui-signals"
RESULTS_DIR = HARNESS_DIR / "run" / "operator-results"
REGISTRY_PATH = HARNESS_DIR / "config" / "physical-operators.json"

REMAINING_RE = re.compile(r"(?:剩余|remaining)\s*[:：]?\s*(?P<pct>\d+(?:\.\d+)?)\s*%", re.I)
INLINE_REMAINING_RE = re.compile(
    r"(?P<window>weekly|monthly|5\s*h(?:our)?|5\s*小时|每周|每月|周|月)?"
    r".{0,40}?(?:剩余|remaining)\s*[:：]?\s*(?P<pct>\d+(?:\.\d+)?)\s*%",
    re.I,
)
RESET_LINE_RE = re.compile(r"(?:重置时间|reset\s*time|reset(?:s)?(?:\s+at)?)\s*[:：]?\s*(?P<value>[^\n,;]+)", re.I)
OBSERVED_AT_RE = re.compile(r"observed_at\s*[:：]\s*(?P<value>[^\n]+)", re.I)
CN_DATE_RE = re.compile(r"(?P<month>\d{1,2})\s*月\s*(?P<day>\d{1,2})\s*日?")
TIME_ONLY_RE = re.compile(r"^(?P<hour>\d{1,2}):(?P<minute>\d{2})(?::\d{2})?\s*(?P<ampm>am|pm)?$", re.I)
EN_MONTH_DAY_RE = re.compile(
    r"(?P<month>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    r"aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+"
    r"(?P<day>\d{1,2})",
    re.I,
)
LIMIT_HIT_RE = re.compile(r"you(?:'|’)ve hit .*limit|usage limit|monthly usage limit|quota exhausted|rate[- ]?limit", re.I)
WINDOW_TERMS = (
    ("weekly", ("weekly", "每周", "周使用", "week")),
    ("monthly", ("monthly", "每月", "月使用", "month")),
    ("5h", ("5 小时", "5小时", "5 hour", "5-hour", "5h")),
)
MONTHS = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _iso(moment: dt.datetime | None = None) -> str:
    return (moment or _now()).astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _local_tz() -> dt.tzinfo:
    try:
        return ZoneInfo(os.environ.get("TZ") or "America/Toronto")
    except Exception:
        return dt.timezone.utc


def _load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")


def _load_registry() -> dict[str, Any]:
    data = _load_json(REGISTRY_PATH, {"operators": {}})
    return data if isinstance(data, dict) else {"operators": {}}


def _model_key_from_operator(op: dict[str, Any]) -> str:
    pool = op.get("builder_pool") if isinstance(op.get("builder_pool"), dict) else {}
    group = str(pool.get("group") or "").strip()
    if group:
        return group
    model = str(op.get("model") or "").strip().lower()
    if "gpt-5.3-codex-spark" in model:
        return "codex-gpt-5.3-spark"
    if "gpt-5.5" in model:
        return "codex-gpt-5.5"
    if model == "opus":
        return "claude-opus"
    if model == "sonnet":
        return "claude-sonnet"
    return model


def _model_key_from_text(text: str) -> str:
    lower = text.lower()
    if "gpt-5.3-codex-spark" in lower or "codex-spark" in lower or "spark" in lower:
        return "codex-gpt-5.3-spark"
    if "gpt-5.5" in lower or "codex 5.5" in lower or "codex-gpt-5.5" in lower:
        return "codex-gpt-5.5"
    if "opus" in lower:
        return "claude-opus"
    if "sonnet" in lower:
        return "claude-sonnet"
    return ""


def _window_from_text(text: str, fallback: str = "") -> str:
    lower = text.lower()
    for window, terms in WINDOW_TERMS:
        if any(term in lower for term in terms):
            return window
    return fallback


def _parse_reset_value(raw: str, *, now: dt.datetime) -> str:
    value = str(raw or "").strip()
    if not value:
        return ""
    parsed = operator_cooldown_db.parse_time(value)
    if parsed is not None:
        return _iso(parsed)

    local_tz = _local_tz()
    base = now.astimezone(local_tz)
    match = CN_DATE_RE.search(value)
    if match:
        month = int(match.group("month"))
        day = int(match.group("day"))
        candidate = dt.datetime(base.year, month, day, 0, 0, tzinfo=local_tz)
        if candidate <= base:
            candidate = candidate.replace(year=base.year + 1)
        return _iso(candidate)
    match = EN_MONTH_DAY_RE.search(value)
    if match:
        month = MONTHS.get(str(match.group("month") or "").lower().rstrip("."))
        day = int(match.group("day"))
        if month:
            candidate = dt.datetime(base.year, month, day, 0, 0, tzinfo=local_tz)
            if candidate <= base:
                candidate = candidate.replace(year=base.year + 1)
            return _iso(candidate)
    match = TIME_ONLY_RE.search(value)
    if match:
        hour = int(match.group("hour"))
        minute = int(match.group("minute"))
        ampm = str(match.group("ampm") or "").lower()
        if ampm == "pm" and hour < 12:
            hour += 12
        elif ampm == "am" and hour == 12:
            hour = 0
        candidate = base.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= base:
            candidate = candidate + dt.timedelta(days=1)
        return _iso(candidate)
    reset = operator_flow_control.parse_rate_limit_reset_at(f"resets {value}", now=now)
    if reset is not None:
        return _iso(reset)
    return ""


def parse_quota_observations(text: str, *, now: dt.datetime | None = None) -> list[dict[str, Any]]:
    now_dt = now or _now()
    raw = str(text or "")
    if not raw.strip():
        return []
    observed_at = ""
    observed_match = OBSERVED_AT_RE.search(raw)
    if observed_match:
        parsed_observed = operator_cooldown_db.parse_time(observed_match.group("value").strip())
        if parsed_observed is not None:
            observed_at = _iso(parsed_observed)
    model_key = _model_key_from_text(raw)
    observations: list[dict[str, Any]] = []
    current_window = ""
    current_reset = ""

    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    for line in lines:
        current_window = _window_from_text(line, current_window)
        reset_match = RESET_LINE_RE.search(line)
        if reset_match:
            current_reset = _parse_reset_value(reset_match.group("value"), now=now_dt)
        for match in INLINE_REMAINING_RE.finditer(line):
            pct = float(match.group("pct"))
            window = _window_from_text(match.group("window") or line, current_window)
            reset_at = current_reset
            reset_match = RESET_LINE_RE.search(line)
            if reset_match:
                reset_at = _parse_reset_value(reset_match.group("value"), now=now_dt)
            observations.append(
                {
                    "model_key": model_key,
                    "quota_window": window,
                    "remaining_percent": pct,
                    "reset_at": reset_at,
                    "observed_at": observed_at,
                }
            )

    if not observations and LIMIT_HIT_RE.search(raw):
        reset_at = _iso(operator_flow_control.parse_rate_limit_reset_at(raw, now=now_dt)) if operator_flow_control.parse_rate_limit_reset_at(raw, now=now_dt) else ""
        observations.append(
            {
                "model_key": model_key,
                "quota_window": _window_from_text(raw),
                "remaining_percent": 0.0,
                "reset_at": reset_at,
                "observed_at": observed_at,
            }
        )
    return observations


def _evidence_items(max_age_seconds: int) -> list[dict[str, Any]]:
    now = _now()
    items: list[dict[str, Any]] = []
    for path in sorted(INBOX_DIR.glob("**/*")) if INBOX_DIR.exists() else []:
        if not path.is_file() or path.suffix.lower() not in {".txt", ".md", ".json", ".log"}:
            continue
        items.append({"path": path, "source": "quota_evidence_inbox", "operator_id": ""})
    for path in sorted((TUI_DIR / "latest").glob("*.json")) if (TUI_DIR / "latest").exists() else []:
        data = _load_json(path, {})
        if not isinstance(data, dict):
            continue
        items.append(
            {
                "path": path,
                "source": "tui_signal_latest",
                "operator_id": str(data.get("operator_id") or ""),
                "text": str(data.get("excerpt") or ""),
            }
        )
    if RESULTS_DIR.exists():
        cutoff = now.timestamp() - max_age_seconds if max_age_seconds > 0 else 0
        for path in sorted(RESULTS_DIR.glob("*/*/output.log"), key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)[:200]:
            try:
                if max_age_seconds > 0 and path.stat().st_mtime < cutoff:
                    continue
            except OSError:
                continue
            items.append({"path": path, "source": "operator_result_log", "operator_id": path.parent.parent.name})
    return items


def _read_evidence_text(item: dict[str, Any]) -> str:
    if item.get("text"):
        return str(item["text"])
    path = Path(item["path"])
    if path.suffix.lower() == ".json":
        data = _load_json(path, {})
        if isinstance(data, dict):
            return "\n".join(str(data.get(key) or "") for key in ("text", "excerpt", "recent_window", "bottom_window", "content"))
    try:
        with path.open("rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - 20000))
            return f.read().decode("utf-8", errors="replace")
    except Exception:
        return ""


def _operator_ids_for_model(registry: dict[str, Any], model_key: str, operator_id: str = "") -> list[str]:
    operators = registry.get("operators") if isinstance(registry.get("operators"), dict) else {}
    if operator_id and operator_id in operators:
        return [operator_id]
    if not model_key:
        return []
    result = []
    for op_id, op in operators.items():
        if isinstance(op, dict) and _model_key_from_operator(op) == model_key:
            result.append(str(op_id))
    return sorted(result)


def _item_observed_at(item: dict[str, Any]) -> str:
    explicit = operator_cooldown_db.parse_time(item.get("observed_at"))
    if explicit is not None:
        return _iso(explicit)
    try:
        mtime = dt.datetime.fromtimestamp(Path(item["path"]).stat().st_mtime, tz=dt.timezone.utc)
    except Exception:
        return ""
    return _iso(mtime)


def _seen_observation_needs_replay(entry: dict[str, Any]) -> bool:
    try:
        remaining = float(entry.get("remaining_percent"))
    except Exception:
        return False
    operator_id = str(entry.get("operator_id") or "")
    block = operator_cooldown_db.current_cooldown_block(operator_id, prune_expired=False)
    if remaining <= 0:
        reset = operator_cooldown_db.parse_time(entry.get("reset_at"))
        if reset is not None and reset <= _now():
            return False
        return not (
            isinstance(block, dict)
            and str(block.get("runtime_state") or "") in {"cooldown", "quota_exhausted"}
        )
    if isinstance(block, dict) and str(block.get("runtime_state") or "") in {"quota_exhausted", "auth_expired"}:
        recovery = operator_cooldown_db.quota_recovery_observation(operator_id, block=block)
        if not isinstance(recovery, dict):
            return True
    latest = operator_cooldown_db.latest_quota_observation(
        operator_id,
        quota_window=str(entry.get("quota_window") or ""),
    )
    if not isinstance(latest, dict):
        return True
    try:
        latest_remaining = float(latest.get("remaining_percent"))
    except Exception:
        return True
    if latest_remaining <= 0:
        return True
    return not (
        str(latest.get("reset_at") or "") == str(entry.get("reset_at") or "")
        and str(latest.get("evidence_path") or "") == str(entry.get("evidence_path") or "")
    )


def run_scan(*, apply: bool = False, max_age_seconds: int = 7200) -> dict[str, Any]:
    registry = _load_registry()
    seen = _load_json(SEEN_PATH, {})
    if not isinstance(seen, dict):
        seen = {}
    scanned = 0
    extracted: list[dict[str, Any]] = []
    recorded: list[dict[str, Any]] = []

    for item in _evidence_items(max_age_seconds):
        text = _read_evidence_text(item)
        if not text.strip():
            continue
        scanned += 1
        item_observed_at = _item_observed_at(item)
        parse_now = operator_cooldown_db.parse_time(item_observed_at) or _now()
        observations = parse_quota_observations(text, now=parse_now)
        for observation in observations:
            observed_at = str(observation.get("observed_at") or item_observed_at or "").strip()
            if observed_at and max_age_seconds > 0:
                parsed_observed = operator_cooldown_db.parse_time(observed_at)
                if parsed_observed is not None and (_now() - parsed_observed).total_seconds() > max_age_seconds:
                    continue
            model_key = str(observation.get("model_key") or "").strip()
            operator_ids = _operator_ids_for_model(registry, model_key, str(item.get("operator_id") or ""))
            if not operator_ids:
                continue
            for operator_id in operator_ids:
                op = registry.get("operators", {}).get(operator_id, {}) if isinstance(registry.get("operators"), dict) else {}
                source_path = str(item.get("path") or "")
                digest = hashlib.sha256(
                    json.dumps(
                        {
                            "operator_id": operator_id,
                            "model_key": model_key,
                            "window": observation.get("quota_window"),
                            "remaining": observation.get("remaining_percent"),
                            "reset": observation.get("reset_at"),
                            "source_path": source_path,
                            "excerpt": text[-500:],
                        },
                        ensure_ascii=False,
                        sort_keys=True,
                    ).encode("utf-8")
                ).hexdigest()
                entry = {
                    "operator_id": operator_id,
                    "model_key": model_key or _model_key_from_operator(op),
                    "provider": str(op.get("provider") or ""),
                    "billing_pool": str(op.get("billing_pool") or ""),
                    "key_ref": str(op.get("key_ref") or ""),
                    "scope": "model_key" if model_key else "operator_id",
                    "quota_window": str(observation.get("quota_window") or ""),
                    "remaining_percent": observation.get("remaining_percent"),
                    "reset_at": str(observation.get("reset_at") or ""),
                    "observed_at": observed_at,
                    "source": str(item.get("source") or "quota_evidence_scanner"),
                    "evidence_ref": f"quota_evidence_scanner:{digest[:16]}",
                    "evidence_path": source_path,
                    "evidence_excerpt": text[-1200:],
                }
                if seen.get(digest) and not _seen_observation_needs_replay(entry):
                    continue
                extracted.append(entry)
                if apply:
                    result = operator_cooldown_db.record_quota_observation(**entry)
                    recorded.append({"operator_id": operator_id, "ok": bool(result.get("ok")), "active_block": bool(result.get("active_block"))})
                    seen[digest] = _iso()

    if apply:
        _write_json(SEEN_PATH, seen)
    payload = {
        "ok": True,
        "schema_version": "operator_quota_evidence_scanner.v1",
        "generated_at": _iso(),
        "applied": apply,
        "scanned": scanned,
        "extracted": len(extracted),
        "recorded": len(recorded),
        "recorded_active_blocks": sum(1 for item in recorded if item.get("active_block")),
        "extracted_items": extracted[:50],
        "recorded_items": recorded[:50],
    }
    _write_json(LATEST_PATH, payload)
    _append_jsonl(HISTORY_PATH, payload)
    return payload


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Record extracted observations into cooldown DB.")
    parser.add_argument("--max-age-seconds", type=int, default=7200)
    parser.add_argument("--json", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    payload = run_scan(apply=bool(args.apply), max_age_seconds=int(args.max_age_seconds))
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(
            f"operator_quota_evidence_scanner ok={payload['ok']} applied={payload['applied']} "
            f"scanned={payload['scanned']} extracted={payload['extracted']} recorded={payload['recorded']}"
        )
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
