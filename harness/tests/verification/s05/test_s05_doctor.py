#!/usr/bin/env python3
"""V1 doctor smoke regression verification."""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

import pytest


RUNTIME_ROOT = Path(__file__).resolve().parents[3]
EVIDENCE_PATH = RUNTIME_ROOT / "runtime" / "s05-verification-release" / "L1-doctor.json"


def _run_json_command(command: list[str]) -> dict:
    start = time.perf_counter()
    proc = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )
    elapsed = (time.perf_counter() - start) * 1000

    parsed = None
    if proc.returncode == 0:
        try:
            parsed = json.loads(proc.stdout)
        except json.JSONDecodeError:
            parsed = None

    return {
        "command": command,
        "return_code": proc.returncode,
        "duration_ms": round(elapsed, 2),
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "json": parsed,
    }


def _pick_ua_health_key(data: dict) -> str | None:
    expected = (
        "artifacts",
        "artifact_health",
        "health",
        "understanding_artifacts",
        "understanding_artifact_health",
    )
    for key in expected:
        if key in data:
            return key
    return None


def test_v1_doctor_unit_smoke_regression():
    commands = {
        "mirage_doctor": ["./solar-harness.sh", "mirage", "doctor", "--json"],
        "coco_doctor": ["./solar-harness.sh", "coco", "doctor", "--json"],
        "ua_doctor": ["./solar-harness.sh", "ua", "doctor", "--json"],
    }

    command_reports = {}
    fail_reasons: list[str] = []

    for name, cmd in commands.items():
        report = _run_json_command(cmd)
        command_reports[name] = {
            "command": " ".join(cmd),
            "return_code": report["return_code"],
            "duration_ms": report["duration_ms"],
            "stdout_preview": (report["stdout"] or "")[:1200],
            "stderr_preview": (report["stderr"] or "")[:1200],
            "json_available": report["json"] is not None,
        }

    runtime_test = subprocess.run(
        [
            "python3",
            "-m",
            "pytest",
            "tests/runtime/test_mirage_context_access_plane.py",
            "-q",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    mirage = command_reports["mirage_doctor"]
    coco_report = command_reports["coco_doctor"]
    ua_report = command_reports["ua_doctor"]

    # Parsed payload snapshots kept in evidence for downstream checks.
    parsed_payloads = {
        "mirage_doctor": _run_json_command(commands["mirage_doctor"]) if mirage["return_code"] == 0 else None,
    }
    parsed_payloads["coco_doctor"] = _run_json_command(commands["coco_doctor"]) if coco_report["return_code"] == 0 else None
    parsed_payloads["ua_doctor"] = _run_json_command(commands["ua_doctor"]) if ua_report["return_code"] == 0 else None

    # Runtime/functional assertions are separated from evidence write so evidence always lands.
    try:
        if mirage["return_code"] != 0:
            fail_reasons.append(f"mirage doctor exited {mirage['return_code']}")
        elif not parsed_payloads["mirage_doctor"]["json"]:
            fail_reasons.append("mirage doctor output is not valid JSON")
        elif "sdk_decision" not in parsed_payloads["mirage_doctor"]["json"]:
            fail_reasons.append("mirage doctor missing sdk_decision")

        if coco_report["return_code"] != 0:
            fail_reasons.append(f"coco doctor exited {coco_report['return_code']}")
        elif not parsed_payloads["coco_doctor"]["json"]:
            fail_reasons.append("coco doctor output is not valid JSON")
        else:
            coco_json = parsed_payloads["coco_doctor"]["json"]
            for key in ("last_update_at", "stale_sources", "lineage_ok"):
                if key not in coco_json:
                    fail_reasons.append(f"coco doctor missing field: {key}")

        if ua_report["return_code"] != 0:
            fail_reasons.append(f"ua doctor exited {ua_report['return_code']}")
        elif not parsed_payloads["ua_doctor"]["json"]:
            fail_reasons.append("ua doctor output is not valid JSON")
        else:
            health_key = _pick_ua_health_key(parsed_payloads["ua_doctor"]["json"])
            if not health_key:
                fail_reasons.append(
                    "ua doctor missing understanding-artifact health key "
                    "(artifacts/artifact_health/health/understanding_artifacts/understanding_artifact_health)"
                )

        if runtime_test.returncode != 0:
            fail_reasons.append("tests/runtime/test_mirage_context_access_plane.py did not pass")

        if fail_reasons:
            pytest.fail("; ".join(fail_reasons))
    finally:
        # always persist evidence for evaluator traceability
        exit_codes = {
            "mirage_doctor": mirage["return_code"],
            "coco_doctor": coco_report["return_code"],
            "ua_doctor": ua_report["return_code"],
            "runtime_test": runtime_test.returncode,
        }

        evidence = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "commands": command_reports,
            "exit_codes": exit_codes,
            "degraded": {
                "mirage_doctor": mirage["return_code"] != 0,
                "coco_doctor": coco_report["return_code"] != 0,
                "ua_doctor": ua_report["return_code"] != 0,
                "runtime_test": runtime_test.returncode != 0,
            },
            "sdk_decision": None,
            "verification": {
                "runtime_test_command": "python3 -m pytest tests/runtime/test_mirage_context_access_plane.py -q",
                "runtime_test_exit_code": runtime_test.returncode,
                "runtime_test_passed": runtime_test.returncode == 0,
            },
            "pytest_runtime_test": {
                "command": "python3 -m pytest tests/runtime/test_mirage_context_access_plane.py -q",
                "exit_code": runtime_test.returncode,
                "stdout_preview": (runtime_test.stdout or "")[:1200],
                "stderr_preview": (runtime_test.stderr or "")[:1200],
            },
            "degraded_markers": {
                "mirage_doctor": parsed_payloads["mirage_doctor"] if mirage["return_code"] == 0 else None,
                "coco_doctor": parsed_payloads["coco_doctor"] if coco_report["return_code"] == 0 else None,
                "ua_doctor": parsed_payloads["ua_doctor"] if ua_report["return_code"] == 0 else None,
            },
            "fail_reasons": fail_reasons,
        }

        if parsed_payloads["mirage_doctor"] and parsed_payloads["mirage_doctor"].get("json"):
            evidence["sdk_decision"] = parsed_payloads["mirage_doctor"]["json"].get("sdk_decision")
        else:
            evidence["sdk_decision"] = None

        EVIDENCE_PATH.parent.mkdir(parents=True, exist_ok=True)
        EVIDENCE_PATH.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
