#!/usr/bin/env python3
"""GenesisPod sidecar verifier bridge for Solar-Harness.

Phase 1 deliberately keeps GenesisPod as an isolated TS/Jest runtime and maps
its results into Solar's verifier report schema. It does not replace the
existing deterministic verifier or IR/proof-obligation checks.
"""

from __future__ import annotations

import argparse
import datetime as dt
import fnmatch
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any


SCHEMA_VERSION = "solar.verifier.result.v1"
PLUGIN_NAME = "genesis-verifier"
DEFAULT_GATE_MODE = "warn"

HERE = Path(__file__).resolve()
HARNESS_DIR = HERE.parents[1]


def discover_git_root(start: Path) -> str | None:
    try:
        proc = subprocess.run(
            ["git", "-C", str(start), "rev-parse", "--show-toplevel"],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except Exception:
        return None
    if proc.returncode == 0 and proc.stdout.strip():
        return proc.stdout.strip()
    return None


REPO_ROOT = Path(
    os.environ.get("SOLAR_REPO_ROOT")
    or discover_git_root(Path.cwd())
    or discover_git_root(HERE)
    or str(HERE.parents[2])
).resolve()
PLUGIN_DIR = HARNESS_DIR / "plugins" / PLUGIN_NAME
DEFAULT_VENDOR_DIR = PLUGIN_DIR / "vendor" / "GenesisPod"
DEFAULT_REPORT_DIR = REPO_ROOT / "reports" / "verifier"
DEFAULT_WAIVERS = HARNESS_DIR / "verifier" / "waivers.yaml"
DEFAULT_EXCEPTIONS = REPO_ROOT / "docs" / "architecture" / "EXCEPTIONS.md"
DEFAULT_BASELINE_DIR = HARNESS_DIR / "verifier" / "baselines"
DEFAULT_POLICY = HARNESS_DIR / "verifier" / "genesis-policy.yaml"
BASELINE_FILE = "genesis-ci-baseline.json"

SELECTED_JEST_SPECS = [
    "src/__tests__/architecture/layer-1-topology/layer-boundaries.spec.ts",
    "src/__tests__/architecture/layer-4-vocabulary/vocab-purity.spec.ts",
    "src/__tests__/architecture/layer-6-durability/projector-purity.spec.ts",
    "src/__tests__/architecture/layer-7-uplift-gate/harness-uplift-gate.spec.ts",
]

RULES: dict[str, dict[str, str]] = {
    "genesis.arch.layer_boundaries": {
        "severity": "warn",
        "source": "backend/src/__tests__/architecture/layer-1-topology/layer-boundaries.spec.ts",
        "remediation": "Keep domain layers one-way and move cross-layer calls behind adapters or ports.",
        "trigger": "GenesisPod layer boundary Jest spec failure.",
    },
    "genesis.vocab.purity": {
        "severity": "warn",
        "source": "backend/src/__tests__/architecture/layer-4-vocabulary/vocab-purity.spec.ts",
        "remediation": "Move impure vocabulary terms into the allowed glossary or rename them to the Solar control-plane vocabulary.",
        "trigger": "GenesisPod vocabulary purity spec failure.",
    },
    "genesis.session.projector_purity": {
        "severity": "warn",
        "source": "backend/src/__tests__/architecture/layer-6-durability/projector-purity.spec.ts",
        "remediation": "Keep projectors deterministic and side-effect free; push IO into command handlers.",
        "trigger": "GenesisPod projector purity spec failure.",
    },
    "genesis.arch.harness_uplift_gate": {
        "severity": "warn",
        "source": "backend/src/__tests__/architecture/layer-7-uplift-gate/harness-uplift-gate.spec.ts",
        "remediation": "Document or implement the uplift path before promoting harness-facing changes.",
        "trigger": "GenesisPod diff-aware uplift gate spec failure.",
    },
    "genesis.waiver.exception_registry": {
        "severity": "warn",
        "source": "docs/architecture/EXCEPTIONS.md + harness/verifier/waivers.yaml",
        "remediation": "Register every waiver in both the machine waiver file and the human exception register, with an expiry date.",
        "trigger": "Solar-side exception registry consistency check.",
    },
    "genesis.contract.baseline_ratchet": {
        "severity": "warn",
        "source": "harness/verifier/baselines/",
        "remediation": "Create or refresh the verifier baseline through an explicit ratchet change; CI only checks drift in phase 1.",
        "trigger": "Solar-side baseline contract check.",
    },
}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


def display_path(path: Path) -> str:
    for root in (REPO_ROOT, HARNESS_DIR, HERE.parents[2]):
        try:
            return str(path.resolve().relative_to(root.resolve()))
        except ValueError:
            continue
    return str(path)


def source_commit(vendor_dir: Path) -> str:
    commit_file = vendor_dir.parent / "SOURCE_COMMIT"
    if commit_file.exists():
        return commit_file.read_text(encoding="utf-8").strip()
    try:
        out = subprocess.run(
            ["git", "-C", str(vendor_dir), "rev-parse", "HEAD"],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except Exception:
        return "unknown"
    return out.stdout.strip() or "unknown"


def make_result(
    rule_id: str,
    *,
    status: str,
    message: str,
    path: str = "N/A",
    source: str | None = None,
    trigger: str | None = None,
    remediation: str | None = None,
    waiver_status: str = "not_applicable",
    severity: str | None = None,
    detail: dict[str, Any] | None = None,
) -> dict[str, Any]:
    rule = RULES.get(rule_id, {})
    return {
        "rule_id": rule_id,
        "status": status,
        "severity": severity or rule.get("severity", "warn"),
        "path": path,
        "message": message,
        "remediation": remediation or rule.get("remediation", "N/A"),
        "waiver_status": waiver_status,
        "trigger": trigger or rule.get("trigger", "N/A"),
        "source": source or rule.get("source", "solar-side"),
        "detail": detail or {},
    }


def rule_for_path(test_path: str, ancestor_titles: list[str] | None = None) -> str:
    haystack = " ".join([test_path, *(ancestor_titles or [])]).lower()
    if "vocab" in haystack:
        return "genesis.vocab.purity"
    if "projector" in haystack:
        return "genesis.session.projector_purity"
    if "uplift" in haystack:
        return "genesis.arch.harness_uplift_gate"
    if "exception" in haystack or "waiver" in haystack:
        return "genesis.waiver.exception_registry"
    if "baseline" in haystack or "ratchet" in haystack:
        return "genesis.contract.baseline_ratchet"
    return "genesis.arch.layer_boundaries"


def adapt_jest_json(raw: dict[str, Any]) -> list[dict[str, Any]]:
    """Map Jest JSON output into stable Solar rule results."""
    results: list[dict[str, Any]] = []
    passed_rules: set[str] = set()
    for suite in raw.get("testResults", []) or []:
        test_path = str(suite.get("name") or suite.get("testFilePath") or "N/A")
        assertions = suite.get("assertionResults") or []
        suite_failed = False
        for assertion in assertions:
            status = assertion.get("status")
            if status in {"passed", "pending", "todo"}:
                continue
            suite_failed = True
            ancestor = [str(x) for x in assertion.get("ancestorTitles") or []]
            rule_id = rule_for_path(test_path, ancestor)
            failure_messages = assertion.get("failureMessages") or []
            title = assertion.get("fullName") or assertion.get("title") or "Jest assertion failed"
            message = "\n".join(str(x) for x in failure_messages).strip() or str(title)
            results.append(
                make_result(
                    rule_id,
                    status="failed",
                    path=test_path,
                    message=message[:4000],
                    waiver_status="unregistered",
                    detail={"assertion": title, "ancestor_titles": ancestor},
                )
            )
        if not suite_failed:
            rule_id = rule_for_path(test_path)
            if rule_id not in passed_rules:
                passed_rules.add(rule_id)
                results.append(
                    make_result(
                        rule_id,
                        status="passed",
                        message="GenesisPod architecture spec passed.",
                        path=test_path,
                    )
                )
    if not results and int(raw.get("numFailedTests") or 0) == 0:
        for spec in SELECTED_JEST_SPECS:
            rule_id = rule_for_path(spec)
            if rule_id not in passed_rules:
                passed_rules.add(rule_id)
                results.append(
                    make_result(
                        rule_id,
                        status="passed",
                        message="GenesisPod architecture spec passed.",
                        path=f"vendor/GenesisPod/backend/{spec}",
                    )
                )
    return results


def parse_waivers(path: Path) -> list[dict[str, str]]:
    waivers: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for raw_line in read_text(path).splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        start = re.match(r"-\s+id:\s*(.+)$", line)
        if start:
            if current:
                waivers.append(current)
            current = {"id": start.group(1).strip().strip('"')}
            continue
        if current is None:
            continue
        key_value = re.match(r"([A-Za-z0-9_-]+):\s*(.+)$", line)
        if key_value:
            current[key_value.group(1)] = key_value.group(2).strip().strip('"')
    if current:
        waivers.append(current)
    return waivers


def parse_policy(path: Path) -> dict[str, Any]:
    policy: dict[str, Any] = {
        "schema_version": "solar.verifier.genesis_policy.v1",
        "gate_mode": DEFAULT_GATE_MODE,
        "blocker_rules": {},
    }
    current: dict[str, str] | None = None
    in_blockers = False
    for raw_line in read_text(path).splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("gate_mode:"):
            policy["gate_mode"] = line.split(":", 1)[1].strip().strip('"')
            continue
        if line == "blocker_rules:":
            in_blockers = True
            continue
        if not in_blockers:
            continue
        start = re.match(r"-\s+rule_id:\s*(.+)$", line)
        if start:
            if current and current.get("rule_id"):
                policy["blocker_rules"][current["rule_id"]] = current
            current = {"rule_id": start.group(1).strip().strip('"'), "mode": "warn"}
            continue
        if current is None:
            continue
        key_value = re.match(r"([A-Za-z0-9_-]+):\s*(.+)$", line)
        if key_value:
            current[key_value.group(1)] = key_value.group(2).strip().strip('"')
    if current and current.get("rule_id"):
        policy["blocker_rules"][current["rule_id"]] = current
    return policy


def rule_gate_mode(rule_id: str, policy: dict[str, Any], requested_mode: str) -> str:
    if requested_mode in {"warn", "strict"}:
        return requested_mode
    return str(policy.get("blocker_rules", {}).get(rule_id, {}).get("mode", "warn"))


def waiver_matches(result: dict[str, Any], waiver: dict[str, str]) -> bool:
    if waiver.get("rule_id") != result.get("rule_id"):
        return False
    pattern = waiver.get("path") or waiver.get("paths") or "*"
    target = str(result.get("path") or "")
    candidates = [target]
    try:
        candidates.append(str(Path(target).resolve().relative_to(REPO_ROOT)))
    except Exception:
        pass
    return any(fnmatch.fnmatch(candidate, pattern) or candidate.endswith(pattern) for candidate in candidates)


def apply_waivers(results: list[dict[str, Any]], waivers: list[dict[str, str]]) -> None:
    today = dt.date.today()
    for result in results:
        if result.get("status") not in {"failed", "warn"}:
            continue
        for waiver in waivers:
            expires = waiver.get("expires", "1970-01-01")
            try:
                expiry = dt.date.fromisoformat(expires)
            except ValueError:
                expiry = dt.date(1970, 1, 1)
            if expiry >= today and waiver_matches(result, waiver):
                result["waiver_status"] = "registered"
                result["detail"]["waiver_id"] = waiver.get("id")
                break


def check_exception_registry(waiver_path: Path, exceptions_path: Path) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    waivers = parse_waivers(waiver_path)
    doc = read_text(exceptions_path)
    doc_ids = set(re.findall(r"^###\s+(E[0-9A-Za-z_-]+)\b", doc, flags=re.MULTILINE))
    waiver_ids = {w.get("id", "") for w in waivers if w.get("id")}

    if not waiver_path.exists():
        results.append(
            make_result(
                "genesis.waiver.exception_registry",
                status="failed",
                path=display_path(waiver_path),
                message="Machine waiver register is missing.",
            )
        )
    if not exceptions_path.exists():
        results.append(
            make_result(
                "genesis.waiver.exception_registry",
                status="failed",
                path=display_path(exceptions_path),
                message="Human exception register is missing.",
            )
        )

    for missing in sorted(waiver_ids - doc_ids):
        results.append(
            make_result(
                "genesis.waiver.exception_registry",
                status="failed",
                path=display_path(waiver_path),
                message=f"Waiver {missing} exists in waivers.yaml but is not documented in EXCEPTIONS.md.",
            )
        )
    for missing in sorted(doc_ids - waiver_ids):
        results.append(
            make_result(
                "genesis.waiver.exception_registry",
                status="failed",
                path=display_path(exceptions_path),
                message=f"Exception {missing} exists in EXCEPTIONS.md but is not registered in waivers.yaml.",
            )
        )

    today = dt.date.today()
    for waiver in waivers:
        expires = waiver.get("expires", "")
        try:
            expiry = dt.date.fromisoformat(expires)
        except ValueError:
            expiry = dt.date(1970, 1, 1)
        if expiry < today:
            results.append(
                make_result(
                    "genesis.waiver.exception_registry",
                    status="failed",
                    path=display_path(waiver_path),
                    message=f"Waiver {waiver.get('id', 'N/A')} is expired or has an invalid expiry: {expires or 'N/A'}.",
                )
            )

    if not results:
        results.append(
            make_result(
                "genesis.waiver.exception_registry",
                status="passed",
                path=display_path(waiver_path),
                message="Exception register and machine waivers are consistent.",
            )
        )
    return results


def rule_fingerprint(results: list[dict[str, Any]]) -> str:
    normalized = [
        {
            "rule_id": result.get("rule_id"),
            "status": result.get("status"),
            "severity": result.get("severity"),
            "waiver_status": result.get("waiver_status"),
        }
        for result in sorted(results, key=lambda item: str(item.get("rule_id")))
        if not str(result.get("rule_id", "")).startswith("genesis.contract.baseline")
    ]
    payload = json.dumps(normalized, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def baseline_payload(results: list[dict[str, Any]], source: dict[str, Any], gate_mode: str) -> dict[str, Any]:
    rules = [
        {
            "rule_id": result.get("rule_id"),
            "status": result.get("status"),
            "severity": result.get("severity"),
            "waiver_status": result.get("waiver_status"),
            "source": result.get("source"),
        }
        for result in sorted(results, key=lambda item: str(item.get("rule_id")))
        if not str(result.get("rule_id", "")).startswith("genesis.contract.baseline")
    ]
    payload = {
        "schema_version": "solar.verifier.baseline.v1",
        "created_at": utc_now(),
        "gate_mode": gate_mode,
        "source": source,
        "rules": rules,
    }
    payload["fingerprint"] = rule_fingerprint(results)
    return payload


def check_baseline_contract(
    baseline_dir: Path,
    current_results: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    baseline_path = baseline_dir / BASELINE_FILE
    if baseline_dir.exists() and (baseline_dir / "README.md").exists() and not baseline_path.exists():
        return [
            make_result(
                "genesis.contract.baseline_ratchet",
                status="warn",
                path=display_path(baseline_dir),
                message="Baseline directory exists but genesis-ci-baseline.json has not been ratcheted yet.",
            )
        ]
    if baseline_path.exists() and current_results is not None:
        try:
            baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            return [
                make_result(
                    "genesis.contract.baseline_ratchet",
                    status="failed",
                    path=display_path(baseline_path),
                    message=f"Baseline JSON is invalid: {exc}",
                )
            ]
        expected = str(baseline.get("fingerprint", ""))
        current = rule_fingerprint(current_results)
        if expected != current:
            return [
                make_result(
                    "genesis.contract.baseline_ratchet",
                    status="failed",
                    path=display_path(baseline_path),
                    message="Verifier rule status drifted from the ratcheted baseline.",
                    detail={"expected_fingerprint": expected, "current_fingerprint": current},
                )
            ]
        return [
            make_result(
                "genesis.contract.baseline_ratchet",
                status="passed",
                path=display_path(baseline_path),
                message="Verifier rule status matches ratcheted baseline.",
            )
        ]
    if baseline_path.exists():
        return [
            make_result(
                "genesis.contract.baseline_ratchet",
                status="passed",
                path=display_path(baseline_path),
                message="Baseline ratchet file exists.",
            )
        ]
    return [
        make_result(
            "genesis.contract.baseline_ratchet",
            status="failed",
            path=display_path(baseline_dir),
            message="Baseline ratchet contract is not initialized.",
        )
    ]


def run_standards_coverage() -> tuple[dict[str, Any], int]:
    standards_tool = HARNESS_DIR / "tools" / "standards_guard.py"
    if not standards_tool.exists():
        return {
            "schema_version": "solar.standards.coverage.v1",
            "status": "blocked",
            "summary": {"uncovered_must": 1},
            "error": f"Standards Guard tool is missing: {standards_tool}",
        }, 1
    proc = subprocess.run(
        [sys.executable, str(standards_tool), "coverage", "--json"],
        cwd=str(REPO_ROOT),
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        payload = {
            "schema_version": "solar.standards.coverage.v1",
            "status": "blocked",
            "summary": {"uncovered_must": 1},
            "stdout": proc.stdout[-4000:],
            "stderr": proc.stderr[-4000:],
        }
    return payload, proc.returncode


def changed_scope(repo_root: Path) -> dict[str, Any]:
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo_root), "diff", "--name-only", "HEAD"],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except Exception as exc:
        return {"scope_mode": "full_fallback", "reason": str(exc), "changed_paths": []}
    if proc.returncode != 0:
        return {"scope_mode": "full_fallback", "reason": proc.stderr.strip(), "changed_paths": []}
    paths = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
    if not paths:
        return {"scope_mode": "full_fallback", "reason": "no git diff paths", "changed_paths": []}
    return {"scope_mode": "changed", "reason": "git diff HEAD", "changed_paths": paths}


def run_jest_sidecar(vendor_dir: Path, raw_dir: Path, timeout_s: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    backend_dir = vendor_dir / "backend"
    raw_dir.mkdir(parents=True, exist_ok=True)
    raw_json = raw_dir / "jest.json"
    stdout_path = raw_dir / "jest.stdout.txt"
    stderr_path = raw_dir / "jest.stderr.txt"

    if not vendor_dir.exists():
        return [
            make_result(
                "genesis.runtime.vendor_missing",
                status="warn",
                severity="warn",
                path=str(vendor_dir),
                message="GenesisPod vendor runtime is missing; no pseudo-pass report was generated.",
                remediation="Clone GenesisPod into harness/plugins/genesis-verifier/vendor/GenesisPod and record SOURCE_COMMIT.",
                trigger="Genesis verifier preflight.",
                source="harness/plugins/genesis-verifier/vendor",
            )
        ], {"commands": [], "raw_json": str(raw_json), "stdout": str(stdout_path), "stderr": str(stderr_path)}

    jest_bins = [
        backend_dir / "node_modules" / ".bin" / "jest",
        vendor_dir / "node_modules" / ".bin" / "jest",
    ]
    if not any(path.exists() for path in jest_bins):
        return [
            make_result(
                "genesis.runtime.dependency_missing",
                status="warn",
                severity="warn",
                path=str(backend_dir),
                message="GenesisPod Node/Jest dependencies are not installed in the isolated vendor backend.",
                remediation="Run npm install inside harness/plugins/genesis-verifier/vendor/GenesisPod/backend only; do not install Node dependencies at Solar root.",
                trigger="Genesis verifier dependency preflight.",
                source="vendor/GenesisPod/backend/node_modules/.bin/jest",
            )
        ], {"commands": [], "raw_json": str(raw_json), "stdout": str(stdout_path), "stderr": str(stderr_path)}

    cmd = [
        "npx",
        "--no-install",
        "jest",
        *SELECTED_JEST_SPECS,
        "--no-coverage",
        "--forceExit",
        "--runInBand",
        "--json",
        "--outputFile",
        str(raw_json),
    ]
    started = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(backend_dir),
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
    except subprocess.TimeoutExpired as exc:
        stdout_path.write_text(exc.stdout or "", encoding="utf-8")
        stderr_path.write_text(exc.stderr or "", encoding="utf-8")
        return [
            make_result(
                "genesis.runtime.timeout",
                status="warn",
                severity="warn",
                path=str(backend_dir),
                message=f"GenesisPod Jest sidecar timed out after {timeout_s}s.",
                remediation="Increase --timeout for slow local Node/Jest runs or inspect vendor/GenesisPod/backend.",
                trigger="Genesis verifier sidecar timeout.",
                source="npx --no-install jest",
            )
        ], {"commands": [cmd], "duration_s": round(time.time() - started, 3), "raw_json": str(raw_json), "stdout": str(stdout_path), "stderr": str(stderr_path)}

    stdout_path.write_text(proc.stdout or "", encoding="utf-8")
    stderr_path.write_text(proc.stderr or "", encoding="utf-8")
    if raw_json.exists():
        try:
            raw = json.loads(raw_json.read_text(encoding="utf-8"))
            results = adapt_jest_json(raw)
        except json.JSONDecodeError as exc:
            results = [
                make_result(
                    "genesis.runtime.raw_parse_failed",
                    status="warn",
                    severity="warn",
                    path=str(raw_json),
                    message=f"Jest JSON output could not be parsed: {exc}",
                    remediation="Inspect raw Jest output and rerun the sidecar.",
                    trigger="Genesis verifier adapter parse.",
                    source=str(raw_json),
                )
            ]
    else:
        results = [
            make_result(
                "genesis.runtime.raw_missing",
                status="warn",
                severity="warn",
                path=str(raw_json),
                message=f"Jest exited rc={proc.returncode} but did not write JSON output.",
                remediation="Inspect raw stdout/stderr for the sidecar command.",
                trigger="Genesis verifier adapter preflight.",
                source="npx --no-install jest",
                detail={"returncode": proc.returncode},
            )
        ]

    return results, {
        "commands": [cmd],
        "returncode": proc.returncode,
        "duration_s": round(time.time() - started, 3),
        "raw_json": str(raw_json),
        "stdout": str(stdout_path),
        "stderr": str(stderr_path),
    }


def summarize(results: list[dict[str, Any]]) -> dict[str, int]:
    summary = {"passed": 0, "failed": 0, "warnings": 0, "waived": 0, "errors": 0}
    for result in results:
        status = result.get("status")
        if status == "passed":
            summary["passed"] += 1
        elif status == "failed":
            summary["failed"] += 1
        elif status == "warn":
            summary["warnings"] += 1
        elif status == "error":
            summary["errors"] += 1
        if result.get("waiver_status") == "registered":
            summary["waived"] += 1
    return summary


def report_status(summary: dict[str, int]) -> str:
    if summary["errors"]:
        return "error"
    if summary["failed"] or summary["warnings"]:
        return "warn"
    return "passed"


def evaluate_gate(results: list[dict[str, Any]], policy: dict[str, Any], requested_mode: str) -> dict[str, Any]:
    blocked_rules: list[str] = []
    for result in results:
        if result.get("status") not in {"failed", "warn", "error"}:
            continue
        if result.get("waiver_status") == "registered":
            continue
        mode = rule_gate_mode(str(result.get("rule_id")), policy, requested_mode)
        if mode in {"block", "blocker", "strict"}:
            blocked_rules.append(str(result.get("rule_id")))
    effective_status = "blocked" if blocked_rules else "allowed"
    return {
        "requested_mode": requested_mode,
        "policy_gate_mode": policy.get("gate_mode", DEFAULT_GATE_MODE),
        "effective_status": effective_status,
        "blocked_rule_ids": blocked_rules,
    }


def resolve_report_paths(out: str | None, command: str) -> tuple[Path, Path, Path]:
    if out:
        out_path = Path(out)
        if out_path.suffix == ".json":
            return out_path, out_path.with_suffix(".md"), out_path.parent / f"{out_path.stem}-raw"
        return out_path / f"{command}-latest.json", out_path / f"{command}-latest.md", out_path / f"{command}-raw"
    return DEFAULT_REPORT_DIR / f"{command}-latest.json", DEFAULT_REPORT_DIR / f"{command}-latest.md", DEFAULT_REPORT_DIR / f"{command}-raw"


def render_markdown(report: dict[str, Any]) -> str:
    rows = []
    for result in report["rule_results"]:
        rows.append(
            "| {rule_id} | {status} | {severity} | {waiver_status} | {path} | {message} |".format(
                rule_id=result["rule_id"],
                status=result["status"],
                severity=result["severity"],
                waiver_status=result["waiver_status"],
                path=str(result["path"]).replace("|", "\\|"),
                message=str(result["message"]).replace("\n", " ").replace("|", "\\|")[:240],
            )
        )
    table = "\n".join(rows) or "| N/A | passed | warn | N/A | N/A | No findings |"
    return f"""# Genesis Verifier Report

- schema: `{report['schema_version']}`
- run_id: `{report['run_id']}`
- command: `{report['command']}`
- status: `{report['status']}`
- gate_mode: `{report['gate_mode']}`
- source_commit: `{report['source']['source_commit']}`

| rule_id | status | severity | waiver | path | message |
|---|---|---|---|---|---|
{table}
"""


def build_report(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    command = args.command
    started_at = utc_now()
    run_id = f"genesis-{uuid.uuid4().hex[:12]}"
    report_json, report_md, raw_dir = resolve_report_paths(args.out, command)
    vendor_dir = Path(os.environ.get("GENESIS_VERIFIER_VENDOR_DIR", str(DEFAULT_VENDOR_DIR)))
    waiver_path = Path(os.environ.get("GENESIS_VERIFIER_WAIVERS", str(DEFAULT_WAIVERS)))
    exceptions_path = Path(os.environ.get("GENESIS_VERIFIER_EXCEPTIONS", str(DEFAULT_EXCEPTIONS)))
    baseline_dir = Path(os.environ.get("GENESIS_VERIFIER_BASELINE_DIR", str(DEFAULT_BASELINE_DIR)))
    policy_path = Path(os.environ.get("GENESIS_VERIFIER_POLICY", str(DEFAULT_POLICY)))
    requested_gate_mode = args.gate_mode or os.environ.get("GENESIS_VERIFIER_GATE_MODE") or DEFAULT_GATE_MODE
    policy = parse_policy(policy_path)

    results, raw = run_jest_sidecar(vendor_dir, raw_dir, args.timeout)
    trigger = "manual"
    scope: dict[str, Any] = {"scope_mode": "full"}
    if command == "changed":
        trigger = "changed"
        scope = changed_scope(REPO_ROOT)
    if command == "ci":
        trigger = "ci"
        results.extend(check_exception_registry(waiver_path, exceptions_path))
        results.extend(check_baseline_contract(baseline_dir, results))
        standards_coverage, standards_rc = run_standards_coverage()
    else:
        standards_coverage, standards_rc = {}, 0

    apply_waivers(results, parse_waivers(waiver_path))
    summary = summarize(results)
    status = report_status(summary)
    gate = evaluate_gate(results, policy, requested_gate_mode)
    finished_at = utc_now()

    report = {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "command": command,
        "trigger": trigger,
        "status": status,
        "gate_mode": requested_gate_mode,
        "gate": gate,
        "scope": scope,
        "summary": summary,
        "standards_guard": standards_coverage,
        "source": {
            "plugin": PLUGIN_NAME,
            "vendor_dir": str(vendor_dir),
            "source_commit": source_commit(vendor_dir),
            "selected_specs": SELECTED_JEST_SPECS,
        },
        "rule_results": results,
        "raw": raw,
        "artifacts": {
            "json": str(report_json),
            "markdown": str(report_md),
        },
        "events": [
            {"type": "verifier.run.started", "at": started_at, "run_id": run_id},
            *[
                {"type": "verifier.rule.failed", "at": finished_at, "rule_id": r["rule_id"], "run_id": run_id}
                for r in results
                if r.get("status") in {"failed", "warn", "error"}
            ],
            {
                "type": "verifier.gate.verdict",
                "at": finished_at,
                "status": status,
                "gate_mode": requested_gate_mode,
                "effective_status": gate["effective_status"],
                "run_id": run_id,
            },
        ],
        "started_at": started_at,
        "finished_at": finished_at,
    }

    report_json.parent.mkdir(parents=True, exist_ok=True)
    report_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report_md.write_text(render_markdown(report), encoding="utf-8")

    exit_code = 0
    if args.strict and status != "passed":
        exit_code = 1
    if gate["effective_status"] == "blocked":
        exit_code = 1
    if standards_rc != 0:
        exit_code = 1
    return report, exit_code


def ratchet_baseline(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    vendor_dir = Path(os.environ.get("GENESIS_VERIFIER_VENDOR_DIR", str(DEFAULT_VENDOR_DIR)))
    baseline_dir = Path(os.environ.get("GENESIS_VERIFIER_BASELINE_DIR", str(DEFAULT_BASELINE_DIR)))
    policy_path = Path(os.environ.get("GENESIS_VERIFIER_POLICY", str(DEFAULT_POLICY)))
    requested_gate_mode = args.gate_mode or os.environ.get("GENESIS_VERIFIER_GATE_MODE") or DEFAULT_GATE_MODE
    report_json, report_md, raw_dir = resolve_report_paths(args.out, "ratchet-baseline")
    started_at = utc_now()
    run_id = f"genesis-{uuid.uuid4().hex[:12]}"

    results, raw = run_jest_sidecar(vendor_dir, raw_dir, args.timeout)
    waiver_path = Path(os.environ.get("GENESIS_VERIFIER_WAIVERS", str(DEFAULT_WAIVERS)))
    exceptions_path = Path(os.environ.get("GENESIS_VERIFIER_EXCEPTIONS", str(DEFAULT_EXCEPTIONS)))
    results.extend(check_exception_registry(waiver_path, exceptions_path))
    apply_waivers(results, parse_waivers(waiver_path))
    source = {
        "plugin": PLUGIN_NAME,
        "vendor_dir": str(vendor_dir),
        "source_commit": source_commit(vendor_dir),
        "selected_specs": SELECTED_JEST_SPECS,
    }
    baseline_dir.mkdir(parents=True, exist_ok=True)
    baseline_path = baseline_dir / BASELINE_FILE
    baseline = baseline_payload(results, source, requested_gate_mode)
    baseline_path.write_text(json.dumps(baseline, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    results.append(
        make_result(
            "genesis.contract.baseline_ratchet",
            status="passed",
            path=display_path(baseline_path),
            message="Baseline ratcheted from current verifier results.",
            detail={"fingerprint": baseline["fingerprint"]},
        )
    )
    summary = summarize(results)
    status = report_status(summary)
    gate = evaluate_gate(results, parse_policy(policy_path), requested_gate_mode)
    finished_at = utc_now()
    report = {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "command": "ratchet-baseline",
        "trigger": "manual",
        "status": status,
        "gate_mode": requested_gate_mode,
        "gate": gate,
        "scope": {"scope_mode": "full"},
        "summary": summary,
        "source": source,
        "rule_results": results,
        "raw": raw,
        "baseline": {"path": str(baseline_path), "fingerprint": baseline["fingerprint"]},
        "artifacts": {"json": str(report_json), "markdown": str(report_md)},
        "events": [
            {"type": "verifier.run.started", "at": started_at, "run_id": run_id},
            {"type": "verifier.baseline.ratcheted", "at": finished_at, "run_id": run_id, "path": str(baseline_path)},
            {"type": "verifier.gate.verdict", "at": finished_at, "status": status, "gate_mode": requested_gate_mode, "effective_status": gate["effective_status"], "run_id": run_id},
        ],
        "started_at": started_at,
        "finished_at": finished_at,
    }
    report_json.parent.mkdir(parents=True, exist_ok=True)
    report_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report_md.write_text(render_markdown(report), encoding="utf-8")
    return report, 1 if gate["effective_status"] == "blocked" else 0


def explain(rule_id: str) -> dict[str, Any]:
    if rule_id not in RULES:
        return {
            "schema_version": SCHEMA_VERSION,
            "rule_id": rule_id,
            "status": "unknown",
            "message": "Unknown Genesis/Solar verifier rule id.",
            "known_rule_ids": sorted(RULES),
        }
    rule = RULES[rule_id]
    return {
        "schema_version": SCHEMA_VERSION,
        "rule_id": rule_id,
        "status": "ok",
        "gate_mode": DEFAULT_GATE_MODE,
        "severity": rule["severity"],
        "source": rule["source"],
        "trigger": rule["trigger"],
        "remediation": rule["remediation"],
        "waiver_allowed": True,
        "phase": "phase-1-ts-jest-sidecar",
    }


def print_human_report(report: dict[str, Any]) -> None:
    print(f"Genesis verifier: {report['status']} ({report['command']}, gate={report['gate_mode']})")
    print(json.dumps(report["summary"], ensure_ascii=False))
    print(f"json: {report['artifacts']['json']}")
    print(f"markdown: {report['artifacts']['markdown']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Solar-Harness GenesisPod verifier bridge")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("genesis-seed", "changed", "ci", "ratchet-baseline"):
        p = sub.add_parser(name)
        p.add_argument("--json", action="store_true", help="Print report JSON to stdout")
        p.add_argument("--out", help="Output JSON file or output directory")
        p.add_argument("--strict", action="store_true", help="Return non-zero when warn/errors are present")
        p.add_argument("--timeout", type=int, default=int(os.environ.get("GENESIS_VERIFIER_TIMEOUT", "180")))
        p.add_argument("--gate-mode", choices=("warn", "policy", "strict"), help="Gate evaluation mode; default warn")
    p_explain = sub.add_parser("explain")
    p_explain.add_argument("rule_id")
    p_explain.add_argument("--json", action="store_true")

    args = parser.parse_args(argv)
    if args.command == "explain":
        data = explain(args.rule_id)
        if args.json:
            print(json.dumps(data, ensure_ascii=False, indent=2))
        else:
            print(f"{data['rule_id']}: {data['status']}")
            print(f"source: {data.get('source', 'N/A')}")
            print(f"trigger: {data.get('trigger', 'N/A')}")
            print(f"remediation: {data.get('remediation', 'N/A')}")
        return 0 if data["status"] == "ok" else 2

    if args.command == "ratchet-baseline":
        report, exit_code = ratchet_baseline(args)
    else:
        report, exit_code = build_report(args)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_human_report(report)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
