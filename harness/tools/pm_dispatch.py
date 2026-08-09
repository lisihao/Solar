#!/usr/bin/env python3
"""pm_dispatch.py — PM 发号施令：从主四分屏 PM pane 向无头算子 pane 派发任务。

用法：
  python3 pm_dispatch.py submit --role builder --objective "检查 gate_check 函数"
  python3 pm_dispatch.py submit --operator mini-claude-sonnet-builder --objective "..."
  python3 pm_dispatch.py fleet-status
  python3 pm_dispatch.py inbox [--limit N]
  python3 pm_dispatch.py result --task-id pm-xxx

直接通过 solar-harness.sh：
  solar-harness pm-dispatch --role builder --objective "..."
  solar-harness pm-fleet status
  solar-harness pm-fleet inbox
"""
from __future__ import annotations

import argparse
import datetime
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
import uuid
import io
import contextlib
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

HOME = Path.home()
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", HOME / ".solar" / "harness"))
PHYSICAL_OPERATORS_PATH = Path(
    os.environ.get("SOLAR_MULTI_TASK_OPERATORS", HARNESS_DIR / "config" / "physical-operators.json")
)
PERSONAS_DIR = HARNESS_DIR / "personas"
PM_INBOX_DIR = HARNESS_DIR / "run" / "pm-inbox"
DISPATCH_LEDGER_PATH = HARNESS_DIR / "run" / "dispatch-ledger" / "pm-dispatch.jsonl"
OPERATOR_INBOX_DIR = HARNESS_DIR / "run" / "operator-inbox"
OPERATOR_RESULTS_DIR = HARNESS_DIR / "run" / "operator-results"
OPERATOR_STATUS_DIR = HARNESS_DIR / "run" / "operator-status"
ACTOR_LEASE_DIR = HARNESS_DIR / "run" / "actor-leases"
SPRINTS_DIR = Path(os.environ.get("SOLAR_HARNESS_SPRINTS_DIR", HARNESS_DIR / "sprints"))
REPO_HARNESS_DIR = Path(__file__).resolve().parents[1]
HEALTH_CACHE_SCHEMA_VERSION = 2
STATUS_FULL_LOAD_MAX_BYTES = int(os.environ.get("SOLAR_PM_STATUS_FULL_LOAD_MAX_BYTES", "131072"))
STATUS_SCAN_BYTES = int(os.environ.get("SOLAR_PM_STATUS_SCAN_BYTES", "16384"))
BUILDER_POOL_BACKLOG_CACHE = HARNESS_DIR / "run" / "builder-pool-backlog-cache.json"
PM_FLOW_CONTROL_SCAN_MAX_FILES = int(os.environ.get("SOLAR_PM_FLOW_CONTROL_SCAN_MAX_FILES", "300"))
_PM_FLOW_CONTROL_BLOCK_CACHE: dict[str, dict[str, Any] | None] = {}
_POSITIVE_QUOTA_RECOVERY_CACHE: dict[str, dict[str, Any]] = {}
_PM_FLOW_CONTROL_INDEX_LOADED = False
_STRICT_RESULT_LOG_BLOCK_CACHE: dict[str, dict[str, Any] | None] = {}
_PM_INBOX_PROJECTION_CACHE: tuple[float, str, int, list[dict[str, str]]] | None = None
BUILDER_POOL_BACKLOG_CACHE_TTL_SEC = int(os.environ.get("SOLAR_PM_BUILDER_POOL_BACKLOG_CACHE_TTL_SEC", "20"))
QUOTA_SNAPSHOT_PATH = HARNESS_DIR / "run" / "quota-snapshots" / "latest.json"
QUOTA_SNAPSHOT_FALLBACK_TTL_SEC = int(os.environ.get("SOLAR_PM_QUOTA_SNAPSHOT_FALLBACK_TTL_SEC", "1800"))
PM_CAPACITY_PROBE_PREFIXES = (
    "pm-graph-dispatch-capacity-probe-",
    "pm-eval-capacity-probe-",
)


def _ensure_runtime_import_path() -> None:
    """Keep canonical lib modules ahead of legacy tools shims.

    pm_dispatch runs from ``tools/``, so Python places that directory at
    ``sys.path[0]``.  Actor runtime imports must resolve to ``lib/`` first;
    otherwise stale tools copies of modules like actor_profiles shadow the
    policy-aware runtime implementations.
    """
    lib_dir = str(HARNESS_DIR / "lib")
    tools_dir = str(HARNESS_DIR / "tools")
    for path in (lib_dir, tools_dir):
        while path in sys.path:
            sys.path.remove(path)
    sys.path.insert(0, tools_dir)
    sys.path.insert(0, lib_dir)
    for module_name in ("operator_runtime", "logical_operator_router", "actor_profiles"):
        module = sys.modules.get(module_name)
        module_file = str(getattr(module, "__file__", "") or "")
        if module_file.startswith(tools_dir + os.sep):
            sys.modules.pop(module_name, None)


# ── 角色别名映射 ───────────────────────────────────────────────────────────────
ROLE_ALIASES: dict[str, str] = {
    "build": "builder",
    "builder-main": "builder",
    "implementation": "builder",
    "implementer": "builder",
    "coder": "builder",
    "dev": "builder",
    "plan": "planner",
    "planning": "planner",
    "architect": "planner",
    "design": "planner",
    "eval": "evaluator",
    "review": "evaluator",
    "judge": "evaluator",
    "reviewer": "evaluator",
    "verifier": "evaluator",
    "knowledge": "builder",   # 知识提取走 builder 角色
    "extract": "builder",
    "product": "pm",
    "product-manager": "pm",
}

NON_DISPATCHABLE_STATES = {"leased", "running", "draining", "cooldown", "quota_exhausted", "auth_expired", "disabled"}
HARD_BLOCK_TYPES = {"cooldown", "quota_exhausted", "auth_expired", "health", "busy", "disabled"}
GRAPH_TRANSIENT_FAILURE_BLOCK_THRESHOLD = int(os.environ.get("SOLAR_GRAPH_TRANSIENT_FAILURE_BLOCK_THRESHOLD", "3"))
GRAPH_TRANSIENT_FAILURE_BLOCK_WINDOW_SEC = int(os.environ.get("SOLAR_GRAPH_TRANSIENT_FAILURE_BLOCK_WINDOW_SEC", "900"))
TRANSIENT_OPERATOR_FAILURE_RE = re.compile(
    r"runtime_state=(?:cooldown|quota_exhausted|auth_expired)|"
    r"Error loading config\.toml:\s+unknown variant [`'\"]?default[`'\"]?, expected [`'\"]?fast[`'\"]? or [`'\"]?flex[`'\"]?|"
    r"spawn .*codex.* ENOENT|codex.* ENOENT|"
    r"you(?:'|’)ve hit .*limit|usage limit|rate[- ]?limit|quota(?:\s+exhausted)?|"
    r"auth_expired|not logged in|not authenticated",
    re.I,
)


def _transient_operator_failure_text(record: dict[str, Any]) -> str:
    """Collect transient provider-failure evidence across PM and operator result shapes."""
    parts: list[str] = []
    for key in ("failure_reason", "log_tail", "stderr", "stdout", "error", "message"):
        value = record.get(key)
        if value:
            parts.append(str(value))
    artifact_paths = record.get("artifact_paths") if isinstance(record.get("artifact_paths"), dict) else {}
    candidate_paths: list[Path] = []
    for key in ("codex_cli_output_log", "output_log", "stderr_path", "stdout_path"):
        value = artifact_paths.get(key)
        if value:
            candidate_paths.append(Path(str(value)).expanduser())
    for value in artifact_paths.values():
        if not value:
            continue
        path = Path(str(value)).expanduser()
        if path.is_dir():
            for name in ("codex-cli-output.log", "output.log", "stderr.txt", "stdout.txt"):
                candidate_paths.append(path / name)
    operator_id = str(record.get("operator_id") or "").strip()
    task_id = str(record.get("task_id") or "").strip()
    if operator_id and task_id:
        result_dir = HARNESS_DIR / "run" / "operator-results" / operator_id / task_id
        for name in ("codex-cli-output.log", "output.log", "stderr.txt", "stdout.txt"):
            candidate_paths.append(result_dir / name)
    for path in candidate_paths:
        try:
            if path.exists() and path.is_file():
                parts.append(path.read_text(encoding="utf-8", errors="replace")[-4000:])
        except Exception:
            continue
    return "\n".join(parts).strip()


def _apply_transient_operator_flow_control(record: dict[str, Any]) -> dict[str, Any]:
    reason_text = _transient_operator_failure_text(record)
    if not TRANSIENT_OPERATOR_FAILURE_RE.search(reason_text):
        return {"ok": False, "applied": False, "reason": "not_transient_operator_failure"}
    operator_id = str(record.get("operator_id") or "").strip()
    task_id = str(record.get("task_id") or "").strip()
    if not operator_id or not task_id:
        return {"ok": False, "applied": False, "reason": "missing_operator_or_task_id"}
    try:
        lib_dir = HARNESS_DIR / "lib"
        if str(lib_dir) not in sys.path:
            sys.path.insert(0, str(lib_dir))
        import operator_flow_control as ofc  # type: ignore
    except Exception as exc:
        return {"ok": False, "applied": False, "reason": f"flow_control_unavailable:{type(exc).__name__}", "error": str(exc)}

    task_dir = HARNESS_DIR / "run" / "operator-results" / operator_id / task_id
    task_dir.mkdir(parents=True, exist_ok=True)
    try:
        result = ofc.apply_failure_flow_control(
            task_dir,
            operator_id=operator_id,
            failure_text=reason_text,
            rate_limit_cooldown_seconds=int(os.environ.get("SOLAR_OPERATOR_RATE_LIMIT_COOLDOWN_SECONDS", "3600")),
            auth_cooldown_seconds=int(os.environ.get("SOLAR_OPERATOR_AUTH_COOLDOWN_SECONDS", "21600")),
        )
    except Exception as exc:
        return {"ok": False, "applied": False, "reason": f"flow_control_apply_failed:{type(exc).__name__}", "error": str(exc)}
    applied = str(result.get("runtime_state") or "") in {"cooldown", "quota_exhausted", "auth_expired"}
    return {
        "ok": bool(applied),
        "applied": bool(applied),
        "operator_id": operator_id,
        "runtime_state": result.get("runtime_state", ""),
        "expires_at": result.get("expires_at", ""),
        "config_block": result.get("config_block"),
    }

RATE_LIMIT_PRUNER_LABEL = os.environ.get("SOLAR_RATE_LIMIT_PRUNER_LABEL", "com.solar.harness-rate-limit-pruner")
OPERATOR_HEALTH_WATCHDOG_LABEL = os.environ.get("SOLAR_OPERATOR_HEALTH_WATCHDOG_LABEL", "com.solar.harness.operator-health-watchdog")
CODE_EXEC_TASK_TYPES = {
    "implementation",
    "code-edit",
    "repo-modification",
    "fast-patch",
    "patch",
    "refactor",
    "test",
    "tests",
    "debugging",
    "build",
}
CODE_EXEC_ROLES = {"builder", "implementation", "implementer", "coder", "dev"}
CODE_EXEC_AVOID_MARKERS = {"implementation", "code-edit", "repo-modification"}
BUILDER_READY_LOGICAL_OPERATORS = {
    "ImplementationWorker",
    "PatchWorker",
    "TestDesigner",
    "TestRunner",
    "RunTests",
    "VerifyClaim",
    "BenchmarkRunner",
    "ResearchSynthesizer",
    "ArtifactCurator",
}
NON_BUILDER_READY_LOGICAL_OPERATORS = {
    "DeepArchitect",
    "ParallelExplorer",
    "ResearchScout",
    "ContextCompressor",
    "Critic",
    "Verifier",
    "VerifierLite",
    "SecurityGate",
    "QuotaBroker",
}
NON_BUILDER_NODE_ROLES = {
    "coordinator",
    "evaluator",
    "knowledge",
    "planner",
    "pm",
    "reviewer",
    "verifier",
}


def _load_concurrency_policy_module() -> Any | None:
    try:
        lib_dir = HARNESS_DIR / "lib"
        if str(lib_dir) not in sys.path:
            sys.path.insert(0, str(lib_dir))
        import concurrency_policy  # type: ignore

        return concurrency_policy
    except Exception:
        return None


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_utc_ts(value: Any) -> datetime.datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.datetime.strptime(raw, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
    except Exception:
        return None


def _short_id() -> str:
    return str(uuid.uuid4())[:8]



def capture_entrypoint_raw_intent(
    *,
    source_channel: str,
    text: str,
    sprint_id: str = "",
    node_id: str = "",
    role: str = "",
    repo: str = "",
) -> dict[str, Any]:
    full_text = text.strip()
    if sprint_id or node_id or role:
        full_text = (
            f"[entrypoint_metadata]\n"
            f"sprint_id: {sprint_id or 'N/A'}\n"
            f"node_id: {node_id or 'N/A'}\n"
            f"role: {role or 'N/A'}\n\n"
            f"[raw_request]\n{full_text}"
        )
    cmd = [
        sys.executable,
        str(HARNESS_DIR / "lib" / "intent_gateway.py"),
        "capture",
        "--source-channel", source_channel,
        "--actor", "user",
        "--device", "mac_mini_pm_dispatch",
        "--repo", repo or str(HARNESS_DIR),
        "--source-trust", source_channel,
        "--text", full_text,
        "--json",
    ]
    if sprint_id:
        cmd.extend(["--sprint-id", sprint_id])
    proc = subprocess.run(cmd, text=True, capture_output=True, timeout=30)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "intent_gateway capture failed").strip())
    payload = json.loads(proc.stdout)
    intent_id = str(payload.get("intent_id") or "")
    if intent_id:
        consumer_cmd = [
            sys.executable,
            str(HARNESS_DIR / "lib" / "intent_consumer.py"),
            "consume",
            "--intent-id", intent_id,
            "--json",
        ]
        consumer = subprocess.run(consumer_cmd, text=True, capture_output=True, timeout=120)
        if consumer.returncode != 0:
            raise RuntimeError((consumer.stderr or consumer.stdout or "intent_consumer failed").strip())
        payload["consumer"] = json.loads(consumer.stdout)
    return payload


def print_intent_capture(payload: dict[str, Any], entrypoint: str) -> None:
    print("✅ RawIntent 已捕获")
    print(f"   entrypoint  = {entrypoint}")
    print(f"   intent_id   = {payload.get('intent_id', '')}")
    print(f"   title       = {payload.get('title', '')}")
    print(f"   lane        = {payload.get('lane', '')}")
    print(f"   raw_intent  = {payload.get('raw_intent', '')}")
    print(f"   requirement = {payload.get('requirement_ir', '')}")
    print("   direct_dispatch = disabled")


# ── Registry ──────────────────────────────────────────────────────────────────

def load_registry() -> dict[str, Any]:
    _prune_expired_operator_blocks()
    if not PHYSICAL_OPERATORS_PATH.exists():
        return {"version": 1, "operators": {}}
    try:
        return json.loads(PHYSICAL_OPERATORS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"version": 1, "operators": {}}


def _prune_expired_operator_blocks() -> dict[str, Any]:
    try:
        lib_dir = HARNESS_DIR / "lib"
        if str(lib_dir) not in sys.path:
            sys.path.insert(0, str(lib_dir))
        import operator_flow_control as ofc  # type: ignore

        return ofc.prune_expired_operator_config_blocks()
    except Exception as exc:
        return {"ok": False, "reason": f"prune_failed:{type(exc).__name__}", "error": str(exc)}


def _load_operator_runtime_module() -> Any | None:
    """Best-effort load of operator_runtime for lease-aware runtime state."""
    try:
        lib_dir = HARNESS_DIR / "lib"
        if str(lib_dir) not in sys.path:
            sys.path.insert(0, str(lib_dir))
        import operator_runtime  # type: ignore

        return operator_runtime
    except Exception:
        return None


def _load_actor_runtime_class() -> Any:
    """Load the canonical lib ActorRuntime, not a tools mirror."""
    lib_dir = HARNESS_DIR / "lib"
    if str(lib_dir) not in sys.path:
        sys.path.insert(0, str(lib_dir))
    module_path = lib_dir / "actor_runtime.py"
    spec = importlib.util.spec_from_file_location("_solar_actor_runtime_for_pm_dispatch", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"actor_runtime_unavailable: {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.ActorRuntime


def _load_operator_flow_control_module() -> Any | None:
    """Best-effort load of operator_flow_control for log-backed quota state."""
    try:
        lib_dir = HARNESS_DIR / "lib"
        if str(lib_dir) not in sys.path:
            sys.path.insert(0, str(lib_dir))
        import operator_flow_control  # type: ignore

        return operator_flow_control
    except Exception:
        return None


def _load_operator_cooldown_db_module() -> Any | None:
    """Best-effort load of the SQLite cooldown ledger."""
    try:
        lib_dir = HARNESS_DIR / "lib"
        if str(lib_dir) not in sys.path:
            sys.path.insert(0, str(lib_dir))
        import operator_cooldown_db  # type: ignore

        return operator_cooldown_db
    except Exception:
        return None


def _quota_recovery_supersedes_block(operator_id: str, block: dict[str, Any]) -> bool:
    mod = _load_operator_cooldown_db_module()
    if mod is not None and hasattr(mod, "quota_recovery_observation"):
        try:
            recovery = mod.quota_recovery_observation(operator_id, block=block)
        except Exception:
            recovery = None
        if isinstance(recovery, dict):
            _POSITIVE_QUOTA_RECOVERY_CACHE[operator_id] = dict(recovery)
            return True
    source = str(block.get("source") or "").strip().lower()
    if source in {"operator_result_log_strict", "pm_operator_flow_control"}:
        return False
    try:
        if time.time() - QUOTA_SNAPSHOT_PATH.stat().st_mtime > QUOTA_SNAPSHOT_FALLBACK_TTL_SEC:
            return False
        data = json.loads(QUOTA_SNAPSHOT_PATH.read_text(encoding="utf-8"))
    except Exception:
        return False
    snapshot_at = _parse_utc(str(data.get("generated_at") or ""))
    triggered_at = _parse_utc(str(block.get("triggered_at") or ""))
    if snapshot_at is not None and triggered_at is not None and snapshot_at < triggered_at:
        return False
    operators = data.get("operators") if isinstance(data.get("operators"), list) else []
    for row in operators:
        if not isinstance(row, dict) or str(row.get("operator_id") or "") != operator_id:
            continue
        state = str(row.get("state") or row.get("runtime_state") or "").strip().lower()
        usable = bool(row.get("usable", state in {"idle", "ok", "available"}))
        recovered = usable and state not in {"cooldown", "quota_exhausted", "auth_expired", "no_subscription", "needs_human_review"}
        if recovered:
            _POSITIVE_QUOTA_RECOVERY_CACHE[operator_id] = dict(row)
        return recovered
    return False


def _load_operator_availability_module() -> Any | None:
    """Best-effort load of the shared availability resolver."""
    for path in (REPO_HARNESS_DIR / "lib" / "operator_availability.py", HARNESS_DIR / "lib" / "operator_availability.py"):
        try:
            if not path.exists():
                continue
            spec = importlib.util.spec_from_file_location("_solar_operator_availability_resolver", path)
            if spec is None or spec.loader is None:
                continue
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
        except Exception:
            continue
    return None


def get_operator_runtime_state(operator_id: str) -> str:
    runtime_mod = _load_operator_runtime_module()
    if runtime_mod is not None:
        try:
            state = runtime_mod.get_operator_runtime_state(operator_id)
            if state:
                return str(state)
        except Exception:
            pass

    status_file = OPERATOR_STATUS_DIR / f"{operator_id}.json"
    if not status_file.exists():
        return "idle"
    try:
        data = json.loads(status_file.read_text(encoding="utf-8"))
        return str(data.get("runtime_state", "idle"))
    except Exception:
        return "idle"


def _recent_operator_quota_block(op: dict[str, Any]) -> dict[str, Any] | None:
    operator_id = str(op.get("operator_id") or "").strip()
    if not operator_id:
        return None
    flow_mod = _load_operator_flow_control_module()
    if flow_mod is None or not hasattr(flow_mod, "recent_operator_quota_block"):
        return None
    try:
        block = flow_mod.recent_operator_quota_block(
            operator_id,
            model_hint=str(op.get("model") or op.get("profile") or ""),
        )
    except Exception:
        return None
    if isinstance(block, dict) and _quota_recovery_supersedes_block(operator_id, block):
        return None
    return block if isinstance(block, dict) else None


def _recent_operator_result_log_quota_block_strict(op: dict[str, Any]) -> dict[str, Any] | None:
    operator_id = str(op.get("operator_id") or "").strip()
    if not operator_id:
        return None
    if operator_id in _STRICT_RESULT_LOG_BLOCK_CACHE:
        return _STRICT_RESULT_LOG_BLOCK_CACHE[operator_id]
    flow_mod = _load_operator_flow_control_module()
    if flow_mod is None:
        _STRICT_RESULT_LOG_BLOCK_CACHE[operator_id] = None
        return None
    root = OPERATOR_RESULTS_DIR / operator_id
    if not root.exists():
        _STRICT_RESULT_LOG_BLOCK_CACHE[operator_id] = None
        return None
    now = datetime.datetime.now(datetime.timezone.utc)
    max_age = int(os.environ.get("SOLAR_OPERATOR_STRICT_RESULT_QUOTA_BLOCK_MAX_AGE_SECONDS", "7200"))
    try:
        result_dirs = sorted(
            [path for path in root.iterdir() if path.is_dir()],
            key=lambda path: path.stat().st_mtime if path.exists() else 0.0,
            reverse=True,
        )[:20]
    except Exception:
        result_dirs = []
    candidates: list[Path] = []
    for result_dir in result_dirs:
        for name in ("codex-cli-output.log", "output.log"):
            path = result_dir / name
            if path.is_file():
                candidates.append(path)
    for path in candidates:
        try:
            mtime = datetime.datetime.fromtimestamp(path.stat().st_mtime, tz=datetime.timezone.utc)
        except Exception:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")[-12000:]
        except Exception:
            continue
        try:
            if flow_mod.classify_failure_state(text) != "cooldown" or not flow_mod.has_explicit_quota_evidence(text):
                continue
            reset_at = flow_mod.parse_rate_limit_reset_at(text, now=now)
        except Exception:
            continue
        if reset_at is None or reset_at <= now:
            continue
        has_absolute_reset_date = bool(
            re.search(
                r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?",
                text,
                re.I,
            )
        )
        if max_age > 0 and (now - mtime).total_seconds() > max_age and not has_absolute_reset_date:
            continue
        result = {
            "operator_id": operator_id,
            "runtime_state": "cooldown",
            "expires_at": reset_at.astimezone(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "source": "operator_result_log_strict",
            "path": str(path),
            "triggered_at": mtime.isoformat().replace("+00:00", "Z"),
        }
        if _quota_recovery_supersedes_block(operator_id, result):
            _STRICT_RESULT_LOG_BLOCK_CACHE[operator_id] = None
            return None
        _STRICT_RESULT_LOG_BLOCK_CACHE[operator_id] = result
        return result
    _STRICT_RESULT_LOG_BLOCK_CACHE[operator_id] = None
    return None


def _load_recent_pm_flow_control_index() -> None:
    global _PM_FLOW_CONTROL_INDEX_LOADED
    if _PM_FLOW_CONTROL_INDEX_LOADED:
        return
    _PM_FLOW_CONTROL_INDEX_LOADED = True
    now = datetime.datetime.now(datetime.timezone.utc)
    try:
        paths = sorted(
            pm_inbox_dir().glob("pm-*.json"),
            key=lambda item: item.stat().st_mtime if item.exists() else 0.0,
            reverse=True,
        )[: max(1, PM_FLOW_CONTROL_SCAN_MAX_FILES)]
    except Exception:
        paths = list(pm_inbox_dir().glob("pm-*.json"))[: max(1, PM_FLOW_CONTROL_SCAN_MAX_FILES)]
    for path in paths:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        op_id = str(payload.get("operator_id") or "").strip()
        if not op_id:
            continue
        flow = payload.get("operator_flow_control")
        if not isinstance(flow, dict) or not flow.get("applied"):
            continue
        runtime_state = str(flow.get("runtime_state") or "").strip().lower()
        if runtime_state not in {"cooldown", "quota_exhausted", "auth_expired"}:
            continue
        expires_at = str(flow.get("expires_at") or "").strip()
        expires_dt = _parse_utc(expires_at)
        if expires_dt is not None and expires_dt <= now:
            continue
        try:
            mtime = path.stat().st_mtime
        except OSError:
            mtime = 0.0
        existing = _PM_FLOW_CONTROL_BLOCK_CACHE.get(op_id)
        existing_mtime = float(existing.get("_mtime", -1.0)) if isinstance(existing, dict) else -1.0
        if mtime <= existing_mtime:
            continue
        _PM_FLOW_CONTROL_BLOCK_CACHE[op_id] = {
            "operator_id": op_id,
            "runtime_state": runtime_state,
            "expires_at": expires_at,
            "triggered_at": str(flow.get("triggered_at") or payload.get("failed_at") or payload.get("submitted_at") or payload.get("issued_at") or ""),
            "reason": str(flow.get("reason") or payload.get("failure_reason") or runtime_state),
            "rule_name": str(flow.get("rule_name") or "pm_operator_flow_control"),
            "evidence_ref": str(flow.get("evidence_ref") or payload.get("task_id") or ""),
            "source": "pm_operator_flow_control",
            "path": str(path),
            "task_id": str(payload.get("task_id") or ""),
            "_mtime": mtime,
        }


def _recent_pm_operator_flow_control_block(operator_id: str) -> dict[str, Any] | None:
    op_id = str(operator_id or "").strip()
    if not op_id:
        return None
    _load_recent_pm_flow_control_index()
    block = _PM_FLOW_CONTROL_BLOCK_CACHE.get(op_id)
    if isinstance(block, dict):
        public_block = {k: v for k, v in block.items() if k != "_mtime"}
        if _quota_recovery_supersedes_block(op_id, public_block):
            _PM_FLOW_CONTROL_BLOCK_CACHE[op_id] = None
            return None
        return public_block
    return None


def _shared_recent_operator_quota_block(op: dict[str, Any]) -> dict[str, Any] | None:
    operator_id = str(op.get("operator_id") or "").strip()
    if not operator_id:
        return None
    provider = str(op.get("provider") or "").strip().lower()
    model = str(op.get("model") or "").strip().lower()
    key_ref = str(op.get("key_ref") or "").strip()
    pool = op.get("builder_pool") if isinstance(op.get("builder_pool"), dict) else {}
    group = str(pool.get("group") or "").strip()
    now = datetime.datetime.now(datetime.timezone.utc)
    for peer_id, peer_spec in (load_registry().get("operators") or {}).items():
        peer_id = str(peer_id)
        if not peer_id or peer_id == operator_id or not isinstance(peer_spec, dict):
            continue
        peer_provider = str(peer_spec.get("provider") or "").strip().lower()
        peer_model = str(peer_spec.get("model") or "").strip().lower()
        peer_key_ref = str(peer_spec.get("key_ref") or "").strip()
        peer_pool = peer_spec.get("builder_pool") if isinstance(peer_spec.get("builder_pool"), dict) else {}
        peer_group = str(peer_pool.get("group") or "").strip()
        same_group = bool(group and peer_group == group and (not provider or not peer_provider or provider == peer_provider))
        same_key_model = bool(key_ref and peer_key_ref == key_ref and provider and model and provider == peer_provider and model == peer_model)
        if not (same_group or same_key_model):
            continue
        peer_op = {"operator_id": peer_id, **dict(peer_spec)}
        block = _recent_pm_operator_flow_control_block(peer_id) or _recent_operator_result_log_quota_block_strict(peer_op)
        if not block:
            continue
        expires_at = str(block.get("expires_at") or "").strip()
        expires_dt = _parse_utc(expires_at)
        if expires_dt is not None and expires_dt <= now:
            continue
        return {
            **block,
            "operator_id": operator_id,
            "peer_operator_id": peer_id,
            "source": f"shared_{block.get('source') or 'quota_block'}",
            "match": "builder_pool" if same_group else "key_ref",
        }
    return None


def _operator_cooldown_db_block(operator_id: str) -> dict[str, Any] | None:
    mod = _load_operator_cooldown_db_module()
    if mod is None or not hasattr(mod, "current_cooldown_block"):
        return _operator_quota_snapshot_block(operator_id)
    try:
        block = mod.current_cooldown_block(operator_id)
    except Exception:
        return _operator_quota_snapshot_block(operator_id)
    if isinstance(block, dict):
        return block
    return _operator_quota_snapshot_block(operator_id)


def _operator_quota_snapshot_block(operator_id: str) -> dict[str, Any] | None:
    """Fail closed from the latest quota snapshot when the cooldown DB is unavailable."""
    if not operator_id or QUOTA_SNAPSHOT_FALLBACK_TTL_SEC <= 0:
        return None
    try:
        stat = QUOTA_SNAPSHOT_PATH.stat()
        if time.time() - stat.st_mtime > QUOTA_SNAPSHOT_FALLBACK_TTL_SEC:
            return None
        data = json.loads(QUOTA_SNAPSHOT_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None
    operators = data.get("operators") if isinstance(data.get("operators"), list) else []
    for row in operators:
        if not isinstance(row, dict) or str(row.get("operator_id") or "") != operator_id:
            continue
        state = str(row.get("state") or row.get("runtime_state") or "").strip().lower()
        if state not in {"cooldown", "quota_exhausted", "auth_expired", "no_subscription", "needs_human_review"}:
            return None
        expires_at = str(row.get("next_available_at") or row.get("expires_at") or "").strip()
        expires_dt = _parse_utc(expires_at)
        if state in {"cooldown", "quota_exhausted"}:
            if expires_dt is None or expires_dt <= datetime.datetime.now(datetime.timezone.utc):
                return None
        block = {
            "operator_id": operator_id,
            "runtime_state": state,
            "reason": f"quota_snapshot_fallback:{state}",
            "source": "quota_snapshot_fallback",
            "scope": "operator_id",
            "rule_name": "quota_snapshot_fallback",
            "triggered_at": str(data.get("generated_at") or ""),
            "expires_at": expires_at,
            "evidence_ref": str(data.get("run_id") or data.get("generated_at") or ""),
        }
        mod = _load_operator_cooldown_db_module()
        if state in {"cooldown", "quota_exhausted", "auth_expired"} and mod is not None and hasattr(mod, "quota_recovery_observation"):
            try:
                recovery = mod.quota_recovery_observation(operator_id, block=block)
            except Exception:
                recovery = None
            if isinstance(recovery, dict):
                return None
        return block
    return None


def _format_cooldown_db_reason(block: dict[str, Any]) -> str:
    mod = _load_operator_cooldown_db_module()
    if mod is not None and hasattr(mod, "format_block_reason"):
        try:
            return str(mod.format_block_reason(block))
        except Exception:
            pass
    state = str(block.get("runtime_state") or "cooldown")
    reason = str(block.get("reason") or state)
    expires_at = str(block.get("expires_at") or "")
    text = f"cooldown_db={state}, reason={reason}"
    eta = _format_reset_eta(expires_at)
    if eta:
        text += f", resets {eta}"
    if expires_at:
        text += f" (until {expires_at})"
    return text


def _cooldown_block_is_quota_like(block: dict[str, Any] | None) -> bool:
    if not isinstance(block, dict):
        return False
    state = str(block.get("runtime_state") or "").strip().lower()
    if state in {"quota_exhausted", "auth_expired"}:
        return True
    reason = str(block.get("reason") or "").strip().lower()
    source = str(block.get("source") or "").strip().lower()
    rule = str(block.get("rule_name") or "").strip().lower()
    evidence = str(block.get("evidence_excerpt") or "").strip().lower()
    quota_terms = (
        "quota",
        "rate_limit",
        "usage limit",
        "pane_tui_rate_limit",
        "result_log_quota_block",
        "you've hit",
        "too many requests",
        "429",
    )
    material = " ".join([reason, source, rule, evidence])
    return any(term in material for term in quota_terms)


_SHARED_COOLDOWN_SCOPES = {
    "account",
    "billing_pool",
    "key_ref",
    "model_key",
    "provider",
    "quota_pool",
    "subscription",
}


def _cooldown_block_is_shared_scope(block: dict[str, Any] | None) -> bool:
    if not isinstance(block, dict):
        return False
    scope = str(block.get("scope") or "operator_id").strip().lower()
    return scope in _SHARED_COOLDOWN_SCOPES or scope.startswith("shared_")


def _is_claude_code_operator(op: dict[str, Any]) -> bool:
    flow_mod = _load_operator_flow_control_module()
    operator_id = str(op.get("operator_id") or "")
    if flow_mod is not None and hasattr(flow_mod, "_is_claude_code_operator"):
        try:
            return bool(flow_mod._is_claude_code_operator(operator_id, op))  # type: ignore[attr-defined]
        except Exception:
            pass
    provider = str(op.get("provider") or "").strip().lower()
    model = str(op.get("model") or "").strip().lower()
    if provider and provider not in {"anthropic", "claude", "claude-code"}:
        return False
    return (
        "claude" in operator_id.lower()
        or provider in {"anthropic", "claude", "claude-code"}
        or model in {"opus", "sonnet", "haiku"}
    )


def _claude_stale_quota_block_without_recent_evidence(op: dict[str, Any], state: str) -> bool:
    state_l = str(state or "").strip().lower()
    if state_l not in {"cooldown", "quota_exhausted"}:
        return False
    if not _is_claude_code_operator(op):
        return False
    return _recent_operator_quota_block(op) is None


def get_operator_status_data(operator_id: str) -> dict[str, Any]:
    """Return the full status JSON for an operator, or empty dict if absent/expired."""
    status_file = OPERATOR_STATUS_DIR / f"{operator_id}.json"
    if not status_file.exists():
        return {}
    try:
        return json.loads(status_file.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _pid_exists(pid: int | None) -> bool:
    if not pid or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except Exception:
        return False


def _parse_utc(value: str) -> datetime.datetime | None:
    if not value:
        return None
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def _launchd_domain() -> str:
    return f"gui/{os.getuid()}"


def _rate_limit_pruner_status() -> dict[str, Any]:
    """Return launchd/install status for the periodic operator block pruner."""
    plist_path = HOME / "Library" / "LaunchAgents" / f"{RATE_LIMIT_PRUNER_LABEL}.plist"
    stdout_log = HARNESS_DIR / "logs" / "operator-rate-limit-pruner.out.log"
    stderr_log = HARNESS_DIR / "logs" / "operator-rate-limit-pruner.err.log"
    payload: dict[str, Any] = {
        "label": RATE_LIMIT_PRUNER_LABEL,
        "plist_path": str(plist_path),
        "installed": plist_path.exists(),
        "launchd_loaded": False,
        "state": "unknown",
        "runs": None,
        "last_exit_code": None,
        "run_interval_seconds": None,
        "stdout_log": str(stdout_log),
        "stderr_log": str(stderr_log),
    }
    if shutil.which("launchctl") is None:
        payload["state"] = "launchctl_unavailable"
        return payload
    try:
        result = subprocess.run(
            ["launchctl", "print", f"{_launchd_domain()}/{RATE_LIMIT_PRUNER_LABEL}"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except Exception as exc:
        payload["state"] = f"launchctl_error:{type(exc).__name__}"
        return payload
    if result.returncode != 0:
        payload["state"] = "not_loaded"
        return payload
    output = result.stdout or result.stderr or ""
    payload["launchd_loaded"] = True
    state_match = re.search(r"^\s*state = ([^\n]+)", output, re.M)
    runs_match = re.search(r"^\s*runs = (\d+)", output, re.M)
    exit_match = re.search(r"^\s*last exit code = (-?\d+)", output, re.M)
    interval_match = re.search(r"^\s*run interval = (\d+) seconds", output, re.M)
    if state_match:
        payload["state"] = state_match.group(1).strip()
    if runs_match:
        payload["runs"] = int(runs_match.group(1))
    if exit_match:
        payload["last_exit_code"] = int(exit_match.group(1))
    if interval_match:
        payload["run_interval_seconds"] = int(interval_match.group(1))
    return payload


def _operator_health_watchdog_status() -> dict[str, Any]:
    """Return additive status for the operator health watchdog daemon/report."""
    library_plist_path = HOME / "Library" / "LaunchAgents" / f"{OPERATOR_HEALTH_WATCHDOG_LABEL}.plist"
    run_plist_path = HARNESS_DIR / "run" / "operator-health-watchdog" / f"{OPERATOR_HEALTH_WATCHDOG_LABEL}.plist"
    plist_candidates = [library_plist_path, run_plist_path]
    plist_path = next((path for path in plist_candidates if path.exists()), library_plist_path)
    stdout_log = HARNESS_DIR / "logs" / "operator-health-watchdog.out.log"
    stderr_log = HARNESS_DIR / "logs" / "operator-health-watchdog.err.log"
    latest_path = HARNESS_DIR / "run" / "operator-health-watchdog" / "latest.json"
    payload: dict[str, Any] = {
        "label": OPERATOR_HEALTH_WATCHDOG_LABEL,
        "plist_path": str(plist_path),
        "plist_candidates": [str(path) for path in plist_candidates],
        "installed": any(path.exists() for path in plist_candidates),
        "launchd_loaded": False,
        "last_run_at": None,
        "last_exit_code": None,
        "last_actions": {
            "expired_blocks_pruned": 0,
            "pm_failures_reconciled": 0,
            "graph_nodes_released": 0,
            "stale_leases_released": 0,
            "drain_submitted": 0,
        },
        "blockers": [],
        "degraded_reason": None,
        "latest_report": str(latest_path),
        "stdout_log": str(stdout_log),
        "stderr_log": str(stderr_log),
        "legacy_pruner": _rate_limit_pruner_status(),
    }
    if latest_path.exists():
        try:
            latest = json.loads(latest_path.read_text(encoding="utf-8"))
        except Exception:
            latest = {}
            payload["degraded_reason"] = "latest report unreadable"
            payload["blockers"].append("latest report parse failed")
        if isinstance(latest, dict) and latest:
            summary = latest.get("summary") if isinstance(latest.get("summary"), dict) else {}
            counters = latest.get("counters") if isinstance(latest.get("counters"), dict) else {}
            payload["last_run_at"] = latest.get("finished_at") or latest.get("started_at")
            payload["last_exit_code"] = latest.get("last_exit_code", 0 if latest.get("ok") else None)
            payload["last_actions"] = {
                "expired_blocks_pruned": counters.get("expired_blocks_pruned", summary.get("pruned_blocks", 0)),
                "pm_failures_reconciled": counters.get("pm_failures_reconciled", summary.get("reconcile_count", 0)),
                "graph_nodes_released": counters.get("graph_nodes_released", summary.get("releases", 0)),
                "stale_leases_released": counters.get("stale_leases_released", 0),
                "drain_submitted": counters.get("drain_submitted", summary.get("drain_submitted", 0)),
            }
            blockers = latest.get("blockers")
            if isinstance(blockers, list):
                payload["blockers"] = blockers
            payload["degraded_reason"] = latest.get("degraded_reason")
    else:
        payload["degraded_reason"] = "watchdog latest report missing"
        payload["blockers"].append("missing latest report")

    if shutil.which("launchctl") is None:
        return payload
    try:
        result = subprocess.run(
            ["launchctl", "print", f"{_launchd_domain()}/{OPERATOR_HEALTH_WATCHDOG_LABEL}"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except Exception:
        return payload
    payload["launchd_loaded"] = result.returncode == 0
    return payload


def _operator_block_info(op_id: str, op: dict[str, Any], runtime_state: str, reason: str) -> dict[str, Any]:
    state = op.get("state") if isinstance(op.get("state"), dict) else {}
    status = get_operator_status_data(op_id)
    pm_flow_block = _recent_pm_operator_flow_control_block(op_id)
    strict_log_block = _recent_operator_result_log_quota_block_strict({"operator_id": op_id, **dict(op)})
    shared_block = _shared_recent_operator_quota_block({"operator_id": op_id, **dict(op)})
    evidence_block = pm_flow_block or strict_log_block or shared_block
    quota_state = str(op.get("quota_guard_state") or "").strip().lower()
    expires_at = str(
        ((evidence_block or {}).get("expires_at") if evidence_block else "")
        or op.get("quota_refresh_at")
        or state.get("cooldown_until")
        or status.get("expires_at")
        or ""
    ).strip()
    block_type = "none"
    reason_l = (reason or "").lower()
    state_l = (runtime_state or "").lower()
    match = re.search(r"\(until ([^)]+)\)", reason or "")
    if match and not expires_at:
        expires_at = match.group(1).strip()
    if evidence_block:
        block_type = str(evidence_block.get("runtime_state") or "cooldown")
    elif quota_state in {"cooldown", "quota_exhausted", "auth_expired"}:
        block_type = quota_state
    elif state_l in {"cooldown", "quota_exhausted", "auth_expired"}:
        block_type = state_l
    elif "quota_exhausted" in reason_l:
        block_type = "quota_exhausted"
    elif "auth_expired" in reason_l:
        block_type = "auth_expired"
    elif "cooldown" in reason_l or "rate-limit" in reason_l or "usage limit" in reason_l:
        block_type = "cooldown"
    elif "result_log_quota_block" in reason_l:
        block_type = "cooldown"
    elif "flow_control_auth_expired" in reason_l or "authentication" in reason_l or "api error: 401" in reason_l:
        block_type = "auth_expired"
    elif "health_check_failed" in reason_l or "unavailable:" in reason_l:
        block_type = "health"
    elif state_l in {"leased", "running", "draining"}:
        block_type = "busy"
    elif runtime_state == "disabled" or reason_l.startswith("disabled"):
        block_type = "disabled"
    elif reason:
        block_type = "other"
    effective_quota_state = quota_state or "ok"
    if block_type in {"cooldown", "quota_exhausted", "auth_expired"}:
        effective_quota_state = block_type
    return {
        "block_type": block_type,
        "quota_guard_state": effective_quota_state,
        "cooldown_until": expires_at,
        "cooldown_eta": _format_reset_eta(expires_at),
    }


def _maybe_clear_stale_runtime(operator_id: str, state: str) -> str:
    """Best-effort release of clearly dead leases before declaring a builder busy."""
    if state not in {"leased", "running"}:
        return state
    policy_mod = _load_concurrency_policy_module()
    if policy_mod is None:
        return state
    try:
        recovery = policy_mod.recovery_settings()
        if not bool(recovery.get("auto_clear_stale_dead_pid", True)):
            return state
        stale_seconds = int(recovery.get("stale_runtime_seconds", 900))
    except Exception:
        stale_seconds = 900

    runtime_mod = _load_operator_runtime_module()
    if runtime_mod is None:
        return state
    try:
        lease = runtime_mod.get_operator_lease(operator_id)
    except Exception:
        lease = None
    if not isinstance(lease, dict):
        return state

    leased_at = _parse_utc(str(lease.get("leased_at") or ""))
    now = datetime.datetime.now(datetime.timezone.utc)
    if leased_at is None or (now - leased_at).total_seconds() < stale_seconds:
        return state

    dead_pids: list[str] = []
    for key in ("worker_pid", "daemon_pid"):
        raw = lease.get(key)
        try:
            pid = int(raw) if raw is not None else None
        except Exception:
            pid = None
        if pid is not None and not _pid_exists(pid):
            dead_pids.append(f"{key}={pid}")
    if not dead_pids:
        return state

    try:
        runtime_mod.release_operator_lease(operator_id, reason="builder_pool_dead_pid_recovery")
        return "idle"
    except Exception:
        return state


def _health_cache_path(operator_id: str) -> Path:
    return HARNESS_DIR / "run" / "operator-health" / f"{operator_id}.json"


def _expand_operator_path(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    expanded = os.path.expandvars(raw.replace("$HARNESS_DIR", str(HARNESS_DIR)).replace("${HARNESS_DIR}", str(HARNESS_DIR)))
    return str(Path(expanded).expanduser()) if expanded.startswith(("~", "/")) else expanded


def _read_health_cache(operator_id: str, max_age_seconds: int) -> tuple[bool | None, str]:
    path = _health_cache_path(operator_id)
    if max_age_seconds <= 0 or not path.exists():
        return None, ""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if int(data.get("schema_version", 0)) != HEALTH_CACHE_SCHEMA_VERSION:
            return None, ""
        checked_at = float(data.get("checked_at_epoch", 0))
        if time.time() - checked_at <= max_age_seconds:
            return bool(data.get("ok")), str(data.get("reason") or "")
    except Exception:
        pass
    return None, ""


def _read_any_health_cache(operator_id: str) -> tuple[bool | None, str]:
    path = _health_cache_path(operator_id)
    if not path.exists():
        return None, ""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if int(data.get("schema_version", 0)) != HEALTH_CACHE_SCHEMA_VERSION:
            return None, ""
        return bool(data.get("ok")), str(data.get("reason") or "")
    except Exception:
        return None, ""


def _write_health_cache(operator_id: str, ok: bool, reason: str) -> None:
    path = _health_cache_path(operator_id)
    payload = {
        "schema_version": HEALTH_CACHE_SCHEMA_VERSION,
        "operator_id": operator_id,
        "ok": ok,
        "reason": reason,
        "checked_at": _now(),
        "checked_at_epoch": time.time(),
    }
    tmp = ""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=f"{operator_id}.", suffix=".tmp", dir=str(path.parent))
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        os.replace(tmp, str(path))
    except Exception:
        if tmp:
            try:
                Path(tmp).unlink(missing_ok=True)
            except Exception:
                pass


def _health_check_headers(op: dict[str, Any], health: dict[str, Any]) -> dict[str, str]:
    headers = {"User-Agent": "solar-harness-health/1.0"}
    configured = health.get("headers")
    if isinstance(configured, dict):
        for key, value in configured.items():
            name = str(key or "").strip()
            if name:
                headers[name] = os.path.expandvars(str(value or ""))
    model = str(op.get("model") or "").strip().lower()
    key_ref = str(op.get("key_ref") or "").strip().lower()
    if "thunderomlx" in model or key_ref == "local-thunderomlx":
        token = os.environ.get("THUNDEROMLX_AUTH_TOKEN") or os.environ.get("LOCAL_LLM_API_KEY") or "local-thunderomlx"
        headers.setdefault("Authorization", f"Bearer {token}")
        headers.setdefault("x-api-key", token)
    return headers


def _is_sandbox_permission_health_error(reason: str) -> bool:
    raw = str(reason or "").lower()
    return "operation not permitted" in raw or "errno 1" in raw


def _operator_external_health(op: dict[str, Any]) -> tuple[bool, str]:
    """Check declared command/http health for pool members without hard failing legacy operators."""
    operator_id = str(op.get("operator_id") or "")
    health = op.get("health_check") if isinstance(op.get("health_check"), dict) else {}
    if not health:
        command_path = _expand_operator_path(str(op.get("command_path") or ""))
        if command_path:
            exists = Path(command_path).exists() if command_path.startswith("/") else shutil.which(command_path) is not None
            return (True, "") if exists else (False, f"command_path_missing:{command_path}")
        return True, ""

    policy_mod = _load_concurrency_policy_module()
    try:
        recovery = policy_mod.recovery_settings() if policy_mod else {}
        cache_seconds = int(health.get("cache_seconds", recovery.get("health_cache_seconds", 60)))
    except Exception:
        cache_seconds = 60
    cached_ok, cached_reason = _read_health_cache(operator_id, cache_seconds)
    if cached_ok is not None:
        return cached_ok, cached_reason

    kind = str(health.get("type") or "").strip().lower()
    timeout = float(health.get("timeout_seconds", 0.5))
    if kind == "http":
        url = str(health.get("url") or "").strip()
        if not url:
            result = (False, "health_url_missing")
        else:
            try:
                req = Request(url, headers=_health_check_headers(op, health))
                with urlopen(req, timeout=timeout) as resp:
                    ok = 200 <= int(resp.status) < 500
                    result = (ok, f"http_status={resp.status}")
            except URLError as exc:
                reason = f"http_unreachable:{exc.reason}"
                if _is_sandbox_permission_health_error(reason):
                    cached = _read_any_health_cache(operator_id)
                    return cached if cached[0] is not None else (True, "health_check_skipped:sandbox_permission")
                result = (False, reason)
            except Exception as exc:
                reason = f"http_unreachable:{type(exc).__name__}:{exc}"
                if _is_sandbox_permission_health_error(reason):
                    cached = _read_any_health_cache(operator_id)
                    return cached if cached[0] is not None else (True, "health_check_skipped:sandbox_permission")
                result = (False, f"http_unreachable:{type(exc).__name__}")
    elif kind == "command":
        command_path = _expand_operator_path(str(health.get("command_path") or op.get("command_path") or ""))
        exists = Path(command_path).exists() if command_path.startswith("/") else shutil.which(command_path) is not None
        result = ((True, "") if exists else (False, f"command_path_missing:{command_path or 'N/A'}"))
    else:
        result = (True, "")

    _write_health_cache(operator_id, result[0], result[1])
    return result


def _try_auto_start_operator(op: dict[str, Any]) -> tuple[bool, str]:
    auto_start = op.get("auto_start") if isinstance(op.get("auto_start"), dict) else {}
    if not bool(auto_start.get("enabled", False)):
        return False, "auto_start_not_configured"
    command = str(auto_start.get("command") or "").strip()
    if not command:
        return False, "auto_start_command_missing"
    env = os.environ.copy()
    env["HARNESS_DIR"] = str(HARNESS_DIR)
    expanded = command.replace("$HARNESS_DIR", str(HARNESS_DIR)).replace("${HARNESS_DIR}", str(HARNESS_DIR))
    try:
        proc = subprocess.Popen(
            ["bash", "-lc", expanded],
            cwd=str(HARNESS_DIR),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return True, f"started_pid={proc.pid}"
    except Exception as exc:
        return False, f"auto_start_failed:{type(exc).__name__}:{exc}"


def _format_reset_eta(expires_at: str) -> str:
    """Return a human-readable reset ETA string, or empty string if not available."""
    if not expires_at:
        return ""
    try:
        exp = datetime.datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        now = datetime.datetime.now(datetime.timezone.utc)
        delta = exp - now
        total_secs = int(delta.total_seconds())
        if total_secs <= 0:
            return "soon"
        hours, rem = divmod(total_secs, 3600)
        minutes = rem // 60
        if hours > 0:
            return f"~{hours}h{minutes:02d}m"
        return f"~{minutes}m"
    except Exception:
        return ""


def _shared_quota_block_for_operator(op: dict[str, Any]) -> dict[str, str]:
    """Return active quota/cooldown block inherited from the same billing pool.

    Some reserve operators share the exact subscription/API quota with a primary
    operator but have independent runtime status files. Treating them as
    available after the primary operator hits a limit wastes dispatch attempts.
    """
    operator_id = str(op.get("operator_id") or "")
    billing_pool = str(op.get("billing_pool") or "").strip()
    key_ref = str(op.get("key_ref") or "").strip()
    provider = str(op.get("provider") or "").strip().lower()
    model = str(op.get("model") or "").strip().lower()
    if not billing_pool and not key_ref:
        return {}
    try:
        registry = load_registry()
    except Exception:
        registry = {"operators": {}}
    operators = registry.get("operators") if isinstance(registry.get("operators"), dict) else {}
    now = datetime.datetime.now(datetime.timezone.utc)
    for peer_id, peer_spec in operators.items():
        if str(peer_id) == operator_id or not isinstance(peer_spec, dict):
            continue
        peer_provider = str(peer_spec.get("provider") or "").strip().lower()
        same_pool_name = billing_pool and str(peer_spec.get("billing_pool") or "").strip() == billing_pool
        same_provider_for_pool = not provider or not peer_provider or peer_provider == provider
        same_pool = bool(same_pool_name and same_provider_for_pool)
        # Key refs often represent a broad login/API account. Propagate through
        # key_ref only when provider and model also match; otherwise independent
        # model budget pools such as GPT-5.5 and Codex Spark would block each
        # other despite having separate rate limits.
        same_key = (
            key_ref
            and str(peer_spec.get("key_ref") or "").strip() == key_ref
            and provider
            and model
            and str(peer_spec.get("provider") or "").strip().lower() == provider
            and str(peer_spec.get("model") or "").strip().lower() == model
        )
        if not (same_pool or same_key):
            continue
        peer_op = {"operator_id": str(peer_id), **dict(peer_spec)}
        peer_db_block = _operator_cooldown_db_block(str(peer_id))
        if (
            peer_db_block
            and _cooldown_block_is_quota_like(peer_db_block)
            and _cooldown_block_is_shared_scope(peer_db_block)
        ):
            expires_at = str(peer_db_block.get("expires_at") or "")
            expires_dt = _parse_utc(expires_at)
            if expires_dt is None or expires_dt > now:
                return {
                    "state": str(peer_db_block.get("runtime_state") or "cooldown"),
                    "peer_operator_id": str(peer_id),
                    "expires_at": expires_at,
                    "match": "billing_pool" if same_pool else "key_ref",
                }
        recent_block = _recent_operator_quota_block(peer_op)
        if recent_block and _cooldown_block_is_shared_scope(recent_block):
            expires_at = str(recent_block.get("expires_at") or "")
            expires_dt = _parse_utc(expires_at)
            if expires_dt is None or expires_dt > now:
                return {
                    "state": str(recent_block.get("runtime_state") or "cooldown"),
                    "peer_operator_id": str(peer_id),
                    "expires_at": expires_at,
                    "match": "billing_pool" if same_pool else "key_ref",
                }
        status = get_operator_status_data(str(peer_id))
        state = str(
            status.get("runtime_state")
            or peer_spec.get("quota_guard_state")
            or (peer_spec.get("state") or {}).get("runtime_state")
            or ""
        ).strip().lower()
        if state not in {"cooldown", "quota_exhausted", "auth_expired"}:
            continue
        if _claude_stale_quota_block_without_recent_evidence(peer_op, state):
            continue
        if str(peer_spec.get("quota_guard_state") or "").strip().lower() not in {"cooldown", "quota_exhausted", "auth_expired"}:
            continue
        expires_at = str(
            status.get("expires_at")
            or peer_spec.get("quota_refresh_at")
            or (peer_spec.get("state") or {}).get("cooldown_until")
            or ""
        ).strip()
        expires_dt = _parse_utc(expires_at)
        if expires_dt is not None and expires_dt <= now:
            continue
        return {
            "state": state,
            "peer_operator_id": str(peer_id),
            "expires_at": expires_at,
            "match": "billing_pool" if same_pool else "key_ref",
        }
    return {}


def is_dispatchable(op: dict[str, Any], *, dispatch_surface: str = "one_shot") -> tuple[bool, str]:
    operator_id = str(op.get("operator_id", ""))
    evidence_block = (
        _recent_pm_operator_flow_control_block(operator_id)
        or _recent_operator_result_log_quota_block_strict(op)
        or _shared_recent_operator_quota_block(op)
    )
    if evidence_block:
        expires_at = str(evidence_block.get("expires_at") or "")
        source = str(evidence_block.get("source") or "pm_operator_flow_control")
        reason = f"{source}={evidence_block.get('runtime_state', 'cooldown')}"
        if evidence_block.get("peer_operator_id"):
            reason += f", peer={evidence_block.get('peer_operator_id')}"
        if expires_at:
            reason += f" (until {expires_at})"
        return False, reason
    availability = _load_operator_availability_module()
    if availability is not None and hasattr(availability, "resolve_operator_availability"):
        decision = availability.resolve_operator_availability(
            op,
            cooldown_block_fn=_operator_cooldown_db_block,
            recent_quota_block_fn=_recent_operator_quota_block,
            runtime_state_fn=get_operator_runtime_state,
            status_data_fn=get_operator_status_data,
            registry_fn=load_registry,
            stale_runtime_fn=lambda op_id, state: _maybe_clear_stale_runtime(str(op_id), str(state)),
            dispatch_surface=dispatch_surface,
        )
        if not bool(decision.get("dispatchable")):
            return False, str(decision.get("reason") or f"runtime_state={decision.get('state', 'unknown')}")
    else:
        state = get_operator_runtime_state(operator_id)
        state = _maybe_clear_stale_runtime(str(operator_id), state)
        if state in {"cooldown", "quota_exhausted"} and operator_id in _POSITIVE_QUOTA_RECOVERY_CACHE:
            state = "idle"
        if state in NON_DISPATCHABLE_STATES:
            return False, f"runtime_state={state}"
    actor_state = _actor_lease_runtime_state(operator_id)
    if dispatch_surface != "mailbox" and actor_state in {"leased", "running", "finalizing", "draining"}:
        return False, f"actor_lease_state={actor_state}"
    health_ok, health_reason = _operator_external_health(op)
    if not health_ok:
        return False, f"health_check_failed: {health_reason}"
    surface_reject = _operator_reject_reason_for_task(
        op,
        str(op.get("role") or ""),
        "",
        dispatch_surface=dispatch_surface,
    )
    if surface_reject:
        return False, surface_reject
    return True, ""


def _actor_lease_runtime_state(operator_id: str) -> str:
    if not operator_id:
        return ""
    path = ACTOR_LEASE_DIR / f"{operator_id}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return ""
    state = str(data.get("state") or "").strip().lower()
    if state in {"leased", "running", "finalizing", "draining"}:
        now = datetime.datetime.now(datetime.timezone.utc)
        expires_at = _parse_utc(str(data.get("expires_at") or ""))
        if expires_at is not None and expires_at <= now:
            return ""
        last_heartbeat_at = _parse_utc(str(data.get("last_heartbeat_at") or ""))
        heartbeat_timeout = int(data.get("heartbeat_timeout_sec") or 0)
        if last_heartbeat_at is not None and heartbeat_timeout > 0:
            if (now - last_heartbeat_at).total_seconds() > heartbeat_timeout:
                return ""
    if state == "leased":
        return "leased"
    if state == "running":
        return "running"
    if state == "finalizing":
        return "finalizing"
    if state == "draining":
        return "draining"
    return ""


def _is_dispatchable_on_surface(op: dict[str, Any], dispatch_surface: str) -> tuple[bool, str]:
    try:
        return is_dispatchable(op, dispatch_surface=dispatch_surface)
    except TypeError:
        return is_dispatchable(op)  # tests may monkeypatch the legacy one-arg shape


def load_task_graph_node(sprint_id: str, node_id: str) -> dict[str, Any] | None:
    path = SPRINTS_DIR / f"{sprint_id}.task_graph.json"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    for node in payload.get("nodes", []) or []:
        if str(node.get("id")) == node_id:
            return dict(node)
    return None


def _capsule_submit_metadata(node: dict[str, Any] | None) -> dict[str, Any]:
    if not node:
        return {}
    capsule_plan = dict(node.get("capsule_plan") or {})
    dispatch_task_type = node.get("dispatch_task_type") or capsule_plan.get("dispatch_task_type")
    if not (
        node.get("capability_native")
        or node.get("capability_capsule_id")
        or node.get("execution_capsule_id")
        or node.get("capsule_plan")
    ):
        return {}
    if (node.get("capability_capsule_id") or node.get("execution_capsule_id") or capsule_plan.get("capability_capsule_id")) and not dispatch_task_type:
        return {}
    return {
        "capability_native": bool(node.get("capability_native", True)),
        "capability_capsule_id": node.get("capability_capsule_id") or capsule_plan.get("capability_capsule_id"),
        "dispatch_task_type": dispatch_task_type,
        "logical_operator": node.get("logical_operator", ""),
        "capsule_plan": capsule_plan,
    }


def _resolve_sprint_artifact_path(raw: str) -> Path:
    path = Path(str(raw or "")).expanduser()
    if path.is_absolute():
        return path
    if path.parts and path.parts[0] == "sprints":
        return HARNESS_DIR / path
    return SPRINTS_DIR / path


def _load_node_physical_plan(node: dict[str, Any] | None) -> dict[str, Any]:
    if not node:
        return {}
    inline = node.get("physical_plan_ir") or node.get("physical_plan")
    if isinstance(inline, dict):
        return dict(inline)
    artifacts = node.get("artifacts") if isinstance(node.get("artifacts"), dict) else {}
    raw_path = str(
        node.get("physical_plan_ir_path")
        or artifacts.get("physical_plan_ir")
        or artifacts.get("physical_plan_ir_path")
        or ""
    ).strip()
    if not raw_path:
        return {}
    path = _resolve_sprint_artifact_path(raw_path)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _capsule_submit_metadata_for_role(node: dict[str, Any] | None, role: str) -> dict[str, Any]:
    metadata = _capsule_submit_metadata(node)
    if normalize_role(role) != "evaluator":
        return metadata
    physical_plan = _load_node_physical_plan(node)
    verifier_plans = physical_plan.get("verifier_plans") if isinstance(physical_plan.get("verifier_plans"), list) else []
    for plan in verifier_plans:
        if not isinstance(plan, dict):
            continue
        capsule_id = str(plan.get("capability_capsule_id") or "").strip()
        if not capsule_id:
            continue
        metadata = dict(metadata)
        metadata["capability_native"] = True
        metadata["capability_capsule_id"] = capsule_id
        metadata["dispatch_task_type"] = str(plan.get("task_type") or metadata.get("dispatch_task_type") or "")
        metadata["evaluator_capsule_source"] = "physical_plan.verifier_plans"
        return metadata
    return metadata


# ── 算子选择 ──────────────────────────────────────────────────────────────────

def normalize_role(role: str) -> str:
    r = role.strip().lower().replace("_", "-")
    return ROLE_ALIASES.get(r, r)


def _operator_roles(op: dict[str, Any]) -> set[str]:
    raw_roles = op.get("roles")
    if isinstance(raw_roles, str):
        values = [raw_roles]
    elif isinstance(raw_roles, list):
        values = raw_roles
    else:
        values = [op.get("role", "")]
    roles = {normalize_role(str(item)) for item in values if str(item or "").strip()}
    role = str(op.get("role") or "").strip()
    if role:
        roles.add(normalize_role(role))
    return roles


def _task_type_rejected(op: dict[str, Any], task_type: str) -> bool:
    if not task_type:
        return False
    rejected_types = [str(t).lower() for t in op.get("rejected_task_types", [])]
    return any(task_type.lower() == rt or task_type.lower() in rt for rt in rejected_types)


_NON_EVAL_CLOSEOUT_ARTIFACT_MARKERS = {
    "artifact.guard_decision",
    "artifact.resource_binding",
    "artifact.bridged_artifact",
    "artifact.patch_diff",
    "artifact.handoff_md",
    "guard_decision",
    "resource_binding",
    "bridged_artifact",
    "patch_diff",
    "handoff_md",
    "rollout_notes",
}


def _capsule_requires_non_eval_closeout_write(resolved_capsule: dict[str, Any] | None) -> bool:
    if not isinstance(resolved_capsule, dict):
        return False
    artifact_types = resolved_capsule.get("artifact_types")
    if isinstance(artifact_types, dict):
        for key in ("required_outputs", "produces", "optional_outputs"):
            values = artifact_types.get(key)
            if not isinstance(values, list):
                continue
            for value in values:
                text = str(value or "").strip().lower()
                if any(marker in text for marker in _NON_EVAL_CLOSEOUT_ARTIFACT_MARKERS):
                    return True
    for obligation in resolved_capsule.get("proof_obligations") or []:
        if isinstance(obligation, dict):
            text = " ".join(str(obligation.get(key) or "") for key in ("requirement", "field", "check")).lower()
        else:
            text = str(obligation or "").lower()
        if any(marker in text for marker in _NON_EVAL_CLOSEOUT_ARTIFACT_MARKERS):
            return True
    return False


def _operator_reject_reason_for_task(
    op: dict[str, Any],
    role: str,
    task_type: str,
    resolved_capsule: dict[str, Any] | None = None,
    dispatch_surface: str = "one_shot",
) -> str:
    """Hard guard for advisory-only operators.

    Some operators can critique plans and analyze failures but cannot prove file
    edits. The registry declares that through avoid_for / builder_pool metadata;
    dispatch must enforce it even when an operator is explicitly requested.
    """
    norm_role = normalize_role(role)
    task = str(task_type or "").strip().lower()
    policy = op.get("policy") if isinstance(op.get("policy"), dict) else {}
    surface = op.get("surface") if isinstance(op.get("surface"), dict) else {}
    provider = str(op.get("provider") or "").strip().lower()
    backend = str(op.get("backend") or "").strip().lower()
    surface_type = str(surface.get("type") or "").strip().lower()
    launch_cmd_kind = str(op.get("launch_cmd_kind") or "").strip().lower()
    auth_mode = str(op.get("auth_mode") or "").strip().lower()
    key_ref = str(op.get("key_ref") or "").strip().lower()
    billing_surface = str(op.get("billing_surface") or "").strip().lower()
    billing_pool = str(op.get("billing_pool") or "").strip().lower()
    claude_interactive_subscription = _operator_is_claude_subscription_interactive(op)
    surface_name = str(dispatch_surface or "one_shot").strip().lower()
    if claude_interactive_subscription and surface_name not in {"actor_runtime", "mailbox", "tmux", "tmux_mailbox"}:
        return "claude_subscription_interactive_requires_tmux_repl"

    write_files = str(policy.get("write_files") or "").strip().lower()
    if norm_role == "planner" and write_files in {"denied", "eval_sidecar_only", "artifact_dir_only", "restricted"}:
        return "operator_cannot_write_planner_artifacts"
    profile = str(op.get("profile") or "").strip().lower()
    declared_role = normalize_role(str(op.get("role") or ""))
    operator_class = str(op.get("operator_class") or "").strip().lower()
    if (
        norm_role == "evaluator"
        and (declared_role == "advisor" or profile.endswith("-advisory") or operator_class == "advisoryreview")
        and task not in {"advisory", "analysis", "root-cause", "architecture-review", "decision-review"}
    ):
        return "operator_advisory_only_cannot_final_evaluate"

    if (
        norm_role in {"builder", "evaluator"}
        and _capsule_requires_non_eval_closeout_write(resolved_capsule)
        and write_files in {"denied", "eval_sidecar_only", "artifact_dir_only"}
    ):
        return "operator_cannot_write_required_closeout_artifacts"

    requested_code_exec = norm_role in CODE_EXEC_ROLES or task in CODE_EXEC_TASK_TYPES
    if not requested_code_exec:
        return ""

    avoid_for = {str(item).strip().lower() for item in op.get("avoid_for", []) if str(item or "").strip()}
    if avoid_for & CODE_EXEC_AVOID_MARKERS:
        return "operator_avoids_code_execution"

    pool = op.get("builder_pool") if isinstance(op.get("builder_pool"), dict) else {}
    disabled_reason = str(pool.get("disabled_reason") or "")
    if bool(pool) and not bool(pool.get("enabled", False)) and "file_execution" in disabled_reason:
        return "operator_not_verified_for_code_execution"

    return ""


def _operator_is_claude_subscription_interactive(op: dict[str, Any]) -> bool:
    surface = op.get("surface") if isinstance(op.get("surface"), dict) else {}
    provider = str(op.get("provider") or "").strip().lower()
    backend = str(op.get("backend") or "").strip().lower()
    surface_type = str(surface.get("type") or "").strip().lower()
    launch_cmd_kind = str(op.get("launch_cmd_kind") or "").strip().lower()
    auth_mode = str(op.get("auth_mode") or "").strip().lower()
    key_ref = str(op.get("key_ref") or "").strip().lower()
    billing_surface = str(op.get("billing_surface") or "").strip().lower()
    billing_pool = str(op.get("billing_pool") or "").strip().lower()
    return bool(
        (provider == "anthropic" or backend == "claude-cli" or surface_type == "claude_code_interactive")
        and (launch_cmd_kind == "interactive_repl" or surface_type == "claude_code_interactive")
        and (
            auth_mode == "subscription"
            or "subscription" in key_ref
            or "subscription_interactive" in billing_surface
            or "subscription_interactive" in billing_pool
        )
    )


def _active_role_spillover_count(role: str) -> int:
    norm_role = normalize_role(role)
    active_statuses = {"submitted", "submitted_fallback", "leased", "running", "pending"}
    active_runtime_states = {"leased", "running", "draining"}
    count = 0
    for payload in _iter_pm_inbox_projections():
        status = str(payload.get("status") or "").strip().lower()
        if status not in active_statuses:
            continue
        if normalize_role(str(payload.get("borrowed_for_role") or "")) == norm_role:
            operator_id = str(payload.get("operator_id") or "").strip()
            if operator_id:
                runtime_state = get_operator_runtime_state(operator_id)
                if status in {"submitted", "submitted_fallback", "pending"} and runtime_state not in active_runtime_states:
                    continue
            count += 1
    return count


ACTIVE_PM_OPERATOR_STATUSES = {"submitted", "submitted_fallback", "leased", "running", "pending", "in_progress"}


def _active_pm_count_for_operator(operator_id: str, role: str = "") -> int:
    operator_id = str(operator_id or "").strip()
    if not operator_id:
        return 0
    norm_role = normalize_role(role) if role else ""
    count = 0
    for payload in _iter_pm_inbox_projections():
        if str(payload.get("operator_id") or "").strip() != operator_id:
            continue
        status = str(payload.get("status") or "").strip().lower()
        if status not in ACTIVE_PM_OPERATOR_STATUSES:
            continue
        if norm_role:
            task_role = normalize_role(str(payload.get("requested_role") or payload.get("borrowed_for_role") or ""))
            if task_role and task_role != norm_role:
                continue
        count += 1
    return count


def _operator_active_task_limit(op: dict[str, Any]) -> int:
    pool = op.get("builder_pool") if isinstance(op.get("builder_pool"), dict) else {}
    for payload in (pool, op):
        for key in ("max_active_tasks", "max_concurrent_tasks", "concurrency", "capacity"):
            try:
                value = int(payload.get(key, 0) or 0)
            except Exception:
                value = 0
            if value > 0:
                return value
    return 1


def _role_spillover_spec(policy_mod: Any | None, policy: dict[str, Any], role: str) -> dict[str, Any]:
    if policy_mod is None:
        return {}
    try:
        if not bool(policy_mod.role_spillover_enabled(role, policy)):
            return {}
        return dict(policy_mod.role_spillover_spec(role, policy))
    except Exception:
        return {}


def _operator_priority(
    *,
    op: dict[str, Any],
    op_id: str,
    norm_role: str,
    task_type: str,
    logical_operator: str,
    preferred_ops: set[str],
    default_profile: str,
    pool_mode: bool,
    policy_mod: Any | None,
    policy: dict[str, Any],
    spillover_spec: dict[str, Any] | None = None,
) -> int:
    kind = str(op.get("launch_cmd_kind", "") or op.get("backend", ""))
    if pool_mode and policy_mod:
        group = policy_mod.infer_builder_group(op)
        pool_spec = op.get("builder_pool") if isinstance(op.get("builder_pool"), dict) else {}
        try:
            op_pool_priority = int(pool_spec.get("priority", 0))
        except Exception:
            op_pool_priority = 0
        priority = 100 + policy_mod.pool_group_priority(group, policy) + op_pool_priority
        if "print_once" in kind or "print" in kind:
            priority += 6
        elif "command" in kind:
            priority += 4
        else:
            priority += 1
    else:
        if "print_once" in kind or "print" in kind:
            priority = 10
        elif "command" in kind:
            priority = 5
        else:
            priority = 1

    if task_type:
        task_classes = [str(t).lower() for t in op.get("task_classes", [])]
        if any(task_type.lower() in tc for tc in task_classes):
            priority += 3
    preferred_for = [str(item).lower() for item in op.get("preferred_for", [])]
    if logical_operator and logical_operator.lower() in preferred_for:
        priority += 2
    if norm_role in preferred_for:
        priority += 2
    if preferred_ops and op_id in preferred_ops:
        priority += 20
    if default_profile and (op_id == default_profile or str(op.get("profile", "")) == default_profile):
        priority += 8

    if spillover_spec and policy_mod:
        group = policy_mod.infer_builder_group(op)
        preferred_groups = [str(g).lower() for g in spillover_spec.get("preferred_groups", [])]
        if preferred_groups:
            if group in preferred_groups:
                priority += 40 + max(0, len(preferred_groups) - preferred_groups.index(group))
            else:
                priority -= 10
    return priority


def _role_spillover_candidates(
    *,
    operators: dict[str, Any],
    norm_role: str,
    task_type: str,
    logical_operator: str,
    preferred_ops: set[str],
    forbidden_ops: set[str],
    default_profile: str,
    policy_mod: Any | None,
    policy: dict[str, Any],
    spillover_spec: dict[str, Any],
    resolved_capsule: dict[str, Any] | None = None,
    dispatch_surface: str = "one_shot",
) -> tuple[list[tuple[int, str, dict[str, Any]]], str]:
    max_active = int(spillover_spec.get("max_active", 0) or 0)
    if max_active <= 0:
        return [], f"role_spillover_disabled_or_zero_capacity: {norm_role}"
    active = _active_role_spillover_count(norm_role)
    if active >= max_active:
        return [], f"role_spillover_capacity_reached: {norm_role} active={active} max={max_active}"

    allowed_source_roles = {
        normalize_role(str(r))
        for r in spillover_spec.get("allowed_source_roles", [])
        if str(r or "").strip()
    }
    if not allowed_source_roles:
        return [], f"role_spillover_no_source_roles: {norm_role}"

    allowed_groups = {str(g).lower() for g in spillover_spec.get("allowed_groups", []) if str(g or "").strip()}
    candidates: list[tuple[int, str, dict[str, Any]]] = []
    for op_id, spec in operators.items():
        op = dict(spec)
        op["operator_id"] = op_id
        if op_id in forbidden_ops:
            continue
        op_roles = _operator_roles(op)
        if norm_role in op_roles:
            continue
        if not (op_roles & allowed_source_roles):
            continue
        if allowed_groups and policy_mod and policy_mod.infer_builder_group(op) not in allowed_groups:
            continue
        ok, _ = _is_dispatchable_on_surface(op, dispatch_surface)
        if not ok:
            continue
        if _task_type_rejected(op, task_type):
            continue
        if _operator_reject_reason_for_task(op, norm_role, task_type, resolved_capsule, dispatch_surface=dispatch_surface):
            continue
        borrowed = dict(op)
        borrowed["borrowed_for_role"] = norm_role
        borrowed["borrowed_from_roles"] = sorted(op_roles)
        borrowed["borrowed_original_role"] = str(op.get("role") or "")
        borrowed["borrowed_reason"] = str(spillover_spec.get("reason") or "")
        borrowed["role"] = norm_role
        borrowed["roles"] = sorted(op_roles | {norm_role})
        borrowed["persona"] = norm_role
        priority = _operator_priority(
            op=borrowed,
            op_id=op_id,
            norm_role=norm_role,
            task_type=task_type,
            logical_operator=logical_operator,
            preferred_ops=preferred_ops,
            default_profile=default_profile,
            pool_mode=False,
            policy_mod=policy_mod,
            policy=policy,
            spillover_spec=spillover_spec,
        )
        candidates.append((priority, op_id, borrowed))
    return candidates, ""


LAST_OPERATOR_SELECTION_DIAGNOSTICS: dict[str, Any] = {}


def _compact_operator_candidate(
    *,
    priority: int,
    operator_id: str,
    operator: dict[str, Any],
    policy_mod: Any | None,
    selected: bool = False,
) -> dict[str, Any]:
    group = ""
    if policy_mod is not None:
        try:
            group = str(policy_mod.infer_builder_group(operator) or "")
        except Exception:
            group = ""
    return {
        "operator_id": operator_id,
        "priority": priority,
        "selected": bool(selected),
        "group": group,
        "roles": sorted(_operator_roles(operator)),
        "model": str(operator.get("model") or "N/A"),
        "provider": str(operator.get("provider") or "N/A"),
        "runtime_state": get_operator_runtime_state(operator_id),
        "quota_guard_state": str(operator.get("quota_guard_state") or "ok"),
        "borrowed_for_role": str(operator.get("borrowed_for_role") or ""),
    }


def _record_operator_selection_success(
    *,
    source: str,
    norm_role: str,
    task_type: str,
    logical_operator: str,
    pool_mode: bool,
    candidates: list[tuple[int, str, dict[str, Any]]],
    selected_operator_id: str,
    selected_priority: int,
    policy_mod: Any | None,
    fallback_reason: str = "",
    limit: int = 20,
) -> None:
    sorted_candidates = sorted(candidates, key=lambda x: (-x[0], x[1]))
    _record_operator_selection_diagnostics(
        {
            "source": source,
            "role": norm_role,
            "task_type": task_type,
            "logical_operator": logical_operator,
            "pool_mode": pool_mode,
            "selected_operator_id": selected_operator_id,
            "selected_priority": selected_priority,
            "fallback_reason": fallback_reason,
            "candidate_count": len(sorted_candidates),
            "candidates": [
                _compact_operator_candidate(
                    priority=priority,
                    operator_id=op_id,
                    operator=op,
                    policy_mod=policy_mod,
                    selected=(op_id == selected_operator_id),
                )
                for priority, op_id, op in sorted_candidates[:limit]
            ],
            "truncated": len(sorted_candidates) > limit,
        }
    )


def _dispatch_ledger_selection_summary(selection_diagnostics: dict[str, Any]) -> dict[str, Any]:
    if not selection_diagnostics:
        return {}
    return {
        "source": selection_diagnostics.get("source", ""),
        "selected_operator_id": selection_diagnostics.get("selected_operator_id", ""),
        "selected_priority": selection_diagnostics.get("selected_priority", ""),
        "candidate_count": selection_diagnostics.get("candidate_count", ""),
        "pool_mode": selection_diagnostics.get("pool_mode", False),
        "excluded_counts": selection_diagnostics.get("excluded_counts", {}),
    }


def _write_dispatch_ledger_event(event: dict[str, Any]) -> None:
    """Append a best-effort PM dispatch audit event without blocking dispatch."""
    try:
        payload = {
            "ts": _now(),
            "schema_version": "pm_dispatch_selection.v1",
            **dict(event),
        }
        DISPATCH_LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
        with DISPATCH_LEDGER_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")
    except Exception as exc:
        print(f"WARNING: failed to write dispatch ledger: {exc}", file=sys.stderr)


def _operator_selection_diagnostics(
    *,
    operators: dict[str, Any],
    norm_role: str,
    task_type: str,
    logical_operator: str,
    preferred_ops: set[str],
    forbidden_ops: set[str],
    default_profile: str,
    pool_mode: bool,
    pool_member_ids: set[str],
    policy_mod: Any | None,
    policy: dict[str, Any],
    resolved_capsule: dict[str, Any] | None,
    dispatch_surface: str = "one_shot",
    limit: int = 80,
) -> dict[str, Any]:
    """Explain why operator selection had no dispatchable candidates."""

    rows: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    pool_members_seen = 0

    def add_count(reason: str) -> None:
        counts[reason] = counts.get(reason, 0) + 1

    for op_id, spec in operators.items():
        op = dict(spec)
        op["operator_id"] = op_id
        group = ""
        if policy_mod is not None:
            try:
                group = str(policy_mod.infer_builder_group(op) or "")
            except Exception:
                group = ""
        op_roles = sorted(_operator_roles(op))
        is_pool_member = op_id in pool_member_ids
        if is_pool_member:
            pool_members_seen += 1

        should_show = is_pool_member or norm_role in op_roles or op_id in preferred_ops
        if not should_show:
            continue

        reason = ""
        ok, unavailable_reason = _is_dispatchable_on_surface(op, dispatch_surface)
        if op_id in forbidden_ops:
            reason = "forbidden_by_policy_or_env"
        elif not ok:
            reason = f"unavailable:{unavailable_reason or 'unknown'}"
        elif norm_role not in op_roles:
            reason = "role_mismatch"
        elif pool_mode and not is_pool_member:
            reason = "not_builder_pool_member"
        elif _task_type_rejected(op, task_type):
            reason = "task_type_rejected"
        else:
            task_reject = _operator_reject_reason_for_task(
                op,
                norm_role,
                task_type,
                resolved_capsule,
                dispatch_surface=dispatch_surface,
            )
            active_count = _active_pm_count_for_operator(op_id, norm_role)
            active_limit = _operator_active_task_limit(op)
            if task_reject:
                reason = task_reject
            elif active_count >= active_limit:
                reason = f"operator_active_task_limit_reached:{active_count}/{active_limit}"
            else:
                reason = "candidate"

        add_count(reason.split(":", 1)[0])
        if len(rows) >= limit:
            continue
        rows.append(
            {
                "operator_id": op_id,
                "reason": reason,
                "group": group,
                "roles": op_roles,
                "enabled": bool(op.get("enabled", False)),
                "available": bool(op.get("available", False)),
                "runtime_state": get_operator_runtime_state(op_id),
                "quota_guard_state": str(op.get("quota_guard_state") or "ok"),
                "model": str(op.get("model") or "N/A"),
                "pool_member": bool(is_pool_member),
            }
        )

    return {
        "role": norm_role,
        "task_type": task_type,
        "logical_operator": logical_operator,
        "pool_mode": pool_mode,
        "pool_member_count": pool_members_seen,
        "excluded_counts": counts,
        "candidate_exclusions": rows,
        "truncated": len(rows) >= limit,
    }


def _record_operator_selection_diagnostics(payload: dict[str, Any]) -> None:
    global LAST_OPERATOR_SELECTION_DIAGNOSTICS
    LAST_OPERATOR_SELECTION_DIAGNOSTICS = dict(payload)


def _print_operator_selection_diagnostics() -> None:
    if not LAST_OPERATOR_SELECTION_DIAGNOSTICS:
        return
    print(
        "SOLAR_PM_SELECTION_DIAGNOSTICS="
        + json.dumps(LAST_OPERATOR_SELECTION_DIAGNOSTICS, ensure_ascii=False, sort_keys=True),
        file=sys.stderr,
    )


def select_operator_by_role(
    role: str,
    task_type: str = "",
    prefer_operator: str = "",
    resolved_capsule: dict[str, Any] | None = None,
    logical_operator: str = "",
    dispatch_surface: str = "one_shot",
) -> tuple[str, dict[str, Any], str]:
    """选择最合适的可调度算子。

    Returns:
        (operator_id, operator_config, fallback_reason)
    """
    registry = load_registry()
    operators = registry.get("operators", {})
    norm_role = normalize_role(role)
    policy_mod = _load_concurrency_policy_module()
    policy = policy_mod.load_policy() if policy_mod else {}
    pool_enabled = bool(policy_mod.builder_pool_enabled(policy) if policy_mod else False)
    pool_member_ids = set(policy_mod.pool_member_ids(registry) if policy_mod else [])
    pool_mode = norm_role == "builder" and pool_enabled and bool(pool_member_ids)
    capsule_constraints = dict((resolved_capsule or {}).get("operator_constraints") or {})
    preferred_ops = set(capsule_constraints.get("preferred", []) or [])
    forbidden_ops = set(capsule_constraints.get("forbidden", []) or [])
    env_excluded_ops = {
        item.strip()
        for item in os.environ.get("SOLAR_PM_OPERATOR_EXCLUDE_IDS", "").split(",")
        if item.strip()
    }
    forbidden_ops.update(env_excluded_ops)
    default_profile = str(capsule_constraints.get("default_operator_profile") or "")
    _record_operator_selection_diagnostics({})

    # 1. 指定 operator 优先
    if prefer_operator:
        if prefer_operator in operators:
            op = dict(operators[prefer_operator])
            op["operator_id"] = prefer_operator
            if normalize_role(str(op.get("role") or "")) != norm_role:
                op["selected_for_role"] = norm_role
            task_reject_reason = _operator_reject_reason_for_task(
                op,
                norm_role,
                task_type,
                resolved_capsule,
                dispatch_surface=dispatch_surface,
            )
            active_count = _active_pm_count_for_operator(prefer_operator, norm_role)
            active_limit = _operator_active_task_limit(op)
            if active_count >= active_limit:
                task_reject_reason = f"operator_active_task_limit_reached:{active_count}/{active_limit}"
            if task_reject_reason:
                _record_operator_selection_diagnostics(
                    {
                        "source": "preferred_operator",
                        "role": norm_role,
                        "task_type": task_type,
                        "logical_operator": logical_operator,
                        "selected_operator_id": "",
                        "candidate_count": 1,
                        "rejected_operator_id": prefer_operator,
                        "rejection_reason": task_reject_reason,
                    }
                )
                return "", {}, f"preferred_operator_rejected_for_task: {prefer_operator}: {task_reject_reason}"
            ok, reason = _is_dispatchable_on_surface(op, dispatch_surface)
            if ok:
                _record_operator_selection_success(
                    source="preferred_operator",
                    norm_role=norm_role,
                    task_type=task_type,
                    logical_operator=logical_operator,
                    pool_mode=pool_mode,
                    candidates=[(10_000, prefer_operator, op)],
                    selected_operator_id=prefer_operator,
                    selected_priority=10_000,
                    policy_mod=policy_mod,
                )
                return prefer_operator, op, ""
            else:
                _record_operator_selection_diagnostics(
                    {
                        "source": "preferred_operator",
                        "role": norm_role,
                        "task_type": task_type,
                        "logical_operator": logical_operator,
                        "selected_operator_id": "",
                        "candidate_count": 1,
                        "rejected_operator_id": prefer_operator,
                        "rejection_reason": reason,
                    }
                )
                return "", {}, f"preferred_operator_unavailable: {prefer_operator}: {reason}"
        _record_operator_selection_diagnostics(
            {
                "source": "preferred_operator",
                "role": norm_role,
                "task_type": task_type,
                "logical_operator": logical_operator,
                "selected_operator_id": "",
                "candidate_count": 0,
                "rejection_reason": "preferred_operator_not_found",
                "requested_operator_id": prefer_operator,
            }
        )
        return "", {}, f"preferred_operator_not_found: {prefer_operator}"

    # 2. 按 role 过滤；builder 默认从显式 builder_pool 中挑可用算子。
    candidates: list[tuple[int, str, dict[str, Any]]] = []
    for op_id, spec in operators.items():
        op = dict(spec)
        op["operator_id"] = op_id
        ok, _ = _is_dispatchable_on_surface(op, dispatch_surface)
        if not ok:
            continue
        if op_id in forbidden_ops:
            continue
        op_roles = _operator_roles(op)
        if norm_role not in op_roles:
            continue
        if normalize_role(str(op.get("role") or "")) != norm_role:
            op["selected_for_role"] = norm_role
        if pool_mode and op_id not in pool_member_ids:
            continue
        # Hard-reject: operators may declare task types they will not accept.
        # This prevents stub/print-once operators from receiving complex tasks
        # (e.g. runtime-hardening, implementation, refactor) that require a
        # long-running interactive session.
        if _task_type_rejected(op, task_type):
            continue
        if _operator_reject_reason_for_task(op, norm_role, task_type, resolved_capsule, dispatch_surface=dispatch_surface):
            continue
        active_count = _active_pm_count_for_operator(op_id, norm_role)
        active_limit = _operator_active_task_limit(op)
        if active_count >= active_limit:
            continue
        # 评分：builder pool 用统一池优先级；旧模式保留 print_once > command > interactive_repl。
        priority = _operator_priority(
            op=op,
            op_id=op_id,
            norm_role=norm_role,
            task_type=task_type,
            logical_operator=logical_operator,
            preferred_ops=preferred_ops,
            default_profile=default_profile,
            pool_mode=pool_mode,
            policy_mod=policy_mod,
            policy=policy,
        )
        candidates.append((priority, op_id, op))

    if not candidates:
        spillover_spec = _role_spillover_spec(policy_mod, policy, norm_role)
        if spillover_spec and not prefer_operator:
            spillover_candidates, spillover_reason = _role_spillover_candidates(
                operators=operators,
                norm_role=norm_role,
                task_type=task_type,
                logical_operator=logical_operator,
                preferred_ops=preferred_ops,
                forbidden_ops=forbidden_ops,
                default_profile=default_profile,
                policy_mod=policy_mod,
                policy=policy,
                spillover_spec=spillover_spec,
                resolved_capsule=resolved_capsule,
                dispatch_surface=dispatch_surface,
            )
            if spillover_candidates:
                spillover_candidates.sort(key=lambda x: -x[0])
                best_priority, best_id, best_op = spillover_candidates[0]
                _record_operator_selection_success(
                    source="spillover_candidates",
                    norm_role=norm_role,
                    task_type=task_type,
                    logical_operator=logical_operator,
                    pool_mode=pool_mode,
                    candidates=spillover_candidates,
                    selected_operator_id=best_id,
                    selected_priority=best_priority,
                    policy_mod=policy_mod,
                )
                return best_id, best_op, ""
            if spillover_reason:
                return "", {}, f"no_dispatchable_operator_for_role: {norm_role}; {spillover_reason}"
        if pool_mode:
            _record_operator_selection_diagnostics(
                _operator_selection_diagnostics(
                    operators=operators,
                    norm_role=norm_role,
                    task_type=task_type,
                    logical_operator=logical_operator,
                    preferred_ops=preferred_ops,
                    forbidden_ops=forbidden_ops,
                    default_profile=default_profile,
                    pool_mode=pool_mode,
                    pool_member_ids=pool_member_ids,
                    policy_mod=policy_mod,
                    policy=policy,
                    resolved_capsule=resolved_capsule,
                    dispatch_surface=dispatch_surface,
                )
            )
            return "", {}, f"no_dispatchable_operator_for_role: {norm_role}; builder_pool_depleted"
        _record_operator_selection_diagnostics(
            _operator_selection_diagnostics(
                operators=operators,
                norm_role=norm_role,
                task_type=task_type,
                logical_operator=logical_operator,
                preferred_ops=preferred_ops,
                forbidden_ops=forbidden_ops,
                default_profile=default_profile,
                pool_mode=pool_mode,
                pool_member_ids=pool_member_ids,
                policy_mod=policy_mod,
                policy=policy,
                resolved_capsule=resolved_capsule,
                dispatch_surface=dispatch_surface,
            )
        )
        return "", {}, f"no_dispatchable_operator_for_role: {norm_role}"

    candidates.sort(key=lambda x: -x[0])
    best_priority, best_id, best_op = candidates[0]
    _record_operator_selection_success(
        source="primary_candidates",
        norm_role=norm_role,
        task_type=task_type,
        logical_operator=logical_operator,
        pool_mode=pool_mode,
        candidates=candidates,
        selected_operator_id=best_id,
        selected_priority=best_priority,
        policy_mod=policy_mod,
    )
    return best_id, best_op, ""


# ── Dispatch 文件构建 ──────────────────────────────────────────────────────────

def persona_text(persona: str) -> tuple[str, str]:
    path = PERSONAS_DIR / f"{persona}.md"
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
        return str(path), text[:10000]
    except Exception:
        return str(path), "N/A"


def build_pm_dispatch_text(
    task_id: str,
    operator_id: str,
    operator: dict[str, Any],
    objective: str,
    sprint_id: str,
    node_id: str,
    result_path: str,
    context: str = "",
) -> str:
    persona_name = str(operator.get("borrowed_for_role") or operator.get("selected_for_role") or operator.get("persona") or operator.get("role") or "builder")
    persona_path, persona_body = persona_text(persona_name)
    harness = HARNESS_DIR / "solar-harness.sh"
    borrow_block = ""
    if operator.get("borrowed_for_role"):
        borrow_block = (
            f"Borrowed for role: `{operator.get('borrowed_for_role')}`\n"
            f"Borrowed from roles: `{', '.join(operator.get('borrowed_from_roles') or [])}`\n"
        )

    ctx_block = ""
    if context.strip():
        ctx_block = f"\n## PM Context\n\n{context.strip()}\n"

    eval_closeout_block = ""
    if normalize_role(persona_name) == "evaluator" and sprint_id and node_id:
        eval_md = SPRINTS_DIR / f"{sprint_id}.{node_id}-eval.md"
        eval_json = SPRINTS_DIR / f"{sprint_id}.{node_id}-eval.json"
        eval_closeout_block = f"""
        评审任务还必须写入 graph eval sidecars，PM closeout 会强制检查：

        - Eval Markdown: `{eval_md}`
        - Eval JSON: `{eval_json}`

        `eval.json` 至少包含：
        ```json
        {{
          "sprint_id": "{sprint_id}",
          "node_id": "{node_id}",
          "verdict": "PASS|FAIL",
          "failed_conditions": [],
          "passed_conditions": [],
          "errors": [],
          "tokens_used": 0,
          "eval_md_path": "{eval_md.name}",
          "verify_all_invoked": false,
          "verify_all_verdict": "SKIPPED"
        }}
        ```
"""

    return textwrap.dedent(f"""\
        <!-- SOLAR_PM_DISPATCH -->
        # Solar PM Dispatch

        Task ID: `{task_id}`
        Sprint: `{sprint_id}`
        Node: `{node_id}`
        Operator: `{operator_id}`
        Model: `{operator.get("model", "unknown")}`
        Backend: `{operator.get("backend", "unknown")}`
        {borrow_block}\
        Issued by: `PM pane (solar-harness:0.0)`
        Issued at: `{_now()}`

        ## Definition of Done

        任务没有完成，除非同时满足：

        1. 真实调用链接入：新增/修改功能已接入真实调用链。
        2. 禁止硬编码：不得硬编码业务数据、路径、token。
        3. 执行证据齐全：列出实际命令和结果摘要。
        4. 结构化收尾：已完成 / 已验证 / 未验证 / 风险 / 后续待办。

        ## Worker Persona

        Persona file: `{persona_path}`

        ```markdown
        {persona_body}
        ```
        {ctx_block}
        ## Objective (PM Order)

        {objective}

        ## Required Closeout

        把结论写到：`{result_path}`
        PM 会同时写入结构化 evidence package；完成状态必须能追溯到 dispatch、handoff 和 eval artifact。
{eval_closeout_block}

        格式：
        ```
        # PM Task Result — {task_id}

        ## 已完成
        ## 已验证
        ## 结论摘要
        ## 风险/限制
        ## 后续建议
        ```

        完成后运行（标记任务完成）：
        ```bash
        python3 "{HARNESS_DIR}/tools/pm_dispatch.py" complete --task-id "{task_id}"
        ```
    """)


# ── Inbox / Result 管理 ───────────────────────────────────────────────────────

def pm_inbox_dir() -> Path:
    PM_INBOX_DIR.mkdir(parents=True, exist_ok=True)
    return PM_INBOX_DIR


def _find_pending_inbox_duplicate(inbox_dir: Path, envelope: dict[str, Any]) -> Path | None:
    """投递幂等 (2026-06-10): 同 (sprint_id, node_id) 已有未消费件则视为重复。

    背景: task_id 含随机 hash (pm-<sprint>-<node>-<hash>), 文件名永不重复;
    消费链路停摆时投递端每轮重投, 单 sprint 曾滚出 655 件重复积压。
    inbox 中文件存在即未消费 (消费后被移除), 故按文件名前缀 glob 即可,
    O(glob) 不读 JSON。非 pm- 格式 task_id 不命中前缀, 照常写入 (不破坏)。
    """
    sprint_id = str(envelope.get("sprint_id") or "").strip()
    node_id = str(envelope.get("node_id") or "").strip()
    if not sprint_id or not node_id:
        return None
    for existing in inbox_dir.glob(f"pm-{sprint_id}-{node_id}-*.json"):
        return existing
    return None


def _write_operator_inbox_envelope(operator_id: str, task_id: str, envelope: dict[str, Any]) -> Path:
    """Write a task envelope directly to the operator inbox using the PM fallback path."""
    inbox_dir = OPERATOR_INBOX_DIR / operator_id
    inbox_dir.mkdir(parents=True, exist_ok=True)
    duplicate = _find_pending_inbox_duplicate(inbox_dir, envelope)
    if duplicate is not None:
        print(
            f"inbox-idempotent: skip duplicate task for {operator_id} "
            f"(pending: {duplicate.name})",
            file=sys.stderr,
        )
        return duplicate
    inbox_path = inbox_dir / f"{task_id}.json"
    tmp = str(inbox_path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(envelope, f, indent=2, ensure_ascii=False)
    os.replace(tmp, str(inbox_path))
    _kick_operatord_for_inbox(operator_id)
    return inbox_path


def _kick_operatord_for_inbox(operator_id: str) -> None:
    """Wake 环补全 (2026-06-10): direct-inbox 路径此前写完不踢 operatord,
    任务躺死 inbox (operatord 无任何自动调用方时积压 3500+ 件)。
    复用 operator_runtime 的 auto-kick (operatord daemon slot 锁自防重)。
    Best-effort: kick 失败不阻断投递, 周期 pump (inbox_pump.py) 兜底。
    """
    try:
        lib_dir = HARNESS_DIR / "lib"
        if str(lib_dir) not in sys.path:
            sys.path.insert(0, str(lib_dir))
        from operator_runtime import _auto_kick_enabled, _kick_operatord_once
        if _auto_kick_enabled():
            _kick_operatord_once(operator_id)
    except Exception as exc:
        print(f"inbox-kick: best-effort wake failed for {operator_id}: {exc}", file=sys.stderr)


def _should_direct_inbox_graph_eval(role: str, task_type: str) -> bool:
    """Route graph evaluator tasks around slow runtime submit while preserving PM records."""
    value = str(os.environ.get("SOLAR_PM_GRAPH_EVAL_DIRECT_INBOX", "1")).strip().lower()
    if value in {"0", "false", "no", "off"}:
        return False
    return normalize_role(role) == "evaluator" and str(task_type or "").strip() == "graph_eval"


def write_pm_task_record(task_id: str, record: dict[str, Any]) -> Path:
    path = pm_inbox_dir() / f"{task_id}.json"
    tmp = str(path) + ".tmp"
    _compact_pm_reconcile_history(record)
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2, ensure_ascii=False)
    os.replace(tmp, str(path))
    global _PM_INBOX_PROJECTION_CACHE
    _PM_INBOX_PROJECTION_CACHE = None
    return path


def _record_pm_dispatch_evidence(
    record: dict[str, Any],
    *,
    event: str,
    status: str | None = None,
    reason: str = "",
) -> dict[str, Any]:
    module_path = REPO_HARNESS_DIR / "lib" / "evidence_ledger.py"
    spec = importlib.util.spec_from_file_location("_solar_pm_dispatch_evidence", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"dispatch_evidence_unavailable:{module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    recorder = module.DispatchEvidenceRecorder(harness_dir=HARNESS_DIR, sprints_dir=SPRINTS_DIR)
    sprint_id = str(record.get("sprint_id") or "")
    node_id = str(record.get("node_id") or "")
    artifact_paths = dict(record.get("artifact_paths") or {})
    for key in ("dispatch_file", "result_path", "inbox_path", "outbox_path"):
        value = str(record.get(key) or "").strip()
        if value:
            artifact_paths[key] = value
    evidence = recorder.record(
        task_id=str(record.get("task_id") or ""),
        sprint_id=sprint_id,
        node_id=node_id,
        role=str(record.get("requested_role") or record.get("role") or ""),
        pane=str(record.get("operator_id") or ""),
        status=str(status or record.get("status") or "unknown"),
        event=event,
        artifact_paths=artifact_paths,
        reason=reason,
        extra={"submit_mode": record.get("submit_mode", "")},
    )
    prior_ledger = str(record.get("evidence_ledger_path") or "").strip()
    if prior_ledger and prior_ledger != evidence["evidence_ledger_path"]:
        record["actor_evidence_ledger_path"] = prior_ledger
    record["artifact_paths"] = dict(evidence["artifact_paths"])
    record["evidence_path"] = str(evidence["evidence_path"])
    record["evidence_ledger_path"] = str(evidence["evidence_ledger_path"])
    return evidence


def read_pm_task_record(task_id: str) -> dict[str, Any] | None:
    path = pm_inbox_dir() / f"{task_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _compact_pm_reconcile_history(record: dict[str, Any]) -> None:
    history = record.get("reconcile_history")
    if not isinstance(history, list):
        return
    try:
        max_entries = int(os.environ.get("SOLAR_PM_RECONCILE_HISTORY_MAX_ENTRIES", "40"))
    except Exception:
        max_entries = 40
    max_entries = max(1, max_entries)
    if len(history) > max_entries:
        record["reconcile_history"] = history[-max_entries:]


def _pm_task_projection_key(record: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(record.get("sprint_id") or ""),
        str(record.get("node_id") or ""),
        str(record.get("requested_role") or record.get("role") or ""),
    )


def _is_supersedable_pm_failure(record: dict[str, Any]) -> bool:
    status = str(record.get("status") or "").strip().lower()
    if status == "failed_no_dispatchable_operator":
        return True
    if status.startswith("failed") and TRANSIENT_OPERATOR_FAILURE_RE.search(_transient_operator_failure_text(record)):
        return True
    if status == "blocked_by_verifier":
        completion_gate = record.get("completion_gate")
        verdict = completion_gate.get("verdict") if isinstance(completion_gate, dict) else {}
        return isinstance(verdict, dict) and str(verdict.get("covered_result_event_id") or "") == "duplicate"
    return False


def _is_superseding_pm_record(record: dict[str, Any]) -> bool:
    status = str(record.get("status") or "").strip().lower()
    return bool(status) and not status.startswith("failed")


def _pm_status_is_resolved_for_inbox(status: str) -> bool:
    value = str(status or "").strip().lower()
    return value in {"completed", "cancelled"}


def _pm_inbox_status_sort_bucket(status: str) -> int:
    value = str(status or "").strip().lower()
    if _pm_status_is_resolved_for_inbox(value):
        return 2
    if value.startswith("failed") or value.startswith("blocked"):
        return 1
    return 0


def list_pm_tasks(
    limit: int = 20,
    *,
    include_probe_records: bool = False,
    include_superseded: bool = False,
) -> list[dict[str, Any]]:
    loaded: list[tuple[dict[str, Any], float]] = []
    for p in _pm_record_files(include_probe_records=include_probe_records):
        try:
            record = json.loads(p.read_text(encoding="utf-8"))
            mtime = p.stat().st_mtime
        except Exception:
            pass
        else:
            loaded.append((record, mtime))
    if include_superseded:
        tasks = loaded
        tasks.sort(key=lambda item: -item[1])
    else:
        tasks = []
        grouped: dict[tuple[str, str, str], list[tuple[dict[str, Any], float]]] = {}
        for record, mtime in loaded:
            key = _pm_task_projection_key(record)
            if (
                _is_supersedable_pm_failure(record)
                and str(record.get("status") or "").strip().lower() == "blocked_by_verifier"
                and key == ("", "", "")
            ):
                continue
            if key == ("", "", ""):
                tasks.append((record, mtime))
                continue
            grouped.setdefault(key, []).append((record, mtime))
        for group in grouped.values():
            group.sort(key=lambda item: -item[1])
            has_superseding = any(_is_superseding_pm_record(record) for record, _ in group)
            for record, mtime in group:
                if has_superseding and _is_supersedable_pm_failure(record):
                    continue
                tasks.append((record, mtime))
                break
        tasks.sort(key=lambda item: (_pm_inbox_status_sort_bucket(str(item[0].get("status") or "")), -item[1]))
    return [record for record, _ in tasks[:limit]]


def is_capacity_probe_record(record: dict[str, Any] | None = None, path: Path | None = None) -> bool:
    """Return true for synthetic capacity-probe PM records.

    These records are observability artifacts from dry-run/operator-pool probes;
    reconcile/watchdog should not treat them as user work or emit one skipped row
    per historical probe.
    """
    record = record or {}
    task_id = str(record.get("task_id") or (path.stem if path is not None else "") or "")
    sprint_id = str(record.get("sprint_id") or "")
    if any(task_id.startswith(prefix) for prefix in PM_CAPACITY_PROBE_PREFIXES):
        return True
    return sprint_id in {"graph-dispatch-capacity-probe", "eval-capacity-probe"}


def _pm_record_files(*, include_probe_records: bool = True) -> list[Path]:
    paths = sorted(pm_inbox_dir().glob("pm-*.json"), key=lambda x: x.stat().st_mtime, reverse=True)
    if include_probe_records:
        return paths
    return [path for path in paths if not is_capacity_probe_record(path=path)]


def _active_pm_task_ids() -> set[str]:
    active: set[str] = set()
    for directory in (HARNESS_DIR / "run" / "operator-status", HARNESS_DIR / "run" / "operator-leases"):
        for path in directory.glob("*.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            for key in ("task_id", "current_task_id", "lease_id"):
                value = str(payload.get(key) or "").strip()
                if value.startswith("pm-"):
                    active.add(value)
            lease = payload.get("lease")
            if isinstance(lease, dict):
                value = str(lease.get("task_id") or "").strip()
                if value.startswith("pm-"):
                    active.add(value)
    return active


def _pm_status_is_terminal(status: str) -> bool:
    value = str(status or "").strip().lower()
    if not value:
        return False
    return value in {"completed", "cancelled"} or value.startswith("failed")


def _load_graph_scheduler_module() -> Any | None:
    """Load graph_scheduler from the live harness, falling back to this repo."""
    for lib_dir in (HARNESS_DIR / "lib", REPO_HARNESS_DIR / "lib"):
        if str(lib_dir) not in sys.path:
            sys.path.insert(0, str(lib_dir))
    try:
        import graph_scheduler  # type: ignore

        return graph_scheduler
    except Exception:
        return None


def _load_task_graph_state_io_module() -> Any | None:
    for lib_dir in (HARNESS_DIR / "lib", REPO_HARNESS_DIR / "lib"):
        if str(lib_dir) not in sys.path:
            sys.path.insert(0, str(lib_dir))
    try:
        import task_graph_state_io  # type: ignore

        return task_graph_state_io
    except Exception:
        return None


def _sync_task_dag_state_node(
    sprint_id: str,
    node_id: str,
    status: str,
    *,
    assigned_to: str = "",
    dispatch_id: str = "",
    note: str = "",
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    state_io = _load_task_graph_state_io_module()
    if state_io is None:
        return {"ok": False, "reason": "task_graph_state_io_unavailable"}
    try:
        state = state_io.load_state(sprint_id, SPRINTS_DIR)
        if state is None:
            state = state_io.make_empty_state(sprint_id, f"{sprint_id}.task_graph.json")
        state_io.set_node_result(
            state,
            node_id,
            status,
            note=note,
            assigned_to=assigned_to,
            dispatch_id=dispatch_id,
        )
        node_status = state.setdefault("node_status", {})
        if isinstance(node_status, dict):
            entry = node_status.setdefault(node_id, {})
            if isinstance(entry, dict):
                entry["status"] = status
                entry["updated_at"] = _now()
                if assigned_to:
                    entry["assigned_to"] = assigned_to
                else:
                    entry.pop("assigned_to", None)
                if dispatch_id:
                    entry["dispatch_id"] = dispatch_id
                else:
                    entry.pop("dispatch_id", None)
        if not dispatch_id and isinstance(state.get("dispatch_ids"), dict):
            state["dispatch_ids"].pop(node_id, None)
        if extra:
            result_entry = state.setdefault("node_results", {}).setdefault(node_id, {})
            if isinstance(result_entry, dict):
                result_entry.update(extra)
        state_io.save_state(sprint_id, state, SPRINTS_DIR)
        return {"ok": True, "sprint_id": sprint_id, "node_id": node_id, "status": status}
    except Exception as exc:
        return {"ok": False, "reason": f"state_sync_failed:{type(exc).__name__}", "error": str(exc)}


def _planning_complete_status_files() -> list[Path]:
    files: list[Path] = []
    for path in sorted(SPRINTS_DIR.glob("*.status.json"), key=lambda item: item.stat().st_mtime):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if str(payload.get("status") or "").strip().lower() != "active":
            continue
        if str(payload.get("phase") or "").strip().lower() != "planning_complete":
            continue
        files.append(path)
    return files


def _sprint_id_from_status_path(path: Path) -> str:
    return path.name[: -len(".status.json")] if path.name.endswith(".status.json") else path.stem


def _active_pm_record_for_node(sprint_id: str, node_id: str) -> dict[str, Any] | None:
    newest: dict[str, Any] | None = None
    newest_mtime = -1.0
    if any(char in sprint_id + node_id for char in "*?[]"):
        paths = pm_inbox_dir().glob("pm-*.json")
    else:
        paths = pm_inbox_dir().glob(f"pm-{sprint_id}-{node_id}-*.json")
    for path in paths:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if str(payload.get("sprint_id") or "") != sprint_id:
            continue
        if str(payload.get("node_id") or "") != node_id:
            continue
        if _pm_status_is_terminal(str(payload.get("status") or "")):
            continue
        mtime = path.stat().st_mtime
        if mtime > newest_mtime:
            newest = payload
            newest_mtime = mtime
    if newest is not None:
        return newest
    for payload in _iter_pm_inbox_projections():
        if str(payload.get("sprint_id") or "") != sprint_id:
            continue
        if str(payload.get("node_id") or "") != node_id:
            continue
        if _pm_status_is_terminal(str(payload.get("status") or "")):
            continue
        return dict(payload)
    return newest


def _node_is_builder_ready(node: dict[str, Any]) -> bool:
    role = str(node.get("role") or node.get("target_role") or node.get("handoff_to") or "").strip().lower()
    if role in NON_BUILDER_NODE_ROLES:
        return False
    logical_operator = str(node.get("logical_operator") or "").strip()
    if logical_operator.startswith("builder."):
        return True
    if logical_operator in BUILDER_READY_LOGICAL_OPERATORS:
        return True
    if logical_operator in NON_BUILDER_READY_LOGICAL_OPERATORS:
        return False
    task_type = str(node.get("dispatch_task_type") or node.get("type") or "").strip().lower()
    if task_type in CODE_EXEC_TASK_TYPES:
        return True
    if not logical_operator and not task_type:
        return True
    return False


def _node_has_pm_dispatch_marker(graph: dict[str, Any], node_id: str, node: dict[str, Any]) -> bool:
    results = graph.get("node_results") or graph.get("results") or {}
    result = results.get(node_id) if isinstance(results, dict) and isinstance(results.get(node_id), dict) else {}
    for payload in (node, result):
        if not isinstance(payload, dict):
            continue
        if str(payload.get("pm_task_id") or "").strip():
            return True
        if str(payload.get("dispatch_id") or "").strip():
            return True
    return False


def _node_has_non_latent_status(node: dict[str, Any]) -> bool:
    status = str(node.get("status") or "").strip().lower()
    return status in {
        "assigned",
        "blocked",
        "cancelled",
        "dispatched",
        "failed",
        "in_progress",
        "queued",
        "reviewing",
        "running",
        "skipped",
        "worker_blocked",
        "passed",
    }


def _node_builder_task_type(node: dict[str, Any]) -> str:
    task_type = str(node.get("dispatch_task_type") or node.get("type") or "").strip().lower()
    if task_type:
        return task_type
    logical_operator = str(node.get("logical_operator") or "").strip()
    if logical_operator == "TestDesigner":
        return "tests"
    if logical_operator == "TestRunner":
        return "test"
    if logical_operator == "RunTests":
        return "tests"
    if logical_operator == "VerifyClaim":
        return "verification"
    if logical_operator == "PatchWorker":
        return "patch"
    if logical_operator == "BenchmarkRunner":
        return "benchmark"
    return "implementation"


def _release_markerless_active_builder_claims(graph: dict[str, Any], sprint_id: str) -> list[dict[str, str]]:
    changed: list[dict[str, str]] = []
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return changed
    results = graph.get("node_results")
    if not isinstance(results, dict):
        results = {}
        graph["node_results"] = results
    now = _now()
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id") or node.get("node_id") or "").strip()
        if not node_id or not _node_is_builder_ready(node):
            continue
        status = str(node.get("status") or "").strip().lower()
        if status not in {"assigned", "dispatched", "in_progress", "running"}:
            continue
        if _node_has_pm_dispatch_marker(graph, node_id, node):
            continue
        if _active_pm_record_for_node(sprint_id, node_id):
            continue
        node["status"] = "pending"
        node["updated_at"] = now
        node["requeue_reason"] = "markerless_active_claim_released"
        for key in ("assigned_to", "dispatch_id", "dispatched_via", "pm_task_id", "operator_id"):
            node.pop(key, None)
        entry = results.get(node_id) if isinstance(results.get(node_id), dict) else {}
        entry["status"] = "pending"
        entry["updated_at"] = now
        entry["requeue_reason"] = "markerless_active_claim_released"
        for key in ("assigned_to", "dispatch_id", "dispatched_via", "pm_task_id", "operator_id"):
            entry.pop(key, None)
        results[node_id] = entry
        changed.append({"node_id": node_id, "previous_status": status, "status": "pending"})
    return changed


def _node_builder_objective(sprint_id: str, node: dict[str, Any]) -> str:
    node_id = str(node.get("id") or "N/A")
    goal = str(node.get("goal") or node.get("title") or node.get("objective") or "").strip()
    if not goal:
        goal = f"Execute task graph node {node_id} for {sprint_id}."
    acceptance = node.get("acceptance") if isinstance(node.get("acceptance"), list) else []
    requirements = node.get("requirement_ids") if isinstance(node.get("requirement_ids"), list) else []
    lines = [
        f"执行 sprint `{sprint_id}` 的 builder-ready task_graph 节点 `{node_id}`。",
        "",
        "目标：",
        goal,
        "",
        "必交产物：",
        f"- 必须写入 canonical handoff：`{SPRINTS_DIR / f'{sprint_id}.{node_id}-handoff.md'}`。",
        "- handoff 必须包含：已完成、已验证、未验证、风险/阻塞、后续建议。",
        "- 只写 `.pm-result.md` 不算完成；缺 handoff 会被 evaluator/graph closeout 判为未交付。",
    ]
    if requirements:
        lines.extend(["", "关联需求：", ", ".join(str(item) for item in requirements)])
    if acceptance:
        lines.append("")
        lines.append("验收条件：")
        lines.extend(f"- {item}" for item in acceptance)
    if any("harness/tests/" in str(item) for item in acceptance):
        lines.extend(
            [
                "",
                "路径提示：",
                "- 如果当前工作目录是 live harness 根目录（例如 `~/.solar/harness`），"
                "请将 repo-relative `harness/tests/...` 映射为 `tests/...` 后执行；"
                "不要因为 cwd 差异把已存在的测试误判为缺失。",
            ]
        )
    lines.extend(
        [
            "",
            "请按 task_graph 节点约束完成实现/测试/交付，并写入上述 canonical handoff 证据。",
        ]
    )
    return "\n".join(lines)


def _builder_ready_nodes_for_sprint(sprint_id: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    graph_path = SPRINTS_DIR / f"{sprint_id}.task_graph.json"
    if not graph_path.exists():
        return [], {"ok": False, "reason": "task_graph_missing", "graph": str(graph_path)}
    graph_scheduler = _load_graph_scheduler_module()
    if graph_scheduler is None:
        return [], {"ok": False, "reason": "graph_scheduler_unavailable", "graph": str(graph_path)}
    try:
        graph_scheduler.SPRINTS_DIR = SPRINTS_DIR
        graph = graph_scheduler.load_graph(graph_path)
        if hasattr(graph_scheduler, "sync_child_sprint_status_projection"):
            graph_scheduler.sync_child_sprint_status_projection(graph, graph_path, persist=True)
        markerless_releases = _release_markerless_active_builder_claims(graph, sprint_id)
        if markerless_releases:
            graph_scheduler.save_graph(graph_path, graph)
        ready = graph_scheduler.ready_nodes(graph)
    except Exception as exc:
        return [], {"ok": False, "reason": f"ready_nodes_failed:{type(exc).__name__}", "error": str(exc), "graph": str(graph_path)}
    nodes: list[dict[str, Any]] = []
    for node in ready:
        node_id = str(node.get("id") or "").strip()
        if not node_id or not _node_is_builder_ready(node):
            continue
        has_pm_dispatch_marker = _node_has_pm_dispatch_marker(graph, node_id, node)
        active_record = _active_pm_record_for_node(sprint_id, node_id)
        node_status = str(node.get("status") or "").strip().lower()
        markerless_active_status = node_status in {"assigned", "dispatched", "in_progress", "running"} and not has_pm_dispatch_marker and not active_record
        if _node_has_non_latent_status(node) and not markerless_active_status:
            continue
        if has_pm_dispatch_marker:
            continue
        if active_record:
            continue
        nodes.append(dict(node))
    return nodes, {
        "ok": True,
        "graph": str(graph_path),
        "ready_count": len(nodes),
        "graph_ready_count": len(ready),
    }


def _latent_builder_ready_items(limit: int = 0) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for status_path in _planning_complete_status_files():
        sprint_id = _sprint_id_from_status_path(status_path)
        nodes, meta = _builder_ready_nodes_for_sprint(sprint_id)
        if not meta.get("ok"):
            continue
        for node in nodes:
            items.append(
                {
                    "sprint_id": sprint_id,
                    "node_id": str(node.get("id") or ""),
                    "task_type": _node_builder_task_type(node),
                    "logical_operator": str(node.get("logical_operator") or ""),
                    "graph": str(meta.get("graph") or ""),
                    "objective": _node_builder_objective(sprint_id, node),
                }
            )
            if limit and len(items) >= limit:
                return items
    return items


def _latent_builder_ready_backlog_count() -> int:
    return len(_latent_builder_ready_items())


def _planner_ready_items(limit: int = 0) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for payload in _iter_status_projections():
        sprint_id = str(payload.get("sprint_id") or "").strip()
        if not sprint_id:
            continue
        status = str(payload.get("status") or "").strip().lower()
        phase = str(payload.get("phase") or "").strip().lower()
        handoff = str(payload.get("handoff_to") or "").strip().lower()
        if status not in {"active", "drafting"} or phase != "prd_ready" or handoff != "planner":
            continue
        if _active_pm_record_for_node(sprint_id, "N0"):
            continue
        items.append(
            {
                "sprint_id": sprint_id,
                "node_id": "N0",
                "task_type": "planning",
                "status": status,
                "phase": phase,
                "handoff_to": handoff,
                "objective": _planner_objective_for_compiled_sprint(sprint_id),
            }
        )
        if limit and len(items) >= limit:
            return items
    return items


def _node_eval_json_path(sprint_id: str, node_id: str) -> Path:
    return SPRINTS_DIR / f"{sprint_id}.{node_id}-eval.json"


def _node_handoff_path(sprint_id: str, node_id: str) -> Path:
    return SPRINTS_DIR / f"{sprint_id}.{node_id}-handoff.md"


def _is_graph_node_dispatch_record(record: dict[str, Any]) -> bool:
    objective = str(record.get("objective") or "")
    return "Graph dispatch file:" in objective and "# DAG Node Dispatch" in objective


def _graph_node_dispatch_expected_artifacts(record: dict[str, Any]) -> list[Path]:
    sprint_id = str(record.get("sprint_id") or "").strip()
    node_id = str(record.get("node_id") or "").strip()
    if not sprint_id or not node_id:
        return []
    objective = str(record.get("objective") or "")
    expected: list[Path] = [_node_handoff_path(sprint_id, node_id)]
    explicit_sidecars = {
        "guard_decision": SPRINTS_DIR / f"{sprint_id}.{node_id}-guard-decision.json",
        "resource_binding": SPRINTS_DIR / f"{sprint_id}.{node_id}-resource-binding.json",
        "bridged_artifact": SPRINTS_DIR / f"{sprint_id}.{node_id}-bridged-artifact.md",
        "eval_md": SPRINTS_DIR / f"{sprint_id}.{node_id}-eval.md",
        "eval_json": SPRINTS_DIR / f"{sprint_id}.{node_id}-eval.json",
    }
    for path in explicit_sidecars.values():
        if str(path) in objective:
            expected.append(path)
    return expected


def _resolve_sprint_artifact_path(value: str) -> Path | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = SPRINTS_DIR / path
    return path


def _node_has_fresh_terminal_eval_sidecar(
    sprint_id: str,
    node_id: str,
    handoff_path: Path,
    target: dict[str, Any],
    result_entry: dict[str, Any],
) -> bool:
    candidates: list[Path] = [_node_eval_json_path(sprint_id, node_id)]
    for source in (target, result_entry):
        eval_json = _resolve_sprint_artifact_path(str(source.get("eval_json") or ""))
        if eval_json is not None:
            candidates.append(eval_json)
        artifacts = source.get("artifacts") if isinstance(source.get("artifacts"), dict) else {}
        eval_json = _resolve_sprint_artifact_path(str(artifacts.get("eval_json") or ""))
        if eval_json is not None:
            candidates.append(eval_json)

    try:
        handoff_mtime = handoff_path.stat().st_mtime
    except OSError:
        handoff_mtime = 0.0

    seen: set[Path] = set()
    for path in candidates:
        if path in seen:
            continue
        seen.add(path)
        if not path.exists() or path.stat().st_size <= 0:
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        verdict = str(payload.get("verdict") or payload.get("status") or "").strip().lower()
        if verdict not in {"pass", "passed", "ok", "fail", "failed", "error", "errored"}:
            continue
        try:
            if path.stat().st_mtime < handoff_mtime:
                continue
        except OSError:
            continue
        return True
    return False


def _node_has_active_or_dispatched_eval(sprint_id: str, node_id: str, node: dict[str, Any]) -> bool:
    active = _active_pm_record_for_node(sprint_id, node_id)
    if active and normalize_role(str(active.get("requested_role") or active.get("role") or "")) == "evaluator":
        return True
    if node.get("eval_dispatched_at") or node.get("eval_dispatch_id"):
        return True
    assignments = node.get("eval_assignments")
    return isinstance(assignments, list) and bool(assignments)


def _sprint_has_actionable_eval_backlog(sprint_id: str) -> bool:
    graph_path = SPRINTS_DIR / f"{sprint_id}.task_graph.json"
    if not graph_path.exists():
        return False
    try:
        graph = json.loads(graph_path.read_text(encoding="utf-8"))
    except Exception:
        return False
    nodes = graph.get("nodes")
    if not isinstance(nodes, list):
        return False
    if any(
        isinstance(node, dict)
        and str(node.get("status") or "").strip().lower() in {"failed", "cancelled", "canceled"}
        for node in nodes
    ):
        return False
    eval_path = SPRINTS_DIR / f"{sprint_id}.eval.json"
    if eval_path.exists():
        try:
            sprint_eval = json.loads(eval_path.read_text(encoding="utf-8"))
        except Exception:
            sprint_eval = {}
        verdict = str(sprint_eval.get("verdict") or "").strip().upper() if isinstance(sprint_eval, dict) else ""
        if verdict == "FAIL":
            return False
    results = graph.get("node_results")
    if not isinstance(results, dict):
        results = {}
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id") or "").strip()
        if not node_id:
            continue
        if str(node.get("status") or "").strip().lower() != "reviewing":
            continue
        result = results.get(node_id)
        result_status = str(result.get("status") or "").strip().lower() if isinstance(result, dict) else ""
        if result_status in {"passed", "failed", "skipped", "cancelled", "canceled"}:
            continue
        if _node_eval_json_path(sprint_id, node_id).exists():
            continue
        if _node_has_active_or_dispatched_eval(sprint_id, node_id, node):
            continue
        handoff_path = _node_handoff_path(sprint_id, node_id)
        if not handoff_path.exists() or handoff_path.stat().st_size <= 0:
            continue
        return True
    return False


def _pm_expected_artifacts(record: dict[str, Any]) -> list[Path]:
    """Artifacts that prove a PM role task actually satisfied its contract."""
    role = normalize_role(str(record.get("requested_role") or ""))
    sprint_id = str(record.get("sprint_id") or "").strip()
    node_id = str(record.get("node_id") or "").strip()
    if not sprint_id:
        return []
    if _is_graph_node_dispatch_record(record):
        return _graph_node_dispatch_expected_artifacts(record)
    if role == "planner":
        return [
            SPRINTS_DIR / f"{sprint_id}.plan.md",
            SPRINTS_DIR / f"{sprint_id}.task_graph.json",
        ]
    if role == "builder" and node_id:
        return [SPRINTS_DIR / f"{sprint_id}.{node_id}-handoff.md"]
    if role == "evaluator" and node_id:
        return [
            SPRINTS_DIR / f"{sprint_id}.{node_id}-eval.md",
            SPRINTS_DIR / f"{sprint_id}.{node_id}-eval.json",
        ]
    return []


def _pm_result_identity_mismatches(record: dict[str, Any]) -> list[str]:
    """Detect when a shared pm-result file belongs to a different PM task."""
    task_id = str(record.get("task_id") or "").strip()
    result_path_raw = str(record.get("result_path") or "").strip()
    if not task_id or not result_path_raw:
        return []
    result_path = Path(result_path_raw).expanduser()
    if not result_path.exists() or not result_path.is_file() or result_path.stat().st_size <= 0:
        return []
    try:
        text = result_path.read_text(encoding="utf-8", errors="replace")[:STATUS_SCAN_BYTES]
    except Exception:
        return []
    match = re.search(r"(?im)^#\s*PM Task Result\s+[—-]\s*(`?)([^`\n\r]+)\1\s*$", text)
    if not match:
        return []
    result_task_id = match.group(2).strip()
    if result_task_id and result_task_id != task_id:
        return [f"{result_path}: task_id_mismatch result={result_task_id} record={task_id}"]
    return []


def _pm_closeout_status(record: dict[str, Any]) -> dict[str, Any]:
    expected = _pm_expected_artifacts(record)
    missing = [str(path) for path in expected if not path.exists() or path.stat().st_size <= 0]
    stale: list[str] = []
    identity_mismatches = _pm_result_identity_mismatches(record)
    submitted_at = _parse_record_time(record.get("submitted_at") or record.get("issued_at"))
    if submitted_at is not None:
        threshold = submitted_at - datetime.timedelta(seconds=2)
        for path in expected:
            if not path.exists() or path.stat().st_size <= 0:
                continue
            try:
                artifact_mtime = datetime.datetime.fromtimestamp(path.stat().st_mtime, tz=datetime.timezone.utc)
            except OSError:
                continue
            if artifact_mtime < threshold:
                stale.append(str(path))
    return {
        "ok": not missing and not stale and not identity_mismatches,
        "expected_artifacts": [str(path) for path in expected],
        "missing_artifacts": missing,
        "stale_artifacts": stale,
        "identity_mismatches": identity_mismatches,
    }


def _pm_graph_node_closed_closeout(record: dict[str, Any]) -> dict[str, Any]:
    sprint_id = str(record.get("sprint_id") or "").strip()
    node_id = str(record.get("node_id") or "").strip()
    if not sprint_id or not node_id:
        return {"ok": False, "reason": "missing_graph_identity"}
    graph_path = SPRINTS_DIR / f"{sprint_id}.task_graph.json"
    if not graph_path.exists():
        return {"ok": False, "reason": "graph_missing", "graph": str(graph_path)}
    try:
        graph = json.loads(graph_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"ok": False, "reason": f"graph_read_failed:{type(exc).__name__}", "graph": str(graph_path)}
    node_status = ""
    nodes = graph.get("nodes")
    if isinstance(nodes, list):
        for node in nodes:
            if isinstance(node, dict) and str(node.get("id") or node.get("node_id") or "") == node_id:
                node_status = str(node.get("status") or "").strip().lower()
                break
    elif isinstance(nodes, dict):
        node = nodes.get(node_id)
        if isinstance(node, dict):
            node_status = str(node.get("status") or "").strip().lower()
    result_status = ""
    results = graph.get("node_results")
    result = results.get(node_id) if isinstance(results, dict) else None
    if isinstance(result, dict):
        result_status = str(result.get("status") or "").strip().lower()
    closed_statuses = {"passed", "skipped", "cancelled", "canceled", "skipped_parent_passed"}
    effective_status = node_status or result_status
    if node_status not in closed_statuses and result_status not in closed_statuses:
        return {"ok": False, "reason": "graph_node_not_closed", "graph": str(graph_path), "graph_status": effective_status}
    closeout = _pm_closeout_status(record)
    return {
        **closeout,
        "reason": "graph_node_already_closed",
        "graph": str(graph_path),
        "graph_status": effective_status,
    }


def _synthetic_builder_handoff_cancel(record: dict[str, Any]) -> dict[str, Any]:
    if _pm_status_is_resolved_for_inbox(str(record.get("status") or "")):
        return {"ok": False, "reason": "already_terminal"}
    role = str(record.get("requested_role") or record.get("role") or "").strip().lower()
    node_id = str(record.get("node_id") or "").strip()
    sprint_id = str(record.get("sprint_id") or "").strip()
    if role != "builder" or node_id != "B0" or not sprint_id:
        return {"ok": False, "reason": "not_synthetic_builder_handoff"}
    graph_path = SPRINTS_DIR / f"{sprint_id}.task_graph.json"
    if not graph_path.exists():
        return {"ok": False, "reason": "graph_missing", "graph": str(graph_path)}
    try:
        graph = json.loads(graph_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"ok": False, "reason": f"graph_read_failed:{type(exc).__name__}", "graph": str(graph_path)}
    nodes = graph.get("nodes")
    node_ids: set[str] = set()
    if isinstance(nodes, list):
        node_ids = {str(node.get("id") or node.get("node_id") or "").strip() for node in nodes if isinstance(node, dict)}
    elif isinstance(nodes, dict):
        node_ids = {str(key).strip() for key in nodes}
    node_ids.discard("")
    if not node_ids:
        return {"ok": False, "reason": "graph_has_no_nodes", "graph": str(graph_path)}
    if "B0" in node_ids:
        return {"ok": False, "reason": "graph_has_b0_node", "graph": str(graph_path)}
    return {
        "ok": True,
        "reason": "builder_handoff_managed_by_task_graph",
        "graph": str(graph_path),
        "node_count": len(node_ids),
    }


def _record_age_minutes(record: dict[str, Any], path: Path) -> float:
    for key in ("submitted_at", "created_at", "updated_at", "ts"):
        parsed = _parse_utc(str(record.get(key) or ""))
        if parsed:
            return max(0.0, (datetime.datetime.now(datetime.timezone.utc) - parsed).total_seconds() / 60.0)
    return max(0.0, (time.time() - path.stat().st_mtime) / 60.0)


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = str(path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    os.replace(tmp, str(path))


def _append_event(path: Path, event: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


def _new_sprint_id() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("sprint-%Y%m%d-%H%M%S")


def ensure_compiled_sprint_status(sprint_id: str, title: str, summary: str) -> Path:
    status_path = SPRINTS_DIR / f"{sprint_id}.status.json"
    now = _now()
    if status_path.exists():
        try:
            status = json.loads(status_path.read_text(encoding="utf-8"))
        except Exception:
            status = {}
    else:
        status = {
            "id": sprint_id,
            "title": title,
            "summary": summary,
            "created_at": now,
            "round": 0,
            "history": [],
        }

    status.update(
        {
            "id": sprint_id,
            "title": title,
            "summary": summary,
            "status": "drafting",
            "phase": "prd_ready",
            "handoff_to": "planner",
            "target_role": "planner",
            "updated_at": now,
        }
    )
    history = list(status.get("history") or [])
    history.append({"ts": now, "event": "compiled_requirement_package_created", "by": "codex-pm-router"})
    status["history"] = history[-20:]
    _write_json_atomic(status_path, status)
    _append_event(
        SPRINTS_DIR / f"{sprint_id}.events.jsonl",
        {
            "ts": now,
            "actor": "pm_dispatch",
            "event": "compiled_requirement_package_created",
            "sid": sprint_id,
            "status": "info",
            "detail": {
                "phase": "prd_ready",
                "handoff_to": "planner",
                "target_role": "planner",
            },
        },
    )
    return status_path


def _planner_objective_for_compiled_sprint(sprint_id: str) -> str:
    base = str(SPRINTS_DIR / sprint_id)
    return textwrap.dedent(
        f"""\
        请接手 {sprint_id}：Requirement Compiler 已生成首版需求编译包。

        先读取：
        - {base}.product-brief.md
        - {base}.prd.md
        - {base}.contract.md
        - {base}.task_graph.json
        - {base}.requirement_ir.json
        - {base}.handoff.md

        你的任务：
        1. 基于 compiled requirement package 产出 design.md 和 plan.md。
        2. 如有必要，细化或修正 task_graph.json，但不得绕过 compiled contracts。
        3. 不要直接跳 Builder；保持 PM -> Planner -> task_graph -> Builder 主链。
        4. 如果 compiled package 缺失关键字段，先写明 blocker 和修正建议。
        """
    ).strip()


def cmd_compile_request(args: argparse.Namespace) -> int:
    request_text = str(args.text or "").strip()
    if not request_text and args.input_file:
        request_text = Path(args.input_file).read_text(encoding="utf-8")
    if not request_text:
        request_text = sys.stdin.read().strip()
    if not request_text:
        print("ERROR: request text is required via --text, --input-file, or stdin", file=sys.stderr)
        return 1

    sprint_id = str(args.sprint or "")
    if os.environ.get("SOLAR_PM_DISPATCH_ALLOW_DIRECT") != "1":
        try:
            payload = capture_entrypoint_raw_intent(
                source_channel="pm_compile_request",
                text=request_text,
                sprint_id=sprint_id,
                role="pm",
                repo=str(Path(args.workspace_root or os.getcwd())),
            )
        except Exception as exc:
            print(f"ERROR: RawIntent capture failed: {exc}", file=sys.stderr)
            return 1
        print_intent_capture(payload, "pm_dispatch.compile-request")
        return 0

    sprint_id = str(args.sprint or _new_sprint_id())
    workspace_root = Path(args.workspace_root or os.getcwd())

    router_path = Path(__file__).resolve().parent / "codex_pm_router.py"
    spec = importlib.util.spec_from_file_location("codex_pm_router", router_path)
    if spec is None or spec.loader is None:
        print(f"ERROR: unable to load {router_path}", file=sys.stderr)
        return 1
    router = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(router)

    payload = router.build_pm_intake(
        request_text,
        papers=list(getattr(args, "paper", []) or []),
        logs=list(getattr(args, "log", []) or []),
        repo_context=list(getattr(args, "repo_context", []) or []),
        sprint_id=sprint_id,
        target_system=str(getattr(args, "target_system", "solar-harness") or "solar-harness"),
    )
    validation = router.validate_compiled_package(payload)
    if not validation.get("ok", False):
        print("ERROR: compiled requirement package failed validation", file=sys.stderr)
        for item in validation.get("errors", []) or []:
            print(f" - {item}", file=sys.stderr)
        return 2
    emitted = router.emit_requirement_package(
        payload,
        workspace_root=workspace_root,
        sprint_root=SPRINTS_DIR,
        sprint_id=sprint_id,
    )
    status_path = ensure_compiled_sprint_status(
        sprint_id,
        title=payload["compiled_artifacts"]["product_brief"]["title"],
        summary=payload["compiled_artifacts"]["product_brief"]["problem"][:180],
    )
    emitted["status"] = str(status_path)

    if bool(getattr(args, "dispatch_planner", False)):
        submit_args = argparse.Namespace(
            role="planner",
            objective=_planner_objective_for_compiled_sprint(sprint_id),
            operator="",
            sprint=sprint_id,
            node="N0",
            task_type="planning",
            context=f"compiled_requirement_ir={emitted['requirement_ir']}",
            dry_run=bool(getattr(args, "dry_run", False)),
        )
        rc = cmd_submit(submit_args)
        if rc != 0:
            return rc

    print("✅ Requirement Compiler package ready")
    print(f"   sprint_id   = {sprint_id}")
    print(f"   workspace   = {workspace_root}")
    print(f"   pm_dir      = {emitted['pm_dir']}")
    print(f"   requirement = {emitted['requirement_ir']}")
    print(f"   product_brief = {emitted['sprint_product_brief']}")
    print(f"   prd         = {emitted['sprint_prd']}")
    print(f"   contract    = {emitted['sprint_contract']}")
    print(f"   task_graph  = {emitted['sprint_task_graph']}")
    print(f"   status      = {emitted['status']}")
    return 0


# ── 核心 submit 逻辑 ──────────────────────────────────────────────────────────

def cmd_submit(args: argparse.Namespace) -> int:
    role = str(args.role or "builder")
    objective = str(args.objective or "").strip()
    if not objective:
        print("ERROR: --objective is required", file=sys.stderr)
        return 1

    prefer_operator = str(args.operator or "").strip()
    requested_sprint_id = str(args.sprint or "")
    node_id_for_intent = str(args.node or "N1")
    if os.environ.get("SOLAR_PM_DISPATCH_ALLOW_DIRECT") != "1":
        try:
            payload = capture_entrypoint_raw_intent(
                source_channel="pm_dispatch",
                text=objective + (f"\n\n[context]\n{args.context}" if str(args.context or "").strip() else ""),
                sprint_id=requested_sprint_id,
                node_id=node_id_for_intent,
                role=role,
                repo=str(HARNESS_DIR),
            )
        except Exception as exc:
            print(f"ERROR: RawIntent capture failed: {exc}", file=sys.stderr)
            return 1
        print_intent_capture(payload, "pm_dispatch.submit")
        return 0

    sprint_id = str(args.sprint or f"pm-adhoc-{_short_id()}")
    node_id = str(args.node or "N1")
    task_type = str(args.task_type or "")
    dry_run: bool = bool(args.dry_run)
    context = str(args.context or "")
    task_graph_node = load_task_graph_node(sprint_id, node_id)
    capsule_submit = _capsule_submit_metadata_for_role(task_graph_node, role)
    logical_operator = str(capsule_submit.get("logical_operator") or (task_graph_node or {}).get("logical_operator") or "")
    if not task_type:
        task_type = str(capsule_submit.get("dispatch_task_type") or (task_graph_node or {}).get("type") or "")
    graph_eval_direct_inbox = _should_direct_inbox_graph_eval(role, task_type)

    resolved_capsule: dict[str, Any] | None = None
    capsule_admission_error = ""
    if capsule_submit.get("capability_capsule_id") and not graph_eval_direct_inbox:
        try:
            lib_dir = HARNESS_DIR / "lib"
            if str(lib_dir) not in sys.path:
                sys.path.insert(0, str(lib_dir))
            from capability_capsules import resolve_capability_capsule_for_task  # type: ignore

            resolved_capsule = resolve_capability_capsule_for_task(
                {
                    "task_type": task_type,
                    "objective": objective[:300],
                    "capability_capsule_id": capsule_submit["capability_capsule_id"],
                }
            )
        except Exception as exc:
            message = str(exc)
            if "admission_failed:" in message:
                capsule_admission_error = message
            else:
                capsule_admission_error = ""
            resolved_capsule = None

    task_id = f"pm-{sprint_id}-{node_id}-{_short_id()}"
    result_path = str(SPRINTS_DIR / f"{sprint_id}.{node_id}.pm-result.md")

    if capsule_admission_error:
        failure_reason = f"capability_capsule_admission_failed: {capsule_admission_error}"
        failure_record: dict[str, Any] = {
            "task_id": task_id,
            "sprint_id": sprint_id,
            "node_id": node_id,
            "operator_id": "",
            "objective": objective,
            "result_path": result_path,
            "status": "failed_no_dispatchable_operator",
            "submitted_at": _now(),
            "failed_at": _now(),
            "requested_role": normalize_role(role),
            "task_type": task_type,
            "failure_reason": failure_reason,
            "capability_capsule_id": capsule_submit.get("capability_capsule_id", ""),
            "logical_operator": logical_operator,
        }
        write_pm_task_record(task_id, failure_record)
        print(f"ERROR: {failure_reason}", file=sys.stderr)
        return 1

    # 1. 选算子
    operator_id, operator, fallback_reason = select_operator_by_role(
        role=role,
        task_type=task_type,
        prefer_operator=prefer_operator,
        resolved_capsule=resolved_capsule,
        logical_operator=logical_operator,
        dispatch_surface="mailbox",
    )
    selection_diagnostics = dict(LAST_OPERATOR_SELECTION_DIAGNOSTICS or {})
    if not operator_id:
        if dry_run:
            print(f"[DRY-RUN] ERROR: 没有可用算子 ({fallback_reason})", file=sys.stderr)
            _print_operator_selection_diagnostics()
            return 1
        failure_record: dict[str, Any] = {
            "task_id": task_id,
            "sprint_id": sprint_id,
            "node_id": node_id,
            "operator_id": "",
            "objective": objective,
            "result_path": result_path,
            "status": "failed_no_dispatchable_operator",
            "submitted_at": _now(),
            "failed_at": _now(),
            "requested_role": normalize_role(role),
            "task_type": task_type,
            "failure_reason": fallback_reason or "no_dispatchable_operator_for_role",
            "logical_operator": logical_operator,
        }
        if selection_diagnostics:
            failure_record["selection_diagnostics"] = selection_diagnostics
            failure_record["selection_summary"] = _dispatch_ledger_selection_summary(selection_diagnostics)
        if capsule_submit.get("capability_capsule_id"):
            failure_record["capability_capsule_id"] = capsule_submit["capability_capsule_id"]
            failure_record["logical_operator"] = logical_operator
        write_pm_task_record(task_id, failure_record)
        _write_dispatch_ledger_event(
            {
                "status": "no_dispatchable_operator",
                "task_id": task_id,
                "sprint_id": sprint_id,
                "node_id": node_id,
                "requested_role": normalize_role(role),
                "task_type": task_type,
                "logical_operator": logical_operator,
                "preferred_operator": prefer_operator,
                "selected_operator_id": "",
                "fallback_reason": fallback_reason or "no_dispatchable_operator_for_role",
                "dry_run": False,
                "selection_diagnostics": selection_diagnostics,
            }
        )
        msg = f"ERROR: 没有可用算子 ({fallback_reason})"
        # Surface cooldown ETA when the fallback reason mentions cooldown/quota
        if any(kw in fallback_reason for kw in ("cooldown", "quota_exhausted", "auth_expired")):
            # Try to find the preferred/blocked operator for ETA details
            _blocked_op = prefer_operator or ""
            if _blocked_op:
                _status = get_operator_status_data(_blocked_op)
                _expires = str(_status.get("expires_at") or "")
                _eta = _format_reset_eta(_expires)
                if _eta:
                    msg += f"\n  ⏳ 冷却中，重置时间: {_eta}"
                if _expires:
                    msg += f" (until {_expires})"
        print(msg, file=sys.stderr)
        _print_operator_selection_diagnostics()
        return 1

    # 3. 构建 dispatch 文件
    dispatch_text = build_pm_dispatch_text(
        task_id=task_id,
        operator_id=operator_id,
        operator=operator,
        objective=objective,
        sprint_id=sprint_id,
        node_id=node_id,
        result_path=result_path,
        context=context,
    )

    dispatch_dir = HARNESS_DIR / "run" / "pm-dispatch-files"
    dispatch_dir.mkdir(parents=True, exist_ok=True)
    dispatch_file = dispatch_dir / f"{task_id}.md"

    if dry_run:
        print(f"[DRY-RUN] operator_id = {operator_id}")
        if operator.get("borrowed_for_role"):
            print(
                "[DRY-RUN] role_spillover = "
                f"{operator.get('borrowed_for_role')} from {','.join(operator.get('borrowed_from_roles') or [])}"
            )
        print(f"[DRY-RUN] task_id     = {task_id}")
        print(f"[DRY-RUN] result_path = {result_path}")
        print(f"[DRY-RUN] dispatch_file = {dispatch_file}")
        print("\n--- dispatch preview ---")
        print(dispatch_text[:1500])
        return 0

    # 4. 写 dispatch 文件
    dispatch_file.write_text(dispatch_text, encoding="utf-8")
    try:
        dispatch_json_path = dispatch_file.with_suffix(".dispatch.json")
        _write_dispatch_json(
            dispatch_json_path=dispatch_json_path,
            dispatch_md_path=dispatch_file,
            dispatch_text=dispatch_text,
            dispatch_id=task_id,
            sprint_id=sprint_id,
            node_id=node_id,
            issued_by="pm_pane",
            payload={
                "objective": objective,
                "task_type": task_type or "pm_order",
                "context": context,
            },
        )
    except Exception as e:
        print(f"WARNING: failed to write dispatch.json: {e}", file=sys.stderr)

    # 5. 构建 task envelope → operator_runtime.submit
    envelope = {
        "task_id": task_id,
        "sprint_id": sprint_id,
        "node_id": node_id,
        "operator_id": operator_id,
        "task_type": task_type or "pm_order",
        "objective": objective[:300],
        "dispatch_file": str(dispatch_file),
        "result_path": result_path,
        "issued_by": "pm_pane",
        "issued_at": _now(),
        "pm_context": context[:500] if context else "",
        "requested_role": normalize_role(role),
    }
    if context:
        envelope["context_packet"] = {
            "packet_type": "task",
            "data": {
                "sprint_id": sprint_id,
                "node_id": node_id,
                "task_id": task_id,
                "objective": objective[:300],
                "context": context,
                "requested_role": normalize_role(role),
                "task_type": task_type or "pm_order",
            },
        }
    if operator.get("borrowed_for_role"):
        envelope["borrowed_for_role"] = operator.get("borrowed_for_role")
        envelope["borrowed_from_roles"] = operator.get("borrowed_from_roles", [])
        envelope["borrowed_original_role"] = operator.get("borrowed_original_role", "")
        envelope["borrowed_reason"] = operator.get("borrowed_reason", "")
    if logical_operator:
        envelope["logical_operator"] = logical_operator
    if task_graph_node:
        envelope["task_graph_node"] = {
            "id": task_graph_node.get("id"),
            "goal": task_graph_node.get("goal"),
            "acceptance": task_graph_node.get("acceptance", []),
            "requirement_ids": task_graph_node.get("requirement_ids", []),
        }
    if capsule_submit.get("capability_capsule_id"):
        envelope["capability_native"] = bool(capsule_submit.get("capability_native", True))
        envelope["capability_capsule_id"] = str(capsule_submit["capability_capsule_id"])
        envelope["capsule_plan"] = capsule_submit.get("capsule_plan", {})

    record: dict[str, Any] = {
        "task_id": task_id,
        "sprint_id": sprint_id,
        "node_id": node_id,
        "operator_id": operator_id,
        "objective": objective,
        "dispatch_file": str(dispatch_file),
        "dispatch_path": str(dispatch_file),
        "result_path": result_path,
        "status": "submitted",
        "submitted_at": _now(),
        "requested_role": normalize_role(role),
        "task_type": task_type or "pm_order",
        "logical_operator": logical_operator,
    }
    if selection_diagnostics:
        record["selection_summary"] = _dispatch_ledger_selection_summary(selection_diagnostics)
    if operator.get("borrowed_for_role"):
        record["borrowed_for_role"] = operator.get("borrowed_for_role")
        record["borrowed_from_roles"] = operator.get("borrowed_from_roles", [])
        record["borrowed_original_role"] = operator.get("borrowed_original_role", "")
        record["borrowed_reason"] = operator.get("borrowed_reason", "")
    if capsule_submit.get("capability_capsule_id"):
        record["capability_capsule_id"] = capsule_submit["capability_capsule_id"]
        record["logical_operator"] = logical_operator

    # 尝试通过 operator_runtime.submit 投递；graph evaluator 走直接 inbox 快路径，
    # Claude Code 订阅交互算子走 ActorRuntime mailbox，避免 one-shot API/process surface。
    if _operator_is_claude_subscription_interactive(operator):
        try:
            ActorRuntime = _load_actor_runtime_class()
            submit_result = ActorRuntime().submit(
                envelope,
                actor_id=operator_id,
                sprint_id=sprint_id,
                node_id=node_id,
            )
        except Exception as exc:
            record["status"] = "failed_submit_exception"
            record["failed_at"] = _now()
            record["failure_reason"] = f"actor_runtime.submit failed: {exc}"
            record["submit_error"] = str(exc)
            write_pm_task_record(task_id, record)
            _write_dispatch_ledger_event(
                {
                    "status": "failed_submit_exception",
                    "task_id": task_id,
                    "sprint_id": sprint_id,
                    "node_id": node_id,
                    "requested_role": normalize_role(role),
                    "task_type": task_type or "pm_order",
                    "logical_operator": logical_operator,
                    "preferred_operator": prefer_operator,
                    "selected_operator_id": operator_id,
                    "fallback_reason": fallback_reason,
                    "dry_run": False,
                    "submit_error": str(exc),
                    "selection_diagnostics": selection_diagnostics,
                }
            )
            print(f"ERROR: actor_runtime.submit failed: {exc}", file=sys.stderr)
            return 1
        if not bool(getattr(submit_result, "success", False)):
            error = str(getattr(submit_result, "error", "") or "actor_runtime_submit_failed")
            record["status"] = "failed_submit_exception"
            record["failed_at"] = _now()
            record["failure_reason"] = f"actor_runtime.submit failed: {error}"
            record["submit_error"] = error
            write_pm_task_record(task_id, record)
            _write_dispatch_ledger_event(
                {
                    "status": "failed_submit_exception",
                    "task_id": task_id,
                    "sprint_id": sprint_id,
                    "node_id": node_id,
                    "requested_role": normalize_role(role),
                    "task_type": task_type or "pm_order",
                    "logical_operator": logical_operator,
                    "preferred_operator": prefer_operator,
                    "selected_operator_id": operator_id,
                    "fallback_reason": fallback_reason,
                    "dry_run": False,
                    "submit_error": error,
                    "selection_diagnostics": selection_diagnostics,
                }
            )
            print(f"ERROR: actor_runtime.submit failed: {error}", file=sys.stderr)
            return 1
        lease = getattr(submit_result, "lease", None)
        lease_dict = lease.to_dict() if hasattr(lease, "to_dict") else {}
        record["status"] = "submitted"
        record["lease_id"] = str(lease_dict.get("lease_id") or "")
        record["actor_lease"] = lease_dict
        record["inbox_path"] = str(getattr(submit_result, "inbox_path", "") or "")
        record["outbox_path"] = str(getattr(submit_result, "outbox_path", "") or "")
        record["evidence_ledger_path"] = str(getattr(submit_result, "evidence_ledger_path", "") or "")
        record["run_dir"] = str(getattr(submit_result, "run_dir", "") or "")
        artifact_refs = getattr(submit_result, "artifact_refs", {}) or {}
        if artifact_refs:
            record["artifact_refs"] = artifact_refs
        submit_mode = "actor_runtime.mailbox"
    elif graph_eval_direct_inbox:
        inbox_path = _write_operator_inbox_envelope(operator_id, task_id, envelope)
        record["status"] = "submitted_fallback"
        record["inbox_path"] = str(inbox_path)
        record["submit_bypassed_operator_runtime"] = True
        submit_mode = "direct_inbox_graph_eval"
    else:
        try:
            _ensure_runtime_import_path()

            from operator_runtime import submit  # type: ignore
        except Exception as exc:
            # fallback: 直接写 operator inbox（无 lease，operatord 会拾取）
            inbox_path = _write_operator_inbox_envelope(operator_id, task_id, envelope)
            record["status"] = "submitted_fallback"
            record["inbox_path"] = str(inbox_path)
            record["submit_error"] = str(exc)
            submit_mode = "direct_inbox"
        else:
            try:
                result = submit(envelope)
            except Exception as exc:
                record["status"] = "failed_submit_exception"
                record["failed_at"] = _now()
                record["failure_reason"] = f"operator_runtime.submit failed: {exc}"
                record["submit_error"] = str(exc)
                write_pm_task_record(task_id, record)
                _write_dispatch_ledger_event(
                    {
                        "status": "failed_submit_exception",
                        "task_id": task_id,
                        "sprint_id": sprint_id,
                        "node_id": node_id,
                        "requested_role": normalize_role(role),
                        "task_type": task_type or "pm_order",
                        "logical_operator": logical_operator,
                        "preferred_operator": prefer_operator,
                        "selected_operator_id": operator_id,
                        "fallback_reason": fallback_reason,
                        "dry_run": False,
                        "submit_error": str(exc),
                        "selection_diagnostics": selection_diagnostics,
                    }
                )
                print(f"ERROR: operator_runtime.submit failed: {exc}", file=sys.stderr)
                return 1
            record["status"] = "submitted"
            record["lease_id"] = result.get("lease_id", "")
            record["inbox_path"] = result.get("inbox_path", "")
            if result.get("daemon_pid"):
                record["daemon_pid"] = result.get("daemon_pid")
            submit_mode = "operator_runtime.submit"
    record["submit_mode"] = submit_mode

    graph_eval_dispatch = _mark_graph_node_evaluation_dispatched(record)
    if graph_eval_dispatch.get("marked"):
        record["graph_eval_dispatch"] = graph_eval_dispatch
        record.setdefault("reconcile_history", []).append(
            {"ts": record["submitted_at"], "action": "graph_eval_dispatch", **graph_eval_dispatch}
        )

    _record_pm_dispatch_evidence(record, event="dispatch_submitted")

    # 6. 写 PM inbox 记录
    write_pm_task_record(task_id, record)
    _write_dispatch_ledger_event(
        {
            "status": record.get("status", "submitted"),
            "task_id": task_id,
            "sprint_id": sprint_id,
            "node_id": node_id,
            "requested_role": normalize_role(role),
            "task_type": task_type or "pm_order",
            "logical_operator": logical_operator,
            "preferred_operator": prefer_operator,
            "selected_operator_id": operator_id,
            "fallback_reason": fallback_reason,
            "dry_run": False,
            "submit_mode": submit_mode,
            "selection_diagnostics": selection_diagnostics,
        }
    )

    # 7. 输出
    print(f"✅ PM 任务已提交")
    print(f"   task_id     = {task_id}")
    print(f"   operator    = {operator_id} ({operator.get('model', '?')})")
    if operator.get("borrowed_for_role"):
        print(
            "   spillover   = "
            f"{operator.get('borrowed_for_role')} <- {','.join(operator.get('borrowed_from_roles') or [])}"
        )
    print(f"   submit_mode = {submit_mode}")
    print(f"   dispatch    = {dispatch_file}")
    print(f"   result      = {result_path}")
    print()
    print(f"查看结果：solar-harness pm-fleet inbox")
    print(f"等待完成：watch cat '{result_path}'")

    return 0


def cmd_fleet_status(args: argparse.Namespace) -> int:
    registry = load_registry()
    operators = registry.get("operators", {})
    policy_mod = _load_concurrency_policy_module()
    if policy_mod is not None:
        policy = policy_mod.load_policy()
        level = policy_mod.active_level(policy)
        settings = policy_mod.level_settings(policy, level)
        print(
            "concurrency_knob="
            f"{level} graph_max_parallel={settings.get('graph_max_parallel', 'N/A')} "
            f"builder_dispatch_limit={settings.get('builder_dispatch_limit', 'N/A')}"
        )
    print(f"{'算子 ID':<40} {'角色':<12} {'模型':<20} {'运行时状态':<18} {'冷却/重置 ETA'}")
    print("-" * 110)
    for op_id, spec in operators.items():
        op = dict(spec)
        enabled = op.get("enabled", False)
        if not enabled:
            rt_state = "disabled"
            cooldown_col = ""
        else:
            rt_state = get_operator_runtime_state(op_id)
            cooldown_col = ""
            if rt_state in ("cooldown", "quota_exhausted", "auth_expired"):
                status = get_operator_status_data(op_id)
                expires_at = str(status.get("expires_at") or "")
                eta = _format_reset_eta(expires_at)
                cooldown_col = f"{rt_state}"
                if eta:
                    cooldown_col += f" resets {eta}"
                if expires_at:
                    cooldown_col += f" [{expires_at}]"
        role = str(op.get("role", "?"))
        model = str(op.get("model", "?"))
        ok_sym = "✅" if enabled else "❌"
        print(f"{ok_sym} {op_id:<38} {role:<12} {model:<20} {rt_state:<18} {cooldown_col}")
    return 0


def _pending_pm_backlog_count() -> int:
    count = 0
    for payload in _iter_pm_inbox_projections():
        status = str(payload.get("status") or "").strip().lower()
        if not _pm_status_is_terminal(status):
            count += 1
    return count


def _active_pm_sprint_ids() -> set[str]:
    active: set[str] = set()
    for payload in _iter_pm_inbox_projections():
        if _pm_status_is_terminal(str(payload.get("status") or "")):
            continue
        sid = str(payload.get("sprint_id") or "").strip()
        if sid:
            active.add(sid)
    return active


def _decode_json_string(value: str) -> str:
    try:
        return json.loads(f'"{value}"')
    except Exception:
        return value


def _scan_json_string_field(text: str, key: str) -> str:
    match = re.search(rf'"{re.escape(key)}"\s*:\s*"((?:\\.|[^"\\])*)"', text)
    return _decode_json_string(match.group(1)) if match else ""


def _status_projection_from_path(path: Path) -> dict[str, str]:
    sid_default = _sprint_id_from_status_path(path)
    try:
        size = path.stat().st_size
    except Exception:
        size = 0
    try:
        if size <= STATUS_FULL_LOAD_MAX_BYTES:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                return {}
            return {
                "sprint_id": str(payload.get("sprint_id") or sid_default).strip(),
                "status": str(payload.get("status") or "").strip().lower(),
                "phase": str(payload.get("phase") or "").strip().lower(),
                "handoff_to": str(payload.get("handoff_to") or "").strip().lower(),
            }
        with open(path, "rb") as f:
            text = f.read(max(STATUS_SCAN_BYTES, 1024)).decode("utf-8", errors="replace")
        return {
            "sprint_id": (_scan_json_string_field(text, "sprint_id") or sid_default).strip(),
            "status": _scan_json_string_field(text, "status").strip().lower(),
            "phase": _scan_json_string_field(text, "phase").strip().lower(),
            "handoff_to": _scan_json_string_field(text, "handoff_to").strip().lower(),
        }
    except Exception:
        return {}


def _iter_status_projections() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for path in SPRINTS_DIR.glob("*.status.json"):
        row = _status_projection_from_path(path)
        if row:
            rows.append(row)
    return rows


def _pm_inbox_projection_from_path(path: Path) -> dict[str, str]:
    try:
        with open(path, "rb") as f:
            text = f.read(max(STATUS_SCAN_BYTES, 1024)).decode("utf-8", errors="replace")
        task_id = (_scan_json_string_field(text, "task_id") or path.stem).strip()
        return {
            "task_id": task_id,
            "sprint_id": _scan_json_string_field(text, "sprint_id").strip(),
            "node_id": _scan_json_string_field(text, "node_id").strip(),
            "status": _scan_json_string_field(text, "status").strip().lower(),
            "operator_id": _scan_json_string_field(text, "operator_id").strip(),
            "requested_role": (
                _scan_json_string_field(text, "requested_role") or _scan_json_string_field(text, "role")
            ).strip().lower(),
            "borrowed_for_role": _scan_json_string_field(text, "borrowed_for_role").strip().lower(),
            "path": str(path),
        }
    except Exception:
        return {}


def _iter_pm_inbox_projections() -> list[dict[str, str]]:
    global _PM_INBOX_PROJECTION_CACHE
    now = time.time()
    cache_key = str(PM_INBOX_DIR)
    try:
        cache_mtime_ns = pm_inbox_dir().stat().st_mtime_ns
    except Exception:
        cache_mtime_ns = 0
    if _PM_INBOX_PROJECTION_CACHE is not None:
        cache_ts, cached_key, cached_mtime_ns, cached_rows = _PM_INBOX_PROJECTION_CACHE
        if cached_key == cache_key and cached_mtime_ns == cache_mtime_ns and now - cache_ts <= 2.0:
            return list(cached_rows)
    rows: list[dict[str, str]] = []
    for path in pm_inbox_dir().glob("pm-*.json"):
        row = _pm_inbox_projection_from_path(path)
        if row:
            rows.append(row)
    _PM_INBOX_PROJECTION_CACHE = (now, cache_key, cache_mtime_ns, rows)
    return rows


def _pm_inbox_backlog_summary() -> tuple[int, set[str]]:
    pending = 0
    active_sprints: set[str] = set()
    for payload in _iter_pm_inbox_projections():
        status = str(payload.get("status") or "").strip().lower()
        if status not in ACTIVE_PM_OPERATOR_STATUSES or _pm_status_is_terminal(status):
            continue
        pending += 1
        sid = str(payload.get("sprint_id") or "").strip()
        if sid:
            active_sprints.add(sid)
    return pending, active_sprints


def _read_builder_pool_backlog_cache() -> dict[str, int] | None:
    if BUILDER_POOL_BACKLOG_CACHE_TTL_SEC <= 0:
        return None
    try:
        if not BUILDER_POOL_BACKLOG_CACHE.exists():
            return None
        if time.time() - BUILDER_POOL_BACKLOG_CACHE.stat().st_mtime > BUILDER_POOL_BACKLOG_CACHE_TTL_SEC:
            return None
        payload = json.loads(BUILDER_POOL_BACKLOG_CACHE.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            return None
        if str(payload.get("sprints_dir") or "") != str(SPRINTS_DIR):
            return None
        if str(payload.get("pm_inbox_dir") or "") != str(PM_INBOX_DIR):
            return None
        if int(payload.get("pm_inbox_mtime_ns", -1)) != _directory_mtime_ns(PM_INBOX_DIR):
            return None
        if int(payload.get("sprints_mtime_ns", -1)) != _directory_mtime_ns(SPRINTS_DIR):
            return None
        breakdown = payload.get("breakdown") if isinstance(payload.get("breakdown"), dict) else {}
        required = {
            "pending_pm",
            "latent_builder_ready",
            "planner_prd_ready",
            "builder_planning_complete",
            "blocked_builder_planning_complete",
            "graph_waiting_builder_planning_complete",
            "filtered_builder_planning_complete",
            "evaluator_handoff_ready",
            "total",
        }
        if not required.issubset(set(breakdown.keys())):
            return None
        return {key: int(breakdown.get(key, 0) or 0) for key in required}
    except Exception:
        return None


def _write_builder_pool_backlog_cache(breakdown: dict[str, int]) -> None:
    if BUILDER_POOL_BACKLOG_CACHE_TTL_SEC <= 0:
        return
    try:
        BUILDER_POOL_BACKLOG_CACHE.parent.mkdir(parents=True, exist_ok=True)
        tmp = BUILDER_POOL_BACKLOG_CACHE.with_suffix(f".json.{os.getpid()}.{time.time_ns()}.tmp")
        payload = {
            "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
            "sprints_dir": str(SPRINTS_DIR),
            "pm_inbox_dir": str(PM_INBOX_DIR),
            "pm_inbox_mtime_ns": _directory_mtime_ns(PM_INBOX_DIR),
            "sprints_mtime_ns": _directory_mtime_ns(SPRINTS_DIR),
            "breakdown": breakdown,
        }
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(BUILDER_POOL_BACKLOG_CACHE)
    except Exception:
        pass


def _directory_mtime_ns(path: Path) -> int:
    try:
        latest = path.stat().st_mtime_ns
        for child in path.iterdir():
            try:
                latest = max(latest, child.stat().st_mtime_ns)
            except OSError:
                continue
        return latest
    except OSError:
        return 0


def _invalidate_builder_pool_backlog_cache() -> None:
    try:
        BUILDER_POOL_BACKLOG_CACHE.unlink()
    except FileNotFoundError:
        return
    except Exception:
        pass


def _status_backlog_count(*, statuses: set[str], phase: str, handoff_to: str = "", exclude_sprints: set[str] | None = None) -> int:
    exclude_sprints = exclude_sprints or set()
    count = 0
    phase_value = phase.strip().lower()
    handoff_value = handoff_to.strip().lower()
    for payload in _iter_status_projections():
        sid = str(payload.get("sprint_id") or "").strip()
        if sid in exclude_sprints:
            continue
        status = str(payload.get("status") or "").strip().lower()
        if status not in statuses or _pm_status_is_terminal(status):
            continue
        if phase_value and str(payload.get("phase") or "").strip().lower() != phase_value:
            continue
        if handoff_value and str(payload.get("handoff_to") or "").strip().lower() != handoff_value:
            continue
        count += 1
    return count


def _builder_pool_backlog_breakdown() -> dict[str, int]:
    cached = _read_builder_pool_backlog_cache()
    if cached is not None:
        return cached
    pending_pm, active_pm_sprints = _pm_inbox_backlog_summary()
    latent_items = _latent_builder_ready_items()
    latent_builder_ready = len(latent_items)
    latent_builder_sprints = {str(item.get("sprint_id") or "").strip() for item in latent_items}
    planner_prd_ready = 0
    builder_planning_complete = 0
    blocked_builder_planning_complete = 0
    graph_waiting_builder_planning_complete = 0
    filtered_builder_planning_complete = 0
    evaluator_handoff_ready = 0
    for payload in _iter_status_projections():
        sprint_id = str(payload.get("sprint_id") or "").strip()
        if sprint_id in active_pm_sprints:
            continue
        status = str(payload.get("status") or "").strip().lower()
        phase = str(payload.get("phase") or "").strip().lower()
        handoff = str(payload.get("handoff_to") or "").strip().lower()
        if status in {"active", "drafting"} and phase == "prd_ready" and handoff == "planner":
            planner_prd_ready += 1
            continue
        if status == "active" and phase == "planning_complete" and handoff == "builder_main":
            builder_planning_complete += 1
            if sprint_id not in latent_builder_sprints:
                nodes, meta = _builder_ready_nodes_for_sprint(sprint_id)
                if meta.get("ok") and int(meta.get("graph_ready_count", 0) or 0) <= 0:
                    graph_waiting_builder_planning_complete += 1
                else:
                    blocked_builder_planning_complete += 1
                    if meta.get("ok") and not nodes:
                        filtered_builder_planning_complete += 1
            continue
        if status != "reviewing":
            continue
        if phase != "handoff_ready":
            continue
        if handoff != "evaluator":
            continue
        if _sprint_has_actionable_eval_backlog(sprint_id):
            evaluator_handoff_ready += 1
    breakdown = {
        "pending_pm": pending_pm,
        "latent_builder_ready": latent_builder_ready,
        "planner_prd_ready": planner_prd_ready,
        "builder_planning_complete": builder_planning_complete,
        "blocked_builder_planning_complete": blocked_builder_planning_complete,
        "graph_waiting_builder_planning_complete": graph_waiting_builder_planning_complete,
        "filtered_builder_planning_complete": filtered_builder_planning_complete,
        "evaluator_handoff_ready": evaluator_handoff_ready,
        "total": (
            pending_pm
            + latent_builder_ready
            + planner_prd_ready
            + evaluator_handoff_ready
        ),
    }
    _write_builder_pool_backlog_cache(breakdown)
    return breakdown


def builder_pool_snapshot(recover: bool = False) -> dict[str, Any]:
    registry = load_registry()
    operators = registry.get("operators", {})
    policy_mod = _load_concurrency_policy_module()
    if policy_mod is None:
        return {"ok": False, "reason": "concurrency_policy_unavailable"}
    policy = policy_mod.load_policy()
    pool = policy_mod.builder_pool_config(policy)
    groups_cfg = pool.get("groups") if isinstance(pool.get("groups"), dict) else {}
    try:
        autoscale_snapshot = (
            policy_mod.backlog_autoscaling_snapshot(policy)
            if hasattr(policy_mod, "backlog_autoscaling_snapshot")
            else {}
        )
    except Exception:
        autoscale_snapshot = {}
    dynamic_pool = autoscale_snapshot.get("builder_pool") if isinstance(autoscale_snapshot.get("builder_pool"), dict) else {}
    dynamic_groups = dynamic_pool.get("groups") if isinstance(dynamic_pool.get("groups"), dict) else {}
    group_desired_cache: dict[str, int] = {}
    groups: dict[str, dict[str, Any]] = {}
    rows: list[dict[str, Any]] = []
    recovery_actions: list[dict[str, Any]] = []
    def group_desired(group: str, spec: dict[str, Any] | None = None) -> int:
        if group in group_desired_cache:
            return group_desired_cache[group]
        try:
            if group in dynamic_groups:
                value = int(dynamic_groups.get(group, 0))
            elif dynamic_pool:
                value = int((spec or {}).get("desired", 0) or 0)
            else:
                value = int(policy_mod.pool_group_desired(group, policy))
        except Exception:
            value = int((spec or {}).get("desired", 0) or 0)
        group_desired_cache[group] = value
        return value

    for group, spec in groups_cfg.items():
        groups[group] = {
            "desired": group_desired(group, spec if isinstance(spec, dict) else {}),
            "configured": 0,
            "available": 0,
            "blocked": 0,
            "cooldown": 0,
            "quota_exhausted": 0,
            "auth_expired": 0,
            "health": 0,
            "busy": 0,
            "disabled": 0,
            "other_blocked": 0,
        }

    pool_member_specs: list[tuple[str, dict[str, Any], str]] = []
    for op_id, spec in operators.items():
        op = {"operator_id": op_id, **dict(spec)}
        if not policy_mod.is_pool_member(op):
            continue
        group = policy_mod.infer_builder_group(op) or "unknown"
        pool_member_specs.append((str(op_id), dict(spec), group))

    rate_limit_blocks: list[dict[str, Any]] = []
    for op_id, spec, group in pool_member_specs:
        op = {"operator_id": op_id, **dict(spec)}
        groups.setdefault(
            group,
            {
                "desired": group_desired(group),
                "configured": 0,
                "available": 0,
                "blocked": 0,
                "cooldown": 0,
                "quota_exhausted": 0,
                "auth_expired": 0,
                "health": 0,
                "busy": 0,
                "disabled": 0,
                "other_blocked": 0,
            },
        )
        groups[group]["configured"] += 1
        ok, reason = _is_dispatchable_on_surface(op, "mailbox")
        if recover and not ok and "health_check_failed" in reason:
            started, start_reason = _try_auto_start_operator(op)
            recovery_actions.append({"operator_id": op_id, "action": "auto_start", "ok": started, "reason": start_reason})
        state = get_operator_runtime_state(op_id) if op.get("enabled", False) else "disabled"
        actor_state = _actor_lease_runtime_state(op_id)
        if actor_state and state not in {"cooldown", "quota_exhausted", "auth_expired", "disabled"}:
            state = actor_state
        block_info = _operator_block_info(op_id, op, state, reason)
        block_type = str(block_info.get("block_type") or "none")
        if ok and block_type in HARD_BLOCK_TYPES:
            block_info = {
                "block_type": "none",
                "quota_guard_state": block_info.get("quota_guard_state", "ok"),
                "cooldown_until": "",
                "cooldown_eta": "",
            }
            block_type = "none"
        if ok:
            groups[group]["available"] += 1
        else:
            groups[group]["blocked"] += 1
            if block_type in HARD_BLOCK_TYPES:
                groups[group][block_type] += 1
            else:
                groups[group]["other_blocked"] += 1
        if block_type in {"cooldown", "quota_exhausted", "auth_expired"}:
            rate_limit_blocks.append(
                {
                    "operator_id": op_id,
                    "group": group,
                    "model": spec.get("model", "N/A"),
                    "block_type": block_type,
                    "quota_guard_state": block_info.get("quota_guard_state", "ok"),
                    "cooldown_until": block_info.get("cooldown_until", ""),
                    "cooldown_eta": block_info.get("cooldown_eta", ""),
                    "reason": reason or state,
                }
            )
        rows.append(
            {
                "operator_id": op_id,
                "group": group,
                "model": spec.get("model", "N/A"),
                "enabled": bool(spec.get("enabled", False)),
                "runtime_state": state,
                "available": ok,
                "reason": reason or "ok",
                **block_info,
            }
        )

    backlog_breakdown = _builder_pool_backlog_breakdown()
    backlog = int(backlog_breakdown.get("total", 0))
    try:
        if "desired_total" in dynamic_pool:
            total_desired = int(dynamic_pool.get("desired_total") or 0)
        elif dynamic_pool:
            total_desired = int(pool.get("desired_total", 0) or 0)
        else:
            total_desired = int(policy_mod.builder_pool_desired_total(policy) or 0)
    except Exception:
        total_desired = int(pool.get("desired_total", 0) or 0)
    if total_desired <= 0:
        total_desired = sum(int(item.get("desired", 0)) for item in groups.values())
    total_configured = sum(int(item.get("configured", 0)) for item in groups.values())
    total_available = sum(int(item.get("available", 0)) for item in groups.values())
    total_busy = sum(int(item.get("busy", 0)) for item in groups.values())
    recovery = policy_mod.recovery_settings(policy)
    high_backlog = int(recovery.get("high_backlog_pending_tasks", 6))
    min_ratio = float(recovery.get("min_available_ratio", 0.5))
    ratio = (total_available / total_desired) if total_desired else 0.0
    recommended_action = "ok"
    if backlog >= high_backlog and ratio < min_ratio:
        if total_desired > 0 and total_available + total_busy >= total_desired:
            recommended_action = "ok_busy_at_capacity"
        elif bool(recovery.get("auto_start_services", False)):
            recommended_action = "auto_start_services_enabled"
        else:
            recommended_action = "inspect_dead_or_unhealthy_builders"
    return {
        "ok": True,
        "level": policy_mod.active_level(policy),
        "policy_path": policy.get("_policy_path", "N/A"),
        "backlog": backlog,
        "backlog_breakdown": backlog_breakdown,
        "total_desired": total_desired,
        "total_configured": total_configured,
        "total_available": total_available,
        "total_busy": total_busy,
        "available_ratio": round(ratio, 3),
        "recommended_action": recommended_action,
        "recovery_actions": recovery_actions,
        "rate_limit_pruner": _rate_limit_pruner_status(),
        "operator_health_watchdog": _operator_health_watchdog_status(),
        "rate_limit_blocks": rate_limit_blocks,
        "groups": groups,
        "operators": rows,
    }


def cmd_builder_pool_status(args: argparse.Namespace) -> int:
    snapshot = builder_pool_snapshot(recover=bool(getattr(args, "recover", False)))
    if getattr(args, "json", False):
        print(json.dumps(snapshot, indent=2, ensure_ascii=False))
        return 0 if snapshot.get("ok") else 1
    breakdown = snapshot.get("backlog_breakdown") if isinstance(snapshot.get("backlog_breakdown"), dict) else {}
    print(
        f"builder_pool level={snapshot.get('level', 'N/A')} "
        f"available={snapshot.get('total_available', 'N/A')}/{snapshot.get('total_desired', 'N/A')} "
        f"backlog={snapshot.get('backlog', 'N/A')} "
        f"(pm={breakdown.get('pending_pm', 'N/A')} planner={breakdown.get('planner_prd_ready', 'N/A')} "
        f"builder={breakdown.get('builder_planning_complete', 'N/A')} "
        f"eval={breakdown.get('evaluator_handoff_ready', 'N/A')} "
        f"latent={breakdown.get('latent_builder_ready', 'N/A')}) "
        f"action={snapshot.get('recommended_action', 'N/A')}"
    )
    pruner = snapshot.get("rate_limit_pruner") if isinstance(snapshot.get("rate_limit_pruner"), dict) else {}
    print(
        "rate_limit_pruner "
        f"installed={pruner.get('installed', 'N/A')} loaded={pruner.get('launchd_loaded', 'N/A')} "
        f"interval={pruner.get('run_interval_seconds') or 'N/A'}s "
        f"runs={pruner.get('runs') if pruner.get('runs') is not None else 'N/A'} "
        f"last_exit={pruner.get('last_exit_code') if pruner.get('last_exit_code') is not None else 'N/A'}"
    )
    watchdog = snapshot.get("operator_health_watchdog") if isinstance(snapshot.get("operator_health_watchdog"), dict) else {}
    print(
        "operator_health_watchdog "
        f"installed={watchdog.get('installed', 'N/A')} loaded={watchdog.get('launchd_loaded', 'N/A')} "
        f"last_run={watchdog.get('last_run_at') or 'N/A'} "
        f"last_exit={watchdog.get('last_exit_code') if watchdog.get('last_exit_code') is not None else 'N/A'} "
        f"degraded={watchdog.get('degraded_reason') or 'N/A'}"
    )
    print(
        f"{'group':<34} {'desired':>7} {'configured':>10} {'available':>9} "
        f"{'blocked':>8} {'cool':>5} {'quota':>5} {'auth':>4} {'health':>6} {'busy':>4}"
    )
    print("-" * 116)
    for group, data in (snapshot.get("groups") or {}).items():
        print(
            f"{group:<34} {int(data.get('desired', 0)):>7} "
            f"{int(data.get('configured', 0)):>10} {int(data.get('available', 0)):>9} {int(data.get('blocked', 0)):>8} "
            f"{int(data.get('cooldown', 0)):>5} {int(data.get('quota_exhausted', 0)):>5} "
            f"{int(data.get('auth_expired', 0)):>4} {int(data.get('health', 0)):>6} {int(data.get('busy', 0)):>4}"
        )
    blocks = snapshot.get("rate_limit_blocks") if isinstance(snapshot.get("rate_limit_blocks"), list) else []
    if blocks:
        print()
        print(f"{'rate-limited builder':<38} {'group':<28} {'state':<16} {'reset eta':<10} {'until'}")
        print("-" * 120)
        for item in blocks:
            print(
                f"{str(item.get('operator_id', 'N/A')):<38} "
                f"{str(item.get('group', 'N/A')):<28} "
                f"{str(item.get('block_type', 'N/A')):<16} "
                f"{str(item.get('cooldown_eta') or 'N/A'):<10} "
                f"{str(item.get('cooldown_until') or 'N/A')}"
            )
    return 0 if snapshot.get("ok") else 1


def _run_cmd_submit_for_builder_node(item: dict[str, Any], dry_run: bool, json_mode: bool) -> dict[str, Any]:
    sprint_id = str(item.get("sprint_id") or "")
    node_id = str(item.get("node_id") or "")
    before_task_ids = {
        str(payload.get("task_id") or "")
        for payload in [_active_pm_record_for_node(sprint_id, node_id)]
        if payload
    }
    args = argparse.Namespace(
        role="builder",
        objective=str(item.get("objective") or ""),
        operator="",
        sprint=sprint_id,
        node=node_id,
        task_type=str(item.get("task_type") or "implementation"),
        context=(
            f"auto_drain_source=planning_complete\n"
            f"task_graph={item.get('graph')}\n"
            f"logical_operator={item.get('logical_operator') or 'N/A'}"
        ),
        dry_run=dry_run,
    )
    old_direct = os.environ.get("SOLAR_PM_DISPATCH_ALLOW_DIRECT")
    os.environ["SOLAR_PM_DISPATCH_ALLOW_DIRECT"] = "1"
    stdout = io.StringIO()
    stderr = io.StringIO()
    try:
        if json_mode:
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                rc = cmd_submit(args)
        else:
            rc = cmd_submit(args)
    finally:
        if old_direct is None:
            os.environ.pop("SOLAR_PM_DISPATCH_ALLOW_DIRECT", None)
        else:
            os.environ["SOLAR_PM_DISPATCH_ALLOW_DIRECT"] = old_direct

    record = _active_pm_record_for_node(sprint_id, node_id)
    task_id = ""
    operator_id = ""
    if record:
        task_id = str(record.get("task_id") or "")
        operator_id = str(record.get("operator_id") or "")
    if task_id in before_task_ids:
        task_id = ""
    stdout_text = stdout.getvalue() if json_mode else ""
    if not task_id and stdout_text:
        match = re.search(r"task_id\s*=\s*(\S+)", stdout_text)
        if match:
            task_id = match.group(1).strip()
    if not operator_id and stdout_text:
        match = re.search(r"operator\s*=\s*([^\s(]+)", stdout_text)
        if match:
            operator_id = match.group(1).strip()
    return {
        **item,
        "ok": rc == 0,
        "returncode": rc,
        "task_id": task_id,
        "operator_id": operator_id,
        "stdout": stdout_text,
        "stderr": stderr.getvalue() if json_mode else "",
    }


def _run_cmd_submit_for_planner_item(item: dict[str, Any], dry_run: bool, json_mode: bool) -> dict[str, Any]:
    sprint_id = str(item.get("sprint_id") or "")
    node_id = str(item.get("node_id") or "N0")
    before_task_ids = {
        str(payload.get("task_id") or "")
        for payload in [_active_pm_record_for_node(sprint_id, node_id)]
        if payload
    }
    args = argparse.Namespace(
        role="planner",
        objective=str(item.get("objective") or _planner_objective_for_compiled_sprint(sprint_id)),
        operator="",
        sprint=sprint_id,
        node=node_id,
        task_type=str(item.get("task_type") or "planning"),
        context=(
            "auto_drain_source=prd_ready\n"
            f"status_phase={item.get('phase') or 'prd_ready'}\n"
            f"handoff_to={item.get('handoff_to') or 'planner'}"
        ),
        dry_run=dry_run,
    )
    old_direct = os.environ.get("SOLAR_PM_DISPATCH_ALLOW_DIRECT")
    os.environ["SOLAR_PM_DISPATCH_ALLOW_DIRECT"] = "1"
    stdout = io.StringIO()
    stderr = io.StringIO()
    try:
        if json_mode:
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                rc = cmd_submit(args)
        else:
            rc = cmd_submit(args)
    finally:
        if old_direct is None:
            os.environ.pop("SOLAR_PM_DISPATCH_ALLOW_DIRECT", None)
        else:
            os.environ["SOLAR_PM_DISPATCH_ALLOW_DIRECT"] = old_direct

    record = _active_pm_record_for_node(sprint_id, node_id)
    task_id = ""
    operator_id = ""
    if record:
        task_id = str(record.get("task_id") or "")
        operator_id = str(record.get("operator_id") or "")
    if task_id in before_task_ids:
        task_id = ""
    stdout_text = stdout.getvalue() if json_mode else ""
    if not task_id and stdout_text:
        match = re.search(r"task_id\s*=\s*(\S+)", stdout_text)
        if match:
            task_id = match.group(1).strip()
    if not operator_id and stdout_text:
        match = re.search(r"operator\s*=\s*([^\s(]+)", stdout_text)
        if match:
            operator_id = match.group(1).strip()
    return {
        **item,
        "ok": rc == 0,
        "returncode": rc,
        "task_id": task_id,
        "operator_id": operator_id,
        "stdout": stdout_text,
        "stderr": stderr.getvalue() if json_mode else "",
    }


def _mark_graph_node_pm_dispatched(item: dict[str, Any], submitted: dict[str, Any]) -> dict[str, Any]:
    graph_scheduler = _load_graph_scheduler_module()
    if graph_scheduler is None:
        return {"ok": False, "reason": "graph_scheduler_unavailable"}
    graph_path = Path(str(item.get("graph") or ""))
    if not graph_path.exists():
        return {"ok": False, "reason": "graph_missing", "graph": str(graph_path)}
    sprint_id = str(item.get("sprint_id") or "")
    node_id = str(item.get("node_id") or "")
    task_id = str(submitted.get("task_id") or "")
    operator_id = str(submitted.get("operator_id") or "")
    if not task_id:
        return {"ok": False, "reason": "missing_pm_task_id", "sprint_id": sprint_id, "node_id": node_id}
    try:
        graph_scheduler.SPRINTS_DIR = SPRINTS_DIR
        graph = graph_scheduler.load_graph(graph_path)
        graph_scheduler.set_node_status(graph, node_id, "dispatched", pane=operator_id or None, dispatch_id=task_id or None)
        for node in graph.get("nodes", []) or []:
            if str(node.get("id") or "") != node_id:
                continue
            node["dispatched_via"] = "pm_dispatch"
            node["pm_task_id"] = task_id
            node["operator_id"] = operator_id
            break
        graph.setdefault("node_results", {}).setdefault(node_id, {})
        graph["node_results"][node_id]["dispatched_via"] = "pm_dispatch"
        graph["node_results"][node_id]["pm_task_id"] = task_id
        graph["node_results"][node_id]["operator_id"] = operator_id
        graph["node_results"][node_id]["updated_at"] = _now()
        graph_scheduler.save_graph(graph_path, graph)
    except Exception as exc:
        return {"ok": False, "reason": f"mark_failed:{type(exc).__name__}", "error": str(exc), "sprint_id": sprint_id, "node_id": node_id}
    state_sync = _sync_task_dag_state_node(
        sprint_id,
        node_id,
        "dispatched",
        assigned_to=operator_id,
        dispatch_id=task_id,
        note="pm_dispatch builder dispatch",
    )
    return {
        "ok": True,
        "sprint_id": sprint_id,
        "node_id": node_id,
        "task_id": task_id,
        "operator_id": operator_id,
        "state_sync": state_sync,
    }


def _release_graph_node_on_transient_operator_failure(record: dict[str, Any]) -> dict[str, Any]:
    reason = _transient_operator_failure_text(record)
    requeue_reason = ""
    if TRANSIENT_OPERATOR_FAILURE_RE.search(reason):
        requeue_reason = "transient_operator_failure"
    elif str(record.get("status") or "").strip().lower() == "failed_contract_closeout":
        requeue_reason = "failed_contract_closeout"
    if not requeue_reason:
        return {"ok": False, "released": False, "reason": "not_transient_operator_failure"}
    sprint_id = str(record.get("sprint_id") or "").strip()
    node_id = str(record.get("node_id") or "").strip()
    task_id = str(record.get("task_id") or "").strip()
    if not sprint_id or not node_id or not task_id:
        return {"ok": False, "released": False, "reason": "missing_graph_identity"}
    graph_path = SPRINTS_DIR / f"{sprint_id}.task_graph.json"
    if not graph_path.exists():
        return {"ok": False, "released": False, "reason": "graph_missing", "graph": str(graph_path)}
    try:
        graph = json.loads(graph_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"ok": False, "released": False, "reason": f"graph_read_failed:{type(exc).__name__}", "graph": str(graph_path)}

    nodes = graph.get("nodes") or []
    if isinstance(nodes, dict):
        iterable = nodes.items()
    else:
        iterable = [(str(node.get("id") or node.get("node_id") or ""), node) for node in nodes if isinstance(node, dict)]

    target: dict[str, Any] | None = None
    for candidate_id, node in iterable:
        if str(candidate_id) == node_id:
            target = node
            break
    if target is None:
        return {"ok": False, "released": False, "reason": "node_missing", "graph": str(graph_path), "node_id": node_id}
    target_status = str(target.get("status") or "").strip().lower()
    if target_status not in {"pending", "assigned", "dispatched", "in_progress", "running"}:
        return {"ok": False, "released": False, "reason": "node_not_dispatched", "status": str(target.get("status") or "")}

    dispatch_ids = {
        str(target.get("dispatch_id") or ""),
        str(target.get("pm_task_id") or ""),
    }
    if not isinstance(graph.get("node_results"), dict):
        graph["node_results"] = {}
    node_results = graph["node_results"]
    result_entry = node_results.get(node_id) if isinstance(node_results.get(node_id), dict) else {}
    dispatch_ids.add(str(result_entry.get("dispatch_id") or ""))
    dispatch_ids.add(str(result_entry.get("pm_task_id") or ""))
    if task_id not in dispatch_ids:
        record_operator = str(record.get("operator_id") or "").strip()
        graph_operator_ids = {
            str(target.get("operator_id") or "").strip(),
            str(target.get("assigned_to") or "").strip().removeprefix("operator:"),
            str(result_entry.get("operator_id") or "").strip(),
            str(result_entry.get("assigned_to") or "").strip().removeprefix("operator:"),
        }
        graph_operator_ids.discard("")
        graph_pm_task_ids = {
            str(target.get("pm_task_id") or "").strip(),
            str(result_entry.get("pm_task_id") or "").strip(),
        }
        graph_pm_task_ids.discard("")
        assigned_placeholders = {
            str(target.get("assigned_to") or "").strip(),
            str(result_entry.get("assigned_to") or "").strip(),
        }
        graph_dispatch_ids = {item for item in dispatch_ids if item}
        dispatchless_pool_claim = (
            not graph_pm_task_ids
            and (
                not graph_dispatch_ids
                or any(item.startswith("operator-pool:") for item in assigned_placeholders)
                or any(item.startswith("graph-") for item in graph_dispatch_ids)
            )
        )
        if not dispatchless_pool_claim and (not record_operator or record_operator not in graph_operator_ids):
            return {"ok": False, "released": False, "reason": "dispatch_mismatch", "node_id": node_id}

    now = _now()
    previous = {
        key: target.get(key)
        for key in ("status", "assigned_to", "dispatch_id", "dispatched_via", "pm_task_id", "operator_id")
        if target.get(key) is not None
    }
    target.setdefault("dispatch_requeue_history", []).append(
        {
            "ts": now,
            "reason": requeue_reason,
            "failure_reason": reason[:500],
            "previous_dispatch": previous,
        }
    )
    history = target.get("dispatch_requeue_history")
    if not isinstance(history, list):
        history = []
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
        seconds=max(0, GRAPH_TRANSIENT_FAILURE_BLOCK_WINDOW_SEC)
    )
    recent_failures = []
    for item in history:
        if not isinstance(item, dict):
            continue
        if str(item.get("reason") or "") != "transient_operator_failure":
            continue
        ts = _parse_utc_ts(item.get("ts"))
        if ts is None or ts >= cutoff:
            recent_failures.append(item)
    should_block = (
        requeue_reason == "transient_operator_failure"
        and
        GRAPH_TRANSIENT_FAILURE_BLOCK_THRESHOLD > 0
        and len(recent_failures) >= GRAPH_TRANSIENT_FAILURE_BLOCK_THRESHOLD
    )
    target["status"] = "worker_blocked" if should_block else "pending"
    target["updated_at"] = now
    target["requeue_reason"] = requeue_reason
    if should_block:
        target["blocking_reason"] = "repeated_transient_operator_failure"
        target["transient_failure_blocked_at"] = now
        target["transient_failure_block_count"] = len(recent_failures)
    for key in ("assigned_to", "dispatch_id", "dispatched_via", "pm_task_id", "operator_id"):
        target.pop(key, None)

    result_entry.setdefault("dispatch_requeue_history", []).append(
        {
            "ts": now,
            "reason": requeue_reason,
            "task_id": task_id,
            "operator_id": str(record.get("operator_id") or ""),
        }
    )
    result_entry["status"] = "worker_blocked" if should_block else "pending"
    result_entry["updated_at"] = now
    result_entry["requeue_reason"] = requeue_reason
    if should_block:
        result_entry["blocking_reason"] = "repeated_transient_operator_failure"
        result_entry["failure_reason"] = reason[:1000]
        result_entry["blocked_at"] = now
        result_entry["transient_failure_block_count"] = len(recent_failures)
    for key in ("assigned_to", "dispatch_id", "dispatched_via", "pm_task_id", "operator_id"):
        result_entry.pop(key, None)
    node_results[node_id] = result_entry

    graph_path.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    next_status = "worker_blocked" if should_block else "pending"
    state_sync = _sync_task_dag_state_node(
        sprint_id,
        node_id,
        next_status,
        note="repeated transient operator failure blocked" if should_block else f"{requeue_reason} requeue",
    )
    return {
        "ok": True,
        "released": True,
        "blocked": should_block,
        "reason": "repeated_transient_operator_failure" if should_block else requeue_reason,
        "graph": str(graph_path),
        "sprint_id": sprint_id,
        "node_id": node_id,
        "state_sync": state_sync,
    }


def release_builder_assignment_on_transient_failure(record: dict[str, Any]) -> dict[str, Any]:
    """Safe public helper: release builder graph assignment for transient provider failures."""
    return _release_graph_node_on_transient_operator_failure(record)


def _mark_graph_node_evaluation_dispatched(record: dict[str, Any]) -> dict[str, Any]:
    if normalize_role(str(record.get("requested_role") or "")) != "evaluator":
        return {"ok": False, "marked": False, "reason": "not_evaluator_task"}
    sprint_id = str(record.get("sprint_id") or "").strip()
    node_id = str(record.get("node_id") or "").strip()
    task_id = str(record.get("task_id") or "").strip()
    if not sprint_id or not node_id or not task_id:
        return {"ok": False, "marked": False, "reason": "missing_graph_identity"}
    graph_path = SPRINTS_DIR / f"{sprint_id}.task_graph.json"
    if not graph_path.exists():
        return {"ok": False, "marked": False, "reason": "graph_missing", "graph": str(graph_path)}
    try:
        graph = json.loads(graph_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"ok": False, "marked": False, "reason": f"graph_read_failed:{type(exc).__name__}", "graph": str(graph_path)}

    nodes = graph.get("nodes") or []
    if isinstance(nodes, dict):
        iterable = nodes.items()
    else:
        iterable = [(str(node.get("id") or node.get("node_id") or ""), node) for node in nodes if isinstance(node, dict)]

    target: dict[str, Any] | None = None
    for candidate_id, node in iterable:
        if str(candidate_id) == node_id:
            target = node
            break
    if target is None:
        return {"ok": False, "marked": False, "reason": "node_missing", "graph": str(graph_path), "node_id": node_id}
    if str(target.get("status") or "").strip().lower() != "reviewing":
        return {"ok": False, "marked": False, "reason": "node_not_reviewing", "node_id": node_id}

    assignments = target.get("eval_assignments")
    if not isinstance(assignments, list):
        assignments = []
    if any(str(item.get("task_id") or "") == task_id for item in assignments if isinstance(item, dict)):
        return {"ok": True, "marked": False, "reason": "already_marked", "graph": str(graph_path), "node_id": node_id}

    now = _now()
    operator_id = str(record.get("operator_id") or "")
    assignment = {"ts": now, "task_id": task_id, "operator_id": operator_id, "status": "submitted"}
    target["eval_dispatch_id"] = task_id
    target["eval_dispatched_at"] = now
    target["eval_operator_id"] = operator_id
    assignments.append(assignment)
    target["eval_assignments"] = assignments
    target["updated_at"] = now

    graph.setdefault("node_results", {})
    graph["node_results"].setdefault(node_id, {})
    result_entry = graph["node_results"][node_id]
    result_entry["status"] = str(result_entry.get("status") or "reviewing")
    result_entry["eval_dispatch_id"] = task_id
    result_entry["eval_dispatched_at"] = now
    result_entry["eval_operator_id"] = operator_id
    result_entry["updated_at"] = now

    graph_path.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    state_sync = _sync_task_dag_state_node(
        sprint_id,
        node_id,
        "reviewing",
        dispatch_id=task_id,
        note="pm_dispatch evaluator dispatch",
    )
    return {"ok": True, "marked": True, "graph": str(graph_path), "sprint_id": sprint_id, "node_id": node_id, "state_sync": state_sync}


def _graph_eval_requeue_reason(record: dict[str, Any]) -> tuple[str, str] | None:
    reason_text = _transient_operator_failure_text(record)
    if TRANSIENT_OPERATOR_FAILURE_RE.search(reason_text):
        return "transient_operator_failure", reason_text

    status = str(record.get("status") or "").strip().lower()
    failure_reason = str(record.get("failure_reason") or "").strip().lower()
    closeout = record.get("closeout_status")
    has_closeout_artifact_gap = False
    if isinstance(closeout, dict):
        missing = closeout.get("missing_artifacts") or []
        stale = closeout.get("stale_artifacts") or []
        has_closeout_artifact_gap = bool(missing or stale)

    if status == "failed_contract_closeout" or (
        has_closeout_artifact_gap and "required_artifacts" in failure_reason
    ):
        return "failed_contract_closeout", reason_text

    return None


def _release_graph_eval_on_transient_operator_failure(record: dict[str, Any]) -> dict[str, Any]:
    if normalize_role(str(record.get("requested_role") or "")) != "evaluator":
        return {"ok": False, "released": False, "reason": "not_evaluator_task"}
    requeue = _graph_eval_requeue_reason(record)
    if requeue is None:
        return {"ok": False, "released": False, "reason": "not_requeueable_operator_failure"}
    requeue_reason, reason = requeue
    sprint_id = str(record.get("sprint_id") or "").strip()
    node_id = str(record.get("node_id") or "").strip()
    task_id = str(record.get("task_id") or "").strip()
    if not sprint_id or not node_id or not task_id:
        return {"ok": False, "released": False, "reason": "missing_graph_identity"}
    graph_path = SPRINTS_DIR / f"{sprint_id}.task_graph.json"
    if not graph_path.exists():
        return {"ok": False, "released": False, "reason": "graph_missing", "graph": str(graph_path)}
    try:
        graph = json.loads(graph_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"ok": False, "released": False, "reason": f"graph_read_failed:{type(exc).__name__}", "graph": str(graph_path)}

    nodes = graph.get("nodes") or []
    if isinstance(nodes, dict):
        iterable = nodes.items()
    else:
        iterable = [(str(node.get("id") or node.get("node_id") or ""), node) for node in nodes if isinstance(node, dict)]

    target: dict[str, Any] | None = None
    for candidate_id, node in iterable:
        if str(candidate_id) == node_id:
            target = node
            break
    if target is None:
        return {"ok": False, "released": False, "reason": "node_missing", "graph": str(graph_path), "node_id": node_id}

    assignments = target.get("eval_assignments")
    had_assignment = False
    cleared_all_assignments = False
    if isinstance(assignments, list):
        kept = []
        for item in assignments:
            if isinstance(item, dict) and (
                str(item.get("task_id") or "") == task_id
                or str(item.get("pm_task_id") or "") == task_id
            ):
                had_assignment = True
                continue
            kept.append(item)
        if kept:
            target["eval_assignments"] = kept
        else:
            target.pop("eval_assignments", None)
            cleared_all_assignments = True
    if str(target.get("eval_dispatch_id") or "") == task_id:
        had_assignment = True
        for key in ("eval_dispatch_id", "eval_dispatched_at", "eval_operator_id", "eval_assigned_to"):
            target.pop(key, None)
    elif cleared_all_assignments:
        for key in ("eval_dispatch_id", "eval_dispatched_at", "eval_operator_id", "eval_assigned_to"):
            target.pop(key, None)
    if str(target.get("eval_pm_task_id") or target.get("pm_task_id") or "") == task_id:
        had_assignment = True
        for key in ("eval_pm_task_id", "pm_task_id"):
            target.pop(key, None)
    if not had_assignment:
        return {"ok": True, "released": False, "reason": "dispatch_mismatch", "graph": str(graph_path), "node_id": node_id}

    now = _now()
    target["updated_at"] = now
    target.setdefault("eval_requeue_history", []).append(
        {
            "ts": now,
            "reason": requeue_reason,
            "task_id": task_id,
            "failure_reason": reason,
            "closeout_status": record.get("closeout_status"),
        }
    )
    result_entry = (graph.get("node_results") or {}).get(node_id)
    if isinstance(result_entry, dict):
        if str(result_entry.get("eval_dispatch_id") or "") == task_id or cleared_all_assignments:
            for key in ("eval_dispatch_id", "eval_dispatched_at", "eval_operator_id", "eval_assigned_to"):
                result_entry.pop(key, None)
        if str(result_entry.get("eval_pm_task_id") or result_entry.get("pm_task_id") or "") == task_id:
            for key in ("eval_pm_task_id", "pm_task_id"):
                result_entry.pop(key, None)
        result_entry["updated_at"] = now

    graph_path.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        "ok": True,
        "released": True,
        "graph": str(graph_path),
        "sprint_id": sprint_id,
        "node_id": node_id,
        "requeue_reason": requeue_reason,
    }


def release_evaluator_assignment_on_transient_failure(record: dict[str, Any]) -> dict[str, Any]:
    """Safe public helper: release evaluator graph assignment for transient provider failures."""
    return _release_graph_eval_on_transient_operator_failure(record)


def _parse_record_time(value: object) -> datetime.datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    return parsed.astimezone(datetime.timezone.utc)


def _handoff_is_fresh_for_record(record: dict[str, Any], handoff_path: Path) -> bool:
    submitted_at = _parse_record_time(record.get("submitted_at") or record.get("issued_at"))
    if submitted_at is None:
        return False
    try:
        handoff_mtime = datetime.datetime.fromtimestamp(handoff_path.stat().st_mtime, tz=datetime.timezone.utc)
    except OSError:
        return False
    # Filesystem mtimes can lose sub-second precision, so allow a tiny skew.
    return handoff_mtime >= submitted_at - datetime.timedelta(seconds=2)


def _is_terminal_repair_completion(
    record: dict[str, Any],
    target: dict[str, Any],
    result_entry: dict[str, Any],
    handoff_path: Path,
) -> bool:
    target_status = str(target.get("status") or "").strip().lower()
    result_status = str(result_entry.get("status") or "").strip().lower()
    previous_dispatch_ids = {
        str(target.get("dispatch_id") or ""),
        str(target.get("pm_task_id") or ""),
        str(result_entry.get("dispatch_id") or ""),
        str(result_entry.get("pm_task_id") or ""),
    }
    previous_dispatch_failed = any(
        str((read_pm_task_record(dispatch_id) or {}).get("status") or "").strip().lower().startswith("failed")
        for dispatch_id in previous_dispatch_ids
        if dispatch_id
    )
    if (
        target_status not in {"failed", "skipped"}
        and result_status not in {"failed", "skipped"}
        and not previous_dispatch_failed
    ):
        return False
    repair_text = "\n".join(
        str(record.get(key) or "")
        for key in ("objective", "pm_context", "context", "retry_of", "failure_reason", "task_type")
    ).lower()
    if not any(token in repair_text for token in ("repair", "retry", "redo", "fix", "requeue", "修复", "重试", "重跑", "重派")):
        return False
    return _handoff_is_fresh_for_record(record, handoff_path)


def _archive_stale_eval_sidecars_for_pm_repair(sprint_id: str, node_id: str, target: dict[str, Any]) -> list[dict[str, str]]:
    stamp = _now().replace(":", "").replace("-", "")
    archived: list[dict[str, str]] = []
    paths = [
        SPRINTS_DIR / f"{sprint_id}.{node_id}-eval.md",
        SPRINTS_DIR / f"{sprint_id}.{node_id}-eval.json",
        SPRINTS_DIR / f"{sprint_id}.{node_id}-eval-dispatch.md",
        SPRINTS_DIR / f"{sprint_id}.{node_id}-eval-dispatch-q1.md",
        SPRINTS_DIR / f"{sprint_id}.{node_id}-eval-dispatch-q1.md.intent.json",
        SPRINTS_DIR / f"{sprint_id}.{node_id}-eval-dispatch-q1.md.runtime-context.json",
        SPRINTS_DIR / "graph-acks" / f"{sprint_id}.{node_id}-submit-ack.json",
    ]
    paths.extend(SPRINTS_DIR.glob(f"{sprint_id}.{node_id}-eval-peer-*.json"))
    paths.extend(SPRINTS_DIR.glob(f"{sprint_id}.{node_id}-eval-dispatch-q*.md"))
    paths.extend(SPRINTS_DIR.glob(f"{sprint_id}.{node_id}-eval-dispatch-q*.md.intent.json"))
    paths.extend(SPRINTS_DIR.glob(f"{sprint_id}.{node_id}-eval-dispatch-q*.md.runtime-context.json"))
    seen: set[Path] = set()
    for path in paths:
        if path in seen:
            continue
        seen.add(path)
        if not path.exists():
            continue
        archive = path.with_name(f"{path.name}.stale-{stamp}")
        path.replace(archive)
        archived.append({"from": str(path), "to": str(archive)})
    if archived:
        target["last_eval_sidecar_archive"] = archived
        target["eval_retry_reason"] = "pm_repair_archived_stale_eval_sidecars"
    return archived


def _mark_graph_node_reviewing_on_builder_complete(record: dict[str, Any], *, apply_changes: bool = True) -> dict[str, Any]:
    if normalize_role(str(record.get("requested_role") or "")) != "builder":
        return {"ok": False, "marked": False, "reason": "not_builder_task"}
    sprint_id = str(record.get("sprint_id") or "").strip()
    node_id = str(record.get("node_id") or "").strip()
    task_id = str(record.get("task_id") or "").strip()
    if not sprint_id or not node_id or not task_id:
        return {"ok": False, "marked": False, "reason": "missing_graph_identity"}
    handoff_path = _node_handoff_path(sprint_id, node_id)
    if not handoff_path.exists() or handoff_path.stat().st_size <= 0:
        return {"ok": False, "marked": False, "reason": "missing_handoff", "handoff": str(handoff_path)}

    graph_path = SPRINTS_DIR / f"{sprint_id}.task_graph.json"
    if not graph_path.exists():
        return {"ok": False, "marked": False, "reason": "graph_missing", "graph": str(graph_path)}
    try:
        graph = json.loads(graph_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"ok": False, "marked": False, "reason": f"graph_read_failed:{type(exc).__name__}", "graph": str(graph_path)}

    nodes = graph.get("nodes") or []
    if isinstance(nodes, dict):
        iterable = nodes.items()
    else:
        iterable = [(str(node.get("id") or node.get("node_id") or ""), node) for node in nodes if isinstance(node, dict)]

    target: dict[str, Any] | None = None
    for candidate_id, node in iterable:
        if str(candidate_id) == node_id:
            target = node
            break
    if target is None:
        return {"ok": False, "marked": False, "reason": "node_missing", "graph": str(graph_path), "node_id": node_id}

    node_results = graph.get("node_results") if isinstance(graph.get("node_results"), dict) else {}
    result_entry = node_results.get(node_id) if isinstance(node_results.get(node_id), dict) else {}
    target_status = str(target.get("status") or "").strip().lower()
    result_status = str(result_entry.get("status") or "").strip().lower()
    closed_statuses = {"passed", "skipped", "cancelled", "canceled", "skipped_parent_passed"}
    if target_status in closed_statuses or result_status in closed_statuses:
        return {
            "ok": True,
            "marked": False,
            "reason": "node_already_terminal",
            "graph": str(graph_path),
            "node_id": node_id,
            "status": target_status or result_status,
        }
    if str(target.get("status") or "") == "reviewing":
        stale_keys = [key for key in ("assigned_to", "dispatch_id", "dispatched_via", "pm_task_id", "operator_id") if target.get(key) is not None]
        if not stale_keys and str(target.get("handoff_path") or "") == str(handoff_path):
            state_sync = (
                _sync_task_dag_state_node(
                    sprint_id,
                    node_id,
                    "reviewing",
                    note="pm_dispatch builder already reviewing state sync",
                    extra={"handoff_path": str(handoff_path)},
                )
                if apply_changes
                else {"ok": True, "skipped": True, "reason": "dry_run"}
            )
            return {
                "ok": True,
                "marked": False,
                "reason": "already_reviewing",
                "graph": str(graph_path),
                "node_id": node_id,
                "state_sync": state_sync,
            }
        now = _now()
        previous = {key: target.get(key) for key in stale_keys}
        target.setdefault("completion_history", []).append(
            {
                "ts": now,
                "reason": "pm_builder_reviewing_cleanup",
                "task_id": task_id,
                "previous_dispatch": previous,
                "handoff": str(handoff_path),
            }
        )
        target["updated_at"] = now
        target["handoff_path"] = str(handoff_path)
        for key in ("assigned_to", "dispatch_id", "dispatched_via", "pm_task_id", "operator_id"):
            target.pop(key, None)
        graph.setdefault("node_results", {})
        graph["node_results"].setdefault(node_id, {})
        result_entry = graph["node_results"][node_id]
        result_entry["status"] = "reviewing"
        result_entry["updated_at"] = now
        result_entry["handoff_path"] = str(handoff_path)
        result_entry.setdefault("completion_history", []).append(
            {"ts": now, "reason": "pm_builder_reviewing_cleanup", "task_id": task_id}
        )
        for key in ("assigned_to", "dispatch_id", "dispatched_via", "pm_task_id", "operator_id"):
            result_entry.pop(key, None)
        if apply_changes:
            graph_path.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return {
            "ok": True,
            "marked": True,
            "reason": "already_reviewing_cleanup",
            "graph": str(graph_path),
            "node_id": node_id,
            "stale_keys": stale_keys,
        }

    dispatch_ids = {
        str(target.get("dispatch_id") or ""),
        str(target.get("pm_task_id") or ""),
        str(result_entry.get("dispatch_id") or ""),
        str(result_entry.get("pm_task_id") or ""),
    }
    repair_completion = False
    if task_id not in dispatch_ids:
        repair_completion = _is_terminal_repair_completion(record, target, result_entry, handoff_path)
    dispatchless_completion = (
        task_id not in dispatch_ids
        and not any(dispatch_id for dispatch_id in dispatch_ids)
        and target_status not in closed_statuses
        and result_status not in closed_statuses
        and _handoff_is_fresh_for_record(record, handoff_path)
    )
    if task_id not in dispatch_ids and not repair_completion and not dispatchless_completion:
        return {"ok": False, "marked": False, "reason": "dispatch_mismatch", "node_id": node_id}

    if repair_completion and _node_has_fresh_terminal_eval_sidecar(sprint_id, node_id, handoff_path, target, result_entry):
        return {
            "ok": True,
            "marked": False,
            "reason": "node_already_has_fresh_eval_verdict",
            "graph": str(graph_path),
            "node_id": node_id,
            "status": target_status or result_status,
        }

    now = _now()
    previous = {
        key: target.get(key)
        for key in ("status", "assigned_to", "dispatch_id", "dispatched_via", "pm_task_id", "operator_id")
        if target.get(key) is not None
    }
    target.setdefault("completion_history", []).append(
        {
            "ts": now,
            "reason": "pm_builder_repair_complete" if repair_completion else ("pm_builder_dispatchless_complete" if dispatchless_completion else "pm_builder_complete"),
            "task_id": task_id,
            "previous_dispatch": previous,
            "handoff": str(handoff_path),
        }
    )
    archived_eval_sidecars = (
        _archive_stale_eval_sidecars_for_pm_repair(sprint_id, node_id, target)
        if repair_completion and apply_changes
        else []
    )
    target["status"] = "reviewing"
    target["updated_at"] = now
    target["handoff_path"] = str(handoff_path)
    for key in ("assigned_to", "dispatch_id", "dispatched_via", "pm_task_id", "operator_id"):
        target.pop(key, None)

    graph.setdefault("node_results", {})
    graph["node_results"].setdefault(node_id, {})
    result_entry = graph["node_results"][node_id]
    result_entry["status"] = "reviewing"
    result_entry["updated_at"] = now
    result_entry["handoff_path"] = str(handoff_path)
    result_entry.setdefault("completion_history", []).append(
        {
            "ts": now,
            "reason": "pm_builder_repair_complete" if repair_completion else ("pm_builder_dispatchless_complete" if dispatchless_completion else "pm_builder_complete"),
            "task_id": task_id,
        }
    )
    if archived_eval_sidecars:
        result_entry["last_eval_sidecar_archive"] = archived_eval_sidecars
        result_entry["eval_retry_reason"] = "pm_repair_archived_stale_eval_sidecars"
    for key in ("assigned_to", "dispatch_id", "dispatched_via", "pm_task_id", "operator_id"):
        result_entry.pop(key, None)

    if apply_changes:
        graph_path.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    status_path = SPRINTS_DIR / f"{sprint_id}.status.json"
    status_payload: dict[str, Any] = {}
    if status_path.exists():
        try:
            loaded = json.loads(status_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                status_payload = loaded
        except Exception:
            status_payload = {}
    status_payload.update(
        {
            "sprint_id": sprint_id,
            "status": "reviewing",
            "phase": "handoff_ready",
            "handoff_to": "evaluator",
            "handoff_node_id": node_id,
            "updated_at": now,
        }
    )
    if apply_changes:
        status_path.write_text(json.dumps(status_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    state_extra: dict[str, Any] = {
        "handoff_path": str(handoff_path),
        "completion_history": result_entry.get("completion_history", []),
    }
    if archived_eval_sidecars:
        state_extra["last_eval_sidecar_archive"] = archived_eval_sidecars
        state_extra["eval_retry_reason"] = "pm_repair_archived_stale_eval_sidecars"
    state_sync = (
        _sync_task_dag_state_node(
            sprint_id,
            node_id,
            "reviewing",
            note=(
                "pm_dispatch builder repair complete"
                if repair_completion
                else ("pm_dispatch builder dispatchless complete" if dispatchless_completion else "pm_dispatch builder complete")
            ),
            extra=state_extra,
        )
        if apply_changes
        else {"ok": True, "skipped": True, "reason": "dry_run"}
    )
    return {
        "ok": True,
        "marked": True,
        "graph": str(graph_path),
        "status_path": str(status_path),
        "sprint_id": sprint_id,
        "node_id": node_id,
        "repair_completion": repair_completion,
        "dispatchless_completion": dispatchless_completion,
        "archived_eval_sidecars": archived_eval_sidecars,
        "state_sync": state_sync,
    }


def cmd_drain_builder_ready(args: argparse.Namespace) -> int:
    max_items = max(0, int(getattr(args, "max_items", 0) or 0))
    dry_run = bool(getattr(args, "dry_run", False))
    json_mode = bool(getattr(args, "json", False))
    requested_sprint = str(getattr(args, "sprint", "") or "").strip()

    if requested_sprint:
        nodes, meta = _builder_ready_nodes_for_sprint(requested_sprint)
        items = [
            {
                "sprint_id": requested_sprint,
                "node_id": str(node.get("id") or ""),
                "task_type": _node_builder_task_type(node),
                "logical_operator": str(node.get("logical_operator") or ""),
                "graph": str(meta.get("graph") or SPRINTS_DIR / f"{requested_sprint}.task_graph.json"),
                "objective": _node_builder_objective(requested_sprint, node),
            }
            for node in nodes
        ]
        if max_items:
            items = items[:max_items]
    else:
        items = _latent_builder_ready_items(limit=max_items)

    submitted: list[dict[str, Any]] = []
    marked: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for item in items:
        if dry_run:
            skipped.append({**item, "reason": "dry_run"})
            continue
        result = _run_cmd_submit_for_builder_node(item, dry_run=False, json_mode=json_mode)
        submitted.append(result)
        if result.get("ok"):
            mark = _mark_graph_node_pm_dispatched(item, result)
            marked.append(mark)
        else:
            skipped.append({**item, "reason": "submit_failed", "returncode": result.get("returncode")})

    payload = {
        "ok": all(item.get("ok") for item in submitted) and all(item.get("ok") for item in marked),
        "dry_run": dry_run,
        "max_items": max_items,
        "sprint": requested_sprint or "",
        "latent_builder_ready": len(items),
        "submitted": submitted,
        "marked": marked,
        "skipped": skipped,
    }
    if submitted:
        _invalidate_builder_pool_backlog_cache()
    if json_mode:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(
            "drain_builder_ready "
            f"dry_run={dry_run} latent={len(items)} submitted={len(submitted)} "
            f"marked={sum(1 for item in marked if item.get('ok'))} skipped={len(skipped)}"
        )
        for item in (submitted or skipped)[:20]:
            print(
                f"  - {item.get('sprint_id')} {item.get('node_id')} "
                f"task={item.get('task_id') or 'N/A'} op={item.get('operator_id') or 'N/A'} "
                f"ok={item.get('ok', False)}"
            )
    return 0 if payload["ok"] else 1


def cmd_drain_planner_ready(args: argparse.Namespace) -> int:
    max_items = max(0, int(getattr(args, "max_items", 0) or 0))
    dry_run = bool(getattr(args, "dry_run", False))
    json_mode = bool(getattr(args, "json", False))
    requested_sprint = str(getattr(args, "sprint", "") or "").strip()

    if requested_sprint:
        all_items = _planner_ready_items(limit=0)
        items = [item for item in all_items if str(item.get("sprint_id") or "") == requested_sprint]
        if max_items:
            items = items[:max_items]
    else:
        items = _planner_ready_items(limit=max_items)

    submitted: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for item in items:
        if dry_run:
            skipped.append({**item, "reason": "dry_run"})
            continue
        result = _run_cmd_submit_for_planner_item(item, dry_run=False, json_mode=json_mode)
        submitted.append(result)
        if not result.get("ok"):
            skipped.append({**item, "reason": "submit_failed", "returncode": result.get("returncode")})

    payload = {
        "ok": all(item.get("ok") for item in submitted),
        "dry_run": dry_run,
        "max_items": max_items,
        "sprint": requested_sprint or "",
        "planner_prd_ready": len(items),
        "submitted": submitted,
        "skipped": skipped,
    }
    if submitted:
        _invalidate_builder_pool_backlog_cache()
    if json_mode:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(
            "drain_planner_ready "
            f"dry_run={dry_run} planner_ready={len(items)} submitted={len(submitted)} skipped={len(skipped)}"
        )
        for item in (submitted or skipped)[:20]:
            print(
                f"  - {item.get('sprint_id')} {item.get('node_id')} "
                f"task={item.get('task_id') or 'N/A'} op={item.get('operator_id') or 'N/A'} "
                f"ok={item.get('ok', False)}"
            )
    return 0 if payload["ok"] else 1


def cmd_concurrency_status(args: argparse.Namespace) -> int:
    policy_mod = _load_concurrency_policy_module()
    if policy_mod is None:
        print("ERROR: concurrency_policy unavailable", file=sys.stderr)
        return 1
    policy = policy_mod.load_policy()
    level = policy_mod.active_level(policy)
    payload = {
        "ok": True,
        "active_level": level,
        "policy_path": policy.get("_policy_path", "N/A"),
        "settings": policy_mod.level_settings(policy, level),
        "levels": sorted((policy.get("levels") or {}).keys()),
    }
    autoscale = policy_mod.backlog_autoscaling_snapshot(policy)
    if autoscale:
        payload["backlog_autoscaling"] = autoscale
    if getattr(args, "json", False):
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(f"concurrency_level={level} policy={payload['policy_path']}")
        for name in payload["levels"]:
            settings = policy_mod.level_settings(policy, name)
            marker = "*" if name == level else " "
            print(
                f"{marker} {name:<7} graph={settings.get('graph_max_parallel', 'N/A')} "
                f"builder={settings.get('builder_dispatch_limit', 'N/A')} "
                f"drain={settings.get('drain_max_items', 'N/A')}"
            )
        if autoscale:
            metrics = autoscale.get("metrics") if isinstance(autoscale.get("metrics"), dict) else {}
            profile_limits = autoscale.get("profile_limits") if isinstance(autoscale.get("profile_limits"), dict) else {}
            logical_limits = autoscale.get("logical_operator_limits") if isinstance(autoscale.get("logical_operator_limits"), dict) else {}
            builder_pool = autoscale.get("builder_pool") if isinstance(autoscale.get("builder_pool"), dict) else {}
            global_limits = autoscale.get("global_limits") if isinstance(autoscale.get("global_limits"), dict) else {}
            print(
                "backlog_autoscale "
                f"drafting/spec={metrics.get('drafting_spec', 'N/A')} "
                f"prd_ready={metrics.get('active_prd_ready', 'N/A')} "
                f"planning_complete={metrics.get('active_planning_complete', 'N/A')} "
                f"handoff_ready={metrics.get('reviewing_handoff_ready', 'N/A')}"
            )
            print(
                "profile_limits "
                f"pm={profile_limits.get('pm', 'N/A')} "
                f"planner={profile_limits.get('planner', 'N/A')} "
                f"builder={profile_limits.get('builder', 'N/A')} "
                f"evaluator={profile_limits.get('evaluator', 'N/A')} "
                f"max_workers={global_limits.get('max_workers', 'N/A')}"
            )
            print(
                "logical_limits "
                f"DeepArchitect={logical_limits.get('DeepArchitect', 'N/A')} "
                f"ParallelExplorer={logical_limits.get('ParallelExplorer', 'N/A')} "
                f"ImplementationWorker={logical_limits.get('ImplementationWorker', 'N/A')} "
                f"Verifier={logical_limits.get('Verifier', 'N/A')}"
            )
            print(
                "builder_pool_targets "
                f"desired_total={builder_pool.get('desired_total', 'N/A')} "
                f"spark={((builder_pool.get('groups') or {}).get('codex-gpt-5.3-spark', 'N/A'))} "
                f"gpt55={((builder_pool.get('groups') or {}).get('codex-gpt-5.5-medium', 'N/A'))} "
                f"sonnet={((builder_pool.get('groups') or {}).get('sonnet', 'N/A'))}"
            )
    return 0


def cmd_concurrency_set(args: argparse.Namespace) -> int:
    level = str(args.level or "").strip().lower()
    if level not in {"low", "normal", "high", "burst"}:
        print("ERROR: --level must be one of low|normal|high|burst", file=sys.stderr)
        return 1
    policy_mod = _load_concurrency_policy_module()
    if policy_mod is None:
        print("ERROR: concurrency_policy unavailable", file=sys.stderr)
        return 1
    policy = policy_mod.load_policy()
    policy_path = Path(str(policy.get("_policy_path") or ""))
    if not policy_path.exists() or str(policy_path) == "builtin":
        policy_path = HARNESS_DIR / "config" / "concurrency-policy.json"
    policy.pop("_policy_path", None)
    policy["active_level"] = level
    policy_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = str(policy_path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(policy, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, str(policy_path))
    print(f"✅ concurrency_level set to {level}")
    print(f"   policy = {policy_path}")
    return 0


def cmd_quota_refresh(args: argparse.Namespace) -> int:
    tool = HARNESS_DIR / "tools" / "quota_refresh.py"
    if not tool.exists():
        print(f"ERROR: quota_refresh.py not found: {tool}", file=sys.stderr)
        return 1
    cmd = [sys.executable, str(tool)]
    if getattr(args, "json", False):
        cmd.append("--json")
    if getattr(args, "apply", False):
        cmd.append("--apply")
    proc = subprocess.run(cmd, cwd=str(HARNESS_DIR), text=True, capture_output=True, timeout=60, check=False)
    if proc.stdout:
        print(proc.stdout, end="")
    if proc.stderr:
        print(proc.stderr, end="", file=sys.stderr)
    return proc.returncode


def cmd_prune_rate_limits(args: argparse.Namespace) -> int:
    result = _prune_expired_operator_blocks()
    if getattr(args, "json", False):
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0 if result.get("ok") else 1
    pruned = result.get("pruned") if isinstance(result.get("pruned"), list) else []
    kept = result.get("kept") if isinstance(result.get("kept"), list) else []
    print(f"rate_limit_prune ok={result.get('ok', False)} pruned={len(pruned)} kept={len(kept)}")
    if pruned:
        for item in pruned:
            print(f"  cleared {item.get('operator_id')} state={item.get('runtime_state')} expired_at={item.get('expired_at')}")
    return 0 if result.get("ok") else 1


def cmd_inbox(args: argparse.Namespace) -> int:
    limit = int(getattr(args, "limit", 20))
    tasks = list_pm_tasks(
        limit=limit,
        include_probe_records=bool(getattr(args, "include_probes", False)),
        include_superseded=bool(getattr(args, "show_superseded", False)),
    )
    if not tasks:
        print("PM inbox 为空（暂无任务记录）")
        return 0
    print(f"{'Task ID':<36} {'算子':<35} {'状态':<20} {'提交时间'}")
    print("-" * 110)
    for t in tasks:
        tid = str(t.get("task_id", "?"))[:35]
        op = str(t.get("operator_id", "?"))[:34]
        st = str(t.get("status", "?"))[:19]
        ts = str(t.get("submitted_at", "?"))[:19]
        print(f"{tid:<36} {op:<35} {st:<20} {ts}")
    return 0


def cmd_result(args: argparse.Namespace) -> int:
    task_id = str(args.task_id or "").strip()
    if not task_id:
        print("ERROR: --task-id required", file=sys.stderr)
        return 1
    record = read_pm_task_record(task_id)
    if not record:
        print(f"ERROR: task {task_id} not found in PM inbox", file=sys.stderr)
        return 1
    print(json.dumps(record, indent=2, ensure_ascii=False))

    # Surface any active cooldown for the operator that ran this task
    operator_id = str(record.get("operator_id") or "")
    if operator_id:
        rt_state = get_operator_runtime_state(operator_id)
        if rt_state in ("cooldown", "quota_exhausted", "auth_expired"):
            status = get_operator_status_data(operator_id)
            expires_at = str(status.get("expires_at") or "")
            eta = _format_reset_eta(expires_at)
            print(f"\n⚠️  算子冷却中: operator={operator_id} state={rt_state}", end="")
            if eta:
                print(f", resets {eta}", end="")
            if expires_at:
                print(f" (until {expires_at})", end="")
            print()

    result_path = Path(record.get("result_path", ""))
    if result_path.exists():
        print("\n--- 结果文件内容 ---")
        print(result_path.read_text(encoding="utf-8", errors="replace"))
    else:
        print(f"\n结果文件尚未生成：{result_path}")
    return 0


def cmd_complete(args: argparse.Namespace) -> int:
    """算子调用：标记任务完成（写入 PM inbox）"""
    task_id = str(args.task_id or "").strip()
    if not task_id:
        print("ERROR: --task-id required", file=sys.stderr)
        return 1
    record = read_pm_task_record(task_id) or {}
    record["task_id"] = task_id
    closeout = _pm_closeout_status(record)
    if not closeout.get("ok"):
        record["status"] = "failed_contract_closeout"
        record["failed_at"] = _now()
        record["failure_reason"] = "completed_without_required_artifacts"
        record["closeout_status"] = closeout
        record.setdefault("reconcile_history", []).append(
            {"ts": record["failed_at"], "action": "fail_contract_closeout", "reason": record["failure_reason"], **closeout}
        )
        graph_eval_requeue = _release_graph_eval_on_transient_operator_failure(record)
        if graph_eval_requeue.get("released"):
            record["graph_eval_requeue"] = graph_eval_requeue
            record.setdefault("reconcile_history", []).append(
                {"ts": record["failed_at"], "action": "graph_eval_requeue", **graph_eval_requeue}
            )
        _record_pm_dispatch_evidence(
            record,
            event="handoff_closeout_failed",
            status="failed_contract_closeout",
            reason=record["failure_reason"],
        )
        write_pm_task_record(task_id, record)
        print(json.dumps({"ok": False, "task_id": task_id, "reason": record["failure_reason"], **closeout}, ensure_ascii=False))
        return 2
    completion = _run_pm_completion_gate(task_id, record)
    now = _now()
    if completion.get("status") != "completed":
        record["status"] = "blocked_by_verifier"
        record["blocked_at"] = now
        record["failure_reason"] = "post_result_verifier_failed"
        record["completion_gate"] = completion
        record["closeout_status"] = closeout
        record.setdefault("reconcile_history", []).append(
            {"ts": now, "action": "blocked_by_verifier", "reason": record["failure_reason"]}
        )
        write_pm_task_record(task_id, record)
        print(json.dumps({"ok": False, "task_id": task_id, "reason": record["failure_reason"], "completion_gate": completion}, ensure_ascii=False))
        return 3
    record["status"] = "completed"
    record["completed_at"] = now
    record["closeout_status"] = closeout
    record["completion_gate"] = completion
    graph_reviewing = _mark_graph_node_reviewing_on_builder_complete(record)
    if graph_reviewing.get("marked"):
        record["graph_reviewing"] = graph_reviewing
        record.setdefault("reconcile_history", []).append(
            {"ts": record["completed_at"], "action": "graph_reviewing", **graph_reviewing}
        )
    _record_pm_dispatch_evidence(record, event="dispatch_completed", status="completed")
    write_pm_task_record(task_id, record)
    print(f"✅ 任务 {task_id} 已标记为 completed")
    return 0


def _run_pm_completion_gate(task_id: str, record: dict[str, Any]) -> dict[str, Any]:
    lib_dir = HARNESS_DIR / "lib"
    if str(lib_dir) not in sys.path:
        sys.path.insert(0, str(lib_dir))
    from completion_pipeline import OperatorResult, submit_result  # type: ignore

    sprint_id = str(record.get("sprint_id") or task_id)
    node_id = str(record.get("node_id") or "pm")
    handoff_path = _pm_completion_handoff_path(record, sprint_id, node_id)
    eval_path = _pm_completion_eval_path(record, sprint_id, node_id)
    return submit_result(
        OperatorResult(
            session_id=sprint_id,
            node_id=node_id,
            attempt_id=str(record.get("dispatch_id") or record.get("task_id") or task_id),
            handoff_path=handoff_path,
            eval_path=eval_path,
            write_scope=list(record.get("write_scope") or []),
            operator_status=str(record.get("status") or "done"),
            run_dir=str(HARNESS_DIR / "run" / "pm-completion-gate" / task_id),
        ),
        harness_dir=HARNESS_DIR,
    )


def _pm_completion_handoff_path(record: dict[str, Any], sprint_id: str, node_id: str) -> str:
    for key in ("handoff_path", "handoff", "handoff_md"):
        raw = str(record.get(key) or "").strip()
        if not raw:
            continue
        candidate = Path(raw).expanduser()
        if not candidate.is_absolute():
            candidate = SPRINTS_DIR / raw
        if candidate.exists() and candidate.is_file():
            return str(candidate)

    if sprint_id and node_id and node_id != "pm":
        candidate = _node_handoff_path(sprint_id, node_id)
        if candidate.exists() and candidate.is_file():
            return str(candidate)

    result_path = Path(str(record.get("result_path") or "")).expanduser()
    if normalize_role(str(record.get("requested_role") or record.get("role") or "")) == "planner":
        if result_path.exists() and result_path.is_file():
            return str(result_path)
    if result_path.exists() and result_path.is_file() and "handoff" in result_path.name:
        return str(result_path)
    return ""


def _pm_completion_eval_path(record: dict[str, Any], sprint_id: str, node_id: str) -> str:
    for key in ("eval_path", "eval", "eval_json", "eval_md"):
        raw = str(record.get(key) or "").strip()
        if not raw:
            continue
        candidate = Path(raw).expanduser()
        if not candidate.is_absolute():
            candidate = SPRINTS_DIR / raw
        if candidate.exists() and candidate.is_file():
            return str(candidate)

    if sprint_id and node_id and node_id != "pm":
        for candidate in (
            SPRINTS_DIR / f"{sprint_id}.{node_id}-eval.json",
            SPRINTS_DIR / f"{sprint_id}.{node_id}-eval.md",
        ):
            if candidate.exists() and candidate.is_file():
                return str(candidate)
    return ""


def cmd_fail(args: argparse.Namespace) -> int:
    """算子调用：标记任务失败（写入 PM inbox），避免 failed worker 继续显示 submitted。"""
    task_id = str(args.task_id or "").strip()
    if not task_id:
        print("ERROR: --task-id required", file=sys.stderr)
        return 1
    status = str(args.status or "failed").strip() or "failed"
    if not status.startswith("failed"):
        status = f"failed_{status}"
    record = read_pm_task_record(task_id) or {}
    record["task_id"] = task_id
    record["status"] = status
    record["failed_at"] = _now()
    record["failure_reason"] = str(args.reason or status).strip()[:2000]
    flow_control = _apply_transient_operator_flow_control(record)
    if flow_control.get("applied"):
        record["operator_flow_control"] = flow_control
        record.setdefault("reconcile_history", []).append(
            {"ts": record["failed_at"], "action": "operator_flow_control", **flow_control}
        )
    graph_requeue = _release_graph_node_on_transient_operator_failure(record)
    if graph_requeue.get("released"):
        record["graph_requeue"] = graph_requeue
        record.setdefault("reconcile_history", []).append(
            {"ts": record["failed_at"], "action": "graph_requeue", **graph_requeue}
        )
    graph_eval_requeue = _release_graph_eval_on_transient_operator_failure(record)
    if graph_eval_requeue.get("released"):
        record["graph_eval_requeue"] = graph_eval_requeue
        record.setdefault("reconcile_history", []).append(
            {"ts": record["failed_at"], "action": "graph_eval_requeue", **graph_eval_requeue}
        )
    write_pm_task_record(task_id, record)
    print(f"❌ 任务 {task_id} 已标记为 {status}")
    return 0


def _clear_pm_failure_projection(record: dict[str, Any]) -> None:
    for key in ("failed_at", "failure_reason", "blocked_at"):
        record.pop(key, None)


def cmd_reconcile(args: argparse.Namespace) -> int:
    """Repair PM inbox projection drift without bypassing operator evidence."""
    max_age_minutes = max(1, int(args.max_age_minutes or 60))
    apply_changes = bool(args.apply)
    max_writes = max(0, int(getattr(args, "max_writes", 0) or 0))
    max_scan_records = max(0, int(getattr(args, "max_scan_records", 0) or 0))
    bounded_reconcile = bool(max_writes or max_scan_records)
    writes_applied = 0
    writes_skipped = 0
    scanned_records = 0
    scan_limited = False
    active_task_ids = _active_pm_task_ids()
    actions: list[dict[str, Any]] = []
    now = _now()

    def write_reconcile_task_record(task_id: str, record: dict[str, Any]) -> bool:
        nonlocal writes_applied, writes_skipped
        if max_writes and writes_applied >= max_writes:
            writes_skipped += 1
            return False
        write_pm_task_record(task_id, record)
        writes_applied += 1
        return True

    for path in _pm_record_files(include_probe_records=False):
        if max_scan_records and scanned_records >= max_scan_records:
            scan_limited = True
            break
        if max_writes and apply_changes and writes_applied >= max_writes:
            scan_limited = True
            break
        scanned_records += 1
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            actions.append({"task_id": path.stem, "action": "skip_corrupt", "reason": type(exc).__name__})
            continue

        task_id = str(record.get("task_id") or path.stem)
        status = str(record.get("status") or "").strip()
        if status == "failed_contract_closeout":
            closeout = _pm_closeout_status(record)
            if closeout.get("ok"):
                actions.append({
                    "task_id": task_id,
                    "action": "complete",
                    "reason": "failed_contract_closeout_recovered",
                    **closeout,
                })
                if apply_changes:
                    record["task_id"] = task_id
                    record["status"] = "completed"
                    record["completed_at"] = now
                    _clear_pm_failure_projection(record)
                    record["closeout_status"] = closeout
                    record.setdefault("reconcile_history", []).append(
                        {"ts": now, "action": "complete", "reason": "failed_contract_closeout_recovered", **closeout}
                    )
                    write_reconcile_task_record(task_id, record)
                continue
        if status == "completed":
            closeout = _pm_closeout_status(record)
            if closeout.get("ok"):
                dirty_failure_projection = any(key in record for key in ("failed_at", "failure_reason", "blocked_at"))
                graph_reviewing = _mark_graph_node_reviewing_on_builder_complete(record, apply_changes=apply_changes)
                if dirty_failure_projection or graph_reviewing.get("marked"):
                    actions.append({
                        "task_id": task_id,
                        "action": "repair_completed_projection",
                        "reason": "completed_record_projection_drift",
                        "clean_failure_projection": dirty_failure_projection,
                        "graph_reviewing": graph_reviewing,
                    })
                    if apply_changes:
                        record["task_id"] = task_id
                        if dirty_failure_projection:
                            _clear_pm_failure_projection(record)
                        if graph_reviewing.get("marked"):
                            record["graph_reviewing"] = graph_reviewing
                        record.setdefault("reconcile_history", []).append(
                            {
                                "ts": now,
                                "action": "repair_completed_projection",
                                "reason": "completed_record_projection_drift",
                                "clean_failure_projection": dirty_failure_projection,
                                "graph_reviewing": graph_reviewing,
                            }
                        )
                        write_reconcile_task_record(task_id, record)
                continue
            actions.append({
                "task_id": task_id,
                "action": "fail_contract_closeout",
                "reason": "completed_without_required_artifacts",
                **closeout,
            })
            if apply_changes:
                record["task_id"] = task_id
                record["status"] = "failed_contract_closeout"
                record["failed_at"] = now
                record["failure_reason"] = "completed_without_required_artifacts"
                record["closeout_status"] = closeout
                record.setdefault("reconcile_history", []).append(
                    {"ts": now, "action": "fail_contract_closeout", "reason": "completed_without_required_artifacts", **closeout}
                )
                graph_eval_requeue = (
                    {"released": False, "reason": "bounded_reconcile_skip_graph_eval_requeue"}
                    if bounded_reconcile
                    else _release_graph_eval_on_transient_operator_failure(record)
                )
                if graph_eval_requeue.get("released"):
                    record["graph_eval_requeue"] = graph_eval_requeue
                    record.setdefault("reconcile_history", []).append(
                        {"ts": now, "action": "graph_eval_requeue", **graph_eval_requeue}
                    )
                write_reconcile_task_record(task_id, record)
            continue
        synthetic_cancel = _synthetic_builder_handoff_cancel(record)
        if synthetic_cancel.get("ok"):
            actions.append({"task_id": task_id, "action": "cancel", **synthetic_cancel})
            if apply_changes:
                record["task_id"] = task_id
                record["status"] = "cancelled"
                record["cancelled_at"] = now
                record["cancel_reason"] = "builder_handoff_managed_by_task_graph"
                _clear_pm_failure_projection(record)
                record.setdefault("reconcile_history", []).append(
                    {"ts": now, "action": "cancel", **synthetic_cancel}
                )
                write_reconcile_task_record(task_id, record)
            continue

        terminal_status = _pm_status_is_terminal(status)
        terminal_recoverable = status.startswith("failed") or status in {"blocked_by_verifier"}
        if terminal_status and not terminal_recoverable:
            continue

        graph_closeout = _pm_graph_node_closed_closeout(record)
        if graph_closeout.get("ok"):
            actions.append({"task_id": task_id, "action": "complete", "reason": "graph_node_already_closed", **graph_closeout})
            if apply_changes:
                record["task_id"] = task_id
                record["status"] = "completed"
                record["completed_at"] = now
                _clear_pm_failure_projection(record)
                record["closeout_status"] = graph_closeout
                record.setdefault("reconcile_history", []).append(
                    {"ts": now, "action": "complete", "reason": "graph_node_already_closed", **graph_closeout}
                )
                write_reconcile_task_record(task_id, record)
            continue

        terminal_result_path_raw = str(record.get("result_path") or "").strip()
        terminal_result_path = Path(terminal_result_path_raw).expanduser() if terminal_result_path_raw else Path()
        terminal_result_exists = bool(terminal_result_path_raw) and terminal_result_path.exists()
        if terminal_status and not terminal_result_exists:
            continue

        closeout = _pm_closeout_status(record)
        if task_id not in active_task_ids and closeout.get("ok") and closeout.get("expected_artifacts"):
            actions.append({"task_id": task_id, "action": "complete", "reason": "expected_artifacts_exist", **closeout})
            if apply_changes:
                record["task_id"] = task_id
                record["status"] = "completed"
                record["completed_at"] = now
                _clear_pm_failure_projection(record)
                record["closeout_status"] = closeout
                record.setdefault("reconcile_history", []).append(
                    {"ts": now, "action": "complete", "reason": "expected_artifacts_exist", **closeout}
                )
                write_reconcile_task_record(task_id, record)
            continue

        result_path_raw = str(record.get("result_path") or "").strip()
        result_path = Path(result_path_raw).expanduser() if result_path_raw else Path()
        result_exists = bool(result_path_raw) and result_path.exists()
        if result_exists:
            closeout = _pm_closeout_status(record)
            if not closeout.get("ok"):
                actions.append({
                    "task_id": task_id,
                    "action": "fail_contract_closeout",
                    "reason": "result_path_exists_but_required_artifacts_missing",
                    **closeout,
                })
                if apply_changes:
                    record["task_id"] = task_id
                    record["status"] = "failed_contract_closeout"
                    record["failed_at"] = now
                    record["failure_reason"] = "result_path_exists_but_required_artifacts_missing"
                    record["closeout_status"] = closeout
                    record.setdefault("reconcile_history", []).append(
                        {"ts": now, "action": "fail_contract_closeout", "reason": "result_path_exists_but_required_artifacts_missing", **closeout}
                    )
                    graph_eval_requeue = (
                        {"released": False, "reason": "bounded_reconcile_skip_graph_eval_requeue"}
                        if bounded_reconcile
                        else _release_graph_eval_on_transient_operator_failure(record)
                    )
                    if graph_eval_requeue.get("released"):
                        record["graph_eval_requeue"] = graph_eval_requeue
                        record.setdefault("reconcile_history", []).append(
                            {"ts": now, "action": "graph_eval_requeue", **graph_eval_requeue}
                        )
                    write_reconcile_task_record(task_id, record)
                continue
            actions.append({"task_id": task_id, "action": "complete", "reason": "result_path_exists", **closeout})
            if apply_changes:
                record["task_id"] = task_id
                completion = _run_pm_completion_gate(task_id, record)
                if completion.get("status") == "completed":
                    record["status"] = "completed"
                    record["completed_at"] = now
                    _clear_pm_failure_projection(record)
                    action = "complete"
                    reason = "result_path_exists"
                else:
                    record["status"] = "blocked_by_verifier"
                    record["blocked_at"] = now
                    record["failure_reason"] = "post_result_verifier_failed"
                    action = "blocked_by_verifier"
                    reason = "post_result_verifier_failed"
                record["completion_gate"] = completion
                record["closeout_status"] = closeout
                record.setdefault("reconcile_history", []).append(
                    {"ts": now, "action": action, "reason": reason, **closeout}
                )
                write_reconcile_task_record(task_id, record)
            continue

        if terminal_status:
            continue

        age = _record_age_minutes(record, path)
        if task_id in active_task_ids:
            actions.append({"task_id": task_id, "action": "keep_active", "age_min": round(age, 1)})
            continue
        if age >= max_age_minutes:
            actions.append(
                {
                    "task_id": task_id,
                    "action": "fail_missing_pm_result",
                    "age_min": round(age, 1),
                    "reason": "stale_without_live_lease",
                }
            )
            if apply_changes:
                record["task_id"] = task_id
                record["status"] = "failed_missing_pm_result"
                record["failed_at"] = now
                record["failure_reason"] = "stale_without_live_lease"
                record.setdefault("reconcile_history", []).append(
                    {"ts": now, "action": "fail_missing_pm_result", "age_min": round(age, 1)}
                )
                write_reconcile_task_record(task_id, record)

    summary: dict[str, int] = {}
    for item in actions:
        action = str(item.get("action") or "unknown")
        summary[action] = summary.get(action, 0) + 1
    action_limit = max(0, int(getattr(args, "limit", 40) or 40))
    visible_actions = actions[:action_limit]
    payload = {
        "ok": True,
        "applied": apply_changes,
        "max_age_minutes": max_age_minutes,
        "max_writes": max_writes,
        "max_scan_records": max_scan_records,
        "scanned_records": scanned_records,
        "scan_limited": scan_limited,
        "writes_applied": writes_applied,
        "writes_skipped": writes_skipped,
        "summary": summary,
        "actions_total": len(actions),
        "actions_truncated": len(actions) > len(visible_actions),
        "actions": visible_actions,
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    print(f"pm_reconcile applied={apply_changes} max_age_minutes={max_age_minutes}")
    if max_writes:
        print(f"  writes_applied: {writes_applied}")
        print(f"  writes_skipped: {writes_skipped}")
    if max_scan_records:
        print(f"  scanned_records: {scanned_records}")
        print(f"  scan_limited: {scan_limited}")
    for key in sorted(summary):
        print(f"  {key}: {summary[key]}")
    if len(actions) > len(visible_actions):
        print(f"  ... truncated actions: showing {len(visible_actions)} of {len(actions)}")
    for item in visible_actions:
        print(f"  - {item.get('action')}: {item.get('task_id')} ({item.get('reason', 'N/A')})")
    return 0


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> int:
    p = argparse.ArgumentParser(
        prog="pm_dispatch",
        description="PM 入口：默认只捕获 RawIntent；直接派发需显式 SOLAR_PM_DISPATCH_ALLOW_DIRECT=1",
    )
    sub = p.add_subparsers(dest="cmd")

    # submit
    s = sub.add_parser("submit", help="捕获 PM 原始需求为 RawIntent（默认不直接派发）")
    s.add_argument("--role", default="builder", help="目标角色 (builder/planner/evaluator/knowledge)")
    s.add_argument("--objective", required=True, help="任务描述（自然语言）")
    s.add_argument("--operator", default="", help="指定物理算子 ID（可选）")
    s.add_argument("--sprint", default="", help="关联 sprint ID（可选，默认 pm-adhoc-xxx）")
    s.add_argument("--node", default="N1", help="关联 DAG 节点 ID（默认 N1）")
    s.add_argument("--task-type", default="", help="任务类型提示（用于算子评分）")
    s.add_argument("--context", default="", help="额外上下文（注入 dispatch 文件）")
    s.add_argument("--dry-run", action="store_true", help="预览，不实际提交")

    cr = sub.add_parser("compile-request", help="捕获编译请求为 RawIntent（默认不直接创建 sprint/package）")
    cr.add_argument("--text", default="", help="原始需求文本")
    cr.add_argument("--input-file", default="", help="从文件读取原始需求")
    cr.add_argument("--paper", action="append", default=[], help="论文标题、链接或标识")
    cr.add_argument("--log", action="append", default=[], help="相关日志路径")
    cr.add_argument("--repo-context", action="append", default=[], help="repo/模块上下文")
    cr.add_argument("--sprint", default="", help="目标 sprint id；默认自动生成")
    cr.add_argument("--workspace-root", default="", help="写入 .pm/ 的工作区根目录；默认当前目录")
    cr.add_argument("--target-system", default="solar-harness", choices=["solar-harness", "codex"], help="下游目标系统")
    cr.add_argument("--dispatch-planner", action="store_true", help="编译后自动 handoff 给 planner")
    cr.add_argument("--dry-run", action="store_true", help="和 --dispatch-planner 配合时预览 planner 派单")

    # fleet-status
    sub.add_parser("fleet-status", help="查看所有物理算子的状态")

    # builder-pool-status
    bps = sub.add_parser("builder-pool-status", help="查看 builder pool 与并发旋钮状态")
    bps.add_argument("--json", action="store_true", help="输出 JSON")
    bps.add_argument("--recover", action="store_true", help="尝试启动声明了 auto_start 的健康失败本地 builder 服务")

    drain = sub.add_parser("drain-builder-ready", help="把 planning_complete latent ready 节点提交到 PM builder pool")
    drain.add_argument("--sprint", default="", help="只 drain 指定 sprint")
    drain.add_argument("--max-items", type=int, default=0, help="最多提交的节点数；0 表示不限制")
    drain.add_argument("--dry-run", action="store_true", help="只列出将提交的 builder-ready 节点")
    drain.add_argument("--json", action="store_true", help="输出 JSON")

    drain_planner = sub.add_parser("drain-planner-ready", help="把 prd_ready planner handoff 提交到 PM planner pool")
    drain_planner.add_argument("--sprint", default="", help="只 drain 指定 sprint")
    drain_planner.add_argument("--max-items", type=int, default=0, help="最多提交的 sprint；0 表示不限制")
    drain_planner.add_argument("--dry-run", action="store_true", help="只列出将提交的 planner-ready sprint")
    drain_planner.add_argument("--json", action="store_true", help="输出 JSON")

    cs = sub.add_parser("concurrency-status", help="查看统一并发旋钮状态")
    cs.add_argument("--json", action="store_true", help="输出 JSON")

    cset = sub.add_parser("concurrency-set", help="持久设置统一并发旋钮")
    cset.add_argument("--level", required=True, choices=["low", "normal", "high", "burst"], help="并发等级")

    prune = sub.add_parser("prune-rate-limits", help="清除已到期的物理算子 rate-limit/auth 熔断")
    prune.add_argument("--json", action="store_true", help="输出 JSON")

    qr = sub.add_parser("quota-refresh", help="刷新 provider quota/rate snapshot 并生成动态并发建议")
    qr.add_argument("--json", action="store_true", help="输出 JSON")
    qr.add_argument("--apply", action="store_true", help="写入 latest snapshot；动态策略自动读取")

    # inbox
    ib = sub.add_parser("inbox", help="查看 PM 任务收件箱")
    ib.add_argument("--limit", type=int, default=20, help="显示最近 N 条")
    ib.add_argument("--include-probes", action="store_true", help="包含 capacity-probe 诊断记录")
    ib.add_argument("--show-superseded", action="store_true", help="包含已被更新记录覆盖的旧失败")

    # result
    r = sub.add_parser("result", help="查看任务结果")
    r.add_argument("--task-id", required=True, help="Task ID")

    # complete
    c = sub.add_parser("complete", help="标记任务完成（由算子调用）")
    c.add_argument("--task-id", required=True, help="Task ID")

    f = sub.add_parser("fail", help="标记任务失败（由算子调用）")
    f.add_argument("--task-id", required=True, help="Task ID")
    f.add_argument("--status", default="failed", help="失败状态，必须以 failed 开头；否则自动加 failed_ 前缀")
    f.add_argument("--reason", default="", help="失败原因摘要")

    rec = sub.add_parser("reconcile", help="修复 PM inbox 投影漂移：完成已有结果，失败无 live lease 的 stale 任务")
    rec.add_argument("--max-age-minutes", type=int, default=60, help="无结果且无 live lease 的 stale 判定分钟数")
    rec.add_argument("--apply", action="store_true", help="实际写入；默认只预览")
    rec.add_argument("--json", action="store_true", help="输出 JSON")
    rec.add_argument("--limit", type=int, default=40, help="非 JSON 输出显示前 N 条动作")
    rec.add_argument("--max-writes", type=int, default=0, help="本轮最多写回 N 条；0 表示不限")
    rec.add_argument("--max-scan-records", type=int, default=0, help="本轮最多扫描 N 条 PM 记录；0 表示不限")

    args = p.parse_args()
    dispatch = {
        "submit": cmd_submit,
        "compile-request": cmd_compile_request,
        "fleet-status": cmd_fleet_status,
        "builder-pool-status": cmd_builder_pool_status,
        "drain-builder-ready": cmd_drain_builder_ready,
        "drain-planner-ready": cmd_drain_planner_ready,
        "concurrency-status": cmd_concurrency_status,
        "concurrency-set": cmd_concurrency_set,
        "quota-refresh": cmd_quota_refresh,
        "prune-rate-limits": cmd_prune_rate_limits,
        "inbox": cmd_inbox,
        "result": cmd_result,
        "complete": cmd_complete,
        "fail": cmd_fail,
        "reconcile": cmd_reconcile,
    }
    fn = dispatch.get(args.cmd or "")
    if fn is None:
        p.print_help()
        return 0
    return fn(args)


def _load_dispatch_package_module() -> Any | None:
    try:
        lib_dir = HARNESS_DIR / "lib"
        if str(lib_dir) not in sys.path:
            sys.path.insert(0, str(lib_dir))
        import dispatch_package
        return dispatch_package
    except Exception:
        return None


def _write_dispatch_json(
    *,
    dispatch_json_path: Path | str,
    dispatch_md_path: Path | str,
    dispatch_text: str,
    dispatch_id: str,
    sprint_id: str,
    node_id: str,
    issued_by: str,
    payload: dict[str, Any],
) -> None:
    dp = _load_dispatch_package_module()
    if dp is None:
        return
    pkg = dp.build_dispatch_package(
        dispatch_id=dispatch_id,
        sprint_id=sprint_id,
        node_id=node_id,
        dispatch_md_path=str(dispatch_md_path),
        dispatch_text=dispatch_text,
        payload=payload,
        issued_by=issued_by,
        dispatch_json_path=str(dispatch_json_path),
    )
    dp.write_dispatch_package(dispatch_json_path, pkg)


if __name__ == "__main__":
    sys.exit(main())
