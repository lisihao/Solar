"""Tests for context_store.py runtime packet resolution metadata."""
from __future__ import annotations

import json
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from context_store import ContextStore  # noqa: E402


def _task_packet(packet_id: str, expires_at: str = "2099-01-01T00:00:00Z") -> dict:
    return {
        "packet_id": packet_id,
        "packet_type": "task",
        "created_at": "2026-06-18T00:00:00Z",
        "expires_at": expires_at,
        "project_id": "project-a",
        "sprint_id": "sprint-a",
        "node_id": "N1",
        "summary": "Task packet",
        "content": {"goal": "verify context resolution"},
    }


def test_save_load_and_legacy_resolve_ref_remain_compatible(tmp_path):
    cs = ContextStore(tmp_path)
    packet = _task_packet("pkt-1")

    saved_path = cs.save("pkt-1", packet)

    assert Path(saved_path).exists()
    assert cs.load("pkt-1") == packet
    assert cs.resolve_ref({"packet_id": "pkt-1", "path": None}) == packet


def test_detail_resolver_none_ref_reports_failure_without_data(tmp_path):
    result = ContextStore(tmp_path).resolve_ref_detail(None)

    assert result.resolved is False
    assert result.status == "missing"
    assert result.failure_reason == "none_ref"
    assert result.data is None
    assert result.to_dict()["failure_reason"] == "none_ref"


def test_detail_resolver_missing_packet_id_reports_precise_reason(tmp_path):
    result = ContextStore(tmp_path).resolve_ref_detail({"packet_id": "missing-pkt"})

    assert result.resolved is False
    assert result.status == "missing"
    assert result.failure_reason == "missing_packet"
    assert result.packet_id == "missing-pkt"
    assert result.path == str(tmp_path / "missing-pkt.json")
    assert ContextStore(tmp_path).resolve_ref({"packet_id": "missing-pkt"}) is None


def test_detail_resolver_corrupt_path_json_reports_corrupt(tmp_path):
    packet_path = tmp_path / "bad-packet.json"
    packet_path.write_text("{not json", encoding="utf-8")

    result = ContextStore(tmp_path).resolve_ref_detail({"path": str(packet_path)})

    assert result.resolved is False
    assert result.status == "corrupt"
    assert result.failure_reason == "corrupt_json"
    assert result.path_backed is True
    assert result.path == str(packet_path)


def test_detail_resolver_expired_task_packet_reports_expired(tmp_path):
    cs = ContextStore(tmp_path)
    packet = _task_packet("pkt-expired", expires_at="2000-01-01T00:00:00Z")
    cs.save(packet["packet_id"], packet)

    result = cs.resolve_ref_detail({"packet_id": "pkt-expired"}, expected_packet_type="task")

    assert result.resolved is False
    assert result.status == "expired"
    assert result.failure_reason == "expired"
    assert result.packet_id == "pkt-expired"
    assert result.packet_type == "task"
    assert result.expires_at == "2000-01-01T00:00:00Z"
    assert result.packet_hash
    assert result.staleness_warning is True


def test_detail_resolver_wrong_packet_type_reports_wrong_type(tmp_path):
    cs = ContextStore(tmp_path)
    packet = _task_packet("pkt-project")
    packet["packet_type"] = "project"
    packet["expires_at"] = None
    cs.save(packet["packet_id"], packet)

    result = cs.resolve_ref_detail({"packet_id": "pkt-project"}, expected_packet_type="task")

    assert result.resolved is False
    assert result.status == "wrong_type"
    assert result.failure_reason == "wrong_type"
    assert result.packet_id == "pkt-project"
    assert result.packet_type == "project"
    assert result.data == packet


def test_detail_resolver_successful_path_backed_task_resolution(tmp_path):
    cs = ContextStore(tmp_path)
    packet_path = tmp_path / "path-backed.json"
    packet = _task_packet("pkt-path-backed")
    packet_path.write_text(json.dumps(packet), encoding="utf-8")

    result = cs.resolve_ref_detail({"path": str(packet_path)}, expected_packet_type="task")

    assert result.resolved is True
    assert result.status == "resolved"
    assert result.failure_reason is None
    assert result.data == packet
    assert result.packet_id == "pkt-path-backed"
    assert result.path == str(packet_path)
    assert result.packet_type == "task"
    assert result.expires_at == "2099-01-01T00:00:00Z"
    assert result.packet_hash
    assert result.staleness_warning is False
    assert result.path_backed is True


def test_detail_resolver_stale_packet_reports_stale(tmp_path):
    cs = ContextStore(tmp_path)
    packet = _task_packet("pkt-stale")
    packet["context_packet_staleness_warning"] = True
    cs.save(packet["packet_id"], packet)

    result = cs.resolve_ref_detail({"packet_id": "pkt-stale"}, expected_packet_type="task")

    assert result.resolved is False
    assert result.status == "stale"
    assert result.failure_reason == "stale"
    assert result.staleness_warning is True
