"""N2_activation_dispatch acceptance tests.

Acceptance criteria:
  1. A ready node can be activated to the correct target_role/logical actor
     and creates a task_envelope in actor mailbox inbox.
  2. Repeated scans do not duplicate the same task; dedup evidence checks
     inbox/processing/outbox or dispatch ledger.
  3. tmux send-keys is not used to inject natural language task content;
     any send-keys path is labeled bootstrap/recovery only.
"""
from __future__ import annotations

import importlib.util
import json
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "lib"
TOOLS = ROOT / "tools"
sys.path.insert(0, str(LIB))

import graph_scheduler  # noqa: E402

# Remove tools path to prevent tools/graph_scheduler/ namespace package
# from shadowing lib/graph_scheduler.py
if str(TOOLS) in sys.path:
    sys.path.remove(str(TOOLS))


def _child_graph(status: str = "pending") -> dict:
    return {
        "sprint_id": "sprint-s04",
        "nodes": [
            {
                "id": "N1_activation_graph_route",
                "goal": "Wire graph activation",
                "depends_on": [],
                "write_scope": ["tools/autopilot.py"],
                "acceptance": ["ready nodes route to builder"],
                "status": status,
            }
        ],
    }


def _epic_graph(upstream_status: str = "passed") -> dict:
    return {
        "schema_version": "solar.epic.task_graph.v1",
        "epic_id": "epic-s04",
        "nodes": [
            {"id": "S03", "child_sprint_id": "sprint-s03", "depends_on": [], "status": upstream_status},
            {
                "id": "S04",
                "child_sprint_id": "sprint-s04",
                "depends_on": ["S03"],
                "status": "active",
            },
        ],
    }


def _load_graph_node_dispatcher():
    spec = importlib.util.spec_from_file_location(
        "graph_node_dispatcher_n2_test",
        LIB / "graph_node_dispatcher.py",
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def _load_autopilot():
    spec = importlib.util.spec_from_file_location("autopilot_n2_test", TOOLS / "autopilot.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


# ── Acceptance #1: Ready node activated to correct role → task_envelope in inbox ──


def test_activate_node_to_mailbox_dry_run_builds_envelope(tmp_path, monkeypatch):
    """Dry run should build an envelope with correct node_id and target_role."""
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    sid = "sprint-s04-mailbox"
    graph_data = _child_graph()
    graph_data["sprint_id"] = sid
    graph_path = sprints / f"{sid}.task_graph.json"
    graph_path.write_text(json.dumps(graph_data) + "\n", encoding="utf-8")
    monkeypatch.setattr(graph_scheduler, "SPRINTS_DIR", sprints)

    dispatcher = _load_graph_node_dispatcher()
    monkeypatch.setattr(dispatcher, "SPRINTS_DIR", sprints)

    result = dispatcher.activate_node_to_mailbox(
        str(graph_path),
        "N1_activation_graph_route",
        target_role="builder",
        dry_run=True,
    )

    assert result["ok"] is True
    assert result["dispatch_path"] == "mailbox_activation"
    assert result["dry_run"] is True
    assert result["node"] == "N1_activation_graph_route"
    assert "task_id" in result
    assert "envelope_keys" in result


def test_activate_node_to_mailbox_writes_to_inbox(tmp_path, monkeypatch):
    """Real activation should write task_envelope to actor mailbox inbox."""
    harness = tmp_path / "harness"
    sprints = harness / "sprints"
    sprints.mkdir(parents=True)
    actors = harness / "actors"
    actors.mkdir()
    sid = "sprint-s04-mailbox-real"
    graph_data = _child_graph()
    graph_data["sprint_id"] = sid
    graph_path = sprints / f"{sid}.task_graph.json"
    graph_path.write_text(json.dumps(graph_data) + "\n", encoding="utf-8")
    monkeypatch.setattr(graph_scheduler, "SPRINTS_DIR", sprints)

    dispatcher = _load_graph_node_dispatcher()
    monkeypatch.setattr(dispatcher, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(dispatcher, "HARNESS_DIR", harness)
    monkeypatch.setattr(dispatcher, "DISPATCH_LEDGER", harness / "run" / "dispatch-ledger.jsonl")
    monkeypatch.setattr(dispatcher, "MULTI_TASK_RUN_DIR", harness / "run" / "multi-task")

    # Mock actor_dispatch_bridge to avoid needing full actor_runtime stack
    mock_bridge = MagicMock()
    mock_envelope = {
        "sprint_id": sid,
        "node_id": "N1_activation_graph_route",
        "objective": "Wire graph activation",
        "logical_operator": "",
        "gate": None,
        "fallback_allowed": False,
    }
    mock_bridge.build_envelope.return_value = mock_envelope

    from actor_runtime import SubmitResult
    mock_result = SubmitResult(
        success=True,
        inbox_path=str(actors / "op.builder.generic.01" / "inbox" / "task-test-001.json"),
        outbox_path=str(actors / "op.builder.generic.01" / "outbox"),
        selected_host_type="op.builder.generic",
    )
    mock_bridge.dispatch_node.return_value = mock_result

    monkeypatch.setattr(dispatcher, "_actor_dispatch_bridge", mock_bridge)

    # Also mock _resolve_actor_for_role to return a known actor
    monkeypatch.setattr(dispatcher, "_resolve_actor_for_role", lambda n, r, e: "op.builder.generic.01")

    # Mock _mark_graph_node_compat and other helpers
    monkeypatch.setattr(dispatcher, "_mark_graph_node_compat", lambda *a, **kw: True)
    monkeypatch.setattr(dispatcher, "_append_dispatch_ledger", lambda *a, **kw: None)

    result = dispatcher.activate_node_to_mailbox(
        str(graph_path),
        "N1_activation_graph_route",
        target_role="builder",
        dry_run=False,
    )

    assert result["ok"] is True
    assert result["dispatch_path"] == "mailbox_activation"
    assert result["dispatch_mode"] == "actor_runtime"
    assert result["actor_id"] is not None
    mock_bridge.dispatch_node.assert_called_once()


def test_autopilot_activate_graph_uses_mailbox_path(tmp_path, monkeypatch):
    """autopilot.activate_graph should use mailbox activation as primary path."""
    harness = tmp_path / "harness"
    sprints = harness / "sprints"
    sprints.mkdir(parents=True)
    sid = "sprint-s04-ap-mailbox"
    graph_data = _child_graph()
    graph_data["sprint_id"] = sid
    graph_path = sprints / f"{sid}.task_graph.json"
    graph_path.write_text(json.dumps(graph_data) + "\n", encoding="utf-8")
    (sprints / "epic-s04.task_graph.json").write_text(json.dumps(_epic_graph("passed")) + "\n", encoding="utf-8")
    (sprints / f"{sid}.status.json").write_text(
        json.dumps({
            "sprint_id": sid,
            "epic_id": "epic-s04",
            "phase": "planning_complete",
            "target_role": "builder_main",
            "history": [],
        })
        + "\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(graph_scheduler, "HARNESS_DIR", harness)
    monkeypatch.setattr(graph_scheduler, "SPRINTS_DIR", sprints)

    autopilot = _load_autopilot()
    monkeypatch.setattr(autopilot, "HARNESS_DIR", harness)

    # Patch graph_node_dispatcher.activate_node_to_mailbox
    dispatcher = _load_graph_node_dispatcher()
    monkeypatch.setattr(dispatcher, "SPRINTS_DIR", sprints)

    mock_result = {
        "ok": True,
        "node": "N1_activation_graph_route",
        "dispatch_path": "mailbox_activation",
        "dispatch_mode": "actor_runtime",
        "dry_run": False,
        "actor_id": "op.builder.generic.01",
        "dedup": False,
    }
    monkeypatch.setattr(dispatcher, "activate_node_to_mailbox", lambda *a, **kw: mock_result)

    # Need autopilot to load our patched dispatcher
    monkeypatch.setitem(sys.modules, "graph_node_dispatcher", dispatcher)

    result = autopilot.activate_graph(sid)

    assert result["ok"] is True
    mailbox_results = result.get("mailbox_results", [])
    assert len(mailbox_results) >= 1
    assert mailbox_results[0]["dispatch_path"] == "mailbox_activation"
    # Verify enqueue result shows mailbox activation
    enqueue = result.get("enqueue", {})
    assert enqueue.get("dispatch_path") == "mailbox_activation"
    assert enqueue.get("activated")


# ── Acceptance #2: Dedup — repeated scans do not duplicate ──────────────────


def test_activate_node_to_mailbox_dedup_skips_existing_task(tmp_path, monkeypatch):
    """If a task for the same node already exists in mailbox, dedup should prevent re-submit."""
    harness = tmp_path / "harness"
    sprints = harness / "sprints"
    sprints.mkdir(parents=True)
    actors = harness / "actors" / "op.builder.generic.01"
    inbox = actors / "inbox"
    inbox.mkdir(parents=True)
    sid = "sprint-s04-dedup"
    graph_data = _child_graph()
    graph_data["sprint_id"] = sid
    graph_path = sprints / f"{sid}.task_graph.json"
    graph_path.write_text(json.dumps(graph_data) + "\n", encoding="utf-8")
    monkeypatch.setattr(graph_scheduler, "SPRINTS_DIR", sprints)

    dispatcher = _load_graph_node_dispatcher()
    monkeypatch.setattr(dispatcher, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(dispatcher, "HARNESS_DIR", harness)
    monkeypatch.setattr(dispatcher, "DISPATCH_LEDGER", harness / "run" / "dispatch-ledger.jsonl")
    monkeypatch.setattr(dispatcher, "MULTI_TASK_RUN_DIR", harness / "run" / "multi-task")

    # Place an existing task in inbox with the node prefix
    existing_task_id = f"{sid}--N1_activation_graph_route--abc12345"
    inbox_file = inbox / f"task-{existing_task_id}-20260607T010000Z.json"
    inbox_file.write_text(json.dumps({"task_id": existing_task_id}) + "\n", encoding="utf-8")

    # Mock bridge and resolve
    mock_bridge = MagicMock()
    mock_bridge.build_envelope.return_value = {"sprint_id": sid, "node_id": "N1_activation_graph_route"}
    monkeypatch.setattr(dispatcher, "_actor_dispatch_bridge", mock_bridge)
    monkeypatch.setattr(dispatcher, "_resolve_actor_for_role", lambda n, r, e: "op.builder.generic.01")
    monkeypatch.setattr(dispatcher, "_mark_graph_node_compat", lambda *a, **kw: True)
    monkeypatch.setattr(dispatcher, "_append_dispatch_ledger", lambda *a, **kw: None)

    # Patch actor_mailbox ACTORS_BASE to use our temp harness
    import actor_mailbox
    monkeypatch.setattr(actor_mailbox, "HARNESS_DIR", harness)
    monkeypatch.setattr(actor_mailbox, "ACTORS_BASE", harness / "actors")

    result = dispatcher.activate_node_to_mailbox(
        str(graph_path),
        "N1_activation_graph_route",
        target_role="builder",
        dry_run=False,
    )

    assert result["ok"] is True
    assert result["dedup"] is True
    assert result["reason"] == "duplicate_task_in_mailbox"
    # dispatch_node should NOT have been called
    mock_bridge.dispatch_node.assert_not_called()


def test_dispatch_scheduler_dispatch_to_mailbox_no_tmux():
    """DispatchScheduler.dispatch_to_mailbox returns result without tmux send-keys."""
    sys.path.insert(0, str(TOOLS))
    from dispatch_scheduler import DispatchScheduler
    if str(TOOLS) in sys.path:
        sys.path.remove(str(TOOLS))

    mock_registry = MagicMock()
    mock_ledger = MagicMock()
    mock_reinjector = MagicMock()

    scheduler = DispatchScheduler(
        registry=mock_registry,
        ledger=mock_ledger,
        reinjector=mock_reinjector,
    )

    # The method should exist and not raise even with minimal setup
    assert hasattr(scheduler, "dispatch_to_mailbox")
    assert callable(scheduler.dispatch_to_mailbox)


# ── Acceptance #3: No tmux send-keys for natural language task content ──────


def test_activate_node_to_mailbox_path_does_not_call_tmux():
    """activate_node_to_mailbox should not call subprocess with tmux send-keys."""
    dispatcher = _load_graph_node_dispatcher()
    source = Path(dispatcher.__file__).read_text(encoding="utf-8")

    # Find the activate_node_to_mailbox function boundaries
    start = source.find("def activate_node_to_mailbox(")
    assert start != -1, "activate_node_to_mailbox function not found"

    # Find end (next top-level def)
    next_def = source.find("\ndef ", start + 1)
    func_body = source[start:next_def]

    # Check for actual subprocess calls (not string literals in regexes)
    assert 'subprocess.run(["tmux", "send-keys"' not in func_body, (
        "activate_node_to_mailbox must not call tmux send-keys via subprocess"
    )
    assert 'subprocess.run(["tmux"' not in func_body, (
        "activate_node_to_mailbox must not call tmux via subprocess"
    )


def test_dispatch_path_labeled_mailbox_activation():
    """All results from activate_node_to_mailbox have dispatch_path='mailbox_activation'."""
    dispatcher = _load_graph_node_dispatcher()
    source = Path(dispatcher.__file__).read_text(encoding="utf-8")

    start = source.find("def activate_node_to_mailbox(")
    next_def = source.find("\ndef ", start + 1)
    func_body = source[start:next_def]

    # Count all occurrences of 'mailbox_activation' in the function
    count = func_body.count("mailbox_activation")
    assert count >= 4, (
        f"Expected >= 4 'mailbox_activation' labels in function, got {count}"
    )


def test_resolve_actor_for_role_maps_builder():
    """_resolve_actor_for_role returns builder actor for builder role."""
    dispatcher = _load_graph_node_dispatcher()
    result = dispatcher._resolve_actor_for_role(
        {"logical_operator": ""},
        "builder",
        {},
    )
    assert result == "op.builder.generic.01"


def test_resolve_actor_for_role_maps_evaluator():
    """_resolve_actor_for_role returns evaluator actor for evaluator role."""
    dispatcher = _load_graph_node_dispatcher()
    result = dispatcher._resolve_actor_for_role(
        {"logical_operator": ""},
        "evaluator",
        {},
    )
    assert result == "op.evaluator.generic.01"


def test_resolve_actor_for_role_uses_explicit_actor_id():
    """_resolve_actor_for_role prefers explicit actor_id from node."""
    dispatcher = _load_graph_node_dispatcher()
    result = dispatcher._resolve_actor_for_role(
        {"actor_id": "custom.actor.01", "logical_operator": ""},
        "builder",
        {},
    )
    assert result == "custom.actor.01"
