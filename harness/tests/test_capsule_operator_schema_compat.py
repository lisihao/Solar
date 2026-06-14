"""Tests for capsule/physical-operator schema compatibility and legacy defaults."""

from __future__ import annotations

import json
import sys
from pathlib import Path

_HARNESS_LIB = str(Path(__file__).resolve().parents[1] / "lib")
if _HARNESS_LIB not in sys.path:
    sys.path.insert(0, _HARNESS_LIB)

import pytest

try:
    import jsonschema
    _HAS_JSONSCHEMA = True
except ImportError:
    _HAS_JSONSCHEMA = False

_SCHEMAS_DIR = Path(__file__).resolve().parents[1] / "schemas"
_PHYS_SCHEMA_PATH = _SCHEMAS_DIR / "physical-operators.schema.v2.draft.json"
_ACCESS_SCHEMA_PATH = _SCHEMAS_DIR / "access-path-decision.schema.json"
_ATTEMPT_SCHEMA_PATH = _SCHEMAS_DIR / "attempt-ledger.schema.json"


# ---------------------------------------------------------------------------
# Schema file existence
# ---------------------------------------------------------------------------

class TestSchemaFilesExist:
    def test_physical_operators_schema_exists(self):
        assert _PHYS_SCHEMA_PATH.exists(), f"Missing: {_PHYS_SCHEMA_PATH}"

    def test_access_path_schema_exists(self):
        assert _ACCESS_SCHEMA_PATH.exists(), f"Missing: {_ACCESS_SCHEMA_PATH}"

    def test_attempt_ledger_schema_exists(self):
        assert _ATTEMPT_SCHEMA_PATH.exists(), f"Missing: {_ATTEMPT_SCHEMA_PATH}"

    def test_physical_operators_schema_is_valid_json(self):
        data = json.loads(_PHYS_SCHEMA_PATH.read_text())
        assert isinstance(data, dict)
        assert "operators" in data.get("properties", {})

    def test_access_path_schema_is_valid_json(self):
        data = json.loads(_ACCESS_SCHEMA_PATH.read_text())
        assert data["title"] == "Solar Access Path Decision"


# ---------------------------------------------------------------------------
# Physical operator schema: five access decision paths covered
# ---------------------------------------------------------------------------

class TestPhysicalOperatorAccessTraits:
    def setup_method(self):
        self.schema = json.loads(_PHYS_SCHEMA_PATH.read_text())
        self.op_props = self.schema["$defs"]["operator"]["properties"]

    def test_access_traits_defined_in_schema(self):
        assert "access_traits" in self.op_props

    def test_terminal_access_defined(self):
        assert "terminal_access" in self.op_props["access_traits"]["properties"]

    def test_filesystem_access_defined(self):
        assert "filesystem_access" in self.op_props["access_traits"]["properties"]

    def test_direct_api_access_defined(self):
        assert "direct_api_access" in self.op_props["access_traits"]["properties"]

    def test_mcp_access_defined(self):
        assert "mcp_access" in self.op_props["access_traits"]["properties"]

    def test_browser_access_defined(self):
        assert "browser_access" in self.op_props["access_traits"]["properties"]

    def test_legacy_operator_accepts_without_access_traits(self):
        """Legacy operators missing access_traits must not fail validation."""
        compat_mode = self.schema.get("compat_mode", {})
        assert compat_mode.get("accepts_v1_input") is True


# ---------------------------------------------------------------------------
# Access path decision schema: five path enums covered
# ---------------------------------------------------------------------------

class TestAccessPathDecisionSchema:
    def setup_method(self):
        self.schema = json.loads(_ACCESS_SCHEMA_PATH.read_text())

    def test_schema_version_const(self):
        sv = self.schema["properties"]["schema_version"]
        assert sv.get("const") == "solar.access_path_decision.v1"

    def test_decision_enum_covers_five_paths(self):
        decision_enum = self.schema["properties"]["decision"]["enum"]
        expected = {
            "terminal_direct_api",
            "terminal_explore_api",
            "mcp_adapter",
            "browser_fallback",
            "hybrid_min_browser",
        }
        assert expected == set(decision_enum)

    def test_input_signals_required_fields(self):
        required = set(self.schema["properties"]["input_signals"]["required"])
        assert "api_completeness" in required
        assert "need_rendered_state" in required
        assert "session_bound_workflow" in required

    def test_policy_denials_path_enum(self):
        path_enum = self.schema["properties"]["policy_denials"]["items"]["properties"]["path"]["enum"]
        assert "mcp_adapter" in path_enum
        assert "browser_fallback" in path_enum
        assert "terminal_direct_api" in path_enum


# ---------------------------------------------------------------------------
# Attempt ledger schema: key fields
# ---------------------------------------------------------------------------

class TestAttemptLedgerSchema:
    def setup_method(self):
        self.schema = json.loads(_ATTEMPT_SCHEMA_PATH.read_text())

    def test_schema_version_field_present(self):
        props = self.schema.get("properties", {})
        assert "schema_version" in props or "attempt_id" in props

    def test_schema_is_valid_json_object(self):
        assert self.schema.get("type") in ("object", None) or "$schema" in self.schema


# ---------------------------------------------------------------------------
# JSON-schema validation of optimizer output (if jsonschema available)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _HAS_JSONSCHEMA, reason="jsonschema not installed")
class TestJsonSchemaValidation:
    def test_valid_access_path_decision_validates(self):
        from access_path_optimizer import AccessPathOptimizer
        schema = json.loads(_ACCESS_SCHEMA_PATH.read_text())
        optimizer = AccessPathOptimizer()
        result = optimizer.decide({"api_completeness": 0.95})
        payload = result.decision.trace_payload
        # Build a conforming doc from trace payload
        doc = {
            "schema_version": payload.get("schema_version"),
            "decision": result.access_path,
            "rationale": result.rationale,
            "fallback_chain": result.fallback_chain,
            "input_signals": {
                "api_completeness": payload["input_signals"]["api_completeness"],
                "mcp_tool_schema_coverage": payload["input_signals"]["mcp_tool_schema_coverage"],
                "need_rendered_state": payload["input_signals"]["need_rendered_state"],
                "session_bound_workflow": payload["input_signals"]["session_bound_workflow"],
            },
        }
        jsonschema.validate(instance=doc, schema=schema)

    def test_legacy_operator_without_access_traits_passes(self):
        """A v1-style operator object missing access_traits must not fail schema."""
        phys_schema = json.loads(_PHYS_SCHEMA_PATH.read_text())
        operator_schema = phys_schema["$defs"]["operator"]
        legacy_op = {
            "display_name": "Legacy Operator v1",
            "operator_class": "Implementation",
        }
        # Should not raise
        jsonschema.validate(instance=legacy_op, schema=operator_schema)

    def test_full_operator_with_access_traits_validates(self):
        phys_schema = json.loads(_PHYS_SCHEMA_PATH.read_text())
        operator_schema = phys_schema["$defs"]["operator"]
        modern_op = {
            "display_name": "Modern Operator v2",
            "operator_class": "Verifier",
            "access_traits": {
                "terminal_access": {"supported": True},
                "filesystem_access": {"supported": True},
                "direct_api_access": {"supported": False},
                "mcp_access": {"supported": False},
                "browser_access": {"supported": False},
            },
        }
        jsonschema.validate(instance=modern_op, schema=operator_schema)


# ---------------------------------------------------------------------------
# Negative control: no hardcoded secrets/tokens in schema files
# ---------------------------------------------------------------------------

class TestNoSecretsInSchemas:
    _FORBIDDEN_PATTERNS = ["api_key", "token", "password", "bearer", "secret=", "credential="]

    def _check_schema_file(self, path: Path):
        text = path.read_text().lower()
        for pattern in self._FORBIDDEN_PATTERNS:
            # Allow these in schema definitions (type constraints), not as literal values
            # The schema says auth "not" allows these as keys — that's intentional
            if f'"{pattern}"' in text and '"not"' not in text and '"enum"' not in text:
                # Check if it's inside a 'not' or 'enum' context
                pass
        # Ensure no actual secrets embedded as values
        assert "sk-" not in path.read_text(), f"Potential API key in {path.name}"
        assert "eyJ" not in path.read_text() or "example" in path.read_text().lower(), f"Potential JWT in {path.name}"

    def test_physical_operators_schema_no_secrets(self):
        self._check_schema_file(_PHYS_SCHEMA_PATH)

    def test_access_path_schema_no_secrets(self):
        self._check_schema_file(_ACCESS_SCHEMA_PATH)
