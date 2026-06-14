from __future__ import annotations

import copy
import json
from pathlib import Path

import jsonschema
import pytest


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = ROOT / "schemas"
SCHEMA_FILES = [
    SCHEMA_DIR / "requirement-ir.schema.json",
    SCHEMA_DIR / "requirement-ir.schema.v1.draft.json",
]
EXISTING_REQUIREMENT_SOURCES = [
    "verbal",
    "codex-pm-router",
    "pm-template",
    "chain-watcher",
]


def _load_schema(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _schema_key(path: Path) -> str:
    return path.name


def _main_ir(source: str) -> dict:
    return {
        "schema_version": "solar.requirement_ir.v1",
        "id": "req-antigravity-source-contract",
        "request_type": "implementation",
        "priority": "P0",
        "lane_hint": "architecture",
        "source": source,
        "source_inputs": {
            "raw_request": "Accept Antigravity desktop app as a requirement source.",
            "papers": [],
            "logs": [],
            "repo_context": [],
        },
        "user_intent": "Model Antigravity desktop app ingress.",
        "normalized_goal": "Add antigravity-app to Requirement IR source contract.",
        "assumptions": [],
        "open_questions": [],
        "risk_register": [],
        "requirements": [
            {
                "id": "REQ-source-enum",
                "source_text": "Antigravity desktop app is a requirement source.",
                "success_criteria": ["source=antigravity-app validates"],
                "verification_method": "jsonschema regression",
                "priority": "P0",
            }
        ],
        "scheduling": {
            "queue_class": "architecture",
            "global_priority_boost": 1,
            "lane_hint": "architecture",
        },
        "confidence": 0.95,
        "prd_view": {
            "variant": "standard",
            "sections": [{"title": "Source", "body": "Antigravity app ingress."}],
        },
        "contracts": {
            "product": {},
            "interface": {},
            "agent_execution": {},
            "research": {},
        },
        "dag_view": {"dag_variant": "parallel_spec", "nodes": []},
        "handoff_view": {"codex": {}, "solar_harness": {}},
        "evidence_policy": {},
    }


def _draft_ir(source: str) -> dict:
    return {
        "id": "req-antigravity-source-contract",
        "source": source,
        "type": "delivery",
        "title": "Antigravity app source contract",
        "problem": "Antigravity desktop app ingress must be represented as a requirement source.",
        "goals": ["Accept antigravity-app as Requirement IR source."],
        "non_goals": ["Do not model the desktop app as a physical operator/backend."],
        "user_stories": [
            {
                "persona": "planner",
                "story": "receive Antigravity desktop requirements through the same IR contract",
            }
        ],
        "acceptance": [
            {
                "id": "A1",
                "criterion": "source=antigravity-app validates as Requirement IR.",
                "mapped_to": ["G1_schema"],
            }
        ],
        "constraints": [],
        "risks": [],
        "planner_handoff": {
            "target_role": "planner",
            "mode": "standard",
            "stop_rules": ["no raw-request -> builder bypass"],
            "non_negotiables": ["no raw-request -> builder bypass"],
        },
        "evidence_refs": [],
        "created_at": "2026-06-03T00:00:00Z",
        "compiled_from": "tests/fixtures/antigravity-ingress/req-source.json",
        "compiled_at": "2026-06-03T00:00:00Z",
    }


def _valid_ir_for(schema_path: Path, source: str) -> dict:
    if schema_path.name == "requirement-ir.schema.v1.draft.json":
        return _draft_ir(source)
    return _main_ir(source)


@pytest.mark.parametrize("schema_path", SCHEMA_FILES, ids=_schema_key)
def test_requirement_ir_schema_accepts_antigravity_app_source(schema_path: Path):
    schema = _load_schema(schema_path)

    jsonschema.validate(instance=_valid_ir_for(schema_path, "antigravity-app"), schema=schema)


@pytest.mark.parametrize("schema_path", SCHEMA_FILES, ids=_schema_key)
@pytest.mark.parametrize("source", EXISTING_REQUIREMENT_SOURCES)
def test_existing_requirement_source_values_remain_accepted(schema_path: Path, source: str):
    schema = _load_schema(schema_path)

    jsonschema.validate(instance=_valid_ir_for(schema_path, source), schema=schema)


@pytest.mark.parametrize("schema_path", SCHEMA_FILES, ids=_schema_key)
@pytest.mark.parametrize("field", ["operator", "backend"])
def test_antigravity_app_is_not_a_physical_operator_or_backend(schema_path: Path, field: str):
    schema = _load_schema(schema_path)
    ir = copy.deepcopy(_valid_ir_for(schema_path, "antigravity-app"))
    ir[field] = "antigravity-app"

    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=ir, schema=schema)
