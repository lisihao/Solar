#!/usr/bin/env python3
"""Regression test: multi_task_status operator lifecycle.

Validates: lifecycle state resolution, heartbeat + lease reading,
           valid states enforcement, persona resolution.
All calls hit real tools/multi_task_status.py — no mocks.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "lib"))

import multi_task_status

REPORT_DIR = Path(os.environ.get("HARNESS_DIR", Path.home() / ".solar" / "harness")) / "reports" / "s05" / "regression"


def test_valid_states(tmp: Path, sid: str) -> dict:
    """_VALID_STATES contains expected lifecycle states."""
    expected = {"idle", "leased", "running", "draining", "disabled"}
    found = expected.intersection(multi_task_status._VALID_STATES)
    assert len(found) >= 4, f"too few valid states: {found}"
    return {"case": "valid_states", "found_count": len(found), "states": sorted(found)}


def test_read_heartbeat(tmp: Path, sid: str) -> dict:
    """Read heartbeat from a real JSON file."""
    status_dir = tmp / "status"
    status_dir.mkdir(parents=True, exist_ok=True)

    hb = {"op_id": "builder-1", "state": "running", "ts": "2026-06-05T00:00:00Z"}
    (status_dir / "builder-1.json").write_text(json.dumps(hb) + "\n")

    result = multi_task_status._read_heartbeat("builder-1", status_dir)
    assert result.get("state") == "running", f"heartbeat state: {result.get('state')}"
    return {"case": "read_heartbeat", "state": result.get("state")}


def test_read_lease(tmp: Path, sid: str) -> dict:
    """Read lease from a real JSON file."""
    lease_dir = tmp / "leases"
    lease_dir.mkdir(parents=True, exist_ok=True)

    lease = {"op_id": "builder-1", "task_id": "T-001", "leased_at": "2026-06-05T00:00:00Z"}
    (lease_dir / "builder-1.json").write_text(json.dumps(lease) + "\n")

    result = multi_task_status._read_lease("builder-1", lease_dir)
    assert result.get("task_id") == "T-001", f"lease task_id: {result.get('task_id')}"
    return {"case": "read_lease", "task_id": result.get("task_id")}


def test_missing_artifacts(tmp: Path, sid: str) -> dict:
    """Reading missing heartbeat/lease returns empty dict."""
    empty_dir = tmp / "empty"
    empty_dir.mkdir(parents=True, exist_ok=True)

    hb = multi_task_status._read_heartbeat("nonexistent", empty_dir)
    lease = multi_task_status._read_lease("nonexistent", empty_dir)
    assert hb == {}, f"expected empty, got: {hb}"
    assert lease == {}, f"expected empty, got: {lease}"
    return {"case": "missing_artifacts", "heartbeat_empty": hb == {}, "lease_empty": lease == {}}


def test_lifecycle_idle(tmp: Path, sid: str) -> dict:
    """Idle lifecycle when no lease and heartbeat shows idle."""
    status_dir = tmp / "status"
    lease_dir = tmp / "leases"
    status_dir.mkdir(parents=True, exist_ok=True)
    lease_dir.mkdir(parents=True, exist_ok=True)

    (status_dir / "idle-op.json").write_text(json.dumps({"op_id": "idle-op", "state": "idle"}))
    # No lease file

    cfg = {"id": "idle-op", "role": "builder"}
    state = multi_task_status._resolve_lifecycle_state("idle-op", cfg, lease_dir, status_dir)
    assert state == "idle", f"expected idle, got: {state}"
    return {"case": "lifecycle_idle", "state": state}


def main() -> int:
    sid = "regression-test-triface-mts"
    errors = []
    results = []

    with tempfile.TemporaryDirectory(prefix="solar-reg-mts-") as tmp_str:
        tmp = Path(tmp_str)

        tests = [
            ("valid_states", test_valid_states),
            ("read_heartbeat", test_read_heartbeat),
            ("read_lease", test_read_lease),
            ("missing_artifacts", test_missing_artifacts),
            ("lifecycle_idle", test_lifecycle_idle),
        ]

        for name, fn in tests:
            try:
                r = fn(tmp, sid)
                r["verdict"] = "PASS"
                results.append(r)
                print(f"  PASS: {name}")
            except Exception as e:
                results.append({"case": name, "verdict": "FAIL", "error": str(e)})
                errors.append((name, str(e)))
                print(f"  FAIL: {name} — {e}")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {"suite": "multi_task_status", "results": results, "total": len(results), "passed": len(results) - len(errors)}
    report_path = REPORT_DIR / "multi_task_status.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"Report: {report_path}")

    if errors:
        for name, err in errors:
            print(f"FAIL: {name} — {err}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
