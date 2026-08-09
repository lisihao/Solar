#!/usr/bin/env python3
"""Utilities for migrating legacy task_graph.json to spec/state/events faces.

The graph scheduler defaults to this split representation while still accepting
legacy single-file DAGs.  For legacy files the migration runs once and stores:
  - <sid>.task_graph.spec.json
  - <sid>.task_dag.state.json
  - <sid>.task_graph.events.jsonl
  - <sid>.task_graph.json.legacy (verbatim copy)

The original <sid>.task_graph.json path is kept as a compatibility mirror generated
from the split state/spec payload.
"""

from __future__ import annotations

import copy
import datetime
import json
import os
import shutil
from pathlib import Path
from typing import Any

try:
    import jsonschema  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    jsonschema = None  # type: ignore[assignment]

HOME = Path(os.environ.get("HOME", ""))
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))
SPRINTS_DIR = Path(os.environ.get("SPRINTS_DIR", HARNESS_DIR / "sprints"))
SCHEMA_DIR = HARNESS_DIR / "schemas"

_LEGACY_SUFFIX = ".task_graph.json.legacy"
_SPEC_SUFFIX = ".task_graph.spec.json"
_STATE_SUFFIX = ".task_dag.state.json"
_EVENTS_SUFFIX = ".task_graph.events.jsonl"
_LEGACY_GRAPH_SUFFIX = ".task_graph.json"


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _read_json_safe(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _append_events(path: Path, events: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for event in events:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")


def _validate_json(path: Path, schema_name: str) -> tuple[bool, str]:
    if jsonschema is None:
        return False, "jsonschema-unavailable"

    schema_path = SCHEMA_DIR / schema_name
    try:
        schema = _read_json_safe(schema_path)
        data = _read_json_safe(path)
    except Exception as exc:
        return False, f"load-error:{type(exc).__name__}"

    try:
        validator_cls = jsonschema.validators.validator_for(schema)
        validator_cls.check_schema(schema)
        validator = validator_cls(schema)
        errors = list(validator.iter_errors(data))
    except jsonschema.ValidationError as exc:  # pragma: no cover
        return False, f"schema-parse-error:{exc.message}"
    except Exception as exc:  # pragma: no cover
        return False, f"schema-validator-error:{type(exc).__name__}"

    if errors:
        first = errors[0]
        return False, f"path={list(first.absolute_path)} reason={first.message}"
    return True, "ok"


def _resolve_layout(graph_path: Path) -> tuple[Path, Path, Path, Path, str, bool]:
    base_dir = graph_path.expanduser().parent
    if graph_path.name.endswith(_SPEC_SUFFIX):
        sid = graph_path.name[:-len(_SPEC_SUFFIX)]
        return (
            Path(graph_path),
            Path(graph_path),
            base_dir / f"{sid}{_STATE_SUFFIX}",
            base_dir / f"{sid}{_EVENTS_SUFFIX}",
            sid,
            False,
        )

    if not graph_path.name.endswith(_LEGACY_GRAPH_SUFFIX):
        sid = graph_path.stem
        return (
            Path(graph_path),
            base_dir / f"{sid}{_STATE_SUFFIX}",
            base_dir / f"{sid}{_EVENTS_SUFFIX}",
            base_dir / f"{graph_path.name}{_LEGACY_SUFFIX}",
            sid,
            False,
        )

    sid = graph_path.name[:-len(_LEGACY_GRAPH_SUFFIX)]
    spec_path = base_dir / f"{sid}{_SPEC_SUFFIX}"
    state_path = base_dir / f"{sid}{_STATE_SUFFIX}"
    events_path = base_dir / f"{sid}{_EVENTS_SUFFIX}"
    legacy_path = base_dir / f"{graph_path.name}.legacy"
    return graph_path, spec_path, state_path, events_path, sid, True


def _edge_list(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    edges: list[dict[str, Any]] = []
    for node in nodes:
        node_id = str(node.get("id") or "").strip()
        if not node_id:
            continue
        for dep in node.get("depends_on", []) or []:
            dep_id = str(dep or "").strip()
            if not dep_id:
                continue
            edges.append({"source": dep_id, "target": node_id})
    # dedupe
    seen: set[tuple[str, str]] = set()
    unique: list[dict[str, Any]] = []
    for edge in edges:
        key = (str(edge["source"]), str(edge["target"]))
        if key in seen:
            continue
        seen.add(key)
        unique.append(edge)
    return unique


def _strip_runtime_node_fields(node: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(node)
    for key in (
        "status",
        "updated_at",
        "assigned_to",
        "dispatch_id",
        "capability_effect",
    ):
        cleaned.pop(key, None)
    return cleaned


def split_legacy_graph(
    graph_path: Path,
    *,
    force: bool = False,
) -> dict[str, Path]:
    graph_payload = _read_json_safe(graph_path)
    if not graph_payload:
        raise ValueError(f"empty_or_invalid_graph:{graph_path}")

    original = graph_path
    source_path, spec_path, state_path, events_path, sid, is_legacy = _resolve_layout(original)
    if not is_legacy:
        raise ValueError(f"split_legacy_graph only supports legacy graph path: {original}")

    legacy_path = source_path.with_name(f"{source_path.name}.legacy")
    # In legacy mode only; for other modes this function is not intended.
    if not force and spec_path.exists() and state_path.exists() and events_path.exists():
        if not legacy_path.exists() and original.exists():
            shutil.copy2(original, legacy_path)
        return {
            "spec": spec_path,
            "state": state_path,
            "events": events_path,
            "legacy": legacy_path,
            "sprint_id": sid,
        }

    if not legacy_path.exists():
        if original.exists():
            shutil.copy2(original, legacy_path)
        else:
            legacy_path.touch()

    # Derive sprint id from payload when filename is unreliable.
    sid = str(graph_payload.get("sprint_id") or graph_payload.get("id") or sid or "").strip() or sid

    nodes = graph_payload.get("nodes")
    if not isinstance(nodes, list):
        nodes = []
    node_results = graph_payload.get("node_results") or {}
    gate_results = graph_payload.get("gate_results") or {}

    spec_nodes: list[dict[str, Any]] = []
    for raw in nodes:
        if isinstance(raw, dict):
            spec_nodes.append(_strip_runtime_node_fields(dict(raw)))

    spec: dict[str, Any] = dict(graph_payload)
    spec["schema_version"] = "solar.task_graph_spec.v1"
    spec["sprint_id"] = sid
    spec["nodes"] = spec_nodes
    spec["edges"] = _edge_list(spec_nodes)
    spec.pop("node_results", None)
    spec.pop("results", None)

    merged_node_status: dict[str, dict[str, Any]] = {}
    compat_node_results: dict[str, Any] = {}

    for raw in nodes:
        if not isinstance(raw, dict):
            continue
        node_id = str(raw.get("id") or "").strip()
        if not node_id:
            continue
        status = str(raw.get("status") or "pending").strip() or "pending"
        if node_id in node_results and isinstance(node_results[node_id], dict):
            status = str(node_results[node_id].get("status") or status).strip() or status
        merged_node_status[node_id] = {
            "status": str(status).lower(),
            "updated_at": str((node_results.get(node_id, {}).get("updated_at") if isinstance(node_results.get(node_id), dict) else "") or raw.get("updated_at") or _now()),
        }
        if isinstance(node_results.get(node_id), dict):
            compat_node_results[node_id] = dict(node_results[node_id])
        else:
            compat_node_results[node_id] = {"status": status, "updated_at": str(raw.get("updated_at") or _now())}

    if isinstance(node_results, dict):
        for node_id, value in node_results.items():
            if node_id not in compat_node_results and isinstance(value, dict):
                compat_node_results[str(node_id)] = dict(value)
                if "status" not in compat_node_results[node_id]:
                    compat_node_results[node_id]["status"] = "pending"
                if "updated_at" not in compat_node_results[node_id]:
                    compat_node_results[node_id]["updated_at"] = _now()

    compat_gate_results: dict[str, Any] = {}
    for gate_id, payload in gate_results.items():
        if not isinstance(payload, dict):
            continue
        compat_gate_results[str(gate_id)] = dict(payload)

    gate_status: dict[str, Any] = {}
    for gate_id in spec.get("required_gates", []) or []:
        raw_gate = compat_gate_results.get(str(gate_id), {})
        gate_status[str(gate_id)] = {
            "status": str(raw_gate.get("status") or "pending").strip() or "pending",
            "updated_at": str(raw_gate.get("updated_at") or _now()),
        }

    leases: dict[str, Any] = {}
    dispatch_ids: dict[str, Any] = {}
    for raw in nodes:
        if not isinstance(raw, dict):
            continue
        node_id = str(raw.get("id") or "").strip()
        if not node_id:
            continue
        assigned_to = str(raw.get("assigned_to") or "").strip()
        dispatch_id = str(raw.get("dispatch_id") or "").strip()
        result = compat_node_results.get(node_id)
        if isinstance(result, dict):
            if assigned_to:
                result["assigned_to"] = assigned_to
            if dispatch_id:
                result["dispatch_id"] = dispatch_id
        if assigned_to:
            leases[node_id] = {"pane": assigned_to, "dispatch_id": dispatch_id}
        if dispatch_id:
            dispatch_ids[node_id] = dispatch_id

    state: dict[str, Any] = {
        "schema_version": "solar.task_graph_state.v1",
        "sprint_id": sid,
        "updated_at": _now(),
        "node_status": copy.deepcopy(merged_node_status),
        "gate_status": copy.deepcopy(gate_status),
        "node_results": copy.deepcopy(compat_node_results),
        "gate_results": copy.deepcopy(compat_gate_results),
        "leases": leases,
        "dispatch_ids": dispatch_ids,
        "graph_ref": f"{sid}{_LEGACY_GRAPH_SUFFIX}",
        "events": [],
        "event_cursor": 0,
    }

    events = [
        {
            "ts": _now(),
            "event": "legacy_task_graph_split",
            "legacy_path": str(legacy_path),
            "state_path": str(state_path),
            "spec_path": str(spec_path),
        }
    ]

    existing_events = graph_payload.get("events")
    if isinstance(existing_events, list):
        for raw in existing_events:
            if isinstance(raw, dict):
                events.append(raw)

    state["events"] = events
    state["event_cursor"] = len(events)

    _write_json_atomic(spec_path, spec)
    _write_json_atomic(state_path, state)
    _append_events(events_path, events)

    compat_graph = dict(spec)
    compat_graph["schema_version"] = "solar.task_graph.v1"
    for raw in compat_graph.get("nodes", []):
        if not isinstance(raw, dict):
            continue
        node_id = str(raw.get("id") or "").strip()
        if not node_id:
            continue
        current = merged_node_status.get(node_id, {}).get("status", "pending")
        raw["status"] = current
        raw["updated_at"] = merged_node_status.get(node_id, {}).get("updated_at", _now())
    compat_graph["node_results"] = copy.deepcopy(compat_node_results)
    compat_graph["gate_results"] = copy.deepcopy(compat_gate_results)
    _write_json_atomic(original, compat_graph)

    return {
        "spec": spec_path,
        "state": state_path,
        "events": events_path,
        "legacy": legacy_path,
        "sprint_id": sid,
    }


def load_graph_for_scheduler(graph_path: str | Path) -> tuple[dict[str, Any], dict[str, Any]]:
    path = Path(graph_path).expanduser()
    if not path.exists():
        return {}, {}

    source_path, spec_path, state_path, events_path, sid, is_legacy = _resolve_layout(path)

    if is_legacy:
        split_legacy_graph(source_path)
        spec_payload = _read_json_safe(spec_path)
        state_payload = _read_json_safe(state_path)
        if not spec_payload and source_path.exists():
            spec_payload = _read_json_safe(source_path)
        if not state_payload and spec_payload:
            state_payload = _build_state_from_spec(spec_payload)
            _write_json_atomic(state_path, state_payload)
        if not events_path.exists():
            _append_events(events_path, [
                {
                    "ts": _now(),
                    "event": "legacy_graph_loaded_no_events",
                    "spec_path": str(spec_path),
                    "state_path": str(state_path),
                },
            ])
        return spec_payload, state_payload

    spec_payload = _read_json_safe(source_path)
    state_payload = _read_json_safe(state_path)
    if not state_payload and spec_payload:
        sid = str(spec_payload.get("sprint_id") or sid or path.stem).strip()
        if sid:
            state_payload = _build_state_from_spec(spec_payload)
            _write_json_atomic(state_path, state_payload)
    return spec_payload, state_payload


def _build_state_from_spec(spec_payload: dict[str, Any]) -> dict[str, Any]:
    sid = str(spec_payload.get("sprint_id") or "").strip()
    nodes = spec_payload.get("nodes")
    if not isinstance(nodes, list):
        nodes = []

    node_status: dict[str, dict[str, str]] = {}
    for raw in nodes:
        if not isinstance(raw, dict):
            continue
        node_id = str(raw.get("id") or "").strip()
        if not node_id:
            continue
        node_status[node_id] = {
            "status": str(raw.get("status") or "pending").strip() or "pending",
            "updated_at": str(raw.get("updated_at") or _now()),
        }

    gate_status: dict[str, dict[str, str]] = {}
    required = spec_payload.get("required_gates") or []
    if isinstance(required, list):
        for gate in required:
            gate_status[str(gate)] = {"status": "pending", "updated_at": _now()}

    return {
        "schema_version": "solar.task_graph_state.v1",
        "sprint_id": sid,
        "updated_at": _now(),
        "node_status": node_status,
        "gate_status": gate_status,
        "node_results": {node_id: {"status": info.get("status", "pending"), "updated_at": info.get("updated_at", _now())} for node_id, info in node_status.items()},
        "gate_results": {gate_id: {"status": info.get("status", "pending"), "updated_at": info.get("updated_at", _now())} for gate_id, info in gate_status.items()},
        "leases": {},
        "dispatch_ids": {},
        "events": [{"ts": _now(), "event": "build_state_from_spec"}],
        "event_cursor": 1,
    }


def validate_split_outputs(graph_path: str | Path) -> dict[str, Any]:
    path = Path(graph_path).expanduser()
    source_path, spec_path, state_path, events_path, _sid, is_legacy = _resolve_layout(path)

    if is_legacy:
        split_legacy_graph(source_path, force=False)

    spec_ok, spec_err = _validate_json(spec_path, "task-graph-spec.schema.json")
    state_ok, state_err = _validate_json(state_path, "task-graph-state.schema.json")

    events_ok = events_path.exists()
    if events_ok:
        try:
            # ensure at least valid JSON lines
            for line in events_path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    json.loads(line)
        except Exception as exc:
            return {
                "ok": False,
                "spec": {"ok": spec_ok, "error": spec_err},
                "state": {"ok": state_ok, "error": state_err},
                "events": {"ok": False, "error": f"events-jsonl:{type(exc).__name__}"},
                "paths": {
                    "spec": str(spec_path),
                    "state": str(state_path),
                    "events": str(events_path),
                },
            }

    return {
        "ok": bool(spec_ok and state_ok and events_ok),
        "spec": {"ok": spec_ok, "error": spec_err},
        "state": {"ok": state_ok, "error": state_err},
        "events": {"ok": events_ok, "error": ""},
        "paths": {
            "spec": str(spec_path),
            "state": str(state_path),
            "events": str(events_path),
        },
    }
