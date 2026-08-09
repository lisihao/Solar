#!/usr/bin/env python3
"""Command backend adapter for ChatGPT browser-agent logical operator tasks."""
from __future__ import annotations

import json
import hashlib
import os
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from copy import deepcopy
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "lib") not in sys.path:
    sys.path.insert(0, str(ROOT / "lib"))

import operator_flow_control as ofc  # noqa: E402
from browser.profile_lease import ProfileLease  # noqa: E402
from browser.runtime_control import default_profile_id  # noqa: E402
from browser_agent_queue_client import enqueue_current_process_if_needed  # noqa: E402


DEFAULT_OPERATOR_ID = "mini-chatgpt-deep-research"
DEFAULT_PROJECT_NAME = ""
DEFAULT_WRAPPER = ROOT / "scripts" / "browser_agent_chatgpt_wrapper.py"
DEFAULT_BROWSER_USE_PYTHON = Path.home() / ".claude" / "mcp-servers" / "browser-use" / ".venv" / "bin" / "python"
DEFAULT_LOCAL_PROFILE_POLICY = Path.home() / ".solar" / "harness" / "browser-agent-chatgpt-local.json"


def _load_envelope() -> dict[str, Any]:
    path = str(os.environ.get("SOLAR_OPERATOR_ENVELOPE_JSON") or "").strip()
    if not path:
        raise RuntimeError("SOLAR_OPERATOR_ENVELOPE_JSON missing")
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("operator envelope must be a JSON object")
    return payload


def _task_dir() -> Path:
    raw = str(os.environ.get("TASK_DIR") or "").strip()
    if raw:
        path = Path(raw).expanduser()
        path.mkdir(parents=True, exist_ok=True)
        return path
    return Path.cwd()


def _wrapper_cmd() -> list[str]:
    raw = (
        os.environ.get("TECH_HOTSPOT_BROWSER_CHATGPT_CMD")
        or os.environ.get("BROWSER_AGENT_CHATGPT_CMD")
        or ""
    ).strip()
    if raw:
        return shlex.split(raw)
    if DEFAULT_WRAPPER.exists() and DEFAULT_BROWSER_USE_PYTHON.exists():
        return [str(DEFAULT_BROWSER_USE_PYTHON), str(DEFAULT_WRAPPER)]
    return []


def _profile_policy_path() -> Path | None:
    disabled = (
        os.environ.get("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_DISABLED")
        or os.environ.get("TECH_HOTSPOT_BROWSER_CHATGPT_PROFILE_POLICY_DISABLED")
        or ""
    ).strip().lower()
    if disabled in {"1", "true", "yes", "on"}:
        return None
    raw = (
        os.environ.get("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE")
        or os.environ.get("TECH_HOTSPOT_BROWSER_CHATGPT_PROFILE_POLICY_FILE")
        or ""
    ).strip()
    return Path(raw).expanduser() if raw else DEFAULT_LOCAL_PROFILE_POLICY


def _load_profile_policy() -> dict[str, Any]:
    path = _profile_policy_path()
    if path is None or not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError(f"invalid_browser_agent_profile_policy:{path}:root_not_object")
    policies = data.get("policies") or {}
    if not isinstance(policies, dict):
        raise RuntimeError(f"invalid_browser_agent_profile_policy:{path}:policies_not_object")
    return {"path": str(path), "policies": policies}


def _pick_policy_key(request: dict[str, Any]) -> str:
    explicit = str(
        request.get("profile_policy_key")
        or request.get("policy_key")
        or os.environ.get("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_KEY")
        or ""
    ).strip()
    if explicit:
        return explicit
    purpose = str(request.get("purpose") or os.environ.get("BROWSER_AGENT_PURPOSE") or "").strip().lower()
    if purpose.startswith("deep-insight-solar"):
        return os.environ.get("DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY", "deep_insight_solar")
    if purpose.startswith(("hf-paper-l7-high-reasoning", "hf-paper-report-plan", "hf-paper-report-section")):
        return "hf_paper_insight"
    if purpose.startswith("github-trend-report"):
        return "github_trend_report"
    if purpose.startswith("ai-influence-report"):
        return "ai_influence_report"
    return "default"


def _pick_profile(purpose: str, profiles: list[str], selection: str) -> str:
    clean = [item for item in profiles if str(item).strip()]
    if not clean:
        return ""
    if len(clean) == 1 or selection == "first":
        return clean[0]
    import hashlib

    digest = hashlib.sha256(str(purpose or "").encode("utf-8")).hexdigest()
    return clean[int(digest[:8], 16) % len(clean)]


def _enforce_no_default_profile_for_scoped_chatgpt(policy_key: str, policy: dict[str, Any], resolved_profile: str, purpose: str) -> None:
    protected_keys = {"hf_paper_insight", "github_trend_report", "ai_influence_report", "deep_insight_solar"}
    allow_default = bool(policy.get("allow_default_profile") or policy.get("allow_default_chatgpt_profile"))
    if policy_key in protected_keys and not allow_default and resolved_profile == "Default":
        raise RuntimeError(
            "browser_agent_profile_policy_default_profile_forbidden:"
            f"purpose={purpose or 'N/A'}:policy_key={policy_key}:actual=Default"
        )


def _is_protected_scoped_chatgpt(policy_key: str) -> bool:
    return policy_key in {"hf_paper_insight", "github_trend_report", "ai_influence_report", "deep_insight_solar"}


def apply_profile_policy(env: dict[str, str], request: dict[str, Any]) -> dict[str, Any]:
    loaded = _load_profile_policy()
    if not loaded:
        return {"enabled": False}
    policies = loaded["policies"]
    key = _pick_policy_key(request)
    default_policy = policies.get("default") if isinstance(policies.get("default"), dict) else {}
    scoped_policy = policies.get(key) if isinstance(policies.get(key), dict) else {}
    effective_key = key if scoped_policy else ("default" if default_policy else key)
    policy = {**default_policy, **scoped_policy}
    purpose = str(request.get("purpose") or os.environ.get("BROWSER_AGENT_PURPOSE") or "")
    allowed_profiles = [str(item).strip() for item in (policy.get("allowed_profiles") or []) if str(item).strip()]
    expected_account = str(policy.get("expected_account_email") or "").strip()
    selection = str(policy.get("selection") or "first").strip().lower()
    profile_strategy = str(policy.get("profile_strategy") or "persistent").strip().lower()
    user_data_dir = str(policy.get("user_data_dir") or "").strip()

    explicit_profile = str(env.get("BROWSER_AGENT_PROFILE_DIRECTORY") or "").strip()
    ignore_explicit_profile = _is_protected_scoped_chatgpt(effective_key) and bool(
        policy.get("ignore_explicit_profile_id", True)
    )
    ignored_explicit_profile = explicit_profile if ignore_explicit_profile else ""
    if ignore_explicit_profile:
        explicit_profile = ""
    explicit_account = str(
        env.get("BROWSER_AGENT_CHATGPT_ACCOUNT_EMAIL")
        or env.get("BROWSER_AGENT_TARGET_ACCOUNT_EMAIL")
        or ""
    ).strip()
    if expected_account and explicit_account and explicit_account.lower() != expected_account.lower():
        raise RuntimeError(
            "browser_agent_profile_policy_account_mismatch:"
            f"purpose={purpose or 'N/A'}:expected={expected_account}:actual={explicit_account}"
        )
    if allowed_profiles and explicit_profile and explicit_profile not in allowed_profiles:
        raise RuntimeError(
            "browser_agent_profile_policy_profile_mismatch:"
            f"purpose={purpose or 'N/A'}:allowed={','.join(allowed_profiles)}:actual={explicit_profile}"
        )

    resolved_profile = explicit_profile or _pick_profile(purpose, allowed_profiles, selection)
    resolved_account = explicit_account or expected_account
    _enforce_no_default_profile_for_scoped_chatgpt(effective_key, policy, resolved_profile, purpose)
    if resolved_profile:
        env["BROWSER_AGENT_PROFILE_DIRECTORY"] = resolved_profile
    if resolved_account:
        env["BROWSER_AGENT_TARGET_ACCOUNT_EMAIL"] = resolved_account
        env["BROWSER_AGENT_CHATGPT_ACCOUNT_EMAIL"] = resolved_account
    if profile_strategy:
        env["BROWSER_AGENT_PROFILE_STRATEGY"] = profile_strategy
        env["BROWSER_AGENT_CHATGPT_PROFILE_STRATEGY"] = profile_strategy
    if user_data_dir and not env.get("BROWSER_AGENT_USER_DATA_DIR"):
        env["BROWSER_AGENT_USER_DATA_DIR"] = user_data_dir
    allow_headless = policy.get("allow_headless")
    force_headed = bool(
        policy.get("force_headed")
        or policy.get("require_headed")
        or (allow_headless is not None and not bool(allow_headless))
    )
    if force_headed:
        env["BROWSER_AGENT_HEADLESS"] = "false"
        env["TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS"] = "false"
        env["BROWSER_AGENT_CHATGPT_ALLOW_HEADED"] = "true"
        env["TECH_HOTSPOT_BROWSER_CHATGPT_ALLOW_HEADED"] = "true"
        env["BROWSER_AGENT_ALLOW_HEADED"] = "true"
    env["BROWSER_AGENT_CHATGPT_PROFILE_POLICY_KEY"] = effective_key
    return {
        "enabled": True,
        "policy_key": effective_key,
        "policy_path": loaded.get("path") or "",
        "selected_profile_directory": resolved_profile,
        "selected_account_email": resolved_account,
        "profile_strategy": profile_strategy,
        "user_data_dir_set": bool(env.get("BROWSER_AGENT_USER_DATA_DIR")),
        "headless_forced": force_headed,
        "explicit_profile_ignored": ignored_explicit_profile,
    }


def _operator_id(envelope: dict[str, Any]) -> str:
    return str(envelope.get("operator_id") or "").strip() or DEFAULT_OPERATOR_ID


def _read_request_file(path_value: str) -> dict[str, Any]:
    payload = json.loads(Path(path_value).expanduser().read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("chatgpt browser-agent request file must contain JSON object")
    return payload


def build_request(envelope: dict[str, Any], *, task_dir: Path | None = None) -> dict[str, Any]:
    raw = envelope.get("chatgpt_browser_agent_request")
    if isinstance(raw, dict):
        request = deepcopy(raw)
    else:
        file_ref = str(envelope.get("chatgpt_browser_agent_request_file") or "").strip()
        if file_ref:
            request = _read_request_file(file_ref)
        else:
            request = {}
            for key in (
                "prompt",
                "prompt_file",
                "expected_output",
                "model",
                "reasoning_effort",
                "project_name",
                "require_project",
                "open_project_first",
                "model_mode",
                "tool_mode",
                "require_ui_mode",
                "require_deep_research",
                "account_email",
                "action",
                "timeout_seconds",
                "ready_timeout_seconds",
                "new_chat_timeout_seconds",
            ):
                if key in envelope:
                    request[key] = deepcopy(envelope[key])
    if not str(request.get("prompt") or "").strip():
        prompt_file = str(request.get("prompt_file") or envelope.get("prompt_file") or "").strip()
        if prompt_file:
            request["prompt"] = Path(prompt_file).expanduser().read_text(encoding="utf-8")
    if task_dir is not None:
        request.setdefault("request_dir", str((task_dir / "chatgpt-browser-agent-request").resolve()))
    request.setdefault("expected_output", "markdown")
    request.setdefault("model", "chatgpt-5.5")
    request.setdefault("reasoning_effort", "high")
    request.setdefault("model_mode", "thinking")
    request.setdefault("tool_mode", "none")
    request.setdefault("require_ui_mode", True)
    request.setdefault("require_deep_research", False)
    request.setdefault("action", "run")
    return request


def _rate_control_settings(envelope: dict[str, Any]) -> dict[str, Any]:
    operator_id = _operator_id(envelope)
    flow_control: dict[str, Any] = {}
    try:
        import operator_runtime  # type: ignore

        config = operator_runtime.get_operator_config(operator_id) or {}
        if isinstance(config.get("flow_control"), dict):
            flow_control = dict(config["flow_control"])
    except Exception:
        flow_control = {}
    return {
        "operator_id": operator_id,
        "success_cooldown_seconds": ofc.int_value(
            envelope.get("chatgpt_success_cooldown_seconds")
            or os.environ.get("SOLAR_CHATGPT_SUCCESS_COOLDOWN_SECONDS")
            or flow_control.get("success_cooldown_seconds"),
            180,
        ),
        "rate_limit_cooldown_seconds": ofc.int_value(
            envelope.get("chatgpt_rate_limit_cooldown_seconds")
            or os.environ.get("SOLAR_CHATGPT_RATE_LIMIT_COOLDOWN_SECONDS")
            or flow_control.get("rate_limit_cooldown_seconds"),
            3600,
        ),
        "auth_cooldown_seconds": ofc.int_value(
            envelope.get("chatgpt_auth_cooldown_seconds")
            or os.environ.get("SOLAR_CHATGPT_AUTH_COOLDOWN_SECONDS")
            or flow_control.get("auth_cooldown_seconds"),
            21600,
        ),
        "defer_on_cooldown": ofc.bool_value(
            envelope.get("chatgpt_defer_on_cooldown")
            or os.environ.get("SOLAR_CHATGPT_DEFER_ON_COOLDOWN")
            or flow_control.get("defer_on_cooldown"),
            True,
        ),
        "defer_on_auth": ofc.bool_value(
            envelope.get("chatgpt_defer_on_auth")
            or os.environ.get("SOLAR_CHATGPT_DEFER_ON_AUTH")
            or flow_control.get("defer_on_auth"),
            True,
        ),
    }


def _summary_markdown(response: dict[str, Any]) -> str:
    return "\n".join(
        [
            "# ChatGPT Browser Agent Result",
            "",
            "## 已完成",
            f"- model: {response.get('model') or 'N/A'}",
            f"- project_name: {response.get('project_name') or 'N/A'}",
            f"- expected_output: {response.get('expected_output') or 'N/A'}",
        ]
    )


def _cdp_health_url(cdp_url: str) -> str:
    parsed = urllib.parse.urlparse(str(cdp_url or ""))
    if parsed.scheme not in {"ws", "wss"} or not parsed.netloc:
        return ""
    scheme = "https" if parsed.scheme == "wss" else "http"
    return urllib.parse.urlunparse((scheme, parsed.netloc, "/json/version", "", "", ""))


def _request_cdp_url(request_dir: Path) -> str:
    contract_path = request_dir / "browser-session-contract.json"
    if not contract_path.exists():
        return ""
    try:
        payload = json.loads(contract_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    metadata = payload.get("metadata") if isinstance(payload, dict) else {}
    if not isinstance(metadata, dict):
        return ""
    return str(metadata.get("cdp_url") or "").strip()


def _cdp_reachable(cdp_url: str) -> bool:
    health_url = _cdp_health_url(cdp_url)
    if not health_url:
        return True
    try:
        with urllib.request.urlopen(health_url, timeout=3) as resp:
            return 200 <= int(getattr(resp, "status", 200)) < 500
    except (OSError, urllib.error.URLError):
        return False


def _terminate_process(proc: subprocess.Popen[str]) -> None:
    if proc.poll() is not None:
        return
    try:
        proc.terminate()
    except ProcessLookupError:
        return
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        try:
            proc.kill()
        except ProcessLookupError:
            pass


def _final_artifact_snapshot(request_dir: Path) -> dict[str, Any]:
    signal = _load_json_object(request_dir / "completion-signal.json")
    if signal and str(signal.get("status") or "") != "completed":
        return {
            "ok": False,
            "reason": f"completion_signal_{signal.get('status') or 'unknown'}",
        }
    if signal and (bool(signal.get("login_wall")) or bool(signal.get("challenge_wall")) or bool(signal.get("is_generating"))):
        return {
            "ok": False,
            "reason": "completion_signal_not_final",
            "signal": signal.get("status"),
        }
    text_path = request_dir / "assistant-response.txt"
    try:
        text = text_path.read_text(encoding="utf-8").strip()
    except OSError:
        text = ""
    min_chars = ofc.int_value(
        os.environ.get("BROWSER_AGENT_CHATGPT_FINAL_ARTIFACT_MIN_CHARS"),
        200,
    )
    if len(text) < max(1, min_chars):
        return {
            "ok": False,
            "reason": "assistant_response_too_short",
            "chars": len(text),
            "min_chars": min_chars,
        }

    states: list[dict[str, Any]] = []
    for name in ("page.json", "conversation.json"):
        payload = _load_json_object(request_dir / name)
        if payload:
            states.append({"name": name, "payload": payload})
    if not states:
        return {
            "ok": False,
            "reason": "missing_final_state",
            "chars": len(text),
        }

    for state in states:
        payload = state["payload"]
        if bool(payload.get("login_wall")):
            return {"ok": False, "reason": "login_wall", "state": state["name"], "chars": len(text)}
        if bool(payload.get("challenge_wall")):
            return {"ok": False, "reason": "challenge_wall", "state": state["name"], "chars": len(text)}

    final_states = [
        state
        for state in states
        if "is_generating" in state["payload"] and bool(state["payload"].get("is_generating")) is False
    ]
    if not final_states:
        return {
            "ok": False,
            "reason": "still_generating_or_unknown",
            "chars": len(text),
            "states": [state["name"] for state in states],
        }
    if signal and str(signal.get("latest_text_sha256") or ""):
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if digest != str(signal.get("latest_text_sha256") or ""):
            return {
                "ok": False,
                "reason": "completion_signal_hash_mismatch",
                "chars": len(text),
            }

    return {
        "ok": True,
        "reason": "completion_signal_ready" if signal else "final_artifact_ready",
        "chars": len(text),
        "text": text,
        "states": [state["name"] for state in final_states],
    }


def _write_final_artifact_watchdog(
    request_dir: Path,
    *,
    started_at: float,
    first_ready_at: float,
    snapshot: dict[str, Any],
) -> None:
    payload = {
        "ok": True,
        "reason": "wrapper_still_running_after_final_artifact",
        "elapsed_seconds": round(time.monotonic() - started_at, 3),
        "final_artifact_ready_seconds": round(time.monotonic() - first_ready_at, 3),
        "chars": snapshot.get("chars"),
        "states": snapshot.get("states") or [],
    }
    try:
        (request_dir / "wrapper-final-artifact-watchdog.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except OSError:
        pass


def _run_wrapper_with_watchdog(
    cmd: list[str],
    *,
    prompt: str,
    env: dict[str, str],
    timeout: int,
    request_dir: Path,
) -> subprocess.CompletedProcess[str]:
    cdp_stall_seconds = ofc.int_value(
        os.environ.get("BROWSER_AGENT_CHATGPT_CDP_STALL_SECONDS"),
        60,
    )
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    started = time.monotonic()
    first_unreachable_at: float | None = None
    first_final_artifact_at: float | None = None
    final_artifact_grace_seconds = ofc.int_value(
        os.environ.get("BROWSER_AGENT_CHATGPT_FINALIZE_GRACE_SECONDS"),
        30,
    )
    sent_input = False
    while True:
        remaining = max(1, int(timeout - (time.monotonic() - started)))
        try:
            if not sent_input:
                stdout, stderr = proc.communicate(input=prompt, timeout=min(5, remaining))
                sent_input = True
            else:
                stdout, stderr = proc.communicate(timeout=min(5, remaining))
            return subprocess.CompletedProcess(cmd, proc.returncode or 0, stdout, stderr)
        except subprocess.TimeoutExpired:
            sent_input = True
            if time.monotonic() - started >= timeout:
                _terminate_process(proc)
                stdout, stderr = proc.communicate()
                return subprocess.CompletedProcess(cmd, 124, stdout, stderr)

            signal_payload = _load_json_object(request_dir / "completion-signal.json")
            signal_status = str(signal_payload.get("status") or "")
            if signal_status in {"blocked", "timed_out", "failed"} or bool(signal_payload.get("login_wall")) or bool(signal_payload.get("challenge_wall")):
                _terminate_process(proc)
                stdout, stderr = proc.communicate()
                reason = str(signal_payload.get("reason") or signal_status or "browser_agent_blocked_signal")
                rc = 124 if signal_status == "timed_out" else 1
                stderr = (
                    (stderr or "")
                    + "\n"
                    + f"chatgpt_wrapper_completion_signal_{signal_status or 'blocked'}: {reason}"
                ).strip()
                return subprocess.CompletedProcess(cmd, rc, stdout, stderr)

            final_snapshot = _final_artifact_snapshot(request_dir)
            if bool(final_snapshot.get("ok")):
                now = time.monotonic()
                if first_final_artifact_at is None:
                    first_final_artifact_at = now
                if now - first_final_artifact_at >= max(0, final_artifact_grace_seconds):
                    _terminate_process(proc)
                    stdout, stderr = proc.communicate()
                    _write_final_artifact_watchdog(
                        request_dir,
                        started_at=started,
                        first_ready_at=first_final_artifact_at,
                        snapshot=final_snapshot,
                    )
                    text = str(final_snapshot.get("text") or "").strip()
                    stderr = (
                        (stderr or "")
                        + "\n"
                        + "chatgpt_wrapper_final_artifact_watchdog: wrapper terminated after final artifact"
                    ).strip()
                    return subprocess.CompletedProcess(cmd, 0, (stdout or text), stderr)
            else:
                first_final_artifact_at = None

            cdp_url = _request_cdp_url(request_dir)
            if not cdp_url:
                first_unreachable_at = None
                continue
            if _cdp_reachable(cdp_url):
                first_unreachable_at = None
                continue
            now = time.monotonic()
            if first_unreachable_at is None:
                first_unreachable_at = now
                continue
            if now - first_unreachable_at >= cdp_stall_seconds:
                _terminate_process(proc)
                stdout, stderr = proc.communicate()
                message = (
                    f"chatgpt_cdp_unreachable_stall:cdp_url={cdp_url}:"
                    f"stall_seconds={int(now - first_unreachable_at)}"
                )
                stderr = ((stderr or "") + "\n" + message).strip()
                return subprocess.CompletedProcess(cmd, 124, stdout, stderr)


def _load_json_object(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _slug(value: str) -> str:
    import re

    text = re.sub(r"[^a-zA-Z0-9._-]+", "-", str(value or "").strip())
    return text.strip("-._").lower() or "task"


def _wrapper_task_id(*, task_dir: Path, request_dir: Path) -> str:
    explicit = str(os.environ.get("TASK_ID") or "").strip()
    if explicit and explicit != "chatgpt-browser-agent-request":
        return explicit
    queue_job = str(os.environ.get("BROWSER_AGENT_QUEUE_JOB_ID") or "").strip()
    solar_task = str(os.environ.get("SOLAR_TASK_ID") or "").strip()
    seed = queue_job or solar_task or task_dir.name or "chatgpt"
    digest = hashlib.sha256(str(request_dir.resolve()).encode("utf-8")).hexdigest()[:12]
    return f"chatgpt-{_slug(seed)}-{digest}"


def _release_profile_lease_from_runtime(request_dir: Path, *, reason: str) -> dict[str, Any]:
    runtime = _load_json_object(request_dir / "runtime.json")
    profile_id = str(runtime.get("profile_id") or "").strip()
    lease = runtime.get("lease") if isinstance(runtime.get("lease"), dict) else {}
    task_id = str((lease or {}).get("task_id") or "").strip()
    payload: dict[str, Any] = {
        "attempted": bool(profile_id and task_id),
        "reason": reason,
        "profile_id": profile_id,
        "task_id": task_id,
    }
    if profile_id and task_id:
        try:
            payload["release"] = ProfileLease().release(profile_id, task_id)
        except Exception as exc:  # pragma: no cover - defensive cleanup path
            payload["release_error_type"] = type(exc).__name__
            payload["release_error"] = str(exc)
    try:
        (request_dir / "browser-profile-lease-release-after-wrapper-failure.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except Exception:
        pass
    return payload


def _seconds_until_iso(value: str, *, fallback: int = 30) -> int:
    raw = str(value or "").strip()
    if not raw:
        return fallback
    try:
        import datetime as dt

        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        target = dt.datetime.fromisoformat(raw).astimezone(dt.timezone.utc)
        return max(0, int((target - dt.datetime.now(dt.timezone.utc)).total_seconds()))
    except Exception:
        return fallback


def _chatgpt_profile_id(env: dict[str, str]) -> str:
    account = str(
        env.get("BROWSER_AGENT_TARGET_ACCOUNT_EMAIL")
        or env.get("BROWSER_AGENT_CHATGPT_ACCOUNT_EMAIL")
        or ""
    ).strip()
    profile_directory = str(env.get("BROWSER_AGENT_PROFILE_DIRECTORY") or "").strip()
    account_label = account.split("@", 1)[0] if account else None
    return default_profile_id(
        "chatgpt",
        account_label=account_label,
        profile_directory=profile_directory or None,
    )


def _active_profile_lease(profile_id: str) -> dict[str, Any]:
    for item in ProfileLease().list_active():
        if str(item.get("profile_id") or "") == profile_id:
            return item
    return {}


def _wait_for_profile_lease(
    request: dict[str, Any],
    *,
    env: dict[str, str],
    task_dir: Path,
) -> None:
    wait_seconds = ofc.int_value(
        request.get("profile_lease_wait_seconds")
        or os.environ.get("BROWSER_AGENT_CHATGPT_PROFILE_LEASE_WAIT_SECONDS"),
        0,
    )
    if wait_seconds <= 0:
        return
    profile_id = _chatgpt_profile_id(env)
    started = time.monotonic()
    waits: list[dict[str, Any]] = []
    while True:
        active = _active_profile_lease(profile_id)
        if not active:
            (task_dir / "browser-profile-lease-wait.json").write_text(
                json.dumps(
                    {
                        "ok": True,
                        "profile_id": profile_id,
                        "waited_seconds": round(time.monotonic() - started, 3),
                        "waits": waits,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            return
        elapsed = time.monotonic() - started
        remaining = wait_seconds - elapsed
        if remaining <= 0:
            raise RuntimeError(
                "browser_profile_lease_wait_timeout:"
                + json.dumps(
                    {
                        "profile_id": profile_id,
                        "waited_seconds": round(elapsed, 3),
                        "active_lease": active,
                    },
                    ensure_ascii=False,
                )
            )
        sleep_s = min(
            int(max(1, remaining)),
            ofc.int_value(
                request.get("profile_lease_wait_poll_seconds")
                or os.environ.get("BROWSER_AGENT_CHATGPT_PROFILE_LEASE_WAIT_POLL_SECONDS"),
                60,
            ),
            max(1, _seconds_until_iso(str(active.get("expires_at") or ""), fallback=30) + 1),
        )
        waits.append(
            {
                "profile_id": profile_id,
                "held_by": active.get("task_id"),
                "expires_at": active.get("expires_at"),
                "sleep_seconds": sleep_s,
            }
        )
        (task_dir / "browser-profile-lease-wait.json").write_text(
            json.dumps(
                {
                    "ok": False,
                    "status": "waiting",
                    "profile_id": profile_id,
                    "waited_seconds": round(elapsed, 3),
                    "active_lease": active,
                    "next_sleep_seconds": sleep_s,
                    "waits": waits[-20:],
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        time.sleep(sleep_s)


def _validate_final_response_state(request: dict[str, Any], request_dir: Path, text: str) -> None:
    min_chars = ofc.int_value(
        request.get("min_output_chars")
        or os.environ.get("BROWSER_AGENT_CHATGPT_MIN_OUTPUT_CHARS"),
        0,
    )
    if min_chars <= 0 or len(text) >= min_chars:
        return
    post_submit = _load_json_object(request_dir / "post-submit-state.json")
    if not post_submit:
        return
    if bool(post_submit.get("is_generating")):
        raise RuntimeError(
            "ChatGPT browser-agent captured incomplete output while generation was still active: "
            f"chars={len(text)} min_output_chars={min_chars}"
        )


def run_request(request: dict[str, Any], *, task_dir: Path) -> dict[str, Any]:
    prompt = str(request.get("prompt") or "").strip()
    if not prompt:
        raise RuntimeError("ChatGPT browser-agent operator requires prompt")
    cmd = _wrapper_cmd()
    if not cmd:
        raise RuntimeError("ChatGPT browser-agent wrapper command is not configured")
    task_dir.mkdir(parents=True, exist_ok=True)
    request_dir = Path(str(request.get("request_dir") or (task_dir / "chatgpt-browser-agent-request"))).expanduser()
    request_dir.mkdir(parents=True, exist_ok=True)
    (task_dir / "chatgpt-browser-agent-request.json").write_text(
        json.dumps(request, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    env = os.environ.copy()
    project_name = str(request.get("project_name") or DEFAULT_PROJECT_NAME).strip()
    require_project = bool(request.get("require_project", bool(project_name)))
    env.update(
        {
            "BROWSER_AGENT_REQUEST_DIR": str(request_dir),
            "BROWSER_AGENT_EXPECTED_OUTPUT": str(request.get("expected_output") or "markdown"),
            "BROWSER_AGENT_CHATGPT_MIN_ANSWER_CHARS": str(request.get("min_output_chars") or "0"),
            "BROWSER_AGENT_CHATGPT_MIN_OUTPUT_CHARS": str(request.get("min_output_chars") or "0"),
            "CHATGPT_MODEL": str(request.get("model") or "chatgpt-5.5"),
            "CHATGPT_REASONING_EFFORT": str(request.get("reasoning_effort") or "high"),
            "BROWSER_AGENT_CHATGPT_MODEL_MODE": str(request.get("model_mode") or "thinking"),
            "BROWSER_AGENT_CHATGPT_TOOL_MODE": str(request.get("tool_mode") or "none"),
            "BROWSER_AGENT_CHATGPT_REQUIRE_UI_MODE": "true"
            if bool(request.get("require_ui_mode", True))
            else "false",
            "BROWSER_AGENT_CHATGPT_REQUIRE_DEEP_RESEARCH": "true"
            if bool(request.get("require_deep_research", False))
            else "false",
            "BROWSER_AGENT_CHATGPT_ACTION": str(request.get("action") or "run"),
            "BROWSER_AGENT_CHATGPT_OPEN_PROJECT_FIRST": "true"
            if bool(request.get("open_project_first", False))
            else "false",
            "BROWSER_AGENT_CHATGPT_REQUIRE_PROJECT": "true" if require_project else "false",
        }
    )
    if project_name:
        env["BROWSER_AGENT_CHATGPT_PROJECT_NAME"] = project_name
    account_email = str(request.get("account_email") or "").strip()
    if account_email:
        env["BROWSER_AGENT_CHATGPT_ACCOUNT_EMAIL"] = account_email
        env["BROWSER_AGENT_TARGET_ACCOUNT_EMAIL"] = account_email
    profile_policy = apply_profile_policy(env, request)
    (task_dir / "chatgpt-browser-agent-profile-policy.json").write_text(
        json.dumps(profile_policy, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    _wait_for_profile_lease(request, env=env, task_dir=task_dir)
    timeout = ofc.int_value(request.get("timeout_seconds") or os.environ.get("BROWSER_AGENT_CHATGPT_TIMEOUT"), 1800)
    env["BROWSER_AGENT_CHATGPT_TIMEOUT"] = str(timeout)
    ready_timeout = request.get("ready_timeout_seconds")
    if ready_timeout is not None:
        env["BROWSER_AGENT_CHATGPT_READY_TIMEOUT"] = str(ofc.int_value(ready_timeout, 90))
    new_chat_timeout = request.get("new_chat_timeout_seconds")
    if new_chat_timeout is not None:
        env["BROWSER_AGENT_CHATGPT_NEW_CHAT_TIMEOUT"] = str(ofc.int_value(new_chat_timeout, 45))
    env["TASK_ID"] = _wrapper_task_id(task_dir=task_dir, request_dir=request_dir)
    proc = _run_wrapper_with_watchdog(
        cmd,
        env=env,
        timeout=timeout,
        prompt=prompt,
        request_dir=request_dir,
    )
    combined = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
    (task_dir / "chatgpt-browser-agent-output.txt").write_text(
        combined + ("\n" if combined else ""),
        encoding="utf-8",
    )
    if proc.returncode != 0:
        _release_profile_lease_from_runtime(request_dir, reason=f"wrapper_rc_{proc.returncode}")
        raise RuntimeError(f"ChatGPT browser-agent failed rc={proc.returncode}: {combined[-1000:]}")
    text = str(proc.stdout or "").strip()
    if not text:
        final_snapshot = _final_artifact_snapshot(request_dir)
        if bool(final_snapshot.get("ok")):
            text = str(final_snapshot.get("text") or "").strip()
    if not text:
        raise RuntimeError("ChatGPT browser-agent returned empty output")
    _validate_final_response_state(request, request_dir, text)
    result = {
        "ok": True,
        "model": str(request.get("model") or "chatgpt-5.5"),
        "project_name": project_name or "N/A",
        "expected_output": str(request.get("expected_output") or "markdown"),
        "request_dir": str(request_dir),
        "text": text,
    }
    (task_dir / "chatgpt-browser-agent-result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(_summary_markdown(result))
    return result


def main() -> int:
    envelope = _load_envelope()
    task_dir = _task_dir()
    queued_rc = enqueue_current_process_if_needed(job_name=_operator_id(envelope), repo_root=ROOT, cwd=task_dir)
    if queued_rc is not None:
        return queued_rc
    ofc.clear_task_control(task_dir)
    request = build_request(envelope, task_dir=task_dir)
    rate_control = _rate_control_settings(envelope)
    operator_id = str(rate_control["operator_id"])
    try:
        ofc.ensure_operator_available(operator_id)
        run_request(request, task_dir=task_dir)
        ofc.apply_success_cooldown(
            operator_id,
            success_cooldown_seconds=int(rate_control.get("success_cooldown_seconds") or 0),
        )
        return 0
    except Exception as exc:
        ofc.apply_failure_flow_control(
            task_dir,
            operator_id=operator_id,
            failure_text=str(exc),
            rate_limit_cooldown_seconds=int(rate_control.get("rate_limit_cooldown_seconds") or 0),
            auth_cooldown_seconds=int(rate_control.get("auth_cooldown_seconds") or 0),
            defer_on_cooldown=bool(rate_control.get("defer_on_cooldown")),
            defer_on_auth=bool(rate_control.get("defer_on_auth")),
        )
        print(f"chatgpt_browser_agent_task_operator failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
