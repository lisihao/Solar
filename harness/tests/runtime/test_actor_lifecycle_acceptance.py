from __future__ import annotations

import datetime
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "lib") not in sys.path:
    sys.path.insert(0, str(ROOT / "lib"))

import graph_node_dispatcher as gnd  # noqa: E402
from actor_lease import FINALIZING, READY, RUNNING, STALE, LeaseBroker  # noqa: E402


def _old_heartbeat() -> str:
    return (
        datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=30)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")


def test_actor_lifecycle_acceptance_conflict_stale_closeout_and_fallback(tmp_path, monkeypatch):
    broker = LeaseBroker(tmp_path / "actor-leases")

    first = broker.acquire(
        "actor-accept",
        "dispatch-1",
        "sprint-accept",
        "N1",
        heartbeat_timeout_sec=5,
        evidence_path=str(tmp_path / "dispatch-1.evidence.json"),
    )
    assert first is not None
    assert first.lease_id

    conflict = broker.acquire("actor-accept", "dispatch-2", "sprint-accept", "N2")
    assert conflict is None

    first.last_heartbeat_at = _old_heartbeat()
    broker._atomic_write(broker._lease_path("actor-accept"), first.to_dict())
    assert broker.reap("actor-accept") == ["actor-accept"]
    assert broker.get("actor-accept").state == STALE

    released = broker.release("actor-accept", reason="stale_release")
    assert released is not None
    assert released.state == READY
    assert released.transition_reason == "stale_release"

    finalizing = broker.acquire(
        "actor-accept",
        "dispatch-3",
        "sprint-accept",
        "N3",
        evidence_path=str(tmp_path / "dispatch-3.closeout.json"),
    )
    assert finalizing is not None
    assert broker.transition("actor-accept", RUNNING, reason="worker_started").state == RUNNING
    assert broker.transition("actor-accept", FINALIZING, reason="closeout_started").state == FINALIZING
    closed = broker.release("actor-accept", reason="closeout_flushed")
    assert closed is not None
    assert closed.state == READY
    assert closed.evidence_path.endswith("dispatch-3.closeout.json")

    monkeypatch.setattr(gnd, "ActorLeaseBroker", lambda: broker)
    monkeypatch.setattr(gnd, "read_lease", lambda _pane: None)
    monkeypatch.setattr(
        gnd,
        "acquire_lease",
        lambda pane, sid, dispatch_id, ttl: {
            "acquired": True,
            "pane": pane,
            "dispatch_id": dispatch_id,
        },
    )

    occupied = broker.acquire("actor-accept", "dispatch-held", "sprint-accept", "N4")
    assert occupied is not None
    fallback = gnd._ensure_lease(
        "solar-harness:0.2",
        "sprint-accept",
        "dispatch-fallback",
        900,
        False,
        actor_id="actor-accept",
        node_id="N5",
        evidence_path=str(tmp_path / "fallback.dispatch.md"),
    )
    assert fallback["acquired"] is True
    assert fallback["actor_first"] is False
    assert fallback["compat_fallback"] is True
    assert fallback["fallback_reason"] == "actor_lease_unavailable"
    assert fallback["fallback_to_pane"] == "solar-harness:0.2"
