#!/usr/bin/env python3
"""Orchestration view helper: single oracle for per-sprint source lineage.

All S04 surfaces (status-server routes, SPA, autopilot, pane evidence, smoke)
call lineage_for_sprint instead of re-parsing RawIntent/requirement-ir schema
files directly. The implementation consumes public helpers from lib/intent_gateway
and lib/intent_consumer only.
"""
from __future__ import annotations

import json
import os
import sys
import importlib.util
from pathlib import Path
from typing import Any

HARNESS_DIR = Path(os.environ.get(
    "SOLAR_HARNESS_DIR",
    Path(__file__).resolve().parents[1],
))
SPRINTS_DIR = Path(os.environ.get(
    "SOLAR_HARNESS_SPRINTS_DIR",
    Path.home() / ".solar" / "harness" / "sprints",
))


def _load_lib_helper(module_name: str) -> Any:
    module_key = f"_solar_lineage_{module_name}"
    if module_key in sys.modules:
        return sys.modules[module_key]
    module_path = HARNESS_DIR / "lib" / f"{module_name}.py"
    spec = importlib.util.spec_from_file_location(module_key, module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_key] = module
    spec.loader.exec_module(module)
    return module


def _intent_gateway() -> Any:
    return _load_lib_helper("intent_gateway")


def _intent_consumer() -> Any:
    return _load_lib_helper("intent_consumer")


def _read_payload(path: Path) -> dict[str, Any] | None:
    """Read JSON through intent_consumer's public artifact helper."""
    if not path.exists():
        return None
    try:
        data = _intent_consumer().read_json(path)
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _display_source_for_channel(channel: str, helper_source: str) -> str:
    if helper_source == "antigravity-app":
        return helper_source
    if not channel:
        return "unknown"
    if channel == "codex_bridge":
        return "codex"
    if channel == "cli_intake":
        return "pm-template"
    if channel == "cli":
        return "verbal"
    return helper_source if helper_source else (channel or "unknown")


def _append_ref(refs: list[str], value: Any) -> None:
    if isinstance(value, str) and value and value not in refs:
        refs.append(value)


def _artifact_refs(raw: dict[str, Any], ir: dict[str, Any] | None = None) -> list[str]:
    refs: list[str] = []
    for item in raw.get("artifact_refs") or []:
        _append_ref(refs, item)

    raw_block = raw.get("raw") if isinstance(raw.get("raw"), dict) else {}
    for item in raw_block.get("attachments") or []:
        _append_ref(refs, item)

    research = _intent_consumer().extract_research_artifact(raw, ir or {})
    if isinstance(research, dict):
        _append_ref(refs, research.get("path"))
        _append_ref(refs, research.get("source_url"))
    return refs


def _empty(degraded_reason: str) -> dict[str, Any]:
    return {
        "source": "unknown",
        "source_channel": "",
        "is_antigravity_desktop": False,
        "conversation_id": None,
        "project_id": None,
        "artifact_refs": [],
        "exported_at": None,
        "bridge_link": None,
        "evidence": {
            "raw_intent_id": None,
            "rawintent_path": None,
            "requirement_ir_path": None,
            "helpers": ["intent_gateway", "intent_consumer"],
        },
        "degraded_reason": degraded_reason,
    }


def _source_from_raw_intent(
    raw: dict[str, Any] | None,
    *,
    raw_path: Path | None = None,
    ir: dict[str, Any] | None = None,
    ir_path: Path | None = None,
) -> dict[str, Any]:
    """Extract source lineage fields from a raw_intent.json payload."""
    if raw is None:
        return _empty("raw_intent_not_found")

    source_block = raw.get("source") or {}
    if not isinstance(source_block, dict):
        source_block = {}
    channel = str(source_block.get("channel") or "").strip()

    helper_source = str(_intent_gateway().requirement_source_for_raw_intent(raw) or "unknown")
    source_name = _display_source_for_channel(channel, helper_source)
    is_antigravity = helper_source == "antigravity-app"

    raw_block = raw.get("raw") or {}
    if not isinstance(raw_block, dict):
        raw_block = {}

    conversation_id = source_block.get("conversation_id") or source_block.get("thread_ref") or None
    project_id = source_block.get("project_id") or None

    exported_at = raw_block.get("received_at") or None
    intent_id = raw.get("intent_id") or None

    bridge_link = None
    if is_antigravity and intent_id:
        bridge_link = f"/orchestration/antigravity-bridge?intent={intent_id}"

    result = {
        "source": source_name,
        "source_channel": channel,
        "is_antigravity_desktop": is_antigravity,
        "conversation_id": conversation_id,
        "project_id": project_id,
        "artifact_refs": _artifact_refs(raw, ir),
        "exported_at": exported_at,
        "bridge_link": bridge_link,
        "evidence": {
            "raw_intent_id": intent_id,
            "rawintent_path": str(raw_path) if raw_path else None,
            "requirement_ir_path": str(ir_path) if ir_path else None,
            "helpers": ["intent_gateway.requirement_source_for_raw_intent", "intent_consumer.read_json", "intent_consumer.extract_research_artifact"],
        },
    }
    if source_name == "unknown":
        result["degraded_reason"] = "missing_source_channel"
    return result


def _source_from_requirement_ir(ir: dict[str, Any], *, ir_path: Path | None = None) -> dict[str, Any]:
    source_details = ir.get("source_details") or {}
    if not isinstance(source_details, dict):
        source_details = {}

    raw_like = {"source": source_details, "raw": {}, "intent_id": ir.get("intent_id")}
    ir_source = str(ir.get("source") or "")
    helper_source = str(ir_source or _intent_gateway().requirement_source_for_raw_intent(raw_like) or "unknown")
    channel = str(source_details.get("channel") or "")
    source_name = _display_source_for_channel(channel, helper_source) if channel else (ir_source or "unknown")
    is_antigravity = source_name == "antigravity-app"

    conversation_id = source_details.get("conversation_id") or source_details.get("thread_ref") or None
    project_id = source_details.get("project_id") or None
    intent_id = ir.get("intent_id") or None
    bridge_link = f"/orchestration/antigravity-bridge?intent={intent_id}" if is_antigravity and intent_id else None

    result = {
        "source": source_name,
        "source_channel": channel,
        "is_antigravity_desktop": is_antigravity,
        "conversation_id": conversation_id,
        "project_id": project_id,
        "artifact_refs": _artifact_refs(raw_like, ir),
        "exported_at": None,
        "bridge_link": bridge_link,
        "evidence": {
            "raw_intent_id": intent_id,
            "rawintent_path": None,
            "requirement_ir_path": str(ir_path) if ir_path else None,
            "helpers": ["intent_gateway.requirement_source_for_raw_intent", "intent_consumer.read_json", "intent_consumer.extract_research_artifact"],
        },
    }
    if source_name == "unknown":
        result["degraded_reason"] = "missing_source_channel"
    return result


def lineage_for_sprint(sprint_id: str) -> dict[str, Any]:
    """Return source lineage view for orchestration surfaces.

    Consumes lib/intent_gateway and lib/intent_consumer public helpers. It
    reads already-produced RawIntent/Requirement IR artifacts but does not
    inspect requirement schema files or introduce bridge-specific intake logic.

    Returns a dict with keys: source, source_channel, is_antigravity_desktop,
    conversation_id, project_id, artifact_refs, exported_at, bridge_link,
    evidence.
    """
    raw_path = SPRINTS_DIR / f"{sprint_id}.raw_intent.json"
    ir_path = SPRINTS_DIR / f"{sprint_id}.requirement_ir.json"
    raw = _read_payload(raw_path)
    ir = _read_payload(ir_path)

    if raw is not None:
        return _source_from_raw_intent(raw, raw_path=raw_path, ir=ir, ir_path=ir_path if ir is not None else None)

    if ir is not None:
        return _source_from_requirement_ir(ir, ir_path=ir_path)

    return _empty("no_raw_intent_or_requirement_ir")


def main(argv: list[str] | None = None) -> int:
    import argparse
    parser = argparse.ArgumentParser(prog="antigravity_orchestration_view")
    parser.add_argument("sprint_id", nargs="?", default="")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    if not args.sprint_id:
        print("Usage: antigravity_orchestration_view.py <sprint_id>", file=sys.stderr)
        return 1

    result = lineage_for_sprint(args.sprint_id)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
