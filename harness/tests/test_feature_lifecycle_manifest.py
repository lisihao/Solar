from __future__ import annotations

import json
from pathlib import Path


HARNESS_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = HARNESS_ROOT.parent
MANIFEST_PATH = HARNESS_ROOT / "config" / "feature-lifecycle.json"
MIGRATION_DOC = HARNESS_ROOT / "docs" / "migrations" / "insight-reporting-to-genesispod.md"


def _manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def test_insight_reporting_suite_is_retired_and_owned_by_genesispod() -> None:
    payload = _manifest()
    feature = payload["feature_families"]["insight_reporting_suite"]

    assert payload["schema_version"] == "solar.feature_lifecycle.v1"
    assert feature["display_status"] == "已经迁移到 GenesisPod、本仓库废除"
    assert feature["status"] == "retired"
    assert feature["migration_status"] == "migrated_to_genesispod"
    assert feature["solar_repository_status"] == "retired"
    assert feature["successor"]["product"] == "GenesisPod"
    assert feature["policy"]["new_product_development_in_solar"] == "forbidden"


def test_genesispod_successor_evidence_paths_exist() -> None:
    feature = _manifest()["feature_families"]["insight_reporting_suite"]
    missing = [
        path
        for path in feature["successor"]["evidence_paths"]
        if not (HARNESS_ROOT / path).is_file()
    ]

    assert missing == []


def test_legacy_entrypoints_are_documented_without_deleting_history() -> None:
    feature = _manifest()["feature_families"]["insight_reporting_suite"]
    missing = [
        path
        for path in feature["legacy_entrypoints"]
        if not (HARNESS_ROOT / path).is_file()
    ]

    assert missing == []
    assert feature["policy"]["historical_code"] == "preserve_for_audit_and_migration_compatibility"
    assert feature["policy"]["scheduler_state"] == "unchanged_by_this_lifecycle_marker"


def test_solar_retains_only_the_data_and_migration_boundary() -> None:
    feature = _manifest()["feature_families"]["insight_reporting_suite"]
    retained = set(feature["retained_solar_capabilities"])
    retired = set(feature["retired_product_capabilities"])

    assert {
        "source_collection",
        "basic_materialization",
        "provenance_and_freshness",
        "one_way_sync_to_genesispod",
        "migration_compatibility_bridges",
    } <= retained
    assert {
        "big_name_and_event_insights",
        "deepdive_insight_authoring",
        "chapter_and_full_report_writing",
        "report_quality_evaluation",
    } <= retired
    assert retained.isdisjoint(retired)


def test_repository_surfaces_link_to_the_authoritative_migration_decision() -> None:
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    migration_doc = MIGRATION_DOC.read_text(encoding="utf-8")
    radar_doc = (HARNESS_ROOT / "docs" / "tech-hotspot-radar.md").read_text(encoding="utf-8")
    deepdive_doc = (
        HARNESS_ROOT
        / "docs"
        / "requirements"
        / "deepdive-insight-runtime-v2-cais-agent-insight.md"
    ).read_text(encoding="utf-8")

    assert "已经迁移到 GenesisPod、本仓库废除" in readme
    assert "Solar 本仓库正式废除" in migration_doc
    assert "migrations/insight-reporting-to-genesispod.md" in radar_doc
    assert "生命周期覆盖声明" in deepdive_doc
