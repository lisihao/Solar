import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lib"))

import graph_node_dispatcher as gnd  # noqa: E402


def test_dispatch_ledger_lookup_streams_once_and_reuses_compact_index(tmp_path, monkeypatch):
    ledger = tmp_path / "dispatch-ledger.jsonl"
    instruction = tmp_path / "sprint-test.N1-dispatch.md"
    rows = [
        {"kind": "attempted", "sid": f"sprint-other-{index}", "payload": "x" * 1024}
        for index in range(1000)
    ]
    rows.append({
        "kind": "intent_injected",
        "sid": "sprint-test",
        "pane": "operator-pool:builder",
        "dispatch_id": "dispatch-1",
        "instruction_file": str(instruction),
        "payload": "y" * 1024,
    })
    ledger.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    monkeypatch.setattr(gnd, "DISPATCH_LEDGER", ledger)
    monkeypatch.setattr(gnd, "_DISPATCH_LEDGER_INDEX_SIGNATURE", None)
    monkeypatch.setattr(gnd, "_DISPATCH_LEDGER_INDEX", {})
    original_read_text = Path.read_text

    def guarded_read_text(path, *args, **kwargs):
        if path == ledger:
            raise AssertionError("dispatch ledger must be streamed")
        return original_read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", guarded_read_text)

    first = gnd._ledger_dispatch_for("sprint-test", instruction)
    second = gnd._ledger_dispatch_for("sprint-test", instruction)

    assert first == second
    assert first["dispatch_id"] == "dispatch-1"
    assert first["pane"] == "operator-pool:builder"
    assert set(first) == {"sid", "kind", "pane", "dispatch_id", "instruction_file"}


def test_dispatch_ledger_lookup_supports_nested_legacy_payload(tmp_path, monkeypatch):
    ledger = tmp_path / "dispatch-ledger.jsonl"
    instruction = tmp_path / "sprint-legacy.N1-dispatch.md"
    ledger.write_text(json.dumps({
        "kind": "intent_injected",
        "sid": "sprint-legacy",
        "pane": "solar-harness:0.2",
        "dispatch_id": "dispatch-legacy",
        "_raw": json.dumps({"instruction_file": str(instruction)}) + "}",
    }) + "\n", encoding="utf-8")
    monkeypatch.setattr(gnd, "DISPATCH_LEDGER", ledger)
    monkeypatch.setattr(gnd, "_DISPATCH_LEDGER_INDEX_SIGNATURE", None)
    monkeypatch.setattr(gnd, "_DISPATCH_LEDGER_INDEX", {})

    found = gnd._ledger_dispatch_for("sprint-legacy", instruction)

    assert found["dispatch_id"] == "dispatch-legacy"


def test_dispatch_ledger_miss_does_not_rescan_ledger(tmp_path, monkeypatch):
    ledger = tmp_path / "dispatch-ledger.jsonl"
    ledger.write_text(json.dumps({
        "kind": "intent_injected",
        "sid": "sprint-existing",
        "instruction_file": "/tmp/existing-dispatch.md",
    }) + "\n", encoding="utf-8")
    monkeypatch.setattr(gnd, "DISPATCH_LEDGER", ledger)
    monkeypatch.setattr(gnd, "_DISPATCH_LEDGER_INDEX_SIGNATURE", None)
    monkeypatch.setattr(gnd, "_DISPATCH_LEDGER_INDEX", {})
    original_open = Path.open
    open_count = 0

    def counted_open(path, *args, **kwargs):
        nonlocal open_count
        if path == ledger:
            open_count += 1
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", counted_open)

    assert gnd._ledger_dispatch_for("sprint-missing", tmp_path / "missing.md") == {}
    assert gnd._ledger_dispatch_for("sprint-other", tmp_path / "other.md") == {}
    assert open_count == 1
