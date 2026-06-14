#!/usr/bin/env python3
"""Control-plane wrapper for cmux monitoring workspaces."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:  # pragma: no cover - exercised by runtime environment
    print("ERROR: PyYAML not installed. Run: pip3 install pyyaml", file=sys.stderr)
    sys.exit(1)


HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", Path.home() / ".solar" / "harness"))
STATE_PATH = Path(os.environ.get("CMUX_WORKSPACES_STATE", HARNESS_DIR / "state" / "cmux-workspaces.json"))
TELEMETRY_DIR = Path(os.environ.get("CMUX_TELEMETRY_DIR", HARNESS_DIR / "telemetry" / "cmux"))
EVIDENCE_DIR = Path(os.environ.get("CMUX_EVIDENCE_DIR", HARNESS_DIR / "run" / "actor-evidence"))
SCRIPTS_DIR = HARNESS_DIR / "scripts" / "cmux"
UP_CMD = SCRIPTS_DIR / "cmux-monitor-up"
DOWN_CMD = SCRIPTS_DIR / "cmux-monitor-down"
DOCTOR_CMD = SCRIPTS_DIR / "cmux-monitor-doctor"
RENDER_CMD = SCRIPTS_DIR / "render-cmux-workspace"
DEFAULT_SPRINT_ID = "sprint-20260531-cmux-多标签四分屏-tmux-状态监控工作台-s04-orchestration-ui"


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=str(path.parent),
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    ) as handle:
        tmp = Path(handle.name)
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


def load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {"schema_version": "solar.cmux_workspaces.v1", "active_workspaces": {}}
    try:
        payload = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            payload.setdefault("schema_version", "solar.cmux_workspaces.v1")
            payload.setdefault("active_workspaces", {})
            return payload
    except Exception:
        pass
    return {"schema_version": "solar.cmux_workspaces.v1", "active_workspaces": {}}


def save_state(state: dict[str, Any]) -> None:
    state["updated_at"] = now_iso()
    atomic_write_json(STATE_PATH, state)


def read_config(config_path: Path) -> dict[str, Any]:
    with config_path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise ValueError("config must be a mapping")
    return data


def workspace_name(config_path: Path) -> str:
    return str(read_config(config_path).get("workspace_name") or "cmux-workspace")


def render_plan(config_path: Path) -> dict[str, Any]:
    result = subprocess.run(
        [sys.executable, str(RENDER_CMD), str(config_path), "--json"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "render failed")
    plan = json.loads(result.stdout)
    cfg = read_config(config_path)
    cfg_tabs = cfg.get("tabs") if isinstance(cfg.get("tabs"), list) else []
    for tab_index, tab in enumerate(plan.get("tabs") or []):
        cfg_tab = cfg_tabs[tab_index] if tab_index < len(cfg_tabs) and isinstance(cfg_tabs[tab_index], dict) else {}
        cfg_panes = cfg_tab.get("panes") if isinstance(cfg_tab.get("panes"), list) else []
        for pane_index, pane in enumerate(tab.get("panes") or []):
            cfg_pane = cfg_panes[pane_index] if pane_index < len(cfg_panes) and isinstance(cfg_panes[pane_index], dict) else {}
            for key in ("tmux_target", "ssh_profile", "log_path", "lines", "interval_sec"):
                if key in cfg_pane and key not in pane:
                    pane[key] = cfg_pane[key]
    return plan


def run_command(cmd: list[str], dry_run: bool = False) -> dict[str, Any]:
    if dry_run:
        return {"returncode": 0, "stdout": "dry-run", "stderr": "", "command": cmd}
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    return {
        "returncode": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
        "command": cmd,
    }


def status_from_report(report: dict[str, Any]) -> str:
    if report.get("ok") is True:
        return "OK"
    checks = report.get("checks") if isinstance(report.get("checks"), list) else []
    if checks and any(not c.get("ok") for c in checks if isinstance(c, dict)):
        return "FAILED"
    return "DEGRADED"


def pane_records(plan: dict[str, Any], doctor_report: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    failures: dict[str, str] = {}
    if doctor_report:
        for check in doctor_report.get("checks") or []:
            if isinstance(check, dict) and not check.get("ok"):
                failures[str(check.get("name") or "unknown")] = str(check.get("reason") or "failed")

    tabs: list[dict[str, Any]] = []
    for tab in plan.get("tabs") or []:
        panes = []
        for pane in tab.get("panes") or []:
            target = str(pane.get("tmux_target") or "")
            related_failure = next((reason for name, reason in failures.items() if target.replace(":", "_").replace(".", "_") in name), "")
            panes.append({
                "title": pane.get("title") or target or "pane",
                "source": pane.get("source") or "local",
                "tmux_target": target,
                "mode": pane.get("mode") or "capture",
                "health": "FAILED" if related_failure else ("OK" if not failures else "DEGRADED"),
                "blocking_reason": related_failure,
            })
        tabs.append({
            "id": tab.get("id") or tab.get("title") or "tab",
            "name": tab.get("title") or tab.get("id") or "tab",
            "layout": tab.get("layout") or "quad",
            "panes": panes,
        })
    return tabs


def write_evidence(sprint_id: str, node_id: str, event_type: str, payload: dict[str, Any]) -> str:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    ledger_path = EVIDENCE_DIR / f"{sprint_id}.jsonl"
    entry = {
        "event_type": event_type,
        "timestamp": now_iso(),
        "sprint_id": sprint_id,
        "node_id": node_id,
        "tool": "tools/cmux_orch.py",
        "state_path": str(STATE_PATH),
        "payload": payload,
    }
    with ledger_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return str(ledger_path)


def write_telemetry(workspace: str, report: dict[str, Any]) -> str:
    TELEMETRY_DIR.mkdir(parents=True, exist_ok=True)
    path = TELEMETRY_DIR / f"{workspace}.doctor.jsonl"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"ts": now_iso(), "report": report}, ensure_ascii=False) + "\n")
    return str(path)


def update_workspace_record(
    name: str,
    *,
    config_path: Path | None,
    plan: dict[str, Any] | None,
    status: str,
    command_result: dict[str, Any] | None = None,
    doctor_report: dict[str, Any] | None = None,
) -> dict[str, Any]:
    state = load_state()
    active = state.setdefault("active_workspaces", {})
    existing = active.get(name) if isinstance(active.get(name), dict) else {}
    record = dict(existing)
    record.update({
        "name": name,
        "status": status,
        "updated_at": now_iso(),
    })
    if config_path is not None:
        record["config_path"] = str(config_path)
    if plan is not None:
        record["tabs"] = pane_records(plan, doctor_report)
    if command_result is not None:
        record["last_command"] = command_result
    if doctor_report is not None:
        record["doctor"] = doctor_report
        record["blocking_reasons"] = [
            str(c.get("reason") or c.get("name") or "failed")
            for c in doctor_report.get("checks") or []
            if isinstance(c, dict) and not c.get("ok")
        ]
    active[name] = record
    save_state(state)
    return record


def start(args: argparse.Namespace) -> int:
    config_path = Path(args.config).expanduser().resolve()
    if not config_path.exists():
        raise FileNotFoundError(config_path)
    plan = render_plan(config_path)
    name = str(plan.get("workspace_name") or workspace_name(config_path))
    command_result = run_command([sys.executable, str(UP_CMD), str(config_path)], dry_run=args.dry_run)
    status = "OK" if command_result["returncode"] == 0 else "FAILED"
    record = update_workspace_record(
        name,
        config_path=config_path,
        plan=plan,
        status=status,
        command_result=command_result,
    )
    evidence = write_evidence(args.sprint_id, args.node_id, "cmux_start", {"workspace": name, "record": record})
    print(json.dumps({"ok": status == "OK", "workspace": name, "state_path": str(STATE_PATH), "evidence_ledger": evidence}, ensure_ascii=False))
    return 0 if status == "OK" else command_result["returncode"] or 1


def stop(args: argparse.Namespace) -> int:
    name = args.name
    config_path: Path | None = None
    if args.config:
        config_path = Path(args.config).expanduser().resolve()
        if not config_path.exists():
            raise FileNotFoundError(config_path)
        name = name or workspace_name(config_path)
    if not name:
        raise ValueError("provide --name or --config")
    cmd = [sys.executable, str(DOWN_CMD)]
    if config_path:
        cmd.append(str(config_path))
    else:
        cmd.extend(["--name", name])
    command_result = run_command(cmd, dry_run=args.dry_run)
    cleanup = cleanup_control_sockets(name, dry_run=args.dry_run)
    status = "inactive" if command_result["returncode"] == 0 else "FAILED"
    record = update_workspace_record(
        name,
        config_path=config_path,
        plan=None,
        status=status,
        command_result={**command_result, "control_socket_cleanup": cleanup},
    )
    evidence = write_evidence(args.sprint_id, args.node_id, "cmux_stop", {"workspace": name, "record": record})
    print(json.dumps({"ok": status == "inactive", "workspace": name, "state_path": str(STATE_PATH), "evidence_ledger": evidence}, ensure_ascii=False))
    return 0 if status == "inactive" else command_result["returncode"] or 1


def cleanup_control_sockets(name: str, dry_run: bool = False) -> dict[str, Any]:
    ssh_dir = Path(os.environ.get("CMUX_SSH_DIR", Path.home() / ".ssh")).expanduser()
    patterns = [f"cmux-*{name}*", "cmux-*@*"]
    removed: list[str] = []
    errors: list[str] = []
    if not ssh_dir.exists():
        return {"removed": removed, "errors": errors, "ssh_dir": str(ssh_dir)}
    for pattern in patterns:
        for path in ssh_dir.glob(pattern):
            if not path.name.startswith("cmux-") or not path.is_socket() and not path.is_file():
                continue
            try:
                if not dry_run:
                    path.unlink()
                removed.append(str(path))
            except Exception as exc:
                errors.append(f"{path}: {exc}")
    return {"removed": sorted(set(removed)), "errors": errors, "ssh_dir": str(ssh_dir)}


def doctor(args: argparse.Namespace) -> int:
    config_path: Path | None = Path(args.config).expanduser().resolve() if args.config else None
    state = load_state()
    name = args.name
    if config_path:
        if not config_path.exists():
            raise FileNotFoundError(config_path)
        name = name or workspace_name(config_path)
    elif name:
        record = state.get("active_workspaces", {}).get(name, {})
        if record.get("config_path"):
            config_path = Path(str(record["config_path"])).expanduser().resolve()
    if not config_path:
        raise ValueError("provide --config or a --name with config_path in state")

    result = subprocess.run([sys.executable, str(DOCTOR_CMD), str(config_path), "--compact"], capture_output=True, text=True, check=False)
    try:
        report = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        report = {"ok": False, "workspace": name or "", "checks": [{"name": "doctor_json", "ok": False, "reason": result.stderr.strip() or "invalid json"}]}
    name = name or str(report.get("workspace") or workspace_name(config_path))
    plan = render_plan(config_path)
    status = status_from_report(report)
    telemetry = write_telemetry(name, report)
    record = update_workspace_record(name, config_path=config_path, plan=plan, status=status, doctor_report=report)
    evidence = write_evidence(args.sprint_id, args.node_id, "cmux_doctor", {"workspace": name, "record": record, "telemetry": telemetry})
    output = {"ok": report.get("ok") is True, "workspace": name, "status": status, "report": report, "telemetry": telemetry, "state_path": str(STATE_PATH), "evidence_ledger": evidence}
    print(json.dumps(output, indent=2 if args.pretty else None, ensure_ascii=False))
    return 0 if report.get("ok") is True else result.returncode or 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Solar cmux orchestration control plane")
    parser.add_argument("--sprint-id", default=DEFAULT_SPRINT_ID)
    parser.add_argument("--node-id", default="B1_orchestration_api")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("start")
    p.add_argument("--config", required=True)
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=start)

    p = sub.add_parser("stop")
    p.add_argument("--config")
    p.add_argument("--name")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=stop)

    p = sub.add_parser("doctor")
    p.add_argument("--config")
    p.add_argument("--name")
    p.add_argument("--pretty", action="store_true")
    p.set_defaults(func=doctor)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.func(args))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
