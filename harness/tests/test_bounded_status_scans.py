from __future__ import annotations

import json
from pathlib import Path

from harness.lib import capability_supply_registry as csr
from harness.lib import graph_redispatch as grd
from harness.lib import orphan_reaper as orp
from harness.lib import scope_arbiter as sa


def _write_status_with_unreadable_history(path: Path, status: str = "active") -> None:
    path.write_text(
        '{\n  "status": ' + json.dumps(status) + ',\n  "history": [\nBROKEN_HISTORY',
        encoding="utf-8",
    )


def test_worker_blocked_probe_reads_only_status_metadata(tmp_path, monkeypatch, capsys):
    sid = "sprint-bounded-capability"
    monkeypatch.setattr(csr, "SPRINTS", tmp_path)
    _write_status_with_unreadable_history(tmp_path / f"{sid}.status.json")
    (tmp_path / f"{sid}.task_dag.state.json").write_text(json.dumps({
        "node_results": {"N1": {"status": "worker_blocked"}},
    }), encoding="utf-8")

    assert csr.cmd_worker_blocked_probe(emit_events=False) == 0
    assert json.loads(capsys.readouterr().out)["worker_blocked"] == 1


def test_scope_and_redispatch_iterators_read_only_status_metadata(tmp_path, monkeypatch):
    sid = "sprint-bounded-iterators"
    _write_status_with_unreadable_history(tmp_path / f"{sid}.status.json")
    graph = tmp_path / f"{sid}.task_graph.json"
    graph.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(sa, "SPRINTS", tmp_path)
    monkeypatch.setattr(grd, "SPRINTS_DIR", tmp_path)

    assert list(sa._iter_nonterminal()) == [(sid, graph)]
    assert list(grd._iter_nonterminal_graphs()) == [(sid, graph)]


def test_orphan_scan_reads_only_status_metadata(tmp_path, monkeypatch):
    sid = "sprint-bounded-orphan"
    _write_status_with_unreadable_history(tmp_path / f"{sid}.status.json")
    graph = tmp_path / f"{sid}.task_graph.json"
    graph.write_text("{}", encoding="utf-8")
    loaded: list[str] = []
    monkeypatch.setattr(orp, "SPRINTS_DIR", tmp_path)
    monkeypatch.setattr(orp, "OPERATOR_RESULTS_DIR", tmp_path / "operator-results")
    monkeypatch.setattr(
        orp._gs,
        "load_graph",
        lambda path: loaded.append(str(path)) or {"nodes": []},
    )

    assert orp.scan_orphans() == []
    assert loaded == [str(graph)]
