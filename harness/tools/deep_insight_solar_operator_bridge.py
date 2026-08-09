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
import re
import subprocess
import sys
import time
import datetime as dt
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "lib") not in sys.path:
    sys.path.insert(0, str(ROOT / "lib"))

import operator_flow_control as ofc  # noqa: E402

CHATGPT_OPERATOR = ROOT / "tools" / "chatgpt_browser_agent_task_operator.py"
DIAGRAM_OPERATOR = ROOT / "tools" / "technology_diagram_painter_operator.py"
RUN_ROOT = Path(os.environ.get("DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT") or ROOT / "run" / "deep-insight-solar")
DEFAULT_ACCOUNT_EMAIL = "lisihao@gmail.com"
DEFAULT_PROFILE_DIRECTORY = "Profile 2"
# Keep the GenesisPod queue independent, but use the same proven ChatGPT
# browser profile family as AI Influence unless an operator explicitly overrides
# it. A separate queue does not prove a separate Chrome profile is logged in.
DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY = os.environ.get(
    "DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY",
    "deep_insight_solar",
)
TECHNOLOGY_DIAGRAM_PROFILE_POLICY_KEY = "technology_diagram"
DEFAULT_PROFILE_POLICY_PATH = Path.home() / ".solar" / "harness" / "browser-agent-chatgpt-local.json"
DEFAULT_GENESISPOD_QUEUE_DIR = Path.home() / ".solar" / "harness" / "state" / "browser-agent-queue-genesispod"
RESEARCH_OS_SCHEMA_VERSION = "deep-insight-solar.research-os.v1"
AUTH_REPAIR_REQUIRED_CODE = "AUTH_REPAIR_REQUIRED"
FLOW_CONTROL_COOLDOWN_CODE = "FLOW_CONTROL_COOLDOWN"
RESEARCH_OS_ASSET_TYPES = [
    "evidenceCard",
    "evolutionEvent",
    "stackNode",
    "interfaceEdge",
    "actorCard",
    "sotaFinding",
    "bottleneckCard",
    "contradiction",
    "weakSignal",
    "opportunityHypothesis",
]

CHATGPT_OPERATOR_IDS = {
    "BrowserLeaderPlanner": "deep-insight-solar-leader-planner",
    "BrowserResearcher": "deep-insight-solar-researcher",
    "BrowserAnalyst": "deep-insight-solar-analyst",
    "BrowserLongformWriter": "deep-insight-solar-longform-writer",
    "BrowserCritic": "deep-insight-solar-critic",
}

CHATGPT_BROWSER_PROVIDER = "chatgpt_browser"
DEEPSEEK_API_PROVIDER = "deepseek_api"
OPENAI_COMPATIBLE_PROVIDER = "openai_compatible"

# Research OS provider routing:
# - S2/S6/S8/S9 are high-cognition stages and default to the shared ChatGPT
#   browser-agent path. That preserves the Solar "strong model operator" line
#   instead of silently degrading to local or weak fallback models.
# - S3 is a serial workstream asset collector; default it to DeepSeek Pro to
#   avoid multiplying browser queue leases while keeping repair/fallback strong.
# - The local openai-compatible surface is intentionally not a main-chain
#   provider here; ThunderOMLX is reserved for embedding/local utility work.
DEFAULT_OPERATOR_PROVIDERS = {
    "BrowserLeaderPlanner": CHATGPT_BROWSER_PROVIDER,
    "BrowserResearcher": DEEPSEEK_API_PROVIDER,
    "BrowserAnalyst": CHATGPT_BROWSER_PROVIDER,
    "BrowserLongformWriter": CHATGPT_BROWSER_PROVIDER,
    "BrowserCritic": CHATGPT_BROWSER_PROVIDER,
}

# Tuned from queue-path runtime samples on 2026-06-20.  The GenesisPod queue
# still serializes browser use; these per-operator cooldowns prevent repeated
# high-cognition stages from immediately reusing the same ChatGPT account.
CHATGPT_SUCCESS_COOLDOWN_SECONDS = {
    "BrowserLeaderPlanner": 180,
    "BrowserResearcher": 600,
    "BrowserAnalyst": 420,
    "BrowserLongformWriter": 600,
    "BrowserCritic": 300,
}


class AuthRepairRequired(RuntimeError):
    """Raised when queue-path browser auth artifacts prove ChatGPT is not usable."""


class FlowControlCooldown(RuntimeError):
    """Raised when browser-agent flow control asks the caller to retry later."""


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


def _env_truthy(name: str) -> bool:
    return str(os.environ.get(name) or "").strip().lower() in {"1", "true", "yes", "on"}


def _account_email() -> str:
    if not _env_truthy("DEEP_INSIGHT_SOLAR_ALLOW_ACCOUNT_OVERRIDE"):
        return DEFAULT_ACCOUNT_EMAIL
    return (
        os.environ.get("GENESISPOD_SOLAR_CHATGPT_ACCOUNT_EMAIL")
        or os.environ.get("BROWSER_AGENT_CHATGPT_ACCOUNT_EMAIL")
        or os.environ.get("BROWSER_AGENT_TARGET_ACCOUNT_EMAIL")
        or DEFAULT_ACCOUNT_EMAIL
    ).strip()


def _profile_directory() -> str:
    if not _env_truthy("DEEP_INSIGHT_SOLAR_ALLOW_PROFILE_OVERRIDE"):
        return DEFAULT_PROFILE_DIRECTORY
    return str(os.environ.get("DEEP_INSIGHT_SOLAR_PROFILE_DIRECTORY") or DEFAULT_PROFILE_DIRECTORY).strip()


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


def _operator_env_key(operator_id: str) -> str:
    return re.sub(r"(?<!^)([A-Z])", r"_\1", operator_id).upper()


def _parse_provider_map(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}
    text = raw.strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except Exception:
        parsed = None
    if isinstance(parsed, dict):
        return {
            str(key).strip(): str(value).strip().lower()
            for key, value in parsed.items()
            if str(key).strip() and str(value).strip()
        }
    result: dict[str, str] = {}
    for part in re.split(r"[,;\n]+", text):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        key = key.strip()
        value = value.strip().lower()
        if key and value:
            result[key] = value
    return result


def _provider_for_operator(operator_id: str) -> str:
    compact_key = operator_id.upper()
    snake_key = _operator_env_key(operator_id)
    explicit = (
        os.environ.get(f"DEEP_INSIGHT_SOLAR_PROVIDER_{snake_key}")
        or os.environ.get(f"DEEP_INSIGHT_SOLAR_PROVIDER_{compact_key}")
    )
    if explicit:
        return explicit.strip().lower()
    provider_map = _parse_provider_map(os.environ.get("DEEP_INSIGHT_SOLAR_OPERATOR_PROVIDER_MAP"))
    mapped = provider_map.get(operator_id) or provider_map.get(snake_key) or provider_map.get(compact_key)
    if mapped:
        return mapped.strip().lower()
    return DEFAULT_OPERATOR_PROVIDERS.get(operator_id, CHATGPT_BROWSER_PROVIDER)


def _load_text_file(path: Path) -> str:
    try:
        return path.expanduser().read_text(encoding="utf-8").strip()
    except Exception:
        return ""


def _deepseek_api_key() -> str:
    value = (
        os.environ.get("DEEP_INSIGHT_SOLAR_DEEPSEEK_API_KEY")
        or os.environ.get("DEEPSEEK_API_KEY")
        or os.environ.get("DEEPSEEK_AUTH_TOKEN")
        or ""
    ).strip()
    if value:
        return value
    key_file = (
        os.environ.get("DEEP_INSIGHT_SOLAR_DEEPSEEK_API_KEY_FILE")
        or os.environ.get("DEEPSEEK_API_KEY_FILE")
        or str(Path.home() / ".config" / "llm-keys" / "deepseek")
    )
    return _load_text_file(Path(key_file))


def _normalize_openai_base_url(base_url: str) -> str:
    base = str(base_url or "").strip().rstrip("/")
    if base.endswith("/anthropic"):
        base = base[: -len("/anthropic")]
    return base or "https://api.deepseek.com"


def _openai_chat_completions_url(base_url: str) -> str:
    base = _normalize_openai_base_url(base_url)
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def _api_provider_config(provider: str) -> dict[str, Any]:
    if provider == DEEPSEEK_API_PROVIDER:
        base_url = (
            os.environ.get("DEEP_INSIGHT_SOLAR_DEEPSEEK_BASE_URL")
            or os.environ.get("DEEPSEEK_OPENAI_BASE_URL")
            or os.environ.get("DEEPSEEK_BASE_URL")
            or "https://api.deepseek.com"
        )
        model = (
            os.environ.get("DEEP_INSIGHT_SOLAR_DEEPSEEK_MODEL")
            or os.environ.get("DEEPSEEK_CHAT_MODEL")
            or os.environ.get("DEEPSEEK_MODEL")
            or "deepseek-v4-pro"
        )
        api_key = _deepseek_api_key()
        if not api_key:
            raise RuntimeError(
                "deepseek_api_key_missing:"
                " set DEEP_INSIGHT_SOLAR_DEEPSEEK_API_KEY, DEEPSEEK_API_KEY,"
                " or ~/.config/llm-keys/deepseek"
            )
        return {
            "provider": provider,
            "base_url": _normalize_openai_base_url(base_url),
            "model": model,
            "api_key": api_key,
            "timeout": _int_env("DEEP_INSIGHT_SOLAR_DEEPSEEK_TIMEOUT_SECONDS", 900),
        }
    if provider == OPENAI_COMPATIBLE_PROVIDER:
        base_url = (
            os.environ.get("DEEP_INSIGHT_SOLAR_OPENAI_COMPATIBLE_BASE_URL")
            or os.environ.get("LOCAL_LLM_BASE_URL")
            or "http://127.0.0.1:8002"
        )
        model = (
            os.environ.get("DEEP_INSIGHT_SOLAR_OPENAI_COMPATIBLE_MODEL")
            or os.environ.get("LOCAL_LLM_MODEL")
            or "Qwen3.6-35b-a3b"
        )
        api_key = (
            os.environ.get("DEEP_INSIGHT_SOLAR_OPENAI_COMPATIBLE_API_KEY")
            or os.environ.get("LOCAL_LLM_API_KEY")
            or os.environ.get("THUNDEROMLX_AUTH_TOKEN")
            or "local-thunderomlx"
        )
        return {
            "provider": provider,
            "base_url": _normalize_openai_base_url(base_url),
            "model": model,
            "api_key": api_key,
            "timeout": _int_env("DEEP_INSIGHT_SOLAR_OPENAI_COMPATIBLE_TIMEOUT_SECONDS", 900),
        }
    raise RuntimeError(f"unsupported_provider:{provider}")


def _provider_env_diagnostics() -> dict[str, Any]:
    """Non-secret diagnostics proving whether GenesisPod injected model env."""
    return {
        "modelEnvSource": os.environ.get("GENESISPOD_SOLAR_MODEL_ENV_SOURCE") or "N/A",
        "modelEnvUserIdPresent": os.environ.get("GENESISPOD_SOLAR_MODEL_ENV_USER_ID_PRESENT") or "0",
        "modelEnvModelId": os.environ.get("GENESISPOD_SOLAR_MODEL_ENV_MODEL_ID") or "N/A",
        "modelEnvProvider": os.environ.get("GENESISPOD_SOLAR_MODEL_ENV_PROVIDER") or "N/A",
        "modelEnvApiKeyPresent": os.environ.get("GENESISPOD_SOLAR_MODEL_ENV_API_KEY_PRESENT") or "0",
    }


def _base_payload(request: dict[str, Any]) -> dict[str, Any]:
    payload = request.get("payload")
    return payload if isinstance(payload, dict) else {"payload": payload}


def _truncate_text(value: Any, *, max_chars: int) -> str:
    text = str(value or "").strip()
    if max_chars <= 0 or len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "\n...[truncated for planner budget]..."


def _compact_prior_postmortems(value: Any, *, max_items: int = 2, max_chars: int = 800) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    compacted: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        summary_text = str(item.get("summary") or "").strip()
        recommendations_raw = item.get("recommendations") if isinstance(item.get("recommendations"), list) else []
        useful_recommendations = [
            str(rec).strip()
            for rec in recommendations_raw
            if str(rec or "").strip()
            and "健康（null/100）" not in str(rec)
            and "baseline reference" not in str(rec).lower()
        ][:3]
        quality_score = item.get("qualityScore")
        leader_signed = item.get("leaderSigned")
        has_quality_signal = isinstance(quality_score, (int, float))
        has_failure_signal = (
            leader_signed is False
            and summary_text
            and "失败模式：unknown" not in summary_text
            and "健康（null/100）" not in summary_text
        )
        if not has_quality_signal and not has_failure_signal and not useful_recommendations:
            continue
        compacted.append(
            {
                "missionId": item.get("missionId"),
                "qualityScore": quality_score if has_quality_signal else None,
                "leaderSigned": leader_signed if isinstance(leader_signed, bool) else None,
                "summary": _truncate_text(summary_text, max_chars=max_chars),
                "recommendations": [
                    _truncate_text(rec, max_chars=300)
                    for rec in useful_recommendations
                ],
            }
        )
        if len(compacted) >= max_items:
            break
    return compacted


def _compact_string_list(value: Any, *, max_items: int = 20, max_chars: int = 500) -> list[str]:
    if not isinstance(value, list):
        return []
    return [
        _truncate_text(item, max_chars=max_chars)
        for item in value[:max_items]
        if str(item or "").strip()
    ]


def _compact_records(
    value: Any,
    *,
    fields: list[str],
    max_items: int = 20,
    max_string_chars: int = 700,
) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    compacted: list[dict[str, Any]] = []
    for item in value[:max_items]:
        if not isinstance(item, dict):
            continue
        record: dict[str, Any] = {}
        for field in fields:
            raw = item.get(field)
            if isinstance(raw, str):
                record[field] = _truncate_text(raw, max_chars=max_string_chars)
            elif isinstance(raw, list):
                record[field] = [
                    _truncate_text(entry, max_chars=180) if isinstance(entry, str) else entry
                    for entry in raw[:8]
                ]
            elif raw is not None:
                record[field] = raw
        if record:
            compacted.append(record)
    return compacted


def _compact_any(
    value: Any,
    *,
    max_string_chars: int = 1200,
    max_list_items: int = 30,
    max_dict_items: int = 40,
    depth: int = 0,
) -> Any:
    if isinstance(value, str):
        return _truncate_text(value, max_chars=max_string_chars)
    if isinstance(value, list):
        return [
            _compact_any(
                item,
                max_string_chars=max(240, max_string_chars // 2),
                max_list_items=min(8, max_list_items),
                max_dict_items=min(20, max_dict_items),
                depth=depth + 1,
            )
            for item in value[:max_list_items]
        ]
    if isinstance(value, dict):
        if depth >= 3:
            return {
                str(key): _truncate_text(raw, max_chars=240) if isinstance(raw, str) else raw
                for key, raw in list(value.items())[:max_dict_items]
            }
        return {
            str(key): _compact_any(
                raw,
                max_string_chars=max_string_chars,
                max_list_items=max_list_items,
                max_dict_items=max_dict_items,
                depth=depth + 1,
            )
            for key, raw in list(value.items())[:max_dict_items]
        }
    return value


def _compact_mapping(value: Any, *, max_string_chars: int = 1800) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    compacted = _compact_any(value, max_string_chars=max_string_chars)
    return compacted if isinstance(compacted, dict) else {}


def _compact_writer_brief_for_chatgpt(value: Any) -> dict[str, Any]:
    """Keep S8 browser prompt below UI paste limits without dropping argument shape."""
    if not isinstance(value, dict):
        return {}
    compact: dict[str, Any] = {}
    for key in (
        "workingTitle",
        "leadAngle",
        "oneSentenceThesis",
    ):
        if value.get(key):
            compact[key] = _truncate_text(value.get(key), max_chars=1200)
    for key in ("readerTakeaways", "nonConsensusAngles", "doNotOverstate"):
        items = _compact_string_list(value.get(key), max_items=8, max_chars=420)
        if items:
            compact[key] = items
    sections: list[dict[str, Any]] = []
    for item in (value.get("sections") if isinstance(value.get("sections"), list) else [])[:8]:
        if not isinstance(item, dict):
            continue
        section: dict[str, Any] = {}
        for key, max_chars in (
            ("heading", 160),
            ("coreClaim", 520),
            ("mechanism", 700),
            ("implication", 520),
            ("limitToPreserve", 420),
        ):
            if item.get(key):
                section[key] = _truncate_text(item.get(key), max_chars=max_chars)
        evidence: list[dict[str, Any]] = []
        for ev in (item.get("evidenceToUse") if isinstance(item.get("evidenceToUse"), list) else [])[:2]:
            if not isinstance(ev, dict):
                continue
            evidence.append(
                {
                    "sourceTitle": _truncate_text(ev.get("sourceTitle"), max_chars=180),
                    "url": _truncate_text(ev.get("url"), max_chars=220),
                    "fact": _truncate_text(ev.get("fact"), max_chars=420),
                }
            )
        if evidence:
            section["evidenceToUse"] = evidence
        if section:
            sections.append(section)
    if sections:
        compact["sections"] = sections
    hotspots: list[dict[str, Any]] = []
    for item in (value.get("investmentHotspotMap") if isinstance(value.get("investmentHotspotMap"), list) else [])[:6]:
        if not isinstance(item, dict):
            continue
        hotspots.append(
            {
                "hotspot": _truncate_text(item.get("hotspot"), max_chars=160),
                "technicalControlPoint": _truncate_text(item.get("technicalControlPoint"), max_chars=420),
                "whyCapitalCares": _truncate_text(item.get("whyCapitalCares"), max_chars=420),
                "whatWouldDisproveIt": _truncate_text(item.get("whatWouldDisproveIt"), max_chars=360),
                "representativeActors": _compact_string_list(item.get("representativeActors"), max_items=6, max_chars=120),
            }
        )
    if hotspots:
        compact["investmentHotspotMap"] = hotspots
    refs: list[dict[str, Any]] = []
    for item in (value.get("referenceCandidates") if isinstance(value.get("referenceCandidates"), list) else [])[:10]:
        if not isinstance(item, dict):
            continue
        refs.append(
            {
                "title": _truncate_text(item.get("title"), max_chars=180),
                "url": _truncate_text(item.get("url"), max_chars=220),
                "relevance": _truncate_text(item.get("relevance"), max_chars=280),
            }
        )
    if refs:
        compact["referenceCandidates"] = refs
    compact["_promptBudgetNote"] = "Compacted for browser UI transport; preserve claims, mechanisms, limits, evidence and investment taxonomy."
    return compact


def _compact_critic_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Keep S9 critic cognitive context high-signal without huge paste payloads."""
    max_report_chars = _int_env("DEEP_INSIGHT_SOLAR_CRITIC_REPORT_MAX_CHARS", 18000)
    report_package = payload.get("reportPackage") if isinstance(payload.get("reportPackage"), dict) else {}

    return {
        "artifactSummary": _compact_mapping(payload.get("artifactSummary"), max_string_chars=1600),
        "reportPackage": {
            "executiveBriefMarkdown": _truncate_text(
                report_package.get("executiveBriefMarkdown"),
                max_chars=3000,
            ),
            "standardReportMarkdown": _truncate_text(
                report_package.get("standardReportMarkdown"),
                max_chars=max_report_chars,
            ),
        },
    }


def _prompt_payload_for_chatgpt(request: dict[str, Any]) -> dict[str, Any]:
    payload = dict(_base_payload(request))
    operator_id = str(request.get("operatorId") or "")
    if operator_id == "BrowserLongformWriter":
        writer_brief = payload.get("writerBrief") if isinstance(payload.get("writerBrief"), dict) else {}
        return {
            "writerBrief": _compact_writer_brief_for_chatgpt(writer_brief),
            **({"instruction": payload.get("instruction")} if payload.get("instruction") else {}),
        }
    if operator_id == "BrowserCritic":
        return _compact_critic_payload(payload)
    if operator_id != "BrowserLeaderPlanner":
        return payload
    max_topic_chars = _int_env("DEEP_INSIGHT_SOLAR_PLANNER_TOPIC_MAX_CHARS", 6000)
    max_description_chars = _int_env("DEEP_INSIGHT_SOLAR_PLANNER_DESCRIPTION_MAX_CHARS", 2000)
    compact: dict[str, Any] = {
        "description": _truncate_text(payload.get("description"), max_chars=max_description_chars),
        "depth": payload.get("depth"),
        "language": payload.get("language"),
    }
    for key, max_chars in (
        ("instruction", 2000),
        ("repairDirective", 2400),
        ("previousInvalidOutputPreview", 1200),
    ):
        if payload.get(key):
            compact[key] = _truncate_text(payload.get(key), max_chars=max_chars)
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


def _genesispod_browser_agent_queue_dir() -> Path:
    raw = (
        os.environ.get("GENESISPOD_BROWSER_AGENT_QUEUE_DIR")
        or os.environ.get("DEEP_INSIGHT_SOLAR_BROWSER_AGENT_QUEUE_DIR")
        or ""
    ).strip()
    return Path(raw).expanduser() if raw else DEFAULT_GENESISPOD_QUEUE_DIR


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
    protected_policy_keys = {"deep_insight_solar", "hf_paper_insight", "github_trend_report", "ai_influence_report"}
    ignore_explicit_profile = policy_key in protected_policy_keys and bool(
        policy.get("ignore_explicit_profile_id", True)
    )
    ignored_explicit_profile = explicit_profile if ignore_explicit_profile else ""
    if ignore_explicit_profile:
        explicit_profile = ""
    selected_profile = explicit_profile or (allowed_profiles[0] if allowed_profiles else "")
    if allowed_profiles and selected_profile not in allowed_profiles:
        raise RuntimeError(
            "profile_policy_profile_mismatch:"
            f"policy_key={policy_key}:allowed={','.join(allowed_profiles)}:actual={selected_profile or 'N/A'}"
        )
    if not selected_profile:
        raise RuntimeError(f"profile_policy_profile_missing:{policy_key}")
    result = {
        "ok": True,
        "policy_key": policy_key,
        "policy_path": str(path),
        "selected_account_email": expected_account,
        "selected_profile_directory": selected_profile,
        "profile_strategy": str(policy.get("profile_strategy") or ""),
        "force_headed": bool(policy.get("force_headed")),
        "refresh_profile_runtime_on_start": bool(
            policy.get("refresh_profile_runtime_on_start")
            if policy.get("refresh_profile_runtime_on_start") is not None
            else policy.get("refresh_persistent_runtime_on_start")
        ),
        "explicit_profile_ignored": ignored_explicit_profile,
    }
    _enforce_deep_insight_solar_canonical_profile(result)
    return result


def _enforce_deep_insight_solar_canonical_profile(policy_result: dict[str, Any]) -> None:
    if policy_result.get("policy_key") != DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY:
        return
    selected_profile = str(policy_result.get("selected_profile_directory") or "").strip()
    selected_account = str(policy_result.get("selected_account_email") or "").strip()
    expected_profile = _profile_directory()
    expected_account = _account_email()
    profile_strategy = str(policy_result.get("profile_strategy") or "").strip()
    force_headed = bool(policy_result.get("force_headed"))
    refresh_profile_runtime = bool(policy_result.get("refresh_profile_runtime_on_start"))
    problems: list[str] = []
    if selected_profile != expected_profile:
        problems.append(f"profile={selected_profile or 'N/A'}")
    if selected_account.lower() != expected_account.lower():
        problems.append(f"account={selected_account or 'N/A'}")
    if profile_strategy != "persistent":
        problems.append(f"profile_strategy={profile_strategy or 'N/A'}")
    if not force_headed:
        problems.append("force_headed=false")
    if not refresh_profile_runtime:
        problems.append("refresh_profile_runtime_on_start=false")
    if problems:
        raise RuntimeError(
            "deep_insight_solar_profile_policy_mismatch:"
            f"expected_policy_key={DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY}:"
            f"expected_profile={expected_profile}:"
            f"expected_account={expected_account}:"
            f"expected_profile_strategy=persistent:"
            f"expected_force_headed=true:"
            f"expected_refresh_profile_runtime_on_start=true:"
            f"actual={','.join(problems)}:"
            f"policy_path={policy_result.get('policy_path') or 'N/A'}"
        )


def _mission_preflight_cache_path(request: dict[str, Any]) -> Path:
    mission = _safe_slug(request.get("missionId"), "mission")
    return RUN_ROOT / mission / "_preflight" / "chatgpt-auth-preflight.json"


def _preflight_cache_is_fresh(payload: dict[str, Any]) -> bool:
    if not payload.get("ok"):
        return False
    if _bool_env("DEEP_INSIGHT_SOLAR_PREFLIGHT_BROWSER", True):
        browser_check = payload.get("browser_check")
        if not isinstance(browser_check, dict) or not browser_check.get("enabled"):
            return False
        result = browser_check.get("result")
        if not isinstance(result, dict) or not _login_hold_payload_is_ready(result):
            return False
    ttl = _int_env("DEEP_INSIGHT_SOLAR_PREFLIGHT_TTL_SECONDS", 1800)
    checked_at = float(payload.get("checked_at_epoch") or 0)
    return checked_at > 0 and (time.time() - checked_at) <= ttl


def _read_json_if_exists(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _login_hold_artifact_candidates(task_dir: Path) -> list[Path]:
    request_dir = task_dir / "chatgpt-browser-agent-request"
    return [
        request_dir / "login-hold-result.json",
        request_dir / "login-hold-state.json",
        task_dir / "login-hold-result.json",
        task_dir / "login-hold-state.json",
    ]


def _login_hold_state_view(payload: dict[str, Any] | None) -> dict[str, Any]:
    payload = payload or {}
    state = payload.get("state") if isinstance(payload.get("state"), dict) else payload
    return {
        "ok": payload.get("ok"),
        "title": state.get("title"),
        "url": state.get("url"),
        "login_wall": state.get("login_wall"),
        "challenge_wall": state.get("challenge_wall"),
        "challenge_reason": state.get("challenge_reason"),
        "composer_ready": state.get("composer_ready"),
        "conversation_id": state.get("conversation_id"),
    }


def _login_hold_payload_is_ready(payload: dict[str, Any]) -> bool:
    state = _login_hold_state_view(payload)
    return (
        state.get("ok") is True
        and state.get("login_wall") is False
        and state.get("challenge_wall") is False
        and state.get("composer_ready") is True
    )


def _load_login_hold_state_artifact(task_dir: Path) -> tuple[dict[str, Any] | None, Path | None]:
    for path in _login_hold_artifact_candidates(task_dir):
        payload = _read_json_if_exists(path)
        if payload is not None:
            return payload, path
    return None, None


def _format_auth_repair_message(
    task_dir: Path,
    *,
    rc: int | None = None,
    output: str = "",
    payload: dict[str, Any] | None = None,
    artifact_path: Path | None = None,
) -> str:
    state = _login_hold_state_view(payload)
    wrapper_meta = _read_json_if_exists(task_dir / "chatgpt-browser-agent-request" / "wrapper-meta.json") or {}
    profile_policy = wrapper_meta.get("profile_policy") if isinstance(wrapper_meta.get("profile_policy"), dict) else {}
    lease_release_path = task_dir / "chatgpt-browser-agent-request" / "browser-profile-lease-release-after-wrapper-failure.json"
    lease_release = _read_json_if_exists(lease_release_path) or {}
    parts = [
        "chatgpt_auth_repair_required",
        f"rc={rc if rc is not None else 'N/A'}",
        f"queue_dir={_genesispod_browser_agent_queue_dir()}",
        f"task_dir={task_dir}",
        f"artifact={artifact_path or 'N/A'}",
        f"policy_key={profile_policy.get('policy_key') or wrapper_meta.get('policy_key') or DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY}",
        f"profile={profile_policy.get('selected_profile_directory') or wrapper_meta.get('selected_profile_directory') or wrapper_meta.get('profile_directory') or 'N/A'}",
        f"account={profile_policy.get('selected_account_email') or wrapper_meta.get('selected_account_email') or wrapper_meta.get('account_email') or _account_email()}",
        f"staged_user_data_dir={wrapper_meta.get('staged_user_data_dir') or 'N/A'}",
        f"ok={state.get('ok')}",
        f"login_wall={state.get('login_wall')}",
        f"challenge_wall={state.get('challenge_wall')}",
        f"composer_ready={state.get('composer_ready')}",
        f"challenge_reason={state.get('challenge_reason') or 'N/A'}",
        f"lease_released={lease_release.get('released', 'N/A')}",
    ]
    if output:
        parts.append(f"output_tail={output[-1200:]}")
    return "; ".join(parts)


def _raise_auth_repair_required(
    task_dir: Path,
    *,
    rc: int | None = None,
    output: str = "",
) -> None:
    payload, artifact_path = _load_login_hold_state_artifact(task_dir)
    raise AuthRepairRequired(
        _format_auth_repair_message(
            task_dir,
            rc=rc,
            output=output,
            payload=payload,
            artifact_path=artifact_path,
        )
    )


def _flow_control_cooldown_until(output: str) -> str | None:
    match = re.search(r"FlowControlBlocked:.*?cooldown until ([0-9T:Z+\-.]+)", output, re.IGNORECASE | re.DOTALL)
    if match:
        return match.group(1)
    lease_match = re.search(
        r"browser_profile_lease_acquire_failed:(\{.*?\})",
        output,
        re.IGNORECASE | re.DOTALL,
    )
    if not lease_match:
        return None
    try:
        payload = json.loads(lease_match.group(1))
    except Exception:
        return None
    if payload.get("reason") != "already_acquired":
        return None
    expires_at = str(payload.get("expires_at") or "").strip()
    return expires_at or None


def _cooldown_wait_seconds(until_iso: str, *, fallback: int = 60) -> int:
    value = until_iso.strip()
    try:
        target = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if target.tzinfo is None:
            target = target.replace(tzinfo=dt.datetime.now().astimezone().tzinfo)
        now = dt.datetime.now(tz=target.tzinfo)
        return max(1, int((target - now).total_seconds()) + 5)
    except Exception:
        return fallback


def _run_login_hold_operator_with_cooldown_retry(
    request: dict[str, Any],
    *,
    policy_key: str,
    preflight_dir: Path,
) -> subprocess.CompletedProcess[str]:
    max_wait = _int_env("DEEP_INSIGHT_SOLAR_PREFLIGHT_FLOW_CONTROL_WAIT_SECONDS", 3600)
    waited = 0
    attempts = 0
    while True:
        attempts += 1
        proc = _run_operator(CHATGPT_OPERATOR, _chatgpt_login_hold_envelope(request, policy_key=policy_key), preflight_dir)
        if proc.returncode == 0:
            return proc
        combined = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
        until_iso = _flow_control_cooldown_until(combined)
        if not until_iso:
            return proc
        wait_s = min(_cooldown_wait_seconds(until_iso), 120, max_wait - waited)
        if wait_s <= 0:
            raise FlowControlCooldown(
                "chatgpt_flow_control_cooldown;"
                f" rc={proc.returncode};"
                f" queue_dir={_genesispod_browser_agent_queue_dir()};"
                f" task_dir={preflight_dir};"
                f" policy_key={policy_key};"
                f" cooldown_until={until_iso};"
                f" waited_seconds={waited};"
                f" max_wait_seconds={max_wait};"
                f" attempts={attempts};"
                f" output_tail={combined[-1200:]}"
            )
        time.sleep(wait_s)
        waited += wait_s


def _run_operator_with_cooldown_retry(
    script: Path,
    envelope: dict[str, Any],
    task_dir: Path,
    *,
    max_wait_env: str = "DEEP_INSIGHT_SOLAR_FLOW_CONTROL_WAIT_SECONDS",
    default_max_wait: int = 7200,
) -> subprocess.CompletedProcess[str]:
    max_wait = _int_env(max_wait_env, default_max_wait)
    waited = 0
    attempts = 0
    while True:
        attempts += 1
        proc = _run_operator(script, envelope, task_dir)
        if proc.returncode == 0:
            return proc
        combined = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
        until_iso = _flow_control_cooldown_until(combined)
        if not until_iso:
            return proc
        wait_s = min(_cooldown_wait_seconds(until_iso), 120, max_wait - waited)
        if wait_s <= 0:
            raise FlowControlCooldown(
                "chatgpt_flow_control_cooldown;"
                f" rc={proc.returncode};"
                f" queue_dir={_genesispod_browser_agent_queue_dir()};"
                f" task_dir={task_dir};"
                f" cooldown_until={until_iso};"
                f" waited_seconds={waited};"
                f" max_wait_seconds={max_wait};"
                f" attempts={attempts};"
                f" output_tail={combined[-1200:]}"
            )
        time.sleep(wait_s)
        waited += wait_s


def _operator_block_preflight(operator_id: str) -> dict[str, Any]:
    max_wait = _int_env("DEEP_INSIGHT_SOLAR_FLOW_CONTROL_WAIT_SECONDS", 7200)
    waited = 0.0
    waits: list[dict[str, Any]] = []
    block = ofc.current_block_state(operator_id, allow_unregistered=True)
    while block and str(block.get("runtime_state") or "") == "cooldown" and waited < max_wait:
        expires_at = str(block.get("expires_at") or "").strip()
        wait_s = _seconds_until_iso(expires_at, fallback=60)
        wait_s = max(1, min(wait_s + 5, 120, max_wait - int(waited)))
        waits.append({"state": "cooldown", "expires_at": expires_at, "wait_seconds": wait_s})
        time.sleep(wait_s)
        waited += wait_s
        block = ofc.current_block_state(operator_id, allow_unregistered=True)
    if block:
        raise RuntimeError(
            "operator_flow_control_blocked:"
            f"operator_id={operator_id}:state={block.get('runtime_state') or 'N/A'}:"
            f"expires_at={block.get('expires_at') or 'N/A'}"
        )
    return {"ok": True, "operator_id": operator_id, "waited_seconds": round(waited, 3), "waits": waits}


def _seconds_until_iso(value: str, *, fallback: int) -> int:
    raw = str(value or "").strip()
    if not raw:
        return fallback
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        target = dt.datetime.fromisoformat(raw).astimezone(dt.timezone.utc)
        return max(0, int((target - dt.datetime.now(dt.timezone.utc)).total_seconds()))
    except Exception:
        return fallback


def _mission_voice_rules(language: str) -> list[str]:
    if language.lower().startswith("zh"):
        return [
            "读者对象：熟悉技术、产业和系统工程的专业读者。正文应像已经发表的研究分析，不像任务执行记录、审稿清单或数据库导出。",
            "写作密度：每一节围绕一个可辩护的判断展开，把机制、材料、限制和落点写进自然段。避免把编辑部检查项写成机械小标题。",
            "语言风格：克制、直接、有技术对象。少用抽象趋势句，多写系统、论文、指标、接口、架构对象、组织动作之间的关系。",
            "证据处理：材料不足时，收窄判断，而不是额外添加免责声明段落。可以写“公开材料还不能证明 X，更稳妥的读法是 Y”。",
            "洞察要求：不要只写安全综述。给出非显然判断、技术控制点、投资热点、反证和关键观察信号。",
            "成品约束：面向读者的正文不得出现后台流程、字段名、执行身份、内部编号、调度记录、审稿动作或自我解释。",
            "禁用表达：正文不得出现 gate、ledger、workstream、sourceNotes、writerBrief、ThesisGraph、asset-*、evidence-*、claim-* 等内部工程词。",
        ]
    return [
        "Audience: informed technical and business readers. Reader-facing prose should feel like a published research analysis, not a task trace, review checklist, or database export.",
        "Density: each section should advance a defensible claim and integrate mechanism, source material, limitation, and implication in natural prose.",
        "Voice: concise, analytical, and specific. Prefer systems, papers, metrics, interfaces, architectures, organizations, years, and versions over broad trend language.",
        "Evidence handling: when the material is insufficient, narrow the claim in prose rather than adding separate disclaimer blocks.",
        "Insight requirement: avoid generic surveys; include non-obvious claims, control points, hotspot taxonomy, counterevidence, and thesis-change signals.",
        "Publication constraint: reader-facing text must not expose backstage process, field names, execution identity, internal numbering, scheduling records, review actions, or self-explanation.",
        "Forbidden public text: do not expose gate, ledger, workstream, sourceNotes, writerBrief, ThesisGraph, asset-*, evidence-*, claim-* or other internal engineering labels.",
    ]


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
        "outputSchemaVersion": request.get("outputSchemaVersion") or RESEARCH_OS_SCHEMA_VERSION,
        "constraints": request.get("constraints") or {},
        "payload": payload,
    }
    if operator_id == "BrowserLeaderPlanner":
        schema = {
            "centralQuestion": "string",
            "entityContract": {
                "canonicalEntities": [
                    {
                        "name": "string",
                        "entityType": "company|paper|model|product|system|ecosystem|other",
                        "releaseOrVersion": "string",
                        "primarySourcesRequired": True,
                    }
                ],
                "confusableEntities": ["string"],
                "requiredPrimarySources": ["official docs|paper|repo|release note"],
                "mustNotAssume": ["string"],
            },
            "candidateConclusions": [
                {
                    "key": "c1",
                    "claim": "string",
                    "type": "verified_fact|reasonable_inference|architectural_hypothesis|research_gap",
                    "mechanismToVerify": "string",
                    "whatWouldWeakenThis": "string",
                    "requiredEvidence": ["primary_source", "counter_evidence_search"],
                    "likelyReportUse": "lead_argument|supporting_argument|counterpoint|background",
                }
            ],
            "researchTracks": [
                {
                    "key": "r1",
                    "name": "string",
                    "question": "string",
                    "assetTypes": "2-4 Research OS asset type strings",
                    "sourcesToFind": [
                        "paper|repo|benchmark|system_doc|company_source|expert_interview|market_data"
                    ],
                    "falsificationChecks": ["string"],
                    "expectedReportUse": "string",
                }
            ],
            "mandatoryArtifacts": "all core Research OS ledgers and EvidenceCards",
            "visualContract": {
                "requiredFigures": [
                    {
                        "figureId": "fig-architecture-stack",
                        "type": "technology-timeline|architecture-stack|control-point-map|actor-landscape|opportunity-map",
                        "purpose": "string",
                        "source": "generated_by_technologydiagram|source_figure|redraw",
                    }
                ],
                "sourceFigurePolicy": "extract_if_source_has_chart_or_arch_diagram",
            },
            "citationContract": {
                "showConfidenceTable": True,
                "hideInternalEvidenceIds": True,
                "sourceTableColumns": ["source", "type", "confidence", "supports", "url"],
            },
            "coverageRequirements": ["string"],
            "sourcePolicy": "primary sources first; avoid unsourced summaries and marketing copy as fact",
            "writingSpine": [
                {
                    "sectionPurpose": "string",
                    "readerQuestionAnswered": "string",
                    "candidateClaimKeys": ["c1"],
                }
            ],
            "risks": ["string"],
        }
        task = (
            "Return exactly one JSON object for a research plan: central question, exactly 4 candidateConclusions, "
            "entityContract, visualContract, citationContract, at least 6 researchTracks, source needs, falsification checks, "
            "assetTypes, mandatory artifacts, and exactly 6 writingSpine items. "
            "For Neo Labs, default to the US research-first AI lab ecosystem unless a legal entity is proven. "
            "Do not write a preface, promise, explanation, markdown, or sentence outside JSON."
        )
    elif operator_id == "BrowserResearcher":
        schema = {
            "track": {"key": "r1", "name": "string", "question": "string"},
            "sourceNotes": [
                {
                    "key": "s1",
                    "sourceTitle": "string",
                    "url": "https://source-url",
                    "sourceType": "paper|repo|benchmark|system_doc|company_source|expert_interview|market_data|other",
                    "dateOrVersion": "string",
                    "relevantFact": "string",
                    "supportedClaim": "string",
                    "limitation": "string",
                    "confidence": "high|medium|low",
                }
            ],
            "canonicalEntityCards": [
                {
                    "name": "string",
                    "entityType": "string",
                    "releaseOrVersion": "string",
                    "primarySourceUrl": "https://source-url",
                    "confusableEntities": ["string"],
                    "mustNotAssume": ["string"],
                    "confidence": "high|medium|low",
                }
            ],
            "primarySourceClaims": [
                {
                    "claim": "string",
                    "sourceTitle": "string",
                    "sourceUrl": "https://primary-source-url",
                    "supports": "string",
                    "confidence": "high|medium|low",
                }
            ],
            "benchmarkClaims": [
                {
                    "claim": "string",
                    "benchmarkOrMetric": "string",
                    "sourceUrl": "https://source-url",
                    "limitation": "string",
                }
            ],
            "observations": [
                {
                    "claim": "string",
                    "mechanism": "string",
                    "supportingSourceKeys": ["s1"],
                    "counterpointOrLimit": "string",
                    "reportUse": "lead_argument|supporting_argument|counterpoint|example|background|open_question",
                }
            ],
            "figureCandidates": [
                {
                    "sourceUrl": "https://source-page",
                    "imageUrl": "https://direct-image-url-if-visible",
                    "caption": "reader-facing caption",
                    "sourcePageOrSection": "where the figure appears",
                    "relevanceHint": "high|medium|low",
                }
            ],
            "diagramBriefSeeds": [
                {
                    "title": "string",
                    "purpose": "string",
                    "diagramType": "timeline|architecture-stack|actor-landscape|opportunity-map",
                    "placementAfterHeading": "string",
                    "evidenceBindings": ["source key or claim"],
                }
            ],
            "missingEvidence": ["string"],
            "summaryForSynthesis": "string",
        }
        task = (
            "Research one track and return concise source-grounded notes for synthesis. Do not write the final report. "
            "Each observation must connect a claim to mechanism, source material, limitation, and likely report use. "
            "Always return canonicalEntityCards when the track concerns entity/version disambiguation, and primarySourceClaims "
            "for any claim that could appear in the executive summary. "
            "When a cited source contains a useful chart, architecture diagram, benchmark graph, screenshot, or figure, "
            "add it to figureCandidates with sourceUrl, imageUrl if directly visible, caption, and relevanceHint."
        )
    elif operator_id == "BrowserAnalyst":
        schema = {
            "writerBrief": {
                "workingTitle": "string",
                "oneSentenceThesis": "string",
                "leadAngle": "string",
                "readerTakeaways": ["string"],
                "sections": [
                    {
                        "heading": "reader-facing section heading",
                        "coreClaim": "string",
                        "claimType": "verified_fact|reasonable_inference|architectural_hypothesis|research_gap",
                        "confidence": 0.0,
                        "mechanism": "string",
                        "evidenceToUse": [
                            {
                                "sourceTitle": "string",
                                "fact": "string",
                                "url": "https://source-url",
                            }
                        ],
                        "limitToPreserve": "string",
                        "implication": "string",
                        "visualBinding": ["figure title or id"],
                    }
                ],
                "investmentHotspotMap": [
                    {
                        "hotspot": "string",
                        "technicalControlPoint": "string",
                        "representativeActors": ["string"],
                        "whyCapitalCares": "string",
                        "whatWouldDisproveIt": "string",
                    }
                ],
                "nonConsensusAngles": ["string"],
                "doNotOverstate": ["string"],
                "referenceCandidates": [
                    {
                        "title": "string",
                        "url": "https://source-url",
                        "relevance": "string",
                    }
                ],
            },
            "internalTrace": {
                "usedTrackKeys": ["r1"],
                "usedSourceKeys": ["s1"],
                "droppedClaims": [{"claim": "string", "reason": "string"}],
            },
            "diagramBriefs": [
                {
                    "title": "reader-facing figure title",
                    "caption": "what the figure should explain",
                    "purpose": "why this figure helps the reader",
                    "diagramType": "architecture_map|ecosystem_map|timeline|matrix",
                    "placementAfterHeading": "report section heading where this belongs",
                }
            ],
        }
        task = (
            "Synthesize the research notes into a report-ready writing brief. The writing brief must contain only "
            "material that can safely be transformed into reader-facing prose. Also return 2-3 diagramBriefs for "
            "TechnologyDiagramPainter: prioritize architecture/control-plane maps, ecosystem maps, timelines, or "
            "investment-hotspot matrices that would materially improve the final report."
        )
    elif operator_id == "BrowserLongformWriter":
        schema = {
            "title": "string",
            "dek": "one-sentence subtitle",
            "executiveBriefMarkdown": "3-6 reader-facing bullets or short paragraphs",
            "standardReportMarkdown": "single complete reader-facing markdown report",
            "references": [
                {
                    "title": "string",
                    "url": "https://source-url",
                    "relevance": "reader-facing description of what this source supports",
                }
            ],
            "figurePlan": [
                {
                    "placementAfterHeading": "string",
                    "figureTitle": "string",
                    "caption": "string",
                    "sourceOrDiagramBrief": "string",
                }
            ],
        }
        task = (
            "Write the finished reader-facing report from the provided writing brief.\n\n"
            "Length contract: standardReportMarkdown must be a substantial long-form report. Target 9000-12000 "
            "Chinese characters for zh-CN topics, with at least 6500 characters of body text before references. "
            "Do not shorten the report to a summary, outline, or executive memo. Use at least 6 substantive sections; "
            "each section should develop 2-4 paragraphs with mechanisms, actor comparisons, evidence limits, and implications. "
            "Before returning JSON, self-check that standardReportMarkdown is at least 6500 Chinese characters; if not, "
            "expand the thin sections instead of returning early.\n\n"
            "The report should read as a publishable technology insight article. Open with the strongest substantive "
            "conclusion, then develop the argument through concrete mechanisms, source material, limiting conditions, "
            "and implications.\n\n"
            "Entity boundary rule: if the topic name is ambiguous or looks like a category label rather than a verified "
            "single company, state the normalized research object naturally and do not invent single-company funding, "
            "product, headcount, or technical facts unless they are explicitly present in the writing brief evidence. "
            "For Neo Labs / neo-labs style topics, treat the object as the US research-first AI lab ecosystem unless "
            "the brief proves a specific legal entity.\n\n"
            "For investment topics, include a concrete hotspot taxonomy: technical control point, representative actors, "
            "why capital cares, what evidence is still missing, and what would change the thesis. Avoid generic market-map prose.\n\n"
            "Plan and place figures in the report. If sourceFigureCandidates are present, embed the most useful source "
            "figures near the section they support. If diagramBriefs are present, reserve reader-facing figure slots for "
            "the generated technology diagrams. Do not leave the report as text-only when figure material exists.\n\n"
            "End references as a source-confidence table rather than a bare numbered list. The table should show source/material, "
            "confidence, supported judgment, and URL when available.\n\n"
            "Use domain-specific headings. Each heading should name the technology object, market structure, system "
            "mechanism, or strategic tension being analyzed.\n\n"
            "Do not add planning notes, review notes, process notes, placeholders, apologies, or explanations of how "
            "the report was made.\n\n"
            "Do not expose internal IDs or backend vocabulary such as asset-*, evidence-*, claim-*, gate, ledger, "
            "workstream, sourceNotes, writerBrief, or ThesisGraph in any reader-facing markdown.\n\n"
            "If a claim in the brief is weakly supported, narrow it in prose or omit it."
        )
    elif operator_id == "BrowserCritic":
        schema = {
            "publishDecision": "pass|revise|reject",
            "blockingIssues": [
                {
                    "location": "string",
                    "issue": "string",
                    "whyItHurtsReaderValue": "string",
                    "fix": "string",
                }
            ],
            "unsupportedClaims": [
                {
                    "claim": "string",
                    "problem": "string",
                    "fix": "remove|soften|add_source|rewrite_mechanism",
                }
            ],
            "styleLeaks": [
                {
                    "phrase": "string",
                    "problem": "self_talk|backstage_process|mechanical_heading|generic_language",
                    "replacementDirection": "string",
                }
            ],
            "lowValuePassages": [
                {
                    "passageSummary": "string",
                    "problem": "string",
                    "rewriteDirection": "string",
                }
            ],
            "recommendedEdits": ["string"],
        }
        task = (
            "Review only the reader-facing report. Identify defects that would make the report shallow, mechanical, "
            "unsupported, self-referential, or contaminated by backstage process language. Recommend concrete edits "
            "without adding process sections to the report."
        )
    else:
        raise RuntimeError(f"unsupported ChatGPT operatorId: {operator_id}")

    return "\n".join(
        [
            "Return one valid JSON object matching the requested schema.",
            "",
            "Important: JSON keys are transport fields. Reader markdown must read like a finished publication, not a process log, audit note, database record, or prompt response.",
            "",
            f"Task: {task}",
            "",
            "Editorial standard:",
            "- Begin with the substantive conclusion or the concrete object under analysis.",
            "- Turn source material into claims, mechanisms, limits, and implications.",
            "- Preserve supported names, numbers, dates, versions, systems, papers, benchmarks, organizations, and interfaces.",
            "- If the material does not support a strong claim, narrow the claim in natural prose.",
            "- For investment or company-spectrum topics, turn materials into a concrete hotspot taxonomy and compare actors by technical control points.",
            "- Do not describe how the answer was produced.",
            "- Never expose internal IDs, schema labels, or backend workflow terms in reader-facing markdown.",
            "- Do not invent sources or quantitative details.",
            "",
            "Language and voice:",
            *[f"- {rule}" for rule in _mission_voice_rules(language)],
            "",
            "Schema:",
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
    success_cooldown_default = CHATGPT_SUCCESS_COOLDOWN_SECONDS.get(operator_id, 300)
    min_output_chars = {
        "BrowserLeaderPlanner": 1200,
        "BrowserResearcher": 1800,
        "BrowserAnalyst": 1500,
        "BrowserLongformWriter": 5000,
        "BrowserCritic": 1200,
    }.get(operator_id, 0)
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
            "min_output_chars": min_output_chars,
            "profile_lease_wait_seconds": _int_env("DEEP_INSIGHT_SOLAR_PROFILE_LEASE_WAIT_SECONDS", 7200),
            "profile_lease_wait_poll_seconds": _int_env("DEEP_INSIGHT_SOLAR_PROFILE_LEASE_WAIT_POLL_SECONDS", 60),
        },
        "chatgpt_success_cooldown_seconds": int(
            os.environ.get("DEEP_INSIGHT_SOLAR_SUCCESS_COOLDOWN_SECONDS")
            or str(success_cooldown_default)
        ),
        "chatgpt_rate_limit_cooldown_seconds": int(os.environ.get("DEEP_INSIGHT_SOLAR_RATE_LIMIT_COOLDOWN_SECONDS") or "1800"),
        "chatgpt_auth_cooldown_seconds": int(os.environ.get("DEEP_INSIGHT_SOLAR_AUTH_COOLDOWN_SECONDS") or "21600"),
        "chatgpt_defer_on_cooldown": True,
        "chatgpt_defer_on_auth": True,
    }


def _api_messages_for_operator(request: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "You are the API model provider for GenesisPod deep-insight-solar Research OS. "
                "Return exactly one valid JSON object. Do not wrap it in markdown. "
                "Do not expose internal process terms in reader-facing markdown."
            ),
        },
        {"role": "user", "content": _prompt_for_chatgpt(request)},
    ]


def _call_openai_compatible_json(
    request: dict[str, Any],
    *,
    provider: str,
    task_dir: Path,
) -> tuple[Any, str, dict[str, Any]]:
    config = _api_provider_config(provider)
    url = _openai_chat_completions_url(str(config["base_url"]))
    payload: dict[str, Any] = {
        "model": str(config["model"]),
        "messages": _api_messages_for_operator(request),
        "temperature": float(os.environ.get("DEEP_INSIGHT_SOLAR_API_TEMPERATURE") or "0.2"),
        "response_format": {"type": "json_object"},
    }
    operator_id = str(request.get("operatorId") or "")
    default_max_tokens = 8192 if operator_id in {
        "BrowserLeaderPlanner",
        "BrowserResearcher",
        "BrowserAnalyst",
        "BrowserLongformWriter",
    } else 4096
    max_tokens = _int_env("DEEP_INSIGHT_SOLAR_API_MAX_TOKENS", default_max_tokens)
    if max_tokens > 0:
        payload["max_tokens"] = max_tokens
    request_path = task_dir / f"{provider}-request.json"
    response_path = task_dir / f"{provider}-response.json"
    safe_request = {
        "url": url,
        "model": payload["model"],
        "messages": payload["messages"],
        "temperature": payload["temperature"],
        "response_format": payload["response_format"],
        **({"max_tokens": payload["max_tokens"]} if "max_tokens" in payload else {}),
    }
    _json_dump(request_path, safe_request)
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {config['api_key']}",
            "User-Agent": "solar-deep-insight-solar-provider-router/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=int(config["timeout"])) as resp:
        raw_response = json.loads(resp.read().decode("utf-8", errors="replace"))
    _json_dump(response_path, raw_response if isinstance(raw_response, dict) else {"raw": raw_response})
    choices = raw_response.get("choices") if isinstance(raw_response, dict) else None
    if not isinstance(choices, list) or not choices:
        raise RuntimeError(f"{provider}_empty_choices")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    text = str((message or {}).get("content") or "").strip()
    if not text:
        reasoning = str((message or {}).get("reasoning_content") or "").strip()
        text = _extract_parseable_json_text(reasoning) or ""
    if not text:
        raise RuntimeError(f"{provider}_empty_content")
    structured = _parse_chatgpt_json_or_raw(text)
    usage = raw_response.get("usage") if isinstance(raw_response, dict) else None
    metrics = {
        "provider": provider,
        "modelId": config["model"],
        "requestDir": str(task_dir),
        "apiRequestPath": str(request_path),
        "apiResponsePath": str(response_path),
    }
    if isinstance(usage, dict):
        metrics["tokensUsed"] = usage.get("total_tokens")
        metrics["promptTokens"] = usage.get("prompt_tokens")
        metrics["completionTokens"] = usage.get("completion_tokens")
    return structured, text, metrics


def _run_api_provider_operator(request: dict[str, Any], *, provider: str, task_dir: Path) -> dict[str, Any]:
    operator_id = str(request.get("operatorId") or "")
    try:
        structured, markdown, metrics = _call_openai_compatible_json(
            request,
            provider=provider,
            task_dir=task_dir,
        )
    except urllib.error.URLError as exc:
        return _result_from_error(
            "SOLAR_API_PROVIDER_UNREACHABLE",
            f"{provider}: {exc}",
            retryable=True,
        )
    except Exception as exc:
        return _result_from_error(
            "SOLAR_API_PROVIDER_FAILED",
            f"{provider}: {type(exc).__name__}: {exc}",
            retryable=True,
        )
    try:
        structured = _normalize_structured_result(operator_id, structured, request)
        _validate_chatgpt_structured_result(operator_id, structured, markdown)
    except Exception as exc:
        if operator_id == "BrowserResearcher":
            retry_request = _researcher_repair_retry_request(request, structured, exc)
            try:
                structured, markdown, metrics = _call_openai_compatible_json(
                    retry_request,
                    provider=provider,
                    task_dir=task_dir,
                )
                structured = _normalize_structured_result(operator_id, structured, retry_request)
                _validate_chatgpt_structured_result(operator_id, structured, markdown)
                metrics = {
                    **metrics,
                    "retryReason": str(exc),
                    "retryMode": "researcher_json_repair",
                }
            except Exception as retry_exc:
                return _result_from_error(
                    "SOLAR_API_RESULT_INCOMPLETE",
                    f"{provider}: {retry_exc}",
                    retryable=True,
                )
        elif operator_id == "BrowserLongformWriter" and "body_too_short" in str(exc):
            retry_request = _writer_expansion_retry_request(request, structured)
            try:
                structured, markdown, metrics = _call_openai_compatible_json(
                    retry_request,
                    provider=provider,
                    task_dir=task_dir,
                )
                structured = _normalize_structured_result(operator_id, structured, retry_request)
                _validate_chatgpt_structured_result(operator_id, structured, markdown)
                metrics = {
                    **metrics,
                    "retryReason": str(exc),
                    "retryMode": "writer_body_expansion",
                }
            except Exception as retry_exc:
                return _result_from_error(
                    "SOLAR_API_RESULT_INCOMPLETE",
                    f"{provider}: {retry_exc}",
                    retryable=True,
                )
        else:
            return _result_from_error(
                "SOLAR_API_RESULT_INCOMPLETE",
                f"{provider}: {exc}",
                retryable=True,
            )
    (task_dir / f"{provider}-output.txt").write_text(markdown + ("\n" if markdown else ""), encoding="utf-8")
    result = {
        "status": "succeeded",
        "structured": structured,
        "markdown": markdown,
        "evidence": [],
        "artifacts": [],
        "metrics": metrics,
        "rawTranscriptUri": str(task_dir / f"{provider}-output.txt"),
    }
    _json_dump(task_dir / f"{provider}-operator-result.json", result)
    return result


def _writer_expansion_retry_request(request: dict[str, Any], structured: Any) -> dict[str, Any]:
    """Retry S8 once with the short draft as expansion material, not as final text."""
    retry_request = json.loads(json.dumps(request, ensure_ascii=False))
    payload = _base_payload(retry_request)
    writer_brief = payload.get("writerBrief") if isinstance(payload.get("writerBrief"), dict) else {}
    previous = ""
    if isinstance(structured, dict):
        previous = str(structured.get("standardReportMarkdown") or "").strip()
    payload["writerBrief"] = {
        **writer_brief,
        "previousDraftToExpand": previous[:12000],
        "expansionDirective": (
            "The previous draft was rejected because it was too short. Expand it into a complete report with "
            "at least 6500 Chinese characters in standardReportMarkdown, at least 6 substantive sections, "
            "and concrete actor comparisons, technical control points, investment-hotspot taxonomy, evidence limits, "
            "and thesis-change signals. Do not add internal process language."
        ),
    }
    payload["instruction"] = (
        str(payload.get("instruction") or "").strip()
        + "\n\nSecond-pass expansion is required: the first draft was below the body length gate. "
        "Return a longer complete report, not a summary."
    ).strip()
    retry_request["payload"] = payload
    return retry_request


def _writer_public_language_retry_request(
    request: dict[str, Any],
    structured: Any,
    reason: Exception | str,
) -> dict[str, Any]:
    """Retry S8 once when the draft leaks process/backstage vocabulary."""
    retry_request = json.loads(json.dumps(request, ensure_ascii=False))
    payload = _base_payload(retry_request)
    writer_brief = payload.get("writerBrief") if isinstance(payload.get("writerBrief"), dict) else {}
    previous = ""
    if isinstance(structured, dict):
        previous = str(structured.get("standardReportMarkdown") or "").strip()
    payload["writerBrief"] = {
        **writer_brief,
        "previousDraftToRewrite": previous[:16000],
        "publicLanguageRepairDirective": (
            "Rewrite the previous draft as an external-facing executive technology insight report. "
            "Do not mention report process, validation, gates, internal artifacts, upstream materials, "
            "evidence boundaries, internal fields, asset/workstream/thesis IDs, or how the analysis was produced. "
            "Replace backstage phrases such as 证据边界/门控/上游材料/内部流程 with natural reader-facing wording "
            "such as 可确认事实、公开材料显示、仍需关注的风险、尚未公开披露的部分. "
            "Keep the substantive conclusions, actor comparisons, technical mechanisms, and investment taxonomy."
        ),
    }
    payload["instruction"] = (
        str(payload.get("instruction") or "").strip()
        + "\n\nPublic-language repair is required because the previous draft leaked backstage wording "
        f"({reason}). Return a fresh complete report in standardReportMarkdown, not a patch note."
    ).strip()
    retry_request["payload"] = payload
    return retry_request


def _researcher_repair_retry_request(request: dict[str, Any], structured: Any, reason: Exception) -> dict[str, Any]:
    """Retry S3 once with a stricter, smaller repair instruction."""
    retry_request = json.loads(json.dumps(request, ensure_ascii=False))
    payload = _base_payload(retry_request)
    previous_raw = ""
    if isinstance(structured, dict):
        previous_raw = str(structured.get("rawText") or "").strip()
    payload["repairDirective"] = (
        "The previous BrowserResearcher result was rejected. Return one complete strict JSON object only. "
        "No markdown fences, no prose outside JSON, no dangling strings. Include at least 4 sourceNotes, "
        "at least 3 observations, generated evidenceCards when possible, and a summaryForSynthesis of at "
        "least 900 Chinese characters that connects claims, mechanisms, limits, and report use. If evidence "
        "is unavailable, state that as missingEvidence instead of inventing certainty."
    )
    payload["previousInvalidOutputPreview"] = previous_raw[:3000]
    payload["instruction"] = (
        str(payload.get("instruction") or "").strip()
        + f"\n\nRepair required because validation failed: {reason}. Return strict JSON only."
    ).strip()
    retry_request["payload"] = payload
    return retry_request


def _leader_planner_repair_retry_request(
    request: dict[str, Any],
    structured: Any,
    reason: Exception | str,
) -> dict[str, Any]:
    """Retry S2 when ChatGPT returns a short intent sentence instead of JSON."""
    retry_request = json.loads(json.dumps(request, ensure_ascii=False))
    payload = _base_payload(retry_request)
    previous_raw = ""
    if isinstance(structured, dict):
        previous_raw = str(structured.get("rawText") or "").strip()
    elif structured is not None:
        previous_raw = str(structured).strip()
    payload["repairDirective"] = (
        "The previous BrowserLeaderPlanner answer was rejected because it did not return the required JSON plan. "
        "Return one complete strict JSON object only. No markdown fences, no preface, no promise to do the work. "
        "The JSON must include centralQuestion, initialTheses, researchQuestions, at least 6 workstreams, "
        "mandatoryArtifacts, sourcePolicy, coverageRequirements, falsificationQuestions, and legacy dimensions. "
        "Each workstream needs name, question, assetTypes, sourcesToFind, falsificationChecks, and expectedReportUse."
    )
    payload["previousInvalidOutputPreview"] = previous_raw[:3000]
    payload["instruction"] = (
        str(payload.get("instruction") or "").strip()
        + f"\n\nRepair required because validation failed: {reason}. Return strict JSON only; the first character must be '{{' and the last character must be '}}'."
    ).strip()
    retry_request["payload"] = payload
    return retry_request


def _chatgpt_login_hold_envelope(request: dict[str, Any], *, policy_key: str) -> dict[str, Any]:
    timeout = _int_env("DEEP_INSIGHT_SOLAR_PREFLIGHT_BROWSER_TIMEOUT_SECONDS", 180)
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
    state_payload, state_path = _load_login_hold_state_artifact(task_dir)
    result_path = task_dir / "chatgpt-browser-agent-result.json"
    if not result_path.exists():
        output = (task_dir / "chatgpt-browser-agent-output.txt").read_text(encoding="utf-8") if (task_dir / "chatgpt-browser-agent-output.txt").exists() else ""
        if state_payload is not None:
            if _login_hold_payload_is_ready(state_payload):
                return state_payload
            raise AuthRepairRequired(
                _format_auth_repair_message(
                    task_dir,
                    output=output,
                    payload=state_payload,
                    artifact_path=state_path,
                )
            )
        raise AuthRepairRequired(
            _format_auth_repair_message(
                task_dir,
                output=f"missing chatgpt preflight result artifact: {result_path}; {output[-1000:]}",
            )
        )
    result = json.loads(result_path.read_text(encoding="utf-8"))
    text = str(result.get("text") or "").strip()
    try:
        parsed = json.loads(_strip_json_fence(text))
    except Exception:
        parsed = {"rawText": text}
    authoritative = state_payload if state_payload is not None else parsed
    authoritative_path = state_path if state_payload is not None else result_path
    if not _login_hold_payload_is_ready(authoritative):
        raise AuthRepairRequired(
            _format_auth_repair_message(
                task_dir,
                payload=authoritative,
                artifact_path=authoritative_path,
                output=json.dumps(parsed, ensure_ascii=False)[:1000],
            )
        )
    return authoritative


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
        proc = _run_login_hold_operator_with_cooldown_retry(request, policy_key=policy_key, preflight_dir=preflight_dir)
        browser_check = {
            "enabled": True,
            "returncode": proc.returncode,
            "task_dir": str(preflight_dir),
        }
        if proc.returncode != 0:
            combined = ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()
            _raise_auth_repair_required(preflight_dir, rc=proc.returncode, output=combined)
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
    env["BROWSER_AGENT_QUEUE_DIR"] = str(_genesispod_browser_agent_queue_dir())
    env.setdefault("BROWSER_AGENT_QUEUE_SCRIPT", str(ROOT / "scripts" / "browser_agent_queue.py"))
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
    wait_seconds = _int_env("DEEP_INSIGHT_SOLAR_RESULT_ARTIFACT_WAIT_SECONDS", 15)
    deadline = time.time() + max(0, wait_seconds)
    while not result_path.exists() and time.time() < deadline:
        time.sleep(0.25)
    if not result_path.exists():
        fallback = _load_chatgpt_completed_response_fallback(task_dir)
        if fallback is None:
            output = (task_dir / "chatgpt-browser-agent-output.txt").read_text(encoding="utf-8") if (task_dir / "chatgpt-browser-agent-output.txt").exists() else ""
            raise RuntimeError(f"missing chatgpt result artifact: {result_path}; output={output[-1000:]}")
        result, fallback_path = fallback
        _json_dump(
            task_dir / "chatgpt-browser-agent-result.recovered.json",
            {
                **result,
                "recovered": True,
                "recoveredFrom": str(fallback_path),
                "reason": "completed_signal_response_artifact",
            },
        )
    else:
        result = json.loads(result_path.read_text(encoding="utf-8"))
        fallback_path = result_path
    text = str(result.get("text") or "").strip()
    structured = _parse_chatgpt_json_or_raw(text)
    metrics = {
        "modelId": result.get("model"),
        "requestDir": result.get("request_dir"),
        "resultArtifact": str(fallback_path),
        "recovered": bool(result.get("recovered")),
    }
    return structured, text, metrics


def _load_reusable_writer_result(task_dir: Path, request: dict[str, Any]) -> tuple[Any, str, dict[str, Any]] | None:
    """Reuse a completed S8 writer artifact before opening another browser job.

    This keeps resume idempotent: if ChatGPT already produced a long-form report
    but a later quality gate/retry failed, retrying the mission should first
    consume the finished artifact and apply deterministic public-language cleanup.
    """
    candidates = [task_dir / "chatgpt-browser-agent-result.json"]
    candidates.extend(
        sorted(
            task_dir.glob("writer-retry-*/chatgpt-browser-agent-result.json"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
    )
    for result_path in candidates:
        if not result_path.exists():
            continue
        try:
            result = json.loads(result_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        text = str(result.get("text") or "").strip()
        if not text:
            continue
        structured = _parse_chatgpt_json_or_raw(text)
        if not isinstance(structured, dict) or "rawText" in structured:
            continue
        metrics = {
            "modelId": result.get("model"),
            "requestDir": result.get("request_dir"),
            "resultArtifact": str(result_path),
            "reusedCompletedArtifact": True,
        }
        try:
            structured = _normalize_structured_result("BrowserLongformWriter", structured, request)
            _validate_chatgpt_structured_result("BrowserLongformWriter", structured, text)
            return structured, _report_package_markdown(structured), metrics
        except Exception as exc:
            if "public_report_internal_jargon" not in str(exc) and "public_report_mechanical_heading" not in str(exc):
                continue
            sanitized, changed, fixes = _sanitize_public_report_structured(structured)
            if not changed:
                continue
            try:
                _validate_chatgpt_structured_result("BrowserLongformWriter", sanitized, _report_package_markdown(sanitized))
            except Exception:
                continue
            recovered_path = result_path.with_suffix(".public-language-recovered.json")
            recovered_result = {
                **result,
                "text": json.dumps(sanitized, ensure_ascii=False, indent=2),
                "publicLanguageRecovered": True,
                "publicLanguageRecoveryReason": str(exc),
                "publicLanguageFixes": fixes,
            }
            _json_dump(recovered_path, recovered_result)
            return (
                sanitized,
                _report_package_markdown(sanitized),
                {
                    **metrics,
                    "publicLanguageRecovered": True,
                    "publicLanguageRecoveryReason": str(exc),
                    "publicLanguageFixes": fixes,
                    "recoveredArtifact": str(recovered_path),
                },
            )
    return None


def _load_chatgpt_completed_response_fallback(task_dir: Path) -> tuple[dict[str, Any], Path] | None:
    candidates = sorted(
        task_dir.glob("chatgpt-browser-agent-request*/completion-signal.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for signal_path in candidates:
        try:
            signal = json.loads(signal_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if str(signal.get("status") or "") != "completed":
            continue
        response_path = signal_path.parent / "assistant-response.txt"
        try:
            text = response_path.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if not text:
            continue
        structured = _parse_chatgpt_json_or_raw(text)
        if not isinstance(structured, dict) or "rawText" in structured:
            continue
        return (
            {
                "ok": True,
                "model": signal.get("model") or os.environ.get("DEEP_INSIGHT_SOLAR_CHATGPT_MODEL") or "chatgpt-5.5",
                "expected_output": "json",
                "request_dir": str(signal_path.parent),
                "text": text,
                "recovered": True,
            },
            response_path,
        )
    return None


def _combined_proc_output(proc: subprocess.CompletedProcess[str]) -> str:
    return ((proc.stdout or "") + "\n" + (proc.stderr or "")).strip()


def _chatgpt_browser_proc_retryable(proc: subprocess.CompletedProcess[str]) -> bool:
    output = _combined_proc_output(proc).lower()
    return any(
        marker in output
        for marker in (
            "captured incomplete output",
            "assistant_response_too_short",
            "strict_json_not_returned",
            "returned empty output",
            "generating_without_output",
            "chatgpt_generating_without_output",
            "response_timeout",
            "submitted_without_generation",
        )
    )


def _chatgpt_browser_task_dir_retry_reason(task_dir: Path) -> str:
    """Return a retryable browser-agent signal reason when stdout/stderr is empty.

    Queue workers intentionally keep stdout/stderr small. For UI-level failures
    like "submitted_without_generation", the decisive evidence lives in the
    request dir completion signal, not in the bridge subprocess output.
    """

    retryable_markers = (
        "submitted_without_generation",
        "generating_without_output",
        "assistant_response_too_short",
        "response_timeout",
        "no_output",
    )
    signal_paths = sorted(
        task_dir.glob("chatgpt-browser-agent-request*/completion-signal.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for signal_path in signal_paths:
        try:
            signal = json.loads(signal_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        status = str(signal.get("status") or "").lower()
        reason = str(signal.get("reason") or "").lower()
        if status in {"blocked", "timed_out"} and any(marker in reason for marker in retryable_markers):
            return reason or status

    error_paths = sorted(
        task_dir.glob("chatgpt-browser-agent-request*/wrapper-error.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for error_path in error_paths:
        try:
            payload = json.loads(error_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        error_text = (str(payload.get("error_type") or "") + ":" + str(payload.get("error") or "")).lower()
        if any(marker in error_text for marker in retryable_markers):
            return error_text
    return ""


def _latest_chatgpt_invalid_output_preview(task_dir: Path) -> str:
    candidates = sorted(
        task_dir.glob("chatgpt-browser-agent-request*/assistant-response.txt"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for path in candidates:
        try:
            text = path.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if text:
            return text[:3000]
    output_path = task_dir / "chatgpt-browser-agent-output.txt"
    try:
        return output_path.read_text(encoding="utf-8").strip()[-3000:]
    except OSError:
        return ""


def _chatgpt_browser_retry_envelope(
    request: dict[str, Any],
    *,
    task_dir: Path,
    retry_request_dir_name: str,
) -> dict[str, Any]:
    envelope = _chatgpt_envelope(request)
    browser_request = envelope["chatgpt_browser_agent_request"]
    browser_request["request_dir"] = str(task_dir / retry_request_dir_name)
    return envelope


def _chatgpt_no_output_failure_result(
    operator_id: str,
    *,
    initial_proc: subprocess.CompletedProcess[str],
    retry_proc: subprocess.CompletedProcess[str] | None = None,
    task_dir_retry_reason: str = "",
) -> dict[str, Any]:
    parts = [
        f"{operator_id} produced no usable ChatGPT generation",
        f"signal_reason={task_dir_retry_reason or 'N/A'}",
        "initial=" + (_combined_proc_output(initial_proc)[-1600:] or "N/A"),
    ]
    if retry_proc is not None:
        parts.append("retry=" + (_combined_proc_output(retry_proc)[-1600:] or "N/A"))
    return _result_from_error(
        "SOLAR_CHATGPT_NO_OUTPUT",
        "\n".join(parts)[-4000:],
        retryable=True,
    )


def _next_child_dir(parent: Path, base_name: str) -> Path:
    """Return a retry child path that will not reuse stale browser artifacts."""
    candidate = parent / base_name
    if not candidate.exists():
        return candidate
    for index in range(2, 100):
        candidate = parent / f"{base_name}-{index}"
        if not candidate.exists():
            return candidate
    return parent / f"{base_name}-{_now_slug()}"


def _normalize_structured_result(operator_id: str, structured: Any, request: dict[str, Any]) -> Any:
    if operator_id == "BrowserLeaderPlanner":
        return _normalize_leader_planner_result(structured, request)
    if operator_id == "BrowserResearcher":
        return _normalize_researcher_result(structured, request)
    return structured


_LEADER_PLANNER_FALLBACK_TRACKS: list[dict[str, Any]] = [
    {
        "name": "技术演进与代际分叉",
        "question": "这个技术或公司谱系从哪些早期假设、论文、产品接口和系统约束演化而来，哪些分叉真正改变了控制点？",
        "assetTypes": ["evidenceCard", "evolutionEvent", "sotaFinding"],
        "sourcesToFind": ["paper", "system_doc", "company_source"],
        "falsificationChecks": ["若公开材料只能证明营销叙事而不能证明技术路线，应收窄结论。"],
        "expectedReportUse": "建立时间线和技术路线分叉。",
    },
    {
        "name": "架构栈与接口控制点",
        "question": "核心价值沉淀在模型、训练控制面、推理运行时、数据闭环、评测环境、开发者接口还是应用层？",
        "assetTypes": ["evidenceCard", "stackNode", "interfaceEdge"],
        "sourcesToFind": ["system_doc", "repo", "benchmark", "company_source"],
        "falsificationChecks": ["若只有应用包装而没有可复用系统接口，应降低平台型判断。"],
        "expectedReportUse": "判断技术壁垒和可投资控制点。",
    },
    {
        "name": "SOTA 路线与可验证指标",
        "question": "哪些论文、benchmark、速度/成本/准确率指标或公开 demo 能证明路线优于替代方案？",
        "assetTypes": ["evidenceCard", "sotaFinding", "bottleneckCard"],
        "sourcesToFind": ["paper", "benchmark", "repo"],
        "falsificationChecks": ["若指标不可复现或只覆盖窄任务，应明确外推边界。"],
        "expectedReportUse": "支撑技术先进性和局限。",
    },
    {
        "name": "关键 Actor 与资本动作",
        "question": "哪些公司、实验室、创始人、投资机构和基础设施供应商在塑造这个方向，资源与能力如何分布？",
        "assetTypes": ["evidenceCard", "actorCard", "opportunityHypothesis"],
        "sourcesToFind": ["company_source", "market_data", "expert_interview"],
        "falsificationChecks": ["若融资或声量无法对应到技术资产，应区分资本叙事和技术验证。"],
        "expectedReportUse": "形成投资热点谱系和竞争格局。",
    },
    {
        "name": "瓶颈、反例与失败模式",
        "question": "这个方向最可能被哪些数据、算力、延迟、可靠性、安全、商业化或组织瓶颈卡住？",
        "assetTypes": ["evidenceCard", "bottleneckCard", "contradiction"],
        "sourcesToFind": ["paper", "benchmark", "system_doc", "market_data"],
        "falsificationChecks": ["主动寻找与主判断相反的证据和失败案例。"],
        "expectedReportUse": "避免单向乐观，形成反方审稿材料。",
    },
    {
        "name": "弱信号与机会假设",
        "question": "有哪些尚未被主流叙事充分定价的接口、成本曲线、开源项目、招聘/合作信号或新产品形态？",
        "assetTypes": ["evidenceCard", "weakSignal", "opportunityHypothesis"],
        "sourcesToFind": ["repo", "company_source", "market_data", "expert_interview"],
        "falsificationChecks": ["若弱信号缺少独立来源交叉验证，应标记为观察点而非结论。"],
        "expectedReportUse": "生成投资观察清单和后续跟踪指标。",
    },
]


def _normalize_leader_planner_result(structured: Any, request: dict[str, Any]) -> Any:
    if not isinstance(structured, dict):
        return structured
    central_question = str(structured.get("centralQuestion") or "").strip()
    if not central_question:
        return structured

    raw_tracks = structured.get("workstreams")
    track_key = "workstreams"
    if not isinstance(raw_tracks, list):
        raw_tracks = structured.get("researchTracks")
        track_key = "researchTracks"
    tracks = [item for item in raw_tracks if isinstance(item, dict)] if isinstance(raw_tracks, list) else []
    if len(tracks) >= 6:
        normalized = dict(structured)
        normalized[track_key] = _normalize_leader_track_asset_types(tracks)
        _ensure_leader_research_os_defaults(normalized, request, changed=False)
        return normalized

    existing_names = {str(item.get("name") or item.get("title") or "").strip().lower() for item in tracks}
    next_index = len(tracks) + 1
    appended: list[dict[str, Any]] = []
    for template in _LEADER_PLANNER_FALLBACK_TRACKS:
        if len(tracks) + len(appended) >= 6:
            break
        if str(template["name"]).lower() in existing_names:
            continue
        track = dict(template)
        track["key"] = f"r{next_index}"
        appended.append(track)
        next_index += 1

    normalized = dict(structured)
    normalized[track_key] = _normalize_leader_track_asset_types(tracks + appended)
    _ensure_leader_research_os_defaults(normalized, request, changed=True)
    return normalized


def _normalize_leader_track_asset_types(tracks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    defaults = [
        ["evidenceCard", "evolutionEvent", "sotaFinding"],
        ["evidenceCard", "stackNode", "interfaceEdge"],
        ["evidenceCard", "sotaFinding", "bottleneckCard"],
        ["evidenceCard", "actorCard", "opportunityHypothesis"],
        ["evidenceCard", "bottleneckCard", "contradiction"],
        ["evidenceCard", "weakSignal", "opportunityHypothesis"],
    ]
    normalized: list[dict[str, Any]] = []
    for index, track in enumerate(tracks):
        item = dict(track)
        raw_asset_types = item.get("assetTypes")
        asset_types = [
            str(value).strip()
            for value in (raw_asset_types if isinstance(raw_asset_types, list) else [])
            if str(value).strip() in RESEARCH_OS_ASSET_TYPES
        ]
        if "evidenceCard" not in asset_types:
            asset_types.insert(0, "evidenceCard")
        for value in defaults[index % len(defaults)]:
            if value not in asset_types:
                asset_types.append(value)
        item["assetTypes"] = asset_types[:4]
        normalized.append(item)
    return normalized


def _ensure_leader_research_os_defaults(
    normalized: dict[str, Any],
    request: dict[str, Any],
    *,
    changed: bool,
) -> None:
    coverage = normalized.get("coverageRequirements")
    if not isinstance(coverage, list):
        coverage = []
    normalized["coverageRequirements"] = [
        *coverage,
        "至少覆盖技术演进、架构栈、SOTA 指标、Actor/资本动作、瓶颈反例、弱信号机会六类研究轨道。",
    ]
    mandatory = normalized.get("mandatoryArtifacts")
    if not isinstance(mandatory, list) or len(mandatory) < 6:
        normalized["mandatoryArtifacts"] = [
            "EvolutionLedger",
            "ArchitectureStackMap",
            "SotaRouteMap",
            "ActorGraph",
            "BottleneckLedger",
            "ContradictionMatrix",
            "WeakSignalLedger",
            "OpportunityMap",
            "EvidenceCards",
        ]
    topic = str(request.get("topic") or "")
    central_question = str(normalized.get("centralQuestion") or "").strip()
    if re.search(r"\bneo[\s-]*labs?\b", topic, flags=re.IGNORECASE) and not re.search(
        r"生态|谱系|research-first|neo-labs", central_question, flags=re.IGNORECASE
    ):
        normalized["centralQuestion"] = (
            "美国 research-first AI neo-labs 生态的主要技术方向、投资热点谱系与可验证控制点是什么？"
        )
    normalized.setdefault("sourcePolicy", {
        "primarySourcesFirst": True,
        "allowedSourceTypes": ["paper", "repo", "benchmark", "system_doc", "company_source", "expert_interview", "market_data"],
        "avoid": ["unsourced summaries", "generic trend claims", "marketing copy treated as fact"],
    })
    meta = normalized.get("normalization")
    normalized["normalization"] = {
        **(meta if isinstance(meta, dict) else {}),
        "applied": True,
        "reason": "leader_planner_research_os_defaults" if not changed else "leader_planner_research_tracks_lt_6",
        "topic": str(request.get("topic") or "")[:200],
    }


def _normalize_researcher_result(structured: Any, request: dict[str, Any]) -> Any:
    if not isinstance(structured, dict):
        return structured
    source_notes = _list_from_structured(structured, ["sourceNotes"])
    observations = _list_from_structured(structured, ["observations"])
    evidence_cards = _list_from_structured(structured, ["evidenceCards"])
    if evidence_cards or not source_notes or not observations:
        return structured

    source_by_key = {
        str(item.get("key") or "").strip(): item
        for item in source_notes
        if isinstance(item, dict) and str(item.get("key") or "").strip()
    }
    generated: list[dict[str, Any]] = []
    for index, observation in enumerate(observations, start=1):
        if not isinstance(observation, dict):
            continue
        claim = str(observation.get("claim") or "").strip()
        if not claim:
            continue
        source_keys = [
            str(item).strip()
            for item in (observation.get("supportingSourceKeys") or [])
            if str(item).strip()
        ]
        source = source_by_key.get(source_keys[0]) if source_keys else None
        generated.append(
            {
                "key": f"ev{index}",
                "claim": claim,
                "mechanism": str(observation.get("mechanism") or "").strip(),
                "sourceKeys": source_keys,
                "sourceTitle": str((source or {}).get("sourceTitle") or "").strip(),
                "url": str((source or {}).get("url") or "").strip(),
                "fact": str((source or {}).get("relevantFact") or "").strip(),
                "limitation": str(
                    observation.get("counterpointOrLimit")
                    or (source or {}).get("limitation")
                    or ""
                ).strip(),
                "reportUse": str(observation.get("reportUse") or "").strip(),
            }
        )

    if not generated:
        return structured
    normalized = dict(structured)
    normalized["evidenceCards"] = generated
    meta = normalized.get("normalization")
    normalized["normalization"] = {
        **(meta if isinstance(meta, dict) else {}),
        "applied": True,
        "reason": "researcher_observations_to_evidence_cards",
        "sourceNoteCount": len(source_notes),
        "observationCount": len(observations),
        "evidenceCardCount": len(generated),
        "track": str((structured.get("track") or {}).get("name") or request.get("topic") or "")[:200],
    }
    return normalized


def _text_from_structured(value: Any, keys: list[str]) -> str:
    if not isinstance(value, dict):
        return ""
    chunks: list[str] = []
    for key in keys:
        item = value.get(key)
        if isinstance(item, str):
            chunks.append(item)
    return "\n".join(chunks)


def _list_from_structured(value: Any, keys: list[str]) -> list[Any]:
    if not isinstance(value, dict):
        return []
    for key in keys:
        item = value.get(key)
        if isinstance(item, list):
            return item
    return []


def _asset_type_set(value: Any) -> set[str]:
    assets = _list_from_structured(value, ["assets", "researchAssets"])
    evidence_cards = _list_from_structured(value, ["evidenceCards"])
    types = {str(asset.get("type") or "").strip() for asset in assets if isinstance(asset, dict)}
    if evidence_cards:
        types.add("evidenceCard")
    return {item for item in types if item}


def _report_package_markdown(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    body = _text_from_structured(value, ["executiveBriefMarkdown", "standardReportMarkdown"])
    if not body:
        body = _text_from_structured(value, ["summary", "conclusion"])
        sections = value.get("sections")
        if isinstance(sections, list):
            for section in sections:
                if isinstance(section, dict):
                    body += "\n" + _text_from_structured(section, ["heading", "body"])
    return body


def _researcher_body_text(value: Any) -> str:
    """Build enough semantic text from the BrowserResearcher synthesis schema."""
    body = _text_from_structured(value, ["summary", "fullMarkdown", "summaryForSynthesis"])
    if not isinstance(value, dict):
        return body
    chunks: list[str] = [body]
    for source_note in _list_from_structured(value, ["sourceNotes"]):
        if isinstance(source_note, dict):
            chunks.append(
                _text_from_structured(
                    source_note,
                    ["sourceTitle", "relevantFact", "supportedClaim", "limitation"],
                )
            )
    for observation in _list_from_structured(value, ["observations"]):
        if isinstance(observation, dict):
            chunks.append(
                _text_from_structured(
                    observation,
                    ["claim", "mechanism", "counterpointOrLimit", "reportUse"],
                )
            )
    return "\n".join(chunk for chunk in chunks if chunk.strip())


PUBLIC_REPORT_FORBIDDEN_PATTERNS: list[tuple[str, str]] = [
    ("internal_asset_id", r"\basset-\d+\b"),
    ("internal_thesis_id", r"\bthesis-\d+\b"),
    ("internal_evidence_id", r"\bev-\d+\b"),
    ("internal_counter_id", r"\bcounter-\d+\b"),
    ("internal_mapping_section", r"研究资产到论点映射"),
    ("research_os_jargon", r"ResearchAssetLedger|ThesisGraph|ReportPackage|EvidenceCards"),
    (
        "internal_field_jargon",
        r"\bevidenceIds\b|assetIds|thesisIds|workstreamId|counterEvidenceIds|thesisBindings|"
        r"\b(?:payload|schema|stage|operator)\s*[:=]",
    ),
    ("backstage_jargon", r"内部流水线|内部字段|内部编号|内部追踪|实体门控|内部门控|质量门控|证据边界|上游(?:材料|字段|输入|算子|流程)"),
    ("self_referential_report_plan", r"我(?:将|会|需要|正在)|下面(?:从|将)|本报告将|本文将"),
    ("related_material_spam", r"相关材料(?:\s*[、,，]\s*相关材料){1,}"),
    ("collapsed_internal_table", r"\|\s*-{3,}\s*\|\s*-{3,}[\s\S]{0,800}(?:相关材料|\bcounter-\d+\b|evidenceIds|assetIds|thesisIds)"),
]

BAD_HEADING_PATTERNS: list[tuple[str, str]] = [
    ("mechanical_heading_zh", r"^#{1,4}\s*(判断|证据|证据链|重要性|不确定性|风险提示|来源说明|材料边界)\s*[:：]?\s*$"),
    ("mechanical_heading_en", r"^#{1,4}\s*(Claim|Evidence|Uncertainty|Importance|Source Notes)\s*[:：]?\s*$"),
]


def _validate_public_report_language(operator_id: str, body: str) -> None:
    if operator_id != "BrowserLongformWriter":
        return
    for name, pattern in PUBLIC_REPORT_FORBIDDEN_PATTERNS:
        if re.search(pattern, body, flags=re.IGNORECASE):
            raise RuntimeError(f"chatgpt_result_invalid:{operator_id}:public_report_internal_jargon:{name}")
    for line in body.splitlines():
        if not line.lstrip().startswith("#"):
            continue
        for name, pattern in BAD_HEADING_PATTERNS:
            if re.search(pattern, line.strip(), flags=re.IGNORECASE):
                raise RuntimeError(f"chatgpt_result_invalid:{operator_id}:public_report_mechanical_heading:{name}")


PUBLIC_REPORT_LANGUAGE_REPLACEMENTS: list[tuple[str, str]] = [
    (r"\basset-\d+\b", "相关事实"),
    (r"\bthesis-\d+\b", "核心判断"),
    (r"\bev-\d+\b", "证据"),
    (r"\bcounter-\d+\b", "反方证据"),
    (r"研究资产到论点映射", "关键事实如何支撑核心判断"),
    (r"ResearchAssetLedger", "研究材料清单"),
    (r"ThesisGraph", "核心判断结构"),
    (r"ReportPackage", "报告正文"),
    (r"EvidenceCards", "证据卡片"),
    (r"证据边界", "公开证据能够支持的范围"),
    (r"实体门控", "主体辨析"),
    (r"内部门控", "内部判断"),
    (r"质量门控", "质量审核"),
    (r"上游材料", "公开材料"),
    (r"上游字段", "公开信息"),
    (r"上游输入", "公开信息"),
    (r"上游算子", "前置分析"),
    (r"上游流程", "前置分析"),
    (r"内部流水线", "分析流程"),
    (r"内部字段", "内部信息"),
    (r"内部编号", "编号"),
    (r"内部追踪", "后续跟踪"),
    (r"相关材料", "公开材料"),
    (r"本报告将", "分析将"),
    (r"本文将", "下文会"),
    (r"我(?:将|会|需要|正在)", "分析会"),
    (r"下面(?:从|将)", "接下来从"),
    (r"不应被理解为", "更适合理解为"),
    (r"不应被写成", "更适合理解为"),
    (r"不应把([^。；;]{1,80}?)写成", r"\1尚不足以被视为"),
    (r"不应把", "更适合避免把"),
    (r"不应被放进", "更适合避免放进"),
    (r"不应只比较", "仅比较"),
    (r"不应只看", "仅看"),
    (r"不能过度外推", "外推空间有限"),
    (r"评价这两类系统不能只看", "评价这两类系统时，仅看"),
    (r"\bevidenceIds\b|assetIds|thesisIds|workstreamId|counterEvidenceIds|thesisBindings", "证据线索"),
    (r"\b(?:payload|schema|stage|operator)\s*[:=][^\n|]*", ""),
]


def _sanitize_public_report_markdown(text: str) -> tuple[str, list[str]]:
    """Convert repairable process/backstage wording into reader-facing report language."""
    if not text:
        return text, []
    sanitized = text
    fixes: list[str] = []
    for pattern, replacement in PUBLIC_REPORT_LANGUAGE_REPLACEMENTS:
        updated = re.sub(pattern, replacement, sanitized, flags=re.IGNORECASE)
        if updated != sanitized:
            fixes.append(pattern)
            sanitized = updated
    cleaned_lines: list[str] = []
    removed_table_rows = 0
    for line in sanitized.splitlines():
        is_table_row = line.lstrip().startswith("|")
        if is_table_row and re.search(
            r"证据线索|核心判断|反方证据|公开材料(?:\s*[、,，]\s*公开材料){1,}",
            line,
            flags=re.IGNORECASE,
        ):
            removed_table_rows += 1
            continue
        cleaned_lines.append(line)
    if removed_table_rows:
        fixes.append("removed_internal_mapping_table_rows")
        sanitized = "\n".join(cleaned_lines)
    sanitized = re.sub(r"\n{4,}", "\n\n\n", sanitized).strip()
    return sanitized, fixes


def _sanitize_public_report_structured(structured: Any) -> tuple[Any, bool, list[str]]:
    if not isinstance(structured, dict):
        return structured, False, []
    sanitized = json.loads(json.dumps(structured, ensure_ascii=False))
    fixes: list[str] = []
    for key in ("executiveBriefMarkdown", "standardReportMarkdown", "summary", "conclusion"):
        if isinstance(sanitized.get(key), str):
            value, value_fixes = _sanitize_public_report_markdown(sanitized[key])
            sanitized[key] = value
            fixes.extend(f"{key}:{item}" for item in value_fixes)
    sections = sanitized.get("sections")
    if isinstance(sections, list):
        for index, section in enumerate(sections):
            if not isinstance(section, dict):
                continue
            for key in ("heading", "body"):
                if isinstance(section.get(key), str):
                    value, value_fixes = _sanitize_public_report_markdown(section[key])
                    section[key] = value
                    fixes.extend(f"sections[{index}].{key}:{item}" for item in value_fixes)
    return sanitized, bool(fixes), fixes


def _validate_chatgpt_structured_result(operator_id: str, structured: Any, markdown: str) -> None:
    if not isinstance(structured, dict):
        raise RuntimeError(f"chatgpt_result_invalid:{operator_id}:structured_not_object")
    if "rawText" in structured:
        raise RuntimeError(
            f"chatgpt_result_invalid:{operator_id}:strict_json_not_returned:"
            f"chars={len(markdown)}"
        )
    if operator_id == "BrowserLeaderPlanner":
        workstreams = structured.get("workstreams") or structured.get("researchTracks")
        central_question = str(structured.get("centralQuestion") or "").strip()
        if not central_question:
            raise RuntimeError("chatgpt_result_invalid:BrowserLeaderPlanner:missing_central_question")
        if not isinstance(workstreams, list) or len(workstreams) < 6:
            raise RuntimeError("chatgpt_result_invalid:BrowserLeaderPlanner:research_tracks_lt_6")
        return
    if operator_id == "BrowserResearcher":
        assets = _list_from_structured(structured, ["assets", "researchAssets"])
        evidence_cards = _list_from_structured(structured, ["evidenceCards"])
        source_notes = _list_from_structured(structured, ["sourceNotes"])
        observations = _list_from_structured(structured, ["observations"])
        asset_types = _asset_type_set(structured)
        body = _researcher_body_text(structured)
        if len(assets) + len(evidence_cards) + len(source_notes) < 4:
            raise RuntimeError("chatgpt_result_invalid:BrowserResearcher:source_notes_lt_4")
        if "evidenceCard" not in asset_types and not source_notes:
            raise RuntimeError("chatgpt_result_invalid:BrowserResearcher:missing_evidence_card")
        if len(observations) < 2:
            raise RuntimeError("chatgpt_result_invalid:BrowserResearcher:observations_lt_2")
        if len(body) < 800:
            raise RuntimeError(
                f"chatgpt_result_invalid:BrowserResearcher:body_too_short:{len(body)}"
            )
        return
    if operator_id == "BrowserAnalyst":
        writer_brief = structured.get("writerBrief")
        if isinstance(writer_brief, dict):
            sections = writer_brief.get("sections")
            if not isinstance(sections, list) or len(sections) < 3:
                raise RuntimeError("chatgpt_result_invalid:BrowserAnalyst:writer_brief_sections_lt_3")
            return
        theses = structured.get("theses")
        outline = structured.get("reportOutline")
        if not isinstance(theses, list) or len(theses) < 2:
            raise RuntimeError("chatgpt_result_invalid:BrowserAnalyst:missing_writer_brief_or_theses")
        if not isinstance(outline, list) or len(outline) < 3:
            raise RuntimeError("chatgpt_result_invalid:BrowserAnalyst:report_outline_lt_3")
        return
    if operator_id == "BrowserLongformWriter":
        body = _report_package_markdown(structured)
        if not str(structured.get("standardReportMarkdown") or "").strip():
            raise RuntimeError("chatgpt_result_invalid:BrowserLongformWriter:missing_standard_report")
        _validate_public_report_language(operator_id, body)
        if len(body) < 5000:
            raise RuntimeError(
                f"chatgpt_result_invalid:BrowserLongformWriter:body_too_short:{len(body)}"
            )
        return
    if operator_id == "BrowserCritic":
        if isinstance(structured.get("blockingIssues"), list) and isinstance(structured.get("recommendedEdits"), list):
            return
        issues = structured.get("criticalIssues")
        recommendations = structured.get("recommendations")
        if not isinstance(issues, list) or not isinstance(recommendations, list):
            raise RuntimeError("chatgpt_result_invalid:BrowserCritic:missing_review_lists")


def _parse_chatgpt_json_or_raw(text: str) -> Any:
    clean = _strip_json_fence(text)
    for candidate in (clean, _escape_raw_control_chars_in_json_strings(clean)):
        try:
            return json.loads(candidate)
        except Exception:
            pass
    extracted = _extract_first_json_object(clean)
    if extracted:
        for candidate in (extracted, _escape_raw_control_chars_in_json_strings(extracted)):
            try:
                return json.loads(candidate)
            except Exception:
                pass
    return {"rawText": text}


def _extract_parseable_json_text(text: str) -> str | None:
    clean = _strip_json_fence(text)
    candidates = [clean]
    extracted = _extract_first_json_object(clean)
    if extracted and extracted not in candidates:
        candidates.append(extracted)
    for candidate in candidates:
        for parse_candidate in (candidate, _escape_raw_control_chars_in_json_strings(candidate)):
            try:
                json.loads(parse_candidate)
                return parse_candidate
            except Exception:
                pass
    return None


def _extract_first_json_object(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        ch = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def _escape_raw_control_chars_in_json_strings(text: str) -> str:
    out: list[str] = []
    in_string = False
    escaped = False
    for ch in text:
        if in_string:
            if escaped:
                out.append(ch)
                escaped = False
                continue
            if ch == "\\":
                out.append(ch)
                escaped = True
                continue
            if ch == '"':
                out.append(ch)
                in_string = False
                continue
            if ch == "\n":
                out.append("\\n")
                continue
            if ch == "\r":
                out.append("\\r")
                continue
            if ch == "\t":
                out.append("\\t")
                continue
            out.append(ch)
            continue
        out.append(ch)
        if ch == '"':
            in_string = True
    return "".join(out)


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
            "centralQuestion": f"Dry-run central research question for {request.get('topic')}",
            "initialTheses": [
                {"id": "dry-thesis-1", "statement": "Dry-run thesis about architecture shift", "rationale": "bridge dry run"}
            ],
            "researchQuestions": [
                {"id": "dry-rq-1", "question": "What changed?", "whyItMatters": "It shapes the report frame."}
            ],
            "workstreams": [
                {
                    "id": "dry-ws-evolution",
                    "name": "Evolution ledger",
                    "question": "How did the technical lineage evolve?",
                    "artifactTargets": ["EvolutionLedger", "EvidenceCards"],
                    "evidenceNeeds": ["papers and release notes"],
                    "falsificationTargets": ["older systems already solved the same bottleneck"],
                },
                {
                    "id": "dry-ws-stack",
                    "name": "Architecture stack",
                    "question": "Which stack layers are changing?",
                    "artifactTargets": ["ArchitectureStackMap", "BottleneckLedger"],
                    "evidenceNeeds": ["system architecture descriptions"],
                    "falsificationTargets": ["change is only an application layer packaging effect"],
                },
                {
                    "id": "dry-ws-actors",
                    "name": "Actor graph",
                    "question": "Which actors are driving adoption?",
                    "artifactTargets": ["ActorGraph", "SotaRouteMap"],
                    "evidenceNeeds": ["labs, companies, repos, benchmark owners"],
                    "falsificationTargets": ["single actor artifact with no ecosystem movement"],
                },
                {
                    "id": "dry-ws-opportunity",
                    "name": "Opportunity map",
                    "question": "Where are the commercial or platform opportunities?",
                    "artifactTargets": ["OpportunityMap", "WeakSignalLedger", "ContradictionMatrix"],
                    "evidenceNeeds": ["weak signals and counter-evidence"],
                    "falsificationTargets": ["opportunity depends on unverified adoption"],
                },
                {
                    "id": "dry-ws-bottleneck",
                    "name": "Bottleneck ledger",
                    "question": "Which bottlenecks explain why this topic matters now?",
                    "artifactTargets": ["BottleneckLedger", "EvidenceCards"],
                    "evidenceNeeds": ["benchmarks, postmortems, architecture notes"],
                    "falsificationTargets": ["bottleneck is anecdotal or already resolved"],
                },
                {
                    "id": "dry-ws-counter",
                    "name": "Counter-evidence matrix",
                    "question": "What evidence would weaken the investment or technical thesis?",
                    "artifactTargets": ["ContradictionMatrix", "WeakSignalLedger"],
                    "evidenceNeeds": ["failed deployments, negative benchmarks, adoption limits"],
                    "falsificationTargets": ["counter-evidence is only generic caution"],
                },
            ],
            "mandatoryArtifacts": [
                "EvolutionLedger",
                "ArchitectureStackMap",
                "SotaRouteMap",
                "ActorGraph",
                "BottleneckLedger",
                "ContradictionMatrix",
                "WeakSignalLedger",
                "OpportunityMap",
                "EvidenceCards",
            ],
            "sourcePolicy": {"primaryFirst": True, "allowedSourceTypes": ["paper", "repo", "benchmark", "doc"]},
            "coverageRequirements": ["dry-run coverage requirement"],
            "falsificationQuestions": ["What evidence would make the central thesis weaker?"],
            "themeSummary": f"Dry-run plan for {request.get('topic')}",
            "dimensions": [
                {"id": "dry-ws-evolution", "name": "Evolution ledger", "rationale": "legacy scheduling shell"},
                {"id": "dry-ws-stack", "name": "Architecture stack", "rationale": "legacy scheduling shell"},
                {"id": "dry-ws-actors", "name": "Actor graph", "rationale": "legacy scheduling shell"},
                {"id": "dry-ws-opportunity", "name": "Opportunity map", "rationale": "legacy scheduling shell"},
                {"id": "dry-ws-bottleneck", "name": "Bottleneck ledger", "rationale": "legacy scheduling shell"},
                {"id": "dry-ws-counter", "name": "Counter-evidence matrix", "rationale": "legacy scheduling shell"},
            ],
        }
    elif operator_id == "BrowserAnalyst":
        structured = {
            "theses": [
                {
                    "id": "dry-thesis-1",
                    "statement": "Dry-run thesis connects assets to architecture shift.",
                    "mechanism": "Dry-run mechanism",
                    "architectureImplication": "Dry-run architecture implication",
                    "opportunityImplication": "Dry-run opportunity implication",
                    "limitations": ["Dry-run limitation"],
                    "evidenceIds": ["dry-ev-1"],
                    "counterEvidenceIds": ["dry-counter-1"],
                },
                {
                    "id": "dry-thesis-2",
                    "statement": "Dry-run thesis captures ecosystem opportunity.",
                    "mechanism": "Dry-run opportunity mechanism",
                    "architectureImplication": "Dry-run platform implication",
                    "opportunityImplication": "Dry-run opportunity map",
                    "limitations": ["Dry-run adoption uncertainty"],
                    "evidenceIds": ["dry-ev-2"],
                    "counterEvidenceIds": [],
                },
            ],
            "claimEdges": [{"from": "dry-thesis-1", "to": "dry-thesis-2", "relation": "supports"}],
            "evidenceBindings": [
                {"thesisId": "dry-thesis-1", "evidenceId": "dry-ev-1", "role": "support"},
                {"thesisId": "dry-thesis-2", "evidenceId": "dry-ev-2", "role": "support"},
            ],
            "counterEvidence": [{"id": "dry-counter-1", "claim": "Dry-run counterpoint", "evidence": "Dry-run evidence"}],
            "openQuestions": ["Dry-run open question"],
            "reportOutline": [
                {"id": "dry-sec-1", "heading": "Central question", "thesisIds": ["dry-thesis-1"], "evidenceIds": ["dry-ev-1"]},
                {"id": "dry-sec-2", "heading": "Architecture implication", "thesisIds": ["dry-thesis-1"], "evidenceIds": ["dry-ev-1"]},
                {"id": "dry-sec-3", "heading": "Opportunity map", "thesisIds": ["dry-thesis-2"], "evidenceIds": ["dry-ev-2"]},
            ],
            "themeSummary": f"Dry-run insight for {request.get('topic')}",
            "coreInsights": [{"title": "Dry-run insight", "summary": "bridge dry run"}],
            "diagramBriefs": [{"id": "dry-fig-1", "caption": "Dry-run diagram"}],
        }
    elif operator_id == "BrowserResearcher":
        payload = _base_payload(request)
        dimension = payload.get("dimension") if isinstance(payload, dict) else None
        dimension_name = (
            dimension.get("name")
            if isinstance(dimension, dict)
            else dimension
        )
        structured = {
            "workstream": {"id": "dry-ws", "name": str(dimension_name or "Dry-run workstream")},
            "assets": [
                {
                    "id": "dry-asset-evolution",
                    "type": "evolutionEvent",
                    "title": "Dry-run evolution event",
                    "summary": "Dry-run lineage signal.",
                    "claim": "Dry-run claim",
                    "evidenceIds": ["dry-ev-1"],
                    "sourceUrls": ["https://example.com/dry-run-source"],
                    "confidence": "medium",
                },
                {
                    "id": "dry-asset-stack",
                    "type": "stackNode",
                    "title": "Dry-run stack node",
                    "summary": "Dry-run stack signal.",
                    "claim": "Dry-run stack claim",
                    "evidenceIds": ["dry-ev-1"],
                    "sourceUrls": ["https://example.com/dry-run-source"],
                    "confidence": "medium",
                },
                {
                    "id": "dry-asset-bottleneck",
                    "type": "bottleneckCard",
                    "title": "Dry-run bottleneck",
                    "summary": "Dry-run bottleneck signal.",
                    "claim": "Dry-run bottleneck claim",
                    "evidenceIds": ["dry-ev-1"],
                    "sourceUrls": ["https://example.com/dry-run-source"],
                    "confidence": "medium",
                },
            ],
            "evidenceCards": [
                {
                    "id": "dry-ev-1",
                    "title": "Dry-run evidence",
                    "claim": "Dry-run evidence-backed claim",
                    "evidence": "Dry-run evidence card",
                    "sourceUrl": "https://example.com/dry-run-source",
                    "sourceTitle": "Dry-run source",
                    "sourceType": "other",
                    "confidence": "medium",
                }
            ],
            "coverageNotes": ["Dry-run coverage note"],
            "dimension": str(dimension_name or "Dry-run dimension"),
            "summary": "Dry-run grounded research summary",
            "findings": [
                {
                    "claim": "Dry-run claim",
                    "evidence": "Dry-run evidence",
                    "source": "https://example.com/dry-run-source",
                    "sourceTitle": "Dry-run source",
                }
            ],
            "fullMarkdown": "Dry-run dimension report with grounded evidence.",
        }
    elif operator_id == "BrowserLongformWriter":
        long_paragraph = (
            "Dry-run research paragraph connects evidence cards, architecture mechanism, counterpoint, and opportunity. "
            "It is intentionally verbose enough to exercise downstream report gates without pretending to be a real report. "
        )
        standard_report = "\n\n".join(
            [
                "# Dry-run research-os report",
                "## Central conclusion\nThis dry-run report presents reader-facing claims without internal evidence binding tables.",
                "## Central question\n" + long_paragraph * 12,
                "## Architecture implication\n" + long_paragraph * 12,
                "## Opportunity map\n" + long_paragraph * 12,
                "## Limits and counter-evidence\n" + long_paragraph * 12,
            ]
        )
        structured = {
            "title": str(request.get("topic") or "Dry-run report"),
            "dek": "Dry-run subtitle for prompt contract verification.",
            "executiveBriefMarkdown": "Dry-run executive brief with evidence-backed claims.",
            "standardReportMarkdown": standard_report,
            "references": [
                {
                    "title": "Dry-run source",
                    "url": "https://example.com/dry-run-source",
                    "relevance": "Supports the dry-run contract check.",
                }
            ],
        }
    elif operator_id == "BrowserCritic":
        structured = {
            "publishDecision": "pass",
            "blockingIssues": [],
            "unsupportedClaims": [],
            "styleLeaks": [],
            "lowValuePassages": [],
            "recommendedEdits": ["Dry-run critic passed"],
        }
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
        "Recovery: inspect the task_dir preflight artifacts, then open the browser-agent "
        f"Chrome profile selected by policy key {DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY} "
        "and repair that dedicated GenesisPod policy if login_wall/challenge_wall is present. "
        "Do not fall back to the AI Influence policy because that reintroduces shared leases."
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
        provider = _provider_for_operator(operator_id)
        _json_dump(
            task_dir / "provider-router.json",
            {
                "operatorId": operator_id,
                "provider": provider,
                "defaultProvider": DEFAULT_OPERATOR_PROVIDERS.get(operator_id),
                "envDiagnostics": _provider_env_diagnostics(),
            },
        )
        if provider == DEEPSEEK_API_PROVIDER:
            result = _run_api_provider_operator(request, provider=provider, task_dir=task_dir)
            _json_dump(task_dir / "genesis-solar-operator-result.json", result)
            return result
        if provider == OPENAI_COMPATIBLE_PROVIDER:
            result = _result_from_error(
                "OPENAI_COMPATIBLE_DISABLED_FOR_DEEP_INSIGHT_SOLAR",
                (
                    "openai_compatible is disabled for deep-insight-solar main-chain "
                    f"operator {operator_id}; ThunderOMLX/local OpenAI-compatible surfaces "
                    "are reserved for embedding/local utility work. Use chatgpt_browser or "
                    "deepseek_api instead."
                ),
                retryable=False,
            )
            _json_dump(task_dir / "genesis-solar-operator-result.json", result)
            return result
        if provider != CHATGPT_BROWSER_PROVIDER:
            result = _result_from_error(
                "UNSUPPORTED_SOLAR_PROVIDER",
                (
                    f"unsupported provider {provider!r} for {operator_id}; "
                    f"supported={CHATGPT_BROWSER_PROVIDER},{DEEPSEEK_API_PROVIDER},{OPENAI_COMPATIBLE_PROVIDER}"
                ),
                retryable=False,
            )
            _json_dump(task_dir / "genesis-solar-operator-result.json", result)
            return result
        if operator_id == "BrowserLongformWriter":
            reusable = _load_reusable_writer_result(task_dir, request)
            if reusable is not None:
                structured, markdown, metrics = reusable
                result = {
                    "status": "succeeded",
                    "structured": structured,
                    "markdown": markdown,
                    "evidence": [],
                    "artifacts": [],
                    "metrics": metrics,
                    "rawTranscriptUri": str(metrics.get("resultArtifact") or task_dir / "chatgpt-browser-agent-output.txt"),
                }
                _json_dump(
                    task_dir / "chatgpt-browser-agent-result.reused.json",
                    {
                        "operatorId": operator_id,
                        "resultArtifact": metrics.get("resultArtifact"),
                        "recoveredArtifact": metrics.get("recoveredArtifact"),
                        "publicLanguageRecovered": metrics.get("publicLanguageRecovered", False),
                    },
                )
                _json_dump(task_dir / "genesis-solar-operator-result.json", result)
                return result
        try:
            preflight = _chatgpt_preflight(
                request,
                policy_key=DEEP_INSIGHT_SOLAR_PROFILE_POLICY_KEY,
                operator_id=CHATGPT_OPERATOR_IDS[operator_id],
                task_dir=task_dir,
            )
            _json_dump(task_dir / "chatgpt-preflight.json", preflight)
        except AuthRepairRequired as exc:
            result = _result_from_error(
                AUTH_REPAIR_REQUIRED_CODE,
                str(exc),
                retryable=False,
            )
            _json_dump(task_dir / "chatgpt-preflight.json", result)
            _json_dump(task_dir / "genesis-solar-operator-result.json", result)
            return result
        except FlowControlCooldown as exc:
            result = _result_from_error(
                FLOW_CONTROL_COOLDOWN_CODE,
                str(exc),
                retryable=True,
            )
            _json_dump(task_dir / "chatgpt-preflight.json", result)
            _json_dump(task_dir / "genesis-solar-operator-result.json", result)
            return result
        except Exception as exc:
            result = _result_from_error(
                "CHATGPT_PREFLIGHT_FAILED",
                _preflight_failure_message(exc),
                retryable=True,
            )
            _json_dump(task_dir / "chatgpt-preflight.json", result)
            _json_dump(task_dir / "genesis-solar-operator-result.json", result)
            return result
        try:
            proc = _run_operator_with_cooldown_retry(
                CHATGPT_OPERATOR,
                _chatgpt_envelope(request),
                task_dir,
            )
        except FlowControlCooldown as exc:
            result = _result_from_error(
                FLOW_CONTROL_COOLDOWN_CODE,
                str(exc),
                retryable=True,
            )
            _json_dump(task_dir / "genesis-solar-operator-result.json", result)
            return result
        chatgpt_result_task_dir = task_dir
        if proc.returncode != 0:
            task_dir_retry_reason = _chatgpt_browser_task_dir_retry_reason(task_dir)
            if operator_id in {"BrowserLeaderPlanner", "BrowserLongformWriter", "BrowserCritic"} and (
                _chatgpt_browser_proc_retryable(proc) or task_dir_retry_reason
            ):
                combined_reason = (_combined_proc_output(proc)[-1200:] or task_dir_retry_reason)
                if "submitted_without_generation" in task_dir_retry_reason:
                    retry_request = request
                    retry_mode = (
                        "writer_fresh_session_after_no_generation"
                        if operator_id == "BrowserLongformWriter"
                        else "critic_fresh_session_after_no_generation"
                        if operator_id == "BrowserCritic"
                        else "leader_planner_fresh_session_after_no_generation"
                    )
                else:
                    if operator_id == "BrowserCritic":
                        retry_request = request
                        retry_mode = "critic_fresh_session_after_no_output"
                    elif operator_id != "BrowserLeaderPlanner":
                        return _result_from_error(
                            "SOLAR_CHATGPT_OPERATOR_FAILED",
                            _combined_proc_output(proc)[-4000:],
                        )
                    else:
                        retry_request = _leader_planner_repair_retry_request(
                            request,
                            {"rawText": _latest_chatgpt_invalid_output_preview(task_dir)},
                            combined_reason,
                        )
                        retry_mode = "leader_planner_json_repair"
                retry_task_dir = (
                    _next_child_dir(task_dir, "writer-retry-1")
                    if operator_id == "BrowserLongformWriter"
                    else _next_child_dir(task_dir, "critic-retry-1")
                    if operator_id == "BrowserCritic"
                    else task_dir
                )
                retry_request_dir_name = _next_child_dir(
                    task_dir,
                    "chatgpt-browser-agent-request-retry-1",
                ).name
                retry_envelope = _chatgpt_browser_retry_envelope(
                    retry_request,
                    task_dir=task_dir,
                    retry_request_dir_name=retry_request_dir_name,
                )
                _json_dump(
                    task_dir / "chatgpt-browser-agent-json-repair-retry.json",
                    {
                        "reason": combined_reason,
                        "retryMode": retry_mode,
                        "operatorId": operator_id,
                        "retryRequestDir": retry_envelope["chatgpt_browser_agent_request"].get("request_dir"),
                    },
                )
                try:
                    retry_proc = _run_operator_with_cooldown_retry(
                        CHATGPT_OPERATOR,
                        retry_envelope,
                        retry_task_dir,
                    )
                except FlowControlCooldown as exc:
                    result = _result_from_error(
                        FLOW_CONTROL_COOLDOWN_CODE,
                        str(exc),
                        retryable=True,
                    )
                    _json_dump(task_dir / "genesis-solar-operator-result.json", result)
                    return result
                if retry_proc.returncode == 0:
                    proc = retry_proc
                    chatgpt_result_task_dir = retry_task_dir
                else:
                    if operator_id == "BrowserCritic":
                        return _chatgpt_no_output_failure_result(
                            operator_id,
                            initial_proc=proc,
                            retry_proc=retry_proc,
                            task_dir_retry_reason=task_dir_retry_reason,
                        )
                    return _result_from_error(
                        "SOLAR_CHATGPT_OPERATOR_FAILED",
                        (
                            "initial="
                            + _combined_proc_output(proc)[-1800:]
                            + "\nretry="
                            + _combined_proc_output(retry_proc)[-1800:]
                        )[-4000:],
                    )
            else:
                if operator_id == "BrowserCritic" and (
                    _chatgpt_browser_proc_retryable(proc) or task_dir_retry_reason
                ):
                    return _chatgpt_no_output_failure_result(
                        operator_id,
                        initial_proc=proc,
                        task_dir_retry_reason=task_dir_retry_reason,
                    )
                return _result_from_error(
                    "SOLAR_CHATGPT_OPERATOR_FAILED",
                    _combined_proc_output(proc)[-4000:],
                )
        if proc.returncode != 0:
            return _result_from_error(
                "SOLAR_CHATGPT_OPERATOR_FAILED",
                _combined_proc_output(proc)[-4000:],
            )
        try:
            structured, markdown, metrics = _load_chatgpt_result(chatgpt_result_task_dir)
        except Exception as exc:
            if operator_id == "BrowserCritic":
                result = _result_from_error(
                    "SOLAR_CHATGPT_NO_OUTPUT",
                    f"{operator_id} produced no usable ChatGPT generation: {exc}",
                    retryable=True,
                )
                _json_dump(task_dir / "genesis-solar-operator-result.json", result)
                return result
            result = _result_from_error(
                "SOLAR_CHATGPT_RESULT_INCOMPLETE",
                str(exc),
                retryable=True,
            )
            _json_dump(task_dir / "genesis-solar-operator-result.json", result)
            return result
        try:
            structured = _normalize_structured_result(operator_id, structured, request)
            _validate_chatgpt_structured_result(operator_id, structured, markdown)
        except Exception as exc:
            if operator_id == "BrowserLeaderPlanner":
                retry_request = _leader_planner_repair_retry_request(request, structured, exc)
                retry_request_dir_name = _next_child_dir(
                    task_dir,
                    "chatgpt-browser-agent-request-retry-1",
                ).name
                retry_envelope = _chatgpt_browser_retry_envelope(
                    retry_request,
                    task_dir=task_dir,
                    retry_request_dir_name=retry_request_dir_name,
                )
                _json_dump(
                    task_dir / "chatgpt-browser-agent-json-repair-retry.json",
                    {
                        "reason": str(exc),
                        "operatorId": operator_id,
                        "retryRequestDir": retry_envelope["chatgpt_browser_agent_request"].get("request_dir"),
                    },
                )
                try:
                    retry_proc = _run_operator_with_cooldown_retry(CHATGPT_OPERATOR, retry_envelope, task_dir)
                    if retry_proc.returncode != 0:
                        raise RuntimeError(_combined_proc_output(retry_proc)[-2000:])
                    structured, markdown, metrics = _load_chatgpt_result(task_dir)
                    structured = _normalize_structured_result(operator_id, structured, retry_request)
                    _validate_chatgpt_structured_result(operator_id, structured, markdown)
                    metrics = {
                        **metrics,
                        "retryReason": str(exc),
                        "retryMode": "leader_planner_json_repair",
                    }
                except Exception as retry_exc:
                    result = _result_from_error(
                        "SOLAR_CHATGPT_RESULT_INCOMPLETE",
                        f"{exc}; retry={retry_exc}",
                        retryable=True,
                    )
                    _json_dump(task_dir / "genesis-solar-operator-result.json", result)
                    return result
            elif operator_id == "BrowserLongformWriter" and (
                "public_report_internal_jargon" in str(exc)
                or "body_too_short" in str(exc)
                or "bad_heading" in str(exc)
                or "public_report_mechanical_heading" in str(exc)
            ):
                recovered_locally = False
                if "public_report_internal_jargon" in str(exc) or "public_report_mechanical_heading" in str(exc):
                    sanitized, changed, fixes = _sanitize_public_report_structured(structured)
                    if changed:
                        try:
                            _validate_chatgpt_structured_result(operator_id, sanitized, _report_package_markdown(sanitized))
                            structured = sanitized
                            markdown = _report_package_markdown(sanitized)
                            metrics = {
                                **metrics,
                                "publicLanguageRecovered": True,
                                "publicLanguageRecoveryReason": str(exc),
                                "publicLanguageFixes": fixes,
                            }
                            _json_dump(
                                task_dir / "chatgpt-browser-agent-public-language-recovery.json",
                                {
                                    "reason": str(exc),
                                    "operatorId": operator_id,
                                    "fixes": fixes,
                                },
                            )
                            recovered_locally = True
                        except Exception:
                            recovered_locally = False
                if recovered_locally:
                    pass
                elif "body_too_short" in str(exc):
                    retry_request = _writer_expansion_retry_request(request, structured)
                    retry_mode = "writer_body_expansion"
                else:
                    retry_request = _writer_public_language_retry_request(request, structured, exc)
                    retry_mode = "writer_public_language_rewrite"
                if not recovered_locally:
                    retry_task_dir = _next_child_dir(task_dir, "writer-retry-1")
                    retry_request_dir_name = _next_child_dir(
                        task_dir,
                        "chatgpt-browser-agent-request-retry-1",
                    ).name
                    retry_envelope = _chatgpt_browser_retry_envelope(
                        retry_request,
                        task_dir=task_dir,
                        retry_request_dir_name=retry_request_dir_name,
                    )
                    _json_dump(
                        task_dir / "chatgpt-browser-agent-writer-retry.json",
                        {
                            "reason": str(exc),
                            "retryMode": retry_mode,
                            "operatorId": operator_id,
                            "retryRequestDir": retry_envelope["chatgpt_browser_agent_request"].get("request_dir"),
                        },
                    )
                    try:
                        retry_proc = _run_operator_with_cooldown_retry(CHATGPT_OPERATOR, retry_envelope, retry_task_dir)
                        if retry_proc.returncode != 0:
                            raise RuntimeError(_combined_proc_output(retry_proc)[-2000:])
                        structured, markdown, metrics = _load_chatgpt_result(retry_task_dir)
                        structured = _normalize_structured_result(operator_id, structured, retry_request)
                        _validate_chatgpt_structured_result(operator_id, structured, markdown)
                        metrics = {
                            **metrics,
                            "retryReason": str(exc),
                            "retryMode": retry_mode,
                        }
                    except Exception as retry_exc:
                        result = _result_from_error(
                            "SOLAR_CHATGPT_RESULT_INCOMPLETE",
                            f"{exc}; retry={retry_exc}",
                            retryable=True,
                        )
                        _json_dump(task_dir / "genesis-solar-operator-result.json", result)
                        return result
            else:
                result = _result_from_error(
                    "SOLAR_CHATGPT_RESULT_INCOMPLETE",
                    str(exc),
                    retryable=True,
                )
                _json_dump(task_dir / "genesis-solar-operator-result.json", result)
                return result
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
        except AuthRepairRequired as exc:
            result = _result_from_error(
                AUTH_REPAIR_REQUIRED_CODE,
                str(exc),
                retryable=False,
            )
            _json_dump(task_dir / "chatgpt-preflight.json", result)
            _json_dump(task_dir / "genesis-solar-operator-result.json", result)
            return result
        except FlowControlCooldown as exc:
            result = _result_from_error(
                FLOW_CONTROL_COOLDOWN_CODE,
                str(exc),
                retryable=True,
            )
            _json_dump(task_dir / "chatgpt-preflight.json", result)
            _json_dump(task_dir / "genesis-solar-operator-result.json", result)
            return result
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
