"""PlanIRAdapter — bridge task_graph.json nodes ↔ PlanIR round-trip."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..plan_ir import PlanIR, OperatorStep
from ..provenance import Provenance


class PlanIRAdapter:
    """Bidirectional adapter between task_graph.json node dicts and PlanIR.

    Each DAG node in the ``nodes`` array of a task_graph is mapped to one
    PlanIR.  The adapter preserves goal, dependencies, write_scope,
    read_scope, and plan artifacts.
    """

    @staticmethod
    def from_task_graph_node(
        node: Dict[str, Any],
        *,
        sprint_id: str = "",
    ) -> PlanIR:
        """Convert a single task_graph node dict into PlanIR."""
        node_id = str(node.get("id", ""))
        deps = node.get("depends_on", []) or []
        write_scope = node.get("write_scope", []) or []
        read_scope = node.get("read_scope", []) or []

        steps: List[OperatorStep] = []
        if write_scope:
            steps.append(
                OperatorStep(
                    step_id=f"{node_id}:write_scope",
                    operator="write_scope",
                    operator_kind="logical",
                    bindings={"paths": list(write_scope)},
                )
            )
        if read_scope:
            steps.append(
                OperatorStep(
                    step_id=f"{node_id}:read_scope",
                    operator="read_scope",
                    operator_kind="logical",
                    bindings={"paths": list(read_scope)},
                )
            )

        artifacts = node.get("artifacts", {})
        plan_artifacts: Dict[str, str] = {}
        if isinstance(artifacts, dict):
            for k, v in artifacts.items():
                plan_artifacts[k] = str(v)

        logical_op = node.get("logical_plan_node", {})
        logical_operator = None
        selected_physical = None
        if isinstance(logical_op, dict):
            logical_operator = logical_op.get("logical_operator")
        capsule_plan = node.get("capsule_plan_ir", {})
        if isinstance(capsule_plan, dict):
            selected_physical = capsule_plan.get("selected") or None

        prov_data = {
            "owner": "plan_ir_adapter",
            "source_ref": f"task_graph:{sprint_id}:{node_id}",
        }
        prov = Provenance.from_dict(prov_data)

        return PlanIR(
            ir_id=f"plan:{sprint_id}:{node_id}",
            spec_ref=None,
            logical_operator=logical_operator,
            selected_physical_operator=selected_physical,
            steps=tuple(steps),
            plan_artifacts=plan_artifacts,
            metadata={
                "goal": str(node.get("goal", "")),
                "gate": str(node.get("gate", "")),
                "required_skills": list(node.get("required_skills", [])),
                "estimated_cost": str(node.get("estimated_cost", "")),
                "priority": node.get("priority", 0),
                "acceptance_ids": list(node.get("acceptance_ids", [])),
            },
            provenance=prov,
        )

    @staticmethod
    def to_task_graph_node(ir: PlanIR) -> Dict[str, Any]:
        """Convert PlanIR back to a task_graph.json-compatible node dict."""
        parts = ir.ir_id.split(":", 2)
        node_id = parts[-1] if len(parts) >= 3 else ir.ir_id
        meta = ir.metadata or {}

        write_paths = []
        read_paths = []
        for step in ir.steps:
            if step.operator == "write_scope":
                write_paths = list(step.bindings.get("paths", []))
            elif step.operator == "read_scope":
                read_paths = list(step.bindings.get("paths", []))

        node: Dict[str, Any] = {
            "id": node_id,
            "goal": meta.get("goal", ""),
            "depends_on": [],
            "write_scope": write_paths,
            "read_scope": read_paths,
        }
        if ir.logical_operator is not None:
            node["logical_plan_node"] = {
                "node_id": node_id,
                "logical_operator": ir.logical_operator,
            }
        if ir.selected_physical_operator:
            node.setdefault("capsule_plan_ir", {})["selected"] = ir.selected_physical_operator
        if ir.plan_artifacts:
            node["artifacts"] = dict(ir.plan_artifacts)
        gate = meta.get("gate")
        if gate:
            node["gate"] = gate
        skills = meta.get("required_skills", [])
        if skills:
            node["required_skills"] = skills
        cost = meta.get("estimated_cost")
        if cost:
            node["estimated_cost"] = cost
        priority = meta.get("priority")
        if priority is not None:
            node["priority"] = priority
        acceptance_ids = meta.get("acceptance_ids", [])
        if acceptance_ids:
            node["acceptance_ids"] = acceptance_ids
        return node

    @staticmethod
    def from_task_graph(graph: Dict[str, Any]) -> List[PlanIR]:
        """Convert all nodes in a task_graph.json into PlanIR list."""
        sprint_id = graph.get("sprint_id", "")
        return [
            PlanIRAdapter.from_task_graph_node(n, sprint_id=sprint_id)
            for n in graph.get("nodes", [])
            if isinstance(n, dict)
        ]

    @staticmethod
    def round_trip_node(node: Dict[str, Any], *, sprint_id: str = "") -> Dict[str, Any]:
        """Node → PlanIR → node round-trip."""
        ir = PlanIRAdapter.from_task_graph_node(node, sprint_id=sprint_id)
        return PlanIRAdapter.to_task_graph_node(ir)
