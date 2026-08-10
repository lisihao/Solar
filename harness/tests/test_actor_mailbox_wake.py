import json
import os
import time
from pathlib import Path

import pytest

import sys

HARNESS_DIR = Path(__file__).resolve().parent.parent
TOOLS_DIR = HARNESS_DIR / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import actor_mailbox_wake as wake  # noqa: E402


def test_classify_tail_keeps_auth_error_when_only_ready_prompt_returns():
    tail = """
      Please run /login · API Error: 401 Invalid authentication credentials
    ───────────────────────────────────────
    ❯
    ───────────────────────────────────────
      ⏵⏵ bypass permissions on
      Claude Max
    """

    assert wake.classify_tail(tail) == ("auth_expired", "pane_tail_auth_blocker")


def test_classify_tail_ignores_auth_error_after_positive_login_recovery():
    tail = """
      Please run /login · API Error: 401 Invalid authentication credentials
      Login successful
      ▐▛███▜▌   Claude Code v2.1.119
    ───────────────────────────────────────
    ❯
    ───────────────────────────────────────
      ⏵⏵ bypass permissions on
      Claude Max
    """

    assert wake.classify_tail(tail) == ("ok", "")


def test_classify_tail_keeps_auth_error_without_ready_prompt():
    tail = "Please run /login · API Error: 401 Invalid authentication credentials"

    assert wake.classify_tail(tail) == ("auth_expired", "pane_tail_auth_blocker")


def test_classify_tail_marks_non_claude_api_429_as_runtime_misroute():
    tail = """
    ⎿ API Error: 429
      {"type":"error","error":{"type":"rate_limit_error","code":"1113",
      "message":"[1113][Insufficient balance or no resource package. Please recharge.]"}}
    """

    assert wake.classify_tail(tail) == ("runtime_misroute", "pane_tail_non_claude_api_quota")


def test_classify_tail_ignores_stale_non_claude_api_429_after_ready_prompt():
    tail = """
    ⎿ API Error: 429
      {"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}
    ▐▛███▜▌   Claude Code v2.1.119
    ▝▜█████▛▘  Sonnet 4.6 · Claude Max
    ───────────────────────────────────────
    ❯ Try "how does pm_dispatch.py work?"
    ───────────────────────────────────────
      ⏵⏵ bypass permissions on
    """

    assert wake.classify_tail(tail) == ("ok", "")


def test_send_wake_to_pane_confirms_stuck_input_once(tmp_path, monkeypatch):
    prompt = tmp_path / "wake.md"
    prompt.write_text("wake", encoding="utf-8")
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        return type("Proc", (), {"returncode": 0, "stdout": "", "stderr": ""})()

    monkeypatch.setattr(wake.subprocess, "run", fake_run)
    monkeypatch.setattr(wake.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane, lines=25: f"❯ 读取并执行 {prompt}")

    wake.send_wake_to_pane("session:0.3", prompt)

    enter_calls = [cmd for cmd in calls if cmd == ["tmux", "send-keys", "-t", "session:0.3", "Enter"]]
    assert len(enter_calls) == 2


def test_send_wake_to_pane_does_not_confirm_when_busy(tmp_path, monkeypatch):
    prompt = tmp_path / "wake.md"
    prompt.write_text("wake", encoding="utf-8")
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        return type("Proc", (), {"returncode": 0, "stdout": "", "stderr": ""})()

    monkeypatch.setattr(wake.subprocess, "run", fake_run)
    monkeypatch.setattr(wake.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane, lines=25: f"❯ 读取并执行 {prompt}\n✢ Precipitating…")

    wake.send_wake_to_pane("session:0.3", prompt)

    enter_calls = [cmd for cmd in calls if cmd == ["tmux", "send-keys", "-t", "session:0.3", "Enter"]]
    assert len(enter_calls) == 1


def test_interrupt_prompt_is_not_busy_even_with_stale_running_marker():
    tail = """
    ⎿  Running…
    Interrupt· What should Claude do
    ────────────────────────────────────────
    ❯
    """

    assert wake.tail_indicates_busy(tail) is False


def test_ready_footer_after_stale_busy_marker_is_not_busy():
    tail = """
    ✳ Effecting… (4m 13s)
    Done.
    ────────────────────────────────────────
    ❯
    ────────────────────────────────────────
      ⏵⏵ bypass permissions on (shift+tab
                         121394 tokens
      new task? /clear to save 121.4k tok…
    """

    assert wake.tail_indicates_busy(tail) is False


def _write_task(actor_dir: Path, task_id: str = "task-1") -> Path:
    inbox = actor_dir / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    path = inbox / f"task-{task_id}.json"
    path.write_text(
        json.dumps(
            {
                "task_id": task_id,
                "sprint_id": "sprint-1",
                "node_id": "N1",
                "dispatch_file": "/tmp/dispatch.md",
                "result_path": "/tmp/result.md",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return path


def test_auth_blocker_marks_status_without_claiming(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(
        wake,
        "capture_pane_tail",
        lambda pane: "Please run /login · API Error: 401 Invalid authentication credentials",
    )
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    task_path = _write_task(actor_dir)

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    assert result["ok"] is False
    assert result["status"] == "auth_expired"
    assert result["claimed"] is False
    assert task_path.exists()
    assert not (actor_dir / "processing" / task_path.name).exists()
    status = json.loads((wake.OPERATOR_STATUS_DIR / "mini-claude-sonnet-builder.json").read_text())
    assert status["runtime_state"] == "auth_expired"
    assert status["reason"] == "pane_tail_auth_blocker"
    heartbeat = json.loads((actor_dir / "heartbeat.json").read_text())
    assert heartbeat["status"] == "auth_expired"


def test_ok_tail_claims_oldest_task_and_sends_prompt_path(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    task_path = _write_task(actor_dir)
    status_dir = wake.OPERATOR_STATUS_DIR
    status_dir.mkdir(parents=True, exist_ok=True)
    (status_dir / "mini-claude-sonnet-builder.json").write_text(
        json.dumps({"operator_id": "mini-claude-sonnet-builder", "runtime_state": "auth_expired"}),
        encoding="utf-8",
    )
    sent = []

    def fake_send(pane, prompt_path, *, dismiss_feedback=False):
        sent.append((pane, prompt_path, dismiss_feedback))

    monkeypatch.setattr(wake, "send_wake_to_pane", fake_send)

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    processing_path = actor_dir / "processing" / task_path.name
    assert result["ok"] is True
    assert result["status"] == "processing"
    assert result["claimed"] is True
    assert result["operator_status_cleared"] is True
    assert not (status_dir / "mini-claude-sonnet-builder.json").exists()
    assert not task_path.exists()
    assert processing_path.exists()
    assert result["processing_path"] == str(processing_path)
    assert len(sent) == 1
    assert sent[0][0] == "session:0.3"
    assert sent[0][2] is False
    assert Path(result["wake_prompt_path"]).exists()
    assert str(processing_path) in Path(result["wake_prompt_path"]).read_text(encoding="utf-8")
    heartbeat = json.loads((actor_dir / "heartbeat.json").read_text())
    assert heartbeat["status"] == "processing"
    assert heartbeat["metadata"]["processing_path"] == str(processing_path)
    assert heartbeat["metadata"]["operator_status_cleared"] is True


def test_claim_task_refreshes_processing_mtime(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    task_path = _write_task(actor_dir)
    old = time.time() - 7200
    os.utime(task_path, (old, old))
    monkeypatch.setattr(wake, "send_wake_to_pane", lambda *args, **kwargs: None)

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    processing_path = Path(result["processing_path"])
    assert result["reason"] == "wake_sent"
    assert processing_path.exists()
    assert processing_path.stat().st_mtime > old + 3600


def test_busy_tail_without_processing_does_not_claim_next_inbox(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "✳ Effecting… (4m 13s)\n❯")
    actor_dir = wake.ACTORS_DIR / "mini-claude-opus-evaluator"
    task_path = _write_task(actor_dir)
    sent = []
    monkeypatch.setattr(wake, "send_wake_to_pane", lambda *args, **kwargs: sent.append(args))

    result = wake.wake_actor("mini-claude-opus-evaluator", "session:0.3")

    assert result["ok"] is True
    assert result["status"] == "processing"
    assert result["reason"] == "pane_busy_without_processing"
    assert result["claimed"] is False
    assert task_path.exists()
    assert sent == []
    heartbeat = json.loads((actor_dir / "heartbeat.json").read_text())
    assert heartbeat["metadata"]["reason"] == "pane_busy_without_processing"


def test_fresh_eval_sidecar_reconciles_processing_task(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯\n  ⏵⏵ bypass permissions on")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    actor_dir = wake.ACTORS_DIR / "mini-claude-opus-builder"
    processing = actor_dir / "processing"
    processing.mkdir(parents=True)
    task_path = processing / "task-1.json"
    task_path.write_text(
        json.dumps(
            {
                "task_id": "task-1",
                "sprint_id": "sprint-1",
                "node_id": "N4",
                "result_path": str(tmp_path / "old-result.md"),
            }
        ),
        encoding="utf-8",
    )
    old = time.time() - 120
    os.utime(task_path, (old, old))
    eval_path = tmp_path / ".solar" / "harness" / "sprints" / "sprint-1.N4-eval.json"
    eval_path.parent.mkdir(parents=True)
    eval_path.write_text('{"verdict":"pass"}\n', encoding="utf-8")

    result = wake.wake_actor("mini-claude-opus-builder", "session:0.2")

    assert result["reason"] == "processing_result_reconciled"
    assert result["reconciled_count"] == 1
    assert not task_path.exists()
    outbox = json.loads(Path(result["outbox_paths"][0]).read_text(encoding="utf-8"))
    assert outbox["source"] == "actor_mailbox_wake.eval_sidecar_reconcile"
    assert outbox["eval_json_path"] == str(eval_path)


def test_interrupt_ready_processing_rewakes_without_waiting_for_stale_age(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(
        wake,
        "capture_pane_tail",
        lambda pane: "Interrupt· What should Claude do\n────────────────\n❯\n  ⏵⏵ bypass permissions on",
    )
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    processing = actor_dir / "processing"
    processing.mkdir(parents=True)
    task_path = processing / "task-1.json"
    task_path.write_text(json.dumps({"task_id": "task-1", "sprint_id": "sprint-1", "node_id": "N1"}), encoding="utf-8")
    sent = []
    monkeypatch.setattr(wake, "send_wake_to_pane", lambda *args, **kwargs: sent.append(args))

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3", rewake_processing_after_seconds=900)

    assert result["reason"] == "rewake_processing"
    assert result["rewoken"] is True
    assert sent


def test_feedback_prompt_is_dismissed_before_wake(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(
        wake,
        "capture_pane_tail",
        lambda pane: "How is Claude doing this session?\n1: Bad   2: Fine   3: Good  0: Dismiss",
    )
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    _write_task(actor_dir)
    sent = []

    def fake_send(pane, prompt_path, *, dismiss_feedback=False):
        sent.append({"pane": pane, "dismiss_feedback": dismiss_feedback})

    monkeypatch.setattr(wake, "send_wake_to_pane", fake_send)

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    assert result["ok"] is True
    assert result["dismissed_feedback_prompt"] is True
    assert sent == [{"pane": "session:0.3", "dismiss_feedback": True}]


def test_ok_tail_without_inbox_clears_blocked_status(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    (actor_dir / "inbox").mkdir(parents=True, exist_ok=True)
    status_dir = wake.OPERATOR_STATUS_DIR
    status_dir.mkdir(parents=True, exist_ok=True)
    (status_dir / "mini-claude-sonnet-builder.json").write_text(
        json.dumps({"operator_id": "mini-claude-sonnet-builder", "runtime_state": "auth_expired"}),
        encoding="utf-8",
    )

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    assert result["ok"] is True
    assert result["status"] == "idle"
    assert result["operator_status_cleared"] is True
    assert not (status_dir / "mini-claude-sonnet-builder.json").exists()
    heartbeat = json.loads((actor_dir / "heartbeat.json").read_text())
    assert heartbeat["status"] == "idle"
    assert heartbeat["metadata"]["operator_status_cleared"] is True


def test_stale_processing_rewakes_existing_prompt(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(
        wake,
        "capture_pane_tail",
        lambda pane: "How is Claude doing this session?\n1: Bad   2: Fine   3: Good  0: Dismiss",
    )
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    processing = actor_dir / "processing"
    processing.mkdir(parents=True, exist_ok=True)
    task_path = processing / "task-a.json"
    task_path.write_text("{}", encoding="utf-8")
    old = time.time() - 3600
    os.utime(task_path, (old, old))
    prompt_path = actor_dir / "logs" / "wake-existing.md"
    prompt_path.parent.mkdir(parents=True, exist_ok=True)
    prompt_path.write_text("wake", encoding="utf-8")
    (actor_dir / "heartbeat.json").write_text(
        json.dumps(
            {
                "actor_id": "mini-claude-sonnet-builder",
                "status": "processing",
                "timestamp": "2000-01-01T00:00:00Z",
                "metadata": {"wake_prompt_path": str(prompt_path)},
            }
        ),
        encoding="utf-8",
    )
    sent = []

    def fake_send(pane, prompt_path_arg, *, dismiss_feedback=False):
        sent.append({"pane": pane, "prompt": str(prompt_path_arg), "dismiss_feedback": dismiss_feedback})

    monkeypatch.setattr(wake, "send_wake_to_pane", fake_send)

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    assert result["ok"] is True
    assert result["reason"] == "rewake_processing"
    assert result["rewoken"] is True
    assert result["dismissed_feedback_prompt"] is True
    assert sent == [{"pane": "session:0.3", "prompt": str(prompt_path), "dismiss_feedback": True}]
    assert task_path.stat().st_mtime > old + 1800


def test_existing_result_path_reconciles_processing_to_outbox(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    processing = actor_dir / "processing"
    processing.mkdir(parents=True, exist_ok=True)
    result_path = tmp_path / "sprints" / "sprint-1.N1.pm-result.md"
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text("# done\n", encoding="utf-8")
    processing_path = processing / "task-task-1.json"
    processing_path.write_text(
        json.dumps(
            {
                "task_id": "task-1",
                "sprint_id": "sprint-1",
                "node_id": "N1",
                "requested_role": "builder",
                "result_path": str(result_path),
            }
        ),
        encoding="utf-8",
    )
    old = time.time() - 60
    os.utime(processing_path, (old, old))

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    assert result["ok"] is True
    assert result["reason"] == "processing_result_reconciled"
    assert result["reconciled_count"] == 1
    assert result["remaining_processing_count"] == 0
    assert not processing_path.exists()
    archived = actor_dir / "completed" / processing_path.name
    assert archived.exists()
    outbox_paths = list((actor_dir / "outbox").glob("result-*.json"))
    assert len(outbox_paths) == 1
    outbox = json.loads(outbox_paths[0].read_text(encoding="utf-8"))
    assert outbox["task_id"] == "task-1"
    assert outbox["status"] == "completed"
    assert outbox["verdict"] == "passed"
    assert outbox["source"] == "actor_mailbox_wake.result_path_reconcile"
    assert outbox["result_path"] == str(result_path)
    handoff_path = wake.HARNESS_DIR / "sprints" / "sprint-1.N1-handoff.md"
    assert handoff_path.exists()
    assert "Source: actor_mailbox_wake.result_path_reconcile" in handoff_path.read_text(encoding="utf-8")
    assert outbox["handoff_path"] == str(handoff_path)
    heartbeat = json.loads((actor_dir / "heartbeat.json").read_text())
    assert heartbeat["status"] == "idle"
    assert heartbeat["metadata"]["reconciled_count"] == 1


def test_stale_result_path_does_not_reconcile_new_processing(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    processing = actor_dir / "processing"
    processing.mkdir(parents=True, exist_ok=True)
    result_path = tmp_path / "sprints" / "sprint-1.N1.pm-result.md"
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text("# stale previous result\n", encoding="utf-8")
    old = time.time() - 3600
    os.utime(result_path, (old, old))
    processing_path = processing / "task-task-1.json"
    processing_path.write_text(
        json.dumps(
            {
                "task_id": "task-1",
                "sprint_id": "sprint-1",
                "node_id": "N1",
                "requested_role": "builder",
                "result_path": str(result_path),
            }
        ),
        encoding="utf-8",
    )

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    assert result["reason"] == "processing_not_stale"
    assert processing_path.exists()
    assert not (actor_dir / "completed" / processing_path.name).exists()
    assert list((actor_dir / "outbox").glob("result-*.json")) == []


def test_pm_result_path_with_different_task_id_does_not_reconcile_processing(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    processing = actor_dir / "processing"
    processing.mkdir(parents=True, exist_ok=True)
    result_path = tmp_path / "sprints" / "sprint-1.N1.pm-result.md"
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text("# PM Task Result — pm-sprint-1-N1-old\n", encoding="utf-8")
    processing_path = processing / "task-new.json"
    processing_path.write_text(
        json.dumps(
            {
                "task_id": "pm-sprint-1-N1-new",
                "sprint_id": "sprint-1",
                "node_id": "N1",
                "requested_role": "planner",
                "result_path": str(result_path),
            }
        ),
        encoding="utf-8",
    )
    old = time.time() - 60
    os.utime(processing_path, (old, old))

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    assert result["reason"] == "processing_not_stale"
    assert processing_path.exists()
    assert not (actor_dir / "completed" / processing_path.name).exists()
    assert list((actor_dir / "outbox").glob("result-*.json")) == []


def test_processing_result_reconcile_claims_next_inbox_same_wake(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    processing = actor_dir / "processing"
    processing.mkdir(parents=True, exist_ok=True)
    result_path = tmp_path / "sprints" / "sprint-1.N1.pm-result.md"
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text("# done\n", encoding="utf-8")
    processing_path = processing / "task-task-1.json"
    processing_path.write_text(
        json.dumps(
            {
                "task_id": "task-1",
                "sprint_id": "sprint-1",
                "node_id": "N1",
                "requested_role": "builder",
                "result_path": str(result_path),
            }
        ),
        encoding="utf-8",
    )
    old = time.time() - 60
    os.utime(processing_path, (old, old))
    inbox = actor_dir / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    inbox_path = inbox / "task-queued.json"
    inbox_path.write_text(
        json.dumps(
            {
                "task_id": "queued",
                "sprint_id": "sprint-1",
                "node_id": "N2",
                "dispatch_file": "/tmp/dispatch-queued.md",
                "result_path": "/tmp/result-queued.md",
            }
        ),
        encoding="utf-8",
    )
    sent = []

    def fake_send(pane, prompt_path_arg, *, dismiss_feedback=False):
        sent.append(str(prompt_path_arg))

    monkeypatch.setattr(wake, "send_wake_to_pane", fake_send)

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    assert result["reason"] == "wake_sent"
    assert result["claimed"] is True
    assert len(sent) == 1
    assert not inbox_path.exists()
    assert (processing / inbox_path.name).exists()
    assert (actor_dir / "completed" / processing_path.name).exists()


def test_preflight_reconcile_succeeds_when_pane_capture_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")

    def fail_capture(pane):
        raise RuntimeError("tmux pane is dead")

    monkeypatch.setattr(wake, "capture_pane_tail", fail_capture)
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    processing = actor_dir / "processing"
    processing.mkdir(parents=True, exist_ok=True)
    result_path = tmp_path / "sprints" / "sprint-1.N1.pm-result.md"
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text("# done\n", encoding="utf-8")
    processing_path = processing / "task-task-1.json"
    processing_path.write_text(
        json.dumps(
            {
                "task_id": "task-1",
                "sprint_id": "sprint-1",
                "node_id": "N1",
                "requested_role": "builder",
                "result_path": str(result_path),
            }
        ),
        encoding="utf-8",
    )
    old = time.time() - 60
    os.utime(processing_path, (old, old))

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    assert result["reason"] == "processing_result_reconciled"
    assert result["reconcile_phase"] == "preflight"
    assert result["claimed"] is False
    assert result["remaining_processing_count"] == 0
    assert not processing_path.exists()
    assert (actor_dir / "completed" / processing_path.name).exists()


def test_preflight_reconcile_rewakes_remaining_stale_processing(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Interrupt· What should Claude do\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    processing = actor_dir / "processing"
    processing.mkdir(parents=True, exist_ok=True)
    result_path = tmp_path / "sprints" / "sprint-1.N1.pm-result.md"
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text("# done\n", encoding="utf-8")
    completed_processing = processing / "task-task-1.json"
    completed_processing.write_text(
        json.dumps(
            {
                "task_id": "task-1",
                "sprint_id": "sprint-1",
                "node_id": "N1",
                "requested_role": "builder",
                "result_path": str(result_path),
            }
        ),
        encoding="utf-8",
    )
    stale_processing = processing / "task-task-2.json"
    stale_processing.write_text(
        json.dumps(
            {
                "task_id": "task-2",
                "sprint_id": "sprint-1",
                "node_id": "N2",
                "requested_role": "builder",
                "dispatch_file": "/tmp/dispatch-2.md",
                "result_path": str(tmp_path / "sprints" / "sprint-1.N2.pm-result.md"),
            }
        ),
        encoding="utf-8",
    )
    old = time.time() - 3600
    os.utime(completed_processing, (old, old))
    os.utime(stale_processing, (old, old))
    prompt_path = actor_dir / "logs" / "wake-existing.md"
    prompt_path.parent.mkdir(parents=True, exist_ok=True)
    prompt_path.write_text(f"Task: task-2\nMailbox processing envelope: {stale_processing}\n", encoding="utf-8")
    (actor_dir / "heartbeat.json").write_text(
        json.dumps({"metadata": {"wake_prompt_path": str(prompt_path)}}),
        encoding="utf-8",
    )
    sent = []
    monkeypatch.setattr(
        wake,
        "send_wake_to_pane",
        lambda pane, prompt_path_arg, *, dismiss_feedback=False: sent.append(str(prompt_path_arg)),
    )

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    assert result["reason"] == "rewake_processing"
    assert result["rewoken"] is True
    assert sent == [str(prompt_path)]
    assert not completed_processing.exists()
    assert stale_processing.exists()
    assert stale_processing.stat().st_mtime > old + 1800
    assert (actor_dir / "completed" / completed_processing.name).exists()


def test_completed_node_duplicate_inbox_moves_to_dead_letter_without_claim(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    outbox = actor_dir / "outbox"
    outbox.mkdir(parents=True, exist_ok=True)
    (outbox / "result-original.json").write_text(
        json.dumps(
            {
                "task_id": "original",
                "sprint_id": "sprint-1",
                "node_id": "N1",
                "status": "completed",
                "verdict": "passed",
            }
        ),
        encoding="utf-8",
    )
    inbox_path = _write_task(actor_dir, "duplicate")

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    assert result["reason"] == "duplicate_inbox_reconciled"
    assert result["claimed"] is False
    assert result["duplicate_inbox_reconciled_count"] == 1
    assert not inbox_path.exists()
    assert (actor_dir / "dead-letter" / inbox_path.name).exists()
    duplicate_outbox = json.loads(Path(result["duplicate_outbox_paths"][0]).read_text(encoding="utf-8"))
    assert duplicate_outbox["status"] == "cancelled"
    assert duplicate_outbox["verdict"] == "skipped"
    assert duplicate_outbox["source"] == "actor_mailbox_wake.duplicate_inbox_completed_node"


def test_completed_task_with_existing_outbox_backfills_builder_handoff(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    completed = actor_dir / "completed"
    completed.mkdir(parents=True, exist_ok=True)
    outbox = actor_dir / "outbox"
    outbox.mkdir(parents=True, exist_ok=True)
    result_path = tmp_path / "sprints" / "sprint-1.N1.pm-result.md"
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text("# done\n", encoding="utf-8")
    task_path = completed / "task-task-1.json"
    task_path.write_text(
        json.dumps(
            {
                "task_id": "task-1",
                "sprint_id": "sprint-1",
                "node_id": "N1",
                "requested_role": "builder",
                "result_path": str(result_path),
            }
        ),
        encoding="utf-8",
    )
    (outbox / "result-task-1.json").write_text(json.dumps({"task_id": "task-1"}), encoding="utf-8")

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    assert result["reason"] == "processing_result_reconciled"
    handoff_path = tmp_path / "sprints" / "sprint-1.N1-handoff.md"
    assert handoff_path.exists()
    assert "Result:" in handoff_path.read_text(encoding="utf-8")
    assert task_path.exists()


def test_existing_handoff_without_result_path_reconciles_processing(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    processing = actor_dir / "processing"
    processing.mkdir(parents=True, exist_ok=True)
    handoff = tmp_path / "sprints" / "sprint-1.S3-handoff.md"
    handoff.parent.mkdir(parents=True, exist_ok=True)
    handoff.write_text("# handoff\n", encoding="utf-8")
    task_path = processing / "task-task-1.json"
    task_path.write_text(
        json.dumps(
            {
                "task_id": "task-1",
                "sprint_id": "sprint-1",
                "node_id": "S3",
            }
        ),
        encoding="utf-8",
    )

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    assert result["reason"] == "processing_result_reconciled"
    assert not task_path.exists()
    assert (actor_dir / "completed" / task_path.name).exists()
    outbox_paths = list((actor_dir / "outbox").glob("result-*.json"))
    assert len(outbox_paths) == 1
    outbox = json.loads(outbox_paths[0].read_text(encoding="utf-8"))
    assert outbox["status"] == "completed"
    assert outbox["source"] == "actor_mailbox_wake.handoff_reconcile"
    assert outbox["handoff_path"] == str(handoff)


def test_completed_handoff_with_existing_outbox_does_not_reconcile_again(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    completed = actor_dir / "completed"
    completed.mkdir(parents=True, exist_ok=True)
    handoff = tmp_path / "sprints" / "sprint-1.S3-handoff.md"
    handoff.parent.mkdir(parents=True, exist_ok=True)
    handoff.write_text("# handoff\n", encoding="utf-8")
    task_path = completed / "task-task-1.json"
    task_path.write_text(
        json.dumps({"task_id": "task-1", "sprint_id": "sprint-1", "node_id": "S3"}),
        encoding="utf-8",
    )
    outbox = actor_dir / "outbox"
    outbox.mkdir(parents=True, exist_ok=True)
    (outbox / "result-task-1.json").write_text(json.dumps({"task_id": "task-1"}), encoding="utf-8")

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    assert result["reason"] == "no_inbox_task"
    assert len(list(outbox.glob("result-*.json"))) == 1


def test_completed_task_restores_missing_result_and_handoff_from_outbox(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    completed = actor_dir / "completed"
    completed.mkdir(parents=True, exist_ok=True)
    result_path = tmp_path / "sprints" / "sprint-1.N1.pm-result.md"
    task_path = completed / "task-task-1.json"
    task_path.write_text(
        json.dumps(
            {
                "task_id": "task-1",
                "sprint_id": "sprint-1",
                "node_id": "N1",
                "requested_role": "builder",
                "result_path": str(result_path),
            }
        ),
        encoding="utf-8",
    )
    outbox = actor_dir / "outbox"
    outbox.mkdir(parents=True, exist_ok=True)
    (outbox / "task-task-1.result.json").write_text(
        json.dumps(
            {
                "task_id": "task-1",
                "sprint_id": "sprint-1",
                "node_id": "N1",
                "status": "reviewing",
                "summary": "verified already",
                "tests": {"command": "pytest", "result": "1 passed", "passed": True},
                "verified_acceptance": ["acceptance covered"],
                "risks": ["none"],
                "result_path": str(result_path),
            }
        ),
        encoding="utf-8",
    )

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    assert result["reason"] == "processing_result_reconciled"
    handoff_path = tmp_path / "sprints" / "sprint-1.N1-handoff.md"
    assert result_path.exists()
    assert handoff_path.exists()
    assert "Source: actor_mailbox_wake.outbox_artifact_restore" in result_path.read_text(encoding="utf-8")
    assert "verified already" in handoff_path.read_text(encoding="utf-8")


def test_nonrecoverable_smoke_processing_moves_to_dead_letter(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    processing = actor_dir / "processing"
    processing.mkdir(parents=True, exist_ok=True)
    task_path = processing / "task-_smoke.json"
    task_path.write_text(
        json.dumps(
            {
                "task_id": "_smoke--RT--cafe1234",
                "sprint_id": "_smoke_rt",
                "node_id": "RT",
                "access_path_decision": {"selected": "no_available_access_path"},
            }
        ),
        encoding="utf-8",
    )

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    assert result["reason"] == "processing_result_reconciled"
    assert not task_path.exists()
    assert (actor_dir / "dead-letter" / task_path.name).exists()
    outbox_paths = list((actor_dir / "outbox").glob("result-*.json"))
    assert len(outbox_paths) == 1
    outbox = json.loads(outbox_paths[0].read_text(encoding="utf-8"))
    assert outbox["status"] == "cancelled"
    assert outbox["verdict"] == "skipped"
    assert outbox["source"] == "actor_mailbox_wake.stale_smoke_dead_letter"


def test_stale_processing_uses_latest_log_prompt_when_heartbeat_lacks_prompt(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    processing = actor_dir / "processing"
    processing.mkdir(parents=True, exist_ok=True)
    task_path = processing / "task-a.json"
    task_path.write_text("{}", encoding="utf-8")
    old = time.time() - 3600
    os.utime(task_path, (old, old))
    prompt_path = actor_dir / "logs" / "wake-latest.md"
    prompt_path.parent.mkdir(parents=True, exist_ok=True)
    prompt_path.write_text("wake", encoding="utf-8")
    (actor_dir / "heartbeat.json").write_text(
        json.dumps(
            {
                "actor_id": "mini-claude-sonnet-builder",
                "status": "processing",
                "timestamp": "2000-01-01T00:00:00Z",
                "metadata": {"reason": "processing_not_stale"},
            }
        ),
        encoding="utf-8",
    )
    sent = []

    def fake_send(pane, prompt_path_arg, *, dismiss_feedback=False):
        sent.append(str(prompt_path_arg))

    monkeypatch.setattr(wake, "send_wake_to_pane", fake_send)

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3")

    assert result["reason"] == "rewake_processing"
    assert result["wake_prompt_path"] == str(prompt_path)
    assert sent == [str(prompt_path)]


def test_stale_processing_uses_processing_mtime_not_fresh_heartbeat(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    processing = actor_dir / "processing"
    processing.mkdir(parents=True, exist_ok=True)
    task_path = processing / "task-a.json"
    task_path.write_text(json.dumps({"task_id": "task-a", "objective": "repair"}), encoding="utf-8")
    old = time.time() - 3600
    os.utime(task_path, (old, old))
    (actor_dir / "heartbeat.json").write_text(
        json.dumps(
            {
                "actor_id": "mini-claude-sonnet-builder",
                "status": "processing",
                "timestamp": wake._now_iso(),
                "metadata": {"reason": "processing_not_stale"},
            }
        ),
        encoding="utf-8",
    )
    sent = []

    def fake_send(pane, prompt_path_arg, *, dismiss_feedback=False):
        sent.append(str(prompt_path_arg))

    monkeypatch.setattr(wake, "send_wake_to_pane", fake_send)

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3", rewake_processing_after_seconds=600)

    assert result["reason"] == "rewake_processing"
    assert result["rewoken"] is True
    assert result["wake_prompt_path"].endswith(".md")
    assert sent == [result["wake_prompt_path"]]


def test_existing_processing_blocks_inbox_claim_when_not_stale(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    processing = actor_dir / "processing"
    processing.mkdir(parents=True, exist_ok=True)
    processing_path = processing / "task-active.json"
    processing_path.write_text(json.dumps({"task_id": "active"}), encoding="utf-8")
    inbox_path = _write_task(actor_dir, "queued")
    sent = []

    def fake_send(pane, prompt_path_arg, *, dismiss_feedback=False):
        sent.append(str(prompt_path_arg))

    monkeypatch.setattr(wake, "send_wake_to_pane", fake_send)

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3", rewake_processing_after_seconds=600)

    assert result["reason"] == "processing_not_stale"
    assert result["claimed"] is False
    assert result["rewoken"] is False
    assert sent == []
    assert processing_path.exists()
    assert inbox_path.exists()
    assert len(list(processing.glob("task-*.json"))) == 1


def test_existing_stale_processing_rewakes_without_claiming_inbox(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    processing = actor_dir / "processing"
    processing.mkdir(parents=True, exist_ok=True)
    processing_path = processing / "task-active.json"
    processing_path.write_text(json.dumps({"task_id": "active", "objective": "finish old task"}), encoding="utf-8")
    old = time.time() - 3600
    os.utime(processing_path, (old, old))
    inbox_path = _write_task(actor_dir, "queued")
    sent = []

    def fake_send(pane, prompt_path_arg, *, dismiss_feedback=False):
        sent.append(str(prompt_path_arg))

    monkeypatch.setattr(wake, "send_wake_to_pane", fake_send)

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3", rewake_processing_after_seconds=600)

    assert result["reason"] == "rewake_processing"
    assert result["claimed"] is False
    assert result["rewoken"] is True
    assert sent == [result["wake_prompt_path"]]
    assert processing_path.exists()
    assert inbox_path.exists()
    assert len(list(processing.glob("task-*.json"))) == 1


def test_busy_tail_blocks_stale_processing_rewake(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "✻ Forming… (11m)\n  ⎿ \xa0Running…")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    processing = actor_dir / "processing"
    processing.mkdir(parents=True, exist_ok=True)
    processing_path = processing / "task-active.json"
    processing_path.write_text(json.dumps({"task_id": "active", "objective": "finish old task"}), encoding="utf-8")
    old = time.time() - 3600
    os.utime(processing_path, (old, old))
    sent = []

    def fake_send(pane, prompt_path_arg, *, dismiss_feedback=False):
        sent.append(str(prompt_path_arg))

    monkeypatch.setattr(wake, "send_wake_to_pane", fake_send)

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3", rewake_processing_after_seconds=600)

    assert result["reason"] == "processing_active"
    assert result["claimed"] is False
    assert result["rewoken"] is False
    assert sent == []
    assert processing_path.exists()


def test_multiple_processing_blocks_rewake_and_inbox_claim(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    processing = actor_dir / "processing"
    processing.mkdir(parents=True, exist_ok=True)
    first = processing / "task-first.json"
    second = processing / "task-second.json"
    first.write_text(json.dumps({"task_id": "first"}), encoding="utf-8")
    second.write_text(json.dumps({"task_id": "second"}), encoding="utf-8")
    old = time.time() - 3600
    os.utime(first, (old, old))
    os.utime(second, (old, old))
    inbox_path = _write_task(actor_dir, "queued")
    sent = []

    def fake_send(pane, prompt_path_arg, *, dismiss_feedback=False):
        sent.append(str(prompt_path_arg))

    monkeypatch.setattr(wake, "send_wake_to_pane", fake_send)

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3", rewake_processing_after_seconds=600)

    assert result["reason"] == "multiple_processing_blocked"
    assert result["claimed"] is False
    assert result["rewoken"] is False
    assert result["processing_count"] == 2
    assert sent == []
    assert inbox_path.exists()
    assert first.exists()
    assert second.exists()


def test_dry_run_does_not_claim_or_write(tmp_path, monkeypatch):
    monkeypatch.setattr(wake, "ACTORS_DIR", tmp_path / "actors")
    monkeypatch.setattr(wake, "OPERATOR_STATUS_DIR", tmp_path / "run" / "operator-status")
    monkeypatch.setattr(wake, "capture_pane_tail", lambda pane: "Claude Code ready\n❯ ")
    actor_dir = wake.ACTORS_DIR / "mini-claude-sonnet-builder"
    task_path = _write_task(actor_dir)

    result = wake.wake_actor("mini-claude-sonnet-builder", "session:0.3", dry_run=True)

    assert result["ok"] is True
    assert result["status"] == "processing"
    assert result["claimed"] is False
    assert task_path.exists()
    assert not (actor_dir / "heartbeat.json").exists()
