from __future__ import annotations

import sys
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parents[1]
LIB_DIR = HARNESS_DIR / "lib"
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))

import graph_node_dispatcher as gnd  # noqa: E402
from actor_lease import LeaseBroker  # noqa: E402


def test_actor_first_lease_blocks_second_non_ready_acquire_and_falls_back_to_pane(tmp_path, monkeypatch):
    lease_dir = tmp_path / "actor-leases"
    broker = LeaseBroker(lease_dir)
    pane_acquires: list[tuple[str, str, str, int]] = []

    monkeypatch.setattr(gnd, "ActorLeaseBroker", lambda: broker)
    monkeypatch.setattr(gnd, "read_lease", lambda _pane: None)

    def fake_acquire_lease(pane: str, sid: str, dispatch_id: str, ttl: int):
        pane_acquires.append((pane, sid, dispatch_id, ttl))
        return {"acquired": True, "pane": pane, "dispatch_id": dispatch_id}

    monkeypatch.setattr(gnd, "acquire_lease", fake_acquire_lease)

    first = gnd._ensure_lease(
        "solar-harness:0.2",
        "sprint-a",
        "dispatch-1",
        900,
        False,
        actor_id="actor-a",
        node_id="N1",
    )
    second = gnd._ensure_lease(
        "solar-harness:0.3",
        "sprint-a",
        "dispatch-2",
        900,
        False,
        actor_id="actor-a",
        node_id="N2",
    )

    assert first["acquired"] is True
    assert first["actor_first"] is True
    assert first["actor_id"] == "actor-a"
    assert first["lease_id"]
    assert first["task_id"] == "dispatch-1"
    assert first["sprint_id"] == "sprint-a"
    assert first["node_id"] == "N1"

    assert second["acquired"] is True
    assert second["actor_first"] is False
    assert second["compat_fallback"] is True
    assert second["fallback_to_pane"] == "solar-harness:0.3"
    assert second["fallback_reason"] == "actor_lease_unavailable"
    assert len(pane_acquires) == 1

    assert broker.get("actor-a").task_id == "dispatch-1"
    assert gnd._release_actor_lease("actor-a") is True
    retry = gnd._ensure_lease(
        "solar-harness:0.3",
        "sprint-a",
        "dispatch-2",
        900,
        False,
        actor_id="actor-a",
        node_id="N2",
    )
    assert retry["actor_first"] is True
    assert retry["task_id"] == "dispatch-2"


def test_dispatch_queue_item_records_actor_lease_projection(tmp_path, monkeypatch):
    broker = LeaseBroker(tmp_path / "actor-leases")
    projections: list[dict] = []
    pane_acquires: list[tuple] = []

    monkeypatch.setattr(gnd, "ActorLeaseBroker", lambda: broker)
    monkeypatch.setattr(gnd, "SPRINTS_DIR", tmp_path)
    monkeypatch.setattr(gnd, "DISPATCH_LEDGER", tmp_path / "dispatch-ledger.jsonl")
    monkeypatch.setattr(gnd, "AUTOPILOT_STATE", tmp_path / "autopilot-state.json")
    monkeypatch.setattr(gnd, "_append_autopilot_routing_record", lambda rec: projections.append(rec))
    monkeypatch.setattr(gnd, "_graph_node_runtime_state", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(gnd, "_prepare_human_search_handoff", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(gnd, "check_node_capability_gate", lambda *_args, **_kwargs: {"ok": True})
    monkeypatch.setattr(gnd, "_pane_exists", lambda _pane: True)
    monkeypatch.setattr(gnd, "_assigned_pane_unavailable_reason", lambda _pane: "")
    monkeypatch.setattr(gnd, "_send_to_pane", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(gnd, "_write_submit_ack", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(gnd, "_inject_dispatch_context", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(gnd, "_sync_dispatch_package", lambda **_kwargs: (str(tmp_path / "dispatch.json"), "digest"))
    monkeypatch.setattr(gnd, "acquire_lease", lambda *args, **_kwargs: pane_acquires.append(args) or {"acquired": True})

    result = gnd.dispatch_queue_item(
        {
            "payload": {
                "sprint_id": "sprint-a",
                "node": {"id": "N1", "required_capabilities": ["workflow.planning"]},
                "assignment": {
                    "pane": "solar-harness:0.2",
                    "role": "builder",
                    "selected_actor": "actor-a",
                },
                "graph": str(tmp_path / "sprint-a.task_graph.json"),
                "dispatch_id": "dispatch-1",
            },
            "intent": "graph_node|node_id=N1",
            "priority": 80,
        },
        dry_run=False,
    )

    assert result["ok"] is True
    assert result["lease"]["actor_first"] is True
    assert result["lease"]["actor_id"] == "actor-a"
    assert result["lease"]["lease_id"]
    assert pane_acquires == []
    assert projections
    projection = projections[-1]
    assert projection["actor_id"] == "actor-a"
    assert projection["lease_id"] == result["lease"]["lease_id"]
    assert projection["task_id"] == "dispatch-1"
    assert projection["sprint_id"] == "sprint-a"
    assert projection["node_id"] == "N1"
    assert projection["compat_fallback"] is False
