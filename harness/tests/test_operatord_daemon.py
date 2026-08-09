#!/usr/bin/env python3
"""Tests for operatord daemon mode (N3 acceptance criteria).

Covers:
- Unit tests for operator_runtime utility functions added in N3
- Integration test: submit a task → daemon --once processes it end-to-end
"""

from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------

HARNESS_ROOT = Path(__file__).resolve().parents[1]
LIB_DIR = HARNESS_ROOT / "lib"
TOOLS_DIR = HARNESS_ROOT / "tools"
REAL_PERSONAS_DIR = HARNESS_ROOT / "personas"

sys.path.insert(0, str(LIB_DIR))
sys.path.insert(0, str(TOOLS_DIR))

import operator_runtime as _rt  # noqa: E402 — after path setup
import operatord as _od  # noqa: E402 — after path setup
from actor_lease import LeaseBroker  # noqa: E402 — after path setup
from capability_token import CapabilityToken  # noqa: E402 — after path setup


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MINIMAL_REGISTRY = {
    "version": 1,
    "operators": {
        "test-local-builder": {
            "display_name": "Test Local Builder (N3 test operator)",
            "role": "builder",
            "persona": "builder",
            "backend": "local",
            "model": "local",
            "enabled": True,
        }
    },
}

_COMMAND_REGISTRY = {
    "version": 1,
    "operators": {
        "test-command-builder": {
            "display_name": "Test Command Builder",
            "role": "builder",
            "persona": "builder",
            "backend": "command",
            "model": "local-command",
            "enabled": True,
        }
    },
}

_TASK_ENVELOPE = {
    "task_id": "T-n3-test-001",
    "sprint_id": "sprint-test-n3",
    "node_id": "N3",
    "operator_id": "test-local-builder",
    "task_type": "dummy",
    "objective": "Verify operatord daemon end-to-end lifecycle.",
}


def _read_event_jsonl(base: Path) -> list[dict]:
    path = base / "run" / "events.jsonl"
    if not path.exists():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _setup_harness(tmp_path: Path) -> dict:
    """Create a minimal harness directory and return the env dict."""
    (tmp_path / "config").mkdir(parents=True)
    (tmp_path / "personas").mkdir(parents=True)

    # Registry
    (tmp_path / "config" / "physical-operators.json").write_text(
        json.dumps(_MINIMAL_REGISTRY, indent=2)
    )

    # Persona file — copy real one if available, else write minimal content
    real_persona = REAL_PERSONAS_DIR / "builder.md"
    dest_persona = tmp_path / "personas" / "builder.md"
    if real_persona.exists():
        shutil.copy(real_persona, dest_persona)
    else:
        dest_persona.write_text("# Builder\nYou are a builder.")

    env = {**os.environ, "HARNESS_DIR": str(tmp_path), "SOLAR_OPERATORD_AUTO_KICK": "0"}
    return env


def _setup_command_harness(tmp_path: Path) -> dict:
    (tmp_path / "config").mkdir(parents=True)
    (tmp_path / "personas").mkdir(parents=True)
    (tmp_path / "tools").mkdir(parents=True)

    (tmp_path / "config" / "physical-operators.json").write_text(
        json.dumps(_COMMAND_REGISTRY, indent=2)
    )

    real_persona = REAL_PERSONAS_DIR / "builder.md"
    dest_persona = tmp_path / "personas" / "builder.md"
    if real_persona.exists():
        shutil.copy(real_persona, dest_persona)
    else:
        dest_persona.write_text("# Builder\nYou are a builder.")

    writer = tmp_path / "tools" / "write_handoff_from_dispatch.py"
    writer.write_text(
        """#!/usr/bin/env python3
import os
from pathlib import Path

dispatch = Path(os.environ["SOLAR_MULTI_TASK_DISPATCH_FILE"]).read_text(encoding="utf-8")
handoff = Path(os.environ["HANDOFF"])
handoff.parent.mkdir(parents=True, exist_ok=True)
handoff.write_text("# Handoff\\n\\n" + dispatch, encoding="utf-8")
result_path = os.environ.get("RESULT_PATH") or os.environ.get("PM_RESULT_PATH") or ""
if result_path:
    result = Path(result_path)
    result.parent.mkdir(parents=True, exist_ok=True)
    result.write_text("# PM Task Result\\n\\n## 已完成\\n- command backend wrote result\\n", encoding="utf-8")
print("dispatch_seen=" + str(Path(os.environ["SOLAR_MULTI_TASK_DISPATCH_FILE"]).exists()))
print("handoff_written=" + str(handoff))
""",
        encoding="utf-8",
    )
    writer.chmod(0o755)

    pm_dispatch = tmp_path / "tools" / "pm_dispatch.py"
    pm_dispatch.write_text(
        """#!/usr/bin/env python3
import json
import sys
from pathlib import Path

if len(sys.argv) >= 4 and sys.argv[1] == "complete" and sys.argv[2] == "--task-id":
    task_id = sys.argv[3]
    log = Path(__file__).resolve().parent.parent / "run" / "pm-complete.json"
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text(json.dumps({"task_id": task_id}, ensure_ascii=False), encoding="utf-8")
    print(f"✅ 任务 {task_id} 已标记为 completed")
    raise SystemExit(0)
if len(sys.argv) >= 4 and sys.argv[1] == "fail" and sys.argv[2] == "--task-id":
    task_id = sys.argv[3]
    status = ""
    reason = ""
    if "--status" in sys.argv:
        status = sys.argv[sys.argv.index("--status") + 1]
    if "--reason" in sys.argv:
        reason = sys.argv[sys.argv.index("--reason") + 1]
    log = Path(__file__).resolve().parent.parent / "run" / "pm-fail.json"
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text(
        json.dumps({"task_id": task_id, "status": status, "reason": reason}, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"❌ 任务 {task_id} 已标记为 {status}")
    raise SystemExit(0)
raise SystemExit(2)
""",
        encoding="utf-8",
    )
    pm_dispatch.chmod(0o755)

    env = {**os.environ, "HARNESS_DIR": str(tmp_path), "SOLAR_OPERATORD_AUTO_KICK": "0"}
    env["COMMAND_AGENT"] = f"python3 {writer}"
    return env


# ---------------------------------------------------------------------------
# Unit tests: scrub_secrets
# ---------------------------------------------------------------------------

class TestScrubSecrets:
    def test_scrubs_openai_key(self):
        text = "Using key sk-abcdefghijklmnopqrstuvwxyzABCDEFGH in request"
        out = _rt.scrub_secrets(text)
        assert "sk-" not in out
        assert "[SCRUBBED]" in out

    def test_scrubs_github_pat(self):
        text = "export TOKEN=ghp_" + "a" * 36
        out = _rt.scrub_secrets(text)
        assert "ghp_" not in out
        assert "[SCRUBBED]" in out

    def test_scrubs_bearer_token(self):
        text = "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig"
        out = _rt.scrub_secrets(text)
        assert "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9" not in out

    def test_passthrough_plain_text(self):
        text = "No secrets here, just a normal log line."
        assert _rt.scrub_secrets(text) == text


# ---------------------------------------------------------------------------
# Unit tests: list_inbox_tasks
# ---------------------------------------------------------------------------

class TestListInboxTasks:
    def test_empty_returns_empty(self, tmp_path, monkeypatch):
        monkeypatch.setattr(_rt, "OPERATOR_INBOX_DIR", tmp_path / "inbox")
        result = _rt.list_inbox_tasks("no-such-operator")
        assert result == []

    def test_returns_tasks(self, tmp_path, monkeypatch):
        inbox = tmp_path / "inbox" / "my-op"
        inbox.mkdir(parents=True)
        env = {"task_id": "T-001", "sprint_id": "s1", "node_id": "N1",
               "operator_id": "my-op", "task_type": "dummy", "objective": "test"}
        (inbox / "T-001.json").write_text(json.dumps(env))

        monkeypatch.setattr(_rt, "OPERATOR_INBOX_DIR", tmp_path / "inbox")
        tasks = _rt.list_inbox_tasks("my-op")
        assert len(tasks) == 1
        tid, envelope, path = tasks[0]
        assert tid == "T-001"
        assert envelope["task_id"] == "T-001"
        assert path.name == "T-001.json"


# ---------------------------------------------------------------------------
# Unit tests: write_heartbeat
# ---------------------------------------------------------------------------

class TestWriteHeartbeat:
    def _patch_dirs(self, monkeypatch, tmp_path):
        status_dir = tmp_path / "run" / "operator-status"
        monkeypatch.setattr(_rt, "OPERATOR_STATUS_DIR", status_dir)
        monkeypatch.setattr(_rt, "OPERATOR_LEASE_DIR", tmp_path / "run" / "operator-leases")
        return status_dir

    def test_writes_heartbeat_file(self, tmp_path, monkeypatch):
        status_dir = self._patch_dirs(monkeypatch, tmp_path)
        _rt.write_heartbeat("op1", "idle", resolved_persona="builder")

        hb = json.loads((status_dir / "op1.json").read_text())
        assert hb["runtime_state"] == "idle"
        assert hb["state"] == "idle"
        assert "heartbeat_at" in hb
        assert hb["resolved_persona"] == "builder"

    def test_includes_current_task(self, tmp_path, monkeypatch):
        self._patch_dirs(monkeypatch, tmp_path)
        _rt.write_heartbeat("op1", "running", current_task_id="T-abc")

        hb_path = tmp_path / "run" / "operator-status" / "op1.json"
        hb = json.loads(hb_path.read_text())
        assert hb["current_task_id"] == "T-abc"


# ---------------------------------------------------------------------------
# Unit tests: capability pre-dispatch
# ---------------------------------------------------------------------------

class TestCapabilityPreDispatch:
    def test_missing_token_ref_writes_event_without_abort(self, tmp_path, monkeypatch):
        monkeypatch.setattr(_od, "HARNESS_DIR", tmp_path)
        envelope = {
            "task_id": "T-missing-token",
            "sprint_id": "sprint-cap",
            "node_id": "N1",
            "policy_requests": [{"kind": "file", "op": "read", "path": "/tmp/a"}],
        }

        decision = _od._capability_pre_dispatch(envelope, "op-cap", "T-missing-token")

        assert decision is None
        events = _read_event_jsonl(tmp_path)
        assert len(events) == 1
        assert events[0]["event_type"] == "capability_decision_missing_token"
        assert events[0]["payload"]["reason"] == "missing_token"

    def test_denied_policy_request_writes_event_and_aborts(self, tmp_path, monkeypatch):
        monkeypatch.setattr(_od, "HARNESS_DIR", tmp_path)
        token_path = tmp_path / "token.json"
        CapabilityToken(
            token_id="tok-deny",
            scopes=["file:write"],
            expires_at="2099-01-01T00:00:00Z",
            actor_id="op-cap",
            file_scope={"read_paths": ["/tmp/allowed"]},
        ).to_dict()
        token_path.write_text(
            json.dumps(
                CapabilityToken(
                    token_id="tok-deny",
                    scopes=["file:write"],
                    expires_at="2099-01-01T00:00:00Z",
                    actor_id="op-cap",
                    file_scope={"read_paths": ["/tmp/allowed"]},
                ).to_dict()
            ),
            encoding="utf-8",
        )
        envelope = {
            "task_id": "T-deny",
            "sprint_id": "sprint-cap",
            "node_id": "N2",
            "capability_token_ref": {"path": str(token_path)},
            "policy_requests": [{"kind": "file", "op": "read", "path": "/etc/passwd"}],
        }

        decision = _od._capability_pre_dispatch(envelope, "op-cap", "T-deny")

        assert decision is not None
        assert decision.reason == "out_of_scope"
        events = _read_event_jsonl(tmp_path)
        assert len(events) == 1
        assert events[0]["event_type"] == "capability_decision"
        assert events[0]["payload"]["kind"] == "file"
        assert events[0]["payload"]["reason"] == "out_of_scope"

    def test_enforcement_off_writes_event_without_abort(self, tmp_path, monkeypatch):
        monkeypatch.setattr(_od, "HARNESS_DIR", tmp_path)
        monkeypatch.setenv("SOLAR_CAPABILITY_ENFORCEMENT", "off")
        token_path = tmp_path / "token.json"
        token_path.write_text(
            json.dumps(
                CapabilityToken(
                    token_id="tok-deny",
                    scopes=["file:write"],
                    expires_at="2099-01-01T00:00:00Z",
                    actor_id="op-cap",
                    file_scope={"read_paths": ["/tmp/allowed"]},
                ).to_dict()
            ),
            encoding="utf-8",
        )
        envelope = {
            "task_id": "T-off",
            "sprint_id": "sprint-cap",
            "node_id": "N3",
            "capability_token_ref": {"path": str(token_path)},
            "policy_requests": [{"kind": "file", "op": "read", "path": "/etc/passwd"}],
        }

        decision = _od._capability_pre_dispatch(envelope, "op-cap", "T-off")

        assert decision is None
        events = _read_event_jsonl(tmp_path)
        assert len(events) == 1
        assert events[0]["payload"]["reason"] == "out_of_scope"

    def test_audit_only_writes_event_without_abort(self, tmp_path, monkeypatch):
        monkeypatch.setattr(_od, "HARNESS_DIR", tmp_path)
        monkeypatch.setenv("SOLAR_CAPABILITY_AUDIT_ONLY", "1")
        token_path = tmp_path / "token.json"
        token_path.write_text(
            json.dumps(
                CapabilityToken(
                    token_id="tok-deny",
                    scopes=["file:write"],
                    expires_at="2099-01-01T00:00:00Z",
                    actor_id="op-cap",
                    file_scope={"read_paths": ["/tmp/allowed"]},
                ).to_dict()
            ),
            encoding="utf-8",
        )
        envelope = {
            "task_id": "T-audit",
            "sprint_id": "sprint-cap",
            "node_id": "N4",
            "capability_token_ref": {"path": str(token_path)},
            "policy_requests": [{"kind": "file", "op": "read", "path": "/etc/passwd"}],
        }

        decision = _od._capability_pre_dispatch(envelope, "op-cap", "T-audit")

        assert decision is None
        events = _read_event_jsonl(tmp_path)
        assert len(events) == 1
        assert events[0]["payload"]["reason"] == "out_of_scope"

    def test_cmd_run_envelope_denial_aborts_before_ready(self, tmp_path):
        env = _setup_harness(tmp_path)
        token_path = tmp_path / "token.json"
        token_path.write_text(
            json.dumps(
                CapabilityToken(
                    token_id="tok-run-deny",
                    scopes=["file:read"],
                    expires_at="2099-01-01T00:00:00Z",
                    actor_id="test-local-builder",
                    file_scope={"read_paths": ["/tmp/allowed"]},
                ).to_dict()
            ),
            encoding="utf-8",
        )
        envelope_path = tmp_path / "run-envelope.json"
        envelope_path.write_text(
            json.dumps(
                {
                    "task_id": "T-run-deny",
                    "sprint_id": "sprint-cap",
                    "node_id": "N-run",
                    "capability_token_ref": {"path": str(token_path)},
                    "policy_requests": [
                        {"kind": "file", "op": "read", "path": "/etc/passwd"}
                    ],
                }
            ),
            encoding="utf-8",
        )

        result = subprocess.run(
            [
                sys.executable,
                str(TOOLS_DIR / "operatord.py"),
                "run",
                "--operator",
                "test-local-builder",
                "--harness-dir",
                env["HARNESS_DIR"],
                "--envelope",
                str(envelope_path),
                "--json",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
        )

        assert result.returncode == 126
        assert '"status": "ready"' not in result.stdout
        events = _read_event_jsonl(tmp_path)
        assert len(events) == 1
        assert events[0]["event_type"] == "capability_decision"
        assert events[0]["payload"]["reason"] == "out_of_scope"


# ---------------------------------------------------------------------------
# Unit tests: write_result
# ---------------------------------------------------------------------------

class TestWriteResult:
    def _patch_dirs(self, monkeypatch, tmp_path):
        results_dir = tmp_path / "run" / "operator-results"
        monkeypatch.setattr(_rt, "OPERATOR_RESULTS_DIR", results_dir)
        return results_dir

    def test_writes_result_json(self, tmp_path, monkeypatch):
        results_dir = self._patch_dirs(monkeypatch, tmp_path)
        path = _rt.write_result(
            operator_id="op1",
            task_id="T-001",
            sprint_id="sprint-1",
            node_id="N1",
            status="completed",
            exit_code=0,
            started_at="2026-05-22T00:00:00Z",
            finished_at="2026-05-22T00:00:05Z",
            log_tail="task=T-001\ncompleted",
        )
        assert path.exists()
        result = json.loads(path.read_text())
        assert result["task_id"] == "T-001"
        assert result["operator_id"] == "op1"
        assert result["status"] == "completed"
        assert result["exit_code"] == 0
        assert result["started_at"] == "2026-05-22T00:00:00Z"
        assert result["finished_at"] == "2026-05-22T00:00:05Z"
        assert "log_tail" in result

    def test_writes_model_route_fields(self, tmp_path, monkeypatch):
        self._patch_dirs(monkeypatch, tmp_path)
        path = _rt.write_result(
            operator_id="op-glm",
            task_id="T-glm",
            sprint_id="sprint-1",
            node_id="N1",
            status="completed",
            exit_code=0,
            started_at="2026-05-22T00:00:00Z",
            finished_at="2026-05-22T00:00:05Z",
            log_tail="ok",
            model_route={
                "requested_model": "glm-5.1",
                "routing_model": "opus",
                "effective_provider": "zhipu",
                "effective_model": "glm-5.1",
            },
        )
        result = json.loads(path.read_text())
        assert result["requested_model"] == "glm-5.1"
        assert result["routing_model"] == "opus"
        assert result["effective_provider"] == "zhipu"
        assert result["effective_model"] == "glm-5.1"
        assert result["model_route"]["effective_model"] == "glm-5.1"

    def test_scrubs_secrets_in_log_tail(self, tmp_path, monkeypatch):
        self._patch_dirs(monkeypatch, tmp_path)
        _rt.write_result(
            operator_id="op1",
            task_id="T-002",
            sprint_id="s1",
            node_id="N1",
            status="completed",
            exit_code=0,
            started_at="2026-05-22T00:00:00Z",
            finished_at="2026-05-22T00:00:01Z",
            log_tail="sk-secretkeyABCDEFGHIJKLMNOPQRSTUVWXYZ logged",
        )
        result_path = tmp_path / "run" / "operator-results" / "op1" / "T-002" / "result.json"
        result = json.loads(result_path.read_text())
        assert "sk-secret" not in result["log_tail"]
        assert "[SCRUBBED]" in result["log_tail"]


# ---------------------------------------------------------------------------
# Integration test: full daemon --once end-to-end
# ---------------------------------------------------------------------------

class TestDaemonOnce:
    """Run the full operatord daemon --once via subprocess with a temp HARNESS_DIR."""

    OPERATOR_ID = "test-local-builder"
    TASK_ID = "T-n3-test-001"

    def _run_submit(self, env: dict, envelope_path: Path) -> dict:
        result = subprocess.run(
            [
                sys.executable,
                str(TOOLS_DIR / "..") + "/lib/operator_runtime.py",
                "submit",
                "--envelope",
                str(envelope_path),
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert result.returncode == 0, (
            f"submit failed:\nstdout={result.stdout}\nstderr={result.stderr}"
        )
        return json.loads(result.stdout)

    def _run_daemon_once(self, env: dict) -> subprocess.CompletedProcess:
        return subprocess.run(
            [
                sys.executable,
                str(TOOLS_DIR / "operatord.py"),
                "daemon",
                "--operator",
                self.OPERATOR_ID,
                "--once",
                "--poll-interval",
                "0.2",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )

    def test_end_to_end(self, tmp_path):
        env = _setup_harness(tmp_path)

        # Write task envelope file
        envelope_path = tmp_path / "envelope.json"
        envelope = dict(_TASK_ENVELOPE)
        envelope_path.write_text(json.dumps(envelope))

        # Submit task via operator_runtime CLI
        submit_out = self._run_submit(env, envelope_path)
        assert submit_out["status"] == "submitted"
        assert submit_out["task_id"] == self.TASK_ID
        actor_broker = LeaseBroker(tmp_path / "run" / "actor-leases")
        actor_broker.acquire(
            self.OPERATOR_ID,
            self.TASK_ID,
            envelope["sprint_id"],
            envelope["node_id"],
            ttl_sec=3600,
        )

        # Verify inbox was populated
        inbox_file = (
            tmp_path
            / "run"
            / "operator-inbox"
            / self.OPERATOR_ID
            / f"{self.TASK_ID}.json"
        )
        assert inbox_file.exists(), "Inbox file should be created by submit()"

        # Run daemon --once
        daemon_proc = self._run_daemon_once(env)
        assert daemon_proc.returncode == 0, (
            f"daemon --once failed:\nstdout={daemon_proc.stdout}\nstderr={daemon_proc.stderr}"
        )

        # ── Verify result artifact ────────────────────────────────────────────
        result_json = (
            tmp_path
            / "run"
            / "operator-results"
            / self.OPERATOR_ID
            / self.TASK_ID
            / "result.json"
        )
        assert result_json.exists(), (
            f"result.json not found at {result_json}\n"
            f"daemon stdout:\n{daemon_proc.stdout}\n"
            f"daemon stderr:\n{daemon_proc.stderr}"
        )
        result = json.loads(result_json.read_text())

        # Acceptance: result artifact must contain these fields
        assert result["task_id"] == self.TASK_ID
        assert result["operator_id"] == self.OPERATOR_ID
        assert result["status"] == "completed"
        assert "started_at" in result
        assert "finished_at" in result
        assert "log_tail" in result
        assert result["exit_code"] == 0

        # ── Verify status transitions via heartbeat file ───────────────────────
        hb_file = (
            tmp_path
            / "run"
            / "operator-status"
            / f"{self.OPERATOR_ID}.json"
        )
        assert hb_file.exists(), "Heartbeat status file should be written"
        hb = json.loads(hb_file.read_text())
        # After --once completes, daemon resets to idle
        assert hb["runtime_state"] == "idle"
        assert "heartbeat_at" in hb

        # ── Verify inbox is cleaned up ────────────────────────────────────────
        assert not inbox_file.exists(), (
            "Task envelope should be removed from inbox after processing"
        )

        # ── Verify lease is released ──────────────────────────────────────────
        lease_file = (
            tmp_path
            / "run"
            / "operator-leases"
            / f"{self.OPERATOR_ID}.json"
        )
        assert not lease_file.exists(), (
            "Lease file should be removed after task completion"
        )
        actor_lease = actor_broker.get(self.OPERATOR_ID)
        assert actor_lease is not None
        assert actor_lease.state == "READY"
        assert actor_lease.task_id is None

    def test_capability_denied_task_writes_terminal_result_without_backend(self, tmp_path):
        env = _setup_command_harness(tmp_path)
        token_path = tmp_path / "deny-token.json"
        token_path.write_text(
            json.dumps(
                CapabilityToken(
                    token_id="tok-daemon-deny",
                    scopes=["file:read"],
                    expires_at="2099-01-01T00:00:00Z",
                    actor_id="test-command-builder",
                    file_scope={"read_paths": ["/tmp/allowed"]},
                ).to_dict()
            ),
            encoding="utf-8",
        )
        marker = tmp_path / "backend-ran.txt"
        envelope = {
            "task_id": "T-capability-deny-001",
            "sprint_id": "sprint-command",
            "node_id": "N-deny",
            "operator_id": "test-command-builder",
            "task_type": "dummy",
            "objective": "deny before backend launch",
            "capability_token_ref": {"path": str(token_path)},
            "policy_requests": [
                {"kind": "file", "op": "read", "path": "/etc/passwd"}
            ],
            "command": (
                "python3 -c "
                + shlex.quote(
                    "from pathlib import Path; "
                    f"Path({str(marker)!r}).write_text('ran', encoding='utf-8')"
                )
            ),
        }
        envelope_path = tmp_path / "deny-envelope.json"
        envelope_path.write_text(json.dumps(envelope), encoding="utf-8")

        submit_out = self._run_submit(env, envelope_path)
        assert submit_out["status"] == "submitted"

        daemon_proc = subprocess.run(
            [
                sys.executable,
                str(TOOLS_DIR / "operatord.py"),
                "daemon",
                "--operator",
                "test-command-builder",
                "--once",
                "--poll-interval",
                "0.2",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )

        assert daemon_proc.returncode == 0, daemon_proc.stderr
        assert not marker.exists()
        result_json = (
            tmp_path
            / "run"
            / "operator-results"
            / "test-command-builder"
            / "T-capability-deny-001"
            / "result.json"
        )
        assert result_json.exists()
        result = json.loads(result_json.read_text(encoding="utf-8"))
        assert result["status"] == "capability_denied"
        assert result["exit_code"] == 126
        assert "capability_denied" in result["log_tail"]
        lease_file = tmp_path / "run" / "operator-leases" / "test-command-builder.json"
        assert not lease_file.exists()
        events = _read_event_jsonl(tmp_path)
        assert any(
            event["event_type"] == "capability_decision"
            and event["payload"]["task_id"] == "T-capability-deny-001"
            and event["payload"]["reason"] == "out_of_scope"
            for event in events
        )

    def test_output_log_written(self, tmp_path):
        env = _setup_harness(tmp_path)
        envelope_path = tmp_path / "envelope2.json"
        envelope = dict(_TASK_ENVELOPE)
        envelope["task_id"] = "T-n3-test-002"
        envelope_path.write_text(json.dumps(envelope))

        self._run_submit(env, envelope_path)

        daemon_proc = subprocess.run(
            [
                sys.executable,
                str(TOOLS_DIR / "operatord.py"),
                "daemon",
                "--operator",
                self.OPERATOR_ID,
                "--once",
                "--poll-interval",
                "0.2",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert daemon_proc.returncode == 0

        output_log = (
            tmp_path
            / "run"
            / "operator-results"
            / self.OPERATOR_ID
            / "T-n3-test-002"
            / "output.log"
        )
        assert output_log.exists(), "output.log should be written alongside result.json"
        log_content = output_log.read_text()
        assert "T-n3-test-002" in log_content or "operatord" in log_content

    def test_recovers_expired_lease_and_processes_task(self, tmp_path):
        env = _setup_harness(tmp_path)
        envelope_path = tmp_path / "expired-lease-envelope.json"
        envelope = dict(_TASK_ENVELOPE)
        envelope["task_id"] = "T-expired-lease-001"
        envelope_path.write_text(json.dumps(envelope), encoding="utf-8")

        submit_out = self._run_submit(env, envelope_path)
        assert submit_out["status"] == "submitted"

        lease_file = (
            tmp_path
            / "run"
            / "operator-leases"
            / f"{self.OPERATOR_ID}.json"
        )
        lease = json.loads(lease_file.read_text(encoding="utf-8"))
        lease["expires_at"] = "2000-01-01T00:00:00Z"
        lease_file.write_text(json.dumps(lease, indent=2), encoding="utf-8")

        daemon_proc = self._run_daemon_once(env)
        assert daemon_proc.returncode == 0, daemon_proc.stderr

        result_json = (
            tmp_path
            / "run"
            / "operator-results"
            / self.OPERATOR_ID
            / "T-expired-lease-001"
            / "result.json"
        )
        assert result_json.exists()
        result = json.loads(result_json.read_text(encoding="utf-8"))
        assert result["status"] == "completed"

    def test_command_backend_uses_materialized_dispatch_file(self, tmp_path):
        env = _setup_command_harness(tmp_path)
        envelope = {
            "task_id": "T-command-001",
            "sprint_id": "sprint-command",
            "node_id": "N1",
            "operator_id": "test-command-builder",
            "task_type": "dummy",
            "objective": "Verify command backend",
            "dispatch_text": "# dispatch\\n\\nhello command backend\\n",
            "handoff_path": str(tmp_path / "sprints" / "sprint-command.N1-handoff.md"),
            "command": "$COMMAND_AGENT",
        }
        envelope_path = tmp_path / "command-envelope.json"
        envelope_path.write_text(json.dumps(envelope), encoding="utf-8")

        submit_out = self._run_submit(env, envelope_path)
        assert submit_out["status"] == "submitted"

        daemon_proc = subprocess.run(
            [
                sys.executable,
                str(TOOLS_DIR / "operatord.py"),
                "daemon",
                "--operator",
                "test-command-builder",
                "--once",
                "--poll-interval",
                "0.2",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert daemon_proc.returncode == 0, daemon_proc.stderr

        result_json = (
            tmp_path
            / "run"
            / "operator-results"
            / "test-command-builder"
            / "T-command-001"
            / "result.json"
        )
        assert result_json.exists()
        result = json.loads(result_json.read_text())
        assert result["status"] == "completed"
        dispatch_md = result_json.parent / "dispatch.md"
        envelope_json = result_json.parent / "envelope.json"
        assert dispatch_md.exists()
        assert envelope_json.exists()
        assert "hello command backend" in dispatch_md.read_text(encoding="utf-8")
        handoff = tmp_path / "sprints" / "sprint-command.N1-handoff.md"
        assert handoff.exists()

    def test_pm_dispatch_result_path_and_complete_hook(self, tmp_path):
        env = _setup_command_harness(tmp_path)
        dispatch_dir = tmp_path / "run" / "pm-dispatch-files"
        dispatch_dir.mkdir(parents=True, exist_ok=True)
        dispatch_file = dispatch_dir / "pm-T-command-002.md"
        dispatch_file.write_text("# Solar PM Dispatch\\n\\nhello pm dispatch\\n", encoding="utf-8")

        envelope = {
            "task_id": "pm-T-command-002",
            "sprint_id": "sprint-command",
            "node_id": "N1",
            "operator_id": "test-command-builder",
            "task_type": "planning",
            "objective": "Verify PM dispatch completion path",
            "dispatch_file": str(dispatch_file),
            "result_path": str(tmp_path / "sprints" / "sprint-command.N1.pm-result.md"),
            "handoff_path": str(tmp_path / "sprints" / "sprint-command.N1-handoff.md"),
            "command": "$COMMAND_AGENT",
        }
        envelope_path = tmp_path / "pm-envelope.json"
        envelope_path.write_text(json.dumps(envelope), encoding="utf-8")

        submit_out = self._run_submit(env, envelope_path)
        assert submit_out["status"] == "submitted"

        daemon_proc = subprocess.run(
            [
                sys.executable,
                str(TOOLS_DIR / "operatord.py"),
                "daemon",
                "--operator",
                "test-command-builder",
                "--once",
                "--poll-interval",
                "0.2",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert daemon_proc.returncode == 0, daemon_proc.stderr

        result_json = (
            tmp_path
            / "run"
            / "operator-results"
            / "test-command-builder"
            / "pm-T-command-002"
            / "result.json"
        )
        result = json.loads(result_json.read_text())
        assert result["status"] == "completed"

        pm_result = tmp_path / "sprints" / "sprint-command.N1.pm-result.md"
        assert pm_result.exists()
        assert "command backend wrote result" in pm_result.read_text(encoding="utf-8")

        complete_log = tmp_path / "run" / "pm-complete.json"
        assert complete_log.exists()
        assert json.loads(complete_log.read_text(encoding="utf-8"))["task_id"] == "pm-T-command-002"

    def test_graph_eval_pm_task_requires_eval_sidecars_before_completed_result(self, tmp_path):
        env = _setup_command_harness(tmp_path)
        dispatch_dir = tmp_path / "run" / "pm-dispatch-files"
        dispatch_dir.mkdir(parents=True, exist_ok=True)
        dispatch_file = dispatch_dir / "pm-T-graph-eval-001.md"
        dispatch_file.write_text("# Solar PM Dispatch\n\nwrite eval sidecars\n", encoding="utf-8")

        envelope = {
            "task_id": "pm-T-graph-eval-001",
            "sprint_id": "sprint-command",
            "node_id": "V3",
            "operator_id": "test-command-builder",
            "task_type": "graph_eval",
            "requested_role": "evaluator",
            "objective": "Verify graph eval sidecar contract",
            "dispatch_file": str(dispatch_file),
            "result_path": str(tmp_path / "sprints" / "sprint-command.V3.pm-result.md"),
            "command": (
                "python3 -c "
                + shlex.quote(
                    "import os; "
                    "from pathlib import Path; "
                    "p=Path(os.environ['PM_RESULT_PATH']); "
                    "p.parent.mkdir(parents=True, exist_ok=True); "
                    "p.write_text('# PM Task Result\\n\\noperator wrote pm result only\\n', encoding='utf-8'); "
                    "print('pm_result_written=' + str(p))"
                )
            ),
        }
        envelope_path = tmp_path / "pm-graph-eval-envelope.json"
        envelope_path.write_text(json.dumps(envelope), encoding="utf-8")

        submit_out = self._run_submit(env, envelope_path)
        assert submit_out["status"] == "submitted"

        daemon_proc = subprocess.run(
            [
                sys.executable,
                str(TOOLS_DIR / "operatord.py"),
                "daemon",
                "--operator",
                "test-command-builder",
                "--once",
                "--poll-interval",
                "0.2",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert daemon_proc.returncode == 0, daemon_proc.stderr

        result_json = (
            tmp_path
            / "run"
            / "operator-results"
            / "test-command-builder"
            / "pm-T-graph-eval-001"
            / "result.json"
        )
        result = json.loads(result_json.read_text(encoding="utf-8"))
        assert result["status"] == "failed_contract_closeout"
        assert result["exit_code"] == 68
        assert "missing required graph_eval artifacts" in result["log_tail"]
        assert "sprint-command.V3-eval.md" in result["log_tail"]
        assert "sprint-command.V3-eval.json" in result["log_tail"]

        fail_log = tmp_path / "run" / "pm-fail.json"
        assert fail_log.exists()
        failed = json.loads(fail_log.read_text(encoding="utf-8"))
        assert failed["task_id"] == "pm-T-graph-eval-001"
        assert failed["status"] == "failed_contract_closeout"

    def test_signal_leaves_final_status(self, tmp_path):
        """SIGTERM while idle should leave a final idle status file."""
        import signal as _signal

        env = _setup_harness(tmp_path)

        # Start daemon with no task submitted (will poll and wait)
        proc = subprocess.Popen(
            [
                sys.executable,
                str(TOOLS_DIR / "operatord.py"),
                "daemon",
                "--operator",
                self.OPERATOR_ID,
                "--poll-interval",
                "0.1",
            ],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

        # Wait until at least one heartbeat is written
        hb_file = (
            tmp_path
            / "run"
            / "operator-status"
            / f"{self.OPERATOR_ID}.json"
        )
        deadline = time.time() + 5.0
        while not hb_file.exists() and time.time() < deadline:
            time.sleep(0.1)

        assert hb_file.exists(), "Heartbeat should be written within 5s of daemon start"

        # Send SIGTERM
        proc.send_signal(_signal.SIGTERM)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()

        # Final status should be idle
        hb = json.loads(hb_file.read_text())
        assert hb["runtime_state"] == "idle", (
            f"Final heartbeat after SIGTERM should be idle, got {hb['runtime_state']}"
        )


class TestBuildCommand:
    def test_claude_cli_backend_uses_print_command(self):
        cmd = _od._build_command(
            {"backend": "claude-cli", "model": "claude-opus-4-8"},
            {"task_id": "pm-sample", "dispatch_file": "/tmp/dispatch.md"},
        )
        joined = " ".join(cmd)
        assert cmd[:2] == ["bash", "-lc"]
        assert "claude --dangerously-skip-permissions" in joined
        assert "local-stub" not in joined
        assert 'cat "$DISPATCH_FILE"' in joined

    def test_claude_subscription_interactive_backend_requires_tmux(self):
        cmd = _od._build_command(
            {
                "backend": "claude-cli",
                "provider": "anthropic",
                "model": "sonnet",
                "key_ref": "claude_subscription",
                "launch_cmd_kind": "interactive_repl",
                "billing_surface": "subscription_interactive",
                "surface": {"type": "claude_code_interactive"},
            },
            {"task_id": "pm-sample", "dispatch_file": "/tmp/dispatch.md"},
        )
        joined = " ".join(cmd)
        assert cmd[:2] == ["sh", "-c"]
        assert "claude_subscription_interactive_requires_tmux_repl" in joined
        assert 'cat "$DISPATCH_FILE"' not in joined

    def test_glm_claude_cli_backend_uses_zhipu_opus_route(self):
        cmd = _od._build_command(
            {"backend": "claude-cli", "provider": "glm", "model": "glm-5.1"},
            {"task_id": "pm-glm", "dispatch_file": "/tmp/dispatch.md"},
        )
        joined = " ".join(cmd)
        assert cmd[:2] == ["bash", "-lc"]
        assert "ANTHROPIC_BASE_URL" in joined
        assert "ANTHROPIC_API_KEY" in joined
        assert "ANTHROPIC_DEFAULT_OPUS_MODEL" in joined
        assert "--model opus" in joined
        assert "--model glm-5.1" not in joined

    def test_glm_model_route_metadata_exposes_effective_model(self):
        route = _od._model_route_metadata(
            {"backend": "claude-cli", "provider": "glm", "model": "glm-5.1"}
        )
        assert route == {
            "requested_model": "glm-5.1",
            "routing_model": "opus",
            "effective_provider": "zhipu",
            "effective_model": "glm-5.1",
        }

    def test_command_backend_uses_registry_command_when_envelope_missing_command(self):
        cmd = _od._build_command(
            {"backend": "command", "command": "python3 /tmp/agent.py"},
            {"task_id": "pm-sample"},
        )
        assert cmd == ["bash", "-lc", "python3 /tmp/agent.py"]

    def test_empty_envelope_command_does_not_shadow_registry_command(self):
        cmd = _od._build_command(
            {"backend": "command", "command": "python3 /tmp/agent.py"},
            {"task_id": "pm-sample", "command": ""},
        )
        assert cmd == ["bash", "-lc", "python3 /tmp/agent.py"]


class TestFailureFlowControl:
    def _submit_command_task(self, tmp_path: Path, env: dict, *, task_id: str, command: str) -> None:
        envelope = {
            "task_id": task_id,
            "sprint_id": "sprint-command",
            "node_id": "N1",
            "operator_id": "test-command-builder",
            "task_type": "dummy",
            "objective": "exercise failure flow control",
            "command": command,
        }
        envelope_path = tmp_path / f"{task_id}.json"
        envelope_path.write_text(json.dumps(envelope), encoding="utf-8")
        result = subprocess.run(
            [
                sys.executable,
                str(TOOLS_DIR / "..") + "/lib/operator_runtime.py",
                "submit",
                "--envelope",
                str(envelope_path),
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert result.returncode == 0, (
            f"submit failed:\nstdout={result.stdout}\nstderr={result.stderr}"
        )

    def _run_command_daemon_once(self, env: dict) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(TOOLS_DIR / "operatord.py"),
                "daemon",
                "--operator",
                "test-command-builder",
                "--once",
                "--poll-interval",
                "0.2",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )

    def test_failed_quota_task_sets_cooldown(self, tmp_path):
        env = _setup_command_harness(tmp_path)
        self._submit_command_task(
            tmp_path,
            env,
            task_id="T-cooldown-001",
            command='python3 -c "print(\\"You\'ve hit your limit · resets 1:40pm\\", flush=True); raise SystemExit(1)"',
        )
        daemon_proc = self._run_command_daemon_once(env)
        assert daemon_proc.returncode == 0, daemon_proc.stderr

        status_path = tmp_path / "run" / "operator-status" / "test-command-builder.json"
        status = json.loads(status_path.read_text(encoding="utf-8"))
        assert status["runtime_state"] == "cooldown"

    def test_failed_auth_task_sets_auth_expired(self, tmp_path):
        env = _setup_command_harness(tmp_path)
        self._submit_command_task(
            tmp_path,
            env,
            task_id="T-auth-001",
            command='python3 -c "print(\\"You are not logged in\\", flush=True); raise SystemExit(1)"',
        )
        daemon_proc = self._run_command_daemon_once(env)
        assert daemon_proc.returncode == 0, daemon_proc.stderr

        status_path = tmp_path / "run" / "operator-status" / "test-command-builder.json"
        status = json.loads(status_path.read_text(encoding="utf-8"))
        assert status["runtime_state"] == "auth_expired"


class TestFailureTextForFlowControl:
    def test_includes_codex_sidecar_log_tail(self, tmp_path):
        result_dir = tmp_path / "task"
        result_dir.mkdir()
        (result_dir / "codex-cli-output.log").write_text(
            "ERROR: You've hit your usage limit for GPT-5.3-Codex-Spark. "
            "Switch to another model now, or try again at 9:25 PM.\n",
            encoding="utf-8",
        )

        text = _od._failure_text_for_flow_control(
            result_dir,
            ["wrapper exited before surfacing provider stderr"],
        )

        assert "wrapper exited before surfacing provider stderr" in text
        assert "codex-cli-output.log" in text
        assert "usage limit for GPT-5.3-Codex-Spark" in text
