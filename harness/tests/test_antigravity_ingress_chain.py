from __future__ import annotations

import json
import os
import sys
from pathlib import Path


HARNESS_DIR = Path(__file__).resolve().parents[1]
LIB_DIR = HARNESS_DIR / "lib"
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))

from antigravity_bridge import scan_once


FIXTURE_DIR = HARNESS_DIR / "tests" / "fixtures" / "antigravity-ingress"


def test_antigravity_scan_consumes_into_requirement_ir_source(tmp_path, monkeypatch):
    bridge_root = tmp_path / "antigravity-bridge"
    sprints_dir = tmp_path / "sprints"
    intents_dir = tmp_path / "intents"
    inbox = bridge_root / "from-antigravity"
    inbox.mkdir(parents=True)
    fixture = FIXTURE_DIR / "req-source-chain.md"
    assert fixture.exists()
    (inbox / fixture.name).write_text(fixture.read_text(encoding="utf-8"), encoding="utf-8")

    monkeypatch.setenv("SOLAR_ANTIGRAVITY_BRIDGE_ROOT", str(bridge_root))
    monkeypatch.setenv("SOLAR_HARNESS_DIR", str(HARNESS_DIR))
    monkeypatch.setenv("HARNESS_DIR", str(HARNESS_DIR))
    monkeypatch.setenv("SOLAR_HARNESS_SPRINTS_DIR", str(sprints_dir))
    monkeypatch.setenv("SOLAR_INTENT_GATEWAY_DIR", str(intents_dir))
    monkeypatch.setenv("SOLAR_INTENT_CONSUMER_WORKSPACE_ROOT", str(HARNESS_DIR))

    result = scan_once(harness_dir=HARNESS_DIR, sprints_dir=sprints_dir, dry_run=False)

    assert result.summary()["processed"] == 1
    assert result.failed_capture == []
    assert result.failed_consume == []
    sprint_irs = sorted(sprints_dir.glob("*.requirement_ir.json"))
    assert len(sprint_irs) == 1
    requirement_ir = json.loads(sprint_irs[0].read_text(encoding="utf-8"))
    assert requirement_ir["source"] == "antigravity-app"
    assert requirement_ir["source_details"]["channel"] == "antigravity_app"

    replay = scan_once(harness_dir=HARNESS_DIR, sprints_dir=sprints_dir, dry_run=False)
    assert replay.summary()["processed"] == 0
    assert replay.failed_capture == []
    assert replay.failed_consume == []
