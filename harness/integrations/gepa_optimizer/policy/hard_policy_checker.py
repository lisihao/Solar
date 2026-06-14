"""Hard Policy Registry & Candidate Validator.

Implements design §4: Hard Policy Registry + CandidateValidator with
fail-closed semantics.  No gepa imports — stdlib + PyYAML only.

Acceptance criteria (B2 node):
  - registry.yaml 含 design §4.1 全部 8 类别且每类 ≥ 1 条
  - fail_closed_default=true; review_log.reviewer=pending_human_review
  - HardPolicyRegistry.load() 缓存且 yaml schema 校验
  - CandidateValidator.validate() 实施 design §4.2 全部 4 步短路检查
  - PolicyCheckResult dataclass 含 ok/violations/requires_human_approval
  - registry 缺失/损坏 → fail-closed 返回 ok=False
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

__all__ = [
    "Violation",
    "PolicyCheckResult",
    "HardPolicyRegistry",
    "HardPolicyRegistryError",
    "HardPolicyRegistryMissing",
    "HardPolicyRegistryCorrupt",
    "CandidateValidator",
    "ALLOWED_OPERATORS",
    "CATEGORY_NAMES",
]

REGISTRY_SCHEMA_VERSION = "solar.gepa.hard_policy_registry.v1"
DEFAULT_REGISTRY_PATH = Path(__file__).parent / "hard_policy_registry.yaml"

ALLOWED_OPERATORS = frozenset({
    "mutate_text",
    "mutate_code",
    "mutate_params",
    "crossover",
    "random_init",
    "gepa.optimize_anything",
})

CATEGORY_NAMES = frozenset({
    "secret_access",
    "mcp_forbidden_tools",
    "destructive_shell_denylist",
    "git_push_merge_policy",
    "payment_external_action",
    "human_approval_required",
    "data_sensitivity",
    "high_risk_cross_provider_verifier",
})


# ── Exceptions ──────────────────────────────────────────────


class HardPolicyRegistryError(Exception):
    """Base for hard-policy registry errors."""


class HardPolicyRegistryMissing(HardPolicyRegistryError):
    """Registry file not found."""


class HardPolicyRegistryCorrupt(HardPolicyRegistryError):
    """Registry file failed schema validation."""


# ── Data classes ────────────────────────────────────────────


@dataclass(frozen=True)
class Violation:
    policy_id: str
    category: str
    field_path: str
    matched_value: str
    severity: str


@dataclass(frozen=True)
class PolicyCheckResult:
    ok: bool
    violations: list[Violation] = field(default_factory=list)
    requires_human_approval: bool = False


# ── Registry ────────────────────────────────────────────────


class HardPolicyRegistry:
    """Loads, validates and caches the hard-policy YAML registry."""

    _cache: dict[str, "HardPolicyRegistry"] = {}

    def __init__(
        self,
        categories: dict[str, list[dict[str, Any]]],
        fail_closed_default: bool,
        review_log: list[dict[str, Any]],
        source_path: str | None = None,
    ) -> None:
        self.categories = categories
        self.fail_closed_default = fail_closed_default
        self.review_log = review_log
        self.source_path = source_path

    # ── Load with caching ───────────────────────────────────

    @classmethod
    def load(cls, path: Path | str | None = None) -> "HardPolicyRegistry":
        """Load registry from *path*, caching by resolved path string."""
        resolved = str((Path(path) if path else DEFAULT_REGISTRY_PATH).resolve())

        if resolved in cls._cache:
            return cls._cache[resolved]

        registry = cls._load_from_disk(Path(resolved))
        cls._cache[resolved] = registry
        return registry

    @classmethod
    def _load_from_disk(cls, path: Path) -> "HardPolicyRegistry":
        if not path.exists():
            if True:  # fail-closed
                return cls._fail_closed_registry(str(path))
            raise HardPolicyRegistryMissing(f"Registry not found: {path}")

        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        except yaml.YAMLError as exc:
            return cls._fail_closed_registry(str(path), reason=str(exc))

        errors = cls._validate_schema(raw)
        if errors:
            return cls._fail_closed_registry(str(path), reason="; ".join(errors))

        return cls(
            categories=raw["categories"],
            fail_closed_default=bool(raw.get("fail_closed_default", True)),
            review_log=raw.get("review_log", []),
            source_path=str(path),
        )

    @classmethod
    def _fail_closed_registry(
        cls, source_path: str, reason: str = "registry missing or corrupt"
    ) -> "HardPolicyRegistry":
        return cls(
            categories={},
            fail_closed_default=True,
            review_log=[{"reviewer": "fail_closed", "notes": reason}],
            source_path=source_path,
        )

    # ── YAML schema validation ──────────────────────────────

    @staticmethod
    def _validate_schema(raw: Any) -> list[str]:
        errors: list[str] = []
        if not isinstance(raw, dict):
            return ["Top-level must be a mapping"]
        if raw.get("schema_version") != REGISTRY_SCHEMA_VERSION:
            errors.append(
                f"schema_version must be {REGISTRY_SCHEMA_VERSION!r}, "
                f"got {raw.get('schema_version')!r}"
            )
        cats = raw.get("categories")
        if not isinstance(cats, dict) or not cats:
            errors.append("categories must be a non-empty mapping")
        else:
            for cat_name, rules in cats.items():
                if not isinstance(rules, list) or not rules:
                    errors.append(f"categories.{cat_name} must be a non-empty list")
                    continue
                for i, rule in enumerate(rules):
                    if not isinstance(rule, dict):
                        errors.append(f"categories.{cat_name}[{i}] must be a mapping")
                        continue
                    for required_key in ("id", "description", "severity"):
                        if required_key not in rule:
                            errors.append(
                                f"categories.{cat_name}[{i}] missing '{required_key}'"
                            )
        if "fail_closed_default" not in raw:
            errors.append("fail_closed_default is required")
        return errors

    # ── Category checker dispatch ───────────────────────────

    def check_category(
        self, category: str, content: str, extra_context: dict[str, Any] | None = None
    ) -> list[Violation]:
        rules = self.categories.get(category, [])
        if not rules:
            return []
        extra_context = extra_context or {}
        violations: list[Violation] = []
        for rule in rules:
            violation = self._check_rule(category, rule, content, extra_context)
            if violation is not None:
                violations.append(violation)
        return violations

    def _check_rule(
        self,
        category: str,
        rule: dict[str, Any],
        content: str,
        extra_context: dict[str, Any],
    ) -> Violation | None:
        rule_id = rule["id"]
        severity = rule["severity"]

        # Pattern-based rules
        if "pattern" in rule:
            if re.search(rule["pattern"], content):
                return Violation(
                    policy_id=rule_id,
                    category=category,
                    field_path="content",
                    matched_value=content[:200],
                    severity=severity,
                )

        if "patterns" in rule:
            for pat in rule["patterns"]:
                if re.search(pat, content):
                    return Violation(
                        policy_id=rule_id,
                        category=category,
                        field_path="content",
                        matched_value=content[:200],
                        severity=severity,
                    )

        # MCP forbidden tools
        if "forbidden_list" in rule:
            for tool in rule["forbidden_list"]:
                if tool in content:
                    return Violation(
                        policy_id=rule_id,
                        category=category,
                        field_path="content",
                        matched_value=tool,
                        severity=severity,
                    )

        # Human approval required — check keys
        if "applies_to_keys" in rule:
            mutable_sections = extra_context.get("mutable_sections", {})
            for key in rule["applies_to_keys"]:
                if key in mutable_sections:
                    return Violation(
                        policy_id=rule_id,
                        category=category,
                        field_path=f"mutable.sections.{key}",
                        matched_value=key,
                        severity=severity,
                    )

        # Data sensitivity — check forbidden descopes
        if "forbidden_descopes" in rule:
            mutable_sections = extra_context.get("mutable_sections", {})
            for descope in rule["forbidden_descopes"]:
                if descope in str(mutable_sections):
                    return Violation(
                        policy_id=rule_id,
                        category=category,
                        field_path="mutable.sections",
                        matched_value=descope,
                        severity=severity,
                    )

        # High risk cross-provider verifier — check required keys
        if "required_keys" in rule:
            mutable_sections = extra_context.get("mutable_sections", {})
            for req_key in rule["required_keys"]:
                if mutable_sections.get(req_key) is False:
                    return Violation(
                        policy_id=rule_id,
                        category=category,
                        field_path=f"mutable.sections.{req_key}",
                        matched_value=str(mutable_sections.get(req_key)),
                        severity=severity,
                    )

        return None

    def get_all_categories(self) -> list[str]:
        return list(self.categories.keys())

    def requires_human_approval(self) -> bool:
        for entry in self.review_log:
            if entry.get("reviewer") == "pending_human_review":
                return True
        return False

    @classmethod
    def clear_cache(cls) -> None:
        cls._cache.clear()


# ── Candidate Validator ─────────────────────────────────────


class CandidateValidator:
    """Validates a candidate envelope against hard policies.

    Implements design §4.2 short-circuit 4-step check:
      1. immutable.sha256 consistency
      2. mutation_trace.operator in allowlist
      3. signed_by == 'gepa_optimizer'
      4. Per hard_policy_refs category checkers
    """

    def __init__(self, registry: HardPolicyRegistry | None = None) -> None:
        if registry is None:
            registry = HardPolicyRegistry.load()
        self.registry = registry

    def validate(
        self,
        envelope: Any,
        *,
        base_immutable_sections: dict | None = None,
    ) -> PolicyCheckResult:
        """Run 4-step short-circuit validation.

        Parameters
        ----------
        envelope : CandidateEnvelope or dict
            The candidate envelope to validate.  Accepts either the
            dataclass from candidate_schema or a plain dict.
        base_immutable_sections : dict, optional
            The immutable sections of the base object, used for step 1
            (sha256 consistency check).  If *None*, step 1 is skipped
            (e.g. when the base object is not available).

        Returns
        -------
        PolicyCheckResult
        """
        violations: list[Violation] = []
        requires_human = self.registry.requires_human_approval()

        # Fail-closed: empty categories → reject
        if not self.registry.categories and self.registry.fail_closed_default:
            return PolicyCheckResult(
                ok=False,
                violations=[
                    Violation(
                        policy_id="FAIL_CLOSED",
                        category="registry",
                        field_path="categories",
                        matched_value="empty or missing registry",
                        severity="hard_reject",
                    )
                ],
                requires_human_approval=True,
            )

        # Coerce dict-like to attribute access
        env = _EnvelopeView(envelope)

        # Step 1: immutable.sha256 consistency with base object
        if base_immutable_sections is not None:
            expected_sha = _compute_sha256(base_immutable_sections)
            actual_sha = env.get_nested("immutable", "sha256", default="")
            if actual_sha and actual_sha != expected_sha:
                violations.append(
                    Violation(
                        policy_id="HP-SHA-001",
                        category="sha256_integrity",
                        field_path="immutable.sha256",
                        matched_value=str(actual_sha),
                        severity="hard_reject",
                    )
                )

        # Step 2: mutation_trace.operator in allowlist
        operator = env.get_nested("mutation_trace", "operator", default="")
        if operator and operator not in ALLOWED_OPERATORS:
            violations.append(
                Violation(
                    policy_id="HP-OPR-001",
                    category="operator_allowlist",
                    field_path="mutation_trace.operator",
                    matched_value=str(operator),
                    severity="hard_reject",
                )
            )

        # Step 3: signed_by == 'gepa_optimizer'
        signed_by = env.get("signed_by", default="")
        if signed_by != "gepa_optimizer":
            violations.append(
                Violation(
                    policy_id="HP-SIG-001",
                    category="signature_check",
                    field_path="signed_by",
                    matched_value=str(signed_by),
                    severity="hard_reject",
                )
            )

        # Step 4: per hard_policy_refs category checkers
        hp_refs = env.get_nested("immutable", "hard_policy_refs", default=[])
        if isinstance(hp_refs, list):
            content = self._extract_checkable_content(env)
            mutable_sections = self._extract_mutable_sections(env)
            for ref in hp_refs:
                cat_violations = self.registry.check_category(
                    ref, content, {"mutable_sections": mutable_sections}
                )
                violations.extend(cat_violations)

        if violations:
            return PolicyCheckResult(
                ok=False,
                violations=violations,
                requires_human_approval=requires_human,
            )

        return PolicyCheckResult(
            ok=True,
            violations=[],
            requires_human_approval=requires_human,
        )

    @staticmethod
    def _extract_checkable_content(env: "_EnvelopeView") -> str:
        parts = []
        for key in ("sections",):
            imm = env.get_nested("immutable", key, default={})
            if isinstance(imm, dict):
                parts.append(json.dumps(imm, sort_keys=True))
            mut = env.get_nested("mutable", key, default={})
            if isinstance(mut, dict):
                parts.append(json.dumps(mut, sort_keys=True))
        return " ".join(parts)

    @staticmethod
    def _extract_mutable_sections(env: "_EnvelopeView") -> dict:
        return env.get_nested("mutable", "sections", default={})


# ── Helpers ─────────────────────────────────────────────────


class _EnvelopeView:
    """Thin wrapper that provides attr/dict-agnostic access to envelope data."""

    __slots__ = ("_data",)

    def __init__(self, data: Any) -> None:
        self._data = data

    def get(self, key: str, default: Any = None) -> Any:
        d = self._data
        if isinstance(d, dict):
            return d.get(key, default)
        return getattr(d, key, default)

    def get_nested(self, *keys: str, default: Any = None) -> Any:
        current = self._data
        for key in keys:
            if isinstance(current, dict):
                current = current.get(key)
            else:
                current = getattr(current, key, None)
            if current is None:
                return default
        return current


def _compute_sha256(sections: dict) -> str:
    canonical = json.dumps(sections, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
