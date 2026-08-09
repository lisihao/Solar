from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "sync-harness-runtime.sh"


def _run(*args: str, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(SCRIPT), *args],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)


@pytest.fixture()
def runtime_fixture(tmp_path: Path) -> tuple[Path, Path, dict[str, str]]:
    if not shutil.which("git") or not shutil.which("rsync") or not shutil.which("shasum"):
        pytest.skip("runtime sync test requires git, rsync, and shasum")

    repo = tmp_path / "Solar"
    harness = repo / "harness"
    runtime = tmp_path / "solar-home" / "harness"
    (harness / "lib").mkdir(parents=True)
    (harness / "run").mkdir()
    (runtime / "lib").mkdir(parents=True)
    (runtime / "run").mkdir()

    (harness / "lib" / "existing.py").write_text("new\n", encoding="utf-8")
    (harness / "lib" / "created.py").write_text("created\n", encoding="utf-8")
    (harness / "lib" / "untracked.py").write_text("do not deploy\n", encoding="utf-8")
    (harness / "run" / "tracked-runtime.txt").write_text("do not deploy\n", encoding="utf-8")
    (harness / "solar-harness.sh").write_text("#!/bin/bash\necho ok\n", encoding="utf-8")
    (runtime / "lib" / "existing.py").write_text("old\n", encoding="utf-8")
    (runtime / "lib" / "local-extension.py").write_text("keep\n", encoding="utf-8")
    (runtime / "run" / "queue.json").write_text("runtime-state\n", encoding="utf-8")

    _git(repo, "init")
    _git(repo, "config", "user.name", "Solar Test")
    _git(repo, "config", "user.email", "solar-test@example.invalid")
    _git(repo, "add", "harness/lib/existing.py", "harness/lib/created.py", "harness/run/tracked-runtime.txt", "harness/solar-harness.sh")
    _git(repo, "commit", "-m", "fixture")

    env = os.environ.copy()
    env.update(
        {
            "SOLAR_DIR": str(repo),
            "SOLAR_HOME": str(tmp_path / "solar-home"),
            "HARNESS_BACKUP_ROOT": str(tmp_path / "backups"),
        }
    )
    return repo, runtime, env


def test_tracked_deploy_preserves_runtime_and_supports_verified_rollback(
    runtime_fixture: tuple[Path, Path, dict[str, str]],
) -> None:
    _, runtime, env = runtime_fixture

    result = _run(env=env)
    assert result.returncode == 0, result.stderr
    assert "deployment=ok" in result.stdout
    assert (runtime / "lib" / "existing.py").read_text(encoding="utf-8") == "new\n"
    assert (runtime / "lib" / "created.py").read_text(encoding="utf-8") == "created\n"
    assert not (runtime / "lib" / "untracked.py").exists()
    assert (runtime / "lib" / "local-extension.py").read_text(encoding="utf-8") == "keep\n"
    assert (runtime / "run" / "queue.json").read_text(encoding="utf-8") == "runtime-state\n"
    assert not (runtime / "run" / "tracked-runtime.txt").exists()
    assert "source_commit=" in (runtime / ".runtime-source").read_text(encoding="utf-8")

    backup_line = next(line for line in result.stdout.splitlines() if line.startswith("backup="))
    backup = Path(backup_line.split("=", 1)[1])
    rollback = _run("--rollback", str(backup), env=env)
    assert rollback.returncode == 0, rollback.stderr
    assert "rollback=ok" in rollback.stdout
    assert (runtime / "lib" / "existing.py").read_text(encoding="utf-8") == "old\n"
    assert not (runtime / "lib" / "created.py").exists()
    assert (runtime / "lib" / "local-extension.py").read_text(encoding="utf-8") == "keep\n"
    assert (runtime / "run" / "queue.json").read_text(encoding="utf-8") == "runtime-state\n"


def test_dirty_tracked_harness_is_rejected(
    runtime_fixture: tuple[Path, Path, dict[str, str]],
) -> None:
    repo, runtime, env = runtime_fixture
    before = (runtime / "lib" / "existing.py").read_text(encoding="utf-8")
    (repo / "harness" / "lib" / "existing.py").write_text("dirty\n", encoding="utf-8")

    result = _run(env=env)
    assert result.returncode == 3
    assert "refusing to deploy dirty tracked harness files" in result.stderr
    assert (runtime / "lib" / "existing.py").read_text(encoding="utf-8") == before


def test_dry_run_does_not_mutate_runtime(
    runtime_fixture: tuple[Path, Path, dict[str, str]],
) -> None:
    _, runtime, env = runtime_fixture

    result = _run("--dry-run", env=env)
    assert result.returncode == 0, result.stderr
    assert "dry_run=ok" in result.stdout
    assert (runtime / "lib" / "existing.py").read_text(encoding="utf-8") == "old\n"
    assert not (runtime / ".runtime-source").exists()
