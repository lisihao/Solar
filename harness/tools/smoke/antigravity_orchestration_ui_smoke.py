#!/usr/bin/env python3
"""Deterministic end-to-end visibility smoke for S04 orchestration-ui surfaces.

Validates the complete data path: RawIntent → lineage oracle → routes → pane evidence.
No network calls. All artifacts created in a temp directory tree.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

HARNESS = Path(__file__).resolve().parents[2]
os.environ.setdefault("SOLAR_HARNESS_DIR", str(HARNESS))

sys.path.insert(0, str(HARNESS / "tools"))
sys.path.insert(0, str(HARNESS / "lib"))
sys.path.insert(0, str(HARNESS / "tests"))
sys.path.insert(0, str(HARNESS))


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _make_fixtures(sprints_dir: Path, state_dir: Path) -> dict[str, Any]:
    raw_antigravity = {
        "intent_id": "intent-smoke-ag",
        "source": {"channel": "antigravity_app", "conversation_id": "conv-smoke-1", "project_id": "proj-smoke"},
        "raw": {"text": "smoke test antigravity", "received_at": "2026-06-05T10:00:00Z"},
    }
    _write_json(sprints_dir / "sprint-smoke-ag.raw_intent.json", raw_antigravity)

    raw_codex = {
        "intent_id": "intent-smoke-cx",
        "source": {"channel": "codex_bridge"},
        "raw": {"text": "smoke test codex"},
    }
    _write_json(sprints_dir / "sprint-smoke-cx.raw_intent.json", raw_codex)

    pane_state = {
        "pane-smoke:0.1": {
            "some_key": "preserved",
            "antigravity_bridge_evidence": {
                "last_capture_ts": "2026-06-05T08:00:00Z",
                "last_capture_intent_id": "intent-old",
            },
        },
    }
    _write_json(state_dir / "pane-state.json", pane_state)

    autopilot_state = {
        "activation_history": [
            {"source_lineage": {"source": "antigravity-app"}, "sprint_id": "sprint-smoke-ag"},
            {"source_lineage": {"source": "codex"}, "sprint_id": "sprint-smoke-cx"},
        ],
    }
    _write_json(state_dir / "autopilot-state.json", autopilot_state)

    return {
        "sprints_dir": sprints_dir,
        "state_dir": state_dir,
        "antigravity_sprint": "sprint-smoke-ag",
        "codex_sprint": "sprint-smoke-cx",
    }


def smoke_lineage_view(fx: dict[str, Any]) -> list[str]:
    import tools.antigravity_orchestration_view as lv
    failures: list[str] = []

    lv.SPRINTS_DIR = fx["sprints_dir"]

    ag = lv.lineage_for_sprint(fx["antigravity_sprint"])
    if ag["source"] != "antigravity-app":
        failures.append(f"lineage antigravity source: got {ag['source']!r}, expected 'antigravity-app'")
    if not ag["is_antigravity_desktop"]:
        failures.append("lineage antigravity is_antigravity_desktop: got False, expected True")
    if ag["conversation_id"] != "conv-smoke-1":
        failures.append(f"lineage conversation_id: got {ag['conversation_id']!r}")

    cx = lv.lineage_for_sprint(fx["codex_sprint"])
    if cx["source"] != "codex":
        failures.append(f"lineage codex source: got {cx['source']!r}, expected 'codex'")
    if cx["is_antigravity_desktop"]:
        failures.append("lineage codex is_antigravity_desktop: got True, expected False")

    missing = lv.lineage_for_sprint("sprint-nonexistent")
    if missing["source"] != "unknown":
        failures.append(f"lineage unknown source: got {missing['source']!r}, expected 'unknown'")

    return failures


def smoke_pane_evidence(fx: dict[str, Any]) -> list[str]:
    from tools.antigravity_pane_evidence import write_evidence, read_evidence
    failures: list[str] = []

    pane_path = fx["state_dir"] / "pane-state.json"

    result = write_evidence(
        "pane-smoke:0.1",
        pane_state_path=pane_path,
        last_capture_ts="2026-06-05T10:00:00Z",
        last_capture_intent_id="intent-smoke-ag",
        inbox_now=1,
        processed_total=5,
    )
    if result["last_capture_ts"] != "2026-06-05T10:00:00Z":
        failures.append(f"pane write capture_ts: got {result['last_capture_ts']!r}")
    if result["last_capture_intent_id"] != "intent-smoke-ag":
        failures.append(f"pane write intent_id: got {result['last_capture_intent_id']!r}")

    older = write_evidence(
        "pane-smoke:0.1",
        pane_state_path=pane_path,
        last_capture_ts="2026-06-05T06:00:00Z",
        last_capture_intent_id="intent-older",
    )
    if older["last_capture_ts"] != "2026-06-05T10:00:00Z":
        failures.append(f"pane merge newer-wins: got {older['last_capture_ts']!r}, expected newer to persist")

    state_after = json.loads(pane_path.read_text(encoding="utf-8"))
    if state_after["pane-smoke:0.1"]["some_key"] != "preserved":
        failures.append("pane preserves unrelated: some_key was lost")

    evidence = read_evidence("pane-smoke:0.1", pane_state_path=pane_path)
    if evidence is None or evidence["processed_total"] != 5:
        failures.append(f"pane read evidence: got {evidence}")

    return failures


def smoke_autopilot_routing(fx: dict[str, Any]) -> list[str]:
    import importlib.util
    failures: list[str] = []

    mod_name = "autopilot_script_smoke"
    mod_path = HARNESS / "tools" / "autopilot.py"
    spec = importlib.util.spec_from_file_location(mod_name, mod_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)

    import tools.antigravity_orchestration_view as lv
    lv.SPRINTS_DIR = fx["sprints_dir"]
    sys.modules["antigravity_orchestration_view"] = lv

    decision = mod._lineage_decision(fx["antigravity_sprint"])
    if decision["source"] != "antigravity-app":
        failures.append(f"autopilot lineage: got {decision['source']!r}, expected 'antigravity-app'")

    decision_cx = mod._lineage_decision(fx["codex_sprint"])
    if decision_cx["source"] != "codex":
        failures.append(f"autopilot lineage codex: got {decision_cx['source']!r}, expected 'codex'")

    orig_dir = mod.HARNESS_DIR
    mod.HARNESS_DIR = fx["state_dir"].parent
    report = mod._report_source_mix()
    mod.HARNESS_DIR = orig_dir
    if report["by_source"].get("antigravity-app") != 1:
        failures.append(f"autopilot report antigravity-app count: got {report['by_source']}")
    if report["by_source"].get("codex") != 1:
        failures.append(f"autopilot report codex count: got {report['by_source']}")

    return failures


def run() -> int:
    with tempfile.TemporaryDirectory(prefix="s04-smoke-") as tmp:
        tmp_path = Path(tmp)
        sprints_dir = tmp_path / "sprints"
        state_dir = tmp_path / "state"
        sprints_dir.mkdir()
        state_dir.mkdir()

        fx = _make_fixtures(sprints_dir, state_dir)

        all_failures: list[str] = []
        for name, fn in [
            ("lineage-view", smoke_lineage_view),
            ("pane-evidence", smoke_pane_evidence),
            ("autopilot-routing", smoke_autopilot_routing),
        ]:
            print(f"\n── {name} ──", flush=True)
            failures = fn(fx)
            if failures:
                for f in failures:
                    print(f"  FAIL: {f}", flush=True)
                all_failures.extend(failures)
            else:
                print("  PASS", flush=True)

        print(f"\n{'='*50}", flush=True)
        if all_failures:
            print(f"SMOKE FAILED: {len(all_failures)} failure(s)", flush=True)
            return 1
        print("SMOKE PASSED: all surfaces verified", flush=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(run())
