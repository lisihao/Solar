#!/usr/bin/env python3
"""Browser Agent wrapper for ChatGPT session hygiene.

This wrapper is intentionally separate from the report-generation ChatGPT
wrapper. It only performs sidebar/session organization:

1. Reuse the configured persistent browser profile.
2. Open ChatGPT.
3. Scan visible recent/sidebar conversations.
4. Open same-day Solar/AI Influence/Browser Agent related sessions.
5. Move each opened conversation into the target week project.

It never deletes conversations and never stores account secrets in source.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import shutil
import sys
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "lib"
if str(LIB) not in sys.path:
    sys.path.insert(0, str(LIB))

DEFAULT_URL = "https://chatgpt.com/"
DEFAULT_USER_DATA_DIR = Path.home() / "Library" / "Application Support" / "Google" / "Chrome"
DEFAULT_PROFILE_DIRECTORY = "Default"
DEFAULT_ALLOWED_DOMAINS = ["chatgpt.com", "auth.openai.com", "challenges.cloudflare.com"]

SOLAR_TITLE_RE = re.compile(
    r"(solar|ai influence|tech hotspot|hf paper|github|youtube|social|digest|report|"
    r"browser agent|logical operator|operator|chapter writer|planner|deep writer|"
    r"deepresearch|deep search|technologyoutliner|gptgeminicleaner)",
    re.I,
)

CONTRACT = """# ChatGPT Session Cleaner Contract

- Scan visible ChatGPT sidebar/history sessions.
- Only select same-day Solar/AI Influence/Browser Agent related sessions.
- Move selected sessions to the target week project, e.g. W23周.
- Do not delete sessions.
- Use configured browser profile/account only; no hardcoded account or secrets.
- Report auth_required or unsupported instead of pretending success.
"""

SCAN_CHATGPT_SESSIONS_JS = r"""() => {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const visible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const nodes = Array.from(document.querySelectorAll("nav a[href*='/c/'], aside a[href*='/c/'], a[href*='/c/']"));
  const seen = new Set();
  const sessions = [];
  for (const node of nodes) {
    if (!visible(node)) continue;
    const href = node.href || node.getAttribute("href") || "";
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const title = clean(node.innerText || node.textContent || node.getAttribute("aria-label") || "");
    if (!title) continue;
    const rect = node.getBoundingClientRect();
    sessions.push({ title, href, y: Math.round(rect.top) });
  }
  const body = clean(document.body && (document.body.innerText || document.body.textContent || ""));
  const loginWall = /(log in|sign in|continue with google|登录|注册|使用 google 账户继续)/i.test(body) && sessions.length === 0;
  const challengeWall = /(cloudflare|turnstile|checking your browser|verify you are human|请稍候|正在验证|验证你是真人)/i.test(`${document.title}\n${location.href}\n${body.slice(0, 1000)}`);
  return JSON.stringify({ ok: true, url: location.href, title: document.title || "", login_wall: loginWall, challenge_wall: challengeWall, sessions });
}"""

CLICK_NEW_PROJECT_JS = r"""(projectName) => {
  const target = String(projectName || "").trim();
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const visible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const nodes = Array.from(document.querySelectorAll("button,a,[role='button'],[role='menuitem'],div"));
  const existing = nodes.find((el) => visible(el) && clean(el.innerText || el.textContent || "") === target);
  if (existing) return JSON.stringify({ ok: true, existed: true, project_name: target });
  const creator = nodes.find((el) => {
    if (!visible(el)) return false;
    const text = clean(el.innerText || el.textContent || "");
    const aria = clean(el.getAttribute("aria-label") || "");
    return /(new project|create project|新建项目|创建项目|新增项目|\+.*项目|project)/i.test(`${text}\n${aria}`);
  });
  if (!creator) return JSON.stringify({ ok: false, error: "project_create_control_not_found", project_name: target });
  creator.click();
  return JSON.stringify({ ok: false, attempted_create: true, error: "project_create_requires_ui_confirmation", project_name: target });
}"""


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _parse_run_date(raw: str | None) -> date:
    value = str(raw or "").strip()
    if not value:
        return datetime.now().date()
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        return date.fromisoformat(value[:10])


def title_matches_cleanup_scope(title: str) -> bool:
    return bool(SOLAR_TITLE_RE.search(str(title or "")))


def select_candidate_sessions(sessions: list[dict[str, Any]], *, limit: int) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in sessions:
        title = str(item.get("title") or "").strip()
        href = str(item.get("href") or "").strip()
        if not title or not href or href in seen:
            continue
        if not title_matches_cleanup_scope(title):
            continue
        selected.append(item)
        seen.add(href)
        if len(selected) >= limit:
            break
    return selected


async def _move_current_conversation_to_project(page, project_name: str, request_dir: Path, index: int) -> dict[str, Any]:
    from browser_agent_chatgpt_wrapper import _move_current_conversation_to_project

    result = await _move_current_conversation_to_project(page, project_name)
    _write_json(request_dir / f"move-result-{index:03d}.json", result)
    return result


async def run_browser_cleaner(prompt: str) -> dict[str, Any]:
    import browser_job_runtime as bjrt
    from browser_agent_profile_policy import select_profile_policy
    from browser_use.browser.profile import BrowserProfile
    from browser_use.browser.session import BrowserSession

    request_dir = Path(os.environ.get("BROWSER_AGENT_REQUEST_DIR") or ".").expanduser()
    request_dir.mkdir(parents=True, exist_ok=True)
    target_week = str(
        os.environ.get("BROWSER_AGENT_CHATGPT_TARGET_PROJECT_NAME")
        or os.environ.get("GPT_GEMINI_CLEANER_TARGET_WEEK")
        or os.environ.get("BROWSER_AGENT_CHATGPT_PROJECT_NAME")
        or ""
    ).strip()
    if not target_week:
        raise RuntimeError("target_week_missing")
    max_sessions = int(os.environ.get("GPT_GEMINI_CLEANER_MAX_SESSIONS") or "20")
    run_date = _parse_run_date(os.environ.get("GPT_GEMINI_CLEANER_RUN_DATE") or os.environ.get("GPT_GEMINI_CLEANER_DATE"))
    profile_policy = select_profile_policy(
        service="chatgpt",
        purpose="gpt-gemini-cleaner-chatgpt",
        default_profile_directory=DEFAULT_PROFILE_DIRECTORY,
        default_user_data_dir=DEFAULT_USER_DATA_DIR,
    )
    profile_directory = str(profile_policy.get("selected_profile_directory") or DEFAULT_PROFILE_DIRECTORY)
    user_data_dir = Path(str(profile_policy.get("user_data_dir") or DEFAULT_USER_DATA_DIR)).expanduser()
    headless_raw = "false" if profile_policy.get("force_headed") or not bool(profile_policy.get("allow_headless", True)) else os.environ.get("BROWSER_AGENT_HEADLESS") or "true"
    headless = str(headless_raw).strip().lower() in {"1", "true", "yes", "on"}
    allowed_domains = [
        item.strip()
        for item in str(os.environ.get("BROWSER_AGENT_ALLOWED_DOMAINS") or ",".join(DEFAULT_ALLOWED_DOMAINS)).split(",")
        if item.strip()
    ]
    staged_dir, cleanup_dir = bjrt._stage_browser_profile(user_data_dir, profile_directory)
    if user_data_dir and not staged_dir:
        raise RuntimeError("protected_browser_profile_cache_missing")

    meta = {
        "backend": "chatgpt",
        "target_week": target_week,
        "run_date": run_date.isoformat(),
        "headless": headless,
        "max_sessions": max_sessions,
        "profile_directory": profile_directory,
        "target_account_email": profile_policy.get("selected_account_email") or "",
        "profile_policy": profile_policy,
        "started_at": bjrt._now(),
    }
    _write_json(request_dir / "session-cleaner-meta.json", meta)

    browser = BrowserSession(
        browser_profile=BrowserProfile(
            headless=headless,
            user_data_dir=staged_dir,
            profile_directory=profile_directory,
            allowed_domains=allowed_domains,
        )
    )
    try:
        await asyncio.wait_for(browser.start(), timeout=40)
        page = await asyncio.wait_for(browser.new_page(), timeout=15)
        await page.goto(str(os.environ.get("BROWSER_AGENT_CHATGPT_URL") or DEFAULT_URL))
        await asyncio.sleep(3)
        scan = json.loads(await page.evaluate(SCAN_CHATGPT_SESSIONS_JS))
        _write_json(request_dir / "sidebar-scan.json", scan)
        if scan.get("login_wall") or scan.get("challenge_wall"):
            return {
                "ok": False,
                "backend": "chatgpt",
                "target_week": target_week,
                "auth_required": bool(scan.get("login_wall") or scan.get("challenge_wall")),
                "status": "auth_required",
                "moved_count": 0,
                "skipped_count": 0,
                "unresolved_sessions": [],
            }
        ensure_project = json.loads(await page.evaluate(CLICK_NEW_PROJECT_JS, target_week))
        _write_json(request_dir / "ensure-project-result.json", ensure_project)
        sessions = scan.get("sessions") if isinstance(scan.get("sessions"), list) else []
        selected = select_candidate_sessions(sessions, limit=max_sessions)
        moved: list[dict[str, Any]] = []
        unresolved: list[dict[str, Any]] = []
        for index, item in enumerate(selected, start=1):
            href = str(item.get("href") or "")
            try:
                await page.goto(href)
                await asyncio.sleep(1.5)
                move_result = await _move_current_conversation_to_project(page, target_week, request_dir, index)
                record = {"title": item.get("title"), "href": href, "move_result": move_result}
                if move_result.get("ok"):
                    moved.append(record)
                else:
                    unresolved.append(record)
            except Exception as exc:
                unresolved.append({"title": item.get("title"), "href": href, "error": f"{type(exc).__name__}: {exc}"})
        result = {
            "ok": not unresolved,
            "backend": "chatgpt",
            "target_week": target_week,
            "created_container": bool(ensure_project.get("ok") or ensure_project.get("existed")),
            "status": "succeeded" if not unresolved else "partial",
            "moved_count": len(moved),
            "skipped_count": max(0, len(sessions) - len(selected)),
            "auth_required": False,
            "unsupported": False,
            "moved_sessions": moved,
            "unresolved_sessions": unresolved,
        }
        _write_json(request_dir / "session-cleaner-result.json", result)
        try:
            screenshot_b64 = await page.screenshot(format="png")
            if screenshot_b64:
                (request_dir / "session-cleaner-final.png").write_bytes(base64.b64decode(screenshot_b64))
        except Exception:
            pass
        return result
    finally:
        try:
            await asyncio.wait_for(browser.stop(), timeout=20)
        except Exception:
            pass
        if cleanup_dir is not None:
            shutil.rmtree(cleanup_dir, ignore_errors=True)


def main() -> int:
    if "--print-contract" in sys.argv:
        print(CONTRACT)
        return 0
    if "--classify-title" in sys.argv:
        title = " ".join(sys.argv[sys.argv.index("--classify-title") + 1 :])
        print("true" if title_matches_cleanup_scope(title) else "false")
        return 0
    prompt = sys.stdin.read()
    try:
        result = asyncio.run(run_browser_cleaner(prompt))
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result.get("ok") or result.get("status") in {"partial", "auth_required"} else 1
    except Exception as exc:
        print(
            json.dumps(
                {"ok": False, "backend": "chatgpt", "status": "failed", "error": f"{type(exc).__name__}: {exc}"},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
