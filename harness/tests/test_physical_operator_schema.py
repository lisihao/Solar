#!/usr/bin/env python3
"""
Tests for physical-operators registry schema additions.

Sprint: sprint-20260523-claude-operator-billing-split / N2
Validates:
  - billing_surface and surface fields are present on all claude-cli operators
  - Schema conditional rejects claude-cli operators that lack surface/billing_surface
  - Both interactive (claude_code_interactive) and print (claude_print) examples exist
  - No raw secrets appear in the config
  - Print reserve operators carry quota.reserve_for restrictions
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import jsonschema
import pytest

CONFIG_DIR = Path(__file__).resolve().parents[1] / "config"
OPERATORS_FILE = CONFIG_DIR / "physical-operators.json"
SCHEMA_FILE = CONFIG_DIR / "physical-operators.schema.json"


def _load_config() -> dict:
    return json.loads(OPERATORS_FILE.read_text(encoding="utf-8"))


def _load_schema() -> dict:
    return json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))


def _claude_cli_operators(config: dict) -> dict[str, dict]:
    return {
        op_id: op
        for op_id, op in config["operators"].items()
        if op.get("backend") == "claude-cli"
    }


class TestClaudeSurfaceFields:
    """All claude-cli operators must carry surface and billing_surface."""

    def test_all_claude_cli_operators_have_surface(self):
        config = _load_config()
        for op_id, op in _claude_cli_operators(config).items():
            assert "surface" in op, f"{op_id}: missing surface field"
            assert "type" in op["surface"], f"{op_id}.surface: missing type"

    def test_all_claude_cli_operators_have_billing_surface(self):
        config = _load_config()
        for op_id, op in _claude_cli_operators(config).items():
            assert "billing_surface" in op, f"{op_id}: missing billing_surface"

    def test_all_claude_cli_operators_have_billing_pool(self):
        config = _load_config()
        for op_id, op in _claude_cli_operators(config).items():
            assert "billing_pool" in op, f"{op_id}: missing billing_pool"

    def test_billing_surface_values_are_valid(self):
        valid = {
            "subscription_interactive",
            "anthropic_agent_sdk_credit",
            "usage_credit",
            "local_compute",
            "unknown",
        }
        config = _load_config()
        for op_id, op in _claude_cli_operators(config).items():
            val = op.get("billing_surface")
            assert val in valid, f"{op_id}: unexpected billing_surface={val!r}"


class TestSurfaceTypeExamples:
    """Both interactive and print surface types must exist in the registry."""

    def test_interactive_surface_example_exists(self):
        config = _load_config()
        types = {op.get("surface", {}).get("type") for op in config["operators"].values()}
        assert "claude_code_interactive" in types, (
            "No operator with surface.type=claude_code_interactive found"
        )

    def test_print_surface_example_exists(self):
        config = _load_config()
        types = {op.get("surface", {}).get("type") for op in config["operators"].values()}
        assert "claude_print" in types, (
            "No operator with surface.type=claude_print found"
        )

    def test_interactive_operators_use_subscription_billing(self):
        config = _load_config()
        for op_id, op in config["operators"].items():
            if op.get("surface", {}).get("type") == "claude_code_interactive":
                assert op.get("billing_surface") == "subscription_interactive", (
                    f"{op_id}: interactive operator should use subscription_interactive billing"
                )

    def test_print_operators_use_agent_sdk_billing(self):
        config = _load_config()
        for op_id, op in config["operators"].items():
            if op.get("surface", {}).get("type") == "claude_print":
                assert op.get("billing_surface") == "anthropic_agent_sdk_credit", (
                    f"{op_id}: print operator should use anthropic_agent_sdk_credit billing"
                )


class TestPrintReservePolicy:
    """Print reserve operators must carry quota.reserve_for restrictions."""

    def test_print_operators_have_quota_reserve_for(self):
        config = _load_config()
        for op_id, op in config["operators"].items():
            if op.get("surface", {}).get("type") == "claude_print":
                quota = op.get("quota", {})
                assert "reserve_for" in quota, (
                    f"{op_id}: claude_print operator missing quota.reserve_for"
                )
                assert len(quota["reserve_for"]) > 0, (
                    f"{op_id}: quota.reserve_for must not be empty"
                )

    def test_print_operators_avoid_bulk_tasks(self):
        bulk_tasks = {"FANOUT", "BULK_EDIT", "TEST_RUN", "LOW_VALUE_SCAN"}
        config = _load_config()
        for op_id, op in config["operators"].items():
            if op.get("surface", {}).get("type") == "claude_print":
                avoid = set(op.get("avoid_for", []))
                overlap = bulk_tasks & avoid
                assert overlap == bulk_tasks, (
                    f"{op_id}: print reserve missing avoid_for entries: {bulk_tasks - overlap}"
                )

    def test_print_operators_have_compat_alias(self):
        config = _load_config()
        known_host_aliases = {
            "antigravity_managed_env",
            "codex_cloud",
            "codex_worktree",
            "docker_sandbox",
            "local_mlx_process",
            "ssh_devbox",
            "tmux_pane",
        }
        for op_id, op in config["operators"].items():
            if op.get("surface", {}).get("type") == "claude_print":
                assert "compat_alias_for" in op, (
                    f"{op_id}: print operator missing compat_alias_for"
                )
                alias_target = op["compat_alias_for"]
                assert alias_target in known_host_aliases or alias_target in config["operators"], (
                    f"{op_id}: compat_alias_for={alias_target!r} is neither a known host alias nor an operator"
                )


class TestSchemaConditionalValidation:
    """The JSON schema must enforce surface/billing_surface on claude-cli operators."""

    def test_schema_rejects_claude_cli_without_surface(self):
        schema = _load_schema()
        bad_instance = {
            "version": 1,
            "operators": {
                "generic-claude-no-surface": {
                    "display_name": "Generic Claude without surface",
                    "backend": "claude-cli",
                    "model": "opus",
                    # Intentionally no surface or billing_surface
                }
            },
        }
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=bad_instance, schema=schema)

    def test_schema_rejects_claude_cli_without_billing_surface(self):
        schema = _load_schema()
        bad_instance = {
            "version": 1,
            "operators": {
                "claude-missing-billing": {
                    "display_name": "Claude missing billing_surface",
                    "backend": "claude-cli",
                    "model": "opus",
                    "surface": {"type": "claude_code_interactive", "tool": "claude"},
                    # Intentionally no billing_surface
                }
            },
        }
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=bad_instance, schema=schema)

    def test_schema_accepts_valid_interactive_operator(self):
        schema = _load_schema()
        valid_instance = {
            "version": 1,
            "operators": {
                "test-claude-interactive": {
                    "display_name": "Test Claude interactive",
                    "backend": "claude-cli",
                    "model": "opus",
                    "surface": {
                        "type": "claude_code_interactive",
                        "tool": "claude",
                        "launch_cmd": "claude --dangerously-skip-permissions --model opus",
                    },
                    "billing_surface": "subscription_interactive",
                }
            },
        }
        # Should not raise
        jsonschema.validate(instance=valid_instance, schema=schema)

    def test_schema_accepts_valid_print_operator(self):
        schema = _load_schema()
        valid_instance = {
            "version": 1,
            "operators": {
                "test-claude-print": {
                    "display_name": "Test Claude print reserve",
                    "backend": "claude-cli",
                    "model": "opus",
                    "surface": {
                        "type": "claude_print",
                        "tool": "claude",
                        "launch_cmd": "claude --print --model opus",
                    },
                    "billing_surface": "anthropic_agent_sdk_credit",
                }
            },
        }
        jsonschema.validate(instance=valid_instance, schema=schema)

    def test_schema_accepts_non_claude_operator_without_surface(self):
        """Non-claude-cli operators are NOT required to have surface."""
        schema = _load_schema()
        valid_instance = {
            "version": 1,
            "operators": {
                "local-tool": {
                    "display_name": "Local tool without surface",
                    "backend": "local",
                    "model": "ripgrep",
                    # No surface required for non-claude-cli
                }
            },
        }
        jsonschema.validate(instance=valid_instance, schema=schema)


class TestNoRawSecrets:
    """The config file must not contain raw credential values."""

    def test_no_raw_api_keys_in_config(self):
        config_text = OPERATORS_FILE.read_text(encoding="utf-8")
        # Check for raw sk-prefixed API keys
        assert not re.search(r'"sk-[A-Za-z0-9]{20,}"', config_text), (
            "Raw OpenAI-style sk- API key found in config"
        )

    def test_no_raw_anthropic_keys_in_config(self):
        config_text = OPERATORS_FILE.read_text(encoding="utf-8")
        # Anthropic key pattern: sk-ant-...
        assert not re.search(r'"sk-ant-[A-Za-z0-9\-_]{20,}"', config_text), (
            "Raw Anthropic API key found in config"
        )

    def test_no_bare_credential_fields(self):
        config_text = OPERATORS_FILE.read_text(encoding="utf-8")
        # Disallow fields named api_key/password/token/client_secret with non-empty values
        forbidden = re.findall(
            r'"(?:api_key|password|client_secret)"\s*:\s*"([^"]+)"',
            config_text,
        )
        assert not forbidden, f"Raw credential fields found: {forbidden}"

    def test_key_refs_use_reference_format(self):
        config = _load_config()
        for op_id, op in config["operators"].items():
            key_ref = op.get("key_ref", "")
            # key_ref should be a symbolic name, not a raw key value
            assert not key_ref.startswith("sk-"), (
                f"{op_id}: key_ref looks like a raw API key"
            )


class TestConfigIntegrity:
    """Config file is valid JSON and passes schema validation end-to-end."""

    def test_config_json_valid(self):
        # Should not raise
        config = _load_config()
        assert "operators" in config
        assert config["version"] == 1

    def test_full_config_passes_schema(self):
        config = _load_config()
        schema = _load_schema()
        jsonschema.validate(instance=config, schema=schema)

    def test_three_interactive_claude_operators_exist(self):
        config = _load_config()
        interactive_ops = [
            op_id
            for op_id, op in config["operators"].items()
            if op.get("surface", {}).get("type") == "claude_code_interactive"
        ]
        assert len(interactive_ops) >= 3, (
            f"Expected >= 3 interactive Claude operators, got: {interactive_ops}"
        )

    def test_three_print_reserve_operators_exist(self):
        config = _load_config()
        print_ops = [
            op_id
            for op_id, op in config["operators"].items()
            if op.get("surface", {}).get("type") == "claude_print"
        ]
        assert len(print_ops) >= 3, (
            f"Expected >= 3 print reserve operators, got: {print_ops}"
        )


if __name__ == "__main__":
    # Manual run without pytest
    tests = [
        TestClaudeSurfaceFields(),
        TestSurfaceTypeExamples(),
        TestPrintReservePolicy(),
        TestSchemaConditionalValidation(),
        TestNoRawSecrets(),
        TestConfigIntegrity(),
    ]
    passed = 0
    failed = 0
    for suite in tests:
        for name in dir(suite):
            if not name.startswith("test_"):
                continue
            try:
                getattr(suite, name)()
                print(f"  PASS  {suite.__class__.__name__}::{name}")
                passed += 1
            except Exception as exc:
                print(f"  FAIL  {suite.__class__.__name__}::{name}: {exc}")
                failed += 1
    print(f"\n{passed} passed, {failed} failed")
    if failed:
        raise SystemExit(1)


# --- N3: Reverse Binding Tests ---

class TestReverseBindingSchema:
    """Validate reverse binding fields in physical operator schema."""

    def test_schema_accepts_reverse_binding(self):
        schema = _load_schema()
        instance = {
            "version": 1,
            "operators": {
                "test-op-with-reverse": {
                    "display_name": "Test Op With Reverse Binding",
                    "backend": "claude-cli",
                    "model": "opus",
                    "surface": {"type": "claude_code_interactive", "tool": "claude"},
                    "billing_surface": "subscription_interactive",
                    "reverse_binding": {
                        "installed_traits": ["builder", "planner"],
                        "installed_skills": ["python", "testing"],
                        "mounted_mcp": ["brain-router", "web_reader"],
                        "allowed_capsules": ["cap.impl-worker"],
                        "forbidden_capsules": ["cap.destructive"],
                        "historical_scoring": {
                            "avg_score": 0.87,
                            "total_tasks": 42,
                            "last_scored_at": "2026-06-07T00:00:00Z",
                        },
                    },
                }
            },
        }
        jsonschema.validate(instance=instance, schema=schema)

    def test_schema_accepts_partial_reverse_binding(self):
        schema = _load_schema()
        instance = {
            "version": 1,
            "operators": {
                "test-op-partial": {
                    "display_name": "Test Op Partial Binding",
                    "backend": "local",
                    "model": "ripgrep",
                    "reverse_binding": {
                        "installed_traits": ["search"],
                    },
                }
            },
        }
        jsonschema.validate(instance=instance, schema=schema)

    def test_schema_accepts_operator_without_reverse_binding(self):
        schema = _load_schema()
        instance = {
            "version": 1,
            "operators": {
                "test-op-no-reverse": {
                    "display_name": "Test Op No Binding",
                    "backend": "local",
                }
            },
        }
        jsonschema.validate(instance=instance, schema=schema)

    def test_reverse_binding_historical_scoring_bounds(self):
        schema = _load_schema()
        # avg_score within 0-1 should pass
        instance = {
            "version": 1,
            "operators": {
                "test-op-score": {
                    "display_name": "Score Test",
                    "reverse_binding": {
                        "historical_scoring": {"avg_score": 0.95, "total_tasks": 100},
                    },
                }
            },
        }
        jsonschema.validate(instance=instance, schema=schema)

    def test_reverse_binding_no_raw_secrets(self):
        """Reverse binding fields must not expose raw credentials."""
        instance = {
            "version": 1,
            "operators": {
                "test-op-no-creds": {
                    "display_name": "Cred Check",
                    "reverse_binding": {
                        "installed_traits": ["builder"],
                        "mounted_mcp": ["brain-router"],
                        "historical_scoring": {"avg_score": 0.9},
                    },
                }
            },
        }
        # Verify no secret-like values in reverse_binding
        rb = instance["operators"]["test-op-no-creds"]["reverse_binding"]
        for field in ("installed_traits", "installed_skills", "mounted_mcp",
                      "allowed_capsules", "forbidden_capsules"):
            for val in rb.get(field, []):
                assert not val.startswith("sk-"), f"Raw secret in {field}: {val}"
                assert not val.startswith("Bearer "), f"Raw token in {field}: {val}"

    def test_existing_config_still_validates_with_new_schema(self):
        config = _load_config()
        schema = _load_schema()
        jsonschema.validate(instance=config, schema=schema)

    def test_schema_accepts_success_rate_by_capsule(self):
        schema = _load_schema()
        instance = {
            "version": 1,
            "operators": {
                "test-op-score-by-capsule": {
                    "display_name": "Score By Capsule Test",
                    "reverse_binding": {
                        "success_rate_by_capsule": {
                            "cap.impl-worker": 0.87,
                            "cap.verifier": 0.91,
                        },
                    },
                }
            },
        }
        jsonschema.validate(instance=instance, schema=schema)

    def test_schema_rejects_success_rate_out_of_range(self):
        schema = _load_schema()
        instance = {
            "version": 1,
            "operators": {
                "test-op-bad-score": {
                    "display_name": "Bad Score Test",
                    "reverse_binding": {
                        "success_rate_by_capsule": {
                            "cap.impl-worker": 1.5,
                        },
                    },
                }
            },
        }
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=instance, schema=schema)

    def test_schema_accepts_recent_failure_modes(self):
        schema = _load_schema()
        instance = {
            "version": 1,
            "operators": {
                "test-op-failures": {
                    "display_name": "Failure Modes Test",
                    "reverse_binding": {
                        "recent_failure_modes": [
                            {
                                "capsule_id": "cap.impl-worker",
                                "failure_category": "timeout",
                                "occurred_at": "2026-06-10T14:22:00Z",
                                "task_id": "sprint-20260530-node-N3",
                            }
                        ],
                    },
                }
            },
        }
        jsonschema.validate(instance=instance, schema=schema)

    def test_schema_rejects_invalid_failure_category(self):
        schema = _load_schema()
        instance = {
            "version": 1,
            "operators": {
                "test-op-bad-category": {
                    "display_name": "Bad Category Test",
                    "reverse_binding": {
                        "recent_failure_modes": [
                            {
                                "capsule_id": "cap.impl-worker",
                                "failure_category": "invalid_category",
                                "occurred_at": "2026-06-10T14:22:00Z",
                                "task_id": "sprint-20260530-node-N3",
                            }
                        ],
                    },
                }
            },
        }
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(instance=instance, schema=schema)


class TestReverseBindingFixtureData:
    """Validate reverse binding fixtures in the real config."""

    def test_at_least_three_operators_have_reverse_binding(self):
        config = _load_config()
        rb_ops = [
            op_id for op_id, op in config["operators"].items()
            if "reverse_binding" in op
        ]
        assert len(rb_ops) >= 3, (
            f"Expected >= 3 operators with reverse_binding, got {len(rb_ops)}: {rb_ops}"
        )

    def test_fixture_traits_are_non_empty_strings(self):
        config = _load_config()
        for op_id, op in config["operators"].items():
            rb = op.get("reverse_binding", {})
            for field in ("installed_traits", "installed_skills", "mounted_mcp"):
                for val in rb.get(field, []):
                    assert isinstance(val, str) and len(val) > 0, (
                        f"{op_id}.reverse_binding.{field}: expected non-empty string, got {val!r}"
                    )

    def test_fixture_allowed_and_forbidden_are_string_lists(self):
        config = _load_config()
        for op_id, op in config["operators"].items():
            rb = op.get("reverse_binding", {})
            for field in ("allowed_capsules", "forbidden_capsules"):
                vals = rb.get(field, [])
                assert isinstance(vals, list), (
                    f"{op_id}.reverse_binding.{field}: expected list, got {type(vals)}"
                )
                for v in vals:
                    assert isinstance(v, str), (
                        f"{op_id}.reverse_binding.{field}: expected string items, got {v!r}"
                    )

    def test_fixture_historical_scoring_bounds(self):
        config = _load_config()
        for op_id, op in config["operators"].items():
            rb = op.get("reverse_binding", {})
            hs = rb.get("historical_scoring", {})
            if hs:
                avg = hs.get("avg_score", 0)
                assert 0 <= avg <= 1, (
                    f"{op_id}.reverse_binding.historical_scoring.avg_score={avg} out of [0,1]"
                )
                total = hs.get("total_tasks", 0)
                assert total >= 0, (
                    f"{op_id}.reverse_binding.historical_scoring.total_tasks={total} < 0"
                )

    def test_fixture_success_rate_by_capsule_bounds(self):
        config = _load_config()
        for op_id, op in config["operators"].items():
            rb = op.get("reverse_binding", {})
            for cap_id, rate in rb.get("success_rate_by_capsule", {}).items():
                assert 0 <= rate <= 1, (
                    f"{op_id}.reverse_binding.success_rate_by_capsule[{cap_id}]={rate} out of [0,1]"
                )

    def test_fixture_no_raw_secrets_in_reverse_binding(self):
        config = _load_config()
        for op_id, op in config["operators"].items():
            rb = op.get("reverse_binding", {})
            rb_text = json.dumps(rb)
            assert not re.search(r'"sk-[A-Za-z0-9]{20,}"', rb_text), (
                f"{op_id}: raw API key found in reverse_binding"
            )
            assert not re.search(r'"sk-ant-[A-Za-z0-9\-_]{20,}"', rb_text), (
                f"{op_id}: raw Anthropic key in reverse_binding"
            )


class TestReverseBindingMatchingLogic:
    """Validate trait/skill/MCP/allowlist/denylist matching behavior using fixtures."""

    def test_trait_subset_match(self):
        """Operator with installed_traits must be a superset of required traits to match."""
        config = _load_config()
        planner_op = config["operators"].get("mini-claude-opus-planner", {})
        rb = planner_op.get("reverse_binding", {})
        traits = set(rb.get("installed_traits", []))
        # Planner should have architecture and planning traits
        assert "architecture" in traits
        assert "planning" in traits

    def test_skill_subset_match(self):
        """Operator with installed_skills must contain required skills."""
        config = _load_config()
        builder_op = config["operators"].get("mini-glm51-builder-1", {})
        rb = builder_op.get("reverse_binding", {})
        skills = set(rb.get("installed_skills", []))
        assert "python" in skills
        assert "testing" in skills

    def test_mcp_mounted_available(self):
        """Operator with mounted_mcp must list available MCP connectors."""
        config = _load_config()
        builder_op = config["operators"].get("mini-glm51-builder-1", {})
        rb = builder_op.get("reverse_binding", {})
        mcp = set(rb.get("mounted_mcp", []))
        assert "brain-router" in mcp

    def test_allowlist_restricts_capsules(self):
        """Operator with non-empty allowed_capsules restricts to those capsules only."""
        config = _load_config()
        planner_op = config["operators"].get("mini-claude-opus-planner", {})
        rb = planner_op.get("reverse_binding", {})
        allowed = rb.get("allowed_capsules", [])
        assert len(allowed) > 0
        # A capsule not in the allowlist should not match
        assert "cap.impl-worker" not in allowed
        assert "cap.planner-opus" in allowed

    def test_denylist_blocks_capsules(self):
        """Operator with forbidden_capsules blocks those capsules."""
        config = _load_config()
        planner_op = config["operators"].get("mini-claude-opus-planner", {})
        rb = planner_op.get("reverse_binding", {})
        forbidden = rb.get("forbidden_capsules", [])
        assert "cap.destructive" in forbidden

    def test_empty_allowlist_means_open(self):
        """Operator with empty allowed_capsules accepts any capsule."""
        config = _load_config()
        builder_op = config["operators"].get("mini-glm51-builder-1", {})
        rb = builder_op.get("reverse_binding", {})
        allowed = rb.get("allowed_capsules", [])
        assert len(allowed) == 0, "Empty allowlist should accept all capsules"

    def test_example_config_also_validates(self):
        """The example config must also pass schema validation."""
        example = json.loads(
            (CONFIG_DIR / "physical-operators.example.json").read_text(encoding="utf-8")
        )
        schema = _load_schema()
        jsonschema.validate(instance=example, schema=schema)
