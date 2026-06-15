"""Compute sprint closure evidence payload and write closure artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from jsonschema import ValidationError
    from jsonschema import exceptions as _jsonschema_errors
    from jsonschema import validators as _jsonschema_validators
except Exception as exc:  # pragma: no cover - jsonschema optional in some environments
    ValidationError = Exception  # type: ignore[assignment]
    _jsonschema_errors = None  # type: ignore[assignment]
    _jsonschema_validators = None  # type: ignore[assignment]


SCHEMA_VERSION = "solar.closure_record.v1"
EVAL_EVIDENCE_SUFFIXES = (".eval.json", ".eval.md", "-eval.json", "-eval.md")
BLOCKING_EVAL_RESULTS = {
    "block",
    "blocked",
    "error",
    "fail",
    "failed",
    "needs_attention",
    "reject",
    "rejected",
}
TERMINAL_NODE_STATUSES = {
    "passed",
    "skipped",
    "cancelled",
    "skipped_parent_passed",
    "failed",
}
REQUIRED_GATE_SUCCESS = "passed"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class SprintArtifacts:
    harness_dir: Path
    sprints_dir: Path
    sid: str

    @property
    def task_graph(self) -> Path:
        return self._first_existing(
            f"{self.sid}.task_graph.spec.json",
            f"{self.sid}.task_graph.json",
        )

    @property
    def task_graph_status(self) -> Path:
        return self.sprints_dir / f"{self.sid}.task_graph.json"

    @property
    def task_dag_state(self) -> Path:
        return self.sprints_dir / f"{self.sid}.task_dag.state.json"

    @property
    def task_graph_state(self) -> Path:
        return self.sprints_dir / f"{self.sid}.task_dag.state.json"

    @property
    def closure_json(self) -> Path:
        return self.sprints_dir / f"{self.sid}.closure.json"

    @property
    def closure_md(self) -> Path:
        return self.sprints_dir / f"{self.sid}.closure.md"

    @property
    def contract_md(self) -> Path:
        return self.sprints_dir / f"{self.sid}.contract.md"

    @property
    def status_json(self) -> Path:
        return self.sprints_dir / f"{self.sid}.status.json"

    @property
    def handoff_md(self) -> Path:
        return self.sprints_dir / f"{self.sid}.handoff.md"

    def eval_paths(self) -> list[Path]:
        return sorted(
            p
            for p in self.sprints_dir.glob(f"{self.sid}*")
            if p.is_file() and _is_eval_evidence_path(p)
        )

    def all_candidates(self) -> list[Path]:
        return sorted(self.sprints_dir.glob(f"{self.sid}.*"))

    def _first_existing(self, *names: str) -> Path:
        for name in names:
            p = self.sprints_dir / name
            if p.exists():
                return p
        return self.sprints_dir / names[-1]


@dataclass
class EvidenceRecord:
    evaluator: str
    result: str
    notes: str = ""
    source: str = ""

    def to_dict(self) -> dict[str, str]:
        out = {"evaluator": self.evaluator, "result": self.result}
        if self.notes:
            out["notes"] = self.notes
        if self.source:
            out["source"] = self.source
        return out


def _read_json(path: Path | None) -> dict[str, Any] | None:
    if not path or not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _read_text(path: Path | None) -> str:
    if not path or not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def _status_text(v: Any) -> str:
    return str(v or "").strip().lower()


def _node_terminal(status: Any) -> bool:
    return _status_text(status) in TERMINAL_NODE_STATUSES


def _gate_terminal(result: Any) -> bool:
    if isinstance(result, dict):
        return _status_text(result.get("status")) == REQUIRED_GATE_SUCCESS
    return _status_text(result) == REQUIRED_GATE_SUCCESS


def _sha1_like(payload: Any) -> str:
    h = hashlib.sha1()
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    h.update(raw)
    return h.hexdigest()


def _build_required_artifacts(sid: str) -> list[str]:
    return sorted(
        {
            f"{sid}.task_graph.json",
            f"{sid}.contract.md",
            f"{sid}.status.json",
            f"{sid}.handoff.md",
            f"{sid}.task_dag.state.json",
        }
    )


def _schema_status_from_legacy(status: str) -> str:
    if status == "pass":
        return "passed"
    if status == "fail":
        return "failed"
    return "pending"


def _is_eval_evidence_path(path: Path) -> bool:
    return any(path.name.endswith(suffix) for suffix in EVAL_EVIDENCE_SUFFIXES)


def _evaluator_from_eval_path(sid: str, path: Path) -> str:
    name = path.name
    label = name
    for prefix in (f"{sid}.", f"{sid}-", sid):
        if label.startswith(prefix):
            label = label[len(prefix) :]
            break
    for suffix in EVAL_EVIDENCE_SUFFIXES:
        if label.endswith(suffix):
            label = label[: -len(suffix)]
            break
    return label.strip(".-") or "unknown"


def _eval_record_blocks_closure(record: EvidenceRecord) -> bool:
    normalized = _status_text(record.result).replace("-", "_")
    return normalized in BLOCKING_EVAL_RESULTS or normalized.startswith("fail")


def _graph_completion(graph: dict[str, Any], state: dict[str, Any] | None) -> tuple[bool, bool]:
    nodes = graph.get("nodes") or [] if isinstance(graph, dict) else []
    node_results = (state or {}).get("node_results") if isinstance(state, dict) else {}
    if not isinstance(node_results, dict):
        node_results = {}
    all_nodes_passed = bool(nodes)
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id") or "")
        node_result = node_results.get(node_id) if isinstance(node_results, dict) else None
        if not isinstance(node_result, dict):
            node_result = {}
        status = str(node_result.get("status") or node.get("status") or "").strip().lower()
        if status != "passed":
            all_nodes_passed = False
            break

    required_gates = graph.get("required_gates") or [] if isinstance(graph, dict) else []
    gate_results = (state or {}).get("gate_results") if isinstance(state, dict) else {}
    if not isinstance(gate_results, dict):
        gate_results = {}
    fallback_gates = graph.get("gate_results") or {} if isinstance(graph, dict) else {}
    if not isinstance(fallback_gates, dict):
        fallback_gates = {}
    all_required_gates_passed = True
    if isinstance(required_gates, list):
        for gate in required_gates:
            if not _gate_terminal(gate_results.get(gate)) and not _gate_terminal(fallback_gates.get(gate)):
                all_required_gates_passed = False
                break
    return all_nodes_passed, all_required_gates_passed


def _collect_eval_records(sid: str, artifacts: SprintArtifacts) -> list[EvidenceRecord]:
    records: list[EvidenceRecord] = []
    for path in artifacts.eval_paths():
        raw = _read_text(path)
        evaluator = _evaluator_from_eval_path(sid, path)
        result = "present"
        notes = ""

        if path.suffix == ".json":
            data = _read_json(path)
            if isinstance(data, dict):
                verdict = data.get("verdict") or data.get("result") or data.get("status")
                if verdict:
                    result = str(verdict)
                evaluator = str(data.get("evaluator") or data.get("actor") or evaluator)
                note = data.get("notes")
                if note:
                    notes = str(note)

        if not notes and raw:
            note_text = " ".join(raw.splitlines())[:120].strip()
            if note_text:
                notes = note_text

        records.append(
            EvidenceRecord(
                evaluator=evaluator or "unknown",
                result=result or "present",
                notes=notes,
                source=str(path),
            )
        )
    return records


def _compute_traceability(graph: dict[str, Any], state: dict[str, Any] | None, eval_records: list[EvidenceRecord], artifacts: SprintArtifacts) -> tuple[float, list[str]]:
    required = set(_build_required_artifacts(artifacts.sid))
    coverage_items: list[str] = []
    missing_items: list[str] = []

    for item in sorted(required):
        if (artifacts.sprints_dir / item).exists():
            coverage_items.append(item)
        else:
            missing_items.append(item)

    if artifacts.task_graph.exists():
        graph = _read_json(artifacts.task_graph) or {}
        nodes = graph.get("nodes") or []
        if isinstance(nodes, list) and nodes:
            node_results = (state or {}).get("node_results") if isinstance(state, dict) else {}
            if not isinstance(node_results, dict):
                node_results = {}
            terminal = True
            for n in nodes:
                if not isinstance(n, dict):
                    continue
                nid = str(n.get("id", ""))
                nr = node_results.get(nid) or {}
                status = str(nr.get("status") or n.get("status") or "").strip().lower()
                if not _node_terminal(status):
                    terminal = False
                    break
            if terminal:
                coverage_items.append("nodes_terminal")
            else:
                missing_items.append("nodes_terminal")

        required_gates = graph.get("required_gates") or []
        if isinstance(required_gates, list) and required_gates:
            gate_ok = True
            source_gates = (state or {}).get("gate_results") if state else {}
            if not isinstance(source_gates, dict):
                source_gates = {}
            fallback_gates = graph.get("gate_results") or {}
            if not isinstance(fallback_gates, dict):
                fallback_gates = {}
            for gate in required_gates:
                if not _gate_terminal(source_gates.get(gate)) and not _gate_terminal(fallback_gates.get(gate)):
                    gate_ok = False
                    missing_items.append(f"required_gate:{gate}")
            if gate_ok:
                coverage_items.append("required_gates_passed")

    if eval_records:
        coverage_items.append("eval_evidence")
    else:
        missing_items.append("eval_evidence")

    total = len(set(coverage_items + missing_items)) or 1
    coverage = 100.0 * len(set(coverage_items)) / total
    return coverage, sorted(set(missing_items))


def _build_residual_risks(artifacts: SprintArtifacts, graph: dict[str, Any], state: dict[str, Any] | None, eval_records: list[EvidenceRecord], missing: list[str]) -> list[str]:
    risks: list[str] = []
    if not graph:
        risks.append("task_graph not found or unreadable")
    if not artifacts.status_json.exists():
        risks.append("status.json missing")
    if not artifacts.handoff_md.exists():
        risks.append("handoff.md missing")
    if not eval_records:
        risks.append("missing eval evidence")
    for record in eval_records:
        if _eval_record_blocks_closure(record):
            risks.append(f"eval did not pass: {record.evaluator}={record.result}")

    if missing:
        for item in missing:
            risks.append(f"missing evidence: {item}")

    nodes = graph.get("nodes") or [] if isinstance(graph, dict) else []
    node_results_risk = (state or {}).get("node_results") if isinstance(state, dict) else {}
    if not isinstance(node_results_risk, dict):
        node_results_risk = {}
    for n in nodes:
        if not isinstance(n, dict):
            continue
        nid = str(n.get("id", ""))
        nr = node_results_risk.get(nid) or {}
        status = str(nr.get("status") or n.get("status") or "").strip().lower()
        if not _node_terminal(status):
            risks.append(f"non-terminal node: {nid}")
            break

    gates = graph.get("required_gates") or [] if isinstance(graph, dict) else []
    if isinstance(gates, list) and gates:
        gate_results = (state or {}).get("gate_results") if state else {}
        if not isinstance(gate_results, dict):
            gate_results = {}
        fallback = graph.get("gate_results") or {}
        for gate in gates:
            if not _gate_terminal(gate_results.get(gate)) and not _gate_terminal(fallback.get(gate)):
                risks.append(f"required gate not passed: {gate}")

    return risks


def compute_closure_payload(
    sid: str,
    *,
    harness_dir: Path | None = None,
    sprints_dir: Path | None = None,
) -> dict[str, Any]:
    if not sid:
        raise ValueError("sid is required")

    harness_root = harness_dir or Path(os.environ.get("HARNESS_DIR", Path.home() / ".solar" / "harness"))
    sprints_root = sprints_dir or Path(os.environ.get("SPRINTS_DIR", harness_root / "sprints"))
    artifacts = SprintArtifacts(harness_dir=harness_root, sprints_dir=sprints_root, sid=sid)

    graph = _read_json(artifacts.task_graph) or {}
    state = _read_json(artifacts.task_dag_state) if artifacts.task_dag_state.exists() else {}
    eval_records = _collect_eval_records(sid, artifacts)

    coverage, missing = _compute_traceability(graph, state, eval_records, artifacts)
    risks = _build_residual_risks(artifacts, graph, state, eval_records, missing)

    if risks and not eval_records:
        legacy_status = "fail"
    elif risks:
        legacy_status = "needs_attention"
    elif coverage >= 100.0:
        legacy_status = "pass"
    else:
        legacy_status = "needs_attention"
    status = _schema_status_from_legacy(legacy_status)

    artifact_digest = _sha1_like([str(p) for p in artifacts.all_candidates()])
    all_nodes_passed, all_required_gates_passed = _graph_completion(graph, state)
    eval_payloads = [r.to_dict() for r in eval_records]

    evidence_policy = {
        "required_artifacts": _build_required_artifacts(sid)
        + ["eval evidence (*.eval.md/*.eval.json or *-eval.md/*-eval.json)"],
        "missing_artifacts": [m for m in sorted(set(missing)) if "eval_evidence" != m],
    }
    if not eval_records:
        evidence_policy["missing_artifacts"].append(
            "eval evidence (*.eval.md/*.eval.json or *-eval.md/*-eval.json)"
        )

    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "closure_id": f"{sid}:{artifact_digest[:16]}",
        "sprint_id": sid,
        "status": status,
        "legacy_status": legacy_status,
        "generated_at": _now(),
        "traceability_coverage": float(f"{coverage:.2f}"),
        "acceptance_traceability_coverage": float(f"{coverage / 100.0:.4f}"),
        "requirement_ir_ref": str(artifacts.sprints_dir / f"{sid}.requirement_ir.json"),
        "contracts_manifest_ref": str(artifacts.contract_md),
        "graph_ref": str(artifacts.task_graph),
        "all_nodes_passed": all_nodes_passed,
        "all_required_gates_passed": all_required_gates_passed,
        "tests": [],
        "evals": eval_payloads,
        "changed_files": [],
        "evaluations": eval_payloads,
        "evidence_policy": evidence_policy,
        "residual_risks": risks,
    }
    return payload


def validate_closure(payload: dict[str, Any], schema_path: Path | None = None) -> None:
    schema_file = schema_path or (Path(__file__).resolve().parent.parent / "schemas" / "closure.schema.json")
    schema = _read_json(schema_file)
    if schema is None:
        raise RuntimeError(f"closure schema not found: {schema_file}")

    if _jsonschema_validators is None:
        raise RuntimeError("jsonschema dependency not available")

    validator_cls = _jsonschema_validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)
    errs = list(validator.iter_errors(payload))
    if errs:
        best = _jsonschema_errors.best_match(errs) if _jsonschema_errors else errs[0]
        raise ValidationError(f"closure schema validation failed: {best.message} (path: {list(best.absolute_path)})")


def _write_closure(artifacts: SprintArtifacts, payload: dict[str, Any]) -> tuple[Path, Path]:
    artifacts.closure_json.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    lines = ["# Closure Report", ""]
    lines.append(f"- sprint_id: {payload['sprint_id']}")
    lines.append(f"- closure_id: {payload['closure_id']}")
    lines.append(f"- status: {payload['status']}")
    lines.append(f"- generated_at: {payload['generated_at']}")
    lines.append(f"- traceability_coverage: {payload['traceability_coverage']:.2f}")
    lines.append("")
    lines.append("## Evidence policy")
    lines.append("- required_artifacts:")
    for item in payload["evidence_policy"].get("required_artifacts", []):
        lines.append(f"  - {item}")
    lines.append("- missing_artifacts:")
    for item in payload["evidence_policy"].get("missing_artifacts", []):
        lines.append(f"  - {item}")
    lines.append("")
    lines.append("## eval evidence")
    if payload["evaluations"]:
        for item in payload["evaluations"]:
            lines.append(f"- {item.get('evaluator')} :: {item.get('result')} :: {item.get('source', '')}")
    else:
        lines.append("- N/A")
    lines.append("")
    lines.append("## residual risks")
    if payload["residual_risks"]:
        for item in payload["residual_risks"]:
            lines.append(f"- {item}")
    else:
        lines.append("- N/A")
    lines.append("")

    artifacts.closure_md.write_text("\n".join(lines), encoding="utf-8")
    return artifacts.closure_json, artifacts.closure_md


def verify_closeout_readiness(
    sid: str,
    *,
    harness_dir: Path | None = None,
    sprints_dir: Path | None = None,
) -> dict[str, Any]:
    """Reconstruct closure from sprint artifacts and verify closeout readiness.

    Returns dict with:
      - ready: bool — all checks passed
      - checks: dict of individual check results
      - payload: the closure payload that would be written
      - blocking_issues: list of strings describing what blocks closeout
    """
    harness_root = harness_dir or Path(os.environ.get("HARNESS_DIR", Path.home() / ".solar" / "harness"))
    sprints_root = sprints_dir or Path(os.environ.get("SPRINTS_DIR", harness_root / "sprints"))
    artifacts = SprintArtifacts(harness_dir=harness_root, sprints_dir=sprints_root, sid=sid)

    payload = compute_closure_payload(sid, harness_dir=harness_root, sprints_dir=sprints_root)

    checks: dict[str, Any] = {}
    blocking_issues: list[str] = []

    # 1. All nodes terminal — check state node_results, then fall back to inline graph status
    graph = _read_json(artifacts.task_graph) or {}
    state = _read_json(artifacts.task_dag_state) if artifacts.task_dag_state.exists() else {}
    node_results = (state or {}).get("node_results") if isinstance(state, dict) else {}
    if not isinstance(node_results, dict):
        node_results = {}
    nodes = graph.get("nodes") or [] if isinstance(graph, dict) else []
    non_terminal_nodes = []
    for n in nodes:
        if not isinstance(n, dict):
            continue
        nid = str(n.get("id", "?"))
        # Prefer state node_results, then inline node status
        nr = node_results.get(nid) or {}
        status = str(nr.get("status") or n.get("status") or "").strip().lower()
        if not _node_terminal(status):
            non_terminal_nodes.append(nid)
    checks["all_nodes_terminal"] = {
        "ok": not non_terminal_nodes,
        "non_terminal": non_terminal_nodes,
    }
    if non_terminal_nodes:
        blocking_issues.append(f"non-terminal nodes: {', '.join(non_terminal_nodes)}")

    # 2. Required gates passed
    required_gates = graph.get("required_gates") or [] if isinstance(graph, dict) else []
    source_gates = (state or {}).get("gate_results") if state else {}
    if not isinstance(source_gates, dict):
        source_gates = {}
    fallback_gates = graph.get("gate_results") or {} if isinstance(graph, dict) else {}
    if not isinstance(fallback_gates, dict):
        fallback_gates = {}
    missing_gates = []
    for gate in required_gates:
        if not _gate_terminal(source_gates.get(gate)) and not _gate_terminal(fallback_gates.get(gate)):
            missing_gates.append(str(gate))
    checks["required_gates_passed"] = {
        "ok": not missing_gates,
        "missing": missing_gates,
    }
    if missing_gates:
        blocking_issues.append(f"missing required gates: {', '.join(missing_gates)}")

    # 3. Eval evidence present
    eval_records = _collect_eval_records(sid, artifacts)
    checks["eval_evidence"] = {
        "ok": bool(eval_records),
        "count": len(eval_records),
    }
    if not eval_records:
        blocking_issues.append("no eval evidence found")

    # 4. Traceability coverage
    coverage, missing = _compute_traceability(graph, state, eval_records, artifacts)
    checks["traceability"] = {
        "ok": coverage >= 100.0,
        "coverage": coverage,
        "missing": missing,
    }
    if coverage < 100.0:
        blocking_issues.append(f"traceability coverage {coverage:.1f}% < 100%")

    # 5. Residual risks
    risks = _build_residual_risks(artifacts, graph, state, eval_records, missing)
    checks["residual_risks"] = {
        "ok": not risks,
        "risks": risks,
    }
    if risks:
        blocking_issues.append(f"residual risks: {'; '.join(risks[:3])}")

    ready = not blocking_issues

    return {
        "ready": ready,
        "checks": checks,
        "payload": payload,
        "blocking_issues": blocking_issues,
    }


def build_and_save(
    sid: str,
    *,
    harness_dir: Path | None = None,
    sprints_dir: Path | None = None,
) -> tuple[Path, Path, dict[str, Any]]:
    harness_root = harness_dir or Path(os.environ.get("HARNESS_DIR", Path.home() / ".solar" / "harness"))
    sprints_root = sprints_dir or Path(os.environ.get("SPRINTS_DIR", harness_root / "sprints"))
    artifacts = SprintArtifacts(harness_dir=harness_root, sprints_dir=sprints_root, sid=sid)
    payload = compute_closure_payload(sid, harness_dir=harness_root, sprints_dir=sprints_root)
    return _write_closure(artifacts, payload) + (payload,)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="solar-harness closure")
    parser.add_argument("subcommand", nargs="?", default="verify")
    parser.add_argument("--sid", required=True)
    parser.add_argument("--harness-dir", default=str(Path(os.environ.get("HARNESS_DIR", Path.home() / ".solar" / "harness"))))
    parser.add_argument(
        "--sprints-dir",
        default=str(Path(os.environ.get("SPRINTS_DIR", Path.home() / ".solar" / "harness" / "sprints"))),
    )
    parser.add_argument(
        "--schema",
        default=str(Path(__file__).resolve().parent.parent / "schemas" / "closure.schema.json"),
    )
    return parser.parse_args(argv)


def run_verify(sid: str, harness_dir: Path, sprints_dir: Path, schema_path: Path) -> tuple[int, Path, Path, dict[str, Any]]:
    payload = compute_closure_payload(sid, harness_dir=harness_dir, sprints_dir=sprints_dir)
    validate_closure(payload, schema_path)
    closure_json, closure_md = _write_closure(
        SprintArtifacts(harness_dir=harness_dir, sprints_dir=sprints_dir, sid=sid),
        payload,
    )
    return_code = 0
    if payload["status"] != "passed" or payload["traceability_coverage"] < 100.0:
        return_code = 2
    return return_code, closure_json, closure_md, payload


def run_closeout(sid: str, harness_dir: Path, sprints_dir: Path) -> int:
    result = verify_closeout_readiness(sid, harness_dir=harness_dir, sprints_dir=sprints_dir)
    ready = result["ready"]
    payload = result["payload"]
    blocking = result["blocking_issues"]

    if ready:
        artifacts = SprintArtifacts(harness_dir=harness_dir, sprints_dir=sprints_dir, sid=sid)
        _write_closure(artifacts, payload)
        print(f"closeout: READY — closure.json written", flush=True)
        return 0
    else:
        print(f"closeout: BLOCKED", flush=True)
        for issue in blocking:
            print(f"  - {issue}", flush=True)
        return 2


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    subcommand = str(args.subcommand or "verify").strip().lower()

    sid = str(args.sid).strip()
    if not sid:
        print("--sid is required", flush=True)
        return 2

    harness_dir = Path(args.harness_dir).expanduser()
    sprints_dir = Path(args.sprints_dir).expanduser()

    if subcommand == "closeout":
        return run_closeout(sid, harness_dir, sprints_dir)

    if subcommand != "verify":
        print(f"unknown subcommand: {subcommand}", flush=True)
        return 2

    schema = Path(args.schema).expanduser()

    try:
        code, closure_json, closure_md, payload = run_verify(sid, harness_dir, sprints_dir, schema)
    except Exception as exc:  # noqa: BLE001
        print(f"closure verify failed: {exc}", flush=True)
        return 2

    print(f"closure_json: {closure_json}")
    print(f"closure_md: {closure_md}")
    print(f"traceability_coverage: {payload['traceability_coverage']:.2f}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
