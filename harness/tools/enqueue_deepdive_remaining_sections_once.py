#!/usr/bin/env python3
"""Enqueue unfinished DeepDive sections into the browser-agent FIFO queue."""

from __future__ import annotations

import datetime as dt
import json
import os
import shutil
import uuid
from pathlib import Path


RUN_DIR = Path(
    "/Users/lisihao/.solar/harness/reports/"
    "deepdive-mlsys-2026-cais-2026-agent-system-20260614T003203Z"
)
QUEUE_DIR = Path("/Users/lisihao/.solar/harness/state/browser-agent-queue")


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _unfinished_sections() -> list[str]:
    sections: list[str] = []
    for spec in sorted(RUN_DIR.glob("sections/*/*/section.spec.json")):
        data = _read_json(spec)
        section_id = data.get("section_id") or "/".join(spec.parts[-3:-1])
        section_dir = spec.parent
        review = _read_json(section_dir / "review.json")
        if (section_dir / "final.md").exists() and review.get("verdict") == "PASS":
            continue
        pack = _read_json(section_dir / "evidence_pack.json")
        if pack.get("status") != "ready":
            raise SystemExit(f"section not ready: {section_id} status={pack.get('status')}")
        sections.append(str(section_id))
    return sections


def _job(section_id: str, created_at: str) -> dict:
    sec_name = section_id.replace("/", "-")
    return {
        "id": uuid.uuid4().hex[:16],
        "name": f"deepdive-browser-agent-section-{sec_name}",
        "created_at": created_at,
        "cwd": "/Users/lisihao/.solar/harness",
        "env": {
            "BROWSER_AGENT_CHATGPT_ACCOUNT_EMAIL": "haogege1977@gmail.com",
            "BROWSER_AGENT_CHATGPT_FORCE_NEW_CHAT": "true",
            "BROWSER_AGENT_CHATGPT_MODEL_MODE": "thinking",
            "BROWSER_AGENT_CHATGPT_OPEN_PROJECT_FIRST": "false",
            "BROWSER_AGENT_CHATGPT_REQUIRE_ISOLATED_CONVERSATION": "true",
            "BROWSER_AGENT_CHATGPT_REQUIRE_PROJECT": "false",
            "BROWSER_AGENT_CHATGPT_REQUIRE_UI_MODE": "false",
            "BROWSER_AGENT_CHATGPT_SCRUB_CLIENT_STATE": "false",
            "BROWSER_AGENT_EXPECTED_OUTPUT": "markdown",
            "BROWSER_AGENT_HEADLESS": "true",
            "BROWSER_AGENT_PROFILE_DIRECTORY": "Default",
            "BROWSER_AGENT_PURPOSE": f"deepdive-section-{sec_name}",
            "BROWSER_AGENT_TARGET_ACCOUNT_EMAIL": "haogege1977@gmail.com",
            "HARNESS_DIR": "/Users/lisihao/.solar/harness",
            "HOME": "/Users/lisihao",
            "PATH": os.environ.get("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"),
            "PYTHONIOENCODING": "utf-8",
            "SOLAR_HOME": "/Users/lisihao/.solar",
            "SOLAR_KNOWLEDGE_DIR": "/Users/lisihao/Knowledge",
            "SOLAR_REPO": "/Users/lisihao/Solar",
        },
        "command": [
            "/opt/homebrew/opt/python@3.14/bin/python3.14",
            "/Users/lisihao/.solar/harness/lib/research/cli.py",
            "survey-write-section",
            "--output-dir",
            str(RUN_DIR),
            "--section-id",
            section_id,
            "--max-revisions",
            "1",
            "--min-chars",
            "1200",
            "--writer-backend",
            "browser-agent-chatgpt",
            "--writer-timeout",
            "3600",
            "--json",
        ],
    }


def main() -> int:
    pending = QUEUE_DIR / "pending.jsonl"
    existing = [
        json.loads(line)
        for line in pending.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ] if pending.exists() else []

    existing = [
        row
        for row in existing
        if not str(row.get("name", "")).startswith("deepdive-browser-agent-section-")
    ]
    sections = _unfinished_sections()
    now = dt.datetime.now(dt.timezone.utc)
    jobs = [
        _job(section_id, (now + dt.timedelta(milliseconds=idx)).isoformat().replace("+00:00", "Z"))
        for idx, section_id in enumerate(sections)
    ]
    backup = pending.with_name(f"pending.jsonl.bak-deepdive-all-{int(dt.datetime.now().timestamp())}")
    if pending.exists():
        shutil.copy2(pending, backup)
    pending.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False, sort_keys=True) for row in jobs + existing) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "ok": True,
        "inserted": len(jobs),
        "backup": str(backup),
        "first": jobs[0]["name"] if jobs else None,
        "last": jobs[-1]["name"] if jobs else None,
        "pending_count": len(jobs) + len(existing),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
