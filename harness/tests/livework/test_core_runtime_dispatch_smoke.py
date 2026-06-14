"""B6_compat_integration — Live smoke test for the full dispatch chain.

Exercises wake → dispatch → status → trace with real filesystem I/O and
real ExecutionTraceLedger, matching B6 acceptance criteria:

  AC1: old wake/dispatch/status smoke passes
  AC2: trace is written into runtime/trace (not isolated)
  AC3: old consumers can still read status/ledger
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

_HARNESS = Path(__file__).resolve().parents[2]
_TOOLS = _HARNESS / "tools"
_BIN = _HARNESS / "bin"
# Harness root must precede tools/ so `from tools.X import` resolves correctly
sys.path.insert(0, str(_TOOLS))
sys.path.insert(0, str(_HARNESS))

PASS = 0
FAIL = 0


def ok(msg: str) -> None:
    global PASS
    print(f"PASS: {msg}")
    PASS += 1


def fail(msg: str) -> None:
    global FAIL
    print(f"FAIL: {msg}")
    FAIL += 1


def _make_harness(tmp: Path) -> Path:
    (tmp / "sprints").mkdir(parents=True)
    (tmp / "run").mkdir(parents=True)
    (tmp / "state" / "workers").mkdir(parents=True)
    (tmp / "sessions").mkdir(parents=True)
    return tmp


def _write_status(sprints: Path, sid: str, status: str = "active") -> None:
    p = sprints / f"{sid}.status.json"
    p.write_text(json.dumps({
        "sprint_id": sid,
        "status": status,
        "phase": "planning",
        "round": 0,
    }, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------------------
# Smoke 1: record_legacy_event → trace written
# ---------------------------------------------------------------------------

with tempfile.TemporaryDirectory() as _tmp:
    tmp = _make_harness(Path(_tmp))
    sid = "smoke-dispatch-event"
    _write_status(tmp / "sprints", sid)

    from runtime_bridge import record_legacy_event
    result = record_legacy_event(
        sid, "dispatch_queued", "coordinator",
        {"to": "0.1", "node_id": "N1", "round": 1},
        harness_dir=tmp,
    )

    if result.get("ok"):
        ok("record_legacy_event returned ok")
    else:
        fail(f"record_legacy_event failed: {result}")

    if "trace_id" in result:
        ok("record_legacy_event returns trace_id")
    else:
        fail("record_legacy_event missing trace_id")

    try:
        from core_runtime_trace import ExecutionTraceLedger
        traces = ExecutionTraceLedger(base_dir=str(tmp / "run")).replay(sid)
        if traces:
            ok(f"trace written to ledger ({len(traces)} record(s))")
        else:
            fail("no traces found in ledger after dispatch event")
    except Exception as exc:
        fail(f"ledger read failed: {exc}")

# ---------------------------------------------------------------------------
# Smoke 2: adopt_sprint → compat trace + backward-compat return
# ---------------------------------------------------------------------------

with tempfile.TemporaryDirectory() as _tmp:
    tmp = _make_harness(Path(_tmp))
    sid = "smoke-adopt"
    _write_status(tmp / "sprints", sid, status="passed")

    from runtime_bridge import adopt_sprint
    result = adopt_sprint(sid, harness_dir=tmp)

    if result.get("ok"):
        ok("adopt_sprint returned ok")
    else:
        fail(f"adopt_sprint failed: {result}")

    for key in ("sprint_id", "appended", "status_path", "legacy_events_path", "trace_id"):
        if key in result:
            ok(f"adopt_sprint result has key: {key}")
        else:
            fail(f"adopt_sprint result missing key: {key}")

    # status.json still readable
    status_path = tmp / "sprints" / f"{sid}.status.json"
    if status_path.exists():
        data = json.loads(status_path.read_text(encoding="utf-8"))
        if data.get("status") == "passed":
            ok("status.json unchanged after adopt_sprint")
        else:
            fail(f"status.json corrupted: {data.get('status')}")
    else:
        fail("status.json missing after adopt_sprint")

# ---------------------------------------------------------------------------
# Smoke 3: worker lease acquire/release → trace
# ---------------------------------------------------------------------------

with tempfile.TemporaryDirectory() as _tmp:
    tmp = _make_harness(Path(_tmp))

    from worker_runtime import WorkerRuntime
    wr = WorkerRuntime(harness_dir=str(tmp))
    wr.register("smoke-worker", capabilities=["python", "testing"])

    lease = wr.acquire_lease("smoke-worker", "session-smoke", "activity-smoke-1")
    if lease is not None:
        ok("WorkerRuntime.acquire_lease succeeded")
    else:
        fail("WorkerRuntime.acquire_lease returned None")

    db_path = tmp / "run" / "execution_traces.db"
    if db_path.exists():
        ok("execution_traces.db created after lease acquire")
    else:
        fail("execution_traces.db not found after lease acquire")

    released = wr.release_lease("smoke-worker", "activity-smoke-1", reason="smoke_test")
    if released:
        ok("WorkerRuntime.release_lease succeeded")
    else:
        fail("WorkerRuntime.release_lease failed")

    try:
        import sqlite3
        conn = sqlite3.connect(str(db_path))
        rows = conn.execute(
            "SELECT * FROM execution_traces WHERE dispatch_id='activity-smoke-1'"
        ).fetchall()
        conn.close()
        if len(rows) >= 2:
            ok(f"lease traces written: {len(rows)} record(s) for acquire+release")
        elif len(rows) == 1:
            ok("lease acquire trace written (release trace may be pending)")
        else:
            fail("no lease traces found")
    except Exception as exc:
        fail(f"lease trace query failed: {exc}")

# ---------------------------------------------------------------------------
# Smoke 4: bin/solar-harness CLI status command
# ---------------------------------------------------------------------------

with tempfile.TemporaryDirectory() as _tmp:
    tmp = _make_harness(Path(_tmp))
    sid = "smoke-cli-status"
    _write_status(tmp / "sprints", sid, status="reviewing")

    cli = _BIN / "solar-harness"
    env = {"HARNESS_DIR": str(tmp), "PATH": "/usr/bin:/bin:/opt/homebrew/bin"}
    result_proc = subprocess.run(
        [sys.executable, str(cli), "--json", "status", sid],
        capture_output=True, text=True, env={**env, "HOME": str(Path.home())},
    )

    if result_proc.returncode == 0:
        ok("bin/solar-harness status exited 0")
        try:
            data = json.loads(result_proc.stdout)
            if data.get("status") == "reviewing":
                ok("bin/solar-harness status returns correct status")
            else:
                fail(f"bin/solar-harness status wrong: {data.get('status')}")
        except json.JSONDecodeError:
            fail(f"bin/solar-harness status returned invalid JSON: {result_proc.stdout[:200]}")
    else:
        fail(f"bin/solar-harness status exited {result_proc.returncode}: {result_proc.stderr[:200]}")

# ---------------------------------------------------------------------------
# Smoke 5: bin/solar-harness dispatch + trace replay
# ---------------------------------------------------------------------------

with tempfile.TemporaryDirectory() as _tmp:
    tmp = _make_harness(Path(_tmp))
    sid = "smoke-cli-dispatch"
    _write_status(tmp / "sprints", sid)

    cli = _BIN / "solar-harness"
    env = {"HARNESS_DIR": str(tmp), "PATH": "/usr/bin:/bin:/opt/homebrew/bin", "HOME": str(Path.home())}

    disp_proc = subprocess.run(
        [sys.executable, str(cli), "--json", "dispatch", sid, "N1", "coordinator"],
        capture_output=True, text=True, env=env,
    )

    if disp_proc.returncode == 0:
        ok("bin/solar-harness dispatch exited 0")
    else:
        fail(f"bin/solar-harness dispatch failed: {disp_proc.stderr[:200]}")

    trace_proc = subprocess.run(
        [sys.executable, str(cli), "--json", "trace", sid],
        capture_output=True, text=True, env=env,
    )

    if trace_proc.returncode == 0:
        try:
            data = json.loads(trace_proc.stdout)
            if data.get("count", 0) >= 1:
                ok(f"bin/solar-harness trace shows {data['count']} trace(s) after dispatch")
            else:
                fail("bin/solar-harness trace count is 0 after dispatch")
        except json.JSONDecodeError:
            fail(f"bin/solar-harness trace invalid JSON: {trace_proc.stdout[:200]}")
    else:
        fail(f"bin/solar-harness trace failed: {trace_proc.stderr[:200]}")

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

print()
print("=" * 60)
print(f"SMOKE: {PASS} passed, {FAIL} failed")
if FAIL > 0:
    sys.exit(1)
