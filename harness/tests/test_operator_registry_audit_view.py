from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from lib.operator_registry_audit_view import SCHEMA_VERSION, AuditView, build_audit_view, to_json, to_markdown


def _registry(tmp_path: Path, lines: dict, schema: str = "solar.operator_registry.v1") -> Path:
    path = tmp_path / "config" / "operator_registry.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"schema_version": schema, "lines": lines}), encoding="utf-8")
    return path


def _script(tmp_path: Path, name: str) -> None:
    path = tmp_path / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/usr/bin/env python3\n", encoding="utf-8")


def test_load_normal_registry_passes_schema(tmp_path: Path) -> None:
    _script(tmp_path, "scripts/primary.py")
    reg = _registry(tmp_path, {"line_a": {"primary": "scripts/primary.py", "executors": [], "fallback": [], "schedule": "daily"}})
    view = build_audit_view(harness_root=tmp_path, registry_path=reg)
    assert isinstance(view, AuditView)
    assert view.schema_version == SCHEMA_VERSION
    assert view.schema_ok is True
    assert view.lines[0].primary.exists is True
    assert view.summary["error_count"] == 0


def test_missing_primary_yields_error_issue(tmp_path: Path) -> None:
    reg = _registry(tmp_path, {"missing": {"primary": "scripts/nope.py", "executors": [], "fallback": []}})
    view = build_audit_view(harness_root=tmp_path, registry_path=reg)
    assert "MISSING_PRIMARY" in [item["code"] for item in view.issues]
    assert view.lines[0].primary.exists is False
    assert view.summary["error_count"] >= 1


def test_invalid_schedule_yields_error_issue(tmp_path: Path) -> None:
    _script(tmp_path, "scripts/primary.py")
    view = build_audit_view(
        registry={"schema_version": "solar.operator_registry.v1", "lines": {"bad": {"primary": "scripts/primary.py", "schedule": "monthly"}}},
        harness_root=tmp_path,
    )
    assert "INVALID_SCHEDULE" in [item["code"] for item in view.issues]
    assert view.lines[0].schedule_valid is False


def test_non_existing_output_dir_yields_warn_issue(tmp_path: Path) -> None:
    _script(tmp_path, "scripts/primary.py")
    view = build_audit_view(
        registry={
            "schema_version": "solar.operator_registry.v1",
            "lines": {"line": {"primary": "scripts/primary.py", "output_dir": "reports/missing"}},
        },
        harness_root=tmp_path,
    )
    assert "MISSING_OUTPUT_DIR" in [item["code"] for item in view.issues]
    assert view.lines[0].output_dir_exists is False


def test_empty_lines_yields_schema_error(tmp_path: Path) -> None:
    reg = _registry(tmp_path, {})
    view = build_audit_view(harness_root=tmp_path, registry_path=reg)
    assert view.schema_ok is False
    assert "SCHEMA_MISMATCH" in [item["code"] for item in view.issues]


def test_cli_json_format_round_trip_via_subprocess(tmp_path: Path) -> None:
    _script(tmp_path, "scripts/primary.py")
    reg = _registry(tmp_path, {"line": {"primary": "scripts/primary.py", "executors": [], "fallback": [], "schedule": "on_demand"}})
    out = tmp_path / "audit.json"
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "tools" / "operator_registry_audit.py"),
            "audit",
            "--format",
            "json",
            "--out",
            str(out),
            "--registry",
            str(reg),
            "--harness-root",
            str(tmp_path),
        ],
        capture_output=True,
        text=True,
    )
    data = json.loads(out.read_text(encoding="utf-8"))
    assert result.returncode == 0
    assert data["schema_ok"] is True
    assert data["schema_version"] == SCHEMA_VERSION
    assert len(data["lines"]) == 1


def test_solar_harness_operator_registry_route_writes_json(tmp_path: Path) -> None:
    _script(tmp_path, "scripts/primary.py")
    reg = _registry(tmp_path, {"line": {"primary": "scripts/primary.py", "executors": [], "fallback": [], "schedule": "on_demand"}})
    out = tmp_path / "route-audit.json"
    env = os.environ.copy()
    env["HARNESS_DIR"] = str(ROOT)
    result = subprocess.run(
        [
            "bash",
            str(ROOT / "solar-harness.sh"),
            "operator-registry",
            "audit",
            "--format",
            "json",
            "--out",
            str(out),
            "--registry",
            str(reg),
            "--harness-root",
            str(tmp_path),
        ],
        capture_output=True,
        text=True,
        env=env,
    )
    data = json.loads(out.read_text(encoding="utf-8"))
    assert result.returncode == 0
    assert data["schema_ok"] is True
    assert data["schema_version"] == SCHEMA_VERSION
    assert len(data["lines"]) == 1


def test_to_markdown_produces_table_rows(tmp_path: Path) -> None:
    for i in range(7):
        _script(tmp_path, f"scripts/line{i}.py")
    view = build_audit_view(
        registry={
            "schema_version": "solar.operator_registry.v1",
            "lines": {f"line_{i}": {"primary": f"scripts/line{i}.py"} for i in range(7)},
        },
        harness_root=tmp_path,
    )
    assert len([line for line in to_markdown(view).splitlines() if line.startswith("|")]) >= 9


def test_to_json_round_trip(tmp_path: Path) -> None:
    _script(tmp_path, "scripts/primary.py")
    view = build_audit_view(
        registry={"schema_version": "solar.operator_registry.v1", "lines": {"line": {"primary": "scripts/primary.py"}}},
        harness_root=tmp_path,
    )
    parsed = json.loads(json.dumps(to_json(view)))
    assert parsed["schema_ok"] is True
    assert parsed["schema_version"] == SCHEMA_VERSION
