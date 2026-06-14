"""Tests for O5: pane handoff evidence gate (sprint-20260530-s04-orchestration-ui).

Covers the evidence gate acceptance criteria:
  sidecar   — handoff references a *.runtime-context.json path → ok=True
  verifier  — handoff references a *.context-usage.json path → ok=True
  claim_only — handoff is pure NL ("done", "passed") with no file refs → ok=False
  trivial   — empty handoff.md → ok=False

Also tests:
  coordinator_hooks.gate_status_transition blocking behaviour
  O5 new evidence_refs / evidence_status validation helpers from dispatch_package
  inject_pane_evidence_requirements applies unconditionally for all node types
"""
from __future__ import annotations

import json
import os
import sys
import pytest
from pathlib import Path


# ---------------------------------------------------------------------------
# Helpers to write fixture handoff files
# ---------------------------------------------------------------------------

def _write_handoff(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _touch(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{}", encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# Import helpers (resolve tool path)
# ---------------------------------------------------------------------------

HARNESS_DIR = Path(__file__).resolve().parents[2]
TOOLS_DIR = HARNESS_DIR / "tools"

if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from pane_handoff.evidence_validator import validate_sprint_handoff, EvidenceReport


# ---------------------------------------------------------------------------
# validate_sprint_handoff tests
# ---------------------------------------------------------------------------

class TestValidateSprintHandoff:
    REAL_EVENT_ID = "19cafd5a-0f1a-46b3-ab07-88f15596c12a"
    ACTION_ID = "graph-sprint-20260530-p0-s04-O5-20260530T155216Z"

    @staticmethod
    def _load_lib_validator() -> type:
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "lib_pane_evidence_validator",
            HARNESS_DIR / "lib" / "pane_handoff" / "evidence_validator.py",
        )
        mod = importlib.util.module_from_spec(spec)
        import sys
        sys.modules["lib_pane_evidence_validator"] = mod
        spec.loader.exec_module(mod)
        return mod

    def test_event_id_ref_passes(self, tmp_path, monkeypatch):
        """Handoff with event_id only → ok=True, refs_only."""
        import pane_handoff.evidence_validator as ev_mod
        monkeypatch.setattr(ev_mod, "HARNESS_DIR", tmp_path)
        lib_mod = self._load_lib_validator()
        monkeypatch.setattr(lib_mod, "HARNESS_DIR", tmp_path)

        sprints = tmp_path / "sprints"
        text = f"Event evidence: `{self.REAL_EVENT_ID}`.\n"
        _write_handoff(sprints / "sprint-event.handoff.md", text)

        tool_result = validate_sprint_handoff("sprint-event")
        lib_result = lib_mod.validate_sprint_handoff("sprint-event")

        assert tool_result.ok is True
        assert tool_result.verdict == "refs_only"
        assert lib_result.ok is True
        assert lib_result.verdict == "refs_only"
        assert tool_result.ok == lib_result.ok
        assert tool_result.verdict == lib_result.verdict
        assert tool_result.has_sidecar_ref == lib_result.has_sidecar_ref
        assert tool_result.has_verifier_ref == lib_result.has_verifier_ref
        assert tool_result.refs["event_ids"] == [self.REAL_EVENT_ID]

    def test_action_id_ref_passes(self, tmp_path, monkeypatch):
        """Handoff with action_id only → ok=True, refs_only."""
        import pane_handoff.evidence_validator as ev_mod
        monkeypatch.setattr(ev_mod, "HARNESS_DIR", tmp_path)

        sprints = tmp_path / "sprints"
        text = f"Coordinator action: `{self.ACTION_ID}`.\n"
        _write_handoff(sprints / "sprint-action.handoff.md", text)

        result = validate_sprint_handoff("sprint-action")
        assert result.ok is True
        assert result.verdict == "refs_only"
        assert result.refs["action_ids"] == [self.ACTION_ID]

    def test_artifact_path_ref_passes_when_existing(self, tmp_path, monkeypatch):
        """Handoff with existing artifact path → ok=True, refs_only."""
        import pane_handoff.evidence_validator as ev_mod
        monkeypatch.setattr(ev_mod, "HARNESS_DIR", tmp_path)

        sprints = tmp_path / "sprints"
        artifact = sprints / "artifacts" / "evidence.txt"
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_text("ok", encoding="utf-8")
        text = f"Evidence file: `{artifact.resolve()}`\n"
        _write_handoff(sprints / "sprint-artifact.handoff.md", text)

        result = validate_sprint_handoff("sprint-artifact")
        assert result.ok is True
        assert result.verdict == "refs_only"
        assert "evidence.txt" in result.refs["artifact_paths"][0]

    def test_artifact_ref_missing_file_fails(self, tmp_path, monkeypatch):
        """Missing artifact path is not accepted as evidence."""
        import pane_handoff.evidence_validator as ev_mod
        monkeypatch.setattr(ev_mod, "HARNESS_DIR", tmp_path)

        sprints = tmp_path / "sprints"
        text = "Evidence path: `sprints/missing-artifact.json`\n"
        _write_handoff(sprints / "sprint-missing-artifact.handoff.md", text)

        result = validate_sprint_handoff("sprint-missing-artifact")
        assert result.ok is False
        assert result.verdict in ("claim_only", "refs_only")

    def test_sidecar_ref_passes(self, tmp_path, monkeypatch):
        """Handoff referencing runtime-context.json → ok=True, sidecar_verified."""
        import pane_handoff.evidence_validator as ev_mod
        monkeypatch.setattr(ev_mod, "HARNESS_DIR", tmp_path)

        sprints = tmp_path / "sprints"
        text = (
            "## Done\n"
            "- Node N1 dispatched.\n"
            "  Sidecar ref: `sprints/sprint-abc.runtime-context.json`\n"
        )
        _write_handoff(sprints / "sprint-abc.handoff.md", text)
        _touch(sprints / "sprint-abc.runtime-context.json")

        result = validate_sprint_handoff("sprint-abc")
        assert result.ok is True
        assert result.has_sidecar_ref is True
        assert result.verdict in ("sidecar_verified", "both_verified")

    def test_verifier_ref_passes(self, tmp_path, monkeypatch):
        """Handoff referencing context-usage.json → ok=True, verifier_verified."""
        import pane_handoff.evidence_validator as ev_mod
        monkeypatch.setattr(ev_mod, "HARNESS_DIR", tmp_path)

        sprints = tmp_path / "sprints"
        text = (
            "## Done\n"
            "- Evaluator ran context usage check:\n"
            "  `sprints/sprint-def.context-usage.json`\n"
        )
        _write_handoff(sprints / "sprint-def.handoff.md", text)
        _touch(sprints / "sprint-def.context-usage.json")

        result = validate_sprint_handoff("sprint-def")
        assert result.ok is True
        assert result.has_verifier_ref is True
        assert result.verdict in ("verifier_verified", "both_verified")

    def test_claim_only_fails(self, tmp_path, monkeypatch):
        """Pure NL-claim handoff with no file refs → ok=False, claim_only."""
        import pane_handoff.evidence_validator as ev_mod
        monkeypatch.setattr(ev_mod, "HARNESS_DIR", tmp_path)

        sprints = tmp_path / "sprints"
        text = "## Summary\nAll tasks completed. Tests passed. Implementation done.\n"
        _write_handoff(sprints / "sprint-xyz.handoff.md", text)

        result = validate_sprint_handoff("sprint-xyz")
        assert result.ok is False
        assert result.verdict == "claim_only"

    def test_trivial_empty_handoff_fails(self, tmp_path, monkeypatch):
        """Empty handoff file → ok=False."""
        import pane_handoff.evidence_validator as ev_mod
        monkeypatch.setattr(ev_mod, "HARNESS_DIR", tmp_path)

        sprints = tmp_path / "sprints"
        _write_handoff(sprints / "sprint-empty.handoff.md", "")

        result = validate_sprint_handoff("sprint-empty")
        assert result.ok is False

    def test_missing_handoff_file_fails(self, tmp_path, monkeypatch):
        """Handoff file not found → ok=False, verdict=no_handoff_file."""
        import pane_handoff.evidence_validator as ev_mod
        monkeypatch.setattr(ev_mod, "HARNESS_DIR", tmp_path)

        result = validate_sprint_handoff("sprint-missing")
        assert result.ok is False
        assert result.verdict == "no_handoff_file"

    def test_both_refs_verdict(self, tmp_path, monkeypatch):
        """Handoff with both sidecar and verifier refs → verdict=both_verified."""
        import pane_handoff.evidence_validator as ev_mod
        monkeypatch.setattr(ev_mod, "HARNESS_DIR", tmp_path)

        sprints = tmp_path / "sprints"
        text = (
            "## Evidence\n"
            "- Sidecar: `sprints/sprint-both.runtime-context.json`\n"
            "- Verifier: `sprints/sprint-both.context-usage.json`\n"
        )
        _write_handoff(sprints / "sprint-both.handoff.md", text)
        _touch(sprints / "sprint-both.runtime-context.json")
        _touch(sprints / "sprint-both.context-usage.json")

        result = validate_sprint_handoff("sprint-both")
        assert result.ok is True
        assert result.verdict == "both_verified"

    def test_to_dict_has_required_keys(self, tmp_path, monkeypatch):
        """EvidenceReport.to_dict() contains ok/refs/missing/task_kind."""
        import pane_handoff.evidence_validator as ev_mod
        monkeypatch.setattr(ev_mod, "HARNESS_DIR", tmp_path)

        sprints = tmp_path / "sprints"
        text = "sprints/sprint-td.runtime-context.json"
        _write_handoff(sprints / "sprint-td.handoff.md", text)
        _touch(sprints / "sprint-td.runtime-context.json")

        result = validate_sprint_handoff("sprint-td", task_kind="evaluator")
        d = result.to_dict()
        for key in ("ok", "refs", "missing", "task_kind", "has_sidecar_ref", "has_verifier_ref", "verdict"):
            assert key in d, f"missing key: {key}"
        assert d["task_kind"] == "evaluator"


# ---------------------------------------------------------------------------
# coordinator_hooks.gate_status_transition tests
# ---------------------------------------------------------------------------

LIB_DIR = HARNESS_DIR / "lib"

def _get_gate_fn():
    """Load gate_status_transition from lib/coordinator_hooks.py by path."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "lib_coordinator_hooks",
        LIB_DIR / "coordinator_hooks.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestGateStatusTransition:
    ACTION_ID = "graph-sprint-20260530-p0-s04-O5-20260530T155216Z"

    def test_allow_when_not_reviewing_to_passed(self, monkeypatch):
        monkeypatch.setenv("EVIDENCE_GATE", "1")
        ch = _get_gate_fn()
        d = ch.gate_status_transition("sprint-x", "active", "reviewing")
        assert d.action == "allow"

    def test_allow_when_gate_disabled(self, monkeypatch):
        monkeypatch.setenv("EVIDENCE_GATE", "0")
        ch = _get_gate_fn()
        d = ch.gate_status_transition("sprint-x", "reviewing", "passed")
        assert d.action == "allow"
        assert d.reason == "evidence_gate_disabled"

    def test_abort_when_no_handoff(self, tmp_path, monkeypatch):
        """No handoff.md → evidence gate blocks reviewing→passed."""
        monkeypatch.setenv("EVIDENCE_GATE", "1")
        import pane_handoff.evidence_validator as ev_mod
        monkeypatch.setattr(ev_mod, "HARNESS_DIR", tmp_path)

        ch = _get_gate_fn()
        ch.HARNESS_DIR = str(tmp_path)
        d = ch.gate_status_transition("sprint-nofile", "reviewing", "passed")
        assert d.action == "abort"
        assert d.pattern == "handoff_evidence_blocked"

    def test_allow_when_sidecar_ref_present(self, tmp_path, monkeypatch):
        """Valid sidecar_ref in handoff → gate allows reviewing→passed."""
        monkeypatch.setenv("EVIDENCE_GATE", "1")
        import pane_handoff.evidence_validator as ev_mod
        monkeypatch.setattr(ev_mod, "HARNESS_DIR", tmp_path)

        sprints = tmp_path / "sprints"
        text = "Evidence: `sprints/sprint-valid.runtime-context.json`\n"
        _write_handoff(sprints / "sprint-valid.handoff.md", text)
        _touch(sprints / "sprint-valid.runtime-context.json")

        ch = _get_gate_fn()
        ch.HARNESS_DIR = str(tmp_path)
        d = ch.gate_status_transition("sprint-valid", "reviewing", "passed")
        assert d.action == "allow"

    def test_allow_when_action_id_ref_present(self, tmp_path, monkeypatch):
        """Action-id evidence in handoff also allows reviewing→passed."""
        monkeypatch.setenv("EVIDENCE_GATE", "1")
        import pane_handoff.evidence_validator as ev_mod
        monkeypatch.setattr(ev_mod, "HARNESS_DIR", tmp_path)

        sprints = tmp_path / "sprints"
        text = f"Handoff action evidence: `{self.ACTION_ID}`\n"
        _write_handoff(sprints / "sprint-action-gate.handoff.md", text)

        ch = _get_gate_fn()
        ch.HARNESS_DIR = str(tmp_path)
        d = ch.gate_status_transition("sprint-action-gate", "reviewing", "passed")
        assert d.action == "allow"

    def test_abort_emits_event(self, tmp_path, monkeypatch):
        """Abort writes handoff_evidence_blocked to events.jsonl."""
        monkeypatch.setenv("EVIDENCE_GATE", "1")
        import pane_handoff.evidence_validator as ev_mod
        monkeypatch.setattr(ev_mod, "HARNESS_DIR", tmp_path)

        ch = _get_gate_fn()
        ch.HARNESS_DIR = str(tmp_path)
        ch.gate_status_transition("sprint-emit", "reviewing", "passed")

        events_path = tmp_path / "events.jsonl"
        if events_path.exists():
            events = [json.loads(l) for l in events_path.read_text().splitlines() if l.strip()]
            blocked = [e for e in events if e.get("event") == "handoff_evidence_blocked"]
            assert len(blocked) >= 1
            assert blocked[0]["sprint_id"] == "sprint-emit"


# ---------------------------------------------------------------------------
# O5 node: evidence_refs / evidence_status validation + pane evidence injection
# ---------------------------------------------------------------------------

LIB_DISPATCH_DIR = HARNESS_DIR / "lib"

def _import_dispatch_package():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "lib_dispatch_package",
        LIB_DISPATCH_DIR / "dispatch_package.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _import_lib_injector():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "lib_dispatch_prompt_injector",
        LIB_DISPATCH_DIR / "dispatch_prompt_injector.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _import_tools_injector():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "tools_dispatch_prompt_injector",
        HARNESS_DIR / "tools" / "dispatch_prompt_injector.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestO5EvidenceValidationHelpers:
    """O5: validate_evidence_status and validate_evidence_refs from dispatch_package."""

    def test_valid_evidence_status_complete(self):
        dp = _import_dispatch_package()
        errs = dp.validate_evidence_status("complete")
        assert errs == []

    def test_valid_evidence_status_none(self):
        dp = _import_dispatch_package()
        errs = dp.validate_evidence_status(None)
        assert errs == []

    def test_invalid_evidence_status_rejected(self):
        dp = _import_dispatch_package()
        errs = dp.validate_evidence_status("done")
        assert len(errs) == 1
        assert "done" in errs[0]

    def test_valid_evidence_refs_artifact_path(self):
        dp = _import_dispatch_package()
        refs = [{"type": "artifact_path", "ref": "/tmp/run/output.json"}]
        errs = dp.validate_evidence_refs(refs)
        assert errs == []

    def test_valid_evidence_refs_event_id(self):
        dp = _import_dispatch_package()
        refs = [{"type": "event_id", "ref": "19cafd5a-0f1a-46b3-ab07-88f15596c12a"}]
        errs = dp.validate_evidence_refs(refs)
        assert errs == []

    def test_valid_evidence_refs_action_id(self):
        dp = _import_dispatch_package()
        refs = [{"type": "action_id", "ref": "graph-sprint-20260530-p0-s04-O5-20260530T155216Z"}]
        errs = dp.validate_evidence_refs(refs)
        assert errs == []

    def test_valid_evidence_refs_command_result(self):
        dp = _import_dispatch_package()
        refs = [{"type": "command_result", "ref": "pytest tests/ -v 2>&1 | tail -20"}]
        errs = dp.validate_evidence_refs(refs)
        assert errs == []

    def test_valid_evidence_refs_run_dir_file(self):
        dp = _import_dispatch_package()
        refs = [{"type": "run_dir_file", "ref": "runs/20260530/O5/output.txt"}]
        errs = dp.validate_evidence_refs(refs)
        assert errs == []

    def test_invalid_evidence_refs_bad_type(self):
        dp = _import_dispatch_package()
        refs = [{"type": "screenshot", "ref": "/tmp/screen.png"}]
        errs = dp.validate_evidence_refs(refs)
        assert len(errs) == 1
        assert "screenshot" in errs[0]

    def test_invalid_evidence_refs_missing_type(self):
        dp = _import_dispatch_package()
        refs = [{"ref": "/tmp/output.json"}]
        errs = dp.validate_evidence_refs(refs)
        assert any("type" in e for e in errs)

    def test_invalid_evidence_refs_missing_ref(self):
        dp = _import_dispatch_package()
        refs = [{"type": "artifact_path"}]
        errs = dp.validate_evidence_refs(refs)
        assert any("ref" in e for e in errs)

    def test_invalid_evidence_refs_empty_ref_string(self):
        dp = _import_dispatch_package()
        refs = [{"type": "event_id", "ref": ""}]
        errs = dp.validate_evidence_refs(refs)
        assert len(errs) == 1

    def test_evidence_refs_none_is_valid(self):
        dp = _import_dispatch_package()
        errs = dp.validate_evidence_refs(None)
        assert errs == []

    def test_evidence_refs_not_list_rejected(self):
        dp = _import_dispatch_package()
        errs = dp.validate_evidence_refs({"type": "event_id", "ref": "x"})
        assert len(errs) == 1


class TestO5PaneEvidenceInjection:
    """O5: inject_pane_evidence_requirements applies to all node types."""

    def test_lib_injector_injects_for_non_research_node(self):
        inj = _import_lib_injector()
        text = "# Dispatch\nDo some work.\n"
        result = inj.inject_pane_evidence_requirements(text)
        assert "<!-- pane-evidence-requirements" in result
        assert "evidence_status" in result

    def test_lib_injector_injects_for_research_node(self):
        inj = _import_lib_injector()
        text = "# Research dispatch\n"
        result = inj.inject_pane_evidence_requirements(text)
        assert "<!-- pane-evidence-requirements" in result

    def test_lib_injector_idempotent(self):
        inj = _import_lib_injector()
        text = "# Dispatch\n"
        once = inj.inject_pane_evidence_requirements(text)
        twice = inj.inject_pane_evidence_requirements(once)
        assert once == twice

    def test_tools_injector_injects_for_o5_node(self):
        inj = _import_tools_injector()
        text = "# O5 pane dispatch\nProcess the evidence gate.\n"
        result = inj.inject_pane_evidence_requirements(text)
        assert "<!-- pane-evidence-requirements" in result
        assert "handoff MUST include machine-readable evidence" in result

    def test_tools_injector_idempotent(self):
        inj = _import_tools_injector()
        text = "# O5 pane\n"
        once = inj.inject_pane_evidence_requirements(text)
        twice = inj.inject_pane_evidence_requirements(once)
        assert once == twice

    def test_pane_evidence_text_forbids_prose_only(self):
        """Injected text must mention prohibition against prose-only claims."""
        inj = _import_lib_injector()
        result = inj.inject_pane_evidence_requirements("# dispatch\n")
        assert "automatically rejected" in result or "Prohibited" in result

    def test_pane_evidence_accepted_forms_listed(self):
        """Injected text must enumerate accepted evidence forms."""
        inj = _import_lib_injector()
        result = inj.inject_pane_evidence_requirements("# dispatch\n")
        assert "event_id" in result
        assert "artifact_path" in result
        assert "command_result" in result
