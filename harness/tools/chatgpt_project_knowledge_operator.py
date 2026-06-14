#!/usr/bin/env python3
"""Extract Q/A knowledge from ChatGPT Project conversations via browser-agent.

The operator is intentionally read-only: it opens ChatGPT with the configured
persistent browser-agent profile, discovers project conversation links, extracts
each user question and assistant answer, and writes auditable artifacts that
preserve Markdown, tables, code blocks, and source HTML.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import hashlib
import html
import importlib.util
import json
import os
import re
import shutil
import sys
import urllib.parse
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "lib") not in sys.path:
    sys.path.insert(0, str(ROOT / "lib"))

from browser_agent_queue_client import enqueue_current_process_if_needed  # noqa: E402


SCHEMA_VERSION = "solar.chatgpt_project_knowledge.v1"
DEFAULT_ALLOWED_DOMAINS = ["chatgpt.com", "auth.openai.com", "challenges.cloudflare.com"]
DEFAULT_OUT_ROOT = (
    Path.home()
    / "Knowledge"
    / "_raw"
    / "chatgpt-project-knowledge"
    / dt.datetime.now().strftime("%Y-%m-%d")
)


CHATGPT_DISCOVER_PROJECT_CONVERSATIONS_JS = r"""
() => {
  const out = [];
  const seen = new Set();
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const href = String(a.href || '');
    const match = href.match(/https:\/\/chatgpt\.com\/(?:g\/[^/]+\/)?c\/([a-zA-Z0-9-]+)/);
    if (!match) continue;
    const url = 'https://chatgpt.com/c/' + match[1];
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      conversation_id: match[1],
      url,
      title: (a.getAttribute('aria-label') || a.textContent || '').trim(),
    });
  }
  return {
    url: location.href,
    title: document.title || '',
    project_label: (
      document.querySelector('[data-testid="project-name"]')?.textContent ||
      document.querySelector('h1')?.textContent ||
      ''
    ).trim(),
    conversations: out,
  };
}
"""


CHATGPT_EXTRACT_CONVERSATION_JS = r"""
() => {
  const cleanText = (value) => String(value || '').replace(/\u00a0/g, ' ').trim();
  const normalizeUrl = (value) => {
    try { return new URL(value, location.href).toString(); } catch { return String(value || ''); }
  };
  const cellText = (cell) => cleanText(cell.innerText || cell.textContent || '').replace(/\|/g, '\\|');
  const renderTable = (table) => {
    const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th,td')).map(cellText)
    ).filter((row) => row.length);
    if (!rows.length) return '';
    const width = Math.max(...rows.map((row) => row.length));
    const padded = rows.map((row) => {
      const copy = row.slice();
      while (copy.length < width) copy.push('');
      return copy;
    });
    const header = padded[0];
    const sep = header.map(() => '---');
    return '\n\n| ' + header.join(' | ') + ' |\n| ' + sep.join(' | ') + ' |\n' +
      padded.slice(1).map((row) => '| ' + row.join(' | ') + ' |').join('\n') + '\n\n';
  };
  const nodeToMarkdown = (node) => {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'button' || tag === 'svg') return '';
    if (tag === 'br') return '\n';
    if (tag === 'table') return renderTable(node);
    if (tag === 'pre') {
      const code = node.querySelector('code');
      const cls = String(code?.className || '');
      const lang = (cls.match(/language-([a-z0-9_+-]+)/i) || [])[1] || '';
      return '\n\n```' + lang + '\n' + cleanText(code?.textContent || node.textContent || '') + '\n```\n\n';
    }
    if (tag === 'code') return '`' + cleanText(node.textContent || '') + '`';
    const children = Array.from(node.childNodes).map(nodeToMarkdown).join('');
    if (/^h[1-6]$/.test(tag)) return '\n\n' + '#'.repeat(Number(tag.slice(1))) + ' ' + cleanText(children) + '\n\n';
    if (tag === 'p') return '\n\n' + children.trim() + '\n\n';
    if (tag === 'blockquote') return '\n\n' + children.trim().split('\n').map((line) => '> ' + line).join('\n') + '\n\n';
    if (tag === 'li') return '\n- ' + children.trim();
    if (tag === 'ul' || tag === 'ol') return '\n' + children.trim() + '\n';
    if (tag === 'strong' || tag === 'b') return '**' + children.trim() + '**';
    if (tag === 'em' || tag === 'i') return '*' + children.trim() + '*';
    if (tag === 'a') {
      const label = cleanText(children || node.textContent || '');
      const href = normalizeUrl(node.getAttribute('href') || '');
      return href ? '[' + label + '](' + href + ')' : label;
    }
    return children;
  };
  const contentNode = (node) => {
    return node.querySelector('[data-message-content]') ||
      node.querySelector('.markdown') ||
      node.querySelector('[class*="markdown"]') ||
      node.querySelector('.whitespace-pre-wrap') ||
      node;
  };
  const nodes = Array.from(document.querySelectorAll('[data-message-author-role]'));
  const messages = nodes.map((node, index) => {
    const content = contentNode(node);
    const role = node.getAttribute('data-message-author-role') || '';
    const html = content ? content.innerHTML : node.innerHTML;
    const markdown = cleanText(nodeToMarkdown(content || node)).replace(/\n{3,}/g, '\n\n');
    const text = cleanText((content || node).innerText || (content || node).textContent || '');
    return {
      index,
      role,
      text,
      markdown: markdown || text,
      html,
      message_id: node.getAttribute('data-message-id') || node.id || '',
      model_slug: node.getAttribute('data-message-model-slug') || '',
    };
  }).filter((msg) => msg.role && (msg.text || msg.markdown || msg.html));
  return {
    url: location.href,
    title: document.title || '',
    conversation_id: (location.pathname.match(/\/c\/([^/]+)/) || [])[1] || '',
    extracted_at: new Date().toISOString(),
    messages,
  };
}
"""


class _MarkdownHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.href_stack: list[str] = []
        self.pre_depth = 0
        self.code_depth = 0
        self.table_stack: list[dict[str, Any]] = []
        self.current_row: list[str] | None = None
        self.current_cell: list[str] | None = None
        self.list_stack: list[str] = []

    def _append(self, value: str) -> None:
        if self.current_cell is not None:
            self.current_cell.append(value)
        elif not self.table_stack:
            self.parts.append(value)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {k: v or "" for k, v in attrs}
        tag = tag.lower()
        if tag == "br":
            self._append("\n")
        elif tag in {"p", "div", "section", "article"}:
            self._append("\n\n")
        elif re.fullmatch(r"h[1-6]", tag):
            self._append("\n\n" + "#" * int(tag[1]) + " ")
        elif tag == "blockquote":
            self._append("\n\n> ")
        elif tag == "pre":
            self.pre_depth += 1
            self._append("\n\n```\n")
        elif tag == "code" and not self.pre_depth:
            self.code_depth += 1
            self._append("`")
        elif tag in {"strong", "b"}:
            self._append("**")
        elif tag in {"em", "i"}:
            self._append("*")
        elif tag == "a":
            self.href_stack.append(attrs_dict.get("href", ""))
            self._append("[")
        elif tag in {"ul", "ol"}:
            self.list_stack.append(tag)
            self._append("\n")
        elif tag == "li":
            marker = "- " if not self.list_stack or self.list_stack[-1] == "ul" else "1. "
            self._append("\n" + marker)
        elif tag == "table":
            self.table_stack.append({"rows": []})
        elif tag == "tr" and self.table_stack:
            self.current_row = []
        elif tag in {"td", "th"} and self.table_stack:
            self.current_cell = []

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"p", "div", "section", "article"}:
            self._append("\n\n")
        elif re.fullmatch(r"h[1-6]", tag):
            self._append("\n\n")
        elif tag == "pre":
            self.pre_depth = max(0, self.pre_depth - 1)
            self._append("\n```\n\n")
        elif tag == "code" and self.code_depth:
            self.code_depth -= 1
            self._append("`")
        elif tag in {"strong", "b"}:
            self._append("**")
        elif tag in {"em", "i"}:
            self._append("*")
        elif tag == "a":
            href = self.href_stack.pop() if self.href_stack else ""
            self._append(f"]({href})" if href else "]")
        elif tag in {"ul", "ol"}:
            if self.list_stack:
                self.list_stack.pop()
            self._append("\n")
        elif tag in {"td", "th"} and self.table_stack and self.current_cell is not None:
            cell = re.sub(r"\s+", " ", "".join(self.current_cell)).strip().replace("|", "\\|")
            if self.current_row is None:
                self.current_row = []
            self.current_row.append(cell)
            self.current_cell = None
        elif tag == "tr" and self.table_stack and self.current_row is not None:
            if any(cell for cell in self.current_row):
                self.table_stack[-1]["rows"].append(self.current_row)
            self.current_row = None
        elif tag == "table" and self.table_stack:
            table = self.table_stack.pop()
            self.parts.append("\n\n" + render_markdown_table(table.get("rows") or []) + "\n\n")

    def handle_data(self, data: str) -> None:
        self._append(data)


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def stable_id(*parts: str) -> str:
    digest = hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()
    return digest[:16]


def slugify(value: str, fallback: str = "chatgpt-project") -> str:
    text = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip()).strip("-").lower()
    return text or fallback


def render_markdown_table(rows: list[list[str]]) -> str:
    clean = [[str(cell or "").strip().replace("\n", " ") for cell in row] for row in rows if row]
    if not clean:
        return ""
    width = max(len(row) for row in clean)
    padded = [row + [""] * (width - len(row)) for row in clean]
    header = padded[0]
    separator = ["---"] * width
    body = padded[1:]
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join(separator) + " |"]
    lines.extend("| " + " | ".join(row) + " |" for row in body)
    return "\n".join(lines)


def html_to_markdown(value: str) -> str:
    parser = _MarkdownHTMLParser()
    parser.feed(value or "")
    parser.close()
    text = html.unescape("".join(parser.parts))
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def normalize_conversation_url(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    parsed = urllib.parse.urlparse(raw)
    if not parsed.scheme:
        parsed = urllib.parse.urlparse("https://chatgpt.com" + (raw if raw.startswith("/") else "/" + raw))
    match = re.search(r"/c/([a-zA-Z0-9-]+)", parsed.path)
    if not match:
        return raw
    return f"https://chatgpt.com/c/{match.group(1)}"


def normalize_message(raw: dict[str, Any], index: int) -> dict[str, Any]:
    role = str(raw.get("role") or raw.get("author_role") or "").strip().lower()
    html_value = str(raw.get("html") or raw.get("content_html") or "")
    markdown = str(raw.get("markdown") or raw.get("content_markdown") or "").strip()
    if not markdown and html_value:
        markdown = html_to_markdown(html_value)
    text = str(raw.get("text") or raw.get("content_text") or markdown).strip()
    return {
        "index": int(raw.get("index", index)),
        "role": role,
        "text": text,
        "markdown": markdown or text,
        "html": html_value,
        "message_id": str(raw.get("message_id") or ""),
        "model_slug": str(raw.get("model_slug") or ""),
    }


def normalize_conversation(raw: dict[str, Any], *, source_url: str = "") -> dict[str, Any]:
    messages = [
        normalize_message(item, idx)
        for idx, item in enumerate(raw.get("messages") or [])
        if isinstance(item, dict)
    ]
    messages = [msg for msg in messages if msg["role"] in {"user", "assistant", "tool"} and (msg["text"] or msg["markdown"])]
    url = normalize_conversation_url(str(raw.get("url") or source_url or ""))
    conversation_id = str(raw.get("conversation_id") or "")
    if not conversation_id:
        match = re.search(r"/c/([a-zA-Z0-9-]+)", url)
        conversation_id = match.group(1) if match else stable_id(url, json.dumps(messages, ensure_ascii=False))
    return {
        "schema_version": SCHEMA_VERSION,
        "conversation_id": conversation_id,
        "url": url,
        "title": str(raw.get("title") or "").strip(),
        "extracted_at": str(raw.get("extracted_at") or now_iso()),
        "messages": messages,
    }


def build_qa_pairs(conversation: dict[str, Any]) -> list[dict[str, Any]]:
    pairs: list[dict[str, Any]] = []
    messages = conversation.get("messages") or []
    current_question: dict[str, Any] | None = None
    answer_parts: list[dict[str, Any]] = []

    def flush() -> None:
        nonlocal current_question, answer_parts
        if not current_question:
            return
        answer_markdown = "\n\n---\n\n".join(part.get("markdown") or part.get("text") or "" for part in answer_parts).strip()
        answer_text = "\n\n---\n\n".join(part.get("text") or part.get("markdown") or "" for part in answer_parts).strip()
        answer_html = "\n\n<hr/>\n\n".join(part.get("html") or "" for part in answer_parts).strip()
        pair_id = stable_id(
            str(conversation.get("conversation_id") or ""),
            str(current_question.get("index")),
            current_question.get("markdown") or current_question.get("text") or "",
            answer_markdown,
        )
        pairs.append(
            {
                "schema_version": SCHEMA_VERSION,
                "pair_id": pair_id,
                "conversation_id": conversation.get("conversation_id") or "",
                "conversation_title": conversation.get("title") or "",
                "conversation_url": conversation.get("url") or "",
                "question_index": current_question.get("index"),
                "answer_indices": [part.get("index") for part in answer_parts],
                "question_text": current_question.get("text") or "",
                "question_markdown": current_question.get("markdown") or current_question.get("text") or "",
                "question_html": current_question.get("html") or "",
                "answer_text": answer_text,
                "answer_markdown": answer_markdown,
                "answer_html": answer_html,
                "has_answer": bool(answer_parts and answer_markdown),
            }
        )
        current_question = None
        answer_parts = []

    for msg in messages:
        role = msg.get("role")
        if role == "user":
            flush()
            current_question = msg
            answer_parts = []
        elif role == "assistant" and current_question:
            answer_parts.append(msg)
    flush()
    return pairs


def render_conversation_markdown(conversation: dict[str, Any], pairs: list[dict[str, Any]]) -> str:
    lines = [
        f"# {conversation.get('title') or conversation.get('conversation_id') or 'ChatGPT Conversation'}",
        "",
        f"- conversation_id: `{conversation.get('conversation_id') or 'N/A'}`",
        f"- source: {conversation.get('url') or 'N/A'}",
        f"- extracted_at: `{conversation.get('extracted_at') or 'N/A'}`",
        f"- qa_pairs: `{len(pairs)}`",
        "",
    ]
    for idx, pair in enumerate(pairs, start=1):
        lines.extend(
            [
                f"## Q{idx}",
                "",
                pair.get("question_markdown") or pair.get("question_text") or "",
                "",
                f"## A{idx}",
                "",
                pair.get("answer_markdown") or pair.get("answer_text") or "_No assistant answer captured._",
                "",
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def render_conversation_html(conversation: dict[str, Any], pairs: list[dict[str, Any]]) -> str:
    title = html.escape(str(conversation.get("title") or conversation.get("conversation_id") or "ChatGPT Conversation"))
    body: list[str] = [
        "<!doctype html>",
        "<meta charset=\"utf-8\">",
        f"<title>{title}</title>",
        "<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:980px;margin:40px auto;padding:0 20px;line-height:1.55} .qa{border-top:1px solid #ddd;padding:24px 0}.role{font-weight:700;color:#555}.bubble{background:#fafafa;border:1px solid #eee;border-radius:12px;padding:16px;overflow:auto} table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}pre{background:#111;color:#f5f5f5;padding:12px;overflow:auto}</style>",
        f"<h1>{title}</h1>",
        f"<p><b>source:</b> {html.escape(str(conversation.get('url') or 'N/A'))}</p>",
    ]
    for idx, pair in enumerate(pairs, start=1):
        question = pair.get("question_html") or f"<pre>{html.escape(pair.get('question_markdown') or '')}</pre>"
        answer = pair.get("answer_html") or f"<pre>{html.escape(pair.get('answer_markdown') or '')}</pre>"
        body.extend(
            [
                "<section class=\"qa\">",
                f"<div class=\"role\">Q{idx}</div>",
                f"<div class=\"bubble\">{question}</div>",
                f"<div class=\"role\">A{idx}</div>",
                f"<div class=\"bubble\">{answer}</div>",
                "</section>",
            ]
        )
    return "\n".join(body) + "\n"


def write_artifacts(conversations: list[dict[str, Any]], out_dir: Path, *, source: dict[str, Any]) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    all_pairs: list[dict[str, Any]] = []
    conversation_entries: list[dict[str, Any]] = []
    for conv in conversations:
        pairs = build_qa_pairs(conv)
        all_pairs.extend(pairs)
        conv_dir = out_dir / slugify(str(conv.get("conversation_id") or conv.get("title") or "conversation"))
        conv_dir.mkdir(parents=True, exist_ok=True)
        (conv_dir / "conversation.json").write_text(json.dumps(conv, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (conv_dir / "qa-pairs.json").write_text(json.dumps(pairs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (conv_dir / "conversation.md").write_text(render_conversation_markdown(conv, pairs), encoding="utf-8")
        (conv_dir / "conversation.html").write_text(render_conversation_html(conv, pairs), encoding="utf-8")
        conversation_entries.append(
            {
                "conversation_id": conv.get("conversation_id") or "",
                "title": conv.get("title") or "",
                "url": conv.get("url") or "",
                "message_count": len(conv.get("messages") or []),
                "qa_pair_count": len(pairs),
                "artifact_dir": str(conv_dir),
            }
        )
    (out_dir / "conversations.json").write_text(json.dumps(conversations, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (out_dir / "qa-pairs.jsonl").open("w", encoding="utf-8") as fh:
        for pair in all_pairs:
            fh.write(json.dumps(pair, ensure_ascii=False) + "\n")
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now_iso(),
        "source": source,
        "conversation_count": len(conversations),
        "qa_pair_count": len(all_pairs),
        "conversations": conversation_entries,
        "artifacts": {
            "conversations_json": str(out_dir / "conversations.json"),
            "qa_pairs_jsonl": str(out_dir / "qa-pairs.jsonl"),
        },
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def read_conversation_list(path: Path) -> list[str]:
    values: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        value = line.strip()
        if value and not value.startswith("#"):
            values.append(value)
    return values


def _load_chatgpt_wrapper() -> Any:
    script = ROOT / "scripts" / "browser_agent_chatgpt_wrapper.py"
    spec = importlib.util.spec_from_file_location("solar_chatgpt_wrapper_runtime", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable_to_load_chatgpt_wrapper:{script}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _discover_project_conversations(page: Any, *, project_url: str, limit: int) -> dict[str, Any]:
    await goto_page(page, project_url)
    seen: dict[str, dict[str, Any]] = {}
    discovery: dict[str, Any] = {}
    for _ in range(8):
        discovery = await page.evaluate(CHATGPT_DISCOVER_PROJECT_CONVERSATIONS_JS)
        for item in discovery.get("conversations") or []:
            url = normalize_conversation_url(str(item.get("url") or ""))
            if url:
                item["url"] = url
                seen[url] = item
        if len(seen) >= limit:
            break
        await page.evaluate("() => window.scrollBy(0, Math.max(document.body.scrollHeight, 1600))")
        await page.wait_for_timeout(1200)
    conversations = list(seen.values())[:limit]
    discovery["conversations"] = conversations
    return discovery


async def goto_page(page: Any, url: str) -> None:
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=90_000)
    except TypeError:
        await page.goto(url)
    except Exception:
        try:
            await page.goto(url)
        except Exception:
            if hasattr(page, "navigate"):
                await page.navigate(url)
            else:
                raise


async def run_browser_extraction(args: argparse.Namespace) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    wrapper = _load_chatgpt_wrapper()
    profile_policy = wrapper._select_chatgpt_profile_policy("chatgpt-project-knowledge-extract")
    if profile_policy.get("selected_account_email"):
        os.environ["BROWSER_AGENT_TARGET_ACCOUNT_EMAIL"] = str(profile_policy["selected_account_email"])
        os.environ["BROWSER_AGENT_CHATGPT_ACCOUNT_EMAIL"] = str(profile_policy["selected_account_email"])
    if profile_policy.get("selected_profile_directory"):
        os.environ["BROWSER_AGENT_PROFILE_DIRECTORY"] = str(profile_policy["selected_profile_directory"])
    if profile_policy.get("profile_strategy"):
        os.environ["BROWSER_AGENT_PROFILE_STRATEGY"] = str(profile_policy["profile_strategy"])
        os.environ["BROWSER_AGENT_CHATGPT_PROFILE_STRATEGY"] = str(profile_policy["profile_strategy"])

    profile_directory = str(os.environ.get("BROWSER_AGENT_PROFILE_DIRECTORY") or wrapper.DEFAULT_PROFILE_DIRECTORY)
    user_data_dir = Path(os.environ.get("BROWSER_AGENT_USER_DATA_DIR") or str(wrapper.DEFAULT_USER_DATA_DIR)).expanduser()
    if profile_policy.get("enabled"):
        if profile_policy.get("selected_profile_directory"):
            profile_directory = str(profile_policy.get("selected_profile_directory"))
        if profile_policy.get("user_data_dir"):
            user_data_dir = Path(str(profile_policy.get("user_data_dir"))).expanduser()
    headless = wrapper._env_flag("BROWSER_AGENT_HEADLESS", wrapper._env_flag("TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS", True))
    headed_allowed = wrapper._headed_run_allowed()
    profile_strategy = str(
        os.environ.get("BROWSER_AGENT_CHATGPT_PROFILE_STRATEGY")
        or os.environ.get("BROWSER_AGENT_PROFILE_STRATEGY")
        or "persistent"
    ).strip().lower()
    if profile_policy.get("enabled"):
        if profile_policy.get("force_headed") or not bool(profile_policy.get("allow_headless", True)):
            headless = False
            headed_allowed = True
        if profile_policy.get("profile_strategy"):
            profile_strategy = str(profile_policy.get("profile_strategy"))
    if profile_strategy not in {"persistent", "isolated"}:
        profile_strategy = "persistent"
    if not headless and not headed_allowed:
        raise RuntimeError("browser_agent_headed_run_requires_explicit_opt_in")
    staged_dir, cleanup_dir = wrapper.bjrt._stage_browser_profile(
        user_data_dir,
        profile_directory,
        strategy=profile_strategy,
    )
    if user_data_dir and not staged_dir:
        raise RuntimeError("protected_browser_profile_cache_missing")

    BrowserProfile = wrapper.BrowserProfile
    BrowserSession = wrapper.BrowserSession
    browser_channel = wrapper._browser_channel()
    profile_kwargs = {
        "headless": headless,
        "user_data_dir": staged_dir,
        "profile_directory": profile_directory,
        "allowed_domains": DEFAULT_ALLOWED_DOMAINS,
        "channel": browser_channel,
        "user_agent": wrapper._browser_user_agent(browser_channel=browser_channel),
    }
    profile = BrowserProfile(**profile_kwargs)
    session = BrowserSession(browser_profile=profile)
    conversations: list[dict[str, Any]] = []
    source: dict[str, Any] = {
        "mode": "browser",
        "project_url": args.project_url or "",
        "profile_policy": profile_policy,
        "conversation_urls": [],
    }

    try:
        await session.start()
        page = await session.new_page()
        conversation_urls = [normalize_conversation_url(item) for item in args.conversation_url]
        if args.conversation_list:
            conversation_urls.extend(normalize_conversation_url(item) for item in read_conversation_list(Path(args.conversation_list).expanduser()))
        if args.project_url:
            discovery = await _discover_project_conversations(page, project_url=args.project_url, limit=args.limit)
            source["project_discovery"] = discovery
            conversation_urls.extend(str(item.get("url") or "") for item in discovery.get("conversations") or [])
        deduped: list[str] = []
        seen: set[str] = set()
        for url in conversation_urls:
            url = normalize_conversation_url(url)
            if url and url not in seen:
                seen.add(url)
                deduped.append(url)
        if not deduped:
            raise RuntimeError("no_conversation_urls_found: provide --project-url, --conversation-url, or --conversation-list")
        for url in deduped[: args.limit]:
            await goto_page(page, url)
            await page.wait_for_timeout(args.settle_ms)
            raw = await page.evaluate(CHATGPT_EXTRACT_CONVERSATION_JS)
            conv = normalize_conversation(raw, source_url=url)
            conversations.append(conv)
        source["conversation_urls"] = deduped[: args.limit]
    finally:
        try:
            await session.stop()
        except Exception:
            pass
        try:
            wrapper._kill_browser_profile_processes(staged_dir)
        except Exception:
            pass
        if cleanup_dir is not None:
            shutil.rmtree(cleanup_dir, ignore_errors=True)
    return conversations, source


def load_capture_json(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and isinstance(data.get("conversations"), list):
        return [normalize_conversation(item) for item in data["conversations"] if isinstance(item, dict)]
    if isinstance(data, dict) and isinstance(data.get("messages"), list):
        return [normalize_conversation(data)]
    if isinstance(data, list):
        return [normalize_conversation(item) for item in data if isinstance(item, dict)]
    raise RuntimeError(f"unsupported_capture_json:{path}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Extract Q/A knowledge from ChatGPT Project conversations.")
    parser.add_argument("--project-url", default="", help="ChatGPT Project URL. The operator discovers /c/<id> conversations from it.")
    parser.add_argument("--conversation-url", action="append", default=[], help="Explicit ChatGPT conversation URL. Can be repeated.")
    parser.add_argument("--conversation-list", default="", help="Text file with one ChatGPT conversation URL per line.")
    parser.add_argument("--capture-json", default="", help="Offline capture JSON for tests/backfills; bypasses browser.")
    parser.add_argument("--out", default=str(DEFAULT_OUT_ROOT), help="Output artifact directory.")
    parser.add_argument("--limit", type=int, default=50, help="Maximum conversations to extract.")
    parser.add_argument("--settle-ms", type=int, default=2500, help="Wait after conversation navigation before DOM capture.")
    parser.add_argument("--queue-timeout-seconds", type=int, default=6 * 60 * 60, help="FIFO wait timeout for browser-agent jobs.")
    parser.add_argument("--json", action="store_true", help="Print manifest JSON only.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    queued_rc = enqueue_current_process_if_needed(
        job_name="chatgpt-project-knowledge-extract",
        repo_root=ROOT,
        cwd=Path.cwd(),
        timeout_seconds=args.queue_timeout_seconds,
    )
    if queued_rc is not None:
        return queued_rc

    out_dir = Path(args.out).expanduser()
    if args.capture_json:
        conversations = load_capture_json(Path(args.capture_json).expanduser())
        source = {"mode": "capture_json", "capture_json": str(Path(args.capture_json).expanduser())}
    else:
        conversations, source = asyncio.run(run_browser_extraction(args))
    manifest = write_artifacts(conversations, out_dir, source=source)
    if args.json:
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
    else:
        print(f"chatgpt_project_knowledge_extract ok: conversations={manifest['conversation_count']} qa_pairs={manifest['qa_pair_count']} out={out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
