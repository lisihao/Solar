import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
QUEUE = ROOT / "scripts" / "browser_agent_queue.py"


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
