"""Tests for the canonical Antigravity placement policy."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from antigravity_placement_policy import evaluate_antigravity_placement
from failure_fingerprint import apply_antigravity_denial
from logical_operator_registry import (
    ANTIGRAVITY_SUITABILITY_BY_CLASS,
    PLACEMENT_POLICY_BY_CLASS,
    REQUIRED_PROVIDER_FAMILIES,
    VALID_PLACEMENT_CLASSES,
    load_logical_operator_registry,
    logical_operator_placement,
    validate_logical_operator_placements,
)
from logical_operator_router import LogicalOperatorRouter

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "logical-operators.json"


TARGET_PLACEMENT_CLASS_BY_OPERATOR = {
    "DeepArchitect": "FINAL_AUTHORITY",
    "Critic": "FINAL_AUTHORITY",
    "ImplementationWorker": "NEUTRAL",
    "Verifier": "FINAL_AUTHORITY",
    "SecurityGate": "FINAL_AUTHORITY",
    "ParallelExplorer": "FAN_OUT_ELIGIBLE",
    "ResearchScout": "FAN_OUT_ELIGIBLE",
    "PatchWorker": "NEUTRAL",
    "ArtifactCurator": "FAN_OUT_ELIGIBLE",
    "ContextCompressor": "NEUTRAL",
    "RootCauseDebugger": "NEUTRAL",
    "TestDesigner": "NEUTRAL",
    "TestRunner": "NEUTRAL",
    "BenchmarkRunner": "NEUTRAL",
    "ResearchSynthesizer": "FAN_OUT_ELIGIBLE",
    "QuotaBroker": "NEUTRAL",
    "VerifierLite": "NEUTRAL",
    "DeepResearchBrowser": "FAN_OUT_ELIGIBLE",
    "DeepResearchGemini": "FAN_OUT_ELIGIBLE",
    "DeepResearchChatGPT": "FAN_OUT_ELIGIBLE",
    "GPTRequirementWriter": "FAN_OUT_ELIGIBLE",
    "ChatGPTProjectKnowledgeExtractor": "FAN_OUT_ELIGIBLE",
    "WebwrightPlaywright": "FAN_OUT_ELIGIBLE",
    "BrowserUseMcp": "FAN_OUT_ELIGIBLE",
    "YoutubeTranscriptExtractor": "FAN_OUT_ELIGIBLE",
    "TechnologyDiagramPainter": "FAN_OUT_ELIGIBLE",
}


def _decision(logical_operator, placement_class, provider_priority=99, actor_id="mini-antigravity-gemini31-pro"):
    return evaluate_antigravity_placement(
        actor_id=actor_id,
        logical_operator=logical_operator,
        provider_family=None,
        placement_class=placement_class,
        provider_priority=provider_priority,
    ).to_dict()


def test_gate_contract_contains_actor_aware_fields():
    d = _decision("DeepArchitect", "FINAL_AUTHORITY")
    assert d["actor_id"] == "mini-antigravity-gemini31-pro"
    assert d["logical_operator"] == "DeepArchitect"
    assert d["provider_family"] == "antigravity"
    assert d["placement_class"] == "FINAL_AUTHORITY"
    assert d["provider_priority"] == 99
    assert d["decision_event"] == "placement-denied"


def test_final_authority_operators_deny_antigravity():
    for logical_operator in ("DeepArchitect", "Critic", "Verifier", "SecurityGate"):
        d = _decision(logical_operator, "FINAL_AUTHORITY")
        assert d["allowed"] is False
        assert d["reason"] == "antigravity_forbidden_in_final_authority"


def test_neutral_antigravity_requires_low_priority_fallback():
    denied = _decision("ImplementationWorker", "NEUTRAL", provider_priority=1)
    allowed = _decision("ImplementationWorker", "NEUTRAL", provider_priority=3)
    assert denied["allowed"] is False
    assert denied["reason"] == "antigravity_priority_too_high_for_neutral"
    assert allowed["allowed"] is True
    assert allowed["decision_event"] == "placement-allowed"


def test_fan_out_allows_antigravity():
    d = _decision("ResearchScout", "FAN_OUT_ELIGIBLE", provider_priority=1)
    assert d["allowed"] is True
    assert d["reason"] is None


def test_registry_all_logical_operators_have_placement_metadata():
    payload = load_logical_operator_registry(CONFIG_PATH)
    operators = payload["logical_operators"]
    assert validate_logical_operator_placements(CONFIG_PATH) == []
    assert operators
    for operator_type, op_def in operators.items():
        placement_class = op_def["placement_class"]
        assert placement_class in VALID_PLACEMENT_CLASSES, operator_type
        assert op_def["placement_policy"] == PLACEMENT_POLICY_BY_CLASS[placement_class]
        suitability = op_def["provider_suitability"]
        assert set(suitability) == REQUIRED_PROVIDER_FAMILIES
        assert suitability["antigravity"] == ANTIGRAVITY_SUITABILITY_BY_CLASS[placement_class]


def test_registry_antigravity_suitability_by_operator_class():
    expected = {
        "DeepArchitect": ("FINAL_AUTHORITY", "forbidden"),
        "Critic": ("FINAL_AUTHORITY", "forbidden"),
        "Verifier": ("FINAL_AUTHORITY", "forbidden"),
        "SecurityGate": ("FINAL_AUTHORITY", "forbidden"),
        "ResearchScout": ("FAN_OUT_ELIGIBLE", "preferred"),
        "ParallelExplorer": ("FAN_OUT_ELIGIBLE", "preferred"),
        "ImplementationWorker": ("NEUTRAL", "fallback_only"),
        "PatchWorker": ("NEUTRAL", "fallback_only"),
        "VerifierLite": ("NEUTRAL", "fallback_only"),
    }
    for operator_type, (placement_class, antigravity) in expected.items():
        placement = logical_operator_placement(operator_type, CONFIG_PATH)
        assert placement["placement_class"] == placement_class
        assert placement["provider_suitability"]["antigravity"] == antigravity


def test_all_logical_operators_follow_target_placement_plan():
    payload = load_logical_operator_registry(CONFIG_PATH)
    operators = payload["logical_operators"]
    placement = {k: v["placement_class"] for k, v in operators.items()}

    assert placement == TARGET_PLACEMENT_CLASS_BY_OPERATOR

    for operator_type, expected_class in TARGET_PLACEMENT_CLASS_BY_OPERATOR.items():
        op_def = operators[operator_type]
        assert op_def["placement_class"] == expected_class
        assert op_def["placement_policy"] == PLACEMENT_POLICY_BY_CLASS[expected_class]
        assert op_def["provider_suitability"]["antigravity"] == ANTIGRAVITY_SUITABILITY_BY_CLASS[expected_class]


def test_scope_and_binding_counts_are_stable_for_n1():
    payload = load_logical_operator_registry(CONFIG_PATH)
    logical_operators = payload["logical_operators"]
    bindings = payload["bindings"]
    assert len(logical_operators) == len(bindings) == 26

    missing_binding = sorted(set(logical_operators) - set(bindings))
    assert not missing_binding, f"missing bindings for operators: {missing_binding}"
    extra_binding = sorted(set(bindings) - set(logical_operators))
    assert not extra_binding, f"orphan bindings without logical operators: {extra_binding}"


def test_bindings_keep_existing_selection_and_fallback_contract():
    payload = load_logical_operator_registry(CONFIG_PATH)
    operators = set(payload["logical_operators"])
    bindings = payload["bindings"]
    assert set(bindings) == operators
    for operator_type, binding in bindings.items():
        assert binding["operator_type"] == operator_type
        assert isinstance(binding["candidates"], list)
        assert binding["candidates"], operator_type
        assert "selection_policy" in binding, operator_type
        assert "fallback_policy" in binding, operator_type


def test_router_real_call_chain_loads_placement_metadata_without_binding_loss():
    router = LogicalOperatorRouter(bindings_path=CONFIG_PATH)
    for operator_type, expected_class in TARGET_PLACEMENT_CLASS_BY_OPERATOR.items():
        op_def = router.operator_definition(operator_type)
        assert op_def["placement_class"] == expected_class
        assert op_def["placement_policy"] == PLACEMENT_POLICY_BY_CLASS[expected_class]
        assert op_def["provider_suitability"]["antigravity"] == ANTIGRAVITY_SUITABILITY_BY_CLASS[expected_class]
        assert router.get_candidates(operator_type), operator_type


def test_invalid_gate_inputs_return_stable_reasons():
    assert _decision("", "FINAL_AUTHORITY")["reason"] == "missing_logical_operator"
    assert _decision("ResearchScout", "UNKNOWN")["reason"] == "invalid_placement_class"
    assert _decision("ResearchScout", "FAN_OUT_ELIGIBLE", provider_priority="bad")["reason"] == "invalid_provider_priority"
    assert _decision(
        "ResearchScout",
        "FAN_OUT_ELIGIBLE",
        actor_id="mini-claude-sonnet-builder",
        provider_priority=1,
    )["reason"] == "unknown_provider_family"


def test_legacy_final_architecture_denial():
    d = apply_antigravity_denial("task", "a1", is_final_architecture=True)
    assert "final_architecture" in d
    assert d["final_architecture"] is True


def test_legacy_final_verifier_denial():
    d = apply_antigravity_denial("task", "a1", is_final_verifier=True)
    assert "final_verifier" in d


def test_legacy_security_gate_denial():
    d = apply_antigravity_denial("task", "a1", is_security_gate=True)
    assert "security_gate" in d


def test_legacy_core_runtime_denial():
    d = apply_antigravity_denial("task", "a1", is_core_runtime=True)
    assert "core_runtime_approval" in d


def test_legacy_no_denial_for_normal():
    d = apply_antigravity_denial("task", "a1")
    assert len(d) == 0
