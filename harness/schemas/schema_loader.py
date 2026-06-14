"""Schema loader for Solar Harness P0 fact-source schemas.

Provides discovery, loading, and validation utilities for the 11 first-class
fact-source schemas that form the S03 core-runtime data plane.

Extended in N4_loader_compat to support v2 capsule/operator/access-path
schemas with structured error reporting and legacy-compatible defaults.
"""

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import jsonschema
import yaml

SCHEMA_DIR = Path(__file__).resolve().parent

FIRST_CLASS_FACT_SCHEMAS = (
    "request-envelope.schema.json",
    "requirement-ir.schema.json",
    "contract-manifest.schema.json",
    "traceability.schema.json",
    "task-graph-spec.schema.json",
    "task-graph-state.schema.json",
    "dispatch-package.schema.json",
    "operator.schema.json",
    "operator-plan.schema.json",
    "closure.schema.json",
    "source-evidence-bundle.schema.json",
)

V2_EXTENSION_SCHEMAS = (
    "access-path-decision.schema.json",
    "evolution-runtime-ir.schema.json",
    "physical-operators.schema.v2.draft.json",
    "capsule-schema.yaml",
)

LEGACY_COMPAT_DEFAULTS = {
    "capsule": {
        "schema_version": "solar.capsule.v1",
        "mode": {"supports": ["execution"]},
        "access_contract": {
            "preferred": [],
            "allowed": [],
            "forbidden": [],
        },
    },
    "operator": {
        "access_traits": {
            "terminal_access": {"supported": True},
            "filesystem_access": {"supported": True},
            "direct_api_access": {"supported": False},
            "mcp_access": {"supported": False},
            "browser_access": {"supported": False},
        },
    },
}


class SchemaValidationError(Exception):
    """Structured schema validation error with field-level detail."""

    def __init__(self, schema_name: str, errors: list[dict[str, Any]]) -> None:
        self.schema_name = schema_name
        self.errors = errors
        detail_lines = [f"[{schema_name}] {e['field']}: {e['message']}" for e in errors]
        super().__init__(
            f"Schema validation failed for '{schema_name}' with {len(errors)} error(s):\n"
            + "\n".join(f"  - {line}" for line in detail_lines)
        )


def iter_schema_names() -> tuple[str, ...]:
    return FIRST_CLASS_FACT_SCHEMAS


def iter_v2_schema_names() -> tuple[str, ...]:
    return V2_EXTENSION_SCHEMAS


def iter_schema_paths() -> tuple[Path, ...]:
    return tuple((SCHEMA_DIR / name) for name in FIRST_CLASS_FACT_SCHEMAS)


def iter_v2_schema_paths() -> tuple[Path, ...]:
    return tuple((SCHEMA_DIR / name) for name in V2_EXTENSION_SCHEMAS)


def load_schema(name: str) -> dict[str, Any]:
    """Load and parse a schema JSON file by filename."""
    path = SCHEMA_DIR / name
    return json.loads(path.read_text(encoding="utf-8"))


def validate_instance(schema_name: str, instance: dict) -> None:
    """Validate a JSON instance against a named schema. Raises on failure."""
    schema = load_schema(schema_name)
    jsonschema.validate(instance=instance, schema=schema)


def get_required_fields(schema_name: str) -> list[str]:
    """Return the required fields list for a named schema."""
    schema = load_schema(schema_name)
    return schema.get("required", [])


def _build_capsule_json_schema() -> dict[str, Any]:
    """Build a JSON Schema from capsule-schema.yaml for structured validation."""
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "schema_version": {
                "type": "string",
                "enum": ["solar.capsule.v1", "solar.capsule.v2"],
            },
            "goal": {"type": "string"},
            "facts_established": {"type": "array", "items": {"type": "string"}},
            "changes_made": {"type": "array", "items": {"type": "string"}},
            "risks": {"type": "array", "items": {"type": "string"}},
            "open_questions": {"type": "array", "items": {"type": "string"}},
            "required_next_action": {"type": "string"},
            "recursion_round": {"type": "integer", "minimum": 0},
            "topology": {
                "type": "string",
                "enum": ["standard", "deliberation", "research", "mixture"],
            },
            "mode": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "supports": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": ["execution", "evolution"],
                        },
                    },
                },
            },
            "access_contract": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "preferred": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": [
                                "terminal_direct_api",
                                "terminal_explore_api",
                                "mcp_adapter",
                                "hybrid_min_browser",
                                "browser_fallback",
                            ],
                        },
                    },
                    "allowed": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": [
                                "terminal_direct_api",
                                "terminal_explore_api",
                                "mcp_adapter",
                                "hybrid_min_browser",
                                "browser_fallback",
                            ],
                        },
                    },
                    "forbidden": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": [
                                "terminal_direct_api",
                                "terminal_explore_api",
                                "mcp_adapter",
                                "hybrid_min_browser",
                                "browser_fallback",
                            ],
                        },
                    },
                    "browser_required_conditions": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "api_requirements": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "fallback_conditions": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
            },
            "evaluator_contract": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "isolation_level": {
                        "type": "string",
                        "enum": [
                            "worktree_detached",
                            "process_sandbox",
                            "container",
                            "host",
                        ],
                    },
                    "timeout_sec": {"type": "integer", "minimum": 1},
                    "concurrency_safe": {"type": "boolean"},
                    "scoring_visibility": {
                        "type": "string",
                        "enum": ["score_only", "score_plus_public_feedback"],
                    },
                    "private": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "hidden_tests": {"type": "boolean"},
                            "grader_code": {"type": "boolean"},
                            "eval_secrets": {"type": "boolean"},
                        },
                    },
                },
            },
            "evolution_policy": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "population_role": {
                        "type": "string",
                        "enum": ["proposer", "implementer", "reviewer", "any"],
                    },
                    "parent_selection_role": {
                        "type": "string",
                        "enum": ["self", "best_in_window", "cross_agent", "random"],
                    },
                    "shared_memory_scope": {
                        "type": "string",
                        "enum": ["public_only", "public_plus_own_private"],
                    },
                    "attempt_write_policy": {
                        "type": "string",
                        "enum": ["always", "only_on_success", "never"],
                    },
                    "strategy_tags": {"type": "array", "items": {"type": "string"}},
                },
            },
            "heartbeat_policy": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "subscriptions": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": [
                                "ReflectHeartbeat",
                                "ConsolidateHeartbeat",
                                "RedirectHeartbeat",
                                "QuotaHeartbeat",
                                "SafetyHeartbeat",
                                "CapsuleEvolutionHeartbeat",
                            ],
                        },
                    },
                },
            },
            "capsule_id": {"type": "string"},
        },
    }


def _load_capsule_schema() -> dict[str, Any]:
    """Load the capsule schema — uses built-in JSON Schema for capsule-schema.yaml."""
    return _build_capsule_json_schema()


def validate_with_structured_errors(
    schema_name: str,
    instance: dict,
) -> list[dict[str, Any]]:
    """Validate and return structured error list instead of raising.

    Returns:
        List of error dicts with keys: field, message, schema_path.
        Empty list means valid.

    Does NOT silently swallow invalid private/evaluator config — every
    violation is surfaced as a structured error entry.
    """
    try:
        if schema_name == "capsule-schema.yaml":
            schema = _load_capsule_schema()
        else:
            schema = load_schema(schema_name)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        return [{"field": "$schema", "message": f"Schema load error: {e}", "schema_path": "/"}]

    validator = jsonschema.Draft202012Validator(schema)
    errors: list[dict[str, Any]] = []
    for error in sorted(validator.iter_errors(instance), key=lambda e: list(e.path)):
        field_path = "/".join(str(p) for p in error.absolute_path) or "$root"
        errors.append({
            "field": field_path,
            "message": error.message,
            "schema_path": "/".join(str(p) for p in error.absolute_schema_path) or "/",
        })
    return errors


def apply_capsule_defaults(capsule: dict[str, Any]) -> dict[str, Any]:
    """Apply v2 defaults to a capsule dict without mutating the input.

    Legacy capsules without v2 fields get execution-only mode and
    conservative terminal access defaults.
    """
    result = deepcopy(capsule)
    defaults = LEGACY_COMPAT_DEFAULTS["capsule"]

    if "schema_version" not in result:
        result["schema_version"] = defaults["schema_version"]

    if "mode" not in result:
        result["mode"] = dict(defaults["mode"])
    elif "supports" not in result.get("mode", {}):
        result["mode"] = dict(result.get("mode", {}))
        result["mode"]["supports"] = list(defaults["mode"]["supports"])

    if "access_contract" not in result:
        result["access_contract"] = {k: list(v) for k, v in defaults["access_contract"].items()}

    if "evaluator_contract" not in result:
        result["evaluator_contract"] = None

    if "evolution_policy" not in result:
        result["evolution_policy"] = None

    if "heartbeat_policy" not in result:
        result["heartbeat_policy"] = None

    return result


def apply_operator_defaults(operator: dict[str, Any]) -> dict[str, Any]:
    """Apply v2 access_traits defaults to an operator dict without mutating.

    Legacy operators without access_traits get conservative terminal
    access only — they do NOT fail validation.
    """
    result = deepcopy(operator)
    defaults = LEGACY_COMPAT_DEFAULTS["operator"]

    if "access_traits" not in result:
        result["access_traits"] = {
            k: dict(v) for k, v in defaults["access_traits"].items()
        }
    else:
        traits = result["access_traits"]
        for trait_key, trait_default in defaults["access_traits"].items():
            if trait_key not in traits:
                traits[trait_key] = dict(trait_default)

    return result
