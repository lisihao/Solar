#!/usr/bin/env python3
"""Bridge GenesisPod deep-insight-solar requests into Solar browser-agent operators.

The bridge is intentionally thin:
- stdin: GenesisPod ``SolarOperatorRequest`` JSON.
- stdout: GenesisPod ``SolarOperatorResult`` JSON.
- execution: existing Solar browser-agent task operators, which already enqueue
  through the shared FIFO and enforce profile/rate-limit policy.

It does not import GenesisPod and it does not fake success. Browser-agent
failures are surfaced as ``failed`` unless explicit dry-run mode is enabled for
unit tests.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "lib") not in sys.path:
    sys.path.insert(0, str(ROOT / "lib"))

import operator_flow_control as ofc  # noqa: E402

CHATGPT_OPERATOR = ROOT / "tools" / "chatgpt_browser_agent_task_operator.py"
DIAGRAM_OPERATOR = ROOT / "tools" / "technology_diagram_painter_operator.py"
RUN_ROOT = Path(os.environ.get("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT") or ROOT / "run" / "deep-insight-solar")
DEFAULT_ACCOUNT_EMAIL = "haogege1977@gmail.com"
DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY = "deep_insight_solar"
TECHNOLOGY_DIAGRAM_PROFILE_POLICY_KEY = "technology_diagram"
DEFAULT_PROFILE_POLICY_PATH = Path.home() / ".solar" / "harness" / "browser-agent-chatgpt-local.json"

CHATGPT_OPERATOR_IDS = {
    "BrowserLeaderPlanner": "deep-insight-solar-leader-planner",
    "BrowserAnalyst": "deep-insight-solar-analyst",
    "BrowserLongformWriter": "deep-insight-solar-longform-writer",
    "BrowserCritic": "deep-insight-solar-critic",
}


def _now_slug() -> str:
    return time.strftime("%Y%m%dT%H%M%S", time.localtime())


def _read_request() -> dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        raise RuntimeError("empty SolarOperatorRequest stdin")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise RuntimeError("SolarOperatorRequest must be a JSON object")
    return data


def _json_dump(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _safe_slug(value: Any, fallback: str = "unknown") -> str:
    text = str(value or "").strip() or fallback
    clean = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "-" for ch in text)
    return clean[:120] or fallback


def _account_email() -> str:
    return (
        os.environ.get("GENESISPOD_SOLAR_CHATGPT_ACCOUNT_EMAIL")
        or os.environ.get("BROWSER_AGENT_CHATGPT_ACCOUNT_EMAIL")
        or os.environ.get("BROWSER_AGENT_TARGET_ACCOUNT_EMAIL")
        or DEFAULT_ACCOUNT_EMAIL
    ).strip()


def _bool_env(name: str, default: bool = False) -> bool:
    value = str(os.environ.get(name) or "").strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int) -> int:
    try:
        return int(str(os.environ.get(name) or "").strip() or default)
    except Exception:
        return default


def _base_payload(request: dict[str, Any]) -> dict[str, Any]:
    payload = request.get("payload")
    return payload if isinstance(payload, dict) else {"payload": payload}


def _truncate_text(value: Any, *, max_chars: int) -> str:
    text = str(value or "").strip()
    if max_chars <= 0 or len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "\n...[truncated for planner budget]..."


def _compact_prior_postmortems(value: Any, *, max_items: int = 2, max_chars: int = 1200) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    compacted: list[dict[str, Any]] = []
    for item in value[:max_items]:
        if not isinstance(item, dict):
            continue
        compacted.append(
            {
                "missionId": item.get("missionId"),
                "qualityScore": item.get("qualityScore"),
                "leaderSigned": item.get("leaderSigned"),
                "summary": _truncate_text(item.get("summary"), max_chars=max_chars),
                "recommendations": [
                    _truncate_text(rec, max_chars=300)
                    for rec in (item.get("recommendations") or [])[:3]
                ]
                if isinstance(item.get("recommendations"), list)
                else [],
            }
        )
    return compacted


def _prompt_payload_for_chatgpt(request: dict[str, Any]) -> dict[str, Any]:
    payload = dict(_base_payload(request))
    operator_id = str(request.get("operatorId") or "")
    if operator_id != "BrowserLeaderPlanner":
        return payload
    max_topic_chars = _int_env("DEEP_INSIGHT_SOLAR_PLANNER_TOPIC_MAX_CHARS", 6000)
    max_description_chars = _int_env("DEEP_INSIGHT_SOLAR_PLANNER_DESCRIPTION_MAX_CHARS", 2000)
    compact: dict[str, Any] = {
        "description": _truncate_text(payload.get("description"), max_chars=max_description_chars),
        "depth": payload.get("depth"),
        "language": payload.get("language"),
    }
    postmortems = _compact_prior_postmortems(payload.get("priorPostmortems"))
    if postmortems:
        compact["priorPostmortems"] = postmortems
    return {k: v for k, v in compact.items() if v not in (None, "", [])}


def _profile_policy_path() -> Path:
    raw = (
        os.environ.get("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE")
        or os.environ.get("BROWSER_AGENT_PROFILE_POLICY_FILE")
        or os.environ.get("TECH_HOTSPOT_BROWSER_CHATGPT_PROFILE_POLICY_FILE")
        or ""
    ).strip()
    return Path(raw).expanduser() if raw else DEFAULT_PROFILE_POLICY_PATH


def _load_profile_policy(policy_key: str) -> tuple[Path, dict[str, Any]]:
    path = _profile_policy_path()
    if not path.exists():
        raise RuntimeError(f"profile_policy_missing:{path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError(f"profile_policy_invalid_root:{path}")
    policies = data.get("policies") if isinstance(data.get("policies"), dict) else {}
    policy = policies.get(policy_key) if isinstance(policies.get(policy_key), dict) else None
    if policy is None:
        raise RuntimeError(f"profile_policy_missing_key:{path}:{policy_key}")
    return path, policy


def _policy_preflight(policy_key: str) -> dict[str, Any]:
    path, policy = _load_profile_policy(policy_key)
    expected_account = str(policy.get("expected_account_email") or "").strip()
    requested_account = _account_email()
    if expected_account.lower() != requested_account.lower():
        raise RuntimeError(
            "profile_policy_account_mismatch:"
            f"policy_key={policy_key}:expected={expected_account or 'N/A'}:actual={requested_account or 'N/A'}"
        )
    allowed_profiles = [str(item).strip() for item in (policy.get("allowed_profiles") or []) if str(item).strip()]
    explicit_profile = str(os.environ.get("BROWSER_AGENT_PROFILE_DIRECTORY") or "").strip()
    selected_profile = explicit_profile or (allowed_profiles[0] if allowed_profiles else "")
    if allowed_profiles and selected_profile not in allowed_profiles:
        raise RuntimeError(
            "profile_policy_profile_mismatch:"
            f"policy_key={policy_key}:allowed={','.join(allowed_profiles)}:actual={selected_profile or 'N/A'}"
        )
    if not selected_profile:
        raise RuntimeError(f"profile_policy_profile_missing:{policy_key}")
    return {
        "ok": True,
        "policy_key": policy_key,
        "policy_path": str(path),
        "selected_account_email": expected_account,
        "selected_profile_directory": selected_profile,
        "profile_strategy": str(policy.get("profile_strategy") or ""),
        "force_headed": bool(policy.get("force_headed")),
    }


def _mission_preflight_cache_path(request: dict[str, Any]) -> Path:
    mission = _safe_slug(request.get("missionId"), "mission")
    return RUN_ROOT / mission / "_preflight" / "chatgpt-auth-preflight.json"


def _preflight_cache_is_fresh(payload: dict[str, Any]) -> bool:
    if not payload.get("ok"):
        return False
    ttl = _int_env("DEEP_INSIGHT_SOLAR_PREFLIGHT_TTL_SECONDS", 1800)
    checked_at = float(payload.get("checked_at_epoch") or 0)
    return checked_at > 0 and (time.time() - checked_at) <= ttl


def _operator_block_preflight(operator_id: str) -> dict[str, Any]:
    block = ofc.current_block_state(operator_id, allow_unregistered=True)
    if block:
        raise RuntimeError(
            "operator_flow_control_blocked:"
            f"operator_id={operator_id}:state={block.get('runtime_state') or 'N/A'}:"
            f"expires_at={block.get('expires_at') or 'N/A'}"
        )
    return {"ok": True, "operator_id": operator_id}


def _prompt_for_chatgpt(request: dict[str, Any]) -> str:
    operator_id = str(request.get("operatorId") or "")
    topic = str(request.get("topic") or "")
    language = str(request.get("language") or "zh-CN")
    depth = str(request.get("depth") or "standard")
    payload = _prompt_payload_for_chatgpt(request)
    topic_for_prompt = (
        _truncate_text(topic, max_chars=_int_env("DEEP_INSIGHT_SOLAR_PLANNER_TOPIC_MAX_CHARS", 6000))
        if operator_id == "BrowserLeaderPlanner"
        else topic
    )
    common = {
        "topic": topic_for_prompt,
        "language": language,
        "depth": depth,
        "constraints": request.get("constraints") or {},
        "payload": payload,
    }
    if operator_id == "BrowserLeaderPlanner":
        schema = {
            "themeSummary": "string",
            "dimensions": [{"id": "string", "name": "string", "rationale": "string"}],
            "evidenceStrategy": ["string"],
            "risks": ["string"],
        }
        task = "Create a research contract for the mission. Pick dimensions that downstream researcher and analyst stages can consume."
    elif operator_id == "BrowserAnalyst":
        schema = {
            "themeSummary": "string",
            "thesis": "string",
            "coreInsights": [{"title": "string", "summary": "string", "narrative": "string"}],
            "contradictions": ["string"],
            "gaps": ["string"],
            "recommendations": ["string"],
            "diagramBriefs": [
                {
                    "id": "string",
                    "caption": "string",
                    "claimIds": ["string"],
                    "evidenceIds": ["string"],
                    "sourceNote": "string",
                }
            ],
        }
        task = "Synthesize an InsightKernel from the evidence. Be explicit about claims, gaps, and diagram-worthy structures."
    elif operator_id == "BrowserLongformWriter":
        schema = {
            "title": "string",
            "summary": "string",
            "sections": [{"heading": "string", "body": "markdown string", "sources": ["string"]}],
            "conclusion": "string",
            "citations": ["string"],
        }
        task = "Write the report section-by-section. Preserve markdown, evidence anchors, citations, and diagram placeholders."
    elif operator_id == "BrowserCritic":
        schema = {
            "criticalIssues": ["string"],
            "claimGaps": ["string"],
            "citationGaps": ["string"],
            "diagramRisks": ["string"],
            "recommendations": ["string"],
        }
        task = "Perform an independent red-team review. Do not reuse writer assumptions; focus on unsupported claims and missing citations."
    else:
        raise RuntimeError(f"unsupported ChatGPT operatorId: {operator_id}")

    return "\n".join(
        [
            "You are a Solar-Harness browser-agent logical operator used by GenesisPod deep-insight-solar.",
            "Return STRICT JSON only. Do not wrap in markdown fences. Do not include prose outside JSON.",
            "",
            f"Task: {task}",
            "",
            "Required JSON schema shape:",
            json.dumps(schema, ensure_ascii=False, indent=2),
            "",
            "Input:",
            json.dumps(common, ensure_ascii=False, indent=2),
        ]
    )


def _chatgpt_envelope(request: dict[str, Any]) -> dict[str, Any]:
    operator_id = str(request.get("operatorId") or "")
    timeout = int(os.environ.get("DEEP_INSIGHT_SOLAR_CHATGPT_TIMEOUT_SECONDS") or "3600")
    default_effort = "medium" if operator_id == "BrowserLeaderPlanner" else "high"
    return {
        "operator_id": CHATGPT_OPERATOR_IDS[operator_id],
        "purpose": f"deep-insight-solar-{operator_id}",
        "chatgpt_browser_agent_request": {
            "prompt": _prompt_for_chatgpt(request),
            "expected_output": "json",
            "profile_policy_key": DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY,
            "model": os.environ.get("DEEP_INSIGHT_SOLAR_CHATGPT_MODEL") or "chatgpt-5.5",
            "reasoning_effort": os.environ.get("DEEP_INSIGHT_SOLAR_CHATGPT_REASONING_EFFORT") or default_effort,
            "model_mode": "thinking",
            "tool_mode": os.environ.get("DEEP_INSIGHT_SOLAR_CHATGPT_TOOL_MODE") or "none",
            "require_ui_mode": True,
            "require_deep_research": False,
            "account_email": _account_email(),
            "timeout_seconds": timeout,
            "ready_timeout_seconds": _int_env("DEEP_INSIGHT_SOLAR_CHATGPT_READY_TIMEOUT_SECONDS", 300),
            "new_chat_timeout_seconds": _int_env("DEEP_INSIGHT_SOLAR_CHATGPT_NEW_CHAT_TIMEOUT_SECONDS", 180),
        },
        "chatgpt_success_cooldown_seconds": int(os.environ.get("DEEP_INSIGHT_SOLAR_SUCCESS_COOLDOWN_SECONDS") or "300"),
        "chatgpt_rate_limit_cooldown_seconds": int(os.environ.get("DEEP_INSIGHT_SOLAR_RATE_LIMIT_COOLDOWN_SECONDS") or "1800"),
        "chatgpt_auth_cooldown_seconds": int(os.environ.get("DEEP_INSIGHT_SOLAR_AUTH_COOLDOWN_SECONDS") or "21600"),
        "chatgpt_defer_on_cooldown": True,
        "chatgpt_defer_on_auth": True,
    }


def _chatgpt_login_hold_envelope(request: dict[str, Any], *, policy_key: str) -> dict[str, Any]:
    timeout = _int_env("DEEP_INSIGHT_SOLAR_PREFLIGHT_BROWSER_TIMEOUT_SECONDS", 90)
    return {
        "operator_id": "deep-insight-solar-auth-preflight",
        "purpose": "deep-insight-solar-auth-preflight",
        "chatgpt_browser_agent_request": {
            "prompt": "Solar deep-insight-solar ChatGPT login healthcheck. Do not submit a task.",
            "expected_output": "json",
            "profile_policy_key": policy_key,
            "model": os.environ.get("DEEP_INSIGHT_SOLAR_CHATGPT_MODEL") or "chatgpt-5.5",
            "reasoning_effort": "minimal",
            "model_mode": "thinking",
            "tool_mode": "none",
            "require_ui_mode": False,
            "require_deep_research": False,
            "action": "login_hold",
            "account_email": _account_email(),
            "timeout_seconds": timeout,
        },
        "chatgpt_success_cooldown_seconds": 0,
        "chatgpt_rate_limit_cooldown_seconds": int(os.environ.get("DEEP_INSIGHT_SOLAR_RATE_LIMIT_COOLDOWN_SECONDS") or "1800"),
        "chatgpt_auth_cooldown_seconds": int(os.environ.get("DEEP_INSIGHT_SOLAR_AUTH_COOLDOWN_SECONDS") or "21600"),
        "chatgpt_defer_on_cooldown": True,
        "chatgpt_defer_on_auth": True,
    }


def _load_login_hold_result(task_dir: Path) -> dict[str, Any]:
    result_path = task_dir / "chatgpt-browser-agent-result.json"
    if not result_path.exists():
        output = (task_dir / "chatgpt-browser-agent-output.txt").read_text(encoding="utf-8") if (task_dir / "chatgpt-browser-agent-output.txt").exists() else ""
        raise RuntimeError(f"missing chatgpt preflight result artifact: {result_path}; output={output[-1000:]}")
    result = json.loads(result_path.read_text(encoding="utf-8"))
    text = str(result.get("text") or "").strip()
    try:
        parsed = json.loads(_strip_json_fence(text))
    except Exception:
        parsed = {"rawText": text}
    if not parsed.get("ok"):
        raise RuntimeError(f"chatgpt_login_preflight_not_ready:{json.dumps(parsed, ensure_ascii=False)[:1000]}")
    return parsed


def _chatgpt_preflight(request: dict[str, Any], *, policy_key: str, operator_id: str, task_dir: Path) -> dict[str, Any]:
    cache_path = _mission_preflight_cache_path(request)
    started = time.time()
    policy_result = _policy_preflight(policy_key)
    operator_result = _operator_block_preflight(operator_id)
    base_result: dict[str, Any] = {
        "ok": True,
        "status": "policy_checked",
        "checked_at_epoch": started,
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(started)),
        "policy": policy_result,
        "operator": operator_result,
        "browser_check": {"enabled": False},
    }
    if cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            if _preflight_cache_is_fresh(cached):
                return {
                    **base_result,
                    "status": str(cached.get("status") or base_result["status"]),
                    "browser_check": cached.get("browser_check") or {"enabled": False},
                    "cache_hit": True,
                    "cached_checked_at": cached.get("checked_at"),
                }
        except Exception:
            pass

    result = dict(base_result)
    if _bool_env("DEEP_INSIGHT_SOLAR_PREFLIGHT_BROWSER", True):
        preflight_dir = task_dir / "preflight" / "chatgpt-login-hold"
        proc = _run_operator(CHATGPT_OPERATOR, _chatgpt_login_hold_envelope(request, policy_key=policy_key), preflight_dir)
        browser_check = {
            "enabled": True,
            "returncode": proc.returncode,
            "task_dir": str(preflight_dir),
        }
        if proc.returncode != 0:
            combined = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
            raise RuntimeError(f"chatgpt_login_preflight_failed:rc={proc.returncode}:{combined[-2000:]}")
        browser_check["result"] = _load_login_hold_result(preflight_dir)
        result["status"] = "browser_login_verified"
        result["browser_check"] = browser_check
    _json_dump(cache_path, result)
    return result


def _diagram_envelope(request: dict[str, Any]) -> dict[str, Any]:
    payload = _base_payload(request)
    input_text = json.dumps(
        {
            "topic": request.get("topic"),
            "brief": payload,
            "constraints": request.get("constraints") or {},
        },
        ensure_ascii=False,
        indent=2,
    )
    return {
        "operator_id": "deep-insight-solar-technology-diagram-painter",
        "technology_diagram_request": {
            "input_text": input_text,
            "timeout_seconds": int(os.environ.get("DEEP_INSIGHT_SOLAR_DIAGRAM_TIMEOUT_SECONDS") or "900"),
            "max_retries": int(os.environ.get("DEEP_INSIGHT_SOLAR_DIAGRAM_MAX_RETRIES") or "1"),
        },
        "success_cooldown_seconds": int(os.environ.get("DEEP_INSIGHT_SOLAR_SUCCESS_COOLDOWN_SECONDS") or "300"),
        "rate_limit_cooldown_seconds": int(os.environ.get("DEEP_INSIGHT_SOLAR_RATE_LIMIT_COOLDOWN_SECONDS") or "1800"),
        "auth_cooldown_seconds": int(os.environ.get("DEEP_INSIGHT_SOLAR_AUTH_COOLDOWN_SECONDS") or "21600"),
        "defer_on_cooldown": True,
        "defer_on_auth": True,
    }


def _task_dir(request: dict[str, Any]) -> Path:
    mission = _safe_slug(request.get("missionId"), "mission")
    step = _safe_slug(request.get("stepId"), "step")
    key = _safe_slug(request.get("idempotencyKey"), _now_slug())
    return RUN_ROOT / mission / f"{step}-{key}"


def _run_operator(script: Path, envelope: dict[str, Any], task_dir: Path) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    envelope_path = task_dir / "operator-envelope.json"
    _json_dump(envelope_path, envelope)
    env["SOLAR_OPERATOR_ENVELOPE_JSON"] = str(envelope_path)
    env["TASK_DIR"] = str(task_dir)
    env["BROWSER_AGENT_PURPOSE"] = str(envelope.get("purpose") or envelope.get("operator_id") or "")
    timeout = int(os.environ.get("DEEP_INSIGHT_SOLAR_BRIDGE_SUBPROCESS_TIMEOUT_SECONDS") or "21600")
    return subprocess.run(
        [sys.executable, str(script)],
        text=True,
        capture_output=True,
        env=env,
        timeout=timeout,
    )


def _load_chatgpt_result(task_dir: Path) -> tuple[Any, str, dict[str, Any]]:
    result_path = task_dir / "chatgpt-browser-agent-result.json"
    if not result_path.exists():
        output = (task_dir / "chatgpt-browser-agent-output.txt").read_text(encoding="utf-8") if (task_dir / "chatgpt-browser-agent-output.txt").exists() else ""
        raise RuntimeError(f"missing chatgpt result artifact: {result_path}; output={output[-1000:]}")
    result = json.loads(result_path.read_text(encoding="utf-8"))
    text = str(result.get("text") or "").strip()
    structured: Any = None
    try:
        structured = json.loads(_strip_json_fence(text))
    except Exception:
        structured = {"rawText": text}
    metrics = {
        "modelId": result.get("model"),
        "requestDir": result.get("request_dir"),
    }
    return structured, text, metrics


def _load_diagram_result(task_dir: Path) -> tuple[Any, str, dict[str, Any]]:
    result_path = task_dir / "tech-diagram-result.json"
    if not result_path.exists():
        result_path = task_dir / "technology-diagram-result.json"
    if not result_path.exists():
        raise RuntimeError(f"missing technology diagram result artifact under {task_dir}")
    result = json.loads(result_path.read_text(encoding="utf-8"))
    markdown = "\n".join(
        [
            f"image_path: {result.get('image_path') or 'N/A'}",
            f"url: {result.get('url') or 'N/A'}",
            f"status: {result.get('status') or 'N/A'}",
        ]
    )
    return result, markdown, {"requestDir": result.get("request_dir"), "taskDir": str(task_dir)}


def _strip_json_fence(text: str) -> str:
    clean = text.strip()
    if clean.startswith("```"):
        lines = clean.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        clean = "\n".join(lines).strip()
    return clean


def _dry_run_result(request: dict[str, Any], task_dir: Path) -> dict[str, Any]:
    operator_id = str(request.get("operatorId") or "")
    if operator_id == "BrowserLeaderPlanner":
        structured: Any = {
            "themeSummary": f"Dry-run plan for {request.get('topic')}",
            "dimensions": [{"id": "dry-d1", "name": "Dry-run dimension", "rationale": "bridge dry run"}],
        }
    elif operator_id == "BrowserAnalyst":
        structured = {
            "themeSummary": f"Dry-run insight for {request.get('topic')}",
            "coreInsights": [{"title": "Dry-run insight", "summary": "bridge dry run"}],
            "diagramBriefs": [{"id": "dry-fig-1", "caption": "Dry-run diagram"}],
        }
    elif operator_id == "BrowserLongformWriter":
        structured = {
            "title": str(request.get("topic") or "Dry-run report"),
            "summary": "Dry-run summary",
            "sections": [{"heading": "Dry-run section", "body": "Dry-run body.", "sources": []}],
            "conclusion": "Dry-run conclusion",
            "citations": [],
        }
    elif operator_id == "BrowserCritic":
        structured = {"criticalIssues": [], "recommendations": ["Dry-run critic passed"]}
    else:
        structured = {"status": "dry-run", "operatorId": operator_id}
    return {
        "status": "succeeded",
        "structured": structured,
        "markdown": json.dumps(structured, ensure_ascii=False, indent=2),
        "evidence": [],
        "artifacts": [],
        "metrics": {"dryRun": True, "taskDir": str(task_dir)},
        "rawTranscriptUri": str(task_dir / "dry-run.json"),
    }


def _result_from_error(code: str, message: str, *, retryable: bool = True) -> dict[str, Any]:
    return {
        "status": "failed",
        "error": {"code": code, "message": message, "retryable": retryable},
    }


def _preflight_failure_message(exc: Exception) -> str:
    return (
        f"{type(exc).__name__}: {exc}\n"
        "Recovery: open the browser-agent Chrome profile using the configured "
        "Default profile, sign in as haogege1977@gmail.com, then rerun the "
        "GenesisPod deep-insight-solar mission from the failed stage."
    )


def handle(request: dict[str, Any]) -> dict[str, Any]:
    operator_id = str(request.get("operatorId") or "")
    task_dir = _task_dir(request)
    task_dir.mkdir(parents=True, exist_ok=True)
    _json_dump(task_dir / "genesis-solar-operator-request.json", request)

    if os.environ.get("DEEP_INSIGHT_SOLAR_BRIDGE_DRY_RUN", "").lower() in {"1", "true", "yes", "on"}:
        result = _dry_run_result(request, task_dir)
        _json_dump(task_dir / "genesis-solar-operator-result.json", result)
        return result

    if operator_id in CHATGPT_OPERATOR_IDS:
        try:
            preflight = _chatgpt_preflight(
                request,
                policy_key=DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY,
                operator_id=CHATGPT_OPERATOR_IDS[operator_id],
                task_dir=task_dir,
            )
            _json_dump(task_dir / "chatgpt-preflight.json", preflight)
        except Exception as exc:
            result = _result_from_error(
                "CHATGPT_PREFLIGHT_FAILED",
                _preflight_failure_message(exc),
                retryable=True,
            )
            _json_dump(task_dir / "chatgpt-preflight.json", result)
            _json_dump(task_dir / "genesis-solar-operator-result.json", result)
            return result
        proc = _run_operator(CHATGPT_OPERATOR, _chatgpt_envelope(request), task_dir)
        if proc.returncode != 0:
            return _result_from_error(
                "SOLAR_CHATGPT_OPERATOR_FAILED",
                ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()[-4000:],
            )
        structured, markdown, metrics = _load_chatgpt_result(task_dir)
        result = {
            "status": "succeeded",
            "structured": structured,
            "markdown": markdown,
            "evidence": [],
            "artifacts": [],
            "metrics": metrics,
            "rawTranscriptUri": str(task_dir / "chatgpt-browser-agent-output.txt"),
        }
        _json_dump(task_dir / "genesis-solar-operator-result.json", result)
        return result

    if operator_id == "TechnologyDiagramPainter":
        try:
            preflight = _chatgpt_preflight(
                request,
                policy_key=TECHNOLOGY_DIAGRAM_PROFILE_POLICY_KEY,
                operator_id="deep-insight-solar-technology-diagram-painter",
                task_dir=task_dir,
            )
            _json_dump(task_dir / "chatgpt-preflight.json", preflight)
        except Exception as exc:
            result = _result_from_error(
                "CHATGPT_PREFLIGHT_FAILED",
                _preflight_failure_message(exc),
                retryable=True,
            )
            _json_dump(task_dir / "chatgpt-preflight.json", result)
            _json_dump(task_dir / "genesis-solar-operator-result.json", result)
            return result
        proc = _run_operator(DIAGRAM_OPERATOR, _diagram_envelope(request), task_dir)
        if proc.returncode != 0:
            return _result_from_error(
                "SOLAR_DIAGRAM_OPERATOR_FAILED",
                ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()[-4000:],
            )
        structured, markdown, metrics = _load_diagram_result(task_dir)
        artifacts = [structured] if isinstance(structured, dict) else []
        result = {
            "status": "succeeded",
            "structured": structured,
            "markdown": markdown,
            "evidence": [],
            "artifacts": artifacts,
            "metrics": metrics,
            "rawTranscriptUri": str(task_dir / "tech-diagram-output-attempt1.txt"),
        }
        _json_dump(task_dir / "genesis-solar-operator-result.json", result)
        return result

    return _result_from_error("UNSUPPORTED_SOLAR_OPERATOR", f"unsupported operatorId: {operator_id}", retryable=False)


def main() -> int:
    try:
        request = _read_request()
        result = handle(request)
    except Exception as exc:
        result = _result_from_error("DEEP_INSIGHT_SOLAR_BRIDGE_ERROR", f"{type(exc).__name__}: {exc}")
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("status") in {"succeeded", "degraded"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
