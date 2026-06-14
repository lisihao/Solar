"""Shared browser-agent profile/account policy enforcement.

The browser-agent wrappers must all resolve to the same persisted Chrome
profile contract before launching browser-use.  This helper keeps the policy
logic out of individual wrappers so alternate entrypoints cannot drift.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Mapping, MutableMapping


DEFAULT_POLICY_PATH = Path.home() / ".solar" / "harness" / "browser-agent-chatgpt-local.json"
DEFAULT_USER_DATA_DIR = Path.home() / "Library" / "Application Support" / "Google" / "Chrome"
VALID_PROFILE_STRATEGIES = {"", "persistent", "isolated"}

SERVICE_ENV_PREFIX = {
    "chatgpt": "CHATGPT",
    "gemini": "GEMINI",
    "youtube": "YOUTUBE",
    "notebooklm": "NOTEBOOKLM",
}

SERVICE_ACCOUNT_ENV = {
    "chatgpt": [
        "BROWSER_AGENT_CHATGPT_ACCOUNT_EMAIL",
        "BROWSER_AGENT_TARGET_ACCOUNT_EMAIL",
        "BROWSER_AGENT_TARGET_EMAIL",
    ],
    "gemini": [
        "BROWSER_AGENT_GEMINI_ACCOUNT_EMAIL",
        "BROWSER_AGENT_TARGET_ACCOUNT_EMAIL",
    ],
    "youtube": [
        "BROWSER_AGENT_YOUTUBE_ACCOUNT_EMAIL",
        "BROWSER_AGENT_TARGET_ACCOUNT_EMAIL",
    ],
    "notebooklm": [
        "BROWSER_AGENT_NOTEBOOKLM_ACCOUNT_EMAIL",
        "BROWSER_AGENT_TARGET_ACCOUNT_EMAIL",
    ],
}


def _truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _service_prefix(service: str) -> str:
    return SERVICE_ENV_PREFIX.get(service.lower(), service.upper().replace("-", "_"))


def _env_disabled(env: Mapping[str, str], service: str) -> bool:
    prefix = _service_prefix(service)
    return any(
        _truthy(str(env.get(name) or ""))
        for name in (
            f"BROWSER_AGENT_{prefix}_PROFILE_POLICY_DISABLED",
            "BROWSER_AGENT_PROFILE_POLICY_DISABLED",
        )
    )


def profile_policy_path(env: Mapping[str, str], service: str) -> Path | None:
    prefix = _service_prefix(service)
    raw = str(
        env.get(f"BROWSER_AGENT_{prefix}_PROFILE_POLICY_FILE")
        or env.get("BROWSER_AGENT_PROFILE_POLICY_FILE")
        or env.get("BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE")
        or env.get("TECH_HOTSPOT_BROWSER_CHATGPT_PROFILE_POLICY_FILE")
        or ""
    ).strip()
    if raw:
        return Path(raw).expanduser()
    return DEFAULT_POLICY_PATH if DEFAULT_POLICY_PATH.exists() else None


def _account_from_policy(policy: Mapping[str, Any]) -> str:
    for key in ("expected_account_email", "selected_account_email", "target_account_email", "account_email"):
        value = str(policy.get(key) or "").strip()
        if value:
            return value
    allowed = policy.get("allowed_account_identifiers")
    if isinstance(allowed, list):
        for item in allowed:
            value = str(item or "").strip()
            if "@" in value:
                return value
    return ""


def _policy_key(env: Mapping[str, str], service: str, purpose: str = "") -> str:
    prefix = _service_prefix(service)
    explicit = str(
        env.get(f"BROWSER_AGENT_{prefix}_PROFILE_POLICY_KEY")
        or env.get("BROWSER_AGENT_PROFILE_POLICY_KEY")
        or ""
    ).strip()
    if explicit:
        return explicit
    lowered = purpose.lower()
    if service == "gemini" and ("deep" in lowered or "research" in lowered):
        return "gemini_deep_research"
    if service == "youtube" or "youtube" in lowered:
        return "youtube_transcript"
    if service == "notebooklm" or "notebooklm" in lowered:
        return "notebooklm"
    if service == "chatgpt" and ("diagram" in lowered or "painter" in lowered):
        return "technology_diagram"
    return "default"


def _load_policy(env: Mapping[str, str], service: str, purpose: str) -> tuple[Path, str, Mapping[str, Any], Mapping[str, Any]]:
    path = profile_policy_path(env, service)
    if path is None:
        raise RuntimeError(f"browser_agent_profile_policy_missing_file:service={service}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"browser_agent_profile_policy_load_failed:{path}:{type(exc).__name__}:{exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"browser_agent_profile_policy_invalid:{path}:root_not_object")
    policies = data.get("policies") if isinstance(data.get("policies"), dict) else {}
    key = _policy_key(env, service, purpose)
    policy = policies.get(key) if isinstance(policies.get(key), dict) else None
    if policy is None:
        policy = policies.get("default") if isinstance(policies.get("default"), dict) else data
        key = "default" if isinstance(policies.get("default"), dict) else key
    if not isinstance(policy, dict):
        raise RuntimeError(f"browser_agent_profile_policy_missing:{path}:{service}:{key}")
    return path, key, policy, policies


def select_profile_policy(
    *,
    service: str,
    purpose: str = "",
    env: Mapping[str, str] | None = None,
    default_profile_directory: str = "Default",
    default_user_data_dir: Path | str = DEFAULT_USER_DATA_DIR,
) -> dict[str, Any]:
    source = env if env is not None else os.environ
    service = service.lower()
    if _env_disabled(source, service):
        return {
            "enabled": False,
            "reason": "disabled_by_env",
            "selected_profile_directory": str(source.get("BROWSER_AGENT_PROFILE_DIRECTORY") or default_profile_directory),
            "selected_account_email": "",
            "user_data_dir": str(source.get("BROWSER_AGENT_USER_DATA_DIR") or default_user_data_dir),
        }

    path, key, policy, _policies = _load_policy(source, service, purpose)
    prefix = _service_prefix(service)
    allowed_profiles = [str(item).strip() for item in (policy.get("allowed_profiles") or []) if str(item).strip()]
    explicit_profile = str(
        source.get(f"BROWSER_AGENT_{prefix}_PROFILE_DIRECTORY")
        or source.get("BROWSER_AGENT_PROFILE_DIRECTORY")
        or ""
    ).strip()
    if explicit_profile:
        if allowed_profiles and explicit_profile not in allowed_profiles:
            raise RuntimeError(
                "browser_agent_profile_policy_profile_mismatch:"
                f"service={service}:profile={explicit_profile}:allowed={','.join(allowed_profiles)}"
            )
        selected_profile = explicit_profile
    elif allowed_profiles:
        selected_profile = allowed_profiles[0]
    else:
        selected_profile = default_profile_directory

    account_email = _account_from_policy(policy)
    for env_name in SERVICE_ACCOUNT_ENV.get(service, ["BROWSER_AGENT_TARGET_ACCOUNT_EMAIL"]):
        explicit_account = str(source.get(env_name) or "").strip()
        if explicit_account and account_email and explicit_account.lower() != account_email.lower():
            raise RuntimeError(
                "browser_agent_profile_policy_account_mismatch:"
                f"service={service}:env={env_name}:account={explicit_account}:expected={account_email}"
            )

    user_data_dir = str(
        source.get(f"BROWSER_AGENT_{prefix}_USER_DATA_DIR")
        or source.get("BROWSER_AGENT_USER_DATA_DIR")
        or policy.get("user_data_dir")
        or default_user_data_dir
    ).strip()
    profile_strategy = str(policy.get("profile_strategy") or "").strip().lower()
    if profile_strategy not in VALID_PROFILE_STRATEGIES:
        raise RuntimeError(f"browser_agent_profile_policy_invalid_strategy:{service}:{profile_strategy}")
    return {
        "enabled": True,
        "service": service,
        "purpose": purpose,
        "policy_path": str(path),
        "policy_key": key,
        "selected_profile_directory": selected_profile,
        "selected_account_email": account_email,
        "allowed_profiles": allowed_profiles,
        "allow_headless": bool(policy.get("allow_headless", True)),
        "force_headed": bool(policy.get("force_headed", False)),
        "allow_default_profile": bool(policy.get("allow_default_profile", False)),
        "scrub_client_state": policy.get("scrub_client_state"),
        "profile_strategy": profile_strategy,
        "user_data_dir": user_data_dir,
    }


def apply_profile_policy_to_env(
    env: MutableMapping[str, str],
    *,
    service: str,
    purpose: str = "",
    default_profile_directory: str = "Default",
    default_user_data_dir: Path | str = DEFAULT_USER_DATA_DIR,
) -> dict[str, Any]:
    policy = select_profile_policy(
        service=service,
        purpose=purpose,
        env=env,
        default_profile_directory=default_profile_directory,
        default_user_data_dir=default_user_data_dir,
    )
    profile = str(policy.get("selected_profile_directory") or default_profile_directory)
    user_data_dir = str(policy.get("user_data_dir") or default_user_data_dir)
    account = str(policy.get("selected_account_email") or "").strip()
    env["BROWSER_AGENT_PROFILE_DIRECTORY"] = profile
    env["BROWSER_AGENT_USER_DATA_DIR"] = user_data_dir
    if account:
        for env_name in SERVICE_ACCOUNT_ENV.get(service.lower(), ["BROWSER_AGENT_TARGET_ACCOUNT_EMAIL"]):
            env[env_name] = account
    if policy.get("force_headed") or not bool(policy.get("allow_headless", True)):
        env["BROWSER_AGENT_HEADLESS"] = "false"
    env["BROWSER_AGENT_PROFILE_POLICY_KEY"] = str(policy.get("policy_key") or "")
    return policy
