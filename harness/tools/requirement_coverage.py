#!/usr/bin/env python3
"""Requirement trace, coverage, and acceptance verdict helpers."""
from __future__ import annotations

import argparse
import copy
import json
import os
import sys
from pathlib import Path
from typing import Any


PASS_STATES = {"passed"}
PROGRESS_STATES = {"queued", "assigned", "dispatched", "in_progress", "reviewing"}
HARNESS_DIR = Path(os.environ.get("HARNESS_DIR", Path(__file__).resolve().parents[1]))
HARNESS_LIB = HARNESS_DIR / "lib"
if str(HARNESS_LIB) not in sys.path:
    sys.path.insert(0, str(HARNESS_LIB))

_GRAPH_SCHEDULER_MODULE: Any | None = None
_GRAPH_SCHEDULER_IMPORT_ATTEMPTED = False


def _graph_scheduler() -> Any | None:
    global _GRAPH_SCHEDULER_IMPORT_ATTEMPTED, _GRAPH_SCHEDULER_MODULE
    if _GRAPH_SCHEDULER_IMPORT_ATTEMPTED:
        return _GRAPH_SCHEDULER_MODULE
    _GRAPH_SCHEDULER_IMPORT_ATTEMPTED = True
    try:
        import graph_scheduler  # type: ignore

        _GRAPH_SCHEDULER_MODULE = graph_scheduler
    except Exception:
        _GRAPH_SCHEDULER_MODULE = None
    return _GRAPH_SCHEDULER_MODULE


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_task_graph(path: Path) -> dict[str, Any]:
    scheduler = _graph_scheduler()
    if scheduler is not None and hasattr(scheduler, "load_graph"):
        try:
            return scheduler.load_graph(path)
        except Exception:
            pass
    return _load_json(path)


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _derive_requirements(requirement_ir: dict[str, Any]) -> list[dict[str, Any]]:
    requirements = list(requirement_ir.get("requirements") or [])
    if requirements:
        return requirements

    derived: list[dict[str, Any]] = [
        {
            "id": "REQ-000",
            "source_text": requirement_ir.get("user_intent") or requirement_ir.get("normalized_goal") or "N/A",
            "success_criteria": [requirement_ir.get("normalized_goal") or requirement_ir.get("user_intent") or "N/A"],
            "verification_method": "task_graph_closeout",
            "priority": requirement_ir.get("priority", "P1"),
        }
    ]

    acceptance = (
        requirement_ir.get("contracts", {})
        .get("product", {})
        .get("acceptance", [])
    ) or []
    for index, item in enumerate(acceptance, start=1):
        derived.append(
            {
                "id": f"REQ-{index:03d}",
                "source_text": item,
                "success_criteria": [item],
                "verification_method": "acceptance_evidence",
                "priority": requirement_ir.get("priority", "P1"),
            }
        )
    return derived


def enrich_task_graph_defaults(
    graph: dict[str, Any],
    requirement_ir: dict[str, Any] | None = None,
    *,
    sprint_id: str = "",
) -> dict[str, Any]:
    enriched = copy.deepcopy(graph)
    if sprint_id and not enriched.get("sprint_id"):
        enriched["sprint_id"] = sprint_id
    elif not enriched.get("sprint_id"):
        enriched["sprint_id"] = "N/A"

    requirements = _derive_requirements(requirement_ir or {})
    requirement_ids = [item["id"] for item in requirements]
    nodes = list(enriched.get("nodes") or [])
    if not nodes:
        enriched["nodes"] = []
        return enriched

    dependents: dict[str, list[str]] = {str(node.get("id")): [] for node in nodes}
    for node in nodes:
        for dep in node.get("depends_on") or []:
            dependents.setdefault(str(dep), []).append(str(node.get("id")))
    terminal_ids = [node_id for node_id, refs in dependents.items() if not refs] or [str(nodes[-1].get("id"))]

    total_nodes = len(nodes)
    for index, node in enumerate(nodes, start=1):
        node.setdefault("priority", max(1, (total_nodes - index + 1) * 10))
        node.setdefault("required_phase", "planning_complete")
        deps = list(node.get("depends_on") or [])
        node.setdefault("required_node_id", deps[0] if len(deps) == 1 else None)
        node.setdefault("required_node_status", "passed" if deps else None)
        node.setdefault(
            "requirement_ids",
            requirement_ids if str(node.get("id")) in terminal_ids else requirement_ids[:1],
        )
        acceptance_ids = node.get("acceptance_ids")
        if not acceptance_ids:
            acceptance_ids = [f"ACC-{node.get('id')}-{offset}" for offset, _ in enumerate(node.get("acceptance") or [], start=1)]
            node["acceptance_ids"] = acceptance_ids
    enriched["nodes"] = nodes
    return enriched


def build_requirement_trace(
    requirement_ir: dict[str, Any],
    graph: dict[str, Any],
) -> dict[str, Any]:
    requirements = _derive_requirements(requirement_ir)
    nodes = list(graph.get("nodes") or [])
    node_map = {str(node.get("id")): node for node in nodes}
    results = graph.get("node_results") or {}
    trace_items: list[dict[str, Any]] = []

    for requirement in requirements:
        req_id = requirement["id"]
        mapped_nodes = [
            str(node.get("id"))
            for node in nodes
            if req_id in (node.get("requirement_ids") or [])
        ] or [str(node.get("id")) for node in nodes]
        if req_id == "REQ-000":
            for node in nodes:
                node_id = str(node.get("id"))
                if node_id not in mapped_nodes:
                    mapped_nodes.append(node_id)
        statuses = [_effective_node_status(graph, node_id, node_map[node_id]) for node_id in mapped_nodes]
        if mapped_nodes and all(status in PASS_STATES for status in statuses):
            final_status = "done"
        elif any(status in PASS_STATES or status in PROGRESS_STATES for status in statuses):
            final_status = "partial"
        else:
            final_status = "missing"
        trace_items.append(
            {
                "requirement_id": req_id,
                "source_text": requirement.get("source_text", ""),
                "success_criteria": requirement.get("success_criteria", []),
                "verification_method": requirement.get("verification_method", "acceptance_evidence"),
                "mapped_nodes": mapped_nodes,
                "expected_artifacts": sorted(
                    {
                        artifact
                        for node_id in mapped_nodes
                        for artifact in (node_map.get(node_id, {}).get("outputs") or [])
                    }
                ),
                "final_status": final_status,
            }
        )

    return {
        "schema_version": "solar.requirement_trace.v1",
        "requirement_ir_id": requirement_ir.get("id"),
        "sprint_id": graph.get("sprint_id", "N/A"),
        "items": trace_items,
    }


def build_coverage_report(trace: dict[str, Any], graph: dict[str, Any]) -> dict[str, Any]:
    items = list(trace.get("items") or [])
    summary = {"done": 0, "partial": 0, "missing": 0}
    for item in items:
        summary[item["final_status"]] = summary.get(item["final_status"], 0) + 1
    node_statuses = [
        _effective_node_status(graph, str(node.get("id")), node)
        for node in (graph.get("nodes") or [])
    ]
    graph_complete = bool(node_statuses) and all(status in PASS_STATES for status in node_statuses)
    return {
        "schema_version": "solar.coverage_report.v1",
        "sprint_id": graph.get("sprint_id", "N/A"),
        "requirement_ir_id": trace.get("requirement_ir_id"),
        "summary": {
            "total": len(items),
            "done": summary.get("done", 0),
            "partial": summary.get("partial", 0),
            "missing": summary.get("missing", 0),
            "coverage_ratio": 0 if not items else summary.get("done", 0) / len(items),
            "graph_complete": graph_complete,
        },
        "items": items,
    }


def _effective_node_status(graph: dict[str, Any], node_id: str, node: dict[str, Any]) -> str:
    scheduler = _graph_scheduler()
    if scheduler is not None and hasattr(scheduler, "node_status"):
        try:
            return str(scheduler.node_status(graph, node_id) or "pending").lower()
        except Exception:
            pass
    results = graph.get("node_results") or {}
    result = results.get(node_id) if isinstance(results, dict) else None
    if isinstance(result, dict) and str(result.get("repair_status") or "").lower() == "accepted":
        return "passed"
    if isinstance(result, dict):
        return str(result.get("status") or node.get("status") or "pending").lower()
    return str(node.get("status") or "pending").lower()


def _review_decision_verdict(path: Path) -> str:
    if not path.exists() or path.stat().st_size <= 0:
        return ""
    if path.suffix.lower() == ".json":
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return ""
        return str(payload.get("verdict") or payload.get("status") or "").strip().upper()
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            raw = line.strip()
            if not raw.lower().startswith("verdict:"):
                continue
            return raw.split(":", 1)[1].strip().strip("\"'").upper()
    except Exception:
        return ""
    return ""


def _review_decision_failures(graph: dict[str, Any], sprints_dir: Path) -> list[str]:
    sid = str(graph.get("sprint_id") or "N/A")
    failures: list[str] = []
    for node in graph.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id") or "").strip()
        if not node_id:
            continue
        validates_review = str(node.get("type") or "").lower() == "review" or any(
            str(step.get("target") or "").strip() == "review_decision.yaml"
            for step in (node.get("validation") or [])
            if isinstance(step, dict)
        )
        if not validates_review:
            continue
        paths = [
            sprints_dir / f"{sid}.{node_id}-review_decision.yaml",
            sprints_dir / f"{sid}.{node_id}-review_decision.yml",
            sprints_dir / f"{sid}.{node_id}-review_decision.json",
            sprints_dir / f"{sid}.review_decision.yaml",
            sprints_dir / f"{sid}.review_decision.json",
        ]
        verdicts = [_review_decision_verdict(path) for path in paths]
        if any(verdict in {"FAIL", "FAILED", "ERROR", "REJECTED"} for verdict in verdicts):
            failures.append(node_id)
    return failures


def build_acceptance_verdict(
    requirement_ir: dict[str, Any],
    graph: dict[str, Any],
    coverage_report: dict[str, Any],
    *,
    requested_verdict: str = "pass",
    review_decision_failures: list[str] | None = None,
) -> dict[str, Any]:
    summary = coverage_report.get("summary", {})
    graph_complete = bool(summary.get("graph_complete"))
    requested = requested_verdict.lower()
    review_decision_failures = list(review_decision_failures or [])
    ok = (
        requested == "pass"
        and graph_complete
        and int(summary.get("missing", 0)) == 0
        and int(summary.get("partial", 0)) == 0
        and not review_decision_failures
    )
    reasons: list[str] = []
    if requested != "pass":
        reasons.append("requested_verdict_is_not_pass")
    if not graph_complete:
        reasons.append("task_graph_incomplete")
    if int(summary.get("partial", 0)) > 0:
        reasons.append("requirement_partial")
    if int(summary.get("missing", 0)) > 0:
        reasons.append("requirement_missing")
    for node_id in review_decision_failures:
        reasons.append(f"review_decision_failed:{node_id}")
    return {
        "schema_version": "solar.acceptance_verdict.v1",
        "sprint_id": graph.get("sprint_id", "N/A"),
        "requirement_ir_id": requirement_ir.get("id"),
        "requested_verdict": requested_verdict.upper(),
        "coverage_summary": summary,
        "verdict": "PASS" if ok else "FAIL",
        "reasons": reasons,
    }


def render_coverage_markdown(
    trace: dict[str, Any],
    coverage_report: dict[str, Any],
    verdict: dict[str, Any],
) -> str:
    summary = coverage_report.get("summary", {})
    items = list(trace.get("items") or [])
    lines = [
        "<!-- requirement_coverage:start -->",
        "## Requirement Coverage",
        "",
        f"- 总量: {summary.get('total', 0)}",
        f"- done: {summary.get('done', 0)}",
        f"- partial: {summary.get('partial', 0)}",
        f"- missing: {summary.get('missing', 0)}",
        f"- coverage_ratio: {summary.get('coverage_ratio', 0):.2f}",
        f"- graph_complete: {summary.get('graph_complete', False)}",
        f"- acceptance_verdict: {verdict.get('verdict', 'N/A')}",
        "",
        "### Requirement Diff",
        "",
    ]
    for item in items:
        lines.append(
            f"- [{item.get('final_status','missing')}] {item.get('requirement_id','N/A')}: {item.get('source_text','').strip()}"
        )
    reasons = verdict.get("reasons") or []
    if reasons:
        lines.extend(["", "### Gate Reasons", ""])
        for reason in reasons:
            lines.append(f"- {reason}")
    lines.extend(["", "<!-- requirement_coverage:end -->", ""])
    return "\n".join(lines)


def upsert_coverage_markdown(path: Path, markdown: str) -> None:
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    start_marker = "<!-- requirement_coverage:start -->"
    end_marker = "<!-- requirement_coverage:end -->"
    if start_marker in text and end_marker in text:
        prefix = text.split(start_marker, 1)[0].rstrip()
        suffix = text.split(end_marker, 1)[1].lstrip()
        merged = prefix + ("\n\n" if prefix else "") + markdown.rstrip() + ("\n\n" + suffix if suffix else "\n")
    else:
        merged = text.rstrip() + ("\n\n" if text.strip() else "") + markdown.rstrip() + "\n"
    path.write_text(merged, encoding="utf-8")


def _resolve_paths(base: Path, sid: str) -> tuple[Path, Path]:
    req_path = base / f"{sid}.requirement_ir.json"
    graph_path = base / f"{sid}.task_graph.json"
    if not req_path.exists():
        raise FileNotFoundError(f"requirement_ir missing: {req_path}")
    if not graph_path.exists():
        raise FileNotFoundError(f"task_graph missing: {graph_path}")
    return req_path, graph_path


def evaluate_sid(
    sid: str,
    *,
    sprints_dir: Path,
    requested_verdict: str = "pass",
    write: bool = False,
    require_pass: bool = False,
) -> dict[str, Any]:
    req_path, graph_path = _resolve_paths(sprints_dir, sid)
    requirement_ir = _load_json(req_path)
    requirement_ir["requirements"] = _derive_requirements(requirement_ir)
    requirement_ir.setdefault(
        "scheduling",
        {
            "queue_class": "requirements_compile",
            "global_priority_boost": 1000,
            "lane_hint": requirement_ir.get("lane_hint", "delivery"),
        },
    )
    graph = enrich_task_graph_defaults(_load_task_graph(graph_path), requirement_ir, sprint_id=sid)
    trace = build_requirement_trace(requirement_ir, graph)
    coverage = build_coverage_report(trace, graph)
    review_failures = _review_decision_failures(graph, sprints_dir)
    verdict = build_acceptance_verdict(
        requirement_ir,
        graph,
        coverage,
        requested_verdict=requested_verdict,
        review_decision_failures=review_failures,
    )
    bundle = {
        "requirement_ir": requirement_ir,
        "task_graph": graph,
        "requirement_trace": trace,
        "coverage_report": coverage,
        "acceptance_verdict": verdict,
    }
    if write:
        _write_json(req_path, requirement_ir)
        _write_json(graph_path, graph)
        _write_json(sprints_dir / f"{sid}.requirement_trace.json", trace)
        _write_json(sprints_dir / f"{sid}.coverage_report.json", coverage)
        _write_json(sprints_dir / f"{sid}.acceptance_verdict.json", verdict)
    if require_pass and verdict["verdict"] != "PASS":
        raise SystemExit(2)
    return bundle


def annotate_markdown(
    sid: str,
    *,
    sprints_dir: Path,
    target_file: Path,
    requested_verdict: str = "pass",
) -> dict[str, Any]:
    bundle = evaluate_sid(
        sid,
        sprints_dir=sprints_dir,
        requested_verdict=requested_verdict,
        write=True,
        require_pass=False,
    )
    markdown = render_coverage_markdown(
        bundle["requirement_trace"],
        bundle["coverage_report"],
        bundle["acceptance_verdict"],
    )
    upsert_coverage_markdown(target_file, markdown)
    return bundle


def main() -> int:
    parser = argparse.ArgumentParser(description="Requirement coverage and acceptance verdict helper.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    evaluate = sub.add_parser("evaluate")
    evaluate.add_argument("--sid", required=True)
    evaluate.add_argument("--sprints-dir", default=str(Path.home() / ".solar/harness/sprints"))
    evaluate.add_argument("--requested-verdict", default="pass", choices=["pass", "fail"])
    evaluate.add_argument("--write", action="store_true")
    evaluate.add_argument("--require-pass", action="store_true")
    annotate = sub.add_parser("annotate-markdown")
    annotate.add_argument("--sid", required=True)
    annotate.add_argument("--target-file", required=True)
    annotate.add_argument("--sprints-dir", default=str(Path.home() / ".solar/harness/sprints"))
    annotate.add_argument("--requested-verdict", default="pass", choices=["pass", "fail"])
    args = parser.parse_args()

    if args.cmd == "evaluate":
        bundle = evaluate_sid(
            args.sid,
            sprints_dir=Path(args.sprints_dir),
            requested_verdict=args.requested_verdict,
            write=args.write,
            require_pass=args.require_pass,
        )
        json.dump(
            {
                "ok": True,
                "verdict": bundle["acceptance_verdict"]["verdict"],
                "coverage_summary": bundle["coverage_report"]["summary"],
            },
            fp=sys.stdout,
            ensure_ascii=False,
            indent=2,
        )
        sys.stdout.write("\n")
        return 0
    if args.cmd == "annotate-markdown":
        bundle = annotate_markdown(
            args.sid,
            sprints_dir=Path(args.sprints_dir),
            target_file=Path(args.target_file),
            requested_verdict=args.requested_verdict,
        )
        json.dump(
            {
                "ok": True,
                "target_file": str(args.target_file),
                "verdict": bundle["acceptance_verdict"]["verdict"],
            },
            fp=sys.stdout,
            ensure_ascii=False,
            indent=2,
        )
        sys.stdout.write("\n")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
