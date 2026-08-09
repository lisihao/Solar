"""Tests for evidence_ledger.py — Evidence path and scheduler decision."""
import json
import tempfile
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from evidence_ledger import (
    EvidenceLedger,
    RunMaterializer,
    NoopMaterializer,
    build_scheduler_decision,
    scrub_artifact,
)

# ---------------------------------------------------------------------------
# Existing backward-compat tests (must continue to pass)
# ---------------------------------------------------------------------------

def test_write_run_entry():
    with tempfile.TemporaryDirectory() as td:
        el = EvidenceLedger(Path(td))
        sd = build_scheduler_decision("a1", "ImplementationWorker", {"TaskFit": 0.3}, {}, [])
        path = el.write_run_entry("t1", "s1", "n1", "a1", "ImplementationWorker", sd)
        assert Path(path).exists()
        lines = Path(path).read_text().strip().split("\n")
        assert len(lines) == 1
        data = json.loads(lines[0])
        assert data["task_id"] == "t1"
        assert data["actor_id"] == "a1"
        assert "per_node" in data
        assert "final_report_target" in data
        # run_dir must NOT appear when not passed
        assert "run_dir" not in data
        assert "artifact_refs" not in data
        print("PASS: write_run_entry")


def test_scheduler_decision_serialization():
    sd = build_scheduler_decision(
        selected_actor="a1",
        logical_operator="DeepArchitect",
        score_factors={"TaskFit": 0.27},
        penalties={"RecentFailurePenalty": 0.15},
        rejected=[{"actor_id": "a2", "reason": "quota_blocked"}],
        quota_reason="monthly_limit",
    )
    assert sd["selected_actor"] == "a1"
    assert sd["logical_operator"] == "DeepArchitect"
    assert len(sd["rejected_candidates"]) == 1
    assert sd["quota_reason"] == "monthly_limit"
    # New required S02 fields
    assert sd["schema_version"] == "solar.scheduler_decision.v1"
    assert "decision_id" in sd
    assert "selection_summary" in sd
    assert "artifact_refs" in sd
    assert "replay" in sd
    print("PASS: scheduler_decision_serialization")


def test_scheduler_decision_fingerprint_detail_defaults_empty():
    """Legacy scheduler decisions retain an explicit empty fingerprint explanation."""
    sd = build_scheduler_decision(
        selected_actor="a1",
        logical_operator="DeepArchitect",
        score_factors={},
        penalties={},
        rejected=[],
    )
    assert sd["FailureFingerprintPenalty"] == 0.0
    assert sd["matched_labels"] == []
    assert sd["evidence_refs"] == []
    assert sd["failure_fingerprint"] == {
        "penalty": 0.0,
        "matched_labels": [],
        "evidence_refs": [],
        "explanation": "no fingerprint evidence supplied",
        "fingerprint_type": "",
        "actor_id": "a1",
        "label_penalties": [],
        "ignored_events": [],
        "cap_applied": False,
    }
    print("PASS: scheduler_decision_fingerprint_detail_defaults_empty")


def test_scheduler_decision_fingerprint_detail_structured():
    """Fingerprint penalty details are preserved for evidence-backed decisions."""
    detail = {
        "fingerprint_type": "FINAL_REVIEW",
        "penalty": 0.25,
        "explanation": "1 failure label match(es) for FINAL_REVIEW: shallow_final_reasoning",
        "actor_id": "a1",
        "matched_labels": ["shallow_final_reasoning"],
        "label_penalties": [{"label": "shallow_final_reasoning", "penalty": 0.25}],
        "evidence_refs": ["ev-1"],
        "ignored_events": [],
        "cap_applied": False,
    }
    penalties = {}
    sd = build_scheduler_decision(
        selected_actor="a1",
        logical_operator="DeepArchitect",
        score_factors={},
        penalties=penalties,
        rejected=[],
        failure_fingerprint_detail=detail,
    )
    assert penalties == {}
    assert sd["penalties"]["FailureFingerprintPenalty"] == 0.25
    assert sd["FailureFingerprintPenalty"] == 0.25
    assert sd["matched_labels"] == ["shallow_final_reasoning"]
    assert sd["evidence_refs"] == ["ev-1"]
    assert sd["failure_fingerprint"] == detail
    print("PASS: scheduler_decision_fingerprint_detail_structured")


# ---------------------------------------------------------------------------
# S03 new tests — run_dir and artifact_refs JSONL behavior
# ---------------------------------------------------------------------------

def test_write_run_entry_with_run_dir():
    """JSONL contains run_dir and artifact_refs when materialization succeeded."""
    with tempfile.TemporaryDirectory() as td:
        el = EvidenceLedger(Path(td))
        sd = build_scheduler_decision("a1", "BuilderWorker", {}, {}, [])
        fake_run_dir = "/tmp/runs/sprint1"
        fake_refs = {"run_manifest": "/tmp/runs/sprint1/run-manifest.json"}
        path = el.write_run_entry(
            "t2", "sprint1", "n1", "a1", "BuilderWorker", sd,
            run_dir=fake_run_dir,
            artifact_refs=fake_refs,
        )
        data = json.loads(Path(path).read_text().strip().split("\n")[-1])
        assert data["run_dir"] == fake_run_dir
        assert data["artifact_refs"] == fake_refs
        # Old fields still present
        assert data["task_id"] == "t2"
        assert data["sprint_id"] == "sprint1"
        assert "per_node" in data
        print("PASS: write_run_entry_with_run_dir")


def test_write_run_entry_no_run_dir():
    """JSONL omits run_dir when materialization did not happen (backward compat)."""
    with tempfile.TemporaryDirectory() as td:
        el = EvidenceLedger(Path(td))
        sd = build_scheduler_decision("a1", "BuilderWorker", {}, {}, [])
        path = el.write_run_entry("t3", "sprint2", "n1", "a1", "BuilderWorker", sd)
        data = json.loads(Path(path).read_text().strip().split("\n")[-1])
        assert "run_dir" not in data
        assert "artifact_refs" not in data
        print("PASS: write_run_entry_no_run_dir")


def test_per_node_v2_canonical_paths():
    """per_node_v2 uses A1 canonical runs/<dag-id>/nodes/<node-id>/ paths."""
    with tempfile.TemporaryDirectory() as td:
        el = EvidenceLedger(Path(td))
        sd = build_scheduler_decision("a1", "BuilderWorker", {}, {}, [])
        path = el.write_run_entry("t4", "mySprint", "myNode", "a1", "BuilderWorker", sd)
        data = json.loads(Path(path).read_text().strip().split("\n")[-1])
        assert "per_node_v2" in data
        v2 = data["per_node_v2"]
        assert "myNode" in v2["snapshot_path"]
        assert "mySprint" in v2["snapshot_path"]
        assert "runs/" in v2["snapshot_path"]
        print("PASS: per_node_v2_canonical_paths")


# ---------------------------------------------------------------------------
# S03 materialized artifact tests — scrubbing and schema
# ---------------------------------------------------------------------------

def test_materializer_creates_run_dir():
    """RunMaterializer writes run-manifest.json and scheduler_decision.json."""
    with tempfile.TemporaryDirectory() as td:
        runs_root = Path(td) / "runs"
        mat = RunMaterializer(runs_root)
        sd = build_scheduler_decision("a1", "BuilderWorker", {}, {}, [])
        run_dir, artifact_refs = mat.materialize(
            dag_id="sprint-test",
            node_id="C1",
            actor_id="a1",
            task_id="task-abc12345",
            lease=None,
            scheduler_decision=sd,
            task_envelope={"task_id": "task-abc12345", "objective": "build things"},
        )
        assert run_dir is not None
        rdir = Path(run_dir)
        assert rdir.exists()
        assert (rdir / "run-manifest.json").exists()
        assert (rdir / "scheduler_decision.json").exists()
        # node dir must exist
        node_dirs = list((rdir / "nodes").iterdir())
        assert len(node_dirs) >= 1
        node_dir = node_dirs[0]
        assert (node_dir / "task.yaml").exists()
        assert (node_dir / "operator_snapshot.json").exists()
        print("PASS: materializer_creates_run_dir")


def test_materializer_artifacts_have_schema_versions():
    """Materialized artifacts contain schema_version fields."""
    with tempfile.TemporaryDirectory() as td:
        runs_root = Path(td) / "runs"
        mat = RunMaterializer(runs_root)
        sd = build_scheduler_decision("a1", "BuilderWorker", {}, {}, [])
        run_dir, _ = mat.materialize(
            dag_id="sprint-schema",
            node_id="C1",
            actor_id="a1",
            task_id="task-sch12345",
            lease=None,
            scheduler_decision=sd,
            task_envelope={"task_id": "task-sch12345"},
        )
        rdir = Path(run_dir)
        manifest = json.loads((rdir / "run-manifest.json").read_text())
        assert manifest["schema_version"] == "solar.run_manifest.v1"
        node_dirs = list((rdir / "nodes").iterdir())
        snap = json.loads((node_dirs[0] / "operator_snapshot.json").read_text())
        assert snap["schema_version"] == "solar.operator_snapshot.v1"
        task = json.loads((node_dirs[0] / "task.yaml").read_text())
        assert task["schema_version"] == "solar.node_task.v1"
        print("PASS: materializer_artifacts_have_schema_versions")


def test_materializer_no_raw_secrets_in_artifacts():
    """Materialized artifacts must not contain raw secret-like values."""
    with tempfile.TemporaryDirectory() as td:
        runs_root = Path(td) / "runs"
        mat = RunMaterializer(runs_root)
        sd = build_scheduler_decision("a1", "BuilderWorker", {}, {}, [])
        # Inject a secret-looking value into the task envelope
        envelope = {
            "task_id": "task-sec12345",
            "objective": "test secret scrubbing",
            "api_key": "sk-" + "abcdefghijklmnopqrst",  # should be scrubbed
        }
        run_dir, _ = mat.materialize(
            dag_id="sprint-sec",
            node_id="C1",
            actor_id="a1",
            task_id="task-sec12345",
            lease=None,
            scheduler_decision=sd,
            task_envelope=envelope,
        )
        rdir = Path(run_dir)
        # Check all JSON files for raw secret patterns
        secret_pattern = "sk-" + "abcdefghijklmnopqrst"
        for fpath in rdir.rglob("*.json"):
            content = fpath.read_text()
            assert secret_pattern not in content, (
                f"Raw secret found in {fpath}"
            )
        node_dirs = list((rdir / "nodes").iterdir())
        task = json.loads((node_dirs[0] / "task.yaml").read_text())
        # api_key field must be redacted
        assert task.get("api_key") == "<REDACTED_CREDENTIAL>"
        print("PASS: materializer_no_raw_secrets_in_artifacts")


def test_scrub_artifact_metadata():
    """scrub_artifact returns proper metadata when secrets are present."""
    payload = {"api_key": "sk-" + "testkey123456", "name": "myactor"}
    result = scrub_artifact(payload)
    assert result.scrubbed is True
    assert "api_key" in result.scrubbed_fields
    assert result.payload["api_key"] == "<REDACTED_CREDENTIAL>"
    assert result.original_hash  # must be non-empty sha256
    assert result.scrub_timestamp
    assert not result.blocked
    print("PASS: scrub_artifact_metadata")


def test_scrub_artifact_no_secrets():
    """scrub_artifact marks scrubbed=False when no secrets present."""
    payload = {"actor_id": "a1", "logical_operator": "BuilderWorker"}
    result = scrub_artifact(payload)
    assert result.scrubbed is False
    assert result.scrubbed_fields == []
    assert not result.blocked
    print("PASS: scrub_artifact_no_secrets")


def test_noop_materializer():
    """NoopMaterializer always returns (None, {})."""
    nm = NoopMaterializer()
    run_dir, refs = nm.materialize(
        dag_id="d", node_id="n", actor_id="a", task_id="t",
        lease=None, scheduler_decision={}, task_envelope={},
    )
    assert run_dir is None
    assert refs == {}
    print("PASS: noop_materializer")


# ---------------------------------------------------------------------------
# C3 additional tests — backward compat, schema stability, scrubbed output
# ---------------------------------------------------------------------------

def test_scheduler_decision_backward_compat():
    """build_scheduler_decision with only legacy params produces stable schema."""
    sd = build_scheduler_decision(
        selected_actor="legacy-actor",
        logical_operator="ImplementationWorker",
        score_factors={"TaskFit": 0.5},
        penalties={},
        rejected=[],
    )
    # All legacy fields present
    assert sd["selected_actor"] == "legacy-actor"
    assert sd["logical_operator"] == "ImplementationWorker"
    assert sd["score_factors"] == {"TaskFit": 0.5}
    assert sd["penalties"] == {}
    assert sd["rejected_candidates"] == []
    # Schema fields auto-populated
    assert sd["schema_version"] == "solar.scheduler_decision.v1"
    assert "decision_id" in sd
    assert isinstance(sd["decision_id"], str) and len(sd["decision_id"]) > 0
    assert "selection_summary" in sd
    # New fields default to None/empty when not provided
    assert sd["dag_id"] is None
    assert sd["node_id"] is None
    assert sd["artifact_refs"] == {}
    assert sd["constraints"] == {}
    assert sd["replay"]["selected_actor"] == "legacy-actor"
    print("PASS: scheduler_decision_backward_compat")


def test_scheduler_decision_jsonl_roundtrip():
    """Scheduler decision survives JSONL write/read roundtrip."""
    with tempfile.TemporaryDirectory() as td:
        el = EvidenceLedger(Path(td))
        sd = build_scheduler_decision(
            selected_actor="roundtrip-actor",
            logical_operator="VerifierWorker",
            score_factors={"TaskFit": 0.8, "HistoricalSuccess": 0.6},
            penalties={"SameProviderPenalty": 0.1},
            rejected=[{"actor_id": "other", "reason": "quota"}],
            dag_id="sprint-roundtrip",
            node_id="N3",
        )
        path = el.write_run_entry(
            "t-rt", "sprint-roundtrip", "N3", "roundtrip-actor", "VerifierWorker", sd,
        )
        data = json.loads(Path(path).read_text().strip().split("\n")[-1])
        rsd = data["scheduler_decision"]
        assert rsd["schema_version"] == "solar.scheduler_decision.v1"
        assert rsd["selected_actor"] == "roundtrip-actor"
        assert rsd["score_factors"]["TaskFit"] == 0.8
        assert rsd["penalties"]["SameProviderPenalty"] == 0.1
        assert len(rsd["rejected_candidates"]) == 1
        assert rsd["dag_id"] == "sprint-roundtrip"
        assert rsd["node_id"] == "N3"
        print("PASS: scheduler_decision_jsonl_roundtrip")


def test_materialized_scheduler_decision_scrubbed():
    """Materialized scheduler_decision.json has no raw secrets when input has them."""
    with tempfile.TemporaryDirectory() as td:
        runs_root = Path(td) / "runs"
        mat = RunMaterializer(runs_root)
        sd = build_scheduler_decision("a1", "BuilderWorker", {}, {}, [])
        # Inject a secret into scheduler_decision payload
        sd["api_key"] = "sk-" + "secretkey1234567890"
        run_dir, _ = mat.materialize(
            dag_id="sprint-scrub",
            node_id="C1",
            actor_id="a1",
            task_id="task-scrub1234",
            lease=None,
            scheduler_decision=sd,
            task_envelope={"task_id": "task-scrub1234"},
        )
        rdir = Path(run_dir)
        sched = json.loads((rdir / "scheduler_decision.json").read_text())
        # The api_key field must be redacted by scrubber
        assert sched.get("api_key") == "<REDACTED_CREDENTIAL>", (
            f"Expected redacted api_key, got: {sched.get('api_key')}"
        )
        print("PASS: materialized_scheduler_decision_scrubbed")


def test_materialized_run_manifest_has_required_fields():
    """Materialized run-manifest.json contains all required top-level fields."""
    with tempfile.TemporaryDirectory() as td:
        runs_root = Path(td) / "runs"
        mat = RunMaterializer(runs_root)
        sd = build_scheduler_decision("a1", "BuilderWorker", {}, {}, [])
        run_dir, refs = mat.materialize(
            dag_id="sprint-fields",
            node_id="C1",
            actor_id="a1",
            task_id="job-fields1234",
            lease=None,
            scheduler_decision=sd,
            task_envelope={"task_id": "job-fields1234", "objective": "test"},
        )
        rdir = Path(run_dir)
        manifest = json.loads((rdir / "run-manifest.json").read_text())
        required = ["schema_version", "dag_id", "sprint_id", "task_id",
                     "created_at", "updated_at", "status", "artifacts", "nodes"]
        for field in required:
            assert field in manifest, f"Missing field: {field}"
        assert manifest["status"] in ("running", "pending")
        assert "run_manifest" in refs
        print("PASS: materialized_run_manifest_has_required_fields")


if __name__ == "__main__":
    test_write_run_entry()
    test_scheduler_decision_serialization()
    test_write_run_entry_with_run_dir()
    test_write_run_entry_no_run_dir()
    test_per_node_v2_canonical_paths()
    test_materializer_creates_run_dir()
    test_materializer_artifacts_have_schema_versions()
    test_materializer_no_raw_secrets_in_artifacts()
    test_scrub_artifact_metadata()
    test_scrub_artifact_no_secrets()
    test_noop_materializer()
    test_scheduler_decision_backward_compat()
    test_scheduler_decision_jsonl_roundtrip()
    test_materialized_scheduler_decision_scrubbed()
    test_materialized_run_manifest_has_required_fields()
    print("\n15/15 passed")
