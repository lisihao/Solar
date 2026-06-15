from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from lib.operator_registry_loader import (
    EXPECTED_SCHEMA_VERSION,
    VALID_SCHEDULES,
    RegistryLoadError,
    RegistryValidationError,
    audit_file_existence,
    load_registry,
)

SCHEMA_VERSION = "solar.operator_registry_audit.v1"
_HARNESS_ROOT = Path(__file__).resolve().parents[1]

@dataclass(frozen=True)
class FileRef:
    path: str
    exists: bool
    source_key: str

@dataclass(frozen=True)
class LineAudit:
    name: str
    primary: FileRef
    executors: tuple[FileRef, ...]
    fallback: tuple[FileRef, ...]
    control: tuple[FileRef, ...]
    helper: tuple[FileRef, ...]
    schedule: str | None
    schedule_valid: bool
    output_dir: str | None
    output_dir_exists: bool
    missing_files: tuple[FileRef, ...]

@dataclass(frozen=True)
class AuditView:
    schema_version: str
    generated_at: str
    registry_path: str
    registry_mtime: float
    registry_sha256: str
    schema_ok: bool
    lines: tuple[LineAudit, ...]
    summary: dict[str, Any]
    issues: tuple[dict[str, Any], ...]

def _sha(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return ""

def _mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0

def _ref(path: str, exists: bool, key: str) -> FileRef:
    return FileRef(path=str(path or ""), exists=bool(exists), source_key=key)

def _refs(items: list[dict[str, Any]], line: str, role: str) -> tuple[FileRef, ...]:
    return tuple(_ref(i.get("path", ""), i.get("exists", False), f"lines.{line}.{role}[{n}]") for n, i in enumerate(items))

def _issue(severity: str, code: str, message: str, line: str | None, key: str) -> dict[str, Any]:
    return {"severity": severity, "code": code, "message": message, "line": line, "key": key}

def build_audit_view(
    registry: dict[str, Any] | None = None,
    harness_root: Path | None = None,
    registry_path: Path | None = None,
) -> AuditView:
    root = Path(harness_root or _HARNESS_ROOT)
    reg_path = Path(registry_path) if registry_path else root / "config" / "operator_registry.json"
    schema_ok = True
    issues: list[dict[str, Any]] = []

    if registry is None:
        try:
            registry = load_registry(registry_path=reg_path, harness_root=root, use_cache=True)
        except (RegistryLoadError, RegistryValidationError) as exc:
            schema_ok = False
            registry = {}
            issues.append(_issue("error", "SCHEMA_MISMATCH", str(exc), None, "schema_version"))
    registry = registry or {}
    if registry.get("schema_version") != EXPECTED_SCHEMA_VERSION:
        schema_ok = False
        msg = f"schema_version={registry.get('schema_version')!r} != {EXPECTED_SCHEMA_VERSION!r}"
        issues.append(_issue("error", "SCHEMA_MISMATCH", msg, None, "schema_version"))
    raw_lines = registry.get("lines") if isinstance(registry.get("lines"), dict) else {}
    if not raw_lines:
        schema_ok = False
        issues.append(_issue("error", "SCHEMA_MISMATCH", "Registry has no lines", None, "lines"))

    try:
        existence = audit_file_existence(registry=registry, harness_root=root) if raw_lines else {}
    except Exception:
        existence = {}
    audits: list[LineAudit] = []
    for name, line_def in raw_lines.items():
        line_def = line_def if isinstance(line_def, dict) else {}
        ex = existence.get(name, {}) if isinstance(existence.get(name), dict) else {}
        primary_data = ex.get("primary") or {"path": line_def.get("primary", ""), "exists": False}
        primary = _ref(primary_data.get("path", ""), primary_data.get("exists", False), f"lines.{name}.primary")
        if not primary.exists:
            issues.append(_issue("error", "MISSING_PRIMARY", f"Primary file not found: {primary.path!r}", name, primary.source_key))

        roles = {role: _refs(ex.get(role, []), name, role) for role in ("executors", "fallback", "control", "helper")}
        for item in roles["executors"]:
            if not item.exists:
                issues.append(_issue("warn", "MISSING_EXECUTOR", f"Executor file not found: {item.path!r}", name, item.source_key))

        schedule = line_def.get("schedule")
        schedule_valid = schedule is None or schedule in VALID_SCHEDULES
        if not schedule_valid:
            msg = f"Invalid schedule {schedule!r} (valid: {sorted(VALID_SCHEDULES)})"
            issues.append(_issue("error", "INVALID_SCHEDULE", msg, name, f"lines.{name}.schedule"))
        output_dir = line_def.get("output_dir")
        output_exists = True if output_dir is None else (root / str(output_dir)).is_dir()
        if output_dir is not None and not output_exists:
            issues.append(_issue("warn", "MISSING_OUTPUT_DIR", f"output_dir not found: {output_dir!r}", name, f"lines.{name}.output_dir"))
        all_refs = (primary,) + roles["executors"] + roles["fallback"] + roles["control"] + roles["helper"]
        audits.append(
            LineAudit(
                name=name,
                primary=primary,
                executors=roles["executors"],
                fallback=roles["fallback"],
                control=roles["control"],
                helper=roles["helper"],
                schedule=schedule,
                schedule_valid=schedule_valid,
                output_dir=output_dir,
                output_dir_exists=output_exists,
                missing_files=tuple(r for r in all_refs if not r.exists),
            )
        )
    summary = {
        "total_lines": len(audits),
        "total_files": sum(1 + len(a.executors) + len(a.fallback) + len(a.control) + len(a.helper) for a in audits),
        "missing_files": sum(len(a.missing_files) for a in audits),
        "error_count": sum(1 for i in issues if i["severity"] == "error"),
        "warn_count": sum(1 for i in issues if i["severity"] == "warn"),
        "info_count": sum(1 for i in issues if i["severity"] == "info"),
    }
    return AuditView(
        schema_version=SCHEMA_VERSION,
        generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        registry_path=str(reg_path),
        registry_mtime=_mtime(reg_path),
        registry_sha256=_sha(reg_path),
        schema_ok=schema_ok,
        lines=tuple(audits),
        summary=summary,
        issues=tuple(issues),
    )

def to_json(view: AuditView) -> dict[str, Any]:
    return asdict(view)

def _mark(value: bool) -> str:
    return "yes" if value else "no"

def to_markdown(view: AuditView) -> str:
    s = view.summary
    lines = [
        "# Operator Registry Audit",
        f"- Generated: {view.generated_at}",
        f"- Registry: `{view.registry_path}`",
        f"- Schema OK: {_mark(view.schema_ok)}",
        f"- Summary: {s['total_lines']} lines | {s['total_files']} files | {s['missing_files']} missing | {s['error_count']} errors | {s['warn_count']} warnings",
        "",
    ]
    if view.issues:
        lines += ["## Issues", "| severity | code | line | message |", "|---|---|---|---|"]
        lines += [f"| {i['severity']} | `{i['code']}` | {i.get('line') or ''} | {i['message']} |" for i in view.issues] + [""]
    lines += ["## Lines", "| name | primary | exists | schedule | schedule_valid | output_dir_exists | missing |", "|---|---|---|---|---|---|---|"]
    lines += [
        f"| {a.name} | `{a.primary.path}` | {_mark(a.primary.exists)} | {a.schedule or ''} | {_mark(a.schedule_valid)} | {_mark(a.output_dir_exists)} | {len(a.missing_files)} |"
        for a in view.lines
    ]
    return "\n".join(lines) + "\n"

def to_html(view: AuditView, template_path: Path | None = None) -> str:
    title = "Operator Registry Audit"
    body = to_markdown(view).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    sections = "\n".join(f"<section><pre>{chunk}</pre></section>" for chunk in body.split("\n\n") if chunk.strip())
    if template_path is None:
        template_path = _HARNESS_ROOT / "templates" / "html-artifact.visual-template.html"
    try:
        html = template_path.read_text(encoding="utf-8")
        for key, value in {
            "{{TITLE}}": title,
            "{{META_LINE}}": view.generated_at,
            "{{PRIORITY}}": "OK" if view.schema_ok and not view.summary["error_count"] else "ISSUES",
            "{{LANE}}": f"{view.summary['total_lines']} lines",
            "{{ROLE}}": "audit-view",
            "{{STATE_HINT}}": f"{view.summary['error_count']}E/{view.summary['warn_count']}W",
        }.items():
            html = html.replace(key, value)
        return html.replace("</div>\n</body>", sections + "\n</div>\n</body>")
    except OSError:
        return f"<!doctype html><html><head><title>{title}</title></head><body>{sections}</body></html>"
