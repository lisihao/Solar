"""Unit tests for lib.packages.orchestration_ui — O1_trace_schema.

Verifies:
- Minimal dispatch trace construction with all required fields.
- Schema validation against schemas/orchestration-execution-trace.schema.json.
- TraceWriter uses SOLAR_HARNESS_DIR (no hardcoded user paths).
- All acceptance criteria fields are present and correctly typed.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

import pytest

# ── harness root resolution ─────────────────────────────────────────────────
HARNESS = Path(__file__).resolve().parents[1]
os.environ.setdefault("SOLAR_HARNESS_DIR", str(HARNESS))

# ── import package under test ───────────────────────────────────────────────
from lib.packages.orchestration_ui import (
    AckRecord,
    AckStatus,
    ArtifactRef,
    CostInfo,
    DispatchInfo,
    DispatchStatus,
    LeaseRecord,
    LeaseState,
    OrchestrationTrace,
    PaneHygieneState,
    SCHEMA_VERSION,
    Surface,
    TimedState,
    TraceWriter,
    VerifierDecision,
    VerifierResult,
    build_minimal_trace,
)

# ── optional jsonschema ─────────────────────────────────────────────────────
try:
    import jsonschema  # type: ignore

    _HAS_JSONSCHEMA = True
except ImportError:
    _HAS_JSONSCHEMA = False

SCHEMA_PATH = HARNESS / "schemas" / "orchestration-execution-trace.schema.json"


# ══════════════════════════════════════════════════════════════════════════════
# Fixtures
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def harness_dir(tmp_path: Path) -> Path:
    """Isolated harness dir with minimal config (no real user paths)."""
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "physical-operators.json").write_text(
        json.dumps(
            {
                "version": 1,
                "operators": {
                    "test-builder-01": {
                        "plane": "headless",
                        "role": "builder",
                        "model": "sonnet",
                    }
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return tmp_path


@pytest.fixture
def writer(harness_dir: Path) -> TraceWriter:
    return TraceWriter(harness_dir=harness_dir)


@pytest.fixture
def minimal_trace(harness_dir: Path) -> OrchestrationTrace:
    return build_minimal_trace(
        dispatch_id="graph-s04-O1-test-20260606",
        sprint_id="sprint-20260530-s04-orchestration-ui",
        task_type="evidence_schema_compile",
        logical_op="evidence_schema_compile",
        operator_id="test-builder-01",
        node_id="O1_trace_schema",
        capsule_id="capsule.schema.compiler.v1",
        harness_dir=harness_dir,
    )


# ══════════════════════════════════════════════════════════════════════════════
# Acceptance Criterion 1: schema covers all required fields
# ══════════════════════════════════════════════════════════════════════════════

class TestRequiredFieldsPresent:
    """Verifies acceptance criterion: trace covers all mandatory field names."""

    REQUIRED_ACCEPTANCE_FIELDS = [
        "dispatch_id",
        "task_type",
        "logical_op",
        "capsule_id",
        "operator_id",
        "surface",
        "pane_hygiene_state",
        "failure_mode",  # nullable top-level field
    ]

    def test_schema_file_exists(self) -> None:
        assert SCHEMA_PATH.exists(), f"Schema file missing: {SCHEMA_PATH}"

    def test_schema_required_list(self) -> None:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        required = schema.get("required", [])
        for field in ["dispatch_id", "task_type", "logical_op", "operator_id",
                      "surface", "pane_hygiene_state", "dispatch", "lease", "ack", "verifier"]:
            assert field in required, f"'{field}' missing from schema required[]"

    def test_schema_covers_artifact_refs(self) -> None:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        assert "artifact_refs" in schema["properties"]

    def test_schema_covers_lease_timeline(self) -> None:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        lease_def = schema["$defs"]["lease_record"]
        assert "timeline" in lease_def["properties"]
        assert "timeline" in lease_def["required"]

    def test_schema_covers_ack_timeline(self) -> None:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        ack_def = schema["$defs"]["ack_record"]
        assert "timeline" in ack_def["properties"]
        assert "timeline" in ack_def["required"]

    def test_schema_covers_verifier_decision(self) -> None:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        verifier_def = schema["$defs"]["verifier_result"]
        assert "decision" in verifier_def["properties"]
        assert "decision" in verifier_def["required"]
        enum_vals = verifier_def["properties"]["decision"]["enum"]
        assert set(enum_vals) == {"PASS", "FAIL", "WARNING", "PENDING"}

    def test_schema_covers_pane_hygiene_state_enum(self) -> None:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        prop = schema["properties"]["pane_hygiene_state"]
        assert "enum" in prop
        assert set(prop["enum"]) >= {"clean", "dirty", "stale", "recovering", "unknown"}

    def test_schema_version_const(self) -> None:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        assert schema["properties"]["schema_version"]["const"] == SCHEMA_VERSION


# ══════════════════════════════════════════════════════════════════════════════
# Acceptance Criterion 2: trace writer uses config, not hardcoded paths
# ══════════════════════════════════════════════════════════════════════════════

class TestTraceWriterNoHardcodedPaths:
    """Verifies trace writer resolves paths from config/env; no user home hardcoded."""

    def test_writer_resolves_from_env(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        monkeypatch.setenv("SOLAR_HARNESS_DIR", str(tmp_path))
        w = TraceWriter()
        assert w.harness_dir == tmp_path

    def test_writer_resolves_from_arg(self, harness_dir: Path) -> None:
        w = TraceWriter(harness_dir=harness_dir)
        assert w.harness_dir == harness_dir

    def test_traces_dir_inside_harness_dir(self, writer: TraceWriter, harness_dir: Path) -> None:
        assert str(writer.traces_dir).startswith(str(harness_dir))

    def test_no_hardcoded_home_path_in_source(self) -> None:
        source = (HARNESS / "lib" / "packages" / "orchestration_ui" / "trace_writer.py").read_text()
        # Must not contain literal home dir path
        assert "/Users/" not in source, "trace_writer.py contains hardcoded /Users/ path"
        assert "/home/" not in source, "trace_writer.py contains hardcoded /home/ path"

    def test_operator_surface_resolved_from_registry(self, writer: TraceWriter) -> None:
        surface = writer.resolve_operator_surface("test-builder-01")
        assert surface == Surface.HEADLESS

    def test_unknown_operator_defaults_to_headless(self, writer: TraceWriter) -> None:
        surface = writer.resolve_operator_surface("nonexistent-operator-xyz")
        assert surface == Surface.HEADLESS

    def test_relative_path_strips_harness_prefix(self, writer: TraceWriter, harness_dir: Path) -> None:
        abs_path = harness_dir / "sprints" / "foo.json"
        rel = writer.relative_path(abs_path)
        assert not rel.startswith(str(harness_dir))
        assert "sprints" in rel


# ══════════════════════════════════════════════════════════════════════════════
# Acceptance Criterion 3: unit test constructs minimal trace + verifies fields
# ══════════════════════════════════════════════════════════════════════════════

class TestMinimalTraceConstruction:
    """Constructs a minimal dispatch trace and verifies all required fields."""

    def test_trace_has_dispatch_id(self, minimal_trace: OrchestrationTrace) -> None:
        assert minimal_trace.dispatch_id == "graph-s04-O1-test-20260606"

    def test_trace_has_task_type(self, minimal_trace: OrchestrationTrace) -> None:
        assert minimal_trace.task_type == "evidence_schema_compile"

    def test_trace_has_logical_op(self, minimal_trace: OrchestrationTrace) -> None:
        assert minimal_trace.logical_op == "evidence_schema_compile"

    def test_trace_has_capsule_id(self, minimal_trace: OrchestrationTrace) -> None:
        assert minimal_trace.capsule_id == "capsule.schema.compiler.v1"

    def test_trace_has_operator_id(self, minimal_trace: OrchestrationTrace) -> None:
        assert minimal_trace.operator_id == "test-builder-01"

    def test_trace_has_surface(self, minimal_trace: OrchestrationTrace) -> None:
        assert isinstance(minimal_trace.surface, Surface)

    def test_trace_has_pane_hygiene_state(self, minimal_trace: OrchestrationTrace) -> None:
        assert isinstance(minimal_trace.pane_hygiene_state, PaneHygieneState)

    def test_trace_has_lease_timeline(self, minimal_trace: OrchestrationTrace) -> None:
        assert isinstance(minimal_trace.lease.timeline, list)
        assert len(minimal_trace.lease.timeline) >= 1

    def test_trace_has_ack_timeline(self, minimal_trace: OrchestrationTrace) -> None:
        assert isinstance(minimal_trace.ack.timeline, list)
        assert len(minimal_trace.ack.timeline) >= 1

    def test_trace_has_verifier_decision(self, minimal_trace: OrchestrationTrace) -> None:
        assert isinstance(minimal_trace.verifier.decision, VerifierDecision)

    def test_trace_failure_mode_null_on_success(self, minimal_trace: OrchestrationTrace) -> None:
        assert minimal_trace.failure_mode is None

    def test_trace_artifact_refs_list(self, minimal_trace: OrchestrationTrace) -> None:
        assert isinstance(minimal_trace.artifact_refs, list)

    def test_trace_schema_version(self, minimal_trace: OrchestrationTrace) -> None:
        d = minimal_trace.to_dict()
        assert d["schema_version"] == SCHEMA_VERSION

    def test_trace_to_dict_serializable(self, minimal_trace: OrchestrationTrace) -> None:
        d = minimal_trace.to_dict()
        dumped = json.dumps(d)
        loaded = json.loads(dumped)
        assert loaded["dispatch_id"] == minimal_trace.dispatch_id

    def test_trace_write_and_read(self, minimal_trace: OrchestrationTrace, writer: TraceWriter) -> None:
        written_path = writer.write(minimal_trace)
        assert written_path.exists()
        loaded = writer.read(minimal_trace.trace_id)
        assert loaded["dispatch_id"] == minimal_trace.dispatch_id
        assert loaded["operator_id"] == minimal_trace.operator_id

    def test_trace_written_path_relative_to_harness(
        self, minimal_trace: OrchestrationTrace, writer: TraceWriter, harness_dir: Path
    ) -> None:
        written_path = writer.write(minimal_trace)
        assert str(written_path).startswith(str(harness_dir))


# ══════════════════════════════════════════════════════════════════════════════
# Schema validation (requires jsonschema; skip otherwise)
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.skipif(not _HAS_JSONSCHEMA, reason="jsonschema not installed")
class TestSchemaValidation:
    def test_minimal_trace_validates(self, minimal_trace: OrchestrationTrace) -> None:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        d = minimal_trace.to_dict()
        jsonschema.validate(d, schema)

    def test_missing_required_field_fails(self, minimal_trace: OrchestrationTrace) -> None:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        d = minimal_trace.to_dict()
        del d["dispatch_id"]
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(d, schema)

    def test_invalid_pane_hygiene_state_fails(self, minimal_trace: OrchestrationTrace) -> None:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        d = minimal_trace.to_dict()
        d["pane_hygiene_state"] = "definitely_not_valid"
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(d, schema)

    def test_invalid_verifier_decision_fails(self, minimal_trace: OrchestrationTrace) -> None:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        d = minimal_trace.to_dict()
        d["verifier"]["decision"] = "MAYBE"
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(d, schema)


# ══════════════════════════════════════════════════════════════════════════════
# Trace with artifact refs and failure_mode
# ══════════════════════════════════════════════════════════════════════════════

class TestTraceWithArtifactsAndFailure:
    def test_artifact_refs_included_in_dict(self, harness_dir: Path) -> None:
        trace = build_minimal_trace(
            dispatch_id="graph-s04-O1-art-test",
            sprint_id="sprint-s04",
            task_type="evidence_schema_compile",
            logical_op="evidence_schema_compile",
            operator_id="test-builder-01",
            artifact_refs=[
                ArtifactRef(
                    kind="schema",
                    path="schemas/orchestration-execution-trace.schema.json",
                    ts="2026-06-06T06:00:00Z",
                )
            ],
            harness_dir=harness_dir,
        )
        d = trace.to_dict()
        assert len(d["artifact_refs"]) == 1
        assert d["artifact_refs"][0]["kind"] == "schema"
        # path must be relative, not absolute
        assert not d["artifact_refs"][0]["path"].startswith("/Users/")

    def test_failure_mode_propagated(self, harness_dir: Path) -> None:
        trace = build_minimal_trace(
            dispatch_id="graph-s04-O1-fail-test",
            sprint_id="sprint-s04",
            task_type="evidence_schema_compile",
            logical_op="evidence_schema_compile",
            operator_id="test-builder-01",
            verifier_decision=VerifierDecision.FAIL,
            failure_mode="ack_timeout",
            harness_dir=harness_dir,
        )
        assert trace.failure_mode == "ack_timeout"
        assert trace.verifier.decision == VerifierDecision.FAIL
        d = trace.to_dict()
        assert d["failure_mode"] == "ack_timeout"
        assert d["verifier"]["decision"] == "FAIL"
