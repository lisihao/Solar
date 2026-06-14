#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "graph_node_dispatcher.py"
spec = importlib.util.spec_from_file_location("graph_node_dispatcher", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
sys.modules["graph_node_dispatcher"] = mod
spec.loader.exec_module(mod)


def test_dispatch_package_role_falls_back_to_builder_main() -> None:
    result = mod._dispatch_package_from_payload(
        payload={},
        sid="sprint-test",
        node_id="N1",
        node={},
        dispatch_id="did",
        selected_role="",
    )
    assert result["role"] == "builder_main"


def test_dispatch_package_role_prefers_payload_role() -> None:
    result = mod._dispatch_package_from_payload(
        payload={"role": "planner", "dispatch_package": {"role": "evaluator"}},
        sid="sprint-test",
        node_id="N1",
        node={},
        dispatch_id="did",
        selected_role="builder_main",
    )
    assert result["role"] == "evaluator"
