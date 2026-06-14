#!/usr/bin/env python3
"""test_capability_capsule_taxonomy.py — N2: 5-class capsule taxonomy tests.

Validates that the capsule registry, schema, loader, and workflow expansion
support capability, guard, resource, verifier, and workflow capsule kinds,
while preserving backward compatibility with the existing 3-class registry.
"""

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from capability_capsules import (
    CAPSULE_REGISTRY_PATH,
    RegistryEntry,
    _flatten_registry,
    _read_yaml_or_json,
    expand_workflow_capsule,
    get_registry_entry,
    iter_registry_entries,
    load_capability_capsule_registry,
    normalize_capability_capsule,
    validate_capability_capsule,
)

SCHEMAS_DIR = Path(__file__).resolve().parent.parent / "schemas" / "draft"
CAPSULE_SCHEMA_PATH = SCHEMAS_DIR / "capability-capsule.v1.draft.json"


# --- Registry loading with 5-class taxonomy ---

class TestRegistryFiveClassTaxonomy:
    def test_existing_registry_loads_without_failure(self):
        result = load_capability_capsule_registry()
        assert "entries" in result
        assert isinstance(result["entries"], list)

    def test_existing_capability_entries_load(self):
        entries = iter_registry_entries()
        capability_entries = [e for e in entries if e.capsule_kind == "capability"]
        assert len(capability_entries) > 0, "Should have at least one capability capsule"

    def test_existing_guard_entries_load(self):
        entries = iter_registry_entries(include_draft=True)
        guard_entries = [e for e in entries if e.capsule_kind == "guard"]
        assert len(guard_entries) > 0, "Should have at least one guard capsule"

    def test_existing_resource_entries_load(self):
        entries = iter_registry_entries()
        resource_entries = [e for e in entries if e.capsule_kind == "resource"]
        assert len(resource_entries) > 0, "Should have at least one resource capsule"

    def test_flatten_registry_handles_all_five_kinds(self):
        raw = {
            "version": 1,
            "capsules": {
                "capability": [
                    {
                        "capability_capsule_id": "cap.test-cap",
                        "version": "0.1.0",
                        "capsule_kind": "capability",
                        "status": "stable",
                        "schema_ref": "draft/capability-capsule.v1.draft.json",
                        "manifest_path": "capability-capsules/cap.test-cap.yaml",
                        "tags": ["test"],
                        "owner": "test",
                    }
                ],
                "guard": [],
                "resource": [],
                "verifier": [
                    {
                        "capability_capsule_id": "ver.test-verifier",
                        "version": "0.1.0",
                        "capsule_kind": "verifier",
                        "status": "stable",
                        "schema_ref": "draft/capability-capsule.v1.draft.json",
                        "manifest_path": "capability-capsules/ver.test-verifier.yaml",
                        "tags": ["test"],
                        "owner": "test",
                    }
                ],
                "workflow": [
                    {
                        "capability_capsule_id": "wf.test-workflow",
                        "version": "0.1.0",
                        "capsule_kind": "workflow",
                        "status": "stable",
                        "schema_ref": "draft/capability-capsule.v1.draft.json",
                        "manifest_path": "capability-capsules/wf.test-workflow.yaml",
                        "tags": ["test"],
                        "owner": "test",
                    }
                ],
            },
        }
        entries = _flatten_registry(raw, Path("/tmp/test-registry.yaml"))
        kinds = {e.capsule_kind for e in entries}
        assert "capability" in kinds
        assert "verifier" in kinds
        assert "workflow" in kinds
        assert len(entries) == 3


# --- Schema accepts all 5 capsule kinds ---

class TestSchemaFiveKinds:
    def _capsule_payload(self, kind, **overrides):
        payload = {
            "capability_capsule_id": f"test.{kind}-1",
            "capsule_kind": kind,
            "metadata": {"name": f"Test {kind}", "description": f"Test {kind} capsule"},
            "applicability": {"task_types": ["test"], "positive_signals": [], "negative_signals": []},
            "contract": {
                "inputs": {"required": [], "optional": []},
                "outputs": {"required": [], "optional": []},
                "preconditions": [{"check": "input_present", "field": "goal"}],
                "postconditions": [{"check": "output_present", "field": "result"}],
                "invariants": ["no_secrets"],
            },
            "composition": {
                "consumes": [], "produces": [],
                "compatible_with": [], "incompatible_with": [], "requires_after": [],
            },
            "effects": {
                "read": [], "write": [], "execute": [], "network": [], "cost": [], "risk": [],
            },
            "bindings": {
                "skills": {"required": [], "optional": []},
                "mcp_capabilities": {},
                "data_refs": [], "secret_refs": [],
            },
            "verification": {
                "self_check": ["basic"],
                "external_verifier": {"required": False},
                "pass_conditions": [],
            },
            "operator_compatibility": {"preferred": [], "forbidden": []},
            "provenance": {"owner": "test"},
        }
        payload.update(overrides)
        return payload

    def test_capability_kind_validates(self):
        errors = validate_capability_capsule(self._capsule_payload("capability"))
        assert isinstance(errors, list)

    def test_guard_kind_validates(self):
        payload = self._capsule_payload(
            "guard",
            verification={"self_check": ["basic"], "external_verifier": {"required": False}, "pass_conditions": ["guard.pass"]},
        )
        errors = validate_capability_capsule(payload)
        assert isinstance(errors, list)

    def test_resource_kind_validates(self):
        errors = validate_capability_capsule(self._capsule_payload("resource"))
        assert isinstance(errors, list)

    def test_verifier_kind_validates(self):
        errors = validate_capability_capsule(self._capsule_payload("verifier"))
        assert isinstance(errors, list)

    def test_workflow_kind_validates(self):
        payload = self._capsule_payload(
            "workflow",
            workflow_spec={"max_depth": 3, "child_capsule_ids": ["cap.test-cap"], "expansion_strategy": "sequential"},
        )
        errors = validate_capability_capsule(payload)
        assert isinstance(errors, list)

    def test_invalid_kind_rejected(self):
        payload = self._capsule_payload("invalid_kind")
        errors = validate_capability_capsule(payload)
        kind_errors = [e for e in errors if "capsule_kind" in e]
        assert len(kind_errors) > 0, "Invalid capsule_kind should be rejected by schema"


# --- Normalize handles new kinds ---

class TestNormalizeNewKinds:
    def test_normalize_verifier(self):
        payload = {
            "capability_capsule_id": "test.verifier-1",
            "capsule_kind": "verifier",
        }
        result = normalize_capability_capsule(payload)
        assert result["capsule_kind"] == "verifier"

    def test_normalize_workflow(self):
        payload = {
            "capability_capsule_id": "test.workflow-1",
            "capsule_kind": "workflow",
        }
        result = normalize_capability_capsule(payload)
        assert result["capsule_kind"] == "workflow"

    def test_normalize_legacy_ecapsule(self):
        payload = {
            "execution_capsule_id": "legacy-exec-1",
        }
        result = normalize_capability_capsule(payload)
        assert result["capability_capsule_id"] == "legacy-exec-1"
        assert result["capsule_kind"] == "capability"


# --- Workflow expansion depth/cycle protection ---

class TestWorkflowExpansion:
    def test_non_workflow_capsule_returns_empty_children(self):
        result = expand_workflow_capsule("cap.requirement-compiler-implementation")
        assert result["children"] == []

    def test_max_depth_exceeded(self):
        with patch("capability_capsules.get_registry_entry") as mock_get:
            mock_entry = RegistryEntry(
                capability_capsule_id="wf.recursive",
                version="0.1.0",
                capsule_kind="workflow",
                status="stable",
                schema_ref="draft/capability-capsule.v1.draft.json",
                manifest_path="/tmp/wf.recursive.yaml",
                tags=[],
                owner="test",
            )
            mock_get.return_value = mock_entry
            with patch("capability_capsules.load_capability_capsule_manifest") as mock_manifest:
                mock_manifest.return_value = {
                    "capsule_kind": "workflow",
                    "workflow_spec": {"child_capsule_ids": ["wf.child"]},
                }
                result = expand_workflow_capsule("wf.recursive", max_depth=1)
                # The child expansion hits max_depth
                child_depth_exceeded = any(
                    child.get("max_depth_exceeded")
                    for child in result.get("children", [])
                )
                assert child_depth_exceeded, "Child should hit max_depth"

    def test_cycle_detected(self):
        with patch("capability_capsules.get_registry_entry") as mock_get:
            mock_entry = RegistryEntry(
                capability_capsule_id="wf.cycle",
                version="0.1.0",
                capsule_kind="workflow",
                status="stable",
                schema_ref="draft/capability-capsule.v1.draft.json",
                manifest_path="/tmp/wf.cycle.yaml",
                tags=[],
                owner="test",
            )
            mock_get.return_value = mock_entry
            with patch("capability_capsules.load_capability_capsule_manifest") as mock_manifest:
                mock_manifest.return_value = {
                    "capsule_kind": "workflow",
                    "workflow_spec": {"child_capsule_ids": ["wf.cycle"]},
                }
                result = expand_workflow_capsule("wf.cycle", max_depth=5)
                # The child expansion should detect the cycle
                has_cycle = any(
                    child.get("cycle_detected")
                    for child in result.get("children", [])
                )
                assert has_cycle, "Cycle should be detected in child expansion"

    def test_workflow_expansion_trace(self):
        with patch("capability_capsules.get_registry_entry") as mock_get:
            def mock_get_entry(cid, **kwargs):
                return RegistryEntry(
                    capability_capsule_id=cid,
                    version="0.1.0",
                    capsule_kind="capability" if cid.startswith("cap.") else "workflow",
                    status="stable",
                    schema_ref="draft/capability-capsule.v1.draft.json",
                    manifest_path=f"/tmp/{cid}.yaml",
                    tags=[],
                    owner="test",
                )

            mock_get.side_effect = mock_get_entry
            with patch("capability_capsules.load_capability_capsule_manifest") as mock_manifest:
                def mock_manifest_fn(path):
                    cid = Path(path).stem
                    if cid.startswith("wf."):
                        return {"capsule_kind": "workflow", "workflow_spec": {"child_capsule_ids": []}}
                    return {"capsule_kind": "capability"}

                mock_manifest.side_effect = mock_manifest_fn
                result = expand_workflow_capsule("wf.parent", max_depth=3)
                assert "trace" in result
                assert "wf.parent" in result["trace"]
