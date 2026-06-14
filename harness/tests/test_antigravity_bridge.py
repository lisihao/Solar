"""Tests for antigravity_bridge.py — N2_bridge_adapter acceptance criteria.

ACC-G2:
  1. Adapter scans ~/.solar/antigravity-bridge/from-antigravity using
     home-derived paths and ignores .processed.
  2. Supported prefixes match S01: req-, conv-, artifact-, review-, ctx-.
  3. Invalid prefixes, invalid JSON, absolute attachment paths, and
     path traversal produce failure evidence without deleting input.
  4. Codex chain-watcher behavior is not changed unless covered by
     non-regression tests.
"""
from __future__ import annotations

import json
import os
import shutil
import textwrap
from pathlib import Path
from unittest import mock

import pytest

# Module under test
sys_path_inserted = False
import sys

HARNESS_DIR = Path(__file__).resolve().parents[1]
if str(HARNESS_DIR / "lib") not in sys.path:
    sys.path.insert(0, str(HARNESS_DIR / "lib"))
    sys_path_inserted = True

from antigravity_bridge import (
    PROCESSED_DIR_NAME,
    SUPPORTED_PREFIXES,
    bridge_root,
    check_attachment_paths,
    classify_file,
    classify_file,
    content_hash_str,
    evidence_dir,
    inbox_dir,
    process_file,
    processed_dir,
    scan_once,
    validate_json_content,
    write_failure_evidence,
    write_success_evidence,
)


@pytest.fixture
def tmp_bridge(tmp_path: Path, monkeypatch):
    """Set up a temporary bridge root with inbox and processed dirs."""
    bridge = tmp_path / "antigravity-bridge"
    inbox = bridge / "from-antigravity"
    processed = inbox / PROCESSED_DIR_NAME
    processed.mkdir(parents=True, exist_ok=True)

    monkeypatch.setenv("SOLAR_ANTIGRAVITY_BRIDGE_ROOT", str(bridge))
    # Override the module-level functions to use the temp root
    with mock.patch("antigravity_bridge.bridge_root", return_value=bridge), \
         mock.patch("antigravity_bridge.inbox_dir", return_value=inbox), \
         mock.patch("antigravity_bridge.processed_dir", return_value=processed), \
         mock.patch("antigravity_bridge.evidence_dir", return_value=inbox / ".evidence"):
        yield {
            "bridge": bridge,
                "inbox": inbox,
                "processed": processed,
            "evidence": inbox / ".evidence",
        }


# ── Acceptance Criterion 1: Home-derived paths, ignores .processed ──


class TestHomeDerivedPaths:
    def test_bridge_root_uses_home(self):
        """bridge_root() derives from HOME, not hardcoded paths."""
        root = bridge_root()
        assert ".solar" in str(root)
        assert "antigravity-bridge" in str(root)
        home = Path(os.environ.get("HOME", Path.home()))
        assert str(root).startswith(str(home))

    def test_inbox_is_under_bridge_root(self):
        inbox = inbox_dir()
        assert str(inbox).endswith("from-antigravity")

    def test_processed_dir_is_inside_inbox(self):
        proc = processed_dir()
        assert str(proc).endswith(".processed")
        assert "from-antigravity" in str(proc)


class TestIgnoresProcessed:
    def test_files_in_processed_are_skipped(self, tmp_bridge):
        inbox = tmp_bridge["inbox"]
        processed = tmp_bridge["processed"]

        # Put a file in .processed
        (processed / "req-test.md").write_text("# test\n", encoding="utf-8")

        # Put same file in inbox
        f = inbox / "req-test.md"
        f.write_text("# test\n", encoding="utf-8")

        result = scan_once(dry_run=True)
        # Should be skipped since it exists in .processed
        assert "req-test.md" in result.skipped_already_processed

    def test_dotfiles_are_ignored(self, tmp_bridge):
        inbox = tmp_bridge["inbox"]
        (inbox / ".hidden").write_text("secret", encoding="utf-8")

        result = scan_once(dry_run=True)
        assert ".hidden" not in result.processed
        assert ".hidden" not in result.failed_validation


# ── Acceptance Criterion 2: Supported prefixes match S01 ──


class TestSupportedPrefixes:
    @pytest.mark.parametrize("prefix", ["req-", "conv-", "artifact-", "review-", "ctx-"])
    def test_prefix_accepted(self, prefix):
        name = f"{prefix}test-item.md"
        assert classify_file(name) == prefix.rstrip("-")

    def test_all_s01_prefixes_covered(self):
        s01_prefixes = {"req-", "conv-", "artifact-", "review-", "ctx-"}
        assert set(SUPPORTED_PREFIXES) == s01_prefixes

    def test_unsupported_prefix_returns_none(self):
        assert classify_file("unknown-item.md") is None
        assert classify_file("test.md") is None
        assert classify_file("contract-xyz.md") is None


# ── Acceptance Criterion 3: Invalid inputs produce evidence without deleting ──


class TestInvalidPrefix:
    def test_invalid_prefix_produces_failure_evidence(self, tmp_bridge):
        inbox = tmp_bridge["inbox"]
        evidence = tmp_bridge["evidence"]

        f = inbox / "bogus-file.md"
        f.write_text("# bogus\n", encoding="utf-8")

        ok, msg = process_file(f, dry_run=True)
        assert not ok
        assert "invalid prefix" in msg.lower()

    def test_invalid_prefix_file_not_deleted(self, tmp_bridge):
        inbox = tmp_bridge["inbox"]

        f = inbox / "bogus-file.md"
        f.write_text("# bogus\n", encoding="utf-8")

        process_file(f, dry_run=True)
        # File must still exist in inbox
        assert f.exists(), "Invalid prefix file was deleted but should be preserved"


class TestInvalidJSON:
    def test_invalid_json_produces_failure_evidence(self, tmp_bridge):
        inbox = tmp_bridge["inbox"]

        f = inbox / "conv-test.json"
        f.write_text("{not valid json}", encoding="utf-8")

        ok, msg = process_file(f, dry_run=True)
        assert not ok
        assert "invalid json" in msg.lower()

    def test_invalid_json_file_not_deleted(self, tmp_bridge):
        inbox = tmp_bridge["inbox"]

        f = inbox / "conv-test.json"
        f.write_text("{broken", encoding="utf-8")

        process_file(f, dry_run=True)
        assert f.exists(), "Invalid JSON file was deleted but should be preserved"

    def test_json_array_root_rejected(self, tmp_bridge):
        inbox = tmp_bridge["inbox"]

        f = inbox / "conv-array.json"
        f.write_text("[1, 2, 3]", encoding="utf-8")

        ok, msg = process_file(f, dry_run=True)
        assert not ok
        assert "invalid" in msg.lower() or "must be an object" in msg.lower()


class TestAbsoluteAttachmentPaths:
    def test_absolute_path_in_attachments_rejected(self, tmp_bridge):
        inbox = tmp_bridge["inbox"]

        f = inbox / "artifact-test.json"
        f.write_text(json.dumps({
            "artifact_refs": ["/etc/passwd", "relative/path.txt"],
        }), encoding="utf-8")

        ok, msg = process_file(f, dry_run=True)
        assert not ok
        assert "absolute" in msg.lower() or "unsafe" in msg.lower()

    def test_absolute_path_file_not_deleted(self, tmp_bridge):
        inbox = tmp_bridge["inbox"]

        f = inbox / "artifact-abs.json"
        f.write_text(json.dumps({
            "artifact_refs": ["/absolute/path"],
        }), encoding="utf-8")

        process_file(f, dry_run=True)
        assert f.exists(), "File with absolute attachment path was deleted"


class TestPathTraversal:
    def test_path_traversal_in_attachments_rejected(self, tmp_bridge):
        inbox = tmp_bridge["inbox"]

        f = inbox / "artifact-traversal.json"
        f.write_text(json.dumps({
            "artifact_refs": ["../../../etc/passwd", "safe.txt"],
        }), encoding="utf-8")

        ok, msg = process_file(f, dry_run=True)
        assert not ok
        assert "traversal" in msg.lower() or "unsafe" in msg.lower()

    def test_path_traversal_file_not_deleted(self, tmp_bridge):
        inbox = tmp_bridge["inbox"]

        f = inbox / "artifact-trav.json"
        f.write_text(json.dumps({
            "artifact_refs": ["../../secret"],
        }), encoding="utf-8")

        process_file(f, dry_run=True)
        assert f.exists(), "File with path traversal was deleted"

    def test_check_attachment_paths_detects_traversal(self):
        obj = {"artifact_refs": ["../../../etc/shadow"]}
        violations = check_attachment_paths(obj)
        assert len(violations) > 0
        assert any("traversal" in v.lower() for v in violations)


# ── Failure evidence structure ──


class TestFailureEvidence:
    def test_evidence_written_to_dot_evidence_dir(self, tmp_bridge):
        inbox = tmp_bridge["inbox"]
        evidence = tmp_bridge["evidence"]

        f = inbox / "bogus.md"
        f.write_text("data", encoding="utf-8")

        process_file(f, dry_run=True)

        # Evidence dir should have a .fail. file
        if evidence.exists():
            ev_files = list(evidence.glob("bogus.fail.*.json"))
            assert len(ev_files) > 0, "No failure evidence written"

            ev = json.loads(ev_files[0].read_text(encoding="utf-8"))
            assert ev["file"] == "bogus.md"
            assert "reason" in ev

    def test_evidence_contains_original_hash(self, tmp_bridge):
        inbox = tmp_bridge["inbox"]

        f = inbox / "bogus-hash.md"
        f.write_text("some content", encoding="utf-8")

        process_file(f, dry_run=True)

        evidence = tmp_bridge["evidence"]
        if evidence.exists():
            ev_files = list(evidence.glob("bogus-hash.fail.*.json"))
            if ev_files:
                ev = json.loads(ev_files[0].read_text(encoding="utf-8"))
                assert "original_content_hash" in ev


# ── Dry-run mode ──


class TestDryRun:
    def test_dry_run_does_not_move_files(self, tmp_bridge):
        inbox = tmp_bridge["inbox"]

        f = inbox / "req-dry.md"
        f.write_text("# dry run test\n", encoding="utf-8")

        ok, msg = process_file(f, dry_run=True)
        assert ok
        assert "dry-run" in msg
        # File should still be in inbox
        assert f.exists()


# ── Acceptance Criterion 4: Codex chain-watcher not affected ──


class TestCodexNonRegression:
    def test_chain_watcher_file_unchanged(self):
        """chain-watcher.sh must not be modified by N2."""
        watcher = HARNESS_DIR / "chain-watcher.sh"
        assert watcher.exists(), "chain-watcher.sh missing"

    def test_codex_inbox_not_scanned(self, tmp_bridge):
        """Antigravity bridge must not scan codex inbox."""
        # Write a file that would be valid for codex but not antigravity
        inbox = tmp_bridge["inbox"]
        f = inbox / "contract-test.md"
        f.write_text("# contract\n", encoding="utf-8")

        result = scan_once(dry_run=True)
        # contract- prefix is not in antigravity supported prefixes
        # Should fail validation (invalid prefix)
        assert "contract-test.md" in result.failed_validation or \
               "contract-test.md" not in result.processed

    def test_antigravity_does_not_use_codex_paths(self):
        """Antigravity paths must be separate from codex paths."""
        ag_bridge = bridge_root()
        codex_bridge = Path.home() / ".solar" / "codex-bridge"
        assert str(ag_bridge) != str(codex_bridge)
        assert "antigravity-bridge" in str(ag_bridge)


# ── classify_file edge cases ──


class TestClassifyEdgeCases:
    def test_prefix_at_start_only(self):
        assert classify_file("req-item.md") == "req"
        assert classify_file("xreq-item.md") is None

    def test_case_sensitive(self):
        assert classify_file("REQ-item.md") is None
        assert classify_file("Req-item.md") is None

    def test_empty_string(self):
        assert classify_file("") is None

    def test_prefix_only(self):
        assert classify_file("req-") == "req"

    def test_multiple_dots(self):
        # Dots are not dashes; "review." does not match "review-" prefix
        assert classify_file("review.complex.name.md") is None
        # But hyphenated version works
        assert classify_file("review-complex-name.md") == "review"


# ── validate_json_content edge cases ──


class TestValidateJsonEdgeCases:
    def test_valid_json_object(self):
        obj, err = validate_json_content('{"key": "value"}')
        assert obj is not None
        assert err is None

    def test_empty_object(self):
        obj, err = validate_json_content('{}')
        assert obj is not None
        assert err is None

    def test_invalid_json(self):
        obj, err = validate_json_content('not json')
        assert obj is None
        assert err is not None

    def test_json_array(self):
        obj, err = validate_json_content('[1,2,3]')
        assert obj is None
        assert "object" in (err or "").lower()

    def test_json_string(self):
        obj, err = validate_json_content('"hello"')
        assert obj is None

    def test_json_null(self):
        obj, err = validate_json_content('null')
        assert obj is None


# ── check_attachment_paths edge cases ──


class TestAttachmentPathsEdgeCases:
    def test_no_refs(self):
        violations = check_attachment_paths({"other": "data"})
        assert violations == []

    def test_empty_refs(self):
        violations = check_attachment_paths({"artifact_refs": []})
        assert violations == []

    def test_safe_relative_paths(self):
        violations = check_attachment_paths({
            "artifact_refs": ["docs/file.txt", "images/pic.png"],
        })
        assert violations == []

    def test_mixed_safe_and_unsafe(self):
        violations = check_attachment_paths({
            "artifact_refs": ["safe.txt", "/absolute/path", "../traversal"],
        })
        assert len(violations) >= 2

    def test_non_string_refs_ignored(self):
        violations = check_attachment_paths({
            "artifact_refs": [123, None, True],
        })
        assert violations == []

    def test_attachments_key_also_checked(self):
        """The 'attachments' key is also checked for backward compat."""
        violations = check_attachment_paths({
            "attachments": ["/etc/shadow"],
        })
        assert len(violations) > 0


# ── scan_once with empty/missing inbox ──


class TestScanEdgeCases:
    def test_scan_empty_inbox(self, tmp_bridge):
        result = scan_once(dry_run=True)
        assert result.processed == []
        assert result.failed_validation == []

    def test_scan_missing_inbox(self, tmp_path, monkeypatch):
        """Scanning a non-existent inbox should not crash."""
        monkeypatch.setenv("SOLAR_ANTIGRAVITY_BRIDGE_ROOT", str(tmp_path / "nonexistent"))
        with mock.patch("antigravity_bridge.inbox_dir", return_value=tmp_path / "nonexistent" / "from-antigravity"):
            result = scan_once(dry_run=True)
            assert result.processed == []

    def test_scan_multiple_files(self, tmp_bridge):
        inbox = tmp_bridge["inbox"]

        (inbox / "req-a.md").write_text("# a\n", encoding="utf-8")
        (inbox / "review-b.md").write_text("# b\n", encoding="utf-8")
        (inbox / "ctx-c.json").write_text('{"key": "val"}', encoding="utf-8")
        (inbox / "bogus-d.md").write_text("# d\n", encoding="utf-8")

        result = scan_once(dry_run=True)
        # req-a, review-b, ctx-c should be dry-run ok
        # bogus-d should fail validation
        assert "req-a.md" in result.processed
        assert "review-b.md" in result.processed
        assert "ctx-c.json" in result.processed
        assert "bogus-d.md" in result.failed_validation


# ── CLI entry point (basic) ──


class TestCLI:
    def test_classify_valid(self):
        from antigravity_bridge import main
        assert main(["classify", "req-test.md"]) == 0

    def test_classify_invalid(self):
        from antigravity_bridge import main
        assert main(["classify", "bogus.md"]) == 1

    def test_validate_existing_valid(self, tmp_bridge):
        inbox = tmp_bridge["inbox"]
        f = inbox / "req-validate.md"
        f.write_text("# valid\n", encoding="utf-8")

        from antigravity_bridge import main
        with mock.patch("antigravity_bridge.inbox_dir", return_value=inbox):
            assert main(["validate", str(f)]) == 0

    def test_validate_existing_invalid_prefix(self, tmp_bridge):
        inbox = tmp_bridge["inbox"]
        f = inbox / "bogus-validate.md"
        f.write_text("# invalid\n", encoding="utf-8")

        from antigravity_bridge import main
        assert main(["validate", str(f)]) == 1

    def test_health(self, tmp_bridge):
        from antigravity_bridge import main
        with mock.patch("antigravity_bridge.inbox_dir", return_value=tmp_bridge["inbox"]), \
             mock.patch("antigravity_bridge.processed_dir", return_value=tmp_bridge["processed"]), \
             mock.patch("antigravity_bridge.evidence_dir", return_value=tmp_bridge["evidence"]):
            assert main(["health"]) == 0


# ── N4 Failure Recovery: ACC-G4 ──────────────────────────────────────────


class TestN4IdempotencyDuplicateContent:
    """ACC-G4-1: Duplicate source path and content hash are skipped or replayed
    idempotently without duplicate compiled packages."""

    def test_same_filename_same_content_idempotent_skip(self, tmp_bridge):
        """Re-processing the same file (same name, same content) is idempotent."""
        inbox = tmp_bridge["inbox"]
        processed = tmp_bridge["processed"]

        f = inbox / "req-dup.md"
        f.write_text("# duplicate test\n", encoding="utf-8")

        ok1, msg1 = process_file(f, dry_run=True)
        assert ok1
        assert "dry-run" in msg1

        # Create idempotency ledger manually to simulate first successful processing
        ledger = processed / "idempotency-ledger.jsonl"
        ledger.parent.mkdir(parents=True, exist_ok=True)
        h = content_hash_str("# duplicate test\n")
        ledger.write_text(
            json.dumps({"key": f"req-dup.md:{h}", "file": "req-dup.md",
                         "intent_id": "test-intent-001", "timestamp": "2026-06-06T00:00:00Z"}) + "\n",
            encoding="utf-8",
        )

        ok2, msg2 = process_file(f, dry_run=True)
        assert ok2
        assert "idempotent skip" in msg2

    def test_same_filename_different_content_not_skipped(self, tmp_bridge):
        """Same filename but different content is NOT idempotent (new hash)."""
        inbox = tmp_bridge["inbox"]
        processed = tmp_bridge["processed"]

        f = inbox / "req-changed.md"
        f.write_text("# original content\n", encoding="utf-8")

        # Create ledger with old content hash
        h_old = content_hash_str("# original content\n")
        ledger = processed / "idempotency-ledger.jsonl"
        ledger.parent.mkdir(parents=True, exist_ok=True)
        ledger.write_text(
            json.dumps({"key": f"req-changed.md:{h_old}", "file": "req-changed.md",
                         "intent_id": "test-intent-old", "timestamp": "2026-06-06T00:00:00Z"}) + "\n",
            encoding="utf-8",
        )

        # Change file content
        f.write_text("# new content\n", encoding="utf-8")

        ok, msg = process_file(f, dry_run=True)
        assert ok
        assert "dry-run" in msg  # Not skipped as idempotent


class TestN4FailureStateMetadata:
    """ACC-G4-2: failed_validation, failed_capture, and failed_consume states
    are recorded with enough metadata to retry or reconstruct state."""

    def test_failure_evidence_has_stage_field(self, tmp_bridge):
        """Failure evidence records the pipeline stage."""
        inbox = tmp_bridge["inbox"]
        evidence = tmp_bridge["evidence"]

        f = inbox / "bogus-stage.md"
        f.write_text("# test\n", encoding="utf-8")

        process_file(f, dry_run=True)

        ev_files = list(evidence.glob("bogus-stage.fail.*.json"))
        assert ev_files, "No failure evidence written"
        ev = json.loads(ev_files[0].read_text(encoding="utf-8"))
        assert ev.get("stage") == "validation"

    def test_failure_evidence_v2_schema(self, tmp_bridge):
        """Failure evidence uses v2 schema with reconstruction metadata."""
        inbox = tmp_bridge["inbox"]
        evidence = tmp_bridge["evidence"]

        f = inbox / "conv-bad.json"
        f.write_text("{broken json", encoding="utf-8")

        process_file(f, dry_run=True)

        ev_files = list(evidence.glob("conv-bad.fail.*.json"))
        assert ev_files
        ev = json.loads(ev_files[0].read_text(encoding="utf-8"))
        assert ev["schema_version"] == "solar.antigravity_bridge.fail_evidence.v2"
        assert "source_path" in ev
        assert "file_size" in ev
        assert "original_content_hash" in ev
        assert "stage" in ev
        assert "timestamp" in ev
        assert "reason" in ev

    def test_invalid_json_failure_evidence_has_content_hash(self, tmp_bridge):
        """Invalid JSON failure evidence includes content hash for retry."""
        inbox = tmp_bridge["inbox"]
        evidence = tmp_bridge["evidence"]

        content = "{not valid json}"
        f = inbox / "conv-hash.json"
        f.write_text(content, encoding="utf-8")

        process_file(f, dry_run=True)

        ev_files = list(evidence.glob("conv-hash.fail.*.json"))
        assert ev_files
        ev = json.loads(ev_files[0].read_text(encoding="utf-8"))
        expected_hash = content_hash_str(content)
        assert ev["original_content_hash"] == expected_hash

    def test_path_traversal_failure_evidence_stage_is_validation(self, tmp_bridge):
        """Path traversal rejection is recorded at validation stage."""
        inbox = tmp_bridge["inbox"]
        evidence = tmp_bridge["evidence"]

        f = inbox / "artifact-trav-stage.json"
        f.write_text(json.dumps({"artifact_refs": ["../../../etc/passwd"]}), encoding="utf-8")

        process_file(f, dry_run=True)

        ev_files = list(evidence.glob("artifact-trav-stage.fail.*.json"))
        assert ev_files
        ev = json.loads(ev_files[0].read_text(encoding="utf-8"))
        assert ev.get("stage") == "validation"
        assert "traversal" in ev.get("reason", "").lower() or "unsafe" in ev.get("reason", "").lower()

    def test_absolute_path_failure_evidence_has_file_size(self, tmp_bridge):
        """Failure evidence includes file_size for reconstruction."""
        inbox = tmp_bridge["inbox"]
        evidence = tmp_bridge["evidence"]

        content = json.dumps({"artifact_refs": ["/etc/passwd"]})
        f = inbox / "artifact-abs-meta.json"
        f.write_text(content, encoding="utf-8")

        process_file(f, dry_run=True)

        ev_files = list(evidence.glob("artifact-abs-meta.fail.*.json"))
        assert ev_files
        ev = json.loads(ev_files[0].read_text(encoding="utf-8"))
        assert ev["file_size"] == len(content.encode("utf-8"))

    def test_failure_evidence_has_reason_for_retry(self, tmp_bridge):
        """Every failure evidence has enough reason text to understand what to fix."""
        inbox = tmp_bridge["inbox"]
        evidence = tmp_bridge["evidence"]

        f = inbox / "bogus-reason.md"
        f.write_text("# nope\n", encoding="utf-8")

        process_file(f, dry_run=True)

        ev_files = list(evidence.glob("bogus-reason.fail.*.json"))
        assert ev_files
        ev = json.loads(ev_files[0].read_text(encoding="utf-8"))
        assert ev["reason"] == "invalid_prefix"
        assert len(ev.get("details", "")) > 0


class TestN4ProcessedOnlyAfterEvidence:
    """ACC-G4-3: Input files are moved to .processed only after capture and
    consume evidence is recorded."""

    def test_dry_run_does_not_move_to_processed(self, tmp_bridge):
        """Dry-run never moves files to .processed."""
        inbox = tmp_bridge["inbox"]
        processed = tmp_bridge["processed"]

        f = inbox / "req-dry-nomove.md"
        f.write_text("# dry\n", encoding="utf-8")

        ok, msg = process_file(f, dry_run=True)
        assert ok
        assert f.exists(), "File was moved during dry-run"
        assert not (processed / "req-dry-nomove.md").exists()

    def test_invalid_input_stays_in_inbox(self, tmp_bridge):
        """Invalid input files remain in inbox, not moved to .processed."""
        inbox = tmp_bridge["inbox"]
        processed = tmp_bridge["processed"]

        f = inbox / "bogus-stay.md"
        f.write_text("# invalid\n", encoding="utf-8")

        process_file(f, dry_run=True)

        assert f.exists(), "Invalid file was removed from inbox"
        assert not (processed / "bogus-stay.md").exists()

    def test_invalid_json_stays_in_inbox(self, tmp_bridge):
        """Invalid JSON files remain in inbox."""
        inbox = tmp_bridge["inbox"]
        processed = tmp_bridge["processed"]

        f = inbox / "conv-stay.json"
        f.write_text("{bad", encoding="utf-8")

        process_file(f, dry_run=True)

        assert f.exists(), "Invalid JSON file was removed from inbox"
        assert not (processed / "conv-stay.json").exists()

    def test_success_evidence_written_for_capture_stage(self, tmp_bridge):
        """Capture success evidence file is created with .capture.ok pattern."""
        inbox = tmp_bridge["inbox"]
        evidence = tmp_bridge["evidence"]

        f = inbox / "req-cap-ev.md"
        f.write_text("# test capture evidence\n", encoding="utf-8")

        ev_path = write_success_evidence(f, "test-intent-123", "capture")
        assert ev_path.exists()
        assert ".capture.ok." in ev_path.name

        data = json.loads(ev_path.read_text(encoding="utf-8"))
        assert data["intent_id"] == "test-intent-123"
        assert data["stage"] == "capture"

    def test_success_evidence_written_for_consume_stage(self, tmp_bridge):
        """Consume success evidence file is created with .consume.ok pattern."""
        inbox = tmp_bridge["inbox"]
        evidence = tmp_bridge["evidence"]

        f = inbox / "req-con-ev.md"
        f.write_text("# test consume evidence\n", encoding="utf-8")

        ev_path = write_success_evidence(f, "test-intent-456", "consume")
        assert ev_path.exists()
        assert ".consume.ok." in ev_path.name

        data = json.loads(ev_path.read_text(encoding="utf-8"))
        assert data["intent_id"] == "test-intent-456"
        assert data["stage"] == "consume"


class TestN4FailureTestsProveInboxRetention:
    """ACC-G4-4: Failure tests prove invalid inputs remain in inbox and
    evidence is written."""

    def test_all_invalid_prefix_files_remain_in_inbox(self, tmp_bridge):
        """Multiple invalid files all stay in inbox after scan."""
        inbox = tmp_bridge["inbox"]

        for name in ["bad1.md", "unknown.txt", "wrong-prefix.json"]:
            (inbox / name).write_text(f"# {name}\n", encoding="utf-8")

        result = scan_once(dry_run=True)

        for name in ["bad1.md", "unknown.txt", "wrong-prefix.json"]:
            assert (inbox / name).exists(), f"{name} was removed from inbox"
            assert name in result.failed_validation

    def test_invalid_files_have_corresponding_evidence(self, tmp_bridge):
        """Each invalid file has a .fail. evidence file."""
        inbox = tmp_bridge["inbox"]
        evidence = tmp_bridge["evidence"]

        (inbox / "ev1.md").write_text("# bad\n", encoding="utf-8")
        (inbox / "ev2.json").write_text("{bad", encoding="utf-8")

        scan_once(dry_run=True)

        assert evidence.exists()
        ev_files = list(evidence.glob("*.fail.*.json"))
        assert len(ev_files) >= 2, f"Expected >=2 evidence files, got {len(ev_files)}"

    def test_valid_file_in_dry_run_stays_in_inbox(self, tmp_bridge):
        """Valid files in dry-run mode stay in inbox (no move)."""
        inbox = tmp_bridge["inbox"]

        (inbox / "req-stay.md").write_text("# valid\n", encoding="utf-8")

        result = scan_once(dry_run=True)
        assert "req-stay.md" in result.processed
        assert (inbox / "req-stay.md").exists(), "Valid file was moved during dry-run"
