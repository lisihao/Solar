import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
TOOL = REPO_ROOT / "harness" / "tools" / "standards_guard.py"
HARNESS_DIR = REPO_ROOT / "harness"
if str(HARNESS_DIR) not in sys.path:
    sys.path.insert(0, str(HARNESS_DIR))

from verifier.standards import compiler
from verifier.standards import coverage_gate
from verifier.standards import result as standards_result
from verifier.standards.checkers import registry


def test_compiler_extracts_rule_atom_from_real_standard_subset(tmp_path):
    source = tmp_path / "standards"
    source.mkdir()
    doc = source / "03-naming-conventions.md"
    doc.write_text(
        "\n".join(
            [
                "# Naming",
                "",
                "### TypeScript 文件 🔴 MUST",
                "- 🔴 MUST: 文件名必须使用 kebab-case",
                "### 可选项 🟢 MAY",
                "- 🟢 MAY: 可以添加说明",
            ]
        ),
        encoding="utf-8",
    )

    atoms = compiler.extract_rule_atoms(source, tmp_path)

    assert len(atoms) == 4
    assert atoms[0].level == "MUST"
    assert atoms[0].source == "standards/03-naming-conventions.md"
    assert atoms[0].checker["type"] == "naming"


def test_coverage_gate_blocks_uncovered_must():
    rules = [
        {
            "id": "std.must.uncovered",
            "level": "MUST",
            "solar_status": "needs_manual_mapping",
            "checker": {"type": "coverage", "name": "needs_manual_mapping"},
        }
    ]

    result = coverage_gate.coverage_for_rules(rules)

    assert result["status"] == "blocked"
    assert result["summary"]["uncovered_must"] == 1


def test_coverage_gate_accepts_not_applicable_must():
    rules = [
        {
            "id": "std.must.na",
            "level": "MUST",
            "solar_status": "not_applicable",
            "checker": {"type": "not_applicable", "name": "ui_not_in_scope"},
        }
    ]

    result = coverage_gate.coverage_for_rules(rules)

    assert result["status"] == "passed"
    assert result["summary"]["uncovered_must"] == 0


def test_standards_guard_integration_compile_and_run():
    compile_proc = subprocess.run(
        [sys.executable, str(TOOL), "compile", "--json"],
        cwd=str(REPO_ROOT),
        check=False,
        capture_output=True,
        text=True,
    )
    assert compile_proc.returncode == 0
    compile_data = json.loads(compile_proc.stdout)
    assert compile_data["source_file_count"] == 27
    assert compile_data["rule_count"] > 0

    coverage_proc = subprocess.run(
        [sys.executable, str(TOOL), "coverage", "--json"],
        cwd=str(REPO_ROOT),
        check=False,
        capture_output=True,
        text=True,
    )
    assert coverage_proc.returncode == 0
    data = json.loads(coverage_proc.stdout)
    assert data["schema_version"] == "solar.standards.coverage.v1"
    assert set(data["summary"]) >= {"total_rules", "covered", "uncovered_must"}
    assert data["summary"]["uncovered_must"] == 0


def test_security_scanner_ignores_known_fake_redaction_secret(tmp_path):
    harness = tmp_path / "harness"
    harness.mkdir()
    (harness / "runtime_chaos_suite.py").write_text(
        'secret = "api_key=sk-abcdef12345678901234567890123456789012345678"\n',
        encoding="utf-8",
    )
    rule = {"id": "security", "level": "MUST", "checker": {"type": "security_scan", "name": "security_patterns"}}

    result = registry.secret_scan(rule, tmp_path)

    assert result["status"] == "passed"


def test_logging_scanner_ignores_static_secret_warning_text(tmp_path):
    harness = tmp_path / "harness"
    harness.mkdir()
    (harness / "artifact_store.py").write_text(
        'logger.warning("Candidate text contained secret-like content; redacted.")\n',
        encoding="utf-8",
    )
    rule = {"id": "logging", "level": "MUST", "checker": {"type": "security_scan", "name": "logging_patterns"}}

    result = registry.logging_safety_scan(rule, tmp_path)

    assert result["status"] == "passed"


def test_database_scanner_flags_single_line_sql_interpolation(tmp_path):
    harness = tmp_path / "harness"
    harness.mkdir()
    (harness / "db.py").write_text('cursor.execute(f"SELECT * FROM users WHERE id={user_id}")\n', encoding="utf-8")
    rule = {"id": "db", "level": "MUST", "checker": {"type": "security_scan", "name": "database_safety_patterns"}}

    result = registry.database_safety_scan(rule, tmp_path)

    assert result["status"] == "failed"


def test_database_scanner_ignores_non_sql_insert_variable(tmp_path):
    harness = tmp_path / "harness"
    harness.mkdir()
    (harness / "maintenance.py").write_text('insert = f"maintenance_reason: {reason}"\n', encoding="utf-8")
    rule = {"id": "db", "level": "MUST", "checker": {"type": "security_scan", "name": "database_safety_patterns"}}

    result = registry.database_safety_scan(rule, tmp_path)

    assert result["status"] == "passed"


def test_database_scanner_ignores_html_select_markup(tmp_path):
    harness = tmp_path / "harness"
    harness.mkdir()
    (harness / "status_server.py").write_text('html = f"<select>{value}</select>"\n', encoding="utf-8")
    rule = {"id": "db", "level": "MUST", "checker": {"type": "security_scan", "name": "database_safety_patterns"}}

    result = registry.database_safety_scan(rule, tmp_path)

    assert result["status"] == "passed"


def test_database_scanner_skips_tests_directory(tmp_path):
    harness = tmp_path / "harness"
    tests = harness / "tests"
    tests.mkdir(parents=True)
    (tests / "test_fixture.py").write_text('cursor.execute(f"SELECT * FROM users WHERE id={user_id}")\n', encoding="utf-8")
    rule = {"id": "db", "level": "MUST", "checker": {"type": "security_scan", "name": "database_safety_patterns"}}

    result = registry.database_safety_scan(rule, tmp_path)

    assert result["status"] == "passed"


def test_result_groups_duplicate_failures_by_actual_finding():
    rule_results = [
        {
            "rule_id": "r1",
            "source": "a.md",
            "severity": "warn",
            "status": "failed",
            "path": "harness/tools/db.py",
            "message": "Potential unsafe SQL interpolation pattern found.",
            "checker": {"type": "security_scan", "name": "database_safety_patterns"},
        },
        {
            "rule_id": "r2",
            "source": "a.md",
            "severity": "warn",
            "status": "failed",
            "path": "harness/tools/db.py",
            "message": "Potential unsafe SQL interpolation pattern found.",
            "checker": {"type": "security_scan", "name": "database_safety_patterns"},
        },
    ]

    payload = standards_result.build_result(
        standards_pack="test",
        trigger="ci",
        changed_files=[],
        rule_results=rule_results,
        coverage={"summary": {"uncovered_must": 0}},
        artifacts={},
    )

    assert payload["summary"]["failed"] == 2
    assert payload["summary"]["failure_groups"] == 1
    assert payload["failure_groups"][0]["rule_count"] == 2
