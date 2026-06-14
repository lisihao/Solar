#!/usr/bin/env python3
"""Run a Solar PM dispatch through Codex CLI non-interactively."""
from __future__ import annotations

import os
import json
import re
import shlex
import signal
import subprocess
import sys
import time
from pathlib import Path


def _read_dispatch() -> str:
    dispatch_file = os.environ.get("DISPATCH_FILE") or os.environ.get("SOLAR_MULTI_TASK_DISPATCH_FILE")
    if dispatch_file:
        path = Path(dispatch_file).expanduser()
        if path.exists():
            return path.read_text(encoding="utf-8", errors="replace")
    return sys.stdin.read()


def _write_pm_result(task_dir: Path, output_file: Path, output: str, exit_code: int) -> None:
    result_path = os.environ.get("PM_RESULT_PATH") or os.environ.get("RESULT_PATH")
    if not result_path:
        return
    path = Path(result_path).expanduser()
    if path.exists() and path.stat().st_size > 0:
        return
    text = output.strip()
    if not text and output_file.exists():
        text = output_file.read_text(encoding="utf-8", errors="replace").strip()
    if len(text) > 20000:
        text = text[:20000] + "\n\n[truncated]"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        (
            f"# PM Task Result — {os.environ.get('TASK_ID', 'codex-operator')}\n\n"
            "## 已完成\n"
            "- Codex CLI command backend 已执行 PM dispatch。\n\n"
            "## 已验证\n"
            f"- codex exec exit_code={exit_code}。\n"
            f"- output_file={output_file}\n"
            f"- task_dir={task_dir}\n\n"
            "## 结论摘要\n"
            f"{text or 'N/A'}\n\n"
            "## 风险/限制\n"
            "- 该结果由 Codex wrapper 从最后消息/stdout 转写；仍需 evaluator 复核真实文件修改和测试证据。\n\n"
            "## 后续建议\n"
            "- 按 dispatch Definition of Done 复核文件变更、命令输出和测试证据。\n"
        ),
        encoding="utf-8",
    )


def _timeout_seconds() -> float:
    raw = (
        os.environ.get("CODEX_OPERATOR_TIMEOUT_SECONDS")
        or os.environ.get("SOLAR_CODEX_OPERATOR_TIMEOUT_SECONDS")
        or "900"
    )
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 900.0


def _pm_result_ready(started_wall: float) -> bool:
    result_path = os.environ.get("PM_RESULT_PATH") or os.environ.get("RESULT_PATH")
    if not result_path:
        return False
    path = Path(result_path).expanduser()
    try:
        return path.exists() and path.stat().st_size > 0 and path.stat().st_mtime >= started_wall
    except OSError:
        return False


def _pm_result_path() -> Path | None:
    result_path = os.environ.get("PM_RESULT_PATH") or os.environ.get("RESULT_PATH")
    if not result_path:
        return None
    return Path(result_path).expanduser()


_ABS_EVAL_ARTIFACT_RE = re.compile(r"(/[^`'\"\s]+-eval\.(?:md|json))")
_ABS_EVAL_DISPATCH_RE = re.compile(r"(/[^`'\"\s]+-eval-dispatch[^`'\"\s]*\.md)")


def _required_eval_artifacts(dispatch: str) -> list[Path]:
    """Extract explicit eval sidecar outputs from graph-eval dispatch text."""
    artifacts: list[Path] = []
    seen: set[str] = set()
    texts = [dispatch]
    for match in _ABS_EVAL_DISPATCH_RE.finditer(dispatch):
        path = Path(match.group(1).strip())
        try:
            if path.exists() and path.is_file():
                texts.append(path.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            continue
    for text in texts:
        for match in _ABS_EVAL_ARTIFACT_RE.finditer(text):
            raw = match.group(1).strip()
            if raw in seen:
                continue
            seen.add(raw)
            artifacts.append(Path(raw))
    return artifacts


def _artifacts_ready(paths: list[Path], started_wall: float) -> bool:
    if not paths:
        return True
    for path in paths:
        try:
            if not path.exists() or path.stat().st_size <= 0:
                return False
            if path.stat().st_mtime < started_wall:
                return False
        except OSError:
            return False
    return True


def _missing_artifacts(paths: list[Path], started_wall: float) -> list[str]:
    missing: list[str] = []
    for path in paths:
        try:
            if not path.exists() or path.stat().st_size <= 0:
                missing.append(str(path))
                continue
            if path.stat().st_mtime < started_wall:
                missing.append(str(path))
        except OSError:
            missing.append(str(path))
    return missing


def _verdict_from_pm_result(text: str) -> str:
    upper = text.upper()
    negative_markers = (
        "NOT ACCEPTABLE",
        "UNACCEPTABLE",
        "## 总判定: FAIL",
        "VERDICT: FAIL",
        '"VERDICT": "FAIL"',
        "判定：FAIL",
        "判定: FAIL",
    )
    positive_markers = (
        "ACCEPTABLE AS FRESH REPAIR PACKAGE",
        "## 总判定: PASS",
        "VERDICT: PASS",
        '"VERDICT": "PASS"',
        "判定：PASS",
        "判定: PASS",
    )
    if any(marker in upper for marker in negative_markers):
        return "FAIL"
    if any(marker in upper for marker in positive_markers):
        return "PASS"
    return "FAIL"


def _synthesize_eval_sidecars_from_pm_result(paths: list[Path], started_wall: float) -> bool:
    """Backfill graph-eval sidecars from an evaluator PM result.

    This is deliberately conservative: it only runs after the evaluator has
    written a fresh PM result, preserves the PM result text verbatim in eval.md,
    and marks eval.json as generated_from_pm_result so downstream audit can see
    the fallback.
    """
    if not paths:
        return False
    result_path = _pm_result_path()
    if result_path is None:
        return False
    try:
        if not result_path.exists() or result_path.stat().st_size <= 0:
            return False
        if result_path.stat().st_mtime < started_wall:
            return False
        pm_text = result_path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return False
    if not pm_text:
        return False

    eval_md_paths = [path for path in paths if path.suffix == ".md"]
    eval_json_paths = [path for path in paths if path.suffix == ".json"]
    verdict = _verdict_from_pm_result(pm_text)
    task_id = os.environ.get("TASK_ID", "")
    sprint_id = os.environ.get("SID", "")
    node_id = os.environ.get("NODE_ID", "")

    for path in eval_md_paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            (
                f"# Eval Sidecar — {task_id or path.stem}\n\n"
                "@GENERATED_FROM_PM_RESULT\n\n"
                "The evaluator wrote the PM result but did not materialize the "
                "required graph eval markdown sidecar. This file preserves the "
                "fresh PM result verbatim for machine closeout.\n\n"
                f"{pm_text}\n"
            ),
            encoding="utf-8",
        )

    eval_md_name = eval_md_paths[0].name if eval_md_paths else ""
    payload = {
        "sprint_id": sprint_id,
        "node_id": node_id,
        "round": 1,
        "verdict": verdict,
        "failed_conditions": [] if verdict == "PASS" else ["PM_RESULT_INCONCLUSIVE"],
        "passed_conditions": ["PM_RESULT_EVALUATOR_VERDICT"] if verdict == "PASS" else [],
        "errors": [] if verdict == "PASS" else [
            {
                "cond": "PM_RESULT_INCONCLUSIVE",
                "severity": "high",
                "evidence": "PM result did not contain a clear PASS marker.",
                "fix_hint": "Write explicit eval.md/eval.json or rerun evaluator.",
            }
        ],
        "tokens_used": 0,
        "eval_md_path": eval_md_name,
        "verify_all_invoked": False,
        "verify_all_verdict": "SKIPPED",
        "generated_from_pm_result": True,
        "pm_result_path": str(result_path),
    }
    for path in eval_json_paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return _artifacts_ready(paths, started_wall)


def _terminate_process_group(proc: subprocess.Popen[str]) -> None:
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except Exception:
        try:
            proc.terminate()
        except Exception:
            return


def _build_codex_exec_cmd(model: str, effort: str, cwd: str, output_file: Path) -> list[str]:
    return [
        "codex",
        "exec",
        "--ignore-user-config",
        "--skip-git-repo-check",
        "--config",
        "service_tier=fast",
        "--model",
        model,
        "--config",
        f"model_reasoning_effort={effort}",
        "--dangerously-bypass-approvals-and-sandbox",
        "--cd",
        cwd,
        "--output-last-message",
        str(output_file),
        "-",
    ]


def main() -> int:
    dispatch = _read_dispatch().strip()
    if not dispatch:
        print("ERROR: empty dispatch for Codex operator", file=sys.stderr)
        return 64
    required_eval_artifacts = _required_eval_artifacts(dispatch)

    task_dir = Path(os.environ.get("TASK_DIR") or ".").expanduser()
    task_dir.mkdir(parents=True, exist_ok=True)
    output_file = task_dir / "codex-last-message.md"
    model = os.environ.get("CODEX_MODEL", "gpt-5.5").strip() or "gpt-5.5"
    effort = os.environ.get("CODEX_REASONING_EFFORT", "medium").strip() or "medium"
    cwd = os.environ.get("CODEX_WORKDIR") or os.environ.get("WORK_DIR") or os.getcwd()

    cmd = _build_codex_exec_cmd(model, effort, cwd, output_file)
    timeout_seconds = _timeout_seconds()
    pm_result_grace = float(os.environ.get("CODEX_PM_RESULT_GRACE_SECONDS", "20"))
    print("codex_operator: invoking " + " ".join(shlex.quote(part) for part in cmd[:-1]) + " <dispatch>")
    cli_log = task_dir / "codex-cli-output.log"
    started = time.monotonic()
    started_wall = time.time()
    with open(cli_log, "w", encoding="utf-8") as log_f:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=log_f,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=True,
        )
        try:
            assert proc.stdin is not None
            proc.stdin.write(dispatch)
            proc.stdin.close()
        except BrokenPipeError:
            pass

        pm_ready_since: float | None = None
        while True:
            if proc.poll() is not None:
                break
            elapsed = time.monotonic() - started
            if _pm_result_ready(started_wall) and (
                _artifacts_ready(required_eval_artifacts, started_wall)
                or _synthesize_eval_sidecars_from_pm_result(required_eval_artifacts, started_wall)
            ):
                pm_ready_since = pm_ready_since or time.monotonic()
                if (time.monotonic() - pm_ready_since) >= pm_result_grace:
                    print(
                        f"codex_operator: PM result ready; terminating lingering codex exec after {pm_result_grace:.0f}s grace"
                    )
                    _terminate_process_group(proc)
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        try:
                            os.killpg(proc.pid, signal.SIGKILL)
                        except Exception:
                            proc.kill()
                        proc.wait(timeout=5)
                    return 0
            if timeout_seconds > 0 and elapsed >= timeout_seconds:
                _terminate_process_group(proc)
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except Exception:
                        proc.kill()
                    proc.wait(timeout=5)
                combined = cli_log.read_text(encoding="utf-8", errors="replace") if cli_log.exists() else ""
                combined = "\n".join(
                    part
                    for part in [
                        combined,
                        f"ERROR: codex exec timed out after {elapsed:.1f}s",
                    ]
                    if part
                )
                print(combined, file=sys.stderr)
                _write_pm_result(task_dir, output_file, combined, 124)
                return 124
            time.sleep(1)

    combined = cli_log.read_text(encoding="utf-8", errors="replace") if cli_log.exists() else ""
    if combined:
        print(combined, end="" if combined.endswith("\n") else "\n")
    if _pm_result_ready(started_wall):
        _synthesize_eval_sidecars_from_pm_result(required_eval_artifacts, started_wall)
    missing_artifacts = _missing_artifacts(required_eval_artifacts, started_wall)
    if proc.returncode == 0 and missing_artifacts:
        print(
            "ERROR: codex graph eval finished without required sidecar artifacts: "
            + ", ".join(missing_artifacts),
            file=sys.stderr,
        )
        return 68
    if proc.returncode == 0:
        _write_pm_result(task_dir, output_file, combined, int(proc.returncode))
    return int(proc.returncode or 0)


if __name__ == "__main__":
    raise SystemExit(main())
