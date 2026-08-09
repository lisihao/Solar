from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "lib"
if str(LIB) not in sys.path:
    sys.path.insert(0, str(LIB))

import session_log


def _event(seq: int, key: str) -> dict:
    return {
        "event_id": f"event-{seq}",
        "session_id": "large",
        "seq": seq,
        "ts": "2026-08-09T00:00:00Z",
        "type": "log_message",
        "actor": "test",
        "source": "test",
        "sprint_id": "large",
        "activity_id": None,
        "correlation_id": None,
        "causation_id": None,
        "idempotency_key": key,
        "payload": {"padding": "x" * 256},
    }


def test_append_reads_tail_and_mmap_checks_old_idempotency_key(tmp_path, monkeypatch):
    events = tmp_path / "sessions" / "large" / "events.jsonl"
    events.parent.mkdir(parents=True)
    with events.open("w", encoding="utf-8") as fh:
        for seq in range(1, 5001):
            fh.write(json.dumps(_event(seq, f"key-{seq}")) + "\n")

    loads = 0
    original_loads = session_log.json.loads

    def counting_loads(value, *args, **kwargs):
        nonlocal loads
        loads += 1
        return original_loads(value, *args, **kwargs)

    monkeypatch.setattr(session_log.json, "loads", counting_loads)
    log = session_log.SessionLog("large", harness_dir=str(tmp_path))
    assert log._seq == 5000
    assert loads <= 2

    try:
        log.append("log_message", actor="test", idempotency_key="key-1")
    except session_log.DuplicateEventError:
        pass
    else:
        raise AssertionError("old idempotency key was not detected")
    assert loads <= 4

    log.append("log_message", actor="test", idempotency_key="key-new")
    assert json.loads(events.read_text(encoding="utf-8").splitlines()[-1])["seq"] == 5001
