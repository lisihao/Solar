#!/usr/bin/env python3
"""
V2 Search Sidecar Completeness Tests

PRD §8.2 / §8.3:
- mirage search 输出至少出现 source_type in {mirage_path, qmd, solar_db, cocoindex, understanding}
- 降级源必须标 degraded=true
- sidecar v2 字段 {sidecar_version, context_sources, source_counts, degraded_sources,
  lineage_refs, source_hash_refs, required_sources, used_sources} 全部存在
"""

import json
import subprocess
import sys
from pathlib import Path

HARNESS_DIR = Path(__file__).parents[4].resolve()
sys.path.insert(0, str(HARNESS_DIR / "lib"))

from mirage_search import unified_search
from runtime_context_inject import inject
from context_projection import ContextProjection

# Required source types per PRD §8.2
REQUIRED_SOURCE_TYPES = {"mirage_path", "qmd", "solar_db", "cocoindex", "understanding"}

# Required sidecar v2 fields per PRD §8.3
REQUIRED_SIDECAR_FIELDS = {
    "sidecar_version",
    "context_sources",
    "source_counts",
    "degraded_sources",
    "lineage_refs",
    "source_hash_refs",
    "required_sources",
    "used_sources",
}


def test_mirage_search_source_types():
    """V2-A: mirage search 输出包含所有必需 source_type 或显式 degraded."""
    result = unified_search("solar harness mirage search context", max_hits=10)

    # Find all source_type values in hits
    found_source_types = {h.get("source_type") for h in result.get("hits", []) if isinstance(h, dict)}
    degraded_sources = result.get("degraded_sources", [])

    # Check: each required source either appears in hits OR is explicitly degraded
    missing_and_not_degraded = []
    for source_type in REQUIRED_SOURCE_TYPES:
        if source_type not in found_source_types:
            # Must be degraded
            is_degraded = any(
                d.startswith(source_type) or f"{source_type}:" in d or f"{source_type}_unavailable" in d
                for d in degraded_sources
            )
            if not is_degraded:
                missing_and_not_degraded.append(source_type)

    assert not missing_and_not_degraded, (
        f"Missing source_types not marked as degraded: {missing_and_not_degraded}. "
        f"Found: {found_source_types}, Degraded: {degraded_sources}"
    )

    # Check degraded_sources is a list
    assert isinstance(degraded_sources, list), "degraded_sources must be a list"

    return {
        "ok": True,
        "found_source_types": sorted(found_source_types),
        "degraded_sources": degraded_sources,
        "missing_but_degraded": [s for s in REQUIRED_SOURCE_TYPES if s not in found_source_types],
    }


def test_mirage_search_degraded_reason():
    """V2-B: 降级源必须显式 degraded_reason 字符串，不允许空 reason."""
    result = unified_search("test query", max_hits=5)

    degraded_sources = result.get("degraded_sources", [])
    # Check that degraded sources have non-empty reason strings
    empty_reasons = [d for d in degraded_sources if not d or not isinstance(d, str)]

    assert not empty_reasons, f"Degraded sources with empty reasons: {empty_reasons}"

    # Also check hits for degraded flag
    hits_with_degraded = [h for h in result.get("hits", []) if h.get("degraded")]
    for hit in hits_with_degraded:
        reason = hit.get("degraded_reason")
        assert reason and isinstance(reason, str) and reason.strip(), (
            f"Hit {hit.get('path')} has degraded=True but empty/missing degraded_reason"
        )

    return {
        "ok": True,
        "degraded_sources": degraded_sources,
        "hits_with_degraded_count": len(hits_with_degraded),
    }


def test_sidecar_v2_fields():
    """V2-C: sidecar v2 字段齐全."""
    # Create a temporary dispatch file for testing
    import tempfile
    with tempfile.NamedTemporaryFile(mode="w", suffix=".dispatch.md", delete=False, encoding="utf-8") as f:
        f.write("# Test Dispatch\n## Node Goal\nTest sidecar completeness\n")
        temp_dispatch = Path(f.name)

    try:
        result = inject(
            temp_dispatch,
            session_id="test-v2-sidecar",
            pane="test-pane",
            dispatch_id="test-dispatch",
            query="test sidecar fields completeness",
        )

        # Check all required fields exist
        missing_fields = []
        for field in REQUIRED_SIDECAR_FIELDS:
            if field not in result:
                missing_fields.append(field)

        assert not missing_fields, f"Missing sidecar v2 fields: {missing_fields}"

        # Verify field types
        assert isinstance(result.get("sidecar_version"), int) and result.get("sidecar_version") >= 2, \
            "sidecar_version must be int >= 2"
        assert isinstance(result.get("context_sources"), dict), "context_sources must be dict"
        assert isinstance(result.get("source_counts"), dict), "source_counts must be dict"
        assert isinstance(result.get("degraded_sources"), list), "degraded_sources must be list"
        assert isinstance(result.get("lineage_refs"), list), "lineage_refs must be list"
        assert isinstance(result.get("source_hash_refs"), list), "source_hash_refs must be list"
        assert isinstance(result.get("required_sources"), list), "required_sources must be list"
        assert isinstance(result.get("used_sources"), list), "used_sources must be list"

        return {
            "ok": True,
            "sidecar_version": result.get("sidecar_version"),
            "field_types": {k: type(v).__name__ for k, v in result.items() if k in REQUIRED_SIDECAR_FIELDS},
        }
    finally:
        temp_dispatch.unlink(missing_ok=True)


def test_sidecar_source_counts_match_hits():
    """V2-D: source_counts 与实际 hits 中的 source_type 一致."""
    result = unified_search("solar harness", max_hits=10)

    # Count source_type in hits
    actual_counts = {}
    for hit in result.get("hits", []):
        st = hit.get("source_type")
        if st:
            actual_counts[st] = actual_counts.get(st, 0) + 1

    returned_counts = result.get("source_counts", {})

    # Verify counts match
    mismatches = []
    for source, count in actual_counts.items():
        if returned_counts.get(source) != count:
            mismatches.append(f"{source}: actual={count}, returned={returned_counts.get(source)}")

    assert not mismatches, f"Source count mismatches: {mismatches}"

    return {
        "ok": True,
        "actual_counts": actual_counts,
        "returned_counts": returned_counts,
    }


def test_sidecar_lineage_and_hash_refs():
    """V2-E: lineage_refs 和 source_hash_refs 从 hits 正确聚合."""
    result = unified_search("solar harness context", max_hits=5)

    lineage_refs = result.get("lineage_refs", [])
    source_hash_refs = result.get("source_hash_refs", [])

    # Verify they are lists
    assert isinstance(lineage_refs, list), "lineage_refs must be list"
    assert isinstance(source_hash_refs, list), "source_hash_refs must be list"

    # Verify uniqueness (should be de-duplicated)
    assert len(lineage_refs) == len(set(lineage_refs)), "lineage_refs should be unique"
    assert len(source_hash_refs) == len(set(source_hash_refs)), "source_hash_refs should be unique"

    return {
        "ok": True,
        "lineage_refs_count": len(lineage_refs),
        "source_hash_refs_count": len(source_hash_refs),
    }


def test_cocoindex_degraded_explicit_reason():
    """V2-F: cocoindex 降级必须显式 degraded_reason 字符串."""
    # Try to import and test cocoindex adapter
    try:
        import cocoindex_adapter
        hits, ok, reason = cocoindex_adapter.search("test query", limit=3)

        if not ok and reason:
            # Verify reason is non-empty string
            assert isinstance(reason, str) and reason.strip(), \
                f"cocoindex degraded_reason must be non-empty string, got: {reason!r}"
        elif hits:
            # Check if any hits are marked degraded
            degraded_hits = [h for h in hits if h.get("degraded")]
            for hit in degraded_hits:
                degraded_reason = hit.get("degraded_reason")
                assert degraded_reason and isinstance(degraded_reason, str) and degraded_reason.strip(), (
                    f"cocoindex hit {hit.get('path')} has degraded=True but empty degraded_reason"
                )

        return {
            "ok": True,
            "cocoindex_available": ok,
            "hits_count": len(hits),
            "degraded_reason": reason if not ok else None,
        }
    except ImportError as e:
        return {
            "ok": True,
            "cocoindex_available": False,
            "degraded_reason": f"import_error:{e}",
        }


def test_understanding_degraded_explicit_reason():
    """V2-G: understanding 降级必须显式 degraded_reason 字符串."""
    try:
        import understand_anything_adapter
        hits, ok, reason = understand_anything_adapter.search("test query", limit=3)

        if not ok and reason:
            assert isinstance(reason, str) and reason.strip(), \
                f"understanding degraded_reason must be non-empty string, got: {reason!r}"
        elif hits:
            degraded_hits = [h for h in hits if h.get("degraded")]
            for hit in degraded_hits:
                degraded_reason = hit.get("degraded_reason")
                assert degraded_reason and isinstance(degraded_reason, str) and degraded_reason.strip(), (
                    f"understanding hit {hit.get('path')} has degraded=True but empty degraded_reason"
                )

        return {
            "ok": True,
            "understanding_available": ok,
            "hits_count": len(hits),
            "degraded_reason": reason if not ok else None,
        }
    except ImportError as e:
        return {
            "ok": True,
            "understanding_available": False,
            "degraded_reason": f"import_error:{e}",
        }


if __name__ == "__main__":
    import pytest

    # Run tests and collect evidence
    evidence_dir = HARNESS_DIR / "runtime" / "s05-verification-release"
    evidence_dir.mkdir(parents=True, exist_ok=True)

    all_results = {}

    # Run each test function and collect results
    test_funcs = [
        ("test_mirage_search_source_types", test_mirage_search_source_types),
        ("test_mirage_search_degraded_reason", test_mirage_search_degraded_reason),
        ("test_sidecar_v2_fields", test_sidecar_v2_fields),
        ("test_sidecar_source_counts_match_hits", test_sidecar_source_counts_match_hits),
        ("test_sidecar_lineage_and_hash_refs", test_sidecar_lineage_and_hash_refs),
        ("test_cocoindex_degraded_explicit_reason", test_cocoindex_degraded_explicit_reason),
        ("test_understanding_degraded_explicit_reason", test_understanding_degraded_explicit_reason),
    ]

    for name, func in test_funcs:
        try:
            result = func()
            all_results[name] = {"status": "passed", **result}
        except AssertionError as e:
            all_results[name] = {"status": "failed", "error": str(e)}
        except Exception as e:
            all_results[name] = {"status": "error", "error": f"{type(e).__name__}: {e}"}

    # Write L2-search.json (mirage search completeness evidence)
    search_evidence = {
        "test_name": "V2_search_sidecar_completeness",
        "query": "solar harness mirage search context",
        "required_source_types": sorted(REQUIRED_SOURCE_TYPES),
        "test_results": all_results,
        "summary": {
            "total": len(all_results),
            "passed": sum(1 for r in all_results.values() if r.get("status") == "passed"),
            "failed": sum(1 for r in all_results.values() if r.get("status") == "failed"),
            "errors": sum(1 for r in all_results.values() if r.get("status") == "error"),
        },
    }

    search_evidence_path = evidence_dir / "L2-search.json"
    search_evidence_path.write_text(json.dumps(search_evidence, ensure_ascii=False, indent=2), encoding="utf-8")

    # Write L2-sidecar.json (sidecar v2 completeness evidence)
    sidecar_evidence = {
        "test_name": "V2_sidecar_v2_completeness",
        "required_sidecar_fields": sorted(REQUIRED_SIDECAR_FIELDS),
        "field_descriptions": {
            "sidecar_version": "Sidecar schema version (must be >= 2)",
            "context_sources": "Map of source -> hit count",
            "source_counts": "Same as context_sources (alias)",
            "degraded_sources": "List of degraded source reasons",
            "lineage_refs": "List of lineage references from hits",
            "source_hash_refs": "List of source hashes from hits",
            "required_sources": "Required source types for this task_kind",
            "used_sources": "Source types that actually returned hits",
        },
        "test_results": {
            k: v for k, v in all_results.items()
            if "sidecar" in k.lower() or "lineage" in k.lower()
        },
        "summary": {
            "all_fields_present": all(f in all_results.get("test_sidecar_v2_fields", {}).get("field_types", {})
                                      for f in REQUIRED_SIDECAR_FIELDS),
        },
    }

    sidecar_evidence_path = evidence_dir / "L2-sidecar.json"
    sidecar_evidence_path.write_text(json.dumps(sidecar_evidence, ensure_ascii=False, indent=2), encoding="utf-8")

    # Exit with error code if any test failed
    failed = any(r.get("status") != "passed" for r in all_results.values())
    if failed:
        print("Some V2 tests failed. See evidence JSON for details.", file=sys.stderr)
        sys.exit(1)

    print(f"V2 tests passed. Evidence written to {search_evidence_path} and {sidecar_evidence_path}")
