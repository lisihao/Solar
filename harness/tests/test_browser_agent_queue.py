import json
import os
import subprocess
import sys
import importlib.util
import hashlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
QUEUE = ROOT / "scripts" / "browser_agent_queue.py"


def _load_queue_module():
    spec = importlib.util.spec_from_file_location("browser_agent_queue_test", QUEUE)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_enqueue_and_single_worker_runs_fifo_with_bypass(tmp_path: Path):
    queue_dir = tmp_path / "queue"
    out = tmp_path / "order.txt"
    env = os.environ.copy()
    env["BROWSER_AGENT_QUEUE_MIN_GAP_SECONDS"] = "0"

    job_script = tmp_path / "job.py"
    job_script.write_text(
        "import os, pathlib, sys\n"
        "pathlib.Path(sys.argv[1]).open('a', encoding='utf-8').write(sys.argv[2] + ':' + os.environ.get('BROWSER_AGENT_QUEUE_BYPASS', '') + '\\n')\n",
        encoding="utf-8",
    )

    for name in ("one", "two"):
        proc = subprocess.run(
            [
                sys.executable,
                str(QUEUE),
                "--queue-dir",
                str(queue_dir),
                "enqueue",
                "--name",
                name,
                "--cwd",
                str(tmp_path),
                "--",
                sys.executable,
                str(job_script),
                str(out),
                name,
            ],
            text=True,
            capture_output=True,
            check=True,
            env=env,
        )
        assert json.loads(proc.stdout)["status"] == "queued"

    subprocess.run(
        [
            sys.executable,
            str(QUEUE),
            "--queue-dir",
            str(queue_dir),
            "worker",
            "--min-gap-seconds",
            "0",
        ],
        text=True,
        capture_output=True,
        check=True,
        env=env,
    )

    assert out.read_text(encoding="utf-8").splitlines() == ["one:1", "two:1"]
    status = subprocess.run(
        [sys.executable, str(QUEUE), "--queue-dir", str(queue_dir), "status"],
        text=True,
        capture_output=True,
        check=True,
    )
    payload = json.loads(status.stdout)
    assert payload["pending_count"] == 0
    assert payload["done_count"] == 2


def test_enqueue_skips_duplicate_active_name(tmp_path: Path):
    queue_dir = tmp_path / "queue"
    env = os.environ.copy()
    env["BROWSER_AGENT_QUEUE_MIN_GAP_SECONDS"] = "0"

    base_cmd = [
        sys.executable,
        str(QUEUE),
        "--queue-dir",
        str(queue_dir),
        "enqueue",
        "--name",
        "tech-hotspot-hf-paper-report-plan-2026-06-28",
        "--cwd",
        str(tmp_path),
        "--",
        sys.executable,
        "-c",
        "print('ok')",
    ]
    first = subprocess.run(base_cmd, text=True, capture_output=True, check=True, env=env)
    duplicate = subprocess.run(base_cmd, text=True, capture_output=True, check=True, env=env)

    assert json.loads(first.stdout)["status"] == "queued"
    payload = json.loads(duplicate.stdout)
    assert payload["status"] == "duplicate_active"
    assert payload["duplicate"]["state"] == "pending"
    assert len((queue_dir / "pending.jsonl").read_text(encoding="utf-8").splitlines()) == 1


def test_enqueue_respects_maintenance_gate_for_daily_jobs(tmp_path: Path):
    queue_dir = tmp_path / "queue"
    queue_dir.mkdir(parents=True)
    (queue_dir / "maintenance-gate.json").write_text(
        json.dumps(
            {
                "enabled": True,
                "reason": "planned_report_recovery",
                "pause_names": ["youtube-daily-ai-influence-report"],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    proc = subprocess.run(
        [
            sys.executable,
            str(QUEUE),
            "--queue-dir",
            str(queue_dir),
            "enqueue",
            "--name",
            "youtube-daily-ai-influence-report",
            "--cwd",
            str(tmp_path),
            "--",
            sys.executable,
            "-c",
            "print('should not run')",
        ],
        text=True,
        capture_output=True,
        check=True,
    )

    payload = json.loads(proc.stdout)
    assert payload["status"] == "paused_by_maintenance_gate"
    assert payload["pause"]["reason"] == "planned_report_recovery"
    assert not (queue_dir / "pending.jsonl").exists()
    assert '"event": "enqueue_paused"' in (queue_dir / "events.jsonl").read_text(encoding="utf-8")


def test_worker_skips_already_pending_jobs_blocked_by_maintenance_gate(tmp_path: Path):
    queue_dir = tmp_path / "queue"
    queue_dir.mkdir(parents=True)
    out = tmp_path / "should-not-exist.txt"
    (queue_dir / "pending.jsonl").write_text(
        json.dumps(
            {
                "id": "paused-job-1",
                "name": "youtube-daily-ai-influence-report",
                "created_at": "2026-07-01T00:00:00Z",
                "cwd": str(tmp_path),
                "command": [sys.executable, "-c", f"open({str(out)!r}, 'w').write('ran')"],
                "env": {},
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    (queue_dir / "maintenance-gate.json").write_text(
        json.dumps({"enabled": True, "reason": "recovery", "pause_names": ["youtube-daily-ai-influence-report"]}),
        encoding="utf-8",
    )

    subprocess.run(
        [
            sys.executable,
            str(QUEUE),
            "--queue-dir",
            str(queue_dir),
            "worker",
            "--min-gap-seconds",
            "0",
        ],
        text=True,
        capture_output=True,
        check=True,
    )

    assert not out.exists()
    assert (queue_dir / "pending.jsonl").read_text(encoding="utf-8") == ""
    result = json.loads((queue_dir / "done" / "paused-job-1.json").read_text(encoding="utf-8"))
    assert result["skipped"] is True
    assert result["skip_reason"] == "paused_by_maintenance_gate"
    assert '"event": "dequeue_paused"' in (queue_dir / "events.jsonl").read_text(encoding="utf-8")


def test_worker_clears_stale_running_json_on_startup(tmp_path: Path):
    queue_dir = tmp_path / "queue"
    queue_dir.mkdir(parents=True)
    (queue_dir / "running.json").write_text(
        json.dumps(
            {
                "job_id": "stale-job-1",
                "name": "youtube-daily-ai-influence-report",
                "started_at": "2026-07-01T00:00:00Z",
                "command": [sys.executable, "-c", "print('stale')"],
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    subprocess.run(
        [
            sys.executable,
            str(QUEUE),
            "--queue-dir",
            str(queue_dir),
            "worker",
            "--min-gap-seconds",
            "0",
        ],
        text=True,
        capture_output=True,
        check=True,
    )

    assert not (queue_dir / "running.json").exists()
    result = json.loads((queue_dir / "failed" / "stale-job-1.json").read_text(encoding="utf-8"))
    assert result["rc"] == 124
    assert result["error"] == "stale_running_cleared_on_worker_start"
    assert result["running"]["job_id"] == "stale-job-1"
    assert '"event": "stale_running_cleared"' in (queue_dir / "events.jsonl").read_text(encoding="utf-8")


def test_daily_sla_jobs_dequeue_before_low_priority_backfill(tmp_path: Path):
    queue_dir = tmp_path / "queue"
    out = tmp_path / "order.txt"
    env = os.environ.copy()
    env["BROWSER_AGENT_QUEUE_MIN_GAP_SECONDS"] = "0"

    job_script = tmp_path / "job.py"
    job_script.write_text(
        "import pathlib, sys\n"
        "pathlib.Path(sys.argv[1]).open('a', encoding='utf-8').write(sys.argv[2] + '\\n')\n",
        encoding="utf-8",
    )

    for name in ("youtube-transcript-weekly-backfill", "github-trend-report-daily"):
        subprocess.run(
            [
                sys.executable,
                str(QUEUE),
                "--queue-dir",
                str(queue_dir),
                "enqueue",
                "--name",
                name,
                "--cwd",
                str(tmp_path),
                "--",
                sys.executable,
                str(job_script),
                str(out),
                name,
            ],
            text=True,
            capture_output=True,
            check=True,
            env=env,
        )

    subprocess.run(
        [
            sys.executable,
            str(QUEUE),
            "--queue-dir",
            str(queue_dir),
            "worker",
            "--min-gap-seconds",
            "0",
        ],
        text=True,
        capture_output=True,
        check=True,
        env=env,
    )

    assert out.read_text(encoding="utf-8").splitlines() == [
        "github-trend-report-daily",
        "youtube-transcript-weekly-backfill",
    ]


def test_hf_insight_jobs_dequeue_before_daily_report_retries(tmp_path: Path):
    queue_dir = tmp_path / "queue"
    out = tmp_path / "order.txt"
    env = os.environ.copy()
    env["BROWSER_AGENT_QUEUE_MIN_GAP_SECONDS"] = "0"

    job_script = tmp_path / "job.py"
    job_script.write_text(
        "import pathlib, sys\n"
        "pathlib.Path(sys.argv[1]).open('a', encoding='utf-8').write(sys.argv[2] + '\\n')\n",
        encoding="utf-8",
    )

    for name in (
        "github-trend-report-daily",
        "youtube-daily-ai-influence-report",
        "tech-hotspot-hf-paper-l7-high-reasoning-2602.15763",
        "tech-hotspot-hf-paper-report-section-2026-07-02-inference",
    ):
        subprocess.run(
            [
                sys.executable,
                str(QUEUE),
                "--queue-dir",
                str(queue_dir),
                "enqueue",
                "--name",
                name,
                "--cwd",
                str(tmp_path),
                "--",
                sys.executable,
                str(job_script),
                str(out),
                name,
            ],
            text=True,
            capture_output=True,
            check=True,
            env=env,
        )

    subprocess.run(
        [
            sys.executable,
            str(QUEUE),
            "--queue-dir",
            str(queue_dir),
            "worker",
            "--min-gap-seconds",
            "0",
        ],
        text=True,
        capture_output=True,
        check=True,
        env=env,
    )

    assert out.read_text(encoding="utf-8").splitlines() == [
        "tech-hotspot-hf-paper-l7-high-reasoning-2602.15763",
        "tech-hotspot-hf-paper-report-section-2026-07-02-inference",
        "github-trend-report-daily",
        "youtube-daily-ai-influence-report",
    ]


def test_youtube_daily_collect_dequeues_before_daily_report(tmp_path: Path):
    queue_dir = tmp_path / "queue"
    out = tmp_path / "order.txt"
    env = os.environ.copy()
    env["BROWSER_AGENT_QUEUE_MIN_GAP_SECONDS"] = "0"

    job_script = tmp_path / "job.py"
    job_script.write_text(
        "import pathlib, sys\n"
        "pathlib.Path(sys.argv[1]).open('a', encoding='utf-8').write(sys.argv[2] + '\\n')\n",
        encoding="utf-8",
    )

    for name in (
        "youtube-daily-ai-influence-report",
        "youtube-transcript-weekly-backfill",
        "youtube-daily-previous-day",
    ):
        subprocess.run(
            [
                sys.executable,
                str(QUEUE),
                "--queue-dir",
                str(queue_dir),
                "enqueue",
                "--name",
                name,
                "--cwd",
                str(tmp_path),
                "--",
                sys.executable,
                str(job_script),
                str(out),
                name,
            ],
            text=True,
            capture_output=True,
            check=True,
            env=env,
        )

    subprocess.run(
        [
            sys.executable,
            str(QUEUE),
            "--queue-dir",
            str(queue_dir),
            "worker",
            "--min-gap-seconds",
            "0",
        ],
        text=True,
        capture_output=True,
        check=True,
        env=env,
    )

    assert out.read_text(encoding="utf-8").splitlines() == [
        "youtube-daily-previous-day",
        "youtube-daily-ai-influence-report",
        "youtube-transcript-weekly-backfill",
    ]


def test_deep_insight_solar_jobs_default_to_genesispod_queue(monkeypatch):
    queue = _load_queue_module()

    class Args:
        cmd = "enqueue"
        name = "deep-insight-solar-auth-preflight"
        queue_dir = ""

    monkeypatch.delenv("BROWSER_AGENT_QUEUE_DIR", raising=False)

    assert queue._queue_dir(Args()) == queue.DEFAULT_GENESISPOD_QUEUE_DIR.expanduser()


def test_enqueue_wait_replays_stdout_and_passes_stdin(tmp_path: Path):
    queue_dir = tmp_path / "queue"
    stdin_file = tmp_path / "stdin.txt"
    stdin_file.write_text("hello queue\n", encoding="utf-8")
    env = os.environ.copy()
    env["BROWSER_AGENT_QUEUE_MIN_GAP_SECONDS"] = "0"
    env["BROWSER_AGENT_QUEUE_STDIN_FILE"] = str(stdin_file)

    job_script = tmp_path / "stdin_job.py"
    job_script.write_text(
        "import os, sys\n"
        "text = sys.stdin.read().strip()\n"
        "print(text + ':' + os.environ.get('BROWSER_AGENT_QUEUE_BYPASS', ''))\n",
        encoding="utf-8",
    )

    worker = subprocess.Popen(
        [
            sys.executable,
            str(QUEUE),
            "--queue-dir",
            str(queue_dir),
            "worker",
            "--loop",
            "--idle-sleep-seconds",
            "1",
            "--min-gap-seconds",
            "0",
        ],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    try:
        proc = subprocess.run(
            [
                sys.executable,
                str(QUEUE),
                "--queue-dir",
                str(queue_dir),
                "enqueue",
                "--name",
                "stdin",
                "--cwd",
                str(tmp_path),
                "--wait",
                "--timeout-seconds",
                "30",
                "--replay-logs",
                "--quiet-result",
                "--",
                sys.executable,
                str(job_script),
            ],
            text=True,
            capture_output=True,
            check=True,
            env=env,
            timeout=35,
        )
    finally:
        worker.terminate()
        try:
            worker.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            worker.kill()
            worker.communicate()

    assert proc.stdout.strip() == "hello queue:1"


def test_enqueue_wait_timeout_with_replay_logs_does_not_read_cwd(tmp_path: Path):
    queue_dir = tmp_path / "queue"
    proc = subprocess.run(
        [
            sys.executable,
            str(QUEUE),
            "--queue-dir",
            str(queue_dir),
            "enqueue",
            "--name",
            "timeout",
            "--cwd",
            str(tmp_path),
            "--wait",
            "--timeout-seconds",
            "1",
            "--poll-seconds",
            "0.2",
            "--replay-logs",
            "--",
            sys.executable,
            "-c",
            "print('not run')",
        ],
        text=True,
        capture_output=True,
        check=False,
        timeout=5,
    )

    assert proc.returncode == 124
    assert "IsADirectoryError" not in proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["result"]["error"] == "browser_agent_queue_wait_timeout"


def test_queue_accepts_completion_signal_artifact(tmp_path: Path):
    queue = _load_queue_module()
    request_dir = tmp_path / "request"
    request_dir.mkdir()
    text = "final browser agent answer " * 20
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    (request_dir / "assistant-response.txt").write_text(text, encoding="utf-8")
    (request_dir / "page.json").write_text(
        json.dumps({"login_wall": False, "challenge_wall": False, "is_generating": False}),
        encoding="utf-8",
    )
    (request_dir / "conversation.json").write_text(
        json.dumps({"login_wall": False, "challenge_wall": False, "is_generating": False}),
        encoding="utf-8",
    )
    (request_dir / "completion-signal.json").write_text(
        json.dumps(
            {
                "schema": "browser_agent_completion_signal.v1",
                "status": "completed",
                "login_wall": False,
                "challenge_wall": False,
                "is_generating": False,
                "latest_text_sha256": digest,
                "latest_text_chars": len(text),
            }
        ),
        encoding="utf-8",
    )

    artifact = queue._request_dir_success_artifact(request_dir)

    assert artifact is not None
    assert artifact["reason"] == "completion_signal_ready"
    assert artifact["request_dir"] == str(request_dir)
    assert artifact["latest_text_sha256"] == digest


def test_queue_ignores_stale_blocked_signal_before_job_start(tmp_path: Path):
    queue = _load_queue_module()
    request_dir = tmp_path / "request"
    request_dir.mkdir()
    signal_path = request_dir / "completion-signal.json"
    signal_path.write_text(
        json.dumps(
            {
                "schema": "browser_agent_completion_signal.v1",
                "status": "blocked",
                "reason": "submitted_without_generation",
                "login_wall": False,
                "challenge_wall": False,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    stale_cutoff = signal_path.stat().st_mtime + 1

    assert queue._request_dir_blocked_signal(request_dir, min_mtime=stale_cutoff) is None
    artifact = queue._request_dir_blocked_signal(request_dir, min_mtime=signal_path.stat().st_mtime - 1)

    assert artifact is not None
    assert artifact["reason"] == "submitted_without_generation"


def test_worker_requeues_recoverable_submitted_without_generation_once(tmp_path: Path):
    queue_dir = tmp_path / "queue"
    request_dir = tmp_path / "request"
    request_dir.mkdir()
    marker = tmp_path / "first-attempt.failed"
    env = os.environ.copy()
    env["BROWSER_AGENT_QUEUE_MIN_GAP_SECONDS"] = "0"
    env["BROWSER_AGENT_QUEUE_RECOVERABLE_RETRIES"] = "1"
    env["BROWSER_AGENT_REQUEST_DIR"] = str(request_dir)

    job_script = tmp_path / "recoverable_job.py"
    job_script.write_text(
        "import json, pathlib, sys, time\n"
        "request_dir = pathlib.Path(sys.argv[1])\n"
        "marker = pathlib.Path(sys.argv[2])\n"
        "if not marker.exists():\n"
        "    marker.write_text('failed once', encoding='utf-8')\n"
        "    (request_dir / 'completion-signal.json').write_text(json.dumps({\n"
        "        'schema': 'browser_agent_completion_signal.v1',\n"
        "        'status': 'blocked',\n"
        "        'reason': 'submitted_without_generation',\n"
        "        'login_wall': False,\n"
        "        'challenge_wall': False,\n"
        "        'is_generating': False,\n"
        "    }), encoding='utf-8')\n"
        "    time.sleep(30)\n"
        "print('retry ok')\n",
        encoding="utf-8",
    )

    subprocess.run(
        [
            sys.executable,
            str(QUEUE),
            "--queue-dir",
            str(queue_dir),
            "enqueue",
            "--name",
            "tech-hotspot-hf-paper-l7-high-reasoning-retry-test",
            "--cwd",
            str(tmp_path),
            "--",
            sys.executable,
            str(job_script),
            str(request_dir),
            str(marker),
        ],
        text=True,
        capture_output=True,
        check=True,
        env=env,
    )
    subprocess.run(
        [
            sys.executable,
            str(QUEUE),
            "--queue-dir",
            str(queue_dir),
            "worker",
            "--min-gap-seconds",
            "0",
        ],
        text=True,
        capture_output=True,
        check=True,
        env=env,
        timeout=15,
    )

    assert len(list((queue_dir / "done").glob("*.json"))) == 1
    assert not list((queue_dir / "failed").glob("*.json"))
    retries = list((queue_dir / "retries").glob("*.json"))
    assert len(retries) == 1
    retry_record = json.loads(retries[0].read_text(encoding="utf-8"))
    assert retry_record["reason"] == "submitted_without_generation"
    assert '"event": "recoverable_failure_requeued"' in (queue_dir / "events.jsonl").read_text(encoding="utf-8")


def test_worker_does_not_requeue_login_wall_signal(tmp_path: Path):
    queue_dir = tmp_path / "queue"
    request_dir = tmp_path / "request"
    request_dir.mkdir()
    env = os.environ.copy()
    env["BROWSER_AGENT_QUEUE_MIN_GAP_SECONDS"] = "0"
    env["BROWSER_AGENT_QUEUE_RECOVERABLE_RETRIES"] = "2"
    env["BROWSER_AGENT_REQUEST_DIR"] = str(request_dir)

    job_script = tmp_path / "login_wall_job.py"
    job_script.write_text(
        "import json, pathlib, sys, time\n"
        "request_dir = pathlib.Path(sys.argv[1])\n"
        "(request_dir / 'completion-signal.json').write_text(json.dumps({\n"
        "    'schema': 'browser_agent_completion_signal.v1',\n"
        "    'status': 'blocked',\n"
        "    'reason': 'submitted_without_generation',\n"
        "    'login_wall': True,\n"
        "    'challenge_wall': False,\n"
        "}), encoding='utf-8')\n"
        "time.sleep(30)\n",
        encoding="utf-8",
    )

    subprocess.run(
        [
            sys.executable,
            str(QUEUE),
            "--queue-dir",
            str(queue_dir),
            "enqueue",
            "--name",
            "tech-hotspot-hf-paper-l7-high-reasoning-login-wall",
            "--cwd",
            str(tmp_path),
            "--",
            sys.executable,
            str(job_script),
            str(request_dir),
        ],
        text=True,
        capture_output=True,
        check=True,
        env=env,
    )
    subprocess.run(
        [
            sys.executable,
            str(QUEUE),
            "--queue-dir",
            str(queue_dir),
            "worker",
            "--min-gap-seconds",
            "0",
        ],
        text=True,
        capture_output=True,
        check=True,
        env=env,
        timeout=15,
    )

    assert len(list((queue_dir / "failed").glob("*.json"))) == 1
    assert not list((queue_dir / "retries").glob("*.json"))


def test_worker_requeues_recoverable_log_failure(tmp_path: Path):
    queue_dir = tmp_path / "queue"
    marker = tmp_path / "first-attempt.failed"
    env = os.environ.copy()
    env["BROWSER_AGENT_QUEUE_MIN_GAP_SECONDS"] = "0"
    env["BROWSER_AGENT_QUEUE_RECOVERABLE_RETRIES"] = "1"

    job_script = tmp_path / "recoverable_log_job.py"
    job_script.write_text(
        "import pathlib, sys\n"
        "marker = pathlib.Path(sys.argv[1])\n"
        "if not marker.exists():\n"
        "    marker.write_text('failed once', encoding='utf-8')\n"
        "    print('browser_agent_chatgpt_wrapper failed: TimeoutError: chatgpt_generating_without_output')\n"
        "    raise SystemExit(1)\n"
        "print('retry ok')\n",
        encoding="utf-8",
    )

    subprocess.run(
        [
            sys.executable,
            str(QUEUE),
            "--queue-dir",
            str(queue_dir),
            "enqueue",
            "--name",
            "github-trend-report-daily",
            "--cwd",
            str(tmp_path),
            "--",
            sys.executable,
            str(job_script),
            str(marker),
        ],
        text=True,
        capture_output=True,
        check=True,
        env=env,
    )
    subprocess.run(
        [
            sys.executable,
            str(QUEUE),
            "--queue-dir",
            str(queue_dir),
            "worker",
            "--min-gap-seconds",
            "0",
        ],
        text=True,
        capture_output=True,
        check=True,
        env=env,
    )

    assert len(list((queue_dir / "done").glob("*.json"))) == 1
    assert not list((queue_dir / "failed").glob("*.json"))
    retry_record = json.loads(next((queue_dir / "retries").glob("*.json")).read_text(encoding="utf-8"))
    assert retry_record["reason"] == "chatgpt_generating_without_output"


def test_recoverable_log_failure_matches_empty_assistant_and_browser_start_timeout(tmp_path: Path):
    queue = _load_queue_module()
    stdout = tmp_path / "out.log"
    stderr = tmp_path / "err.log"

    stderr.write_text("browser_agent_chatgpt_wrapper failed: RuntimeError: chatgpt_latest_assistant_text_empty\n", encoding="utf-8")
    ok, reason = queue._recoverable_log_failure({"stdout": str(stdout), "stderr": str(stderr)})
    assert ok is True
    assert reason == "chatgpt_latest_assistant_text_empty"

    stderr.write_text(
        "browser_agent_chatgpt_wrapper failed: TimeoutError: Event handler "
        "browser_use.browser.watchdog_base.BrowserSession.on_BrowserStartEvent#6496 timed out after 30.0s\n",
        encoding="utf-8",
    )
    ok, reason = queue._recoverable_log_failure({"stdout": str(stdout), "stderr": str(stderr)})
    assert ok is True
    assert "browserstartevent" in reason


def test_adaptive_gap_defaults_to_fixed_and_respects_zero(monkeypatch):
    queue = _load_queue_module()
    monkeypatch.delenv("BROWSER_AGENT_QUEUE_ADAPTIVE_GAP", raising=False)

    assert queue._adaptive_gap_seconds({"name": "short"}, {"rc": 0}, 0) == (0, "fixed_gap_disabled")
    assert queue._adaptive_gap_seconds({"name": "short"}, {"rc": 0}, 300) == (300, "fixed_gap")


def test_adaptive_gap_uses_completion_signal(monkeypatch):
    queue = _load_queue_module()
    monkeypatch.setenv("BROWSER_AGENT_QUEUE_ADAPTIVE_GAP", "true")
    monkeypatch.setenv("BROWSER_AGENT_QUEUE_SIGNAL_SUCCESS_GAP_SECONDS", "11")
    result = {
        "rc": 0,
        "duration_s": 12,
        "artifact_watchdog": {"reason": "completion_signal_ready", "completion_signal": "/tmp/signal.json"},
    }

    assert queue._adaptive_gap_seconds({"name": "youtube-daily-ai-influence-report"}, result, 300) == (11, "success_signal")


def test_adaptive_gap_defaults_success_to_30_seconds(monkeypatch):
    queue = _load_queue_module()
    monkeypatch.setenv("BROWSER_AGENT_QUEUE_ADAPTIVE_GAP", "true")
    monkeypatch.delenv("BROWSER_AGENT_QUEUE_SUCCESS_GAP_SECONDS", raising=False)
    monkeypatch.delenv("BROWSER_AGENT_QUEUE_SIGNAL_SUCCESS_GAP_SECONDS", raising=False)

    assert queue._adaptive_gap_seconds({"name": "short"}, {"rc": 0, "duration_s": 12}, 90) == (30, "success")
    assert queue._adaptive_gap_seconds(
        {"name": "short"},
        {
            "rc": 0,
            "duration_s": 12,
            "artifact_watchdog": {"reason": "completion_signal_ready", "completion_signal": "/tmp/signal.json"},
        },
        90,
    ) == (30, "success_signal")
    assert queue._adaptive_gap_seconds({"name": "long"}, {"rc": 0, "duration_s": 999}, 90) == (
        30,
        "long_success",
    )


def test_adaptive_gap_extends_flow_control_cooldown(monkeypatch):
    queue = _load_queue_module()
    monkeypatch.setenv("BROWSER_AGENT_QUEUE_ADAPTIVE_GAP", "true")
    monkeypatch.setenv("BROWSER_AGENT_QUEUE_RATE_LIMIT_GAP_SECONDS", "1800")
    result = {
        "rc": 1,
        "browser_agent_signal_failure": {
            "status": "blocked",
            "reason": "FlowControlBlocked: cooldown",
            "login_wall": False,
            "challenge_wall": False,
        },
    }

    assert queue._adaptive_gap_seconds({"name": "deep-insight-solar-analyst"}, result, 300) == (1800, "rate_limited")
