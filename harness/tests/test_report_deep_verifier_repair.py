from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
SCRIPTS = ROOT / "scripts"
for item in (str(TOOLS), str(SCRIPTS), str(ROOT / "lib")):
    if item not in __import__("sys").path:
        __import__("sys").path.insert(0, item)


def _load_cli_module():
    spec = importlib.util.spec_from_file_location("tech_hotspot_radar_test_module", ROOT / "scripts" / "tech_hotspot_radar.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    __import__("sys").modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _sample_plan() -> dict:
    return {
        "schema_version": "legacy",
        "reports": [
            {
                "report_id": "ai-runtime",
                "title": "AI Runtime",
                "chapters": [
                    {
                        "chapter_id": "ch_01",
                        "title": "Runtime Shift",
                        "priority": "P1",
                        "material_video_refs": ["V001", "V002", "V003", "V004"],
                    },
                ],
            },
        ],
    }


def _sample_evidence() -> dict:
    return {
        "videos": [
            {"video_ref": "V001", "video_id": "raw-1", "quality_tier": "T1", "transcript_status": "fetched", "transcript_segments": [{"text": "a"}]},
            {"video_ref": "V002", "video_id": "raw-2", "quality_tier": "T0", "transcript_status": "fetched", "transcript_segments": [{"text": "b"}]},
            {"video_ref": "V003", "video_id": "raw-3", "quality_tier": "T2", "transcript_status": "fetched", "transcript_segments": [{"text": "c"}]},
            {"video_ref": "V004", "video_id": "raw-4", "quality_tier": "T1", "transcript_status": "fetched", "transcript_segments": [{"text": "d"}]},
        ],
        "skipped_material_refs": [],
    }


def _sample_catalog() -> list[dict]:
    return [
        {"video_ref": "V001", "video_id": "raw-1", "title": "Agent runtime"},
        {"video_ref": "V002", "video_id": "raw-2", "title": "Model routing"},
        {"video_ref": "V003", "video_id": "raw-3", "title": "Support"},
        {"video_ref": "V004", "video_id": "raw-4", "title": "Bad"},
    ]


def _sample_verification_evidence() -> dict:
    return {
        "videos": [
            {"video_ref": "V001", "video_id": "raw-1", "quality_tier": "T1", "transcript_status": "fetched", "transcript_segments": [{"text": "a"}]},
            {"video_ref": "V002", "video_id": "raw-2", "quality_tier": "T2", "transcript_status": "fetched", "transcript_segments": [{"text": "b"}]},
            {"video_ref": "V003", "video_id": "raw-3", "quality_tier": "T3", "transcript_status": "failed", "transcript_segments": [{"text": "c"}]},
        ],
    }


def test_ai_influence_chapter_writer_deep_writer_requires_deep_research_state(tmp_path, monkeypatch):
    mod = _load_cli_module()
    req_dir = tmp_path / "request"
    req_dir.mkdir(parents=True, exist_ok=True)

    def mock_chatgpt_call(*args, **kwargs):
        return {
            "markdown": "## Chapter\n\n" + ("deep test " * 40),
            "model": "test-model",
            "backend": "browser_agent_chatgpt",
            "request_dir": str(req_dir),
        }

    monkeypatch.setattr(mod, "call_browser_agent_chatgpt_markdown", mock_chatgpt_call)
    with pytest.raises(ValueError, match="deep_writer missing deep-research-state.json"):
        mod.call_ai_influence_chapter_writer_with_repair(
            "prompt",
            {},
            purpose="ai-influence-report-chapter",
            model_name="test-model",
            chapter_id="ch_01",
            require_deep_writer=True,
            min_chars=40,
            max_attempts=1,
        )


def test_ai_influence_chapter_writer_deep_writer_accepts_with_ok_proof(tmp_path, monkeypatch):
    mod = _load_cli_module()
    req_dir = tmp_path / "request-ok"
    req_dir.mkdir(parents=True, exist_ok=True)
    proof = req_dir / "deep-research-state.json"
    proof.write_text(json.dumps({"ok": True, "proof": "ok"}, ensure_ascii=False), encoding="utf-8")
    seen: dict = {}

    def mock_chatgpt_call(*args, **kwargs):
        seen["operator_kind"] = str(kwargs.get("operator_kind") or "")
        return {
            "markdown": "## Chapter\n\n" + ("deep ok " * 40),
            "model": "test-model",
            "backend": "browser_agent_chatgpt",
            "request_dir": str(req_dir),
        }

    monkeypatch.setattr(mod, "call_browser_agent_chatgpt_markdown", mock_chatgpt_call)
    result = mod.call_ai_influence_chapter_writer_with_repair(
        "prompt",
        {},
        purpose="ai-influence-report-chapter",
        model_name="test-model",
        chapter_id="ch_01",
        require_deep_writer=True,
        min_chars=40,
        max_attempts=1,
    )
    assert seen["operator_kind"] == "deep_writer"
    assert result["deep_writer_used"] is True
    assert result["deep_proof_path"] == str(proof)


def test_run_chapter_repair_loop_writes_sidecar_and_resolves_within_attempt_limit(tmp_path, monkeypatch):
    mod = _load_cli_module()
    report_dir = tmp_path / "report"
    report_dir.mkdir(parents=True, exist_ok=True)
    chapter_spec = {"chapter_id": "ch_01", "chapter_type": "core_trend"}
    chapter_prompt = "生成章节正文，要求含结论与依据。"
    call_count = {"writer": 0}

    def mock_writer(*args, **kwargs):
        call_count["writer"] += 1
        if call_count["writer"] == 1:
            return {
                "markdown": "## ch\n\n短文本。",
                "model": "test-model",
                "backend": "browser_agent_chatgpt",
                "request_dir": str(tmp_path / "req-1"),
            }
        return {
            "markdown": (
                "## 章节\n\n"
                "第一段：有明确判断，支持 V001 的关键路径与边界，"
                "并结合 V002 说明反例约束。"
            ),
            "model": "test-model",
            "backend": "browser_agent_chatgpt",
            "request_dir": str(tmp_path / "req-2"),
        }

    def mock_writer_runtime(*args, **kwargs):
        return mock_writer()

    monkeypatch.setattr(mod, "runtime_run_chapter_writer", mock_writer_runtime)
    monkeypatch.setattr(mod, "run_chapter_verifier", lambda *a, **k: {
        "checks": [
            {"name": "has_clear_thesis", "passed": True},
            {"name": "uses_required_evidence", "passed": True},
            {"name": "no_internal_field_leak", "passed": True},
            {"name": "no_unsupported_claim", "passed": True},
        ],
        "status": "passed",
        "grounded_claim_ratio": 0.98,
        "unsupported_refs": [],
    })

    result = mod.run_chapter_repair_loop(
        {"chapter_id": "ch_01"},
        chapter_spec,
        chapter_prompt,
        {"videos": [], "report_spec": {}, "chapter_spec": chapter_spec},
        report_dir,
        model_name="test-model",
        config={},
        require_deep_writer=False,
        min_chars=30,
        max_attempts=3,
    )
    assert result["status"] == "passed"
    assert result["repair_attempts"] == 2
    sidecar = Path(result["repair_sidecar_path"])
    assert sidecar.exists()
    sidecar_lines = [json.loads(line) for line in sidecar.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert len(sidecar_lines) == 2
    assert result["repair_history"][-1]["attempt"] == 2


def test_run_chapter_repair_loop_degrades_unsupported_claim_to_observation(tmp_path, monkeypatch):
    mod = _load_cli_module()
    report_dir = tmp_path / "report"
    report_dir.mkdir(parents=True, exist_ok=True)
    chapter_spec = {"chapter_id": "ch_02", "chapter_type": "core_trend"}
    chapter_prompt = "输出一个章节判断。"
    calls = {"i": 0}

    def mock_writer(*args, **kwargs):
        calls["i"] += 1
        return {
            "markdown": "## 章节\n\nV001 的结论尚可参考，但证据不足。",
            "model": "test-model",
            "backend": "browser_agent_chatgpt",
            "request_dir": str(tmp_path / f"req-{calls['i']}"),
        }

    def mock_writer_runtime(*args, **kwargs):
        return mock_writer()

    verify_calls = {"i": 0}

    def mock_verifier(chapter: dict, markdown: str, evidence_pack: dict):
        verify_calls["i"] += 1
        if verify_calls["i"] == 1:
            return {
                "checks": [
                    {"name": "has_clear_thesis", "passed": True},
                    {"name": "uses_required_evidence", "passed": True},
                    {"name": "no_internal_field_leak", "passed": True},
                    {"name": "no_unsupported_claim", "passed": False},
                ],
                "status": "repair_needed",
                "grounded_claim_ratio": 0.74,
                "unsupported_refs": ["V001"],
                "claim_verification": [
                    {
                        "claim_text": "V001 的结论尚可参考，但证据不足。",
                        "evidence_ids": ["V001"],
                        "verification_status": "unsupported",
                    }
                ],
            }
        return {
            "checks": [
                {"name": "has_clear_thesis", "passed": True},
                {"name": "uses_required_evidence", "passed": True},
                {"name": "no_internal_field_leak", "passed": True},
                {"name": "no_unsupported_claim", "passed": True},
            ],
            "status": "passed",
            "grounded_claim_ratio": 0.95,
            "unsupported_refs": [],
            "claim_verification": [],
        }

    monkeypatch.setattr(mod, "runtime_run_chapter_writer", mock_writer_runtime)
    monkeypatch.setattr(mod, "run_chapter_verifier", mock_verifier)

    result = mod.run_chapter_repair_loop(
        {"chapter_id": "ch_02"},
        chapter_spec,
        chapter_prompt,
        {"videos": [], "report_spec": {}, "chapter_spec": chapter_spec},
        report_dir,
        model_name="test-model",
        config={},
        min_chars=1,
        max_attempts=3,
    )
    assert result["status"] == "passed"
    assert result["repair_attempts"] == 1
    assert "证据不足" in result["chapter_markdown"]
    assert json.loads(Path(result["repair_sidecar_path"]).read_text(encoding="utf-8").splitlines()[0])["status"] == "passed"


def test_run_chapter_repair_loop_internal_field_leak_is_internal_only(tmp_path, monkeypatch):
    mod = _load_cli_module()
    report_dir = tmp_path / "report"
    report_dir.mkdir(parents=True, exist_ok=True)
    chapter_spec = {"chapter_id": "ch_02", "chapter_type": "core_trend"}
    chapter_prompt = "请生成包含关键判断的正文。"

    def mock_writer(*args, **kwargs):
        return {
            "markdown": "## 章节\n\nvideo_id 被不当外部泄露，示例为 internal check。",
            "model": "test-model",
            "backend": "browser_agent_chatgpt",
            "request_dir": str(tmp_path / "requests" / "ch_02"),
        }

    monkeypatch.setattr(mod, "runtime_run_chapter_writer", lambda *a, **k: mock_writer())
    monkeypatch.setattr(
        mod,
        "run_chapter_verifier",
        lambda *a, **k: {
            "checks": [
                {"name": "has_clear_thesis", "passed": True},
                {"name": "uses_required_evidence", "passed": True},
                {"name": "no_internal_field_leak", "passed": False},
                {"name": "no_unsupported_claim", "passed": True},
            ],
            "status": "repair_needed",
            "grounded_claim_ratio": 0.95,
            "unsupported_refs": [],
        },
    )

    result = mod.run_chapter_repair_loop(
        {"chapter_id": "ch_02"},
        chapter_spec,
        chapter_prompt,
        {"videos": [], "report_spec": {}, "chapter_spec": chapter_spec},
        report_dir,
        model_name="test-model",
        config={},
        max_attempts=2,
    )
    assert result["status"] == "internal_only"
    assert result["repair_attempts"] == 2
    assert result["repair_history"][-1]["status"] == "internal_only"
    sidecar_lines = [json.loads(line) for line in Path(result["repair_sidecar_path"]).read_text(encoding="utf-8").splitlines() if line.strip()]
    assert len(sidecar_lines) == 2


def test_run_chapter_repair_loop_blocks_after_max_attempts_and_writes_sidecar(tmp_path, monkeypatch):
    mod = _load_cli_module()
    report_dir = tmp_path / "report"
    report_dir.mkdir(parents=True, exist_ok=True)
    chapter_spec = {"chapter_id": "ch_03", "chapter_type": "core_trend"}
    chapter_prompt = "请输出一段正文。"
    mock_calls = {"i": 0}

    def mock_writer(*args, **kwargs):
        mock_calls["i"] += 1
        return {
            "markdown": "## ch\n\n弱证据。",
            "model": "test-model",
            "backend": "browser_agent_chatgpt",
            "request_dir": str(tmp_path / f"req-{mock_calls['i']}"),
        }

    def mock_writer_runtime(*args, **kwargs):
        return mock_writer()

    def mock_verifier(*args, **kwargs):
        return {
            "checks": [
                {"name": "has_clear_thesis", "passed": True},
                {"name": "uses_required_evidence", "passed": True},
                {"name": "no_internal_field_leak", "passed": True},
                {"name": "no_unsupported_claim", "passed": False},
            ],
            "status": "repair_needed",
            "grounded_claim_ratio": 0.52,
            "unsupported_refs": ["V001"],
            "claim_verification": [
                {
                    "claim_text": "弱证据不足",
                    "evidence_ids": ["V001"],
                    "verification_status": "unsupported",
                }
            ],
        }

    monkeypatch.setattr(mod, "runtime_run_chapter_writer", mock_writer_runtime)
    monkeypatch.setattr(mod, "run_chapter_verifier", mock_verifier)
    result = mod.run_chapter_repair_loop(
        {"chapter_id": "ch_03"},
        chapter_spec,
        chapter_prompt,
        {"videos": [], "report_spec": {}, "chapter_spec": chapter_spec},
        report_dir,
        model_name="test-model",
        config={},
        max_attempts=3,
    )
    assert result["status"] == "blocked"
    assert result["repair_attempts"] == 3
    sidecar_lines = [line for line in Path(result["repair_sidecar_path"]).read_text(encoding="utf-8").splitlines() if line.strip()]
    assert len(sidecar_lines) == 3
    assert all(json.loads(line)["status"] in {"repair_needed", "blocked"} for line in sidecar_lines)


def test_run_chapter_repair_loop_blocks_after_max_attempt_cap(tmp_path, monkeypatch):
    mod = _load_cli_module()
    report_dir = tmp_path / "report"
    report_dir.mkdir(parents=True, exist_ok=True)
    chapter_spec = {"chapter_id": "ch_04", "chapter_type": "core_trend"}
    chapter_prompt = "请输出一段正文。"
    mock_calls = {"i": 0}

    def mock_writer(*args, **kwargs):
        mock_calls["i"] += 1
        return {
            "markdown": "## ch\n\n弱证据。",
            "model": "test-model",
            "backend": "browser_agent_chatgpt",
            "request_dir": str(tmp_path / f"req-{mock_calls['i']}"),
        }

    def mock_writer_runtime(*args, **kwargs):
        return mock_writer()

    def mock_verifier(*args, **kwargs):
        return {
            "checks": [
                {"name": "has_clear_thesis", "passed": False},
                {"name": "uses_required_evidence", "passed": True},
                {"name": "no_internal_field_leak", "passed": True},
                {"name": "no_unsupported_claim", "passed": False},
            ],
            "status": "repair_needed",
            "grounded_claim_ratio": 0.35,
            "unsupported_refs": ["V001"],
            "claim_verification": [
                {
                    "claim_text": "弱证据不足",
                    "evidence_ids": ["V001"],
                    "verification_status": "unsupported",
                }
            ],
        }

    monkeypatch.setattr(mod, "runtime_run_chapter_writer", mock_writer_runtime)
    monkeypatch.setattr(mod, "run_chapter_verifier", mock_verifier)
    result = mod.run_chapter_repair_loop(
        {"chapter_id": "ch_04"},
        chapter_spec,
        chapter_prompt,
        {"videos": [], "report_spec": {}, "chapter_spec": chapter_spec},
        report_dir,
        model_name="test-model",
        config={},
        max_attempts=5,
    )
    assert result["status"] in {"internal_only", "blocked"}
    assert result["repair_attempts"] == 3
    sidecar_lines = [line for line in Path(result["repair_sidecar_path"]).read_text(encoding="utf-8").splitlines() if line.strip()]
    assert len(sidecar_lines) == 3


def _load_report_pipeline_module(monkeypatch, tmp_path: Path):
    mod = _load_cli_module()
    out_dir = tmp_path / "out" / "ai-influence-planned" / "2026-06-01"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report-plan.json").write_text(json.dumps(_sample_plan(), ensure_ascii=False), encoding="utf-8")
    (out_dir / "video-catalog.json").write_text(json.dumps(_sample_catalog(), ensure_ascii=False), encoding="utf-8")
    (out_dir / "video-groups.json").write_text("{}", encoding="utf-8")

    class Conn:
        row_factory = None

        def close(self) -> None:
            pass

    monkeypatch.setattr(mod, "resolve_config", lambda args: Path("unused.yaml"))
    monkeypatch.setattr(mod, "load_config", lambda path: {
        "output": {"raw_dir": str(tmp_path / "out")},
        "youtube": {"ai_influence_report_flow": {"report_writer": {"model": "test-model"}}},
    })
    monkeypatch.setattr(mod, "resolve_db", lambda args, config: tmp_path / "db.sqlite")
    monkeypatch.setattr(mod, "ensure_db", lambda path: Conn())
    monkeypatch.setattr(mod, "begin_run", lambda *a, **k: 1)
    monkeypatch.setattr(mod, "finish_run", lambda *a, **k: None)
    monkeypatch.setattr(mod, "record_model_ledgers", lambda *a, **k: None)
    monkeypatch.setattr(mod, "render_ai_influence_report_html_anything", lambda markdown, evidence, report: f"<html>{markdown}</html>")
    monkeypatch.setattr(mod, "build_planned_report_evidence_pack", lambda *a, **k: _sample_evidence())
    monkeypatch.setattr(mod, "backfill_planned_report_evidence_from_existing", lambda report_dir, pack: pack)
    monkeypatch.setattr(mod, "runtime_synthesize_report", lambda ir, dir: {
        "markdown": "## 一页结论\nproof pass\n\n## 核心趋势\nx\n\n## 关键视频证据\nx\n\n## 产品 / 研究 / 工程启示\nx\n\n## Open Questions\nx\n\n## Provenance\n- final_reasoner: test-model\n- local_preprocess: ThunderOMLX/Qwen3.6 semantic packets\n- input_videos: 1",
        "path": str(dir / "synthesis"),
    })
    monkeypatch.setattr(mod, "phase_transcript_attachment", lambda evidence_pack: "")
    monkeypatch.setattr(mod, "phase_transcript_attachment_clean", lambda evidence_pack: "")
    args = argparse.Namespace(
        date="2026-06-01",
        days=7,
        plan_file=None,
        report_id=None,
        output_base=str(tmp_path / "out"),
        model="test-model",
        send=False,
        legacy=False,
        skip_notebooklm=True,
        notebook_name=None,
        continue_on_error=False,
    )
    return mod, args, out_dir


def test_cmd_run_ai_influence_planned_reports_blocks_p1_chapter_without_deep_proof(tmp_path, monkeypatch):
    mod, args, out_dir = _load_report_pipeline_module(monkeypatch, tmp_path)

    def mock_chapter_writer(*args, **kwargs):
        request_dir = tmp_path / "requests" / str(kwargs.get("chapter_id") or "chapter")
        request_dir.mkdir(parents=True, exist_ok=True)
        return {
            "markdown": "## Chapter\n\n" + ("text " * 40),
            "model": "test-model",
            "backend": "browser_agent_chatgpt",
            "request_dir": str(request_dir),
            "require_deep_writer": True,
        }

    monkeypatch.setattr(mod, "call_ai_influence_chapter_writer_with_repair", mock_chapter_writer)
    assert mod.cmd_run_ai_influence_planned_reports(args) == 1
    report_dir = out_dir / "reports" / "ai-runtime"
    assert (report_dir / "report.blocked.json").exists()
    assert not (report_dir / "report-result.json").exists()


def test_cmd_run_ai_influence_planned_reports_records_deep_proof_path(tmp_path, monkeypatch):
    mod, args, out_dir = _load_report_pipeline_module(monkeypatch, tmp_path)
    monkeypatch.setattr(mod, "run_chapter_verifier", lambda *a, **k: {
        "checks": [
            {"name": "has_clear_thesis", "passed": True},
            {"name": "uses_required_evidence", "passed": True},
            {"name": "no_internal_field_leak", "passed": True},
            {"name": "no_unsupported_claim", "passed": True},
        ],
        "status": "passed",
        "grounded_claim_ratio": 0.98,
        "unsupported_refs": [],
    })
    monkeypatch.setattr(mod, "runtime_build_chapter_evidence_pack", lambda evidence_pack, chapter_spec, quality_targets: {
        "videos": [{"video_ref": "V001"}],
        "core_evidence": [],
        "support_evidence": [],
        "selected_videos": [{"video_ref": "V001"}],
    })

    def mock_run_chapter_writer(*args, **kwargs):
        chapter_job = args[1] if len(args) > 1 and isinstance(args[1], dict) else {}
        chapter_id = str(chapter_job.get("chapter_id") or "chapter")
        request_dir = tmp_path / "requests" / chapter_id
        request_dir.mkdir(parents=True, exist_ok=True)
        proof = request_dir / "deep-research-state.json"
        proof.write_text(json.dumps({"ok": True}, ensure_ascii=False), encoding="utf-8")
        return {
            "markdown": "## Chapter\n\n" + ("text " * 40),
            "model": "test-model",
            "backend": "browser_agent_chatgpt",
            "require_deep_writer": True,
            "request_dir": str(request_dir),
            "deep_proof_path": str(proof),
        }

    monkeypatch.setattr(mod, "runtime_run_chapter_writer", mock_run_chapter_writer)
    assert mod.cmd_run_ai_influence_planned_reports(args) == 0

    report_dir = out_dir / "reports" / "ai-runtime"
    report_result = json.loads((report_dir / "report-result.json").read_text(encoding="utf-8"))
    assert report_result["deep_writer_required_chapters"] == ["ch_01"]
    assert str((tmp_path / "requests" / "ch_01" / "deep-research-state.json")) in report_result["deep_proof_paths"]
    assert report_result["chapter_verification_count"] == 1
    assert report_result["chapter_verification_repair_needed"] == []
    assert (report_dir / "chapter-verifications" / "ch_01.verification.json").exists()
    assert json.loads((report_dir / "chapter-verifications" / "ch_01.verification.json").read_text(encoding="utf-8"))["status"] == "passed"
    assert report_result["chapter_repair_sidecar_paths"]


def test_cmd_run_ai_influence_planned_reports_internal_field_leak_marks_internal_only_blocked(tmp_path, monkeypatch):
    mod, args, out_dir = _load_report_pipeline_module(monkeypatch, tmp_path)

    def mock_chapter_writer(*args, **kwargs):
        request_dir = tmp_path / "requests" / str(kwargs.get("chapter_id") or "chapter")
        request_dir.mkdir(parents=True, exist_ok=True)
        return {
            "markdown": "## Chapter\n\nvideo_id 包含内部字段泄漏示例。",
            "model": "test-model",
            "backend": "browser_agent_chatgpt",
            "request_dir": str(request_dir),
            "require_deep_writer": False,
        }

    def mock_verifier(*a, **k):
        return {
            "checks": [
                {"name": "has_clear_thesis", "passed": True},
                {"name": "uses_required_evidence", "passed": True},
                {"name": "no_internal_field_leak", "passed": False},
                {"name": "no_unsupported_claim", "passed": True},
            ],
            "status": "repair_needed",
            "grounded_claim_ratio": 0.95,
            "unsupported_refs": [],
            "claim_verification": [],
        }

    monkeypatch.setattr(mod, "call_ai_influence_chapter_writer_with_repair", mock_chapter_writer)
    monkeypatch.setattr(mod, "run_chapter_verifier", mock_verifier)

    assert mod.cmd_run_ai_influence_planned_reports(args) == 1
    report_dir = out_dir / "reports" / "ai-runtime"
    blocked = json.loads((report_dir / "report.blocked.json").read_text(encoding="utf-8"))
    assert blocked["status"] == "internal_only"
    assert blocked["failure_mode"] == "internal_only"
    assert not (report_dir / "report-result.json").exists()


def test_run_chapter_verifier_has_clear_checks(tmp_path):
    mod = _load_cli_module()
    chapter_spec = {
        "chapter_id": "ch_01",
        "chapter_type": "core_trend",
        "required_evidence": ["V001", "V002", "V004"],
    }
    markdown = "核心结论基于V001和V002。"
    result = mod.run_chapter_verifier(chapter_spec, markdown, _sample_verification_evidence())
    checks = {item["name"]: item["passed"] for item in result["checks"]}
    assert checks["has_clear_thesis"] is True
    assert checks["uses_required_evidence"] is False
    assert checks["no_internal_field_leak"] is True
    assert checks["no_unsupported_claim"] is True
    assert result["grounded_claim_ratio"] == 0.95
    assert result["status"] == "repair_needed"


def test_run_chapter_verifier_tier_failed_is_weak_and_not_core_supported():
    mod = _load_cli_module()
    chapter_spec = {"chapter_id": "ch_02", "chapter_type": "core_trend"}
    markdown = "V003 作为关键证据，说明核心因果方向。"
    chapter_pack = _sample_verification_evidence()
    result = mod.run_chapter_verifier(chapter_spec, markdown, chapter_pack)
    item = result["claim_verification"][0]
    assert item["verification_status"] == "unsupported"
    assert result["status"] == "repair_needed"
    assert result["unsupported_refs"] == ["V003"]
    assert result["grounded_claim_ratio"] < 0.9


def test_build_ai_influence_report_quality_score_publish_policy_by_threshold(tmp_path, monkeypatch):
    mod = _load_cli_module()

    def _fake_scores(verif: dict, *_args, **_kwargs):
        marker = str(verif.get("marker") or "A")
        if marker == "A":
            score = 98.0
        elif marker == "B":
            score = 86.0
        elif marker == "C":
            score = 77.0
        else:
            score = 45.0
        return {
            "evidence_grounding_score": score,
            "thesis_clarity_score": score,
            "insight_density_score": score,
            "cross_source_score": score,
            "technical_accuracy_score": score,
            "actionability_score": score,
            "counterargument_score": score,
            "readability_score": score,
            "structure_completeness_score": score,
        }

    monkeypatch.setattr(mod, "_build_ai_influence_chapter_quality_scores", _fake_scores)
    thresholds = {"A": 95, "B": 85, "C": 75}
    quality_a = mod.build_ai_influence_report_quality_score([({"marker": "A"}, "章节内容", {})], quality_targets={"quality_thresholds": thresholds})
    quality_b = mod.build_ai_influence_report_quality_score([({"marker": "B"}, "章节内容", {})], quality_targets={"quality_thresholds": thresholds})
    quality_c = mod.build_ai_influence_report_quality_score([({"marker": "C"}, "章节内容", {})], quality_targets={"quality_thresholds": thresholds})
    quality_d = mod.build_ai_influence_report_quality_score([({"marker": "D"}, "章节内容", {})], quality_targets={"quality_thresholds": thresholds})

    assert quality_a["grade"] == "A"
    assert quality_a["publish_decision"] == "publish"
    assert quality_a["publish_visibility"] is True
    assert quality_b["grade"] == "B"
    assert quality_b["publish_decision"] == "publish_with_warning"
    assert quality_b["publish_visibility"] is True
    assert quality_c["grade"] == "C"
    assert quality_c["publish_decision"] == "internal_only"
    assert quality_c["publish_visibility"] is False
    assert quality_d["grade"] == "D"
    assert quality_d["publish_decision"] == "repair"
    assert quality_d["publish_visibility"] is False


def test_cmd_run_ai_influence_planned_reports_writes_quality_score_and_blocks_public_publish_on_c(tmp_path, monkeypatch):
    mod, args, out_dir = _load_report_pipeline_module(monkeypatch, tmp_path)

    def mock_repair_loop(*_args, **_kwargs):
        chapter_id = str(_args[1].get("chapter_id") or "chapter")
        request_dir = tmp_path / "requests" / chapter_id
        request_dir.mkdir(parents=True, exist_ok=True)
        proof = request_dir / "deep-research-state.json"
        proof.write_text(json.dumps({"ok": True}, ensure_ascii=False), encoding="utf-8")
        return {
            "status": "passed",
            "repair_attempts": 1,
            "repair_sidecar_path": str(request_dir / "repair.jsonl"),
            "chapter_markdown": (
                "## 章节\n\n"
                "这是一个通过深度论证生成的章节示例，用于验证质量评分与发布决策的聚合，"
                "包含足够长度与明确观点，避免触发长度校验和内容质量检查。"
            ),
            "writer_result": {
                "markdown": (
                    "## 章节\n\n"
                    "这是一个通过深度论证生成的章节示例，用于验证质量评分与发布决策的聚合，"
                    "包含足够长度与明确观点，避免触发长度校验和内容质量检查。"
                ),
                "model": "test-model",
                "backend": "browser_agent_chatgpt",
                "input_token_count": 10,
                "output_token_count": 20,
                "latency_ms": 10,
                "request_dir": str(request_dir),
                "deep_writer_used": True,
                "require_deep_writer": True,
                "deep_proof_path": str(proof),
            },
            "verification": {
                "checks": [
                    {"name": "has_clear_thesis", "passed": True},
                    {"name": "uses_required_evidence", "passed": True},
                    {"name": "no_internal_field_leak", "passed": True},
                    {"name": "no_unsupported_claim", "passed": True},
                ],
                "status": "passed",
                "grounded_claim_ratio": 0.98,
                "unsupported_refs": [],
            },
        }

    monkeypatch.setattr(mod, "run_chapter_repair_loop", mock_repair_loop)
    monkeypatch.setattr(
        mod,
        "build_ai_influence_report_quality_score",
        lambda chapter_items, quality_targets=None: {
            "schema_version": "ai_influence_report_quality_score.v1",
            "overall_score": 66.0,
            "grade": "C",
            "publish_decision": "internal_only",
            "publish_visibility": False,
            "status_publish": {"status": "ok", "status_visible": False, "blocked_by_quality": "C"},
            "weights": {name: weight for name, weight in mod.QUALITY_SCORE_WEIGHTS.items()},
            "grade_thresholds": {"A": 95, "B": 90, "C": 75},
            "component_scores": {name: 66.0 for name in mod.QUALITY_SCORE_WEIGHTS},
            "chapter_scores": [],
        },
    )

    assert mod.cmd_run_ai_influence_planned_reports(args) == 0
    report_dir = out_dir / "reports" / "ai-runtime"
    quality_score_path = report_dir / "validation" / "quality-score.json"
    report_result = json.loads((report_dir / "report-result.json").read_text(encoding="utf-8"))
    assert quality_score_path.exists()

    quality_score = json.loads(quality_score_path.read_text(encoding="utf-8"))
    assert quality_score["grade"] == "C"
    assert quality_score["publish_decision"] == "internal_only"
    assert quality_score["publish_visibility"] is False
    assert report_result["publish_decision"] == "internal_only"
    assert report_result["publish_visibility"] is False


def test_run_chapter_repair_loop_boundary_missing_deep_proof_blocks_immediately(tmp_path, monkeypatch):
    mod = _load_cli_module()
    report_dir = tmp_path / "report"
    report_dir.mkdir(parents=True, exist_ok=True)
    chapter_spec = {"chapter_id": "ch_01", "chapter_type": "core_trend"}
    chapter_prompt = "请输出一段完整判断与依据。"

    def mock_writer(*args, **kwargs):
        request_dir = tmp_path / "requests" / "ch_01"
        request_dir.mkdir(parents=True, exist_ok=True)
        return {
            "markdown": "## 章节\n\n这是长度充足的一段正文，含有充分结构与结论，不依赖额外证据。", 
            "model": "test-model",
            "backend": "browser_agent_chatgpt",
            "request_dir": str(request_dir),
        }

    monkeypatch.setattr(mod, "runtime_run_chapter_writer", lambda *a, **k: mock_writer())
    monkeypatch.setattr(
        mod,
        "run_chapter_verifier",
        lambda *a, **k: {
            "checks": [
                {"name": "has_clear_thesis", "passed": True},
                {"name": "uses_required_evidence", "passed": True},
                {"name": "no_internal_field_leak", "passed": True},
                {"name": "no_unsupported_claim", "passed": True},
            ],
            "status": "passed",
            "grounded_claim_ratio": 0.97,
            "unsupported_refs": [],
        },
    )

    result = mod.run_chapter_repair_loop(
        {"chapter_id": "ch_01"},
        chapter_spec,
        chapter_prompt,
        {"videos": [], "report_spec": {}, "chapter_spec": chapter_spec},
        report_dir,
        model_name="test-model",
        config={},
        require_deep_writer=True,
        min_chars=30,
        max_attempts=2,
    )

    assert result["status"] == "blocked"
    assert result["repair_attempts"] == 2
    assert "missing_deep_proof" in result["reasons"][0]


def test_run_chapter_repair_loop_boundary_unsupported_claim_exhausted_with_single_attempt(tmp_path, monkeypatch):
    mod = _load_cli_module()
    report_dir = tmp_path / "report"
    report_dir.mkdir(parents=True, exist_ok=True)
    chapter_spec = {"chapter_id": "ch_02", "chapter_type": "core_trend"}
    chapter_prompt = "请输出一个含 claim 的章节正文。"

    def mock_writer(*args, **kwargs):
        return {
            "markdown": "## 章节\n\nV001 显示该方向证据成立，V002 也支持。", 
            "model": "test-model",
            "backend": "browser_agent_chatgpt",
            "request_dir": str(tmp_path / "requests" / "ch_02"),
        }

    def mock_verifier(*_args, **_kwargs):
        return {
            "checks": [
                {"name": "has_clear_thesis", "passed": True},
                {"name": "uses_required_evidence", "passed": True},
                {"name": "no_internal_field_leak", "passed": True},
                {"name": "no_unsupported_claim", "passed": False},
            ],
            "status": "repair_needed",
            "grounded_claim_ratio": 0.58,
            "unsupported_refs": ["V001"],
            "claim_verification": [
                {
                    "claim_text": "V001 显示该方向证据成立，V002 也支持。",
                    "evidence_ids": ["V001", "V002"],
                    "verification_status": "unsupported",
                }
            ],
        }

    monkeypatch.setattr(mod, "runtime_run_chapter_writer", lambda *a, **k: mock_writer())
    monkeypatch.setattr(mod, "run_chapter_verifier", mock_verifier)

    result = mod.run_chapter_repair_loop(
        {"chapter_id": "ch_02"},
        chapter_spec,
        chapter_prompt,
        {"videos": [{"video_ref": "V001"}], "report_spec": {}, "chapter_spec": chapter_spec},
        report_dir,
        model_name="test-model",
        config={},
        min_chars=20,
        max_attempts=1,
    )

    assert result["status"] == "blocked"
    assert result["repair_attempts"] == 1
    assert any("unsupported_claim" in reason for reason in result["reasons"])


def test_cmd_run_ai_influence_planned_reports_records_blocked_when_repair_loop_reaches_attempt_limit(tmp_path, monkeypatch):
    mod, args, out_dir = _load_report_pipeline_module(monkeypatch, tmp_path)

    def mock_repair_loop(*_args, **_kwargs):
        return {
            "status": "blocked",
            "repair_attempts": 3,
            "repair_sidecar_path": str(tmp_path / "requests" / "repair.jsonl"),
            "chapter_markdown": "## 章节\n\n" + "x" * 48,
            "writer_result": {
                "markdown": "## 章节\n\n" + "x" * 48,
                "model": "test-model",
                "backend": "browser_agent_chatgpt",
            },
            "verification": {
                "checks": [
                    {"name": "has_clear_thesis", "passed": True},
                    {"name": "uses_required_evidence", "passed": True},
                    {"name": "no_internal_field_leak", "passed": True},
                    {"name": "no_unsupported_claim", "passed": False},
                ],
                "status": "repair_needed",
                "grounded_claim_ratio": 0.35,
                "unsupported_refs": ["V001"],
            },
            "reasons": ["unsupported_claim"],
        }

    monkeypatch.setattr(mod, "run_chapter_repair_loop", mock_repair_loop)
    assert mod.cmd_run_ai_influence_planned_reports(args) == 1

    report_dir = out_dir / "reports" / "ai-runtime"
    blocked = json.loads((report_dir / "report.blocked.json").read_text(encoding="utf-8"))
    assert blocked["status"] in {"blocked", "internal_only"}
    assert blocked["failure_mode"] == blocked["status"]
    assert blocked["error_type"] == "ValueError"
