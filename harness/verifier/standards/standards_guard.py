#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from .checkers.registry import status_for_rule
from .compiler import compile_standards, source_manifest
from .coverage_gate import coverage_for_rules
from .execution_plan import SUPPORTED_TRIGGERS, plan_rules
from .result import build_result
from .rule_loader import load_manual_rules, load_rules, merge_manual, write_json


HERE = Path(__file__).resolve()
HARNESS_DIR = HERE.parents[2]


def discover_git_root(start: Path) -> Path:
    proc = subprocess.run(
        ["git", "-C", str(start), "rev-parse", "--show-toplevel"],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    if proc.returncode == 0 and proc.stdout.strip():
        return Path(proc.stdout.strip()).resolve()
    return HERE.parents[3].resolve()


REPO_ROOT = Path(os.environ.get("SOLAR_REPO_ROOT") or discover_git_root(Path.cwd())).resolve()
PACK_DIR = HARNESS_DIR / "verifier" / "standards" / "rule_packs" / "genesispod_standards"
RAW_DIR = REPO_ROOT / ".solar" / "standards" / "genesispod" / "raw"
SOLAR_PORT_DIR = REPO_ROOT / ".solar" / "standards" / "genesispod" / "solar-port"
GENERATED_RULES = PACK_DIR / "rules.generated.yaml"
MANUAL_RULES = PACK_DIR / "rules.manual.yaml"
COVERAGE_LOCK = PACK_DIR / "coverage.lock.json"
REPORT_DIR = REPO_ROOT / "reports" / "standards"


def load_effective_rules() -> list[dict[str, Any]]:
    if not GENERATED_RULES.exists():
        compile_standards(SOLAR_PORT_DIR, GENERATED_RULES, REPO_ROOT)
    return merge_manual(load_rules(GENERATED_RULES), load_manual_rules(MANUAL_RULES))


def write_source_manifest() -> None:
    write_json(REPO_ROOT / ".solar" / "standards" / "genesispod" / "manifest.yaml", source_manifest(RAW_DIR, REPO_ROOT))


def command_compile(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    write_source_manifest()
    payload = compile_standards(SOLAR_PORT_DIR, GENERATED_RULES, REPO_ROOT)
    coverage = coverage_for_rules(load_effective_rules())
    write_json(COVERAGE_LOCK, coverage)
    result = {
        "schema_version": "solar.standards.compile.v1",
        "status": "ok",
        "standards_pack": "genesispod-solar-port",
        "source_file_count": len([p for p in SOLAR_PORT_DIR.glob("*.md") if p.name[:2].isdigit()]),
        "rule_count": payload["rule_count"],
        "artifacts": {
            "rules_generated": str(GENERATED_RULES),
            "coverage_lock": str(COVERAGE_LOCK),
        },
    }
    return result, 0


def command_coverage(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    rules = load_effective_rules()
    coverage = coverage_for_rules(rules)
    try:
        write_json(COVERAGE_LOCK, coverage)
    except OSError as exc:
        coverage["coverage_lock_write_error"] = f"{type(exc).__name__}: {exc}"
    return coverage, 1 if coverage["summary"]["uncovered_must"] else 0


def command_run(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    rules = load_effective_rules()
    coverage = coverage_for_rules(rules)
    plan = plan_rules(rules, args.trigger, args.changed_file or [])
    selected = {rule_id for rule_id in plan["selected_rule_ids"]}
    rule_results = []
    for rule in rules:
        if rule["id"] not in selected:
            rule_results.append(
                {
                    "rule_id": rule["id"],
                    "source": rule["source"],
                    "severity": "warn",
                    "status": "not_applicable",
                    "path": "N/A",
                    "message": f"Rule not selected for trigger {args.trigger}.",
                    "remediation": "N/A",
                    "checker": rule.get("checker"),
                }
            )
            continue
        rule_results.append(status_for_rule(rule, REPO_ROOT))
    out_json = Path(args.out) if args.out else REPORT_DIR / f"standards-{args.trigger}-latest.json"
    out_md = out_json.with_suffix(".md")
    result = build_result(
        standards_pack="genesispod-solar-port",
        trigger=args.trigger,
        changed_files=args.changed_file or [],
        rule_results=rule_results,
        coverage=coverage,
        artifacts={"json": str(out_json), "markdown": str(out_md), "coverage_lock": str(COVERAGE_LOCK)},
    )
    out_json.parent.mkdir(parents=True, exist_ok=True)
    write_json(out_json, result)
    out_md.write_text(render_markdown(result), encoding="utf-8")
    return result, 1 if result["summary"]["uncovered_must"] else 0


def render_markdown(result: dict[str, Any]) -> str:
    summary = result["summary"]
    lines = [
        "# Standards Guard Report",
        "",
        f"- schema: `{result['schema_version']}`",
        f"- status: `{result['status']}`",
        f"- trigger: `{result['trigger']}`",
        f"- total_rules: `{summary['total_rules']}`",
        f"- uncovered_must: `{summary['uncovered_must']}`",
        f"- failed_rules: `{summary.get('failed', 0)}`",
        f"- failure_groups: `{summary.get('failure_groups', 0)}`",
        "",
    ]
    groups = result.get("failure_groups") or []
    if groups:
        lines.extend(["## Failure Groups", ""])
        for group in groups[:20]:
            checker = group.get("checker") or {}
            lines.extend(
                [
                    f"- `{checker.get('name', checker.get('type', 'unknown'))}` · `{group.get('path', 'N/A')}` · rules=`{group.get('rule_count', 0)}`",
                    f"  - {group.get('message', '')}",
                ]
            )
    return "\n".join(lines)


def command_explain(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    rules = load_effective_rules()
    for rule in rules:
        if rule["id"] == args.rule_id:
            return {"schema_version": "solar.standards.explain.v1", "status": "ok", "rule": rule}, 0
    return {"schema_version": "solar.standards.explain.v1", "status": "not_found", "rule_id": args.rule_id}, 2


def command_ratchet(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    rules = load_effective_rules()
    coverage = coverage_for_rules(rules)
    write_json(COVERAGE_LOCK, coverage)
    return {
        "schema_version": "solar.standards.coverage_ratchet.v1",
        "status": coverage["status"],
        "fingerprint": coverage["fingerprint"],
        "coverage_lock": str(COVERAGE_LOCK),
        "summary": coverage["summary"],
    }, 1 if coverage["summary"]["uncovered_must"] else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Solar Standards Guard")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("compile", "coverage", "ratchet-coverage"):
        p = sub.add_parser(name)
        p.add_argument("--json", action="store_true")
    p_run = sub.add_parser("run")
    p_run.add_argument("--json", action="store_true")
    p_run.add_argument("--trigger", choices=sorted(SUPPORTED_TRIGGERS), default="ci")
    p_run.add_argument("--changed-file", action="append")
    p_run.add_argument("--out")
    p_explain = sub.add_parser("explain")
    p_explain.add_argument("rule_id")
    p_explain.add_argument("--json", action="store_true")

    args = parser.parse_args(argv)
    if args.command == "compile":
        payload, rc = command_compile(args)
    elif args.command == "coverage":
        payload, rc = command_coverage(args)
    elif args.command == "run":
        payload, rc = command_run(args)
    elif args.command == "explain":
        payload, rc = command_explain(args)
    else:
        payload, rc = command_ratchet(args)

    if getattr(args, "json", False):
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(payload.get("summary", payload), ensure_ascii=False))
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
