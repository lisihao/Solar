#!/usr/bin/env python3
"""Adapter for normalizing operator outputs into Solar unified artifact schema."""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import shutil
from enum import Enum
from pathlib import Path
from typing import Any

from metadata_validator import OperatorMetadata


class AdaptStatus(str, Enum):
    """Unified output adapter status values."""

    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"


def _now_iso() -> str:
    """Current UTC time in ISO-8601 with Z suffix."""
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def normalize_line(line: str) -> str:
    """Normalize line aliases to canonical operator keys."""
    return {
        "github": "github_trends",
        "github_new": "github_trends",
        "github_legacy": "github_trends",
        "hf-paper": "hf_papers",
        "x-social": "x_social",
    }.get((line or "").strip(), line)


def _strip_html(text: str) -> str:
    """Best-effort conversion of HTML to plain markdown-like text."""
    no_style = re.sub(r"(?is)<(script|style)[^>]*>.*?</\\1>", "", text)
    with_breaks = re.sub(r"(?i)<br\\s*/?>", "\\n", no_style)
    with_breaks = re.sub(r"(?i)</(p|div|h[1-6]|li|tr|td|th)>", "\\n", with_breaks)
    plain = re.sub(r"<[^>]+>", "", with_breaks)
    return html.unescape(plain).strip()


def _find_file(source_dir: Path, candidates: list[str]) -> Path | None:
    """Find first matching file in source_dir using direct or recursive candidate names."""
    for cand in candidates:
        if "*" in cand:
            matches = sorted(source_dir.rglob(cand))
            if matches:
                return matches[0]
            continue
        direct = source_dir / cand
        if direct.exists() and direct.is_file():
            return direct
        matches = sorted(source_dir.rglob(cand))
        if matches:
            return matches[0]
    return None


def _collect_artifact_candidates(source_dir: Path, ext_set: set[str] | None = None) -> list[Path]:
    """Collect files to copy into raw/.

    For github_trends/gemini we keep the set narrow to avoid dumping binary noise.
    """
    files: list[Path] = []
    for path in source_dir.rglob("*"):
        if not path.is_file():
            continue
        if path.name.startswith("."):
            continue
        if ext_set is not None and path.suffix.lower() not in ext_set:
            continue
        files.append(path)
    return sorted(files)


def _copy_tree(files: list[Path], source_dir: Path, target_raw_dir: Path) -> list[str]:
    """Copy source files into raw/ and return canonical artifact paths."""
    rel_paths: list[str] = []
    for src in files:
        rel = src.relative_to(source_dir)
        dst = target_raw_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        rel_paths.append(f"raw/{rel.as_posix()}")
    return rel_paths


def _build_metadata(
    *,
    line: str,
    operator: str,
    role: str,
    run_id: str,
    status: str,
    source_dir: Path,
    raw_dir: Path,
    artifacts: dict[str, Any],
    stdout: str,
    stderr: str,
    started_at: str | None = None,
    finished_at: str | None = None,
) -> OperatorMetadata:
    """Build metadata payload and persist it via OperatorMetadata.to_dict."""
    started_at_val = started_at or os.environ.get("OP_STARTED_AT") or _now_iso()
    finished_at_val = finished_at or _now_iso()

    errors: list[dict[str, Any]] = []
    if stderr:
        errors.append({"source": "stderr", "message": stderr.strip()})
    if stdout:
        errors.append({"source": "stdout", "message": stdout.strip()}) if status == AdaptStatus.FAILED else None

    return OperatorMetadata(
        schema_version="ai_influence_metadata.v1",
        run_id=run_id,
        operator=operator,
        run_status="succeeded" if status == AdaptStatus.SUCCESS else "failed",
        started_at=started_at_val,
        finished_at=finished_at_val,
        line=line,
        role=role,
        status=status,
        artifacts={
            "report_md": "report.md",
            **artifacts,
        },
        errors=errors,
        stats={
            "raw_files": len(list(raw_dir.rglob('*'))) if raw_dir.exists() else 0,
            "source_files": len(list(source_dir.rglob('*'))),
        },
    )


def _write_diagnostic(
    diagnostic_path: Path,
    *,
    line: str,
    operator: str,
    role: str,
    status: str,
    run_id: str,
    source_report: Path | None,
    source_dir: Path,
    stdout: str,
    stderr: str,
    finished_at: str,
) -> None:
    """Write operator diagnostic log."""
    lines = [
        f"line={line}",
        f"operator={operator}",
        f"role={role}",
        f"run_id={run_id}",
        f"status={status}",
        f"source_dir={source_dir}",
        f"source_report={source_report or 'N/A'}",
        f"finished_at={finished_at}",
    ]
    if stdout:
        lines.append("stdout=" + stdout[:4000])
    if stderr:
        lines.append("stderr=" + stderr[:4000])
    diagnostic_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _select_report(
    line: str,
    source_dir: Path,
) -> tuple[Path, str]:
    """Select raw source report and preferred format."""
    candidates_by_line: dict[str, list[str]] = {
        "x_social": [
            "digest.md",
            "report.md",
            "ai-influence-digest.md",
        ],
        "github_trends": [
            "github-trend-report.md",
            "github-trend-report.html",
            "social-trend-report.md",
            "report.md",
        ],
        "hf_papers": [
            "social-trend-report.md",
            "hf-paper-report.md",
            "report.md",
        ],
        "gemini_research": [
            "report.md",
            "*gemini*.html",
            "report.html",
        ],
        "youtube": [
            "*youtube-influence-digest.md",
            "report.md",
            "latest.md",
        ],
    }
    candidates = candidates_by_line.get(line, ["report.md"])
    report_path = _find_file(source_dir, candidates)
    if report_path is None:
        raise FileNotFoundError(f"report file not found in source_dir={source_dir}")
    if report_path.suffix.lower() == ".html":
        return report_path, "html"
    return report_path, "text"


def adapt_operator_output(
    *,
    line: str,
    operator: str,
    role: str,
    run_id: str,
    source_output_dir: str | Path,
    output_dir: str | Path,
    status: str = AdaptStatus.SUCCESS,
    started_at: str | None = None,
    finished_at: str | None = None,
    stdout: str = "",
    stderr: str = "",
) -> Path:
    """
    Normalize operator output into unified directory structure.

    Args:
        line: Logical line id, e.g., x_social / github_trends / hf_papers / gemini_research / youtube.
        operator: Logical operator id from registry.
        role: executor role, e.g., primary / fallback / control.
        run_id: Unique operator run identifier.
        source_output_dir: Directory where original operator wrote artifacts.
        output_dir: Directory where unified output should be written.
        status: Unified status: success|partial|failed.
        started_at: Optional ISO timestamp.
        finished_at: Optional ISO timestamp.
        stdout: Raw stdout from operator.
        stderr: Raw stderr from operator.

    Returns:
        Path to generated output directory.
    """
    if str(status) not in {s.value for s in AdaptStatus}:
        raise ValueError(f"invalid status: {status}")

    canonical_line = normalize_line(line)
    source_dir = Path(source_output_dir).expanduser().resolve()
    if not source_dir.exists():
        raise FileNotFoundError(f"source_output_dir not found: {source_dir}")

    target_dir = Path(output_dir).expanduser().resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    report_target = target_dir / "report.md"
    raw_target = target_dir / "raw"
    metadata_target = target_dir / "metadata.json"
    diagnostic_target = target_dir / "diagnostic.log"

    source_report, report_format = _select_report(canonical_line, source_dir)
    report_text = source_report.read_text(encoding="utf-8", errors="replace")
    if report_format == "html":
        report_text = _strip_html(report_text)

    report_target.write_text((report_text or "").rstrip() + "\n", encoding="utf-8")

    raw_target.mkdir(parents=True, exist_ok=True)
    raw_extensions = {".json"} if canonical_line == "github_trends" else None
    copied = _copy_tree(
        _collect_artifact_candidates(source_dir, ext_set=raw_extensions),
        source_dir=source_dir,
        target_raw_dir=raw_target,
    )

    artifact_map = {
        "report_md": "report.md",
        "raw": "raw/" if copied else "raw/",
    }

    finished_at_val = finished_at or _now_iso()
    metadata = _build_metadata(
        line=canonical_line,
        operator=operator,
        role=role,
        run_id=run_id,
        status=status,
        source_dir=source_dir,
        raw_dir=raw_target,
        artifacts=artifact_map,
        stdout=stdout,
        stderr=stderr,
        started_at=started_at,
        finished_at=finished_at_val,
    )
    metadata_target.write_text(json.dumps(metadata.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")

    _write_diagnostic(
        diagnostic_target,
        line=canonical_line,
        operator=operator,
        role=role,
        status=status,
        run_id=run_id,
        source_report=source_report,
        source_dir=source_dir,
        stdout=stdout,
        stderr=stderr,
        finished_at=finished_at_val,
    )

    return target_dir


def cmd_adapt(args: argparse.Namespace) -> int:
    """CLI entry for single operator adaptation."""
    adapt_operator_output(
        line=args.line,
        operator=args.operator,
        role=args.role,
        run_id=args.run_id,
        source_output_dir=args.source_output_dir,
        output_dir=args.output_dir,
        status=args.status,
        started_at=args.started_at,
        finished_at=args.finished_at,
        stdout=args.stdout,
        stderr=args.stderr,
    )
    return 0


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(description="Adapt operator output to unified schema")
    parser.add_argument("--line", required=True)
    parser.add_argument("--operator", required=True)
    parser.add_argument("--role", default="primary")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--source-output-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--status", default="success")
    parser.add_argument("--started-at")
    parser.add_argument("--finished-at")
    parser.add_argument("--stdout", default="")
    parser.add_argument("--stderr", default="")
    return parser.parse_args()


def main() -> int:
    """CLI entry point."""
    args = parse_args()
    return cmd_adapt(args)


if __name__ == "__main__":
    raise SystemExit(main())
