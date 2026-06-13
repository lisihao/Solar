#!/usr/bin/env python3
"""Reconcile wiki dispatch backlog without spending model tokens.

The wiki dispatch queue is a control-plane backlog. Knowledge extraction itself
must run through the local ThunderOMLX semantic extractor. This tool only
reconciles stale dispatch files against existing extraction manifests and source
file availability.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any


HOME = Path.home()
DEFAULT_VAULT = HOME / "Knowledge"


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_frontmatter(text: str) -> tuple[dict[str, str], str, str]:
    if not text.startswith("---\n"):
        return {}, "", text
    end = text.find("\n---", 4)
    if end < 0:
        return {}, "", text
    raw = text[4:end]
    body = text[end + 4 :]
    data: dict[str, str] = {}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        data[key.strip()] = value.strip().strip("\"'")
    return data, raw, body


def render_frontmatter(data: dict[str, str], body: str) -> str:
    preferred = [
        "type",
        "action",
        "skill",
        "generated_at",
        "vault_path",
        "status",
        "repair_reason",
        "reconcile_reason",
        "source",
        "resolved_source",
        "project",
        "dispatched_at",
        "target_pane",
        "completed_at",
        "skipped_at",
        "reconciled_at",
        "extract_output",
    ]
    keys = [key for key in preferred if key in data]
    keys.extend(sorted(key for key in data if key not in set(keys)))
    lines = ["---"]
    for key in keys:
        value = data.get(key, "")
        lines.append(f"{key}: {value}")
    lines.append("---")
    return "\n".join(lines) + body


def load_success_manifests(vault: Path) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    root = vault / "_manifests" / "thunderomlx"
    if not root.exists():
        return out
    for path in root.glob("*.ingest.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except Exception:
            continue
        sem = data.get("semantic_extract") if isinstance(data.get("semantic_extract"), dict) else {}
        if sem.get("status") != "extract_indexed":
            continue
        source = str(data.get("source_path") or "")
        if not source:
            continue
        out[str(Path(source).expanduser())] = {
            "manifest": str(path),
            "output": str(sem.get("output_path") or ""),
        }
    return out


def build_name_index(vault: Path) -> dict[str, list[Path]]:
    roots = [vault / "_raw", vault / "_sources", vault]
    index: dict[str, list[Path]] = {}
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            index.setdefault(path.name, []).append(path)
    return index


def resolve_source(raw: str, vault: Path, name_index: dict[str, list[Path]]) -> Path | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    path = Path(raw).expanduser()
    if path.exists():
        return path
    if raw.startswith("/tmp/ai-influence-raw/"):
        parts = Path(raw).parts
        if len(parts) >= 4:
            date = parts[-2]
            candidate = vault / "_raw" / "ai-influence-daily-digest" / date / Path(raw).name
            if candidate.exists():
                return candidate
    for candidate in name_index.get(Path(raw).name, []):
        if candidate.exists():
            return candidate
    return None


def update_status(path: Path, data: dict[str, str], body: str, *, status: str, reason: str, extra: dict[str, str] | None = None, apply: bool) -> None:
    data = dict(data)
    data["status"] = status
    data["reconcile_reason"] = reason
    data["reconciled_at"] = now_iso()
    if status == "completed":
        data["completed_at"] = data["reconciled_at"]
        data["target_pane"] = "thunderomlx-local"
    if status == "skipped":
        data["skipped_at"] = data["reconciled_at"]
    for key, value in (extra or {}).items():
        if value:
            data[key] = value
    if apply:
        path.write_text(render_frontmatter(data, body), encoding="utf-8")


def reconcile(args: argparse.Namespace) -> dict[str, Any]:
    vault = Path(args.vault).expanduser()
    dispatch_dir = Path(args.dispatch_dir).expanduser()
    success = load_success_manifests(vault)
    name_index = build_name_index(vault)
    seen_pending_sources: set[str] = set()
    counts: Counter[str] = Counter()
    samples: list[dict[str, str]] = []

    for path in sorted(dispatch_dir.glob("wiki-*.md"), key=lambda item: item.stat().st_mtime, reverse=True):
        text = path.read_text(encoding="utf-8", errors="replace")
        data, _raw, body = parse_frontmatter(text)
        if data.get("type") != "wiki-dispatch":
            continue
        if data.get("status", "pending") != "pending":
            continue
        raw_source = data.get("source") or data.get("reingest_source") or ""
        resolved = resolve_source(raw_source, vault, name_index)
        resolved_s = str(resolved) if resolved else ""
        manifest = success.get(resolved_s) if resolved_s else None
        if not raw_source:
            decision = ("skipped", "missing_source", {})
        elif not resolved:
            decision = ("skipped", "source_missing", {})
        elif manifest:
            decision = ("completed", "already_extracted_by_thunderomlx", {"resolved_source": resolved_s, "extract_output": manifest.get("output", "")})
        elif resolved_s in seen_pending_sources:
            decision = ("skipped", "duplicate_pending_same_source", {"resolved_source": resolved_s})
        else:
            seen_pending_sources.add(resolved_s)
            decision = ("pending", "awaiting_thunderomlx_extract", {"resolved_source": resolved_s})

        status, reason, extra = decision
        counts[f"{status}:{reason}"] += 1
        if status != "pending":
            update_status(path, data, body, status=status, reason=reason, extra=extra, apply=args.apply)
        elif extra and args.apply:
            # Keep the dispatch pending but persist the resolved source so the
            # local extractor path can consume it directly later.
            patched = dict(data)
            patched.update(extra)
            patched["reconcile_reason"] = reason
            patched["reconciled_at"] = now_iso()
            path.write_text(render_frontmatter(patched, body), encoding="utf-8")

        if len(samples) < args.sample_limit:
            samples.append({
                "file": str(path),
                "source": raw_source or "N/A",
                "resolved_source": resolved_s or "N/A",
                "decision": f"{status}:{reason}",
            })

    return {
        "ok": True,
        "applied": bool(args.apply),
        "dispatch_dir": str(dispatch_dir),
        "vault": str(vault),
        "counts": dict(counts),
        "samples": samples,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Reconcile wiki dispatch backlog without model calls")
    parser.add_argument("--vault", default=str(DEFAULT_VAULT))
    parser.add_argument("--dispatch-dir", default=str(DEFAULT_VAULT / "_raw" / "solar-harness" / ".dispatch"))
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--sample-limit", type=int, default=20)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    result = reconcile(args)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
