#!/usr/bin/env python3
"""Read-only CDP probe for browser-agent controlled pages.

This script is intentionally sidecar-only: it inspects DOM, console, and
network state without submitting prompts or changing the main report pipeline.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "lib") not in sys.path:
    sys.path.insert(0, str(ROOT / "lib"))

import browser_job_runtime as bjrt  # noqa: E402

CHATGPT_STATE_JS = r"""() => {
  const body = document.body;
  const text = (body && (body.innerText || body.textContent) || "").trim();
  const composerSelectors = [
    "#prompt-textarea",
    "textarea[name='prompt-textarea']",
    "div[contenteditable='true'][role='textbox']",
    "[data-testid='prompt-textarea']"
  ];
  const composer = composerSelectors.map((selector) => document.querySelector(selector)).find(Boolean);
  const messageNodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
  const assistantNodes = messageNodes.filter((node) => node.getAttribute("data-message-author-role") === "assistant");
  const latestAssistant = assistantNodes.length ? assistantNodes[assistantNodes.length - 1] : null;
  const challengeFrame = Array.from(document.querySelectorAll("iframe")).some((frame) => {
    const value = `${frame.src || ""} ${frame.title || ""} ${frame.name || ""}`;
    return /challenge|cloudflare|turnstile|captcha/i.test(value);
  });
  const challengeDom = Boolean(
    document.querySelector("script[src*='challenge-platform'], script[src*='turnstile'], input[name='cf-turnstile-response'], #challenge-error-text")
  );
  const challengeText = /(?:请稍候|请稍等|Just a moment|Please wait|Checking if the site connection is secure|Verify you are human|Enable JavaScript and cookies|验证成功。正在等待|cf_chl|turnstile)/i.test(
    `${document.title || ""}\n${text}`
  );
  const loginWall = /(?:Log in|Sign up|Continue with Google|登录|注册|继续使用 Google)/i.test(text) && !composer;
  const generating = /(?:Thinking|Reasoning|Generating|Stop generating|已思考\s*\d+\s*s|停止生成|正在生成|思考中)/i.test(text);
  return {
    url: location.href,
    title: document.title || "",
    text_length: text.length,
    composer_ready: Boolean(composer),
    challenge_wall: Boolean(challengeFrame || challengeDom || challengeText),
    login_wall: Boolean(loginWall),
    generating: Boolean(generating),
    message_count: messageNodes.length,
    assistant_count: assistantNodes.length,
    latest_assistant_text: latestAssistant ? (latestAssistant.innerText || latestAssistant.textContent || "").trim() : "",
    selectors: {
      composer: composerSelectors.map((selector) => ({selector, count: document.querySelectorAll(selector).length})),
      messages: messageNodes.length,
      assistants: assistantNodes.length,
      iframes: document.querySelectorAll("iframe").length
    }
  };
}"""

GENERIC_STATE_JS = r"""() => {
  const body = document.body;
  const text = (body && (body.innerText || body.textContent) || "").trim();
  return {
    url: location.href,
    title: document.title || "",
    text_length: text.length,
    html_length: document.documentElement ? document.documentElement.outerHTML.length : 0
  };
}"""

HTML_JS = "() => document.documentElement ? document.documentElement.outerHTML : ''"
TEXT_JS = "() => (document.body && (document.body.innerText || document.body.textContent) || '').trim()"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _truthy(value: str | None, *, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _append_jsonl(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(data, ensure_ascii=False, sort_keys=True) + "\n")


def _truncate(text: str, limit: int) -> str:
    if limit <= 0:
        return ""
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n\n[truncated {len(text) - limit} chars]"


def _default_request_dir() -> Path:
    base = Path(os.environ.get("BROWSER_CDP_PROBE_STATE_DIR") or "~/.solar/harness/state/browser-cdp-probe").expanduser()
    return base / time.strftime("%Y%m%d-%H%M%S")


def _default_allowed_domains(url: str, mode: str) -> list[str]:
    if mode == "chatgpt":
        return ["chatgpt.com", "auth.openai.com", "challenges.cloudflare.com"]
    host = urlparse(url).hostname or ""
    domains = [host] if host else []
    domains.extend(["localhost", "127.0.0.1"])
    return sorted({item for item in domains if item})


def _status_only_text(text: str) -> bool:
    clean = re.sub(r"\s+", " ", str(text or "")).strip()
    if not clean:
        return True
    patterns = [
        r"^(已思考|思考中|Thinking|Reasoning)(?:\s*\d+\s*s|[\s.。…]*)$",
        r"^(Generating|正在生成|Stop generating|停止生成)[\s.。…]*$",
    ]
    return any(re.search(pattern, clean, re.IGNORECASE) for pattern in patterns)


def classify_chatgpt_snapshot(snapshot: dict[str, Any], *, min_substantive_chars: int = 80) -> dict[str, Any]:
    """Classify a ChatGPT page snapshot without relying on exit code alone."""
    latest = str(snapshot.get("latest_assistant_text") or "").strip()
    substantive = bool(latest and len(latest) >= min_substantive_chars and not _status_only_text(latest))
    if snapshot.get("challenge_wall"):
        status = "challenge_wall"
    elif snapshot.get("login_wall"):
        status = "login_required"
    elif substantive:
        status = "result_present"
    elif snapshot.get("generating") and _status_only_text(latest):
        status = "thinking_only_stall"
    elif snapshot.get("generating"):
        status = "generating"
    elif not snapshot.get("composer_ready"):
        status = "composer_missing"
    elif latest:
        status = "assistant_fragment"
    else:
        status = "ready"
    return {
        "status": status,
        "substantive_result": substantive,
        "latest_assistant_chars": len(latest),
        "composer_ready": bool(snapshot.get("composer_ready")),
        "challenge_wall": bool(snapshot.get("challenge_wall")),
        "login_wall": bool(snapshot.get("login_wall")),
        "generating": bool(snapshot.get("generating")),
        "message_count": int(snapshot.get("message_count") or 0),
        "assistant_count": int(snapshot.get("assistant_count") or 0),
    }


def _browser_profile_kwargs(url: str, mode: str) -> dict[str, Any]:
    profile_directory = os.environ.get("BROWSER_AGENT_PROFILE_DIRECTORY") or "Default"
    user_data_dir = os.environ.get("BROWSER_AGENT_USER_DATA_DIR") or str(Path.home() / "Library/Application Support/Google/Chrome")
    browser_channel = os.environ.get("BROWSER_AGENT_BROWSER_CHANNEL") or "chrome"
    headless = _truthy(
        os.environ.get("BROWSER_AGENT_HEADLESS") or os.environ.get("TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS"),
        default=True,
    )
    return {
        "headless": headless,
        "user_data_dir": Path(user_data_dir).expanduser(),
        "profile_directory": profile_directory,
        "profile_strategy": os.environ.get("BROWSER_AGENT_PROFILE_STRATEGY") or os.environ.get("BROWSER_AGENT_CHATGPT_PROFILE_STRATEGY") or "isolated",
        "allowed_domains": _default_allowed_domains(url, mode),
        "channel": browser_channel,
    }


def _same_host(left: str, right: str) -> bool:
    return bool((urlparse(left).hostname or "").lower() == (urlparse(right).hostname or "").lower())


async def _pick_page(context: Any, target_url: str, *, prefer_existing: bool) -> Any:
    pages = list(getattr(context, "pages", []) or [])
    if prefer_existing:
        for page in pages:
            try:
                if _same_host(str(page.url or ""), target_url):
                    return page
            except Exception:
                continue
    if pages:
        return pages[0]
    return await context.new_page()


async def _connect_page(args: argparse.Namespace) -> tuple[Any, Any, Any, str, Path | None, bool]:
    from browser_use.browser.profile import BrowserProfile
    from browser_use.browser.session import BrowserSession
    from playwright.async_api import async_playwright

    pw = await async_playwright().start()
    attach_url = args.attach_cdp_url or os.environ.get("BROWSER_CDP_URL") or os.environ.get("BROWSER_AGENT_CDP_URL") or ""
    browser_session = None
    if attach_url:
        pw_browser = await pw.chromium.connect_over_cdp(attach_url)
        source = "attached_cdp"
        cleanup_dir = None
    else:
        kwargs = _browser_profile_kwargs(args.url, args.mode)
        user_data_dir = kwargs.pop("user_data_dir")
        profile_directory = kwargs.get("profile_directory")
        profile_strategy = str(kwargs.pop("profile_strategy") or "isolated")
        staged_dir, cleanup_dir = bjrt._stage_browser_profile(
            user_data_dir,
            profile_directory,
            strategy=profile_strategy,
        )
        if user_data_dir and not staged_dir:
            raise RuntimeError("protected_browser_profile_cache_missing")
        kwargs["user_data_dir"] = staged_dir
        browser_session = BrowserSession(browser_profile=BrowserProfile(**kwargs))
        await asyncio.wait_for(browser_session.start(), timeout=min(args.timeout_seconds, 180))
        attach_url = str(getattr(browser_session, "cdp_url", "") or "")
        pw_browser = await pw.chromium.connect_over_cdp(attach_url)
        source = "browser_use_session"
    context = pw_browser.contexts[0] if pw_browser.contexts else await pw_browser.new_context()
    page = await _pick_page(context, args.url, prefer_existing=(source == "attached_cdp"))
    selected_matches_target = _same_host(str(getattr(page, "url", "") or ""), args.url)
    return pw, browser_session, page, source, cleanup_dir, selected_matches_target


async def _run_async(args: argparse.Namespace) -> int:
    request_dir = Path(args.request_dir or _default_request_dir()).expanduser()
    request_dir.mkdir(parents=True, exist_ok=True)
    max_text_chars = int(os.environ.get("BROWSER_CDP_PROBE_MAX_TEXT_CHARS") or "200000")
    max_html_chars = int(os.environ.get("BROWSER_CDP_PROBE_MAX_HTML_CHARS") or "500000")
    meta = {
        "schema_version": "browser_cdp_probe.v1",
        "mode": args.mode,
        "url": args.url,
        "request_dir": str(request_dir),
        "profile_directory": os.environ.get("BROWSER_AGENT_PROFILE_DIRECTORY") or "Default",
        "started_at": _now(),
        "navigate": not args.no_navigate,
    }
    _write_json(request_dir / "cdp-probe-meta.json", meta)

    pw = None
    browser_session = None
    cleanup_dir = None
    result: dict[str, Any] = dict(meta)
    try:
        pw, browser_session, page, source, cleanup_dir, selected_matches_target = await _connect_page(args)
        result["source"] = source
        cdp_url = str(getattr(browser_session, "cdp_url", "") or args.attach_cdp_url or "")
        if cdp_url:
            (request_dir / "cdp-url.txt").write_text(cdp_url + "\n", encoding="utf-8")

        page.on("console", lambda msg: _append_jsonl(request_dir / "console-events.jsonl", {
            "ts": _now(),
            "type": msg.type,
            "text": _truncate(msg.text, 4000),
        }))
        page.on("request", lambda req: _append_jsonl(request_dir / "network-events.jsonl", {
            "ts": _now(),
            "event": "request",
            "method": req.method,
            "resource_type": req.resource_type,
            "url": req.url,
        }))
        page.on("response", lambda resp: _append_jsonl(request_dir / "network-events.jsonl", {
            "ts": _now(),
            "event": "response",
            "status": resp.status,
            "url": resp.url,
        }))
        page.on("requestfailed", lambda req: _append_jsonl(request_dir / "network-events.jsonl", {
            "ts": _now(),
            "event": "requestfailed",
            "method": req.method,
            "url": req.url,
            "failure": req.failure,
        }))

        if not args.no_navigate and not (source == "attached_cdp" and selected_matches_target):
            await page.goto(args.url, wait_until="domcontentloaded", timeout=args.timeout_seconds * 1000)
        await page.wait_for_timeout(int(os.environ.get("BROWSER_CDP_PROBE_SETTLE_MS") or "1500"))

        state = await page.evaluate(CHATGPT_STATE_JS if args.mode == "chatgpt" else GENERIC_STATE_JS)
        text = await page.evaluate(TEXT_JS)
        html = await page.evaluate(HTML_JS)
        dom_state = {
            "schema_version": "browser_cdp_dom_state.v1",
            "captured_at": _now(),
            "mode": args.mode,
            "state": state,
        }
        if args.mode == "chatgpt":
            dom_state["chatgpt_classification"] = classify_chatgpt_snapshot(state)
            result["status"] = dom_state["chatgpt_classification"]["status"]
        else:
            result["status"] = "ok"
        _write_json(request_dir / "dom-state.json", dom_state)
        (request_dir / "dom-text.txt").write_text(_truncate(str(text or ""), max_text_chars) + "\n", encoding="utf-8")
        if max_html_chars > 0:
            (request_dir / "dom.html").write_text(_truncate(str(html or ""), max_html_chars), encoding="utf-8")
        if _truthy(os.environ.get("BROWSER_CDP_PROBE_SCREENSHOT"), default=False):
            await page.screenshot(path=str(request_dir / "page-screenshot.png"), full_page=True)
        result.update({
            "ok": True,
            "finished_at": _now(),
            "artifacts": {
                "dom_state": str(request_dir / "dom-state.json"),
                "dom_text": str(request_dir / "dom-text.txt"),
                "dom_html": str(request_dir / "dom.html") if max_html_chars > 0 else "",
            },
        })
        _write_json(request_dir / "result.json", result)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True), flush=True)
        return 0
    except Exception as exc:
        result.update({
            "ok": False,
            "status": "probe_failed",
            "error_type": type(exc).__name__,
            "error": str(exc),
            "finished_at": _now(),
        })
        _write_json(request_dir / "result.json", result)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True), flush=True)
        return 2
    finally:
        if browser_session is not None:
            try:
                await browser_session.stop()
            except Exception:
                pass
        if pw is not None:
            try:
                await pw.stop()
            except Exception:
                pass
        if cleanup_dir is not None:
            shutil.rmtree(cleanup_dir, ignore_errors=True)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Read-only browser CDP probe")
    parser.add_argument("--url", default=os.environ.get("BROWSER_CDP_PROBE_URL") or "https://chatgpt.com/")
    parser.add_argument("--mode", choices=["generic", "chatgpt"], default=os.environ.get("BROWSER_CDP_PROBE_MODE") or "generic")
    parser.add_argument("--request-dir", default=os.environ.get("BROWSER_AGENT_REQUEST_DIR") or "")
    parser.add_argument("--timeout-seconds", type=int, default=int(os.environ.get("BROWSER_CDP_PROBE_TIMEOUT_SECONDS") or "60"))
    parser.add_argument("--attach-cdp-url", default=os.environ.get("BROWSER_CDP_PROBE_ATTACH_URL") or "")
    parser.add_argument("--no-navigate", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    return asyncio.run(_run_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
