from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any

from .rule_atom import RuleAtom
from .rule_loader import write_json


LEVEL_RE = re.compile(r"(🔴\s*)?(MUST|SHOULD|MAY)\b|必须|不得|禁止", re.IGNORECASE)
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
STANDARD_FILE_RE = re.compile(r"^([0-9]{2})-(.+)\.md$")

DEFAULT_GATES = {
    "MUST": ["after_ai_patch", "pre_push", "ci"],
    "SHOULD": ["ci"],
    "MAY": ["ci"],
}

DOC_CHECKER_DEFAULTS = {
    "00-overview.md": ("standards_manifest", "standards_manifest_index"),
    "02-directory-structure.md": ("filesystem_topology", "directory_structure"),
    "03-naming-conventions.md": ("naming", "naming_conventions"),
    "04-code-style.md": ("command_runner", "code_style_commands"),
    "05-api-design.md": ("docs_coverage", "api_design_surface"),
    "06-database-design.md": ("security_scan", "database_safety_patterns"),
    "07-testing-standards.md": ("test_coverage", "test_presence_mapping"),
    "08-git-workflow.md": ("command_runner", "git_workflow_contract"),
    "09-documentation.md": ("docs_coverage", "documentation_coverage"),
    "10-documentation-organization.md": ("docs_coverage", "documentation_organization"),
    "10-security.md": ("security_scan", "security_patterns"),
    "11-logging-standards.md": ("security_scan", "logging_patterns"),
    "12-scripts-management.md": ("filesystem_topology", "script_placement"),
    "13-module-dependencies.md": ("import_graph", "module_dependency_boundaries"),
    "14-skills-development.md": ("registry_drift", "skill_schema_contract"),
    "15-report-template.md": ("docs_coverage", "report_schema_contract"),
    "16-ai-engine-harness-structure.md": ("import_graph", "solar_control_plane_boundaries"),
    "17-extension-governance.md": ("registry_drift", "extension_governance"),
    "18-base-layer-file-governance.md": ("filesystem_topology", "base_layer_file_governance"),
    "19-plugin-system-governance.md": ("registry_drift", "plugin_manifest_governance"),
    "20-admin-ui-design.md": ("not_applicable", "solar_admin_ui_not_present"),
    "21-agent-teams-presentation.md": ("not_applicable", "genesis_agent_team_presentation_not_ported"),
    "22-frontend-ui-component-governance.md": ("not_applicable", "solar_frontend_ui_not_in_scope"),
    "23-business-team-framework-usage.md": ("not_applicable", "genesis_business_team_framework_not_ported"),
    "24-open-api-structure.md": ("not_applicable", "solar_open_api_not_in_scope"),
    "27-extension-cookbook.md": ("docs_coverage", "extension_cookbook_reference"),
    "99-quick-reference.md": ("standards_manifest", "quick_reference_index"),
}


def normalize_level(line: str) -> str:
    upper = line.upper()
    if "SHOULD" in upper:
        return "SHOULD"
    if "MAY" in upper:
        return "MAY"
    return "MUST"


def slugify(text: str) -> str:
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"[^A-Za-z0-9\u4e00-\u9fff]+", "-", text).strip("-").lower()
    return text[:80] or "rule"


def rule_id_for(path: Path, anchor: str, line_no: int) -> str:
    match = STANDARD_FILE_RE.match(path.name)
    prefix = match.group(1) if match else "std"
    stem = match.group(2) if match else path.stem
    digest = hashlib.sha1(f"{path.name}:{line_no}:{anchor}".encode("utf-8")).hexdigest()[:8]
    return f"genesis.std.{prefix}.{slugify(stem)}.{slugify(anchor)}.{digest}"


def checker_for(path: Path, level: str) -> tuple[dict[str, str], str]:
    checker_type, checker_name = DOC_CHECKER_DEFAULTS.get(path.name, ("markdown_rules", "manual_mapping_required"))
    if checker_type == "not_applicable":
        return {"type": "not_applicable", "name": checker_name}, "not_applicable"
    return {"type": checker_type, "name": checker_name}, "covered"


def extract_rule_atoms(source_dir: Path, repo_root: Path) -> list[RuleAtom]:
    atoms: list[RuleAtom] = []
    for path in sorted(source_dir.glob("*.md")):
        if not STANDARD_FILE_RE.match(path.name):
            continue
        rel_source = str(path.relative_to(repo_root))
        current_heading = path.stem
        lines = path.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines, start=1):
            heading = HEADING_RE.match(line)
            if heading:
                current_heading = heading.group(2).strip()
            if not LEVEL_RE.search(line):
                continue
            if line.lstrip().startswith("|"):
                anchor = current_heading
                text = line.strip()
            elif line.lstrip().startswith(("-", "*")) or heading:
                anchor = current_heading
                text = line.strip("# -*\t")
            elif "MUST" in line.upper() or "SHOULD" in line.upper() or "MAY" in line.upper():
                anchor = current_heading
                text = line.strip()
            else:
                continue
            if not text:
                continue
            level = normalize_level(text)
            checker, solar_status = checker_for(path, level)
            atoms.append(
                RuleAtom(
                    id=rule_id_for(path, anchor, index),
                    source=rel_source,
                    source_anchor=anchor,
                    level=level,
                    rule_text=text[:800],
                    line_start=index,
                    line_end=index,
                    scope={"include": ["**/*"], "exclude": ["harness/plugins/genesis-verifier/vendor/GenesisPod/node_modules/**"]},
                    checker=checker,
                    gate=DEFAULT_GATES[level],
                    autofix={"available": False},
                    solar_status=solar_status,
                )
            )
    return atoms


def source_manifest(source_dir: Path, repo_root: Path) -> dict[str, Any]:
    files = []
    for path in sorted(source_dir.glob("*.md")):
        if not STANDARD_FILE_RE.match(path.name):
            continue
        data = path.read_bytes()
        files.append(
            {
                "path": str(path.relative_to(repo_root)),
                "sha256": hashlib.sha256(data).hexdigest(),
                "bytes": len(data),
            }
        )
    return {
        "schema_version": "solar.standards.source_manifest.v1",
        "source": "GenesisPod .claude/standards",
        "file_count": len(files),
        "files": files,
    }


def compile_standards(source_dir: Path, out_path: Path, repo_root: Path) -> dict[str, Any]:
    atoms = [atom.to_dict() for atom in extract_rule_atoms(source_dir, repo_root)]
    payload = {
        "schema_version": "solar.standards.rules.generated.v1",
        "source_dir": str(source_dir.relative_to(repo_root)),
        "rule_count": len(atoms),
        "rules": atoms,
    }
    write_json(out_path, payload)
    return payload
