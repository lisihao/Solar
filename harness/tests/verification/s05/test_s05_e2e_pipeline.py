#!/usr/bin/env python3
"""V3 E2E pipeline verification: search -> unified-context -> inject -> verifier."""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path
import sys

import pytest


HARNESS_DIR = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(HARNESS_DIR / "lib"))

from mirage_search import unified_search
from runtime_context_inject import inject
from verifier.context_usage import verify_sidecar_file


EVIDENCE_DIR = HARNESS_DIR / "runtime" / "s05-verification-release"
SEARCH_QUERY = "solar harness mirage context"
SPRINT_PREFIX = (
    "sprint-20260530-请为-solar-harness-开一个新的-p0-架构升级单-主题是-把-mirage-从统一-vfs-wrapper-"
    "s05-verification-release"
)
DISPATCH_FILE = HARNESS_DIR / "sprints" / f"{SPRINT_PREFIX}.s05-fixture.dispatch.md"
SEARCH_ARTIFACT = EVIDENCE_DIR / "e2e-search.json"
SIDECAR_ARTIFACT = EVIDENCE_DIR / "e2e-sidecar.json"
VERIFIER_ARTIFACT = EVIDENCE_DIR / "e2e-verifier.json"
PIPELINE_EVIDENCE = EVIDENCE_DIR / "L3-e2e.json"


def _run_json_command(command: list[str]) -> dict:
    start = time.perf_counter()
    proc = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )
    elapsed_ms = round((time.perf_counter() - start) * 1000, 2)

    payload = None
    if proc.returncode == 0:
        try:
            payload = json.loads(proc.stdout)
        except json.JSONDecodeError:
            payload = None

    return {
        "command": command,
        "return_code": proc.returncode,
        "duration_ms": elapsed_ms,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "json": payload,
    }


def _pick_dispatch_path() -> Path:
    if DISPATCH_FILE.exists():
        return DISPATCH_FILE
    candidates = sorted((HARNESS_DIR / "sprints").glob(f"*{SPRINT_PREFIX}*.s05-fixture.dispatch.md"))
    if not candidates:
        raise FileNotFoundError(f"fixture dispatch not found for {SPRINT_PREFIX}")
    return candidates[0]


def _write_evidence(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def test_v3_integration_e2e_pipeline() -> None:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    fail_reasons: list[str] = []
    pipeline_steps: list[dict] = []

    step1: dict = {"name": "mirage_search", "artifact": str(SEARCH_ARTIFACT), "return_code": 0}
    step2: dict = {"name": "unified_context", "artifact": "stdout-json", "return_code": 0}
    step3: dict = {"name": "runtime_context_inject", "artifact": str(SIDECAR_ARTIFACT), "return_code": 0}
    step4: dict = {"name": "context_usage_verifier", "artifact": str(VERIFIER_ARTIFACT), "return_code": 0}

    try:
        search_result = unified_search(SEARCH_QUERY, max_hits=10)
        SEARCH_ARTIFACT.write_text(json.dumps(search_result, ensure_ascii=False, indent=2), encoding="utf-8")
        step1["search_result_hits"] = len(search_result.get("hits", []))
        step1["search_sources"] = sorted(set((search_result.get("source_counts", {}) or {}).keys()))
    except Exception as exc:
        step1["return_code"] = 1
        step1["error"] = f"{type(exc).__name__}: {exc}"
        fail_reasons.append(f"mirage_search failed: {step1['error']}")
        search_result = {}
    finally:
        pipeline_steps.append(step1)

    unified_ctx = _run_json_command(
        [
            str(sys.executable),
            str(HARNESS_DIR / "lib" / "solar-unified-context.py"),
            "--query",
            SEARCH_QUERY,
            "--max-hits",
            "10",
            "--json",
        ]
    )
    step2["return_code"] = unified_ctx["return_code"]
    if unified_ctx["return_code"] != 0:
        fail_reasons.append(f"unified_context cli failed: code={unified_ctx['return_code']}")
    if unified_ctx["json"] is None:
        fail_reasons.append("unified_context cli output is not valid JSON")
    step2["json_hits"] = len((unified_ctx.get("json") or {}).get("hits", []))
    step2["degraded_sources"] = (unified_ctx.get("json") or {}).get("degraded_sources", [])
    pipeline_steps.append(step2)

    try:
        dispatch_path = _pick_dispatch_path()
        sidecar = inject(
            dispatch_path,
            session_id="s05-e2e-pipeline",
            pane="operator-pool:builder",
            dispatch_id="V3_integration_e2e_pipeline",
            query=SEARCH_QUERY,
        )
        _write_evidence(SIDECAR_ARTIFACT, sidecar)
        step3["sidecar_version"] = sidecar.get("sidecar_version")
        step3["context_sources"] = sorted(sidecar.get("context_sources", {}).keys())
    except Exception as exc:
        step3["return_code"] = 1
        step3["error"] = f"{type(exc).__name__}: {exc}"
        fail_reasons.append(f"runtime_context_inject failed: {step3['error']}")
        sidecar_payload = None
    finally:
        pipeline_steps.append(step3)

    try:
        if step3["return_code"] == 0:
            verify_result = verify_sidecar_file(SIDECAR_ARTIFACT)
            _write_evidence(VERIFIER_ARTIFACT, verify_result)
            step4["result"] = verify_result
            if not verify_result.get("ok", False):
                fail_reasons.append(f"context_usage verify failed: {verify_result}")
        else:
            step4["return_code"] = 1
            step4["error"] = "skip_verifier_due_to_inject_failure"
    except Exception as exc:
        step4["return_code"] = 1
        step4["error"] = f"{type(exc).__name__}: {exc}"
        fail_reasons.append(f"context_usage verifier failed: {step4['error']}")
    finally:
        pipeline_steps.append(step4)

    pipeline_summary = {
        "pipeline_name": "V3_integration_e2e_pipeline",
        "query": SEARCH_QUERY,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "steps": pipeline_steps,
        "step_exit_codes": {s["name"]: s["return_code"] for s in pipeline_steps},
        "search_json": SEARCH_ARTIFACT.as_posix(),
        "sidecar_json": SIDECAR_ARTIFACT.as_posix(),
        "verifier_json": VERIFIER_ARTIFACT.as_posix(),
    }
    _write_evidence(PIPELINE_EVIDENCE, pipeline_summary)

    if fail_reasons:
        pytest.fail("; ".join(fail_reasons))
