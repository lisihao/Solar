#!/usr/bin/env python3
"""Collect local quota evidence into the operator quota evidence inbox.

This collector is deliberately conservative: it only reads explicitly
configured command/file sources and does not infer quota state from unrelated
CLI output. The evidence scanner owns parsing and database writes.
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import hashlib
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any


HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", str(Path(__file__).resolve().parents[1])))
RUN_DIR = HARNESS_DIR / "run" / "operator-quota-source-collector"
LATEST_PATH = RUN_DIR / "latest.json"
HISTORY_PATH = RUN_DIR / "history.jsonl"
INBOX_DIR = HARNESS_DIR / "run" / "quota-evidence-inbox"
CONFIG_PATH = HARNESS_DIR / "config" / "operator-quota-sources.json"

TEXT_SUFFIXES = {".txt", ".md", ".json", ".log"}
MAX_EVIDENCE_BYTES = 30000

DEFAULT_SOURCES = (
    {
        "name": "codex",
        "command_env": "SOLAR_CODEX_QUOTA_COMMAND",
        "files_env": "SOLAR_CODEX_QUOTA_EVIDENCE_FILES",
    },
    {
        "name": "claude",
        "command_env": "SOLAR_CLAUDE_QUOTA_COMMAND",
        "files_env": "SOLAR_CLAUDE_QUOTA_EVIDENCE_FILES",
    },
)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _iso(moment: dt.datetime | None = None) -> str:
    return (moment or _now()).astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _safe_slug(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in value.strip().lower()).strip("-") or "source"


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")


def _split_command(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [str(part) for part in raw if str(part)]
    return shlex.split(str(raw or ""))


def _extra_sources_from_env() -> list[dict[str, Any]]:
    raw = os.environ.get("SOLAR_QUOTA_SOURCE_COMMANDS_JSON", "").strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except Exception:
        return [{"name": "extra_sources_json", "error": "invalid_json"}]
    sources: list[dict[str, Any]] = []
    if isinstance(data, dict):
        for name, command in data.items():
            sources.append({"name": str(name), "command": command})
    elif isinstance(data, list):
        for idx, item in enumerate(data):
            if isinstance(item, dict):
                sources.append(dict(item))
            else:
                sources.append({"name": f"extra-{idx}", "command": item})
    return sources


def _sources_from_config(path: Path | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    path = path or CONFIG_PATH
    meta: dict[str, Any] = {"path": str(path), "present": path.exists(), "loaded": False, "error": ""}
    if not path.exists():
        return [], meta
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        meta["error"] = f"invalid_json:{type(exc).__name__}"
        return [{"name": "operator_quota_sources_config", "error": meta["error"]}], meta
    raw_sources = data.get("sources") if isinstance(data, dict) else data
    if not isinstance(raw_sources, list):
        meta["error"] = "sources_not_list"
        return [{"name": "operator_quota_sources_config", "error": meta["error"]}], meta
    sources: list[dict[str, Any]] = []
    for idx, item in enumerate(raw_sources):
        if not isinstance(item, dict):
            sources.append({"name": f"config-{idx}", "error": "source_not_object"})
            continue
        if item.get("enabled") is False:
            continue
        entry = {
            "name": str(item.get("name") or f"config-{idx}"),
        }
        if item.get("type"):
            entry["type"] = item["type"]
        for key in ("glob", "max_files"):
            if key in item:
                entry[key] = item[key]
        if item.get("command"):
            entry["command"] = item["command"]
        if item.get("files"):
            entry["files"] = item["files"]
        if not entry.get("command") and not entry.get("files") and not entry.get("type"):
            entry["error"] = "missing_command_or_files"
        sources.append(entry)
    meta["loaded"] = True
    meta["source_count"] = len(sources)
    return sources, meta


def _configured_sources() -> list[dict[str, Any]]:
    config_sources, config_meta = _sources_from_config()
    sources: list[dict[str, Any]] = list(config_sources)
    configured_names = {str(source.get("name") or "") for source in sources}
    for source in DEFAULT_SOURCES:
        if str(source.get("name") or "") in configured_names:
            continue
        entry = dict(source)
        command = os.environ.get(str(entry["command_env"]) or "", "").strip()
        files = os.environ.get(str(entry["files_env"]) or "", "").strip()
        if command:
            entry["command"] = command
        if files:
            entry["files"] = files
        if command or files or not config_meta.get("present"):
            sources.append(entry)
    sources.extend(_extra_sources_from_env())
    return sources


def _read_text_file(path: Path) -> tuple[bool, str, str]:
    if not path.exists() or not path.is_file():
        return False, "", "missing"
    if path.suffix.lower() not in TEXT_SUFFIXES:
        return False, "", "unsupported_suffix"
    try:
        with path.open("rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - MAX_EVIDENCE_BYTES))
            return True, f.read().decode("utf-8", errors="replace"), ""
    except Exception as exc:
        return False, "", f"read_failed:{type(exc).__name__}"


def _file_paths(raw: Any) -> list[Path]:
    if isinstance(raw, list):
        values = [str(item) for item in raw]
    else:
        values = [part for part in str(raw or "").split(os.pathsep) if part.strip()]
    paths: list[Path] = []
    for value in values:
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = HARNESS_DIR / path
        paths.append(path)
    return paths


def _write_inbox_evidence(
    *,
    source_name: str,
    kind: str,
    text: str,
    command: list[str] | None = None,
    path: Path | None = None,
) -> str:
    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()[:16]
    slug = _safe_slug(source_name)
    inbox_path = INBOX_DIR / f"{slug}-{kind}-{digest}.txt"
    header = {
        "source": source_name,
        "kind": kind,
        "command": command or [],
        "path": str(path or ""),
    }
    inbox_path.write_text(
        json.dumps(header, ensure_ascii=False, sort_keys=True) + "\n---\n" + text.strip() + "\n",
        encoding="utf-8",
    )
    return str(inbox_path)


def _run_command(source: dict[str, Any], *, timeout_seconds: int, apply: bool) -> dict[str, Any]:
    name = str(source.get("name") or "command")
    command = _split_command(source.get("command"))
    if not command:
        return {"source": name, "kind": "command", "status": "no_source"}
    try:
        proc = subprocess.run(
            command,
            cwd=str(HARNESS_DIR),
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
        )
    except Exception as exc:
        return {
            "source": name,
            "kind": "command",
            "status": "error",
            "reason": f"command_failed:{type(exc).__name__}",
            "command": command,
            "error": str(exc),
        }
    text = "\n".join(part for part in (proc.stdout, proc.stderr) if part).strip()
    item = {
        "source": name,
        "kind": "command",
        "status": "ok" if proc.returncode == 0 else "nonzero",
        "returncode": proc.returncode,
        "command": command,
        "bytes": len(text.encode("utf-8", errors="replace")),
        "inbox_path": "",
    }
    if text and apply:
        item["inbox_path"] = _write_inbox_evidence(source_name=name, kind="command", text=text, command=command)
    elif not text:
        item["status"] = "empty_output" if proc.returncode == 0 else item["status"]
    return item


def _epoch_to_iso(value: Any) -> str:
    try:
        epoch = float(value)
    except Exception:
        return ""
    if epoch <= 0:
        return ""
    return dt.datetime.fromtimestamp(epoch, tz=dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _codex_model_label(rate_limits: dict[str, Any]) -> str:
    limit_name = str(rate_limits.get("limit_name") or "")
    limit_id = str(rate_limits.get("limit_id") or "")
    material = f"{limit_name} {limit_id}".lower()
    if "gpt-5.3-codex-spark" in material or "bengalfox" in material or "spark" in material:
        return "GPT-5.3-Codex-Spark"
    return ""


def _codex_rate_limits_to_text(*, timestamp: str, rate_limits: dict[str, Any], source_path: str) -> str:
    model_label = _codex_model_label(rate_limits)
    if not model_label:
        return ""
    lines = [
        f"{model_label} 使用限额",
        f"source_path: {source_path}",
        f"observed_at: {timestamp}",
    ]
    for key, label in (("primary", "5 小时使用限额"), ("secondary", "每周使用限制")):
        window = rate_limits.get(key) if isinstance(rate_limits.get(key), dict) else {}
        if not window:
            continue
        try:
            used = float(window.get("used_percent"))
        except Exception:
            continue
        remaining = max(0.0, min(100.0, 100.0 - used))
        reset_at = _epoch_to_iso(window.get("resets_at"))
        lines.extend([label, f"重置时间：{reset_at}", f"剩余 {remaining:g}%"])
    return "\n".join(lines).strip()


def _collect_codex_sessions(source: dict[str, Any], *, apply: bool) -> list[dict[str, Any]]:
    name = str(source.get("name") or "codex-session-rate-limits")
    pattern = str(source.get("glob") or str(Path.home() / ".codex" / "sessions" / "**" / "*.jsonl"))
    try:
        max_files = int(source.get("max_files") or 80)
    except Exception:
        max_files = 80
    try:
        paths = sorted((Path(p) for p in glob.glob(pattern, recursive=True)), key=lambda p: p.stat().st_mtime, reverse=True)[:max_files]
    except Exception as exc:
        return [{"source": name, "kind": "codex_sessions", "status": "error", "reason": f"glob_failed:{type(exc).__name__}"}]

    latest: dict[str, dict[str, Any]] = {}
    for path in paths:
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except Exception:
            continue
        for line in lines:
            try:
                obj = json.loads(line)
            except Exception:
                continue
            payload = obj.get("payload") if isinstance(obj.get("payload"), dict) else {}
            rate_limits = payload.get("rate_limits") if isinstance(payload.get("rate_limits"), dict) else None
            if not rate_limits:
                continue
            model_label = _codex_model_label(rate_limits)
            if not model_label:
                continue
            timestamp = str(obj.get("timestamp") or "")
            key = model_label
            previous = latest.get(key)
            if previous is None or timestamp > str(previous.get("timestamp") or ""):
                latest[key] = {"timestamp": timestamp, "rate_limits": rate_limits, "path": str(path)}

    if not latest:
        return [{"source": name, "kind": "codex_sessions", "status": "no_evidence", "scanned_files": len(paths)}]

    items: list[dict[str, Any]] = []
    for model_label, item in sorted(latest.items()):
        text = _codex_rate_limits_to_text(
            timestamp=str(item.get("timestamp") or ""),
            rate_limits=item.get("rate_limits") if isinstance(item.get("rate_limits"), dict) else {},
            source_path=str(item.get("path") or ""),
        )
        result = {
            "source": name,
            "kind": "codex_sessions",
            "status": "ok" if text else "unparseable",
            "model": model_label,
            "path": str(item.get("path") or ""),
            "bytes": len(text.encode("utf-8", errors="replace")),
            "inbox_path": "",
        }
        if text and apply:
            result["inbox_path"] = _write_inbox_evidence(source_name=name, kind="codex-sessions", text=text, path=Path(str(item.get("path") or "")))
        items.append(result)
    return items


def _collect_files(source: dict[str, Any], *, apply: bool) -> list[dict[str, Any]]:
    name = str(source.get("name") or "files")
    files = source.get("files")
    if not files:
        return [{"source": name, "kind": "file", "status": "no_source"}]
    items: list[dict[str, Any]] = []
    for path in _file_paths(files):
        ok, text, reason = _read_text_file(path)
        item = {
            "source": name,
            "kind": "file",
            "path": str(path),
            "status": "ok" if ok and text.strip() else "empty_or_unreadable",
            "reason": reason,
            "bytes": len(text.encode("utf-8", errors="replace")),
            "inbox_path": "",
        }
        if ok and text.strip() and apply:
            item["inbox_path"] = _write_inbox_evidence(source_name=name, kind="file", text=text, path=path)
        items.append(item)
    return items


def run_scan(*, apply: bool = False, timeout_seconds: int = 15) -> dict[str, Any]:
    started_at = _iso()
    collected: list[dict[str, Any]] = []
    configured_with_source = 0
    _config_sources, config_meta = _sources_from_config()

    for source in _configured_sources():
        if source.get("error"):
            collected.append({"source": str(source.get("name") or "unknown"), "status": "error", "reason": source["error"]})
            continue
        source_type = str(source.get("type") or "").strip().lower()
        if source_type == "codex_sessions":
            configured_with_source += 1
            collected.extend(_collect_codex_sessions(source, apply=apply))
            continue
        has_command = bool(source.get("command"))
        has_files = bool(source.get("files"))
        if has_command:
            configured_with_source += 1
            collected.append(_run_command(source, timeout_seconds=timeout_seconds, apply=apply))
        if has_files:
            configured_with_source += 1
            collected.extend(_collect_files(source, apply=apply))
        if not has_command and not has_files:
            collected.append({"source": str(source.get("name") or "unknown"), "status": "no_source", "reason": "no_configured_command_or_file"})

    written = [item for item in collected if item.get("inbox_path")]
    payload = {
        "ok": True,
        "schema_version": "operator_quota_source_collector.v1",
        "started_at": started_at,
        "finished_at": _iso(),
        "applied": apply,
        "config": config_meta,
        "configured_sources": configured_with_source,
        "collected": len(collected),
        "written": len(written),
        "items": collected[:50],
    }
    _write_json(LATEST_PATH, payload)
    _append_jsonl(HISTORY_PATH, payload)
    return payload


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write collected evidence into quota-evidence-inbox.")
    parser.add_argument("--timeout-seconds", type=int, default=15)
    parser.add_argument("--json", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    payload = run_scan(apply=bool(args.apply), timeout_seconds=int(args.timeout_seconds))
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(
            f"operator_quota_source_collector ok={payload['ok']} applied={payload['applied']} "
            f"configured_sources={payload['configured_sources']} written={payload['written']}"
        )
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
