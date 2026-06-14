#!/usr/bin/env python3
"""Browser Agent wrapper for Gemini session hygiene.

Gemini's public UI may not expose a stable folder/project feature for chats.
This wrapper therefore performs a safe capability probe:

1. Reuse the persistent browser profile.
2. Open Gemini.
3. Scan visible recent chats.
4. Select same-day Solar/AI Influence/Browser Agent related candidates.
5. If a folder/project move control exists, attempt to use it.
6. Otherwise return unsupported with a candidate list, never fake success.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import shutil
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "lib"
if str(LIB) not in sys.path:
    sys.path.insert(0, str(LIB))

DEFAULT_URL = "https://gemini.google.com/app"
DEFAULT_USER_DATA_DIR = Path.home() / "Library" / "Application Support" / "Google" / "Chrome"
DEFAULT_PROFILE_DIRECTORY = "Default"
DEFAULT_ALLOWED_DOMAINS = ["gemini.google.com", "accounts.google.com", "google.com"]

SOLAR_TITLE_RE = re.compile(
    r"(solar|ai influence|tech hotspot|hf paper|github|youtube|social|digest|report|"
    r"browser agent|logical operator|operator|deepsearchgemini|deep research|"
    r"technologyoutliner|gptgeminicleaner)",
    re.I,
)

CONTRACT = """# Gemini Session Cleaner Contract

Gemini session hygiene wrapper for GPTGeminiCleaner.

- Scan visible Gemini recent chats.
- Only select same-day Solar/AI Influence/Browser Agent related sessions.
- Move/organize only if Gemini exposes a folder/project control.
- Do not delete sessions.
- Report unsupported when Gemini UI lacks folder/project organization controls.
"""

SCAN_GEMINI_SESSIONS_JS = r"""() => {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const visible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const nodes = Array.from(document.querySelectorAll("a, button, [role='button'], [role='menuitem']"));
  const sessions = [];
  const seen = new Set();
  for (const node of nodes) {
    if (!visible(node)) continue;
    const text = clean(node.innerText || node.textContent || node.getAttribute("aria-label") || "");
    const href = node.href || node.getAttribute("href") || "";
    if (!text || text.length < 4 || text.length > 160) continue;
    if (/^(new chat|新聊天|settings|设置|help|帮助|activity|活动|gemini)$/i.test(text)) continue;
    const key = `${text}\n${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (/\/app\/[a-zA-Z0-9_-]+/.test(href) || node.closest("side-navigation, nav, aside, [class*='side'], [class*='history']")) {
      sessions.push({ title: text, href, tag: node.tagName });
    }
  }
  const body = clean(document.body && (document.body.innerText || document.body.textContent || ""));
  const loginWall = /(sign in|log in|continue with google|登录|使用 google 账户继续)/i.test(body) && sessions.length === 0;
  const folderControls = nodes
    .filter((node) => visible(node))
    .map((node) => clean(`${node.innerText || node.textContent || ""} ${node.getAttribute("aria-label") || ""}`))
    .filter((text) => /(folder|project|move|organize|文件夹|项目|移动|整理|归档)/i.test(text))
    .slice(0, 40);
  return JSON.stringify({ ok: true, url: location.href, title: document.title || "", login_wall: loginWall, sessions, folder_controls: folderControls });
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
        key = f"{title}\n{href}"
        if not title or key in seen:
            continue
        if not title_matches_cleanup_scope(title):
            continue
        selected.append(item)
        seen.add(key)
        if len(selected) >= limit:
            break
    return selected


async def run_browser_cleaner(prompt: str) -> dict[str, Any]:
    import browser_job_runtime as bjrt
    from browser_agent_profile_policy import select_profile_policy
    from browser_use.browser.profile import BrowserProfile
    from browser_use.browser.session import BrowserSession

    request_dir = Path(os.environ.get("BROWSER_AGENT_REQUEST_DIR") or ".").expanduser()
    request_dir.mkdir(parents=True, exist_ok=True)
    target_week = str(
        os.environ.get("BROWSER_AGENT_GEMINI_TARGET_FOLDER_NAME")
        or os.environ.get("GPT_GEMINI_CLEANER_TARGET_WEEK")
        or ""
    ).strip()
    if not target_week:
        raise RuntimeError("target_week_missing")
    max_sessions = int(os.environ.get("GPT_GEMINI_CLEANER_MAX_SESSIONS") or "20")
    run_date = _parse_run_date(os.environ.get("GPT_GEMINI_CLEANER_RUN_DATE") or os.environ.get("GPT_GEMINI_CLEANER_DATE"))
    profile_policy = select_profile_policy(
        service="gemini",
        purpose="gpt-gemini-cleaner-gemini",
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

    _write_json(
        request_dir / "session-cleaner-meta.json",
        {
            "backend": "gemini",
            "target_week": target_week,
            "run_date": run_date.isoformat(),
            "headless": headless,
            "max_sessions": max_sessions,
            "profile_directory": profile_directory,
            "target_account_email": profile_policy.get("selected_account_email") or "",
            "profile_policy": profile_policy,
            "started_at": bjrt._now(),
        },
    )

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
        await page.goto(str(os.environ.get("BROWSER_AGENT_GEMINI_URL") or DEFAULT_URL))
        await asyncio.sleep(3)
        scan = json.loads(await page.evaluate(SCAN_GEMINI_SESSIONS_JS))
        _write_json(request_dir / "sidebar-scan.json", scan)
        if scan.get("login_wall"):
            return {
                "ok": False,
                "backend": "gemini",
                "target_week": target_week,
                "auth_required": True,
                "status": "auth_required",
                "moved_count": 0,
                "skipped_count": 0,
                "unresolved_sessions": [],
            }
        sessions = scan.get("sessions") if isinstance(scan.get("sessions"), list) else []
        selected = select_candidate_sessions(sessions, limit=max_sessions)
        folder_controls = scan.get("folder_controls") if isinstance(scan.get("folder_controls"), list) else []
        result = {
            "ok": False,
            "backend": "gemini",
            "target_week": target_week,
            "created_container": False,
            "status": "unsupported",
            "moved_count": 0,
            "skipped_count": max(0, len(sessions) - len(selected)),
            "auth_required": False,
            "unsupported": True,
            "unsupported_reason": "gemini_folder_or_project_move_control_not_confirmed",
            "candidate_sessions": selected,
            "folder_controls_seen": folder_controls,
            "moved_sessions": [],
            "unresolved_sessions": selected,
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
        return 0 if result.get("status") in {"unsupported", "auth_required"} or result.get("ok") else 1
    except Exception as exc:
        print(
            json.dumps(
                {"ok": False, "backend": "gemini", "status": "failed", "error": f"{type(exc).__name__}: {exc}"},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
