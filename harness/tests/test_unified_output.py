"""Tests for unified output adapter and metadata validator minimal schema."""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

HARNESS_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(HARNESS_ROOT) not in sys.path:
    sys.path.insert(0, str(HARNESS_ROOT))

import lib.unified_output_adapter as unified_output_adapter
from lib.metadata_validator import validate_metadata


def _write(path: pathlib.Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


@pytest.mark.parametrize(
    "line,operator,source_paths",
    [
        (
            "x_social",
            "ai_influence_daily",
            {
                "digest.md": "# x social digest\ncontent\n",
                "digest.json": "{\"items\": [1]}",
            },
        ),
        (
            "github_trends",
            "tech_hotspot_radar",
            {
                "github-trend-report.md": "# github trend\ncontent\n",
                "github-trend-report.json": "{\"cards\": [1]}",
            },
        ),
        (
            "hf_papers",
            "tech_hotspot_radar",
            {
                "social-trend-report.md": "# hf papers\ncontent\n",
                "social-trend-report.json": "{\"cards\": [1]}",
            },
        ),
        (
            "gemini_research",
            "gemini_deep_research",
            {
                "report.html": "<html><body><h1>Gemini</h1><p>research result</p></body></html>",
            },
        ),
        (
            "youtube",
            "youtube_influence_digest",
            {
                "2026-06-01/abc/abc-youtube-influence-digest.md": "# youtube digest\ncontent\n",
                "2026-06-01/abc/video-item.json": "{}",
            },
        ),
    ],
)
def test_adapt_operator_output(tmp_path, line: str, operator: str, source_paths: dict[str, str]) -> None:
    """Each operator should output report.md/raw/metadata.json/diagnostic.log."""
    source = tmp_path / "source"
    for rel, content in source_paths.items():
        _write(source / rel, content)

    target = tmp_path / "unified" / line / "run-001"
    unified_output_adapter.adapt_operator_output(
        line=line,
        operator=operator,
        role="primary",
        run_id="run-001",
        source_output_dir=str(source),
        output_dir=str(target),
        status="success",
        stdout="ok",
        stderr="",
    )

    assert (target / "report.md").is_file()
    assert (target / "raw").is_dir()
    assert (target / "metadata.json").is_file()
    assert (target / "diagnostic.log").is_file()

    meta = json.loads((target / "metadata.json").read_text(encoding="utf-8"))
    assert meta["line"] == line
    assert meta["operator"] == operator
    assert meta["role"] == "primary"
    assert meta["run_id"] == "run-001"
    assert meta["status"] == "success"
    assert len(list((target / "raw").rglob("*"))) > 0


def test_validate_metadata_missing_required_field() -> None:
    """Canonical required fields should fail when missing."""
    data = {
        "line": "x_social",
        "operator": "x_social",
        "role": "primary",
    }
    result = validate_metadata(data)
    assert not result.ok
    assert any(item["code"] in {"E_MISSING_RUN_ID", "E_MISSING_STATUS"} for item in result.errors)

def test_validate_metadata_invalid_status() -> None:
    """Invalid unified status should fail validation."""
    data = {
        "line": "x_social",
        "operator": "x_social",
        "role": "primary",
        "run_id": "run-001",
        "status": "invalid",
    }
    result = validate_metadata(data)
    assert not result.ok
    assert any(item["code"] == "E_INVALID_STATUS" for item in result.errors)


def test_validate_metadata_valid_passes() -> None:
    """A canonical metadata document with all required fields should pass."""
    data = {
        "line": "github_trends",
        "operator": "tech_hotspot_radar",
        "role": "primary",
        "run_id": "run-042",
        "status": "success",
    }
    result = validate_metadata(data)
    assert result.ok
    assert result.errors == []


def test_adapted_metadata_passes_validator(tmp_path) -> None:
    """metadata.json produced by the adapter must satisfy the validator (real call chain)."""
    source = tmp_path / "source"
    _write(source / "digest.md", "# x social digest\ncontent\n")

    target = tmp_path / "unified" / "x_social" / "run-007"
    unified_output_adapter.adapt_operator_output(
        line="x_social",
        operator="ai_influence_daily",
        role="primary",
        run_id="run-007",
        source_output_dir=str(source),
        output_dir=str(target),
        status="success",
    )

    meta = json.loads((target / "metadata.json").read_text(encoding="utf-8"))
    result = validate_metadata(meta)
    assert result.ok, result.errors
