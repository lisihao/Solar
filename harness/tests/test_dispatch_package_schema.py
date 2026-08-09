#!/usr/bin/env python3
"""Test dispatch-package.schema.json validates evidence_refs and evidence_status fields.

Sprint: sprint-20260530-p0-修复单-把-evidence-ledger-从-jsonl-索引升级为可审计的完整-runs-证据链-s04-orchestration-ui
Node: O5_pane_handoff_evidence_gate
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parents[1]
SCHEMA_PATH = HARNESS_DIR / "schemas" / "dispatch-package.schema.json"
LIB_DIR = HARNESS_DIR / "lib"

if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))


def _load_schema():
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def _validate_type(schema: dict, value) -> bool:
    """Minimal JSON Schema type validation for testing."""
    t = schema.get("type")
    if t is None:
        return True
    if isinstance(t, str):
        t = [t]
    type_checks = {
        "string": lambda v: isinstance(v, str),
        "object": lambda v: isinstance(v, dict),
        "number": lambda v: isinstance(v, (int, float)),
        "integer": lambda v: isinstance(v, int),
        "boolean": lambda v: isinstance(v, bool),
        "array": lambda v: isinstance(v, list),
    }
    return any(type_checks.get(tt, lambda _: False)(value) for tt in t)


# ---------------------------------------------------------------------------
# Existing tests (preserved)
# ---------------------------------------------------------------------------

def test_schema_loads():
    schema = _load_schema()
    assert schema["title"] == "Solar Dispatch Package"
    assert "apo_artifacts" in schema["properties"]["payload"]["properties"]


def test_schema_apo_artifacts_structure():
    schema = _load_schema()
    apo = schema["properties"]["payload"]["properties"]["apo_artifacts"]
    assert apo["type"] == "object"
    apo_props = apo["properties"]
    expected_keys = [
        "task_classification",
        "logical_workflow",
        "skill_plan",
        "mcp_plan",
        "capsule_plan_artifact",
        "physical_plan_artifact",
        "selection_rationale",
        "evidence_policy",
    ]
    for key in expected_keys:
        assert key in apo_props, f"Missing apo_artifacts property: {key}"


def test_valid_dispatch_package_with_apo():
    schema = _load_schema()
    required_top = schema["required"]
    pkg = {
        "schema_version": "solar.dispatch_package.v1",
        "dispatch_id": "d-20260605-abc",
        "sprint_id": "sprint-test",
        "node_id": "N1",
        "digest": "sha256:abc123",
        "dispatch_md_path": "/tmp/dispatch.md",
        "created_at": "2026-06-05T12:00:00Z",
        "issued_by": "coordinator",
        "payload": {
            "content": {"goal": "Build feature"},
            "schema_version": "solar.dispatch_payload.v1",
            "apo_artifacts": {
                "task_classification": {"primary_class": "implementation", "confidence": 0.92},
                "skill_plan": {"selected": "skill.review", "candidates": []},
                "capsule_plan_artifact": {"selected_capsule_id": "cap.test"},
                "physical_plan_artifact": {"selected_operator_id": "mini-claude-sonnet-builder"},
            },
        },
    }
    for key in required_top:
        assert key in pkg, f"Missing required field: {key}"
    payload_props = schema["properties"]["payload"]["properties"]
    for key in pkg["payload"]:
        assert key in payload_props or schema["properties"]["payload"].get("additionalProperties", True)
    apo = pkg["payload"]["apo_artifacts"]
    apo_schema = payload_props["apo_artifacts"]
    for key in apo:
        assert key in apo_schema["properties"]


def test_dispatch_package_without_apo_still_valid():
    pkg = {
        "schema_version": "solar.dispatch_package.v1",
        "dispatch_id": "d-20260605-xyz",
        "sprint_id": "sprint-test",
        "node_id": "R1",
        "digest": "sha256:def456",
        "dispatch_md_path": "/tmp/dispatch-r1.md",
        "created_at": "2026-06-05T12:00:00Z",
        "issued_by": "coordinator",
        "payload": {
            "content": {"goal": "Research"},
            "schema_version": "solar.dispatch_payload.v1",
        },
    }
    schema = _load_schema()
    for key in schema["required"]:
        assert key in pkg
    assert "apo_artifacts" not in pkg["payload"]


# ---------------------------------------------------------------------------
# O5 evidence_refs and evidence_status schema tests
# ---------------------------------------------------------------------------

class TestEvidenceRefsSchema:
    def test_schema_has_evidence_refs_property(self):
        schema = _load_schema()
        assert "evidence_refs" in schema["properties"], (
            "Schema must define evidence_refs as a top-level property"
        )

    def test_evidence_refs_is_array_type(self):
        schema = _load_schema()
        evidence_refs_schema = schema["properties"]["evidence_refs"]
        assert evidence_refs_schema["type"] == "array"

    def test_evidence_refs_items_have_type_and_ref(self):
        schema = _load_schema()
        items = schema["properties"]["evidence_refs"]["items"]
        assert "type" in items["properties"]
        assert "ref" in items["properties"]

    def test_evidence_refs_required_fields(self):
        schema = _load_schema()
        items = schema["properties"]["evidence_refs"]["items"]
        required = items.get("required", [])
        assert "type" in required, "evidence_refs items must require 'type'"
        assert "ref" in required, "evidence_refs items must require 'ref'"

    def test_evidence_refs_type_enum(self):
        schema = _load_schema()
        items = schema["properties"]["evidence_refs"]["items"]
        type_prop = items["properties"]["type"]
        assert "enum" in type_prop, "evidence_refs.type must have enum values"
        enum_vals = type_prop["enum"]
        expected = {"artifact_path", "event_id", "action_id", "command_result", "run_dir_file"}
        for e in expected:
            assert e in enum_vals, f"Missing enum value: {e}"

    def test_valid_package_with_evidence_refs(self):
        schema = _load_schema()
        pkg = {
            "schema_version": "solar.dispatch_package.v1",
            "dispatch_id": "graph-sprint-O5-20260605T200822Z",
            "sprint_id": "sprint-20260530-p0-evidence-ledger",
            "node_id": "O5_pane_handoff_evidence_gate",
            "digest": "sha256:abc123",
            "dispatch_md_path": "/Users/lisihao/.solar/harness/sprints/sprint-test.dispatch.md",
            "created_at": "2026-06-05T20:08:22Z",
            "issued_by": "coordinator",
            "payload": {
                "content": {"goal": "Implement evidence gate"},
                "schema_version": "solar.dispatch_payload.v1",
            },
            "evidence_refs": [
                {
                    "type": "artifact_path",
                    "ref": "/Users/lisihao/.solar/harness/lib/dispatch_prompt_injector.py",
                    "description": "Updated dispatch_prompt_injector with pane evidence injection",
                    "timestamp": "2026-06-05T20:30:00Z",
                },
                {
                    "type": "command_result",
                    "ref": "python3 -m pytest tests/orchestration/test_pane_evidence_gate.py -v",
                    "description": "All evidence gate tests pass",
                },
            ],
        }
        # All schema required fields present
        for key in schema["required"]:
            assert key in pkg, f"Missing required field: {key}"
        # evidence_refs is a list
        assert isinstance(pkg["evidence_refs"], list)
        # Each item has type and ref
        for item in pkg["evidence_refs"]:
            assert "type" in item
            assert "ref" in item

    def test_evidence_refs_not_required(self):
        """evidence_refs is optional — packages without it are still valid."""
        schema = _load_schema()
        required_top = schema.get("required", [])
        assert "evidence_refs" not in required_top


class TestEvidenceStatusSchema:
    def test_schema_has_evidence_status_property(self):
        schema = _load_schema()
        assert "evidence_status" in schema["properties"], (
            "Schema must define evidence_status as a top-level property"
        )

    def test_evidence_status_is_string_type(self):
        schema = _load_schema()
        ev_status = schema["properties"]["evidence_status"]
        assert ev_status["type"] == "string"

    def test_evidence_status_enum_values(self):
        schema = _load_schema()
        ev_status = schema["properties"]["evidence_status"]
        assert "enum" in ev_status, "evidence_status must define enum values"
        enum_vals = ev_status["enum"]
        expected = {"complete", "partial", "incomplete", "not_applicable"}
        for e in expected:
            assert e in enum_vals, f"Missing evidence_status enum value: {e}"

    def test_valid_package_with_evidence_status_complete(self):
        schema = _load_schema()
        pkg = {
            "schema_version": "solar.dispatch_package.v1",
            "dispatch_id": "graph-sprint-O5-complete-20260605T200000Z",
            "sprint_id": "sprint-20260530-p0-evidence-ledger",
            "node_id": "O5_pane_handoff_evidence_gate",
            "digest": "sha256:aabbcc",
            "dispatch_md_path": "/Users/lisihao/.solar/harness/sprints/sprint-complete.dispatch.md",
            "created_at": "2026-06-05T20:00:00Z",
            "issued_by": "coordinator",
            "payload": {
                "content": {"goal": "Test complete status"},
                "schema_version": "solar.dispatch_payload.v1",
            },
            "evidence_status": "complete",
        }
        for key in schema["required"]:
            assert key in pkg
        # Status is valid enum value
        valid_statuses = schema["properties"]["evidence_status"]["enum"]
        assert pkg["evidence_status"] in valid_statuses

    def test_all_enum_values_valid(self):
        schema = _load_schema()
        valid = schema["properties"]["evidence_status"]["enum"]
        for status in ("complete", "partial", "incomplete", "not_applicable"):
            assert status in valid

    def test_evidence_status_not_required(self):
        schema = _load_schema()
        required_top = schema.get("required", [])
        assert "evidence_status" not in required_top


# ---------------------------------------------------------------------------
# O5: dispatch_package.py validation helpers
# ---------------------------------------------------------------------------

class TestDispatchPackageValidationHelpers:
    def _load_module(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "dispatch_package",
            LIB_DIR / "dispatch_package.py",
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def test_validate_evidence_status_valid_values(self):
        mod = self._load_module()
        for status in ("complete", "partial", "incomplete", "not_applicable"):
            errors = mod.validate_evidence_status(status)
            assert errors == [], f"Expected no errors for status '{status}', got: {errors}"

    def test_validate_evidence_status_none_is_ok(self):
        mod = self._load_module()
        errors = mod.validate_evidence_status(None)
        assert errors == []

    def test_validate_evidence_status_invalid(self):
        mod = self._load_module()
        errors = mod.validate_evidence_status("done")
        assert len(errors) == 1
        assert "done" in errors[0]

    def test_validate_evidence_refs_valid(self):
        mod = self._load_module()
        refs = [
            {"type": "artifact_path", "ref": "/some/path.py"},
            {"type": "event_id", "ref": "19cafd5a-0f1a-46b3-ab07-88f15596c12a"},
            {"type": "action_id", "ref": "graph-sprint-O5-20260605T200000Z"},
            {"type": "command_result", "ref": "pytest tests/ -v"},
            {"type": "run_dir_file", "ref": "run/evidence.json"},
        ]
        errors = mod.validate_evidence_refs(refs)
        assert errors == []

    def test_validate_evidence_refs_none_is_ok(self):
        mod = self._load_module()
        errors = mod.validate_evidence_refs(None)
        assert errors == []

    def test_validate_evidence_refs_not_list(self):
        mod = self._load_module()
        errors = mod.validate_evidence_refs("not a list")
        assert len(errors) == 1
        assert "array" in errors[0]

    def test_validate_evidence_refs_missing_type(self):
        mod = self._load_module()
        errors = mod.validate_evidence_refs([{"ref": "/some/path"}])
        assert any("type" in e for e in errors)

    def test_validate_evidence_refs_missing_ref(self):
        mod = self._load_module()
        errors = mod.validate_evidence_refs([{"type": "artifact_path"}])
        assert any("ref" in e for e in errors)

    def test_validate_evidence_refs_invalid_type(self):
        mod = self._load_module()
        errors = mod.validate_evidence_refs([{"type": "unknown_type", "ref": "/path"}])
        assert any("unknown_type" in e for e in errors)

    def test_validate_evidence_refs_empty_list_is_ok(self):
        mod = self._load_module()
        errors = mod.validate_evidence_refs([])
        assert errors == []


# ---------------------------------------------------------------------------
# O5: dispatch_prompt_injector pane evidence injection
# ---------------------------------------------------------------------------

class TestPaneEvidenceInjection:
    def _load_lib_injector(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "lib_dispatch_prompt_injector",
            LIB_DIR / "dispatch_prompt_injector.py",
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def _load_tools_injector(self):
        import importlib.util
        tools_dir = HARNESS_DIR / "tools"
        spec = importlib.util.spec_from_file_location(
            "tools_dispatch_prompt_injector",
            tools_dir / "dispatch_prompt_injector.py",
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def test_lib_inject_pane_evidence_adds_marker(self):
        mod = self._load_lib_injector()
        text = "# Node Task\n\nDo the thing.\n"
        result = mod.inject_pane_evidence_requirements(text)
        assert "<!-- pane-evidence-requirements" in result

    def test_tools_inject_pane_evidence_adds_marker(self):
        mod = self._load_tools_injector()
        text = "# Node Task\n\nDo the thing.\n"
        result = mod.inject_pane_evidence_requirements(text)
        assert "<!-- pane-evidence-requirements" in result

    def test_lib_inject_pane_evidence_idempotent(self):
        mod = self._load_lib_injector()
        text = "# Task\n"
        first = mod.inject_pane_evidence_requirements(text)
        second = mod.inject_pane_evidence_requirements(first)
        assert first == second

    def test_tools_inject_pane_evidence_idempotent(self):
        mod = self._load_tools_injector()
        text = "# Task\n"
        first = mod.inject_pane_evidence_requirements(text)
        second = mod.inject_pane_evidence_requirements(first)
        assert first == second

    def test_lib_inject_pane_evidence_file(self, tmp_path):
        mod = self._load_lib_injector()
        dispatch_file = tmp_path / "sprint-O5.dispatch.md"
        dispatch_file.write_text("# Dispatch\n\nDo work.\n", encoding="utf-8")
        result = mod.inject_pane_evidence_file(str(dispatch_file))
        assert result is True
        content = dispatch_file.read_text(encoding="utf-8")
        assert "pane-evidence-requirements" in content

    def test_tools_inject_pane_evidence_file(self, tmp_path):
        mod = self._load_tools_injector()
        dispatch_file = tmp_path / "sprint-O5.dispatch.md"
        dispatch_file.write_text("# Dispatch\n\nDo work.\n", encoding="utf-8")
        result = mod.inject_pane_evidence_file(str(dispatch_file))
        assert result is True
        content = dispatch_file.read_text(encoding="utf-8")
        assert "pane-evidence-requirements" in content

    def test_inject_pane_evidence_skips_when_already_present(self, tmp_path):
        mod = self._load_lib_injector()
        dispatch_file = tmp_path / "sprint-O5-already.dispatch.md"
        # Pre-inject
        initial = "# Dispatch\n<!-- pane-evidence-requirements -->\nAlready here.\n"
        dispatch_file.write_text(initial, encoding="utf-8")
        result = mod.inject_pane_evidence_file(str(dispatch_file))
        assert result is False
        # Content unchanged
        assert dispatch_file.read_text(encoding="utf-8") == initial

    def test_pane_evidence_requirements_contains_prohibited_patterns(self):
        mod = self._load_lib_injector()
        text = "# Task\n"
        result = mod.inject_pane_evidence_requirements(text)
        assert "evidence_status" in result
        assert "event_id ref" in result or "event_id" in result
        assert "artifact_path" in result
        assert "Prohibited patterns" in result or "❌" in result


if __name__ == "__main__":
    test_schema_loads()
    print("PASS test_schema_loads")
    test_schema_apo_artifacts_structure()
    print("PASS test_schema_apo_artifacts_structure")
    test_valid_dispatch_package_with_apo()
    print("PASS test_valid_dispatch_package_with_apo")
    test_dispatch_package_without_apo_still_valid()
    print("PASS test_dispatch_package_without_apo_still_valid")

    ev_schema = TestEvidenceRefsSchema()
    ev_schema.test_schema_has_evidence_refs_property()
    print("PASS test_schema_has_evidence_refs_property")
    ev_schema.test_evidence_refs_type_enum()
    print("PASS test_evidence_refs_type_enum")
    ev_schema.test_evidence_refs_not_required()
    print("PASS test_evidence_refs_not_required")

    ev_status = TestEvidenceStatusSchema()
    ev_status.test_schema_has_evidence_status_property()
    print("PASS test_schema_has_evidence_status_property")
    ev_status.test_evidence_status_enum_values()
    print("PASS test_evidence_status_enum_values")
    ev_status.test_evidence_status_not_required()
    print("PASS test_evidence_status_not_required")

    print("All dispatch package schema tests passed")
